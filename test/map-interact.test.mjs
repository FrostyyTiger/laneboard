// The Map's interaction and index (fleet M4, plan §5 2.2, 2.7, 2.9, 2.10):
// the hit grid, camera and pinch maths, selection order and the pointer
// gestures against a fake canvas; then createMap itself against a small fake
// DOM: the HUD panels are gone, the readout is there, scope ghosts other
// builders, overlays cycle and persist, selection reaches the router hooks.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHitGrid, hitRadius, toScreen, toWorld, anchored, boundingCircle, fitCircle,
  twoFinger, pinchStart, pinchMove, clampZoom, laneOrder, nextInOrder, bindPointer,
  ZOOM_MIN, ZOOM_MAX, LONG_PRESS_MS,
} from '../public/js/views/map/interact.js';
import { SCOPE_GHOST, FOLD_KEY } from '../public/js/views/map/model.js';
import { OVERLAY_KEY, nextOverlay } from '../public/js/views/map/overlays.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- hit grid -------------------------------------------------------------

test('hit grid: the nearest disc containing the point wins; misses are null', () => {
  const g = createHitGrid(48);
  g.rebuild([
    { id: 'a', x: 100, y: 100, r: 10 },
    { id: 'b', x: 112, y: 100, r: 10 },
    { id: 'c', x: 400, y: 300, r: 9 },
  ], 1);
  assert.equal(g.hit(101, 100), 'a');
  assert.equal(g.hit(111, 100), 'b');
  assert.equal(g.hit(400, 305), 'c');
  assert.equal(g.hit(250, 250), null);
  assert.equal(g.hit(400, 320), null, 'outside the radius');
  assert.equal(g.count(), 3);
});

test('hit grid: a disc across cell borders is found from every cell it covers', () => {
  const g = createHitGrid(48);
  g.rebuild([{ id: 'big', x: 48, y: 48, r: 30 }], 'x');
  for (const [x, y] of [[30, 30], [66, 30], [30, 66], [66, 66], [48, 20]]) assert.equal(g.hit(x, y), 'big', `${x},${y}`);
  assert.ok(g.cellCount() >= 4);
  // A point only looks at its own cell: far cells hold nothing.
  assert.deepEqual(g.candidates(500, 500), []);
});

test('hit grid: stale() is keyed by the stamp of the last rebuild; bad items are skipped', () => {
  const g = createHitGrid();
  assert.equal(g.stale(0), true);
  g.rebuild([{ id: 'a', x: 1, y: 1, r: 5 }, { id: 'nan', x: NaN, y: 0, r: 5 }, { id: 'zero', x: 0, y: 0, r: 0 }, null], 7);
  assert.equal(g.stale(7), false);
  assert.equal(g.stale(8), true);
  assert.equal(g.count(), 1);
});

test('hitRadius keeps small nodes tappable and grows with zoom', () => {
  assert.equal(hitRadius(1, 0.1), 9);
  assert.ok(hitRadius(5, 2) > hitRadius(5, 1));
});

test('hit grid agrees with a linear scan on random discs', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const items = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, x: rnd() * 1200, y: rnd() * 800, r: 6 + rnd() * 20 }));
  const g = createHitGrid(48);
  g.rebuild(items, 1);
  for (let k = 0; k < 400; k++) {
    const x = rnd() * 1200, y = rnd() * 800;
    let best = null, bd = Infinity;
    for (const it of items) {
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < it.r && d < bd) { best = it.id; bd = d; }
    }
    assert.equal(g.hit(x, y), best);
  }
});

// --- camera and pinch -------------------------------------------------------

const VIEW = { W: 1000, H: 600, fitScale: 0.5 };

test('toScreen and toWorld are inverses; anchored keeps a world point under the pointer', () => {
  const cam = { x: 30, y: -20, z: 1.7 };
  const w = toWorld(VIEW, cam, 640, 210);
  const s = toScreen(VIEW, cam, w);
  assert.ok(close(s.x, 640) && close(s.y, 210));
  const next = anchored(VIEW, w, 640, 210, 3.2);
  const s2 = toScreen(VIEW, next, w);
  assert.ok(close(s2.x, 640) && close(s2.y, 210));
  assert.equal(next.z, 3.2);
});

