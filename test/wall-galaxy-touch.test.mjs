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
  AT_OVERVIEW, BACK, COVERED, ORBIT, TAP, TOUCH, atRest, backShown, backStep, beamSegments, canGoBack, coverHit, createBack, createGestures, createTaps,
  createTouch, hitTest, inertia, isPalm, orbitLimits, orbitOf, memberPoints, orbitPose, orbitStep, placeOf, planeAt,
  tapPoints, touchStep, zoomStep,
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
  assert.deepEqual(a, { state: { mode: 'easing', since: t0, last: t0 }, wake: true, swallow: true, resume: false });
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
  // T13: the way out to the overview is shared with the back control.
  assert.match(wake, /toOverview\(\)/);
  const out = js.slice(js.indexOf('const toOverview = '), js.indexOf('};', js.indexOf('const toOverview = ')));
  assert.match(out, /finger\.fit\(\{ ms: TOUCH\.fitMs \}\)/);
  assert.match(out, /hud\.release\(\)/);
  // A new model does not start a stopped tour again (T14 brings it back).
  assert.match(js, /if \(!park && touch\?\.mode\(\) === 'tour' && director\.driver\(\) === 'tour'\) tour\.start\(\);/);
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
  assert.equal(p.moves(), 1, 'the page is told once when the drag starts moving the camera (for what belongs to the overview pose)');
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
  touch.stop(); // the touch hears the wheel too, as a touch that keeps the tour away (T14)
  assert.equal(stage.listeners('wheel'), 0);
});

test('galaxy/main.js wires drag and pinch: gestures step before the camera, the steer option on, no tether (T16)', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createGalaxyCamera\(galaxy, \{[^}]*steer: !park && !reduced,/);
  assert.match(js, /createGestures\(document\.getElementById\('galaxy-stage'\), touch, finger, \{/);
  assert.doesNotMatch(js, /createTether|tether\.(show|hide)/, 'no banner-to-node tether at the overview (T16)');
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
  assert.match(js, /hitTest\(tapPoints\(galaxy\.world\?\.sites, cam\.screenOf, labels\.shown\(\), beams\), x - o\.left, y - o\.top\)/);
  const open = js.slice(js.indexOf('const openSite = '), js.indexOf('};', js.indexOf('const openSite = ')));
  assert.match(open, /finger\.focus\(id, TIMING\.zoom\)/);
  assert.match(open, /hud\.open\(\{[^}]*arriveMs: there \|\| reduced \? 0 : FLIGHT\.ms \}\)/, 'a cut (reduced motion, T14) has its plate at once');
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
    { id: 'hv1-a', site: 'hv1', x: 10, y: 10, r: 4, tone: 'crit', box: null, node: { status: 'crit' } },
    { id: 'hv1-b', site: 'hv1', x: 40, y: 10, r: 2, tone: 'calm', box: { x: 50, y: 0, w: 40, h: 20 }, node: { status: 'ok' } },
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
  assert.match(js, /const openPlanet = \(id, site\) => \{\s*hud\.open\(\{ id, arriveMs: 0 \}\);/);
  assert.match(js, /if \(hit\?\.covered\) return; if \(hit\?\.site\) openPlanet\(hit\.id, hit\.site\); else if \(hit\) openSite\(hit\.id\); else goBack\(\);/);
});

// ---- T13: back ----

test('backStep: a planet → its system → the overview, which stays; only away from the overview is there a step', () => {
  const planet = placeOf('hv2', 'gpu-box');
  assert.deepEqual({ ...planet }, { level: 'planet', site: 'hv2', planet: 'gpu-box' });
  const site = backStep(planet);
  assert.deepEqual({ ...site }, { level: 'site', site: 'hv2', planet: null });
  assert.equal(backStep(site), AT_OVERVIEW);
  assert.equal(backStep(AT_OVERVIEW), AT_OVERVIEW);
  assert.equal(backStep(null), AT_OVERVIEW);
  assert.equal(placeOf(), AT_OVERVIEW);
  assert.deepEqual([planet, site, AT_OVERVIEW, null].map(canGoBack), [true, true, false, false]);
  // The control: only while exploring, never in the tour or the first touch's flight.
  for (const mode of ['tour', 'easing']) assert.equal(backShown(mode, site), false, mode);
  assert.equal(backShown('explore', site), true);
  assert.equal(backShown('explore', AT_OVERVIEW), false, 'nothing to go back to');
});

test('createBack: hidden until shown, a press steps back only while shown, its pointers never reach the stage', () => {
  const button = stageEl();
  button.hidden = false; // as if galaxy.html forgot its `hidden`
  let backs = 0;
  const b = createBack(button, { back: () => { backs++; } });
  assert.equal(button.hidden, true, 'absent at first: the tour');
  assert.equal(button.dispatch('click').defaultPrevented, true);
  assert.equal(backs, 0, 'a hidden control does nothing');
  b.show(true);
  assert.equal(button.hidden, false);
  assert.equal(b.shown(), true);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.equal(button.dispatch(type).stopped, true, `${type} stays on the control`);
  }
  button.dispatch('click');
  assert.equal(backs, 1);
  b.show(false);
  assert.equal(button.hidden, true);
  b.stop();
  assert.equal(button.listeners('click') + button.listeners('pointerdown'), 0);
});

