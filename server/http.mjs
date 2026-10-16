// Minimal router + static file serving. No framework (hard rule 7).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { checkHost, securityHeaders, warnRateLimited } from './security.mjs';
import * as auth from './fleet/auth.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const routes = []; // { method, pattern: RegExp, keys: [], handler }

/** Register a route. Path may contain :params, e.g. '/api/sessions/:name/keys'. */
export function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
      '$'
  );
  routes.push({ method, rx, keys, handler });
}

export function json(res, body, status = 200, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    ...securityHeaders(null),
    ...headers,
  });
  res.end(buf);
}

export function text(res, body, status = 200, headers = {}) {
  const buf = Buffer.from(String(body));
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': buf.length, ...securityHeaders(null), ...headers });
  res.end(buf);
}

/** Default request body cap (SR15 H1); a route that needs more passes its own limit. */
export const DEFAULT_BODY_LIMIT = 256 * 1024;

export async function readBody(req, limit = DEFAULT_BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Serve a file from a root dir, refusing traversal. Returns true if handled.
 * Every file gets nosniff/no-referrer; an `.html` file also gets the CSP,
 * built from `req` (default `res.req`, set by node) for the ws:// Host.
 */
export async function serveStatic(res, root, relPath, { immutable = false, req = res.req } = {}) {
  const abs = path.join(root, relPath);
  if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) return false;
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return false;
  }
  if (st.isDirectory()) return false;
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...securityHeaders(req, { html: ext === '.html', file: abs }),
  });
  fs.createReadStream(abs).pipe(res);
  return true;
}

/**
 * Request-target form (SR7 L3): only origin-form (`/path?query`) is served. An
 * absolute-form target (`http://other.example.invalid/api/state`) would make
 * the authority in the target, not Host, the one RFC 9112 says counts, and a
 * `//x/...` target parses as a protocol-relative URL. `*` (asterisk-form) is
 * OPTIONS-only and gets the 405 below. Returns null or a reason.
 */
export function badRequestTarget(rawUrl, method) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return 'bad-request-target';
  if (rawUrl === '*') return String(method).toUpperCase() === 'OPTIONS' ? null : 'bad-request-target';
  if (rawUrl[0] !== '/' || rawUrl.startsWith('//')) return 'bad-request-target';
  return null;
}

/** decodeURIComponent, or null for a malformed escape (SR7 L5: a 400, never a 500). */
export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// Shared options for auth.classify / guardRequest / guardUpgrade: the
// process-wide nonce cache (pre-loaded from the audit log at boot by the v1
// module) and the logger for one-time warnings.
// Frozen (SR6 L8): nothing can slip `now` or `nonces` into it, which would
// turn off the boot-epoch check and the per-key nonce budgets (SR3 R2).
const BASE_AUTH_OPTS = Object.freeze({ warn: (text) => log.warn(text) });
let authOpts = BASE_AUTH_OPTS;
/** The options every classification in this process uses (frozen). */
export function authOptions() {
  return authOpts;
}

/**
 * Tests only: classify with extra options (`now`, `peerUid`, ...) on top of
 * the process-wide ones; `null` restores them. The result is frozen too.
 */
export function _setAuthOptionsForTests(extra = null) {
  authOpts = extra ? Object.freeze({ ...BASE_AUTH_OPTS, ...extra }) : BASE_AUTH_OPTS;
}

/** The headers `tailscale serve` adds to what it forwards (SR6 L1). */
export function serveHeaderNames(req) {
  const out = [];
  for (const k of Object.keys(req?.headers ?? {})) {
    const l = k.toLowerCase();
    if (l === 'x-forwarded-for' || l === 'x-forwarded-proto' || l === 'x-forwarded-host' || l.startsWith('tailscale-')) out.push(l);
  }
  return out;
}

let misroutedWarned = false;
/**
 * SR6 L1: with a fleet block (an ingress port), a request on the LOCAL
 * listener that carries tailscale serve's headers means serve still targets
 * the local port, and would otherwise run as `local` (full local power). It is
 * refused with AuthError 403 `misrouted-serve`, and the operator is told once,
 * loudly, to point serve at the ingress port. Local CLI, hooks and scripts
 * never send these headers. Without a fleet block nothing changes (null).
 * Returns the AuthError or null.
 */
