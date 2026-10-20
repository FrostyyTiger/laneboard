# Review 39: operator (round 39, run runs-n1)

Method: `node server/index.mjs` with `LANEBOARD_DB=:memory:`, an empty state dir and audit file, a config
with `runs.files: ["~/runs/runs-n1/run.jsonl"]`, port 7791 (7790 was taken by another copy, which also
showed a stale `demo` run from an earlier review). Looked at `/api/runs`, `/api/runs/runs-n1`, `laneboard
morning` and `/api/morning`. No browser on this VM, so the Runs view itself (list, run page, score charts)
was **not seen**; the answers come from the API the view reads and from the CLI. `~/runs/runs-n1/log`
and `rounds/` were read only to check what laneboard said.

Without `runs.files` the run is invisible: the loop's file is outside every lane cwd, and nothing tells the
operator that (docs/runs.md says it; the board does not).

## 1. What was it trying to do?

Answer: yes. `goal` "laneboard runs plan, runs-n1", `plan` docs/plans/runs/README.md, `branch`
run/runs-n1, deadline 2026-10-21 07:00, 40 rounds max.

Missing:
- Rounds carry **no `task`** (all 39 are `task: null`): the loop's `round.start` has `role` only. The
  timeline reads planner / builder / research / fix / review-stranger / triage with no hint which T-number
  a builder did. "What did round 22 do" (it cost $2.06, the second most expensive) is unanswerable. The
  commit sha is the only handle. A `task` in `ev()` (fenced) or the CLI's `--task` would fix it.
- The goal is a run name restated, not an objective. Nothing says "build Part A of the runs plan"; the
  operator has to open the plan file.
- `run.start` was written 3 times (restarts at 20:46 and 20:57, `rounds` 15, 15, then 40). The fold merges
  them silently, so "the budget was raised from 15 to 40 rounds" and "the loop was restarted twice" are not
  visible anywhere. Only the log shows it.

## 2. Did it get better?

Answer: partly, from the fold. `tests` 0.9997 (n 0) → 1 (n 38), 36 points; `tasks` 21 → 23 over the last
three rounds, 22 at n 38 as `prev`... the summary says `tasks` value 23, prev 22, better higher. 27 builder
rounds `kept`, 0 reverted, and each has a commit sha (cbc3c94 … 7bd3b56).

Missing:
- `tests` is a pass fraction that was 1.0 from round 2 on. It can show "not worse", not "better". The
  meaningful progress metric is `tasks`, and it has no total (23 of how many?). A score has no `max`, so
  "23" cannot be read as done or half done.
