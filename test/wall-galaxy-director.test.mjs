// One camera director, the state (Wall plan night 4 T13, README D10; aligned
// with the cockpit spec c4 §2 on 2026-10-27): touch first, then a show
// command, then the tour; every hand-over an eased move from where the camera
// is (a cut with a fade in reduced motion); a show in its own time, never
// refused here; the tour back on a hand-back. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDOVER, IDLE, OVERVIEW, SOURCES, STAY, createDirector, directorLeft, directorStep, initialDirector,
} from '../public/js/wall/galaxy/director.js';
import { IDLE as TOUCH_IDLE } from '../public/js/wall/galaxy/touch.js';
import { TIMING } from '../public/js/wall/tour.js';
import { CUT } from '../public/js/wall/galaxy/still.js';

const POSE = Object.freeze({ look: { x: 1, y: 0, z: 2 }, yaw: 0.4, pitch: 0.6, dist: 900 });
const SITE = (id) => ({ kind: 'site', id });
const t0 = 100_000;

/** Runs `events` (`[at, event, opts?]`) from a fresh director, returning each step's result. */
function run(events, state = initialDirector()) {
  const out = [];
  for (const [at, ev, opts] of events) {
    const r = directorStep(state, ev, at, opts);
    out.push(r);
    state = r.state;
  }
  return out;
}

test('director: three sources in D10 precedence, the minute moved here from touch.js', () => {
  assert.deepEqual(SOURCES, ['touch', 'show', 'tour']);
  assert.equal(IDLE.ms, 60000);
  assert.equal(TOUCH_IDLE, IDLE, 'touch.js re-exports the same IDLE');
  assert.equal(HANDOVER.flyMs, TIMING.flyMs);
  assert.equal(initialDirector().driver, 'tour');
});

test('director: the tour drives its own legs while it has the camera, each an eased move from the pose', () => {
  const [leg, out] = run([
    [t0, { type: 'tour', to: SITE('hv1'), pose: POSE }],
    [t0 + 5000, { type: 'tour', to: OVERVIEW, ms: 1800 }],
  ]);
  assert.deepEqual(leg.move, { source: 'tour', from: POSE, to: SITE('hv1'), ms: TIMING.flyMs, cut: false });
  assert.equal(out.move.ms, 1800);
  assert.equal(out.move.from, null, 'no pose given: the camera eases from wherever it is');
  assert.equal(out.state.driver, 'tour');
});

test('director: a show while the tour flies takes the camera with an eased hand-over from the current pose', () => {
  const [, show, leg] = run([
    [t0, { type: 'tour', to: SITE('hv1'), pose: POSE }],
    [t0 + 900, { type: 'show', id: 'c1', to: SITE('hv2'), pose: { ...POSE, dist: 700 } }],
    [t0 + 2250, { type: 'tour', to: SITE('cloud') }],
  ]);
  assert.equal(show.state.driver, 'show');
  assert.equal(show.refused, null);
  assert.deepEqual(show.move, { source: 'show', from: { ...POSE, dist: 700 }, to: SITE('hv2'), ms: HANDOVER.flyMs, cut: false });
  assert.ok(show.move.ms > 0, 'never a cut');
  assert.equal(leg.move, null, 'the tour\'s next leg is not played under a show');
  assert.equal(leg.refused, 'busy');
});

