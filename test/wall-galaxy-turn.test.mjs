// The overview turn (Wall plan night 5 C4, T15; the owner's sketch pick
// `sk_soft`): 0.0032 rad per px dragged, the drawn camera following the
// finger's orbit with a short lag (about 70 ms), a longer, gentler coast
// (τ about 650 ms) and a capped fling speed. The pure parts (touch.js
// orbitStep, followStep, capVel, inertia), then createGestures driven by
// pointer events on a fake clock with a camera that records its steers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORBIT, capVel, createGestures, followStep, inertia, orbitOf, orbitPose, orbitStep } from '../public/js/wall/galaxy/touch.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const START = Object.freeze({ look: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.9, dist: 4000 });

test('ORBIT: the sketch\'s feel, 0.0032 rad per px, τ 650 ms, a 70 ms follow, flings capped at 1.4 px/ms', () => {
  assert.equal(ORBIT.perPx, 0.0032);
  assert.equal(ORBIT.tauMs, 650);
  assert.equal(ORBIT.followMs, 70);
  assert.equal(ORBIT.maxVel, 1.4);
  assert.ok(near(orbitStep(START, 100, 0).yaw, START.yaw - 0.32, 1e-12), '100 px is 0.32 rad of turn');
});

test('capVel: a 3000 px/s fling comes down to maxVel, its direction kept; a slow one is untouched', () => {
  const v = capVel({ x: 3 * 0.6, y: 3 * 0.8, zoom: 0 }); // 3 px/ms = 3000 px/s
  assert.ok(near(Math.hypot(v.x, v.y), ORBIT.maxVel, 1e-12), `capped to ${Math.hypot(v.x, v.y)}`);
  assert.ok(near(v.x / v.y, 0.75, 1e-12), 'same direction');
  const slow = { x: 0.5, y: -0.2, zoom: 0 };
  assert.equal(capVel(slow), slow);
});

test('inertia: the coast decays as exp(-t/650 ms)', () => {
  const v = inertia({ x: 1, y: 0, zoom: 0 }, 650);
  assert.ok(near(v.x, Math.exp(-1), 1e-12));
  assert.ok(near(inertia({ x: 1, y: 0, zoom: 0 }, 325).x, Math.exp(-0.5), 1e-12));
});

test('followStep: yaw and pitch close the gap as 1 - exp(-dt/70 ms), distance and look at once; within a hair it is the goal', () => {
  const goal = { ...START, yaw: START.yaw - 0.32, pitch: 1.0, dist: 3000, look: { x: 50, y: 0, z: 0 } };
  const f = followStep(START, goal, 70);
  const k = 1 - Math.exp(-1);
  assert.ok(near(f.yaw, START.yaw - 0.32 * k, 1e-12));
  assert.ok(near(f.pitch, START.pitch + 0.1 * k, 1e-12));
  assert.equal(f.dist, 3000, 'a zoom never lags');
  assert.deepEqual(f.look, goal.look);
  assert.equal(followStep(START, START, 16), START, 'there already');
  assert.equal(followStep({ ...goal, yaw: goal.yaw + 5e-5 }, goal, 16), goal, 'within 1e-4 rad: the goal');
  assert.equal(followStep(START, goal, 0).yaw, START.yaw, 'no time, no move');
});

/** createGestures on a fake stage, touch and camera, the clock in the test's hand. */
function rig() {
  let now = 0, cb = null;
  let pose = orbitPose(START);
  const steers = [];
  const touch = { onPointer: (f) => { cb = f; return () => { cb = null; }; }, mode: () => 'explore' };
  const stage = { addEventListener() {}, removeEventListener() {} };
  // The yaw unwrapped across ±π (a long coast turns past half a revolution).
  let yaw = START.yaw;
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const cam = { pose: () => pose, steer: (p) => { yaw += wrap(orbitOf(p).yaw - orbitOf(pose).yaw); pose = p; steers.push(p); } };
  const limits = () => ({ near: 700, far: 8000, centre: { x: 0, y: 0, z: 0 }, reach: 3000 });
  const g = createGestures(stage, touch, cam, { limits, view: () => ({ W: 1368, H: 912, fov: 42 }), clock: () => now });
  const ev = (type, x, y) => cb({ type, pointerId: 1, clientX: x, clientY: y, button: 0 }, 'explore');
  const frame = (ms = 16) => { now += ms; g.frame(now); };
  g.frame(now);
  const run = (ms) => { for (let t = 0; t < ms; t += 16) frame(16); };
  return { ev, frame, run, g, yaw: () => yaw, steers, at: () => now };
}

