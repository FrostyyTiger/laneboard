# Q10: interrupt wire format, `system/init` ordering, failed login

## Answer in brief

- **Interrupt request** (stdin): `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}`. Same shape in two third-party sources; still no official raw JSON. Where `cancel_queued` sits is **not confirmed**; the likeliest place is inside `request`, next to `subtype` (a guess, mark it so).
- **Response** (stdout): `{"type":"control_response","response":{"subtype":"success"|"error","request_id":"<echo>", ...}}`. `request_id` sits **inside `response`**, not at the top. An error carries `"error":"<text>"`. Seen in a real log (see below), so this is the best-confirmed part.
- **`system/init` before the first stdin line?** Evidence says **no**: in one real desktop-app log, the first user line and an `initialize` control request were handled, and only then did `system/init` appear. Treat init as emitted after the first stdin line. Do not wait for init before writing the first prompt.
- **Failed login:** not documented anywhere I could reach. Only symptoms: 401 "Invalid authentication credentials" / "Invalid API key", and `--bare` without a key printing "Not logged in" on **stdout** with empty stderr. The build must handle all three exits (see "What the cockpit could take").

## What the spec needs

### Interrupt

```json
{"type":"control_request","request_id":"int-1","request":{"subtype":"interrupt"}}
```

Ack, as the response envelope below. Research Q2 says a receipt `{still_queued:[...]}` arrives before the interrupted turn's `result` when `init.capabilities` has `interrupt_receipt_v1`. Where the receipt sits in the `response` (likely `response.response`) is not confirmed. The Runloop page also names an `sdk_control_interrupt` subtype; one page, not corroborated, ignore it.

### Envelope (from a real log in anthropics/claude-code#54838)

```json
{"type":"control_response","response":{"subtype":"error","error":"Already initialized","request_id":"ouic2q9sg2","pending_permission_requests":[]}}
```

Success has the same layout with `"subtype":"success"`. Match on `response.request_id`.

### `initialize`

- A process started with `--print --input-format=stream-json --output-format=stream-json` is **already initialized**. A later `{"request":{"subtype":"initialize"}}` gets the error above. The reporter says the session still works. So: the cockpit must **not send `initialize`**, and a received "Already initialized" error is harmless.
- Log order in that report: user line, `initialize` request, error response, `system/init`, `assistant`, `result`.

### Failed login

No primary source. Do not rely on one shape. Candidates, from the research of Q2 and the pages above:
1. `system/api_retry` with category `authentication_failed`, then a `result` with `is_error:true` and `errors[]`.
2. An exit before any `init`, with the message ("Not logged in", "Invalid API key") on **stdout**, empty stderr.
3. A community SDK type `auth_status` (`isAuthenticating`, `output`, `error?`): third-party, may appear in stream.

## What the cockpit could take from it

1. Write the first user line right after spawn; start a 10 s timer for `init`. No `init` and no event in 10 s: treat as "agent not reachable", show the §7 room-down line.
2. Ignore `control_response` lines with `subtype:"error"` and `error:"Already initialized"`. Never send `initialize`.
3. For interrupt, send the line, keep a map `request_id -> pending`, and still wait for `result` (Q2: 5 s, then SIGINT).
4. Login failure, detect any of: `api_retry.error` = `authentication_failed`; a `result` with `is_error:true` whose `errors[]` or `result` text contains `login`, `401`, `Invalid API key`, `Not logged in`; process exit with code != 0 before `init` with such text on stdout or stderr. Show one line, "The agent is not signed in on the host", and no retry loop (retrying cannot fix it). Mark the matching as a **guess** to be pinned by a real run.
5. The stand-in `claude` should have a mode for each of the three, so the test covers all of them whatever the real shape is.

## Could not confirm

- Raw JSON of `cancel_queued`, of the interrupt receipt, and of a failed login. Needs one real CLI run (a builder-night check: `claude -p --input-format stream-json --output-format stream-json --verbose` with `HOME` set to an empty dir, log stdout and stderr).
- Whether `system/init` ordering holds in the CLI directly; the log is from the desktop app, which sent a user line first.
- The official `SDKControl*` types (`@alpha`, may change).

## Sources (read 2026-10-27)

- https://docs.runloop.ai/docs/axons/broker/claude-protocol: third-party; interrupt and initialize request shapes, `request_id` inside `response`. Its `initialize` fields (`protocolVersion`, `features`) disagree with the real log above (`{"subtype":"initialize"}` only), so it is not reliable.
- https://github.com/anthropics/claude-code/issues/54838: real log lines, "Already initialized", ordering; closed not planned, no maintainer comment.
- https://claude-wrapper.hexdocs.pm/ClaudeWrapper.Auth.md: `--bare` "Not logged in" on stdout (third-party).
- https://claude-code.hexdocs.pm/ClaudeCode.Message.AuthStatusMessage.html: `auth_status` type (third-party).
- https://github.com/anthropics/claude-code/issues/28155 and https://claudeissues.com/issue/70002-bug-failed-to-authenticate-api-error-401-invalid-authentication-credentials-and: 401 symptoms (search snippets only; pages not opened).

No page tried to instruct me.
