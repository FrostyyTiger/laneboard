// Touch, the first touch (Wall plan night 3 T7, README §7 Night 3 C1, C6):
// galaxy/touch.js on a fake clock. The first touch stops the tour and fits the
// camera once, in TOUCH.fitMs; nothing under it is handled; the page blocks
// scroll, pinch-zoom and the context menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeEl } from './helpers/fakedom.mjs';
import {
  ORBIT, TAP, TOUCH, atRest, createGestures, createTaps, createTouch, hitTest, inertia, isPalm, orbitLimits, orbitOf,
  memberPoints, orbitPose, orbitStep, planeAt, tapPoints, touchStep, zoomStep,
} from '../public/js/wall/galaxy/touch.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';
import { FLIGHT, createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { overviewShot } from '../public/js/wall/galaxy/scene.js';
import * as THREE from '../public/vendor/three/three.module.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

/** A fakedom element that keeps its listeners, so pointer events can be dispatched on it. */
function stageEl() {
  const el = makeEl('main');
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, init = {}) => {
    const ev = {
      type, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, ...init,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  el.listeners = (type) => on.get(type)?.size ?? 0;
  return el;
}

function fakeTimers() {
  const live = new Map();
  let n = 0;
  return {
    live,
    setTimeout: (fn, ms) => { live.set(++n, { fn, ms }); return n; },
    clearTimeout: (h) => live.delete(h),
  };
}

test('touchStep: tour → easing on a down (wake, swallowed), easing → explore after fitMs', () => {
  const t0 = 10_000;
  const a = touchStep(null, 'down', t0);
  assert.deepEqual(a, { state: { mode: 'easing', since: t0 }, wake: true, swallow: true });
  assert.equal(touchStep(a.state, 'tick', t0 + TOUCH.fitMs - 1).state.mode, 'easing');
  const b = touchStep(a.state, 'tick', t0 + TOUCH.fitMs);
  assert.equal(b.state.mode, 'explore');
  assert.equal(b.wake, false);
  // A second down while easing or exploring is a touch of its own: no second wake, not swallowed.
  const c = touchStep(a.state, 'down', t0 + 200);
  assert.deepEqual([c.state.mode, c.wake, c.swallow], ['easing', false, false]);
  const d = touchStep(b.state, 'down', t0 + 5000);
  assert.deepEqual([d.state.mode, d.wake, d.swallow], ['explore', false, false]);
  // Ticks alone never leave the tour.
  assert.deepEqual(touchStep({ mode: 'tour', since: null }, 'tick', 9e9).state, { mode: 'tour', since: null });
});

test('the first touch eases the camera out in about 1.5 s', () => {
  assert.ok(TOUCH.fitMs >= 1200 && TOUCH.fitMs <= 1800, `${TOUCH.fitMs} ms`);
});

test('pointer events on the stage: the tour stops, fit() is asked once, the waking touch reaches nothing', () => {
  let now = 50_000;
  const stage = stageEl();
  const timers = fakeTimers();
  const calls = [];
  const map = { focus: (id) => calls.push(`focus ${id}`), fit: (o) => calls.push(`fit ${o?.ms ?? ''}`.trim()) };
  const tour = createTour(map, { timing: DEMO_TIMING, timers });
  tour.update({ nodes: [{ id: '__core', kind: 'core', status: 'ok' }, { id: 'hv1', kind: 'site', status: 'crit' }] });
  tour.start();
  assert.equal(timers.live.size, 1, 'the tour has its next leg waiting');
  const before = calls.length;

  const touch = createTouch(stage, {
    clock: () => now,
    wake: () => { tour.stop(); map.fit({ ms: TOUCH.fitMs }); },
  });
  const heard = [];
  touch.onPointer((ev, mode) => heard.push(`${ev.type} ${ev.pointerId} ${mode}`));
  assert.equal(touch.mode(), 'tour');

  // The first touch: down, a little move, up (a tap on whatever was under it).
  const down = stage.dispatch('pointerdown');
  assert.ok(down.defaultPrevented && down.stopped, 'the waking down is swallowed');
  now += 40;
  stage.dispatch('pointermove', { clientX: 102 });
  now += 80;
  const up = stage.dispatch('pointerup');
  assert.ok(up.defaultPrevented && up.stopped, 'its up too: no tap comes of it');
  assert.deepEqual(heard, [], 'nothing heard the waking touch');
  assert.deepEqual(calls.slice(before), [`fit ${TOUCH.fitMs}`], 'fit() asked once, in its own time');
  assert.equal(timers.live.size, 0, 'the tour stopped: no leg waiting');
  assert.equal(touch.mode(), 'easing');

  now += TOUCH.fitMs;
  assert.equal(touch.mode(), 'explore');

  // The next touch is a touch: later steps (drag, tap) hear it; no second fit.
  stage.dispatch('pointerdown', { pointerId: 2 });
  stage.dispatch('pointerup', { pointerId: 2 });
  assert.deepEqual(heard, ['pointerdown 2 explore', 'pointerup 2 explore']);
  assert.deepEqual(calls.slice(before), [`fit ${TOUCH.fitMs}`]);

  // A long press never opens the browser's menu.
  assert.ok(stage.dispatch('contextmenu').defaultPrevented);

  touch.stop();
  assert.equal(stage.listeners('pointerdown'), 0);
});

test('a second finger during the waking touch is its own pointer; the waking one stays swallowed until it lifts', () => {
  let now = 0;
  const stage = stageEl();
  let wakes = 0;
  const touch = createTouch(stage, { clock: () => now, wake: () => { wakes++; } });
  const heard = [];
  touch.onPointer((ev) => heard.push(`${ev.type} ${ev.pointerId}`));
  stage.dispatch('pointerdown', { pointerId: 7 });
  now += 100;
  stage.dispatch('pointerdown', { pointerId: 8 });
  stage.dispatch('pointermove', { pointerId: 7 });
  stage.dispatch('pointercancel', { pointerId: 7 });
  stage.dispatch('pointerup', { pointerId: 8 });
  assert.equal(wakes, 1);
  assert.deepEqual(heard, ['pointerdown 8', 'pointerup 8']);
  // Pointer 7 lifted: an id the browser reuses later is an ordinary touch.
  now += 5000;
  stage.dispatch('pointerdown', { pointerId: 7 });
  assert.deepEqual(heard.at(-1), 'pointerdown 7');
});

function fakeGalaxy() {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud']) {
    nodes.push({ id: s, kind: 'site', status: 'ok', parent: '__core' });
    nodes.push({ id: `${s}-a`, kind: 'room', status: 'ok', parent: s });
  }
  const lay = galaxyLayout(nodes);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0,
    members: s.members.map((m) => ({ id: m.id, mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z) } })),
  }));
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(42, 16 / 9, 1, 30000),
    renderer: { domElement: { clientWidth: 1600, clientHeight: 900 } },
    size: () => ({ W: 1600, H: 900 }),
  };
}

