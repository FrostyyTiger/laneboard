// Budget caps, session cost ceilings and the opt-in quota guard (fleet plan §8 2.5). REVIEW-REQUIRED (SR17).
//
// Limits, by precedence: a `set-budget` override (db kv `budget.overrides`), then the lane record's
// `budgetUsd` (written by launch), then `config.budget.perLaneUsd`; the builder cap is the override, else
// `config.budget.perBuilderUsd`. A record's `budgetUsd` may only LOWER the config default unless the record says
// `budgetSource: 'remote'` (a remote launch); a local launch cannot raise its own cap (SR17 M2).
//
// Attribution (SR17 M3): a session belongs to the lane whose record names it (`record.session`, written by
// launch), whatever its current working directory; the cwd-derived `s.lane` is used only for sessions no record
// names. A `cd` therefore moves neither spend, nor pauses, nor ceilings. Spend is the Morning number: `morning.spendBySession` + `spendByLane` over
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
// (C6: remote-only for budget/quota holds). A budget pause this module wrote that disappears while the scope is
// still over was lifted by such a resume with `override` (or by hand, S7): it is not re-applied, and that
// session's (or, for ALL, the builder's) ceiling is dropped, for the rest of the window (SR17 L1). A budget
// pause written over an operator or quota pause remembers it (db kv `budget.under`) and restores it when the
// budget pause is lifted (SR17 L2). Automatic pauses and lifts are appended to the fleet audit (SR17 L6). The state dir always comes from config.stateDir, never a default.
//
// These are cooperative controls: an agent with a shell on this builder can delete the sentinels or fake its
// statusline cost file. The remote-only rule closes the local-API path only (SECURITY-FIXES S7).
import { WINDOWS, windowStart, isSafeSessionName } from '../util.mjs';
import * as pause from './pause.mjs';
import { spendBySession, spendByLane, laneResolver } from '../morning.mjs';
// C6 owns the resume predicate (`resumeRemoteOnly`); this module only re-exports its kind list (SR17 L5).
export { REMOTE_ONLY_KINDS } from './handlers.mjs';

export const OVERRIDES_KEY = 'budget.overrides';
export const MARKS_KEY = 'budget.marks';
/** Holds a budget pause was written over: {scope: {kind, by, at, reason}} (SR17 L2). */
export const UNDER_KEY = 'budget.under';
export const TICK_MS = 30_000;
export const MAX_USD = 100000;
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
 * A record's budgetUsd only lowers the config default, unless `budgetSource === 'remote'` (SR17 M2).
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
    let usd = dflt;
    if (Object.hasOwn(o.lanes, r.id)) usd = o.lanes[r.id];
    else if (isUsd(r.budgetUsd)) usd = r.budgetSource === 'remote' || dflt === null ? r.budgetUsd : Math.min(r.budgetUsd, dflt);
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
 * sessionLanes(laneRecords) -> Map<session name, lane id>: the binding launch recorded (`record.session`, else
 * the lane id, which is what launch names the session). Retired lanes are left out (SR17 M3).
 */
export function sessionLanes(laneRecords = []) {
  const m = new Map();
  for (const r of laneRecords ?? []) {
    if (!r || !isLaneId(r.id) || r.retiredAt) continue;
    const name = typeof r.session === 'string' && r.session ? r.session : r.id;
    if (!m.has(name)) m.set(name, r.id);
  }
  return m;
}

/** A resolver session -> lane id: the recorded binding first, the cwd-derived `s.lane` only for the rest. */
export function laneOfFor(laneRecords) {
  const bound = laneRecords instanceof Map ? laneRecords : sessionLanes(laneRecords);
  return (s) => (s && bound.has(s.name) ? bound.get(s.name) : s?.lane ?? null);
}

const cwdLane = (s) => s?.lane ?? null;

/**
 * ceilings({sessions, evaluation, limits, pausePct, laneOf?, skipLane?, skipBuilder?}) -> Map<sessionId, usd>
 * For each live session with a Claude session id and a statusline cost: its current statusline total plus
 * what is left before the pause threshold of its lane cap and of the builder cap (the smaller; never
 * negative). A session no cap applies to gets no ceiling. Every session sees the whole remainder, so a lane
 * or builder with several sessions can overshoot until the next tick pauses it (documented).
 * laneOf: session -> lane id (default: `s.lane`; the tick passes the record binding, SR17 M3). skipLane: session
 * names whose lane cap a remote override lifted for this window; skipBuilder: the same for the builder (L1).
 * Two sessions claiming one Claude session id get the smaller ceiling (SR17 L4).
 */
