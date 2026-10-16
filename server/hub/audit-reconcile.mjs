// Hub audit reconciliation and anchoring (fleet plan §3 2.15, H13). REVIEW-REQUIRED (SR14).
//
//   reconcile(hubEntries, builderEntries, {pulledAt?, relayTimeoutMs?, graceMs?}?) -> rows   (pure)
//   unknownOnHub(hubEntries, builderEntries, {floorTs?}?) -> [{id, builder, action, target, ts, hash}]   (pure)
//   checkSegment(anchor, response, builderId) -> {ok:true, tip, entries, head} | {ok:false, fork?, reason, text}   (pure)
//   createAuditReconciler({store, readProxy, audit, now?, timers?, log?, pullMs?, timeoutMs?, maxPages?, indexCap?})
//     -> {start(), stop(), tick(), pull(builderId), forks(), mismatches(), signals(), list(q), status(), anchors(),
//         rebase(id, {head?, user?}?) -> boolean, rebaseToHead(id, {user?}?) -> Promise<{ok, head?, error?}>}
//   handleRebase(reconciler, {builder, confirm, onto, auth}) -> Promise<{status, body}>   (for H11's route)
//
// Authority (README 3.5, SECURITY-FIXES S8): the hub log is authoritative for hub-relayed actions; a builder log
// is trusted only up to the hub's last `audit.anchor` of its head. The hub pulls `GET /api/v1/audit?after=<anchored
// hash>` through the signed read proxy (H12 `get`) every 60 s and once when a builder comes back `up`, verifies the
// returned segment with `verifyFile(lines, anchoredHash)` (so every entry must chain onto the anchor), and after a
// pull that advanced the verified tip appends `{action:'audit.anchor', builder, target:builder,
// result:{ok:true, head:{hash, count}}}` to its own chain (one anchor per pull that moved; an unchanged head writes
// nothing, so an idle fleet does not grow the hub log). Anchors are recovered from the hub chain at start.
//
// A builder whose response does not continue the anchored head raises `audit-fork` (P1, §7 O8 reads `forks()`):
// `afterFound:false`, an `afterIndex` other than `count-1`, entries that do not chain onto the anchor or do not
// verify, or a head that is shorter than / differs from the anchored one. A fork is sticky: the anchor is not
// moved, so every later pull (and a hub restart) raises it again until `rebase(builder)` is called by a human.
//
// Matching (SR5 I1: a builder action that ran has two entries, `{phase:'start'}` and `{phase:'done'}`; a refusal
// has one outcome entry; the hub relay writes `{phase:'sent'}` and `{phase:'done'}`): both sides are collapsed to one
// action per envelope `id` before comparing, so every action is counted once. Only builder entries with
// `via:'hub'` and the same `builder` id can match a hub entry. States: `match`, `missing-on-builder`,
// `outcome-differs`, `unknown-settled` (a hub `ok:'unknown'` settled by the builder's outcome), and `pending`
// (deviation, additive: the builder has not been pulled since the hub entry could have reached it, or it recorded a
// start without an outcome while the hub outcome is unknown; only produced when `pulledAt` is given).
// Builder `via:'hub'` entries whose id the hub never sent are `unknown-on-hub` mismatches.
//
// SR14 fixes:
// - M1: a pulled builder entry is indexed only when its `id` is an envelope the hub itself sent to that builder
//   (the hub chain is re-scanned after the pages arrive and before indexing; the relay writes `sent` before the
//   POST). So the per-builder index is bounded by the hub's own records (an id leaves it when the hub index evicts
//   it), never by builder volume, and builder `ts` no longer drives any eviction watermark. Every other `via:'hub'`
//   entry is `unknown-on-hub`: its `ts` is clamped to the hub's pull time + SKEW_MS, and it is aggregated per
//   builder as one row `{state:'unknown-on-hub', count, first:[...], last:[...]}` (UNKNOWN_SAMPLES each), placed
//   after the hub-side rows (`missing-on-builder`, `outcome-differs`, capped at MISMATCH_CAP), so junk cannot crowd
//   real mismatches out. `list()` and `mismatches()` are computed from the same rows.
// - M2: the builder-side facts matching needs are persisted in the hub chain: before each anchor that indexed
//   something, `{action:'audit.match', via:VIA, builder, result:{ok:true, matched:[[id, code, hash, differs]...]}}`
//   entries (code s=start, t/f/u = outcome ok true/false/unknown; chunked under the audit result cap). A restart
//   replays them from the hub chain, so an action matched before the restart is not reported missing after it.
// - L1: once anchored, an answer without a well-formed `head` is `bad-response`; `afterFound` / `afterIndex` are
//   checked when present, otherwise the segment must chain onto the anchor and end at the reported head.
// - L2: a builder start without an outcome for a hub-`unknown` action is `outcome-differs` once START_ONLY_MS past
//   settling (pending before).
// - L3: `lastOkAt` is stamped only by a pull that ended without an error.
// - L4: `rebase(id, {head})` can re-anchor onto a given verified head instead of genesis (`rebaseToHead` reads it
//   through the proxy); hub actions sent before such a rebase whose builder entry is not indexed stay `pending`
//   (not judged). `handleRebase` is the `direct`-only, typed-confirm entry point for H11's route.
//
// Builder data is untrusted text: only the fields needed are kept, strings are clamped and stripped of control
// characters, and nothing from a builder is put into a signal `text` (that is written here). Never writes to a
// builder. Hub module: imports only server/fleet/* and node built-ins (never a builder-only module).
import { canonicalJson } from '../fleet/canonical.mjs';
import { verifyFile, GENESIS, ANCHOR_ACTION, MAX_READ_LIMIT } from '../fleet/audit.mjs';
import { BUILDER_ID_RX } from '../fleet/keys.mjs';

