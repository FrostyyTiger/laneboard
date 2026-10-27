// The galaxy's frame budget (Wall plan night 2 T10, README §7.A6): windows
// that miss the budget step the quality down, roomy ones step it back up
// (more slowly after a step that did not hold); the scene swaps its spheres
// and thins its dust without making anything twice; and a relayout disposes
// what it replaces, so the renderer's geometry count stays flat for hours.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  BUDGET, LEVELS, budgetStart, budgetStep, createFrameWindow, perfLine, pixelRatioFor, ratioPin,
} from '../public/js/wall/galaxy/budget.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, DUST_LOOK } from '../public/js/wall/galaxy/scene.js';
import { LIVE } from '../public/js/wall/galaxy/live.js';

const slow = { frameMs: 40, scriptMs: 12 };
const smooth = { frameMs: 16.7, scriptMs: 2 };
const run = (state, sample, n) => {
  let s = state;
  for (let i = 0; i < n; i++) s = budgetStep(s, sample);
  return s;
};

test('missed windows step the level down, one step per run of misses, never past the last', () => {
  let s = budgetStart();
  s = run(s, slow, BUDGET.downAfter - 1);
  assert.equal(s.level, 0, 'a short stall changes nothing');
  s = budgetStep(s, slow);
  assert.equal(s.level, 1);
  s = run(s, slow, BUDGET.downAfter);
  assert.equal(s.level, 2);
  s = run(s, slow, BUDGET.downAfter * 4);
  assert.equal(s.level, LEVELS.length - 1);
  // A miss between them starts the count again.
  let t = run(budgetStart(), slow, BUDGET.downAfter - 1);
  t = budgetStep(t, smooth);
  t = run(t, slow, BUDGET.downAfter - 1);
  assert.equal(t.level, 0);
});

test('roomy windows step back up; a step up that does not hold doubles the wait', () => {
  let s = run(budgetStart(), slow, BUDGET.downAfter * 2);
  assert.equal(s.level, 2);
  s = run(s, smooth, BUDGET.upAfter - 1);
  assert.equal(s.level, 2);
  s = budgetStep(s, smooth);
  assert.equal(s.level, 1, 'back up after upAfter roomy windows');
  // That level misses again: down, and the next climb waits twice as long.
  s = run(s, slow, BUDGET.downAfter);
  assert.equal(s.level, 2);
  assert.equal(s.wait, BUDGET.upAfter * 2);
  s = run(s, smooth, BUDGET.upAfter);
  assert.equal(s.level, 2, 'not yet');
  s = run(s, smooth, BUDGET.upAfter);
  assert.equal(s.level, 1);
  s = run(s, smooth, s.wait);
  assert.equal(s.level, 0);
  // The wait never grows past upMax.
  let w = budgetStart();
  for (let i = 0; i < 20; i++) { w = run(w, slow, BUDGET.downAfter); w = run(w, smooth, w.wait); }
  assert.ok(w.wait <= BUDGET.upMax);
});

test('holding the frame rate with a busy script is not room to climb; nonsense is ignored', () => {
  let s = run(budgetStart(), slow, BUDGET.downAfter);
  s = run(s, { frameMs: 16.7, scriptMs: BUDGET.roomMs + 1 }, BUDGET.upAfter * 3);
  assert.equal(s.level, 1);
  assert.deepEqual(budgetStep(s, { frameMs: NaN }), s);
  assert.deepEqual(budgetStep(s, null), s);
  assert.equal(budgetStep(budgetStart(), smooth).level, 0, 'the best level stays the best');
});

test('frames close into windows of mean gap, script time and fps; a hidden page starts again', () => {
  const w = createFrameWindow(1000);
  let out = null;
  for (let t = 0; t <= 1000; t += 20) out = w.frame(t, 3) ?? out;
  assert.ok(out);
  assert.equal(Math.round(out.frameMs), 20);
  assert.equal(out.scriptMs, 3);
  assert.equal(Math.round(out.fps), 50);
  assert.equal(out.worstMs, 20);
  assert.equal(w.frame(1020, 3), null, 'a new window has begun');
  w.pause();
  assert.equal(w.frame(9000, 3), null, 'the hidden gap is not a frame');
  assert.equal(w.frame(9016, 3), null);
});

