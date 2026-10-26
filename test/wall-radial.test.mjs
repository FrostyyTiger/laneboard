// The `radial` direction for a wall (Wall plan T11, docs/plans/wall/README.md
// §5): the Map's `labelSize` option (defaults off: the app's labels as
// before) and the radial variant's type steps: sites big, rooms one step
// down, services dots at the overview unless in trouble, named in a site.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../public/js/views/map/render.js';
import { layout } from '../public/js/views/map/layout.js';
import { labelSize, STEPS, IN_SITE, mapOptions } from '../public/js/wall/variants/radial.js';
import { VARIANTS } from '../public/js/wall/variants.js';

function fakeCtx() {
  const noop = () => {};
  return {
    font: '10px x', letterSpacing: '0px', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1,
    lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic',
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, setLineDash: noop, save: noop, restore: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, setTransform: noop, fillText: noop,
    // 0.6 em a character, so a bigger font measures wider.
    measureText(t) { return { width: String(t).length * 0.6 * Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10) }; },
  };
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

const NODES = [
  { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
  { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
  { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'crit' },
  { id: 'hv1/rack', kind: 'room', parent: 'hv1', label: 'rack', status: 'ok' },
  { id: 'hv2/vm', kind: 'room', parent: 'hv2', label: 'vm', status: 'ok' },
  { id: 'hv1/dns', kind: 'service', parent: 'hv1/rack', label: 'dns', status: 'ok' },
  { id: 'hv2/storage', kind: 'service', parent: 'hv2/vm', label: 'storage', status: 'crit' },
];

const W = 1368, H = 912;

function scene(s, extra = {}) {
  const lay = layout(NODES);
  const byId = new Map(NODES.map((n) => [n.id, n]));
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: byId.get(id) ?? lay.center, depth: p.depth });
  }
  return {
    W, H, now: 1000, s, zoom: s,
    toScreen: (p) => ({ x: W / 2 + p.x * s, y: H / 2 + p.y * s }),
    pos: lay.pos, nodes: cur, byId, links: [], overlay: 'status',
    rolled: () => null, folded: new Set(), kids: lay.kids, alpha: () => 1,
    hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null, rings: false,
    ...extra,
  };
}

function boxes(sc) {
  const r = createRenderer(fakeCtx(), PAL);
  const badges = r.drawNodes(sc);
  return new Map(r.labelBoxes(sc, badges).map((b) => [b.text, b]));
}

const height = (b) => Math.round(b.y1 - b.y0);

test('radial labelSize: sites over rooms, services dots at the overview unless in trouble', () => {
  assert.ok(STEPS.site > STEPS.room && STEPS.room > 11, 'two steps above the Map\'s 11px');
  assert.deepEqual(labelSize({ id: 'hv1', kind: 'site' }), { px: STEPS.site, inward: true });
  assert.deepEqual(labelSize({ id: 'hv1', kind: 'host' }), { px: STEPS.site, inward: true });
  assert.equal(labelSize({ id: '__repos', kind: 'site' }), STEPS.room, 'a made-up grouping is no place');
  assert.equal(labelSize({ kind: 'room' }), STEPS.room);
  assert.equal(labelSize({ kind: 'builder' }), STEPS.room);
  assert.equal(labelSize({ kind: 'service' }, { s: 1 }), 0, 'a calm service is a dot');
  assert.equal(labelSize({ kind: 'lane' }, { s: 1 }), 0);
  assert.equal(labelSize({ kind: 'service' }, { s: 1, trouble: true }), STEPS.room, 'trouble is named');
  assert.equal(labelSize({ kind: 'service' }, { s: IN_SITE + 0.5 }), undefined, 'in a site: the Map\'s size');
  assert.equal(labelSize({ kind: 'service' }, { s: IN_SITE + 0.5, trouble: true }), STEPS.room);
  assert.equal(labelSize(null), 0);
  assert.equal(labelSize({ kind: 'core' }), 0, 'the tag names the core');
  assert.equal(VARIANTS.find((v) => v.id === 'radial').mapOptions, mapOptions);
  assert.equal(mapOptions.labelSize, labelSize);
});

test('renderer: no labelSize keeps today\'s 14px label lines and names services by depth', () => {
  const b = boxes(scene(1));
  assert.equal(height(b.get('HV1')), 14);
  assert.equal(height(b.get('RACK')), 14);
  assert.ok(b.has('STORAGE'), 'the crit service is named');
});

test('renderer: the radial steps size the boxes, drop calm services at the overview and name them in a site', () => {
  const b = boxes(scene(1, { labelSize }));
  assert.ok(height(b.get('HV1')) > height(b.get('RACK')), 'site line taller than room line');
  assert.ok(height(b.get('RACK')) > 14, 'room line above the Map\'s');
  assert.ok(b.get('HV1').x1 - b.get('HV1').x0 > 3 * 0.6 * STEPS.site, 'the site box holds its text at the site step');
  assert.ok(!b.has('DNS'), 'a calm service has no name at the overview');
  assert.ok(!b.has('ACME'), 'nor the core');
  assert.ok(b.has('STORAGE'), 'trouble keeps its name');
  assert.equal(height(b.get('STORAGE')), height(b.get('RACK')), 'trouble at the room step');
  const placed = [...b.values()];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const [p, q] = [placed[i], placed[j]];
    assert.ok(!(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1), `${p.text} clear of ${q.text}`);
  }
  const zoomed = boxes(scene(IN_SITE + 0.5, { labelSize }));
  assert.ok(zoomed.has('DNS'), 'in a site the service is named');
  assert.equal(height(zoomed.get('DNS')), 14, 'at the Map\'s own size');
});

