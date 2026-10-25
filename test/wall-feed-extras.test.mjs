// Feed extras (Wall plan T2, docs/plans/wall/README.md D3): a feed may hang
// `glow: {rgb, level}` and `ring: {progress}` on a host, guest or service;
// server/map.mjs carries the valid ones onto the node and drops the rest.
// The Wall paints them; the app's Map ignores them (test/map.test.mjs is
// untouched by this change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFleet, parseTopology, feedExtras, feedProblem } from '../server/map.mjs';
import { DEMO_TOPOLOGY_LARGE, demoFeedsLarge, demoFeedHome, LARGE_PRINT_MS } from './helpers/demo-hub.mjs';

const NOW = 1_790_000_000_000;

const topology = () => parseTopology({
  nodes: [
    { id: 'house', kind: 'site', feed: 'home' },
    { id: 'lamp', parent: 'house', kind: 'room', feed: 'home/lamp' },
    { id: 'printer', parent: 'house', kind: 'room', feed: 'home/printer' },
    { id: 'job', parent: 'printer', kind: 'service', feed: 'home/printer/job' },
    { id: 'plain', parent: 'house', kind: 'room', feed: 'home/plain' },
  ],
});

const feed = (over = {}) => ({
  source: 'home',
  at: NOW,
  every: 30,
  host: { name: 'home', glow: { rgb: [10, 20, 30], level: 0.5 } },
  guests: [
    { name: 'lamp', type: 'device', status: 'running', glow: { rgb: [255, 200, 120], level: 0.8 } },
    { name: 'printer', type: 'device', status: 'running', ring: { progress: 0.42 },
      services: [{ name: 'job', status: 'working', ring: { progress: 0.42 }, glow: { rgb: [0, 255, 0] } }] },
    { name: 'plain', type: 'device', status: 'running' },
  ],
  ...over,
});

const model = (f, now = NOW) => buildFleet({ topology: topology(), feeds: new Map([['home', { ...f, receivedAt: now }]]), now, hostname: 'demo-host' });
const node = (m, id) => m.nodes.find((n) => n.id === id);

test('feed extras: valid glow and ring reach the host, guest and service nodes', () => {
  const m = model(feed());
  assert.deepEqual(node(m, 'house').glow, { rgb: [10, 20, 30], level: 0.5 });
  assert.deepEqual(node(m, 'lamp').glow, { rgb: [255, 200, 120], level: 0.8 });
  assert.deepEqual(node(m, 'printer').ring, { progress: 0.42 });
  assert.deepEqual(node(m, 'job').ring, { progress: 0.42 });
  // A glow without a level is at full brightness.
  assert.deepEqual(node(m, 'job').glow, { rgb: [0, 255, 0], level: 1 });
  assert.equal(node(m, 'plain').glow, undefined);
  assert.equal(node(m, 'plain').ring, undefined);
  // The extras do not change what the node says about itself.
  assert.equal(node(m, 'lamp').status, 'ok');
  assert.equal(node(m, 'job').status, 'working');
});

test('feed extras: the bounds are kept, 0 and 1 included', () => {
  assert.deepEqual(feedExtras({ glow: { rgb: [0, 0, 0], level: 0 }, ring: { progress: 0 } }), { glow: { rgb: [0, 0, 0], level: 0 }, ring: { progress: 0 } });
  assert.deepEqual(feedExtras({ glow: { rgb: [255, 255, 255], level: 1 }, ring: { progress: 1 } }), { glow: { rgb: [255, 255, 255], level: 1 }, ring: { progress: 1 } });
  // Only the known fields are kept: nothing else a feeder adds rides along.
  assert.deepEqual(feedExtras({ glow: { rgb: [1, 2, 3], level: 0.5, blink: true }, ring: { progress: 0.5, eta: 9 } }), { glow: { rgb: [1, 2, 3], level: 0.5 }, ring: { progress: 0.5 } });
  assert.deepEqual(feedExtras({}), {});
  assert.deepEqual(feedExtras(null), {});
});

