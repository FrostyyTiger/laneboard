// Request classification, hub signatures and kind-aware request/upgrade guards
// (fleet plan §2 2.3-2.5, README §3.2, SECURITY-FIXES S4/S5/S6/S16/S17/S21).
// REVIEW-REQUIRED (SR3).
//
// Verify side (every builder; the hub runs classify too and refuses `hub` kind):
//   classify(req, cfg, opts)        -> auth  {kind:'local'|'direct'|'hub', ...} or throws AuthError
//   verifyRead(req, cfg, opts)      -> hub auth for a signed read (GET / stream upgrade)
//   verifyEnvelope(env, headers, cfg, opts) -> hub auth with the verified, frozen envelope
//   guardRequest(req, url, cfg, opts)  -> auth; Host + kind rules + Origin/CSRF for HTTP requests
//   guardUpgrade(req, url, cfg, opts)  -> auth; Host + kind rules + Origin for WebSocket upgrades
// Sign side (the hub; pure):
//   signedReadString({method, builderId, pathWithQuery, ts, nonce})
//   signRead({method, url, builderId, key, keyId?, now?, uuid?}) -> {X-Laneboard-Ts, -Nonce, -Key, -Sig}
//   signEnvelope(env, key) -> 'ed25519 <base64>'
//   actionHeaders(env, key), termHeaders(env, key)  (convenience header sets)
//
// Classification (2.3), in order. The ONLY ingress test is the listener: `req.socket.localPort ===
// fleet.ingressPort` (the header heuristic is deleted, S6a):
//   no ingress listener configured  -> local (Tailscale-User-Login kept for attribution only, as today)
//   not the ingress listener        -> local, user 'local'; every Tailscale-* header is DELETED from
//                                      req.headers/rawHeaders first (S6b)
//   ingress:
//     lb_* query parameters          -> 401 query-signature-not-allowed (no query-param signatures, S16)
//     no X-Forwarded-For, or X-Forwarded-Proto !== https -> 403 not-from-serve
//     fleet.ingressPeerUid set and the peer uid differs or is unknown -> 403 not-from-serve (S6c, fail closed)
//     user header + signature        -> 400 ambiguous-identity
//     Tailscale-User-Login           -> direct (fleet.allowedUsers -> 403 user-not-allowed)
//     signature                      -> hub (fleet.hubAddrs on X-Forwarded-For -> 403 hub-addr), verified:
//         X-Laneboard-Envelope       -> a signed `term` envelope, verified here (verifyEnvelope)
//         X-Laneboard-Ts/-Nonce      -> a signed read, verified here (verifyRead)
//         -Sig/-Key only             -> an action envelope: key looked up, `verified:false`; the
//                                       /api/v1/actions route MUST call verifyEnvelope(parsedBody, ...)
//     neither                        -> fleet.enforce ? 403 unidentified : direct 'local'
//
// Verification order (S16): parse headers -> key lookup -> signature -> ts window -> nonce check-and-insert.
// Nothing unauthenticated ever enters the nonce cache. Signed reads cover the RAW req.url. Envelopes are
// verified over canonicalJson of the PARSED object and the returned envelope is re-parsed from exactly the
// signed text and deep-frozen: callers act on `auth.envelope`, never on the raw body (SR1 I1).
//
// Scopes (S5): a hub read needs `read`; a hub terminal needs a `term` envelope, fleet.hubControl true
// (else 403 control-disabled) and scope `term` (else 403 scope-missing). Hub actions: dispatch.mjs checks
// hubControl/control so refusals are audited. A read signature never opens a terminal (S4).
//
// Nothing here logs keys, signatures, nonces or query strings.
import crypto from 'node:crypto';
import net from 'node:net';

import { canonicalJson } from './canonical.mjs';
import { sign, verify, keyId as keyIdOf } from './keys-ed25519.mjs';
import { createNonceCache } from './nonces.mjs';
import { socketPeerUid } from './peercred.mjs';
import { hubKeyring } from '../config/fleet-auth.mjs';
import { checkHost, checkOrigin, checkCsrf, isMutating, HOOK_PATHS } from '../security.mjs';