test('pinch: spreading the fingers to twice the distance doubles the zoom about the midpoint', () => {
  const cam = { x: 0, y: 0, z: 1 };
  const a0 = { x: 400, y: 300 }, b0 = { x: 600, y: 300 };
  const st = pinchStart(a0, b0, VIEW, cam);
  assert.equal(st.dist, 200);
  const w = st.w;
  const next = pinchMove(st, { x: 300, y: 300 }, { x: 700, y: 300 }, VIEW);
  assert.ok(close(next.z, 2));
  const s = toScreen(VIEW, next, w);
  assert.ok(close(s.x, 500) && close(s.y, 300), 'the point under the midpoint stays under it');
});

test('pinch: moving both fingers together pans without zooming', () => {
  const cam = { x: 10, y: 10, z: 1.5 };
  const st = pinchStart({ x: 100, y: 100 }, { x: 200, y: 100 }, VIEW, cam);
  const next = pinchMove(st, { x: 150, y: 180 }, { x: 250, y: 180 }, VIEW);
  assert.ok(close(next.z, 1.5));
  const s = toScreen(VIEW, next, st.w);
  assert.ok(close(s.x, 200) && close(s.y, 180), 'the world point follows the midpoint');
});

test('pinch: the zoom is clamped to the wheel limits', () => {
  const st = pinchStart({ x: 0, y: 0 }, { x: 10, y: 0 }, VIEW, { x: 0, y: 0, z: 1 });
  assert.equal(pinchMove(st, { x: 0, y: 0 }, { x: 1000, y: 0 }, VIEW).z, ZOOM_MAX);
  assert.equal(pinchMove(st, { x: 0, y: 0 }, { x: 1, y: 0 }, VIEW).z, ZOOM_MIN);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(twoFinger({ x: 0, y: 0 }, { x: 0, y: 0 }).dist, 1, 'never divides by zero');
});

test('fitCircle frames a subtree and keeps the right inset clear', () => {
  const c = boundingCircle([{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 200, y: 100 }]);
  assert.deepEqual([c.x, c.y], [200, 50]);
  assert.ok(close(c.r, Math.hypot(100, 50)));
  assert.equal(boundingCircle([]), null);
  const cam = fitCircle(c, VIEW, { pad: 0 });
  // The circle's diameter fills the short side.
  assert.ok(close(2 * c.r * VIEW.fitScale * cam.z, VIEW.H) || cam.z === 2.6 || cam.z === ZOOM_MAX);
  const s = toScreen(VIEW, cam, c);
  assert.ok(close(s.x, VIEW.W / 2) && close(s.y, VIEW.H / 2));
  const withInset = fitCircle(c, VIEW, { pad: 0, right: 400 });
  const s2 = toScreen(VIEW, withInset, c);
  assert.ok(close(s2.x, (VIEW.W - 400) / 2), 'centred in what the inspector leaves');
  assert.ok(fitCircle({ x: 0, y: 0, r: 1 }, VIEW).z <= 2.6, 'never dives in on a single node');
});

// --- selection order ---------------------------------------------------------

const lanes = [
  { id: 'lane:builder-a/calm', kind: 'lane', builder: 'builder-a', label: 'calm', status: 'ok' },
  { id: 'lane:builder-a/hot', kind: 'lane', builder: 'builder-a', label: 'hot', status: 'crit' },
  { id: 'lane:builder-b/wait', kind: 'lane', builder: 'builder-b', label: 'wait', status: 'attention' },
  { id: 'lane:builder-b/apr', kind: 'lane', builder: 'builder-b', label: 'apr', status: 'working', flags: { awaitingApproval: true } },
  { id: 'builder:builder-a', kind: 'builder', status: 'down' },
];

test('laneOrder: lanes only, worst first, approvals before plain work; scope filters', () => {
  assert.deepEqual(laneOrder(lanes), ['lane:builder-a/hot', 'lane:builder-b/wait', 'lane:builder-b/apr', 'lane:builder-a/calm']);
  assert.deepEqual(laneOrder(lanes, { scope: 'builder-b' }), ['lane:builder-b/wait', 'lane:builder-b/apr']);
  assert.deepEqual(laneOrder(null), []);
});

test('nextInOrder wraps both ways and starts at the ends', () => {
  const o = ['a', 'b', 'c'];
  assert.equal(nextInOrder(o, 'a', 1), 'b');
  assert.equal(nextInOrder(o, 'c', 1), 'a');
  assert.equal(nextInOrder(o, 'a', -1), 'c');
  assert.equal(nextInOrder(o, null, 1), 'a');
  assert.equal(nextInOrder(o, 'zz', -1), 'c');
  assert.equal(nextInOrder([], 'a'), null);
});

