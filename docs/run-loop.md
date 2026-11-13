# The loop on a run page

A run from an engine draws the loop it follows, with the spot it is at lit. Under
the drawing, one callout says what needs you, with the one control row.

## Drawn from the pattern, never by hand

foundry runs a build with a loop **pattern**. Each pattern laneboard knows has
one shape in `public/js/core/loop.js`, written from foundry's
`toolbox/patterns/<name>.md`. Every station and every edge quotes the sentence of
the doc it comes from. `test/run-loop.test.mjs` checks, against a copy of the doc
in `test/fixtures/patterns/`:

- every parameter, every stop reason and every role in the doc is in the model, and nothing else;
- every station's and every edge's quote is in the doc;
- every station is reached from Plan, and every station and edge is drawn.

When foundry changes the doc, copy it again and run the test with
`FOUNDRY_DIR=<a foundry checkout>`: it then also checks that the copy is current.

**Which pattern.** The recipe's `patterns` list, when foundry sends it. Until
then a `build` or `change` run is `build-until-green@1`, foundry's only loop
pattern (its runtime refuses any other). The page says which of the two it used.
A pattern laneboard does not know, or an `explore` or `discover` run, gets **no
drawing**, only a note: a wrong drawing is worse than none.

## build-until-green@1

| Station | Who | Way out |
| --- | --- | --- |
| Plan | decomposer | the tree, with the recipe |
| Recipe ▲ | you | approved |
| Tests | test writer | the feature's acceptance tests; they must fail |
| Build | builder | one task |
| Task check | | green: the task is frozen, next task; red: Fixer |
| Fixer ↺ | fixer | check again; after `escalate_after` (2) failed rounds one tier up; after `task_rounds` (4) the task is blocked |
| Doubt ↺ | test writer | a fixer doubts a test: it is kept or changed; twice the same test goes to a person |
| Acceptance | feature check | green: Review; red: Blame |
| Blame ↺ | blame | the named task reopens, to the Fixer |
| Review | reviewer | findings become tasks (at most `review_task_cap`), built and checked like the rest; at most `review_cycles` (2) reviews |
| Merge | | into the run branch, acceptance tests once more on the merged result |
| Suite job · | | beside the loop, every 3 frozen tasks and after each merge; never blocks |
| Goal check | | suite, CI, review of the whole run; red: Blame over the frozen tasks |
| PR ▲ | you | the PR and the run report |
| End | | one stop reason: done, checks-red, no-progress, budget, window-7d, errors, stopped-by-person |

Grey edges go forward; red dashed edges go back. Under each station a short
number: rounds, tasks frozen, reviews of the cap, the last checks. Its tooltip
has the long form and what the station does.

## Where it is

| Mark | Means |
| --- | --- |
| ✓ | done: before the spot on the way forward |
| ● | the spot (grey ring) |
| ■ red | blocked here: the run is at a gate with nothing to decide |
| ▲ amber | waits for you (the recipe, a new revision of it, the merge) |

The spot, first rule that answers:

1. done: End; waiting for the recipe: Recipe;
2. **the node's phase**, when foundry sends it (`tree[].phase`, foundry's own
   `x.phase`): exact;
3. a merge gate open with no round running: PR;
4. blocked: the step named in the reason, `blocked at G1.F1 (tests): …`;
5. the round that is running: its role (a test writer after the tasks started is the doubt round);
6. else the last event that names a station (a round, a check, a task's state).

Without the phase the page says the spot is worked out from the events. The
loop follows one **focus feature**: the run's node, else the one in the reason,
a blocked one, the one with a round running, the first not passed. The
dashed boxes name it and its task.

## The callout and the controls

| State | Says | Buttons |
| --- | --- | --- |
| blocked | `■ Stopped at Tests · G1.F1 · since 17:40 · 10 min`, What is wrong (its first sentence, `full text` for the rest) | **Resume** · Stop |
| a decision waits | `▲ A decision waits for you`, each item | Approve · Reject, then Pause · Stop |
| a round runs | `● Now · test-writer · large · round 3 on G1.F1 · 6.7 min so far` | Pause · Stop |
| paused | `‖ Paused at …` | Resume · Stop |
| done, stopped | `✓ Done`, `Stopped at … · <reason>` | none |

Stop always asks first. The links that were in the head (state repo, recipe,
flow, rooms, the raw id and event count) are behind `⋯`.

## On the Runs list

A live row shows seven dots, Plan · Recipe · Tests · Build · Check · Review ·
PR, the lit one where the run is, and the station with its node (`Tests ·
G1.F1`). The server works the spot out with the same code
(`loop` on `GET /api/engines/runs`). It reads a run's page and events again only when
the run's `lastSeq` or `updatedAt` moved, and then only the new events. On the
phone the dots hide and the word stays.

## Try it

```json
{ "engines": [{ "id": "main", "kind": "fake" }] }
```

`Acme Shop · build #3` builds `G1.F1.T3` with a new recipe revision waiting;
`build #2` waits for its merge at PR.

## What foundry could send to make it exact

`tree[].phase` (its `x.phase`), `recipe.patterns` and `recipe.loop` (the numbers
the recipe sets) on the run row. laneboard already reads all three when they
arrive.