test('a 100 px drag past the slop: 0.32 rad of target turn, the camera behind it while the finger moves, there after it stops', () => {
  const r = rig();
  r.ev('pointerdown', 400, 400);
  r.ev('pointermove', 400 + ORBIT.slopPx, 400); // the slop: no turn yet
  r.frame();
  assert.ok(near(r.yaw(), START.yaw, 1e-12), 'the slop turns nothing');
  // 100 px past the slop in ten moves, one a frame.
  const seen = [];
  for (let i = 1; i <= 10; i++) {
    r.ev('pointermove', 400 + ORBIT.slopPx + i * 10, 400);
    r.frame();
    seen.push(START.yaw - r.yaw()); // the turn drawn so far
  }
  const want = 100 * ORBIT.perPx;
  assert.ok(near(want, 0.32, 1e-12));
  for (let i = 0; i < 10; i++) {
    const target = (i + 1) * 10 * ORBIT.perPx;
    assert.ok(seen[i] > 0 && seen[i] < target - 1e-6, `frame ${i}: drawn ${seen[i].toFixed(4)} behind the finger's ${target.toFixed(4)}`);
    if (i) assert.ok(seen[i] > seen[i - 1], 'and moving toward it');
  }
  // The finger rests, then lifts (held past stillMs: nothing thrown): the camera catches up, exactly.
  r.run(200);
  r.ev('pointerup', 400 + ORBIT.slopPx + 100, 400);
  r.run(1000);
  assert.ok(near(START.yaw - r.yaw(), want, 1e-9), `lands on 0.32 rad (${(START.yaw - r.yaw()).toFixed(6)})`);
  assert.ok(!r.g.busy(), 'and comes to rest');
});

test('the follow lag is about 70 ms: one frame after a 100 px step the camera has come 1 - exp(-16/70) of the way', () => {
  const r = rig();
  r.ev('pointerdown', 400, 400);
  r.ev('pointermove', 400 + ORBIT.slopPx, 400);
  r.frame();
  r.ev('pointermove', 400 + ORBIT.slopPx + 100, 400);
  r.frame(16);
  assert.ok(near(START.yaw - r.yaw(), 0.32 * (1 - Math.exp(-16 / 70)), 1e-9));
  r.frame(54); // 70 ms in all
  assert.ok(near(START.yaw - r.yaw(), 0.32 * (1 - Math.exp(-1)), 1e-9), 'at 70 ms, 63 % of the way');
});

test('a finger down mid-follow stops the turn where it is drawn (a tap after a turn never fights its flight)', () => {
  const r = rig();
  r.ev('pointerdown', 400, 400);
  r.ev('pointermove', 400 + ORBIT.slopPx, 400);
  r.frame();
  r.ev('pointermove', 400 + ORBIT.slopPx + 100, 400);
  r.frame();
  r.run(200);
  r.ev('pointerup', 400 + ORBIT.slopPx + 100, 400);
  r.frame();
  const drawn = r.yaw();
  r.ev('pointerdown', 700, 400);
  r.run(500);
  assert.ok(near(r.yaw(), drawn, 1e-12), 'stays where it was drawn');
  r.ev('pointerup', 700, 400);
  r.frame();
  assert.ok(!r.g.busy(), 'at rest, the camera free for a tap\'s flight');
});

test('a 3000 px/s fling is capped: the coast starts at maxVel and carries about maxVel × τ px, decaying with τ', () => {
  const r = rig();
  r.ev('pointerdown', 200, 400);
  r.ev('pointermove', 200 + ORBIT.slopPx, 400);
  r.frame();
  for (let i = 1; i <= 8; i++) {
    r.ev('pointermove', 200 + ORBIT.slopPx + i * 48, 400); // 48 px a 16 ms frame: 3 px/ms
    r.frame(16);
  }
  const atLift = 8 * 48 * ORBIT.perPx; // the finger's turn when it lifts
  r.ev('pointerup', 200 + ORBIT.slopPx + 8 * 48, 400);
  // The goal coasts on: measure the drawn turn once the follow has caught up and the coast is out.
  r.run(ORBIT.tauMs * 9);
  assert.ok(!r.g.busy(), 'the coast comes to rest');
  const coast = (START.yaw - r.yaw()) - atLift;
  const capped = ORBIT.maxVel * ORBIT.tauMs * ORBIT.perPx; // ∫ maxVel e^(-t/τ) dt, in rad
  const uncapped = 3 * ORBIT.tauMs * ORBIT.perPx;
  assert.ok(Math.abs(coast - capped) < capped * 0.03, `coast ${coast.toFixed(3)} rad ≈ the capped ${capped.toFixed(3)}, not ${uncapped.toFixed(3)}`);
});

test('the coast decays with τ: the turn added over successive τ windows falls by e each', () => {
  const r = rig();
  r.ev('pointerdown', 200, 400);
  r.ev('pointermove', 200 + ORBIT.slopPx, 400);
  r.frame();
  for (let i = 1; i <= 8; i++) {
    r.ev('pointermove', 200 + ORBIT.slopPx + i * 16, 400); // 1 px/ms: under the cap
    r.frame(16);
  }
  r.ev('pointerup', 200 + ORBIT.slopPx + 8 * 16, 400);
  r.run(400); // the follow settles behind the coast
  const y0 = r.yaw();
  r.run(ORBIT.tauMs);
  const y1 = r.yaw();
  r.run(ORBIT.tauMs);
  const y2 = r.yaw();
  const ratio = (y0 - y1) / (y1 - y2);
  assert.ok(Math.abs(ratio - Math.E) < 0.1, `ratio ${ratio.toFixed(3)} ≈ e`);
});
