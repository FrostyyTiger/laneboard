// The Map renderer (fleet M3, plan §5 2.5): readPalette against a fake
// getComputedStyle, and the draw passes against a fake 2D context that
// records every call, so shapes, colours and the restyle rules (no glow, no
// gradients, no additive comets) can be checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as render from '../public/js/views/map/render.js';
import { createRenderer, platePlace, readPalette } from '../public/js/views/map/render.js';
import { layout, LEGEND_ANGLE } from '../public/js/views/map/layout.js';

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
    save() { ops.push({ op: 'save' }); }, restore() { ops.push({ op: 'restore' }); },
    clip(rule) { ops.push({ op: 'clip', rule, path: [...path] }); },
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

test('exports exactly createRenderer, platePlace, readPalette, codeFont, PHONE_ALL_LABELS and the reticle geometry (T53)', () => {
  assert.deepEqual(Object.keys(render).sort(), ['PHONE_ALL_LABELS', 'RETICLE_GAP', 'codeFont', 'createRenderer', 'platePlace', 'readPalette', 'reticleD']);
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

test('the working arc runs on a faint full track of the same radius, so it never reads as a stray ")"', () => {
  const nodes = [{ id: 'l', kind: 'lane', label: 'l', status: 'working' }];
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawNodes(sceneOf(nodes, { now: 0 }));
  const strokes = ctx.ops.filter((o) => o.op === 'stroke' && o.path[0]?.[0] === 'arc');
  const turning = strokes.find((o) => o.strokeStyle === 'T2' && o.path[0][5] - o.path[0][4] < Math.PI);
  assert.ok(turning, 'a turning arc');
  const track = strokes.find((o) => o.strokeStyle === 'LINE' && Math.abs(o.path[0][5] - o.path[0][4] - 2 * Math.PI) < 1e-9
    && o.path[0][3] === turning.path[0][3] && o.path[0][1] === turning.path[0][1] && o.path[0][2] === turning.path[0][2]);
  assert.ok(track, 'a full track of the same radius around the same point');
  assert.ok(strokes.indexOf(track) < strokes.indexOf(turning), 'the track is drawn first, under the arc');
});

test('codeFont: a builder code keeps 9px when it fits the plate, else shrinks to fit (never below 6)', () => {
  const q = 8.75; // a builder at scale 1 (SIZE 7 x 1.25)
  assert.equal(render.codeFont(2 * 5.4, q), 9, 'a two-letter code at 9px fits');
  const f = render.codeFont(3 * 5.4, q);
  assert.ok(f < 9 && f >= 6, `three letters shrink: ${f}`);
  assert.ok((3 * 5.4 * f) / 9 <= 2 * q - 4, 'and then fit inside the outline');
  assert.equal(render.codeFont(100, q), 6);
  assert.equal(render.codeFont(0, q), 9);
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

test('drift overlay: a dashed warn ring on a missing node, a solid warn square on an undeclared one, never the accent', () => {
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
  const accent = [PAL.accent, ...PAL.accentL];
  const mark = (id) => opsAt(ctx.ops, scene, id).filter((o) => o.op === 'stroke' && o.lineWidth === 1.5);
  const gone = mark('gone');
  assert.ok(gone.some((o) => o.strokeStyle === 'P2' && o.dash.length === 2 && shapeOf(o) === 'disc'), 'missing: dashed warn ring');
  for (const id of ['feed:hv1', 'feed:hv1/new', 'b']) {
    const m = mark(id).filter((o) => o.strokeStyle === 'P2');
    assert.ok(m.some((o) => o.dash.length === 0 && shapeOf(o) === 'square'), `${id}: solid warn square`);
    assert.ok(mark(id).every((o) => !accent.includes(o.strokeStyle)), `${id}: not the accent`);
  }
  assert.notEqual(shapeOf(gone.find((o) => o.strokeStyle === 'P2')), shapeOf(mark('b').find((o) => o.strokeStyle === 'P2')), 'the two differ in shape');
  assert.equal(mark('calm').length, 0);
  assert.ok(opsAt(ctx.ops, scene, 'calm').every((o) => o.alpha <= 0.5 + 1e-9), 'the rest is dimmed');
  // Outside the drift overlay, no drift mark.
  const ctx2 = fakeCtx();
  const s2 = sceneOf(nodes);
  createRenderer(ctx2, PAL).drawNodes(s2);
  assert.ok(!ctx2.ops.some((o) => o.op === 'stroke' && o.lineWidth === 1.5 && o.strokeStyle === 'P2'));
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

test('rings: solid hairlines in --line at 0.5, labelled SITE/ROOM/BUILDER/LANE with a leader tick at bearing 330', () => {
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
  // T19: off the 000 axis, in the layout's gap at bearing 330 (upper left).
  const ux = Math.cos(LEGEND_ANGLE), uy = Math.sin(LEGEND_ANGLE);
  for (const o of rings) {
    const R = o.path[0][3];
    const word = ctx.ops.filter((t) => t.op === 'fillText' && /LABEL/.test(t.font))[rings.indexOf(o)];
    assert.match(word.font, /10px/);
    assert.ok(Math.abs(word.x - (800 + ux * (R + 8))) < 1e-6 && Math.abs(word.y - (600 + uy * (R + 8))) < 1e-6, `${word.text} at bearing 330`);
    assert.ok(word.x < 800, `${word.text} is not on the 000 axis`);
    const leader = ctx.ops.find((t) => t.op === 'stroke' && t.path.length === 2
      && Math.abs(t.path[0][1] - (800 + ux * R)) < 1e-6 && Math.abs(t.path[0][2] - (600 + uy * R)) < 1e-6);
    assert.ok(leader, `a leader from ring ${R}`);
    assert.ok(Math.abs(Math.hypot(leader.path[1][1] - 800, leader.path[1][2] - 600) - (R + 6)) < 1e-6, 'a 6px radial leader');
  }
  const legends = ctx.ops.filter((o) => o.op === 'fillText' && /LABEL/.test(o.font));
  assert.ok(legends.every((o) => Math.abs(o.x - 800) > 1), 'no ring legend on the 000 axis');
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

test('labels: one style, the label face in caps; trouble is t1 text, its hue only on the node mark (T19)', () => {
  for (const status of ['crit', 'attention', 'down']) {
    const nodes = FLEET.map((n) => (n.kind === 'lane' ? { ...n, status, why: 'CI failed' } : n));
    const ctx = fakeCtx();
    const scene = sceneOf(nodes, { s: 1.3 });
    const r = createRenderer(ctx, PAL);
    r.drawLabels(scene);
    const text = (t) => ctx.ops.find((o) => o.op === 'fillText' && o.text === t);
    assert.match(text('AGENTS').font, /LABEL/);
    assert.match(text('BUILDER-A').font, /LABEL/);
    assert.ok(!text('pay'), 'no lowercase mono name');
    assert.match(text('PAY').font, /LABEL/);
    assert.equal(text('PAY').fillStyle, 'T1', `${status}: the name is plain t1`);
    assert.equal(text('CI failed').fillStyle, 'T2', `${status}: the why is grey`);
    assert.ok(text('FLEET'), 'the core label');
    const names = ctx.ops.filter((o) => o.op === 'fillText' && /LABEL/.test(o.font));
    assert.ok(names.every((o) => !['P1', 'P2', 'P3', 'ACC'].includes(o.fillStyle)), `${status}: no hue on any name`);
    // The hue lives on the lane's mark.
    ctx.ops.length = 0;
    r.drawNodes(scene);
    assert.ok(opsAt(ctx.ops, scene, 'lane:builder-a/pay').some((o) => o.fillStyle === 'P1' || o.fillStyle === 'P2'), `${status}: the mark has the hue`);
  }
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawLabels(sceneOf(FLEET, { s: 1.3 }));
  assert.equal(ctx.ops.find((o) => o.op === 'fillText' && o.text === 'PAY').fillStyle, 'T2', 'a calm lane is t2');
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

// --- label placement (T18) ----------------------------------------------------------

/** How far out anything stroked around `sp` reaches: arcs centred there, rects around it (corners). */
function drawnReach(ops, sp) {
  let R = 0;
  for (const o of ops) {
    if (o.op === 'fill' && o.path[0]?.[0] === 'moveTo' && Math.abs(o.path[0][1] - sp.x) < 0.01 && Math.abs(o.path[0][2] - sp.y) < 20) {
      // A glyph (triangle, diamond): its farthest vertex.
      for (const p of o.path) if (p[0] === 'moveTo' || p[0] === 'lineTo') R = Math.max(R, Math.hypot(p[1] - sp.x, p[2] - sp.y));
      continue;
    }
    if (o.op !== 'stroke' && o.op !== 'strokeRect') continue;
    const half = (o.lineWidth ?? 1) / 2;
    if (o.op === 'strokeRect') {
      const [x, y, w, h] = o.rect;
      if (Math.abs(x + w / 2 - sp.x) < 0.01 && Math.abs(y + h / 2 - sp.y) < 0.01) R = Math.max(R, Math.hypot(w / 2, h / 2) + half);
      continue;
    }
    const p0 = o.path[0];
    if (p0?.[0] === 'arc' && Math.abs(p0[1] - sp.x) < 0.01 && Math.abs(p0[2] - sp.y) < 0.01) R = Math.max(R, p0[3] + half);
    if (p0?.[0] === 'rect' && Math.abs(p0[1] + p0[3] / 2 - sp.x) < 0.01 && Math.abs(p0[2] + p0[4] / 2 - sp.y) < 0.01) R = Math.max(R, Math.hypot(p0[3] / 2, p0[4] / 2) + half);
  }
  return R;
}

/** Distance from (x, y) to the nearest point of a rect [rx, ry, w, h]. */
const rectDist = (x, y, [rx, ry, w, h]) => Math.hypot(Math.max(rx - x, 0, x - rx - w), Math.max(ry - y, 0, y - ry - h));

/** The label's text op and the 14px backing drawn just before it. */
function labelOf(ops, text) {
  const i = ops.findIndex((o) => o.op === 'fillText' && o.text === text);
  assert.ok(i >= 0, `label ${text} drawn`);
  const back = ops.slice(0, i).reverse().find((o) => o.op === 'fillRect' && o.rect[3] === 14);
  return { text: ops[i], back: back.rect };
}

test('labels keep 2px clear of the outermost ring a node draws: gauges, drift marks, folds, builder squares', () => {
  const nodes = [
    { id: '__core', kind: 'core', label: 'hub' },
    { id: 'hq', kind: 'site', parent: '__core', label: 'hq', status: 'ok', metrics: { cpu: 0.4, mem: 0.5 } },
    { id: 'backup', kind: 'room', parent: 'hq', label: 'backup', status: 'unknown', drift: 'missing' },
    { id: 'repos', kind: 'room', parent: 'hq', label: 'repos', status: 'ok', metrics: { cpu: 0.2, mem: 0.9 } },
    { id: 'new', kind: 'room', parent: 'hq', label: 'new', status: 'ok', drift: 'undeclared' },
    { id: 'b', kind: 'builder', parent: 'hq', builder: 'builder-b', label: 'BB', code: 'BB', status: 'ok', drift: 'undeclared' },
    { id: 'lane:b/x', kind: 'lane', parent: 'b', builder: 'builder-b', label: 'feat-x', status: 'attention' },
    { id: 'lane:b/y', kind: 'lane', parent: 'b', builder: 'builder-b', label: 'fix-y', status: 'working' },
  ];
  for (const s of [1.3, 1.6]) {
    const ctx = fakeCtx();
    const scene = sceneOf(nodes, { overlay: 'drift', s, folded: new Set(['repos']), kids: new Map([['repos', [{ id: 'k1' }, { id: 'k2' }]]]) });
    const r = createRenderer(ctx, PAL);
    r.drawNodes(scene);
    const nodeOps = [...ctx.ops];
    r.drawLabels(scene);
    for (const [id, text] of [['hq', 'HQ'], ['backup', 'BACKUP'], ['repos', 'REPOS'], ['new', 'NEW'], ['b', 'BUILDER-B'], ['lane:b/x', 'FEAT-X'], ['lane:b/y', 'FIX-Y']]) {
      const sp = scene.toScreen(scene.nodes.get(id));
      const R = drawnReach(nodeOps, sp);
      assert.ok(R > 0, `${id} draws something`);
      const { back } = labelOf(ctx.ops, text);
      assert.ok(rectDist(sp.x, sp.y, back) >= R + 2 - 1e-6, `${id} at s=${s}: label ${rectDist(sp.x, sp.y, back).toFixed(1)} from centre, ring reaches ${R.toFixed(1)}`);
    }
  }
});

test('the +N plate sits outside the fold ring on a 45 degree diagonal, 2px clear, away from the label', () => {
  const ctx = fakeCtx();
  const nodes = FLEET.slice(0, 4);
  const kids = new Map([['builder:builder-a', [FLEET[4], { id: 'lane:builder-a/b' }]]]);
  const scene = sceneOf(nodes, { folded: new Set(['builder:builder-a']), kids, rolled: () => 'ok' });
  const [plate] = createRenderer(ctx, PAL).drawNodes(scene);
  const c = scene.nodes.get('builder:builder-a');
  const sp = scene.toScreen(c);
  const ring = ctx.ops.find((o) => o.op === 'stroke' && o.dash.length && o.path[0]?.[0] === 'arc' && Math.abs(o.path[0][1] - sp.x) < 0.01);
  const rect = [plate.x, plate.y, plate.w, plate.h];
  assert.ok(rectDist(sp.x, sp.y, rect) >= ring.path[0][3] + 2 - 1e-6, 'clear of the dotted ring');
  const corner = [[plate.x, plate.y], [plate.x + plate.w, plate.y], [plate.x, plate.y + plate.h], [plate.x + plate.w, plate.y + plate.h]]
    .sort((a, b) => Math.hypot(a[0] - sp.x, a[1] - sp.y) - Math.hypot(b[0] - sp.x, b[1] - sp.y))[0];
  assert.ok(Math.abs(Math.abs(corner[0] - sp.x) - Math.abs(corner[1] - sp.y)) < 1e-6, 'its near corner is on the diagonal');
  const mid = [plate.x + plate.w / 2 - sp.x, plate.y + plate.h / 2 - sp.y];
  assert.ok(mid[0] * Math.cos(c.t) + mid[1] * Math.sin(c.t) < 0, 'on the side away from the label');
});

test('the +N plate clears the outermost ring its node draws, not only the dotted fold ring (review 6, Map 6)', () => {
  const nodes = [
    ...FLEET.slice(0, 3),
    { id: 'b', kind: 'builder', parent: 'agents', builder: 'builder-b', label: 'BB', code: 'BB', status: 'ok', drift: 'undeclared', metrics: { cpu: 0.5, mem: 0.6 } },
  ];
  for (const s of [1, 1.6]) {
    const ctx = fakeCtx();
    const scene = sceneOf(nodes, { overlay: 'drift', s, folded: new Set(['b']), kids: new Map([['b', [{ id: 'k1' }, { id: 'k2' }]]]) });
    const [plate] = createRenderer(ctx, PAL).drawNodes(scene);
    const sp = scene.toScreen(scene.nodes.get('b'));
    const R = drawnReach(ctx.ops.filter((o) => o.op !== 'strokeRect' || o.strokeStyle !== 'LINE'), sp);
    const d = rectDist(sp.x, sp.y, [plate.x, plate.y, plate.w, plate.h]);
    assert.ok(d >= R + 2 - 1e-6, `s=${s}: plate ${d.toFixed(1)} from centre, the drift square reaches ${R.toFixed(1)}`);
  }
});

test('an ambient ping round a folded node passes behind its +N plate: the plate is clipped out of the ping', () => {
  const nodes = [...FLEET.slice(0, 4), { id: 'lane:builder-a/x', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', label: 'feat-x', status: 'attention' }];
  const id = 'lane:builder-a/x';
  const ctx = fakeCtx();
  const scene = sceneOf(nodes, {
    folded: new Set([id]), kids: new Map([[id, [{ id: 's1' }, { id: 's2' }]]]),
    now: 1000, pulses: [{ id, t0: 400, tone: 'warn', soft: true }],
  });
  const [plate] = createRenderer(ctx, PAL).drawNodes(scene);
  assert.equal(plate.id, id);
  const sp = scene.toScreen(scene.nodes.get(id));
  const i = ctx.ops.findIndex((o) => o.op === 'stroke' && o.path[0]?.[0] === 'arc' && Math.abs(o.path[0][1] - sp.x) < 0.01 && o.path[0][3] > 11);
  assert.ok(i > 0, 'the ping is drawn');
  const clip = ctx.ops.slice(0, i).findLast((o) => o.op === 'clip');
  assert.ok(clip, 'under a clip');
  assert.equal(clip.rule, 'evenodd');
  const hole = clip.path.find((p) => p[0] === 'rect' && p[3] < 1000);
  assert.ok(hole, 'with a hole');
  const [, hx, hy, hw, hh] = hole;
  assert.ok(hx <= plate.x && hy <= plate.y && hx + hw >= plate.x + plate.w && hy + hh >= plate.y + plate.h, 'the hole covers the plate');
  const back = ctx.ops.findIndex((o, k) => k > i && o.op === 'restore');
  const plateAt = ctx.ops.findIndex((o) => o.op === 'fillRect' && o.rect[0] === plate.x);
  assert.ok(back > i && back < plateAt, 'the clip ends before the nodes and the plate are drawn');
});

test('a label flips to the left of its node before it crosses the right edge, and over the node when neither side fits', () => {
  const nodes = [...FLEET.slice(0, 2), { id: 'east', kind: 'room', parent: 'hq', label: 'eastern-room', status: 'ok' }];
  const base = sceneOf(nodes);
  const c = base.nodes.get('east');
  // Put the room due east of the centre so its label wants to run right.
  base.nodes.set('east', { ...c, t: 0 });
  const sp = base.toScreen(c);
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawLabels({ ...base, W: sp.x + 60 });
  const { text, back } = labelOf(ctx.ops, 'EASTERN-ROOM');
  assert.ok(back[0] + back[2] <= sp.x, 'the label is on the left of the node');
  assert.ok(back[0] >= 4, 'and inside the canvas');
  assert.ok(Math.abs(text.y - sp.y) < 1, 'on the node\'s row');

  const ctx2 = fakeCtx();
  // 90px is a phone: only the selection (or trouble) keeps its label there.
  const narrow = { ...base, W: 90, selected: 'east', toScreen: () => ({ x: 45, y: 300 }) };
  createRenderer(ctx2, PAL).drawLabels(narrow);
  const over = labelOf(ctx2.ops, 'EASTERN-ROOM');
  assert.ok(over.back[1] + 14 <= 300, 'neither side fits: it goes above the node');
  assert.ok(over.back[0] >= 2 && over.back[0] + over.back[2] <= 90, 'kept inside the canvas');
});

test('a builder on a machine labelled with its name is labelled by its code; one without keeps its name', () => {
  const host = { id: 'vm-a', kind: 'room', parent: 'hq', label: 'builder-a', status: 'ok', hosts: 'builder-a' };
  const nodes = [...FLEET.slice(0, 2), host, { ...FLEET[3], parent: 'vm-a' }];
  const ctx = fakeCtx();
  createRenderer(ctx, PAL).drawLabels(sceneOf(nodes));
  const texts = ctx.ops.filter((o) => o.op === 'fillText').map((o) => o.text);
  assert.equal(texts.filter((t) => t === 'BUILDER-A').length, 1, 'the host says it once');
  assert.ok(texts.includes('B1'), 'the builder says its code');
  const ctx2 = fakeCtx();
  createRenderer(ctx2, PAL).drawLabels(sceneOf(FLEET));
  assert.ok(ctx2.ops.some((o) => o.op === 'fillText' && o.text === 'BUILDER-A'), 'a builder in a plain room keeps its name');
  const vm = { ...host, label: 'vm-a' };
  const ctx3 = fakeCtx();
  createRenderer(ctx3, PAL).drawLabels(sceneOf([...FLEET.slice(0, 2), vm, { ...FLEET[3], parent: 'vm-a' }]));
  assert.ok(ctx3.ops.some((o) => o.op === 'fillText' && o.text === 'BUILDER-A'), 'a builder on a machine with another name keeps its name');
});

test('the core\'s label is left to the map title on a phone-wide canvas', () => {
  const draw = (W) => {
    const ctx = fakeCtx();
    createRenderer(ctx, PAL).drawLabels(sceneOf(FLEET, { W }));
    return ctx.ops.some((o) => o.op === 'fillText' && o.text === 'FLEET');
  };
  assert.equal(draw(1600), true);
  assert.equal(draw(390), false);
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

test('readout text: zoom, scope, node count, overlay, and no clock (T19: the header has the time)', () => {
  const r = createRenderer(fakeCtx(), PAL);
  const now = Date.UTC(2026, 0, 2, 12, 4, 31);
  assert.equal(r.readout({ zoom: 1.8, scope: 'B1', drawn: 214, total: 570, overlay: 'ci', now }), 'Z 1.80×  SCOPE B1  N 214/570  OVL CI');
  assert.equal(r.readout({ zoom: 1, scope: 'all', drawn: 3, total: 3, now }), 'Z 1.00×  SCOPE ALL  N 3/3  OVL STATUS');
  assert.equal(r.readout({ zoom: 2, drawn: 1, total: 2, now, compact: true }), 'Z 2.00× · N 1/2');
  assert.match(r.readout({ now, p95: 3.24 }), /P95 3\.2MS$/);
  assert.equal(r.readout({ zoom: 1, drawn: 3, total: 3, overlay: 'drift', drift: { missing: 1, undeclared: 2 }, now }),
    'Z 1.00×  SCOPE ALL  N 3/3  OVL DRIFT  ◌ NOT SEEN 1  □ NOT DECLARED 2');
  assert.doesNotMatch(r.readout({ overlay: 'status', drift: { missing: 1, undeclared: 2 }, now }), /NOT SEEN/);
  assert.match(r.readout({ overlay: 'reach', reach: { links: 12, touches: null }, now }), /OVL REACH {2}LINKS 12$/);
  assert.match(r.readout({ overlay: 'reach', reach: { links: 12, touches: 3 }, now }), /LINKS 12 {2}TOUCHES 3/);
  assert.doesNotMatch(r.readout({ overlay: 'status', reach: { links: 12, touches: 3 }, now }), /LINKS/);
  assert.match(r.readout({ overlay: 'reach', reach: { links: 12, touches: null, unresolved: 2 }, now }), /LINKS 12 {2}UNRESOLVED 2/);
  assert.doesNotMatch(r.readout({ overlay: 'reach', reach: { links: 12, touches: null, unresolved: 0 }, now }), /UNRESOLVED/);
  for (const ov of ['status', 'ci', 'drift', 'reach']) {
    for (const compact of [false, true]) assert.doesNotMatch(r.readout({ overlay: ov, now, compact }), /\d\d:\d\d|UTC/, `${ov} ${compact}`);
  }
});

test('readout at phone width keeps the overlay and its count, no clock', () => {
  const r = createRenderer(fakeCtx(), PAL);
  const now = Date.UTC(2026, 0, 2, 12, 4, 31);
  const base = { zoom: 1, drawn: 22, total: 24, now, compact: true };
  const drift = r.readout({ ...base, overlay: 'drift', drift: { missing: 1, undeclared: 1 } });
  assert.equal(drift, 'Z 1.00× · N 22/24 · DRIFT ◌1 □1');
  assert.equal(r.readout({ ...base, overlay: 'reach', reach: { links: 9, touches: null } }), 'Z 1.00× · N 22/24 · REACH 9');
  assert.equal(r.readout({ ...base, overlay: 'reach', reach: { links: 9, touches: 3 } }), 'Z 1.00× · N 22/24 · REACH 3/9');
  assert.equal(r.readout({ ...base, overlay: 'ci' }), 'Z 1.00× · N 22/24 · OVL CI');
  assert.equal(r.readout({ ...base, overlay: 'status' }), 'Z 1.00× · N 22/24');
  // Fits the 390 corner: one short line, no clock once an overlay is on.
  for (const t of [drift, r.readout({ ...base, overlay: 'reach', reach: { links: 120, touches: 30 } })]) {
    assert.doesNotMatch(t, /\d\d:\d\d:\d\dZ/);
    assert.ok(t.length <= 34, t);
  }
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

// --- T19 Map polish -------------------------------------------------------------

test('topology edges take the theme\'s edge weight (--map-edge-alpha: dimmer on light); trouble edges keep theirs (T19)', (t) => {
  const prev = globalThis.getComputedStyle;
  t.after(() => { globalThis.getComputedStyle = prev; });
  for (const [raw, want] of [['0.6', 0.6], [' 1 ', 1], ['', 1], ['nope', 1], ['3', 1]]) {
    globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => (n === '--map-edge-alpha' ? raw : '') });
    assert.equal(readPalette({}).edge, want, `"${raw}"`);
  }
  const nodes = [...FLEET, { id: 'lane:builder-a/api', kind: 'lane', parent: 'builder:builder-a', label: 'api', status: 'working' }];
  const links = [
    { id: 'c1', kind: 'conflict', from: 'lane:builder-a/pay', to: 'lane:builder-a/api', predicted: false, severity: 'crit' },
    { id: 't', kind: 'touch', from: 'lane:builder-a/api', to: 'builder:builder-a' },
  ];
  const strokes = (edge) => {
    const ctx = fakeCtx();
    const r = createRenderer(ctx, { ...PAL, edge });
    const scene = sceneOf(nodes, { links });
    r.drawTree(scene);
    const tree = ctx.ops.filter((o) => o.op === 'stroke');
    ctx.ops.length = 0;
    r.drawLinks(scene);
    const [conflict, touch] = ctx.ops.filter((o) => o.op === 'stroke');
    return { tree, conflict, touch };
  };
  const dark = strokes(1), light = strokes(0.6);
  assert.ok(dark.tree.every((o) => o.alpha === 1));
  assert.ok(light.tree.every((o) => Math.abs(o.alpha - 0.6) < 1e-9), 'tree branches one step dimmer');
  assert.ok(Math.abs(light.touch.alpha - 0.35 * 0.6) < 1e-9, 'grey links too');
  assert.equal(light.conflict.alpha, dark.conflict.alpha, 'a confirmed conflict keeps its weight');
});

test('the +N plate stays off every ring hairline, still away from the label (T19)', () => {
  const W = 20, H = 14;
  const span = (b, c0) => {
    const dx = Math.max(b.x - c0.x, 0, c0.x - (b.x + b.w)), dy = Math.max(b.y - c0.y, 0, c0.y - (b.y + b.h));
    const fx = Math.max(Math.abs(c0.x - b.x), Math.abs(c0.x - b.x - b.w)), fy = Math.max(Math.abs(c0.y - b.y), Math.abs(c0.y - b.y - b.h));
    return [Math.hypot(dx, dy), Math.hypot(fx, fy)];
  };
  const c0 = { x: 0, y: 0 };
  let moved = 0;
  // A node at every bearing on a ring, or staggered off it (layout.js: -10,
  // +16 px), the next ring in 130px and out 130px.
  for (let deg = 0; deg < 360; deg += 5) {
    const ang = (deg / 180) * Math.PI - Math.PI / 2;
    for (const [R, st] of [[150, 0], [290, 0], [420, 0], [420, -10], [420, 16], [540, 16]]) {
      const sp = { x: Math.cos(ang) * (R + st), y: Math.sin(ang) * (R + st) };
      const hair = [R - 130, R, R + 130];
      const plain = platePlace(sp, ang, 11, W, H);
      const b = platePlace(sp, ang, 11, W, H, c0, hair);
      if (b.x !== plain.x || b.y !== plain.y) moved++;
      const [lo, hi] = span(b, c0);
      assert.ok(hair.every((h) => h < lo - 1 || h > hi + 1), `bearing ${deg} on ${R}${st ? ` ${st}` : ''}: plate ${lo.toFixed(1)}..${hi.toFixed(1)} crosses a hairline`);
      const mid = [b.x + W / 2 - sp.x, b.y + H / 2 - sp.y];
      assert.ok(mid[0] * Math.cos(ang) + mid[1] * Math.sin(ang) < 0, `bearing ${deg}: away from the label`);
      assert.ok(rectDist(sp.x, sp.y, [b.x, b.y, W, H]) >= 11 + 2 - 1e-6, 'clear of the fold ring');
    }
  }
  assert.ok(moved > 0, 'some plates leave the straight-back diagonal for a side one');
});
