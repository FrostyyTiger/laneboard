# Q8 — What Claude Code does with a prompt sent while a turn runs

## Answer in brief

- Default (`priority` unset or `"next"`): the message is queued. Claude reads it **in the same turn, as soon as the tool calls it is running finish**. If the turn ends first, it starts the next turn. It does not interrupt the turn.
- `priority:"later"`: held until the turn ends, then sent as a new turn. This is the "end of turn only" mode.
- `priority:"now"`: Claude Code interrupts the turn and Claude reads the message next. With `origin:{kind:"human"}` on v2.1.286+ it first tries to move background-able work (shell commands, subagents, MCP calls) to the background and keeps the turn going; if Claude is only writing text or the work cannot move, it interrupts.
- `interrupt` control request: the receipt lists `still_queued` message UUIDs; those run after the interrupt unless `cancel_queued:true` (v2.1.219+) cancels them.
- One contrary community report (one test, claude 2.1.175, a version older than the docs above): a mid-turn stdin message was ignored and produced no turn. Treat the docs as the contract but test with the installed version.

## What the spec needs

### Wire format (official, TypeScript reference `SDKUserMessage`)

```
{ type:"user", uuid?, session_id?, message:{role:"user",content}, parent_tool_use_id:null,
  shouldQuery?:boolean, priority?:"now"|"next"|"later", origin?:{kind:"human"|...}, ... }
```

- `priority` "controls when a message you send during a running turn reaches Claude" (quoted semantic above).
- `shouldQuery:false` appends to the transcript without a turn; it is merged into the next message that triggers one.
- Give every message a `uuid`: it is the only way to find it in `still_queued` / `cancelled`. "Only messages enqueued with a UUID appear."
- Capabilities in `system/init`: `interrupt_receipt_v1` (v2.1.205+), `interrupt_cancel_queued_v1` (v2.1.219+). Feature-detect on these, not on version strings.
- `SDKControlInterruptResponse = { still_queued: string[]; cancelled?: string[] }`. The receipt arrives before the interrupted turn's `result`. A listed message "enters the conversation whether or not it gets a response, so resending it delivers it to Claude twice."
- Interactive CLI (for the owner's mental model, not the cockpit's wire): Enter while working queues; queued items show grey until Claude starts on them; messages pass to Claude after the running tool calls finish, within the same turn; commands/shell commands wait for the turn end; `Ctrl+Enter` (v2.1.275+) sends now; `Esc` interrupts and keeps the queue and sends it right away.

### Timing, in words

A spoken follow-up with the default priority is not heard until the current tool call returns. During one long tool call (a long Bash, a subagent) it can wait minutes. During text-only writing there is no tool boundary, so the message waits for the turn end (or the next boundary). So "default" is neither immediate nor strictly end-of-turn.

## What the cockpit could take from it (answers to Q-O1 option d)

1. Map the owner's three intents to priorities, each a visible control and a visible state:
   - speak while the agent works (default): `priority:"next"`. Screen shows the words as **queued** (grey, like the CLI) until Claude's next `stream_event`/`assistant` after the tool boundary, then normal. Label e.g. `QUEUED: the agent reads it when its current step finishes`.
   - "after you finish": `priority:"later"`.
   - STOP / "no, stop": `interrupt` first (receipt), then send the new message. With `cancel_queued:true` when the owner says stop, so older queued words do not run after it.
2. Use `uuid` on every message and show `still_queued` / `cancelled` from the receipt, so the screen never claims a message was heard when it was dropped.
3. Do not rely on `priority:"now"` alone as "stop": it interrupts only by design when Claude is writing or the work cannot move, and it may instead background work. The STOP button is the `interrupt` request.
4. A safety net for the 2.1.175-style report: if a queued message has no matching `--replay-user-messages` echo / no new `message_start` within a timeout after the turn's `result`, the server resends it once as a new turn (only if it is not in `still_queued`/`cancelled`, to avoid double delivery) and the screen shows it as not heard until then. The timeout number is a spec decision (suggest 10 s after `result`).
5. The stand-in `claude` for tests should model all three priorities and the receipt, including a "message ignored" mode, so the grey-until-heard state and the resend path are testable.
6. Raise `Q-O1` caution as in PROGRESS: a spoken correction by default arrives only at a tool boundary; if the owner means "stop, do this instead", only STOP + new message is reliable.

## Could not confirm

- Exact raw JSON of the `interrupt` control request on stdin with `cancel_queued` (the official page describes it but not the envelope; see Q2).
- Whether the 2.1.175 "ignored" behaviour was fixed in a documented version; the docs do not mention it. The reporter's envelope was not given.
- The last ~126k characters of the TypeScript reference (`SDKMessageOrigin` details) were not read.
- Third-party claims that `Ctrl+Enter` arrived in v2.1.275 are confirmed by the official interactive-mode page. The April 2026 issue's wording ("flushes at the next LLM pause") was about the desktop/web app and is consistent with the docs' "after the running tool calls finish".

## Sources (read 2026-10-27)

- https://code.claude.com/docs/en/interactive-mode — "Queue messages while Claude works", "When Claude Code sends what you queued"
- https://code.claude.com/docs/en/agent-sdk/typescript — `SDKUserMessage` `priority`/`shouldQuery`, `interrupt()`, `SDKControlInterruptResponse`, capabilities table
- https://code.claude.com/docs/en/headless — `capabilities` in `system/init`, SIGINT/SIGTERM
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode — queued messages, interruption in streaming input mode
- https://github.com/tiann/hapi/issues/888 — community test, claude 2.1.175, mid-turn stdin message ignored (third party, one report)
- https://github.com/anthropics/claude-code/issues/49373 — desktop/web queue flushes at the next LLM pause (closed as duplicate, April 2026)

No page tried to instruct me.
