// The bridge and the Claude Code adapter (spec protocols.md §11.1-§11.5, §11.9,
// §11.11, §13). The mapping test feeds §11.4's left column to the adapter in
// the table's order inside one scripted turn and asserts the middle column;
// the turn test runs the bridge against the fake agent replaying §13.1's turn
// (script c1-voice) and asserts the screen messages in their order, each one
// valid by server/cockpit/protocol.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { createClaudeCodeAdapter, launchArgs, promptLine, interruptLine } from '../server/cockpit/agents/claude-code.mjs';
import { standingInstructions } from '../server/cockpit/agents/instructions.mjs';
import {
  createBridge, agentPromptText, shapeInput, childEnv, spawnArgv, LIVENESS_DETAIL,
} from '../server/cockpit/bridge.mjs';
import { toolAllowed, entryCovered } from '../server/cockpit/allowlist.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { setClock, createTestClock } from '../server/cockpit/clock.mjs';
import { nativeRows } from './cockpit/stand-ins/native-rows.mjs';
import { fakeAgentLog } from './cockpit/stand-ins/fake-agent-log.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs');
const PROTOCOL = fs.readFileSync(path.join(ROOT, 'docs/cockpit/protocol.md'), 'utf8');
const script = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/cockpit/scripts', `${name}.json`), 'utf8'));
const CLAUDE_TOOLS = ['mcp__laneboard__*', 'Read', 'Grep', 'Glob'];

// ------------------------------------------------------------ the mapping test

const PROMPT_ID = '9d2f4c1e-7a3b-4e8d-b1c6-52a0e9f3d714';

// §11.4's middle column, row by row in the table's order (the type and the
// fields the cell names). `null`: the row yields nothing.
const MIDDLE = [
  { type: 'ready', session: '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91', agent: 'claude-code 2.1.290', canSteer: true, canCancelQueued: true, mcp: { laneboard: 'connected' }, tools: ['Read', 'mcp__laneboard__morning'], allowlist: CLAUDE_TOOLS },
  null, // the replay: logged
  { type: 'taken', id: PROMPT_ID },
  null, // content_block_start text: numbered
  { type: 'text.delta', block: 0, text: '■ One run is' },
  { type: 'text.block', block: 0, text: '■ One run is stuck: builder-a since 03:12.' },
  null, // content_block_start tool_use: numbered
  null, // input_json_delta
  { type: 'tool.start', block: 1, toolUseId: 'toolu_01A9', tool: 'mcp__laneboard__morning', input: { window: 'tonight' } },
  { type: 'tool.end', toolUseId: 'toolu_01A9', isError: false },
  { type: 'tool.end', toolUseId: 'toolu_01B2', isError: true, denied: true },
  { type: 'retrying', attempt: 2, of: 10 },
  'login', // api_retry authentication_failed: an interrupt now, E4 at the result (asserted below)
  { type: 'turn.end', state: 'done', costUsd: 0.0412, durationMs: 7900 },
  { type: 'turn.end', state: 'stopped' },
  { type: 'turn.end', state: 'error', code: 'step-limit', steps: 40 },
  { type: 'turn.end', state: 'error', code: 'failed', detail: 'API Error: 529 overloaded' },
  { type: 'interrupted', id: 'i-0003', stillQueued: [], cancelled: [PROMPT_ID] },
];

test('the mapping test: §11.4 row by row (§13)', () => {
  const rows = nativeRows();
  assert.equal(rows.length, MIDDLE.length, 'one expectation per §11.4 row');
  const logs = [];
  const writes = [];
  const a = createClaudeCodeAdapter({ allowedTools: CLAUDE_TOOLS, write: (o) => writes.push(o), log: (l) => logs.push(l) });
  // The scripted turn: the room has written the prompt.
  a.toAgent({ type: 'prompt', id: PROMPT_ID, text: 'how did the night go?', priority: 'next' });
  rows.forEach((row, i) => {
    const want = MIDDLE[i];
    if (want === 'login') return; // its own adapter, below
    const got = a.fromAgent(row);
    if (want === null) { assert.deepEqual(got, [], `row ${i + 1} ${JSON.stringify(row)} yields nothing`); return; }
    assert.equal(got.length, 1, `row ${i + 1} yields one event: ${JSON.stringify(got)}`);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[0][k], v, `row ${i + 1} ${want.type}.${k}`);
  });
  assert.deepEqual(writes, [], 'nothing written back outside the login row');
  assert.ok(logs.some((l) => l.includes(`prompt ${PROMPT_ID} received`)), 'the replay is logged');

  // The authentication_failed row: the adapter sends `interrupt` at once and,
  // at the `result`, the turn ends E4 `not-logged-in`.
  const login = rows[MIDDLE.indexOf('login')];
  const w2 = [];
  const b = createClaudeCodeAdapter({ allowedTools: CLAUDE_TOOLS, write: (o) => w2.push(o) });
  b.toAgent({ type: 'prompt', id: PROMPT_ID, text: 'x', priority: 'next' });
  assert.deepEqual(b.fromAgent(login), []);
  assert.equal(w2.length, 1);
  assert.equal(w2[0].type, 'control_request');
  assert.equal(w2[0].request.subtype, 'interrupt');
  const end = b.fromAgent(rows[MIDDLE.findIndex((m) => m?.state === 'done')]);
  assert.deepEqual(end.map((e) => [e.type, e.state, e.code]), [['turn.end', 'error', 'not-logged-in']]);
  // The receipt of the adapter's own interrupt is not the room's.
  assert.deepEqual(b.fromAgent({ type: 'control_response', response: { subtype: 'success', request_id: w2[0].request_id, response: {} } }), []);
});

