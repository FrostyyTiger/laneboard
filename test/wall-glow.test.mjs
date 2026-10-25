// The Wall's glow layer (Wall plan T8, docs/plans/wall/README.md §3, D3):
// which nodes paint and how (a light's glow, a job's ring), the zoom the
// glows follow, and the driver that paints only while a node carries an extra.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  glowMarks, glowGeometry, ringGeometry, zoomAt, createGlow, GLOW_SIZE,
} from '../public/js/wall/glow.js';
import { SIZE } from '../public/js/views/map/layout.js';
import { buildFleet, parseTopology } from '../server/map.mjs';
import { DEMO_TOPOLOGY_LARGE, demoFeedsLarge } from './helpers/demo-hub.mjs';

test('glow: only nodes with a valid glow or ring paint; a light at level 0 is off', () => {
  const marks = glowMarks({
    nodes: [
      { id: 'hv1', kind: 'site', status: 'ok' },
      { id: 'desk', kind: 'room', glow: { rgb: [255, 214, 170], level: 0.9 } },
      { id: 'hall', kind: 'room', glow: { rgb: [255, 196, 137] } },
      { id: 'porch', kind: 'room', glow: { rgb: [255, 255, 255], level: 0 } },
      { id: 'bad-rgb', kind: 'room', glow: { rgb: [256, 0, 0], level: 1 } },
      { id: 'short-rgb', kind: 'room', glow: { rgb: [1, 2], level: 1 } },
      { id: 'bad-level', kind: 'room', glow: { rgb: [1, 2, 3], level: 2 } },
      { id: 'printer', kind: 'room', ring: { progress: 0.42 } },
      { id: 'bad-ring', kind: 'room', ring: { progress: -0.1 } },
      { id: 'both', kind: 'service', glow: { rgb: [0, 0, 0], level: 0.5 }, ring: { progress: 1 } },
      null,
      { kind: 'room', glow: { rgb: [1, 2, 3] } },
    ],
  });
  assert.deepEqual(marks.map((m) => m.id), ['desk', 'hall', 'printer', 'both']);
  assert.equal(marks[1].glow.level, 1, 'level defaults to full');
  assert.deepEqual(marks[2], { id: 'printer', kind: 'room', glow: null, ring: { progress: 0.42 } });
  assert.equal(marks[3].glow.level, 0.5);
  assert.equal(marks[3].ring.progress, 1);
  // A plain node list works too; nothing to paint is an empty list.
  assert.equal(glowMarks([{ id: 'x', glow: { rgb: [1, 2, 3] } }]).length, 1);
  assert.deepEqual(glowMarks({ nodes: [{ id: 'a' }] }), []);
  assert.deepEqual(glowMarks(null), []);
});

test('glow: brighter lights glow wider and stronger, and grow with the zoom', () => {
  const side = 912;
  const at = (level, ns = 1) => glowGeometry({ kind: 'room', ns, side, level });
  const full = at(1), half = at(0.5), low = at(0.1);
  assert.ok(full.R > half.R && half.R > low.R);
  assert.ok(full.alpha > half.alpha && half.alpha > low.alpha);
  assert.equal(full.alpha, GLOW_SIZE.alpha);
  assert.ok(full.alpha <= 0.45, 'soft: a light is ambience, not status');
  // At the overview a small node still gets a glow you can see across a room.
  assert.ok(full.R >= side * GLOW_SIZE.min);
  // Zoomed in, the node is drawn bigger and its glow follows once past the floor.
  assert.ok(at(1, 1.6).R >= full.R);
  const big = glowGeometry({ kind: 'core', ns: 1.6, side: 100, level: 1 });
  assert.equal(big.R, SIZE.core * 1.6 * GLOW_SIZE.perR);
  // Bad numbers still draw something sane.
  const odd = glowGeometry({ kind: 'nope', ns: NaN, side: -1, level: 7 });
  assert.ok(Number.isFinite(odd.R) && odd.R > 0 && odd.alpha === GLOW_SIZE.alpha);
});

test('glow: the ring sits outside the node and runs clockwise from twelve by progress', () => {
  const side = 912;
  const g = ringGeometry({ kind: 'room', ns: 1, side, progress: 0.25 });
  assert.ok(g.r > SIZE.room, 'outside the node');
  assert.equal(g.start, -Math.PI / 2);
  assert.ok(Math.abs(g.end - g.start - Math.PI / 2) < 1e-9, 'a quarter');
  assert.ok(g.width >= GLOW_SIZE.minWidth);
  assert.equal(ringGeometry({ kind: 'room', progress: 0 }).end, -Math.PI / 2);
  assert.ok(Math.abs(ringGeometry({ kind: 'room', progress: 1 }).end - 1.5 * Math.PI) < 1e-9);
  assert.equal(ringGeometry({ kind: 'room', progress: 3 }).end, ringGeometry({ kind: 'room', progress: 1 }).end);
  assert.ok(ringGeometry({ kind: 'room', ns: 1.6, side }).r > g.r, 'grows with the zoom');
});

