// The fake agent (cockpit spec `stand-ins.md` §2, §7 step 1): a scripted child
// replays `protocols.md` §13.1's turn and its native lines match the table line
// by line; every line it writes has the shape of its `protocols.md` §11.4 row,
// so the mapping fixtures and the fake cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fakeAgentLog } from './cockpit/stand-ins/fake-agent-log.mjs';
import { assertRowShapes } from './cockpit/stand-ins/native-rows.mjs';
import { ownerWords, matchTurn, timeline, stepKind } from './cockpit/stand-ins/fake-agent.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs');

// §11.2's argument list, as the room passes it.
const SESSION = '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91';
const CLAUDE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--include-partial-messages', '--replay-user-messages',
  '--mcp-config', '/nonexistent/cockpit-agent/mcp.json', '--strict-mcp-config',
  '--allowedTools', 'mcp__laneboard__*,Read,Grep,Glob', '--permission-prompts', 'none',
  '--max-turns', '40', '--append-system-prompt', 'standing instructions',
  '--session-id', SESSION];

/** The child's environment as D108 gives it, plus the fake's own dir. */
function childEnv(dir) {
  const env = { FAKE_AGENT_DIR: dir, LANEBOARD_MCP_TOKEN: 'test-token' };
  for (const k of ['PATH', 'HOME', 'LANG', 'USER']) if (process.env[k] != null) env[k] = process.env[k];
  return env;
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-agent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Starts the fake in `dir` with `script`; collects its stdout lines with their arrival time. */
function startFake(t, dir, script, args = CLAUDE_ARGS, { env = {}, cwd } = {}) {
  if (script) fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(script));
  const child = spawn(process.execPath, [FAKE, ...args], { env: { ...childEnv(dir), ...env }, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let stderr = '';
  let buf = '';
  let wake = () => {};
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lines.push({ at: Date.now(), obj: JSON.parse(l) });
    }
    wake();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  t.after(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); });
  return {
    child, lines, exited,
    stderr: () => stderr,
    send: (obj) => child.stdin.write(JSON.stringify(obj) + '\n'),
    /** Resolves with the lines once `pred(lines)` holds; fails after `ms`. */
    async until(pred, ms = 8000) {
      const end = Date.now() + ms;
      while (!pred(lines.map((l) => l.obj))) {
        if (Date.now() > end) throw new Error(`timed out; got:\n${lines.map((l) => JSON.stringify(l.obj)).join('\n')}\nstderr: ${stderr}`);
        await new Promise((r) => { wake = r; setTimeout(r, 50); });
      }
      return lines;
    },
  };
}

const results = (n) => (objs) => objs.filter((o) => o.type === 'result').length >= n;

/** A user stdin line as §11.5 writes it. */
function userLine(uuid, content) {
  return { type: 'user', uuid, priority: 'next', parent_tool_use_id: null, message: { role: 'user', content } };
}

/** A short name for a native line, enough to compare a stream with §13.1's table. */
function label(o) {
  const e = o.event;
  if (o.type === 'stream_event') {
    if (e.type === 'message_start') return o.user_message_uuids ? 'message_start+uuids' : 'message_start';
    if (e.type === 'content_block_start') return `content_block_start/${e.content_block.type}@${e.index}`;
    if (e.type === 'content_block_delta') return `content_block_delta/${e.delta.type}@${e.index}`;
    if (e.type === 'content_block_stop') return `content_block_stop@${e.index}`;
    return e.type;
  }
  if (o.type === 'user') return o.isReplay ? 'user/replay' : `user/${o.message.content[0].type}`;
  if (o.type === 'assistant') return `assistant/${o.message.content[0].type}`;
  return `${o.type}/${o.subtype}`;
}

// --- The tests ---

test('started with no arguments it prints its usage and exits 0 (slices §2)', async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [FAKE], { env });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.match(out, /^usage: node test\/cockpit\/stand-ins\/fake-agent\.mjs/);
});

test('pure parts: owner words, matching, the timeline', () => {
  assert.equal(ownerWords('(Spoken in German; speech-to-text may have misheard a word.)\nwie lief die Nacht?'), 'wie lief die Nacht?');
  assert.equal(ownerWords('(The owner is asking about node "room-b" on screen "desk". Call focus to see it.)\n(Spoken; x.)\nwas ist los?'), 'was ist los?');
  assert.equal(ownerWords('(only brackets)'), '(only brackets)');
  assert.equal(ownerWords('two\nlines'), 'two\nlines');
  const script = { turns: [{ match: 'Night' }, { match: 'fleet', repeat: true }, {}] };
  assert.equal(matchTurn(script, 'how did the NIGHT go', new Set()), 0);
  assert.equal(matchTurn(script, 'how did the night go', new Set([0])), 2);
  assert.equal(matchTurn(script, 'the fleet', new Set([1])), 1);
  assert.equal(matchTurn({ turns: [{ match: 'x' }] }, 'y', new Set()), -1);
  const ev = timeline([{ at: 300, text: 'a' }, { at: 100, tool: 't', endAt: 300 }, { at: 300, end: 'done' }]);
  assert.deepEqual(ev.map((e) => `${e.t}:${e.kind}`), ['100:tool', '300:text', '300:tool-end', '300:end']);
  assert.equal(stepKind({ at: 1, retry: {} }), 'retry');
  assert.equal(stepKind({ at: 1, nope: 1 }), null);
});

