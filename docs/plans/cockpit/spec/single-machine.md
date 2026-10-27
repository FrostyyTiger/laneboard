# Cockpit spec: one machine

`spec-input.md` §3: "For other users: everything (board plus agent) must also run on **one
machine**. The split is an option, not a requirement." This file says what the cockpit is on one
box: one process, its ports, its two unix users, the setups a stranger meets (no tailnet, no GPU,
another agent than Claude Code), a config example for each, the command that checks a setup, and
the `S-ONE-` scenarios. Words are the glossary's (`README.md`); the room's modes and ports are
`README.md` "The room process" (D128), linked here, not repeated.

Written for the open recommendations Q-O21 b) (no pairing in C1), Q-O23 a) (the agent only reads),
Q-O27 a) (a device token is a LAN screen's way in), Q-O29 a)/c) and Q-O36 b) (new: the room will not
start with the agent on its own user unless told to). Text that changes with one of them carries
`(pending Q-O<n>)`.

## 1. What runs on the one box

- **One process.** One `laneboard` server, `mode: builder` (the default) with a `cockpit` section
  holding `cockpit.agent` (D128). It serves the board, the room and the page on **one port**:
  `port`, default `7777`, bound to `bind` (default `127.0.0.1`). The page, `/ws` (with
  `hello.cockpit:true`, D93), the board's `/api/*` and the room's `/api/cockpit/*` share that
  origin, so there is no front to set up for the room (`protocols.md` §1, first row). It starts as
  the board does today: `bin/laneboardctl start` (`docs/install.md`).
- **Ports on the box**, all loopback:

  | Port | What | Key |
  | --- | --- | --- |
  | `7777` | board, room, page | `port` |
  | `7790` | the MCP server the agent calls (D58) | `cockpit.mcp.port` |
  | `7778` | only with a `fleet` block: the ingress listener `tailscale serve` targets (`docs/fleet.md`) | `fleet.ingressPort` |
  | `7779` | only for a LAN tablet with no tailnet: the screen listener its HTTPS proxy targets (§2.3, `screens.md` §6.5, pending Q-O27) | `cockpit.screen.port` |

  A room alone (`mode: cockpit`) also defaults to `7778`; it never runs on the one box, so the two
  never meet.
- **Two unix users.** The board and room run as **the room's user** (the owner's own user, as the
  board does today). The agent runs as **the agent's user**, `cockpit.agent.user`, a second account
  with no login shell and nothing of the owner's (§3). The room starts the agent as that user
  through one `sudo` rule (D214). That is the one-box cost of `screens.md` §6.1's uid rule: without
  a second user the agent could pair screens, read the audit log and every file the owner can
  (§4, pending Q-O36).
- **The agent reads its own board.** On the one box `cockpit.board.url` defaults to the process's
  own `http://127.0.0.1:{port}` (D218), where the MCP server is a `local` caller (`c3-see.md` §2,
  "On a single board" column; D91). Board and room go down together (`protocols.md` §1).
- **The audit log is the board's** (`screens.md` §6.4): one file, one writer, read with
  `laneboard audit`.

## 2. The setups, each with its config

All examples are the file `~/.config/laneboard/config.json` of the room's user (`docs/config.md`'s
layers). Keys not shown keep their defaults. The `cockpit.agent` table (defaults, env vars, the
fatal-at-start lines) is `protocols.md` §11.12; this file uses its keys as `stand-ins.md` §1.1 does: `kind`,
`command`, `cwd`, `user`, `env`, `loginCheck`, plus `allowSameUser` (§4, pending Q-O36) and
`allowedTools`, `allowUnrestricted` (`protocols.md` §11.11).

### 2.1 ONE-A: the box's own screen, typing only (the minimum)

A desktop or a small box with a touch monitor; the browser runs on the box itself and opens
`http://127.0.0.1:7777/`. No tailnet, no GPU, no speech service.

```json
{
  "cockpit": {
    "agent": {
      "kind": "claude-code",
      "command": ["/var/lib/lb-agent/.local/bin/claude"],
      "user": "lb-agent"
    }
  }
}
```

- `cockpit.stt.url` and `cockpit.tts.url` default to `none` (`c2-voice.md` §9, `c5-c6.md` §2): no
  talk button, `SEND` in its place, placeholder `Type a message`; the closed pane's opener is `CHAT`
  (pending Q-O11). Typing is the whole of C1 (`c2-voice.md` §9).
- The page's origin is loopback, which the browser treats as secure: the room links it
  (`screens.md` §6.2.1) and, if a speech service is added later, the microphone works without HTTPS.
- Under Q-O21 b) the page is a `local` caller and the room link accepts it (D212); no pairing.
  Under Q-O21 a) it pairs as any screen; whether the browser keeps the `Secure` cookie on
  `http://127.0.0.1` is research Q14.
- A kiosk on the box: `chromium --kiosk --app=http://127.0.0.1:7777/#/map` (the later
  `docs/cockpit.md`, `c2-voice.md` §12).

### 2.2 ONE-B: a tablet over a tailnet