// --- fakes ------------------------------------------------------------------

/** An event target with the listener bookkeeping the tests look at. */
function target(obj = {}) {
  const ls = new Map();
  obj.listeners = ls;
  obj.addEventListener = (type, fn) => { if (!ls.has(type)) ls.set(type, new Set()); ls.get(type).add(fn); };
  obj.removeEventListener = (type, fn) => { ls.get(type)?.delete(fn); };
  obj.dispatch = (type, ev = {}) => { for (const fn of [...(ls.get(type) ?? [])]) fn({ type, preventDefault() {}, ...ev }); };
  obj.count = (type) => ls.get(type)?.size ?? 0;
  return obj;
}

/** A 2D context that accepts every call and property. */
function fakeCtx() {
  const calls = { draw: 0, text: [] };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'clearRect') return () => { calls.draw++; };
      if (k === 'fillText') return (s) => { calls.text.push(String(s)); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

function el(tag, W, H) {
  const e = target({
    tagName: tag.toUpperCase(),
    children: [],
    className: '',
    hidden: false,
    textContent: '',
    style: {},
    dataset: {},
    attrs: {},
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 30,
    value: '',
  });
  e.classList = {
    add: (...c) => { const s = new Set(e.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); e.className = [...s].join(' '); },
    remove: (...c) => { e.className = e.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c) => e.className.split(' ').includes(c),
  };
  e.append = (...k) => { for (const c of k) e.children.push(c); };
  e.replaceChildren = (...k) => { e.children = [...k]; };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: W ?? 0, height: H ?? 0, right: W ?? 0, bottom: H ?? 0 });
  e.focus = () => { e.focused = true; };
  e.blur = () => { e.focused = false; };
  e.select = () => {};
  e.setPointerCapture = () => {};
  if (tag === 'canvas') {
    e.ctx = fakeCtx();
    e.getContext = () => e.ctx;
    e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
  }
  return e;
}

/** Every element under `e`, depth first. */
function all(e, out = []) {
  for (const c of e.children ?? []) { out.push(c); all(c, out); }
  return out;
}
const byClass = (root, cls) => all(root).find((x) => x.className?.split(' ').includes(cls));

function installDom({ reduced = true } = {}) {
  const storage = new Map();
  const win = target({});
  const doc = target({
    visibilityState: 'visible',
    documentElement: el('html'),
    createElement: (tag) => el(tag),
    createTextNode: (text) => ({ textContent: String(text), nodeType: 3 }),
  });
  const frames = [];
  let paletteReads = 0;
  const saved = {};
  const g = {
    document: doc,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? reduced : false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => { paletteReads++; return { getPropertyValue: () => '' }; },
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => {},
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
    devicePixelRatio: 1,
    ResizeObserver: undefined,
    MutationObserver: undefined,
  };
  for (const k of Object.keys(g)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  for (const [k, v] of Object.entries(g)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  // Frame times share performance.now()'s timebase, as rAF timestamps do in a browser.
  let t = performance.now();
  return {
    storage, win, doc, frames,
    get paletteReads() { return paletteReads; },
    /** Run queued animation frames (each may queue the next). */
    flush(n = 40) {
      for (let i = 0; i < n && frames.length; i++) {
        const cb = frames.shift();
        t += 16;
        cb(t);
      }
    },
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
      }
    },
  };
}