export function misroutedServe(req, cfg = config, warn = (t) => log.error(t)) {
  const ip = cfg?.fleet?.ingressPort;
  if (!Number.isInteger(ip) || ip < 1 || ip > 65535) return null;
  if (auth.isIngress(req, cfg)) return null;
  const names = serveHeaderNames(req);
  if (names.length === 0) return null;
  if (!misroutedWarned) {
    misroutedWarned = true;
    warn(`fleet auth: a request on the local port ${req?.socket?.localPort ?? '?'} carries tailscale serve headers (${[...new Set(names)].slice(0, 5).join(', ')}): ` +
      `tailscale serve still targets the local port. Point tailscale serve at http://127.0.0.1:${ip} (fleet.ingressPort); until then every such request is refused 403 misrouted-serve`);
  }
  return new auth.AuthError(403, 'misrouted-serve');
}

/** Tests only: let the misrouted-serve warning fire again. */
export function _resetMisroutedWarning() { misroutedWarned = false; }

/**
 * The request's auth (fleet §2 2.3): `req.auth` when http.mjs or the upgrade
 * guard already classified it, else auth.classify with the shared options.
 * Exported so the hub's client WebSocket (H7/H11) can use the same
 * classification. Throws auth.AuthError.
 */
export function classifyRequest(req, cfg = config) {
  // only a verified auth that auth.mjs issued is reused; anything else is classified afresh
  if (auth.isAuthenticated(req?.auth)) return req.auth;
  const a = auth.classify(req, cfg, authOpts);
  req.auth = a;
  return a;
}

/**
 * True for a local or direct auth, and for a hub auth whose signature was
 * VERIFIED (SR3 H1). A hub auth with only its key looked up (an action
 * envelope still to be verified by POST /api/v1/actions: 'hub-pending'),
 * a forged object or any other kind, is not (auth.isAuthenticated).
 */
export function isAuthenticated(a) {
  return auth.isAuthenticated(a);
}

/** Only POST /api/v1/actions may run with a not-yet-verified hub auth: it verifies the body itself. */
export const ENVELOPE_PATH = '/api/v1/actions';

/** req.tsUser: who to attribute a request to, only ever from the classification, never a raw header (S6b). */
export function userOf(a) {
  if (!a || a.kind === 'hub' || typeof a.user !== 'string' || !a.user) return null;
  // `local` without a login is null, as req.tsUser always was without the header.
  return a.kind === 'local' && a.user === 'local' ? null : a.user;
}

function refusalBody(err) {
  const code = err?.code ?? 'forbidden';
  return { error: err?.status === 403 ? 'forbidden' : code, reason: code };
}

function warnRefused(req, kind, code) {
  warnRateLimited((reason, detail) => log.warn(`refused ${kind} (${reason})`, detail), `${kind}-${code}`,
    `${String(req.method).slice(0, 10)} host=${JSON.stringify(String(req.headers?.host ?? '').slice(0, 80))} origin=${JSON.stringify(String(req.headers?.origin ?? '').slice(0, 80))}`);
}

/**
 * Main request handler: request-target form, /healthz, classification and
 * guards (server/fleet/auth.mjs), then routes, public/ and the vendor route.
 */
