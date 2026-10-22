# Operator review, round 64

Method: copy of laneboard on port 7796 (7790 was already taken by another board), `runs.files` pointing at
this run's `run.jsonl` (362 lines, 64 rounds), read through `/api/runs`, `/api/runs/<id>` and `/api/morning`.
No browser tool, so the Runs view and Inbox were not looked at; I judged the data those views are built from.
`laneboard morning` needs a server on :7777, and `run` has no list subcommand (`run ls` is rejected).

**What was it trying to do?** Partly. Goal reads `laneboard runs plan, runs-n4`, plan
`docs/plans/runs/README.md`, branch `run/runs-n4`. That is a label, not a goal: I learn the plan's file name,
not what it asks for. Missing: a goal sentence (the loop wrote a name).

**Did it get better?** Yes, with a caveat. `tests` 0.9997 → 1 (round 2, then flat); `tasks` 0 → 40 of 40.
The `tasks` max grew 12 → 19 → 21 → 26 → 31 → 34 → 36 → 38 → 40 during the night as tasks were added, so
"40/40" is not the original scope. Missing: any sign that `max` moved. Also `tests` is flat at 1 from round 2,
so it says nothing about the suite growing; a test count would.

**What did it cost?** $50.96 over 63 rounds (mean about $0.81; builder rounds $0.3–0.75). 5 h peak 26 %,
far under the 90 % pause line; 7 d went 16 → 19 %. Answerable. Confusing: `/api/morning` shows lane cost
$0.08 beside the run's $50.96; the "API-equivalent" label is the only hint they measure different things.
Rounds 1 and 64 have no `round.end`, so their outcome is null.

**Why did it stop?** `reason: done`, rounds 63, usd 50.96. The loop also wrote `detail: "no open tasks left"`
and `wrapup: "true"`; the API's `stop` has only reason/rounds/usd/ts, so the readable why is lost. Round 64
(this review) started after `run.stop`: state is `stopped` but `rounds` says 64 while the stop says 63, and
Morning lists the lane as finished yet its session as `working`. A wrap-up round after a stop looks like a
contradiction.

**What needs me?** `needs` and Morning's `needsYou` are both empty. True for laneboard, but owner items live in
PROGRESS.md `## For the owner` and were not posted as needs, so the board says "nothing" regardless. The one
artifact is PR 13 with `title: null` and no state (open, merged, CI), so I cannot tell from laneboard whether
the night's work is ready to merge.

**Ranked gaps**
1. Return `run.stop` `detail`; make clear a wrap-up round after a stop is not a restart.
2. PR artifact has no title or state, and it is the thing acted on in the morning.
3. Goal is a name; docs/runs.md could tell loops to send a sentence.
4. Owner items in PROGRESS.md are not needs; the reference loop should post them.
5. A moving score `max` is invisible.
6. Run cost and lane cost in Morning are two numbers with no bridge.
7. No `run ls`/`run show` in the CLI.
