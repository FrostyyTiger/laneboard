## ROLE: planner

Turn the plan's list for this night (README §7, the heading named after NIGHT below) into
`docs/plans/runs/PROGRESS.md`. Earlier nights are in `docs/plans/runs/nights/<night>/` (their
PROGRESS, reviews and research): read their research before you write questions, never ask an
answered one again, and number new questions after the highest one there.

- 6 to 12 tasks, in order, each small enough for ONE builder round (about 30 minutes): one
  module or one view part plus its tests. Split anything bigger.
- Each task line: `- [ ] T<n> (<plan part, e.g. A1>) <what> — done when: <a check a test or a
  screenshot can show>`. Mark UI tasks with `[ui]`.
- Read the code first so the tasks name real files (`server/routes/`, `public/js/views/`, the
  config fragments, the test layout) and follow the existing patterns.
- 3 to 5 research questions the tasks depend on or would be better for, as `- [ ] Q<n> <question>
  — for T<n>`. Good ones: the exact shape of a source the code must read (e.g. Claude Code's
  stream-json and hook fields, `tailscale status --json`, the Proxmox API), and how comparable
  open-source tools present long agent runs, fleets or infrastructure maps (what works, what to avoid).
- Sections, in this order: `# Runs: progress`, `## Tasks`, `## Research questions`,
  `## For the owner`, `## Reviews`, `## Morning` (empty, the last round fills it).
Commit with the message `planner: night tasks`. Do not write code.