test('director: a newer show replaces the older mid-flight, from where the camera is, in its own time (c4 §2, D68)', () => {
  const [a, b] = run([
    [t0, { type: 'show', id: 'a', to: SITE('hv1'), ms: 700 }],
    [t0 + 200, { type: 'show', id: 'b', to: SITE('hv2'), pose: POSE, ms: 450 }],
  ]);
  assert.equal(a.move.ms, 700);
  assert.equal(b.state.show.id, 'b');
  assert.deepEqual(b.move, { source: 'show', from: POSE, to: SITE('hv2'), ms: 450, cut: false });
  assert.equal(b.resume, false, 'no hand-back to the tour between the two');
});
test('director: a touch during a show takes the camera without a wake: the page already explores', () => {
  const [show, press, tap, later] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2'), ms: 600 }],
    [t0 + 4000, { type: 'touch', pose: POSE }],
    [t0 + 5000, { type: 'touch', to: SITE('hv1'), pose: POSE }],
    [t0 + 5000 + IDLE.ms, { type: 'tick' }],
  ]);
  assert.equal(show.state.driver, 'show');
  assert.equal(press.state.driver, 'touch');
  assert.equal(press.wake, false);
  assert.equal(press.move, null, 'no ease out to the overview');
  assert.equal(press.state.show, null);
  assert.deepEqual(tap.move, { source: 'touch', from: POSE, to: SITE('hv1'), ms: HANDOVER.flyMs, cut: false });
  assert.equal(later.state.driver, 'tour', 'after the minute the tour has it, not the old show');
  assert.equal(later.resume, true);
  assert.equal(later.move, null, 'the director only says resume; the tour asks for its leg');
});
test('director: a show during a finger\'s explore takes the camera (the owner\'s finger rule is show.js\'s)', () => {
  const [, show] = run([
    [t0, { type: 'touch' }],
    [t0 + 10_000, { type: 'show', id: 'c1', to: SITE('hv2'), pose: POSE, ms: 500 }],
  ]);
  assert.equal(show.refused, null);
  assert.deepEqual(show.move, { source: 'show', from: POSE, to: SITE('hv2'), ms: 500, cut: false });
  assert.equal(show.state.driver, 'show');
});
test('director: STAY takes the camera without moving it; a held finger keeps the minute from running out', () => {
  const [, stay] = run([
    [t0, { type: 'tour', to: SITE('hv1'), pose: POSE }],
    [t0 + 1000, { type: 'show', id: 'c1', to: STAY, pose: POSE }],
  ]);
  assert.equal(stay.state.driver, 'show');
  assert.equal(stay.move, null);
  const [, tick] = run([
    [t0, { type: 'touch' }],
    [t0 + 10 * IDLE.ms, { type: 'tick' }, { held: true }],
  ]);
  assert.equal(tick.state.driver, 'touch');
  assert.equal(tick.resume, false);
});
test('director: the tour takes the camera back 60 s after the last touch, counted from the end of the ease out', () => {
  const [wake, drag, tap, early, back, again] = run([
    [t0, { type: 'touch', pose: POSE }],
    [t0 + 3000, { type: 'touch' }],
    [t0 + 8000, { type: 'touch', to: SITE('hv1'), pose: POSE }],
    [t0 + 8000 + IDLE.ms - 1, { type: 'tick' }],
    [t0 + 8000 + IDLE.ms, { type: 'tick' }],
    [t0 + 8000 + IDLE.ms + 10, { type: 'tour', to: SITE('lab'), pose: POSE }],
  ]);
  assert.equal(wake.wake, true);
  assert.equal(drag.move, null, 'a drag is its own motion');
  assert.equal(drag.wake, false);
  assert.deepEqual(tap.move, { source: 'touch', from: POSE, to: SITE('hv1'), ms: HANDOVER.flyMs, cut: false });
  assert.equal(early.resume, false);
  assert.equal(back.resume, true);
  assert.equal(back.state.driver, 'tour');
  assert.deepEqual(again.move, { source: 'tour', from: POSE, to: SITE('lab'), ms: TIMING.flyMs, cut: false },
    'the tour eases from where the finger left the camera');
  // The wake alone: the minute starts when the ease out is over.
  const [w] = run([[t0, { type: 'touch' }]]);
  assert.equal(directorStep(w.state, { type: 'tick' }, t0 + IDLE.ms).resume, false);
  assert.equal(directorStep(w.state, { type: 'tick' }, t0 + HANDOVER.fitMs + IDLE.ms).resume, true);
});

