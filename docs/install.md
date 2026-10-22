# Install

## What you need

| | |
| --- | --- |
| **Node 24 or newer** | `node --version`. laneboard is one process, ESM, `node:sqlite`. |
| **A C++ toolchain** | `node-pty` compiles: `build-essential` on Debian/Ubuntu, `base-devel` on Arch, the Command Line Tools on macOS. |
| **tmux** | Sessions are tmux sessions. laneboard reads them and can start them. |
| **`jq`** | Needed by `deploy/install-claude.sh`, the status-line script and its sidecar, and the pause gate hook. Without it the status line shows nothing and cost, context and rate-limit numbers stay empty. |
| **`gh`, logged in** | Only for the `gh` CI provider. Optional. |
| **`docker`** | Only for the `agent-stack` slot provider and the guard's container list. Optional. |

Everything after the first four is optional: with no providers configured,
laneboard is a board of every session and every worktree on the machine.

## Get it running

```bash
git clone https://github.com/<owner>/laneboard.git ~/code/laneboard
cd ~/code/laneboard
npm ci
npm test
node server/index.mjs      # http://127.0.0.1:7777
```

If that page loads, the rest is configuration and supervision.

## As a service

`bin/laneboardctl` renders `deploy/laneboard.service` into
`~/.config/systemd/user/laneboard.service`, enables it and starts it:

```bash
bin/laneboardctl start
bin/laneboardctl status       # supervisor, linger, health, what it listens on
bin/laneboardctl logs 100
bin/laneboardctl restart
ln -s "$PWD/bin/laneboard" ~/.local/bin/laneboard
```

The unit uses `%h` rather than an absolute home path, sets
`LANEBOARD_CONFIG=%h/.config/laneboard/config.json`, and restarts on failure.
`laneboardctl render` prints it without installing anything.

**Enable linger**, or the service stops when your last login session ends:

```bash
loginctl enable-linger "$USER"      # needs root on most systems
```

`laneboardctl status` tells you which way it is. Without `systemd --user`,
`laneboardctl start` falls back to a tmux session called `_laneboard`.

### The hooks and the status line

```bash
deploy/install-claude.sh --dry-run    # print the settings diff, change nothing
deploy/install-claude.sh
```

Additive changes to `~/.claude/`, with `settings.json` backed up first (to
`~/.claude/backups/`): a `hooks` block that POSTs each event to
`127.0.0.1:7777/api/hook` (so a session's state is known in milliseconds
rather than at the next poll), the pause gate (`~/.claude/laneboard/gate.sh`,
which blocks tool calls while a session is paused), and a status line that
mirrors its own stdin to `~/.cache/laneboard/status/` (so cost, context and
rate-limit numbers are readable without touching any Claude Code internals).
An existing `statusLine` is left alone and the sidecar is appended to it
instead. Hook entries that are not laneboard's stay exactly where they are.
The script refuses, and writes nothing, if the merge would have changed
anything else. Re-running it is a no-op apart from a fresh backup.

To take it out again:

```bash
deploy/install-claude.sh --uninstall --dry-run
deploy/install-claude.sh --uninstall [--statusline]
```

`--uninstall` strips laneboard's entries and `~/.claude/laneboard/`, and
leaves `.statusLine` alone unless you also pass `--statusline`.

The 5 h and 7 d rate-limit windows on the Credit view and in `laneboard credit`
come only from this status line: the board samples them once a minute from the
freshest session's sidecar file. Without it `laneboard credit` prints
`sampler: 0 samples, last never` and points here.

## The config file

`~/.config/laneboard/config.json`, every key optional. **`docs/config.md`
documents all of them.** A useful minimum:

```json
{
  "publicUrl": "https://board.example.invalid:8443",
  "repos": [{ "name": "acme" }],
  "ci": { "provider": "gh", "repo": "acme" }
}
```

The file names your hosts and repos, so it lives outside the checkout and is
never committed.

## HTTPS in front of it

**laneboard has no login** and can type into terminals that hold your keys.
The server binds `127.0.0.1` only, and whatever you put in front of it has to
be what decides who gets through. Read `SECURITY.md` before you expose it
anywhere.

Two examples. Any reverse proxy works; what matters is that it authenticates
and that it terminates TLS, because Web Push needs an https origin.

### Tailscale

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:7777
```

Reachable at `https://<host>.<tailnet>.ts.net:8443` from your own devices and
nowhere else. Set `publicUrl` to that URL.

This is the standalone setup. **In fleet mode serve targets the ingress port
instead** (`7778` by default, see below), never the main port.

