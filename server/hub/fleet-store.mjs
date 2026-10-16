// Fleet store: the hub's merged view of every builder (§3 2.4).
//
// Pure: no IO, no timers, time is passed in. Everything a builder sends is
// UNTRUSTED (SECURITY-FIXES S2, S3, S10):
// - routing identity comes only from the upstream connection: `key`,
//   `laneKey`, `fkey`, `builder` and `session` are deleted from every
//   builder-supplied object (at any depth); fleet keys are computed at the
//   edges as fkey(<connection's builder id>, name). The store never rewrites
//   `name`.
// - every builder-keyed collection is a Map; object keys `__proto__`,
//   `constructor` and `prototype` are never copied, so ingest cannot reach
//   Object.prototype.
// - names are re-validated (session names, lane ids, branches, repo names);
//   failures are dropped and counted in `entry.dropped`.
// - caps on snapshot and delta: sessions 500 (a snapshot with more is
//   refused), lanes 200, attention 200, approvals 100, events 20/s per builder.
// - sessions lose `preview`/`previewHtml` (at any depth), strings are clamped
//   to 4096 chars (copied into a fresh string, so the clamp never keeps the
//   original frame-sized string alive), `previewLines` to the last 8 lines of
//   400 chars.
// - object keys that shadow Object.prototype members (`hasOwnProperty`,
//   `toString`, `valueOf`, `toJSON`, ...) are dropped, so consumers that call
//   or coerce stored objects cannot be made to throw.
// - memory budget (SR9 M2): every record (session, lane, attention item,
//   approval, repo entry, box/vitals/health/budget, event, stuck) has its own
//   node and char budget (RECORD_BUDGETS), and every snapshot/delta/event
//   message shares one more budget across all its records (MESSAGE_BUDGET).
//   Over budget, the excess values are dropped and counted in
//   `entry.dropped.oversize`. Together with the count caps this bounds what one
//   builder's entry can retain (see RETAINED_BOUND below).
// - view() returns copies; the internal entry is never handed out by it.

import { BUILDER_ID_RX, deriveCode, fkey, parseFkey } from '../fleet/keys.mjs';

// --- limits -----------------------------------------------------------------

export const LIMITS = Object.freeze({
  sessions: 500,
  lanes: 200,
  attention: 200,
  approvals: 100,
  repos: 64,
  eventsPerSec: 20,
  // health/approval/stuck/repos: state-bearing, so a separate, looser bucket
  // (a flood of them is still bounded).
  statePerSec: 100,
  string: 4096,
  previewLines: 8,
  previewLineChars: 400,
  depth: 8,
  arrayItems: 500,
  objectKeys: 200,
  keyChars: 128,
  nodes: 20_000,
});

/**
 * Per-record budgets: `nodes` = values visited (objects, arrays, primitives),
 * `chars` = string chars plus key chars kept. previewLines are bounded on
 * their own (8 x 400 chars) and not counted here.
 */
export const RECORD_BUDGETS = Object.freeze({
  session: Object.freeze({ nodes: 1000, chars: 16 * 1024 }),
  lane: Object.freeze({ nodes: 500, chars: 8 * 1024 }),
  attention: Object.freeze({ nodes: 200, chars: 4 * 1024 }),
  approval: Object.freeze({ nodes: 500, chars: 32 * 1024 }),
  repo: Object.freeze({ nodes: 4000, chars: 64 * 1024 }),
  single: Object.freeze({ nodes: 4000, chars: 64 * 1024 }), // box, vitals, health, budget
  stuck: Object.freeze({ nodes: 100, chars: 4 * 1024 }),
  event: Object.freeze({ nodes: 500, chars: 16 * 1024 }), // emitted, not retained
});

/** Shared by all records of one snapshot, delta or event message. */
export const MESSAGE_BUDGET = Object.freeze({ nodes: 200_000, chars: 4 * 1024 * 1024 });