export { canonicalJson };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BUILDER_ID_RE = /^[a-z0-9-]{1,24}$/;
export const LOGIN_RE = /^[^\s\x00-\x1f\x7f]{1,256}$/;
export const ENVELOPE_USER_RE = /^[^\s\x00-\x1f\x7f]{1,128}$/;
export const ACTION_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const WINDOW_RE = /^run-[a-z0-9-]{1,24}$/;
export const ENVELOPE_KEYS = Object.freeze(['v', 'id', 'ts', 'builder', 'action', 'target', 'args', 'user', 'via']);
export const QUERY_SIGNATURE_PARAMS = Object.freeze(['lb_ts', 'lb_nonce', 'lb_key', 'lb_sig']);
export const TERM_COLS = Object.freeze([20, 500]);
export const TERM_ROWS = Object.freeze([5, 200]);

const KEY_ID_RE = /^[0-9a-f]{16}$/;
const TS_RE = /^\d{1,16}$/;
const SIG_HEADER_RE = /^ed25519 (\S{1,200})$/;
const METHOD_RE = /^[A-Z]{1,16}$/;
const PATH_RE = /^\/[\x21-\x7e]{0,8191}$/;
const TERM_PATH_RE = /^\/api\/v1\/term\/([^/]+)$/;
const SINGLE_HEADERS = Object.freeze([
  'tailscale-user-login', 'tailscale-user-name', 'tailscale-app-capabilities',
  'x-forwarded-for', 'x-forwarded-proto',
  'x-laneboard-sig', 'x-laneboard-key', 'x-laneboard-ts', 'x-laneboard-nonce', 'x-laneboard-envelope',
]);
const MAX_ENVELOPE_HEADER = 16384;

const STATUS_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 415: 'Unsupported Media Type', 500: 'Internal Server Error', 503: 'Service Unavailable' };

/** A refused request: `status` (HTTP) and a stable machine `code` (also the message). Carries no secrets. */
export class AuthError extends Error {
  constructor(status, code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }

  /** JSON body for the response. */
  get body() {
    return { error: this.code };
  }
}

const refuse = (status, code, detail) => { throw new AuthError(status, code, detail); };

// --- nonce cache (module singleton; A8 pre-loads it from the audit log) -------------------------------------

let sharedNonces = null;

/** The process-wide nonce cache used when opts.nonces is not given (10 000 live nonces, 5 min). */
export function nonceCache() {
  sharedNonces ??= createNonceCache({ max: 10000, ttlMs: 300000 });
  return sharedNonces;
}

/** Tests only: drop the shared nonce cache and the one-time warnings. */
export function _resetForTests() {
  sharedNonces = null;
  warned.clear();
}

const warned = new Set();
function warnOnce(opts, key, text) {
  if (warned.has(key)) return;
  warned.add(key);
  const w = typeof opts?.warn === 'function' ? opts.warn : console.warn;
  try { w(text); } catch { /* a logger failure never fails a request */ }
}

// --- small helpers -----------------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;
const fleetOf = (cfg) => (isObj(cfg?.fleet) ? cfg.fleet : {});
const nowOf = (opts) => {
  const t = typeof opts?.now === 'function' ? opts.now() : Date.now();
  if (!Number.isFinite(t)) throw new TypeError('auth: now() must return a finite number');
  return t;
};
const noncesOf = (opts) => opts?.nonces ?? nonceCache();

/**
 * The single value of a header, or undefined when absent. A repeated header (counted in rawHeaders, or an
 * array value in a fake) is refused 400: node joins repeated unknown headers with ", ", and an identity or
 * signature header must never be ambiguous.
 */
function single(req, name) {
  const raw = req?.rawHeaders;
  if (Array.isArray(raw)) {
    let n = 0;
    for (let i = 0; i < raw.length; i += 2) if (String(raw[i]).toLowerCase() === name) n++;
    if (n > 1) refuse(400, 'duplicate-header', name);
  }
  const v = req?.headers?.[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') refuse(400, 'duplicate-header', name);
  return v;
}

/** Same as single() over a plain headers object (verifyEnvelope gets headers, not a req). */
function headerOf(headers, name) {
  const v = headers?.[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') refuse(400, 'duplicate-header', name);
  return v;
}

function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return Object.freeze(v);
}

/** Is this request on the ingress listener (the one `tailscale serve` targets)? */
export function isIngress(req, cfg) {
  const p = fleetOf(cfg).ingressPort;
  return isPort(p) && req?.socket?.localPort === p;
}

/** Delete every Tailscale-* header (identity, profile, app capabilities) from req.headers and rawHeaders. */
export function stripTailscaleHeaders(req) {
  const h = req?.headers;
  if (isObj(h)) {
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('tailscale-')) delete h[k];
  }
  const raw = req?.rawHeaders;
  if (Array.isArray(raw)) {
    for (let i = raw.length - 2; i >= 0; i -= 2) {
      if (String(raw[i]).toLowerCase().startsWith('tailscale-')) raw.splice(i, 2);
    }
  }
}

