import test from 'node:test';
import assert from 'node:assert/strict';

import { createLimiter, resolveRules, DEFAULT_RULES, MAX_FANOUT, PARENT_TTL_MS } from '../server/fleet/ratelimit.mjs';

function clock(start = 5_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

function takeN(lim, n, ...args) {
  for (let i = 0; i < n; i++) {
    const r = lim.take(...args);
    assert.deepEqual(r, { ok: true, retryAfterMs: 0 }, `take ${i + 1} of ${n}`);
  }
}

test('defaults match the plan table', () => {
  const expect = {
    'send-text': [30, 60000, 'target'], 'send-keys': [30, 60000, 'target'], interrupt: [30, 60000, 'target'],
    kill: [5, 60000, 'user'], restart: [5, 60000, 'user'], retire: [5, 60000, 'user'],
    'run-script': [5, 60000, 'user'], 'send-review': [5, 60000, 'user'],
    spawn: [3, 60000, 'user'], launch: [3, 60000, 'user'],
    fanout: [1, 10000, 'user'], all: [1, 10000, 'user'], global: [120, 60000, 'user'], hub: [300, 60000, 'any'],
  };
  assert.deepEqual(Object.keys(DEFAULT_RULES).sort(), Object.keys(expect).sort());
  for (const [name, [limit, windowMs, per]] of Object.entries(expect)) {
    assert.deepEqual({ ...DEFAULT_RULES[name] }, { limit, windowMs, per }, name);
  }
  assert.ok(Object.isFrozen(DEFAULT_RULES) && Object.isFrozen(DEFAULT_RULES.kill));
});

test('send-text: 30 per minute per (user, target), then 429 with retryAfterMs', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 30, 'alice', 'send-text', 'lane-1');
  assert.deepEqual(lim.take('alice', 'send-text', 'lane-1'), { ok: false, retryAfterMs: 2000, rule: 'send-text' });
  // other target and other user have their own buckets
  assert.equal(lim.take('alice', 'send-text', 'lane-2').ok, true);
  assert.equal(lim.take('bob', 'send-text', 'lane-1').ok, true);
  // send-keys is a separate rule
  assert.equal(lim.take('alice', 'send-keys', 'lane-1').ok, true);
  c.t += 1999;
  assert.equal(lim.take('alice', 'send-text', 'lane-1').retryAfterMs, 1);
  c.t += 1;
  assert.equal(lim.take('alice', 'send-text', 'lane-1').ok, true);
  assert.equal(lim.take('alice', 'send-text', 'lane-1').ok, false, 'refill is gradual, not a window reset');
});

test('a full window later the bucket is full again', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 5, 'alice', 'kill', 'a');
  assert.equal(lim.take('alice', 'kill', 'b').ok, false, 'kill is per user, any target');
  c.t += 60000;
  takeN(lim, 5, 'alice', 'kill', 'c');
  assert.equal(lim.take('alice', 'kill', 'c').ok, false);
});

test('kill/restart/retire/run-script/send-review 5, spawn/launch 3 per minute per user; separate rules', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (const a of ['kill', 'restart', 'retire', 'run-script', 'send-review']) {
    takeN(lim, 5, 'alice', a, 't');
    const r = lim.take('alice', a, 't');
    assert.equal(r.ok, false, a);
    assert.equal(r.rule, a);
    assert.equal(r.retryAfterMs, 12000);
  }
  for (const a of ['spawn', 'launch']) {
    takeN(lim, 3, 'alice', a, 't');
    assert.deepEqual(lim.take('alice', a, 't'), { ok: false, retryAfterMs: 20000, rule: a });
  }
});

test('target * : 1 per 10 s per user, on top of the action rule', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  assert.equal(lim.take('alice', 'pause', '*').ok, true);
  assert.deepEqual(lim.take('alice', 'resume', '*'), { ok: false, retryAfterMs: 10000, rule: 'all' });
  assert.equal(lim.take('alice', 'pause', 'lane-1').ok, true, 'non-* targets are not affected');
  assert.equal(lim.take('bob', 'interrupt', '*').ok, true);
  c.t += 10000;
  assert.equal(lim.take('alice', 'resume', '*').ok, true);
});

