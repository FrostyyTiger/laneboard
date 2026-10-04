# The Map

The Board says which session needs you. The Map shows everything around it:
the machines your lanes run on, what else runs next to them, what depends on
what, and where the trouble is. It is drawn as a constellation:

- a **core** in the middle
- **sites** on the first ring
- **rooms** on the second ring
- **services** and **lanes** on the outer ring

Arcs across the rings show the relationships a tree cannot hold.

Open it with the **Map** tab, or `g p`.

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
- **The selection draws in.** Its ring closes onto the node and a hairline runs
  from the node to its panel.

**Folding.** A node with something inside can be folded: its children tuck into
it and it shows `+N` with a dotted ring. Select it and press `c`, or use **Fold**
in its panel; click the `+N` to unfold. Trouble inside a folded node still
colours it, links to what is folded away attach to it, and finding or picking a
folded node unfolds what hides it. Folds are remembered in this browser.

| Key | |
| --- | --- |
| `/` | find a node |
| `f` | fit everything |
| `c` | fold or unfold the selected node |
| `Esc` | close the panel |
| double-click | fly to a node (or fit, on empty space) |

## Three inputs, all optional

| Input | What | Who writes it |
| --- | --- | --- |
| topology | the nodes, links and probes | you, in `~/.config/laneboard/map.json` |
| feeds | snapshots other machines push | them, into `~/.cache/laneboard/feeds/` |
| probes | HTTP checks | laneboard itself, from the topology |

Lanes and sessions come from the board. With none of the three inputs, the Map
shows this host with its active lanes around it.

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
| `id` | Unique. `lane:` ids are reserved for laneboard's own lane nodes. |
| `parent` | The node this one sits inside. A node with no parent hangs off the core. |
| `kind` | `core`, `site`, `host`, `room`, `service`, `lane` or `pr`. Sets the ring and the shape. At most one `core`; without one, laneboard adds a core named after `title`. |
| `label`, `sub` | The name, and the small line under it. A feed or probe can replace `sub`. |
| `detail` | Key/value pairs shown in the side panel. |
| `feed` | `"source"` for a host, `"source/<vmid or name>"` for one of its guests, `"source/<vmid or name>/<service>"` for a service that guest lists. |
| `expect` | `"stopped"` for a guest that is meant to be off. It then shows idle, not down. |
| `probe` | `{ url, expect?, every?, timeoutMs?, method?, level? }`. `expect` is a code, a list of codes, or `"2xx"`. The default is any 2xx or 3xx. `level: "warn"` makes a failure amber instead of red. |
| `href` | An "Open" link in the side panel. |
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
- `events` appear once each, in the ticker and as a pulse on the node.
  - Events already in the file when laneboard first reads it are not replayed.
  - `guest` targets one of the host's guests.

### Pushing a feed from a Proxmox host

The host needs nothing but `pvesh`, which it already has, and an SSH key that
may do one thing on the laneboard machine. On the laneboard machine, add the
key to `authorized_keys` pinned to a forced command:

```
command="umask 022; f=~/.cache/laneboard/feeds/hv1.json; cat > \"$f.tmp\" && mv \"$f.tmp\" \"$f\"",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… feed@hv1
```

The key can only replace that one file. On the host, a timer runs something
like:

```sh
pvesh get /nodes/$(hostname)/qemu --output-format json  # and /lxc, /status
# …shape it into the format above, then:
ssh -i /root/.ssh/feed laneboard@board < feed.json
```

## API

- `GET /api/map` returns the model the view draws: `{ title, nodes, links, events, error?, generatedAt }`.
- Over the socket, a `{ type: "map", map }` message arrives:
  - on connect
  - whenever a status, label or link changes
  - otherwise at most every 5 seconds, while metrics move
