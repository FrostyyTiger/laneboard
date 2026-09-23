# laneboard

One page that shows every Claude Code session on a machine, grouped into
**lanes** — a lane being a git worktree with one branch, one plan and one piece
of work — plus the two acts that make a lane, `launch` and `retire`.

One Node 24 process, no build step, six dependencies. It binds `127.0.0.1`
only: laneboard has no login and can type into terminals, so anything that
exposes it (a tailnet, a reverse proxy) has to do the authentication.

| View | Answers |
| --- | --- |
| **Board** `#board` | What is each lane doing, and which one wants me? One card per lane — progress and current stage, branch, PR and checks, agent slot, model, 5 h spend, last marker — with its sessions inside as rows. Sorted by the most urgent thing inside. |
| **Morning** `#morning` | Over a window (12 h / tonight / 24 h / 7 d): what needs a human (`danger` first), what finished (with its PR), what it cost. |
| **Credit** `#credit` | Where the 5 h and 7 d rate-limit windows have been, and what each lane spent. |
| **Box** `#box` | The machine, a live stack next to it and its guard, the CI queue, the agent slots. |

`g b` · `g m` · `g c` · `g x` switch views. `j` `k` `p` `Enter` `Esc` `1`–`9`
work on the Board.

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

A second copy for testing, which touches neither the file nor the database:

```bash
LANEBOARD_PORT=7788 LANEBOARD_DB=:memory: LANEBOARD_CONFIG=/dev/null \
  node server/index.mjs
```

## CLI

```bash
laneboard ls                     # every session, attention first
laneboard peek <name> -n 40
laneboard send <name> "keep going"
laneboard morning [--window tonight|12h|24h|7d]
laneboard credit
laneboard launch <lane> --plan docs/plans/<lane>.md
laneboard retire <lane> [--force]
```

`LANEBOARD_URL` overrides the server address.

## Nothing destructive happens on its own

`retire` refuses a live session always, and a dirty or unmerged lane without
`--force` plus the lane id typed back. Collectors are read-only: `git fetch`
and `git worktree add/remove` run only inside `launch` and `retire`, which a
human starts. The guard flags and pushes; it never acts.

## Docs

| | |
| --- | --- |
| [docs/install.md](docs/install.md) | prerequisites, the service, HTTPS in front of it, the phone |
| [docs/config.md](docs/config.md) | every config key, its default and its environment variable |
| [docs/providers.md](docs/providers.md) | the three interfaces everything site-specific sits behind, and how to add one |
| [SECURITY.md](SECURITY.md) | why there is no login, and what that means for where you put it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | `npm test`, the hygiene gate, what is deliberate |

## Licence

MIT. See [LICENSE](LICENSE).
