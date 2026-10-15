# Fleet plan: master index

laneboard becomes a **fleet**: one hub UI that shows and controls every builder. This file is the integrated, authoritative index for the overnight implementation. Where a section file and this file disagree, this file wins (the integrator edited the sections to match; see `INTEGRATION-REPORT.md` for every conflict and its resolution).

## 1. Goal and approved scope

Goal (from `00-conventions.md`): turn laneboard (one Node 24 process per machine, vanilla JS, no build step) into a fleet with an industrial UI where the Map is home, packages/CI per package across several repos, stuck detection, an approval queue, pause/broadcast/kill, budget caps, builder health, a review queue, conflict prediction, and dispatch with placement. Architecture **A: a hub**. The user approved all ideas.

Approved scope, by section (numbering is fixed):

| § | File | Scope |
|---|---|---|
| 0 | `00-conventions.md` | shared names and contracts (updated by the integrator) |
| 1 | `01-foundations.md` | JS/CSS split into modules, fleet keys, multi-builder client store, security baseline (Host/Origin/CSRF/CSP, no HTML from data), fleet identity config, API v1 skeleton |
| 2 | `02-builder-api-auth.md` | Builder API v1, request classification (local/direct/hub), Ed25519 signatures, dispatcher with tiers + rate limits, hash-chained audit log, CLI keygen/audit |
| 3 | `03-hub.md` | `mode:"hub"`: upstream per builder, fleet store, hub `/ws`, relay, placement, terminal proxy, read proxy, audit reconciliation, services hook |
| 4 | `04-design-shell.md` | ISA-101 tokens, fonts, icon sprite, shell, router, hotkeys (authoritative), components, board, rail, inspector, annunciator, Box/Audit/Credit views |
| 5 | `05-fleet-map.md` | fleet Map model (server) and client split/restyle, overlays, split view, minimap |
| 6 | `06-packages-ci.md` | repos/packages, CI per job, touches, conflict prediction, merge order, plans, stale branches, Packages view |
| 7 | `07-observability.md` | hook signals, stuck detection (builder), health, alarms (hub), notifications, review-wait, fleet Credit |
| 8 | `08-control.md` | approvals, pause/resume, broadcast, kill switches, budgets, dispatch, installer, Inbox and control UI |
| 9 | `private/09-homelab-hub-room.md` | homelab hub room and rollout (**private, homelab repo**, not in the laneboard DAG) |
| 10 | `10-workflow-review.md` | review queue, diff review, peek & reply, transcript, run scripts, archive/restore, fleet Morning |
| 11 | `11-execution-qa.md` | overnight execution model, wave 0 splits, test kit, QA, definition of done |

Explicitly out tonight: `mode:"both"`; semantic conflicts; posting reviews to GitHub (§10 T10.16); OpenTelemetry (§7); dev-server preview proxy (§10); persistent "always allow" approval policies (§8); new runtime or dev dependencies; anything on `main`.

Also here: `INTEGRATION-REPORT.md` (every conflict and its resolution) and `SECURITY-FIXES.md` (public: every finding of the adversarial security review mapped to the section and task ids that fix it, or to an accepted-risk rationale). The review itself and the tailnet measurements (`SECURITY-REVIEW.md`, `VERIFIED-FACTS.md`) contain private names and live in `private/`.

`private/` holds every "PRIVATE (homelab repo)" subsection (`private/<nn>-private.md`) and all of section 9. Public files pass the laneboard hygiene test's terms.

## 2. Architecture

```
  browser (phone / laptop, user's tailnet identity)
     |  https://hub:8443  (tailscale serve -> hub 127.0.0.1:7778 ingress listener)
     |  /ws (fleet, snapshot, delta, map, alarms, packages, approval, stuck, health)
     |  POST /api/fleet/actions  {builder, action, target, args}   + X-Laneboard: 1
     |  WS /ws/term/:builder/:name     GET /api/fleet/:builder/v1/<allowlisted read>
     v
 +-----------------------------  HUB  (mode:"hub", server/boot/hub.mjs)  ------------------------------+
 | auth.classify: direct (Tailscale-User-Login; may act) | local (loopback; reads only); hub refused  |
 | fleet-store <- upstream x N        relay (signs, user = req.auth.user, audit sent/done)            |
 | aggregates, Map (buildFleet/tickFleet), services: alarms, notify(web push), review-wait, packages  |
 | read-proxy (allowlist), term-proxy, audit-reconcile         hub.key (PEM PKCS8 Ed25519, 0600)      |
 | map feeds dir (hypervisor feeds pushed here)                hub audit.jsonl (own chain)            |
 +--------|----------------------------------|------------------------------------------------------+
          | hub dials out only; every request signed:                     builders never dial the hub
          |  reads/upgrades: X-Laneboard-Ts/-Nonce/-Key/-Sig over          and hold no hub credentials
          |    "v1 METHOD builderId pathWithQuery ts nonce"
          |  actions: X-Laneboard-Sig: ed25519 <b64> over canonicalJson(envelope), X-Laneboard-Key
          v
 +-------------- BUILDER A (mode:"builder") ----------------+   +-------------- BUILDER B ---------------+
 | tailscale serve :8443 -> 127.0.0.1:7778 (ingress)        |   | same                                    |
 | 127.0.0.1:7777 local listener: CLI, hooks (kind local)   |   |                                         |
 | /api/v1: hello snapshot stream(seq,epoch,resync) actions |   |                                         |
 |   audit jobs term approvals health morning credit diff   |   |                                         |
 |   transcript preview archive                             |   |                                         |
 | dispatch: tiers, limits, key scopes + hubControl, remote |   |                                         |
 | audit.jsonl (hash chain; hub anchors its head, H13)      |   |                                         |
 | stuck detector, health sampler, packages/CI collector,   |   |                                         |
 | approvals (sync PermissionRequest hook), pause gate.sh   |   |                                         |
 | own UI keeps working standalone (one code path, fkeys)   |   |                                         |
 +----------------------------------------------------------+   +-----------------------------------------+
```

