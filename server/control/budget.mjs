// Budget caps, session cost ceilings and the opt-in quota guard (fleet plan §8 2.5). REVIEW-REQUIRED (SR17).
//
// Limits, by precedence: a `set-budget` override (db kv `budget.overrides`), then the lane record's
// `budgetUsd` (written by launch), then `config.budget.perLaneUsd`; the builder cap is the override, else
// `config.budget.perBuilderUsd`. Spend is the Morning number: `morning.spendBySession` + `spendByLane` over
// `db.costRowsForWindow(windowStart(window))` with live session costs as the endpoint, so both reconcile.
//
// Every tick (30 s, from server/routes/budget.mjs):
//   - evaluate each capped lane and the builder: level ok | warn (>= warnPct) | over (>= pausePct);
//   - warn: one `budget`/`warn` event per scope and window (first crossing only);
//   - over: a `kind:'budget'` pause sentinel on every live session of the lane (the builder scope: `ALL`).
//     Nothing is killed;
//   - ceilings: `ceiling/sid-<id>` = the statusline cost at which the session reaches its remaining budget,
//     so deploy/hooks/gate.sh stops it at the next tool call even if laneboard is down. Rewritten every tick,
//     removed when no cap applies;
//   - quota guard (opt-in): over `quota.fiveHourPct`, `kind:'quota'` pauses on `priority:'low'` lane sessions;
//     below `quota.resumeBelowPct` with `autoResume`, only `kind:'quota'` sentinels are lifted.
//
// A budget pause is lifted only by `set-budget` (which re-evaluates at once) or by a remote `resume`
// (C6: remote-only for budget/quota holds). The state dir always comes from config.stateDir, never a default.
//
// These are cooperative controls: an agent with a shell on this builder can delete the sentinels or fake its
// statusline cost file. The remote-only rule closes the local-API path only (SECURITY-FIXES S7).
import { WINDOWS, windowStart, isSafeSessionName } from '../util.mjs';
import * as pause from './pause.mjs';
import { spendBySession, spendByLane, laneResolver } from '../morning.mjs';

export const OVERRIDES_KEY = 'budget.overrides';
export const MARKS_KEY = 'budget.marks';
export const TICK_MS = 30_000;
export const MAX_USD = 100000;
/** Pause kinds a local caller may not lift (C6's resume predicate, README §3.5). */
export const REMOTE_ONLY_KINDS = Object.freeze(['budget', 'quota']);
/** A rate-limit sample older than this is not acted on (unless its 5 h window has already reset). */
export const QUOTA_STALE_MS = 30 * 60 * 1000;
const BY = 'budget';
const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export class BudgetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BudgetError';
    this.status = status;
  }
}

const isUsd = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_USD;
const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const isLaneId = (id) => typeof id === 'string' && LANE_ID_RE.test(id) && !id.includes('..');

/** config.stateDir, or a throw: pause.mjs must never fall back to its own default here. */
export function stateDirOf(config) {
  const dir = config?.stateDir;
  if (typeof dir !== 'string' || dir === '') throw new BudgetError('config.stateDir is not set', 500);
  return dir;
}

// ---------------------------------------------------------------------------------------------------------
// Pure pieces

/** The stored overrides, cleaned: {lanes: {id: usd}, builder: usd|null, window: name|null}. */
export function normalizeOverrides(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const lanes = {};
  if (o.lanes && typeof o.lanes === 'object' && !Array.isArray(o.lanes)) {
    for (const [id, usd] of Object.entries(o.lanes)) if (isLaneId(id) && isUsd(usd)) lanes[id] = usd;
  }
  return {
    lanes,
    builder: isUsd(o.builder) ? o.builder : null,
    window: WINDOWS.includes(o.window) ? o.window : null,
  };
}

/** The window the caps are measured over: the override's, else config.budget.window, else 'tonight'. */
export function windowOf(config, overrides) {
  const w = normalizeOverrides(overrides).window ?? config?.budget?.window;
  return WINDOWS.includes(w) ? w : 'tonight';
}

/**
 * limitsFor({config, overrides, laneRecords}) -> {builder: usd|null, lanes: Map<laneId, usd>}
 * Per lane: override > record budgetUsd > config.budget.perLaneUsd. Retired lanes are left out.
 * Only lanes with a cap are in the map.
 */
