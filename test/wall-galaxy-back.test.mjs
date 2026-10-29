// Back, one step at a time (Wall plan night 5 C3, T13): moon → planet →
// system → overview, by a right-click, a double tap (or double-click) on empty
// sky, or the Back control. Back from a moon keeps the camera (a moon's shot
// is its planet's); from a planet its moons fold and the camera stays where
// the finger turned it, else it eases out to the system's hold; from a system
// out to the overview. Every zoom-out is director.js ZOOM_OUT: 3000 ms on
// smootherstep. The page: the large demo on the real scene with a fake
// renderer, stage and clock, wired as main.js wires it
// (test/helpers/galaxy-page.mjs; its openSite, openPlanet, backToSite and
// goBack copies pinned against main.js's source below).
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS, smoother } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { HANDOVER, ZOOM_OUT, directorStep, initialDirector } from '../public/js/wall/galaxy/director.js';
import {
  AT_OVERVIEW, TAP, TOUCH, backControl, backStep, canGoBack, createGestures, createTaps, createTouch, memberPoints, moonsAt,
  placeOf,
} from '../public/js/wall/galaxy/touch.js';
import { TIMING } from '../public/js/wall/tour.js';
import { BA, SKY, W, flown, listening, page, samePose } from './helpers/galaxy-page.mjs';

test('ZOOM_OUT: 3000 ms on smootherstep, twice the wake\'s ease out, which stays TOUCH.fitMs; a finger\'s soft move says so', () => {
  assert.deepEqual({ ...ZOOM_OUT }, { ms: 3000, soft: true });
  assert.ok(Object.isFrozen(ZOOM_OUT));
  assert.equal(HANDOVER.fitMs, 1500, 'the wake (B237\'s minute counts from it)');
  assert.equal(TOUCH.fitMs, 1500);
  assert.equal(smoother(0.5), 0.5);
  const s = { driver: 'touch', since: 0, last: 0, show: null };
  const r = directorStep(s, { type: 'touch', to: { kind: 'overview' }, ms: ZOOM_OUT.ms, soft: true }, 10);
  assert.deepEqual([r.move.ms, r.move.soft], [3000, true]);
  assert.equal(directorStep(s, { type: 'touch', to: { kind: 'overview' }, ms: 1500 }, 10).move.soft, undefined, 'a tap stays cubic');
  const still = directorStep(s, { type: 'touch', to: { kind: 'overview' }, ms: 3000, soft: true }, 10, { still: true });
  assert.deepEqual([still.move.ms, still.move.cut], [0, true], 'reduced motion: a cut');
  assert.equal(directorStep(initialDirector(), { type: 'touch', soft: true }, 0).move.ms, HANDOVER.fitMs, 'a wake is the wake');
});

test('places: a moon is its own step (moon → planet → system → overview), its ring its planet\'s', () => {
  const moon = placeOf('lab', BA, 'lane:builder-a/fix-login');
  assert.deepEqual({ ...moon }, { level: 'moon', site: 'lab', planet: BA, moon: 'lane:builder-a/fix-login' });
  assert.ok(canGoBack(moon));
  assert.equal(moonsAt(moon), BA, 'its planet\'s ring stays open');
  const planet = backStep(moon);
  assert.deepEqual({ ...planet }, { level: 'planet', site: 'lab', planet: BA });
  assert.equal(moonsAt(planet), BA);
  const site = backStep(planet);
  assert.deepEqual({ ...site }, { level: 'site', site: 'lab', planet: null });
  assert.equal(moonsAt(site), null, 'folded');
  assert.equal(backStep(site), AT_OVERVIEW);
  assert.equal(backControl('explore', moon), 'back');
  assert.deepEqual({ ...placeOf('lab', BA) }, { ...planet }, 'two arguments are a planet, as before');
});

