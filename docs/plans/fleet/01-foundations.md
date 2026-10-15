# Section 1: Foundations

**Integration notes (integrator):**
- Wave 0 order is X1 (boot split, §11) → F3 → F4 → A1 (§2) → F1 → X2 (test kit, §11). F1 no longer lands "first, alone": it lands after X1 and F3, still with no behaviour change.
- `mode` moved to X1 (`server/config/mode.mjs`); F4 is now the fragment `server/config/fleet.mjs` (id, code, allowedOrigins). `fleet.hubKeys` belongs to §2 A5, `fleet.builders` to §3 H1.
- F1 also owns the `/vendor/<rel>` static fall-through in `server/http.mjs` (moved here from §4 T4.1) so `http.mjs` has a strict owner order F1 → F5 → A8.
- F5: the upgrade guard lives in `server/boot/common.mjs` `listenAll` (was `server/index.mjs:428-443`); CSRF exemption is the exact set `/api/hook`, `/api/hook/permission` (§8). `allowedHosts` also includes `fleet.publicHosts` (§2). `auth.mjs` (§2 A4) imports `checkHost`/`checkOrigin`/`checkCsrf` from `server/security.mjs`; it does not re-implement them.
- F6: the frontend lint rule goes in a new `test/frontend-safety.test.mjs` (covers §10's T10.17 too); F6 now depends on F2 (both edit `render.test.mjs`).
- F7: the hook-event broadcast now lives in `server/boot/builder.mjs` (moved verbatim by X1).
- F8a: the hub sends `{type:"fleet", hub, builders:[BuilderRow], aggregates}` (§3), not `{type:"builders"}`. `act()` and `hubAct()` are fully specified here (no later registration). The router implements §4's full grammar (`open`, 8 views + hidden `diff`) with `DEFAULT_VIEW = "board"`; §4 D4 flips it to `map`.
- F9: files are `server/fleet/api-v1.mjs` + `server/routes/v1.mjs` (the name §2 uses), not `server/fleet/api.mjs`; `server/version.mjs` is created by X1.
- Docs: feature tasks write `docs/fleet/<topic>.md`; `docs/config.md` is assembled by §11 X4.
- Task ids and deps now match the global DAG in README.md. Private details moved to `private/01-private.md`.
- **Security fixes pass (see `SECURITY-FIXES.md`):** F5 (`server/security.mjs`, the Host/Origin/CSRF/CSP baseline used unchanged by the hub) and F8a (`public/js/core/{store,net,actions,keys}.js`: routing keys only from the frame-level `builder`) are REVIEW-REQUIRED (README 4.5) and each gets an independent SR review task. `checkHost` compares `host:port` (serve preserves `Host: <name>:8443`); a `Host` without the port does not match a `publicHosts` entry with one. The Origin check is exact, never same-site.

Everything later builds on this section: the frontend split into modules, fleet keys, a client store that holds several builders, the security baseline, fleet config, and the routing skeleton for `/api/v1/`. **F1 lands first, alone, and changes no behaviour.**

## 1. Goal and scope

**In scope**
- Split `public/app.js` (2025 lines), `public/map.js`, `public/terminal.js` and `public/motion.js` into `public/js/{core,ui,views}/` ES modules. Split `public/styles.css` and `public/map.css` into `public/css/`, then remove the legacy token aliases (`styles.css:85-104`).
- Fleet keys `"<builderId>/<localName>"` at every boundary: wire, client store, pins, deep links, attention, lane filter, map node ids, push URLs, DB rows.
- A client store that holds N builders, behind a net layer with one "source" per WebSocket. Builder mode has one local source. Hub mode has one hub source that carries many builders. Connection status is tracked per builder.
- Security baseline: a Host allowlist (against DNS rebinding), an Origin check on every WS upgrade and every mutating route, a required `X-Laneboard: 1` header on mutating routes, CSP and related headers, and no `innerHTML` built from data. Card previews are rendered on the client from raw ANSI.
- Config keys `fleet.id`, `fleet.code` and `fleet.allowedOrigins` (fragment `server/config/fleet.mjs`), with env vars and a docs fragment `docs/fleet/identity.md`. `mode` is X1's (`server/config/mode.mjs`).
- The routing skeleton for `/api/v1/hello` and `/api/v1/snapshot`.

**Out of scope**
- Hub signatures, auth and `/api/v1/actions|stream|audit|term`: §2.
- The hub process itself: §3.
- The UI redesign (tokens' new values, fonts, icons, the new views): §4. F2 moves the CSS; it does not restyle it.
- `mode: "both"`: X1's `server/config/mode.mjs` rejects it.

## 2. Design

### 2.1 What exists today (grounding)

| Concern | Where | Keyed by |
|---|---|---|
| Session inventory | `server/state.mjs:114` `sessions` Map | local name (stays local) |
| Pane cache / capture rate | `state.mjs:171` `paneCache`, `:220` `visibleSessions` | local name |
| WS diff baseline | `server/ws.mjs:28` `lastSerialised`, `diffSessions` `:18` (`s.name`) | local name |
| WS `visible` message | `ws.mjs:94-96` `{type:'visible', names}` | local name |
| Attention entries | `state.mjs:160-162` `{name,state,score,since,danger}` | local name |
| Hook event broadcast | `server/index.mjs:182-188` `{session_name,…}` | local name |
| Push deep links | `server/push.mjs:134,160,179` `/#session=<name>` | local name |
| Map lane nodes | `server/map.mjs:354` `id: lane:${lane.id}`, `:362` `session: own[0]?.name` | lane id / name |
| Terminal WS | `server/terminals.mjs:293-310` `/ws/term/<name>` | local name |
| DB | `server/db.mjs` `events.session_name`, `cost_snapshots.session_name/lane`, `markers.lane/session_name` (unique index `:64-65`), `lane_jobs.lane`, `pr_samples.lane`, `rate_limit_samples.source_session` | bare |
| Client store | `public/app.js:18-39` `store.sessions` Map by `s.name` (`:104,107-108`), `attention`, `lanes`, `laneFilter` Set of lane ids (`:28,155-158`), `cursor`, `pinned`, `openSession` | bare |
| Pins | `app.js:75-86` localStorage `laneboard.pinned` | name |
| DOM node maps | `app.js:304` `cardNodes`, `:418` `laneNodes`, `:174` `onScreen` (from `dataset.name`) | name / lane id |
| Deep link | `app.js:1679,1691,1898-1927,1945` `#session=<name>` | name |
| Map folds | `public/map.js:44,523-526` localStorage `laneboard.map.folded` | node id (`lane:<id>`) |
| Map pulses | `app.js:1833-1846` `node: lane:${s.lane}` | lane id |
| Terminals (client) | `public/terminal.js:145` URL from `view.name` | name |

**Security today.** No Origin or Host check at all (`index.mjs:432-442` upgrades anything, `http.mjs:96-138` routes anything). No CSRF protection. No CSP. The only `innerHTML` built from data is `app.js:771` (`pre.innerHTML = s.previewHtml.join('\n')`). `previewHtml` comes from `server/ansi.mjs:68-87`, which escapes every text run (`escapeHtml` at `:7`) and builds `style` only from tables and numbers. It is safe while the builder renders its own preview. On a hub, though, it would be HTML written by a builder, and builders are untrusted, so F6 moves rendering to the client. `map.js:231,1544` only clear (`innerHTML = ''`). The SPA fallback (`http.mjs:131-134`) serves `index.html` for any missing path, a missing `.js` module included, so a bad import shows up as a MIME error instead of a 404.

**Service worker.** `public/sw.js` deliberately has **no cache list** (`sw.js:1-3`), and `test/frontend.test.mjs:111-115` enforces that. So there is no cache manifest to update. The changes are: it stays at `/sw.js` (its scope must be the root), its `notificationclick` keeps using `data.url`, and the URLs that `push.mjs` produces change (F7).

**Tests that pin the current layout.** `test/render.test.mjs:206-210` reads `public/app.js`, replaces the `terminal.js` import with a regex, and runs it as a classic script in `vm`. `test/frontend.test.mjs:53,64-115,117-293` reads `app.js` and `styles.css` by name. `test/motion.test.mjs:4` imports `../public/motion.js`. All three move with F1/F2.

### 2.2 Module map (F1: moves only)

All imports are **relative** (`./core/store.js`, `../core/dom.js`), so Node can import the pure modules directly in tests. No module touches the DOM at top level. Every top-level wiring statement in `app.js` moves into an exported `init()`, and `public/js/app.js` `boot()` calls those in the original source order. Mutable cross-module `let`s become store fields, because imported bindings are read-only: `boxDirty` → `store.boxDirty`, and `ws` → `net.reconnect()`.

| New file | From (current lines) | Exports |
|---|---|---|
| `public/js/app.js` | `app.js:1929-1952` (10 s since-ticker, error hooks, `connect()`, initial `applyHash`) | `boot()` (called at module end) |
| `public/js/core/dom.js` | `:4` `$`, `:236-242` `el`, `:1199-1205` `SVGNS`, `svg` | `$`, `el`, `svg`, `SVGNS` |
| `public/js/core/format.js` (pure) | `:6-14` `STATE_LABEL`, `:212-235` `ago`, `money`, `compactCount`, `:243-247` `shortDir`, `:275-283` `pressure`, `:294-300` `resetsIn`, `:420` `STATE_RANK`, `:564-571` `hueFromId` | same names |
| `public/js/core/store.js` | `:18-39` `store`, `:75-86` `loadPinned`, `savePinned`, `:148-158` `laneById`, `laneVisible`, `:416` `boxDirty`→`store.boxDirty` | `store`, … |
| `public/js/core/net.js` | `:88-134` `connect`, `:135-146` `applyCommon`, `:160-166` `setConnected`, `:168-208` visibility observer, `sendVisible`, `scheduleVisible`, `:1695-1729` `post`, `del`, `sendKeys`, `sendText` | same plus `reconnect()`, `watchCard`, `unwatchCard` |
| `public/js/core/router.js` | `:50-73` `VIEWS`, `VIEW_KEYS`, `setView`, `:1893-1927` `applyHash` + hashchange | same, `init()` |
| `public/js/core/motion.js` | `public/motion.js` (verbatim) | unchanged |
| `public/js/ui/render.js` | `:306-398` `renderStats`, `renderAll`, `reportRenderStats`, `reportUiError` | `renderAll`, `reportUiError` |
| `public/js/ui/widgets.js` | `:248-273` `gauge`, `compactGauge`, `:285-292` `stateDot`, `:578-598` `prChip`, `:1045-1060` `laneStripe`, `block` | same |
| `public/js/ui/shell.js` | `:1593-1605` `renderTopbar`, `:1731-1738` `toast`, `:1742-1747` dock-layout and refresh button wiring, `:1906-1927` nav/launch/morning-window click wiring | `renderTopbar`, `toast`, `init()` |
| `public/js/ui/rail.js` | `:1502-1592` `renderRailBox`, `renderAttention`, `renderVitals`, `freshestRateLimits`, `renderRateLimits` | same |
| `public/js/ui/dock.js` | `:1607-1656` `renderDock`, `togglePin` | same |
| `public/js/ui/sheet.js` | `:1670-1693` `openSheet`, `closeSheet`, `:1741` close wiring, `:1751-1782` `QUICK_KEYS`, `sendQuick`, quickbar and qb-form | same, `init()` |
| `public/js/ui/hotkeys.js` | `:1784-1795` `keyBelongsToTerminal`, `:1848-1891` `pendingG`, keydown, outside-click | `init()` |
| `public/js/ui/launch.js` | `:947-1018` launch sheet | `openLaunch`, `closeLaunch`, `submitLaunch` |
| `public/js/ui/push.js` | `:1953-2025` | `init()` |
| `public/js/ui/terminal.js` | `public/terminal.js` (verbatim) | unchanged |
| `public/js/views/board.js` | `:304` `cardNodes`, `:400-655` units, grid, lane cards, lane head, `:850-946` `renderLanes`, `toggleLane`, `applyLaneFilter`, `:1658-1668` `focusSession` | same |
| `public/js/views/board-card.js` | `:656-848` `renderCard`, `toggleMenu`, `closeMenus` | same |
| `public/js/views/morning.js` | `:1020-1177` | `morning`, `loadMorning`, `renderMorning` |
| `public/js/views/credit.js` | `:1178-1381` minus `svg` | `loadCredit`, `renderCredit`, `usageChart` |
| `public/js/views/box.js` | `:1382-1501` | `renderBox`, `boxBlocks` |
| `public/js/views/map.js` | `:1796-1846` (`showMap`, `sizeMap`, `mapActions`, `pulseMapFor`; `mapView` becomes module state) + `update(model)` for net | `showMap`, `pulseMapFor`, `updateMap`, `init()` |
| `public/js/views/map-canvas.js` | `public/map.js` (verbatim; import becomes `../core/motion.js`) | `createMap`, `layout` (§5 M2-M4 later split it into `public/js/views/map/*.js` and leave this file as a re-export shim) |

Circular imports (board ↔ net ↔ render) are allowed. They are safe only because every cross-module use happens inside a function, never at evaluation time. A test enforces this (§4). `index.html:186` becomes `<script type="module" src="/js/app.js">`. The `import('/map.js')` at `app.js:1813` becomes `import('./map-canvas.js')`. `terminal.js` loads `/vendor/*.js` by absolute URL, and that stays.

**`http.mjs` hardening (part of F1).** A missing path that has an extension (`/\.[a-z0-9]+$/i`) returns 404 JSON instead of the SPA `index.html`. Also (moved from §4): an unmapped `/vendor/<rel>` falls through to `serveStatic(res, publicDir, 'vendor/'+rel, {immutable:true})` instead of 404 (`http.mjs:115-127`; MIME already has `.woff2`/`.svg`).

### 2.3 CSS map (F2)

The files are split in **contiguous** ranges and linked in source order, so the cascade is byte-identical. There is no reordering. The §4 restyles later.

| File | `styles.css` lines |
|---|---|
| `public/css/tokens.css` | 1-84, 105 (`:root` minus the alias block 85-104) |
| `public/css/base.css` | 106-201 (reset, `[hidden]` `!important` at `:111`, type) |
| `public/css/shell.css` | 202-371 (topbar, overlays, layout + breakpoints) |
| `public/css/rail.css` | 372-514 (rail, strip, pressure ring, gauges) |
| `public/css/board.css` | 515-690 (cards) |
| `public/css/terminal.css` | 691-789 (dock, sheet) |
| `public/css/misc.css` | 790-873 (scrollbars, reduced motion/transparency, views, tabs) |
| `public/css/lanes.css` | 874-1013 |
| `public/css/views/data.css` | 1014-1162 (Morning, Credit, tables, charts) |
| `public/css/views/box.css` | 1163-1265 (box, v3 lane cards, danger, kv, launch sheet) |
| `public/css/views/map.css` | `public/map.css` verbatim |

**Removing the aliases.** The only users are in `public/terminal.js:55-56` (`var(--mono)`, `var(--fg-faint)`, `var(--bg-inset)`). The fix: `var(--font-mono)`, `var(--text-3)`, `var(--bg-sunken)`. A `grep -rnE 'var\(--(bg|bg-raise|bg-card|bg-inset|line|line-soft|fg|fg-dim|fg-faint|red|amber|blue|green|grey|violet|radius|radius-sm|mono|sans)[,)]' public/` must come back empty. `map.js:79-92` reads only the non-alias tokens.

### 2.4 Fleet keys

`server/fleet/keys.mjs` and `public/js/core/keys.js` are **the same source**. The client file is a copy, and a test asserts the two exports behave identically on a shared vector table.

```js
export const BUILDER_ID_RX = /^[a-z0-9-]{1,24}$/;
export const SEP = '/';
export function fkey(builderId, name)   // throws TypeError if !BUILDER_ID_RX.test(builderId) or name is ''/non-string
export function parseFkey(k)            // -> {builder, name} | null; splits at the FIRST '/', so lane/session names may contain '/'
export function isFkey(k)               // parseFkey(k) !== null
export function localKey(k, builderId)  // name if k belongs to builderId, else null
export function laneNodeId(builderId, laneId) // `lane:${fkey(builderId, laneId)}`
export function sanitizeId(s)           // lower, [^a-z0-9-]+ -> '-', trim '-', slice 24, '' -> 'builder'
export function deriveCode(id)          // 'builder-a'->'BA', 'ci-2'->'C2', 'hub'->'HU'; /^[A-Z0-9]{2,3}$/
```

**Boundary rule.** Inside a builder process, `state.sessions`, `paneCache`, the terminals and tmux all stay keyed by local name: they are local by definition. Fleet keys appear wherever data leaves the process or is held by the UI.

- **Wire** (F7). Every `/ws` message gets `builder: config.fleet.id` (the hook-event broadcast is in `server/boot/builder.mjs` after X1). The first message is a new `{type:'hello', builder:{id,code}, mode, version, apiVersion:1}`. Each session gets `key: fkey(id, s.name)`, and `laneKey: s.lane ? fkey(id, s.lane) : null`. Attention entries get `key`. Lanes get `key`. Event messages get `event.key`. The `map` nodes for lanes use `laneNodeId(id, lane.id)`, and `session` holds the fkey. All of this is additive: `name` and `lane` stay.
- **`visible`** (F7). The client sends `{type:'visible', keys:[fkey…]}` (the hub sends the same shape upstream, with that builder's fkeys). `ws.mjs` applies `localKey(k, fleet.id)` and drops foreign keys. The legacy `names` is still accepted for one release.
- **`diffSessions(prev, sessions, keyOf = (s) => s.name)`** (F7). The key function is a parameter so the hub can reuse it with fkeys.
- **Push URLs** (F7). `push.mjs:134,160` become `/#/board?sel=<encodeURIComponent(fkey)>`, and `:179` becomes `/#/box`.
- **DB** (F7). A `builder TEXT NOT NULL DEFAULT ''` column on `events`, `cost_snapshots`, `markers`, `lane_jobs`, `pr_samples` and `rate_limit_samples`, added with the existing `addColumn` (`db.mjs:137-140`). `''` means **this process's own builder**, resolved at read time to `config.fleet.id`, so renaming `fleet.id` never orphans rows. Rows a hub writes for remote builders carry an explicit id. Markers need a builder-aware unique key. `PRAGMA user_version` is 0 today (unused). Steps for `0 → 1`: `addColumn`s, `DROP INDEX IF EXISTS markers_key`, `CREATE UNIQUE INDEX IF NOT EXISTS markers_key_b ON markers(builder, IFNULL(lane,''), IFNULL(session_name,''), text)`, `CREATE INDEX IF NOT EXISTS events_builder ON events(builder, session_name, ts DESC)`, `PRAGMA user_version = 1`. The legacy `markers_key` statement (`db.mjs:64-65`) would otherwise be re-created on every start. It becomes `{ sql, untilVersion: 1 }`, and the loop at `:130` skips it when `user_version >= 1`. This is the one sanctioned edit to the append-only list, and it gets a comment saying why. `addMarker`, `markerKeys`, `listMarkers`, `addEvent`, `listEvents` and `addCostSnapshot` gain an optional `builder = ''`. `markerKeys()` returns `builder` too (`collector/markers.mjs` dedupe).

### 2.5 Multi-source client store (F8)

`public/js/core/store.js` (pure reducers, importable by `node --test`):

```js
store = {
  builders: Map<id, Builder>,      // Builder below
  sessions: Map<fkey, Session>,    // derived index, written ONLY by the reducers
  lanes: Lane[],                   // derived: all builders, each lane has .key, .builder
  attention: Attention[],          // derived: all builders merged, sorted score desc, since asc
  map, generatedAt, view, cursor /*fkey*/, openSession /*fkey*/,
  pinned: Set<fkey>, laneFilter: Set<laneFkey>, builderFilter: 'all'|id,
  dockLayout, boxDirty, source: {kind:'local'|'hub', status:'connecting'|'open'|'closed'},
}
Builder = { id, code, mode, version, status:'connecting'|'live'|'stale'|'down',
            lastMsgAt, sessions: Map<localName, Session>, lanes, box, vitals,
            attention, generatedAt, host }
export function ingest(store, msg, now)  // routes by msg.builder (falls back to the source's hello id)
export function applySnapshot(store, builderId, msg) / applyDelta(...) / applyBuilders(store, list)
export function setSourceStatus(store, status)   // local source: builder.status mirrors it
export function migratePins(rawLegacyJson, localId) // ['a','b'] -> ['<localId>/a',…]; already-fkeys kept
```

`ingest` **always** sets `s.key`, `s.builder` and `s.laneKey` from the frame-level `msg.builder` (in hub mode stamped by the hub from the upstream connection) and the local `name`/`lane`; nested builder-supplied `key`/`laneKey`/`builder`/`fkey` fields are ignored (security review S2). `act()` addresses `{builder, name}` from the store entry, never from a nested field. Test: a snapshot for `b1` whose session carries `key:'b2/x'` produces an action addressed to `b1`. `store.sessions` is rebuilt per builder on a snapshot and patched on a delta, with removals by `fkey(builder, name)`. Two builders can each have a session `main` and they do not collide.

`public/js/core/net.js` becomes `createSource({ url, kind, onMessage, onStatus })` → `{ send(obj), reconnect(), close(), termUrl(fkey), kind }`.
- In builder mode, `termUrl(k)` is `/ws/term/${encodeURIComponent(parseFkey(k).name)}`.
- In hub mode it is `/ws/term/${b}/${encodeURIComponent(name)}`, the path §3 defines.
- `boot()` picks the kind from `GET /api/v1/hello` `mode` and keeps one source.
- Backoff stays as today: 500 ms, ×1.8, 15 s cap (`app.js:91,128`).
- Hub mode expects `{type:'fleet', hub:{version, now}, builders:[BuilderRow], aggregates}` from the hub (§3 2.5). `BuilderRow = {id, code, directUrl, state, ageMs, latencyMs, version, versionSkew, controls, capabilities}`; `applyBuilders(store, msg.builders)` maps `state` (`up|stale|down|connecting|misconfigured|incompatible`) onto `Builder.status` (`live` for `up`). The hub also sends `alarms`, `packages`, `approval`, `stuck`, `health` messages, each carrying `builder` where builder-scoped; `ingest` stores them per builder (`builder.health`, `builder.approvals`) or globally (`store.alarms`, `store.packages`).
- Store selectors (pure, used by §4): `builders(store)`, `lanes(store, scope)`, `alarms(store)`, `subscribe(fn)`.

`public/js/core/actions.js`: `act(fkey, action, args)`, plus `ACTION_TIERS` (the fallback copy of the README tier table; the live table comes from `hello.actions`). Transport, chosen per call:
- hub mode → `hubAct`: `POST /api/fleet/actions` body `{builder, action, target, args}` (§3 2.10), header `X-Laneboard: 1`; `builder:'*'` for hub fan-outs.
- builder mode, `hello.capabilities` includes `actions` (after §2 A8) → `POST /api/v1/actions` with an unsigned envelope `{v:1, id, ts, builder: helloId, action, target, args, via:'direct'}` and headers `content-type: application/json`, `X-Laneboard: 1`.
- otherwise (before A8 lands) the legacy REST map:
- `send-keys` → `POST /api/sessions/:name/keys`
- `send-text` → `/text`
- `restart`, `kill` → `DELETE`
- `launch` → `POST /api/lanes`
- `dismiss-marker`

Every call site in `board-card.js`, `sheet.js`, `dock.js` and `morning.js` goes through `act()`. Results are `{ok, result|error, code?, auditId?}`; a hub timeout returns `{ok:'unknown'}` and the UI says "sent, outcome unknown".

**UI.** `#conn` (`index.html:28`) becomes the source badge. A new `#builders` strip next to it shows one `code` chip per builder with a `status` class. In builder mode there is one chip. `#offline` (`index.html:21-24`) only shows when the **source** is closed. In hub mode a single down builder turns its chip red, and its cards dim with a `stale` class, but the global banner stays hidden. Cards, terminal panes, `cardNodes`, `laneNodes` and `onScreen` all switch from `dataset.name` to `dataset.key`. A card shows the builder code chip only when `store.builders.size > 1`.

**Router** (`core/router.js`, F8a; §4 D4 extends it). `parseHash(h) -> {view, b, s, q, sel, open}` and `formatHash(r)` handle the `#/<view>?b=&s=&q=&sel=&open=` form from the conventions, with §4's view list (`map board inbox packages morning credit box audit`, hidden `diff`) and `DEFAULT_VIEW = 'board'` (D4 flips it to `map`). The legacy forms keep working: `#board`, `#map` and friends map to the view, and `#session=<name>` becomes `{view:'board', sel: fkey(localId, name), open:'term'}`. They matter because old push notifications already sit in notification centres. Opening the sheet writes `sel`, and closing it removes `sel`. That keeps the guarantee at `render.test.mjs` "closing the sheet returns to a view". The map fold set migrates in `map-canvas.js:523`: entries `lane:<x>` with no `/` become `lane:<localId>/<x>`.

### 2.6 Security baseline (F5, F6)

New file `server/security.mjs` (pure, with no imports beyond config):

```js
export function allowedHosts(config)    // Set: `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}` (and the same for fleet.ingressPort), host of publicUrl, fleet.publicHosts, hosts of fleet.allowedOrigins
export function checkHost(req, config)  // Host header ∈ allowedHosts, else 'bad-host'   (DNS-rebinding defence; applies to EVERY request and upgrade)
export function checkOrigin(req, config)// no Origin -> ok (curl, CLI, hooks, node ws); Origin === `${proto}://${Host}` or ∈ fleet.allowedOrigins or publicUrl origin -> ok; else 'bad-origin'
export function isMutating(method)      // not GET/HEAD/OPTIONS
export function checkCsrf(req, pathname)// mutating && !HOOK_PATHS.has(pathname) && req.headers['x-laneboard'] !== '1' -> 'no-csrf-header'
export const HOOK_PATHS = new Set(['/api/hook', '/api/hook/permission'])  // local hook intake (curl from Claude Code hooks)
export function securityHeaders(req, { html }) // CSP etc., below
```

**Wiring**
- `http.mjs handleRequest`: before routing, `checkHost`, then (mutating) `checkOrigin` and `checkCsrf`. Any failure is a 403 `{error:'forbidden', reason}`, plus a `log.warn` rate-limited to once a minute per reason.
- `OPTIONS` gets a 405. We never answer CORS preflight, which is exactly what makes the custom header a CSRF barrier.
- Upgrade (now in `server/boot/common.mjs` `listenAll`, moved there by X1 from `index.mjs:432`): `checkHost` and `checkOrigin` before any upgrade handler runs. §2 A8 later replaces this call with `auth.guardUpgrade`, which calls the same functions. On failure, write `HTTP/1.1 403 Forbidden\r\n\r\n` and destroy the socket.

**Why `/api/hook` (and §8's `/api/hook/permission`) are exempt from the header.** Users' installed `~/.claude/settings.json` posts there with plain curl (`deploy/hooks.json`). It still gets the Host and Origin checks, so a cross-site form post, which carries an Origin, is refused.

**Clients that must send the header**
- `core/net.js` `post()` and `del()`
- the launch `fetch` (`app.js:988`, now `public/js/ui/launch.js`)
- the client-metrics `fetch` (`app.js:377`, now `public/js/ui/render.js`)
- `bin/laneboard` `api()` (`bin/laneboard:58`)
- `deploy/soak.sh:46`, which posts to the hook and is exempt, but add it anyway

**Headers** (`serveStatic` for `.html` and the SPA fallback; the same function serves the hub, §3 uses it unchanged): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://<Host> wss://<Host>; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`.
- `ws://<Host>` is spelled out because older WebKit does not match ws to `'self'`.
- `style-src 'unsafe-inline'` is needed because xterm's DOM renderer injects `<style>` elements. CSSOM writes (`el.style.setProperty`, used at `app.js:257,289,556,…`) are not affected by CSP.
- Every static response and JSON response also gets `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

**F6: no HTML from data.**
- `public/js/core/ansi.js` is a client port of `server/ansi.mjs`. `ansiLineToNodes(line, doc) -> Node[]` builds `span` elements with `textContent`. It sets `style.color`, `style.background` and friends only from the FG tables, or from `rgb(n,n,n)` with each `n` clamped to an integer 0-255. `collapseRules` is copied too.
- Wire change in `state.mjs:423-427`: `previewHtml` is replaced by `previewLines` (raw ANSI strings, blanks dropped, last 8, each sliced to 400 chars).
- `board-card.js` renders with `pre.replaceChildren(...lines.flatMap(...))`.
- `map-canvas.js:231,1544` `innerHTML = ''` becomes `replaceChildren()`.
- `server/ansi.mjs` stays for `/api/sessions/:name/preview` (`index.mjs:196-201`).
- **Contract for §2/§3:** `/api/v1/snapshot` and the v1 stream strip `preview` (and any `previewHtml`) and carry `previewLines`; the hub forwards `previewLines` only for sessions in some client's visible set.
- The lint rule (forbidden `innerHTML` etc. under `public/js/**`) lives in a new `test/frontend-safety.test.mjs`, so F6 does not edit `test/frontend.test.mjs`.

### 2.7 Config (F4)

New config fragment `server/config/fleet.mjs` (X1's fragment mechanism; `server/config.mjs` is not edited):

```js
// mode: 'builder' lives in X1's server/config/mode.mjs ('builder' | 'hub'; 'both' rejected)
fleet: {
  id: sanitizeId(os.hostname()),       // /^[a-z0-9-]{1,24}$/
  code: '',                            // '' -> deriveCode(id) after merge; else /^[A-Z0-9]{2,3}$/ (uppercased)
  allowedOrigins: [],                  // exact origins, e.g. 'https://hub.example.invalid'
},                                     // hubKeys etc.: §2 server/config/fleet-auth.mjs; builders etc.: §3 server/config/hub.mjs
```

`fromEnv` additions:
- `LANEBOARD_FLEET_ID`
- `LANEBOARD_FLEET_CODE`
- `LANEBOARD_ALLOWED_ORIGINS` (comma list, via `list()`)

`validate()` additions:
- the id regex
- the code regex
- each allowed origin must parse with `new URL()`, have `origin === value`, and use https, or http on loopback

The fragment's `defaults()` computes `fleet.code ||= deriveCode(fleet.id)` after env merge (fragments may export `finalize(c)`; X1 runs them after merging). It imports `sanitizeId` and `deriveCode` from `server/fleet/keys.mjs`. `docs/fleet/identity.md` gets the rows for these keys and the paragraph "in `builder` mode with no `fleet` keys, behaviour is exactly as before"; X4 copies them into `docs/config.md`.

### 2.8 API v1 skeleton (F9)

New files `server/fleet/api-v1.mjs` (handlers + registry: `addCapability(name)`, `addHelloField(name, fn)`) and `server/routes/v1.mjs` (an X1 route module, `modes:['builder']`, that registers the routes). The registry is a module singleton: other route modules `import { addCapability, addHelloField } from '../fleet/api-v1.mjs'` (export `_reset()` for tests):
- `GET /api/v1/hello` → `{id, code, version, apiVersion: 1, mode, capabilities: ['snapshot', ...registered], actions: {}, time: Date.now(), ...helloFields}`. §2 A8 fills `actions` and `auth`.
- `GET /api/v1/snapshot` → `{...state.snapshot(), sessions: snap.sessions.map(ws.forWire), builder: {id, code}, seq: ws.currentSeq()}`. `ws.forWire` (`ws.mjs:10`, F6) drops `preview`; §2 A7 adds `epoch`.
- `ws.mjs` gets a `seq` counter, incremented by every `send()`, and exports `currentSeq()`. Every message carries `seq`.
- The module declares `modes:['builder']`, so a hub never registers these routes (404).
- `VERSION` is imported from `server/version.mjs` (created by X1).
- No auth beyond §2.6 here. §2 A8 adds request classification in `http.mjs`, which then applies to these routes too.

## 3. Tasks (dependency order)

| Task | Depends on | Files owned | Work | Done when |
|---|---|---|---|---|
| **F1 Mechanical JS split** | X1, F3 (wave 0, sequential) | `public/js/**` (new), delete `public/app.js`, `public/map.js`, `public/terminal.js`, `public/motion.js`; `public/index.html:186`; `test/render.test.mjs`, `test/frontend.test.mjs`, `test/motion.test.mjs`; `package.json` (test script); `server/http.mjs` (extension 404 + vendor fall-through) | Move the code per §2.2. Do not rename functions, and change only `import`/`export` and `init()` wrappers. Harness: `mount()` becomes `async` and uses `vm.SourceTextModule` with a linker that reads `public/js/**` fresh per context and serves a `SyntheticModule` stub for `./ui/terminal.js` (the same stub as `render.test.mjs:207-208`). Add `--experimental-vm-modules` to `NODE_OPTIONS` in `package.json`. The `frontend.test.mjs` scans iterate over every `public/js/**/*.js`, and an imported binding counts as declared. | `npm test` green with the same test count; `git diff --stat` shows only moves, import/export, `init`, the harness; `HUMAN:` load the board, open a sheet, pin, view the map, and switch views on a phone and the 49" |
| **F2 CSS split + aliases** | F1, X2 | `public/css/**` (new), delete `public/styles.css`, `public/map.css`; `public/index.html:9-10`; `public/js/ui/terminal.js:55-56`; the CSS reads in `test/frontend.test.mjs`, `test/render.test.mjs:757` (a helper `readCss()` concatenates in link order) | Do §2.3 | `cat` of the css files in link order equals `styles.css` without lines 85-104, followed by `map.css` (test); alias grep empty; `HUMAN:` screenshots before and after identical |
| **F3 Keys** (= §11's w0-keys) | (wave 0, after X1) | `server/fleet/keys.mjs`, `public/js/core/keys.js` (creates `public/js/core/`), `test/keys.test.mjs` | Do §2.4 | the test passes; parity vectors are identical for both files |
| **F4 Config** | X1, F3 (wave 0) | `server/config/fleet.mjs`, `test/config-fleet.test.mjs`, `docs/fleet/identity.md` | Do §2.7 | config tests for defaults, env, bad id, bad code, bad origin (`mode:'both'` is X1's test) |
| **F5 Security baseline** | F1, F4, X1 | `server/security.mjs`, `server/http.mjs`, `server/boot/common.mjs` (upgrade guard only), `bin/laneboard:58`, `deploy/soak.sh:46`, `public/js/core/net.js` (`post`/`del`), `public/js/ui/launch.js`, `public/js/ui/render.js` (metrics fetch), `test/security.test.mjs` | Do §2.6 (without F6) | security tests; `curl -X POST /api/sessions/x/keys` without the header gives 403; with `-H 'Host: evil.example.invalid'` it gives 403; the hook curl from `deploy/hooks.json` still gives 200; `Host: <publicHost>` without its `:port` → 403; `OPTIONS` → 405; the CSP header carries `object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. REVIEW-REQUIRED (SR7) |
| **F6 Client-side preview** | F2, X1 | `public/js/core/ansi.js`, `public/js/views/board-card.js`, `public/js/views/map-canvas.js` (2 lines), `server/state.mjs:420-427`, `server/ws.mjs:10-13`, `test/fixtures/snapshot.json` (regenerate `previewLines`; the one sanctioned edit of this fixture), `test/ansi-dom.test.mjs`, `test/frontend-safety.test.mjs` (lint rule), `test/render.test.mjs` (preview assertions) | Do §2.6 F6 | no `innerHTML` with data left; the render test shows previews; `test/ansi.test.mjs` still passes |
| **F7 Server fleet keys** | F3, F4, F6 | `server/ws.mjs`, `server/state.mjs:160-162` (attention `key`), `server/boot/builder.mjs` (event broadcast, was `index.mjs:182-188`), `server/push.mjs:134,160,179`, `server/map.mjs:354,362`, `server/db.mjs`, `server/collector/markers.mjs` (dedupe key), `test/delta.test.mjs`, `test/db-builder.test.mjs`, `test/map.test.mjs`, `test/push-urls.test.mjs` | Do §2.4 wire/visible/push/DB | delta test with `keyOf`; `visible` with foreign keys ignored; migration test on an in-memory DB pre-seeded with v0 schema and duplicate markers; push URL test |
| **F8a Store + sources** | F1, F3, F7, F5, SR7 | `public/js/core/store.js`, `net.js`, `actions.js`, `router.js`, `test/store.test.mjs`, `test/router.test.mjs`, `test/actions-client.test.mjs` | Do §2.5 reducers, source, router, pins migration | pure tests: two builders with the same name, a delta removal by fkey, attention merge order, `migratePins`, legacy `#session=`; a `b1` snapshot whose session carries `key:'b2/x'`, `builder:'b2'`, `laneKey:'b2/y'` yields store keys `b1/…` and an `act()` envelope addressed to `b1` (S2); a hash/URL parameter never triggers `act()`. REVIEW-REQUIRED (SR8) |
| **F8b UI on fkeys** | F8a, F6, F2 | exactly: `public/js/views/{board,board-card,map,map-canvas,morning}.js`, `public/js/ui/{shell,rail,dock,sheet,hotkeys,render}.js`, `public/index.html` (`#builders`), `test/render.test.mjs` (fixtures get `builder`), `test/render-fleet.test.mjs` (new multi-builder cases) | Switch every `dataset.name` / `s.name` lookup to `key`; add the builder chips and per-builder status; the map fold migration | the render tests pass, plus new ones: a second builder snapshot renders beside the first, and one builder down leaves the banner hidden with its chip `down`; `HUMAN:` an old pin survives the upgrade |
| **F9 API v1 skeleton** | X1, F4, F7 | `server/fleet/api-v1.mjs`, `server/routes/v1.mjs`, `test/api-v1.test.mjs` | Do §2.8 | hello/snapshot shape tests; no `preview`/`previewHtml` key in the snapshot |

**Parallelism.** Wave 0 (sequential): X1, F3, F4, A1, F1, X2. Then F2 and F5 in parallel; F6 after F2; F7 after F6; F8a after F7+F5 and F5's security review SR7; F8b after F8a; F9 after F7. The global DAG and waves are in README.md.

**Who depends on what later**
- §2 (builder API and auth) needs F4, F5 and F9.
- §3 (hub) needs F3, F7 (`diffSessions` `keyOf`, the wire shape) and F8a (`createSource` kind `hub`, the `fleet` message, `hubAct`).
- §4 (design system/shell) needs F1, F2 and F8b. Its new router views extend `core/router.js`.
- §5 (fleet map) needs F7's `laneNodeId` and the F8b fold migration.
- §7, §8, §10 need F8a's per-builder store and `act()`.
- §6 (packages/CI) needs F4's config pattern only.

## 4. Tests to add or change

- `test/keys.test.mjs`
  - `fkey`/`parseFkey` round-trip, including names with `/`, unicode and spaces.
  - Rejects bad builder ids.
  - `sanitizeId` for `'Builder_A.local'` gives `'builder-a-local'`; `''` gives `'builder'`; a 40-char input is cut at 24.
  - `deriveCode` vectors.
  - A parity test imports both the server and client files and compares outputs on 30 vectors.
- `test/config-fleet.test.mjs`: defaults (`fleet.id` matches the regex, `code` derived); env overrides; `ConfigError` for `fleet.id:'Bad Id'`, `fleet.code:'TOOLONG'`, `allowedOrigins:['ftp://x']`. (`mode:'both'` is in X1's `test/config-fragments.test.mjs`.)
- `test/security.test.mjs`
  - Host allowlist: loopback ok, publicUrl host ok, `evil.example.invalid` refused.
  - Origin: missing ok, same ok, allowed-list ok, foreign refused.
  - CSRF: POST without the header gives 403, `/api/hook` and `/api/hook/permission` without the header are ok, GET without the header is ok.
  - `handleRequest` with fake req/res returns 403 and never calls the route handler.
  - `index.html` response carries a CSP with `script-src 'self'` and `frame-ancestors 'none'`.
  - An upgrade with a bad Origin is destroyed with a 403 line.
- `test/ansi-dom.test.mjs`
  - With a fake `document`: `'\x1b[31m<img src=x onerror=alert(1)>'` yields one span whose `textContent` is the literal and has no element children.
  - `38;2;999;-1;abc` clamps to `rgb(255,0,0)`.
  - Output equals `server/ansi.mjs` for 20 vectors once serialised.
- `test/frontend.test.mjs` (+, F1)
  - Every relative import in `public/js/**` resolves to a file that exports the named binding.
  - No module has a top-level `$(`/`document.` call outside a function (checked on `stripNonCode`).
- `test/frontend-safety.test.mjs` (F6): forbidden anywhere under `public/js/**`: `innerHTML\s*=\s*(?!['"]{2})`, `insertAdjacentHTML`, `outerHTML\s*=`, `document.write`, `new Function`, `eval(`.
  - No alias tokens in CSS or JS.
  - `sw.js` still has no Cache API.
- `test/delta.test.mjs` (+): `diffSessions` with `keyOf = (s) => fkey('b', s.name)`.
- `test/db-builder.test.mjs`
  - Create a v0 schema, run the migration twice: idempotent, `user_version` 1, column present.
  - The same marker text inserted for builders `''` and `'builder-b'` gives two rows.
  - The same marker inserted twice for one builder gives one row.
- `test/store.test.mjs`: the §2.5 assertions plus `migratePins('["a","b/x"]','builder-a')` gives `['builder-a/a','b/x']`. A key that already has a slash is kept. That is safe: a legacy local name never contains `/`, because `isSafeSessionName` refuses it (`terminals.mjs:305`).
- `test/router.test.mjs`
  - `#session=foo` gives `{view:'board', sel:'<local>/foo'}`.
  - `#map` gives map.
  - `#/inbox?b=all&sel=builder-b%2Fx` round-trips.
  - Unknown input gives `DEFAULT_VIEW` (board until D4).
- `test/api-v1.test.mjs`: hello keys and types; snapshot has `builder` and `seq`, and no session has `preview`/`previewHtml`; a module with `modes:['builder']` is not loaded in hub mode (404).
- `test/render.test.mjs` (changed in F1 and F8b): async `mount()`; every existing test kept; plus the multi-builder tests from F8b.

## 5. Risks, open questions, human checks

- **`vm.SourceTextModule` is flagged.** In Node 24 it needs `--experimental-vm-modules` and prints an ExperimentalWarning. If it breaks in a later Node, the fallback is a test-only loader that runs each module through a `new Function` wrapper. A fallback that imports the real modules once per process, with globals stubbed and a `reset()` export, is rejected: it would share state across tests.
- **The F1 behaviour drift risk is the top-level wiring order.** Mitigation: `boot()` lists the `init()` calls in source order, with comments quoting the old line numbers. Reviewers diff `app.js` against the concatenation of the modules with import/export stripped.
- **Every page load fetches more modules.** That is about 22 module requests with `cache-control: no-cache` (`http.mjs:91`) and no validators. Optional follow-up: `Last-Modified`/`ETag` in `serveStatic`. Not required.
- **Host allowlist.** `tailscale serve` must forward the original `Host` (the serve hostname). `HUMAN:` after F5, open the board through tailscale serve. If it 403s with `bad-host`, set `publicUrl` correctly or add the origin to `fleet.allowedOrigins`.
- **CSP and xterm.** `HUMAN:` open a terminal with the devtools console open and confirm no CSP violations. If the WebLinks addon opens windows, `form-action`/`navigate-to` do not apply. Fine.
- **`bin/laneboard` and Node's fetch.** It sends no Origin, so only the new header matters there. Old copies of `bin/laneboard` without the header get 403 on actions. Noted in the CHANGELOG. **Open:** keep a `LANEBOARD_INSECURE_NO_CSRF=1` escape hatch? Recommendation: no.
- **Wire compatibility.** `previewHtml` → `previewLines` is a breaking change on the wire for an old open tab. That is harmless: the tab reloads on its next deploy, and a missing `previewHtml` already renders no preview (`app.js:768`).
- **Legacy `names` in `visible`** is removed in a later release. Tracked in the CHANGELOG.
- **Hub fold-set migration.** `localStorage` is per origin, so the hub origin starts with empty pins and folds. Only builder UIs migrate.

## 6. Dependencies on other sections

None upstream. This section is the base. Downstream consumers are listed under §3 "Who depends on what later". Contracts this section fixes for the others:
- the `hello` message and the per-message `builder` and `seq`
- `key`/`laneKey` on sessions, attention, lanes and events
- `laneNodeId`
- `previewLines`
- `{type:'fleet'}` from the hub (§3), consumed by `applyBuilders`
- `createSource`/`act`/`hubAct` hooks on the client
- `diffSessions(prev, sessions, keyOf)`
- `fleet.allowedOrigins`
- the `X-Laneboard: 1` header requirement; hub-relayed requests (§3 relay) send it too, so the check is uniform

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
