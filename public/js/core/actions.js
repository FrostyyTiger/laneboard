// act(): every action the UI sends (fleet F8a, plan §1 2.5, README §3.5).
//
// The address is resolved from the STORE ENTRY of the key (its `builder`,
// stamped by the store from the frame-level builder of the connection, and its
// local `name`), never from a field the builder sent (security review S2).
//
// Transport, chosen per call:
// - hub source -> hubAct: POST /api/fleet/actions {builder, action, target, args}
// - local source whose /api/v1/hello lists the `actions` capability ->
//   POST /api/v1/actions with an unsigned envelope (via 'direct')
// - otherwise the legacy REST routes (before §2 A8 lands)
//
// Results are {ok, result|error, code?, auditId?}; a timeout returns
// {ok:'unknown'} (the UI says "sent, outcome unknown"; never retried).
import { isFkey, parseFkey } from './keys.js';
import { localBuilderId, store } from './store.js';

/** Fallback copy of the README §3.5 tier table; the live one is hello.actions. */
export const ACTION_TIERS = Object.freeze({
  'send-text': 'click',
  'send-keys': 'click',
  interrupt: 'click',
  kill: 'confirm',
  restart: 'confirm',
  spawn: 'ask',
  launch: 'ask',
  retire: 'confirm',
  term: 'click',
  pause: 'click',
  resume: 'click',
  approve: 'click',
  deny: 'click',
  release: 'click',
  'set-budget': 'ask',
  'ack-alarm': 'click',
  'send-review': 'ask',
  'run-script': 'ask',
  broadcast: 'confirm',
  'dismiss-marker': 'click',
});

const TIERS = new Set(['read', 'click', 'ask', 'confirm']);
const ACTION_RX = /^[a-z][a-z-]{0,31}$/;
export const ACTION_TIMEOUT_MS = 20000;

/** The tier of an action: the live hello table first, then the fallback. */
export function tierOf(action, s) {
  s ||= store;
  if (typeof action !== 'string') return 'confirm';
  // Own keys only: `constructor`, `__proto__`, `toString` ... are not
  // actions and must not resolve to an inherited member (SR8 L1).
  const table = s.source.hello?.actions;
  const live = table && typeof table === 'object' && Object.hasOwn(table, action) ? table[action] : undefined;
  if (TIERS.has(live)) return live;
  return Object.hasOwn(ACTION_TIERS, action) ? ACTION_TIERS[action] : 'confirm';
}

/**
 * True for a name that would collapse a URL path segment once encoded:
 * encodeURIComponent leaves '.' and '..' as they are, and URL parsing then
 * drops or pops the segment (SR8 L2). Such names never go into a path.
 */
export function isDotSegment(name) {
  return name === '.' || name === '..';
}

/**
 * Key -> {builder, target} from the store, or {error}. `*` is the fleet (hub)
 * or the local builder. A session key resolves through its store entry; any
 * other fleet key (a lane, a marker) must name a builder the store knows.
 */
export function resolveTarget(s, k) {
  const hub = s.source.kind === 'hub';
  if (k === '*') return hub ? { builder: '*', target: '*' } : { builder: localBuilderId(s), target: '*' };
  if (typeof k !== 'string' || k === '') return { error: 'bad-target' };
  const entry = s.sessions.get(k);
  if (entry && typeof entry.builder === 'string' && typeof entry.name === 'string') {
    return { builder: entry.builder, target: entry.name };
  }
  const p = parseFkey(k);
  if (p) {
    const b = s.builders.get(p.builder);
    if (!b) return { error: 'unknown-builder' };
    if (!hub && p.builder !== localBuilderId(s)) return { error: 'unknown-builder' };
    const sess = b.sessions.get(p.name);
    return { builder: b.id, target: sess ? sess.name : p.name };
  }
  // A bare local name (keyMode 'name', or a lane/marker id) on a local source.
  if (!hub && !isFkey(k)) return { builder: localBuilderId(s), target: k };
  return { error: 'bad-target' };
}