/** A URL object for `url` (URL, string path, or absent → req.url). */
function toUrl(url, req) {
  if (url instanceof URL) return url;
  return new URL(typeof url === 'string' ? url : String(req?.url ?? '/'), 'http://localhost');
}

/** Lowercase an IP literal and fold IPv4-mapped IPv6 to IPv4; null if not an IP. */
function normIp(s) {
  if (typeof s !== 'string') return null;
  let a = s.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  if (net.isIP(a) === 0) return null;
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  return m ? m[1] : a;
}

/** RFC 2047 encoded-word decoding for Tailscale-User-Name (utf-8, Q or B); display only, capped, no controls. */
export function decodeDisplayName(v) {
  if (typeof v !== 'string') return null;
  let s = v;
  try {
    s = v.replace(/=\?utf-8\?([qb])\?([^?]*)\?=/gi, (_, enc, text) => {
      if (enc.toLowerCase() === 'b') return Buffer.from(text, 'base64').toString('utf8');
      const bytes = text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (__, hex) => `%${hex}`);
      return decodeURIComponent(bytes.replace(/%(?![0-9a-f]{2})/gi, '%25'));
    });
  } catch { s = v; }
  s = s.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();
  return s ? s.slice(0, 128) : null;
}

/**
 * Tailscale-App-Capabilities (serve --accept-app-caps=laneboard.dev/cap). Inert unless present AND parseable;
 * it can only DOWNGRADE: any `{role:'read'}` grant makes a direct user read-only. Shape unverified (2.3).
 */
export function appCapsReadOnly(v) {
  if (typeof v !== 'string' || v === '' || v.length > 8192) return false;
  let caps;
  try { caps = JSON.parse(v); } catch { return false; }
  const grants = isObj(caps) ? caps['laneboard.dev/cap'] : undefined;
  if (!Array.isArray(grants)) return false;
  return grants.some((g) => isObj(g) && g.role === 'read');
}

// --- sign side (hub) ---------------------------------------------------------------------------------------

/**
 * The exact string a signed read covers: `v1 ${METHOD} ${builderId} ${pathWithQuery} ${ts} ${nonce}`.
 * `pathWithQuery` is the raw request target (`req.url`). Throws TypeError on anything that could make the
 * string ambiguous (spaces or controls in the path, a non-UUID nonce, a non-integer ts...).
 */
export function signedReadString({ method, builderId, pathWithQuery, ts, nonce } = {}) {
  if (typeof method !== 'string' || !METHOD_RE.test(method)) throw new TypeError('signedReadString: method must be an upper-case HTTP method');
  if (typeof builderId !== 'string' || !BUILDER_ID_RE.test(builderId)) throw new TypeError('signedReadString: bad builderId');
  if (typeof pathWithQuery !== 'string' || !PATH_RE.test(pathWithQuery)) throw new TypeError('signedReadString: pathWithQuery must be an origin-form request target');
  if (!Number.isSafeInteger(ts) || ts < 0) throw new TypeError('signedReadString: ts must be a non-negative integer (ms)');
  if (typeof nonce !== 'string' || !UUID_RE.test(nonce)) throw new TypeError('signedReadString: nonce must be a UUID');
  return `v1 ${method} ${builderId} ${pathWithQuery} ${ts} ${nonce}`;
}

/** The raw request target a client sends for `url` (absolute URL → pathname + search; a path is taken as is). */
function requestTarget(url) {
  if (url instanceof URL) return url.pathname + url.search;
  if (typeof url !== 'string' || url === '') throw new TypeError('signRead: url is required');
  if (url.startsWith('/')) return url;
  const u = new URL(url);
  return u.pathname + u.search;
}

/**
 * Headers for a signed read (or the /api/v1/stream upgrade): {X-Laneboard-Ts, -Nonce, -Key, -Sig}.
 * `key` is the hub's Ed25519 private KeyObject; `keyId` defaults to keyId(key).
 */
export function signRead({ method = 'GET', url, builderId, key, keyId, now = Date.now, uuid = crypto.randomUUID } = {}) {
  const ts = typeof now === 'function' ? now() : now;
  const nonce = uuid();
  const data = signedReadString({ method: String(method).toUpperCase(), builderId, pathWithQuery: requestTarget(url), ts, nonce });
  return {
    'X-Laneboard-Ts': String(ts),
    'X-Laneboard-Nonce': nonce,
    'X-Laneboard-Key': keyId ?? keyIdOf(key),
    'X-Laneboard-Sig': `ed25519 ${sign(data, key)}`,
  };
}