The owner's way (`spec-input.md` §6: "a tailnet is the owner's way"), on one box: `tailscale serve`
forwards HTTPS to the board's ingress port, and the tablet is a `direct` caller (`docs/fleet/auth.md`).

```json
{
  "publicUrl": "https://cockpit.example.invalid:8443",
  "fleet": { "id": "cockpit", "allowedUsers": ["owner@example.invalid"] },
  "cockpit": {
    "agent": {
      "kind": "claude-code",
      "command": ["/var/lib/lb-agent/.local/bin/claude"],
      "user": "lb-agent"
    },
    "stt": { "url": "wss://stt.example.invalid/asr", "language": ["en", "de"] }
  }
}
```

Then `tailscale serve --bg --https=8443 http://127.0.0.1:7778` (`docs/fleet.md`, rollout step 2).

- The page is HTTPS, so pairing (if any) and the microphone work.
- Under Q-O21 b) the room link takes the `direct` login, limited by `fleet.allowedUsers` (D212).
  On the one box a `direct` user can also run the board's actions and open terminals, as today:
  the tablet should be a screen only the owner can touch (Q-O21's note; `security.md` §2.3).
- `stt` points at a speech service on another machine (a GPU host). On the one box without a GPU
  leave it out: §2.4.

### 2.3 ONE-C: a tablet on the LAN, no tailnet (pending Q-O27)

What a stranger with one box and an old tablet wants (`reviews/48-stranger.md` finding 1). Two
facts decide it today:

- laneboard binds loopback, and **a reverse proxy that forwards to the main port `7777` makes every
  tablet `local`**, with every action and terminal (`docs/fleet/auth.md` rule 2). The later
  `docs/cockpit.md` says so in a warning box: never point a proxy at `7777`.
- The tablet has no certificate it trusts, and a plain-HTTP page does not pair or link
  (`screens.md` §6.2.1).

Under Q-O27 a) the tablet's way in is its device token, as the request kind `screen` (every read
plus `/api/cockpit/*`, no action, terminal or push change), on a listener that accepts only that
kind: `cockpit.screen.port` (`screens.md` §6.5, D236, S-SCR-37). So ONE-C needs the Pair slice, and
does not exist in C1. The config it will take, for the recommendation:

```json
{
  "publicUrl": "https://cockpit.example.invalid:8443",
  "cockpit": {
    "agent": { "kind": "claude-code", "command": ["/var/lib/lb-agent/.local/bin/claude"], "user": "lb-agent" },
    "screen": { "port": 7779 }
  }
}
```

plus a reverse proxy on the box with a certificate from a local CA whose root is installed on the
tablet, forwarding `https://cockpit.example.invalid:8443` to `http://127.0.0.1:7779` (never to
`7777`: with a screen port the main port refuses proxy headers, `misrouted-proxy`). Until then a LAN tablet uses ONE-B, or
the box's own screen (ONE-A). `cockpit.allowInsecure: true` (`screens.md` §6.2.1) works on a LAN
but sends the token and the audio unencrypted; the room says so at start.

### 2.4 Speech and voice on the one box, or none

- **No GPU, no speech service**: leave `cockpit.stt` out (`url` `none`). Nothing else changes: the
  pane is complete (§2.1).
- **A speech service on the same box** (a CPU model, slower): `"stt": {"url":
  "ws://127.0.0.1:8000/asr"}`; `ws://` is allowed on a loopback host only (`c2-voice.md` §9). The
  first-partial time is the machine's own; the speed budget's B2 is measured there, not promised
  (`README.md` "Speed budget").
- **Another speech service** than WhisperLiveKit needs a shim (D183, `c2-voice.md` §9).
- **Voice out** is `cockpit.tts.url`, `none` by default (`c5-c6.md` §2); a local server on the box
  is `http://127.0.0.1:8880/v1/audio/speech`.

### 2.5 Another agent than Claude Code

`kind: "bridge"`: the room starts `command` and speaks the bridge events of `protocols.md` §11.3 on
its stdin and stdout, with no adapter. What such an agent must offer, and how the read-only rule
holds for it, is `protocols.md` §11.11: it reads `LANEBOARD_ALLOWED_TOOLS` and echoes it as
`ready.allowlist`, or the room refuses it (D240).

```json
{
  "cockpit": {
    "agent": {
      "kind": "bridge",
      "command": ["/opt/acme-agent/bin/acme-agent", "--bridge", "--mcp", "http://127.0.0.1:7790/mcp"],
      "cwd": "/var/lib/lb-agent/work",
      "user": "lb-agent",
      "env": ["ACME_AGENT_MODEL"],
      "allowedTools": ["mcp__laneboard__*", "acme_wiki_search"],
      "loginCheck": null
    },
    "drift": { "command": ["/opt/acme-agent/bin/acme-agent", "--once", "--prompt-file", "-"] }
  }
}
```

- `loginCheck` is `null` for `bridge` by default: no periodic check, only a turn's own error
  (`protocols.md` §11.10).
