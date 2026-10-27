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
// Built so far (C1 night T1): dialect `claude`; steps text, tool (no real MCP
// call yet), denied, retry, end, exit, ping; `start`; the login check. A prompt
// that arrives during a turn waits for the turn's end (as `after-turn`); an
// interrupt is logged with no receipt. T4 adds the real MCP calls, `queued`,
// `onInterrupt`, `priority`, signals and the `bridge` dialect.
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
};

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
  if (dialect !== 'claude') {
    // The bridge dialect (§2.5) is C1 night T4's.
    process.stderr.write(`fake-agent: dialect ${dialect} not built yet\n`);
    process.exit(2);
  }
  const resumeId = opt('--resume');
  const session = resumeId ?? opt('--session-id') ?? randomUUID();
  const maxTurns = Number(opt('--max-turns') ?? 40);

  let script;
  try { script = readScript(); } catch (e) {
    process.stderr.write(`fake-agent: cannot read ${files.script}: ${e.message}\n`);
    process.exit(2);
  }
  let n = 0;
  try { n = Number(fs.readFileSync(files.starts, 'utf8')) || 0; } catch { /* first start */ }
  n += 1;
  fs.writeFileSync(files.starts, String(n));
  log({ kind: 'start', n, argv, env: Object.keys(process.env).sort(), session, resumed: Boolean(resumeId) });

  const start = script.start ?? {};
  if (n <= (Number(start.startFailures) || 0)) {
    if (start.startStderr) process.stderr.write(String(start.startStderr) + '\n');
    process.exit(1);
  }

  const out = (obj) => process.stdout.write(JSON.stringify({ ...obj, session_id: session, uuid: obj.uuid ?? randomUUID() }) + '\n');
  const agent = createAgent({ out, log, readScript, maxTurns, initialScript: script });

  let ready = false;
  const early = [];
  setTimeout(() => {
    out(native.init({ session, mcp: start.mcp ?? 'connected', capabilities: start.capabilities ?? [] }));
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
    // Claude Code exits on a closed stdin (`protocols.md` §11.6, 10.0 s row).
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

function createAgent({ out, log, readScript, maxTurns, initialScript }) {
  let script = initialScript;
  const played = new Set();
  const pending = []; // prompts read, not taken yet: { uuid, raw, words, content, priority }
  let running = null;
  let msgCounter = 0;
  let toolCounter = 0;

  function line(raw) {
    const at = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch {
      log({ kind: 'stdin', line: raw.slice(0, 200) }, at);
      return;
    }
    const logged = structuredClone(msg);
    if (logged?.message && typeof logged.message === 'object') delete logged.message.content;
    log({ kind: 'stdin', line: logged }, at);
    if (msg?.type === 'user') return prompt(msg, at);
    if (msg?.type === 'control_request' && msg.request?.subtype === 'interrupt') {
      // The receipt and the stop are T4's (§2.4 `onInterrupt`): logged, no receipt yet.
      log({ kind: 'interrupt', requestId: msg.request_id, cancelQueued: msg.request.cancel_queued === true,
        stillQueued: null, cancelled: null }, at);
    }
  }

  function prompt(msg, at) {
    const content = msg.message?.content;
    const raw = promptText(content);
    const words = ownerWords(raw);
    const uuid = msg.uuid ?? randomUUID();
    const priority = msg.priority ?? 'next';
    const earlier = pending.find((p) => p.raw === raw);
    try { script = readScript(); } catch (e) {
      process.stderr.write(`fake-agent: cannot read script.json: ${e.message}\n`);
    }
    const p = { uuid, raw, words, content, priority };
    // `turn` is the turn this prompt would match now; it is taken by index at take time.
    const i = matchTurn(script, words, played);
    p.turnIndex = i;
    log({ kind: 'prompt', uuid, priority, words, raw, turn: i >= 0 ? `${script.name}#${i + 1}` : null,
      ...(earlier ? { resendOf: earlier.uuid } : {}) }, at);
    // --replay-user-messages: the echo, as soon as the line is read (§13.1, 2.97).
    out(native.replay({ uuid, content }));
    pending.push(p);
    if (!running) next();
  }

  function next() {
    const p = pending.shift();
    if (!p) return;
    let turn;
    let name = null;
    if (p.turnIndex >= 0 && (!played.has(p.turnIndex) || script.turns?.[p.turnIndex]?.repeat)) {
      turn = script.turns[p.turnIndex];
      played.add(p.turnIndex);
      name = `${script.name}#${p.turnIndex + 1}`;
    } else {
      const i = matchTurn(script, p.words, played);
      if (i >= 0) { turn = script.turns[i]; played.add(i); name = `${script.name}#${i + 1}`; }
    }
    if (script.start?.login === 'failed') turn = { steps: [{ at: 0, end: 'not-logged-in' }] };
    if (!turn) turn = noMatchTurn(p.words);
    running = play(turn, name, p).finally(() => { running = null; next(); });
  }

  async function play(turn, name, p) {
    const t0 = Date.now();
    const st = { msgId: null, index: 0, text: null, messages: 0 };
    const ids = new Map(); // tool step → its toolu_ id
    const openMessage = (uuids) => {
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
    const ensureMessage = () => { if (!st.msgId) openMessage(); };

    // Taken: the turn's first message names the prompt (§11.4 `message_start` row).
    openMessage([p.uuid]);
    const ping = Number(turn.pingEveryMs) > 0 ? setInterval(() => out(native.ping()), Number(turn.pingEveryMs)) : null;
    const events = timeline(Array.isArray(turn.steps) ? turn.steps : []);
    let ended = false;
    try {
      for (let k = 0; k < events.length && !ended; k++) {
        const ev = events[k];
        const wait = t0 + ev.t - Date.now();
        if (wait > 0) await sleep(wait);
        const s = ev.step;
        switch (ev.kind) {
          case 'text': {
            ensureMessage();
            if (st.text && s.block === 'new') closeText();
            if (!st.text) {
              st.text = { index: st.index++, full: '' };
              out(native.textStart({ index: st.text.index }));
            }
            st.text.full += String(s.text);
            if (!s.skipDelta) out(native.textDelta({ index: st.text.index, text: String(s.text) }));
            break;
          }
          case 'tool':
          case 'denied': {
            closeText();
            ensureMessage();
            const id = `toolu_${String(++toolCounter).padStart(2, '0')}`;
            const toolName = ev.kind === 'tool' ? String(s.tool) : String(s.denied);
            const input = s.input ?? {};
            const index = st.index++;
            out(native.toolStart({ index, id, name: toolName }));
            out(native.toolDelta({ index, input }));
            out(native.toolBlock({ msgId: st.msgId, id, name: toolName, input }));
            out(native.blockStop({ index }));
            if (ev.kind === 'denied') {
              out(native.denied({ id, name: toolName }));
            } else {
              ids.set(s, id);
            }
            // The message ends with its tool calls unless another call starts
            // while this one runs (parallel calls share one message).
            const nextEv = events.slice(k + 1).find((e) => e.kind !== 'tool-end' || e.step !== s);
            const parallel = ev.kind === 'tool' && nextEv?.kind === 'tool' && nextEv.t < Number(s.endAt ?? s.at);
            if (!parallel) closeMessage('tool_use');
            break;
          }
          case 'tool-end': {
            closeMessage('tool_use');
            // No real MCP call yet (T4): the result is a placeholder, `is_error` from the step.
            out(native.toolResult({ id: ids.get(s), isError: s.isError === true, content: '(fake agent: no call)' }));
            break;
          }
          case 'retry': {
            const r = s.retry ?? {};
            out(native.retry({ attempt: r.attempt ?? 1, of: r.of ?? 10, error: r.error ?? 'overloaded' }));
            break;
          }
          case 'exit':
            process.exit(Number(s.exit) || 0);
            break;
          case 'end':
            ended = true;
            closeMessage('end_turn');
            endTurn(s, st.messages, Date.now() - t0, name);
            break;
          default:
            break; // an unknown step: the script check (T5) refuses it
        }
      }
      if (!ended) {
        // A script without `end`: the turn ends `done` after its last step.
        closeMessage('end_turn');
        endTurn({ end: 'done' }, st.messages, Date.now() - t0, name);
      }
    } finally {
      if (ping) clearInterval(ping);
    }
  }

  function endTurn(s, messages, durationMs, name) {
    switch (s.end) {
      case 'step-limit':
        out(native.stepLimit({ numTurns: maxTurns }));
        break;
      case 'failed':
        out(native.failed({ detail: String(s.detail ?? 'failed') }));
        break;
      case 'not-logged-in':
        // pending research Q10: an `api_retry` with `authentication_failed`, then the result.
        out(native.retry({ attempt: 1, of: 10, error: 'authentication_failed' }));
        out(native.failed({ detail: 'authentication_failed' }));
        break;
      default:
        out(native.done({ numTurns: messages, durationMs, costUsd: s.costUsd ?? 0 }));
    }
    log({ kind: 'turn-end', turn: name, end: END_KINDS.includes(s.end) ? s.end : 'done' });
  }

  return { line };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
