#!/bin/bash
# The runs loop (docs/plans/runs/README.md §7): one fresh headless Claude session per round, the
# script decides who goes next, checks, enforces the limits and pushes. Run it in tmux inside a
# throwaway VM:
#
#   bash docs/plans/runs/loop/run.sh --name runs-n1 --repo ~/code/laneboard-work \
#     --base plan/runs --deadline "2026-10-21 07:00" [--pr-base main] [--max-rounds 15] [--pause-5h 90] [--stop-7d 85] [--tz Europe/Zurich]
#
# Stop it gently with `touch ~/runs/<name>/STOP` (it finishes the round and writes the report).
# Everything it knows lives in ~/runs/<name>/: run.jsonl (the run protocol, §3 A1), log, rounds/.
set -uo pipefail

NAME="" REPO="" BASE="plan/runs" PR_BASE="main" NIGHT="Night 1" DEADLINE="" MAX_ROUNDS=40 PAUSE_5H=90 STOP_7D=85 TZ_RUN="Europe/Zurich"
while [ $# -gt 0 ]; do case $1 in
  --name) NAME=$2; shift 2;; --repo) REPO=$2; shift 2;; --base) BASE=$2; shift 2;; --pr-base) PR_BASE=$2; shift 2;;
  --deadline) DEADLINE=$2; shift 2;; --night) NIGHT=$2; shift 2;; --max-rounds) MAX_ROUNDS=$2; shift 2;;
  --pause-5h) PAUSE_5H=$2; shift 2;; --stop-7d) STOP_7D=$2; shift 2;; --tz) TZ_RUN=$2; shift 2;; *) echo "unknown $1"; exit 1;; esac; done
[ -n "$NAME" ] && [ -n "$REPO" ] && [ -n "$DEADLINE" ] || { echo "--name, --repo and --deadline are required"; exit 1; }

PLAN_DIR=docs/plans/runs
BRANCH="run/$NAME"
RUN_DIR="$HOME/runs/$NAME"; export RUN_DIR   # rounds put screenshots in $RUN_DIR/shots
MODEL_BUILD=${MODEL_BUILD:-claude-opus-5-5}     # planner, builder, fix, designer, final
MODEL_REVIEW=${MODEL_REVIEW:-claude-sonnet-5-5} # stranger, triage, operator
ROUND_SECS=${ROUND_SECS:-2700}                  # 45 min per round, then it is stopped
REVIEW_EVERY=${REVIEW_EVERY:-6}                  # builder rounds between stranger reviews
RESEARCH_MAX=${RESEARCH_MAX:-4}                  # research rounds per run

mkdir -p "$RUN_DIR/rounds"
# The loop runs from a frozen copy: a round cannot change the rules of the rounds after it.
if [ ! -d "$RUN_DIR/loop" ]; then cp -R "$REPO/$PLAN_DIR/loop" "$RUN_DIR/loop"; fi
L="$RUN_DIR/loop"
EV="$RUN_DIR/run.jsonl"
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT
[ -f ~/.config/claude-run.env ] && . ~/.config/claude-run.env
echo $$ > "$RUN_DIR/pid"

now() { date +%s; }
at() { TZ=$TZ_RUN date -d "$1" +%s; }
DEADLINE_S=$(at "$DEADLINE"); FINAL_S=$(( DEADLINE_S - 1800 ))
log() { echo "$(TZ=$TZ_RUN date '+%F %T') $*" | tee -a "$RUN_DIR/log"; }
# ev <type> key=value…  (values are JSON-escaped strings; numbers stay numbers)
ev() {
  python3 - "$EV" "$NAME" "$@" <<'PY'
import json, sys, time, re
path, run, t, *kv = sys.argv[1:]
d = {"v": 1, "t": t, "run": run, "ts": int(time.time() * 1000)}
NUM = {"n", "value", "rounds", "pause5h", "stop7d", "usd", "total", "fiveHourPct", "sevenDayPct",
       "fiveHourResetsAt", "overage", "open", "max", "ref"}
for item in kv:
    k, _, v = item.partition("=")
    if k in NUM and re.fullmatch(r"-?\d+(\.\d+)?", v):
        f = float(v); d[k] = int(f) if f.is_integer() else f
    else:
        d[k] = v
open(path, "a").write(json.dumps(d) + "\n")
PY
}

cd "$REPO" || exit 1
git fetch -q origin
if git rev-parse -q --verify "origin/$BRANCH" >/dev/null; then git checkout -q -B "$BRANCH" "origin/$BRANCH"
else git checkout -q -B "$BRANCH" "origin/$BASE"; fi
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1 || { log "npm ci failed"; exit 1; }

