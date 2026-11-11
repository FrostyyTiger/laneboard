// The foreman's health above the Runs list, and what waits on a run's own row
// (docs/runs-health.md): the server's `foremanOf` and `runsBody`, the page's
// `healthLines`, `healthNode` and `gatesNode`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import * as fake from '../server/engine/fake.mjs';
import { BEAT_STALE_MS, BEAT_UP_MS, foremanOf, runsBody } from '../server/routes/engines.mjs';
import { blockedNode, engineNeedsYou, gatesNode, healthLines, healthNode, isBlocked, runControls, toListRow } from '../public/js/views/runs-engine.js';

const T = Date.parse('2026-11-11T12:00:00Z');
const answer = (lag, o = {}) => ({ ok: true, at: T, data: { heartbeatAt: T - lag, hosts: [{ id: 'steady', state: 'up' }], queue: 0, active: 1, windows: null }, ...o });

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}

test('foremanOf: up, stale and down by the heartbeat age on the engine clock; unknown without a fresh answer', () => {
  assert.equal(foremanOf(answer(5_000)).foreman, 'up');
  assert.equal(foremanOf(answer(BEAT_UP_MS)).foreman, 'up');
  assert.equal(foremanOf(answer(BEAT_UP_MS + 1)).foreman, 'stale');
  assert.equal(foremanOf(answer(BEAT_STALE_MS + 1)).foreman, 'down');
  assert.equal(foremanOf(answer(5_000)).beatAge, 5_000);
  const old = foremanOf(answer(5_000, { stale: true, age: 90_000, reason: 'timed out' }));
  assert.equal(old.foreman, 'unknown');
  assert.equal(old.reason, 'timed out');
  const none = foremanOf({ ok: false, code: 'engine-down', reason: 'cannot start' });
  assert.deepEqual([none.foreman, none.reason], ['unknown', 'cannot start']);
});

test('runsBody: each engine carries its foreman health, each run its own waiting items', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const h = b.engines[0].health;
  assert.equal(h.foreman, 'up');
  assert.equal(h.beatAge, 5_000);
  assert.equal(h.queue, 0);
  assert.deepEqual(h.windows.window5h, { usedPct: 40, resetsAt: Date.parse('2026-11-01T13:00:00Z'), known: true });
  const by = Object.fromEntries(b.runs.map((r) => [r.id, r.waiting.map((w) => w.kind)]));
  assert.deepEqual(by['R-20261101-acme-shop-1'], ['recipe', 'variant', 'change']);
  assert.deepEqual(by['R-20261029-acme-shop-1'], ['merge']);
  for (const r of b.runs) for (const w of r.waiting) assert.match(w.revision, /^sha256:[0-9a-f]{16}$/);
});

test('runsBody: a foreman that cannot be reached is unknown, and its runs still list', async () => {
  const e = fake.create({ id: 'main', override: { health: () => { throw new Error('no foreman'); } } });
  const b = await runsBody([e]);
  assert.equal(b.engines[0].health.foreman, 'unknown');
  assert.ok(b.runs.length > 0);
});

test('healthLines: the foreman, its heartbeat and hosts, an unknown usage window, and the live runs with their node', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const rows = b.runs.map(toListRow);
  b.engines[0].health.windows.window7d.known = false;
  const [l] = healthLines(b.engines, rows);
  assert.equal(l.foreman, 'up');
  assert.equal(l.p, 'ok');
  assert.match(l.text, /heartbeat 5s ago/);
  assert.match(l.text, /steady-1 up, heavy-1 up/);
  assert.match(l.text, /usage 5h 40% · 7d unknown/);
  assert.deepEqual(l.live.map((r) => r.text), ['R-20261101-acme-shop-1 running at G1.F1.T3', 'R-20261029-acme-shop-1 at gate']);
  assert.deepEqual(healthLines([{ id: 'x', health: null }]), []);
});

test('healthNode: says when no run is on', () => withDom(() => {
  const n = healthNode([{ engine: 'main', foreman: 'down', p: '1', text: 'heartbeat 9m ago', live: [] }]);
  const t = texts(n).join(' ');
  assert.match(t, /main: foreman down/);
  assert.match(t, /no run now/);
}));

test('gatesNode: kind, title, short revision and the board own buttons; a run with items needs you', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const row = toListRow(b.runs.find((r) => r.id === 'R-20261101-acme-shop-1'));
  assert.equal(engineNeedsYou(row), true);
  withDom(() => {
    const n = gatesNode(row);
    const t = texts(n).join(' ');
    assert.match(t, /recipe/);
    assert.match(t, /rev 8ed771e8/);
    assert.match(t, /Approve/);
    assert.match(t, /Reject/);
    assert.equal(gatesNode({ ...row, waiting: [] }), null);
  });
});

test('a blocked run (at a gate, nothing to decide) shows why, with Resume and Stop; a run with a gate does not', () => {
  const row = toListRow({ id: 'R-1', key: 'main/R-1', engine: 'main', state: 'at-gate', reason: 'blocked at G1.F1 (tests): the stack needs Docker', waiting: [] });
  assert.equal(isBlocked({ ...row, state: 'at-gate' }), true);
  assert.equal(isBlocked({ state: 'at-gate', gates: [{ state: 'open' }] }), false);
  assert.equal(isBlocked({ state: 'paused' }), false);
  assert.deepEqual(runControls('main/R-1', { state: 'at-gate', gates: [] }).map((p) => p.word), ['pause', 'resume', 'stop']);
  assert.deepEqual(runControls('main/R-1', { state: 'at-gate', gates: [{ state: 'open' }] }).map((p) => p.word), ['pause', 'stop']);
  withDom(() => {
    const t = texts(blockedNode(row)).join(' ');
    assert.match(t, /blocked/);
    assert.match(t, /the stack needs Docker/);
    assert.match(t, /Resume/);
    assert.match(t, /Stop/);
    assert.doesNotMatch(t, /Pause/);
    assert.equal(blockedNode({ ...row, waiting: [{ id: 'x' }] }), null);
    assert.equal(blockedNode(toListRow({ id: 'R-2', key: 'main/R-2', engine: 'main', state: 'running', waiting: [] })), null);
  });
});
