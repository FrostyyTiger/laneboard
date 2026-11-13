# The status line and Needs you on the Runs list

The top of Runs (`#/runs`) is one status line. It starts with how many runs
need you, then, for each run engine that reports health:

- **foreman up, stale or down**, from the age of its last heartbeat. The age is
  measured on the engine's own clock, so a clock that is off does not matter.
  Up is up to 1 min, stale up to 5 min, down after that. **Unknown** means
  laneboard has no fresh answer from the engine at all.
- the heartbeat's age, the hosts and their states, the queue, and the usage
  windows (`unknown` when the engine does not know them yet);
- how many runs are on now.

Then what the runs started today cost (a run counts on the day it started; the
API price) and the product questions that belong to no run, linked to the Inbox.
With more than one engine, each foreman part starts with its engine's id.

## Needs you: gates

Under the status line, the **Needs you** band has one card per run that waits
for you: the run's plain name and goal, its node, how long ago it moved, and
what it waits for. What waits on a gate is listed on the card: kind, title,
the short revision, and the same buttons as the Inbox (Approve, Reject, Pick,
Answer). Each button shows the card with the full revision first. The decision
names that revision (`--expect`), so if the item changed since you read it,
nothing is decided and you are told (`stale-revision`). See
[decisions.md](decisions.md) for who may decide and from where.

A run with something waiting sorts with the runs that need you, even while
other parts of it still build.

## Blocked runs

A run can be **at a gate with nothing to decide**: a round hit its stop rule, or a check could
not run. Its row and its page say **blocked** in red. Its card shows **What is wrong** (the
engine's reason), a big **Resume** and a small **Stop** that asks first, and **Open**. Fix
the cause outside the engine (a profile, a token, the code), then press Resume: the blocked step
runs again. The cockpit agent may propose Resume for such a run too.

## Try it

```json
{ "engines": [{ "id": "main", "kind": "fake" }] }
```

The demo foreman is up, with two hosts and its usage windows. The running run
has a recipe, a variant and a change waiting, the run at the gate a merge, and
the done run its deploy. All three are in the Needs you band.

## API

`GET /api/engines/runs` adds `health` to each engine (`foreman`, `beatAge`,
`heartbeatAt`, `hosts`, `queue`, `active`, `windows`, `stale`, `reason`; `null`
for an engine without health) and `waiting` to each run (its items, in the
shape of `GET /api/engines/waiting`). Each run row also carries the engine's
`reason` for its state.