test('replays protocols.md §13.1 line by line', async (t) => {
  const dir = tempDir(t);
  // §13.1's turn, `at` in ms from the prompt's line (2.96 s): the call 4.05-4.60,
  // the text 5.20-7.85, the result 8.00.
  const reply = ['■ One run ', 'is stuck: ', 'builder-a ', 'since ', '03:12', '.'];
  const textAt = [2240, 2770, 3300, 3830, 4360, 4890];
  const script = {
    name: 'c1-voice',
    start: { initAfterMs: 50, mcp: 'connected', login: 'ok', startFailures: 0,
      capabilities: ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'] },
    turns: [{ match: 'wie lief die nacht', steps: [
      // No MCP server here: the call is the next test's (`call:false`, §2.3).
      { at: 1090, tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, endAt: 1640, call: false },
      ...reply.map((text, i) => ({ at: textAt[i], text })),
      { at: 5040, end: 'done', costUsd: 0.0412 },
    ] }],
  };
  const fake = startFake(t, dir, script);
  await fake.until((objs) => objs.some((o) => o.subtype === 'init'));
  const init = fake.lines[0].obj;
  assert.equal(init.session_id, SESSION);
  assert.deepEqual(init.mcp_servers, [{ name: 'laneboard', status: 'connected' }]);
  assert.deepEqual(init.capabilities, ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1']);

  const uuid = '9d2f4c1e-7a3b-4e8d-b1c6-52a0e9f3d714';
  const raw = '(Spoken in German; speech-to-text may have misheard a word.)\nwie lief die Nacht?';
  const sentAt = Date.now();
  fake.send(userLine(uuid, raw));
  await fake.until(results(1));
  const turn = fake.lines.slice(1);
  const objs = turn.map((l) => l.obj);

  // [label, ms after the prompt (the §13.1 row's t − 2.96 s, or the step's own time)]
  const expected = [
    ['user/replay', 0], // 2.97
    ['message_start+uuids', 0], // 2.98, taken
    ['content_block_start/tool_use@0', 1090], // 4.05
    ['content_block_delta/input_json_delta@0', 1090],
    ['assistant/tool_use', 1090], // 4.10
    // The message ends with its tool call (B5: §13.1 abridges these at 4.10).
    ['content_block_stop@0', 1090], ['message_delta', 1090], ['message_stop', 1090],
    ['user/tool_result', 1640], // 4.60
    ['message_start', 2240], ['content_block_start/text@0', 2240], // 5.20
    ...textAt.map((ms) => ['content_block_delta/text_delta@0', ms]), // 5.20-7.85
    ['assistant/text', 5040], // 7.90: written at the `end` step (§2.3)
    ['content_block_stop@0', 5040], ['message_delta', 5040], ['message_stop', 5040], // 7.95
    ['result/success', 5040], // 8.00
  ];
  assert.deepEqual(objs.map(label), expected.map(([l]) => l));
  turn.forEach((l, i) => {
    const ms = l.at - sentAt;
    const want = expected[i][1];
    assert.ok(ms >= want - 20 && ms <= want + 600, `${expected[i][0]} at ${ms} ms, want ${want}`);
  });

  // The fields §13.1 names.
  assert.equal(objs[0].uuid, uuid);
  assert.equal(objs[0].message.content, raw);
  assert.deepEqual(objs[1].user_message_uuids, [uuid]);
  const toolId = objs[2].event.content_block.id;
  assert.equal(objs[2].event.content_block.name, 'mcp__laneboard__morning');
  assert.deepEqual(JSON.parse(objs[3].event.delta.partial_json), { window: 'tonight' });
  assert.deepEqual(objs[4].message.content[0], { type: 'tool_use', id: toolId, name: 'mcp__laneboard__morning', input: { window: 'tonight' } });
  assert.equal(objs[8].message.content[0].tool_use_id, toolId);
  assert.equal(objs[8].message.content[0].is_error, false);
  assert.deepEqual(objs.filter((o) => o.event?.delta?.type === 'text_delta').map((o) => o.event.delta.text), reply);
  assert.equal(objs.find((o) => o.type === 'assistant' && o.message.content[0].type === 'text').message.content[0].text, reply.join(''));
  const result = objs.at(-1);
  assert.equal(result.num_turns, 2);
  assert.equal(result.total_cost_usd, 0.0412);
  for (const o of [init, ...objs]) assert.equal(o.session_id, SESSION);

  // Each line has its §11.4 row's shape.
  assertRowShapes([init, ...objs]);

  // The log (§2.6).
  const log = fakeAgentLog(dir);
  assert.deepEqual(log.order(), ['start', 'prompt', 'tool-result', 'turn-end']);
  assert.deepEqual(log.order('stdin', 'prompt'), ['stdin', 'prompt']);
  assert.deepEqual(log.toolResults().map((l) => [l.tool, l.isError, l.result]), [['mcp__laneboard__morning', false, null]]);
  const [start] = log.starts();
  assert.equal(start.n, 1);
  assert.equal(start.session, SESSION);
  assert.equal(start.resumed, false);
  assert.deepEqual(start.argv, CLAUDE_ARGS);
  assert.deepEqual(start.env, Object.keys(childEnv(dir)).sort());
  const stdin = log.lines().find((l) => l.kind === 'stdin');
  assert.equal(stdin.line.uuid, uuid);
  assert.equal('content' in stdin.line.message, false, 'the text is in the prompt line only');
  const [p] = log.prompts();
  assert.equal(p.atMs, stdin.atMs);
  assert.deepEqual({ uuid: p.uuid, priority: p.priority, words: p.words, raw: p.raw, turn: p.turn },
    { uuid, priority: 'next', words: 'wie lief die Nacht?', raw, turn: 'c1-voice#1' });
  assert.equal('resendOf' in p, false);
  assert.deepEqual(log.turnEnds().map((l) => [l.turn, l.end]), [['c1-voice#1', 'done']]);
  assert.equal(fs.readFileSync(path.join(dir, 'starts'), 'utf8'), '1');

  fake.child.stdin.end();
  assert.deepEqual(await fake.exited, { code: 0, signal: null });
  assert.deepEqual(log.order().slice(-1), ['stdin-end']);
});

test('matching: case-insensitive, played once unless repeat, no match says so', async (t) => {
  const dir = tempDir(t);
  const turns = [
    { match: 'the night', steps: [{ at: 0, text: 'A' }, { at: 10, end: 'done' }] },
    { match: 'fleet', repeat: true, steps: [{ at: 0, text: 'B' }, { at: 10, end: 'done' }] },
  ];
  const fake = startFake(t, dir, { name: 'm', turns });
  const words = ['How did THE NIGHT go?', 'the night again, a prompt longer than forty characters', '(Spoken in English; x.)\nthe fleet', 'fleet'];
  words.forEach((w, i) => fake.send(userLine(`00000000-0000-4000-8000-00000000000${i}`, w)));
  await fake.until(results(4));
  const texts = fake.lines.map((l) => l.obj).filter((o) => o.type === 'assistant').map((o) => o.message.content[0].text);
  assert.deepEqual(texts, ['A', '(fake agent: no scripted turn for "the night again, a prompt longer than fo")', 'B', 'B']);
  const log = fakeAgentLog(dir);
  assert.deepEqual(log.prompts().map((p) => p.turn), ['m#1', null, 'm#2', 'm#2']);
  assert.equal(log.prompts()[2].words, 'the fleet');
  assert.deepEqual(log.turnEnds().map((l) => l.turn), ['m#1', null, 'm#2', 'm#2']);
  assertRowShapes(fake.lines.map((l) => l.obj));
});

test('a prompt sent while a turn runs is taken after it; the same words untaken are a resend', async (t) => {
  const dir = tempDir(t);
  const fake = startFake(t, dir, { name: 'q', turns: [{ repeat: true, steps: [{ at: 0, text: 'x' }, { at: 300, end: 'done' }] }] });
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'first'));
  fake.send(userLine('00000000-0000-4000-8000-000000000002', 'second'));
  fake.send(userLine('00000000-0000-4000-8000-000000000003', 'second'));
  await fake.until(results(3));
  const objs = fake.lines.map((l) => l.obj);
  assert.deepEqual(objs.filter((o) => o.user_message_uuids).map((o) => o.user_message_uuids[0].slice(-1)), ['1', '2', '3']);
  const firstResult = objs.findIndex((o) => o.type === 'result');
  const secondTaken = objs.findIndex((o) => o.user_message_uuids?.[0].endsWith('2'));
  assert.ok(secondTaken > firstResult, 'taken after the running turn ended');
  const p = fakeAgentLog(dir).prompts();
  assert.equal(p[2].resendOf, '00000000-0000-4000-8000-000000000002');
  assert.equal('resendOf' in p[1], false);
});