- `costUsd` in `turn.end` is optional; an agent that reports none logs `null` and shows no spend
  (`protocols.md` §11.3).
- `drift.command` is required when the drift check is on and `kind` is `bridge` (`coworker.md` §8).
- The MCP server's address and token reach the agent as for Claude Code: `LANEBOARD_MCP_TOKEN` in
  its environment (D108) and `{stateDir}/cockpit-agent/mcp.json`; an agent that reads neither gets
  them on its command line, as above (the token never: only its environment carries it).

### 2.6 Every cockpit key a one box may set

One file with every key the spec defines so far, at its default unless the comment says otherwise
(JSON has no comments: the `//` lines below are for the reader; `docs/cockpit.md` prints it
without them). Each key's own table is linked.

```text
{
  "port": 7777,                                   // docs/config.md
  "publicUrl": "http://127.0.0.1:7777",           // docs/config.md; https for a tablet (§2.2, §2.3)
  "cockpit": {
    "agent": {                                    // protocols.md §11.12
      "kind": "claude-code",                      // or "bridge" (§2.5)
      "command": ["claude"],                      // absolute when "user" is set (D217)
      "cwd": "{stateDir}/cockpit-agent",          // D246
      "user": "lb-agent",                         // unset: §4 (pending Q-O36)
      "allowSameUser": false,                     // §4 (pending Q-O36)
      "allowedTools": ["mcp__laneboard__*", "Read", "Grep", "Glob"],  // protocols.md §11.11; ["mcp__laneboard__*"] for "bridge"
      "allowUnrestricted": false,                 // protocols.md §11.11; "bridge" only, needs "user"
      "env": [],                                  // names only (D108)
      "loginCheck": ["claude", "auth", "status"], // protocols.md §11.10; null for "bridge"
      "maxTurnsPerHour": 20                       // Q-O28, coworker.md
    },
    "board": { "url": "http://127.0.0.1:{port}" },  // D218
    "mcp": { "port": 7790 },                      // D58
    "stt": { "url": "none", "language": ["en", "de"], "protocol": "whisperlivekit" },  // c2-voice.md §9
    "tts": { "url": "none" },                     // c5-c6.md §2
    "allowInsecure": false,                       // screens.md §6.2.1
    "layout": "split",                            // screens.md §1 (pending Q-O22)
    "quietHours": null,                           // coworker.md
    "jobs": { "scripts": [] },                    // coworker.md §6 (slice Jobs)
    "act": { "allow": [] }                        // c5-c6.md §7 (fenced)
  }
}
```

Keys of the two-process setup are not used here: `cockpit.forwarded` (fatal together with
`cockpit.agent`, D129) and `mode: cockpit`.

## 3. The agent's own user (D214, D215, D217)

### 3.1 One command prints the setup

laneboard never runs as root and never runs a root command itself. `laneboard cockpit agent-user
[name]` (default name `lb-agent`) reads the config, prints the commands for the owner to run as
root, and exits 0. Output for the room's user `user` (uid 1000), exact apart from the names and
paths it fills in:

```text
# Run these as root to give the cockpit's agent its own user (docs/cockpit.md):
useradd --system --create-home --home-dir /var/lib/lb-agent --shell /usr/sbin/nologin lb-agent
install -m 0440 /dev/stdin /etc/sudoers.d/laneboard-cockpit <<'EOF'
Defaults!/var/lib/lb-agent/.local/bin/claude !use_pty
user ALL=(lb-agent) NOPASSWD:SETENV: /var/lib/lb-agent/.local/bin/claude
EOF
visudo -cf /etc/sudoers.d/laneboard-cockpit
setfacl -m u:lb-agent:x /home/user /home/user/.local /home/user/.local/state /home/user/.local/state/laneboard
# Then install Claude Code for lb-agent and log it in once:
#   sudo -u lb-agent -H -s    (then install it, run claude and log in)
# and set "cockpit.agent.user": "lb-agent" and
# "cockpit.agent.command": ["/var/lib/lb-agent/.local/bin/claude"] in the config.
```

- The program path in the sudo rule is `cockpit.agent.command[0]` when the config already has it,
  else `/var/lib/{name}/.local/bin/claude` (`kind: claude-code`) or the line
  `# set cockpit.agent.command first` and exit 1 (`kind: bridge`).
- The `setfacl` line lists every directory between `/` and `{stateDir}/cockpit-agent/` that the
  new user could not enter (§3.3); none: the line is left out.
- `name` must match `^[a-z_][a-z0-9_-]{0,31}$`, else `agent-user: "{name}" is not a user name`,
  exit 1. A name equal to the room's own user: `agent-user: that is you; pick another name`, exit 1.
- The owner's model login for the agent is the agent's user's own (`security.md` §1, "The agent's
  model login"): logging Claude Code in as `lb-agent` once. It bills the same account as the owner's
  loops (Q-O28).

### 3.2 How the room starts the agent as that user (D214, pending research Q18)

With `cockpit.agent.user` set, the room spawns, with no shell:

