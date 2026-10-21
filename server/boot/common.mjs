// What both boot paths share: the listeners, the upgrade dispatch, /healthz,
// and shutdown. Deliberately light — it must not import state, ws, terminals
// or any collector, because the hub boots through here and never loads them.
import http from 'node:http';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { handleRequest, route, json, badRequestTarget, classifyRequest, authOptions, userOf, isAuthenticated, misroutedServe } from '../http.mjs';
import { checkUpgrade, warnRateLimited } from '../security.mjs';
import * as auth from '../fleet/auth.mjs';
import { AuthError } from '../fleet/auth.mjs';
import { socketPeerUid, PROC_NET_TCP6 } from '../fleet/peercred.mjs';
import fs from 'node:fs';
import { VERSION } from '../version.mjs';

export { VERSION };

export const startedAt = Date.now();

/** Every listening server, so shutdown can close them. */
export const servers = [];

/**
 * WebSocket upgrade handlers registered by modules (`ctx.upgrade(fn)`), tried
 * in order after the boot path's own `onUpgrade`. Return true if handled.
 */
export const upgradeHandlers = [];

/**
 * Run in order on SIGINT/SIGTERM. A boot path pushes its own; module `stop`
 * hooks are put in front of them by server/modules.mjs, so a module stops
 * while the database it may write to is still open.
 */
export const shutdownHooks = [];

// Server hardening (SR15 H1). requestTimeout bounds the time to RECEIVE a
// whole request; a handler that holds its response (the PermissionRequest
// hook, up to approvals.holdSec) is not affected by it.
export const SERVER_LIMITS = Object.freeze({
  requestTimeout: 30_000,
  headersTimeout: 10_000,
  keepAliveTimeout: 5_000,
  connectionsCheckingInterval: 2_000,
  maxHeadersCount: 100,
  maxConnections: 256,
});

/**
 * http.createServer with the SERVER_LIMITS (each overridable through
 * `limits`, for tests). `handler(req, res)` defaults to handleRequest with the
 * 500 fallback.
 */
export function createServer(handler = defaultHandler, limits = {}) {
  const L = { ...SERVER_LIMITS, ...limits };
  const server = http.createServer({
    requestTimeout: L.requestTimeout,
    headersTimeout: L.headersTimeout,
    keepAliveTimeout: L.keepAliveTimeout,
    connectionsCheckingInterval: L.connectionsCheckingInterval,
  }, handler);
  server.maxHeadersCount = L.maxHeadersCount;
  server.maxConnections = L.maxConnections;
  return server;
}

function defaultHandler(req, res) {
  handleRequest(req, res).catch((err) => {
    log.error('request failed', req.method, String(req.url).slice(0, 200), err?.stack || String(err));
    if (!res.headersSent) json(res, { error: 'internal error' }, 500);
    else res.end();
  });
}

const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

/**
 * The ports to listen on: `config.port` (the local listener: CLI, hooks, the
 * board on this box) and, when set, `fleet.ingressPort` (the one `tailscale
 * serve` targets; every request on it is ingress, §2 2.3). Without a fleet
 * block there is no ingress port and nothing changes.
 */
export function listenPorts(cfg = config) {
  const out = [{ port: cfg.port, ingress: false }];
  const ip = cfg.fleet?.ingressPort;
  if (isPort(ip) && ip !== cfg.port) out.push({ port: ip, ingress: true });
  return out;
}

/**
 * The default lookup (SR6 L4): for an IPv4 peer only /proc/net/tcp is read
 * (the IPv4 loopback rows never appear in tcp6), which halves the parse.
 */
function defaultPeerUidLookup(socket) {
  if (socket?.remoteFamily === 'IPv4') {
    const read = (p, enc) => {
      if (p === PROC_NET_TCP6) throw Object.assign(new Error('skipped: IPv4 peer'), { code: 'ENOENT' });
      return fs.readFileSync(p, enc);
    };
    return socketPeerUid(socket, { read });
  }
  return socketPeerUid(socket);
}

let peerUidLookup = defaultPeerUidLookup;
/** Tests only: replace the peer-uid lookup used on accepted ingress sockets. */
export function _setPeerUidLookup(fn) {
  peerUidLookup = typeof fn === 'function' ? fn : defaultPeerUidLookup;
}

/**
 * Peer uids by the (address, port) pair of each end of an OPEN ingress
 * connection (SR6 L4).
 * An entry lives for the connection's lifetime (deleted on `close`), so a
 * reused port never inherits another connection's uid.
 */
const peerUidCache = new Map();
export function _peerUidCacheSize() { return peerUidCache.size; }