test('director: a show has no hold of its own: only a hand-back (touch.js\'s minute, ▶ TOUR, an undo) gives the tour the camera', () => {
  const [, tick, hb] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2') }],
    [t0 + 10 * IDLE.ms, { type: 'tick' }],
    [t0 + 10 * IDLE.ms + 1, { type: 'handback' }],
  ]);
  assert.equal(tick.state.driver, 'show');
  assert.equal(tick.resume, false);
  assert.equal(hb.state.driver, 'tour');
  assert.equal(hb.resume, true);
});
test('director: ▶ TOUR hands the finger\'s camera back at once; under the tour a hand-back changes nothing', () => {
  const [, hb] = run([[t0, { type: 'touch' }], [t0 + 5000, { type: 'handback' }]]);
  assert.equal(hb.resume, true);
  assert.equal(hb.state.driver, 'tour');
  const [none] = run([[t0, { type: 'handback' }]]);
  assert.equal(none.resume, false);
  assert.equal(none.state.driver, 'tour');
});
test('director: in reduced motion every hand-over is a cut with a short fade, never a flight', () => {
  const still = { still: true };
  const [leg, show, touch, tap] = run([
    [t0, { type: 'tour', to: SITE('hv1') }, still],
    [t0 + 1000, { type: 'show', id: 'c', to: SITE('hv2'), ms: 600 }, still],
    [t0 + 2000, { type: 'touch', to: OVERVIEW }, still],
    [t0 + 3000, { type: 'touch', to: SITE('cloud') }, still],
  ]);
  for (const r of [leg, show, touch, tap]) {
    assert.equal(r.move.ms, 0);
    assert.equal(r.move.cut, true);
    assert.equal(r.move.fadeMs, CUT.fadeMs);
  }
  assert.deepEqual(touch.move.to, OVERVIEW);
  const [wake] = run([[t0, { type: 'touch' }, still]]);
  assert.equal(directorStep(wake.state, { type: 'tick' }, t0 + IDLE.ms, still).resume, true, 'no ease out to wait for');
});
test('director: a show without a target is refused; a stray handback or tick under the tour changes nothing', () => {
  const s = initialDirector();
  assert.equal(directorStep(s, { type: 'show', id: 'x' }, t0).refused, 'bad-shape');
  for (const type of ['handback', 'tick', 'clear']) {
    const r = directorStep(s, { type }, t0);
    assert.equal(r.state.driver, 'tour', type);
    assert.equal(r.resume, false, type);
    assert.equal(r.move, null, type);
  }
  assert.equal(directorStep(null, { type: 'tick' }, t0).state.driver, 'tour', 'no state: a fresh one');
});
test('directorLeft: the time until the tour takes the camera back, for the MANUAL line', () => {
  assert.equal(directorLeft(initialDirector(), t0), null);
  const [w] = run([[t0, { type: 'touch' }]]);
  assert.equal(directorLeft(w.state, t0 + 500), IDLE.ms, 'the whole minute while easing out');
  assert.equal(directorLeft(w.state, t0 + HANDOVER.fitMs + 20_000), IDLE.ms - 20_000);
  assert.equal(directorLeft(w.state, t0 + HANDOVER.fitMs + 20_000, { held: true }), IDLE.ms);
  assert.equal(directorLeft(w.state, t0 + 10 * IDLE.ms), 0);
  const [s] = run([[t0, { type: 'show', id: 'c', to: SITE('hv1') }]]);
  assert.equal(directorLeft(s.state, t0 + 10_000), null, 'a show\'s minute is touch.js\'s');
});

// ---- T14: createDirector, the page's director over a camera ----

/** A camera that only counts: each move with its arguments, a pose to read. */
function countingCam() {
  const calls = [];
  const cam = { calls, pose: () => ({ pos: { x: 0, y: 900, z: 900 }, look: { x: 0, y: 0, z: 0 } }), screenOf: () => null };
  for (const k of ['fit', 'focus', 'cut', 'fly', 'place', 'steer']) cam[k] = (...args) => { calls.push([k, ...args]); };
  return cam;
}

function director({ still = false, held = false } = {}) {
  let now = t0;
  const cam = countingCam();
  const resumed = [];
  const moves = [];
  const d = createDirector(cam, { clock: () => now, still, held: () => held, resume: (from) => resumed.push(from) });
  d.onMove((m) => moves.push(m));
  return { d, cam, moves, resumed, at: (ms) => { now = t0 + ms; } };
}

