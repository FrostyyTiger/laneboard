# Providers

Everything site-specific in laneboard lives behind one of three small
interfaces, and each of them has a `none` implementation that does nothing and
says so. The point is not extensibility for its own sake: it is that a
laneboard on a machine with no agent stack, nothing live next to it and no
forge is the **default**, and still works.

| Interface | `none` | The real one |
| --- | --- | --- |
| **slots** | no slots; `launch` and `retire` refuse | `agent-stack` |
| **guard** | nothing is watched | `ports` |
| **ci** | no PR chips, no queue | `gh` |

They are chosen in the config file (`slots.provider`, `guard.provider`,
`ci.provider` — see `docs/config.md`), resolved once in
`server/providers/index.mjs`, and imported from there by name. Nothing else in
the server knows which one it is talking to.

```
server/providers/
  index.mjs              the table, and the chosen three
  slots/{none,agent-stack}.mjs
  guard/{none,ports}.mjs
  ci/{none,gh}.mjs
```

## Adding one

1. Write a module next to its siblings with the exports below.
2. Add it to `TABLE` in `server/providers/index.mjs`.
3. Add its name to the same kind's list in `validate()` in `server/config.mjs`.

Nothing else changes. A provider is plain ESM with no base class and no
registration call; `_set(kind, impl)` swaps one at runtime, which is how the
launch and retire tests run against a fake that starts nothing.

Two rules hold for every implementation:

- **Read-only unless asked.** Only `up`, `down` and `dropVolumes` may change
  anything, and only inside `launch` and `retire`, which a human starts. A
  collector calling a provider must not have side effects.
- **A failure is a value, not an exception.** Return `{ ok: false, error }`
  and let the caller decide; a provider that throws takes a collector down
  with it.

---

## SlotProvider

A slot is a private database (and whatever else) for one lane, so that two
lanes running test suites cannot drop each other's tenants.

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | What the Box shows. |
| `available` | `boolean` | `false` means `launch` refuses before touching anything. |
| `slotCount` | `number` | How many slots the Box has rows for. `0` for none. |
| `ports(n)` | `-> {pg, redis, s3} \| null` | The host ports a slot exposes, for the Box. |
| `envCommand(n, quote)` | `-> string` | A shell fragment prefixed to a lane session's command so the session starts with the slot's environment. `quote` is the shell quoter to use on anything from config. `''` for none. |
| `list()` | `-> {ok, bySlot: Map(n -> {containers[], up, createdAt})}` | Read-only; what exists right now. |
| `existing()` | `-> number[] \| null` | The slots that exist. **`null` means "cannot tell", and a launch refuses rather than guessing** — two lanes on one slot is exactly what slots prevent. |
| `up(n, {cwd, env})` | `-> {ok, stdout, stderr, code, signal, error?}` | Bring a slot up. May take minutes. `signal` matters: a child killed by a restart is an interruption, not a failure. |
| `env(n)` | `-> {ok, ports: {pgPort, redisPort, s3Port}, error?}` | The slot's ports. **Never returns credentials**: `launch` writes what comes back into a job record. |
| `down(n)` | `-> {ok, error?}` | Stop a slot. |
| `dropVolumes(n)` | `-> {ok, removed[], skipped[], error?}` | Delete that slot's persistent data. The one destructive call in the program: `retire` checks the slot is a lane slot first, and the provider should check again that every name it deletes belongs to that slot. |

## GuardProvider

Something live sits next to the agents — a shared database, a staging stack —
and the guard's job is to notice when one of them is about to touch it. It
**flags and pushes; it never acts.**

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | |
| `active` | `boolean` | `false` means the collector never starts and the Box shows no guard block. |
| `forbiddenPorts()` | `-> number[]` | Ports nothing of ours may reach. |
| `healthProbes()` | `-> [{name, url}]` | Shown on the Box. |
| `containerFilter()` | `-> string` | A `docker ps --filter name=` prefix, or `''`. |
| `health()` | `-> [{name, ok, status, ms, error?}]` | One entry per probe. HTTP GETs, nothing else. |
| `containers()` | `-> {ok, list}` | `list` is `[{name, state, status}]`. |
| `preventive(sessions)` | `-> [{session, lane, pid, reason}]` | Looking for trouble before it happens — the `ports` provider reads each session's `/proc/<pid>/environ`. |
| `detective(laneOf)` | `-> [{session, lane, pid, comm, port, reason}] \| null` | Trouble that already happened. **`null` means the check could not run**, which the Box shows as a state rather than an all-clear. `laneOf(sessionName)` maps a finding onto a card. |

Every finding becomes a `danger` marker: first in the attention order, pushed
at once, never coalesced, never silenced by quiet hours.

