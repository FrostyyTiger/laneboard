// The Wall's idle timer for the cockpit's handle (cockpit spec screens.md §9.1 W5):
// touch.js `hold()`, `restart(ms)`, `holding()` and `idleLeft` with a restarted length,
// on an injected clock. The page's wiring (galaxy/main.js `__cockpitView.wall`) is
// asserted end to end by the cockpit's Playwright tests (S-C1-01, S-C1-02, S-SCR-35).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IDLE, TOUCH, createTouch, idleLeft, touchStep } from '../public/js/wall/galaxy/touch.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

function stage() {
  const on = new Map();
  return {
    addEventListener: (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); },
    removeEventListener: (type, fn) => on.get(type)?.delete(fn),
    dispatch(type) {
      const ev = { type, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} };
      for (const fn of on.get(type) ?? []) fn(ev);
    },
  };
}

function exploring() {
  let now = 1000;
  let resumed = 0;
  const st = stage();
  const touch = createTouch(st, { clock: () => now, resume: () => { resumed += 1; } });
  st.dispatch('pointerdown');
  st.dispatch('pointerup');
  now += TOUCH.fitMs; // out of the ease: exploring, the minute running
  assert.equal(touch.mode(), 'explore');
  return { touch, st, at: () => now, step: (ms) => { now += ms; }, resumed: () => resumed };
}

test('hold(): the minute does not run out while held; left() stays whole', () => {
  const t = exploring();
  t.touch.hold();
  assert.equal(t.touch.holding(), true);
  t.step(10 * IDLE.ms);
  assert.equal(t.touch.mode(), 'explore');
  assert.equal(t.resumed(), 0);
  assert.equal(t.touch.left(), IDLE.ms);
});

test('restart(): lifts the hold and starts the minute again from now', () => {
  const t = exploring();
  t.touch.hold();
  t.step(5 * IDLE.ms);
  t.touch.restart();
  assert.equal(t.touch.holding(), false);
  assert.equal(t.touch.left(), IDLE.ms);
  t.step(IDLE.ms - 1);
  assert.equal(t.touch.mode(), 'explore');
  t.step(1);
  assert.equal(t.touch.mode(), 'tour');
  assert.equal(t.resumed(), 1);
});

test('restart(5000): the tour 5 s later; restart(300000): a speak-up\'s 300 s, until a touch makes it a minute', () => {
  const a = exploring();
  a.touch.restart(5000);
  assert.equal(a.touch.left(), 5000);
  a.step(4999);
  assert.equal(a.touch.mode(), 'explore');
  a.step(1);
  assert.equal(a.touch.mode(), 'tour');

  const b = exploring();
  b.touch.restart(300_000);
  assert.equal(b.touch.left(), 300_000);
  b.step(IDLE.ms * 2);
  assert.equal(b.touch.mode(), 'explore', 'past a minute, still exploring');
  assert.equal(b.touch.left(), 300_000 - IDLE.ms * 2);
  b.st.dispatch('pointerdown'); // the Wall's own touch: the minute again (Wall plan D4)
  b.st.dispatch('pointerup');
  assert.equal(b.touch.left(), IDLE.ms);
});

test('restart() in the tour only lifts the hold; handBack() lifts it too', () => {
  let now = 0;
  const touch = createTouch(stage(), { clock: () => now });
  touch.hold();
  touch.restart(5000);
  assert.equal(touch.holding(), false);
  assert.equal(touch.mode(), 'tour');
  assert.equal(touch.left(), null);
  const t = exploring();
  t.touch.hold();
  t.touch.handBack();
  assert.equal(t.touch.mode(), 'tour');
  assert.equal(t.touch.holding(), false);
});

test('idleLeft and touchStep read a restarted length off the state; a touch drops it', () => {
  const s = { mode: 'explore', since: 0, last: 1000, idleMs: 5000 };
  assert.equal(idleLeft(s, 3000), 3000);
  assert.equal(idleLeft(s, 3000, { held: true }), 5000);
  assert.equal(touchStep(s, 'tick', 5999).resume, false);
  assert.equal(touchStep(s, 'tick', 6000).resume, true);
  const touched = touchStep(s, 'touch', 2000).state;
  assert.equal(touched.idleMs, undefined);
  assert.equal(idleLeft(touched, 2000), IDLE.ms);
});

test('galaxy/main.js hands the cockpit W1-W6: state, tour pause/resume, idle hold/restart/remaining, onState', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'wall', 'galaxy', 'main.js'), 'utf8');
  for (const part of ['tour: { pause: pauseTour, resume: resumeTourNow }', 'hold: () => touch?.hold()', 'restart: (ms = IDLE.ms) => touch?.restart(ms)', 'onState: (cb) =>']) {
    assert.ok(js.includes(part), part);
  }
});

test('galaxy.html loads the cockpit after the Wall, with its stylesheet', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'galaxy.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/css\/cockpit\.css">/);
  assert.ok(html.indexOf('/js/wall/galaxy/main.js') < html.indexOf('/js/cockpit/wall-page.js'));
});