test('glow: the zoom eases from where it was to the target over the flight', () => {
  const move = { from: 1, to: 2.3, startAt: 1000, ms: 2000 };
  assert.equal(zoomAt(900, move), 1);
  assert.equal(zoomAt(2000, move), 1.65, 'halfway on a symmetric ease');
  assert.equal(zoomAt(3000, move), 2.3);
  assert.ok(zoomAt(1200, move) - 1 < 1.3 * 0.1, 'eases in: slower than linear at the start');
  assert.equal(zoomAt(5, { from: 1, to: 2, startAt: 0, ms: 0 }), 2, 'no time: there at once');
});

// --- the driver -------------------------------------------------------------

function fakeCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return { addColorStop() {} }; }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { canvas: { width: 0, height: 0, getContext: () => ctx, parentElement: null }, calls };
}

function fakeMap(points) {
  const cbs = new Set();
  return {
    onDraw: (cb) => { cbs.add(cb); return () => cbs.delete(cb); },
    screenOf: (id) => points[id] ?? null,
    snapshotScene: () => ({ outer: 400 }),
    draw: () => { for (const cb of cbs) cb(); },
    listeners: () => cbs.size,
  };
}

const PALETTE = { lineWeak: 'grey-weak', t2: 'grey' };
const doc = { createElement: () => fakeCanvas().canvas };

test('glow: no work while no node carries an extra; paints glows and rings when one does', () => {
  const { canvas, calls } = fakeCanvas();
  const map = fakeMap({ desk: { x: 300, y: 200 }, printer: { x: 500, y: 400 } });
  let now = 0;
  const glow = createGlow(canvas, map, {
    clock: { now: () => now }, size: () => ({ W: 1368, H: 912 }), palette: PALETTE, doc,
  });

  glow.update({ nodes: [{ id: 'hv1', kind: 'site' }] });
  assert.equal(map.listeners(), 0, 'a fleet without lights or jobs is not followed');
  map.draw();
  assert.equal(calls.length, 0);

  glow.update({ nodes: [
    { id: 'desk', kind: 'room', glow: { rgb: [255, 214, 170], level: 0.9 } },
    { id: 'printer', kind: 'room', ring: { progress: 0.5 } },
    { id: 'gone', kind: 'room', glow: { rgb: [1, 2, 3] } }, // not drawn: no screen point
  ] });
  assert.equal(map.listeners(), 1);
  map.draw();
  const images = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(images.length, 1, 'one glow: the light on screen');
  const [, , x, y, w] = images[0];
  const { R } = glowGeometry({ kind: 'room', ns: 0.8, side: 912, level: 0.9 });
  assert.ok(Math.abs(x + w / 2 - 300) < 1e-6 && Math.abs(y + w / 2 - 200) < 1e-6, 'centred on the node');
  assert.ok(w >= R * 2 - 1e-6, 'sized from the level and the screen');
  const arcs = calls.filter((c) => c[0] === 'arc');
  assert.equal(arcs.length, 2, 'the ring: a track and the progress arc');
  assert.ok(Math.abs(arcs[1][5] - (-Math.PI / 2 + Math.PI)) < 1e-9, 'half done');

  // Flying in grows the glow; the light going off stops the follow and clears.
  glow.zoomTo(2.3, 1000);
  now = 1000;
  calls.length = 0;
  map.draw();
  const w2 = calls.find((c) => c[0] === 'drawImage')[4];
  const clears = calls.filter((c) => c[0] === 'clearRect');
  assert.equal(clears.length, 2, 'the last frame is cleared box by box: the glow and the ring');
  assert.ok(clears.every((c) => c[3] < 300 && c[4] < 300), 'never the whole screen');
  assert.ok(w2 >= w, 'zoomed in: at least as wide');
  glow.update({ nodes: [{ id: 'desk', kind: 'room' }] });
  assert.equal(map.listeners(), 0);
  assert.ok(calls.some((c) => c[0] === 'clearRect'), 'cleared when the last extra goes');
  assert.equal(glow.state().painting, false);
  glow.destroy();
});

test('glow: the large demo has lights and a printer to paint', () => {
  const now = 1_790_000_000_000;
  const feeds = new Map(demoFeedsLarge(now).map((f) => [f.source, { ...f, receivedAt: now }]));
  const model = buildFleet({ topology: parseTopology(structuredClone(DEMO_TOPOLOGY_LARGE)), feeds, now, hostname: 'demo-host' });
  const marks = glowMarks(model);
  assert.ok(marks.filter((m) => m.glow).length >= 3, 'lights glow');
  assert.ok(marks.some((m) => m.ring), 'the printer has its ring');
});
