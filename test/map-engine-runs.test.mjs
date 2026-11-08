import test from 'node:test';
import assert from 'node:assert/strict';
import { engineRunNodes } from '../server/map/runs.mjs';

const nodes = [{ id: 'heavy-1', label: 'heavy-1', kind: 'host' }, { id: 'room-a', label: 'room-a', kind: 'room' }];
const run = (o) => ({ id: 'R-1', key: 'main/R-1', product: 'acme-shop', goal: 'G1', goalTitle: 'Checkout', state: 'running', rooms: [], ...o });
const one = (o, opts) => engineRunNodes([run(o)], { nodes, ...opts })[0];

test('a run hangs on its room by name, then by host', () => {
  assert.equal(one({ rooms: [{ name: 'room-a', host: 'heavy-1', state: 'up' }] }).parent, 'room-a');
  assert.equal(one({ rooms: [{ name: 'gone', host: 'heavy-1', state: 'up' }] }).parent, 'heavy-1');
});

test('an ended room does not place a run; an unknown room says so', () => {
  assert.equal(one({ rooms: [{ name: 'room-a', state: 'ended' }] }).parent, '__core');
  const n = one({ rooms: [{ name: 'nope', state: 'up' }] });
  assert.equal(n.parent, '__core');
  assert.match(n.detail.Rooms, /not on the Map/);
});

test('state gives the status; a gate says why; the link names the engine', () => {
  const n = one({ state: 'at-gate' });
  assert.equal(n.status, 'warn');
  assert.equal(n.why, 'waiting for a decision');
  assert.equal(n.href, '#/runs?run=main%2FR-1');
  assert.equal(one({ state: 'stopped', stop: 'errors', endedAt: 1000 }, { now: 2000 }).status, 'crit');
});

test('a finished run leaves after keepMin; a taken id is skipped', () => {
  assert.equal(one({ state: 'done', endedAt: 0 }, { now: 3600_001 }), undefined);
  assert.ok(one({ state: 'done', endedAt: 0 }, { now: 60_000 }));
  assert.equal(one({}, { taken: new Set(['run:R-1']) }), undefined);
});
