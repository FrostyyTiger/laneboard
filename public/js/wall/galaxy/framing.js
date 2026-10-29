// Where a held system sits on the screen (Wall plan night 2 T18, reviews/r15-dreamer.md 1):
// not in the middle of the frame, where the caption plate (top left) and the
// far fleet block (bottom right) cover it, but in the middle of what is left.
// `freeRect` finds the largest free box beside the covers, `panShot` slides a
// shot so a point lands at a given spot of the frame, `fitDistance` how far
// back the camera stands for the open system's reach to fit that box.
//
// Pure (test/wall-galaxy-framing.test.mjs); scene.js `siteShot` uses them
// when given a `view`, camera.js eases the free box so the frame never jumps
// when a plate comes or goes.

/**
 * Room kept between a cover and the free box (css px); the reach's margin
 * (fitDistance); `inward`: a system whose reach is over this share of its
 * distance from the hub is shot from the side (scene.js siteShot): on the
 * large demo `lab` (0.41) is, `hv2` (0.26) is not; `aside` is that camera's
 * bearing from the star, in radians from the sunward one (-65°): the sun
 * stays off the tablet frame's right edge over the whole sway, for any
 * caption plate over about 500 px wide (night 5 T1b; looking in from
 * outside, as nights 2-4 did, put it on the tag).
 */
export const FRAMING = Object.freeze({ gap: 24, margin: 1.25, inward: 0.33, aside: (-65 * Math.PI) / 180 });

/**
 * The largest box of a `W`×`H` frame (css px) that meets no cover
 * (`{left, top, right, bottom}`, each grown by `gap`), as fractions of the
 * frame `{ x0, y0, x1, y1 }`. "Largest" is the one a circle fits best (the
 * open system is round), then the larger area. The whole frame without covers.
 */
export function freeRect(W, H, covers = [], gap = FRAMING.gap) {
  const whole = { x0: 0, y0: 0, x1: 1, y1: 1 };
  if (!(W > 0 && H > 0)) return whole;
  const boxes = (Array.isArray(covers) ? covers : [])
    .filter((c) => c && [c.left, c.top, c.right, c.bottom].every(Number.isFinite))
    .map((c) => ({ l: Math.max(0, c.left - gap), t: Math.max(0, c.top - gap), r: Math.min(W, c.right + gap), b: Math.min(H, c.bottom + gap) }))
    .filter((c) => c.r > c.l && c.b > c.t);
  if (!boxes.length) return whole;
  const xs0 = [0, ...boxes.map((c) => c.r)], xs1 = [W, ...boxes.map((c) => c.l)];
  const ys0 = [0, ...boxes.map((c) => c.b)], ys1 = [H, ...boxes.map((c) => c.t)];
  let best = null, bestFit = -1, bestArea = -1;
  for (const x0 of xs0) for (const x1 of xs1) {
    if (x1 <= x0) continue;
    for (const y0 of ys0) for (const y1 of ys1) {
      if (y1 <= y0) continue;
      if (boxes.some((c) => c.l < x1 && c.r > x0 && c.t < y1 && c.b > y0)) continue;
      const fit = Math.min(x1 - x0, y1 - y0), area = (x1 - x0) * (y1 - y0);
      if (fit > bestFit || (fit === bestFit && area > bestArea)) {
        best = { x0, y0, x1, y1 }; bestFit = fit; bestArea = area;
      }
    }
  }
  if (!best || bestFit < Math.min(W, H) * 0.25) return whole; // covers everywhere: the middle is the least bad
  return { x0: best.x0 / W, y0: best.y0 / H, x1: best.x1 / W, y1: best.y1 / H };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** The camera's axes looking from `pos` at `look`, world up +y (three's `lookAt`). */
function axes(pos, look) {
  const f = norm(sub(look, pos));
  const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
  return { f, r, u: cross(r, f) };
}

/**
 * Where `p` lands in normalised device coordinates (-1..1, y up) seen from
 * `shot` with field of view `fov` (degrees, vertical) and `aspect`; null behind.
 */
export function ndcOf(shot, p, fov, aspect) {
  const { f, r, u } = axes(shot.pos, shot.look);
  const d = sub(p, shot.pos);
  const z = dot(d, f);
  if (z <= 0) return null;
  const t = Math.tan((fov * Math.PI) / 360);
  return { x: dot(d, r) / (z * t * aspect), y: dot(d, u) / (z * t) };
}

/**
 * How far `shot`'s camera must step back along its line of sight (world
 * units, 0 when it need not) so `p` lands within `keep` (0..1) of the frame's
 * half-width and half-height (camera.js flightPose, night 3 T1). Stepping
 * back keeps the look-at, so the frame's middle stays where it was.
 */
export function standBack(shot, p, fov, aspect, keep = 1) {
  const { f, r, u } = axes(shot.pos, shot.look);
  const d = sub(p, shot.pos);
  const t = Math.tan((fov * Math.PI) / 360) * keep;
  const need = Math.max(Math.abs(dot(d, r)) / (t * aspect), Math.abs(dot(d, u)) / t, 1e-6);
  return Math.max(0, need - dot(d, f));
}

/**
 * `shot` slid sideways and up or down (it keeps its direction, so what was
 * behind the camera, the sun, stays behind it) so `p`, at its look-at, lands
 * at `ndc` ({x, y}, -1..1, y up).
 */
export function panShot(shot, p, ndc, fov, aspect) {
  const { f, r, u } = axes(shot.pos, shot.look);
  const z = dot(sub(p, shot.pos), f);
  if (!(z > 0)) return shot;
  const t = Math.tan((fov * Math.PI) / 360);
  const dx = ndc.x * t * aspect * z, dy = ndc.y * t * z;
  const move = (q) => ({ x: q.x - r.x * dx - u.x * dy, y: q.y - r.y * dx - u.y * dy, z: q.z - r.z * dx - u.z * dy });
  return { pos: move(shot.pos), look: move(shot.look) };
}

/** The point of the frame (ndc) at the middle of the free box `free` (fractions, y down). */
export function freeCentre(free) {
  return { x: free.x0 + free.x1 - 1, y: 1 - (free.y0 + free.y1) };
}

/**
 * How far from the star the camera stands (straight-line) so a ball of
 * radius `reach` round it fits inside `free` (fractions). `margin` is for
 * the near side, drawn larger than the star's depth says (1.15 was the
 * least that held every system of the large demo over a whole sway).
 */
export function fitDistance(reach, free, fov, aspect, margin = FRAMING.margin) {
  const t = Math.tan((fov * Math.PI) / 360);
  const half = Math.min((free.x1 - free.x0) * t * aspect, (free.y1 - free.y0) * t);
  return half > 0 ? (reach * margin) / half : Infinity;
}

/** `a` eased toward `b` by `k` (0..1), box by box. */
export function blendRect(a, b, k) {
  if (!a) return b;
  const l = (x, y) => x + (y - x) * k;
  return { x0: l(a.x0, b.x0), y0: l(a.y0, b.y0), x1: l(a.x1, b.x1), y1: l(a.y1, b.y1) };
}

/** The box round both covers `a` and `b` (`{left, top, right, bottom}`; either may be null). */
export function unionBox(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}