export const PULL_MS = 60_000;
export const PULL_TIMEOUT_MS = 5_000;
export const MAX_PAGES = 10;
export const INDEX_CAP = 5_000;
export const MISMATCH_CAP = 200;
/** The relay's POST timeout (§3 2.10): an outcome-unknown entry can still land on the builder until then. */
export const RELAY_TIMEOUT_MS = 15_000;
export const GRACE_MS = 5_000;
/** Builder clocks may be off (Box warns at 30 s): unknown-on-hub is judged only this far past the hub floor. */
export const SKEW_MS = 5 * 60_000;
/** SR14 L2: a start-only builder entry for a hub-unknown outcome is judged this long after settling. */
export const START_ONLY_MS = 10 * 60_000;
/** SR14 M1: samples kept at each end of a builder's unknown-on-hub aggregate. */
export const UNKNOWN_SAMPLES = 3;
export const STATES = Object.freeze(['match', 'missing-on-builder', 'outcome-differs', 'unknown-settled', 'pending']);
export const FORK_REASONS = Object.freeze([
  'after-not-found', 'index-mismatch', 'not-chained', 'chain-invalid', 'head-mismatch', 'count-regressed',
]);

/** `via` of the entries this module writes into the hub chain (anchors and fork records). */
export const VIA = 'hub-reconcile';
/** Additive: a detected fork is recorded once in the hub chain so it survives a hub restart. */
export const FORK_ACTION = 'audit.fork';
/** Additive (SR14 M2): builder-side matches recorded in the hub chain before the anchor that covers them. */
export const MATCH_ACTION = 'audit.match';
const MATCH_RESULT_BUDGET = 3600; // bytes of canonical result per audit.match entry (audit caps results at 4096)

const HEX64 = /^[0-9a-f]{64}$/;
const FIELD_MAX = 128;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

function str(v, max = FIELD_MAX) {
  if (typeof v !== 'string') return null;
  const s = v.toWellFormed().replace(CONTROL, '\ufffd');
  return s.length > max ? s.slice(0, max) : s;
}

function okOf(v) {
  return v === true || v === false ? v : 'unknown';
}

function resultOf(e) {
  return isPlain(e?.result) ? e.result : {};
}

/** Hub relayed actions (`via:'hub'`, phase sent/done) collapsed per id. Insertion order = first seen. */
export function hubActions(hubEntries) {
  const out = new Map();
  for (const e of Array.isArray(hubEntries) ? hubEntries : []) addHub(out, e);
  return out;
}

function addHub(map, e) {
  if (!isPlain(e) || e.via !== 'hub' || typeof e.id !== 'string' || e.action === ANCHOR_ACTION) return false;
  const r = resultOf(e);
  if (r.phase !== 'sent' && r.phase !== 'done') return false;
  let a = map.get(e.id);
  if (!a) {
    a = {
      id: e.id, builder: str(e.builder), action: str(e.action), target: str(e.target), user: str(e.user),
      ts: Number.isSafeInteger(e.ts) ? e.ts : null, sentTs: null, doneTs: null, phase: 'sent', ok: 'unknown', status: null, error: null,
    };
    map.set(e.id, a);
  }
  if (r.phase === 'sent') {
    a.sentTs = e.ts;
  } else {
    a.phase = 'done';
    a.doneTs = e.ts;
    a.ok = okOf(r.ok);
    a.status = Number.isSafeInteger(r.status) ? r.status : null;
    a.error = str(r.error, 200);
  }
  return true;
}

/** Builder entries with `via:'hub'` collapsed per id (start + outcome = one action). Untrusted input. */
export function builderActions(builderEntries) {
  const out = new Map();
  for (const e of Array.isArray(builderEntries) ? builderEntries : []) addBuilder(out, e);
  return out;
}

function addBuilder(map, e) {
  if (!isPlain(e) || e.via !== 'hub' || typeof e.id !== 'string' || e.id === '' || e.id.length > 128) return false;
  if (typeof e.hash !== 'string' || !HEX64.test(e.hash)) return false;
  const r = resultOf(e);
  let a = map.get(e.id);
  if (!a) {
    a = {
      id: e.id, builder: str(e.builder), action: str(e.action), target: str(e.target),
      ts: Number.isSafeInteger(e.ts) ? e.ts : null, startHash: null, ok: null, hash: null, hashes: [],
    };
    map.set(e.id, a);
  }
  if (a.hashes.includes(e.hash)) return false; // the same entry pulled twice
  if (a.hashes.length >= 4) return false; // an id is two entries at most; ignore floods on one id
  a.hashes.push(e.hash);
  if (r.phase === 'start') {
    if (a.startHash === null) a.startHash = e.hash;
    return true;
  }
  const ok = okOf(r.ok);
  if (a.hash === null) {
    a.ok = ok;
    a.hash = e.hash;
  } else if (a.ok !== ok) {
    a.ok = 'conflict'; // two outcomes for one envelope that disagree
  }
  return true;
}

