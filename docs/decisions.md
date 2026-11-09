# Decisions

The buttons on Waiting items, Products and the run page tell a run engine what to
do. Each is an action through the dispatcher, written to the audit log before it
is sent, with the engine's answer as its result.

| Action | Sends | Before sending | From the machine itself |
| --- | --- | --- | --- |
| `engine-approve` | `approve --expect` | card | refused |
| `engine-pick` | `approve --expect --choice` | card | refused |
| `engine-reject` | `reject --expect --why` | reason, card | refused |
| `engine-answer` | `answer --text` | your text shown back | refused |
| `engine-start` | `start <product> <goal>` | card; it only asks for a recipe | refused |
| `engine-pause`, `engine-resume` | same | nothing | allowed |
| `engine-stop` | `stop` | card | refused |

The target is `<engine>/<item, run or product>`.

**From the machine itself** means the local address, what a script or an agent on
the box uses. Refusing there stops an agent approving its own work. Use your
normal sign-in.

**Who decided** is the signed-in person from the dispatcher's record, never a page
field. Hub-relayed actions follow the same rules (`control` scope and
`fleet.hubControl`); the hub page has no buttons yet, because it has no engine data.

**When it goes wrong:**

| Answer | Meaning |
| --- | --- |
| `stale-revision` | It changed since you read it. Nothing was decided. |
| `already-decided` | Someone already did. |
| `engine-down` | Not sent. Nothing queues. |
| `timeout` | Unknown. Press again: the same request id is sent, so it applies once. |
