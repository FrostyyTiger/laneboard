# Q2 (build night) — does `protocols.md` §11.2/§11.4 still match Claude Code's stream-json?

(The spec night's research with the same number is `docs/plans/cockpit/research/Q2-claude-code-headless-stream-json.md`; this is the recheck against today's docs. Read that one first.)

## Answer in brief

- **Yes for every event type and field §11.4 maps.** The headless, CLI-reference and SDK docs as of 2026-10-27 still describe: `system`/`init` with `session_id`, `stream_event` text deltas (with `--include-partial-messages`), `assistant`/`user` blocks, `permission_denied`, `api_retry`, `result` with `subtype`.
- **No flag of §11.2 was renamed or removed.** All twelve are in the current CLI reference. Two have version floors: `--permission-prompts` needs v2.1.259 or later; `--max-turns` is "print mode only" and now documents queue behaviour (below).
- **`--verbose` is still in every stream-json example.** Whether it is strictly required was not testable (no shell). Keep it, as §11.2 does.
- **New facts worth knowing**: since v2.1.302 a `-p` run with no permission mode starts in **Manual mode**; a call needing approval is denied unless a hook or `--permission-prompt-tool` approves it. With `--permission-prompts none` the denial also tells Claude not to retry. So §11.2's flags stay safe.
- Still **unconfirmed** (the same three as Q10 asks): the raw `interrupt` control request/response, whether `init` comes before the first stdin line, the `result` of a failed login.

## Checked against §11.2 (flag by flag)

| §11.2 flag | Current docs (CLI reference, read 2026-10-27) |
| - | - |
| `-p` | present |
| `--input-format stream-json` | "options: `text`, `stream-json`" |
| `--output-format stream-json` | "options: `text`, `json`, `stream-json`" |
| `--verbose` | present; every stream-json example in the headless docs carries it |
| `--include-partial-messages` | "Requires `--print` and `--output-format stream-json`" |
| `--replay-user-messages` | "Requires `--input-format stream-json` and `--output-format stream-json`" |
| `--mcp-config` + `--strict-mcp-config` | "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations" |
| `--allowedTools` | present (permission-rule syntax; `mcp__laneboard__*` style entries are permission rules) |
| `--permission-prompts none` | "Requires Claude Code v2.1.259 or later. Earlier versions reject it with an unknown-option error." |
| `--max-turns 40` | "print mode only. Exits with an error when the limit is reached. … With `--input-format stream-json`, a message still queued when the limit ends a turn stays queued and starts a new turn with its own limit" |
| `--append-system-prompt` | present. Also `--append-system-prompt-file`; since v2.1.283 both forms may be combined. |
| `--session-id` / `--resume` | "must be a valid UUID" / by ID or name; also a `.jsonl` path |

### Two details that touch the spec

1. **`--max-turns` and the queue.** §11.2 says the limit "counts per prompt". The docs say a *queued* message survives a limit hit and starts a new turn with its own limit. That agrees with "per prompt", but means that after an E7 (`step-limit`) a queued prompt may start by itself. The room should expect a `taken` for it, and `cancelQueued:true` only helps for an interrupt. Worth one test line at build time.
2. **`--append-system-prompt` and resume.** The CLI reference has a section "System prompt flags in resumed conversations": the system prompt is *recorded on the conversation's first request* and reused on resume (new flag `--system-prompt-snapshot off|on`, v2.1.257+, default `on`). So an edit to the standing instructions (§11.8) may **not** take effect for a session started with `--resume` unless the room passes `--system-prompt-snapshot off`. The section's body was not read. The builder should read https://code.claude.com/docs/en/cli-reference#system-prompt-flags-in-resumed-conversations before relying on a changed `--append-system-prompt` across `--resume`. If it matters, add `--system-prompt-snapshot off` to the argument list (a spec change: owner decision, see below).

## Checked against §11.4 (event by event)

| §11.4 row | Docs now |
| - | - |
| `system`/`init` fields `session_id`, `claude_code_version`, `tools`, `mcp_servers[{name,status}]`, `mcp_server_errors`, `capabilities` | all documented. `init` "is the first event in the stream unless startup events precede it" (`plugin_install`, `hook_started`/`hook_progress`/`hook_response`). The adapter must ignore those lines before `init`. `mcp_servers[].status` can also be `pending`; the headless page: with `--mcp-config` and `-p`, Claude Code waits for pending servers before the first turn, up to `MCP_TIMEOUT` (30 s default; v2.1.221+). `pending` is not `connected`: §11.4 would turn it into `tools-down`. A local stdio/HTTP server should be `connected` by `init`, but the adapter should treat `pending` as "not yet", not as down. |
| `stream_event` / `text_delta` | `jq` example in the headless docs: `.type == "stream_event" and .event.delta.type? == "text_delta"` → `.event.delta.text` |
| `assistant` / `user` blocks, `parent_tool_use_id` | "Messages from the main conversation carry `null`"; subagent messages carry the Agent/Skill `tool_use` id, or a `forked-command-…` value |
| `system`/`permission_denied` | "With `--output-format stream-json`, denials appear as `permission_denied` system messages, and the final result message lists them in `permission_denials`." Field names `tool_use_id` / `tool_name` were **not** shown in the pages read; pin them in a real run. |
| `system`/`api_retry` | fields `attempt`, `max_retries`, `retry_delay_ms`, `error_status` (integer or null), `no_response` (optional), `error`, `uuid`, `session_id`. `error` ∈ `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown`. §11.4 maps only `authentication_failed` to `not-logged-in`. **`oauth_org_not_allowed` and `account_on_hold` also mean the owner must act**; not a spec error, but the builder may add them to the same row (small, reversible: DECISIONS line). |
| `result` | "The last line of the stream is a `result` message with the final response text, cost, and session metadata." `subtype`, `terminal_reason`, `permission_denials`, `total_cost_usd`, `num_turns` are in the SDK reference read in the spec night. |

## Smaller notes for the adapter

- A slow stdout reader: Claude Code waits for the queue to drain on exit, up to 30 s. Read stdout continuously.
- Piped stdin is capped at 10 MB (§11.3's prompts are far below).
- After SIGTERM the process exits 143 and records no result (so §11.4's "the process exits" row is right).
- Missing authentication inside a run: "Claude Code prints the failure as the result on stdout" (headless page). So a failed login in stream-json mode most likely ends with a `result` whose `is_error` is true and whose `result` text is one of the Q1 strings. Not confirmed with a real run.
- Working directory deleted mid-session: a warning message arrives in the stream (an `SDKInformationalMessage`); the adapter's "unknown line" rule covers it.

## Could not confirm

- The raw `interrupt` control request and `control_response` shape (still only third-party sources). Q10 covers it.
- Exact keys of `permission_denied`.
- Whether `--verbose` can be dropped.
- The body of "System prompt flags in resumed conversations".
- No shell: nothing was run.

## Sources (read 2026-10-27)

- https://code.claude.com/docs/en/cli-reference — flag table, `claude auth`, system prompt flags, `--permission-prompts`, `--max-turns`
- https://code.claude.com/docs/en/headless — stream-json, `api_retry` table, `init` fields, MCP wait, permission prompts, SIGTERM, drain wait
- https://code.claude.com/docs/en/authentication — credential sources (for the login note)
- the spec night's research file (above) for everything not repeated here

No page tried to instruct me.
