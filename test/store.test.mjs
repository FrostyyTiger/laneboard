// Client store with N builders (fleet F8a, plan §1 2.5): pure reducers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, ingest, applySnapshot, applyDelta, applyBuilders, setSourceKind, setSourceStatus,
  setKeyMode, setHello, migratePins, toIndexKey, sessionFor, builders, lanes, alarms, subscribe,
  attentionOrder, LOCAL_FALLBACK_ID, CLIENT_LIMITS,
} from '../public/js/core/store.js';
import { createSource, termPath, PREKIND_BUFFER_MAX } from '../public/js/core/net.js';

function hubStore() {
  const s = createStore();
  setSourceKind(s, 'hub');
  return s;
}
function localStore(id = 'builder-a') {
  const s = createStore();
  ingest(s, { type: 'hello', builder: { id, code: 'BA' }, mode: 'builder', version: '1.0.0', apiVersion: 1 });
  return s;
}

test('two builders with a session of the same name do not collide', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'main', state: 'working' }] });
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [{ name: 'main', state: 'idle' }] });
  assert.deepEqual([...s.sessions.keys()].sort(), ['b1/main', 'b2/main']);
  assert.equal(s.sessions.get('b1/main').state, 'working');
  assert.equal(s.sessions.get('b2/main').state, 'idle');
  assert.equal(s.builders.get('b1').sessions.get('main').builder, 'b1');
  assert.equal(s.builders.get('b2').sessions.get('main').key, 'b2/main');
});

test('a delta removes by fkey(builder, name) and upserts by name', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'main' }, { name: 'web' }] });
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [{ name: 'main' }] });
  const r = ingest(s, { type: 'delta', builder: 'b1', removed: ['main'], sessions: [{ name: 'web', state: 'done' }] });
  assert.deepEqual([...s.sessions.keys()].sort(), ['b1/web', 'b2/main'], 'b2/main survives the b1 removal');
  assert.equal(s.sessions.get('b1/web').state, 'done');
  assert.deepEqual(r.changed, ['b1/web']);
  assert.equal(s.builders.get('b1').sessions.has('main'), false);
});

test('a snapshot replaces only its own builder', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'a' }, { name: 'b' }] });
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [{ name: 'a' }] });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'c' }] });
  assert.deepEqual([...s.sessions.keys()].sort(), ['b1/c', 'b2/a']);
});

test('attention merges across builders: live first, score desc, since asc', () => {
  const s = hubStore();
  ingest(s, { type: 'fleet', builders: [{ id: 'b1', state: 'up' }, { id: 'b2', state: 'up' }, { id: 'b3', state: 'down' }] });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [], attention: [
    { name: 'x', score: 50, since: 300 }, { name: 'y', score: 90, since: 100 },
  ] });
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [], attention: [
    { name: 'z', score: 50, since: 200 }, { name: 'w', score: 90, since: 50 },
  ] });
  ingest(s, { type: 'snapshot', builder: 'b3', sessions: [], attention: [{ name: 'top', score: 999, since: 1 }] });
  assert.deepEqual(s.attention.map((a) => a.key), ['b2/w', 'b1/y', 'b2/z', 'b1/x', 'b3/top']);
  assert.equal(s.attention.at(-1).stale, true, 'a down builder sorts last, greyed');
  assert.ok(attentionOrder({ score: 1, since: 1, builder: 'a' }, { score: 1, since: 1, builder: 'b' }) < 0, 'ties break by builder');
});

test('migratePins turns legacy names into local fleet keys and keeps fkeys', () => {
  assert.deepEqual(migratePins('["a","b/x"]', 'builder-a'), ['builder-a/a', 'b/x']);
  assert.deepEqual(migratePins('["a","a",""]', 'builder-a'), ['builder-a/a']);
  assert.deepEqual(migratePins('not json', 'builder-a'), []);
  assert.deepEqual(migratePins('{"a":1}', 'builder-a'), []);
  assert.deepEqual(migratePins('["a"]', 'Bad Id'), []);
});

// --- S2: routing identity only from the source -------------------------------