/**
 * On the ingress listener with `fleet.ingressPeerUid` set, give each accepted
 * socket a `socket.lbPeerUid` (A11, /proc/net/tcp) that auth.classify compares
 * (null → 403 not-from-serve, never downgraded to local). SR6 L4: the lookup
 * runs lazily, on the first request that reads it (a connection that never
 * sends a request costs no /proc scan), once per connection, and is cached
 * per (remotePort, localPort) until the socket closes.
 */
export function recordPeerUid(socket, cfg = config) {
  const want = cfg.fleet?.ingressPeerUid;
  if (want === null || want === undefined) return;
  const key = JSON.stringify([socket?.remoteAddress, socket?.remotePort, socket?.localAddress, socket?.localPort]);
  let done = false;
  let cachedHere = false;
  let value = null;
  const compute = () => {
    if (done) return value;
    done = true;
    if (peerUidCache.has(key)) {
      value = peerUidCache.get(key);
      return value;
    }
    let uid = null;
    try { uid = peerUidLookup(socket); } catch { uid = null; }
    value = Number.isInteger(uid) ? uid : null;
    // only a live connection's tuple is cached: its ports cannot be reused while it is open
    if (socket?.destroyed !== true) { peerUidCache.set(key, value); cachedHere = true; }
    return value;
  };
  Object.defineProperty(socket, 'lbPeerUid', {
    configurable: true,
    enumerable: true,
    get: compute,
    set: (v) => { done = true; value = Number.isInteger(v) ? v : null; },
  });
  if (typeof socket?.once === 'function') {
    socket.once('close', () => { if (cachedHere) peerUidCache.delete(key); });
  }
}

/** One-time boot warnings about how the fleet auth is set up (§2 2.3, SR4 L4). */
export function bootWarnings(cfg = config) {
  const out = [];
  const f = cfg.fleet ?? {};
  if (!isPort(f.ingressPort)) {
    if (cfg.mode !== 'hub') out.push('no fleet.ingressPort (no fleet block): every request is local; remote-only protection (approve, deny, release, set-budget, kill *) needs a fleet block');
  } else if (f.enforce === false) {
    out.push('fleet.enforce is false: an unidentified request on the ingress listener is treated as a direct user');
  }
  return out;
}

/**
 * The upgrade path (both listeners): request-target form, then
 * auth.guardUpgrade (Host, classification, kind rules, Origin; §2 2.5) first,
 * then `onUpgrade` (the boot path's /ws, /ws/term/) and the module handlers.
 * A refusal writes a bare status line and closes the socket.
 */
export function handleUpgrade(req, socket, head, { onUpgrade = null, cfg = config } = {}) {
  const badTarget = badRequestTarget(req.url, 'GET');
  if (badTarget || req.url === '*') {
    refuseUpgrade(req, socket, new AuthError(400, 'bad-request-target'));
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  let a;
  // SR6 L1: serve's headers on the local listener (with a fleet block) → 403 misrouted-serve
  const misrouted = misroutedServe(req, cfg);
  if (misrouted) {
    refuseUpgrade(req, socket, misrouted);
    return;
  }
  try {
    req.auth = undefined;
    a = classifyRequest(req, cfg);
    a = auth.guardUpgrade(req, url, cfg, authOptions());
  } catch (err) {
    if (!(err instanceof AuthError)) {
      log.error('upgrade guard failed', err?.stack || String(err));
      err = new AuthError(500, 'internal');
    }
    refuseUpgrade(req, socket, err);
    return;
  }
  // Only a verified hub signature counts (SR3 H1): anything else claiming to
  // be the hub is unauthenticated here.
  if (!isAuthenticated(a)) {
    refuseUpgrade(req, socket, new AuthError(401, 'unauthenticated'));
    return;
  }
  req.auth = a;
  req.tsUser = userOf(a);
  try {
    if (onUpgrade && onUpgrade(req, socket, head, url)) return;
    for (const h of upgradeHandlers) {
      if (h(req, socket, head, url)) return;
    }
  } catch (err) {
    log.error('upgrade handler failed', err?.stack || String(err));
  }
  socket.destroy();
}

function refuseUpgrade(req, socket, err) {
  warnRateLimited((reason, detail) => log.warn(`refused upgrade (${reason})`, detail), `upgrade-${err.code}`,
    `host=${JSON.stringify(String(req.headers?.host ?? '').slice(0, 80))} origin=${JSON.stringify(String(req.headers?.origin ?? '').slice(0, 80))}`);
  auth.writeUpgradeRefusal(socket, err);
}

/**
 * Listen on every `config.bindAddresses` entry at `config.port` and, with a
 * fleet block, at `fleet.ingressPort` too (§2 2.2: bound on the same
 * addresses). `onUpgrade(req, socket, head, url) -> bool` is the boot path's
 * own upgrade routing (the builder's /ws and /ws/term/); `upgradeHandlers`
 * come next, and anything still unhandled is destroyed. Every upgrade passes
 * auth.guardUpgrade first.
 */
export async function listenAll({ onUpgrade = null, exit = process.exit } = {}) {
  for (const w of bootWarnings()) log.warn(`fleet auth: ${w}`);
  for (const { port, ingress } of listenPorts()) {
    for (const addr of config.bindAddresses) {
      const server = createServer();
      if (ingress) server.on('connection', (socket) => recordPeerUid(socket));
      server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, { onUpgrade }));
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, addr, () => {
            log.info(`listening on http://${addr}:${port}${ingress ? ' (ingress: tailscale serve)' : ''}`);
            resolve();
          });
        });
      } catch (err) {
        const line = bootErrorLine(err, { port, ingress });
        if (!line) throw err;
        // One line, not a stack, and a non-zero exit (a busy port used to log an
        // uncaughtException and exit 0).
        log.error(line);
        for (const s of servers) s.close();
        exit(1);
        return servers;
      }
      servers.push(server);
    }
  }
  return servers;
}

