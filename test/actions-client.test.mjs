// act() on the client (fleet F8a, plan §1 2.5, README §3.5): transport choice,
// envelope shape and routing from the store entry (security review S2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ingest, setHello, setSourceKind } from '../public/js/core/store.js';
import {
  ACTION_TIERS, createActions, legacyRequest, resolveTarget, tierOf, uuid, buildEnvelope,
} from '../public/js/core/actions.js';

function recorder(reply = { ok: true, status: 200, body: { ok: true, result: { done: 1 }, auditId: 'a1' } }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  };
  return { calls, fetchImpl };
}

function localStore({ v1 = false } = {}) {
  const s = createStore();
  ingest(s, { type: 'hello', builder: { id: 'b1', code: 'B1' } });
  if (v1) setHello(s, { capabilities: ['snapshot', 'actions'], actions: {} });
  return s;
}

const fixed = { newId: () => '00000000-0000-4000-8000-000000000000', now: () => 1234 };

test('S2: a b1 session claiming b2 keys yields an envelope addressed to b1', async () => {
  const s = localStore({ v1: true });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'x', key: 'b2/x', builder: 'b2', laneKey: 'b2/y' }] });
  assert.deepEqual([...s.sessions.keys()], ['b1/x']);
  const { calls, fetchImpl } = recorder();
  const { act } = createActions({ store: s, fetchImpl, ...fixed });
  const r = await act('b1/x', 'send-text', { text: 'hi', enter: true });
  assert.deepEqual(r, { ok: true, result: { done: 1 }, auditId: 'a1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/actions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-laneboard'], '1');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(calls[0].body, {
    v: 1, id: '00000000-0000-4000-8000-000000000000', ts: 1234, builder: 'b1',
    action: 'send-text', target: 'x', args: { text: 'hi', enter: true }, via: 'direct',
  });
});

test('S2: the claimed foreign key does not resolve to anything', async () => {
  const s = localStore({ v1: true });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'x', key: 'b2/x', builder: 'b2' }] });
  const { calls, fetchImpl } = recorder();
  const { act } = createActions({ store: s, fetchImpl, ...fixed });
  const r = await act('b2/x', 'kill', { confirm: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown-builder');
  assert.equal(calls.length, 0, 'nothing is sent');
});

test('S2 on a hub: the relay body is addressed from the frame builder', async () => {
  const s = createStore();
  setSourceKind(s, 'hub');
  ingest(s, { type: 'fleet', builders: [{ id: 'b1', state: 'up' }, { id: 'b2', state: 'up' }] });
  ingest(s, { type: 'snapshot', builder: 'b1', sessions: [{ name: 'x', key: 'b2/x', builder: 'b2' }] });
  const { calls, fetchImpl } = recorder();
  const { act, hubAct } = createActions({ store: s, fetchImpl, ...fixed });
  await act('b1/x', 'send-keys', { keys: ['Enter'] });
  assert.equal(calls[0].url, '/api/fleet/actions');
  assert.equal(calls[0].init.headers['x-laneboard'], '1');
  assert.deepEqual(calls[0].body, { builder: 'b1', action: 'send-keys', target: 'x', args: { keys: ['Enter'] } });
  await act('*', 'pause', { confirm: 'fleet' });
  assert.deepEqual(calls[1].body, { builder: '*', action: 'pause', target: '*', args: { confirm: 'fleet' } });
  await act('b2/*', 'pause', { confirm: 'b2' });
  assert.deepEqual(calls[2].body, { builder: 'b2', action: 'pause', target: '*', args: { confirm: 'b2' } });
  await hubAct({ builder: '*', action: 'broadcast', target: '*', args: { text: 't' } });
  assert.equal(calls[3].body.builder, '*');
  const r = await act('nobody/x', 'kill', {});
  assert.equal(r.code, 'unknown-builder');
  const bare = await act('x', 'kill', {});
  assert.equal(bare.code, 'bad-target', 'a hub needs a fleet key');
  assert.equal(calls.length, 4);
});

test('legacy REST routes before the builder lists the actions capability', async () => {
  const s = localStore();
  ingest(s, { type: 'snapshot', sessions: [{ name: 'my sess' }] });
  const { calls, fetchImpl } = recorder({ ok: true, status: 200, body: { sent: true } });
  const { act } = createActions({ store: s, fetchImpl, ...fixed });
  const r = await act('b1/my sess', 'send-keys', { keys: ['C-c'] });
  assert.deepEqual(r, { ok: true, result: { sent: true } });
  await act('b1/my sess', 'send-text', { text: 'go' });
  await act('b1/my sess', 'restart', { confirm: 'my sess' });
  await act('b1/my sess', 'kill', { confirm: 'my sess' });
  await act('b1/lane-1', 'retire', { confirm: 'lane-1' });
  await act('b1/42', 'dismiss-marker');
  await act('b1/lane-2', 'launch', { repo: 'acme', plan: 'p.md' });
  assert.deepEqual(calls.map((c) => [c.init.method, c.url, c.body]), [
    ['POST', '/api/sessions/my%20sess/keys', { keys: ['C-c'] }],
    ['POST', '/api/sessions/my%20sess/text', { text: 'go', enter: true }],
    ['POST', '/api/sessions/my%20sess/restart', {}],
    ['DELETE', '/api/sessions/my%20sess', undefined],
    ['DELETE', '/api/lanes/lane-1', undefined],
    ['DELETE', '/api/markers/42', undefined],
    ['POST', '/api/lanes', { repo: 'acme', plan: 'p.md' }],
  ]);
  for (const c of calls) assert.equal(c.init.headers['x-laneboard'], '1');
  const un = await act('b1/my sess', 'approve', { approvalId: 'a' });
  assert.equal(un.code, 'unsupported');
  assert.equal(calls.length, 7);
});

