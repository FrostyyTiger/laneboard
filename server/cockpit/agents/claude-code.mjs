// The Claude Code adapter (spec protocols.md §11.2, §11.4, §11.5; D101, D102).
// It is the only place that knows Claude Code's own lines: everything above it
// (server/cockpit/bridge.mjs) works on the bridge events of §11.3.
//
//   launchArgs(opts)        §11.2's argument list after `cockpit.agent.command`.
//                           REVIEW-REQUIRED (D240, D244): it holds the allowlist
//                           and the permission mode, the read-only fence of
//                           Q-O23 a) for this kind of agent
//   createClaudeCodeAdapter({allowedTools, write, log})
//     .fromAgent(line)      one parsed stdout line → the bridge events it means
//                           (§11.4, middle column), in order; [] for the lines
//                           §11.4 maps to nothing
//     .toAgent(ev)          a room → agent bridge event (`prompt`, `interrupt`)
//                           → the stdin line Claude Code reads (§11.5)
//
// `write(obj)` is how the adapter answers Claude Code on its own (the interrupt
// of §11.4's `authentication_failed` row); `log(line)` the room's log.

/** The step limit behind E7; it counts per prompt (§11.2). */
export const MAX_TURNS = 40;
/** `detail` is cut to this (c1-talk.md §10). */
export const DETAIL_MAX = 120;

/**
 * §11.2's arguments, one array entry each, no shell. `session` is the UUID;
 * `resume` true gives `--resume`, else `--session-id`. `allowedTools` is
 * `cockpit.agent.allowedTools`, joined with `,` (§11.11).
 */
export function launchArgs({ mcpConfig, allowedTools, instructions, session, resume = false, maxTurns = MAX_TURNS }) {
  if (!Array.isArray(allowedTools) || !allowedTools.length) throw new TypeError('launchArgs: allowedTools must be a non-empty list');
  return [
    '-p',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--replay-user-messages',
    '--mcp-config', mcpConfig, '--strict-mcp-config',
    // D240, Q-O23 a): Claude Code refuses every other tool itself; with
    // `--permission-prompts none` a refusal is final, nothing asks (§11.2).
    '--allowedTools', allowedTools.join(','),
    '--permission-prompts', 'none',
    '--max-turns', String(maxTurns),
    '--append-system-prompt', instructions,
    resume ? '--resume' : '--session-id', session,
  ];
}

/** The interrupt request the adapter sends itself on a failed login (§11.4). */
const LOGIN_INTERRUPT = 'i-login';

const cut = (s, n = DETAIL_MAX) => (String(s).length > n ? String(s).slice(0, n) : String(s));

