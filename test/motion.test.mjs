// The Map's motion maths: springs, flights, glide and staging. Pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { damp, settled, wrapAngle, flight, inertia, stage } from '../public/motion.js';

const run = (x, v, goal, hl, ms, dt = 16) => {
  const trace = [];
  for (let t = 0; t < ms; t += dt) { [x, v] = damp(x, v, goal, hl, dt); trace.push(x); }
  return { x, v, trace };
};

test('a spring halves its distance in one half-life, never overshoots, and settles', () => {
  const [half] = damp(0, 0, 100, 100, 100);
  // Starting from rest it lags a pure exponential: it has to accelerate first.
  assert.ok(half > 20 && half < 50, `after one half-life: ${half}`);
  const { x, v, trace } = run(0, 0, 100, 100, 2000);
  assert.ok(trace.every((p) => p <= 100 + 1e-9), 'no overshoot');
  assert.ok(settled(x, v, 100, 0.05));
});

test('a spring starts slow (no jolt) and keeps its speed when the goal moves', () => {
  const [x1, v1] = damp(0, 0, 100, 100, 16);
  const [x2] = damp(x1, v1, 100, 100, 16);
  assert.ok(x2 - x1 > x1, 'it accelerates over the first frames');
  // Retarget backwards mid-flight: it carries on forward briefly, then turns.
  let x = 0, v = 0;
  for (let i = 0; i < 10; i++) [x, v] = damp(x, v, 100, 100, 16);
  const before = x;
  [x, v] = damp(x, v, 0, 100, 16);
  assert.ok(x > before, 'momentum survives the new goal');
});

test('a spring is the same at 30 and 144 frames per second', () => {
  const slow = run(0, 0, 50, 90, 480, 1000 / 30).x;
  const fast = run(0, 0, 50, 90, 480, 1000 / 144).x;
  assert.ok(Math.abs(slow - fast) < 1.5, `${slow} vs ${fast}`);
});

test('a huge frame gap lands on the goal instead of exploding', () => {
  assert.deepEqual(damp(0, 5, 10, 100, 60000), [10, 0]);
  assert.deepEqual(damp(3, 0, 10, 0, 16), [10, 0]);
});

test('angles take the short way round', () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI / 2) + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-3 * Math.PI / 2) - Math.PI / 2) < 1e-12);
  assert.equal(wrapAngle(Math.PI), Math.PI);
  assert.equal(wrapAngle(-Math.PI), Math.PI);
  assert.ok(Math.abs(wrapAngle(0.1)) - 0.1 < 1e-12);
});

test('a far flight pulls back to keep both ends in view, then lands exactly', () => {
  const f = flight([0, 0, 300], [1200, 0, 300]);
  const [, , wMid] = f.at(0.5);
  assert.ok(wMid > 600, `zooms out mid-way: ${wMid}`);
  assert.deepEqual(f.at(1), [1200, 0, 300]);
  const [x0, y0, w0] = f.at(0);
  assert.ok(Math.abs(x0) < 1e-9 && Math.abs(y0) < 1e-9 && Math.abs(w0 - 300) < 1e-9);
  // x only ever moves toward the target.
  let last = -1;
  for (let t = 0; t <= 1; t += 0.05) { const [x] = f.at(t); assert.ok(x >= last - 1e-9); last = x; }
});

test('a short flight is quick, a long one slower, both within bounds', () => {
  const near = flight([0, 0, 500], [20, 0, 500]);
  const far = flight([0, 0, 200], [3000, 0, 200]);
  assert.equal(near.ms, 320);
  assert.ok(far.ms > near.ms && far.ms <= 900);
  // A pure zoom works too.
  const z = flight([5, 5, 400], [5, 5, 100]);
  assert.ok(Math.abs(z.at(0.5)[2] - 200) < 1e-6);
  assert.deepEqual(z.at(1).map((v) => Math.round(v)), [5, 5, 100]);
});

test('a released drag glides to a stop', () => {
  assert.ok(inertia(1, 325) < 0.37 && inertia(1, 325) > 0.36);
  assert.ok(inertia(1, 3000) < 0.001);
});

test('a change plays in beats: exits, then moves, then entries one after another', () => {
  const s = stage({ exits: 2, moves: 5, entries: ['a', 'b', 'c'] });
  assert.equal(s.moveAt, 160);
  assert.equal(s.enterAt, 380);
  assert.deepEqual([...s.at.values()], [380, 402, 424]);
  // Many entries never take longer than the spread.
  const many = stage({ entries: Array.from({ length: 100 }, (_, i) => i) });
  assert.equal(many.moveAt, 0);
  assert.ok(Math.abs(many.at.get(99) - 380) < 1e-9);
  assert.equal(stage({ entries: [] }).at.size, 0);
});
