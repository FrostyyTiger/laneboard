// Touch, the tour resumes (Wall plan night 3 T14, README §7 Night 3 C5): a
// minute after the last touch the tour takes the page back at its next leg,
// trouble first, the camera easing there from where the finger left it; in
// reduced motion every step is a cut with a short fade. The page's touch path
// (stage → createTouch → gestures, taps, back → camera, tour) on one fake
// clock, wired as galaxy/main.js wires it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeEl } from './helpers/fakedom.mjs';
import {
  AT_OVERVIEW, IDLE, TOUCH, backShown, backStep, canGoBack, createBack, createGestures, createTaps, createTouch,
  hitTest, memberPoints, orbitLimits, placeOf, tapPoints, touchStep,
} from '../public/js/wall/galaxy/touch.js';
import { DEMO_TIMING, TIMING, createTour, initialTour, nextLeg, resumeTour } from '../public/js/wall/tour.js';
import { FLIGHT, createGalaxyCamera, zoomedSiteShot } from '../public/js/wall/galaxy/camera.js';
import { CUT, STILL_DEMO_TOUR_TIMING, createCutFade, cutFade } from '../public/js/wall/galaxy/still.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
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
  return el;
}

/** Timers on the page's fake clock: `run()` fires those due. */
function clockTimers(clock) {
  const live = new Map();
  let n = 0;
  return {
    live,
    setTimeout: (fn, ms) => { live.set(++n, { fn, at: clock() + ms }); return n; },
    clearTimeout: (h) => live.delete(h),
    run: () => { for (const [h, t] of [...live]) if (t.at <= clock()) { live.delete(h); t.fn(); } },
  };
}

/** Three calm sites but hv2, whose room is crit: the tour's worst. */
const NODES = (() => {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud']) {
    nodes.push({ id: s, kind: 'site', status: 'ok', parent: '__core' });
    nodes.push({ id: `${s}-a`, kind: 'room', status: s === 'hv2' ? 'crit' : 'ok', parent: s });
  }
  return nodes;
})();

function fakeGalaxy() {
  const lay = galaxyLayout(NODES);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0,
    members: s.members.map((m) => ({ id: m.id, node: m.node, mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z) } })),
  }));
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(42, 16 / 9, 1, 30000),
    renderer: { domElement: { clientWidth: 1600, clientHeight: 900 } },
    size: () => ({ W: 1600, H: 900 }),
  };
}

const gap = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);

/**
 * The page as galaxy/main.js builds it: the tour on the camera, the touch
 * with wake and resume, gestures (not in reduced motion), taps, the back
 * control and, in reduced motion, the cut's fade on the canvas and the names.
 * `sheets` records the hud: a site's or planet's id for a sheet, null when it goes.
 */
