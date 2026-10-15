// Security baseline (fleet plan §1 2.6, SECURITY-FIXES S10/S17). REVIEW-REQUIRED (SR7).
//
// Pure functions over a request-like object `{method, headers, socket?}` and
// the merged config. No imports: http.mjs, boot/common.mjs, the hub and
// server/fleet/auth.mjs (§2 A4) all call these; nobody re-implements them.
//
//   checkHost    the Host header must be one of allowedHosts(config), compared
//                as `host:port` (tailscale serve preserves `Host: <name>:8443`).
//                Defends against DNS rebinding. Every request and upgrade.
//   checkOrigin  no Origin header is fine (curl, the CLI, hooks, node ws); a
//                present Origin must be exactly the request's own origin, the
//                publicUrl origin or one of fleet.allowedOrigins. Never
//                same-site matching.
//   checkCsrf    every mutating request needs `X-Laneboard: 1`, except the
//                local hook intake paths. Because OPTIONS is answered 405 (no
//                CORS preflight ever succeeds) a cross-site page cannot add
//                that header, so it is a CSRF barrier.
//
// Each check returns null when the request passes, else the reason string
// ('bad-host', 'bad-origin', 'no-csrf-header') that goes into the 403 body.

/** Hook intake: plain curl from Claude Code hooks (deploy/hooks.json), no custom header. */
export const HOOK_PATHS = new Set(['/api/hook', '/api/hook/permission']);

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]'];
const WILDCARD_BINDS = new Set(['0.0.0.0', '::', '[::]', '']);

const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

/** `addr:port`, with brackets for an IPv6 literal. */
function hostPort(addr, port) {
  const a = String(addr).toLowerCase();
  return a.includes(':') && !a.startsWith('[') ? `[${a}]:${port}` : `${a}:${port}`;
}

/** URL.host of `u` (lowercase, default port omitted, as a browser sends Host), or null. */
function urlHost(u) {
  if (typeof u !== 'string' || u === '') return null;
  try {
    const h = new URL(u).host;
    return h ? h.toLowerCase() : null;
  } catch {
    return null;
  }
}

function urlOrigin(u) {
  if (typeof u !== 'string' || u === '') return null;
  try {
    const o = new URL(u).origin;
    return o && o !== 'null' ? o : null;
  } catch {
    return null;
  }
}

const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : []);

/**
 * Every Host value this laneboard answers to, as lowercase `host[:port]`:
 * loopback names with `port` and with `fleet.ingressPort`, each concrete
 * (non-wildcard) bind address with `port`, the host of `publicUrl`,
 * `fleet.publicHosts`, and the hosts of `fleet.allowedOrigins`.
 */
export function allowedHosts(config) {
  const c = config || {};
  const f = (c.fleet && typeof c.fleet === 'object') ? c.fleet : {};
  const set = new Set();
  const ports = [c.port, f.ingressPort].filter(isPort);
  for (const p of ports) for (const n of LOOPBACK_NAMES) set.add(`${n}:${p}`);
  if (isPort(c.port)) {
    for (const a of listOf(c.bindAddresses ?? c.bind)) {
      if (!WILDCARD_BINDS.has(a)) set.add(hostPort(a, c.port));
    }
  }
  const pub = urlHost(c.publicUrl);
  if (pub) set.add(pub);
  for (const h of listOf(f.publicHosts)) set.add(h.toLowerCase());
  for (const o of listOf(f.allowedOrigins)) {
    const h = urlHost(o);
    if (h) set.add(h);
  }
  return set;
}

/** The first value of a header (node may hand an array for repeated custom headers). */
function header(req, name) {
  const v = req?.headers?.[name];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/**
 * DNS-rebinding defence: null when the Host header is allowed, else 'bad-host'.
 * A request with no Host header at all passes: every browser sends Host, and
 * node refuses HTTP/1.1 requests without one, so only HTTP/1.0 tools (and the
 * in-process fakes used by tests) arrive here without it.
 */
export function checkHost(req, config) {
  const raw = req?.headers?.host;
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw === '') return 'bad-host';
  return allowedHosts(config).has(raw.toLowerCase()) ? null : 'bad-host';
}

