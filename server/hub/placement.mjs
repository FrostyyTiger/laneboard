// Placement (fleet plan §3 2.11): rank builders for a new lane. Pure. REVIEW-REQUIRED (SR11).
//
// rank(view, {repo?, need?, cfg?}) -> [{builder, score, eligible, reasons[], latencyMs, metrics}]
//   sorted eligible first, then score desc, then lower latencyMs, then config order.
//
// Everything a builder reports (vitals, box, hello) is untrusted input: numbers are read defensively
// (non-finite -> unknown) and only ever lower a builder's chances or gate it. The repo gate intersects the
// builder's claim (`hello.repos`) with the hub-config allowlist (`fleet.builders[].repos`, carried on the
// view row as `repos`) when one is configured (SECURITY-FIXES S12): a builder cannot attract a lane for a
// repo the hub config does not give it. Hard gates: state up, capability `need` (default 'launch'),
// >= 1 free lane slot, free memory >= minFreeMemMb, swap < maxSwapFrac, no major version skew, repo.
//
// score = 0.40 * free / max(1, totalLaneSlots)
//       + 0.30 * min(1, mem / 16384)
//       + 0.20 * (1 - min(1, load / cpus))
//       + 0.10 * (1 - swap)
//       - 0.05 * lanesNeedingYou
// (each positive term clamped to [0,1]).

export const DEFAULTS = Object.freeze({ minFreeMemMb: 4096, maxSwapFrac: 0.5 });
export const WEIGHTS = Object.freeze({ slots: 0.40, mem: 0.30, load: 0.20, swap: 0.10, attention: 0.05 });
export const MEM_FULL_MB = 16384;
const NEEDS_YOU = new Set(['waiting_permission', 'waiting_question']);
const MAX_SLOTS = 1000;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sessionsOf(snap) {
  const s = snap?.sessions;
  if (s instanceof Map) return [...s.values()];
  return Array.isArray(s) ? s : [];
}

function capabilitiesOf(hello) {
  return Array.isArray(hello?.capabilities) ? hello.capabilities : [];
}

/** Lane-slot counts from box.slots: {total, free} (null when the builder reports no slots). */
export function slotCounts(box) {
  const slots = Array.isArray(box?.slots) ? box.slots.slice(0, MAX_SLOTS) : null;
  if (!slots) return null;
  let total = 0;
  let free = 0;
  for (const s of slots) {
    if (!s || typeof s !== 'object' || s.laneSlot !== true) continue;
    total++;
    if (!s.lane && !s.orphan) free++;
  }
  return { total, free };
}

/** The numbers placement uses for one view row (fleet-store view(now).builders[i]). */
export function metricsOf(b) {
  const snap = b?.snap ?? null;
  const vitals = snap?.vitals ?? null;
  const mem = vitals?.mem ?? null;
  const slots = slotCounts(snap?.box);
  const swapTotal = num(mem?.swapTotalMb);
  const swapUsed = num(mem?.swapUsedMb);
  const load5 = Array.isArray(vitals?.load) ? num(vitals.load[1]) : null;
  const cpus = num(vitals?.cpus);
  return {
    lanes: Array.isArray(snap?.box?.launched) ? snap.box.launched.length : 0,
    totalSlots: slots ? slots.total : null,
    free: slots ? slots.free : null,
    mem: num(mem?.availableMb),
    swap: swapTotal === null || swapUsed === null ? null : swapTotal <= 0 ? 0 : clamp01(swapUsed / swapTotal),
    load: load5 !== null && cpus !== null && cpus >= 1 ? Math.max(0, load5 / cpus) : null,
    needsYou: sessionsOf(snap).filter((s) => s && NEEDS_YOU.has(s.state)).length,
  };
}

function settings(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const minFreeMemMb = num(c.minFreeMemMb) ?? DEFAULTS.minFreeMemMb;
  const maxSwapFrac = num(c.maxSwapFrac) ?? DEFAULTS.maxSwapFrac;
  return { minFreeMemMb, maxSwapFrac };
}

/** One builder's eligibility and score. */
export function assess(b, { repo, need = 'launch', cfg } = {}) {
  const { minFreeMemMb, maxSwapFrac } = settings(cfg);
  const m = metricsOf(b);
  const reasons = [];
  const state = b?.state ?? b?.conn?.state ?? 'unknown';
  if (state !== 'up') reasons.push(`builder ${state}`);
  if (b?.versionSkew === 'major') reasons.push('major version skew');
  if (need && !capabilitiesOf(b?.hello).includes(need)) reasons.push(`no ${need} capability`);
  if (m.free === null) reasons.push('no slot data');
  else if (m.free < 1) reasons.push('no free lane slot');
  if (m.mem === null) reasons.push('no memory data');
  else if (m.mem < minFreeMemMb) reasons.push(`free memory ${Math.round(m.mem)} MB < ${minFreeMemMb} MB`);
  if (m.swap !== null && m.swap >= maxSwapFrac) reasons.push(`swap ${Math.round(m.swap * 100)}% >= ${Math.round(maxSwapFrac * 100)}%`);
  if (repo !== undefined && repo !== null) {
    const claimed = Array.isArray(b?.hello?.repos) ? b.hello.repos : null;
    if (!claimed || !claimed.includes(repo)) reasons.push(`repo ${repo} not on builder`);
    if (Array.isArray(b?.repos) && !b.repos.includes(repo)) reasons.push(`repo ${repo} not allowed by hub config`);
  }
  const score = WEIGHTS.slots * clamp01((m.free ?? 0) / Math.max(1, m.totalSlots ?? 0))
    + WEIGHTS.mem * clamp01((m.mem ?? 0) / MEM_FULL_MB)
    + WEIGHTS.load * (m.load === null ? 0 : 1 - clamp01(m.load))
    + WEIGHTS.swap * (m.swap === null ? 0 : 1 - m.swap)
    - WEIGHTS.attention * m.needsYou;
  if (m.load === null) reasons.push('load unknown');
  return {
    builder: b?.id ?? null,
    score: Math.round(score * 1e4) / 1e4,
    eligible: !reasons.some((r) => r !== 'load unknown'),
    reasons,
    latencyMs: num(b?.conn?.latencyMs ?? b?.latencyMs),
    metrics: m,
  };
}

/** Rank every builder of a fleet-store view. */
export function rank(view, opts = {}) {
  const builders = Array.isArray(view?.builders) ? view.builders : [];
  const rows = builders.map((b, i) => ({ ...assess(b, opts), order: i }));
  rows.sort((a, b) => (Number(b.eligible) - Number(a.eligible))
    || (b.score - a.score)
    || ((a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))
    || (a.order - b.order));
  return rows.map(({ order, ...r }) => r);
}

/** The best eligible builder's row, or null. */
export function pick(view, opts = {}) {
  const top = rank(view, opts)[0];
  return top && top.eligible ? top : null;
}

/**
 * An explicit choice: the builder's row plus `warning` when it is ineligible (the choice still stands; the
 * builder's own launch validation is authoritative). null for a builder not in the view.
 */
export function check(view, builderId, opts = {}) {
  const row = rank(view, opts).find((r) => r.builder === builderId);
  if (!row) return null;
  return row.eligible ? row : { ...row, warning: `builder ${builderId} is not eligible: ${row.reasons.filter((r) => r !== 'load unknown').join('; ')}` };
}
