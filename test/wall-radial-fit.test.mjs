// The radial overview's fit and safe area (Wall plan T17, docs/plans/wall/README.md
// §5): the overview fits the drawn nodes and their names, not the outer ring, into
// the screen less a safe area (6 % sides, 8 % top, the frame's bottom band), and
// keeps the marks off the caption's head, at every bearing the turn carries them through.
// The fleet is the large demo as the Wall gets it (test/fixtures/wall-large-map.json:
// `/api/map` plus the runs from `/ws`, demo names only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createRenderer } from '../public/js/views/map/render.js';
import { polarLayout } from '../public/js/views/map/layout.js';
import { foldState, autoFold } from '../public/js/views/map/model.js';
import {
  SAFE, REF, ambient, fitBounds, layoutFor, reachOf, holdZoom, HOLD_SCALE, IN_SITE,
  labelSizeFor, mapOptions, optionsFor, STEPS,
} from '../public/js/wall/variants/radial.js';
import { VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';
import { stepsFor, pxPerMm } from '../public/js/wall/type.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

function fakeCtx() {
  const noop = () => {};
  return {
    font: '10px x', letterSpacing: '0px', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1,
    lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic',
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, setLineDash: noop, save: noop, restore: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, setTransform: noop, fillText: noop, drawImage: noop,
    // The condensed label face: a caps character about 0.44 em (type.js textW); the
    // renderer adds the tracking itself. Mono (the round, 10 px subs) at 0.6 em.
    measureText(t) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      return { width: String(t).length * (/MONO/.test(this.font) ? 0.6 : 0.44) * px };
    },
  };
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

/** The overview as the Map has it: what autoFold hides at zoom 1 is not laid out. */
function overview(nodes, aspect, H) {
  const fs0 = foldState(nodes, [], autoFold(nodes, { zoom: 1 }));
  const shown = nodes.filter((n) => !fs0.hidden.has(n.id));
  const lay = polarLayout(layoutFor({ aspect, cssHeight: H })(shown));
  return { lay, shown, folded: fs0.folded };
}

/** The scene at the overview with the view turned by `spin`, the Map's fit from `bounds`. */
function sceneAt({ lay, shown, folded }, W, H, spin) {
  const k = Math.min(W / (2 * lay.bounds.x), H / (2 * lay.bounds.y));
  const byId = new Map(shown.map((n) => [n.id, n]));
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: byId.get(id) ?? lay.center, depth: p.depth });
  }
  const cy = H * ambient.centerY;
  const cs = Math.cos(spin), sn = Math.sin(spin);
  return {
    k,
    W, H, now: 1000, s: k, zoom: 1, spin,
    toScreen: (p) => ({ x: W / 2 + (p.x * cs - p.y * sn) * k, y: cy + (p.x * sn + p.y * cs) * k }),
    pos: lay.pos, nodes: cur, byId, links: [], overlay: 'status',
    rolled: () => null, folded, kids: lay.kids, alpha: () => 1,
    hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null, rings: true,
    labelSize: labelSizeFor(STEPS), pinLabels: true, labelInset: mapOptions.labelInset, labelClear: mapOptions.labelClear,
  };
}

/** The safe rectangle on screen, and the caption's head (kicker and name, wall.css: 8vh, 6vw, ~12vmin tall). */
function zones(W, H) {
  const vmin = Math.min(W, H);
  return {
    safe: { x0: W * SAFE.side, y0: H * SAFE.top, x1: W * (1 - SAFE.side), y1: H * (1 - SAFE.bottom) },
    caption: { x0: W * 0.06, y0: H * 0.08, x1: W * 0.06 + 0.26 * vmin, y1: H * 0.08 + 0.13 * vmin },
  };
}

const inside = (b, z) => b.x0 >= z.x0 - 0.5 && b.y0 >= z.y0 - 0.5 && b.x1 <= z.x1 + 0.5 && b.y1 <= z.y1 + 0.5;
const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

