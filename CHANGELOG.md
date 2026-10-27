# Changelog

## Unreleased

**Fleet mode.** Several builders behind one hub. Every machine that runs
agents keeps its own laneboard (a builder); a separate laneboard in
`mode: "hub"` shows and drives all of them, and each builder keeps working on
its own when the hub is down. With no `fleet` block and no `mode`, a builder
behaves exactly as before. See docs/fleet.md.

- **Ingress and identity.** A `fleet` block opens a second loopback listener
  on `fleet.ingressPort` for `tailscale serve`, and every request is
  classified as `local`, `direct` (a Tailscale user) or `hub` (a valid
  signature) by the listener it arrived on. Unidentified ingress is refused
  (fail closed, also when only `LANEBOARD_INGRESS_PORT` set the port); the
  main port accepts loopback peers only, strips every `Tailscale-*` header,
  and refuses requests serve still forwards there once a fleet block exists.
  Optional `fleet.ingressPeerUid` (required on a hub on Linux),
  `fleet.allowedUsers` and `fleet.hubAddrs`.
- **Signed actions.** Ed25519 hub keys (`laneboard fleet keygen|pubkey`),
  pinned on builders in `fleet.hubKeys` with per-key scopes (`read`,
  `control`, `term`; a bare string is read-only) behind the
  `fleet.hubControl` master switch. Reads, action envelopes and terminal
  envelopes are signed in headers only, bound to the builder id, and cannot
  be replayed, across restarts too.
- **One dispatcher for every action.** Server-side confirmation tiers, strict
  argument allowlists, `fleet.allowedPermissionModes` for launch and spawn,
  per-user and per-target rate limits (`fleet.rateLimits`), and an audit entry
  for each, refusals included. Remote-only actions (`approve`, `deny`,
  `release`, `set-budget`, `kill *`, lifting a budget or quota pause) are
  refused from the local API, so an agent cannot wave itself through.
- **The audit log.** A hash-chained, rotating log per builder
  (`laneboard audit [verify]`, offline), one writer only, recovering from a
  stale lock and refusing a moved or replaced file. Fleet actions refuse to
  run when it cannot be written. The hub anchors each builder's chain head,
  reconciles relayed actions with the builder's entries across restarts,
  raises `audit-fork` when a log is rewritten, and accepts a new chain only
  through `POST /api/fleet/audit/rebase` with the builder id typed to confirm.
- **API v1 on builders.** `/api/v1/hello` (with launchable repos and
  permission modes), `/api/v1/snapshot`, a stamped, resyncable
  `/api/v1/stream`, `POST /api/v1/actions` with dry-run launches, jobs, audit,
  health, diff, transcript tails, pane previews, Morning, packages and the
  archive.

**The hub.** One UI over the fleet: a merged live view on its own `/ws`
(batched deltas, previews only for sessions on screen), builders `stale` and
`down` by configurable timings, relayed signed actions, proxied terminals and
an allowlisted signed read proxy. Placement only puts a lane on builders the
hub config lists for that repo. Fleet-wide Credit, Morning (by builder, with
review waits, stuck incidents, approvals answered, cost per package and held
notifications), Packages (marking runs where builders disagree) and archive
search. Alarms derived across the fleet raise web push with per-kind toggles,
quiet hours and muted sessions; push only goes to known push services
(`push.allowedEndpointHosts`). Control on the hub is remote-only: every
action, terminal, rebase and notification setting needs a `direct` user. The
hub never loads `node-pty`, refuses `fleet.enforce: false` and
`insecureNoEnforce`, refuses unsafe key files, and bounds the memory, frame
rate and resync cost one builder can cause.

**Control.**
- **Approvals.** Permission prompts of default-mode lanes can be held in an
  approval queue with a diff preview and answered from laneboard; anything
  else (timeout, laneboard down, a refused or oversized request) falls back
  to the terminal dialog. The intake bounds its memory (256 KiB bodies, 16
  concurrent intakes).
- **Pause.** Pause and resume a session or the whole builder; a synchronous
  hook gate blocks tool calls and prompts while paused or over a budget
  ceiling. `laneboard pause|resume|paused` work with the server down. A
  session named `ALL` or a corrupt or hand-deleted pause file can no longer
  lift a pause.
- **Budgets.** Caps per lane and per builder pause sessions at the limit
  after a warning; `set-budget` raises or lowers them remotely, a local
  launch can only lower them, and a `cd` no longer moves a lane's spend. An
  opt-in quota guard holds low-priority lanes near the 5-hour limit.
