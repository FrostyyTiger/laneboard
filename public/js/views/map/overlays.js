// The Map's overlays (plan §5 2.5, 2.6): how a node and a link look under the
// status, ci, cost, context, age, drift and reach overlays.
//
// Pure: no DOM, no globals. Styles are abstract (a tone, a lightness level, a
// shape, dash pattern); the renderer maps tones to the §4 tokens: grey ->
// --text-3, crit -> --p1, warn -> --p2, low -> --p3, accent -> --accent at the
// lightness ACCENT_L[level], line -> --line.

/** The overlays, in the order `o` cycles them (`O` goes back). */
export const OVERLAYS = ['status', 'ci', 'cost', 'context', 'age', 'drift', 'reach'];

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

/**
 * Drift (server/map.mjs driftOf): the words the readout, the tip and the
 * panel use, and the ring the drift overlay draws around the node. A missing
 * node stays at its declared place in a dashed warn ring, an undeclared one
 * gets a solid warn square: both want a look (the amber of README §5), the
 * shape tells which, and the accent stays for selection. `glyph` is the
 * readout's key in front of each count.
 */
export const DRIFT_TEXT = { missing: 'declared, not seen', undeclared: 'seen, not declared' };
export const DRIFT_MARK = {
  missing: { tone: 'warn', level: 0, dash: [3, 3], shape: 'ring', glyph: '◌' },
  undeclared: { tone: 'warn', level: 0, dash: [], shape: 'square', glyph: '□' },
};

/** The node's drift kind when it is one of DRIFT_TEXT's, else null. */
const driftOf = (node) => (typeof node?.drift === 'string' && Object.hasOwn(DRIFT_TEXT, node.drift) ? node.drift : null);

/** "declared, not seen" / "seen, not declared" for a drifting node, else null. */
export const driftText = (node) => (driftOf(node) ? DRIFT_TEXT[driftOf(node)] : null);

/** `{missing, undeclared}` counts over a node list. */
export function driftCounts(nodes) {
  const out = { missing: 0, undeclared: 0 };
  for (const n of nodes ?? []) if (n && Object.hasOwn(out, n.drift)) out[n.drift]++;
  return out;
}

/**
 * The overlays a model can show: `reach` only when the model carries reach
 * links (server/map.mjs, opt-in by `map.policyFile`), every other one always.
 */
export function availableOverlays(model) {
  const reach = Array.isArray(model?.reach?.links) && model.reach.links.length > 0;
  return OVERLAYS.filter((o) => o !== 'reach' || reach);
}

/**
 * The overlay after `cur` (dir 1) or before it (dir -1), wrapping, skipping
 * the ones not in `available` (availableOverlays). Unknown -> status.
 */
export function nextOverlay(cur, dir = 1, available = OVERLAYS) {
  const i = OVERLAYS.indexOf(cur);
  if (i < 0) return OVERLAYS[0];
  const n = OVERLAYS.length;
  const step = dir < 0 ? -1 : 1;
  for (let k = 1; k <= n; k++) {
    const o = OVERLAYS[(((i + step * k) % n) + n) % n];
    if (o === 'status' || available.includes(o)) return o;
  }
  return OVERLAYS[0];
}

/** A stored overlay name, or `status`. */
export const validOverlay = (name) => (OVERLAYS.includes(name) ? name : 'status');

/**
 * Reach (server/map.mjs, T11): who can reach what, from the policy file.
 * `reachScope(links, focus)` is what the overlay lights: with a focus (the
 * selected node), the focus and the nodes it reaches directly ("if this is
 * compromised, what can it touch?"); with none, every node a reach link names.
 */
export const REACH_MARK = { tone: 'accent', level: 3, dash: [] };

/** `{focus, touched: Set, lit: Set, links}` for the reach overlay. */
export function reachScope(links, focus = null) {
  const list = Array.isArray(links) ? links.filter((l) => l && l.from != null && l.to != null && l.from !== l.to) : [];
  const touched = new Set();
  const lit = new Set();
  if (focus != null) {
    for (const l of list) if (l.from === focus) touched.add(l.to);
    if (touched.size || list.some((l) => l.to === focus)) lit.add(focus);
    for (const id of touched) lit.add(id);
  } else {
    for (const l of list) { lit.add(l.from); lit.add(l.to); }
  }
  return { focus: focus ?? null, touched, lit, links: list.length };
}

/**
 * How a reach link is drawn: a thin grey arc with an arrowhead at the target
 * (direction is the point); the focus's outgoing links in the accent, the rest
 * faded while something is selected.
 */
export function reachLinkStyle(link, focus = null) {
  if (focus != null && link?.from === focus) return { tone: 'accent', level: 2, width: 1.5, dash: [], alpha: 0.9 };
  return { tone: 'grey', level: 0, width: 1, dash: [], alpha: focus != null ? 0.12 : 0.35 };
}

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

/**
 * True when a node draws the rolled-up status of what it holds: a site, a host
 * or a folded node. Never the core (runs night 4 T23): the centre is the
 * board's own host, grey unless it itself wants you, so a waiting lane does
 * not paint it an amber disc with no ▲.
 */
