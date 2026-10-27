// The fan (Wall plan night 4 T3, reviews/r51-touch galaxy 3, option (a)):
// in an open system a planet's nearest neighbour is often nearer than the
// finger's disc (HV1 of the large demo: all 41 members), and "worst tone,
// then the nearest" leaves a calm planet beside a trouble one unreachable
// and two trouble planets 8 px apart a coin toss. So a tap whose disc holds
// two or more members (touch.js hitAll) opens none of them: their names fan
// out round the finger, one row each, and the next tap on a row opens that
// planet. A tap anywhere else, a drag, a step back or the tour closes it.
//
// Why (a), not (b) (the site sheet's trouble members as rows): the sheet
// names the worst and two more (caption.js MAX_LINES), so a fourth trouble
// planet would still need the scene; and the fan works for calm planets too,
// which (b) never reaches. The sheet's rows stay targets as before (T1).
//
// `fanLayout` and `fanHit` are pure (test/wall-galaxy-fan.test.mjs);
// `createFan` is the DOM part: rows and their leaders in `.galaxy-fan`, out
// from under the finger in FAN.inMs, each leader following its planet every
// frame (`cam.onDraw`), the names (labels.js) keeping off the rows.

import { labelText } from './labels.js';

/**
 * The fan's measures: `rowPx` a row's height (night 2's 48 px floor),
 * `pitchPx` row to row (fanHit gives the gap between two rows to the
 * nearer), `ringPx` the least distance from the finger to a row's inner
 * end, `max` rows at most (the worst first, so trouble is never cut),
 * `marginPx` from the stage's edge, `padPx` inside a row, `minW`/`maxW` a
 * row's width, `inMs` the rows' way out from under the finger.
 */
export const FAN = Object.freeze({
  rowPx: 48, pitchPx: 60, ringPx: 72, max: 12, marginPx: 16, padPx: 16, minW: 140, maxW: 340, inMs: 220,
});

/**
 * The fan's rows for `hits` (hitAll's, worst first) under a finger at `x`,
 * `y` on a `W`×`H` stage, set in mono at `fontPx` (`text(p)` the words of a
 * row, its id by default). The rows stand in two arcs of a ring round the
 * finger, the members left of it on the left, the others on the right, each
 * side top to bottom as they are on screen, so a row is where its planet
 * is. The whole ring moves inward as one to keep clear of the stage's edges.
 * Returns `{ x, y, items }` (the ring's centre) with each item `{ id, site,
 * tone, text, side, i, box: { left, top, right, bottom }, anchor: { x, y },
 * to: { x, y } }`: `anchor` the row's inner end, `to` its planet when
 * tapped. Pure.
 */
export function fanLayout(hits, x, y, opts = {}) {
  const { W, H, fontPx = 18 } = opts;
  const text = typeof opts.text === 'function' ? opts.text : (p) => String(p.id);
  const f = FAN;
  const picked = (hits ?? []).slice(0, f.max);
  const byX = [...picked].sort((a, b) => a.x - b.x);
  const half = Math.floor(byX.length / 2);
  const sides = { left: byX.slice(0, half), right: byX.slice(half) };
  for (const k of ['left', 'right']) sides[k].sort((a, b) => a.y - b.y);
  const rows = Math.max(sides.left.length, sides.right.length);
  const reach = ((rows - 1) / 2) * f.pitchPx;
  const ring = Math.max(f.ringPx, reach + f.pitchPx / 2);
  const width = (p) => Math.round(Math.min(f.maxW, Math.max(f.minW, 2 * f.padPx + text(p).length * MONO_EM * fontPx)));
  const wide = { left: Math.max(0, ...sides.left.map(width)), right: Math.max(0, ...sides.right.map(width)) };
  const span = (lo, hi, v, whole) => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : whole / 2);
  const cx = span(f.marginPx + ring + wide.left, W - f.marginPx - ring - wide.right, x, W);
  const cy = span(f.marginPx + reach + f.rowPx / 2, H - f.marginPx - reach - f.rowPx / 2, y, H);
  const items = [];
  for (const side of ['left', 'right']) {
    const list = sides[side];
    list.forEach((p, i) => {
      const dy = (i - (list.length - 1) / 2) * f.pitchPx;
      const off = Math.sqrt(ring * ring - dy * dy);
      const w = width(p);
      const inner = side === 'left' ? cx - off : cx + off;
      const left = Math.round(side === 'left' ? inner - w : inner);
      const top = Math.round(cy + dy - f.rowPx / 2);
      items.push({
        id: p.id, site: p.site, tone: p.tone, text: text(p), side, i,
        box: { left, top, right: left + w, bottom: top + f.rowPx },
        anchor: { x: Math.round(inner), y: Math.round(cy + dy) },
        to: { x: p.x, y: p.y },
      });
    });
  }
  return { x: cx, y: cy, items };
}