mapfile -t FENCE < <(grep -v '^\s*#' "$L/fenced.txt" | grep -v '^\s*$')
fenced_hits() {  # paths changed since $1 that match a fence glob
  git diff --name-only "$1" HEAD | while read -r f; do
    for g in "${FENCE[@]}"; do [[ $f == $g ]] && { echo "$f"; break; }; done
  done
}

TESTS_OK=1 TESTS_PASS=0 TESTS_FAIL=0 TEST_TAIL=""
check() {  # the checker is not an agent: npm test, hygiene included
  local out; out=$(timeout 900 npm test 2>&1); local rc=$?
  TESTS_PASS=$(grep -E '^ℹ pass ' <<<"$out" | awk '{print $3}' | tail -1); TESTS_PASS=${TESTS_PASS:-0}
  TESTS_FAIL=$(grep -E '^ℹ fail ' <<<"$out" | awk '{print $3}' | tail -1); TESTS_FAIL=${TESTS_FAIL:-0}
  [ $rc -eq 0 ] && TESTS_OK=1 || TESTS_OK=0
  TEST_TAIL=$(grep -E 'not ok|Error|assert' <<<"$out" | head -40)
  local total=$(( TESTS_PASS + TESTS_FAIL ))
  [ $total -gt 0 ] && ev score name=tests value="$(python3 -c "print(round($TESTS_PASS/$total,4))")" better=higher
}
count() { local c; c=$(grep -cE "$1" "$PLAN_DIR/PROGRESS.md" 2>/dev/null); echo "${c:-0}"; }
tasks_done() { count '^- \[x\] T[0-9]'; }
questions_open() { count '^- \[ \] Q[0-9]'; }
tasks_open() { count '^- \[ \] T[0-9]'; }
next_task() { grep -m1 -oE '^- \[ \] T[0-9]+' "$PLAN_DIR/PROGRESS.md" 2>/dev/null | grep -oE 'T[0-9]+'; }
# the task's headline for round.start: the line after "T<n>", markdown stripped, 120 chars
task_title() { grep -m1 -E "^- \[ \] $1\b" "$PLAN_DIR/PROGRESS.md" 2>/dev/null | sed -E "s/^- \[ \] $1[:.]? *//; s/[*\`]//g" | cut -c1-120; }
# the run's cost over every start of it (SPENT restarts with the loop; the run.stop total must not)
run_total() { python3 -c "import json,sys; print(round(sum(json.loads(l).get('usd',0) for l in open(sys.argv[1]) if '\"t\": \"cost\"' in l),2))" "$EV"; }

