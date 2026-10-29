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
- Order for night 3: README §7 Night 3's own `Order:` line. Night 2's open tasks (T31-T42 in
  `nights/night-2/PROGRESS.md`) that Night 3 names become tasks here, renumbered from T1, each naming its
  night-2 number (`was night 2's T39`); the rest of night 2's `## Later` stays under `## Later`. 3 to 4
  research questions: touch on a wall screen (gestures, hit radius, how long until the tour resumes), and
  one `IDEAS:` question about making a dead or stale feed unmistakable from 3 m.
- Order for night 4: README §7 Night 4's own `Order:` line. Night 3's open tasks (T29, T31-T41 in
  `nights/night-3/PROGRESS.md`) become tasks here, renumbered from T1, each naming its night-3 number;
  the rest of night 3's `## Later` stays under `## Later`. This night may plan up to 18 tasks: it is the
  Wall's last before the merge.
- Order for night 5: README §7 Night 5's own `Order:` line. Plan every part A-E as tasks (up to 22),
  none parked in `## Later`. Night 4's open tasks (`nights/night-4/PROGRESS.md`) stay under `## Later`,
  each naming its night-4 number; close only those this night makes moot, with the reason. Never plan a
  change to a path in `loop/fenced.txt`: such a need becomes a patch under `docs/plans/wall/patches/`.
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