test('createTaps: a right-click is Back wherever it lands and however long, never a pick or a tap; a double tap on empty sky is Back', () => {
  let now = 0;
  const stage = listening('main');
  const touch = createTouch(stage, { clock: () => now, role: 'explore' });
  const told = [];
  let picks = 0;
  createTaps(touch, {
    clock: () => now,
    pick: (x) => { picks += 1; return x > 500 ? { id: 'hv1' } : null; },
    tap: (hit) => told.push(['tap', hit?.id ?? null]),
    back: (at) => told.push(['back', at.kind]),
  });
  const tap = (id, x, y, init = {}, ms = 60) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: x, clientY: y, ...init });
    now += ms;
    stage.dispatch('pointerup', { pointerId: id, clientX: x, clientY: y, ...init });
  };
  const right = { pointerType: 'mouse', button: 2 };
  tap(1, 600, 100, right);
  assert.deepEqual(told.splice(0), [['back', 'right']], 'over a site too: Back');
  assert.equal(picks, 0, 'nothing picked');
  tap(2, 100, 100, right, 900);
  assert.deepEqual(told.splice(0), [['back', 'right']], 'a slow right-click is still Back');
  stage.dispatch('pointerdown', { pointerId: 3, clientX: 100, clientY: 100, ...right });
  stage.dispatch('pointermove', { pointerId: 3, clientX: 140, clientY: 100, ...right });
  stage.dispatch('pointerup', { pointerId: 3, clientX: 140, clientY: 100, ...right });
  assert.deepEqual(told.splice(0), [], 'a right drag is nothing');
  // Double taps on empty sky.
  now += 1000;
  tap(4, 100, 100);
  now += 150;
  tap(5, 110, 105);
  assert.deepEqual(told.splice(0), [['tap', null], ['back', 'double']], 'the first is a tap on empty sky, the second Back');
  now += 1000;
  tap(6, 100, 100);
  now += TAP.doubleMs + 10;
  tap(7, 100, 100);
  assert.deepEqual(told.splice(0), [['tap', null], ['tap', null]], 'too slow: two single taps');
  now += 1000;
  tap(8, 100, 100);
  now += 100;
  tap(9, 100 + TAP.doublePx, 100);
  assert.deepEqual(told.splice(0), [['tap', null], ['tap', null]], 'too far apart: two single taps');
  now += 1000;
  tap(10, 600, 100);
  now += 100;
  tap(11, 600, 100);
  assert.deepEqual(told.splice(0), [['tap', 'hv1'], ['tap', 'hv1']], 'on a thing: two taps, no Back');
  now += 1000;
  tap(12, 100, 100);
  now += 100;
  tap(13, 100, 100);
  now += 100;
  tap(14, 100, 100);
  assert.deepEqual(told.splice(0), [['tap', null], ['back', 'double'], ['tap', null]], 'a third tap starts again');
  // A mouse's double-click is the same two pointer taps.
  now += 1000;
  tap(15, 100, 100, { pointerType: 'mouse' });
  now += 120;
  tap(16, 100, 100, { pointerType: 'mouse' });
  assert.deepEqual(told.splice(0), [['tap', null], ['back', 'double']]);
});

test('createGestures: a right-button drag never turns the camera', () => {
  let now = 0;
  const stage = listening('main');
  const touch = createTouch(stage, { clock: () => now, role: 'explore' });
  const steered = [];
  const cam = { pose: () => ({ pos: { x: 0, y: 1000, z: 1000 }, look: { x: 0, y: 0, z: 0 } }), steer: (p) => steered.push(p) };
  const g = createGestures(stage, touch, cam, { clock: () => now, limits: () => ({ near: 10, far: 1e5 }), view: () => ({ W, H, fov: 42 }) });
  stage.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'mouse', button: 2 });
  for (let i = 1; i <= 10; i++) { now += 16; stage.dispatch('pointermove', { pointerId: 1, clientX: 100 + i * 20, clientY: 100, pointerType: 'mouse', button: 2 }); g.frame(now); }
  stage.dispatch('pointerup', { pointerId: 1, clientX: 300, clientY: 100, pointerType: 'mouse', button: 2 });
  g.frame(now + 16);
  assert.equal(steered.length, 0);
  assert.ok(!g.busy());
});

