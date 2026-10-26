// The `mosaic` direction for a wall (Wall plan T14, the wild card from
// research/Q5-hex-mosaic-wild-card.md): a honeycomb, one tile per place,
// each site one connected region with an empty channel round it, the site in
// the middle and the worst rooms nearest it, trouble as the tile's tone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { polarLayout } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';
import {
  layoutFor, mosaic, tilesOf, slots, grow, hexDist, hexToPx, hexCorners, plateCorners, plateRoom, siteStep, labelSize, labelSizeOn,
  optionsFor, mapOptions, ambient, SAFE, SIZES, ASPECT, REF_H, NAME_MARGIN,
} from '../public/js/wall/variants/mosaic.js';
import { stepsFor, pxPerMm, textW } from '../public/js/wall/type.js';
import { VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';

/** A fleet the size of the large demo (islands' fixture): five sites, a builder with lanes, a repo index, a run. */
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
  nodes.push({ id: '__repos', kind: 'site', parent: '__core', label: 'REPOS', status: 'ok' });
  nodes.push({ id: 'repo:acme', kind: 'repo', parent: '__repos', label: 'acme', status: 'ok' });
  nodes.push({ id: 'run:x', kind: 'run', parent: '__core', label: 'search', status: 'working' });
  return nodes;
}

const FREE = (aspect) => (aspect * (1 - 2 * SAFE.side)) / (1 - SAFE.top - SAFE.bottom);
const SQ3 = Math.sqrt(3);

test('hex geometry: pixel centres one step apart, corners on the circumradius', () => {
  const s = 10;
  const a = hexToPx(0, 0, s);
  for (const [q, r] of [[1, 0], [0, 1], [-1, 1]]) {
    const b = hexToPx(q, r, s);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - SQ3 * s) < 1e-9, 'neighbours √3·s apart');
    assert.equal(hexDist({ q: 0, r: 0 }, { q, r }), 1);
  }
  assert.equal(hexDist({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  const cs = hexCorners(5, 5, s);
  assert.equal(cs.length, 6);
  for (const [x, y] of cs) assert.ok(Math.abs(Math.hypot(x - 5, y - 5) - s) < 1e-9);
  assert.ok(cs.some(([x, y]) => Math.abs(x - 5) < 1e-9 && y > 5), 'pointy top: a corner straight below');
});

for (const [name, aspect] of [['3:2', 3 / 2], ['16:9', 16 / 9]]) {
  test(`mosaic at ${name}: one cell per place, each region connected, a channel between regions`, () => {
    const nodes = fleet();
    const m = mosaic(nodes, FREE(aspect));
    const places = nodes.filter((n) => ['core', 'site', 'room', 'builder', 'repo'].includes(n.kind));
    assert.equal(m.tiles.length, places.length, 'a tile per place, none for a service, lane or run');
    const cellsOf = (t) => t.cells ?? [t.cell];
    const all = m.tiles.flatMap((t) => cellsOf(t).map((c) => ({ c, t })));
    const keys = new Set(all.map(({ c }) => `${c.q},${c.r}`));
    assert.equal(keys.size, all.length, 'no two tiles on a cell');
    const owner = new Map(all.map(({ c, t }) => [`${c.q},${c.r}`, t.region]));
    for (const a of all) {
      for (const b of all) {
        if (a.t.region !== b.t.region && hexDist(a.c, b.c) < 2) assert.fail(`${a.t.node.id} next to ${b.t.node.id} of another site`);
      }
    }
    // Each site's tile is a plate of two cells side by side; the hub's and REPOS' one cell.
    for (const t of m.tiles) {
      const plate = ['site', 'host'].includes(t.node.kind) && !String(t.node.id).startsWith('__');
      assert.equal(Boolean(t.cells), plate, `${t.node.id}: ${plate ? 'a plate' : 'one cell'}`);
      if (plate) {
        assert.deepEqual([t.cells[1].q - t.cells[0].q, t.cells[1].r - t.cells[0].r], [1, 0], 'the second cell east of the first');
        assert.ok(Math.abs(t.cell.x - (t.cells[0].x + t.cells[1].x) / 2) < 1e-9, 'its centre between them');
      }
    }
    m.regions.forEach((reg, i) => {
      // Connected: every cell reached from the first by steps of one inside the region.
      const mine = reg.cells.filter((c) => owner.get(`${c.q},${c.r}`) === i);
      const seen = new Set([`${mine[0].q},${mine[0].r}`]);
      const todo = [mine[0]];
      while (todo.length) {
        const c = todo.pop();
        for (const d of mine) {
          const k = `${d.q},${d.r}`;
          if (!seen.has(k) && hexDist(c, d) === 1) { seen.add(k); todo.push(d); }
        }
      }
      assert.equal(seen.size, mine.length, `${reg.site.id} in one piece`);
    });
    // The site's own tile is the region's first: everything else spirals out from it.
    for (const reg of m.regions) {
      const t = m.tiles.find((x) => x.node.id === reg.site.id);
      assert.deepEqual([t.cell.q, t.cell.r], [reg.cells[0].q, reg.cells[0].r]);
    }
  });

  test(`mosaic layout at ${name}: inside the safe area, the width used, dots in their tile`, () => {
    const nodes = fleet();
    const lay = layoutFor(aspect)(nodes);
    const H = 912, W = H * aspect;
    const k = Math.min(W / (2 * lay.bounds.x), H / (2 * lay.bounds.y));
    const toScreen = (p) => ({ x: W / 2 + p.x * k, y: H / 2 + (p.y - lay.bounds.cy) * k });
    let x0 = Infinity, x1 = -Infinity;
    for (const g of lay.guides) {
      for (const p of g.pts) {
        const sp = toScreen({ x: p[0], y: p[1] });
        assert.ok(sp.x >= W * SAFE.side - 1 && sp.x <= W * (1 - SAFE.side) + 1, 'inside the sides');
        assert.ok(sp.y >= H * SAFE.top - 1 && sp.y <= H * (1 - SAFE.bottom) + 1, 'above the bottom band, below the tag');
        x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x);
      }
    }
    assert.ok((x1 - x0) / W > 0.6, `the width used (${((x1 - x0) / W).toFixed(2)})`);
    for (const n of nodes) assert.ok(lay.pos.has(n.id), `${n.id} placed`);
    // Every dot (a service, lane, session, run) inside the tile of the place that holds it.
    const m = mosaic(nodes, FREE(aspect));
    for (const t of m.tiles) {
      for (const d of t.dots) {
        const p = lay.pos.get(d.id);
        assert.ok(Math.hypot(p.x - t.cell.x, p.y - t.cell.y) < SIZES.hex * SIZES.tile, `${d.id} in ${t.node.id}'s tile`);
      }
    }
    assert.equal(lay.pos.get('builder:builder-a').branch, 'none');
    assert.equal(lay.pos.get('hv1/room-3').labelAngle, Math.PI / 2, 'names under their marks');
  });
}

