# Review workflow

How a finished lane gets reviewed from laneboard: read its diff, batch line
comments into one review, send it to the lane's session, and pull the branch
locally. Config keys (`review.*`, `transcript.*`, `repos[].base`,
`repos[].scripts`) are in [../config.md](../config.md#review-transcript--the-review-workflow).

## The pieces

- **Review-ready.** A lane that printed its done marker carries a
  `reviewReady` flag with its diff stat, touched packages and live cost. The
  Inbox's Review group and the hub's review queue list such lanes, longest
  wait first. A wait longer than `review.overdueHours` raises
  `review-overdue`.
- **Diff.** `GET /api/v1/lanes/<lane>/diff` on the builder (through the hub's
  read proxy on a hub) returns the file list and parsed hunks against
  `repos[].base`, else `review.base`, capped by `review.diff.*`. Files matching
  `review.generated` are deferred until asked for. The Diff view renders it
  with light syntax highlighting; every line is builder text and is shown as
  text.
- **send-review.** The comments go out as one message to the lane's session.
  Up to `review.inlineMaxChars` it is typed inline; above that it is written to
  a 0600 file under the lane's directory and only the path is typed.
- **Pull.** The Pull popover offers shell-quoted commands to check the lane's
  branch out locally. laneboard runs nothing for it.
- **Scripts.** `run-script` runs one of the repo's `repos[].scripts` commands
  (config file only) in a background tmux window of the lane's session.

## When a review is typed

`send-review` (and a guarded `send-text`, which broadcast uses) types only
into a session that is a live Claude agent and ready for input:

- the lane's own session: the `session` its `lane.json` names must be among
  the lane's live sessions; without one, the lane's only session. Otherwise
  409 `session_not_in_lane` / `ambiguous_session`;
- a pane running Claude (`not_claude` for a shell, a dead pane or any other
  command);
- not paused, not waiting on a permission prompt or a question, no held
  approval (`prompting`);
- the pane shows Claude's ready input box, or the session is `working` with no
  dialog on screen (Claude queues input typed while it works).

The session is re-read just before typing. Text and Enter go out in a single
tmux invocation.

## Residual risk: a dialog opening as the keys arrive

Typing into a `working` session is allowed, because that is how a review
reaches an agent that is still busy. If Claude opens a permission dialog in
the instant the keys arrive, the Enter at the end of the review lands on the
dialog and selects its highlighted option, which is "Yes": a tool call is
approved without going through the remote-only `approve` path.

What closes most of it: the readiness check refuses any screen with a dialog
and any session with a pending or held approval, the session is re-read right
before sending, and text and Enter are one tmux call, so a dialog can no
longer open between them. What remains is the gap while Claude repaints and
reads its own input buffer, a few milliseconds. It is an accident window, not
an attack: nothing outside the session can widen it. If it matters for a lane,
send the review while the lane is idle (the ready screen), not while it works.
Accepted as Low in the security review of the review workflow.