/** `ed25519 <base64>` over canonicalJson(env). The envelope carries no signature field. */
export function signEnvelope(env, key) {
  if (!isObj(env)) throw new TypeError('signEnvelope: envelope must be an object');
  return `ed25519 ${sign(canonicalJson(env), key)}`;
}

/** Headers for POST /api/v1/actions with `env` as the JSON body (the hub relay also sends the body). */
export function actionHeaders(env, key, keyId) {
  return {
    'Content-Type': 'application/json',
    'X-Laneboard': '1',
    'X-Laneboard-Key': keyId ?? keyIdOf(key),
    'X-Laneboard-Sig': signEnvelope(env, key),
  };
}

/** Headers for a hub terminal upgrade: the `term` envelope as base64url canonical JSON, signed. */
export function termHeaders(env, key, keyId) {
  const text = canonicalJson(env);
  return {
    'X-Laneboard-Envelope': Buffer.from(text, 'utf8').toString('base64url'),
    'X-Laneboard-Key': keyId ?? keyIdOf(key),
    'X-Laneboard-Sig': `ed25519 ${sign(text, key)}`,
  };
}

// --- verify side -------------------------------------------------------------------------------------------

function builderIdOf(cfg) {
  const id = fleetOf(cfg).id;
  if (typeof id !== 'string' || !BUILDER_ID_RE.test(id)) refuse(500, 'misconfigured', 'fleet.id');
  return id;
}

/** The pinned key entry for an X-Laneboard-Key value; 401 when missing/malformed, 403 when unknown. */
function lookupKey(kid, cfg) {
  if (kid === undefined || kid === '') refuse(401, 'missing-signature', 'X-Laneboard-Key');
  if (!KEY_ID_RE.test(kid)) refuse(401, 'malformed-signature', 'X-Laneboard-Key');
  let ring;
  try { ring = hubKeyring(fleetOf(cfg)); } catch { ring = []; }
  const k = ring.find((e) => e.keyId === kid);
  if (!k) refuse(403, 'unknown-key');
  return k;
}

function sigText(v) {
  if (v === undefined || v === '') refuse(401, 'missing-signature', 'X-Laneboard-Sig');
  const m = SIG_HEADER_RE.exec(v);
  if (!m) refuse(401, 'malformed-signature', 'X-Laneboard-Sig');
  return m[1];
}

function checkTs(ts, cfg, opts) {
  const skew = Number.isInteger(fleetOf(cfg).clockSkewMs) && fleetOf(cfg).clockSkewMs > 0 ? fleetOf(cfg).clockSkewMs : 60000;
  if (!Number.isSafeInteger(ts) || Math.abs(nowOf(opts) - ts) > skew) refuse(401, 'stale');
}

function useNonce(nonce, ts, opts) {
  const r = noncesOf(opts).add(nonce, ts);
  if (r.ok) return;
  if (r.error === 'full') refuse(503, 'nonce-cache-full');
  refuse(401, 'replay');
}

function hubAuth(k, extra) {
  return { kind: 'hub', user: null, keyId: k.keyId, keyLabel: k.label, scopes: k.scopes, ...extra };
}

/**
 * Verify a signed read on `req` (headers X-Laneboard-Ts/-Nonce/-Key/-Sig over signedReadString of the raw
 * req.url). Returns hub auth `{signature:'read', verified:true}`; needs scope `read`.
 */
export function verifyRead(req, cfg, opts = {}) {
  const tsText = single(req, 'x-laneboard-ts');
  const nonce = single(req, 'x-laneboard-nonce');
  const kid = single(req, 'x-laneboard-key');
  const sigHeader = single(req, 'x-laneboard-sig');
  if (tsText === undefined || nonce === undefined) refuse(401, 'missing-signature', 'X-Laneboard-Ts/-Nonce');
  if (!TS_RE.test(tsText) || !UUID_RE.test(nonce)) refuse(401, 'malformed-signature');
  const sig = sigText(sigHeader);
  const builderId = builderIdOf(cfg);
  const k = lookupKey(kid, cfg);
  const ts = Number(tsText);
  let data;
  try {
    data = signedReadString({ method: String(req?.method ?? '').toUpperCase(), builderId, pathWithQuery: req?.url, ts, nonce });
  } catch {
    refuse(401, 'bad-signature');
  }
  if (!verify(data, sig, k.pub)) refuse(401, 'bad-signature');
  checkTs(ts, cfg, opts);
  useNonce(nonce, ts, opts);
  if (!k.scopes.has('read')) refuse(403, 'scope-missing', 'read');
  return hubAuth(k, { signature: 'read', verified: true });
}

