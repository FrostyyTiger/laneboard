# Runs first: where we stand

laneboard is a view into foundry. This page keeps the goal, the rules, what is ready and what is not.
The design it was built from is `design.md` next to this file; each shipped part has its own page in `docs/`.
Last updated 2026-11-14.

## The goal: three connections

In this order of weight:

1. **foundry runs**: the runs, each run's loop, its gates. The most important one.
2. **Network**: the machines as one wire, with the foreman, the rooms and their runs. It is the Machines screen too.
3. **Product repos**: per product its requirements, each linked to GitHub for its text, plus what laneboard adds:
   the claims it rests on, open questions, and which runs, tests and PRs built it.

laneboard only shows foundry products, so it reads foundry's fixed layout (`requirements/REQ-<n>.md`,
`discovery/claims|sources|questions/`). No generic repo support.

## The rules

- **The loop is the real loop.** It is drawn from the pattern doc the run names (`recipe.patterns`), never by hand.
  Its numbers come from the recipe. A test checks every station and edge against foundry's pattern doc. An unknown
  pattern gets no drawing, only the plain tree with a note: a wrong drawing is worse than none.
- **Never guess quietly.** Where foundry does not send a value, laneboard leaves it out or says it is a guess.
- **Calm by default, detail on request.** One callout and one control row on the run page; the rest in the drawer.
- **The owner decides.** Gates, approvals and merges are the owner's. laneboard shows and proposes.
- **No login, so no LAN.** laneboard has no sign-in; it is reached over the tailnet only.

## Ready (shipped, deployed)

| What | Where | PR |
| --- | --- | --- |
| A short read memory, so pages stop starting a foundry process per read | `docs/engines.md` | #49 |
| One plain name per run, the status line, the Needs you band, Live · Needs you · History | `docs/runs-home.md` | #50 |
| A blocked run says why, with Resume and Stop | `docs/runs-home.md` | #48 |
| The loop drawn from the run's pattern, the spot lit, one callout, a loop glyph on live rows | `docs/run-loop.md` | #51, #52, #58 |
| The drawer: a station's rounds and checks, Built, Timeline, Usage, Recipe, Gates, Events | `docs/run-drawer.md` | #53, #54 |
| Waiting kind `needs`: a blocked run in the Inbox, Resume and Stop, never Approve | `docs/waiting.md` | #55 |
| Network `#/network` (`g n`): the wire, the foreman, rooms and runs, linked both ways with the run page | `docs/network.md` | #56, #57, #59 |

foundry sends the fields the loop needs since its #48 (live on the foundry VM since 2026-11-13): `phase` per node,
`recipe.patterns` and `recipe.loop`, the `needs` items, `health.host`, the full block reason. The lit station is
foundry's own word now, not worked out from the events.

## Not ready

| What | State | Waits on |
| --- | --- | --- |
| Network replaces the old Map (`#/map`) in the nav | both are there; the old Map also shows lanes and sessions | the owner's call |
| **Product repos**: the requirements view per product | not started; grows out of the Knowledge view (`docs/knowledge.md`) | the owner's go |
| A red check without opening the json | foundry sends no `command`, `duration_ms`, `failure` on `check` events | foundry |
| History rows' loop glyph | foundry sends no `rounds` on the run row | foundry |
| What each machine does now, its load | foundry sends no `health.now`, `health.hosts[].load` | foundry |
| Per-node acceptance tests red / green | foundry sends no `acceptance` per node | foundry |
| The hosted demo, the tour video, the README rewrite | not started | later |

## Open PRs from before this work

#29 (the first runs-first plan, 2026-11-01) is overtaken by this page and the shipped docs. #4, #6 and #9 are older
still. Whether to close them is the owner's call.
