#!/usr/bin/env node
// The fake agent (cockpit spec `stand-ins.md` §2): a program the room starts as
// its agent child instead of `claude`. It replays a script (`$FAKE_AGENT_DIR/script.json`,
// §2.2) and speaks Claude Code's native stream-json lines (`protocols.md` §11.4's
// left column), so the room's adapter runs in every test.
//
//   node test/cockpit/stand-ins/fake-agent.mjs -p --input-format stream-json … --session-id <uuid>
//   node test/cockpit/stand-ins/fake-agent.mjs auth status        (the login check, §2.4)
//
// Plain Node, no dependency. `$FAKE_AGENT_DIR` (absolute) holds `script.json`
// (re-read at every prompt and every start), `received.jsonl` (its log, §2.6,
// read with ./fake-agent-log.mjs) and `starts` (how many times it started).
//
// Dialects `claude` (default) and `bridge` (§2.5); every step of §2.3, the real
// MCP call of an `mcp__laneboard__*` tool (to the URL of `--mcp-config`), `start`,
// the login check; `queued`, `onInterrupt`, `priority` and signals (§2.4).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const USAGE = `usage: node test/cockpit/stand-ins/fake-agent.mjs [claude's arguments] (FAKE_AGENT_DIR set)
       node test/cockpit/stand-ins/fake-agent.mjs auth status
