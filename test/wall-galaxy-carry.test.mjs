// Size is what it carries (Wall plan night 5 A3, T2; the owner's sketch pick
// `sk_size=1`): a planet's radius factor 0.8 + 0.35·log2(1+n) of what hangs
// below it, a star's 0.8 + 0.2·log2(1+planets), clamped 0.8x-2.2x, never by
// status; a big star takes a finer sphere so its edge never shows corners.
// Layout is pure; the scene runs on a fake renderer and clock, as in the
// trouble tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { galaxyLayout, carryScale, CARRY } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, bodyRadius, sphereSegs, starSphere, BIG_STAR, MOON, SIZE } from '../public/js/wall/galaxy/scene.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);

/** One site: a room with a service, a builder with `lanes` lanes and a session under each; statuses by id. */
function fleet(lanes = 3, st = {}) {
  const nodes = [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'room-a', parent: 'hv1', kind: 'room', label: 'vm-a', status: 'ok' },
    { id: 'svc', parent: 'room-a', kind: 'service', label: 'svc', status: 'ok' },
    { id: 'room-b', parent: 'hv1', kind: 'room', label: 'vm-b', status: 'ok' },
    { id: 'builder-a', parent: 'room-b', kind: 'builder', label: 'builder-a', status: 'ok' },
    { id: 'room-c', parent: 'hv1', kind: 'room', label: 'vm-c', status: 'ok' },
  ];
  for (let l = 0; l < lanes; l++) {
    nodes.push({ id: `lane-${l}`, parent: 'builder-a', kind: 'lane', label: `lane-${l}`, status: 'working' });
    nodes.push({ id: `lane-${l}/s`, parent: `lane-${l}`, kind: 'session', label: 's', status: 'working' });
  }
  for (const n of nodes) if (st[n.id]) n.status = st[n.id];
  return nodes;
}

test('carryScale: 0.8 + per·log2(1+n), the planet and star rates as the owner picked them', () => {
  assert.deepEqual({ ...CARRY }, { base: 0.8, planet: 0.35, star: 0.2, min: 0.8, max: 2.2 });
  close(carryScale(0, CARRY.planet), 0.8, 'nothing below');
  close(carryScale(1, CARRY.planet), 1.15);
  close(carryScale(3, CARRY.planet), 1.5);
  close(carryScale(7, CARRY.planet), 1.85);
  close(carryScale(3, CARRY.star), 1.2);
  close(carryScale(15, CARRY.star), 1.6);
});

test('carryScale: clamped to 0.8x-2.2x, and nothing odd below 0.8', () => {
  close(carryScale(15, CARRY.planet), 2.2, 'log2(16)·0.35 + 0.8 = 2.2: the planet clamp is reached at 15');
  close(carryScale(1000, CARRY.planet), 2.2);
  close(carryScale(1e6, CARRY.star), 2.2);
  close(carryScale(-4, CARRY.planet), 0.8);
  close(carryScale(NaN, CARRY.star), 0.8);
  close(carryScale(undefined, CARRY.star), 0.8);
  for (let n = 0; n < 300; n++) {
    for (const per of [CARRY.planet, CARRY.star]) {
      const k = carryScale(n, per);
      assert.ok(k >= 0.8 && k <= 2.2, `${n} ${per}`);
      assert.ok(k >= carryScale(n - 1, per), 'never smaller for carrying more');
    }
  }
});

test('layout: a planet carries everything below it, at any depth; the star its planets; the rest 1', () => {
  const site = galaxyLayout(fleet(3)).sites.find((s) => s.id === 'hv1');
  const by = new Map(site.members.map((m) => [m.id, m]));
  close(by.get('builder-a').carry, carryScale(6, CARRY.planet), 'three lanes and their sessions');
  close(by.get('room-b').carry, carryScale(7, CARRY.planet), 'its builder and all under it');
  close(by.get('room-a').carry, carryScale(1, CARRY.planet), 'its service');
  close(by.get('room-c').carry, 0.8, 'nothing below');
  assert.equal(by.get('svc').carry, 1, 'a dot is not carried');
  assert.equal(by.get('lane-0').carry, 1);
  close(site.carry, carryScale(4, CARRY.star), 'three rooms and a builder');
});

test('layout: on the large fixture every carry is the formula of a recount, inside the clamps', () => {
  const byId = new Map(LARGE.map((n) => [n.id, n]));
  for (const s of galaxyLayout(LARGE).sites) {
    const ids = new Set(s.members.map((m) => m.id));
    const below = (id) => s.members.filter((m) => {
      for (let p = byId.get(m.node.parent); p && p.id !== s.id; p = byId.get(p.parent)) if (p.id === id) return true;
      return false;
    }).length;
    for (const m of s.members) {
      assert.ok(ids.has(m.id));
      if (!m.planet) { assert.equal(m.carry, 1); continue; }
      close(m.carry, carryScale(below(m.id), CARRY.planet), m.id);
      assert.ok(m.carry >= 0.8 && m.carry <= 2.2);
    }
    close(s.carry, carryScale(s.members.filter((m) => m.planet).length, CARRY.star), s.id);
  }
});

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
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

const drawnR = (mesh) => mesh.geometry.parameters.radius * mesh.scale.x;

