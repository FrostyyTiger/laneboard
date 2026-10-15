// §7 O1: per-session signal ring, input/error hashes, cost samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as signals from '../server/collector/signals.mjs';

const { inputHash, errorHash, normaliseError, stableJson, note, recent, counters, sampleCost, costAt, prune } = signals;

test('errorHash ignores digits, so "line 42" and "line 43" hash the same', () => {
  assert.equal(errorHash('SyntaxError at line 42, col 7'), errorHash('SyntaxError at line 43, col 9'));
  assert.notEqual(errorHash('SyntaxError at line 42'), errorHash('TypeError at line 42'));
});

test('errorHash ignores absolute paths and hex', () => {
  assert.equal(errorHash('ENOENT: open "/home/builder-a/code/acme/a.txt"'), errorHash('ENOENT: open "/tmp/other/b.txt"'));
  assert.equal(errorHash('segfault at 0x7ffd1234abcd'), errorHash('segfault at 0xdeadbeef'));
  assert.equal(errorHash('commit 3f2a9c1b8e7d6f50 not found'), errorHash('commit a1b2c3d4e5f60718 not found'));
  assert.equal(normaliseError('Fail in /a/b/c.js:12 and ./rel/x.js'), 'fail in P:N and P');
});

test('errorHash lowercases, collapses whitespace and cuts to 400 chars', () => {
  assert.equal(errorHash('Boom   HAPPENED\n\there'), errorHash('boom happened here'));
  const a = 'e'.repeat(400);
  assert.equal(errorHash(a + 'x'), errorHash(a + 'y'));
  assert.equal(normaliseError('z'.repeat(1000)).length, 400);
});

test('errorHash is 12 hex chars, or null without text', () => {
  assert.match(errorHash('x'), /^[0-9a-f]{12}$/);
  assert.equal(errorHash(''), null);
  assert.equal(errorHash(null), null);
  assert.equal(errorHash('   '), null);
});

