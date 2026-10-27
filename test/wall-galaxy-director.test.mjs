// One camera director, the state (Wall plan night 4 T13, README D10): touch
// first, then a show command, then the tour; every hand-over an eased move
// from where the camera is (a cut with a fade in reduced motion); the tour
// back a minute after the last touch or show. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDOVER, IDLE, OVERVIEW, SOURCES, directorLeft, directorStep, initialDirector,
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

test('director: a newer show replaces the older (last wins)', () => {
  const [, b] = run([
    [t0, { type: 'show', id: 'a', to: SITE('hv1') }],
    [t0 + 3000, { type: 'show', id: 'b', to: SITE('hv2'), pose: POSE }],
  ]);
  assert.equal(b.state.show.id, 'b');
  assert.deepEqual(b.move.to, SITE('hv2'));
  assert.equal(b.state.show.until, t0 + 3000 + IDLE.ms);
});

test('director: a touch during a show wins; the show is dropped, not parked, and never comes back', () => {
  const [show, touch, later] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2') }],
    [t0 + 4000, { type: 'touch', pose: POSE }],
    [t0 + 4000 + HANDOVER.fitMs + IDLE.ms, { type: 'tick' }],
  ]);
  assert.equal(show.state.driver, 'show');
  assert.equal(touch.state.driver, 'touch');
  assert.equal(touch.wake, true);
  assert.equal(touch.dropped, 'c1');
  assert.equal(touch.state.show, null);
  assert.deepEqual(touch.move, { source: 'touch', from: POSE, to: OVERVIEW, ms: HANDOVER.fitMs, cut: false });
  assert.equal(later.state.driver, 'tour', 'after the minute the tour has it, not the old show');
  assert.equal(later.resume, true);
  assert.equal(later.move, null, 'the director only says resume; the tour asks for its leg');
});

test('director: a show during touch is refused busy (not queued); the finger keeps the camera', () => {
  const [, show, tick] = run([
    [t0, { type: 'touch' }],
    [t0 + 10_000, { type: 'show', id: 'c1', to: SITE('hv2') }],
    [t0 + HANDOVER.fitMs + IDLE.ms, { type: 'tick' }],
  ]);
  assert.equal(show.refused, 'busy');
  assert.equal(show.move, null);
  assert.equal(show.state.driver, 'touch');
  assert.equal(show.state.show, null);
  assert.equal(tick.state.driver, 'tour', 'nothing queued: the tour, not the show, comes back');
  assert.equal(tick.resume, true);
});

test('director: a held finger refuses a show too, and the minute never runs out under it', () => {
  const [, show, tick] = run([
    [t0, { type: 'touch' }],
    [t0 + 1000, { type: 'show', id: 'c1', to: SITE('hv2') }, { held: true }],
    [t0 + 10 * IDLE.ms, { type: 'tick' }, { held: true }],
  ]);
  assert.equal(show.refused, 'busy');
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

test('director: the tour takes the camera back 60 s after the last show, sooner on a shorter hold or a clear', () => {
  const [, early, back] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2') }],
    [t0 + IDLE.ms - 1, { type: 'tick' }],
    [t0 + IDLE.ms, { type: 'tick' }],
  ]);
  assert.equal(early.state.driver, 'show');
  assert.equal(back.resume, true);
  assert.equal(back.state.driver, 'tour');

  const [, shortBack] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2'), holdMs: 20_000 }],
    [t0 + 20_000, { type: 'tick' }],
  ]);
  assert.equal(shortBack.resume, true);
  const [long] = run([[t0, { type: 'show', id: 'c1', to: SITE('hv2'), holdMs: 10 * IDLE.ms }]]);
  assert.equal(long.state.show.until, t0 + IDLE.ms, 'a hold never outlasts the minute');

  const [, other, clear] = run([
    [t0, { type: 'show', id: 'c1', to: SITE('hv2') }],
    [t0 + 5000, { type: 'clear', id: 'c0' }],
    [t0 + 6000, { type: 'clear' }],
  ]);
  assert.equal(other.state.driver, 'show', 'a clear for another command changes nothing');
  assert.equal(clear.state.driver, 'tour');
  assert.equal(clear.resume, true);
});

test('director: ▶ TOUR hands the finger\'s camera back at once; a show is not the finger\'s to hand back', () => {
  const [, hb] = run([[t0, { type: 'touch' }], [t0 + 5000, { type: 'handback' }]]);
  assert.equal(hb.resume, true);
  assert.equal(hb.state.driver, 'tour');
  const [, none] = run([[t0, { type: 'show', id: 'c', to: SITE('hv1') }], [t0 + 5000, { type: 'handback' }]]);
  assert.equal(none.resume, false);
  assert.equal(none.state.driver, 'show');
});

test('director: in reduced motion every hand-over is a cut with a short fade, never a flight', () => {
  const still = { still: true };
  const [leg, show, touch, tap] = run([
    [t0, { type: 'tour', to: SITE('hv1') }, still],
    [t0 + 1000, { type: 'show', id: 'c', to: SITE('hv2') }, still],
    [t0 + 2000, { type: 'touch' }, still],
    [t0 + 3000, { type: 'touch', to: SITE('cloud') }, still],
  ]);
  for (const r of [leg, show, touch, tap]) {
    assert.equal(r.move.ms, 0);
    assert.equal(r.move.cut, true);
    assert.equal(r.move.fadeMs, CUT.fadeMs);
  }
  assert.deepEqual(touch.move.to, OVERVIEW);
  assert.equal(directorStep(touch.state, { type: 'tick' }, t0 + 2000 + IDLE.ms).resume, true, 'no ease out to wait for');
});

test('director: a show without a target is refused; a stray clear or handback under the tour changes nothing', () => {
  const s = initialDirector();
  assert.equal(directorStep(s, { type: 'show', id: 'x' }, t0).refused, 'bad-shape');
  for (const type of ['clear', 'handback', 'tick']) {
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
  const [s] = run([[t0, { type: 'show', id: 'c', to: SITE('hv1'), holdMs: 30_000 }]]);
  assert.equal(directorLeft(s.state, t0 + 10_000), 20_000);
});
