// Less ornament on the Wall (plan T19, r9-film-ui #6, #8): the Map's
// `gauges: 'trouble'` keeps the cpu/mem rings for what says "look here"
// (trouble, the focus, a hot metric), and `branch` cuts tree branches down
// to stubs off the child. Both default off, so the app's Map is drawn as
// before; radial turns both on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';
import * as radial from '../public/js/wall/variants/radial.js';
import { mapOptionsFor, VARIANTS } from '../public/js/wall/variants.js';

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

const calm = { cpu: 0.3, mem: 0.4 };
const FLEET = [
  { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
  { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok', metrics: calm },
  { id: 'db', kind: 'room', parent: 'hv1', label: 'db', status: 'ok', metrics: calm },
  { id: 'mail', kind: 'room', parent: 'hv1', label: 'mail', status: 'ok', metrics: calm },
  { id: 'storage', kind: 'room', parent: 'hv1', label: 'storage', status: 'crit', metrics: calm },
  { id: 'cache', kind: 'room', parent: 'hv1', label: 'cache', status: 'ok', metrics: { cpu: 0.95, mem: 0.2 } },
  { id: 'db/pg', kind: 'service', parent: 'db', label: 'pg', status: 'ok' },
];

/** A 2D context that records arcs (centre, radius) and bezier ends. */
function recordingCtx() {
  const ops = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, font: '10px x' };
  let from = null;
  return new Proxy(state, {
    get(o, k) {
      if (k === 'ops') return ops;
      if (k in o) return o[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'arc') return (x, y, r) => ops.push({ op: 'arc', x, y, r });
      if (k === 'moveTo') return (x, y) => { from = { x, y }; };
      if (k === 'bezierCurveTo') return (bx, by, cx, cy, x, y) => ops.push({ op: 'bezier', from, to: { x, y } });
      if (k === 'getLineDash') return () => [];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

const toScreen = (p) => ({ x: 800 + p.x, y: 600 + p.y });

function sceneOf(extra = {}) {
  const lay = layout(FLEET);
  const byId = new Map(FLEET.map((n) => [n.id, n]));
  const nodes = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    nodes.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? null, depth: p.depth });
  }
  return {
    W: 1600, H: 1200, now: 1000, s: 1, zoom: 1, toScreen,
    pos: lay.pos, nodes, byId, links: [], overlay: 'status', rolled: () => null, folded: new Set(), kids: lay.kids,
    alpha: () => 1, hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null, ...extra,
  };
}

/** The arcs drawn around node `id`, by radius: a gauged room has its two gauge tracks among them. */
function arcsAt(ctx, sc, id) {
  const sp = toScreen(sc.nodes.get(id));
  return ctx.ops.filter((o) => o.op === 'arc' && Math.abs(o.x - sp.x) < 0.01 && Math.abs(o.y - sp.y) < 0.01).map((o) => o.r);
}

function drawn(extra) {
  const ctx = recordingCtx();
  const sc = sceneOf(extra);
  createRenderer(ctx, PAL).drawNodes(sc);
  return { ctx, sc };
}

test('renderer: by default every gauged node wears its cpu/mem rings', () => {
  const { ctx, sc } = drawn();
  for (const id of ['hv1', 'db', 'mail', 'storage', 'cache']) {
    assert.ok(arcsAt(ctx, sc, id).length >= 4, `${id}: two tracks and two arcs`);
  }
});

test("renderer: gauges 'trouble' leaves calm nodes plain, keeps trouble, a hot metric and the focus", () => {
  const { ctx: base, sc: s0 } = drawn();
  const { ctx, sc } = drawn({ gauges: 'trouble' });
  assert.equal(arcsAt(ctx, sc, 'db').length, 1, 'a calm room is a plain dot (its disc, no ring)');
  assert.equal(arcsAt(ctx, sc, 'mail').length, 1);
  assert.equal(arcsAt(ctx, sc, 'hv1').length, arcsAt(base, s0, 'hv1').length - 4, 'a calm site: its rings, no gauges');
  assert.equal(arcsAt(ctx, sc, 'storage').length, arcsAt(base, s0, 'storage').length, 'crit keeps its gauges');
  assert.equal(arcsAt(ctx, sc, 'cache').length, arcsAt(base, s0, 'cache').length, 'cpu 95 % keeps its gauges');
  for (const focus of [{ follow: 'db' }, { selected: 'db' }, { hover: 'db' }]) {
    const f = drawn({ gauges: 'trouble', ...focus });
    assert.ok(arcsAt(f.ctx, f.sc, 'db').length >= 4, `the focus wears its gauges (${Object.keys(focus)[0]})`);
  }
});

function branches(extra) {
  const ctx = recordingCtx();
  const sc = sceneOf(extra);
  createRenderer(ctx, PAL).drawTree(sc);
  return { ops: ctx.ops.filter((o) => o.op === 'bezier'), sc };
}

test('renderer: branch cuts a branch to a stub off the child; 0 drops it; default draws all', () => {
  const full = branches();
  const parentOf = (sc, op) => {
    for (const [id, c] of sc.nodes) {
      const sp = toScreen(c);
      if (Math.abs(sp.x - op.to.x) < 0.01 && Math.abs(sp.y - op.to.y) < 0.01) return sc.nodes.get(c.pid);
    }
    return null;
  };
  const stub = branches({ branch: (child, parent) => (parent.kind === 'core' ? 1 : 0.25) });
  assert.equal(stub.ops.length, full.ops.length, 'one stroke per branch');
  let cut = 0;
  for (let i = 0; i < full.ops.length; i++) {
    const f = full.ops[i], s = stub.ops[i];
    assert.deepEqual(s.to, f.to, 'every stroke still ends on its child');
    const p = parentOf(full.sc, f);
    if (p?.node?.kind === 'core') { assert.deepEqual(s.from, f.from, 'core spokes are whole'); continue; }
    const lf = Math.hypot(f.from.x - f.to.x, f.from.y - f.to.y), ls = Math.hypot(s.from.x - s.to.x, s.from.y - s.to.y);
    assert.ok(ls < lf * 0.5, 'a stub is short');
    cut++;
  }
  assert.ok(cut >= 5, 'the site and room branches are stubs');
  const none = branches({ branch: () => 0 });
  assert.equal(none.ops.length, 0);
});

test('radial: branch is a stub at the overview, the full fan in a site, core spokes whole', () => {
  const site = { kind: 'site' }, core = { kind: 'core' }, room = { kind: 'room' };
  assert.equal(radial.branch(site, core, { s: 0.5 }), 1);
  assert.equal(radial.branch(room, site, { s: 0.5 }), radial.STUB);
  assert.equal(radial.branch(room, site, { s: radial.STUB_UNTIL }), radial.STUB);
  assert.equal(radial.branch(room, site, { s: radial.IN_SITE }), 1);
  assert.equal(radial.branch(room, site, { s: 1.45 }), 1);
  let last = 0;
  for (let s = 0.5; s <= 1.5; s += 0.05) {
    const v = radial.branch(room, site, { s });
    assert.ok(v >= last - 1e-12, 'grows as the camera flies in, never back');
    last = v;
  }
});

test('radial: the Wall sets gauges and branch; other variants keep the defaults', () => {
  assert.equal(radial.mapOptions.gauges, 'trouble');
  assert.equal(radial.mapOptions.branch, radial.branch);
  const opts = mapOptionsFor(VARIANTS.find((v) => v.id === 'radial'), 1.5, { dpr: 2, cssHeight: 912, screenMm: 260 });
  assert.equal(opts.gauges, 'trouble');
  assert.equal(opts.branch, radial.branch);
});