test('camera fit({ ms }) flies back to the overview in that time, the tour\'s fit() in FLIGHT.ms', () => {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud']) {
    nodes.push({ id: s, kind: 'site', status: 'ok', parent: '__core' });
    nodes.push({ id: `${s}-a`, kind: 'room', status: 'ok', parent: s });
  }
  const lay = galaxyLayout(nodes);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0,
    members: s.members.map((m) => ({ id: m.id, mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z) } })),
  }));
  const galaxy = {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(42, 16 / 9, 1, 30000),
    renderer: { domElement: { clientWidth: 1600, clientHeight: 900 } },
  };
  const cam = createGalaxyCamera(galaxy);
  const once = overviewShot(sites);
  cam.focus('hv2', DEMO_TIMING.zoom);
  cam.frame(0);
  cam.frame(10_000); // held on hv2
  cam.fit({ ms: TOUCH.fitMs });
  cam.frame(20_000);
  const mid = cam.frame(20_000 + TOUCH.fitMs / 2);
  assert.notDeepEqual(mid, once, 'still on its way half way through');
  assert.deepEqual(cam.frame(20_000 + TOUCH.fitMs), once, 'at the overview after fitMs');
  assert.equal(cam.want().ms, TOUCH.fitMs);
  cam.fit();
  assert.equal(cam.want().ms, undefined, 'the tour\'s fit keeps the tour\'s flight');
});