- **Broadcast.** One message to many lanes from the hub, after a typed count
  confirmation bound to the exact plan previewed; lanes at a prompt, paused
  or not running Claude are skipped, and outcomes are audited.
- **Kill switches.** Kill every Claude agent of a builder (launched lanes,
  spawned agents and agents started by hand in a worktree, plus sessions you
  name) after a 10 s cancellable grace, or the whole fleet from the hub with a
  10 s undo window. Shells, main checkouts and laneboard's own sessions are
  never killed.
- **Hooks.** `deploy/install-claude.sh` merges per event instead of replacing
  your own hooks, gains `--dry-run` and `--uninstall`, and registers new
  events (tool failures, permission requests, subagents, compactions, API stop
  failures). Re-run it on each builder.

**Observability.** Sessions report effort, thinking, prompt cache and API
time. A stuck detector flags tool loops, repeated errors, oscillation,
stalls, context pressure, cost without progress and idle lanes, and raises
them in the attention queue. Builders sample box health (CPU, memory, swap,
pressure, disks, Docker) every 10 s. Alarms are derived on the hub and on a
standalone builder and can be acknowledged; acks survive a restart. A builder
attached to a hub leaves phone notifications to the hub (`push.local`).

**Packages.** A Packages view over every package of every repo: per-package
CI on main (a green job whose work steps were all skipped counts as not run),
untested commits, the lanes and branches touching it (including remote-only
branches and an optional laneboard-owned bare mirror), PRs, predicted textual
conflicts with a merge-order hint, stale branches and plan status. Packages
are detected automatically when a repo configures none. The `gh` provider
reads per-job CI, the API budget and a PR's first human review, also with a
fine-grained token.

**Review.** Lanes carry a review-ready flag with diff stats, touched packages
and live cost; the hub measures how long they wait for a first review and
flags waits over 4 hours. A Diff view with light syntax highlighting batches
line comments into one review sent to the lane's session (typed only into a
live, ready Claude session, never a shell, a paused session or a dialog), and
the Pull popover offers shell-quoted checkout commands. Lanes can run their
repo's configured scripts in a background tmux window. Retired lanes are kept
in a searchable archive and can be restored under a new lane id. The
inspector's PEEK tab pages through the transcript tail and has a guarded
reply box.

**A new shell.** The Map is the home view in an industrial look (grey
baseline, safety-orange accent, JetBrains Mono and Barlow Condensed): a header
with view nav, scope chips and a UTC/local clock, a builder rail, a 360 px
inspector for the selected lane, an annunciator with eight alarm tiles, and a
live event tape. New views Inbox, Packages and Audit; the Board draws each
lane as a fixed-column data block with a cards/rows toggle; Credit, Box and
Morning cover the fleet. Keyboard-first: `⌘K` command palette, `g` chords for
every view (`g m` map, `g b` board, `g i` inbox, `g p` packages, `g o`
morning, `g c` credit, `g x` box, `g a` audit), `[` `]` and `1`-`9` for
builders, `n`/`N` for alarm lanes, `\` to split the Map, `?` for help. On a
phone, a builder chip strip and a draggable bottom sheet replace the tab bar.
The Map gains overlays (status, CI, cost, context, age), builder nodes,
touch/conflict/package/CI links, pinch zoom, a minimap on every other view,
and a split lane table; its old side panels are gone. Card previews are
rendered in the browser from raw terminal text. Deep links
`#/board?sel=<builder>/<session>` open a session's terminal. A component kit
lives at `/dev/kit.html`, and the UI ships a vendored Lucide icon sprite
(ISC).

**Hardening.** Mutating routes require an `X-Laneboard: 1` header, every
request's `Host` (with port) must match the board's own addresses, Host-less
or duplicate-Host requests and cross-origin requests and upgrades are
refused, `OPTIONS` answers 405, and pages, the service worker and SVG files
carry a strict CSP. A missing static file is a 404, not the dashboard. The
board ignores oversized or malformed builder data and never opens a terminal
for a session named `.` or `..`. CLI output strips terminal escape sequences
from server text.

**Configuration.** New optional keys, all validated at start, with defaults
that change nothing: `mode`, `fleet.*` (identity, auth, the hub's builders,
timings and placement), `stateDir`, `approvals`, `budget`, `stuck`, `health`,
`push.local`, `notify`, `alarms`, `packages`, `plans`, `review`, `transcript`,
and per-repo `ci`, `packages`, `global`, `ignoreJobs`, `base` and `scripts`.
Unknown `fleet` keys are refused. docs/config.md documents every one, and a
test fails when a key is missing.