SPENT=0 U5=0 R5=0 U7=0 OVERAGE=0 HARD=0
# round <n> <role> <model>: one fresh session; returns 0 done, 2 rate-limited, 1 failed
round() {
  local n=$1 role=$2 model=$3 out="$RUN_DIR/rounds/$(printf %02d "$1")-$2.jsonl"
  local prompt; prompt="$(cat "$L/prompts/common.md" "$L/prompts/$role.md")

RUN: $NAME   NIGHT: $NIGHT (README §7)   ROUND: $n   ROLE: $role   RUN_DIR: $RUN_DIR
NOW ($TZ_RUN): $(TZ=$TZ_RUN date '+%F %H:%M')   DEADLINE: $DEADLINE
TESTS AFTER THE LAST ROUND: pass $TESTS_PASS, fail $TESTS_FAIL
$( [ "$TESTS_OK" = 0 ] && printf 'FAILING TESTS (tail):\n%s\n' "$TEST_TAIL" )
REVIEWS SO FAR: $(ls "$PLAN_DIR"/reviews/ 2>/dev/null | tr '\n' ' ')
$( [ -n "${STOP_REASON:-}" ] && echo "STOP REASON: $STOP_REASON   OWNER NOTES: $RUN_DIR/owner-notes" )"
  # The researcher reads the open web, so it gets no shell, no git, no MCP: only files in the repo
  # and web tools. What it finds lands in a markdown file that later rounds read as data.
  local tools=()
  case $role in
    research) tools=(--restricted --strict-mcp-config --tools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch") ;;
    triage) tools=(--restricted --strict-mcp-config --tools "Read,Write,Edit,Glob,Grep") ;;
  esac
  local task="" title=""; case $role in builder|fix) task=$(next_task); [ -n "$task" ] && title=$(task_title "$task");; esac
  # rounds after run.stop (operator review, report) say so, so a stopped run does not read "81 of 80"
  # its own session id, so laneboard binds the round to its session exactly (night 1 T12)
  local sid; sid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr A-Z a-z)
  ev round.start n="$n" role="$role" session="$sid" ${task:+task="$task"} ${title:+title="$title"} ${WRAPUP:+wrapup=true}
  # The prompt goes in on stdin, not argv: a round that runs `pkill -f <something the prompt names>`
  # must not match (and kill) its own session (night 3, rounds 3/16/18/22).
  LANEBOARD_RUN="$NAME/$n" timeout "$ROUND_SECS" claude -p --model "$model" --session-id "$sid" \
    --permission-mode auto "${tools[@]}" \
    --output-format stream-json --verbose <<<"$prompt" > "$out" 2>&1
  local rc=$?
  read -r cost err u5 r5 u7 over limited text < <(python3 - "$out" <<'PY'
import json, sys, re
cost, err, text = 0.0, 1, ""
u5 = r5 = u7 = -1; over = 0; limited = 0
for line in open(sys.argv[1], errors="replace"):
    try: m = json.loads(line)
    except Exception: continue
    if m.get("type") == "rate_limit_event":   # the real subscription windows, as the session sees them
        i = m.get("rate_limit_info") or {}; w = i.get("unifiedWindows") or {}
        f, s7 = w.get("five_hour") or {}, w.get("seven_day") or {}
        if "utilization" in f: u5, r5 = round(f["utilization"] * 100), int(f.get("resetsAt") or 0)
        if "utilization" in s7: u7 = round(s7["utilization"] * 100)
        # unifiedWindows is not in the docs (research/Q1): fall back to the documented single window
        if not w and "utilization" in i:
            if i.get("rateLimitType") == "five_hour": u5, r5 = round(i["utilization"] * 100), int(i.get("resetsAt") or 0)
            if i.get("rateLimitType") == "seven_day": u7 = round(i["utilization"] * 100)
        if i.get("isUsingOverage"): over = 1
        if i.get("status") not in (None, "allowed", "allowed_warning"): limited = 1
    if m.get("type") == "result":
        cost = m.get("total_cost_usd") or 0.0
        err = 1 if m.get("is_error") else 0
        text = (m.get("result") or "").replace("\n", " ")[:200]
if err and re.search(r"usage limit|limit reached|rate limit", text, re.I): limited = 1
print(f"{cost:.2f}", err, u5, r5, u7, over, limited, text or "-")
PY
)
  [ "$u5" -ge 0 ] && { U5=$u5; R5=$r5; }; [ "$u7" -ge 0 ] && U7=$u7; [ "$over" = 1 ] && OVERAGE=1
  ev usage n="$n" fiveHourPct="$U5" sevenDayPct="$U7" fiveHourResetsAt="$R5" overage="$OVERAGE"
  # No result message at all = Claude did not run (PATH, login, crash): a hard error, not a bad round.
  # Such a round writes no cost event: its cost is unknown, not $0.
  grep -q '"type":"result"' "$out" || { [ "$limited" = 1 ] && return 2; log "round $n: no session ($(head -c 200 "$out" | tr '\n' ' '))"; return 3; }
  SPENT=$(python3 -c "print(round($SPENT+${cost:-0},2))")
  ev cost n="$n" usd="${cost:-0}" total="$SPENT"
  [ "$limited" = 1 ] && return 2
  [ $rc -eq 124 ] && log "round $n timed out"
  [ "${err:-1}" = 0 ] && [ $rc -eq 0 ] && return 0 || return 1
}

push() {
  git push -q -u origin "$BRANCH" 2>>"$RUN_DIR/log" || { log "push failed"; return; }
  if [ ! -f "$RUN_DIR/pr" ]; then
    gh pr create --draft --base "$PR_BASE" --head "$BRANCH" --title "Runs: $NAME (agent loop)" \
      --body-file "$L/pr-body.md" > "$RUN_DIR/pr" 2>>"$RUN_DIR/log" \
      && ev artifact kind=pr url="$(cat "$RUN_DIR/pr")" || rm -f "$RUN_DIR/pr"
  fi
}