/** touchPage with taps and the back control wired as main.js wires them (openSite, openPlanet, goBack). */
function backPage(words = null) {
  const p = touchPage();
  const button = stageEl();
  const sheets = [];
  let place = AT_OVERVIEW;
  const openSite = (id) => {
    const w = p.cam.want();
    const there = w.kind === 'site' && w.id === id;
    if (!there) p.cam.focus(id, DEMO_TIMING.zoom);
    sheets.push(id);
    place = placeOf(id);
  };
  const openPlanet = (id, site) => { sheets.push(id); place = placeOf(site, id); };
  const goBack = () => {
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'site') openSite(next.site);
    else { p.cam.fit({ ms: TOUCH.fitMs }); sheets.push(null); place = AT_OVERVIEW; }
  };
  const back = createBack(button, { back: goBack });
  // A press on the control's own element: its pointers stop there, the click steps back.
  const press = () => {
    for (const type of ['pointerdown', 'pointerup']) {
      const ev = button.dispatch(type, { pointerId: 90 });
      if (!ev.stopped) p.stage.dispatch(type, { pointerId: 90 }); // would bubble to the stage
    }
    button.dispatch('click');
  };
  createTaps(p.touch, {
    clock: p.now,
    // As main.js (night 4 T1): the words over the canvas first, when the page has any.
    pick: (x, y) => (words ? coverHit(words.covers, words.rows, p.galaxy.world.sites, x, y, place.site) : null)
      ?? hitTest(memberPoints(p.galaxy.world.sites, p.cam.screenOf), x, y)
      ?? hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), x, y),
    tap: (hit) => { if (hit?.covered) return; if (hit?.site) openPlanet(hit.id, hit.site); else if (hit) openSite(hit.id); else goBack(); },
  });
  const tick = (ms) => { const r = p.tick(ms); back.show(backShown(p.touch.mode(), place)); return r; };
  const run = (ms) => { for (let t = 0; t < ms; t += 16) tick(16); };
  const tapAt = (id, sp) => {
    p.stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y });
    tick(60);
    p.stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y });
  };
  // Into cloud's system and onto its planet.
  const into = () => {
    run(200);
    tapAt(41, p.cam.screenOf('cloud'));
    run(FLIGHT.ms + 1500);
    assert.ok(p.galaxy.world.byId.get('cloud').open > 0.9, 'cloud is open');
    tapAt(42, p.cam.screenOf('cloud-a'));
    tick(16);
    assert.deepEqual(sheets.slice(-2), ['cloud', 'cloud-a']);
  };
  return { ...p, button, back, sheets, press, tapAt, tick, run, into, place: () => place };
}

test('pointer events on the page: the back control walks planet → system → overview, and is absent at the overview', () => {
  const p = backPage();
  assert.equal(p.button.hidden, true, 'not at the overview');
  p.into();
  assert.equal(p.button.hidden, false, 'shown in an open system');
  const want = p.cam.want();
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.sheets.at(-1)], ['site', 'cloud'], 'the planet\'s sheet gives way to its system\'s');
  assert.deepEqual(p.cam.want(), want, 'the camera stays on the system');
  assert.equal(p.button.hidden, false);
  p.press();
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  assert.equal(p.sheets.at(-1), null, 'the sheet closes with its step');
  assert.deepEqual([p.cam.want().kind, p.cam.want().ms], ['overview', TOUCH.fitMs], 'the camera eases out');
  assert.equal(p.button.hidden, true, 'gone at the overview');
  p.run(TOUCH.fitMs + 1500);
  assert.equal(p.galaxy.world.byId.get('cloud').open, 0, 'the system folded');
  const n = p.sheets.length;
  p.press();
  assert.equal(p.sheets.length, n, 'a hidden control does nothing');
  assert.ok(!p.gestures.busy(), 'pressing the control never turned the galaxy');
});

