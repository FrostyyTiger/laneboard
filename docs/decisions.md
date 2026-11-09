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
the box uses. Refusing there stops an agent approving its own work through that
address. Use your normal sign-in. A process on the box can still pose as a remote
user on the ingress port unless `fleet.ingressPeerUid` is set, so set it on any
builder with engines.

**Who decided** is the signed-in person from the dispatcher's record, never a page
field. The hub does not relay these actions yet: its page has no engine data and
its relay allowlist has no `engine-*` names. A signed envelope sent straight to a
builder needs `fleet.hubControl` and the `control` scope.

**When it goes wrong:**

| Answer | Meaning |
| --- | --- |
| `stale-revision` | It changed since you read it. Nothing was decided. |
| `already-decided` | Someone already did. |
| `engine-down` | Not sent. Nothing queues. |
| `timeout` | Unknown. Press again: the same request id is sent, so it applies once. |
