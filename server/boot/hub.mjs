// Laneboard hub mode (config `mode: "hub"`; fleet plan §3 2.8, H11).
// REVIEW-REQUIRED (SR13).
//
// The hub has no tmux, no sessions and no collectors of its own: it must never
// import server/state.mjs, server/ws.mjs, server/terminals.mjs (node-pty),
// server/actions.mjs or anything under server/collector, server/routes or
// server/flags (asserted by test/boot.test.mjs and test/hub-boot.test.mjs).
//
// Boot order:
//   1. the hub key (fleet.hubKeyFile, keys-ed25519 loadPrivateKey: PEM PKCS8
//      Ed25519, 0600, own uid). Missing or loose permissions: refuse to boot.
//   2. the hub's own audit chain (openAudit, LANEBOARD_AUDIT_FILE / stateDir).
//   3. the fleet store, one Upstream per fleet.builders entry, the relay, the
//      signed read proxy, the terminal proxy, the hub /ws (client-ws), the
//      audit reconciler, web push, the services hook and the map loop.
//   4. the module ctx: every hub service is on ctx and provided (in the
//      INTEGRATION order store, relay, readProxy, services, broadcast,
//      onClientMessage, audit, then the rest) BEFORE loadModules('hub/routes'),
//      so a module can use them in register; core routes are hub/routes/core.mjs.
//   5. services.startAll, upstreams, reconciler, map probes + loop, retention.
//   6. listenAll: the local listener (`local`: reads only) and the ingress
//      listener (`fleet.ingressPort`, `tailscale serve` -> `direct`), with the
//      /ws and /ws/term/:builder/:name upgrades. Every request and upgrade is
//      classified by auth.classify (http.mjs classifyRequest; a signed `hub`
//      request is refused on a hub) and guarded (Host, Origin, X-Laneboard: 1).
// Shutdown (SIGINT/SIGTERM): module stop hooks first (server/modules.mjs puts
// them in front), then: map loop, services, reconciler, upstreams, terminal
// proxy, client sockets, audit, db.
import webpush from 'web-push';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import * as db from '../db.mjs';
import { listenAll, registerHealthz, installSignalHandlers, shutdownHooks, VERSION, startedAt } from './common.mjs';
import { classifyRequest, authOptions } from '../http.mjs';
import { createContext, loadModules } from '../modules.mjs';
import { loadPrivateKey, keyId as keyIdOf } from '../fleet/keys-ed25519.mjs';
import { openAudit } from '../fleet/audit.mjs';
import { auditFile } from '../fleet/paths.mjs';
import { createFleetStore } from '../hub/fleet-store.mjs';
import { createUpstreams } from '../hub/upstream.mjs';
import { createClientWs } from '../hub/client-ws.mjs';
import { createRelay } from '../hub/relay.mjs';
import { createReadProxy } from '../hub/read-proxy.mjs';
import { createTermProxy } from '../hub/term-proxy.mjs';
import { createAuditReconciler } from '../hub/audit-reconcile.mjs';
import { createWebPushSender } from '../hub/notify.mjs';
import { createServices } from '../hub/services.mjs';
import { aggregates } from '../hub/aggregates.mjs';
import { createViewCache, createMapLoop, createHubPush, healthCounts } from '../hub/routes/core.mjs';
import * as mapModel from '../map.mjs';

const fleet = config.fleet ?? {};
const builders = Array.isArray(fleet.builders) ? fleet.builders : [];
const now = Date.now;

function fatal(msg) {
  log.error(`hub: ${msg}`);
  process.exit(1);
}

// 1. The hub key. Never logged; only its keyId is.
let key;
try {
  key = loadPrivateKey(fleet.hubKeyFile);
} catch (err) {
  fatal(`cannot load the hub key from ${fleet.hubKeyFile}: ${err?.code === 'ENOENT' ? 'no such file (run `laneboard fleet keygen`)' : String(err?.message || err).slice(0, 200)}`);
}
const keyId = keyIdOf(key);

// 2. The hub's own audit chain (authoritative for relayed actions, README 3.5).
let audit;
try {
  audit = openAudit({ file: auditFile(), maxBytes: fleet.audit?.maxBytes ?? undefined, builder: null });
} catch (err) {
  fatal(`cannot open the hub audit log: ${String(err?.message || err).slice(0, 200)}`);
}

// 3. The hub's parts.
const store = createFleetStore({ builders, hubVersion: VERSION, staleMs: fleet.staleMs, downMs: fleet.downMs });
const viewCache = createViewCache({ store, now, maxAgeMs: fleet.batchMs ?? 250 });
const view = () => viewCache.get();

