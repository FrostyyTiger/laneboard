# Section 5: The Map as the fleet-wide home screen

**Integration notes (integrator):**
- M1 (was T5.1) is the single owner of `server/map.mjs`; it also absorbs §3 H10 (`fleet` input, `tickFleet(fleet, now)`, `toMapFleet(view)`, `builderOverlay`, prefixed ids, one event per builder going down, `build({snapshot})` kept as the builder-mode entry so `server/boot/builder.mjs` is untouched) and §7 T7 (topology `builder` field; feed-linked status `worse(feedStatus, linkStatus)` with `stale→unknown`, metrics from the builder's fresh `health`, falling back to the feed guest; name fallback `guest.name === builder.id`; builders with `fleet.hubKeys` set skip feed reading, `map.feeds:false`). §5's node contract (2.1) is binding over §3 2.7.
- Client paths follow §1 F1: the code to split is `public/js/views/map-canvas.js` (becomes a re-export shim of `./map/index.js`), motion is `public/js/core/motion.js` (import `../../core/motion.js`), CSS is `public/css/views/map.css` (§1 F2). The view module is `public/js/views/map.js` (created by F1, owned by M5); there is no `map/view.js`.
- §4 T4.10 (map chrome) folded in: M3 does the palette/dot-grid/brackets/no-glass restyle and deletes the map HUD panels; M4 adds `setInsets`, `selectNext`, `focusFind`, `setOverlay` and removes the map's own `onKey`. Keys are registered by §4 D8 (authoritative map: `o`/`O`, `\`, `/`, `f`, `c`).
- Token names are §4's: `--text-1..3`, `--line`, `--line-weak`, `--bg-canvas`, `--accent`, `--p1` (crit), `--p2` (warn), `--p3` (low), `--ok`, `--font-mono`, `--font-label`, `--tex-dots`.
- Split view state is `localStorage["lb.split"]` (§4), not a `split=1` URL param. Router calls are `navigate(patch)` (§4 `core/router.js`); actions go through `act(fkey, action, args)` (§1 `core/actions.js`), tiers by name (`read|click|ask|confirm`). `peek` opens the inspector PEEK tab (§10 R12), no new endpoint. The phone sheet opens at §4's `half` snap.
- T5.6 dropped: §1 F1's frontend test already scans every `public/js/**/*.js`.
- Task ids M1-M5 match the global DAG (README.md). Private details moved to `private/05-private.md`.

## 1. Goal and scope

The Map (`#/map`, the default route per 00-conventions) becomes the one picture of the whole fleet: topology (sites, rooms, services), **builders** as first-class nodes inside the room that hosts them, their **lanes** and **sessions**, the **packages** lanes touch, and the CI runners builders use. The current motion system is kept unchanged in spirit and in code (`public/motion.js`: `damp`, `flight`, `inertia`, `stage`; beats in `relayout`, `public/map.js:418-519`; folding `public/map.js:522-549`), and so is the rule in `docs/map.md:20` and `public/map.js:9-17`: **movement is always data**, and what the user does moves it too.

In scope:
- Fleet map model (node/edge JSON contract the hub emits; builder mode emits the same shape for one builder).
- New edges: lane-lane touch, predicted/confirmed conflict, lane→package, builder→CI runner.
- Industrial restyle using §4 tokens; readout corner; corner-bracket reticle (includes §4's former T4.10 map chrome).
- Scope integration with rail (`b=`) and router (`sel=`), inspector as the single detail surface.
- Split view (`\`), minimap PiP in other views, overlays (`o`), inline lane actions through the hub relay.
- Performance budget, reduced motion, phone layout.
- Splitting `public/js/views/map-canvas.js` (today's `public/map.js`, 1547 lines, moved verbatim by §1 F1) into `public/js/views/map/*`.

Out of scope: producing conflict/touch data and CI per package (§6), hub transport and relay (§3), shell/rail/inspector/sheet components, tokens and the hotkey map (§4), confirmation-tier policy definitions (§2; consumed here).

## 2. Design

### 2.1 Model contract (`{type:"map", map}`)

Unchanged envelope (`server/map.mjs:556-561`, `GET /api/map`, `server/index.mjs:67`), extended:

```jsonc
{
  "title": "fleet",
  "generatedAt": 1800000000000,
  "error": "map.json: ...",                  // as today
  "fleet": { "builders": [{ "id": "builder-a", "code": "B1", "link": "up" }] }, // link: up|stale|down (from the §3 store conn.state: up→up, stale→stale, down/misconfigured/incompatible→down, connecting→stale)
  "nodes": [ /* see below */ ],
  "links": [ /* see below */ ],
  "events": [{ "at": 0, "node": "lane:builder-a/pay", "link": null, "kind": "attention", "text": "..." }]
}
```

**Node kinds**: `KINDS` (`server/map.mjs:24`) gains `builder`, `session`, `repo`, `package`. Topology files may not use them except `repo`/`package` never; `parseTopology` refuses ids starting `builder:`, `sess:`, `repo:`, `pkg:` as it already does `lane:` (`server/map.mjs:48`).

Every node keeps today's fields (`id, parent, kind, label, order, status, why, sub, metrics, memCache, derived, detail, href`, `server/map.mjs:425-440`) plus optional:

| field | type | on | meaning |
|---|---|---|---|
| `builder` | string | builder, lane, session | builder id; drives scope ghosting |
| `fkey` | string | lane, session | `"<builder>/<name>"` fleet key (for `sel=`, inspector, actions) |
| `flags` | `{stuck?, paused?, awaitingApproval?, reviewReady?}` | lane, session | derived flags from 00-conventions |
| `m` | `{costUsd?, ctxPct?, ageMs?, ci?}` | lane, session, package | overlay measures (numbers/strings only) |
| `counts` | `{lanes, working, waiting}` | builder | readout + label |

Concrete shapes:

```jsonc
// builder, attached under the topology room that names it
{ "id": "builder:builder-a", "kind": "builder", "parent": "agents", "builder": "builder-a",
  "label": "B1", "sub": "builder-a · 4 lanes", "status": "ok",          // link up→ok (or worst flag), stale→unknown, down→down
  "metrics": { "cpu": 0.25, "mem": 0.5, "disk": 0.4 },                   // from that builder's snapshot.vitals, as server/map.mjs:411-418
  "counts": { "lanes": 4, "working": 2, "waiting": 1 } }
// lane
{ "id": "lane:builder-a/payments", "kind": "lane", "parent": "builder:builder-a", "builder": "builder-a",
  "fkey": "builder-a/payments", "label": "payments", "status": "working", "sub": "Edit api/charge.ts",
  "session": "builder-a/s1", "flags": { "stuck": null, "paused": false },
  "m": { "costUsd": 3.2, "ctxPct": 61, "ageMs": 5400000, "ci": "fail" } }
// session (only for lanes with >= 2 live sessions, see 2.4)
{ "id": "sess:builder-a/s1", "kind": "session", "parent": "lane:builder-a/payments", "builder": "builder-a",
  "fkey": "builder-a/s1", "label": "s1", "status": "working", "m": { "costUsd": 1.1, "ctxPct": 61 } }
// repos island (only when config.repos/packages exist)
{ "id": "__repos", "kind": "site", "parent": "__core", "label": "REPOS", "status": "ok" }
{ "id": "repo:acme-app", "kind": "repo", "parent": "__repos", "label": "acme-app", "status": "ok" }
{ "id": "pkg:acme-app/api", "kind": "package", "parent": "repo:acme-app", "label": "api",
  "status": "crit", "why": "CI api-test failed on main", "m": { "ci": "fail" } }
// builders no topology room claims
{ "id": "__fleet", "kind": "site", "parent": "__core", "label": "FLEET", "status": "ok" }
```

**Attachment rule** (pure, `attachBuilders(topology, builders)`):
1. A topology node with `"builder": "<id>"` (new optional field, any kind; usually a `room` whose `feed` is `hv/<vmid>`) is the parent of `builder:<id>`. Validated in `parseTopology`: string slug, at most one node per builder id.
2. Legacy `self` (`server/map.mjs:69`, `:411`, `:444`) is an alias for `builder: <config.fleet.id>` on that node, so existing builder-mode `map.json` files keep working.
3. Otherwise the builder goes under the synthetic `__fleet` site (emitted only when needed). Its `sub` says `"not in topology"` so the user knows to add the field.

**Status of the builder node**: `link==="down"` → `down` (why `"no contact for 2m"`), `stale` → `unknown`, `up` → `ok`. A builder never inherits its lanes' attention (rollup does that client-side, `public/map.js:575-588`). The **room** that hosts a builder gets `sourced` true from the builder link when it has no feed of its own (so a room is not `unknown` just because no feed exists).

**Links**: today `{id, from, to, kind, label, live}` (`server/map.mjs:447-449`). `LINK_KINDS` gains `touch`, `conflict`, `pkg`, `ci`; new optional `severity`, `predicted`, `files`, `packages`.

```jsonc
{ "id": "touch:lane:builder-a/pay|lane:builder-b/api", "kind": "touch", "from": "lane:builder-a/pay", "to": "lane:builder-b/api",
  "files": 3, "packages": ["acme-app/api"], "label": "3 files · api" }               // ids sorted, undirected
{ "id": "conflict:lane:builder-a/pay|lane:builder-b/api", "kind": "conflict", "from": "...", "to": "...",
  "predicted": true, "severity": "warn", "files": 1, "label": "merge risk · charge.ts" }  // predicted: true=forecast, false=merge-tree conflict (severity crit)
{ "id": "pkg:lane:builder-a/pay>pkg:acme-app/api", "kind": "pkg", "from": "lane:builder-a/pay", "to": "pkg:acme-app/api", "live": true }
{ "id": "ci:builder:builder-a>runner-1", "kind": "ci", "from": "builder:builder-a", "to": "runner-1", "live": false }
```

When a `conflict` link exists for a pair, the `touch` link for the same pair is dropped (one edge per pair). `pkg` links: one per (lane, package) pair, `live` while the lane is `working`. `ci` links: from each builder to every topology node with `"ci": {"runner": true, "for": ["builder-a"] | "*"}` (new optional topology field), `live` while a CI run for a branch of that builder's lanes is in progress on that runner (data from §6 `ciRuns`).

**Inputs consumed** by the pure builder (`buildFleet`), so the model stays testable without network (as `build`, `server/map.mjs:371-375`):
```js
buildFleet({ topology, feeds, probes, now, topologyError,
  builders: [{ id, code, link, ageMs, snapshot, health? }],   // snapshot = /api/v1/snapshot shape (§2); health = §7 latest sample
  repos:    [{ name, packages: [{ name, ci: 'pass'|'fail'|'running'|'none', why? }] }],   // §6 rows (P11 merge / P9 local)
  laneFacts: Map<fkey, { packages: [ 'repo/pkg' ], costUsd, ci }>,                     // §6 (touch map) + session cost
  overlaps: [{ a: fkey, b: fkey, kind: 'touch'|'predicted'|'conflict', files: n, packages: [], label? }], // §6 edges via normalizeOverlaps
  ciRuns:   [{ runner: '<topology id>', builder, branch, status }] })
```
`build()` stays as the builder-mode entry and becomes `buildFleet` with one builder `{id: config.fleet.id, link:'up', snapshot}`, so there is **one code path** and builder-mode lane ids also become `lane:<id>/<lane>` (required by the fleet-key rule).

**Size budget**: 6 builders × 20 lanes × 3 sessions + ~60 topology + ~30 packages ≈ 570 nodes worst case, ~400 links. Session and package nodes carry no `detail` (the inspector fetches detail from the store by `fkey`), keeping a full model under ~120 KB. `tick()` keeps its shape diff (`server/map.mjs:551`); the shape key adds `l.severity` and `n.flags`. Metrics-only resend interval goes from 5 s to 10 s on the hub.

### 2.2 Client architecture: `public/js/views/map/`

`public/js/views/map-canvas.js` (F1's verbatim move of `public/map.js`) is retired into these modules and kept as a 3-line re-export shim `export * from './map/index.js'`, so F1's dynamic `import('./map-canvas.js')` in `views/map.js` keeps working. Pure modules import nothing from the DOM at module top level, so `node --test` can import them.

| file | pure | contents (moved from map.js lines) |
|---|---|---|
| `model.js` | yes | `normalize(model)`, `kidsOf`, `foldState(nodes, collapsed, autoFold)` → `{hidden, shown(id)}` (from `:407-415`, `:427-432`), `visibleLinks(links, shown, {focus, overlay, scope})` (from `:440-453`, `:1226-1229` idle-lane rule), `neighbours` (`:500-509`), `rollup` (`:575-588`), `scopeAlpha(node, scope)`, `SEVERITY`, `worse` |
| `layout.js` | yes | `RINGS`, `SIZE`, `RING_OF`, `layout(nodes)` (`:139-203`) rewritten to rank rings by kind (2.4), `ringLabels(pos, nodes)`, `ticks(outerR)` |
| `overlays.js` | yes | `OVERLAYS`, `nextOverlay`, `nodeStyle(node, overlay, statusRollup)`, `linkStyle(link, overlay)`, bin functions (2.6) |
| `render.js` | no | `createRenderer(ctx, palette)` with `drawRings, drawTree, drawLinks, drawComets, drawNodes, drawLabels, drawReticle, drawTether` (from `:1070-1520`); `readPalette` (`:62-96`) |
| `interact.js` | no | pointer/wheel/pinch/keys (`:816-913`), `createHitGrid` spatial hash, camera (`fit, flyCam, flyTo`, `:342-379`, `:788-798`) |
| `minimap.js` | no | `createMinimap(canvas, sceneSource)` |
| `split.js` | no | dense lane table for split view |
| `index.js` | no | `createMap(root, opts)`; owns `cur` state, `relayout` beats (`:418-519`), `step` (`:970-1068`), `kick/frame` (`:935-961`), returns the API |

Motion is `public/js/core/motion.js` (moved by F1; tests in `test/motion.test.mjs`); `index.js` imports `../../core/motion.js`. The CSS is `public/css/views/map.css` (moved by F2).

`createMap(root, opts)` API (superset of `public/map.js:1527-1545`):
```js
{ update(model), event(e), select(id, {fly}), focus(id), fit(), resize(), destroy(),
  setScope(builderId|'all'), setOverlay(name), setMode('full'|'split'|'pip'),
  onSelect(cb), onHover(cb), highlight(id|null), snapshotScene() /* for minimap */ }
```
`opts`: `{ title, actions(node) -> [{id, icon, label, tier, run}], anchorEl() -> Element|null /* inspector, for tether */ }`.

### 2.3 Decision: the inspector replaces the map panel

The map's own `.map-panel` (`public/map.js:657-768`), "needs you" list (`:590-633`), ticker (`:642-655`) and legend (`:285-294`) are removed. Selection calls `navigate({sel: fkeyOrNodeId})`; the §4 inspector renders the node. Justification: (1) `sel=` must mean the same thing on every view (board, inbox, split view), so one detail surface; (2) inline actions need the confirmation tiers and audit feedback that §4/3 build once, in the inspector; (3) metrics bars, detail `dl` and chip lists (`:707-756`) would otherwise be duplicated; (4) the rail (§4) already lists what needs you, and the tape shows events, so the map HUD duplicates were noise. What stays map-specific: the hover tip (`:915-933`), find input (`/`, `:800-813`), the fold toggle (exposed to the inspector as an action `{id:'fold'}` from `opts.actions`), and the tether hairline (`:1095-1125`), which now targets `opts.anchorEl()` instead of `panel`.

`sel=` values: a fleet key (`builder-a/payments`) resolves to `lane:builder-a/payments` or `sess:builder-a/<name>`; anything else is a raw node id (`hv`, `builder:builder-a`, `pkg:acme-app/api`). Pure helper `model.js: idForSel(sel, byId)` and `selForId(id)`.

### 2.4 Layout: rings by kind

`RING_OF = {core:0, site:1, host:1, room:2, builder:3, service:3, repo:2, package:3, lane:4, pr:5, session:5}`; `RINGS = [0, 150, 290, 420, 540, 640]`. `layout()` keeps the leaf-weighted sectors and the 12 o'clock clearance (`:178-182`) but a node's radius comes from `RING_OF[kind]` (falling back to depth), so a builder directly under `__fleet` sits on the BUILDER ring with the same tree curve (`treeCurve`, `:1174-1178`, already spans arbitrary radii). Stagger for crowded rings (`:194-200`) applies to rings ≥ 3. `ringLabels` returns per ring the kinds present, rendered `SITE`, `ROOM`, `BUILDER · SVC · PKG`, `LANE`, `SESSION` (replacing `RING_NAMES`, `:55`).

**Session nodes and auto-fold**: sessions are emitted only for lanes with ≥ 2 live sessions (a single-session lane already is its session; `session` field links to it). The client auto-folds every lane's sessions (`autoFold` set, separate from the user's `collapsed` in localStorage `laneboard.map.folded`, `:44`) unless: the lane or one of its sessions is selected, the scope is that lane's builder, or `cam.z ≥ 1.8`. Crossing the threshold calls `relayout()`, so sessions grow out of their lane in beats (`stage`). Fold ids stored in localStorage are migrated: legacy `lane:<x>` ids are dropped.

### 2.5 Industrial restyle (tokens from §4)

Read via `readPalette` from `public/css/tokens.css` custom properties (names owned by §4; this section reads `--text-1..3`, `--line`, `--line-weak`, `--bg-canvas`, `--accent`, `--p1` (crit), `--p2` (warn), `--p3` (low), `--ok`, `--font-mono`, `--font-label`; it re-reads them on the `lb:theme` event). The ground is a flat `--bg-canvas` fill with the `--tex-dots` dot grid; the map's HUD panels (`map-needs`, `map.css:40`) are deleted (§4 annunciator + inbox replace them).

- **Remove**: core radial glow (`:1077-1083`), tree gradients (`:1195-1198`), core breathing, `backdrop-filter` glass and shadows in `map.css` (`:12-14`, `:43-48`), radial-gradient background (`map.css:12-13`). `lighter` comets become plain alpha.
- **Rings**: solid 1px hairlines `--line` at 0.5 alpha (no dotted, `:1141-1145`); ring label in `--font-label` 10px tracked caps at 12 o'clock with a 6px leader tick; **degree ticks** kept (`:1155-1169`) plus numeric bearings `000 090 180 270` in mono 9px at the long ticks every 90°.
- **Nodes**: healthy (`ok`, `idle`, `working`) are grey: filled `--text-3` disc, `working` adds the existing turning arc in grey (data motion stays). Abnormal: hue + shape: `crit/down` filled square ■ `--p1`, `warn/attention` triangle ▲ `--p2`, `unknown` hollow circle dashed, `low` (e.g. budget near cap, context ≥ 80%) diamond ◆ `--p3`. Lanes keep diamond outline in grey when healthy so lane-vs-machine still reads (`:1345-1347`); abnormal lanes switch to the status shape. Builders: 2px square outline with the short code inside (mono 9px).
- **Lamps**: each builder node has a 3-lamp strip under its label: link (up/stale/down), approvals pending (accent when > 0), stuck (warn when any lane stuck). Lamps are 4×4 squares, off = `--line`.
- **Selection**: corner-bracket reticle (four 6px L-brackets at r+6) that closes from r+18 driven by the existing `sel.t` spring (`:1033-1036`); hover = brackets at 40% alpha, no glow. Replaces the selection ring.
- **Edges**: tree = 1px `--line`; `touch` = 1px solid `--text-3` 0.35; `conflict predicted` = 1px dashed `[4,3]` `--p2`; `conflict` confirmed = 1.5px solid `--p1` (the only crit-coloured edge); `pkg` = 1px dotted `[1,3]` `--text-3`, drawn only for focus/scope/CI overlay; `ci` = 1px dashed `--text-3`, `live` animates dash offset (as `:1240`); topology `dep/flow/share` keep their dash patterns in grey, hue only when `l.status` is abnormal (`:1216-1219`).
- **Readout corner** (top-right DOM, `.map-readout`, mono 11px tabular-nums slashed-zero): `Z 1.80×  SCOPE B1  N 214/570  OVL CI  12:04:31Z`. UTC clock updates once a second via `setInterval` only while the map view is visible; N = drawn/total.

### 2.6 Overlays (`o` cycles, `O` back; shown in readout)

`OVERLAYS = ['status','ci','cost','context','age']`. `nodeStyle(node, overlay, rolled)` returns `{tone: 'grey'|'crit'|'warn'|'low'|'accent', level: 0..4, shape: 'disc'|'square'|'tri'|'diamond'|'ring'}`; render maps tone+level to a colour (level = lightness step of accent oklch 40/50/60/70/80% L). Abnormal status always overrides with its own shape in every overlay (a crit lane never looks calm because the overlay is cost).

| overlay | measure | mapping |
|---|---|---|
| status | `status`, `flags` | as 2.5 |
| ci | `m.ci` on lanes and packages | pass grey, running grey+arc, fail ■ crit, none ring; lanes/pkgs only, `pkg` edges forced visible |
| cost | `m.costUsd` (lane/session, 24 h) | bins `[0,1,5,20,50]` USD → level 0..4 accent; ≥ builder budget cap (section budget) ◆ low→■ crit |
| context | `m.ctxPct` (`session.context.usedPct`, `server/state.mjs:399-404`) | `<50` grey, 50-70 L1, 70-85 ◆ low, ≥85 ▲ warn |
| age | `m.ageMs` since lane's last activity | `<10m` grey, `<1h` L1, `<4h` L2, `<24h` L3, ≥24h L4 |

Non-lane nodes are drawn at 0.5 alpha in non-status overlays. Overlay choice persists in localStorage `laneboard.map.overlay`.

### 2.7 Scope, URL and split view

- Rail scope `b=<builderId>` → `setScope(id)`: flight (`flyCam`) to fit the builder's subtree bounding circle; `scopeAlpha` = 0.25 for every node not in that builder's subtree and not on the path to the core; edges to ghosted nodes at 0.25. `b=all` → `fit()`. Scope ghosting uses the existing `focusAlpha` springs (`:1041-1050`) with `want = min(focusWant, scopeWant)`.
- `sel=` changes from the router → `select(id, {fly:true})`; map clicks → `navigate({sel})`. Escape clears `sel` (§4 `closeTop()` order).
- **Split view** (`\` toggles, registered by §4 D8; state in `localStorage['lb.split']`, not in the URL): `.map-split` grid `3fr 2fr` (60/40), map left, `split.js` table right: columns `■/▲ state · B · lane · sess · tool/sub · ctx% · $24h · age`, rows sorted worst first, mono 12px, 22px rows, virtualized above 80 rows. Hover row → `map.highlight(id)` (reticle at 40% + neighbours lit); hover node → `onHover` → table row `.is-hot`. Selection synced through the router (one source of truth). Below 900px wide, split is refused (toast) and stays full map.
- **Minimap PiP** (`minimap.js`): in non-map views a 240×240 canvas fixed bottom-right (inside safe-area inset, above the tape). Draws rings, dots (status shapes, 2-3px), no labels, no comets, viewport rectangle when returning. Redraw throttle: at most 2 fps, and only when `scene.version` changed or a pulse is due; no RAF loop. Click → `navigate({view:'map'})` (keeps `b` and `sel`). Hidden on viewports < 700px and when the document is hidden. `snapshotScene()` returns `{version, pts: Float32Array [x,y,shapeCode,toneCode]...}` from the main map's `cur` goals (no springs computed for PiP).

### 2.8 Inline actions from a lane node

`opts.actions(node)` (moved from `public/app.js:1834-1838`) returns, for `kind` lane/session with `fkey`:

| id | icon | action (README action table) | tier |
|---|---|---|---|
| `term` | terminal | opens L4 via `navigate({sel, open:'term'})`; URL from `source.termUrl(fkey)` (`/ws/term/:name` on a builder, `/ws/term/:builder/:name` on the hub) | none |
| `peek` | eye | selects the node and opens the inspector PEEK tab (§10 R12) | none |
| `send` | send | `send-text` with `guardPrompt:true` | click (inline input, Enter) |
| `pause`/`resume` | pause/play | `pause`/`resume` | click |
| `approve`/`deny` | check/x | `approve`/`deny` with `approvalId` (only when `flags.awaitingApproval`) | click (the inspector shows the pending tool+args first) |
| `fold` | fold | local | none |

Tiers come from `hello.actions` / `ACTION_TIERS` (§2 names); the map only declares the list, the inspector renders and runs them via `act(fkey, action, args)` (§1 `core/actions.js`) and `confirmAction` (§4). On result the map gets an `event({node, kind:'ok'|'crit', text})` pulse; it never changes a node's status optimistically (status changes only via the next model: "movement is data").

### 2.9 Performance and reduced motion

- Budget: ≤ 4 ms draw at 570 nodes / 400 links on a mid laptop, ≤ 10 ms on phone; measured by `?mapperf=1` printing p95 frame time in the readout.
- Cull off-screen nodes (exists, `:1310`) and labels below zoom thresholds; sessions auto-folded (2.4); `pkg` edges only on focus/scope/CI overlay; edge labels only when hot (as `:1255`).
- `createHitGrid(cellPx=48)`: rebuilt per frame only when the camera or positions moved; hit test O(cell) instead of the linear scan `:818-830`.
- Ambient layer (`:1053-1066`) caps soft pulses at 24 per 2.4 s round and live-flow comets at 16, worst-first.
- Text measurement cache keyed by `font|text` (labels re-measured every frame today, `:1503`).
- `prefers-reduced-motion`: unchanged semantics (`:57`, `:451`): no springs, no flights, no comets/pings, draw on change; scope change and overlay change are instant; PiP same.

### 2.10 Phone (< 700px)

Map full screen under the shell's top bar; readout collapses to `Z · N · UTC` one line; find behind a search icon. Pinch zoom: two-pointer gesture in `interact.js` (track `pointerId`s, scale about the midpoint using the same `zoomGoal` anchor logic `:887-903`), two-finger pan; one-finger drag pans. Tap selects + `flyTo` (exists for non-mouse `:869`) and opens §4's bottom sheet inspector (`ui/sheet.js`) at its `half` snap; tether off (`W <= 760` rule exists `:1096`). Long-press (500 ms) on a lane opens the action list directly.

## 3. Tasks (dependency order)

Ids and deps match the global DAG in README.md.

**M1 Fleet model (server, pure; was T5.1 + §3 H10 + §7 T7; deps §1 F7, §3 H3).** Files owned: `server/map.mjs`, `test/map.test.mjs`, `test/fixtures/fleet-map.json`, `docs/fleet/map.md` (X4 folds it into `docs/map.md`). Do: add kinds and link kinds; `parseTopology` accepts `builder` and `ci` node fields, rejects reserved prefixes; `attachBuilders`; `fleetLaneNodes(snapshot, {builder, parent, show, now, laneFacts})` (generalizes `laneNodes`, `:329-367`, with `fkey`, `flags`, `m`, session children); `repoNodes(repos)`; `fleetLinks({lanes, overlaps, laneFacts, topology, builders, ciRuns})`; `normalizeOverlaps(edges)` (§6 P11 `edges` → `overlaps`); `buildFleet(...)`; `build({snapshot, ...})` stays as the builder-mode entry and wraps the snapshot into a fleet of one with id `config.fleet.id`; `toMapFleet(view)` (hub, from §3's `store.view(now)`); `tickFleet(fleet, now)` (hub loop, called by §3 H11); feed-linked builder status (`worse(feedStatus, linkStatus)`, §7 T7) and `map.feeds:false` when `fleet.hubKeys` is set; `diffEvents` emits `builder ... is down` once and suppresses per-lane events when the builder link changed in the same tick (as `sameAsParent`, `:486-489`). Done when: `npm test` green including new tests (§4 of this doc); `GET /api/map` on a builder with no config returns `__core → __fleet → builder:<id> → lane:<id>/<lane>`.

**M2 Pure client modules (was T5.2; deps §1 F1).** Owned: `public/js/views/map/{model,layout,overlays}.js`, `test/map-layout.test.mjs`, `test/map-overlays.test.mjs`, `test/map-model.test.mjs`. Port `layout` (with RING_OF), folding/shown, rollup, visibleLinks, scopeAlpha, idForSel, overlay mapping. Done when: tests pass, modules import under `node --test` with no globals.

**M3 Renderer + restyle (was T5.3 + §4 T4.10 chrome; deps M2, §4 D1, §1 F2).** Owned: `public/js/views/map/render.js`, `public/css/views/map.css`, `test/map-render.test.mjs` (pure parts: `readPalette` against a fake `getComputedStyle`, shape per status). Exports exactly `createRenderer(ctx, palette)` and `readPalette(el)`. Done when: tests pass, §4's guardrail test passes on `map.css` (no gradients beyond `--tex-*`, no backdrop-filter/shadow), HUMAN visual check.

**M4 Interaction + index (was T5.4; deps M3, §1 F8b).** Owned: `public/js/views/map/{interact,index}.js`, `public/js/views/map-canvas.js` (becomes the shim), `test/map-interact.test.mjs` (hit grid, pinch maths). Move step/relayout/kick verbatim first (commit), then add scope, `setOverlay`, reticle state, pinch, hit grid, readout, `setInsets({right})`, `selectNext(dir)`, `focusFind()`, and remove the map's own `onKey` (`map.js:905-913`). Done when: `node --test test/frontend.test.mjs` passes and manual smoke `#/map` renders a builder-mode map.

**M5 Integration with shell (was T5.5; deps M4, §4 D4, D6, D6b, §1 F8a, F8b).** Owned: `public/js/views/map.js` (the view module §4's registry mounts: default export `{id:'map', mount(el, ctx), unmount(), update(store)}`), `public/js/views/map/split.js`, `public/js/views/map/minimap.js`, `test/map-view.test.mjs`. Wires `b=`, `sel=`, `lb.split`, PiP, actions via `act()`, map events from `store` (replaces `pulseMapFor`, now keyed `lane:${fkey(builder, lane)}`). Done when: `test/map-view.test.mjs` passes (pure parts) and HUMAN checks below.

(T5.6 dropped: the F1 frontend test scans every `public/js/**/*.js`.)

M1 and M2 run in parallel; M3 after M2 and D1; M4 after M3; M5 last.

## 4. Tests

- `test/map.test.mjs` (extend; update existing ids `lane:payments` → `lane:box/payments` in tests at `:120-160`):
  - builder attaches under the room with `builder: "builder-a"`; legacy `self` still works and its vitals land on the builder node;
  - an unclaimed builder goes under `__fleet`; `__fleet` absent when none;
  - `link: down` → builder `down`, its lanes keep their last status but `diffEvents` produces one event for the builder only;
  - two builders with the same lane name produce distinct `lane:builder-a/x` and `lane:builder-b/x`;
  - session nodes only for lanes with ≥ 2 live sessions; `fkey` set;
  - overlaps → one edge per pair, confirmed conflict wins over touch, `severity` carried, ids sorted;
  - `pkg` links from `laneFacts`, live while working; `ci` links from topology `ci.runner/for`, `"*"` matches all;
  - `parseTopology` rejects `builder:`/`pkg:` ids and a builder claimed twice;
  - shape key changes when a link's severity changes.
- `test/map-layout.test.mjs`: ring radius by kind (builder on ring 3 whether under a room or `__fleet`); 12 o'clock clearance kept; sectors proportional to leaves; stagger only on rings ≥ 3; `ringLabels` combines kinds; determinism (same input → same output).
- `test/map-overlays.test.mjs`: cost/context/age bin edges; abnormal status overrides overlay; `nextOverlay` cycles both ways; `linkStyle`: only confirmed conflict yields tone `crit`, predicted yields dashed warn.
- `test/map-model.test.mjs`: `foldState` with collapsed + autoFold; `shown` climbs to folded ancestor; `visibleLinks` re-targets folded ends (as `:440-453`) and hides `pkg` edges without focus; `scopeAlpha` ghosts other builders but not the path to core; `idForSel`/`selForId` round trip.
- `test/frontend.test.mjs`: new files in the defined-function check.

## 5. Risks, open questions, human checks

- Changing builder-mode lane ids breaks any stored fold ids and external links using `lane:<x>`; migration drops them (low cost).
- Model size over WS on phones: if > 120 KB or > 1 msg/2 s observed, §3 adds permessage-deflate (`ws` supports it, no new dep) or a node-level delta. Open question for §3 (not scheduled tonight).
- `ci` links need `ciRuns` with a runner id; §6 tonight reports runs without the runner that executed them, so M1 emits `ci` links from topology `ci.runner/for` with `live:false` unless a `ciRuns` entry is given (no data source scheduled tonight; listed as a gap in INTEGRATION-REPORT.md).
- Ring-by-kind may leave empty rings in small fleets; `drawRings` already draws only occupied rings (`:1137`).
- §6 field names for overlaps/CI are P11's `edges:[{a, b, kind:'textual'|'overlap', files}]`; `normalizeOverlaps` maps `textual`→`conflict` (predicted:false) and `overlap`→`touch`.
- Token names are §4's (fixed in the integration notes); the renderer reads them in one place (`readPalette`).
- HUMAN: visual review of restyle in dark and light themes at 1x and 2x DPR; check the "movement is data" feel survives (beats, flights, folding).
- HUMAN: phone pinch and bottom sheet on iOS Safari and Android Chrome.
- HUMAN: with 6 builders (use the fixture `test/fixtures/fleet-map.json`, created in M1, 6×20×3), confirm p95 frame ≤ 4 ms via `?mapperf=1`.
- HUMAN: approve-from-map round trip against a real builder, audit entry present.

## 6. Dependencies

- §1: `laneNodeId`, `core/motion.js`, `views/map-canvas.js`, `core/actions.js`, `createSource().termUrl`.
- §3: hub fleet store (`view(now)`, conn state → `link`), H11 calls `tickFleet`, action relay + terminal proxy path `/ws/term/:builder/:name`.
- §2: tier names (`hello.actions`).
- §4: tokens, router (`b`, `sel`, `open`), store selectors, inspector (+PEEK tab from §10), sheet, tape, hotkeys registry (`o`, `O`, `\`, `/`, `f`, `c` registered there by D8), Lucide sprite icons.
- §6: `edges` (→ `overlaps`), `laneFacts.packages`, repos/packages CI status, `ciRuns`.
- §7: `health` samples for builder node metrics; §8: per-builder budget cap for the cost overlay.

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
