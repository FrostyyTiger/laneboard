// Desk chrome off on the Wall (plan T18, r9-film-ui #5): the Map's `legends`
// and `lamps` options hide the ring legends and the lamp strip under a
// builder's name; the ring hairlines and the bearing dial stay. Both default
// on, so the app's Map is drawn as before; radial turns both off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { layout } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';
import * as radial from '../public/js/wall/variants/radial.js';
import { mapOptionsFor, VARIANTS } from '../public/js/wall/variants.js';

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

const FLEET = [
  { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
  { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
  { id: 'hv1/rack', kind: 'room', parent: 'hv1', label: 'rack', status: 'ok' },
  { id: 'builder:builder-a', kind: 'builder', parent: 'hv1/rack', builder: 'builder-a', label: 'BA', code: 'BA', status: 'ok', counts: { waiting: 1 } },
  { id: 'lane:builder-a/fix-login', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', label: 'fix-login', status: 'ok' },
];

/** A 2D context that records fillRect and fillText with the fill style at the time. */
function recordingCtx() {
  const ops = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, font: '10px x' };
  return new Proxy(state, {
    get(o, k) {
      if (k === 'ops') return ops;
      if (k in o) return o[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'fillRect') return (x, y, w, h) => ops.push({ op: 'fillRect', w, h, fill: o.fillStyle });
      if (k === 'fillText') return (text) => ops.push({ op: 'fillText', text: String(text) });
      if (k === 'getLineDash') return () => [];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

function sceneOf(extra = {}) {
  const lay = layout(FLEET);
  const byId = new Map(FLEET.map((n) => [n.id, n]));
  const nodes = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    nodes.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? null, depth: p.depth });
  }
  return {
    W: 1600, H: 1200, now: 1000, s: 1, zoom: 1, toScreen: (p) => ({ x: 800 + p.x, y: 600 + p.y }),
    pos: lay.pos, nodes, byId, links: [], overlay: 'status', rolled: () => null, folded: new Set(), kids: lay.kids,
    alpha: () => 1, hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null, ...extra,
  };
}

const lampsOf = (ctx) => ctx.ops.filter((o) => o.op === 'fillRect' && o.w === 4 && o.h === 4);

test('renderer: lamps false draws no lamp strip under a builder; the name stays', () => {
  const on = recordingCtx();
  createRenderer(on, PAL).drawLabels(sceneOf());
  assert.equal(lampsOf(on).length, 3, 'default: link, approvals, stuck');
  assert.ok(on.ops.some((o) => o.op === 'fillText' && o.text === 'BUILDER-A'));
  const off = recordingCtx();
  createRenderer(off, PAL).drawLabels(sceneOf({ lamps: false }));
  assert.equal(lampsOf(off).length, 0, 'no lamps');
  assert.ok(off.ops.some((o) => o.op === 'fillText' && o.text === 'BUILDER-A'), 'the name is still drawn');
});

test('renderer: legends false keeps the ring hairlines and the dial, drops the legends', () => {
  const r = createRenderer(recordingCtx(), PAL);
  const sc = sceneOf();
  const all = r.ringTextBoxes(sc).map((b) => b.text);
  const bare = r.ringTextBoxes({ ...sc, legends: false }).map((b) => b.text);
  assert.ok(all.some((t) => /ROOM|SITE|BUILDER/.test(t)), 'default: ring legends');
  assert.deepEqual(bare, ['000', '090', '180', '270'], 'only the bearing numbers');
  const ctx = recordingCtx();
  createRenderer(ctx, PAL).drawRings({ ...sc, legends: false });
  const text = ctx.ops.filter((o) => o.op === 'fillText').map((o) => o.text);
  assert.deepEqual(text, ['000', '090', '180', '270'], 'the dial is drawn, no legend');
});

async function mount(opts) {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, opts);
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  map.update({ title: 'acme', nodes: FLEET, links: [], events: [] });
  dom.flush(20);
  return { dom, map, text: canvas.ctx.calls.text };
}

test('createMap: legends and lamps default on; off, the dial still reads', async (t) => {
  {
    const { dom, map, text } = await mount({});
    map.destroy(); dom.restore();
    assert.ok(text.some((s) => /ROOM|SITE/.test(s)), 'default draws the ring legend');
  }
  const { dom, map, text } = await mount({ legends: false, lamps: false });
  t.after(() => { map.destroy(); dom.restore(); });
  for (const b of ['000', '090', '180', '270']) assert.ok(text.includes(b), `bearing ${b} drawn`);
  assert.ok(!text.some((s) => /·/.test(s) || /^(ROOM|SITE|SVC)\b/.test(s)), 'no ring legend');
});

test('radial: the Wall turns legends and lamps off and keeps the rings', () => {
  assert.equal(radial.mapOptions.legends, false);
  assert.equal(radial.mapOptions.lamps, false);
  assert.notEqual(radial.mapOptions.rings, false, 'hairlines and dial stay');
  const opts = mapOptionsFor(VARIANTS.find((v) => v.id === 'radial'), 1.5, { dpr: 2, cssHeight: 912, screenMm: 260 });
  assert.equal(opts.legends, false);
  assert.equal(opts.lamps, false);
});