/**
 * The one-line boot message for an error a person can fix, or null for any
 * other error (which keeps its stack). EADDRINUSE on a listener names the port
 * and the setting that moves it; AUDIT_LOCKED (fleet/audit.mjs) keeps its own
 * message, which names the lock file and its holder (pid on host), and adds
 * the variable that gives a second instance its own audit log.
 */
export function bootErrorLine(err, { port = err?.port, ingress = false } = {}) {
  if (err?.code === 'EADDRINUSE') {
    const knob = ingress ? 'set LANEBOARD_INGRESS_PORT or fleet.ingressPort' : 'set LANEBOARD_PORT or config.port';
    return `laneboard: port ${port} is taken (is another laneboard running? ${knob})`;
  }
  if (err?.code === 'AUDIT_LOCKED') {
    const msg = String(err.message || '').replace(/\s+/g, ' ').trim();
    const hint = /LANEBOARD_AUDIT_FILE/.test(msg) ? '' : ' (set LANEBOARD_AUDIT_FILE or XDG_STATE_HOME to give this instance its own audit log)';
    return `laneboard: ${msg || 'the audit log is locked by another writer'}${hint}`;
  }
  return null;
}

/**
 * Refuse a WebSocket upgrade whose Host or Origin is not allowed: write a 403
 * status line and destroy the socket. True when the upgrade may proceed.
 */
/** F5's plain Host/Origin upgrade check (kept for tests and callers outside the guarded path). */
export function upgradeAllowed(req, socket, cfg = config) {
  const refused = checkUpgrade(req, cfg);
  if (!refused) return true;
  warnRateLimited((reason, detail) => log.warn(`refused upgrade (${reason})`, detail), `upgrade-${refused}`,
    `host=${JSON.stringify(String(req.headers?.host ?? '').slice(0, 80))} origin=${JSON.stringify(String(req.headers?.origin ?? '').slice(0, 80))}`);
  try {
    socket.once('finish', () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  } catch {
    socket.destroy();
  }
  return false;
}

/**
 * GET /healthz: always 200, auth-exempt. `extra()` adds the mode's own fields
 * after the shared ones (the builder: terminals, wsClients; the hub: mode,
 * builders).
 */
export function registerHealthz(extra = () => ({})) {
  route('GET', '/healthz', (req, res) => {
    const m = process.memoryUsage();
    json(res, {
      ok: true,
      pid: process.pid,
      uptimeMs: Date.now() - startedAt,
      version: VERSION,
      // Exposed so a slow leak can be watched over days without a profiler:
      // if rssMb climbs while heapUsedMb stays flat, it is native (node-pty), and
      // if both climb together it is JS.
      memory: {
        rssMb: Math.round(m.rss / 1048576),
        heapUsedMb: Math.round(m.heapUsed / 1048576),
        heapTotalMb: Math.round(m.heapTotal / 1048576),
        externalMb: Math.round(m.external / 1048576),
      },
      ...extra(),
    });
  });
}

export async function shutdown(signal) {
  log.info(`shutting down (${signal})`);
  for (const fn of shutdownHooks) {
    try { await fn(); } catch (err) { log.error('shutdown hook failed', err?.stack || String(err)); }
  }
  for (const s of servers) s.close();
  setTimeout(() => process.exit(0), 500).unref();
}

let signalsInstalled = false;
/** SIGINT/SIGTERM → shutdown(). Idempotent. */
export function installSignalHandlers() {
  if (signalsInstalled) return;
  signalsInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
}