/**
 * Upper bound on what one builder entry retains, from the count caps times
 * the record budgets (strings are flat after the clamp, so chars retained are
 * chars counted):
 *   sessions   500 x (16 Ki + 8 x 400 preview + 4 Ki stuck) chars, 500 x 1100 nodes
 *   lanes      200 x 8 Ki,   200 x 500
 *   attention  200 x 4 Ki,   200 x 200
 *   approvals  100 x 32 Ki,  100 x 500
 *   repos       64 x 64 Ki,   64 x 4000
 *   singletons   4 x 64 Ki,    4 x 4000
 * plus ID_SLACK chars per record for the validated ids/names the record
 * sanitizers re-set after the budgeted copy, plus the hello (<= ~20 Ki chars)
 * = about 22.6 M chars (<= 45 MiB as two-byte strings, half that for ASCII)
 * and about 1.0 M nodes. Before SR9 the bound was about (500 + 100 + 64) x
 * frame size, i.e. several GiB.
 */
const ID_SLACK = 256;
const RECORDS_MAX = LIMITS.sessions + LIMITS.lanes + LIMITS.attention + LIMITS.approvals + LIMITS.repos + 4;
export const RETAINED_BOUND = Object.freeze({
  chars: LIMITS.sessions * (RECORD_BUDGETS.session.chars + LIMITS.previewLines * LIMITS.previewLineChars + RECORD_BUDGETS.stuck.chars)
    + LIMITS.lanes * RECORD_BUDGETS.lane.chars
    + LIMITS.attention * RECORD_BUDGETS.attention.chars
    + LIMITS.approvals * RECORD_BUDGETS.approval.chars
    + LIMITS.repos * RECORD_BUDGETS.repo.chars
    + 4 * RECORD_BUDGETS.single.chars
    + RECORDS_MAX * ID_SLACK,
  nodes: LIMITS.sessions * (RECORD_BUDGETS.session.nodes + LIMITS.previewLines + 1 + RECORD_BUDGETS.stuck.nodes)
    + LIMITS.lanes * RECORD_BUDGETS.lane.nodes
    + LIMITS.attention * RECORD_BUDGETS.attention.nodes
    + LIMITS.approvals * RECORD_BUDGETS.approval.nodes
    + LIMITS.repos * RECORD_BUDGETS.repo.nodes
    + 4 * RECORD_BUDGETS.single.nodes,
});

// Same rules as server/util.mjs SESSION_NAME_RE, server/lanes/store.mjs
// isLaneId and server/lanes/launch.mjs BRANCH_RE. Copied, not imported: the
// hub must not load modules that pull in config or child_process.
const SESSION_NAME_RE = /^[A-Za-z0-9 _.()-]{1,64}$/;
const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const APPROVAL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const CODE_RE = /^[A-Z0-9]{2,3}$/;
const VERSION_RE = /^v?[0-9A-Za-z.+-]{1,64}$/;
const CAPABILITY_RE = /^[a-z0-9][a-z0-9:._-]{0,47}$/;
const ACTION_RE = /^[a-z][a-z0-9-]{0,31}$/;
const TIERS = new Set(['read', 'click', 'ask', 'confirm']);
const CONN_STATES = new Set(['connecting', 'up', 'stale', 'down', 'misconfigured', 'incompatible']);

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * Keys never copied from builder objects: prototype keys plus every name that
 * shadows an Object.prototype member, and `toJSON`.
 */
const DANGEROUS_KEYS = new Set([...PROTO_KEYS, ...Object.getOwnPropertyNames(Object.prototype), 'toJSON']);
/** Builder-supplied routing fields: never trusted, deleted everywhere. */
export const ROUTING_KEYS = Object.freeze(['key', 'laneKey', 'fkey', 'builder', 'session']);
const ROUTING = new Set(ROUTING_KEYS);

export function isSafeName(name) {
  return typeof name === 'string' && SESSION_NAME_RE.test(name) && !PROTO_KEYS.has(name);
}
export function isLaneId(id) {
  return typeof id === 'string' && LANE_ID_RE.test(id) && !id.includes('..') && !PROTO_KEYS.has(id);
}
export function isBranch(b) {
  return typeof b === 'string' && BRANCH_RE.test(b) && !b.includes('..');
}
export function isRepoName(r) {
  return typeof r === 'string' && REPO_RE.test(r) && !r.includes('..') && !PROTO_KEYS.has(r);
}

