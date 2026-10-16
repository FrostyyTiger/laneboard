// Fleet Morning merge (fleet plan §10 2.11, R10; also §7 7.3.8's requirements).
//
//   mergeMorning({perBuilder, builders?, waits, stuck, audit, deferred, answerTimes?, window, since, now})
//     -> {window, label, since, now,
//         builders: [{id, code, error?, stale?, needsYou, finished, cost}],
//         needsYou, finished,                       // all builders, concatenated and re-sorted
//         review: {n, waiting, medianWaitMs, p90WaitMs, longest:[{fkey, waitMs}]},
//         stuck: [{fkey, builder, reason, since, resolvedAt}],
//         approvals: {answered, approved, denied, released, medianAnswerMs},
//         costByPackage: [{package, usd, lanes}], totalUsd, totalTokens,
//         missing: [builderId], deferred: [...]}
//
// `perBuilder` is a Map id -> morning.build() result (from the builder's
// `GET /api/v1/morning`) or `{error}`. Everything a builder sent is untrusted
// (SECURITY-FIXES S3): only known fields are copied into fresh objects,
// numbers are clamped, strings are capped and stripped of control characters,
// lists are capped, and every session name / lane id becomes an fkey with the
// builder id taken from the hub's own map key, never from the payload. A
// builder that did not answer (down, slow past 3 s, bad answer) is a row with
// its error, marked `stale`, and listed in `missing`; it is never dropped.
//
// Cost per package: each lane's window spend is split equally across the
// packages it touched (a lane with none goes to `(none)`), so the package
// totals add up to `totalUsd`, which is itself the sum of the clamped lanes
// (a builder's claimed total is not trusted).
//
// Pure apart from `fetchMorning` / `fetchArchive`, which fan out through §3
// H12's read proxy `get()`. Hub module: imports only server/fleet/* and
// server/util.mjs (node built-ins), never a builder-only module.
import { fkey as toFkey, BUILDER_ID_RX, deriveCode } from '../fleet/keys.mjs';
import { WINDOWS, windowStart, windowLabel } from '../util.mjs';

export const FETCH_TIMEOUT_MS = 3000;
export const NONE_PACKAGE = '(none)';
export const LIMITS = Object.freeze({
  needsYou: 200,      // per builder, and for the merged list
  finished: 200,
  costLanes: 300,
  doneMarkers: 20,
  sessions: 30,
  packages: 30,
  reasons: 8,
  text: 500,
  str: 200,
  name: 128,
  error: 200,
  stuck: 200,
  deferred: 200,
  longest: 5,
  packageRows: 300,
  archiveRows: 200,   // per builder and merged
  flatKeys: 16,
  flatArr: 10,
  builders: 64,
});
const MAX_USD = 1e6;
const MAX_TOKENS = 1e13;
const MAX_TS = 1e14;
const LANE_ID_RX = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FLAT_KEY_RX = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const NEEDS_SOURCES = new Set(['attention', 'marker']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const bool = (v) => (v === true ? true : v === false ? false : null);

/** A finite number clamped to [lo, hi], else `d`. */
export function num(v, lo, hi, d = null) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}
const ts = (v) => num(v, 0, MAX_TS, null);
const usd = (v) => num(v, 0, MAX_USD, 0);
const tokens = (v) => Math.trunc(num(v, 0, MAX_TOKENS, 0));

/** A string, well-formed, control characters replaced, capped; else null. */
export function str(v, max = LIMITS.str) {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  return v.toWellFormed().replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').slice(0, max);
}

function fk(builder, name) {
  const s = typeof name === 'string' ? name : null;
  if (!s || s.length > LIMITS.name) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return null;
  try { return toFkey(builder, s); } catch { return null; }
}
const laneFk = (builder, id) => (typeof id === 'string' && LANE_ID_RX.test(id) ? fk(builder, id) : null);

