#!/bin/bash
# The cockpit BUILD loop (docs/plans/cockpit/README.md §9), forked from the Wall loop (docs/plans/wall/loop/,
# night 4) with the lessons of the cockpit spec loop (docs/plans/cockpit/loop/). One fresh headless Claude
# session per round; the script decides who goes next, checks, enforces the limits and pushes.
#
# Differences from the Wall loop:
# - It builds one slice of docs/plans/cockpit/spec/slices.md §3 (the night's list in README §9). Its own
#   files live in docs/plans/cockpit/build/ (PROGRESS.md, reviews/, research/, DECISIONS-c1.md, patches/),
#   so the spec night's PROGRESS.md and reviews stay as they are.
# - The fence has three kinds of line (loop-build/fenced.txt): a plain glob (any change reverts the round),
#   `~glob` (small edits only: at most SPEC_TYPO_LINES changed lines in all such files per round, for
#   typo-level spec fixes), and the package guard (package.json / package-lock.json may change only to add
#   `@playwright/test` and the `test:cockpit` script). Uncommitted and untracked files count too.
# - After `npm test` it runs the slice's acceptance tests (`npm run test:cockpit`, Playwright, once the
#   harness exists) and reports them as a score and to the next round; a red acceptance run gets a fix round.
# - The `stale` no-progress stop does not count a builder round that ended in an API or network error.
#
#   bash docs/plans/cockpit/loop-build/run.sh --name cockpit-c1 --repo ~/code/laneboard-work \
#     --base plan/cockpit-c1 --pr-base main --night "C1 night" --deadline "2026-11-01 08:00" \
#     [--max-rounds 120] [--pause-5h 90] [--stop-7d 85] [--tz Europe/Zurich]
#
# Stop it gently with `touch ~/runs/<name>/STOP` (it finishes the round and writes the report).
# Everything it knows lives in ~/runs/<name>/: run.jsonl (the run protocol), log, rounds/.
#
# Self-test of the fence (no repo, no Claude): bash run.sh --fence-test <file with one path per line>
# prints the paths the plain and `~` globs fence (the `~` ones marked), and exits.
set -uo pipefail

NAME="" REPO="" BASE="plan/cockpit-c1" PR_BASE="main" NIGHT="C1 night" DEADLINE="" MAX_ROUNDS=120 PAUSE_5H=90 STOP_7D=85 TZ_RUN="Europe/Zurich"
FENCE_TEST=""
while [ $# -gt 0 ]; do case $1 in
  --name) NAME=$2; shift 2;; --repo) REPO=$2; shift 2;; --base) BASE=$2; shift 2;; --pr-base) PR_BASE=$2; shift 2;;
  --deadline) DEADLINE=$2; shift 2;; --night) NIGHT=$2; shift 2;; --max-rounds) MAX_ROUNDS=$2; shift 2;;
  --pause-5h) PAUSE_5H=$2; shift 2;; --stop-7d) STOP_7D=$2; shift 2;; --tz) TZ_RUN=$2; shift 2;;
  --fence-test) FENCE_TEST=$2; shift 2;; *) echo "unknown $1"; exit 1;; esac; done

PLAN_DIR=docs/plans/cockpit
LOOP_REL=$PLAN_DIR/loop-build
BUILD_DIR=$PLAN_DIR/build
PROGRESS=$BUILD_DIR/PROGRESS.md
SPEC_TYPO_LINES=${SPEC_TYPO_LINES:-6}            # changed lines a round may make in `~` paths (typo-level spec fixes)