test('mosaic: the worst rooms nearest the site, a builder after its room', () => {
  const nodes = fleet().map((n) => (n.id === 'hv1/room-12' ? { ...n, status: 'crit' } : n.id === 'hv1/room-9/svc-0' ? { ...n, status: 'warn' } : n));
  const kids = new Map();
  for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const order = tilesOf(nodes.find((n) => n.id === 'hv1'), kids).map((t) => t.node.id);
  assert.deepEqual(order.slice(0, 3), ['hv1', 'hv1/room-12', 'hv1/room-9'], 'site, crit room, room with a warn service');
  assert.equal(order[order.indexOf('hv1/room-0') + 1], 'builder:builder-a');
  const m = mosaic(nodes, FREE(ASPECT));
  const cell = (id) => m.tiles.find((t) => t.node.id === id).cell;
  assert.equal(hexDist(cell('hv1'), cell('hv1/room-12')), 1, 'the crit room next to the site');
});

test('mosaic layout: a status change keeps every tile and recolours it; a new node lays out again', () => {
  const layout = layoutFor(ASPECT);
  const nodes = fleet();
  const a = layout(nodes);
  assert.ok(a.guides.every((g) => !g.tone), 'a calm fleet: no toned tile');
  assert.equal(layout(nodes).guides, a.guides, 'the same statuses: the same guides');
  const hot = layout(nodes.map((n) => (n.id === 'lane:a/1' ? { ...n, status: 'crit' } : n.id === 'hv2/room-1' ? { ...n, status: 'attention' } : n)));
  assert.equal(hot.pos, a.pos, 'nothing moves for a status');
  assert.deepEqual(hot.guides.filter((g) => g.tone).map((g) => g.tone).sort(), ['crit', 'warn'], 'the lane colours its builder tile');
  const m = mosaic(nodes, FREE(ASPECT));
  const bi = m.tiles.findIndex((t) => t.node.id === 'builder:builder-a');
  assert.equal(hot.guides[bi].tone, 'crit');
  const more = layout([...nodes, { id: 'hv2/room-x', kind: 'room', parent: 'hv2', label: 'x', status: 'ok' }]);
  assert.notEqual(more.pos, a.pos);
  assert.ok(more.pos.has('hv2/room-x'));
  // The same fleet, the same picture.
  assert.deepEqual([...layoutFor(ASPECT)(nodes).pos], [...a.pos]);
  // Polar for the Map, guides and bounds passed on.
  const polar = polarLayout(a);
  assert.equal(polar.guides, a.guides);
  assert.deepEqual(polar.bounds, a.bounds);
});