test('inputHash is the same regardless of key order, at any depth', () => {
  const a = inputHash('Edit', { file_path: '/x', edits: [{ old: 'a', new: 'b' }], opts: { b: 1, a: 2 } });
  const b = inputHash('Edit', { opts: { a: 2, b: 1 }, edits: [{ new: 'b', old: 'a' }], file_path: '/x' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(inputHash('Edit', { file_path: '/x' }), inputHash('Write', { file_path: '/x' }));
  assert.notEqual(inputHash('Bash', { command: 'ls' }), inputHash('Bash', { command: 'ls -l' }));
  // Array order is meaningful.
  assert.notEqual(inputHash('T', { a: [1, 2] }), inputHash('T', { a: [2, 1] }));
});

test('inputHash only looks at the first 4 KB of the stable JSON', () => {
  const long = 'x'.repeat(5000);
  assert.equal(inputHash('Write', { content: long + 'A' }), inputHash('Write', { content: long + 'B' }));
  assert.doesNotThrow(() => inputHash('T', undefined));
  const cyc = { a: 1 }; cyc.self = cyc;
  assert.doesNotThrow(() => inputHash('T', cyc));
  assert.equal(stableJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
});

test('the ring keeps the newest 64 events, oldest first', () => {
  signals._reset();
  for (let i = 0; i < 100; i++) note({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `c${i}` } }, i);
  const r = recent('s1');
  assert.equal(r.length, 64);
  assert.equal(r[0].t, 36);
  assert.equal(r.at(-1).t, 99);
  assert.deepEqual(Object.keys(r[0]).sort(), ['errHash', 'errText', 'ev', 'inHash', 't', 'tool']);
  assert.equal(counters('s1').tools, 100);
  // recent() returns copies.
  r[0].t = -1;
  assert.equal(recent('s1')[0].t, 36);
});

test('note records failures with hash and a one-line error, perms with a summary', () => {
  signals._reset();
  const f = note({ session_id: 's2', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'make' },
    tool_response: { error: 'make: *** [all] Error 2\n' + 'y'.repeat(300) } }, 10);
  assert.equal(f.errHash, errorHash('make: *** [all] Error 2\n' + 'y'.repeat(300)));
  assert.ok(f.errText.length <= 160 && !f.errText.includes('\n'));
  assert.equal(f.inHash, inputHash('Bash', { command: 'make' }));
  const m = note({ session_id: 's2', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', message: 'from message' }, 11);
  assert.equal(m.errText, 'from message');
  assert.equal(m.inHash, null);
  const p = note({ session_id: 's2', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } }, 12);
  assert.equal(p.summary, 'rm x');
  const n = note({ session_id: 's2', hook_event_name: 'Notification', matcher: 'idle_prompt', message: 'not an error' }, 13);
  assert.equal(n.kind, 'idle_prompt');
  assert.equal(n.errHash, null);
  assert.equal(note({ hook_event_name: 'Stop' }, 14), null);
  assert.equal(note(null, 14), null);
});

test('counters: fails, perms, denied, live subagents, compactions, lastEventAt', () => {
  signals._reset();
  const ev = (hook_event_name, t) => note({ session_id: 's3', hook_event_name }, t);
  ev('SubagentStart', 1); ev('SubagentStart', 2); ev('SubagentStop', 3);
  ev('PostToolUseFailure', 4); ev('PermissionRequest', 5); ev('PermissionDenied', 6);
  ev('PreCompact', 7); ev('PostCompact', 8); ev('PostCompact', 9);
  let c = counters('s3');
  assert.deepEqual(c, { tools: 0, fails: 1, perms: 1, denied: 1, subagentsLive: 1, compactions: [8, 9], lastEventAt: 9, lastSubagentAt: 3 });
  ev('SubagentStop', 10); ev('SubagentStop', 11);
  assert.equal(counters('s3').subagentsLive, 0, 'never negative');
  ev('SubagentStart', 12); ev('SessionEnd', 13);
  assert.equal(counters('s3').subagentsLive, 0, 'SessionEnd resets live subagents');
  for (let i = 0; i < 40; i++) ev('PostCompact', 100 + i);
  c = counters('s3');
  assert.equal(c.compactions.length, signals.COMPACTIONS_KEEP);
  assert.equal(c.compactions.at(-1), 139);
  c.compactions.push(1);
  assert.equal(counters('s3').compactions.length, signals.COMPACTIONS_KEEP, 'counters() returns a copy');
  assert.deepEqual(counters('unknown'), { tools: 0, fails: 0, perms: 0, denied: 0, subagentsLive: 0, compactions: [], lastEventAt: null, lastSubagentAt: null });
});

test('sampleCost keeps at most one sample per minute for 2 h; costAt finds the newest <= t', () => {
  signals._reset();
  const MIN = 60_000;
  assert.equal(sampleCost('s4', 1, 0), true);
  assert.equal(sampleCost('s4', 1.5, 30_000), false, 'within a minute');
  for (let i = 1; i <= 180; i++) sampleCost('s4', i, i * MIN);
  assert.equal(costAt('s4', 180 * MIN), 180);
  assert.equal(costAt('s4', 150 * MIN + 59_000), 150);
  assert.equal(costAt('s4', 59 * MIN), null, 'older than 2 h is dropped');
  assert.equal(costAt('s4', 60 * MIN), 60);
  assert.equal(costAt('nope', 1), null);
  assert.equal(sampleCost('s4', NaN, 999 * MIN), false);
  assert.equal(sampleCost(null, 1, 999 * MIN), false);
});

test('prune drops sessions that are no longer live', () => {
  signals._reset();
  note({ session_id: 'a', hook_event_name: 'Stop' }, 1);
  note({ session_id: 'b', hook_event_name: 'Stop' }, 1);
  sampleCost('c', 1, 1);
  prune(new Set(['b']));
  assert.deepEqual(signals.sessionIds(), ['b']);
  prune(['b']);
  assert.deepEqual(signals.sessionIds(), ['b']);
  prune();
  assert.deepEqual(recent('b'), []);
});