function stateOf(h, b, { pulled, relayTimeoutMs, graceMs, startOnlyMs = START_ONLY_MS }) {
  // `pulled`: undefined = no pending logic (pure contract); null = never pulled; else the hub ms the pull started.
  const settledAt = (h.doneTs ?? ((h.sentTs ?? h.ts ?? 0) + relayTimeoutMs)) + graceMs;
  const notYet = pulled !== undefined && (pulled === null || pulled < settledAt);
  const hubUnknown = h.phase !== 'done' || h.ok === 'unknown';
  const same = b && b.builder === h.builder && b.action === h.action && b.target === h.target;
  if (!b || b.hash === null) {
    if (b && b.startHash !== null) {
      // ran on the builder, no outcome recorded (yet)
      if (hubUnknown) {
        // SR14 L2: not forever; once well past settling the missing outcome is itself a difference
        return Number.isFinite(pulled) && pulled >= settledAt + startOnlyMs ? 'outcome-differs' : 'pending';
      }
      return notYet ? 'pending' : 'outcome-differs';
    }
    // not on the builder: consistent when the hub knows it never reached the builder (no HTTP status)
    if (h.phase === 'done' && h.ok === false && h.status === null) return 'match';
    return notYet ? 'pending' : 'missing-on-builder';
  }
  if (!same) return 'outcome-differs';
  if (b.ok === 'conflict' || b.ok === 'unknown') return 'outcome-differs';
  if (hubUnknown) return 'unknown-settled';
  return h.ok === b.ok ? 'match' : 'outcome-differs';
}

/**
 * reconcile(hubEntries, builderEntries, opts) -> [{id, builder, action, target, hub:{phase, ok}, builderEntry:{ok, hash}|null, state}]
 * Pure. (2.15 names the builder side `builder` too, which collides with the builder id: it is `builderEntry` here.) One row per hub-relayed envelope id (hub order). `builderEntries` may hold several builders' entries.
 * opts.pulledAt: {[builderId]: ms the last complete pull started}; when given, rows the builder could not have
 * recorded yet are `pending`.
 */
export function reconcile(hubEntries, builderEntries, opts = {}) {
  const hub = hubEntries instanceof Map ? hubEntries : hubActions(hubEntries);
  const bld = builderEntries instanceof Map ? builderEntries : builderActions(builderEntries);
  const relayTimeoutMs = Number.isFinite(opts.relayTimeoutMs) ? opts.relayTimeoutMs : RELAY_TIMEOUT_MS;
  const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : GRACE_MS;
  const startOnlyMs = Number.isFinite(opts.startOnlyMs) ? opts.startOnlyMs : START_ONLY_MS;
  const pulledAt = isPlain(opts.pulledAt) || opts.pulledAt instanceof Map ? opts.pulledAt : null;
  const rows = [];
  for (const h of hub.values()) {
    let pulled;
    if (pulledAt) {
      const v = pulledAt instanceof Map ? pulledAt.get(h.builder) : (Object.hasOwn(pulledAt, h.builder ?? '') ? pulledAt[h.builder] : undefined);
      pulled = Number.isFinite(v) ? v : null;
    }
    const b = bld.get(h.id) ?? null;
    rows.push({
      id: h.id, builder: h.builder, action: h.action, target: h.target,
      hub: { phase: h.phase, ok: h.ok },
      builderEntry: b && (b.hash !== null || b.startHash !== null)
        ? { ok: b.hash !== null ? b.ok : 'unknown', hash: b.hash ?? b.startHash }
        : null,
      state: stateOf(h, b, { pulled, relayTimeoutMs, graceMs, startOnlyMs }),
    });
  }
  return rows;
}

/**
 * unknownOnHub(hubEntries, builderEntries, {floorTs}) -> builder `via:'hub'` actions whose id the hub never sent.
 * Pure. Only builder actions with ts >= floorTs are judged (older ones may predate the hub log or its index).
 */
export function unknownOnHub(hubEntries, builderEntries, { floorTs = -Infinity } = {}) {
  const hub = hubEntries instanceof Map ? hubEntries : hubActions(hubEntries);
  const bld = builderEntries instanceof Map ? builderEntries : builderActions(builderEntries);
  const out = [];
  for (const b of bld.values()) {
    if (hub.has(b.id)) continue;
    if (!(Number.isFinite(b.ts) && b.ts >= floorTs)) continue;
    out.push({ id: str(b.id), builder: b.builder, action: b.action, target: b.target, ts: b.ts, hash: b.hash ?? b.startHash });
  }
  return out;
}

const FORK_TEXTS = {
    'after-not-found': 'no longer contains the anchored head',
    'index-mismatch': 'has the anchored head at another position',
    'not-chained': 'returned entries that do not continue the anchored head',
    'chain-invalid': 'returned entries that do not verify',
    'head-mismatch': 'reports a head that differs from the verified one',
  'count-regressed': 'is shorter than the anchored head',
};