Trust: builders are least trusted. On a builder itself, pause/budget/approvals/kill/audit are **cooperative** controls (an agent with a shell there can bypass them); the security boundary is cross-machine (builder → other builder, hub, the user's devices). Everything a builder sends is untrusted text at the hub (sanitized and size-bounded in the fleet store, rendered with `textContent` only, strict CSP, no `innerHTML` anywhere under `public/js/**`). Builders verify the hub's signature against `fleet.hubKeys`, bind every signed request to their own id, reject replays (±60 s, nonce cache pre-loaded from the audit log), and refuse every hub action unless the signing key has the `control` scope (terminals: `term`) **and** `fleet.hubControl` is true. Approve/deny/release/set-budget/budget-resume/`kill *` are remote-only (a `direct` user through serve or a control-scoped hub request; never `local`), and on the hub every action needs `direct`. Security-critical files are REVIEW-REQUIRED (4.5): each gets an independent review task, the hub runs only a human-pinned commit.

## 3. Resolved contracts

### 3.1 Code layout (X1, wave 0)

- `server/index.mjs`: ~15-line dispatcher → `await import(config.mode === 'hub' ? './boot/hub.mjs' : './boot/builder.mjs')`. Shared helpers in `server/boot/common.mjs` (`listenAll({onUpgrade})` incl. the `fleet.ingressPort` listener, `shutdown`, `registerHealthz`, `upgradeHandlers`); `server/version.mjs` (`VERSION`). `server/boot/builder.mjs` = today's `index.mjs`, moved verbatim.
- Feature modules: `server/routes/*.mjs` (builder), `server/flags/*.mjs` (builder state decorators), `server/hub/routes/*.mjs` (hub, loaded by H11 only). Shape `{name, modes, register(ctx), start?(ctx), stop?()}`; `loadModules(dir, ctx)` runs every `register` in filename order, then every `start`. Hub ctx services (`store`, `relay`, `readProxy`, `services`, `broadcast`, `onClientMessage`, `audit`) via `ctx.provide`/`ctx.use`, provide in `register`, use in `start`.
- Builder registries are module singletons imported directly: `server/fleet/dispatch.mjs` (`registerAction`, `registerAllHandler`, `dispatch`, `tiers`) and `server/fleet/api-v1.mjs` (`addCapability`, `addHelloField`). Section text saying `ctx.v1.*`/`ctx.dispatch.*` means these imports.
- Config: fragments `server/config/<area>.mjs` exporting `{defaults(), fromEnv(env), validate(c, bad), finalize?(c)}`, deep-merged by `server/config.mjs`; duplicate leaf keys across fragments → `ConfigError`.
- State hooks: `state.addDecorator(name, {session?, lane?})`, `state.addSnapshotKey(name, fn)`, `state.onTick(fn)`; X1 makes `attentionScore` read `awaitingApproval` (as `waiting_permission`) and `stuck` (+40 unless waiting).
- Frozen after wave 0 (edit only where a card names them): `server/index.mjs`, `server/boot/builder.mjs` (F7, A8), `server/config.mjs` (P8 one line), `server/state.mjs` (F6, F7, O3), `server/ws.mjs` (F6, F7, A7). New messages go through `ws.send(msg)`; the A7 tap stamps them for the v1 stream.
- Frontend: `public/js/{core,ui,views}` (F1), `public/css/**` and `public/css/views/<view>.css` (F2), view registry `public/js/views/index.js` with default exports `{id, icon, title, mount(el, ctx), unmount(), update(store)}` (D4). Docs: each task writes `docs/fleet/<topic>.md`; X4 assembles `docs/fleet.md`, `docs/config.md`, `README.md`, `docs/map.md`, `CHANGELOG.md` (from `Changelog:` commit trailers).
- Task/branch naming: lowercase DAG id + slug, e.g. `fleet/x1-boot-split`, worktree `~/code/laneboard-x1-boot-split`, tmux `lb-x1-boot-split`.

### 3.2 Headers and identity

| Item | Contract |
|---|---|
| Mutating request (browser, CLI, hub relay) | `X-Laneboard: 1`; exempt: `POST /api/hook`, `POST /api/hook/permission` (`HOOK_PATHS`, local only). No CORS, `OPTIONS` → 405 |
| Request kind (`auth.classify`) | `fleet.ingressPort` mandatory with a `fleet` block (no header heuristic); not on ingress port → `local`, with every `Tailscale-User-*`/`-App-Capabilities` header deleted; ingress without `X-Forwarded-For`/`X-Forwarded-Proto` → 403 `not-from-serve` (also when the optional `fleet.ingressPeerUid` check fails, A11); ingress + `Tailscale-User-Login` → `direct` (optional `fleet.allowedUsers`); ingress + valid signature, no user header → `hub` with the key's scopes (optional `fleet.hubAddrs` match on `X-Forwarded-For`); both → 400; neither + `fleet.enforce` → 403. On a hub, kind `hub` → 403 |
| Signed read / stream upgrade | headers `X-Laneboard-Ts`, `-Nonce` (UUID), `-Key` (keyId), `-Sig` (`ed25519 <b64>`) over `` `v1 ${METHOD} ${builderId} ${pathWithQuery} ${ts} ${nonce}` `` (`pathWithQuery` = raw `req.url`); headers only, no query-param signatures. Built only by `auth.signRead()`/`signedReadString()`. Verify order: key → signature → ts → nonce insert |
| Terminal upgrade from the hub | signed `term` envelope in `X-Laneboard-Envelope` (base64url canonical JSON) + `-Sig`/`-Key`; refused unless the key has scope `term` and `fleet.hubControl` is true; a read signature never opens a terminal |
| Action envelope | `{v:1, id:uuid, ts, builder, action, target, args, user, via:'hub'|'direct'|'legacy'}`; hub adds `X-Laneboard-Sig` over `canonicalJson(envelope)` + `X-Laneboard-Key`; builder checks `builder === fleet.id`, ±`clockSkewMs`, nonce unseen |
| Hub key | `~/.config/laneboard/hub.key` (`fleet.hubKeyFile`, default `paths.hubKeyFile()`), PEM PKCS8 Ed25519, 0600, from `laneboard fleet keygen` or `openssl genpkey -algorithm ed25519` |
| Pinned keys | `fleet.hubKeys`: entries `{key: "<PEM SPKI or ed25519:<base64 raw 32 bytes>>", id, scopes: ["read", "control"?, "term"?]}`; a bare string = that key with scopes `["read"]`; `keyId` = first 16 hex of sha256(raw 32 bytes). Reads need `read`, actions `control`, terminals `term`; `fleet.hubControl:false` is a master switch that refuses `control` and `term` whatever the scopes |
| Origin/Host | Host (with port; serve preserves `host:8443`) ∈ loopback:port / `fleet.publicHosts` / hosts of `fleet.allowedOrigins`; Origin same-origin or in `fleet.allowedOrigins`; signed `hub` requests must carry no Origin; WS from `direct` must carry Origin |
| CSP | §1 F5 `securityHeaders` on builder and hub: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://<Host> wss://<Host>; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` |
| Fleet keys | `"<builderId>/<localName>"`, `fkey`/`parseFkey`/`laneNodeId` in `server/fleet/keys.mjs` and the client copy `public/js/core/keys.js` |
| Previews | wire carries `previewLines` (raw ANSI, ≤8 × 400 chars); client renders with `core/ansi.js`; `preview`/`previewHtml` never on the wire |

### 3.3 Endpoints

Builder (all modes `builder`; v1 reads accept `local`, `direct`, signed `hub`):

| Method + path | Owner | Notes |
|---|---|---|
| `GET /healthz` | X1 | unchanged, auth-exempt |
| legacy `/api/*` routes | existing; A8 adapts mutating ones through `dispatch` (`via:'legacy'`) | `fleet.legacyBrowserRoutes` stays `true` tonight |
| `POST /api/hook` | existing | local only when enforcing; CSRF-exempt |
| `POST /api/hook/permission` | C4 `server/routes/approvals.mjs` | sync PermissionRequest hold; `local` + loopback + no serve headers + `X-Laneboard-Hook` token; 403 empty body otherwise |
| `GET /api/packages` | P9 `server/routes/packages.mjs` | standalone packages rows |
| `GET /api/v1/hello` | F9, A8 | `{id, code, version, apiVersion:1, mode, capabilities[], actions:{name:tier}, time, auth:{kind}, repos?, permissionModes?, scripts?}` |
| `GET /api/v1/snapshot` | F9, A8 | `state.snapshot()` + `{builder:{id,code}, seq, epoch}`; snapshot keys `repos`, `approvals`, `budget` |
| `WS /api/v1/stream` | A7, A8 | see 3.4 |
| `POST /api/v1/actions` | A8 → A6 `dispatch` | `{ok, result|error, code?, auditId}`; launch 202 |
| `GET /api/v1/audit?since=&after=&limit=` | A8 | `{builder, head:{hash,count}, entries, more}` |
| `GET /api/v1/jobs/:id` | A8 | `{job, steps}` |
| `WS /api/v1/term/:name[?cols&rows&window=run-<s>]` | A7, R8 | audited as `term`; from hub only with a `term` envelope, `term` scope and `hubControl` (403 `control-disabled` / `scope-missing`) |
| `GET /api/v1/approvals` | C4 | pending approvals |
| `GET /api/v1/health?history=1` | O6 | `{latest, history}` |
| `GET /api/v1/credit` | O11 | `credit.build()` + `builder` |
| `GET /api/v1/morning?window=` | R7 | `morning.build()` + `builder`, lanes with `packages`, `reviewReady`, `reviewSentAt` |
| `GET /api/v1/lanes/:id/diff?base=&mode=&path=` | R7 (R2 logic) | caps per §10 |
| `GET /api/v1/sessions/:name/transcript?after=|before=&limit=` | R7 (R4 logic) | plain text entries |
| `GET /api/v1/sessions/:name/preview?n=` | R7 | `{name, lines}` raw ANSI |
| `GET /api/v1/archive?q=&limit=&before=`, `GET /api/v1/archive/:lane` | R9 | archive rows |

Hub (mode `hub`; `direct` or `local` only):

| Method + path | Owner | Notes |
|---|---|---|
| `GET /healthz` | X1, H11 | `+{mode:'hub', builders:{up,stale,down}}` |
| `GET /api/fleet` | H11 | `{builders:[BuilderRow], aggregates}` |
| `GET /api/fleet/:builder/snapshot` | H11 | cached snapshot + `stale`, `ageMs` |
| `GET /api/state?b=<id>` | H11 | compat for `bin/laneboard` |
| `GET /api/map` | H11 (M1 model) | fleet Map |
| `POST /api/fleet/actions` | H8 relay | `direct` only (`local` → 403 `remote-only`); body `{builder|'*'|null, action, target, args}`; hub-local: `broadcast` (C8), `ack-alarm` (O8), `kill`/`pause`/`resume` with `builder:'*'` (C9 / H8) |
| `POST /api/fleet/placement` | H8 | dry-run ranking |
| `GET /api/fleet/audit?since=&builder=` | H11 + H13 | hub entries + reconciliation `state` |
| `GET /api/fleet/:builder/v1/<allowlisted>` | H12 | signed read proxy (fixed allowlist in §3 2.14) |
| `GET /api/packages` | P11 | merged packages |
| `GET/POST /api/notify/prefs` | O9 | prefs |
| `GET /api/review-waits?since=` | O10 | `{open, stats}` |
| `GET /api/fleet/credit?b=` | O11 | merged credit |
| `GET /api/fleet/morning?window=&b=`, `GET /api/fleet/archive?q=` | R10 | merged morning / archive |
| push: `GET /api/push/key`, `POST/DELETE /api/push/subscribe`, `POST /api/push/test`, `POST /api/push/quiet` | H11 (existing handlers) | sends only from O9 |
| `WS /ws` | H7 | see 3.4 |
| `WS /ws/term/:builder/:name[?window=]` | H9 | `direct` only; proxied to builder v1 term with a signed `term` envelope |

### 3.4 WebSocket messages

| Message | Direction | Fields / notes | Owner |
|---|---|---|---|
| `hello` | builder `/ws` → browser (first frame) | `{builder:{id,code}, mode, version, apiVersion:1}` | F7 |
| `snapshot`, `delta`, `map`, `event` | builder → browser (`/ws`), builder → hub (`/api/v1/stream`), hub → browser | every frame carries `builder`; v1 adds `seq`, `epoch`; sessions/attention/lanes/events carry `key`/`laneKey` | F7, A7, H7 |
| `health` | builder → hub/browser | `{health}` every 10 s | O6 |
| `approval` | builder → hub/browser | `{op:'open'|'close', approval}` | C4 |
| `stuck` | builder → hub/browser | `{name, key, stuck:{rule, reason, since, evidence, rules}}` | O5 |
| `repos` | builder → hub/browser | `{repo, data}` on change | P9 |
| `alarms` | builder `/ws` → browser (standalone), hub → browser | `{alarms:[Alarm]}`; the hub ignores builder `alarms` frames | O8 |
| `fleet` | hub → browser | `{hub:{version, now}, builders:[BuilderRow], aggregates}`; ≤1/s | H7 |
| `packages` | hub → browser (and standalone builder) | `{data}` debounced 2 s | P11, P9 |
| `visible` | browser → builder/hub; hub → builder | `{keys:[fkey]}` (legacy `names` accepted one release) | F7, H6, H7 |
| `scope` | browser → hub | `{builders:'all'|[ids]}` | H7 |
| `touch` | browser → hub | `{fkey, how:'inspect'|'peek'|'term'}` via `onClientMessage` | O10 |
| `resync` | hub → builder (v1 stream) | `{fromSeq}` → replay or fresh `snapshot` | A7, H6 |
| `ping`/`pong` | both | heartbeat | existing |

### 3.5 Actions

Tiers: `read` (no check), `click` (no dialog), `ask` (UI verb + Cancel), `confirm` (server requires `args.confirm === target`; UI typed `${VERB} ${target}`). Target `*` on a builder requires `args.confirm === fleet.id` (UI types the builder id, or `fleet` for a hub fan-out, which the hub rewrites to each builder's id), except `ack-alarm`. `remoteOnly` actions (refused for `local`; allowed for `direct` through serve or a signed hub request with `control` scope): `approve`, `deny`, `release`, `set-budget`, `kill *`, and `resume` with `override` **or** of a session held by a `budget`/`quota` pause. On the hub every action needs `direct`. These rules close the local-API path only: on-builder guards stay cooperative against an agent with a shell (SECURITY.md, A10). Live tier table: `hello.actions`; client fallback `ACTION_TIERS` (`public/js/core/actions.js`, F8a).

| Action | Tier | Target | Args (strict) | Registered by |
|---|---|---|---|---|
| `send-text` | click | session | `text` 1..8000, `enter`=true, `guardPrompt?`, `fanout?{parent}` | A6 |
| `send-keys` | click | session | `keys` ≤20 × `^[A-Za-z0-9_.^-]{1,16}$` | A6 |
| `interrupt` | click | session or `*` | `confirm?` | A6 |
| `kill` | confirm | session or `*` (`*` not from `local`) | `confirm`; `*`: `graceMs?`, `include?`, `cancel?` | A6 (+ C9 `registerAllHandler`) |
| `restart` | confirm | session | `confirm` | A6 |
| `spawn` | ask | session (new) | `dir` (in `dirRoots`), `prompt?`, `model?`, `permissionMode?`, `resume?`, `slot?` | A6 |
| `launch` | ask | lane | `repo` ∈ repoNames, `plan`, `branch?`, `model?`, `permissionMode?`, `priority?`, `budgetUsd?`, `dryRun?`, `restoredFrom?` | A6 (+ C7, C12, R9 fields) |
| `retire` | confirm | lane | `confirm`, `force?` | A6 |
| `term` | click | session | audit-only (`cols`, `rows`, `window?`) | A7 |
| `pause` | click | session or `*` | `confirm?`, `interrupt?`, `reason?` | C6 |
| `resume` | click | session or `*` | `confirm?`, `nudge?`=true, `override?` | C6 |
| `approve` | click, remoteOnly | session | `approvalId` | C6 |
| `deny` | click, remoteOnly | session | `approvalId`, `note?`, `interrupt?` | C6 |
| `release` | click, remoteOnly | session | `approvalId` | C6 |
| `set-budget` | ask, remoteOnly | lane or `*` | `usd|null`, `window?`, `confirm?` | C7 |
| `ack-alarm` | click | alarm id or `*` | `tile?`, `builder?` | O8 (builder `localOnly`; hub-local on hub) |
| `send-review` | ask | lane | `review:{base, mergeBase, headSha, comments[≤100], note?}` | R7 |
| `run-script` | ask | lane | `script`, `stop?` | R8 |
| `broadcast` | confirm (`confirmCount`) | `*` | `targets` fkey[] ≤30, `text` ≤2000, `enter`, `confirmCount` | C8 (hub-local; builders refuse, `hubOnly`) |

Dispatcher order: shape → registry → **hub control** (`hub` kind and `!fleet.hubControl` → 403 `control-disabled`; `hub` kind without `control` scope → 403 `scope-missing`; `localOnly` from hub → 403; `remoteOnly` from local → 403 `remote-only`) → target → args → tier → rate limit → run → audit (every authenticated outcome).

Audit authority: a builder's log is authoritative only up to the hub's last `audit.anchor` of its head (§3 H13); the hub log is authoritative for hub-relayed actions; a rewritten builder chain raises `audit-fork` (P1).

### 3.6 Config keys (fragment → defaults)

| Fragment (task) | Keys and defaults |
|---|---|
| `server/config/mode.mjs` (X1) | `mode: 'builder'` (`'builder'|'hub'`; `'both'` rejected); env `LANEBOARD_MODE` |
| `server/config/fleet.mjs` (F4) | `fleet.id: sanitizeId(os.hostname())`, `fleet.code: ''` (→ `deriveCode(id)`), `fleet.allowedOrigins: []`; env `LANEBOARD_FLEET_ID`, `LANEBOARD_FLEET_CODE`, `LANEBOARD_ALLOWED_ORIGINS` |
| `server/config/fleet-auth.mjs` (A5) | `fleet.hubKeys: []` (bare string = read only, or `{key, id, scopes}`), `fleet.ingressPort: 7778` if a `fleet` block exists else `null` (mandatory, non-null, with a `fleet` block and in hub mode, ≠ `port`), `fleet.hubAddrs: []`, `fleet.ingressPeerUid: null`, `fleet.allowedUsers: []`, `fleet.publicHosts: [host(publicUrl)]` when not loopback, `fleet.enforce: true` if a `fleet` block exists, `fleet.clockSkewMs: 60000`, `fleet.allowedPermissionModes: ['default','acceptEdits','plan','auto']`, `fleet.rateLimits` (§2 2.7), `fleet.audit.maxBytes: 10485760`, `fleet.hubControl: false`, `fleet.legacyBrowserRoutes: true`; env `LANEBOARD_AUDIT_FILE` |
| `server/config/hub.mjs` (H1) | `fleet.builders: []` (`{id, url (https unless loopback), code?, directUrl?, account?, repos?}`; hub needs ≥1; hub `allowedOrigins` may not contain a builder origin), `fleet.hubKeyFile: paths.hubKeyFile()`, `fleet.staleMs: 15000`, `fleet.downMs: 60000`, `fleet.batchMs: 250`, `fleet.pingMs: 5000`, `fleet.actionTimeoutMs: 15000`, `fleet.maxTermsPerBuilder: 8`, `fleet.placement: {minFreeMemMb: 4096, maxSwapFrac: 0.5}`; env `LANEBOARD_FLEET_BUILDERS` (`id=url,…`) |
| `server/config/packages.mjs` (P2) | `packages: {autodetect: true, mainRef: 'origin/main', branchWindowDays: 14, maxBranches: 40, fetch: 'none', fetchEverySec: 300, cacheDir: ~/.cache/laneboard/git, ciEverySec: 120, staleDays: 7, staleBehind: 50}`, `plans: {globs: ['docs/plans/**/*.md'], statusLine, states}`, `repos[]` validation (`ci`, `packages`, `global`, `ignoreJobs`); core `markers.done` gains `PLAN-DONE` (P8) |
| `server/config/observability.mjs` (O2) | `stuck: {enabled: true, autoPause: false, autoPauseRules: ['tool-loop','error-loop'], approvalWaitMin: 5, errorLoopCount: 3, errorLoopWindowMin: 15, toolLoopCount: 5, oscillationRepeats: 3, stalledMin: 10, stalledToolMin: 30, contextPct: 85, compactMin: 20, costWindowMin: 30, costUsd: 5, idleMin: 20}`, `health: {sampleMs: 10000, historyMin: 60, dockerSocket: '/var/run/docker.sock', dockerRoot: '/var/lib/docker', worktreeDir: null, tailscale: true, thresholds}`, `push.local: null` (auto: true iff `fleet.hubKeys` empty), `notify: {kinds, quietHours: null, quietBypass: ['danger','builder-down']}`, `alarms: {evalMs: 1000, historyDays: 30}` |
| `server/config/control.mjs` (C1) | `stateDir: paths.stateDir()` (env `LANEBOARD_STATE_DIR`), `approvals: {enabled: true, holdSec: 600, onTimeout: 'prompt', previewMaxLines: 300}`, `budget: {window: 'tonight', perLaneUsd: null, perBuilderUsd: null, warnPct: 80, pausePct: 100, quota: {enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false}}` |
| `server/config/review.mjs` (R1) | `review: {overdueHours: 4, base: 'origin/main', inlineMaxChars: 7000, diff: {maxFiles: 300, maxBytes: 2 MiB, maxFileBytes: 256 KiB, maxFileLines: 4000, maxUntracked: 200, timeoutMs: 15000}, generated: [...], postToGitHub: false}`, `transcript: {tailMaxBytes: 1 MiB, maxEntries: 200, textCap: 4000}`, `repos[].base`, `repos[].scripts` (≤12, `^[a-z][a-z0-9-]{0,23}$`) |

With no `fleet` block and `mode` unset, behaviour is exactly today's (DoD 7).

### 3.7 Module ownership (who creates what)

| Area | Modules → task |
|---|---|
| Boot / loader | `server/index.mjs`, `server/boot/*`, `server/modules.mjs`, `server/version.mjs`, `server/config.mjs` fragment loader, state hooks → X1 |
| Fleet core (`server/fleet/`) | `keys.mjs` F3; `canonical.mjs`, `keys-ed25519.mjs`, `paths.mjs` A1; `nonces.mjs`, `ratelimit.mjs` A2; `audit.mjs` A3; `auth.mjs` A4; `dispatch.mjs`, `builtin-actions.mjs` A6; `stream.mjs` A7; `api-v1.mjs` F9→A8; `stuck.mjs` O4; `alarms.mjs`, `alarms-store.mjs` O8 |
| Security | `server/security.mjs` F5 |
| Builder modules (`server/routes/`) | `v1.mjs` F9→A8; `packages.mjs` P9; `health.mjs` O6; `alarms.mjs` O8; `v1-credit.mjs` O11; `approvals.mjs` C4; `control.mjs` C6; `budget.mjs` C7; `killswitch.mjs` C9; `launch-caps.mjs` C12; `review.mjs` R7; `scripts.mjs` R8; `archive.mjs` R9 |
| Flags (`server/flags/`) | `stuck.mjs` O5; `approval.mjs`, `paused.mjs` C5; `review.mjs` R5 |
| Hub (`server/hub/`) | `fleet-store` H3; `aggregates` H4; `upstream` H6; `client-ws` H7; `relay`, `placement` H8; `term-proxy` H9; `read-proxy` H12; `audit-reconcile` H13; `services`, `routes/core.mjs`, `boot/hub.mjs` H11; `packages` + `routes/packages` P11; `routes/alarms` O8; `notify` + `routes/notify` O9; `reviewwait` + `routes/review-waits` O10; `credit` + `routes/credit` O11; `broadcast` + `routes/broadcast` C8; `fleetkill` + `routes/fleetkill` C9; `morning` + `routes/review` R10 |
| Packages (`server/packages/`) | glob P1; repos P2; detect P3; workflow-scan/jobmap/jobs P4; branches/gitenv P6; conflicts/order/stale P7; plans P8; rows P10; `server/collector/packages.mjs` P9 |
| Control (`server/control/`) | pause C2; preview/approvals C3; token C4; handlers C6; budget C7; broadcast C8; killswitch C9 |
| Review (`server/review/`) | diff R2; transcript R4; ready R5 (+ `server/collector/review.mjs`); actions R7; scripts R8; `server/lanes/archive.mjs` R9 |
| Map | `server/map.mjs` F7→M1; `public/js/views/map/*` M2-M5; `public/js/views/map-canvas.js` F1→F6→F8b→M4 (shim); `public/js/views/map.js` F1→F8b→M5 |
| Client core | `store/net/actions/router` F8a (router then D4); `ansi.js` F6; `icons.js` D2; `commands.js` D8; `alarm-tiles.js` D7; `inbox-model.js` C13; `broadcast-plan.js` C8; `review-format.js` R3; `review-queue.js` R6; `hl.js` R11; `transcript-rows.js` R12 |
| Client UI / views | shell/router/registry D4; rail D5; sheet D6b; inspector + actionbar stub D6; tape/annunciator D7; hotkeys/palette D8; board D9; box D11; audit D12; credit D13; notify prefs D14; actionbar/broadcast/killswitch/launch UI C14; inbox C13; packages P12; diff R11; peek R12; review-queue R13; archive R14; morning R15 |
| Tests kit | `test/helpers/{fakedom,boot,fake-builder}.mjs`, `test/boot.test.mjs` X2; `test/e2e-fleet.test.mjs` X3; `test/tools/demo-fleet.mjs` X5 |

## 4. Global task DAG

129 tasks (11 L, 68 M, 50 S): the 107 feature/QA tasks, A11 (ingress peer-uid lookup), 20 independent security-review tasks SR1-SR20 and the security handoff X6 (4.5). Ids: F = §1, A = §2, H = §3, D = §4, M = §5, P = §6, O = §7, C = §8, R = §10, X = §11. Section-local ids (`T4.5`, `6.9`, `T10.7`, `T5`) map to these: `T4.n`→`Dn`, `6.n`→`Pn`, `T10.n`→`Rn`, `T5.n`→`Mn`, §7 `Tn`→`On`; §3 and §8 kept `Hn`/`Cn`. Folded tasks: H2→X1/X2, H5→X2, H10→M1, §7 T7→M1, §4 T4.10→M3/M4, §5 T5.6 dropped, §10 T10.16 not scheduled, T10.17→F6. §9 tasks (K1-K8 in `private/09-homelab-hub-room.md`) run in the homelab repo with one agent and are not part of this DAG.

**Ownership rule (checked mechanically):** every pair of tasks that own the same path (or overlapping globs) is connected by a dependency path, so under DAG dispatch they can never run at the same time; the table in 4.3 lists every shared path with its owner order. A task may create files only inside its owned paths. The generator and checker is the integrator's script (DAG data + checks: unknown deps, cycles, unordered shared files, per-wave collisions); the coordinator should re-run an equivalent check whenever it edits a card.

### 4.1 Tasks (in wave order)

| Id | Title | Sec | Depends on | Files owned | Size | Wave |
|---|---|---|---|---|---|---|
| X1 | Boot split + module loader + config fragments + state hooks | §11 | — | `server/index.mjs`, `server/boot/common.mjs`, `server/boot/builder.mjs`, `server/boot/hub.mjs`, `server/version.mjs`, `server/modules.mjs`, `server/config.mjs`, `server/config/mode.mjs`, `server/state.mjs`, `server/routes/.gitkeep`, `server/flags/.gitkeep`, `server/hub/routes/.gitkeep`, `.gitignore`, `package.json`, `test/modules.test.mjs`, `test/config-fragments.test.mjs`, `test/state.test.mjs` | L | 0.1 |
| F3 | Fleet keys (server + client copy, parity test) | §1 | — | `server/fleet/keys.mjs`, `public/js/core/keys.js`, `test/keys.test.mjs` | S | 0.2 |
| F4 | Fleet identity config fragment (fleet.id/code/allowedOrigins) | §1 | X1, F3 | `server/config/fleet.mjs`, `test/config-fleet.test.mjs`, `docs/fleet/identity.md` | S | 0.3 |
| A1 | canonicalJson + Ed25519 key helpers + XDG paths | §2 | — | `server/fleet/canonical.mjs`, `server/fleet/keys-ed25519.mjs`, `server/fleet/paths.mjs`, `test/canonical.test.mjs`, `test/keys-ed25519.test.mjs` | S | 0.4 |
| F1 | Mechanical JS split into public/js/{core,ui,views} (+http.mjs ext-404, vendor fall-through) | §1 | X1, F3 | `public/js/**`, `public/app.js`, `public/map.js`, `public/terminal.js`, `public/motion.js`, `public/index.html`, `test/render.test.mjs`, `test/frontend.test.mjs`, `test/motion.test.mjs`, `package.json`, `server/http.mjs` | L | 0.5 |
| X2 | Test kit: fakedom, boot helper, fake builder, boot tests | §11 | F1, A1, X1 | `test/helpers/fakedom.mjs`, `test/helpers/boot.mjs`, `test/helpers/fake-builder.mjs`, `test/boot.test.mjs`, `test/render.test.mjs`, `test/fixtures/empty-config.json` | M | 0.6 |
| SR1 | Independent security review of A1: canonical JSON, Ed25519 key helpers, paths (reviewer ≠ author) | §11 | A1 | `~/fleet-night/reviews/SR1.md` (outside the repo) | S | 1 |
| F2 | CSS split into public/css/**, remove legacy aliases | §1 | F1, X2 | `public/css/**`, `public/styles.css`, `public/map.css`, `public/index.html`, `public/js/ui/terminal.js`, `test/frontend.test.mjs`, `test/render.test.mjs` | M | 1 |
| F5 | Security baseline: Host/Origin/CSRF header, CSP, OPTIONS 405 | §1 | F1, F4, X1 | `server/security.mjs`, `server/http.mjs`, `server/boot/common.mjs`, `bin/laneboard`, `deploy/soak.sh`, `public/js/core/net.js`, `public/js/ui/launch.js`, `public/js/ui/render.js`, `test/security.test.mjs` | M | 1 |
| A2 | Nonce cache + rate limiter | §2 | — | `server/fleet/nonces.mjs`, `server/fleet/ratelimit.mjs`, `test/nonces.test.mjs`, `test/ratelimit.test.mjs` | S | 1 |
| A3 | Hash-chained audit log | §2 | A1 | `server/fleet/audit.mjs`, `test/audit.test.mjs` | M | 1 |
| P1 | Glob matcher + pathspec | §6 | — | `server/packages/glob.mjs`, `test/packages-glob.test.mjs` | S | 1 |
| C1 | Control config fragment (stateDir, approvals, budget) | §8 | X1, A1 | `server/config/control.mjs`, `test/config-control.test.mjs` | S | 1 |
| C2 | Pause core + gate.sh | §8 | — | `server/control/pause.mjs`, `deploy/hooks/gate.sh`, `test/pause.test.mjs` | M | 1 |
| D2 | Lucide icon sprite + icons.js | §4 | F1 | `scripts/icons.json`, `scripts/build-sprite.mjs`, `public/vendor/lucide/**`, `public/js/core/icons.js`, `test/icons.test.mjs` | M | 1 |
| SR7 | Independent security review of F5: security baseline (Host/Origin/CSRF/CSP) (reviewer ≠ author) | §11 | F5 | `~/fleet-night/reviews/SR7.md` (outside the repo) | S | 2 |
| SR2 | Independent security review of A3: hash-chained audit log (reviewer ≠ author) | §11 | A3 | `~/fleet-night/reviews/SR2.md` (outside the repo) | S | 2 |
| F6 | Client-side ANSI previews (previewLines), no HTML from data | §1 | F2, X1 | `public/js/core/ansi.js`, `public/js/views/board-card.js`, `public/js/views/map-canvas.js`, `server/state.mjs`, `server/ws.mjs`, `test/fixtures/snapshot.json`, `test/ansi-dom.test.mjs`, `test/frontend-safety.test.mjs`, `test/render.test.mjs` | M | 2 |
| A6 | Action dispatcher, tiers, built-in actions | §2 | A2, A3 | `server/fleet/dispatch.mjs`, `server/fleet/builtin-actions.mjs`, `test/dispatch.test.mjs` | M | 2 |
| D1 | Tokens, base, vendored fonts, guardrail test | §4 | F2 | `public/css/tokens.css`, `public/css/base.css`, `public/vendor/fonts/**`, `test/tokens.test.mjs`, `test/design-guardrails.test.mjs` | M | 2 |
| P2 | Packages config fragment + resolveRepos/parseRemote | §6 | F4 | `server/config/packages.mjs`, `server/packages/repos.mjs`, `test/config-packages.test.mjs` | S | 2 |
| P6 | Branches/touches + scratch git env + mirror | §6 | P1 | `server/packages/branches.mjs`, `server/packages/gitenv.mjs`, `test/conflicts.test.mjs` | M | 2 |
| A4 | auth.mjs: classify, signatures, guardRequest/guardUpgrade | §2 | A1, A2, F5 | `server/fleet/auth.mjs`, `test/auth.test.mjs` | M | 2 |
| H3 | Fleet store (merge, sanitize, skew, subscribe) | §3 | F3 | `server/hub/fleet-store.mjs`, `test/fleet-store.test.mjs` | M | 2 |
| SR3 | Independent security review of A4: auth.mjs classify/verify/guards (+A2 nonce/limiter use) (reviewer ≠ author) | §11 | A4 | `~/fleet-night/reviews/SR3.md` (outside the repo) | S | 3 |
| SR5 | Independent security review of A6: dispatcher: tiers, scopes, remoteOnly, built-ins (reviewer ≠ author) | §11 | A6 | `~/fleet-night/reviews/SR5.md` (outside the repo) | S | 3 |
| SR9 | Independent security review of H3: fleet store sanitization and caps (reviewer ≠ author) | §11 | H3 | `~/fleet-night/reviews/SR9.md` (outside the repo) | S | 3 |
| F7 | Server fleet keys on the wire, push URLs, DB builder column | §1 | F3, F4, F6 | `server/ws.mjs`, `server/state.mjs`, `server/boot/builder.mjs`, `server/push.mjs`, `server/map.mjs`, `server/db.mjs`, `server/collector/markers.mjs`, `test/delta.test.mjs`, `test/db-builder.test.mjs`, `test/map.test.mjs`, `test/push-urls.test.mjs` | M | 3 |
| O1 | New hook events, signals ring, hooks.subscribe | §7 | — | `deploy/hooks.json`, `server/collector/hooks.mjs`, `server/collector/signals.mjs`, `test/hooks.test.mjs`, `test/signals.test.mjs`, `test/fixtures/hooks/**` | M | 3 |
| O2 | Observability config fragment | §7 | X1, F4 | `server/config/observability.mjs`, `test/config-observability.test.mjs` | S | 3 |
| P10 | Package rows (pure) | §6 | — | `server/packages/rows.mjs`, `test/rows.test.mjs` | M | 3 |
| P3 | Package auto-detect | §6 | P1 | `server/packages/detect.mjs`, `test/fixtures/repos/**`, `test/packages-detect.test.mjs` | M | 3 |
| P4 | Workflow scanner + job map + jobVerdict | §6 | P1 | `server/packages/workflow-scan.mjs`, `server/packages/jobmap.mjs`, `server/packages/jobs.mjs`, `test/fixtures/workflows/**`, `test/ci-jobs.test.mjs` | L | 3 |
| F8a | Client store (N builders), sources, act(), router v1 | §1 | F1, F3, F7, F5, SR7 | `public/js/core/store.js`, `public/js/core/net.js`, `public/js/core/actions.js`, `public/js/core/router.js`, `test/store.test.mjs`, `test/router.test.mjs`, `test/actions-client.test.mjs` | M | 4 |
| F9 | API v1 skeleton: hello/snapshot handlers + v1 registry | §1 | X1, F4, F7 | `server/fleet/api-v1.mjs`, `server/routes/v1.mjs`, `test/api-v1.test.mjs` | S | 4 |
| P5 | gh provider: mainRuns, runJobs, rateLimit, failedJobsForCommit, reviews | §6 | — | `server/providers/ci/gh.mjs`, `server/providers/ci/none.mjs`, `test/fixtures/gh/**`, `test/pr.test.mjs`, `test/providers.test.mjs`, `docs/providers.md` | M | 4 |
| P7 | Conflict prediction, merge order, stale branches | §6 | P6 | `server/packages/conflicts.mjs`, `server/packages/order.mjs`, `server/packages/stale.mjs`, `test/conflicts.test.mjs` | M | 4 |
| P8 | Plan status parsing + PLAN-DONE default | §6 | P2, X1 | `server/packages/plans.mjs`, `test/plans.test.mjs`, `server/config.mjs`, `test/markers.test.mjs` | S | 4 |
| R1 | Review config fragment (review.*, transcript, repos[].base/scripts) | §10 | X1 | `server/config/review.mjs`, `test/config-review.test.mjs` | S | 4 |
| C3 | Approval queue core + preview | §8 | — | `server/control/preview.mjs`, `server/control/approvals.mjs`, `test/approvals.test.mjs`, `test/preview.test.mjs` | M | 4 |
| H12 | Signed read proxy (allowlisted /api/v1 reads) | §3 | H3, A4, X2 | `server/hub/read-proxy.mjs`, `test/read-proxy.test.mjs` | S | 4 |
| H7 | Hub /ws to browsers (scope, visible, batching, touch hook) | §3 | H3, F5 | `server/hub/client-ws.mjs`, `test/hub-ws.test.mjs` | M | 4 |
| SR8 | Independent security review of F8a: client store routing keys and act() (reviewer ≠ author) | §11 | F8a | `~/fleet-night/reviews/SR8.md` (outside the repo) | S | 5 |
| C7 | Budget caps, ceilings, quota guard, set-budget | §8 | C1, C2, A6, F9 | `server/control/budget.mjs`, `server/routes/budget.mjs`, `server/lanes/launch.mjs`, `test/budget.test.mjs` | M | 5 |
| D3 | Component kit (lamp, panel, segbar, spark, toast, confirm) | §4 | D1, D2, F8a | `public/css/components.css`, `public/js/ui/components.js`, `public/js/ui/spark.js`, `public/js/ui/toast.js`, `public/js/ui/confirm.js`, `public/dev/kit.html`, `test/components.test.mjs` | M | 5 |
| F8b | UI on fleet keys: dataset.key, builder chips, fold migration | §1 | F8a, F6, F2 | `public/js/views/board.js`, `public/js/views/board-card.js`, `public/js/views/map.js`, `public/js/views/map-canvas.js`, `public/js/views/morning.js`, `public/js/ui/shell.js`, `public/js/ui/rail.js`, `public/js/ui/dock.js`, `public/js/ui/sheet.js`, `public/js/ui/hotkeys.js`, `public/js/ui/render.js`, `public/index.html`, `test/render.test.mjs`, `test/render-fleet.test.mjs` | L | 5 |
| M2 | Pure map client modules (model, layout, overlays) | §5 | F1 | `public/js/views/map/model.js`, `public/js/views/map/layout.js`, `public/js/views/map/overlays.js`, `test/map-layout.test.mjs`, `test/map-overlays.test.mjs`, `test/map-model.test.mjs` | M | 5 |
| O4 | Stuck detector rules + tracker (pure) | §7 | O1, O2 | `server/fleet/stuck.mjs`, `test/stuck.test.mjs` | M | 5 |
| O6 | Builder health collector + /api/v1/health | §7 | O2, X1, F9 | `server/collector/health.mjs`, `server/routes/health.mjs`, `test/health.test.mjs`, `test/fixtures/proc/**` | M | 5 |
| P9 | Packages collector, snapshot key, ci_jobs table, pr.mjs job blame | §6 | P2, P3, P4, P5, P6, P7, P8, P10, X1, F7, F9 | `server/collector/packages.mjs`, `server/routes/packages.mjs`, `server/db.mjs`, `server/collector/pr.mjs`, `test/packages-collector.test.mjs`, `test/pr.test.mjs` | L | 5 |
| R2 | Builder lane diff | §10 | R1 | `server/review/diff.mjs`, `test/diff.test.mjs` | L | 5 |
| SR17 | Independent security review of C7: budget, set-budget, budget-resume predicate (reviewer ≠ author) | §11 | C7 | `~/fleet-night/reviews/SR17.md` (outside the repo) | S | 6 |
| C12 | Launch dryRun + hello fields (repos, permissionModes) | §8 | C7, F9, A6 | `server/lanes/launch.mjs`, `server/routes/launch-caps.mjs`, `test/launch-dryrun.test.mjs` | S | 6 |
| D4 | Shell, router, view registry + stubs, static checks | §4 | D3, F8b, F8a, D1, F2 | `public/index.html`, `public/css/shell.css`, `public/js/ui/shell.js`, `public/js/core/router.js`, `public/js/views/index.js`, `public/js/views/inbox.js`, `public/js/views/packages.js`, `public/js/views/audit.js`, `public/js/views/diff.js`, `public/js/app.js`, `test/router.test.mjs`, `test/frontend.test.mjs`, `test/frontend-static.test.mjs` | L | 6 |
| R3 | Review message format + pull commands (pure) | §10 | F1 | `public/js/core/review-format.js`, `test/review-format.test.mjs` | S | 6 |
| R4 | Transcript tail by offset | §10 | R1 | `server/review/transcript.mjs`, `test/transcript.test.mjs`, `test/fixtures/transcript/**` | M | 6 |
| R5 | reviewReady rule + review collector + lane flag | §10 | R1, X1 | `server/review/ready.mjs`, `server/collector/review.mjs`, `server/flags/review.mjs`, `test/review-ready.test.mjs` | M | 6 |
| A11 | Ingress peer-uid lookup (/proc/net/tcp parser, opt-in `fleet.ingressPeerUid`) | §2 | — | `server/fleet/peercred.mjs`, `test/peercred.test.mjs`, `test/fixtures/proc-net/**` | S | 6 |
| A5 | Fleet auth config fragment (hubKeys, ingressPort, hubControl, ...) | §2 | F4, A1 | `server/config/fleet-auth.mjs`, `test/config-fleet-auth.test.mjs` | S | 6 |
| A7 | v1 stream (seq/epoch/resync ring), ws tap, terminals.attachNamed | §2 | F7, F9 | `server/fleet/stream.mjs`, `server/ws.mjs`, `server/terminals.mjs`, `test/stream.test.mjs` | M | 6 |
| SR4 | Independent security review of A5: fleet-auth config: hubKeys scopes, ingressPort, optional keys (reviewer ≠ author) | §11 | A5 | `~/fleet-night/reviews/SR4.md` (outside the repo) | S | 7 |
| C4 | Hook intake POST /api/hook/permission, token, GET /api/v1/approvals | §8 | C3, C1, O1, F5, F9 | `server/routes/approvals.mjs`, `server/control/token.mjs`, `test/approvals-route.test.mjs` | M | 7 |
| D6b | Phone shell: chip strip, 3-snap sheet, L4 host | §4 | D4, F8b | `public/js/ui/sheet.js`, `public/css/phone.css`, `test/sheet.test.mjs` | M | 7 |
| H1 | Hub config fragment (fleet.builders, timings, placement) | §3 | F4, A1 | `server/config/hub.mjs`, `test/config-hub.test.mjs` | S | 7 |
| H13 | Audit reconciliation (hub vs builder audit) | §3 | A3, H12 | `server/hub/audit-reconcile.mjs`, `test/audit-reconcile.test.mjs` | S | 7 |
| H4 | Fleet aggregates (attention, rateLimit, cost, ci, counts) | §3 | H3 | `server/hub/aggregates.mjs`, `test/hub-aggregates.test.mjs` | M | 7 |
| H6 | Upstream client per builder | §3 | H3, A4, X2 | `server/hub/upstream.mjs`, `test/hub-upstream.test.mjs` | M | 7 |
| H8 | Relay (+hub-local actions registry) + placement (+vitals.cpus) | §3 | H3, A3, A4, X2 | `server/hub/relay.mjs`, `server/hub/placement.mjs`, `server/collector/vitals.mjs`, `test/relay.test.mjs`, `test/placement.test.mjs` | M | 7 |
| H9 | Terminal proxy /ws/term/:builder/:name | §3 | H3, A3, A4, X2 | `server/hub/term-proxy.mjs`, `test/term-proxy.test.mjs` | M | 7 |
| SR10 | Independent security review of H6: upstream client bounds and signing (reviewer ≠ author) | §11 | H6 | `~/fleet-night/reviews/SR10.md` (outside the repo) | S | 8 |
| SR11 | Independent security review of H8: relay, hub-local actions, placement (reviewer ≠ author) | §11 | H8 | `~/fleet-night/reviews/SR11.md` (outside the repo) | S | 8 |
| SR12 | Independent security review of H9: terminal proxy and term envelopes (reviewer ≠ author) | §11 | H9 | `~/fleet-night/reviews/SR12.md` (outside the repo) | S | 8 |
| SR14 | Independent security review of H13: read proxy allowlist + audit reconciliation/anchoring (reviewer ≠ author) | §11 | H13 | `~/fleet-night/reviews/SR14.md` (outside the repo) | S | 8 |
| SR15 | Independent security review of C4: permission hook intake and token (reviewer ≠ author) | §11 | C4 | `~/fleet-night/reviews/SR15.md` (outside the repo) | S | 8 |
| M1 | Fleet map model on the server (buildFleet, builder nodes, edges) | §5 | F7, H3 | `server/map.mjs`, `test/map.test.mjs`, `test/fixtures/fleet-map.json`, `docs/fleet/map.md` | L | 8 |
| M3 | Map renderer + industrial restyle | §5 | M2, D1, F2 | `public/js/views/map/render.js`, `public/css/views/map.css`, `test/map-render.test.mjs` | M | 8 |
| O10 | Review-wait metric on the hub | §7 | R5, H3, H7, P5 | `server/hub/reviewwait.mjs`, `server/hub/routes/review-waits.mjs`, `test/reviewwait.test.mjs` | M | 8 |
| O8 | Alarms: derive/reconcile/ack, store, builder + hub modules | §7 | O4, O6, H3, A6, X1 | `server/fleet/alarms.mjs`, `server/fleet/alarms-store.mjs`, `server/routes/alarms.mjs`, `server/hub/routes/alarms.mjs`, `test/alarms.test.mjs` | M | 8 |
| R7 | Review routes (diff/transcript/preview/morning) + send-review | §10 | R2, R3, R4, A6, F9 | `server/routes/review.mjs`, `server/review/actions.mjs`, `server/morning.mjs`, `test/review-routes.test.mjs` | M | 9 |
| R9 | Lane archive table, capture/commit, restore plumbing | §10 | F7, P9, C12, C7 | `server/db.mjs`, `server/lanes/archive.mjs`, `server/lanes/retire.mjs`, `server/lanes/launch.mjs`, `server/routes/archive.mjs`, `test/archive.test.mjs` | L | 9 |
| A8 | v1 wiring: routes, classification in http, ingress listener, legacy adapters (+ peer-uid wiring) | §2 | A4, A5, A6, A7, F9, F5, F7, A11, SR7 | `server/fleet/api-v1.mjs`, `server/routes/v1.mjs`, `server/http.mjs`, `server/boot/common.mjs`, `server/boot/builder.mjs`, `test/api-v1.test.mjs`, `test/api-v1-auth.test.mjs` | L | 9 |
| A9 | CLI: fleet keygen/pubkey, audit [verify] | §2 | A1, A3, F5 | `bin/laneboard`, `test/cli-fleet.test.mjs` | S | 9 |
| C10 | Hook installer rewrite (merge, uninstall, template) | §8 | O1, C2, C4 | `deploy/install-claude.sh`, `deploy/hooks.json.tmpl`, `deploy/hooks.json`, `test/installer.test.mjs` | M | 9 |
| C6 | Handlers pause/resume/approve/deny/release | §8 | C2, C3, C1, A6, F9 | `server/control/handlers.mjs`, `server/routes/control.mjs`, `test/handlers.test.mjs` | M | 9 |
| C8 | Broadcast planner + hub broadcast action | §8 | H8, A6 | `server/control/broadcast.mjs`, `server/hub/broadcast.mjs`, `server/hub/routes/broadcast.mjs`, `public/js/core/broadcast-plan.js`, `test/broadcast.test.mjs` | M | 9 |
| C9 | Kill switches (builder kill *, fleet kill with undo) | §8 | C2, A6, H8 | `server/control/killswitch.mjs`, `server/hub/fleetkill.mjs`, `server/hub/routes/fleetkill.mjs`, `server/routes/killswitch.mjs`, `test/killswitch.test.mjs` | M | 9 |
| D6 | Inspector (L3), tab registry, action bar slot | §4 | D4, D6b | `public/js/ui/inspector.js`, `public/js/ui/actionbar.js`, `public/css/inspector.css`, `test/inspector.test.mjs` | M | 9 |
| SR16 | Independent security review of C6: pause/resume/approve/deny/release handlers (reviewer ≠ author) | §11 | C6 | `~/fleet-night/reviews/SR16.md` (outside the repo) | S | 10 |
| SR18 | Independent security review of C8: broadcast planner and hub broadcast (reviewer ≠ author) | §11 | C8 | `~/fleet-night/reviews/SR18.md` (outside the repo) | S | 10 |
| SR19 | Independent security review of C9: kill switches and fleet kill (reviewer ≠ author) | §11 | C9 | `~/fleet-night/reviews/SR19.md` (outside the repo) | S | 10 |
| SR6 | Independent security review of A8: v1 wiring, ingress listener, peer-uid wiring, legacy adapters (reviewer ≠ author) | §11 | A8 | `~/fleet-night/reviews/SR6.md` (outside the repo) | S | 10 |
| D8 | Command registry, hotkeys, palette, fuzzy | §4 | D4, F8b | `public/js/core/commands.js`, `public/js/ui/hotkeys.js`, `public/js/ui/palette.js`, `public/js/ui/fuzzy.js`, `public/css/palette.css`, `test/hotkeys.test.mjs`, `test/fuzzy.test.mjs` | M | 10 |
| H11 | Hub wiring: routes, auth, services hook, map loop, shutdown | §3 | H1, H4, H6, H7, H8, H9, H12, H13, M1, A3, F5, X1, X2 | `server/boot/hub.mjs`, `server/hub/routes/core.mjs`, `server/hub/services.mjs`, `test/hub-boot.test.mjs`, `docs/fleet/hub.md` | L | 10 |
| M4 | Map interaction + index (scope, overlays, hit grid, hooks) | §5 | M3, F8b | `public/js/views/map/interact.js`, `public/js/views/map/index.js`, `public/js/views/map-canvas.js`, `test/map-interact.test.mjs` | M | 10 |
| O3 | Session fields (effort, thinking, promptCache, apiMs, head) + push.local guard | §7 | O1, O2, F7, X1 | `server/state.mjs`, `server/push.mjs`, `test/state.test.mjs` | M | 10 |
| P11 | Hub packages merge + /api/packages + packages message | §6 | P10, H3, X1 | `server/hub/packages.mjs`, `server/hub/routes/packages.mjs`, `test/hub-packages.test.mjs` | M | 10 |
| X3 | End-to-end fleet test (2 fake builders + booted hub) | §11 | H11, A8, X2 | `test/e2e-fleet.test.mjs` | M | 11 |
| SR13 | Independent security review of H11: hub wiring, hub route auth, web baseline (reviewer ≠ author) | §11 | H11 | `~/fleet-night/reviews/SR13.md` (outside the repo) | S | 11 |
| R10 | Hub morning merge + /api/fleet/morning + /api/fleet/archive | §10 | H12, R7, R9, O8, O10 | `server/hub/morning.mjs`, `server/hub/routes/review.mjs`, `test/hub-morning.test.mjs` | M | 11 |
| R6 | Review queue (pure) | §10 | F1 | `public/js/core/review-queue.js`, `test/review-queue.test.mjs` | S | 11 |
| R8 | Run scripts + terminal window param + tmux mainPane fix | §10 | A7, A6, R1, F9 | `server/review/scripts.mjs`, `server/terminals.mjs`, `server/collector/tmux.mjs`, `server/routes/scripts.mjs`, `test/scripts.test.mjs` | M | 11 |
| A10 | SECURITY.md, install docs (ingress port, hubKeys) | §2 | A8 | `SECURITY.md`, `docs/install.md`, `docs/fleet/auth.md` | S | 11 |
| C11 | CLI pause/resume/paused | §8 | C2, A9 | `bin/laneboard`, `test/cli-pause.test.mjs` | S | 11 |
| C13 | Inbox model + view | §8 | D4, D3, D8, F8a | `public/js/core/inbox-model.js`, `public/js/views/inbox.js`, `test/inbox-model.test.mjs` | M | 11 |
| C14 | Action bar, broadcast dialog, kill dialog, launch form | §8 | D6, D3, C8, F5 | `public/js/ui/actionbar.js`, `public/js/ui/broadcast.js`, `public/js/ui/killswitch.js`, `public/js/ui/launch.js`, `test/actionbar.test.mjs` | M | 11 |
| SR20 | Independent security review of R7, R8, O8: send-review, run-script/terminal window, ack-alarm registrations (reviewer ≠ author) | §11 | R7, R8, O8 | `~/fleet-night/reviews/SR20.md` (outside the repo) | S | 12 |
| C15 | Control docs + runbook | §8 | C6, C9, C10 | `docs/fleet/control.md` | S | 12 |
| C5 | Flags paused/awaitingApproval + snapshot approvals | §8 | C2, C3, C1, X1 | `server/flags/approval.mjs`, `server/flags/paused.mjs`, `test/flags-control.test.mjs` | S | 12 |
| D11 | Box view: builders, health, skew, direct links | §4 | D4, D3 | `public/js/views/box.js`, `public/css/views/box.css`, `test/view-box.test.mjs` | M | 12 |
| D12 | Audit view (hub log + mismatches) | §4 | D4, D3 | `public/js/views/audit.js`, `public/css/views/audit.css`, `test/view-audit.test.mjs` | M | 12 |
| D13 | Credit view fleet-wide | §4 | D4, D3 | `public/js/views/credit.js`, `test/view-credit.test.mjs` | S | 12 |
| D14 | Notification prefs sheet | §4 | D4, D3 | `public/js/ui/notify-prefs.js`, `test/notify-prefs.test.mjs` | S | 12 |
| D5 | Builder rail | §4 | D4, F8b | `public/js/ui/rail.js`, `public/css/rail.css`, `test/rail.test.mjs` | M | 12 |
| D7 | Event tape + annunciator (+alarm tile map) | §4 | D4 | `public/js/ui/tape.js`, `public/js/ui/annunciator.js`, `public/js/core/alarm-tiles.js`, `public/css/tape.css`, `public/css/annunciator.css`, `test/annunciator.test.mjs` | M | 12 |
| D9 | Board redesign (ATC data block) | §4 | D4, D3, F8b | `public/js/views/board.js`, `public/js/views/board-card.js`, `public/css/board.css`, `test/board.test.mjs`, `test/frontend.test.mjs` | M | 13 |
| M5 | Map view integration: split, minimap, inline actions | §5 | M4, D4, D6, D6b, F8a, F8b | `public/js/views/map.js`, `public/js/views/map/split.js`, `public/js/views/map/minimap.js`, `test/map-view.test.mjs` | M | 13 |
| O11 | Credit fan-out: /api/v1/credit + mergeCredit + /api/fleet/credit | §7 | H12, F9, X1 | `server/routes/v1-credit.mjs`, `server/hub/credit.mjs`, `server/hub/routes/credit.mjs`, `server/credit.mjs`, `test/fleetviews-credit.test.mjs` | M | 13 |
| O5 | Stuck flag module (decorator, tick, stuck messages) | §7 | O3, O4, X1 | `server/flags/stuck.mjs`, `test/flags-stuck.test.mjs` | S | 13 |
| O9 | Hub notifications (rules, quiet hours, digest, prefs) | §7 | O8 | `server/hub/notify.mjs`, `server/hub/routes/notify.mjs`, `test/notify.test.mjs` | M | 13 |
| P12 | Packages view | §6 | P10, D4, D3 | `public/js/views/packages.js`, `public/js/views/packages-model.js`, `public/css/views/packages.css`, `test/packages-view.test.mjs` | M | 13 |
| P13 | Packages docs fragment | §6 | P9, P11 | `docs/fleet/packages.md` | S | 13 |
| R11 | Diff view + highlighter | §10 | D4, R3 | `public/js/views/diff.js`, `public/js/core/hl.js`, `public/css/views/diff.css`, `test/hl.test.mjs` | M | 13 |
| R12 | Peek inspector tab + transcript rows | §10 | D6, R4 | `public/js/views/peek.js`, `public/js/core/transcript-rows.js`, `test/transcript-rows.test.mjs` | M | 13 |
| R13 | Review queue renderer (inbox group) | §10 | R6, D3 | `public/js/views/review-queue.js`, `test/view-review-queue.test.mjs` | S | 14 |
| R14 | Archive view + restore sheet | §10 | D4, R9 | `public/js/views/archive.js`, `test/view-archive.test.mjs` | M | 14 |
| R15 | Morning view fleet blocks | §10 | R10, D4, F8b | `public/js/views/morning.js`, `test/view-morning.test.mjs` | M | 14 |
| X6 | Security handoff packet: REVIEW-REQUIRED checklist + diff, SR status | §11 | SR1, SR2, SR3, SR4, SR5, SR6, SR7, SR8, SR9, SR10, SR11, SR12, SR13, SR14, SR15, SR16, SR17, SR18, SR19, SR20, X3 | `~/fleet-night/security/**` (outside the repo) | S | 14 |
| X4 | Docs integration (docs/fleet.md, config table, README, CHANGELOG) | §11 | all feature tasks + X3 | `docs/fleet.md`, `docs/config.md`, `README.md`, `docs/map.md`, `CHANGELOG.md`, `scripts/check-config-docs.mjs` | M | 15 |
| X5 | Final QA: demo fleet preview, PR body, DoD check | §11 | X3, X4, X6 | `test/tools/demo-fleet.mjs` | M | 16 |

### 4.2 Waves (max 9 concurrent)

Wave 0 is sequential (one agent, in this order). Waves 1-16 are computed by list scheduling over the DAG (a task enters the first wave after all its deps' waves; inside a wave, higher "height" = longer chain of dependents goes first; e2e X3 is boosted, then the SR review tasks, so a review runs as soon as the reviewed task is merged and its findings can be fixed before dependents build on it). The coordinator still dispatches **by DAG, not by wave barrier**: any task whose deps are merged may start when a slot frees (§11 §3). The waves are the expected shape, and the collision check below shows that even as barriers they are safe.

| Wave | Tasks (≤9) | Size mix |
|---|---|---|
| 0 (sequential) | X1 → F3 → F4 → A1 → F1 → X2 | L S S S L M |
| 1 | SR1, F2, F5, A2, A3, P1, C1, C2, D2 | S M M S M S S M M |
| 2 | SR7, SR2, F6, A6, D1, P2, P6, A4, H3 | S S M M M S M M M |
| 3 | SR3, SR5, SR9, F7, O1, O2, P10, P3, P4 | S S S M M S M M L |
| 4 | F8a, F9, P5, P7, P8, R1, C3, H12, H7 | M S M M S S M S M |
| 5 | SR8, C7, D3, F8b, M2, O4, O6, P9, R2 | S M M L M M M L L |
| 6 | SR17, C12, D4, R3, R4, R5, A11, A5, A7 | S S L S M M S S M |
| 7 | SR4, C4, D6b, H1, H13, H4, H6, H8, H9 | S M M S S M M M M |
| 8 | SR10, SR11, SR12, SR14, SR15, M1, M3, O10, O8 | S S S S S L M M M |
| 9 | R7, R9, A8, A9, C10, C6, C8, C9, D6 | M L L S M M M M M |
| 10 | SR16, SR18, SR19, SR6, D8, H11, M4, O3, P11 | S S S S M L M M M |
| 11 | X3, SR13, R10, R6, R8, A10, C11, C13, C14 | M S M S M S S M M |
| 12 | SR20, C15, C5, D11, D12, D13, D14, D5, D7 | S S S M M S S M M |
| 13 | D9, M5, O11, O5, O9, P12, P13, R11, R12 | M M M S M M S M M |
| 14 | R13, R14, R15, X6 | S M M S |
| 15 | X4 | M |
| 16 | X5 | M |

**File-collision check (per wave):** no two tasks in the same wave own the same path or overlapping globs.

| Wave | Tasks | Owned paths | Same-file pairs inside the wave |
|---|---|---|---|
| 1 | 9 | 35 | none |
| 2 | 9 | 29 | none |
| 3 | 9 | 32 | none |
| 4 | 9 | 34 | none |
| 5 | 9 | 46 | none |
| 6 | 9 | 35 | none |
| 7 | 9 | 22 | none |
| 8 | 9 | 20 | none |
| 9 | 9 | 40 | none |
| 10 | 9 | 26 | none |
| 11 | 9 | 25 | none |
| 12 | 9 | 24 | none |
| 13 | 9 | 31 | none |
| 14 | 4 | 7 | none |
| 15 | 1 | 6 | none |
| 16 | 1 | 1 | none |

### 4.3 Shared paths and their owner order

Paths owned by more than one task (glob owners F1 `public/js/**` and F2 `public/css/**` omitted: every later frontend task depends on F1 and F2). Each arrow is a dependency path in the DAG.

| Path | Owners (all ordered by a dependency path) |
|---|---|
| `bin/laneboard` | F5 → A9 → C11 |
| `deploy/hooks.json` | O1 → C10 |
| `package.json` | X1 → F1 |
| `public/index.html` | F1 → F2 → F8b → D4 |
| `public/js/core/keys.js` | F3 → F1 |
| `public/js/core/net.js` | F5 → F8a |
| `public/js/core/router.js` | F8a → D4 |
| `public/js/ui/actionbar.js` | D6 → C14 |
| `public/js/ui/hotkeys.js` | F8b → D8 |
| `public/js/ui/launch.js` | F5 → C14 |
| `public/js/ui/rail.js` | F8b → D5 |
| `public/js/ui/render.js` | F5 → F8b |
| `public/js/ui/sheet.js` | F8b → D6b |
| `public/js/ui/shell.js` | F8b → D4 |
| `public/js/views/audit.js` | D4 → D12 |
| `public/js/views/board-card.js` | F6 → F8b → D9 |
| `public/js/views/board.js` | F8b → D9 |
| `public/js/views/diff.js` | D4 → R11 |
| `public/js/views/inbox.js` | D4 → C13 |
| `public/js/views/map-canvas.js` | F6 → F8b → M4 |
| `public/js/views/map.js` | F8b → M5 |
| `public/js/views/morning.js` | F8b → R15 |
| `public/js/views/packages.js` | D4 → P12 |
| `server/boot/builder.mjs` | X1 → F7 → A8 |
| `server/boot/common.mjs` | X1 → F5 → A8 |
| `server/boot/hub.mjs` | X1 → H11 |
| `server/config.mjs` | X1 → P8 |
| `server/db.mjs` | F7 → P9 → R9 |
| `server/fleet/api-v1.mjs` | F9 → A8 |
| `server/http.mjs` | F1 → F5 → A8 |
| `server/lanes/launch.mjs` | C7 → C12 → R9 |
| `server/map.mjs` | F7 → M1 |
| `server/push.mjs` | F7 → O3 |
| `server/routes/v1.mjs` | F9 → A8 |
| `server/state.mjs` | X1 → F6 → F7 → O3 |
| `server/terminals.mjs` | A7 → R8 |
| `server/ws.mjs` | F6 → F7 → A7 |
| `test/api-v1.test.mjs` | F9 → A8 |
| `test/conflicts.test.mjs` | P6 → P7 |
| `test/frontend.test.mjs` | F1 → F2 → D4 → D9 |
| `test/map.test.mjs` | F7 → M1 |
| `test/pr.test.mjs` | P5 → P9 |
| `test/render.test.mjs` | F1 → X2 → F2 → F6 → F8b |
| `test/router.test.mjs` | F8a → D4 |
| `test/state.test.mjs` | X1 → O3 |

### 4.4 Critical path and priority if the night runs short

- Longest chain to the e2e test (DoD 4): `X1 → F1 → X2 → F2 → F6 → F7 → F9 → A7 → A8 → X3` (10 tasks; plus F3, F4, A1 in wave 0). Longest overall: `X1 → F1 → X2 → F2 → F6 → F7 → F8a → D3 → D4 → D6b → D6 → M5 → X4 → X5` (14).
- **Tier A (the hub works end to end, DoD 1-5, 7):** X1, X2, X3, F1-F7, F9, A1-A8, A11, H1, H3, H4, H6-H9, H11-H13, M1, plus their reviews SR1-SR7, SR9-SR14 and the handoff X6 (45 tasks). An SR task always belongs to the tier of the task it reviews; X6 runs before X5 with whatever SR reports exist (a missing report is listed in the packet as "not reviewed").
- **Tier B (the visible fleet UI and the core signals):** F8a, F8b, D1-D4, D6, D6b, D7, D8, D9, D11, M2-M5, O1-O6, O8, C1-C6, C13, P1-P12, plus SR8, SR15, SR16 (45).
- **Tier C (everything else):** A9, A10, C7-C12, C14, C15, D5, D12-D14, O9-O11, P13, R1-R15, plus SR17-SR20 (37).
- X4 (docs) and X5 (QA/preview) always run last with whatever has merged.
- Rule for the coordinator: when quota or time is short, stop dispatching tier C first, then tier B; never start a task whose tier is lower than an undispatched task with a shorter remaining path to X3.

### 4.5 REVIEW-REQUIRED files, independent review tasks, pinned hub deploy (security review S1)

Agents running on a builder (the least trusted machine) write the code that the hub (the machine holding the key that can type into every builder) will run. Three controls keep one prompt-injected agent from planting a trigger there:

1. **REVIEW-REQUIRED files.** Any change to these paths gets an independent review during the night and a line-by-line human review before the hub runs it:
   - fleet auth and audit core: `server/fleet/auth.mjs`, `server/fleet/dispatch.mjs`, `server/fleet/builtin-actions.mjs`, `server/fleet/audit.mjs`, `server/fleet/canonical.mjs`, `server/fleet/keys-ed25519.mjs`, `server/fleet/nonces.mjs`, `server/fleet/peercred.mjs`, `server/config/fleet-auth.mjs`, `server/security.mjs`;
   - v1 wiring and every registration of a v1 action: `server/fleet/api-v1.mjs`, `server/routes/v1.mjs`, the classification/ingress parts of `server/http.mjs` and `server/boot/common.mjs`, and every module that calls `registerAction`/`registerAllHandler`/`registerHubAction` (`server/routes/{approvals,control,budget,killswitch,scripts,review,alarms}.mjs`, `server/control/{handlers,budget,killswitch,broadcast,token}.mjs`, `server/review/{actions,scripts}.mjs`, `server/hub/routes/{alarms,broadcast,fleetkill}.mjs`);
   - hub: `server/hub/relay.mjs`, `server/hub/term-proxy.mjs`, `server/hub/upstream.mjs`, `server/hub/fleet-store.mjs`, `server/hub/read-proxy.mjs`, `server/hub/audit-reconcile.mjs`, `server/hub/broadcast.mjs`, `server/hub/fleetkill.mjs`, `server/hub/routes/core.mjs`, `server/boot/hub.mjs`;
   - client routing: `public/js/core/{store,net,actions,keys}.js`; deploy: `deploy/**`.
   A task card that owns one of these paths says `REVIEW-REQUIRED` in its done-when; the coordinator's `ownership-check` lists the REVIEW-REQUIRED paths a merge touches in the merge commit body (`Review-Required: <paths>` trailer).
2. **Independent review tasks SR1-SR20.** Each runs right after the task it reviews is merged (table 4.1). Rules (§11 "Security review tasks"): the reviewer is a fresh agent session that is **not the author** of the reviewed task (nor of any other task owning the same files); it reads the reviewed merge's diff of REVIEW-REQUIRED paths against this plan, `SECURITY-FIXES.md` and the threat model (§2 2.11), and writes `~/fleet-night/reviews/<SRn>.md` with findings by severity; it owns **no repo path** and never pushes code. A finding of Medium or worse opens a fix task `<id>-fix` for a different fresh agent (never the reviewer) on the reviewed task's owned files, followed by a re-review of the fix diff by the same reviewer; tasks that depend on the SR (A8 and F8a depend on SR7) then wait for the fix as well. If the fix cannot be ordered before a later owner of the same file, it is folded into that owner's card as an extra done-when item, and otherwise recorded as a known gap. Only one SR task adds a dependency inside the feature DAG: SR7 (F5's `security.mjs`, `http.mjs`, `boot/common.mjs`, `net.js` have later owners A8 and F8a).
3. **Handoff and pinned deploy.** X6 (after all SR tasks and X3) writes `~/fleet-night/security/`: `CHECKLIST.md` (per REVIEW-REQUIRED file: what to verify, the `SECURITY-FIXES.md` ids it implements, the SR report and its open findings), `critical.diff` (`git diff main...fleet/main -- <REVIEW-REQUIRED paths>`) and `critical-files.txt`; X5 links it from `PR.md` and from MORNING.md's HUMAN steps, and proposes splitting those paths into their own PR. The hub never runs a branch head: it runs a detached checkout of a tag or SHA that the human sets after that review (homelab runbook, private), installed with `npm ci --ignore-scripts`.

## 5. Definition of done for the night (§11 §8)

All must hold on the final `fleet/main` (anything missed is a "known gap" with its task id in `~/fleet-night/MORNING.md`, never hidden):

1. `npm test` passes with 0 failures; test count ≥ 424 + new tests; no existing test name disappears without a replacement (spec-reporter name diff, baseline → final).
2. `node --test test/hygiene.test.mjs` passes on its own.
3. `~/fleet-night/bin/smoke` passes (temp dir, `TMUX_TMPDIR`, `LANEBOARD_DB=:memory:`, port ≥ 7790): builder with no config (`/healthz` ok, `/api/v1/hello` → `apiVersion:1, mode:"builder"`), builder with the host's current config (same + `/api/state` 200; the config still validates unchanged).
4. `test/e2e-fleet.test.mjs` (X3) passes: two fake builders + a booted hub; hub `/ws` snapshot holds both builders under fleet keys; a builder-b delta reaches the client; a hub `send-text` posted through the hub's ingress listener (serve-like `X-Forwarded-*` + `Tailscale-User-Login`) arrives at builder-a with a valid signature (the fake pins the hub key as `{key, id, scopes:['read','control','term']}` and has `hubControl:true`); the same POST on the hub's local listener → 403 `remote-only`; closing builder-b → `stale` then `down` (300/900 ms); builder text `<img onerror>` reaches the client as an escaped string.
5. `git diff main...fleet/main -- package.json package-lock.json` shows no dependency change (X1/F1 may only edit the `test` script and `NODE_OPTIONS`).
6. Docs: `docs/fleet.md`, the README views table, `docs/config.md` rows for every fragment key (X4's `scripts/check-config-docs.mjs`), `docs/map.md` (hub ingest), CHANGELOG `Unreleased`.
7. Builder mode with no fleet config behaves as today: existing render/frontend tests pass; `/api/state` keeps its shape apart from added fields.
8. Security: every merged REVIEW-REQUIRED task has its SR report in `~/fleet-night/reviews/`; no SR finding of High or Critical is open (an open one is a known gap at the top of MORNING.md and blocks the hub deploy); X6's packet exists.

## 6. HUMAN checklist (consolidated, deduplicated)

### Before the night
- [ ] Unattended agent permissions: worktree-local `.claude/settings.local.json` (excluded, not committed) allowing `git`, `npm test`, `node --test`, `flock`, `curl` to `127.0.0.1` test ports ≥ 7790 only (never 7777/7778), edits inside the worktree (§11, security review S15).
- [ ] `jq` installed on the build host (the existing `test/statusline.test.mjs` fails without it; VERIFIED-FACTS 8), or accept that one baseline failure is pre-existing and record it.
- [ ] Decide night pushes: set quiet hours (`POST /api/push/quiet`) or accept `NEED-HUMAN` pushes (§11).
- [ ] `QA_SCREENSHOTS=1` in `~/fleet-night/env` or not (§11).
- [ ] Authenticate `gh` on the build host if the PR should be opened automatically (§11).
- [ ] Network for vendored assets, or drop them in `~/fleet-night/vendor/` beforehand: JetBrains Mono v2.304 webfonts, Barlow Condensed woff2 (both OFL), a pinned `lucide-static` tarball (ISC) (§4 D1, D2). Without them D1/D2 block with `NEED-HUMAN` and the UI falls back to system fonts.
- [ ] Accept or veto the integrator's contract decisions that go beyond the coordinator's list (the items marked **(I)** in INTEGRATION-REPORT.md §1): new `release` action, `ack-alarm` target shape, 8-tile annunciator mapping, kv instead of new tables, D11-D14 added, hub loads modules only from H11.

### Morning
- [ ] Open the PR from `~/fleet-night/PR.md` (compare URL in MORNING.md) if it was not opened; review the `NEED-HUMAN` list and any dep requests (§11).
- [ ] Open the preview (`node test/tools/demo-fleet.mjs --port 7790`, via `ssh -L 7790:127.0.0.1:7790`) (§11).
- [ ] Taste review: `public/dev/kit.html` and the Map in dark and light, 1x/2x DPR, on the ultrawide and a phone; label legibility at 10-11 px; p1-vs-accent hue separation; 1 Hz flash fatigue (§4, §5).
- [ ] Builder UI regression pass: board, open a sheet, pin, map, switch views on phone and desktop; CSS screenshots before/after F2 identical; an old pin survives the upgrade (§1 F1, F2, F8b).
- [ ] Map: "movement is data" feel survives (beats, flights, folding); p95 frame ≤ 4 ms with `test/fixtures/fleet-map.json` via `?mapperf=1`; phone pinch and bottom sheet on iOS Safari and Android Chrome (§5).
- [ ] Diff view responsive on a 5,000-line diff on a phone (§10).
- [ ] Decide later flips: `fleet.legacyBrowserRoutes: false` (§2), Docker group for health counts (§7), `packages.fetch: "mirror"` per builder (§6).
- [ ] Clean up: stop `fleet-preview` and `fleet-watchdog`, `git worktree remove` merged task worktrees (§11).

### During the hub rollout (after merge to main; the concrete homelab steps, phase A/B, are in `private/09-homelab-hub-room.md`)
- [ ] Before the hub runs the code: line-by-line review of every REVIEW-REQUIRED path (4.5) using X6's `~/fleet-night/security/CHECKLIST.md` and `critical.diff` (own PR if possible); every open SR finding resolved; then set the reviewed tag/SHA the hub runs (detached checkout, `npm ci --ignore-scripts`; never `git pull` on the hub) (security review S1).
- [ ] Generate the real hub key on the hub host (`laneboard fleet keygen` or `openssl genpkey -algorithm ed25519`), pin its public key in each builder's `fleet.hubKeys` first as a bare string (read-only scope), keep `fleet.hubControl: false` until reads are verified; to enable control, change the entry to `{key, id, scopes:["read","control","term"]}` and set `hubControl: true` (§2, §9).
- [ ] Optional hardening: set `fleet.hubAddrs` on builders to the hub's tailnet address; after checking `ps -o uid= -C tailscaled` on each box, set `fleet.ingressPeerUid`; set `fleet.allowedUsers` to the user's login on builders and hub (§2).
- [ ] Optional, phase 2: Bash sandbox for `default`-mode lanes and root-owned managed hook settings; a separate uid for laneboard on builders; a separate signer process for `hub.key` (SECURITY-FIXES.md accepted risks).
- [ ] Point `tailscale serve` at the ingress port 7778 on every builder and on the hub; after switching, open the board through serve and check for `bad-host` 403s (fix `publicUrl` / `fleet.publicHosts` / `fleet.allowedOrigins`) (§1, §2).
- [x] ~~On the installed tailscale: serve headers, Host with port, client copies overwritten, tagged caller gets no user headers, `--accept-app-caps` exists, funnel off, hub↔builder via DERP (~30-37 ms, terminal echo +60-70 ms)~~ — **verified** in `VERIFIED-FACTS.md`; re-check only after a Tailscale upgrade. Still open: the `Tailscale-App-Capabilities` JSON shape (feature stays inert).
- [ ] Open a terminal with devtools open: no CSP violations; terminals through the hub proxy are usable on a phone (DERP adds ~60-70 ms per echo, measured) (§1, §3).
- [ ] Soak the hub 1 h with the real builders: `/healthz` `rssMb` < 150 (§3).
- [ ] Hooks: re-run `deploy/install-claude.sh` on each builder (C10's merging installer), confirm with `jq '.hooks|keys' ~/.claude/settings.json`; trigger a failing Bash call, a permission prompt and a `/compact`, then check `/api/events` for `err_hash`, `perm` and compaction rows (§7, §8).
- [ ] Approvals on Claude Code 2.1.301: a held `PermissionRequest` hides the dialog until the hook returns and empty output then shows it; `Notification(permission_prompt)` ordering; `continue:false` from PreToolUse ends the turn cleanly and `resume` + "continue" picks up (drop `continue:false` if not) (§8).
- [ ] Packages: compare 3 package rows with GitHub Actions for the same main sha; two deliberately conflicting branches on two builders show an overlap edge, then a textual edge once pushed; `gh run view --json jobs` returns `steps` with a fine-grained (Actions: read) token (§6).
- [ ] Review workflow: script window while a browser terminal is attached keeps the owner's window on the agent; a 20-comment review is read from the file and the review-wait timer resets; restoring an archived lane whose branch is gone is refused quickly (§10).
- [ ] Approve from the Map against a real builder; the audit entry exists on both sides and the chains verify (`laneboard audit verify`) (§5, §2).
- [ ] Phone: a quiet-hours raise does not buzz and appears in Morning the next day; after the hub PWA works, builder push turns off (`push.local` auto) (§7).
- [ ] Homelab-only steps (ACL paste, tagged auth key, deploy key, feed move, destructive OKs): see `private/09-homelab-hub-room.md`.
