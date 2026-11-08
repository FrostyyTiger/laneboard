# Flow: one overview per goal

**Status: plan, for the owner to look at before it is built.** A direction, not a fixed design.

The question it answers: **where does this goal stand, from its first source to its PR?** Not exact,
just a good look at each box. It follows the engine's drawing of the two runs.

## Where it lives

`#/flow?product=<id>&goal=<id>`. Reached from a goal row on Products and from a run page. Read-only,
no tab and no `g` key, like Knowledge. Builder mode only for now.

Two rows of boxes with arrows; on a phone they stack. The box the goal is in is lit, the boxes behind
it are marked done, the boxes ahead are dim. Each box has one or two lines; a tap opens its detail.

## The boxes

"Today" says what the contract v1 already gives, checked against the fixtures.

| # | Box | Shows | Today |
| --- | --- | --- | --- |
| 1 | Sources | count by kind, the newest with its age; opens to the list | yes, but a source has no title: shows its id |
| 2 | Claims | count; high / medium / low; superseded; open questions, how many block | yes. "Disputed" does not exist: shows superseded |
| 3 | Requirements | this goal's REQ-n, draft vs approved, fixed lines; opens to the list | yes. Sketch link: no |
| 4 | Gate | what waits for a person on this goal, its age, a link to the Inbox | yes |
| 5 | Goal | readiness and its reasons; run id, state, recipe revision, started, cost | yes. Recipe has no title |
| 6 | Test writer | acceptance tests per feature | names only: **red / green per test is not in the contract** |
| 7 | Tasks | features and tasks: open, running, frozen, reopened, blocked | yes |
| 8 | **Builder** | feature, task title, round, since when, last step, last check | yes, from the tree and events. **Last build decision: no such event** |
| 9 | Checks | last task check, last suite result and age, feature checks | yes. Review findings: no |
| 10 | PR + report | PR link and state, report, demos | yes when a merge gate is open. PR's own checks: no |

A value the contract does not have is left out of its box, never guessed. Box 8 is the largest,
and on a phone it comes first after the lit box's title.

## Which box is lit

From the goal's state, first match wins:

| State | Lit |
| --- | --- |
| Run done, or a merge or deploy gate open | 10 PR + report |
| Run `waiting-approval` | 4 Gate |
| Run `queued` | 5 Goal |
| A task `checking`, or a failed check on the current node | 9 Checks |
| A task `building` | 8 Builder |
| Run going, tasks but none moving | 7 Tasks |
| Run going, no tasks yet | 6 Test writer |
| No run, goal `ready` | 5 Goal |
| No run, a requirement unapproved | 4 Gate |
| No run, otherwise | 3 Requirements |

A run `at-gate` or `paused` keeps its box and says so on it. A Discover run working on a goal cannot
be told apart yet (ask 5), so the first row is only lit from the requirements on.

## Data

Composed in the browser from routes that exist: `/api/engines/products`, `/api/engines/runs`,
`/api/engines/waiting`, and `/api/engine/<id>/{knowledge/<product>,run/<id>,events/<id>}`. No new
server route unless composing proves too heavy. Same rules as Knowledge: no evidence quotes, no
source `who`, every value as text, links only when http(s). Polls every 15 s, knowledge every 60 s.

Demo: the `fake` engine, which has one running run with a tree. The existing demo pages cover a
failing check and a done run.

## Asks to foundry

1. Sources: a title, and counts by kind without paging.
2. Run row: the current task's title, and the last build decision. Needs a build-decision event.
3. Acceptance tests: red or green per A-n-k, per feature, with when.
4. Sketch link on a requirement (foundry Q11), review findings open per feature, and a PR's checks.
5. Which run kind is working on a goal (Discover or Build) and a recipe title.

If composing is too heavy, the `flow <product> <goal>` summary verb foundry offered would replace
most of this.

## Left out

Decisions (phase 4), hubs, anything that changes state, cost per box.

## Done when

Every box renders from the fake engine; each row of "Which box is lit" has a test; screenshots in
both themes at 1440 and 390; no console errors; tests and hygiene green; `docs/flow.md` written.