test('slots and grow: slots tile the area, a region with no room fails the grid', () => {
  const sl = slots([10, 10, 10, 10], 400, 200);
  assert.equal(sl.length, 4);
  const area = sl.reduce((s, x) => s + x.w * x.h, 0);
  assert.ok(Math.abs(area - 400 * 200) < 1e-6);
  assert.equal(grow([30], [{ x: 0, y: 0, w: 100, h: 100 }], 3, 3, 10), null, '30 cells on a 3 x 3 grid');
  const two = grow([3, 3], [{ x: -30, y: 0, w: 50, h: 50 }, { x: 30, y: 0, w: 50, h: 50 }], 6, 3, 10);
  assert.ok(two && two[0].length === 3 && two[1].length === 3);
  for (const c of two[0]) for (const d of two[1]) assert.ok(hexDist(c, d) >= 2, 'a channel between them');
});

test('mosaic labels: sites at the site step, places at the room step, dots unnamed at the overview', () => {
  const lone = labelSizeOn();
  assert.deepEqual(lone({ id: 'hv1', kind: 'site' }), { px: 35, inward: true }, 'the tablet\'s site step before any layout, centred on its labelAt');
  assert.equal(lone({ id: '__repos', kind: 'site' }), 15, 'the hub\'s grouping at the room step');
  assert.equal(labelSize({ id: 'r', kind: 'room' }), 15);
  assert.equal(labelSize({ id: 'b', kind: 'builder' }), 15);
  assert.equal(labelSize({ id: 'l', kind: 'lane' }, { s: 1, trouble: true }), 0, 'the tile says it at the overview');
  assert.equal(labelSize({ id: 'l', kind: 'lane' }, { s: 2, trouble: true }), 15, 'named in its site');
  assert.equal(labelSize({ id: '__core', kind: 'core' }), 0);
});

test('mosaic variant: registered with its options, no turn', () => {
  const v = VARIANTS.find((x) => x.id === 'mosaic');
  assert.ok(v, 'in the registry');
  assert.equal(mapOptions.rings, false);
  assert.equal(typeof optionsFor(16 / 9).layout, 'function');
  const o = mapOptionsFor(v, 16 / 9);
  assert.deepEqual(o.ambient, { drift: 0 });
  assert.equal(typeof o.labelSize, 'function');
  assert.equal(o.pinLabels, undefined, 'no pins: nothing turns (round 40 still)');
  assert.equal(ambient.drift, 0);
});

test('renderer: a polygon guide is a closed path, a toned one filled in its tone', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => { if (k === 'fillStyle' || k === 'strokeStyle') calls.push([`set:${k}`, v]); o[k] = v; return true; },
  });
  const r = createRenderer(ctx, { crit: '#f00', line: '#888', t3: '#666' });
  const sc = { W: 1200, H: 800, s: 1, toScreen: (p) => ({ x: p.x + 600, y: p.y + 400 }), pos: new Map(), byId: new Map(), nodes: new Map(), rings: false };
  const hex = hexCorners(0, 0, 10);
  r.drawRings({ ...sc, guides: [{ pts: hex }, { pts: hex, tone: 'crit' }, { pts: [[0, 0], [1, 1]] }] });
  assert.equal(calls.filter(([k]) => k === 'closePath').length, 2, 'two tiles; two points are no tile');
  assert.equal(calls.filter(([k]) => k === 'lineTo').length, 10);
  assert.equal(calls.filter(([k]) => k === 'fill').length, 1, 'only the toned tile is filled');
  assert.ok(calls.some(([k, v]) => k === 'set:fillStyle' && v === '#f00'), 'in its tone');
  assert.equal(calls.filter(([k]) => k === 'ellipse').length, 0);
});