export function rollsUp(node, folded = false) {
  return node?.kind === 'site' || node?.kind === 'host' || (Boolean(folded) && node?.kind !== 'core');
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
 * Returns `{tone, level, shape, alpha, arc?, mark?, abnormal}`. An abnormal
 * status keeps its own tone and shape in every overlay: a crit lane never
 * looks calm because the overlay is cost. The drift overlay keeps the status
 * style, adds `mark` (DRIFT_MARK, a ring or square around the node) on a drifting node
 * and dims every other node. The reach overlay does the same with
 * `opts.reach` (reachScope): lit nodes full, the focus's reachable set marked
 * with REACH_MARK, the rest dimmed.
 */
export function nodeStyle(node, overlay = 'status', rolled = null, opts = {}) {
  const base = statusStyle(node, rolled ?? node?.status);
  const ov = validOverlay(overlay);
  if (ov === 'drift') {
    const mark = driftOf(node) && DRIFT_MARK[driftOf(node)];
    return mark ? { ...base, alpha: 1, mark: { ...mark, dash: [...mark.dash] } } : { ...base, alpha: DIM };
  }
  if (ov === 'reach') {
    const r = opts.reach;
    if (!r?.lit?.has(node?.id)) return { ...base, alpha: DIM };
    return r.touched?.has(node.id) ? { ...base, alpha: 1, mark: { ...REACH_MARK, dash: [] } } : { ...base, alpha: 1 };
  }
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

/**
 * A run node (server/map/runs.mjs runNodes): its progress ring. The arc is the
 * progress from twelve o'clock on a full grey track; grey while the run is
 * fine, the trouble hue and shape only when it is stuck (warn ▲) or stopped on
 * an error (crit ■); a run that stopped fine is a hollow grey ring, faded, and
 * never the accent. `progress` is 0-1, or null when the run does not say.
 */
export function runRing(node) {
  const p = Number.isFinite(node?.progress) ? Math.max(0, Math.min(1, node.progress)) : null;
  const stopped = node?.state === 'stopped';
  if (node?.status === 'crit' || node?.status === 'down') return { progress: p, tone: 'crit', shape: 'square', hollow: false, alpha: 1 };
  if (!stopped && (node?.stuck || node?.status === 'warn')) return { progress: p, tone: 'warn', shape: 'tri', hollow: false, alpha: 1 };
  if (stopped) return { progress: p, tone: 'grey', shape: 'disc', hollow: true, alpha: 0.6 };
  return { progress: p, tone: 'grey', shape: 'disc', hollow: false, alpha: 1 };
}

/** The `tasks` score a run node carries as {value, max, firstMax}, or null (server/map/runs.mjs runTasks). */
function nodeTasks(node) {
  const t = node?.tasks;
  return t && Number.isFinite(t.value) && Number.isFinite(t.max) && t.max > 0 ? t : null;
}

/**
 * What a run node's label prints after the name, the numbers the ring draws:
 * "44 of 63" from the `tasks` score when it has a max, else rounds "7 of 10"
 * (or "7" without a budget); null before its first round.
 */
export function runRound(node) {
  const t = nodeTasks(node);
  if (t) return `${t.value} of ${t.max}`;
  const n = Number.isFinite(node?.round) ? node.round : null;
  if (n === null) return null;
  return Number.isFinite(node?.maxRounds) && node.maxRounds > 0 ? `${n} of ${node.maxRounds}` : String(n);
}

/** "44 of 63 tasks", with "scope 12 → 63" when the max moved; null without a tasks max. */
function tasksFact(node) {
  const t = nodeTasks(node);
  if (!t) return null;
  const moved = Number.isFinite(t.firstMax) && t.firstMax !== t.max ? `, scope ${t.firstMax} → ${t.max}` : '';
  return `${t.value} of ${t.max} tasks${moved}`;
}

/** The run page a run node links to, `#/runs?run=<id>`; null when it names no run. */
export function runHref(node) {
  const id = typeof node?.run === 'string' && node.run ? node.run : null;
  return id ? `#/runs?run=${encodeURIComponent(id)}` : null;
}

/**
 * What the tip and the inspector say about a run node: `{goal, round, progress,
 * state, why, tone, href, tasks}`, plain strings (or null) for textContent.
 * `round` is "round 7 / 10", `progress` "70 %", `tasks` "44 of 63 tasks".
 */
export function runFacts(node) {
  if (node?.kind !== 'run') return null;
  const ring = runRing(node);
  const n = Number.isFinite(node.round) ? node.round : null;
  const max = Number.isFinite(node.maxRounds) && node.maxRounds > 0 ? node.maxRounds : null;
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    goal: str(node.goal) ?? str(node.sub),
    round: n === null ? null : max ? `round ${n} / ${max}` : `round ${n}`,
    progress: ring.progress === null ? null : `${Math.round(ring.progress * 100)} %`,
    tasks: tasksFact(node),
    state: str(node.state),
    why: str(node.why),
    tone: ring.tone,
    href: runHref(node),
  };
}
