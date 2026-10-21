# Operator review, round 92

Run read: `runs-n5` (`~/runs/runs-n5/run.jsonl`, 520 events). laneboard started with
`LANEBOARD_DB=:memory: LANEBOARD_PORT=7790` and a config of `{"runs":{"files":["<that file>"]}}`
(docs/runs.md "outside any lane's cwd"). Without that config the run does not show: the file is not
under any lane. I read `/api/runs`, `/api/runs/runs-n5`, `/api/morning?window=tonight`. No browser
(`$CHROME` unset), so the Runs page, Morning and Inbox were not looked at; everything below is from the
JSON those pages draw from. Only JSON, not pixels.

## 1. What was it trying to do?
Answer: **yes, partly.** `goal` = "laneboard runs plan, runs-n5", `plan` = `docs/plans/runs/README.md`,
`branch` = `run/runs-n5`, deadline 2026-10-22 07:00, cap 100 rounds, pause at 5 h 90 %, stop at 7 d 85 %.
Missing: the goal is just the run's name repeated. It does not say "Night 5, README §7", and the page has no
one-line summary of what the night was for. The per-round `title` helps (T-numbers with a clause), but
`title` is cut at about 120 characters mid-word ("laid outside the selection brackets (+4 px), and Enter
on a"), and rounds 1, 2 and every review/triage/research round have `task: null` and no title, so 32 of 91
rounds say only a role.

## 2. Did it get better?
Answer: **only through the second score.** `tests` is 1 at every one of its 90 points (a flat line; it means
"suite passes", so it can only stay or fall). `tasks` goes 0 → 60 (`firstMax` 12, `max` 60), which is the
real progress line: 60 tasks closed. Morning shows `tests 1 → 1` and `tasks 0 → 60`. What was missing: the
test **count** (3446 per the loop header) is not a score, so I cannot see whether tests grew; and nothing
says how many tasks existed at the start, so "60" has no denominator (the 2 open `Q` questions, 1 blocked
`[!]` task are only in PROGRESS.md). Also `tasks` start is shown as 0 in Morning but `firstMax` is 12 in the
run: two different "starts".

## 3. What did it cost?
Answer: **$53.91 over 91 rounds, yes.** `cost.from = "cost"`, by role (summed from rounds): builder 45.89,
review-designer 3.15, planner 1.99, review-stranger 1.27, triage 1.10, research 0.51. Usage: 5 h window
7 %, 7 d 24 %, no overage. Missing:
- Morning's own cost block says `totalUsd 0.09` ("API-equivalent", lane `laneboard-work`), against $53.91
  for the run in the same response. A reader sees two costs for the same night and no line explaining
  that the lane one is only the live session. `sessionsUsd` is `null` and session `firstAt`/`cwd` are
  `null` for every round (the sessions were found by id only, `how:"id"`), so the per-round cost is the
  loop's number, not laneboard's own check.
- No cost per task or per kept commit; with one `usd` per round it is a sum I did myself.
- Rate-limit use at the end (5 h 7 %) is the last sample, with no peak. I cannot tell whether the night came
  near the 90 % pause.

## 4. Why did it stop?
Answer: **`stop.reason = done`, detail "no open tasks left", at 01:11 (3 h 39 min after the 21:32 start,
5 h 49 min before the deadline).** That is clear. Missing:
- The state is `stopped` while round 92 (this review, `wrapup: true`) is still running and has no end. Runs
  list says round 91 of 91 in one place, `budget.rounds: 100` in another, and Morning `rounds: 92`. Three
  round counts for one run. The wrap-up round is flagged `wrapup` but the list does not say "wrap-up
  reviews running".
- "done" is true by the loop's rule, but the PROGRESS list still has `Q21` and `Q22` open (research
  questions) and a blocked task. The stop line cannot say "tasks done; 2 questions and 1 blocked task
  left", so "no open tasks" reads cleaner than it is.

## 5. What needs me?
Answer: **the run itself: nothing in laneboard (`needs: []`), but the owner list is in PROGRESS.md
"For the owner" (about a dozen taste calls), invisible in laneboard.** Missing:
- The only item in Morning's `needsYou` is **`demo`**: a leftover run ("Make acme ready", decision "hi?",
  dated 2026-10-20) that appeared with no config pointing at it. It sits in the same list as this run's
  real needs. I did not find where it was read from (the repo's own `.laneboard/run.jsonl`, most likely,
  via the lane's cwd); in the morning that would be a false "needs you" at the top of the page.
- The loop never raised a `needs` for the owner list or the blocked T29 (`align-items: start`), so none of
  it reaches the Inbox. The protocol has `needs`; the loop does not use it.
- The only artifact is PR #15, with `title: null`, `state: null`. A night of 59 kept commits shows one PR,
  recorded in round 1 and never updated (the sandbox cannot reach GitHub's state). I cannot tell whether it
  is open, merged or what it holds. The artifact link is the only way to the work.

## Smaller things found
- Round 1 (planner) has `endedAt: null` and `outcome: null`, though round 2 started right after; the same
  for 2 rounds in all. They show as unfinished.
- Round 65 (T42) has outcome `no-task-done`, once in 91 rounds, with no `commit`; the same task was picked
  again and closed (commit 7942251). The page would show a failed builder round with no reason, and the
  `stuck` field stays `null` (rule "the same task failed twice" correctly not triggered).
- Outcome words: kept 59, reviewed 12, triaged 12, researched 4, replanned 2, no-task-done 1, null 2. The
  vocabulary is the loop's, not the protocol's; fine, but the page has to show raw text.
- Run took ~8 min per builder round on average (45.89 USD / 59 kept = $0.78 per kept round); no figure for
  it in the page, only for me by hand.

## Verdict
Of the five questions, 1 and 4 are answerable at a glance, 3 answerable with a caveat (two cost figures),
2 only by reading the second score, 5 is wrong or empty (a stale `demo` need; the real owner list is not
in laneboard). Nothing was changed.

Suggested tasks (for triage, not done here): (a) Morning says why the lane cost and the run cost differ;
(b) one round count across list, run page and Morning, with wrap-up shown as such; (c) a run with an
unreadable-by-laneboard source (stale `demo`) should say where each run was read from; (d) the loop raises a
`needs` for the "For the owner" list; (e) a score for the test count.
