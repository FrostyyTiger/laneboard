# Configuration

laneboard reads its configuration from three layers, each winning over the one
before it:

1. **Defaults** — the generic values in `server/config.mjs`. They are not one
   host's settings: with no config file at all, laneboard is a board of every
   session and every worktree on the machine, with every provider off.
2. **The file** — `~/.config/laneboard/config.json`, or whatever
   `LANEBOARD_CONFIG` points at. A missing file is not an error. A malformed
   one is fatal: laneboard refuses to start and names the file and the line.
3. **The environment** — `LANEBOARD_*`. A variable that is set wins; one that
   is unset changes nothing, so the environment can override a single key of a
   config file without replacing it.

Nothing derived is configurable: the paths under `$HOME`
(`~/.claude`, `~/.cache/laneboard/status`), the paths under the checkout
(`data/`), and the poll intervals are computed after the merge.

A minimal file:

```json
{
  "publicUrl": "https://board.example.invalid:8443",
  "repos": [{ "name": "acme" }]
}
```

## Keys

### The server

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `port` | `7777` | `LANEBOARD_PORT` | The HTTP port. |
| `bind` | `["127.0.0.1"]` | `LANEBOARD_BIND` | Addresses to listen on. **Loopback is the design**: laneboard has no login and can type into terminals. Anything that exposes it has to authenticate in front of it. |
| `publicUrl` | `http://127.0.0.1:7777` | `LANEBOARD_PUBLIC_URL` | Where a browser reaches it. Used for the Web Push VAPID subject, and for the "needs HTTPS" hint on the notification button — Web Push needs an https origin. |
| `hostname` | the system's (`os.hostname()`) | `LANEBOARD_HOSTNAME` | The label next to the brand in the header, and the Map's title (its core node's name) when the topology file has no `title` or there is no topology file. |
| `human` | `the human` | `LANEBOARD_HUMAN` | What a kickoff prompt calls the person it reports to. |
| `timezone` | the system's | `LANEBOARD_TIMEZONE` | Used by the Morning and Credit windows. |
| — | — | `LANEBOARD_DB` | The SQLite file. `:memory:` for a scratch instance; the test suite sets it. |
| — | — | `LANEBOARD_CONFIG` | The config file itself. `npm test` points this at `test/fixtures/empty-config.json` so the suite never reads the machine's own. |

### Where things live

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `codeDir` | `~/code` | `LANEBOARD_CODE_DIR` | Where main checkouts live, and where a lane's worktree is made beside them as `<repo>-<lane>`. Also what `GET /api/dirs` offers. |
| `lanesDir` | `~/lanes` | `LANEBOARD_LANES_DIR` | One directory per launched lane: its `lane.json` and the kickoff prompt as sent. Never inside a worktree — an untracked file there would show the lane as dirty. |
| `kickoff` | `templates/kickoff.md` | `LANEBOARD_KICKOFF` | The prompt template a launch renders. A repo may name its own. |
| `nodeBin` | `/usr/bin` | `LANEBOARD_NODE_BIN` | Where `node` is, for the rendered systemd unit. |
| `claudeBin` | `~/.local/bin/claude` | `LANEBOARD_CLAUDE_BIN` | The Claude Code binary a launch starts. |

**Lane ids** need no configuration. A lane's worktree is named `<repo>-<lane>`
beside the repo it came from, so the id is the basename with the name of its
main checkout stripped: with `~/code/acme` checked out, `~/code/acme-bauplan`
is the lane `bauplan`. The main checkouts are whatever directories in `codeDir`
are git repositories, re-read on the 60 s pass, plus the ones `repos` names. A
main checkout keeps its own name: it is not a lane of anything.

### `repos`

The repos lanes are launched from. The first is the default when `launch` is
given no `--repo`. Empty is fine — the board still shows every session and
every worktree; only `launch` needs this.

```json
"repos": [
  { "name": "acme" },
  { "name": "acme-web", "kickoff": "/home/user/kickoff-web.md", "markers": { "need": "NEED-DESIGN" } }
]
```

| Field | What |
| --- | --- |
| `name` | The directory name of the main checkout under `codeDir`. |
| `kickoff` | A template for this repo's lanes, instead of the global one. |
| `markers` | Extra marker patterns this repo's lanes print, merged into the global ones. |
| `ci` | `{provider: "gh" \| "none", repo?: "owner/name", collect?: true}` or `null`: per-repo CI for the Packages view. The legacy core `ci.repo` keeps working. |
| `packages` | `[{name, paths: [globs], jobs?, workflow?, plans?}]`: the repo's packages. Unset: detected (see `packages.autodetect`). |
| `global`, `ignoreJobs` | CI job names that belong to every package, and job names to ignore. |
| `base` | The ref this repo's lane diffs are taken against (`origin/<branch>` or a commit sha); default `review.base`. |
| `scripts` | `{name: command}`, at most 12: the **only** commands the `run-script` action may run, from this file only (no env layer). Names match `^[a-z][a-z0-9-]{0,23}$`; a command is one line of at most 500 characters. |

`LANEBOARD_REPOS` takes a comma-separated list of names. The `ci`, `packages`,
`global` and `ignoreJobs` fields are explained in
[fleet/packages.md](fleet/packages.md); `base` and `scripts` in the review
section below.

### `slots` — a private database per lane

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `slots.provider` | `none` | `LANEBOARD_SLOTS_PROVIDER` | `none` or `agent-stack`. With `none`, `launch` and `retire` refuse before touching anything. |
| `slots.bin` | `~/code/agent-stack/agent-stack` | `LANEBOARD_AGENT_STACK` | The external script the `agent-stack` provider calls. |
| `slots.laneSlots` | `[2, 3, 4]` | `LANEBOARD_LANE_SLOTS` | The slots lanes may take. Their count is the ceiling on active lanes. |
| `slots.reservedSlots` | `[1]` | `LANEBOARD_RESERVED_SLOTS` | Slots a lane must never take. Shown on the Box as reserved. |

### `guard` — keeping agents off something live

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `guard.provider` | `none` | `LANEBOARD_GUARD_PROVIDER` | `none` or `ports`. |
| `guard.forbiddenPorts` | `[]` | `LANEBOARD_GUARD_PORTS` | Ports no session of ours may reach. **Preventive**: a `DATABASE_*` URL on one of them in a session's `/proc/<pid>/environ` is `danger`. **Detective**: an established connection to one of them in `ss -Htnp` is `danger`, with the pid, the command and the tmux session. |
| `guard.healthProbes` | `[]` | — | `[{ "name": "api", "url": "http://127.0.0.1:8000/health" }]` — shown on the Box. HTTP GETs, nothing else. |
| `guard.containerFilter` | `""` | `LANEBOARD_GUARD_CONTAINERS` | A `docker ps --filter name=` prefix whose containers are listed on the Box. Empty collects no container list at all. |
| `guard.platformRepo` | `""` | `LANEBOARD_PLATFORM_REPO` | The checkout whose test suites fall back to a shared database when no `DATABASE_*` is set. A session working there with none is `danger`, even when no port is forbidden. |

The guard flags and pushes. It never acts: no container is stopped, no session
is killed, nothing is written.

### `ci` — pull requests and the queue

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `ci.provider` | `none` | `LANEBOARD_CI_PROVIDER` | `none` or `gh`. |
| `ci.repo` | `""` | `LANEBOARD_CI_REPO` | The repo whose `gh run list` is the CI queue on the Box. |

`gh` uses whatever login the person running laneboard has. Not logged in is a
state with a back-off, not an error.

### `map` — the Map view

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `map.file` | `~/.config/laneboard/map.json` | `LANEBOARD_MAP_FILE` | The topology: sites, rooms, services, links, probes. Missing is fine. |
| `map.feedsDir` | `~/.cache/laneboard/feeds` | `LANEBOARD_MAP_FEEDS` | Where other machines drop their snapshots. Read only. |
| `map.feedStaleMs` | `300000` | — | A feed older than this, or 3x its own interval, shows as no data. |
| `map.probeEverySec` | `60` | — | The default interval of a node's HTTP probe; at least 15. |
| `map.policyFile` | `null` (none) | `LANEBOARD_MAP_POLICY` | A Tailscale policy file (HuJSON) the Reach overlay reads; laneboard never fetches a policy. |

The file formats are in [map.md](map.md).

### `markers` — what a lane shouting for help looks like

```json
"markers": { "need": "NEED-HUMAN|NEED-ALEX", "done": "STAGE-DONE|LANE-DONE" }
```

| Kind | Default | Meaning |
| --- | --- | --- |
| `need` | `NEED-HUMAN|NEED-OWNER` | A lane wants a person. |
| `blocked` | `BLOCKED` | A lane cannot continue. |
| `done` | `STAGE-DONE|LANE-DONE` | A lane finished something. |
| `progress` | `PROGRESS` | A lane got somewhere. |
| `limit` | `hit your limit|usage limit|rate limit|approaching your .{0,20}limit` | A rate-limit window is closing. |

Every kind but `limit` is **anchored**: it must start the line, after an
optional bullet or quote prefix. That is what stops a lane's own prompt, which
quotes the markers inside backticks, from registering as a marker. `limit` is
prose in the middle of a sentence, so it is matched unanchored and
case-insensitively instead.

A kind you invent is a kind that works: add it to `markers` (or to a repo's
`markers`) and it is collected, pushed and shown like any other. `danger`
comes from the guard and `blocked` also from red CI checks; neither is
configured here.

## Fleet keys

Everything below came with fleet mode ([fleet.md](fleet.md)). The keys live in
config fragments, `server/config/<area>.mjs`, one per feature area, and follow
the same three layers. Every default leaves a standalone builder as it was:
with no `fleet` block and no `mode`, nothing here changes behaviour.
`node scripts/check-config-docs.mjs` (run by `npm test`) fails when a fragment
key is missing from this page.

### `mode`

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `mode` | `builder` | `LANEBOARD_MODE` | `builder` (today's board, next to the agents) or `hub` (the fleet view over many builders: no tmux, no sessions, no collectors). `both` is refused: run two processes. |

### `fleet` — identity

Details: [fleet/identity.md](fleet/identity.md).

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `fleet.id` | the hostname (`os.hostname()`, not `hostname`), sanitized: lowercased, every run of other characters turned into `-`, cut to 24; `builder` if nothing is left | `LANEBOARD_FLEET_ID` | This builder's id, `^[a-z0-9-]{1,24}$`, e.g. `builder-a`. It prefixes every fleet key (`builder-a/web`). Refused, never rewritten, when it does not match. |
| `fleet.code` | `""` (derived from the id: `builder-a` → `BA`) | `LANEBOARD_FLEET_CODE` | The 2-3 character tag the UI shows, `^[A-Z0-9]{2,3}$` after uppercasing. |
| `fleet.allowedOrigins` | `[]` | `LANEBOARD_ALLOWED_ORIGINS` (comma list) | Exact extra browser origins allowed on upgrades and mutating routes. `https`, or `http` on loopback only. Never same-site matching. A hub may not list a builder's origin. |

### `fleet` — auth and ingress (builder and hub)

Details: [fleet/auth.md](fleet/auth.md) and [install.md](install.md#fleet-mode).
"A fleet block" means a `fleet` key in the config file. Unknown keys under
`fleet` are refused, and so are `__proto__`, `constructor` and `prototype` at
any depth.

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `fleet.ingressPort` | `7778` with a fleet block on a builder, else `null`; no default on a hub | `LANEBOARD_INGRESS_PORT` | The second loopback listener, the one `tailscale serve` targets. Mandatory with a fleet block (an explicit `null` is refused) and in hub mode. Must differ from `port`. |
| `fleet.hubKeys` | `[]` | — | Pinned hub public keys, at most 16. A bare string (`ed25519:<base64>` or PEM SPKI) may only **read**; `{key, id, scopes}` gets exactly `scopes` ⊆ `read`, `control`, `term`, always with `read`. Setting one also turns `push.local` (auto) off and stops this builder reading map feeds. |
| `fleet.hubControl` | `false` | — | Master switch: while off, a signed hub request may only read; actions and terminals answer 403 `control-disabled` whatever the scopes. |
| `fleet.hubAddrs` | `[]` | — | IP literals the hub's `X-Forwarded-For` must be one of (`[]`: not checked). |
| `fleet.ingressPeerUid` | `null` | — | The uid `tailscaled` runs as; every ingress connection must come from a socket that uid owns. Linux only. Optional on a builder, **required on a hub** (on Linux). |
| `fleet.allowedUsers` | `[]` | — | Tailscale logins allowed as `direct` users (`[]`: any login serve stamps). |
| `fleet.publicHosts` | the host of `publicUrl` when that is not loopback | — | `Host` values (with port) allowed on the ingress listener. |
| `fleet.enforce` | `true` whenever an ingress listener opens, else `false` | — | Refuse unidentified ingress. An explicit `false` with an ingress port is refused unless `fleet.insecureNoEnforce` is set; a hub refuses both. |
| `fleet.insecureNoEnforce` | `false` | — | Test-rig escape hatch for the above: unidentified ingress acts as `direct`. Logged loudly at every load. Never set it on a real box. |
| `fleet.clockSkewMs` | `60000` | — | Accepted signature timestamp skew, 1000..120000. |
| `fleet.allowedPermissionModes` | `["default", "acceptEdits", "plan", "auto"]` | — | Permission modes a v1 `launch` or `spawn` may use; the default leaves out `bypassPermissions` and `dontAsk`. |
| `fleet.rateLimits` | `{}` | — | Per-action overrides `{<action>: {limit?, windowMs?, per?}}` of the built-in limits (e.g. `send-text` 30/min per target, `kill` 5/min per user, `launch` 3/min, `all` 1 per 10 s); 429 `rate_limited` with `retryAfterMs`. |
| `fleet.audit.maxBytes` | `10485760` (10 MiB) | — | Rotate the fleet audit log past this size. Rotated files are never deleted. |
| `fleet.legacyBrowserRoutes` | `true` | — | Keep the pre-v1 browser routes (audited through the dispatcher). Flip to `false` once nothing uses them. |
| — | — | `LANEBOARD_AUDIT_FILE` | The audit log, not a config key: `$LANEBOARD_AUDIT_FILE`, else `$XDG_STATE_HOME/laneboard/audit.jsonl`, else `~/.local/state/laneboard/audit.jsonl`. Must be absolute. |

### `fleet` — the hub's builders (hub only)

Details: [fleet/hub.md](fleet/hub.md). A builder ignores these keys.

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `fleet.builders` | `[]` | `LANEBOARD_FLEET_BUILDERS` (`id=url,id=url`) | `[{id, url, code?, directUrl?, account?, repos?}]`, 1 to 64 on a hub. `url` is `https` (plain `http` only on loopback) with no credentials, path, query or fragment. `directUrl` is what a browser opens for that builder's own UI (default `url`). `account` groups builders on one subscription (default `default`). `repos` is the placement allowlist: the hub places a lane for repo R only on builders that list R. |
| `fleet.hubKeyFile` | `$XDG_CONFIG_HOME/laneboard/hub.key`, else `~/.config/laneboard/hub.key` | — | The hub's Ed25519 signing key (`laneboard fleet keygen`). The hub refuses to boot if it is missing, group/other readable, foreign-owned or in a directory others can write. |
| `fleet.staleMs` | `15000` | — | No frame for this long: the builder shows `stale`. Must be below `fleet.downMs`. |
| `fleet.downMs` | `60000` | — | No frame for this long: `down`. |
| `fleet.batchMs` | `250` | — | Hub to browser delta batching window. |
| `fleet.pingMs` | `5000` | — | Upstream ping cadence (latency, liveness). |
| `fleet.actionTimeoutMs` | `15000` | — | A relayed action's timeout; then "sent, outcome unknown". |
| `fleet.maxTermsPerBuilder` | `8` | — | Proxied terminals per builder. |
| `fleet.placement.minFreeMemMb` | `4096` | — | Placement gate: a builder with less free memory is not eligible. |
| `fleet.placement.maxSwapFrac` | `0.5` | — | Placement gate: a builder using this share of swap or more is not eligible. |
| `fleet.placement.any` | unset (`false`) | — | `true` lets placement pick a builder that has no `repos` list. Read at run time; without it such a builder never gets placed work. |

### `stateDir`, `approvals`, `budget` — control

Details: [fleet/control.md](fleet/control.md). Every default leaves behaviour
unchanged: the queue falls through to the terminal prompt on timeout, no cap
is set and the quota guard is off.

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `stateDir` | `$XDG_STATE_HOME/laneboard`, else `~/.local/state/laneboard` | `LANEBOARD_STATE_DIR` | Pause and ceiling sentinels and the hook token. Absolute (or `~/`); a relative path is only accepted from the env. |
| `approvals.enabled` | `true` | — | Hold `PermissionRequest` hooks for a remote decision. `false`: every request goes to the terminal at once. |
| `approvals.holdSec` | `600` | — | How long a request is held, clamped to 30..1800. |
| `approvals.onTimeout` | `prompt` | — | `prompt` (the normal dialog) or `deny` when the hold expires. |
| `approvals.previewMaxLines` | `300` | — | Lines of the diff/command preview, 1..5000. |
| `approvals.maxBodyBytes` | `262144` (256 KiB) | — | Largest hook body read; clamped to 1 KiB..1 MiB. Read at run time. |
| `approvals.maxInFlight` | `16` | — | Hook intakes being read at once; clamped to 1..64. Read at run time. |
| `budget.window` | `tonight` | — | The spend window: `12h`, `tonight`, `24h`, `7d`. |
| `budget.perLaneUsd` | `null` | — | Default cap per lane in USD (`null`: none). A launch may only lower it, unless remote. |
| `budget.perBuilderUsd` | `null` | — | Cap for the whole builder. |
| `budget.warnPct` | `80` | — | Warn at this share of a cap (1..100, at most `budget.pausePct`). |
| `budget.pausePct` | `100` | — | Pause at this share of a cap (1..1000). Nothing is killed. |
| `budget.quota.enabled` | `false` | — | The quota guard: pause `priority: "low"` lanes near the 5-hour limit. |
| `budget.quota.fiveHourPct` | `90` | — | Pause above this 5-hour window use. |
| `budget.quota.resumeBelowPct` | `70` | — | Below this, lift (with `budget.quota.autoResume`) or raise `quota-resumable`. Must be below `budget.quota.fiveHourPct`. |
| `budget.quota.autoResume` | `false` | — | Lift `quota` pauses by itself. |

### `stuck` — the stuck detector

Each builder flags sessions that look stuck. It only shows a badge and raises
the session in the attention queue; nothing auto-pauses unless you say so. No
env layer for this or the next two blocks.

| Key | Default | What |
| --- | --- | --- |
| `stuck.enabled` | `true` | Run the detector. |
| `stuck.autoPause` | `false` | Pause a session when one of `stuck.autoPauseRules` matches. |
| `stuck.autoPauseRules` | `["tool-loop", "error-loop"]` | Rules that may auto-pause: any of `approval-wait`, `error-loop`, `tool-loop`, `oscillation`, `stalled`, `context-pressure`, `cost-no-progress`, `idle-in-working`. |
| `stuck.approvalWaitMin` | `5` | `approval-wait`: a permission request unanswered this long. |
| `stuck.errorLoopCount` | `3` | `error-loop`: the same error (by hash) this many times among the last 20 events… |
| `stuck.errorLoopWindowMin` | `15` | …within this many minutes. |
| `stuck.toolLoopCount` | `5` | `tool-loop`: the same tool with the same input this many times in a row within a turn. |
| `stuck.oscillationRepeats` | `3` | `oscillation`: the last tool calls alternate between two (A, B) this many times. |
| `stuck.stalledMin` | `10` | `stalled`: working with no hook event this long… |
| `stuck.stalledToolMin` | `30` | …or this long with a tool call in flight (at least `stuck.stalledMin`). |
| `stuck.contextPct` | `85` | `context-pressure`: context use above this percentage… |
| `stuck.compactMin` | `20` | …or compactions less than this many minutes apart. |
| `stuck.costWindowMin` | `30` | `cost-no-progress`: over this window… |
| `stuck.costUsd` | `5` | …this much spent with the progress fingerprint unchanged. |
| `stuck.idleMin` | `20` | `idle-in-working`: a launched lane with no `LANE-DONE` whose session is idle or done this long. |

### `health` — box health

The 10 s builder health sampler (`/api/v1/health`, the Box view). Read-only:
`/proc`, `statfs`, an optional GET on the Docker socket and an optional
`tailscale status` once a minute.

| Key | Default | What |
| --- | --- | --- |
| `health.sampleMs` | `10000` | Sample interval (at least 1000). |
| `health.historyMin` | `60` | History ring length in minutes. |
| `health.dockerSocket` | `/var/run/docker.sock` | Docker API socket for unhealthy-container counts; `null` skips Docker. |
| `health.dockerRoot` | `/var/lib/docker` | Filesystem measured for Docker; `null` skips it. |
| `health.worktreeDir` | `null` (= `codeDir`) | Filesystem measured for worktrees. |
| `health.tailscale` | `true` | Read `tailscale status` (online and backend state only). |
| `health.thresholds.<key>.warn` | per key, below | Raise `health-warn` at this value (held for 2 samples). |
| `health.thresholds.<key>.crit` | per key, below | Raise `health-crit`; `null` means the key only warns. |

| `<key>` | `warn` | `crit` | Worse when |
| --- | --- | --- | --- |
| `swapInPerSec` | `50` | `500` | higher (pages swapped in per second) |
| `memAvailPct` | `15` | `5` | lower |
| `psiMemFull10` | `5` | `20` | higher (memory pressure, full, 10 s avg) |
| `psiIoFull10` | `10` | `30` | higher |
| `psiCpuSome10` | `50` | `80` | higher |
| `loadPerCpu` | `1.5` | `3` | higher |
| `fsUsedPct` | `85` | `95` | higher |
| `dockerUnhealthy` | `1` | `null` | higher (containers) |
| `rebootRequired` | `true` | `null` | the flag is set |

### `push`, `notify`, `alarms` — notifications

| Key | Default | What |
| --- | --- | --- |
| `push.local` | `null` (auto) | Whether this builder sends its own web pushes. `null`: on while `fleet.hubKeys` is empty, off once a hub key is pinned (the hub notifies instead). `true`/`false` force it; set `true` during a rollout until hub push works. |
| `push.allowedEndpointHosts` | `fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com` | Hub only: push services a subscription endpoint may point at (`https`, port 443). Host names, `*.domain` for subdomains; invalid entries are dropped with a warning. Read at run time. |
| `notify.kinds.<kind>` | on for `needs-input`, `approval`, `failed`, `review`, `stuck`, `builder-down`, `danger`; off for the rest | Hub notifications per alarm kind. The kinds: `danger`, `builder-down`, `budget-exceeded`, `audit-fork`, `approval`, `needs-input`, `blocked`, `failed`, `stuck`, `health-crit`, `ci-red-main`, `builder-stale`, `health-warn`, `ci-red`, `conflict`, `review-overdue`, `review`, `budget-warn`, `reboot`. Users override them per device in the hub's Notification settings. |
| `notify.quietHours` | `null` | `{from: "HH:MM", to: "HH:MM"}` in `timezone`, may cross midnight. Held notifications show in Morning. |
| `notify.quietBypass` | `["danger", "builder-down"]` | Kinds that notify during quiet hours anyway. |
| `alarms.evalMs` | `1000` | Alarm evaluation throttle (at least 100). |
| `alarms.historyDays` | `30` | How long alarm history (raised, cleared, acked) is kept where no event table holds it (the hub). |

### `packages`, `plans` — the Packages view

Details: [fleet/packages.md](fleet/packages.md). No env layer.

| Key | Default | What |
| --- | --- | --- |
| `packages.autodetect` | `true` | Detect packages (workspaces, pyproject, Cargo, CLAUDE.md dirs) when a repo configures none. |
| `packages.mainRef` | `origin/main` | The ref lanes and CI are compared against. |
| `packages.branchWindowDays` | `14` | Remote branches with no newer commit are not considered. |
| `packages.maxBranches` | `40` | Per repo, newest first (1..500); caps the pairwise conflict pass. |
| `packages.fetch` | `none` | `none` (refs as they are) or `mirror` (a laneboard-owned bare mirror under `packages.cacheDir`). |
| `packages.fetchEverySec` | `300` | Mirror fetch interval (at least 30). |
| `packages.cacheDir` | `$XDG_CACHE_HOME/laneboard/git`, else `~/.cache/laneboard/git` | Mirrors and scratch objects. Absolute or `~/`. |
| `packages.ciEverySec` | `120` | Per-repo CI poll interval (at least 30). |
| `packages.staleDays` | `7` | A branch with no commit for longer is stale. |
| `packages.staleBehind` | `50` | A branch further behind main is stale. |
| `plans.globs` | `["docs/plans/**/*.md"]` | Plan files. |
| `plans.statusLine` | ``^\*\*Plan status:\*\*\s*`?([A-Z][A-Z-]+)`` | A regular expression; its first capture group is the state word. |
| `plans.states.open` | `["OPEN", "READY", "PROPOSAL", "IN-PROGRESS"]` | Words meaning open. |
| `plans.states.partial` | `["PARTIAL"]` | Words meaning partial. |
| `plans.states.done` | `["DONE", "SUPERSEDED", "DECIDED"]` | Words meaning done. |
| `plans.states.deferred` | `["DEFERRED"]` | Words meaning deferred. |

### `review`, `transcript` — the review workflow

No env layer: review settings and `repos[].scripts` come only from the config
file.

| Key | Default | What |
| --- | --- | --- |
| `review.overdueHours` | `4` | A finished lane waiting longer for its first human review raises `review-overdue`. |
| `review.base` | `origin/main` | The ref lane diffs are taken against; per repo `repos[].base`. |
| `review.inlineMaxChars` | `7000` | Above this, `send-review` writes the review to a file and sends its path (at most 8000). |
| `review.diff.maxFiles` | `300` | Diff cap: files. |
| `review.diff.maxBytes` | `2097152` (2 MiB) | Diff cap: total bytes. |
| `review.diff.maxFileBytes` | `262144` (256 KiB) | Diff cap: bytes per file (at most `review.diff.maxBytes`). |
| `review.diff.maxFileLines` | `4000` | Diff cap: lines per file. |
| `review.diff.maxUntracked` | `200` | Untracked files included. |
| `review.diff.timeoutMs` | `15000` | `git diff` timeout (at least 1000). |
| `review.generated` | `["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.lock", "*.min.js", "*.map"]` | Globs whose diff is deferred until asked for. |
| `review.postToGitHub` | `false` | Reserved (phase 2). |
| `transcript.tailMaxBytes` | `1048576` (1 MiB) | Bytes read from the end of a transcript (at least 4096). |
| `transcript.maxEntries` | `200` | Entries per transcript page. |
| `transcript.textCap` | `4000` | Characters kept per entry. |

### `runs` — the Runs view

Where laneboard finds run event files (the protocol is [runs.md](runs.md)).
No env layer: `LANEBOARD_RUN_FILE` is where the `laneboard run` CLI writes, not
what the server reads. With no config, the only run files read are the lanes'
own `.laneboard/run.jsonl`, and a machine without any shows no runs.

| Key | Default | What |
| --- | --- | --- |
| `runs.files` | `[]` | Globs of `run.jsonl` files to read, e.g. `["~/runs/*/run.jsonl"]`. Absolute or `~/`, no `..`, at most 64. |
| `runs.lanes` | `true` | Also read `<lane cwd>/.laneboard/run.jsonl` for every lane. |
| `runs.maxEvents` | `5000` | Events kept per run, newest kept (100..100000). |
| `runs.keepDays` | `30` | A run whose last event is older is forgotten (1..3650). |
