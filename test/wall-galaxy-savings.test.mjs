// Two small savings (Wall plan night 4 T12): a member dot is at most an 8x6
// sphere, the lower levels' coarser dots kept (planets keep their levels), and the galaxy's lock
// writes a bracket's transform or the box's opacity only when its rounded
// value (0.1 px, opacity to 0.01) changed, as labels.js does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sphereSegs } from '../public/js/wall/galaxy/scene.js';
import { LEVELS } from '../public/js/wall/galaxy/budget.js';
import { createGalaxyLock } from '../public/js/wall/galaxy/lock.js';
import { LOCK_TIMING } from '../public/js/wall/lock.js';
import { makeDocument } from './helpers/fakedom.mjs';

test('a member dot is at most 8x6 and never finer than its level drew before; planets, stars and the sun keep their levels', () => {
  assert.ok(LEVELS.length >= 3);
  assert.deepEqual(LEVELS.slice(0, 3).map((L) => sphereSegs('dot', L.seg)), [[8, 6], [7, 5], [6, 4]]);
  for (const L of LEVELS) {
    const [w, h] = sphereSegs('dot', L.seg);
    assert.ok(w <= 8 && h <= 6, `level seg ${L.seg}`);
  }
  assert.deepEqual(LEVELS.slice(0, 3).map((L) => sphereSegs('planet', L.seg)), [[32, 22], [21, 14], [14, 10]]);
  assert.deepEqual(LEVELS.slice(0, 3).map((L) => sphereSegs('star', L.seg)), [[20, 14], [13, 9], [9, 6]]);
  assert.deepEqual(sphereSegs('sun', 1), [32, 20]);
});

/** A lock over a fake camera that draws `sp` for `hv1-b`, every style write on its elements counted. */
function countedLock(status) {
  let draw = null;
  const sp = { x: 800, y: 450, r: 20 };
  const cam = { onDraw: (cb) => { draw = cb; return () => {}; }, screenOf: (id) => (id === 'hv1-b' ? { ...sp } : null) };
  const t = { now: 0, writes: 0, sp };
  const lock = createGalaxyLock(globalThis.document.createElement('div'), cam, {
    clock: { now: () => t.now }, size: () => ({ W: 1600, H: 900 }), leaderFrom: () => ({ x: 20, y: 40 }),
  });
  for (const e of [lock.el, ...lock.el.children]) {
    const style = e.style;
    e.style = new Proxy(style, { set(o, k, v) { t.writes++; o[k] = v; return true; } });
  }
  lock.lockOn({ id: 'hv1-b', status, arriveMs: 0 });
  t.now = LOCK_TIMING.closeMs + 500; // shut and held
  t.frame = () => { t.now += 16; draw(); };
  t.lock = lock;
  return t;
}

test('the lock writes no style in a frame where the brackets moved under 0.1 px, and writes when they moved more', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const t = countedLock('ok');
    const { lock, sp } = t;
    t.frame();
    assert.ok(t.writes > 0, 'the first frame places the brackets');
    assert.equal(lock.state().drawn.leader, null, 'a calm lock has no leader');
    // Centre the corners on a 0.1 px step, so a nudge below rounds to the same place.
    const { d } = lock.state().drawn;
    const centre = (v) => Math.round((v - d) * 10) / 10 + d;
    sp.x = centre(sp.x); sp.y = centre(sp.y);
    t.frame();
    const tl = lock.el.children[0].style.transform;
    assert.ok(tl.startsWith('translate3d('), tl);

    t.writes = 0;
    t.frame();
    assert.equal(t.writes, 0, 'a held lock that did not move writes nothing');

    sp.x += 0.03; sp.y -= 0.03;
    t.frame();
    assert.equal(t.writes, 0, 'under 0.1 px: nothing');

    sp.x += 0.3;
    t.frame();
    assert.ok(t.writes >= 4, `moved 0.3 px: the corners are written (${t.writes})`);
    assert.notEqual(lock.el.children[0].style.transform, tl);

    // Release: the opacity falls, and the box hides once it is out.
    t.writes = 0;
    lock.release();
    t.now += LOCK_TIMING.outMs / 2;
    t.frame();
    assert.ok(t.writes > 0, 'opening writes');
    t.now += LOCK_TIMING.outMs;
    t.frame();
    assert.equal(lock.el.style.opacity, '0');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('a held trouble lock with its leader writes nothing while nothing moves', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const t = countedLock('crit');
    t.frame();
    assert.ok(t.lock.state().drawn.leader, 'a crit lock draws a leader');
    const leg = t.lock.el.children[4].style.transform;
    t.writes = 0;
    t.frame();
    t.frame();
    assert.equal(t.writes, 0);
    t.sp.y += 2;
    t.frame();
    assert.ok(t.writes > 0, 'moved 2 px: written');
    assert.notEqual(t.lock.el.children[4].style.transform, leg, 'the leader follows');
  } finally {
    globalThis.document = prevDoc;
  }
});