for (const [name, W, H] of [['3:2 tablet', 1368, 912], ['16:9 screen', 1366, 768]]) {
  test(`radial fit, ${name}: every node and name inside the safe area, no node under the caption's head, over a whole turn`, () => {
    const ov = overview(FLEET, W / H, H);
    const r = createRenderer(fakeCtx(), PAL);
    const { safe, caption } = zones(W, H);
    const out = new Set();
    let labels = 0;
    // A turn in 3° steps, in order, so pinned names keep their sides as they do on the Wall.
    for (let i = 0; i < 120; i++) {
      const sc = sceneAt(ov, W, H, (i / 120) * Math.PI * 2);
      const badges = r.drawNodes(sc);
      for (const [id, c] of sc.nodes) {
        if (!c.node || c.node.virtual) continue;
        const p = sc.toScreen(c);
        const box = { x0: p.x - 12, y0: p.y - 12, x1: p.x + 12, y1: p.y + 12 };
        if (!inside(box, safe)) out.add(`node ${id} at ${i * 3}°`);
        if (hits(box, caption)) out.add(`node ${id} under the caption at ${i * 3}°`);
      }
      for (const b of r.labelBoxes(sc, badges)) {
        labels++;
        if (!inside(b, safe)) out.add(`${b.text} at ${i * 3}° (${b.x0.toFixed(0)},${b.y0.toFixed(0)})-(${b.x1.toFixed(0)},${b.y1.toFixed(0)})`);
        // A name may pass the caption's corner at the overview: the caption is up only in a hold.
      }
      for (const b of badges) {
        const box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
        if (!inside(box, safe)) out.add(`fold plate ${b.text ?? ''} at ${i * 3}°`);
      }
    }
    assert.ok(labels > 120 * 40, 'the overview names its places');
    assert.deepEqual([...out].slice(0, 12), [], `${out.size} outside`);
  });
}

for (const [name, W, H] of [['3:2 tablet', 1368, 912], ['16:9 screen', 1366, 768]]) {
  test(`radial names, ${name}: no name lies on another over a whole turn, trouble always named (T46)`, () => {
    assert.equal(mapOptions.labelClear, true, 'wall.html asks the Map for clear names');
    const ov = overview(FLEET, W / H, H);
    const r = createRenderer(fakeCtx(), PAL);
    const loud = new Set(ov.shown.filter((n) => ['warn', 'crit', 'down', 'attention', 'error'].includes(n.status))
      .map((n) => String((n.kind === 'builder' ? n.builder : null) ?? n.label ?? n.id).toUpperCase()));
    const over = new Map(), lost = new Set();
    let named = 0;
    for (let i = 0; i < 120; i++) {
      const sc = sceneAt(ov, W, H, (i / 120) * Math.PI * 2);
      const bs = r.labelBoxes(sc, r.drawNodes(sc));
      named += bs.length;
      for (let a = 0; a < bs.length; a++) {
        for (let b = a + 1; b < bs.length; b++) {
          if (hits(bs[a], bs[b])) { const k = `${bs[a].text}/${bs[b].text}`; over.set(k, (over.get(k) ?? 0) + 1); }
        }
      }
      const shown = new Set(bs.map((b) => b.text));
      for (const t of loud) if (!shown.has(t)) lost.add(`${t} at ${i * 3}°`);
    }
    assert.deepEqual([...over].slice(0, 8), [], 'the film\'s pile at the ring\'s top (BUILDER-A, FEAT-SEARCH, CI-RETRY, ACME-BILLING)');
    assert.deepEqual([...lost].slice(0, 8), [], 'a name in trouble is never the one left out');
    // Left out is the exception: a calm name with no free place, for a few bearings.
    const withOut = (() => {
      const r0 = createRenderer(fakeCtx(), PAL);
      let n = 0;
      for (let i = 0; i < 120; i++) {
        const sc = { ...sceneAt(ov, W, H, (i / 120) * Math.PI * 2), labelClear: false };
        n += r0.labelBoxes(sc, r0.drawNodes(sc)).length;
      }
      return n;
    })();
    assert.ok(named >= withOut * 0.97, `almost every name stays (${named} of ${withOut})`);
  });
}

test('radial fit: names a node could carry count, so trouble coming or going does not move the overview', () => {
  const calm = FLEET.map((n) => ({ ...n, status: n.kind === 'core' ? n.status : 'ok' }));
  const loud = FLEET.map((n) => (n.kind === 'lane' || n.kind === 'session' ? { ...n, status: 'crit' } : n));
  const k = (nodes) => polarLayout(layoutFor()(nodes)).bounds.y;
  assert.equal(k(calm), k(FLEET));
  assert.equal(k(loud), k(FLEET));
});