test('the mapping test: lines §11.4 maps to nothing, and odd ones', () => {
  const logs = [];
  const a = createClaudeCodeAdapter({ allowedTools: CLAUDE_TOOLS, log: (l) => logs.push(l) });
  for (const t of ['ping', 'message_delta', 'message_stop', 'content_block_stop']) {
    assert.deepEqual(a.fromAgent({ type: 'stream_event', event: { type: t } }), [], t);
  }
  // Thinking blocks and their deltas, hook lines, a helper agent's lines.
  assert.deepEqual(a.fromAgent({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } }), []);
  assert.deepEqual(a.fromAgent({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } }), []);
  assert.deepEqual(a.fromAgent({ type: 'system', subtype: 'hook_started' }), []);
  assert.deepEqual(a.fromAgent({ type: 'assistant', parent_tool_use_id: 'toolu_9', message: { content: [{ type: 'text', text: 'helper' }] } }), []);
  // A native line not in the table yields nothing and a log line (§13).
  assert.deepEqual(a.fromAgent({ type: 'rate_limit_event', info: {} }), []);
  assert.ok(logs.some((l) => l.includes('unknown line') && l.includes('rate_limit_event')));
  // Other result subtypes are E8 with the subtype (§11.4).
  assert.deepEqual(a.fromAgent({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }),
    [{ type: 'turn.end', state: 'error', code: 'failed', detail: 'error_max_budget_usd' }]);
  // `detail` cut to 120.
  const long = a.fromAgent({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'.repeat(300)] });
  assert.equal(long[0].detail.length, 120);
  // `mcp_server_errors[]` naming laneboard counts as failed; `pending` is passed on (B58).
  const init = (extra) => a.fromAgent({ type: 'system', subtype: 'init', session_id: 's', tools: [], mcp_servers: [{ name: 'laneboard', status: 'connected' }], ...extra })[0];
  assert.equal(init({ mcp_server_errors: [{ name: 'laneboard', error: 'x' }] }).mcp.laneboard, 'failed');
  assert.equal(init({ mcp_servers: [{ name: 'laneboard', status: 'pending' }] }).mcp.laneboard, 'pending');
  assert.equal(init({ mcp_servers: [] }).mcp.laneboard, 'failed');
  assert.equal(init({}).canCancelQueued, false);
});

test('blocks are numbered across the turn\'s messages; the counter starts again per turn (§11.3, D102)', () => {
  const a = createClaudeCodeAdapter({ allowedTools: CLAUDE_TOOLS });
  const id = '5a1e0c77-2b9d-4f3a-8e61-0c4d7b2a9e10';
  a.toAgent({ type: 'prompt', id, text: 'x', priority: 'next' });
  const se = (event, extra = {}) => ({ type: 'stream_event', event, ...extra });
  const evs = [
    se({ type: 'message_start' }, { user_message_uuids: [id] }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/x' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'secret output' }] } },
    se({ type: 'message_start' }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi.' }] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 2 },
  ].flatMap((o) => a.fromAgent(o));
  assert.deepEqual(evs.map((e) => [e.type, e.block ?? null]), [
    ['taken', null], ['tool.start', 0], ['tool.end', null], ['text.delta', 1], ['text.block', 1], ['turn.end', null]]);
  assert.ok(!JSON.stringify(evs).includes('secret output'), 'the result content is dropped');
  // A second message_start without uuids took nothing (B60); the next turn starts at block 0.
  const id2 = '6b2f1d88-3c0e-4a4b-9f72-1d5e8c3b0f21';
  a.toAgent({ type: 'prompt', id: id2, text: 'y', priority: 'next' });
  const next = [
    se({ type: 'message_start' }, { user_message_uuids: [id2] }),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'whole' }] } },
  ].flatMap((o) => a.fromAgent(o));
  assert.deepEqual(next.map((e) => [e.type, e.block ?? null]), [['taken', null], ['text.block', 0]]);

  // An agent that never names its prompts: the oldest echoed one is taken at the next message_start.
  const old = createClaudeCodeAdapter({ allowedTools: CLAUDE_TOOLS });
  old.toAgent({ type: 'prompt', id, text: 'x', priority: 'next' });
  assert.deepEqual(old.fromAgent(se({ type: 'message_start' })), [], 'no echo yet: nothing taken');
  old.fromAgent({ type: 'user', isReplay: true, uuid: id, message: { role: 'user', content: 'x' } });
  assert.deepEqual(old.fromAgent(se({ type: 'message_start' })), [{ type: 'taken', id }]);
});

