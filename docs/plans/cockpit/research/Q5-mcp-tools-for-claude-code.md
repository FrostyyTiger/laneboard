# Q5 — How an MCP server exposes tools to Claude Code

## Answer

- Claude Code talks to MCP servers over **stdio** (it spawns the server) or **Streamable HTTP** (`"type": "http"`; SSE is deprecated). Both work in headless `-p` runs.
- A headless session gets the cockpit's server with `--mcp-config <file-or-json>` (add `--strict-mcp-config` so nothing else loads). Tools are named `mcp__<server>__<tool>`. `--allowedTools "mcp__cockpit__*"` pre-approves them; without it a `-p` call that needs approval is denied.
- A tool is `{name, description, inputSchema}`; its result is `content[]` (text, image, audio, resource_link, embedded resource) plus `isError`. Output over 25,000 tokens (default) is saved to a file and the model gets an error naming it; text over 50,000 characters is too.
- MCP is request/response: a server cannot "push state" to the model. It can push only `notifications/tools/list_changed` (refreshes the tool list, in `-p` too) and, via the `claude/channel` capability, events into the session. Cockpit state for `focus` must be **pulled by a tool call** (or injected by the hub in the prompt).

## What the spec needs

### Transport and config
- stdio: server reads newline-delimited JSON-RPC on stdin, writes only valid MCP messages to stdout, logs to stderr. Messages must not contain newlines.
- Streamable HTTP: one endpoint (e.g. `/mcp`) taking POST and GET. Server MUST validate `Origin`, SHOULD bind to 127.0.0.1, SHOULD authenticate. Optional `Mcp-Session-Id` header; client must send `MCP-Protocol-Version`.
- Config shape (same keys in `--mcp-config` JSON and `.mcp.json`):
  `{"mcpServers":{"cockpit":{"command":"node","args":["…"],"env":{…}}}}` for stdio, or `{"mcpServers":{"cockpit":{"type":"http","url":"http://127.0.0.1:PORT/mcp","headers":{"Authorization":"Bearer ${COCKPIT_TOKEN}"}}}}`. `${VAR}` / `${VAR:-default}` expand in command, args, env, url, headers.
- An entry that fails validation (e.g. `url` without `type`) is **skipped silently**; the run continues. It shows in `system/init` as `mcp_server_errors[]` `{name,type,message}`; the server's own state is in `mcp_servers[]` `{name,status}` with status `pending|connected|failed|needs-auth|disabled`. The hub should treat a missing/`failed` `cockpit` server as an error to show the owner, not run on.
- `-p` waits for pending servers before turn 1, up to `MCP_TIMEOUT` (30 s default; `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` overrides). Per-call limit `MCP_TOOL_TIMEOUT`, or `"timeout"` ms per server in config. After a drop: 5 retries with backoff, then the run continues without the server's tools.
- Project `.mcp.json` servers load in `-p` without any approval prompt; `--bare` or `--strict-mcp-config` stops that.

### Tools
- `tools/list` item: `name`, optional `title`, `description`, `inputSchema` (JSON Schema, `type: object`), optional `outputSchema`, `annotations` (untrusted by clients).
- `tools/call` params `{name, arguments}`; result `{content:[…], isError?:bool, structuredContent?:{…}}`. Two error kinds: JSON-RPC error (unknown tool, bad args, code -32602) vs. `isError:true` with a text explanation the model sees and can act on. Cockpit tools should use `isError:true` with a plain sentence (e.g. "No card with id c7") so the agent can recover.
- Content types: `text {type,text}`, `image {type,data(base64),mimeType}`, `audio`, `resource_link {uri,name,mimeType}`, `resource`. A tool that returns structured content should also return it as serialized JSON text.
- Naming: `mcp__<server>__<tool>`; `.` and spaces in the server name become `_`. Use a server key without dots (`cockpit`). Permission rules take `mcp__cockpit__focus` or `mcp__cockpit__*`.
- Permissions: MCP tools need explicit permission. `acceptEdits` does **not** approve them; `bypassPermissions` does but is far too broad. List them in `--allowedTools`. In `dontAsk` mode an unlisted MCP tool is denied. Tool results show in `stream-json` as `tool_use` blocks (name `mcp__cockpit__…`) and `tool_result` blocks, so the pane's tool lines (c1-talk) can be rendered from them.
- Tool search is on by default: with many tools Claude Code may defer tool definitions; `alwaysLoad: true` on the server config exempts it. With <10 small cockpit tools this should not matter, but name it in the builder notes.

### Pushing state (`focus`)
- `notifications/tools/list_changed` only refreshes the tool list. It does not tell the model anything about what is on screen.
- Channels: a server declaring `claude/channel` can push events into a session when Claude Code is started with `--channels`. Details are on separate pages not read here; treat as an unconfirmed option and do not depend on it.
- Therefore: either (a) a `get_screen` tool the agent calls (returns current view, selected lane/run, cards on screen), or (b) the hub prepends a short "screen state" block to each user turn it sends. (b) costs no tool call and cannot be forgotten by the model; (a) is cheaper per turn when state is large. Both are plain, testable.
- With a stdio server the process is a child of `claude`, not of the hub, so it needs a way back to the hub (loopback HTTP + token in `env`). With Streamable HTTP the hub can serve `/mcp` itself and share state in-process, but must then do Origin check, loopback bind and a bearer token.

## What the cockpit could take, concretely
1. One server key `cockpit`; launch each agent turn with `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --mcp-config <json> --strict-mcp-config --allowedTools "mcp__cockpit__*"` plus only the read-only built-ins the owner approves.
2. Tests against stand-ins: a fake `claude` that emits `system/init` with `mcp_servers:[{name:"cockpit",status:"connected"}]`, then `tool_use` `mcp__cockpit__<tool>`; assert the screen moves. A startup test: init with `mcp_server_errors` non-empty or status `failed` → pane shows an error line, no turn runs.
3. Tool results to the agent are short text (a card's id, "ok"); never screenshots or whole run logs, to stay far below the 25,000-token cap. Cap any list result (e.g. 50 lanes) in the spec.
4. Validate every argument server-side (spec MUST) and rate-limit placement calls; the MCP spec requires input validation, access control, rate limiting, output sanitising.
5. Show tool calls to the owner (pane tool lines), as MCP's guidance asks for visible indicators when tools run.

## Not confirmed
- Exact `--mcp-config` JSON form accepted on the command line (docs say "file or JSON"; `.mcp.json` shape assumed, same keys).
- Channels protocol details (not read); whether `list_changed` over stdio in `-p` is reliable for a changing tool set (docs say the list refreshes).
- The permission page's exact precedence for `--allowedTools` with `mcp__server__*` in `-p` was taken from the Agent SDK page.
- Remaining 51k characters of the MCP page were not read.

## Sources (read 2026-10-27)
- https://code.claude.com/docs/en/mcp (transports, scopes, `.mcp.json`, output limits, `list_changed`, channels, headless behaviour; first 100k chars)
- https://code.claude.com/docs/en/agent-sdk/mcp (naming, `allowedTools` wildcards, connection timing, status values, output cap, `acceptEdits`/`bypassPermissions` notes)
- https://code.claude.com/docs/en/headless (`--bare`, `--mcp-config`, `mcp_servers`/`mcp_server_errors` in init, `--allowedTools`, permission behaviour in `-p`)
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools (tool and result shapes, errors, security)
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports (stdio, Streamable HTTP, Origin/localhost warning, sessions)

No page tried to give instructions.
