// The Map at 390 px (T29, r22 Map 1-2): on the demo fleet no two label boxes
// intersect, with nothing selected and with each node selected in turn; the
// ring legends are gone; the fit centres the orbit in the free height
// between the HUD row and the phone's bottom bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createRenderer, PHONE_ALL_LABELS } from '../public/js/views/map/render.js';
import { layout } from '../public/js/views/map/layout.js';
import { fitFrame } from '../public/js/views/map/interact.js';

const DEMO = JSON.parse(fs.readFileSync(new URL('./fixtures/map-demo.json', import.meta.url), 'utf8'));

/** A 2D context that keeps the text it is asked to draw and measures 6px a character. */
function fakeCtx() {
  const texts = [];
  const noop = () => {};
  return {
    texts, font: '10px x', letterSpacing: '0px', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1,
    lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic',
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, setLineDash: noop, save: noop, restore: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, setTransform: noop,
    fillText(t) { texts.push(String(t)); },
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

// The phone's canvas under the HUD (390 x 759) and what covers it (views/map.css).
const W = 390, H = 759, INSET = { top: 40, bottom: 96 + 44 };

function phoneScene(extra = {}) {
  const nodes = DEMO.nodes;
  const lay = layout(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let outer = 0;
  for (const p of lay.pos.values()) outer = Math.max(outer, p.r);
  const { s, y } = fitFrame(W, H, outer + 64, INSET);
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, depth: p.depth });
  }
  return {
    W, H, now: 1000, s, zoom: 1, fitY: y,
    toScreen: (p) => ({ x: W / 2 + p.x * s, y: H / 2 + (p.y - y) * s }),
    pos: lay.pos, nodes: cur, byId, links: [], overlay: 'status',
    rolled: () => null, folded: new Set(), kids: lay.kids, alpha: () => 1,
    hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null,
    ...extra,
  };
}

const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function overlaps(boxes) {
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (hits(boxes[i], boxes[j])) out.push(`${boxes[i].text} x ${boxes[j].text}`);
  }
  return out;
}

function boxesOf(scene) {
  const r = createRenderer(fakeCtx(), PAL);
  const badges = r.drawNodes(scene);
  return { boxes: r.labelBoxes(scene, badges), badges };
}

test('390: the demo fleet (27 nodes) labels builders, runs and trouble, and no two label boxes intersect', () => {
  const { boxes, badges } = boxesOf(phoneScene());
  const texts = boxes.map((b) => b.text);
  for (const t of ['FEAT-SEARCH', 'FIX-LOGIN', 'DEPS-BUMP', 'ACME-BILLING']) assert.ok(texts.includes(t), `${t} (trouble) keeps its label: ${texts}`);
  const named = new Set(boxes.map((b) => b.id));
  for (const n of DEMO.nodes.filter((x) => x.kind === 'builder' || x.kind === 'run')) assert.ok(named.has(n.id), `${n.id} (${n.kind}) is labelled: ${texts}`);
  for (const t of ['SCRATCH', 'BACKUP', 'REPOS', 'DOCS-REFRESH']) assert.ok(!texts.includes(t), `${t} (healthy) is left for a tap`);
  assert.deepEqual(overlaps(boxes), []);
  for (const b of boxes) for (const p of badges) {
    assert.ok(!hits(b, { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h }), `${b.text} clear of the +${p.id} plate`);
  }
  for (const b of boxes) assert.ok(b.y0 >= 0 && b.y1 <= H, `${b.text} inside the canvas`);
});

test(`390: a map of ${PHONE_ALL_LABELS} nodes or fewer labels every one`, () => {
  const keep = new Set(DEMO.nodes.filter((n) => n.kind === 'core' || n.kind === 'host' || n.kind === 'room' || n.kind === 'builder').slice(0, PHONE_ALL_LABELS).map((n) => n.id));
  const scene = phoneScene();
  for (const id of [...scene.nodes.keys()]) if (!keep.has(id)) scene.nodes.delete(id);
  assert.ok(scene.nodes.size <= PHONE_ALL_LABELS && scene.nodes.size > 3, `${scene.nodes.size} nodes`);
  const named = new Set(boxesOf(scene).boxes.map((b) => b.id));
  for (const [id, c] of scene.nodes) if (c.node.kind !== 'core') assert.ok(named.has(id), `${id} is labelled`);
});

test('390: with any one node selected its label shows and still no two boxes intersect', () => {
  for (const n of DEMO.nodes) {
    if (n.kind === 'core') continue;
    const scene = phoneScene({ selected: n.id });
    const { boxes } = boxesOf(scene);
    assert.ok(boxes.some((b) => b.id === n.id), `${n.id} selected is labelled`);
    assert.deepEqual(overlaps(boxes), [], `with ${n.id} selected`);
  }
});

test('390: the ring legends are dropped; 1440 keeps them', () => {
  const legend = /·/;
  const phone = fakeCtx();
  createRenderer(phone, PAL).drawRings(phoneScene());
  assert.ok(!phone.texts.some((t) => legend.test(t)), `no legend at 390: ${phone.texts}`);
  const wide = fakeCtx();
  createRenderer(wide, PAL).drawRings(phoneScene({ W: 1440 }));
  assert.ok(wide.texts.some((t) => legend.test(t)), 'legends at 1440');
});

test('fitFrame centres the orbit in the free height between the HUD row and the bottom bar', () => {
  const outer = 400;
  const { s, y } = fitFrame(W, H, outer, INSET);
  assert.ok(s > 0 && 2 * outer * s <= W + 1e-9 && 2 * outer * s <= H - INSET.top - INSET.bottom + 1e-9, 'fits width and free height');
  const centre = H / 2 + (0 - y) * s;
  assert.ok(Math.abs(centre - (INSET.top + (H - INSET.top - INSET.bottom) / 2)) < 1e-9, `centre at ${centre}`);
  // No inset: the old fit, centred on the canvas.
  assert.deepEqual(fitFrame(1440, 900, outer), { s: Math.min(1440 / 800, 880 / 800), y: 0 });
  assert.ok(fitFrame(0, 0, outer, INSET).s > 0, 'a hidden map still gets a positive scale');
});

test('views/map.css gives the phone HUD the padding the fit reads, and find + fit sit above the bottom bar', () => {
  const css = fs.readFileSync(new URL('../public/css/views/map.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 699px)'));
  assert.match(phone, /\.map-hud\s*\{\s*padding:\s*40px 0 calc\(var\(--sheet-peek\)/);
  assert.match(phone, /\.map-find\s*\{\s*bottom:\s*calc\(var\(--sheet-peek\)/);
});
