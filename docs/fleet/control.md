# Fleet control: approvals, pause, budgets, broadcast, kill switches

This page is for the operator. It covers the controls laneboard adds on top of
watching lanes: holding permission prompts for a remote decision, pausing,
budget caps and the quota guard, broadcast, the kill switches, the hook
installer, and an out-of-band runbook for when laneboard itself cannot act.
Who counts as `local`, `direct` or `hub` is explained in the fleet auth docs
(`docs/fleet/auth.md`); the hub itself in `docs/fleet/hub.md`.

Read [Cooperative controls](#cooperative-controls) first. **Every guard on a
builder is cooperative against an agent that has a shell on that builder.**
The remote-only rules close the local-API path; they do not stop a process
running as the same uid from editing files.

## Remote-only actions

Refused with 403 `remote-only` for `local` callers (anything on the builder:
the CLI, hooks, scripts, agents). Allowed for a `direct` user through serve,
and for a signed hub request whose key has the `control` scope with
`fleet.hubControl: true`. On the hub, every action needs `direct`.

| Action | Why it is remote-only |
| --- | --- |
| `approve`, `deny`, `release` | an agent must not answer its own permission request |
| `set-budget` | an agent must not raise its own cap |
| `kill *` (builder kill switch, and its `cancel`) | an agent must not trigger or cancel a builder-wide kill |
| `resume` with `override: true` | lifts any kind of pause |
| `resume` of a target held by a `budget` or `quota` pause | only an operator lifts those |

`resume` decides by predicate: it reads the sentinel of the target and of the
builder-wide `ALL` scope. A `budget`/`quota` kind, or a sentinel it cannot
read as a known kind (truncated, oversize, not a regular file, not JSON), makes
it remote-only. If the state dir is not configured, the check fails closed.

A target `*` (`pause *`, `resume *`, `kill *`, `set-budget *`) needs
`args.confirm` equal to this builder's `fleet.id`. A builder never accepts
`confirm: "fleet"`; the hub checks the typed `fleet` and rewrites it to each
builder's id when it fans out.

## Approval queue

Claude Code's `PermissionRequest` hook is a synchronous `curl` to
`POST /api/hook/permission` on `127.0.0.1`. laneboard **holds** the request
and shows it in the inbox; the agent waits until someone decides, the hold
expires, or the request ends some other way.

### What gets held

The intake accepts a request only when all of these hold; anything else is
answered with an empty 403 and nothing is opened:

- the request is `local`, came from a loopback address, and not on
  `fleet.ingressPort`;
- it carries no serve or proxy header (`Tailscale-*`, `X-Forwarded-*`,
  `Forwarded`, `X-Real-IP`) and no `Origin`;
- `X-Laneboard-Hook` equals the token in `<stateDir>/hook.token` (mode 0600,
  created by the installer), compared in constant time.

Bounds: at most `approvals.maxInFlight` (default 16) requests being read at
once, a body of at most `approvals.maxBodyBytes` (default 256 KiB), and at
most 200 pending approvals. Beyond any of these the request gets an empty 4xx
and falls through to the terminal.

Each approval shows the session, lane, tool, a one-line summary, the tool
input cut to 4 KB, a preview (diff for Edit/Write, the command for Bash) and
the permission suggestions. All of it is agent text and is rendered as text.

### Fail-open to the terminal prompt

The hook is `curl -sf ... || true`. Every non-2xx answer and every empty 200
means "no decision", and Claude Code then shows its normal dialog in the pane.
So when laneboard is down, overloaded, has no token, or refuses the request,
the agent is never stuck: you answer at the terminal as before.

| What happens | Approval status | The agent sees |
| --- | --- | --- |
| `approve` | `allowed` | the tool runs |
| `deny` (optional `note`, optional `interrupt`) | `denied` | "Denied by &lt;user&gt; via laneboard: &lt;note&gt;"; with `interrupt`, the turn stops |
| `release` | `released` | the normal dialog in the pane, to answer there |
| hold expires, `approvals.onTimeout: "prompt"` (default) | `timeout` | the normal dialog |
| hold expires, `approvals.onTimeout: "deny"` | `timeout` | a deny: "no decision within N s" |
| you answered at the terminal, or Claude Code cancelled the hook | `abandoned` | (the curl connection closed) |
| the tool ran, the turn ended or a new prompt came in for that session | `superseded` | (answered elsewhere) |

The hold is `approvals.holdSec` (default 600 s, clamped to 30..1800). The
installer sets curl's `-m` to `holdSec + 5` so the server's own timeout answer
still arrives. The queue lives in memory: a laneboard restart drops every held
curl, which is "no decision", so the dialogs appear in the panes.

`approvals.enabled: false` turns the queue off: the intake answers an empty
200 at once and every request goes to the terminal.

### Remote-only decisions

`approve`, `deny` and `release` are actions (`POST /api/v1/actions` on the
builder, `POST /api/fleet/actions` on the hub) with `args.approvalId` and the
session as target. They are remote-only. A decision whose target is not the
approval's session is refused 409 and the approval stays pending. A decision
on an approval that is already closed is 409; an unknown id is 404.

`release` is the "show the dialog at the terminal" decision: laneboard steps
aside without allowing or denying.

## Pause and resume

A pause is a **sentinel file** under the state dir (`stateDir`, default
`$XDG_STATE_HOME/laneboard`, else `~/.local/state/laneboard`;
`LANEBOARD_STATE_DIR` wins):

```
<stateDir>/paused/ALL            builder-wide pause
<stateDir>/paused/<sessionName>  one session
<stateDir>/paused/sid-<id>       mirror keyed by Claude session id (rewritten every tick)
<stateDir>/ceiling/sid-<id>      budget ceiling: statusline cost at which the session stops
```

Each sentinel holds `{"kind", "by", "at", "reason"}`. The empty directories
are removed so the gate's fast path stays one `stat`.

The gate (`~/.claude/laneboard/gate.sh`, a `PreToolUse` and
`UserPromptSubmit` hook) blocks a session while `ALL`, its `sid-` mirror or
its session-name sentinel exists, or while its statusline cost has reached its
ceiling. It runs without laneboard: a pause holds even when the server is
down. If nothing matches it exits 0 silently (fail open); if a sentinel
matches but the hook input cannot be parsed, it exits 2, which blocks (fail
closed while paused). It needs `jq`.

### Kinds

| Kind | Written by | Lifted by |
| --- | --- | --- |
| `operator` | `pause` action, `laneboard pause`, the kill switches | `resume` (any caller), `laneboard resume` |
| `budget` | the budget tick, when a cap is reached | `set-budget` (re-evaluates and lifts what no longer applies), or a remote `resume` with `override` |
| `quota` | the quota guard | the guard itself (`autoResume`), or a remote `resume` |

A pause never downgrades: writing an `operator` pause over a `budget` pause
keeps the `budget` kind, so a plain resume cannot lift a budget hold by the
back door. A budget pause written over an operator or quota pause remembers
it and restores it when the budget pause is lifted.

### Actions

- `pause <session>` / `pause *` with optional `reason` and `interrupt: true`
  (sends Escape to the session, or to every lane session for `*`).
- `resume <session>` / `resume *` with `nudge` (default true: a session that is
  unpaused, done or idle and at a ready prompt gets `continue` typed) and
  `override`.
- Without `override`, and always for `local`, `resume` lifts only
  `operator` sentinels. A budget or quota hold left in place answers 409
  (`over-budget`: "raise it with set-budget or pass override"; `held` for
  quota).
- `resume *` removes only the `ALL` sentinel; per-session pauses stay.
- Session names `ALL`, `sid-*` and names starting with `.` are reserved (400
  `bad_target`); the builder scope is reachable only as target `*`.

### Override marks

A remote `resume` with `override` that lifts a `budget` pause records an
**override mark** for that scope and the current budget window. While the mark
is valid, the budget tick does not re-apply the pause and drops that session's
(for `ALL`, the builder's) ceiling until the window ends. Marks expire with
their window, and `set-budget` on a scope forgets its marks (a new decision).

A budget sentinel that disappears **without** a mark (someone ran `rm`) is
re-applied at the next tick, with its ceiling, and audited as
`budget-sentinel-missing`.

### The CLI (works with the server down)

```sh
laneboard pause <name>             # or: laneboard pause --all   [--reason "text"]
laneboard resume <name>            # or: laneboard resume --all  (operator pauses only)
laneboard paused [--json]          # list the sentinels
```

These write the sentinel files directly. The state dir is resolved as the
server resolves it (`LANEBOARD_STATE_DIR`, else `stateDir` from the config
file, else the default). `laneboard resume` refuses to lift a budget or quota
pause and says so; that is lifted from the UI.

## Budget caps and the quota guard

Config (`budget` block; every default leaves behaviour unchanged):

| Key | Default | Meaning |
| --- | --- | --- |
| `window` | `tonight` | spend window: `12h`, `tonight`, `24h`, `7d` |
| `perLaneUsd` | `null` | default cap per lane (`null`: none) |
| `perBuilderUsd` | `null` | cap for the whole builder |
| `warnPct` | `80` | warn at this share of the cap |
| `pausePct` | `100` | pause at this share of the cap |
| `quota` | `{enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false}` | the quota guard |

Lane cap precedence: a `set-budget` override, then the lane record's
`budgetUsd` (from launch), then `perLaneUsd`. A record's `budgetUsd` can only
**lower** the config default unless the launch was remote. Spend is attributed
to the lane whose record names the session, so a `cd` moves nothing.

Every 30 s the budget tick evaluates each capped lane and the builder:

- **warn** (`>= warnPct`): one `budget`/`warn` event per scope and window;
- **over** (`>= pausePct`): a `kind: "budget"` pause on every live session of
  the lane (for the builder cap: `ALL`). Nothing is killed;
- **ceilings:** `ceiling/sid-<id>` is the statusline cost at which the session
  reaches the remaining budget, so the gate stops it at its next tool call even
  if laneboard has died. With several sessions on one lane each sees the whole
  remainder, so a lane can overshoot until the next tick pauses it.

`set-budget` (remote-only, tier ask) takes a lane id or `*`, `usd` (a number,
or `null` to drop the override), and `window` (only with `*`, which needs
`confirm`). It re-evaluates at once and lifts budget pauses that no longer
apply.

**Quota guard** (opt-in, `budget.quota.enabled: true`). It reads this
builder's latest rate-limit sample (ignored when older than 30 minutes, unless
its 5-hour window already reset). Above `fiveHourPct` it writes `kind:
"quota"` pauses on sessions of lanes launched with `priority: "low"` that are
not already paused. Below `resumeBelowPct` it lifts only `quota` sentinels when
`autoResume` is on, and otherwise raises a `quota-resumable` alarm once. Rate
limits are per account, so each builder acts on its own sample; the hub only
displays.

Automatic pauses and lifts (`budget-pause`, `budget-lift`, `quota-pause`,
`quota-resume`, `budget-override`) are appended to the fleet audit log.

## Broadcast

Broadcast types one text into many lanes across the fleet. It is a hub-local
action (`POST /api/fleet/actions` on the hub, `action: "broadcast"`, target
`*`, builder `null` or `*`), so it needs a `direct` user.

Args are exactly `{targets, text, enter?, confirmCount, planHash?}`: at most
30 targets (fleet keys `builder-a/<session>`), text at most 2000 characters,
one accepted broadcast per user per 10 s.

### Plan, planHash, confirm

1. The first request (no `planHash`) is answered 409 `plan-required` with
   `result: {plan, preview, confirmCount, planHash}`. `plan` is
   `{send: [key], skip: [{key, reason}]}`; `preview` is exactly the text that
   will be typed (control characters removed; with `enter: false` newlines
   become spaces).
2. The confirmed request repeats the args with that `planHash` and
   `confirmCount` equal to the number of planned sends.
3. The hub replans from its current view. If the plan, the text or the Enter
   flag changed, it answers 409 `plan-changed` with the fresh plan; a wrong
   count is 409 `confirm-mismatch`; no lane sendable is 409
   `nothing-to-send`. Nothing is sent on any refusal.

`planHash` is the SHA-256 over the sorted send list, the Enter flag and the
SHA-256 of the typed text, so a confirmation binds what you saw, not just a
count. More than 30 refused requests per user per minute get 429
`too-many-refusals`.

### Skipped vs failed

A **skip** is a lane laneboard decided not to type into; a **failure** is a
send that went wrong.

Skip reasons in the plan: `invalid` (not a fleet key, or a `_laneboard*`
session), `duplicate`, `builder-down` (not up, or a major version skew),
`unknown` (session not known, or a state that is not `working`, `done` or
`idle`), `dead`, `shell`, `prompting` (permission prompt, question, held
approval, or a dialog visible in the pane preview), `paused`.

The live-Claude guard: each planned lane gets its own signed `send-text` with
`guardPrompt: true`, and the **builder** re-checks against its own current
state before typing: the session must have a pane, be a live Claude session
(not a shell), not be paused, and show the ready input box (or be `working`;
Claude Code queues input). Anything it cannot confirm is refused 409; a
`prompting` refusal lands in `skipped`, every other error in `failed`
(with `outcome: "unknown"` when the send timed out).

The result is `{id, sent, skipped, failed, preview}`. The hub audit entry
records the counts and the first keys of each list, never the text.

## Kill switches

| Level | Request | Effect |
| --- | --- | --- |
| lane | `kill <session>` | kills that tmux session (exact `=name` target) |
| builder | `kill *` with `{confirm: <builder id>, graceMs?, include?}` | pause, interrupt, then kill after the grace |
| builder cancel | `kill *` with `{confirm, cancel: <job>}` | within the grace: no kill, the pause stays |
| fleet | hub: `kill`, builder `*`, target `*`, `{confirm: "fleet"}` | pause the fleet, 10 s undo, then kill |
| fleet undo | the same with `{confirm: "fleet", cancel: <fleetJob>}` | resume, no kill |

### Builder kill switch (`kill *`)

Remote-only. Steps (each recorded as a job step, kind `killall`):

1. Write the builder-wide `ALL` operator pause and send Escape to every victim.
2. After `graceMs` (default 10 000, at most 600 000; `0` kills at once), take
   the victim list again from the live inventory (a lane launched during the
   grace is included) and kill each one. The kills are audited as `kill.done`.

**Victims** are the live Claude agents (a pane running `claude`, a versioned
native Claude binary, or a session the registry knows by pid) that **either**
are bound to an active lane record (the lane id and `session` that launch
wrote) **or** run in a linked git worktree (a `.git` file pointing at
`<repo>/.git/worktrees/<name>`). So `spawn`ed agents, lanes without a
`lane.json` and agents started by hand in a worktree are stopped too. Never a
victim by that rule: shells and other non-Claude panes, and anything whose
working directory is a main checkout (a `.git` directory: your own checkout,
the hub, a dotfiles repo), whatever runs there. Sessions you name in
`include` (at most 50; they must exist in the live inventory) are killed
whatever they run. Never killed, whatever `include` says: `_laneboard*`
sessions (and the configured `ownSessionPrefixes`) and the session laneboard
itself runs in. Names in `include` that will not be killed are returned as
`notIncluded`. `kill.done` audits the counts, a SHA-256 of the name lists and
the first names that fit.

**Cancel** with `{confirm, cancel: <job>}` inside the grace. The principal
that started the job may cancel it (same kind and user; for the hub, the same
key), and so may any other `direct` user; such an override is audited
(`kill.cancel`) with both users. A hub key that did not start the job gets 403
`not-owner`. An unknown job is 404
`unknown-job`, one past its grace 409 `too-late`. The `ALL` pause stays after
a cancel: you decide when to resume.

The grace timer lives in the laneboard process. A restart (or shutdown) inside
the grace drops the kill and leaves the builder paused: it fails safe.

### Fleet kill with 10 s undo (hub)

A `direct` user on the hub types `fleet`. The hub never sends `fleet` on:
every builder gets its own id as `confirm`.

- **t = 0:** `pause *` with `interrupt` to every `up` builder. Builders that
  are not up (or have a version skew) are skipped and named. If the pause
  reached no builder, the job fails and nothing is killed; builders the pause
  did not reach are listed in `pauseIncomplete` and never get the kill.
- **t = 0..10 s:** the undo window, in hub memory. Undo (`cancel`) sends
  `resume *` and nothing is killed. Builders that answer the resume 429 (their
  `*` rate limit is still held by the pause) get one fresh resume after
  10.5 s and stay paused until then. Undo while the pause is still going out
  answers 202 `cancelling`.
- **t = 10 s:** `kill *` with `graceMs: 0` to every builder the pause reached.
  Each builder applies its own victim rules above. A builder that answers 429
  gets one fresh kill after 10.5 s.

The start may carry `include`: up to 50 fleet keys (`<builder>/<session>`)
the builders' own rule would miss. A malformed key refuses the request (400,
nothing sent); a key for an unknown builder or session is not sent and comes
back in `notIncluded`. Each builder's kill carries only its own names, and a
builder the pause did not reach gets none (`not-paused`). Any `direct` user
may undo; an undo by someone else than the starter is audited (`kill.undo`)
with both users. A newer fleet kill suspends the older jobs' pending retries
(and re-arms them if it fails), so a stale undo can never resume the fleet
during a later kill.

