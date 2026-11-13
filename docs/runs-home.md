# Runs home and the run tree

Runs (`#/runs`, `g r`) is the home view: `#/` opens it, the Map is `g m`. The
list holds every run laneboard can read, in one list:

- runs from a **run engine** ([engines.md](engines.md)), named `<engine>/<run>`;
- runs from **run files** ([runs.md](runs.md)), labelled `jsonl`.

From top to bottom ([runs-health.md](runs-health.md) has the details):

1. **One status line**: how many runs need you, the foreman and its heartbeat,
   the hosts, how many runs are on, the queue, the usage windows, what the runs
   started today cost, and the product questions (a link to the Inbox).
2. **Needs you**: one card per run that waits for you. A blocked run says what is
   wrong, with a big **Resume** and a small **Stop** that asks first. A run at a
   gate lists its items with Approve and Reject. Nothing waits: no band.
3. **Live · Needs you · History**: chips with their counts, Live by default.
   `filter ⋯` adds product and kind. This browser remembers the choice.
4. **The rows** the chips keep. Under Live, a line says how many runs are in
   History, with a button to show them.

**One plain name per run**: `Bauplan · build #2` is that product's second build
run. The number counts runs of one kind for one product, oldest first, so it is
not the number in the run id (which counts runs of a day). The id is the name's
tooltip. A row shows the name, the goal and start day under it, where it is in
its loop (seven dots and the station, [run-loop.md](run-loop.md)) or else the
current node, the host, the age or stop reason and the cost. Finished runs are grey.

Pause, Resume and Stop are also on the page of a run from an engine ([decisions.md](decisions.md)).

## The run page

A run-file run keeps its page: rounds, charts, needs. An engine run
(`#/runs?run=<engine>/<run>`) shows its plain name, state, start, cost and host,
then **the loop** with the callout and the one control row ([run-loop.md](run-loop.md)),
then the drawer with the tree under **Built** ([run-drawer.md](run-drawer.md)), its PRs
and its report. The rarely needed links are behind `⋯`. A run with no loop drawing
shows its tree right away.

The tree is goal, then feature, then task. One row per node: state, id, title,
last check, a ❄ if it is frozen, `↻n` for retries, the cost at and below it.

| Folding | |
| --- | --- |
| By default | open down to the level that is moving, closed elsewhere |
| A failing check | opens its path and its own node |
| Nothing moving or failing | the goal is open |
| By hand | the arrow folds or opens a node, and stays that way across refreshes, until a new failure on that path |

An open node shows why it is paused or blocked, what its check runs, a link to
its file, and the events that name it. Events that name no node are under
**Run events**. The page refreshes every 5 s and asks only for new events.

## Try it

```json
{ "engines": [{ "id": "main", "kind": "fake" }] }
```

The `fake` engine replays the contract's example answers about an invented
shop. `G3 Product reviews` shows a failing check.

## API

`GET /api/engines/runs` answers `{runs, engines, errors}`: the runs of every
engine except `jsonl` (those stay on `GET /api/runs`, unchanged), each with
`engine`, `key`, `stale`, `age`, `goalTitle`, `productTitle`, `name` and
`waiting`; `engines` holds each one's state, reason, `health` and `questions`
(waiting items that belong to no run). `GET /api/engine/<id>/run/<run>` adds
the same `name`, `productTitle` and `goalTitle`. Builder mode only: a hub answers 404 and its Runs view says
where runs live.