/** A fleet of two builders, each with lanes; builder-a has a two-session lane. */
function fleetModel() {
  return {
    title: 'acme',
    nodes: [
      { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
      { id: '__fleet', kind: 'site', parent: '__core', label: 'fleet', status: 'ok' },
      { id: 'builder:builder-a', kind: 'builder', parent: '__fleet', builder: 'builder-a', code: 'BA', label: 'builder-a', status: 'ok' },
      { id: 'builder:builder-b', kind: 'builder', parent: '__fleet', builder: 'builder-b', code: 'BB', label: 'builder-b', status: 'ok' },
      { id: 'lane:builder-a/web', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', fkey: 'builder-a/web', label: 'web', status: 'working' },
      { id: 'sess:builder-a/web-1', kind: 'session', parent: 'lane:builder-a/web', builder: 'builder-a', fkey: 'builder-a/web-1', label: 'web-1', status: 'working' },
      { id: 'sess:builder-a/web-2', kind: 'session', parent: 'lane:builder-a/web', builder: 'builder-a', fkey: 'builder-a/web-2', label: 'web-2', status: 'idle' },
      { id: 'lane:builder-a/api', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', fkey: 'builder-a/api', label: 'api', status: 'crit' },
      { id: 'lane:builder-b/docs', kind: 'lane', parent: 'builder:builder-b', builder: 'builder-b', fkey: 'builder-b/docs', label: 'docs', status: 'attention' },
      { id: 'lane:builder-b/ops', kind: 'lane', parent: 'builder:builder-b', builder: 'builder-b', fkey: 'builder-b/ops', label: 'ops', status: 'ok' },
    ],
    links: [{ id: 't1', from: 'lane:builder-a/web', to: 'lane:builder-b/docs', kind: 'touch' }],
    events: [],
  };
}

async function mount(opts = {}, domOpts = {}) {
  const dom = installDom(domOpts);
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, opts);
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  return { dom, root, map, canvas };
}

// --- createMap -------------------------------------------------------------------

test('createMap builds the readout and no HUD panels (needs, ticker, legend, summary)', async (t) => {
  const { dom, root, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  for (const gone of ['map-needs', 'map-ticker', 'map-legend', 'map-summary', 'map-needs-list']) {
    assert.equal(byClass(root, gone), undefined, `${gone} is gone`);
  }
  assert.ok(byClass(root, 'map-readout'), 'the readout corner exists');
  assert.ok(byClass(root, 'map-find-input'));
  map.update(fleetModel());
  dom.flush();
  const text = byClass(root, 'map-readout').textContent;
  assert.match(text, /^Z 1\.00×  SCOPE ALL  N \d+\/10  OVL STATUS  \d\d:\d\d:\d\dZ$/);
});

test('the map registers no keydown handler of its own (the shell owns keys, §4 D8)', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  assert.equal(dom.win.count('keydown'), 0);
  assert.equal(dom.doc.count('keydown'), 0);
  for (const k of ['focusFind', 'fit', 'selectNext', 'setOverlay', 'toggleFold', 'setInsets', 'setScope', 'setMode', 'highlight', 'onSelect', 'onHover', 'snapshotScene']) {
    assert.equal(typeof map[k], 'function', `api.${k}`);
  }
});

test('setScope ghosts other builders to 0.25 but not the path to the core; all clears it', async (t) => {
  const { dom, root, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  map.setScope('builder-b');
  dom.flush();
  assert.equal(map.scope(), 'builder-b');
  assert.equal(map.emphasis('lane:builder-a/api'), SCOPE_GHOST);
  assert.equal(map.emphasis('builder:builder-a'), SCOPE_GHOST);
  assert.equal(map.emphasis('lane:builder-b/docs'), 1);
  assert.equal(map.emphasis('builder:builder-b'), 1);
  assert.equal(map.emphasis('__fleet'), 1, 'the path to the core stays lit');
  assert.match(byClass(root, 'map-readout').textContent, /SCOPE BB/, 'the readout names the builder by its code');
  map.setScope('all');
  dom.flush();
  assert.equal(map.emphasis('lane:builder-a/api'), 1);
});

test('setScope flies to the builder subtree; a scope set before the model flies on arrival', async (t) => {
  const { dom, root, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.setScope('builder-a');
  map.update(fleetModel());
  dom.flush();
  const p = map.screenOf('builder:builder-a');
  const q = map.screenOf('lane:builder-a/api');
  assert.ok(p && q);
  // The subtree is roughly centred and fills more of the view than the fit did.
  assert.ok(Math.abs((p.x + q.x) / 2 - 600) < 400 && Math.abs((p.y + q.y) / 2 - 400) < 300);
  const z = Number(/Z (\d+\.\d+)/.exec(byClass(root, 'map-readout').textContent)[1]);
  assert.ok(z > 1, `zoomed in on the builder (z ${z})`);
});

test('scoping to a builder unfolds its lanes\' sessions; others stay auto-folded', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  assert.equal(map.screenOf('sess:builder-a/web-1'), null, 'sessions are folded into their lane at first');
  map.setScope('builder-a');
  dom.flush();
  assert.ok(map.screenOf('sess:builder-a/web-1'), 'scope opens them');
});

test('overlays: setOverlay persists, invalid names fall back to status, the readout shows it', async (t) => {
  const { dom, root, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  const v0 = map.snapshotScene().version;
  assert.equal(map.setOverlay('ci'), 'ci');
  assert.equal(dom.storage.get(OVERLAY_KEY), 'ci');
  assert.ok(map.snapshotScene().version > v0, 'the minimap sees a new version');
  dom.flush();
  assert.match(byClass(root, 'map-readout').textContent, /OVL CI/);
  assert.equal(map.setOverlay('nope'), 'status');
  assert.equal(map.overlay(), 'status');
});

test('reach: refused and skipped without reach links, shown with them; a stored reach waits for them', async (t) => {
  const dom = installDom();
  dom.storage.set(OVERLAY_KEY, 'reach');
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, {});
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  assert.equal(map.overlay(), 'status', 'no reach links: the stored reach shows as status');
  assert.ok(!map.overlays().includes('reach'));
  assert.equal(map.setOverlay('drift'), 'drift');
  assert.equal(map.setOverlay(nextOverlay(map.overlay(), 1, map.overlays())), 'status', 'o skips reach');
  assert.equal(map.setOverlay('reach'), 'status', 'refused');
  const withReach = fleetModel();
  withReach.reach = { links: [
    { id: 'reach:builder:builder-a>builder:builder-b', kind: 'reach', from: 'builder:builder-a', to: 'builder:builder-b', label: 'tcp:22' },
  ] };
  map.update(withReach);
  assert.ok(map.overlays().includes('reach'));
  map.setOverlay('drift');
  assert.equal(map.setOverlay(nextOverlay(map.overlay(), 1, map.overlays())), 'reach');
  map.select('builder:builder-a');
  dom.flush();
  assert.match(byClass(root, 'map-readout').textContent, /OVL REACH {2}LINKS 1 {2}TOUCHES 1/);
  assert.equal(map.snapshotScene().overlay, 'reach');
});

test('the stored overlay is read back on mount', async (t) => {
  const dom = installDom();
  dom.storage.set(OVERLAY_KEY, 'cost');
  const { createMap } = await import('../public/js/views/map/index.js');
  const map = createMap(el('div', 1200, 800), {});
  t.after(() => { map.destroy(); dom.restore(); });
  assert.equal(map.overlay(), 'cost');
});

test('select() from the router takes a fleet key, does not echo, and is deferred until the model has it', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  const got = [];
  map.onSelect((sel, node, info) => got.push([sel, node?.id, info?.via]));
  map.select('builder-b/docs', { fly: true });
  assert.equal(map.selected(), null, 'nothing to select yet');
  map.update(fleetModel());
  dom.flush();
  assert.equal(map.selected(), 'builder-b/docs');
  assert.deepEqual(got, [], 'a router selection is not sent back to the router');
  map.select('hv');
  assert.equal(map.selected(), null, 'an unknown id clears the selection');
  map.select('builder:builder-a');
  assert.equal(map.selected(), 'builder:builder-a', 'raw node ids work too');
});

test('a tap on a node emits sel= for the router; a tap on nothing clears it', async (t) => {
  const { dom, map, canvas } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  const got = [];
  map.onSelect((sel, node, info) => got.push([sel, node?.id ?? null, info.via]));
  const p = map.screenOf('lane:builder-b/docs');
  const ev = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ...extra });
  canvas.dispatch('pointerdown', ev(p.x, p.y));
  canvas.dispatch('pointerup', ev(p.x, p.y));
  assert.deepEqual(got.at(-1), ['builder-b/docs', 'lane:builder-b/docs', 'tap']);
  canvas.dispatch('pointerdown', ev(5, 5));
  canvas.dispatch('pointerup', ev(5, 5));
  assert.deepEqual(got.at(-1), [null, null, 'tap']);
});

