// API v1 (fleet plan §1 2.8): the read handlers behind /api/v1/hello and
// /api/v1/snapshot, and the hello registry other builder modules extend.
//
// The registry is a module singleton. Route modules import it directly, never
// through ctx (modules.mjs rule):
//
//   import { addCapability, addHelloField } from '../fleet/api-v1.mjs';
//   addCapability('packages');                       // hello.capabilities
//   addHelloField('repos', () => [...]);             // hello.repos
//
// ROUTES is the v1 route table that server/routes/v1.mjs registers. Every entry
// here is a read (`tier: 'read'`, GET only); §2 A8 adds the action, audit, job
// and stream entries, the `auth` hello field and the request classification
// in http.mjs, which then applies to these routes too. Nothing in this file
// mutates builder state.
import { config } from '../config.mjs';
import { VERSION } from '../version.mjs';
import { log } from '../log.mjs';
import * as state from '../state.mjs';
import * as ws from '../ws.mjs';
import { tiers } from './dispatch.mjs';

export const API_VERSION = 1;

/** Keys a hello field may not take: the core shape, and A8's `auth`. */
export const RESERVED_HELLO_KEYS = Object.freeze([
  'id', 'code', 'version', 'apiVersion', 'mode', 'capabilities', 'actions', 'time', 'auth',
]);

// Capability names: `snapshot`, `conflicts:textual`, `launch`.
const CAPABILITY_RE = /^[a-z][a-z0-9-]{0,31}(:[a-z][a-z0-9-]{0,31})?$/;
// Hello field names: plain camelCase identifiers (no `__proto__`, no dots).
const FIELD_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

const capabilities = new Set();
const helloFields = new Map(); // name -> fn()

/** Add a capability to hello.capabilities. Idempotent. */
export function addCapability(name) {
  if (typeof name !== 'string' || !CAPABILITY_RE.test(name)) {
    throw new TypeError(`addCapability: bad capability name ${JSON.stringify(name)}`);
  }
  capabilities.add(name);
}

/**
 * Add `hello[name] = fn()`. A core key, `auth`, or a second registration of
 * the same name is refused. `fn` runs on every hello; a throw or `undefined`
 * leaves the field out (logged, never fatal for the hello).
 */
export function addHelloField(name, fn) {
  if (typeof name !== 'string' || !FIELD_RE.test(name)) {
    throw new TypeError(`addHelloField: bad field name ${JSON.stringify(name)}`);
  }
  if (RESERVED_HELLO_KEYS.includes(name)) throw new TypeError(`addHelloField: '${name}' is reserved`);
  if (helloFields.has(name)) throw new TypeError(`addHelloField: '${name}' is already registered`);
  if (typeof fn !== 'function') throw new TypeError('addHelloField: fn must be a function');
  helloFields.set(name, fn);
}

/** ['snapshot', ...registered, sorted], deduplicated. */
export function capabilityList() {
  return ['snapshot', ...[...capabilities].filter((c) => c !== 'snapshot').sort()];
}

function builderIdentity() {
  return { id: config.fleet?.id ?? null, code: config.fleet?.code ?? null };
}

/** GET /api/v1/hello (README §3.3). `opts.now` for tests. */
export function hello({ now = Date.now() } = {}) {
  const { id, code } = builderIdentity();
  const out = {
    id,
    code,
    version: VERSION,
    apiVersion: API_VERSION,
    mode: config.mode ?? 'builder',
    capabilities: capabilityList(),
    actions: tiers(),
    time: now,
  };
  for (const [name, fn] of helloFields) {
    let value;
    try {
      value = fn();
    } catch (err) {
      log.warn(`v1 hello field '${name}' failed: ${err?.message || err}`);
      continue;
    }
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * GET /api/v1/snapshot: state.snapshot() + {builder, seq}, sessions through
 * ws.forWire so no `preview`/`previewHtml` leaves the builder. `opts` swaps the
 * sources for tests.
 */
export function snapshot({ source = state.snapshot, seq = ws.currentSeq } = {}) {
  const snap = source();
  return {
    ...snap,
    sessions: (snap.sessions ?? []).map(ws.forWire),
    builder: builderIdentity(),
    seq: seq(),
  };
}

/**
 * The v1 route table. Shape (kept for A8): `{method, path, name, tier, handler}`
 * where `handler(req, res, ctx)` answers through `ctx.json`. Only reads here.
 */
export const ROUTES = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/v1/hello', name: 'hello', tier: 'read', handler: (req, res, ctx) => ctx.json(res, hello()) }),
  Object.freeze({ method: 'GET', path: '/api/v1/snapshot', name: 'snapshot', tier: 'read', handler: (req, res, ctx) => ctx.json(res, snapshot()) }),
]);

/** Tests only. */
export function _reset() {
  capabilities.clear();
  helloFields.clear();
}
