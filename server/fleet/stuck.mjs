// Stuck detector (fleet plan §7.3.2, O4). Builder-side and pure: no I/O, no
// timers, no imports from state.mjs. The flag module (server/flags/stuck.mjs,
// O5) feeds it the session, its lane, the signal ring and counters from
// server/collector/signals.mjs, and the cost samples; this module only says
// whether a session looks stuck and why.
//
// It only ever produces a badge. It never sends keys and never kills. The one
// side effect is the injected `onAutoPause(name, stuck)` hook, which is OFF by
// default (stuck.autoPause: false), defaults to a no-op, and is only called for
// the rules in stuck.autoPauseRules (tool-loop and error-loop).
//
// Stuck = {rule, reason, since, evidence: [{rule, detail}], rules: [rule...]}
//   rule      the winning rule (first match in RULES order)
//   reason    short human text for the badge, at most 60 chars
//   since     when the winning rule first matched (kept stable by the tracker)
//   evidence  one entry per matched rule, in RULES order
//   rules     every matched rule, in RULES order
//
// Strings in reason/detail can carry builder-provided text (tool names); they
// are length-capped here and must be escaped by whoever renders them.
import { STUCK_RULES, defaults as observabilityDefaults } from '../config/observability.mjs';

/** Priority order = array order (first match wins the badge). */
export const RULES = STUCK_RULES;

export const REASON_MAX = 60;
export const DETAIL_MAX = 200;
/** error-loop looks at this many newest events (§7.3.2). */
export const ERROR_LOOP_EVENTS = 20;

const MIN = 60 * 1000;

/** Events that end a turn: a loop before one of these is no longer running. */
const TURN_BOUNDARY = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionStart', 'SessionEnd']);
/** Events that do not resolve a pending permission request. */
const NOT_A_RESOLUTION = new Set(['Notification', 'PermissionRequest']);
const IDLE_STATES = new Set(['done', 'idle']);

const clip = (s, max) => {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};
const toolName = (t) => clip(t || '?', 24);
const mins = (ms) => `${Math.max(0, Math.floor(ms / MIN))}m`;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The stuck config with defaults filled in. Accepts the whole config ({stuck})
 * or the stuck fragment itself.
 */
export function resolveCfg(cfg) {
  const base = observabilityDefaults().stuck;
  const src = cfg && typeof cfg === 'object' ? (cfg.stuck && typeof cfg.stuck === 'object' ? cfg.stuck : cfg) : {};
  const out = { ...base };
  for (const k of Object.keys(base)) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** The progress fingerprint of a session: head|dirty|ahead|linesAdded+linesRemoved. */
export function progressFingerprint(session) {
  const s = session ?? {};
  const lines = (Number(s.linesAdded) || 0) + (Number(s.linesRemoved) || 0);
  return `${s.head ?? ''}|${s.dirty ?? 0}|${s.ahead ?? 0}|${lines}`;
}

const keyOf = (e) => (e.tool && e.inHash ? `${e.tool}\0${e.inHash}` : null);

/** Events after the last turn boundary (oldest first). */
function currentTurn(events) {
  let i = events.length - 1;
  while (i >= 0 && !TURN_BOUNDARY.has(events[i].ev)) i--;
  return events.slice(i + 1);
}

// --- the rules ---------------------------------------------------------------
// Each returns null or {reason, detail}. They read a normalised input.

function approvalWait({ session, events, now, c }) {
  const limit = c.approvalWaitMin * MIN;
  if (session.state === 'waiting_permission' && isNum(session.stateSince)) {
    const age = now - session.stateSince;
    if (age > limit) {
      const tool = session.activity?.tool ?? lastPermTool(events);
      return { reason: `approval ${mins(age)}: ${toolName(tool)}`, detail: `state waiting_permission for ${mins(age)}` };
    }
  }
  // An unresolved PermissionRequest in the ring: nothing but notifications after it.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.ev === 'PermissionRequest') {
      const age = now - e.t;
      if (age > limit) return { reason: `approval ${mins(age)}: ${toolName(e.tool)}`, detail: `PermissionRequest for ${toolName(e.tool)} unresolved for ${mins(age)}` };
      return null;
    }
    if (!NOT_A_RESOLUTION.has(e.ev)) return null;
  }
  return null;
}