test('radial fit: smaller than the outer ring fit, the view centred in the safe rectangle', () => {
  const { lay } = overview(FLEET, REF.aspect, REF.cssHeight);
  const W = REF.aspect * REF.cssHeight, H = REF.cssHeight;
  const k = Math.min(W / (2 * lay.bounds.x), H / (2 * lay.bounds.y));
  let outer = 0;
  for (const p of lay.pos.values()) outer = Math.max(outer, p.r);
  assert.ok(k < (H / 2) / (outer + 64), 'tighter than the Map\'s own fit (it fits the ring to the screen\'s edge)');
  assert.ok(k > 0.35, `but not a speck (${k.toFixed(3)})`);
  assert.equal(lay.bounds.cy, 0, 'the camera on the core');
  assert.equal(ambient.centerY, SAFE.top + (1 - SAFE.top - SAFE.bottom) / 2, 'the core in the middle of the safe rectangle');
  assert.ok(ambient.centerY < 0.5, 'lifted off the bottom band');
});

test('radial reach: a site\'s name points inward, a room\'s and any trouble\'s run outward, a run carries its round', () => {
  assert.equal(reachOf({ id: 'hv1', kind: 'site' }).w, 0);
  assert.equal(reachOf({ id: '__core', kind: 'core' }).w, 0);
  assert.ok(reachOf({ id: 'db', kind: 'room', label: 'db' }).w > 0);
  const short = reachOf({ id: 's', kind: 'service', label: 'dns' });
  const long = reachOf({ id: 'l', kind: 'service', label: 'secrets-audit-log' });
  assert.ok(long.w > short.w && short.w > 0, 'a calm service could be named in trouble: its name counts');
  const run = { id: 'run:x', kind: 'run', label: 'acme-billing', tasks: { value: 1, max: 6 } };
  assert.ok(reachOf(run).w > reachOf({ ...run, kind: 'lane', tasks: undefined }).w, 'the round rides after the name');
  assert.equal(reachOf({ id: 'b', kind: 'builder', label: 'BA', builder: 'builder-a' }).w,
    reachOf({ id: 'c', kind: 'room', label: 'builder-a' }).w, 'a builder by its builder name');
});

test('radial fit: an empty or one-node fleet falls back to scale 1', () => {
  const b = fitBounds(new Map(), new Map());
  assert.equal(b.safe.k, 1);
  const one = fitBounds(new Map([['__core', { x: 0, y: 0, ringR: 0 }]]), new Map());
  assert.equal(one.safe.k, 1);
});

test('radial holds: the tour flies in to the hold scale, at least the timing\'s zoom, at most the Map\'s 6', () => {
  assert.equal(holdZoom(0.45, 2.3), HOLD_SCALE / 0.45);
  assert.ok(HOLD_SCALE > IN_SITE, 'services are named in a hold');
  assert.equal(holdZoom(1, 2.3), 2.3, 'a big overview keeps the timing\'s zoom');
  assert.equal(holdZoom(0.1, 2.3), 6);
  assert.equal(holdZoom(undefined, 2.3), 2.3);
});

test('radial options: the fit rides the layout for the screen; the page gets the ambient centre and the hold zoom', () => {
  const radial = VARIANTS.find((v) => v.id === 'radial');
  assert.equal(radial.ambient, ambient);
  assert.equal(radial.holdZoom, holdZoom);
  const opts = mapOptionsFor(radial, 16 / 9, { dpr: 2, cssHeight: 768 });
  assert.deepEqual(opts.ambient, ambient);
  const wide = polarLayout(opts.layout(FLEET)).bounds;
  const tablet = polarLayout(mapOptions.layout(FLEET)).bounds;
  assert.ok(wide.x / wide.y > tablet.x / tablet.y, 'the bounds take the screen\'s shape');
  // A desk monitor's smaller type reaches less far: the fleet fits bigger.
  const desk = optionsFor(1.5, { dpr: 1, cssHeight: 912 });
  const deskSteps = stepsFor(pxPerMm({ dpr: 1, cssHeight: 912 }));
  assert.ok(deskSteps.room < STEPS.room);
  assert.ok(polarLayout(desk.layout(FLEET)).bounds.y < tablet.y);
});