test('global: 120 actions per minute per user across actions', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (let i = 0; i < 120; i++) assert.equal(lim.take('alice', i % 2 ? 'pause' : 'send-text', `s${i}`).ok, true, `take ${i}`);
  assert.deepEqual(lim.take('alice', 'approve', 'x'), { ok: false, retryAfterMs: 500, rule: 'global' });
  assert.equal(lim.take('bob', 'approve', 'x').ok, true);
});

test('local is exempt from everything but the global cap', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 50, 'cli', 'kill', 'x', { kind: 'local' });
  takeN(lim, 10, 'cli', 'pause', '*', { kind: 'local' });
  takeN(lim, 60, 'cli', 'send-text', 'x', { kind: 'local' });
  assert.deepEqual(lim.take('cli', 'send-text', 'y', { kind: 'local' }), { ok: false, retryAfterMs: 500, rule: 'global' });
});

test('local and direct share the per-user global bucket', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 120, 'alice', 'pause', 'x', { kind: 'local' });
  assert.equal(lim.take('alice', 'pause', 'y').rule, 'global');
});

test('hub: 300 per minute across all hub traffic, whatever the user', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (let i = 0; i < 300; i++) assert.equal(lim.take(`u${i}`, 'pause', 'x', { kind: 'hub' }).ok, true, `take ${i}`);
  assert.deepEqual(lim.take('fresh', 'pause', 'x', { kind: 'hub' }), { ok: false, retryAfterMs: 200, rule: 'hub' });
  assert.equal(lim.take('fresh', 'pause', 'x', { kind: 'direct' }).ok, true, 'direct traffic is not in the hub bucket');
  assert.equal(lim.take('fresh', 'pause', 'x', { kind: 'local' }).ok, true);
});

test('hub requests are also bound by the per-user rules', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 5, 'alice', 'kill', 'x', { kind: 'hub' });
  assert.equal(lim.take('alice', 'kill', 'x', { kind: 'hub' }).rule, 'kill');
  assert.equal(lim.take('alice', 'kill', 'x', { kind: 'direct' }).rule, 'kill', 'same user, same bucket via either path');
});

test('refused takes consume nothing (all-or-nothing)', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 3, 'alice', 'spawn', 'a');
  for (let i = 0; i < 500; i++) assert.equal(lim.take('alice', 'spawn', 'a').ok, false);
  // the 500 refusals did not touch global: 117 more actions are still allowed
  takeN(lim, 117, 'alice', 'pause', 'a');
  assert.equal(lim.take('alice', 'pause', 'a').rule, 'global');
  c.t += 20000;
  assert.equal(lim.take('bob', 'spawn', 'a').ok, true);
});

test('a refusal on * does not charge the action bucket', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  assert.equal(lim.take('alice', 'kill', '*').ok, true);
  for (let i = 0; i < 10; i++) assert.equal(lim.take('alice', 'kill', '*').rule, 'all');
  takeN(lim, 4, 'alice', 'kill', 'x'); // 1 used by the first '*', 4 left
  assert.equal(lim.take('alice', 'kill', 'x').rule, 'kill');
});

test('retryAfterMs is the longest wait among the empty buckets', () => {
  const c = clock();
  const lim = createLimiter({ global: { limit: 1, windowMs: 1000 } }, c.now);
  assert.equal(lim.take('alice', 'kill', '*').ok, true);
  const r = lim.take('alice', 'kill', '*');
  assert.deepEqual(r, { ok: false, retryAfterMs: 10000, rule: 'all' });
  c.t += 1000;
  assert.equal(lim.take('alice', 'pause', 'x').ok, true, 'global refilled after its own window');
});

test('fan-out: the parent counts once', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  const P = '11111111-1111-4111-8111-111111111111';
  for (let i = 0; i < MAX_FANOUT; i++) {
    assert.equal(lim.take('alice', 'send-text', `s${i}`, { kind: 'hub', fanoutParent: P }).ok, true, `child ${i}`);
  }
  // a second parent within 10 s is refused
  const Q = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(lim.take('alice', 'send-text', 's0', { kind: 'hub', fanoutParent: Q }), { ok: false, retryAfterMs: 10000, rule: 'fanout' });
  // the 30 children cost one global token: 119 left
  takeN(lim, 119, 'alice', 'pause', 'x', { kind: 'hub' });
  assert.equal(lim.take('alice', 'pause', 'x', { kind: 'hub' }).rule, 'global');
  c.t += 10000;
  assert.equal(lim.take('alice', 'send-text', 's0', { kind: 'hub', fanoutParent: Q }).ok, true);
});

