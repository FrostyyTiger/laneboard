// T10: run nodes on the Map (server/map/runs.mjs runNodes) drawn with a
// progress ring (render.js), their tone (overlays.js runRing / runFacts), the
// label's round, and the inspector's run panel (ui/inspector.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../public/js/views/map/render.js';
import { layout, RUN_RING, RUN_RING_MIN, runRingR } from '../public/js/views/map/layout.js';
import { runRing, runRound, runHref, runFacts } from '../public/js/views/map/overlays.js';
import { runInspectorModel, runNodeFor, modelFor, renderOverview, renderHeader } from '../public/js/ui/inspector.js';
import { makeDocument, makeEl, texts } from './helpers/fakedom.mjs';

const TAU = Math.PI * 2;

/** A 2D context that records arcs per stroke/fill, and text. */
function fakeCtx() {
  const ops = [];
  let path = [];
  let dash = [];
  const ctx = {
    ops, fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, font: '10px x',
    textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px',
    beginPath() { path = []; },
    closePath() { path.push(['closePath']); },
    moveTo(x, y) { path.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); },
    arc(x, y, r, a0, a1) {
      if (!(r >= 0)) throw new Error(`negative radius ${r}`);
      path.push(['arc', x, y, r, a0, a1]);
    },
    rect(x, y, w, h) { path.push(['rect', x, y, w, h]); },
    bezierCurveTo() {}, quadraticCurveTo() {},
    fill() { ops.push({ op: 'fill', fillStyle: ctx.fillStyle, alpha: ctx.globalAlpha, path: [...path] }); },
    stroke() { ops.push({ op: 'stroke', strokeStyle: ctx.strokeStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, dash: [...dash], path: [...path] }); },
    fillRect(x, y, w, h) { ops.push({ op: 'fillRect', rect: [x, y, w, h] }); },
    strokeRect() {}, clearRect() {},
    fillText(text, x, y) { ops.push({ op: 'fillText', text, x, y, font: ctx.font, fillStyle: ctx.fillStyle, align: ctx.textAlign }); },
    measureText(text) { return { width: String(text).length * 6 }; },
    setLineDash(d) { dash = [...d]; },
    save() {}, restore() {}, setTransform() {},
  };
  return ctx;
}

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

function sceneOf(nodes, extra = {}) {
  const lay = layout(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cur = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    cur.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? null, depth: p.depth });
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

const run = (id, extra = {}) => ({
  id: `run:${id}`, kind: 'run', parent: '__core', label: id, run: id, goal: `goal of ${id}`,
  state: 'running', status: 'working', round: 3, maxRounds: 10, progress: 0.3, stuck: null,
  href: `#/runs?run=${id}`, ...extra,
});

const CORE = { id: '__core', kind: 'core', label: 'demo-host' };

/** The strokes drawn as arcs centred on the node's screen point. */
function arcsAt(ctx, scene, id) {
  const sp = scene.toScreen(scene.nodes.get(id));
  return ctx.ops.filter((o) => (o.op === 'stroke' || o.op === 'fill') && o.path[0]?.[0] === 'arc'
    && Math.abs(o.path[0][1] - sp.x) < 0.01 && Math.abs(o.path[0][2] - sp.y) < 0.01);
}

test('the ring: a full grey track and a progress arc from twelve o\'clock at 0, 0.5 and 1', () => {
  for (const [p, sweep] of [[0, null], [0.5, Math.PI], [1, TAU]]) {
    const nodes = [CORE, run('r', { progress: p })];
    const ctx = fakeCtx();
    const scene = sceneOf(nodes);
    createRenderer(ctx, PAL).drawNodes(scene);
    const arcs = arcsAt(ctx, scene, 'run:r');
    const track = arcs.find((o) => o.op === 'stroke' && o.strokeStyle === 'LINE');
    assert.ok(track, `a track at ${p}`);
    assert.equal(track.path[0][5] - track.path[0][4], TAU, 'the track goes all round');
    const r = track.path[0][3];
    assert.ok(r >= RUN_RING, 'the ring sits outside the centre mark');
    assert.ok(r >= 14, `the ring is at least 14px out (T19), got ${r}`);
    const prog = arcs.filter((o) => o.op === 'stroke' && o.strokeStyle === 'T2' && o.path[0][3] === r);
    if (sweep === null) assert.equal(prog.length, 0, 'no arc at 0');
    else {
      assert.equal(prog.length, 1, `one progress arc at ${p}`);
      assert.equal(prog[0].path[0][4], -Math.PI / 2, 'starts at twelve o\'clock');
      assert.ok(Math.abs(prog[0].path[0][5] - prog[0].path[0][4] - sweep) < 1e-9, `sweeps ${p} of the circle`);
    }
    for (const o of ctx.ops) assert.notEqual(o.strokeStyle, 'ACC', 'never the accent');
  }
});