/**
 * Verify a parsed action (or `term`) envelope against X-Laneboard-Sig/-Key in `headers` (lower-case keys).
 * Order: headers -> key -> canonicalJson -> signature -> shape/builder -> ts -> nonce.
 * opts.action: require that action (the terminal path passes 'term').
 * Returns hub auth `{signature:'envelope'|'term', verified:true, user, envelope}`; `envelope` is re-parsed
 * from the signed canonical text and deep-frozen: act on it, never on the raw body.
 */
export function verifyEnvelope(env, headers, cfg, opts = {}) {
  if (cfg?.mode === 'hub') refuse(403, 'hub-kind-refused');
  if (!isObj(env)) refuse(400, 'bad-envelope', 'not an object');
  const sig = sigText(headerOf(headers, 'x-laneboard-sig'));
  const k = lookupKey(headerOf(headers, 'x-laneboard-key'), cfg);
  const builderId = builderIdOf(cfg);
  let text;
  try { text = canonicalJson(env); } catch { refuse(400, 'bad-envelope', 'not canonical JSON'); }
  if (!verify(text, sig, k.pub)) refuse(401, 'bad-signature');
  const e = JSON.parse(text);
  const keys = Object.keys(e);
  if (keys.length !== ENVELOPE_KEYS.length || !keys.every((x) => ENVELOPE_KEYS.includes(x))) refuse(400, 'bad-envelope', 'fields');
  if (e.v !== 1) refuse(400, 'bad-envelope', 'v');
  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) refuse(400, 'bad-envelope', 'id');
  if (!Number.isSafeInteger(e.ts)) refuse(400, 'bad-envelope', 'ts');
  if (e.builder !== builderId) refuse(401, 'wrong-builder');
  if (e.via !== 'hub') refuse(400, 'bad-envelope', 'via');
  if (typeof e.user !== 'string' || !ENVELOPE_USER_RE.test(e.user)) refuse(400, 'bad-envelope', 'user');
  if (typeof e.action !== 'string' || !ACTION_RE.test(e.action)) refuse(400, 'bad-envelope', 'action');
  if (typeof e.target !== 'string' || e.target.length > 256) refuse(400, 'bad-envelope', 'target');
  if (!isObj(e.args)) refuse(400, 'bad-envelope', 'args');
  if (opts.action !== undefined && e.action !== opts.action) refuse(403, 'wrong-action');
  checkTs(e.ts, cfg, opts);
  useNonce(e.id, e.ts, opts);
  return hubAuth(k, { signature: e.action === 'term' && opts.action === 'term' ? 'term' : 'envelope', verified: true, user: e.user, envelope: deepFreeze(e) });
}

/** Decode and verify the X-Laneboard-Envelope of a hub terminal upgrade (must be canonical JSON). */
function verifyTermHeader(req, cfg, opts) {
  const raw = single(req, 'x-laneboard-envelope');
  if (raw.length > MAX_ENVELOPE_HEADER || !/^[A-Za-z0-9_-]+$/.test(raw)) refuse(400, 'bad-envelope', 'encoding');
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  let env;
  try { env = JSON.parse(text); } catch { refuse(400, 'bad-envelope', 'json'); }
  if (!isObj(env)) refuse(400, 'bad-envelope', 'not an object');
  let canon;
  try { canon = canonicalJson(env); } catch { refuse(400, 'bad-envelope', 'not canonical JSON'); }
  if (canon !== text) refuse(400, 'bad-envelope', 'not canonical');
  const headers = { 'x-laneboard-sig': single(req, 'x-laneboard-sig'), 'x-laneboard-key': single(req, 'x-laneboard-key') };
  return verifyEnvelope(env, headers, cfg, { ...opts, action: 'term' });
}

function peerUidOk(req, expected, opts) {
  const sock = req?.socket;
  let uid;
  if (sock && Object.hasOwn(sock, 'lbPeerUid')) uid = sock.lbPeerUid;
  else {
    const lookup = typeof opts.peerUid === 'function' ? opts.peerUid : socketPeerUid;
    try { uid = lookup(sock); } catch { uid = null; }
  }
  return Number.isInteger(uid) && uid === expected;
}