test('fan-out: at most MAX_FANOUT children ride on one parent', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  const P = 'p-1';
  takeN(lim, MAX_FANOUT, 'alice', 'send-text', 't', { fanoutParent: P });
  assert.equal(MAX_FANOUT, 30);
  // the 31st child is charged as a new parent, which the fanout rule refuses
  assert.equal(lim.take('alice', 'send-text', 'u', { fanoutParent: P }).rule, 'fanout');
});

test('fan-out children still hit their per-target bucket', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 30, 'alice', 'send-text', 'busy');
  const r = lim.take('alice', 'send-text', 'busy', { fanoutParent: 'p' });
  assert.equal(r.rule, 'send-text');
  // the refused first child did not register the parent nor spend the fanout token
  assert.equal(lim.take('alice', 'send-text', 'idle', { fanoutParent: 'p' }).ok, true);
  assert.equal(lim.take('alice', 'send-text', 'busy', { fanoutParent: 'p' }).rule, 'send-text');
});

test('fan-out parents are per user and forgotten after PARENT_TTL_MS', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  assert.equal(lim.take('alice', 'send-text', 'a', { fanoutParent: 'p' }).ok, true);
  // bob reusing alice's parent id gets no free ride: charged as his own first parent
  assert.equal(lim.take('bob', 'send-text', 'a', { fanoutParent: 'p' }).ok, true);
  assert.equal(lim.take('bob', 'send-text', 'b', { fanoutParent: 'p' }).ok, true, 'now held for bob');
  assert.equal(lim.take('bob', 'send-text', 'c', { fanoutParent: 'q' }).rule, 'fanout');
  c.t += PARENT_TTL_MS;
  assert.equal(lim.take('alice', 'send-text', 'b', { fanoutParent: 'p' }).ok, true, 'charged as a new parent; fanout refilled');
  assert.equal(lim.take('alice', 'send-text', 'c', { fanoutParent: 'r' }).rule, 'fanout', 'that re-charge spent the fanout token');
});

test('fanoutParent is ignored for other actions and for local', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 5, 'alice', 'kill', 'x', { fanoutParent: 'p' });
  assert.equal(lim.take('alice', 'kill', 'x', { fanoutParent: 'p' }).rule, 'kill');
  takeN(lim, 3, 'cli', 'send-text', 'x', { kind: 'local', fanoutParent: 'p' });
});

test('keys cannot collide through separators in user or target', () => {
  const c = clock();
  const lim = createLimiter({ 'send-text': { limit: 1 } }, c.now);
  assert.equal(lim.take('a', 'send-text', 'b,c').ok, true);
  assert.equal(lim.take('a,b', 'send-text', 'c').ok, true);
  assert.equal(lim.take('a","b', 'send-text', 'c').ok, true);
  assert.equal(lim.take('a', 'send-text', '","b","c').ok, true);
  assert.equal(lim.take('a\u0000b', 'send-text', 'c').ok, true);
  assert.equal(lim.take('a', 'send-text', 'b,c').ok, false);
});

test('prototype-ish action names fall back to the global rule only', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'global', 'hub', 'all', 'fanout']) {
    assert.equal(lim.take('alice', a, 'x').ok, true, a);
  }
  // an action named 'hub' from hub traffic is charged to the hub bucket once, not twice
  assert.equal(lim.take('bob', 'hub', 'x', { kind: 'hub' }).ok, true);
  for (let i = 0; i < 299; i++) assert.equal(lim.take(`u${i}`, 'pause', 'x', { kind: 'hub' }).ok, true, `take ${i}`);
  assert.equal(lim.take('carol', 'pause', 'x', { kind: 'hub' }).rule, 'hub');
});

test('unknown actions are bound by global (and hub, and *)', () => {
  const c = clock();
  const lim = createLimiter({ global: { limit: 2 } }, c.now);
  takeN(lim, 2, 'alice', 'approve', 'x');
  assert.equal(lim.take('alice', 'ack-alarm', 'y').rule, 'global');
});