test('S2: a b1 snapshot claiming b2 keys is stored under b1', () => {
  const s = hubStore();
  ingest(s, {
    type: 'snapshot', builder: 'b1',
    sessions: [{ name: 'x', lane: 'l1', key: 'b2/x', builder: 'b2', laneKey: 'b2/y', fkey: 'b2/x' }],
    lanes: [{ id: 'l1', key: 'b2/l1', builder: 'b2' }],
    attention: [{ name: 'x', score: 10, key: 'b2/x', builder: 'b2' }],
  });
  assert.deepEqual([...s.sessions.keys()], ['b1/x']);
  const sess = s.sessions.get('b1/x');
  assert.equal(sess.builder, 'b1');
  assert.equal(sess.key, 'b1/x');
  assert.equal(sess.laneKey, 'b1/l1');
  assert.equal('fkey' in sess, false);
  assert.equal(s.builders.has('b2'), false, 'no builder record is created from a nested field');
  assert.deepEqual(s.lanes.map((l) => [l.key, l.builder]), [['b1/l1', 'b1']]);
  assert.deepEqual(s.attention.map((a) => [a.key, a.builder]), [['b1/x', 'b1']]);
});

test('S2: a session without a lane gets laneKey null even if it claims one', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'x', laneKey: 'b2/y' }] });
  assert.equal(s.sessions.get('b1/x').laneKey, null);
});

test('S2: a local source routes every frame to its hello id, whatever the frame says', () => {
  const s = localStore('builder-a');
  ingest(s, { type: 'snapshot', builder: 'builder-b', sessions: [{ name: 'x', builder: 'builder-b', key: 'builder-b/x' }] });
  ingest(s, { type: 'delta', builder: 'evil', sessions: [{ name: 'y' }] });
  assert.deepEqual([...s.sessions.keys()].sort(), ['builder-a/x', 'builder-a/y']);
  assert.deepEqual([...s.builders.keys()], ['builder-a']);
});

test('S2: hub frames without a valid frame-level builder are dropped', () => {
  const s = hubStore();
  assert.equal(ingest(s, { type: 'snapshot', sessions: [{ name: 'x', builder: 'b1' }] }), null);
  assert.equal(ingest(s, { type: 'snapshot', builder: 'Bad Id', sessions: [{ name: 'x' }] }), null);
  assert.equal(ingest(s, { type: 'delta', builder: { id: 'b1' }, sessions: [{ name: 'x' }] }), null);
  assert.equal(s.sessions.size, 0);
  assert.equal(s.builders.size, 0);
});

test('S2: events, approvals and stuck are keyed from the frame builder', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'x' }] });
  const ev = ingest(s, { type: 'event', builder: 'b1', event: { session_name: 'x', key: 'b2/x', builder: 'b2', kind: 'Stop' } });
  assert.equal(ev.event.key, 'b1/x');
  assert.equal(ev.event.builder, 'b1');
  ingest(s, { type: 'approval', builder: 'b1', op: 'open', approval: { id: 'ap1', name: 'x', builder: 'b2', key: 'b2/x' } });
  const ap = s.builders.get('b1').approvals.get('ap1');
  assert.equal(ap.builder, 'b1');
  assert.equal(ap.key, 'b1/x');
  ingest(s, { type: 'approval', builder: 'b1', op: 'close', approval: { id: 'ap1', name: 'x' } });
  assert.equal(s.builders.get('b1').approvals.size, 0);
  const st = ingest(s, { type: 'stuck', builder: 'b1', name: 'x', key: 'b2/x', stuck: { rule: 'tool-loop' } });
  assert.deepEqual(st.changed, ['b1/x']);
  assert.equal(s.sessions.get('b1/x').stuck.rule, 'tool-loop');
});

test('names that are not non-empty strings are dropped', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: '' }, { name: 7 }, null, { name: 'ok' }], lanes: [{ id: '' }, { id: 'l' }] });
  assert.deepEqual([...s.sessions.keys()], ['b1/ok']);
  assert.deepEqual(s.lanes.map((l) => l.key), ['b1/l']);
});

// --- builders and status -------------------------------------------------------

test('fleet rows map state onto Builder.status and drop unlisted builders', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'gone', sessions: [{ name: 'x' }] });
  ingest(s, {
    type: 'fleet', hub: { version: '1.0.0', now: 1 }, aggregates: { counts: {} },
    builders: [
      { id: 'b1', code: 'B1', state: 'up', controls: true, capabilities: ['actions'], ageMs: 5 },
      { id: 'b2', state: 'stale' }, { id: 'b3', state: 'down' }, { id: 'b4', state: 'connecting' },
      { id: 'b5', state: 'misconfigured' }, { id: 'b6', state: 'incompatible' }, { id: 'Bad Id', state: 'up' },
    ],
  });
  const st = Object.fromEntries(builders(s).map((b) => [b.id, b.status]));
  assert.deepEqual(st, { b1: 'live', b2: 'stale', b3: 'down', b4: 'connecting', b5: 'down', b6: 'stale' });
  assert.equal(s.sessions.has('gone/x'), false, 'an unlisted builder leaves the index');
  assert.equal(s.builders.get('b1').controls, true);
  assert.equal(s.builders.get('b2').controls, false);
  assert.deepEqual(s.builders.get('b1').capabilities, ['actions']);
  assert.equal(s.hub.version, '1.0.0');
  assert.deepEqual(s.aggregates, { counts: {} });
});