export function ceilings({ sessions = [], evaluation = [], limits, pausePct = 100, laneOf = cwdLane, skipLane = null, skipBuilder = false }) {
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
    const lane = laneOf(s);
    const lr = lane != null && !skipLane?.has?.(s.name) ? byLane.get(lane) : null;
    if (lr && limits?.lanes?.has?.(lane)) left.push(remain(lr));
    if (builderRow && !skipBuilder) left.push(remain(builderRow));
    if (!left.length) continue;
    const c = round(now + Math.min(...left));
    out.set(sid, out.has(sid) ? Math.min(out.get(sid), c) : c);
  }
  return out;
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
 * init({config, db, state, laneRecords, log?, audit?})
 *   db: {kvRead, kvWrite, costRowsForWindow, lastRateLimitSample, addEvent}
 *   audit: the fleet audit ({append}) or a function returning it (null: not wired yet)
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

/**
 * Spend over the window, as Morning computes it: {byLane: Map, totalUsd}. `records` (default: the lane
 * records now) bind sessions to lanes: a recorded session is charged to its lane whatever lane its cwd (or a
 * cost row written after a `cd`) says (SR17 M3).
 */
export function spendFor({ sessions, since, records = recordsNow() }) {
  const d = need();
  const bound = sessionLanes(records);
  const live = new Map();
  const idToName = new Map();
  const dupIds = new Set();
  const byName = new Map();
  for (const s of sessions) {
    byName.set(s.name, s);
    if (s.cost) live.set(s.name, s.cost);
    const id = s.claude?.sessionId;
    if (id) {
      // SR17 L4: an id two sessions claim names neither of them
      if (idToName.has(id) && idToName.get(id) !== s.name) dupIds.add(id);
      idToName.set(id, s.name);
    }
  }
  for (const id of dupIds) idToName.delete(id);
  const nameOf = (r) => r.session_name || idToName.get(r.session_id) || r.session_id || null;
  const spend = spendBySession({ rows: d.db.costRowsForWindow(since) ?? [], since, live, nameOf });
  for (const e of spend.values()) if (bound.has(e.name)) e.lane = bound.get(e.name);
  const cwd = laneResolver(byName);
  const cost = spendByLane(spend, (name) => (bound.has(name) ? bound.get(name) : cwd(name)));
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

function audit(action, target, result) {
  const d = need();
  try {
    const a = typeof d.audit === 'function' ? d.audit() : d.audit;
    if (!a || typeof a.append !== 'function') return;
    a.append({ user: BY, via: null, action, target, args: {}, result: { by: BY, ...result } });
  } catch (err) {
    d.log?.warn?.(`budget: audit append failed for ${action}: ${String(err?.message ?? err).slice(0, 200)}`);
  }
}

function laneSessionNames(sessions, laneId, laneOf = cwdLane) {
  return [...new Set(sessions.filter((s) => laneOf(s) === laneId && pause.isValidScope(s.name) && s.name !== 'ALL' && isSafeSessionName(s.name))
    .map((s) => s.name))];
}

function readUnder() {
  const raw = need().db.kvRead(UNDER_KEY, null);
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [scope, e] of Object.entries(raw)) {
    if (!pause.isValidScope(scope) || !e || typeof e !== 'object' || !['operator', 'quota'].includes(e.kind)) continue;
    out[scope] = {
      kind: e.kind,
      by: typeof e.by === 'string' ? e.by.slice(0, 128) : null,
      at: Number.isFinite(e.at) ? e.at : null,
      reason: typeof e.reason === 'string' ? e.reason.slice(0, 500) : null,
    };
  }
  return out;
}