test('each window keeps its own worst gap, reset with the window (night 4 T11)', () => {
  const w = createFrameWindow(1000);
  const closed = [];
  w.frame(0);
  w.frame(300);
  for (let t = 316; t <= 3000; t += 16) { const out = w.frame(t); if (out) closed.push(out); }
  assert.ok(closed.length >= 2);
  assert.equal(closed[0].worstMs, 300);
  for (const out of closed.slice(1)) assert.equal(out.worstMs, 16, 'the next window forgets the hitch');
});

test('perfLine prints script ms, frame ms, fps, level, renderer counts and heap when there', () => {
  const lines = perfLine({
    w: { scriptMs: 1.234, frameMs: 16.66, fps: 60 },
    level: 1,
    info: { render: { calls: 198 }, memory: { geometries: 22, textures: 3 } },
    memory: { usedJSHeapSize: 48 * 1048576 },
  });
  assert.deepEqual(lines, [
    '1.23 ms script · 16.7 ms/frame · 60 fps · L1',
    '198 calls · 22 geo · 3 tex',
    '48 MB heap',
  ]);
  assert.equal(perfLine({}).length, 1, 'no renderer, no heap: one line');
});

// --- the scene ---------------------------------------------------------------

const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    }),
  }),
};

function sceneAt({ dpr = 1, render = () => {}, ratio = null, ratios = [], sizes = [] } = {}) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    dpr,
    ratio,
    palette: paletteFrom(),
    doc: fakeDoc,
    clock: () => clock.now,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio: (r) => ratios.push(r), setClearColor() {},
      setSize: (w, h) => sizes.push([w, h]), dispose() {}, render,
    }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

function fleet({ extra = [] } = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', status: 'ok' });
    nodes.push({ id: `${s}-lane`, parent: `${s}-b`, kind: 'lane', status: 'ok' });
  }
  return { nodes: [...nodes, ...extra] };
}

test('setQuality swaps every sphere for fewer segments, disposes the old, thins dust and stars', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  const hv1 = galaxy.world.byId.get('hv1');
  const planet = hv1.members.find((m) => m.planet);
  const dot = hv1.members.find((m) => !m.planet);
  const before = { star: hv1.star.geometry, planet: planet.mesh.geometry, dot: dot.mesh.geometry };
  const disposed = [];
  for (const g of Object.values(before)) g.addEventListener('dispose', () => disposed.push(g));
  const mesh = planet.mesh;

  assert.equal(galaxy.setQuality(0), false, 'already there');
  assert.equal(galaxy.setQuality(2), true);
  assert.equal(galaxy.quality, 2);
  assert.equal(planet.mesh, mesh, 'the same mesh, a new geometry');
  assert.notEqual(planet.mesh.geometry, before.planet);
  assert.ok(planet.mesh.geometry.parameters.widthSegments < before.planet.parameters.widthSegments);
  assert.ok(hv1.star.geometry.parameters.widthSegments < before.star.parameters.widthSegments);
  assert.ok(dot.mesh.geometry.parameters.widthSegments >= 6, 'never a paper sphere');
  assert.equal(disposed.length, 3, 'the old spheres are disposed');
  // Every other planet shares the one new sphere.
  for (const s of galaxy.world.sites) for (const m of s.members) {
    assert.equal(m.mesh.geometry, m.planet ? planet.mesh.geometry : dot.mesh.geometry);
  }
  // A member laid out after the step is made at the new level too.
  galaxy.update(fleet({ extra: [{ id: 'hv1-c', parent: 'hv1', kind: 'builder', status: 'ok' }] }));
  at(1000 + LIVE.foldMs + LIVE.reopenMs);
  const c = galaxy.world.byId.get('hv1').members.find((m) => m.id === 'hv1-c');
  assert.equal(c.mesh.geometry, planet.mesh.geometry, 'swapped in at the level it was laid out at');
  assert.equal(galaxy.setQuality(9), false, 'clamped to the last level');
  assert.equal(galaxy.setQuality(0), true);
  assert.equal(galaxy.quality, 0);
  assert.equal(c.mesh.geometry.parameters.widthSegments, before.planet.parameters.widthSegments);
});