run_role() {  # with rate-limit waits; a waited round does not count
  local n=$1 role=$2 model=$3 tries=0 rc
  while :; do
    local pre; pre=$(git rev-parse HEAD)
    round "$n" "$role" "$model"; rc=$?
    if [ $rc -eq 2 ]; then
      tries=$((tries + 1)); local wait=$(( DEADLINE_S - $(now) )); [ $wait -gt 1200 ] && wait=1200
      ev needs kind=wait text="usage limit, waiting ${wait}s"; log "usage limit, waiting ${wait}s"
      git reset -q --hard "$pre"; [ $wait -le 60 ] || [ $tries -ge 12 ] && return 1
      sleep "$wait"; continue
    fi
    local hits; hits=$(fenced_hits "$pre")
    if [ -n "$hits" ]; then
      log "round $n touched fenced paths, reverted: $hits"; git reset -q --hard "$pre"
      ev needs kind=fence text="round $n wanted to change fenced files: $(echo $hits | tr '\n' ' ')"
      printf '\n- (round %s) wanted to change fenced files, reverted: %s\n' "$n" "$(echo $hits)" >> "$RUN_DIR/owner-notes"
    fi
    git status --porcelain | grep -q . && { git add -A; git commit -q -m "$role: round $n" ; }
    [ $rc -eq 3 ] && { HARD=$((HARD + 1)); return 3; }
    HARD=0; return $rc
  done
}

ev run.start goal="laneboard runs plan, $NAME" plan="$PLAN_DIR/README.md" deadline="$DEADLINE" \
  rounds="$MAX_ROUNDS" pause5h="$PAUSE_5H" stop7d="$STOP_7D" branch="$BRANCH"
log "start $NAME on $BRANCH, deadline $DEADLINE"
check

n=$(ls "$RUN_DIR/rounds" | wc -l)
if [ ! -f "$PLAN_DIR/PROGRESS.md" ]; then
  n=$((n + 1)); run_role $n planner "$MODEL_BUILD"
  [ "$HARD" -gt 0 ] && { ev run.stop reason=error rounds="$n"; log "end: the planner session did not run"; exit 1; }
  push
fi

STOP="" since_review=0 stale=0 fixes=0 researched=0 since_research=9 designed=0 since_design=9
# screenshots the builders took since the last designer review (README §7: after UI tasks)
new_shots() { find "$RUN_DIR/shots" -name '*.png' ${LAST_DESIGN:+-newer "$LAST_DESIGN"} 2>/dev/null | head -1; }
LAST_DESIGN=""
while :; do
  [ -f "$RUN_DIR/STOP" ] && { STOP=human; break; }
  [ "$(now)" -ge "$FINAL_S" ] && { STOP=deadline; break; }
  [ "$n" -ge "$MAX_ROUNDS" ] && { STOP=rounds; break; }
  # Usage brakes, from the real windows: never into paid overage, stop at the 7 d line, sleep out a full 5 h window.
  [ "$OVERAGE" = 1 ] && { STOP=overage; log "the account went into extra usage: stopping"; break; }
  [ "$U7" -ge "$STOP_7D" ] && { STOP=7d-window; log "7 d window at $U7 %: stopping"; break; }
  if [ "$U5" -ge "$PAUSE_5H" ]; then
    wake=$(( R5 > 0 ? R5 + 60 : $(now) + 1800 )); [ $wake -gt $FINAL_S ] && wake=$FINAL_S
    ev needs kind=wait text="5 h window at $U5 %, sleeping until $(TZ=$TZ_RUN date -d @$wake +%H:%M)"
    log "5 h window at $U5 %, sleeping until $(TZ=$TZ_RUN date -d @$wake +%H:%M)"
    sleep $(( wake > $(now) ? wake - $(now) : 0 )); U5=0; continue
  fi
  [ "$(tasks_open)" -eq 0 ] && [ -f "$PLAN_DIR/PROGRESS.md" ] && { STOP=done; break; }

  if [ "$TESTS_OK" = 0 ]; then role=fix; fixes=$((fixes + 1))
    [ $fixes -gt 2 ] && { STOP=no-progress; log "tests red after 2 fix rounds"; break; }
  elif [ "$(questions_open)" -gt 0 ] && [ $researched -lt "$RESEARCH_MAX" ] && [ $since_research -ge 2 ]; then role=research
  elif [ $since_review -ge "$REVIEW_EVERY" ]; then role=review-stranger
  elif [ $designed -lt 3 ] && [ $since_design -ge 3 ] && [ -n "$(new_shots)" ]; then role=review-designer
  else role=builder; fi

  model=$MODEL_BUILD; case $role in review-stranger|triage|review-operator|research) model=$MODEL_REVIEW;; esac
  since_research=$((since_research + 1))
  done_before=$(tasks_done); head_before=$(git rev-parse HEAD)
  n=$((n + 1)); run_role $n $role "$model"
  [ "$HARD" -ge 2 ] && { STOP=error; log "two rounds without a session"; break; }
  check
  [ "$TESTS_OK" = 1 ] && fixes=0
  case $role in
    builder) since_review=$((since_review + 1)); since_design=$((since_design + 1))
      if [ "$(tasks_done)" -gt "$done_before" ]; then stale=0; ev round.end n=$n outcome=kept commit="$(git rev-parse --short HEAD)"
      else stale=$((stale + 1)); ev round.end n=$n outcome=no-task-done; fi
      [ $stale -ge 2 ] && { STOP=no-progress; push; break; } ;;
    research) researched=$((researched + 1)); since_research=0
      ev round.end n=$n outcome=researched open="$(questions_open)" ;;
    review-*) [ $role = review-designer ] && { touch "$RUN_DIR/designer-done"; LAST_DESIGN="$RUN_DIR/designer-done"; designed=$((designed + 1)); since_design=0; }
      [ $role = review-stranger ] && since_review=0
      ev round.end n=$n outcome=reviewed
      n=$((n + 1)); run_role $n triage "$MODEL_REVIEW"; ev round.end n=$n outcome=triaged ;;
    *) ev round.end n=$n outcome="$( [ "$TESTS_OK" = 1 ] && echo fixed || echo still-red )" ;;
  esac
  ev score name=tasks value="$(tasks_done)" better=higher max="$(( $(tasks_done) + $(tasks_open) ))"
  push