test('hover reports the node under the pointer once per change', async (t) => {
  const { dom, map, canvas } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  const got = [];
  map.onHover((sel) => got.push(sel));
  const p = map.screenOf('lane:builder-a/api');
  canvas.dispatch('pointermove', { pointerId: 1, clientX: p.x, clientY: p.y });
  canvas.dispatch('pointermove', { pointerId: 1, clientX: p.x + 1, clientY: p.y });
  canvas.dispatch('pointerleave', {});
  assert.deepEqual(got, ['builder-a/api', null]);
});

test('selectNext walks lanes in attention order and emits each step', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  const got = [];
  map.onSelect((sel) => got.push(sel));
  map.selectNext(1);
  map.selectNext(1);
  map.selectNext(-1);
  assert.deepEqual(got, ['builder-a/api', 'builder-b/docs', 'builder-a/api']);
  map.setScope('builder-b');
  map.selectNext(1);
  assert.equal(map.selected(), 'builder-b/docs', 'under a scope only its lanes are walked');
});

test('selecting a session opens its auto-folded lane', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  map.select('builder-a/web-2');
  dom.flush();
  assert.equal(map.selected(), 'builder-a/web-2');
  assert.ok(map.screenOf('sess:builder-a/web-2'));
});

test('toggleFold folds by hand, persists, and opens an automatic fold', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  map.toggleFold('builder:builder-b');
  dom.flush();
  assert.deepEqual(JSON.parse(dom.storage.get(FOLD_KEY)), ['builder:builder-b']);
  assert.equal(map.screenOf('lane:builder-b/docs'), null);
  map.toggleFold('builder:builder-b');
  dom.flush();
  assert.ok(map.screenOf('lane:builder-b/docs'));
  map.toggleFold('lane:builder-a/web');
  dom.flush();
  assert.ok(map.screenOf('sess:builder-a/web-1'), 'c on an auto-folded lane shows its sessions');
});