One fleet kill at a time: a second start while one is active is 409
`active-job`. An undo after the kill went out is 409 `too-late`. If the hub
dies inside the window, the kill never happens and the fleet stays paused.

## The hook installer

`deploy/install-claude.sh` wires `~/.claude` to laneboard: the event hooks,
the `PermissionRequest` hold, the pause gate and the status line.

```sh
deploy/install-claude.sh --dry-run                 # print the settings diff, change nothing
deploy/install-claude.sh                           # install or re-install
deploy/install-claude.sh --uninstall [--dry-run]   # remove laneboard's entries
deploy/install-claude.sh --uninstall --statusline  # also drop our status line
```

- **Your own hooks are preserved.** The merge is per event: only entries
  marked as laneboard's (a command or url that posts to
  `127.0.0.1:<port>/api/hook...` or runs something under
  `.claude/laneboard/`) are replaced. Two guards run before anything is
  written: nothing outside `.hooks` and `.statusLine` changed, and every other
  hook entry and group is identical before and after. If either fails, nothing
  is written and it exits 1.
- `settings.json` is backed up first to `~/.claude/backups/` (a symlinked
  settings file is written through, not replaced). An existing `.statusLine`
  is never replaced; the sidecar is appended to an existing status-line script.
- The template is rendered from the laneboard config (port, `stateDir`,
  `approvals.holdSec`). `gate.sh` is copied to `~/.claude/laneboard/` (0755),
  and the hook token is created in the state dir.
