import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetStore, compareVersions, snapshotOf, sanitize, LIMITS } from '../server/hub/fleet-store.mjs';
import { fkey } from '../server/fleet/keys.mjs';

const T0 = 1_000_000;

function mk(extra = {}) {
  return createFleetStore({
    builders: [{ id: 'b1', url: 'https://b1.example.invalid' }, { id: 'b2', url: 'https://b2.example.invalid', code: 'XY' }],
    hubVersion: '0.1.0',
    staleMs: 15_000,
    downMs: 60_000,
    ...extra,
  });
}

const sess = (name, extra = {}) => ({ name, state: 'working', ...extra });
const snapMsg = (sessions, extra = {}) => ({ type: 'snapshot', seq: 1, sessions, lanes: [], box: null, vitals: null, attention: [], generatedAt: T0, ...extra });

function protoClean() {
  // Nothing may have been added to Object.prototype by ingest.
  const probe = {};
  for (const k of ['polluted', 'x', 'admin', 'state', 'name']) assert.equal(probe[k], undefined, `Object.prototype.${k}`);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), PROTO_NAMES);
}
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();

test('snapshot then delta merges like app.js (upsert, remove, replace lanes/box)', () => {
  const st = mk();
  const r1 = st.applySnapshot('b1', snapMsg([sess('a'), sess('b')], { lanes: [{ id: 'l1' }], box: { n: 1 } }), T0);
  assert.deepEqual(r1, { changed: ['a', 'b'], removed: [] });
  const r2 = st.applyDelta('b1', { type: 'delta', seq: 2, sessions: [sess('a', { state: 'done' }), sess('c')], removed: ['b'], lanes: [{ id: 'l2' }], box: { n: 2 } }, T0 + 1);
  assert.deepEqual(r2.changed, ['a', 'c']);
  assert.deepEqual(r2.removed, ['b']);
  assert.equal(r2.lanes, true);
  assert.equal(r2.box, true);
  const e = st.builder('b1');
  assert.ok(e.snap.sessions instanceof Map);
  assert.deepEqual([...e.snap.sessions.keys()], ['a', 'c']);
  assert.equal(e.snap.sessions.get('a').state, 'done');
  assert.deepEqual(e.snap.lanes.map((l) => l.id), ['l2']);
  assert.deepEqual(e.snap.box, { n: 2 });
  assert.equal(e.seq, 2);
  // A delta without lanes/box keeps them.
  st.applyDelta('b1', { type: 'delta', seq: 3, sessions: [] }, T0 + 2);
  assert.deepEqual(e.snap.lanes.map((l) => l.id), ['l2']);
  assert.deepEqual(e.snap.box, { n: 2 });
  // A second snapshot replaces and reports removals.
  const r3 = st.applySnapshot('b1', snapMsg([sess('z')]), T0 + 3);
  assert.deepEqual(r3, { changed: ['z'], removed: ['a', 'c'] });
  const wire = snapshotOf(e);
  assert.ok(Array.isArray(wire.sessions));
  assert.equal(wire.sessions[0].name, 'z');
});

test('removed followed by re-add keeps the session', () => {
  const st = mk();
  st.applySnapshot('b1', snapMsg([sess('a')]), T0);
  st.applyDelta('b1', { type: 'delta', removed: ['a'] }, T0 + 1);
  assert.equal(st.builder('b1').snap.sessions.has('a'), false);
  st.applyDelta('b1', { type: 'delta', sessions: [sess('a')] }, T0 + 2);
  assert.equal(st.builder('b1').snap.sessions.has('a'), true);
});

test('delta before any snapshot is ignored and counted', () => {
  const st = mk();
  const r = st.applyDelta('b1', { type: 'delta', sessions: [sess('a')] }, T0);
  assert.equal(r.ignored, 'no-snapshot');
  assert.equal(st.builder('b1').snap, null);
  assert.equal(st.builder('b1').dropped.noSnapshot, 1);
});

test('unknown builder ids are refused', () => {
  const st = mk();
  assert.equal(st.applySnapshot('b9', snapMsg([sess('a')]), T0), null);
  assert.equal(st.applyDelta('b9', { sessions: [] }, T0), null);
  assert.equal(st.applyEvent('b9', { type: 'event', event: {} }, T0), null);
  assert.equal(st.setConn('b9', { state: 'up' }), false);
  assert.equal(st.builder('b9'), null);
  assert.throws(() => createFleetStore({ builders: [{ id: 'Bad Id' }] }), TypeError);
  assert.throws(() => createFleetStore({ builders: [{ id: 'a' }, { id: 'a' }] }), TypeError);
});

