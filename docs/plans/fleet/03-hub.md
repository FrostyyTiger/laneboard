# Section 3: The hub server (`mode: "hub"`)

**Integration notes (integrator):**
- Boot split (2.1) is executed by §11 X1 in wave 0 with exactly this layout (`server/index.mjs` dispatcher, `server/boot/{common,builder,hub}.mjs`); H2 is folded into X1, and the "hub never loads the collector graph" test is in X2's `test/boot.test.mjs`. Hub routes are modules in `server/hub/routes/*.mjs` loaded by `loadModules("hub/routes", ctx)`.
- `mode` is X1's (`server/config/mode.mjs`); H1 is the fragment `server/config/hub.mjs`. Builder `code` default = the configured value, else `hello.code`, else `deriveCode(id)`.
- Stuck detection runs on builders (§7); the hub only consumes `stuck` frames and derives alarms (§7 O8 registers a hub service). Push on the hub is §7 O9 (`notify` on alarm raise), replacing 2.8's `push.onTransition` wiring.
- Previews are `previewLines` (§1 F6); the store clamps `previewLines` and client-ws forwards them only for visible sessions. Visible messages are `{type:"visible", keys:[fkey]}` both browser→hub and hub→builder.
- Signing uses `auth.signRead({method, url, builderId, key, keyId})` (four headers incl. `X-Laneboard-Key`) and `auth.signEnvelope` from §2 A4. Relay sends `X-Laneboard: 1` and `X-Laneboard-Key`.
- The fleet Map server model (2.7) is owned by §5 M1 (H10 folded into M1). §5's node contract wins: builder nodes are `kind:"builder"`, id `builder:<id>`, attached under a topology node with `builder:<id>` or under synthetic `__fleet` (not `kind:"host"` under the core).
- Hub auth uses §2 `classify` + `guardRequest`; `fleet.ingressPort` is required in hub mode; `LANEBOARD_DEV` is dropped (the non-ingress listener is `local`, as on builders). CSP comes from §1 `securityHeaders` (keeps `style-src 'unsafe-inline'` for xterm).
- New tasks: H12 signed read proxy (allowlist needed by §7, §8, §10), H13 audit reconciliation (feeds §4 D12 Audit view). Relay gains a hub-local action registry (`registerHubAction`) used by §8 (broadcast, fleet kill, fan-out pause/resume) and §7 (ack-alarm).
- Aggregates `ci` stays builder-reported (§6 decided builders collect); §6 P11 adds the packages merge as a service.
- Task ids match the global DAG (README.md). Private details moved to `private/03-private.md`.
- Adopted from the late security review (INTEGRATION-REPORT.md): the store strips every builder-supplied routing field and re-validates names into `Map`s with caps (2.4); relay converts a typed `fleet` confirm into per-builder ids (2.10 7b); terminals use a signed `term` envelope (2.12); H13 writes `audit.anchor` entries and raises `audit-fork`; builder URLs must be https unless loopback, `fleet.builders[].repos` is an optional placement allowlist, and hub `allowedOrigins` may not contain a builder origin (H1); H11 adds a canary test on who imports the signers.
- **Security fixes pass (see `SECURITY-FIXES.md`):** every hub action (relayed or hub-local: broadcast, fleet kill, fan-out pause/resume, ack-alarm) and every proxied terminal requires kind `direct`; `local` on the hub may only read (2.8). The builder-side key scopes of §2 apply: the hub's key needs `control` for relayed actions and `term` for terminals. Byte-rate and response caps are enforced in `upstream.mjs` (H6) and have tests; H11 re-asserts the web baseline on the hub (Host with port, `X-Laneboard: 1`, `OPTIONS` 405, CSP) and that `node-pty` is never loaded in hub mode (the hub installs with `npm ci --ignore-scripts`). `upstream.mjs`, `relay.mjs`, `term-proxy.mjs`, `fleet-store.mjs`, `read-proxy.mjs`, `audit-reconcile.mjs`, `broadcast.mjs`, `fleetkill.mjs`, `boot/hub.mjs` and `hub/routes/core.mjs` are REVIEW-REQUIRED (README 4.5) and get independent SR review tasks.

## 1. Goal and scope

**In:** a second boot path for the same codebase that runs no local collectors and instead keeps one signed upstream WebSocket per builder, merges their snapshots into a fleet store, serves the fleet UI over its own `/ws`, relays control actions (signed, user-attributed, audited), proxies terminals, builds the fleet-wide Map, computes fleet aggregates (attention, rate limit, cost, CI queue), chooses a builder for new lanes (placement), and degrades visibly when a builder or the hub itself is down.

**Out (owned elsewhere):** the Builder API v1 endpoints and `server/fleet/auth.mjs` (signing, verifying, nonce LRU, key files, `laneboard fleet keygen`: §2), the audit log module (§2), the frontend (views, rail, map drawing: §4, §5), the fleet Map model (§5 M1), stuck detection (§7, on builders), alarms and notifications (§7), approvals and budget logic (§8, on builders), conflict prediction (§6, on builders). The hub *hosts* those fleet-derived services through the hook described in 2.9, it does not implement them. `mode: "both"` is **not** supported: `state.mjs` and `ws.mjs` are module singletons (`server/ws.mjs:6-7`, `server/state.mjs:114`), and running both in one process would mean two diff baselines and two `/ws` meanings. A host that wants both runs two processes on two ports.

## 2. Design

### 2.1 Mode switch and boot split (implemented by §11 X1 in wave 0)

Today `server/index.mjs` is one 538-line script: it registers every route at import time (`:43-351`), sets `state.setExtras(boxPayload)` (`:419`), listens (`:423-452`), and starts every collector (`:470-536`). `server/ws.mjs:4` imports `state.mjs`, which imports tmux, git, transcripts and the other collectors at module load (`server/state.mjs:6-18`), and `server/terminals.mjs` loads `node-pty`. So the hub must never statically import `ws.mjs`, `state.mjs`, `terminals.mjs` or `actions.mjs`. Hence the split:

| File | Content |
|---|---|
| `server/index.mjs` | ~15 lines: process error handlers (`:31-32`), `mkdirSync(config.dataDir)`, then `await import(config.mode === 'hub' ? './boot/hub.mjs' : './boot/builder.mjs')`. Dynamic import is the point: hub mode loads none of the collector graph. |
| `server/boot/common.mjs` | `VERSION` (`:39-41`), `startedAt`, `listenAll({onUpgrade})` (`:423-452`, with the `/ws` and `/ws/term/` branches replaced by a passed-in `onUpgrade(req, socket, head, url) -> bool`), `shutdownHooks` and `shutdown()` (`:457-468`), and `registerHealthz(extra)` which registers `/healthz` (`:43-62`) with a mode-specific `extra()` merged in (`terminals`, `wsClients` for the builder; `builders: {up, stale, down}` for the hub). It exports `upgradeHandlers` (today `:455`). |
| `server/boot/builder.mjs` | Lines 64-537 of today's `index.mjs` moved verbatim, plus the `onUpgrade` that does what `:433-441` does. Behaviour is byte-for-byte unchanged; this is a move, not a rewrite. |
| `server/boot/hub.mjs` | The hub wiring (2.8). X1 ships a stub that listens and serves `/healthz` and the shell; H11 fills it, provides the hub ctx services (`store`, `relay`, `readProxy`, `services`, `broadcast`, `onClientMessage`, `audit`) and only then calls `loadModules('hub/routes', ctx)`. |
| `server/modules.mjs` | X1's `loadModules(dir, ctx)`; builder mode loads `server/routes/*.mjs` and `server/flags/*.mjs`, hub mode loads `server/hub/routes/*.mjs`. |