Pick a port that is **not** shared with anyone else. If this node shares a
port with an outside collaborator through a node share, laneboard must not be
on it.

### Caddy

```caddy
board.example.invalid {
    # Whatever decides who gets through — client certificates, an SSO proxy,
    # forward_auth. Do not skip this part.
    tls /etc/ssl/board.crt /etc/ssl/board.key {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/ssl/clients.pem
        }
    }
    reverse_proxy 127.0.0.1:7777
}
```

WebSockets need no special configuration in Caddy; behind nginx, pass
`Upgrade` and `Connection` through for `/ws` and `/ws/term/`.

## Fleet mode

One **hub** shows and drives several **builders**. Every builder runs its own
laneboard next to its agents, exactly as above, plus a `fleet` block. The hub
is a separate laneboard process in `mode: "hub"` on a box of its own. Read
`SECURITY.md` ("Fleet mode: who may do what") first. The auth contract is in
`docs/fleet/auth.md`.

### On each builder

The config gets a `fleet` block:

```json
{
  "publicUrl": "https://builder-a.example.invalid:8443",
  "fleet": {
    "id": "builder-a",
    "code": "BA",
    "ingressPort": 7778,
    "hubKeys": ["ed25519:<the hub's public key>"],
    "hubControl": false
  }
}
```

- **`fleet.id`** names the builder in the fleet (`^[a-z0-9-]{1,24}$`, default:
  the sanitized hostname). **`fleet.code`** is the 2-3 character tag the UI
  shows (default: derived from the id). See `docs/fleet/identity.md`.
- **`fleet.ingressPort`** is a second loopback listener, the one
  `tailscale serve` targets. Every request on it is *ingress* and gets
  classified as a user or as the hub. It is **mandatory** with a `fleet`
  block: it defaults to `7778`, an explicit `null` is refused, and it must
  differ from `port`. `LANEBOARD_INGRESS_PORT` overrides it.
- With a `fleet` block, `fleet.enforce` is on: an ingress request that is
  neither a Tailscale user nor a valid hub signature gets 403. Turning it off
  is refused unless you also set `fleet.insecureNoEnforce`, which is for test
  rigs only.

Point serve at the **ingress port**, not at `7777`:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:7778
tailscale serve status
```

If serve still targets `7777` from a standalone install, move it. A request
that serve delivers to the main port looks like a process on this box: its
Tailscale identity is stripped, and anyone the tailnet lets in becomes
`local`.

Restart laneboard after every config change; the config is read at start.
The boot log shows `listening on http://127.0.0.1:7778 (ingress: tailscale
serve)`. Hooks, the status line and the `laneboard` CLI keep talking to
`7777` and stay `local`.

Optional keys, all of them defence in depth:

| Key | What |
| --- | --- |
| `fleet.ingressPeerUid` | The uid `tailscaled` runs as (`ps -o uid= -C tailscaled`, usually `0`). Every ingress connection must then come from a socket owned by that uid, so a local process cannot pose as serve. A failed lookup or a mismatch is 403 `not-from-serve`. Linux only. Off by default on builders; see accepted risk 3 in `SECURITY.md`. **Required in hub mode.** |
| `fleet.allowedUsers` | Tailscale logins allowed as users, e.g. `["you@example.invalid"]`. Empty: any login serve stamps. |
| `fleet.hubAddrs` | The hub's tailnet address(es) as IP literals (`tailscale ip -4` on the hub). A signed request whose `X-Forwarded-For` is not listed gets 403 `hub-addr`. |
| `fleet.allowedPermissionModes` | The permission modes a v1 `launch` or `spawn` may use. Default `["default", "acceptEdits", "plan", "auto"]`, which leaves out `bypassPermissions` and `dontAsk`. |
| `fleet.publicHosts` | Allowed `Host` values on ingress, with the port. Default: the host of `publicUrl`. |

### The hub key

On the hub, once:

```bash
laneboard fleet keygen                 # writes ~/.config/laneboard/hub.key (0600)
laneboard fleet pubkey                 # ed25519:<base64>, again
laneboard fleet pubkey --pem           # the same key as PEM SPKI
```

`keygen` refuses to overwrite an existing key unless you pass `--force`.
`--out <file>` writes it elsewhere; point the hub's `fleet.hubKeyFile` at it.
The private key never leaves the hub. Builders only ever see the public key.

### Pinning the hub key on builders

`fleet.hubKeys` is a list. An entry is either a **bare string** (the
`ed25519:` form or the PEM), which can only **read**, or an object with
explicit scopes:

```json
"hubKeys": [
  { "key": "ed25519:<the hub's public key>", "id": "hub", "scopes": ["read", "control", "term"] }
]
```

| Scope | Lets the hub |
| --- | --- |
| `read` | read hello, snapshot, the stream and the audit log. Every entry must have it. |
| `control` | relay actions (needs `fleet.hubControl: true` as well) |
| `term` | open terminals (needs `fleet.hubControl: true` as well) |

`id` is a label (`^[a-z0-9-]{1,32}$`, unique) that audit entries carry.
Unknown scopes, a missing `read`, a duplicate `id` or the same key twice are
refused at start.

**`fleet.hubControl`** is a master switch on the builder, default `false`.
While it is `false`, a signed hub request can read but every action and
every terminal is refused (403 `control-disabled`), whatever the key's
scopes. Roll out in two steps:

1. Pin the hub key as a bare string, leave `hubControl` off, and check that
   the hub shows the builder.
2. When you want to drive the builder from the hub, change the entry to an
   object with the scopes you need and set `"hubControl": true`.

### The hub

The hub holds the key every builder accepts. Run it as its own service on its
own box, from a commit you reviewed, never from a branch an agent can push:

```bash
git clone https://github.com/<owner>/laneboard.git ~/laneboard-hub
cd ~/laneboard-hub
git checkout --detach <reviewed tag or SHA>
npm ci --ignore-scripts
```

The hub never loads `node-pty`, so it needs no build toolchain. Its config:

```json
{
  "mode": "hub",
  "publicUrl": "https://hub.example.invalid:8443",
  "fleet": {
    "id": "hub",
    "ingressPort": 7778,
    "ingressPeerUid": 0,
    "allowedUsers": ["you@example.invalid"],
    "builders": [
      { "id": "builder-a", "url": "https://builder-a.example.invalid:8443" }
    ]
  }
}
```

`fleet.ingressPort` has no default on a hub and must be set.
`fleet.ingressPeerUid` is required there too (on Linux): without it a local
process on the hub could pose as you and open a terminal on every builder.
`fleet.hubKeyFile` defaults to `~/.config/laneboard/hub.key`. Serve the hub
the same way:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:7778
```