test('preview and previewHtml are stripped, strings clamped, previewLines clamped', () => {
  const st = mk();
  const long = 'x'.repeat(10_000);
  const lines = Array.from({ length: 20 }, (_, i) => `${i}:` + 'y'.repeat(1000));
  st.applySnapshot('b1', snapMsg([sess('a', {
    preview: ['raw'], previewHtml: '<b>x</b>', previewLines: [...lines, 42], title: long,
    nested: { previewHtml: '<i>', deep: { s: long } },
  })]), T0);
  const s = st.builder('b1').snap.sessions.get('a');
  assert.equal('preview' in s, false);
  assert.equal('previewHtml' in s, false);
  assert.equal('previewHtml' in s.nested, false);
  assert.equal(s.title.length, LIMITS.string);
  assert.equal(s.nested.deep.s.length, LIMITS.string);
  assert.equal(s.previewLines.length, 8);
  assert.ok(s.previewLines.every((l) => typeof l === 'string' && l.length <= 400));
  assert.ok(s.previewLines[7].startsWith('19:'), 'keeps the last lines');
  // Same rules on a delta.
  st.applyDelta('b1', { type: 'delta', sessions: [sess('a', { previewHtml: '<b>', preview: 'p', title: long })] }, T0 + 1);
  const d = st.builder('b1').snap.sessions.get('a');
  assert.equal('previewHtml' in d, false);
  assert.equal('preview' in d, false);
  assert.equal(d.title.length, LIMITS.string);
});

test('a snapshot with more than 500 sessions is rejected; the old one stays', () => {
  const st = mk();
  st.applySnapshot('b1', snapMsg([sess('keep')]), T0);
  const many = Array.from({ length: 501 }, (_, i) => sess(`s${i}`));
  const r = st.applySnapshot('b1', snapMsg(many), T0 + 1);
  assert.equal(r.rejected, 'too-many-sessions');
  assert.deepEqual([...st.builder('b1').snap.sessions.keys()], ['keep']);
  assert.equal(st.builder('b1').dropped.snapshots, 1);
  // Exactly 500 is fine.
  const ok = st.applySnapshot('b1', snapMsg(many.slice(0, 500)), T0 + 2);
  assert.equal(ok.changed.length, 500);
});

test('delta session cap: the map never grows past 500', () => {
  const st = mk();
  st.applySnapshot('b1', snapMsg(Array.from({ length: 499 }, (_, i) => sess(`s${i}`))), T0);
  const r = st.applyDelta('b1', { sessions: [sess('n1'), sess('n2'), sess('n3'), sess('s0', { state: 'done' })] }, T0 + 1);
  const e = st.builder('b1');
  assert.equal(e.snap.sessions.size, 500);
  assert.deepEqual(r.changed, ['n1', 's0']);
  assert.equal(e.dropped.sessions, 2);
  // An oversize delta array is cut at 500 entries.
  const big = Array.from({ length: 700 }, (_, i) => sess(`s${i % 499}`));
  st.applyDelta('b1', { sessions: big }, T0 + 2);
  assert.equal(e.dropped.sessions, 2 + 200);
});

test('caps hold on snapshot and delta: attention 200, approvals 100, lanes 200', () => {
  const st = mk();
  const att = Array.from({ length: 201 }, (_, i) => ({ name: `s${i}`, state: 'waiting', score: i }));
  const apps = Array.from({ length: 101 }, (_, i) => ({ id: `ap-${i}`, tool: 'Bash' }));
  const lanes = Array.from({ length: 201 }, (_, i) => ({ id: `lane-${i}` }));
  st.applySnapshot('b1', snapMsg([], { attention: att, approvals: apps, lanes }), T0);
  const e = st.builder('b1');
  assert.equal(e.snap.attention.length, 200);
  assert.equal(e.snap.approvals.length, 100);
  assert.equal(e.snap.lanes.length, 200);
  assert.deepEqual({ a: e.dropped.attention, p: e.dropped.approvals, l: e.dropped.lanes }, { a: 1, p: 1, l: 1 });
  st.applyDelta('b1', { attention: att, approvals: apps, lanes }, T0 + 1);
  assert.equal(e.snap.attention.length, 200);
  assert.equal(e.snap.approvals.length, 100);
  assert.equal(e.snap.lanes.length, 200);
  assert.deepEqual({ a: e.dropped.attention, p: e.dropped.approvals, l: e.dropped.lanes }, { a: 2, p: 2, l: 2 });
  // approval 'open' events respect the cap too.
  st.applyEvent('b1', { type: 'approval', op: 'open', approval: { id: 'ap-extra' } }, T0 + 2);
  assert.equal(e.snap.approvals.length, 100);
  assert.equal(e.dropped.approvals, 3);
});

