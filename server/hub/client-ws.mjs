// The hub's /ws to browsers (fleet plan §3 2.5, task H7).
//
// Same vocabulary as server/ws.mjs, with every builder-scoped frame carrying
// `builder`. Session names stay local; fleet keys (`key`, `laneKey`) are
// recomputed here from the store's builder id, never taken from builder data
// (the store already strips builder-supplied routing fields, S2).
//
// On connect, after the upgrade guard (Host + Origin from server/security.mjs,
// then the connection kind: `direct` with a Tailscale-User-Login, or `local`):
//   1. {type:'fleet', hub:{version, now}, builders:[BuilderRow], aggregates}
//   2. one {type:'snapshot', builder, ...} per builder in the client's scope
//   3. {type:'map', map}
//
// Browser -> hub: `scope`, `visible`, `ping`; any other type goes to the
// handlers registered with onClientMessage(type, fn(msg, {user, kind, readOnly,
// control}), opts?), and is dropped when there is none. A control message
// (CONTROL_MESSAGES, e.g. `touch`, or a type registered with {control:true})
// reaches its handlers only from a direct user with control (relay.mjs
// remoteUser: not `local`, not read-only; SR13 L3); otherwise it is dropped.
//
// Hub -> browser fan-out:
// - store `delta` events accumulate per builder (sessions by name, removals,
//   lanes/box/vitals/attention flags) and every `batchMs` each non-empty
//   accumulator becomes one `delta`, serialized ONCE and sent to every client
//   whose scope contains that builder. Session data is read from the store at
//   flush time, so the last write wins.
// - `previewLines` is kept only for sessions in some client's visible set.
//   `previewHtml` never leaves the hub (the store drops it; wire() drops it
//   again).
// - `event`/`approval`/`stuck`/`health`/`repos` pass through at once.
// - `fleet` goes out when a row or an aggregate changes, at most once per
//   `fleetMinMs` (1 s). The store's view() deep-clones, so it is computed at
//   most once per tick and cached until the store changes.
// - every frame is <= maxFrameBytes (512 KB): a larger snapshot or batch is
//   split into a session-less snapshot plus deltas of <= 100 sessions each.
// - a client whose bufferedAmount exceeds maxBufferedBytes (4 MB) is
//   terminated; its reconnect gets a fresh snapshot.
import { WebSocketServer } from 'ws';
import { BUILDER_ID_RX, fkey, parseFkey } from '../fleet/keys.mjs';
import { checkUpgrade, warnRateLimited } from '../security.mjs';
import { aggregates as defaultAggregates } from './aggregates.mjs';
import { isSafeName, snapshotOf } from './fleet-store.mjs';
import { log as defaultLog } from '../log.mjs';
import { remoteUser } from './relay.mjs';

export const LIMITS = Object.freeze({
  frameBytes: 512 * 1024,
  sessionsPerFrame: 100,
  bufferedBytes: 4 * 1024 * 1024,
  visibleKeys: 128, // per client, browser -> hub
  visibleUpstream: 64, // per builder, hub -> builder
  visibleDebounceMs: 500,
  fleetMinMs: 1000,
  inboundBytes: 64 * 1024,
  inboundPerSec: 50,
  scopeIds: 64,
  clients: 200,
  userChars: 256,
});

/** Types the hub handles itself; onClientMessage cannot take them over. */
const RESERVED = new Set(['scope', 'visible', 'ping', 'pong']);
/** Browser messages that change hub state: only a direct user with control may send them (SR13 L3). */
export const CONTROL_MESSAGES = Object.freeze(['touch']);
const TYPE_RX = /^[a-z][a-z0-9-]{0,31}$/;
const USER_RX = /^[^\s\x00-\x1f\x7f]{1,256}$/;
const PASS_THROUGH = new Set(['event', 'approval', 'stuck', 'health', 'repos']);

const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

