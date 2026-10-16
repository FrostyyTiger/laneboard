// Alarm persistence (fleet plan §7.3.5, O8). REVIEW-REQUIRED (SR20).
//
// The live map is kept in the kv row `alarms.live` (reloaded on restart, so an
// ack survives a restart); history goes to `db.addEvent({type:'alarm',
// subtype:'raised'|'cleared'|'acked', payload})`, kept by the existing event
// retention. No new table. A backend without addEvent (the hub's JSON kv
// fallback) keeps the history in the kv row `alarms.history` instead, bounded
// to HISTORY_MAX entries and `alarms.historyDays`.
//
//   createAlarmStore({db, now, historyDays, log})
//     -> {load, live, get, apply(derived, opts), ack(id, user), ackMany(scope, user, kindToTile),
//         history(), counters()}
//
// `db` is injected ({kvRead, kvWrite, addEvent?}): server/db.mjs on a
// builder, the hub's kv on the hub. This file imports no database itself, so
// it is safe on the hub. Writes are best effort: a failing kv write is
// counted and logged, never thrown into the evaluation loop.
import { reconcile, ack as ackOne, ackMany as ackScope, compareAlarms, KINDS, PRIORITIES, ALARM_ID_RE, cleanText, TEXT_MAX, TARGET_MAX, AlarmError } from './alarms.mjs';
import { BUILDER_ID_RX } from './keys.mjs';

export const KV_LIVE = 'alarms.live';
export const KV_HISTORY = 'alarms.history';
export const HISTORY_MAX = 500;
const DAY_MS = 86_400_000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => (isNum(v) ? v : null);

/** A stored alarm re-validated on load (the kv row is ours, but a bad row must not break boot). */
export function reviveAlarm(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !ALARM_ID_RE.test(raw.id)) return null;
  if (typeof raw.kind !== 'string' || !Object.hasOwn(KINDS, raw.kind)) return null;
  if (!PRIORITIES.includes(raw.priority)) return null;
  const builder = typeof raw.builder === 'string' && BUILDER_ID_RX.test(raw.builder) ? raw.builder : null;
  return {
    id: raw.id,
    kind: raw.kind,
    priority: raw.priority,
    builder,
    target: typeof raw.target === 'string' ? cleanText(raw.target, TARGET_MAX) : null,
    text: cleanText(raw.text, TEXT_MAX),
    since: numOrNull(raw.since),
    acked: raw.acked === true,
    ackedBy: raw.acked === true && typeof raw.ackedBy === 'string' ? cleanText(raw.ackedBy, 128) : null,
    ackedAt: raw.acked === true ? numOrNull(raw.ackedAt) : null,
    cleared: null,
  };
}

function eventPayload(a) {
  const p = { id: a.id, kind: a.kind, priority: a.priority, builder: a.builder, target: a.target, text: a.text, since: a.since };
  if (a.cleared) p.cleared = a.cleared;
  if (a.acked) { p.ackedBy = a.ackedBy; p.ackedAt = a.ackedAt; }
  return p;
}

export function createAlarmStore({ db, now = Date.now, historyDays = 30, log = null } = {}) {
  if (!db || typeof db.kvRead !== 'function' || typeof db.kvWrite !== 'function') {
    throw new TypeError('alarm store: db with kvRead/kvWrite is required');
  }
  const clock = typeof now === 'function' ? now : Date.now;
  const keepMs = (isNum(historyDays) && historyDays > 0 ? historyDays : 30) * DAY_MS;
  let map = null;
  let writeErrors = 0;

  function warn(what, err) {
    writeErrors++;
    try { log?.error?.(`alarms: ${what} failed`, String(err?.message || err)); } catch { /* never */ }
  }

  function load() {
    if (map) return map;
    map = new Map();
    let rows = [];
    try { rows = db.kvRead(KV_LIVE, []); } catch (err) { warn('kv read', err); rows = []; }
    for (const raw of Array.isArray(rows) ? rows : []) {
      const a = reviveAlarm(raw);
      if (a && !map.has(a.id)) map.set(a.id, a);
    }
    return map;
  }

  function persist() {
    try { db.kvWrite(KV_LIVE, [...map.values()]); } catch (err) { warn('kv write', err); }
  }

  function record(subtype, alarms, t) {
    if (!alarms.length) return;
    if (typeof db.addEvent === 'function') {
      for (const a of alarms) {
        try { db.addEvent({ ts: t, type: 'alarm', subtype, payload: eventPayload(a) }); } catch (err) { warn('addEvent', err); }
      }
      return;
    }
    let hist = [];
    try { hist = db.kvRead(KV_HISTORY, []); } catch { hist = []; }
    if (!Array.isArray(hist)) hist = [];
    for (const a of alarms) hist.push({ ts: t, subtype, payload: eventPayload(a) });
    hist = hist.filter((h) => h && isNum(h.ts) && h.ts >= t - keepMs).slice(-HISTORY_MAX);
    try { db.kvWrite(KV_HISTORY, hist); } catch (err) { warn('kv history write', err); }
  }

  /** Live alarms, sorted (priority, oldest first). Copies. */
  function live() {
    return [...load().values()].sort(compareAlarms).map((a) => ({ ...a }));
  }

  /**
   * Reconcile with a fresh derivation; persists and records history when
   * something changed. -> {raised, cleared, changed}
   * `changed` is also true when only text/priority of a live alarm moved.
   */
  function apply(derived, opts = {}) {
    const t = clock();
    const prev = load();
    const { next, raised, cleared } = reconcile(prev, derived, t, opts);
    let changed = raised.length > 0 || cleared.length > 0;
    if (!changed) {
      for (const [id, a] of next) {
        const p = prev.get(id);
        if (!p || p.text !== a.text || p.priority !== a.priority || p.target !== a.target) { changed = true; break; }
      }
    }
    map = next;
    if (changed) {
      persist();
      record('raised', raised, t);
      record('cleared', cleared, t);
    }
    return { raised, cleared, changed };
  }

  /** Ack one alarm. -> Alarm (the acked copy) or AlarmError. */
  function ack(id, user) {
    const t = clock();
    const m = load();
    const before = typeof id === 'string' ? m.get(id) : undefined;
    const r = ackOne(m, id, user, t);
    if (r instanceof AlarmError) return r;
    if (before && !before.acked) {
      persist();
      record('acked', [r], t);
    }
    return { ...r };
  }

  /** Ack every unacked alarm in scope {tile?, builder?}. -> Alarm[] newly acked. */
  function ackMany(scope, user, kindToTile) {
    const t = clock();
    const out = ackScope(load(), scope ?? {}, user, t, kindToTile);
    if (out.length) {
      persist();
      record('acked', out, t);
    }
    return out.map((a) => ({ ...a }));
  }

  function history() {
    if (typeof db.addEvent === 'function') return null; // in the events table (db.listEvents({type:'alarm'}))
    try {
      const h = db.kvRead(KV_HISTORY, []);
      return Array.isArray(h) ? h : [];
    } catch {
      return [];
    }
  }

  return {
    load: () => { load(); return live(); },
    live,
    get: (id) => { const a = load().get(id); return a ? { ...a } : null; },
    apply,
    ack,
    ackMany,
    history,
    counters: () => ({ writeErrors }),
  };
}

/** A Map-backed kv for tests and for a hub without a database. */
export function createMemoryKv() {
  const m = new Map();
  return {
    kvRead: (k, f = null) => (m.has(k) ? structuredClone(m.get(k)) : f),
    kvWrite: (k, v) => { m.set(k, structuredClone(v)); },
  };
}
