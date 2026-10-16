# Integration report

Integrator pass over `00-conventions.md` and sections 1-11. Every section file now starts with an "Integration notes" list naming what changed in it. `README.md` holds the resolved contracts, the global DAG (107 tasks), the waves and the consolidated HUMAN checklist. Private material moved to `private/` (`private/<nn>-private.md`; section 9 wholly to `private/09-homelab-hub-room.md`, copied from the coordinator's rewritten version).

Two files appeared in the plan directory during the pass and were used as inputs but **not edited**: `SECURITY-REVIEW.md` (adversarial review) and `VERIFIED-FACTS.md` (measurements on the real tailnet); both have since moved to `private/`, and `SECURITY-FIXES.md` maps every finding to its fix. Both contain private names (homelab node names, the tailnet domain, a LAN range, the user's login), so they fail the hygiene terms. **Recommendation:** move both into `private/` (or sanitize them) before anything from this directory is copied into the laneboard repo.

## 1. Conflicts found and how they were resolved

Coordinator decisions are marked **(C)**; integrator decisions **(I)**.

### Layout, config, ownership
1. **Boot split.** §3 `server/boot/{common,builder,hub}.mjs` vs §11 `server/builder.mjs` + `server/hub/main.mjs`. → §3 layout with §11's loader, route modules, config fragments and state decorators, all done by X1 in wave 0 **(C)**. `server/version.mjs` created by X1.
2. **`mode` defined three times** (§1 F4, §3 H1, §11 w0-split). → only X1's `server/config/mode.mjs` **(I)**.
3. **`server/config.mjs` edited by §1, §2, §3, §6, §7, §8, §10.** → one fragment per area (`fleet`, `fleet-auth`, `hub`, `packages`, `observability`, `control`, `review`); the only later edit of `config.mjs` is P8's `markers.done` default line **(I)**.
4. **`mode:"both"`**: conventions "allow if trivial" vs §1/§3 reject. → rejected **(C)**.
5. **State edits** (§6 snapshot key + collector start, §7 tick wiring + attention, §8 flags + attention, §10 `lanes.build` injection). → `state.addDecorator`/`addSnapshotKey`/`onTick` modules; X1 implements the two attention changes once **(I)**. Sanctioned `state.mjs` edits: X1, F6, F7, O3 only.
6. **`server/index.mjs` edited by F5, F7, F9, A8, O6, C4, R7.** → after X1 it is a dispatcher; work goes to `boot/common.mjs` (F5, A8), `boot/builder.mjs` (F7, A8, in order) or new route modules **(I)**.
7. **Module services ordering** (§11 ctx object vs features needing `dispatch`/`v1` before §2 A8 lands). → builder registries are module singletons imported directly (`server/fleet/dispatch.mjs`, `server/fleet/api-v1.mjs`); hub services are provided by H11, and the X1 hub stub loads no hub modules, so hub modules merged early stay inert **(I)**.
8. **Docs ownership** (sections editing `docs/config.md`, `docs/map.md`, `CHANGELOG.md`). → §11 rule: tasks write `docs/fleet/<topic>.md`, X4 assembles **(I)**.
9. **Test-file collisions** (`test/packages.test.mjs` shared by 6.1/6.3; `test/review-queue.test.mjs` by T10.5/T10.6; nonce/limiter tests inside `auth`/`dispatch` tests; A7 adding to `test/delta.test.mjs`; F6's lint in `test/frontend.test.mjs`). → split into per-task files **(I)**.
10. **`server/http.mjs` owners** (F1, F5, §4 T4.1, A8). → vendor fall-through moved into F1; order F1 → F5 → A8 **(I)**.
11. **`test/fixtures/snapshot.json` read-only** (§11) vs F6 regenerating `previewLines`. → one sanctioned exception **(I)**.
12. **CSS/doc paths**: `public/css/map.css`, `public/css/packages.css`, `public/css/diff.css`, `docs/packages.md`, `docs/control.md`. → `public/css/views/<view>.css`, `docs/fleet/<topic>.md` **(I)**.
13. **Concurrency** 15 (conventions) vs 8-10 (§11). → 8 default, 9 max **(C)**.
14. **Wave 0**: §1 "F1 lands first, alone" vs §11 w0-split/keys/testkit. → X1 → F3 → F4 → A1 → F1 → X2, sequential **(I)**.

### Builder API, auth, security
15. **Mutating header** `X-Laneboard: 1` (§1) vs `X-Laneboard-Request: 1` (§2). → `X-Laneboard: 1` everywhere, hub relay included **(C)**.
16. **Host/Origin/CSRF** implemented twice (`server/security.mjs` §1, `auth.checkHost/checkOrigin` §2). → primitives in `security.mjs`, kind-aware wrappers `auth.guardRequest`/`guardUpgrade` **(I)**.
17. **CSRF exemption** only `/api/hook` (§1) vs §8's new `/api/hook/permission`. → `HOOK_PATHS` set with both **(I)**.
18. **`fleet.hubKeys` format**: §2 `ed25519:` only vs conventions/§9 PEM. → both accepted, same `keyId` **(C)**.
19. **`fleet.hubControl`** proposed by §9, absent in §2. → added (A5 config, A8/dispatch enforcement, term upgrades too), default `false`, 403 `control-disabled`, audited **(C)**.
20. **Ingress**: §2 `ingressPort: null` + header heuristic; §9 serve to 7777. → `fleet.ingressPort` default 7778 whenever a `fleet` block exists, required in hub mode, serve targets it on builders and hub **(C)**; ingress requests without `X-Forwarded-*` are refused (`not-from-serve`, from `VERIFIED-FACTS.md`) **(I)**.
21. **Hub request auth**: §3 `req.tsUser` + `LANEBOARD_DEV` loopback bypass vs §2 `classify`. → `classify` on the hub too; `direct` or `local` only; `hub` kind refused; `LANEBOARD_DEV` dropped **(I)**.
22. **Hub CSP** (§3: `style-src 'self'`, missing `object-src`/`base-uri`/`form-action`) vs §1's. → §1 `securityHeaders` on both (xterm needs `'unsafe-inline'` styles) **(I)**.
23. **Signing helper**: §3 `signRead` returning 3 headers vs §2 `signedReadString` + `X-Laneboard-Key`. → `auth.signRead()` returns all 4 headers built on `signedReadString()` **(I)**.
24. **Tiers**: §2 `read/click/confirm`, §4 "tier 0/1/2", §5 "1/2", §10 "tier-1". → `read | click | ask | confirm` (`ask` = verb+Cancel, no extra server check); `hello.actions` carries the live table **(I)**.
25. **`kill` target `*`**: §2 "never" vs §8's builder kill switch. → allowed via `registerAllHandler('kill', …)`, confirm = builder id, refused from `local` **(I)**.
26. **Target `*` confirm** `"fleet"` accepted by builders (§2). → builders accept only their own id; the hub checks the typed `fleet` and rewrites per builder (security review S13) **(I)**.
27. **New actions**: `send-review`, `run-script`, `guardPrompt` **(C)**; `release` (the §8 "show the dialog at the terminal" decision had no action) **(I)**.
28. **Broadcast guard**: §8 `guard:'not-prompting'` vs §10 `guardPrompt`. → `guardPrompt:true`, implemented once in A6's built-in `send-text` **(C/I)**.
29. **Pause/resume/approve/deny args** (§2 `confirm?`/`approvalId` only vs §8's `interrupt`, `reason`, `nudge`, `override`, `note`). → merged schemas **(I)**.
30. **`interrupt`** registered by both §2 and §8. → §2 A6 built-in **(I)**.
31. **`ack-alarm`**: §2 target builder + `alarmId`; §4 `*` + `{kind, builder}`; §7 alarm id, hub-only. → target alarm id or `*` with `{tile, builder}`; hub-local action on a hub, `localOnly` dispatcher action on a standalone builder; alarms also run in builder mode over a fleet of one **(I)**.
32. **Hello capabilities with object values** (§3 `capabilities.repos`, §8 `permissionModes`). → string-only `capabilities`; hello fields `repos`, `permissionModes`, `scripts` **(I)**.
33. **API v1 file names**: §1 `server/fleet/api.mjs` vs §2 `server/fleet/api-v1.mjs`; both owned `test/api-v1.test.mjs`. → F9 creates `api-v1.mjs` + `server/routes/v1.mjs`, A8 extends (dep-ordered) **(I)**.
34. **Launch job follow** (§8 proxied `/api/jobs/:job`). → `GET /api/v1/jobs/:id` (A8) via the read proxy **(I)**.
35. **`stateDir`/`hubKeyFile` defaults** (§8, §3 hardcoded) vs §2 XDG `paths`. → `paths.stateDir()`, `paths.hubKeyFile()` **(I)**.

### Hub
36. **Hub→browser roster message** `{type:'builders'}` (§1) vs `{type:'fleet', …}` (§3). → `fleet` **(I)**.
37. **`visible`** `names` (§2, §3) vs `keys` (§1). → `keys`, legacy `names` one release **(I)**.
38. **Previews** (`previewHtml` in §3 store/client-ws, §4 guardrail exception, §10). → `previewLines` only **(C)**.
39. **Relay arg bounds** looser than the builder's (16 KB text, 32 keys, different key regex). → aligned with the builder schemas; builder stays authoritative **(I)**.
40. **Relay audit result** strings (`'pending'`, `'ok'`, `'timeout'`) vs §2's result object. → `{phase:'sent'}` then `{phase:'done', ok: true|false|'unknown', …}` **(I)**.
41. **Stuck detection owner**: conventions/§3 hub vs §7 builder. → builder; hub derives alarms **(C)**.
42. **Hub push**: §3 `push.onTransition` from store transitions vs §7 notify on alarm raise. → §7 O9 **(I)**; builder push switch `push.local` **(C)**, guard inside `push.mjs` **(I)**.
43. **Fake builder** (§3 H5 vs §11 testkit) and **hub-loads-no-collector test** (§3 H2 vs §11). → X2 **(I)**.
44. **Signed read proxy** assumed by §10 (and needed by §7's fan-outs) but never specified by §3. → new H12 with a fixed allowlist **(I)**.
45. **Audit mismatch view** (§2 and §3 each said the other owns it). → H13 reconciliation + D12 Audit view **(I)**.
46. **Placement** (§8 `place()` + `server/hub/dispatch.mjs`) vs §3 relay step 8. → relay step 8; `server/hub/dispatch.mjs` dropped **(I)**.
47. **Broadcast shape** (§3 ≤64 targets, no confirm) vs §8 (≤30, `confirmCount`, planner). → §8 via `registerHubAction` **(I)**.
48. **Builder `code` default** (§3 `B`+index vs §1 `deriveCode`). → configured, else `hello.code`, else `deriveCode(id)` **(I)**.
49. **Hub boot test with `fleet.builders: []`** (§11) vs H1 rejecting it. → test uses one dummy builder and a free `ingressPort` **(I)**.

### Map
50. **`server/map.mjs` owned by §3 H10, §5 T5.1, §7 T7** with incompatible builder nodes (`kind:'host'` under core vs `kind:'builder'` under `__fleet`; `stale→warn` vs `unknown`). → one task M1, §5's contract, `stale→unknown`; `build({snapshot})` kept so `boot/builder.mjs` is untouched **(I)**.
51. **Map client paths** (`public/map.js`, `public/motion.js`, `public/css/map.css`, `map/view.js`) vs §1's moves. → `views/map-canvas.js` (shim), `core/motion.js`, `css/views/map.css`, view module `views/map.js` **(I)**.
52. **Map chrome restyled twice** (§4 T4.10 and §5 T5.3/T5.4). → folded into M3/M4 **(I)**.
53. **Token names** (§5 `--fg-*`, `--st-*`, `--bg`) vs §4. → §4 names **(I)**.
54. **Split view state** (§5 `split=1` URL) vs §4 `localStorage['lb.split']`. → §4 (hotkey map authoritative) **(C/I)**.
55. **`peek` action** "GET preview via hub" undefined. → opens the inspector PEEK tab (§10 R12) **(I)**.
56. **Phone sheet height** 40% (§5) vs §4 half snap. → half **(I)**.
57. **T5.6** (frontend test file list) redundant with F1's whole-tree scan. → dropped **(I)**.

### UI
58. **Hotkey collisions**: §5 `o`/`O`, §8 inbox `a d r p`, §10 diff `c` vs §4 globals `a`, `p`, map `c`. → added to §4's (authoritative) table as view-scoped bindings; scoped wins while the view is active **(C/I)**.
59. **Router**: §1 default/unknown → board, no `open`; §4 default map, `open=`, `#session=` → `open:'term'`; §10 needs `#/diff`. → F8a implements §4's grammar with `DEFAULT_VIEW='board'`, D4 flips to `map`; `open` accepted; hidden `diff` view **(I)**.
60. **`act()`/`hubAct`** ("registered by the hub section", §1) vs `core/net.action()` (§4, §5, §8). → `act()` fully specified in F8a with three transports **(I)**.
61. **Store API** (§4 expects `store.builders()`, `alarms()`, `subscribe`). → pure selectors added to F8a **(I)**.
62. **`ACTION_TIERS` owner** (§4 says §2 exports it in a §1-owned file). → F8a fallback copy; live table from `hello.actions` **(I)**.
63. **Annunciator**: §4 8 tiles and `normal/unack/ack/rtn`; §7 10 tiles, `dark/flash/steady`, server-side `tileStates`. → 8 tiles with a kind→tile table, UI-side `public/js/core/alarm-tiles.js` (D7), `rtn` deferred, kinds `blocked` and `audit-fork` added **(I)**.
64. **Inspector action bar** (§4 in `inspector.js`, §8 `ui/actionbar.js`). → D6 stub, C14 owns **(I)**.
65. **Inbox review** (§8 group vs §10 tab). → group, rendered by R13's `renderReviewQueue` via dynamic import **(I)**.
66. **ANSI→DOM helper** (§10 `core/ansi-dom.js` vs §1 `core/ansi.js`). → §1 **(I)**.
67. **Safety tests** (§1 lint, §10 `views-safety`, §11 `frontend-static`). → `test/frontend-safety.test.mjs` (F6, whole `public/js/**`) + `test/frontend-static.test.mjs` (D4) **(I)**.
68. **§4 design review as a gate "before wave C"** — impossible unattended. → morning item **(I)**.
69. **Batch "archive all merged"** as a "tier-1" sheet vs `retire` being `confirm`. → one typed `RETIRE <n>` sheet, client fills each `confirm` **(I)**.
70. **Views nobody owned** (Box, Audit, Credit fleet-wide, notification prefs). → D11-D14 added **(I)**.

### Observability, control, review
71. **`review.*` config split** (§7 `overdueHours`, §10 the rest). → one fragment R1 **(I)**.
72. **`reviewReady` shape** (§7 `{at, source}` vs §10 `{ready, reasons, since}`) and owner. → §10's, R5 **(I)**.
73. **Review-wait storage** (§7 `review_waits` table vs §10 kv `review.waits`). → O10's kv, single store with specified exports **(I)**.
74. **New tables** (§7 `alarms`, `notify_deferred`, `review_waits`) → kv + `events` history, no extra `db.mjs` migrations (keeps `db.mjs` owners to F7 → P9 → R9) **(I)**.
75. **Fleet Morning merged twice** (§7 `fleetviews.mergeMorning` + `/api/morning?b=`; §10 `server/hub/morning.mjs` + `/api/fleet/morning`). → R10 single merge covering both requirement sets, `/api/fleet/morning`; credit stays O11 at `/api/fleet/credit` **(I)**.
76. **Approval intake** in `server/index.mjs` (§8). → `POST /api/hook/permission` **(C)** in the module `server/routes/approvals.mjs` **(I)**; §7 clarified that `hooks.subscribe` is for supersede only.
77. **§9 rollout gap**: `push.local` turns off at B2 (hub key pinned), hub push only at B6. → B2 sets `push.local: true` explicitly, B6 removes it **(I)**.

### Late inputs adopted
78. **`VERIFIED-FACTS.md`**: serve preserves `Host` with port (Host checks compare `host:port`); serve always adds `X-Forwarded-*` (ingress without them → 403); tagged callers carry no user headers; `--accept-app-caps` exists; funnel off; DERP latency. The matching HUMAN items are marked verified in README. `jq` needed by the existing statusline test → HUMAN before-night item.
79. **`SECURITY-REVIEW.md` adopted** (cheap, no conflict with coordinator decisions): S2 routing identity only from the upstream connection (§1 F8a, §3 H3); S3 Maps, name re-validation, caps, byte limits (§3 H3); S4 signed `term` envelope for terminals (§2, §3 H9); S6a ingress port mandatory with a `fleet` block; S7 `remoteOnly` approve/deny/release/set-budget/resume-override + "cooperative controls" in SECURITY.md and control docs; S8 audit anchoring + `audit-fork` (§3 H13, §7, conventions); S10 (already resolved by 15, 22, 38); S11 `pullCommands` validates every input, CLI `cleanTerm` (§10 R3, §2 A9); S12 restore defaults to the source builder, placement intersects with hub-config `repos` (§10, §3); S13 builder-id-only `*` confirms; S15 agent `curl` only to test ports (§11); S16 no query-param signatures, verify before nonce insert, raw `req.url`, `__proto__` keys rejected (§2); S17 no builder origins in hub `allowedOrigins`, builders drop the hub origin (§3 H1, private); S18 `gate.sh` fails closed while paused (§8); S19 approval/target mismatch → 409 (§8); S20 push caps, encoded URLs, router never dispatches (§7 O9, §4 D4); S21 https builder URLs, no `rejectUnauthorized`, no `LANEBOARD_DEV` (§3 H1/H11); S1 as a HUMAN gate (review of `server/hub/**`, `server/fleet/**`, pinned SHA, `npm ci --ignore-scripts` on the hub); S9a and S14 into `private/09`.

## 2. Unresolved, with recommendations

> **Superseded in part by the security fixes pass (`SECURITY-FIXES.md`):** items 1 (per-key scopes: adopted alongside `hubControl`, which stays as a master switch), 2 (peer-uid check: adopted as opt-in `fleet.ingressPeerUid`, failing closed with 403, task A11) and 14 (both files now in `private/`) are resolved there; item 3's signer process and item 4's sandbox remain accepted phase-2 risks.

1. **Per-key scopes (security review S5)** would replace `fleet.hubControl` with `hubKeys: [{key, scope:'read'|'control', actions?}]`. It conflicts with the coordinator's `hubControl` decision, so it is **not** adopted. Recommendation: keep `hubControl` tonight (global, simple, already enforced on actions and terminals); add per-key scopes in phase 2 with the bare-string form meaning `read`, which stays backward compatible.
2. **Peer-uid check on the ingress port (S6b)** is not adopted: if the uid lookup is wrong, tagged traffic would be misclassified as `local` (full control). Residual: a local process can connect to the ingress port with forged `X-Forwarded-*` and `Tailscale-User-Login` and act as `direct` (attribution forgery; local processes are already trusted). Recommendation: measure `ps -o uid= -C tailscaled` on every box first, then add the check as opt-in `fleet.ingressPeerUid`.
3. **Signer process on the hub (S9b)** and **uid separation between agents and laneboard on builders** (review residual 1): phase 2.
4. **Bash sandbox for `default`-mode lanes (S7.3)**: HUMAN decision; setting names on 2.1.301 unverified.
5. **Night size.** 107 tasks over 13 waves of up to 9 (68 M, 11 L) is very unlikely to finish in one night. README 4.4 defines tiers: tier A (30 tasks) delivers the hub end to end and DoD 1-5, 7; tier B (42) the visible UI and core signals; tier C (33) the rest. Recommendation: dispatch strictly by tier and critical path; accept tier C as tomorrow's work.
6. **`fleet.legacyBrowserRoutes`** stays `true`; flipping it needs a human check of the new UI.
7. **Annunciator `rtn` state** (cleared-but-unacked, ISA-18.2) deferred; needs §7 to keep cleared alarms until acked.
8. **Map `ci` links** have no data source tonight (§6 reports runs without the runner that ran them); links render `live:false`.
9. **Standalone builder** has no review-wait metric (O10 is hub-only); its Morning shows empty review/stuck/approval blocks. Acceptable.
10. **`remoteOnly`** also blocks approving from a browser on `http://127.0.0.1:7777` (ssh tunnel); approvals need the serve URL. Acceptable; document in `docs/fleet/control.md`.
11. **Builder-mode alarms keep running when a hub exists** (duplicate work, the hub ignores the frames). Acceptable; could be switched off when `fleet.hubKeys` is set.
12. **Hub `self` node**: the private `map.json` sets `"self": "hub"`, but `self` aliases `builder:<fleet.id>` and the hub is not a builder; M1 must treat an unmatched `self` on a hub as a plain node (feed status only). Worth a test in M1.
13. **F1 relies on `vm.SourceTextModule`** (`--experimental-vm-modules`); fallback described in §1 5.
14. **`SECURITY-REVIEW.md` / `VERIFIED-FACTS.md`** contain private names (see top).

## 3. Sections or tasks too thin to implement unattended

- **D11-D14** (Box, Audit, Credit fleet view, notification prefs) were added by the integrator with data shapes and done-when only; the visual layout is left to the component kit. Acceptable for tier B/C; expect taste follow-ups.
- **D4 view registry "legacy adapter"**: how each F1-moved view (board, morning, credit, box, map) is wrapped until its owner adds a default export is described in one sentence. The D4 card should list the adapter per view (`mount` → the old `render*`/`show*` function, `update` → `renderAll`).
- **H11 hub wiring (L)** integrates nine modules and the services hook; its card must carry the exact route table (§3 2.8), the provide order (`store`, `relay`, `readProxy`, `services`, `broadcast`, `onClientMessage`, `audit`) and the start/stop order. Consider splitting it into "routes + auth" and "services + map loop" if the coordinator has a spare slot.
- **F8b (L)** "switch every `dataset.name` to `key`" is mechanical but touches 11 UI files; the card should include the grep that must come back empty (`dataset\.name`, `s\.name` used as a map key).
- **O8 alarm derivation** depends on field names that are partly unverified (`activity.failure` from StopFailure, the attention `danger` flag); the card should say "missing field → no alarm of that kind, never a crash".
- **R10 morning merge** combines four sources; the exact inputs are now named (`reviewWaits.stats/open`, `notify.digest`, alarm history events, hub audit) but the cost-per-package needs `packagesFor` from P9, which may land later; the card should allow an empty `costByPackage`.
- **D2/D1 vendored assets** need network or pre-staged files; otherwise they block (HUMAN before the night).
- **§9 (private)** is a manual runbook by design, not agent tasks for the laneboard repo.
