// Hub module: fleet alarms (fleet plan §7.3.5, O8). REVIEW-REQUIRED (SR20).
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// - The service derives alarms (server/fleet/alarms.mjs derive) from the
//   fleet store's sanitized view on every store change, throttled to
//   `alarms.evalMs` (1/s), plus a slow beat so age-based states (stale/down,
//   overdue reviews) are seen without traffic. It reconciles them into the
//   kv-backed live map (server/fleet/alarms-store.mjs) and broadcasts
//   `{type:'alarms', alarms}` to every hub client when the live set changes.
//   Builder `alarms` frames are never read: the store does not even keep them.
// - Inputs beyond the store view, all optional: the merged packages
//   (server/hub/packages.mjs merge over the same view: ci-red-main, ci-red,
//   conflict), `reviewWaits.overdue()` when §7 O10's service is provided
//   (review-overdue), and an `auditForks` service from §3 H13 when provided
//   (audit-fork: a function, or an object with forks()/list(), returning
//   [{builder, text?}]).
// - `ack-alarm` is a hub-local action: registered with the relay's
//   registerHubAction (§3 2.10) and handled here, NEVER relayed to a builder.
//   It needs a `direct` user (README §3.5: on the hub every action needs
//   direct; `local` -> 403 remote-only), validates target/args strictly, is
//   audited fail-closed in the hub's own chain (start entry before the ack,
//   outcome entry after) and broadcasts the new live set.
// - provides `alarms` = {live(), get(id), ack(input), subscribe(fn)} so §7 O9
//   gets the raises ({raised, cleared, acked} per change) and §10 R10 can list
//   the live set.
// - Persistence: the hub db's kv (`ctx.db`, or a provided `db` service), else
//   a JSON-file kv under `<stateDir>/hub/` (as review-waits does).
//
// Imports only hub-safe modules: no server/state.mjs, server/db.mjs,
// server/config.mjs, server/routes/* or server/flags/*.
import path from 'node:path';
import { derive, KIND_TO_TILE, TILES, ALARM_ID_RE, LINK_KINDS, AlarmError } from '../../fleet/alarms.mjs';
import { createAlarmStore } from '../../fleet/alarms-store.mjs';
import { BUILDER_ID_RX } from '../../fleet/keys.mjs';
import { stateDir as defaultStateDir } from '../../fleet/paths.mjs';
import { createJsonKv } from '../reviewwait.mjs';
import { merge as mergePackages, inputFromView } from '../packages.mjs';

