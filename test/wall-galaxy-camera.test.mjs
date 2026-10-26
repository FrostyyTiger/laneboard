// The galaxy's camera (Wall plan night 2 T4): the Map look-alike the tour
// drives. The tour visits the crit site first and fits after the cycle; a
// flight eases without a jump and rises over a long hop; the held system
// opens just after the camera arrives and folds when it leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../public/vendor/three/three.module.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';
import { galaxyLayout, OPEN_MS, ease } from '../public/js/wall/galaxy/layout.js';
import { overviewShot, FOV } from '../public/js/wall/galaxy/scene.js';
import {
  createGalaxyCamera, flightPose, openStep, zoomedSiteShot, FLIGHT,
} from '../public/js/wall/galaxy/camera.js';

/** Five sites under a core, each with a room and a builder; `bad` sets statuses by id. */
function fleet(bad = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', status: 'ok' });
  }
  for (const n of nodes) if (bad[n.id]) n.status = bad[n.id];
  return nodes;
}

/** The scene as the camera sees it: world, setOpen and a real three camera, no WebGL. */
function fakeGalaxy(nodes) {
  const lay = galaxyLayout(nodes);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0,
    members: s.members.map((m) => ({ id: m.id, mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z) } })),
  }));
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 1, 30000);
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera,
    renderer: { domElement: { clientWidth: 1600, clientHeight: 900 } },
  };
}

function fakeTimers() {
  const queue = [];
  return {
    queue,
    setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
    clearTimeout: (h) => { queue[h - 1].fn = null; },
    run: () => queue.at(-1).fn?.(),
  };
}

const at = (cam) => cam.want().kind === 'site' ? cam.want().id : 'overview';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('galaxy camera: the tour focuses the crit site first and fits after the cycle', () => {
  const nodes = fleet({ 'remote-b': 'crit', 'hv2-b': 'warn' });
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy);
  const timers = fakeTimers();
  const tour = createTour(cam, { timing: DEMO_TIMING, timers });
  tour.update({ nodes });
  tour.start();
  assert.equal(at(cam), 'overview');
  const seen = [];
  for (let i = 0; i < 6; i++) { timers.run(); seen.push(at(cam)); }
  assert.deepEqual(seen, ['remote', 'hv2', 'hv1', 'cloud', 'home', 'overview']);
});

test('galaxy camera: a flight eases from the overview to the system, never jumps, and opens it on arrival', () => {
  const nodes = fleet({ 'cloud-b': 'crit' });
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy);
  cam.fit();
  const start = cam.frame(1000);
  assert.deepEqual(start, overviewShot(galaxy.world.sites));
  cam.focus('cloud', DEMO_TIMING.zoom);
  const cloud = galaxy.world.byId.get('cloud');
  let prev = start.pos;
  let worst = 0;
  for (let t = 1000; t <= 1000 + FLIGHT.ms; t += 16) {
    const p = cam.frame(t);
    worst = Math.max(worst, dist(prev, p.pos));
    prev = p.pos;
    if (t - 1000 < FLIGHT.ms * FLIGHT.openAt) assert.equal(cloud.open, 0, 'closed until most of the way there');
  }
  const end = cam.frame(1000 + FLIGHT.ms);
  assert.deepEqual(end.look, cloud.home, 'arrived: looking at the system');
  const hop = dist(start.pos, end.pos);
  assert.ok(worst < hop / 20, `no step over 1/20 of the hop at 60 fps (${worst.toFixed(0)} of ${hop.toFixed(0)})`);
  assert.ok(cloud.open > 0 && cloud.open < 1, 'opening as the camera arrives');
  for (let t = 1000 + FLIGHT.ms; t <= 1000 + FLIGHT.ms + OPEN_MS; t += 50) cam.frame(t);
  assert.equal(cloud.open, 1, 'open soon after');
  // the camera points at the system: its home projects to the screen centre
  const sp = cam.screenOf('cloud');
  assert.ok(Math.abs(sp.x - 800) < 1 && Math.abs(sp.y - 450) < 1, JSON.stringify(sp));
  assert.ok(cam.screenOf('cloud-b'), 'a node in the system is on screen');
  assert.equal(cam.screenOf('nope'), null);
});

