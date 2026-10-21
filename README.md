# laneboard

One page that shows every Claude Code session on a machine, grouped into
**lanes** — a lane being a git worktree with one branch, one plan and one piece
of work — plus the two acts that make a lane, `launch` and `retire`.

One Node 24 process, no build step, six dependencies. It binds `127.0.0.1`
only: laneboard has no login and can type into terminals, so anything that
exposes it (a tailnet, a reverse proxy) has to do the authentication.

With a `fleet` block, several of these boards sit behind one **hub**: a
separate laneboard in `mode: "hub"` that shows and drives every builder through
signed, audited requests. Without one, nothing changes. See
**[docs/fleet.md](docs/fleet.md)**.

| View | Answers |
| --- | --- |
| **Map** `#/map` | The home view. What is all this running on, and where is the trouble? A live constellation of your sites, rooms, services, builders and lanes, with what depends on what, which lanes touch the same files and which conflict. Overlays for status, CI, cost, context and age; `\` splits it with a dense lane table. Fed by a topology file, snapshots other machines push, and HTTP probes; laneboard reaches out to nothing else. |
| **Board** `#/board` | What is each lane doing, and which one wants me? One data block per lane and session: builder, state, stage, PR and checks, context, 5 h spend, age. Sorted by the most urgent thing inside. |
| **Inbox** `#/inbox` | What is waiting for me? Pending approvals, lanes that need you, lanes ready for review, paused and stuck lanes, with keys to approve, deny, release and pause. |
| **Packages** `#/packages` | What state is each package in? Its CI on main, untested commits, the lanes and PRs touching it, predicted conflicts and plan status. |
| **Morning** `#/morning` | Over a window (12 h / tonight / 24 h / 7 d): what needs a human (`danger` first), what finished (with its PR), review waits, stuck incidents, what it cost. |
| **Runs** `#/runs` | Is tonight's unattended loop getting anywhere? Each run's state, round, latest score and its trend, budget burn, time left and open needs; a run's page (`#/runs?run=<id>`) has the timeline of rounds, a chart per score, the stop reason and the PRs. Fed by run files a loop writes, see [docs/runs.md](docs/runs.md). |
| **Credit** `#/credit` | Where the 5 h and 7 d rate-limit windows have been, per account, and what each builder and lane spent. |
| **Box** `#/box` | The machine and its health, a live stack next to it and its guard, the CI queue, the agent slots; on a hub, every builder's link, version, latency and health. |
| **Audit** `#/audit` | What was done, by whom? The hash-chained action log, and on a hub each relayed action's reconciliation with the builder's own log. |
| **Diff** `#/diff` | A lane's changes, with line comments batched into one review sent to the lane. Opened from a lane. |
| **Archive** `#/board?s=archive` | Retired lanes, searchable; restore one through a confirmed launch. |

`g m` map · `g b` board · `g i` inbox · `g p` packages · `g o` morning ·
`g r` runs · `g c` credit · `g x` box · `g a` audit. `⌘K` opens the command palette, `[`
`]` step through builders, `\` splits the Map, `?` shows every key.

The top strip counts alarms in eight tiles (NEED, APPR, BLKD, STCK, CI-F, DOWN, BUDG, CONF);
a click lists them. DOWN counts a builder whose link is down or stale, a crit host check and an
audit fork; a host that wants a reboot or has a health warning shows it in the Box, not on DOWN.

## Run it

```bash
npm ci                    # node-pty compiles; build-essential must be present
npm test
node server/index.mjs     # http://127.0.0.1:7777
```

Install it as a `systemd --user` service, put HTTPS in front of it and add it
to a phone's home screen: see **[docs/install.md](docs/install.md)**.

## Configure it

`~/.config/laneboard/config.json`, every key optional, every key also an
environment variable — **`docs/config.md`** documents all of them. With no
config file at all laneboard is a board of every session and every worktree on
the machine, with lane slots, the guard and CI all off.

```json
{
  "publicUrl": "https://board.example.invalid:8443",
  "repos": [{ "name": "acme" }]
}
```

A second copy for testing, which touches neither the config file, the database
nor the state dir (audit log, hook token, run files go to a temp dir). Pick a
port nothing listens on (`ss -ltn`) for `LANEBOARD_PORT`: on a taken port the
copy exits, and the board already there answers instead:

```bash
tmp=$(mktemp -d)
LANEBOARD_PORT=7788 LANEBOARD_DB=:memory: LANEBOARD_CONFIG=/dev/null \
  LANEBOARD_STATE_DIR="$tmp" LANEBOARD_AUDIT_FILE="$tmp/audit.jsonl" \
  node server/index.mjs