- Nothing shows what the commits changed (no files, no lines, no PR per commit). One PR (#10) is listed as
  an artifact from round 1; the other 27 kept commits all go to it, which is correct, but the count of
  commits on the PR is not shown.
- Reviews are rounds whose outcome is `reviewed`, with no finding count; "the stranger review found 6
  problems and 2 became tasks" lives in PROGRESS.md only.
- The planner (round 1) and round 39 have `outcome: null`, no `endedAt`. Round 1 looks like it never ended
  (it did: the loop does not write `round.end` for it). Only the current round should look open.

## 3. What did it cost?

Answer: yes, best answered part. `cost.usd` 24.13 over 40 `cost` events (`rounds: 40` while there are 39
rounds: the extra is a restart's duplicate), per-round `usd` (0.06 for triage up to 2.67 for round 13), 5 h
window 10 %, 7 d 11 %, `overage` false, reset time known.

Missing:
- `laneboard morning` prints a different total: "$24.27, 20.5M tokens", of which "(ended sessions) $24.12"
  and a lane row "laneboard-work $0.145 / loop". It is API-equivalent session cost, the Runs figure is the
  loop's own `cost` events; they are within 1 %, but the two numbers have no link and Morning's session
  column is a long list of session UUIDs, not names. Morning does not know the run exists (A3 is for later).
- The sessions of each round are empty (`sessions: []`, `sessionsUsd: null`): the loop writes neither
  `session` nor `cwd` (already an owner line). So cost per round comes from the loop, never from what the
  sessions actually spent.
- Wait time (two 20 min usage-limit sleeps in round 3, 27 min wall time for a round that cost $1.10) is in
  the round duration but not marked as waiting.
- The 3 `cost` event restarts: `total` restarts with the loop, so `run.stop.usd` would differ from `cost.usd`
  (documented in T9).

## 4. Why did it stop?

Answer: **not answerable, and misleading.** laneboard says `state: running`, `stop: null`. The log says
`2026-10-20 22:21:33 stopping: done`. Both are true: the loop has decided to stop (all tasks done) but is
running this last review round, and writes `run.stop` only after the round. For the operator in the
morning, once `run.stop` exists, `stop` will give the reason and `stateOf` the colour, so this is only a
live gap. What is missing:
- No "stopping after this round" state. `waiting` exists for rate limits; there is no equivalent for "the
  loop has said it will stop", so the board says running right up to the end. A `need`/`note` event of
  kind `stopping` (or `run.stop` before the last review) would show it.
- If the loop is killed (power, OOM, `kill -9`, disk gone) no `run.stop` is ever written and the run stays
  `running` forever: the list shows time since `updatedAt` but nothing calls a run with no event for an hour
  "silent" or "stuck". Part A3 "Stuck" rules are the plan for this; today the operator has to compare
  `updatedAt` to the clock by eye.
- `runs-n1.failed-1` (an earlier attempt's directory under ~/runs/) is not in the glob I configured. A
  broader glob would show it as a second run only if its `run` id differs; same id would merge two
  attempts into one run.

## 5. What needs me?

Answer: the `needs` list is empty (both `wait` needs closed at the next round). That is right by the
design: nothing asked a question.

Missing, and these are the real operator's worries:
- The things that need the owner are in PROGRESS.md "For the owner" (pick a design direction, fenced file
  for hook intake, EADDRINUSE, run.sh floats, session binding, silent CLI, scripts `sleep 1`, the stray
  state file). 10 items. **None of them is a `needs` event**, so neither the Runs view nor Inbox nor Morning
  shows any. A loop that writes owner items should also emit `needs kind=decision` with a `link` (and the
  loop's wrap-up `run.stop` should say "N items for you"). This is the biggest gap in the whole morning
  walk.
- `laneboard morning` "Needs you (1)" shows a `limit` row for session `loop` ("A `wait` need (the loop
  sleeping on a rate limit) doesn't count as n…" – the text of a source comment, truncated) that has
  nothing to do with this run's `needs`. It looks like an existing alarm reading the loop's own session
  with something the loop is doing; as written it tells the operator to act on something that needs nothing.
  It also kept a wrong time header ("since 20/10/2026, 08:22:04" at 22:22, as reviews/27 #5).
- The PR (#10) is listed as an artifact (count 1 in the list, URL on the run page) but no CI state and no
  "ready for review" signal; the plan's "PRs ready for review in Inbox" is A3.
- There is no `/api/inbox` (404); the Inbox is client-side, so I could not check what it shows for the run.
  I assume nothing (A3).

## Summary: what to fix first (for triage)

1. Owner items should become `needs` events (loop side, fenced) or at least be visible: today the run page
   can say "all clear" while 10 owner items are waiting.
2. Rounds without `task`: the timeline is role-only. `task` from `round.start` or a `--task`.
3. A "stopping" state between the loop deciding to stop and `run.stop` (live gap), and a silence rule for a
   run with no events for a long time (A3 stuck).
4. `tasks` needs a total (`max`) to read progress; `tests` stays 1.0 and says nothing.
5. The Morning block for a run (A3) plus a link between Morning's cost and the run's cost.
6. Round 1 and restarts: show `outcome` unset as "never ended" and note restarts/budget changes
   (the three `run.start`).

Not checked: the browser views (Runs list, run page, charts, Inbox), a hub, the Map.