function lastPermTool(events) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].ev === 'PermissionRequest') return events[i].tool;
  return null;
}

function errorLoop({ events, now, c }) {
  const from = now - c.errorLoopWindowMin * MIN;
  const groups = new Map();
  for (const e of events.slice(-ERROR_LOOP_EVENTS)) {
    if (!e.errHash || !isNum(e.t) || e.t < from || e.t > now) continue;
    const g = groups.get(e.errHash) ?? { n: 0, tool: null, first: e.t };
    g.n++;
    g.tool = e.tool ?? g.tool;
    groups.set(e.errHash, g);
  }
  let best = null;
  for (const [hash, g] of groups) if (g.n >= c.errorLoopCount && (!best || g.n > best.n)) best = { hash, ...g };
  if (!best) return null;
  return {
    reason: `same error ×${best.n} (${toolName(best.tool)})`,
    detail: `${best.n} failures with error ${best.hash} in ${mins(now - best.first)}`,
  };
}

function toolLoop({ turnPre, c }) {
  const k = c.toolLoopCount;
  if (turnPre.length < k) return null;
  const tail = turnPre.slice(-k);
  const key = keyOf(tail[0]);
  if (!key || !tail.every((e) => keyOf(e) === key)) return null;
  // Count the whole run, not just the K that fired.
  let n = 0;
  for (let i = turnPre.length - 1; i >= 0 && keyOf(turnPre[i]) === key; i--) n++;
  const tool = toolName(tail[0].tool);
  return { reason: `${tool} ×${n} same input`, detail: `${n} consecutive ${tool} calls with input ${tail[0].inHash}` };
}

function oscillation({ turnPre, c }) {
  const r = c.oscillationRepeats;
  if (turnPre.length < 2 * r) return null;
  const tail = turnPre.slice(-2 * r).map(keyOf);
  const a = tail[0];
  const b = tail[1];
  if (!a || !b || a === b) return null;
  for (let i = 0; i < tail.length; i++) if (tail[i] !== (i % 2 === 0 ? a : b)) return null;
  const ta = toolName(turnPre[turnPre.length - 2 * r].tool);
  const tb = toolName(turnPre[turnPre.length - 2 * r + 1].tool);
  return { reason: `A↔B ×${r} (${ta}/${tb})`, detail: `last ${2 * r} tool calls alternate ${ta} and ${tb}` };
}

function stalled({ session, events, counters, now, c }) {
  if (session.state !== 'working') return null;
  const last = events[events.length - 1] ?? null;
  const lastAt = isNum(counters.lastEventAt) ? counters.lastEventAt : last?.t;
  if (!isNum(lastAt)) return null;
  const inFlight = last?.ev === 'PreToolUse';
  const limit = (inFlight ? c.stalledToolMin : c.stalledMin) * MIN;
  const age = now - lastAt;
  if (age < limit) return null;
  // A live subagent that is still reporting is not a stall.
  const subAt = counters.lastSubagentAt;
  if ((counters.subagentsLive ?? 0) > 0 && isNum(subAt) && now - subAt < c.stalledToolMin * MIN) return null;
  if (inFlight) {
    return { reason: `tool in flight ${mins(age)}: ${toolName(last.tool)}`, detail: `PreToolUse ${toolName(last.tool)} with no PostToolUse for ${mins(age)}` };
  }
  return { reason: `no events ${mins(age)}`, detail: `working with no hook event for ${mins(age)}` };
}