/** 'https' when the request reached us over TLS or through tailscale serve's https, else 'http'. */
function requestProto(req) {
  if (req?.socket?.encrypted) return 'https';
  const xfp = header(req, 'x-forwarded-proto');
  return xfp === 'https' ? 'https' : 'http';
}

/**
 * null when the Origin header is absent or exactly allowed, else 'bad-origin'.
 * Allowed: `${proto}://${Host}` (the page's own origin), the origin of
 * `publicUrl`, and each `fleet.allowedOrigins` entry. Exact string
 * comparison; 'null' and anything malformed are refused.
 */
export function checkOrigin(req, config) {
  const raw = req?.headers?.origin;
  if (raw === undefined) return null;
  const origin = header(req, 'origin');
  if (!origin || origin === 'null') return 'bad-origin';
  const host = header(req, 'host');
  if (host && origin === `${requestProto(req)}://${host.toLowerCase()}`) return null;
  const c = config || {};
  if (origin === urlOrigin(c.publicUrl)) return null;
  const f = (c.fleet && typeof c.fleet === 'object') ? c.fleet : {};
  if (listOf(f.allowedOrigins).includes(origin)) return null;
  return 'bad-origin';
}

/** Anything but GET/HEAD/OPTIONS changes state and needs the CSRF header. */
export function isMutating(method) {
  const m = String(method || 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/** null unless a mutating request off the hook paths lacks `X-Laneboard: 1` ('no-csrf-header'). */
export function checkCsrf(req, pathname) {
  if (!isMutating(req?.method)) return null;
  if (HOOK_PATHS.has(pathname)) return null;
  return header(req, 'x-laneboard') === '1' ? null : 'no-csrf-header';
}

// A Host that already passed checkHost, but be strict anyway before putting it
// into a header value.
const SAFE_HOST_RX = /^[a-z0-9.\-[\]:]{1,255}$/i;

/** The page CSP. `ws://<Host> wss://<Host>` spelled out: older WebKit does not match ws to 'self'. */
export function contentSecurityPolicy(host) {
  const h = typeof host === 'string' && SAFE_HOST_RX.test(host) ? host.toLowerCase() : null;
  const connect = h ? `connect-src 'self' ws://${h} wss://${h}` : "connect-src 'self'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    // xterm's DOM renderer injects <style> elements.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    connect,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Headers for a response: always `X-Content-Type-Options: nosniff` and
 * `Referrer-Policy: no-referrer`; with `html`, also the CSP.
 */
export function securityHeaders(req, { html = false } = {}) {
  const h = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (html) h['content-security-policy'] = contentSecurityPolicy(header(req, 'host'));
  return h;
}

/**
 * Host + Origin for a WebSocket upgrade (boot/common.mjs listenAll; §2 A8
 * replaces the call with auth.guardUpgrade, which uses these same checks).
 */
export function checkUpgrade(req, config) {
  return checkHost(req, config) || checkOrigin(req, config);
}

/**
 * Host for every request, then Origin and the CSRF header for mutating ones.
 * null or the first failing reason.
 */
export function checkRequest(req, pathname, config) {
  const host = checkHost(req, config);
  if (host) return host;
  if (!isMutating(req?.method)) return null;
  return checkOrigin(req, config) || checkCsrf(req, pathname);
}

const lastWarn = new Map();
/** Call `warn(reason, detail)` at most once a minute per reason. */
export function warnRateLimited(warn, reason, detail, now = Date.now()) {
  const t = lastWarn.get(reason);
  if (t !== undefined && now - t < 60000) return false;
  lastWarn.set(reason, now);
  warn(reason, detail);
  return true;
}