test('text steps: skipDelta leaves the delta out, block:new starts a second block', async (t) => {
  const dir = tempDir(t);
  const fake = startFake(t, dir, { name: 'b', turns: [{ steps: [
    { at: 0, text: 'Two ' }, { at: 10, text: 'runs ', skipDelta: true }, { at: 20, text: 'finished.' },
    { at: 30, text: 'Second.', block: 'new' }, { at: 40, end: 'done' }] }] });
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'go'));
  await fake.until(results(1));
  const objs = fake.lines.map((l) => l.obj);
  assert.deepEqual(objs.filter((o) => o.event?.delta?.type === 'text_delta').map((o) => `${o.event.index}:${o.event.delta.text}`),
    ['0:Two ', '0:finished.', '1:Second.']);
  assert.deepEqual(objs.filter((o) => o.type === 'assistant').map((o) => o.message.content[0].text), ['Two runs finished.', 'Second.']);
  assert.equal(objs.filter((o) => o.event?.type === 'message_start').length, 1, 'one message');
  assert.equal(objs.at(-1).num_turns, 1);
});

test('tool steps: parallel calls share a message and end in their own order; denied, retry', async (t) => {
  const dir = tempDir(t);
  const fake = startFake(t, dir, { name: 'p', turns: [{ steps: [
    { at: 0, tool: 'mcp__laneboard__fleet', input: { site: 'hv1' }, endAt: 300, call: false },
    { at: 50, tool: 'mcp__laneboard__fleet', input: { site: 'hv2' }, endAt: 150, isError: true, call: false },
    { at: 400, retry: { attempt: 2, of: 10, error: 'overloaded' } },
    { at: 450, denied: 'Bash', input: { command: 'ls' } },
    { at: 500, text: 'Done.' }, { at: 550, end: 'done' }] }] });
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'go'));
  await fake.until(results(1));
  const objs = fake.lines.map((l) => l.obj);
  const calls = objs.filter((o) => o.type === 'assistant' && o.message.content[0].type === 'tool_use').map((o) => o.message.content[0]);
  assert.deepEqual(calls.map((c) => c.input.site ?? c.name), ['hv1', 'hv2', 'Bash']);
  assert.deepEqual(objs.slice(2, 10).map(label), ['message_start+uuids',
    'content_block_start/tool_use@0', 'content_block_delta/input_json_delta@0', 'assistant/tool_use', 'content_block_stop@0',
    'content_block_start/tool_use@1', 'content_block_delta/input_json_delta@1', 'assistant/tool_use']);
  const tr = objs.filter((o) => o.type === 'user' && !o.isReplay).map((o) => o.message.content[0]);
  assert.deepEqual(tr.map((r) => [r.tool_use_id, r.is_error]), [[calls[1].id, true], [calls[0].id, false]]);
  const firstStop = objs.findIndex((o) => o.event?.type === 'message_stop');
  assert.ok(firstStop < objs.findIndex((o) => o.type === 'user' && !o.isReplay), 'the message ends before the first result');
  assert.equal(objs.slice(0, firstStop).filter((o) => o.event?.type === 'message_start').length, 1, 'both calls in one message');
  const retry = objs.find((o) => o.subtype === 'api_retry');
  assert.deepEqual([retry.attempt, retry.max_retries, retry.error], [2, 10, 'overloaded']);
  const denied = objs.find((o) => o.subtype === 'permission_denied');
  assert.deepEqual([denied.tool_use_id, denied.tool_name], [calls[2].id, 'Bash']);
  assert.equal(objs.some((o) => o.message?.content?.[0]?.tool_use_id === calls[2].id), false, 'a denied call gets no tool_result');
  assertRowShapes(objs);
});

test('end steps: step-limit, failed with detail, not-logged-in; login failed ends every prompt so', async (t) => {
  const dir = tempDir(t);
  const turns = [
    { match: 'limit', steps: [{ at: 0, end: 'step-limit' }] },
    { match: 'boom', steps: [{ at: 0, end: 'failed', detail: 'API Error: 529 overloaded' }] },
    { match: 'login', steps: [{ at: 0, end: 'not-logged-in' }] },
  ];
  const args = CLAUDE_ARGS.map((a, i) => (CLAUDE_ARGS[i - 1] === '--max-turns' ? '7' : a));
  const fake = startFake(t, dir, { name: 'e', turns }, args);
  ['limit', 'boom', 'login'].forEach((w, i) => fake.send(userLine(`00000000-0000-4000-8000-00000000000${i}`, w)));
  await fake.until(results(3));
  const objs = fake.lines.map((l) => l.obj);
  const res = objs.filter((o) => o.type === 'result');
  assert.deepEqual([res[0].subtype, res[0].num_turns], ['error_max_turns', 7]);
  assert.deepEqual([res[1].subtype, res[1].errors], ['error_during_execution', ['API Error: 529 overloaded']]);
  const auth = objs.findIndex((o) => o.error === 'authentication_failed');
  assert.ok(auth > objs.indexOf(res[1]) && auth < objs.indexOf(res[2]), 'api_retry authentication_failed, then the result');
  assert.deepEqual(fakeAgentLog(dir).turnEnds().map((l) => l.end), ['step-limit', 'failed', 'not-logged-in']);
  assertRowShapes(objs);

  // `start.login: "failed"`: any prompt ends not-logged-in (script re-read at the prompt).
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ name: 'e', start: { login: 'failed' }, turns }));
  fake.send(userLine('00000000-0000-4000-8000-000000000009', 'limit'));
  await fake.until(results(4));
  assert.equal(fakeAgentLog(dir).turnEnds().at(-1).end, 'not-logged-in');
});

