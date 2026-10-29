// A drag in an open system turns it round its own star (Wall plan night 5 C2,
// T12): both axes, the pitch clamped, the system held and open the whole
// time, and the star on the very screen point it stood on (no aim offset, so
// the first drag never shifts the system). A tap on empty sky does nothing.
// A lock whose target is turned out of the frame hides, leader and all
// (r30-touch 1). The pure orbit (touch.js orbitRound) on a THREE camera, and
// the page: the large demo on the real scene with a fake renderer, stage and
// clock, the touch, gestures, taps, director and camera as main.js wires them.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { createDirector } from '../public/js/wall/galaxy/director.js';
import { freeRect } from '../public/js/wall/galaxy/framing.js';
import { offFrame } from '../public/js/wall/galaxy/lock.js';
import {
  ORBIT, createGestures, createTaps, createTouch, hitNearest, memberHit, memberPoints, orbitLimits, orbitPose, orbitRound, orbitStep,
  placeOf, AT_OVERVIEW, tapPoints, zoomStep,
} from '../public/js/wall/galaxy/touch.js';
import { TIMING } from '../public/js/wall/tour.js';
import { makeEl } from './helpers/fakedom.mjs';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const W = 1368, H = 912, FOV = 42;
// Where the words stand on a 1368 px tablet with a site's sheet up (wall-galaxy-pick's).
const WORDS = [{ left: 110, top: 70, right: 780, bottom: 570 }, { left: 990, top: 90, right: 1285, bottom: 135 }, { left: 670, top: 690, right: 1285, bottom: 840 }];

/** Where world point `p` is drawn from `pose` on a W×H frame: css px. */
function project(pose, p) {
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 1, 1e6);
  cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  cam.lookAt(pose.look.x, pose.look.y, pose.look.z);
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// A held shot's kind of pose: the star off the frame's middle (the plate's free box), seen from above.
const STAR = { x: 700, y: 0, z: -300 };
const HOLD = { pos: { x: 700 + 900, y: 800, z: -300 + 500 }, look: { x: 700 - 260, y: -60, z: -300 + 120 } };

test('orbitRound: no turn gives the pose back; any turn or zoom keeps the star on its screen point, the pitch in its clamp', () => {
  const o = orbitRound(HOLD, STAR);
  const back = orbitPose(o);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(back.pos[k] - HOLD.pos[k]) < 1e-6, `pos.${k}`);
  const was = project(HOLD, STAR);
  assert.ok(far(project(back, STAR), was) < 1e-6, 'the same view');
  assert.ok(far(was, { x: W / 2, y: H / 2 }) > 100, `the star off the middle (${was.x.toFixed(0)}, ${was.y.toFixed(0)}): the case an aim offset gets wrong`);
  for (const [dx, dy] of [[200, 0], [-200, 0], [0, 200], [0, -200], [-400, 120], [600, -300]]) {
    const t = orbitStep(o, dx, dy);
    assert.ok(far(project(orbitPose(t), STAR), was) < 0.5, `dragged ${dx}, ${dy}: star at ${JSON.stringify(project(orbitPose(t), STAR))}`);
    assert.ok(t.pitch >= o.range[0] - 1e-12 && t.pitch <= o.range[1] + 1e-12, 'pitch in its clamp');
    assert.ok(o.range[0] >= ORBIT.pitch[0] - 1e-12 || o.range[0] === o.pitch, 'never lower than ORBIT\'s, unless it stood there');
    assert.ok(o.range[1] <= ORBIT.pitch[1] + 1e-12, 'never higher than ORBIT\'s');
  }
  assert.ok(orbitStep(o, 0, 9999).pitch === o.range[1] && orbitStep(o, 0, -9999).pitch === o.range[0], 'clamped both ways');
  for (const f of [0.6, 1.8]) {
    const z = zoomStep(o, f, { near: 100, far: 1e5 }, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(z.dist - o.dist * f) < 1e-9, 'the distance zooms');
    assert.ok(far(project(orbitPose(z), STAR), was) < 0.5, 'round the star: it stays put, whatever is under the fingers');
  }
});