function page({ still = false } = {}) {
  let now = 100_000;
  const clock = () => now;
  const timers = clockTimers(clock);
  const stage = stageEl();
  const button = stageEl();
  const canvas = makeEl('canvas');
  const names = makeEl('div');
  const galaxy = fakeGalaxy();
  const cam = createGalaxyCamera(galaxy, { still, steer: !still });
  const tour = createTour(cam, { timing: still ? STILL_DEMO_TOUR_TIMING : DEMO_TIMING, timers });
  tour.update({ nodes: NODES });
  const legs = [];
  tour.onLeg((leg) => legs.push(leg));
  const sheets = [];
  const fade = still ? createCutFade([canvas, names], { clock }) : null;
  let place = AT_OVERVIEW;
  let wakes = 0;
  const cutAway = () => { if (fade && cam.want().cut) fade.cut(); };
  const toOverview = () => {
    cutAway();
    cam.fit({ ms: TOUCH.fitMs });
    sheets.push(null);
    place = AT_OVERVIEW;
  };
  const touch = createTouch(stage, {
    clock,
    wake: () => { wakes++; tour.stop(); toOverview(); },
    resume: () => { cutAway(); sheets.push(null); place = AT_OVERVIEW; tour.resume(); },
  });
  const gestures = still ? null : createGestures(stage, touch, cam, {
    clock,
    limits: () => orbitLimits(cam.home(), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
  });
  const openSite = (id) => {
    const w = cam.want();
    const there = w.kind === 'site' && w.id === id && (!still || w.cut);
    if (!there && still) { cam.cut(id, TIMING.zoom); fade.cut(); } else if (!there) cam.focus(id, TIMING.zoom);
    sheets.push(id);
    place = placeOf(id);
  };
  const openPlanet = (id, site) => { sheets.push(id); place = placeOf(site, id); };
  const goBack = () => {
    touch.poke();
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'site') openSite(next.site);
    else toOverview();
  };
  const back = createBack(button, { back: goBack });
  createTaps(touch, {
    clock,
    pick: (x, y) => hitTest(memberPoints(galaxy.world.sites, cam.screenOf), x, y)
      ?? hitTest(tapPoints(galaxy.world.sites, cam.screenOf), x, y),
    tap: (hit) => { if (hit?.site) openPlanet(hit.id, hit.site); else if (hit) openSite(hit.id); else goBack(); },
  });
  const tick = (ms = 16) => {
    now += ms;
    timers.run();
    const m = touch.mode();
    back.show(backShown(m, place));
    gestures?.frame(now);
    const pose = cam.frame(now);
    fade?.frame(now);
    return pose;
  };
  const run = (ms) => { let p; for (let t = 0; t < ms; t += 16) p = tick(16); return p; };
  const tapAt = (id, sp) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y });
    tick(60);
    stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y });
  };
  const drag = (id, pts) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: pts[0][0], clientY: pts[0][1] });
    for (const [x, y] of pts.slice(1)) { stage.dispatch('pointermove', { pointerId: id, clientX: x, clientY: y }); tick(16); }
    stage.dispatch('pointerup', { pointerId: id, clientX: pts.at(-1)[0], clientY: pts.at(-1)[1] });
  };
  const press = () => {
    for (const type of ['pointerdown', 'pointerup']) button.dispatch(type, { pointerId: 90 });
    button.dispatch('click');
  };
  return {
    stage, button, canvas, names, galaxy, cam, tour, touch, timers, legs, sheets, back,
    tick, run, tapAt, drag, press, now: clock, place: () => place, wakes: () => wakes,
  };
}

test('the tour takes the page back one minute after the last touch (Q6, Q13: 30-60 s)', () => {
  assert.equal(IDLE.ms, 60000);
});

test('touchStep: explore → tour after IDLE.ms untouched (resume, once); a touch, a held finger or easing keeps the person\'s', () => {
  const t0 = 10_000;
  const woke = touchStep(null, 'down', t0).state;
  // Easing never hands back, however long: the camera is still flying out.
  assert.equal(touchStep(woke, 'tick', t0 + TOUCH.fitMs - 1, { idleMs: 1 }).resume, false);
  const out = touchStep(woke, 'tick', t0 + TOUCH.fitMs).state;
  assert.equal(out.mode, 'explore');
  // The minute counts from the waking touch.
  assert.equal(touchStep(out, 'tick', t0 + IDLE.ms - 1).resume, false);
  const back = touchStep(out, 'tick', t0 + IDLE.ms);
  assert.deepEqual([back.state.mode, back.resume, back.wake, back.swallow], ['tour', true, false, false]);
  assert.equal(touchStep(back.state, 'tick', t0 + 2 * IDLE.ms).resume, false, 'once: the tour has it');
  // A touch 50 s in starts the minute again; so does a down, a move, a lift or the wheel ('touch').
  for (const ev of ['down', 'touch']) {
    const later = touchStep(out, ev, t0 + 50_000).state;
    assert.equal(touchStep(later, 'tick', t0 + IDLE.ms + 1000).resume, false, ev);
    assert.equal(touchStep(later, 'tick', t0 + 50_000 + IDLE.ms).resume, true, ev);
  }
  // A finger resting on the glass is a touch going on.
  assert.equal(touchStep(out, 'tick', t0 + 5 * IDLE.ms, { held: true }).resume, false);
  // The next down after the hand-back wakes the page again.
  assert.equal(touchStep(back.state, 'down', t0 + IDLE.ms + 10).wake, true);
});

