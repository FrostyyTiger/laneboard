// The Map at 390 px (T29, r22 Map 1-2): on the demo fleet no two label boxes
// intersect, with nothing selected and with each node selected in turn; the
// ring legends are gone; the fit centres the orbit in the free height
// between the HUD row and the phone's bottom bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createRenderer, PHONE_ALL_LABELS, reticleD, RETICLE_GAP } from '../public/js/views/map/render.js';
import { layout } from '../public/js/views/map/layout.js';
import { fitFrame } from '../public/js/views/map/interact.js';
import { foldState, autoFold, rollup } from '../public/js/views/map/model.js';
import { nodeStyle, rollsUp } from '../public/js/views/map/overlays.js';

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

// T51 (n3 T48 rest): the demo fleet as the Map draws it at 390, the lanes
// with sessions folded (model.autoFold) and sites and folded lanes showing
// the rolled-up status (model.rollup): every node drawn with a ▲ or ■ keeps
// its name, no label sits on another label or on a bearing number, and a
// run label that cannot fit is dropped (the ring stays).
function drawnScene(nodes, extra = {}) {
  const fs0 = foldState(nodes, [], autoFold(nodes));
  const shown = nodes.filter((n) => !fs0.hidden.has(n.id));
  const lay = layout(shown);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let outer = 0;
  for (const p of lay.pos.values()) outer = Math.max(outer, p.r);
  const { s, y } = fitFrame(W, H, outer + 64, INSET);
  const cur = new Map();
  for (const [id, p] of lay.pos) cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: byId.get(id) ?? lay.center, depth: p.depth });
  const memo = new Map();
  return {
    ...phoneScene(), s, fitY: y, pos: lay.pos, nodes: cur, byId, kids: lay.kids, folded: fs0.folded,
    toScreen: (p) => ({ x: W / 2 + p.x * s, y: H / 2 + (p.y - y) * s }),
    rolled: (id) => rollup(id, byId, fs0.kids, memo),
    ...extra,
  };
}

/** Ids the renderer marks ▲/■ on the status overlay, as drawNodes decides it. */
function markedIds(scene) {
  const out = [];
  for (const [id, c] of scene.nodes) {
    const n = c.node;
    if (!n || n.virtual || n.kind === 'core') continue;
    const st = nodeStyle(n, 'status', rollsUp(n, scene.folded.has(id)) ? scene.rolled(id) : null);
    if (st.abnormal && (st.tone === 'warn' || st.tone === 'crit')) out.push(id);
  }
  return out;
}

function checkDrawn(scene, label) {
  const r = createRenderer(fakeCtx(), PAL);
  const badges = r.drawNodes(scene);
  const boxes = r.labelBoxes(scene, badges);
  const named = new Set(boxes.map((b) => b.id));
  const marked = markedIds(scene);
  assert.ok(marked.length >= 3, `${label}: the scene has trouble to name (${marked})`);
  for (const id of marked) assert.ok(named.has(id), `${label}: ${id} (▲/■) keeps its label: ${boxes.map((b) => b.text)}`);
  assert.deepEqual(overlaps(boxes), [], label);
  for (const b of boxes) for (const t of r.ringTextBoxes(scene)) assert.ok(!hits(b, t), `${label}: ${b.text} clear of the bearing ${t.text}`);
  return { boxes, named, marked };
}

test('T51 390: the demo fleet folded as drawn names every ▲/■ node, rolled up included, with no label over a label or a bearing', () => {
  const scene = drawnScene(DEMO.nodes);
  assert.ok(scene.folded.size > 0, 'lanes with sessions are folded, as the Map draws them');
  const { named, marked } = checkDrawn(scene, 'demo');
  assert.ok(marked.includes('run:acme-billing'), 'the stuck run is marked');
  assert.ok(named.has('run:acme-billing'), 'and named');
  // A rolled-up mark: the site holding the trouble draws a ▲ and is named.
  assert.ok(marked.some((id) => scene.byId.get(id)?.kind === 'site' || scene.folded.has(id)), `a rolled-up mark among ${marked}`);
});

test('T51 390: with every lane wanting attention and every run stuck, each ▲ keeps its name and labels still never overlap', () => {
  const nodes = DEMO.nodes.map((n) => (n.kind === 'lane' ? { ...n, status: 'attention' }
    : n.kind === 'run' ? { ...n, status: 'warn', stuck: true } : n));
  const scene = drawnScene(nodes);
  const { boxes } = checkDrawn(scene, 'all trouble');
  for (const n of nodes.filter((x) => x.kind === 'run')) assert.ok(boxes.some((b) => b.id === n.id), `${n.id} (stuck) named`);
});

