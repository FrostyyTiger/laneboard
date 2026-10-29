// Back returns to the person's pose, never to a show's (Wall plan night 5 C5,
// T14; touch.js createReturn). A finger turns the overview to an explore pose;
// a show (the cockpit's flyTo or fitNodes) then flies the camera elsewhere and
// ends; the person taps a site and presses Back: the camera flies to the
// explore pose, not to where the show left it. The page: the large demo on the
// real scene with a fake renderer, stage and clock, the touch, gestures, taps,
// back control, director and camera wired as main.js wires them (its
// toOverview, openSite and goBack copied; `director.onMove(left.moved)` pinned
// against main.js's source below).
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { ZOOM_OUT, createDirector } from '../public/js/wall/galaxy/director.js';
import { freeRect } from '../public/js/wall/galaxy/framing.js';
import {
  AT_OVERVIEW, TOUCH, backControl, backStep, canGoBack, createBack, createGestures, createReturn, createTaps, createTouch,
  hitNearest, orbitLimits, placeOf, tapPoints,
} from '../public/js/wall/galaxy/touch.js';
import { TIMING } from '../public/js/wall/tour.js';
import { makeEl } from './helpers/fakedom.mjs';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const W = 1368, H = 912;
const WORDS = [{ left: 110, top: 70, right: 780, bottom: 570 }, { left: 990, top: 90, right: 1285, bottom: 135 }, { left: 670, top: 690, right: 1285, bottom: 840 }];

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

function listening(tag) {
  const el = makeEl(tag);
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, init = {}) => {
    const ev = { type, pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, ...init, preventDefault() {}, stopPropagation() {} };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  return el;
}

const gap = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)
  + Math.hypot(a.look.x - b.look.x, a.look.y - b.look.y, a.look.z - b.look.z);

/** The page on the large demo in `explore` at the overview, wired as main.js. */
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
  const stage = listening('main');
  const button = listening('button');
  const touch = createTouch(stage, { clock: () => now, role: 'explore' });
  let place = AT_OVERVIEW;
  const left = createReturn();
  director.onMove(left.moved);
  // main.js's, as written there.
  const toOverview = (pose = null, out = { ms: TOUCH.fitMs }) => {
    if (pose) finger.fly(pose, out);
    else finger.fit(out);
    place = AT_OVERVIEW;
  };
  const openSite = (id) => {
    left.leave(place, cam);
    const w = cam.want();
    const there = w.kind === 'site' && w.id === id && w.member == null;
    if (!there) finger.focus(id, TIMING.zoom);
    place = placeOf(id);
  };
  const goBack = () => {
    touch.poke();
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'overview') toOverview(left.pose(), ZOOM_OUT);
  };
  const back = createBack(button, { back: goBack, tour: () => {} });
  const gestures = createGestures(stage, touch, finger, {
    clock: () => now,
    limits: () => orbitLimits(cam.home(), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
    pivot: () => {
      const w = cam.want();
      return w.kind === 'site' ? galaxy.world.byId.get(w.id)?.home ?? null : null;
    },
  });
  createTaps(touch, {
    clock: () => now,
    pick: (x, y) => hitNearest(tapPoints(galaxy.world.sites, cam.screenOf), x, y),
    tap: (hit) => { if (hit && !hit.site && !hit.covered) openSite(hit.id); },
    back: () => goBack(),
  });
  const tick = (ms = 16) => {
    now += ms;
    back.show(backControl(touch.mode(), place));
    director.tick();
    gestures.frame(now);
    cam.frame(now);
    galaxy.frame(now);
  };
  const run = (ms) => { for (let t = 0; t < ms; t += 16) tick(16); };
  const tapAt = (id, sp) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y });
    tick(60);
    stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y });
  };
  const press = () => {
    for (const type of ['pointerdown', 'pointerup']) button.dispatch(type, { pointerId: 90 });
    button.dispatch('click');
  };
  const drag = (id, from, dx, dy, steps = 20) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: from.x, clientY: from.y });
    for (let i = 1; i <= steps; i++) {
      stage.dispatch('pointermove', { pointerId: id, clientX: from.x + (dx * i) / steps, clientY: from.y + (dy * i) / steps });
      tick(16);
    }
    stage.dispatch('pointerup', { pointerId: id, clientX: from.x + dx, clientY: from.y + dy });
  };
  // Explore: the overview turned by a finger, the coast run out.
  const explore = () => {
    run(200);
    drag(5, { x: 300, y: 800 }, 260, -40);
    run(5200); // the coast (night 5 C4: τ 650 ms) runs out
    assert.equal(cam.want().kind, 'free', 'a finger has turned the overview');
    return cam.pose();
  };
  // A show's camera move, as main.js's `show(to)` makes it, run until it lands.
  const show = (to) => {
    director.show({ id: 'cmd-1', to });
    run(FLIGHT.ms + 2500);
    assert.equal(director.driver(), 'show');
    assert.equal(cam.flight(), null, 'the show has landed');
  };
  // A tap on a site from wherever the show left the camera, its system opened, then Back.
  const tapSiteThenBack = (id) => {
    tapAt(10, cam.screenOf(id));
    run(FLIGHT.ms + OPEN_MS + 200);
    assert.deepEqual([place.level, place.site], ['site', id], `${id} opened by the tap`);
    press();
    run(ZOOM_OUT.ms + 400);
    assert.equal(place, AT_OVERVIEW);
    return cam.pose();
  };
  return { galaxy, cam, director, left, run, drag, explore, show, tapSiteThenBack, place: () => place };
}