// --------------------------------------------------- §11.2, §11.5: what goes in

test('§11.2: the launch arguments, one per entry', () => {
  assert.deepEqual(launchArgs({ mcpConfig: '/s/cockpit-agent/mcp.json', allowedTools: CLAUDE_TOOLS, instructions: 'I', session: 'abc' }), [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--replay-user-messages',
    '--mcp-config', '/s/cockpit-agent/mcp.json', '--strict-mcp-config',
    '--allowedTools', 'mcp__laneboard__*,Read,Grep,Glob',
    '--permission-prompts', 'none', '--max-turns', '40', '--append-system-prompt', 'I', '--session-id', 'abc']);
  const resumed = launchArgs({ mcpConfig: 'm', allowedTools: ['Read'], instructions: 'I', session: 'abc', resume: true });
  assert.deepEqual(resumed.slice(-2), ['--resume', 'abc']);
  assert.ok(!resumed.includes('--bare'), 'no --bare (§11.2)');
  assert.throws(() => launchArgs({ mcpConfig: 'm', allowedTools: [], instructions: 'I', session: 'a' }));
});

test('§11.5: the prompt\'s text and its stdin line, as the protocol\'s examples', () => {
  const p = (text) => JSON.parse(text);
  const at = PROTOCOL.indexOf('### 11.5 ');
  const sec = PROTOCOL.slice(at, PROTOCOL.indexOf('### 11.6 ', at));
  const blocks = [...sec.matchAll(/```json (bridge|claude)\n([\s\S]*?)```/g)].map((m) => ({ cls: m[1], value: p(m[2]) }));
  assert.equal(blocks.length, 2);
  const [bridgeEv, claudeLine] = blocks.map((b) => b.value);
  const text = agentPromptText({ text: 'was ist mit dem los?', source: 'spoken', lang: 'de', about: 'room-b', screen: 'desk' });
  assert.equal(text, bridgeEv.text);
  assert.deepEqual(promptLine(bridgeEv), claudeLine);
  assert.equal(agentPromptText({ text: 'hi', source: 'spoken', lang: 'en' }), '(Spoken in English; speech-to-text may have misheard a word.)\nhi');
  assert.equal(agentPromptText({ text: 'hi', source: 'spoken', lang: 'auto' }), '(Spoken; speech-to-text may have misheard a word.)\nhi');
  assert.equal(agentPromptText({ text: 'hi', source: 'spoken', lang: null }), '(Spoken; speech-to-text may have misheard a word.)\nhi');
  assert.equal(agentPromptText({ text: 'hi', source: 'typed', lang: null, about: null }), 'hi');
  // D66: id and screen as JSON strings, the id cut to 128.
  const odd = agentPromptText({ text: 'x', source: 'typed', about: `a"b\\${'z'.repeat(200)}`, screen: 'de"sk' });
  assert.ok(odd.startsWith(`(The owner is asking about node ${JSON.stringify(`a"b\\${'z'.repeat(124)}`)} on screen "de\\"sk". Call focus to see it.)\n`), odd);
  assert.deepEqual(interruptLine({ id: 'i-0003', cancelQueued: true }), { type: 'control_request', request_id: 'i-0003', request: { subtype: 'interrupt', cancel_queued: true } });
});

test('D97: tool input strings cut to 200, the whole at most 2 000 characters of JSON', () => {
  assert.deepEqual(shapeInput({ a: 'x'.repeat(300), n: 3, list: ['y'.repeat(250)] }), { a: 'x'.repeat(200), n: 3, list: ['y'.repeat(200)] });
  assert.deepEqual(shapeInput(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v'.repeat(150)]))), { '…': 'cut' });
  assert.deepEqual(shapeInput(null), {});
});

test('§11.11: tool names and prefixes (D240)', () => {
  assert.ok(toolAllowed('mcp__laneboard__morning', ['mcp__laneboard__*']));
  assert.ok(toolAllowed('Read', ['mcp__laneboard__*', 'Read']));
  assert.ok(!toolAllowed('Bash', ['mcp__laneboard__*', 'Read']));
  assert.ok(!toolAllowed('mcp__other__x', ['mcp__laneboard__*']));
  assert.ok(!toolAllowed('ReadX', ['Read']));
  assert.ok(entryCovered('mcp__laneboard__*', ['mcp__laneboard__*']));
  assert.ok(entryCovered('mcp__laneboard__morning', ['mcp__laneboard__*']));
  assert.ok(entryCovered('mcp__laneboard__m*', ['mcp__laneboard__*']));
  assert.ok(!entryCovered('mcp__*', ['mcp__laneboard__*']));
  assert.ok(!entryCovered('*', ['mcp__laneboard__*']));
  assert.ok(!entryCovered('Read*', ['Read']));
  assert.ok(!entryCovered('', ['*']));
});

test('D108: the child gets PATH, HOME, LANG, USER, the token and the named variables only', () => {
  const env = { PATH: '/bin', HOME: '/h', LANG: 'C', USER: 'u', AWS_SECRET: 'no', ANTHROPIC_MODEL: 'm', LANEBOARD_X: 'no' };
  assert.deepEqual(childEnv({ env, names: ['ANTHROPIC_MODEL'], mcpToken: 't' }),
    { PATH: '/bin', HOME: '/h', LANG: 'C', USER: 'u', ANTHROPIC_MODEL: 'm', LANEBOARD_MCP_TOKEN: 't' });
  assert.deepEqual(childEnv({ env: {}, names: ['ANTHROPIC_MODEL'] }), {});
});

test('§11.1: with cockpit.agent.user the agent starts behind sudo -n, no shell (D214)', async (t) => {
  const calls = [];
  const fakeSpawn = (cmd, args, o) => {
    calls.push({ cmd, args, o });
    const c = new EventEmitter();
    Object.assign(c, { pid: 4242, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill: () => true });
    return c;
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sudo-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const agent = { kind: 'claude-code', command: ['/usr/local/bin/claude'], cwd: '{stateDir}/cockpit-agent', user: 'lb-agent',
    allowedTools: CLAUDE_TOOLS, env: ['ANTHROPIC_MODEL', 'NOT_SET_HERE'] };
  const b = createBridge({ agent, stateDir, env: { PATH: '/bin', ANTHROPIC_MODEL: 'm', OTHER: 'x' }, mcpToken: 'tok', spawn: fakeSpawn, instructions: 'I' });
  b.start({ session: 'abc' });
  const { cmd, args, o } = calls[0];
  assert.equal(cmd, 'sudo');
  assert.deepEqual(args.slice(0, 7), ['-n', '-u', 'lb-agent', '-H', '--preserve-env=LANEBOARD_MCP_TOKEN,ANTHROPIC_MODEL', '--', '/usr/local/bin/claude']);
  assert.deepEqual(args.slice(7), launchArgs({ mcpConfig: path.join(stateDir, 'cockpit-agent/mcp.json'), allowedTools: CLAUDE_TOOLS, instructions: 'I', session: 'abc' }));
  assert.equal(o.shell, undefined);
  assert.equal(o.detached, false, 'the room signals the sudo process, not a group');
  assert.equal(o.cwd, path.join(stateDir, 'cockpit-agent'));
  assert.deepEqual(o.env, { PATH: '/bin', ANTHROPIC_MODEL: 'm', LANEBOARD_MCP_TOKEN: 'tok' });
  // A bridge agent: its argv is the owner's command; the LANEBOARD_* names go through sudo too (D242).
  const argv = spawnArgv({ agent: { kind: 'bridge', command: ['/opt/acme/agent', '--bridge'], user: 'lb-agent' }, stateDir, instructions: 'I', session: 's', envNames: ['LANEBOARD_MCP_TOKEN', 'LANEBOARD_SESSION'] });
  assert.deepEqual(argv, ['sudo', '-n', '-u', 'lb-agent', '-H', '--preserve-env=LANEBOARD_MCP_TOKEN,LANEBOARD_SESSION', '--', '/opt/acme/agent', '--bridge']);
  assert.deepEqual(spawnArgv({ agent: { kind: 'bridge', command: ['/opt/acme/agent'], user: null }, stateDir, envNames: [] }), ['/opt/acme/agent']);
});

// ------------------------------------------------- the bridge with a real child

/** A loopback JSON-RPC stub for the room's MCP server (c3-see.md §1); T35 builds the real one. */
async function mcpStub(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      requests.push({ headers: req.headers, msg });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests };
}

/**
 * A bridge on the fake agent: `kind` claude-code (`node fake-agent.mjs`, the
 * adapter runs) or bridge (`--dialect bridge`); the script written to its dir.
 */
async function setup(t, { kind = 'claude-code', script: sc, agent: over = {}, mcp = false, command } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const fakeDir = path.join(dir, 'fake');
  fs.mkdirSync(path.join(stateDir, 'cockpit-agent'), { recursive: true });
  fs.mkdirSync(fakeDir);
  if (sc) fs.writeFileSync(path.join(fakeDir, 'script.json'), JSON.stringify(sc));
  let stub = null;
  if (mcp) {
    stub = await mcpStub(t);
    fs.writeFileSync(path.join(stateDir, 'cockpit-agent/mcp.json'), JSON.stringify({ mcpServers: { laneboard: { type: 'http', url: stub.url,
      headers: { Authorization: 'Bearer ${LANEBOARD_MCP_TOKEN}' } } } }));
  }
  const agent = {
    kind,
    command: command ?? (kind === 'claude-code' ? [process.execPath, FAKE] : [process.execPath, FAKE, '--dialect', 'bridge']),
    cwd: '{stateDir}/cockpit-agent', user: null, allowSameUser: true,
    allowedTools: kind === 'claude-code' ? CLAUDE_TOOLS : ['mcp__laneboard__*'],
    allowUnrestricted: false, env: ['FAKE_AGENT_DIR'], ...over,
  };
  const messages = [];
  const logs = [];
  const exits = [];
  const readies = [];
  let wake = () => {};
  const poke = () => wake();
  const bridge = createBridge({
    agent, stateDir, mcpToken: 'test-token',
    env: { ...process.env, FAKE_AGENT_DIR: fakeDir, SECRET_DECOY: 'must-not-reach' },
    emit: (m) => { messages.push({ ...m, seq: messages.length + 1 }); poke(); },
    log: (l) => { logs.push(l); poke(); },
    onReady: (ev) => { readies.push(ev); poke(); },
    onExit: (e) => { exits.push(e); poke(); },
  });
  t.after(() => bridge.close());
  async function until(pred, what, ms = 10_000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; messages:\n${messages.map((m) => JSON.stringify(m)).join('\n')}\nlog:\n${logs.join('\n')}`);
      await new Promise((r) => { wake = r; setTimeout(r, 25); });
    }
  }
  return { bridge, messages, logs, exits, readies, until, stateDir, fakeDir, stub, log: fakeAgentLog(fakeDir) };
}

