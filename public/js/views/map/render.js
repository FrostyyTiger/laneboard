// The Map's renderer: everything it draws onto the canvas, in the industrial
// style of plan §5 2.5 (grey is normal, hue plus shape means abnormal, one
// accent for selection).
//
// Not pure (it draws), but it holds no state of its own beyond a palette and a
// text-width cache: index.js (M4) owns the springs, the camera and the model,
// and hands every draw call a `scene` describing the frame:
//
//   scene = {
//     W, H,                    // canvas size in CSS px (the caller set the dpr transform)
//     now,                     // ms clock for the data motion (arcs, comets, pulses)
//     s,                       // world -> screen scale (fitScale * zoom)
//     zoom,                    // cam.z, for the readout
//     toScreen(p) -> {x, y},   // world point -> canvas px
//     pos,                     // layout().pos: id -> {ring, r, angle, depth}
//     nodes,                   // id -> drawn state {x, y, r, t, a, node, pid, depth, leaving, entering, into}
//     byId,                    // id -> model node (folded ones included)
//     links,                   // visible links (model.visibleLinks)
//     overlay,                 // 'status' | 'ci' | 'cost' | 'context' | 'age' | 'drift' | 'reach'
//     reach,                   // reach links ({from, to, label}) for the reach overlay, ends already shown ids
//     rolled(id) -> status,    // rolled-up status for sites, the core and folded nodes (model.rollup)
//     folded, kids,            // Set of folded ids; id -> child nodes (all, folded included)
//     alpha(id) -> 0..1,       // focus/scope emphasis (springs)
//     hover, selected, selT,   // hovered id, selected id, selection spring 0..1
//     highlight,               // id lit from outside (split view row hover), drawn like hover
//     near, matches,           // Sets: neighbours of the focus, find matches
//     pulses: [{id, t0, tone, soft}], comets: [{link, t0, dur, tone, soft}],
//     reduced,                 // prefers-reduced-motion: no comets, pulses, turning arcs or dash flow
//     anchor,                  // tether target {left, top, bottom} in canvas px, or null
//     budgetUsd(node),         // optional: the builder budget cap for the cost overlay
//   }
//
// Text drawn here comes from builders (labels, subs, why) and is untrusted;
// fillText never interprets it.

import { RINGS, SIZE, LEGEND_ANGLE, polar, ringLabels, runRingR, ticks } from './layout.js';
import { nodeStyle, rollsUp, linkStyle, reachScope, reachLinkStyle, runRing, runRound, ACCENT_L, DRIFT_MARK } from './overlays.js';

const TAU = Math.PI * 2;

/** Fallbacks when a token is missing (dark theme values of tokens.css). */
const FALLBACK = {
  bg: 'oklch(16% 0.004 250)',
  sunken: 'oklch(13% 0.004 250)',
  line: 'oklch(100% 0 0 / 0.13)',
  lineWeak: 'oklch(100% 0 0 / 0.07)',
  t1: 'oklch(92% 0.003 250)',
  t2: 'oklch(72% 0.004 250)',
  t3: 'oklch(55% 0.004 250)',
  accent: 'oklch(72% 0.17 300)',
  crit: 'oklch(62% 0.23 25)',
  warn: 'oklch(84% 0.16 95)',
  low: 'oklch(74% 0.11 220)',
  ok: 'oklch(66% 0.07 150)',
  mono: 'ui-monospace, monospace',
  label: 'system-ui, sans-serif',
  edge: 1,
};

/** The accent at each overlay lightness step: same chroma and hue, L from ACCENT_L. */
function accentSteps(accent) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(accent.trim());
  if (!m) return ACCENT_L.map(() => accent);
  return ACCENT_L.map((l) => `oklch(${l}% ${m[2]} ${m[3]})`);
}

/** `--map-edge-alpha` as a number in 0..1 (the topology edges' weight), 1 when unset or unreadable. */
function edgeAlpha(raw) {
  const x = Number.parseFloat(raw);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : FALLBACK.edge;
}

/**
 * The palette from the §4 tokens on `el` (custom properties as CSS strings;
 * the canvas parses oklch itself). Old token names (`--crit`, `--warn`,
 * `--info`, `--border`) are read when the new ones are missing.
 */