// --- generic sanitizer ------------------------------------------------------

/**
 * A copy of `s` that shares no storage with it. `slice` returns a V8 sliced
 * string that keeps the whole parent alive (SR9 M1); a JSON round trip builds
 * a fresh flat string (one-byte when possible) and keeps lone surrogates.
 */
export function flatCopy(s) {
  return JSON.parse(JSON.stringify(s));
}

function clampLen(s, max) {
  if (s.length <= max) return s.length;
  // Do not leave half a surrogate pair at the end.
  const last = s.charCodeAt(max - 1);
  return last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
}

function clampString(s, max) {
  if (s.length <= max) return s;
  return flatCopy(s.slice(0, clampLen(s, max)));
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** A budget for one record; `msg` (optional) is shared across a message. */
function newBudget(rec, msg = null) {
  return { n: rec.nodes, chars: rec.chars, msg, over: 0 };
}

export function newMessageBudget() {
  return { n: MESSAGE_BUDGET.nodes, chars: MESSAGE_BUDGET.chars };
}

function spendNode(b) {
  if (b.n <= 0 || (b.msg && b.msg.n <= 0)) { b.over++; return false; }
  b.n--;
  if (b.msg) b.msg.n--;
  return true;
}

function spendChars(b, len) {
  if (len > b.chars || (b.msg && len > b.msg.chars)) { b.over++; return false; }
  b.chars -= len;
  if (b.msg) b.msg.chars -= len;
  return true;
}

/**
 * Deep copy of JSON-ish builder data with every bound applied. Returns
 * undefined for values that are dropped. The budget counts visited nodes and
 * kept chars (record and message); once exhausted, the rest is dropped and
 * counted in `budget.over`.
 */
function clean(v, depth, budget, opts) {
  if (!spendNode(budget)) return undefined;
  if (v === null) return null;
  switch (typeof v) {
    case 'string': {
      const len = clampLen(v, LIMITS.string);
      if (!spendChars(budget, len)) return undefined;
      return len === v.length ? v : flatCopy(v.slice(0, len));
    }
    case 'number': return Number.isFinite(v) ? v : null;
    case 'boolean': return v;
    case 'object': break;
    default: return undefined;
  }
  if (depth >= LIMITS.depth) return undefined;
  if (Array.isArray(v)) {
    const out = [];
    const n = Math.min(v.length, LIMITS.arrayItems);
    for (let i = 0; i < n; i++) {
      const c = clean(v[i], depth + 1, budget, opts);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (!isPlainObject(v)) return undefined;
  const out = {};
  let keys = 0;
  for (const k of Object.keys(v)) {
    if (keys >= LIMITS.objectKeys) break;
    if (DANGEROUS_KEYS.has(k) || ROUTING.has(k) || k.length > LIMITS.keyChars) continue;
    if (k === 'previewHtml' || (k === 'preview' && opts?.dropPreview)) continue;
    if (!spendChars(budget, k.length)) break;
    const c = clean(v[k], depth + 1, budget, opts);
    if (c === undefined) continue;
    out[k] = c;
    keys++;
  }
  return out;
}

/** Sanitize any builder value. Plain objects/arrays/primitives only. */
export function sanitize(v, rec = { nodes: LIMITS.nodes, chars: LIMITS.nodes * 16 }) {
  const r = clean(v, 0, newBudget(rec));
  return r === undefined ? null : r;
}

/** Sanitize one record under its own budget and the message budget `mb`. */
function cleanRec(v, rec, mb, count, opts) {
  const b = newBudget(rec, mb);
  const r = clean(v, 0, b, opts);
  if (b.over && count) count('oversize', b.over);
  return r === undefined ? null : r;
}

function cleanObject(v, rec, mb, count) {
  if (!isPlainObject(v)) return null;
  return cleanRec(v, rec, mb, count);
}

function cleanPreviewLines(v) {
  if (!Array.isArray(v)) return undefined;
  const lines = v.filter((l) => typeof l === 'string').slice(-LIMITS.previewLines);
  return lines.map((l) => clampString(l, LIMITS.previewLineChars));
}

function finiteOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// --- record sanitizers (return null = drop) ---------------------------------

function cleanSession(raw, count, mb) {
  if (!isPlainObject(raw)) { count('sessions'); return null; }
  if (!isSafeName(raw.name)) { count('names'); return null; }
  const { preview: _p, previewLines, ...rest } = raw;
  const s = cleanRec(rest, RECORD_BUDGETS.session, mb, count, { dropPreview: true });
  if (s === null) return null; // message budget exhausted (counted)
  s.name = raw.name;
  const pl = cleanPreviewLines(previewLines);
  if (pl !== undefined) s.previewLines = pl;
  if (s.lane !== undefined && s.lane !== null && !isLaneId(s.lane)) { s.lane = null; count('names'); }
  if (s.branch !== undefined && s.branch !== null && !isBranch(s.branch)) { s.branch = null; count('names'); }
  return s;
}

function cleanLane(raw, count, mb) {
  if (!isPlainObject(raw)) { count('lanes'); return null; }
  if (!isLaneId(raw.id)) { count('names'); return null; }
  const l = cleanRec(raw, RECORD_BUDGETS.lane, mb, count);
  if (l === null) return null;
  l.id = raw.id;
  if (l.branch !== undefined && l.branch !== null && !isBranch(l.branch)) { l.branch = null; count('names'); }
  if (Array.isArray(l.sessions)) {
    const ok = l.sessions.filter(isSafeName);
    if (ok.length !== l.sessions.length) count('names', l.sessions.length - ok.length);
    l.sessions = ok;
  }
  return l;
}

function cleanAttention(raw, count, mb) {
  if (!isPlainObject(raw)) { count('attention'); return null; }
  if (!isSafeName(raw.name)) { count('names'); return null; }
  const a = cleanRec(raw, RECORD_BUDGETS.attention, mb, count);
  if (a === null) return null;
  a.name = raw.name;
  return a;
}

/** Null a free-form identifier field that fails its check (SR9 L1). */
function checkField(o, k, ok, count) {
  if (o[k] !== undefined && o[k] !== null && !ok(o[k])) { o[k] = null; count('names'); }
}

function cleanApproval(raw, count, mb) {
  if (!isPlainObject(raw)) { count('approvals'); return null; }
  if (typeof raw.id !== 'string' || !APPROVAL_ID_RE.test(raw.id) || PROTO_KEYS.has(raw.id)) { count('names'); return null; }
  if (raw.name !== undefined && raw.name !== null && !isSafeName(raw.name)) { count('names'); return null; }
  const a = cleanRec(raw, RECORD_BUDGETS.approval, mb, count);
  if (a === null) return null;
  a.id = raw.id;
  if (typeof raw.name === 'string') a.name = raw.name;
  checkField(a, 'target', isSafeName, count);
  checkField(a, 'lane', isLaneId, count);
  return a;
}

function cleanEvent(raw, count, mb) {
  const ev = cleanObject(raw, RECORD_BUDGETS.event, mb, count);
  if (ev) {
    checkField(ev, 'name', isSafeName, count);
    checkField(ev, 'target', isSafeName, count);
    checkField(ev, 'lane', isLaneId, count);
  }
  return ev;
}

/** Repo names become object keys in snapshotOf, so builtin names are refused too. */
function isStoreRepoName(r) {
  return isRepoName(r) && !DANGEROUS_KEYS.has(r);
}

/** Map an array through a sanitizer with a cap; overflow and failures are counted. */
function capList(arr, max, fn, count, what) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (out.length >= max) { count(what); continue; }
    const c = fn(item, count);
    if (c !== null) out.push(c);
  }
  return out;
}

// --- versions ---------------------------------------------------------------

function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:[-+].*)?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Semver triple compare: 'same' | 'patch' | 'minor' | 'major', null when either is unparsable. */
export function compareVersions(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  if (x[0] !== y[0]) return 'major';
  if (x[1] !== y[1]) return 'minor';
  if (x[2] !== y[2]) return 'patch';
  return 'same';
}