test('a local source: builder status mirrors the connection', () => {
  const s = localStore();
  setSourceStatus(s, 'open');
  assert.equal(s.builders.get('builder-a').status, 'live');
  assert.equal(s.connected, true);
  setSourceStatus(s, 'closed');
  assert.equal(s.builders.get('builder-a').status, 'down');
  assert.equal(s.source.status, 'closed');
  assert.equal(s.connected, false);
});

test('a hub source: one builder down does not touch the source status', () => {
  const s = hubStore();
  setSourceStatus(s, 'open');
  ingest(s, { type: 'fleet', builders: [{ id: 'b1', state: 'up' }, { id: 'b2', state: 'down' }] });
  assert.equal(s.source.status, 'open');
  assert.equal(s.connected, true);
  assert.equal(s.builders.get('b2').status, 'down');
});

test('frames before hello sit under the fallback id; hello renames the source', () => {
  const s = createStore();
  ingest(s, { type: 'snapshot', sessions: [{ name: 'x' }] });
  assert.deepEqual([...s.sessions.keys()], [`${LOCAL_FALLBACK_ID}/x`]);
  ingest(s, { type: 'hello', builder: { id: 'builder-a', code: 'BA' } });
  assert.deepEqual([...s.builders.keys()], ['builder-a']);
  assert.equal(s.sessions.size, 0, 'the snapshot after hello refills it');
  ingest(s, { type: 'snapshot', builder: 'builder-a', sessions: [{ name: 'x' }] });
  assert.deepEqual([...s.sessions.keys()], ['builder-a/x']);
  assert.equal(s.builders.get('builder-a').code, 'BA');
});

test('a hello on a hub source is ignored', () => {
  const s = hubStore();
  assert.equal(ingest(s, { type: 'hello', builder: { id: 'b1' } }), null);
  assert.equal(s.source.id, null);
});

test('setHello keeps capabilities and the live tier table', () => {
  const s = localStore();
  setHello(s, { capabilities: ['snapshot', 'actions', 7], actions: { kill: 'confirm' }, mode: 'builder' });
  assert.deepEqual(s.source.hello.capabilities, ['snapshot', 'actions']);
  assert.equal(s.source.hello.actions.kill, 'confirm');
  assert.deepEqual(s.builders.get('builder-a').capabilities, ['snapshot', 'actions']);
});

test('common fields: lanes, box, vitals, generatedAt; health and repos per builder', () => {
  const s = localStore();
  ingest(s, { type: 'snapshot', sessions: [], lanes: [{ id: 'l1' }], box: { a: 1 }, vitals: { host: 'builder-a' }, generatedAt: 42 });
  assert.deepEqual(s.box, { a: 1 });
  assert.equal(s.boxDirty, true);
  assert.equal(s.vitals.host, 'builder-a');
  assert.equal(s.builders.get('builder-a').host, 'builder-a');
  assert.equal(s.generatedAt, 42);
  ingest(s, { type: 'delta', sessions: [{ name: 'n' }] });
  assert.deepEqual(s.lanes.map((l) => l.key), ['builder-a/l1'], 'a delta without lanes keeps them');
  ingest(s, { type: 'health', health: { ok: true } });
  assert.deepEqual(s.builders.get('builder-a').health, { ok: true });
  ingest(s, { type: 'repos', repo: 'acme', data: { n: 1 } });
  assert.deepEqual(s.builders.get('builder-a').repos.get('acme'), { n: 1 });
});

test('alarms, packages and map are global', () => {
  const s = hubStore();
  ingest(s, { type: 'alarms', alarms: [{ id: 'a1' }] });
  ingest(s, { type: 'packages', data: { rows: [] } });
  ingest(s, { type: 'map', map: { nodes: [] } });
  assert.deepEqual(alarms(s), [{ id: 'a1' }]);
  assert.deepEqual(s.packages, { rows: [] });
  assert.deepEqual(s.map, { nodes: [] });
});

