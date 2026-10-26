// Wall night 2 T17 (reviews/r8-film-ui.md 4): a nebula is a cloud with a
// direction, not one flat radial disc: two or three offset lobes flat in the
// galaxy's plane, stretched along the arm's tangent, never past the old
// round nebula; and two crits are not twins: the newest crit peaks hottest,
// older ones a step quieter but still above any warn.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { LOBES, PEAK, armTangent, nebulaLobes, nebulaPeaks } from '../public/js/wall/galaxy/nebula.js';
import { MIN_SITE_GAP, armPoint, galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { NEBULA, paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

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

function sceneAt() {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {},
    }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

/** Five calm sites, each with a room and a builder; `bad` sets statuses by id. */
function fleet(bad = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', status: 'ok' });
  }
  for (const n of nodes) if (bad[n.id]) n.status = bad[n.id];
  return { nodes };
}

const IDS = Array.from({ length: 60 }, (_, i) => `site-${i}`);

test('a nebula is two or three lobes, the main one on the star, its visible cloud inside half the site gap', () => {
  const counts = new Set();
  for (const id of IDS) {
    const lobes = nebulaLobes(id);
    assert.deepEqual(nebulaLobes(id), lobes, 'the same on every load');
    assert.ok(lobes.length === 2 || lobes.length === 3, `${id}: ${lobes.length}`);
    counts.add(lobes.length);
    const [main, ...sides] = lobes;
    assert.equal(main.along, 0);
    assert.equal(main.across, 0);
    assert.equal(main.len, LOBES.main.len);
    assert.ok(main.wid < main.len, 'the main lobe is stretched along the arm');
    for (const l of lobes) {
      assert.ok(Math.abs(l.along) + l.len / 2 <= LOBES.reach + 1e-9, `${id} along ${JSON.stringify(l)}`);
      assert.ok(Math.abs(l.across) + l.wid / 2 <= LOBES.reach + 1e-9, `${id} across ${JSON.stringify(l)}`);
      assert.ok(l.share > 0 && l.share <= 1);
    }
    for (const l of sides) assert.ok(l.share < main.share && Math.abs(l.along) > 0.1, 'side lobes sit off the star, quieter');
    if (sides.length === 2) assert.ok(Math.sign(sides[0].along) !== Math.sign(sides[1].along), 'one before, one after');
  }
  assert.deepEqual([...counts].sort(), [2, 3], 'both shapes occur');
  assert.ok(LOBES.three > 0 && LOBES.three < 1);
  // Most of the light is inside 0.6 of a lobe: that part of two crit nebulae never meets.
  assert.ok(0.6 * LOBES.reach * NEBULA.crit.size < MIN_SITE_GAP / 2);
  // On the large demo even the faint rims stay apart.
  const homes = galaxyLayout(LARGE).sites.map((x) => x.home);
  let gap = Infinity;
  for (const p of homes) for (const q of homes) if (p !== q) gap = Math.min(gap, Math.hypot(p.x - q.x, p.z - q.z));
  assert.ok(2 * LOBES.reach * NEBULA.crit.size < gap, `rims ${2 * LOBES.reach * NEBULA.crit.size} vs gap ${gap}`);
});

test('armTangent is the spiral arm direction at a star, outward along it', () => {
  for (let i = 0; i < 10; i++) {
    const p = armPoint(i, 10);
    const t = armTangent(p);
    assert.ok(Math.abs(Math.hypot(t.x, t.z) - 1) < 1e-9);
    // armPoint's own spiral, a small step further out along the same arm.
    const arm = i % 2, k = Math.floor(i / 2) + 0.6 + 1e-4;
    const r = 650 + 520 * k, a = arm * Math.PI + k * 0.85;
    const d = { x: Math.cos(a) * r - p.x, z: Math.sin(a) * r - p.z };
    const l = Math.hypot(d.x, d.z);
    assert.ok(t.x * (d.x / l) + t.z * (d.z / l) > 0.9999, `site ${i}`);
  }
  assert.deepEqual(armTangent({ x: 0, z: 0 }), { x: 1, z: 0 });
});

test('the scene lays every site its lobes flat in the plane, stretched along the arm', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet({ 'hv2-b': 'crit' }));
  at(1000);
  for (const s of galaxy.world.sites) {
    assert.equal(s.lobes.length, nebulaLobes(s.id).length);
    assert.equal(s.nebulaSprite, s.lobes[0].mesh);
    const t = armTangent(s.home);
    for (const { shape, mesh } of s.lobes) {
      mesh.updateMatrixWorld(true);
      assert.ok(Math.abs(mesh.position.y - s.home.y) < 1e-6, 'in the system plane');
      const normal = new THREE.Vector3(0, 1, 0).transformDirection(mesh.matrixWorld);
      assert.ok(Math.abs(normal.y) > 0.9999, 'lying flat');
      const long = new THREE.Vector3(1, 0, 0).transformDirection(mesh.matrixWorld);
      // The main lobe lies on the tangent; a side lobe is turned off it by its `turn`, never across the arm.
      const c = Math.abs(long.x * t.x + long.z * t.z);
      assert.ok(Math.abs(c - Math.cos(shape.turn)) < 1e-6, `${s.id}: long axis ${c} vs turn ${shape.turn}`);
      assert.ok(c > Math.cos(LOBES.side.turn[1]) - 1e-9);
      if (shape === s.lobes[0].shape) assert.ok(c > 0.9999, `${s.id}: main lobe on the tangent`);
      assert.ok(Math.abs(Math.abs(mesh.scale.x / mesh.scale.z) - shape.len / shape.wid) < 1e-6, 'stretched as the shape says');
      // Its centre along the tangent as the shape says.
      const off = { x: mesh.position.x - s.home.x, z: mesh.position.z - s.home.z };
      assert.ok(Math.abs(off.x * t.x + off.z * t.z - shape.along * s.neb.size * (s.breath ?? 1)) < 1e-6);
    }
  }
});

