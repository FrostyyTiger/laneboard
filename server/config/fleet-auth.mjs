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
//                          7778 when the config file has a `fleet` block or
//                          mode is hub, else null. With a fleet block or in
//                          hub mode it is mandatory: an explicit null is an
//                          error. Must differ from `port`.
//   fleet.hubControl       master switch, default false: hub-signed requests
//                          may only read; true lets the key scopes decide.
//   fleet.hubAddrs         optional IP literals expected in X-Forwarded-For of
//                          hub requests ([] = not checked).
//   fleet.ingressPeerUid   optional uid of tailscaled (peer-uid check, Linux
//                          only), null = off.
//   fleet.allowedUsers     optional Tailscale logins allowed as `direct`.
//   fleet.publicHosts      allowed Host values on ingress; default the host
//                          of publicUrl when that is not loopback.
//   fleet.enforce          refuse unidentified ingress; true with a fleet block.
//   fleet.clockSkewMs      signature ts window (≤ 120 s: nonces live 5 min).
//   fleet.allowedPermissionModes  modes v1 launch/spawn accept; the default
//                          leaves out bypassPermissions and dontAsk.
//   fleet.rateLimits       per-action overrides, checked by resolveRules().
//   fleet.audit.maxBytes   audit log rotate size.
//   fleet.legacyBrowserRoutes  keep the pre-v1 browser routes.
//
// "A fleet block" means a `fleet` key in the config file. Env:
// LANEBOARD_INGRESS_PORT sets fleet.ingressPort; LANEBOARD_AUDIT_FILE is read
// by server/fleet/paths.mjs auditFile(), not a config key.
//
// Like every fragment, this file must not import server/config.mjs.
import net from 'node:net';

import { parsePublicKey, keyId } from '../fleet/keys-ed25519.mjs';
import { resolveRules } from '../fleet/ratelimit.mjs';

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
  if (!setByUser(layers, 'ingressPort') && (block || c.mode === 'hub')) f.ingressPort = DEFAULT_INGRESS_PORT;
  if (!setByUser(layers, 'enforce') && block) f.enforce = true;
  if (!setByUser(layers, 'publicHosts') && typeof c.publicUrl === 'string') {
    try {
      const u = new URL(c.publicUrl);
      if (u.host && !isLoopbackHostname(u.hostname)) f.publicHosts = [u.host];
    } catch { /* an unparsable publicUrl derives nothing */ }
  }
  return c;
}

// --- hubKeys -----------------------------------------------------------------

function frozenSet(values) {
  const s = new Set(values);
  const refuse = () => { throw new TypeError('hub key scopes are read-only'); };
  Object.defineProperties(s, { add: { value: refuse }, delete: { value: refuse }, clear: { value: refuse } });
  return Object.freeze(s);
}

/**
 * Parse `fleet.hubKeys` into frozen `{keyId, label, scopes: Set, pub}` entries.
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
    out.push(Object.freeze({ keyId: id, label, scopes: frozenSet(scopes), pub }));
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

function list(v, name, bad) {
  if (!Array.isArray(v)) bad(`${name} must be a list`);
  if (v.length > MAX_LIST) bad(`${name} may hold at most ${MAX_LIST} entries`);
  return v;
}

export function validate(c, bad, layers, { platform = process.platform } = {}) {
  const f = c.fleet;
  if (!isObj(f)) bad('fleet must be an object');

  try {
    keyrings.set(f.hubKeys, parseHubKeys(f.hubKeys));
  } catch (err) {
    bad(err.message);
  }

  const needsIngress = hasFleetBlock(layers) || c.mode === 'hub';
  if (f.ingressPort === null) {
    if (needsIngress) {
      bad(`fleet.ingressPort is mandatory ${hasFleetBlock(layers) ? 'when the config has a fleet block' : 'in hub mode'} (the loopback port tailscale serve targets, e.g. ${DEFAULT_INGRESS_PORT}); it cannot be null`);
    }
  } else if (!isPort(f.ingressPort)) {
    bad(`fleet.ingressPort must be a port number, got ${JSON.stringify(f.ingressPort)}`);
  } else if (f.ingressPort === c.port) {
    bad(`fleet.ingressPort must differ from port (both are ${c.port})`);
  }

  for (const k of ['hubControl', 'enforce', 'legacyBrowserRoutes']) {
    if (typeof f[k] !== 'boolean') bad(`fleet.${k} must be true or false, got ${JSON.stringify(f[k])}`);
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
}
