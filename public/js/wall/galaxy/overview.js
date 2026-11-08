// The overview with every site in sight (Wall plan night 2 T19, reviews/r15-dreamer.md 2):
// scene.js `overviewShot` frames the whole galaxy round the hub, and on the
// tablet the far fleet block (bottom right) sat on CLOUD, star and name, so
// the hallway counted four systems of five. `fitOverview` slides the shot
// (it never turns: panShot) and, when sliding is not enough, stands it back,
// the least it can, until every site's star and one side for its name are
// clear of the words over the canvas (hud.js covers, grown by a gap).
//
// `createOverviewFit` keeps a fit while it still clears (the overview holds one
// pose since T24, but a site grows, goes or changes its name's tone; the check
// uses half the gap, the search the whole, so it does not flip at the edge;
// new covers keep it too while it clears), searches near it when it does
// not, and eases the camera to the new fit: one camera, never a cut. `fitOverview`, `fitShot`, `siteClear`, `siteMarks` are pure
// (test/wall-galaxy-overview.test.mjs).

import { panShot } from './framing.js';
import { ease } from './layout.js';
import { candidates, labelSize, labelText } from './labels.js';
import { toneOf, worseTone } from './palette.js';

/**
 * `gap`: css px kept between a site (or its name) and a cover when a fit is
 * chosen; `pulls`: how far the camera may stand back (1: as overviewShot);
 * `shift`: the furthest the hub may slide from the frame's middle (ndc, each
 * axis) in `step`s; `easeMs`: how long the camera takes to a new fit (eased in and out);
 * `retryMs`: how long a fit that clears nothing whole waits before the next search.
 * `shift` 0.6 since night 5's rosette (T1): five sites round the sun fill a
 * snug frame evenly, so the widest plate (the left half's top) always holds
 * two of them, and the fit must slide the galaxy past it (0.4 was enough
 * for nights 1-4's lopsided arms).
 */
export const OVERVIEW_FIT = Object.freeze({ gap: 24, pulls: [1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6], shift: 0.6, step: 0.05, easeMs: 1500, retryMs: 1000 });

/** No change: the shot as overviewShot gives it. */
export const NO_FIT = Object.freeze({ k: 1, dx: 0, dy: 0 });

/** Every fit the search may take. */
const GRID = (() => {
  const { pulls, shift, step } = OVERVIEW_FIT;
  const n = Math.round(shift / step);
  const out = [];
  for (const k of pulls) for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) out.push({ k, dx: i * step, dy: j * step });
  return out;
})();

/** How far apart two fits are: a pull counts twice a slide of the same size. */
const apart = (a, b) => Math.abs(a.k - b.k) * 2 + Math.hypot(a.dx - b.dx, a.dy - b.dy);

/** The grid within `within` of `near`, nearest first (ties: the smaller change from NO_FIT). */
const triesFrom = (near, within = Infinity) => GRID.map((t) => ({ t, c: apart(t, near), o: apart(t, NO_FIT) }))
  .filter((x) => x.c <= within)
  .sort((a, b) => a.c - b.c || a.o - b.o)
  .map((x) => x.t);
const FROM_NONE = triesFrom(NO_FIT);

/** A refit looks this near the held fit first (a few steps), the whole grid only when nothing there clears. */
const NEAR = 0.16;