test('renderer: an inward label sits on the bearing from its node toward the centre', () => {
  const sc = scene(1, { labelSize });
  const b = boxes(sc);
  const c = { x: W / 2, y: H / 2 };
  for (const id of ['hv1', 'hv2']) {
    const sp = sc.toScreen(sc.nodes.get(id));
    const box = b.get(id.toUpperCase());
    const m = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    assert.ok(Math.hypot(m.x - c.x, m.y - c.y) < Math.hypot(sp.x - c.x, sp.y - c.y), `${id} label nearer the centre than its node`);
    // On the line node -> centre: the cross product over the node's distance is the label's distance off it.
    const off = Math.abs((c.x - sp.x) * (m.y - sp.y) - (c.y - sp.y) * (m.x - sp.x)) / Math.hypot(c.x - sp.x, c.y - sp.y);
    assert.ok(off < 3, `${id} label on the bearing (${off.toFixed(1)}px off)`);
    assert.ok(!(box.x0 < sp.x && sp.x < box.x1 && box.y0 < sp.y && sp.y < box.y1), `${id} label off its node`);
  }
});

test('radial layout: the Map\'s rings on wall radii, angles and staggers kept, ring hairlines follow', async () => {
  const { layout: wallLayout, WALL_RINGS } = await import('../public/js/wall/variants/radial.js');
  const { RINGS, ringLabels, polarLayout } = await import('../public/js/views/map/layout.js');
  assert.equal(WALL_RINGS.length, RINGS.length);
  assert.ok(WALL_RINGS[1] > RINGS[1] && WALL_RINGS[2] > RINGS[2], 'sites and rooms get more room');
  assert.ok(Math.abs(WALL_RINGS.at(-1) - RINGS.at(-1)) <= 16, 'the outermost ring stays about where it was');
  for (let i = 1; i < WALL_RINGS.length; i++) assert.ok(WALL_RINGS[i] > WALL_RINGS[i - 1], 'rings grow outward');
  const base = layout(NODES);
  const wall = wallLayout(NODES);
  for (const [id, p] of base.pos) {
    const q = wall.pos.get(id);
    assert.equal(q.angle, p.angle, `${id} keeps its angle`);
    assert.equal(q.ring, p.ring);
    assert.ok(Math.abs(q.r - (p.ring ? WALL_RINGS[p.ring] + p.r - RINGS[p.ring] : 0)) < 1e-9, `${id} on its wall ring`);
    assert.ok(Math.abs(Math.hypot(q.x, q.y) - q.r) < 1e-9);
  }
  const rings = ringLabels(polarLayout(wall).pos, NODES);
  assert.deepEqual(rings.map((r) => r.r), rings.map((r) => WALL_RINGS[r.ring]), 'legends and hairlines on the wall radii');
  assert.deepEqual(ringLabels(base.pos, NODES).map((r) => r.r), rings.map((r) => RINGS[r.ring]), 'default: RINGS');
  assert.equal(mapOptions.layout, wallLayout);
});

test('renderer: a pinned name keeps its side as the turn carries its bearing past the vertical', () => {
  // hv1/rack's bearing, turned to just right of straight up, then just left.
  const lay = layout(NODES);
  const t = lay.pos.get('hv1/rack').angle;
  const right = -Math.PI / 2 + 0.15 - t, leftward = -Math.PI / 2 - 0.15 - t;
  const centreX = (b) => (b.x0 + b.x1) / 2;
  const draw = (r, sc) => new Map(r.labelBoxes(sc, r.drawNodes(sc)).map((b) => [b.text, b]));

  // Off (the app): the name flips to the node's other side.
  const plain = createRenderer(fakeCtx(), PAL);
  const a = draw(plain, scene(1, { labelSize, spin: right }));
  const b = draw(plain, scene(1, { labelSize, spin: leftward }));
  const sx = scene(1).toScreen(scene(1).nodes.get('hv1/rack')).x;
  assert.ok(a.get('RACK').x0 >= sx - 4, 'right of the vertical: reads rightward from the node');
  assert.ok(b.get('RACK').x1 <= sx + 4, 'left of it: flipped to read leftward');

  // On (the Wall): the same two frames keep the first frame's side.
  const pinned = createRenderer(fakeCtx(), PAL);
  const p = draw(pinned, scene(1, { labelSize, pinLabels: true, spin: right }));
  const q = draw(pinned, scene(1, { labelSize, pinLabels: true, spin: leftward }));
  assert.ok(p.get('RACK').x0 >= sx - 4);
  assert.ok(q.get('RACK').x0 >= sx - 30, 'still on its first side');
  assert.ok(Math.abs(centreX(q.get('RACK')) - centreX(p.get('RACK'))) < 30, 'and about where it was');
  assert.equal(Math.round(q.get('RACK').y0) - Math.round(p.get('RACK').y0) <= 2, true, 'on the same line');

  // Well past the vertical it does turn over.
  const far = draw(pinned, scene(1, { labelSize, pinLabels: true, spin: -Math.PI / 2 - 0.9 - t }));
  assert.ok(far.get('RACK').x1 <= sx + 4, 'past the hysteresis it reads leftward');
});

test('renderer: a pinned name keeps the line the collision pass gave it while a neighbour comes and goes', () => {
  const pinned = createRenderer(fakeCtx(), PAL);
  const sc = scene(1, { labelSize, pinLabels: true });
  const first = new Map(pinned.labelBoxes(sc, pinned.drawNodes(sc)).map((b) => [b.text, b]));
  const again = new Map(pinned.labelBoxes(sc, pinned.drawNodes(sc)).map((b) => [b.text, b]));
  for (const [k, v] of first) assert.deepEqual(again.get(k), v, `${k} drawn twice in the same place`);
});