Config: `mode: "builder" | "hub"` (default `"builder"`; env `LANEBOARD_MODE`) lives in X1's fragment `server/config/mode.mjs`, which rejects any other value (`"both"` included). H1's fragment rejects `mode: "hub"` with an empty `fleet.builders` or a null `fleet.ingressPort`.

### 2.2 Config keys (inside the `fleet` block; fragment `server/config/hub.mjs`)

The identity keys (`fleet.id`, `fleet.code`, `fleet.allowedOrigins`: §1 F4) and the auth keys (`fleet.hubKeys` with scopes, `fleet.ingressPort`, `fleet.hubControl`, `fleet.allowedUsers`, `fleet.ingressPeerUid`, …: §2 A5) are not redefined here (`hubKeys`, `hubControl` and `hubAddrs` are builder-side and ignored in hub mode). This section adds:

```js
fleet: {
  builders: [],          // [{ id, url, code?, directUrl?, account? }]
  hubKeyFile: paths.hubKeyFile(),   // §2 server/fleet/paths.mjs: $XDG_CONFIG_HOME/laneboard/hub.key, fallback ~/.config/laneboard/hub.key
  staleMs: 15_000,       // no frame for this long -> stale
  downMs: 60_000,        // no frame for this long -> down
  batchMs: 250,          // hub->browser delta coalescing window
  pingMs: 5_000,         // upstream ping cadence (latency + liveness)
  actionTimeoutMs: 15_000,
  maxTermsPerBuilder: 8,
  placement: { minFreeMemMb: 4096, maxSwapFrac: 0.5 },
}
```

Validation: each builder `id` matches `/^[a-z0-9-]{1,24}$/` and is unique; `url` is `https://` (plain `http://` only for a loopback host, used by tests) with no path beyond `/`; optional `repos: [names]` (placement allowlist, 2.11); hub `fleet.allowedOrigins` must not contain any builder `url`/`directUrl` origin; no code anywhere sets `rejectUnauthorized:false` (grep test in H11); `code` is 2-3 chars `[A-Z0-9]` (default: the builder's `hello.code` once connected, else `deriveCode(id)` from `server/fleet/keys.mjs`); `directUrl` (the URL a *browser* uses to reach that builder's own UI; default `url`) is http(s); `account` (default `"default"`) groups builders that share one subscription for the rate-limit aggregate (2.6). `staleMs < downMs`. Env: `LANEBOARD_FLEET_BUILDERS` as `id=url,id=url` for a scratch hub. Documented in `docs/fleet/hub.md` (X4 copies the rows into `docs/config.md`).

### 2.3 `server/hub/upstream.mjs`: one client per builder

```js
export class Upstream extends EventEmitter {
  constructor({ builder, key, store, sign, now = Date.now, WebSocketImpl = WebSocket, fetchImpl = fetch, cfg })
  start(); stop();
  send(msg)              // JSON frame upstream (used for `visible`)
  status()               // {state, lastSeen, latencyMs, attempts, error}
}
export function backoffMs(attempt, rand = Math.random)   // pure
export function classify({ lastSeen, connected, now, staleMs, downMs })  // pure
```

Lifecycle of one connection:

1. **Hello.** `GET {url}/api/v1/hello` with read-signature headers (`auth.signRead({method:'GET', url, builderId: builder.id, key, keyId})` returns `{'X-Laneboard-Ts', 'X-Laneboard-Nonce', 'X-Laneboard-Key', 'X-Laneboard-Sig'}`, §2 A4). Check `hello.id === builder.id`. A mismatch sets state `misconfigured` and retries only every 60 s: a hub pointed at the wrong box must not show its lanes under the wrong name. Check `apiVersion === 1`. Anything else sets `incompatible`, which is read-only (2.5). Record `versionSkew` = `same | patch | minor | major` from comparing `hello.version` with the hub `VERSION` (semver triple compare, in `fleet-store.mjs`), and `clockSkewMs = hello.time - midpoint(request)`.
2. **Stream.** `new WebSocket(url.replace(/^http/, 'ws') + '/api/v1/stream', { headers: signRead(...), maxPayload: 8 MiB, handshakeTimeout: 10_000 })`. No `Origin` header is set (the `ws` client sets none by default). The builder's auth accepts a signed request without an Origin, and a browser cannot forge the signature.
3. **Frames.** Every builder frame is `{builder, seq, ...msg}`. Process them in order:
   - `builder !== this.id`: drop the frame and log it once per minute (an untrusted builder lying about who it is).
   - `type === 'snapshot'`: `store.applySnapshot(id, msg)`, `lastSeq = msg.seq`.
   - Other types: if `msg.seq !== lastSeq + 1`, it is a **gap**. Stop applying and run resync: `GET /api/v1/snapshot` (signed), `store.applySnapshot`, `lastSeq = snap.seq`. Frames received during the resync are buffered (cap 200) and replayed, dropping any whose `seq <= snap.seq`. A second gap within 10 s closes the socket instead (reconnecting is the cleaner resync).
   - `delta` → `store.applyDelta`; `map` and `alarms` → ignored (the hub builds its own Map, §5 M1, and derives its own alarms, §7 O8); `event`, `health`, `approval`, `stuck`, `repos` → `store.applyEvent(id, msg)`, which updates the per-builder entry (`snap.health`, `snap.approvals` by op, `snap.sessions[name].stuck`, `snap.repos[repo]`) and re-emits for fan-out and for the hosted services.
   - Each frame updates `lastSeen`.
4. **Liveness.** A protocol `ping` every `pingMs`. `pong` gives `latencyMs` (EWMA α=0.3) and updates `lastSeen`. A timer every 1 s runs `classify()`:
   - `connected && now-lastSeen < staleMs` → `up`
   - `now-lastSeen < downMs` → `stale`
   - otherwise → `down`
   - never seen → `connecting`

   A socket close does **not** jump straight to `down`. A builder restart takes about 3 s, and flapping the whole column to "down" for that would be noise.
5. **Reconnect.** `backoffMs(n) = min(30_000, 500 * 1.8^n) * (0.8 + 0.4 * rand)`. `n` resets to 0 once a connection has been `up` for 30 s. On reconnect the builder sends a fresh `snapshot` first (as `ws.attach` does today, `server/ws.mjs:96-98`), so no extra resync call is needed.
6. **Bounds.** A frame larger than `maxPayload` makes `ws` close with 1009 before any `JSON.parse`. That counts as a failure with `error: 'frame too large'`, and backoff applies. The upstream counts received bytes in a 1 s sliding window: above 2 MiB/s it closes with 1008 `error:'rate'` and backs off (the builder is either broken or hostile). Every HTTP read to a builder (hello, snapshot resync, audit pulls, proxied reads) uses `AbortSignal.timeout` (hello/snapshot 10 s, others as in 2.14) and reads at most a fixed byte cap (hello 64 KiB, snapshot 8 MiB, audit 4 MiB) before parsing; over the cap → `error:'response too large'`.

