// Signed read proxy (fleet plan §3 2.14, H12). REVIEW-REQUIRED (SR14).
//
//   createReadProxy({store, key, keyId, fetchImpl, now, cfg, classify?})
//     -> { get(builderId, pathWithQuery, {timeoutMs}?) -> Promise<{status, json}>,
//          route(req, res) -> Promise<boolean> }
//
// `route` serves `GET /api/fleet/:builder/v1/<rest>` and forwards it to
// `{builder.url}/api/v1/<rest>` with `auth.signRead` headers (README 3.2:
// `v1 METHOD builderId pathWithQuery ts nonce`, headers only, never a query
// signature). It resolves `true` when the request was under that prefix (and
// was answered), `false` otherwise (the caller 404s). Hub services call `get`
// for fan-outs (morning, credit, archive, audit pulls) with their own timeout.
//
// Trust rules (SECURITY-FIXES S2, S3, S5, S16):
// - The builder is chosen ONLY by the `:builder` path id, validated against
//   BUILDER_ID_RX and looked up in the fleet store; the URL comes from the
//   hub's own config (store entry), never from the request or from a builder.
//   Unknown or non-`up` builder -> 503 {error:'builder down', state, ageMs}.
// - `<rest>` must match the fixed ALLOWLIST below, both as received and after
//   WHATWG URL normalization (what is signed and sent is the normalized
//   target, so the builder's `req.url` equals the signed string). A segment
//   that is or decodes to `.`/`..`, contains an encoded `/` or `\`, `%2e`,
//   a NUL/control, or fails to decode -> 404. Only GET (else 405).
// - Nothing from the browser request is forwarded: no headers, no body, no
//   cookies. The hub sends only the four signature headers plus `accept`
//   and `accept-encoding: identity`. Redirects are not followed (a 3xx is a 502).
// - The builder's answer is untrusted: content-type must be application/json
//   (else 502), the body is read with a hard byte cap (4 MiB, else 502) and a
//   timeout (route 10 s; callers of get() pass theirs, e.g. 3 s), it must
//   parse as JSON (else 502) and is re-serialized by the hub. Builder headers
//   are dropped except RESPONSE_HEADER_ALLOWLIST (validated). A builder 401,
//   403 or 407 (the builder refusing the HUB's signature) and every 1xx/3xx/5xx
//   become 502, so the browser never mistakes them for its own auth state.
// - Nothing is cached or persisted. Keys, signatures, nonces and query
//   strings are never logged.
// - The route itself requires kind `direct` or `local` (req.auth set by the
//   hub's classify, or opts.classify(req)); anything else -> 403 (fail closed).
//
// Hub module: imports only server/fleet/*, server/security.mjs and node
// built-ins (never a builder-only module).
import { signRead } from '../fleet/auth.mjs';
import { BUILDER_ID_RX } from '../fleet/keys.mjs';
import { securityHeaders } from '../security.mjs';