test('overrides merge onto defaults and may add rules for other actions', () => {
  const r = resolveRules({ kill: { limit: 10 }, pause: { limit: 2, windowMs: 1000 }, approve: { limit: 1, windowMs: 5000, per: 'target' }, hub: { limit: 600 } });
  assert.deepEqual({ ...r.kill }, { limit: 10, windowMs: 60000, per: 'user' });
  assert.deepEqual({ ...r.pause }, { limit: 2, windowMs: 1000, per: 'user' });
  assert.deepEqual({ ...r.approve }, { limit: 1, windowMs: 5000, per: 'target' });
  assert.deepEqual({ ...r.hub }, { limit: 600, windowMs: 60000, per: 'any' });
  assert.equal(DEFAULT_RULES.kill.limit, 5, 'defaults untouched');
  const c = clock();
  const lim = createLimiter({ pause: { limit: 2, windowMs: 1000 } }, c.now);
  takeN(lim, 2, 'alice', 'pause', 'x');
  assert.deepEqual(lim.take('alice', 'pause', 'y'), { ok: false, retryAfterMs: 500, rule: 'pause' });
  assert.deepEqual(resolveRules(undefined), resolveRules({}));
});

test('invalid overrides throw instead of silently disabling a limit', () => {
  const bad = [
    [], 'x', 5,
    { kill: null }, { kill: 5 }, { kill: [] },
    { kill: { limit: 0 } }, { kill: { limit: -1 } }, { kill: { limit: 1.5 } }, { kill: { limit: '5' } },
    { kill: { limit: Infinity } }, { kill: { windowMs: 0 } }, { kill: { windowMs: NaN } },
    { kill: { per: 'any' } }, { kill: { per: 'nobody' } }, { kill: { limt: 5 } },
    { pause: { limit: 2 } }, // new rule without windowMs
    { hub: { per: 'user' } }, { global: { per: 'target' } },
    { 'Kill': { limit: 1 } }, { 'a b': { limit: 1, windowMs: 1 } },
    JSON.parse('{"__proto__": {"limit": 1, "windowMs": 1}}'),
  ];
  for (const o of bad) assert.throws(() => resolveRules(o), TypeError, JSON.stringify(o));
  assert.throws(() => createLimiter({ kill: { limit: 0 } }), TypeError);
});

test('invalid take arguments throw', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (const args of [
    [undefined, 'kill', 'x'], ['', 'kill', 'x'], [5, 'kill', 'x'],
    ['a', '', 'x'], ['a', null, 'x'], ['a', 'kill', ''], ['a', 'kill', undefined],
    ['a', 'kill', 'x', { kind: 'admin' }], ['a', 'send-text', 'x', { fanoutParent: 5 }], ['a', 'send-text', 'x', { fanoutParent: '' }],
  ]) assert.throws(() => lim.take(...args), TypeError, JSON.stringify(args));
  assert.equal(lim.take('a', 'kill', 'x', null).ok, true, 'null ctx = defaults');
  assert.throws(() => createLimiter(null, 'now'), TypeError);
  assert.throws(() => createLimiter(null, () => NaN).take('a', 'kill', 'x'), TypeError);
});

test('a clock stepping backwards never waits longer than one window', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  takeN(lim, 3, 'alice', 'spawn', 'x');
  c.t -= 3_600_000;
  const r = lim.take('alice', 'spawn', 'x');
  assert.equal(r.ok, false);
  assert.ok(r.retryAfterMs <= 60000 && r.retryAfterMs > 0, `retryAfterMs ${r.retryAfterMs}`);
  c.t += r.retryAfterMs;
  assert.equal(lim.take('alice', 'spawn', 'x').ok, true);
});

test('defaults to Date.now', () => {
  const lim = createLimiter();
  assert.equal(lim.take('alice', 'kill', 'x').ok, true);
});

test('memory: refilled buckets and expired parents are dropped', () => {
  const c = clock();
  const lim = createLimiter(null, c.now);
  for (let i = 0; i < 3000; i++) {
    lim.take(`u${i}`, 'send-text', `t${i}`, { fanoutParent: `p${i}` });
    c.t += 1;
  }
  assert.ok(lim.size() > 0);
  c.t += 60000;
  assert.equal(lim.size(), 0);
});