done

log "stopping: $STOP"
case $STOP in
  rounds) DETAIL="used its $MAX_ROUNDS-round budget";; deadline) DETAIL="30 min before the deadline $DEADLINE";;
  done) DETAIL="no open tasks left";; human) DETAIL="STOP file";; no-progress) DETAIL="two builder rounds without a ticked task, or tests red after two fix rounds";;
  error) DETAIL="two rounds without a session";; overage) DETAIL="the account went into extra usage";; 7d-window) DETAIL="7 d window at $U7 %";;
  *) DETAIL="";;
esac
# Say so at once: the wrap-up rounds below (operator review, report) happen in a stopped run.
ev run.stop reason="$STOP" rounds="$n" usd="$(run_total)" ${DETAIL:+detail="$DETAIL"} wrapup=true
WRAPUP=1
# The operator review and the morning report run whatever stopped the loop (unless time is gone).
if [ "$(now)" -lt "$DEADLINE_S" ] && [ "$STOP" != error ]; then
  n=$((n + 1)); run_role $n review-operator "$MODEL_REVIEW"
  STOP_REASON=$STOP; n=$((n + 1)); run_role $n final "$MODEL_BUILD"
  check; push
fi
# The report's "Needs you" list becomes needs events, so the Runs view and the Inbox show it.
# It replaces what earlier stops of this run raised: those owner needs are acked first (by: loop),
# by their ts, not their place: laneboard merges a run's sources by time, so places can shift.
python3 - "$EV" <<'PY' | while IFS= read -r ts; do ev needs.ack ref="$ts" by=loop; done
import json, sys
needs, acked = [], set()
for line in open(sys.argv[1], errors="replace"):
    try: e = json.loads(line)
    except Exception: continue
    if e.get("t") == "needs": needs.append(e)
    if e.get("t") == "needs.ack": acked.add(e.get("ref"))
for i, e in enumerate(needs):
    if e.get("kind") == "owner" and e["ts"] not in acked and i not in acked: print(e["ts"])
PY
PR_URL=$(cat "$RUN_DIR/pr" 2>/dev/null)
python3 - "$PLAN_DIR/PROGRESS.md" <<'PY' | while IFS= read -r line; do ev needs kind=owner text="$line" ${PR_URL:+link="$PR_URL"}; done
import re, sys
s = open(sys.argv[1], errors="replace").read()
m = re.search(r"\*\*Needs you[^\n]*\n(.*?)(?:\n\*\*[A-Z]|\n## |\Z)", s, re.S)
for item in re.findall(r"^\d+\.\s+(.+?)(?=^\d+\.\s|\Z)", m.group(1) if m else "", re.S | re.M):
    head = re.match(r"\*\*(.+?)\*\*", item.strip())
    text = head.group(1) if head else " ".join(item.split())[:200]
    print(text.replace("\n", " ")[:300])
PY
ev run.stop reason="$STOP" rounds="$n" usd="$(run_total)" ${DETAIL:+detail="$DETAIL"}
log "end: $STOP after $n rounds, 5 h $U5 %, 7 d $U7 %, notional \$$SPENT (info only)"
