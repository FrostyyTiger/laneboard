# Q2 — Claude Code headless `stream-json`: partial text, tools, interrupt, resume

## Answer in brief

- `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` gives one long-lived process. It reads user messages as JSON lines on stdin and writes one JSON event per line on stdout.
- Partial text arrives as `{"type":"stream_event","event":{...raw Claude API event...}}`. The text chunks are `event.type == "content_block_delta"` with `event.delta.type == "text_delta"` and `event.delta.text`.
- Tool calls stream the same way: `content_block_start` with `content_block.type == "tool_use"` (it carries `name`), then `input_json_delta` chunks (`delta.partial_json`), then `content_block_stop`.
- Complete blocks arrive as `assistant` messages. Tool results arrive as `user` messages. The turn ends with one `result` message.
- A running turn is interrupted with an `interrupt` control request on stdin (streaming input mode only). SIGINT also ends the turn. SIGTERM kills the run without recording a result.
- Sessions are resumed with `--resume <session_id>`, `--continue`, or `--session-id <uuid>`. `--fork-session` branches. Transcripts are files on the same machine.

## What the spec needs

### Flags (CLI reference and headless docs)

| Flag | Meaning |
| - | - |
| `--input-format stream-json` | stdin carries JSON lines. Persistent session: messages queue, can be interrupted. |
| `--output-format stream-json` | newline-delimited JSON. Needs `--verbose` together with `-p` per the headless docs' examples. |
| `--include-partial-messages` | adds `stream_event` lines. Requires `--print` and `--output-format stream-json`. |
| `--replay-user-messages` | re-emits user messages from stdin on stdout as an acknowledgment. Needs both stream-json formats. |
| `--resume <id>`, `--continue`, `--fork-session`, `--session-id <uuid>` | session control. |
| `--no-session-persistence` | nothing saved, cannot be resumed. |
| `--max-turns N` | caps agentic turns. |
| `--permission-prompts none` | unattended: anything that would prompt is denied. Needs v2.1.259 or later. |
| `--mcp-config <file-or-json>` | MCP servers (see Q5). |
| `--bare` | skips hooks, plugins, MCP discovery and CLAUDE.md. The docs recommend it for scripted calls. It uses API-key auth, not the subscription login. |

### stdin: one user message per line

The SDK type is `SDKUserMessage`:

```json
{"type":"user","uuid":"<uuid, optional>","message":{"role":"user","content":"text"},"parent_tool_use_id":null}
```

- `content` may be a string or an array of blocks (`text`, `image` with base64 `source`).
- `priority` is `"now" | "next" | "later"`.
  - `next`, or unset: read after the running tool calls finish.
  - `later`: wait until the turn ends.
  - `now`: interrupt the turn.
- `shouldQuery:false` appends the message to the transcript without starting a turn.
- `uuid` is optional. It is useful for matching against `still_queued` and for `--replay-user-messages`.
- Messages sent while a turn runs are queued and handled in order.
- Piped stdin is capped at 10 MB.

### stdout: event types

Every event carries `session_id`. Most also carry `uuid`.

1. `{"type":"system","subtype":"init", ...}` comes first, unless hook or plugin events precede it. Fields:
   - `session_id`, `model`, `tools[]`, `permissionMode`, `cwd`, `claude_code_version`
   - `mcp_servers[{name,status}]`, with optional `mcp_server_errors[]`
   - `plugins`, `capabilities[]` (optional)
2. `{"type":"stream_event","uuid","session_id","event":<raw API event>,"parent_tool_use_id":null}` appears only with `--include-partial-messages`. Optional extra fields: `ttft_ms` (on `message_start` only), `user_message_uuid`, `user_message_uuids`, `resume_reason`.
   - The `event` types are `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, and `ping` (a keep-alive, so treat it as liveness).
   - Delta types: `text_delta` (`.text`), `input_json_delta` (`.partial_json`), plus thinking deltas.
   - Stream events are for the main session only. Subagent tokens are not streamed.
3. `{"type":"assistant","message":{id,content:[...]},"parent_tool_use_id":null}` carries one complete content block. A reply with text plus a tool call gives two `assistant` messages with the same `message.id`. With partial messages on, each arrives before that block's `content_block_stop`.
4. `{"type":"user", ...}` carries `tool_result` blocks for tool calls.
   - With `--replay-user-messages`, your own input is echoed back, and replays are marked `isReplay:true`.
5. `{"type":"system","subtype":"api_retry", attempt, max_retries, retry_delay_ms, error_status, error, ...}` appears before a retry. Error categories include `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `server_error`.
6. `{"type":"system","subtype":"permission_denied"}` appears in stream-json when a call is denied.
7. `{"type":"result","subtype":"success"|"error_max_turns"|"error_during_execution"|"error_max_budget_usd"|..., ...}` ends the turn. Fields:
   - `is_error`, `duration_ms`, `num_turns`, `stop_reason`, `total_cost_usd`, `usage`, `permission_denials[]`
   - `result` (on success) or `errors[]` (on error)
   - `terminal_reason` (optional): `completed`, `max_turns`, `aborted_streaming`, `aborted_tools`, `budget_exhausted`, `api_error`, and others.
   - `session_id` is present on every result.

