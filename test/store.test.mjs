// Client store with N builders (fleet F8a, plan §1 2.5): pure reducers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, ingest, applySnapshot, applyDelta, applyBuilders, setSourceKind, setSourceStatus,
  setKeyMode, setHello, migratePins, toIndexKey, sessionFor, builders, lanes, alarms, subscribe,
  attentionOrder, LOCAL_FALLBACK_ID,
} from '../public/js/core/store.js';

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