test('T51 390: a run label with no free place is dropped, not laid over another label', () => {
  // Forty healthy runs on one host, side by side: not every name can fit.
  const runs = Array.from({ length: 40 }, (_, i) => ({ id: `run:r${i}`, parent: 'room-a', kind: 'run', label: `night-run-${i}`, status: 'working', round: 3, maxRounds: 10 }));
  const scene = drawnScene([...DEMO.nodes, ...runs]);
  const r = createRenderer(fakeCtx(), PAL);
  const boxes = r.labelBoxes(scene, r.drawNodes(scene));
  assert.deepEqual(overlaps(boxes), []);
  const named = runs.filter((n) => boxes.some((b) => b.id === n.id)).length;
  assert.ok(named < runs.length, `some run names left for a tap (${named}/${runs.length})`);
});

test('T51: at 1440 every ▲/■ node is named and the labels keep clear of the ring legends and bearings; a phone has bearings only', () => {
  const scene = drawnScene(DEMO.nodes, { W: 1440, H: 900 });
  const { s } = fitFrame(1440, 900, 400);
  Object.assign(scene, { s, toScreen: (p) => ({ x: 720 + p.x * s, y: 450 + p.y * s }) });
  const r = createRenderer(fakeCtx(), PAL);
  const rings = r.ringTextBoxes(scene);
  assert.ok(rings.some((t) => !/^\d{3}$/.test(t.text)), `ring legends at 1440: ${rings.map((t) => t.text)}`);
  const boxes = r.labelBoxes(scene, r.drawNodes(scene));
  // A stuck lane deep in the tree is named wide too, not only on a phone.
  const named = new Set(boxes.map((b) => b.id));
  for (const id of markedIds(scene)) assert.ok(named.has(id), `${id} (▲/■) named at 1440`);
  for (const b of boxes) for (const t of rings) assert.ok(!hits(b, t), `${b.text} clear of ${t.text}`);
  assert.ok(r.ringTextBoxes(phoneScene()).every((t) => /^\d{3}$/.test(t.text)), 'a phone has bearings only');
});

// T53 (n3 T51): after Find and fly-to at 390 the selected node's name is
// laid outside its selection brackets, 4 px clear, wherever the node sits.
test('T53 390: a selected node, at the fit and after a fly-to, keeps its label box clear of the bracket box (+4 px)', () => {
  const base = drawnScene(DEMO.nodes);
  let checked = 0;
  for (const [id, c] of base.nodes) {
    const n = c.node;
    if (!n || n.virtual || n.kind === 'core') continue;
    // The fit as drawn, then the flight: zoom 1.9 with the node 60 px above the centre (map/index.js flyTo).
    const s2 = base.s * 1.9;
    const views = [
      { s: base.s, toScreen: base.toScreen },
      { s: s2, toScreen: (p) => ({ x: W / 2 + (p.x - c.x) * s2, y: H / 2 + (p.y - c.y) * s2 - 60 }) },
    ];
    for (const v of views) {
      const scene = { ...base, ...v, selected: id };
      const r = createRenderer(fakeCtx(), PAL);
      const boxes = r.labelBoxes(scene, r.drawNodes(scene));
      const mine = boxes.find((b) => b.id === id);
      assert.ok(mine, `${id} (selected) is named at s=${v.s.toFixed(2)}`);
      const sp = v.toScreen(c);
      const d = reticleD(n.kind, Math.min(1.6, Math.max(0.8, v.s))) + RETICLE_GAP;
      const ret = { x0: sp.x - d, y0: sp.y - d, x1: sp.x + d, y1: sp.y + d };
      assert.ok(!hits(mine, ret), `${id} label ${JSON.stringify(mine)} clear of its brackets ${JSON.stringify(ret)}`);
      // Its sub line too stays on the canvas (it ran off the right edge before).
      assert.ok(mine.x0 >= 0 && mine.x1 <= W, `${id} label inside the canvas: ${JSON.stringify(mine)}`);
      assert.deepEqual(overlaps(boxes), [], `${id} selected`);
      checked++;
    }
  }
  assert.ok(checked >= 20, `nodes checked: ${checked}`);
});