/**
 * Classify a request (2.3). Returns
 *   {kind:'local', user}                              CLI, hooks, scripts (non-ingress listener)
 *   {kind:'direct', user, name, readOnly}             a user's device through tailscale serve
 *   {kind:'hub', user, keyId, keyLabel, scopes, signature:'read'|'term'|'envelope', verified, envelope?}
 * or throws AuthError. `signature:'envelope'` with `verified:false` means only the key was looked up: the
 * actions route must verifyEnvelope(parsedBody, req.headers, cfg) before acting.
 * opts: {nonces, now, peerUid(socket) -> uid|null, warn}.
 */
export function classify(req, cfg, opts = {}) {
  const f = fleetOf(cfg);
  if (!isPort(f.ingressPort)) {
    // No ingress listener (standalone, no fleet block): everything is local; the login is attribution only.
    const login = single(req, 'tailscale-user-login');
    return { kind: 'local', user: typeof login === 'string' && LOGIN_RE.test(login) ? login : 'local' };
  }
  if (!isIngress(req, cfg)) {
    stripTailscaleHeaders(req);
    return { kind: 'local', user: 'local' };
  }

  const url = toUrl(undefined, req);
  for (const p of url.searchParams.keys()) {
    if (QUERY_SIGNATURE_PARAMS.includes(p.toLowerCase())) refuse(401, 'query-signature-not-allowed');
  }
  const xff = single(req, 'x-forwarded-for');
  const xfp = single(req, 'x-forwarded-proto');
  if (typeof xff !== 'string' || xff.trim() === '' || xfp !== 'https') refuse(403, 'not-from-serve');
  if (f.ingressPeerUid !== null && f.ingressPeerUid !== undefined) {
    if (!peerUidOk(req, f.ingressPeerUid, opts)) refuse(403, 'not-from-serve', 'peer uid');
  }

  const login = single(req, 'tailscale-user-login');
  const signed = single(req, 'x-laneboard-sig') !== undefined || single(req, 'x-laneboard-envelope') !== undefined;
  if (login !== undefined && signed) refuse(400, 'ambiguous-identity');

  if (login !== undefined) {
    if (!LOGIN_RE.test(login)) refuse(403, 'unidentified', 'bad login');
    const allowed = Array.isArray(f.allowedUsers) ? f.allowedUsers : [];
    if (allowed.length > 0 && !allowed.includes(login)) refuse(403, 'user-not-allowed');
    return {
      kind: 'direct',
      user: login,
      name: decodeDisplayName(single(req, 'tailscale-user-name')),
      readOnly: appCapsReadOnly(single(req, 'tailscale-app-capabilities')),
    };
  }

  if (signed) {
    if (cfg?.mode === 'hub') refuse(403, 'hub-kind-refused');
    const hubAddrs = Array.isArray(f.hubAddrs) ? f.hubAddrs.map(normIp).filter(Boolean) : [];
    if (hubAddrs.length > 0 && !hubAddrs.includes(normIp(xff))) refuse(403, 'hub-addr');
    if (single(req, 'x-laneboard-envelope') !== undefined) return verifyTermHeader(req, cfg, opts);
    if (single(req, 'x-laneboard-ts') !== undefined || single(req, 'x-laneboard-nonce') !== undefined) return verifyRead(req, cfg, opts);
    sigText(single(req, 'x-laneboard-sig'));
    const k = lookupKey(single(req, 'x-laneboard-key'), cfg);
    return hubAuth(k, { signature: 'envelope', verified: false });
  }

  if (f.enforce !== false) refuse(403, 'unidentified');
  return { kind: 'direct', user: 'local', name: null, readOnly: false };
}

// --- guards ------------------------------------------------------------------------------------------------

const LOOPBACK_HOST_RE = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(?::\d{1,5})?$/i;

/** Host, with the listener-specific narrowing: ingress → fleet.publicHosts; local listener → loopback names. */
function guardHost(req, cfg, { allowMissing, ingress }, opts) {
  const ctx = { allowMissingHost: allowMissing, trustForwardedProto: ingress };
  if (isPort(req?.socket?.localPort)) ctx.listenPort = req.socket.localPort;
  const bad = checkHost(req, cfg, ctx);
  if (bad) refuse(403, bad);
  const host = typeof req?.headers?.host === 'string' ? req.headers.host.toLowerCase() : undefined;
  if (host === undefined) return;
  const f = fleetOf(cfg);
  if (ingress) {
    const pub = Array.isArray(f.publicHosts) ? f.publicHosts.map((h) => String(h).toLowerCase()) : [];
    if (pub.length === 0) {
      warnOnce(opts, 'public-hosts', 'laneboard: fleet.publicHosts is empty; any allowed Host is accepted on the ingress listener');
    } else if (!pub.includes(host)) refuse(403, 'bad-host');
  } else if (isPort(f.ingressPort) && !LOOPBACK_HOST_RE.test(host)) {
    refuse(403, 'bad-host');
  }
}

