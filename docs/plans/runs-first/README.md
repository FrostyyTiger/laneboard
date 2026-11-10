# Runs-first plan: laneboard as the run engine's page

**Status: DRAFT (2026-11-01), plan only, no code.** Written for the owner by an agent. Read
`docs/plans/product.md` first; this plan follows its working rule (built for one, never tied to
one). Files in this folder:

| File | Holds |
| --- | --- |
| `README.md` | goal, shape, inventory (keep / change / retire), what is new, phases, open PRs |
| `engine.md` | how laneboard consumes a run engine: the adapter, the contract check, contract tests, the engine being down, writes, the cockpit |
| `gaps.md` | what laneboard needs that the engine's contract v0 lacks |
| `questions.md` | open questions for the owner, each with a recommendation |

Words: a **run** is one loop working on one goal for hours or days, possibly across several
machines. It is never called a night in anything new (existing file names keep the old word).
A **run engine** is the program that starts and drives runs. The first one is **foundry**, the
owner's private agent-loop system; laneboard knows it only through its versioned **contract**
(CLI + MCP). A **gate** is a point where a run waits for a person.

## 1. Goal

laneboard moves from lanes to **runs** as its main unit. Lanes (one machine, many worktree
sessions, launched and retired by hand) are no longer how the owner's agents work: runs are. So
laneboard becomes the page where a person **sees and decides**: which runs are going, how far
each got down its tree of work, what waits for a person, which products are ready for the next
goal. It keeps its infrastructure **Map**, which works and which the owner needs.

laneboard stays its own repo and stays generic. It talks to a run engine only through an adapter
behind an interface. foundry is the first engine; loops that write today's `run.jsonl` protocol
(`docs/runs.md`) keep working through the same interface. Open-ended work (shaping, research,
long conversations) happens in the engine's own repo, not on the page; its results reach the
page because they land in what the contract reads.

## 2. The shape after the change

| View | Answers |
| --- | --- |
| **Runs** `#/runs` (home, `g r`) | What is running, waiting or done, on which product and goal; how far down its tree; what it costs; which ones are stuck. A run page shows the tree, its checks, events, stop reason and PRs. |
| **Inbox** `#/inbox` (`g i`) | What waits for me? Gates to decide (intent, recipe, variant), questions addressed to a person, run needs, permission approvals. Decide from here. |
| **Products** `#/products` (`g p`) | Per product: is it ready for its next goal, and if not, why (open questions, unapproved intent)? Its runs, its knowledge, start a goal. |
| **Knowledge** `#/knowledge?product=<id>` (from a product) | Read-only: claims with sources and confidence, open questions, intent items, and the links between them. |
| **Map** `#/map` (`g m`) | Unchanged in spirit: what is everything running on and where is the trouble; runs hang on the rooms they use instead of lanes on builders. |
| **Morning** `#/morning` (`g o`) | Since I last looked: what finished, what waits, what got stuck, what it cost, across runs and infrastructure. |
| **Credit** `#/credit` (`g c`) | Usage windows per account, spend per run and per role. |
| **Box** `#/box` (`g x`), **Audit** `#/audit` (`g a`) | Machine and link health; who did what, now including every decision sent to an engine. |
| **Wall** `/galaxy.html` | Unchanged: the Map from three metres. Later its caption may count waiting gates. |
| **Cockpit** pane | Talk to the agent about what the page shows; it reads the same engine data and proposes decisions as confirm cards. |

Board, Packages, Diff and Archive leave the navigation (section 3). `g b` is freed; `g p` moves
from Packages to Products.

## 3. Inventory: keep, change, retire

"Behind the lanes flag" means: the code stays, registered only when `lanes.enabled` is on (a new
config key, default off once phase 6 lands; see `questions.md` Q2). Nothing is deleted in this plan.

