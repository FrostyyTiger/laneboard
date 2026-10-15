// Hub module: the core hub routes (fleet plan §3 2.8, H11). REVIEW-REQUIRED (SR13).
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx), after
// boot/hub.mjs provided the hub services on ctx.
//
// Routes (README §3.3, hub table):
//   GET    /api/fleet                       {builders:[BuilderRow], aggregates}
//   GET    /api/fleet/:builder/snapshot     the cached snapshot + {state, stale, ageMs}; 404 unknown
//   GET    /api/state?b=<id>                compat for bin/laneboard (today's /api/state shape)
//   GET    /api/map                         the fleet Map (server/map.mjs model())
//   POST   /api/fleet/actions               relay (H8); kind `direct` only, else 403 remote-only
//   POST   /api/fleet/placement             dry-run ranking (H8 placement through the relay)
//   GET    /api/fleet/audit?since=&builder=&limit=   hub audit entries + reconciliation state (H13)
//   POST   /api/fleet/audit/rebase          {builder, confirm:<builder id>, onto?:'genesis'|'head'}: accept a
//                                            builder's rewritten chain (H13-fix handleRebase); `direct` only
//   GET    /api/fleet/:builder/v1/<rest>    signed read proxy (H12; allowlist in read-proxy.mjs)
//   GET    /api/push/key, POST|DELETE /api/push/subscribe, POST /api/push/test, POST /api/push/quiet
//          (SR13 L1: subscribe, unsubscribe and quiet are `direct`-only; an endpoint must be an https push
//          service on push.allowedEndpointHosts; at most SUBSCRIPTIONS_PER_USER per user)
//
// Auth: every request reached a handler through http.mjs handleRequest, so it
// was classified (auth.classify: `direct` on the ingress listener with a
// Tailscale-User-Login, `local` on the loopback listener; a signed `hub`
// request is refused on a hub) and guarded (Host with port, Origin, `X-Laneboard: 1`
// on every mutating method, OPTIONS 405). On top of that, control is
// remote-only on the hub: an action, a rebase and a terminal need kind
// `direct`; `local` keeps every read (README §3.5, SECURITY-FIXES S7/S9).
// The acting user is always `req.auth` (never a body field).
//
// Builder data reaching a response here was sanitized by the fleet store
// (S2/S3) and is served as JSON only.
import { BUILDER_ID_RX, parseFkey } from '../../fleet/keys.mjs';
import { snapshotOf } from '../fleet-store.mjs';
import { aggregates as defaultAggregates, counts } from '../aggregates.mjs';
import { remoteUser } from '../relay.mjs';
import { handleRebase } from '../audit-reconcile.mjs';
import net from 'node:net';

export const BODY_LIMIT = 64 * 1024;
export const SUBSCRIPTIONS_MAX = 50;
/** SR13 L1: push subscriptions one user may hold (a phone, a laptop, a few browsers). */
export const SUBSCRIPTIONS_PER_USER = 5;
/**
 * SR13 L1: the hub only POSTs to the major browser push services (config `push.allowedEndpointHosts`
 * replaces this list). `*.` matches any subdomain (not the bare domain). Chrome/Android, Firefox, Edge/Windows,
 * Safari/Apple.
 */
export const DEFAULT_PUSH_HOSTS = Object.freeze([
  'fcm.googleapis.com', 'android.googleapis.com', '*.push.services.mozilla.com', '*.notify.windows.com', '*.push.apple.com',
]);
const OWNERS_KEY = 'push.owners';
const HOST_PATTERN_RX = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const MAP_DEBOUNCE_MS = 1000;
export const MAP_INTERVAL_MS = 5000;
const ENDPOINT_MAX = 2048;
const PUSH_KEY_RX = /^[A-Za-z0-9_=+/-]{1,512}$/;
const REPO_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USER_RX = /^[^\s\x00-\x1f\x7f]{1,128}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class HttpError extends Error {
  constructor(status, error, reason) { super(error); this.status = status; this.error = error; this.reason = reason; }
}

/**
 * May this request drive the fleet? Only a `direct` user through tailscale serve (README §3.5). The same
 * predicate as the relay and the terminal proxy (relay.mjs remoteUser, SR13 M1).
 */
export function isRemoteUser(auth) {
  return remoteUser(auth).ok === true && USER_RX.test(auth.user);
}