test('the dust and far stars draw a thinner range at a lower level and all of it at the best', () => {
  const { galaxy } = sceneAt();
  galaxy.update(fleet());
  const points = [];
  // The scene's Points are the dust and the far stars.
  const seen = new Set();
  const walk = (o) => { if (o.isPoints && !seen.has(o)) { seen.add(o); points.push(o); } o.children?.forEach(walk); };
  // Reach the scene through a mesh's parent chain.
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  walk(root);
  assert.equal(points.length, 2);
  const full = points.map((p) => p.geometry.attributes.position.count);
  galaxy.setQuality(LEVELS.length - 1);
  const last = LEVELS[LEVELS.length - 1];
  for (const [i, p] of points.entries()) {
    assert.ok(p.geometry.drawRange.count < full[i]);
    assert.ok(Math.abs(p.geometry.drawRange.count - full[i] * Math.min(last.dust, last.stars)) <= full[i] * Math.abs(last.dust - last.stars) + 1);
  }
  galaxy.setQuality(0);
  for (const [i, p] of points.entries()) assert.equal(p.geometry.drawRange.count, full[i]);
});

/** Geometries made and disposed since now (three numbers geometries in the order they are made). */
function liveGeometries() {
  const start = new THREE.BufferGeometry().id;
  let disposed = 0;
  const proto = THREE.BufferGeometry.prototype;
  const original = proto.dispose;
  proto.dispose = function dispose(...args) { disposed += 1; return original.apply(this, args); };
  return {
    made: () => new THREE.BufferGeometry().id - start,
    disposed: () => disposed,
    restore: () => { proto.dispose = original; },
  };
}

test('tree changes and quality steps over and over leave the live geometry count flat', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  at(1000);
  const probe = liveGeometries();
  try {
    let t = 1000;
    const cycle = (i) => {
      const extra = i % 2 ? [{ id: `hv1-x${i}`, parent: 'hv1', kind: 'builder', status: 'ok' }] : [];
      galaxy.update(fleet({ extra }));
      for (let k = 0; k <= LIVE.foldMs + LIVE.reopenMs + 100; k += 100) at((t += 100));
      galaxy.setQuality(i % LEVELS.length);
    };
    // Settle once, then count what is alive across many more cycles.
    for (let i = 0; i < 4; i++) cycle(i);
    const alive = () => probe.made() - probe.disposed();
    const a = alive();
    for (let i = 4; i < 40; i++) cycle(i);
    // Each alive() call makes one probe geometry of its own: allow for those.
    assert.ok(alive() - a <= 2, `geometries grew by ${alive() - a}`);
  } finally {
    probe.restore();
  }
});

test('a dust grain is attenuated by distance and capped at DUST_LOOK.maxPx css px (T26)', () => {
  for (const dpr of [1, 2, 3]) {
    const { galaxy } = sceneAt({ dpr });
    galaxy.update(fleet());
    let root = galaxy.world.sites[0].star;
    while (root.parent) root = root.parent;
    const dust = root.getObjectByName('dust');
    assert.ok(dust?.isPoints);
    const m = dust.material;
    assert.equal(m.sizeAttenuation, true, 'smaller the farther');
    assert.equal(m.size, DUST_LOOK.size);
    // Compile it as three would: the points shader through onBeforeCompile.
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.points.vertexShader, fragmentShader: '' };
    m.onBeforeCompile(sh);
    const v = sh.vertexShader;
    const cap = v.indexOf('gl_PointSize = min(gl_PointSize, dustCap);');
    assert.ok(cap > v.indexOf('gl_PointSize *= ( scale / - mvPosition.z )'), 'the cap comes after the attenuation');
    assert.ok(v.includes('uniform float dustCap;'));
    // gl_PointSize is in device px: the cap follows the pixel ratio (at most 2, as the renderer).
    assert.equal(sh.uniforms.dustCap.value, DUST_LOOK.maxPx * Math.min(2, dpr));
    galaxy.dispose();
  }
  assert.ok(DUST_LOOK.maxPx <= 3, 'a speck, not a dot');
});

/** three r170's renderObject, the part that matters (three.module.js, `forceSinglePass === false`):
 * a transparent DoubleSide material is drawn back then front, each pass flagged `needsUpdate`, which
 * bumps its `version` and sends three through getParameters/getProgram again. */
function twoPassRender(scene) {
  scene.traverseVisible((o) => {
    const m = o.material;
    if (!m || Array.isArray(m)) return;
    if (m.transparent === true && m.side === THREE.DoubleSide && m.forceSinglePass === false) {
      m.side = THREE.BackSide; m.needsUpdate = true;
      m.side = THREE.FrontSide; m.needsUpdate = true;
      m.side = THREE.DoubleSide;
    }
  });
}