| Area | Paths | Verdict | What happens |
| --- | --- | --- | --- |
| Lanes (model, store, collector) | `server/lanes/`, `server/collector/lanes.mjs`, `server/collector/registry.mjs` | **retire** (flag) | Lanes stop being a unit in the UI and the API's main shapes. The session collectors that other parts need stay (below). |
| Launch / retire | `server/lanes/launch.mjs`, `retire.mjs`, actions `launch` `retire` in `server/fleet/builtin-actions.mjs`, `public/js/ui/launch.js`, `server/routes/launch-caps.mjs`, CLI `launch`/`retire`, slots provider `server/providers/slots/` | **retire** (flag) | Starting work becomes `start <product> <goal>` through the engine. The actions stay registered behind the flag; the slots provider stays (`none` default). |
| Sessions, hooks, tmux, cost | `server/collector/{hooks,tmux,transcripts,statusline,ratelimits,vitals,signals}.mjs`, `deploy/hooks*` | **keep** | Sessions still exist on builders (attended work, cockpit, a run's rounds); they feed Credit, round binding (`server/runs/bind.mjs`) and approvals. |
| Board | `public/js/views/board.js`, `board-card.js`, `server/state.mjs` lane blocks | **retire** (flag) | Runs is the list. A short "Sessions" strip on a builder's Box card covers "what else is running here". |
| Inbox | `public/js/views/inbox.js`, `public/js/core/inbox-model.js`, `server/flags/*` | **change** | New group **Waiting** (engine gates and questions) on top. Keep Approvals (permission prompts) and Run needs / Run PRs. Lane groups (needs, review, paused, stale, archive, branch) go behind the flag. |
| Packages | `public/js/views/packages*.js`, `server/packages/`, `server/routes/packages.mjs`, `server/hub/packages.mjs` | **retire** (flag) | Its lane and conflict columns lose their meaning. CI on main moves to the product page (via the `ci` provider). |
| Morning | `server/morning.mjs`, `server/hub/morning.mjs`, `public/js/views/morning.js`, CLI `morning` | **change** | Built from runs, gates and infrastructure alarms instead of lanes. Window labels lose "tonight" in the UI; the API value `tonight` stays as an alias. |
| Runs | `server/runs/`, `server/collector/runs.mjs`, `server/routes/runs.mjs`, `public/js/views/runs.js`, `server/map/runs.mjs` | **change** (grows) | Becomes home and reads through the engine interface. Rows gain product, goal, engine, state from the engine's set; the run page gains the tree. The `run.jsonl` collector becomes the `jsonl` engine. |
| Credit | `server/credit.mjs`, `server/pricing.mjs`, `server/hub/credit.mjs`, `public/js/views/credit.js` | **keep** | Adds spend per run and per role when the engine reports it. |
| Box | `public/js/views/box.js`, `server/collector/health.mjs`, `server/hub/upstream.mjs` | **keep** | Adds one line per engine: contract version, last good read, up / stale / down / incompatible. |
| Audit | `server/fleet/audit.mjs`, `server/hub/audit-reconcile.mjs`, `public/js/views/audit.js` | **keep** | Engine decisions are actions like any other and land in the chain. |
| Diff | `public/js/views/diff.js`, `server/review/` | **retire** (flag) | It sent line comments to a lane's session. Engine PRs are reviewed on the forge; the run page links them. |
| Archive | `public/js/views/archive.js`, `server/lanes/archive.mjs` | **retire** (flag) | Retired lanes only. Finished runs stay on Runs (`runs.keepDays`). |
| Map | `server/map.mjs`, `server/map/`, `server/feeders/`, `public/js/views/map*.js`, `docs/map.md` | **keep** | Lane nodes and touch/conflict links go behind the flag; runs hang on the rooms the engine names (gap G6). Feeders unchanged. |
| Wall | `public/galaxy.html`, `public/wall.html`, `public/js/wall/` | **keep** | No change in this plan beyond phase 7's optional caption line. |
| Cockpit | `server/cockpit/`, `public/js/cockpit/`, `docs/cockpit/protocol.md` | **keep, extend** | Engine tools in the laneboard MCP; decisions as confirm cards (`engine.md` §6). |
| Hub / fleet | `server/hub/`, `server/fleet/`, `docs/fleet.md` | **keep** | The adapter runs on a builder; the hub sees engine data through the existing signed stream and relays decisions like other actions. The hub gains no new reach. |
| Control plane | `server/control/`, `server/fleet/dispatch.mjs`, `docs/fleet/control.md` | **keep, extend** | New `engine.*` actions. Touches the fenced core: attended session plus review (phase 4). |
| Terminals, peek | `server/terminals.mjs`, `public/js/ui/terminal.js`, `public/js/views/peek.js` | **keep** | Useful to look into a builder or a room's session; not part of the run model. |

## 4. New

- **Products and readiness** (`#/products`): one card per product from the engine's `products`:
  readiness per goal (`ready`, or `not ready` with its reasons, each reason linking to the
  question or intent item it names), its runs, its last PRs, CI on main. A **Start goal** button
  sends `start`, which only asks the engine for a recipe: the recipe then shows up in the Inbox.
- **The run tree** (run page): goal → feature → task → step, one row per node with its state, its
  check results at that level (step: lint/unit; task: acceptance; feature: journeys; release:
  suite/CI/review), a frozen mark for a frozen task, retries, and the cost below it. Folded by
  default to the level that is moving; a failing check opens its path. Events (from the contract or
  from `run.jsonl` lines with `level` and `node`) sit under the node they name. Runs without a tree
  (old loops) keep today's rounds timeline and score charts.
- **Waiting in the Inbox**: one row per gate or question, with the kind (`intent`, `recipe`,
  `variant`, `question`), product, run, age and what it blocks. Opening a row shows the item in full
  before any decision: the recipe file, the intent items with their claims, the variants with their
  previews, the question with its context. Keys: `a` approve, `x` reject (asks why), `1`-`9` pick a
  variant, `enter` answer. Every decision is a confirm card.
- **Knowledge** (read-only): claims (text, confidence, sources by reference, who wrote it), open
  questions (to whom, since when), intent items (outcome, acceptance, cited claims). Follow a link
  from an intent item to its claims and back; filter by product, kind and state. No edits on the
  page; corrections go through `answer` or through talking in the engine's repo.

## 5. Phases

Each phase fits one run (or one attended session), ends with `npm test` and
`node --test test/hygiene.test.mjs` green, ships demo data and its doc page (product.md §3).

| # | Phase | Done when |
| --- | --- | --- |
| 0 | **Engine interface + fake engine** (before the engine exists). `server/engine/` with `none`, `jsonl` (wraps today's runs collector, no behaviour change), `fake` (reads `test/fixtures/engine/v0/*.json`); version check; `GET /api/engines`, `/api/engine/<id>/{products,runs,run/<id>,waiting,knowledge/<product>}`; `test/engine-contract.test.mjs`; `docs/engines.md`. No UI change. | Contract suite passes against `fake` and `jsonl`; `GET /api/runs` answers byte-for-byte as before for jsonl runs; `none` with no config changes nothing. |
| 1 | **Runs home + run tree**, read-only, from the interface. `DEFAULT_VIEW` becomes `runs`; rows show product, goal, engine, state; run page shows the tree for engine runs. | Fake engine runs and old jsonl runs in one list; tree folds/opens as specified; screenshots per theme/width via `shoot.mjs`; no console errors. |
| 2 | **Products + readiness**, read-only. `#/products`, `g p`; product cards, reasons linking to knowledge ids. | Each fixture product renders; a `not ready` reason links to its target; empty state explains how to configure an engine. |
| 3 | **Waiting in the Inbox**, read-only. New group, full item view, no decisions yet (buttons shown disabled with "needs phase 4"). | Every fixture gate kind renders in full; Inbox count includes waiting items; Morning lists them. |
| 4 | **Decisions through the control plane** (attended, not unattended: it touches the fenced dispatcher). `engine.approve`, `engine.reject`, `engine.answer`, `engine.start`, `engine.pause`, `engine.resume`, `engine.stop`; tiers, remote-only, audit, hub relay; `foundry-cli` adapter's write path. | Each action audited with its request id; a retried envelope does not decide twice; engine down gives 503, never a queue; security review of the diff recorded. |
| 5 | **Knowledge view**, read-only. | Claims, questions, intent items and links render from fixtures; no raw source content shown; not reachable from kiosk tokens. |
| 6 | **Lanes flag**. `lanes.enabled` (default off); Board, Packages, Diff, Archive, launch/retire and lane Inbox groups registered only when on; nav and keys updated; README views table rewritten. | With the flag off no lane UI or route answers (404); with it on, today's tests pass unchanged. |
| 7 | **Map and Wall**: runs on rooms (needs gap G6), lane nodes behind the flag, Wall caption may add "N waiting". After #27 merges. | Map fixtures show runs on rooms; Wall tests from #27 still pass. |
| 8 | **Cockpit**: engine tools in the laneboard MCP, `focus` knows the open run and node, decisions as confirm cards (C6 rules). After #28 merges and after phase 4. | Fake agent scenario: "what waits for me?" lists the fixture gates; a proposed approve shows a confirm card and goes through the control plane. |
| 9 | **Real engine**: `foundry-cli` adapter against a real install; contract suite against it (`LANEBOARD_ENGINE_BIN` set). When the engine ships contract v1. | Suite green against real foundry; Box shows the engine `up` with its version. |
| 10 | **Words sweep**: "night" out of new UI text and docs (labels, help, Morning), file names unchanged; `product.md` one-liner updated if the owner agrees (Q11). | `grep -i night` on `public/` hits only existing file names and the `tonight` API alias. |

Phases 0, 2, 3 and 5 touch only new files plus small hooks into the router and Inbox model; they
can go in any order after 0. Phase 1 changes the router's home and the nav, so it waits for #28
(below).

## 6. The open PRs

| PR | What | Relation to this plan |
| --- | --- | --- |
| #28 cockpit-c1b (draft, old loop) | builds C1b: errors, new conversation, the Wall link, room/board down, the laneboard MCP server and its first tools | Lands first, as the old loop planned. Phase 8 builds on its MCP server; phases 1 and 6 change `public/js/core/router.js` and nav, which C1b may touch, so they start after #28 merges. Phase 0 can start now (new files only). |
| #27 wall-n5 (draft, old loop) | Wall galaxy work, `public/js/wall/`, `docs/wall.md`, `test/tools/demo-fleet.mjs` | Lands first. This plan touches the Wall only in phase 7. Phase 0's fixtures live in `test/fixtures/engine/`, not in `demo-fleet.mjs`. |
| #9 run-room pilot docs | `docs/config.md` section on unattended settings | No collision. Its lane-oriented settings (`budget.perLaneUsd`, `stuck.autoPause`) stay valid while lanes are on; phase 6 notes them. |
| #6 Map PSI | Map memory pressure | No collision (Map stays). |
| #4 demo mode | the frontend fed by a simulated lab | Complementary: the fake engine's fixtures should feed demo mode once #4 or its successor lands (product.md sequence item 2). |

#27 and #28 are among the last old-loop runs on this repo (the engine's own decision freezes the
old loops once their planned runs finish). Their branches keep their own file names, "night"
included. After them, laneboard's phases run as attended sessions or as runs of the new engine
(Q12).