function guardOrigin(req, cfg, auth, { ingress, requireOrigin }) {
  const origin = req?.headers?.origin;
  if (auth.kind === 'hub') {
    // A browser cannot sign: a signed request carrying browser headers is a confused deputy.
    if (origin !== undefined) refuse(403, 'origin-on-hub');
    if (req?.headers?.['sec-fetch-site'] !== undefined) refuse(403, 'origin-on-hub');
    return;
  }
  if (origin === undefined && requireOrigin) refuse(403, 'no-origin');
  const ctx = { trustForwardedProto: ingress };
  if (isPort(req?.socket?.localPort)) ctx.listenPort = req.socket.localPort;
  const bad = checkOrigin(req, cfg, ctx);
  if (bad) refuse(403, bad);
  const sfs = req?.headers?.['sec-fetch-site'];
  if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') refuse(403, 'sec-fetch-site');
}

/** Hub kind may only touch normalized /api/v1/ paths: no encoded slashes/backslashes, no dot segments. */
function hubPathOk(url) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/')) return false;
  if (/%2f|%5c|%2e/i.test(p)) return false;
  let d;
  try { d = decodeURIComponent(p); } catch { return false; }
  return !d.split('/').some((s) => s === '.' || s === '..') && !d.includes('\\');
}

function authOf(req, cfg, opts) {
  if (isObj(req?.auth) && typeof req.auth.kind === 'string') return req.auth;
  const a = classify(req, cfg, opts);
  if (req && typeof req === 'object') req.auth = a;
  return a;
}

/**
 * Guard an HTTP request (2.5). Call after classify (uses req.auth, else classifies and sets it). Returns the
 * auth; throws AuthError. `url` is the request URL (URL or string; default req.url).
 *   - Host on every request (missing Host only for non-mutating requests off ingress);
 *   - hub kind: only /api/v1/ paths; GET/HEAD need a verified read signature; POST only /api/v1/actions with
 *     an envelope signature (still to be verified by the route); refused on a hub process;
 *   - mutating: read-only direct users refused; hook intake local-only when enforcing; Origin exact
 *     (none for hub) and Sec-Fetch-Site; X-Laneboard: 1; JSON content-type on /api/v1/actions from remote.
 */
export function guardRequest(req, url, cfg, opts = {}) {
  const u = toUrl(url, req);
  const method = String(req?.method ?? 'GET').toUpperCase();
  const mutating = isMutating(method);
  const ingress = isIngress(req, cfg);
  guardHost(req, cfg, { allowMissing: !mutating && !ingress, ingress }, opts);
  const auth = authOf(req, cfg, opts);
  const f = fleetOf(cfg);

  if (auth.kind === 'hub') {
    if (cfg?.mode === 'hub') refuse(403, 'hub-kind-refused');
    if (!hubPathOk(u)) refuse(403, 'hub-not-allowed');
    if (method === 'GET' || method === 'HEAD') {
      if (auth.signature !== 'read' || auth.verified !== true) refuse(403, 'read-signature-required');
      if (!auth.scopes?.has?.('read')) refuse(403, 'scope-missing', 'read');
    } else if (method === 'POST' && u.pathname === '/api/v1/actions') {
      if (auth.signature === 'read') refuse(403, 'read-signature-not-allowed');
      if (auth.signature !== 'envelope') refuse(403, 'envelope-required');
    } else {
      refuse(403, auth.signature === 'read' ? 'read-signature-not-allowed' : 'hub-not-allowed');
    }
  }

  if (!mutating) return auth;

  if (auth.kind === 'direct' && auth.readOnly === true) refuse(403, 'read-only');
  if (HOOK_PATHS.has(u.pathname) && auth.kind !== 'local' && f.enforce !== false && isPort(f.ingressPort)) refuse(403, 'local-only');
  guardOrigin(req, cfg, auth, { ingress, requireOrigin: false });
  const csrf = checkCsrf(req, u.pathname);
  if (csrf) refuse(403, csrf);
  if (u.pathname === '/api/v1/actions' && auth.kind !== 'local') {
    const ct = req?.headers?.['content-type'];
    if (typeof ct !== 'string' || !/^application\/json\s*(?:;.*)?$/i.test(ct)) refuse(415, 'json-required');
  }
  return auth;
}