function contextPressure({ session, counters, now, c }) {
  const pct = session.context?.usedPct;
  if (isNum(pct) && pct > c.contextPct) {
    return { reason: `ctx ${Math.round(pct)}%`, detail: `context ${pct}% used (> ${c.contextPct}%)` };
  }
  const comp = (counters.compactions ?? []).filter(isNum).sort((x, y) => x - y);
  const gap = c.compactMin * MIN;
  if (comp.length < 2) return null;
  const newest = comp[comp.length - 1];
  // Recent only: once no compaction has happened for compactMin, it clears.
  if (now - newest >= gap) return null;
  let i = comp.length - 1;
  while (i > 0 && comp[i] - comp[i - 1] < gap) i--;
  const n = comp.length - i;
  if (n < 2) return null;
  const span = newest - comp[i];
  return { reason: `compact ×${n} in ${mins(span)}`, detail: `${n} compactions, each less than ${c.compactMin}m apart` };
}

function costNoProgress({ costNow, costThen, progress, now, c }) {
  if (!isNum(costNow) || !isNum(costThen) || !progress || !isNum(progress.since)) return null;
  const spent = costNow - costThen;
  if (spent < c.costUsd) return null;
  if (now - progress.since < c.costWindowMin * MIN) return null;
  return {
    reason: `$${spent.toFixed(2)}/${c.costWindowMin}m, no diff`,
    detail: `$${spent.toFixed(2)} spent in ${c.costWindowMin}m with progress fingerprint unchanged`,
  };
}

const isLaneDone = (m) => m?.kind === 'done' && (m.text == null || /LANE-DONE/.test(String(m.text)));

function idleInWorking({ session, lane, now, c }) {
  if (!lane || !lane.record) return null;
  if (!IDLE_STATES.has(session.state) || !isNum(session.stateSince)) return null;
  const markers = Array.isArray(lane.markers) ? lane.markers : [];
  if (lane.done === true || markers.some(isLaneDone)) return null;
  const age = now - session.stateSince;
  if (age <= c.idleMin * MIN) return null;
  // A NEED/BLOCKED marker written since the state change means it is waiting on purpose.
  if (markers.some((m) => (m?.kind === 'need' || m?.kind === 'blocked') && isNum(m.ts) && m.ts >= session.stateSince)) return null;
  return { reason: `idle ${mins(age)}, lane unfinished`, detail: `${session.state} for ${mins(age)} in a launched lane with no LANE-DONE` };
}

const RULE_FNS = {
  'approval-wait': approvalWait,
  'error-loop': errorLoop,
  'tool-loop': toolLoop,
  oscillation,
  stalled,
  'context-pressure': contextPressure,
  'cost-no-progress': costNoProgress,
  'idle-in-working': idleInWorking,
};

/**
 * Evaluate every rule for one session. Pure.
 *   session   the state.mjs session (state, stateSince, activity, context,
 *             statuslineCostUsd, head, dirty, ahead, linesAdded, linesRemoved)
 *   lane      null, or {record, markers: [{kind, text, ts}], done?}: record is
 *             the lane.json record (a launched lane), markers the lane's markers
 *   events    signals.recent(sessionId), oldest first: {t, ev, tool, inHash, errHash}
 *   counters  signals.counters(sessionId)
 *   costNow   cumulative USD now (defaults to session.statuslineCostUsd)
 *   costThen  cumulative USD at now - costWindowMin (signals.costAt)
 *   progress  {fingerprint, since}: since = when the fingerprint last changed
 *   now, cfg  ms epoch; the config (or its stuck fragment)
 * Returns null or a Stuck with since = now (the tracker keeps it stable).
 */
export function evaluate({ session, lane = null, events = [], counters = {}, costNow, costThen = null, progress = null, now = Date.now(), cfg } = {}) {
  const c = resolveCfg(cfg);
  if (!c.enabled || !session || session.state === 'dead') return null;
  const evs = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : [];
  const input = {
    session,
    lane,
    events: evs,
    turnPre: currentTurn(evs).filter((e) => e.ev === 'PreToolUse'),
    counters: counters ?? {},
    costNow: costNow === undefined ? session.statuslineCostUsd : costNow,
    costThen,
    progress,
    now,
    c,
  };
  const evidence = [];
  const reasons = {};
  for (const rule of RULES) {
    const hit = RULE_FNS[rule](input);
    if (!hit) continue;
    reasons[rule] = clip(hit.reason, REASON_MAX);
    evidence.push({ rule, detail: clip(hit.detail ?? hit.reason, DETAIL_MAX) });
  }
  if (!evidence.length) return null;
  const rule = evidence[0].rule;
  return { rule, reason: reasons[rule], since: now, evidence, rules: evidence.map((e) => e.rule) };
}

