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
  ORBIT, TOUCH, atRest, createGestures, createTouch, inertia, orbitLimits, orbitOf, orbitPose, orbitStep, planeAt,
  touchStep, zoomStep,
} from '../public/js/wall/galaxy/touch.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
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