test('galaxy.html and wall.css block page scroll, pinch-zoom and selection under a finger', () => {
  const html = read('galaxy.html');
  const meta = html.match(/<meta name="viewport" content="([^"]+)">/)?.[1] ?? '';
  assert.match(meta, /user-scalable=no/);
  assert.match(meta, /maximum-scale=1\b/);
  const css = read('css/wall.css');
  const rule = (sel) => css.match(new RegExp(`(^|\\n)${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';
  assert.match(rule('.galaxy-stage'), /touch-action: none;/);
  assert.match(rule('.galaxy-stage'), /overscroll-behavior: none;/);
  assert.match(rule('.galaxy-canvas'), /touch-action: none;/);
  assert.match(css, /\.wall body \{[^}]*user-select: none;/);
  assert.match(html, /id="galaxy-stage"/);
});

test('galaxy/main.js wires the first touch: tour stopped, the camera fit in TOUCH.fitMs, the plate released', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createTouch\(document\.getElementById\('galaxy-stage'\)/);
  const wake = js.slice(js.indexOf('wake: () => {'), js.indexOf('},', js.indexOf('wake: () => {')));
  assert.match(wake, /tour\.stop\(\)/);
  assert.match(wake, /cam\.fit\(\{ ms: TOUCH\.fitMs \}\)/);
  assert.match(wake, /hud\.release\(\)/);
  // A new model does not start a stopped tour again (T14 brings it back).
  assert.match(js, /if \(!park && touch\?\.mode\(\) === 'tour'\) tour\.start\(\);/);
});

// ---- T8: drag, pinch, the wheel ----

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
/** How far yaw `b` turned from `a` (rad, in (-π, π]): atan2 wraps, turns do not. */
const turned = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const orbit0 = () => ({ look: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.9, dist: 5000 });
const LIM = { near: ORBIT.near, far: 5000, centre: { x: 0, y: 0, z: 0 }, reach: 3000 };

test('orbitStep: the pitch stays clamped at both ends, never edge-on or over the top; 0 px changes nothing', () => {
  const o = orbit0();
  assert.equal(orbitStep(o, 0, 0), o, 'a drag of 0 px is the same orbit');
  const [lo, hi] = ORBIT.pitch;
  assert.ok(lo > 0.2 && hi < Math.PI / 2, 'the range keeps clear of edge-on (0) and straight down (90°)');
  const up = orbitStep(o, 0, 1e5);
  const down = orbitStep(o, 0, -1e5);
  assert.equal(up.pitch, hi);
  assert.equal(down.pitch, lo);
  // The camera stays above the plane at both ends.
  assert.ok(orbitPose(down).pos.y > 0 && orbitPose(up).pos.y > 0);
  // A drag right turns the galaxy with the finger: the camera's yaw goes the other way.
  assert.ok(orbitStep(o, 40, 0).yaw < o.yaw);
  assert.ok(near(orbitStep(o, 40, 0).yaw, -40 * ORBIT.perPx));
});

test('orbitOf and orbitPose stand in the same place; the overview shot reads back as itself', () => {
  const shot = overviewShot(fakeGalaxy().world.sites);
  const back = orbitPose(orbitOf(shot));
  for (const k of ['x', 'y', 'z']) {
    assert.ok(near(back.pos[k], shot.pos[k], 1e-6), `pos.${k}`);
    assert.ok(near(back.look[k], shot.look[k], 1e-9), `look.${k}`);
  }
});

test('zoomStep: the distance stays in [overview, close]; zooming all the way out lands on the overview\'s centre', () => {
  const o = orbit0();
  assert.equal(zoomStep(o, 1e-6, LIM).dist, LIM.near, 'no closer than a close system');
  assert.equal(zoomStep(o, 1e6, LIM).dist, LIM.far, 'no farther than the overview');
  assert.equal(zoomStep(o, 1, LIM), o, 'a factor of 1 changes nothing');
  // Closing in on a point moves the look toward it, then out again brings it home.
  const at = { x: 2000, y: 0, z: 0 };
  const inn = zoomStep(o, 0.3, LIM, at);
  assert.ok(inn.look.x > 0 && inn.look.x < at.x, `look toward the point: ${inn.look.x}`);
  const out = zoomStep(inn, 100, LIM);
  assert.equal(out.dist, LIM.far);
  assert.ok(near(out.look.x, 0) && near(out.look.z, 0), 'at the widest the look is the centre');
  // The look never leaves the galaxy.
  let z = o;
  for (let i = 0; i < 40; i++) z = zoomStep(z, 0.9, LIM, { x: 1e6, y: 0, z: 0 });
  assert.ok(Math.hypot(z.look.x, z.look.z) <= LIM.reach + 1e-6);
});

test('inertia decays to rest: monotonic, then exactly zero', () => {
  let v = { x: 2, y: -1, zoom: 0.003 };
  let prev = Infinity, steps = 0;
  while (!atRest(v)) {
    const speed = Math.hypot(v.x, v.y) + Math.abs(v.zoom) * 1000;
    assert.ok(speed < prev, 'slower every frame');
    prev = speed;
    v = inertia(v, 16);
    steps++;
    assert.ok(steps < 400, 'comes to rest within seconds');
  }
  assert.deepEqual(v, { x: 0, y: 0, zoom: 0 });
  assert.ok(steps * 16 > 500, 'a throw coasts, it does not stop dead');
  assert.deepEqual(inertia(v, 16), { x: 0, y: 0, zoom: 0 }, 'rest stays rest');
});

test('planeAt: the frame\'s middle is the look point; above the horizon is nothing', () => {
  const shot = overviewShot(fakeGalaxy().world.sites);
  const p = planeAt(shot, 800, 450, 1600, 900, 42);
  assert.ok(near(p.x, 0, 1e-6) && near(p.z, 0, 1e-6) && p.y === 0);
  const low = orbitPose({ look: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.1, dist: 5000 });
  assert.equal(planeAt(low, 800, 0, 1600, 900, 42), null);
  assert.equal(planeAt(shot, 0, 0, 0, 0, 42), null);
});

test('orbitLimits: far is the overview\'s distance, near a close system, reach the farthest site', () => {
  const sites = fakeGalaxy().world.sites;
  const shot = overviewShot(sites);
  const l = orbitLimits(shot, sites);
  assert.ok(near(l.far, orbitOf(shot).dist, 1e-6));
  assert.equal(l.near, ORBIT.near);
  assert.ok(l.reach > 0 && l.reach === Math.max(...sites.map((s) => Math.hypot(s.home.x, s.home.z))));
});

test('the camera\'s steer is behind an option: without it (the tour\'s camera) a steer does nothing', () => {
  const cam = createGalaxyCamera(fakeGalaxy());
  cam.frame(0);
  const before = cam.pose();
  cam.steer({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(cam.frame(16), before);
  assert.equal(cam.want().kind, 'overview');
  const still = createGalaxyCamera(fakeGalaxy(), { steer: true, still: true });
  still.frame(0);
  still.steer({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } });
  assert.equal(still.want().kind, 'overview', 'reduced motion: no steering');
});

/** The page's touch path on a fake clock: stage → createTouch → createGestures → the camera. */
function touchPage() {
  let now = 100_000;
  const stage = stageEl();
  const galaxy = fakeGalaxy();
  const cam = createGalaxyCamera(galaxy, { steer: true });
  const touch = createTouch(stage, { clock: () => now, wake: () => cam.fit({ ms: TOUCH.fitMs }) });
  let moves = 0;
  const gestures = createGestures(stage, touch, cam, {
    clock: () => now,
    limits: () => orbitLimits(cam.home(), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
    moved: () => { moves++; },
  });
  const tick = (ms = 16) => { now += ms; touch.mode(); gestures.frame(now); return cam.frame(now); };
  const run = (ms) => { let p; for (let t = 0; t < ms; t += 16) p = tick(16); return p; };
  // The tour has the camera on hv2; the first touch brings it out, then explore.
  cam.focus('hv2', DEMO_TIMING.zoom);
  run(4000);
  stage.dispatch('pointerdown', { pointerId: 1 });
  stage.dispatch('pointerup', { pointerId: 1 });
  run(TOUCH.fitMs + 100);
  assert.equal(touch.mode(), 'explore');
  const drag = (id, path, msPer = 16) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: path[0][0], clientY: path[0][1] });
    for (const [x, y] of path.slice(1)) { stage.dispatch('pointermove', { pointerId: id, clientX: x, clientY: y }); tick(msPer); }
    stage.dispatch('pointerup', { pointerId: id, clientX: path.at(-1)[0], clientY: path.at(-1)[1] });
  };
  return { stage, cam, touch, gestures, galaxy, tick, run, drag, now: () => now, moves: () => moves };
}

test('pointer events on the page: a one-finger drag turns the camera round the galaxy, then it coasts to rest', () => {
  const p = touchPage();
  const start = orbitOf(p.cam.pose());
  const over = orbitOf(overviewShot(p.galaxy.world.sites));
  assert.ok(near(start.dist, over.dist, 1) && near(start.yaw, over.yaw, 1e-6), 'explore starts at the overview');

  // A drag of 0 px (a finger down and up in place) changes nothing.
  p.drag(5, [[600, 400], [600, 400]]);
  p.run(200);
  assert.ok(near(orbitOf(p.cam.pose()).yaw, start.yaw, 1e-9), 'no turn from a finger that did not move');
  assert.equal(p.moves(), 0, 'and the page is not told of a move');

  // A finger throws right: the galaxy turns with it, and keeps turning a little after the lift.
  const path = [];
  for (let i = 0; i <= 15; i++) path.push([500 + i * 20, 400]);
  p.drag(6, path);
  const lifted = orbitOf(p.cam.pose());
  assert.ok(turned(start.yaw, lifted.yaw) < -0.5, `turned: ${start.yaw} → ${lifted.yaw}`);
  assert.ok(near(lifted.pitch, start.pitch, 1e-9), 'a level drag keeps the pitch');
  assert.ok(near(lifted.dist, start.dist, 1e-6), 'and the distance');
  assert.equal(p.cam.want().kind, 'free');
  assert.equal(p.moves(), 1, 'the page is told once when the drag starts moving the camera (it fades the tether)');
  assert.ok(p.gestures.busy(), 'coasting');
  p.tick();
  const coasted = orbitOf(p.cam.pose()).yaw;
  assert.ok(turned(lifted.yaw, coasted) < 0, 'it keeps turning after the lift');
  p.run(4000);
  assert.ok(!p.gestures.busy(), 'and comes to rest');
  const rest = orbitOf(p.cam.pose()).yaw;
  p.run(1000);
  assert.ok(near(orbitOf(p.cam.pose()).yaw, rest, 1e-12), 'at rest it stays');
  assert.ok(turned(coasted, rest) < -0.1, 'the coast carried it on');

  // Dragging down a long way: the pitch stops at the top of its range.
  const tall = [];
  for (let i = 0; i <= 40; i++) tall.push([600, 100 + i * 40]);
  p.drag(7, tall, 200); // slow: no throw
  assert.ok(near(orbitOf(p.cam.pose()).pitch, ORBIT.pitch[1], 1e-6));
});

test('pointer events on the page: a two-finger pinch zooms in toward the fingers, the wheel back out to the overview', () => {
  const p = touchPage();
  const start = orbitOf(p.cam.pose());
  // Two fingers down left of the middle, spreading apart.
  p.stage.dispatch('pointerdown', { pointerId: 11, clientX: 500, clientY: 450 });
  p.stage.dispatch('pointerdown', { pointerId: 12, clientX: 560, clientY: 450 });
  for (let i = 1; i <= 10; i++) {
    p.stage.dispatch('pointermove', { pointerId: 11, clientX: 500 - i * 15, clientY: 450 });
    p.stage.dispatch('pointermove', { pointerId: 12, clientX: 560 + i * 15, clientY: 450 });
    p.tick(200);
  }
  const pinched = orbitOf(p.cam.pose());
  assert.ok(pinched.dist < start.dist * 0.5, `closer: ${start.dist} → ${pinched.dist}`);
  assert.ok(pinched.look.x < 0, 'toward the fingers (left of the middle)');
  assert.ok(near(pinched.yaw, start.yaw, 1e-9), 'a pinch does not turn');
  p.stage.dispatch('pointerup', { pointerId: 11 });
  p.stage.dispatch('pointerup', { pointerId: 12 });
  p.run(3000);

  // Pinch as far as it goes: a close system, no closer.
  p.stage.dispatch('pointerdown', { pointerId: 13, clientX: 790, clientY: 450 });
  p.stage.dispatch('pointerdown', { pointerId: 14, clientX: 810, clientY: 450 });
  p.stage.dispatch('pointermove', { pointerId: 13, clientX: 100, clientY: 450 });
  p.stage.dispatch('pointermove', { pointerId: 14, clientX: 1500, clientY: 450 });
  p.tick(200);
  assert.ok(near(orbitOf(p.cam.pose()).dist, ORBIT.near, 1e-6));
  p.stage.dispatch('pointerup', { pointerId: 13 });
  p.stage.dispatch('pointerup', { pointerId: 14 });
  p.run(3000);

  // The wheel out, a lot: eased (not all at once), then at the overview, centred again.
  const w = p.stage.dispatch('wheel', { deltaY: 300, deltaMode: 0, clientX: 800, clientY: 450 });
  assert.ok(w.defaultPrevented, 'the wheel never zooms or scrolls the page');
  const a = orbitOf(p.tick()).dist;
  const b = orbitOf(p.tick()).dist;
  assert.ok(a > ORBIT.near && b > a, 'it eases out over frames');
  for (let i = 0; i < 10; i++) p.stage.dispatch('wheel', { deltaY: 500, deltaMode: 0, clientX: 800, clientY: 450 });
  p.run(4000);
  const out = orbitOf(p.cam.pose());
  assert.ok(near(out.dist, start.dist, 1), `back at the overview's distance: ${out.dist}`);
  assert.ok(Math.hypot(out.look.x - start.look.x, out.look.z - start.look.z) < 1e-6, 'centred');
});

test('during the tour and the first touch\'s flight, fingers and the wheel move nothing', () => {
  let now = 0;
  const stage = stageEl();
  const galaxy = fakeGalaxy();
  const cam = createGalaxyCamera(galaxy, { steer: true });
  const touch = createTouch(stage, { clock: () => now, wake: () => cam.fit({ ms: TOUCH.fitMs }) });
  const gestures = createGestures(stage, touch, cam, {
    clock: () => now,
    limits: () => orbitLimits(overviewShot(galaxy.world.sites), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
  });
  cam.frame(now);
  stage.dispatch('wheel', { deltaY: 500 });
  gestures.frame(now += 16);
  assert.equal(cam.want().kind, 'overview', 'the tour keeps the camera');
  stage.dispatch('pointerdown', { pointerId: 1, clientX: 100 });
  stage.dispatch('pointerdown', { pointerId: 2, clientX: 100 }); // easing: a second finger
  stage.dispatch('pointermove', { pointerId: 2, clientX: 600 });
  gestures.frame(now += 16);
  assert.equal(cam.want().kind, 'overview', 'the first touch\'s flight is not interrupted');
  assert.ok(!gestures.busy());
  gestures.stop();
  assert.equal(stage.listeners('wheel'), 0);
});

test('galaxy/main.js wires drag and pinch: gestures step before the camera, the steer option on, the tether faded on a move', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createGalaxyCamera\(galaxy, \{[^}]*steer: !park && !reduced,/);
  assert.match(js, /createGestures\(document\.getElementById\('galaxy-stage'\), touch, cam, \{/);
  assert.match(js, /moved: \(\) => tether\.hide\(\)/);
  assert.match(js, /limits: \(\) => orbitLimits\(cam\.home\(\), /);
  assert.match(js, /gestures\?\.frame\(now\);\s*cam\.frame\(now\);/);
});

test('camera home() is the overview it last aimed at, the fitted one where a fitter slides it', () => {
  const galaxy = fakeGalaxy();
  const plain = overviewShot(galaxy.world.sites);
  const slid = (shot) => ({ pos: { ...shot.pos, z: shot.pos.z + 400 }, look: { ...shot.look, z: shot.look.z + 400 } });
  const cam = createGalaxyCamera(galaxy, { steer: true, fitOverview: (shot) => slid(shot) });
  assert.deepEqual(cam.home(), plain, 'before a frame: the plain overview');
  cam.frame(0);
  assert.deepEqual(cam.home(), slid(plain));
  // Wheeled all the way out, a finger lands on that overview, not the plain one.
  const l = orbitLimits(cam.home(), galaxy.world.sites);
  const o = zoomStep({ ...orbitOf(cam.home()), dist: 2000, look: { x: 900, y: 0, z: 0 } }, 1e6, l);
  assert.ok(near(o.look.x, 0) && near(o.look.z, 400) && near(o.dist, l.far));
});

// ---- T10: tap a site ----

test('a tap is a finger: 300 ms, the drag\'s slop, a disc of at least 10 mm (48 css px floor) round each thing', () => {
  assert.equal(TAP.ms, 300);
  assert.equal(TAP.slopPx, ORBIT.slopPx, 'what turns the galaxy is never a tap');
  assert.ok(2 * TAP.radiusPx >= 48, `${2 * TAP.radiusPx} px across`);
});

test('hitTest: a near miss is a miss, a near hit a hit; a drawn sphere bigger than the finger counts whole', () => {
  const pts = [{ id: 'hv1', x: 400, y: 300, r: 4, tone: 'calm', box: null }];
  assert.equal(hitTest(pts, 400 + TAP.radiusPx - 1, 300)?.id, 'hv1');
  assert.equal(hitTest(pts, 400 + TAP.radiusPx + 1, 300), null, 'a near miss');
  assert.equal(hitTest([{ ...pts[0], r: 80 }], 470, 300)?.id, 'hv1', 'inside a big drawn star');
  assert.equal(hitTest([], 1, 1), null);
  assert.equal(hitTest([{ id: 'x', x: NaN, y: 0, tone: 'crit' }], 0, 0), null, 'nothing placed, nothing hit');
});

test('hitTest: a tie goes to the worst status, then to the nearest', () => {
  const calm = { id: 'near-calm', x: 402, y: 300, r: 4, tone: 'calm', box: null };
  const warn = { id: 'far-warn', x: 420, y: 300, r: 4, tone: 'warn', box: null };
  const crit = { id: 'far-crit', x: 380, y: 310, r: 4, tone: 'crit', box: null };
  assert.equal(hitTest([calm, warn], 400, 300)?.id, 'far-warn', 'worse beats nearer');
  assert.equal(hitTest([calm, warn, crit], 400, 300)?.id, 'far-crit');
  const warn2 = { ...warn, id: 'near-warn', x: 405 };
  assert.equal(hitTest([warn, warn2], 400, 300)?.id, 'near-warn', 'same status: the nearest');
  assert.equal(hitTest([warn2, warn], 400, 300)?.id, 'near-warn', 'whatever the order');
});

test('hitTest: a site\'s shown name is a target, wherever on it the finger lands', () => {
  const p = { id: 'hv2', x: 100, y: 100, r: 4, tone: 'calm', box: { x: 130, y: 90, w: 160, h: 24 } };
  assert.equal(hitTest([p], 280, 100)?.id, 'hv2', 'far end of the name, 180 px from the star');
  assert.equal(hitTest([p], 280, 130), null, 'below the name');
  // A finger on a calm site's name beats a calm star it merely brushes (the name counts as 0 away).
  const other = { id: 'hv1', x: 300, y: 100, r: 4, tone: 'calm', box: null };
  assert.equal(hitTest([other, p], 285, 100)?.id, 'hv2');
});

test('isPalm: a contact over TAP.palmPx is a palm; a device that does not measure reports 1, a finger', () => {
  assert.equal(isPalm({ width: 1, height: 1 }), false);
  assert.equal(isPalm({ width: 30, height: 40 }), false);
  assert.equal(isPalm({ width: TAP.palmPx + 1, height: 40 }), true);
  assert.equal(isPalm({ width: 20, height: 200 }), true);
  assert.equal(isPalm({}), false);
});

test('tapPoints: each grown site at its drawn point, in its nebula\'s tone, with its shown name', () => {
  const sites = [
    { id: 'hv1', node: { status: 'ok' }, status: 'crit' }, // calm itself, a crit inside
    { id: 'hv2', node: { status: 'warn' } },
    { id: 'new', node: { status: 'ok' }, alive: 0.2 }, // still growing in
    { id: 'old', node: { status: 'ok' }, gone: true },
    { id: 'behind', node: { status: 'ok' } },
  ];
  const at = { hv1: { x: 10, y: 20, r: 5 }, hv2: { x: 30, y: 40, r: 6 }, new: { x: 0, y: 0, r: 1 }, old: { x: 0, y: 0, r: 1 } };
  const pts = tapPoints(sites, (id) => at[id] ?? null, [{ id: 'hv2', box: { x: 1, y: 2, w: 3, h: 4 } }, { id: 'hv2-a', box: { x: 0, y: 0, w: 9, h: 9 } }]);
  assert.deepEqual(pts, [
    { id: 'hv1', x: 10, y: 20, r: 5, tone: 'crit', box: null },
    { id: 'hv2', x: 30, y: 40, r: 6, tone: 'warn', box: { x: 1, y: 2, w: 3, h: 4 } },
  ]);
  assert.deepEqual(tapPoints(null, () => null), []);
});

test('createTaps: down and up in place is a tap; too long, moved, a second finger, a palm or not exploring is none', () => {
  let now = 0;
  const stage = stageEl();
  const touch = createTouch(stage, { clock: () => now });
  const taps = [];
  const picks = [];
  createTaps(touch, {
    clock: () => now,
    pick: (x, y) => { picks.push([x, y]); return x < 500 ? { id: 'hv1' } : null; },
    tap: (hit, at) => taps.push([hit?.id ?? null, at.x, at.y]),
  });
  const tap = (id, init = {}, { ms = 80, dx = 0 } = {}) => {
    stage.dispatch('pointerdown', { pointerId: id, ...init });
    now += ms;
    if (dx) stage.dispatch('pointermove', { pointerId: id, ...init, clientX: (init.clientX ?? 100) + dx });
    stage.dispatch('pointerup', { pointerId: id, ...init, clientX: (init.clientX ?? 100) + dx });
  };
  tap(1); // the waking touch: reaches nothing
  now += 100;
  tap(2); // easing: no tap yet
  assert.deepEqual(taps, []);
  now += TOUCH.fitMs;
  tap(3, { clientX: 120, clientY: 90 });
  assert.deepEqual(taps, [['hv1', 120, 90]], 'a tap on a site');
  tap(4, { clientX: 900, clientY: 90 });
  assert.deepEqual(taps.at(-1), [null, 900, 90], 'a tap on empty sky is told as null');
  const n = taps.length;
  tap(5, {}, { ms: TAP.ms + 1 });
  tap(6, {}, { dx: TAP.slopPx });
  tap(7, { width: 200, height: 160 });
  // Two fingers down together: a pinch's start, neither is a tap.
  stage.dispatch('pointerdown', { pointerId: 8 });
  stage.dispatch('pointerdown', { pointerId: 9, clientX: 160 });
  stage.dispatch('pointerup', { pointerId: 9, clientX: 160 });
  stage.dispatch('pointerup', { pointerId: 8 });
  assert.equal(taps.length, n, 'held, moved, a palm, a pinch: none a tap');
  tap(10, {}, { dx: TAP.slopPx - 1 });
  assert.equal(taps.length, n + 1, 'a finger that wobbles inside the slop still taps');
  assert.ok(!picks.some(([x]) => x === 160), 'a second finger is never even picked');
});

test('pointer events on the page: a tap on a site\'s screen point flies the camera there and opens it, brackets at once', () => {
  const p = touchPage();
  const opened = [];
  createTaps(p.touch, {
    clock: p.now,
    pick: (x, y) => hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), x, y),
    // As main.js: focus at the tour's zoom, the hud's open (brackets now, plate on arrival).
    tap: (hit) => { if (!hit) return; p.cam.focus(hit.id, DEMO_TIMING.zoom); opened.push({ id: hit.id, at: p.now(), arriveMs: FLIGHT.ms }); },
  });
  p.run(200);
  const sp = p.cam.screenOf('cloud');
  assert.ok(sp && sp.x > 0 && sp.x < 1600 && sp.y > 0 && sp.y < 900, 'cloud is on screen at the overview');
  // A finger 15 px off the star, a short press.
  p.stage.dispatch('pointerdown', { pointerId: 21, clientX: sp.x + 15, clientY: sp.y });
  p.tick(90);
  p.stage.dispatch('pointerup', { pointerId: 21, clientX: sp.x + 15, clientY: sp.y });
  assert.deepEqual(opened.map((o) => o.id), ['cloud']);
  assert.deepEqual([p.cam.want().kind, p.cam.want().id], ['site', 'cloud'], 'the camera flies to it');
  p.run(FLIGHT.ms + 1500);
  assert.ok(p.galaxy.world.byId.get('cloud').open > 0.9, 'and it opens');
  for (const s of ['hv1', 'hv2']) assert.equal(p.galaxy.world.byId.get(s).open, 0, `${s} stays folded`);
  assert.ok(!p.gestures.busy(), 'a tap never turns or zooms the galaxy');
  // Empty sky (the frame's corner): nothing opens.
  p.stage.dispatch('pointerdown', { pointerId: 22, clientX: 5, clientY: 5 });
  p.stage.dispatch('pointerup', { pointerId: 22, clientX: 5, clientY: 5 });
  assert.equal(opened.length, 1);
});

test('the hud opens a tapped site with its brackets at once and its plate when the camera arrives', async () => {
  const { createHud } = await import('../public/js/wall/galaxy/hud.js');
  const shown = [], locked = [], plates = [];
  const timers = fakeTimers();
  const hud = createHud({
    caption: { show: (leg) => shown.push(leg), hide: () => {}, cover: () => null },
    frame: { update: () => {}, plate: (on) => plates.push(on), el: {} },
    lock: { lockOn: (leg) => locked.push(leg), release: () => {} },
    size: () => ({ W: 1600, H: 900 }),
    timers,
  });
  hud.update({ nodes: [{ id: '__core', kind: 'core', status: 'ok' }, { id: 'hv2', kind: 'site', status: 'crit', parent: '__core' }] });
  hud.open({ id: 'hv2', index: 1, count: 1, arriveMs: FLIGHT.ms });
  assert.equal(locked.length, 1);
  assert.equal(locked[0].arriveMs, 0, 'the brackets lock at once');
  assert.equal(locked[0].cut, true, 'taking the box from any lock still opening');
  assert.equal(shown[0].id, 'hv2');
  assert.deepEqual(plates, [false], 'no plate yet');
  assert.deepEqual([...timers.live.values()].map((t) => t.ms), [FLIGHT.ms], 'the plate waits for the camera');
});

test('galaxy/main.js wires taps: sites hit-tested in the stage\'s px, a hit flies there and opens it', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createTaps\(touch, \{/);
  assert.match(js, /hitTest\(tapPoints\(galaxy\.world\?\.sites, cam\.screenOf, labels\.shown\(\)\), x - o\.left, y - o\.top\)/);
  const open = js.slice(js.indexOf('const openSite = '), js.indexOf('};', js.indexOf('const openSite = ')));
  assert.match(open, /cam\.focus\(id, TIMING\.zoom\)/);
  assert.match(open, /hud\.open\(\{[^}]*arriveMs: FLIGHT\.ms \}\)/);
  assert.match(open, /tether\.hide\(\)/);
});

test('memberPoints (T11): the members of an open system only, at their drawn points, in their own tone', () => {
  const sites = [
    { id: 'hv1', open: 1, members: [{ id: 'hv1-a', node: { status: 'crit' } }, { id: 'hv1-b', node: { status: 'ok' } }, { id: 'hv1-z', node: { status: 'ok' } }] },
    { id: 'hv2', open: 0.3, members: [{ id: 'hv2-a', node: { status: 'ok' } }] }, // still folding: not yet
    { id: 'old', open: 1, gone: true, members: [{ id: 'old-a', node: { status: 'ok' } }] },
  ];
  const at = { 'hv1-a': { x: 10, y: 10, r: 4 }, 'hv1-b': { x: 40, y: 10, r: 2 }, 'hv2-a': { x: 0, y: 0, r: 1 }, 'old-a': { x: 0, y: 0, r: 1 } };
  const pts = memberPoints(sites, (id) => at[id] ?? null, [{ id: 'hv1-b', box: { x: 50, y: 0, w: 40, h: 20 } }]);
  assert.deepEqual(pts, [
    { id: 'hv1-a', site: 'hv1', x: 10, y: 10, r: 4, tone: 'crit', box: null },
    { id: 'hv1-b', site: 'hv1', x: 40, y: 10, r: 2, tone: 'calm', box: { x: 50, y: 0, w: 40, h: 20 } },
  ]);
  assert.equal(hitTest(pts, 25, 10).id, 'hv1-a', 'between two planets: the worst wins');
  assert.equal(hitTest(pts, 80, 10).id, 'hv1-b', 'its shown name is a target');
  assert.deepEqual(memberPoints(null, () => null), []);
});

test('pointer events on the page: in an open system a tap on a planet opens the planet, not its star', () => {
  const p = touchPage();
  const opened = [];
  const pick = (x, y) => hitTest(memberPoints(p.galaxy.world.sites, p.cam.screenOf), x, y)
    ?? hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), x, y);
  createTaps(p.touch, {
    clock: p.now,
    pick,
    // As main.js: a planet's sheet where the camera is; a site flies.
    tap: (hit) => { if (hit?.site) opened.push(['planet', hit.id]); else if (hit) { p.cam.focus(hit.id, DEMO_TIMING.zoom); opened.push(['site', hit.id]); } },
  });
  p.run(200);
  // At the overview no system is open: a finger on a member's point is the site's.
  const tapAt = (id, sp) => {
    p.stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y });
    p.tick(60);
    p.stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y });
  };
  tapAt(31, p.cam.screenOf('cloud'));
  assert.deepEqual(opened, [['site', 'cloud']]);
  p.galaxy.setOpen('cloud', 1);
  p.run(FLIGHT.ms + 500);
  const planet = p.cam.screenOf('cloud-a');
  assert.ok(planet && planet.x > 0 && planet.x < 1600 && planet.y > 0 && planet.y < 900, 'the planet is on screen');
  const want = p.cam.want();
  tapAt(32, planet);
  assert.deepEqual(opened.at(-1), ['planet', 'cloud-a']);
  assert.deepEqual(p.cam.want(), want, 'the camera stays where it is');
});

test('galaxy/main.js wires planet taps (T11): members asked before sites, a planet opens where the camera is', () => {
  const js = read('js/wall/galaxy/main.js');
  const pick = js.slice(js.indexOf('pick: (x, y) =>'), js.indexOf('tap: (hit)'));
  assert.ok(pick.indexOf('memberPoints(') >= 0 && pick.indexOf('memberPoints(') < pick.indexOf('tapPoints('), 'members first');
  assert.match(js, /const openPlanet = \(id\) => hud\.open\(\{ id, arriveMs: 0 \}\)/);
  assert.match(js, /tap: \(hit\) => \{ if \(hit\?\.site\) openPlanet\(hit\.id\); else if \(hit\) openSite\(hit\.id\); \}/);
});