test('nebulaPeaks: the newest crit is the hottest, older ones a step down to the floor, ties in order', () => {
  const p = nebulaPeaks([
    { id: 'a', tone: 'crit', since: 100 },
    { id: 'b', tone: 'warn', since: 900 },
    { id: 'c', tone: 'crit', since: 500 },
    { id: 'd', tone: 'crit', since: 50 },
    { id: 'e', tone: 'crit', since: 10 },
    { id: 'f', tone: 'calm', since: 0 },
  ]);
  assert.equal(p.get('c'), 1);
  assert.equal(p.get('a'), 1 - PEAK.step);
  assert.equal(p.get('d'), Math.max(PEAK.floor, 1 - 2 * PEAK.step));
  assert.equal(p.get('e'), PEAK.floor);
  assert.equal(p.get('b'), 1);
  assert.equal(p.get('f'), 1);
  const tie = nebulaPeaks([{ id: 'x', tone: 'crit', since: 5 }, { id: 'y', tone: 'crit', since: 5 }]);
  assert.ok(tie.get('x') > tie.get('y'), 'a tie keeps the given order');
  // The quietest crit still outshines any warn (README §2.1, severity first).
  assert.ok(NEBULA.crit.opacity * PEAK.floor > NEBULA.warn.opacity);
});

test('a site that turns crit later peaks hotter than the older crit, eased, and the older one steps down', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet({ 'hv1-b': 'crit' }));
  at(1000);
  const hv1 = galaxy.world.byId.get('hv1'), hv2 = galaxy.world.byId.get('hv2');
  assert.equal(hv1.peak, 1, 'the only crit is the hottest');
  const opacity = (s) => s.lobes[0].mesh.material.opacity;
  const alone = opacity(hv1);

  at(5000);
  galaxy.update(fleet({ 'hv1-b': 'crit', 'hv2-b': 'crit' }));
  at(5000 + 350);
  assert.ok(hv1.peak < 1 && hv1.peak > 1 - PEAK.step, `eased, not cut: ${hv1.peak}`);
  at(5000 + 2000);
  assert.equal(hv2.peak, 1, 'the new crit is the hottest');
  assert.equal(hv1.peak, 1 - PEAK.step);
  assert.ok(opacity(hv2) > opacity(hv1), `${opacity(hv2)} vs ${opacity(hv1)}`);
  assert.ok(opacity(hv1) < alone);

  // The newer crit clears: the older one is the hottest again.
  galaxy.update(fleet({ 'hv1-b': 'crit' }));
  at(9000);
  assert.equal(hv1.peak, 1);
});

test('the large demo with lab gone crit too: its two crits differ in shape and brightness at the overview', () => {
  const { galaxy, at } = sceneAt();
  // The fixture has one crit (hv2); the live demo turns lab red as well.
  const lab = LARGE.find((n) => n.parent === 'lab');
  galaxy.update({ nodes: LARGE.map((n) => (n === lab ? { ...n, status: 'crit' } : n)) });
  at(1000);
  const crits = galaxy.world.sites.filter((s) => s.nebula.tone === 'crit');
  assert.equal(crits.length, 2, crits.map((s) => s.id).join());
  const [a, b] = crits;
  assert.notDeepEqual(a.lobes.map((l) => l.shape), b.lobes.map((l) => l.shape), 'not the same shape');
  assert.notEqual(a.peak, b.peak, 'not the same brightness');
  const draws = new Set(galaxy.world.sites.flatMap((s) => s.lobes.map((l) => l.mesh.geometry)));
  assert.equal(draws.size, 1, 'one shared lobe geometry');
});