Event order in one reply (documented):

```
message_start
content_block_start(text)
content_block_delta...
assistant(text block)
content_block_stop
content_block_start(tool_use)
input_json_delta...
assistant(tool_use block)
content_block_stop
message_delta
message_stop
… tool runs, user(tool_result) …
… next message_start … then result
```

### Interrupt

- In streaming input mode the SDK's `interrupt()` sends a control request on stdin. The form is `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}`.
  - **Unconfirmed from official docs.** Only third-party protocol pages and wrappers show it (see sources). Verify against a real CLI before the builder relies on it.
- Capabilities, advertised in `init.capabilities` (feature-detect, don't compare versions):
  - `interrupt_receipt_v1` (v2.1.205 or later): the interrupt returns `{still_queued: string[]}`, the UUIDs of user messages still pending. The receipt arrives before the interrupted turn's `result`.
  - `interrupt_cancel_queued_v1` (v2.1.219 or later): `cancel_queued:true` on the interrupt request cancels queued messages. They are reported in `cancelled`, and `still_queued` is then empty.
- After a clean interrupt the turn still ends with a `result`, and `terminal_reason` is one of the `aborted_*` values.
- A cut stream still gets `message_stop` (v2.1.290 or later). A cut text block gets `content_block_stop`. A cut tool block does not, so a tool input still open at `message_stop` is incomplete.
- Signals:
  - SIGINT ends the turn.
  - SIGTERM exits with code 143 and records no result for the turn in progress. A running Bash command is recorded as killed. The next prompt on resume drives the conversation, unless `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`.

### Sessions

- `session_id` is in the `init` message and on every `result`.
- Transcripts are `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Encoding replaces every non-alphanumeric character in the cwd with `-`. `CLAUDE_CONFIG_DIR` relocates them.
- `--resume <id>` finds the session in any project on the same machine (v2.1.223 or later). It also accepts a path to the `.jsonl`.
- `--fork-session` with `--resume` makes a new session id. The original is untouched. Files the agent edited are not branched.
- `--continue` takes the most recent session in the cwd.
- Cost totals accumulate across resumes.
- Background work started by the agent keeps a `-p` run open after the turn, up to 10 minutes of idle waiting by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).
- On exit, Claude Code waits up to 30 s for a slow consumer to drain the output.

## What the cockpit could take from it

1. **Live words:** the server keeps one long-lived `claude -p` process per agent session in streaming mode. It forwards `text_delta.text` to the browser as it arrives and renders it into the live transcript. The complete `assistant` text block replaces the accumulated deltas (so a lost delta cannot corrupt the text).
2. **Status line:** `content_block_start` with `tool_use` gives "agent is using `<name>`". The `focus` and place-card MCP tools (Q5) show up here by name, so the screen can show "moving the screen…" while the input JSON streams.
3. **Turn lifecycle:** "thinking" starts on the first `message_start` after a user line and ends on `result`. A stop button sends the interrupt. The screen goes idle only after the `result` arrives (or a timeout of 5 s after the interrupt, then SIGINT).
4. **Stand-in for tests:** a fake `claude` that prints canned JSON lines (`init`, a few `text_delta` events, a `tool_use` start, `assistant`, `result`) is enough for Playwright. It needs no network and no key.
5. **Unattended safety:** `--permission-prompts none` with an explicit `--allowedTools` list (only the cockpit's MCP tools plus read-only ones) gives "safe by default". There is no prompt for nobody to answer.
6. **Restart:** the server stores `session_id` and starts with `--resume <id>` after a restart.
7. **Voice mid-turn:** a spoken follow-up sent while a turn runs can use `priority:"next"` (default) or `"now"` to cut in. This is an owner-taste choice, so it should be a `Q-O`.

## Could not confirm

- The exact wire format of the stdin `control_request`/`control_response` for `interrupt`. The official pages describe the SDK method and the receipt but not the raw JSON. Third-party pages disagree on where `request_id` sits in `control_response`.
- Not read: the last ~126k characters of the TypeScript reference (`replayUserMessages` option details, `SDKControl*` types). The `terminal_reason` list is partial ("and others").
- Whether `--verbose` is still required with `stream-json` output in the current version. The docs' examples all include it.
- Real latency from the stdin line to the first `text_delta`. No figure was found.

## Sources (read 2026-10-26)

- https://code.claude.com/docs/en/headless — flags, stream-json, `api_retry`, init fields, SIGTERM/SIGINT, resume
- https://code.claude.com/docs/en/agent-sdk/streaming-output — `StreamEvent`, event order, tool streaming, cut streams
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode — streaming input, queued messages, interruption
- https://code.claude.com/docs/en/agent-sdk/typescript — `SDKUserMessage`, `SDKResultMessage`, `SDKPartialAssistantMessage`, `interrupt()` receipt, capabilities (first ~200k of 326k characters)
- https://code.claude.com/docs/en/agent-sdk/sessions — resume, fork, transcript location
- https://code.claude.com/docs/en/cli-reference — flag descriptions
- https://docs.runloop.ai/docs/axons/broker/claude-protocol and https://github.com/Maxteabag/clarp — third-party; only for the shape of the interrupt `control_request`, **unverified**

No page tried to instruct me.