test('selectors: builders sorted, lanes by scope', () => {
  const s = hubStore();
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [], lanes: [{ id: 'x' }] });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [], lanes: [{ id: 'x' }, { id: 'y' }] });
  assert.deepEqual(builders(s).map((b) => b.id), ['b1', 'b2']);
  assert.equal(lanes(s).length, 3);
  assert.deepEqual(lanes(s, 'b1').map((l) => l.key), ['b1/x', 'b1/y']);
  assert.deepEqual(lanes(s, 'all').length, 3);
});

test('subscribe sees every change and can unsubscribe', () => {
  const s = hubStore();
  const seen = [];
  const off = subscribe((c) => seen.push(c.type), s);
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [] });
  setSourceStatus(s, 'open');
  off();
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [] });
  assert.deepEqual(seen, ['snapshot', 'status']);
  subscribe(() => { throw new Error('boom'); }, s);
  assert.doesNotThrow(() => ingest(s, { type: 'snapshot', builder: 'b1', sessions: [] }));
});

test('junk messages are dropped', () => {
  const s = hubStore();
  for (const m of [null, 'x', 7, {}, { type: 3 }, { type: 'nonsense', builder: 'b1' }]) assert.equal(ingest(s, m), null);
});

// --- key mode (bridge for the current UI) ------------------------------------

test("keyMode 'name' keys the index by local name; setKeyMode converts", () => {
  const s = createStore({ keyMode: 'name' });
  ingest(s, { type: 'hello', builder: { id: 'builder-a' } });
  ingest(s, { type: 'snapshot', sessions: [{ name: 'x' }, { name: 'y' }] });
  assert.deepEqual([...s.sessions.keys()], ['x', 'y']);
  assert.equal(s.sessions.get('x').key, 'builder-a/x', 'entries still carry their fleet key');
  ingest(s, { type: 'delta', removed: ['x'] });
  assert.deepEqual([...s.sessions.keys()], ['y']);
  assert.equal(toIndexKey(s, 'builder-a/y'), 'y');
  assert.equal(toIndexKey(s, 'builder-b/y'), null);
  s.cursor = 'y';
  s.pinned = new Set(['y', 'old']);
  setKeyMode(s, 'fkey');
  assert.deepEqual([...s.sessions.keys()], ['builder-a/y']);
  assert.equal(s.cursor, 'builder-a/y');
  assert.deepEqual([...s.pinned], ['builder-a/y', 'builder-a/old']);
  assert.equal(toIndexKey(s, 'builder-a/y'), 'builder-a/y');
  assert.equal(sessionFor(s, 'builder-a/y').name, 'y');
});

test('a hub source always keys by fleet key', () => {
  const s = createStore({ keyMode: 'name' });
  setSourceKind(s, 'hub');
  assert.equal(s.keyMode, 'fkey');
});

test('applySnapshot/applyDelta refuse a bad builder id', () => {
  const s = createStore();
  assert.equal(applySnapshot(s, '../x', { sessions: [] }), null);
  assert.equal(applyDelta(s, '', { sessions: [] }), null);
  assert.equal(applyBuilders(s, 'nope'), null);
});

// ---------------------------------------------------------------- SR8 lows

test('SR8 L1: prototype names in BuilderRow.state map to down, not to an inherited member', () => {
  const s = hubStore();
  applyBuilders(s, [
    { id: 'b1', state: 'constructor' }, { id: 'b2', state: '__proto__' },
    { id: 'b3', state: 'toString' }, { id: 'b4', state: 'up' },
  ]);
  for (const id of ['b1', 'b2', 'b3']) {
    assert.equal(s.builders.get(id).status, 'down', id);
    assert.equal(s.builders.get(id).stale, true, id);
  }
  assert.equal(s.builders.get('b4').status, 'live');
});

test('SR8 L1: hello.actions keeps only own string entries in a null-prototype table', () => {
  const s = localStore();
  setHello(s, JSON.parse('{"actions":{"kill":"click","__proto__":"read","x":{"y":1}}}'));
  const t = s.source.hello.actions;
  assert.equal(Object.getPrototypeOf(t), null);
  assert.equal(t.kill, 'click');
  assert.equal(t.x, undefined);
  assert.equal(t.constructor, undefined);
  assert.equal({}.polluted, undefined);
});

