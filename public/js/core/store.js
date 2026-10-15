// The client store: N builders behind one source (fleet F8a, plan §1 2.5).
//
// Pure reducers over a plain store object, importable by `node --test`. The
// page uses the `store` singleton below; tests make their own with
// createStore().
//
// Routing identity (security review S2): every session, lane, attention
// entry, event and approval is stamped with `builder`, `key` and `laneKey`
// computed from the FRAME-LEVEL builder id of the source/connection (the
// local source's hello id; in hub mode the hub's stamp from the upstream
// connection) and the local `name`/`lane`. Builder-supplied nested `key`,
// `laneKey`, `builder` and `fkey` fields are overwritten, never trusted.
//
// Key mode (bridge until the UI moves to fleet keys, F8b): `store.sessions`
// is the index the views read. With keyMode 'fkey' it is keyed by fleet key
// (the final shape). With keyMode 'name' (the page's default for now) it is
// keyed by local name, which is unambiguous because a local source carries
// exactly one builder; a hub source always switches to 'fkey'. F8b calls
// setKeyMode(store, 'fkey') once the views read `s.key`.
import { BUILDER_ID_RX, fkey, isFkey, parseFkey } from './keys.js';

/** Builder id used before the local source's hello names it. */
export const LOCAL_FALLBACK_ID = 'local';

/** BuilderRow.state (hub, §3 2.5) -> Builder.status. */
const ROW_STATE = {
  up: 'live', stale: 'stale', down: 'down', connecting: 'connecting',
  misconfigured: 'down', incompatible: 'stale',
};
/** Nested routing fields a builder may not choose (S2). */
const ROUTING_FIELDS = ['key', 'laneKey', 'builder', 'fkey'];

function validId(id) {
  return typeof id === 'string' && BUILDER_ID_RX.test(id);
}
function validName(n) {
  return typeof n === 'string' && n !== '';
}

/** A fresh, empty store. */
export function createStore({ keyMode = 'fkey', pinned = new Set() } = {}) {
  return {
    builders: new Map(),   // id -> Builder
    sessions: new Map(),   // index: fkey (or local name in keyMode 'name') -> Session; written only by reducers
    lanes: [],             // derived: every builder's lanes, each with .key and .builder
    attention: [],         // derived: merged, live first, score desc, since asc
    alarms: [],
    packages: null,
    hub: null,
    aggregates: null,
    map: null,             // the Map's model, from `map` messages
    vitals: null,          // the primary builder's (local source: the only one)
    box: null,             // ditto: lane records, PRs, slots, readiness, jobs
    generatedAt: 0,
    connected: false,
    // Which lanes the grid is filtered to. Empty = show everything.
    //
    // UI-local by design (lanes plan hard rule 5): not on the server, not in
    // SQLite, not in localStorage. A filter you forgot you set is a board that
    // lies to you, and this board's whole job is to be believed.
    laneFilter: new Set(),
    builderFilter: 'all',
    cursor: null,          // index key the keyboard is on
    pinned,                // Set of index keys, persisted
    dockLayout: null,      // null = auto (stacked for 1-2 pins, 2x2 for 3-4)
    openSession: null,     // index key shown in the sheet
    view: 'board',
    /** Set when the box payload changed, so lane heads and the Box re-render. */
    boxDirty: true,
    keyMode,
    source: { kind: 'local', status: 'connecting', id: null, code: null, hello: null },
    listeners: new Set(),
  };
}

// ---------------------------------------------------------------- the page's store

export const store = createStore({ keyMode: 'name', pinned: loadPinned() });

