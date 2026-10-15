// Flag module: `stuck` on sessions and the `stuck` stream message (fleet plan
// §7.3.2, O5).
//
// On every tick it samples each session's statusline cost into the signal ring
// (server/collector/signals.mjs), then feeds the stuck tracker
// (server/fleet/stuck.mjs) with the session, its lane, the event ring, the
// counters and the cost history. A session decorator then sets
//   stuck: {rule, reason, since} | null
// on every session; `evidence` and `rules` stay off the session so wire deltas
// stay small. Every change (raised, cleared, rule/reason changed) goes out as
//   {type: 'stuck', name, key, stuck: {rule, reason, since, evidence, rules} | null}
// through ws.send; the v1 stream tap adds {builder, seq, epoch}.
//
// X1's attentionScore adds +40 for a decorated `stuck` (never above a waiting
// session), so this module does not touch state.mjs.
//
// Stuck detection only ever badges. It never sends keys and never kills. The
// one exception is opt-in: with `stuck.autoPause: true` the tracker calls the
// injected onAutoPause for the rules in `stuck.autoPauseRules`, which writes an
// `operator` pause sentinel (server/control/pause.mjs). With the default config
// nothing is paused.
//
// Reasons and evidence details can carry builder-provided text (tool names);
// the tracker length-caps them and renderers must use textContent.
import { createTracker, resolveCfg } from '../fleet/stuck.mjs';
import * as signals from '../collector/signals.mjs';
import * as pause from '../control/pause.mjs';
import * as laneStore from '../lanes/store.mjs';
import { log } from '../log.mjs';

/** How long a lane record / marker list is reused across ticks. */
export const LANE_CACHE_MS = 10_000;
/** Newest markers read per lane. */
export const MARKER_LIMIT = 50;
/** `by` on an automatic pause sentinel. */
export const AUTO_PAUSE_BY = 'stuck-detector';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sidOf = (s) => {
  const sid = s?.claude?.sessionId ?? s?.sessionId ?? null;
  return typeof sid === 'string' && sid ? sid : null;
};

/**
 * Lane input for the tracker: null, or {record, markers: [{kind, text, ts}]}.
 * `record` is the lane.json of a launched lane that is not retired; markers
 * are the lane's newest markers. A `done` marker counts even when dismissed
 * (LANE-DONE still happened); need/blocked count only while undismissed.
 * Reads are cached for LANE_CACHE_MS per lane id.
 */
export function createLaneSource({ readRecord, listMarkers, cacheMs = LANE_CACHE_MS } = {}) {
  const cache = new Map(); // laneId -> {at, value}
  return function laneFor(session, now = Date.now()) {
    const id = session?.lane;
    if (!id || typeof id !== 'string') return null;
    const hit = cache.get(id);
    if (hit && now - hit.at >= 0 && now - hit.at < cacheMs) return hit.value;
    let value = null;
    try {
      const record = readRecord ? readRecord(id) : null;
      if (record && typeof record === 'object' && !record.retiredAt) {
        let rows = [];
        try { rows = listMarkers ? listMarkers(id) ?? [] : []; } catch { rows = []; }
        const markers = [];
        for (const m of rows) {
          if (!m || typeof m !== 'object') continue;
          if (m.kind !== 'done' && m.dismissed_at != null) continue;
          markers.push({ kind: m.kind, text: m.text ?? null, ts: m.ts ?? null });
        }
        value = { record, markers };
      }
    } catch {
      value = null;
    }
    cache.set(id, { at: now, value });
    // Drop entries for lanes nobody asked about for a while.
    if (cache.size > 256) for (const [k, v] of cache) if (now - v.at >= cacheMs) cache.delete(k);
    return value;
  };
}

/**
 * The flag's core, with every dependency injectable (tests use this).
 *   cfg          the whole config or its `stuck` fragment
 *   signals      {sampleCost, recent, counters, costAt}
 *   laneFor      (session, now) -> lane input (createLaneSource)
 *   send         (msg) -> void; the stream / ws broadcast
 *   keyFor       (name) -> fkey
 *   pauseSession (name, stuck) -> void; only reached when cfg autoPause is on
 */
