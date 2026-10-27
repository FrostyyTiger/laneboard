## ROLE: triage

Read the newest file in `docs/plans/cockpit/reviews/`. For each finding:
- a gap, contradiction, vague spot or missing scenario → a new task in PROGRESS.md (after the
  current open ones), with the review file named;
- something only the owner can settle (taste, a one-way choice, a conflict with `spec-input.md`)
  → a new `Q-O<n>` in `spec/QUESTIONS.md` if it is not there yet (question, options,
  recommendation), or a line under `## For the owner` for anything about the plan or the loop;
- already covered or wrong → drop it, with one word why, in the `## Reviews` section.
Copy the review's `score` lines into `## Scores` as one table row (columns: round, persona,
concrete, complete, consistent, testable, ownerfit, simple, safe). Add one line per review under
`## Reviews`: file, findings, how many became tasks or questions. Commit with `triage: <review file>`.