```text
sudo -n -u lb-agent -H --preserve-env=LANEBOARD_MCP_TOKEN,{the names of cockpit.agent.env} -- {command…} {protocols.md §11.2's arguments}
```

and the login check (`protocols.md` §11.10) the same way. `sudo` sets `HOME`, `USER` and `PATH`
for the agent's user, so the agent finds its own login and its own `CLAUDE.md`; `-n` makes a
missing rule a failed start (exit 1 with `sudo: a password is required` on stderr) instead of a
prompt. The room names that failure: the start is `agent-down` with `detail`
`sudo refused: run laneboard cockpit agent-user (docs/cockpit.md)` (the E3 line of `c1-talk.md` §10
carries the detail).

- **Stopping** (`protocols.md` §11.6): the room's uid may not signal a process of another uid, so
  it signals the `sudo` process, which relays `SIGINT` and `SIGTERM` to the agent. The 5.0 s and
  8.0 s steps stay. If the child still runs at 10.0 s the room sends `SIGKILL` to `sudo` and closes
  the child's stdin, stdout and stderr pipes; Claude Code exits on a closed stdin. Research Q18
  checks the relay, `!use_pty` and what a `SIGKILL` to `sudo` leaves behind.
- **The rule is one-way.** It lets the room's user (and any process of it, such as the owner's own
  loops on the box) become the agent's user, never the reverse; the agent's user holds nothing the
  room's user lacks, which is why `SETENV` on this one program is acceptable.
- **Without `cockpit.agent.user`** the room spawns `command` directly as itself (§4).

### 3.3 What the agent's user must reach

Claude Code reads `--mcp-config {stateDir}/cockpit-agent/mcp.json` and its working directory as
the agent's user (D209). On the one box `{stateDir}` is inside the owner's home
(`~/.local/state/laneboard`), and a home of mode 0750 or 0700 stops the agent at the first step:
its laneboard tools never start (`tools-down`, `c3-see.md` §1). So:

- the room, at start, walks every directory from `/` to `{stateDir}/cockpit-agent/` and to
  `cockpit.agent.cwd`, and for each one the agent's user could not enter (by the mode bits, the
  directory's owner and group, and the agent's user's groups) writes one stderr line:
  `cockpit: lb-agent cannot enter /home/user (mode 0750); its tools will not start. Run: setfacl -m u:lb-agent:x /home/user`.
  It starts anyway (the agent then answers with `tools-down`).
- `x` alone lets the agent's user pass through a directory to a path it knows, not list it; the
  0700 `{stateDir}/cockpit/` stays closed (`security.md` §3).
- `laneboard cockpit doctor` reports the same as its `agent-files` check (§5).

## 4. The agent on the room's own user (pending Q-O36)

A stranger's obvious first try is one user for everything. What that gives the agent, with Q-O23 a)'s
`Read`, `Grep` and `Glob`: every file the owner can read, `~/.ssh` and the board's audit log
included, quoted to the model service and onto the screen (reply redaction catches known token
shapes only, `security.md` §5). It could also pair screens, which the room refuses
(`agent-is-room`, `screens.md` §6.1).

For Q-O36 b) (recommended):

- `cockpit.agent.user` unset and `cockpit.agent.allowSameUser` not `true`: the room does not start.
  Exit 1 within 2 s, stderr exactly:
  `cockpit.agent.user is not set: the agent would run as you (uid 1000) and read every file you can. Give it its own user (laneboard cockpit agent-user), or set cockpit.agent.allowSameUser: true to accept that (docs/cockpit.md).`
- With `allowSameUser: true`: the room starts and prints once on stderr
  `cockpit: the agent runs as you (uid 1000): it can read every file you can, ~/.ssh included. Pairing is off (agent-is-room).`
  Pairing stays refused (`screens.md` §6.1); under Q-O21 b) C1 needs none, so typing works.
- `allowSameUser` is a boolean (`LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER=1`); anything else is
  fatal at start, naming the key. With `user` set it is ignored.
- `?demo=1` (`c1-talk.md` §15, D148) is how to try the cockpit with no room at all, so the refusal
  never stands between a stranger and a first look.

## 5. `laneboard cockpit doctor` (D216)

Run as the room's user on the box. It reads the config as the server does, asks the running room,
and prints one line per check, in this order, then a summary. It changes nothing.