## CiProvider

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | |
| `active` | `boolean` | `false` means the collector never starts. |
| `prForBranch({repo, branch})` | `-> summary \| {none:true} \| {auth:false} \| {error}` | Four outcomes, and they are not interchangeable: `none` is "no PR yet", `auth` makes the caller back off for ten minutes and say `NEED-HUMAN` once, `error` is shown on the card. |
| `runs({repo})` | `-> {ok, queue} \| {auth:false}` | `queue` is `{runs[], queued, running, repo}`. |
| `mainRuns({slug, branch, limit=30, workflow?})` | `-> {ok, runs[]} \| {auth:false} \| {ok:false, error}` | Recent workflow runs on one branch (main), newest first, optionally of one workflow file. A run is `{id, attempt, workflow, workflowId, headSha, event, status, conclusion, createdAt, updatedAt}`; `status`/`conclusion` are lower case, `conclusion` is `null` while running, times are ms. |
| `runJobs({slug, runId})` | `-> {ok, jobs[]} \| {auth:false} \| {ok:false, error}` | The jobs of one run: `{id, name, status, conclusion, startedAt, completedAt, steps}`. `steps` is `{total, ran, skipped, failed, skippedNames[]}`, where `ran` counts the steps that are not setup (`SETUP_STEP`: `Set up job`, `Complete job`, `Post …`, checkout and `setup-*` actions) and `skipped`/`skippedNames` are the skipped ones among them. A green job with `ran > 0` and `skipped === ran` tested nothing. |
| `rateLimit()` | `-> {ok, remaining, limit, resetAt, graphql} \| {auth:false} \| {ok:false, error}` | The REST core budget that the run reads spend; `resetAt` in ms. `graphql` is the same shape for the bucket `pr view` spends. Reading it costs nothing. |
| `failedJobsForCommit({slug, sha})` | `-> [{workflow, job}]` | The failed jobs of a commit's failed runs. A failed run with no readable failed job is `{workflow, job:null}`. Any failure to list the runs gives `[]`. |

`slug` is `owner/name`, passed as `-R`, not taken from a checkout. These four
only need Actions read, so they work with a fine-grained token that has no
Checks permission. Every argument is checked before it reaches the CLI
(`{ok:false, error:'bad argument'}`, or `[]`); nothing is ever a flag.
The `none` provider has the same exports, returning `{ok:false}` (and `[]`).

A `summary` is:

```js
{
  number, url, state,          // OPEN | CLOSED | MERGED
  isDraft, mergeable, headSha,
  checks: { passed, failed, pending, total, failedNames[] },
  verdict,                     // red | pending | green | none
  viaRuns,                     // true: checks are the head commit's Actions runs
  firstReviewAt,               // ms of the first review by a person, or null
}
```

A fine-grained token is refused `statusCheckRollup`. `prForBranch` then reads
the PR without it and counts the Actions runs of the head commit instead, one
per workflow: `viaRuns` is `true` and `failedNames` holds **workflow** names,
not job names. `failedJobsForCommit` turns those into jobs.

`firstReviewAt` is the earliest `submittedAt` across `reviews` and
`latestReviews`, skipping pending reviews and bot authors (`…[bot]`, `…-bot`
and the known review apps).

`verdict` drives the chip and the `blocked` marker: red raises one marker per
head commit, and green after red dismisses it.

---

## FeedProvider

A feeder reads one source and turns it into one feed in the format of
`docs/map.md` "The feed format". It runs next to the source, usually from a
timer, and the Map only ever reads what it wrote: infrastructure data is
pushed in, never pulled by the board. Unlike the three above, a feeder is
chosen per command (`laneboard feed <kind>`), not by a config key, and nothing
in the server imports one.

```
server/feeders/
  index.mjs              TABLE, feeder(kind), collect(kind, opts)
  none.mjs               an empty feed that says so
  tailscale.mjs          `tailscale status --json` on this machine
  proxmox.mjs            the PVE API's `/cluster/resources`, read-only token
  docker.mjs             the local Docker socket's `/containers/json`, GET only
```

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | The kind, as `laneboard feed` takes it. |
| `toFeed(input, {source, now, every})` | `-> feed` | **Pure**: no clock, no I/O. `now` becomes `at`; `every` (seconds) defaults to 60. Tolerates missing and unknown fields (missing is unknown, never a throw). Never copies credentials or personal data into the feed. |
| `read(opts)` | `-> {ok:true, input} \| {ok:false, error}` | Gets the input once, with a timeout. A missing tool, a refused connection or a source with nothing to report is `{ok:false}`: an empty feed would draw every node as gone. |

`collect(kind, {source, now, every, ...readOpts})` in `index.mjs` is `read`
then `toFeed`: `{ok:true, feed}` or `{ok:false, error}`; `source` defaults to
the kind, and an unknown kind is a value, not an exception.

**`none`** reads nothing and returns `{source, at, every, note, host:{sub:
"no feeder"}, guests:[], events:[]}`.

**`tailscale`** runs `tailscale status --json` (no API key, no network; it
sees what this node may see). `read({bin, timeoutMs})` is `{ok:false}` when
the binary is missing, the command fails or times out, or the daemon is not
`Running` and logged in. `toFeed` makes this node the host and every peer a
guest of `type: "tailnet"`:

