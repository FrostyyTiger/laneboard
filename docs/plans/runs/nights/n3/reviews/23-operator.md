# Operator review, run runs-n3, round 23

Setup: laneboard on a scratch port with `runs.files = ["~/runs/runs-n3/run.jsonl"]`, in-memory DB. Port 7790
was already taken by another instance (it only showed the `demo` runs), so I used 7791. I read the data
through `/api/runs`, `/api/runs/<run>`, `/api/morning`; I did not open a browser, so what I say about the
views is what their models are fed, not how they draw it (the designer reviews cover that). No code changed.
Ground truth: `run.jsonl` has 125 events, 22 rounds finished, round 23 (this one) in progress.

## 1. What was it trying to do?
**Answer: partly.** `goal` is "laneboard runs plan, runs-n3", `plan` is `docs/plans/runs/README.md`, branch
`run/runs-n3`. That names the run, not the aim. A morning reader learns nothing about what "done" is.
Missing: a one-sentence goal (the loop could send the plan's §1 line), and the plan as a link, not a path.

## 2. Did it get better?
**Answer: weakly.** Two scores: `tests` 1 → 1 (flat, one dip to 0.9997 in round 18 that recovered in 19) and
`tasks` 0 → 6. Rising `tasks` is the real signal, but there is no total, so "6" cannot be told from "6 of 7".
Missing: a `max`/`of` on a score (PROGRESS lists T1..T7+, so 6 of N is knowable). `tests` as a 0..1 ratio hides
that the suite grew to 3117 tests; a count would show growth. The per-round list shows `kept` + commit sha for
the 6 builder rounds that landed, which is good, but the sha is not a link and nothing shows what each commit did.

## 3. What did it cost?
**Answer: yes, mostly.** $13.85 over 22 rounds, 5 % of the 5 h limit and 13 % of the 7-day limit (all from
`usage`). It sums correctly with the 22 `cost` events. Gaps:
- Four rounds show $0 (3, 16, 18, 22; builder x3, review-stranger). A builder round that ran 4 minutes
  cannot cost nothing; the cost event is probably missing, so "$0" reads as free instead of unknown. The
  fold should give `null` and the view "n/a", not 0.
- `/api/morning` top level says spend **$0.08** (the lane's session cost, API-equivalent) while its `runs` row says
  **$13.85**. Same night, same machine. The designer (round 20) flagged the strip; it is still true. An
  operator reads the strip first and concludes the night cost nothing.
- Morning `finished` lists the lane `laneboard-work` as finished with `sessions: working`: it is the
  running loop itself (this round), not a finished thing.

## 4. Why did it stop?
**Answer: the word, not the reason.** `stop: "no-progress"`, 22 rounds of 40, about 74 minutes after start, with
the deadline (20:00) hours away and 5 % of the limit used. So it was not budget, time or limits: it stopped on
its own rule. To see why I had to read the rounds by hand: T7 was tried in round 18 (`no-task-done`), 19
(`fix`, ok), 22 (`no-task-done`), and then two no-task-done rounds in a row tripped the rule. Nothing in the
run data says that T7 was the stuck task, or what the builder said. Missing:
- the stop event's `detail` ("2 builder rounds in a row ended no-task-done on T7"); a last-N-rounds strip
  in the Morning block would also do;
- an `outcome` that explains `no-task-done` (tests red? nothing to do? blocked on the fence?). Today the same word
  covers round 3 (T1 failed, then done in round 7) and round 22, which are likely different things;
- the `wrapup: "true"` field on `run.stop` is a string, and the run `state` stays `stopped` while round 23 runs
  after the stop. Right idea (wrap-up rounds), but the page cannot say "stopped, wrap-up in progress".

## 5. What needs me?
**Answer: nothing is shown, and that is probably wrong.** `needs` is empty, the Inbox has no runs item for it,
Morning `needsYou` is empty. Yet a run that stopped on "no-progress" with a PR open and T7 undone is exactly
what I would want to see first. Also in PROGRESS "For the owner" there are real items (the fenced hub merge
`mergeMorning` drops `runs`; the design direction in `docs/design.md`), and none reached laneboard as `need` events.
Missing:
- a stop with a non-success reason should raise a need by itself (`kind: stopped`), or the loop should post
  one; today only an explicit `need` event does;
- the PR (#12) has `title: null`, so the chip is a bare number; there is no state (open, checks green?) either;
- `GET /api/inbox` is a 404 (the Inbox is built in the client from other routes), so I could not ask the
  server "what needs me" in one call. Not a bug, but the operator question has no single answer route.

## Summary of what to fix, by value
1. Stop reason with detail and a need raised for non-success stops (Q4, Q5).
2. Morning top strip should include runs (spend, finished); the contradiction is still there (Q3).
3. Unknown cost as null, not $0 (Q3).
4. A total for `tasks`-style scores, and a goal sentence (Q1, Q2).
5. Distinguish `no-task-done` causes; carry T-number and a one-line result per round (Q4).