test('25 events in one second from one builder: 20 pass, 5 dropped', () => {
  const st = mk();
  st.applySnapshot('b1', snapMsg([]), T0);
  let passed = 0;
  const seen = [];
  st.subscribe((ev) => { if (ev.kind === 'event') seen.push(ev); });
  for (let i = 0; i < 25; i++) if (st.applyEvent('b1', { type: 'event', event: { n: i } }, T0 + i * 10)) passed++;
  assert.equal(passed, 20);
  assert.equal(seen.length, 20);
  assert.equal(st.builder('b1').dropped.events, 5);
  // Per builder: b2 is unaffected.
  assert.ok(st.applyEvent('b2', { type: 'event', event: {} }, T0 + 300));
  // A second later the window has moved on.
  assert.ok(st.applyEvent('b1', { type: 'event', event: {} }, T0 + 1000));
});

test('bad session names and lane ids are dropped and counted; Object.prototype unchanged', () => {
  const st = mk();
  const raw = JSON.parse(`{"type":"snapshot","sessions":[
    {"name":"__proto__","polluted":1},
    {"name":"constructor","state":"x"},
    {"name":"prototype"},
    {"name":"../x"},
    {"name":"a/b"},
    {"name":""},
    {"name":42},
    {"name":"ok","__proto__":{"polluted":true},"constructor":{"prototype":{"admin":1}},"lane":"Bad Lane"}
  ],"lanes":[{"id":"good"},{"id":"Bad"},{"id":"../up"},{"id":"__proto__"},{"id":"a..b"},{"id":"ok-2","branch":"--evil"}],
  "attention":[{"name":"__proto__","score":1},{"name":"ok","score":2}],
  "repos":{"__proto__":{"x":1},"constructor":{},"good-repo":{"n":1}},
  "box":{"__proto__":{"admin":true},"a":{"constructor":{"prototype":{"x":1}}}}}`);
  st.applySnapshot('b1', raw, T0);
  const e = st.builder('b1');
  assert.deepEqual([...e.snap.sessions.keys()], ['ok']);
  const ok = e.snap.sessions.get('ok');
  assert.equal(Object.getPrototypeOf(ok), Object.prototype);
  assert.equal(Object.hasOwn(ok, '__proto__'), false);
  assert.equal(Object.hasOwn(ok, 'constructor'), false);
  assert.equal(ok.lane, null, 'invalid lane reference nulled');
  assert.deepEqual(e.snap.lanes.map((l) => l.id), ['good', 'ok-2']);
  assert.equal(e.snap.lanes[1].branch, null, 'invalid branch nulled');
  assert.deepEqual(e.snap.attention.map((a) => a.name), ['ok']);
  assert.ok(e.snap.repos instanceof Map);
  assert.deepEqual([...e.snap.repos.keys()], ['good-repo']);
  assert.equal(Object.hasOwn(e.snap.box, '__proto__'), false);
  assert.equal(Object.hasOwn(e.snap.box.a, 'constructor'), false);
  // 7 bad session names + 4 bad lane ids + lane ref + branch + 1 attention + 2 repos
  assert.equal(e.dropped.names, 7 + 4 + 1 + 1 + 1 + 2);
  protoClean();
  // Same on a delta.
  st.applyDelta('b1', JSON.parse('{"sessions":[{"name":"__proto__","x":1},{"name":"constructor"}],"removed":["__proto__","constructor","ok"]}'), T0 + 1);
  assert.equal(e.snap.sessions.size, 0);
  protoClean();
});

