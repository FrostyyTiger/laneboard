// The Map renderer (fleet M3, plan §5 2.5): readPalette against a fake
// getComputedStyle, and the draw passes against a fake 2D context that
// records every call, so shapes, colours and the restyle rules (no glow, no
// gradients, no additive comets) can be checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as render from '../public/js/views/map/render.js';
import { createRenderer, readPalette } from '../public/js/views/map/render.js';
import { layout } from '../public/js/views/map/layout.js';

// --- fakes -------------------------------------------------------------------

/** A 2D context that records path ops, fills, strokes and text with the state at the time. */
function fakeCtx() {
  const ops = [];
  let path = [];
  let dash = [];
  const state = {
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, font: '10px x',
    textAlign: 'start', textBaseline: 'alphabetic', lineDashOffset: 0, letterSpacing: '0px',
    globalCompositeOperation: 'source-over',
  };
  const sets = [];
  const snap = () => ({ fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, dash: [...dash], path: [...path] });
  let measured = 0;
  const ctx = {
    ops, sets,
    get measured() { return measured; },
    beginPath() { path = []; },
    closePath() { path.push(['closePath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); },
    arc(x, y, r, a0, a1) { path.push(['arc', x, y, r, a0, a1]); },
    rect(x, y, w, h) { path.push(['rect', x, y, w, h]); },
    bezierCurveTo(...a) { path.push(['bezier', ...a]); },
    quadraticCurveTo(...a) { path.push(['quad', ...a]); },
    fill() { ops.push({ op: 'fill', ...snap() }); },
    stroke() { ops.push({ op: 'stroke', ...snap() }); },
    fillRect(x, y, w, h) { ops.push({ op: 'fillRect', ...snap(), rect: [x, y, w, h] }); },
    strokeRect(x, y, w, h) { ops.push({ op: 'strokeRect', ...snap(), rect: [x, y, w, h] }); },
    clearRect(...a) { ops.push({ op: 'clearRect', rect: a }); },
    fillText(text, x, y) { ops.push({ op: 'fillText', text, x, y, font: ctx.font, ...snap() }); },
    measureText(text) { measured++; return { width: String(text).length * 6 }; },
    setLineDash(d) { dash = [...d]; },
    getLineDash() { return [...dash]; },
    save() {}, restore() {},
    setTransform() {},
    createRadialGradient() { ops.push({ op: 'gradient' }); return { addColorStop() {} }; },
    createLinearGradient() { ops.push({ op: 'gradient' }); return { addColorStop() {} }; },
  };
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, {
      get: () => state[k],
      set: (v) => { state[k] = v; sets.push([k, v]); },
      enumerable: true,
    });
  }
  return ctx;
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

/** A scene of the given nodes laid out by layout(), every node settled and visible. */
function sceneOf(nodes, extra = {}) {
  const lay = layout(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? (id === lay.center.id ? null : lay.center.id), depth: p.depth });
  }
  return {
    W: 1600, H: 1200, now: 1000, s: 1, zoom: 1,
    toScreen: (p) => ({ x: 800 + p.x, y: 600 + p.y }),
    pos: lay.pos, nodes: cur, byId, links: [], overlay: 'status',
    rolled: () => null, folded: new Set(), kids: lay.kids, alpha: () => 1,
    hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null,
    ...extra,
  };
}