The upstream is the only place the hub sends anything to a builder over the stream: a `{type:'visible', keys:[...]}` (≤64 fkeys of that builder, the union of hub clients' visible sessions *on that builder*). With it the builder keeps its capture-pane rate honest (`server/ws.mjs:103-105`, `:117-120`). The builder stream accepts `visible` (§2 2.9).

### 2.4 `server/hub/fleet-store.mjs`: merged state

Pure, with no IO and no timers (time is passed in), so it is fully unit-testable.

```js
export function createFleetStore({ builders, hubVersion, staleMs, downMs }) -> {
  applySnapshot(id, msg, now) -> { changed: names[], removed: names[] }
  applyDelta(id, msg, now)    -> { changed, removed, lanes?: true, box?: true, vitals?: true }
  applyEvent(id, msg, now)
  setConn(id, { state, latencyMs, hello, error, lastSeen })
  builder(id) -> BuilderEntry | null
  list() -> BuilderEntry[]               // config order
  session(fkey) -> { builder, session } | null
  view(now) -> FleetView                 // what map + aggregates consume
  subscribe(fn) -> unsubscribe           // fn({ builder, kind, changed, removed })
}
```

`BuilderEntry`:

```js
{ id, code, url, directUrl, account,
  conn: { state: 'connecting'|'up'|'stale'|'down'|'misconfigured'|'incompatible',
          lastSeen, connectedAt, latencyMs, attempts, error },
  hello: { version, apiVersion, capabilities, time } | null,
  versionSkew: 'same'|'patch'|'minor'|'major'|null, clockSkewMs,
  seq,
  snap: { sessions: Map<name, session>, lanes: [], box: {}|null, vitals: {}|null,
          attention: [], generatedAt, repos: {}|null, approvals: [], budget: []|null, health: {}|null } | null,
  snapAt }      // hub clock when the last snapshot/delta was applied
```

Merge rules are the browser's own rules (`public/app.js:107-118`): sessions are upserted by `name`, `removed` deletes, and `lanes`/`box`/`vitals`/`attention` are replaced when present. **Routing identity comes only from the upstream connection:** the store deletes `key`, `laneKey`, `fkey`, `builder`, `session` (map/fkey fields), `event.key` and `approval.builder` from every builder-supplied object, and fan-out recomputes them as `fkey(id, name)` from the connection's builder id. Every builder-keyed collection is a `Map` (never a plain object). Names are re-validated (`isSafeSessionName` from `server/util.mjs`, `store.isLaneId`-equivalent regex, `BRANCH_RE`); failures are dropped and counted. Caps on snapshot **and** delta: sessions 500, lanes 200, attention 200, approvals 100, events 20/s per builder (excess dropped, counted); an upstream above 2 MiB/s is closed with 1008 and backs off. Frames are size-checked before `JSON.parse`; every builder HTTP read (hello, snapshot, audit, proxied reads) has a response cap and a timeout. Before storing, the store also **sanitizes** each session. It drops `preview` and any `previewHtml` (the builder should strip them already), clamps strings to 4 KB and `previewLines` to 8 lines × 400 chars (§1 F6), and refuses a snapshot with more than 500 sessions. Builder data is untrusted. Keeping it bounded here protects the hub's memory, and the UI escapes everything anyway (§1 F6 / §4's rule). The store never rewrites `name`: fleet keys are computed at the edges with `fkey(id, name)` from `server/fleet/keys.mjs`.

A builder's snapshot stays in place when it goes `stale`/`down`. That is the "last snapshot greyed with age" degraded mode. `view(now)` reports `ageMs = now - snapAt` per builder.

### 2.5 `server/hub/client-ws.mjs`: the hub's `/ws` to browsers

Same message vocabulary as `server/ws.mjs`, with every builder-scoped message carrying `builder`. Session `name`s stay local, and the UI keys with `fkey(msg.builder, s.name)`, exactly as it does in builder mode with the local id.

On connect (after `auth.guardUpgrade` and the `direct`/`local` check, 2.8), the client receives:
1. `{type:'fleet', hub:{version, now}, builders:[BuilderRow], aggregates}`, where `BuilderRow = {id, code, directUrl, state, ageMs, latencyMs, version, versionSkew, controls: bool, capabilities}` and `controls = state === 'up' && versionSkew !== 'major'`.
2. A `{type:'snapshot', builder, sessions, lanes, box, vitals, attention, generatedAt, stale, ageMs}` for every builder in the client's scope.
3. `{type:'map', map}` (2.7).

Browser → hub messages:
- `{type:'scope', builders: 'all' | [ids]}`: default `'all'`. When a builder enters scope, the hub sends its `snapshot` at once. Deltas for out-of-scope builders are not sent. `fleet` (all builders, small) and `map` always go out, so the rail and the Map home stay complete.
- `{type:'visible', keys: [fkeys]}`: up to 128 entries. The hub keeps the per-client set, unions them per builder, and pushes `visible` upstream (2.3), debounced 500 ms.
- `{type:'ping'}` → `pong`, as today (`server/ws.mjs:106-107`).
- `{type:'touch', fkey, how}` and any other type: passed to handlers registered with `onClientMessage(type, fn(msg, {user}))` (§7 O10 registers `touch`); `user` is the connection's `Tailscale-User-Login` or `local`. Unknown types without a handler are dropped.

**Delta batching.** `fleet-store.subscribe` events go into a per-builder accumulator: `sessions` by name (last write wins), `removed` (a later upsert cancels a removal), and `lanes`/`box`/`vitals`/`attention` (last wins). Every `batchMs` (250 ms) each non-empty accumulator becomes one `{type:'delta', builder, ...}`. It is serialized **once** and sent to every client whose scope contains that builder. `previewLines` is kept only for sessions in some client's visible set. Otherwise it is stripped, because it is the bulk of a session's bytes. A `fleet` message goes out when any row or aggregate changes (compared as JSON), at most once per second. `event`/`approval`/`stuck`/`health` messages pass through immediately with `builder` added. Hub services send their own messages through `broadcast(msg)`: `alarms` (§7 O8), `packages` (§6 P11).

**Size bounds.** Every outbound frame is ≤ 512 KB. A builder snapshot or batch that would exceed that is split into several `delta` frames of ≤ 100 sessions each (snapshot first with no sessions, then deltas). A client whose `bufferedAmount` exceeds 4 MB is terminated, and its reconnect gets a fresh snapshot. Heartbeat as today (`server/ws.mjs:122-129`).

**Budget.** At 6 builders × 20 lanes, with ~1-2 KB per session without preview, a full fleet snapshot is about 250 KB. Steady state is one delta per changed builder per 250 ms window, typically < 5 KB.

### 2.6 Fleet aggregates: `server/hub/aggregates.mjs` (pure)

`aggregates(view, now)` returns:

