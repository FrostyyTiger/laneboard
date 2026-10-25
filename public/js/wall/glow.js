// The Wall's glow layer (docs/plans/wall/README.md §3; extras come through
// feeds, §4): a canvas under the Map's transparent canvas that paints what a
// feed says about the room itself: a soft light in a lamp's real colour
// (`glow: {rgb, level}`) and a job's progress as a thin ring round its node
// (`ring: {progress}`). Both come from the model the hub serves (server/map.mjs `feedExtras`); the app
// ignores them.
//
// `glowMarks`, `glowGeometry`, `ringGeometry` and `zoomAt` are pure
// (test/wall-glow.test.mjs imports them); `createGlow` is the canvas part. It
// follows the Map frame by frame (`map.onDraw`, `map.screenOf`) only while a
// node carries an extra: a fleet without lights or jobs costs nothing.
//
// Colour: a light is painted in its own colour because that is what it is
// (README §4), kept low and soft so it reads as ambience, never as status.
// The ring is grey like every calm thing (docs/design.md); trouble stays the Map's.

import { SIZE } from '../views/map/layout.js';
import { readPalette } from '../views/map/render.js';
import { easeInOut } from '../core/motion.js';
import { nodeScaleAt } from './lock.js';

/**
 * Sizes, as fractions of the screen's short side where they say so. A glow is
 * at least `min` of the side wide in radius (a light reads from across the
 * room at the overview) or `perR` node radii, whichever is more, and shrinks
 * to `dim` of that for a light turned nearly down. `alpha` is its centre at
 * full level: soft enough that a crit mark is still the loudest thing.
 * A ring sits `gap` outside the node and is `width` thick.
 */
export const GLOW_SIZE = Object.freeze({
  min: 0.05, perR: 7, dim: 0.55, alpha: 0.42, alphaDim: 0.4,
  gap: 0.012, minGap: 4, width: 0.0036, minWidth: 2,
});

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const byte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

/**
 * The nodes the layer paints, from a map model (or its `nodes`): one entry
 * per node with a usable extra, `{ id, kind, glow, ring }` (either may be
 * null). The server already validates; this checks again so a hand-made
 * model never throws mid-frame. A light at level 0 is off: no glow.
 */
export function glowMarks(model) {
  const nodes = Array.isArray(model) ? model : Array.isArray(model?.nodes) ? model.nodes : [];
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string') continue;
    const g = n.glow;
    const level = g && (g.level ?? 1);
    const glow = g && Array.isArray(g.rgb) && g.rgb.length === 3 && g.rgb.every(byte) && unit(level) && level > 0
      ? { rgb: [...g.rgb], level } : null;
    const ring = n.ring && unit(n.ring.progress) ? { progress: n.ring.progress } : null;
    if (glow || ring) out.push({ id: n.id, kind: n.kind, glow, ring });
  }
  return out;
}

/**
 * A glow round a node of `kind` drawn at node scale `ns`, on a screen whose
 * short side is `side` px, at light level `level` (0..1). Returns
 * `{ R, alpha }`: the radius where it fades to nothing and the opacity at its
 * centre. Brighter is wider and stronger. Pure.
 */
export function glowGeometry({ kind, ns = 1, side = 0, level = 1 }) {
  const r = (SIZE[kind] ?? 5) * (Number.isFinite(ns) && ns > 0 ? ns : 1);
  const s = Number.isFinite(side) && side > 0 ? side : 0;
  const l = clamp01(level);
  const full = Math.max(r * GLOW_SIZE.perR, s * GLOW_SIZE.min);
  return {
    R: full * (GLOW_SIZE.dim + (1 - GLOW_SIZE.dim) * l),
    alpha: GLOW_SIZE.alpha * (GLOW_SIZE.alphaDim + (1 - GLOW_SIZE.alphaDim) * l),
  };
}

/**
 * A progress ring round a node of `kind` at node scale `ns`, screen short
 * side `side`, `progress` 0..1. Returns `{ r, width, start, end }`: radius and
 * stroke in px, and the arc in radians, clockwise from twelve o'clock. Pure.
 */
export function ringGeometry({ kind, ns = 1, side = 0, progress = 0 }) {
  const n = (SIZE[kind] ?? 5) * (Number.isFinite(ns) && ns > 0 ? ns : 1);
  const s = Number.isFinite(side) && side > 0 ? side : 0;
  const start = -Math.PI / 2;
  return {
    r: n + Math.max(GLOW_SIZE.minGap, s * GLOW_SIZE.gap),
    width: Math.max(GLOW_SIZE.minWidth, s * GLOW_SIZE.width),
    start,
    end: start + 2 * Math.PI * clamp01(progress),
  };
}

/**
 * The camera's zoom at `now` for a move from `from` to `to` that started at
 * `startAt` and takes `ms`, on the Map's flight ease (core/motion.js), so the
 * glows grow with the nodes as the camera flies in. Pure.
 */
export function zoomAt(now, { from = 1, to = 1, startAt = 0, ms = 0 }) {
  if (!(ms > 0) || now >= startAt + ms) return to;
  if (now <= startAt) return from;
  return from + (to - from) * easeInOut((now - startAt) / ms);
}

