// Credit, fleet-wide (fleet plan §7.3.8, O11): the pure merge behind
// GET /api/fleet/credit.
//
//   sanitizePart(raw)                   -> a builder's /api/v1/credit body, cleaned
//   withFkeys(part, builderId)          -> lane rows as {builder, lane: fkey, localLane, ...}
//   mergeCredit(parts, {now})           -> the merged view
//
// `parts` is [{builder, code?, account?, data, stale?, ageMs?, error?}] with
// `data` already passed through sanitizePart (mergeCredit sanitizes again when
// it is not, so it is safe on raw input too). A part with `data: null` is a
// builder that has never answered: it is listed in `missing` and contributes
// nothing.
//
// The rules:
// - Builder data is untrusted. Every number is checked and clamped (percent
//   0..100, money and tokens non-negative and bounded, timestamps in range),
//   strings are length-capped, lists are cut to fixed maxima before they are
//   walked, and only known keys are copied. Nothing here formats HTML.
// - The 5 h / 7 d windows are account-wide: every builder on one subscription
//   reports the same counter, so they are NEVER summed. Per `account` group:
//   the gauge (`rateLimits`) is the window with the latest `resetsAt`, and
//   within it the highest `usedPct`; the chart series is the per-minute
//   maximum of the builders' samples (the safe number when they disagree).
// - Cost is per builder, so it is summed; the per-lane rows keep their
//   builder and get fleet keys.
//
// Hub module: imports only server/fleet/* (never a builder-only module).
import { fkey, BUILDER_ID_RX } from '../fleet/keys.mjs';

export const MAX_POINTS = 1000;   // per series from one builder (builders send <= 240)
export const MAX_RESETS = 200;
export const MAX_LANES = 1000;    // lane rows from one builder
export const MAX_SERIES_POINTS = 240; // merged account series, as the builder's thin()
export const MAX_USD = 1e9;
export const MAX_TOKENS = 1e15;
export const MAX_ROWS = 1e9;
const MAX_TS = 8.64e15;           // the largest valid Date
const MINUTE = 60_000;
const STR_MAX = 200;
export const CHARTS = Object.freeze(['sevenDay', 'fiveHour']);
const WINDOWS = Object.freeze(['fiveHour', 'sevenDay']);
const COST_COLS = Object.freeze(['tonight', 'day', 'week', 'allTime']);
const TOKEN_COLS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);
const TITLES = Object.freeze({ sevenDay: '7-day window', fiveHour: '5-hour window' });
export const LABEL = 'API-equivalent';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** A finite number clamped to [lo, hi], else null. */
export function clampNum(v, lo, hi) {
  if (!fin(v)) return null;
  return v < lo ? lo : v > hi ? hi : v;
}
const pct = (v) => clampNum(v, 0, 100);
const usd = (v) => clampNum(v, 0, MAX_USD);
const tok = (v) => clampNum(v, 0, MAX_TOKENS) ?? 0;
/** A timestamp (ms epoch) in the valid Date range, else null (not clamped: an out-of-range time is no time). */
const ts = (v) => (fin(v) && v >= 0 && v <= MAX_TS ? v : null);
const str = (v, max = STR_MAX) => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function cleanSeries(raw, key) {
  const r = isObj(raw) ? raw : {};
  const points = [];
  for (const p of arr(r.points, MAX_POINTS)) {
    if (!isObj(p)) continue;
    const t = ts(p.t);
    const v = pct(p.v);
    if (t === null || v === null) continue;
    points.push({ t, v });
  }
  points.sort((a, b) => a.t - b.t);
  const resets = [...new Set(arr(r.resets, MAX_RESETS).map(ts).filter((t) => t !== null))].sort((a, b) => a - b);
  return {
    title: TITLES[key],
    since: ts(r.since),
    now: ts(r.now),
    points,
    resets,
  };
}

function cleanWindow(w) {
  if (!isObj(w)) return null;
  const usedPct = pct(w.usedPct);
  const resetsAt = ts(w.resetsAt);
  if (usedPct === null || resetsAt === null) return null;
  return { usedPct, resetsAt };
}

function cleanTokens(t) {
  const o = isObj(t) ? t : {};
  const out = {};
  for (const k of TOKEN_COLS) out[k] = tok(o[k]);
  return out;
}

function cleanHue(h) {
  if (fin(h)) return clampNum(h, 0, 360);
  return str(h, 32);
}

function cleanLane(row) {
  if (!isObj(row)) return null;
  const out = { lane: str(row.lane), hue: cleanHue(row.hue) };
  for (const k of COST_COLS) out[k] = k === 'allTime' && row.allTime === null ? null : usd(row[k]) ?? 0;
  out.tokens = cleanTokens(row.tokens);
  return out;
}

