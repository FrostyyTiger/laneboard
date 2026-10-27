// The Map's layout and rings options (Wall plan T10, docs/plans/wall/README.md
// §5, D1): `createMap(el, { layout })` places nodes where the layout says,
// `{ rings: false }` draws no ring, legend or dial; both default off, so the
// app's Map is drawn as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { layout, polarLayout } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

function model() {
  return {
    title: 'acme',
    nodes: [
      { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
      { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
      { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'ok' },
      { id: 'hv1/rack', kind: 'room', parent: 'hv1', label: 'rack', status: 'ok' },
      { id: 'hv2/storage', kind: 'service', parent: 'hv2', label: 'storage', status: 'crit' },
    ],
    links: [],
    events: [],
  };
}

/** A grid: the core at the origin, the sites left and right, their children below them. */
const WHERE = {
  __core: { x: 0, y: 0 }, hv1: { x: -300, y: 0 }, hv2: { x: 300, y: 0 },
  'hv1/rack': { x: -300, y: 200 }, 'hv2/storage': { x: 300, y: 200 },
};
function gridLayout(nodes) {
  const center = nodes.find((n) => n.kind === 'core');
  const kids = new Map();
  for (const n of nodes) {
    if (n === center || !n.parent) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  return { pos: new Map(nodes.map((n) => [n.id, { ...WHERE[n.id] }])), center, kids };
}

async function mount(opts) {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, opts);
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  map.update(model());
  dom.flush(20);
  return { dom, map, ctx: canvas.ctx };
}

test('polarLayout: r and angle from x/y, depth from the tree when missing, bad positions dropped', () => {
  const nodes = model().nodes;
  const lay = gridLayout(nodes);
  lay.pos.set('nowhere', { x: NaN, y: 1 });
  const out = polarLayout(lay);
  assert.equal(out.pos.has('nowhere'), false);
  const p = out.pos.get('hv2/storage');
  assert.ok(close(p.r, Math.hypot(300, 200)));
  assert.ok(close(p.angle, Math.atan2(200, 300)));
  assert.equal(out.pos.get('__core').depth, 0);
  assert.equal(out.pos.get('hv1').depth, 1);
  assert.equal(out.pos.get('hv1/rack').depth, 2);
  assert.equal(out.pos.get('hv1').ring, 0);
  assert.equal(out.center.id, '__core');
  // Given depth and ring are kept.
  const kept = polarLayout({ pos: new Map([['a', { x: 1, y: 0, depth: 4, ring: 3 }]]), kids: new Map() });
  assert.equal(kept.pos.get('a').depth, 4);
  assert.equal(kept.pos.get('a').ring, 3);
  assert.equal(kept.center.virtual, true, 'no centre given: a virtual one');
});

test('createMap { layout }: nodes sit where the custom layout says', async (t) => {
  const { dom, map } = await mount({ layout: gridLayout });
  t.after(() => { map.destroy(); dom.restore(); });
  const snap = map.snapshotScene();
  assert.equal(snap.count, 5);
  // World positions (the springs' goals) are the layout's x/y.
  const world = [];
  for (let i = 0; i < snap.count; i++) world.push([snap.pts[i * 4], snap.pts[i * 4 + 1]]);
  for (const want of Object.values(WHERE)) {
    assert.ok(world.some(([x, y]) => close(x, want.x, 0.01) && close(y, want.y, 0.01)), `a node at ${want.x},${want.y}`);
  }
  // On screen (reduced motion: drawn at the goal) the grid keeps its shape:
  // the sites level with each other, each child straight under its site.
  const s = (id) => map.screenOf(id);
  assert.ok(close(s('hv1').y, s('hv2').y, 0.5), 'sites level');
  assert.ok(close(s('hv1').x, s('hv1/rack').x, 0.5), 'rack under hv1');
  assert.ok(close(s('hv2').x, s('hv2/storage').x, 0.5), 'storage under hv2');
  assert.ok(s('hv1').x < s('__core').x && s('__core').x < s('hv2').x, 'left to right');
  const k = (s('hv2').x - s('hv1').x) / 600;
  assert.ok(close(s('hv2/storage').y - s('hv2').y, 200 * k, 0.5), 'one scale for x and y');
});

test('createMap default: the radial layout, as before', async (t) => {
  const { dom, map } = await mount({});
  t.after(() => { map.destroy(); dom.restore(); });
  const snap = map.snapshotScene();
  const want = layout(model().nodes);
  const world = [];
  for (let i = 0; i < snap.count; i++) world.push([snap.pts[i * 4], snap.pts[i * 4 + 1]]);
  for (const p of want.pos.values()) {
    assert.ok(world.some(([x, y]) => close(x, p.x, 0.01) && close(y, p.y, 0.01)), `radial ${p.x},${p.y}`);
  }
});

const BEARINGS = ['000', '090', '180', '270'];

test('createMap { rings: false }: no bearing dial or ring legend is drawn; default draws them', async (t) => {
  {
    const { dom, map, ctx } = await mount({});
    const text = ctx.calls.text;
    map.destroy(); dom.restore();
    for (const b of BEARINGS) assert.ok(text.includes(b), `default draws bearing ${b}`);
    assert.ok(text.some((s) => /SITE/.test(s)), 'default draws the ring legend');
  }
  const { dom, map, ctx } = await mount({ rings: false });
  t.after(() => { map.destroy(); dom.restore(); });
  const text = ctx.calls.text;
  assert.ok(text.length > 0, 'something is drawn');
  for (const b of BEARINGS) assert.ok(!text.includes(b), `no bearing ${b}`);
  assert.ok(!text.some((s) => /SITE|SVC|ROOM/.test(s)), 'no ring legend');
});

test('renderer: rings false gives no ring geometry for labels to keep clear of', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 6 }) : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const r = createRenderer(ctx, {});
  const lay = layout(model().nodes);
  const byId = new Map(model().nodes.map((n) => [n.id, n]));
  const sc = { W: 1200, H: 800, s: 1, toScreen: (p) => ({ x: p.x + 600, y: p.y + 400 }), pos: lay.pos, byId, nodes: new Map() };
  assert.ok(r.ringTextBoxes(sc).length > 0, 'default: legends and bearings');
  assert.equal(r.ringTextBoxes({ ...sc, rings: false }).length, 0);
  calls.length = 0;
  r.drawRings({ ...sc, rings: false });
  assert.equal(calls.filter(([k]) => k === 'stroke' || k === 'fillText').length, 0, 'drawRings draws nothing');
  r.drawRings(sc);
  assert.ok(calls.some(([k]) => k === 'stroke'), 'default drawRings strokes');
});