test('stored folds migrate lane:<x> to lane:<localId>/<x> (F8b) on mount', async (t) => {
  const dom = installDom();
  dom.storage.set(FOLD_KEY, JSON.stringify(['lane:web', 'host:box']));
  const { createMap } = await import('../public/js/views/map/index.js');
  const map = createMap(el('div', 1200, 800), { localId: 'builder-a' });
  t.after(() => { map.destroy(); dom.restore(); });
  assert.deepEqual(JSON.parse(dom.storage.get(FOLD_KEY)), ['lane:builder-a/web', 'host:box']);
  const shim = await import('../public/js/views/map-canvas.js');
  assert.equal(typeof shim.createMap, 'function', 'the shim re-exports createMap');
  assert.equal(typeof shim.migrateFolds, 'function');
});

test('setInsets keeps a fitted map centred in what the inspector leaves', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  assert.ok(Math.abs(map.screenOf('__core').x - 600) < 1e-6);
  map.setInsets({ right: 400 });
  dom.flush();
  assert.ok(Math.abs(map.screenOf('__core').x - 400) < 1e-6);
});

test('focusFind focuses the find input; highlight lights a node from outside', async (t) => {
  const { dom, root, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  map.focusFind();
  assert.equal(byClass(root, 'map-find-input').focused, true);
  map.highlight('builder-b/ops');
  dom.flush();
  assert.equal(map.emphasis('lane:builder-b/ops'), 1);
  assert.ok(map.emphasis('lane:builder-a/api') < 0.5, 'others dim while a row is hovered');
  map.highlight(null);
  dom.flush();
  assert.equal(map.emphasis('lane:builder-a/api'), 1);
});

test('snapshotScene packs [x, y, shape, tone] per drawn node', async (t) => {
  const { dom, map } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  const s = map.snapshotScene();
  assert.ok(s.pts instanceof Float32Array);
  assert.equal(s.pts.length, s.count * 4);
  assert.equal(s.count, 8, 'two sessions are folded away');
  // The crit lane is a crit square somewhere in the list.
  let found = false;
  for (let i = 0; i < s.count; i++) if (s.pts[i * 4 + 2] === 1 && s.pts[i * 4 + 3] === 1) found = true;
  assert.ok(found);
});

test('lb:theme re-reads the palette; destroy removes every listener', async (t) => {
  const { dom, map, canvas } = await mount();
  t.after(() => dom.restore());
  const before = dom.paletteReads;
  dom.win.dispatch('lb:theme');
  assert.equal(dom.paletteReads, before + 1);
  map.destroy();
  assert.equal(dom.win.count('lb:theme'), 0);
  assert.equal(dom.doc.count('visibilitychange'), 0);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick']) assert.equal(canvas.count(type), 0, type);
});

test('builder-provided text reaches the DOM only as textContent', async (t) => {
  const { dom, root, map, canvas } = await mount();
  t.after(() => { map.destroy(); dom.restore(); });
  const m = fleetModel();
  m.nodes[7].label = '<img src=x onerror=alert(1)>';
  m.nodes[7].href = 'javascript:alert(1)';
  m.error = '<b>bad</b>';
  map.update(m);
  dom.flush();
  map.select('builder-a/api');
  const panel = byClass(root, 'map-panel');
  assert.ok(all(panel).some((x) => x.textContent === '<img src=x onerror=alert(1)>'));
  assert.equal(all(panel).some((x) => x.className === 'map-open'), false, 'a javascript: href is not linked');
  assert.equal(byClass(root, 'map-problem').textContent, '<b>bad</b>');
  assert.ok(canvas.ctx.calls.text.length > 0);
});

test('full motion: the first bloom, a scope flight and a zoom past 1.8 all settle', async (t) => {
  const { dom, root, map } = await mount({}, { reduced: false });
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush(400);
  const core = map.screenOf('__core');
  assert.ok(Math.abs(core.x - 600) < 0.5 && Math.abs(core.y - 400) < 0.5, 'the bloom ends fitted');
  map.setScope('builder-b');
  dom.flush(400);
  assert.ok(Math.abs(map.emphasis('lane:builder-a/api') - SCOPE_GHOST) < 0.01);
  const z = Number(/Z (\d+\.\d+)/.exec(byClass(root, 'map-readout').textContent)[1]);
  assert.ok(z > 1);
  // Zoom in by wheel past the auto-unfold threshold: sessions grow out of their lane.
  map.setScope('all');
  dom.flush(400);
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  for (let i = 0; i < 6; i++) canvas.dispatch('wheel', { clientX: 600, clientY: 400, deltaY: -100, deltaMode: 0 });
  dom.flush(400);
  assert.ok(Number(/Z (\d+\.\d+)/.exec(byClass(root, 'map-readout').textContent)[1]) >= 1.8);
  assert.ok(map.screenOf('sess:builder-a/web-1'), 'sessions shown when zoomed in');
});

test('with an inspector anchor the map shows no panel of its own', async (t) => {
  const { dom, root, map } = await mount({ anchorEl: () => null });
  t.after(() => { map.destroy(); dom.restore(); });
  assert.equal(byClass(root, 'map-panel'), undefined);
});

// --- gestures on a fake canvas -----------------------------------------------

function gestureHost(over = {}) {
  const log = [];
  const host = {
    cam: { x: 0, y: 0, z: 1 },
    view: () => VIEW,
    now: () => 0,
    grab: () => log.push(['grab']),
    moved: () => log.push(['moved']),
    kick: () => {},
    hit: (x) => (x < 50 ? 'lane:builder-a/web' : null),
    badgeAt: () => null,
    reduced: () => false,
    tap: (id, type) => log.push(['tap', id, type]),
    fold: (id) => log.push(['fold', id]),
    dbl: (id) => log.push(['dbl', id]),
    longPress: (id) => log.push(['long', id]),
    hover: (id) => log.push(['hover', id]),
    leave: () => log.push(['leave']),
    glide: (v) => log.push(['glide', v]),
    wheel: (x, y, k) => log.push(['wheel', x, y, k]),
    ...over,
  };
  const canvas = el('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  const unbind = bindPointer(canvas, host);
  return { host, canvas, log, unbind };
}
const pe = (id, x, y, type = 'touch') => ({ pointerId: id, pointerType: type, clientX: x, clientY: y });

test('gesture: a press that does not move is a tap; a drag pans and does not tap', () => {
  const { canvas, log, host } = gestureHost();
  canvas.dispatch('pointerdown', pe(1, 10, 10, 'mouse'));
  canvas.dispatch('pointerup', pe(1, 11, 10, 'mouse'));
  assert.deepEqual(log.filter((l) => l[0] === 'tap'), [['tap', 'lane:builder-a/web', 'mouse']]);
  log.length = 0;
  canvas.dispatch('pointerdown', pe(1, 100, 100, 'mouse'));
  canvas.dispatch('pointermove', pe(1, 150, 100, 'mouse'));
  canvas.dispatch('pointerup', pe(1, 150, 100, 'mouse'));
  assert.equal(log.some((l) => l[0] === 'tap'), false);
  assert.ok(close(host.cam.x, -50 / (VIEW.fitScale * 1)), 'the camera moved by the drag');
});

test('gesture: two pointers pinch-zoom about their midpoint, and lifting one never taps', () => {
  const { canvas, log, host } = gestureHost();
  canvas.dispatch('pointerdown', pe(1, 400, 300));
  canvas.dispatch('pointerdown', pe(2, 600, 300));
  canvas.dispatch('pointermove', pe(1, 300, 300));
  canvas.dispatch('pointermove', pe(2, 700, 300));
  assert.ok(close(host.cam.z, 2));
  const s = toScreen(VIEW, host.cam, { x: 0, y: 0 });
  assert.ok(close(s.x, 500) && close(s.y, 300));
  canvas.dispatch('pointerup', pe(2, 700, 300));
  canvas.dispatch('pointerup', pe(1, 300, 300));
  assert.equal(log.some((l) => l[0] === 'tap'), false);
});

test('gesture: a 500 ms hold on a node is a long press (and no tap follows)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { canvas, log } = gestureHost();
  canvas.dispatch('pointerdown', pe(1, 10, 10));
  t.mock.timers.tick(LONG_PRESS_MS - 1);
  assert.equal(log.some((l) => l[0] === 'long'), false);
  t.mock.timers.tick(1);
  assert.deepEqual(log.filter((l) => l[0] === 'long'), [['long', 'lane:builder-a/web']]);
  canvas.dispatch('pointerup', pe(1, 10, 10));
  assert.equal(log.some((l) => l[0] === 'tap'), false);
});

test('gesture: a hold that moves is a drag, not a long press; a mouse never long-presses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { canvas, log } = gestureHost();
  canvas.dispatch('pointerdown', pe(1, 10, 10));
  canvas.dispatch('pointermove', pe(1, 40, 10));
  t.mock.timers.tick(LONG_PRESS_MS);
  assert.equal(log.some((l) => l[0] === 'long'), false);
  canvas.dispatch('pointerup', pe(1, 40, 10));
  canvas.dispatch('pointerdown', pe(2, 10, 10, 'mouse'));
  t.mock.timers.tick(LONG_PRESS_MS * 2);
  assert.equal(log.some((l) => l[0] === 'long'), false);
});

