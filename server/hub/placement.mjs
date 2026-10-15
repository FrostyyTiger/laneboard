// Placement (fleet plan §3 2.11): rank builders for a new lane. Pure. REVIEW-REQUIRED (SR11, fixed in H8-fix).
//
// rank(view, {repo?, need?, cfg?}) -> [{builder, score, eligible, reasons[], latencyMs, metrics, selfReported}]
//   sorted eligible first, then score desc, then lower latencyMs, then config order.
//
// Placement is ADVISORY and never widens where work may go. It only chooses among the builders the operator
// listed in the hub config for the repo, and it never sends work to a builder the operator did not list:
// - Repo gate (SECURITY-FIXES S12, SR11 M1/M2). The hub config (`fleet.builders[].repos`, carried on the
//   view row as `repos`) is the authority. A builder is eligible for repo R only when its hub-config `repos`
//   lists R. A builder's own `hello.repos` can only narrow that (it must also claim R); it never widens it.
//   A builder with no hub-side `repos` list is ineligible, unless the hub config explicitly says
//   `fleet.placement.any: true`. No repo (or a malformed repo name) means no builder is eligible.
// - Everything a builder reports (vitals, box, hello) is untrusted input. Numbers are read defensively
//   (non-finite -> unknown) and clamped to sane ranges (see CLAMP), and the score is capped at SCORE_MAX, the
//   score an honest idle builder reaches. A lying builder can at best tie an honest idle one; it can never
//   pass a hard gate it does not meet or outrank the allowlist. Rows carry `selfReported: true` so the UI can
//   label the numbers.
// Hard gates: state up, capability `need` (default 'launch'), repo, >= 1 free lane slot,
// free memory >= minFreeMemMb, swap < maxSwapFrac, no major version skew.
//
// score = 0.40 * free / max(1, totalLaneSlots)
//       + 0.30 * min(1, mem / 16384)
//       + 0.20 * (1 - min(1, load / cpus))
//       + 0.10 * (1 - swap)
//       - 0.05 * lanesNeedingYou
// (each positive term clamped to [0,1], the total to [0, SCORE_MAX]).

import { isRepoName } from './fleet-store.mjs';

export const DEFAULTS = Object.freeze({ minFreeMemMb: 4096, maxSwapFrac: 0.5 });
export const WEIGHTS = Object.freeze({ slots: 0.40, mem: 0.30, load: 0.20, swap: 0.10, attention: 0.05 });
export const MEM_FULL_MB = 16384;
const NEEDS_YOU = new Set(['waiting_permission', 'waiting_question']);
const MAX_SLOTS = 1000;
export const SCORE_MAX = 1;
/** Sane ranges for self-reported numbers. */
export const CLAMP = Object.freeze({ memMb: 16 * 1024 * 1024, cpus: 1024, load: 1e6, needsYou: 1000 });

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampTo = (v, lo, hi) => (v === null ? null : v < lo ? lo : v > hi ? hi : v);

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
  const load5 = clampTo(Array.isArray(vitals?.load) ? num(vitals.load[1]) : null, 0, CLAMP.load);
  const cpusRaw = num(vitals?.cpus);
  const cpus = cpusRaw !== null && cpusRaw >= 1 ? Math.min(Math.floor(cpusRaw), CLAMP.cpus) : null;
  // Available memory cannot exceed the reported total (when there is one) nor CLAMP.memMb.
  const totalMb = num(mem?.totalMb);
  let avail = clampTo(num(mem?.availableMb), 0, CLAMP.memMb);
  if (avail !== null && totalMb !== null && totalMb >= 0) avail = Math.min(avail, totalMb);
  return {
    lanes: Array.isArray(snap?.box?.launched) ? Math.min(snap.box.launched.length, MAX_SLOTS) : 0,
    totalSlots: slots ? slots.total : null,
    free: slots ? Math.min(slots.free, slots.total) : null,
    mem: avail,
    swap: swapTotal === null || swapUsed === null ? null : swapTotal <= 0 ? 0 : clamp01(swapUsed / swapTotal),
    load: load5 !== null && cpus !== null ? load5 / cpus : null,
    needsYou: Math.min(sessionsOf(snap).filter((s) => s && NEEDS_YOU.has(s.state)).length, CLAMP.needsYou),
  };
}

function settings(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const minFreeMemMb = num(c.minFreeMemMb) ?? DEFAULTS.minFreeMemMb;
  const maxSwapFrac = num(c.maxSwapFrac) ?? DEFAULTS.maxSwapFrac;
  return { minFreeMemMb, maxSwapFrac, any: c.any === true };
}

/**
 * The repo gate (hub config is the authority; hello can only narrow). Returns the reasons a builder row
 * may not take a lane for `repo` (empty = allowed). `any` is `fleet.placement.any === true`.
 */
export function repoGate(b, repo, { any = false } = {}) {
  if (!isRepoName(repo)) return ['repo required'];
  const reasons = [];
  const allow = Array.isArray(b?.repos) ? b.repos : null;
  if (allow) {
    if (!allow.includes(repo)) reasons.push(`repo ${repo} not allowed by hub config`);
  } else if (!any) {
    reasons.push('no hub-config repos allowlist for builder');
  }
  const claimed = Array.isArray(b?.hello?.repos) ? b.hello.repos : null;
  if (!claimed || !claimed.includes(repo)) reasons.push(`repo ${repo} not on builder`);
  return reasons;
}

/** One builder's eligibility and score. */
export function assess(b, { repo, need = 'launch', cfg, repoGate: gateRepo = true } = {}) {
  const { minFreeMemMb, maxSwapFrac, any } = settings(cfg);
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
  // `repoGate: false` is only for warnings on an explicit, repo-less choice (a spawn); never for auto-placement.
  if (gateRepo !== false) reasons.push(...repoGate(b, repo, { any }));
  const raw = WEIGHTS.slots * clamp01((m.free ?? 0) / Math.max(1, m.totalSlots ?? 0))
    + WEIGHTS.mem * clamp01((m.mem ?? 0) / MEM_FULL_MB)
    + WEIGHTS.load * (m.load === null ? 0 : 1 - clamp01(m.load))
    + WEIGHTS.swap * (m.swap === null ? 0 : 1 - m.swap)
    - WEIGHTS.attention * m.needsYou;
  const score = Math.min(SCORE_MAX, Math.max(0, raw));
  if (m.load === null) reasons.push('load unknown');
  return {
    builder: b?.id ?? null,
    score: Math.round(score * 1e4) / 1e4,
    eligible: !reasons.some((r) => r !== 'load unknown'),
    reasons,
    latencyMs: num(b?.conn?.latencyMs ?? b?.latencyMs),
    metrics: m,
    selfReported: true,
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
