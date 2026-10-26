// Touch, the first touch (Wall plan night 3 T7, README §7 Night 3 C1, C6):
// galaxy/touch.js on a fake clock. The first touch stops the tour and fits the
// camera once, in TOUCH.fitMs; nothing under it is handled; the page blocks
// scroll, pinch-zoom and the context menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeEl } from './helpers/fakedom.mjs';
import { TOUCH, createTouch, touchStep } from '../public/js/wall/galaxy/touch.js';
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
