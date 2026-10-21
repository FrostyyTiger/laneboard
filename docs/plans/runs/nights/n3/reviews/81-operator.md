# Operator review, run runs-n3, round 81

Setup: laneboard with `runs.files = ["~/runs/runs-n3/run.jsonl"]`, in-memory DB, port 7793 (7790 was taken by
another instance showing only the `demo` run). I read `/api/runs`, `/api/runs/runs-n3` and `/api/morning`; I did
not open a browser (the designer reviews cover drawing), so this is what the views are fed. No code changed.
Ground truth: `run.jsonl` has 463 events, 80 rounds finished, round 81 (this one) running. The run was started
twice (a 40-round budget stopped `no-progress` at round 24, then restarted with 80 rounds from round 25).
Compared with round 23, the cost now folds correctly across the restart; the gaps below remain.

## 1. What was it trying to do?
**Answer: partly (unchanged since round 23).** `goal` "laneboard runs plan, runs-n3", `plan`
`docs/plans/runs/README.md`, branch `run/runs-n3`, deadline 20:00. That names the run, not the aim. Builder
rounds carry a `task` (T1..T44) in `/api/runs/<run>`, so "which task" is answerable round by round, but the task
titles are not in the data: T44 is a bare id.
Missing: a goal sentence from the loop, and a task title on `round.start`, so the timeline can say
"T44 Runs list columns" instead of "T44".

## 2. Did it get better?
**Answer: yes, with one number.** `tasks` 0 → 44 over 80 rounds, `tests` 1 → 1 (a pass ratio; flat). Rounds:
43 `kept` with a commit, 13 `reviewed`, 13 `triaged`, 4 `researched`, 3 `no-task-done`, 1 `fixed`. So the work
landed. Missing: a total for `tasks` (44 of how many? the protocol reads `score.max`, `protocol.mjs`, but the
loop never sends it, so the view cannot say "44 of 48"), and a test count: `tests` as a ratio hides that the
suite went 3117 → 3222. A commit sha is shown, not what the commit did.

## 3. What did it cost?
**Answer: yes, and the number is right.** `/api/runs` says $59.10 over 80 `cost` events, 3 % of the 5 h limit,
15 % of the 7-day. It is the sum across both starts (14.47 + 44.63). The final `run.stop` event says
`usd: 44.63` (the loop's count for the second start only), so anyone reading the raw file gets a different
total; the fold is right, the stop event is misleading.
Still open from round 23:
- Four rounds (3, 16, 18, 22) show `usd: 0`; they are the self-killed rounds, so the cost is unknown, not zero.
  The view should say "n/a", not $0.
- `/api/morning` top-level cost is **$0.08** (the lane's session cost, "API-equivalent") next to the run row at
  **$59.10**. Same night, same machine; the strip is read first.
- `/api/morning` `finished` lists `laneboard-work` with a `working` session: that is this loop, under "finished".

## 4. Why did it stop?
**Answer: the word, and this time it is enough.** `stop: {reason: "rounds", rounds: 80}` with the deadline over
5 h away and 3 % of the limit used: it ran out of rounds, not time or quota. Two things make a reader doubt it:
- The state is `stopped` while round 81 is running (the post-stop review round started 1 ms after `run.stop`),
  and the run shows `rounds: 81, maxRounds: 80`. A reader sees an over-run and a stopped run that still works.
  A round after `run.stop` should read "wrap-up", or the loop should stop after its reviews.
- The first stop (`no-progress` at round 24) is gone from the page: the second `run.start` clears `stop`. Why
  the run was restarted (the self-kill, then a fix) lives in PROGRESS.md, not in the run.
Missing: a `detail` on `run.stop` (asked in round 23) and a "restarted at round 25" mark.

## 5. What needs me?
**Answer: not reliably; the weakest of the five.**
- `/api/runs/runs-n3` carries 9 open `owner` needs, all raised at round 24 (11:46), all linked to PR #12, none
  acked. They are 57 rounds old. Since then the loop went from T7 to T44, so some are stale (the self-kill fix,
  and the "sheet.js is fenced" claim that round 79 found wrong). Nothing in the data tells me which still hold.
  The loop raises needs once, at a stop, and never refreshes them, so the night ends with the list from round 24.
- `/api/morning` `needsYou` is `[]` and the Morning run row has no needs field, so Morning says nothing waits
  while the run holds nine open needs. They show only on the run page (and the Inbox). An operator who starts at
  Morning would conclude nothing is waiting.
- All nine link to the same PR URL, so the link says nothing about what each is; the targets are prose.
  `PROGRESS.md` `## Morning` is the real answer but is stale: written at round 24, it still says "22 of 40
  rounds", T8-T12 not done, 3117 tests.

## What would have made it answerable
1. Morning's run row shows open needs (count, first text) and counts them in `needsYou`.
2. The loop re-raises its needs at the final stop and acks the ones it fixed.
3. `score.max` for `tasks`, task titles on `round.start`, `detail` on `run.stop`.
4. A round after `run.stop` is "wrap-up", not "81 of 80"; the run does not read `stopped` while it works.
5. Unknown cost is `null`; `stop.usd` is the run total.
6. The Morning strip shows the runs total, not only the lane's session cost, and does not list a working
   session under "finished".
