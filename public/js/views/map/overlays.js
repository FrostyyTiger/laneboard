// The Map's overlays (plan §5 2.5, 2.6): how a node and a link look under the
// status, ci, cost, context and age overlays.
//
// Pure: no DOM, no globals. Styles are abstract (a tone, a lightness level, a
// shape, dash pattern); the renderer maps tones to the §4 tokens: grey ->
// --text-3, crit -> --p1, warn -> --p2, low -> --p3, accent -> --accent at the
// lightness ACCENT_L[level], line -> --line.

/** The overlays, in the order `o` cycles them (`O` goes back). */
export const OVERLAYS = ['status', 'ci', 'cost', 'context', 'age'];

/** localStorage key of the chosen overlay. */
export const OVERLAY_KEY = 'laneboard.map.overlay';

/** oklch lightness (%) of the accent for level 0..4. */
export const ACCENT_L = [40, 50, 60, 70, 80];

/** Cost bin lower edges in USD (24 h): level = index of the last edge reached. */
export const COST_BINS = [0, 1, 5, 20, 50];

/** Age bin upper edges in ms: <10m, <1h, <4h, <24h, then level 4. */
export const AGE_BINS = [10 * 60e3, 60 * 60e3, 4 * 60 * 60e3, 24 * 60 * 60e3];

/** Small integer codes for the minimap's packed scene. */
export const SHAPE_CODE = { disc: 0, square: 1, tri: 2, diamond: 3, ring: 4 };
export const TONE_CODE = { grey: 0, crit: 1, warn: 2, low: 3, accent: 4, line: 5 };

/** Non-lane nodes in a non-status overlay are drawn at this alpha. */
export const DIM = 0.5;

/** The overlay after `cur` (dir 1) or before it (dir -1), wrapping. Unknown -> status. */
export function nextOverlay(cur, dir = 1) {
  const i = OVERLAYS.indexOf(cur);
  if (i < 0) return OVERLAYS[0];
  const n = OVERLAYS.length;
  return OVERLAYS[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n];
}

/** A stored overlay name, or `status`. */
export const validOverlay = (name) => (OVERLAYS.includes(name) ? name : 'status');

/** Cost in USD -> accent level 0..4 (bins [0,1,5,20,50]). */
export function costLevel(usd) {
  if (!Number.isFinite(usd) || usd < COST_BINS[1]) return 0;
  let level = 0;
  for (let i = 0; i < COST_BINS.length; i++) if (usd >= COST_BINS[i]) level = i;
  return level;
}

/** Age in ms -> level 0..4 (<10m, <1h, <4h, <24h, ≥24h). */
export function ageLevel(ms) {
  if (!Number.isFinite(ms) || ms < AGE_BINS[0]) return 0;
  for (let i = 1; i < AGE_BINS.length; i++) if (ms < AGE_BINS[i]) return i;
  return 4;
}

/** Context used % -> `{tone, level, shape?}`: <50 grey, 50-70 L1, 70-85 ◆ low, ≥85 ▲ warn. */
export function contextBin(pct) {
  if (!Number.isFinite(pct) || pct < 50) return { tone: 'grey', level: 0 };
  if (pct < 70) return { tone: 'accent', level: 1 };
  if (pct < 85) return { tone: 'low', level: 0, shape: 'diamond' };
  return { tone: 'warn', level: 0, shape: 'tri' };
}

const HEALTHY = new Set(['ok', 'idle', 'working']);

/** The calm shape of a node: lanes keep their diamond outline, others a disc. */
const calmShape = (node) => (node?.kind === 'lane' ? 'diamond' : 'disc');

/**
 * The status style (2.5): healthy is grey in the kind's calm shape (working
 * adds the turning arc), crit/down a crit square, warn/attention a warn
 * triangle, unknown a hollow ring, low a low diamond. A stuck or
 * approval-waiting lane that still reports a healthy status reads as warn.
 */
export function statusStyle(node, status = node?.status) {
  const s = status ?? 'unknown';
  const f = node?.flags ?? {};
  if (s === 'crit' || s === 'down') return { tone: 'crit', level: 0, shape: 'square', abnormal: true };
  if (s === 'warn' || s === 'attention' || ((f.stuck || f.awaitingApproval) && HEALTHY.has(s))) {
    return { tone: 'warn', level: 0, shape: 'tri', abnormal: true };
  }
  if (s === 'low') return { tone: 'low', level: 0, shape: 'diamond', abnormal: true };
  if (!HEALTHY.has(s)) return { tone: 'grey', level: 0, shape: 'ring', abnormal: true };
  return { tone: 'grey', level: 0, shape: calmShape(node), abnormal: false, ...(s === 'working' ? { arc: true } : {}) };
}

