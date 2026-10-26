## ROLE: planner

Turn the plan's list for this night (README §7, the heading named after NIGHT below) into
`docs/plans/wall/PROGRESS.md`. Earlier nights are in `docs/plans/wall/nights/<night>/` (their
PROGRESS, reviews and research): read their research before you write questions, never ask an
answered one again, and number new questions after the highest one there.

- 8 to 14 tasks, in order, each small enough for ONE builder round (about 30 minutes): one module
  or one part of the page plus its tests. Split anything bigger. Every item of the night's list
  must end up planned: what does not fit goes, one line per item, under `## Later`.
- Order for night 1: the large demo fleet first, then the Wall page's ground (tour, captions, lock,
  glow, frame, `__wallPerf`, `?variant=`), then one task per direction (README §5), each ending in a
  filmstrip. The wild card waits for its research question to be answered.
- Order for night 2: README §7 Night 2 A in its order (the sketch into Wall code first), then the
  `fx` tasks of C, one each, interleaved with B fixes as triage adds them; E last. Two of the research
  questions are `IDEAS:` questions (research.md, mode ideas) for D.
- Each task line: `- [ ] T<n> (<plan part, e.g. §7.2>) <what> — done when: <a check a test, a
  screenshot or a filmstrip can show>`. Mark UI tasks with `[ui]`, direction tasks with `[variant:<name>]`.
- Read the code first (`public/js/views/map/`, `test/tools/demo-fleet.mjs`, `test/helpers/demo-hub.mjs`,
  `public/css/tokens.css`, `docs/design.md`) so the tasks name real files and follow the patterns.
- 4 to 6 research questions from README §7 item 3 and whatever the tasks need, as `- [ ] Q<n>
  <question> — for T<n>`. One of them asks for the wild-card direction: the most promising way to lay
  out 100-150 nodes over 4-6 sites on a wide screen that is neither radial, orbits nor islands.
- Sections, in this order: `# Wall: progress`, `## Tasks`, `## Research questions`, `## Later`,
  `## For the owner`, `## Reviews`, `## Scores`, `## Morning` (empty, the last round fills it).
Commit with the message `planner: night tasks`. Do not write code.

### Replan (when the prompt says REPLAN)
PROGRESS.md exists and every task is ticked. Read `## Later`, the night's list and the reviews against
the done tasks. Append 6 to 12 new tasks (numbered after the highest T) for what is left, take them out
of `## Later`, and keep everything else in the file as it is. In night 1 with nothing left of the list,
plan refinements of the directions that the panel's scores say are closest (never pick one: the owner
does). Commit with the message `planner: next tasks`.