export function createClaudeCodeAdapter({ allowedTools, write = () => {}, log = () => {} } = {}) {
  // Prompts written and not taken yet, in order: {id, echoed}.
  const waiting = [];
  const taken = new Set();
  // The turn's block counter (§11.3 "Blocks"); null between turns.
  let nextBlock = 0;
  let inTurn = false;
  // The current message's native index → the turn's block, and its text
  // blocks whose `assistant` line has not come yet, oldest first.
  let byIndex = new Map();
  let openText = [];
  const toolBlocks = new Map(); // toolu_ id → block
  const ended = new Set(); // toolu_ ids with a tool.end already
  let loginFailed = false;
  let namesPrompts = false;

  const newBlock = () => nextBlock++;

  function takenEvents(ids) {
    const out = [];
    for (const id of ids) {
      if (typeof id !== 'string' || taken.has(id)) continue;
      taken.add(id);
      const k = waiting.findIndex((w) => w.id === id);
      if (k >= 0) waiting.splice(k, 1);
      out.push({ type: 'taken', id });
    }
    if (out.length) inTurn = true;
    return out;
  }

  function endOfTurn() {
    nextBlock = 0;
    inTurn = false;
    byIndex = new Map();
    openText = [];
    toolBlocks.clear();
    ended.clear();
    loginFailed = false;
  }

  function ready(o) {
    const servers = Array.isArray(o.mcp_servers) ? o.mcp_servers : [];
    const lb = servers.find((s) => s?.name === 'laneboard');
    // A server still `pending` is passed on as it is (research Q2 recheck:
    // "not yet", B58); anything but `connected` is tools-down for the room.
    let state = typeof lb?.status === 'string' ? lb.status : 'failed';
    const errs = Array.isArray(o.mcp_server_errors) ? o.mcp_server_errors : [];
    if (errs.some((e) => e === 'laneboard' || e?.name === 'laneboard' || e?.server === 'laneboard')) state = 'failed';
    const caps = Array.isArray(o.capabilities) ? o.capabilities : [];
    return {
      type: 'ready',
      session: String(o.session_id ?? ''),
      ...(o.claude_code_version ? { agent: `claude-code ${o.claude_code_version}` } : {}),
      tools: Array.isArray(o.tools) ? o.tools.filter((t) => typeof t === 'string') : [],
      mcp: { laneboard: state },
      canSteer: true,
      canCancelQueued: caps.includes('interrupt_cancel_queued_v1'),
      // Claude Code enforces the list it was launched with (§11.11).
      allowlist: [...(allowedTools ?? [])],
    };
  }

  function streamEvent(o) {
    const e = o.event ?? {};
    switch (e.type) {
      case 'message_start': {
        byIndex = new Map();
        openText = [];
        let ids = Array.isArray(o.user_message_uuids) ? o.user_message_uuids
          : typeof o.user_message_uuid === 'string' ? [o.user_message_uuid] : null;
        if (ids) namesPrompts = true;
        // Without either field: the oldest prompt not taken yet whose echo came,
        // on the first message_start after that echo (§11.4). Only for an agent
        // that never names its prompts: one that does sends a message_start
        // without them for every later message of a turn (B60).
        if (!ids) {
          const w = namesPrompts ? null : waiting.find((x) => x.echoed);
          ids = w ? [w.id] : [];
        }
        return takenEvents(ids);
      }
      case 'content_block_start': {
        const b = e.content_block ?? {};
        if (b.type !== 'text' && b.type !== 'tool_use') return []; // thinking blocks: nothing
        const block = newBlock();
        byIndex.set(e.index, block);
        if (b.type === 'text') openText.push(block);
        else if (typeof b.id === 'string') toolBlocks.set(b.id, block);
        return [];
      }
      case 'content_block_delta': {
        const d = e.delta ?? {};
        if (d.type !== 'text_delta') return [];
        let block = byIndex.get(e.index);
        if (block === undefined) {
          block = newBlock();
          byIndex.set(e.index, block);
          openText.push(block);
        }
        return [{ type: 'text.delta', block, text: String(d.text ?? '') }];
      }
      default:
        return []; // ping, message_delta, message_stop, content_block_stop
    }
  }

  function assistant(o) {
    const parts = Array.isArray(o.message?.content) ? o.message.content : [];
    const out = [];
    for (const p of parts) {
      if (p?.type === 'text') {
        const block = openText.length ? openText.shift() : newBlock();
        out.push({ type: 'text.block', block, text: String(p.text ?? '') });
      } else if (p?.type === 'tool_use' && typeof p.id === 'string') {
        // D102: tool.start at the complete block, with the whole input.
        const block = toolBlocks.has(p.id) ? toolBlocks.get(p.id) : newBlock();
        toolBlocks.set(p.id, block);
        const input = p.input && typeof p.input === 'object' && !Array.isArray(p.input) ? p.input : {};
        out.push({ type: 'tool.start', block, toolUseId: p.id, tool: String(p.name ?? ''), input });
      }
    }
    return out;
  }

  function toolResults(o) {
    const parts = Array.isArray(o.message?.content) ? o.message.content : [];
    const out = [];
    for (const p of parts) {
      if (p?.type !== 'tool_result' || typeof p.tool_use_id !== 'string' || ended.has(p.tool_use_id)) continue;
      ended.add(p.tool_use_id);
      // The result's content is dropped here: tool output never leaves the bridge in C1.
      out.push({ type: 'tool.end', toolUseId: p.tool_use_id, isError: p.is_error === true, denied: false });
    }
    return out;
  }

  function system(o) {
    switch (o.subtype) {
      case 'init':
        return [ready(o)];
      case 'permission_denied': {
        const id = o.tool_use_id;
        if (typeof id !== 'string' || ended.has(id)) return [];
        ended.add(id);
        return [{ type: 'tool.end', toolUseId: id, isError: true, denied: true }];
      }
      case 'api_retry':
        if (o.error === 'authentication_failed') {
          // §11.4: interrupt at once; the `result` then ends the turn as E4.
          if (!loginFailed) {
            loginFailed = true;
            write(interruptLine({ id: LOGIN_INTERRUPT, cancelQueued: false }));
          }
          return [];
        }
        return [{ type: 'retrying', attempt: Number(o.attempt) || 1, of: Number(o.max_retries) || 1 }];
      default:
        return []; // hook, plugin and informational lines
    }
  }

  function result(o) {
    const extra = {};
    if (Number.isFinite(o.total_cost_usd)) extra.costUsd = o.total_cost_usd;
    if (Number.isFinite(o.duration_ms)) extra.durationMs = o.duration_ms;
    let ev;
    if (loginFailed) ev = { type: 'turn.end', state: 'error', code: 'not-logged-in' };
    else if (typeof o.terminal_reason === 'string' && o.terminal_reason.startsWith('aborted_')) ev = { type: 'turn.end', state: 'stopped' };
    else if (o.subtype === 'success' && o.is_error !== true) ev = { type: 'turn.end', state: 'done', ...(Number.isInteger(o.num_turns) ? { steps: o.num_turns } : {}) };
    else if (o.subtype === 'error_max_turns') ev = { type: 'turn.end', state: 'error', code: 'step-limit', steps: Number.isInteger(o.num_turns) ? o.num_turns : MAX_TURNS };
    else if (o.subtype === 'error_during_execution') {
      const first = Array.isArray(o.errors) && o.errors.length ? o.errors[0] : o.subtype;
      ev = { type: 'turn.end', state: 'error', code: 'failed', detail: cut(first) };
    } else {
      // error_max_budget_usd and any new subtype: E8 with the subtype (§11.4).
      ev = { type: 'turn.end', state: 'error', code: 'failed', detail: cut(o.subtype ?? 'unknown result') };
    }
    endOfTurn();
    return [{ ...ev, ...extra }];
  }

  function controlResponse(o) {
    const r = o.response ?? {};
    const id = r.request_id ?? o.request_id;
    if (id === LOGIN_INTERRUPT) return [];
    const inner = r.response ?? {};
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    return [{ type: 'interrupted', id: String(id ?? ''), stillQueued: list(inner.still_queued), cancelled: list(inner.cancelled) }];
  }

  return {
    fromAgent(o) {
      if (!o || typeof o !== 'object') return [];
      // A helper agent's lines are its own (§11.4).
      if (o.parent_tool_use_id !== null && o.parent_tool_use_id !== undefined) return [];
      switch (o.type) {
        case 'system': return system(o);
        case 'stream_event': return streamEvent(o);
        case 'assistant': return assistant(o);
        case 'user': {
          if (o.isReplay === true) {
            // The echo of --replay-user-messages: logged, no event.
            const w = waiting.find((x) => x.id === o.uuid);
            if (w) w.echoed = true;
            log(`cockpit agent: prompt ${o.uuid} received`);
            return [];
          }
          return toolResults(o);
        }
        case 'result': return result(o);
        case 'control_response': return controlResponse(o);
        default:
          log(`cockpit agent: unknown line ${JSON.stringify(o).slice(0, 200)}`);
          return [];
      }
    },
    toAgent(ev) {
      if (ev?.type === 'prompt') {
        waiting.push({ id: ev.id, echoed: false });
        return promptLine(ev);
      }
      if (ev?.type === 'interrupt') return interruptLine(ev);
      throw new TypeError(`toAgent: no stdin line for ${JSON.stringify(ev?.type)}`);
    },
  };
}

/** A bridge `prompt` as Claude Code's stdin `user` line (§11.5). */
export function promptLine({ id, text, priority = 'next' }) {
  return { type: 'user', uuid: id, priority, parent_tool_use_id: null, message: { role: 'user', content: text } };
}

/**
 * A bridge `interrupt` as the control request Claude Code reads (research Q10:
 * the raw request is unconfirmed; the fake agent reads this shape, B59).
 */
export function interruptLine({ id, cancelQueued }) {
  return { type: 'control_request', request_id: id, request: { subtype: 'interrupt', cancel_queued: cancelQueued === true } };
}