// --- the canvas part ----------------------------------------------------------

/**
 * The layer's pixel ratio cap: 2x keeps the ring's hairline crisp on the
 * tablet. (1x was tried for the soft glows: no measurable gain, round 18.)
 */
export const GLOW_DPR = 2;

/** Sprite radius in device px: one soft disc per colour, scaled when drawn. */
const SPRITE_R = 128;

/** A soft light: bright core, long falloff (a lamp through a window, not a dot). */
const FALLOFF = [[0, 1], [0.18, 0.62], [0.42, 0.26], [0.7, 0.07], [1, 0]];

/**
 * The layer on `canvas` (an empty canvas under the Map's), following `map`
 * (`onDraw`, `screenOf`, `snapshotScene`). `update(model)` takes the newest
 * model, `zoomTo(zoom, ms)` tells it where the camera is flying (the tour
 * knows; the Map does not say), `destroy()` stops it. `clock`, `size` and
 * `palette` are injectable for tests.
 */
export function createGlow(canvas, map, {
  clock = globalThis.performance, size = null, palette = null, doc = globalThis.document,
} = {}) {
  const ctx = canvas.getContext('2d');
  const pal = palette ?? readPalette(canvas.parentElement ?? canvas);
  const measure = size ?? (() => ({ W: canvas.clientWidth, H: canvas.clientHeight }));
  const sprites = new Map();
  let marks = [];
  let off = null;
  let outer = 0;
  let zoom = { from: 1, to: 1, startAt: 0, ms: 0 };
  let dirty = []; // [x, y, w, h] in css px: what the last frame painted
  let cw = 0, ch = 0, dpr = 1;

  const sprite = (rgb) => {
    const key = rgb.join(',');
    let s = sprites.get(key);
    if (s) return s;
    s = doc.createElement('canvas');
    s.width = s.height = SPRITE_R * 2;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(SPRITE_R, SPRITE_R, 0, SPRITE_R, SPRITE_R, SPRITE_R);
    for (const [at, a] of FALLOFF) grad.addColorStop(at, `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE_R * 2, SPRITE_R * 2);
    sprites.set(key, s);
    return s;
  };

  const fitCanvas = (W, H) => {
    const d = Math.min(GLOW_DPR, globalThis.devicePixelRatio || 1);
    if (W === cw && H === ch && d === dpr) return false;
    cw = W; ch = H; dpr = d;
    canvas.width = Math.round(W * d);
    canvas.height = Math.round(H * d);
    return true;
  };

  // Only what was painted is cleared: a few small boxes, not the screen.
  const clear = () => {
    if (!dirty.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const [x, y, w, h] of dirty) ctx.clearRect(x, y, w, h);
    dirty = [];
  };
  const box = (x, y, r) => dirty.push([Math.floor(x - r - 2), Math.floor(y - r - 2), Math.ceil(2 * r + 4), Math.ceil(2 * r + 4)]);

  const paint = () => {
    const { W, H } = measure();
    if (!(W > 0 && H > 0)) return;
    if (fitCanvas(W, H)) dirty = []; // a resized canvas is blank
    clear();
    const side = Math.min(W, H);
    const ns = nodeScaleAt(W, H, outer, zoomAt(clock.now(), zoom));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const m of marks) {
      const sp = map.screenOf(m.id);
      if (!sp) continue;
      if (m.glow) {
        const { R, alpha } = glowGeometry({ kind: m.kind, ns, side, level: m.glow.level });
        if (sp.x + R < 0 || sp.y + R < 0 || sp.x - R > W || sp.y - R > H) continue;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite(m.glow.rgb), sp.x - R, sp.y - R, R * 2, R * 2);
        ctx.globalAlpha = 1;
        box(sp.x, sp.y, R);
      }
      if (m.ring) {
        const g = ringGeometry({ kind: m.kind, ns, side, progress: m.ring.progress });
        ctx.lineWidth = g.width;
        ctx.strokeStyle = pal.lineWeak;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, g.r, 0, 2 * Math.PI);
        ctx.stroke();
        if (g.end > g.start) {
          ctx.strokeStyle = pal.t2;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, g.r, g.start, g.end);
          ctx.stroke();
        }
        box(sp.x, sp.y, g.r + g.width);
      }
    }
  };

  const update = (model) => {
    marks = glowMarks(model);
    if (marks.length) {
      outer = map.snapshotScene?.()?.outer ?? outer;
      if (!off) off = map.onDraw(paint);
    } else if (off) {
      off();
      off = null;
      clear();
    }
  };

  const zoomTo = (to, ms = 0) => {
    const now = clock.now();
    zoom = { from: zoomAt(now, zoom), to: Number.isFinite(to) && to > 0 ? to : 1, startAt: now, ms };
  };

  return {
    update,
    zoomTo,
    /** What it paints now, for tests and the console. */
    state: () => ({ marks: marks.map((m) => ({ ...m })), painting: off != null }),
    destroy: () => { off?.(); off = null; clear(); },
  };
}