function cleanHello(raw) {
  if (!isPlainObject(raw)) return null;
  const strList = (v, re, max) => (Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === 'string' && re.test(x) && !PROTO_KEYS.has(x)))].slice(0, max)
    : []);
  const actions = new Map();
  if (isPlainObject(raw.actions)) {
    for (const [name, tier] of Object.entries(raw.actions)) {
      if (actions.size >= 64) break;
      if (ACTION_RE.test(name) && TIERS.has(tier)) actions.set(name, tier);
    }
  }
  return {
    version: typeof raw.version === 'string' && VERSION_RE.test(raw.version) ? raw.version : null,
    apiVersion: finiteOrNull(raw.apiVersion),
    capabilities: strList(raw.capabilities, CAPABILITY_RE, 64),
    time: finiteOrNull(raw.time),
    code: typeof raw.code === 'string' && CODE_RE.test(raw.code) ? raw.code : null,
    actions,
    repos: Array.isArray(raw.repos) ? strList(raw.repos, REPO_RE, 200).filter(isRepoName) : null,
    permissionModes: strList(raw.permissionModes, /^[A-Za-z]{1,32}$/, 16),
  };
}

// --- store ------------------------------------------------------------------

function emptySnap() {
  return {
    sessions: new Map(), lanes: [], box: null, vitals: null, attention: [],
    generatedAt: null, repos: null, approvals: [], budget: null, health: null,
  };
}

