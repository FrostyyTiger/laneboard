// What both boot paths share: the listeners, the upgrade dispatch, /healthz,
// and shutdown. Deliberately light — it must not import state, ws, terminals
// or any collector, because the hub boots through here and never loads them.
import http from 'node:http';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { handleRequest, route, json } from '../http.mjs';
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

/**
 * Listen on every `config.bindAddresses` entry at `config.port`.
 * `onUpgrade(req, socket, head, url) -> bool` is the boot path's own upgrade
 * routing (the builder's /ws and /ws/term/); `upgradeHandlers` come next, and
 * anything still unhandled is destroyed.
 */
export async function listenAll({ onUpgrade = null } = {}) {
  for (const addr of config.bindAddresses) {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        log.error('request failed', req.method, req.url, err?.stack || String(err));
        if (!res.headersSent) json(res, { error: 'internal error' }, 500);
        else res.end();
      });
    });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (onUpgrade && onUpgrade(req, socket, head, url)) return;
      for (const h of upgradeHandlers) {
        if (h(req, socket, head, url)) return;
      }
      socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, addr, () => {
        log.info(`listening on http://${addr}:${config.port}`);
        resolve();
      });
    });
    servers.push(server);
  }
  return servers;
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
