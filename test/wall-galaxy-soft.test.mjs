// Gentler motion (Wall plan night 5 A6, T5; the owner's sketch pick `sk_soft=1`):
// a system opens and folds over 2800 ms on smootherstep, the target starts
// opening at 0.32 of a flight, the held drift and the dust turn at 0.6x.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED, OPEN_MS, ease, foldAt, smoother } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { SITE_SHOT } from '../public/js/wall/galaxy/scene.js';
import { dustTurn } from '../public/js/wall/galaxy/still.js';

test('soft motion: the constants are the owner\'s pick', () => {
  assert.equal(OPEN_MS, 2800);
  assert.equal(FLIGHT.openAt, 0.32);
  assert.equal(FLIGHT.ms, 2250, 'the flight itself is unchanged');
  assert.ok(Math.abs(SITE_SHOT.speed - 0.00002 * 0.6) < 1e-12, 'held drift 0.6x of night 4');
  assert.ok(Math.abs(dustTurn(1e6) - 4 * 0.6) < 1e-9, 'dust turn 0.6x of night 4 (0.000004 rad/ms)');
  // The opening still ends soon after the camera lands: within 1.5 s of it.
  const openEnds = FLIGHT.ms * FLIGHT.openAt + OPEN_MS;
  assert.ok(openEnds > FLIGHT.ms && openEnds - FLIGHT.ms < 1500, `${openEnds} ms`);
});

test('soft motion: smootherstep runs 0..1, is symmetric, clamps, and has zero slope and acceleration at both ends', () => {
  assert.equal(smoother(0), 0);
  assert.equal(smoother(1), 1);
  assert.equal(smoother(0.5), 0.5);
  assert.equal(smoother(-1), 0);
  assert.equal(smoother(2), 1);
  for (const x of [0.1, 0.25, 0.4]) assert.ok(Math.abs(smoother(x) + smoother(1 - x) - 1) < 1e-12, `symmetric at ${x}`);
  const h = 1e-4;
  const slope = (x) => (smoother(x + h) - smoother(x - h)) / (2 * h);
  const accel = (x) => (smoother(x + h) - 2 * smoother(x) + smoother(x - h)) / (h * h);
  assert.ok(Math.abs(slope(h)) < 1e-6 && Math.abs(slope(1 - h)) < 1e-6, 'no jolt starting or stopping');
  assert.ok(Math.abs(accel(h)) < 1e-2 && Math.abs(accel(1 - h)) < 1e-2, 'no jerk at either end');
  // Mid-way the push turns to a brake smoothly; the cubic ease flips its acceleration there at once (+12 to -12).
  const left = (f) => (f(0.5 - 2 * h) - 2 * f(0.5 - h) + f(0.5)) / (h * h);
  const right = (f) => (f(0.5) - 2 * f(0.5 + h) + f(0.5 + 2 * h)) / (h * h);
  assert.ok(Math.abs(left(smoother) - right(smoother)) < 0.1, 'smooth through the middle');
  assert.ok(Math.abs(left(ease) - right(ease)) > 20, 'the cubic ease jerks at the middle');
  let prev = 0;
  for (let x = 0.01; x <= 1; x += 0.01) {
    assert.ok(smoother(x) >= prev, 'never goes back');
    prev = smoother(x);
  }
});

test('soft motion: a member folds and opens on smootherstep', () => {
  const p = { x: 100, y: 40, z: -60 };
  assert.deepEqual(foldAt(0, p), { x: 100 * CLOSED, y: 0, z: -60 * CLOSED });
  assert.deepEqual(foldAt(1, p), p);
  const k = smoother(0.3);
  const at = foldAt(0.3, p);
  assert.ok(Math.abs(at.x - p.x * (CLOSED + (1 - CLOSED) * k)) < 1e-9);
  assert.ok(Math.abs(at.y - p.y * (CLOSED + (1 - CLOSED) * k) * k) < 1e-9);
});