test('orbitRound: a camera standing below ORBIT\'s pitch keeps its pitch on the first drag (the clamp widens, no jump)', () => {
  const low = { pos: { x: 700 + 1400, y: 150, z: -300 }, look: { x: 700, y: 0, z: -300 } };
  const o = orbitRound(low, STAR);
  assert.ok(o.pitch < ORBIT.pitch[0], `stands at ${o.pitch.toFixed(3)}`);
  const t = orbitStep(o, 30, 0);
  assert.equal(t.pitch, o.pitch, 'a level drag keeps the low pitch');
  assert.ok(orbitStep(o, 0, 40).pitch > o.pitch, 'and can rise');
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

/** A fakedom stage that keeps its listeners, so pointer events can be dispatched on it. */
function stageEl() {
  const el = makeEl('main');
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, init = {}) => {
    const ev = { type, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, ...init, preventDefault() {}, stopPropagation() {} };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  return el;
}

/** The page on the large demo in `explore`, wired as main.js: taps, gestures round the held star, the director. */
function page() {
  let now = 50_000;
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  galaxy.update({ nodes: LARGE });
  const cam = createGalaxyCamera(galaxy, { steer: true, free: () => freeRect(W, H, WORDS) });
  const director = createDirector(cam, { clock: () => now, driver: 'touch' });
  const finger = director.as('touch');
  const stage = stageEl();
  const touch = createTouch(stage, { clock: () => now, role: 'explore' });
  let place = AT_OVERVIEW;
  const gestures = createGestures(stage, touch, finger, {
    clock: () => now,
    limits: () => orbitLimits(cam.home(), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
    pivot: () => {
      const w = cam.want();
      return w.kind === 'site' ? galaxy.world.byId.get(w.id)?.home ?? null : null;
    },
  });
  const taps = [];
  createTaps(touch, {
    clock: () => now,
    pick: (x, y, ev) => memberHit(memberPoints(galaxy.world.sites, cam.screenOf), x, y)
      ?? hitNearest(tapPoints(galaxy.world.sites, cam.screenOf), x, y, ev?.pointerType === 'mouse' ? 28 : 48),
    // main.js's tap: a planet, a site, and empty sky nothing.
    tap: (hit) => {
      taps.push(hit);
      if (hit?.covered) return; if (hit?.site) { finger.focus(hit.site, TIMING.zoom, { member: hit.id }); place = placeOf(hit.site, hit.id); } else if (hit) { finger.focus(hit.id, TIMING.zoom); place = placeOf(hit.id); }
    },
  });
  const tick = (ms = 16) => { now += ms; touch.mode(); gestures.frame(now); cam.frame(now); galaxy.frame(now); };
  const run = (ms) => { for (let t = 0; t < ms; t += 16) tick(16); };
  const tapAt = (id, sp) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y });
    tick(60);
    stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y });
  };
  const drag = (id, from, dx, dy, steps = 20) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: from.x, clientY: from.y });
    for (let i = 1; i <= steps; i++) {
      stage.dispatch('pointermove', { pointerId: id, clientX: from.x + (dx * i) / steps, clientY: from.y + (dy * i) / steps });
      tick(16);
    }
    stage.dispatch('pointerup', { pointerId: id, clientX: from.x + dx, clientY: from.y + dy });
  };
  return { galaxy, cam, touch, gestures, run, tick, tapAt, drag, taps, place: () => place };
}

/** The camera's pitch over a point (rad). */
const pitchOver = (pose, p) => Math.asin((pose.pos.y - p.y) / Math.hypot(pose.pos.x - p.x, pose.pos.y - p.y, pose.pos.z - p.z));

