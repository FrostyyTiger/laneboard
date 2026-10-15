# The fleet Map

With a fleet, the Map is one picture of every builder: the topology you
describe (sites, rooms, services), each **builder** inside the room that hosts
it, its **lanes** and **sessions**, the **packages** lanes touch, and the CI
runners builders use. A standalone builder draws the same picture for one
builder, so the Map looks and behaves the same in both modes.

This page covers what fleet adds to the Map model. The topology and feed
formats themselves are in [`docs/map.md`](../map.md).

## Where a builder appears

Every builder is a node `builder:<id>`, labelled with its code (`BA`, `B1`).
It hangs under:

1. the topology node whose `builder` field names it:

   ```json
   { "id": "agents", "parent": "hv", "kind": "room", "feed": "hv/104", "builder": "builder-a" }
   ```

   A builder id may be claimed by one node only.
2. on a standalone builder, the node `self` names (older `map.json` files keep
   working: `self` means "this board's own builder");
3. on the hub, with no `builder` field, a node whose feed guest is named like
   the builder id;
4. otherwise a synthetic **FLEET** site (`__fleet`) next to your topology. Its
   builders say `not in topology`, so you know to add the `builder` field.

With no topology file at all, the Map is `core → FLEET → builder:<id> → lanes`.

On the hub, `self` names no builder (the hub is not one); a node it names is
an ordinary node with its feed status.

## Builder status

| link (from the hub's connection) | builder node | lanes under it |
| --- | --- | --- |
| `up` | `ok`, or `warn`/`crit` from its latest health alarm | live |
| `stale` (also while connecting) | `unknown` | keep their last status, greyed (`stale`) |
| `down` (also misconfigured, incompatible) | `down`, "no contact for 2m" | keep their last status, greyed (`stale`) |

A builder never takes on its lanes' attention: the view rolls that up.

The room hosting a builder takes the worse of its feed status and the
builder's link status; a room with no feed of its own takes the link status.
Its gauges come from the builder's own health sample while it is fresh (under
a minute), else from the feed. The builder node's gauges come from that health
sample, else from the builder's vitals.

When a builder goes down, the event list says it **once** (`builder builder-a
is down · no contact for 2m`): its lanes and its room say nothing that tick.
In a fleet of more than one builder, lane events carry the builder code
(`BB payments needs you`).

## Lanes and sessions

Lane ids carry the builder: `lane:<builder>/<lane>`, so two builders may both
have a lane `payments`. A lane with two or more live sessions shows each as a
child node `sess:<builder>/<name>`. Lanes and sessions carry `flags`
(`stuck`, `paused`, `awaitingApproval`, `reviewReady`: only the ones set) and
overlay measures `m` (`costUsd`, `ctxPct`, `ageMs`, `ci`).

## Repos, packages and the new links

When packages data exists, a **REPOS** island (`__repos`) holds one
`repo:<name>` per repo and one `pkg:<repo>/<pkg>` per package, coloured by its
CI on main (`fail` is red with the reason, `running` is working, `pass` ok).

| link | between | means |
| --- | --- | --- |
| `touch` | lane, lane | both change the same files ("3 files · api") |
| `conflict` | lane, lane | `predicted: true` is a merge risk (`severity: warn`), `predicted: false` a real merge-tree conflict (`severity: crit`) |
| `pkg` | lane, package | the lane changes that package; live while the lane works |
| `ci` | builder, runner | the runner serves that builder; live while a run for one of its lanes is in progress |

There is one edge per lane pair: a conflict replaces a touch, a confirmed
conflict replaces a predicted one. Edge ids sort their ends, so they are
stable.

A CI runner is any topology node with a `ci` field:

```json
{ "id": "runners", "parent": "hv", "kind": "room", "ci": { "runner": true, "for": ["builder-a"] } }
```

`"for": "*"` serves every builder.

## Topology rules added

- ids starting `builder:`, `sess:`, `repo:`, `pkg:` (and `lane:`), and the ids
  `__core`, `__fleet`, `__repos`, are laneboard's own and are refused;
- the kinds `builder`, `session`, `repo`, `package` and the link kinds
  `touch`, `conflict`, `pkg`, `ci` are made by laneboard and are refused in the
  file;
- `builder` must be a builder id (`a-z`, `0-9`, `-`, 1-24 characters) and
  unique; `ci.runner` is a boolean, `ci.for` is `"*"` or a list of builder ids.

## Feeds

On a fleet, the hub reads the feeds directory (`map.feedsDir`) and the feed
pushers send there. A builder with `fleet.hubKeys` set does not read feeds at
all; its own `/api/map` then says `"feeds": false`.

## For developers

`server/map.mjs` exports the pure model (`buildFleet`, `attachBuilders`,
`fleetLaneNodes`, `repoNodes`, `fleetLinks`, `normalizeOverlaps`,
`toMapFleet`) and the live loop: `tick(snapshot)` on a builder (a fleet of one
through `build({snapshot})`), `tickFleet(fleet, now)` on the hub, where
`fleet = {...toMapFleet(store.view(now)), repos, laneFacts, edges | overlaps,
ciRuns}`. Both return a `{type:'map', map}` message when something worth
sending changed (statuses, labels, structure, flags, link severity) or the
resend interval passed (5 s builder, 10 s hub), else null. `server/map.mjs`
imports no builder-only module.

`test/fixtures/fleet-map.json` is a 6 builders × 20 lanes × 3 sessions model
for performance checks; `UPDATE_FIXTURES=1 node --test test/map.test.mjs`
regenerates it.
