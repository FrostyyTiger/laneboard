# Install

## What you need

| | |
| --- | --- |
| **Node 24 or newer** | `node --version`. laneboard is one process, ESM, `node:sqlite`. |
| **A C++ toolchain** | `node-pty` compiles: `build-essential` on Debian/Ubuntu, `base-devel` on Arch, the Command Line Tools on macOS. |
| **tmux** | Sessions are tmux sessions. laneboard reads them and can start them. |
| **`jq`** | Only for `deploy/install-claude.sh` and the status-line sidecar. |
| **`gh`, logged in** | Only for the `gh` CI provider. Optional. |
| **`docker`** | Only for the `agent-stack` slot provider and the guard's container list. Optional. |

Everything after the first three is optional: with no providers configured,
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
deploy/install-claude.sh
```

Two additive changes to `~/.claude/`, backed up first: a `hooks` block that
POSTs each event to `127.0.0.1:7777/api/hook` (so a session's state is known
in milliseconds rather than at the next poll), and a status line that mirrors
its own stdin to `~/.cache/laneboard/status/` (so cost, context and rate-limit
numbers are readable without touching any Claude Code internals). An existing
`statusLine` is left alone and the sidecar is appended to it instead. The
script refuses and restores if the merge would have changed anything else.

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

## Upgrading

```bash
git pull && npm ci && npm test && bin/laneboardctl restart
```

The database migrates itself forward and is never migrated back. Sessions,
lanes and markers survive a restart; a launch that a restart cut off is marked
interrupted and is never resumed.