export async function handleRequest(req, res) {
  const badTarget = badRequestTarget(req.url, req.method);
  if (badTarget) {
    warnRefused(req, 'request', badTarget);
    return json(res, { error: 'bad request', reason: badTarget }, 400);
  }
  const method = String(req.method || 'GET').toUpperCase();
  if (req.url === '*') return json(res, { error: 'method not allowed' }, 405, { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' });
  const url = new URL(req.url, 'http://localhost');
  const rawPath = url.pathname;
  req.query = url.searchParams;

  // /healthz: auth-exempt (README §3.3), answered before classification. Only
  // the F5 Host check applies, as before.
  if (rawPath === '/healthz' && (method === 'GET' || method === 'HEAD')) {
    const ctx = { allowMissingHost: true };
    if (Number.isInteger(req.socket?.localPort)) ctx.listenPort = req.socket.localPort;
    if (auth.isIngress(req, config)) ctx.trustForwardedProto = true;
    const bad = checkHost(req, config, ctx);
    if (bad) {
      warnRefused(req, 'request', bad);
      return json(res, { error: 'forbidden', reason: bad }, 403);
    }
    const h = routes.find((r) => r.method === 'GET' && r.rx.test('/healthz'));
    if (h) {
      req.params = {};
      req.tsUser = null;
      return h.handler(req, res);
    }
  }

  // Classification + kind-aware guards (§2 2.3-2.5): Host (listener-specific),
  // local/direct/hub, Origin, Sec-Fetch-Site, `X-Laneboard: 1`, JSON on v1
  // actions. On the local listener every Tailscale-* header is deleted first.
  const misrouted = misroutedServe(req);
  if (misrouted) {
    warnRefused(req, 'request', misrouted.code);
    return json(res, refusalBody(misrouted), misrouted.status);
  }
  try {
    req.auth = undefined;
    classifyRequest(req);
    auth.guardRequest(req, url, config, authOpts);
  } catch (err) {
    if (!(err instanceof auth.AuthError)) throw err;
    warnRefused(req, 'request', err.code);
    return json(res, refusalBody(err), err.status);
  }
  if (!isAuthenticated(req.auth) && !(method === 'POST' && rawPath === ENVELOPE_PATH && req.auth?.kind === 'hub-pending')) {
    warnRefused(req, 'request', 'unauthenticated');
    return json(res, { error: 'unauthenticated', reason: 'unauthenticated' }, 401);
  }
  // §2 2.5: a signed hub request carries no browser headers, on reads too (a
  // browser cannot sign; a signed request with an Origin is a confused deputy).
  if (String(req.auth?.kind).startsWith('hub') && (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined)) {
    warnRefused(req, 'request', 'origin-on-hub');
    return json(res, { error: 'forbidden', reason: 'origin-on-hub' }, 403);
  }
  // Attribution comes from the classification only (never the raw header).
  req.tsUser = userOf(req.auth);

  if (method === 'OPTIONS') {
    return json(res, { error: 'method not allowed' }, 405, { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' });
  }

  // SR7 L5: a malformed escape is a 400 before any route lookup.
  const pathname = safeDecode(rawPath);
  if (pathname === null) return json(res, { error: 'bad path' }, 400);

  // Routes match the RAW (still percent-encoded) path and each parameter is
  // decoded once: `/api/v1/%61ctions` is not `/api/v1/actions` (the guards
  // above saw the raw path), and a name is never decoded twice.
  for (const r of routes) {
    // A HEAD request must hit the same handler as GET, or `curl -sI /healthz`
    // silently falls through to the SPA and reports text/html.
    const m2 = method === 'HEAD' ? 'GET' : method;
    if (r.method !== m2 && r.method !== 'ALL') continue;
    const m = r.rx.exec(rawPath);
    if (!m) continue;
    const params = {};
    for (let i = 0; i < r.keys.length; i++) {
      const v = safeDecode(m[i + 1]);
      if (v === null) return json(res, { error: 'bad path' }, 400);
      params[r.keys[i]] = v;
    }
    req.params = params;
    return r.handler(req, res);
  }

  if (method === 'GET' || method === 'HEAD') {
    // Vendored browser deps served straight out of node_modules (hard rule 7: no bundler).
    if (pathname.startsWith('/vendor/')) {
      const rel = pathname.slice('/vendor/'.length);
      const map = {
        'xterm.js': '@xterm/xterm/lib/xterm.js',
        'xterm.css': '@xterm/xterm/css/xterm.css',
        'addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
        'addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
      };
      if (map[rel]) {
        const ok = await serveStatic(res, path.join(config.repoRoot, 'node_modules'), map[rel], { immutable: true, req });
        if (ok) return;
      } else if (await serveStatic(res, path.join(config.repoRoot, 'public', 'vendor'), rel, { immutable: true, req })) {
        // Anything else under /vendor/ is a file checked in at public/vendor/.
        return;
      }
      return json(res, { error: 'not found' }, 404);
    }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const publicDir = path.join(config.repoRoot, 'public');
    if (await serveStatic(res, publicDir, rel, { req })) return;
    // A missing file (a path with an extension, e.g. a mistyped module import)
    // is a 404, not the SPA page: index.html served as a .js module only shows
    // up as a confusing MIME error.
    if (/\.[a-z0-9]+$/i.test(pathname)) return json(res, { error: 'not found', path: pathname.slice(0, 200) }, 404);
    // SPA-ish fallback: unknown non-API paths get index.html.
    if (!pathname.startsWith('/api') && !pathname.startsWith('/ws')) {
      if (await serveStatic(res, publicDir, 'index.html', { req })) return;
    }
  }
  json(res, { error: 'not found', path: pathname.slice(0, 200) }, 404);
}
