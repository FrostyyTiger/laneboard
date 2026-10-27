// What the pane does to the Wall through its handle (cockpit spec screens.md §2, §9.1):
// public/js/cockpit/wall-hold.js `paneOnWall`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PANE_CLOSED_IDLE_MS, paneOnWall } from '../public/js/cockpit/wall-hold.js';

function fakeWall() {
  const calls = [];
  return {
    calls,
    view: {
      page: 'wall',
      wall: {
        tour: { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
        idle: { hold: () => calls.push('hold'), restart: (ms) => calls.push(`restart ${ms}`), remaining: () => null },
      },
    },
  };
}

test('the pane opens: the tour stops where it is, the idle timer is held', () => {
  const w = fakeWall();
  assert.equal(paneOnWall(w.view, true), true);
  assert.deepEqual(w.calls, ['pause', 'hold']);
});

test('the pane closes: the idle timer restarts at 60 s; the tour is not resumed', () => {
  const w = fakeWall();
  paneOnWall(w.view, false);
  assert.equal(PANE_CLOSED_IDLE_MS, 60_000);
  assert.deepEqual(w.calls, ['restart 60000']);
});

test('the app (wall null) and a page without the handle: nothing', () => {
  assert.equal(paneOnWall({ page: 'app', wall: null, map: null }, true), false);
  assert.equal(paneOnWall(undefined, true), false);
  assert.equal(paneOnWall({ page: 'wall', wall: {} }, false), true, 'a partial handle does not throw');
});