The hub's `fleet.allowedOrigins` may not contain a builder's origin, and
builders should not list the hub's origin either.

### When the board does not obey

Out of band, on the builder itself:

```bash
laneboard pause --all              # offline: writes the pause sentinel, no server needed
laneboard paused                   # what is paused
ssh builder-a tmux kill-session -t <name>
ssh builder-a tmux kill-server     # every session
```

`laneboard resume --all` lifts an operator pause. Budget and quota pauses can
only be lifted from the UI (they are remote-only). The pause gate is a hook,
so it is cooperative: see `SECURITY.md`.

## On a phone

Web Push only works from an installed PWA over https, so the reverse proxy
above has to be in place first.

1. Open `publicUrl` in the phone's browser.
2. **Share → Add to Home Screen** (iOS) or **Install app** (Android).
3. Open it **from the icon**, not from the browser — iOS only offers
   notifications to an installed PWA.
4. Tap **Enable notifications** in the rail.

You get a push when a session needs permission or asks a question, when one
finishes after at least five minutes of work, when a new `need`, `blocked` or
`limit` marker appears (at most one per session per minute), and immediately
for anything the guard calls `danger`. Tapping one opens that session's
terminal.

## What it costs to run

Measured on a 6-vCPU, 16 GB VM with **10 tmux sessions** on the board, over
20 minutes (40 samples, `deploy/soak.sh 20`):

| | avg | max |
| --- | --- | --- |
| RSS | 105 MB | 112 MB |
| CPU | 0.47 % | 0.57 % |
| hook latency | 0.62 ms | 1.48 ms |

Hook latency is the one that matters for anything but the machine's own
comfort: every Claude Code hook waits on it, so it has to stay in the low
milliseconds.

RSS climbs by about 20 MB over the first ten minutes and then flattens, with
the JS heap steady at 11–19 MB; the rest is the allocator and `node-pty`. If
you want the numbers on your own machine:

```bash
deploy/soak.sh 20                  # writes data/soak-<stamp>.tsv and a summary
```

## Upgrading

```bash
git pull && npm ci && npm test && bin/laneboardctl restart
```

The database migrates itself forward and is never migrated back. Sessions,
lanes and markers survive a restart; a launch that a restart cut off is marked
interrupted and is never resumed.