/** Clamp like terminals.mjs clampDim; null for a non-number. */
function clampDim(v, [lo, hi]) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
}

/** The `term` args a hub must have signed for this upgrade URL: {cols?, rows?, window?} from the query. */
export function termArgsFromQuery(searchParams) {
  const out = {};
  if (searchParams.has('cols')) out.cols = clampDim(searchParams.get('cols'), TERM_COLS);
  if (searchParams.has('rows')) out.rows = clampDim(searchParams.get('rows'), TERM_ROWS);
  if (searchParams.has('window')) out.window = searchParams.get('window');
  return out;
}

function checkTermEnvelope(auth, u, m) {
  const env = auth.envelope;
  let name;
  try { name = decodeURIComponent(m[1]); } catch { refuse(403, 'envelope-mismatch', 'path'); }
  if (env.target !== name) refuse(403, 'envelope-mismatch', 'target');
  const want = termArgsFromQuery(u.searchParams);
  if (want.cols === null || want.rows === null) refuse(403, 'envelope-mismatch', 'query');
  if (want.window !== undefined && !WINDOW_RE.test(want.window)) refuse(403, 'envelope-mismatch', 'window');
  const got = env.args;
  const gk = Object.keys(got).sort();
  const wk = Object.keys(want).sort();
  if (gk.length !== wk.length || gk.some((k, i) => k !== wk[i] || got[k] !== want[k])) refuse(403, 'envelope-mismatch', 'args');
}

/**
 * Guard a WebSocket upgrade (2.5). Call first in the upgrade handler; returns the auth or throws AuthError
 * (answer with writeUpgradeRefusal). Rules:
 *   - Host always (never missing);
 *   - legacy /ws, /ws/term/* and every other path: local or direct only;
 *   - /api/v1/stream: also hub with a verified read signature and scope read;
 *   - /api/v1/term/:name: hub only with a verified `term` envelope bound to the path and the clamped query,
 *     fleet.hubControl true (403 control-disabled) and scope term (403 scope-missing); a read signature 403;
 *   - direct needs an exact Origin; local may omit it; hub must not send one; Sec-Fetch-Site same-origin|none;
 *   - read-only direct users cannot open terminals.
 */
export function guardUpgrade(req, url, cfg, opts = {}) {
  const u = toUrl(url, req);
  const ingress = isIngress(req, cfg);
  guardHost(req, cfg, { allowMissing: false, ingress }, opts);
  const auth = authOf(req, cfg, opts);
  const termMatch = TERM_PATH_RE.exec(u.pathname);
  const isTerm = termMatch !== null || u.pathname.startsWith('/ws/term/');

  if (auth.kind === 'hub') {
    if (cfg?.mode === 'hub') refuse(403, 'hub-kind-refused');
    if (u.pathname === '/api/v1/stream') {
      if (auth.signature !== 'read' || auth.verified !== true) refuse(403, 'read-signature-required');
      if (!auth.scopes?.has?.('read')) refuse(403, 'scope-missing', 'read');
    } else if (termMatch) {
      if (auth.signature === 'read') refuse(403, 'read-signature-not-allowed');
      if (auth.signature !== 'term' || auth.verified !== true) refuse(401, 'missing-signature', 'term envelope');
      if (fleetOf(cfg).hubControl !== true) refuse(403, 'control-disabled');
      if (!auth.scopes?.has?.('term')) refuse(403, 'scope-missing', 'term');
      checkTermEnvelope(auth, u, termMatch);
    } else {
      refuse(403, auth.signature === 'read' ? 'read-signature-not-allowed' : 'hub-not-allowed');
    }
  }

  guardOrigin(req, cfg, auth, { ingress, requireOrigin: auth.kind === 'direct' });
  if (isTerm && auth.kind === 'direct' && auth.readOnly === true) refuse(403, 'read-only');
  return auth;
}

/** Answer a refused upgrade on the raw socket (status line only, no body, no detail) and close it. */
export function writeUpgradeRefusal(socket, err) {
  const status = err instanceof AuthError && STATUS_TEXT[err.status] ? err.status : 403;
  try {
    socket.once?.('finish', () => socket.destroy());
    setTimeout(() => socket.destroy?.(), 1000).unref?.();
    socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    try { socket.destroy?.(); } catch { /* already gone */ }
  }
}
