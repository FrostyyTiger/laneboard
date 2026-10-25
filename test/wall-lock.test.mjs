// The Wall's target lock (Wall plan T7, docs/plans/wall/README.md §3): the
// bracket geometry (size from the node's radius and the zoom, closing over
// time), its tone, and the driver following the node frame by frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lockGeometry, lockProgress, nodeScaleAt, lockTone, createLock, LOCK_TIMING, STILL_LOCK_TIMING, LOCK_SIZE,
} from '../public/js/wall/lock.js';
import { SIZE } from '../public/js/views/map/layout.js';
import { DEMO_TIMING, TIMING } from '../public/js/wall/tour.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

test('lock: a shut lock sits just outside the node, sized from its radius and the screen', () => {
  const side = 912;
  const g = lockGeometry({ kind: 'site', ns: 1.6, side, t: 1 });
  assert.equal(g.r, SIZE.site * 1.6);
  assert.ok(Math.abs(g.d - (g.r + side * LOCK_SIZE.gap)) < 1e-9, 'shut: radius plus the gap');
  assert.equal(g.alpha, 1);
  assert.ok(g.d > g.r, 'the brackets never touch the node');
  // A bigger node, or the same node at a higher zoom, gets a wider lock.
  assert.ok(lockGeometry({ kind: 'core', ns: 1.6, side, t: 1 }).d > g.d);
  assert.ok(lockGeometry({ kind: 'site', ns: 0.8, side, t: 1 }).d < g.d);
  // The arm scales with the screen and has a floor.
  assert.equal(lockGeometry({ kind: 'site', side: 1824 }).arm, 1824 * LOCK_SIZE.arm);
  assert.equal(lockGeometry({ kind: 'site', side: 100 }).arm, LOCK_SIZE.minArm);
  // Unknown kinds and bad numbers still draw.
  const odd = lockGeometry({ kind: 'nope', ns: NaN, side: -3, t: 2 });
  assert.ok(Number.isFinite(odd.d) && odd.d > odd.r && odd.alpha === 1);
});

test('lock: the brackets close in over time, eased, and are invisible when open', () => {
  const side = 912;
  const at = (t) => lockGeometry({ kind: 'site', ns: 1.6, side, t });
  const open = at(0), mid = at(0.5), shut = at(1);
  assert.equal(open.alpha, 0);
  assert.ok(open.d > mid.d && mid.d > shut.d, 'closing means smaller');
  assert.ok(Math.abs(open.d - shut.d - side * LOCK_SIZE.open) < 1e-9, 'they start the open distance further out');
  // Ease out: more than half the way in at half the time.
  assert.ok((open.d - mid.d) / (open.d - shut.d) > 0.5);
  // Monotonic over the whole close.
  let last = Infinity;
  for (let i = 0; i <= 20; i++) {
    const d = at(i / 20).d;
    assert.ok(d <= last);
    last = d;
  }
});

test('lock: progress closes from startAt over closeMs, opens from where it got to over outMs', () => {
  const T = LOCK_TIMING;
  const lock = { startAt: 1000 };
  assert.equal(lockProgress(999, lock), 0);
  assert.equal(lockProgress(1000 + T.closeMs / 2, lock), 0.5);
  assert.equal(lockProgress(1000 + T.closeMs, lock), 1);
  assert.equal(lockProgress(1e6, lock), 1);
  // Leaving after it shut: back to 0 over outMs.
  const left = { startAt: 1000, leaveAt: 5000 };
  assert.equal(lockProgress(5000, left), 1);
  assert.equal(lockProgress(5000 + T.outMs / 2, left), 0.5);
  assert.equal(lockProgress(5000 + T.outMs, left), 0);
  // Leaving half shut opens from half, no jump.
  const early = { startAt: 1000, leaveAt: 1000 + T.closeMs / 2 };
  assert.equal(lockProgress(early.leaveAt, early), 0.5);
  assert.equal(lockProgress(early.leaveAt + T.outMs / 2, early), 0.25);
  // Still timing: shut at once, gone at once.
  assert.equal(lockProgress(1000, lock, STILL_LOCK_TIMING), 1);
  assert.equal(lockProgress(999, lock, STILL_LOCK_TIMING), 0);
  assert.equal(lockProgress(5000, left, STILL_LOCK_TIMING), 0);
});

test('lock: it is shut by the time the camera has arrived, at both tour speeds', () => {
  for (const tour of [TIMING, DEMO_TIMING]) {
    const startAt = Math.max(0, tour.flyMs - LOCK_TIMING.leadMs);
    const shutAt = startAt + LOCK_TIMING.closeMs;
    assert.ok(startAt < tour.flyMs, 'it starts closing during the flight');
    assert.ok(shutAt <= tour.flyMs + 250, 'and is shut within a beat of arriving');
    assert.ok(shutAt + LOCK_TIMING.outMs < tour.flyMs + tour.holdMs, 'and stands shut for a while before it opens');
  }
});