test('page: the walk moon → planet → system → overview, one Back kind each: right-click, double tap, the control; the turned pose kept, every zoom-out 3000 ms soft', () => {
  const p = page();
  p.toBuilder();
  // Turn the picked planet's system: the finger's pose.
  const star = p.cam.screenOf('lab');
  p.drag(20, { x: 700, y: 450 }, 160, 40);
  p.run(2500);
  assert.ok(p.cam.want().turned, 'turned round lab\'s star');
  // A calm moon on builder-a's open ring.
  const ring = memberPoints(p.galaxy.world.sites, p.cam.screenOf).filter((q) => q.host === BA && q.onRing);
  assert.ok(ring.length >= 2, `builder-a's ring has moons (${ring.length})`);
  const moon = ring.find((q) => q.tone === 'calm') ?? ring[0];
  const m0 = p.moves.length;
  p.tapAt(21, moon);
  p.tick(16);
  assert.equal(p.moves.length, m0, 'a tap on the framed planet\'s moon keeps the turned camera');
  assert.deepEqual([p.place().level, p.place().moon, p.place().planet], ['moon', moon.id, BA], 'the moon is picked');
  p.run(FLIGHT.ms + 200);
  assert.equal(p.galaxy.moonsOpen(), BA, 'its planet\'s ring stays open');
  const turned = p.cam.pose();
  assert.ok(p.isSky(SKY), 'the corner is empty sky');

  // 1. A right-click: moon → planet. The camera stays.
  const n = p.moves.length;
  p.rightClick(30, SKY);
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().planet], ['planet', BA]);
  assert.deepEqual([p.card.selected(), p.sheets.at(-1)], [BA, null], 'the planet\'s card, no sheet (night 5 T17)');
  assert.equal(p.moves.length, n, 'no camera move');
  assert.equal(p.galaxy.moonsOpen(), BA, 'the ring stays open');

  // 2. A double tap on empty sky: planet → system. Its moons fold, the camera stays where it was turned.
  p.doubleTap(31, SKY);
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().site], ['site', 'lab']);
  assert.deepEqual([p.sheets.at(-1), p.card.selected()], [null, 'lab'], 'the system\'s card, no sheet (T19b)');
  assert.equal(p.galaxy.moonsOpen(), null, 'builder-a\'s moons fold');
  assert.equal(p.moves.length, n, 'no camera move');
  p.run(1000);
  assert.ok(samePose(p.cam.pose(), turned, 1e-6), 'the pose the finger turned it to');
  assert.equal(p.cam.want().id, 'lab');
  assert.ok(p.galaxy.world.byId.get('lab').open > 0.99, 'the system stays open');
  const s2 = p.cam.screenOf('lab');
  assert.ok(Math.hypot(s2.x - star.x, s2.y - star.y) < 2, 'the star where it stood');

  // 3. The Back control: system → overview, 3000 ms on smootherstep.
  assert.equal(p.button.hidden, false);
  p.press();
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  const out = p.moves.at(-1);
  assert.deepEqual([out.call, out.args[0]], ['fit', { ms: ZOOM_OUT.ms, soft: true }]);
  assert.deepEqual([p.cam.want().kind, p.cam.want().ms, p.cam.want().soft], ['overview', 3000, true]);
  const t = 16 + flown(p);
  assert.ok(t >= ZOOM_OUT.ms - 32 && t <= ZOOM_OUT.ms + 32, `flew ${t} ms`);
  p.run(OPEN_MS + 200);
  assert.equal(p.galaxy.world.byId.get('lab').open, 0, 'folded at the overview');
  assert.equal(p.button.dataset.kind, 'tour', 'the control is ▶ TOUR at the overview');
});