test('S2: routing fields from a builder are dropped; fkey is the connection id + name', () => {
  const st = mk();
  const raw = JSON.parse(`{"type":"snapshot","builder":"b2","sessions":[
    {"name":"x","key":"b2/x","laneKey":"b2/y","fkey":"b2/x","builder":"b2","session":"b2/x","lane":"y",
     "nested":{"key":"b2/z","builder":"b2"}},
    {"name":"__proto__","key":"b2/__proto__"}
  ],"lanes":[{"id":"y","key":"b2/y","builder":"b2"}],
  "attention":[{"name":"x","key":"b2/x","builder":"b2","score":1}],
  "approvals":[{"id":"ap1","builder":"b2","name":"x","key":"b2/x"}]}`);
  st.applySnapshot('b1', raw, T0);
  const e = st.builder('b1');
  assert.equal(st.builder('b2').snap, null, 'nothing lands on b2');
  const s = e.snap.sessions.get('x');
  for (const k of ['key', 'laneKey', 'fkey', 'builder', 'session']) assert.equal(k in s, false, k);
  assert.equal(s.nested.key, undefined);
  assert.equal(s.nested.builder, undefined);
  assert.equal(s.lane, 'y', 'lane (a local name) is kept');
  assert.equal('key' in e.snap.lanes[0] || 'builder' in e.snap.lanes[0], false);
  assert.equal('key' in e.snap.attention[0] || 'builder' in e.snap.attention[0], false);
  assert.equal('builder' in e.snap.approvals[0] || 'key' in e.snap.approvals[0], false);
  assert.equal(e.snap.sessions.has('__proto__'), false);
  const found = st.session(fkey('b1', 'x'));
  assert.equal(found.builder, 'b1');
  assert.equal(found.session.name, 'x');
  assert.equal(st.session('b2/x'), null);
  assert.equal(st.session('nonsense'), null);
  // Events: event.key, approval.builder, stuck.key are dropped too.
  const ev = st.applyEvent('b1', { type: 'event', builder: 'b2', event: { key: 'b2/x', builder: 'b2', name: 'x' } }, T0);
  assert.deepEqual(ev, { type: 'event', event: { name: 'x' } });
  const ap = st.applyEvent('b1', { type: 'approval', op: 'open', approval: { id: 'ap2', builder: 'b2' } }, T0);
  assert.equal('builder' in ap.approval, false);
  const sk = st.applyEvent('b1', { type: 'stuck', name: 'x', key: 'b2/x', stuck: { rule: 'r', key: 'b2/x' } }, T0);
  assert.deepEqual(sk, { type: 'stuck', name: 'x', stuck: { rule: 'r' } });
  // A delta claiming b2 also stays on b1.
  st.applyDelta('b1', { builder: 'b2', sessions: [{ name: 'y', builder: 'b2', key: 'b2/y' }] }, T0 + 1);
  assert.equal(st.session('b1/y').builder, 'b1');
  assert.equal(st.builder('b2').snap, null);
});

test('non-object input and odd values are handled', () => {
  const st = mk();
  assert.equal(st.applySnapshot('b1', null, T0), null);
  assert.equal(st.applySnapshot('b1', [], T0), null);
  assert.equal(st.applySnapshot('b1', { sessions: 'nope' }, T0).rejected, 'no-sessions');
  st.applySnapshot('b1', snapMsg([null, 5, 'x', [], sess('a', { n: NaN, i: Infinity, f: () => 1, u: undefined })]), T0);
  const a = st.builder('b1').snap.sessions.get('a');
  assert.equal(a.n, null);
  assert.equal(a.i, null);
  assert.equal('f' in a, false);
  assert.equal('u' in a, false);
  assert.equal(st.builder('b1').snap.sessions.size, 1);
  // Depth is bounded.
  let deep = { v: 1 };
  for (let i = 0; i < 50; i++) deep = { d: deep };
  const c = sanitize(deep);
  let depth = 0;
  for (let x = c; x && typeof x === 'object'; x = x.d) depth++;
  assert.ok(depth <= LIMITS.depth);
  // Wide arrays and objects are bounded.
  const wide = sanitize({ arr: Array.from({ length: 5000 }, () => 1), obj: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i])) });
  assert.equal(wide.arr.length, LIMITS.arrayItems);
  assert.equal(Object.keys(wide.obj).length, LIMITS.objectKeys);
  // Unknown event types are dropped.
  assert.equal(st.applyEvent('b1', { type: 'map', map: {} }, T0), null);
  assert.equal(st.applyEvent('b1', { type: 'alarms', alarms: [] }, T0), null);
});

