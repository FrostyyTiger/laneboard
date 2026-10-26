// The `islands` direction for a wall (Wall plan T13, docs/plans/wall/README.md
// §5): each site its own island set like a paragraph in a lens, a coastline
// round it with the site's name on top, the islands in rows across the
// screen, tucked under each other and clear of each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { polarLayout } from '../public/js/views/map/layout.js';
import {
  layoutFor, island, shapeOf, clearOf, arrange, labelSize, optionsFor, mapOptions, ambient, SAFE, SIZES, ASPECT,
} from '../public/js/wall/variants/islands.js';
import { VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';

/**
 * A fleet the size of the large demo: five sites of 5-14 rooms with 0-3
 * services each, a builder in a room with lanes and sessions, a repo
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
  nodes.push({ id: 'builder:builder-a', kind: 'builder', parent: 'hv1/room-0', label: 'builder-a', status: 'working' });
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

/** The site a node belongs to (null for the core and what hangs on it). */
function siteOf(nodes, id) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let n = byId.get(id);
  while (n && n.kind !== 'site') n = byId.get(n.parent);
  return n?.id ?? null;
}

/** The coastline round a site's mark: the guide whose ellipse holds it. */
function coastOf(lay, site) {
  const p = lay.pos.get(site);
  return lay.guides.find((g) => ((p.x - g.x) / g.rx) ** 2 + ((p.y - g.y) / g.ry) ** 2 < 1);
}

for (const [name, aspect] of [['3:2', 3 / 2], ['16:9', 16 / 9]]) {
  test(`islands layout at ${name}: every node and coastline inside the view, the width used, nothing in the bottom band`, () => {
    const nodes = fleet();
    const lay = layoutFor(aspect)(nodes);
    assert.equal(lay.pos.size, nodes.length, 'every node placed');
    const { x: bx, y: by, cy } = lay.bounds;
    const H = 1000, W = H * aspect;
    const s = Math.min(W / (2 * bx), H / (2 * by));
    const screen = (p) => ({ x: W / 2 + p.x * s, y: H / 2 + (p.y - cy) * s });
    const inside = (q, what) => {
      assert.ok(q.x >= W * SAFE.side - 1e-6 && q.x <= W * (1 - SAFE.side) + 1e-6, `${what} inside the sides`);
      assert.ok(q.y >= H * SAFE.top - 1e-6, `${what} below the top margin`);
      assert.ok(q.y <= H * (1 - SAFE.bottom) + 1e-6, `${what} above the clock and fleet line`);
    };
    let x0 = Infinity, x1 = -Infinity;
    for (const [id, p] of lay.pos) {
      const q = screen(p);
      inside(q, id);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
    }
    assert.ok((x1 - x0) / W > 0.6, `nodes span ${(100 * (x1 - x0) / W).toFixed(0)} % of the width`);
    // The coastlines and the names on them stay inside too.
    for (const g of lay.guides) {
      inside(screen({ x: g.x - g.rx, y: g.y }), 'a coastline\'s west end');
      inside(screen({ x: g.x + g.rx, y: g.y }), 'its east end');
      inside(screen({ x: g.x, y: g.y - g.ry - SIZES.title }), 'its name');
      inside(screen({ x: g.x, y: g.y + g.ry }), 'its south end');
    }
    assert.equal(lay.guides.length, SITES.length, 'one coastline per site, none round the hub');
  });
}