/** Already the output of sanitizePart (so a second pass can be skipped)? */
const CLEAN = Symbol('credit.clean');

/** A builder's /api/v1/credit body (untrusted) -> only the known, checked fields. Null on a non-object. */
export function sanitizePart(raw) {
  if (!isObj(raw)) return null;
  if (raw[CLEAN]) return raw;
  const charts = {};
  const rc = isObj(raw.charts) ? raw.charts : {};
  for (const k of CHARTS) charts[k] = cleanSeries(rc[k], k);
  const lanes = [];
  for (const row of arr(raw.lanes, MAX_LANES)) {
    const l = cleanLane(row);
    if (l) lanes.push(l);
  }
  const rt = isObj(raw.totals) ? raw.totals : {};
  const totals = {};
  for (const k of COST_COLS) totals[k] = usd(rt[k]) ?? 0;
  const rl = isObj(raw.rateLimits) ? raw.rateLimits : null;
  const rateLimits = rl ? { fiveHour: cleanWindow(rl.fiveHour), sevenDay: cleanWindow(rl.sevenDay) } : null;
  const rs = isObj(raw.sampler) ? raw.sampler : {};
  const sampler = {
    rows: clampNum(rs.rows, 0, MAX_ROWS) ?? 0,
    lastSampleAt: ts(rs.lastSampleAt),
    lastSampleAgeMs: clampNum(rs.lastSampleAgeMs, 0, MAX_TS),
  };
  const out = {
    builder: typeof raw.builder === 'string' && BUILDER_ID_RX.test(raw.builder) ? raw.builder : null,
    now: ts(raw.now),
    charts,
    lanes,
    totals,
    rateLimits,
    sampler,
    label: LABEL,
  };
  Object.defineProperty(out, CLEAN, { value: true, enumerable: false });
  return out;
}

function safeFkey(id, name) {
  try { return fkey(id, name); } catch { return null; }
}

/** Lane rows with their builder and a fleet key (`lane: null` stays null; `localLane` keeps the builder's name). */
export function laneRows(part, builderId) {
  return (part?.lanes ?? []).map((l) => ({
    builder: builderId,
    lane: l.lane === null ? null : safeFkey(builderId, l.lane),
    localLane: l.lane,
    hue: l.hue,
    tonight: l.tonight,
    day: l.day,
    week: l.week,
    allTime: l.allTime,
    tokens: { ...l.tokens },
  }));
}

/** `b=<id>`: one builder's result unmerged except for the fleet keys. */
export function withFkeys(part, builderId) {
  const p = sanitizePart(part);
  if (!p) return null;
  return { ...p, builder: builderId, lanes: laneRows(p, builderId) };
}

