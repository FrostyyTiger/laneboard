// Review queue (pure, fleet plan §10 2.5, R6).
//
// buildReviewQueue(lanes, now, lookups?) turns the fleet store's lanes into the
// rows of Inbox's REVIEW group: only lanes whose `reviewReady.ready` is true,
// longest-waiting first, ties broken by fleet key. The UI recomputes it from
// the store on every delta, so builder mode and hub mode share one code path.
//
// Lane fields come from R5's lane decorator (server/flags/review.mjs):
//   reviewReady {ready, reasons, since} | null, reviewSentAt ms | null,
//   diffStat {files, add, del} | null, packages [name], costUsd number.
// PR records and repo names are not on the lane; they live in the builder's box
// payload (`box.prs[laneId]`, `box.launched[]`). Pass `storeLookups(store)` (or
// your own `{prFor, repoFor, sessionsFor}`) to fill them; without lookups the
// lane's own `pr`/`repo` fields are used when present.
//
// Everything here is builder-supplied, untrusted data: values are type-checked
// and copied into fresh plain objects, never rendered here. Renderers use
// textContent only. No DOM, no globals: importable by node --test.

import { fkey as makeFkey, parseFkey, BUILDER_ID_RX } from './keys.js';
import { hueFromId } from './format.js';

export const REASONS = Object.freeze(['done-marker', 'pr-green', 'stop-diff']);
const REASON_SET = new Set(REASONS);
const MAX_PACKAGES = 50;
const MAX_SESSIONS = 50;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOr = (v, d) => (isNum(v) ? v : d);
const strOr = (v, d = null) => (typeof v === 'string' && v !== '' ? v : d);
const intOr0 = (v) => (isNum(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * The review-wait metric for one ready episode: (reviewSentAt ?? now) - since.
 * A reviewSentAt from before `since` belongs to an earlier episode (the lane
 * became ready again after a review was sent), so the wait is still open and
 * runs to `now`. Never negative.
 */
export function reviewWaitMs({ since, reviewSentAt } = {}, now = Date.now()) {
  if (!isNum(since)) return 0;
  const end = isNum(reviewSentAt) && reviewSentAt >= since ? reviewSentAt : now;
  return Math.max(0, end - since);
}

/** Short wait-timer text: '45s', '12m', '3h05m', '2d04h'. */
export function formatWait(ms) {
  const s = Math.max(0, Math.floor(numOr(ms, 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d${String(h % 24).padStart(2, '0')}h`;
}

/** The lane's fleet key and builder id, or null when neither can be trusted. */
function laneIdentity(lane) {
  const id = strOr(lane.id);
  if (id && typeof lane.builder === 'string' && BUILDER_ID_RX.test(lane.builder)) {
    return { key: makeFkey(lane.builder, id), builder: lane.builder, id };
  }
  const p = parseFkey(lane.key);
  if (!p) return null;
  return { key: lane.key, builder: p.builder, id: id ?? p.name };
}

/** A PR summary (collector/pr.mjs / providers/ci/gh.mjs shape) -> {pr, checks}. */
function prParts(raw) {
  if (!raw || typeof raw !== 'object' || raw.none || raw.error) return { pr: null, checks: null };
  const pr = {
    number: isNum(raw.number) ? raw.number : null,
    url: strOr(raw.url),
    state: strOr(raw.state),
    isDraft: raw.isDraft === true,
    verdict: strOr(raw.verdict, 'none'),
  };
  const c = raw.checks;
  const checks = c && typeof c === 'object'
    ? { passed: intOr0(c.passed), failed: intOr0(c.failed), pending: intOr0(c.pending), total: intOr0(c.total) }
    : null;
  return { pr, checks };
}

function diffStatOf(d) {
  if (!d || typeof d !== 'object') return null;
  return { files: intOr0(d.files), add: intOr0(d.add), del: intOr0(d.del) };
}

function packagesOf(p) {
  if (!Array.isArray(p)) return [];
  return p.filter((x) => typeof x === 'string' && x !== '').slice(0, MAX_PACKAGES);
}

function sessionsOf(list, builder) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, MAX_SESSIONS)) {
    const name = typeof s === 'string' ? s : strOr(s?.name);
    if (!name) continue;
    const state = typeof s === 'object' && s !== null ? strOr(s.state) : null;
    out.push({ fkey: makeFkey(builder, name), state });
  }
  return out;
}

/**
 * @param {Array} lanes  fleet store lanes (each with .key and .builder)
 * @param {number} now   ms
 * @param {{prFor?, repoFor?, sessionsFor?}} [lookups]  each called with (lane, builderId)
 * @returns {Array<{fkey, builder, lane, repo, branch, hue, reasons, since, waitMs,
 *   pr, checks, diffStat, packages, costUsd, sessions: [{fkey, state}]}>}
 */
export function buildReviewQueue(lanes, now = Date.now(), lookups = {}) {
  if (!Array.isArray(lanes)) return [];
  const { prFor, repoFor, sessionsFor } = lookups ?? {};
  const out = [];
  for (const lane of lanes) {
    if (!lane || typeof lane !== 'object') continue;
    const rr = lane.reviewReady;
    if (!rr || rr.ready !== true || !isNum(rr.since)) continue;
    const ident = laneIdentity(lane);
    if (!ident) continue;
    const { key, builder, id } = ident;

    const prRaw = typeof prFor === 'function' ? prFor(lane, builder) : lane.pr;
    const { pr, checks } = prParts(prRaw);
    const repo = strOr(typeof repoFor === 'function' ? repoFor(lane, builder) : lane.repo);
    const sess = typeof sessionsFor === 'function' ? sessionsFor(lane, builder) : lane.sessions;
    const reviewSentAt = isNum(lane.reviewSentAt) ? lane.reviewSentAt : null;

    out.push({
      fkey: key,
      builder,
      lane: id,
      repo,
      branch: strOr(lane.branch),
      hue: isNum(lane.hue) ? lane.hue : hueFromId(id),
      reasons: Array.isArray(rr.reasons) ? [...new Set(rr.reasons.filter((r) => REASON_SET.has(r)))] : [],
      since: rr.since,
      waitMs: reviewWaitMs({ since: rr.since, reviewSentAt }, now),
      pr,
      checks,
      diffStat: diffStatOf(lane.diffStat),
      packages: packagesOf(lane.packages),
      costUsd: numOr(lane.costUsd, 0),
      sessions: sessionsOf(sess, builder),
    });
  }
  out.sort((a, b) => b.waitMs - a.waitMs || (a.fkey < b.fkey ? -1 : a.fkey > b.fkey ? 1 : 0));
  return out;
}

const get = (m, k) => (m instanceof Map ? m.get(k) : m && typeof m === 'object' ? m[k] : undefined);

/**
 * Lookups over the fleet client store (§1 2.5): `store.builders` (Map id ->
 * Builder with `.box`) and `store.sessions` (Map fkey -> Session). PRs come
 * from `box.prs[laneId]`, the repo from the launch record in `box.launched`,
 * session states from the store's session index.
 */
export function storeLookups(store) {
  const builders = store?.builders;
  const sessions = store?.sessions;
  const boxOf = (b) => get(builders, b)?.box ?? null;
  return {
    prFor(lane, b) {
      const prs = boxOf(b)?.prs;
      return prs && typeof prs === 'object' && Object.hasOwn(prs, lane.id) ? prs[lane.id] : lane.pr ?? null;
    },
    repoFor(lane, b) {
      const rec = Array.isArray(boxOf(b)?.launched) ? boxOf(b).launched.find((r) => r?.id === lane.id) : null;
      return rec?.repo ?? lane.repo ?? null;
    },
    sessionsFor(lane, b) {
      if (!Array.isArray(lane.sessions)) return [];
      return lane.sessions.map((s) => {
        const name = typeof s === 'string' ? s : s?.name;
        if (typeof name !== 'string' || name === '') return null;
        const live = get(sessions, makeFkey(b, name));
        return { name, state: live?.state ?? (typeof s === 'object' ? s?.state : null) ?? null };
      }).filter(Boolean);
    },
  };
}
