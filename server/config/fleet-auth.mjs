// Config fragment: fleet auth keys (fleet plan §2 2.2, SECURITY-FIXES S5/S6).
// REVIEW-REQUIRED (SR4).
//
//   fleet.hubKeys          pinned hub public keys. An entry is a bare string
//                          (PEM SPKI or "ed25519:<base64 raw 32 bytes>"),
//                          which means scopes ["read"] only (fail-safe), or an
//                          object {key, id, scopes} with id /^[a-z0-9-]{1,32}$/
//                          and scopes ⊆ read|control|term, always with read.
//                          Parsed once at load; see hubKeyring().
//   fleet.ingressPort      the loopback listener `tailscale serve` targets.
//                          7778 when the config file has a `fleet` block (on
//                          a builder), else null. Mandatory with a fleet block
//                          (an explicit null is an error) and in hub mode,
//                          where it has no default and must be set. Must
//                          differ from `port`.
//   fleet.hubControl       master switch, default false: hub-signed requests
//                          may only read; true lets the key scopes decide.
//   fleet.hubAddrs         optional IP literals expected in X-Forwarded-For of
//                          hub requests ([] = not checked).
//   fleet.ingressPeerUid   uid of tailscaled (peer-uid check, Linux only),
//                          null = off. Optional on a builder; REQUIRED in hub
//                          mode on Linux (SR12 M3): without it any local
//                          process can forge serve headers on the hub's
//                          ingress port and act as a direct user, which on a
//                          hub means a terminal on every builder.
//   fleet.allowedUsers     optional Tailscale logins allowed as `direct`.
//   fleet.publicHosts      allowed Host values on ingress; default the host
//                          of publicUrl when that is not loopback.
//   fleet.enforce          refuse unidentified ingress. Fail closed (SR4 M1):
//                          true whenever an ingress listener will open, i.e.
//                          ingressPort is non-null, whether the file or
//                          LANEBOARD_INGRESS_PORT set it (env alone counts as
//                          an enforcing fleet block). An explicit false with
//                          a non-null ingressPort is a ConfigError unless
//                          fleet.insecureNoEnforce is true, and then a loud
//                          warning is logged at every load.
//   fleet.insecureNoEnforce  escape hatch for the above, default false. With
//                          it, unidentified ingress (tagged tailnet nodes,
//                          forged X-Forwarded-* from local processes) acts as
//                          `direct`. Never set it outside a test rig.
//   fleet.clockSkewMs      signature ts window (≤ 120 s: nonces live 5 min).
//   fleet.allowedPermissionModes  modes v1 launch/spawn accept; the default
//                          leaves out bypassPermissions and dontAsk.
//   fleet.rateLimits       per-action overrides, checked by resolveRules().
//   fleet.audit.maxBytes   audit log rotate size.
//   fleet.legacyBrowserRoutes  keep the pre-v1 browser routes.
//
// Unknown keys under `fleet` in the config file are refused (SR4 L2): the
// allowed set is this fragment's keys plus those of server/config/fleet.mjs
// (identity) and server/config/hub.mjs (the README section 3 contract lists
// no other owner of fleet.*). `__proto__`, `constructor` and `prototype` are
// refused at any depth under `fleet`. After validation every key this
// fragment owns is read-only and deep-frozen (SR4 L3); hub keyring scopes are
// a frozen array with has() (SR4 L1).
//
// "A fleet block" means a `fleet` key in the config file. Env:
// LANEBOARD_INGRESS_PORT sets fleet.ingressPort; LANEBOARD_AUDIT_FILE is read
// by server/fleet/paths.mjs auditFile(), not a config key.
//
// Like every fragment, this file must not import server/config.mjs.
import net from 'node:net';

import { parsePublicKey, keyId } from '../fleet/keys-ed25519.mjs';
import { resolveRules } from '../fleet/ratelimit.mjs';
import * as identity from './fleet.mjs';
import * as hub from './hub.mjs';