test('gesture: a fold badge under a tap folds instead of selecting; wheel and dblclick reach the host', () => {
  const { canvas, log, unbind } = gestureHost({ badgeAt: () => 'room:r' });
  canvas.dispatch('pointerdown', pe(1, 10, 10, 'mouse'));
  canvas.dispatch('pointerup', pe(1, 10, 10, 'mouse'));
  assert.deepEqual(log.filter((l) => l[0] === 'fold' || l[0] === 'tap'), [['fold', 'room:r']]);
  canvas.dispatch('wheel', { clientX: 5, clientY: 6, deltaY: 100, deltaMode: 0 });
  canvas.dispatch('dblclick', { clientX: 10, clientY: 10 });
  assert.deepEqual(log.find((l) => l[0] === 'wheel').slice(0, 3), ['wheel', 5, 6]);
  assert.ok(log.find((l) => l[0] === 'wheel')[3] < 0, 'scrolling down zooms out');
  assert.deepEqual(log.find((l) => l[0] === 'dbl'), ['dbl', 'lane:builder-a/web']);
  unbind();
  assert.equal(canvas.count('pointerdown'), 0);
});

test('a builder-mode map (GET /api/map with no config) renders: core, fleet, one builder', async (t) => {
  const { dom, root, map, canvas } = await mount({ localId: 'builder-a' });
  t.after(() => { map.destroy(); dom.restore(); });
  map.update({
    title: 'builder-a',
    fleet: { builders: [{ id: 'builder-a', code: 'BA', link: 'up' }] },
    nodes: [
      { id: '__core', kind: 'core', label: 'builder-a', status: 'ok' },
      { id: '__fleet', kind: 'site', parent: '__core', label: 'FLEET', status: 'ok' },
      { id: 'builder:builder-a', parent: '__fleet', kind: 'builder', builder: 'builder-a', label: 'BA', status: 'ok',
        metrics: { cpu: 0.5, mem: 0.1 }, counts: { lanes: 0, working: 0, waiting: 0 } },
    ],
    links: [],
    events: [],
  });
  dom.flush();
  assert.equal(byClass(root, 'map-title').textContent, 'builder-a');
  assert.ok(canvas.ctx.calls.draw > 0, 'a frame was drawn');
  assert.ok(canvas.ctx.calls.text.includes('BA'), 'the builder code is drawn');
  assert.match(byClass(root, 'map-readout').textContent, /N 3\/3/, 'all three nodes are drawn');
});

test('perf mode (?mapperf=1) appends the p95 draw time to the readout', async (t) => {
  const { dom, root, map } = await mount({ perf: true });
  t.after(() => { map.destroy(); dom.restore(); });
  map.update(fleetModel());
  dom.flush();
  assert.match(byClass(root, 'map-readout').textContent, /P95 \d+\.\dMS$/);
});
