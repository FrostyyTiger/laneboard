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
//     rings,                   // false: no ring hairlines, ring legends or bearing dial (the Wall)
//     legends,                 // false: no ring legends, hairlines and dial kept (the Wall's radial)
//     lamps,                   // false: no lamp strip under builder names (the Wall)
//     gauges,                  // 'trouble': cpu/mem rings only on trouble, the focus and a hot metric (the Wall)
//     branch(child, parent, {s}) // share 0..1 of a tree branch drawn from the child's end (the Wall), undefined: all
//     follow,                  // the node an ambient camera stays on (the Wall's tour), or null
//     labelInset,              // {top, right, bottom, left} shares: where a name may move to (the Wall)
//   }
//
// Text drawn here comes from builders (labels, subs, why) and is untrusted;
// fillText never interprets it.

import { RINGS, SIZE, LEGEND_ANGLE, polar, branchCurve, ringLabels, runRingR, ticks } from './layout.js';
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

/**
 * The last `share` of the cubic a-b-c-d (from t = 1 - share to its end), as
 * a cubic of its own (de Casteljau): a branch cut down to a stub off the child.
 */
function bezierTail(a, b, c, d, share) {
  const t = 1 - clamp(share, 0, 1);
  const mix = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const ab = mix(a, b), bc = mix(b, c), cd = mix(c, d);
  const abc = mix(ab, bc), bcd = mix(bc, cd);
  return [mix(abc, bcd), bcd, cd, d];
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
/** A pinned name changes side only once |cos| of its bearing passes this (about 20° past the vertical). */
const PIN_FLIP = 0.35;
/** On a phone, a map of this many nodes or fewer labels every one. */
export const PHONE_ALL_LABELS = 8;
const TEXT_CACHE_MAX = 4000;
/** The selected node's label keeps this far (px) outside its closed reticle (T53). */
export const RETICLE_GAP = 4;

/** Half the side of the selection reticle's square when closed: the brackets' corner distance. Pure. */
export function reticleD(kind, ns = 1) {
  return (SIZE[kind] ?? 5) * ns * (kind === 'builder' ? 1.25 : 1) + 6;
}

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
  /** Node ids drawn with a trouble mark (▲/■, its own or rolled up) this frame (drawNodes), read by labelPlan. */
  const marked = new Set();
  /** Node id -> {left, dy}: where a pinned name (`scene.pinLabels`) was placed last, while it is drawn. */
  const pins = new Map();

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
   * numeric bearings at the quarters while the whole dial is in view.
   * `scene.rings === false` draws none of it (a layout without rings).
   */
  function drawRings(scene) {
    drawGuides(scene);
    if (scene.rings === false) return;
    const c0 = centre(scene);
    const { rings, legends, dial, bearings } = ringGeometry(scene);
    const ux = Math.cos(LEGEND_ANGLE), uy = Math.sin(LEGEND_ANGLE);
    ctx.save();
    for (const r of rings) {
      strokeStyle(P.line, 0.5, 1, []);
      ctx.beginPath();
      arc(c0.x, c0.y, r, 0, TAU);
      ctx.stroke();
    }
    // The leader: a 6px tick out from the ring; the label ends at its tip
    // and runs left, away from the ring (outward at this bearing).
    for (const l of legends) {
      strokeStyle(P.t3, 0.6, 1, []);
      ctx.beginPath();
      ctx.moveTo(c0.x + ux * l.r, c0.y + uy * l.r);
      ctx.lineTo(c0.x + ux * (l.r + 6), c0.y + uy * (l.r + 6));
      ctx.stroke();
      fillStyle(P.t3, 0.85);
      ctx.font = `500 10px ${P.label}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      tracked(l.text, l.x, l.y, 1);
    }
    // The dial: an instrument, not a decoration. It is what makes a bearing
    // readable when you tell someone "the red one at 120".
    for (const t of ticks(dial)) {
      strokeStyle(P.t3, t.long ? 0.45 : 0.22, 1, []);
      const cx = Math.cos(t.a), sy = Math.sin(t.a);
      ctx.beginPath();
      ctx.moveTo(c0.x + cx * t.r0, c0.y + sy * t.r0);
      ctx.lineTo(c0.x + cx * t.r1, c0.y + sy * t.r1);
      ctx.stroke();
    }
    for (const b of bearings) {
      fillStyle(P.t3, 0.7);
      ctx.font = `9px ${P.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, b.x, b.y);
    }
    ctx.restore();
  }

  /**
   * A custom layout's own orbit lines (`guides`: world ellipses `{x, y, rx,
   * ry}`, Wall T12) as the ring hairlines are drawn: 1px --line at half.
   * A guide may instead be a polygon (`pts: [[x, y], ...]`, world, Wall T14's
   * tiles), drawn a step brighter, or with `tone` (crit, warn, low) its edge in that
   * tone and a faint fill. None from the radial layout.
   */
  function drawGuides(scene) {
    const guides = scene.guides;
    if (!Array.isArray(guides) || !guides.length || typeof ctx.ellipse !== 'function') return;
    const s = scene.s ?? 1;
    ctx.save();
    strokeStyle(P.line, 0.5, 1, []);
    for (const g of guides) {
      if (Array.isArray(g?.pts)) {
        drawPolyGuide(scene, g);
        continue;
      }
      if (!Number.isFinite(g?.x) || !Number.isFinite(g?.y) || !(g.rx > 0) || !(g.ry > 0)) continue;
      const c = scene.toScreen(g);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, g.rx * s, g.ry * s, scene.spin ?? 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** One polygon guide (drawGuides); leaves the calm hairline style set. */
  function drawPolyGuide(scene, g) {
    if (g.pts.length < 3) return;
    ctx.beginPath();
    g.pts.forEach(([x, y], i) => {
      const c = scene.toScreen({ x, y });
      if (i) ctx.lineTo(c.x, c.y); else ctx.moveTo(c.x, c.y);
    });
    ctx.closePath();
    if (g.tone === 'crit' || g.tone === 'warn' || g.tone === 'low') {
      fillStyle(tone(g.tone), 0.14);
      ctx.fill();
      strokeStyle(tone(g.tone), 0.9, 1.5, []);
      ctx.stroke();
      strokeStyle(P.line, 0.5, 1, []);
    } else {
      // A calm tile is the honeycomb itself: a step above the rings' half.
      strokeStyle(P.line, 0.85, 1, []);
      ctx.stroke();
      strokeStyle(P.line, 0.5, 1, []);
    }
  }

  /**
   * Where drawRings puts its rings (screen radii), ring legends and bearing
   * numbers, each text with the box it covers: the label pass keeps clear of
   * them (T51). A phone has no room for the legends: they sat under nodes
   * and plates. Sets ctx.font while measuring; call inside save/restore.
   */
  function ringGeometry(scene) {
    if (scene.rings === false) return { rings: [], legends: [], dial: 0, bearings: [] };
    const s = scene.s ?? 1;
    const c0 = centre(scene);
    const ux = Math.cos(LEGEND_ANGLE), uy = Math.sin(LEGEND_ANGLE);
    // A phone has no room for the legends; the Wall reads them as noise from across the room.
    const bare = (scene.W ?? Infinity) <= PHONE || scene.legends === false;
    const rings = [], legends = [], bearings = [];
    let outer = RINGS[2] * s;
    for (const { r: wr, label } of ringLabels(scene.pos ?? new Map(), scene.byId ?? new Map())) {
      const r = wr * s;
      outer = Math.max(outer, r);
      rings.push(r);
      if (bare) continue;
      const x = c0.x + ux * (r + 8), y = c0.y + uy * (r + 8);
      ctx.font = `500 10px ${P.label}`;
      const w = measure(label) + ('letterSpacing' in ctx ? label.length : 0);
      legends.push({ r, text: label, x, y, box: { x0: x - w - 1, y0: y - 12, x1: x + 1, y1: y } });
    }
    const dial = outer + 26;
    ctx.font = `9px ${P.mono}`;
    for (const t of ticks(dial)) {
      if (!t.label) continue;
      const rr = t.r1 + 9;
      const x = c0.x + Math.cos(t.a) * rr, y = c0.y + Math.sin(t.a) * rr;
      const w = measure(t.label);
      bearings.push({ text: t.label, x, y, box: { x0: x - w / 2 - 1, y0: y - 6, x1: x + w / 2 + 1, y1: y + 6 } });
    }
    // The numbers name the dial's quarters: they read as a dial only all four
    // together. Cut by an edge or under the inspector or sheet, a lone "000"
    // over a node read as a stray label (review n5), so then none is drawn.
    const W = scene.W ?? Infinity, H = scene.H ?? Infinity;
    const whole = bearings.every(({ box: b }) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H && !covered(scene, b));
    if (!whole) bearings.length = 0;
    return { rings, legends, dial, bearings };
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
      const how = scene.pos?.get(id)?.branch;
      if (how === 'none') continue;
      let [a, b, c, d] = (how && branchCurve(pc, cc, how) || treeCurve(pc, cc)).map(scene.toScreen);
      // A page may draw a branch as a stub off the child (the Wall's overview: no fan at a busy site).
      const share = typeof scene.branch === 'function' ? scene.branch(n, pc.node, { s: scene.s ?? 1 }) : undefined;
      if (Number.isFinite(share) && share < 1) {
        if (!(share > 0)) continue;
        [a, b, c, d] = bezierTail(a, b, c, d, share);
      }
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

  /**
   * Whether a node wears its cpu/mem gauges. Everywhere by default; with
   * `scene.gauges === 'trouble'` (the Wall) only where they say "look here":
   * a node in trouble, the one in focus (hover, selection, the ambient
   * camera's), and a metric past the warn line (the arc takes its hue).
   */
  function gaugesOn(scene, id, n, st) {
    if (!n.metrics || !GAUGED.has(n.kind)) return false;
    if (scene.gauges !== 'trouble') return true;
    if (st.abnormal || id === scene.selected || id === scene.hover || id === scene.follow) return true;
    const m = n.metrics;
    return (typeof m.cpu === 'number' && m.cpu > 0.75) || (!n.memCache && typeof m.mem === 'number' && m.mem > 0.75);
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
  function ringOuter(n, r, { mark = null, folded = false, working = false, gauged = true } = {}) {
    const q = n.kind === 'builder' ? r * 1.25 : r;
    let R = (n.kind === 'builder' ? q * Math.SQRT2 : q) + 1;
    if (n.kind === 'run') R = runRingR(r) + 1;
    if (gauged && n.metrics && GAUGED.has(n.kind)) R = Math.max(R, q + 1 + 6.5 + 1);
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
   * a 45 degree diagonal away from the label, 2px clear of the node's
   * outermost ring (`outer`: ringOuter, the fold ring at least). Of those
   * diagonals the first whose plate crosses no ring hairline (`hairlines`:
   * screen radii around `c0`) wins: straight back from the label, then the
   * two sides. Pure placement, no drawing: `{text, ring, x, y, w, h}`.
   */
  function foldPlate(scene, id, n, c, sp, r, outer, c0 = null, hairlines = []) {
    const ring = r + (n.metrics ? 10 : 6);
    const text = `+${scene.kids?.get(id)?.length ?? 0}`;
    ctx.font = `600 9.5px ${P.mono}`;
    const w = measure(text) + 8;
    const ang = (scene.pos?.get(id)?.labelAngle ?? c.t ?? scene.pos?.get(id)?.angle ?? 0) + (scene.spin ?? 0);
    const { x, y } = platePlace(sp, ang, Math.max(ring, outer - 0.5), w, 14, c0, hairlines);
    return { text, ring, x, y, w, h: 14 };
  }

  /** Draws a folded node's dotted ring and its plate (from foldPlate). Returns the plate's rect. */
  function foldMark(id, sp, plate, alpha) {
    const { text, ring, x: bx, y: by, w } = plate;
    strokeStyle(P.t2, 0.55 * alpha, 1, [1.5, 3]);
    ctx.beginPath(); arc(sp.x, sp.y, ring, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 9.5px ${P.mono}`;
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
    marked.clear();
    const reach = scene.overlay === 'reach' ? reachScope(scene.reach, scene.selected ?? null) : null;
    // The ring hairlines drawRings draws, for the fold plates to stay off.
    const c0 = centre(scene);
    const hairlines = scene.folded?.size && scene.rings !== false
      ? ringLabels(scene.pos ?? new Map(), scene.byId ?? new Map()).map((l) => l.r * (scene.s ?? 1)) : [];
    // A node's look and reach, shared by the plate pass and the draw pass.
    const look = (id, c) => {
      const n = c.node;
      const r = (SIZE[n.kind] ?? 5) * ns * (0.4 + 0.6 * (c.a ?? 1));
      const isFolded = Boolean(scene.folded?.has(id)) && !c.leaving;
      const rolled = rollsUp(n, isFolded) ? scene.rolled?.(id) ?? null : null;
      const st = n.virtual ? { tone: 'grey', level: 0, shape: 'disc', alpha: 1, abnormal: false }
        : nodeStyle(n, scene.overlay, rolled, { budgetUsd: scene.budgetUsd?.(n), reach });
      const gauged = gaugesOn(scene, id, n, st);
      const outer = ringOuter(n, r, { mark: st.mark, folded: isFolded, working: Boolean(st.arc), gauged });
      return { n, r, isFolded, st, outer, gauged };
    };
    const shown = (c) => c.node && (c.a ?? 1) > 0.001;
    const onScreen = (sp) => !(sp.x < -40 || sp.y < -40 || sp.x > W + 40 || sp.y > H + 40);
    // The fold plates first, so the pings below can leave them clear.
    const plates = new Map();
    for (const id of scene.folded ?? []) {
      const c = nodes.get(id);
      if (!c || !shown(c) || c.leaving || c.node.kind === 'core' || c.node.kind === 'run') continue;
      const sp = scene.toScreen(c);
      if (!onScreen(sp)) continue;
      const { n, r, outer } = look(id, c);
      plates.set(id, foldPlate(scene, id, n, c, sp, r, outer, c0, hairlines));
    }
    ctx.save();
    if (!scene.reduced) {
      // A ping is a ripple round its node: it passes behind a +N plate, never through it.
      const clipped = plates.size > 0 && typeof ctx.clip === 'function';
      if (clipped) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-1e5, -1e5, 2e5, 2e5);
        for (const b of plates.values()) ctx.rect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        ctx.clip('evenodd');
      }
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
      if (clipped) ctx.restore();
    }
    for (const [id, c] of nodes) {
      if (!shown(c)) continue;
      const sp = scene.toScreen(c);
      if (!onScreen(sp)) continue;
      const fade = alphaOf(scene, id) * (c.a ?? 1);
      const { n, r, isFolded, st, outer, gauged } = look(id, c);
      const alpha = fade * (st.alpha ?? 1);
      // A lamp never fades (docs/design.md): a ▲/■ keeps its full weight when
      // focus dims the rest; only its enter/leave animation thins it.
      const lampA = st.shape === 'tri' || st.shape === 'square' ? (c.a ?? 1) * (st.alpha ?? 1) : alpha;
      const col = tone(st.tone, st.level);
      outerR.set(id, outer);
      if (st.abnormal && (st.tone === 'crit' || st.tone === 'warn')) marked.add(id);

      if (n.kind === 'core') {
        // The core: a solid point in two hairline rings. No glow, no breathing.
        for (const k of [1.6, 2.3]) {
          strokeStyle(P.line, alpha, 1, []);
          ctx.beginPath(); arc(sp.x, sp.y, r * k, 0, TAU); ctx.stroke();
        }
        // Grey unless the host itself is in trouble, then its ▲/■ (T23).
        if (st.abnormal && st.shape !== 'ring') glyph(st.shape, sp.x, sp.y, r * 0.6, col, lampA);
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
        if (st.abnormal && st.shape !== 'ring') glyph(st.shape, sp.x, sp.y, r * 0.45, col, lampA);
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
        if (st.abnormal) glyph(st.shape, sp.x + q, sp.y - q, 3, col, lampA);
      } else if (!st.abnormal && st.tone === 'grey' && st.shape === 'diamond') {
        // A calm lane keeps its diamond outline, so lane-vs-machine still reads.
        glyph('diamond', sp.x, sp.y, r * 0.85, P.t3, alpha, { hollow: true });
      } else if (!st.abnormal && st.tone === 'grey' && st.shape === 'disc') {
        glyph('disc', sp.x, sp.y, r, P.t3, alpha);
      } else {
        glyph(st.shape, sp.x, sp.y, st.shape === 'disc' || st.shape === 'ring' ? r : r * 0.9, col, lampA);
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

      if (gauged) gauges(n, sp.x, sp.y, n.kind === 'builder' ? r * 1.25 + 1 : r, alpha);
      if (isFolded) {
        const b = foldMark(id, sp, plates.get(id) ?? foldPlate(scene, id, n, c, sp, r, outer, c0, hairlines), alpha);
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

  /**
   * On a phone: labels only for trouble, the selection and what is in focus
   * (others on tap). Trouble includes a node drawn with a ▲/■ it rolls up
   * from what it holds (a site, a folded lane): a mark always has a name.
   */
  function trouble(n, stuck) {
    return LOUD.has(n.status) || n.status === 'warn' || Boolean(n.flags?.stuck) || n.link === 'down'
      || (n.kind === 'builder' && stuck.has(n.builder)) || marked.has(n.id);
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
    const H = scene.H ?? Infinity;
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
        : (c.depth ?? 0) <= 2 || n.kind === 'builder' || n.kind === 'run' || s > 1.25 || picked || near.has(id) || loud || trouble(n, stuck);
      // A page's own type steps (`createMap(el, { labelSize })`, the Wall):
      // px for this node's name, 0 for none at this zoom; undefined keeps
      // today's 11/12px; `{px, inward: true}` centres the name on the bearing
      // toward the centre. The selection is always named.
      const asked = typeof scene.labelSize === 'function'
        ? scene.labelSize(n, { s, trouble: loud || trouble(n, stuck) }) : undefined;
      const step = asked && typeof asked === 'object' ? asked.px : asked;
      const inward = Boolean(asked?.inward);
      const sized = Number.isFinite(step) && step > 0;
      if (!show || fade < 0.12 || (step === 0 && !picked)) continue;
      const sp = scene.toScreen(c);
      // A node off the canvas, or under the inspector or sheet, is not named:
      // its label would stand alone at an edge (review n5).
      if (!(sp.x >= 0 && sp.x <= W && sp.y >= 0 && sp.y <= H) || covered(scene, { x0: sp.x, y0: sp.y, x1: sp.x, y1: sp.y })) continue;
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
      // A custom layout may say which way a name points (`labelAngle`, the
      // Wall's orbits: away from the planet); otherwise away from the core.
      const ang = (scene.pos?.get(id)?.labelAngle ?? c.t ?? scene.pos?.get(id)?.angle ?? 0) + (scene.spin ?? 0);
      // From the outermost ring the node draws, plus half a text line where
      // the label sits above or below it, so the backing never covers a ring.
      let R = outerR.get(id) ?? ringOuter(n, r, { folded: Boolean(scene.folded?.has(id)) });
      // The selection's name sits outside its reticle, not on a bracket (T53).
      const sel = id === scene.selected;
      if (sel) R = Math.max(R, reticleD(n.kind, ns) + RETICLE_GAP);
      // Half the label's line: 7px at today's sizes, in step with a page's own.
      const half = sized ? Math.round(step * 0.64) : 7;
      const track = sized ? Math.max(1, Math.round(step * 0.06)) : 1;
      const out = R + 6 + half * Math.abs(Math.sin(ang));
      let x = sp.x + Math.cos(ang) * out;
      let y = sp.y + Math.sin(ang) * out;
      let left = Math.cos(ang) >= 0;
      // A pinned name (`pinLabels`, the Wall) keeps its side until its
      // bearing is well past the vertical, so the turn does not flip it
      // back and forth across the node.
      const pin = scene.pinLabels ? pins.get(id) : null;
      if (pin && pin.left !== left) {
        // Past it the name turns over and is placed afresh.
        if (Math.abs(Math.cos(ang)) < PIN_FLIP) left = pin.left; else pins.delete(id);
      }
      // One label style: every name in the label face, caps. Weight and grey
      // step carry the rank (machines and places 600 t1, what runs on them
      // 500 t2, a run in the lane's 500 but muted to t3 like its round, T51);
      // trouble lifts a name to t1, and the hue stays on the node's ▲/■
      // mark, never on the text.
      const plate = n.kind === 'site' || n.kind === 'host' || n.kind === 'room' || n.kind === 'builder';
      const raw = n.kind === 'builder' ? builderName(scene, n) : n.label ?? n.id;
      const text = String(raw).toUpperCase();
      const font = `${plate ? 600 : 500} ${sized ? step : plate && n.kind !== 'room' ? 12 : 11}px ${P.label}`;
      ctx.font = font;
      const col = plate || loud ? P.t1 : n.kind === 'run' ? P.t3 : P.t2;
      // A backing so a label stays readable where an arc passes under it.
      const w = measure(text) + ('letterSpacing' in ctx ? text.length * track : 0);
      const round = n.kind === 'run' ? runRound(n) : null;
      const extra = round ? round.length * 7 + 8 : 0;
      const rawSub = n.why && loud ? n.why : n.sub;
      const sub = rawSub && (s > 1.05 || id === focus || id === scene.selected) ? String(rawSub) : null;
      const subText = sub && (sub.length > 38 ? `${sub.slice(0, 37)}…` : sub);
      let sw = 0;
      if (subText) { ctx.font = `10px ${P.mono}`; sw = measure(subText); ctx.font = font; }
      // The widest line decides whether the label fits on this side (T53: a sub line ran off the edge).
      const wide = Math.max(w + extra, sw);
      const off = (lft, px) => (lft ? px + wide > W - 4 : px - wide < 4);
      if (sized && inward) {
        // Centred on the bearing toward the centre, clear of the node: a big
        // name pointing outward would land on what the node holds.
        const ext = Math.abs(Math.cos(ang)) * (w / 2 + 2) + Math.abs(Math.sin(ang)) * half;
        // A custom layout may say where the name centres instead (`labelAt`,
        // a world point: the Wall's orbits set it in its planet's orbit).
        const at = scene.pos?.get(id)?.labelAt;
        const ap = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? scene.toScreen(at) : null;
        const cx = ap ? ap.x : sp.x - Math.cos(ang) * (R + 4 + ext);
        x = clamp(cx - w / 2, 4, W - 4 - w);
        y = ap ? ap.y : sp.y - Math.sin(ang) * (R + 4 + ext);
        left = true;
      } else if (off(left, x)) {
        // It would run off the edge: it flips to the node's other side; when
        // that does not fit either, it goes over the node, centred on it and
        // kept inside the canvas (labels under a node belong to its neighbours).
        const fx = 2 * sp.x - x;
        if (!off(!left, fx)) { x = fx; left = !left; } else {
          x = clamp(sp.x - wide / 2, 4, W - 4 - wide);
          y = sp.y - out - 6;
          left = true;
        }
      }
      const bx = left ? x - 2 : x - w - 2;
      const box = { x0: bx, y0: y - half, x1: bx + w + 4, y1: y + half };
      if (round) { if (left) box.x1 += extra; else box.x0 -= extra; }
      let low = (n.kind === 'builder' ? 22 : 13) + half - 7;
      if (n.kind === 'builder') box.y1 = y + 13 + half - 7;
      if (subText) {
        box.y1 = y + low + 6;
        if (left) box.x1 = Math.max(box.x1, x + sw); else box.x0 = Math.min(box.x0, x - sw);
      }
      if (sel) {
        // On a diagonal the box corner can still reach the reticle's square:
        // step it out along the bearing until it is clear.
        const d = reticleD(n.kind, ns) + RETICLE_GAP;
        const ret = { x0: sp.x - d, y0: sp.y - d, x1: sp.x + d, y1: sp.y + d };
        const cx = (box.x0 + box.x1) / 2 - sp.x, cy = (box.y0 + box.y1) / 2 - sp.y;
        // Sideways only while the canvas has room; else straight up or down.
        const room = cx > 0 ? box.x1 + 40 <= W - 4 : box.x0 - 40 >= 4;
        const dx = Math.abs(cx) > 2 && room ? Math.sign(cx) * 2 : 0, dy = (Math.sign(cy) || -1) * 2;
        for (let k = 0; k < 40 && hits(box, ret); k++) {
          x += dx; y += dy; box.x0 += dx; box.x1 += dx; box.y0 += dy; box.y1 += dy;
        }
      }
      // Who keeps its place when two collide: the selection, then trouble,
      // then machines and places, then the rest.
      const rank = id === scene.selected ? 0 : picked ? 1 : loud || trouble(n, stuck) ? 2 : plate ? 3 : 4;
      plan.push({ id, n, sx: sp.x, sy: sp.y, R, text, font, col, x, y, left, w, half, track, round, sub: subText, loud, fade, enter: c.a ?? 1, rank, box, low,
        lamps: n.kind === 'builder' && scene.lamps !== false ? lampColours(n, stuck.has(n.builder)) : null });
    }
    return plan;
  }

  const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  /** The scene's covers (inspector, sheet: {left, top, right, bottom}) as boxes. */
  const coverBoxes = (scene) => (Array.isArray(scene.covers) ? scene.covers : [])
    .filter((c) => c && Number.isFinite(c.left) && Number.isFinite(c.top))
    .map((c) => ({ x0: c.left, y0: c.top, x1: Number.isFinite(c.right) ? c.right : Infinity, y1: Number.isFinite(c.bottom) ? c.bottom : Infinity }));
  /** Whether box `b` (or a point as a zero box) is under a cover; a point on its edge counts. */
  const covered = (scene, b) => coverBoxes(scene).some((c) => b.x0 <= c.x1 && c.x0 <= b.x1 && b.y0 <= c.y1 && c.y0 <= b.y1);

  /**
   * The collision pass: labels in rank order take their place, or the
   * nearest free one a line up or down (up to four lines), clear of the fold
   * plates (`badges`), the ring legends and bearing numbers, inside the
   * canvas, and off other nodes where a place allows it. On a phone a label
   * also tries centred above, then below, its node; one with no free place
   * is left for a tap (the node keeps its ring and mark), except the
   * selection and trouble, which keep their first place (T51: a trouble
   * node is always named). Wider, every label keeps its first place.
   * Returns the plan placed, each entry with `dy` applied.
   */
  function placeLabels(plan, scene, badges = []) {
    const H = scene.H ?? Infinity;
    const phone = (scene.W ?? Infinity) <= PHONE;
    const ns = nodeScale(scene);
    const taken = badges.map((b) => ({ x0: b.x - 1, y0: b.y - 1, x1: b.x + b.w + 1, y1: b.y + b.h + 1 }));
    // The inspector and the sheet are no place for a label (review n5).
    const covers = coverBoxes(scene).map((c) => ({ x0: c.x0 - 4, y0: c.y0 - 4, x1: c.x1 + 4, y1: c.y1 + 4 }));
    taken.push(...covers);
    const rg = ringGeometry(scene);
    for (const t of [...rg.legends, ...rg.bearings]) taken.push(t.box);
    // Drawn nodes, as the square their outermost ring fits in.
    const discs = [];
    for (const [id, c] of scene.nodes ?? []) {
      const n = c.node;
      if (!n || n.virtual || alphaOf(scene, id) * (c.a ?? 1) < 0.12) continue;
      const sp = scene.toScreen(c);
      let R = outerR.get(id) ?? (SIZE[n.kind] ?? 5) * ns;
      if (id === scene.selected) R = Math.max(R, reticleD(n.kind, ns) + RETICLE_GAP);
      discs.push({ id, x0: sp.x - R, y0: sp.y - R, x1: sp.x + R, y1: sp.y + R });
    }
    const pinned = scene.pinLabels === true;
    const order = plan.map((e, i) => [e, i]).sort((a, b) => a[0].rank - b[0].rank || a[1] - b[1]).map(([e]) => e);
    const out = [];
    const STEPS = [0, 14, -14, 28, -28, 42, -42, 56, -56];
    const W = scene.W ?? Infinity;
    // Where a name may go: the canvas, or the page's safe area inside it (`labelInset`).
    const ins = scene.labelInset ?? null;
    const share = (v) => (Number.isFinite(v) ? Math.min(0.45, Math.max(0, v)) : 0);
    const area = ins
      ? { x0: W * share(ins.left), y0: H * share(ins.top), x1: W * (1 - share(ins.right)), y1: H * (1 - share(ins.bottom)) }
      : { x0: 0, y0: 0, x1: W, y1: H };
    const slot = (e, clear) => (e.steps ?? STEPS).find((d) => {
      const b = { x0: e.box.x0, x1: e.box.x1, y0: e.box.y0 + d, y1: e.box.y1 + d };
      return b.y0 >= area.y0 && b.y1 <= area.y1 && b.x0 >= area.x0 && b.x1 <= area.x1 && !taken.some((t) => hits(t, b)) && clear(b);
    });
    /** Cut by a canvas edge or under a cover: a label there is not read, it is not drawn. */
    const unseen = (b) => b.x0 < 0 || b.x1 > W || b.y0 < 0 || b.y1 > H || covers.some((c) => hits(c, b));
    /** The label on the node's other side, or null when that leaves the canvas. */
    const mirror = (e) => {
      if (e.core || e.sx == null) return null;
      const box = { ...e.box, x0: 2 * e.sx - e.box.x1, x1: 2 * e.sx - e.box.x0 };
      return box.x0 < 4 || box.x1 > W - 4 ? null : { ...e, x: 2 * e.sx - e.x, left: !e.left, box };
    };
    /** On a phone: the label centred above (dir -1) or below (+1) its node, read left to right. */
    const stack = (e, dir) => {
      if (!phone || e.core || e.sx == null || e.sy == null) return null;
      const bw = e.box.x1 - e.box.x0, bh = e.box.y1 - e.box.y0;
      if (bw > W - 8) return null;
      const x0 = clamp(e.sx - bw / 2, 4, W - 4 - bw);
      const y0 = dir < 0 ? e.sy - e.R - 4 - bh : e.sy + e.R + 4;
      // The name's line sits 7px under the box top, as in labelPlan; it may
      // move one line further out, no more, or it reads as a neighbour's.
      return { ...e, x: x0 + 2, y: y0 + 7, left: true, steps: [0, 14 * dir], box: { x0, y0, x1: x0 + bw, y1: y0 + bh } };
    };
    for (const e00 of order) {
      // A pinned name tries its last frame's side and line first.
      const pin = pinned ? pins.get(e00.id) : null;
      const side = pin && pin.left !== e00.left ? mirror(e00) ?? e00 : e00;
      const e0 = pin && pin.left === side.left && pin.dy !== 0
        ? { ...side, steps: [pin.dy, ...(side.steps ?? STEPS).filter((d) => d !== pin.dy)] } : side;
      const alt = mirror(e0);
      const up = stack(e0, -1), down = stack(e0, 1);
      // Off every node, its own included: a label moved a line up or down
      // must not land on the plate it names.
      const offNodes = (b) => !discs.some((n) => hits(n, b));
      // The selection never moves onto its own reticle, even with no clear place.
      const own = e0.id === scene.selected ? discs.find((n) => n.id === e0.id) : null;
      const any = own ? (b) => !hits(own, b) : () => true;
      let e = e0;
      let dy = null;
      for (const [cand, clear] of [[e0, offNodes], [alt, offNodes], [up, offNodes], [down, offNodes], [e0, any], [alt, any], [up, any], [down, any]]) {
        if (!cand) continue;
        dy = slot(cand, clear);
        if (dy != null) { e = cand; break; }
      }
      if (dy == null) {
        if ((phone && e.rank > 2) || unseen(e.box)) continue;
        dy = 0;
      }
      const placed = { ...e, y: e.y + dy, dy, box: { ...e.box, y0: e.box.y0 + dy, y1: e.box.y1 + dy } };
      taken.push(placed.box);
      out.push(placed);
    }
    if (pinned) {
      // Pins live while their name is drawn: one that leaves the screen is
      // placed afresh when it comes back.
      const seen = new Set();
      for (const e of out) {
        if (e.core || e.sx == null) continue;
        seen.add(e.id);
        pins.set(e.id, { left: e.left, dy: e.dy });
      }
      for (const id of pins.keys()) if (!seen.has(id)) pins.delete(id);
    }
    return out;
  }

  /** The ring legend and bearing number boxes drawRings draws (for tests: labels keep clear of them). */
  function ringTextBoxes(scene) {
    ctx.save();
    const g = ringGeometry(scene);
    ctx.restore();
    return [...g.legends, ...g.bearings].map((t) => ({ text: t.text, ...t.box }));
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
      // The progress follows the name in reading order on either side of the
      // node (runs-n5 T5): on the left side the name moves out to make room.
      ctx.font = `10px ${P.mono}`;
      const rw = round ? measure(round) : 0;
      const nx = round && !left ? x - rw - 8 : x;
      ctx.font = e.font;
      ctx.textAlign = left ? 'left' : 'right';
      const bx = left ? nx - 2 : nx - w - 2;
      fillStyle(P.bg, 0.8 * fade);
      ctx.fillRect(bx, y - e.half, w + 4, e.half * 2);
      fillStyle(e.col, fade);
      tracked(e.text, nx, y, e.track);
      if (round) {
        // The numbers the ring draws, beside the name, in the data face.
        ctx.font = `10px ${P.mono}`;
        const rx = left ? bx + w + 8 : x;
        fillStyle(P.bg, 0.8 * fade);
        ctx.fillRect(left ? rx - 2 : rx - rw - 2, y - 7, rw + 4, 14);
        fillStyle(P.t3, fade);
        ctx.fillText(round, rx, y);
      }
      if (e.lamps) {
        // Lamps: 4x4 squares, 2px apart, under the label.
        const lx = left ? x : x - (e.lamps.length * 6 - 2);
        // A lit lamp never fades with focus (docs/design.md); off lamps go with the label.
        e.lamps.forEach((lc, i) => {
          fillStyle(lc, lc === P.crit || lc === P.warn || lc === P.accent ? e.enter ?? 1 : fade);
          ctx.fillRect(lx + i * 6, y + e.half + 2, 4, 4);
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
      const d = reticleD(c.node.kind, ns) + (1 - t) * 12;
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
    ringTextBoxes,
    drawReticle,
    drawTether,
    readout,
  };
}