| # | Check | How | `ok` text | Not ok: status, text, `fix:` line |
| --- | --- | --- | --- | --- |
| 1 | `config` | the server's own config parser | `{file} (cockpit.agent kind {kind})` | `FAIL` the parser's fatal line; `fix: the key named above (docs/config.md)` |
| 2 | `room` | `GET http://127.0.0.1:{port}/healthz`, 2 s | `127.0.0.1:{port} answers` | `FAIL nothing answers on 127.0.0.1:{port}`; `fix: start it: bin/laneboardctl start` |
| 3 | `board` | `GET {cockpit.board.url}/healthz`, 5 s | `{url} answers (mode {mode})` | `FAIL {url} did not answer in 5 s`; `fix: point cockpit.board.url at the laneboard the agent should read` |
| 4 | `mcp` | MCP `initialize` and `tools/list` on `127.0.0.1:{mcp.port}/mcp` with `{stateDir}/cockpit/mcp.token`, 5 s | `{n} tools on 127.0.0.1:{mcp.port}` | `FAIL no MCP server on 127.0.0.1:{mcp.port}`; `fix: the room starts it: check the room's log (bin/laneboardctl logs 100)` |
| 5 | `agent-user` | `cockpit.agent.user` against the system's user list | `{user} (uid {uid}), not you` | unset: `FAIL the agent runs as you (uid {uid})`, `fix: give it its own user: laneboard cockpit agent-user (docs/cockpit.md)` (`warn` with `allowSameUser: true`); unknown: `FAIL user {user} does not exist`, `fix: laneboard cockpit agent-user {user}`; uid 0: `FAIL {user} is root`, `fix: use an unprivileged user` |
| 6 | `agent-files` | §3.3's walk | `{user} reaches cockpit-agent/ and its cwd` | `FAIL {user} cannot enter {dir} (mode {mode})`, `fix: setfacl -m u:{user}:x {dir}` (one pair per directory); `skip` when check 5 is not `ok` |
| 7 | `agent` | `GET /api/cockpit/admin/status` on the room (admin route, own uid, `screens.md` §6.1) | `ready: {agent} (laneboard tools connected)`; `warn ready: {agent}, tools not limited (allowUnrestricted)` with `allowUnrestricted: true` (`protocols.md` §11.11) | `FAIL agent down: {detail}` with `fix:` by detail (below); `FAIL not logged in`, `fix: log in as the agent's user: sudo -u {user} -H -s, then claude`; `warn laneboard tools did not start`, `fix:` check 6's; `skip` when check 2 failed |
| 8 | `origin` | `publicUrl` | `{publicUrl} (https)` or `{publicUrl} (loopback)` | `FAIL {publicUrl} is plain http: a screen there cannot pair or link`, `fix: serve it over https (docs/cockpit.md), or use the box's own screen`; `warn` instead with `allowInsecure: true`, text `{publicUrl} is plain http: tokens and audio travel unencrypted` |
| 9 | `speech` | `stt.url`: connect, wait for the first `config` message, 2 s | `{url} answers` | `skip cockpit.stt.url is none: typing only`; `FAIL {url}: {detail}` with `c2-voice.md` §10's detail words, `fix: check the speech service, or set cockpit.stt.url to none` |
| 10 | `files` | `security.md` §3's start check, reported instead of stopping | `secrets and state are 0600/0700, owned by you` | `FAIL` the D210 line per path; `fix: chmod as the line says` |

- `fix:` for check 7's `agent down` by its `detail`: `sudo refused…` → `fix: run laneboard cockpit
  agent-user`; `spawn ENOENT` → `fix: cockpit.agent.command[0] does not exist: {path}`;
  `the agent declares no tool allowlist…`, `the agent allows…` or `the agent called…`
  (`protocols.md` §11.11) → `fix: make the agent enforce LANEBOARD_ALLOWED_TOOLS, or set
  cockpit.agent.allowUnrestricted (docs/cockpit.md); then restart the room`; anything
  else → `fix: see the room's log (bin/laneboardctl logs 100)`.
- **Line format**: the status padded to 6 characters (`ok`, `warn`, `FAIL`, `skip`), the check
  name padded to 12, the text; a `fix:` line under a non-`ok` line, indented 6 spaces. Then
  `{a} ok, {b} warn, {c} FAIL, {d} skip`. **Exit** 1 when any line is `FAIL`, else 0. A check never
  waits longer than its time in the table; the whole run ends within 25 s.
