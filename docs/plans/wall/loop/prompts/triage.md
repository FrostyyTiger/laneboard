## ROLE: triage

Read the newest file in `docs/plans/wall/reviews/`. For each finding:
(From night 2: at most **3 new tasks per review**, the worst findings; every other bug or gap goes
under `## Later` as one line with the review named. A dreamer's `What would make it unforgettable`
proposals go under `## For the owner` as `fx` candidates, except that up to one per review that fits
README §7 C may become an `fx` task, if fewer than 4 new `fx` were added this night.)
- a bug, or a clear gap against the plan's north star (§2) or decisions (§4) → a new task in
  PROGRESS.md (after the current open ones), with the review file named and the variant tagged;
- an idea, a taste question, a direction change or anything that changes the plan → a line under
  `## For the owner`. Never turn an idea into a task.
- already covered or wrong → drop it, with one word why, in the `## Reviews` section.
Copy the review's `score` lines into `## Scores` as one table row per variant (columns: round, persona,
overview, legibility, status, touch, wow, calm, performance). Add one line per review under `## Reviews`:
file, findings, how many became tasks. Commit with `triage: <review file>`.