**Upgrading.** Re-run `deploy/install-claude.sh` on each builder, update old
copies of `bin/laneboard` (it sends the new `X-Laneboard` header), and when
you add a `fleet` block, point `tailscale serve` at `fleet.ingressPort` in
the same step. The rollout order is in docs/fleet.md. Stylesheets now live
under `public/css/`, and files under `public/vendor/` are served at
`/vendor/`. Internal: laneboard boots through a mode dispatcher with feature
modules, config fragments and state decorators, and the test kit gains an
isolated boot helper, an in-process fake builder and a shared fake DOM.

**The Map.** A new view (now the home view, `g m`): everything laneboard knows about, drawn as
one constellation. It has sites, rooms, services and lanes on rings, arcs for
what depends on what, CPU and memory gauges on every room, and a list of what
needs you. Every movement on it is an event. It is built from a private
topology file, snapshots that other machines push into a directory, and HTTP
probes; laneboard reaches out to nothing it watches. See docs/map.md.

**Map motion.** Every movement on the Map is now a critically damped spring,
so motion starts from its current speed and bends when you click again. Changes
play in beats (exits, moves, then entries one by one), nodes travel along their
rings, long jumps fly out and back in, drags glide, and the panel closes as
smoothly as it opens, with a line to the node it describes. Nodes can be
**folded** (`c`, or the `+N` badge) and folds are remembered.

**Services inside a guest.** A feed can list what runs inside a guest (CI
runners, say), each with its own status: `working` while busy, `idle` while
waiting. A topology node points at one with `feed: "hv1/104/runner-1"`. A
guest's own `alerts`, such as a full disk, now colour its room too.

**The Wall.** The Map for a screen nobody sits at (a tablet on a shelf, a wall
screen): `/galaxy.html` draws the fleet as one spiral galaxy in WebGL (three.js
r170, vendored under `public/vendor/three/`, MIT), the hub its sun, the sites
star clusters. It tours itself, trouble first, and says what it shows in big
type; a finger takes it over (turn, zoom, tap a site or a planet for its
sheet, back), and a minute later the tour takes it back. It marks a stale or
offline feed, honours reduced motion, installs as a full-screen app
(`/galaxy.webmanifest`), and takes the cockpit's show commands (`fly_to`,
`highlight`, `pin`, `clear`, undo) by `BroadcastChannel` or origin-checked
`postMessage` until it is a paired screen. Effects are opt-in (`?fx=`); a
browser without WebGL goes to `/wall.html`, the 2D Wall over the Map module.
It only reads: no new route, config or dependency. Feeds may carry `glow`,
`ring` and `countdown` for it, and an alert level `attention` (a person has
to act); a feed event's `link` now reaches the Map as a comet. The Map module
gained options for it, all off by default (`ambient`, `layout`, `covers`,
label sizing). `node test/tools/demo-fleet.mjs --size large` is a five-site
demo fleet. See docs/wall.md.

## 0.1.0 — 2026-09-23

First public release. Extracted from a private cockpit built for one host,
with a clean history: nothing that named that host, its people or its repos
came along, and a test keeps it that way.

**The board.** One page over every Claude Code session on a machine, grouped
into lanes — a lane being a git worktree with one branch, one plan and one
piece of work. Four views: Board (lane cards, sorted by what most needs a
person), Morning (what needs you, what finished, what it cost, over a window),
Credit (the 5 h and 7 d rate-limit windows, and spend per lane), Box (the
machine, the guard, the CI queue, the agent slots). Keyboard throughout; a
rail and a terminal dock above 2000 px.

**Lanes.** `launch` turns a plan pushed on a branch into a worktree, a venv, a
private database slot and an agent session whose environment is verified from
`/proc` before the kickoff prompt is typed. `retire` shows readiness and never
acts on it: it refuses a live session always, and a dirty or unmerged lane
without `--force` plus the lane id typed back.

**Terminals.** Every session reachable over a WebSocket-attached pty, pinnable
into a dock.

**Markers, push and cost.** The lines a lane prints when it wants something are
collected from hooks, the pane and watch logs, pushed to a phone as Web Push,
and shown first on the card. Cost is labelled API-equivalent, next to the
rate-limit windows that are the real constraint.

**Configuration.** One JSON file, every key optional, every key also an
environment variable; with no file at all laneboard runs a board of sessions
and terminals on any machine. Everything site-specific sits behind three small
provider interfaces — slots, guard, CI — each with a `none` implementation.

Node 24, one process, six dependencies, no build step. 394 tests.

Measured with ten sessions on the board: 105 MB RSS, 0.5 % CPU, hook latency
under a millisecond.