// The liveness tick must be finer than staleMs, or `stale`/`down` show late.
const tickMs = Math.max(50, Math.min(1000, Math.floor((fleet.staleMs ?? 15_000) / 4)));
const upstreams = createUpstreams({ builders, key, keyId, store, now, log, cfg: { ...fleet, tickMs } });

const relay = createRelay({ store, key, keyId, audit, now, cfg: config });
const readProxy = createReadProxy({ store, key, keyId, now, cfg: config, classify: (req) => classifyRequest(req) });
const termProxy = createTermProxy({ store, key, keyId, cfg: config, audit, now, log, authOpts: authOptions() });
const auditReconciler = createAuditReconciler({ store, readProxy, audit, now, log });

const clientWs = createClientWs({
  store,
  config,
  version: VERSION,
  now,
  batchMs: fleet.batchMs,
  getMap: () => mapModel.model(),
  aggregates,
  // The same classification as every hub route (auth.classify), not client-ws's own.
  classify: (req) => classifyRequest(req),
  onVisible: (id, keys) => upstreams.get(id)?.setVisible(keys),
  log,
});

const mapLoop = createMapLoop({
  store, view, now, log,
  tickFleet: mapModel.tickFleet,
  toMapFleet: mapModel.toMapFleet,
  send: (map) => clientWs.sendMap(map),
});

/** Hub services' fan-out (alarms, packages, ...); a packages merge also feeds the Map. */
function broadcast(msg) {
  if (msg && msg.type === 'packages') mapLoop.setPackages(msg.data);
  return clientWs.broadcast(msg);
}
const onClientMessage = (type, fn) => clientWs.onClientMessage(type, fn);

let subject = 'https://hub.example.invalid/';
try { subject = `${new URL(config.publicUrl).origin}/`; } catch { /* keep the placeholder */ }
const push = createHubPush({ db, webpush, log });
const pushSender = createWebPushSender({ webpush, vapid: () => push.ensureVapid(), subject, subscriptions: push.subscriptions, log });
push.setSender(pushSender);

const services = createServices({ log });

// 4. The module ctx. Base fields for modules that read ctx.<name>; the same
// objects provided for modules that use ctx.use(name).
const ctx = createContext({
  mode: 'hub',
  config,
  log,
  db,
  now,
  version: VERSION,
  startedAt,
  store,
  relay,
  readProxy,
  services,
  broadcast,
  onClientMessage,
  audit,
  view,
  aggregates,
  push,
  upstreams,
  clientWs,
  termProxy,
  auditReconciler,
  mapModel,
});
for (const [name, value] of [
  ['store', store], ['relay', relay], ['readProxy', readProxy], ['services', services],
  ['broadcast', broadcast], ['onClientMessage', onClientMessage], ['audit', audit],
  ['db', db], ['push', push], ['pushSender', pushSender], ['auditForks', auditReconciler],
  ['upstreams', upstreams], ['clientWs', clientWs], ['termProxy', termProxy],
]) ctx.provide(name, value);

registerHealthz(() => ({ mode: 'hub', builders: healthCounts(view()) }));

try {
  await loadModules('hub/routes', ctx);
} catch (err) {
  fatal(`hub modules failed to load: ${err?.stack || String(err)}`);
}

// 5. Start everything that runs.
await services.startAll(Object.freeze({
  store, push, audit, broadcast, relay, readProxy, onClientMessage, config, now, view, log,
}));
upstreams.start();
auditReconciler.start();
const stopProbes = mapModel.start();
mapLoop.start();
const stopRetention = db.startRetention();

shutdownHooks.push(
  () => mapLoop.stop(),
  () => { try { stopProbes?.(); } catch { /* ignore */ } },
  () => services.stopAll(),
  () => auditReconciler.stop(),
  () => upstreams.stop(),
  () => termProxy.close(),
  () => clientWs.close(),
  () => viewCache.close(),
  () => { try { stopRetention?.(); } catch { /* ignore */ } },
  () => audit.close(),
  () => db.close(),
);
installSignalHandlers();

// 6. Listen. /ws is the hub's client socket, /ws/term/:builder/:name the proxy.
function onUpgrade(req, socket, head, url) {
  if (url.pathname === '/ws') return clientWs.handleUpgrade(req, socket, head);
  if (url.pathname.startsWith('/ws/term/')) return termProxy.attach(req, socket, head, url);
  return false;
}
await listenAll({ onUpgrade });

log.info(`laneboard hub up, pid ${process.pid}: ${builders.length} builder${builders.length === 1 ? '' : 's'} (${builders.map((b) => b.id).join(', ')}), key ${keyId}`);