A stand-in for Claude Code in the cockpit's tests (docs/plans/cockpit/spec/stand-ins.md §2).
Reads --session-id, --resume, --mcp-config, --max-turns and --dialect claude|bridge; ignores the rest.
`;

/** The version `init` reports: honest about what answers, read as `ready.agent`. */
export const FAKE_VERSION = '0.0.0-fake';
/** The tools `init` lists (the allowlist of `protocols.md` §11.2 as Claude Code would expand it). */
export const FAKE_TOOLS = ['Read', 'Grep', 'Glob', 'mcp__laneboard__morning', 'mcp__laneboard__fleet',
  'mcp__laneboard__alerts', 'mcp__laneboard__runs', 'mcp__laneboard__focus'];
export const STEP_KINDS = ['text', 'tool', 'denied', 'retry', 'end', 'exit'];
export const END_KINDS = ['done', 'step-limit', 'failed', 'not-logged-in'];

/** Which kind a script step is (`stand-ins.md` §2.3), or null. */
export function stepKind(step) {
  if (!step || typeof step !== 'object') return null;
  if ('text' in step) return 'text';
  if ('tool' in step) return 'tool';
  if ('denied' in step) return 'denied';
  if ('retry' in step) return 'retry';
  if ('end' in step) return 'end';
  if ('exit' in step) return 'exit';
  return null;
}

/**
 * The owner's words of a prompt's text: the last part, after the bracketed
 * lines of `protocols.md` §11.5 (about line, spoken line).
 */
export function ownerWords(raw) {
  const lines = String(raw).split('\n');
  let i = 0;
  while (i < lines.length - 1 && /^\(.*\)$/.test(lines[i].trim())) i++;
  return lines.slice(i).join('\n');
}

/**
 * The first turn not played yet (or `repeat`) whose `match` is a case-insensitive
 * substring of the words; a turn without `match` matches anything (§2.2).
 * Returns its index, or -1.
 */
export function matchTurn(script, words, played) {
  const w = String(words).toLowerCase();
  const turns = Array.isArray(script?.turns) ? script.turns : [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (played.has(i) && !t.repeat) continue;
    if (t.match == null || w.includes(String(t.match).toLowerCase())) return i;
  }
  return -1;
}

/** The no-match answer of §2.2: one text block, then `done`. */
export function noMatchTurn(words) {
  return { steps: [{ at: 0, text: `(fake agent: no scripted turn for "${String(words).slice(0, 40)}")` }, { at: 0, end: 'done' }] };
}

/**
 * A turn's steps as a timeline: each step at its `at`, each tool's result at
 * its `endAt`; by time, then file order (a tool's end right after its own step).
 */
export function timeline(steps) {
  const ev = [];
  steps.forEach((s, i) => {
    ev.push({ t: Number(s.at) || 0, seq: i * 2, step: s, kind: stepKind(s) });
    if (stepKind(s) === 'tool') ev.push({ t: Number(s.endAt ?? s.at) || 0, seq: i * 2 + 1, step: s, kind: 'tool-end' });
  });
  return ev.sort((a, b) => a.t - b.t || a.seq - b.seq);
}

/**
 * Whether the call of `events[k - 1]` (a tool step) shares its message with the
 * next one: the next event that is not its own end is a call starting before
 * its `endAt` (parallel calls, B5).
 */
export function parallelCall(events, k) {
  const ev = events[k - 1];
  if (ev?.kind !== 'tool') return false;
  const nextEv = events.slice(k).find((e) => e.kind !== 'tool-end' || e.step !== ev.step);
  return nextEv?.kind === 'tool' && nextEv.t < Number(ev.step.endAt ?? ev.step.at);
}

// --- Native lines (`protocols.md` §11.4, left column; §11.5 for stdin) ---
// One builder per row, so test/cockpit-fake-agent.test.mjs can hold each line
// the fake writes against the row it stands for.
export const native = {
  init: ({ session, mcp, capabilities }) => ({ type: 'system', subtype: 'init', session_id: session,
    claude_code_version: FAKE_VERSION, tools: FAKE_TOOLS,
    mcp_servers: [{ name: 'laneboard', status: mcp }], capabilities }),
  replay: ({ uuid, content }) => ({ type: 'user', isReplay: true, uuid, message: { role: 'user', content } }),
  messageStart: ({ uuids, msgId }) => ({ type: 'stream_event',
    ...(uuids ? { user_message_uuids: uuids } : {}),
    event: { type: 'message_start', message: { id: msgId, role: 'assistant' } } }),
  textStart: ({ index }) => ({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } }),
  textDelta: ({ index, text }) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } }),
  textBlock: ({ msgId, text }) => ({ type: 'assistant', message: { id: msgId, content: [{ type: 'text', text }] } }),
  toolStart: ({ index, id, name }) => ({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } } }),
  toolDelta: ({ index, input }) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } }),
  toolBlock: ({ msgId, id, name, input }) => ({ type: 'assistant', message: { id: msgId, content: [{ type: 'tool_use', id, name, input }] } }),
  toolResult: ({ id, isError, content }) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } }),
  blockStop: ({ index }) => ({ type: 'stream_event', event: { type: 'content_block_stop', index } }),
  messageDelta: ({ stopReason }) => ({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: stopReason } } }),
  messageStop: () => ({ type: 'stream_event', event: { type: 'message_stop' } }),
  ping: () => ({ type: 'stream_event', event: { type: 'ping' } }),
  denied: ({ id, name }) => ({ type: 'system', subtype: 'permission_denied', tool_use_id: id, tool_name: name }),
  retry: ({ attempt, of, error }) => ({ type: 'system', subtype: 'api_retry', attempt, max_retries: of, error }),
  done: ({ numTurns, durationMs, costUsd }) => ({ type: 'result', subtype: 'success', is_error: false,
    num_turns: numTurns, duration_ms: durationMs, total_cost_usd: costUsd }),
  stepLimit: ({ numTurns }) => ({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: numTurns }),
  failed: ({ detail }) => ({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [detail] }),
  aborted: () => ({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' }),
  receipt: ({ requestId, stillQueued, cancelled }) => ({ type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response: { still_queued: stillQueued, cancelled } } }),
};

// --- The bridge events (`protocols.md` §11.3), the `bridge` dialect (§2.5) ---
export const bridge = {
  ready: ({ session, mcp, capabilities, allowlist }) => ({ type: 'ready', session, agent: `fake-agent ${FAKE_VERSION}`,
    tools: FAKE_TOOLS, mcp: { laneboard: mcp }, canSteer: true,
    canCancelQueued: capabilities.includes('interrupt_cancel_queued_v1'),
    ...(Array.isArray(allowlist) ? { allowlist } : {}) }),
  taken: ({ id }) => ({ type: 'taken', id }),
  textDelta: ({ block, text }) => ({ type: 'text.delta', block, text }),
  textBlock: ({ block, text }) => ({ type: 'text.block', block, text }),
  toolStart: ({ block, id, name, input, denied }) => ({ type: 'tool.start', block, toolUseId: id, tool: name, input,
    ...(denied ? { denied: true } : {}) }),
  toolEnd: ({ id, isError }) => ({ type: 'tool.end', toolUseId: id, isError, denied: false }),
  retrying: ({ attempt, of }) => ({ type: 'retrying', attempt, of }),
  turnEnd: (fields) => ({ type: 'turn.end', ...fields }),
  interrupted: ({ id, stillQueued, cancelled }) => ({ type: 'interrupted', id, stillQueued, cancelled }),
};

// --- The real MCP call (§2.3) ---

const MCP_PREFIX = 'mcp__laneboard__';

/** `${NAME}` in an `mcp.json` header, filled from the environment as Claude Code does. */
function expandEnv(value, env) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => env[k] ?? '');
}

/** The JSON-RPC answer of a Streamable HTTP reply: a JSON body, or the `data:` of an SSE event. */
function rpcAnswer(text, contentType) {
  if (!/text\/event-stream/.test(contentType ?? '')) return JSON.parse(text);
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  for (const d of data) {
    try {
      const msg = JSON.parse(d);
      if ('result' in msg || 'error' in msg) return msg;
    } catch { /* not this event */ }
  }
  throw new Error('no JSON-RPC answer in the event stream');
}

/**
 * Calls `tool` (`mcp__laneboard__<name>`) on the room's MCP server: one `tools/call`
 * JSON-RPC request over HTTP to the `laneboard` URL of `configPath` (`c3-see.md` §1's
 * `mcp.json`), its headers' `${…}` filled from `env` (`LANEBOARD_MCP_TOKEN`).
 * Never throws: resolves `{isError, result, content, error?}` where `result` is the
 * tool's JSON result (`structuredContent`, else its text parsed) and `content` the
 * text the `tool_result` carries.
 */
export async function mcpCall({ configPath, env = process.env, tool, input, id = 1 }) {
  const fail = (error) => ({ isError: true, result: null, content: `(fake agent: ${error})`, error });
  let server;
  try {
    server = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers?.laneboard;
  } catch (e) {
    return fail(`cannot read the MCP config ${configPath}: ${e.message}`);
  }
  if (!server?.url) return fail(`no laneboard server in ${configPath}`);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  for (const [k, v] of Object.entries(server.headers ?? {})) headers[k] = expandEnv(v, env);
  const body = { jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: String(tool).slice(MCP_PREFIX.length), arguments: input ?? {} } };
  let rpc;
  try {
    const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(server.timeout) || 15000) });
    const text = await res.text();
    if (!res.ok) return fail(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    rpc = rpcAnswer(text, res.headers.get('content-type'));
  } catch (e) {
    return fail(e.message);
  }
  if (rpc.error) {
    return { isError: true, result: null, content: String(rpc.error.message ?? 'error'), error: rpc.error };
  }
  const r = rpc.result ?? {};
  const text = (Array.isArray(r.content) ? r.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('');
  let result = r.structuredContent;
  if (result === undefined) {
    try { result = JSON.parse(text); } catch { result = text; }
  }
  return { isError: r.isError === true, result, content: text };
}

// --- The program ---

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const dir = process.env.FAKE_AGENT_DIR;
  if (!dir || !path.isAbsolute(dir)) {
    process.stderr.write('fake-agent: FAKE_AGENT_DIR must be an absolute path\n');
    process.exit(2);
  }
  const files = {
    script: path.join(dir, 'script.json'),
    log: path.join(dir, 'received.jsonl'),
    starts: path.join(dir, 'starts'),
  };
  // `atMs` given: a decoded line shares the time of its `stdin` line (§2.6).
  const log = (line, atMs = Date.now()) => fs.appendFileSync(files.log, JSON.stringify({ atMs, ...line }) + '\n');
  const readScript = () => JSON.parse(fs.readFileSync(files.script, 'utf8'));

  if (argv[0] === 'auth' && argv[1] === 'status') return loginCheck(readScript, log);

  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dialect = opt('--dialect') ?? 'claude';
  if (dialect !== 'claude' && dialect !== 'bridge') {
    process.stderr.write(`fake-agent: unknown dialect ${dialect}\n`);
    process.exit(2);
  }
  // A bridge agent's session comes from its environment, not the arguments (§2.5).
  const resumed = dialect === 'bridge' ? process.env.LANEBOARD_SESSION_RESUME === '1' : opt('--resume') != null;
  const session = (dialect === 'bridge' ? process.env.LANEBOARD_SESSION : opt('--resume') ?? opt('--session-id')) ?? randomUUID();
  const maxTurns = Number(opt('--max-turns') ?? 40);
  // A bridge agent finds `mcp.json` in its working directory, `cockpit.agent.cwd` (B25).
  const mcpConfig = opt('--mcp-config') ?? (dialect === 'bridge' ? path.resolve('mcp.json') : null);

  let script;
  try { script = readScript(); } catch (e) {
    process.stderr.write(`fake-agent: cannot read ${files.script}: ${e.message}\n`);
    process.exit(2);
  }
  let n = 0;
  try { n = Number(fs.readFileSync(files.starts, 'utf8')) || 0; } catch { /* first start */ }
  n += 1;
  fs.writeFileSync(files.starts, String(n));
  log({ kind: 'start', n, argv, env: Object.keys(process.env).sort(), session, resumed });

  const start = script.start ?? {};
  if (n <= (Number(start.startFailures) || 0)) {
    if (start.startStderr) process.stderr.write(String(start.startStderr) + '\n');
    process.exit(1);
  }

  const write = dialect === 'bridge'
    ? (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
    : (obj) => process.stdout.write(JSON.stringify({ ...obj, session_id: session, uuid: obj.uuid ?? randomUUID() }) + '\n');
  const speak = dialect === 'bridge' ? bridgeSpeaker(write) : claudeSpeaker(write);
  const agent = createAgent({ dialect, speak, log, readScript, maxTurns, initialScript: script, mcpConfig });

  // Signals (§2.4): each is logged before it acts.
  process.on('SIGINT', () => { log({ kind: 'signal', name: 'SIGINT' }); agent.sigint(); });
  process.on('SIGTERM', () => { log({ kind: 'signal', name: 'SIGTERM' }); process.exit(143); });

  let ready = false;
  const early = [];
  setTimeout(() => {
    const capabilities = start.capabilities ?? [];
    let allowlist;
    if (dialect === 'bridge') {
      // §2.5: absent → the list read from LANEBOARD_ALLOWED_TOOLS; null → left out; an array as it is.
      if (start.allowlist === undefined) {
        try { allowlist = JSON.parse(process.env.LANEBOARD_ALLOWED_TOOLS ?? 'null'); } catch { allowlist = null; }
      } else allowlist = start.allowlist;
    }
    speak.ready({ session, mcp: start.mcp ?? 'connected', capabilities, allowlist });
    ready = true;
    for (const l of early.splice(0)) agent.line(l);
  }, Number(start.initAfterMs) || 0);

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!raw.trim()) continue;
      // A line read before `init` waits for it (Claude Code reads stdin after init;
      // research Q10 may change this). Its `at` counts from when it is handled.
      if (ready) agent.line(raw); else early.push(raw);
    }
  });
  process.stdin.on('end', () => {
    log({ kind: 'stdin-end' });
    // Claude Code exits on a closed stdin (`protocols.md` §11.6, 10.0 s row); so does a bridge agent (§2.5).
    process.exit(0);
  });
}

/** `auth status` (§2.4): answers by `start.login`, logs one `login-check` line. */
function loginCheck(readScript, log) {
  let login = 'ok';
  try { login = readScript().start?.login ?? 'ok'; } catch { /* no script: logged in */ }
  if (login === 'hang') {
    log({ kind: 'login-check', login, exit: null });
    setInterval(() => {}, 1 << 30);
    return;
  }
  const failed = login === 'failed';
  log({ kind: 'login-check', login, exit: failed ? 1 : 0 });
  process.stdout.write(failed ? 'Not logged in. Run claude to log in.\n' : 'Logged in.\n');
  process.exit(failed ? 1 : 0);
}

/** The prompt text of a `user` stdin line: a string, or its text parts joined. */
function promptText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p?.type === 'text').map((p) => p.text).join('');
  return '';
}

/**
 * Dialect `claude`: what the fake does, as Claude Code's native lines. `turn()`
 * keeps one turn's message and block state (Claude Code numbers blocks per message).
 */
function claudeSpeaker(out) {
  return {
    ready: ({ session, mcp, capabilities }) => out(native.init({ session, mcp, capabilities })),
    // --replay-user-messages: the echo, as soon as the line is read (§13.1, 2.97).
    replay: ({ uuid, content }) => out(native.replay({ uuid, content })),
    receipt: ({ requestId, stillQueued, cancelled }) => out(native.receipt({ requestId, stillQueued, cancelled })),
    turn() {
      const st = { msgId: null, index: 0, text: null, messages: 0 };
      const open = (uuids) => {
        st.msgId = `msg_${String(++msgCounter).padStart(2, '0')}`;
        st.index = 0;
        st.messages += 1;
        out(native.messageStart({ uuids, msgId: st.msgId }));
      };
      const closeText = () => {
        if (!st.text) return;
        out(native.textBlock({ msgId: st.msgId, text: st.text.full }));
        out(native.blockStop({ index: st.text.index }));
        st.text = null;
      };
      const closeMessage = (stopReason) => {
        if (!st.msgId) return;
        closeText();
        out(native.messageDelta({ stopReason }));
        out(native.messageStop());
        st.msgId = null;
      };
      const ensure = () => { if (!st.msgId) open(); };
      return {
        get messages() { return st.messages; },
        // Taken: the turn's first message names the prompt (§11.4 `message_start` row).
        start: (uuids) => open(uuids),
        // A steer: a new message whose `user_message_uuids` holds the prompt (§2.4).
        steer: (uuids) => { closeMessage('tool_use'); open(uuids); },
        text(s) {
          ensure();
          if (st.text && s.block === 'new') closeText();
          if (!st.text) {
            st.text = { index: st.index++, full: '' };
            out(native.textStart({ index: st.text.index }));
          }
          st.text.full += String(s.text);
          if (!s.skipDelta) out(native.textDelta({ index: st.text.index, text: String(s.text) }));
        },
        tool({ id, name, input, denied, parallel }) {
          closeText();
          ensure();
          const index = st.index++;
          out(native.toolStart({ index, id, name }));
          out(native.toolDelta({ index, input }));
          out(native.toolBlock({ msgId: st.msgId, id, name, input }));
          out(native.blockStop({ index }));
          if (denied) out(native.denied({ id, name }));
          // The message ends with its tool calls unless another call starts
          // while this one runs (parallel calls share one message, B5).
          if (!parallel) closeMessage('tool_use');
        },
        toolEnd({ id, isError, content }) {
          closeMessage('tool_use');
          out(native.toolResult({ id, isError, content }));
        },
        retry: (r) => out(native.retry(r)),
        ping: () => out(native.ping()),
        end(kind, { durationMs, costUsd, detail, maxTurns }) {
          closeMessage('end_turn');
          switch (kind) {
            case 'step-limit': return out(native.stepLimit({ numTurns: maxTurns }));
            case 'failed': return out(native.failed({ detail }));
            case 'not-logged-in':
              // pending research Q10: an `api_retry` with `authentication_failed`, then the result.
              out(native.retry({ attempt: 1, of: 10, error: 'authentication_failed' }));
              return out(native.failed({ detail: 'authentication_failed' }));
            default: return out(native.done({ numTurns: st.messages, durationMs, costUsd }));
          }
        },
        // An interrupted turn: the open message is left as it is, only the result comes (§2.4).
        stopped: () => out(native.aborted()),
      };
    },
  };
}

/**
 * Dialect `bridge`: the same, as the bridge events of `protocols.md` §11.3; `block`
 * numbers the turn's text blocks and calls from 0 across the whole turn.
 */
function bridgeSpeaker(out) {
  return {
    ready: (r) => out(bridge.ready(r)),
    replay: () => {},
    receipt: ({ requestId, stillQueued, cancelled }) => out(bridge.interrupted({ id: requestId, stillQueued, cancelled })),
    turn() {
      let next = 0;
      let text = null;
      let messages = 0;
      const closeText = () => {
        if (!text) return;
        out(bridge.textBlock({ block: text.block, text: text.full }));
        text = null;
      };
      return {
        get messages() { return messages; },
        start: (ids) => { messages += 1; for (const id of ids) out(bridge.taken({ id })); },
        steer: (ids) => { closeText(); messages += 1; for (const id of ids) out(bridge.taken({ id })); },
        text(s) {
          if (text && s.block === 'new') closeText();
          if (!text) text = { block: next++, full: '' };
          text.full += String(s.text);
          if (!s.skipDelta) out(bridge.textDelta({ block: text.block, text: String(s.text) }));
        },
        tool({ id, name, input, denied }) {
          closeText();
          // A refused call is one `tool.start` with `denied:true` and no `tool.end` (§2.5).
          out(bridge.toolStart({ block: next++, id, name, input, denied }));
        },
        toolEnd: ({ id, isError }) => out(bridge.toolEnd({ id, isError })),
        retry: ({ attempt, of }) => out(bridge.retrying({ attempt, of })),
        ping: () => {}, // the bridge has no ping event (§11.3)
        end(kind, { durationMs, costUsd, detail, maxTurns }) {
          closeText();
          switch (kind) {
            case 'step-limit': return out(bridge.turnEnd({ state: 'error', code: 'step-limit', steps: maxTurns }));
            case 'failed': return out(bridge.turnEnd({ state: 'error', code: 'failed', detail }));
            case 'not-logged-in': return out(bridge.turnEnd({ state: 'error', code: 'not-logged-in' }));
            default: return out(bridge.turnEnd({ state: 'done', costUsd, durationMs }));
          }
        },
        stopped: () => out(bridge.turnEnd({ state: 'stopped' })),
      };
    },
  };
}

/**
 * The native lines one turn of a script makes, without waiting and without the
 * real MCP call (its `tool_result` text is a placeholder): the `claude` dialect's
 * speaker walked over the turn's timeline as `play()` walks it. For the script
 * check (`stand-ins.md` §5, D98), which holds every line against its §11.4 row.
 */
export function renderTurn(turn, { uuid = randomUUID(), session = randomUUID(), maxTurns = 40 } = {}) {
  const lines = [];
  // As main()'s `write`: every line carries `session_id` and a `uuid` (B6).
  const w = claudeSpeaker((o) => lines.push({ ...o, session_id: session, uuid: o.uuid ?? randomUUID() })).turn();
  w.start([uuid]);
  const events = timeline(Array.isArray(turn?.steps) ? turn.steps : []);
  const ids = new Map();
  for (let k = 0; k < events.length;) {
    const ev = events[k++];
    const st = ev.step;
    switch (ev.kind) {
      case 'text': w.text(st); break;
      case 'tool':
      case 'denied': {
        const id = `toolu_${String(++toolCounter).padStart(2, '0')}`;
        if (ev.kind === 'tool') ids.set(st, id);
        w.tool({ id, name: String(ev.kind === 'tool' ? st.tool : st.denied), input: st.input ?? {},
          denied: ev.kind === 'denied', parallel: parallelCall(events, k) });
        break;
      }
      case 'tool-end': w.toolEnd({ id: ids.get(st), isError: st.isError === true, content: '(dry run)' }); break;
      case 'retry': {
        const rt = st.retry ?? {};
        w.retry({ attempt: rt.attempt ?? 1, of: rt.of ?? 10, error: rt.error ?? 'overloaded' });
        break;
      }
      case 'exit': return lines;
      case 'end':
        w.end(END_KINDS.includes(st.end) ? st.end : 'done',
          { durationMs: Number(st.at) || 0, costUsd: st.costUsd ?? 0, detail: String(st.detail ?? 'failed'), maxTurns });
        return lines;
      default: break;
    }
  }
  w.end('done', { durationMs: 0, costUsd: 0, detail: 'failed', maxTurns });
  return lines;
}

let msgCounter = 0;
let toolCounter = 0;
let rpcCounter = 0;

function createAgent({ dialect, speak, log, readScript, maxTurns, initialScript, mcpConfig }) {
  let script = initialScript;
  const played = new Set();
  // Prompts read and not taken yet, in order: { uuid, raw, words, content, priority, turnIndex,
  // steer (take at the running calls' end), ignored ('ignore' | 'ignore-once') }.
  const pending = [];
  let running = null;

  function line(raw) {
    const at = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch {
      log({ kind: 'stdin', line: raw.slice(0, 200) }, at);
      return;
    }
    const logged = structuredClone(msg);
    // The text is in the `prompt` line only (§2.6).
    if (dialect === 'bridge') delete logged?.text;
    else if (logged?.message && typeof logged.message === 'object') delete logged.message.content;
    log({ kind: 'stdin', line: logged }, at);
    if (dialect === 'bridge') {
      if (msg?.type === 'prompt') return prompt({ uuid: msg.id, priority: msg.priority, raw: String(msg.text ?? '') }, at);
      if (msg?.type === 'interrupt') return interrupt({ requestId: msg.id, cancelQueued: msg.cancelQueued === true }, at);
      return;
    }
    if (msg?.type === 'user') {
      const content = msg.message?.content;
      return prompt({ uuid: msg.uuid, priority: msg.priority, raw: promptText(content), content }, at);
    }
    if (msg?.type === 'control_request' && msg.request?.subtype === 'interrupt') {
      // `cancel_queued` read from `request` (research Q10, unconfirmed; §2.6).
      return interrupt({ requestId: msg.request_id, cancelQueued: msg.request.cancel_queued === true }, at);
    }
  }

  function prompt({ uuid = randomUUID(), priority = 'next', raw, content = raw }, at) {
    const words = ownerWords(raw);
    // A resend: the same text as a prompt no turn has taken and no receipt cancelled (§2.6).
    const earlier = pending.find((q) => q.raw === raw);
    try { script = readScript(); } catch (e) {
      process.stderr.write(`fake-agent: cannot read script.json: ${e.message}\n`);
    }
    // `turn` is the turn this prompt would match now; it is taken by index at take time.
    const i = matchTurn(script, words, played);
    const p = { uuid, raw, words, content, priority, turnIndex: i, steer: false, ignored: null };
    log({ kind: 'prompt', uuid, priority, words, raw, turn: i >= 0 ? `${script.name}#${i + 1}` : null,
      ...(earlier ? { resendOf: earlier.uuid } : {}) }, at);
    speak.replay({ uuid, content });

    if (earlier?.ignored === 'ignore') {
      // `ignore` never takes it nor any resend of it (§2.4).
      p.ignored = 'ignore';
      pending.push(p);
      return;
    }
    if (earlier?.ignored === 'ignore-once') {
      // `ignore-once` takes the room's resend as a new turn; the first stays untaken for good.
      pending.splice(pending.indexOf(earlier), 1);
      pending.push(p);
      if (!running) next();
      return;
    }
    if (!running) {
      pending.push(p);
      next();
      return;
    }
    if (priority === 'later') {
      pending.push(p); // after the running turn, whatever its `queued` says
    } else if (priority === 'now') {
      // As an interrupt without `cancel_queued` (no receipt: no request), then a new turn.
      pending.unshift(p);
      abort(running, interruptMode(running.turn));
    } else {
      const queued = running.turn.queued ?? 'next-tool-end';
      if (queued === 'ignore' || queued === 'ignore-once') p.ignored = queued;
      // next-tool-end: taken once the running calls end; with none running, after the turn.
      else if (queued === 'next-tool-end' && running.tools.size > 0) p.steer = true;
      pending.push(p);
    }
  }

  /** A turn's `onInterrupt` (§2.4): 'ignore', 'ignore-sigint' or { endAfterMs }. */
  function interruptMode(turn) {
    const m = turn?.onInterrupt ?? { endAfterMs: 300 };
    if (m === 'ignore' || m === 'ignore-sigint') return m;
    return { endAfterMs: Number(m.endAfterMs ?? 300) };
  }

  function interrupt({ requestId, cancelQueued }, at) {
    const mode = running ? interruptMode(running.turn) : { endAfterMs: 0 };
    if (typeof mode === 'string') {
      // `ignore`, `ignore-sigint`: no receipt, the turn plays on.
      log({ kind: 'interrupt', requestId, cancelQueued, stillQueued: null, cancelled: null }, at);
      return;
    }
    const ids = pending.map((q) => q.uuid);
    const receipt = cancelQueued ? { stillQueued: [], cancelled: ids } : { stillQueued: ids, cancelled: [] };
    if (cancelQueued) pending.length = 0;
    log({ kind: 'interrupt', requestId, cancelQueued, ...receipt }, at);
    speak.receipt({ requestId, ...receipt });
    if (running) abort(running, mode.endAfterMs);
  }

  function sigint() {
    // SIGINT (unless ignored) ends the turn as an interrupt with `endAfterMs` 0 (§2.4).
    if (!running || interruptMode(running.turn) === 'ignore-sigint') return;
    abort(running, 0);
  }

  /** Ends the running turn as an interrupt (`mode`: an `interruptMode()` or the ms before its result). */
  function abort(cur, mode) {
    if (typeof mode === 'string' || cur.abort) return;
    cur.abort = { endAfterMs: typeof mode === 'number' ? mode : mode.endAfterMs };
    cur.wake();
  }

  function next() {
    const k = pending.findIndex((q) => !q.ignored);
    if (k < 0) return;
    const [p] = pending.splice(k, 1);
    const { turn, name } = takeTurn(p);
    running = play(turn, name, p);
    running.done.finally(() => { running = null; next(); });
  }

  /** The turn a prompt plays: the one it matched if still free, else a fresh match, else the no-match answer. */
  function takeTurn(p) {
    let turn = null;
    let name = null;
    const free = (i) => i >= 0 && (!played.has(i) || script.turns?.[i]?.repeat);
    const i = free(p.turnIndex) ? p.turnIndex : matchTurn(script, p.words, played);
    if (i >= 0 && script.turns?.[i]) { turn = script.turns[i]; played.add(i); name = `${script.name}#${i + 1}`; }
    if (script.start?.login === 'failed') turn = { steps: [{ at: 0, end: 'not-logged-in' }] };
    if (!turn) turn = noMatchTurn(p.words);
    return { turn, name };
  }

  function play(turn, name, p) {
    const cur = { turn, tools: new Set(), abort: null, wake: () => {} };
    let abortNow;
    const aborted = new Promise((r) => { abortNow = r; });
    cur.wake = () => abortNow();
    cur.done = run();
    return cur;

    async function run() {
      const t0Turn = Date.now();
      const w = speak.turn();
      const ids = new Map(); // tool step → its toolu_ id
      const calls = new Map(); // tool step → its MCP call
      const sentAt = new Map(); // tool step → when its start went out
      w.start([p.uuid]);
      const ping = Number(turn.pingEveryMs) > 0 ? setInterval(() => w.ping(), Number(turn.pingEveryMs)) : null;
      let events = timeline(Array.isArray(turn.steps) ? turn.steps : []);
      let t0 = t0Turn;
      let k = 0;
      let ended = false;
      try {
        while (!ended && !cur.abort) {
          // A steer (`queued` next-tool-end): taken once no call runs; its turn's steps
          // play as the rest of this turn, `at` from the take (B26).
          const s = cur.tools.size === 0 ? pending.find((q) => q.steer && !q.ignored) : null;
          if (s) {
            pending.splice(pending.indexOf(s), 1);
            const taken = takeTurn(s);
            w.steer([s.uuid]);
            events = timeline(Array.isArray(taken.turn.steps) ? taken.turn.steps : []);
            t0 = Date.now();
            k = 0;
            continue;
          }
          if (k >= events.length) break;
          const ev = events[k];
          const wait = t0 + ev.t - Date.now();
          if (wait > 0) await Promise.race([sleep(wait), aborted]);
          if (cur.abort) break;
          k += 1;
          const st = ev.step;
          switch (ev.kind) {
            case 'text':
              w.text(st);
              break;
            case 'tool':
            case 'denied': {
              const id = `toolu_${String(++toolCounter).padStart(2, '0')}`;
              const toolName = ev.kind === 'tool' ? String(st.tool) : String(st.denied);
              const input = st.input ?? {};
              if (ev.kind === 'tool') {
                ids.set(st, id);
                sentAt.set(st, Date.now());
                cur.tools.add(st);
                if (toolName.startsWith(MCP_PREFIX)) calls.set(st, realCall(toolName, input, st));
              }
              w.tool({ id, name: toolName, input, denied: ev.kind === 'denied', parallel: parallelCall(events, k) });
              break;
            }
            case 'tool-end': {
              // A start that went out late still gets its whole scripted span, plus 10 ms for the
              // room's own receipt of the two lines (build B150): the room's endedAt − startedAt
              // is at least `endAt − at` (S-C1-25), and well under its 100 ms more.
              const span = (Number(st.endAt ?? st.at) || 0) - (Number(st.at) || 0);
              const late = sentAt.get(st) + span + SPAN_MARGIN_MS - Date.now();
              if (late > 0) await Promise.race([sleep(late), aborted]);
              if (cur.abort) break;
              // With a real call, `endAt` is the earliest end: the result waits for the call (§2.3).
              let r = { isError: st.isError === true, content: '(fake agent: no call)' };
              if (calls.has(st)) {
                r = await Promise.race([calls.get(st), aborted]);
                if (cur.abort) break;
              }
              cur.tools.delete(st);
              w.toolEnd({ id: ids.get(st), isError: r.isError, content: r.content });
              break;
            }
            case 'retry': {
              const rt = st.retry ?? {};
              w.retry({ attempt: rt.attempt ?? 1, of: rt.of ?? 10, error: rt.error ?? 'overloaded' });
              break;
            }
            case 'exit':
              process.exit(Number(st.exit) || 0);
              break;
            case 'end':
              ended = true;
              endTurn(w, st, Date.now() - t0Turn, name);
              break;
            default:
              break; // an unknown step: the script check (T5) refuses it
          }
        }
        if (cur.abort) {
          // Interrupted (§2.4): the remaining steps are dropped; `endAfterMs` later the result.
          if (cur.abort.endAfterMs > 0) await sleep(cur.abort.endAfterMs);
          log({ kind: 'turn-end', turn: name, end: 'stopped' });
          w.stopped();
        } else if (!ended) {
          // A script without `end`: the turn ends `done` after its last step.
          endTurn(w, { end: 'done' }, Date.now() - t0Turn, name);
        }
      } finally {
        if (ping) clearInterval(ping);
      }
    }
  }

  /** The real MCP call of a tool step, logged as `tool-result` when it returns (§2.3, §2.6). */
  async function realCall(tool, input, step) {
    if (step.call === false) {
      log({ kind: 'tool-result', tool, isError: step.isError === true, input, result: null });
      return { isError: step.isError === true, content: '(fake agent: no call)' };
    }
    const res = await mcpCall({ configPath: mcpConfig ?? '(no --mcp-config)', tool, input, id: ++rpcCounter });
    const isError = typeof step.isError === 'boolean' ? step.isError : res.isError;
    log({ kind: 'tool-result', tool, isError, input, result: res.result, ...(res.error ? { error: res.error } : {}) });
    return { isError, content: res.content };
  }

  function endTurn(w, s, durationMs, name) {
    const kind = END_KINDS.includes(s.end) ? s.end : 'done';
    // Logged before the result goes out (sync), so a test that has read the
    // result line always finds the turn's end in the log (B24).
    log({ kind: 'turn-end', turn: name, end: kind });
    w.end(kind, { durationMs, costUsd: s.costUsd ?? 0, detail: String(s.detail ?? 'failed'), maxTurns });
  }

  return { line, sigint };
}

/** B150: what a tool's end waits beyond its scripted span after its start went out. */
const SPAN_MARGIN_MS = 10;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