export function readPalette(el) {
  const cs = globalThis.getComputedStyle?.(el);
  const v = (names, fallback) => {
    for (const name of names) {
      const got = cs?.getPropertyValue?.(name);
      if (typeof got === 'string' && got.trim()) return got.trim();
    }
    return fallback;
  };
  const accent = v(['--accent'], FALLBACK.accent);
  return {
    bg: v(['--bg-canvas'], FALLBACK.bg),
    sunken: v(['--bg-sunken'], FALLBACK.sunken),
    line: v(['--line', '--border'], FALLBACK.line),
    lineWeak: v(['--line-weak', '--border-weak'], FALLBACK.lineWeak),
    t1: v(['--text-1'], FALLBACK.t1),
    t2: v(['--text-2'], FALLBACK.t2),
    t3: v(['--text-3'], FALLBACK.t3),
    accent,
    accentL: accentSteps(accent),
    crit: v(['--p1', '--crit'], FALLBACK.crit),
    warn: v(['--p2', '--warn'], FALLBACK.warn),
    low: v(['--p3', '--info'], FALLBACK.low),
    ok: v(['--ok'], FALLBACK.ok),
    mono: v(['--font-mono'], FALLBACK.mono),
    label: v(['--font-label', '--font-ui'], FALLBACK.label),
    edge: edgeAlpha(v(['--map-edge-alpha'], '')),
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Nearest and farthest distance from (px, py) to the rect [x, y, w, h]. */
function rectSpan(px, py, x, y, w, h) {
  const dx = Math.max(x - px, 0, px - (x + w)), dy = Math.max(y - py, 0, py - (y + h));
  const fx = Math.max(Math.abs(px - x), Math.abs(px - x - w)), fy = Math.max(Math.abs(py - y), Math.abs(py - y - h));
  return [Math.hypot(dx, dy), Math.hypot(fx, fy)];
}

/**
 * Where a fold's "+N" plate (w x h) goes for a node at screen point `sp`
 * whose label points along `ang`: its near corner on a 45 degree diagonal,
 * 2px outside the fold ring of radius `ring`. The diagonal straight back from
 * the label comes first, then the side ones that still point away from it,
 * then a spot beside the node (for one staggered off its ring, where
 * every diagonal back crosses it); the first plate that crosses no ring hairline (radii `hairlines` around
 * `c0`, 1px of air) wins, else the first. Returns `{x, y, w, h}`.
 */
export function platePlace(sp, ang, ring, w, h, c0 = null, hairlines = []) {
  const dx = Math.cos(ang) >= 0 ? -1 : 1, dy = Math.sin(ang) >= 0 ? -1 : 1;
  const off = (ring + 0.5 + 2) / Math.SQRT2;
  const at = ([ex, ey]) => {
    const cx = sp.x + ex * off, cy = sp.y + ey * off;
    return { x: ex > 0 ? cx : cx - w, y: ey > 0 ? cy : cy - h, w, h };
  };
  const away = ([ex, ey]) => ex * Math.cos(ang) + ey * Math.sin(ang) < -0.1;
  // Beside the node, just past square to the label: its centre along u at
  // the ring plus the plate's own reach that way, so it stays 2px clear.
  const beside = (turn) => {
    const ux = Math.cos(ang + turn), uy = Math.sin(ang + turn);
    const d = ring + 2.5 + (Math.abs(ux) * w + Math.abs(uy) * h) / 2;
    return { x: sp.x + ux * d - w / 2, y: sp.y + uy * d - h / 2, w, h };
  };
  const side = (95 / 180) * Math.PI;
  const tries = [...[[dx, dy], [-dx, dy], [dx, -dy]].filter(away).map(at), beside(side), beside(-side)];
  if (!c0 || !hairlines.length) return tries[0];
  const clear = (b) => {
    const [lo, hi] = rectSpan(c0.x, c0.y, b.x, b.y, b.w, b.h);
    return hairlines.every((R) => R < lo - 1 || R > hi + 1);
  };
  return tries.find(clear) ?? tries[0];
}
/**
 * The font size (px) of a builder code `w` px wide at 9px inside a plate of
 * half-side `q`: 9 when it fits inside the 2px outline (its inner edge is 1px
 * in) with 1px clear, else scaled down to fit, never below 6. Pure.
 */
export function codeFont(w, q) {
  const room = 2 * q - 4;
  if (!(w > 0) || !(room > 0) || w <= room) return 9;
  return Math.max(6, Math.floor((9 * room / w) * 2) / 2);
}

/** A radius ctx.arc accepts: finite and >= 0. */
const safeRadius = (r) => (Number.isFinite(r) && r > 0 ? r : 0);
const ease = (t) => 1 - Math.pow(1 - t, 3);

/** A point on the quadratic from p0 to p2 at t. */
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** A point on the cubic from p0 to p3 at t. */
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Arcs bow toward the core, so cross-links read as a web across the tree. */
function linkCtrl(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const pull = Math.min(0.62, 0.2 + d / 1400);
  return { x: mx * (1 - pull), y: my * (1 - pull) };
}

/** The branch from a parent to a child, bent along the rings. */
function treeCurve(p, c) {
  const midR = (p.r + c.r) / 2;
  const a0 = p.depth === 0 ? c.t : p.t;
  return [p, polar(midR, a0), polar(midR, c.t), c];
}

const LOUD = new Set(['attention', 'crit', 'down']);
/** Kinds that draw cpu/mem gauge rings when they carry metrics. */
const GAUGED = new Set(['room', 'site', 'host', 'builder']);
/** Below this canvas width the core's name is left to the map title, the label would sit on the inner ring. */
const NARROW = 600;
/** At or below this canvas width (a phone): no ring legends; labels for builders, runs, trouble and the selection. */
const PHONE = 480;
/** On a phone, a map of this many nodes or fewer labels every one. */
export const PHONE_ALL_LABELS = 8;
const TEXT_CACHE_MAX = 4000;

/**
 * A renderer bound to one 2D context. `palette` is readPalette's shape; swap
 * it with setPalette on the `lb:theme` event. Returns the draw passes (each
 * takes the scene), `draw(scene)` running all of them in order, and
 * `readout(info)` for the readout corner's text.
 */
export function createRenderer(ctx, palette) {
  let P = palette ?? readPalette(null);
  const widths = new Map();
  /** Node id -> outer radius drawn this frame (drawNodes), read by drawLabels. */
  const outerR = new Map();

  function setPalette(next) { P = next ?? P; }

  /** Colour of an abstract tone (overlays.js) at an accent level. */
  function tone(name, level = 0) {
    switch (name) {
      case 'crit': return P.crit;
      case 'warn': return P.warn;
      case 'low': return P.low;
      case 'accent': return P.accentL?.[clamp(level | 0, 0, 4)] ?? P.accent;
      case 'line': return P.line;
      case 'ok': return P.ok;
      default: return P.t3;
    }
  }

  /** Text width, cached by font and text: labels are measured every frame. */
  function measure(text) {
    const key = `${ctx.font}|${text}`;
    let w = widths.get(key);
    if (w == null) {
      if (widths.size >= TEXT_CACHE_MAX) widths.clear();
      w = ctx.measureText(text).width;
      widths.set(key, w);
    }
    return w;
  }

  /** Tracked caps where the canvas supports letterSpacing; plain text where it does not. */
  function tracked(text, x, y, px) {
    const has = 'letterSpacing' in ctx;
    if (has) ctx.letterSpacing = `${px}px`;
    ctx.fillText(text, x, y);
    if (has) ctx.letterSpacing = '0px';
  }

  function strokeStyle(col, alpha, width = 1, dash = []) {
    ctx.strokeStyle = col;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
  }

  function fillStyle(col, alpha) {
    ctx.fillStyle = col;
    ctx.globalAlpha = clamp(alpha, 0, 1);
  }

  const alphaOf = (scene, id) => (scene.alpha ? scene.alpha(id) ?? 1 : 1);
  const nodeScale = (scene) => clamp(scene.s ?? 1, 0.8, 1.6);
  const centre = (scene) => scene.toScreen({ x: 0, y: 0 });
  /** ctx.arc with the radius clamped at 0: the browser throws on a negative one. */
  const arc = (x, y, r, a0, a1) => ctx.arc(x, y, safeRadius(r), a0, a1);

  // ---------------------------------------------------------------- rings

  /**
   * Occupied rings as solid hairlines, each labelled by the kinds on it with a
   * leader tick in the layout's gap at LEGEND_BEARING (330, off the 000 axis
   * and its bearing), and the degree dial outside the outermost one with
   * numeric bearings at the quarters.
   */
  function drawRings(scene) {
    const s = scene.s ?? 1;
    const c0 = centre(scene);
    const labels = ringLabels(scene.pos ?? new Map(), scene.byId ?? new Map());
    const ux = Math.cos(LEGEND_ANGLE), uy = Math.sin(LEGEND_ANGLE);
    ctx.save();
    let outer = RINGS[2] * s;
    for (const { r: wr, label } of labels) {
      const r = wr * s;
      outer = Math.max(outer, r);
      strokeStyle(P.line, 0.5, 1, []);
      ctx.beginPath();
      arc(c0.x, c0.y, r, 0, TAU);
      ctx.stroke();
      // A phone has no room for the legends: they sat under nodes and plates.
      if ((scene.W ?? Infinity) <= PHONE) continue;
      // The leader: a 6px tick out from the ring; the label ends at its tip
      // and runs left, away from the ring (outward at this bearing).
      strokeStyle(P.t3, 0.6, 1, []);
      ctx.beginPath();
      ctx.moveTo(c0.x + ux * r, c0.y + uy * r);
      ctx.lineTo(c0.x + ux * (r + 6), c0.y + uy * (r + 6));
      ctx.stroke();
      fillStyle(P.t3, 0.85);
      ctx.font = `500 10px ${P.label}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      tracked(label, c0.x + ux * (r + 8), c0.y + uy * (r + 8), 1);
    }
    // The dial: an instrument, not a decoration. It is what makes a bearing
    // readable when you tell someone "the red one at 120".
    const dial = outer + 26;
    for (const t of ticks(dial)) {
      strokeStyle(P.t3, t.long ? 0.45 : 0.22, 1, []);
      const cx = Math.cos(t.a), sy = Math.sin(t.a);
      ctx.beginPath();
      ctx.moveTo(c0.x + cx * t.r0, c0.y + sy * t.r0);
      ctx.lineTo(c0.x + cx * t.r1, c0.y + sy * t.r1);
      ctx.stroke();
      if (t.label) {
        fillStyle(P.t3, 0.7);
        ctx.font = `9px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const rr = t.r1 + 9;
        ctx.fillText(t.label, c0.x + cx * rr, c0.y + sy * rr);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- edges

  /** Parent to child branches: 1px --line, no gradient, at the theme's edge weight. */
  function drawTree(scene) {
    const nodes = scene.nodes ?? new Map();
    const k = P.edge ?? 1;
    ctx.save();
    strokeStyle(P.line, 1, 1, []);
    for (const [id, cc] of nodes) {
      const n = cc.node;
      const pid = cc.leaving ? cc.into : cc.pid;
      if (!n || pid == null || id === pid || n.kind === 'core') continue;
      const pc = nodes.get(pid);
      if (!pc || (!cc.leaving && cc.entering)) continue;
      const [a, b, c, d] = treeCurve(pc, cc).map(scene.toScreen);
      ctx.globalAlpha = clamp(k * Math.min(alphaOf(scene, id), alphaOf(scene, pid)) * (cc.a ?? 1), 0, 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** An arrowhead on the curve A-C-B, just outside the target node (kind `toKind`). */
  function arrowHead(A, C, B, toKind, s, col, alpha) {
    const p1 = quad(A, C, B, 0.92), p2 = quad(A, C, B, 0.985);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const rb = (SIZE[toKind] ?? 5) * Math.max(0.8, s) + 3;
    const tip = { x: B.x - Math.cos(ang) * rb, y: B.y - Math.sin(ang) * rb };
    ctx.setLineDash([]);
    fillStyle(col, alpha);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(ang - 0.45) * 6, tip.y - Math.sin(ang - 0.45) * 6);
    ctx.lineTo(tip.x - Math.cos(ang + 0.45) * 6, tip.y - Math.sin(ang + 0.45) * 6);
    ctx.closePath();
    ctx.fill();
  }

  /** Cross-links in their linkStyle, an arrowhead at the target, a label when hot. */
  function drawLinks(scene) {
    const nodes = scene.nodes ?? new Map();
    const s = scene.s ?? 1;
    const focus = scene.hover ?? scene.highlight ?? scene.selected ?? null;
    ctx.save();
    for (const l of scene.links ?? []) {
      const a = nodes.get(l.from), b = nodes.get(l.to);
      if (!a || !b || a.leaving || b.leaving) continue;
      const st = linkStyle(l, scene.overlay);
      const A = scene.toScreen(a), C = scene.toScreen(linkCtrl(a, b)), B = scene.toScreen(b);
      const fade = Math.min(alphaOf(scene, l.from), alphaOf(scene, l.to)) * Math.min(a.a ?? 1, b.a ?? 1);
      const hot = focus != null && (l.from === focus || l.to === focus);
      const col = tone(st.tone);
      // Grey topology takes the theme's edge weight; a trouble hue keeps its own.
      const k = st.tone === 'grey' || st.tone === 'line' ? P.edge ?? 1 : 1;
      strokeStyle(col, (hot ? Math.max(0.85, st.alpha) : st.alpha * k) * fade, st.width + (hot ? 0.5 : 0), st.dash);
      ctx.lineDashOffset = st.animate && !scene.reduced ? -(scene.now ?? 0) / 60 : 0;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(C.x, C.y, B.x, B.y);
      ctx.stroke();
      ctx.lineDashOffset = 0;
      // Undirected kinds (touch, conflict) carry no arrowhead.
      if (l.kind !== 'touch' && l.kind !== 'conflict') {
        arrowHead(A, C, B, scene.byId?.get(l.to)?.kind, s, col, (hot ? 0.9 : Math.min(1, st.alpha + 0.15) * k) * fade);
      }
      if (l.label && (hot || s > 1.35)) {
        const m = quad(A, C, B, 0.5);
        ctx.setLineDash([]);
        ctx.font = `10px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = measure(l.label) + 8;
        fillStyle(P.bg, 0.9 * fade);
        ctx.fillRect(m.x - w / 2, m.y - 7, w, 14);
        fillStyle(st.tone === 'grey' || st.tone === 'line' ? P.t2 : col, fade);
        ctx.fillText(l.label, m.x, m.y);
      }
    }
    ctx.restore();
  }

  /**
   * The reach overlay's arcs (only there): thin, an arrowhead at the target,
   * the selected node's outgoing ones in the accent with their ports.
   */
  function drawReach(scene) {
    if (scene.overlay !== 'reach') return;
    const nodes = scene.nodes ?? new Map();
    const s = scene.s ?? 1;
    const focus = scene.selected ?? null;
    ctx.save();
    for (const l of scene.reach ?? []) {
      const a = nodes.get(l?.from), b = nodes.get(l?.to);
      if (!a || !b || a === b || a.leaving || b.leaving) continue;
      const st = reachLinkStyle(l, focus);
      const A = scene.toScreen(a), C = scene.toScreen(linkCtrl(a, b)), B = scene.toScreen(b);
      const fade = Math.min(alphaOf(scene, l.from), alphaOf(scene, l.to)) * Math.min(a.a ?? 1, b.a ?? 1);
      const col = tone(st.tone, st.level);
      strokeStyle(col, st.alpha * fade, st.width, st.dash);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(C.x, C.y, B.x, B.y);
      ctx.stroke();
      arrowHead(A, C, B, scene.byId?.get(l.to)?.kind, s, col, Math.min(1, st.alpha + 0.15) * fade);
      if (l.label && focus != null && l.from === focus) {
        const m = quad(A, C, B, 0.5);
        ctx.font = `10px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = measure(l.label) + 8;
        fillStyle(P.bg, 0.9 * fade);
        ctx.fillRect(m.x - w / 2, m.y - 7, w, 14);
        fillStyle(col, fade);
        ctx.fillText(l.label, m.x, m.y);
      }
    }
    ctx.restore();
  }

  /** An event travelling a link: a short trail, plain alpha (no additive glow). */
  function drawComets(scene) {
    if (scene.reduced) return;
    const nodes = scene.nodes ?? new Map();
    const now = scene.now ?? 0;
    ctx.save();
    for (const c of scene.comets ?? []) {
      const t = (now - c.t0) / c.dur;
      if (!(t >= 0 && t <= 1)) continue;
      const a = nodes.get(c.link?.from), b = nodes.get(c.link?.to);
      if (!a || !b) continue;
      const A = scene.toScreen(a), C = scene.toScreen(linkCtrl(a, b)), B = scene.toScreen(b);
      const tt = ease(t);
      const peak = (c.soft ? 0.5 : 0.9) * Math.sin(Math.PI * t);
      const col = tone(c.tone ?? 'grey');
      for (let i = 0; i < 6; i++) {
        const p = quad(A, C, B, Math.max(0, tt - i * 0.014));
        fillStyle(col === P.t3 ? P.t2 : col, peak * (1 - i / 6));
        ctx.beginPath();
        arc(p.x, p.y, Math.max(0.6, 2 - i * 0.25), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- nodes

  /** The status glyph at (x, y), radius r: disc ●, square ■, triangle ▲, diamond ◆, ring ○. */
  /**
   * An overlay mark (nodeStyle `mark`) around a node at radius `ro`: a ring,
   * or a square whose sides touch that circle when `mark.shape` is 'square'.
   */
  function markRing(mark, sp, ro, alpha) {
    strokeStyle(tone(mark.tone, mark.level), alpha, 1.5, mark.dash);
    ctx.beginPath();
    if (mark.shape === 'square') ctx.rect(sp.x - ro, sp.y - ro, ro * 2, ro * 2);
    else arc(sp.x, sp.y, ro, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function glyph(shape, x, y, r, col, alpha, { hollow = false } = {}) {
    ctx.beginPath();
    switch (shape) {
      case 'square': {
        const q = r * 0.9;
        ctx.rect(x - q, y - q, q * 2, q * 2);
        break;
      }
      case 'tri': {
        const q = r * 1.15;
        ctx.moveTo(x, y - q);
        ctx.lineTo(x + q * 0.94, y + q * 0.62);
        ctx.lineTo(x - q * 0.94, y + q * 0.62);
        ctx.closePath();
        break;
      }
      case 'diamond': {
        const q = r * 1.1;
        ctx.moveTo(x, y - q);
        ctx.lineTo(x + q, y);
        ctx.lineTo(x, y + q);
        ctx.lineTo(x - q, y);
        ctx.closePath();
        break;
      }
      default:
        arc(x, y, r, 0, TAU);
    }
    if (shape === 'ring') {
      // Unknown: hollow and dashed, the absence of a reading.
      fillStyle(P.bg, alpha);
      ctx.fill();
      strokeStyle(col, alpha, 1.2, [2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (hollow) {
      fillStyle(P.bg, alpha);
      ctx.fill();
      strokeStyle(col, alpha, 1.2, []);
      ctx.stroke();
      return;
    }
    fillStyle(col, alpha);
    ctx.fill();
  }

  /**
   * A run node (overlays.js runRing): a grey track all round, the progress
   * arc over it (grey, or the trouble hue when stuck or failed), and a centre
   * mark: a grey dot, ▲ when stuck, ■ when stopped on an error, hollow and
   * faded once it stopped fine.
   */
  function runNode(n, sp, r, alpha) {
    const ring = runRing(n);
    const a = alpha * ring.alpha;
    const col = tone(ring.tone);
    const rr = runRingR(r);
    strokeStyle(P.line, a, 2, []);
    ctx.beginPath(); arc(sp.x, sp.y, rr, 0, TAU); ctx.stroke();
    if (ring.progress > 0) {
      strokeStyle(ring.tone === 'grey' ? P.t2 : col, 0.95 * a, 2, []);
      ctx.beginPath(); arc(sp.x, sp.y, rr, -Math.PI / 2, -Math.PI / 2 + ring.progress * TAU); ctx.stroke();
    }
    if (ring.hollow) glyph('disc', sp.x, sp.y, r * 0.8, P.t3, a, { hollow: true });
    else if (ring.tone === 'grey') glyph('disc', sp.x, sp.y, r * 0.8, P.t3, a);
    else glyph(ring.shape, sp.x, sp.y, r * 1.1, col, a);
  }

  /** CPU on the inner arc, memory on the outer, both from twelve o'clock. */
  function gauges(n, x, y, r, alpha) {
    const m = n.metrics;
    if (!m) return;
    for (const [k, gr] of [['cpu', r + 3.5], ['mem', r + 6.5]]) {
      if (typeof m[k] !== 'number') continue;
      const v = clamp(m[k], 0, 1);
      strokeStyle(P.line, alpha, 2, []);
      ctx.beginPath(); arc(x, y, gr, 0, TAU); ctx.stroke();
      const cacheOnly = k === 'mem' && n.memCache;
      strokeStyle(cacheOnly ? P.t3 : v > 0.9 ? P.crit : v > 0.75 ? P.warn : P.t2, 0.9 * alpha, 2, []);
      ctx.beginPath(); arc(x, y, gr, -Math.PI / 2, -Math.PI / 2 + v * TAU); ctx.stroke();
    }
  }

  /**
   * How far out a node of radius `r` draws (its builder square's corner,
   * gauges, the working arc, the fold ring, a run's track, an overlay mark),
   * strokes included: labels and plates keep clear of this, not of the centre.
   */
  function ringOuter(n, r, { mark = null, folded = false, working = false } = {}) {
    const q = n.kind === 'builder' ? r * 1.25 : r;
    let R = (n.kind === 'builder' ? q * Math.SQRT2 : q) + 1;
    if (n.kind === 'run') R = runRingR(r) + 1;
    if (n.metrics && GAUGED.has(n.kind)) R = Math.max(R, q + 1 + 6.5 + 1);
    if (working) R = Math.max(R, r + 4 + 0.7);
    if (folded) R = Math.max(R, r + (n.metrics ? 10 : 6) + 0.5);
    if (mark) {
      const ro = n.kind === 'run' ? runRingR(r) + 5 : (n.kind === 'builder' ? q * Math.SQRT2 : r) + 6;
      R = Math.max(R, (mark.shape === 'square' ? ro * Math.SQRT2 : ro) + 0.75);
    }
    return R;
  }

  /**
   * Folded: a dotted ring for what is inside and a "+N" plate outside it, on
   * a 45 degree diagonal away from the label, 2px clear of the ring. Of those
   * diagonals the first whose plate crosses no ring hairline (`hairlines`:
   * screen radii around `c0`) wins: straight back from the label, then the
   * two sides. Returns its rect.
   */
  function foldMark(scene, id, n, c, sp, r, alpha, c0 = null, hairlines = []) {
    const inside = scene.kids?.get(id)?.length ?? 0;
    const ring = r + (n.metrics ? 10 : 6);
    strokeStyle(P.t2, 0.55 * alpha, 1, [1.5, 3]);
    ctx.beginPath(); arc(sp.x, sp.y, ring, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    const text = `+${inside}`;
    ctx.font = `600 9.5px ${P.mono}`;
    const w = measure(text) + 8;
    const ang = c.t ?? scene.pos?.get(id)?.angle ?? 0;
    const { x: bx, y: by } = platePlace(sp, ang, ring, w, 14, c0, hairlines);
    fillStyle(P.sunken, 0.95 * alpha);
    ctx.fillRect(bx, by, w, 14);
    strokeStyle(P.line, alpha, 1, []);
    ctx.strokeRect(bx, by, w, 14);
    fillStyle(P.t1, 0.9 * alpha);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + 7.5);
    return { id, x: bx, y: by, w, h: 14 };
  }

  /**
   * Pulses, then every drawn node in its overlay style. Healthy nodes are
   * grey (working lanes add a turning grey arc); abnormal ones take their
   * status hue and shape. Returns the fold plates' screen rects for hit tests.
   */
  function drawNodes(scene) {
    const nodes = scene.nodes ?? new Map();
    const now = scene.now ?? 0;
    const ns = nodeScale(scene);
    const W = scene.W ?? Infinity, H = scene.H ?? Infinity;
    const badges = [];
    outerR.clear();
    const reach = scene.overlay === 'reach' ? reachScope(scene.reach, scene.selected ?? null) : null;
    // The ring hairlines drawRings draws, for the fold plates to stay off.
    const c0 = centre(scene);
    const hairlines = scene.folded?.size
      ? ringLabels(scene.pos ?? new Map(), scene.byId ?? new Map()).map((l) => l.r * (scene.s ?? 1)) : [];
    ctx.save();
    if (!scene.reduced) {
      for (const p of scene.pulses ?? []) {
        const c = nodes.get(p.id);
        if (!c) continue;
        const t = (now - p.t0) / 1500;
        if (!(t >= 0 && t < 1)) continue;
        const sp = scene.toScreen(c);
        const r0 = (SIZE[c.node?.kind] ?? 5) * ns;
        strokeStyle(tone(p.tone ?? 'grey'), (p.soft ? 0.45 : 0.9) * (1 - t), p.soft ? 1 : 1.5, []);
        ctx.beginPath();
        arc(sp.x, sp.y, r0 + ease(t) * (p.soft ? 18 : 30), 0, TAU);
        ctx.stroke();
      }
    }
    for (const [id, c] of nodes) {
      const n = c.node;
      if (!n || (c.a ?? 1) <= 0.001) continue;
      const sp = scene.toScreen(c);
      if (sp.x < -40 || sp.y < -40 || sp.x > W + 40 || sp.y > H + 40) continue;
      const fade = alphaOf(scene, id) * (c.a ?? 1);
      const r = (SIZE[n.kind] ?? 5) * ns * (0.4 + 0.6 * (c.a ?? 1));
      const isFolded = Boolean(scene.folded?.has(id)) && !c.leaving;
      const rolled = rollsUp(n, isFolded) ? scene.rolled?.(id) ?? null : null;
      const st = n.virtual ? { tone: 'grey', level: 0, shape: 'disc', alpha: 1, abnormal: false }
        : nodeStyle(n, scene.overlay, rolled, { budgetUsd: scene.budgetUsd?.(n), reach });
      const alpha = fade * (st.alpha ?? 1);
      const col = tone(st.tone, st.level);
      outerR.set(id, ringOuter(n, r, { mark: st.mark, folded: isFolded, working: Boolean(st.arc) }));

      if (n.kind === 'core') {
        // The core: a solid point in two hairline rings. No glow, no breathing.
        for (const k of [1.6, 2.3]) {
          strokeStyle(P.line, alpha, 1, []);
          ctx.beginPath(); arc(sp.x, sp.y, r * k, 0, TAU); ctx.stroke();
        }
        // Grey unless the host itself is in trouble, then its ▲/■ (T23).
        if (st.abnormal && st.shape !== 'ring') glyph(st.shape, sp.x, sp.y, r * 0.6, col, alpha);
        else glyph('disc', sp.x, sp.y, r * 0.45, P.t1, alpha);
        continue;
      }

      if (n.kind === 'run') {
        // A run: its progress as an arc on a full track, from twelve o'clock.
        runNode(n, sp, r, alpha);
        if (st.mark) {
          markRing(st.mark, sp, runRingR(r) + 5, alpha);
        }
        continue;
      }

      if (n.kind === 'site' || n.kind === 'host') {
        // A place, not a thing: a hollow ring with a ring inside, or the trouble glyph.
        fillStyle(P.bg, alpha);
        ctx.beginPath(); arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
        strokeStyle(st.abnormal ? col : P.t2, alpha, 1.5, []);
        ctx.stroke();
        if (st.abnormal && st.shape !== 'ring') glyph(st.shape, sp.x, sp.y, r * 0.45, col, alpha);
        else {
          strokeStyle(P.t3, 0.6 * alpha, 1, []);
          ctx.beginPath(); arc(sp.x, sp.y, r * 0.55, 0, TAU); ctx.stroke();
        }
      } else if (n.kind === 'builder') {
        // A builder: a 2px square outline with its short code inside.
        const q = r * 1.25;
        fillStyle(P.bg, alpha);
        ctx.fillRect(sp.x - q, sp.y - q, q * 2, q * 2);
        strokeStyle(st.abnormal ? col : P.t2, alpha, 2, []);
        ctx.strokeRect(sp.x - q, sp.y - q, q * 2, q * 2);
        fillStyle(st.abnormal ? col : P.t1, alpha);
        // The code fits inside the plate: 9px when it can, smaller for a
        // three-letter code ("RRN") that would run over the outline.
        const code = String(n.code ?? n.label ?? '').slice(0, 3);
        ctx.font = `600 9px ${P.mono}`;
        ctx.font = `600 ${codeFont(measure(code), q)}px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, sp.x, sp.y + 0.5);
        if (st.abnormal) glyph(st.shape, sp.x + q, sp.y - q, 3, col, alpha);
      } else if (!st.abnormal && st.tone === 'grey' && st.shape === 'diamond') {
        // A calm lane keeps its diamond outline, so lane-vs-machine still reads.
        glyph('diamond', sp.x, sp.y, r * 0.85, P.t3, alpha, { hollow: true });
      } else if (!st.abnormal && st.tone === 'grey' && st.shape === 'disc') {
        glyph('disc', sp.x, sp.y, r, P.t3, alpha);
      } else {
        glyph(st.shape, sp.x, sp.y, st.shape === 'disc' || st.shape === 'ring' ? r : r * 0.9, col, alpha);
      }

      if (st.arc) {
        // Working: a grey arc turning around it (data motion; still under reduced motion).
        const a0 = scene.reduced ? -Math.PI / 2 : (now / 520) % TAU;
        // On a faint full track, so the arc reads as the node's, not a stray ")".
        strokeStyle(P.line, 0.8 * alpha, 1, []);
        ctx.beginPath(); arc(sp.x, sp.y, r + 4, 0, TAU); ctx.stroke();
        strokeStyle(P.t2, 0.9 * alpha, 1.4, []);
        ctx.beginPath();
        arc(sp.x, sp.y, r + 4, a0, a0 + 1.6);
        ctx.stroke();
      }

      if (st.mark) {
        // Drift overlay: a dashed warn ring for "declared, not seen", a solid
        // warn square for "seen, not declared". Reach overlay: a solid accent
        // ring on what the selected node can reach.
        markRing(st.mark, sp, (n.kind === 'builder' ? r * 1.25 * Math.SQRT2 : r) + 6, alpha);
      }

      if (GAUGED.has(n.kind)) gauges(n, sp.x, sp.y, n.kind === 'builder' ? r * 1.25 + 1 : r, alpha);
      if (isFolded) {
        const b = foldMark(scene, id, n, c, sp, r, alpha, c0, hairlines);
        if ((c.a ?? 1) > 0.5) badges.push(b);
      }
    }
    ctx.restore();
    return badges;
  }

  // ---------------------------------------------------------------- labels

  /** Builder id -> true when any of its lanes or sessions is stuck. */
  function stuckBuilders(byId) {
    const out = new Set();
    for (const n of byId?.values?.() ?? []) if (n.builder && n.flags?.stuck) out.add(n.builder);
    return out;
  }

  /**
   * The 3-lamp strip under a builder's label: link (up grey, stale warn, down
   * crit), approvals pending (accent when > 0), stuck (warn when any lane is).
   * Off lamps are --line. Returns the lamp colours, left to right.
   */
  function lampColours(n, stuck) {
    const link = n.link ?? (n.status === 'down' ? 'down' : n.status === 'unknown' ? 'stale' : 'up');
    const approvals = n.counts?.approvals ?? n.counts?.waiting ?? 0;
    return [
      link === 'down' ? P.crit : link === 'stale' ? P.warn : P.t2,
      approvals > 0 ? P.accent : P.line,
      stuck ? P.warn : P.line,
    ];
  }

  /**
   * A builder's label: its name, or its short code when the machine it sits
   * on is already labelled with that name (one BUILDER-A on the Map, not two).
   */
  function builderName(scene, n) {
    const name = n.builder ?? n.label ?? n.id;
    const host = n.parent != null ? scene.byId?.get?.(n.parent) : null;
    const same = host && String(host.label ?? '').toLowerCase() === String(name).toLowerCase();
    return same ? n.code ?? n.label ?? name : name;
  }

  /** On a phone: labels only for trouble, the selection and what is in focus (others on tap). */
  function trouble(n, stuck) {
    return LOUD.has(n.status) || n.status === 'warn' || Boolean(n.flags?.stuck) || n.link === 'down'
      || (n.kind === 'builder' && stuck.has(n.builder));
  }

  /**
   * Where each label goes before the collision pass: its text, side, anchor
   * and the box it covers (backing, round, lamps and sub line), in screen px.
   * Sets ctx.font while measuring; call inside save/restore.
   */
  function labelPlan(scene) {
    const nodes = scene.nodes ?? new Map();
    const s = scene.s ?? 1;
    const ns = nodeScale(scene);
    const W = scene.W ?? Infinity;
    const phone = W <= PHONE;
    const focus = scene.hover ?? scene.highlight ?? scene.selected ?? null;
    const near = scene.near ?? new Set();
    const matches = scene.matches ?? new Set();
    const stuck = stuckBuilders(scene.byId);
    // A phone with a small fleet names every node; a bigger one names its
    // builders and runs, the rest only when in trouble or picked.
    let real = 0;
    for (const c of nodes.values()) if (c.node && !c.node.virtual) real++;
    const few = real <= PHONE_ALL_LABELS;
    const plan = [];
    for (const [id, c] of nodes) {
      const n = c.node;
      if (!n || n.virtual) continue;
      const fade = alphaOf(scene, id) * (c.a ?? 1);
      const status = n.status ?? 'unknown';
      const loud = LOUD.has(status);
      const picked = id === focus || id === scene.selected || matches.has(id);
      const show = phone
        ? few || n.kind === 'builder' || n.kind === 'run' || picked || trouble(n, stuck)
        : (c.depth ?? 0) <= 2 || n.kind === 'builder' || n.kind === 'run' || s > 1.25 || picked || near.has(id) || loud;
      if (!show || fade < 0.12) continue;
      const sp = scene.toScreen(c);
      const r = (SIZE[n.kind] ?? 5) * ns;
      if (n.kind === 'core') {
        // On a phone the name under the core lands on the first ring's nodes;
        // the map title at the top left already says it.
        if (W < NARROW) continue;
        ctx.font = `600 11px ${P.label}`;
        const text = String(n.label ?? '').toUpperCase();
        const w = measure(text) + ('letterSpacing' in ctx ? text.length * 2 : 0);
        const y = sp.y + r * 2.3 + 10;
        plan.push({ id, n, core: true, text, x: sp.x, y, fade, rank: 0, box: { x0: sp.x - w / 2, y0: y - 7, x1: sp.x + w / 2, y1: y + 7 } });
        continue;
      }
      const ang = c.t ?? scene.pos?.get(id)?.angle ?? 0;
      // From the outermost ring the node draws, plus half a text line where
      // the label sits above or below it, so the backing never covers a ring.
      const R = outerR.get(id) ?? ringOuter(n, r, { folded: Boolean(scene.folded?.has(id)) });
      const out = R + 6 + 7 * Math.abs(Math.sin(ang));
      let x = sp.x + Math.cos(ang) * out;
      let y = sp.y + Math.sin(ang) * out;
      let left = Math.cos(ang) >= 0;
      // One label style: every name in the label face, caps. Weight and grey
      // step carry the rank (machines and places t1, what runs on them t2, a
      // run muted to t3 like its round); trouble lifts a name to t1, and the
      // hue stays on the node's ▲/■ mark, never on the text.
      const plate = n.kind === 'site' || n.kind === 'host' || n.kind === 'room' || n.kind === 'builder';
      const raw = n.kind === 'builder' ? builderName(scene, n) : n.label ?? n.id;
      const text = String(raw).toUpperCase();
      const font = `${plate || n.kind === 'run' ? 600 : 500} ${plate && n.kind !== 'room' ? 12 : 11}px ${P.label}`;
      ctx.font = font;
      const col = plate || loud ? P.t1 : n.kind === 'run' ? P.t3 : P.t2;
      // A backing so a label stays readable where an arc passes under it.
      const w = measure(text) + ('letterSpacing' in ctx ? text.length : 0);
      const round = n.kind === 'run' ? runRound(n) : null;
      const extra = round ? round.length * 7 + 8 : 0;
      const off = (lft, px) => (lft ? px + w + extra > W - 4 : px - w - extra < 4);
      if (off(left, x)) {
        // It would run off the edge: it flips to the node's other side; when
        // that does not fit either, it goes over the node, centred on it and
        // kept inside the canvas (labels under a node belong to its neighbours).
        const fx = 2 * sp.x - x;
        if (!off(!left, fx)) { x = fx; left = !left; } else {
          x = clamp(sp.x - (w + extra) / 2, 4, W - 4 - w - extra);
          y = sp.y - out - 6;
          left = true;
        }
      }
      const rawSub = n.why && loud ? n.why : n.sub;
      const sub = rawSub && (s > 1.05 || id === focus || id === scene.selected) ? String(rawSub) : null;
      const subText = sub && (sub.length > 38 ? `${sub.slice(0, 37)}…` : sub);
      const bx = left ? x - 2 : x - w - 2;
      const box = { x0: bx, y0: y - 7, x1: bx + w + 4, y1: y + 7 };
      if (round) { if (left) box.x1 += extra; else box.x0 -= extra; }
      let low = n.kind === 'builder' ? 22 : 13;
      if (n.kind === 'builder') box.y1 = y + 13;
      if (subText) {
        ctx.font = `10px ${P.mono}`;
        const sw = measure(subText);
        box.y1 = y + low + 6;
        if (left) box.x1 = Math.max(box.x1, x + sw); else box.x0 = Math.min(box.x0, x - sw);
      }
      // Who keeps its place when two collide: the selection, then trouble,
      // then machines and places, then the rest.
      const rank = id === scene.selected ? 0 : picked ? 1 : loud || trouble(n, stuck) ? 2 : plate ? 3 : 4;
      plan.push({ id, n, sx: sp.x, text, font, col, x, y, left, w, round, sub: subText, loud, fade, rank, box, low,
        lamps: n.kind === 'builder' ? lampColours(n, stuck.has(n.builder)) : null });
    }
    return plan;
  }

  const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  /**
   * The collision pass: labels in rank order take their place, or the
   * nearest free one a line up or down (up to four lines), clear of the fold
   * plates (`badges`) and inside the canvas, and off other nodes where a
   * place allows it. On a phone a label with no free place is left for a
   * tap (the selection always stays); wider, it keeps its first place.
   * Returns the plan placed, each entry with `dy` applied.
   */
  function placeLabels(plan, scene, badges = []) {
    const H = scene.H ?? Infinity;
    const phone = (scene.W ?? Infinity) <= PHONE;
    const ns = nodeScale(scene);
    const taken = badges.map((b) => ({ x0: b.x - 1, y0: b.y - 1, x1: b.x + b.w + 1, y1: b.y + b.h + 1 }));
    // Drawn nodes, as the square their outermost ring fits in.
    const discs = [];
    for (const [id, c] of scene.nodes ?? []) {
      const n = c.node;
      if (!n || n.virtual || alphaOf(scene, id) * (c.a ?? 1) < 0.12) continue;
      const sp = scene.toScreen(c);
      const R = outerR.get(id) ?? (SIZE[n.kind] ?? 5) * ns;
      discs.push({ id, x0: sp.x - R, y0: sp.y - R, x1: sp.x + R, y1: sp.y + R });
    }
    const order = plan.map((e, i) => [e, i]).sort((a, b) => a[0].rank - b[0].rank || a[1] - b[1]).map(([e]) => e);
    const out = [];
    const STEPS = [0, 14, -14, 28, -28, 42, -42, 56, -56];
    const slot = (e, clear) => STEPS.find((d) => {
      const b = { x0: e.box.x0, x1: e.box.x1, y0: e.box.y0 + d, y1: e.box.y1 + d };
      return b.y0 >= 0 && b.y1 <= H && !taken.some((t) => hits(t, b)) && clear(b);
    });
    const W = scene.W ?? Infinity;
    /** The label on the node's other side, or null when that leaves the canvas. */
    const mirror = (e) => {
      if (e.core || e.sx == null) return null;
      const box = { ...e.box, x0: 2 * e.sx - e.box.x1, x1: 2 * e.sx - e.box.x0 };
      return box.x0 < 4 || box.x1 > W - 4 ? null : { ...e, x: 2 * e.sx - e.x, left: !e.left, box };
    };
    for (const e0 of order) {
      const alt = mirror(e0);
      // Off every node, its own included: a label moved a line up or down
      // must not land on the plate it names.
      const offNodes = () => (b) => !discs.some((n) => hits(n, b));
      let e = e0;
      let dy = null;
      for (const [cand, clear] of [[e0, offNodes(e0)], [alt, offNodes(e0)], [e0, () => true], [alt, () => true]]) {
        if (!cand) continue;
        dy = slot(cand, clear);
        if (dy != null) { e = cand; break; }
      }
      if (dy == null) {
        if (phone && e.rank > 0) continue;
        dy = 0;
      }
      const placed = { ...e, y: e.y + dy, box: { ...e.box, y0: e.box.y0 + dy, y1: e.box.y1 + dy } };
      taken.push(placed.box);
      out.push(placed);
    }
    return out;
  }

  /** The label boxes drawLabels would draw, after the collision pass (for tests and hit checks). */
  function labelBoxes(scene, badges = []) {
    ctx.save();
    const boxes = placeLabels(labelPlan(scene), scene, badges).map((e) => ({ id: e.id, text: e.text, ...e.box }));
    ctx.restore();
    return boxes;
  }

  /** Names beside their nodes, readable over arcs; subs and lamps where there is room. */
  function drawLabels(scene, badges = []) {
    ctx.save();
    ctx.textBaseline = 'middle';
    for (const e of placeLabels(labelPlan(scene), scene, badges)) {
      const { x, y, fade } = e;
      if (e.core) {
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${P.label}`;
        fillStyle(P.t1, fade);
        tracked(e.text, x, y, 2);
        continue;
      }
      const { left, w, round } = e;
      ctx.font = e.font;
      ctx.textAlign = left ? 'left' : 'right';
      const bx = left ? x - 2 : x - w - 2;
      fillStyle(P.bg, 0.8 * fade);
      ctx.fillRect(bx, y - 7, w + 4, 14);
      fillStyle(e.col, fade);
      tracked(e.text, x, y, 1);
      if (round) {
        // The round beside the name, in the data face.
        ctx.font = `10px ${P.mono}`;
        const rw = measure(round);
        const rx = left ? bx + w + 8 : bx - 6;
        fillStyle(P.bg, 0.8 * fade);
        ctx.fillRect(left ? rx - 2 : rx - rw - 2, y - 7, rw + 4, 14);
        fillStyle(P.t3, fade);
        ctx.fillText(round, rx, y);
      }
      if (e.lamps) {
        // Lamps: 4x4 squares, 2px apart, under the label.
        const lx = left ? x : x - (e.lamps.length * 6 - 2);
        e.lamps.forEach((lc, i) => {
          fillStyle(lc, fade);
          ctx.fillRect(lx + i * 6, y + 9, 4, 4);
        });
      }
      if (e.sub) {
        ctx.font = `10px ${P.mono}`;
        fillStyle(e.loud ? P.t2 : P.t3, 0.95 * fade);
        ctx.fillText(e.sub, x, y + e.low);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- selection

  /** Four 6px L-brackets around (x, y) at distance d. */
  function brackets(x, y, d, arm) {
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = x + sx * d, cy = y + sy * d;
      ctx.moveTo(cx - sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy - sy * arm);
    }
    ctx.stroke();
  }

  /**
   * The corner-bracket reticle: on the selected node it closes from r+18 to
   * r+6 as `selT` goes 0 -> 1; the hovered (or highlighted) node gets the
   * same brackets at 40%. No ring, no glow.
   */
  function drawReticle(scene) {
    const nodes = scene.nodes ?? new Map();
    const ns = nodeScale(scene);
    const marks = [];
    if (scene.selected != null) marks.push([scene.selected, scene.reduced ? 1 : clamp(scene.selT ?? 1, 0, 1), 1]);
    for (const id of [scene.hover, scene.highlight]) {
      if (id != null && id !== scene.selected && !marks.some((m) => m[0] === id)) marks.push([id, 1, 0.4]);
    }
    ctx.save();
    for (const [id, t, a] of marks) {
      const c = nodes.get(id);
      if (!c?.node) continue;
      const sp = scene.toScreen(c);
      const r = (SIZE[c.node.kind] ?? 5) * ns * (c.node.kind === 'builder' ? 1.25 : 1);
      const d = r + 6 + (1 - t) * 12;
      strokeStyle(P.accent, a * (0.35 + 0.65 * t) * (c.a ?? 1), 1.5, []);
      brackets(sp.x, sp.y, d, 6);
    }
    ctx.restore();
  }

  /** A hairline from the selected node to the inspector, drawn out as the reticle closes. */
  function drawTether(scene) {
    const A = scene.anchor;
    if (!A || scene.selected == null || (scene.W ?? 0) <= 760) return;
    const c = scene.nodes?.get(scene.selected);
    if (!c?.node || (c.a ?? 1) < 0.5) return;
    const sp = scene.toScreen(c);
    const off = (SIZE[c.node.kind] ?? 5) * nodeScale(scene) + 11;
    const S = { x: sp.x + off, y: sp.y };
    const E = { x: A.left, y: clamp(sp.y, A.top + 24, A.bottom - 24) };
    // Under or behind the inspector there is nothing to point at.
    if (E.x - S.x < 48 || sp.y < 0 || sp.y > (scene.H ?? Infinity)) return;
    const t = scene.reduced ? 1 : clamp(scene.selT ?? 1, 0, 1);
    const k = (E.x - S.x) * 0.5;
    const c1 = { x: S.x + k, y: S.y }, c2 = { x: E.x - k, y: E.y };
    ctx.save();
    strokeStyle(P.accent, 0.45 * t, 1, []);
    ctx.beginPath();
    ctx.moveTo(S.x, S.y);
    for (let i = 1; i <= 28; i++) {
      const q = cubic(S, c1, c2, E, (i / 28) * t);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    if (t > 0.9) {
      fillStyle(P.accent, (t - 0.9) * 10);
      ctx.fillRect(E.x - 2, E.y - 2, 4, 4);
    }
    ctx.restore();
  }

  /**
   * One frame: clear (the ground is the element's flat --bg-canvas and dot
   * grid, so nothing is painted under the map), then every pass in order.
   * Returns `{badges}` (fold plates, for hit tests).
   */
  function draw(scene) {
    ctx.clearRect(0, 0, scene.W ?? 0, scene.H ?? 0);
    // Nothing to draw into (the Map hidden behind another view, measured at
    // 0 or 1 px) or no usable scale: skip the frame rather than throw.
    const s = scene.s ?? 1;
    if (!(s > 0) || (scene.W ?? 2) < 2 || (scene.H ?? 2) < 2) return { badges: [] };
    drawRings(scene);
    drawTree(scene);
    drawLinks(scene);
    drawReach(scene);
    drawComets(scene);
    const badges = drawNodes(scene);
    drawLabels(scene, badges);
    drawReticle(scene);
    drawTether(scene);
    ctx.globalAlpha = 1;
    return { badges };
  }

  /**
   * The readout corner's text: `Z 1.80×  SCOPE B1  N 214/570  OVL CI`
   * (compact on a phone: `Z 1.80× · N 214/570`, plus the overlay and its
   * count when one is on). No clock: the header already shows the time. `scope` is a
   * builder code or id, or 'all'; `p95` (ms, from ?mapperf=1) is appended.
   * In the drift overlay, `drift` ({missing, undeclared} counts) adds
   * `◌ NOT SEEN 2  □ NOT DECLARED 3` after the overlay, each count keyed by
   * the mark the nodes carry. In the reach overlay,
   * `reach` ({links, touches, unresolved}) adds `LINKS 12`, `TOUCHES 3`
   * while a node is selected (touches is then a number), and `UNRESOLVED 2`
   * when the policy names selectors the Map cannot place (a count only).
   */
  function readout({ zoom = 1, scope = 'all', drawn = 0, total = 0, overlay = 'status', compact = false, p95 = null, drift = null, reach = null } = {}) {
    const z = `Z ${Number(zoom).toFixed(2)}×`;
    const n = `N ${drawn}/${total}`;
    if (compact) {
      // A phone keeps the overlay and its count:
      // `Z 1.00× · N 22/24 · DRIFT ◌1 □1`, `… · REACH 9`, `… · OVL CI`.
      const ov = String(overlay || 'status');
      if (ov === 'status') return [z, n].join(' · ');
      let tag = `OVL ${ov.toUpperCase()}`;
      if (ov === 'drift' && drift) tag = `DRIFT ${DRIFT_MARK.missing.glyph}${drift.missing ?? 0} ${DRIFT_MARK.undeclared.glyph}${drift.undeclared ?? 0}`;
      if (ov === 'reach' && reach) tag = `REACH ${Number.isFinite(reach.touches) ? `${reach.touches}/` : ''}${reach.links ?? 0}`;
      return [z, n, tag].join(' · ');
    }
    const parts = [z, `SCOPE ${!scope || scope === 'all' ? 'ALL' : String(scope).toUpperCase()}`, n, `OVL ${String(overlay).toUpperCase()}`];
    if (overlay === 'drift' && drift) parts.push(`${DRIFT_MARK.missing.glyph} NOT SEEN ${drift.missing ?? 0}`, `${DRIFT_MARK.undeclared.glyph} NOT DECLARED ${drift.undeclared ?? 0}`);
    if (overlay === 'reach' && reach) {
      parts.push(`LINKS ${reach.links ?? 0}`);
      if (Number.isFinite(reach.touches)) parts.push(`TOUCHES ${reach.touches}`);
      if (reach.unresolved > 0) parts.push(`UNRESOLVED ${reach.unresolved}`);
    }
    if (Number.isFinite(p95)) parts.push(`P95 ${p95.toFixed(1)}MS`);
    return parts.join('  ');
  }

  return {
    get palette() { return P; },
    setPalette,
    tone,
    draw,
    drawRings,
    drawTree,
    drawLinks,
    drawReach,
    drawComets,
    drawNodes,
    drawLabels,
    labelBoxes,
    drawReticle,
    drawTether,
    readout,
  };
}