test('islands layout: each site\'s nodes on its own island, the islands clear of each other', () => {
  const nodes = fleet();
  const lay = layoutFor(ASPECT)(nodes);
  for (const n of nodes) {
    const site = siteOf(nodes, n.id);
    if (!site) continue;
    const p = lay.pos.get(n.id);
    const g = coastOf(lay, site);
    assert.ok(g, `${site} has a coastline`);
    assert.ok(((p.x - g.x) / g.rx) ** 2 + ((p.y - g.y) / g.ry) ** 2 < 1, `${n.id} inside ${site}'s coastline`);
    for (const other of SITES.filter((s) => s !== site)) {
      const h = coastOf(lay, other);
      assert.ok(((p.x - h.x) / h.rx) ** 2 + ((p.y - h.y) / h.ry) ** 2 >= 1, `${n.id} outside ${other}'s`);
    }
  }
  // Two coastlines never cross: no point of one inside the other.
  for (let i = 0; i < lay.guides.length; i++) for (let j = 0; j < lay.guides.length; j++) {
    if (i === j) continue;
    const [a, b] = [lay.guides[i], lay.guides[j]];
    for (let k = 0; k < 360; k++) {
      const t = (k / 360) * 2 * Math.PI;
      const x = a.x + Math.cos(t) * a.rx, y = a.y + Math.sin(t) * a.ry;
      assert.ok(((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 >= 1, `coastline ${i} clear of ${j}`);
    }
  }
  // The hub (the core and its run) stays off every island.
  for (const id of ['__core', 'run:x']) {
    const p = lay.pos.get(id);
    for (const g of lay.guides) assert.ok(((p.x - g.x) / g.rx) ** 2 + ((p.y - g.y) / g.ry) ** 2 >= 1, `${id} off the islands`);
  }
});

test('islands layout: rooms named under their mark, what they hold in a row of dots, the site\'s name on its coast', () => {
  const nodes = fleet();
  const lay = layoutFor(ASPECT)(nodes);
  for (const site of SITES) {
    const c = lay.pos.get(site);
    const g = coastOf(lay, site);
    assert.equal(c.branch, 'none', 'no spoke from the core');
    assert.deepEqual(c.labelAt, { x: g.x, y: g.y - g.ry }, `${site}'s name at the top of its coastline`);
  }
  const room = lay.pos.get('hv1/room-3');
  assert.equal(room.labelAngle, Math.PI / 2, 'a room\'s name under it');
  assert.equal(room.branch, 'none', 'no branches inside an island');
  // Its three services in a row to its right, a dot apart, on its line.
  for (let j = 0; j < 3; j++) {
    const p = lay.pos.get(`hv1/room-3/svc-${j}`);
    assert.ok(close(p.y, room.y) && close(p.x, room.x + SIZES.dotX + j * SIZES.dot), `svc-${j} in the row`);
    assert.equal(p.labelAngle, -Math.PI / 2, 'a dot\'s name (in trouble) above it');
  }
  // A builder is a word of its own (named under it), its lanes and sessions its dots.
  const b = lay.pos.get('builder:builder-a');
  assert.equal(b.labelAngle, Math.PI / 2);
  const lanes = ['lane:a/0', 'sess:1', 'sess:2', 'lane:a/1', 'lane:a/2'].map((id) => lay.pos.get(id));
  lanes.forEach((p, j) => assert.ok(close(p.y, b.y) && close(p.x, b.x + SIZES.dotX + j * SIZES.dot), `dot ${j} of the builder`));
  // Words on a line do not run into each other: each starts after the one before ends.
  const isle = island(nodes.find((n) => n.id === 'hv1'), kidsOf(nodes));
  for (const row of isle.rows) {
    let end = -Infinity;
    for (const w of row) {
      const p = isle.place.get(w.node.id);
      assert.ok(p.x - SIZES.mark >= end - 1e-6, `${w.node.id} after the word before`);
      end = p.x - SIZES.mark + w.w - SIZES.word;
    }
  }
  // Polar for the Map, guides and bounds passed on.
  const polar = polarLayout(lay);
  assert.equal(polar.guides, lay.guides);
  assert.deepEqual(polar.bounds, lay.bounds);
});

function kidsOf(nodes) {
  const kids = new Map();
  for (const n of nodes) {
    if (!n.parent) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  return kids;
}

test('islands layout: laid out again only when the tree or a name changes', () => {
  const layout = layoutFor(ASPECT);
  const nodes = fleet();
  const a = layout(nodes);
  const calm = layout(nodes.map((n) => (n.id === 'hv2/room-1' ? { ...n, status: 'crit' } : n)));
  assert.equal(calm.pos, a.pos, 'a status change keeps the layout');
  assert.equal(calm.center.id, '__core');
  const more = layout([...nodes, { id: 'hv2/room-1/svc-x', kind: 'service', parent: 'hv2/room-1', label: 'x', status: 'ok' }]);
  assert.notEqual(more.pos, a.pos, 'a new node lays out again');
  assert.ok(more.pos.has('hv2/room-1/svc-x'));
});

test('clearOf and arrange: outlines apart by the gap, rows tucked under each other', () => {
  const e = { x: 0, y: 0, rx: 100, ry: 50, title: null, box: { x0: -100, x1: 100, y0: -50, y1: 50 } };
  assert.ok(clearOf(e, { x: 0, y: 0 }, e, { x: 200 + SIZES.gap + 1, y: 0 }));
  assert.ok(!clearOf(e, { x: 0, y: 0 }, e, { x: 190, y: 0 }));
  // Diagonal neighbours: the boxes overlap at the corners, the ellipses do not.
  assert.ok(clearOf(e, { x: 0, y: 0 }, e, { x: 180, y: 90 }));
  // A name on top of the coastline counts.
  const t = { ...e, title: { x0: -30, x1: 30, y0: -66, y1: -34 } };
  assert.ok(!clearOf(t, { x: 0, y: 0 }, e, { x: 0, y: -50 - 50 - 10 }));
  // Four islands on a wide area: two rows, the second tucked closer than the boxes allow.
  const r = arrange([e, e, e, e], 520, 200);
  assert.equal(r.at.length, 4);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(clearOf(e, r.at[i], e, r.at[j], SIZES.gap - 1e-6));
  assert.ok(r.scale > 0);
  // Real islands: what shapeOf gives keeps the site's name inside its box.
  const nodes = fleet();
  const isle = island(nodes.find((n) => n.id === 'cloud'), kidsOf(nodes));
  const sh = shapeOf(isle);
  assert.ok(sh.title.y0 >= isle.box.y0 - 1e-6 && sh.title.y1 <= isle.box.y1);
});

test('createMap with the islands options: the overview fits the islands, nothing turns', async (t) => {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, mapOptionsFor(VARIANTS.find((v) => v.id === 'islands'), 1.5));
  t.after(() => { map.destroy(); dom.restore(); });
  map.update({ title: 'acme', nodes: fleet(), links: [], events: [] });
  dom.flush(20);
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const first = map.screenOf('hv1');
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

test('islands registered: options for the screen\'s aspect, no turn, every place named on its coast', () => {
  const v = VARIANTS.find((x) => x.id === 'islands');
  assert.equal(v.mapOptions, mapOptions);
  assert.equal(mapOptions.rings, false);
  assert.equal(mapOptions.labelSize, labelSize);
  assert.deepEqual(ambient, { drift: 0 });
  const o = mapOptionsFor(v, 16 / 9);
  assert.equal(o.ambient, ambient);
  assert.notEqual(o.layout, mapOptions.layout, 'laid out for the asked aspect');
  const wide = o.layout(fleet()).bounds, tablet = optionsFor(1.5).layout(fleet()).bounds;
  assert.ok(wide.x / wide.y > tablet.x / tablet.y, 'a wider screen, a wider view');
  assert.equal(mapOptionsFor(v, NaN).layout, mapOptions.layout, 'no aspect: the tablet\'s');
  // The radial steps; a place's name centred on its coastline, the repo index's at the room step.
  assert.deepEqual(labelSize({ id: 'hv1', kind: 'site' }), { px: 26, inward: true });
  assert.deepEqual(labelSize({ id: '__repos', kind: 'site' }), { px: 15, inward: true });
  assert.equal(labelSize({ id: 'r', kind: 'room' }), 15);
  assert.equal(labelSize({ id: 's', kind: 'service' }, { s: 1 }), 0);
  assert.equal(labelSize({ id: 's', kind: 'service' }, { s: 1, trouble: true }), 15);
  assert.equal(labelSize({ id: '__core', kind: 'core' }), 0);
});