test('version skew: semver triple compare', () => {
  assert.equal(compareVersions('0.1.0', '0.1.3'), 'patch');
  assert.equal(compareVersions('0.1.0', '1.0.0'), 'major');
  assert.equal(compareVersions('0.1.0', '0.2.0'), 'minor');
  assert.equal(compareVersions('0.1.0', '0.1.0'), 'same');
  assert.equal(compareVersions('v1.2.3-rc1', '1.2.3'), 'same');
  assert.equal(compareVersions('garbage', '1.0.0'), null);
  assert.equal(compareVersions(null, '1.0.0'), null);
  const st = mk();
  st.setConn('b1', { state: 'up', hello: { version: '0.1.3', apiVersion: 1, capabilities: ['launch', '<bad>'], code: 'Q1' } });
  const e = st.builder('b1');
  assert.equal(e.versionSkew, 'patch');
  assert.equal(e.code, 'Q1', 'hello.code used when config has none');
  assert.deepEqual(e.hello.capabilities, ['launch']);
  st.setConn('b2', { state: 'up', hello: { version: '1.0.0', code: 'ZZ' } });
  assert.equal(st.builder('b2').versionSkew, 'major');
  assert.equal(st.builder('b2').code, 'XY', 'configured code wins');
  const v = st.view(T0);
  assert.equal(v.builders[1].controls, false, 'major skew disables controls');
});

test('hello is sanitized into Maps and validated lists', () => {
  const st = mk();
  const hello = JSON.parse('{"version":"<script>","apiVersion":1,"actions":{"__proto__":"click","kill":"confirm","x":"bogus","send-text":"click"},"repos":["ok-repo","../evil","__proto__"],"code":"lower","time":5}');
  st.setConn('b1', { hello, clockSkewMs: 120 });
  const e = st.builder('b1');
  assert.equal(e.hello.version, null);
  assert.equal(e.versionSkew, null);
  assert.ok(e.hello.actions instanceof Map);
  assert.deepEqual([...e.hello.actions], [['kill', 'confirm'], ['send-text', 'click']]);
  assert.deepEqual(e.hello.repos, ['ok-repo']);
  assert.equal(e.code, 'B1', 'invalid hello.code falls back to deriveCode');
  assert.equal(e.clockSkewMs, 120);
  st.setConn('b1', { state: 'bogus', error: 'e'.repeat(1000) });
  assert.equal(e.conn.state, 'connecting');
  assert.equal(e.conn.error.length, 200);
  protoClean();
});

test('view() keeps the last snapshot for a down builder with a correct ageMs', () => {
  const st = mk();
  st.setConn('b1', { state: 'up', lastSeen: T0 });
  st.applySnapshot('b1', snapMsg([sess('a')]), T0);
  st.setConn('b1', { state: 'down', lastSeen: T0 });
  const v = st.view(T0 + 90_000);
  const b1 = v.builders[0];
  assert.equal(b1.id, 'b1');
  assert.equal(b1.state, 'down');
  assert.equal(b1.stale, true);
  assert.equal(b1.controls, false);
  assert.equal(b1.ageMs, 90_000);
  assert.equal(b1.snap.sessions.get('a').name, 'a');
  assert.deepEqual(v.builders.map((b) => b.id), ['b1', 'b2'], 'config order');
  assert.equal(v.builders[1].ageMs, null);
  assert.equal(v.builders[1].state, 'connecting');
  // Backstop: an 'up' builder silent past staleMs/downMs is reported stale/down.
  st.setConn('b1', { state: 'up', lastSeen: T0 });
  assert.equal(st.view(T0 + 1000).builders[0].state, 'up');
  assert.equal(st.view(T0 + 1000).builders[0].controls, true);
  assert.equal(st.view(T0 + 20_000).builders[0].state, 'stale');
  assert.equal(st.view(T0 + 61_000).builders[0].state, 'down');
  assert.deepEqual(st.list().map((e) => e.id), ['b1', 'b2']);
});

test('subscribe gets {builder, changed, removed}; unsubscribe stops it; a throwing listener is isolated', () => {
  const st = mk();
  const got = [];
  st.subscribe(() => { throw new Error('boom'); });
  const off = st.subscribe((ev) => got.push(ev));
  st.applySnapshot('b1', snapMsg([sess('a'), sess('b')]), T0);
  st.applyDelta('b1', { sessions: [sess('c')], removed: ['a'], vitals: { cpu: 1 } }, T0 + 1);
  st.setConn('b1', { state: 'up' });
  st.setConn('b1', { state: 'up' }); // no change, no event
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { builder: 'b1', kind: 'snapshot', changed: ['a', 'b'], removed: [] });
  assert.equal(got[1].builder, 'b1');
  assert.equal(got[1].kind, 'delta');
  assert.deepEqual(got[1].changed, ['c']);
  assert.deepEqual(got[1].removed, ['a']);
  assert.equal(got[1].vitals, true);
  assert.equal(got[2].kind, 'conn');
  assert.equal(st.stats().listenerErrors, 3);
  off();
  st.applyDelta('b1', { sessions: [sess('d')] }, T0 + 2);
  assert.equal(got.length, 3);
});