- `--dry-run` writes nothing: no backup, no token, no copies.
- `--uninstall` strips laneboard's entries, drops events left empty, removes
  `~/.claude/laneboard/` and the status-line sidecar. `.statusLine` is left
  alone unless `--statusline` is given and it points at
  `~/.claude/statusline-command.sh` (the script is deleted only if it is our
  unmodified copy).
- Re-running is a no-op apart from a fresh backup. It needs `jq`.

Restart running Claude sessions to pick up new hooks.

## Cooperative controls

These controls hold against the local API, and against agents that follow the
rules. They do **not** hold against an agent that runs arbitrary commands as
the same uid on the builder. Such an agent can:

- answer its own native permission dialog with `tmux send-keys` to its own
  pane, bypassing the approval queue;
- delete pause sentinels (`rm <stateDir>/paused/*`) or ceiling files. A
  deleted budget sentinel is re-applied at the next tick, but an operator or
  quota pause is simply gone;
- edit `~/.claude/laneboard/gate.sh` or `~/.claude/settings.json` to remove the
  gate and the hooks;
- fake its statusline cost file (`~/.cache/laneboard/status/<id>.json`) so the
  ceiling never fires;
- read the hook token and post to the intake (it can open approvals, never
  decide them);
- rewrite and re-chain the builder's audit log (the hub's anchors catch a
  rewrite behind an anchor; see the fleet auth docs);