test('scene: planets and the star are drawn at their carry', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update({ nodes: fleet(3) });
  galaxy.setOpen('hv1', 1);
  at(1000);
  const s = galaxy.world.byId.get('hv1');
  const by = new Map(s.members.map((m) => [m.id, m]));
  close(drawnR(by.get('builder-a').mesh), SIZE.planet * carryScale(6, CARRY.planet));
  close(drawnR(by.get('room-c').mesh), SIZE.planet * 0.8);
  close(drawnR(by.get('svc').mesh), MOON.calm * MOON.foldK, 'a calm service is a folded moon of its room (T7), never carried');
  close(s.carry, carryScale(4, CARRY.star));
  close(s.star.scale.x, s.carry, 'the star sphere is SIZE.star at scale 1');
  close(s.starRadius, SIZE.star * s.carry, 'the site\'s name stands beside the star it is drawn at');
  assert.ok(by.get('builder-a').haloSize > by.get('room-c').haloSize, 'the halo follows the body');
});

test('scene: a status change leaves every size alone; only a dot in trouble grows to the planet size, as before', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update({ nodes: fleet(3) });
  galaxy.setOpen('hv1', 1);
  at(1000);
  const s = galaxy.world.byId.get('hv1');
  const sizes = () => Object.fromEntries([['star', s.star.scale.x], ...s.members.filter((m) => m.planet).map((m) => [m.id, drawnR(m.mesh)])]);
  const calm = sizes();
  galaxy.update({ nodes: fleet(3, { hv1: 'down', 'builder-a': 'down', 'room-a': 'attention', 'room-c': 'crit' }) });
  at(1000 + 10000);
  assert.deepEqual(sizes(), calm);
  const by = new Map(s.members.map((m) => [m.id, m]));
  assert.equal(bodyRadius({ planet: true, carry: 1.5 }, 'crit'), bodyRadius({ planet: true, carry: 1.5 }, 'calm'));
  assert.equal(bodyRadius({ planet: false, carry: 1.5 }, 'crit'), SIZE.planet, 'a dot in trouble: planet size, uncarried');
  assert.equal(by.get('room-c').tone, 'crit', 'the change did land');
});

test('scene: a star that grows when a planet joins eases there, the halo with it', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update({ nodes: fleet(0) });
  at(1000);
  const s = galaxy.world.byId.get('hv1');
  const before = s.carry;
  const more = fleet(0);
  for (let r = 0; r < 8; r++) more.push({ id: `room-x${r}`, parent: 'hv1', kind: 'room', label: `x${r}`, status: 'ok' });
  galaxy.update({ nodes: more });
  for (let t = 1000; t <= 20000; t += 100) at(t);
  close(s.carry, carryScale(12, CARRY.star));
  assert.ok(s.carry > before);
  close(s.star.scale.x, s.carry);
});

/** How far a sphere's edge falls inside the true circle between two corners (world units). */
const sag = (r, kind, seg = 1) => r * (1 - Math.cos(Math.PI / sphereSegs(kind, seg)[0]));

test('segments: a big star keeps as round an edge as a 1x star, a 2.2x planet rounder still', () => {
  const ref = sag(SIZE.star, 'star');
  assert.equal(starSphere(1), 'star');
  assert.equal(starSphere(BIG_STAR), 'star');
  assert.equal(starSphere(BIG_STAR + 0.01), 'bigStar');
  assert.ok(sag(SIZE.star * BIG_STAR, 'star') <= ref * BIG_STAR + 1e-9);
  assert.ok(sag(SIZE.star * 1.65, 'bigStar') <= ref, 'up to 1.65x (16 planets) as round as a 1x star');
  assert.ok(sag(SIZE.star * 2.2, 'bigStar') <= ref * 1.4, 'at the clamp, hardly coarser');
  assert.ok(sag(SIZE.planet * 2.2, 'planet') <= ref, 'a 2.2x planet');
  // The budget's lower levels scale every kind alike.
  for (const seg of [0.65, 0.45]) assert.ok(sphereSegs('bigStar', seg)[0] > sphereSegs('star', seg)[0]);
});

test('scene: a carried star takes the big sphere, at every quality level', () => {
  const { galaxy, at } = sceneAt();
  const nodes = fleet(3);
  nodes.push({ id: 'hv2', parent: '__core', kind: 'site', label: 'hv2', status: 'ok' });
  nodes.push({ id: 'hv2/r', parent: 'hv2', kind: 'room', label: 'r', status: 'ok' });
  galaxy.update({ nodes });
  at(1000);
  const big = galaxy.world.byId.get('hv1'), small = galaxy.world.byId.get('hv2');
  assert.ok(big.carry > BIG_STAR && small.carry <= BIG_STAR);
  const w = (s) => s.star.geometry.parameters.widthSegments;
  assert.equal(w(big), sphereSegs('bigStar')[0]);
  assert.equal(w(small), sphereSegs('star')[0]);
  galaxy.setQuality(2);
  assert.equal(w(big), sphereSegs('bigStar', 0.45)[0]);
  assert.equal(w(small), sphereSegs('star', 0.45)[0]);
  assert.equal(big.star.geometry.parameters.radius, SIZE.star);
});