test('resumeTour: the tour comes back at its worst site (trouble first), not the overview nor the calm site that was due', () => {
  const nodes = NODES;
  // A tour that stopped on a calm site, hv2 (crit) already seen this cycle.
  let s = initialTour();
  for (let i = 0; i < 3; i++) s = nextLeg(s, nodes, DEMO_TIMING).state;
  assert.deepEqual(s.visited, ['hv2', 'hv1']);
  const r = resumeTour(s, nodes);
  assert.equal(r.cycle, s.cycle + 1);
  const leg = nextLeg(r, nodes, DEMO_TIMING).leg;
  assert.deepEqual([leg.kind, leg.id, leg.index, leg.count], ['site', 'hv2', 1, 3]);
});

test('createTour.resume: a stopped tour starts at resumeTour\'s leg; a running one is left alone', () => {
  let now = 0;
  const timers = clockTimers(() => now);
  const calls = [];
  const tour = createTour({ focus: (id) => calls.push(id), fit: () => calls.push('fit') }, { timing: DEMO_TIMING, timers });
  tour.update({ nodes: NODES });
  tour.start();
  now += DEMO_TIMING.overviewMs; timers.run();
  now += DEMO_TIMING.flyMs + DEMO_TIMING.holdMs; timers.run();
  assert.deepEqual(calls, ['fit', 'hv2', 'hv1']);
  tour.stop();
  tour.resume();
  assert.deepEqual(calls.at(-1), 'hv2', 'trouble first');
  assert.equal(timers.live.size, 1, 'its next leg waiting');
  tour.resume();
  assert.equal(calls.length, 4, 'already running: nothing');
});

test('camera cut: on the site\'s shot from the next frame, open at once, no flight; fit() cuts back out, folded at once', () => {
  const galaxy = fakeGalaxy();
  const cam = createGalaxyCamera(galaxy, { still: true });
  const over = cam.frame(1000);
  cam.focus('hv1');
  assert.ok(gap(cam.frame(1500), over) < 1e-6, 'the tour\'s focus keeps a still camera on the overview');
  cam.cut('hv1', TIMING.zoom);
  const p = cam.frame(1516);
  assert.equal(cam.flight(), null, 'no flight');
  assert.ok(gap(p, zoomedSiteShot(galaxy.world.byId.get('hv1'), 0, TIMING.zoom)) < 1e-6, 'on hv1\'s shot');
  assert.equal(galaxy.world.byId.get('hv1').open, 1, 'its system open at once');
  assert.ok(gap(cam.frame(9000), p) < 1e-6, 'no drift');
  cam.fit({ ms: TOUCH.fitMs });
  assert.ok(gap(cam.frame(9016), over) < 1e-6, 'back on the overview');
  assert.equal(galaxy.world.byId.get('hv1').open, 0, 'folded at once');
});

test('cutFade: from 0 at the cut to 1 by CUT.fadeMs, eased out; createCutFade sets opacity, then clears it', () => {
  assert.ok(CUT.fadeMs >= 200 && CUT.fadeMs <= 400, `short: ${CUT.fadeMs} ms`);
  assert.equal(cutFade(null), 1);
  assert.equal(cutFade(0), 0);
  assert.equal(cutFade(CUT.fadeMs), 1);
  assert.ok(cutFade(CUT.fadeMs / 2) > 0.5, 'eased out: most of the way by half time');
  let prev = -1;
  for (let ms = 0; ms <= CUT.fadeMs; ms += 20) { assert.ok(cutFade(ms) >= prev); prev = cutFade(ms); }
  let now = 0;
  const a = makeEl('canvas'), b = makeEl('div');
  const fade = createCutFade([a, b, null], { clock: () => now });
  fade.frame(now);
  assert.equal(a.style.opacity, undefined, 'untouched before a cut');
  fade.cut();
  fade.frame(now += 16);
  assert.ok(Number(a.style.opacity) < 0.2 && a.style.opacity === b.style.opacity);
  fade.frame(now += CUT.fadeMs);
  assert.deepEqual([a.style.opacity, b.style.opacity, fade.fading()], ['', '', false]);
});