/**
 * The push host allowlist from config `push.allowedEndpointHosts` (lowercase host names, `*.` for any
 * subdomain); DEFAULT_PUSH_HOSTS when unset. Invalid entries are dropped (and reported through `onBad`).
 */
export function pushHostList(cfgHosts, onBad = null) {
  if (cfgHosts === undefined || cfgHosts === null) return DEFAULT_PUSH_HOSTS;
  if (!Array.isArray(cfgHosts)) { onBad?.(cfgHosts); return DEFAULT_PUSH_HOSTS; }
  const out = [];
  for (const h of cfgHosts) {
    const v = typeof h === 'string' ? h.trim().toLowerCase() : null;
    if (v && v.length <= 253 && HOST_PATTERN_RX.test(v) && net.isIP(v.replace(/^\*\./, '')) === 0) out.push(v);
    else onBad?.(h);
  }
  return Object.freeze(out);
}

/** Is `hostname` on the push host allowlist? Exact names, or `*.suffix` for any subdomain of suffix. */
export function pushHostAllowed(hostname, hosts = DEFAULT_PUSH_HOSTS) {
  if (typeof hostname !== 'string' || hostname === '' || net.isIP(hostname.replace(/^\[|\]$/g, '')) !== 0) return false;
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return hosts.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p));
}

/** BuilderRow (README §3.4 `fleet`): the same row client-ws sends. */
export function builderRow(b) {
  return {
    id: b.id,
    code: b.code,
    directUrl: b.directUrl,
    state: b.state,
    ageMs: b.ageMs,
    latencyMs: b.conn?.latencyMs ?? null,
    version: b.hello?.version ?? null,
    versionSkew: b.versionSkew,
    controls: b.state === 'up' && b.versionSkew !== 'major',
    capabilities: Array.isArray(b.hello?.capabilities) ? b.hello.capabilities : [],
  };
}

/** /healthz `builders`: {up, stale, down} (connecting/misconfigured/incompatible count as down). */
export function healthCounts(view) {
  return counts(view).builders;
}

/**
 * One store.view(now) shared by everything that reads the fleet on a tick
 * (the map loop, the core routes, healthz): view() deep-clones every
 * snapshot, so it is computed at most once per `maxAgeMs` and again only
 * after a store change. Consumers must not mutate it.
 */
export function createViewCache({ store, now = Date.now, maxAgeMs = 250 } = {}) {
  if (!store || typeof store.view !== 'function') throw new TypeError('view cache: store required');
  let cached = null;
  let dirty = true;
  const unsubscribe = typeof store.subscribe === 'function' ? store.subscribe(() => { dirty = true; }) : () => {};
  return {
    get() {
      const t = now();
      if (!cached || dirty || t - cached.now >= maxAgeMs || t < cached.now) {
        cached = store.view(t);
        dirty = false;
      }
      return cached;
    },
    close() { unsubscribe(); },
  };
}

/**
 * The hub map loop (§3 2.7): tickFleet on a 1 s debounce after any store
 * change plus a 5 s interval (feeds, probes). The input is
 * `{...toMapFleet(view), repos, edges}` with the latest §6 P11 packages merge
 * (see setPackages). A non-null result goes to every client (`send(map)`).
 */
