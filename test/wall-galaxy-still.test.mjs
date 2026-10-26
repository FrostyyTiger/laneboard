// The galaxy under reduced motion (Wall plan night 2 T11, README D5): no
// flight, no turn, no drift. The camera holds the overview with every
// cluster folded while the tour still runs, trouble first, and only the
// caption follows it; trouble glows at its peak instead of breathing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createTour } from '../public/js/wall/tour.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { createGalaxyScene, overviewShot } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { createHud } from '../public/js/wall/galaxy/hud.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import {
  STILL_DEMO_TOUR_TIMING, STILL_TOUR_TIMING, breathWave, dustTurn, prefersStill, stillTourTimingFor,
} from '../public/js/wall/galaxy/still.js';

/** Five sites under a core, each with a room and a builder; `bad` sets statuses by id. */
function fleet(bad = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', label: `${s}-room`, status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', label: `${s}-b`, status: 'ok' });
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
  const opened = [];
  return {
    opened,
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { opened.push([id, k]); this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(42, 16 / 9, 1, 30000),
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

test('prefersStill reads prefers-reduced-motion; no matchMedia or a throwing one is motion', () => {
  const asked = [];
  const mm = (on) => (q) => { asked.push(q); return { matches: on }; };
  assert.equal(prefersStill(mm(true)), true);
  assert.equal(prefersStill(mm(false)), false);
  assert.deepEqual(asked, ['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce)']);
  assert.equal(prefersStill(undefined), false);
  assert.equal(prefersStill(() => null), false);
  assert.equal(prefersStill(() => { throw new Error('no'); }), false);
});

test('the still tour timing has no flight, holds long enough to read, and a faster demo', () => {
  assert.equal(stillTourTimingFor(false), STILL_TOUR_TIMING);
  assert.equal(stillTourTimingFor(true), STILL_DEMO_TOUR_TIMING);
  for (const t of [STILL_TOUR_TIMING, STILL_DEMO_TOUR_TIMING]) {
    assert.equal(t.flyMs, 0, 'nothing flies');
    assert.ok(t.holdMs > t.overviewMs, 'the captions are the point, the bare overview is a pause');
  }
  assert.ok(STILL_TOUR_TIMING.holdMs >= 10000, 'a caption stays ~10 s or more');
});

test('reduced motion: the tour never flies the camera, the overview stands still and every cluster stays folded', () => {
  const nodes = fleet({ 'remote-b': 'crit', 'hv2-b': 'warn' });
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy, { still: true });
  const timers = fakeTimers();
  const tour = createTour(cam, { timing: STILL_TOUR_TIMING, timers });
  tour.update({ nodes });
  tour.start();
  const shot = overviewShot(galaxy.world.sites, 0);
  const wants = [];
  let now = 1000;
  for (let leg = 0; leg < 7; leg++) {
    // every frame of the leg, from its first: the same overview pose, no ease, no turn
    for (let i = 0; i < 40; i++, now += 250) assert.deepEqual(cam.frame(now), shot, `leg ${leg} at ${now}`);
    wants.push(cam.want().kind === 'site' ? cam.want().id : 'overview');
    timers.run();
  }
  assert.deepEqual(wants, ['overview', 'remote', 'hv2', 'hv1', 'cloud', 'home', 'overview'], 'still trouble first');
  assert.deepEqual(galaxy.opened, [], 'no system opened');
  assert.ok(galaxy.world.sites.every((s) => s.open === 0));
  assert.deepEqual(galaxy.camera.position.toArray(), [shot.pos.x, shot.pos.y, shot.pos.z]);
});

test('reduced motion: the caption rotates through the sites at once, trouble first, hidden on the overview', () => {
  const nodes = fleet({ 'remote-b': 'crit', 'hv2-b': 'warn' });
  const model = { nodes };
  const galaxy = fakeGalaxy(nodes);
  const cam = createGalaxyCamera(galaxy, { still: true });
  const timers = fakeTimers();
  const tour = createTour(cam, { timing: STILL_TOUR_TIMING, timers });
  const said = [];
  const caption = {
    show: (leg) => said.push({ id: leg.id, arriveMs: leg.arriveMs, ms: leg.ms }),
    hide: () => said.push('hide'),
    cover: () => null,
  };
  const frame = { update: () => {}, live: () => {}, cover: () => null };
  const hud = createHud({ caption, frame, tour });
  hud.update(model);
  tour.update(model);
  tour.start();
  for (let i = 0; i < 6; i++) timers.run();
  assert.deepEqual(said.map((s) => s.id ?? s), ['hide', 'remote', 'hv2', 'hv1', 'cloud', 'home', 'hide']);
  for (const s of said.filter((x) => x.id)) {
    assert.equal(s.arriveMs, 0, `${s.id}: there at once`);
    assert.equal(s.ms, STILL_TOUR_TIMING.holdMs);
  }
  assert.deepEqual(timers.queue.map((q) => q.ms), [
    STILL_TOUR_TIMING.overviewMs, ...Array(5).fill(STILL_TOUR_TIMING.holdMs), STILL_TOUR_TIMING.overviewMs,
  ]);
});

test('breathWave holds its peak when still; dustTurn stops', () => {
  assert.equal(breathWave(0, 2600), 0);
  assert.ok(Math.abs(breathWave(650, 2600) - 1) < 1e-9);
  for (const t of [0, 650, 1300, 99999]) assert.equal(breathWave(t, 2600, true), 1);
  assert.equal(dustTurn(250000, true), 0);
  assert.ok(dustTurn(250000) > 0.9);
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

function sceneAt(still) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(),
    doc: fakeDoc,
    clock: () => clock.now,
    still,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {},
    }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

test('the still scene: a crit halo and nebula keep one brightness and size; the moving one breathes', () => {
  const look = (still) => {
    const { galaxy, at } = sceneAt(still);
    galaxy.update({ nodes: fleet({ 'remote-b': 'crit' }) });
    const remote = galaxy.world.byId.get('remote');
    const crit = remote.members.find((m) => m.id === 'remote-b');
    return [1000, 1650, 2300, 2950].map((t) => {
      at(t);
      return [crit.halo.material.opacity, remote.nebulaSprite.scale.x];
    });
  };
  const still = look(true);
  assert.ok(still.every(([o, s]) => o === still[0][0] && s === still[0][1]), JSON.stringify(still));
  const moving = look(false);
  assert.ok(new Set(moving.map(([o]) => o)).size > 1, 'the moving halo breathes');
  assert.ok(still[0][0] >= Math.max(...moving.map(([o]) => o)) - 1e-9, 'held at its brightest');
});