/** A one-level plain copy: allowlisted key shape, scalar values, string arrays; nested once when `depth`. */
function flat(v, depth = 0) {
  if (!isObj(v)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (n >= LIMITS.flatKeys) break;
    if (!FLAT_KEY_RX.test(k)) continue;
    const x = v[k];
    let y;
    if (typeof x === 'number') y = Number.isFinite(x) ? x : null;
    else if (typeof x === 'boolean' || x === null) y = x;
    else if (typeof x === 'string') y = str(x);
    else if (Array.isArray(x)) y = x.slice(0, LIMITS.flatArr).filter((e) => typeof e === 'string').map((e) => str(e));
    else if (isObj(x) && depth > 0) y = flat(x, depth - 1);
    else continue;
    out[k] = y;
    n++;
  }
  return out;
}

function httpsUrl(v) {
  const s = str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function packagesOf(v) {
  const out = [];
  for (const p of list(v, LIMITS.packages)) {
    const s = str(p, 100);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function reviewReadyOf(v) {
  if (!isObj(v)) return null;
  return {
    ready: v.ready === true,
    reasons: list(v.reasons, LIMITS.reasons).map((r) => str(r, 32)).filter(Boolean),
    since: ts(v.since),
  };
}

function prOf(v) {
  if (!isObj(v)) return null;
  return {
    number: num(v.number, 0, 1e9, null),
    url: httpsUrl(v.url),
    state: str(v.state, 32),
    isDraft: bool(v.isDraft),
    verdict: str(v.verdict, 64),
    checks: flat(v.checks, 0),
  };
}

// --- per builder ----------------------------------------------------------------

function needOf(b, x) {
  if (!isObj(x)) return null;
  const name = fk(b, x.name);
  const local = typeof x.id === 'string' ? str(x.id, LIMITS.name) : null;
  return {
    builder: b,
    source: NEEDS_SOURCES.has(x.source) ? x.source : 'marker',
    id: local ? `${b}/${local}` : null,
    markerId: x.markerId === undefined ? undefined : num(x.markerId, 0, Number.MAX_SAFE_INTEGER, null),
    name,
    lane: laneFk(b, x.lane),
    hue: num(x.hue, 0, 360, null),
    state: str(x.state, 32),
    at: ts(x.at),
    kind: str(x.kind, 32),
    text: str(x.text, LIMITS.text) ?? '',
  };
}

function finishedOf(b, x) {
  if (!isObj(x)) return null;
  const lane = laneFk(b, x.lane);
  if (!lane) return null;
  return {
    builder: b,
    lane,
    hue: num(x.hue, 0, 360, null),
    branch: str(x.branch),
    merged: bool(x.merged),
    isMain: x.isMain === true,
    idle: bool(x.idle),
    progress: flat(x.progress, 1),
    lastCommitAt: ts(x.lastCommitAt),
    newCommit: x.newCommit === true,
    doneMarkers: list(x.doneMarkers, LIMITS.doneMarkers).filter(isObj).map((m) => ({
      id: num(m.id, 0, Number.MAX_SAFE_INTEGER, null),
      ts: ts(m.ts),
      text: str(m.text, LIMITS.text) ?? '',
      session: fk(b, m.session),
    })),
    pr: prOf(x.pr),
    sessions: list(x.sessions, LIMITS.sessions).filter(isObj).map((s) => ({
      name: fk(b, s.name),
      state: str(s.state, 32),
      since: ts(s.since),
    })).filter((s) => s.name),
    packages: packagesOf(x.packages),
    reviewReady: reviewReadyOf(x.reviewReady),
    reviewSentAt: ts(x.reviewSentAt),
  };
}

function costLaneOf(b, x) {
  if (!isObj(x)) return null;
  const lane = laneFk(b, x.lane);
  return {
    builder: b,
    lane,
    // A row that is not a lane ('(ended sessions)', the unattributed bucket) keeps its label only.
    label: lane ? null : (str(x.lane, 64) ?? '—'),
    usd: usd(x.usd),
    tokens: tokens(x.tokens),
    sessions: list(x.sessions, LIMITS.sessions).map((s) => fk(b, s)).filter(Boolean),
    hue: num(x.hue, 0, 360, null),
    packages: packagesOf(x.packages),
    reviewReady: reviewReadyOf(x.reviewReady),
    reviewSentAt: ts(x.reviewSentAt),
  };
}

/** `danger` first, then newest first (server/morning.mjs needs sort), then fkey for a stable order. */
export function compareNeeds(a, b) {
  return Number(b.kind === 'danger') - Number(a.kind === 'danger')
    || (b.at ?? 0) - (a.at ?? 0)
    || cmp(a.name ?? a.id ?? '', b.name ?? b.id ?? '');
}

const newsRank = (l) => (l.doneMarkers.length || (l.merged === true && !l.isMain) ? 0 : 1);
/** News first (done marker or merged), then most recently committed, then lane (server/morning.mjs finished sort). */
export function compareFinished(a, b) {
  return newsRank(a) - newsRank(b) || (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0) || cmp(a.lane, b.lane);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const emptyCost = () => ({ lanes: [], totalUsd: 0, totalTokens: 0, label: 'API-equivalent' });

/**
 * One builder's morning result, sanitized and fkeyed. `raw` is the builder's
 * JSON (untrusted) or `{error}`; `id` is the hub's own id for it.
 * -> {id, code, window, since, needsYou, finished, cost} or {id, code, error, stale:true, ...empty}
 */
export function sanitizeBuilderMorning(id, raw, code = null) {
  const c = typeof code === 'string' && /^[A-Z0-9]{2,3}$/.test(code) ? code : deriveCode(id);
  const bad = (error) => ({ id, code: c, error: str(error, LIMITS.error) || 'no answer', stale: true, needsYou: [], finished: [], cost: emptyCost() });
  if (!isObj(raw)) return bad('bad response');
  if (raw.error !== undefined || raw.ok === false) return bad(typeof raw.error === 'string' ? raw.error : 'error');
  const needsYou = list(raw.needsYou, LIMITS.needsYou).map((x) => needOf(id, x)).filter(Boolean);
  for (const n of needsYou) if (n.markerId === undefined) delete n.markerId;
  needsYou.sort(compareNeeds);
  const finished = list(raw.finished, LIMITS.finished).map((x) => finishedOf(id, x)).filter(Boolean).sort(compareFinished);
  const lanes = list(raw.cost?.lanes, LIMITS.costLanes).map((x) => costLaneOf(id, x)).filter(Boolean)
    .sort((a, b) => b.usd - a.usd || cmp(a.lane ?? a.label, b.lane ?? b.label));
  // The totals are recomputed from the clamped lanes; a builder's own figure is not trusted.
  let totalUsd = 0;
  let totalTokens = 0;
  for (const l of lanes) { totalUsd += l.usd; totalTokens += l.tokens; }
  return {
    id,
    code: c,
    window: WINDOWS.includes(raw.window) ? raw.window : null,
    since: ts(raw.since),
    needsYou,
    finished,
    cost: { lanes, totalUsd, totalTokens, label: 'API-equivalent' },
  };
}

// --- hub-side inputs --------------------------------------------------------------

/**
 * Equal split of each lane's spend across its packages.
 * lanes: [{lane, usd, packages}] -> [{package, usd, lanes}] by usd desc; `lanes` is a count.
 */
export function costByPackage(lanes) {
  const by = new Map();
  for (const l of lanes) {
    const pk = l.packages?.length ? l.packages : [NONE_PACKAGE];
    const share = l.usd / pk.length;
    for (const p of pk) {
      const e = by.get(p) ?? { package: p, usd: 0, lanes: 0 };
      e.usd += share;
      e.lanes++;
      by.set(p, e);
    }
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd || cmp(a.package, b.package)).slice(0, LIMITS.packageRows);
}

function reviewOf(waits) {
  const stats = isObj(waits?.stats) ? waits.stats : {};
  const open = Array.isArray(waits?.open) ? waits.open : [];
  const longest = open
    .filter((w) => isObj(w) && typeof w.fkey === 'string')
    .map((w) => ({ fkey: str(w.fkey, LIMITS.name * 2), waitMs: num(w.waitingMs, 0, MAX_TS, 0) }))
    .sort((a, b) => b.waitMs - a.waitMs || cmp(a.fkey, b.fkey))
    .slice(0, LIMITS.longest);
  return {
    n: Math.trunc(num(stats.n, 0, 1e9, 0)),
    waiting: open.length,
    medianWaitMs: num(stats.medianMs, 0, MAX_TS, null),
    p90WaitMs: num(stats.p90Ms, 0, MAX_TS, null),
    longest,
  };
}

/** Median of a list of numbers, or null. */
export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function eventPayload(e) {
  let p = e?.payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return isObj(p) ? p : null;
}

/**
 * Alarm incidents of one kind from §7 O8's alarm history (events `{ts, subtype:
 * 'raised'|'cleared'|'acked', payload:{id, kind, builder, target, text, since}}`)
 * plus the live alarms. An incident is one alarm id + raise time; it is in the
 * window when it started, ended or is still open after `since`.
 * -> [{id, fkey, builder, reason, since, resolvedAt}] newest first.
 */
export function alarmIncidents(history, { kind = 'stuck', since = 0, live = [] } = {}) {
  const inc = new Map();
  const touch = (p, at, cleared) => {
    if (!p || p.kind !== kind || typeof p.id !== 'string') return;
    const start = ts(p.since) ?? at;
    const key = `${p.id}\n${start}`;
    let e = inc.get(key);
    if (!e) {
      const builder = typeof p.builder === 'string' && BUILDER_ID_RX.test(p.builder) ? p.builder : null;
      const target = typeof p.target === 'string' ? p.target : null;
      e = {
        id: str(p.id, 128),
        fkey: builder && target ? fk(builder, target) : null,
        builder,
        reason: str(p.text, LIMITS.text) ?? '',
        since: start,
        resolvedAt: null,
      };
      inc.set(key, e);
    }
    if (cleared && at !== null) e.resolvedAt = e.resolvedAt === null ? at : Math.max(e.resolvedAt, at);
  };
  for (const h of Array.isArray(history) ? history : []) {
    if (!isObj(h)) continue;
    const at = ts(h.ts);
    const p = eventPayload(h);
    if (h.subtype === 'raised' || h.subtype === 'acked') touch(p, at, false);
    else if (h.subtype === 'cleared') touch(p, at, true);
  }
  for (const a of Array.isArray(live) ? live : []) touch(isObj(a) ? a : null, ts(a?.since), false);
  return [...inc.values()]
    .filter((e) => (e.since ?? 0) >= since || e.resolvedAt === null || e.resolvedAt >= since)
    .sort((a, b) => (b.since ?? 0) - (a.since ?? 0) || cmp(a.id, b.id));
}

function stuckOf(stuck) {
  return (Array.isArray(stuck) ? stuck : []).filter(isObj).slice(0, LIMITS.stuck).map((s) => ({
    fkey: typeof s.fkey === 'string' ? str(s.fkey, LIMITS.name * 2) : null,
    builder: typeof s.builder === 'string' && BUILDER_ID_RX.test(s.builder) ? s.builder : null,
    reason: str(s.reason, LIMITS.text) ?? '',
    since: ts(s.since),
    resolvedAt: ts(s.resolvedAt),
  }));
}

export const APPROVAL_ACTIONS = Object.freeze(['approve', 'deny', 'release']);

/**
 * Approvals answered from the hub audit: relayed `approve`/`deny`/`release`
 * envelopes whose `{phase:'done'}` line says ok, in the window, counted once per
 * envelope id. `answerTimes` (ms, e.g. approval alarm raise -> clear) gives the median.
 */
export function approvalsOf(audit, { since = 0, answerTimes = [] } = {}) {
  const seen = new Map();
  for (const e of Array.isArray(audit) ? audit : []) {
    if (!isObj(e) || !APPROVAL_ACTIONS.includes(e.action)) continue;
    const r = isObj(e.result) ? e.result : {};
    if (r.phase !== 'done' || r.ok !== true) continue;
    if (!(typeof e.ts === 'number' && e.ts >= since)) continue;
    const id = typeof e.id === 'string' ? e.id : `${e.ts}:${e.action}:${e.target}`;
    if (!seen.has(id)) seen.set(id, e.action);
  }
  const acts = [...seen.values()];
  return {
    answered: acts.length,
    approved: acts.filter((a) => a === 'approve').length,
    denied: acts.filter((a) => a === 'deny').length,
    released: acts.filter((a) => a === 'release').length,
    medianAnswerMs: median((Array.isArray(answerTimes) ? answerTimes : []).map((x) => num(x, 0, MAX_TS, null))),
  };
}

const DEFERRED_REASONS = new Set(['quiet', 'rate']);
function deferredOf(d) {
  return (Array.isArray(d) ? d : []).filter(isObj).slice(-LIMITS.deferred).map((e) => ({
    id: str(e.id, 128),
    kind: str(e.kind, 32),
    builder: typeof e.builder === 'string' && BUILDER_ID_RX.test(e.builder) ? e.builder : null,
    target: str(e.target, LIMITS.name),
    fkey: str(e.fkey, LIMITS.name * 2),
    title: str(e.title, LIMITS.str) ?? '',
    body: str(e.body, LIMITS.text) ?? '',
    url: typeof e.url === 'string' && e.url.startsWith('#/') ? str(e.url, 300) : null,
    reason: DEFERRED_REASONS.has(e.reason) ? e.reason : 'quiet',
    at: ts(e.at),
  }));
}

// --- merge ------------------------------------------------------------------------

/**
 * The fleet Morning. `builders` ([{id, code}], optional) supplies the hub's
 * codes and the full roster (a configured builder absent from `perBuilder` is
 * listed as missing).
 */
export function mergeMorning({
  perBuilder = new Map(), builders = null, waits = null, stuck = [], audit = [], deferred = [],
  answerTimes = [], window = 'tonight', since = 0, now = Date.now(),
} = {}) {
  const codes = new Map();
  const ids = [];
  for (const b of Array.isArray(builders) ? builders : []) {
    if (isObj(b) && typeof b.id === 'string' && BUILDER_ID_RX.test(b.id) && !codes.has(b.id)) { codes.set(b.id, b.code ?? null); ids.push(b.id); }
  }
  const entries = perBuilder instanceof Map ? perBuilder : new Map();
  for (const id of entries.keys()) if (typeof id === 'string' && BUILDER_ID_RX.test(id) && !codes.has(id)) { codes.set(id, null); ids.push(id); }

  const rows = ids.slice(0, LIMITS.builders).map((id) => sanitizeBuilderMorning(
    id, entries.has(id) ? entries.get(id) : { error: 'no answer' }, codes.get(id),
  ));
  rows.sort((a, b) => b.needsYou.length - a.needsYou.length || cmp(a.id, b.id));

  const needsYou = rows.flatMap((r) => r.needsYou).sort(compareNeeds).slice(0, LIMITS.needsYou);
  const finished = rows.flatMap((r) => r.finished).sort(compareFinished).slice(0, LIMITS.finished);
  const lanes = rows.flatMap((r) => r.cost.lanes);
  let totalUsd = 0;
  let totalTokens = 0;
  for (const r of rows) { totalUsd += r.cost.totalUsd; totalTokens += r.cost.totalTokens; }
  const win = WINDOWS.includes(window) ? window : 'tonight';
  return {
    window: win,
    label: windowLabel(win),
    since,
    now,
    builders: rows,
    needsYou,
    finished,
    review: reviewOf(waits),
    stuck: stuckOf(stuck),
    approvals: approvalsOf(audit, { since, answerTimes }),
    costByPackage: costByPackage(lanes),
    totalUsd,
    totalTokens,
    missing: rows.filter((r) => r.error).map((r) => r.id),
    deferred: deferredOf(deferred),
  };
}

// --- fan-out ----------------------------------------------------------------------

/** The window name, or 'tonight'. */
export function windowOf(v) {
  return WINDOWS.includes(v) ? v : 'tonight';
}

/** The window start on the hub's clock (server/util.mjs windowStart). */
export function sinceOf(window, tz, now) {
  return windowStart(windowOf(window), typeof tz === 'string' && tz ? tz : undefined, now);
}

/** A proxy answer -> the builder's JSON, or {error}. */
function answerOf(r) {
  if (!r || r.status !== 200) {
    const e = isObj(r?.json) && typeof r.json.error === 'string' ? r.json.error : 'no answer';
    return { error: e };
  }
  return isObj(r.json) ? r.json : { error: 'bad response' };
}

/**
 * Fetch every builder's morning through the read proxy in parallel, each with
 * its own 3 s timeout. Never rejects. -> Map id -> build()|{error}.
 */
export async function fetchMorning({ readProxy, ids, window, timeoutMs = FETCH_TIMEOUT_MS }) {
  const w = windowOf(window);
  const out = new Map();
  await Promise.all(ids.map(async (id) => {
    let r;
    try { r = await readProxy.get(id, `/api/v1/morning?window=${w}`, { timeoutMs }); } catch { r = null; }
    out.set(id, answerOf(r));
  }));
  return out;
}

const ARCHIVE_INT = ['created_at', 'retired_at', 'duration_ms', 'tokens', 'stage_n', 'stage_m', 'pr_number'];
const ARCHIVE_STR = { repo: 128, branch: 200, plan_path: 300, plan_title: 300, pr_state: 32, summary: 2000 };

/** One untrusted archive list row -> a clean copy tagged with builder and fkey, or null. */
export function archiveRowOf(builder, x) {
  if (!isObj(x)) return null;
  const lane = laneFk(builder, x.lane);
  if (!lane) return null;
  const row = { builder, fkey: lane, lane: x.lane };
  for (const k of ARCHIVE_INT) row[k] = num(x[k], 0, k.endsWith('_at') ? MAX_TS : 1e15, null);
  for (const [k, max] of Object.entries(ARCHIVE_STR)) row[k] = str(x[k], max);
  row.cost_usd = num(x.cost_usd, 0, MAX_USD, null);
  row.pr_url = httpsUrl(x.pr_url);
  row.merged = bool(x.merged);
  row.restored_as = typeof x.restored_as === 'string' && LANE_ID_RX.test(x.restored_as) ? x.restored_as : null;
  return row;
}

/**
 * Merge per-builder archive answers: rows tagged with `builder`, newest
 * `retired_at` first, capped at `limit`. perBuilder: Map id -> {rows}|{error}.
 */
export function mergeArchive(perBuilder, { limit = 50 } = {}) {
  const rows = [];
  const missing = [];
  for (const [id, ans] of perBuilder) {
    if (!isObj(ans) || ans.error !== undefined || !Array.isArray(ans.rows)) { missing.push(id); continue; }
    for (const x of ans.rows.slice(0, LIMITS.archiveRows)) {
      const r = archiveRowOf(id, x);
      if (r) rows.push(r);
    }
  }
  rows.sort((a, b) => (b.retired_at ?? 0) - (a.retired_at ?? 0) || cmp(a.builder, b.builder) || cmp(a.lane, b.lane));
  const n = Math.max(1, Math.min(LIMITS.archiveRows, Math.trunc(Number(limit)) || 50));
  return { rows: rows.slice(0, n), missing: missing.sort() };
}

/** Fan `GET /api/v1/archive?<query>` out to `ids`. -> Map id -> {rows}|{error}. */
export async function fetchArchive({ readProxy, ids, query = '', timeoutMs = FETCH_TIMEOUT_MS }) {
  const out = new Map();
  const path = query ? `/api/v1/archive?${query}` : '/api/v1/archive';
  await Promise.all(ids.map(async (id) => {
    let r;
    try { r = await readProxy.get(id, path, { timeoutMs }); } catch { r = null; }
    out.set(id, answerOf(r));
  }));
  return out;
}
