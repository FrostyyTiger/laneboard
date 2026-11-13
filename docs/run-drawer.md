# The drawer on a run page

Under the loop ([run-loop.md](run-loop.md)) sits one drawer, closed by default.
One panel is open at a time; `×`, or the same button again, closes it. It stays
open while the page refreshes.

| Opens from | Shows |
| --- | --- |
| a **station** on the loop (click, or Enter on it) | what happens there; the node the run is on, with its full reason, when the spot is that station; its **rounds** (# · role · tier · model · node · start · time · cost · result) and its **checks** (name · green or red · counts · node · at · output ↗); the gates at Recipe and PR |
| **Built** | the tree, as it was under the loop before: goal, features, tasks, with a **mini loop** per node: a task `2 of 4 rounds · last check green · frozen`, a feature `tests written · 1 of 2 tasks frozen · blame 1 · review 0 of 2 · merged`, the goal `0 of 1 features merged` |
| **Timeline** | a lane for the run (waiting and blocked spans), one for checks (✓, red ■), one per role with a bar per round (red when it did not end ok, bright while it runs), and a `now` line |

Which rounds belong to a station: Plan the decomposer; Tests the test writer
before the feature's first build round, Doubt the ones after it; Build the
builder; Fixer the fixer; Blame and Review the blame and reviewer rounds below
the goal; Goal check the goal's reviewer, suite and CI. A station's checks: task
checks at Task check and Fixer, the test writer's check at Tests, the other
feature checks at Acceptance, `suite` at Suite job.

**The timeline cuts idle gaps** longer than 30 minutes: a run that waited a night
for you would otherwise be one thin line. A dotted line marks each cut, with
how long it was in its tooltip. Every bar, mark and span has a tooltip.

A run with no loop drawing (an explore run, an unknown pattern) keeps its tree
in sight under the note, without the drawer.

## What the events now keep

`model`, `host` and `why` on events, and `node` on gates, when the engine sends
them: the rounds table shows the model.

## Try it

The `fake` engine: open `Acme Shop · build #3`, click Build, then Built and Timeline.