test('page: Back from a planet not turned eases out to the system\'s hold in 3000 ms, a double-click from the system out to the overview in 3000 ms', () => {
  const p = page();
  p.toBuilder();
  const pick = p.cam.pose();
  const mouse = { pointerType: 'mouse' };
  assert.ok(p.isSky(SKY));
  p.doubleTap(40, SKY, mouse);
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().site], ['site', 'lab']);
  assert.equal(p.galaxy.moonsOpen(), null, 'its moons fold');
  const w = p.cam.want();
  assert.deepEqual([w.kind, w.id, w.member, w.ms, w.soft], ['site', 'lab', undefined, 3000, true], 'out to the hold');
  let mid = null;
  const t = 16 + flown(p, 6000);
  assert.ok(t >= ZOOM_OUT.ms - 32 && t <= ZOOM_OUT.ms + 32, `flew ${t} ms`);
  assert.ok(!samePose(p.cam.pose(), pick, 1), 'not the pick framing');
  const lab = p.galaxy.world.byId.get('lab').home;
  const dist = (q) => Math.hypot(q.pos.x - lab.x, q.pos.y - lab.y, q.pos.z - lab.z);
  assert.ok(dist(p.cam.pose()) > dist(pick) * 1.4, `zoomed out (${dist(pick).toFixed(0)} → ${dist(p.cam.pose()).toFixed(0)})`);
  assert.ok(p.galaxy.world.byId.get('lab').open > 0.99, 'held and open');
  mid = p.moves.length;
  p.run(TAP.doubleMs + 50);
  p.doubleTap(42, SKY, mouse);
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW, 'double-click from a system: the overview');
  assert.equal(p.moves.length, mid + 1);
  assert.deepEqual([p.cam.want().kind, p.cam.want().ms, p.cam.want().soft], ['overview', 3000, true]);
  const t2 = 16 + flown(p);
  assert.ok(t2 >= ZOOM_OUT.ms - 32 && t2 <= ZOOM_OUT.ms + 32, `flew ${t2} ms`);
});

test('page: a single tap on empty sky and a right-click at the overview do nothing', () => {
  const p = page();
  p.toBuilder();
  const n = p.moves.length, picks = p.picks();
  p.tapAt(50, SKY);
  p.tick(16);
  assert.deepEqual([p.place().level, p.moves.length], ['planet', n], 'one empty tap: nothing');
  p.run(TAP.doubleMs + 50);
  p.rightClick(51, p.cam.screenOf(BA));
  p.tick(16);
  assert.equal(p.picks(), picks + 1, 'the right-click picked nothing (only the empty tap did)');
  assert.equal(p.place().level, 'site', 'a right-click on a planet is Back, not a pick');
  p.rightClick(52, SKY);
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  const m = p.moves.length;
  p.run(ZOOM_OUT.ms + 200);
  p.rightClick(53, SKY);
  p.tick(16);
  assert.deepEqual([p.place(), p.moves.length], [AT_OVERVIEW, m], 'at the overview: nothing');
});

test('galaxy/main.js wires the levels (T13): goBack moon → planet → system → overview, ZOOM_OUT, a moon\'s host, taps\' back', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  const body = (key) => js.slice(js.indexOf(key), js.indexOf('\n  };', js.indexOf(key)));
  const go = body('const goBack = ');
  assert.match(go, /if \(next\.level === 'planet'\) \{\s*pickCard\(next\.planet, next\.site\);\s*place = next;\s*\} else if \(next\.level === 'site'\) backToSite\(next\.site\);\s*else toOverview\(left\.pose\(\), ZOOM_OUT\);/);
  const site = body('const backToSite = ');
  assert.match(site, /const kept = w\.kind === 'site' && w\.id === id && \(w\.turned != null \|\| w\.member == null\);/);
  assert.match(site, /else if \(!kept\) finger\.focus\(id, TIMING\.zoom, ZOOM_OUT\);/);
  assert.match(site, /place = placeOf\(id\);/);
  const planet = body('const openPlanet = ');
  assert.match(planet, /const framed = w\.kind === 'site' && w\.id === site && w\.member != null && \(hostOf\(site, w\.member\) \?\? w\.member\) === \(host \?\? id\);/);
  assert.match(planet, /if \(framed\) \{ \/\* the camera stays \*\/ \} else if \(reduced\)/);
  assert.match(planet, /place = host != null \? placeOf\(site, host, id\) : placeOf\(site, id\);/);
  assert.match(body('const hostOf = '), /m\?\.moon \? m\.moon\.host\?\.id \?\? m\.moon\.host \?\? null : null/);
  assert.match(js, /back: \(\) => goBack\(\), \/\/ a right-click, a double tap on empty sky/);
  assert.match(js, /const toOverview = \(pose = null, out = \{ ms: TOUCH\.fitMs \}\) => \{/);
});
