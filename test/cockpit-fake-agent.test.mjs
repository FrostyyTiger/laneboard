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
import { fakeAgentLog } from './cockpit/stand-ins/fake-agent-log.mjs';
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
function startFake(t, dir, script, args = CLAUDE_ARGS) {
  if (script) fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(script));
  const child = spawn(process.execPath, [FAKE, ...args], { env: childEnv(dir), stdio: ['pipe', 'pipe', 'pipe'] });
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

// --- §11.4's left column, read from the protocol (D136: the copy once the night made it) ---

function protocolText() {
  for (const rel of ['docs/cockpit/protocol.md', 'docs/plans/cockpit/spec/protocols.md']) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('no protocol file');
}

function nativeRows() {
  const text = protocolText();
  const from = text.indexOf('### 11.4 ');
  const to = text.indexOf('### 11.5 ', from);
  const rows = [];
  for (const line of text.slice(from, to).split('\n')) {
    const m = /^\| `(\{.*?\})` \|/.exec(line);
    if (m) rows.push(JSON.parse(m[1]));
  }
  return rows;
}

/** The fields that pick a row: type, subtype, the event and block types. */
function rowKey(o) {
  const c = Array.isArray(o.message?.content) ? o.message.content[0]?.type : undefined;
  return [o.type, o.subtype, o.isReplay === true, o.event?.type, o.event?.content_block?.type, o.event?.delta?.type, c].join('|');
}

/**
 * Every field of `row` is in `line` with the same kind of value (unknown extra
 * fields allowed). A tool's `input` is the tool's own: an object, nothing more.
 */
function hasShape(line, row, key) {
  if (row === null) return line === null;
  if (Array.isArray(row)) return Array.isArray(line) && (row.length === 0 || line.length === 0 || hasShape(line[0], row[0]));
  if (typeof row === 'object') {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    if (key === 'input') return true;
    return Object.keys(row).every((k) => k in line && hasShape(line[k], row[k], k));
  }
  return typeof line === typeof row;
}

// Lines §11.4 maps to nothing, listed in its prose row.
const NO_EVENT = new Set(['ping', 'message_delta', 'message_stop', 'content_block_stop']);

function assertRowShapes(objs) {
  const rows = nativeRows();
  assert.ok(rows.length >= 15, `read ${rows.length} rows of §11.4`);
  for (const o of objs) {
    if (o.type === 'stream_event' && NO_EVENT.has(o.event.type)) continue;
    const candidates = rows.filter((r) => rowKey(r) === rowKey(o));
    assert.ok(candidates.length, `no §11.4 row for ${JSON.stringify(o)}`);
    const ok = candidates.some((r) => {
      // `message_start` without `user_message_uuids` is the row's own "without either field" case.
      if (r.event?.type === 'message_start' && !o.user_message_uuids) { const { user_message_uuids, ...rest } = r; return hasShape(o, rest); }
      return hasShape(o, r);
    });
    assert.ok(ok, `line does not have its §11.4 row's shape: ${JSON.stringify(o)}\nrows: ${candidates.map((r) => JSON.stringify(r)).join('\n')}`);
  }
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
      { at: 1090, tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, endAt: 1640 },
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
  assert.deepEqual(log.order(), ['start', 'prompt', 'turn-end']);
  assert.deepEqual(log.order('stdin', 'prompt'), ['stdin', 'prompt']);
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
    { at: 0, tool: 'mcp__laneboard__fleet', input: { site: 'hv1' }, endAt: 300 },
    { at: 50, tool: 'mcp__laneboard__fleet', input: { site: 'hv2' }, endAt: 150, isError: true },
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