export function limitsFor({ config, overrides, laneRecords = [] }) {
  const o = normalizeOverrides(overrides);
  const b = config?.budget ?? {};
  const dflt = isUsd(b.perLaneUsd) ? b.perLaneUsd : null;
  const lanes = new Map();
  const ids = new Set();
  for (const r of laneRecords ?? []) {
    if (!r || !isLaneId(r.id) || r.retiredAt) continue;
    ids.add(r.id);
    const usd = Object.hasOwn(o.lanes, r.id) ? o.lanes[r.id] : isUsd(r.budgetUsd) ? r.budgetUsd : dflt;
    if (usd !== null) lanes.set(r.id, usd);
  }
  // An override for a lane without a record (yet) still counts: it is what the operator asked for.
  for (const [id, usd] of Object.entries(o.lanes)) if (!ids.has(id)) lanes.set(id, usd);
  return { builder: o.builder ?? (isUsd(b.perBuilderUsd) ? b.perBuilderUsd : null), lanes };
}

function levelOf(pct, warnPct, pausePct) {
  if (pct >= pausePct) return 'over';
  if (pct >= warnPct) return 'warn';
  return 'ok';
}

function spendMap(spendByLaneIn) {
  if (spendByLaneIn instanceof Map) return spendByLaneIn;
  const m = new Map();
  if (Array.isArray(spendByLaneIn)) {
    for (const l of spendByLaneIn) if (l && l.lane != null) m.set(l.lane, (m.get(l.lane) ?? 0) + (Number(l.usd) || 0));
  } else if (spendByLaneIn && typeof spendByLaneIn === 'object') {
    for (const [k, v] of Object.entries(spendByLaneIn)) m.set(k, Number(v) || 0);
  }
  return m;
}

/**
 * evaluate({spendByLane, builderUsd, limits, warnPct, pausePct})
 *   -> [{scope:'lane'|'builder', key, usd, limit, pct, level:'ok'|'warn'|'over'}]
 * spendByLane: Map laneId -> usd (or morning's lanes array). The builder row has key '*' (set-budget's target).
 */