- survive a kill switch, for example by starting processes outside tmux.

What remote-only buys you: nothing on the builder can approve, deny, release,
raise a budget, lift a budget or quota pause, or trigger a builder kill
**through laneboard's API**. The boundary laneboard enforces is between
machines.

**HUMAN / phase 2: optional Bash sandbox.** Real separation needs laneboard
under its own uid. Until then, possible hardening (setting names unverified on
the installed Claude Code version; a wrong setting could silently block every
lane, so test it on one lane first): launch `default`-mode lanes with Claude
Code's Bash sandbox; deny writes to `~/.local/state/laneboard`, `~/.claude`,
`~/.config/laneboard`, the laneboard checkout and the tmux socket directory;
deny network access to the laneboard ports; put the hook entries in
root-owned managed settings.

## Runbook: out-of-band kill

Use this when laneboard cannot act: the hub is down, the builder's server is
down or wedged, or every action is refused (for example 503
`audit-unavailable`).

1. **Get a shell on the builder:** `ssh builder-a` (or `tailscale ssh
   builder-a`).
2. **Pause everything:** `laneboard pause --all`. It writes the `ALL`
   sentinel directly and works with the server down. Every Claude session
   stops at its next tool call or prompt.
3. **List the sessions:** `tmux ls`.
4. **Kill each lane:** `tmux kill-session -t '=<name>'`, one per lane. The `=`
   matters: without it tmux falls back to a name *prefix* match when no
   session has exactly that name, so `-t lane-a` can kill `lane-a-2`. Leave `_laneboard*` sessions and the session you are
   typing in alone.