export function createMapLoop({
  store, view, tickFleet, toMapFleet, send, now = Date.now, log = null,
  debounceMs = MAP_DEBOUNCE_MS, intervalMs = MAP_INTERVAL_MS, timers = globalThis,
} = {}) {
  if (typeof tickFleet !== 'function' || typeof toMapFleet !== 'function') throw new TypeError('map loop: tickFleet and toMapFleet required');
  const getView = typeof view === 'function' ? view : () => store.view(now());
  let packages = null;
  let debounce = null;
  let interval = null;
  let unsubscribe = null;
  let ticks = 0;
  let failures = 0;

  function tick() {
    debounce = null;
    const t = now();
    let msg;
    try {
      const v = getView();
      const fleet = { ...toMapFleet(v, t) };
      if (packages) {
        if (Array.isArray(packages.repos)) fleet.repos = packages.repos;
        if (Array.isArray(packages.edges)) fleet.edges = packages.edges;
      }
      msg = tickFleet(fleet, t);
      ticks++;
    } catch (err) {
      failures++;
      try { log?.error?.('hub map tick failed', err?.stack || String(err)); } catch { /* ignore */ }
      return null;
    }
    if (msg && msg.type === 'map') {
      try { send(msg.map); } catch (err) { try { log?.warn?.('hub map send failed', String(err?.message || err)); } catch { /* ignore */ } }
    }
    return msg ?? null;
  }

  function schedule() {
    if (debounce || !interval) return;
    debounce = timers.setTimeout(tick, debounceMs);
    debounce?.unref?.();
  }

  return {
    start() {
      if (interval) return;
      interval = timers.setInterval(tick, intervalMs);
      interval?.unref?.();
      if (store && typeof store.subscribe === 'function') unsubscribe = store.subscribe(schedule);
      schedule();
    },
    stop() {
      if (interval) timers.clearInterval(interval);
      if (debounce) timers.clearTimeout(debounce);
      interval = null;
      debounce = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    /** The latest §6 P11 merge ({repos, edges, ...}); the next tick uses it. */
    setPackages(data) {
      packages = isObj(data) ? data : null;
      schedule();
    },
    tick,
    stats: () => ({ ticks, failures }),
  };
}

/**
 * Hub web push without server/push.mjs (which reads the builder's push.local
 * and quiet rules): VAPID keys in the hub db's kv (`push.vapid`, generated on
 * first use, as on a builder), subscriptions in the hub db, sends through
 * `sender` (notify.mjs createWebPushSender). Only O9 notifications and the
 * explicit test route send.
 *   db: {kvRead, kvWrite, addSubscription, removeSubscription, listSubscriptions, markSubscriptionOk}
 *   webpush: the `web-push` module (generateVAPIDKeys)
 */
export function createHubPush({ db, webpush, log = null } = {}) {
  if (!db || typeof db.kvRead !== 'function') throw new TypeError('hub push: db required');
  let vapid = null;
  let sender = null;
  function ensureVapid() {
    if (vapid) return vapid;
    const stored = db.kvRead('push.vapid', null);
    if (isObj(stored) && typeof stored.publicKey === 'string' && typeof stored.privateKey === 'string') {
      vapid = { publicKey: stored.publicKey, privateKey: stored.privateKey };
    } else {
      if (!webpush || typeof webpush.generateVAPIDKeys !== 'function') throw new Error('hub push: no web-push');
      const k = webpush.generateVAPIDKeys();
      vapid = { publicKey: k.publicKey, privateKey: k.privateKey };
      db.kvWrite('push.vapid', vapid);
      try { log?.info?.('generated a new VAPID key pair'); } catch { /* ignore */ }
    }
    return vapid;
  }
  const subscriptions = {
    list: () => db.listSubscriptions(),
    remove: (endpoint) => db.removeSubscription(endpoint),
    markOk: (endpoint) => db.markSubscriptionOk?.(endpoint),
  };
  return {
    ensureVapid,
    publicKey: () => ensureVapid().publicKey,
    subscriptions,
    count: () => db.listSubscriptions().length,
    subscribe(sub, userAgent = null) { db.addSubscription(sub, userAgent); },
    unsubscribe(endpoint) { db.removeSubscription(endpoint); },
    setSender(fn) { sender = typeof fn === 'function' ? fn : null; },
    /** (payload) -> {sent, subscribers}. */
    async broadcast(payload) {
      if (!sender) return { sent: 0, subscribers: 0, error: 'no sender' };
      if (db.listSubscriptions().length === 0) return { sent: 0, subscribers: 0 };
      return sender(payload);
    },
  };
}

/**
 * A PushSubscription JSON from the browser, checked and reduced to what web-push needs; null if not one.
 * SR13 L1: the endpoint must be https on port 443 at a host on the push allowlist (`hosts`, default
 * DEFAULT_PUSH_HOSTS), never an IP literal, so a subscription cannot point the hub's POSTs at loopback or
 * tailnet services.
 */
export function checkSubscription(body, hosts = DEFAULT_PUSH_HOSTS) {
  if (!isObj(body) || typeof body.endpoint !== 'string' || body.endpoint.length > ENDPOINT_MAX) return null;
  let u;
  try { u = new URL(body.endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port !== '' && u.port !== '443') return null;
  if (!pushHostAllowed(u.hostname, hosts)) return null;
  const k = body.keys;
  if (!isObj(k) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || !PUSH_KEY_RX.test(k.p256dh) || !PUSH_KEY_RX.test(k.auth)) return null;
  const out = { endpoint: u.href, keys: { p256dh: k.p256dh, auth: k.auth } };
  if (body.expirationTime === null || Number.isFinite(body.expirationTime)) out.expirationTime = body.expirationTime ?? null;
  return out;
}

async function readJsonLimited(req, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function sinceOf(v) {
  if (typeof v !== 'string' || v === '' || v.length > 40) return undefined;
  if (/^\d{1,16}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function limitOf(v) {
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= 1000 ? n : undefined;
}

export function createModule() {
  return {
    name: 'hub-core',
    modes: ['hub'],
    register(ctx) {
      const opt = (name) => (typeof ctx.has === 'function' && ctx.has(name) ? ctx.use(name) : null);
      const store = ctx.store ?? opt('store');
      if (!store) throw new Error('hub-core: no fleet store on ctx');
      const nowFn = typeof ctx.now === 'function' ? ctx.now : Date.now;
      const view = typeof ctx.view === 'function' ? ctx.view : () => store.view(nowFn());
      const aggregatesFn = typeof ctx.aggregates === 'function' ? ctx.aggregates : defaultAggregates;
      const send = (res, body, status = 200) => ctx.json(res, body, status);

      // Wrap a handler: HttpError -> its status; anything else -> 500 without detail.
      const handle = (fn) => async (req, res) => {
        try {
          await fn(req, res);
        } catch (err) {
          if (err instanceof HttpError) return send(res, { error: err.error, ...(err.reason ? { reason: err.reason } : {}) }, err.status);
          ctx.log?.error?.('hub route failed', req.method, String(req.url).slice(0, 200), err?.stack || String(err));
          if (!res.headersSent) send(res, { error: 'internal error' }, 500);
          else res.end();
        }
      };
      const remoteOnly = (req) => {
        if (!isRemoteUser(req.auth)) throw new HttpError(403, 'forbidden', req.auth?.readOnly === true ? 'read-only' : 'remote-only');
      };
      const query = (req) => req.query ?? new URL(req.url, 'http://hub.invalid').searchParams;

      // --- fleet reads --------------------------------------------------------
      ctx.route('GET', '/api/fleet', handle((req, res) => {
        const v = view();
        let agg = null;
        try { agg = aggregatesFn(v, v.now); } catch (err) { ctx.log?.warn?.('aggregates failed', String(err?.message || err)); }
        send(res, { hub: { version: ctx.version ?? v.hubVersion ?? null, now: v.now }, builders: v.builders.map(builderRow), aggregates: agg });
      }));

      function snapshotBody(id) {
        if (typeof id !== 'string' || !BUILDER_ID_RX.test(id)) return null;
        const entry = store.builder(id);
        if (!entry) return null;
        const row = view().builders.find((b) => b.id === id);
        return {
          builder: { id, code: row?.code ?? entry.code ?? null },
          ...(snapshotOf(entry) ?? { sessions: [], lanes: [], box: null, vitals: null, attention: [], generatedAt: null }),
          state: row?.state ?? 'connecting',
          stale: row ? row.stale : true,
          ageMs: row?.ageMs ?? null,
          seq: entry.seq ?? null,
        };
      }

      ctx.route('GET', '/api/fleet/:builder/snapshot', handle((req, res) => {
        const body = snapshotBody(req.params.builder);
        if (!body) return send(res, { error: 'unknown builder' }, 404);
        return send(res, body);
      }));

      // Compat: bin/laneboard pointed at a hub (`?b=<id>`, default the first configured builder).
      ctx.route('GET', '/api/state', handle((req, res) => {
        const q = query(req).get('b');
        const id = q === null || q === '' ? store.list()[0]?.id : q;
        const body = snapshotBody(id);
        if (!body) return send(res, { error: 'unknown builder', builders: store.list().map((b) => b.id) }, 404);
        return send(res, body);
      }));

      ctx.route('GET', '/api/map', handle((req, res) => {
        const m = ctx.mapModel;
        return send(res, m && typeof m.model === 'function' ? m.model() : { nodes: [], links: [], events: [] });
      }));

      // --- control (remote-only) ---------------------------------------------
      ctx.route('POST', '/api/fleet/actions', handle(async (req, res) => {
        remoteOnly(req);
        const relay = ctx.relay ?? opt('relay');
        if (!relay) return send(res, { error: 'relay unavailable' }, 503);
        const body = await readJsonLimited(req);
        // The whole classified auth goes to the relay (SR11 L2), never a body field.
        const r = await relay.relay(body, req.auth);
        const status = Number.isInteger(r?.status) ? r.status : (r?.ok ? 200 : 500);
        return send(res, r, status);
      }));

      // Dry run: no side effects, so `local` may ask too (§3 2.8).
      ctx.route('POST', '/api/fleet/placement', handle(async (req, res) => {
        const relay = ctx.relay ?? opt('relay');
        if (!relay || typeof relay.place !== 'function') return send(res, { error: 'placement unavailable' }, 503);
        const body = await readJsonLimited(req);
        if (!isObj(body)) throw new HttpError(400, 'body must be an object');
        const o = {};
        if (body.repo !== undefined && body.repo !== null) {
          if (typeof body.repo !== 'string' || !REPO_RX.test(body.repo) || body.repo.includes('..')) throw new HttpError(400, 'bad repo');
          o.repo = body.repo;
        }
        if (body.need !== undefined) {
          if (body.need !== 'launch' && body.need !== 'spawn') throw new HttpError(400, 'bad need');
          o.need = body.need;
        }
        return send(res, { ranked: relay.place(o) });
      }));

      // --- audit (H13) --------------------------------------------------------
      const reconciler = () => ctx.auditReconciler ?? opt('auditForks');
      ctx.route('GET', '/api/fleet/audit', handle((req, res) => {
        const r = reconciler();
        if (!r || typeof r.list !== 'function') return send(res, { error: 'audit unavailable' }, 503);
        const q = query(req);
        const b = q.get('builder');
        if (b !== null && b !== '' && !BUILDER_ID_RX.test(b)) throw new HttpError(400, 'bad builder');
        const out = r.list({ since: sinceOf(q.get('since') ?? undefined), builder: b || undefined, limit: limitOf(q.get('limit') ?? undefined) });
        return send(res, { ...out, status: typeof r.status === 'function' ? r.status() : undefined });
      }));

      // One rebase route (H13-fix handleRebase): {builder, confirm:<builder id>, onto:'genesis'|'head'}.
      // Direct-only (remoteOnly first, then handleRebase's own check) with the typed confirm.
      ctx.route('POST', '/api/fleet/audit/rebase', handle(async (req, res) => {
        remoteOnly(req);
        const r = reconciler();
        if (!r || typeof r.rebase !== 'function') return send(res, { error: 'audit unavailable' }, 503);
        const body = await readJsonLimited(req);
        if (!isObj(body)) throw new HttpError(400, 'body must be an object');
        const id = body.builder;
        if (typeof id !== 'string' || !BUILDER_ID_RX.test(id) || !store.builder(id)) throw new HttpError(400, 'bad builder');
        const onto = body.onto === undefined ? 'genesis' : body.onto;
        if (onto === 'head' && typeof r.rebaseToHead !== 'function') return send(res, { error: 'audit unavailable' }, 503);
        const out = await handleRebase(r, { builder: id, confirm: body.confirm, onto, auth: req.auth });
        if (out.status === 200) ctx.log?.info?.(`audit: ${req.auth.user} rebased the anchor of ${id} onto ${onto}`);
        return send(res, out.body, out.status);
      }));

      // --- read proxy (H12): /api/fleet/:builder/v1/<rest> ---------------------
      // http.mjs patterns have no wildcard: one route per depth. The proxy
      // re-parses the RAW url itself and 404s anything outside its allowlist.
      const proxy = handle(async (req, res) => {
        const rp = ctx.readProxy ?? opt('readProxy');
        if (!rp) return send(res, { error: 'read proxy unavailable' }, 503);
        if (!(await rp.route(req, res))) send(res, { error: 'not found' }, 404);
      });
      ctx.route('GET', '/api/fleet/:builder/v1/:p1', proxy);
      ctx.route('GET', '/api/fleet/:builder/v1/:p1/:p2', proxy);
      ctx.route('GET', '/api/fleet/:builder/v1/:p1/:p2/:p3', proxy);
      ctx.route('GET', '/api/fleet/:builder/v1/:p1/:p2/:p3/:p4', proxy);

      // --- push (VAPID + subscriptions in the hub db; sends only from O9 and the test) --
      const push = () => ctx.push ?? opt('push');
      ctx.route('GET', '/api/push/key', handle((req, res) => {
        const p = push();
        if (!p) return send(res, { error: 'push unavailable' }, 503);
        const n = opt('notify');
        const muted = n && typeof n.prefs === 'function' ? n.prefs().mutedTargets ?? [] : [];
        return send(res, { publicKey: p.publicKey(), secureContext: true, quiet: { global: false, sessions: muted } });
      }));
      // SR13 L1: who owns which endpoint (kv `push.owners` {endpoint: user}), for the per-user cap.
      const kv = ctx.db && typeof ctx.db.kvRead === 'function' ? ctx.db : opt('db');
      const owners = () => {
        const o = kv?.kvRead?.(OWNERS_KEY, null);
        return isObj(o) ? o : {};
      };
      const saveOwners = (o) => kv?.kvWrite?.(OWNERS_KEY, o);
      const pushHosts = pushHostList(ctx.config?.push?.allowedEndpointHosts, (h) => {
        ctx.log?.warn?.(`push.allowedEndpointHosts: ignoring ${JSON.stringify(h)?.slice(0, 80)} (a host name, or *.domain)`);
      });
      ctx.route('POST', '/api/push/subscribe', handle(async (req, res) => {
        remoteOnly(req);
        const p = push();
        if (!p) return send(res, { error: 'push unavailable' }, 503);
        const sub = checkSubscription(await readJsonLimited(req, 8 * 1024), pushHosts);
        if (!sub) throw new HttpError(400, 'not a push subscription', 'endpoint must be https on a known push service');
        const user = req.auth.user;
        const list = p.subscriptions.list();
        const live = new Set(list.map((s) => s.endpoint));
        const own = Object.fromEntries(Object.entries(owners()).filter(([e, u]) => live.has(e) && typeof u === 'string'));
        const known = live.has(sub.endpoint);
        if (known && own[sub.endpoint] !== undefined && own[sub.endpoint] !== user) throw new HttpError(409, 'subscription belongs to another user');
        if (!known && p.count() >= SUBSCRIPTIONS_MAX) throw new HttpError(409, 'too many subscriptions');
        if (own[sub.endpoint] !== user && Object.values(own).filter((u) => u === user).length >= SUBSCRIPTIONS_PER_USER) {
          throw new HttpError(409, 'too many subscriptions for this user');
        }
        const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 200) : null;
        p.subscribe(sub, ua);
        own[sub.endpoint] = user;
        saveOwners(own);
        ctx.log?.info?.(`push subscription added (${p.count()} total)`);
        return send(res, { ok: true, subscribers: p.count() });
      }));
      ctx.route('DELETE', '/api/push/subscribe', handle(async (req, res) => {
        remoteOnly(req);
        const p = push();
        if (!p) return send(res, { error: 'push unavailable' }, 503);
        const body = await readJsonLimited(req, 8 * 1024);
        if (isObj(body) && typeof body.endpoint === 'string' && body.endpoint.length <= ENDPOINT_MAX) {
          const own = owners();
          const owner = Object.hasOwn(own, body.endpoint) ? own[body.endpoint] : undefined;
          if (owner !== undefined && owner !== req.auth.user) throw new HttpError(403, 'forbidden', 'not your subscription');
          p.unsubscribe(body.endpoint);
          if (owner !== undefined) { delete own[body.endpoint]; saveOwners(own); }
        }
        return send(res, { ok: true, subscribers: p.count() });
      }));
      ctx.route('POST', '/api/push/test', handle(async (req, res) => {
        const p = push();
        if (!p) return send(res, { error: 'push unavailable' }, 503);
        return send(res, await p.broadcast({ title: 'Laneboard test', body: 'Push is working.', tag: 'laneboard-test', url: '/' }));
      }));
      // The builder's quiet toggle, mapped onto O9's per-target mute.
      // SR13 L1: muting hides alarms from the operator, so it needs a direct user (local keeps reads).
      ctx.route('POST', '/api/push/quiet', handle(async (req, res) => {
        remoteOnly(req);
        const n = opt('notify');
        if (!n || typeof n.setMuted !== 'function') return send(res, { error: 'notifications unavailable' }, 503);
        const body = await readJsonLimited(req, 8 * 1024);
        if (!isObj(body)) throw new HttpError(400, 'body must be an object');
        if (body.global !== undefined) throw new HttpError(400, 'global quiet is per kind on a hub', 'use /api/notify/prefs');
        if (typeof body.session !== 'string' || !parseFkey(body.session)) throw new HttpError(400, 'session must be a fleet key');
        try {
          n.setMuted(body.session, body.quiet === true);
        } catch (err) {
          throw new HttpError(400, err instanceof RangeError ? 'too many muted targets' : 'bad session');
        }
        return send(res, { global: false, sessions: n.prefs().mutedTargets ?? [] });
      }));
    },
  };
}

export default createModule();