function forkText(reason, builderId) {
  return `audit chain of ${builderId} ${FORK_TEXTS[reason] ?? 'was rewritten after an anchor'}`;
}

function fork(reason, builderId, detail = '') {
  return { ok: false, fork: true, reason, text: `${forkText(reason, builderId)}${detail ? ` (${detail})` : ''}` };
}

/**
 * checkSegment(anchor, response, builderId) — verify one `GET /api/v1/audit?after=<anchor.hash>` page (or, for
 * anchor {hash: GENESIS, count: 0}, a read from the start). Pure.
 *   -> {ok:true, tip:{hash, count}, entries, head, more}
 *    | {ok:false, fork:true, reason, text}       the chain was rewritten after the anchor (audit-fork)
 *    | {ok:false, fork:false, reason}           a malformed answer (not a fork; retried on the next pull)
 */
export function checkSegment(anchor, response, builderId) {
  const bad = (reason) => ({ ok: false, fork: false, reason });
  if (!isPlain(anchor) || typeof anchor.hash !== 'string' || !isCount(anchor.count)) throw new TypeError('checkSegment: bad anchor');
  if (!isPlain(response) || !Array.isArray(response.entries)) return bad('bad-response');
  if (response.builder !== undefined && response.builder !== builderId) return bad('wrong-builder');
  if (response.entries.length > MAX_READ_LIMIT) return bad('too-many-entries');
  const anchored = anchor.count > 0;
  if (anchored && response.afterFound === false) return fork('after-not-found', builderId);
  if (anchored && response.afterFound !== undefined && response.afterFound !== true) return bad('bad-response');
  if (anchored && response.afterIndex !== undefined && response.afterIndex !== anchor.count - 1) {
    return fork('index-mismatch', builderId, isCount(response.afterIndex) ? `index ${response.afterIndex}, anchored ${anchor.count - 1}` : 'bad index');
  }
  const head = isPlain(response.head) && typeof response.head.hash === 'string' && isCount(response.head.count)
    ? { hash: response.head.hash, count: response.head.count }
    : null;
  // SR14 L1: past an anchor the head is required (the count-regressed / continuity checks rest on it)
  if (anchored && !head) return bad('bad-response');
  if (head && head.count < anchor.count) return fork('count-regressed', builderId, `count ${head.count}, anchored ${anchor.count}`);
  const lines = response.entries.map((e) => {
    try { return canonicalJson(e); } catch { return null; }
  });
  const v = verifyFile(lines, anchor.hash);
  if (!v.ok) {
    if (v.firstBad?.line === 1 && v.firstBad.reason === 'prev_mismatch') return fork('not-chained', builderId);
    return fork('chain-invalid', builderId, `${v.firstBad?.reason ?? 'invalid'} at entry ${v.firstBad?.line ?? '?'}`);
  }
  const tip = { hash: v.head, count: anchor.count + v.count };
  const more = response.more === true;
  if (head && !more) {
    if (head.count === tip.count && head.hash !== tip.hash) return fork('head-mismatch', builderId);
    if (head.count > tip.count) return bad('head-ahead');
  }
  return { ok: true, tip, entries: response.entries, head, more };
}

function capMap(map, cap, onEvict = null) {
  let evictedTs = null;
  while (map.size > cap) {
    const [k, v] = map.entries().next().value;
    map.delete(k);
    onEvict?.(k, v);
    if (Number.isFinite(v?.ts)) evictedTs = Math.max(evictedTs ?? -Infinity, v.ts);
  }
  return evictedTs;
}

const OK_CODE = new Map([[true, 't'], [false, 'f'], ['unknown', 'u']]);
const CODE_OK = { t: true, f: false, u: 'unknown' };

/** Compact record of one indexed builder entry (persisted in audit.match). */
function matchRecord(e, h) {
  const r = resultOf(e);
  const code = r.phase === 'start' ? 's' : OK_CODE.get(okOf(r.ok));
  const differs = str(e.builder) !== h.builder || str(e.action) !== h.action || str(e.target) !== h.target;
  return [e.id, code, e.hash, differs ? 1 : 0];
}

/** A builder-entry stand-in rebuilt from a record (hub fields where they matched). */
function entryOfRecord(rec, h) {
  if (!Array.isArray(rec) || rec.length !== 4) return null;
  const [id, code, hash, differs] = rec;
  if (typeof id !== 'string' || typeof hash !== 'string' || !HEX64.test(hash)) return null;
  if (code !== 's' && !Object.hasOwn(CODE_OK, code)) return null;
  const same = differs === 0;
  return {
    id, via: 'hub', builder: h.builder, action: same ? h.action : null, target: same ? h.target : null, hash,
    result: code === 's' ? { phase: 'start' } : { ok: CODE_OK[code] },
  };
}