const FLEET = [
  { id: '__core', kind: 'core', label: 'fleet' },
  { id: 'hq', kind: 'site', parent: '__core', label: 'hq', status: 'ok' },
  { id: 'agents', kind: 'room', parent: 'hq', label: 'agents', status: 'ok' },
  { id: 'builder:builder-a', kind: 'builder', parent: 'agents', builder: 'builder-a', label: 'B1', code: 'B1', status: 'ok' },
  { id: 'lane:builder-a/pay', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', label: 'pay', status: 'ok' },
];

const shapeOf = (op) => {
  const kinds = op.path.map((p) => p[0]);
  if (kinds[0] === 'rect') return 'square';
  if (kinds[0] === 'arc') return 'disc';
  const lines = kinds.filter((k) => k === 'lineTo').length;
  if (lines === 2) return 'tri';
  if (lines === 3) return 'diamond';
  return kinds.join(',');
};

/** The ops that draw the node at `id`'s screen point (path anchored there). */
function opsAt(ops, scene, id) {
  const sp = scene.toScreen(scene.nodes.get(id));
  const near = (x, y) => Math.abs(x - sp.x) < 12 && Math.abs(y - sp.y) < 12;
  return ops.filter((o) => (o.op === 'fill' || o.op === 'stroke') && o.path.length
    && ((o.path[0][0] === 'arc' && near(o.path[0][1], o.path[0][2]))
      || (o.path[0][0] === 'rect' && near(o.path[0][1] + o.path[0][3] / 2, o.path[0][2] + o.path[0][4] / 2))
      || (o.path[0][0] === 'moveTo' && Math.abs(o.path[0][1] - sp.x) < 0.01 && o.path.length >= 4)));
}

// --- readPalette ---------------------------------------------------------------

test('exports exactly createRenderer and readPalette', () => {
  assert.deepEqual(Object.keys(render).sort(), ['createRenderer', 'readPalette']);
});

test('readPalette reads the §4 tokens through getComputedStyle', (t) => {
  const tokens = {
    '--bg-canvas': ' oklch(16% 0.004 250) ', '--bg-sunken': 'oklch(13% 0.004 250)',
    '--line': 'oklch(100% 0 0 / 0.13)', '--line-weak': 'oklch(100% 0 0 / 0.07)',
    '--text-1': 'oklch(92% 0.003 250)', '--text-2': 'oklch(72% 0.004 250)', '--text-3': 'oklch(55% 0.004 250)',
    '--accent': 'oklch(70% 0.19 45)', '--p1': 'oklch(62% 0.23 25)', '--p2': 'oklch(84% 0.16 95)',
    '--p3': 'oklch(74% 0.11 220)', '--ok': 'oklch(66% 0.07 150)',
    '--font-mono': '"JetBrains Mono", monospace', '--font-label': '"Barlow Condensed", sans-serif',
  };
  const el = { id: 'map' };
  let asked = null;
  const prev = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (e) => { asked = e; return { getPropertyValue: (n) => tokens[n] ?? '' }; };
  t.after(() => { globalThis.getComputedStyle = prev; });
  const p = readPalette(el);
  assert.equal(asked, el);
  assert.equal(p.bg, 'oklch(16% 0.004 250)', 'trimmed');
  assert.equal(p.line, 'oklch(100% 0 0 / 0.13)');
  assert.equal(p.lineWeak, 'oklch(100% 0 0 / 0.07)');
  assert.equal(p.t3, 'oklch(55% 0.004 250)');
  assert.equal(p.crit, 'oklch(62% 0.23 25)');
  assert.equal(p.warn, 'oklch(84% 0.16 95)');
  assert.equal(p.low, 'oklch(74% 0.11 220)');
  assert.equal(p.ok, 'oklch(66% 0.07 150)');
  assert.equal(p.mono, '"JetBrains Mono", monospace');
  assert.equal(p.label, '"Barlow Condensed", sans-serif');
  assert.deepEqual(p.accentL, ['oklch(40% 0.19 45)', 'oklch(50% 0.19 45)', 'oklch(60% 0.19 45)', 'oklch(70% 0.19 45)', 'oklch(80% 0.19 45)']);
});

test('readPalette falls back to the old token names, then to defaults', (t) => {
  const prev = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => ({ '--crit': 'red', '--warn': 'gold', '--info': 'teal', '--border': 'grey', '--font-ui': 'Sans', '--accent': '#f80' })[n] ?? '' });
  t.after(() => { globalThis.getComputedStyle = prev; });
  const p = readPalette({});
  assert.equal(p.crit, 'red');
  assert.equal(p.warn, 'gold');
  assert.equal(p.low, 'teal');
  assert.equal(p.line, 'grey');
  assert.equal(p.label, 'Sans');
  assert.deepEqual(p.accentL, Array(5).fill('#f80'), 'a non-oklch accent is used at every level');
  assert.match(p.bg, /^oklch\(/, 'missing token -> default');
  globalThis.getComputedStyle = undefined;
  const q = readPalette({});
  assert.match(q.t1, /^oklch\(/, 'no getComputedStyle at all still yields a palette');
});

// --- nodes: grey when healthy, hue + shape when not ------------------------------

const STATUS_SHAPES = [
  ['crit', 'square', 'P1'], ['down', 'square', 'P1'],
  ['warn', 'tri', 'P2'], ['attention', 'tri', 'P2'],
  ['low', 'diamond', 'P3'],
];

for (const [status, shape, colour] of STATUS_SHAPES) {
  test(`a ${status} service is a ${shape} in ${colour}`, () => {
    const nodes = [{ id: 'svc', kind: 'service', label: 'svc', status }];
    const ctx = fakeCtx();
    const scene = sceneOf(nodes);
    createRenderer(ctx, PAL).drawNodes(scene);
    const fills = opsAt(ctx.ops, scene, 'svc').filter((o) => o.op === 'fill');
    assert.ok(fills.some((o) => shapeOf(o) === shape && o.fillStyle === colour), JSON.stringify(fills.map((o) => [shapeOf(o), o.fillStyle])));
  });
}

test('healthy nodes are grey: ok/idle/working services are --text-3 discs', () => {
  for (const status of ['ok', 'idle', 'working']) {
    const ctx = fakeCtx();
    const scene = sceneOf([{ id: 'svc', kind: 'service', label: 'svc', status }]);
    createRenderer(ctx, PAL).drawNodes(scene);
    const own = opsAt(ctx.ops, scene, 'svc');
    assert.ok(own.some((o) => o.op === 'fill' && shapeOf(o) === 'disc' && o.fillStyle === 'T3'), status);
    for (const o of ctx.ops) {
      assert.ok(![o.fillStyle, o.strokeStyle].some((c) => ['P1', 'P2', 'P3', 'ACC'].includes(c)), `${status}: no hue on a healthy map`);
    }
  }
});

test('unknown is a hollow dashed circle', () => {
  const ctx = fakeCtx();
  const scene = sceneOf([{ id: 'svc', kind: 'service', label: 'svc', status: 'unknown' }]);
  createRenderer(ctx, PAL).drawNodes(scene);
  const own = opsAt(ctx.ops, scene, 'svc');
  assert.ok(own.some((o) => o.op === 'fill' && o.fillStyle === 'BG'), 'hollow');
  assert.ok(own.some((o) => o.op === 'stroke' && o.dash.length === 2 && o.strokeStyle === 'T3'), 'dashed grey outline');
});

test('a calm lane keeps a grey diamond outline; an abnormal lane takes the status shape', () => {
  const ctx = fakeCtx();
  const scene = sceneOf(FLEET);
  createRenderer(ctx, PAL).drawNodes(scene);
  const lane = opsAt(ctx.ops, scene, 'lane:builder-a/pay');
  assert.ok(lane.some((o) => o.op === 'stroke' && shapeOf(o) === 'diamond' && o.strokeStyle === 'T3'));
  assert.ok(lane.some((o) => o.op === 'fill' && shapeOf(o) === 'diamond' && o.fillStyle === 'BG'));

  const crit = FLEET.map((n) => (n.kind === 'lane' ? { ...n, status: 'crit' } : n));
  const ctx2 = fakeCtx();
  const scene2 = sceneOf(crit);
  createRenderer(ctx2, PAL).drawNodes(scene2);
  assert.ok(opsAt(ctx2.ops, scene2, 'lane:builder-a/pay').some((o) => o.op === 'fill' && shapeOf(o) === 'square' && o.fillStyle === 'P1'));
});

test('a stuck lane that still reports ok reads as a warn triangle', () => {
  const nodes = FLEET.map((n) => (n.kind === 'lane' ? { ...n, flags: { stuck: { rule: 'idle' } } } : n));
  const ctx = fakeCtx();
  const scene = sceneOf(nodes);
  createRenderer(ctx, PAL).drawNodes(scene);
  assert.ok(opsAt(ctx.ops, scene, 'lane:builder-a/pay').some((o) => o.op === 'fill' && shapeOf(o) === 'tri' && o.fillStyle === 'P2'));
});

test('working adds a turning grey arc; reduced motion holds it still', () => {
  const nodes = [{ id: 'l', kind: 'lane', label: 'l', status: 'working' }];
  const arcs = (reduced, now) => {
    const ctx = fakeCtx();
    createRenderer(ctx, PAL).drawNodes(sceneOf(nodes, { reduced, now }));
    return ctx.ops.filter((o) => o.op === 'stroke' && o.strokeStyle === 'T2' && o.path[0]?.[0] === 'arc' && o.path[0][5] - o.path[0][4] < Math.PI);
  };
  const a = arcs(false, 0), b = arcs(false, 700);
  assert.equal(a.length, 1);
  assert.notEqual(a[0].path[0][4], b[0].path[0][4], 'the arc turns with the clock');
  const r1 = arcs(true, 0), r2 = arcs(true, 700);
  assert.equal(r1[0].path[0][4], r2[0].path[0][4], 'reduced motion: the same arc every frame');
});

test('a builder is a 2px square outline with its short code inside', () => {
  const ctx = fakeCtx();
  const scene = sceneOf(FLEET);
  createRenderer(ctx, PAL).drawNodes(scene);
  const sp = scene.toScreen(scene.nodes.get('builder:builder-a'));
  const outline = ctx.ops.find((o) => o.op === 'strokeRect' && Math.abs(o.rect[0] + o.rect[2] / 2 - sp.x) < 0.01);
  assert.ok(outline, 'square outline');
  assert.equal(outline.lineWidth, 2);
  assert.equal(outline.strokeStyle, 'T2');
  const code = ctx.ops.find((o) => o.op === 'fillText' && o.text === 'B1');
  assert.ok(code && /MONO/.test(code.font) && /9px/.test(code.font));
});

test('the core and sites draw without any glow or gradient, and comets without additive blending', () => {
  const ctx = fakeCtx();
  const nodes = [...FLEET, { id: 'x', kind: 'service', parent: 'agents', label: 'x', status: 'crit' }];
  const link = { id: 'k', from: 'x', to: 'lane:builder-a/pay', kind: 'flow', live: true };
  const scene = sceneOf(nodes, { links: [link], comets: [{ link, t0: 0, dur: 2000 }], pulses: [{ id: 'x', t0: 500, tone: 'crit' }], selected: 'x', selT: 0.5 });
  createRenderer(ctx, PAL).draw(scene);
  assert.equal(ctx.ops.filter((o) => o.op === 'gradient').length, 0, 'no gradients');
  assert.ok(!ctx.sets.some(([k, v]) => k === 'globalCompositeOperation' && v === 'lighter'), 'no lighter');
  assert.ok(!ctx.sets.some(([k]) => k === 'shadowBlur' || k === 'shadowColor'), 'no shadow');
  assert.ok(ctx.ops.some((o) => o.op === 'fill' && o.fillStyle === 'T2' && o.path[0]?.[0] === 'arc' && o.path[0][3] <= 2), 'the comet drew');
  assert.equal(ctx.ops[0].op, 'clearRect', 'flat ground: the frame starts by clearing, nothing is painted under the map');
});

test('overlay: a cost-heavy calm lane takes an accent level, a crit lane keeps its square', () => {
  const nodes = [
    { id: 'a', kind: 'lane', label: 'a', status: 'ok', m: { costUsd: 25 } },
    { id: 'b', kind: 'lane', label: 'b', status: 'crit', m: { costUsd: 0 } },
  ];
  const ctx = fakeCtx();
  const scene = sceneOf(nodes, { overlay: 'cost' });
  createRenderer(ctx, PAL).drawNodes(scene);
  assert.ok(opsAt(ctx.ops, scene, 'a').some((o) => o.op === 'fill' && o.fillStyle === 'A70'), 'cost $25 -> level 3');
  assert.ok(opsAt(ctx.ops, scene, 'b').some((o) => o.op === 'fill' && shapeOf(o) === 'square' && o.fillStyle === 'P1'));
});

test('drift overlay: a dashed warn ring on a missing node, an accent ring on an undeclared one', () => {
  const nodes = [
    { id: '__core', kind: 'core', label: 'hub' },
    { id: 'hq', kind: 'site', parent: '__core', label: 'hq', status: 'ok' },
    { id: 'gone', kind: 'room', parent: 'hq', label: 'gone', status: 'unknown', drift: 'missing', why: 'hv1 does not list gone' },
    { id: 'feed:hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok', discovered: true, drift: 'undeclared' },
    { id: 'feed:hv1/new', kind: 'room', parent: 'feed:hv1', label: 'new', status: 'ok', discovered: true, drift: 'undeclared' },
    { id: 'b', kind: 'builder', parent: 'hq', label: 'B1', code: 'B1', status: 'ok', drift: 'undeclared' },
    { id: 'calm', kind: 'room', parent: 'hq', label: 'calm', status: 'ok' },
  ];
  const ctx = fakeCtx();
  const scene = sceneOf(nodes, { overlay: 'drift' });
  const r = createRenderer(ctx, PAL);
  assert.doesNotThrow(() => r.draw(scene));
  const ring = (id) => opsAt(ctx.ops, scene, id).filter((o) => o.op === 'stroke' && o.lineWidth === 1.5 && ['P2', 'A60'].includes(o.strokeStyle));
  assert.ok(ring('gone').some((o) => o.strokeStyle === 'P2' && o.dash.length === 2), 'missing: dashed warn');
  for (const id of ['feed:hv1', 'feed:hv1/new', 'b']) assert.ok(ring(id).some((o) => o.strokeStyle === 'A60' && o.dash.length === 0), `${id}: solid accent`);
  assert.equal(ring('calm').length, 0);
  assert.ok(opsAt(ctx.ops, scene, 'calm').every((o) => o.alpha <= 0.5 + 1e-9), 'the rest is dimmed');
  // Outside the drift overlay, no drift ring.
  const ctx2 = fakeCtx();
  const s2 = sceneOf(nodes);
  createRenderer(ctx2, PAL).drawNodes(s2);
  assert.ok(!ctx2.ops.some((o) => o.op === 'stroke' && ['P2', 'A60'].includes(o.strokeStyle)));
});

test('reach overlay: arcs with arrowheads only there, the selected node\'s reach in the accent', () => {
  const nodes = [
    { id: '__core', kind: 'core', label: 'hub' },
    { id: 'hq', kind: 'site', parent: '__core', label: 'hq', status: 'ok' },
    { id: 'a', kind: 'room', parent: 'hq', label: 'a', status: 'ok' },
    { id: 'b', kind: 'room', parent: 'hq', label: 'b', status: 'ok' },
    { id: 'c', kind: 'room', parent: 'hq', label: 'c', status: 'ok' },
    { id: 'calm', kind: 'room', parent: 'hq', label: 'calm', status: 'ok' },
  ];
  const reach = [
    { id: 'reach:a>b', kind: 'reach', from: 'a', to: 'b', label: 'tcp:22' },
    { id: 'reach:b>c', kind: 'reach', from: 'b', to: 'c', label: 'tcp:443' },
    { id: 'reach:a>gone', kind: 'reach', from: 'a', to: 'gone', label: '*' },
  ];
  const arcs = (ops) => ops.filter((o) => o.op === 'stroke' && o.path.some((p) => p[0] === 'quad'));
  const heads = (ops) => ops.filter((o) => o.op === 'fill' && o.path.filter((p) => p[0] === 'lineTo').length === 2 && o.path.at(-1)[0] === 'closePath');

  // Not in the reach overlay: nothing drawn, even with reach links in the scene.
  const ctx0 = fakeCtx();
  createRenderer(ctx0, PAL).draw(sceneOf(nodes, { reach, overlay: 'status' }));
  assert.equal(arcs(ctx0.ops).length, 0);

  // Reach, nothing selected: thin grey arcs, an arrowhead each; a link to a node not drawn is skipped.
  const ctx = fakeCtx();
  const scene = sceneOf(nodes, { reach, overlay: 'reach' });
  const r = createRenderer(ctx, PAL);
  r.drawReach(scene);
  assert.equal(arcs(ctx.ops).length, 2);
  assert.ok(arcs(ctx.ops).every((o) => o.strokeStyle === 'T3' && o.lineWidth === 1 && o.dash.length === 0));
  assert.equal(heads(ctx.ops).length, 2, 'direction is shown');
  assert.ok(!ctx.ops.some((o) => o.op === 'fillText'), 'no port labels without a selection');

  // Selected a: its arc in the accent with its ports, b marked, calm dimmed, b>c faded.
  const ctx2 = fakeCtx();
  const s2 = sceneOf(nodes, { reach, overlay: 'reach', selected: 'a' });
  const r2 = createRenderer(ctx2, PAL);
  assert.doesNotThrow(() => r2.draw(s2));
  const [ab, bc] = arcs(ctx2.ops);
  assert.equal(ab.strokeStyle, 'A60');
  assert.equal(ab.lineWidth, 1.5);
  assert.equal(bc.strokeStyle, 'T3');
  assert.ok(bc.alpha < 0.35);
  assert.ok(ctx2.ops.some((o) => o.op === 'fillText' && o.text === 'tcp:22'));
  assert.ok(!ctx2.ops.some((o) => o.op === 'fillText' && o.text === 'tcp:443'));
  const ring = (id) => opsAt(ctx2.ops, s2, id).filter((o) => o.op === 'stroke' && o.lineWidth === 1.5 && o.strokeStyle === 'A70');
  assert.equal(ring('b').length, 1, 'what a can touch is ringed');
  assert.equal(ring('a').length + ring('c').length + ring('calm').length, 0);
  assert.ok(opsAt(ctx2.ops, s2, 'calm').every((o) => o.alpha <= 0.5 + 1e-9), 'the rest is dimmed');
  assert.ok(opsAt(ctx2.ops, s2, 'c').every((o) => o.alpha <= 0.5 + 1e-9), 'two hops away is not lit');
  assert.ok(ctx2.ops.every((o) => o.op !== 'gradient'));
});

test('a folded node draws a dotted ring and a +N plate, and returns the plate rect', () => {
  const ctx = fakeCtx();
  const nodes = FLEET.slice(0, 4);
  const kids = new Map([['builder:builder-a', [FLEET[4], { id: 'lane:builder-a/b' }]]]);
  const scene = sceneOf(nodes, { folded: new Set(['builder:builder-a']), kids, rolled: () => 'ok' });
  const badges = createRenderer(ctx, PAL).drawNodes(scene);
  assert.equal(badges.length, 1);
  assert.equal(badges[0].id, 'builder:builder-a');
  assert.ok(ctx.ops.some((o) => o.op === 'fillText' && o.text === '+2'));
});

test('pulses are skipped under reduced motion, comets too', () => {
  const nodes = [{ id: 'a', kind: 'service', label: 'a', status: 'crit' }, { id: 'b', kind: 'service', label: 'b', status: 'ok' }];
  const link = { id: 'k', from: 'a', to: 'b', kind: 'flow', live: true };
  const ctx = fakeCtx();
  const r = createRenderer(ctx, PAL);
  const scene = sceneOf(nodes, { reduced: true, links: [link], comets: [{ link, t0: 0, dur: 2000 }], pulses: [{ id: 'a', t0: 500, tone: 'crit' }] });
  const before = ctx.ops.length;
  r.drawComets(scene);
  assert.equal(ctx.ops.length, before, 'no comet ops');
  r.drawNodes(scene);
  assert.ok(!ctx.ops.some((o) => o.op === 'stroke' && o.strokeStyle === 'P1' && o.path[0]?.[0] === 'arc'), 'no pulse ring');
  r.drawLinks(scene);
  assert.ok(!ctx.sets.some(([k, v]) => k === 'lineDashOffset' && v !== 0), 'live dashes do not flow');
});

// --- rings and dial ----------------------------------------------------------------

test('rings: solid hairlines in --line at 0.5, labelled SITE/ROOM/BUILDER/LANE with a leader tick', () => {
  const ctx = fakeCtx();
  const scene = sceneOf(FLEET);
  createRenderer(ctx, PAL).drawRings(scene);
  const rings = ctx.ops.filter((o) => o.op === 'stroke' && o.path[0]?.[0] === 'arc');
  assert.equal(rings.length, 4, 'one per occupied ring');
  for (const o of rings) {
    assert.equal(o.strokeStyle, 'LINE');
    assert.equal(o.alpha, 0.5);
    assert.deepEqual(o.dash, [], 'solid, not dotted');
    assert.equal(o.lineWidth, 1);
  }
  const words = ctx.ops.filter((o) => o.op === 'fillText' && /LABEL/.test(o.font)).map((o) => o.text);
  assert.deepEqual(words, ['SITE', 'ROOM', 'BUILDER', 'LANE']);
  const label = ctx.ops.find((o) => o.op === 'fillText' && o.text === 'SITE');
  assert.match(label.font, /10px/);
  assert.equal(label.x, 800, 'at twelve o\'clock');
  const leaders = ctx.ops.filter((o) => o.op === 'stroke' && o.path.length === 2 && o.path[0][1] === 800 && o.path[1][1] === 800
    && Math.abs(o.path[0][2] - o.path[1][2]) === 6);
  const tops = rings.map((o) => 600 - o.path[0][3]);
  assert.deepEqual(leaders.map((o) => o.path[0][2]), tops, 'a 6px leader up from each ring at twelve o\'clock');
});

test('the dial: 72 degree ticks and mono bearings 000 090 180 270', () => {
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawRings(sceneOf(FLEET));
  const ticks = ctx.ops.filter((o) => o.op === 'stroke' && o.path.length === 2 && o.path[0][0] === 'moveTo'
    && Math.hypot(o.path[0][1] - 800, o.path[0][2] - 600) > 500
    && [3, 7].some((len) => Math.abs(Math.hypot(o.path[1][1] - o.path[0][1], o.path[1][2] - o.path[0][2]) - len) < 1e-6));
  assert.equal(ticks.length, 72);
  const bearings = ctx.ops.filter((o) => o.op === 'fillText' && /9px MONO/.test(o.font));
  assert.deepEqual(bearings.map((o) => o.text), ['000', '090', '180', '270']);
  const north = bearings[0];
  assert.ok(Math.abs(north.x - 800) < 1e-6 && north.y < 600, '000 is at twelve o\'clock');
});

// --- edges -------------------------------------------------------------------------

test('edges: tree 1px --line without gradients; confirmed conflict is the only crit edge', () => {
  const nodes = [
    ...FLEET,
    { id: 'lane:builder-a/api', kind: 'lane', parent: 'builder:builder-a', label: 'api', status: 'working' },
  ];
  const links = [
    { id: 'c1', kind: 'conflict', from: 'lane:builder-a/pay', to: 'lane:builder-a/api', predicted: false, severity: 'crit' },
    { id: 'c2', kind: 'conflict', from: 'lane:builder-a/api', to: 'lane:builder-a/pay', predicted: true, severity: 'warn' },
    { id: 't', kind: 'touch', from: 'lane:builder-a/api', to: 'builder:builder-a' },
  ];
  const ctx = fakeCtx();
  const r = createRenderer(ctx, PAL);
  const scene = sceneOf(nodes, { links });
  r.drawTree(scene);
  const tree = ctx.ops.filter((o) => o.op === 'stroke');
  assert.equal(tree.length, 5, 'one branch per non-core node');
  assert.ok(tree.every((o) => o.strokeStyle === 'LINE' && o.lineWidth === 1 && o.path[1][0] === 'bezier'));
  ctx.ops.length = 0;
  r.drawLinks(scene);
  const strokes = ctx.ops.filter((o) => o.op === 'stroke');
  const [confirmed, predicted, touch] = strokes;
  assert.equal(confirmed.strokeStyle, 'P1');
  assert.equal(confirmed.lineWidth, 1.5);
  assert.deepEqual(confirmed.dash, []);
  assert.equal(predicted.strokeStyle, 'P2');
  assert.deepEqual(predicted.dash, [4, 3]);
  assert.equal(touch.strokeStyle, 'T3');
  assert.equal(touch.alpha, 0.35);
  assert.equal(strokes.filter((o) => o.strokeStyle === 'P1').length, 1);
  assert.equal(ctx.ops.filter((o) => o.op === 'fill').length, 0, 'undirected kinds draw no arrowhead');
});

test('a live ci edge flows; a hot link is drawn stronger and labelled', () => {
  const nodes = [{ id: 'a', kind: 'builder', label: 'B1', status: 'ok' }, { id: 'b', kind: 'service', label: 'runner', status: 'ok' }];
  const link = { id: 'ci', kind: 'ci', from: 'a', to: 'b', live: true, label: 'run 12' };
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawLinks(sceneOf(nodes, { links: [link], now: 600, hover: 'a' }));
  assert.ok(ctx.sets.some(([k, v]) => k === 'lineDashOffset' && v === -10));
  const s = ctx.ops.find((o) => o.op === 'stroke');
  assert.ok(s.alpha >= 0.85);
  assert.ok(ctx.ops.some((o) => o.op === 'fillText' && o.text === 'run 12'));
});

// --- labels and lamps ----------------------------------------------------------------

test('builder lamps: link, approvals, stuck as 4x4 squares; off is --line', () => {
  const lamps = (builder, extra = []) => {
    const nodes = [...FLEET.slice(0, 3), { ...FLEET[3], ...builder }, ...extra];
    const ctx = fakeCtx();
    createRenderer(ctx, PAL).drawLabels(sceneOf(nodes));
    return ctx.ops.filter((o) => o.op === 'fillRect' && o.rect[2] === 4 && o.rect[3] === 4).map((o) => o.fillStyle);
  };
  assert.deepEqual(lamps({}), ['T2', 'LINE', 'LINE'], 'link up, nothing pending, nothing stuck');
  assert.deepEqual(lamps({ status: 'down' }), ['P1', 'LINE', 'LINE']);
  assert.deepEqual(lamps({ link: 'stale', counts: { lanes: 3, waiting: 2 } }), ['P2', 'ACC', 'LINE']);
  const stuckLane = { ...FLEET[4], flags: { stuck: { rule: 'idle' } } };
  assert.deepEqual(lamps({}, [stuckLane]), ['T2', 'LINE', 'P2']);
});

test('labels: plates in the label face uppercase, lanes in mono, loud ones in their hue', () => {
  const nodes = FLEET.map((n) => (n.kind === 'lane' ? { ...n, status: 'crit', why: 'CI failed' } : n));
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawLabels(sceneOf(nodes, { s: 1.3 }));
  const text = (t) => ctx.ops.find((o) => o.op === 'fillText' && o.text === t);
  assert.match(text('AGENTS').font, /LABEL/);
  assert.match(text('BUILDER-A').font, /LABEL/);
  assert.match(text('pay').font, /MONO/);
  assert.equal(text('pay').fillStyle, 'P1');
  assert.equal(text('CI failed').fillStyle, 'P1');
  assert.ok(text('FLEET'), 'the core label');
});

test('text widths are measured once per font and text', () => {
  const ctx = fakeCtx();
  const r = createRenderer(ctx, PAL);
  const scene = sceneOf(FLEET);
  r.drawLabels(scene);
  const first = ctx.measured;
  assert.ok(first > 0);
  r.drawLabels(scene);
  assert.equal(ctx.measured, first, 'the second frame hits the cache');
});

// --- selection --------------------------------------------------------------------------

/** The four L-brackets of a reticle stroke: their corner distance from the node. */
function bracketReach(op, sp) {
  const corners = op.path.filter((p, i) => p[0] === 'lineTo' && op.path[i + 1]?.[0] === 'lineTo');
  return corners.map((p) => Math.max(Math.abs(p[1] - sp.x), Math.abs(p[2] - sp.y)));
}

test('selection is a corner-bracket reticle closing from r+18 to r+6, hover at 40%', () => {
  const nodes = [{ id: 'svc', kind: 'service', label: 'svc', status: 'ok' }, { id: 'o', kind: 'service', label: 'o', status: 'ok' }];
  const reticle = (extra) => {
    const ctx = fakeCtx();
    const scene = sceneOf(nodes, extra);
    createRenderer(ctx, PAL).drawReticle(scene);
    return { ops: ctx.ops.filter((o) => o.op === 'stroke'), scene };
  };
  const r = 4.2; // SIZE.service at scale 1
  const open = reticle({ selected: 'svc', selT: 0 });
  assert.equal(open.ops.length, 1);
  const o = open.ops[0];
  assert.equal(o.strokeStyle, 'ACC');
  assert.equal(o.path.filter((p) => p[0] === 'moveTo').length, 4, 'four brackets');
  const sp = open.scene.toScreen(open.scene.nodes.get('svc'));
  for (const d of bracketReach(o, sp)) assert.ok(Math.abs(d - (r + 18)) < 1e-6, `opens at r+18, got ${d}`);
  const shut = reticle({ selected: 'svc', selT: 1 });
  for (const d of bracketReach(shut.ops[0], sp)) assert.ok(Math.abs(d - (r + 6)) < 1e-6, `closes at r+6, got ${d}`);
  const arms = shut.ops[0].path.filter((p) => p[0] === 'moveTo').map((p, i) => p);
  assert.equal(arms.length, 4);
  assert.equal(shut.ops[0].alpha, 1);
  const hover = reticle({ hover: 'o' });
  assert.equal(hover.ops.length, 1);
  assert.ok(Math.abs(hover.ops[0].alpha - 0.4) < 1e-9, 'hover brackets at 40%');
  assert.ok(!hover.ops.some((x) => x.path.some((p) => p[0] === 'arc')), 'no selection ring');
  const reduced = reticle({ selected: 'svc', selT: 0, reduced: true });
  for (const d of bracketReach(reduced.ops[0], sp)) assert.ok(Math.abs(d - (r + 6)) < 1e-6, 'reduced motion: closed at once');
});

test('the tether runs from the selected node to the anchor, only on wide screens', () => {
  const nodes = [{ id: 'svc', kind: 'service', label: 'svc', status: 'ok' }];
  const run = (extra) => {
    const ctx = fakeCtx();
    createRenderer(ctx, PAL).drawTether(sceneOf(nodes, { selected: 'svc', ...extra }));
    return ctx.ops;
  };
  const ops = run({ anchor: { left: 1400, top: 100, bottom: 900 } });
  const line = ops.find((o) => o.op === 'stroke');
  assert.equal(line.strokeStyle, 'ACC');
  const end = line.path.at(-1);
  assert.ok(Math.abs(end[1] - 1400) < 1e-6);
  assert.equal(run({ anchor: null }).length, 0);
  assert.equal(run({ anchor: { left: 600, top: 0, bottom: 900 }, W: 700 }).length, 0, 'off at W <= 760');
});

// --- readout and palette swap -----------------------------------------------------------------

test('readout text: zoom, scope, node count, overlay, UTC', () => {
  const r = createRenderer(fakeCtx(), PAL);
  const now = Date.UTC(2026, 0, 2, 12, 4, 31);
  assert.equal(r.readout({ zoom: 1.8, scope: 'B1', drawn: 214, total: 570, overlay: 'ci', now }), 'Z 1.80×  SCOPE B1  N 214/570  OVL CI  12:04:31Z');
  assert.equal(r.readout({ zoom: 1, scope: 'all', drawn: 3, total: 3, now }), 'Z 1.00×  SCOPE ALL  N 3/3  OVL STATUS  12:04:31Z');
  assert.equal(r.readout({ zoom: 2, drawn: 1, total: 2, now, compact: true }), 'Z 2.00× · N 1/2 · 12:04:31Z');
  assert.match(r.readout({ now, p95: 3.24 }), /P95 3\.2MS$/);
  assert.equal(r.readout({ zoom: 1, drawn: 3, total: 3, overlay: 'drift', drift: { missing: 1, undeclared: 2 }, now }),
    'Z 1.00×  SCOPE ALL  N 3/3  OVL DRIFT  NOT SEEN 1  NOT DECLARED 2  12:04:31Z');
  assert.doesNotMatch(r.readout({ overlay: 'status', drift: { missing: 1, undeclared: 2 }, now }), /NOT SEEN/);
  assert.match(r.readout({ overlay: 'reach', reach: { links: 12, touches: null }, now }), /OVL REACH {2}LINKS 12 {2}\d/);
  assert.match(r.readout({ overlay: 'reach', reach: { links: 12, touches: 3 }, now }), /LINKS 12 {2}TOUCHES 3/);
  assert.doesNotMatch(r.readout({ overlay: 'status', reach: { links: 12, touches: 3 }, now }), /LINKS/);
});

test('setPalette swaps colours for the next frame (lb:theme)', () => {
  const ctx = fakeCtx();
  const r = createRenderer(ctx, PAL);
  r.setPalette({ ...PAL, crit: 'LIGHT-P1' });
  const scene = sceneOf([{ id: 'svc', kind: 'service', label: 'svc', status: 'crit' }]);
  r.drawNodes(scene);
  assert.ok(ctx.ops.some((o) => o.fillStyle === 'LIGHT-P1'));
  assert.equal(r.palette.crit, 'LIGHT-P1');
  assert.equal(r.tone('accent', 2), 'A60');
  assert.equal(r.tone('grey'), 'T3');
});