test('feed extras: anything invalid is dropped whole', () => {
  const badGlows = [
    'red', [255, 0, 0], { rgb: [255, 0] }, { rgb: [255, 0, 0, 1] }, { rgb: [256, 0, 0] }, { rgb: [-1, 0, 0] },
    { rgb: [1.5, 0, 0] }, { rgb: ['255', 0, 0] }, { rgb: '#ff0000' }, { rgb: [255, 0, 0], level: 1.2 },
    { rgb: [255, 0, 0], level: -0.1 }, { rgb: [255, 0, 0], level: '0.5' }, { rgb: [255, 0, 0], level: Number.NaN }, { level: 0.5 },
  ];
  for (const glow of badGlows) assert.deepEqual(feedExtras({ glow }), {}, `glow ${JSON.stringify(glow)}`);
  const badRings = [0.5, 'half', {}, { progress: 1.01 }, { progress: -0.01 }, { progress: '0.5' }, { progress: Number.POSITIVE_INFINITY }, { progress: null }];
  for (const ring of badRings) assert.deepEqual(feedExtras({ ring }), {}, `ring ${JSON.stringify(ring)}`);
  // One bad extra does not take the other with it.
  assert.deepEqual(feedExtras({ glow: { rgb: [1, 2, 3] }, ring: { progress: 2 } }), { glow: { rgb: [1, 2, 3], level: 1 } });

  // Through the model: a bad extra drops, the node and its feed still load.
  const f = feed({
    host: { name: 'home', glow: { rgb: [300, 0, 0] } },
    guests: [
      { name: 'lamp', type: 'device', status: 'running', glow: { rgb: [255, 200], level: 0.8 } },
      { name: 'printer', type: 'device', status: 'running', ring: { progress: 4 }, services: [{ name: 'job', status: 'working', ring: 'soon' }] },
      { name: 'plain', type: 'device', status: 'running' },
    ],
  });
  assert.equal(feedProblem(f), null);
  const m = model(f);
  for (const id of ['house', 'lamp', 'printer', 'job']) {
    assert.equal(node(m, id).glow, undefined, `${id} glow`);
    assert.equal(node(m, id).ring, undefined, `${id} ring`);
  }
  assert.equal(node(m, 'lamp').status, 'ok');
});

test('feed extras: a stale feed shows no glow and no ring', () => {
  const later = NOW + 60 * 60_000;
  const m = model(feed(), later);
  assert.equal(node(m, 'lamp').status, 'unknown');
  assert.equal(node(m, 'lamp').glow, undefined);
  assert.equal(node(m, 'printer').ring, undefined);
});

test('large demo: the lights glow, the porch light is off, the printer ring advances', () => {
  const build = (now) => {
    const feeds = new Map(demoFeedsLarge(now).map((f) => [f.source, { ...f, receivedAt: now }]));
    return buildFleet({ topology: parseTopology(structuredClone(DEMO_TOPOLOGY_LARGE)), feeds, now, hostname: 'demo-host' });
  };
  const m = build(NOW);
  const glowing = m.nodes.filter((n) => n.glow).map((n) => n.id).sort();
  assert.deepEqual(glowing, ['desk-light', 'hall-light', 'kitchen-light', 'living-light']);
  assert.equal(node(m, 'porch-light').glow, undefined);
  assert.deepEqual(m.nodes.filter((n) => n.ring).map((n) => n.id), ['printer-3d']);
  for (const n of m.nodes.filter((x) => x.glow || x.ring)) assert.equal(n.status, 'ok', n.id);

  // The demo ticks every 4 s by default: the ring moves on each of them and
  // wraps when the job starts over.
  const p = (now) => node(build(now), 'printer-3d').ring.progress;
  const start = NOW - (NOW % LARGE_PRINT_MS);
  assert.equal(p(start), 0);
  assert.ok(p(start + 4000) > p(start), 'one tick later the print has advanced');
  assert.ok(p(start + 8000) > p(start + 4000));
  assert.ok(p(start + LARGE_PRINT_MS - 4000) > 0.98);
  assert.equal(p(start + LARGE_PRINT_MS), 0);
  // The job's own line says the same.
  const job = demoFeedHome(start + LARGE_PRINT_MS / 2).guests.find((g) => g.name === 'printer-3d').services[0];
  assert.equal(job.sub, 'printing · 50%');
});
