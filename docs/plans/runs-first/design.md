# laneboard as the cockpit for foundry runs: UX design (revision 3)

Status: the design the runs-first work was built from (2026-11-11, revision 3), kept as it was decided. What
shipped and what is still open is in `README.md` next to this file; where the two differ, `README.md` and the
feature docs in `docs/` are right. The mockups and the live data it was drawn from are kept outside the repo.
Paths: `lb/` = laneboard, `rt/` = foundry's runtime source, `fd/` = foundry.

Tags on every element: **have** = in the contract, the events or `runsBody` today · **derive** = computable from what
laneboard already loads for that screen, no extra foundry call · **laneboard fix** = foundry sends it, laneboard drops
or does not join it · **ask foundry** = a field foundry must start sending (named exactly).

## 0. The rule of this revision: calm by default, detail on request

Each screen shows **only four things** by default:
1. **where I am** (breadcrumb, one plain name, one state line),
2. **what needs me** (the red or amber callout, or nothing),
3. **the loop with the current spot** (the drawing on the run page; a glyph per row on Runs; "doing now" on Machines),
4. **one control row** (Resume · Stop, or Approve · Reject, or Pause · Stop; Stop is small and asks first).

Everything else lives in **one drawer** under the loop, closed by default, opened by **clicking a station on the loop**
(its rounds and checks: the main way into the detail), by clicking a node in Built, or by one of six detail tabs
(Built · Timeline · Usage · Recipe · Gates · Events). One drawer at a time; the × closes it; the URL could carry it
later (`#run?open=tests`). Links that were a line of text in v1 (state repo, recipe, flow, machine, the raw id) sit
behind a `⋯` menu in the head. Compared with v1 the run page above the fold has about half the boxes and numbers: no
instrument strip, no Now-working panel, no Agents table, no Decisions list, no Machine box, no Events list.

The reviewers' fixes are kept: one control row per screen, Resume filled and wide, Stop small and behind a confirm, no
fake limits or pause lines, grey history, the step word next to the glyph, plain words in the UI (the "ask foundry" tags
live only here; the UI shows a hatched **not reported yet** chip and never an invented number).

## 1. The owner's wishes, the answer in one line each

| # | He said | The answer |
| --- | --- | --- |
| 1 | know where I am | two tabs (Runs, Machines); Runs stays lit on a run page; one breadcrumb; **one plain name per run** (`Acme Shop · build #2`, goal title under it); the raw id and the links behind `⋯` |
| 2 | where it is in the loop | **the loop, drawn**: foundry's real loop as an SVG with the three nested levels and their back-edges, the current station lit, the block as a red stop with the reason and Resume next to it; a mini loop per node in Built; a loop glyph per row on Runs |
| 3 | what it works on now | the callout under the loop: `Now · test-writer · large · round 1 on F1 · 6.7 min` or `Stopped at Tests`; Machines says it per room |
| 4 | what is built | the **Built** drawer: the tree with a mini loop per node; a node click opens its rounds and checks |
| 5 | instruments | the **Usage** drawer (cost, time, rounds, windows, by role, by tier) and the **Timeline** drawer (a swimlane per role, gates and checks as marks); no cap bars and no pause lines, because foundry has neither |
| 6 | controls and filters | one control row; Live · Needs you · History chips, product and kind behind `filter ⋯`; the Needs-you band on Runs |
| 7 | machines | the host drawing (foreman inside its host, rooms as pips), host cards with what each room does now, the feed behind a button |
| + | more detail, but cleaner | the detail exists (round log, checks, timeline, usage, recipe, gates, events) and stays hidden until asked for |

## 2. Information architecture

```
Runs (home, #/runs) ──row──▶ Run (#/runs?run=…) ──station / node / tab──▶ the drawer (same page)
   │  Needs you band ──Open──▶ Run                 └── ⋯ menu ──▶ state repo · recipe · Flow · Machines
   └─ status line "on steady" ──▶ Machines (#/machines) ──room──▶ Run
```

Tabs: Runs and Machines; Runs stays lit on a run page. Breadcrumb: desktop `Runs › Acme Shop › build #2 · 11 Nov`, phone
`‹ Runs · Acme Shop build #2`. The Inbox keeps the product questions; the Runs status line counts them and links there.

