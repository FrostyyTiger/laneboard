// The galaxy's camera (Wall plan night 2 T4): the Map look-alike the tour
// drives. The tour visits the crit site first and fits after the cycle; a
// flight eases without a jump and rises over a long hop; the held system
// opens just after the camera arrives and folds when it leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';
import { galaxyLayout, OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { overviewShot } from '../public/js/wall/galaxy/scene.js';
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
  assert.deepEqual(start, overviewShot(galaxy.world.sites, 1000));
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
