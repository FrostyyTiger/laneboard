# Review 25: operator (round 25, run runs-n2)

Method: `node server/index.mjs` with `LANEBOARD_DB=:memory:`, a throwaway config with
`runs.files: ["~/runs/runs-n2/run.jsonl"]`, empty state dir and audit file. Port 7790 was already taken by
another (stale) board, which answered `/api/runs` with an old `demo` run: the same busy-port trap as
reviews 12 and 20. I moved to 7791. No browser on this VM, so the Runs view itself was **not seen**;
the answers come from `/api/runs`, `/api/runs/runs-n2` and `/api/morning`, which are what the view
reads. `~/runs/runs-n2/log` and `rounds/` were read only to check what laneboard said. Without the
`runs.files` glob the run is invisible (its file is outside every lane cwd).

## 1. What was it trying to do?
Answer: partly. `goal` "laneboard runs plan, runs-n2", `plan` docs/plans/runs/README.md, branch
`run/runs-n2`, deadline 2026-10-21 07:00, 40 rounds max, pause at 5 h 90 %, stop at 7 d 85 %.
Missing:
- The goal is the run's name restated; "Night 2: owner's bugs, then Map 2 (feeders, Drift, Reach)" is only in
  PROGRESS.md. Nothing says which part of the plan tonight covers.
- All 25 rounds have `task: null`. The timeline reads planner / research / builder x N / fix / review-stranger
  / triage with no T-number, so "what did round 18 do" (the most expensive, $1.63) needs `git show ddd`.
  Same finding as night 1 (39-operator), still open (loop-side, fenced).
- No total for the work: the `tasks` score is 15 with no maximum, so "15 of how many" is unknowable
  from the board.

## 2. Did it get better?
Answer: yes, from the `tasks` score: 0 (n 2) -> 15 (n 24), one step per kept builder round, with
`prev` 14. 17 builder rounds `kept`, each with a commit sha; 0 reverted. `tests` stayed 1 (one dip to
0.9997 at n 7, fixed by the `fix` round 8: that is visible and reads well).
Missing:
- `tests` is a pass fraction, always ~1: it can say "not worse", never "better". The tests count
  (3088 passing) exists only in the loop's prompt, not as a score.
- Review rounds (12, 20) say `reviewed`, with no finding count; "6 findings, 2 became tasks" is in PROGRESS.md.
- Round 1 (planner) never gets a `round.end`, so it looks open forever; round 13 (n13) has a `tasks`
  score but no `tests` one (and 21, 12/22 likewise): series have holes, not an error but unexplained.
- What the commits changed (files, lines, which feature) is not shown; only shas.

## 3. What did it cost?
Answer: yes, best part. `cost.usd` 14.46 over 24 cost events, per-round usd (0.07 triage ... 1.63 builder),
5 h window 14 %, 7 d 12 %, overage false, reset time known (`fiveHourResetsAt`).
Missing:
- `sessions: []` and `sessionsUsd: null` on every round: the loop writes no `session`/`cwd`, so cost is the
  loop's own figure, never reconciled with what sessions spent.
- Morning shows "laneboard-work $0.145, session `loop`" for the window, i.e. the current session only; it
  does not know the run exists (no `runs` key in `/api/morning`, A3 not built). Two cost numbers, no link:
  $14.46 (Runs) vs $0.15 (Morning).
- Cost per kept task is not computed (about $0.85 per builder round; the operator has to divide).
- Round 25 (this one) shows `usd: null` while open: correct, but there is no "running cost so far".

## 4. Why did it stop?
Answer: **not answerable from laneboard.** The run is `state: "running"`, `stop: null`, round 25,
although the loop's own `log` already says `23:21:49 stopping: done` (all tasks ticked). No `run.stop`
event exists yet, so in the morning the board will keep saying "running" until someone looks at it
(the stop event is written after the last review round, I assume; if the process dies, never).
Missing:
- A "stopping" state (night 1 review already asked for it): between the loop deciding to stop and the
  final round ending, the board shows a healthy running run.
- A staleness signal: `updatedAt` is the only clue. A run with no event for hours (a dead loop, the VM
  gone) is indistinguishable from a run mid-round. The deadline (07:00) is shown, but not "time left"
  as a verdict.
- The stop reason vocabulary (`done|deadline|budget|...`) is documented but this run has no stop event
  to show one.

## 5. What needs me?
Answer: nothing, according to laneboard (`needs: []`, no inbox items; `/api/inbox` is a 404, so I could not
look at the Inbox data by that path). In truth PROGRESS.md "For the owner" has about 8 items (fenced boot
messages, push-to-hub auth, health route, taste calls, untriaged night 1 review).
Missing:
- The loop never emits `needs` for owner items, so the one place an operator looks says "all quiet" while
  a full list waits in a markdown file. This is the biggest gap: the question "what needs me" is answered
  wrongly with confidence.
- The one artifact (PR #11) is listed, with `title: null`, no CI state, no "ready for review" flag; the
  PR number is the only handle. Morning has `pr: null` for the lane, so it does not link the lane's branch
  to that PR either.
- Where to look next: nothing links from the run to its report/PROGRESS.md (`plan` is the README, not the
  progress file).

## Summary of gaps, by weight
1. `needs` never written for owner items (loop-side; fenced `run.sh`): board says nothing needs you.
2. No stopping / stale state; `run.stop` absent while the log says stopping.
3. `task` missing from rounds (known from night 1).
4. Morning and Inbox ignore runs (A3 not built): a second, unrelated cost figure.
5. Scores have no max; `tests` carries no information.
6. Busy port 7790 served a stale `demo` run from another board (known; fenced boot).
