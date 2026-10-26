// The tether (Wall plan night 2 T20, reviews/r15-dreamer.md 3): at the
// overview, a hairline in the status hue from the far fleet line (bottom
// right, `■ HV2 · STORAGE`) to the cluster it names, so the eye does not
// have to match the word to the place by reading both. It is drawn in once
// per overview leg (TETHER.drawMs, about as long as a name typing in), after
// the camera is back out, and then stays still: the overview holds one pose
// (T24). It fades when the camera leaves for a system (the caption's leader
// takes over there).
//
// `tetherSite`, `tetherLine` and `tetherProgress` are pure
// (test/wall-galaxy-tether.test.mjs); `createTether` is the DOM part, one
// 1 px span stretched by transform as the lock's leader is.

import { TROUBLE, byIdOf } from '../../views/map/model.js';
import { worstLine } from '../frame.js';

/**
 * `drawMs` the draw-in, `outMs` the fade when the camera leaves (wall.css
 * keeps the same number), `gap` css px kept clear of the words and the star.
 */
export const TETHER = Object.freeze({ drawMs: 600, outMs: 400, gap: 10, minLen: 40 });

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** Ease out cubic: quick from the word, settling on the place. */
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * The site the fleet line names in `model`, as `{ id, tone }`, or null (a
 * calm fleet, a problem in no site, a site the galaxy does not draw).
 * `worstLine` says which problem the line shows; this finds its node (same
 * label and status, in the named site) and walks up to the site. `drawn` is
 * the ids of the sites on screen (all, when not given).
 */
export function tetherSite(model, drawn = null) {
  const w = worstLine(model);
  if (!w.glyph) return null;
  const list = (Array.isArray(model?.nodes) ? model.nodes : []).filter((n) => n && typeof n.id === 'string');
  const byId = byIdOf(list);
  const siteOf = (n) => {
    const seen = new Set();
    for (let x = n; x && !seen.has(x.id); x = byId.get(x.parent)) {
      seen.add(x.id);
      if (x.kind === 'site') return x;
    }
    return null;
  };
  const ok = drawn ? new Set(drawn) : null;
  for (const n of list) {
    if (!TROUBLE.includes(n.status) || n.status !== w.status || String(n.label ?? n.id) !== w.name) continue;
    const site = siteOf(n);
    if (!site) continue;
    // The line says `site · name`, or just the name when the site is the problem.
    if (w.site != null ? String(site.label ?? site.id) !== w.site : site !== n) continue;
    if (ok && !ok.has(site.id)) return null;
    return { id: site.id, tone: w.tone };
  }
  return null;
}

/**
 * The hairline from the fleet line's box `from` (`{ left, top, right,
 * bottom, glyph }`, `glyph` the shape's centre x) to a star drawn at `to`
 * (`{ x, y, r }`), `t` of the way (0..1, already eased): `{ x, y, len,
 * angle }` for a 1 px line stretched from its left end, or null when there
 * is nothing to draw. It leaves the words from their top edge, above the
 * shape when the place is left of it, above the word's own letters when the
 * place is right of it (never across the letters); from their left edge when
 * the place is not above them. It stops `gap` short of the star's rim.
 */
export function tetherLine(from, to, t = 1, { gap = TETHER.gap, minLen = TETHER.minLen } = {}) {
  if (!from || !to || ![from.left, from.top, from.right, from.bottom, to.x, to.y].every(Number.isFinite)) return null;
  const glyph = Number.isFinite(from.glyph) ? from.glyph : from.left;
  let x, y;
  if (to.y < from.top - gap) {
    x = Math.min(from.right, Math.max(glyph, to.x));
    y = from.top - gap;
  } else {
    x = from.left - gap;
    y = (from.top + from.bottom) / 2;
  }
  const dx = to.x - x, dy = to.y - y;
  const dist = Math.hypot(dx, dy);
  const full = dist - (Number.isFinite(to.r) && to.r > 0 ? to.r : 0) - gap;
  if (!(full >= minLen)) return null;
  return { x, y, len: full * clamp01(t), angle: Math.atan2(dy, dx) };
}