function newDropped() {
  return {
    names: 0, sessions: 0, lanes: 0, attention: 0, approvals: 0, repos: 0,
    events: 0, messages: 0, snapshots: 0, noSnapshot: 0, oversize: 0,
  };
}

/**
 * createFleetStore({ builders, hubVersion, staleMs, downMs })
 * `builders` is the validated `fleet.builders` config (H1).
 */
export function createFleetStore({ builders = [], hubVersion = null, staleMs = 15_000, downMs = 60_000 } = {}) {
  /** id -> BuilderEntry, insertion = config order. */
  const entries = new Map();
  for (const b of builders) {
    if (!b || typeof b.id !== 'string' || !BUILDER_ID_RX.test(b.id)) throw new TypeError('fleet-store: invalid builder id');
    if (entries.has(b.id)) throw new TypeError(`fleet-store: duplicate builder id ${b.id}`);
    entries.set(b.id, {
      id: b.id,
      configCode: typeof b.code === 'string' && CODE_RE.test(b.code) ? b.code : null,
      code: typeof b.code === 'string' && CODE_RE.test(b.code) ? b.code : deriveCode(b.id),
      url: b.url ?? null,
      directUrl: b.directUrl ?? b.url ?? null,
      account: typeof b.account === 'string' && b.account ? b.account : 'default',
      repos: Array.isArray(b.repos) ? [...b.repos] : null,
      conn: { state: 'connecting', lastSeen: null, connectedAt: null, latencyMs: null, attempts: 0, error: null },
      hello: null,
      versionSkew: null,
      clockSkewMs: null,
      seq: null,
      snap: null,
      snapAt: null,
      dropped: newDropped(),
      rate: { event: [], state: [] },
    });
  }

  const listeners = new Set();
  let listenerErrors = 0;

  function emit(ev) {
    for (const fn of [...listeners]) {
      try { fn(ev); } catch { listenerErrors++; }
    }
  }

  function counter(entry) {
    return (what, n = 1) => { entry.dropped[what] += n; };
  }

  function noteSeq(entry, msg) {
    if (Number.isSafeInteger(msg?.seq) && msg.seq >= 0) entry.seq = msg.seq;
  }

  /** Sliding 1 s window; true if this message may pass. */
  function allow(entry, bucket, max, now) {
    const q = entry.rate[bucket];
    while (q.length && now - q[0] >= 1000) q.shift();
    if (q.length >= max) return false;
    q.push(now);
    return true;
  }

  function applyCommon(entry, msg, count, out, mb) {
    const S = RECORD_BUDGETS.single;
    if (Array.isArray(msg.lanes)) {
      entry.snap.lanes = capList(msg.lanes, LIMITS.lanes, (x, c) => cleanLane(x, c, mb), count, 'lanes');
      out.lanes = true;
    }
    if (Array.isArray(msg.attention)) {
      entry.snap.attention = capList(msg.attention, LIMITS.attention, (x, c) => cleanAttention(x, c, mb), count, 'attention');
      out.attention = true;
    }
    if (msg.box !== undefined) {
      entry.snap.box = cleanObject(msg.box, S, mb, count);
      out.box = true;
    }
    if (msg.vitals !== undefined && msg.vitals !== null) {
      entry.snap.vitals = cleanObject(msg.vitals, S, mb, count);
      out.vitals = true;
    }
    if (Array.isArray(msg.approvals)) {
      entry.snap.approvals = capList(msg.approvals, LIMITS.approvals, (x, c) => cleanApproval(x, c, mb), count, 'approvals');
      out.approvals = true;
    }
    if (msg.budget !== undefined) {
      entry.snap.budget = Array.isArray(msg.budget) ? cleanRec(msg.budget.slice(0, LIMITS.arrayItems), S, mb, count) : null;
      out.budget = true;
    }
    if (msg.health !== undefined) {
      entry.snap.health = cleanObject(msg.health, S, mb, count);
      out.health = true;
    }
    if (isPlainObject(msg.repos)) {
      const repos = new Map();
      for (const [name, data] of Object.entries(msg.repos)) {
        if (!isStoreRepoName(name)) { count('names'); continue; }
        if (repos.size >= LIMITS.repos) { count('repos'); continue; }
        repos.set(name, cleanRec(data, RECORD_BUDGETS.repo, mb, count));
      }
      entry.snap.repos = repos;
      out.repos = true;
    }
    const g = finiteOrNull(msg.generatedAt);
    if (g !== null) entry.snap.generatedAt = g;
  }

  function applySnapshot(id, msg, now) {
    const entry = entries.get(id);
    if (!entry || !isPlainObject(msg)) return null;
    const count = counter(entry);
    if (!Array.isArray(msg.sessions)) {
      count('snapshots');
      return { changed: [], removed: [], rejected: 'no-sessions' };
    }
    if (msg.sessions.length > LIMITS.sessions) {
      count('snapshots');
      return { changed: [], removed: [], rejected: 'too-many-sessions' };
    }
    const mb = newMessageBudget();
    const sessions = new Map();
    for (const raw of msg.sessions) {
      const s = cleanSession(raw, count, mb);
      if (s) sessions.set(s.name, s);
    }
    const prev = entry.snap?.sessions ?? new Map();
    const removed = [...prev.keys()].filter((n) => !sessions.has(n));
    const changed = [...sessions.keys()];
    entry.snap = emptySnap();
    entry.snap.sessions = sessions;
    const out = { changed, removed };
    applyCommon(entry, msg, count, {}, mb);
    entry.snapAt = now;
    noteSeq(entry, msg);
    emit({ builder: id, kind: 'snapshot', changed, removed });
    return out;
  }

  function applyDelta(id, msg, now) {
    const entry = entries.get(id);
    if (!entry || !isPlainObject(msg)) return null;
    const count = counter(entry);
    if (!entry.snap) {
      count('noSnapshot');
      return { changed: [], removed: [], ignored: 'no-snapshot' };
    }
    const mb = newMessageBudget();
    const sessions = entry.snap.sessions;
    const changed = [];
    const removed = [];
    const transitions = [];
    if (Array.isArray(msg.sessions)) {
      const n = msg.sessions.length;
      if (n > LIMITS.sessions) count('sessions', n - LIMITS.sessions);
      for (let i = 0; i < Math.min(n, LIMITS.sessions); i++) {
        const s = cleanSession(msg.sessions[i], count, mb);
        if (!s) continue;
        const before = sessions.get(s.name);
        if (!before && sessions.size >= LIMITS.sessions) { count('sessions'); continue; }
        sessions.set(s.name, s);
        changed.push(s.name);
        const from = before ? (before.state ?? null) : null;
        const to = s.state ?? null;
        if (from !== to) transitions.push({ fkey: fkey(id, s.name), from, to });
      }
    }
    if (Array.isArray(msg.removed)) {
      for (const name of msg.removed.slice(0, LIMITS.sessions)) {
        if (!isSafeName(name)) continue;
        if (sessions.delete(name)) removed.push(name);
      }
    }
    const out = { changed: changed.filter((n) => sessions.has(n)), removed };
    const flags = {};
    applyCommon(entry, msg, count, flags, mb);
    if (flags.lanes) out.lanes = true;
    if (flags.box) out.box = true;
    if (flags.vitals) out.vitals = true;
    if (flags.attention) out.attention = true;
    entry.snapAt = now;
    noteSeq(entry, msg);
    const ev = { builder: id, kind: 'delta', changed: out.changed, removed, ...flags };
    if (transitions.length) ev.transitions = transitions;
    out.transitions = transitions;
    emit(ev);
    return out;
  }

  /** event, health, approval, stuck, repos. Returns the sanitized message, or null if dropped. */
  function applyEvent(id, msg, now) {
    const entry = entries.get(id);
    if (!entry || !isPlainObject(msg) || typeof msg.type !== 'string') return null;
    const count = counter(entry);
    const type = msg.type;
    const isEvent = type === 'event';
    if (!['event', 'health', 'approval', 'stuck', 'repos'].includes(type)) { count('messages'); return null; }
    if (isEvent ? !allow(entry, 'event', LIMITS.eventsPerSec, now) : !allow(entry, 'state', LIMITS.statePerSec, now)) {
      count(isEvent ? 'events' : 'messages');
      return null;
    }
    noteSeq(entry, msg);
    const mb = newMessageBudget();
    const snap = entry.snap;
    let out;
    let changed = [];
    if (type === 'event') {
      out = { type, event: cleanEvent(msg.event, count, mb) };
    } else if (type === 'health') {
      out = { type, health: cleanObject(msg.health, RECORD_BUDGETS.single, mb, count) };
      if (snap) snap.health = out.health;
    } else if (type === 'approval') {
      if (msg.op !== 'open' && msg.op !== 'close') { count('messages'); return null; }
      const a = cleanApproval(msg.approval, count, mb);
      if (!a) return null;
      out = { type, op: msg.op, approval: a };
      if (snap) {
        const i = snap.approvals.findIndex((x) => x.id === a.id);
        if (msg.op === 'close') {
          if (i >= 0) snap.approvals.splice(i, 1);
        } else if (i >= 0) {
          snap.approvals[i] = a;
        } else if (snap.approvals.length >= LIMITS.approvals) {
          count('approvals');
        } else {
          snap.approvals.push(a);
        }
      }
    } else if (type === 'stuck') {
      if (!isSafeName(msg.name)) { count('names'); return null; }
      const stuck = msg.stuck === null ? null : cleanObject(msg.stuck, RECORD_BUDGETS.stuck, mb, count);
      out = { type, name: msg.name, stuck };
      const s = snap?.sessions.get(msg.name);
      if (s) { s.stuck = stuck; changed = [msg.name]; }
    } else {
      if (!isStoreRepoName(msg.repo)) { count('names'); return null; }
      const data = msg.data === null || msg.data === undefined ? null : cleanRec(msg.data, RECORD_BUDGETS.repo, mb, count);
      out = { type, repo: msg.repo, data };
      if (snap) {
        if (!snap.repos) snap.repos = new Map();
        if (data === null) snap.repos.delete(msg.repo);
        else if (!snap.repos.has(msg.repo) && snap.repos.size >= LIMITS.repos) count('repos');
        else snap.repos.set(msg.repo, data);
      }
    }
    emit({ builder: id, kind: type, changed, removed: [], msg: out });
    return out;
  }

  /** Connection status from the upstream. Unknown fields are ignored. */
  function setConn(id, patch = {}) {
    const entry = entries.get(id);
    if (!entry || !isPlainObject(patch)) return false;
    const c = entry.conn;
    const before = JSON.stringify([c, entry.versionSkew, entry.code]);
    if (CONN_STATES.has(patch.state)) {
      if (patch.state === 'up' && c.state !== 'up') c.connectedAt = finiteOrNull(patch.connectedAt) ?? finiteOrNull(patch.lastSeen) ?? c.connectedAt;
      c.state = patch.state;
    }
    for (const k of ['lastSeen', 'latencyMs', 'attempts', 'connectedAt']) {
      if (k in patch) c[k] = finiteOrNull(patch[k]);
    }
    if ('error' in patch) c.error = typeof patch.error === 'string' ? clampString(patch.error, 200) : null;
    if ('clockSkewMs' in patch) entry.clockSkewMs = finiteOrNull(patch.clockSkewMs);
    if ('hello' in patch) {
      entry.hello = patch.hello === null ? null : cleanHello(patch.hello);
      entry.versionSkew = entry.hello ? compareVersions(entry.hello.version, hubVersion) : null;
      entry.code = entry.configCode ?? entry.hello?.code ?? deriveCode(id);
    }
    if (JSON.stringify([c, entry.versionSkew, entry.code]) !== before) {
      emit({ builder: id, kind: 'conn', changed: [], removed: [] });
    }
    return true;
  }

  /** The upstream's state, downgraded by age as a backstop (never upgraded). */
  function effectiveState(entry, now) {
    const s = entry.conn.state;
    if ((s === 'up' || s === 'stale') && entry.conn.lastSeen !== null && typeof now === 'number') {
      const age = now - entry.conn.lastSeen;
      if (age >= downMs) return 'down';
      if (age >= staleMs) return 'stale';
    }
    return s;
  }

  function session(k) {
    const p = parseFkey(k);
    if (!p) return null;
    const entry = entries.get(p.builder);
    const s = entry?.snap?.sessions.get(p.name);
    return s ? { builder: p.builder, session: s } : null;
  }

  /**
   * Read model for consumers. Everything mutable is a copy (SR9 L4): changing
   * the returned data never reaches the store's own state. `builder(id)` and
   * `list()` still return the live entries for the store's owners (upstream,
   * routes); treat those as read-only.
   */
  function view(now) {
    return {
      now,
      hubVersion,
      builders: [...entries.values()].map((e) => {
        const state = effectiveState(e, now);
        return {
          id: e.id,
          code: e.code,
          url: e.url,
          directUrl: e.directUrl,
          account: e.account,
          repos: e.repos ? [...e.repos] : null,
          state,
          conn: { ...e.conn, state },
          hello: e.hello ? structuredClone(e.hello) : null,
          versionSkew: e.versionSkew,
          clockSkewMs: e.clockSkewMs,
          seq: e.seq,
          snap: e.snap ? structuredClone(e.snap) : null,
          snapAt: e.snapAt,
          ageMs: e.snapAt === null ? null : Math.max(0, now - e.snapAt),
          stale: state !== 'up',
          controls: state === 'up' && e.versionSkew !== 'major',
          dropped: { ...e.dropped },
        };
      }),
    };
  }

  return {
    applySnapshot,
    applyDelta,
    applyEvent,
    setConn,
    builder: (id) => entries.get(id) ?? null,
    list: () => [...entries.values()],
    session,
    view,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stats: () => ({ listenerErrors }),
  };
}

/**
 * A builder's cached snapshot as plain data, in the wire shape (sessions as an
 * array, repos as an object). For client-ws, /api/fleet/:builder/snapshot and
 * the Map. Returns null when there is no snapshot yet.
 */
export function snapshotOf(entry) {
  const snap = entry?.snap;
  if (!snap) return null;
  return {
    sessions: [...snap.sessions.values()],
    lanes: snap.lanes,
    box: snap.box,
    vitals: snap.vitals,
    attention: snap.attention,
    generatedAt: snap.generatedAt,
    repos: snap.repos ? Object.fromEntries(snap.repos) : null,
    approvals: snap.approvals,
    budget: snap.budget,
    health: snap.health,
  };
}
