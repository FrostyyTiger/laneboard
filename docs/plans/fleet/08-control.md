# Section 8: Control (approvals, pause/resume, interrupt, broadcast, kill switches, budgets, dispatch, lifecycle)

**Integration notes (integrator):**
- Coordinator decision confirmed: approval intake is `POST /api/hook/permission` (local hook class, CSRF-exempt via §1's `HOOK_PATHS`), reads via `GET /api/v1/approvals`. Both live in the feature module `server/routes/approvals.mjs` (X1 loader), not in `server/index.mjs`.
- No `server/state.mjs`/`server/config.mjs` edits: flags `paused`/`awaitingApproval` and snapshot key `approvals` are flag modules (`server/flags/{paused,approval}.mjs`) using `state.addDecorator`/`addSnapshotKey`/`onTick`; X1 implements "attention treats `awaitingApproval` as `waiting_permission`". Config is the fragment `server/config/control.mjs`; `stateDir` defaults to §2 `paths.stateDir()`.
- `interrupt` is §2's built-in action (A6); this section registers `pause`, `resume`, `approve`, `deny`, `release` (new, the "show dialog at terminal" decision), `set-budget` (C7). The broadcast guard is `send-text` `guardPrompt:true` (§2), replacing `guard:"not-prompting"`.
- Builder kill switch = `kill` target `*`, registered via `dispatch.registerAllHandler("kill", killAll)` in `server/routes/killswitch.mjs`; confirm = builder id (when fanned out the hub checks the typed `fleet` and rewrites it to each builder's id; builders never accept `fleet`). Fleet kill and broadcast are hub-local actions (`relay.registerHubAction`) in hub modules `server/hub/routes/fleetkill.mjs` and `server/hub/routes/broadcast.mjs`.
- Hub launch placement is §3 relay step 8 (`placement.rank`); `server/hub/dispatch.mjs` is dropped. `hello` gets `capabilities` `launch|approvals|pause|budget` and hello fields `permissionModes`, `repos` (not inside `capabilities`). Launch jobs are followed through `GET /api/fleet/:builder/v1/jobs/:id` (§2 + §3 H12).
- Budget evaluation is exposed as snapshot key `budget` (`[{scope, key, usd, limit, pct, level}]`); §7 O8 derives `budget-warn`/`budget-exceeded` alarms from it (the "§6 alarm stream" is §7's).
- UI: actions go through `act()` (§1 `core/actions.js`), dialogs through §4 `confirmAction`; inbox keys are view-scoped commands (§4 D8); the Review group renders with §10's `views/review-queue.js` via dynamic import (fallback plain rows); `ui/actionbar.js` starts as a §4 D6 stub; `public/js/core/broadcast-plan.js` is owned by C8 (with the parity test).
- Task deps/files match the global DAG (README.md). Docs go to `docs/fleet/control.md`. Private details moved to `private/08-private.md`.
- Adopted from the late security review: `approve`/`deny`/`release`/`set-budget` and `resume{override}` are `remoteOnly` (§2: refused for `local`), so an agent cannot approve its own request through the local API; `decide()` refuses a target/approval mismatch (409); `kill *` needs `args.confirm === fleet.id` (the hub rewrites the typed `fleet`); `gate.sh` exits 2 (block) when a sentinel matched but the event cannot be parsed; `docs/fleet/control.md` states that these controls are cooperative on the builder itself.
- **Security fixes pass (see `SECURITY-FIXES.md`):** remote-only (refused for `local`, allowed for a `direct` user through serve or a signed hub request whose key has `control` scope) is the set `approve`, `deny`, `release`, `set-budget`, `kill *`, and `resume` of a session held by a `kind:'budget'`/`kind:'quota'` pause (with or without `override`); C6/C7 supply that predicate to §2's dispatcher. On the hub every action needs `direct` (§3 2.8). A builder never accepts `confirm:'fleet'`. The inbox shows a "cooperative control" note (C13) and `docs/fleet/control.md` and `SECURITY.md` say plainly that on-builder guards are cooperative against an agent with a shell. Optional Bash-sandbox hardening for `default`-mode lanes is a documented HUMAN/phase-2 item. `server/control/{handlers,budget,killswitch,broadcast}.mjs`, `server/routes/{approvals,control,budget,killswitch}.mjs`, `server/control/token.mjs` and the hub modules `broadcast.mjs`/`fleetkill.mjs` are REVIEW-REQUIRED (README 4.5).

## 1. Goal and scope

**In:** an approval queue built on Claude Code's `PermissionRequest` hook; operator pause/resume (per lane, per builder, fleet) enforced by a synchronous hook gate; interrupt; hub broadcast; kill switches at lane/builder/fleet level with grace and undo; budget caps per lane and per builder, plus an opt-in quota guard; dispatch (launch from the hub with placement); archive and stale-lane lifecycle; a safe, idempotent hook installer with an uninstall path. UI: `views/inbox.js`, the inspector action bar, the broadcast dialog and the kill-switch dialog.

**Out:** persistent allow-list policies ("always allow X in lane Y"). The data shape is reserved and the work is phase 2 (§5). Also out: auto-kill of any kind (a kill always needs a human), and approvals for non-lane sessions on the hub (they appear, but the hub never auto-decides).

Ground truth checked on this machine: Claude Code **2.1.301** (`~/.local/bin/claude --version`; `claude` is not on the non-login PATH, matching `config.claudeBin` in `server/config.mjs:62`). The installed `~/.claude/settings.json` has exactly the 7 laneboard async curl hooks from `deploy/hooks.json` plus `statusLine`, and no other hooks.

## 2. Design

### 2.1 Hook contracts (from code.claude.com/docs/en/hooks, fetched 2026-10-15)

- **PermissionRequest.** Fires only at the point where Claude Code would show the permission dialog, after PreToolUse. Input: the common fields (`session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`) plus `tool_name`, `tool_input`, optional `permission_suggestions[]`, and `mcp_server` for MCP tools. It has **no `tool_use_id`**. Output: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny","updatedInput"?,"updatedPermissions"?,"message"?(deny),"interrupt"?(deny)}}}`. Exit 0 with empty stdout means no decision, and the normal dialog is shown. Exit 2 is not honoured. Default timeout is 600 s. With `onFailure:"block"` a failure **denies**, so we never set it. A matcher is supported (tool name).
- **PreToolUse.** `hookSpecificOutput.permissionDecision: allow|deny|ask|defer` plus `permissionDecisionReason`. A timeout does not block. Exit 2 blocks and uses stderr as the reason.
- **UserPromptSubmit.** Top-level `{"decision":"block","reason":"..."}`. The default timeout here is 30 s.
- **Common output** `continue:false` + `stopReason` stops Claude after the hook. HUMAN: verify on 2.1.301 that `continue:false` from a PreToolUse hook ends the turn cleanly (the page was read only partially for common fields).
- HUMAN: verify the ordering of `Notification(permission_prompt)` and `PermissionRequest`. In particular, does the dialog (and the notification) appear only **after** our hook returns? Everything below assumes yes, so a held request shows a spinner in the terminal, not a dialog.

### 2.2 Approval queue

**Hook (command, not `type:"http"`).** An HTTP hook reports a non-2xx response or a refused connection as a visible "hook error" in every transcript while laneboard is down, and it has no connect timeout of its own. Instead we add a curl command hook in `deploy/hooks.json` under `PermissionRequest`, matcher `*`:

```
curl -sf --connect-timeout 1 -m ${T} -H @$HOME/.local/state/laneboard/hook.header \
  -H 'content-type: application/json' --data-binary @- \
  http://127.0.0.1:${PORT}/api/hook/permission || true
```

The hook entry has `"timeout": T+15` and **no** `async`. `-f` keeps an error body off stdout, so a 4xx/5xx means empty stdout, which means no decision, which means the normal dialog. The `|| true` makes laneboard being down (connection refused) or hung (no connection within 1 s) fail open. The installer renders T and PORT (§2.8).

**Intake route (deviation from `/api/v1/approvals`, on purpose).** The hook is a local hook-class request, like today's `POST /api/hook` (`server/index.mjs:175`, now `server/boot/builder.mjs`). It carries no Tailscale login, no hub signature and no `X-Laneboard` header. So the intake is `POST /api/hook/permission` in the feature module `server/routes/approvals.mjs`; §1 F5 exempts it from the CSRF header (`HOOK_PATHS`). It is accepted only when all of these hold:
- `req.auth.kind === 'local'` (§2: the non-ingress listener) and `req.socket.remoteAddress` is loopback;
- there is no `tailscale-user-login` header and no `x-forwarded-for` header, so the request did not come through `tailscale serve`;
- `X-Laneboard-Hook` equals the 32-byte hex token in `~/.local/state/laneboard/hook.token`. The server creates it with mode 0600 at start, plus `hook.header` containing `X-Laneboard-Hook: <tok>`.

On any failure the route returns 403 with an empty body, which falls through to the dialog. The read side is v1: `GET /api/v1/approvals` lists the pending ones. Decisions go only through the `approve`/`deny` actions.

**Module `server/control/approvals.mjs`:**

```js
// Approval: { id, session, lane, sessionId, builder, tool, summary, input, preview,
//   cwd, permissionMode, suggestions, createdAt, expiresAt,
//   status: 'pending'|'allowed'|'denied'|'released'|'timeout'|'abandoned'|'superseded',
//   decidedBy, decidedAt, note }
export function open(body, { now, timeoutMs, nameOf, laneOf }) -> { approval, wait: Promise<Decision|null> }
export function decide(id, { behavior: 'allow'|'deny'|'release', note, interrupt }, who) -> Approval  // throws ActionError 404/409
export function pending() -> Approval[]
export function supersede(sessionId, reason)   // called from hooks.ingest on PostToolUse/Stop/SessionEnd/UserPromptSubmit
export function hookOutput(decision, who) -> string  // '' for release/timeout
export function onChange(fn)                    // ws fan-out
```

- An approval is in memory only. A restart drops the curl connections, which means no decision and the dialog falls through. Every open and close is written with `db.addEvent({type:'approval', subtype: status})` (`server/db.mjs:169`).
- `input` is `JSON.stringify(tool_input)` truncated to 4 KB, stored as plain text. Escaping is the renderer's job (textContent only). `summary` comes from the existing `summariseToolInput` (`server/collector/hooks.mjs:52`).
- `preview` comes from the pure `server/control/preview.mjs#previewFor(tool, input, readFileSync?)`:
  - Edit: the `old_string`/`new_string` lines as `-`/`+`. MultiEdit: per edit.
  - Write: a line diff against the current file when it is ≤ 256 KB and under `cwd` (realpath check). Otherwise the first 80 lines as `+`.
  - Bash: the command.
  - Output shape is `{kind:'diff'|'text', lines:[{t:'+'|'-'|' ', s}], truncated}`, capped at 300 lines / 16 KB. The diff is a plain LCS when both sides are ≤ 400 lines, else a hunk-less `-` all / `+` all.
- **Route handler:** read the body (cap 4 MB), `open()`, then `await Promise.race([wait, sleep(T), reqClosed])`. Write `hookOutput()` (200, possibly an empty body). On `req.on('close')` before a decision, set status `abandoned`, which covers both "Claude cancelled the hook" and "the human answered at the terminal".
- **Timeout policy (decided): fall through to the terminal prompt, not auto-deny.** Lanes run unattended, and a deny makes the agent route around the refusal, which is worse than waiting. A fall-through leaves the dialog in the pane. The state machine then sees `Notification(permission_prompt)` → `waiting_permission` (`hooks.mjs:24`), and the existing send-keys answer path still works from the board. `config.approvals.onTimeout: 'prompt'` is the default; `'deny'` is available for operators who want it.
- **`release` decision.** "Show the dialog at the terminal now". It returns empty output immediately. This exists because the hold hides the dialog from a human sitting at the terminal.
- **Allow output:** `decision:{behavior:'allow'}`.
- **Deny output:** `decision:{behavior:'deny', message:'Denied by <user> via laneboard' + (note? ': '+note : ''), interrupt: Boolean(args.interrupt)}`.

**Session flag** (`server/flags/approval.mjs`). A session decorator sets `awaitingApproval: <approvalId>|null` from `approvals.pending()` by `sessionId`. While it is set, `attentionScore` treats the session as `waiting_permission` (X1 implements this in `state.mjs`, reading the decorated field), and the state word is **not** changed. Snapshot key (`state.addSnapshotKey('approvals', pending)`): `snapshot().approvals`, with approval previews kept (§2's "previews stripped" refers to pane previews).

**Message on `/ws` and `/api/v1/stream`:** `{type:'approval', op:'open'|'close', approval}` via `ws.send` (the §2 tap stamps it for the v1 stream).

**Config** (`server/config.mjs` defaults):
```js
// fragment server/config/control.mjs
stateDir: paths.stateDir(),   // §2 server/fleet/paths.mjs; env LANEBOARD_STATE_DIR
approvals: { enabled: true, holdSec: 600, onTimeout: 'prompt', previewMaxLines: 300 }
```
`holdSec` is clamped to 30..1800.

### 2.3 Pause / resume / interrupt

**Sentinels.** These live under `config.stateDir` (new; default `~/.local/state/laneboard`, the same directory as §2's audit log):
- `paused/ALL`: builder-wide pause;
- `paused/<sessionName>`: pause one session;
- `paused/sid-<claudeSessionId>`: a mirror of the session pause, rewritten each tick for every paused name, so the gate does not depend on tmux.

Each file's content is `{"kind":"operator"|"budget"|"quota","by","at","reason"}`. The `paused/` directory is removed when it is empty, which keeps the gate's fast path to one `stat`.

**Gate script `deploy/hooks/gate.sh`** (POSIX sh + jq; jq is already required by `install-claude.sh:29`). The installer copies it to `~/.claude/laneboard/gate.sh`. It is registered **synchronously** on `PreToolUse` (matcher `*`, timeout 5) and `UserPromptSubmit` (timeout 5), next to the existing async curl entries.

```sh
#!/bin/sh
S="${LANEBOARD_STATE_DIR:-$HOME/.local/state/laneboard}"
[ -d "$S/paused" ] || [ -d "$S/ceiling" ] || exit 0          # fast path: <2 ms
in=$(cat); ev=$(printf '%s' "$in" | jq -r '.hook_event_name // empty')
sid=$(printf '%s' "$in" | jq -r '.session_id // empty')
name=$( [ -n "$TMUX_PANE" ] && tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null )
hit=""
for f in "$S/paused/ALL" "$S/paused/sid-$sid" ${name:+"$S/paused/$name"}; do [ -e "$f" ] && hit=$f && break; done
# budget ceiling (2.5): stop when the statusline cost reaches the ceiling the server wrote
if [ -z "$hit" ] && [ -n "$sid" ] && [ -e "$S/ceiling/sid-$sid" ]; then ...compare jq '.cost.total_cost_usd' of
  ~/.cache/laneboard/status/$sid.json with the ceiling; set hit=budget ...; fi
[ -z "$hit" ] && exit 0
reason="Paused by operator via laneboard. Do not retry or work around this; stop and wait to be resumed."
case "$ev" in
  PreToolUse) jq -nc --arg r "$reason" '{continue:false, stopReason:$r, hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}';;
  UserPromptSubmit) jq -nc --arg r "$reason" '{decision:"block", reason:$r}';;
esac
exit 0
```

Every error path **on the fast path** (no `paused/` or `ceiling/` dir) exits 0 with no output, so the gate fails open there. When a sentinel matched (`hit` set) but `ev` is empty or unknown (e.g. `jq` missing or broken), it prints the reason to stderr and exits 2, which blocks PreToolUse and UserPromptSubmit (fail closed while paused). That is consistent with hard rule 5: a broken laneboard is invisible. The script is also tested directly (§4).

**Module `server/control/pause.mjs`:** pure filesystem code, importable by the CLI without the server.

```js
export function pausePath(stateDir, scope)          // scope: name | 'ALL'; validates isSafeSessionName / 'ALL'
export function pause(scope, { kind, by, reason }, { stateDir }) -> {ok, scope, file}
export function resume(scope, { kinds }?, { stateDir }) -> {ok, removed:[...]}  // kinds filter: a budget pause is not lifted by an operator resume unless args.override
export function list({ stateDir }) -> [{scope, kind, by, at, reason}]
export function syncMirrors(sessions, { stateDir })  // each tick: write sid-<id> for paused names, delete orphans
export function isPaused(name, sessionId, list) -> {scope, kind}|null
```

The session snapshot gets `paused: {scope:'session'|'all', kind, by, at}|null`, set by the decorator in `server/flags/paused.mjs` (its `state.onTick` hook also runs `syncMirrors`).

**Actions** (handlers in `server/control/handlers.mjs`, registered with `ctx.dispatch.registerAction` by the module `server/routes/control.mjs`; tiers and arg schemas as in the README action table):
- `pause`, target `<name>|*`, args `{interrupt?:bool, reason?}`. Writes the sentinel. With `interrupt`, it also sends `Escape` through `actions.sendKeys` to each target, so an in-flight long Bash/tool is cut (the key passes the regex at `server/actions.mjs:63`). Target `*` means `paused/ALL` plus Escape to every session with `s.lane != null` when `interrupt` is set.
- `resume`, target `<name>|*`, args `{nudge?:bool=true, override?:bool}`. Deletes the sentinel(s). If `nudge`, and the session's state is in `done|idle`, and `promptReadiness(pane) === 'ready'` (`state.mjs:76`), it calls `actions.sendText(name, 'continue', true, who)`. A session that is not ready is reported as `{nudged:false, reason}`.
- `interrupt`, target `<name>|*`: `sendKeys(name, ['Escape'])`. This is §2's built-in action (A6); not re-registered here.
- `approve`, `deny` (`{approvalId, note?, interrupt?}`), `release` (`{approvalId}`), target `<name>`: `approvals.decide(approvalId, {behavior}, who)`; a mismatch between `approvalId` and the target session → 409. All three are registered `remoteOnly: true`.
- `resume` is registered with `remoteOnly: (env, deps) => env.args.override === true || targets(env).some(n => pause.kindOf(n) in {budget, quota})`, so an agent on the builder cannot lift its own budget or quota pause through the local API (it can still delete the sentinel file: cooperative).

Fleet pause is a hub fan-out: `POST /api/fleet/actions {builder:'*', action:'pause', target:'*', args:{confirm:'fleet', interrupt}}` is checked at the hub (typed `fleet`) and sends `pause *` with `args.confirm:<thatBuilderId>` to every `up` builder (§3 relay 7b). Per-builder pause is `pause *` on one builder with `args.confirm:<builderId>`.

**CLI** (`bin/laneboard`): `laneboard pause <name|--all>`, `laneboard resume <name|--all>`, `laneboard paused`. The CLI imports `server/control/pause.mjs` and writes the files **directly**, so pausing works with the server down. That property matters for the runbook. `laneboard resume` lifts only `kind:'operator'` pauses (it passes `kinds:['operator']`) and prints "budget/quota pauses are lifted from the UI (remote-only)" for the rest; this is a convention, not a boundary (the files are writable by that uid).

### 2.4 Broadcast

Pure planner `server/control/broadcast.mjs` (used by the hub and by builder mode):

```js
export const BROADCAST_LIMITS = { maxTargets: 30, maxText: 2000, minIntervalMs: 10_000 };
export function planBroadcast(targets /* fkeys */, sessionsByKey) -> { send: [fkey], skip: [{key, reason}] }
// skip reasons: 'unknown', 'prompting' (state waiting_permission|waiting_question, or awaitingApproval,
//   or the pane heuristic says dialog), 'paused', 'dead'/'shell', 'builder-down'
export function validateBroadcast({ targets, text, confirmCount }, lastAt, now) -> error string | null
```

Hub action `broadcast` (hub-local, registered by `server/hub/routes/broadcast.mjs` with `relay.registerHubAction`; logic in `server/hub/broadcast.mjs`): target `*`, args `{targets:[fkey], text, enter:true, confirmCount}`. In standalone builder mode the UI loops `send-text` with `guardPrompt:true` over the planned targets.
- `confirmCount` must equal `send.length` after planning. Otherwise the action is refused with 409 and the fresh plan is returned, so the UI re-asks.
- Rate limit: one broadcast per user per 10 s (hub memory).
- Fan-out: one signed `send-text` per target, with args `{text, enter, guardPrompt:true, fanout:{parent:<broadcast id>}}`.
- The builder's `send-text` (§2 A6) re-checks `guardPrompt` against its **own** current state, because the hub's view can be up to 15 s stale, and returns 409 `{ok:false, skipped:'prompting'}` instead of typing.
- Result: `{sent:[...], skipped:[{key,reason}], failed:[{key,error}]}`, written to the hub audit log as one entry plus per-target builder entries.

### 2.5 Budget caps and the quota guard

**Config** (defaults, everything off):
```js
budget: {
  window: 'tonight',            // a name from util.WINDOWS (server/util.mjs:76): 'tonight'|'24h'|'12h'
  perLaneUsd: null,             // default cap per lane; null = none
  perBuilderUsd: null,          // cap over all sessions of this builder
  warnPct: 80, pausePct: 100,
  quota: { enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false },
}
```
Lane records gain `priority: 'low'|'normal'|'high'` (default `normal`) and an optional `budgetUsd`. Both are written by `launch()` (`server/lanes/launch.mjs:233-237`) from new request fields, which `validate()` checks.

**Overrides:** the `set-budget` action, target `<laneId>|*`, args `{usd: number|null, window?}`. It is persisted in `db.kvWrite('budget.overrides', {lanes:{[id]:usd}, builder:usd|null, window})` (`server/db.mjs:159`). Precedence: override, then lane record `budgetUsd`, then config default.

**Module `server/control/budget.mjs`:**
```js
export function limitsFor({ config, overrides, laneRecords }) -> { builder: usd|null, lanes: Map<id, usd> }
export function evaluate({ spendByLane, builderUsd, limits, warnPct, pausePct }) ->
  [{ scope:'lane'|'builder', key, usd, limit, pct, level:'ok'|'warn'|'over' }]
export function ceilings({ sessions, evaluation, limits }) -> Map<sessionId, usdAtStatusline>
export async function tick(now)   // every 30 s, started by server/routes/budget.mjs
```
- Spend comes from the existing `morning.spendBySession` + `spendByLane` (`server/morning.mjs:51,95`) over `db.costRowsForWindow(windowStart(window, tz))`, with live costs as the endpoint. That is the same number Morning shows, so they reconcile.
- **warn** (first crossing per window): `addEvent({type:'budget', subtype:'warn'})`; the evaluation is published as snapshot key `budget` (module `server/routes/budget.mjs`, which also runs `tick` every 30 s and registers `set-budget`), from which §7 O8 derives the `budget-warn`/`budget-exceeded` alarms (and §7 O9 the push).
- **over**: `pause.pause(laneSession, {kind:'budget', by:'budget', reason})`. For the builder scope it uses `ALL`. Nothing is killed.
- **Hook-path enforcement.** The server writes `ceiling/sid-<sid>` = the statusline `cost.total_cost_usd` at which this session crosses its lane's remaining budget (current statusline total + remaining usd). The gate (§2.3) stops the session at the next tool call even if laneboard has died since. Ceilings are rewritten every tick and removed when no cap applies.
- `resume` of a `kind:'budget'` pause is refused (409 "over budget: raise it with set-budget or pass override") unless `args.override` is set. `set-budget` re-evaluates immediately and lifts a budget pause that no longer applies.

**Quota guard** (opt-in). Read `db.lastRateLimitSample().fiveHourPct` (`server/db.mjs:377`).
- When it exceeds `fiveHourPct`, pause every lane session with `priority:'low'` (`kind:'quota'`).
- When it drops below `resumeBelowPct` and `autoResume` is set, lift only `kind:'quota'` pauses. Otherwise raise an alarm.
- Rate limits are per account, so each builder acts on its own sample. The hub only displays.

### 2.6 Kill switches

| Level | Action | Behaviour |
|---|---|---|
| lane | `kill` target `<name>` | the existing `actions.kill` (`server/actions.mjs:207`), exact target |
| builder | `kill` target `*` args `{confirm:<builderId>, graceMs=10000, include:[names]?}` (remote-only; `confirm:'fleet'` → 400) (registered with `dispatch.registerAllHandler('kill', killAll)` in `server/routes/killswitch.mjs`) | (1) `pause *` + Escape to every lane session; (2) after `graceMs`, `kill` every session with `s.lane != null`, plus only the explicitly named non-lane sessions in `include`. `_laneboard*` sessions and the hub's own session are never killed. Returns `{job}`. Steps go to `db.addJobStep` (`server/db.mjs:399`, kind `killall`). |
| builder cancel | `kill` target `*` args `{confirm, cancel: job}` | within the grace period: clears the timer. The pause stays, so the operator decides whether to resume. |
| fleet | hub-local `kill` with `builder:'*'`, target `*`, typed confirm `fleet` checked at the hub, each builder receiving `args.confirm:<its id>` (registered by `server/hub/routes/fleetkill.mjs`; Undo = the same with `args.cancel:<fleetJob>`) | t=0: `pause *` (interrupt) fan-out to all builders. t=0..10 s: undo window on the hub, shown as a countdown in the dialog; Undo = `resume *` fan-out and no kill. t=10 s: `kill *` with `graceMs:0` to each builder. If the hub dies inside the window, the kill never happens and the fleet stays paused (fails safe). |

Module: `server/control/killswitch.mjs` (builder: `killAll`, `cancel`; pure `selectVictims(sessions, include)`). The hub side is `server/hub/fleetkill.mjs` plus its hub module `server/hub/routes/fleetkill.mjs` (§3 owns the rest of `server/hub/`).

**Out-of-band runbook** (HUMAN, goes into `docs/control.md`):
1. `ssh builder-a` (or `tailscale ssh builder-a`).
2. `laneboard pause --all`, which needs no server.
3. `tmux ls`, then `tmux kill-session -t '=<name>'` for each lane. The `=` matters (`server/actions.mjs:5`).
4. If the box is wedged: `systemctl --user stop laneboard` does **not** stop agents. `pkill -f '/claude '` does.
5. Last resort: the hypervisor console, or a VM stop.

### 2.7 Dispatch and lifecycle

- **Builder `launch` action** = `launcher.launch(args, user)` (`server/lanes/launch.mjs:227`), unchanged. New fields: `priority`, `budgetUsd`, and `dryRun`. A dry run returns `validate()`'s result without writing the record. `validate` has no side effects before `store.write` (`launch.mjs:146-218`). One exception: a dry run's slot is advisory, because `serialised` holds only during the real launch.
- `hello.capabilities` adds `launch`, `approvals`, `pause`, `budget` (`ctx.v1.addCapability`), and hello fields (`ctx.v1.addHelloField`, module `server/routes/launch-caps.mjs`) `permissionModes: [...]` (from `permissionModesFromHelp`, `launch.mjs:90`, cached at start) and `repos: [names]`.
- **Hub:** launch form → `POST /api/fleet/actions {action:'launch', builder: null, …}`; §3's relay (step 8) calls `placement.rank(view, {repo})`, picks the top eligible builder and sends a signed `launch` envelope (result carries `placedBy:'hub'`, `score`). The UI follows the returned `job` through `GET /api/fleet/:builder/v1/jobs/:id` (§3 read proxy; §2 `GET /api/v1/jobs/:id`).
- **Form fields:** lane id, repo (from the chosen builder's `hello.repos`, otherwise the union across builders, filtered on placement), branch (default `feat/<lane>`), plan path (default `docs/plans/<lane>.md`), model (default `opus`), permission mode (from capabilities, default `auto`, as in `launch.mjs:160`), priority, budget usd, and builder (`auto` or a list).
- **Archive** = the `retire` action → `retirer.retire(id, {force, confirm})` (`server/lanes/retire.mjs:148`), with all existing safety rules (it never kills; force needs `confirm === id`). The record, prompt and transcripts stay, and cost rows stay in the db. The inbox lists `readiness.ready` lanes whose PR is merged as "archive candidates" with a one-click retire (no force). The stale-lanes list (§6's `stale` data and §7's `stuck` flag) is shown in the same inbox group, read-only, with retire/kill links that open the kill dialog.

### 2.8 Installer (`deploy/install-claude.sh`)

**Bug in the current code.** `install-claude.sh:30` does `.hooks = ((.hooks // {}) + $h[0])`. Object `+` **replaces** each event's array, so any non-laneboard `PreToolUse` hook a user has is silently deleted. The diff guard at line 34 excludes `.hooks`, so it does not catch this.

New behaviour:
- **Ownership marker.** Every laneboard command contains `/api/hook` or `~/.claude/laneboard/`. A jq predicate `def ours: (.command // .url // "") | test("127\\.0\\.0\\.1:[0-9]+/api/hook|\\.claude/laneboard/")`.
- **Merge** per event: `.hooks[ev] = ([.hooks[ev][]? | .hooks |= map(select(ours|not)) | select(.hooks|length>0)] + $h[0][ev])`.
- **Guard.** Besides the existing non-hooks diff, add a second check that the non-ours hook entries are identical before and after: `[.hooks[][]? | .hooks[] | select(ours|not)]` sorted. If either check fails, restore and exit 1.
- **Render.** `deploy/hooks.json` becomes `deploy/hooks.json.tmpl` with `@PORT@` and `@HOLD@`/`@HOLD_TIMEOUT@`, rendered from `server/config.mjs` (as `laneboardctl` already does for the port, `bin/laneboardctl:18`).
- **Copy** `deploy/hooks/gate.sh` to `~/.claude/laneboard/gate.sh` (0755).
- **Token.** Run `node -e` to create `hook.token`/`hook.header` if missing.
- **Backup first** (as today, line 21). Re-runs are a no-op except for a fresh backup. Print a summary per event.
- `--uninstall`: back up, strip `ours` entries, delete events that end up empty, remove the sidecar via `statusline.withoutSidecar` (`server/collector/statusline.mjs:31`), remove `~/.claude/laneboard/`, and leave `statusLine` alone unless it points at our installed script and the user passes `--statusline`.
- `--dry-run` prints the diff only.

### 2.9 UI pieces (shapes coordinated with §4)

- **`public/js/views/inbox.js`**, with the pure grouping in `public/js/core/inbox-model.js` (testable).
  - Groups, in order: **Approvals** (oldest first, countdown to `expiresAt`); **Needs you** (attention list + `need`/`blocked` markers, `waiting_*`); **Review** (§10 `reviewReady`, rendered by `renderReviewQueue` from `./review-queue.js` (§10 R13) loaded with a dynamic `import()`; if it is absent, plain rows); **Paused** (with kind); **Archive / stale**.
  - Each row: status shape, lane fkey, tool code, summary. Expanding a row shows `input` in a `<pre>` (textContent) and the preview as diff lines, rendered by creating `<span class="d-add|d-del|d-ctx">` with textContent.
  - Keys (registered as view-scoped commands with §4's `core/commands.js` `register({keys, when: ctx => ctx.view === 'inbox'})`; they win over the global `a`/`p` while the inbox is active): `j/k` move, `a` approve, `d` deny (opens a note field; Enter sends), `r` release to terminal, `Enter` open in the inspector, `p` pause the lane. `a`/`d` act on the **focused row's id**, never on "the first one": a list that re-sorts must not change what the key hits. If the row's id is no longer pending, the key does nothing and the row shows its closed status.
- **Inspector action bar** (`public/js/ui/actionbar.js`). Icon buttons with codes and tooltips: Approve/Deny (when `awaitingApproval`), Interrupt (Esc), Pause/Resume, Send…, Restart, Kill (opens the kill dialog at lane level), Budget (set-budget popover), Retire (when ready). Each calls `act(fkey, action, args)` (§1 `core/actions.js`) after §4's `confirmAction`. The file starts as §4 D6's stub `renderActionBar(el, ctx)`; C14 owns it from then on. Buttons are disabled with the reason in the tooltip when a capability is missing.
- **Broadcast dialog** (`public/js/ui/broadcast.js`). Target picker (current selection, or a filter: builder/state/repo), text area, live preview computed with the same `planBroadcast` (pure, shared as `public/js/core/broadcast-plan.js`, a copy owned by C8 that `test/broadcast.test.mjs` keeps behaviour-identical to the server logic on shared vectors), the skip list with reasons, and a typed count confirm ("type 7 to send to 7 lanes").
- **Kill dialog** (`public/js/ui/killswitch.js`). Scope radio lane/builder/fleet. Builder scope lists the victims (lanes) and offers opt-in checkboxes for non-lane sessions. The typed confirm is the lane name, the builder id, or `fleet`. During grace and undo it shows a countdown with an Undo/Cancel button.

## 3. Implementation tasks (dependency order)

| # | Task | Files owned | Done when |
|---|---|---|---|
| C1 | Config fragment `stateDir`, `approvals`, `budget` + validation. Deps X1, A1 | `server/config/control.mjs`, `test/config-control.test.mjs` | config tests green; defaults leave behaviour unchanged |
| C2 | Pause core + gate script. Deps none | `server/control/pause.mjs`, `deploy/hooks/gate.sh`, `test/pause.test.mjs` | pause tests green; `sh -n gate.sh`; gate fast path measured < 5 ms |
| C3 | Preview + approvals core. Deps none | `server/control/preview.mjs`, `server/control/approvals.mjs`, `test/approvals.test.mjs`, `test/preview.test.mjs` | tests green |
| C4 | Hook intake + token + v1 read + supersede (via `hooks.subscribe`). Deps C3, C1, O1, F5, F9 | `server/routes/approvals.mjs`, `server/control/token.mjs`, `test/approvals-route.test.mjs` | `curl` against a local server returns `''` on timeout and allow JSON after `approve` (the approve is sent as a `direct` request through the ingress listener with serve-like headers; the same approve on the local listener → 403 `remote-only`); a request with `tailscale-user-login` or via the ingress port → 403 empty; hooks tests green. REVIEW-REQUIRED (SR15) |
| C5 | Flag modules `paused`, `awaitingApproval`, snapshot key `approvals`. Deps C2, C3, C1, X1 | `server/flags/approval.mjs`, `server/flags/paused.mjs`, `test/flags-control.test.mjs` | flags appear in the snapshot; attention treats awaitingApproval as permission |
| C6 | Handlers pause/resume/approve/deny/release + their module. Deps C2, C3, C1, A6 | `server/control/handlers.mjs`, `server/routes/control.mjs`, `test/handlers.test.mjs` | handlers registered in §2's dispatcher; audited; `pause *` needs `confirm`; `approve`/`deny`/`release` from `local` → 403 `remote-only`, from `direct` → run; approve with an `approvalId` of another session → 409 and the approval stays pending; `resume` from `local` of a budget-paused session → 403 even with `override`, of an operator pause → runs. REVIEW-REQUIRED (SR16) |
| C7 | Budget + `set-budget` + snapshot key `budget`. Deps C1, C2, A6 | `server/control/budget.mjs`, `server/routes/budget.mjs`, `server/lanes/launch.mjs` (priority/budgetUsd: validate + record only), `test/budget.test.mjs` | budget tests green; launch tests green; `set-budget` registered `remoteOnly: true` (from `local` → 403); C7 exports `pause.kindOf`-based predicate used by C6's `resume`. REVIEW-REQUIRED (SR17) |
| C8 | Broadcast planner + hub action + client copy. Deps H8, A6 | `server/control/broadcast.mjs`, `server/hub/broadcast.mjs`, `server/hub/routes/broadcast.mjs`, `public/js/core/broadcast-plan.js`, `test/broadcast.test.mjs` | tests green (incl. client/server parity); the hub-local `broadcast` from `local` → 403 `remote-only`. REVIEW-REQUIRED (SR18) |
| C9 | Kill switches (builder all-handler, fleet kill with undo). Deps C2, A6, H8 | `server/control/killswitch.mjs`, `server/routes/killswitch.mjs`, `server/hub/fleetkill.mjs`, `server/hub/routes/fleetkill.mjs`, `test/killswitch.test.mjs` | victim selection never includes non-lane / `_laneboard*`; cancel within grace works (fake timers); fleet undo within 10 s sends `resume *` and no kill; `kill *` from `local` or with `confirm:'fleet'` on a builder → 403/400; the fleet kill sends each builder its own id as `confirm`; skipped builders are listed by name. REVIEW-REQUIRED (SR19) |
| C10 | Installer rewrite. Deps O1, C2, C4 | `deploy/install-claude.sh`, `deploy/hooks.json.tmpl` (replaces `deploy/hooks.json`, keeping O1's events plus the sync gate and `PermissionRequest` command hooks), `deploy/hooks.json` (deleted; update any reference in `docs/`/tests in the same task), `test/installer.test.mjs` | test runs the script with `HOME=<tmpdir>` over fixtures: foreign hooks preserved, idempotent, uninstall restores |
| C11 | CLI pause/resume/paused. Deps C2, A9 | `bin/laneboard`, `test/cli-pause.test.mjs` | `laneboard pause --all` with the server stopped creates the sentinel; `laneboard resume` leaves a `kind:'budget'` sentinel in place and prints the remote-only hint |
| C12 | Launch dryRun + hello fields `repos`/`permissionModes` + capability `launch`. Deps C7, F9, A6 | `server/lanes/launch.mjs` (dryRun), `server/routes/launch-caps.mjs`, `test/launch-dryrun.test.mjs` | a dry-run launch returns a plan without a record; launch tests green; hello lists `repos` |
| C13 | Inbox model + view. Deps D4, D3, D8, F8a | `public/js/core/inbox-model.js`, `public/js/views/inbox.js` (replaces D4's stub), `test/inbox-model.test.mjs` | pure tests green; manual check in the browser; the approvals group header carries a `title`/aria note "Approvals, pause, budget and kill are cooperative on the builder: an agent with a shell there can bypass them" (security review S7) |
| C14 | Action bar, broadcast dialog, kill dialog, launch form. Deps D6, D3, C8, F5 | `public/js/ui/actionbar.js`, `public/js/ui/broadcast.js`, `public/js/ui/killswitch.js`, `public/js/ui/launch.js`, `test/actionbar.test.mjs` | `test/frontend-safety.test.mjs` stays green; actionbar model disables buttons with a reason when the capability is missing |
| C15 | Docs + runbook. Deps C6, C9, C10 | `docs/fleet/control.md` | hygiene test green; the doc has a "Cooperative controls" section (what an agent with a shell on the builder can bypass: tmux `send-keys` to its own dialog, sentinel `rm`, editing `gate.sh`/settings, faking the statusline cost file), the remote-only list, and the optional Bash-sandbox hardening as a HUMAN item |

C2, C3 start at once; C1 after X1; C4-C7 after C1-C3 and §2 A6; C8/C9 after §3 H8; C12-C14 after §2/§4 pieces as listed. The global DAG is in README.md.

## 4. Tests

- **`test/approvals.test.mjs`:**
  - `open` creates a pending entry with a truncated input and escapes nothing itself (plain text kept);
  - `decide(allow)` resolves `wait` with the exact `hookOutput` JSON (`hookEventName:'PermissionRequest'`, `decision.behavior:'allow'`);
  - deny carries `message` and `interrupt`;
  - a second decide → 409; unknown id → 404;
  - timeout → `wait` resolves null, status `timeout`, `hookOutput` `''`;
  - `onTimeout:'deny'` gives deny JSON;
  - `release` → `''` immediately;
  - `supersede(sessionId)` closes the pending ones;
  - **fail-open**, against a real `http.createServer` on port 0: the gate curl command with an unused port exits 0 with empty stdout in < 1.5 s, and so does a server that accepts but never answers within `-m 2`;
  - route auth: a request with a `tailscale-user-login` header or a wrong token → 403, empty body.
- **`test/preview.test.mjs`:** Edit gives -/+ lines; Write on a missing file gives all +; a path outside cwd is not read; the caps hold.
- **`test/pause.test.mjs`:**
  - pause/resume/list on a tmp stateDir; `ALL` vs session; invalid names rejected; the directory is removed when empty; `syncMirrors` writes and deletes `sid-*`;
  - **gate script** run via `spawnSync('sh', [gate], {input, env:{LANEBOARD_STATE_DIR}})`:
    - no dir → exit 0, empty output;
    - `ALL` + PreToolUse → JSON with `permissionDecision:'deny'` and `continue:false`;
    - UserPromptSubmit → `decision:'block'`;
    - `sid-` match;
    - unpaused session while another is paused → empty;
    - malformed stdin with no sentinel → exit 0, empty; malformed stdin while `paused/ALL` exists → exit 2;
    - ceiling exceeded (fixture status JSON in a fake HOME) → deny.
- **`test/budget.test.mjs`:** `limitsFor` precedence (override > record > config); `evaluate` levels at 79/80/100%; first-crossing warn only once per window; over → a pause with `kind:'budget'`; operator resume refused without override (and from `local` refused even with override: remote-only); `set-budget` raise lifts the pause; ceilings math; quota guard pauses only `priority:'low'` and auto-resumes only `kind:'quota'`.
- **`test/broadcast.test.mjs`:** `planBroadcast` skips `waiting_permission`, `waiting_question`, `awaitingApproval`, paused, dead, unknown; confirmCount mismatch → refused with the fresh plan; rate limit; text and target caps; the builder-side `guardPrompt:true` (§2 A6's `send-text`, tested here through a stubbed dispatcher) refuses when the local state is prompting even though the hub plan said send.
- **`test/killswitch.test.mjs`:** `selectVictims` = lane sessions + explicit include only, never `_laneboard*`; grace then kill order (pause before kill); cancel within grace.
- **`test/installer.test.mjs`:** fixture settings with a foreign PreToolUse hook and an existing statusLine; install twice → foreign hook byte-identical, our entries present once, backup exists; uninstall → foreign hooks only, empty events dropped.
- **`test/inbox-model.test.mjs`:** grouping, ordering, and key → action mapping bound to the focused id.

## 5. Risks, open questions, HUMAN checks

- **Cooperative controls (accepted residual, security review S7).** remote-only closes the local-API path, but an agent with unsandboxed code execution on its builder can still answer its own native dialog with `tmux send-keys`, delete pause sentinels, edit `gate.sh` or `~/.claude/settings.json`, or fake the statusline cost file. Optional hardening, HUMAN/phase 2 (setting names unverified on 2.1.301): launch `default`-mode lanes with Claude Code's Bash sandbox, deny writes to `~/.local/state/laneboard`, `~/.claude`, `~/.config/laneboard`, the laneboard checkout and the tmux socket dir and network to the laneboard ports; put the hook entries in root-owned managed settings. Real separation needs a separate uid for laneboard (phase 2).
- HUMAN: on 2.1.301, confirm that a held PermissionRequest hides the dialog until the hook returns, and that empty output then shows the dialog. Test: install, run a lane in `default` mode, trigger `Bash(rm x)`, approve from the inbox, then let one time out with `holdSec: 30`.
- HUMAN: confirm `continue:false` from PreToolUse stops the turn and that `resume` with "continue" picks up cleanly. If `continue:false` misbehaves, drop it: the deny with a reason alone still halts tools.
- HUMAN: confirm that the `Notification(permission_prompt)` timing does not flip the state to `waiting_permission` while we hold (harmless if it does).
- Lanes launch with `--permission-mode auto` by default (`launch.mjs:160`), so the approval queue mainly matters for `default`/`acceptEdits` lanes and ad-hoc sessions. Expected volume is low.
- **Gate latency:** a sync hook per tool call. The fast path is one `[ -d ]`. With a pause or ceiling present it costs ~10 ms (jq ×2 + tmux). Acceptable; measure in C2.
- `updatedPermissions` from `permission_suggestions` with `destination:"localSettings"` would write `.claude/settings.local.json` into the worktree, which shows as untracked and blocks retire's clean check (`retire.mjs:45`). Phase-2 "always allow" must use a session-scoped destination (HUMAN: verify one exists) or store rules in laneboard and auto-answer.
- Budget accuracy depends on cost snapshots and statusline freshness. Ceilings can overshoot by one tool call.
- A builder that is compromised can lie about state to defeat the broadcast guard. That only affects its own lanes, which matches the trust model.
- The fleet-kill undo window lives in the hub's memory. A hub restart mid-window cancels the kill, which is intended.

## 6. Dependencies

- **§1/§2/§11 X1 (fleet core, auth, dispatcher, audit, module loader, flags, fragments):** handlers plug into the v1 action table (`registerAction`, `registerAllHandler`), and `user`/audit come from there. The hook intake is `local`-only by design (§2.2 of this section).
- **§3 (relay, placement):** `registerHubAction`, the `builder:'*'` fan-out, `placement.rank` for `builder: null`.
- **§4 (UI shell/components):** `confirmAction`, `core/commands.js`, `ui/inspector` slot for the action bar, `ui/sheet` for dialogs, tokens and icons; §1 `core/actions.js` `act()`.
- **§6:** the stale-branches list; **§10:** `reviewReady` and `renderReviewQueue`.
- **§7:** `hooks.subscribe` (O1), alarms from `snap.budget`/approvals (O8), push for approvals and budget warnings (O9).

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