export const PATH = '/api/alarms';
export const BEAT_MS = 5000;
export const WIRE_MAX = 1000;
const ACTION = 'ack-alarm';
const PKG_EVENTS = new Set(['snapshot', 'repos', 'conn']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isKv = (d) => !!d && typeof d.kvRead === 'function' && typeof d.kvWrite === 'function';

/** A refusal in the relay's result shape. */
function refuse(status, code, error = code) {
  return { ok: false, status, code, error };
}

/**
 * Validate an ack-alarm request from the hub API. Pure.
 * -> {ok:true, target, args:{tile?, builder?}} | refusal
 */
export function checkAck(target, args) {
  if (typeof target !== 'string' || (target !== '*' && !ALARM_ID_RE.test(target))) return refuse(400, 'bad_target', 'invalid alarm id');
  const a = args === undefined || args === null ? {} : args;
  if (!isObj(a) || (Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null)) return refuse(400, 'bad_args', 'args must be an object');
  for (const k of Object.keys(a)) {
    if (k !== 'tile' && k !== 'builder') return refuse(400, 'bad_args', `unknown key ${JSON.stringify(String(k).slice(0, 40))}`);
  }
  const out = {};
  if (a.tile !== undefined) {
    if (typeof a.tile !== 'string' || !TILES.includes(a.tile)) return refuse(400, 'bad_args', 'args.tile is not an allowed value');
    out.tile = a.tile;
  }
  if (a.builder !== undefined) {
    if (typeof a.builder !== 'string' || !BUILDER_ID_RX.test(a.builder)) return refuse(400, 'bad_args', 'args.builder has an invalid format');
    out.builder = a.builder;
  }
  if (target !== '*' && (out.tile !== undefined || out.builder !== undefined)) return refuse(400, 'bad_args', 'tile and builder scope target * only');
  return { ok: true, target, args: out };
}

/** Who is acting, from whatever shape the relay hands a hub-local handler. */
function actorOf(req, user2) {
  const r = isObj(req) ? req : {};
  const auth = isObj(r.auth) ? r.auth : null;
  const kind = auth?.kind ?? r.kind;
  const user = typeof r.user === 'string' ? r.user : (typeof user2 === 'string' ? user2 : (typeof auth?.user === 'string' ? auth.user : null));
  return { kind: typeof kind === 'string' ? kind : null, user };
}

/**
 * The alarm service over a fleet store. Exported for tests.
 *   createAlarmService({fleetStore, alarmStore, broadcast, now, evalMs, audit,
 *     reviewWaits?, auditForks?, timers?, log?})
 */
export function createAlarmService({
  fleetStore, alarmStore, broadcast = () => {}, now = Date.now, evalMs = 1000, audit = null,
  reviewWaits = null, auditForks = null, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, log = null,
} = {}) {
  if (!fleetStore || typeof fleetStore.view !== 'function') throw new TypeError('alarm service: fleet store required');
  if (!alarmStore) throw new TypeError('alarm service: alarm store required');
  const clock = typeof now === 'function' ? now : Date.now;
  const every = Math.max(100, Number(evalMs) || 1000);
  const listeners = new Set();
  let unsubscribe = null;
  let timer = null;
  let beat = null;
  let lastEval = -Infinity;
  let pkgCache = null;
  let pkgDirty = true;

  function emit(change) {
    for (const fn of [...listeners]) {
      try { fn(change); } catch { /* a listener never breaks evaluation */ }
    }
  }

  function send() {
    try { broadcast({ type: 'alarms', alarms: alarmStore.live().slice(0, WIRE_MAX) }); } catch { /* client-ws errors never stop the service */ }
  }

  function packagesOf(view, t) {
    if (!pkgDirty && pkgCache) return pkgCache;
    pkgDirty = false;
    try {
      const input = inputFromView(view).filter((b) => b.data?.repos);
      pkgCache = input.length ? mergePackages(input, { now: t }) : null;
    } catch (err) {
      pkgCache = null;
      log?.error?.('alarms: packages merge failed', String(err?.message || err));
    }
    return pkgCache;
  }

  function forksOf() {
    try {
      const src = auditForks;
      if (!src) return [];
      const v = typeof src === 'function' ? src() : (typeof src.forks === 'function' ? src.forks() : (typeof src.list === 'function' ? src.list() : []));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function overdueOf() {
    try {
      const v = reviewWaits && typeof reviewWaits.overdue === 'function' ? reviewWaits.overdue() : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  /** One evaluation now. -> {raised, cleared, changed} */
  function evaluate() {
    const t = clock();
    lastEval = t;
    const view = fleetStore.view(t);
    const fleet = { ...view, packages: packagesOf(view, t), reviewWaits: overdueOf(), auditForks: forksOf() };
    const known = new Map((view.builders ?? []).map((b) => [b.id, b]));
    // A builder that has not reported since a hub restart keeps its alarms
    // (and their acks) until it does; link kinds are always re-derived.
    const hold = (a) => {
      if (!a.builder || LINK_KINDS.includes(a.kind)) return false;
      const b = known.get(a.builder);
      return !!b && (!b.snap || b.state === 'connecting');
    };
    const res = alarmStore.apply(derive(fleet, t), { hold });
    if (res.changed) {
      send();
      emit({ raised: res.raised, cleared: res.cleared, acked: [] });
    }
    return res;
  }

  function run() {
    timer = null;
    try { evaluate(); } catch (err) { log?.error?.('alarms: evaluation failed', String(err?.message || err)); }
  }

  /** Throttled: at most one evaluation per `every` ms, trailing edge kept. */
  function schedule() {
    if (timer) return;
    const wait = Math.max(0, lastEval + every - clock());
    timer = timers.setTimeout(run, wait);
    timer?.unref?.();
  }

  function onEvent(ev) {
    if (!ev) return;
    if (PKG_EVENTS.has(ev.kind) || (ev.kind === 'delta' && ev.lanes)) pkgDirty = true;
    schedule();
  }

  /**
   * The hub-local `ack-alarm` handler. `req` is the relay's request
   * ({builder, action, target, args, user, auth?}); `user2` a user passed
   * separately. -> {ok, status, result|error, code?, auditId}
   */
  function handleAck(req, user2) {
    const { kind, user } = actorOf(req, user2);
    const r = isObj(req) ? req : {};
    if ((kind !== null && kind !== 'direct') || !user || user === 'local') return refuse(403, 'remote-only', 'ack-alarm on the hub needs a direct user');
    if (r.action !== undefined && r.action !== ACTION) return refuse(400, 'unknown_action', 'not ack-alarm');
    const checked = checkAck(r.target, r.args);
    const entry = (result) => audit.append({
      user, via: 'direct', builder: null, action: ACTION,
      target: typeof r.target === 'string' ? r.target.slice(0, 128) : null,
      args: checked.ok ? checked.args : { invalid: true }, result,
    });
    if (!audit || typeof audit.append !== 'function') return refuse(503, 'audit-unavailable', 'the audit log is unavailable; nothing was acked');
    if (!checked.ok) {
      let auditId = null;
      try { auditId = entry({ ok: false, status: checked.status, code: checked.code })?.hash ?? null; } catch { /* outcome only */ }
      return { ...checked, auditId };
    }
    try {
      entry({ phase: 'start' });
    } catch {
      return refuse(503, 'audit-unavailable', 'the audit log is unavailable; nothing was acked');
    }
    let out;
    let acked = [];
    if (checked.target === '*') {
      acked = alarmStore.ackMany(checked.args, user, KIND_TO_TILE);
      out = { ok: true, status: 200, result: { acked: acked.map((a) => a.id), n: acked.length } };
    } else {
      const before = alarmStore.get(checked.target);
      const a = alarmStore.ack(checked.target, user);
      if (a instanceof AlarmError) out = refuse(a.status, a.code, a.message);
      else {
        if (before && !before.acked) acked = [a];
        out = { ok: true, status: 200, result: { acked: [a.id], n: 1 } };
      }
    }
    let auditId = null;
    try {
      const res = { phase: 'done', ok: out.ok, status: out.status };
      if (!out.ok) res.code = out.code;
      else res.n = out.result.n;
      auditId = entry(res)?.hash ?? null;
    } catch (err) {
      log?.error?.('alarms: audit append failed after the ack', String(err?.message || err));
    }
    if (acked.length) {
      send();
      emit({ raised: [], cleared: [], acked });
    }
    return { ...out, auditId };
  }

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = fleetStore.subscribe(onEvent);
      beat = timers.setInterval(schedule, Math.max(every, BEAT_MS));
      beat?.unref?.();
      schedule();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (timer) timers.clearTimeout(timer);
      if (beat) timers.clearInterval(beat);
      timer = null;
      beat = null;
    },
    evaluate,
    handleAck,
    live: () => alarmStore.live(),
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('alarms.subscribe needs a function');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function createModule() {
  let svc = null;
  let alarmStore = null;
  let viaHook = false;
  let base = null;
  let backend = null;
  const pendingSubs = new Set();

  function resolveDb() {
    if (backend) return backend;
    const c = base ?? {};
    if (isKv(c.db)) backend = c.db;
    else if (typeof c.has === 'function' && c.has('db') && isKv(c.use('db'))) backend = c.use('db');
    else {
      const dir = typeof c.config?.stateDir === 'string' && c.config.stateDir ? c.config.stateDir : defaultStateDir();
      backend = createJsonKv(path.join(dir, 'hub'));
    }
    return backend;
  }

  // The store is created in register (so `alarms` can be provided); the kv
  // backend is chosen on first use.
  const lazyDb = {
    kvRead: (k, f) => resolveDb().kvRead(k, f),
    kvWrite: (k, v) => resolveDb().kvWrite(k, v),
  };

  function opt(c, name) {
    try { return typeof c.has === 'function' && c.has(name) ? c.use(name) : null; } catch { return null; }
  }

  function ensure(c) {
    if (svc) return svc;
    svc = createAlarmService({
      fleetStore: c.store,
      alarmStore,
      broadcast: typeof c.broadcast === 'function' ? c.broadcast : () => {},
      now: typeof c.now === 'function' ? c.now : Date.now,
      evalMs: c.config?.alarms?.evalMs,
      audit: c.audit ?? opt(c, 'audit'),
      reviewWaits: opt(c, 'reviewWaits'),
      auditForks: opt(c, 'auditForks') ?? opt(c, 'auditReconcile'),
      log: c.log ?? null,
    });
    for (const fn of pendingSubs) svc.subscribe(fn);
    pendingSubs.clear();
    return svc;
  }

  function servicesOf(ctx) {
    if (ctx.services && typeof ctx.services.register === 'function') return ctx.services;
    const s = opt(ctx, 'services');
    return s && typeof s.register === 'function' ? s : null;
  }

  async function hubActionRegistrar(ctx) {
    const relay = ctx.relay ?? opt(ctx, 'relay');
    if (relay && typeof relay.registerHubAction === 'function') return relay.registerHubAction.bind(relay);
    try {
      const mod = await import('../relay.mjs');
      if (typeof mod.registerHubAction === 'function') return mod.registerHubAction;
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
    return null;
  }

  /**
   * The relay calls hub-local handlers as run(req, ctx) (server/hub/relay.mjs runLocal), with ctx.user the
   * login its actingUser() already checked to be a `direct`, non-read-only user (SR20 L1). Only the relay's
   * own fields of req are kept, so nothing else in it can name the actor. A bare string second argument is
   * the older direct-call form.
   */
  function relayAck(req, ctx) {
    if (isObj(ctx)) {
      const r = isObj(req) ? req : {};
      const user = typeof ctx.user === 'string' ? ctx.user : null;
      return api.ack({ builder: r.builder ?? null, action: r.action, target: r.target, args: r.args, auth: { kind: 'direct', user } }, user);
    }
    return api.ack(req, ctx);
  }

  const api = {
    live: () => (alarmStore ? alarmStore.live() : []),
    get: (id) => (alarmStore ? alarmStore.get(id) : null),
    ack: (req, user) => (svc ? svc.handleAck(req, user) : refuse(503, 'unavailable', 'alarms are not running')),
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('alarms.subscribe needs a function');
      if (svc) return svc.subscribe(fn);
      pendingSubs.add(fn);
      return () => pendingSubs.delete(fn);
    },
  };

  return {
    name: 'hub-alarms',
    modes: ['hub'],
    async register(ctx) {
      base = ctx;
      alarmStore = createAlarmStore({ db: lazyDb, historyDays: ctx.config?.alarms?.historyDays, log: ctx.log ?? null });
      if (typeof ctx.provide === 'function') ctx.provide('alarms', api);
      ctx.route('GET', PATH, (req, res) => ctx.json(res, { alarms: api.live().slice(0, WIRE_MAX) }));
      const registerHubAction = await hubActionRegistrar(ctx);
      if (registerHubAction) registerHubAction(ACTION, { run: (req, ctx) => relayAck(req, ctx) });
      else ctx.log?.warn?.('alarms: no relay registerHubAction; ack-alarm is not served on this hub');
      const services = servicesOf(ctx);
      if (services) {
        viaHook = true;
        services.register({
          name: 'alarms',
          start(sctx) {
            base = { ...ctx, ...sctx, has: ctx.has, use: ctx.use };
            const s = ensure(base);
            s.start();
            return () => s.stop();
          },
        });
      }
    },
    start(ctx) {
      if (viaHook || !ctx.store) return;
      base = ctx;
      ensure(ctx).start();
    },
    stop() {
      svc?.stop();
      svc = null;
    },
    // for tests
    api,
  };
}

export default createModule();