/**
 * The row of `fan` (fanLayout's) under a finger at `x`, `y`: a row's box,
 * grown by half the gap above and below so the rows tile, or null. Pure.
 */
export function fanHit(fan, x, y) {
  const g = (FAN.pitchPx - FAN.rowPx) / 2;
  for (const it of fan?.items ?? []) {
    const b = it.box;
    if (x >= b.left && x <= b.right && y >= b.top - g && y <= b.bottom + g) return it;
  }
  return null;
}

/** A mono glyph's width in em (labels.js, wall.css). */
const MONO_EM = 0.62;

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** Ease out cubic: quick off the finger, settling in place. */
const easeOut = (t) => 1 - (1 - t) ** 3;

/** A member's words on its row: as its name in the scene (labels.js labelText, mono). */
export const fanText = (p) => labelText(p.node ?? { id: p.id }, p.tone, 'mono');

/**
 * `createFan(root, { screenOf, size, fontPx, still, clock, doc })` → `{
 * show(hits, x, y), hide(), shown(), hit(x, y), covers(), draw() }`. `root`
 * the fan's layer (empty, hidden until shown); `screenOf(id)` where a planet
 * is drawn now (camera.js); `size()` the stage's `{ W, H }`; `fontPx()` the
 * rows' type size; `still` (reduced motion) puts the rows in place at once.
 * `show` lays out hitAll's members under the finger (stage px); `hit` is
 * the row there as `{ id, site }`, or null; `covers()` the rows' boxes for
 * the names to keep off; `draw()` once a frame (camera.js `onDraw`).
 */
export function createFan(root, opts = {}) {
  const o = { screenOf: () => null, size: () => ({ W: 0, H: 0 }), fontPx: () => 18, still: false, clock: () => performance.now(), doc: globalThis.document, ...opts };
  let fan = null, rows = [], since = 0;
  root.hidden = true;

  const hide = () => {
    if (!fan) return;
    fan = null;
    rows = [];
    root.textContent = '';
    root.hidden = true;
  };
  const show = (hits, x, y) => {
    hide();
    const { W, H } = o.size();
    const px = o.fontPx();
    fan = fanLayout(hits, x, y, { W, H, fontPx: px, text: fanText });
    if (!fan.items.length) { fan = null; return; }
    root.style.setProperty('--fan-px', `${px}px`); // the size the widths were measured at
    since = o.clock();
    for (const it of fan.items) {
      const leader = o.doc.createElement('span');
      leader.className = 'galaxy-fan-leader';
      leader.dataset.tone = it.tone;
      leader.style.opacity = '0';
      const row = o.doc.createElement('div');
      row.className = 'galaxy-fan-row';
      row.dataset.tone = it.tone;
      row.dataset.side = it.side;
      row.textContent = it.text;
      row.style.width = `${it.box.right - it.box.left}px`;
      row.style.opacity = '0';
      rows.push({ it, row, leader });
    }
    root.textContent = '';
    root.append(...rows.map((r) => r.leader), ...rows.map((r) => r.row));
    root.hidden = false;
    draw();
  };
  // Each row slides out from the finger, the inner rows first; its leader draws once it is out.
  const draw = () => {
    if (!fan) return;
    const t = o.clock() - since;
    rows.forEach(({ it, row, leader }, n) => {
      const k = o.still ? 1 : easeOut(clamp01((t - n * 18) / FAN.inMs));
      const x = fan.x + (it.box.left - fan.x) * k, y = fan.y + (it.box.top - fan.y) * k;
      row.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      row.style.opacity = k.toFixed(3);
      const at = o.screenOf(it.id) ?? it.to;
      const dx = at.x - it.anchor.x, dy = at.y - it.anchor.y;
      const len = Math.hypot(dx, dy);
      leader.style.transform = `translate3d(${it.anchor.x}px, ${it.anchor.y}px, 0) rotate(${Math.atan2(dy, dx).toFixed(4)}rad) scaleX(${len.toFixed(1)})`;
      leader.style.opacity = (k * k).toFixed(3);
    });
  };
  return {
    show,
    hide,
    shown: () => Boolean(fan),
    hit: (x, y) => {
      const it = fan ? fanHit(fan, x, y) : null;
      return it ? { id: it.id, site: it.site } : null;
    },
    covers: () => (fan ? fan.items.map((it) => ({ ...it.box })) : []),
    draw,
  };
}