- **The admin status route** `GET /api/cockpit/admin/status` (new; the room's own uid only, as the
  other admin routes, D161, but answered also under `agent-is-room`, since it changes nothing and
  shows nothing secret; the agent's uid still gets `403 agent-uid`): `200 {"agent":"ready","detail":null,"agentVersion":"claude-code 2.1.290","tools":"connected","loginCheck":"ok","since":"2026-10-27T06:58:00+01:00"}`;
  `agent` is `ready`, `starting`, `down` or `not-logged-in`; `tools` is `ready.mcp.laneboard` or
  `null` before a `ready`. It spends no agent turn. `protocols.md` §1.1 gains its row (T129).
- **Tests** take an injected `getuid`, user lookup and `stat` (D111's way), so no second user is
  needed on the test machine.

An example on a box set up as ONE-A, the agent's user created but its home not yet reachable:

```text
ok    config      /home/user/.config/laneboard/config.json (cockpit.agent kind claude-code)
ok    room        127.0.0.1:7777 answers
ok    board       http://127.0.0.1:7777 answers (mode builder)
ok    mcp         8 tools on 127.0.0.1:7790
ok    agent-user  lb-agent (uid 998), not you
FAIL  agent-files lb-agent cannot enter /home/user (mode 0750)
      fix: setfacl -m u:lb-agent:x /home/user
warn  agent       laneboard tools did not start
      fix: setfacl -m u:lb-agent:x /home/user
ok    origin      http://127.0.0.1:7777 (loopback)
skip  speech      cockpit.stt.url is none: typing only
ok    files       secrets and state are 0600/0700, owned by you
7 ok, 1 warn, 1 FAIL, 1 skip
```

(The `8 tools` count is whatever `tools/list` returns; `c3-see.md` lists them.)

## 6. One box against two processes

| | One box (this file) | Board or hub plus a room as its own process |
| --- | --- | --- |
| processes | one, `mode: builder` with `cockpit.agent` | two: the board/hub with `cockpit.forwarded: true`, the room `mode: cockpit` (D128, D129) |
| ports | `7777` for all (§1) | the room on `7778`, its front forwards `/api/cockpit/` (`protocols.md` §1, pending Q-O29) |
| unix users | room's user and the agent's user | the board's user, the room's user, the agent's user (D91) |
| what goes down together | board and room | either alone (`protocols.md` §1, "Hub down, room up") |
| audit log | the board's file | the room's own file (`screens.md` §6.4) |
| `cockpit.board.url` | the own port (D218) | the hub's or board's loopback port (D91) |
| setup check | `laneboard cockpit doctor` | the same, run as the room's user (check 3 reads the hub) |

## 7. Scenarios

### S-ONE-01 One box, typing only: the page, the room and the agent's reads on one port

Given the room under test with ONE-A's config shape (`stand-ins.md` §1.1, `mode: builder`, no
`cockpit.board.url`, no `cockpit.stt`, `allowSameUser: true`, `hostname: "cockpit-box"`) and the
fake agent's script `c3-tools` asking `fleet`,
When the page opens `http://127.0.0.1:{port}/#/map` at 1368x912 and the owner taps `CHAT`, types
`what is on the map?` and taps `SEND`,
Then the first `/ws` frame has `"cockpit":true`; no `[data-talk]` element exists and `SEND` is in the
talk button's place; the prompt block is drawn within 0.1 s (B8); the fake agent's `fleet` call
gets a result whose first node's `name` is `cockpit-box` (the process's own board, D218); the reply
streams in.

Test: Playwright against the room under test; assert the `hello` frame from the page's WebSocket
log, `page.locator('[data-talk]')` count 0, `fakeAgent.toolResults('fleet')[0]` and the B8 mark.

### S-ONE-02 The agent on the room's own user: the room will not start unless told to (pending Q-O36)

Given a config with `cockpit.agent` and no `cockpit.agent.user`,
When the room starts,
Then it exits 1 within 2 s, nothing listens on its port, and stderr is exactly §4's first line with
the test's uid.
When `cockpit.agent.allowSameUser` is `true` and it starts again,
Then it listens, stderr holds §4's second line once, and an admin `pair` from the room's uid gets
`403 {"error":"agent-is-room"}` (as S-SCR-27).
When `allowSameUser` is `"yes"`,
Then it exits 1 with a line naming `cockpit.agent.allowSameUser`.

Test: `node:test` with `boot({expectExit:true})` reading the exit code and stderr; the `pair` step
through the control API's `/pair` (`stand-ins.md` §1.2).

### S-ONE-03 `doctor` on a working one box

Given the room under test running with `allowSameUser: true` and no `cockpit.stt`,
When `laneboard cockpit doctor` runs against its config,
Then it prints, in order: `ok config`, `ok room`, `ok board` (`mode builder`), `ok mcp`,
`warn agent-user` (`the agent runs as you (uid {uid})` and its `fix:` line), `skip agent-files`,
`ok agent` (`ready: …`), `ok origin` (`(loopback)`), `skip speech` (`cockpit.stt.url is none: typing
only`), `ok files`, then `7 ok, 1 warn, 0 FAIL, 2 skip`, and exits 0 within 25 s.

Test: `node:test`: spawn `bin/laneboard cockpit doctor` with the booted room's `LANEBOARD_CONFIG`
and state dir; compare stdout line by line with the status and name columns, and the summary
exactly.

### S-ONE-04 `doctor` with the room stopped and the agent's home closed

Given a config with `cockpit.agent.user: "lb-agent"` (injected: uid 998, groups `lb-agent`), a
state dir `{tmp}/home/.local/state/laneboard` where `{tmp}/home` is mode 0750, and no room running,
When `doctor` runs,
Then `room` is `FAIL nothing answers on 127.0.0.1:{port}` with `fix: start it: bin/laneboardctl
start`; `board`, `mcp` are `FAIL`; `agent-user` is `ok`; `agent-files` is `FAIL lb-agent cannot
enter {tmp}/home (mode 0750)` with `fix: setfacl -m u:lb-agent:x {tmp}/home`; `agent` is `skip`;
the exit code is 1.

Test: `node:test` calling the doctor's module with injected `getuid` (1000), user lookup and the real
`stat` of the temp tree; asserts the lines and the exit code.

### S-ONE-05 `agent-user` prints the setup and refuses bad names