5. **If the box is wedged:** `pkill -f '/claude '` stops the agents.
   Note that `systemctl --user stop laneboard` does **not** stop agents: it
   stops the board, and the Claude sessions keep running in tmux.
6. **Last resort:** the VM console, or stop the VM from the hypervisor.

Afterwards, when the board is back: check `laneboard paused`, decide what to
resume, and resume from the UI (`laneboard resume --all` lifts only the
operator pause).

### Audit repair: a corrupt audit line blocks actions

The dispatcher refuses to run any action it cannot audit, and the audit writer
refuses to extend a chain that does not verify. So a corrupt line in the
builder's audit log (`$LANEBOARD_AUDIT_FILE`, else
`$XDG_STATE_HOME/laneboard/audit.jsonl`, else `~/.local/state/laneboard/audit.jsonl`)
makes every action fail with 503 `audit-unavailable`. Pausing with the CLI
still works (step 2 above); to repair:

1. `laneboard audit verify`. It exits 1 and names the file, the line and the
   reason (`bad_json`, `prev_mismatch`, `hash_mismatch`, `ts_regressed`).
   A single line cut short by a crash is only a `torn` warning and does not
   block anything.
2. Stop the server: `systemctl --user stop laneboard`.
3. Move the bad file aside, do not delete it:
   `mv ~/.local/state/laneboard/audit.jsonl ~/.local/state/laneboard/audit.jsonl.bad-$(date -u +%Y%m%dT%H%M%SZ)`
   (use the path `audit verify` printed). Keep it for the investigation.
   Rotated files stay where they are; the new chain does not reference them.