/** Lift the budget pause on `scope`; restore the hold it was written over (SR17 L2). Returns removed scopes. */
function liftBudget(scope, under, stateDir, now) {
  const r = pause.resume(scope, { kinds: ['budget'] }, { stateDir });
  if (!r.removed.length) return r.removed;
  const prev = under[scope] ?? null;
  if (prev) pause.pause(scope, { kind: prev.kind, by: prev.by, reason: prev.reason }, { stateDir, now: prev.at ?? now });
  delete under[scope];
  audit('budget-lift', scope, { restored: prev ? prev.kind : null });
  return r.removed;
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
  const laneOf = laneOfFor(records);

  let evaluation = [];
  let spend = { byLane: new Map(), totalUsd: 0 };
  if (limits.lanes.size || limits.builder !== null) {
    spend = spendFor({ sessions, since, records });
    evaluation = evaluate({ spendByLane: spend.byLane, builderUsd: spend.totalUsd, limits, warnPct, pausePct });
  }

  const marks = readMarks(since);
  const before = JSON.stringify([...marks.keys]);
  const under = readUnder();
  const underBefore = JSON.stringify(under);
  const paused = [];
  const lifted = [];
  for (const row of evaluation) {
    const mark = `${row.scope}:${row.key}`;
    if (row.level !== 'ok' && !marks.keys.has(`warn:${mark}`)) {
      marks.keys.add(`warn:${mark}`);
      event('warn', row.scope === 'lane' ? row.key : null, { ...row, window });
    }
    const scopes = row.scope === 'builder' ? ['ALL'] : laneSessionNames(sessions, row.key, laneOf);
    if (row.level === 'over') {
      if (!marks.keys.has(`over:${mark}`)) {
        marks.keys.add(`over:${mark}`);
        event('over', row.scope === 'lane' ? row.key : null, { ...row, window });
      }
      const reason = reasonFor(row);
      for (const scope of scopes) {
        const kind = pause.kindOf(scope, { stateDir });
        if (kind === 'budget') continue;
        if (marks.keys.has(`override:${scope}`)) continue;
        if (marks.keys.has(`held:${scope}`)) {
          // SR17 L1: our pause is gone while still over: a remote resume with override lifted it. Respect it
          // for the rest of the window instead of re-pausing on the next tick.
          marks.keys.add(`override:${scope}`);
          delete under[scope];
          audit('budget-override-noted', scope, { scope: row.scope, key: row.key, window });
          continue;
        }
        if (kind === 'operator' || kind === 'quota') {
          // SR17 L2: keep the hold we are about to upgrade, to restore it when the budget pause goes.
          const prev = pause.list({ stateDir }).find((e) => e.scope === scope);
          if (prev) under[scope] = { kind: prev.kind, by: prev.by, at: prev.at, reason: prev.reason };
        }
        pause.pause(scope, { kind: 'budget', by: BY, reason }, { stateDir, now });
        marks.keys.add(`held:${scope}`);
        paused.push(scope);
        audit('budget-pause', scope, { scope: row.scope, key: row.key, usd: row.usd, limit: row.limit, pct: row.pct, window, previous: kind ?? null });
      }
    } else if (lift) {
      for (const scope of scopes) {
        if (pause.kindOf(scope, { stateDir }) !== 'budget') continue;
        lifted.push(...liftBudget(scope, under, stateDir, now));
        marks.keys.delete(`held:${scope}`);
      }
    }
  }
  if (lift) {
    // A budget pause on a session or the builder that no cap holds any more (cap removed) goes too.
    const over = new Set(evaluation.filter((r) => r.level === 'over').flatMap((r) => (r.scope === 'builder' ? ['ALL'] : laneSessionNames(sessions, r.key, laneOf))));
    for (const e of pause.list({ stateDir })) {
      if (e.kind !== 'budget' || e.by !== BY || over.has(e.scope)) continue;
      if (e.scope !== 'ALL' && !sessions.some((s) => s.name === e.scope)) continue;
      lifted.push(...liftBudget(e.scope, under, stateDir, now));
      marks.keys.delete(`held:${e.scope}`);
    }
  }
  // A remembered hold whose budget pause is gone (a remote override removes every kind) is not restored later.
  for (const scope of Object.keys(under)) if (pause.kindOf(scope, { stateDir }) !== 'budget') delete under[scope];
  if (JSON.stringify(under) !== underBefore) d.db.kvWrite(UNDER_KEY, under);
  if (JSON.stringify([...marks.keys]) !== before) d.db.kvWrite(MARKS_KEY, { since, keys: [...marks.keys] });

  const quota = quotaGuard({ config, sessions, records, stateDir, now, laneOf });

  const skipLane = new Set([...marks.keys].filter((k) => k.startsWith('override:') && k !== 'override:ALL').map((k) => k.slice('override:'.length)));
  const ceil = ceilings({ sessions, evaluation, limits, pausePct, laneOf, skipLane, skipBuilder: marks.keys.has('override:ALL') });
  const synced = pause.syncCeilings(ceil, { stateDir });

  last = { at: now, window, since, evaluation };
  return { window, since, evaluation, paused, lifted, ceilings: synced, quota };
}