test('the ring is grey while fine, warn ▲ when stuck, crit ■ when stopped on error, hollow when stopped fine', () => {
  const nodes = [CORE,
    run('fine'),
    run('stuck', { status: 'warn', stuck: { rule: 'same-task', reason: 'T3 failed twice' }, why: 'T3 failed twice' }),
    run('fail', { state: 'stopped', status: 'crit', why: 'stopped: error' }),
    run('done', { state: 'stopped', status: 'idle', progress: 1 })];
  const ctx = fakeCtx();
  const scene = sceneOf(nodes);
  createRenderer(ctx, PAL).drawNodes(scene);
  const colours = (id) => new Set(arcsAt(ctx, scene, id).map((o) => o.strokeStyle ?? o.fillStyle));
  assert.ok(!colours('run:fine').has('P2') && !colours('run:fine').has('P1'), 'fine is grey');
  const sp = (id) => scene.toScreen(scene.nodes.get(id));
  const shapesNear = (id) => ctx.ops.filter((o) => o.op === 'fill' && o.path.length
    && ((o.path[0][0] === 'moveTo' && Math.abs(o.path[0][1] - sp(id).x) < 0.01)
      || (o.path[0][0] === 'rect' && Math.abs(o.path[0][1] + o.path[0][3] / 2 - sp(id).x) < 0.01)));
  const tri = shapesNear('run:stuck').find((o) => o.path[0][0] === 'moveTo');
  assert.equal(tri?.fillStyle, 'P2', 'stuck: a warn triangle');
  assert.ok(arcsAt(ctx, scene, 'run:stuck').some((o) => o.strokeStyle === 'P2'), 'stuck: the arc in warn');
  const sq = shapesNear('run:fail').find((o) => o.path[0][0] === 'rect');
  assert.equal(sq?.fillStyle, 'P1', 'failed: a crit square');
  const done = arcsAt(ctx, scene, 'run:done');
  assert.ok(done.some((o) => o.op === 'fill' && o.fillStyle === 'BG'), 'stopped fine: hollow centre');
  assert.ok(done.every((o) => o.alpha <= 0.6 + 1e-9), 'stopped fine: faded');
  assert.ok(!colours('run:done').has('P1') && !colours('run:done').has('P2'));
});

test('runRing / runFacts: tones, progress clamped, the stuck tone wins over a running state', () => {
  assert.deepEqual(runRing(run('a')), { progress: 0.3, tone: 'grey', shape: 'disc', hollow: false, alpha: 1 });
  assert.equal(runRing(run('a', { stuck: { rule: 'no-progress' } })).tone, 'warn');
  assert.equal(runRing(run('a', { stuck: { rule: 'no-progress' } })).shape, 'tri');
  assert.equal(runRing(run('a', { state: 'stopped', status: 'crit' })).shape, 'square');
  assert.equal(runRing(run('a', { state: 'stopped', status: 'idle' })).hollow, true);
  assert.equal(runRing(run('a', { progress: 1.7 })).progress, 1);
  assert.equal(runRing(run('a', { progress: -1 })).progress, 0);
  assert.equal(runRing(run('a', { progress: null })).progress, null);
  assert.equal(runRound(run('a')), '3 of 10');
  assert.equal(runRound(run('a', { maxRounds: null })), '3');
  assert.equal(runRound(run('a', { round: null })), null);
  // T5: a tasks max wins, the label prints the numbers the ring draws
  assert.equal(runRound(run('a', { tasks: { value: 44, max: 63, firstMax: 12 } })), '44 of 63');
  assert.equal(runRound(run('a', { round: null, tasks: { value: 44, max: 63, firstMax: 63 } })), '44 of 63');
  assert.equal(runFacts(run('a', { tasks: { value: 44, max: 63, firstMax: 12 } })).tasks, '44 of 63 tasks, scope 12 → 63');
  assert.equal(runFacts(run('a')).tasks, null);
  assert.equal(runHref(run('a b')), '#/runs?run=a%20b');
  const f = runFacts(run('acme', { progress: 0.5, round: 5 }));
  assert.equal(f.goal, 'goal of acme');
  assert.equal(f.round, 'round 5 / 10');
  assert.equal(f.progress, '50 %');
  assert.equal(f.href, '#/runs?run=acme');
  assert.equal(runFacts({ kind: 'lane' }), null);
});

