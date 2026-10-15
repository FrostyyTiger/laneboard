// Minimal router + static file serving. No framework (hard rule 7).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { checkRequest, securityHeaders, warnRateLimited } from './security.mjs';

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

export async function readBody(req, limit = 1024 * 1024) {
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
    ...securityHeaders(req, { html: ext === '.html' }),
  });
  fs.createReadStream(abs).pipe(res);
  return true;
}

/** Main request handler: routes first, then public/, then node_modules vendor route. */
export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  req.query = url.searchParams;
  // Tailscale identity header, when the request came through `tailscale serve`.
  req.tsUser = req.headers['tailscale-user-login'] || null;

  // Security baseline (server/security.mjs): Host on every request, then
  // Origin and `X-Laneboard: 1` on mutating ones. OPTIONS is never answered:
  // with no CORS preflight a cross-site page cannot send the custom header.
  const refused = checkRequest(req, pathname, config);
  if (refused) {
    warnRateLimited((reason, detail) => log.warn(`refused request (${reason})`, detail), refused,
      `${String(req.method).slice(0, 10)} host=${JSON.stringify(String(req.headers.host ?? '').slice(0, 80))} origin=${JSON.stringify(String(req.headers.origin ?? '').slice(0, 80))}`);
    return json(res, { error: 'forbidden', reason: refused }, 403);
  }
  if (req.method === 'OPTIONS') {
    return json(res, { error: 'method not allowed' }, 405, { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' });
  }

  for (const r of routes) {
    // A HEAD request must hit the same handler as GET, or `curl -sI /healthz`
    // silently falls through to the SPA and reports text/html.
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (r.method !== method && r.method !== 'ALL') continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
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
        const ok = await serveStatic(res, path.join(config.repoRoot, 'node_modules'), map[rel], { immutable: true });
        if (ok) return;
      } else if (await serveStatic(res, path.join(config.repoRoot, 'public', 'vendor'), rel, { immutable: true })) {
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
    if (/\.[a-z0-9]+$/i.test(pathname)) return json(res, { error: 'not found', path: pathname }, 404);
    // SPA-ish fallback: unknown non-API paths get index.html.
    if (!pathname.startsWith('/api') && !pathname.startsWith('/ws')) {
      if (await serveStatic(res, publicDir, 'index.html', { req })) return;
    }
  }
  json(res, { error: 'not found', path: pathname }, 404);
}