/** Split records into audit.match result chunks under the audit result cap. */
function chunkRecords(records) {
  const out = [];
  let cur = [];
  let size = 30;
  for (const r of records) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (cur.length && size + n > MATCH_RESULT_BUDGET) {
      out.push(cur);
      cur = [];
      size = 30;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

function sampleOf(e, ts) {
  return { id: str(e.id), action: str(e.action), target: str(e.target), ts };
}

/**
 * createAuditReconciler(opts) — the hub service (H11 registers it as `auditForks` for O8 and calls `list` from
 * `GET /api/fleet/audit`).
 *   store:     the fleet store (view(now), subscribe(fn)).
 *   readProxy: H12 createReadProxy() result (only `get` is used).
 *   audit:     the hub's own openAudit() instance (read, append).
 */
export function createAuditReconciler({
  store, readProxy, audit, now = Date.now, timers = globalThis, log = null,
  pullMs = PULL_MS, timeoutMs = PULL_TIMEOUT_MS, maxPages = MAX_PAGES, indexCap = INDEX_CAP,
} = {}) {
  if (!store || typeof store.view !== 'function') throw new TypeError('audit-reconcile: store is required');
  if (!readProxy || typeof readProxy.get !== 'function') throw new TypeError('audit-reconcile: readProxy is required');
  if (!audit || typeof audit.read !== 'function' || typeof audit.append !== 'function') throw new TypeError('audit-reconcile: audit is required');

  const clock = () => Math.floor(Number(now()));
  const hub = new Map(); // id -> hub action
  let hubCursor = null; // last hub entry hash scanned
  let hubFirstTs = null;
  let hubEvictedTs = null;
  // id -> {anchor, fork, index, unknown, unjudgedBefore, pulledAt, lastPullAt, lastOkAt, error, inflight}
  const builders = new Map();
  let lastStates = new Map();
  let timer = null;
  let unsub = null;
  let mismatchList = [];

  function rec(id) {
    let b = builders.get(id);
    if (!b) {
      b = {
        anchor: { hash: GENESIS, count: 0 }, fork: null, index: new Map(), unknown: emptyUnknown(), unjudgedBefore: null,
        pulledAt: null, lastPullAt: null, lastOkAt: null, error: null, inflight: null,
      };
      builders.set(id, b);
    }
    return b;
  }

  function emptyUnknown() {
    return { count: 0, first: [], last: [] };
  }

  /** The hub index dropped an id: its builder facts go with it (the builder index never outgrows the hub's). */
  function dropHubId(k, v) {
    builders.get(v?.builder)?.index.delete(k);
  }

  function resetBuilderFacts(b) {
    b.index.clear();
    b.unknown = emptyUnknown();
    b.pulledAt = null;
  }

  function noteHubEntry(e) {
    if (hubFirstTs === null && Number.isSafeInteger(e.ts)) hubFirstTs = e.ts;
    if (e.action === MATCH_ACTION && e.via === VIA) {
      const id = e.builder;
      if (typeof id !== 'string' || !BUILDER_ID_RX.test(id)) return;
      const recs = resultOf(e).matched;
      if (!Array.isArray(recs)) return;
      const b = rec(id);
      for (const r of recs) {
        const h = Array.isArray(r) ? hub.get(r[0]) : null;
        if (!h || h.builder !== id) continue; // evicted from the hub index, or not ours
        const be = entryOfRecord(r, h);
        if (be) addBuilder(b.index, be);
      }
      return;
    }
    if ((e.action === ANCHOR_ACTION || e.action === FORK_ACTION) && e.via === VIA) {
      const id = e.builder;
      if (typeof id !== 'string' || !BUILDER_ID_RX.test(id)) return;
      const r = resultOf(e);
      const b = rec(id);
      if (e.action === FORK_ACTION) {
        // durable: a fork stays raised across hub restarts until a rebase
        if (!b.fork && FORK_REASONS.includes(r.reason)) {
          b.fork = { builder: id, reason: r.reason, text: forkText(r.reason, id), at: e.ts, anchor: { ...b.anchor } };
        }
        return;
      }
      const head = r.head;
      if (isPlain(head) && typeof head.hash === 'string' && (HEX64.test(head.hash)) && isCount(head.count)) {
        b.anchor = { hash: head.hash, count: head.count };
        if (r.rebased === true) {
          b.fork = null;
          resetBuilderFacts(b);
          b.unjudgedBefore = head.count > 0 && Number.isSafeInteger(e.ts) ? e.ts : null;
        }
      }
      return;
    }
    if (addHub(hub, e)) {
      const ev = capMap(hub, indexCap, dropHubId);
      if (ev !== null) hubEvictedTs = Math.max(hubEvictedTs ?? -Infinity, ev);
    }
  }

  /** Read the hub's own chain incrementally (anchors + relayed actions). */
  function scanHub() {
    for (let i = 0; i < 1000; i++) {
      let r;
      try {
        r = hubCursor ? audit.read({ after: hubCursor, limit: MAX_READ_LIMIT }) : audit.read({ limit: MAX_READ_LIMIT });
      } catch (err) {
        log?.error?.(`audit-reconcile: hub audit read failed: ${err?.code ?? 'error'}`);
        return;
      }
      if (hubCursor && r.afterFound === false) {
        // the hub log was moved aside: start over
        hub.clear();
        for (const b of builders.values()) b.index.clear();
        hubCursor = null;
        hubFirstTs = null;
        hubEvictedTs = null;
        continue;
      }
      for (const e of r.entries ?? []) {
        noteHubEntry(e);
        hubCursor = e.hash;
      }
      if (!r.more) return;
    }
  }

  function upBuilders() {
    const v = store.view(clock());
    return (v.builders ?? []).filter((b) => b.state === 'up' && BUILDER_ID_RX.test(b.id)).map((b) => b.id);
  }

  async function pullOnce(id) {
    const b = rec(id);
    const startedAt = clock();
    b.lastPullAt = startedAt;
    const anchor = b.anchor;
    let tip = anchor;
    let pages = 0;
    let complete = false;
    const fresh = [];
    while (pages < maxPages) {
      pages++;
      const q = tip.count > 0 ? `after=${tip.hash}&limit=${MAX_READ_LIMIT}` : `limit=${MAX_READ_LIMIT}`;
      const { status, json } = await readProxy.get(id, `/api/v1/audit?${q}`, { timeoutMs });
      if (status !== 200) {
        b.error = status === 503 ? 'builder-down' : `http-${Number.isSafeInteger(status) ? status : 0}`;
        break;
      }
      const seg = checkSegment(tip, json, id);
      if (!seg.ok) {
        if (seg.fork) {
          if (!b.fork) {
            b.fork = { builder: id, reason: seg.reason, text: seg.text, at: startedAt, anchor: { ...anchor } };
            log?.warn?.(`audit-reconcile: audit-fork on ${id}: ${seg.reason}`);
            try {
              audit.append({
                user: null, via: VIA, builder: id, action: FORK_ACTION, target: id,
                result: { ok: false, reason: seg.reason, anchor: { hash: anchor.hash, count: anchor.count } },
              });
            } catch (err) {
              log?.error?.(`audit-reconcile: fork record append failed for ${id}: ${err?.code ?? 'error'}`);
            }
          }
        }
        b.error = seg.reason;
        fresh.length = 0; // nothing from a forked answer is trusted
        tip = anchor;
        complete = false;
        break;
      }
      // keep only what matching needs (bounded: via:'hub' entries of this builder, few fields)
      for (const e of seg.entries) {
        if (!isPlain(e) || e.via !== 'hub' || e.builder !== id) continue;
        const r = resultOf(e);
        fresh.push({ id: e.id, via: e.via, builder: e.builder, action: e.action, target: e.target, ts: e.ts, hash: e.hash, result: { phase: r.phase, ok: r.ok } });
      }
      tip = seg.tip;
      if (!seg.more) {
        complete = true;
        b.error = null;
        break;
      }
    }
    if (b.error && FORK_REASONS.includes(b.error)) return;
    if (tip.count === anchor.count && tip.hash === anchor.hash) {
      if (b.error === null) b.lastOkAt = clock();
      if (complete) b.pulledAt = startedAt;
      return;
    }
    // SR14 M1: the hub chain is read again now, after the builder answered: the relay wrote `sent` before its POST,
    // so every envelope the builder can have recorded is known here. Only those ids are indexed.
    scanHub();
    const staged = new Map(); // id -> working copy of the index entry
    const records = [];
    const unknownIds = new Map();
    const floorTs = Math.max(hubFirstTs ?? Infinity, hubEvictedTs ?? -Infinity) + SKEW_MS;
    for (const e of fresh) {
      const h = typeof e.id === 'string' ? hub.get(e.id) : undefined;
      if (h && h.builder === id) {
        if (!staged.has(e.id)) {
          const cur = b.index.get(e.id);
          staged.set(e.id, new Map(cur ? [[e.id, { ...cur, hashes: [...cur.hashes] }]] : []));
        }
        if (addBuilder(staged.get(e.id), e)) records.push(matchRecord(e, h));
        continue;
      }
      if (typeof e.id !== 'string' || e.id === '' || e.id.length > 128 || unknownIds.has(e.id)) continue;
      // builder clocks are untrusted: clamp to the hub's window for this pull
      const ts = Number.isSafeInteger(e.ts) ? Math.min(e.ts, startedAt + SKEW_MS) : startedAt;
      if (ts < floorTs) continue; // may predate the hub log or its index: not judged
      unknownIds.set(e.id, sampleOf(e, ts));
    }
    try {
      // SR14 M2: the matches first, then the anchor that covers them (a crash in between re-pulls the segment)
      for (const chunk of chunkRecords(records)) {
        audit.append({ user: null, via: VIA, builder: id, action: MATCH_ACTION, target: id, result: { ok: true, matched: chunk } });
      }
      audit.append({
        user: null, via: VIA, builder: id, action: ANCHOR_ACTION, target: id,
        result: { ok: true, head: { hash: tip.hash, count: tip.count } },
      });
    } catch (err) {
      // not anchored: keep the old anchor and index nothing; the segment is pulled again next time
      log?.error?.(`audit-reconcile: anchor append failed for ${id}: ${err?.code ?? 'error'}`);
      b.error = 'anchor-failed';
      return;
    }
    b.anchor = tip;
    for (const [k, m] of staged) {
      const v = m.get(k);
      if (v && hub.has(k)) b.index.set(k, v);
    }
    const u = b.unknown;
    for (const sample of unknownIds.values()) {
      u.count++;
      if (u.first.length < UNKNOWN_SAMPLES) u.first.push(sample);
      else {
        u.last.push(sample);
        if (u.last.length > UNKNOWN_SAMPLES) u.last.shift();
      }
    }
    // b.fork is sticky (a restored chain does not clear it): only rebase() does
    if (b.error === null) b.lastOkAt = clock();
    if (complete) b.pulledAt = startedAt;
  }

  /** Pull one builder now (once; concurrent calls share the pull). */
  function pull(id) {
    if (typeof id !== 'string' || !BUILDER_ID_RX.test(id)) return Promise.resolve();
    const b = rec(id);
    if (!b.inflight) {
      b.inflight = pullOnce(id)
        .catch((err) => { b.error = 'pull-failed'; log?.error?.(`audit-reconcile: pull ${id} failed: ${err?.message ?? 'error'}`); })
        .finally(() => { b.inflight = null; });
    }
    return b.inflight;
  }

  function computeMismatches() {
    const pulledAt = {};
    for (const [id, b] of builders) pulledAt[id] = b.pulledAt;
    // each hub action is looked up only in the index of the builder it was sent to
    const all = new Map();
    for (const h of hub.values()) {
      const v = builders.get(h.builder)?.index.get(h.id);
      if (v) all.set(h.id, v);
    }
    const rows = reconcile(hub, all, { pulledAt });
    const hubSide = [];
    for (const r of rows) {
      const b = builders.get(r.builder);
      const h = hub.get(r.id);
      // SR14 L4: a hub action from before a head rebase whose builder entry was not pulled is not judged
      if (b?.unjudgedBefore != null && r.builderEntry === null && (h?.sentTs ?? h?.ts ?? 0) < b.unjudgedBefore) r.state = 'pending';
      if (r.state !== 'missing-on-builder' && r.state !== 'outcome-differs') continue;
      hubSide.push({ kind: 'audit-mismatch', builder: r.builder, id: r.id, state: r.state, action: r.action, target: r.target });
    }
    // SR14 M1: hub-side rows first and capped on their own; unknown-on-hub is one aggregate row per builder
    const out = hubSide.slice(-MISMATCH_CAP);
    for (const [id, b] of builders) {
      const u = b.unknown;
      if (!u.count) continue;
      const lastOne = u.last.at(-1) ?? u.first.at(-1);
      out.push({
        kind: 'audit-mismatch', builder: id, id: lastOne.id, state: 'unknown-on-hub', action: lastOne.action, target: lastOne.target,
        count: u.count, first: u.first.map((x) => ({ ...x })), last: u.last.map((x) => ({ ...x })),
      });
    }
    mismatchList = out;
    lastStates = new Map(rows.map((r) => [r.id, r]));
    return mismatchList;
  }

  /** One round: pull every `up` builder, then re-read the hub chain (after, so a just-sent entry is seen), compare. */
  async function tick() {
    scanHub();
    await Promise.all(upBuilders().map((id) => pull(id)));
    scanHub();
    computeMismatches();
  }

  function forks() {
    const out = [];
    for (const b of builders.values()) if (b.fork) out.push({ builder: b.fork.builder, text: b.fork.text, reason: b.fork.reason, at: b.fork.at });
    return out;
  }

  function signals() {
    return [...forks().map((f) => ({ kind: 'audit-fork', ...f })), ...mismatchList];
  }

  /**
   * `GET /api/fleet/audit?since=&builder=` body: hub entries (one row per relayed action, the outcome entry where
   * present) with their reconciliation `state` (null for hub-only entries such as anchors).
   */
  function list({ since, builder, limit } = {}) {
    if (builder !== undefined && builder !== null && builder !== '' && !(typeof builder === 'string' && BUILDER_ID_RX.test(builder))) {
      return { entries: [], more: false, forks: [] };
    }
    const r = audit.read({ since, limit });
    const rows = [];
    const done = new Set();
    for (const e of r.entries) if (e.via === 'hub' && resultOf(e).phase === 'done') done.add(e.id);
    for (const e of r.entries) {
      if (builder && e.builder !== builder) continue;
      const res = resultOf(e);
      const relayed = e.via === 'hub' && (res.phase === 'sent' || res.phase === 'done');
      if (relayed && res.phase === 'sent' && done.has(e.id)) continue; // count each action once
      const s = relayed ? lastStates.get(e.id) : null;
      rows.push({
        ts: e.ts, id: e.id, user: e.user, via: e.via, builder: e.builder, action: e.action, target: e.target,
        ok: relayed ? (res.phase === 'done' ? okOf(res.ok) : 'unknown') : (res.ok ?? null),
        state: relayed ? (s?.state ?? 'pending') : null,
        builderEntry: s?.builderEntry ?? null,
      });
    }
    return { entries: rows, more: r.more === true, forks: forks().filter((f) => !builder || f.builder === builder) };
  }

  function status() {
    const out = {};
    for (const [id, b] of builders) {
      out[id] = {
        anchor: { ...b.anchor }, fork: b.fork ? { reason: b.fork.reason, at: b.fork.at } : null, lastPullAt: b.lastPullAt,
        lastOkAt: b.lastOkAt, pulledAt: b.pulledAt, error: b.error, indexed: b.index.size, unknownOnHub: b.unknown.count,
      };
    }
    return out;
  }

  function anchors() {
    const out = {};
    for (const [id, b] of builders) out[id] = { ...b.anchor };
    return out;
  }

  /**
   * Human recovery after a deliberate builder log reset: forget the anchor. With no `head` the next pull starts at
   * genesis; with `head` ({hash, count} the builder's current verified head, e.g. after its rotated files were
   * deleted) the hub re-anchors there (SR14 L4). `user` is recorded in the anchor entry. -> boolean
   */
  function rebase(id, { head = null, user = null } = {}) {
    if (typeof id !== 'string' || !BUILDER_ID_RX.test(id)) return false;
    const b = builders.get(id);
    if (!b) return false;
    let to = { hash: GENESIS, count: 0 };
    if (head !== null) {
      if (!isPlain(head) || typeof head.hash !== 'string' || !HEX64.test(head.hash) || !isCount(head.count) || head.count < 1) return false;
      to = { hash: head.hash, count: head.count };
    }
    let entry;
    try {
      entry = audit.append({ user: str(user), via: VIA, builder: id, action: ANCHOR_ACTION, target: id, result: { ok: true, rebased: true, head: to } });
    } catch (err) {
      log?.error?.(`audit-reconcile: rebase append failed for ${id}: ${err?.code ?? 'error'}`);
      return false;
    }
    b.anchor = to;
    b.fork = null;
    resetBuilderFacts(b);
    b.unjudgedBefore = to.count > 0 ? (Number.isSafeInteger(entry?.ts) ? entry.ts : clock()) : null;
    return true;
  }

  /** Read the builder's current head through the proxy and rebase onto it (SR14 L4). */
  async function rebaseToHead(id, { user = null } = {}) {
    if (typeof id !== 'string' || !BUILDER_ID_RX.test(id) || !builders.has(id)) return { ok: false, error: 'unknown builder' };
    const { status, json } = await readProxy.get(id, '/api/v1/audit?limit=1', { timeoutMs });
    if (status !== 200 || !isPlain(json) || (json.builder !== undefined && json.builder !== id)) return { ok: false, error: 'builder read failed' };
    const h = json.head;
    if (!isPlain(h) || typeof h.hash !== 'string' || !HEX64.test(h.hash) || !isCount(h.count)) return { ok: false, error: 'bad head' };
    const head = { hash: h.hash, count: h.count };
    const ok = head.count === 0 ? rebase(id, { user }) : rebase(id, { head, user });
    return ok ? { ok: true, head: head.count === 0 ? { hash: GENESIS, count: 0 } : head } : { ok: false, error: 'rebase failed' };
  }

  function start() {
    if (timer) return;
    const lastState = new Map();
    for (const b of store.view(clock()).builders ?? []) lastState.set(b.id, b.state);
    if (typeof store.subscribe === 'function') {
      unsub = store.subscribe((ev) => {
        if (ev?.kind !== 'conn' || typeof ev.builder !== 'string') return;
        const row = (store.view(clock()).builders ?? []).find((b) => b.id === ev.builder);
        const was = lastState.get(ev.builder);
        lastState.set(ev.builder, row?.state);
        if (row?.state === 'up' && was !== 'up') {
          // once on reconnect
          scanHub();
          pull(ev.builder).then(() => { scanHub(); computeMismatches(); }, () => {});
        }
      });
    }
    timer = timers.setInterval(() => { tick().catch(() => {}); }, pullMs);
    timer?.unref?.();
    tick().catch(() => {});
  }

  function stop() {
    if (timer) timers.clearInterval(timer);
    timer = null;
    if (unsub) unsub();
    unsub = null;
  }

  scanHub();
  return { start, stop, tick, pull, forks, mismatches: () => mismatchList.slice(), signals, list, status, anchors, rebase, rebaseToHead };
}

/**
 * For H11's route (e.g. `POST /api/fleet/audit/:builder/rebase`, body `{confirm, onto}`): a `direct`-only,
 * typed-confirm, audited rebase. `confirm` must equal the builder id; `onto` is 'genesis' (default) or 'head'.
 * Never throws. -> {status, body}
 */
export async function handleRebase(reconciler, { builder, confirm, onto = 'genesis', auth } = {}) {
  try {
    if (!auth || auth.kind !== 'direct') return { status: 403, body: { ok: false, error: 'remote-only' } };
    if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) return { status: 404, body: { ok: false, error: 'unknown builder' } };
    if (confirm !== builder) return { status: 400, body: { ok: false, error: 'confirm', expected: builder } };
    const user = typeof auth.user === 'string' ? auth.user : null;
    if (onto === 'head') {
      const r = await reconciler.rebaseToHead(builder, { user });
      return r.ok ? { status: 200, body: { ok: true, builder, head: r.head } } : { status: 502, body: { ok: false, error: r.error } };
    }
    if (onto !== 'genesis') return { status: 400, body: { ok: false, error: 'onto must be genesis or head' } };
    return reconciler.rebase(builder, { user })
      ? { status: 200, body: { ok: true, builder, head: { hash: GENESIS, count: 0 } } }
      : { status: 404, body: { ok: false, error: 'unknown builder' } };
  } catch {
    return { status: 500, body: { ok: false, error: 'rebase failed' } };
  }
}
