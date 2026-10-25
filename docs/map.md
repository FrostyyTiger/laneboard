# The Map

The Board says which session needs you. The Map shows everything around it:
the machines your lanes run on, what else runs next to them, what depends on
what, and where the trouble is. It is drawn as a constellation:

- a **core** in the middle
- **sites** on the first ring
- **rooms** on the second ring
- **services**, **builders** and **lanes** on the outer rings

Arcs across the rings show the relationships a tree cannot hold.

The Map is the home view: `#/map`, or `g m` from anywhere. It stays on the Map:
no other view carries a minimap of it over its content.
It looks the same on a standalone builder (a fleet of one) and on a hub (the
whole fleet).

Movement on the Map is always data:

| You see | It means |
| --- | --- |
| a comet along an arc | an event travelled that link |
| an expanding ring | an event landed on that node |
| a repeating ping | the node is waiting for you, or failing |
| a turning arc around a diamond | that lane is working |
| two thin arcs around a room | CPU (inner) and memory (outer) |

`prefers-reduced-motion` turns every animation off. The map then redraws only when something changes.

What you do moves it too, built to be followed rather than noticed:

- **Changes play in beats.** What leaves folds back into its parent, what stays
  swings along its ring to its new place, and what arrives grows out of its
  parent, one node after another around the circle.
