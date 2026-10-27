## ROLE: planner

Turn the night's slice (README §9, the heading named after NIGHT below, and the slice it points to in
`spec/slices.md` §3) into `docs/plans/cockpit/build/PROGRESS.md`. Earlier build nights, if any, are in
`docs/plans/cockpit/build/nights/<night>/`: read their PROGRESS, DECISIONS and morning report, never plan
a ticked task again, and number questions after the highest one there.

- **Every numbered build of the slice, in its order**, becomes one or more tasks. Each task is small
  enough for ONE builder round (about 40 minutes with its tests): one module or one part of the pane
  plus its tests. Split anything bigger: build 1 is four tasks (stand-ins.md §7 steps 1, 2, 3, 4), and a
  build that carries more than about five scenario ids is two. Expect 30 to 40 tasks; plan them all, in
  order, under `## Tasks`. README §9 says where the night may stop (its split line); nothing is moved to
  `## Later` except what the slice itself says waits (the Wall, C2's half, a fenced board change).
- **Map every scenario id** of the slice's `**Scenarios**` list (for the owner's current answers; the
  recommendations' row unless `spec/QUESTIONS.md` records another answer) to exactly one task, by the
  spec section it is written in (`grep -n '^### S-' docs/plans/cockpit/spec/*.md`). Write a table
  `## Scenario ids` (id, title, task, Playwright or node:test, `waits:` what, if slices.md §3.1 says it
  waits). Check: the table has as many rows as the slice says (73 for the recommendations), no id twice.
- Task line: `- [ ] T<n> (build <k>, <spec file §>) <what> — ids: <S-… list or none> — done when: <the
  ids' tests pass with none skipped except the listed waits; npm test green; any other check>`.
  Mark UI tasks with `[ui]` (they end with stills, and a filmstrip when something moves).
- The first task that adds Playwright also adds the harness of slices.md §2 (`e2e/playwright.config.mjs`,
  `e2e/cockpit/fixtures.mjs`, `test:cockpit`, `.gitignore`), unless an earlier task did.
- Name the board changes in fenced files (slices.md §5.1: the hub's read-proxy ALLOWLIST and
  `GET /api/fleet/runs`; the hub's `cockpit` hello field) as tasks that write a patch under
  `build/patches/`, not code.
- The done-when's documentation (`docs/cockpit.md`'s first part) and the demo (stand-ins.md §6, S-C1-36)
  are tasks too, near the end; the measured run on the real screen is one line in `## Measured on the
  real screen` (`C1: not measured yet`), not a task.
- Read the code first (`server/boot/`, `server/config/mode.mjs`, `server/modules.mjs`, `server/http.mjs`'s
  `route`, `server/boot/common.mjs`'s `upgradeHandlers`/`createServer`, `test/helpers/boot.mjs`,
  `test/helpers/demo-hub.mjs`, `test/tools/demo-fleet.mjs`, `public/js/ui/shell.js`, `public/css/tokens.css`)
  so the tasks name real files and follow the patterns.
- 0 to 3 research questions, only for facts the spec does not give (e.g. Claude Code's stream-json
  event fields as of today, if `protocols.md` §11 leaves one open).
- Create `docs/plans/cockpit/build/DECISIONS-c1.md` if missing: a title, one line on its rule (common.md),
  and the heading `## Decisions`.
- Sections, in this order: `# Cockpit build: progress`, a short notes block for every builder round,
  `## Tasks`, `## Scenario ids`, `## Research questions`, `## Later`, `## Spec fixes`, `## For the owner`,
  `## Measured on the real screen`, `## Reviews`, `## Scores`, `## Morning` (empty, the last round fills it).
Commit with the message `planner: <night> tasks`. Do not write code.

### Replan (when the prompt says REPLAN)
PROGRESS.md exists and every task is ticked or blocked. Read the slice's builds, `## Scenario ids`,
`## Later` and the reviews against the done tasks. Append up to 10 new tasks (numbered after the highest
T) for what is left of the slice: ids without a passing test first, then the done-when's other items,
then the reviews' worst findings. Keep everything else in the file as it is. Nothing of the next slice.
Commit with the message `planner: next tasks`.
