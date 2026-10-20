## ROLE: triage

Read the newest file in `docs/plans/runs/reviews/`. For each finding:
- a bug or a clear gap against the plan → a new task in PROGRESS.md (after the current open ones),
  with the review file named;
- an idea, a taste question or anything that changes the plan → a line under `## For the owner`.
  Never turn an idea into a task.
- already covered or wrong → drop it, with one word why, in the `## Reviews` section.
Add one line per review under `## Reviews`: file, findings, how many became tasks. Commit with
`triage: <review file>`.
