# Pattern: build-until-green

**Status: used in one run** (R-20261109-acme-shop-1, runtime step 2: decomposer, test writer, builder and reviewer
ran live; fixer and blame only on the fake runner). Version 1 (`build-until-green@1` in a recipe, `docs/formats/recipe.md`). The one
pattern build order phase 2 needs.

## When to use
A goal whose requirements are approved and ready (`docs/discover.md`, "when do we know enough"), to be built and checked level by
level (`docs/work-tree.md`). Kind `build` or `change` (`docs/change.md`).

## Parameters (defaults)
| Parameter | Default | Meaning |
| --- | --- | --- |
| `task_rounds` | 4 | builder + fixer rounds per task before it goes to `blocked` |
| `escalate_after` | 2 | failed rounds on one task before the next round runs one tier up (`docs/overview.md`, "Models") |
| `blame_rounds` | 2 | small tier first, then mid if the first answer is `none` or `low` |
| `review_cycles` | 2 | review → fix cycles per feature |
| `review_task_cap` | 3 | tasks one review may add to its feature (lesson from the old loop: reviews outran the builder) |
| `checks` | step, task, feature, goal | which level checks run (`../checks/`). All four in phase 2 |
| `suite` | `{every_tasks: 3, after_merge: true}` | when a background suite job is queued (`docs/suite-room.md`) |
| `parallel` | from the recipe (≤ D-021) | features at once. Phase 2: 1 |
| `no_progress` | 2 | task rounds in a row without any task passing, then stop |

The recipe sets only what differs from these.

## Roles, in order
1. **decomposer** → the tree (already in the approved recipe; runs again only on a replan).
2. Per feature, in the order the recipe gives:
   1. **test writer**: the feature's acceptance tests from its acceptance lines, before any build round (D-015). They must fail.
   2. Per task, one after another: **builder**, then the **task check**. Red → **fixer**, task check again, until green or
      `task_rounds` are used. Rounds 1-2 mid, 3-4 large. Green → the task is **frozen**. Every `suite.every_tasks` frozen
      tasks the foreman queues a suite job. A fixer that doubts an acceptance test gets one **test writer** round that keeps
      or changes the test (`../roles/test-writer.md`); the same test doubted twice goes to a person.
   3. **Feature check**: acceptance tests. Red → **blame** → the named task reopens → fixer → task check → acceptance tests again.
   4. Acceptance tests green → **reviewer**. Its blocker/major findings (≤ `review_task_cap`) become tasks in the feature; they are
      built, checked and frozen like the others, then the acceptance tests run again. At most `review_cycles` reviews. A
      `question` finding (behaviour no requirement states) goes to the owner and is never a task: a review may not widen a requirement.
   5. Green and no open review task → merge into the run branch, acceptance tests once more on the merged result, queue a suite job.
3. **Goal check**: suite, CI, run review (`../checks/goal.md`). Red → blame over the run's frozen tasks → fix → again.
4. Green → PR + run report (`docs/run-end.md`).

The roles: `../roles/`. Checks: `../checks/`. The suite room runs beside all of this and never blocks it (D-014).

## A review/fix loop ends on a fix, never on a review
Lesson from the first run: it ended on a review that left 9 issues open. Nobody fixed them, and the report looked done. So:
- a review is never the last step of a feature or of the goal. Its findings are fixed and checked before anything ends;
- after the last allowed review (`review_cycles`), its findings are still fixed and checked, but no new review runs;
- findings that can't be fixed inside the caps go to the run report as open, and the stop reason says so. Never silently.

## Stop conditions
| Stop reason (contract) | When |
| --- | --- |
| `done` | goal check green, PR open |
| `checks-red` | the goal check stays red after blame and fixes, or a blocked task leaves nothing else to build |
| `no-progress` | `no_progress` task rounds in a row without a pass |
| `budget` / `window-7d` | the recipe's budget or the 7 d window brake |
| `errors` | two rounds in a row without a session (the old loop's brake) |
| `stopped-by-person` | a person stopped it; it finishes the current round first |

A blocked task does not stop the run while other tasks or features can go on. It writes a `needs` event at once.

## Events it writes
`run.state`, `node.state` (every state change, with reasons such as `blame: …`), `round.start` / `round.end` (role, tier,
usage), `step` (sampled), `check` (every level, and the suite at `level: run`), `usage`, `room`, `pr`, `needs`
(`docs/formats/event.md`).

## Nested patterns
None in phase 2. Later: `review-panel` in step 2.4, `explore-variants` before a feature whose look is a gate.
