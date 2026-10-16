// Review-wait metric on the hub (fleet plan §7 7.3.7, task O10).
//
// A lane's review wait runs from the moment it became ready for review
// (§10 R5's lane flag `reviewReady {ready, reasons, since}`, `since` = ready
// time, `readySource` = the first reason) to the first human touch, which is
// the earliest of:
//   1. `touch` from the hub UI (inspector, peek or terminal opened on the lane
//      or on one of its sessions), recorded only for a `direct` connection
//      (Tailscale-User-Login present): the caller passes `user` only then;
//   2. a GitHub review by a person: `pr.firstReviewAt` (§6 P5) on the lane's
//      PR, read from the builder's `box.prs[laneId]` (or `lane.pr`);
//   3. `send-review` (§10): the lane's `reviewSentAt`.
// GitHub and send-review times only count when they are at or after the
// ready time (an older one belongs to an earlier episode).
//
// Storage is one kv value, `review.waits`:
//   {open: {[fkey]: {builder, lane, prNumber, readyAt, readySource}},
//    closed: [last 500 {fkey, readyAt, touchedAt, touchSource}]}
// An open wait closes exactly once, on the first touch. A lane that stops
// being ready without any touch (merged, closed, gone) drops its open wait;
// it is not a measured wait. A ready episode whose ready time is not after the
// lane's last recorded touch is the episode already measured, so a lane that
// stays ready after a peek does not open a second wait.
//
// Everything a builder sends is untrusted: fkeys are rebuilt from the store's
// builder id and the (store-validated) lane id, numbers are type-checked and
// clamped to the hub clock, reasons come from a fixed list.
//
// The persistence backend is injected as `db` ({kvRead(key, fallback),
// kvWrite(key, value)}: server/db.mjs's kv on the hub, or createJsonKv below).
// This file imports no builder-only module.
import fs from 'node:fs';
import path from 'node:path';
import { fkey as makeFkey, parseFkey, BUILDER_ID_RX } from '../fleet/keys.mjs';

export const KV_KEY = 'review.waits';
export const CLOSED_MAX = 500;
/** Open waits kept at most (200 lanes per builder is the store cap). */
export const OPEN_MAX = 5000;
export const HOWS = Object.freeze(['inspect', 'peek', 'term']);
export const TOUCH_SOURCES = Object.freeze([...HOWS, 'github', 'send-review']);
export const READY_SOURCES = Object.freeze(['done-marker', 'pr-green', 'stop-diff']);
export const WINDOW_MS = 7 * 24 * 3600_000;
export const DEFAULT_OVERDUE_HOURS = 4;
const FKEY_MAX = 200;

const HOW_SET = new Set(HOWS);
const SOURCE_SET = new Set(TOUCH_SOURCES);
const READY_SET = new Set(READY_SOURCES);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function safeFkey(builder, name) {
  try { return makeFkey(builder, name); } catch { return null; }
}

function cleanOpen(k, w) {
  if (typeof k !== 'string' || k.length > FKEY_MAX || !parseFkey(k) || !isObj(w)) return null;
  if (!isNum(w.readyAt)) return null;
  const p = parseFkey(k);
  return {
    builder: p.builder,
    lane: p.name,
    prNumber: Number.isInteger(w.prNumber) && w.prNumber > 0 ? w.prNumber : null,
    readyAt: w.readyAt,
    readySource: READY_SET.has(w.readySource) ? w.readySource : null,
  };
}

function cleanClosed(c) {
  if (!isObj(c) || typeof c.fkey !== 'string' || c.fkey.length > FKEY_MAX || !parseFkey(c.fkey)) return null;
  if (!isNum(c.readyAt) || !isNum(c.touchedAt)) return null;
  return {
    fkey: c.fkey,
    readyAt: c.readyAt,
    touchedAt: c.touchedAt,
    touchSource: SOURCE_SET.has(c.touchSource) ? c.touchSource : null,
  };
}

/** A stored value -> a fresh, valid state (bad entries dropped). */
export function cleanState(raw) {
  const open = Object.create(null);
  const closed = [];
  if (isObj(raw)) {
    if (isObj(raw.open)) {
      for (const k of Object.keys(raw.open).slice(0, OPEN_MAX)) {
        const w = cleanOpen(k, raw.open[k]);
        if (w) open[k] = w;
      }
    }
    if (Array.isArray(raw.closed)) {
      for (const c of raw.closed.slice(-CLOSED_MAX)) {
        const x = cleanClosed(c);
        if (x) closed.push(x);
      }
    }
  }
  return { open, closed };
}

/** Percentiles over a sorted list: median (mean of the two middles), p90 nearest-rank. */
export function summarize(durations) {
  const xs = durations.filter(isNum).map((d) => Math.max(0, d)).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { n: 0, medianMs: null, p90Ms: null };
  const mid = n >> 1;
  const medianMs = n % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
  const p90Ms = xs[Math.max(0, Math.ceil(0.9 * n) - 1)];
  return { n, medianMs, p90Ms };
}