export function evaluate({ spendByLane: spend, builderUsd = 0, limits, warnPct = 80, pausePct = 100 }) {
  const m = spendMap(spend);
  const rows = [];
  const row = (scope, key, usd, limit) => {
    const u = Math.max(0, Number(usd) || 0);
    const pct = (u / limit) * 100;
    rows.push({ scope, key, usd: round(u), limit, pct: round(pct, 1), level: levelOf(pct, warnPct, pausePct) });
  };
  for (const [id, limit] of [...(limits?.lanes ?? new Map())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (isUsd(limit)) row('lane', id, m.get(id) ?? 0, limit);
  }
  if (isUsd(limits?.builder)) row('builder', '*', builderUsd, limits.builder);
  return rows;
}

function sessionIdOf(s) {
  const id = s?.claude?.sessionId ?? s?.sessionId ?? null;
  return typeof id === 'string' && pause.SID_RE.test(id) ? id : null;
}

/**
 * ceilings({sessions, evaluation, limits, pausePct}) -> Map<sessionId, usd at the statusline>
 * For each live session with a Claude session id and a statusline cost: its current statusline total plus
 * what is left before the pause threshold of its lane cap and of the builder cap (the smaller; never
 * negative). A session no cap applies to gets no ceiling. Every session sees the whole remainder, so a lane
 * or builder with several sessions can overshoot until the next tick pauses it (documented).
 */
export function ceilings({ sessions = [], evaluation = [], limits, pausePct = 100 }) {
  const out = new Map();
  const frac = pausePct / 100;
  const byLane = new Map(evaluation.filter((r) => r.scope === 'lane').map((r) => [r.key, r]));
  const builderRow = evaluation.find((r) => r.scope === 'builder') ?? null;
  const remain = (r) => Math.max(0, r.limit * frac - r.usd);
  for (const s of sessions ?? []) {
    const sid = sessionIdOf(s);
    const now = s?.statuslineCostUsd;
    if (!sid || typeof now !== 'number' || !Number.isFinite(now) || now < 0) continue;
    const left = [];
    const lr = s.lane != null ? byLane.get(s.lane) : null;
    if (lr && limits?.lanes?.has?.(s.lane)) left.push(remain(lr));
    if (builderRow) left.push(remain(builderRow));
    if (!left.length) continue;
    out.set(sid, round(now + Math.min(...left)));
  }
  return out;
}

/**
 * The remote-only predicate for lifting holds (README §3.5, S7): true when a sentinel holding `target` (a
 * session name, or '*' for the builder) is a budget or quota pause. Reads config.stateDir; throws without
 * one (the dispatcher treats a throw as a refusal).
 */
export function isRemoteOnlyHold(target, { stateDir } = {}) {
  if (typeof stateDir !== 'string' || !stateDir) throw new BudgetError('stateDir required', 500);
  const scopes = target === '*' ? ['ALL'] : [target, 'ALL'];
  return scopes.some((scope) => REMOTE_ONLY_KINDS.includes(pause.kindOf(scope, { stateDir })));
}

/** A dispatcher `remoteOnly` predicate built on isRemoteOnlyHold (`override` always counts). */
export function remoteOnlyPredicate(getConfig) {
  return (view, deps) => {
    if (view?.args?.override === true) return true;
    const config = deps?.config ?? (typeof getConfig === 'function' ? getConfig() : getConfig);
    return isRemoteOnlyHold(view?.target, { stateDir: stateDirOf(config) });
  };
}

/** The effective 5 h quota percentage of a db sample, or null when it is unknown or stale. */
export function quotaPct(sample, now = Date.now()) {
  if (!sample || typeof sample !== 'object') return null;
  const resetsAt = Number(sample.five_hour_resets_at ?? sample.fiveHourResetsAt);
  if (Number.isFinite(resetsAt) && resetsAt > 0 && resetsAt <= now) return 0; // the window has reset
  const rawPct = sample.five_hour_pct ?? sample.fiveHourPct;
  if (typeof rawPct !== 'number' || !Number.isFinite(rawPct)) return null;
  const pct = rawPct;
  const ts = Number(sample.ts);
  if (!Number.isFinite(ts) || now - ts > QUOTA_STALE_MS) return null;
  return pct;
}

// ---------------------------------------------------------------------------------------------------------
// The running module: deps injected by server/routes/budget.mjs (and by tests)

let deps = null;
let last = null; // { at, window, since, evaluation }
let running = null;

/**
 * init({config, db, state, laneRecords, log?})
 *   db: {kvRead, kvWrite, costRowsForWindow, lastRateLimitSample, addEvent}
 *   state: {all() -> sessions}
 *   laneRecords: () => lane records (server/lanes/store.mjs readAll)
 */
export function init(d) {
  deps = d;
  last = null;
  running = null;
}

/** Tests only. */
export function _reset() {
  deps = null;
  last = null;
  running = null;
}

function need() {
  if (!deps) throw new BudgetError('budget module is not initialised', 500);
  return deps;
}

function cfg() {
  const d = need();
  return typeof d.config === 'function' ? d.config() : d.config;
}

export function readOverrides() {
  return normalizeOverrides(need().db.kvRead(OVERRIDES_KEY, null));
}

function sessionsNow() {
  const s = need().state;
  const list = typeof s?.all === 'function' ? s.all() : [];
  return Array.isArray(list) ? list.filter((x) => x && typeof x.name === 'string') : [];
}

function recordsNow() {
  const f = need().laneRecords;
  try {
    const r = typeof f === 'function' ? f() : [];
    return Array.isArray(r) ? r : [];
  } catch (err) {
    need().log?.warn?.(`budget: lane records unreadable: ${String(err?.message ?? err).slice(0, 200)}`);
    return [];
  }
}

/** Spend over the window, as Morning computes it: {byLane: Map, totalUsd}. */
export function spendFor({ sessions, since }) {
  const d = need();
  const live = new Map();
  const idToName = new Map();
  const byName = new Map();
  for (const s of sessions) {
    byName.set(s.name, s);
    if (s.cost) live.set(s.name, s.cost);
    if (s.claude?.sessionId) idToName.set(s.claude.sessionId, s.name);
  }
  const nameOf = (r) => r.session_name || idToName.get(r.session_id) || r.session_id || null;
  const spend = spendBySession({ rows: d.db.costRowsForWindow(since) ?? [], since, live, nameOf });
  const cost = spendByLane(spend, laneResolver(byName));
  const byLane = new Map();
  for (const l of cost.lanes) if (l.lane != null) byLane.set(l.lane, l.usd);
  return { byLane, totalUsd: cost.totalUsd };
}

// Marks: which scopes already got their warn/over event in which window (survives restarts).
function readMarks(since) {
  const raw = need().db.kvRead(MARKS_KEY, null);
  if (!raw || raw.since !== since || !Array.isArray(raw.keys)) return { since, keys: new Set() };
  return { since, keys: new Set(raw.keys.filter((k) => typeof k === 'string').slice(0, 2000)) };
}

function event(subtype, sessionName, payload) {
  try {
    need().db.addEvent({ type: 'budget', subtype, sessionName, payload });
  } catch { /* events are best effort */ }
}

function laneSessionNames(sessions, laneId) {
  return sessions.filter((s) => s.lane === laneId && pause.isValidScope(s.name) && s.name !== 'ALL' && isSafeSessionName(s.name))
    .map((s) => s.name);
}

function reasonFor(row) {
  const what = row.scope === 'builder' ? 'builder' : `lane ${row.key}`;
  return `over budget: ${what} spent $${row.usd.toFixed(2)} of $${row.limit.toFixed(2)} (${row.pct}%); raise it with set-budget`;
}

/**
 * One evaluation pass. `lift: true` (set-budget) also lifts budget pauses whose scope is no longer over.
 * Returns {window, since, evaluation, paused:[scope], lifted:[scope], ceilings:{written, removed}, quota}.
 */
export async function tick(now = Date.now(), { lift = false } = {}) {
  const d = need();
  const config = cfg();
  const stateDir = stateDirOf(config);
  const b = config.budget ?? {};
  const warnPct = Number.isFinite(b.warnPct) ? b.warnPct : 80;
  const pausePct = Number.isFinite(b.pausePct) ? b.pausePct : 100;
  const overrides = readOverrides();
  const window = windowOf(config, overrides);
  const since = windowStart(window, config.timezone, now);
  const sessions = sessionsNow();
  const records = recordsNow();
  const limits = limitsFor({ config, overrides, laneRecords: records });

  let evaluation = [];
  let spend = { byLane: new Map(), totalUsd: 0 };
  if (limits.lanes.size || limits.builder !== null) {
    spend = spendFor({ sessions, since });
    evaluation = evaluate({ spendByLane: spend.byLane, builderUsd: spend.totalUsd, limits, warnPct, pausePct });
  }

  const marks = readMarks(since);
  const before = marks.keys.size;
  const paused = [];
  const lifted = [];
  for (const row of evaluation) {
    const mark = `${row.scope}:${row.key}`;
    if (row.level !== 'ok' && !marks.keys.has(`warn:${mark}`)) {
      marks.keys.add(`warn:${mark}`);
      event('warn', row.scope === 'lane' ? row.key : null, { ...row, window });
    }
    const scopes = row.scope === 'builder' ? ['ALL'] : laneSessionNames(sessions, row.key);
    if (row.level === 'over') {
      if (!marks.keys.has(`over:${mark}`)) {
        marks.keys.add(`over:${mark}`);
        event('over', row.scope === 'lane' ? row.key : null, { ...row, window });
      }
      const reason = reasonFor(row);
      for (const scope of scopes) {
        if (pause.kindOf(scope, { stateDir }) === 'budget') continue;
        pause.pause(scope, { kind: 'budget', by: BY, reason }, { stateDir, now });
        paused.push(scope);
      }
    } else if (lift) {
      for (const scope of scopes) {
        if (pause.kindOf(scope, { stateDir }) !== 'budget') continue;
        const r = pause.resume(scope, { kinds: ['budget'] }, { stateDir });
        lifted.push(...r.removed);
      }
    }
  }
  if (lift) {
    // A budget pause on a session or the builder that no cap holds any more (cap removed) goes too.
    const over = new Set(evaluation.filter((r) => r.level === 'over').flatMap((r) => (r.scope === 'builder' ? ['ALL'] : laneSessionNames(sessions, r.key))));
    for (const e of pause.list({ stateDir })) {
      if (e.kind !== 'budget' || e.by !== BY || over.has(e.scope)) continue;
      if (e.scope !== 'ALL' && !sessions.some((s) => s.name === e.scope)) continue;
      const r = pause.resume(e.scope, { kinds: ['budget'] }, { stateDir });
      lifted.push(...r.removed);
    }
  }
  if (marks.keys.size !== before) d.db.kvWrite(MARKS_KEY, { since, keys: [...marks.keys] });

  const quota = quotaGuard({ config, sessions, records, stateDir, now });

  const ceil = ceilings({ sessions, evaluation, limits, pausePct });
  const synced = pause.syncCeilings(ceil, { stateDir });

  last = { at: now, window, since, evaluation };
  return { window, since, evaluation, paused, lifted, ceilings: synced, quota };
}

function quotaGuard({ config, sessions, records, stateDir, now }) {
  const q = config.budget?.quota;
  if (!q || q.enabled !== true) return null;
  const d = need();
  let sample = null;
  try { sample = d.db.lastRateLimitSample(); } catch { sample = null; }
  const pct = quotaPct(sample, now);
  const out = { pct, paused: [], lifted: [] };
  if (pct === null) return out;
  if (pct > q.fiveHourPct) {
    const low = new Set(records.filter((r) => r && !r.retiredAt && r.priority === 'low').map((r) => r.id));
    for (const s of sessions) {
      if (s.lane == null || !low.has(s.lane) || !pause.isValidScope(s.name) || s.name === 'ALL') continue;
      if (pause.kindOf(s.name, { stateDir })) continue; // already held (any kind): never downgrade or rewrite
      pause.pause(s.name, { kind: 'quota', by: BY, reason: `5 h quota at ${pct}% (above ${q.fiveHourPct}%): low-priority lanes wait` }, { stateDir, now });
      out.paused.push(s.name);
    }
    if (out.paused.length) event('quota-pause', null, { pct, sessions: out.paused });
  } else if (pct < q.resumeBelowPct) {
    const held = pause.list({ stateDir }).filter((e) => e.kind === 'quota' && e.scope !== 'ALL');
    if (held.length && q.autoResume === true) {
      for (const e of held) out.lifted.push(...pause.resume(e.scope, { kinds: ['quota'] }, { stateDir }).removed);
      if (out.lifted.length) event('quota-resume', null, { pct, sessions: out.lifted });
    } else if (held.length) {
      const marks = d.db.kvRead('budget.quota', null);
      // Alarm once per drop below the threshold, not every tick.
      if (!marks || marks.notified !== true) {
        event('quota-resumable', null, { pct, sessions: held.map((e) => e.scope) });
        d.db.kvWrite('budget.quota', { notified: true, at: now });
      }
    }
  }
  if (pct >= q.resumeBelowPct) {
    const marks = d.db.kvRead('budget.quota', null);
    if (marks?.notified) d.db.kvWrite('budget.quota', { notified: false, at: now });
  }
  return out;
}

/** Snapshot key `budget`: the last evaluation ([] before the first tick or with no caps). */
export function snapshotValue() {
  return last ? last.evaluation.map((r) => ({ ...r })) : [];
}

/** Run tick() at most once at a time; a tick that finds one running waits for it. */
export async function tickOnce(now = Date.now(), opts = {}) {
  if (running) await running.catch(() => {});
  running = tick(now, opts);
  try {
    return await running;
  } finally {
    running = null;
  }
}

/**
 * set-budget: target a lane id or '*' (the builder); usd a number of dollars or null (drop the override and
 * fall back to the record / config); window optional (a util.WINDOWS name, applies to every cap).
 * Persists, re-evaluates at once and lifts budget pauses that no longer apply.
 */
export async function setBudget({ target, usd, window }, { now = Date.now() } = {}) {
  const d = need();
  if (target !== '*' && !isLaneId(target)) throw new BudgetError('invalid target');
  if (usd !== null && !isUsd(usd)) throw new BudgetError(`usd must be above 0 and at most ${MAX_USD}, or null`);
  if (window !== undefined && window !== null && !WINDOWS.includes(window)) throw new BudgetError('invalid window');
  const o = readOverrides();
  if (target === '*') o.builder = usd;
  else if (usd === null) delete o.lanes[target];
  else o.lanes[target] = usd;
  if (window !== undefined) o.window = window;
  d.db.kvWrite(OVERRIDES_KEY, { lanes: o.lanes, builder: o.builder, window: o.window });
  const r = await tickOnce(now, { lift: true });
  const row = r.evaluation.find((e) => (target === '*' ? e.scope === 'builder' : e.scope === 'lane' && e.key === target)) ?? null;
  return { ok: true, target, usd, window: r.window, budget: row, lifted: r.lifted, paused: r.paused };
}