/** Fixed allowlist on `<rest>` (path + query after /api/v1/), §3 2.14. Anchored. */
// Deviation (tightening only): `sessions/[^/]{1,64}` is `[^/?#]{1,64}` here, so
// a `?` can never sit inside the session segment and move the builder's path
// boundary (`sessions/a?b/transcript` would otherwise match).
export const ALLOWLIST = Object.freeze([
  /^hello$/,
  /^snapshot$/,
  /^health(\?history=1)?$/,
  /^approvals$/,
  /^jobs\/[A-Za-z0-9-]{1,64}$/,
  /^audit\?.*$/,
  /^morning(\?window=[a-z0-9]{1,8})?$/,
  /^credit$/,
  /^lanes\/[a-z0-9][a-z0-9._-]{0,63}\/diff(\?.*)?$/,
  /^sessions\/[^/?#]{1,64}\/transcript(\?.*)?$/,
  /^sessions\/[^/?#]{1,64}\/preview(\?n=\d{1,3})?$/,
  /^archive(\?.*)?$/,
  /^archive\/[a-z0-9][a-z0-9._-]{0,63}$/,
]);

export const RESPONSE_CAP = 4 * 1024 * 1024;
export const ROUTE_TIMEOUT_MS = 10_000;
export const MAX_INFLIGHT_PER_BUILDER = 32;
/** Builder response headers re-emitted (validated); everything else is dropped. */
export const RESPONSE_HEADER_ALLOWLIST = Object.freeze({ 'retry-after': /^\d{1,6}$/ });

const PREFIX_RX = /^\/api\/fleet\/([^/?#]*)\/v1\/(.*)$/s;
const JSON_CT_RX = /^application\/json\s*(;.*)?$/i;
const REST_MAX = 2048;
// Raw rest: printable ASCII only (Node already refuses spaces/controls in a request line).
const PRINTABLE_RX = /^[\x21-\x7e]*$/;
const BAD_ESCAPE_RX = /%(2f|5c|2e|00)/i;

export class ReadProxyError extends Error {
  constructor(status, body) {
    super(body?.error ?? 'read proxy error');
    this.status = status;
    this.body = body;
  }
}

const notFound = () => new ReadProxyError(404, { ok: false, error: 'not found' });

/** Is `rest` (path + optional query after /api/v1/) structurally safe and allowlisted? */
export function isAllowed(rest) {
  if (typeof rest !== 'string' || rest === '' || rest.length > REST_MAX) return false;
  if (!PRINTABLE_RX.test(rest) || rest.includes('\\') || rest.includes('#')) return false;
  const q = rest.indexOf('?');
  const pathPart = q === -1 ? rest : rest.slice(0, q);
  for (const seg of pathPart.split('/')) {
    if (seg === '' || BAD_ESCAPE_RX.test(seg)) return false;
    let dec;
    try { dec = decodeURIComponent(seg); } catch { return false; }
    // eslint-disable-next-line no-control-regex
    if (dec === '.' || dec === '..' || dec.includes('/') || dec.includes('\\') || /[\x00-\x1f\x7f]/.test(dec)) return false;
  }
  return ALLOWLIST.some((rx) => rx.test(rest));
}

/** `/api/v1/<rest>` or `<rest>` -> `<rest>`; anything else -> null. */
function restOf(pathWithQuery) {
  if (typeof pathWithQuery !== 'string') return null;
  if (pathWithQuery.startsWith('/api/v1/')) return pathWithQuery.slice('/api/v1/'.length);
  if (pathWithQuery.startsWith('/')) return null;
  return pathWithQuery;
}

function numOr(v, d, lo = 1) {
  return Number.isFinite(v) && v >= lo ? v : d;
}

function effectiveState(entry, now, staleMs, downMs) {
  const s = entry?.conn?.state ?? 'unknown';
  const seen = entry?.conn?.lastSeen;
  if ((s === 'up' || s === 'stale') && Number.isFinite(seen)) {
    const age = now - seen;
    if (age >= downMs) return 'down';
    if (age >= staleMs) return 'stale';
  }
  return s;
}

/** Read at most `cap` bytes of a fetch Response body; throws ReadProxyError(502) past it. */
async function readCapped(res, cap) {
  const len = res.headers.get('content-length');
  if (len !== null && /^\d+$/.test(len) && Number(len) > cap) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new ReadProxyError(502, { ok: false, error: 'response too large' });
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new ReadProxyError(502, { ok: false, error: 'response too large' });
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, n);
}

export function createReadProxy({ store, key, keyId, fetchImpl = globalThis.fetch, now = Date.now, cfg = {}, classify = null } = {}) {
  if (!store || typeof store.builder !== 'function') throw new TypeError('read-proxy: store is required');
  if (!key) throw new TypeError('read-proxy: key is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('read-proxy: fetchImpl is required');
  const fleet = cfg && typeof cfg === 'object' && cfg.fleet && typeof cfg.fleet === 'object' ? cfg.fleet : (cfg ?? {});
  const staleMs = numOr(fleet.staleMs, 15_000);
  const downMs = numOr(fleet.downMs, 60_000);
  const cap = numOr(fleet.readProxyCap ?? cfg.responseCap, RESPONSE_CAP);
  const routeTimeoutMs = numOr(fleet.readProxyTimeoutMs ?? cfg.timeoutMs, ROUTE_TIMEOUT_MS);
  const maxInflight = numOr(fleet.readProxyMaxInflight ?? cfg.maxInflight, MAX_INFLIGHT_PER_BUILDER);
  const inflight = new Map(); // builder id -> count

  /** Resolve the builder or throw 503 / 404. */
  function upBuilder(builderId, t) {
    if (typeof builderId !== 'string' || !BUILDER_ID_RX.test(builderId)) throw notFound();
    const entry = store.builder(builderId);
    if (!entry) throw new ReadProxyError(503, { ok: false, error: 'builder down', state: 'unknown', ageMs: null });
    const state = effectiveState(entry, t, staleMs, downMs);
    if (state !== 'up') {
      const seen = entry.conn?.lastSeen;
      throw new ReadProxyError(503, { ok: false, error: 'builder down', state, ageMs: Number.isFinite(seen) ? Math.max(0, t - seen) : null });
    }
    return entry;
  }

  /** The normalized absolute target URL for `<rest>` on `entry`, re-checked after normalization. */
  function targetUrl(entry, rest) {
    let base;
    try { base = new URL(entry.url); } catch { throw new ReadProxyError(503, { ok: false, error: 'builder down', state: 'misconfigured', ageMs: null }); }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new ReadProxyError(503, { ok: false, error: 'builder down', state: 'misconfigured', ageMs: null });
    const u = new URL(`/api/v1/${rest}`, base.origin);
    if (u.origin !== base.origin) throw notFound();
    const target = u.pathname + u.search;
    if (!target.startsWith('/api/v1/') || !isAllowed(target.slice('/api/v1/'.length))) throw notFound();
    return u;
  }

  /** Forward one allowlisted read. Resolves {status, json, headers}; throws ReadProxyError. */
  async function forward(builderId, rest, timeoutMs) {
    if (!isAllowed(rest)) throw notFound();
    const t = now();
    const entry = upBuilder(builderId, t);
    const u = targetUrl(entry, rest);
    const n = inflight.get(builderId) ?? 0;
    if (n >= maxInflight) throw new ReadProxyError(429, { ok: false, error: 'too many reads' });
    inflight.set(builderId, n + 1);
    try {
      const headers = {
        ...signRead({ method: 'GET', url: u, builderId, key, keyId, now: () => now() }),
        accept: 'application/json',
        'accept-encoding': 'identity',
      };
      let res;
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        res = await fetchImpl(u.href, { method: 'GET', headers, redirect: 'manual', signal });
      } catch {
        if (signal.aborted) throw new ReadProxyError(504, { ok: false, error: 'builder timeout' });
        throw new ReadProxyError(503, { ok: false, error: 'builder unreachable' });
      }
      const status = res.status;
      const ct = res.headers.get('content-type') ?? '';
      if (status < 200 || status > 499 || (status >= 300 && status < 400) || status === 401 || status === 403 || status === 407) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        throw new ReadProxyError(502, { ok: false, error: 'bad upstream status', status });
      }
      if (!JSON_CT_RX.test(ct)) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        throw new ReadProxyError(502, { ok: false, error: 'bad upstream content-type' });
      }
      let buf;
      try {
        buf = await readCapped(res, cap);
      } catch (err) {
        if (err instanceof ReadProxyError) throw err;
        if (signal.aborted) throw new ReadProxyError(504, { ok: false, error: 'builder timeout' });
        throw new ReadProxyError(502, { ok: false, error: 'bad upstream response' });
      }
      let json;
      try { json = JSON.parse(buf.toString('utf8')); } catch { throw new ReadProxyError(502, { ok: false, error: 'bad upstream json' }); }
      const out = {};
      for (const [name, rx] of Object.entries(RESPONSE_HEADER_ALLOWLIST)) {
        const v = res.headers.get(name);
        if (v !== null && rx.test(v)) out[name] = v;
      }
      return { status, json, headers: out };
    } finally {
      const m = (inflight.get(builderId) ?? 1) - 1;
      if (m <= 0) inflight.delete(builderId); else inflight.set(builderId, m);
    }
  }

  /**
   * For hub services: `get(builderId, '/api/v1/morning?window=24h')` (or the bare `<rest>`).
   * Never throws: failures resolve as {status, json:{ok:false, error, ...}}.
   */
  async function get(builderId, pathWithQuery, { timeoutMs = routeTimeoutMs } = {}) {
    try {
      const rest = restOf(pathWithQuery);
      if (rest === null) throw notFound();
      const { status, json } = await forward(builderId, rest, numOr(timeoutMs, routeTimeoutMs));
      return { status, json };
    } catch (err) {
      if (err instanceof ReadProxyError) return { status: err.status, json: err.body };
      return { status: 502, json: { ok: false, error: 'read proxy error' } };
    }
  }

  function send(res, status, body, extra = {}) {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-store',
      ...securityHeaders(null),
      ...extra,
    });
    res.end(buf);
  }

  function authOf(req) {
    if (req.auth && typeof req.auth === 'object') return req.auth;
    if (typeof classify === 'function') {
      try { return classify(req); } catch { return null; }
    }
    return null;
  }

  async function route(req, res) {
    const raw = typeof req?.url === 'string' ? req.url : '';
    const m = PREFIX_RX.exec(raw);
    if (!m) return false;
    try {
      const auth = authOf(req);
      if (!auth || (auth.kind !== 'direct' && auth.kind !== 'local')) {
        send(res, 403, { ok: false, error: 'forbidden' });
        return true;
      }
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' }, { allow: 'GET' });
        return true;
      }
      const { status, json, headers } = await forward(m[1], m[2], routeTimeoutMs);
      send(res, status, json, headers);
    } catch (err) {
      if (err instanceof ReadProxyError) send(res, err.status, err.body);
      else send(res, 502, { ok: false, error: 'read proxy error' });
    }
    return true;
  }

  return { get, route };
}