Given the room's user `user` (uid 1000) and a config with `kind: claude-code` and no `command`,
When `laneboard cockpit agent-user` runs,
Then it prints §3.1's block with `lb-agent`, `/var/lib/lb-agent/.local/bin/claude` in both sudo
lines, and exits 0; nothing on the system changes (no file written, no process started as root).
When it runs with `Bad Name`, Then stderr is `agent-user: "Bad Name" is not a user name`, exit 1.
When it runs with `user`, Then stderr is `agent-user: that is you; pick another name`, exit 1.
When the config has `kind: bridge` and no `command`, Then the block holds `# set
cockpit.agent.command first` and the exit is 1.

Test: `node:test` with injected user lookup and `stat`; stdout compared with a fixture file holding
§3.1's block.

### S-ONE-06 Another agent: a `bridge` agent answers, with no login check and no cost

Given the room under test with `kind: "bridge"`, `command` the fake agent with `--dialect bridge`,
`loginCheck` left out (the fake echoes `LANEBOARD_ALLOWED_TOOLS` as `ready.allowlist`,
`protocols.md` §11.11), and the script `c1-typing`'s first turn,
When the owner types `how is it going?` and taps `SEND`,
Then the reply streams as with `claude-code` (same blocks, same `turn.end` `done`), no login check
runs (`fakeAgent.loginChecks()` is empty, also after `advance(900000)` on the room's manual clock,
D151's interval), and the room's per-turn log line has `costUsd: null`.

Test: Playwright for the reply; `fakeAgent.loginChecks()` and the room log line read in the same
test after `advance(900000)`.

### S-ONE-07 `doctor` names a plain-HTTP page on the LAN

Given a config with `publicUrl: "http://192.0.2.10:7777"` and `cockpit.allowInsecure` unset,
When `doctor` runs,
Then `origin` is `FAIL http://192.0.2.10:7777 is plain http: a screen there cannot pair or link`
with `fix: serve it over https (docs/cockpit.md), or use the box's own screen`.
When `cockpit.allowInsecure` is `true`,
Then `origin` is `warn http://192.0.2.10:7777 is plain http: tokens and audio travel unencrypted`.

Test: `node:test` calling the doctor's module with only the `origin` check enabled (the module takes
a list of check names), both configs.

### S-ONE-08 Another agent's own tool reads `used search_wiki`

Given the room under test with `kind: "bridge"`, `command` the fake agent with `--dialect bridge`,
`allowedTools: ["mcp__laneboard__*", "search_wiki"]`, and the script `one-bridge`'s first turn
(match `wiki`: tool `search_wiki`, input `{"q":"backups"}`, at 100 ms, `endAt` 400 ms; text
`The wiki has no page on backups.` at 500 ms; `end` `done` at 700 ms); the fake echoes
`LANEBOARD_ALLOWED_TOOLS` as `ready.allowlist` (its default, `stand-ins.md` §2.5),
When the owner types `what does the wiki say about backups?` and taps `SEND`,
Then within 1.0 s of `SEND` one tool line reads `used search_wiki` (no target, `c1-talk.md` §5.2's
last row), with its `●` while it runs and no ` · failed` after its end; then the text block
`The wiki has no page on backups.`; the header reads `READY`. The fake's `start` log line lists
`LANEBOARD_ALLOWED_TOOLS`, `LANEBOARD_SESSION` and `LANEBOARD_MCP_TOKEN` in `env`, and the room's
log has no `agent refused` line.

Test: Playwright on the real room with the fake agent; `textContent` of the one `[data-tool-line]`
is `used search_wiki`; `fakeAgent.starts()[0].env`; the room log read after the turn.

### S-ONE-09 A bridge agent that declares no allowlist is refused, and not restarted