test('galaxy camera: held, it drifts round the system; leaving, the system folds', () => {
  const nodes = fleet();
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy);
  cam.frame(0);
  cam.focus('hv1', DEMO_TIMING.zoom);
  for (let t = 0; t <= 6000; t += 50) cam.frame(t);
  const a = cam.frame(6000).pos;
  const b = cam.frame(6050).pos;
  const step = dist(a, b);
  assert.ok(step > 0 && step < 2, `a slow drift (${step.toFixed(3)} per 50 ms)`);
  assert.equal(galaxy.world.byId.get('hv1').open, 1);
  cam.focus('hv2', DEMO_TIMING.zoom);
  for (let t = 6050; t <= 6050 + OPEN_MS + 100; t += 50) cam.frame(t);
  assert.equal(galaxy.world.byId.get('hv1').open, 0, 'folded behind the camera');
});

test('galaxy camera: a long hop arcs up, a short one barely; zoom brings the camera closer', () => {
  const a = { pos: { x: 0, y: 500, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  const b = { pos: { x: 4000, y: 500, z: 0 }, look: { x: 4000, y: 0, z: 0 } };
  assert.deepEqual(flightPose(a, b, 0), a);
  const mid = flightPose(a, b, 0.5);
  assert.equal(mid.pos.x, 2000);
  assert.equal(mid.pos.y, 500 + Math.min(FLIGHT.maxLift, 4000 * FLIGHT.lift));
  const end = flightPose(a, b, 1);
  assert.ok(Math.abs(end.pos.y - 500) < 1e-9);
  const near = { pos: { x: 100, y: 500, z: 0 }, look: { x: 100, y: 0, z: 0 } };
  assert.ok(flightPose(a, near, 0.5).pos.y - 500 < 20);

  const site = { id: 'hv1', home: { x: 1000, y: 0, z: 0 }, reach: 300 };
  const far = zoomedSiteShot(site, 0, 2.3);
  const close = zoomedSiteShot(site, 0, 4.6);
  assert.ok(Math.abs(dist(close.pos, site.home) * 2 - dist(far.pos, site.home)) < 1e-6);
  assert.deepEqual(close.look, site.home);
});

test('galaxy camera: a flight lasts what the tour counts for it', () => {
  assert.equal(FLIGHT.ms, DEMO_TIMING.flyMs);
});

test('galaxy camera: openStep moves toward the goal at OPEN_MS a full turn and stops there', () => {
  assert.equal(openStep(0, 1, OPEN_MS / 2), 0.5);
  assert.equal(openStep(0.9, 1, OPEN_MS), 1);
  assert.equal(openStep(0.5, 0, OPEN_MS / 4), 0.25);
  assert.equal(openStep(0.1, 0, OPEN_MS), 0);
  assert.equal(openStep(0.3, 1, -5), 0.3);
});

test('galaxy camera: onDraw runs after each drawn frame until removed; the snapshot moves with the camera', () => {
  const galaxy = fakeGalaxy(fleet());
  const cam = createGalaxyCamera(galaxy);
  let n = 0;
  const off = cam.onDraw(() => { n += 1; });
  cam.drawn(); cam.drawn();
  off();
  cam.drawn();
  assert.equal(n, 2);
  const v0 = cam.snapshotScene().version;
  cam.focus('hv1', 2.3);
  assert.ok(cam.snapshotScene().version > v0);
  assert.equal(cam.focus('nowhere', 2.3), undefined);
  assert.equal(cam.want().id, 'hv1', 'an unknown site does not move the camera');
});

test('T24: the overview holds one pose at any time, a held system still drifts', () => {
  const nodes = fleet({ 'cloud-b': 'crit' });
  const galaxy = fakeGalaxy(nodes);
  const sites = galaxy.world.sites;
  const once = overviewShot(sites);
  assert.deepEqual(overviewShot(sites), once);
  const cam = createGalaxyCamera(galaxy);
  cam.fit();
  for (const t of [1000, 61_000, 7 * 60_000, 3_600_000]) assert.deepEqual(cam.frame(t), once, `the overview at ${t} ms`);
  cam.focus('cloud', DEMO_TIMING.zoom);
  cam.frame(3_600_100);
  const held = cam.frame(3_600_000 + FLIGHT.ms + 1000);
  const later = cam.frame(3_600_000 + FLIGHT.ms + 31_000);
  assert.deepEqual(held.look, later.look, 'held on the same star');
  assert.ok(dist(held.pos, later.pos) > 50, 'the drift round a held system goes on (the only depth motion left)');
  cam.fit();
  cam.frame(3_700_000);
  assert.deepEqual(cam.frame(3_700_000 + FLIGHT.ms + 1), once, 'back at the same overview pose');
});

// Night 3 T1 (r59-dreamer 1): a flight never shows only empty sky. Over every
// pair of the large demo's shots (and overview ↔ site), at every step, the
// star it left or the star it flies to is inside the frame, as a real three
// camera projects it; the ends are the shots themselves and the path has no jolt.
const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

test('T1: every flight of the large demo keeps the star it left or the one it flies to in frame', () => {
  const lay = galaxyLayout(LARGE);
  const aspect = 1368 / 912;
  const view = { fov: FOV, aspect, free: { x0: 0.3, y0: 0, x1: 1, y1: 0.8 } };
  const shots = [
    { id: 'overview', star: { x: 0, y: 0, z: 0 }, shot: overviewShot(lay.sites) },
    ...lay.sites.map((s) => ({ id: s.id, star: s.home, shot: zoomedSiteShot(s, 0, DEMO_TIMING.zoom, view) })),
  ];
  assert.ok(shots.length >= 6);
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 1, 30000);
  const inFrame = (pose, p) => {
    cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    cam.lookAt(pose.look.x, pose.look.y, pose.look.z);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    if (v.z >= 0) return false; // behind
    v.applyMatrix4(cam.projectionMatrix);
    return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  };
  let lostBefore = 0;
  const N = 140; // 60 fps over FLIGHT.ms
  for (const a of shots) for (const b of shots) {
    if (a === b) continue;
    const frame = { fov: FOV, aspect, ends: [a.star, b.star] };
    assert.deepEqual(flightPose(a.shot, b.shot, 0, FLIGHT, frame), flightPose(a.shot, b.shot, 0), `${a.id} → ${b.id}: starts where it was`);
    const end = flightPose(a.shot, b.shot, 1, FLIGHT, frame);
    assert.ok(dist(end.pos, b.shot.pos) < 1e-6 && dist(end.look, b.shot.look) < 1e-6, `${a.id} → ${b.id}: lands on the shot`);
    let prev = null;
    const steps = [];
    for (let i = 0; i <= N; i++) {
      const k = ease(i / N);
      const pose = flightPose(a.shot, b.shot, k, FLIGHT, frame);
      if (![a.star, b.star].some((p) => inFrame(flightPose(a.shot, b.shot, k), p))) lostBefore += 1;
      assert.ok(inFrame(pose, a.star) || inFrame(pose, b.star), `${a.id} → ${b.id} at step ${i}: an end in frame`);
      if (prev) steps.push(dist(prev, pose.pos));
      prev = pose.pos;
    }
    // the eased flight alone has a peak step ~2.9x its mean; stepping back may add little to that
    const mean = steps.reduce((x, y) => x + y, 0) / steps.length;
    assert.ok(Math.max(...steps) < mean * 3.6, `${a.id} → ${b.id}: no jolt (${(Math.max(...steps) / mean).toFixed(2)}x the mean step)`);
  }
  assert.ok(lostBefore > 0, 'without the frame, some flights do show only empty sky (the test can fail)');
});

test('T1: the camera flies from site to site with a star in frame, even when a flight is cut short', () => {
  const nodes = fleet({ 'cloud-b': 'crit' });
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy);
  const homes = galaxy.world.sites.map((s) => s.home);
  const anyStar = () => homes.some((h) => {
    const v = new THREE.Vector3(h.x, h.y, h.z).project(galaxy.camera);
    return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  }) || (() => { const v = new THREE.Vector3(0, 0, 0).project(galaxy.camera); return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1; })();
  let t = 0;
  cam.frame(t);
  for (const id of ['hv1', 'remote', 'cloud', 'home']) {
    cam.focus(id, DEMO_TIMING.zoom);
    for (let s = 0; s <= FLIGHT.ms + 200; s += 16) { t += 16; cam.frame(t); assert.ok(anyStar(), `to ${id} at ${s} ms`); }
  }
  // cut short halfway, sent on elsewhere
  cam.focus('hv2', DEMO_TIMING.zoom);
  for (let s = 0; s < FLIGHT.ms / 2; s += 16) { t += 16; cam.frame(t); }
  let prev = cam.frame(t).pos;
  cam.fit();
  for (let s = 0; s <= FLIGHT.ms; s += 16) {
    t += 16;
    const p = cam.frame(t);
    assert.ok(anyStar(), `to the overview at ${s} ms`);
    assert.ok(dist(prev, p.pos) < 200, 'no jump when cut short');
    prev = p.pos;
  }
});