- **attention:** concatenates every builder's `snap.attention`, each entry mapped to `{fkey, builder, code, name, state, score, since, danger, stale}`. `stale` is true when the builder is not `up`. Live entries sort first (score desc, then `since` asc, the same order as `server/state.mjs:160-161`), stale ones after, and the list is capped at 100. A prompt on a down builder is still real, but it cannot be answered from here, so it is shown greyed rather than hidden.
- **rateLimit:** `{fiveHour, sevenDay, source: fkey, accounts: {...}}`. The 5 h / 7 d windows are **account-wide**: every statusline on every builder that runs under the same subscription reports the same counter (`server/state.mjs:410-418`, `rate_limits.five_hour.used_percentage`). Summing them would count one quota N times and show 3 × 30 % as 90 %. So per `account` group (2.2), for each window the hub takes the sample with the **latest `resetsAt`** (the current window: an older `resetsAt` is a window that has already rolled over on a builder whose session has not refreshed). Among samples with that `resetsAt`, it takes the **max `usedPct`**: within one window the counter only rises, so the largest value is the newest reading and the others are lagging statuslines. Candidates per builder come from `ratelimits.freshest()` (`server/collector/ratelimits.mjs:14-21`), which the hub imports. That module imports only `log` and `db`, both safe in hub mode. The headline figure is the worst account. With the default single `account` this is one number.
- **cost:** `{usdToday, usd, burn5h, byBuilder: {id: {usdToday, burn5h}}}`. A sum is correct here, unlike the quota, because each builder prices only its own transcripts. `usdToday` and `usd` are sums of `session.cost?.usdToday ?? 0` and `cost?.usd`, and `burn5h` sums the values of `box.burn5h` (`server/boot/builder.mjs`, today `server/index.mjs:355-373`). It stays labelled `API-equivalent` as on `/api/cost` (`server/index.mjs:334`).
- **ci:** `{queued, running, runs}`, the union of `box.ci.queue.runs` (shape at `server/providers/ci/gh.mjs:86-98`). Several builders may poll the same repo, so the hub dedupes by `queue.repo + name + branch + createdAt`, tags each run with the `builders` that reported it, and recomputes `queued`/`running` from the deduped list. If §6 later moves CI polling to the hub, this function is replaced. The output shape stays.
- **counts:** `{builders: {up, stale, down}, sessions, lanes, working, needsYou}`.

### 2.7 The Map moves to the hub (`server/map.mjs`; implemented by §5 M1)

**Integration:** §5 2.1 is the binding node/link contract. The text below stays as the hub-side requirements M1 must also meet (`fleet` input, `tickFleet`, prefixed ids, one event when a builder goes down); where it differs from §5 (builder node kind/id/parent), §5 wins.

`build()` (`server/map.mjs:375`) changes signature from `{..., snapshot, hostname, ...}` to `{..., fleet, hostname, ...}`, with `fleet = { localId?: string, builders: [{id, code, state, ageMs, snapshot}] }`:
- In builder mode, `boot/builder.mjs` passes `{localId: config.fleet.id, builders: [{id: localId, code, state: 'up', ageMs: 0, snapshot}]}`. This is one code path, as the conventions require.
- In hub mode, `fleet = toMapFleet(store.view(now))`.

A one-line shim keeps `build({snapshot})` working for one release: it wraps `snapshot` into a fleet of one with id `config.fleet.id`.

**Where a builder hangs.** Topology nodes gain an optional key `builder: "<id>"`, meaning "this node *is* that builder". `parseTopology` (`:40`) validates it as a slug and unique, and reserves ids starting `builder:` the way it reserves `lane:` today (`:48`). For each builder:
1. A topology node with `builder === id` becomes that builder's anchor. In builder mode, `topo.self` is the anchor for `localId`, so today's `self` files keep working.
2. Otherwise, in hub mode, the map synthesizes `{id: 'builder:<id>', parent: '__fleet', kind: 'builder', label: code, builder: id}` (§5 attachment rule 3).
3. Otherwise, in builder mode with no topology, lanes go directly under `__core`, as today (`:444`).

**Builder node fields** (anchor or synthesized; set by a new `builderOverlay(node, b, now)`):

```js
{ ...node, builder: 'b1', code: 'B1',
  status: up ? (feed/probe status || 'ok') : state === 'stale' ? 'unknown' : 'down',
  why: up ? undefined : `no data for ${agoWords(ageMs)}`,
  sub: `${lanes} lanes · ${needsYou} need you`,
  metrics: { cpu, mem, disk, swap },          // from snapshot.vitals, as :411-418 does for self
  detail: { Version, Latency: '12 ms', 'Last seen': '3s' },
  stale: state !== 'up' || undefined }
```

**Lane node** (from `laneNodes`, `:329`, now called once per builder with `{builder, code, parent: anchorId, stale}`):

```js
{ id: 'lane:b1/feat-x', parent: 'builder:b1', kind: 'lane', label: 'feat-x',
  builder: 'b1', code: 'B1', fkey: 'b1/feat-x', session: 'b1/<sessionName>' /* fkey */,
  status, why, sub, detail, stale: true | undefined, ageMs?: number }
```

A lane under a non-`up` builder keeps its last status and gets `stale: true` plus `ageMs`, and the view greys it (§5). Keeping the status means `diffEvents` (`:480`) emits one event for the builder node going down and none for its lanes. Lane-link rules (`topo.lanes.links`, `:450-457`) apply per lane, and link ids become `lane:b1/feat-x>api`. `diffEvents` texts are prefixed with `code` when present (`B1 feat-x needs you`). Existing `test/map.test.mjs` expectations (`:128`, `:142-153`) change to the prefixed ids.

**Hub map loop** (wired by H11). `boot/hub.mjs` calls `mapModel.start()` (probes, `:563-565`). `map.tick` no longer takes a snapshot. A new `export function tickFleet(fleet, now)` does what `tick` (`:542-557`) does with `fleet` and is called on a 1 s debounce after any store change, plus a 5 s interval for feeds and probes. Feeds are read from `config.map.feedsDir` **on the hub**, so the feed pushers retarget to the hub (PRIVATE). The emitted `{type:'map', map}` is unchanged in shape, apart from the new fields above, which §5 consumes.

### 2.8 Routes and boot in hub mode (`server/boot/hub.mjs`)

