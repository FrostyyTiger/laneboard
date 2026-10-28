// What the pane and a running turn do to the Wall through its handle (cockpit spec
// screens.md §2, §9.1, D4): public/js/cockpit/wall-hold.js `createWallHold`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallHold } from '../public/js/cockpit/wall-hold.js';
import { EXPLORE_IDLE_S } from '../public/js/core/cockpit-constants.js';

function fakeWall() {
  const calls = [];
  const view = {
    page: 'wall',
    wall: {
      tour: { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
      idle: { hold: () => calls.push('hold'), restart: (ms) => calls.push(`restart ${ms}`), remaining: () => null },
    },
  };
  return { calls, view, hold: createWallHold(() => view) };
}

test('the idle timer restarts at EXPLORE_IDLE_S (60 s, D150)', () => {
  assert.equal(EXPLORE_IDLE_S, 60);
  const w = fakeWall();
  w.hold.pane(true);
  w.hold.pane(false);
  assert.equal(w.calls.at(-1), `restart ${EXPLORE_IDLE_S * 1000}`);
});

test('the pane opens: the tour stops where it is, the idle timer is held; it closes: 60 s, the tour not resumed', () => {
  const w = fakeWall();
  assert.equal(w.hold.pane(true), true);
  assert.deepEqual(w.calls, ['pause', 'hold']);
  assert.equal(w.hold.pane(true), false, 'a second open does nothing');
  w.hold.pane(false);
  assert.deepEqual(w.calls, ['pause', 'hold', 'restart 60000']);
});

test('a turn with the pane closed: held without a pause, 60 s again when it ends', () => {
  const w = fakeWall();
  w.hold.turn(true);
  assert.deepEqual(w.calls, ['hold']);
  assert.equal(w.hold.held(), true);
  w.hold.turn(false);
  assert.deepEqual(w.calls, ['hold', 'restart 60000']);
});

test('the pane and a turn together: the timer comes back only when both are over (S-SCR-04)', () => {
  const w = fakeWall();
  w.hold.pane(true);
  w.hold.turn(true);
  w.hold.turn(false);
  assert.deepEqual(w.calls, ['pause', 'hold'], 'the turn ends with the pane open: still held');
  w.hold.turn(true);
  w.hold.pane(false);
  assert.deepEqual(w.calls, ['pause', 'hold'], 'the pane closes during a turn: still held');
  w.hold.turn(false);
  assert.deepEqual(w.calls, ['pause', 'hold', 'restart 60000']);
});

test('the pane opening during a turn still stops the tour where it is (D4)', () => {
  const w = fakeWall();
  w.hold.turn(true);
  w.hold.pane(true);
  assert.deepEqual(w.calls, ['hold', 'pause']);
});

test('the app (wall null) and a page without the handle: nothing, and no throw', () => {
  assert.equal(createWallHold(() => ({ page: 'app', wall: null, map: null })).pane(true), false);
  assert.equal(createWallHold(() => undefined).pane(true), false);
  assert.equal(createWallHold(() => ({ page: 'wall', wall: {} })).pane(true), true, 'a partial handle does not throw');
});

test('the handle is read at each change: a Wall that sets it late is held from then on', () => {
  let view;
  const hold = createWallHold(() => view);
  assert.equal(hold.pane(true), false);
  const w = fakeWall();
  view = w.view;
  hold.pane(false);
  assert.deepEqual(w.calls, ['restart 60000']);
});