test('createReturn: a show\'s moves never become the explore pose; a finger\'s do (T14)', () => {
  const P = { pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } };
  const S = { pos: { x: 9, y: 9, z: 9 }, look: { x: 5, y: 5, z: 5 } };
  const camAt = (pose, kind = 'free') => ({ want: () => ({ kind }), pose: () => pose });
  const r = createReturn();
  r.moved({ source: 'touch', call: 'steer', args: [P] });
  r.moved({ source: 'show', call: 'place', args: [S] });
  r.leave(AT_OVERVIEW, camAt(S));
  assert.deepEqual(r.pose(), P, 'a fitNodes pose is not kept: the finger\'s is');
  r.moved({ source: 'show', call: 'focus', args: ['lab', 2.3] });
  r.leave(AT_OVERVIEW, camAt(S, 'site'));
  assert.deepEqual(r.pose(), P, 'a flyTo to a site: the finger\'s pose still');
  // A turn round a held star is no overview pose; a finger's fit is the fit.
  r.moved({ source: 'touch', call: 'steer', args: [S, { hold: true }] });
  r.moved({ source: 'show', call: 'place', args: [S] });
  r.leave(AT_OVERVIEW, camAt(S));
  assert.deepEqual(r.pose(), P);
  r.moved({ source: 'touch', call: 'fit', args: [] });
  r.moved({ source: 'show', call: 'place', args: [S] });
  r.leave(AT_OVERVIEW, camAt(S));
  assert.equal(r.pose(), null, 'after a finger\'s fit and a show: back to the fit');
  // The finger after the show: its own pose again (as before T14).
  r.moved({ source: 'show', call: 'place', args: [S] });
  r.moved({ source: 'touch', call: 'steer', args: [S] });
  r.leave(AT_OVERVIEW, camAt(S));
  assert.deepEqual(r.pose(), S);
  // Never left from inside a system; clear forgets the explore pose too.
  r.leave(placeOf('lab'), camAt(P));
  assert.deepEqual(r.pose(), S);
  r.clear();
  r.moved({ source: 'show', call: 'place', args: [S] });
  r.leave(AT_OVERVIEW, camAt(S));
  assert.equal(r.pose(), null);
  // Without `moved` (no director wired): as night 4's.
  const old = createReturn();
  old.leave(AT_OVERVIEW, camAt(S));
  assert.deepEqual(old.pose(), S);
  old.leave(AT_OVERVIEW, camAt(S, 'overview'));
  assert.equal(old.pose(), null);
});

test('the page: explore, a show fitNodes elsewhere and ends, a site, Back → the explore pose (T14)', () => {
  const p = page();
  const mine = p.explore();
  // The show's free pose (fitNodes, setCamera): the fit, a third of the way in, lab still in sight.
  const home = p.cam.home();
  const S = { pos: { x: home.pos.x + (home.look.x - home.pos.x) / 3, y: home.pos.y + (home.look.y - home.pos.y) / 3, z: home.pos.z + (home.look.z - home.pos.z) / 3 }, look: { ...home.look } };
  p.show({ kind: 'free', pose: S });
  assert.ok(p.cam.screenOf('lab'), 'lab is on screen from the show\'s pose');
  assert.ok(gap(p.cam.pose(), S) < 1, 'the camera is where the show put it');
  assert.ok(gap(S, mine) > 500, 'and that is far from the explore pose');
  const back = p.tapSiteThenBack('lab');
  assert.ok(gap(back, mine) < 1, `Back lands on the explore pose (off by ${gap(back, mine).toFixed(2)})`);
  assert.ok(gap(back, S) > 500, 'not on the show\'s');
});

test('the page: a show flyTo a site and ends, a site, Back → the explore pose, not the fit (T14)', () => {
  const p = page();
  const mine = p.explore();
  const fit = p.cam.home();
  const other = p.galaxy.world.sites.find((s) => s.id !== 'lab' && !s.gone);
  p.show({ kind: 'site', id: other.id, zoom: TIMING.zoom });
  const back = p.tapSiteThenBack('lab');
  assert.ok(gap(back, mine) < 1, `Back lands on the explore pose (off by ${gap(back, mine).toFixed(2)})`);
  assert.ok(gap(back, fit) > 1, 'not on the fit');
});

test('the page: with no show between, Back still returns to the explore pose (night 4 T4)', () => {
  const p = page();
  const mine = p.explore();
  const back = p.tapSiteThenBack('lab');
  assert.ok(gap(back, mine) < 1);
});

test('galaxy/main.js hears the director for the return (T14)', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(js, /const left = createReturn\(\);\n\s*director\.onMove\(left\.moved\)/);
});