test('labels: the run name in the lane label style (500, T51), muted (t3), its round in mono beside it, clear of the ring', () => {
  const nodes = [CORE, run('acme-docs', { round: 7, maxRounds: 10 })];
  const ctx = fakeCtx();
  const scene = sceneOf(nodes);
  createRenderer(ctx, PAL).drawLabels(scene);
  const name = ctx.ops.find((o) => o.op === 'fillText' && o.text === 'ACME-DOCS');
  assert.ok(name, 'caps name');
  assert.match(name.font, /^500 11px LABEL/, 'the weight and size a lane label has');
  assert.equal(name.fillStyle, 'T3', 'muted next to its machine (T19)');
  const round = ctx.ops.find((o) => o.op === 'fillText' && o.text === '7 of 10');
  assert.ok(round, 'the round');
  assert.match(round.font, /MONO/);
  const sp = scene.toScreen(scene.nodes.get('run:acme-docs'));
  const d = Math.hypot(name.x - sp.x, name.y - sp.y);
  assert.ok(d >= RUN_RING_MIN + 2, `label ${d.toFixed(1)}px out, past the ring`);
  const nameW = 'ACME-DOCS'.length * 6;
  if (name.align === 'left') assert.ok(round.x > name.x + nameW, 'round after the name');
  else assert.ok(round.x > name.x, 'round after a right-aligned name too (T5), between it and the node');
});

test('inspector: a run sel opens the run panel with goal, round, progress and the run page link', () => {
  const node = run('acme-docs', { round: 7, maxRounds: 10, progress: 0.38 });
  const s = { map: { nodes: [CORE, node] }, sessions: new Map(), lanes: [], builders: new Map(), source: { kind: 'hub' } };
  assert.equal(runNodeFor(s, 'run:acme-docs'), node);
  assert.equal(runNodeFor(s, 'run:nope'), null);
  assert.equal(runNodeFor(s, 'builder-a/x'), null);
  const m = modelFor(s, 'run:acme-docs');
  assert.equal(m.title, 'acme-docs');
  assert.equal(m.word, 'RUN');
  assert.equal(m.found, false, 'no lane actions on a run');
  assert.equal(m.run.round, 'round 7 / 10');
  const stuck = runInspectorModel(run('b', { stuck: { rule: 'same-task' }, why: 'T3 failed twice' }));
  assert.equal(stuck.p, '2');
  assert.equal(stuck.word, 'STCK');
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: makeDocument({ byId: new Map() }), configurable: true, writable: true });
  try {
    const ovw = renderOverview(m, globalThis.document);
    const t = texts(ovw);
    assert.ok(t.includes('goal of acme-docs'));
    assert.ok(t.includes('7 / 10'));
    assert.ok(t.includes('38 %'));
    const find = (n) => (n.tagName === 'A' ? n : n.children.map(find).find(Boolean));
    const a = find(ovw);
    assert.equal(a?.href, '#/runs?run=acme-docs');
    assert.ok(texts(renderHeader(m)).includes('acme-docs'));
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

test('a label that would cross the right edge moves over its node, inside the canvas', () => {
  const nodes = [CORE, run('acme-billing-long-name', { round: 4, maxRounds: 10 })];
  const scene = sceneOf(nodes);
  const sp = scene.toScreen(scene.nodes.get('run:acme-billing-long-name'));
  for (const W of [1600, sp.x + 40]) {
    const ctx = fakeCtx();
    createRenderer(ctx, PAL).drawLabels({ ...scene, W });
    const name = ctx.ops.find((o) => o.op === 'fillText' && o.text === 'ACME-BILLING-LONG-NAME');
    const right = name.align === 'left' ? name.x + 22 * 6 : name.x;
    assert.ok(right <= W, `inside ${W}: ends at ${right}`);
    if (W < 1600 && name.align === 'left') assert.ok(name.y < sp.y && name.x < sp.x, 'over the node, starting left of it');
  }
});

test('the run ring is at least 14px in radius at every node scale, and grows past it when zoomed (T19)', () => {
  assert.equal(RUN_RING_MIN, 14);
  for (const r of [0, 4, 5, 8]) assert.ok(runRingR(r) >= 14, `r ${r}`);
  assert.equal(runRingR(12), 12 + RUN_RING);
  for (const s of [0.8, 1, 1.6]) {
    const nodes = [CORE, run('r', { progress: 0.5 })];
    const ctx = fakeCtx();
    const scene = sceneOf(nodes, { s });
    createRenderer(ctx, PAL).drawNodes(scene);
    const track = arcsAt(ctx, scene, 'run:r').find((o) => o.op === 'stroke' && o.strokeStyle === 'LINE');
    assert.ok(track.path[0][3] >= 14, `s ${s}: ${track.path[0][3]}`);
  }
});