- **Jumps are flights.** Picking a node far away pulls back, crosses and comes in
  again (van Wijk & Nuij's smooth zoom), so you never lose where you are.
- **Everything is a spring.** Positions, fades and zoom start from the speed they
  already have and settle without bouncing, so a new click mid-move bends the
  motion instead of restarting it. A drag glides on after you let go.
- **The selection draws in.** Corner brackets close onto the node, and its
  details, tabs and actions open in the inspector on the right.

**Folding.** A node with something inside can be folded: its children tuck into
it and it shows `+N` with a dotted ring. Select it and press `c`, or use **Fold / unfold**
in the inspector; click the `+N` to unfold. Trouble inside a folded node still
colours it, links to what is folded away attach to it, and finding or picking a
folded node unfolds what hides it. Folds are remembered in this browser.

**The look.** Healthy nodes are grey; hue and shape appear only on trouble
(■ crit, ▲ warn, ◆ low), so what is coloured is what needs you. The rings carry
labels and a bearing dial (its 000/090/180/270 numbers only while the whole
dial is in view, so a cut-off one never reads as a node's label); the readout corner (top right) shows zoom, scope,
node count, overlay and the clock. On a phone it is shorter and drops the
clock first while an overlay is on: `Z 1.00× · N 22/24 · DRIFT ◌1 □1`,
`… · REACH 9` (`REACH 3/9` with a node selected: touches/links).

**Overlays.** `o` cycles what the colour means (`O` goes back), and the choice
is remembered in this browser:

| Overlay | Lanes and sessions are coloured by |
| --- | --- |
| `status` | their state (the default); in every overlay a lane in trouble keeps its own colour |
| `ci` | their CI: fail red, running animated, pass calm, none a ring; CI links stay drawn |
| `cost` | spend over 24 h, against the builder's budget cap when one is set |
| `context` | context window use (50 / 70 / 85 %) |
| `age` | time since the last change (10 m, 1 h, 4 h, 24 h) |
| `drift` | declared against discovered: a dashed warn ring on a declared node no fresh feed lists ("declared, not seen"), a solid warn square on a discovered one ("seen, not declared"), everything else dimmed; the readout counts both, each count after its mark (`◌ NOT SEEN 1  □ NOT DECLARED 1`, see "Drift") |
| `reach` | who can reach what, from the policy file (see "Reach"): thin grey arcs with an arrowhead at the target; select a node to answer "if this is compromised, what can it touch?": its outgoing arcs turn accent with their ports, the nodes it reaches directly get an accent ring, the rest dims; the readout shows `LINKS n`, `TOUCHES n` and `UNRESOLVED n` when some selectors could not be placed. Only in the cycle when the model has reach links (`o` skips it otherwise) |

**Scope and split.** Picking a builder in the rail (or `[` `]`, `1`-`9`)
ghosts every other builder and flies to its subtree. `\` splits the Map with a
dense lane table on the right (from 900 px wide), worst first; hovering a row
lights its node and the other way round.

**Find from anywhere.** `⌘K` (Ctrl-K) lists the Map's machines and services
next to builders and lanes, each with where it runs and its ports
(`postgres` · `:5432 on hv1/db`), so a service name or a port (`:5432`) finds
the node; `n:` keeps only nodes. Choosing one opens the Map and flies there
(`#/map?sel=node:<id>`). Ports come from the port in a node's `href` and the
Reach links into it. Until a Map model has loaded, there are no node rows.

| Key | |
| --- | --- |
| `/` | find a node |
| `f` | fit everything |
| `c` | fold or unfold the selected node |
| `o` / `O` | next / previous overlay |
| `\` | split with the lane table |
| `Esc` | close the inspector |
| double-click | fly to a node (or fit, on empty space) |
| pinch, wheel | zoom (pinch on a phone) |

## Three inputs, all optional

| Input | What | Who writes it |
| --- | --- | --- |
| topology | the nodes, links and probes | you, in `~/.config/laneboard/map.json` |
| feeds | snapshots other machines push | them, into `~/.cache/laneboard/feeds/` |
| probes | HTTP checks | laneboard itself, from the topology |

Lanes and sessions come from the board, or on a hub from every builder. The
topology file is optional: with feeds and no file, the Map is drawn from the
feeds alone (see "Discovered nodes"), and the file only adds what no feed can
know (sites, names, groups, links). With
none of the three inputs, the Map shows this builder with its active lanes
around it (on a hub: `core → FLEET → builder:<id> → lanes`).

**laneboard never connects out to what it watches, apart from the probes you
list.** Everything else arrives as a file that the other machine pushed. This is
deliberate: a board that runs agents is often the least trusted machine you
have. Drawing a map of your infrastructure should not give it credentials for
that infrastructure.

| Config key | Default | Env |
| --- | --- | --- |
| `map.file` | `~/.config/laneboard/map.json` | `LANEBOARD_MAP_FILE` |
| `map.feedsDir` | `~/.cache/laneboard/feeds` | `LANEBOARD_MAP_FEEDS` |
| `map.feedStaleMs` | `300000` | — |
| `map.probeEverySec` | `60` | — |
| `map.policyFile` | `null` (none) | `LANEBOARD_MAP_POLICY` |

## The topology file

```json
{
  "title": "lab",
  "self": "agents",
  "nodes": [
    { "id": "hv1", "kind": "site", "label": "hv1", "feed": "hv1" },
    { "id": "web", "parent": "hv1", "kind": "room", "feed": "hv1/101", "sub": "reverse proxy" },
    { "id": "agents", "parent": "hv1", "kind": "room", "feed": "hv1/107" },
    { "id": "spare", "parent": "hv1", "kind": "room", "feed": "hv1/109", "expect": "stopped" },
    { "id": "cloud", "kind": "site" },
    { "id": "chat", "parent": "cloud", "kind": "room",
      "probe": { "url": "https://chat.example.com/api/v4/system/ping", "every": 60 },
      "href": "https://chat.example.com" },
    { "id": "mm", "parent": "chat", "kind": "service", "label": "Mattermost" }
  ],
  "links": [
    { "from": "web", "to": "chat", "kind": "dep", "label": "posts alerts" },
    { "from": "agents", "to": "web", "kind": "flow", "label": "deploys", "live": true }
  ],
  "lanes": {
    "show": "active",
    "links": [{ "match": "^chat-", "to": "mm", "label": "changes" }]
  }
}
```

**Nodes**

| Field | What |
| --- | --- |
| `id` | Unique. `lane:`, `builder:`, `sess:`, `repo:`, `pkg:`, `feed:` and `run:` ids, and `__core`, `__fleet`, `__repos`, are reserved for laneboard's own nodes. |
| `parent` | The node this one sits inside. A node with no parent hangs off the core. |
| `kind` | `core`, `site`, `host`, `room`, `service`, `lane` or `pr`. Sets the ring and the shape. At most one `core`; without one, laneboard adds a core named after `title`. `builder`, `session`, `repo`, `package` and `run` are made by laneboard and refused in the file. |
| `builder` | The builder id this node hosts (`"builder": "builder-a"`): the builder and its lanes hang under it. One node per builder id. |
| `ci` | `{ "runner": true, "for": ["builder-a"] }` (or `"for": "*"`): this node is a CI runner serving those builders; a `ci` link to each is live while a run for one of its lanes is in progress. |
| `label`, `sub` | The name, and the small line under it. A feed or probe can replace `sub`. |
| `detail` | Key/value pairs shown in the inspector. |
| `feed` | `"source"` for a host, `"source/<vmid or name>"` for one of its guests, `"source/<vmid or name>/<service>"` for a service that guest lists. |
| `expect` | `"stopped"` for a guest that is meant to be off. It then shows idle, not down. |
| `probe` | `{ url, expect?, every?, timeoutMs?, method?, level? }`. `expect` is a code, a list of codes, or `"2xx"`. The default is any 2xx or 3xx. `level: "warn"` makes a failure amber instead of red. |
| `href` | An "Open" link in the inspector. |
| `order` | Sort order among siblings. |

**How a node's status is decided**

- **It has a feed or a probe:** the worse of the two.
- **It is a site or the core:** it has no status of its own. The view rolls its children up instead.
- **Its parent has a feed or a probe:** it takes the parent's status (up, down or no data), because it cannot be up inside a stopped room.
- **Anything else:** `unknown`. A node that is never checked should not show green.

**Links**

- `kind: "dep"` means "depends on" and is drawn dashed.
- `kind: "flow"` means something moves along it.
- `kind: "share"` means both ends use the same resource, such as a GPU. It is drawn dotted.
- `live: true` animates the link.
- `touch`, `conflict`, `pkg` and `ci` are laneboard's own (below) and refused
  in the file.

**Lanes**

- `show`:
  - `active` (the default): only lanes with a session
  - `all`: every worktree
  - `none`: no lanes
- `links`: each rule links every lane whose id or branch matches `match` (a regular expression) to `to`. The link is live while the lane is working.

If the file stops parsing, the map keeps the last good version and shows the
error under the title.

## The feed format

One JSON file per source in `feedsDir`, named `<source>.json`. Write it to a
temporary name and rename it into place, so that laneboard never reads a
half-written file.

```json
{
  "source": "hv1",
  "at": 1790000000000,
  "every": 30,
  "host": {
    "cpu": 0.31, "mem": 0.71, "disk": 0.42,
    "sub": "PVE 9 · 64 GB",
    "detail": { "CPU temp": "58 °C" },
    "alerts": [{ "level": "warn", "text": "NVMe at 76 °C" }]
  },
  "guests": [
    { "vmid": 101, "name": "web", "type": "qemu", "status": "running",
      "cpu": 0.09, "mem": 2147483648, "maxmem": 8589934592, "uptime": 86400 },
    { "vmid": 104, "name": "ci", "type": "qemu", "status": "running", "disk": 0.35,
      "alerts": [],
      "services": [
        { "name": "runner-1", "status": "working", "sub": "job · 4m" },
        { "name": "runner-2", "status": "idle", "sub": "waiting for a job" }
      ] }
  ],
  "events": [{ "at": 1790000000000, "kind": "ok", "text": "nightly backup finished", "guest": 101 }]
}
```

**Fields**

- `at`: milliseconds since the epoch.
- `every`: the push interval in seconds.
- A feed older than `3 × every` (or `feedStaleMs`, whichever is longer) turns
  its nodes to *no data*. The map never shows a stale green.
- `cpu` is a fraction, `0` to `1`.
- `mem` / `maxmem` is in any unit, since only the ratio is used. A guest can
  instead give `memFrac` directly.
- `status` is `running`, `stopped`, `paused` or `suspended`.
- `memCache: true` says the memory figure counts page cache (a VM seen from
  its hypervisor). The gauge is then drawn neutral and never as a warning.
- A guest's `alerts` work like the host's: while the guest runs, the worst one
  sets its status and its text says why (`{ "level": "crit", "text": "disk 99% full" }`).
- A guest's `services` are what runs inside it, for a topology node whose
  `feed` names one (`"hv1/104/runner-1"`).
  - `status` is `ok`, `working` (busy, like a runner on a job), `idle` (up,
    nothing to do), `warn`, `crit` or `down`. Anything else shows as unknown.
  - `sub`, `why` and `detail` work as on a node.
  - A service the guest does not list is unknown; every service of a stopped
    guest is down.
- `type` is `qemu`, `lxc`, `tailnet` for a peer the `tailscale` feeder
  saw, or `container` for one the `docker` feeder listed (`docs/providers.md`
  "FeedProvider").
- `template: true` marks a guest that is a template (the `proxmox` feeder):
  stopped is its normal state, so it is drawn at rest, never down. `node` on
  a guest names the cluster node it runs on.
- Optional, for nodes a feeder discovers: `name` on the host, and `os`,
  `tags` (`["tag:ci"]`), `ips` (strings) on the host and on a guest;
  `lastSeen` (ms) on a guest that is offline. A `tailnet` guest that is not
  `running` is drawn idle, "offline, last seen 3h ago" (or "offline"), never
  down: a peer that sleeps is not broken. A stopped `qemu`/`lxc` guest stays
  down. `note` on the feed says why it
  is empty (the `none` feeder).
- `events` appear once each, in the event tape and as a pulse on the node.
  - Events already in the file when laneboard first reads it are not replayed.
  - `guest` targets one of the host's guests.

### Discovered nodes

Every machine a feed names is drawn, declared or not. A feed's host and each
of its guests is a machine, named by `host.name` (else the source) and the
guest's `name` (else its `vmid`). Names compare case-insensitively.

- A topology node claims a machine by its `feed` ref, or by its `label` or
  `id` equal to the machine's name. A node claimed by name without a `feed` of
  its own takes that machine's live data, as if the ref were written.
- A machine nobody claims becomes a node with `discovered: true`: a `site`
  per feed source (id `feed:<source>`) and a `room` per guest
  (`feed:<source>/<vmid or name>`) under the node its source's host became.
- One machine named by several feeds is one node: a tailnet peer that is also
  a Proxmox guest or host is drawn once. The richest view leads (a host, then
  a guest with CPU or memory numbers, then the rest); the others add their
  `detail` (its tailnet addresses, say) and `Seen by` lists the sources.
- Inside one source a machine is its `vmid` (else its name): two Proxmox
  guests named `web` on two cluster nodes are two nodes. Names merge only
  across sources, and a machine of another source named `web` joins one of
  them; two declared nodes named `web` claim one each.
- A feed naming the machine the core is named after (the title, else the
  hostname) hangs its guests on the core instead of drawing it twice.
- A builder whose id is a discovered guest's name hangs under that room.

### Drift

With a topology file, the model marks where the file and the feeds disagree:

- `drift: "missing"`: a declared node whose feed ref names a guest that
  source no longer lists ("declared, not seen").
- `drift: "undeclared"`: a discovered node ("seen, not declared").

Only a fresh feed marks anything: a source that has not reported, or reported
too long ago, is no data, not drift. Without a topology file nothing is
declared, so nothing drifts. A service ref and `expect: "stopped"` are not
drift; drift never changes a node's status.

### Reach

Opt-in: name a Tailscale policy file in `map.policyFile` (or
`LANEBOARD_MAP_POLICY`) and the model gets a `reach` block saying who can
reach what. laneboard reads that file only; it never fetches a policy (that
would need an API key). Export it from the admin console when it changes.

```json
"reach": {
  "links": [{ "id": "reach:<from>><to>", "kind": "reach", "from": "…", "to": "…", "ports": ["tcp:443"], "label": "tcp:443" }],
  "rules": 5,
  "unresolved": 1
}
```

- The file is HuJSON: JSON plus `//` and `/* */` comments and trailing
  commas. A file that does not parse keeps the last good policy, and
  `reach.error` says why.
- `grants` (with `ip`) and legacy `acls` (`dst` as `host:ports`) are read;
  rules only allow, so a link is the union of every rule. An `app`-only
  grant, `ssh`, `tests` and `nodeAttrs` are not reachability and are skipped.
- A selector is resolved against what the feeds say of each node: its `tag:`
  tags and its addresses (`ips`). A node is on the tailnet when a feed gives
  it either. `*`, `tag:`, `autogroup:tagged`, `autogroup:member` (the untagged
  nodes), `hosts` aliases, addresses, CIDRs and `ipset:` (one level) resolve;
  `group:`, users, roles, `autogroup:self` need who owns each node, so they
  are counted in `unresolved` instead of guessed, as is a selector that
  names no node on this Map. Only the count leaves the server, never the
  selector text; the policy file itself says which ones they are.
- Reach links are not in `links`: only the `reach` overlay draws them. With no
  `map.policyFile` there is no `reach` block, and `o` skips the overlay.
- The overlay shows one hop: what the selected node reaches directly, not
  what those nodes reach in turn. A link to a folded node lands on the node
  it is folded into.

### Pushing a feed

`laneboard feed <kind>` runs one feeder once, next to the source, and puts
the feed where the board reads it. It needs no server and no config.
A feed holds the real host names and addresses of the machines it lists, so
keep it (and screenshots of the Map) out of bug reports and public pastes.

```sh
laneboard feed tailscale                               # print the feed
laneboard feed tailscale --out ~/.cache/laneboard/feeds/tailscale.json
laneboard feed proxmox --source hv1 --url https://hv1.example.invalid:8006 \
  --token-id 'laneboard@pve!map' --secret-file /etc/laneboard/pve.secret \
  --ca /etc/laneboard/pve-root-ca.pem --every 30
laneboard feed docker --source builder-a --out ~/.cache/laneboard/feeds/builder-a.json
```

| Flag | Meaning |
| --- | --- |
| `--source s` | The feed's name and its file `<feedsDir>/<s>.json`; defaults to the kind. Letters, digits, `.` `_` `-`. |
| `--every N` | Seconds between runs; the board calls the feed stale after `3 × N`. Defaults to 60. |
| `--timeout s` | How long the read may take. Defaults to 10. |
| `--stdout` | Print the feed. The default. |
| `--out f` | Write the feed to `f`, to a temporary name first and renamed into place, mode 0600 (a feed names machines and addresses). |
| `--push url` | POST the feed to `<url>/api/map/feeds`, with the `x-laneboard` header. |
| `--url`, `--token-id`, `--secret-file`, `--ca`, `--node` | `proxmox` only: the API, the token, a file holding its secret (else `LANEBOARD_PVE_SECRET`; never a flag), the CA certificate, one cluster node. |
| `--socket path` | `docker` only: the Engine's unix socket, or a GET-only proxy's. Defaults to `/var/run/docker.sock`. |

An unknown kind, `none` or a bad flag exits 2; a source that cannot be read
exits 1 and writes nothing, so the board shows the old feed going stale
instead of every node gone. `--push` is loopback only: the board answers
403 to any caller that is not this machine (a tailnet browser or a hub
included), so push to a board on the same machine.

**On the board's machine** (a tailnet seen from there), a `--out` into the
feeds directory is enough.

**From another machine**, such as a Proxmox host, send the printed feed over
SSH with a key that may do one thing. On the board's machine, add the key to
`authorized_keys` pinned to a forced command:

```
command="umask 022; f=~/.cache/laneboard/feeds/hv1.json; cat > \"$f.tmp\" && mv \"$f.tmp\" \"$f\"",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… feed@hv1
```

The key can only replace that one file. On the source, a systemd timer runs
the feeder every 30 seconds:

```ini
# /etc/systemd/system/laneboard-feed.service
[Unit]
Description=laneboard feed for the Map

[Service]
Type=oneshot
User=laneboard
RuntimeDirectory=laneboard-feed
ExecStart=/bin/sh -c 'f=/run/laneboard-feed/hv1.json; \
  laneboard feed proxmox --source hv1 --every 30 --out "$f" \
    --url https://127.0.0.1:8006 --token-id "laneboard@pve!map" \
    --secret-file /etc/laneboard/pve.secret --ca /etc/laneboard/pve-root-ca.pem \
  && ssh -i ~/.ssh/feed laneboard@board < "$f"'

# /etc/systemd/system/laneboard-feed.timer
[Unit]
Description=Run the laneboard feed every 30 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=30s
AccuracySec=1s

[Install]
WantedBy=timers.target
```

```sh
systemctl enable --now laneboard-feed.timer
```

Keep `--every` equal to the timer's interval. The feed goes to a file first
and `ssh` runs only when the feeder exits 0: piping a failed read straight
into `ssh` would send nothing and empty the file on the board.

### Docker without the whole socket

The `docker` feeder sends one `GET /containers/json?all=1` and nothing else,
but the Docker socket cannot tell a reader from a writer: a user who may open
it may also start a privileged container. Either run the feeder as a user in
the `docker` group and trust that, or put a GET-only proxy in front of the
socket and give the feeder the proxy's socket with `--socket`. A proxy that
allows the container list (`CONTAINERS=1`, `POST=0` on
`docker-socket-proxy`) also allows other GETs under `/containers` (logs, for
one), so its socket stays readable by the feeder's user only, never on the
network. Name the feed after the machine (`--source builder-a`) so its
containers hang under that node on the Map.

### A read-only Proxmox token

The `proxmox` feeder (`docs/providers.md` "FeedProvider") reads the PVE API
with a token that can only look. On the PVE host, as root:

```sh
pveum user add laneboard@pve
pveum user token add laneboard@pve map      # privilege separation stays on
pveum acl modify / --roles PVEAuditor --users laneboard@pve
pveum acl modify / --roles PVEAuditor --tokens 'laneboard@pve!map'
```

A separated token sees what both its user and itself may see, so both get
the ACL. The secret is shown once: put it in a file only the feeder's user
can read (`chmod 600`) and name that file, or set `LANEBOARD_PVE_SECRET`.
Check the flag spelling with `pveum help acl modify` on your version. For the
certificate, copy the cluster CA (`pve-root-ca.pem` under `/etc/pve/`) next
to the feeder and pass it as the CA file.

## Builders, lanes and the links between them

Every builder is a node `builder:<id>`, labelled with its code. It hangs under
the topology node whose `builder` field names it; on a standalone builder,
under the node `self` names; on a hub, else under a room whose feed guest is
named like the builder; otherwise under a synthetic **FLEET** site, where it
says `not in topology` so you know to add the field. The builder node takes
its link state from the hub (`up`, `stale`, `down`), and its room takes the
worse of its feed and that link. When a builder goes down, the event list
says so once, and its lanes keep their last status, greyed.

Lane ids carry the builder (`lane:builder-a/payments`), so two builders may
both have a lane `payments`. A lane with two or more live sessions shows each
as a child `sess:<builder>/<name>`. Lanes carry flags (`stuck`, `paused`,
`awaitingApproval`, `reviewReady`) and the measures the overlays read.

With packages data, a **REPOS** island holds one `repo:<name>` per repo and one
`pkg:<repo>/<pkg>` per package, coloured by its CI on main. New links:

| Link | Between | Means |
| --- | --- | --- |
| `touch` | lane, lane | both change the same files |
| `conflict` | lane, lane | a predicted merge risk (warn), or a real merge-tree conflict (crit) |
| `pkg` | lane, package | the lane changes that package; live while it works |
| `ci` | builder, runner | the runner serves that builder; live while it runs one of its lanes |

One edge per lane pair: a conflict replaces a touch, a confirmed conflict a
predicted one. The full model is in [fleet/map.md](fleet/map.md).

## Runs

Every run the board reads (the runs protocol, [runs.md](runs.md)) is a node,
`kind: "run"`, id `run:<id>`, linking to its page `#/runs?run=<id>`:

- **Where:** under the machine its `run.start` names in `host`, when a node
  of the Map has that name (label or id, any case: a declared node, a
  discovered VM, a builder); else under the core, the machine whose board
  reads the run file. A throwaway VM a feed lists carries its run; when the
  feed no longer lists the VM, the run falls back to the core and its detail
  says the host is not on the Map.
- **Progress** (0-1, the ring): the latest `tasks` score over its `max`, else
  rounds over `budget.rounds`; none when neither is known.
- **Status:** `working` while it runs, `warn` when a run stuck rule fires
  (`stuck` carries `{rule, reason}`), `crit` when it stopped on `error`,
  else `idle`. Also `state`, `round`, `maxRounds`, `goal`.
- A stopped run stays `runs.mapKeepMin` minutes (default 60), then leaves.
  No runs, no run nodes. A hub has no runs yet, so its Map has none.
- **How it looks:** a small dot in a ring; the arc over the grey track is the
  progress, from twelve o'clock. Grey while the run is fine, amber with ▲
  when it is stuck, red with ■ when it stopped on an error; a run that
  stopped fine is hollow and faded. The label is the run's name with its
  round beside it (`7/10`). Selecting it opens the inspector with the goal,
  round, progress, why it is stuck, and **Open run ›** to its page.

## On a hub

The hub draws the Map from three sources: its own topology file and probes,
the **feeds** pushed to its own `map.feedsDir`, and the merged state of every
builder (their lanes, sessions, packages and CI). It rebuilds 1 s after any
change and every 5 s, and resends at most every 10 s while only metrics move.

**Feeds move to the hub.** A builder with `fleet.hubKeys` set no longer reads
its feeds directory, and its own `/api/map` says `"feeds": false`. So once the
hub key is pinned, point every feed pusher at the hub box instead: the same
forced-command `authorized_keys` line, on the hub's laneboard user, writing
into the hub's `~/.cache/laneboard/feeds/`. Nothing else changes in the format.
A builder without a hub key keeps reading feeds as before.

Probes run on the hub too, from the hub's own topology file.

## Ambient: the Map on a wall or desk screen

The Map module can run on its own as something to look at from across a room:
no HUD and no input, the constellation turning slowly inside a still dial (one
turn in ten minutes), frames capped at 30 per second so a small machine stays
cool. The movement on it still means what the table above says.

```js
import { createMap } from './js/views/map/index.js';
const map = createMap(el, { ambient: true });   // or { ambient: { drift: radiansPerSecond, fps } }
map.update(await (await fetch('/api/map')).json());
map.onDraw(() => { /* after every frame: map.screenOf(id) is where a node is drawn now */ });
map.focus('m87', 2.4);  /* … */  map.fit();   // a camera tour: fly in, hold, fly out
```

The turn is around the centre of the view, so a node the camera flew to turns
in place; flights in this mode take 2.5 times as long (`flight`).

`prefers-reduced-motion` stops the turn like every other animation. A page
that wakes on touch puts its own layer over the Map; the Map never takes input
in this mode.

## API

- `GET /api/map` returns the model the view draws: `{ title, fleet: {builders}, nodes, links, events, error?, feeds?, generatedAt }`. `feeds: false` means this board does not read feeds (a builder a hub watches).
- `POST /api/map/feeds` takes one feed as the body (what `laneboard feed --push` sends) and writes it to `<feedsDir>/<source>.json` (temporary name, then rename); the Map reads it on its next tick. `201 {ok, source, at}`; `400 {error}` for bad JSON, a bad shape (a feed needs a `host` object or a `guests` list; `host: {}` or `guests: []` is a valid empty feed) or a `source` that is not letters, digits, `.` `_` `-`; `413` over 1 MiB; `409` on a builder a hub watches (push to the hub). The normal local guards apply, so a request without `x-laneboard: 1` is `403`. A feed without `at` gets the board's time.
- Over the socket, a `{ type: "map", map }` message arrives:
  - on connect
  - whenever a status, label, flag, structure or link severity changes
  - otherwise at most every 5 seconds on a builder (10 on a hub), while metrics move
