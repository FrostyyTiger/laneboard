// Motion for the Map: the few pieces of maths every movement on it is made of.
//
// Pure functions, no DOM, so they are tested in Node (test/motion.test.mjs).
//
//   damp(x, v, goal, halfLife, dt)   a critically damped spring: no overshoot,
//                                    no fixed duration, and it keeps its
//                                    velocity when the goal moves mid-flight
//   wrapAngle(a)                     the shortest way round, in (-π, π]
//   flight(from, to)                 a camera path that zooms out, pans and
//                                    zooms back in (van Wijk & Nuij, 2003)
//   inertia(v, dt, tau)              a released drag gliding to a stop
//
// Why a spring and not an easing curve: an eased tween has a duration fixed
// up front, so a new target mid-way either waits or jumps. Exponential
// smoothing (x += (goal - x) * k) has no duration but starts at full speed,
// which reads as a jolt. A critically damped spring starts from the speed it
// already has, accelerates, and settles without bouncing.

const LN2_4 = 4 * Math.LN2;

/**
 * One step of a critically damped spring, exactly (not Euler), so it is
 * stable at any frame rate. `halfLife` is the time in ms for the remaining
 * distance to halve; `dt` is in ms. Returns [x, v], v in units per ms.
 * After Daniel Holden, "Spring-It-On" (theorangeduck.com/page/spring-roll-call).
 */
export function damp(x, v, goal, halfLife, dt) {
  if (halfLife <= 0 || dt >= halfLife * 40) return [goal, 0];
  const y = LN2_4 / halfLife / 2;
  const j0 = x - goal;
  const j1 = v + j0 * y;
  const e = Math.exp(-y * dt);
  return [e * (j0 + j1 * dt) + goal, e * (v - j1 * y * dt)];
}

/** At rest: within `eps` of the goal and barely moving. */
export const settled = (x, v, goal, eps) => Math.abs(x - goal) < eps && Math.abs(v) < eps / 16;

const TAU = Math.PI * 2;
export function wrapAngle(a) {
  const r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const RHO = Math.SQRT2;
const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x) => { const e = Math.exp(2 * x); return Number.isFinite(e) ? (e - 1) / (e + 1) : 1; };

/**
 * The optimal path between two views, each [cx, cy, w] with w the width of
 * world in view. Far apart, it pulls back to keep both ends in sight and
 * comes in again; close together, it is a plain pan and zoom.
 * Returns { at(t) -> [cx, cy, w], ms } with t in 0..1 and ms a duration that
 * grows with the perceived distance, clamped to [minMs, maxMs].
 * After van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003),
 * the same formula as d3.interpolateZoom.
 */
export function flight(from, to, { minMs = 320, maxMs = 900, msPerUnit = 420 } = {}) {
  const [ux0, uy0, w0] = from;
  const [ux1, uy1, w1] = to;
  const dx = ux1 - ux0, dy = uy1 - uy0;
  const d2 = dx * dx + dy * dy;
  let S, at;
  if (d2 < 1e-12 || !(w0 > 0) || !(w1 > 0)) {
    S = Math.abs(Math.log((w1 || 1) / (w0 || 1))) / RHO;
    at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.pow((w1 || 1) / (w0 || 1), t)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    const ch0 = cosh(r0), sh0 = sinh(r0);
    at = (t) => {
      if (t >= 1) return [ux1, uy1, w1];
      const s = t * S;
      const u = (w0 / (2 * d1)) * (ch0 * tanh(RHO * s + r0) - sh0);
      return [ux0 + u * dx, uy0 + u * dy, (w0 * ch0) / cosh(RHO * s + r0)];
    };
  }
  const ms = Math.max(minMs, Math.min(maxMs, S * msPerUnit));
  return { at, ms };
}

/** A gliding velocity after `dt` ms, decaying with time constant `tau` ms. */
export const inertia = (v, dt, tau = 325) => v * Math.exp(-dt / tau);

/**
 * When each node of a change starts to move. Exits go first, then what
 * stays slides to its new place, then entries grow in one after another
 * around the circle: three short beats instead of everything at once.
 * (Heer & Robertson, "Animated transitions in statistical data graphics", 2007.)
 */
export function stage({ exits = 0, moves = 0, entries = [] }, { exitMs = 160, moveMs = 220, stepMs = 22, spreadMs = 380 } = {}) {
  const moveAt = exits ? exitMs : 0;
  const enterAt = moveAt + (moves ? moveMs : 0);
  const step = entries.length > 1 ? Math.min(stepMs, spreadMs / (entries.length - 1)) : 0;
  const at = new Map(entries.map((id, i) => [id, enterAt + i * step]));
  return { moveAt, enterAt, at };
}