/** Like the builder's thin(): keeps first and last, the max of each bucket between. */
export function thin(points, max = MAX_SERIES_POINTS) {
  if (points.length <= max) return points;
  const bucket = Math.ceil((points.length - 2) / (max - 2));
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += bucket) {
    const end = Math.min(i + bucket, points.length - 1);
    let peak = points[i];
    for (let j = i + 1; j < end; j++) if (points[j].v > peak.v) peak = points[j];
    out.push(peak);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Per-minute maximum of several cleaned series of the same chart. */
export function accountSeries(seriesList, key) {
  const byMinute = new Map();
  let since = null;
  let now = null;
  const resets = new Set();
  for (const s of seriesList) {
    if (!s) continue;
    if (s.since !== null && (since === null || s.since < since)) since = s.since;
    if (s.now !== null && (now === null || s.now > now)) now = s.now;
    for (const r of s.resets) resets.add(r);
    for (const p of s.points) {
      const m = Math.floor(p.t / MINUTE) * MINUTE;
      const cur = byMinute.get(m);
      if (cur === undefined || p.v > cur) byMinute.set(m, p.v);
    }
  }
  const points = [...byMinute].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  return {
    title: TITLES[key],
    since,
    now,
    points: thin(points),
    resets: [...resets].sort((a, b) => a - b).slice(-MAX_RESETS),
  };
}

/** Latest resetsAt wins; among equal resetsAt, the max usedPct. */
function better(cur, next) {
  if (!cur) return true;
  if (next.resetsAt !== cur.resetsAt) return next.resetsAt > cur.resetsAt;
  return next.usedPct > cur.usedPct;
}

const severity = (g) => Math.max(g.fiveHour?.usedPct ?? -1, g.sevenDay?.usedPct ?? -1);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Merge the builders' credit results (see the header). Returns
 * {now, builders, missing, stale, partial, charts:{sevenDay, fiveHour, account,
 * accounts, byBuilder}, rateLimits:{fiveHour, sevenDay, account, accounts},
 * lanes, totals, totalsByBuilder, sampler, label}.
 * `charts.sevenDay/fiveHour` are the worst account's series (the same shape as
 * a single builder's, so the existing chart code draws them).
 */
export function mergeCredit(parts, { now = Date.now() } = {}) {
  const builders = [];
  const missing = [];
  const stale = [];
  const byBuilder = new Map();
  const totalsByBuilder = new Map();
  const groups = new Map(); // account -> {builders, series:{sevenDay:[], fiveHour:[]}, fiveHour, sevenDay}
  const lanes = [];
  const totals = { tonight: 0, day: 0, week: 0, allTime: 0 };
  const sampler = { rows: 0, lastSampleAt: null };
  const seen = new Set();

  for (const part of Array.isArray(parts) ? parts : []) {
    const id = part?.builder;
    if (typeof id !== 'string' || !BUILDER_ID_RX.test(id) || seen.has(id)) continue;
    seen.add(id);
    const account = str(part.account, 64) ?? 'default';
    const data = sanitizePart(part.data);
    const isStale = !data || part.stale === true;
    builders.push({
      id,
      code: str(part.code, 8),
      account,
      ok: !!data && part.stale !== true,
      stale: isStale,
      ageMs: clampNum(part.ageMs, 0, MAX_TS),
      error: str(part.error, 120),
      sampler: data ? { ...data.sampler } : null,
    });
    if (!data) { missing.push(id); continue; }
    if (isStale) stale.push(id);

    let g = groups.get(account);
    if (!g) {
      g = { builders: [], series: { sevenDay: [], fiveHour: [] }, fiveHour: null, sevenDay: null };
      groups.set(account, g);
    }
    g.builders.push(id);
    for (const k of CHARTS) g.series[k].push(data.charts[k]);
    for (const w of WINDOWS) {
      const s = data.rateLimits?.[w];
      if (s && better(g[w], s)) g[w] = { ...s, builder: id };
    }

    byBuilder.set(id, { sevenDay: data.charts.sevenDay, fiveHour: data.charts.fiveHour });
    totalsByBuilder.set(id, { ...data.totals });
    for (const k of COST_COLS) totals[k] += data.totals[k];
    lanes.push(...laneRows(data, id));
    sampler.rows += data.sampler.rows;
    const at = data.sampler.lastSampleAt;
    if (at !== null && (sampler.lastSampleAt === null || at > sampler.lastSampleAt)) sampler.lastSampleAt = at;
  }
  for (const k of COST_COLS) totals[k] = round2(totals[k]);

  const accounts = new Map();
  const gauges = new Map();
  let worst = null;
  for (const [name, g] of groups) {
    const series = {};
    for (const k of CHARTS) series[k] = accountSeries(g.series[k], k);
    accounts.set(name, { builders: [...g.builders], ...series });
    gauges.set(name, { builders: [...g.builders], fiveHour: g.fiveHour, sevenDay: g.sevenDay });
    if (worst === null || severity(g) > severity(groups.get(worst))) worst = name;
  }
  const empty = (k) => ({ title: TITLES[k], since: null, now, points: [], resets: [] });
  const primary = worst !== null ? accounts.get(worst) : null;

  lanes.sort((a, b) => (b.allTime ?? -1) - (a.allTime ?? -1) || b.tonight - a.tonight
    || (a.builder < b.builder ? -1 : a.builder > b.builder ? 1 : 0)
    || String(a.lane ?? '').localeCompare(String(b.lane ?? '')));

  return {
    now,
    builders,
    missing,
    stale,
    partial: missing.length > 0 || stale.length > 0,
    charts: {
      sevenDay: primary?.sevenDay ?? empty('sevenDay'),
      fiveHour: primary?.fiveHour ?? empty('fiveHour'),
      account: worst,
      accounts: Object.fromEntries(accounts),
      byBuilder: Object.fromEntries(byBuilder),
    },
    rateLimits: {
      fiveHour: worst !== null ? gauges.get(worst).fiveHour : null,
      sevenDay: worst !== null ? gauges.get(worst).sevenDay : null,
      account: worst,
      accounts: Object.fromEntries(gauges),
    },
    lanes,
    totals,
    totalsByBuilder: Object.fromEntries(totalsByBuilder),
    sampler: { ...sampler, lastSampleAgeMs: sampler.lastSampleAt === null ? null : Math.max(0, now - sampler.lastSampleAt) },
    label: LABEL,
  };
}