export function createStuckFlag({ cfg, signals: sig = signals, laneFor = () => null, send = () => {}, keyFor = (n) => n, pauseSession = () => {} } = {}) {
  const c = resolveCfg(cfg);
  const tracker = createTracker(c, {
    onAutoPause(name, stuck) {
      if (!c.autoPause || !c.autoPauseRules.includes(stuck?.rule)) return;
      pauseSession(name, stuck);
    },
  });
  /** name -> Stuck (full, evidence included), the sessions currently stuck. */
  let current = new Map();

  function emit(name, stuck) {
    try {
      send({ type: 'stuck', name, key: keyFor(name), stuck: stuck ?? null });
    } catch (err) {
      log.error('stuck: send failed', String(err?.message || err));
    }
  }

  function tick(ctx, now = Date.now()) {
    const list = Array.isArray(ctx?.sessions) ? ctx.sessions : [...(ctx?.sessions ?? [])];
    const input = [];
    for (const s of list) {
      if (!s || typeof s !== 'object' || !s.name) continue;
      const sid = sidOf(s);
      if (sid && isNum(s.statuslineCostUsd)) {
        try { sig.sampleCost(sid, s.statuslineCostUsd, now); } catch { /* a bad sample never breaks the tick */ }
      }
      let lane = null;
      try { lane = laneFor(s, now) ?? null; } catch { lane = null; }
      input.push({
        session: s,
        lane,
        events: sid ? sig.recent(sid) : [],
        counters: sid ? sig.counters(sid) : {},
        costNow: isNum(s.statuslineCostUsd) ? s.statuslineCostUsd : null,
        costAt: sid ? (t) => sig.costAt(sid, t) : () => null,
      });
    }
    const prev = current;
    const result = tracker.update(input, now);
    const next = new Map();
    for (const [name, stuck] of result) if (stuck) next.set(name, stuck);
    current = next;
    for (const { name, stuck } of tracker.changes()) emit(name, stuck);
    // A session that went away while stuck: the tracker forgets it silently,
    // so tell the stream it is no longer stuck.
    for (const name of prev.keys()) if (!result.has(name)) emit(name, null);
  }

  /** Session decorator: owns `stuck` on every call. */
  function decorate(s) {
    const st = s?.name ? current.get(s.name) : null;
    return { stuck: st ? { rule: st.rule, reason: st.reason, since: st.since } : null };
  }

  return { tick, decorate, current: () => new Map(current), tracker, cfg: c };
}

/** The default pause action: an `operator` sentinel for the session. */
export function pauseWith(stateDir) {
  return (name, stuck) => {
    if (!pause.isValidScope(name)) return;
    try {
      pause.pause(name, { kind: 'operator', by: AUTO_PAUSE_BY, reason: `stuck: ${stuck?.reason ?? stuck?.rule ?? ''}` }, { stateDir });
      log.warn(`stuck: auto-paused ${name} (${stuck?.rule})`);
    } catch (err) {
      log.error(`stuck: auto-pause of ${name} failed`, String(err?.message || err));
    }
  };
}

let flag = null;

export default {
  name: 'flag-stuck',
  modes: ['builder'],
  register(ctx) {
    const config = ctx.config ?? {};
    const stateDir = config.stateDir ?? pause.defaultStateDir();
    const listMarkers = typeof ctx.db?.listMarkers === 'function'
      ? (lane) => ctx.db.listMarkers({ lane, limit: MARKER_LIMIT, includeDismissed: true })
      : null;
    flag = createStuckFlag({
      cfg: config,
      laneFor: createLaneSource({ readRecord: laneStore.read, listMarkers }),
      send: (msg) => ctx.ws?.send?.(msg),
      keyFor: (name) => (typeof ctx.state?.keyFor === 'function' ? ctx.state.keyFor(name) : name),
      pauseSession: pauseWith(stateDir),
    });
    ctx.state.addDecorator('stuck', { session: (s) => flag.decorate(s) });
    ctx.state.onTick((tctx, now) => flag.tick(tctx, now));
  },
  stop() {
    flag = null;
  },
};