test('page: a tapped system turned 200 px each way stays held and open, its star within 2 px, the pitch clamped; an empty tap changes nothing', () => {
  const p = page();
  p.run(500);
  p.tapAt(1, p.cam.screenOf('lab'));
  p.run(FLIGHT.ms + OPEN_MS + 500);
  const lab = p.galaxy.world.byId.get('lab');
  assert.deepEqual([p.cam.want().kind, p.cam.want().id, p.place().level], ['site', 'lab', 'site']);
  assert.ok(lab.open > 0.99, 'lab open');
  const star = p.cam.screenOf('lab');
  // Empty sky well away from every drawn thing.
  const sky = { x: 60, y: H - 40 };
  assert.ok(tapPoints(p.galaxy.world.sites, p.cam.screenOf).every((q) => far(q, sky) > 120), 'the sky is empty');

  // A drag from beside the star (a finger on the system), 200 px each way.
  const from = { x: star.x - 90, y: star.y + 60 };
  let n = 10;
  for (const [dx, dy] of [[-200, 0], [200, 0], [0, 200], [0, -200]]) {
    const before = p.cam.screenOf('lab');
    p.drag(n++, from, dx, dy);
    const w = p.cam.want();
    assert.deepEqual([w.kind, w.id], ['site', 'lab'], `${dx}, ${dy}: still held`);
    assert.ok(w.turned, 'the finger\'s pose is the hold');
    assert.ok(lab.open > 0.99, `${dx}, ${dy}: still open (${lab.open})`);
    const after = p.cam.screenOf('lab');
    assert.ok(far(before, after) <= 2, `${dx}, ${dy}: the star ${before.x.toFixed(1)},${before.y.toFixed(1)} → ${after.x.toFixed(1)},${after.y.toFixed(1)}`);
    p.run(1500); // the coast
    const rest = p.cam.screenOf('lab');
    assert.ok(far(before, rest) <= 2, `${dx}, ${dy}: after the coast too (${rest.x.toFixed(1)}, ${rest.y.toFixed(1)})`);
    assert.ok(lab.open > 0.99, 'open after the coast');
    const pitch = pitchOver(p.cam.pose(), lab.home);
    assert.ok(pitch >= Math.min(ORBIT.pitch[0], pitch) && pitch <= ORBIT.pitch[1] + 1e-9, `pitch ${pitch.toFixed(3)} in its clamp`);
  }
  // The turn really turned (not a camera that ignored the finger).
  const turned = p.cam.pose();
  const yaw = (q) => Math.atan2(q.pos.x - lab.home.x, q.pos.z - lab.home.z);
  // A drag far down: the pitch stops at the clamp's top.
  p.drag(n++, from, 0, 600, 30);
  p.run(1500);
  assert.ok(pitchOver(p.cam.pose(), lab.home) <= ORBIT.pitch[1] + 1e-9, 'never over the top');
  assert.ok(far(p.cam.screenOf('lab'), star) <= 2 + 2, 'the star where it was');

  // An empty tap: no mode, place, selection or camera change.
  const pose = p.cam.pose(), want = p.cam.want(), mode = p.touch.mode(), place = p.place();
  p.tapAt(n++, sky);
  p.run(500);
  assert.equal(p.taps.at(-1), null, 'the tap landed on nothing');
  assert.deepEqual([p.touch.mode(), p.place(), p.cam.want()], [mode, place, want]);
  assert.deepEqual(p.cam.pose(), pose, 'the camera did not move');
  assert.ok(lab.open > 0.99, 'still open');
  assert.ok(Math.abs(yaw(turned) - yaw(p.cam.pose())) < 1e-9, 'the turn kept');
});

test('page: a planet tapped after a turn flies on from the turned pose; a drag at the overview is the free orbit as before', () => {
  const p = page();
  p.run(500);
  const over = p.cam.screenOf('lab');
  p.drag(2, { x: 700, y: 450 }, 120, 0);
  assert.equal(p.cam.want().kind, 'free', 'no held site: the free pose');
  p.run(1500);
  p.tapAt(3, p.cam.screenOf('lab'));
  p.run(FLIGHT.ms + OPEN_MS + 500);
  p.drag(4, { x: 900, y: 500 }, -150, 40);
  p.run(1500);
  assert.ok(p.cam.want().turned && p.cam.want().member == null);
  const ba = p.cam.screenOf('builder:builder-a');
  p.tapAt(5, ba);
  p.tick(16);
  const w = p.cam.want();
  assert.deepEqual([w.kind, w.id, w.member, w.turned], ['site', 'lab', 'builder:builder-a', undefined], 'the pick framing, the turn dropped');
  assert.ok(over, 'lab was in sight at the overview');
});

test('the lock hides a target turned out of the frame (r30-touch 1): offFrame', () => {
  assert.equal(offFrame({ x: 10, y: 10 }, W, H), false);
  assert.equal(offFrame({ x: W, y: H }, W, H), false, 'the edge is in');
  for (const sp of [{ x: -1, y: 10 }, { x: W + 1, y: 10 }, { x: 10, y: -1 }, { x: 10, y: H + 1 }]) assert.equal(offFrame(sp, W, H), true);
  assert.equal(offFrame({ x: -50, y: -50 }, 0, 0), false, 'an unmeasured frame hides nothing');
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/lock.js', import.meta.url), 'utf8');
  assert.match(js, /if \(offFrame\(sp, W, H\)\) \{ hideBox\(\); return; \}/, 'paint hides brackets and leader');
});

test('galaxy/main.js: the gestures turn round the held site\'s star (pivot), an empty tap does nothing', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  const g = js.slice(js.indexOf('const gestures = touch && !reduced ? createGestures('), js.indexOf('}) : null;', js.indexOf('const gestures = touch')));
  assert.match(g, /pivot: \(\) => \{/);
  assert.match(g, /w\.kind === 'site' \? galaxy\.world\?\.byId\.get\(w\.id\)\?\.home/);
  const tap = js.slice(js.indexOf('tap: (hit) =>'), js.indexOf('}) : null;', js.indexOf('tap: (hit) =>')));
  assert.doesNotMatch(tap, /goBack/, 'empty sky is not a step back');
});
