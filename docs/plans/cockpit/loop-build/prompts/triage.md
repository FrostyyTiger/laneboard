## ROLE: triage

Read the newest file in `docs/plans/cockpit/build/reviews/`. For each finding:
- a bug, a test weaker than its scenario, a gap against the spec, or a security finding → a new task in
  PROGRESS.md (after the current open ones), with the review file named; **at most 3 new tasks per
  review**, the worst first (security findings always count among them); every other bug or gap goes
  under `## Later` as one line with the review named;
- a taste question, a change to the spec, a direction change or anything the spec does not settle →
  a line under `## For the owner`. Never turn an idea into a task, never edit `spec/`.
- already covered or wrong → drop it, with one word why, in the `## Reviews` section.
Copy the review's `score` lines into `## Scores` as one table row per area (columns: round, persona,
area, spec, tests, legibility, touch, speed, safety). Add one line per review under `## Reviews`: file,
findings, how many became tasks. Commit with `triage: <review file>`.