test('createDirector: every camera call is the director\'s, with its source; each source\'s camera is a request', () => {
  const { d, cam, moves, resumed, at } = director();
  const tour = d.as('tour'), finger = d.as('touch');
  assert.equal(d.as('tour'), tour, 'one camera per source');
  assert.equal(tour.screenOf, cam.screenOf, 'reads go to the camera as it is');
  tour.fit();
  tour.focus('hv1', 2.3);
  assert.deepEqual(cam.calls, [['fit', undefined], ['focus', 'hv1', 2.3]], 'the tour\'s legs as tour.js always called them');
  // A drag before any wake does nothing: only the wake's fit takes the camera.
  finger.steer({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } });
  assert.equal(cam.calls.length, 2);
  at(1000);
  finger.fit({ ms: HANDOVER.fitMs });
  assert.deepEqual(cam.calls.at(-1), ['fit', { ms: HANDOVER.fitMs }]);
  assert.equal(d.driver(), 'touch');
  tour.focus('hv2', 2.3);
  assert.equal(cam.calls.length, 3, 'a tour leg under a finger moves nothing');
  finger.steer({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } });
  finger.focus('hv2', 2.3);
  finger.fly({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } }, { ms: 1500 });
  assert.deepEqual(cam.calls.slice(3).map((c) => c[0]), ['steer', 'focus', 'fly']);
  assert.deepEqual(cam.calls.at(-1)[2], { ms: 1500 }, 'back in its own time');
  d.handBack();
  assert.deepEqual(resumed, ['touch']);
  assert.equal(d.driver(), 'tour');
  // A show takes the camera from the tour in its own time (the tour's zoom when it names none); it stays
  // until a hand-back, however long.
  at(5000);
  d.show({ id: 'c2', to: { kind: 'site', id: 'cloud' }, ms: 640 });
  assert.deepEqual(cam.calls.at(-1), ['focus', 'cloud', TIMING.zoom, { ms: 640 }]);
  tour.focus('hv1', 2.3);
  assert.equal(cam.calls.at(-1)[1], 'cloud', 'the tour waits under a show');
  // A free pose (fitNodes, setCamera, an undo) is camera.js's place; with `cut` a jump.
  const pose = { pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 0, z: 0 } };
  d.show({ id: 'c3', to: { kind: 'free', pose }, ms: 500 });
  assert.deepEqual(cam.calls.at(-1), ['place', pose, { ms: 500 }]);
  d.show({ id: 'c4', to: { kind: 'free', pose, cut: true } });
  assert.deepEqual(cam.calls.at(-1), ['place', pose, { cut: true }]);
  d.show({ id: 'c5', to: { kind: 'site', id: 'hv2', cut: true } });
  assert.deepEqual(cam.calls.at(-1), ['cut', 'hv2', TIMING.zoom]);
  at(7000 + 10 * IDLE.ms);
  d.tick();
  assert.equal(d.driver(), 'show');
  d.handBack();
  assert.deepEqual(resumed, ['touch', 'show']);
  assert.equal(d.driver(), 'tour');
  assert.deepEqual(cam.calls.map((c) => c[0]), moves.map((m) => m.call), 'one camera call per move, nothing else');
  assert.deepEqual(moves.map((m) => m.source), ['tour', 'tour', 'touch', 'touch', 'touch', 'touch', 'show', 'show', 'show', 'show']);
});

test('createDirector: reduced motion cuts a finger\'s or a show\'s site; the tour\'s legs stay focus (camera.js keeps the overview)', () => {
  const { d, cam, at } = director({ still: true });
  d.as('tour').focus('hv1', 2.3);
  assert.deepEqual(cam.calls.at(-1), ['focus', 'hv1', 2.3]);
  d.show({ id: 'c1', to: { kind: 'site', id: 'cloud', zoom: 2 } });
  assert.deepEqual(cam.calls.at(-1), ['cut', 'cloud', 2]);
  at(100);
  d.as('touch').fit({ ms: HANDOVER.fitMs });
  assert.deepEqual(cam.calls.at(-1), ['fit', undefined], 'the wake is a cut: no ms');
  d.as('touch').focus('hv2', 2.3);
  assert.deepEqual(cam.calls.at(-1), ['cut', 'hv2', 2.3]);
});

test('createDirector: a finger held keeps the director\'s minute from running out (touch.js hands back)', () => {
  const { d, resumed, at } = director({ held: true });
  d.as('touch').fit({ ms: HANDOVER.fitMs });
  at(HANDOVER.fitMs + IDLE.ms + 10_000);
  d.tick();
  assert.equal(d.driver(), 'touch');
  assert.deepEqual(resumed, []);
  assert.equal(d.left(), IDLE.ms);
});