test('pointer events on the page: a tap on empty sky walks planet → system → overview, then does nothing', () => {
  const p = backPage();
  p.into();
  const sky = { x: 5, y: 5 };
  assert.equal(hitTest(memberPoints(p.galaxy.world.sites, p.cam.screenOf), sky.x, sky.y), null, 'the corner is empty sky');
  assert.equal(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), sky.x, sky.y), null);
  p.tapAt(51, sky);
  p.tick(16);
  assert.deepEqual([p.place().level, p.sheets.at(-1)], ['site', 'cloud']);
  assert.equal(p.cam.want().id, 'cloud');
  p.tapAt(52, sky);
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  assert.equal(p.cam.want().kind, 'overview');
  p.run(TOUCH.fitMs + 200);
  const n = p.sheets.length, want = p.cam.want();
  p.tapAt(53, sky);
  p.tick(16);
  assert.equal(p.sheets.length, n, 'at the overview empty sky does nothing');
  assert.deepEqual(p.cam.want(), want);
});

test('pointer events on the page: back from a system the finger turned away from flies back to it', () => {
  const p = backPage();
  p.into();
  // Drag: the camera's pose is the finger's now, the system folds.
  p.drag(61, [[800, 450], [830, 450], [900, 460], [960, 470]]);
  p.run(2000);
  assert.equal(p.cam.want().kind, 'free');
  p.press();
  p.tick(16);
  assert.deepEqual([p.cam.want().kind, p.cam.want().id], ['site', 'cloud'], 'the system is flown to again');
});

test('the back control: in galaxy.html, hidden, its hit size at least BACK.hitPx (Q6: 15 mm) in wall.css', () => {
  assert.ok(BACK.hitPx >= 79, 'Q6: 15 mm on the tablet is 79 css px');
  const html = read('galaxy.html');
  const tag = html.match(/<button[^>]*id="galaxy-back"[^>]*>/)?.[0] ?? '';
  assert.match(tag, /\shidden[\s>]/, 'absent until a finger explores');
  assert.match(tag, /type="button"/);
  assert.ok(html.indexOf('id="galaxy-back"') > html.indexOf('id="wall-caption"'), 'over the words');
  const css = read('css/wall.css');
  const rule = css.match(/\n\.galaxy-back \{([^}]*)\}/)?.[1] ?? '';
  for (const side of ['min-width', 'min-height']) {
    const px = Number(rule.match(new RegExp(`${side}: (\\d+)px;`))?.[1]);
    assert.ok(px >= BACK.hitPx, `${side} ${px}px`);
  }
  assert.match(rule, /color: var\(--text-2\);/, 'grey: nothing needs you');
  assert.match(css, /\.galaxy-back\[hidden\] \{ display: none; \}/);
});

test('galaxy/main.js wires back (T13): the control and an empty-sky tap step back, shown only while exploring', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createBack\(backEl, \{\s*back: goBack, tour: handBack,/);
  assert.match(js, /back\?\.show\(backControl\(m, place\)\);/, 'back away from the overview, ▶ TOUR at it (night 4 T5)');
  const go = js.slice(js.indexOf('const goBack = '), js.indexOf('};', js.indexOf('const goBack = ')));
  assert.match(go, /backStep\(place\)/);
  assert.match(go, /openSite\(next\.site\)/);
  assert.match(go, /toOverview\(left\.pose\(\)\)/, 'to the pose the finger left (night 4 T4), else the fit');
  const wake = js.slice(js.indexOf('wake: () => {'), js.indexOf('},', js.indexOf('wake: () => {')));
  assert.match(wake, /toOverview\(\)/);
  const out = js.slice(js.indexOf('const toOverview = '), js.indexOf('};', js.indexOf('const toOverview = ')));
  for (const rx of [/finger\.fit\(\{ ms: TOUCH\.fitMs \}\)/, /hud\.release\(\)/, /place = AT_OVERVIEW/]) assert.match(out, rx);
});