- the name is the MagicDNS label (the first label of `DNSName`, what `ssh
  <name>` reaches), else `HostName`, lower case;
- `status` is `running` while the peer is connected to the control plane
  (`Online`), `stopped` otherwise; an offline peer carries `lastSeen` (ms);
- `os`, `tags` and `ips` as fields, and in `detail` with subnet routes and
  the exit-node role; an expired node key is a `warn` alert; tailscale's own
  health messages are host alerts;
- nodes shared in from another tailnet are left out, as the CLI's listing
  does; login names, node keys and SSH host keys never reach the feed.

**`proxmox`** makes one `GET /api2/json/cluster/resources` call to a Proxmox
VE host with a read-only API token (`PVEAuditor`; the recipe is in
`docs/map.md`). `read({url, tokenId, secretFile, ca, node, timeoutMs})`:

- `url` is the API's `https://` origin (`https://hv1.example.invalid:8006`);
  plain `http` is refused, since the token would travel in clear;
- `tokenId` is `user@realm!name`; the secret is read from `secretFile`, else
  from `LANEBOARD_PVE_SECRET`, and is never a flag value, never logged, never
  in an error; the header is `Authorization: PVEAPIToken=<tokenId>=<secret>`;
- `ca` is a PEM file to trust (the PVE cluster CA, or the node's own
  certificate): the default certificate is self-signed, and there is no
  switch that skips verification;
- `{ok:false}` for a bad option, a refused connection, a timeout, an
  untrusted certificate, 401 (bad token or expired), 403 (no privilege), any
  other non-2xx, or an answer that lists no nodes.

`toFeed` maps the flat list by `type`:

- one `node` row is the host (`name`, `cpu`, `mem`/`maxmem`, root `disk`;
  `sub` like `PVE · 64 GB · 5/7 guests running`); a cluster's feed is the
  whole cluster (metrics summed over the online nodes, an offline node is a
  `warn`, every guest carries `node`), unless `node` picks one of them;
- `qemu` and `lxc` rows are guests (`vmid`, `name`, `type`, `status`, `cpu`,
  `mem`/`maxmem` with `memCache: true`, `disk` only when PVE knows it, which
  for a qemu guest it usually does not, `uptime`, `tags` split from PVE's
  `;` string, lock and HA state in `detail`);
- a template is a guest with `template: true`: listed, never counted as
  running or stopped, and drawn at rest on the Map, never down;
- a storage at 90% is a `warn` host alert, at 97% `crit` (a shared storage
  once, at its fullest); pools and SDN rows are ignored.

**`docker`** sends one `GET /containers/json?all=1` (what `docker ps -a`
lists) over the Docker Engine's local unix socket, and no other request.
`read({socket, timeoutMs})`:

- `socket` defaults to `/var/run/docker.sock`; no version prefix is sent, so
  the daemon answers in its own version;
- `{ok:false}` for a missing socket, no permission (the user is not in the
  `docker` group), a refused connection, a timeout, a 403 (a socket proxy
  without `CONTAINERS=1`), any other non-2xx, or a body that is not a JSON
  list. An empty list is an answer: the Engine has no containers.

The socket has no read-only mode: write access to it is root on the machine.
A user in the `docker` group trusts the feeder to send only that GET; a
GET-only socket proxy (such as `docker-socket-proxy` with `CONTAINERS=1` and
`POST=0`) takes that trust away, and `socket` can point at the proxy's own
unix socket. `CONTAINERS=1` lets a proxy pass more than the list (logs, for
one), so keep the proxy's socket readable by the feeder's user only.

`toFeed` makes the Engine the host (`sub` like `docker · 4/6 containers
running`; named by the feed's `source`) and every container a guest of
`type: "container"`:

- the name is the first of `Names` without its leading `/`; `State` (in any
  case) `running` and `restarting` are `running`, `paused` is `paused`,
  `exited`, `dead`, `created` and `removing` are `stopped`, with `why` giving
  the exit code (`exited with code 1`);
- health comes from the trailing `(healthy)`, `(unhealthy)` or
  `(health: starting)` of `Status`, the only place the list has it: unhealthy
  is a `crit` alert, `restarting` is a `crit` alert with its exit code;
  starting and healthy are only in `detail`; no healthcheck is no health;
- each published port (one per port and protocol; Docker lists IPv4 and IPv6
  twice) is a service named `<port>/<proto>` (`8080/tcp`, so the ref is
  `builder-a/acme-web-1/8080/tcp`) with `port`, `ok` while the container runs
  (`crit` when unhealthy, `warn` while starting or paused); exposed ports that
  are not published are left out; the image and the port words (`:8080`) are
  the guest's `sub`, so Find reaches a container by its port;
- `detail` has the image, the compose project and service
  (`com.docker.compose.project` / `service`), Docker's `Status` text, health,
  the ports and a 12-character id. `Command`, every other label, mounts and
  network addresses never reach the feed.