export function loadPinned(localId) {
  try {
    const raw = localStorage.getItem('laneboard.pinned');
    if (raw === null) return new Set();
    if (localId) return new Set(migratePins(raw, localId));
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}
export function savePinned() {
  try { localStorage.setItem('laneboard.pinned', JSON.stringify([...store.pinned])); } catch { /* private mode */ }
}

/**
 * Legacy pins (local names) -> fleet keys of the local builder. Entries that
 * already are fleet keys are kept: a legacy local name never contains '/'
 * (isSafeSessionName refuses it), so a slash means it is already migrated.
 */
export function migratePins(rawLegacyJson, localId) {
  let list;
  try { list = JSON.parse(rawLegacyJson); } catch { return []; }
  if (!Array.isArray(list) || !validId(localId)) return [];
  const out = [];
  for (const p of list) {
    if (!validName(p)) continue;
    const k = isFkey(p) ? p : fkey(localId, p);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------- keys

/** The id of the local source's builder (hello), or the fallback. */
export function localBuilderId(s = store) {
  return s.source.id ?? LOCAL_FALLBACK_ID;
}

/** The `store.sessions` key for a builder's local session name. */
export function indexKey(s, builderId, name) {
  return s.keyMode === 'name' ? name : fkey(builderId, name);
}

/** The `store.sessions` key of a stamped session. */
export function sessionKey(s, session) {
  return s.keyMode === 'name' ? session.name : session.key;
}

/**
 * Any key the UI holds (fleet key, or a local name in keyMode 'name') -> the
 * index key, or null. Used for deep links: `sel` is always a fleet key.
 */
export function toIndexKey(s, k) {
  if (!validName(k)) return null;
  if (s.sessions.has(k)) return k;
  const p = parseFkey(k);
  if (!p) return null;
  if (s.keyMode === 'name') return p.builder === localBuilderId(s) ? p.name : null;
  return k;
}

/** The session behind a key, looked up in the per-builder maps. */
export function sessionFor(s, k) {
  const hit = s.sessions.get(k);
  if (hit) return hit;
  const p = parseFkey(k);
  if (!p) return null;
  return s.builders.get(p.builder)?.sessions.get(p.name) ?? null;
}

// ---------------------------------------------------------------- builders

function newBuilder(id) {
  return {
    id, code: null, mode: null, version: null, status: 'connecting',
    lastMsgAt: 0, sessions: new Map(), lanes: [], box: null, vitals: null,
    attention: [], generatedAt: 0, host: null,
    health: null, approvals: new Map(), repos: new Map(), budget: null,
    stale: false, ageMs: 0, controls: true, capabilities: [], directUrl: null,
    latencyMs: null, versionSkew: null, state: null,
  };
}

function builderFor(s, id) {
  let b = s.builders.get(id);
  if (!b) {
    b = newBuilder(id);
    if (s.source.kind === 'local') b.status = s.source.status === 'open' ? 'live' : 'connecting';
    s.builders.set(id, b);
  }
  return b;
}

/**
 * Which builder a frame belongs to. Local source: always the source's own
 * builder (its hello id), whatever the frame says. Hub source: the frame-level
 * `builder` the hub stamped from the upstream connection; a frame without a
 * valid one is not builder-scoped.
 */
function routeOf(s, msg) {
  if (s.source.kind === 'hub') return validId(msg.builder) ? msg.builder : null;
  if (s.source.id) return s.source.id;
  return validId(msg.builder) ? msg.builder : LOCAL_FALLBACK_ID;
}

function stripRouting(obj) {
  const o = { ...obj };
  for (const f of ROUTING_FIELDS) delete o[f];
  return o;
}

function stampSession(id, raw) {
  if (!raw || typeof raw !== 'object' || !validName(raw.name)) return null;
  const s = stripRouting(raw);
  s.builder = id;
  s.key = fkey(id, raw.name);
  s.laneKey = validName(raw.lane) ? fkey(id, raw.lane) : null;
  return s;
}

function stampLane(id, raw) {
  if (!raw || typeof raw !== 'object' || !validName(raw.id)) return null;
  const l = stripRouting(raw);
  l.builder = id;
  l.key = fkey(id, raw.id);
  return l;
}

function stampAttention(id, raw) {
  if (!raw || typeof raw !== 'object' || !validName(raw.name)) return null;
  const a = stripRouting(raw);
  a.builder = id;
  a.key = fkey(id, raw.name);
  return a;
}

function stampApproval(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = stripRouting(raw);
  a.builder = id;
  a.key = validName(raw.name) ? fkey(id, raw.name) : null;
  return a;
}

function stampAll(list, id, fn) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const v = fn(id, raw);
    if (v) out.push(v);
  }
  return out;
}

/** Live entries first, then score desc, since asc (server/state.mjs order), then builder. */
export function attentionOrder(a, b) {
  return (a.stale ? 1 : 0) - (b.stale ? 1 : 0)
    || (b.score ?? 0) - (a.score ?? 0)
    || (a.since ?? 0) - (b.since ?? 0)
    || (a.builder < b.builder ? -1 : a.builder > b.builder ? 1 : 0);
}

/** The builder whose box/vitals fill `store.box`/`store.vitals`. */
function primaryBuilder(s) {
  if (s.source.kind === 'local') return s.builders.get(localBuilderId(s)) ?? s.builders.values().next().value ?? null;
  return s.builders.size === 1 ? s.builders.values().next().value : null;
}

/** Recompute everything derived from the per-builder records. */
function derive(s) {
  const lanes = [];
  const attention = [];
  let generatedAt = 0;
  for (const b of s.builders.values()) {
    lanes.push(...b.lanes);
    const stale = b.status === 'stale' || b.status === 'down';
    for (const a of b.attention) attention.push(stale ? { ...a, stale: true } : a);
    if (b.generatedAt > generatedAt) generatedAt = b.generatedAt;
  }
  attention.sort(attentionOrder);
  s.lanes = lanes;
  s.attention = attention;
  if (generatedAt) s.generatedAt = generatedAt;
  const p = primaryBuilder(s);
  const box = p ? p.box : null;
  if (box !== s.box) { s.box = box; s.boxDirty = true; }
  s.vitals = p ? p.vitals : null;
}

/** Rebuild the whole session index (key mode change, builder removed). */
function reindex(s) {
  s.sessions.clear();
  for (const b of s.builders.values()) {
    for (const sess of b.sessions.values()) s.sessions.set(sessionKey(s, sess), sess);
  }
}

function dropIndexOf(s, b) {
  for (const sess of b.sessions.values()) {
    const k = sessionKey(s, sess);
    if (s.sessions.get(k) === sess) s.sessions.delete(k);
  }
}

/** The optional per-builder fields of a snapshot or delta. */
function applyCommon(s, b, msg) {
  if (msg.lanes) b.lanes = stampAll(msg.lanes, b.id, stampLane);
  if (msg.attention) b.attention = stampAll(msg.attention, b.id, stampAttention);
  if (msg.vitals) {
    b.vitals = msg.vitals;
    if (typeof msg.vitals.host === 'string') b.host = msg.vitals.host;
  }
  if (msg.box !== undefined) b.box = msg.box;
  if (typeof msg.generatedAt === 'number' && msg.generatedAt) b.generatedAt = msg.generatedAt;
  if (Array.isArray(msg.approvals)) {
    b.approvals = new Map();
    for (const a of stampAll(msg.approvals, b.id, stampApproval)) if (validName(a.id)) b.approvals.set(a.id, a);
  }
  if (msg.health !== undefined && msg.health !== null) b.health = msg.health;
  if (msg.budget !== undefined) b.budget = msg.budget;
  if (typeof msg.stale === 'boolean') b.stale = msg.stale;
  if (typeof msg.ageMs === 'number') b.ageMs = msg.ageMs;
}

/** A full snapshot for one builder: its sessions are replaced. */
export function applySnapshot(s, builderId, msg) {
  if (!validId(builderId)) return null;
  const b = builderFor(s, builderId);
  dropIndexOf(s, b);
  b.sessions = new Map();
  for (const sess of stampAll(msg.sessions, builderId, stampSession)) b.sessions.set(sess.name, sess);
  for (const sess of b.sessions.values()) s.sessions.set(sessionKey(s, sess), sess);
  applyCommon(s, b, msg);
  derive(s);
  return { type: 'snapshot', builder: builderId, changed: null };
}

/** A delta for one builder: upserts by name, removals by fkey(builder, name). */
export function applyDelta(s, builderId, msg) {
  if (!validId(builderId)) return null;
  const b = builderFor(s, builderId);
  const changed = [];
  for (const sess of stampAll(msg.sessions, builderId, stampSession)) {
    const old = b.sessions.get(sess.name);
    if (old) s.sessions.delete(sessionKey(s, old));
    b.sessions.set(sess.name, sess);
    const k = sessionKey(s, sess);
    s.sessions.set(k, sess);
    changed.push(k);
  }
  for (const n of Array.isArray(msg.removed) ? msg.removed : []) {
    if (!validName(n)) continue;
    const old = b.sessions.get(n);
    b.sessions.delete(n);
    const k = indexKey(s, builderId, n);
    if (!old || s.sessions.get(k) === old) s.sessions.delete(k);
  }
  applyCommon(s, b, msg);
  derive(s);
  return { type: 'delta', builder: builderId, changed: Array.isArray(msg.sessions) ? changed : null };
}

/** The hub's `fleet` rows: one Builder per row; builders not listed are dropped. */
export function applyBuilders(s, list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  for (const row of list) {
    if (!row || typeof row !== 'object' || !validId(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    const b = builderFor(s, row.id);
    if (typeof row.code === 'string') b.code = row.code;
    b.state = typeof row.state === 'string' ? row.state : null;
    b.status = ROW_STATE[row.state] ?? 'down';
    b.stale = b.status !== 'live';
    if (typeof row.ageMs === 'number') b.ageMs = row.ageMs;
    b.latencyMs = typeof row.latencyMs === 'number' ? row.latencyMs : null;
    b.version = typeof row.version === 'string' ? row.version : null;
    b.versionSkew = typeof row.versionSkew === 'string' ? row.versionSkew : null;
    b.controls = row.controls === true;
    b.capabilities = Array.isArray(row.capabilities) ? row.capabilities.filter((c) => typeof c === 'string') : [];
    b.directUrl = typeof row.directUrl === 'string' ? row.directUrl : null;
  }
  for (const [id, b] of [...s.builders]) {
    if (seen.has(id)) continue;
    dropIndexOf(s, b);
    s.builders.delete(id);
  }
  derive(s);
  return { type: 'fleet', changed: null };
}

/** The local source's hello: names the one builder of this source. */
function applyHello(s, msg) {
  if (s.source.kind === 'hub') return null;
  const id = validId(msg.builder?.id) ? msg.builder.id : null;
  if (!id) return null;
  s.source.id = id;
  s.source.code = typeof msg.builder.code === 'string' ? msg.builder.code : null;
  // Data held under another id (the fallback before hello) belongs to this
  // builder now; the snapshot that follows hello replaces it anyway.
  for (const [other, b] of [...s.builders]) {
    if (other === id) continue;
    dropIndexOf(s, b);
    s.builders.delete(other);
  }
  const b = builderFor(s, id);
  b.code = s.source.code;
  b.mode = typeof msg.mode === 'string' ? msg.mode : null;
  b.version = typeof msg.version === 'string' ? msg.version : null;
  derive(s);
  return { type: 'hello', builder: id };
}

/** The richer GET /api/v1/hello (capabilities, live tier table). */
export function setHello(s, hello) {
  if (!hello || typeof hello !== 'object') return;
  s.source.hello = {
    capabilities: Array.isArray(hello.capabilities) ? hello.capabilities.filter((c) => typeof c === 'string') : [],
    actions: hello.actions && typeof hello.actions === 'object' ? { ...hello.actions } : {},
    mode: typeof hello.mode === 'string' ? hello.mode : null,
  };
  if (s.source.kind === 'local') {
    const b = s.builders.get(localBuilderId(s));
    if (b) b.capabilities = s.source.hello.capabilities;
  }
}

/**
 * One message from the source. Returns what changed ({type, builder?,
 * changed?, event?}) or null when the message was dropped.
 */
export function ingest(s, msg, now = Date.now()) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
  let out = null;
  if (msg.type === 'hello') out = applyHello(s, msg);
  else if (msg.type === 'fleet') {
    s.hub = msg.hub && typeof msg.hub === 'object' ? msg.hub : null;
    s.aggregates = msg.aggregates ?? null;
    out = applyBuilders(s, msg.builders);
  } else if (msg.type === 'map') {
    s.map = msg.map ?? null;
    out = { type: 'map' };
  } else if (msg.type === 'alarms') {
    s.alarms = Array.isArray(msg.alarms) ? msg.alarms : [];
    out = { type: 'alarms' };
  } else if (msg.type === 'packages') {
    s.packages = msg.data ?? null;
    out = { type: 'packages' };
  } else if (msg.type === 'pong') {
    out = { type: 'pong' };
  } else {
    const id = routeOf(s, msg);
    if (!id) return null;
    out = ingestScoped(s, id, msg);
    if (out) builderFor(s, id).lastMsgAt = now;
  }
  if (out) notify(s, out);
  return out;
}

function ingestScoped(s, id, msg) {
  switch (msg.type) {
    case 'snapshot': return applySnapshot(s, id, msg);
    case 'delta': return applyDelta(s, id, msg);
    case 'event': {
      if (!msg.event || typeof msg.event !== 'object') return null;
      const event = stripRouting(msg.event);
      event.builder = id;
      event.key = validName(event.session_name) ? fkey(id, event.session_name) : null;
      return { type: 'event', builder: id, event };
    }
    case 'health': {
      builderFor(s, id).health = msg.health ?? null;
      return { type: 'health', builder: id };
    }
    case 'approval': {
      const b = builderFor(s, id);
      const a = stampApproval(id, msg.approval);
      if (!a || !validName(a.id)) return null;
      if (msg.op === 'close') b.approvals.delete(a.id);
      else b.approvals.set(a.id, a);
      return { type: 'approval', builder: id, approval: a };
    }
    case 'stuck': {
      const b = builderFor(s, id);
      if (!validName(msg.name)) return null;
      const old = b.sessions.get(msg.name);
      if (!old) return { type: 'stuck', builder: id, changed: [] };
      const sess = { ...old, stuck: msg.stuck ?? null };
      b.sessions.set(sess.name, sess);
      const k = sessionKey(s, sess);
      s.sessions.set(k, sess);
      return { type: 'stuck', builder: id, changed: [k] };
    }
    case 'repos': {
      if (!validName(msg.repo)) return null;
      builderFor(s, id).repos.set(msg.repo, msg.data ?? null);
      return { type: 'repos', builder: id };
    }
    default: return null;
  }
}

/** Which source feeds the store. A hub always keys by fleet key. */
export function setSourceKind(s, kind) {
  s.source.kind = kind === 'hub' ? 'hub' : 'local';
  if (s.source.kind === 'hub') {
    s.source.id = null;
    setKeyMode(s, 'fkey');
  }
}

/** The source's connection status. A local source's builder mirrors it. */
export function setSourceStatus(s, status) {
  if (!['connecting', 'open', 'closed'].includes(status)) return;
  s.source.status = status;
  s.connected = status === 'open';
  if (s.source.kind === 'local') {
    const mirrored = status === 'open' ? 'live' : status === 'closed' ? 'down' : 'connecting';
    for (const b of s.builders.values()) b.status = mirrored;
    derive(s);
  }
  notify(s, { type: 'status', status });
}

/**
 * Switch the index between local names and fleet keys. The cursor, the open
 * sheet and the pins follow; the lane filter is cleared (it is UI-local).
 */
export function setKeyMode(s, mode) {
  const next = mode === 'name' ? 'name' : 'fkey';
  if (s.keyMode === next) return;
  const id = localBuilderId(s);
  const conv = (k) => {
    if (!validName(k)) return null;
    if (next === 'fkey') return isFkey(k) ? k : (validId(id) ? fkey(id, k) : null);
    const p = parseFkey(k);
    return p && p.builder === id ? p.name : null;
  };
  s.keyMode = next;
  s.cursor = conv(s.cursor);
  s.openSession = conv(s.openSession);
  s.pinned = new Set([...s.pinned].map(conv).filter(Boolean));
  s.laneFilter = new Set();
  reindex(s);
}

// ---------------------------------------------------------------- selectors

/** Every builder, by id. */
export function builders(s = store) {
  return [...s.builders.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lanes of every builder ('all') or of one builder id. */
export function lanes(s = store, scope = 'all') {
  if (scope === 'all' || scope === undefined || scope === null) return s.lanes;
  return s.lanes.filter((l) => l.builder === scope);
}

export function alarms(s = store) {
  return s.alarms;
}

/** Run fn(change, store) after every reducer change. Returns an unsubscribe. */
export function subscribe(fn, s = store) {
  s.listeners.add(fn);
  return () => { s.listeners.delete(fn); };
}

function notify(s, change) {
  for (const fn of [...s.listeners]) {
    try { fn(change, s); } catch { /* a listener never breaks ingest */ }
  }
}

// ---------------------------------------------------------------- lane helpers (UI)

/** Lane key (fkey, or lane id in keyMode 'name') -> the lane object. */
export function laneById(id) {
  if (!id) return null;
  return store.lanes.find((l) => l.key === id) ?? store.lanes.find((l) => l.id === id) ?? null;
}

/** Is this session shown under the current lane filter? */
export function laneVisible(s) {
  if (!store.laneFilter.size) return true;
  const k = store.keyMode === 'name' ? s.lane : s.laneKey;
  return Boolean(k) && store.laneFilter.has(k);
}