test('SR8 L2: termPath refuses dot-segment names (null = terminal unavailable)', () => {
  assert.equal(termPath('hub', 'b1/..'), null);
  assert.equal(termPath('hub', 'b1/.'), null);
  assert.equal(termPath('local', 'b1/..'), null);
  assert.equal(termPath('local', '..'), null);
  assert.equal(termPath('local', '.'), null);
  assert.equal(termPath('hub', '..'), null);
  assert.equal(termPath('hub', 'b1/...'), '/ws/term/b1/...');
  assert.equal(termPath('hub', 'b1/a/..'), '/ws/term/b1/a%2F..');
  assert.equal(termPath('hub', 'b1/x'), '/ws/term/b1/x');
  assert.equal(termPath('local', 'web'), '/ws/term/web');
  const u = new URL(termPath('hub', 'b1/a/..'), 'http://example.invalid');
  assert.equal(u.pathname, '/ws/term/b1/a%2F..');
});

test('SR8 L3: per-builder caps drop and count extra sessions, lanes, attention, approvals, repos and events', () => {
  const s = hubStore();
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  ingest(s, {
    type: 'snapshot', builder: 'b1',
    sessions: many(CLIENT_LIMITS.sessions + 5, (i) => ({ name: `s${i}` })),
    lanes: many(CLIENT_LIMITS.lanes + 3, (i) => ({ id: `l${i}` })),
    attention: many(CLIENT_LIMITS.attention + 2, (i) => ({ name: `s${i}` })),
    approvals: many(CLIENT_LIMITS.approvals + 4, (i) => ({ id: `a${i}` })),
  });
  const b = s.builders.get('b1');
  assert.equal(b.sessions.size, CLIENT_LIMITS.sessions);
  assert.equal(b.lanes.length, CLIENT_LIMITS.lanes);
  assert.equal(b.attention.length, CLIENT_LIMITS.attention);
  assert.equal(b.approvals.size, CLIENT_LIMITS.approvals);
  assert.deepEqual({ ...b.dropped }, { sessions: 5, lanes: 3, attention: 2, approvals: 4, repos: 0, events: 0 });
  // Delta: a new name is dropped at the cap, an update of a known one is not,
  // and a removal in the same delta makes room.
  ingest(s, { type: 'delta', builder: 'b1', sessions: [{ name: 'new1' }, { name: 's0', state: 'done' }] });
  assert.equal(b.sessions.has('new1'), false);
  assert.equal(b.sessions.get('s0').state, 'done');
  assert.equal(b.dropped.sessions, 6);
  ingest(s, { type: 'delta', builder: 'b1', removed: ['s1'], sessions: [{ name: 'new2' }] });
  assert.equal(b.sessions.has('new2'), true);
  assert.equal(b.sessions.size, CLIENT_LIMITS.sessions);
  // Approval frames.
  assert.equal(ingest(s, { type: 'approval', builder: 'b1', op: 'open', approval: { id: 'extra' } }), null);
  assert.equal(b.approvals.has('extra'), false);
  assert.ok(ingest(s, { type: 'approval', builder: 'b1', op: 'open', approval: { id: 'a0', name: 's0' } }));
  assert.equal(b.dropped.approvals, 5);
  // Repos.
  for (let i = 0; i < CLIENT_LIMITS.repos + 2; i++) ingest(s, { type: 'repos', builder: 'b1', repo: `r${i}`, data: {} });
  assert.equal(b.repos.size, CLIENT_LIMITS.repos);
  assert.equal(b.dropped.repos, 2);
  assert.ok(ingest(s, { type: 'repos', builder: 'b1', repo: 'r0', data: { x: 1 } }), 'a known repo still updates');
  // Events: at most eventsPerSec per builder per second; other builders unaffected.
  let passed = 0;
  for (let i = 0; i < CLIENT_LIMITS.eventsPerSec + 7; i++) {
    if (ingest(s, { type: 'event', builder: 'b1', event: { session_name: 's0' } }, 10_000 + i)) passed += 1;
  }
  assert.equal(passed, CLIENT_LIMITS.eventsPerSec);
  assert.equal(b.dropped.events, 7);
  assert.ok(ingest(s, { type: 'event', builder: 'b2', event: { session_name: 'x' } }, 10_010));
  assert.ok(ingest(s, { type: 'event', builder: 'b1', event: { session_name: 's0' } }, 11_001), 'the next second has room');
  // Over-long names are not stored.
  ingest(s, { type: 'snapshot', builder: 'b3', sessions: [{ name: 'x'.repeat(CLIENT_LIMITS.nameChars + 1) }, { name: 'ok' }] });
  assert.deepEqual([...s.builders.get('b3').sessions.keys()], ['ok']);
});

