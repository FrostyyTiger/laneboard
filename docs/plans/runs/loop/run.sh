#!/bin/bash
# The runs loop (docs/plans/runs/README.md §7): one fresh headless Claude session per round, the
# script decides who goes next, checks, enforces the limits and pushes. Run it in tmux inside a
# throwaway VM:
#
#   bash docs/plans/runs/loop/run.sh --name runs-n1 --repo ~/code/laneboard-work \
#     --base plan/runs --deadline "2026-10-21 07:00" [--max-rounds 15] [--usd-cap 60] [--tz Europe/Zurich]
#
# Stop it gently with `touch ~/runs/<name>/STOP` (it finishes the round and writes the report).
# Everything it knows lives in ~/runs/<name>/: run.jsonl (the run protocol, §3 A1), log, rounds/.
set -uo pipefail

NAME="" REPO="" BASE="plan/runs" DEADLINE="" MAX_ROUNDS=15 USD_CAP=60 TZ_RUN="Europe/Zurich"
while [ $# -gt 0 ]; do case $1 in
  --name) NAME=$2; shift 2;; --repo) REPO=$2; shift 2;; --base) BASE=$2; shift 2;;
  --deadline) DEADLINE=$2; shift 2;; --max-rounds) MAX_ROUNDS=$2; shift 2;;
  --usd-cap) USD_CAP=$2; shift 2;; --tz) TZ_RUN=$2; shift 2;; *) echo "unknown $1"; exit 1;; esac; done
[ -n "$NAME" ] && [ -n "$REPO" ] && [ -n "$DEADLINE" ] || { echo "--name, --repo and --deadline are required"; exit 1; }

PLAN_DIR=docs/plans/runs
BRANCH="run/$NAME"
RUN_DIR="$HOME/runs/$NAME"
MODEL_BUILD=${MODEL_BUILD:-claude-opus-5-5}     # planner, builder, fix, designer, final
MODEL_REVIEW=${MODEL_REVIEW:-claude-sonnet-5-5} # stranger, triage, operator
ROUND_SECS=${ROUND_SECS:-2700}                  # 45 min per round, then it is stopped
ROUND_USD=${ROUND_USD:-8}                        # notional brake per round (--max-budget-usd)
REVIEW_EVERY=${REVIEW_EVERY:-4}                  # builder rounds between stranger reviews

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
for item in kv:
    k, _, v = item.partition("=")
    d[k] = float(v) if re.fullmatch(r"-?\d+(\.\d+)?", v) else v
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
tasks_done() { grep -cE '^- \[x\]' "$PLAN_DIR/PROGRESS.md" 2>/dev/null || echo 0; }
tasks_open() { grep -cE '^- \[ \]' "$PLAN_DIR/PROGRESS.md" 2>/dev/null || echo 0; }

SPENT=0
# round <n> <role> <model>: one fresh session; returns 0 done, 2 rate-limited, 1 failed
round() {
  local n=$1 role=$2 model=$3 out="$RUN_DIR/rounds/$(printf %02d "$1")-$2.jsonl"
  local prompt; prompt="$(cat "$L/prompts/common.md" "$L/prompts/$role.md")

RUN: $NAME   ROUND: $n   ROLE: $role
NOW ($TZ_RUN): $(TZ=$TZ_RUN date '+%F %H:%M')   DEADLINE: $DEADLINE
TESTS AFTER THE LAST ROUND: pass $TESTS_PASS, fail $TESTS_FAIL
$( [ "$TESTS_OK" = 0 ] && printf 'FAILING TESTS (tail):\n%s\n' "$TEST_TAIL" )
REVIEWS SO FAR: $(ls "$PLAN_DIR"/reviews/ 2>/dev/null | tr '\n' ' ')
$( [ -n "${STOP_REASON:-}" ] && echo "STOP REASON: $STOP_REASON   OWNER NOTES: $RUN_DIR/owner-notes" )"
  ev round.start n="$n" role="$role"
  LANEBOARD_RUN="$NAME/$n" timeout "$ROUND_SECS" claude -p "$prompt" --model "$model" \
    --permission-mode auto --max-budget-usd "$ROUND_USD" \
    --output-format stream-json --verbose > "$out" 2>&1
  local rc=$?
  read -r cost err text < <(python3 - "$out" <<'PY'
import json, sys
cost, err, text = 0.0, 0, ""
for line in open(sys.argv[1], errors="replace"):
    try: m = json.loads(line)
    except Exception: continue
    if m.get("type") == "result":
        cost = m.get("total_cost_usd") or 0.0
        err = 1 if m.get("is_error") else 0
        text = (m.get("result") or "").replace("\n", " ")[:200]
print(f"{cost:.2f}", err, text or "-")
PY
)
  SPENT=$(python3 -c "print(round($SPENT+${cost:-0},2))")
  ev cost n="$n" usd="${cost:-0}" total="$SPENT"
  if grep -qiE 'usage limit|rate.?limit|limit reached|429' <<<"$text$(tail -3 "$out")"; then return 2; fi
  [ $rc -eq 124 ] && log "round $n timed out"
  [ "${err:-1}" = 0 ] && [ $rc -eq 0 ] && return 0 || return 1
}

