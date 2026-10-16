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
//
// The checks take an optional context `ctx` (SR7 L2/L6):
//   ctx.trustForwardedProto  true only on the ingress listener / for requests
//                            classified as tailscale serve ingress (§2 A8):
//                            then X-Forwarded-Proto is honoured. Default: it
//                            is ignored unless publicUrl is https and the Host
//                            is not a loopback name (see requestProto).
//   ctx.listenPort           the port the request actually arrived on. A
//                            loopback publicUrl (the default
//                            http://127.0.0.1:7777) is trusted only when its
//                            port is this one (default: config.port or
//                            fleet.ingressPort).

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

/** True for 127.0.0.0/8, localhost and [::1] (lowercase URL.hostname form). */
function isLoopbackName(hostname) {
  const h = String(hostname).toLowerCase();
  return h === 'localhost' || h === '[::1]' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The hostname part of a lowercase `host[:port]` value. */
function hostnameOf(host) {
  const h = String(host).toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

/** The ports this laneboard listens on, per ctx.listenPort or the config. */
function listenPorts(c, f, ctx) {
  if (isPort(ctx?.listenPort)) return [ctx.listenPort];
  return [c.port, f.ingressPort].filter(isPort);
}

/**
 * `publicUrl`, or null when it is a loopback URL on a port we do not listen on
 * (SR7 L6: the default http://127.0.0.1:7777 on an instance that only changed
 * its port must not trust whatever else serves 127.0.0.1:7777).
 */
function trustedPublicUrl(c, f, ctx) {
  const u = c.publicUrl;
  if (typeof u !== 'string' || u === '') return null;
  let url;
  try { url = new URL(u); } catch { return null; }
  if (!isLoopbackName(url.hostname)) return u;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  return listenPorts(c, f, ctx).includes(port) ? u : null;
}

const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : []);

/**
 * Every Host value this laneboard answers to, as lowercase `host[:port]`:
 * loopback names with `port` and with `fleet.ingressPort`, each concrete
 * (non-wildcard) bind address with `port`, the host of `publicUrl`,
 * `fleet.publicHosts`, and the hosts of `fleet.allowedOrigins`. A loopback
 * `publicUrl` counts only on a port we listen on (`ctx.listenPort`, else
 * `port`/`fleet.ingressPort`).
 */
export function allowedHosts(config, ctx = {}) {
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
  const pub = urlHost(trustedPublicUrl(c, f, ctx));
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
 * How many Host header lines the request carried. node keeps only the first
 * of duplicates in `req.headers`, so count `req.rawHeaders` (SR7 L4). Fakes
 * without rawHeaders count from `req.headers`.
 */
function hostCount(req) {
  const raw = req?.rawHeaders;
  if (Array.isArray(raw)) {
    let n = 0;
    for (let i = 0; i < raw.length; i += 2) if (String(raw[i]).toLowerCase() === 'host') n++;
    return n;
  }
  const h = req?.headers?.host;
  if (h === undefined) return 0;
  return Array.isArray(h) ? h.length : 1;
}

/**
 * DNS-rebinding defence: null when the Host header is allowed, else 'bad-host'.
 * Exactly one Host line is required (SR7 L1, L4): a missing Host (HTTP/1.0
 * only; node refuses HTTP/1.1 without one) and duplicate Host lines are
 * refused. `ctx.allowMissingHost` lets checkRequest keep GET/HEAD of static
 * assets working for Host-less HTTP/1.0 tools; duplicates are never allowed.
 */
export function checkHost(req, config, ctx = {}) {
  const n = hostCount(req);
  if (n === 0) return ctx.allowMissingHost === true ? null : 'bad-host';
  if (n !== 1) return 'bad-host';
  const raw = req?.headers?.host;
  if (typeof raw !== 'string' || raw === '') return 'bad-host';
  return allowedHosts(config, ctx).has(raw.toLowerCase()) ? null : 'bad-host';
}

/**
 * 'https' when the request reached us over TLS or through tailscale serve's
 * https, else 'http'. X-Forwarded-Proto is client-settable, so it is honoured
 * only (SR7 L2) with `ctx.trustForwardedProto` (the ingress listener / serve
 * ingress classification), or when publicUrl is https and the Host is not a
 * loopback name (serve forwards `Host: <name>:8443`; a local client talking
 * to 127.0.0.1 gains nothing from claiming https).
 */
function requestProto(req, config, ctx) {
  if (req?.socket?.encrypted) return 'https';
  if (header(req, 'x-forwarded-proto') !== 'https') return 'http';
  if (ctx?.trustForwardedProto === true) return 'https';
  if (ctx?.trustForwardedProto === false) return 'http';
  let pubHttps = false;
  try { pubHttps = new URL(config?.publicUrl).protocol === 'https:'; } catch { /* no publicUrl */ }
  const host = header(req, 'host');
  return pubHttps && host && !isLoopbackName(hostnameOf(host)) ? 'https' : 'http';
}

/**
 * null when the Origin header is absent or exactly allowed, else 'bad-origin'.
 * Allowed: `${proto}://${Host}` (the page's own origin), the origin of
 * `publicUrl`, and each `fleet.allowedOrigins` entry. Exact string
 * comparison; 'null' and anything malformed are refused.
 */
export function checkOrigin(req, config, ctx = {}) {
  const raw = req?.headers?.origin;
  if (raw === undefined) return null;
  const origin = header(req, 'origin');
  if (!origin || origin === 'null') return 'bad-origin';
  const host = header(req, 'host');
  if (host && origin === `${requestProto(req, config, ctx)}://${host.toLowerCase()}`) return null;
  const c = config || {};
  const f = (c.fleet && typeof c.fleet === 'object') ? c.fleet : {};
  if (origin === urlOrigin(trustedPublicUrl(c, f, ctx))) return null;
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
 * True when a static file needs the CSP (SR7 L7): HTML pages, the service
 * worker (a worker is governed by its own response's CSP) and SVG (renders as
 * a document when opened directly). Takes a file path or URL path.
 */
export function wantsCsp(file) {
  if (typeof file !== 'string' || file === '') return false;
  const p = file.split(/[?#]/, 1)[0].toLowerCase();
  const base = p.slice(p.lastIndexOf('/') + 1);
  return base === 'sw.js' || p.endsWith('.html') || p.endsWith('.htm') || p.endsWith('.svg');
}

/**
 * Headers for a response: always `X-Content-Type-Options: nosniff` and
 * `Referrer-Policy: no-referrer`; also the CSP with `html`, with a `file`
 * that wantsCsp, or when the request URL itself wantsCsp (so sw.js and .svg
 * get it even from a caller that only passes `html` for .html).
 */
export function securityHeaders(req, { html = false, file } = {}) {
  const h = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (html || wantsCsp(file) || wantsCsp(req?.url)) h['content-security-policy'] = contentSecurityPolicy(header(req, 'host'));
  return h;
}

/**
 * Host + Origin for a WebSocket upgrade (boot/common.mjs listenAll; §2 A8
 * replaces the call with auth.guardUpgrade, which uses these same checks).
 */
export function checkUpgrade(req, config, ctx = {}) {
  const c = { ...ctx, allowMissingHost: false };
  return checkHost(req, config, c) || checkOrigin(req, config, c);
}

/**
 * Host for every request, then Origin and the CSRF header for mutating ones.
 * A missing Host is tolerated only on GET/HEAD/OPTIONS (SR7 L1).
 * null or the first failing reason.
 */
export function checkRequest(req, pathname, config, ctx = {}) {
  const mutating = isMutating(req?.method);
  const host = checkHost(req, config, { ...ctx, allowMissingHost: !mutating });
  if (host) return host;
  if (!mutating) return null;
  return checkOrigin(req, config, ctx) || checkCsrf(req, pathname);
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