test('nebula lobes and system planes draw in one pass, so three never rebuilds their state per frame (T27)', () => {
  const { galaxy, at } = sceneAt({ render: twoPassRender });
  galaxy.update(fleet());
  galaxy.setOpen('hv1', 1);
  at(1016);
  const site = galaxy.world.byId.get('hv1');
  const mats = [...site.lobes.map((l) => l.mesh.material), site.plane.material];
  assert.ok(mats.length >= 3);
  const before = mats.map((m) => m.version);
  at(1033);
  at(1050);
  assert.deepEqual(mats.map((m) => m.version), before, 'no material flagged by the draw');
  // And nothing else in the scene takes the two-pass path.
  let root = site.star;
  while (root.parent) root = root.parent;
  root.traverse((o) => {
    const m = o.material;
    if (m && !Array.isArray(m) && m.transparent && m.side === THREE.DoubleSide) assert.equal(m.forceSinglePass, true, o.name || o.type);
  });
  galaxy.dispose();
});

test('each level brings a pixel ratio, best first, capped by the screen (T28)', () => {
  assert.deepEqual(LEVELS.map((L) => L.ratio), [2, 1.5, 1.25]);
  assert.equal(pixelRatioFor(0, 2), 2);
  assert.equal(pixelRatioFor(1, 2), 1.5);
  assert.equal(pixelRatioFor(2, 2), 1.25);
  assert.equal(pixelRatioFor(0, 3), 2, 'a 3x phone still draws at 2');
  assert.equal(pixelRatioFor(1, 1), 1, 'never above the screen');
  assert.equal(pixelRatioFor(9, 2), 1.25, 'levels are clamped');
  assert.equal(pixelRatioFor(0, 2, 1), 1, 'a pin wins over the level');
  assert.equal(pixelRatioFor(2, 2, 1.75), 1.75);
  assert.equal(pixelRatioFor(0, 1, 2), 1, 'a pin is capped by the screen too');
  assert.equal(ratioPin(null), null);
  assert.equal(ratioPin(''), null);
  assert.equal(ratioPin('1'), 1);
  assert.equal(ratioPin('1.5'), 1.5);
  for (const bad of ['x', '0', '-1', '9']) assert.equal(ratioPin(bad), null, bad);
  assert.equal(perfLine({ w: { scriptMs: 1, frameMs: 16.7, fps: 60 }, level: 2, ratio: 1.25 })[0],
    '1.00 ms script · 16.7 ms/frame · 60 fps · L2 ×1.25');
});

test('setQuality draws at the level\'s pixel ratio and moves nothing; ?ratio= pins it (T28)', () => {
  const ratios = [], sizes = [];
  const { galaxy, at } = sceneAt({ dpr: 2, ratios, sizes });
  galaxy.update(fleet());
  at(1000);
  assert.equal(ratios.at(-1), 2);
  assert.equal(galaxy.pixelRatio, 2);
  const pose = () => [...galaxy.camera.position.toArray(), ...galaxy.camera.quaternion.toArray(), galaxy.camera.aspect];
  const before = pose();
  const sized = sizes.length;
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  const capOf = () => {
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.points.vertexShader, fragmentShader: '' };
    root.getObjectByName('dust').material.onBeforeCompile(sh);
    return sh.uniforms.dustCap.value;
  };
  for (const [level, r] of [[1, 1.5], [2, 1.25], [0, 2]]) {
    galaxy.setQuality(level);
    assert.equal(ratios.at(-1), r, `L${level}`);
    assert.equal(galaxy.pixelRatio, r);
    assert.equal(capOf(), DUST_LOOK.maxPx * r, 'the dust cap follows the ratio');
    at(1000);
    assert.deepEqual(pose(), before, 'the same framing at every level');
  }
  assert.equal(sizes.length, sized, 'the css size is not set again');
  galaxy.dispose();

  const pinned = [];
  const p = sceneAt({ dpr: 2, ratio: 1, ratios: pinned });
  assert.equal(pinned.at(-1), 1);
  p.galaxy.setQuality(2);
  assert.equal(pinned.at(-1), 1, 'the pin holds at every level');
  p.galaxy.setQuality(0);
  assert.equal(p.galaxy.pixelRatio, 1);
  p.galaxy.dispose();

  const low = [];
  const l = sceneAt({ dpr: 1, ratios: low });
  l.galaxy.setQuality(1);
  assert.deepEqual(low, [1, 1], 'a 1x screen stays at 1');
  l.galaxy.dispose();
});

test('galaxy/main.js passes ?ratio= to the scene and reports the ratio (T28)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(src, /ratio: ratioPin\(q\.get\('ratio'\)\)/);
  assert.match(src, /ratio: galaxy\.pixelRatio/);
});