/** How far drawn in at `now` for a draw that starts at `startAt`: 0..1, eased. */
export function tetherProgress(now, startAt, drawMs = TETHER.drawMs) {
  if (!Number.isFinite(startAt)) return 0;
  if (!(drawMs > 0)) return now >= startAt ? 1 : 0;
  return easeOut(clamp01((now - startAt) / drawMs));
}

/**
 * The tether inside `root` over the galaxy camera `cam` (camera.js `onDraw`,
 * `screenOf`). `update(model, drawn)` takes the site the fleet line names;
 * `show(delayMs)` draws it in after `delayMs` (an overview leg: the flight
 * back out; nothing when it is up already), `hide()` fades it (a site leg). `anchor()` gives the fleet
 * line's box in `root`'s px (read only after `update` brought other words,
 * `remeasure()` or the first draw, never per frame). `clock` is injectable.
 */
export function createTether(root, cam, { clock = globalThis.performance, anchor = null, timing = TETHER } = {}) {
  const line = document.createElement('span');
  line.className = 'galaxy-tether';
  line.style.opacity = '0';
  root.append(line);

  let site = null;     // { id, tone }
  let on = false;      // an overview leg
  let startAt = null;
  let leftAt = null;   // when hide() came: it fades over timing.outMs
  let box = null;
  let dirty = true;
  let shown = false;
  let last = null;

  const fade = () => {
    if (shown) line.style.opacity = '0';
    shown = false;
    last = null;
    leftAt = null;
  };
  // The fade's share, as a custom property the sheet multiplies its opacity by.
  let kShown = '';
  const setK = (k) => {
    const v = k >= 1 ? '1' : k.toFixed(3);
    if (v === kShown) return;
    kShown = v;
    line.style.setProperty('--tether-k', v);
  };

  const paint = () => {
    const now = clock.now();
    const out = leftAt != null && shown ? 1 - (now - leftAt) / timing.outMs : 1;
    if (!site || out <= 0 || (!on && leftAt == null)) { fade(); return; }
    if (now < startAt) return;
    // Not laid out yet (no words, no box): try again next frame.
    if (dirty) { box = typeof anchor === 'function' ? anchor() : null; dirty = box == null; }
    const sp = cam.screenOf(site.id);
    const g = sp ? tetherLine(box, sp, tetherProgress(now, startAt, timing.drawMs), timing) : null;
    if (!g) { fade(); return; }
    // Still once drawn: write only when the line moved (the overview's fit eases once per page life).
    const tf = `translate3d(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px, 0) rotate(${g.angle.toFixed(4)}rad) scaleX(${g.len.toFixed(1)})`;
    if (tf !== last?.tf) line.style.transform = tf;
    setK(out);
    if (!shown) line.style.opacity = '';
    shown = true;
    last = { ...g, id: site.id, tf };
  };
  const off = cam.onDraw(paint);

  const update = (model, drawn = null) => {
    const next = tetherSite(model, drawn);
    const same = next?.id === site?.id && next?.tone === site?.tone;
    dirty = true;
    if (same) return;
    site = next;
    if (site) line.dataset.tone = site.tone;
    // Another place named while it shows: draw it in again, from the word.
    if (on || leftAt != null) { fade(); startAt = clock.now(); }
  };

  return {
    update,
    show: (delayMs = 0) => {
      // Already up (an overview after an overview, a parked still): it stays as drawn.
      if (on) return;
      on = true;
      leftAt = null;
      setK(1);
      fade();
      dirty = true;
      startAt = clock.now() + Math.max(0, Number(delayMs) || 0);
    },
    hide: () => {
      if (!on) return;
      on = false;
      if (shown) leftAt = clock.now(); else fade();
    },
    remeasure: () => { dirty = true; },
    /** What the last frame drew (null: nothing), for tests and the console. */
    state: () => ({ site: site ? { ...site } : null, on, startAt, box, drawn: last ? { ...last } : null }),
    el: line,
    destroy: () => { off?.(); line.remove(); },
  };
}