test('exit step: the process exits at once with the code, mid-text', async (t) => {
  const dir = tempDir(t);
  const fake = startFake(t, dir, { name: 'x', turns: [{ steps: [{ at: 0, text: 'half' }, { at: 50, exit: 3 }, { at: 100, end: 'done' }] }] });
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'go'));
  assert.deepEqual(await fake.exited, { code: 3, signal: null });
  const objs = fake.lines.map((l) => l.obj);
  assert.equal(objs.at(-1).event?.delta?.text, 'half');
  assert.equal(objs.some((o) => o.type === 'result'), false);
  assert.deepEqual(fakeAgentLog(dir).order(), ['start', 'prompt']);
});

test('start: initAfterMs, --resume, mcp failed, startFailures with startStderr and the starts counter', async (t) => {
  const dir = tempDir(t);
  const script = { name: 's', start: { initAfterMs: 200, mcp: 'failed', startFailures: 2, startStderr: 'claude: command not found' }, turns: [] };
  for (const n of [1, 2]) {
    const f = startFake(t, dir, script);
    assert.deepEqual(await f.exited, { code: 1, signal: null });
    assert.equal(f.stderr(), 'claude: command not found\n');
    assert.equal(f.lines.length, 0, 'no init');
    assert.equal(fs.readFileSync(path.join(dir, 'starts'), 'utf8'), String(n));
  }
  const resumeArgs = CLAUDE_ARGS.slice(0, -2).concat(['--resume', SESSION]);
  const t0 = Date.now();
  const f = startFake(t, dir, script, resumeArgs);
  await f.until((objs) => objs.length > 0);
  assert.ok(f.lines[0].at - t0 >= 200, 'init after initAfterMs');
  assert.equal(f.lines[0].obj.session_id, SESSION);
  assert.deepEqual(f.lines[0].obj.mcp_servers, [{ name: 'laneboard', status: 'failed' }]);
  const starts = fakeAgentLog(dir).starts();
  assert.deepEqual(starts.map((s) => [s.n, s.resumed]), [[1, false], [2, false], [3, true]]);
  // An empty script answers with the no-match line.
  f.send(userLine('00000000-0000-4000-8000-000000000001', 'hello'));
  await f.until(results(1));
  assert.equal(fakeAgentLog(dir).prompts()[0].turn, null);
});

test('the login check: ok, failed, hang; not counted as a start', async (t) => {
  const dir = tempDir(t);
  const check = async (login) => {
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ name: 'l', start: { login }, turns: [] }));
    const child = spawn(process.execPath, [FAKE, 'auth', 'status'], { env: childEnv(dir) });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
    const timer = new Promise((r) => setTimeout(() => r(['timeout']), 1500));
    const [code] = await Promise.race([once(child, 'exit'), timer]);
    return { code, out };
  };
  assert.deepEqual(await check('ok'), { code: 0, out: 'Logged in.\n' });
  assert.deepEqual(await check('failed'), { code: 1, out: 'Not logged in. Run claude to log in.\n' });
  assert.deepEqual(await check('hang'), { code: 'timeout', out: '' });
  const log = fakeAgentLog(dir);
  assert.deepEqual(log.loginChecks().map((l) => [l.login, l.exit]), [['ok', 0], ['failed', 1], ['hang', null]]);
  assert.equal(log.starts().length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'starts')), false);
});

// --- T4: real MCP calls, `queued`, `onInterrupt`, `priority`, signals, the bridge dialect ---

/**
 * A small loopback JSON-RPC stub standing in for the room's MCP server (`c3-see.md` §1):
 * `answer(name, args)` gives `{delayMs, sse, rpc}` per call; every request is kept.
 */
