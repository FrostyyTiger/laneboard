// Link labels off on the Wall (plan T27, r20-skeptic #1): `deploys` and
// `clones` sat on node names and could not be read at 3 m. The Map's
// `edgeLabels` option drops the label from a link and keeps the link; it
// defaults on, so the app's Map is drawn as before; every Wall direction
// turns it off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { layout } from '../public/js/views/map/layout.js';
import { createRenderer } from '../public/js/views/map/render.js';
import { mapOptionsFor, VARIANTS } from '../public/js/wall/variants.js';

const PAL = {
  bg: 'BG', sunken: 'SUNK', line: 'LINE', lineWeak: 'LINEW', t1: 'T1', t2: 'T2', t3: 'T3',
  accent: 'ACC', accentL: ['A40', 'A50', 'A60', 'A70', 'A80'],
  crit: 'P1', warn: 'P2', low: 'P3', ok: 'OK', mono: 'MONO', label: 'LABEL',
};

const FLEET = [
  { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
  { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
  { id: 'hv1/ci', kind: 'service', parent: 'hv1', label: 'ci', status: 'ok' },
  { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'ok' },
  { id: 'hv2/web', kind: 'service', parent: 'hv2', label: 'web', status: 'ok' },
];
const LINKS = [{ from: 'hv1/ci', to: 'hv2/web', kind: 'flow', label: 'deploys' }];

/** A 2D context that records fillText; everything else is a no-op. */
function recordingCtx() {
  const text = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, font: '10px x' };
  return new Proxy(state, {
    get(o, k) {
      if (k === 'text') return text;
      if (k in o) return o[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'fillText') return (t) => text.push(String(t));
      if (k === 'getLineDash') return () => [];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

function sceneOf(extra = {}) {
  const lay = layout(FLEET);
  const byId = new Map(FLEET.map((n) => [n.id, n]));
  const nodes = new Map();
  for (const [id, p] of lay.pos) {
    const n = byId.get(id) ?? lay.center;
    nodes.set(id, { x: p.x, y: p.y, r: p.r, t: p.angle, a: 1, node: n, pid: n.parent ?? null, depth: p.depth });
  }
  return {
    W: 1600, H: 1200, now: 1000, s: 2, zoom: 2, toScreen: (p) => ({ x: 800 + p.x, y: 600 + p.y }),
    pos: lay.pos, nodes, byId, links: LINKS, overlay: 'status', rolled: () => null, folded: new Set(), kids: lay.kids,
    alpha: () => 1, hover: null, selected: null, selT: 1, highlight: null, near: new Set(), matches: new Set(),
    pulses: [], comets: [], reduced: false, anchor: null, ...extra,
  };
}

test('renderer: a link label is drawn by default, none with edgeLabels false', () => {
  for (const extra of [{}, { hover: 'hv1/ci', s: 1 }]) {
    const on = recordingCtx();
    createRenderer(on, PAL).drawLinks(sceneOf(extra));
    assert.deepEqual(on.text, ['deploys'], 'default: the label (zoomed in, or hot)');
    const off = recordingCtx();
    createRenderer(off, PAL).drawLinks(sceneOf({ ...extra, edgeLabels: false }));
    assert.deepEqual(off.text, [], 'no label');
  }
});

test('renderer: edgeLabels false keeps the link itself', () => {
  const strokes = (scene) => {
    let n = 0;
    const ctx = recordingCtx();
    const proxy = new Proxy(ctx, { get: (o, k) => (k === 'stroke' ? () => { n++; } : o[k]), set: (o, k, v) => { o[k] = v; return true; } });
    createRenderer(proxy, PAL).drawLinks(scene);
    return n;
  };
  assert.equal(strokes(sceneOf({ edgeLabels: false })), strokes(sceneOf()));
  assert.ok(strokes(sceneOf({ edgeLabels: false })) > 0, 'the link is stroked');
});

async function mount(opts) {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, opts);
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  map.update({ title: 'acme', nodes: FLEET, links: LINKS, events: [] });
  map.select('hv1/ci');
  dom.flush(20);
  return { dom, map, text: canvas.ctx.calls.text };
}

test('createMap: edgeLabels defaults on (a hot link reads its label); off, it does not', async (t) => {
  {
    const { dom, map, text } = await mount({});
    map.destroy(); dom.restore();
    assert.ok(text.includes('deploys'), 'default: the selected node\'s link label');
  }
  const { dom, map, text } = await mount({ edgeLabels: false });
  t.after(() => { map.destroy(); dom.restore(); });
  assert.ok(!text.includes('deploys'), 'no link label');
});

test('every Wall direction turns link labels off, at any aspect', () => {
  for (const v of VARIANTS) {
    assert.equal(mapOptionsFor(v).edgeLabels, false, v.id);
    assert.equal(mapOptionsFor(v, 1.5, { dpr: 2, cssHeight: 912, screenMm: 260 }).edgeLabels, false, v.id);
  }
});