test('lock: node scale follows the zoom like the Map, clamped 0.8..1.6', () => {
  // 1368x912, a layout 400 out: fit = (912-20)/(2*464).
  const fit = (912 - 20) / (2 * 464);
  assert.ok(Math.abs(nodeScaleAt(1368, 912, 400, 1) - fit) < 1e-9);
  assert.equal(nodeScaleAt(1368, 912, 400, 2.3), 1.6);
  assert.equal(nodeScaleAt(1368, 912, 4000, 1), 0.8);
  assert.ok(Number.isFinite(nodeScaleAt(0, 0, undefined, NaN)));
});

test('lock: grey unless the target is in trouble', () => {
  assert.equal(lockTone('ok'), 'calm');
  assert.equal(lockTone('working'), 'calm');
  assert.equal(lockTone(undefined), 'calm');
  assert.equal(lockTone('warn'), 'warn');
  assert.equal(lockTone('attention'), 'warn');
  assert.equal(lockTone('crit'), 'crit');
  assert.equal(lockTone('down'), 'crit');
});

/** A map that reports where a node is and lets the test draw frames. */
function fakeMap(where) {
  const cbs = new Set();
  return {
    onDraw: (cb) => { cbs.add(cb); return () => cbs.delete(cb); },
    screenOf: (id) => where[id] ?? null,
    snapshotScene: () => ({ outer: 400 }),
    frame: () => { for (const cb of cbs) cb(); },
    listeners: () => cbs.size,
  };
}

test('lock: the driver follows the node every frame and hands over between legs', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let now = 0;
    const where = { hv2: { x: 600, y: 400 }, hv1: { x: 200, y: 300 } };
    const map = fakeMap(where);
    const root = makeEl('div');
    const lock = createLock(root, map, { clock: { now: () => now }, size: () => ({ W: 1368, H: 912 }) });
    const box = lock.el;
    const tl = box.children[0];
    const leg = (id, status) => ({ kind: 'site', id, status, arriveMs: 2250, node: { id, kind: 'site' } });

    map.frame();
    assert.equal(box.style.opacity, '0', 'nothing locked, nothing shown');

    lock.lockOn(leg('hv2', 'crit'), 2.3);
    now = 1000;
    map.frame();
    assert.equal(box.style.opacity, '0', 'not yet: the camera is still far');
    now = 2250 - LOCK_TIMING.leadMs + LOCK_TIMING.closeMs;
    map.frame();
    assert.equal(box.dataset.tone, 'crit');
    assert.equal(box.style.opacity, '1.000');
    const g = lockGeometry({ kind: 'site', ns: 1.6, side: 912, t: 1 });
    const x0 = (600 - g.d).toFixed(1), y0 = (400 - g.d).toFixed(1);
    assert.equal(tl.style.transform, `translate3d(${x0}px, ${y0}px, 0)`);

    // The Map turns: the brackets go with the node.
    where.hv2 = { x: 610, y: 395 };
    map.frame();
    assert.equal(tl.style.transform, `translate3d(${(610 - g.d).toFixed(1)}px, ${(395 - g.d).toFixed(1)}px, 0)`);

    // Next leg: the old lock opens on hv2 while the camera flies to hv1.
    now = 10000;
    lock.lockOn(leg('hv1', 'ok'), 2.3);
    now = 10000 + LOCK_TIMING.outMs / 2;
    map.frame();
    assert.equal(lock.state().cur.id, 'hv2');
    assert.equal(box.dataset.tone, 'crit');
    assert.ok(Number(box.style.opacity) > 0 && Number(box.style.opacity) < 1);
    now = 10000 + 2250;
    map.frame();
    assert.equal(lock.state().cur.id, 'hv1');
    assert.equal(box.dataset.tone, 'calm', 'a calm target gets grey brackets');

    // The overview: it opens and goes, then no work.
    now = 20000;
    lock.release();
    now = 20000 + LOCK_TIMING.outMs + 1;
    map.frame();
    assert.equal(box.style.opacity, '0');
    assert.equal(lock.state().cur, null);

    // A node that is not drawn hides the lock rather than parking it at 0,0.
    lock.lockOn(leg('gone', 'ok'), 2.3);
    now = 40000;
    map.frame();
    assert.equal(box.style.opacity, '0');

    lock.destroy();
    assert.equal(map.listeners(), 0);
  } finally {
    globalThis.document = prevDoc;
  }
});
