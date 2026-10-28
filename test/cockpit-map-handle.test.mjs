// The cockpit's handle on the app's Map (cockpit spec screens.md §9.2, D221, D222; T16b):
// createMap's additions M1 flyTo (a Promise), M3 camera(), M6 nodeAt in canvas px, and
// public/js/cockpit/app-view.js, which turns them into page px and swaps `map` with the view.
// The Map's own tests (test/map-*.test.mjs) stay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { mapHandle, installAppView, setAppMap } from '../public/js/cockpit/app-view.js';

function model() {
  return {
    title: 'acme',
    nodes: [
      { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
      { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
      { id: 'builder:builder-a', kind: 'builder', parent: 'hv1', label: 'builder-a', status: 'ok' },
      { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'ok' },
    ],
    links: [],
    events: [],
  };
}

const WHERE = { __core: { x: 0, y: 0 }, hv1: { x: -300, y: 0 }, 'builder:builder-a': { x: -300, y: 150 }, hv2: { x: 300, y: 0 } };
function gridLayout(nodes) {
  const center = nodes.find((n) => n.kind === 'core');
  const kids = new Map();
  for (const n of nodes) {
    if (n === center || !n.parent) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  return { pos: new Map(nodes.map((n) => [n.id, { ...WHERE[n.id] }])), center, kids };
}

/** A mounted Map on the fake DOM (1200x800 canvas), drawn; `fn(map, dom)`, then torn down. */
async function withMap(fn, { reduced = false } = {}) {
  // The Map's flights start at performance.now() and run on frame times: one clock for both,
  // the time of the frame being drawn (the fake frames run faster than the wall clock).
  const realNow = performance.now;
  let at = realNow.call(performance);
  performance.now = () => at;
  const dom = installDom({ reduced });
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => raf((t) => { at = t; cb(t); });
  try {
    const { createMap } = await import('../public/js/views/map/index.js');
    const root = el('div', 1200, 800);
    const map = createMap(root, { layout: gridLayout });
    map.update(model());
    dom.flush(80);
    try {
      await fn(map, dom, root);
    } finally {
      map.destroy();
    }
  } finally {
    dom.restore();
    performance.now = realNow;
  }
}

const settle = (p) => p.then((v) => v, () => 'rejected');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (± ${tol})`);

test('M1 flyTo: a Promise of true when the flight lands, the node at the centre of the canvas', async () => {
  await withMap(async (map, dom) => {
    let done = null;
    const p = map.flyTo('hv2').then((v) => { done = v; });
    dom.flush(3);
    await Promise.resolve();
    assert.equal(done, null, 'still in the air after 3 frames');
    dom.flush(80);
    await p;
    assert.equal(done, true);
    const at = map.screenOf('hv2');
    near(at.x, 600, 2, 'x');
    near(at.y, 400, 2, 'y');
    assert.ok(map.camera().z >= 1.9, 'zoomed to at least 1.9');
  });
});

test('M1 flyTo: unknown id resolves false at once and the camera does not move', async () => {
  await withMap(async (map, dom) => {
    const before = map.camera();
    assert.equal(await map.flyTo('vm-x'), false);
    dom.flush(20);
    assert.deepEqual(map.camera(), before);
  });
});

test('M1 flyTo: a newer movement cuts the flight (false), the newer one lands (true)', async () => {
  await withMap(async (map, dom) => {
    const first = settle(map.flyTo('hv2'));
    dom.flush(2);
    const second = settle(map.flyTo('hv1'));
    dom.flush(80);
    assert.equal(await first, false);
    assert.equal(await second, true);
    const third = settle(map.flyTo('hv2'));
    dom.flush(2);
    map.fit();
    dom.flush(80);
    assert.equal(await third, false, 'fit() is a newer movement');
  });
});

test('M1 flyTo: a finger on the Map cuts the flight (false)', async () => {
  await withMap(async (map, dom, root) => {
    const canvas = root.children.find((c) => c.tagName === 'CANVAS');
    const p = settle(map.flyTo('hv2'));
    dom.flush(2);
    canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, button: 0 });
    dom.flush(80);
    assert.equal(await p, false);
  });
});

test('M1 flyTo: in reduced motion the camera jumps and the Promise is true at once', async () => {
  await withMap(async (map) => {
    assert.equal(await map.flyTo('hv2'), true);
    const at = map.screenOf('hv2');
    near(at.x, 600, 0.5, 'x');
  }, { reduced: true });
});

test('M3 camera(): {x, y, z, spin}, a copy', async () => {
  await withMap(async (map) => {
    const c = map.camera();
    assert.deepEqual(Object.keys(c).sort(), ['spin', 'x', 'y', 'z']);
    assert.equal(c.spin, 0);
    c.x = 9999;
    assert.notEqual(map.camera().x, 9999);
  });
});

test('M6 nodeAt: the node under a canvas point, null on empty sky and off the canvas', async () => {
  await withMap(async (map) => {
    const at = map.screenOf('hv1');
    assert.equal(map.nodeAt(at.x, at.y), 'hv1');
    assert.equal(map.nodeAt(at.x + 2, at.y - 2), 'hv1');
    assert.equal(map.nodeAt(5, 5), null);
    assert.equal(map.nodeAt(-1, at.y), null);
    assert.equal(map.nodeAt(1201, at.y), null);
    assert.equal(map.nodeAt(NaN, 3), null);
  });
});

// --- app-view.js over a fake createMap API -------------------------------------

function fakeApi() {
  const calls = [];
  const drawn = { 'builder:builder-a': { x: 100, y: 50 }, lab: { x: 10, y: 20 } };
  return {
    calls,
    screenOf: (id) => drawn[id] ?? null,
    flyTo: (id, z) => { calls.push(['flyTo', id, z]); return Promise.resolve(Boolean(drawn[id])); },
    camera: () => ({ x: 1, y: 2, z: 3, spin: 0 }),
    nodeAt: (x, y) => { calls.push(['nodeAt', x, y]); return x === 100 && y === 50 ? 'builder:builder-a' : x === 10 && y === 20 ? 'lab' : null; },
    onDraw: (cb) => { calls.push(['onDraw']); return () => cb; },
    emphasis: (id) => (id === 'lab' ? 0.5 : 1),
  };
}

test('mapHandle: page px = canvas px + the canvas client left and top (D222)', async () => {
  const api = fakeApi();
  const h = mapHandle(api, () => ({ getBoundingClientRect: () => ({ left: 56, top: 36 }) }));
  assert.deepEqual(h.screenOf('lab'), { x: 66, y: 56 });
  assert.equal(h.screenOf('nope'), null);
  assert.equal(h.nodeAt(66, 56), 'lab');
  assert.deepEqual(api.calls.at(-1), ['nodeAt', 10, 20]);
  assert.deepEqual(h.camera(), { x: 1, y: 2, z: 3, spin: 0 });
  assert.equal(h.emphasis('lab'), 0.5);
  assert.equal(typeof h.onDraw(() => {}), 'function');
});

test('mapHandle: a builder is named by its id; nodeAt answers it the same way (B127)', async () => {
  const api = fakeApi();
  const h = mapHandle(api, () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }));
  assert.deepEqual(h.screenOf('builder-a'), { x: 100, y: 50 });
  assert.deepEqual(h.screenOf('builder:builder-a'), { x: 100, y: 50 });
  assert.equal(h.nodeAt(100, 50), 'builder-a');
  assert.equal(h.nodeAt(1, 1), null);
  assert.equal(await h.flyTo('builder-a'), true);
  assert.deepEqual(api.calls.find((c) => c[0] === 'flyTo'), ['flyTo', 'builder:builder-a', undefined]);
  assert.equal(await h.flyTo('vm-x'), false);
});

test('installAppView / setAppMap: {page: app, wall: null, map}, a new map object per mount, null off the Map', () => {
  const saved = globalThis.__cockpitView;
  try {
    delete globalThis.__cockpitView;
    installAppView();
    assert.deepEqual(globalThis.__cockpitView, { page: 'app', wall: null, map: null });
    const api = fakeApi();
    setAppMap(api, null);
    const a = globalThis.__cockpitView.map;
    assert.deepEqual(Object.keys(a).sort(), ['camera', 'emphasis', 'flyTo', 'nodeAt', 'onDraw', 'screenOf']);
    setAppMap(null);
    assert.equal(globalThis.__cockpitView.map, null);
    setAppMap(api, null);
    const b = globalThis.__cockpitView.map;
    assert.notEqual(a, b, 'a new object');
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), 'with the same functions');
    // A page whose handle is the Wall's keeps it.
    globalThis.__cockpitView = { page: 'wall', wall: {}, map: 'wall-map' };
    setAppMap(api, null);
    assert.equal(globalThis.__cockpitView.map, 'wall-map');
  } finally {
    if (saved === undefined) delete globalThis.__cockpitView; else globalThis.__cockpitView = saved;
    setAppMap(null);
  }
});