test('pointer events on the page: touch → overview → drag → tap a site → detail → back → 60 s → the tour resumes', () => {
  const p = page();
  p.tour.start();
  p.run(DEMO_TIMING.overviewMs + 1000);
  assert.equal(p.legs.at(-1).id, 'hv2', 'the tour holds its crit');
  // Touch: the tour stops, the camera eases out.
  p.stage.dispatch('pointerdown', { pointerId: 1 });
  p.stage.dispatch('pointerup', { pointerId: 1 });
  assert.equal(p.timers.live.size, 0, 'the tour stopped');
  p.run(TOUCH.fitMs + 100);
  assert.equal(p.touch.mode(), 'explore');
  // Drag: the finger's pose.
  p.drag(2, [[800, 450], [830, 450], [900, 460], [960, 470]]);
  p.run(1500);
  assert.equal(p.cam.want().kind, 'free');
  // Tap a site: it flies there, its sheet.
  p.tapAt(3, p.cam.screenOf('hv1'));
  p.tick(16);
  assert.deepEqual([p.cam.want().kind, p.cam.want().id, p.sheets.at(-1)], ['site', 'hv1', 'hv1']);
  p.run(FLIGHT.ms + 1500);
  assert.ok(p.galaxy.world.byId.get('hv1').open > 0.9, 'the detail: hv1 open');
  assert.equal(p.button.hidden, false);
  // Back: out to the overview.
  p.press();
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  assert.equal(p.sheets.at(-1), null);
  p.run(TOUCH.fitMs + 500);
  const legs = p.legs.length;
  // Almost a minute: still the person's.
  p.run(IDLE.ms - TOUCH.fitMs - 3000);
  assert.equal(p.touch.mode(), 'explore');
  assert.equal(p.legs.length, legs, 'no leg while the minute runs');
  const before = p.cam.pose();
  // The minute is up: the tour flies on from here, trouble first.
  p.run(3000);
  assert.equal(p.touch.mode(), 'tour');
  assert.equal(p.legs.length, legs + 1);
  assert.deepEqual([p.legs.at(-1).kind, p.legs.at(-1).id], ['site', 'hv2'], 'its worst site first');
  assert.deepEqual([p.cam.want().kind, p.cam.want().id], ['site', 'hv2']);
  assert.ok(p.cam.flight(), 'a flight, not a cut');
  assert.equal(p.button.hidden, true, 'the back control goes with the person');
  assert.equal(p.timers.live.size, 1, 'the tour runs on');
  // Eased from where it was: the first frames of the flight stay by the pose the person left.
  const i = p.sheets.lastIndexOf(null);
  assert.equal(i, p.sheets.length - 1, 'the sheet went');
  assert.ok(gap(p.cam.pose(), before) < 0.05 * gap(before, zoomedSiteShot(p.galaxy.world.byId.get('hv2'), 0, DEMO_TIMING.zoom)), 'no cut');
  // The next touch is a first touch again.
  p.stage.dispatch('pointerdown', { pointerId: 9 });
  p.stage.dispatch('pointerup', { pointerId: 9 });
  assert.equal(p.wakes(), 2);
  assert.equal(p.timers.live.size, 0);
});

test('pointer events on the page: a touch within the minute keeps it the person\'s; so does a press on the back control', () => {
  const p = page();
  p.tour.start();
  p.run(500);
  p.stage.dispatch('pointerdown', { pointerId: 1 });
  p.stage.dispatch('pointerup', { pointerId: 1 });
  p.run(TOUCH.fitMs + 100);
  p.tapAt(2, p.cam.screenOf('cloud'));
  p.run(IDLE.ms - 5000);
  p.press(); // its pointers never reach the stage: it pokes the touch itself
  p.run(10_000);
  assert.equal(p.touch.mode(), 'explore', 'the press started the minute again');
  p.stage.dispatch('wheel', { deltaY: 100 });
  p.run(IDLE.ms - 1000);
  assert.equal(p.touch.mode(), 'explore', 'so did the wheel');
  p.run(2000);
  assert.equal(p.touch.mode(), 'tour');
});