# ---------------------------------------------------------------------------------------------------
# The fence. FENCE: plain globs; SOFT: `~` globs; matched against repo-relative paths with bash's [[ == ]],
# where `*` also matches `/`.
load_fence() {  # $1: fenced.txt
  FENCE=() SOFT=()
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%%$'\r'}; [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    line=${line#"${line%%[![:space:]]*}"}; line=${line%"${line##*[![:space:]]}"}
    if [[ $line == '~'* ]]; then SOFT+=("${line#\~}"); else FENCE+=("$line"); fi
  done < "$1"
}
# fence_classify: paths on stdin → "hard <path>", "soft <path>" or nothing (free). Hard wins over soft.
fence_classify() {
  local f g kind
  while IFS= read -r f; do
    [ -n "$f" ] || continue; kind=""
    for g in "${FENCE[@]}"; do [[ $f == $g ]] && { kind=hard; break; }; done
    if [ -z "$kind" ]; then for g in "${SOFT[@]}"; do [[ $f == $g ]] && { kind=soft; break; }; done; fi
    [ -n "$kind" ] && echo "$kind $f"
  done
  return 0
}
PKG_FILES="package.json package-lock.json"
# pkg_guard <old package.json> <new package.json> <old lock> <new lock>: exit 0 when the only differences
# are @playwright/test (devDependency, any version), the `test:cockpit` script, and the lock entries that
# @playwright/test brings (playwright, playwright-core, fsevents). Prints why not, otherwise.
pkg_guard() {
  python3 - "$@" <<'PY'
import json, sys, re
def load(p):
    try: return json.load(open(p))
    except FileNotFoundError: return {}
    except Exception as e: print(f"{p}: not JSON ({e})"); sys.exit(1)
op, np_, ol, nl = (load(p) for p in sys.argv[1:5])
bad = []
def strip_pkg(d):
    d = json.loads(json.dumps(d))
    d.get("devDependencies", {}).pop("@playwright/test", None)
    if d.get("devDependencies") == {}: d.pop("devDependencies")
    d.get("scripts", {}).pop("test:cockpit", None)
    return d
if strip_pkg(op) != strip_pkg(np_):
    keys = sorted(set(op) | set(np_))
    bad.append("package.json: changes beyond @playwright/test and scripts.test:cockpit (" +
               ", ".join(k for k in keys if strip_pkg(op).get(k) != strip_pkg(np_).get(k)) + ")")
ALLOWED = re.compile(r"^(.*/)?node_modules/(@playwright/test|playwright|playwright-core|fsevents)$")
def strip_lock(d):
    d = json.loads(json.dumps(d))
    pk = d.get("packages", {})
    for k in [k for k in pk if ALLOWED.match(k)]: pk.pop(k)
    root = pk.get("", {})
    root.get("devDependencies", {}).pop("@playwright/test", None)
    if root.get("devDependencies") == {}: root.pop("devDependencies")
    d.get("dependencies", {}).pop("@playwright/test", None)  # lockfile v1/v2 compat section
    for k in [k for k in d.get("dependencies", {}) if k in ("playwright", "playwright-core", "fsevents")]:
        d["dependencies"].pop(k)
    return d
if strip_lock(ol) != strip_lock(nl):
    o, n = strip_lock(ol).get("packages", {}), strip_lock(nl).get("packages", {})
    diff = sorted(k for k in set(o) | set(n) if o.get(k) != n.get(k))[:8]
    bad.append("package-lock.json: churn beyond @playwright/test (" + (", ".join(diff) or "top-level fields") + ")")
if bad: print("; ".join(bad)); sys.exit(1)
PY
}

if [ -n "$FENCE_TEST" ]; then
  load_fence "$(dirname "$0")/fenced.txt"
  fence_classify < "$FENCE_TEST"
  exit 0
fi
# ---------------------------------------------------------------------------------------------------

[ -n "$NAME" ] && [ -n "$REPO" ] && [ -n "$DEADLINE" ] || { echo "--name, --repo and --deadline are required"; exit 1; }

BRANCH="run/$NAME"
RUN_DIR="$HOME/runs/$NAME"; export RUN_DIR   # rounds put screenshots in $RUN_DIR/shots
MODEL_BUILD=${MODEL_BUILD:-claude-opus-5-5}     # planner, builder, fix, panel, final
MODEL_REVIEW=${MODEL_REVIEW:-claude-sonnet-5-5} # research, triage
ROUND_SECS=${ROUND_SECS:-3600}                  # 60 min per round, then it is stopped (Wall night 3: 45 did not fit)
PANEL_EVERY=${PANEL_EVERY:-3}                    # builder rounds between persona reviews (with new shots)
PANEL_MAX=${PANEL_MAX:-8}                        # persona reviews per run
RESEARCH_MAX=${RESEARCH_MAX:-4}                  # research rounds per run
E2E_SECS=${E2E_SECS:-1500}                       # the acceptance run's own limit

mkdir -p "$RUN_DIR/rounds" "$RUN_DIR/shots"
# The loop runs from a frozen copy: a round cannot change the rules of the rounds after it.
if [ ! -d "$RUN_DIR/loop" ]; then cp -R "$REPO/$LOOP_REL" "$RUN_DIR/loop" || { echo "no $REPO/$LOOP_REL"; exit 1; }; fi
L="$RUN_DIR/loop"
EV="$RUN_DIR/run.jsonl"
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT
[ -f ~/.config/claude-run.env ] && . ~/.config/claude-run.env
echo $$ > "$RUN_DIR/pid"

now() { date +%s; }
at() { TZ=$TZ_RUN date -d "$1" +%s; }
DEADLINE_S=$(at "$DEADLINE") || { echo "bad --deadline"; exit 1; }; FINAL_S=$(( DEADLINE_S - 1800 ))
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

load_fence "$L/fenced.txt"
# changed_since <rev>: every path that differs from <rev> now, committed, staged, unstaged or untracked
changed_since() {
  { git diff --name-only "$1"; git ls-files --others --exclude-standard; } | sort -u
}
# fenced_hits <rev>: the paths a round may not have changed, one per line, each with why
fenced_hits() {
  local pre=$1 cls soft=() f n=0 d
  cls=$(changed_since "$pre" | fence_classify)
  grep '^hard ' <<<"$cls" | cut -c6-
  while IFS= read -r f; do [ -n "$f" ] && soft+=("$f"); done < <(grep '^soft ' <<<"$cls" | cut -c6-)
  if [ ${#soft[@]} -gt 0 ]; then
    for f in "${soft[@]}"; do
      if git cat-file -e "$pre:$f" 2>/dev/null; then
        d=$(git diff --numstat "$pre" -- "$f" | awk '{s += $1 + $2} END {print s + 0}')
      else d=999; fi   # a new file under a `~` glob is no typo fix
      n=$(( n + d ))
    done
    if [ $n -gt "$SPEC_TYPO_LINES" ]; then
      for f in "${soft[@]}"; do echo "$f (more than a typo fix: $n changed lines in ~ paths, max $SPEC_TYPO_LINES)"; done
    fi
  fi
  if changed_since "$pre" | grep -qxE 'package(-lock)?\.json'; then
    local tmp; tmp=$(mktemp -d)
    git show "$pre:package.json" > "$tmp/op" 2>/dev/null; git show "$pre:package-lock.json" > "$tmp/ol" 2>/dev/null
    local why; why=$(pkg_guard "$tmp/op" package.json "$tmp/ol" package-lock.json) || echo "package.json/package-lock.json ($why)"
    rm -rf "$tmp"
  fi
}

TESTS_OK=1 TESTS_PASS=0 TESTS_FAIL=0 TEST_TAIL="" CHECK_LOG=""
check() {  # the checker is not an agent: npm test, hygiene included
  local out; out=$(timeout 900 npm test 2>&1); local rc=$?
  TESTS_PASS=$(grep -E '^ℹ pass ' <<<"$out" | awk '{print $3}' | tail -1); TESTS_PASS=${TESTS_PASS:-0}
  TESTS_FAIL=$(grep -E '^ℹ fail ' <<<"$out" | awk '{print $3}' | tail -1); TESTS_FAIL=${TESTS_FAIL:-0}
  [ $rc -eq 0 ] && TESTS_OK=1 || TESTS_OK=0
  # The failing tests by name (node's summary after `failing tests:`, then any `✖`/`not ok` line), then
  # error lines, deduplicated; the whole output is kept in $RUN_DIR so a flake can be read later.
  TEST_TAIL=$( { sed -n '/failing tests:/,$p' <<<"$out" | head -60; grep -E '✖|^not ok' <<<"$out";
    grep -E 'Error|assert' <<<"$out"; } | awk '!seen[$0]++' | head -60)
  CHECK_LOG=""
  if [ $rc -ne 0 ]; then CHECK_LOG="$RUN_DIR/check-$(date +%m%d-%H%M%S).log"; printf '%s\n' "$out" > "$CHECK_LOG"; fi
  local total=$(( TESTS_PASS + TESTS_FAIL ))
  [ $total -gt 0 ] && ev score name=tests value="$(python3 -c "print(round($TESTS_PASS/$total,4))")" better=higher
}

# The slice's acceptance tests (slices.md §2): only once the harness exists. Not a gate for `npm test`, but
# a red run gets a fix round, and the ids with a test are the night's second score.
E2E_ON=0 E2E_OK=1 E2E_PASS=0 E2E_FAIL=0 E2E_SKIP=0 E2E_TAIL="" E2E_LOG="" IDS_TESTED=0
SLICE_IDS=$(python3 - "$PLAN_DIR/spec/slices.md" <<'PY' 2>/dev/null
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"### 3\.1 .*?\*\*Scenarios\*\*[^\n]*\n(.*?)\n\s*\n", s, re.S)
print(" ".join(sorted(set(re.findall(r"S-[A-Z0-9]+-\d+", m.group(1) if m else "")))))
PY
)
SLICE_N=$(wc -w <<<"$SLICE_IDS" | tr -d ' ')
check_e2e() {
  E2E_ON=0
  grep -q '"test:cockpit"' package.json 2>/dev/null && [ -f e2e/playwright.config.mjs ] || return 0
  E2E_ON=1
  local out; out=$(timeout "$E2E_SECS" npm run test:cockpit -- --reporter=line 2>&1); local rc=$?
  E2E_PASS=$(grep -oE '[0-9]+ passed' <<<"$out" | tail -1 | awk '{print $1}'); E2E_PASS=${E2E_PASS:-0}
  E2E_FAIL=$(grep -oE '[0-9]+ (failed|flaky|timed out)' <<<"$out" | awk '{s+=$1} END {print s+0}')
  E2E_SKIP=$(grep -oE '[0-9]+ skipped' <<<"$out" | tail -1 | awk '{print $1}'); E2E_SKIP=${E2E_SKIP:-0}
  [ $rc -eq 0 ] && E2E_OK=1 || E2E_OK=0
  [ $rc -eq 124 ] && E2E_TAIL="the acceptance run hit its ${E2E_SECS}s limit"
  [ $rc -ne 124 ] && E2E_TAIL=$(grep -E '✘|\[chromium\].*›|Error:|expect\(' <<<"$out" | awk '!seen[$0]++' | head -40)
  E2E_LOG=""
  if [ $rc -ne 0 ]; then E2E_LOG="$RUN_DIR/e2e-$(date +%m%d-%H%M%S).log"; printf '%s\n' "$out" > "$E2E_LOG"; fi
  # ids of the night's slice that have a test titled with them (Playwright under e2e/cockpit, node:test in test/)
  IDS_TESTED=$( { grep -rhoE "test\(['\"\`]S-[A-Z0-9]+-[0-9]+" e2e/cockpit 2>/dev/null;
    grep -hoE "test\(['\"\`]S-[A-Z0-9]+-[0-9]+" test/cockpit-*.test.mjs 2>/dev/null; } |
    grep -oE 'S-[A-Z0-9]+-[0-9]+' | sort -u | grep -cxF -f <(tr ' ' '\n' <<<"$SLICE_IDS") )
  local total=$(( E2E_PASS + E2E_FAIL ))
  [ $total -gt 0 ] && ev score name=cockpit.e2e value="$(python3 -c "print(round($E2E_PASS/$total,4))")" better=higher
  ev score name=cockpit.ids value="${IDS_TESTED:-0}" better=higher max="${SLICE_N:-0}"
}

count() { local c; c=$(grep -cE "$1" "$PROGRESS" 2>/dev/null); echo "${c:-0}"; }
tasks_done() { count '^- \[x\] T[0-9]'; }
# The panel's rubric: the newest review's `score <area> <criterion> <1-10>` lines become score
# events (name cockpit.<area>.<criterion>), so the Runs view can chart taste next to the tests.
scores() {
  local f; f=$(ls -t "$BUILD_DIR"/reviews/*.md 2>/dev/null | head -1); [ -n "$f" ] || return 0
  grep -oE '^score [a-z0-9-]+ [a-z]+ (10|[1-9])$' "$f" | while read -r _ v c x; do
    ev score name="cockpit.$v.$c" value="$x" better=higher max=10
  done
}
questions_open() { count '^- \[ \] Q[0-9]'; }
tasks_open() { count '^- \[ \] T[0-9]'; }
next_task() { grep -m1 -oE '^- \[ \] T[0-9]+' "$PROGRESS" 2>/dev/null | grep -oE 'T[0-9]+'; }
# the task's headline for round.start: the line after "T<n>", markdown stripped, 120 chars
task_title() { grep -m1 -E "^- \[ \] $1\b" "$PROGRESS" 2>/dev/null | sed -E "s/^- \[ \] $1[:.]? *//; s/[*\`]//g" | cut -c1-120; }
# the run's cost over every start of it (SPENT restarts with the loop; the run.stop total must not)
run_total() { python3 -c "import json,sys; print(round(sum(json.loads(l).get('usd',0) for l in open(sys.argv[1]) if '\"t\": \"cost\"' in l),2))" "$EV"; }

SPENT=0 U5=0 R5=0 U7=0 OVERAGE=0 HARD=0 ROUND_APIERR=0
# Headless Chrome a round leaves behind (film.mjs, shoot.mjs, Playwright) is reparented to init and keeps
# running; after each round no browser of ours should be left, so every Playwright Chrome whose parent is
# init goes (Wall night 3: eight of them held the VM at load 46).
reap_browsers() {
  local p; for p in $(ps -eo pid=,ppid=,args= | awk '$2==1 && $3 ~ /ms-playwright\/chromium[-_a-z]*-[0-9]+\/chrome-linux\/(chrome|headless_shell)$/ {print $1}'); do
    kill "$p" 2>/dev/null && log "reaped a leftover browser ($p)"
  done
}
# round <n> <role> <model>: one fresh session; returns 0 done, 2 rate-limited, 1 failed, 3 no session.
# Sets ROUND_APIERR=1 when the session ended in an API or network error (not the round's own fault).
round() {
  local n=$1 role=$2 model=$3 out="$RUN_DIR/rounds/$(printf %02d "$1")-$2.jsonl"
  ROUND_APIERR=0
  local prompt; prompt="$(cat "$L/prompts/common.md" "$L/prompts/$role.md")
$( [ "$role" = review-panel ] && { echo; echo "PERSONA: $PERSONA"; cat "$L/prompts/personas/$PERSONA.md"; } )

RUN: $NAME   NIGHT: $NIGHT (README §9)   ROUND: $n   ROLE: $role${PERSONA:+ ($PERSONA)}   RUN_DIR: $RUN_DIR
NOW ($TZ_RUN): $(TZ=$TZ_RUN date '+%F %H:%M')   DEADLINE: $DEADLINE
TESTS AFTER THE LAST ROUND: npm test pass $TESTS_PASS, fail $TESTS_FAIL$( [ "$E2E_ON" = 1 ] && printf '; test:cockpit pass %s, fail %s, skipped %s; slice ids with a test %s of %s' "$E2E_PASS" "$E2E_FAIL" "$E2E_SKIP" "$IDS_TESTED" "$SLICE_N" )
$( [ "$TESTS_OK" = 0 ] && printf 'FAILING TESTS (npm test):\n%s\nFULL OUTPUT: %s\n' "$TEST_TAIL" "$CHECK_LOG" )
$( [ "$E2E_ON" = 1 ] && [ "$E2E_OK" = 0 ] && printf 'FAILING ACCEPTANCE TESTS (npm run test:cockpit):\n%s\nFULL OUTPUT: %s\n' "$E2E_TAIL" "$E2E_LOG" )
REVIEWS SO FAR: $(ls "$BUILD_DIR"/reviews/ 2>/dev/null | tr '\n' ' ')
$( [ -n "${STOP_REASON:-}" ] && echo "STOP REASON: $STOP_REASON   OWNER NOTES: $RUN_DIR/owner-notes" )
$( [ -n "${REPLAN:-}" ] && echo "REPLAN: every task in PROGRESS.md is done; plan the next ones (planner.md, Replan)" )"
  # The researcher reads the open web, so it gets no shell, no git, no MCP: only files in the repo
  # and web tools. What it finds lands in a markdown file that later rounds read as data.
  local tools=()
  case $role in
    research) tools=(--restricted --strict-mcp-config --tools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch") ;;
    triage) tools=(--restricted --strict-mcp-config --tools "Read,Write,Edit,Glob,Grep") ;;
  esac
  local task="" title=""; case $role in builder|fix) task=$(next_task); [ -n "$task" ] && title=$(task_title "$task");; esac
  # its own session id, so laneboard binds the round to its session exactly
  local sid; sid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr A-Z a-z)
  ev round.start n="$n" role="$role" session="$sid" ${task:+task="$task"} ${title:+title="$title"} ${WRAPUP:+wrapup=true}
  # The prompt goes in on stdin, not argv: a round that runs `pkill -f <something the prompt names>`
  # must not match (and kill) its own session (Wall night 3).
  LANEBOARD_RUN="$NAME/$n" timeout "$ROUND_SECS" claude -p --model "$model" --session-id "$sid" \
    --permission-mode auto "${tools[@]}" \
    --output-format stream-json --verbose <<<"$prompt" > "$out" 2>&1
  local rc=$?
  reap_browsers
  read -r cost err u5 r5 u7 over limited apierr text < <(python3 - "$out" <<'PY'
import json, sys, re
cost, err, text = 0.0, 1, ""
u5 = r5 = u7 = -1; over = 0; limited = 0; apierr = 0
for line in open(sys.argv[1], errors="replace"):
    try: m = json.loads(line)
    except Exception: continue
    if m.get("type") == "rate_limit_event":   # the real subscription windows, as the session sees them
        i = m.get("rate_limit_info") or {}; w = i.get("unifiedWindows") or {}
        f, s7 = w.get("five_hour") or {}, w.get("seven_day") or {}
        if "utilization" in f: u5, r5 = round(f["utilization"] * 100), int(f.get("resetsAt") or 0)
        if "utilization" in s7: u7 = round(s7["utilization"] * 100)
        if not w and "utilization" in i:
            if i.get("rateLimitType") == "five_hour": u5, r5 = round(i["utilization"] * 100), int(i.get("resetsAt") or 0)
            if i.get("rateLimitType") == "seven_day": u7 = round(i["utilization"] * 100)
        if i.get("isUsingOverage"): over = 1
        if i.get("status") not in (None, "allowed", "allowed_warning"): limited = 1
    if m.get("type") == "result":
        cost = m.get("total_cost_usd") or 0.0
        err = 1 if m.get("is_error") else 0
        text = (m.get("result") or "").replace("\n", " ")[:200]
        if err and m.get("subtype") in ("error_during_execution",) and not text: apierr = 1
if err and re.search(r"usage limit|limit reached|rate limit", text, re.I): limited = 1
# The session died on the API or the network, not on the work (spec loop, 2026-10-27).
if err and not limited and re.search(r"API Error|overloaded|Internal server error|\b5\d\d\b|Connection error|"
                                     r"network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up",
                                     text, re.I): apierr = 1
print(f"{cost:.2f}", err, u5, r5, u7, over, limited, apierr, text or "-")
PY
)
  [ "$u5" -ge 0 ] && { U5=$u5; R5=$r5; }; [ "$u7" -ge 0 ] && U7=$u7; [ "$over" = 1 ] && OVERAGE=1
  [ "${apierr:-0}" = 1 ] && { ROUND_APIERR=1; log "round $n ended in an API/network error: $text"; }
  ev usage n="$n" fiveHourPct="$U5" sevenDayPct="$U7" fiveHourResetsAt="$R5" overage="$OVERAGE"
  # No result message at all = Claude did not run (PATH, login, crash): a hard error, not a bad round.
  # A round killed by the timeout also has no result, but Claude did run: a slow round, not a hard error.
  grep -q '"type":"result"' "$out" || { [ "$limited" = 1 ] && return 2
    [ $rc -eq 124 ] && { log "round $n timed out (no result)"; return 1; }
    # a stream that ends on an API/network error line without a result: count it as such, not as no session
    if grep -qiE 'API Error|overloaded|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up' "$out"; then
      ROUND_APIERR=1; log "round $n: API/network error before a result"; return 1; fi
    log "round $n: no session ($(head -c 200 "$out" | tr '\n' ' '))"; return 3; }
  SPENT=$(python3 -c "print(round($SPENT+${cost:-0},2))")
  ev cost n="$n" usd="${cost:-0}" total="$SPENT"
  [ "$limited" = 1 ] && return 2
  [ $rc -eq 124 ] && log "round $n timed out"
  [ "${err:-1}" = 0 ] && [ $rc -eq 0 ] && return 0 || return 1
}

# Mid-night: the work goes to backup/run/<name> (no PR there, so no CI). The PR branch is pushed
# when there is no PR yet and at the end (push_final), so the repo's CI runs once per night.
push() {
  if [ -f "$RUN_DIR/pr" ]; then
    git push -q -f origin "HEAD:refs/heads/backup/$BRANCH" 2>>"$RUN_DIR/log" || log "backup push failed"
    return
  fi
  git push -q -u origin "$BRANCH" 2>>"$RUN_DIR/log" || { log "push failed"; return; }
  if [ ! -f "$RUN_DIR/pr" ]; then
    local title="Cockpit: $NAME (build night, agent loop)"
    gh pr create --draft --base "$PR_BASE" --head "$BRANCH" --title "$title" \
      --body-file "$L/pr-body.md" > "$RUN_DIR/pr" 2>>"$RUN_DIR/log" \
      && ev artifact kind=pr url="$(cat "$RUN_DIR/pr")" title="$title" state=open \
      && printf 'open\t%s\n' "$title" > "$RUN_DIR/pr-sent" || rm -f "$RUN_DIR/pr"
  else
    pr_update
  fi
}

push_final() {
  git push -q -u origin "$BRANCH" 2>>"$RUN_DIR/log" || { log "push failed"; return; }
  git push -q -f origin "HEAD:refs/heads/backup/$BRANCH" 2>>"$RUN_DIR/log" || true
  [ -f "$RUN_DIR/pr" ] && pr_update || push
}

# The PR's title and state as GitHub has them now; the artifact is sent again when
# either changed since the last one sent ($RUN_DIR/pr-sent: "<state>\t<title>").
pr_update() {
  local url raw state title
  url=$(cat "$RUN_DIR/pr")
  raw=$(gh pr view "$url" --json title,state --jq '.state + "\t" + .title' 2>>"$RUN_DIR/log") || return 0
  case "${raw%%$'\t'*}" in OPEN) state=open;; MERGED) state=merged;; CLOSED) state=closed;; *) return 0;; esac
  title=${raw#*$'\t'}
  [ "$(printf '%s\t%s' "$state" "$title")" = "$(cat "$RUN_DIR/pr-sent" 2>/dev/null)" ] && return 0
  ev artifact kind=pr url="$url" title="$title" state="$state" \
    && printf '%s\t%s\n' "$state" "$title" > "$RUN_DIR/pr-sent"
}

run_role() {  # with rate-limit waits; a waited round does not count
  local n=$1 role=$2 model=$3 tries=0 rc
  while :; do
    local pre; pre=$(git rev-parse HEAD)
    round "$n" "$role" "$model"; rc=$?
    if [ $rc -eq 2 ]; then
      tries=$((tries + 1)); local wait=$(( DEADLINE_S - $(now) )); [ $wait -gt 1200 ] && wait=1200
      ev needs kind=wait text="usage limit, waiting ${wait}s"; log "usage limit, waiting ${wait}s"
      git reset -q --hard "$pre"; git clean -qfd; [ $wait -le 60 ] || [ $tries -ge 12 ] && return 1
      sleep "$wait"; continue
    fi
    local hits; hits=$(fenced_hits "$pre")
    if [ -n "$hits" ]; then
      log "round $n touched fenced paths, reverted: $(echo $hits)"; git reset -q --hard "$pre"; git clean -qfd
      ev needs kind=fence text="round $n wanted to change fenced files: $(echo $hits | tr '\n' ' ')"
      printf '\n- (round %s) wanted to change fenced files, reverted: %s\n' "$n" "$(echo $hits)" >> "$RUN_DIR/owner-notes"
    fi
    git status --porcelain | grep -q . && { git add -A; git commit -q -m "$role: round $n" ; }
    [ $rc -eq 3 ] && { HARD=$((HARD + 1)); return 3; }
    HARD=0; return $rc
  done
}

ev run.start goal="laneboard cockpit build, $NAME ($NIGHT)" plan="$PLAN_DIR/README.md" deadline="$DEADLINE" \
  rounds="$MAX_ROUNDS" pause5h="$PAUSE_5H" stop7d="$STOP_7D" branch="$BRANCH"
log "start $NAME on $BRANCH, deadline $DEADLINE, slice ids $SLICE_N"
check; check_e2e

n=$(ls "$RUN_DIR/rounds" | wc -l)
if [ ! -f "$PROGRESS" ]; then
  n=$((n + 1)); run_role $n planner "$MODEL_BUILD"
  [ "$HARD" -gt 0 ] && { ev run.stop reason=error rounds="$n"; log "end: the planner session did not run"; exit 1; }
  push
fi

STOP="" replans=0 stale=0 fixes=0 researched=0 since_research=9 panels=0 since_panel=0
# shots the builders made since the last persona review (stills from shoot.mjs, sheets from film.mjs)
new_films() { find "$RUN_DIR/shots" -name '*.png' ${LAST_PANEL:+-newer "$LAST_PANEL"} 2>/dev/null | head -1; }
LAST_PANEL=""
mapfile -t PERSONAS < <(grep -v '^\s*#' "$L/personas.txt" | grep -v '^\s*$')
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
  # Out of tasks: a planner round looks for builds of the night's list not planned yet. Twice at most.
  if [ "$(tasks_open)" -eq 0 ] && [ -f "$PROGRESS" ]; then
    [ $replans -ge 2 ] && { STOP=done; break; }
    replans=$((replans + 1)); n=$((n + 1)); REPLAN=1 run_role $n planner "$MODEL_BUILD"
    ev round.end n=$n outcome=replanned open="$(tasks_open)"; push
    [ "$(tasks_open)" -eq 0 ] && { STOP=done; break; }
    continue
  fi

  if [ "$TESTS_OK" = 0 ] || { [ "$E2E_ON" = 1 ] && [ "$E2E_OK" = 0 ]; }; then role=fix; fixes=$((fixes + 1))
    [ $fixes -gt 2 ] && { STOP=no-progress; log "tests red after 2 fix rounds"; break; }
  elif [ "$(questions_open)" -gt 0 ] && [ $researched -lt "$RESEARCH_MAX" ] && [ $since_research -ge 2 ]; then role=research
  elif [ $panels -lt "$PANEL_MAX" ] && [ $since_panel -ge "$PANEL_EVERY" ] && [ -n "$(new_films)" ]; then role=review-panel
  else role=builder; fi
  PERSONA=""; [ $role = review-panel ] && PERSONA=${PERSONAS[$(( panels % ${#PERSONAS[@]} ))]}

  # The panel judges taste: it runs on the build model. Research and triage on the review model.
  model=$MODEL_BUILD; case $role in triage|research) model=$MODEL_REVIEW;; esac
  since_research=$((since_research + 1))
  done_before=$(tasks_done)
  n=$((n + 1)); run_role $n $role "$model"
  [ "$HARD" -ge 2 ] && { STOP=error; log "two rounds without a session"; break; }
  check
  case $role in builder|fix) check_e2e;; esac
  [ "$TESTS_OK" = 1 ] && { [ "$E2E_ON" = 0 ] || [ "$E2E_OK" = 1 ]; } && fixes=0
  case $role in
    builder) since_panel=$((since_panel + 1))
      if [ "$(tasks_done)" -gt "$done_before" ]; then stale=0; ev round.end n=$n outcome=kept commit="$(git rev-parse --short HEAD)"
      elif [ "$ROUND_APIERR" = 1 ]; then ev round.end n=$n outcome=api-error   # not the work's fault: stale stays
      else stale=$((stale + 1)); ev round.end n=$n outcome=no-task-done; fi
      [ $stale -ge 2 ] && { STOP=no-progress; push; break; } ;;
    research) researched=$((researched + 1)); since_research=0
      ev round.end n=$n outcome=researched open="$(questions_open)" ;;
    review-panel) touch "$RUN_DIR/panel-done"; LAST_PANEL="$RUN_DIR/panel-done"; panels=$((panels + 1)); since_panel=0
      ev round.end n=$n outcome=reviewed persona="$PERSONA"
      scores
      PERSONA=""; n=$((n + 1)); run_role $n triage "$MODEL_REVIEW"; ev round.end n=$n outcome=triaged ;;
    *) ev round.end n=$n outcome="$( [ "$TESTS_OK" = 1 ] && [ "$E2E_OK" = 1 ] && echo fixed || echo still-red )" ;;
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
# Say so at once: the wrap-up round below (the report) happens in a stopped run.
ev run.stop reason="$STOP" rounds="$n" usd="$(run_total)" ${DETAIL:+detail="$DETAIL"} wrapup=true
WRAPUP=1
if [ "$(now)" -lt "$DEADLINE_S" ] && [ "$STOP" != error ]; then
  STOP_REASON=$STOP; n=$((n + 1)); run_role $n final "$MODEL_BUILD"
  check
fi
# The report's "Needs you" list becomes needs events, so the Runs view and the Inbox show it.
# It replaces what earlier stops of this run raised: those owner needs are acked first (by: loop).
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
python3 - "$PROGRESS" <<'PY' | while IFS= read -r line; do ev needs kind=owner text="$line" ${PR_URL:+link="$PR_URL"}; done
import re, sys
try: s = open(sys.argv[1], errors="replace").read()
except FileNotFoundError: s = ""
m = re.search(r"\*\*Needs you[^\n]*\n(.*?)(?:\n\*\*[A-Z]|\n## |\Z)", s, re.S)
for item in re.findall(r"^\d+\.\s+(.+?)(?=^\d+\.\s|\Z)", m.group(1) if m else "", re.S | re.M):
    head = re.match(r"\*\*(.+?)\*\*", item.strip())
    text = head.group(1) if head else " ".join(item.split())[:200]
    print(text.replace("\n", " ")[:300])
PY
push_final
ev run.stop reason="$STOP" rounds="$n" usd="$(run_total)" ${DETAIL:+detail="$DETAIL"}
log "end: $STOP after $n rounds, 5 h $U5 %, 7 d $U7 %, notional \$$SPENT (info only)"