export const SCOPES = Object.freeze(['read', 'control', 'term']);
export const KEY_LABEL_RX = /^[a-z0-9-]{1,32}$/;
export const PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
export const DEFAULT_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan', 'auto']);
export const DEFAULT_INGRESS_PORT = 7778;
export const MAX_HUB_KEYS = 16;
export const MAX_CLOCK_SKEW_MS = 120000;
export const MIN_CLOCK_SKEW_MS = 1000;
const MAX_LIST = 64;

export function defaults() {
  return {
    fleet: {
      hubKeys: [],
      ingressPort: null,
      hubControl: false,
      hubAddrs: [],
      ingressPeerUid: null,
      allowedUsers: [],
      legacyBrowserRoutes: true,
      publicHosts: [],
      enforce: false,
      insecureNoEnforce: false,
      clockSkewMs: 60000,
      allowedPermissionModes: [...DEFAULT_PERMISSION_MODES],
      rateLimits: {},
      audit: { maxBytes: 10485760 },
    },
  };
}

export function fromEnv(env = process.env) {
  const v = env.LANEBOARD_INGRESS_PORT;
  if (v === undefined || v === null || String(v).trim() === '') return {};
  const s = String(v).trim();
  // A non-number stays a string so validate reports it instead of dropping it.
  return { fleet: { ingressPort: /^\d+$/.test(s) ? Number(s) : s } };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => isObj(o) && Object.hasOwn(o, k);

/** True when the config file has a `fleet` block. */
export function hasFleetBlock(layers) {
  return has(layers?.file, 'fleet');
}

/** Whether `key` under fleet was set by the file or the env layer. */
function setByUser(layers, key) {
  return has(layers?.file?.fleet, key) || has(layers?.env?.fleet, key);
}

function isLoopbackHostname(h) {
  return h === 'localhost' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Derived defaults: ingressPort, enforce, publicHosts. Tolerates wrong types. */
export function finalize(c, layers) {
  const f = c.fleet;
  if (!isObj(f)) return c;
  const block = hasFleetBlock(layers);
  // A hub gets no default: it must name the port serve targets (H1 relies on it).
  if (!setByUser(layers, 'ingressPort') && block && c.mode !== 'hub') f.ingressPort = DEFAULT_INGRESS_PORT;
  // Fail closed (SR4 M1): any ingress listener enforces unless told otherwise,
  // whichever layer opened it.
  if (!setByUser(layers, 'enforce') && (block || f.ingressPort !== null)) f.enforce = true;
  if (!setByUser(layers, 'publicHosts') && typeof c.publicUrl === 'string') {
    try {
      const u = new URL(c.publicUrl);
      if (u.host && !isLoopbackHostname(u.hostname)) f.publicHosts = [u.host];
    } catch { /* an unparsable publicUrl derives nothing */ }
  }
  return c;
}

// --- hubKeys -----------------------------------------------------------------

/**
 * Scopes as a frozen array with Set-like `has(scope)` and `size` (SR4 L1). A
 * frozen array has no Set brand, so `Set.prototype.add.call` cannot widen it,
 * and `Array.prototype.push.call` throws.
 */
function frozenScopes(values) {
  const arr = [...values];
  Object.defineProperties(arr, {
    has: { value: (s) => arr.includes(s) },
    size: { get: () => arr.length },
  });
  return Object.freeze(arr);
}

/**
 * Parse `fleet.hubKeys` into frozen `{keyId, label, scopes, pub}` entries;
 * `scopes` is a frozen array of scope names with `has(scope)`.
 * Throws TypeError with a message that names the entry by index (never its
 * key text). A bare string gets scopes {read} and its keyId as label.
 */
export function parseHubKeys(entries) {
  if (!Array.isArray(entries)) throw new TypeError('fleet.hubKeys must be a list');
  if (entries.length > MAX_HUB_KEYS) throw new TypeError(`fleet.hubKeys may hold at most ${MAX_HUB_KEYS} keys`);
  const out = [];
  const ids = new Set();
  const labels = new Set();
  entries.forEach((e, i) => {
    const at = `fleet.hubKeys[${i}]`;
    let keyText, label, scopes;
    if (typeof e === 'string') {
      keyText = e;
      scopes = ['read'];
    } else if (isObj(e)) {
      for (const k of Object.keys(e)) {
        if (k !== 'key' && k !== 'id' && k !== 'scopes') throw new TypeError(`${at}: unknown field ${JSON.stringify(k)} (allowed: key, id, scopes)`);
      }
      if (typeof e.key !== 'string') throw new TypeError(`${at}.key must be a PEM SPKI or "ed25519:<base64>" string`);
      if (typeof e.id !== 'string' || !KEY_LABEL_RX.test(e.id)) {
        throw new TypeError(`${at}.id must match ${KEY_LABEL_RX} (lowercase letters, digits, '-', 1-32 chars)`);
      }
      if (!Array.isArray(e.scopes)) throw new TypeError(`${at}.scopes must be a list of ${SCOPES.join(', ')}`);
      const seen = new Set();
      for (const s of e.scopes) {
        if (typeof s !== 'string' || !SCOPES.includes(s)) throw new TypeError(`${at}.scopes: unknown scope ${JSON.stringify(s)} (allowed: ${SCOPES.join(', ')})`);
        if (seen.has(s)) throw new TypeError(`${at}.scopes: duplicate scope ${JSON.stringify(s)}`);
        seen.add(s);
      }
      if (!seen.has('read')) throw new TypeError(`${at}.scopes must contain "read" (a key that cannot read cannot connect)`);
      keyText = e.key;
      label = e.id;
      scopes = e.scopes;
    } else {
      throw new TypeError(`${at} must be a key string or {key, id, scopes}`);
    }
    let pub;
    try {
      pub = parsePublicKey(keyText);
    } catch (err) {
      throw new TypeError(`${at}: ${err?.message || 'bad public key'}`);
    }
    const id = keyId(pub);
    if (ids.has(id)) throw new TypeError(`${at}: the same key is pinned twice (keyId ${id})`);
    ids.add(id);
    label ??= id;
    if (labels.has(label)) throw new TypeError(`${at}: duplicate id ${JSON.stringify(label)}`);
    labels.add(label);
    out.push(Object.freeze({ keyId: id, label, scopes: frozenScopes(scopes), pub }));
  });
  return Object.freeze(out);
}

const keyrings = new WeakMap();

/**
 * The parsed `fleet.hubKeys` of a config's `fleet` object, parsed once (at
 * config load, by validate) and cached per hubKeys list. Throws TypeError on a
 * list that does not parse (validate has already refused such a config).
 */
export function hubKeyring(fleet) {
  const list = fleet?.hubKeys;
  if (!Array.isArray(list)) throw new TypeError('fleet.hubKeys must be a list');
  let ring = keyrings.get(list);
  if (!ring) {
    ring = parseHubKeys(list);
    keyrings.set(list, ring);
  }
  return ring;
}

// --- validation ---------------------------------------------------------------

const isPort = (v) => Number.isInteger(v) && v >= 1 && v <= 65535;
const CTRL_RX = /[\u0000- \u007f-\u009f]/;
const HOST_RX = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** null when `h` is an acceptable Host header value (host[:port]), else the reason. */
export function hostProblem(h) {
  if (typeof h !== 'string' || h === '') return 'must be a non-empty string';
  if (h.length > 255 || !HOST_RX.test(h)) return 'must be host or host:port (no scheme, path or spaces)';
  let u;
  try { u = new URL(`http://${h}/`); } catch { return 'is not a valid host'; }
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return 'must be host or host:port';
  const port = /:(\d{1,5})$/.exec(h)?.[1];
  if (port !== undefined && !(Number(port) >= 1 && Number(port) <= 65535)) return 'has a bad port';
  return null;
}

// --- key hygiene (SR4 L2) and freezing (SR4 L3) -----------------------------

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OWN_KEYS = Object.freeze(Object.keys(defaults().fleet));

/** Every key a config file may put under `fleet`, sorted. */
export function allowedFleetKeys() {
  const keys = new Set(OWN_KEYS);
  for (const fr of [identity, hub]) for (const k of Object.keys(fr.defaults().fleet ?? {})) keys.add(k);
  return [...keys].sort();
}

/** Throws via `bad` on an own __proto__/constructor/prototype key at any depth. */
function refuseForbidden(v, at, bad, depth = 0) {
  if (v === null || typeof v !== 'object' || depth > 32) return;
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_KEYS.has(k)) bad(`${at} has an unknown key ${JSON.stringify(k)} (__proto__, constructor and prototype are never allowed)`);
    refuseForbidden(v[k], Array.isArray(v) ? `${at}[${k}]` : `${at}.${k}`, bad, depth + 1);
  }
}