test('reduced motion on the page: every step a cut with a short fade, no flights, no drag; the tour resumes', () => {
  const p = page({ still: true });
  p.tour.start();
  const over = p.run(STILL_DEMO_TOUR_TIMING.overviewMs + 500);
  assert.equal(p.legs.at(-1).id, 'hv2', 'the caption on the crit, the camera on the overview');
  p.stage.dispatch('pointerdown', { pointerId: 1 });
  p.stage.dispatch('pointerup', { pointerId: 1 });
  p.run(TOUCH.fitMs + 100);
  assert.equal(p.touch.mode(), 'explore');
  assert.equal(p.canvas.style.opacity, undefined, 'the camera did not move: no fade');
  // A drag turns nothing.
  p.drag(2, [[800, 450], [900, 460], [1000, 470]]);
  assert.ok(gap(p.run(500), over) < 1e-6, 'no drag in reduced motion');
  // Tap a site: a cut, the scene fading in, the system open at once.
  p.tapAt(3, p.cam.screenOf('hv1'));
  const at = p.tick(16);
  assert.equal(p.cam.flight(), null);
  assert.ok(gap(at, zoomedSiteShot(p.galaxy.world.byId.get('hv1'), 0, TIMING.zoom)) < 1, 'on hv1 at once');
  assert.equal(p.galaxy.world.byId.get('hv1').open, 1);
  assert.equal(p.sheets.at(-1), 'hv1');
  assert.ok(Number(p.canvas.style.opacity) < 1 && p.names.style.opacity === p.canvas.style.opacity, 'fading in');
  p.run(CUT.fadeMs + 50);
  assert.equal(p.canvas.style.opacity, '', 'the fade is over');
  // A planet: its sheet, the camera stays, no fade.
  p.tapAt(4, p.cam.screenOf('hv1-a'));
  p.tick(16);
  assert.deepEqual([p.sheets.at(-1), p.place().level, p.canvas.style.opacity], ['hv1-a', 'planet', '']);
  // Back, back: the system's sheet where the camera is, then a cut out.
  p.press();
  p.tick(16);
  assert.deepEqual([p.sheets.at(-1), p.canvas.style.opacity], ['hv1', ''], 'no camera move, no fade');
  p.press();
  const out = p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  assert.ok(gap(out, over) < 1, 'on the overview at once');
  assert.equal(p.galaxy.world.byId.get('hv1').open, 0, 'folded at once');
  assert.ok(Number(p.canvas.style.opacity) < 1, 'fading in');
  // Into a site again and left there: the hand-back is a cut too.
  p.tapAt(5, p.cam.screenOf('cloud'));
  p.run(IDLE.ms - 1000);
  assert.equal(p.touch.mode(), 'explore');
  const legs = p.legs.length;
  p.run(1500);
  assert.equal(p.touch.mode(), 'tour');
  assert.deepEqual([p.legs.length, p.legs.at(-1).id], [legs + 1, 'hv2'], 'the tour at its worst site');
  const back = p.tick(16);
  assert.ok(gap(back, over) < 1, 'the camera on the overview, as the still tour has it');
  assert.equal(p.galaxy.world.byId.get('cloud').open, 0);
  assert.ok(Number(p.canvas.style.opacity) < 1, 'with a fade');
  for (let t = 0; t < 30; t++) p.tick(16);
  assert.equal(p.cam.flight(), null, 'never a flight');
});

test('galaxy/main.js wires the hand-back (T14): resume releases the sheet and resumes the tour; cuts and the fade in reduced motion', () => {
  const js = read('js/wall/galaxy/main.js');
  const resume = js.slice(js.indexOf('resume: () => {'), js.indexOf('},', js.indexOf('resume: () => {')));
  for (const rx of [/cutAway\(\)/, /hud\.release\(\)/, /place = AT_OVERVIEW/, /tour\.resume\(\)/]) assert.match(resume, rx);
  assert.match(js, /createCutFade\(\[canvas, document\.getElementById\('galaxy-labels'\)\]\)/);
  const open = js.slice(js.indexOf('const openSite = '), js.indexOf('};', js.indexOf('const openSite = ')));
  assert.match(open, /cam\.cut\(id, TIMING\.zoom\)/);
  assert.match(open, /fade\?\.cut\(\)/);
  const go = js.slice(js.indexOf('const goBack = '), js.indexOf('};', js.indexOf('const goBack = ')));
  assert.match(go, /touch\?\.poke\(\)/, 'a press on the control counts as a touch');
  assert.match(js, /const back = touch \? createBack\(/, 'back in reduced motion too');
  assert.match(js, /const taps = touch \? createTaps\(/, 'taps in reduced motion too');
  assert.match(js, /const gestures = touch && !reduced \? createGestures\(/, 'no drag in reduced motion');
  assert.match(js, /fade\?\.frame\(now\);/);
});
