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
// - sessions lose `preview`/`previewHtml`, strings are clamped to 4096 chars,
//   `previewLines` to the last 8 lines of 400 chars.

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

function clampString(s, max) {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  // Do not leave half a surrogate pair at the end.
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/**
 * Deep copy of JSON-ish builder data with every bound applied. Returns
 * undefined for values that are dropped. `budget.n` counts visited nodes;
 * once exhausted, the rest is dropped.
 */
function clean(v, depth, budget, opts) {
  if (--budget.n < 0) return undefined;
  if (v === null) return null;
  switch (typeof v) {
    case 'string': return clampString(v, LIMITS.string);
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
    if (PROTO_KEYS.has(k) || ROUTING.has(k) || k.length > LIMITS.keyChars) continue;
    if (k === 'previewHtml') continue;
    const c = clean(v[k], depth + 1, budget, opts);
    if (c === undefined) continue;
    out[k] = c;
    keys++;
  }
  return out;
}

/** Sanitize any builder value. Plain objects/arrays/primitives only. */
export function sanitize(v) {
  const r = clean(v, 0, { n: LIMITS.nodes });
  return r === undefined ? null : r;
}

function cleanObject(v) {
  if (!isPlainObject(v)) return null;
  return sanitize(v);
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

function cleanSession(raw, count) {
  if (!isPlainObject(raw)) { count('sessions'); return null; }
  if (!isSafeName(raw.name)) { count('names'); return null; }
  const { preview: _p, previewLines, ...rest } = raw;
  const s = sanitize(rest);
  s.name = raw.name;
  const pl = cleanPreviewLines(previewLines);
  if (pl !== undefined) s.previewLines = pl;
  if (s.lane !== undefined && s.lane !== null && !isLaneId(s.lane)) { s.lane = null; count('names'); }
  if (s.branch !== undefined && s.branch !== null && !isBranch(s.branch)) { s.branch = null; count('names'); }
  return s;
}

function cleanLane(raw, count) {
  if (!isPlainObject(raw)) { count('lanes'); return null; }
  if (!isLaneId(raw.id)) { count('names'); return null; }
  const l = sanitize(raw);
  if (l.branch !== undefined && l.branch !== null && !isBranch(l.branch)) { l.branch = null; count('names'); }
  if (Array.isArray(l.sessions)) {
    const ok = l.sessions.filter(isSafeName);
    if (ok.length !== l.sessions.length) count('names', l.sessions.length - ok.length);
    l.sessions = ok;
  }
  return l;
}

function cleanAttention(raw, count) {
  if (!isPlainObject(raw)) { count('attention'); return null; }
  if (!isSafeName(raw.name)) { count('names'); return null; }
  const a = sanitize(raw);
  return a;
}

function cleanApproval(raw, count) {
  if (!isPlainObject(raw)) { count('approvals'); return null; }
  if (typeof raw.id !== 'string' || !APPROVAL_ID_RE.test(raw.id) || PROTO_KEYS.has(raw.id)) { count('names'); return null; }
  const a = sanitize(raw);
  if (a.name !== undefined && a.name !== null && !isSafeName(a.name)) { count('names'); return null; }
  return a;
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
    events: 0, messages: 0, snapshots: 0, noSnapshot: 0,
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

  function applyCommon(entry, msg, count, out) {
    if (Array.isArray(msg.lanes)) {
      entry.snap.lanes = capList(msg.lanes, LIMITS.lanes, cleanLane, count, 'lanes');
      out.lanes = true;
    }
    if (Array.isArray(msg.attention)) {
      entry.snap.attention = capList(msg.attention, LIMITS.attention, cleanAttention, count, 'attention');
      out.attention = true;
    }
    if (msg.box !== undefined) {
      entry.snap.box = cleanObject(msg.box);
      out.box = true;
    }
    if (msg.vitals !== undefined && msg.vitals !== null) {
      entry.snap.vitals = cleanObject(msg.vitals);
      out.vitals = true;
    }
    if (Array.isArray(msg.approvals)) {
      entry.snap.approvals = capList(msg.approvals, LIMITS.approvals, cleanApproval, count, 'approvals');
      out.approvals = true;
    }
    if (msg.budget !== undefined) {
      entry.snap.budget = Array.isArray(msg.budget) ? sanitize(msg.budget.slice(0, LIMITS.arrayItems)) : null;
      out.budget = true;
    }
    if (msg.health !== undefined) {
      entry.snap.health = cleanObject(msg.health);
      out.health = true;
    }
    if (isPlainObject(msg.repos)) {
      const repos = new Map();
      for (const [name, data] of Object.entries(msg.repos)) {
        if (!isRepoName(name)) { count('names'); continue; }
        if (repos.size >= LIMITS.repos) { count('repos'); continue; }
        repos.set(name, sanitize(data));
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
    const sessions = new Map();
    for (const raw of msg.sessions) {
      const s = cleanSession(raw, count);
      if (s) sessions.set(s.name, s);
    }
    const prev = entry.snap?.sessions ?? new Map();
    const removed = [...prev.keys()].filter((n) => !sessions.has(n));
    const changed = [...sessions.keys()];
    entry.snap = emptySnap();
    entry.snap.sessions = sessions;
    const out = { changed, removed };
    applyCommon(entry, msg, count, {});
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
    const sessions = entry.snap.sessions;
    const changed = [];
    const removed = [];
    const transitions = [];
    if (Array.isArray(msg.sessions)) {
      const n = msg.sessions.length;
      if (n > LIMITS.sessions) count('sessions', n - LIMITS.sessions);
      for (let i = 0; i < Math.min(n, LIMITS.sessions); i++) {
        const s = cleanSession(msg.sessions[i], count);
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
    applyCommon(entry, msg, count, flags);
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
    const snap = entry.snap;
    let out;
    let changed = [];
    if (type === 'event') {
      out = { type, event: cleanObject(msg.event) };
    } else if (type === 'health') {
      out = { type, health: cleanObject(msg.health) };
      if (snap) snap.health = out.health;
    } else if (type === 'approval') {
      if (msg.op !== 'open' && msg.op !== 'close') { count('messages'); return null; }
      const a = cleanApproval(msg.approval, count);
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
      const stuck = msg.stuck === null ? null : cleanObject(msg.stuck);
      out = { type, name: msg.name, stuck };
      const s = snap?.sessions.get(msg.name);
      if (s) { s.stuck = stuck; changed = [msg.name]; }
    } else {
      if (!isRepoName(msg.repo)) { count('names'); return null; }
      const data = msg.data === null || msg.data === undefined ? null : sanitize(msg.data);
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
          repos: e.repos,
          state,
          conn: { ...e.conn, state },
          hello: e.hello,
          versionSkew: e.versionSkew,
          clockSkewMs: e.clockSkewMs,
          seq: e.seq,
          snap: e.snap,
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
