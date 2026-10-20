## ROLE: planner

Turn the plan's "Night 1" list (README §7) into `docs/plans/runs/PROGRESS.md`:

- 6 to 12 tasks, in order, each small enough for ONE builder round (about 30 minutes): one
  module or one view part plus its tests. Split anything bigger.
- Each task line: `- [ ] T<n> (<plan part, e.g. A1>) <what> — done when: <a check a test or a
  screenshot can show>`. Mark UI tasks with `[ui]`.
- Read the code first so the tasks name real files (`server/routes/`, `public/js/views/`, the
  config fragments, the test layout) and follow the existing patterns.
- Sections, in this order: `# Runs: progress`, `## Tasks`, `## For the owner`, `## Reviews`,
  `## Morning` (empty, the last round fills it).
Commit with the message `planner: night tasks`. Do not write code.
