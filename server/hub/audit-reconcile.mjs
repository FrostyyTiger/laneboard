// Hub audit reconciliation and anchoring (fleet plan §3 2.15, H13). REVIEW-REQUIRED (SR14).
//
//   reconcile(hubEntries, builderEntries, {pulledAt?, relayTimeoutMs?, graceMs?}?) -> rows   (pure)
//   unknownOnHub(hubEntries, builderEntries, {floorTs?}?) -> [{id, builder, action, target, ts, hash}]   (pure)
//   checkSegment(anchor, response, builderId) -> {ok:true, tip, entries, head} | {ok:false, fork?, reason, text}   (pure)
//   createAuditReconciler({store, readProxy, audit, now?, timers?, log?, pullMs?, timeoutMs?, maxPages?, indexCap?})
//     -> {start(), stop(), tick(), pull(builderId), forks(), mismatches(), signals(), list(q), status(), anchors(), rebase(id)}
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
export const STATES = Object.freeze(['match', 'missing-on-builder', 'outcome-differs', 'unknown-settled', 'pending']);
export const FORK_REASONS = Object.freeze([
  'after-not-found', 'index-mismatch', 'not-chained', 'chain-invalid', 'head-mismatch', 'count-regressed',
]);

/** `via` of the entries this module writes into the hub chain (anchors and fork records). */
export const VIA = 'hub-reconcile';
/** Additive: a detected fork is recorded once in the hub chain so it survives a hub restart. */
export const FORK_ACTION = 'audit.fork';

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

function stateOf(h, b, { pulled, relayTimeoutMs, graceMs }) {
  // `pulled`: undefined = no pending logic (pure contract); null = never pulled; else the hub ms the pull started.
  const settledAt = (h.doneTs ?? ((h.sentTs ?? h.ts ?? 0) + relayTimeoutMs)) + graceMs;
  const notYet = pulled !== undefined && (pulled === null || pulled < settledAt);
  const hubUnknown = h.phase !== 'done' || h.ok === 'unknown';
  const same = b && b.builder === h.builder && b.action === h.action && b.target === h.target;
  if (!b || b.hash === null) {
    if (b && b.startHash !== null) {
      // ran on the builder, no outcome recorded (yet)
      if (hubUnknown) return 'pending';
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
      state: stateOf(h, b, { pulled, relayTimeoutMs, graceMs }),
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
  if (anchored && response.afterIndex !== undefined && response.afterIndex !== anchor.count - 1) {
    return fork('index-mismatch', builderId, isCount(response.afterIndex) ? `index ${response.afterIndex}, anchored ${anchor.count - 1}` : 'bad index');
  }
  const head = isPlain(response.head) && typeof response.head.hash === 'string' && isCount(response.head.count)
    ? { hash: response.head.hash, count: response.head.count }
    : null;
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

function capMap(map, cap) {
  let evictedTs = null;
  while (map.size > cap) {
    const [k, v] = map.entries().next().value;
    map.delete(k);
    if (Number.isFinite(v?.ts)) evictedTs = Math.max(evictedTs ?? -Infinity, v.ts);
  }
  return evictedTs;
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
  const builders = new Map(); // id -> {anchor, fork, index, pulledAt, lastPullAt, lastOkAt, error, evictedTs, inflight}
  let lastStates = new Map();
  let timer = null;
  let unsub = null;
  let mismatchList = [];

  function rec(id) {
    let b = builders.get(id);
    if (!b) {
      b = { anchor: { hash: GENESIS, count: 0 }, fork: null, index: new Map(), pulledAt: null, lastPullAt: null, lastOkAt: null, error: null, evictedTs: null, inflight: null };
      builders.set(id, b);
    }
    return b;
  }

  function noteHubEntry(e) {
    if (hubFirstTs === null && Number.isSafeInteger(e.ts)) hubFirstTs = e.ts;
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
        if (r.rebased === true) b.fork = null;
      }
      return;
    }
    if (addHub(hub, e)) {
      const ev = capMap(hub, indexCap);
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
    if (tip.count !== anchor.count || tip.hash !== anchor.hash) {
      try {
        audit.append({
          user: null, via: VIA, builder: id, action: ANCHOR_ACTION, target: id,
          result: { ok: true, head: { hash: tip.hash, count: tip.count } },
        });
      } catch (err) {
        // not anchored: keep the old anchor, the segment is pulled again next time
        log?.error?.(`audit-reconcile: anchor append failed for ${id}: ${err?.code ?? 'error'}`);
        b.error = 'anchor-failed';
        return;
      }
      b.anchor = tip;
      // the anchor entry moved the hub head; let the next scan pick it up without re-reading it
    }
    for (const e of fresh) addBuilder(b.index, e);
    const ev = capMap(b.index, indexCap);
    if (ev !== null) b.evictedTs = Math.max(b.evictedTs ?? -Infinity, ev);
    // b.fork is sticky (a restored chain does not clear it): only rebase() does
    b.lastOkAt = clock();
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
    const out = [];
    for (const r of rows) {
      if (r.state !== 'missing-on-builder' && r.state !== 'outcome-differs') continue;
      // a hub action older than what the builder index still holds cannot be judged
      const b = builders.get(r.builder);
      const h = hub.get(r.id);
      if (b?.evictedTs !== null && b?.evictedTs !== undefined && (h?.ts ?? 0) <= b.evictedTs + SKEW_MS) continue;
      out.push({ kind: 'audit-mismatch', builder: r.builder, id: r.id, state: r.state, action: r.action, target: r.target });
    }
    const floorTs = Math.max(hubFirstTs ?? Infinity, hubEvictedTs ?? -Infinity) + SKEW_MS;
    for (const [id, b] of builders) {
      for (const u of unknownOnHub(hub, b.index, { floorTs })) {
        if (u.builder !== id) continue;
        out.push({ kind: 'audit-mismatch', builder: id, id: u.id, state: 'unknown-on-hub', action: u.action, target: u.target });
      }
    }
    mismatchList = out.slice(-MISMATCH_CAP);
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
      out[id] = { anchor: { ...b.anchor }, fork: b.fork ? { reason: b.fork.reason, at: b.fork.at } : null, lastPullAt: b.lastPullAt, lastOkAt: b.lastOkAt, pulledAt: b.pulledAt, error: b.error, indexed: b.index.size };
    }
    return out;
  }

  function anchors() {
    const out = {};
    for (const [id, b] of builders) out[id] = { ...b.anchor };
    return out;
  }

  /** Human recovery after a deliberate builder log reset: forget the anchor; the next pull starts at genesis. */
  function rebase(id) {
    const b = builders.get(id);
    if (!b) return false;
    try {
      audit.append({ user: null, via: VIA, builder: id, action: ANCHOR_ACTION, target: id, result: { ok: true, rebased: true, head: { hash: GENESIS, count: 0 } } });
    } catch (err) {
      log?.error?.(`audit-reconcile: rebase append failed for ${id}: ${err?.code ?? 'error'}`);
      return false;
    }
    b.anchor = { hash: GENESIS, count: 0 };
    b.fork = null;
    b.index.clear();
    b.pulledAt = null;
    return true;
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
  return { start, stop, tick, pull, forks, mismatches: () => mismatchList.slice(), signals, list, status, anchors, rebase };
}