4. Start the server: `systemctl --user start laneboard`. It begins a fresh
   chain from genesis. `laneboard audit verify` should now say `ok`.

**What that does to the hub's reconciliation.** The hub trusts a builder's log
only up to its last `audit.anchor` of that builder's head. A fresh chain no
longer contains the anchored head, so at the next pull (every 60 s, and when
the builder comes back up) the hub raises an `audit-fork` alarm for that
builder. The alarm is sticky, across hub restarts too, and the anchor does not
move until a human accepts the new chain. After checking that the reset was
yours, rebase from the hub as a `direct` user. `POST
/api/fleet/audit/rebase` takes `{builder, confirm, onto?}`: `confirm` must be
the builder id typed out (anything else is 400 `confirm` and nothing moves), and
`onto` is `genesis` (the default, for a fresh chain) or `head` (re-anchor on
the builder's current verified head). A `local` caller on the hub box gets 403
`remote-only`.

```sh
curl -X POST https://hub.example.invalid/api/fleet/audit/rebase \
  -H 'content-type: application/json' -H 'X-Laneboard: 1' \
  --data '{"builder":"builder-a","confirm":"builder-a","onto":"genesis"}'
```

The UI has no rebase button yet: the hub's Audit view shows the fork alarm
and the reconciliation state, the rebase is this request. The hub writes a `rebased` `audit.anchor`, logs who rebased, and
from the next pull it anchors and matches the new chain. `GET /api/fleet/audit?builder=builder-a` shows the
reconciliation state. Hub-relayed actions that were never pulled from the old
file can now show as `missing-on-builder`; check them against the file you
moved aside.