### 2.1 One plain name per run (derive, on the server; unchanged from revision 2)
`R-20261111-acme-shop-2` reads **Acme Shop · build #2** with the goal title under it: `products[].title` (`runsBody` already
reads `products`, so it adds `productTitle`), `recipe.kind` + the `-<n>` suffix, `goalTitle` joined on the run route
(`lb/contract.mjs:187` sets it `null`; fallback the tree's goal title, then `goal G1`).

## 3. Screen: Runs (home)

Purpose: is anything waiting for me, is the foreman alive, what runs now; history out of the way.

| Element | Shows | Source | Tag |
| --- | --- | --- | --- |
| **status line** (one line, replaces the six tiles) | `■ 1 needs you · ● foreman up · beat 1 s ago · on steady · 1 on now · queue 0 · $2.13 today · 5 h unknown · 7 d unknown · 15 questions` | `runs[].waiting`, `blocked`; `health.foreman/beatAge/hosts/active/queue/windows`; spend = sum of `usage.usd` by `startedAt` (by run start, approximate); questions = the run-less waiting items `runsBody` skips | have · derive |
| **Needs you band** | the block card (`■ BLOCKED · F1 · Tests`, What is wrong = `row.reason`, Resume filled · Stop small · Open) and gate cards (`▲ kind · rev · Approve · Reject`) | `row.reason` (#48), `runs[].waiting[]` | have |
| **chips** | Live · Needs you · History; `filter ⋯` reveals product and kind | `runsBody` | derive |
| **row** | state mark · **name** (`Acme Shop · build #2`), second line goal title · day · `2 rounds` · host; **loop glyph + word** (`Tests · F1`); ago; cost. History rows grey, the stop word in text, a 2 px red hairline for `errors` | `state`, `stop`, `node`, `reason`, `rooms[]`, `updatedAt`, `usage.usd`; rounds on live rows from `?detail=live` (§7 step 2) | have · derive |

The loop glyph: seven dots (Plan · Recipe · Tests · Build · Check · Review · PR) on a line, the lit dot from the
reason's step word or the node depth, two small arcs under Build→Check for the fixer and blame back-edges with their
count when it is more than 0 (live rows, from the read cache). Done: all dots filled; stopped: the last dot hollow and
the stop word. Every kind gets the same glyph width; the word carries the meaning on the phone (dots hidden).

## 4. Screen: Run (the cockpit for one run)

Layout at 1440: breadcrumb · head (name, goal title, state line; `⋯` menu right) · **the loop** (drawing, callout with
the control row) · detail tabs · the drawer (closed). At 390: the same order, the drawing in its tall layout, the control
row as the sticky bottom bar, the callout without buttons.

### 4.1 Head

| Element | Source | Tag |
| --- | --- | --- |
| `Acme Shop · build #2`, goal title | names (§2.1) | derive |
| state line `■ BLOCKED · F1 · Tests · since 17:40 · 10 min · started 17:23 · $2.13 · on steady`; `since` = the last `run.state` event, the one "since" on the page | `state`, `reason`, events, `startedAt`, `usage.usd`, `rooms[].host` | have |
| `⋯` menu: state repo ↗, recipe rev 1 ↗, flow of the goal, machine · steady · local-acme-shop-2, the raw key and event count | `url`, `recipe.url`, `rooms[]`, `key`, `lastSeq` | have |

### 4.2 The loop, drawn

Foundry's loop from `fd/docs/how-it-works.md` ("How one build run goes"), `work-tree.md`, `suite-room.md`,
`run-end.md`, `toolbox/patterns/build-until-green.md` and `docs/pictures/map-run.svg`, redrawn in the mono style:

```
run lane:      [Plan] → [Recipe ▲] ──approved──┐          [Suite · CI] → [Review] → [PR · merge ▲] → [Report]
                                   ○ install ✓ │               ▲ all features green   ┆ red → blame
per feature:   ┌───────────────────────────────▼──────────────────────────────────────┆──────┐
               │ [Tests] → ┌ per task ───────────────────┐ → [Feature check] → [Review] → [Merge] │
               │           │ [Build] → [Task check] ─green─┘        ┆ red       ▲ findings → tasks │
               │           │             ▲ again ┆ red             ▼           │ (check again)     │
               │           │            [Fixer n/4] ◀── reopens ── [Blame]  ◀───┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄─┘
```

Fourteen stations, two dashed frames (per feature, per task inside it), grey edges for the forward path and dashed red
edges for every back-edge (task check red → fixer → check again; feature check red → blame → reopens the task; review
findings → tasks → check again; suite red → blame → reopen). Done stations carry ✓, the current one ● with a pulsing ring
(only while the run is live, none under `prefers-reduced-motion`), a blocked one ■ in red with a red ring, an open gate
▲ in amber. The way-mark ○ on the approved edge shows the goal's setup checks (`install ✓`). Two layouts from one
model: wide (1260×352 viewBox) at ≥ 721 px, tall (358×800, one column, back-edge boxes to the right) on the phone.
Every station is a button: it opens the drawer with that station's rounds and checks.

The **callout** under the drawing is the one place that says what needs me, with the one control row:
`■ Stopped at Tests · F1 · test writer · since 17:40 · 10 min` · **What is wrong**: the first sentence of the reason
(`full text` opens the station drawer) · `Nothing to approve. Fix the cause, then Resume: F1 becomes ready and the
foreman retries tests.` · **Resume** (filled) · Stop (small, confirm in place). Running: `● Now · test-writer · large ·
round 1 on F1 · 6.7 min so far` · Pause · Stop. At a gate: `▲ recipe waits for you` · Approve · Reject. Done: Start again.
The whole loop box takes a red frame while blocked (the Needs-you convention), amber at a gate.

#### Every loop element and where it comes from

| Element | Rule today | Source | Tag |
| --- | --- | --- | --- |
| Plan done / current | a `decomposer` `round.end` `result: ok` / an open decomposer round; sub `1 feature, 2 tasks` | `round.start/end` role, tree | derive |
| Recipe done / open | `gates[kind=recipe].decided.decision = approved` / run `waiting-approval`; sub `owner · 17:29` | `gates[]`, `state` | have |
| way-mark `install ✓` | goal-level `check` events that are not `tree format`, `suite`, `ci` | `check` events | derive |
| **focus feature** (the one the loop shows) | the feature named in `reason`, else a `blocked` one, else one with an open round, else the least advanced in tree order | `reason`, tree, events | derive · exact with `phase` |
| Tests done / current / **blocked** | a `test-writer` `round.end ok` on it, or a task left `planned` / an open test-writer round / `reason` says `(tests)` and the feature is `blocked`; sub `F1 round 1 blocked` | `round.*`, `node.state`, `reason` (the step id in parentheses, rt/foreman.ts:509-519) | derive · **ask foundry: `phase` on tree nodes** (agreed, not shipped; `x.phase`, rt/reads.ts:101) |
| Build | focus task `building` or an open builder round / all tasks `frozen`; sub `0 of 2 tasks` | tree, `round.start` | derive |
| Task check | a task `checking`; sub `n green · m red` from task-level checks | `node.state`, `check level: task` | derive |
| **Fixer n/4** | n = fixer `round.end` on the focus task; **4 is the pattern default** `task_rounds` (build-until-green.md), one tier up after 2 (`escalate_after`); the recipe can set another value | `round.end role=fixer`; the cap: pattern doc | derive · **ask foundry: the recipe's `task_rounds` / `escalate_after` on the row** (today the UI says "of 4" with "pattern default" in the station text) |
| Feature check | last feature-level `check` that is not the test writer's done-check (`acceptance tests written …`) | `check level: feature` | derive |
| **Blame n** | blame `round.end` count; open blame round = current | `round.*` role `blame` | derive |
| Review (feature / whole run) | reviewer rounds at `level: feature` / `level: goal` | `round.*` role `reviewer`, `level` | derive |
| Merge (feature) | feature `passed`; sub `0 of 1 merged` | `node.state` | derive |
| Suite · CI | run-level `check name: suite`, goal-level `suite` / `ci`; last result and time | `check` events | have |
| PR · merge ▲ | `prs[]` state, `gates[kind=merge]` open | `prs[]`, `gates[]` | have |
| Report | `report` on the run | `report` | have |
| the pulse | CSS on the current station, only while `state` is live | `state` | derive |
| the stop (red station + callout + Resume) | `isBlocked` (#48): `at-gate`, no waiting item, no open gate; the reason from `row.reason` | `state`, `waiting`, `gates`, `reason` | have |
| rounds and checks behind a station | rounds by role (plan: decomposer; tests: test-writer; build: builder; fixer; blame; reviews: reviewer by level), checks by level and name (see §4.3) | events | derive |

**Honesty notes.** The loop is drawn for `build` runs. `discover` and `explore` runs have no task loop: their recipe's
steps are the tree's features in order (rt/foreman.ts:122-127), so their drawing is a straight line of those features
(not in the mockup: no live one). Features can run in parallel (`recipe.parallel`); the drawing follows the focus
feature and the Built drawer shows every feature's own mini loop. Until `phase` arrives, `doubt` (a fixer doubting a test
→ a test-writer round in the Build step) would light **Tests** again; with `phase` the station is exact.

### 4.3 The drawer

| Panel | Opens from | Shows | Source | Tag |
| --- | --- | --- | --- | --- |
| **Station** | a click on the loop | what happens here (one or two sentences from foundry's docs) · the node it is on now (title, state, full reason) · **Rounds**: `# · role · tier · model · node · start · time · out · cache read · cost · result · check after` · **Checks**: `name · result · counts · node · at · command · time · when red: first lines · output ↗` · gates for the two gate stations | rounds from `round.start/end` (`usd`, `tokens` on the end); "check after" = the next `check` on the same node within 5 min of the round's end; `command` = the node's `check` text (`tree[].check`, have, a description); `output` link | derive · `model`: **laneboard fix** (`EVENT_SCALARS`); check `time` and `first lines`: **ask foundry** (`duration_ms`, `failure` = the first ~10 lines of the red output, on `check` events); the real command string: **ask foundry** (`command` on `check` events) |
| **Node** | a row in Built | the node's title, state, reason, planned acceptance tests, its check text, mini loop, its rounds and checks (same tables) | tree, events | have · derive |
| **Built** | tab | the tree: state · id · title · **mini loop** per node (task `build · check · fix 0/4 · frozen`; feature `tests · tasks 0/2 · check · blame 0 · review · merge`; goal `plan · recipe · features 0/1 · suite · ci · review · pr · merge`) · cost at and below; requirement chips; PRs; report | tree, `round.end usd`, `prs[]`, `report` | have · derive |
| **Timeline** | tab | a horizontal strip from `startedAt` to now: lane **run** (state ticks, `▲ recipe`, `✓ approved`, the blocked span hatched red from the `at-gate` event), lane **checks** (✓/■ with the name), **one lane per role** with a bar per round (`round 1 · F1 · 6.7 min · $1.89 · blocked`, red when blocked, bright while open), ticks every 5 min, a `now` line | events | derive |
| **Usage** | tab | Cost · Time · Rounds (cap = not reported yet) · 5 h / 7 d window (hatched unknown) · **by role** and **by tier** tables: rounds, in, out, cache read, cache write, cost, share bar | `usage`, `usage.byRole`, `byTier`, `round.start` counts; windows from `health.windows` and the run's `usage` events | have · derive · windows on `usage` events: **laneboard fix** (`CAMEL` drops the objects); the round cap: **ask foundry** `recipe.budget` |
| **Recipe** | tab | kind · rev · recipe.md ↗ · patterns · budget · round caps · parallel · gates (recipe approved · merge at the end) · stop rule; everything the row does not carry is a hatched *not reported yet* with the pattern defaults in grey text | `recipe {kind, revision, url}`, `gates[]` | have · **ask foundry: `recipe.patterns`, `recipe.budget {rounds, window_7d_share, ask_at}`, `recipe.parallel`, `recipe.stop`, and the pattern parameters it overrides (`task_rounds`, `escalate_after`, `review_cycles`) on the `runs` row** |
| **Gates** | tab | gate · for · opened · decided · by · via · took · revision | `gates[]` with `decided {decision, by, via, at}`; revision = `recipe.revision` for the recipe gate | have · **ask foundry: `gates[].revision`** (the hash the person approved; `waiting[]` has it, decided gates do not) · `why` on reject: **laneboard fix** |
| **Events** | tab | the raw stream, newest first | events | have |

### 4.4 Controls
One row, by state: blocked → **Resume** (filled) · Stop (small); paused → Resume · Stop; waiting-approval or an open
gate → Approve · Reject · Stop; running/queued → Pause · Stop; done/stopped → Start again. Stop swaps the row for
`Stop build #2? The work tree is kept.` → `Yes, stop` · `Keep running`; nothing is sent before the yes. Phone: the sticky
bar, 44 px targets, Resume two thirds wide. Sends: `resume`, `stop`, `pause`, `approve/reject --expect` (lb
`server/engine/actions.mjs:43-50`). have.

## 5. Screen: Machines

Default: the host drawing (the foreman's host as the big circle with **FOREMAN · up** inside, heartbeat ring, rooms as
pips, a red ping on a blocked room, other hosts as small circles, `mac` dashed and "not reporting"), the **Doing now**
line, and one card per host: id · role · state · `updated 1 s ago` · load (*not reported yet*) · its live rooms with the
run's name, goal and **what the room does now** (`■ waits at F1 · Tests since 17:40 · last round: test-writer large ·
6.7 min · blocked`, or the open round `builder · round 2 on T1 · 3 min`) · ended rooms as a count. The **Feed** (the
last events of live runs) is behind a button.

| Element | Source | Tag |
| --- | --- | --- |
| hosts, rooms, states | `health.hosts[]`, `runs[].rooms[]` (host, name, state, purpose) | have |
| the foreman's host | the `steady` role today | **ask foundry `health.foreman.host`** (`cfg.this_host`) |
| what a room does now | the open `round.start` or `row.reason`; between rounds nothing | derive · **ask foundry `health.now {verb, run, node, since}`** |
| load per host | nothing today | **ask foundry `health.hosts[].load {cpu_pct, mem_pct}`** |
| feed | `round.*`, `check`, `node.state`, `run.state`, `room`, `gate`, `decision` of live runs | have (one `events` call per live run when its `lastSeq` moved; §7) |

## 6. Colour and motion (unchanged)
Grey is normal; `▲` amber waits for you; `■` red is blocked, down, errors, checks red; history is grey. The accent is for
selection and the one filled primary button. Bars and glyphs are grey; no status hue without a rule behind it. Motion:
the station ring and the heartbeat tick while live, the running duration; `prefers-reduced-motion` stops the rings,
the beat, the ping and the pulses.

## 7. Build order (small, shippable, most useful first)

| Step | Ships | Server change (all in `lb/server`) | Foundry |
| --- | --- | --- | --- |
| **0. Read cache** | nothing visible; one answer shared by the Runs poll (5 s), the Map poll (15 s), the Inbox and Machines | a short read cache in `engine/adapter.mjs` (TTL ≈ 4 s per read key, `products` 60 s); `run:<id>`, `events:<id>` cached until the row's `lastSeq`/`updatedAt` moves | none |
| **1. Names, status line, Needs you, chips** | one plain name everywhere; the status line; the band (block card from `row.reason`, Resume filled, Stop behind a confirm); Live · Needs you · History, product/kind behind `filter ⋯`; grey history | `runsBody`: `productTitle`, `questions`, `blocked` (0 extra spawns); the run route joins `goalTitle`/`productTitle` | none (`isBlocked`, #48, is reused) |
| **2. The loop and the callout** | the drawing with the position from tree + events + gates (§4.2 rules), the callout with the one control row, the `⋯` menu, the row glyph for live rows | `GET /api/engines/runs?detail=live` from the cache: `{phase, nodeTitle, round, role, fixer, blame}` for live rows | **send `x.phase` and `x.acceptance` on tree nodes** (one line, rt/reads.ts:101): the station becomes exact |
| **3. The drawer: station, node, Built, Timeline** | station click → rounds and checks; Built with mini loops; the timeline | `EVENT_SCALARS` += `model`, `host`, `stop_reason`, `why`; `gate()` keeps `node` | `command`, `duration_ms`, `failure` on `check` events |
| **4. Usage, Recipe, Gates, Events** | the four tabs | `event()` maps `window_5h/7d` objects to `{usedPct, resetsAt, known}`; `runRow()` keeps `recipe.budget`, `patterns`, `parallel`, `stop` and the pattern overrides when they arrive | `recipe.{patterns, budget, parallel, stop, task_rounds, escalate_after, review_cycles}` on the row; `gates[].revision` |
| **5. `needs` waiting kind** | the block appears in the Inbox and on the phone bar through the normal path; the card keeps Resume, never Approve | `VOCAB.waitingKind += 'needs'`, `CONTENT_NEEDS.needs`, `isBlocked` looks at the items' kind | list a blocked run in `waiting` as kind `needs`; escape quotes in `needs.text` |
| **6. Machines** | the drawing, host cards with "does now", the feed button | `GET /api/engines/feed?since=` from the cache | `health.foreman.host`, `health.now`, `health.hosts[].load`; later `events --all --since` |

## 8. What to ask, and whom

**Laneboard fixes** (foundry already sends it): `model` on `round.start`; `window_5h`/`window_7d` on `usage` events;
`host` on `room` events; `stop_reason` on `run.state`; `why` on `decision`; `node` on gates; `goalTitle` and
`productTitle` joined on the run route and the list.

**Foundry: send fields you already keep** (no new logic): `x.phase` and `x.acceptance` on tree nodes (the loop's exact
station); `recipe.budget {rounds, window_7d_share, ask_at}`, `recipe.patterns`, `recipe.parallel`, `recipe.stop` and the
pattern parameters the recipe overrides (`task_rounds`, `escalate_after`, `review_cycles`) on the `runs` row;
`health.foreman.host` (`cfg.this_host`); `gates[].revision` on decided gates.

**Foundry: new, small** (this revision): on `check` events `command` (the string that ran), `duration_ms`, and
`failure` (the first lines of the red output, ≤ 10 lines) so the drawer can show a red check without opening the json;
`rounds` (the count foundry keeps as `r.rounds`) on the `runs` row for history rows' glyphs; `health.hosts[].load`.

**Foundry: contract 1.1**: list a blocked run in `waiting` as kind `needs` with `content {node, reason}` (laneboard
must accept the kind first, §7 step 5); escape quotes in `needs.text`; `health.now {verb, run, node, since}`.

**Later, nice to have**: `events --all --since` for the Machines feed; a `step` event if a live file feed is ever
wanted; a push time for the state repo; a window brake, and only then its line.

**Dropped or kept out of sight**: USD and time caps, pause and stop lines (no such rules exist); the BLOCKED-file link
(no URL); the v1 "Where it is" stepper (the loop replaces it); the instrument strip, Now working, Agents, Decisions,
Machine and Events sections as always-visible blocks (they are drawer panels now); per-row `run`/`events` calls.

## Later: the three connections (owner, 12 Nov)
laneboard is a view into foundry. It has three connections, in this order of weight:
1. **foundry**: runs, the loop, gates (the screens above).
2. **Network**: the orbits map (today's `#/map`, `docs/map.md`) kept and brought into the new look. It shows the hosts, the tailnet and rooms, and the foreman inside its host. It merges with the Machines screen.
3. **Product repos**: one per product, all with foundry's fixed knowledge layout (`requirements/REQ-<n>.md`; `discovery/claims|sources|questions/`). Only foundry repos, never other layouts.
   - Requirements screen per product: a list of id, title, status, how many claims it rests on, open questions, and which runs built it and with which PR. Its acceptance tests A-n-k show green or red from the last check.
   - A click opens the file on GitHub. laneboard does not copy the text.
   - Why more than a bare list: GitHub shows the text, and laneboard adds the link from a requirement to the runs, tests and PRs that built it.
   - This grows out of today's Knowledge view (`docs/knowledge.md`), which reads through the engine.

## The real loop must be the real deal (owner, 12 Nov)
- The loop is drawn from the run's recipe and never hand-drawn. Each pattern (`build-until-green@1` …) has one loop shape in laneboard, written straight from foundry `toolbox/patterns/<name>.md`. Its numbers come from the recipe, or the pattern defaults when the recipe sets none: `task_rounds`, `escalate_after`, `review_cycles`, `review_task_cap`, `blame_rounds`, `no_progress`.
- An unknown pattern or version gets no loop drawing, only the plain tree with a note. A wrong drawing is worse than none.
- Missing in the v2 mockup, to add for build-until-green@1:
  - a model step up after `escalate_after`
  - the test-writer "doubt" round, and a person when the same test is doubted twice
  - review findings becoming tasks (≤ cap), then acceptance tests again; a review never ends a feature
  - merge into the run branch, then acceptance tests on the merged result
  - suite jobs every 3 frozen tasks
  - the goal check's blame over frozen tasks
  - stop reasons on the exit: done, checks-red, no-progress, budget, errors, stopped-by-person
- Test: one test per pattern checks every station and edge against the pattern doc's role list.
- Ask foundry: `recipe.patterns` + parameters on the run row, and `phase` per node, so the lit station is exact and never guessed.

## Network and machines tie-in
Network (orbits map) and Machines/runs stay separate views, linked both ways:
- A host on the map shows a small badge with its live runs and rooms; a click jumps to the run.
- A run page names its host and room; a click jumps to that host on the map, centred.

## Network view: decided (owner, 12 Nov)
Direction **B, the wire** (a mockup kept outside the repo):
- the tailnet as one line with a tap per machine
- boxes in boxes: host › VM › foreman, and host › room › run with its loop spot
- events as packets on the wire
- vertical on the phone

It replaces today's constellation map (`#/map`), and it is the Machines screen too. Build it after the run page.
