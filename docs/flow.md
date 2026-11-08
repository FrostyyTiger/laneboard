# Flow

`#/flow?product=<id>&goal=<id>`: where one goal stands, from its first source to
its PR. Open it from a goal on [Products](products.md) ("flow") or a run page.
Read-only.

Two rows of boxes. The box the goal is in is lit (●), the boxes behind it have a
✓, the boxes ahead are dim. A gate the goal has moved past but that still has
something open shows ▲. Boxes with a list have **more**.

| Row | Boxes |
| --- | --- |
| Discover + Shape | Sources · Claims · Requirements · Gate · Goal |
| Build | Test writer · Tasks · **Builder** · Checks · PR + report |

Builder says what is being built now: the task, its feature and requirement, the
round, the last step and the last check.

It is an overview. Sources and claims are the whole product's; the rest is this
goal's. Anything the engine does not report is left out rather than guessed. The
rules for which box is lit, and what is still asked of the engine, are in
[plans/runs-first/flow.md](plans/runs-first/flow.md). Refreshes every 15 s.

`{ "engines": [{ "id": "main", "kind": "fake" }] }` shows the invented shop:
`G1` is at the builder, `G3` waits for merge, `G4` has no run.
