// The `orbits` direction for a wall (Wall plan T12, docs/plans/wall/README.md
// §5): the sites as planets on an ellipse stretched to the screen, their
// rooms on an orbit round each, the planet's name in the orbit's gap; and
// the Map hooks it needs, all inert without a custom layout (orbit lines,
// a fit by the layout's own extents, branch shapes, label direction).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { layout as ringLayout, polarLayout, branchCurve } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';
import {
  layoutFor, planet, arrange, optionsFor, mapOptions, ambient, SAFE, SIZES, ASPECT,
} from '../public/js/wall/variants/orbits.js';
import { VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';
import { baseLabelSize as labelSize } from '../public/js/wall/variants/radial.js';

/**
 * A fleet the size of the large demo: five sites of 3-14 rooms with 0-3
 * services each, a builder with lanes and a session under one, a repo
 * index, and a run on the core (no place).
 */
function fleet() {
  const nodes = [{ id: '__core', kind: 'core', label: 'acme', status: 'ok' }];
  const rooms = { hv1: 14, hv2: 9, cloud: 8, remote: 5, home: 9 };
  for (const [site, n] of Object.entries(rooms)) {
    nodes.push({ id: site, kind: 'site', parent: '__core', label: site, status: 'ok' });
    for (let i = 0; i < n; i++) {
      const room = `${site}/room-${i}`;
      nodes.push({ id: room, kind: 'room', parent: site, label: `room-${i}`, status: 'ok' });
      for (let j = 0; j < i % 4; j++) nodes.push({ id: `${room}/svc-${j}`, kind: 'service', parent: room, label: `svc-${j}`, status: 'ok' });
    }
  }
  nodes.push({ id: 'builder:builder-a', kind: 'builder', parent: 'hv1', label: 'builder-a', status: 'working' });
  for (let i = 0; i < 3; i++) nodes.push({ id: `lane:a/${i}`, kind: 'lane', parent: 'builder:builder-a', label: `lane-${i}`, status: 'working' });
  nodes.push({ id: 'sess:1', kind: 'session', parent: 'lane:a/0', label: 's1', status: 'working' });
  nodes.push({ id: 'sess:2', kind: 'session', parent: 'lane:a/0', label: 's2', status: 'working' });
  nodes.push({ id: '__repos', kind: 'site', parent: '__core', label: 'REPOS', status: 'ok' });
  nodes.push({ id: 'repo:acme', kind: 'repo', parent: '__repos', label: 'acme', status: 'ok' });
  nodes.push({ id: 'run:x', kind: 'run', parent: '__core', label: 'search', status: 'working' });
  return nodes;
}

const SITES = ['hv1', 'hv2', 'cloud', 'remote', 'home', '__repos'];
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

for (const [name, aspect] of [['3:2', 3 / 2], ['16:9', 16 / 9]]) {
  test(`orbits layout at ${name}: every node inside the view, the width used, nothing in the bottom band`, () => {
    const nodes = fleet();
    const lay = layoutFor(aspect)(nodes);
    assert.equal(lay.pos.size, nodes.length, 'every node placed');
    const { x: bx, y: by, cy } = lay.bounds;
    // The Map fits the view {±bx, cy±by} into the screen; at this aspect both sides limit alike or one does.
    const H = 1000, W = H * aspect;
    const s = Math.min(W / (2 * bx), H / (2 * by));
    const screen = (p) => ({ x: W / 2 + p.x * s, y: H / 2 + (p.y - cy) * s });
    let x0 = Infinity, x1 = -Infinity;
    for (const [id, p] of lay.pos) {
      const q = screen(p);
      assert.ok(q.x >= W * SAFE.side - 1e-6 && q.x <= W * (1 - SAFE.side) + 1e-6, `${id} inside the sides`);
      assert.ok(q.y >= H * SAFE.top - 1e-6, `${id} below the top margin`);
      assert.ok(q.y <= H * (1 - SAFE.bottom) + 1e-6, `${id} above the clock and fleet line`);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
    }
    assert.ok((x1 - x0) / W > 0.6, `nodes span ${(100 * (x1 - x0) / W).toFixed(0)} % of the width`);
    // Wider than tall: the planets' ellipse is stretched to the screen.
    const [big] = lay.guides;
    assert.ok(big.rx > big.ry * 1.2, 'the planets\' ellipse is wide');
  });
}

test('orbits layout: the planet systems keep clear of each other and of the sun', () => {
  const nodes = fleet();
  const lay = layoutFor(ASPECT)(nodes);
  const byParent = new Map();
  for (const n of nodes) if (n.parent) byParent.set(n.parent, [...(byParent.get(n.parent) ?? []), n]);
  // Every node of a system lies within its planet's box from `planet`, and the boxes do not overlap.
  const kids = new Map([...byParent]);
  const boxes = SITES.map((id) => {
    const sys = planet(nodes.find((n) => n.id === id), kids);
    const c = lay.pos.get(id);
    return { id, x0: c.x - sys.hx, x1: c.x + sys.hx, y0: c.y - sys.hy, y1: c.y + sys.hy };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = [boxes[i], boxes[j]];
    assert.ok(!(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1), `${p.id} clear of ${q.id}`);
  }
  for (const b of boxes) assert.ok(!(b.x0 < SIZES.sun && -SIZES.sun < b.x1 && b.y0 < SIZES.sun && -SIZES.sun < b.y1), `${b.id} clear of the sun`);
  // The run circles the sun, it is no planet.
  const run = lay.pos.get('run:x');
  assert.ok(close(Math.hypot(run.x, run.y), SIZES.inner, 1e-6));
  // arrange alone: two equal systems sit apart by at least the gap.
  const two = arrange([{ hx: 100, hy: 60 }, { hx: 100, hy: 60 }], 1.5);
  const [a, b] = two.centres;
  assert.ok(Math.abs(a.x - b.x) >= 200 + SIZES.gap - 1e-6 || Math.abs(a.y - b.y) >= 120 + SIZES.gap - 1e-6);
});

test('orbits layout: rooms and services on the planet\'s orbit, deeper nodes outside it, the name in the gap', () => {
  const nodes = fleet();
  const lay = layoutFor(ASPECT)(nodes);
  const g = new Map(lay.guides.slice(2).map((o) => [`${o.x},${o.y}`, o]));
  for (const site of SITES) {
    const c = lay.pos.get(site);
    const orbit = g.get(`${c.x},${c.y}`);
    assert.ok(orbit && close(orbit.rx, orbit.ry), `${site} has a round orbit line`);
    assert.ok(orbit.rx >= SIZES.minOrbit);
    assert.equal(c.branch, 'none', 'no spoke from the sun');
    assert.deepEqual(c.labelAt, { x: c.x, y: c.y + orbit.rx }, 'the planet\'s name at six o\'clock on its orbit');
    const members = nodes.filter((n) => n.parent === site || nodes.find((m) => m.id === n.parent)?.parent === site);
    for (const m of members) {
      const p = lay.pos.get(m.id);
      assert.ok(close(Math.hypot(p.x - c.x, p.y - c.y), orbit.rx, 1e-6), `${m.id} on ${site}'s orbit`);
      // Nothing sits in the name's gap round six o'clock.
      const a = Math.atan2(p.y - c.y, p.x - c.x);
      assert.ok(Math.abs(a - Math.PI / 2) > 0.2, `${m.id} out of the name's gap`);
      const turn = (((p.labelAngle - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      assert.ok(turn < 1e-9 || 2 * Math.PI - turn < 1e-9, `${m.id}'s name points away from its planet`);
      if (m.parent === site) assert.equal(p.branch, 'straight');
      else assert.deepEqual(p.branch, { x: c.x, y: c.y }, `${m.id} hangs on the orbit's arc`);
    }
  }
  const hv1 = lay.pos.get('hv1');
  const orbit = g.get(`${hv1.x},${hv1.y}`).rx;
  for (const id of ['sess:1', 'sess:2']) {
    const p = lay.pos.get(id);
    assert.ok(close(Math.hypot(p.x - hv1.x, p.y - hv1.y), orbit + SIZES.sat, 1e-6), `${id} a step outside the orbit`);
  }
  // Polar for the Map, guides and bounds passed on.
  const polar = polarLayout(lay);
  assert.equal(polar.guides, lay.guides);
  assert.deepEqual(polar.bounds, lay.bounds);
  assert.ok(close(polar.pos.get('hv1').r, Math.hypot(hv1.x, hv1.y)));
  const radial = polarLayout(ringLayout(nodes));
  assert.equal(radial.guides, undefined, 'the radial layout brings no orbit lines');
  assert.equal(radial.bounds, undefined, 'nor its own fit');
});

test('branchCurve: straight is a line, an arc stays on its circle, anything else null', () => {
  const p = { x: 100, y: 0, r: 100, t: 0, depth: 2 }, c = { x: 0, y: 100, r: 100, t: Math.PI / 2, depth: 3 };
  const [a, b1, b2, d] = branchCurve(p, c, 'straight');
  assert.equal(a, p); assert.equal(d, c);
  for (const q of [b1, b2]) assert.ok(close((q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x), 0), 'on the line');
  // A quarter turn round (0, 0): the cubic's midpoint is on the circle to within 0.1 %.
  const [, k1, k2] = branchCurve(p, c, { x: 0, y: 0 });
  const mid = { x: (p.x + 3 * k1.x + 3 * k2.x + c.x) / 8, y: (p.y + 3 * k1.y + 3 * k2.y + c.y) / 8 };
  assert.ok(Math.abs(Math.hypot(mid.x, mid.y) - 100) < 0.1, `arc midpoint at r ${Math.hypot(mid.x, mid.y).toFixed(2)}`);
  // The short way round, either direction.
  const [, r1] = branchCurve(c, p, { x: 0, y: 0 });
  assert.ok(r1.x > 0 && r1.y > 0, 'back the short way');
  assert.equal(branchCurve(p, c, undefined), null, 'nothing asked: the Map\'s own curve along the rings');
  assert.equal(branchCurve(p, c, 'none'), null);
});

function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === 'measureText' ? function (s) { return { width: String(s).length * 0.6 * Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10) }; } : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { ctx, calls };
}

test('renderer: guides drawn as ellipses only when a layout gives them', () => {
  const { ctx, calls } = recorder();
  const r = createRenderer(ctx, {});
  const sc = { W: 1200, H: 800, s: 2, toScreen: (p) => ({ x: p.x * 2 + 600, y: p.y * 2 + 400 }), pos: new Map(), byId: new Map(), nodes: new Map(), rings: false };
  r.drawRings(sc);
  assert.equal(calls.filter(([k]) => k === 'ellipse').length, 0, 'none by default');
  r.drawRings({ ...sc, guides: [{ x: 0, y: 0, rx: 300, ry: 200 }, { x: 10, y: 20, rx: 50, ry: 50 }, { x: 0, y: 0, rx: 0, ry: 5 }] });
  const el2 = calls.filter(([k]) => k === 'ellipse');
  assert.equal(el2.length, 2, 'one per valid guide');
  assert.deepEqual(el2[0].slice(1, 5), [600, 400, 600, 400], 'centre and radii on screen');
  assert.deepEqual(el2[1].slice(1, 5), [620, 440, 100, 100]);
});

const NODES = [
  { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
  { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
  { id: 'hv1/rack', kind: 'room', parent: 'hv1', label: 'rack', status: 'ok' },
];

function labelBoxes(extra) {
  const { ctx } = recorder();
  const r = createRenderer(ctx, {});
  const lay = ringLayout(NODES);
  const byId = new Map(NODES.map((n) => [n.id, n]));
  const pos = new Map([...lay.pos].map(([id, p]) => [id, { ...p, ...(extra[id] ?? {}) }]));
  const nodes = new Map();
  for (const [id, p] of pos) nodes.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: byId.get(id), depth: p.depth });
  const sc = {
    W: 1200, H: 800, now: 0, s: 1, zoom: 1, toScreen: (p) => ({ x: p.x + 600, y: p.y + 400 }),
    pos, nodes, byId, links: [], overlay: 'status', rolled: () => null, folded: new Set(), kids: lay.kids,
    alpha: () => 1, near: new Set(), matches: new Set(), pulses: [], comets: [], rings: false, labelSize,
  };
  return { sc, boxes: new Map(r.labelBoxes(sc, r.drawNodes(sc)).map((b) => [b.text, b])) };
}

test('renderer: labelAngle turns a name, labelAt centres a big name; without them, as before', () => {
  const before = labelBoxes({});
  const rack = before.sc.toScreen(before.sc.nodes.get('hv1/rack'));
  const plain = before.boxes.get('RACK');
  // Pointing left of the rack instead of away from the core.
  const turned = labelBoxes({ 'hv1/rack': { labelAngle: Math.PI } }).boxes.get('RACK');
  assert.ok(turned.x1 <= rack.x + 1, 'a name pointing left ends left of its node');
  assert.notDeepEqual(turned, plain);
  const at = { x: 40, y: -120 };
  const moved = labelBoxes({ hv1: { labelAt: at } });
  const box = moved.boxes.get('HV1');
  const want = moved.sc.toScreen(at);
  assert.ok(close((box.x0 + box.x1) / 2, want.x, 1.5) && close((box.y0 + box.y1) / 2, want.y, 1.5), 'the site name centred on labelAt');
});

test('createMap with the orbits options: the overview fits the layout\'s view, nothing turns', async (t) => {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, mapOptionsFor(VARIANTS.find((v) => v.id === 'orbits'), 1.5));
  t.after(() => { map.destroy(); dom.restore(); });
  map.update({ title: 'acme', nodes: fleet(), links: [], events: [] });
  dom.flush(20);
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const first = map.screenOf('hv1');
  // Sessions are folded into their lane at the overview (model.js autoFold).
  for (const n of fleet().filter((x) => x.kind !== 'session')) {
    const p = map.screenOf(n.id);
    assert.ok(p, `${n.id} drawn`);
    assert.ok(p.x >= 0 && p.x <= 1200 && p.y >= 0 && p.y <= 800, `${n.id} on the canvas`);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  assert.ok(x1 - x0 > 0.6 * 1200, 'the width is used');
  assert.ok(y1 <= 800 * (1 - SAFE.bottom) + 1, 'the bottom band stays clear');
  dom.flush(40);
  const later = map.screenOf('hv1');
  assert.ok(close(first.x, later.x, 0.5) && close(first.y, later.y, 0.5), 'no ambient turn');
});

test('orbits registered: options for the screen\'s aspect, no turn; radial as before', () => {
  const v = VARIANTS.find((x) => x.id === 'orbits');
  assert.equal(v.mapOptions, mapOptions);
  assert.equal(mapOptions.rings, false);
  assert.equal(mapOptions.labelSize, labelSize, 'the radial base steps (26 / 15) its layout is spaced for');
  assert.deepEqual(ambient, { drift: 0 });
  const o = mapOptionsFor(v, 16 / 9);
  assert.equal(o.ambient, ambient);
  assert.equal(typeof o.layout, 'function');
  assert.notEqual(o.layout, mapOptions.layout, 'laid out for the asked aspect');
  const wide = o.layout(fleet()).bounds, tablet = optionsFor(1.5).layout(fleet()).bounds;
  assert.ok(wide.x / wide.y > tablet.x / tablet.y, 'a wider screen, a wider view');
  const radial = mapOptionsFor(VARIANTS.find((x) => x.id === 'radial'), 16 / 9);
  assert.equal(radial.ambient, true);
  assert.equal(radial.layout, VARIANTS.find((x) => x.id === 'radial').mapOptions.layout);
  assert.equal(mapOptionsFor(v, NaN).layout, mapOptions.layout, 'no aspect: the tablet\'s');
});