test("keyMode 'name': a local name resolves through the store entry", async () => {
  const s = createStore({ keyMode: 'name' });
  ingest(s, { type: 'hello', builder: { id: 'b1' } });
  ingest(s, { type: 'snapshot', sessions: [{ name: 'x', builder: 'b9' }] });
  assert.deepEqual(resolveTarget(s, 'x'), { builder: 'b1', target: 'x' });
  assert.deepEqual(resolveTarget(s, 'b1/x'), { builder: 'b1', target: 'x' });
  assert.deepEqual(resolveTarget(s, '*'), { builder: 'b1', target: '*' });
  assert.deepEqual(resolveTarget(s, ''), { error: 'bad-target' });
  assert.deepEqual(resolveTarget(s, null), { error: 'bad-target' });
});

test('errors: HTTP status, network failure, timeout, bad action', async () => {
  const s = localStore({ v1: true });
  ingest(s, { type: 'snapshot', sessions: [{ name: 'x' }] });
  let a = createActions({ store: s, ...fixed, ...recorder({ ok: false, status: 403, body: { ok: false, error: 'control-disabled', code: 'control-disabled' } }) });
  assert.deepEqual(await a.act('b1/x', 'kill', { confirm: 'x' }), { ok: false, error: 'control-disabled', code: 'control-disabled' });
  a = createActions({ store: s, ...fixed, ...recorder({ ok: false, status: 500, body: null }) });
  assert.deepEqual(await a.act('b1/x', 'kill', {}), { ok: false, error: 'HTTP 500', code: 500 });
  a = createActions({ store: s, ...fixed, ...recorder(new TypeError('Failed to fetch')) });
  assert.deepEqual(await a.act('b1/x', 'kill', {}), { ok: false, error: 'Failed to fetch', code: 'network' });
  const t = new Error('timed out'); t.name = 'TimeoutError';
  a = createActions({ store: s, ...fixed, ...recorder(t) });
  assert.deepEqual(await a.act('b1/x', 'kill', {}), { ok: 'unknown', error: 'timeout' });
  a = createActions({ store: s, ...fixed, ...recorder({ ok: false, status: 504, body: { ok: 'unknown', error: 'timeout' } }) });
  assert.deepEqual(await a.act('b1/x', 'kill', {}), { ok: 'unknown', error: 'timeout' });
  const rec = recorder();
  a = createActions({ store: s, ...fixed, ...rec });
  assert.equal((await a.act('b1/x', 'Bad Action!', {})).code, 'bad-action');
  assert.equal(rec.calls.length, 0);
});

test('every request carries a timeout signal', async () => {
  const s = localStore({ v1: true });
  ingest(s, { type: 'snapshot', sessions: [{ name: 'x' }] });
  const rec = recorder();
  await createActions({ store: s, ...fixed, ...rec }).act('b1/x', 'interrupt', {});
  assert.ok(rec.calls[0].init.signal, 'AbortSignal.timeout is attached');
});

test('tiers: the live hello table wins, the README table is the fallback', () => {
  const s = localStore();
  assert.equal(tierOf('kill', s), 'confirm');
  assert.equal(tierOf('send-text', s), 'click');
  assert.equal(tierOf('unheard-of', s), 'confirm', 'an unknown action gets the strictest tier');
  setHello(s, { capabilities: [], actions: { 'send-text': 'ask', kill: 'bogus' } });
  assert.equal(tierOf('send-text', s), 'ask');
  assert.equal(tierOf('kill', s), 'confirm', 'an invalid live tier falls back');
  for (const a of ['send-text', 'send-keys', 'interrupt', 'kill', 'restart', 'spawn', 'launch', 'retire', 'term',
    'pause', 'resume', 'approve', 'deny', 'release', 'set-budget', 'ack-alarm', 'send-review', 'run-script', 'broadcast']) {
    assert.ok(['read', 'click', 'ask', 'confirm'].includes(ACTION_TIERS[a]), `${a} has a tier`);
  }
  assert.equal(Object.isFrozen(ACTION_TIERS), true);
});

test('helpers: uuid shape, envelope, legacy map', () => {
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(buildEnvelope({ builder: 'b1', action: 'kill', target: 'x', id: 'i', ts: 1 }),
    { v: 1, id: 'i', ts: 1, builder: 'b1', action: 'kill', target: 'x', args: {}, via: 'direct' });
  assert.equal(legacyRequest('kill', '*'), null, 'kill * has no legacy route');
  assert.equal(legacyRequest('pause', 'x'), null);
  assert.equal(legacyRequest('send-keys', 'a/b').url, '/api/sessions/a%2Fb/keys');
});