/** `shot` stood back `k` times from its look-at, then slid so the look-at lands at ndc (`dx`, `dy`). Pure. */
export function fitShot(shot, fit, fov, aspect) {
  const { k = 1, dx = 0, dy = 0 } = fit ?? NO_FIT;
  const l = shot.look;
  const back = { pos: { x: l.x + (shot.pos.x - l.x) * k, y: l.y + (shot.pos.y - l.y) * k, z: l.z + (shot.pos.z - l.z) * k }, look: l };
  return dx || dy ? panShot(back, l, { x: dx, y: dy }, fov, aspect) : back;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** A projector for `shot` on a `W`×`H` frame: world point → css px and css px per world unit there, null behind. */
function projector(shot, { fov, W, H }) {
  const f = norm(sub(shot.look, shot.pos));
  const r = norm({ x: -f.z, y: 0, z: f.x }); // f × up
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const t = Math.tan((fov * Math.PI) / 360);
  const aspect = W / H;
  return (p) => {
    const d = sub(p, shot.pos);
    const z = dot(d, f);
    if (z <= 0) return null;
    return { x: (dot(d, r) / (z * t * aspect) + 1) / 2 * W, y: (1 - dot(d, u) / (z * t)) / 2 * H, unit: H / (2 * t * z) };
  };
}

const grown = (c, g) => ({ x: c.left - g, y: c.top - g, w: c.right - c.left + 2 * g, h: c.bottom - c.top + 2 * g });
const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (b, W, H) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H;

/**
 * True when `mark` (`{ p, r, w, h }`: a site's star in world units, its
 * name's box in css px) is clear seen through `at` (projector): the star
 * inside the frame and off every cover (`boxes`, already grown), and one of
 * the four sides its name may take (labels.js candidates; a site's name
 * never stacks, T17) as well. Pure.
 */
export function siteClear(at, mark, boxes, W, H) {
  const s = at(mark.p);
  if (!s) return false;
  const rp = (mark.r ?? 0) * s.unit;
  const star = { x: s.x - rp, y: s.y - rp, w: 2 * rp, h: 2 * rp };
  if (!within(star, W, H) || boxes.some((b) => meets(star, b))) return false;
  return candidates(s.x, s.y, rp, mark.w, mark.h)
    .some((c) => within(c, W, H) && !boxes.some((b) => meets(c, b)));
}

/** How many of `marks` are clear from `shot` (siteClear), the covers grown by `gap`. Pure. */
export function clearCount(shot, marks, view, gap = OVERVIEW_FIT.gap) {
  const boxes = (view.covers ?? []).filter(Boolean).map((c) => grown(c, gap));
  const at = projector(shot, view);
  let n = 0;
  for (const m of marks) if (siteClear(at, m, boxes, view.W, view.H)) n += 1;
  return n;
}

/**
 * The change to `shot` (fitShot's `{ k, dx, dy }`) nearest `near` (NO_FIT:
 * the least change; the fit held so far, so a refit moves the galaxy a
 * little, never across the frame) that leaves every mark clear of
 * `view.covers` (`{ fov, W, H, covers }`), with `clear` true; when none
 * does, the one that clears the most, `clear` false. No covers or nothing
 * to clear: NO_FIT. Pure.
 */
export function fitOverview(shot, marks, view, gap = OVERVIEW_FIT.gap, near = null) {
  if (!marks.length || !(view.W > 0 && view.H > 0)) return { ...NO_FIT, clear: true };
  const aspect = view.W / view.H;
  let best = null, most = -1;
  for (const tries of near ? [triesFrom(near, NEAR), FROM_NONE] : [FROM_NONE]) {
    for (const t of tries) {
      const n = clearCount(fitShot(shot, t, view.fov, aspect), marks, view, gap);
      if (n === marks.length) return { k: t.k, dx: t.dx, dy: t.dy, clear: true };
      if (n > most) { most = n; best = t; }
    }
  }
  return { k: best.k, dx: best.dx, dy: best.dy, clear: false };
}

/**
 * The far fleet block as wide as it can get, `maxW` css px (its line's cap
 * plus the block's padding), kept on its right edge. The overview fit
 * reserves that from the first far block seen, so a longer problem later
 * does not move the galaxy (T24: every overview finds the names where the
 * last one left them). Pure.
 */
export function widestFar(box, maxW) {
  if (!box || !(maxW > 0)) return box ?? null;
  return { ...box, left: Math.min(box.left, box.right - maxW) };
}

/**
 * The overview's fit over time. `view()` gives `{ fov, W, H, covers }` now,
 * `marks(sites)` the sites as fitOverview's marks; `easeMs` 0 snaps (reduced
 * motion: no camera motion but the fit itself). Returns `(shot, sites, now)`
 * → the fitted shot.
 */
export function createOverviewFit({ view, marks, easeMs = OVERVIEW_FIT.easeMs, retryMs = OVERVIEW_FIT.retryMs } = {}) {
  let want = null; // the fit chosen, { k, dx, dy, clear }
  let from = { ...NO_FIT }, t0 = null; // the fit the camera leaves, and when it left
  let at = { ...NO_FIT }; // the fit drawn, eased from `from` to `want`
  let key = null, tried = -Infinity;
  return (shot, sites, now) => {
    const v = view();
    const ms = marks(sites);
    const k = JSON.stringify([v.W, v.H, v.covers, ms.map((m) => [m.w, m.h, m.trouble])]);
    const aspect = v.W / v.H;
    // New covers, a new frame or a renamed site keep the fit held while it
    // still clears: the widest fleet block grows over the first minutes, and
    // each overview should find the names where the last one left them (T24).
    const stale = want == null
      || (!want.clear && (k !== key || now - tried >= retryMs))
      || (want.clear && clearCount(fitShot(shot, want, v.fov, aspect), ms, v, OVERVIEW_FIT.gap / 2) < ms.length);
    key = k;
    if (stale) {
      // A fit worn out moves on from where it is, the least it can.
      const next = fitOverview(shot, ms, v, OVERVIEW_FIT.gap, want);
      tried = now;
      // The first fit is taken at once; a new one is flown to, eased in and out.
      if (want == null || !(easeMs > 0)) at = { k: next.k, dx: next.dx, dy: next.dy };
      else if (next.k !== want.k || next.dx !== want.dx || next.dy !== want.dy) { from = at; t0 = now; }
      want = next;
    }
    if (t0 != null) {
      const e = ease((now - t0) / easeMs);
      at = { k: from.k + (want.k - from.k) * e, dx: from.dx + (want.dx - from.dx) * e, dy: from.dy + (want.dy - from.dy) * e };
      if (e >= 1) t0 = null;
    }
    return fitShot(shot, at, v.fov, aspect);
  };
}

/**
 * The sites of a world as fitOverview's marks: the star (scene.js
 * `starRadius`) and the folded name labels.js gives it (the worst it holds,
 * at the site step `sitePx`). A site growing in or going (alive under half) is not named, so not fitted. Pure.
 */
export function siteMarks(sites, sitePx, starRadius = 24) {
  const out = [];
  for (const s of sites ?? []) {
    if ((s.alive ?? 1) < 0.5) continue;
    const tone = worseTone(toneOf(s.node), toneOf(s.status));
    const { w, h } = labelSize(labelText(s.node, tone), sitePx, 'label');
    out.push({ p: s.home, r: s.starRadius ?? starRadius, w, h });
  }
  return out;
}
