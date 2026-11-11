# Runs home and the run tree

Runs (`#/runs`, `g r`) is the home view: `#/` opens it, the Map is `g m`. The
list holds every run laneboard can read, in one list:

- runs from a **run engine** ([engines.md](engines.md)), named `<engine>/<run>`;
- runs from **run files** ([runs.md](runs.md)), labelled `jsonl`.

Each row shows the state, the goal, the product and engine, then what fits the
run: the current node, rooms, age or stop reason and cost for an engine run;
round, scores and burn for a run file. Runs that wait for a person sort first.
An engine that is stale, down or incompatible says so above the list.
Above the list, each engine's foreman health, and under a run, what waits on it
([runs-health.md](runs-health.md)).

Pause, Resume and Stop are on the page of a run from an engine ([decisions.md](decisions.md)).

## The run page

A run-file run keeps its page: rounds, charts, needs. An engine run
(`#/runs?run=<engine>/<run>`) shows its state, cost, rooms, what waits for a
person, the tree, its PRs and its report.

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
`engine`, `key`, `stale`, `age` and `goalTitle`; `engines` holds each one's
state and reason. Builder mode only: a hub answers 404 and its Runs view says
where runs live.
