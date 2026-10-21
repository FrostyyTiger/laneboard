// Night-1 bug (runs-n2 T1): leaving the Map threw `IndexSizeError: … arc …
// radius … is negative`, and every view then showed the UI ERROR banner. The
// hidden Map measured 1x1 px, computeFit went negative, and every radius
// drawn with that scale was negative. These tests use a 2D context whose
// arc() throws on a negative radius, like the browser's.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../public/js/views/map/render.js';
import { layout } from '../public/js/views/map/layout.js';
import { fitScaleOf } from '../public/js/views/map/interact.js';
import { createMinimap } from '../public/js/views/map/minimap.js';
import { SHAPE_CODE, TONE_CODE } from '../public/js/views/map/overlays.js';

/** A 2D context that accepts everything and throws on a negative arc radius. */
function strictCtx() {
  const arcs = [];
  const ctx = new Proxy({}, {
    get: (o, k) => {
      if (k in o) return o[k];
      if (k === 'arc') {
        return (x, y, r) => {
          if (r < 0) throw new RangeError(`IndexSizeError: The radius provided (${r}) is negative.`);
          arcs.push(r);
        };
      }
      if (k === 'measureText') return (t) => ({ width: String(t).length * 6 });
      if (k === 'getLineDash') return () => [];
      return () => {};
    },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { ctx, arcs };
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

const FLEET = [
  { id: '__core', kind: 'core', label: 'fleet' },
  { id: 'hq', kind: 'site', parent: '__core', label: 'hq', status: 'ok' },
  { id: 'agents', kind: 'room', parent: 'hq', label: 'agents', status: 'ok', metrics: { cpu: 0.5, mem: 0.4 } },
  { id: 'builder:builder-a', kind: 'builder', parent: 'agents', builder: 'builder-a', label: 'B1', code: 'B1', status: 'ok' },
  { id: 'lane:builder-a/pay', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', label: 'pay', status: 'working' },
];

/** The scene the Map view builds for a W x H canvas at world scale s. */
function sceneOf(W, H, s) {
  const lay = layout(FLEET);
  const byId = new Map(FLEET.map((n) => [n.id, n]));
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? null, depth: p.depth });
  }
  return {
    W, H, now: 1000, s, zoom: 1,
    toScreen: (p) => ({ x: W / 2 + p.x * s, y: H / 2 + p.y * s }),
    pos: lay.pos, nodes: cur, byId, links: [], overlay: 'status',
    rolled: () => null, folded: new Set(['agents']), kids: lay.kids, alpha: () => 1,
    hover: null, selected: 'lane:builder-a/pay', selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [{ id: 'hq', t0: 500, tone: 'crit' }], comets: [], reduced: false, anchor: null,
  };
}

test('fitScaleOf: a hidden map (0 or 1 px) still gets a positive scale', () => {
  assert.ok(fitScaleOf(1, 1, 400) > 0, '1x1: was (1 - 20) / 800 < 0');
  assert.ok(fitScaleOf(0, 0, 400) > 0);
  assert.ok(fitScaleOf(800, 10, 400) > 0, 'shorter than the readout strip');
  assert.ok(fitScaleOf(800, 600, 0) > 0, 'no radius');
  assert.ok(fitScaleOf(NaN, 600, 400) > 0);
  assert.equal(fitScaleOf(1600, 1220, 400), 1.5, 'a visible map is unchanged');
});

test('a visible map draws its arcs through the strict context', () => {
  const { ctx, arcs } = strictCtx();
  const r = createRenderer(ctx, PAL);
  r.draw(sceneOf(1600, 1200, 1));
  assert.ok(arcs.length > 5, 'rings, nodes, gauges');
});

test('the scene of a hidden map (1x1, negative scale) draws without throwing', () => {
  const { ctx } = strictCtx();
  const r = createRenderer(ctx, PAL);
  // What the view built after the Map section was hidden: W = H = 1 and the
  // old computeFit's negative scale.
  const s = Math.min(1 / 928, (1 - 40) / 928);
  assert.ok(s < 0);
  assert.doesNotThrow(() => r.draw(sceneOf(1, 1, s)));
  assert.deepEqual(r.draw(sceneOf(1, 1, s)), { badges: [] });
  assert.doesNotThrow(() => r.draw(sceneOf(0, 0, 1)), 'zero size');
  assert.doesNotThrow(() => r.draw(sceneOf(1600, 1200, -0.5)), 'negative scale on a sized canvas');
});

test('switching away and back: hidden frames are skipped, the next visible one draws', () => {
  const { ctx, arcs } = strictCtx();
  const r = createRenderer(ctx, PAL);
  r.draw(sceneOf(1600, 1200, 1));
  const shown = arcs.length;
  r.draw(sceneOf(1, 1, fitScaleOf(1, 1, 864)));
  assert.equal(arcs.length, shown, 'nothing drawn while hidden');
  r.draw(sceneOf(1600, 1200, 1));
  assert.equal(arcs.length, shown * 2, 'back on the Map: a full frame again');
});

test('the minimap draws an odd scene (no outer, NaN points) without a negative radius', () => {
  const { ctx, arcs } = strictCtx();
  const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener() {}, removeEventListener() {} };
  const pts = new Float32Array([0, 0, SHAPE_CODE.ring, TONE_CODE.grey, NaN, 3, SHAPE_CODE.disc, TONE_CODE.crit]);
  for (const outer of [undefined, -50, 0, NaN, 400]) {
    const mini = createMinimap(canvas, () => ({ version: 1, pts, outer }), { now: () => 10_000, reduced: () => true });
    assert.doesNotThrow(() => mini.draw(true), `outer ${outer}`);
    mini.destroy();
  }
  assert.ok(arcs.every((r) => r >= 0));
});