push() {
  git push -q origin "$BRANCH" 2>>"$RUN_DIR/log" || { log "push failed"; return; }
  if [ ! -f "$RUN_DIR/pr" ]; then
    gh pr create --draft --base main --head "$BRANCH" --title "Runs: $NAME (agent loop)" \
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
    git status --porcelain | grep -q . && { git add -A; git commit -q -m "$role: round $n leftovers" ; }
    return $rc
  done
}

ev run.start goal="laneboard runs plan, $NAME" plan="$PLAN_DIR/README.md" deadline="$DEADLINE" \
  rounds="$MAX_ROUNDS" usdCap="$USD_CAP" branch="$BRANCH"
log "start $NAME on $BRANCH, deadline $DEADLINE"
check

n=$(ls "$RUN_DIR/rounds" | wc -l)
if [ ! -f "$PLAN_DIR/PROGRESS.md" ]; then
  n=$((n + 1)); run_role $n planner "$MODEL_BUILD"; push
fi

STOP="" since_review=0 stale=0 fixes=0
while :; do
  [ -f "$RUN_DIR/STOP" ] && { STOP=human; break; }
  [ "$(now)" -ge "$FINAL_S" ] && { STOP=deadline; break; }
  [ "$n" -ge "$MAX_ROUNDS" ] && { STOP=rounds; break; }
  python3 -c "import sys; sys.exit(0 if $SPENT < $USD_CAP else 1)" || { STOP=budget; break; }
  [ "$(tasks_open)" -eq 0 ] && [ -f "$PLAN_DIR/PROGRESS.md" ] && { STOP=done; break; }

  if [ "$TESTS_OK" = 0 ]; then role=fix; fixes=$((fixes + 1))
    [ $fixes -gt 2 ] && { STOP=no-progress; log "tests red after 2 fix rounds"; break; }
  elif [ $since_review -ge "$REVIEW_EVERY" ]; then role=review-stranger
  elif ls "$PLAN_DIR"/design/*.png >/dev/null 2>&1 && [ ! -f "$RUN_DIR/designer-done" ]; then role=review-designer
  else role=builder; fi

  model=$MODEL_BUILD; case $role in review-stranger|triage|review-operator) model=$MODEL_REVIEW;; esac
  done_before=$(tasks_done); head_before=$(git rev-parse HEAD)
  n=$((n + 1)); run_role $n $role "$model"
  check
  [ "$TESTS_OK" = 1 ] && fixes=0
  case $role in
    builder) since_review=$((since_review + 1))
      if [ "$(tasks_done)" -gt "$done_before" ]; then stale=0; ev round.end n=$n outcome=kept commit="$(git rev-parse --short HEAD)"
      else stale=$((stale + 1)); ev round.end n=$n outcome=no-task-done; fi
      [ $stale -ge 2 ] && { STOP=no-progress; push; break; } ;;
    review-*) [ $role = review-designer ] && touch "$RUN_DIR/designer-done"
      [ $role = review-stranger ] && since_review=0
      ev round.end n=$n outcome=reviewed
      n=$((n + 1)); run_role $n triage "$MODEL_REVIEW"; ev round.end n=$n outcome=triaged ;;
    *) ev round.end n=$n outcome="$( [ "$TESTS_OK" = 1 ] && echo fixed || echo still-red )" ;;
  esac
  ev score name=tasks value="$(tasks_done)" better=higher
  push
done

log "stopping: $STOP"
# The operator review and the morning report run whatever stopped the loop (unless time is gone).
if [ "$(now)" -lt "$DEADLINE_S" ]; then
  n=$((n + 1)); run_role $n review-operator "$MODEL_REVIEW"
  STOP_REASON=$STOP; n=$((n + 1)); run_role $n final "$MODEL_BUILD"
  check; push
fi
ev run.stop reason="$STOP" rounds="$n" usd="$SPENT"
log "end: $STOP after $n rounds, notional \$$SPENT"