test('siteStep: the screen\'s site step when the longest name fits, else the next that does, never the room step', () => {
  const tablet = { site: 35, room: 15 };
  const n = (label) => ({ id: label, kind: 'site', label });
  assert.equal(siteStep([n('hv1'), n('remote')], tablet, 160), 35, 'REMOTE at 35 is ~104 px');
  assert.equal(siteStep([n('hv1'), n('remote')], tablet, 100), 26, 'not at 35, at 26');
  assert.equal(siteStep([n('hv1'), n('remote')], tablet, 70), 20);
  assert.equal(siteStep([n('a-very-long-site-name')], tablet, 70), 20, 'a step above the rooms whatever the name');
  assert.equal(siteStep([n('hv1')], { site: 26, room: 11 }, 160), 26, 'a desk monitor\'s step');
  assert.equal(siteStep([], tablet, 10), 35, 'no sites: nothing to fit');
  for (const px of [35, 26, 20]) {
    const want = textW('REMOTE', px) + 2 * NAME_MARGIN;
    assert.equal(siteStep([n('remote')], tablet, want), px, `exactly fits at ${px}`);
  }
});

for (const [name, aspect] of [['3:2', 3 / 2], ['16:9', 16 / 9]]) {
  test(`mosaic at ${name}: every site name fits its plate at the overview, on the tablet and a desk monitor`, () => {
    for (const screen of [{ dpr: 2, cssHeight: REF_H }, { dpr: 1, cssHeight: 1080 }]) {
      const steps = stepsFor(pxPerMm(screen));
      const o = optionsFor(aspect, screen);
      const nodes = fleet();
      const lay = o.layout(nodes);
      const H = screen.cssHeight, W = H * aspect;
      const k = Math.min(W / (2 * lay.bounds.x), H / (2 * lay.bounds.y));
      const px = o.labelSize(nodes.find((x) => x.id === 'remote'), { s: k }).px;
      assert.equal(px, steps.site, `the screen's site step (${steps.site}) for a short-named fleet`);
      assert.ok(px > o.labelSize({ id: 'r', kind: 'room' }, { s: k }), 'sites a step above rooms');
      const plateW = plateRoom() * k;
      // The name centred between the mark and the plate's right side, on its middle line.
      const site = mosaic(nodes, FREE(aspect)).tiles.find((t) => t.node.id === 'remote');
      const p = lay.pos.get('remote');
      assert.equal(p.labelAt.y, site.cell.y);
      assert.ok(p.x < site.cells[0].x && p.labelAt.x > site.cells[0].x, 'the mark left in the plate, the name after it');
      // Flush left a step after the mark: the name's left edge at the same place on every plate, its right inside the plate.
      for (const id of ['hv1', 'remote']) {
        const t = mosaic(nodes, FREE(aspect)).tiles.find((x) => x.node.id === id);
        const q = lay.pos.get(id);
        const w = textW(id.toUpperCase(), px) / k;
        assert.ok(Math.abs(q.labelAt.x - w / 2 - (t.cells[0].x + SIZES.hex * SIZES.plateName)) < 1e-9, `${id} flush left`);
        assert.ok(q.labelAt.x + w / 2 <= t.cells[1].x + (SQ3 / 2) * SIZES.hex * SIZES.tile + 1e-9, `${id} inside its plate`);
      }
      for (const id of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
        assert.ok(textW(id.toUpperCase(), px) + 2 * NAME_MARGIN <= plateW, `${id} at ${px} px in a ${plateW.toFixed(0)} px plate`);
      }
      // A fleet with a long site name: every site steps down together.
      const long = nodes.map((x) => (x.id === 'cloud' ? { ...x, label: 'cloud-frankfurt-north-1' } : x));
      const o2 = optionsFor(aspect, screen);
      o2.layout(long);
      const px2 = o2.labelSize({ id: 'hv1', kind: 'site' }, { s: k }).px;
      assert.ok(px2 < steps.site, `${px2} below ${steps.site}`);
      assert.equal(o2.labelSize({ id: 'cloud', kind: 'site' }, { s: k }).px, px2, 'one size for every site');
    }
  });
}

test('plateCorners: two hexes as one outline, ten corners, the joint at the middle', () => {
  const s = 10, pitch = SQ3 * s;
  const pts = plateCorners(0, 0, s, pitch);
  assert.equal(pts.length, 10);
  const xs = pts.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) + pitch / 2) < 1e-9 && Math.abs(Math.max(...xs) - 1.5 * pitch) < 1e-9, 'flat sides of both cells');
  const joints = pts.filter((p) => Math.abs(p[0] - pitch / 2) < 1e-9);
  assert.equal(joints.length, 2, 'the shared edge\'s ends, top and bottom');
  for (const [x, y] of pts) {
    const inA = Math.hypot(x, y) <= s + 1e-9, inB = Math.hypot(x - pitch, y) <= s + 1e-9;
    assert.ok(inA || inB, 'every corner on one of the two hexes');
  }
});