test('transitions are reported for deltas and not for a replacing snapshot', () => {
  const st = mk();
  const got = [];
  st.subscribe((ev) => got.push(ev));
  st.applySnapshot('b1', snapMsg([sess('a', { state: 'working' })]), T0);
  assert.equal(got[0].transitions, undefined);
  const r = st.applyDelta('b1', { sessions: [sess('a', { state: 'waiting' }), sess('n', { state: 'idle' })] }, T0 + 1);
  assert.deepEqual(r.transitions, [{ fkey: 'b1/a', from: 'working', to: 'waiting' }, { fkey: 'b1/n', from: null, to: 'idle' }]);
  assert.deepEqual(got[1].transitions, r.transitions);
  st.applyDelta('b1', { sessions: [sess('a', { state: 'waiting' })] }, T0 + 2);
  assert.equal(got[2].transitions, undefined, 'no state change, no transition');
  st.applySnapshot('b1', snapMsg([sess('a', { state: 'done' })]), T0 + 3);
  assert.equal(got[3].transitions, undefined);
});

test('applyEvent updates health, approvals by op, stuck, repos', () => {
  const st = mk();
  st.applySnapshot('b1', snapMsg([sess('a')]), T0);
  const e = st.builder('b1');
  st.applyEvent('b1', { type: 'health', health: { disk: 0.5 } }, T0);
  assert.deepEqual(e.snap.health, { disk: 0.5 });
  st.applyEvent('b1', { type: 'approval', op: 'open', approval: { id: 'p1', name: 'a', tool: 'Bash' } }, T0);
  st.applyEvent('b1', { type: 'approval', op: 'open', approval: { id: 'p1', name: 'a', tool: 'Edit' } }, T0);
  assert.equal(e.snap.approvals.length, 1);
  assert.equal(e.snap.approvals[0].tool, 'Edit');
  assert.equal(st.applyEvent('b1', { type: 'approval', op: 'weird', approval: { id: 'p2' } }, T0), null);
  assert.equal(st.applyEvent('b1', { type: 'approval', op: 'open', approval: { id: '__proto__' } }, T0), null);
  st.applyEvent('b1', { type: 'approval', op: 'close', approval: { id: 'p1' } }, T0);
  assert.equal(e.snap.approvals.length, 0);
  st.applyEvent('b1', { type: 'stuck', name: 'a', stuck: { rule: 'tool-loop', since: 1 } }, T0);
  assert.deepEqual(e.snap.sessions.get('a').stuck, { rule: 'tool-loop', since: 1 });
  st.applyEvent('b1', { type: 'stuck', name: 'a', stuck: null }, T0);
  assert.equal(e.snap.sessions.get('a').stuck, null);
  assert.equal(st.applyEvent('b1', { type: 'stuck', name: '__proto__', stuck: {} }, T0), null);
  st.applyEvent('b1', { type: 'repos', repo: 'acme', data: { rows: [1] } }, T0);
  assert.ok(e.snap.repos instanceof Map);
  assert.deepEqual(e.snap.repos.get('acme'), { rows: [1] });
  assert.equal(st.applyEvent('b1', { type: 'repos', repo: '__proto__', data: {} }, T0), null);
  assert.equal(st.applyEvent('b1', { type: 'repos', repo: '../x', data: {} }, T0), null);
  st.applyEvent('b1', { type: 'repos', repo: 'acme', data: null }, T0);
  assert.equal(e.snap.repos.has('acme'), false);
  for (let i = 0; i < LIMITS.repos + 3; i++) st.applyEvent('b1', { type: 'repos', repo: `r${i}`, data: {} }, T0 + 1000 + i);
  assert.equal(e.snap.repos.size, LIMITS.repos);
  assert.equal(snapshotOf(e).repos.r0 !== undefined, true);
  protoClean();
});