/** A v4 UUID, with a fallback for non-secure contexts. */
export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* insecure context */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The unsigned envelope a local browser sends to POST /api/v1/actions. */
export function buildEnvelope({ builder, action, target, args, id, ts }) {
  return { v: 1, id, ts, builder, action, target, args: args ?? {}, via: 'direct' };
}

const enc = encodeURIComponent;

/** action -> the legacy REST request, or null when there is none. */
export function legacyRequest(action, target, args = {}) {
  const t = enc(target);
  if (isDotSegment(target) && !['spawn', 'launch'].includes(action)) return null;
  switch (action) {
    case 'send-keys': return { method: 'POST', url: `/api/sessions/${t}/keys`, body: { keys: args.keys } };
    case 'send-text': return { method: 'POST', url: `/api/sessions/${t}/text`, body: { text: args.text, enter: args.enter !== false } };
    case 'restart': return { method: 'POST', url: `/api/sessions/${t}/restart`, body: {} };
    case 'kill': return target === '*' ? null : { method: 'DELETE', url: `/api/sessions/${t}` };
    case 'spawn': return { method: 'POST', url: '/api/sessions', body: { ...args, name: target } };
    case 'launch': return { method: 'POST', url: '/api/lanes', body: { ...args } };
    case 'retire': return { method: 'DELETE', url: `/api/lanes/${t}` };
    case 'dismiss-marker': return { method: 'DELETE', url: `/api/markers/${t}` };
    default: return null;
  }
}

function isTimeout(err) {
  return err && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/**
 * Bind act()/hubAct() to a store and a fetch. Tests pass their own; the page
 * uses the default instance below (global fetch, the page's store).
 */
export function createActions(opts = {}) {
  const s = opts.store ?? store;
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const newId = opts.newId ?? uuid;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? ACTION_TIMEOUT_MS;
  async function request(method, url, body, legacy) {
    const headers = { 'x-laneboard': '1' };
    const init = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    let r;
    try {
      r = await fetchImpl(url, init);
    } catch (err) {
      if (isTimeout(err)) return { ok: 'unknown', error: 'timeout' };
      return { ok: false, error: err?.message || 'network error', code: 'network' };
    }
    let json = null;
    try { json = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) {
      if (r.status === 504 && json?.ok === 'unknown') return json;
      return {
        ok: false,
        error: (json && typeof json.error === 'string' && json.error) || `HTTP ${r.status}`,
        code: (json && json.code) || r.status,
      };
    }
    if (!legacy && json && typeof json === 'object' && 'ok' in json) return json;
    return { ok: true, result: json };
  }

  /** POST /api/fleet/actions on the hub. `builder` may be '*' (hub fan-out). */
  function hubAct({ builder, action, target, args }) {
    return request('POST', '/api/fleet/actions', { builder, action, target, args: args ?? {} }, false);
  }

  /** Send `action` to the session/lane/target behind key `k`. */
  async function act(k, action, args = {}) {
    if (typeof action !== 'string' || !ACTION_RX.test(action)) return { ok: false, error: 'bad action', code: 'bad-action' };
    const t = resolveTarget(s, k);
    if (t.error) return { ok: false, error: t.error, code: t.error };
    if (s.source.kind === 'hub') return hubAct({ builder: t.builder, action, target: t.target, args });
    if (s.source.hello?.capabilities?.includes('actions')) {
      const env = buildEnvelope({ builder: t.builder, action, target: t.target, args, id: newId(), ts: now() });
      return request('POST', '/api/v1/actions', env, false);
    }
    if (isDotSegment(t.target) && !['spawn', 'launch'].includes(action)) return { ok: false, error: 'bad-target', code: 'bad-target' };
    const req = legacyRequest(action, t.target, args ?? {});
    if (!req) return { ok: false, error: `${action} needs a newer builder`, code: 'unsupported' };
    return request(req.method, req.url, req.body, true);
  }

  return { act, hubAct };
}

let page = null;
function pageActions() {
  page ||= createActions();
  return page;
}

/** act() on the page's store with the global fetch. */
export function act(k, action, args) {
  return pageActions().act(k, action, args);
}

/** hubAct() on the page's store with the global fetch. */
export function hubAct(req) {
  return pageActions().hubAct(req);
}