Given the room under test as S-ONE-08, the script `one-bridge` with `start.allowlist: null` (the
fake's `ready` has no `allowlist`), `initAfterMs` 200,
When the page opens with the pane open, the owner has typed `hello` in the input, and the room's
clock goes to `manual` 1.0 s after the spawn,
Then by 1.0 s after the spawn the status line `[data-status="agent-down"]` reads
`Agent not running since {HH:MM} …` (`c1-talk.md` §10.1 row 3), `SEND` is disabled and `hello`
stays in the input; `GET /api/cockpit/admin/status` answers `"agent":"down"` with `detail`
`the agent declares no tool allowlist (see cockpit.agent.allowUnrestricted)`; the room log has
`agent refused: the agent declares no tool allowlist (see cockpit.agent.allowUnrestricted)`.
After `advance(120000)`, `fakeAgent.starts()` still has one entry (§11.7 would have restarted it
at 2, 4, 8, 16, 30 s and every 30 s after).
Second case, `start.allowlist: ["mcp__laneboard__*","shell"]`: the same, with `detail`
`the agent allows shell, outside cockpit.agent.allowedTools`.

Test: Playwright for the status line, the disabled `SEND` and the kept draft; `fetch` of the admin
status route from the test's own uid; `fakeAgent.starts()` after `advance(120000)`.

### S-ONE-10 The tripwire: a call outside the allowlist ends the turn and the agent

Given the room under test with `kind: "bridge"`, the fake agent with `--dialect bridge`,
`allowedTools` left at its default `["mcp__laneboard__*"]`, and the script `one-bridge`'s second
turn (match `files`: tool `shell`, input `{"cmd":"ls"}`, at 100 ms, `endAt` 400 ms; text
`Three files.` at 500 ms; `end` `done` at 700 ms),
When the owner types `which files are there?` and taps `SEND`,
Then no tool line is drawn (`[data-tool-line]` count 0) and `Three files.` never appears; within
1.0 s of `SEND` the turn ends with `[data-turn-error="failed"]` reading
`The answer failed: the agent called shell, outside its allowlist.`; the fake's log has a `stdin`
line `{"type":"interrupt",…,"cancelQueued":true}` and then its stdin closes (a `SIGTERM` follows
within 5.0 s if it has not exited); the status line is `agent-down` with `SEND` disabled, as in
S-ONE-09.
Second case, the same turn with a `denied` step for `shell` instead of the `tool` step (the fake
writes `tool.start` with `denied:true`): the tool line reads `tried shell, not allowed`
(`[data-denied="true"]`), `Three files.` follows, the turn ends `done`, nothing is refused.

Test: Playwright on the real room with the fake agent; `fakeAgent.order()` for the interrupt and
the end of stdin; both cases in one file.

### S-ONE-11 `allowUnrestricted`: only for `bridge`, only with the agent's own user

Given the config parser and start checks with an injected user lookup (§5's way, `lb-agent`
uid 998, the caller uid 1000),
When the config is (a) `kind: "claude-code"`, `allowUnrestricted: true`; (b) `kind: "bridge"`,
no `user`, `allowSameUser: true`, `allowUnrestricted: true`; (c) `kind: "bridge"`,
`user: "lb-agent"`, `LANEBOARD_COCKPIT_AGENT_ALLOW_UNRESTRICTED=1` in the environment,
Then (a) exits 1 with `cockpit.agent.allowUnrestricted: only for kind bridge; claude-code is
limited by cockpit.agent.allowedTools`; (b) exits 1 with `cockpit.agent.allowUnrestricted needs
cockpit.agent.user: an agent with no tool limit must not run as you`; (c) starts and prints once on
stderr `cockpit.agent.allowUnrestricted is true: the agent's tools are not limited; only its own
user (lb-agent) keeps it off your files and the board's state.`, and with an agent whose `ready`
has no `allowlist`, the room accepts it and `doctor` check 7 prints
`warn  agent       ready: acme-agent 1.0, tools not limited (allowUnrestricted)`.

Test: `node:test` on the config module and the room's start (no Playwright); the doctor module with
only the `agent` check enabled and a stubbed admin status answer.

### S-ONE-12 A bad `cockpit.agent` key stops the start, naming the key

Given the config parser and start checks with an injected user lookup (`lb-agent` uid 998, `root`
uid 0, the caller `user` uid 1000) and an injected environment,
When the config is, one case at a time: (a) `kind: "acme"`; (b) `kind: "bridge"` with no
`command`; (c) `command: ["node","fake-agent.mjs","--model","x"]` with `kind: "claude-code"`;
(d) `cwd: "/nonexistent/notes"`; (e) `user: "nobody-here"`; (f) `user: "root"`; (g) `user: "user"`;
(h) `allowedTools: ["Bash(*)"]`; (i) `env: ["LANEBOARD_MCP_TOKEN"]`; (j) `maxTurnsPerHour: 1000`;
(k) no `cockpit.agent` in the file and `LANEBOARD_COCKPIT_AGENT_KIND=bridge` in the environment;
(l) cases (a) and (j) together,
Then each exits 1 within 2 s, nothing listens, and stderr is exactly the line of `protocols.md`
§11.12's fatal table for that key with that value; (l) prints only (a)'s line.
When the config is valid and `env: ["ACME_AGENT_MODEL"]` names a variable the room's environment
does not hold,
Then the room starts and stderr holds `cockpit.agent.env: ACME_AGENT_MODEL is not set here; the
agent starts without it` once, and the fake agent's log `start` line (`stand-ins.md` §2.6) lists
no `ACME_AGENT_MODEL` in `env`.

Test: `node:test` on the config module and the room's start (no Playwright), one `boot({expectExit:true})`
per case comparing stderr's first line and the exit code; the last step against the fake agent.

## 8. Not in v1

- **macOS and Windows** as the one box: §3's commands are Linux (`useradd`, `setfacl`, a sudoers
  drop-in). laneboard's service script is Linux too (`docs/install.md`). A Mac needs other commands
  for the same user and rule; `agent-user` on a non-Linux system prints
  `agent-user: Linux only in v1; docs/cockpit.md lists what to do by hand` and exits 1 (D215).
- **A container image** (`docs/plans/product.md`, "Deferred until people ask"): the agent's user
  would be a second container; not specified.
- **The agent on another machine than the board**: D91's overrule (a `reader` kind on the hub).
