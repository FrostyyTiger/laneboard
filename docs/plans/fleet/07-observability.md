# Section 7: Observability (signals, stuck detection, builder health, alarms, notifications)

**Integration notes (integrator):**
- Coordinator decision confirmed: stuck detection runs on each builder and streams `stuck`; the hub derives alarms. §3 and the conventions were updated to match (7.6 "conventions mismatch" is resolved).
- Task ids O1-O11 (T1→O1 … T11→O11); deps/files match the global DAG (README.md). T7 (topology `builder` field) is folded into §5 M1.
- No `server/state.mjs`/`server/ws.mjs` edits outside O3: the tracker is wired by the flag module `server/flags/stuck.mjs` (O5) using X1's `state.addDecorator`/`state.onTick`; X1 implements the attention bump (+40 for `s.stuck` unless already waiting). The push guard moves into `server/push.mjs` (O3), so `server/boot/builder.mjs` is not edited.
- Config is the fragment `server/config/observability.mjs` (`stuck`, `health`, `push.local`, `notify`, `alarms`); `review.overdueHours` lives in §10's `server/config/review.mjs` with the other `review.*` keys.
- Health routes are the module `server/routes/health.mjs` (`GET /api/v1/health?history=1`, capability `health`); `/api/health/box` is dropped (the local UI uses the v1 route).
- Alarms: `KINDS` gains `blocked` (P2, from `blocked` markers). `TILES`/`tileStates` move to the UI (`public/js/core/alarm-tiles.js`, §4 D7, 8 tiles); the message is `{type:"alarms", alarms}`. Persistence uses `db.kvRead/kvWrite("alarms.live")` plus `db.addEvent({type:"alarm", subtype})` history, and `notify.deferred` / `review.waits` also use kv, so §7 adds no `server/db.mjs` migration. Alarms run in both modes: hub service (`server/hub/routes/alarms.mjs`) and a standalone-builder module over a fleet of one (`server/routes/alarms.mjs`).
- `ack-alarm`: target `<alarmId>` or `*` with `args {tile?, builder?}`; registered `localOnly` in the builder dispatcher and as a hub-local action (`relay.registerHubAction`) on the hub; never relayed.
- Review-wait uses §10's lane flag `reviewReady {ready, reasons, since}` (`since` = ready time); first-touch comes from H7's `onClientMessage("touch")` and P5's `pr.firstReviewAt`.
- Morning merge is §10 R10 (`server/hub/morning.mjs`, which must also do this section's fkeys/`missing`/`deferred`/review-wait parts); `/api/v1/morning` is §10 R7. O11 keeps credit only: `server/routes/v1-credit.mjs`, `server/hub/credit.mjs` (`mergeCredit`), hub route `GET /api/fleet/credit?b=`. Hub fan-outs use §3 H12's read proxy.
- Private details moved to `private/07-private.md`.
- **Security fixes pass (see `SECURITY-FIXES.md`):** O9's push caps (10 per builder per 10 min, length-capped builder strings, `encodeURIComponent(fkey)` in `url`) now have tests in its done-when; O8's `ack-alarm` registration (`localOnly` on builders, hub-local on the hub, where it needs `direct`) is REVIEW-REQUIRED (README 4.5, SR20).

## 7.1 Goal and scope

**In:** (a) more signals collected per session on each builder, from the statusline sidecar and from more hook events; (b) a stuck detector on each builder that only shows a badge; (c) a builder health collector with a 1 h ring buffer; (d) linking Proxmox feeds to builders on the hub; (e) a hub alarm model with ack; (f) fleet-wide web push from the hub; (g) a review-wait metric; (h) fleet-wide Morning and Credit.

**Out (explicitly):** OpenTelemetry ingestion (deferred, see 7.2.3). Auto-kill of any kind. Auto-pause: the hook point exists, it is OFF by default, and §8 implements pause. Alarm shelving and suppression groups (later). Builders never get a hypervisor API token.

## 7.2 Inventory: collected today vs. to add

### 7.2.1 Statusline (sidecar)

The sidecar mirrors the **whole raw stdin JSON** to `~/.cache/laneboard/status/<session_id>.json` (`deploy/statusline-sidecar.sh:6-17`, the same block in `deploy/statusline-command.sh:7-23`). The installed `~/.claude/statusline-command.sh` on this builder is byte-identical to `deploy/statusline-command.sh`. `server/collector/statusline.mjs:224-268` caches the files (fs.watch plus a 5 s poll). Because the script forwards everything, **nothing in the shell script needs to change**. Only `state.mjs` needs to read more of the cached JSON.

On Claude Code 2.1.301, a live sidecar file has these keys: `cost.{total_cost_usd,total_duration_ms,total_api_duration_ms,total_lines_added,total_lines_removed}`, `context_window.{used_percentage,remaining_percentage,context_window_size,current_usage.*,total_input_tokens,total_output_tokens}`, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`, `model.{id,display_name}`, `effort.level`, `thinking.enabled`, `prompt_cache.{hit_ratio,warm,expires_at,misses,...}`, `version`, `session_name`, `transcript_path`, `workspace.*`.

| Field | Used today (`server/state.mjs`) | Add |
|---|---|---|
| `model.id/display_name` | :376-377 | none |
| `context_window.used_percentage/size/current_usage` | :399-405 | none (stuck uses `context.usedPct`) |
| `cost.total_cost_usd` | :407 `statuslineCostUsd` | stuck cost-slope samples it (7.3) |
| `cost.total_lines_added/removed` | :408-409 | none |
| `rate_limits.*` | :410-419; sampled 1/min by `collector/ratelimits.mjs:352` | hub aggregates across builders (7.8) |
| `effort.level` | **no** | `session.claude.effort` |
| `thinking.enabled` | **no** | `session.claude.thinking` |
| `prompt_cache.hit_ratio/warm/expires_at` | **no** | `session.promptCache {hitRatio, warm, expiresAt}` (shown in the inspector only) |
| `cost.total_api_duration_ms` | **no** | `session.apiMs` |
| git `oid` (`collector/git.mjs:18`) | **no** (`state.mjs:365` takes only the branch) | `session.head` (stuck progress fingerprint) |

### 7.2.2 Hooks

`deploy/hooks.json` registers 7 events: UserPromptSubmit, PreToolUse(*), PostToolUse(*), Notification(*), Stop, SessionStart, SessionEnd. Each one is an async `curl` to `127.0.0.1:7777/api/hook`. The active `~/.claude/settings.json` has the same 7 events. `server/index.mjs:175-193` always answers 200 first and then calls `hooks.ingest`. `classify` (`server/collector/hooks.mjs:12-38`) maps the 7 events to states. `compactPayload` (:127-143) stores the tool summary, but **not** the tool-input hash and **not** the error text.

`claude --version` reports **2.1.301** (`~/.local/bin/claude`). Grepping the binary turns up every event name below, plus the Notification types `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`. So every event below is **supported**:

| Event to add to `deploy/hooks.json` | `classify` change | Signal |
|---|---|---|
| `PostToolUseFailure` (matcher `*`) | `working` (no state change otherwise) | `fail {tool, inHash, errHash, errText (oneLine 160)}`; `body.error` falls back to `body.tool_response?.error`, then `body.message` |
| `PermissionRequest` (`*`) | `waiting_permission` (earlier and more reliable than Notification `permission_prompt`) | `perm {tool, toolInput summary}` in the signals ring (this is the **async** observe-only entry; §8's approval queue has its own synchronous intake `POST /api/hook/permission` and uses `hooks.subscribe` only to supersede) |
| `PermissionDenied` (`*`) | none | counted, so that "approval resolved" is visible |
| `StopFailure` | `done` + `activity.failure {type, text}` | feeds the `failed` alarm |
| `SubagentStart` / `SubagentStop` | none | `subagents` counter (stalled ignores sessions with a live subagent whose events are fresh) |
| `PreCompact` / `PostCompact` | none | `compactions[]` timestamps (context-pressure rule) |
| Notification `auth_success`, `elicitation_*` | `elicitation_dialog` already maps (:25); `elicitation_complete/response` → `working` | none |

PreToolUse, PostToolUse, Stop and SessionStart/End are already wired. They gain an input hash (see `signals.mjs`). Hook-event names are shown as code (`PermissionRequest`) everywhere, including in the UI.

**`install-claude.sh`** needs no logic change: its jq merge `.hooks = (.hooks // {}) + $h[0]` (`deploy/install-claude.sh:31-34`) adds the new event keys. Re-running the script is idempotent.

### 7.2.3 OpenTelemetry: decision deferred

The binary contains `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_EXPORTER_OTLP_PROTOCOL` and metrics such as `claude_code.tool.blocked_on_user`, `claude_code.compaction` and `claude_code.commit.count`. An OTLP/HTTP-JSON receiver would be about 150 lines. It is still deferred:
- every signal the stuck rules need already comes from hooks plus the statusline;
- turning OTel on means changing the env of every launched session (launcher) and exporting on a timer, which adds load during the overnight run;
- JSON encoding has to be forced (`http/json`), otherwise the receiver needs a protobuf dependency.

Record it as open question Q1. If it is picked up later, the receiver is `server/collector/otlp.mjs` serving `POST /v1/metrics` and `POST /v1/logs` on 127.0.0.1. It accepts JSON only and stores `tool.blocked_on_user` and `commit.count` per session.

## 7.3 Design

### 7.3.1 Per-session signal ring: `server/collector/signals.mjs` (builder, new)

```js
// sessionId -> Ring(64) of {t, ev, tool, inHash, errHash, errText}
export function note(body, now)            // called by hooks.ingest for every event
export function recent(sessionId)          // array, oldest first
export function counters(sessionId)        // {tools, fails, perms, denied, subagentsLive, compactions:[t...], lastEventAt}
export function sampleCost(sessionId, usd, now)  // ring of {t, usd} at most 1/min, 2 h kept
export function costAt(sessionId, t)       // newest sample <= t
export function inputHash(toolName, toolInput)   // sha1(tool + '\0' + stableJson(input)).slice(0,12)
export function errorHash(text)            // normalise then sha1(..).slice(0,12)
export function prune(liveIds)
```

`errorHash` normalisation: lowercase, replace `\d+` with `N`, `0x[0-9a-f]+` and hex runs of 8 or more with `H`, absolute paths with `P`, collapse whitespace, cut to 400 chars. That way "line 42" and "line 43" hash the same. `stableJson` sorts keys and truncates to 4 KB before hashing. The raw `tool_input` never leaves the builder; only the hash and the existing `summariseToolInput` one-liner do.

Changes to `server/collector/hooks.mjs`:
- `ingest` calls `signals.note(body, now)` before `classify`.
- New `export function subscribe(fn)`. Listeners get `(body, {name, sessionId, now})`, each wrapped in try/catch, and run synchronously after ingest. §8 C4 subscribes to call `approvals.supersede(sessionId)` on PostToolUse/Stop/SessionEnd/UserPromptSubmit.
- `compactPayload` adds `in_hash`, `err_hash` and `error` (oneLine 160).
- The new cases go into `classify`.

`state.prune` (state.mjs:472-473) also calls `signals.prune(liveIds)` (O3).

### 7.3.2 Stuck detector: `server/fleet/stuck.mjs` (builder, new, pure)

```js
export const RULES = ['approval-wait','error-loop','tool-loop','oscillation','stalled','context-pressure','cost-no-progress','idle-in-working'];
// priority order = array order (first match wins the badge; all matches go in evidence)
export function evaluate({ session, lane, events, counters, costNow, costThen, progress, now, cfg }) -> null | Stuck
export function createTracker(cfg)  // keeps per-session {rule -> since, fingerprint history}; .update(sessionsCtx, now) -> Map(name -> Stuck|null), .changes() -> [{name, stuck}]
```

`Stuck = {rule, reason, since, evidence: [{rule, detail}], rules: [rule...]}`. `reason` is short human text, at most 60 chars, e.g. `"Bash ×6 same input"`. `since` is when the winning rule first matched, and the tracker keeps it stable across ticks.

| Rule | Fires when | Config `stuck.*` (default) | reason example |
|---|---|---|---|
| `approval-wait` | state `waiting_permission` (or an unresolved `perm` in the ring) longer than N | `approvalWaitMin: 5` | `approval 7m: Bash` |
| `error-loop` | ≥ K `fail` events with the same `errHash` among the last 20 events and within 15 min | `errorLoopCount: 3`, `errorLoopWindowMin: 15` | `same error ×4 (Bash)` |
| `tool-loop` | the last K PreToolUse events share one `tool+inHash`, with nothing in between | `toolLoopCount: 5` | `Read ×5 same input` |
| `oscillation` | the last 2·R PreToolUse keys alternate A,B,A,B… with A≠B | `oscillationRepeats: 3` | `A↔B ×3 (Edit/Bash)` |
| `stalled` | state `working`, no hook event for N min, and no live subagent with fresh events; if the last event is a PreToolUse with no matching Post (a tool in flight), the threshold is M instead | `stalledMin: 10`, `stalledToolMin: 30` | `no events 14m` |
| `context-pressure` | `context.usedPct > P`, or ≥ 2 `PostCompact` events less than M min apart | `contextPct: 85`, `compactMin: 20` | `ctx 91%` / `compact ×2 in 12m` |
| `cost-no-progress` | `statuslineCostUsd(now) − cost(now − W) ≥ $D` and the progress fingerprint `head|dirty|ahead|linesAdded+linesRemoved` did not change during W | `costWindowMin: 30`, `costUsd: 5` | `$7.10/30m, no diff` |
| `idle-in-working` | the session belongs to a launched lane (a lane record exists, `lanes/store.mjs`), the lane has no `done` marker (LANE-DONE), state is `done`/`idle` for more than N min, and no `need`/`blocked` marker is newer than the state change | `idleMin: 20` | `idle 25m, lane unfinished` |

`stuck.enabled: true` and `stuck.autoPause: false` are defaults. When `autoPause` is true **and** §8's pause action exists, the tracker calls an injected `onAutoPause(name, stuck)` for the rules in `stuck.autoPauseRules: ['tool-loop','error-loop']` only. The default injection is a no-op. Stuck detection never sends keys and never kills.

Wiring, in the flag module `server/flags/stuck.mjs` (O5; X1's `loadModules('flags')`):
- `state.onTick((ctx, now) => …)`: `signals.sampleCost(...)` for every session, then `tracker.update(...)`.
- `state.addDecorator('stuck', {session: (s) => ({stuck: current.get(s.name) ?? null})})`: the derived flag `session.stuck = {rule, reason, since}`; `evidence` stays out of the session so wire deltas stay small.
- For each `tracker.changes()` entry, `ws.send({type:'stuck', name, key, stuck})` with `evidence` included. The §2 A7 tap adds `{builder, seq, epoch}` on the v1 stream.
- `attentionScore` (state.mjs:36) adds `+40` when `s.stuck` is set and the session is not already waiting: implemented once by X1 (it reads the decorated field), so this section does not edit `state.mjs`. The queue still orders by score, so a stuck session ranks below a permission prompt and above a done one.

### 7.3.3 Builder health: `server/collector/health.mjs` (builder, new)

The existing `vitals.mjs` (`server/collector/vitals.mjs:76-94`) samples CPU%, meminfo, swap totals, loadavg, `df $HOME` every 30 s, nvidia-smi and claude RSS on the 2 s tick. It stays as it is for the existing card. `health.mjs` is a separate 10 s sampler with pure parsers:

```js
export function parseStat(text)        // {total, idle, iowait, steal} from the 'cpu ' line
export function cpuDelta(prev, next)   // {busyPct, iowaitPct, stealPct}
export function parseMeminfo(text)     // {memTotalKb, memAvailableKb, swapTotalKb, swapFreeKb}
export function parseVmstat(text)      // {pswpin, pswpout}
export function swapRate(prev, next, dtMs) // {inPerSec, outPerSec} (pages/s)
export function parsePressure(text)    // {some:{avg10,avg60,avg300,total}, full:{...}|null}
export function parseLoadavg(text)     // [1,5,15]
export function parseUptime(text)      // seconds
export function evaluate(sample, cfg)  // [{key, level:'warn'|'crit', value, threshold, text}]
export async function sampleOnce(deps) // deps: {readFile, statfs, dockerGet, tailscale, slots, now}; injectable for tests
export function start(), stop(), latest(), history({since})   // Ring(360) = 10 s × 1 h
```

Sample shape (message `{type:'health', health}` on the builder stream every 10 s, latest sample only):
```js
{ at, uptimeS, vcpu: os.availableParallelism(),
  cpu: {busyPct, iowaitPct, stealPct}, load: [l1,l5,l15], loadPerCpu: l1/vcpu,
  mem: {totalMb, availMb, availPct}, swap: {totalMb, usedMb, inPerSec, outPerSec},
  psi: {cpu:{some10}, memory:{some10, full10}, io:{some10, full10}},
  fs: [{mount:'/', path, sizeMb, availMb, usedPct}, {mount:'docker', ...}, {mount:'worktrees', ...}],
  docker: {ok, running, unhealthy, restarting} | null,
  slots: {total, inUse},             // from collector/slots.mjs snapshot().slots
  rebootRequired: bool,              // fs.existsSync('/var/run/reboot-required')
  tailscale: {online, backendState} | null,
  alarms: [{key, level, text}] }
```

- **Disk:** `fs.promises.statfs(path)` (Node ≥ 18.15, no exec) for `/`, `health.dockerRoot` (default `/var/lib/docker`, skipped if missing) and `health.worktreeDir` (default `config.codeDir`).
- **Docker** is optional and read-only: `http.request({socketPath: health.dockerSocket ?? '/var/run/docker.sock', path: '/containers/json', method: 'GET'})` with a 2 s timeout. It only counts by `State` and by the `(unhealthy)` text in `Status`. It never issues another method; a unit test asserts the request options. On EACCES (the socket is `root:docker 0660`) it returns `docker: null` and logs once.
- **Tailscale** is optional: `run('tailscale', ['status','--json','--self','--peers=false'])` at most once per 60 s. Only `Self.Online` and `BackendState` are kept. **No IPs, no hostnames** go on the wire (hygiene, and they are not needed).
- **Thresholds** come from `health.thresholds`, with these defaults:

| key | warn | crit |
|---|---|---|
| `swapInPerSec` | 50 | 500 |
| `memAvailPct` | < 15 | < 5 |
| `psiMemFull10` | 5 | 20 |
| `psiIoFull10` | 10 | 30 |
| `psiCpuSome10` | 50 | 80 |
| `loadPerCpu` | 1.5 | 3 |
| `fsUsedPct` | 85 | 95 |
| `docker.unhealthy` | ≥ 1 | none |
| `rebootRequired` | true (warn only) | none |

  A level must hold for 2 consecutive samples before it is raised, which debounces it.
- Route (module `server/routes/health.mjs`, `modes:['builder']`, starts/stops the sampler, `ctx.v1.addCapability('health')`, `ws.send({type:'health', health})` every 10 s): `GET /api/v1/health?history=1` returns `{latest, history}` (history is the thinned ring). The standalone UI uses the same route. The hub fetches the history through the read proxy (§3 H12) when the Box view asks, and keeps the latest sample from the stream.

### 7.3.4 Proxmox host-side view (hub; implemented by §5 M1)

Feeds stay a read-only directory: `config.map.feedsDir` is read by `server/map.mjs:115` `readFeeds`. Guests carry `vmid`, `name`, `status`, `cpu` and `mem` (`map.mjs:199-232`). With fleet, the hub runs `mapModel` and reads the feeds; builders in `mode: "builder"` with `fleet.hubKeys` set skip feed reading (`map.feeds: false`).

Linking: a topology node gains an optional `builder: "<builderId>"` field next to its existing `feed: "hv1/103"`. `parseTopology` must keep and validate it: the slug regex, and the id must be in `fleet.builders`, else a warning. In the hub map build, a node with `builder` takes `status = worse(feedStatus, linkStatus(builder))`, where linkStatus maps `up→ok`, `stale→unknown`, `down→down` (§5's mapping). Metrics come from the builder's own `health` when it is fresh and fall back to the feed guest's `cpu/mem`. When there is no explicit `builder` field, the hub falls back to matching `guest.name === builder.id`. **No PVE token on builders, ever.** The hypervisor pushes its feed file to the hub only, which the homelab repo handles.

### 7.3.5 Alarms: `server/fleet/alarms.mjs` (hub, new)

```js
// Alarm = {id, kind, priority:'P1'|'P2'|'P3'|'P4', builder, target, text, since, acked:false, ackedBy:null, ackedAt:null, cleared:null}
export const KINDS = { 'danger':'P1','builder-down':'P1','budget-exceeded':'P1',
  'audit-fork':'P1',            // §3 H13: a builder's audit chain no longer contains an anchored head
  'approval':'P2','needs-input':'P2','blocked':'P2','failed':'P2','stuck':'P2|P3','health-crit':'P2','ci-red-main':'P2',
  'builder-stale':'P3','health-warn':'P3','ci-red':'P3','conflict':'P3','review-overdue':'P3',
  'review':'P4','budget-warn':'P4','reboot':'P4' };
export function derive(fleet, now, cfg) -> Alarm[]        // pure: from fleet store (attention, stuck, health, link state, CI, budget, conflicts, review waits)
export function reconcile(prev /*Map id->Alarm*/, derived, now) -> {next, raised:[], cleared:[]}  // pure
export function ack(map, id, user, now) -> Alarm | error
export function ackMany(map, {tile, builder}, user, now, kindToTile) -> Alarm[]   // target '*'
export function fleetOfOne(snapshot, health, now) -> FleetView                    // standalone builder input for derive()
// TILES/tileStates are NOT here: the UI owns the 8-tile map (public/js/core/alarm-tiles.js, §4 D7).
```

- **Ids are deterministic**, `${kind}:${builder}/${target}`, so deriving again is idempotent. `stuck` takes P2 for `approval-wait`, `error-loop` and `tool-loop`, and P3 otherwise.
- **Lifecycle:** a derived alarm that is absent from `prev` is *raised* (`since = now`, unacked). One present in `prev` keeps its `since` and `acked` fields. One that is no longer derived is *cleared* (`cleared = now`), moves to history, and is dropped from the live set. If it is raised again later, it is a new instance, unacked.
- **Derive inputs** (per builder in the fleet view): `needs-input` ← attention entries in `waiting_question` or a live `need` marker; `approval` ← `snap.approvals` / `awaitingApproval`; `blocked` ← live `blocked` markers; `failed` ← `activity.failure` (StopFailure); `danger` ← session `danger`; `stuck` ← `session.stuck`; `health-*`/`reboot` ← `health.alarms`/`rebootRequired`; `builder-down`/`builder-stale` ← conn state (hub only); `ci-red-main` ← a package row with `main.status==='fail'`, `ci-red` ← a lane PR verdict red (§6 rows); `budget-*` ← `snap.budget` levels (§8 C7); `conflict` ← textual edges (§6); `review`/`review-overdue` ← lanes with `reviewReady.ready` and §7 O10's open waits (optional dependency: O10's hub module does `ctx.provide('reviewWaits', …)`; O8 uses it only when `ctx.has('reviewWaits')`, so O8 does not depend on O10).
- **Tile states** are computed in the UI (§4 D7: `normal | unack | ack`). `audit-fork` ← H13 (hub only).
- **Ack:** the action `ack-alarm` with `target = alarm id` (or `*` with `args {tile, builder?}`) is handled where the alarms live: on the hub as a hub-local action (`relay.registerHubAction('ack-alarm', …)`), **never relayed** to a builder; on a standalone builder through the dispatcher (`localOnly`). It is audited and broadcast as `{type:'alarms', alarms}`.
- **Persistence:** `server/fleet/alarms-store.mjs` keeps the live map in `db.kvWrite('alarms.live', …)` (reloaded on restart, so an ack survives a restart) and writes history as `db.addEvent({type:'alarm', subtype:'raised'|'cleared'|'acked', payload})`, kept by the existing event retention. No new table.
- The hub evaluates alarms on every fleet-store change, throttled to 1/s. Every builder-supplied `text` is plain text; the UI renders it with `textContent`.

### 7.3.6 Notifications: `server/hub/notify.mjs` (hub, new) and `server/push.mjs` (changed)

`push.mjs` keeps `ensureVapid`, `sendTo` and `broadcast` (:18-110), which are reused unchanged. The hub owns subscriptions (`push_subscriptions` in the hub db).

```js
export function shouldNotify(alarm, prefs, lastAt, now, tz) -> {notify:bool, reason, defer:bool}  // pure
export function onRaised(alarms)                 // from alarms.reconcile().raised
export function digest({since}) -> [...]          // deferred during quiet hours, for Morning
```

- **Rules:** notify only on a *raise* (a state change), never on re-derivation. At most 10 pushes per builder per 10 min (builder-chosen names cannot defeat coalescing); every builder string is length-capped, and `url` uses `encodeURIComponent(fkey)`. The kinds that are on by default are in `notify.kinds`: `needs-input`, `approval`, `failed`, `review`, `stuck`, `builder-down` and `danger` (`done ≥ 5 min` keeps today's semantics via `review` and `needs-input`). Notifications for the same `builder/target` are coalesced within 60 s, as `push.mjs:13` does today.
- **Quiet hours:** `notify.quietHours: {from:'23:00', to:'07:30'}` in `config.timezone`. A raise inside the window gets `defer: true` and is stored in kv `notify.deferred` (bounded to 200), which Morning (§10 R10) lists under "while you were away". `notify.quietBypass: ['danger','builder-down']` are sent anyway. This matches today's `onDanger`, which ignores quiet (`push.mjs:168-185`).
- **Toggles:** `GET/POST /api/notify/prefs` (hub module `server/hub/routes/notify.mjs`; UI §4 D14) returns `{kinds:{[kind]:bool}, quietHours, mutedTargets:[fkey]}`, stored in the kv row `notify.prefs`. The existing `/api/push/quiet` (`index.mjs:279`) maps onto `mutedTargets` on the hub.
- **Payload:** `{title:'<CODE> <kind>: <name>', body, tag:'lb-<alarm id>', url:'#/inbox?sel=<fkey>'}`.
- **Builders:** `push.onTransition` (called at `state.mjs:458`), `push.onMarker` (`state.mjs:264`) and `push.onDanger` (`index.mjs:495`, now `server/boot/builder.mjs`) return early unless `config.push.local` is true; the guard sits inside `server/push.mjs` (O3), so neither caller is edited. It defaults to `true` when `fleet.hubKeys` is empty (standalone) and to `false` once a hub is configured. The rule functions and their tests stay as they are.

### 7.3.7 Review-wait metric (hub)

- `reviewReadyAt(lane)` is `lane.reviewReady.since` from §10 R5's lane flag `reviewReady {ready, reasons:['done-marker'|'pr-green'|'stop-diff'], since}`; `ready_source` is the first reason.
- **First human touch** is the earliest of:
  1. the hub UI opening the inspector or peek on any session of that lane: the client sends `{type:'touch', fkey, how:'inspect'|'peek'|'term'}` on the hub `/ws`, and the hub records it only if `Tailscale-User-Login` was present on that WS;
  2. a GitHub review or comment by a non-bot: §6 P5 adds `reviews` and `latestReviews` to the `gh pr view --json` fields and exposes `pr.firstReviewAt`; the hub reads it from the lane's `pr` in the snapshot.
  3. a `send-review` action (§10) sets the lane's `reviewSentAt`, which also counts as the touch.
- Hub storage: kv `review.waits` = `{open: {[fkey]: {builder, lane, prNumber, readyAt, readySource}}, closed: [last 500 {fkey, readyAt, touchedAt, touchSource}]}` (no table). An open wait closes exactly once, on the first touch.
- `server/hub/reviewwait.mjs` exports `createReviewWaits({db, now, cfg})` → `{onLanes(builderId, lanes), touch(fkey, how, user), stats({since}) -> {n, medianMs, p90Ms}, open() -> [{fkey, waitingMs, readyAt}], closed({since})}`; §10 R10 calls `stats`/`open`, §7 O8 uses `open()` for `review-overdue`. O9's `notify.digest({since})` is what R10 shows as `deferred`.
- `GET /api/review-waits?since=` (hub module `server/hub/routes/review-waits.mjs`) returns `{open:[{fkey, waitingMs}], stats:{n, medianMs, p90Ms}}` for the last 7 d. Morning shows the stats plus the oldest open wait. Inbox shows `waitingMs` on each review row. When an open wait passes `review.overdueHours: 4`, the `review-overdue` alarm is raised.

### 7.3.8 Morning and Credit fleet-wide

Morning and Credit read builder-local SQLite tables (markers and cost_snapshots in `morning.mjs:157,229`; rate_limit_samples in `credit.mjs:72`), so aggregation means fanning out to the builders through the read proxy (§3 H12):
- **New builder API v1 reads** (signed like the others): `GET /api/v1/morning?window=` (registered by §10 R7, capability `morning`) returns `morning.build({window})` and `GET /api/v1/credit` (O11, module `server/routes/v1-credit.mjs`, capability `credit`) returns `credit.build()`.
- **Merges:**
  - `mergeMorning` is §10 R10's `server/hub/morning.mjs`. It must also do what this section needs: turn every `name`/`lane` into an fkey and add `builder`; concatenate `needsYou` and `finished` and re-sort them with the same comparators (`morning.mjs:170`, `:216-221`); sum `cost.totalUsd` and `totalTokens`; add `reviewWaits` (O10) and `deferred` (7.3.6); list `missing:[builderId]` for builders that did not answer within 3 s.
  - `mergeCredit(parts)` in `server/hub/credit.mjs` (O11) keeps the charts per builder (`charts.byBuilder[id]`) plus an `account` series: the per-timestamp maximum after aligning to the minute. All builders run on one subscription, so their values agree, and the maximum is the safe number. The cost rows become `{builder, lane: fkey, ...}` and the totals are summed.
- The hub routes `GET /api/fleet/credit?b=` (O11, `server/hub/routes/credit.mjs`) and `GET /api/fleet/morning?window=&b=` (§10 R10) serve the merged results, cached 15 s like the existing `memo('credit')` (`index.mjs:99`). `b=<id>` returns a single builder's result unmerged except for the fkeys. `morning.mjs` (§10 R7) and `credit.mjs` (O11) themselves only gain an optional `builder` parameter that is echoed back; their logic does not change.

### 7.3.9 Config keys (all optional; fragment `server/config/observability.mjs`)

```js
stuck: { enabled: true, autoPause: false, autoPauseRules: ['tool-loop','error-loop'],
  approvalWaitMin: 5, errorLoopCount: 3, errorLoopWindowMin: 15, toolLoopCount: 5, oscillationRepeats: 3,
  stalledMin: 10, stalledToolMin: 30, contextPct: 85, compactMin: 20, costWindowMin: 30, costUsd: 5, idleMin: 20 },
health: { sampleMs: 10000, historyMin: 60, dockerSocket: '/var/run/docker.sock', dockerRoot: '/var/lib/docker',
  worktreeDir: null /* = codeDir */, tailscale: true, thresholds: { /* table 7.3.3 */ } },
push: { local: null /* null = auto: true iff fleet.hubKeys empty */ },
notify: { kinds: {...}, quietHours: null, quietBypass: ['danger','builder-down'] },   // hub
// review.overdueHours: 4 (hub) is defined in §10's server/config/review.mjs
alarms: { evalMs: 1000, historyDays: 30 },                                              // hub
```
The fragment's `validate(c, bad)` does range checks: positive numbers, percentages ≤ 100, `quietHours` as `HH:MM`.

## 7.4 Implementation tasks (dependency order)

| # | Task | Files owned | Done when |
|---|---|---|---|
| O1 (T1) | New hook events and classify cases; `signals.mjs` ring and hashes; `hooks.subscribe`. Deps none | `deploy/hooks.json`, `server/collector/hooks.mjs`, `server/collector/signals.mjs` (new), `test/hooks.test.mjs` (extend), `test/signals.test.mjs` (new), `test/fixtures/hooks/*.json` | `npm test` green; classify covers all 8 new events; replaying the fixtures fills the ring |
| O2 (T2) | Config fragment `stuck`, `health`, `push.local`, `notify`, `alarms` with validation. Deps X1, F4 | `server/config/observability.mjs`, `test/config-observability.test.mjs` | defaults present; bad values rejected with a ConfigError |
| O3 (T3) | New `state.mjs` fields (effort, thinking, promptCache, apiMs, head) + `signals.prune` + `push.local` guard inside `push.mjs`. Deps O1, O2, F7, X1 | `server/state.mjs`, `server/push.mjs`, `test/state.test.mjs` | snapshot carries the new fields from a fixture sidecar JSON; with `fleet.hubKeys` set and `push.local` null, `push.onTransition` sends nothing |
| O4 (T4) | `server/fleet/stuck.mjs` pure rules + tracker. Deps O1, O2 | `server/fleet/stuck.mjs` (new), `test/stuck.test.mjs` (new) | every rule has a positive and a negative case (7.5) |
| O5 (T5) | Flag module: tracker on tick, `stuck` decorator, `stuck` WS message. Deps O3, O4, X1 | `server/flags/stuck.mjs`, `test/flags-stuck.test.mjs` | a synthetic tick test sees `session.stuck` set and cleared, a `stuck` message with evidence, and the attention order stuck > done |
| O6 (T6) | `server/collector/health.mjs` parsers + sampler + route module. Deps O2, X1, F9 | `server/collector/health.mjs` (new), `server/routes/health.mjs` (new), `test/health.test.mjs` (new), `test/fixtures/proc/*` (new) | parsers match the fixtures; the ring is capped at 360; the Docker request is GET-only; `/api/v1/health?history=1` returns `{latest, history}` |
| (T7) | Folded into §5 M1 | — | — |
| O8 (T8) | `server/fleet/alarms.mjs` derive/reconcile/ack/ackMany/fleetOfOne + kv store + builder module + hub module (service + hub-local `ack-alarm`). Deps O4, O6, H3, A6, X1 | `server/fleet/alarms.mjs`, `server/fleet/alarms-store.mjs`, `server/routes/alarms.mjs`, `server/hub/routes/alarms.mjs`, `test/alarms.test.mjs` | raise/clear/re-raise/ack semantics; ack survives a store reload; `ack-alarm *` with `{tile:'STCK'}` acks only stuck alarms; `ack-alarm` from a signed hub request on a builder → 403 `local-only`. REVIEW-REQUIRED (SR20) |
| O9 (T9) | `server/hub/notify.mjs` rules, quiet hours, deferred digest + prefs routes. Deps O8 | `server/hub/notify.mjs`, `server/hub/routes/notify.mjs`, `test/notify.test.mjs` | a quiet-hours raise is deferred, a bypass kind is sent, coalescing within 60 s; 15 raises from one builder with 15 distinct targets inside 10 min send 10 pushes (the rest go to the digest); a session name of 500 chars and one containing `/`, `?` and `#` give a capped title/body and a `url` with the fkey percent-encoded (S20) |
| O10 (T10) | Review-wait on the hub: `touch` handler, kv store, endpoint, `review-overdue` input. Deps §10 R5, H3, H7, P5 | `server/hub/reviewwait.mjs`, `server/hub/routes/review-waits.mjs`, `test/reviewwait.test.mjs` | ready/touch upserts are idempotent; the stats are correct; a touch without a user is ignored |
| O11 (T11) | Credit fan-out: `/api/v1/credit` + `mergeCredit` + `/api/fleet/credit`. Deps H12, F9, X1 | `server/routes/v1-credit.mjs`, `server/hub/credit.mjs`, `server/hub/routes/credit.mjs`, `server/credit.mjs` (optional `builder` echo only), `test/fleetviews-credit.test.mjs` | merging 2 fixture builders produces fkeys, summed totals and an account series equal to the max |

UI work belongs to §4 (stuck badge D9, Box health D11, annunciator tiles D7, notification prefs D14, Credit D13), §8 C13 (review wait in Inbox) and §10 R15 (Morning). This section only provides the data shapes above.

## 7.5 Tests

- **`test/stuck.test.mjs`** feeds synthetic event arrays (`{t, ev, tool, inHash, errHash}`) and session objects into `evaluate`:
  - approval-wait fires at 5:01 and not at 4:59;
  - error-loop fires on 3 identical errHashes, not on 2, and not when they are spread over more than 15 min;
  - tool-loop fires on 5 identical PreToolUse and is broken by one different call;
  - oscillation fires on ABABAB, not on AAB or ABC;
  - stalled fires at 10 min, uses 30 min while a tool is in flight, and is suppressed by a live subagent;
  - context-pressure fires on 86% and on two compactions 12 min apart;
  - cost-no-progress fires on +$6 with the same fingerprint, not when `head` changed;
  - idle-in-working fires on a lane record with no done marker and done for 25 min, and is suppressed by a newer NEED marker;
  - the tracker keeps `since` stable across ticks, picks the winner by RULES order, and evidence lists every matched rule;
  - `autoPause:false` never calls `onAutoPause`.
- **`test/signals.test.mjs`**: errorHash normalisation (digits, paths, hex); inputHash is the same for the same input regardless of key order; ring cap at 64.
- **`test/health.test.mjs`** uses fixtures `test/fixtures/proc/{stat.1,stat.2,meminfo,vmstat.1,vmstat.2,pressure-cpu,pressure-memory,pressure-io,loadavg,uptime}`. They are copied from a real box with numbers edited, and contain no hostnames.
  - Covers the cpuDelta and swapRate maths, pressure parsing both with and without a `full` line (the cpu file on older kernels), threshold levels, the 2-sample debounce, and the ring cap.
  - `sampleOnce` with injected deps degrades to `null` when Docker or Tailscale throws.
  - A fake `http.request` asserts `method === 'GET'` and the path `/containers/json`.
  - Tailscale output is reduced to `{online, backendState}` (the fixture JSON has an `example.invalid` DNS name and `192.0.2.x` addresses, which pass hygiene and are asserted absent from the output).
- **`test/alarms.test.mjs`**: deterministic ids; raise→cleared→raise gives a new unacked instance; ack persists across reconcile and a kv reload; ack of an unknown id returns an error; `ackMany` by tile/builder; priorities per kind; stuck P2 vs P3; `fleetOfOne` derives the same alarms as the hub for one builder (minus link kinds); builder text is never interpreted (an alarm with `<img>` text round-trips as a string).
- **`test/notify.test.mjs`**: only raises notify; per-kind toggle off; quiet window across midnight in the configured timezone; bypass kinds; coalescing; the deferred list appears in the digest.
- **`test/fleetviews.test.mjs`**, **`test/reviewwait.test.mjs`**: as in T10 and T11.
- Existing `test/push.test.mjs`, `test/hooks.test.mjs`, `test/morning.test.mjs` and `test/credit.test.mjs` stay green unchanged, apart from additions.

## 7.6 Risks, open questions, human checks

- **Q1 (OTel):** deferred (7.2.3). Revisit if hook coverage turns out to have gaps, e.g. `tool.blocked_on_user` timings.
- **Payload field names:** the exact PostToolUseFailure, StopFailure and PermissionRequest fields are not documented in this repo. The code reads them defensively (`error ?? tool_response?.error ?? message`). `HUMAN:` on one builder, trigger a failing Bash call, a permission prompt and a `/compact`, then `curl 127.0.0.1:7777/api/events?limit=20` and check that `err_hash`, `perm` and compaction rows appear.
- **Hook reload:** existing Claude sessions may only pick up the new hook keys after a restart. `HUMAN:` re-run `deploy/install-claude.sh` on each builder and confirm with `jq '.hooks|keys' ~/.claude/settings.json` that there are 15 events.
- **Hook volume:** PostToolUseFailure and PermissionRequest add at most one event per tool call. The `events` table already takes every Pre/Post event, and retention (`db.mjs:276`) covers it.
- **False positives:** `stalled` during long builds is handled by `stalledToolMin`. `cost-no-progress` during pure reading or research can fire, which is acceptable for a badge. The thresholds can be tuned per box.
- **Docker socket permission:** the laneboard user must be in the `docker` group for Docker counts; otherwise the value is null. This is a read-only GET, but group membership grants root-equivalent access. `HUMAN:` decide whether to grant it; the default config works without it.
- **Conventions mismatch (resolved):** stuck is computed on the builder, because only the builder has raw events, and the hub owns alarms derived from it. The conventions and §3 now say so.
- **Morning fan-out latency:** with N builders × 3 s timeout, a slow builder shows as `missing`, never blocks.
- `HUMAN:` check on a phone that a quiet-hours raise does not buzz and shows up in Morning the next day.

## 7.7 Dependencies on other sections

- **§3** (fleet store, services hook, `onClientMessage`, relay `registerHubAction`, read proxy, `/ws`): O8, O9, O10, O11 need it. This section adds the `health`, `stuck`, `alarms` and `touch` messages and the v1 `health` and `credit` reads.
- **§2** (dispatcher `registerAction`, `ctx.v1.addCapability`); **§11 X1** (`loadModules`, config fragments, `state.addDecorator`/`onTick`, attention bump).
- **§8** (approvals, pause): consumes `hooks.subscribe` for supersede and implements the pause that `stuck.autoPause` would call; `snap.budget` for the `budget-*` inputs.
- **§6**: `pr.firstReviewAt` (P5), the `ci-red*` and `conflict` inputs (rows/edges).
- **§10**: the lane `reviewReady` flag (R5) and the Morning merge (R10).
- **§4**: the badge, annunciator (`alarm-tiles.js`), Box health sparklines, notify prefs sheet, Credit view; **§5** M1 uses `health` for builder node metrics.
- **Keys:** `server/fleet/keys.mjs` `fkey`, used by alarms, review waits and the merges.

## 7.8 PRIVATE (homelab repo)

Private details: homelab repo.