const sameStuck = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.rule === b.rule && a.reason === b.reason && a.since === b.since && a.rules.join() === b.rules.join();
};

/**
 * Stateful wrapper around evaluate, one per builder.
 *   createTracker(cfg, {onAutoPause}) -> {update, changes, current, forget}
 * update(sessionsCtx, now): sessionsCtx is an iterable of
 *   {session, lane, events, counters, costNow?, costThen?, costAt?(t)}
 *   (costAt is called with now - costWindowMin when costThen is not given).
 *   Returns Map(name -> Stuck|null) for every session in sessionsCtx; sessions
 *   no longer present are forgotten.
 * changes(): [{name, stuck}] accumulated since the last call (then cleared):
 *   a session became stuck, stopped being stuck, or its rule/reason/since/rules changed.
 * onAutoPause(name, stuck) is called only when cfg autoPause is true, the
 *   winning rule is in autoPauseRules, and the session has just become stuck
 *   on that rule (once per episode). Default: no-op. Its errors are swallowed.
 */
export function createTracker(cfg, { onAutoPause = () => {} } = {}) {
  const c = resolveCfg(cfg);
  /** name -> {since: {rule -> t}, fp, fpSince, last: Stuck|null} */
  const per = new Map();
  let pending = [];

  function update(sessionsCtx, now = Date.now()) {
    const out = new Map();
    const seen = new Set();
    for (const ctx of sessionsCtx ?? []) {
      const session = ctx?.session;
      const name = session?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      let st = per.get(name);
      if (!st) {
        st = { since: new Map(), fp: null, fpSince: now, last: null };
        per.set(name, st);
      }
      const fp = progressFingerprint(session);
      if (fp !== st.fp) {
        st.fp = fp;
        st.fpSince = now;
      }
      let costThen = ctx.costThen;
      if (costThen === undefined && typeof ctx.costAt === 'function') {
        try { costThen = ctx.costAt(now - c.costWindowMin * MIN); } catch { costThen = null; }
      }
      const raw = evaluate({
        session,
        lane: ctx.lane ?? null,
        events: ctx.events ?? [],
        counters: ctx.counters ?? {},
        costNow: ctx.costNow,
        costThen: costThen ?? null,
        progress: { fingerprint: st.fp, since: st.fpSince },
        now,
        cfg: c,
      });
      const matched = new Set(raw ? raw.rules : []);
      for (const r of [...st.since.keys()]) if (!matched.has(r)) st.since.delete(r);
      for (const r of matched) if (!st.since.has(r)) st.since.set(r, now);
      const stuck = raw ? { ...raw, since: st.since.get(raw.rule) } : null;
      const prev = st.last;
      if (!sameStuck(prev, stuck)) pending.push({ name, stuck });
      if (stuck && c.autoPause && c.autoPauseRules.includes(stuck.rule) && prev?.rule !== stuck.rule) {
        try { onAutoPause(name, stuck); } catch { /* a pause failure never breaks the tick */ }
      }
      st.last = stuck;
      out.set(name, stuck);
    }
    for (const name of [...per.keys()]) if (!seen.has(name)) per.delete(name);
    return out;
  }

  function changes() {
    const c2 = pending;
    pending = [];
    return c2;
  }

  /** name -> Stuck for the sessions currently stuck. */
  function current() {
    const m = new Map();
    for (const [name, st] of per) if (st.last) m.set(name, st.last);
    return m;
  }

  function forget(name) { per.delete(name); }

  return { update, changes, current, forget };
}