// ---- night 4 T1: the words are not sky ----

test('coverHit: inside a cover is COVERED, off every box null, a row naming a member is that member', () => {
  const sites = [
    { id: 'hv1', members: [{ id: 'hv1-a' }, { id: 'hv1-b' }] },
    { id: 'old', gone: true, members: [{ id: 'old-a' }] },
  ];
  const plate = { left: 40, top: 40, right: 400, bottom: 300 };
  const clock = { left: 40, top: 800, right: 300, bottom: 880 };
  const rows = [
    { id: 'hv1-b', box: { left: 60, top: 200, right: 380, bottom: 240 } },
    { id: 'hv1', box: { left: 60, top: 100, right: 380, bottom: 160 } }, // the site itself: no member
    { id: 'old-a', box: { left: 60, top: 250, right: 380, bottom: 290 } }, // a gone site's
  ];
  assert.deepEqual(coverHit([plate, clock], rows, sites, 100, 220), { id: 'hv1-b', site: 'hv1' });
  assert.equal(coverHit([plate, clock], rows, sites, 100, 120), COVERED, 'a row on no member opens nothing');
  assert.equal(coverHit([plate, clock], rows, sites, 100, 270), COVERED);
  assert.equal(coverHit([plate, clock], rows, sites, 390, 60), COVERED, 'the plate\'s padding');
  assert.equal(coverHit([plate, clock], rows, sites, 100, 850), COVERED, 'the clock');
  assert.equal(coverHit([plate, clock], rows, sites, 800, 450), null, 'the sky: the scene decides');
  assert.equal(coverHit(null, null, null, 1, 1), null);
});

test('pointer events on the page: with a sheet up a tap on the plate over a star opens nothing; a member row opens it', () => {
  const words = { covers: [], rows: [] };
  const p = backPage(words);
  p.into();
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.sheets.at(-1)], ['site', 'cloud'], 'cloud\'s sheet is up');
  // The plate stands over cloud's star and its planet, and over a corner of empty sky.
  const star = p.cam.screenOf('cloud'), planet = p.cam.screenOf('cloud-a');
  assert.ok(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), star.x, star.y)?.id === 'cloud', 'a star under the plate');
  const left = Math.min(star.x, planet.x, 5) - 40, top = Math.min(star.y, planet.y, 5) - 40;
  words.covers = [{ left, top, right: Math.max(star.x, planet.x) + 40, bottom: Math.max(star.y, planet.y) + 40 }];
  const n = p.sheets.length, want = p.cam.want(), place = p.place();
  for (const [i, at] of [star, planet, { x: 5, y: 5 }].entries()) {
    p.tapAt(70 + i, at);
    p.tick(16);
    assert.equal(p.sheets.length, n, `tap ${i}: no sheet`);
    assert.deepEqual(p.cam.want(), want, `tap ${i}: no flight`);
    assert.equal(p.place(), place, `tap ${i}: no back step`);
  }
  // A row naming the planet, laid on the plate over the star: the finger opens the planet.
  words.rows = [{ id: 'cloud-a', box: { left: star.x - 30, top: star.y - 10, right: star.x + 30, bottom: star.y + 10 } }];
  p.tapAt(75, star);
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().planet, p.sheets.at(-1)], ['planet', 'cloud-a', 'cloud-a']);
  assert.deepEqual(p.cam.want(), want, 'the camera stays: a planet opens where it is');
  // A row naming another site's member opens that one.
  words.rows = [{ id: 'hv1-a', box: { left: star.x - 30, top: star.y - 10, right: star.x + 30, bottom: star.y + 10 } }];
  p.tapAt(76, star);
  p.tick(16);
  assert.deepEqual([p.place().site, p.place().planet], ['hv1', 'hv1-a']);
});

test('galaxy/main.js wires the words (night 4 T1): coverHit before the scene, a covered hit opens nothing', () => {
  const js = read('js/wall/galaxy/main.js');
  const pick = js.slice(js.indexOf('pick: (x, y) =>'), js.indexOf('tap: (hit)'));
  assert.ok(pick.indexOf('coverHit([...hud.covers(), ...touchCovers()], rows,') >= 0 && pick.indexOf('coverHit(') < pick.indexOf('memberPoints('), 'the words first');
  assert.match(pick, /hud\.targets\(\)/);
  assert.match(js, /tap: \(hit\) => \{[^}]*\}\s*fan\?\.hide\(\);\s*if \(hit\?\.covered\) return;/);
});