function deepFreeze(v, depth = 0) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v) || depth > 32) return v;
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return v;
  for (const k of Object.keys(v)) deepFreeze(v[k], depth + 1);
  return Object.freeze(v);
}

/**
 * Make this fragment's keys on `f` read-only and deep-frozen. The `fleet`
 * object itself stays extensible: other fragments own keys on it too.
 */
function freezeOwnKeys(f) {
  for (const k of OWN_KEYS) {
    if (!Object.hasOwn(f, k)) continue;
    Object.defineProperty(f, k, { value: deepFreeze(f[k]), writable: false, configurable: false, enumerable: true });
  }
}

function list(v, name, bad) {
  if (!Array.isArray(v)) bad(`${name} must be a list`);
  if (v.length > MAX_LIST) bad(`${name} may hold at most ${MAX_LIST} entries`);
  return v;
}

export function validate(c, bad, layers, { platform = process.platform, warn = console.warn } = {}) {
  const f = c.fleet;
  if (!isObj(f)) bad('fleet must be an object');
  if (Object.getPrototypeOf(f) !== Object.prototype) bad('fleet has an unknown key "__proto__" (__proto__, constructor and prototype are never allowed)');

  for (const layer of ['file', 'env']) {
    const lf = layers?.[layer]?.fleet;
    if (lf === undefined) continue;
    refuseForbidden(lf, 'fleet', bad);
  }
  const ff = layers?.file?.fleet;
  if (isObj(ff)) {
    const allowed = allowedFleetKeys();
    for (const k of Object.keys(ff)) {
      if (!allowed.includes(k)) bad(`fleet has an unknown key ${JSON.stringify(k)} (allowed: ${allowed.join(', ')})`);
    }
    if (isObj(ff.audit)) {
      for (const k of Object.keys(ff.audit)) {
        if (k !== 'maxBytes') bad(`fleet.audit has an unknown key ${JSON.stringify(k)} (allowed: maxBytes)`);
      }
    }
  }

  try {
    keyrings.set(f.hubKeys, parseHubKeys(f.hubKeys));
  } catch (err) {
    bad(err.message);
  }

  const needsIngress = hasFleetBlock(layers) || c.mode === 'hub';
  if (f.ingressPort === null) {
    if (needsIngress) {
      const why = c.mode === 'hub' ? 'mode "hub" needs fleet.ingressPort' : 'fleet.ingressPort is mandatory when the config has a fleet block';
      bad(`${why} (the loopback port tailscale serve targets, e.g. ${DEFAULT_INGRESS_PORT}); it cannot be null`);
    }
  } else if (!isPort(f.ingressPort)) {
    bad(`fleet.ingressPort must be a port number, got ${JSON.stringify(f.ingressPort)}`);
  } else if (f.ingressPort === c.port) {
    bad(`fleet.ingressPort must differ from port (both are ${c.port})`);
  }

  for (const k of ['hubControl', 'enforce', 'insecureNoEnforce', 'legacyBrowserRoutes']) {
    if (typeof f[k] !== 'boolean') bad(`fleet.${k} must be true or false, got ${JSON.stringify(f[k])}`);
  }

  // SR13 M1: a hub never has a reason to accept unidentified ingress. On a
  // hub `insecureNoEnforce` would hand the fleet key's `term` scope to every
  // tagged tailnet node (every builder), so it is refused outright.
  if (c.mode === 'hub' && (f.insecureNoEnforce === true || f.enforce === false)) {
    bad('mode "hub" refuses fleet.enforce:false and fleet.insecureNoEnforce: a hub must only accept identified ingress (Tailscale-User-Login); remove both');
  }

  // SR4 M1/L4: an open ingress listener without enforce lets tagged tailnet
  // nodes and forged serve headers act as `direct`.
  if (f.ingressPort !== null && !f.enforce && c.mode !== 'hub') {
    if (!f.insecureNoEnforce) {
      bad(`fleet.enforce is false while fleet.ingressPort ${f.ingressPort} opens an ingress listener: unidentified ingress would act as local. Remove enforce:false, or set fleet.insecureNoEnforce: true to accept that`);
    }
    warn(`laneboard: WARNING fleet.insecureNoEnforce is set: ingress port ${f.ingressPort} accepts unidentified requests as local (tagged tailnet nodes and forged X-Forwarded-* headers get full control)`);
  }

  for (const a of list(f.hubAddrs, 'fleet.hubAddrs', bad)) {
    if (typeof a !== 'string' || net.isIP(a) === 0) bad(`fleet.hubAddrs entry ${JSON.stringify(a)} must be an IP address literal`);
  }

  if (f.ingressPeerUid !== null) {
    if (!Number.isInteger(f.ingressPeerUid) || f.ingressPeerUid < 0 || f.ingressPeerUid > 0xfffffffe) {
      bad(`fleet.ingressPeerUid must be a uid (integer ≥ 0) or null, got ${JSON.stringify(f.ingressPeerUid)}`);
    }
    if (platform !== 'linux') bad(`fleet.ingressPeerUid needs Linux (/proc/net/tcp); this host is ${platform}`);
  }
  if (c.mode === 'hub' && platform === 'linux' && f.ingressPeerUid === null) {
    bad('mode "hub" needs fleet.ingressPeerUid: set it to the uid tailscaled runs as (`ps -o uid= -C tailscaled`, usually 0) so only tailscale serve can reach the ingress port');
  }

  for (const u of list(f.allowedUsers, 'fleet.allowedUsers', bad)) {
    if (typeof u !== 'string' || u === '' || u.length > 256 || CTRL_RX.test(u)) {
      bad(`fleet.allowedUsers entry ${JSON.stringify(u)} must be a Tailscale login (a non-empty string without spaces)`);
    }
  }

  for (const h of list(f.publicHosts, 'fleet.publicHosts', bad)) {
    const why = hostProblem(h);
    if (why) bad(`fleet.publicHosts entry ${JSON.stringify(h)} ${why}`);
  }

  if (!Number.isInteger(f.clockSkewMs) || f.clockSkewMs < MIN_CLOCK_SKEW_MS || f.clockSkewMs > MAX_CLOCK_SKEW_MS) {
    bad(`fleet.clockSkewMs must be an integer from ${MIN_CLOCK_SKEW_MS} to ${MAX_CLOCK_SKEW_MS} (nonces are kept 5 min), got ${JSON.stringify(f.clockSkewMs)}`);
  }

  const modes = list(f.allowedPermissionModes, 'fleet.allowedPermissionModes', bad);
  for (const m of modes) {
    if (typeof m !== 'string' || !PERMISSION_MODES.includes(m)) {
      bad(`fleet.allowedPermissionModes: unknown permission mode ${JSON.stringify(m)} (known: ${PERMISSION_MODES.join(', ')})`);
    }
  }
  if (new Set(modes).size !== modes.length) bad('fleet.allowedPermissionModes has duplicates');

  try {
    resolveRules(f.rateLimits);
  } catch (err) {
    bad(`fleet.${err?.message || 'rateLimits is invalid'}`);
  }

  if (!isObj(f.audit)) bad('fleet.audit must be an object');
  const mb = f.audit.maxBytes;
  if (!Number.isSafeInteger(mb) || mb < 65536 || mb > 2 ** 30) {
    bad(`fleet.audit.maxBytes must be an integer from 65536 to ${2 ** 30}, got ${JSON.stringify(mb)}`);
  }

  freezeOwnKeys(f);
}