```

The CLI talks to `http://127.0.0.1:7777` unless told otherwise, so point it at
the copy, or it writes into the real board: `LANEBOARD_URL=http://127.0.0.1:7788
laneboard ls` (or `node bin/laneboard ls` from the checkout, see [CLI](#cli)). Stop the copy with
Ctrl-C in its terminal, then `rm -r "$tmp"`.

All five variables are needed. A shorter form with only the port, the database
and the config still shares the real state dir: it opens the real audit log, and
while another board runs it finds that log locked (`AUDIT_LOCKED` in its log)
and refuses every action. `LANEBOARD_STATE_DIR` and `LANEBOARD_AUDIT_FILE`
pointing at the temp dir avoid that.

The state dir must be a private directory (mode 700, only you can read it):
`mktemp -d` makes one, a plain `mkdir -p /tmp/lb` usually does not (mode 775
with the common umask). In a directory other users can read, the board still
starts but logs `AUDIT_UNSAFE_DIR` with the reason and refuses every action
until you `chmod 700` it.

The copy is not a clean slate for reads: it still sees this machine's real
sessions and directories (`laneboard ls` against it lists them). It only
reads them, it writes nothing there.

## CLI

`laneboard` is `bin/laneboard` in the checkout. Run it as `node bin/laneboard ls`,
or put it on the PATH once (the same step as in [docs/install.md](docs/install.md)):

```bash
ln -s "$PWD/bin/laneboard" ~/.local/bin/laneboard
readlink -f "$(command -v laneboard)"   # which checkout the PATH runs
```

With several checkouts (worktrees, a test copy) the link points at one of them;
the `readlink` line shows which.

```bash
laneboard ls                     # every session, attention first
laneboard peek <name> -n 40
laneboard send <name> "keep going"
laneboard morning [--window tonight|12h|24h|7d]
laneboard credit
laneboard launch <lane> --plan docs/plans/<lane>.md
laneboard retire <lane> [--force]
laneboard pause <name|--all>     # works with the server down
laneboard resume <name|--all>
laneboard paused
laneboard audit [verify]         # the fleet audit log, offline
laneboard fleet keygen|pubkey    # the hub key (on the hub)
laneboard run start|round|score|needs|ack|artifact|stop|cost   # report a loop's run, works offline
```

`laneboard run` writes the run protocol of [docs/runs.md](docs/runs.md) (`laneboard run --help`).
Each `run` subcommand appends one line to `./.laneboard/run.jsonl` in the current directory
(or `--file f`, or `$LANEBOARD_RUN_FILE`) unless `--post` sends it to the server; `.laneboard/` is
in `.gitignore`, add it to your own repo's ignore file too.

`LANEBOARD_URL` overrides the server address.

## API

Every view reads JSON you can `curl` (builder mode; a hub serves the same views from
`/api/fleet/*`). The live views also get pushes over `/ws`.

| View | Reads |
| --- | --- |
| Map | `GET /api/map` |
| Board, Inbox | `GET /api/state` (the `/ws` snapshot); the Inbox acks a need with `POST /api/runs/events` |
| Packages | `GET /api/packages` |
| Morning | `GET /api/morning?window=12h\|tonight\|24h\|7d` (another window is a 400) |
| Runs | `GET /api/runs`, `GET /api/runs?run=<id>`, `GET /api/runs/<id>` |
| Credit | `GET /api/credit` |
| Box | `GET /api/v1/health?history=1` |
| Audit | `GET /api/v1/audit` |
| Archive | `GET /api/v1/archive` |
| (none) | `GET /api/health`: `{ok, version, mode}`, nothing else |

`/healthz` adds the process's pid, uptime and memory. An unknown `/api/*` path is a JSON 404;
any other unknown path gets the page.

## Nothing destructive happens on its own

`retire` refuses a live session always, and a dirty or unmerged lane without
`--force` plus the lane id typed back. Collectors are read-only: `git fetch`
and `git worktree add/remove` run only inside `launch` and `retire`, which a
human starts. The guard flags and pushes; it never acts.

## Docs

| | |
| --- | --- |
| [docs/install.md](docs/install.md) | prerequisites, the service, HTTPS in front of it, the phone |
| [docs/fleet.md](docs/fleet.md) | fleet mode: builders and the hub, signed actions, scopes, the rollout order |
| [docs/config.md](docs/config.md) | every config key, its default and its environment variable |
| [docs/providers.md](docs/providers.md) | the three interfaces everything site-specific sits behind, and how to add one |
| [docs/map.md](docs/map.md) | the Map: the topology file, the feed format, pushing a feed from a hypervisor, builders on the Map |
| [docs/runs.md](docs/runs.md) | the run protocol: how an unattended agent loop tells laneboard its goal, rounds, scores, cost and needs |
| [SECURITY.md](SECURITY.md) | why there is no login, and what that means for where you put it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | `npm test`, the hygiene gate, what is deliberate |

## Licence

MIT. See [LICENSE](LICENSE).