/** The kinds each non-status overlay measures. */
const MEASURED = {
  ci: new Set(['lane', 'package']),
  cost: new Set(['lane', 'session']),
  context: new Set(['lane', 'session']),
  age: new Set(['lane', 'session']),
};

/**
 * How a node is drawn under `overlay`. `rolled` is its rolled-up status
 * (model.js rollup) when the renderer shows one (sites, folded nodes), else
 * its own status is used. `opts.budgetUsd` is the builder's budget cap for the
 * cost overlay (`opts.warnPct`, default 80, of it turns ◆ low; at the cap ■ crit).
 *
 * Returns `{tone, level, shape, alpha, arc?, abnormal}`. An abnormal status
 * keeps its own tone and shape in every overlay: a crit lane never looks calm
 * because the overlay is cost.
 */
export function nodeStyle(node, overlay = 'status', rolled = null, opts = {}) {
  const base = statusStyle(node, rolled ?? node?.status);
  const ov = validOverlay(overlay);
  const measured = ov !== 'status' && MEASURED[ov].has(node?.kind);
  const alpha = ov === 'status' || measured ? 1 : DIM;
  if (base.abnormal || !measured) return { ...base, alpha };
  const m = node.m ?? {};
  const shape = calmShape(node);
  switch (ov) {
    case 'ci': {
      const ci = m.ci;
      if (ci === 'fail') return { tone: 'crit', level: 0, shape: 'square', alpha, abnormal: false };
      if (ci === 'running') return { tone: 'grey', level: 0, shape, alpha, arc: true, abnormal: false };
      if (ci === 'pass') return { tone: 'grey', level: 0, shape, alpha, abnormal: false };
      return { tone: 'grey', level: 0, shape: 'ring', alpha, abnormal: false };
    }
    case 'cost': {
      const usd = m.costUsd;
      const cap = opts.budgetUsd;
      if (Number.isFinite(cap) && cap > 0 && Number.isFinite(usd)) {
        if (usd >= cap) return { tone: 'crit', level: 0, shape: 'square', alpha, abnormal: false };
        if (usd >= cap * ((opts.warnPct ?? 80) / 100)) return { tone: 'low', level: 0, shape: 'diamond', alpha, abnormal: false };
      }
      return { tone: 'accent', level: costLevel(usd), shape, alpha, abnormal: false };
    }
    case 'context': {
      const b = contextBin(m.ctxPct);
      return { tone: b.tone, level: b.level, shape: b.shape ?? shape, alpha, abnormal: false };
    }
    case 'age': {
      const level = ageLevel(m.ageMs);
      return { tone: level ? 'accent' : 'grey', level, shape, alpha, abnormal: false };
    }
    default:
      return { ...base, alpha };
  }
}

const ABNORMAL_LINK = new Set(['warn', 'attention', 'crit', 'down']);

/** A conflict link is confirmed when it is not a forecast (merge-tree conflict). */
export const confirmedConflict = (l) => l?.kind === 'conflict'
  && (l.predicted === false || (l.predicted == null && l.severity === 'crit'));

/**
 * How a link is drawn (2.5). Returns `{tone, width, dash, alpha, animate}`:
 * tree 1px line; touch 1px solid grey at 0.35; predicted conflict 1px dashed
 * [4,3] warn; confirmed conflict 1.5px solid crit (the only crit-coloured
 * edge); pkg 1px dotted [1,3] grey; ci 1px dashed grey, animated while live;
 * topology links keep their dash patterns in grey and take the warn hue only
 * when their status is abnormal.
 */
export function linkStyle(link, overlay = 'status') {
  const ov = validOverlay(overlay);
  const live = Boolean(link?.live);
  const kind = link?.kind;
  let s;
  switch (kind) {
    case 'tree': s = { tone: 'line', width: 1, dash: [], alpha: 1 }; break;
    case 'touch': s = { tone: 'grey', width: 1, dash: [], alpha: 0.35 }; break;
    case 'conflict':
      s = confirmedConflict(link)
        ? { tone: 'crit', width: 1.5, dash: [], alpha: 0.9 }
        : { tone: 'warn', width: 1, dash: [4, 3], alpha: 0.8 };
      break;
    case 'pkg': s = { tone: 'grey', width: 1, dash: [1, 3], alpha: ov === 'ci' ? 0.6 : 0.35 }; break;
    case 'ci': s = { tone: 'grey', width: 1, dash: [4, 4], alpha: ov === 'ci' ? 0.6 : 0.35 }; break;
    default: {
      const dash = kind === 'share' ? [1, 3] : live ? [] : [4, 4];
      const tone = ABNORMAL_LINK.has(link?.status) ? 'warn' : 'grey';
      s = { tone, width: 1, dash, alpha: live ? 0.42 : 0.26 };
    }
  }
  return { ...s, animate: live && (kind === 'ci' || !['tree', 'touch', 'conflict', 'pkg'].includes(kind)) };
}