function quotaGuard({ config, sessions, records, stateDir, now, laneOf = laneOfFor(records) }) {
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
      const lane = laneOf(s);
      if (lane == null || !low.has(lane) || !pause.isValidScope(s.name) || s.name === 'ALL') continue;
      if (pause.kindOf(s.name, { stateDir })) continue; // already held (any kind): never downgrade or rewrite
      pause.pause(s.name, { kind: 'quota', by: BY, reason: `5 h quota at ${pct}% (above ${q.fiveHourPct}%): low-priority lanes wait` }, { stateDir, now });
      out.paused.push(s.name);
      audit('quota-pause', s.name, { lane, pct, threshold: q.fiveHourPct });
    }
    if (out.paused.length) event('quota-pause', null, { pct, sessions: out.paused });
  } else if (pct < q.resumeBelowPct) {
    const held = pause.list({ stateDir }).filter((e) => e.kind === 'quota' && e.scope !== 'ALL');
    if (held.length && q.autoResume === true) {
      for (const e of held) {
        const removed = pause.resume(e.scope, { kinds: ['quota'] }, { stateDir }).removed;
        out.lifted.push(...removed);
        for (const scope of removed) audit('quota-resume', scope, { pct, threshold: q.resumeBelowPct });
      }
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

function forgetOverrides(target) {
  const d = need();
  const raw = d.db.kvRead(MARKS_KEY, null);
  if (!raw || !Array.isArray(raw.keys)) return;
  let scopes;
  if (target === '*') scopes = new Set(['ALL']);
  else {
    const laneOf = laneOfFor(recordsNow());
    scopes = new Set(sessionsNow().filter((s) => laneOf(s) === target).map((s) => s.name));
  }
  // `held:` goes too, or the next tick would read the missing sentinel as a fresh override.
  const forget = (k) => typeof k === 'string' && ['override:', 'held:'].some((p) => k.startsWith(p) && scopes.has(k.slice(p.length)));
  const keys = raw.keys.filter((k) => !forget(k));
  if (keys.length !== raw.keys.length) d.db.kvWrite(MARKS_KEY, { ...raw, keys });
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
 * fall back to the record / config); window optional (a util.WINDOWS name, applies to every cap, so only
 * with target '*', which needs confirm: SR17 L3). Persists, forgets earlier override resumes of the scopes it
 * targets (a new decision), re-evaluates at once and lifts budget pauses that no longer apply.
 */
export async function setBudget({ target, usd, window }, { now = Date.now() } = {}) {
  const d = need();
  if (target !== '*' && !isLaneId(target)) throw new BudgetError('invalid target');
  if (usd !== null && !isUsd(usd)) throw new BudgetError(`usd must be above 0 and at most ${MAX_USD}, or null`);
  if (window !== undefined && window !== null && !WINDOWS.includes(window)) throw new BudgetError('invalid window');
  if (window !== undefined && target !== '*') throw new BudgetError('window applies to every cap: set it with target * (and confirm)');
  const o = readOverrides();
  if (target === '*') o.builder = usd;
  else if (usd === null) delete o.lanes[target];
  else o.lanes[target] = usd;
  if (window !== undefined) o.window = window;
  d.db.kvWrite(OVERRIDES_KEY, { lanes: o.lanes, builder: o.builder, window: o.window });
  forgetOverrides(target);
  const r = await tickOnce(now, { lift: true });
  const row = r.evaluation.find((e) => (target === '*' ? e.scope === 'builder' : e.scope === 'lane' && e.key === target)) ?? null;
  return { ok: true, target, usd, window: r.window, budget: row, lifted: r.lifted, paused: r.paused };
}