// ---- night 4 T2: the loudest thing is a target ----

test('coverHit: the fleet line (a step row) opens its site first, the planet once that site is open; +N more nothing', () => {
  const sites = [
    { id: 'hv1', members: [{ id: 'hv1-a' }, { id: 'hv1-b' }] },
    { id: 'hv2', members: [{ id: 'hv2-a' }] },
  ];
  const line = { left: 900, top: 760, right: 1560, bottom: 860 };
  const more = { left: 1400, top: 830, right: 1500, bottom: 860 };
  const rows = [{ id: null, box: more }, { id: 'hv2-a', step: true, box: line }];
  assert.deepEqual(coverHit([line], rows, sites, 1000, 800), { id: 'hv2' }, 'at the overview: its site');
  assert.deepEqual(coverHit([line], rows, sites, 1000, 800, 'hv1'), { id: 'hv2' }, 'under another site\'s sheet: its site');
  assert.deepEqual(coverHit([line], rows, sites, 1000, 800, 'hv2'), { id: 'hv2-a', site: 'hv2' }, 'its site open: the planet');
  assert.equal(coverHit([line], rows, sites, 1450, 845), COVERED, '+N more opens nothing yet');
  assert.equal(coverHit([line], rows, sites, 1450, 845, 'hv2'), COVERED);
  const siteRow = [{ id: 'hv1', step: true, box: line }];
  assert.deepEqual(coverHit([line], siteRow, sites, 1000, 800), { id: 'hv1' }, 'a site in trouble itself: that site');
  assert.equal(coverHit([line], [{ id: 'gone-x', step: true, box: line }], sites, 1000, 800), COVERED, 'a subject on no site');
  assert.equal(coverHit([line], rows, sites, 100, 100), null, 'off the words: the scene decides');
});

test('pointer events on the page: a tap on the fleet line opens its subject\'s site, a second tap its planet', () => {
  const words = { covers: [], rows: [] };
  const p = backPage(words);
  p.run(200);
  // The line stands in the frame's bottom right corner, over empty sky; its +N more at its right end.
  const line = { left: 1000, top: 780, right: 1580, bottom: 880 };
  const more = { left: 1480, top: 850, right: 1570, bottom: 878 };
  assert.equal(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), 1100, 820), null, 'no star under the line');
  words.covers = [line];
  words.rows = [{ id: null, box: more }, { id: 'cloud-a', step: true, box: line }];
  const n = p.sheets.length;
  p.tapAt(81, { x: 1520, y: 865 });
  p.tick(16);
  assert.equal(p.sheets.length, n, '+N more: no sheet');
  assert.equal(p.place(), AT_OVERVIEW, 'and no step');
  p.tapAt(82, { x: 1100, y: 820 });
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().site, p.sheets.at(-1)], ['site', 'cloud', 'cloud'], 'its site\'s sheet');
  assert.deepEqual([p.cam.want().kind, p.cam.want().id], ['site', 'cloud'], 'the camera flies there');
  p.run(FLIGHT.ms + 1500);
  const want = p.cam.want();
  p.tapAt(83, { x: 1100, y: 820 });
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().planet, p.sheets.at(-1)], ['planet', 'cloud-a', 'cloud-a'], 'then the planet');
  assert.deepEqual(p.cam.want(), want, 'where the camera is');
});