async function mcpStub(t, answer) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      requests.push({ headers: req.headers, url: req.url, msg, at: Date.now() });
      const a = answer(msg.params?.name, msg.params?.arguments);
      setTimeout(() => {
        const rpc = { jsonrpc: '2.0', id: msg.id, ...a.rpc };
        if (a.sse) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`);
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(rpc));
        }
      }, a.delayMs ?? 0);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests };
}

/** `c3-see.md` §1's `mcp.json`, written to `file`, pointing at `url`. */
function writeMcpJson(file, url) {
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { laneboard: { type: 'http', url,
    headers: { Authorization: 'Bearer ${LANEBOARD_MCP_TOKEN}' }, timeout: 15000 } } }));
}

const withMcpConfig = (file) => CLAUDE_ARGS.map((a, i) => (CLAUDE_ARGS[i - 1] === '--mcp-config' ? file : a));
const toolResults = (objs) => objs.filter((o) => o.type === 'user' && !o.isReplay).map((o) => o.message.content[0]);
const tokenOf = (o) => o.user_message_uuids?.[0];

test('a real MCP call: tools/call to the --mcp-config URL with the token; endAt is the earliest end', async (t) => {
  const dir = tempDir(t);
  const morning = { asOf: [{ source: 'board', at: '2026-10-27T07:12:04+01:00', ageS: 1 }], window: 'tonight', stuck: [] };
  const stub = await mcpStub(t, (name, args) => {
    if (name === 'morning') return { delayMs: 400, rpc: { result: { content: [{ type: 'text', text: JSON.stringify(morning) }], structuredContent: morning } } };
    if (name === 'runs' && args.run === 'acme-x') return { sse: true, rpc: { result: { isError: true, content: [{ type: 'text', text: 'No run "acme-x". Known runs: acme-search.' }] } } };
    if (name === 'runs') return { rpc: { error: { code: -32602, message: 'run: must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' } } };
    return { rpc: { result: { isError: true, content: [{ type: 'text', text: '{"alerts":[]}' }] } } };
  });
  const config = path.join(dir, 'mcp.json');
  writeMcpJson(config, stub.url);
  const fake = startFake(t, dir, { name: 'mcp', turns: [{ steps: [
    { at: 0, tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, endAt: 100 },
    { at: 500, tool: 'mcp__laneboard__runs', input: { run: 'acme-x' }, endAt: 550 },
    { at: 600, tool: 'mcp__laneboard__runs', input: { run: '../x' }, endAt: 650 },
    { at: 700, tool: 'mcp__laneboard__alerts', input: {}, endAt: 750, isError: false },
    { at: 800, tool: 'Read', input: { file_path: 'README.md' }, endAt: 850 },
    { at: 900, end: 'done' }] }] }, withMcpConfig(config));
  const sentAt = Date.now();
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'go'));
  await fake.until(results(1));
  const objs = fake.lines.map((l) => l.obj);

  // The requests: one tools/call per mcp__laneboard__ step, the token from the environment.
  assert.deepEqual(stub.requests.map((r) => [r.msg.method, r.msg.params.name, r.msg.params.arguments]),
    [['tools/call', 'morning', { window: 'tonight' }], ['tools/call', 'runs', { run: 'acme-x' }],
      ['tools/call', 'runs', { run: '../x' }], ['tools/call', 'alerts', {}]]);
  for (const r of stub.requests) {
    assert.equal(r.headers.authorization, 'Bearer test-token');
    assert.equal(r.url, '/mcp');
    assert.equal(r.msg.jsonrpc, '2.0');
  }
  // The morning result waits for the call (400 ms), not endAt (100 ms).
  const firstResult = fake.lines.find((l) => l.obj.type === 'user' && !l.obj.isReplay);
  assert.ok(firstResult.at - sentAt >= 400, `tool_result at ${firstResult.at - sentAt} ms`);
  const tr = toolResults(objs);
  assert.deepEqual(tr.map((r) => r.is_error), [false, true, true, false, false]);
  assert.equal(tr[0].content, JSON.stringify(morning));
  assert.equal(tr[4].content, '(fake agent: no call)', 'Read is not an MCP tool: no call');
  assertRowShapes(objs);

  // The log: one tool-result per call, the step's isError winning over the result's.
  const logged = fakeAgentLog(dir).toolResults();
  assert.deepEqual(logged.map((l) => [l.tool, l.isError]), [['mcp__laneboard__morning', false],
    ['mcp__laneboard__runs', true], ['mcp__laneboard__runs', true], ['mcp__laneboard__alerts', false]]);
  assert.deepEqual(logged[0].result, morning);
  assert.deepEqual(logged[0].input, { window: 'tonight' });
  assert.equal(logged[1].result, 'No run "acme-x". Known runs: acme-search.');
  assert.equal(logged[2].result, null);
  assert.equal(logged[2].error.code, -32602);
  assert.deepEqual(logged[3].result, { alerts: [] }, 'no structuredContent: the text parsed');
  assert.equal(fakeAgentLog(dir).toolResults('mcp__laneboard__runs').length, 2);
});

test('queued next-tool-end: a prompt sent during a call is taken at its end, into the same turn', async (t) => {
  const dir = tempDir(t);
  // S-C1-16's shape: text, a call 100-600 ms, more text; the steer turn writes 0.3 s after the take.
  const script = { name: 'c1-typing', turns: [
    { match: 'how did', queued: 'next-tool-end', steps: [
      { at: 0, text: 'Three runs ran last night.' },
      { at: 100, tool: 'mcp__laneboard__runs', input: {}, endAt: 600, call: false },
      { at: 700, text: 'The rest.', block: 'new' }, { at: 800, end: 'done' }] },
    { match: 'only the failed one', steps: [{ at: 300, text: 'Only builder-a failed.' }, { at: 400, end: 'done' }] },
  ] };
  const fake = startFake(t, dir, script);
  const a = '00000000-0000-4000-8000-00000000000a';
  const b = '00000000-0000-4000-8000-00000000000b';
  fake.send(userLine(a, 'how did the night go'));
  await fake.until((objs) => objs.some((o) => o.event?.content_block?.type === 'tool_use'));
  fake.send(userLine(b, 'only the failed one'));
  await fake.until(results(1));
  const lines = fake.lines;
  const objs = lines.map((l) => l.obj);
  const resultAt = objs.findIndex((o) => o.type === 'tool_result' || (o.type === 'user' && !o.isReplay));
  const steer = objs.findIndex((o) => tokenOf(o) === b);
  assert.ok(steer > resultAt, 'taken after the call ended');
  const takenAt = lines[steer].at;
  const reply = lines.find((l) => l.obj.event?.delta?.text === 'Only builder-a failed.');
  assert.ok(reply.at - takenAt >= 300, `steer text ${reply.at - takenAt} ms after the take`);
  assert.equal(objs.filter((o) => o.type === 'result').length, 1, 'one turn');
  assert.equal(objs.some((o) => o.event?.delta?.text === 'The rest.'), false, 'the running turn\'s rest is dropped (B26)');
  assert.deepEqual(objs.filter((o) => o.type === 'assistant' && o.message.content[0].type === 'text').map((o) => o.message.content[0].text),
    ['Three runs ran last night.', 'Only builder-a failed.']);
  const log = fakeAgentLog(dir);
  assert.deepEqual(log.order('interrupt'), []);
  assert.deepEqual(log.prompts().map((p) => [p.priority, p.turn]), [['next', 'c1-typing#1'], ['next', 'c1-typing#2']]);
  assert.deepEqual(log.turnEnds().map((l) => [l.turn, l.end]), [['c1-typing#1', 'done']]);
  assertRowShapes(objs);
});

test('queued: no call running, after-turn, and priority later/now', async (t) => {
  const dir = tempDir(t);
  const script = { name: 'q', turns: [
    { match: 'long', queued: 'next-tool-end', steps: [
      { at: 0, tool: 'mcp__laneboard__fleet', input: {}, endAt: 300, call: false },
      { at: 400, text: 'x' }, { at: 600, end: 'done' }] },
    { match: 'after', queued: 'after-turn', steps: [
      { at: 0, tool: 'mcp__laneboard__fleet', input: {}, endAt: 300, call: false }, { at: 400, end: 'done' }] },
    { match: 'stay', repeat: true, onInterrupt: { endAfterMs: 0 }, steps: [{ at: 0, text: 'y' }, { at: 2000, end: 'done' }] },
    { match: 'short', repeat: true, steps: [{ at: 0, text: 'z' }, { at: 50, end: 'done' }] },
  ] };
  const fake = startFake(t, dir, script);
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  const firstMessageOf = (objs, uuid) => objs.findIndex((o) => tokenOf(o) === uuid);
  const resultsBefore = (objs, i) => objs.slice(0, i).filter((o) => o.type === 'result').length;

  // next-tool-end with no call running at arrival: taken after the turn.
  fake.send(userLine(id(1), 'long'));
  await fake.until((objs) => objs.some((o) => o.type === 'user' && !o.isReplay));
  fake.send(userLine(id(2), 'short one'));
  await fake.until(results(2));
  let objs = fake.lines.map((l) => l.obj);
  assert.equal(resultsBefore(objs, firstMessageOf(objs, id(2))), 1, 'a new turn after the first');

  // after-turn: a prompt during the call waits for the turn's end.
  fake.send(userLine(id(3), 'after'));
  await fake.until((objs2) => objs2.some((o) => tokenOf(o) === id(3)));
  fake.send(userLine(id(4), 'short two'));
  await fake.until(results(4));
  objs = fake.lines.map((l) => l.obj);
  assert.equal(resultsBefore(objs, firstMessageOf(objs, id(4))), 3);

  // priority later: after the turn even though `queued` is next-tool-end.
  fake.send(userLine(id(5), 'long'));
  await fake.until((objs2) => objs2.some((o) => tokenOf(o) === id(5)));
  fake.send({ ...userLine(id(6), 'short three'), priority: 'later' });
  await fake.until(results(6));
  objs = fake.lines.map((l) => l.obj);
  assert.equal(resultsBefore(objs, firstMessageOf(objs, id(6))), 5);

  // priority now: ends the running turn as an interrupt would, then a new turn.
  fake.send(userLine(id(7), 'stay'));
  await fake.until((objs2) => objs2.some((o) => tokenOf(o) === id(7)));
  fake.send({ ...userLine(id(8), 'short four'), priority: 'now' });
  await fake.until(results(8));
  objs = fake.lines.map((l) => l.obj);
  const res = objs.filter((o) => o.type === 'result');
  assert.equal(res[6].terminal_reason, 'aborted_streaming');
  assert.equal(objs.some((o) => o.type === 'control_response'), false, 'no request, no receipt');
  const log = fakeAgentLog(dir);
  assert.deepEqual(log.turnEnds().map((l) => l.end).slice(-2), ['stopped', 'done']);
  assert.deepEqual(log.prompts().map((p) => p.priority), ['next', 'next', 'next', 'next', 'next', 'later', 'next', 'now']);
  assert.deepEqual(log.order('interrupt'), []);
  assertRowShapes(objs);
});

test('queued ignore-once takes the resend as a new turn; ignore takes neither', async (t) => {
  const dir = tempDir(t);
  const turn = (queued) => ({ match: 'first', queued, steps: [{ at: 0, tool: 'mcp__laneboard__runs', input: {}, endAt: 200, call: false }, { at: 300, end: 'done' }] });
  const script = (queued) => ({ name: 'c1-typing', turns: [turn(queued),
    { match: 'only the failed one', repeat: true, steps: [{ at: 0, text: 'Only builder-a failed.' }, { at: 50, end: 'done' }] }] });
  for (const queued of ['ignore-once', 'ignore']) {
    const d = path.join(dir, queued);
    fs.mkdirSync(d);
    const fake = startFake(t, d, script(queued));
    const first = '00000000-0000-4000-8000-000000000001';
    const queuedId = '00000000-0000-4000-8000-000000000002';
    const resend = '00000000-0000-4000-8000-000000000003';
    fake.send(userLine(first, 'first'));
    await fake.until((objs) => objs.some((o) => tokenOf(o) === first));
    fake.send(userLine(queuedId, 'only the failed one'));
    await fake.until(results(1));
    await new Promise((r) => setTimeout(r, 200));
    let objs = fake.lines.map((l) => l.obj);
    assert.equal(objs.some((o) => tokenOf(o) === queuedId), false, `${queued}: never taken`);
    assert.equal(objs.filter((o) => o.type === 'result').length, 1);
    // The room's resend (§3.4): the same text, a new uuid.
    fake.send(userLine(resend, 'only the failed one'));
    if (queued === 'ignore-once') {
      await fake.until(results(2));
      objs = fake.lines.map((l) => l.obj);
      assert.equal(objs.some((o) => tokenOf(o) === resend), true, 'the resend is taken as a new turn');
    } else {
      await new Promise((r) => setTimeout(r, 300));
      objs = fake.lines.map((l) => l.obj);
      assert.equal(objs.filter((o) => o.type === 'result').length, 1, 'the resend is not taken either');
    }
    const p = fakeAgentLog(d).prompts();
    assert.equal(p.length, 3);
    assert.equal(p[2].resendOf, queuedId);
    fake.child.stdin.end();
    await fake.exited;
  }
});

test('onInterrupt endAfterMs: the receipt, cancel_queued, the aborted result; still_queued runs next', async (t) => {
  const dir = tempDir(t);
  const script = { name: 'c1-typing', start: { capabilities: ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'] }, turns: [
    { match: 'long call', repeat: true, onInterrupt: { endAfterMs: 300 }, queued: 'after-turn', steps: [
      { at: 0, tool: 'mcp__laneboard__runs', input: {}, endAt: 19500, call: false }, { at: 19600, end: 'done' }] },
    { match: 'only the failed one', repeat: true, steps: [{ at: 0, text: 'ok' }, { at: 10, end: 'done' }] },
  ] };
  const fake = startFake(t, dir, script);
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;

  // With cancel_queued: the queued prompt is cancelled, the turn ends `stopped` 300 ms later.
  fake.send(userLine(id(1), 'long call'));
  await fake.until((objs) => objs.some((o) => tokenOf(o) === id(1)));
  fake.send(userLine(id(2), 'only the failed one'));
  await fake.until((objs) => objs.filter((o) => o.isReplay).length === 2);
  const sentAt = Date.now();
  fake.send({ type: 'control_request', request_id: 'i-0001', request: { subtype: 'interrupt', cancel_queued: true } });
  await fake.until(results(1));
  let objs = fake.lines.map((l) => l.obj);
  const receipt = objs.find((o) => o.type === 'control_response');
  assert.deepEqual(receipt.response, { subtype: 'success', request_id: 'i-0001', response: { still_queued: [], cancelled: [id(2)] } });
  const resultLine = fake.lines.find((l) => l.obj.type === 'result');
  assert.ok(resultLine.at - sentAt >= 300 && resultLine.at - sentAt < 1500, `result ${resultLine.at - sentAt} ms after the interrupt`);
  assert.equal(objs.indexOf(receipt) < objs.indexOf(resultLine.obj), true, 'the receipt before the result');
  assert.deepEqual([resultLine.obj.subtype, resultLine.obj.terminal_reason], ['error_during_execution', 'aborted_streaming']);
  assert.equal(toolResults(objs).length, 0, 'the remaining steps are dropped');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fake.lines.some((l) => tokenOf(l.obj) === id(2)), false, 'a cancelled prompt is not taken');

  // Without cancel_queued: still_queued, and the prompt runs after the stop.
  fake.send(userLine(id(3), 'long call'));
  await fake.until((o2) => o2.some((o) => tokenOf(o) === id(3)));
  fake.send(userLine(id(4), 'only the failed one'));
  await fake.until((o2) => o2.filter((o) => o.isReplay).length === 4);
  fake.send({ type: 'control_request', request_id: 'i-0002', request: { subtype: 'interrupt' } });
  await fake.until(results(3));
  objs = fake.lines.map((l) => l.obj);
  const receipts = objs.filter((o) => o.type === 'control_response');
  assert.deepEqual(receipts[1].response.response, { still_queued: [id(4)], cancelled: [] });
  assert.ok(objs.some((o) => tokenOf(o) === id(4)), 'still_queued is taken next');

  const log = fakeAgentLog(dir);
  assert.deepEqual(log.interrupts().map((l) => [l.requestId, l.cancelQueued, l.stillQueued, l.cancelled]),
    [['i-0001', true, [], [id(2)]], ['i-0002', false, [id(4)], []]]);
  assert.deepEqual(log.turnEnds().map((l) => l.end), ['stopped', 'stopped', 'done']);
  assert.deepEqual(log.order('interrupt', 'turn-end'), ['interrupt', 'turn-end', 'interrupt', 'turn-end', 'turn-end']);
  assertRowShapes(objs);
});

test('onInterrupt ignore and ignore-sigint; signals logged before they act; SIGTERM exits 143', async (t) => {
  const dir = tempDir(t);
  const turn = (onInterrupt) => ({ match: onInterrupt, onInterrupt, steps: [{ at: 0, text: 'a' }, { at: 300, text: 'b' }, { at: 30000, end: 'done' }] });
  const fake = startFake(t, dir, { name: 'c1-typing', turns: [turn('ignore'), turn('ignore-sigint')] });

  // ignore: no receipt, the turn plays on; SIGINT ends it as an interrupt with endAfterMs 0.
  fake.send(userLine('00000000-0000-4000-8000-000000000001', 'ignore'));
  await fake.until((objs) => objs.some((o) => o.event?.delta?.text === 'a'));
  fake.send({ type: 'control_request', request_id: 'i-0001', request: { subtype: 'interrupt', cancel_queued: true } });
  await fake.until((objs) => objs.some((o) => o.event?.delta?.text === 'b'));
  assert.equal(fake.lines.some((l) => l.obj.type === 'control_response'), false);
  const sigAt = Date.now();
  fake.child.kill('SIGINT');
  await fake.until(results(1));
  const res = fake.lines.find((l) => l.obj.type === 'result');
  assert.equal(res.obj.terminal_reason, 'aborted_streaming');
  assert.ok(res.at - sigAt < 250, 'ended at once');

  // ignore-sigint: SIGINT does nothing; SIGTERM exits 143.
  fake.send(userLine('00000000-0000-4000-8000-000000000002', 'ignore-sigint'));
  await fake.until((objs) => objs.filter((o) => o.event?.delta?.text === 'b').length === 2);
  fake.child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.lines.filter((l) => l.obj.type === 'result').length, 1, 'SIGINT ignored');
  fake.child.kill('SIGTERM');
  assert.deepEqual(await fake.exited, { code: 143, signal: null });

  const log = fakeAgentLog(dir);
  assert.deepEqual(log.interrupts().map((l) => [l.cancelQueued, l.stillQueued, l.cancelled]), [[true, null, null]]);
  assert.deepEqual(log.signals().map((l) => l.name), ['SIGINT', 'SIGINT', 'SIGTERM']);
  assert.deepEqual(log.order('interrupt', 'signal', 'turn-end', 'prompt'),
    ['prompt', 'interrupt', 'signal', 'turn-end', 'prompt', 'signal', 'signal']);
});

test('the bridge dialect: ready, taken, blocks across the turn, tools, denied, retrying, turn.end, interrupted', async (t) => {
  const dir = tempDir(t);
  const stub = await mcpStub(t, () => ({ rpc: { result: { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } } } }));
  // A bridge agent finds mcp.json in its working directory (B25).
  const cwd = path.join(dir, 'cockpit-agent');
  fs.mkdirSync(cwd);
  writeMcpJson(path.join(cwd, 'mcp.json'), stub.url);
  const session = '5a1e0c77-2b9d-4f3a-8e61-0c4d7b2a9e10';
  const script = { name: 'one-bridge', start: { initAfterMs: 50, capabilities: ['interrupt_cancel_queued_v1'] }, turns: [
    { match: 'wiki', steps: [
      { at: 0, text: 'Looking ' }, { at: 20, text: 'it up.' },
      { at: 100, tool: 'search_wiki', input: { q: 'x' }, endAt: 400 },
      { at: 150, tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, endAt: 200 },
      { at: 450, denied: 'shell', input: { command: 'ls' } },
      { at: 500, retry: { attempt: 2, of: 10, error: 'overloaded' } },
      { at: 550, text: 'Three files.' }, { at: 600, end: 'done', costUsd: 0.01 }] },
    { match: 'limit', steps: [{ at: 0, end: 'step-limit' }] },
    { match: 'boom', steps: [{ at: 0, end: 'failed', detail: 'boom' }] },
    { match: 'login', steps: [{ at: 0, end: 'not-logged-in' }] },
    { match: 'stay', onInterrupt: { endAfterMs: 100 }, steps: [{ at: 0, text: 'y' }, { at: 30000, end: 'done' }] },
  ] };
  const env = { LANEBOARD_SESSION: session, LANEBOARD_SESSION_RESUME: '1', LANEBOARD_ALLOWED_TOOLS: '["mcp__laneboard__*"]' };
  const fake = startFake(t, dir, script, ['--dialect', 'bridge'], { env, cwd });
  await fake.until((objs) => objs.length > 0);
  const ready = fake.lines[0].obj;
  assert.deepEqual(ready, { type: 'ready', session, agent: 'fake-agent 0.0.0-fake',
    tools: ready.tools, mcp: { laneboard: 'connected' }, canSteer: true, canCancelQueued: true,
    allowlist: ['mcp__laneboard__*'] });

  fake.send({ type: 'prompt', id: 'p-1', text: '(Spoken; x.)\nsearch the wiki', priority: 'next' });
  await fake.until((objs) => objs.some((o) => o.type === 'turn.end'));
  const turn = fake.lines.slice(1).map((l) => l.obj);
  assert.deepEqual(turn.map((o) => o.type), ['taken', 'text.delta', 'text.delta', 'text.block',
    'tool.start', 'tool.start', 'tool.end', 'tool.end', 'tool.start', 'retrying', 'text.delta', 'text.block', 'turn.end']);
  assert.deepEqual(turn[0], { type: 'taken', id: 'p-1' });
  assert.deepEqual(turn[3], { type: 'text.block', block: 0, text: 'Looking it up.' });
  const starts = turn.filter((o) => o.type === 'tool.start');
  assert.deepEqual(starts.map((o) => [o.block, o.tool, o.denied]), [[1, 'search_wiki', undefined], [2, 'mcp__laneboard__morning', undefined], [3, 'shell', true]]);
  assert.deepEqual(turn.filter((o) => o.type === 'tool.end').map((o) => o.toolUseId), [starts[1].toolUseId, starts[0].toolUseId]);
  assert.deepEqual(turn[7], { type: 'tool.end', toolUseId: starts[0].toolUseId, isError: false, denied: false });
  assert.deepEqual(turn[9], { type: 'retrying', attempt: 2, of: 10 });
  assert.deepEqual(turn[11], { type: 'text.block', block: 4, text: 'Three files.' });
  assert.equal(turn[12].state, 'done');
  assert.equal(turn[12].costUsd, 0.01);
  assert.equal(typeof turn[12].durationMs, 'number');
  assert.deepEqual(stub.requests.map((r) => [r.msg.params.name, r.headers.authorization]), [['morning', 'Bearer test-token']]);

  for (const [i, w] of ['limit', 'boom', 'login'].entries()) fake.send({ type: 'prompt', id: `p-${i + 2}`, text: w, priority: 'next' });
  await fake.until((objs) => objs.filter((o) => o.type === 'turn.end').length === 4);
  assert.deepEqual(fake.lines.map((l) => l.obj).filter((o) => o.type === 'turn.end').slice(1),
    [{ type: 'turn.end', state: 'error', code: 'step-limit', steps: 40 },
      { type: 'turn.end', state: 'error', code: 'failed', detail: 'boom' },
      { type: 'turn.end', state: 'error', code: 'not-logged-in' }]);

  fake.send({ type: 'prompt', id: 'p-5', text: 'stay', priority: 'next' });
  fake.send({ type: 'prompt', id: 'p-6', text: 'later one', priority: 'next' });
  await fake.until((objs) => objs.some((o) => o.type === 'taken' && o.id === 'p-5'));
  fake.send({ type: 'interrupt', id: 'i-0001', cancelQueued: true });
  await fake.until((objs) => objs.filter((o) => o.type === 'turn.end').length === 5);
  const tail = fake.lines.map((l) => l.obj).slice(-2);
  assert.deepEqual(tail, [{ type: 'interrupted', id: 'i-0001', stillQueued: [], cancelled: ['p-6'] }, { type: 'turn.end', state: 'stopped' }]);

  fake.child.stdin.end();
  assert.deepEqual(await fake.exited, { code: 0, signal: null });
  const log = fakeAgentLog(dir);
  const [start] = log.starts();
  assert.deepEqual([start.session, start.resumed], [session, true]);
  const p1 = log.prompts()[0];
  assert.deepEqual([p1.uuid, p1.words, p1.turn], ['p-1', 'search the wiki', 'one-bridge#1']);
  assert.equal('text' in log.lines().find((l) => l.kind === 'stdin').line, false, 'the text is in the prompt line only');
  assert.deepEqual(log.interrupts().map((l) => [l.requestId, l.cancelQueued, l.cancelled]), [['i-0001', true, ['p-6']]]);
  assert.deepEqual(log.order('interrupt', 'stdin-end'), ['interrupt', 'stdin-end']);
  assert.deepEqual(log.toolResults().map((l) => l.result), [{ ok: true }]);
});

test('the bridge dialect: start.allowlist null leaves it out, an array is sent as it is', async (t) => {
  for (const [allowlist, want] of [[null, undefined], [['mcp__laneboard__*', 'shell'], ['mcp__laneboard__*', 'shell']]]) {
    const dir = tempDir(t);
    const fake = startFake(t, dir, { name: 'one-bridge', start: { allowlist }, turns: [] }, ['--dialect', 'bridge'],
      { env: { LANEBOARD_ALLOWED_TOOLS: '["mcp__laneboard__*"]' } });
    await fake.until((objs) => objs.length > 0);
    assert.deepEqual(fake.lines[0].obj.allowlist, want);
    assert.equal('allowlist' in fake.lines[0].obj, want !== undefined);
    assert.equal(fake.lines[0].obj.canCancelQueued, false);
    fake.child.stdin.end();
    await fake.exited;
  }
});