function overdueMsOf(cfg) {
  const h = cfg?.review?.overdueHours ?? cfg?.overdueHours;
  return (isNum(h) && h > 0 ? h : DEFAULT_OVERDUE_HOURS) * 3600_000;
}

/**
 * createReviewWaits({db, now, cfg}) -> {onLanes, touch, stats, open, closed,
 *   overdue, overdueMs, laneOf}
 *
 * `cfg` is the hub config (reads `review.overdueHours`) or `{overdueHours}`.
 * The stored value is read lazily, on the first call, so a module can create
 * this in register() and the backend be ready by the time it is used.
 */
export function createReviewWaits({ db = null, now = Date.now, cfg = {} } = {}) {
  let state = null;
  /** session fkey -> lane fkey, from the lanes' `sessions` lists (memory only). */
  const sessionLane = new Map();
  /** builderId -> Set of its session fkeys in sessionLane. */
  const sessionsByBuilder = new Map();
  const overdueMs = overdueMsOf(cfg);
  let writeErrors = 0;

  function load() {
    if (state) return state;
    let raw = null;
    try { raw = db && typeof db.kvRead === 'function' ? db.kvRead(KV_KEY, null) : null; } catch { raw = null; }
    state = cleanState(raw);
    return state;
  }

  function save() {
    if (!db || typeof db.kvWrite !== 'function') return;
    try {
      db.kvWrite(KV_KEY, { open: { ...state.open }, closed: state.closed });
    } catch {
      writeErrors++;
    }
  }

  const clock = () => {
    const t = now();
    return isNum(t) ? t : Date.now();
  };

  /** true when `fkey` already has a touch at or after `readyAt` (that episode was measured). */
  function measured(k, readyAt) {
    for (let i = state.closed.length - 1; i >= 0; i--) {
      const c = state.closed[i];
      if (c.fkey === k && c.touchedAt >= readyAt) return true;
    }
    return false;
  }

  function close(k, touchedAt, touchSource) {
    const w = state.open[k];
    if (!w) return false;
    delete state.open[k];
    state.closed.push({ fkey: k, readyAt: w.readyAt, touchedAt: Math.max(w.readyAt, touchedAt), touchSource });
    if (state.closed.length > CLOSED_MAX) state.closed.splice(0, state.closed.length - CLOSED_MAX);
    return true;
  }

  function prOfLane(lane, prs) {
    const raw = isObj(prs) && hasOwn(prs, lane.id) ? prs[lane.id] : lane.pr;
    if (!isObj(raw) || raw.none || raw.error) return null;
    return raw;
  }

  /**
   * One builder's full lane list (as the fleet store holds it). `extra.prs`
   * is the builder's `box.prs` map (laneId -> PR summary). Idempotent: the
   * same input twice changes nothing. Returns true when the store changed.
   */
  function onLanes(builderId, lanes, extra = {}) {
    if (typeof builderId !== 'string' || !BUILDER_ID_RX.test(builderId) || !Array.isArray(lanes)) return false;
    load();
    const t = clock();
    const prs = isObj(extra?.prs) ? extra.prs : null;
    let changed = false;

    // Session index for this builder, rebuilt from the list.
    const old = sessionsByBuilder.get(builderId);
    if (old) for (const sk of old) sessionLane.delete(sk);
    const mine = new Set();
    sessionsByBuilder.set(builderId, mine);

    const seen = new Set();
    for (const lane of lanes) {
      if (!isObj(lane) || typeof lane.id !== 'string') continue;
      const k = safeFkey(builderId, lane.id);
      if (!k || k.length > FKEY_MAX) continue;
      seen.add(k);
      if (Array.isArray(lane.sessions)) {
        for (const s of lane.sessions.slice(0, 50)) {
          const name = typeof s === 'string' ? s : s?.name;
          const sk = typeof name === 'string' && name ? safeFkey(builderId, name) : null;
          if (sk && sk.length <= FKEY_MAX) { sessionLane.set(sk, k); mine.add(sk); }
        }
      }

      const rr = lane.reviewReady;
      const ready = isObj(rr) && rr.ready === true && isNum(rr.since);
      const pr = prOfLane(lane, prs);
      if (ready && !state.open[k]) {
        const readyAt = Math.min(rr.since, t);
        if (!measured(k, readyAt) && Object.keys(state.open).length < OPEN_MAX) {
          const first = Array.isArray(rr.reasons) ? rr.reasons[0] : null;
          state.open[k] = {
            builder: builderId,
            lane: lane.id,
            prNumber: Number.isInteger(pr?.number) && pr.number > 0 ? pr.number : null,
            readyAt,
            readySource: READY_SET.has(first) ? first : null,
          };
          changed = true;
        }
      }

      const w = state.open[k];
      if (!w) continue;
      // Touches the builder reports: send-review, then a person's GitHub review.
      const sent = isNum(lane.reviewSentAt) && lane.reviewSentAt >= w.readyAt ? Math.min(lane.reviewSentAt, t) : null;
      const gh = isNum(pr?.firstReviewAt) && pr.firstReviewAt >= w.readyAt ? Math.min(pr.firstReviewAt, t) : null;
      if (sent !== null || gh !== null) {
        const useSent = sent !== null && (gh === null || sent <= gh);
        changed = close(k, useSent ? sent : gh, useSent ? 'send-review' : 'github') || changed;
      } else if (!ready) {
        delete state.open[k]; // no longer ready, never touched: not a measured wait
        changed = true;
      }
    }
    // Lanes that left this builder's list.
    for (const k of Object.keys(state.open)) {
      if (state.open[k].builder === builderId && !seen.has(k)) {
        delete state.open[k];
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }

  /** The lane fkey a touch on `k` (a lane key or one of its sessions' keys) belongs to. */
  function laneOf(k) {
    if (typeof k !== 'string' || k.length > FKEY_MAX || !parseFkey(k)) return null;
    load();
    if (state.open[k]) return k;
    return sessionLane.get(k) ?? null;
  }

  /**
   * A UI touch. Ignored (false) without a user, with an unknown `how`, or
   * when the key has no open wait. Returns true when it closed a wait.
   */
  function touch(k, how, user) {
    if (typeof user !== 'string' || user === '') return false;
    if (!HOW_SET.has(how)) return false;
    const lk = laneOf(k);
    if (!lk || !state.open[lk]) return false;
    const ok = close(lk, clock(), how);
    if (ok) save();
    return ok;
  }

  function windowStart(since, t) {
    const lo = t - WINDOW_MS;
    return isNum(since) ? Math.max(since, lo) : lo;
  }

  /** Closed waits touched at or after `since` (default and floor: the last 7 d). */
  function closed({ since } = {}) {
    load();
    const from = windowStart(since, clock());
    return state.closed.filter((c) => c.touchedAt >= from).map((c) => ({ ...c }));
  }

  function stats({ since } = {}) {
    return summarize(closed({ since }).map((c) => c.touchedAt - c.readyAt));
  }

  /** Open waits, longest first: [{fkey, waitingMs, readyAt}]. */
  function open() {
    load();
    const t = clock();
    return Object.entries(state.open)
      .map(([k, w]) => ({ fkey: k, waitingMs: Math.max(0, t - w.readyAt), readyAt: w.readyAt }))
      .sort((a, b) => b.waitingMs - a.waitingMs || (a.fkey < b.fkey ? -1 : a.fkey > b.fkey ? 1 : 0));
  }

  /** Open waits past `review.overdueHours`: the `review-overdue` alarm input (§7 O8). */
  function overdue() {
    load();
    return open().filter((w) => w.waitingMs > overdueMs).map((w) => {
      const o = state.open[w.fkey];
      return { ...w, builder: o.builder, lane: o.lane, prNumber: o.prNumber, readySource: o.readySource };
    });
  }

  return {
    onLanes,
    touch,
    stats,
    open,
    closed,
    overdue,
    overdueMs,
    laneOf,
    counters: () => ({ writeErrors }),
  };
}

/**
 * A tiny JSON-file kv for the hub when no database kv is provided: one file
 * per key under `dir` (0700 dir, 0600 files, written atomically).
 */
export function createJsonKv(dir) {
  const file = (key) => path.join(dir, `${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  return {
    kvRead(key, fallback = null) {
      try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return fallback; }
    },
    kvWrite(key, value) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const f = file(key);
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(tmp, f);
    },
  };
}

/**
 * The review-wait service over a fleet store: feeds every builder's lanes
 * (and `box.prs`) to `waits.onLanes` on start and on each snapshot / lane or
 * box delta, and registers the `touch` client message (direct users only).
 * Returns stop().
 */
export function startReviewWaitService({ waits, store, onClientMessage }) {
  const feed = (id) => {
    const snap = store?.builder?.(id)?.snap;
    if (snap && Array.isArray(snap.lanes)) waits.onLanes(id, snap.lanes, { prs: snap.box?.prs });
  };
  if (store && typeof store.list === 'function') for (const e of store.list()) feed(e.id);
  const unsub = store && typeof store.subscribe === 'function'
    ? store.subscribe((ev) => {
      if (!ev || typeof ev.builder !== 'string') return;
      if (ev.kind === 'snapshot' || (ev.kind === 'delta' && (ev.lanes || ev.box))) feed(ev.builder);
    })
    : null;
  const off = typeof onClientMessage === 'function'
    ? onClientMessage('touch', (msg, { user, kind } = {}) => {
      if (kind !== 'direct') return; // only a Tailscale-identified browser counts
      waits.touch(msg?.fkey, msg?.how, user);
    })
    : null;
  return () => {
    if (typeof unsub === 'function') unsub();
    if (typeof off === 'function') off();
  };
}