test('the hud gives the fleet line as a target only while it is up: its subject, step, the +N more first with none', async () => {
  const { createHud } = await import('../public/js/wall/galaxy/hud.js');
  const rect = (left, top, right, bottom) => () => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const fleet = makeEl('div');
  fleet.dataset.step = 'far';
  fleet.dataset.subject = 'hv2-a';
  fleet.getBoundingClientRect = rect(1000, 780, 1580, 880);
  const more = makeEl('span');
  more.hidden = true;
  more.getBoundingClientRect = rect(0, 0, 0, 0);
  const subMore = makeEl('span');
  subMore.getBoundingClientRect = rect(1480, 850, 1570, 878);
  let far = { left: 1000, top: 780, right: 1580, bottom: 880 };
  const hud = createHud({
    caption: { show: () => {}, hide: () => {}, cover: () => null, targets: () => [{ id: 'hv1-a', box: { left: 40, top: 40, right: 300, bottom: 80 } }] },
    frame: { update: () => {}, plate: () => {}, cover: () => far, hushed: () => false, el: { fleet, more, subMore } },
    size: () => ({ W: 1600, H: 900 }),
    timers: fakeTimers(),
  });
  assert.deepEqual(hud.targets(), [
    { id: null, box: { left: 1480, top: 850, right: 1570, bottom: 878 } },
    { id: 'hv2-a', step: true, box: { left: 1000, top: 780, right: 1580, bottom: 880 } },
    { id: 'hv1-a', box: { left: 40, top: 40, right: 300, bottom: 80 } },
  ]);
  far = null; // the line dropped (calm, or an echo under the plate)
  fleet.dataset.step = 'calm';
  assert.deepEqual(hud.targets().map((t) => t.id), ['hv1-a'], 'no line, no target');
});

test('fx=beacon: a finger on the pillar\'s top hits its site, past the star\'s own disc', () => {
  const p = touchPage();
  p.run(200);
  const site = p.galaxy.world.byId.get('hv2');
  const foot = p.cam.screenOf('hv2');
  // A pillar standing over hv2 as scene.js beams() gives it, tall enough to reach well past the finger's disc.
  let h = 1;
  while (p.cam.screenAt({ x: site.home.x, y: site.home.y + h, z: site.home.z }).y > foot.y - 4 * TAP.radiusPx) h *= 1.5;
  const beams = [{ id: 'hv2', foot: { ...site.home }, tip: { x: site.home.x, y: site.home.y + h, z: site.home.z } }];
  const segs = beamSegments(beams, p.cam.screenAt);
  assert.equal(segs.length, 1);
  assert.ok(Math.abs(segs[0].x0 - foot.x) < 1e-6 && Math.abs(segs[0].y0 - foot.y) < 1e-6, 'its foot is the star');
  const top = { x: segs[0].x1, y: segs[0].y1 + 4 };
  assert.ok(Math.hypot(top.x - foot.x, top.y - foot.y) > TAP.radiusPx * 3, 'the top is far off the star');
  assert.notEqual(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf), top.x, top.y)?.id, 'hv2', 'without the beam: not hv2');
  assert.equal(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf, [], segs), top.x, top.y)?.id, 'hv2', 'with it: hv2');
  const mid = { x: (segs[0].x0 + segs[0].x1) / 2 + TAP.radiusPx - 2, y: (segs[0].y0 + segs[0].y1) / 2 };
  assert.equal(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf, [], segs), mid.x, mid.y)?.id, 'hv2', 'beside it, within reach');
  const off = { x: segs[0].x1 + TAP.radiusPx + 6, y: segs[0].y1 };
  assert.notEqual(hitTest(tapPoints(p.galaxy.world.sites, p.cam.screenOf, [], segs), off.x, off.y)?.id, 'hv2', 'past reach: a miss');
  assert.deepEqual(beamSegments([{ id: 'x', foot: { x: 0, y: 0, z: 0 }, tip: { x: 0, y: 0, z: 1 } }], () => null), [], 'behind the camera');
  assert.deepEqual(beamSegments(null, p.cam.screenAt), []);
});

test('galaxy/main.js wires the fleet line and the pillar (night 4 T2): rows keep their step, beams only with fx=beacon', () => {
  const js = read('js/wall/galaxy/main.js');
  const pick = js.slice(js.indexOf('pick: (x, y) =>'), js.indexOf('tap: (hit)'));
  assert.match(pick, /\.\.\.r, box:/, 'a row keeps its step');
  assert.match(pick, /coverHit\(\[\.\.\.hud\.covers\(\), \.\.\.touchCovers\(\)\], rows, galaxy\.world\?\.sites, x - o\.left, y - o\.top, place\.site\)/);
  assert.match(pick, /fx\.has\('beacon'\) \? beamSegments\(galaxy\.beams\?\.\(\), cam\.screenAt\) : \[\]/);
  const scene = read('js/wall/galaxy/scene.js');
  assert.match(scene, /const beams = \(\) => pillars/);
  assert.match(scene, /drawn, planets, beams, frame,/, 'the scene hands it out');
});