**Runs:** the `Upstream` instances, the fleet store, client-ws, the relay, the read proxy, `map.start()` probes and the fleet map loop, `push` (VAPID and subscriptions in the hub's own `db`; sends come only from §7 O9), `db.startRetention()`, and the hosted fleet services (2.9).

**Does not run:** `state.start`, tmux, git, hooks, transcripts, lanes, progress, markers, `terminals.sweepStale`, launcher, retirer, `prs`, guard, slots, or cost snapshots. None of those modules is imported (nor `server/routes/*` or `server/flags/*`, which are builder-mode modules). X2's `test/boot.test.mjs` asserts this by checking for modules loaded in a hub-mode child process (`--import` hook listing resolved URLs); H11's `test/hub-boot.test.mjs` re-asserts it with real builders configured.

**Auth on hub routes:** the same `auth.classify` as builders (§2 2.3). Every route except `/healthz` and static files requires kind `direct` (ingress with `Tailscale-User-Login`) or `local` (the non-ingress loopback listener, e.g. the CLI on the hub box); kind `hub` and unidentified ingress get 403. **Control is remote-only on the hub:** `POST /api/fleet/actions` (relayed and hub-local actions alike), `POST /api/fleet/placement` with side effects (none today: it is a dry run, so it stays open), and `WS /ws/term/:builder/:name` require `direct` (push subscription routes stay as today, they control no builder); `local` gets 403 `remote-only` (a process on the hub box, e.g. after an RCE in a parser or a dependency, must not drive the fleet through the loopback listener). `local` keeps every read, so `bin/laneboard` pointed at the hub works for status. Every mutating route and every WS upgrade goes through `auth.guardRequest`/`guardUpgrade` (Host, Origin vs `config.publicUrl` plus `fleet.allowedOrigins`, `X-Laneboard: 1`). The acting user for relayed actions is `req.auth.user`.

**CSP.** The hub uses §1 F5's `securityHeaders` unchanged (the same `serveStatic`), including `style-src 'self' 'unsafe-inline'` which xterm's DOM renderer needs. Builder data never reaches `innerHTML` (§1 F6 lint rule).

| Method + path | Handler |
|---|---|
| `GET /healthz` | common, plus `{mode:'hub', builders:{up,stale,down}}` |
| `GET /api/fleet` | `{builders:[BuilderRow], aggregates}` |
| `GET /api/fleet/:builder/snapshot` | the cached `snap` (for the CLI), 404 for unknown, `stale`/`ageMs` flags |
| `GET /api/state?b=<id>` | compat: the builder's snapshot in today's `/api/state` shape, so `bin/laneboard` works pointed at a hub |
| `GET /api/map` | `mapModel.model()` |
| `POST /api/fleet/actions` | relay (2.10) |
| `POST /api/fleet/placement` | dry-run placement scoring (2.11) |
| `GET /api/fleet/audit?since=&builder=` | the hub's audit log plus reconciliation status per entry (H13; §4 D12 renders mismatches) |
| `GET /api/fleet/:builder/v1/*` | signed read proxy, allowlisted paths only (H12) |
| `GET /api/packages` | §6 P11 (module `server/hub/routes/packages.mjs`) |
| `GET/POST /api/notify/prefs` | §7 O9 |
| `GET /api/review-waits?since=` | §7 O10 |
| `GET /api/fleet/credit?b=`, `GET /api/fleet/morning?window=&b=`, `GET /api/fleet/archive?q=` | §7 O11, §10 R10 |
| `GET /api/push/key`, `POST/DELETE /api/push/subscribe`, `POST /api/push/test`, `POST /api/push/quiet` | as today (`server/index.mjs:246-282`), against the hub db |
| `POST /api/hook`, `/api/sessions/*`, `/api/lanes`, … | not registered (404). The UI uses the relay. |
| WS `/ws` | client-ws |
| WS `/ws/term/:builder/:name` | term-proxy |

**Push on the hub** is owned by §7 O9: notifications fire on alarm *raises* (`alarms.reconcile().raised`), with payload url `/#/inbox?sel=<fkey>`. H11 only starts `push` (VAPID, subscription routes). The store still reports per-fkey transitions in `subscribe` events (`{transitions:[{fkey, from, to}]}`, taken only from `delta`s, never from a replacing `snapshot`), which O8 may use. Builders stop pushing once a hub key is pinned (`push.local`, §7), so there is no double buzz.

### 2.9 Hook for fleet-derived services

`server/hub/services.mjs` exports `createServices()` → `{register({name, start(ctx) -> stop}), startAll(ctx), stopAll()}`; `boot/hub.mjs` puts `services` into the module ctx, so a hub route module registers its service from `register(ctx)`. `start` receives `{store, push, audit, broadcast, relay, readProxy, onClientMessage, config, now}`. Alarms (§7 O8), notifications (§7 O9), review-wait (§7 O10) and the packages merge (§6 P11) register here and emit hub messages through `broadcast(msg)` (client-ws fan-out). Stuck detection and budget caps are builder-side and do **not** register here. H11 provides the hook and its test (a dummy service sees store changes and its broadcast reaches a client).

### 2.10 `server/hub/relay.mjs`: action relay

```js
export function createRelay({ store, key, sign, audit, fetchImpl = fetch, now, uuid = crypto.randomUUID, cfg })
  -> { relay({ builder, action, target, args }, user) -> Promise<{ok, result|error, auditId, builder}> }
export const ACTIONS   // allowlist: the README action table (send-text, send-keys, interrupt, pause, resume, kill, restart, spawn, launch, retire, approve, deny, release, set-budget, broadcast, ack-alarm, send-review, run-script)
export function validateArgs(action, args)   // pure; throws RelayError(400)
export function registerHubAction(name, { run })  // hub-local handling, never relayed as-is: broadcast (§8 C8), ack-alarm (§7 O8), kill/pause/resume with builder '*' (§8 C9 / built-in fan-out)
```

1. Check `action ∈ ACTIONS`. `validateArgs` is a coarse pre-filter; the builder's dispatcher (§2 2.6) is authoritative: `send-text.text` ≤ 8000 chars, `send-keys.keys` ≤ 20 items of `^[A-Za-z0-9_.^-]{1,16}$` (the builder's regex), `target` ≤ 128 chars, and the serialized `args` ≤ 32 KB. If a hub-local handler is registered for the action (or `builder === '*'`), it runs instead of steps 2-6.
2. Look up `store.builder(builder)`. Unknown → 404. A builder whose `controls` is false (state not `up`, or `incompatible`) → 503 `{error:'builder down', state, ageMs}`. **Nothing is sent and nothing is queued.** A queued kill delivered 10 minutes later is exactly the "acts on its own" the hard rules forbid.
3. Build the envelope `{v:1, id: uuid(), ts: now(), builder, action, target, args, user, via:'hub'}`, where `user` is `req.auth.user` (the hub request's `Tailscale-User-Login`; `local` never reaches the relay, 2.8), never from the body. Compute `sig = auth.signEnvelope(envelope, key)` (Ed25519 over canonical sorted-key JSON).
4. Call `audit.append({ts, id, user, via:'hub', builder, action, target, argsHash: sha256Hex(canonicalJson(args)), result: {phase:'sent'}})`.
5. `POST {url}/api/v1/actions` with headers `X-Laneboard-Sig: ed25519 <b64>`, `X-Laneboard-Key: <keyId>`, `X-Laneboard: 1`, `content-type: application/json`, no `Origin`, a JSON body, and `AbortSignal.timeout(actionTimeoutMs)`. Take at most 64 KB of the response.
6. Append the outcome as a second entry with the same `id`: `result: {phase:'done', ok: true|false|'unknown', status, error?, builderAuditId}` (`'unknown'` + `error:'timeout'` on a timeout). A 403 `control-disabled` from the builder is reported as such to the UI. **No retry.** On a timeout the outcome is unknown. The UI shows "sent, outcome unknown". The §3 H13 / §4 D12's reconciliation (`GET /api/v1/audit?since=`) settles it later, and a retry would be refused by the builder's nonce LRU anyway.
7. `broadcast` is a hub-local action registered by §8 C8 (`server/hub/broadcast.mjs`): plan with `planBroadcast`, check `confirmCount`, then one `send-text` envelope per target with `{text, enter, guardPrompt:true, fanout:{parent}}`, each with its own nonce and audit line, concurrency 6, result `{sent, skipped, failed}`. Targets on non-`up` builders are skipped with reason `builder-down`.
7b. `builder: '*'` with `pause`/`resume` (target `*`, the UI's typed confirm `fleet`) fans out one envelope per `up` builder (built into the relay), **rewriting `args.confirm` to each builder's id** (builders never accept `fleet`); `kill` with `builder:'*'` is §8 C9's fleet kill (`server/hub/fleetkill.mjs`), same rewrite. Results list skipped builders by name.
8. For `spawn`/`launch` with no `builder`, the relay calls placement (2.11) and puts `placedBy: 'hub'`, `score` in the result.

### 2.11 Placement: `server/hub/placement.mjs` (pure)

`rank(view, {repo?, need?}) -> [{builder, score, eligible, reasons[]}]`, sorted by score desc. For each builder:
- `lanes`: active launched lanes (`box.launched.length`).
- `free`: free lane slots, counted as `box.slots.filter(s => s.laneSlot && !s.lane && !s.orphan)`. This is the count of slots that are lane slots and are not taken.
- `mem`: `vitals.mem.availableMb`.
- `swap`: `swapUsedMb / swapTotalMb` (0 when no swap).
- `load`: `vitals.load[1] / vitals.cpus`, the 5-minute load per vCPU. `vitals.cpus` is a new field, `os.availableParallelism()`, added in `server/collector/vitals.mjs:81-95`.

Eligibility (any failure means ineligible, with the reason): `state === 'up'`, `hello.capabilities` includes `launch`, `free ≥ 1`, `mem ≥ minFreeMemMb`, `swap < maxSwapFrac`, `versionSkew !== 'major'`, and (when `repo` is given) the repo is in `hello.repos` (§8 C12 hello field) **and**, when the hub config lists `fleet.builders[].repos`, in that list too (builder claims are untrusted). The UI always shows the chosen builder before sending; restore from an archive row defaults to the source builder (§10).

Score (higher is better, each term clamped to [0,1]):

```
score = 0.40 * free / max(1, totalLaneSlots)
      + 0.30 * min(1, mem / 16384)
      + 0.20 * (1 - min(1, load))
      + 0.10 * (1 - swap)
      - 0.05 * lanesNeedingYou          // a builder already demanding attention is a worse place to add more
```

Ties break on lower `latencyMs`, then config order. The free-slot term dominates because a lane without a slot cannot start (`server/config.mjs:368`, `maxActiveLanes`). Memory comes next because builds and agents are memory-bound. Swap is weighted low but also hard-gated, since a swapping box makes every lane slow. The user overrides by passing `builder` explicitly. The UI shows the ranked list from `POST /api/fleet/placement` with reasons, so the override is informed. An explicit choice of an ineligible builder is still sent, because the builder's own launch validation is authoritative, and the response carries `warning`.

### 2.12 `server/hub/term-proxy.mjs`

`attach(req, socket, head, url, {store, key, sign, cfg}) -> bool` handles `/ws/term/:builder/:name`.

1. Parse the path. Check the Origin and the user, that the builder is known and `controls`, that the name is safe (`isSafeSessionName`, `server/util.mjs:109`; the hub must not import `terminals.mjs`, which loads node-pty), and that the number of live proxied terms for the builder is below `maxTermsPerBuilder`. Any refusal writes `HTTP/1.1 404|403|503` and destroys the socket, mirroring `server/terminals.mjs:298-302`.
2. Open the upstream `ws` to `{url}/api/v1/term/{encodeURIComponent(name)}?cols=&rows=[&window=]` (query passed through, `cols`/`rows` clamped, `window` only if it matches `^run-[a-z0-9-]{1,24}$`, §10 R8) with a signed `term` **envelope** (`X-Laneboard-Envelope` + `-Sig` + `-Key`, §2 2.4; `user` = the browser's `req.auth.user`, `target` = the name, `args` = the clamped `cols`/`rows`/`window`), **before** upgrading the browser. The builder accepts it only if the hub key has the `term` scope and `fleet.hubControl` is on. A 403 from the builder (`control-disabled`, `scope-missing`) gives the browser a 403. The term-proxy never sends a read signature. If the upstream answers `unexpected-response` (404), the browser gets a plain 404. Then `wss.handleUpgrade` the browser.
3. Pipe both ways, preserving `isBinary`. Browser → upstream frames are buffered until the upstream is open (cap 64 KB, then close 1013). Frames are not interpreted, except that the hub caps a single browser frame at 64 KB.
4. **Backpressure.** If the browser's `bufferedAmount > 1 MiB`, pause the upstream's underlying socket (`up._socket.pause()`). Resume when the buffer drains below 256 KiB, checked on a 50 ms timer while paused. Same in the other direction.
5. **Close propagation.** Either side's close closes the other with the same code if it is sendable (1000-1003, 1007-1014, 3000-4999). Otherwise it uses 1011 (abnormal) or 1000 (normal). Errors terminate both. A builder going `down` (store event) closes its proxied terms with 4001 "builder down".
6. **Audit.** Write `term-attach` / `term-detach` audit lines `{user, builder, target: name, bytesIn, bytesOut}`. A terminal is an unlogged control channel otherwise. Keystrokes are not logged.

### 2.14 `server/hub/read-proxy.mjs` (H12): signed read proxy

`createReadProxy({store, key, keyId, fetchImpl, now, cfg})` → `{get(builderId, pathWithQuery) -> {status, json}, route(req, res)}`; route `GET /api/fleet/:builder/v1/<rest>` forwards to `{url}/api/v1/<rest>` with `signRead` headers. Allowlist (regexes on `<rest>`, fixed here so no later task edits it): `hello`, `snapshot`, `health(\?history=1)?`, `approvals`, `jobs/[A-Za-z0-9-]{1,64}`, `audit\?.*`, `morning(\?window=[a-z0-9]{1,8})?`, `credit`, `lanes/[a-z0-9][a-z0-9._-]{0,63}/diff(\?.*)?`, `sessions/[^/]{1,64}/transcript(\?.*)?`, `sessions/[^/]{1,64}/preview(\?n=\d{1,3})?`, `archive(\?.*)?`, `archive/[a-z0-9][a-z0-9._-]{0,63}`. Anything else 404. Unknown or non-`up` builder → 503 `{error:'builder down', state, ageMs}`. Response cap 4 MiB, must parse as JSON (else 502), `content-type: application/json` re-emitted; nothing is cached or persisted. Hub services use `readProxy.get()` for fan-outs (morning, credit, archive; each with a 3 s timeout and `missing:[id]` on failure).

### 2.15 `server/hub/audit-reconcile.mjs` (H13)

Pure `reconcile(hubEntries, builderEntries) -> [{id, builder, action, target, hub: {phase, ok}, builder: {ok, hash}|null, state: 'match'|'missing-on-builder'|'outcome-differs'|'unknown-settled'}]`. **Anchoring:** the hub log is authoritative for hub-relayed actions; a builder log is trusted only up to its last anchor. After each pull the hub appends `{action:'audit.anchor', builder, target:builder, result:{ok:true, head:{hash, count}}}` to its own chain; if a later builder response does not contain the anchored hash at index `count-1` (the chain was rewritten), the hub raises alarm kind `audit-fork` (P1, §7) for that builder. The hub keeps, per builder, the last builder audit hash it has seen and fetches `GET /api/v1/audit?after=<hash>` through the read proxy every 60 s (and once on reconnect); an `ok:'unknown'` hub entry is settled by the builder entry with the same envelope `id`. `GET /api/fleet/audit` returns hub entries with their `state`. Never writes to a builder.

### 2.13 Degraded modes

- **Builder stale or down.** Its `BuilderRow.controls` is false. The UI disables actions and terminals for its fkeys, greys its cards and map nodes, and shows `ageMs` (§5 / frontend). The relay and term-proxy refuse (503). The last snapshot is still served.
- **Builder `incompatible` or `misconfigured`.** Same as down, plus a reason on the Box view.
- **Hub down.** Builders are unaffected: they never depend on the hub, and their own UI and push keep working. Every `fleet` message carries `directUrl` per builder. The frontend caches that list in `localStorage` (`laneboard.direct`). When the hub `/ws` has been closed for more than 10 s, it shows a "direct" panel linking to each builder's own UI. The list also ships statically: `GET /fleet-direct.json` is not useful when the hub is down, so the cache is the mechanism. A builder's own UI can show the same list if the builder config has `fleet.peers` (§4, optional).
- **Clock skew.** If `|clockSkewMs| > 30 s`, the Box shows a warning. Signed requests would start failing at ±60 s (§2).

## 3. Implementation tasks (dependency order)

| # | Task | Files owned | Done when |
|---|---|---|---|
| H1 | Config fragment: `fleet.builders/hubKeyFile/staleMs/downMs/batchMs/pingMs/actionTimeoutMs/maxTermsPerBuilder/placement`, validation, env `LANEBOARD_FLEET_BUILDERS`. Deps F4, A1 | `server/config/hub.mjs`, `test/config-hub.test.mjs` | `npm test` green; a test rejects duplicate builder ids, hub with no builders, hub with null `ingressPort`, `staleMs >= downMs`, an `http://` builder url on a non-loopback host, and a hub `allowedOrigins` entry equal to a builder `url`/`directUrl` origin; `repos` allowlist entries validate as repo names |
| (H2) | Folded into §11 X1 (boot split) and X2 (`test/boot.test.mjs`) | — | — |
| H3 | Fleet store with sanitization, merge, version-skew compare, subscribe. Deps F3 | `server/hub/fleet-store.mjs`, `test/fleet-store.test.mjs` | tests in §4 pass, including the S2/S3 cases (routing fields stripped, `Map`s only, name re-validation, every cap on snapshot and delta, `previewHtml` dropped). REVIEW-REQUIRED (SR9) |
| H4 | Aggregates (attention, rateLimit, cost, ci, counts). Deps H3 | `server/hub/aggregates.mjs`, `test/hub-aggregates.test.mjs` | tests pass |
| (H5) | Fake builder helper: folded into §11 X2 (`test/helpers/fake-builder.mjs`, with this list of features: hello, snapshot, stream with seq, actions, term echo, scripted gaps/closes, records received headers) | — | — |
| H6 | Upstream client. Deps H3, A4, X2 | `server/hub/upstream.mjs`, `test/hub-upstream.test.mjs` | tests pass, including byte-rate close (1008), oversize frame (1009) and HTTP response caps/timeouts. REVIEW-REQUIRED (SR10) |
| H7 | Hub `/ws` (scope, visible, batching, splitting, backpressure, `onClientMessage`). Deps H3, F5 | `server/hub/client-ws.mjs`, `test/hub-ws.test.mjs` | tests pass |
| H8 | Relay (+ `registerHubAction`, builder `'*'` pause/resume fan-out) + placement (+ `vitals.cpus`). Deps H3, A3, A4, X2 | `server/hub/relay.mjs`, `server/hub/placement.mjs`, `server/collector/vitals.mjs` (one field), `test/relay.test.mjs`, `test/placement.test.mjs` | tests pass, including: `relay()` refuses a `user` of `local` (403 `remote-only`); placement never picks a builder for a repo missing from that builder's hub-config `repos` allowlist even if its `hello.repos` claims it. REVIEW-REQUIRED (SR11) |
| H9 | Terminal proxy (+ `window` pass-through). Deps H3, A3, A4, X2 | `server/hub/term-proxy.mjs`, `test/term-proxy.test.mjs` | tests pass, including: the fake builder receives a `term` envelope (no read-signature headers) whose `target`/`args` match the path and clamped query; a `local` browser connection → 403. REVIEW-REQUIRED (SR12) |
| H12 | Signed read proxy (2.14). Deps H3, A4, X2 | `server/hub/read-proxy.mjs`, `test/read-proxy.test.mjs` | allowlisted path proxied with valid signature (fake builder verifies); non-allowlisted 404; 5 MiB response 502; down builder 503; a path with `..` or an encoded `/` in a segment → 404. REVIEW-REQUIRED (SR14) |
| H13 | Audit reconciliation + anchoring (2.15). Deps A3, H12 | `server/hub/audit-reconcile.mjs`, `test/audit-reconcile.test.mjs` | match / missing / differs / unknown-settled cases; a rewritten builder chain after an anchor yields `audit-fork`; anchors are appended to the hub chain. REVIEW-REQUIRED (SR14) |
| (H10) | Map: folded into §5 M1 (which also keeps `build({snapshot})` as the builder-mode entry, so `server/boot/builder.mjs` is not edited) | — | — |
| H11 | Hub wiring: routes table 2.8 (core routes in `server/hub/routes/core.mjs`), auth via `classify`, push start (no sends), services hook, map loop (`tickFleet`), shutdown hooks (stop upstreams, close clients). Deps H1, H4, H6, H7, H8, H9, H12, H13, M1, A3, F5, X1, X2 | `server/boot/hub.mjs`, `server/hub/routes/core.mjs`, `server/hub/services.mjs`, `test/hub-boot.test.mjs` (incl. canary: `signEnvelope`/`signRead` are imported only by `relay.mjs`, `upstream.mjs`, `term-proxy.mjs`, `read-proxy.mjs`, `broadcast.mjs`, `fleetkill.mjs`; no `rejectUnauthorized` anywhere), `docs/fleet/hub.md` | spawning `node server/index.mjs` in hub mode against 2 fake builders: `/api/fleet` lists both `up`; killing one fake turns it `stale` then `down` within `staleMs`/`downMs` (set to 300/900 ms in test); `/api/fleet/actions` (sent through the ingress listener with serve-like `X-Forwarded-*` + `Tailscale-User-Login`) to the down one returns 503; the same action on the local listener returns 403 `remote-only`; web baseline on the hub: `OPTIONS` → 405, a mutating request without `X-Laneboard: 1` → 403, a `Host` not in the allowlist (also `host` without the `:port`) → 403, the index carries the full §1 CSP (`object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`), a signed `hub`-kind request → 403; the hub-mode child process never resolves `node-pty`, `server/terminals.mjs` or `server/state.mjs`. REVIEW-REQUIRED (SR13) |

H1, H3 can run in parallel early; H4, H6-H9, H12 are parallel after H3 (+A4); H13 after H12; H11 comes last. The global DAG is in README.md.

## 4. Tests

- **`test/fleet-store.test.mjs`:**
  - A snapshot then a delta merges like `app.js` (upsert, remove, replace lanes/box).
  - `removed` followed by re-add keeps the session.
  - `preview` and `previewHtml` are stripped and oversize strings are clamped; >500 sessions is rejected.
  - Caps hold on snapshot **and** delta: 201 attention entries keep 200, 101 approvals keep 100, 201 lanes keep 200; 25 `event`s in one second from one builder pass 20 and count 5 dropped.
  - Session names `__proto__`, `constructor`, `../x` and lane ids failing the regex are dropped and counted; `Object.prototype` is unchanged after ingest.
  - A snapshot from `b1` whose session carries `key:'b2/x'`, `builder:'b2'` or `__proto__` as a name: the routing fields are dropped, the bad name is dropped, and the resulting fkey is `b1/<name>` (S2).
  - Version skew: `0.1.0` vs `0.1.3` gives `patch`, vs `1.0.0` gives `major`.
  - `view()` keeps the last snapshot for a down builder with a correct `ageMs`.
  - `subscribe` gets `{builder, changed, removed}`.
  - Transitions are reported for deltas and not for a replacing snapshot.
- **`test/hub-upstream.test.mjs`** (fake builder in-process):
  - Hello id mismatch gives `misconfigured`; `apiVersion: 2` gives `incompatible`.
  - The stream connects and the store has the sessions.
  - A frame with a wrong `builder` field is dropped.
  - A seq gap triggers exactly one `GET /api/v1/snapshot`, and frames with `seq <= snap.seq` are discarded.
  - The fake closes: state is `stale` (not `down`) before `downMs`, then `down`.
  - The reconnect gets a new snapshot.
  - `backoffMs` is monotone to the 30 s cap with jitter within ±20 %.
  - Every request the fake receives carries the `X-Laneboard-Sig/Ts/Nonce/Key` headers and verifies with the fake's pinned key.
  - `visible` (with `keys`) reaches the fake.
  - `alarms` and `map` frames from the builder are ignored; `repos` updates the entry.
  - A 9 MiB frame closes with 1009 without calling `JSON.parse` (spy); 3 MiB within one second closes with 1008 and backs off; a hello response over 64 KiB or slower than the timeout fails with `response too large` / `timeout`.
- **`test/hub-ws.test.mjs`:**
  - The connect order is `fleet` → per-builder `snapshot` → `map`.
  - `scope: ['b1']` suppresses b2 deltas but not `fleet`.
  - 10 deltas within 250 ms yield one frame with merged sessions.
  - A 300-session snapshot splits into frames ≤ 512 KB.
  - `previewLines` is only present for visible sessions.
  - A `touch` message reaches a registered `onClientMessage('touch')` handler with the connection user.
  - A missing user header gets 403; a bad Origin gets 403.
- **`test/hub-aggregates.test.mjs`:**
  - Attention sorts live before stale, then by score and since.
  - Rate limit: builders at 30 %/31 %/29 % with the same `resetsAt` give 31 % (not 90 %). A builder with an older `resetsAt` at 95 % is ignored in favour of the current window at 10 %. Two `account`s are reported separately with the worst as the headline.
  - Cost sums.
  - The CI union dedupes identical runs from two builders and recounts `queued`/`running`.
- **`test/relay.test.mjs`:**
  - The envelope has `user` from the header, not from the body, plus a fresh `id` and `via: 'hub'`.
  - The signature verifies with the public key (`auth.verifyEnvelope`).
  - `validateArgs` rejects 17 KB text and bad key names.
  - A down builder gets a 503 and nothing is sent.
  - A timeout gives `ok:false, error:'timeout'` with no retry (the fake counts 1 request).
  - The audit has a pending line and an outcome line.
  - A registered hub-local action runs instead of relaying; `builder:'*'` `pause` fans out one envelope per `up` builder with `args.confirm` rewritten from the typed `fleet` to that builder's id.
  - Every relayed request carries `X-Laneboard: 1` and `X-Laneboard-Key`.
- **`test/placement.test.mjs`:**
  - A builder with no free slot is ineligible whatever its memory.
  - High swap is ineligible.
  - With an equal slot count, more memory and less load wins.
  - Ties break on latency.
  - An explicit ineligible choice is passed through with a warning.
- **`test/term-proxy.test.mjs`:**
  - Bytes go browser→fake echo→browser, binary preserved.
  - The `size` JSON control frame passes through.
  - A fake upstream 404 gives the browser a 404 (no upgrade).
  - The fake closes with 4000 and the browser sees 4000; the browser closes and the fake sees a close.
  - The builder going down closes with 4001.
  - Exceeding `maxTermsPerBuilder` gets a 503.
  - Audit lines are written.
- **`test/map.test.mjs` (updated + new):**
  - Prefixed lane ids in builder mode.
  - Two builders with no topology give `builder:b1`/`builder:b2` under `__core` with lanes beneath.
  - A topology node with `builder: 'b1'` anchors b1's lanes and carries its vitals.
  - A down builder's lanes keep their status with `stale: true`, and `diffEvents` emits exactly one event (the builder).
  - `parseTopology` rejects `builder:`-prefixed ids and duplicate `builder` keys.
- **`test/hub-boot.test.mjs`:** as in H11 (`test/boot.test.mjs` is X2's).

## 5. Risks, open questions, human checks

- **Tagged-node identity (verified).** A request from the hub (a tagged Tailscale node) through `tailscale serve` carries **no** `Tailscale-User-*` headers (spoofed ones are stripped), only the `X-Forwarded-*` trio; from a user device the headers are present and `Host` keeps `:8443`. That is why hub requests are classified *hub* only by signature (optionally pinned to `fleet.hubAddrs`). Re-check after a Tailscale upgrade.
- **Builder stream must accept `visible`** and must include `cpus` in vitals (H8) and `repos` in hello (§8 C12). Without them, placement drops the repo gate and the capture rate on builders behind a hub falls to the idle rate (15 s previews).
- **Rate-limit account grouping** relies on config: two builders on different subscriptions but left on the default `account` would show the max of two unrelated quotas, which is wrong but conservative. Open question: could a builder report an account fingerprint in `hello`? The statusline gives none today.
- **Map id change** (`lane:x` → `lane:<id>/x`) breaks saved map pins, folding state and motion keyed on old ids (§1 F8b migrates the fold set; §5 drops legacy ids). One-time visual reset, acceptable.
- **Memory.** 6 builders × 500-session cap × 4 KB worst case is 12 MB. Realistically < 5 MB. HUMAN: soak the hub for 1 h with 3 real builders and check `/healthz` `rssMb` < 150.
- **Unknown action outcomes after a timeout.** The UI must say "unknown", never "failed". Reconciliation is H13.
- **Push dedupe.** If the user stays subscribed on both hub and builder origins, the phone buzzes twice. Document it; no code.
- HUMAN: open the hub UI from a phone and confirm terminals through the proxy are usable; measured hub↔builder path is a DERP relay, so expect about 60-70 ms extra per keystroke echo.
- **Deploy (security review S1).** The hub runs only a human-pinned commit (README 4.5, homelab runbook): never `git pull` of a branch, install with `npm ci --ignore-scripts` (the hub never loads `node-pty`, asserted by H11).

## 6. Dependencies

- **§2 (Builder API v1 + auth):** `/api/v1/*` endpoints, `{builder, seq, epoch}` framing, the `visible` message upstream, `server/fleet/auth.mjs` exports `signRead`, `signedReadString`, `signEnvelope`, `verifyEnvelope`; `server/fleet/canonical.mjs` `canonicalJson`/`sha256Hex`; `server/fleet/keys-ed25519.mjs` `loadPrivateKey`/`keyId`; `server/fleet/audit.mjs` `openAudit().append(entry)`; `laneboard fleet keygen`.
- **§1:** `server/fleet/keys.mjs` (`fkey`, `parseFkey`, `deriveCode`), `server/security.mjs`.
- **§11 X1/X2:** boot split, `loadModules`, config fragments, `test/helpers/fake-builder.mjs`, `test/helpers/boot.mjs`.
- **§5 M1:** the fleet Map model (`buildFleet`, `tickFleet`, `toMapFleet`).
- **§1 F8a / §4 frontend:** consumes `fleet`/`snapshot`/`delta` with `builder`, sends `scope`/`visible`/`touch`, implements the controls-disabled state and the direct-link fallback cache.
- **§6, §7, §8:** register hub services (2.9) and hub-local actions (2.10); §10 uses the read proxy (2.14).
- **§6:** `aggregates.ci` stays (builders collect CI); P11 adds the packages merge.

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
