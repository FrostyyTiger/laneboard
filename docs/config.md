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
| `hostname` | the system's | `LANEBOARD_HOSTNAME` | The label next to the brand in the header. |
| `human` | `the human` | `LANEBOARD_HUMAN` | What a kickoff prompt calls the person it reports to. |
| `timezone` | the system's | `LANEBOARD_TIMEZONE` | Used by the Morning and Credit windows. |
| — | — | `LANEBOARD_DB` | The SQLite file. `:memory:` for a scratch instance; the test suite sets it. |
| — | — | `LANEBOARD_CONFIG` | The config file itself. |

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

`LANEBOARD_REPOS` takes a comma-separated list of names.

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
