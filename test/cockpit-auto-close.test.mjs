// The pane closes itself after 300 s untouched, never during a turn (cockpit spec screens.md §2,
// c1-talk.md §2, D5): public/js/cockpit/auto-close.js `createAutoClose`, on a hand clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoClose } from '../public/js/cockpit/auto-close.js';
import { PANE_IDLE_S } from '../public/js/core/cockpit-constants.js';

function rig(ms) {
  let t = 0;
  const timers = new Map();
  let next = 1;
  const closes = [];
  const auto = createAutoClose({
    setTimer: (fn, d) => { const id = next++; timers.set(id, { at: t + d, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    close: () => { closes.push(t); auto.opened(false); },
    ...(ms === undefined ? {} : { ms }),
  });
  const to = (at) => {
    for (;;) {
      const due = [...timers].filter(([, v]) => v.at <= at).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = at;
  };
  return { auto, closes, to };
}

test('300 s (PANE_IDLE_S, D5, D150)', () => {
  assert.equal(PANE_IDLE_S, 300);
});

test('open and untouched: closed at 300 s, not at 299.999 s', () => {
  const r = rig();
  r.auto.opened(true);
  r.to(299_999);
  assert.deepEqual(r.closes, []);
  r.to(300_000);
  assert.deepEqual(r.closes, [300_000]);
  assert.equal(r.auto.armed(), false);
});

test('a touch starts the 300 s again', () => {
  const r = rig();
  r.auto.opened(true);
  r.to(200_000);
  r.auto.touched();
  r.to(499_999);
  assert.deepEqual(r.closes, []);
  r.to(500_000);
  assert.deepEqual(r.closes, [500_000]);
});

test('never during a turn: the 300 s start when it ends (S-SCR-04: sent at 0, ends at 400, closed at 700)', () => {
  const r = rig();
  r.auto.opened(true);
  r.auto.turn(true);
  assert.equal(r.auto.armed(), false);
  r.to(399_999);
  r.auto.touched(); // a touch during the turn arms nothing
  r.to(400_000);
  assert.deepEqual(r.closes, []);
  r.auto.turn(false);
  r.to(699_999);
  assert.deepEqual(r.closes, []);
  r.to(700_000);
  assert.deepEqual(r.closes, [700_000]);
});

test('closed by hand: no timer; a turn ending with the pane closed arms nothing', () => {
  const r = rig();
  r.auto.opened(true);
  r.auto.opened(false);
  assert.equal(r.auto.armed(), false);
  r.auto.turn(true);
  r.auto.turn(false);
  r.auto.touched();
  r.to(1_000_000);
  assert.deepEqual(r.closes, []);
});

test('0 is the owner\'s "never" (D5 overrule)', () => {
  const r = rig(0);
  r.auto.opened(true);
  r.to(10_000_000);
  assert.deepEqual(r.closes, []);
});