function header(req, name) {
  const v = req?.headers?.[name];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

function safeFkey(id, name) {
  if (typeof name !== 'string' || name === '') return null;
  try { return fkey(id, name); } catch { return null; }
}

/**
 * Connection kind for a hub /ws upgrade when the boot path did not set
 * `req.auth` (§2 auth.classify replaces this once it exists):
 * - a request carrying a read signature is `hub` kind (refused on /ws);
 * - on the ingress listener (`fleet.ingressPort`) a valid Tailscale-User-Login
 *   makes it `direct`, anything else is unidentified (refused);
 * - the non-ingress loopback listener is `local`, user `local`.
 * `fleet.allowedUsers`, when non-empty, restricts `direct` users.
 */
export function defaultClassify(req, config = {}) {
  const f = (config && typeof config.fleet === 'object' && config.fleet) || {};
  if (header(req, 'x-laneboard-sig') !== undefined) return { kind: 'hub', user: null };
  const ingress = isPort(f.ingressPort) && req?.socket?.localPort === f.ingressPort;
  if (!ingress) return { kind: 'local', user: 'local' };
  const user = header(req, 'tailscale-user-login');
  if (typeof user !== 'string' || !USER_RX.test(user)) return { kind: 'unidentified', user: null };
  const allowed = Array.isArray(f.allowedUsers) ? f.allowedUsers.filter((u) => typeof u === 'string') : [];
  if (allowed.length && !allowed.includes(user)) return { kind: 'unidentified', user: null };
  return { kind: 'direct', user };
}

/**
 * null when the upgrade may proceed, else a reason. Host and Origin from
 * server/security.mjs first; then the kind (only `direct`/`local` on /ws);
 * `direct` needs an Origin (browsers always send one) and, if present, a
 * `Sec-Fetch-Site` of `same-origin` or `none`.
 */
export function guardUpgrade(req, config, classify) {
  const bad = checkUpgrade(req, config);
  if (bad) return { reason: bad };
  let auth = req.auth && typeof req.auth === 'object' ? req.auth : null;
  if (!auth) {
    try { auth = classify(req); } catch { auth = null; }
  }
  if (!auth || (auth.kind !== 'direct' && auth.kind !== 'local')) return { reason: 'kind' };
  if (auth.kind === 'direct') {
    if (header(req, 'origin') === undefined) return { reason: 'no-origin' };
    const sfs = header(req, 'sec-fetch-site');
    if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') return { reason: 'sec-fetch-site' };
  }
  const user = auth.kind === 'local' ? (typeof auth.user === 'string' && auth.user ? auth.user : 'local') : auth.user;
  if (typeof user !== 'string' || !USER_RX.test(user)) return { reason: 'user' };
  return { auth: { kind: auth.kind, user, readOnly: auth.readOnly === true } };
}

function refuse(socket, status = '403 Forbidden') {
  try {
    socket.once('finish', () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    socket.destroy();
  }
}

const byteLen = (s) => Buffer.byteLength(s, 'utf8');

/** `{"a":1}` + `,"sessions":[...]}`: append a sessions array to a serialized object. */
function withSessions(baseJson, sessionStrs) {
  const head = baseJson.slice(0, -1);
  const sep = head.endsWith('{') ? '' : ',';
  return `${head}${sep}"sessions":[${sessionStrs.join(',')}]}`;
}

/**
 * createClientWs(opts) -> { handleUpgrade, broadcast, sendMap, onClientMessage,
 *   visibleKeys, clientCount, flush, checkFleet, stats, close }
 *
 * opts: store (fleet-store), config (merged config: port, publicUrl, fleet.*),
 * version (hub version for `fleet.hub.version`), now, batchMs, getMap,
 * aggregates, classify(req) -> {kind, user}, onVisible(builderId, fkeys),
 * log, heartbeatMs, and the LIMITS overrides fleetMinMs, visibleDebounceMs,
 * maxFrameBytes, maxBufferedBytes, sessionsPerFrame.
 */
export function createClientWs({
  store,
  config = {},
  version = null,
  now = Date.now,
  batchMs = config?.fleet?.batchMs ?? 250,
  getMap = null,
  aggregates = defaultAggregates,
  classify = null,
  onVisible = null,
  log = defaultLog,
  heartbeatMs = 30_000,
  fleetMinMs = LIMITS.fleetMinMs,
  visibleDebounceMs = LIMITS.visibleDebounceMs,
  maxFrameBytes = LIMITS.frameBytes,
  maxBufferedBytes = LIMITS.bufferedBytes,
  sessionsPerFrame = LIMITS.sessionsPerFrame,
} = {}) {
  if (!store || typeof store.subscribe !== 'function') throw new TypeError('client-ws: store required');
  const classifyFn = classify ?? ((req) => defaultClassify(req, config));
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.inboundBytes });
  const clients = new Set();
  const handlers = new Map(); // type -> Set<fn>
  const controlTypes = new Set(CONTROL_MESSAGES);
  const counters = { dropped: 0, oversize: 0, terminated: 0, handlerErrors: 0, refused: 0, inboundDropped: 0, controlRefused: 0 };
  let lastMap = null;
  let closed = false;

  const warn = (reason, detail) => warnRateLimited((r, d) => log?.warn?.(`hub ws: ${r}`, d ?? ''), `hub-ws-${reason}`, detail);

  // --- cached view (view() deep-clones: at most once per tick) --------------
  let viewCache = null;
  let viewDirty = true;
  function getView() {
    const t = now();
    if (!viewCache || viewDirty || t - viewCache.now >= batchMs) {
      viewCache = store.view(t);
      viewDirty = false;
    }
    return viewCache;
  }
  function rowState(id) {
    const b = getView().builders.find((x) => x.id === id);
    return b ? { stale: b.stale, ageMs: b.ageMs } : { stale: true, ageMs: null };
  }

  // --- visibility -------------------------------------------------------------
  /** builderId -> Set<name>: the union of every client's visible set. */
  let visibleUnion = new Map();
  const upstreamSent = new Map(); // builderId -> JSON of last keys sent upstream
  let visibleTimer = null;

  function isVisible(id, name) {
    return visibleUnion.get(id)?.has(name) === true;
  }

  function recomputeVisible() {
    const next = new Map();
    for (const ws of clients) {
      for (const k of ws.visible) {
        const p = parseFkey(k);
        if (!p) continue;
        let set = next.get(p.builder);
        if (!set) next.set(p.builder, (set = new Set()));
        set.add(p.name);
      }
    }
    // Sessions that just became visible need their previewLines: queue them.
    for (const [id, set] of next) {
      const before = visibleUnion.get(id);
      for (const name of set) if (!before?.has(name)) markChanged(id, name);
    }
    visibleUnion = next;
    if (!visibleTimer && !closed) {
      visibleTimer = setTimeout(pushVisible, visibleDebounceMs);
      visibleTimer.unref?.();
    }
  }

  /** The fkeys sent upstream for one builder (<= 64, sorted). */
  function visibleKeys(id) {
    const set = visibleUnion.get(id);
    if (!set) return [];
    return [...set].sort().slice(0, LIMITS.visibleUpstream).map((n) => fkey(id, n));
  }

  function pushVisible() {
    visibleTimer = null;
    if (typeof onVisible !== 'function') return;
    const ids = new Set([...visibleUnion.keys(), ...upstreamSent.keys()]);
    for (const id of ids) {
      const keys = visibleKeys(id);
      const j = JSON.stringify(keys);
      if (upstreamSent.get(id) === j) continue;
      if (keys.length) upstreamSent.set(id, j);
      else upstreamSent.delete(id);
      try { onVisible(id, keys); } catch (err) { warn('onVisible failed', String(err?.message ?? err)); }
    }
  }

  // --- wire shapes ------------------------------------------------------------
  function wireSession(id, s) {
    const { previewLines, previewHtml: _h, preview: _p, ...rest } = s;
    rest.key = safeFkey(id, s.name);
    rest.laneKey = s.lane ? safeFkey(id, s.lane) : null;
    if (previewLines !== undefined && isVisible(id, s.name)) rest.previewLines = previewLines;
    return rest;
  }
  const wireLanes = (id, lanes) => (Array.isArray(lanes) ? lanes.map((l) => ({ ...l, key: safeFkey(id, l?.id) })) : lanes);
  const wireAttention = (id, att) => (Array.isArray(att) ? att.map((a) => ({ ...a, key: safeFkey(id, a?.name) })) : att);

  /**
   * Serialized frames for `base` (no sessions) plus `sessionStrs`. One frame
   * when it fits in maxFrameBytes; otherwise `base` with `sessions: []` (snapshot) or without
   * sessions (delta) and then deltas of <= sessionsPerFrame sessions, each
   * <= maxFrameBytes. Oversize parts are dropped and counted.
   */
  function pack(id, base, sessionStrs, { snapshot }) {
    const out = [];
    let baseObj = base;
    let baseJson = JSON.stringify(baseObj);
    const single = withSessions(baseJson, sessionStrs);
    if (byteLen(single) <= maxFrameBytes) return [single];

    // repos ride as individual `repos` messages when the base is too big.
    if (byteLen(baseJson) > maxFrameBytes && baseObj.repos && typeof baseObj.repos === 'object') {
      const { repos, ...rest } = baseObj;
      baseObj = rest;
      baseJson = JSON.stringify(baseObj);
      for (const [repo, data] of Object.entries(repos)) {
        const j = JSON.stringify({ type: 'repos', builder: id, repo, data });
        if (byteLen(j) <= maxFrameBytes) out.push(j);
        else { counters.oversize++; warn('oversize repos dropped', `${id}/${repo}`); }
      }
    }
    // Still too big: drop the largest replaceable fields until it fits.
    while (byteLen(baseJson) > maxFrameBytes) {
      let worst = null;
      let worstLen = 0;
      for (const [k, v] of Object.entries(baseObj)) {
        if (k === 'type' || k === 'builder' || v === null || typeof v !== 'object') continue;
        const l = byteLen(JSON.stringify(v));
        if (l > worstLen) { worst = k; worstLen = l; }
      }
      if (!worst) break;
      counters.oversize++;
      warn('oversize field dropped', `${id}.${worst} (${worstLen} bytes)`);
      baseObj = { ...baseObj };
      delete baseObj[worst];
      baseJson = JSON.stringify(baseObj);
    }
    if (byteLen(baseJson) > maxFrameBytes) { counters.oversize++; return out; }

    const head = snapshot ? withSessions(baseJson, []) : baseJson;
    const frames = [head];
    const prefix = `{"type":"delta","builder":${JSON.stringify(id)}}`;
    const overhead = byteLen(withSessions(prefix, []));
    let chunk = [];
    let size = overhead;
    const flushChunk = () => {
      if (chunk.length) frames.push(withSessions(prefix, chunk));
      chunk = [];
      size = overhead;
    };
    for (const s of sessionStrs) {
      const l = byteLen(s) + 1;
      if (overhead + l > maxFrameBytes) { counters.oversize++; warn('oversize session dropped', id); continue; }
      if (chunk.length >= sessionsPerFrame || size + l > maxFrameBytes) flushChunk();
      chunk.push(s);
      size += l;
    }
    flushChunk();
    // Snapshot first (so the browser replaces), then repos, then deltas.
    return [frames[0], ...out, ...frames.slice(1)];
  }

  function snapshotFrames(id) {
    const entry = store.builder(id);
    if (!entry) return [];
    const wire = snapshotOf(entry);
    const { stale, ageMs } = rowState(id);
    const base = {
      type: 'snapshot',
      builder: id,
      lanes: wireLanes(id, wire?.lanes ?? []),
      box: wire?.box ?? null,
      vitals: wire?.vitals ?? null,
      attention: wireAttention(id, wire?.attention ?? []),
      generatedAt: wire?.generatedAt ?? null,
      repos: wire?.repos ?? null,
      approvals: (wire?.approvals ?? []).map((a) => ({ ...a, builder: id, key: safeFkey(id, a?.name) })),
      budget: wire?.budget ?? null,
      health: wire?.health ?? null,
      stale,
      ageMs,
    };
    const sessionStrs = (wire?.sessions ?? []).map((s) => JSON.stringify(wireSession(id, s)));
    return pack(id, base, sessionStrs, { snapshot: true });
  }

  // --- sending ----------------------------------------------------------------
  function sendRaw(ws, data) {
    if (ws.readyState !== ws.OPEN) return false;
    if (ws.bufferedAmount > maxBufferedBytes) {
      counters.terminated++;
      warn('slow client terminated', `${ws.bufferedAmount} bytes buffered`);
      ws.terminate();
      clients.delete(ws);
      return false;
    }
    try { ws.send(data); } catch { return false; }
    return true;
  }
  function sendObj(ws, obj) {
    const j = JSON.stringify(obj);
    if (byteLen(j) > maxFrameBytes) { counters.oversize++; warn('oversize frame dropped', obj?.type); return false; }
    return sendRaw(ws, j);
  }
  const inScope = (ws, id) => ws.scope === 'all' || ws.scope.has(id);
  function fanOut(id, frames) {
    for (const ws of [...clients]) {
      if (id !== null && !inScope(ws, id)) continue;
      for (const f of frames) if (!sendRaw(ws, f)) break;
    }
  }

  /** Hub services (alarms, packages, ...): one frame to every client (in scope when it names a builder). */
  function broadcast(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
    const j = JSON.stringify(msg);
    if (byteLen(j) > maxFrameBytes) { counters.oversize++; warn('oversize broadcast dropped', msg.type); return false; }
    const id = typeof msg.builder === 'string' && BUILDER_ID_RX.test(msg.builder) ? msg.builder : null;
    fanOut(id, [j]);
    return true;
  }

  function sendMap(map) {
    lastMap = map ?? null;
    return broadcast({ type: 'map', map: lastMap });
  }
  const currentMap = () => {
    if (typeof getMap === 'function') {
      try { return getMap() ?? null; } catch { return lastMap; }
    }
    return lastMap;
  };

  // --- fleet ------------------------------------------------------------------
  function fleetMessage() {
    const v = getView();
    const builders = v.builders.map((b) => ({
      id: b.id,
      code: b.code,
      directUrl: b.directUrl,
      state: b.state,
      ageMs: b.ageMs,
      latencyMs: b.conn?.latencyMs ?? null,
      version: b.hello?.version ?? null,
      versionSkew: b.versionSkew,
      controls: b.state === 'up' && b.versionSkew !== 'major',
      capabilities: Array.isArray(b.hello?.capabilities) ? b.hello.capabilities : [],
    }));
    let agg = null;
    try { agg = aggregates(v, v.now); } catch (err) { warn('aggregates failed', String(err?.message ?? err)); }
    return { type: 'fleet', hub: { version: version ?? v.hubVersion ?? null, now: v.now }, builders, aggregates: agg };
  }
  /** Comparison key: everything but the clock-driven `now` and `ageMs`. */
  const fleetKey = (m) => JSON.stringify([m.builders.map(({ ageMs: _a, ...r }) => r), m.aggregates]);
  let lastFleetKey = null;
  let lastFleetAt = -Infinity;

  function checkFleet(force = false) {
    if (!clients.size) { lastFleetKey = null; return false; }
    const t = now();
    if (!force && t - lastFleetAt < fleetMinMs) return false;
    const m = fleetMessage();
    const k = fleetKey(m);
    if (!force && k === lastFleetKey) return false;
    lastFleetKey = k;
    lastFleetAt = t;
    broadcast(m);
    return true;
  }

  // --- delta accumulation -----------------------------------------------------
  /** builderId -> {snapshot, changed:Set, removed:Set, lanes, box, vitals, attention} */
  const acc = new Map();
  function accFor(id) {
    let a = acc.get(id);
    if (!a) {
      a = { snapshot: false, changed: new Set(), removed: new Set(), lanes: false, box: false, vitals: false, attention: false };
      acc.set(id, a);
    }
    return a;
  }
  function markChanged(id, name) {
    if (!store.builder(id)?.snap?.sessions?.has(name)) return;
    const a = accFor(id);
    a.changed.add(name);
    a.removed.delete(name);
  }

  function onStoreEvent(ev) {
    viewDirty = true;
    if (!ev || typeof ev.builder !== 'string') return;
    const id = ev.builder;
    if (ev.kind === 'snapshot') {
      const a = accFor(id);
      a.snapshot = true;
      a.changed.clear();
      a.removed.clear();
      return;
    }
    if (ev.kind === 'delta') {
      const a = accFor(id);
      for (const n of ev.removed ?? []) { a.changed.delete(n); a.removed.add(n); }
      for (const n of ev.changed ?? []) { a.removed.delete(n); a.changed.add(n); }
      for (const f of ['lanes', 'box', 'vitals', 'attention']) if (ev[f]) a[f] = true;
      return;
    }
    if (PASS_THROUGH.has(ev.kind) && ev.msg && typeof ev.msg === 'object') {
      if (!clients.size) return;
      const m = { ...ev.msg, type: ev.kind, builder: id };
      if (ev.kind === 'event' && m.event && typeof m.event === 'object') {
        m.event = { ...m.event, key: safeFkey(id, m.event.name) };
      } else if (ev.kind === 'approval' && m.approval) {
        m.approval = { ...m.approval, builder: id, key: safeFkey(id, m.approval.name) };
      } else if (ev.kind === 'stuck') {
        m.key = safeFkey(id, m.name);
      }
      const j = JSON.stringify(m);
      if (byteLen(j) > maxFrameBytes) { counters.oversize++; warn('oversize frame dropped', ev.kind); return; }
      fanOut(id, [j]);
    }
    // `conn` and anything else: picked up by the next fleet check.
  }

  /** One tick: every non-empty accumulator becomes frames, serialized once. */
  function flush() {
    const pending = [...acc.entries()];
    acc.clear();
    if (!clients.size) return 0;
    let sent = 0;
    for (const [id, a] of pending) {
      const entry = store.builder(id);
      if (!entry?.snap) continue;
      let frames;
      if (a.snapshot) {
        frames = snapshotFrames(id);
      } else {
        const snap = entry.snap;
        const strs = [];
        const removed = [...a.removed];
        for (const name of a.changed) {
          const s = snap.sessions.get(name);
          if (s) strs.push(JSON.stringify(wireSession(id, s)));
          else removed.push(name);
        }
        const base = { type: 'delta', builder: id, generatedAt: snap.generatedAt ?? null };
        if (removed.length) base.removed = removed;
        if (a.lanes) base.lanes = wireLanes(id, snap.lanes);
        if (a.box) base.box = snap.box;
        if (a.vitals) base.vitals = snap.vitals;
        if (a.attention) base.attention = wireAttention(id, snap.attention);
        if (!strs.length && !removed.length && !a.lanes && !a.box && !a.vitals && !a.attention) continue;
        frames = pack(id, base, strs, { snapshot: false });
      }
      if (frames.length) { fanOut(id, frames); sent += frames.length; }
    }
    return sent;
  }

  // --- client messages --------------------------------------------------------
  function setScope(ws, builders) {
    let next;
    if (builders === 'all') next = 'all';
    else if (Array.isArray(builders)) {
      next = new Set(builders.slice(0, LIMITS.scopeIds)
        .filter((b) => typeof b === 'string' && BUILDER_ID_RX.test(b) && store.builder(b)));
    } else return;
    const ids = store.list().map((e) => e.id);
    const entering = ids.filter((id) => (next === 'all' || next.has(id)) && !inScope(ws, id));
    ws.scope = next;
    for (const id of entering) {
      for (const f of snapshotFrames(id)) if (!sendRaw(ws, f)) return;
    }
  }

  function setVisible(ws, list) {
    if (!Array.isArray(list)) return;
    const keys = new Set();
    for (const k of list.slice(0, LIMITS.visibleKeys)) {
      const p = parseFkey(k);
      if (!p || !isSafeName(p.name) || !store.builder(p.builder)) continue;
      keys.add(k);
    }
    ws.visible = keys;
    recomputeVisible();
  }

  /** Register a handler for a browser message type. Returns an unsubscribe. */
  function onClientMessage(type, fn, { control = false } = {}) {
    if (typeof type !== 'string' || !TYPE_RX.test(type) || RESERVED.has(type)) throw new TypeError(`client-ws: cannot handle type ${type}`);
    if (typeof fn !== 'function') throw new TypeError('client-ws: handler must be a function');
    if (control === true) controlTypes.add(type);
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => { set.delete(fn); if (!set.size) handlers.delete(type); };
  }

  function onMessage(ws, raw, isBinary) {
    if (isBinary) return;
    const t = now();
    if (t - ws.rate.start >= 1000) { ws.rate.start = t; ws.rate.n = 0; }
    if (++ws.rate.n > LIMITS.inboundPerSec) { counters.inboundDropped++; return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'scope': setScope(ws, msg.builders); return;
      case 'visible': setVisible(ws, Array.isArray(msg.keys) ? msg.keys : msg.names); return;
      case 'ping': sendObj(ws, { type: 'pong', at: t }); return;
      default: break;
    }
    const set = handlers.get(msg.type);
    if (!set) return;
    const control = remoteUser({ kind: ws.kind, user: ws.user, readOnly: ws.readOnly }).ok;
    // SR13 L3: a read-only or local user cannot send a control message.
    if (controlTypes.has(msg.type) && !control) { counters.controlRefused++; return; }
    for (const fn of [...set]) {
      try {
        const r = fn(msg, { user: ws.user, kind: ws.kind, readOnly: ws.readOnly, control });
        if (r && typeof r.catch === 'function') r.catch(() => { counters.handlerErrors++; });
      } catch {
        counters.handlerErrors++;
      }
    }
  }

  // --- connections ------------------------------------------------------------
  function greet(ws) {
    sendObj(ws, fleetMessage());
    for (const e of store.list()) {
      if (!inScope(ws, e.id)) continue;
      for (const f of snapshotFrames(e.id)) if (!sendRaw(ws, f)) return;
    }
    sendObj(ws, { type: 'map', map: currentMap() });
  }

  /**
   * The /ws upgrade (H11 routes `/ws` here). Always handles the socket: a
   * refused upgrade gets a 403 status line. Returns true.
   */
  function handleUpgrade(req, socket, head) {
    if (closed) { refuse(socket, '503 Service Unavailable'); return true; }
    const g = guardUpgrade(req, config, classifyFn);
    if (!g.auth) {
      counters.refused++;
      warn(`refused upgrade (${g.reason})`, `origin=${JSON.stringify(String(req.headers?.origin ?? '').slice(0, 80))}`);
      refuse(socket);
      return true;
    }
    if (clients.size >= LIMITS.clients) { refuse(socket, '503 Service Unavailable'); return true; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (closed) { ws.terminate(); return; }
      ws.user = g.auth.user;
      ws.kind = g.auth.kind;
      ws.readOnly = g.auth.readOnly === true;
      ws.scope = 'all';
      ws.visible = new Set();
      ws.isAlive = true;
      ws.rate = { start: now(), n: 0 };
      clients.add(ws);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw, isBinary) => onMessage(ws, raw, isBinary));
      const gone = () => {
        if (!clients.delete(ws)) return;
        if (ws.visible.size) recomputeVisible();
      };
      ws.on('close', gone);
      ws.on('error', gone);
      greet(ws);
    });
    return true;
  }

  // --- timers -----------------------------------------------------------------
  const unsubscribe = store.subscribe(onStoreEvent);
  const tick = setInterval(() => {
    flush();
    checkFleet();
  }, batchMs);
  tick.unref?.();
  const heartbeat = setInterval(() => {
    for (const ws of [...clients]) {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    clearInterval(heartbeat);
    if (visibleTimer) clearTimeout(visibleTimer);
    unsubscribe();
    for (const ws of clients) {
      try { ws.close(1001, 'hub shutting down'); } catch { /* gone */ }
      setTimeout(() => ws.terminate(), 500).unref?.();
    }
    clients.clear();
    wss.close();
  }

  return {
    handleUpgrade,
    broadcast,
    sendMap,
    onClientMessage,
    visibleKeys,
    clientCount: () => clients.size,
    flush,
    checkFleet,
    stats: () => ({ clients: clients.size, ...counters }),
    close,
  };
}