const label = (m) => (m.type === 'turn.state' ? `turn.state ${m.state}` : m.type);

/**
 * §13.1's screen side, in order (protocols.md §10 from 2.97 s on). Six deltas
 * from the agent leave as five: the redaction hold-back (security.md §5, T10)
 * keeps `03:12` until `.` and sends `03:12.` at the block's end.
 */
const TURN_131 = ['turn.prompt', 'turn.state thinking', 'turn.state working', 'tool.start', 'tool.end',
  'turn.state thinking', 'turn.state answering', 'text.delta', 'text.delta', 'text.delta', 'text.delta',
  'text.delta', 'text.block', 'turn.end'];

function assertTurn131(messages) {
  assert.deepEqual(messages.map(label), TURN_131);
  for (const m of messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
  const [tp] = messages;
  assert.equal(tp.turnId, 't-0001');
  assert.equal(tp.delivery, 'new');
  assert.equal(tp.text, 'wie lief die Nacht?');
  assert.equal(tp.source, 'spoken');
  assert.equal(tp.lang, 'de');
  assert.equal(tp.clientId, 'p-3c1e0b2a');
  assert.ok(messages.every((m) => m.turnId === 't-0001'));
  const ts = messages.find((m) => m.type === 'tool.start');
  assert.deepEqual([ts.blockIndex, ts.toolUseId, ts.tool, ts.input], [0, 'tu-01', 'mcp__laneboard__morning', { window: 'tonight' }]);
  const te = messages.find((m) => m.type === 'tool.end');
  assert.deepEqual([te.toolUseId, te.isError, te.denied], ['tu-01', false, false]);
  const deltas = messages.filter((m) => m.type === 'text.delta');
  assert.ok(deltas.every((d) => d.blockIndex === 1));
  assert.equal(deltas.map((d) => d.text).join(''), '■ One run is stuck: builder-a since 03:12.');
  const tb = messages.find((m) => m.type === 'text.block');
  assert.deepEqual([tb.blockIndex, tb.text], [1, '■ One run is stuck: builder-a since 03:12.']);
  assert.equal(messages.at(-1).state, 'done');
}

const SPOKEN = { clientId: 'p-3c1e0b2a', screen: 'desk', text: 'wie lief die Nacht?', source: 'spoken', lang: 'de', about: null };

test('the turn test: §13.1 through the adapter against the fake agent', async (t) => {
  const s = await setup(t, { script: script('c1-voice'), mcp: true });
  assert.deepEqual(await s.bridge.prompt(SPOKEN), { ok: false, code: 'agent-down' }, 'no session yet: never held (§11.7)');
  s.bridge.start({ session: '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91' });
  await s.until(() => s.bridge.state === 'up', 'ready');
  assert.deepEqual(s.messages, [], 'ready sends nothing to the screens');
  assert.equal(s.readies[0].session, '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91');
  assert.deepEqual(s.readies[0].allowlist, CLAUDE_TOOLS);
  assert.equal(s.readies[0].mcp.laneboard, 'connected');
  assert.deepEqual(await s.bridge.prompt(SPOKEN), { ok: true, turnId: 't-0001', delivery: 'new' });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  assertTurn131(s.messages);

  // What the agent got: §11.5's text, §11.2's arguments, D108's environment.
  const [p] = s.log.prompts();
  assert.equal(p.raw, '(Spoken in German; speech-to-text may have misheard a word.)\nwie lief die Nacht?');
  assert.equal(p.priority, 'next');
  const [st] = s.log.starts();
  assert.deepEqual(st.argv, launchArgs({ mcpConfig: path.join(s.stateDir, 'cockpit-agent/mcp.json'), allowedTools: CLAUDE_TOOLS,
    instructions: standingInstructions(), session: '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91' }));
  const allowed = new Set(['PATH', 'HOME', 'LANG', 'USER', 'LANEBOARD_MCP_TOKEN', 'FAKE_AGENT_DIR']);
  assert.ok(st.env.every((k) => allowed.has(k)), `child env: ${st.env.join(', ')}`);
  assert.ok(st.env.includes('LANEBOARD_MCP_TOKEN') && !st.env.includes('SECRET_DECOY'));
  assert.equal(s.stub.requests[0].headers.authorization, 'Bearer test-token');
  // One log line per turn with its cost (§11.4).
  assert.ok(s.logs.some((l) => /^cockpit turn t-0001: done .*costUsd 0\.0412/.test(l)), s.logs.join('\n'));
});

test('the bridge dialect: the same turn from a bridge agent, its LANEBOARD_* names (§11.11, D242)', async (t) => {
  const s = await setup(t, { kind: 'bridge', script: script('c1-voice'), mcp: true });
  s.bridge.start({ session: '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91' });
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt(SPOKEN);
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  assertTurn131(s.messages);
  const [st] = s.log.starts();
  assert.deepEqual(st.argv, ['--dialect', 'bridge'], 'the owner\'s command is the whole argv');
  assert.equal(st.session, '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91');
  for (const k of ['LANEBOARD_SESSION', 'LANEBOARD_ALLOWED_TOOLS', 'LANEBOARD_COCKPIT_INSTRUCTIONS']) assert.ok(st.env.includes(k), k);
  assert.ok(!st.env.includes('LANEBOARD_SESSION_RESUME'));
  const file = path.join(s.stateDir, 'cockpit-agent/instructions.txt');
  assert.equal(fs.readFileSync(file, 'utf8'), `${standingInstructions()}\n`);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
});

const bridgeScript = (start, turns = []) => ({ name: 'bridge-check', start: { initAfterMs: 50, mcp: 'connected', capabilities: ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'], ...start }, turns });

for (const [title, allowlist, detail] of [
  ['no allowlist', null, 'the agent declares no tool allowlist (see cockpit.agent.allowUnrestricted)'],
  ['a wider allowlist', ['mcp__laneboard__*', 'Bash'], 'the agent allows Bash, outside cockpit.agent.allowedTools'],
]) {
  test(`§11.11 fence 3 at ready: ${title} is a refused start, not restarted (D240)`, async (t) => {
    const s = await setup(t, { kind: 'bridge', script: bridgeScript({ allowlist }) });
    s.bridge.start();
    await s.until(() => s.exits.length === 1, 'the refused child to exit');
    assert.equal(s.bridge.state, 'refused');
    assert.deepEqual(s.messages.map((m) => [m.type, m.status.code, m.status.detail, m.status.blocksSend]), [['status', 'agent-down', detail, true]]);
    assert.ok(s.logs.includes(`agent refused: ${detail}`));
    assert.deepEqual(s.readies, []);
    // stdin closed: the fake exits on it (§11.6's 10.0 s row), well before the 5 s SIGTERM.
    assert.deepEqual(s.log.order('stdin-end'), ['stdin-end']);
    assert.equal(s.bridge.start(), false, 'no restart until the room starts again');
    assert.equal(s.log.starts().length, 1);
    assert.deepEqual(await s.bridge.prompt(SPOKEN), { ok: false, code: 'agent-down' });
  });
}

test('§11.11 fence 3 in a turn: a call outside the list is the tripwire (D240)', async (t) => {
  const s = await setup(t, { kind: 'bridge', script: bridgeScript({}, [{ steps: [
    { at: 50, tool: 'Bash', input: { command: 'rm -rf /' }, endAt: 400 }, { at: 500, end: 'done' }] }]) });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-00000001', screen: 'desk', text: 'clean up', source: 'typed', lang: null, about: null });
  await s.until(() => s.exits.length === 1, 'the child to stop');
  const detail = 'the agent called Bash, outside its allowlist';
  assert.deepEqual(s.messages.map(label), ['turn.prompt', 'turn.state thinking', 'turn.end', 'status'], 'nothing drawn for the call');
  const end = s.messages[2];
  assert.deepEqual([end.state, end.code, end.detail], ['error', 'failed', detail]);
  assert.equal(end.forced, undefined);
  assert.deepEqual(checkMessage(end, 'out'), { ok: true });
  assert.deepEqual([s.messages[3].status.code, s.messages[3].status.detail, s.messages[3].status.blocksSend], ['agent-down', detail, true]);
  const [intr] = s.log.interrupts();
  assert.equal(intr.cancelQueued, true);
  assert.equal(s.bridge.state, 'refused');
  assert.equal(s.bridge.start(), false);
});

test('a bridge agent\'s own refusal is one denied tool.start: the screens get the tried pair (D242, B62)', async (t) => {
  const s = await setup(t, { kind: 'bridge', script: bridgeScript({}, [{ steps: [
    { at: 50, denied: 'Bash', input: { command: 'ls' } }, { at: 100, text: 'I cannot run commands.' }, { at: 200, end: 'done' }] }]) });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-00000002', screen: 'desk', text: 'ls', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  assert.deepEqual(s.messages.map(label), ['turn.prompt', 'turn.state thinking', 'tool.start', 'tool.end',
    'turn.state answering', 'text.delta', 'text.delta', 'text.block', 'turn.end'], 'the held last word is a delta of its own (T10)');
  const end = s.messages[3];
  assert.deepEqual([end.isError, end.denied, end.toolUseId], [true, true, 'tu-01']);
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
  assert.equal(s.bridge.state, 'up', 'a refusal is not the tripwire');
});

test('a prompt during a turn is queued into it, and taken at the running calls\' end (§3.4)', async (t) => {
  const s = await setup(t, { script: { name: 'steer', start: { initAfterMs: 50, capabilities: ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'] }, turns: [
    { match: 'first', queued: 'next-tool-end', steps: [{ at: 50, tool: 'Read', input: { file_path: '/x' }, endAt: 600 }, { at: 700, text: 'one' }, { at: 800, end: 'done' }] },
    { match: 'second', steps: [{ at: 50, text: 'two' }, { at: 150, end: 'done' }] }] } });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-0000000a', screen: 'desk', text: 'first', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'tool.start'), 'tool.start');
  assert.deepEqual(await s.bridge.prompt({ clientId: 'p-0000000b', screen: 'desk', text: 'second', source: 'typed', lang: null, about: null }),
    { ok: true, turnId: 't-0001', delivery: 'queued' });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  const taken = s.messages.find((m) => m.type === 'prompt.taken');
  assert.deepEqual([taken.turnId, taken.clientId, taken.state, taken.atBlock], ['t-0001', 'p-0000000b', 'taken', 1]);
  assert.ok(s.messages.indexOf(taken) > s.messages.findIndex((m) => m.type === 'tool.end'));
  assert.equal(s.messages.filter((m) => m.type === 'turn.end').length, 1, 'one turn');
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
});

test('the child exits during a turn: E2 agent-exited (§11.4); the restart is §11.7\'s', async (t) => {
  const s = await setup(t, { script: bridgeScript({}, [{ steps: [{ at: 50, text: 'half' }, { at: 150, exit: 3 }] }]) });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-00000003', screen: 'desk', text: 'go', source: 'typed', lang: null, about: null });
  await s.until(() => s.exits.length === 1, 'exit');
  const end = s.messages.at(-1);
  assert.deepEqual([end.type, end.state, end.code], ['turn.end', 'error', 'agent-exited']);
  assert.deepEqual(checkMessage(end, 'out'), { ok: true });
  assert.deepEqual([s.exits[0].code, s.exits[0].beforeReady], [3, false]);
  assert.equal(s.bridge.state, 'down');
  assert.deepEqual(await s.bridge.prompt(SPOKEN), { ok: false, code: 'agent-down' });
});

test('§11.9: 300 s without a line ends the turn E8 and resumes the session; a ping counts (D105)', async (t) => {
  const clock = createTestClock();
  clock.setMode('manual');
  setClock(clock);
  t.after(() => setClock(null));
  const s = await setup(t, { script: bridgeScript({}, [
    // 'thinking ' ends in white space, so the redaction hold-back (T10) sends it at once.
    { match: 'ping', pingEveryMs: 200, steps: [{ at: 20, text: 'thinking ' }, { at: 600_000, end: 'done' }] },
    { match: 'quiet', steps: [{ at: 20, text: 'thinking ' }, { at: 600_000, end: 'done' }] }]) });
  s.bridge.start({ session: '7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e' });
  await s.until(() => s.bridge.state === 'up', 'ready');

  await s.bridge.prompt({ clientId: 'p-00000004', screen: 'desk', text: 'ping', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'text.delta'), 'the first delta');
  await clock.advance(200_000);
  await new Promise((r) => setTimeout(r, 500)); // pings come in real time and re-arm the 300 s
  await clock.advance(200_000);
  assert.ok(!s.messages.some((m) => m.type === 'turn.end'), '400 s of room time with pings: still running');
  await s.bridge.interrupt({ cancelQueued: true });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'the interrupted turn');
  s.messages.length = 0;

  await s.bridge.prompt({ clientId: 'p-00000005', screen: 'desk', text: 'quiet', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'text.delta'), 'the first delta');
  await clock.advance(299_000);
  assert.ok(!s.messages.some((m) => m.type === 'turn.end'), '299 s: still running');
  await clock.advance(1_000);
  const end = s.messages.find((m) => m.type === 'turn.end');
  assert.deepEqual([end.state, end.code, end.detail], ['error', 'failed', LIVENESS_DETAIL]);
  await s.until(() => s.readies.length === 2, 'the resumed session');
  assert.deepEqual(s.log.signals().map((x) => x.name), ['SIGTERM']);
  const starts = s.log.starts();
  assert.equal(starts.length, 2);
  assert.equal(starts[1].resumed, true);
  assert.equal(starts[1].session, '7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e');
  assert.equal(s.messages.filter((m) => m.type === 'turn.end').length, 1, 'E8 once, no E2 after it');
});

test('§11.3, §11.1: lines the room does not understand are logged and skipped; stderr keeps 20 lines of 120', async (t) => {
  const code = `
    const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\\n');
    for (let i = 0; i < 25; i++) process.stderr.write('err line ' + i + ' ' + 'x'.repeat(200) + '\\n');
    out('not json at all'); out({ no: 'type' }); out({ type: 'shout' }); out({ type: 'taken' }); out([1, 2]);
    process.stdout.write('{"type":"text.delta","text":"' + 'y'.repeat(17 * 1024 * 1024) + '"}\\n');
    out({ type: 'ready', session: process.env.LANEBOARD_SESSION, tools: [], mcp: { laneboard: 'connected' },
      canSteer: true, canCancelQueued: true, allowlist: JSON.parse(process.env.LANEBOARD_ALLOWED_TOOLS) });
    process.stdin.on('data', () => {}); process.stdin.on('end', () => process.exit(0));`;
  const s = await setup(t, { kind: 'bridge', command: [process.execPath, '-e', code] });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready after the odd lines');
  await s.until(() => s.bridge.stderrTail().length === 20 && s.bridge.stderrTail().at(-1).startsWith('err line 24'), 'stderr');
  const has = (frag) => assert.ok(s.logs.some((l) => l.includes(frag)), `log has "${frag}":\n${s.logs.join('\n')}`);
  has('not understood: not json at all');
  has('not understood: {"no":"type"}');
  has('not understood: [1,2]');
  has('unknown type: {"type":"shout"}');
  has('id: required: {"type":"taken"}');
  has('a line over 16 MB dropped unread');
  const tail = s.bridge.stderrTail();
  assert.ok(tail.every((l) => l.length <= 120));
  assert.equal(tail[0].slice(0, 11), 'err line 5 ');
  assert.deepEqual(s.messages, []);
});

// ------------------------------------------------------------ redaction (T10)

test('S-SEC-02 through the bridge: no frame holds the token or the key, the reply reads as the scenario says (D211)', async (t) => {
  const s = await setup(t, { script: script('sec-reply') });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-00000010', screen: 'desk', text: 'what is in /etc/acme/env?', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  const wire = s.messages.map((m) => JSON.stringify(m)).join('\n');
  for (const bit of ['ghp_9xQ2', 'PRIVATE KEY', 'AAAAnot']) assert.ok(!wire.includes(bit), `a frame holds ${bit}`);
  const blocks = s.messages.filter((m) => m.type === 'text.block');
  assert.deepEqual(blocks.map((b) => b.text), ['The token in /etc/acme/env is [redacted] and the key is below.', '[redacted]']);
  const first = s.messages.filter((m) => m.type === 'text.delta' && m.blockIndex === blocks[0].blockIndex);
  assert.equal(first.map((d) => d.text).join(''), blocks[0].text, 'the deltas add up to the block');
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
  assert.equal(s.messages.at(-1).state, 'done');
});

test('a tool\'s input is redacted before D97\'s cuts; the room\'s own MCP token is rule 1 (§5.3, D127)', async (t) => {
  const s = await setup(t, { script: bridgeScript({}, [{ steps: [
    { at: 50, tool: 'Grep', input: { pattern: `Authorization: Bearer ${'eyJ'.padEnd(190, 'x')}${'abc123DEF'.repeat(4)}`, path: '/etc/laneboard', api_key: 7 }, endAt: 100, call: false },
    { at: 150, text: 'the token is test-token here.' }, { at: 200, end: 'done' }] }]) });
  s.bridge.start();
  await s.until(() => s.bridge.state === 'up', 'ready');
  await s.bridge.prompt({ clientId: 'p-00000011', screen: 'desk', text: 'find the token', source: 'typed', lang: null, about: null });
  await s.until(() => s.messages.some((m) => m.type === 'turn.end'), 'turn.end');
  const ts = s.messages.find((m) => m.type === 'tool.start');
  assert.deepEqual(ts.input, { pattern: 'Authorization: Bearer [redacted]', path: '/etc/laneboard', api_key: '[redacted]' });
  const tb = s.messages.find((m) => m.type === 'text.block');
  assert.equal(tb.text, 'the token is [redacted] here.');
  assert.ok(!s.messages.some((m) => JSON.stringify(m).includes('test-token')));
});