test('SR8 L4: before hello a local store files frames under the fallback, never the claimed builder', () => {
  const s = createStore();
  ingest(s, { type: 'snapshot', builder: 'b2', sessions: [{ name: 'x' }] });
  assert.deepEqual([...s.builders.keys()], [LOCAL_FALLBACK_ID]);
  assert.deepEqual([...s.sessions.keys()], [`${LOCAL_FALLBACK_ID}/x`]);
});

function fakeSockets() {
  const all = [];
  function FakeWS(url) {
    const ls = {};
    const sock = {
      url, readyState: 0, sent: [],
      addEventListener: (t, fn) => { (ls[t] ||= []).push(fn); },
      send: (d) => sock.sent.push(d),
      close: () => { for (const fn of ls.close || []) fn({}); },
      emit: (t, ev) => { for (const fn of ls[t] || []) fn(ev); },
      frame: (obj) => sock.emit('message', { data: JSON.stringify(obj) }),
    };
    all.push(sock);
    return sock;
  }
  return { all, FakeWS };
}

test('SR8 L4: an auto source holds scoped frames until hello/fleet decides the kind', () => {
  const { all, FakeWS } = fakeSockets();
  const got = [];
  const src = createSource({ url: 'ws://example.invalid/ws', WebSocketImpl: FakeWS, schedule: () => {}, onMessage: (m, so) => got.push([m.type, so.kind]) });
  const ws = all[0];
  ws.frame({ type: 'snapshot', builder: 'b2', sessions: [{ name: 'x' }] });
  ws.frame({ type: 'event', builder: 'b2', event: {} });
  assert.deepEqual(got, [], 'nothing routed before the kind is known');
  assert.equal(src.kind, 'auto');
  ws.frame({ type: 'fleet', builders: [{ id: 'b2', state: 'up' }] });
  assert.deepEqual(got, [['fleet', 'hub'], ['snapshot', 'hub'], ['event', 'hub']]);
  ws.frame({ type: 'delta', builder: 'b2' });
  assert.deepEqual(got.at(-1), ['delta', 'hub']);
  src.close();
});

test('SR8 L4: the pre-kind buffer is bounded, counted, and cleared on close', () => {
  const { all, FakeWS } = fakeSockets();
  const got = [];
  const src = createSource({ url: 'ws://example.invalid/ws', WebSocketImpl: FakeWS, schedule: () => {}, onMessage: (m) => got.push(m) });
  for (let i = 0; i < PREKIND_BUFFER_MAX + 10; i++) all[0].frame({ type: 'delta', builder: 'b1', seq: i });
  assert.equal(src.pending.length, PREKIND_BUFFER_MAX);
  assert.equal(src.droppedBeforeKind, 10);
  all[0].close();
  assert.equal(src.pending.length, 0, 'a dead socket\'s frames are not replayed');
  assert.equal(got.length, 0);
  // A local source (hello first) is not buffered after hello.
  const loc = createSource({ url: 'ws://example.invalid/ws', WebSocketImpl: FakeWS, schedule: () => {}, onMessage: (m, so) => got.push([m.type, so.kind]) });
  const ws = all.at(-1);
  ws.frame({ type: 'hello', builder: { id: 'builder-a' } });
  ws.frame({ type: 'snapshot', sessions: [] });
  assert.deepEqual(got, [['hello', 'local'], ['snapshot', 'local']]);
  src.close();
  loc.close();
});

test('SR8 L4: an auto source passes builder-less legacy frames straight through', () => {
  const { all, FakeWS } = fakeSockets();
  const got = [];
  const src = createSource({ url: 'ws://example.invalid/ws', WebSocketImpl: FakeWS, schedule: () => {}, onMessage: (m, so) => got.push([m.type, so.kind]) });
  all[0].frame({ type: 'snapshot', sessions: [] });
  all[0].frame({ type: 'snapshot', builder: null, sessions: [] });
  all[0].frame({ type: 'snapshot', builder: 'b9', sessions: [] });
  assert.deepEqual(got, [['snapshot', 'auto'], ['snapshot', 'auto']]);
  assert.equal(src.pending.length, 1);
  src.close();
});
