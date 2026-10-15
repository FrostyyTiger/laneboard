// Hub module (fleet §7 O10): `GET /api/review-waits?since=` and the
// review-wait service. Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// - provides `reviewWaits` (the createReviewWaits instance) in register, so
//   §7 O8 derives `review-overdue` from `open()`/`overdue()` and §10 R10 reads
//   `stats()`/`open()` for Morning;
// - the service feeds every builder's lanes from the fleet store and handles
//   the browser's `touch` message (direct users only). It registers on the §3
//   services hook (`ctx.services`, H11) when there is one, else start(ctx)
//   runs it from `ctx.store` / `ctx.onClientMessage`;
// - persistence: the hub db's kv (`ctx.db`, or a provided `db` service, with
//   kvRead/kvWrite), else a JSON file under `<stateDir>/hub/`.
//
// Route auth (direct or local) is the hub boot path's, as for every hub route.
import path from 'node:path';
import { createReviewWaits, createJsonKv, startReviewWaitService, WINDOW_MS } from '../reviewwait.mjs';
import { stateDir as defaultStateDir } from '../../fleet/paths.mjs';

const isKv = (d) => !!d && typeof d.kvRead === 'function' && typeof d.kvWrite === 'function';

/** `since` as ms epoch or an ISO date; anything else -> undefined (the 7 d default). */
export function parseSince(v) {
  if (typeof v !== 'string' || v === '' || v.length > 40) return undefined;
  if (/^\d{1,16}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function createModule() {
  let waits = null;
  let stopSvc = null;
  let viaHook = false;
  let backend = null;
  let base = null;

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

  // Lazy proxy: the instance is created in register (so it can be provided),
  // the backend is chosen on first use (start or later).
  const lazyDb = {
    kvRead: (k, f) => resolveDb().kvRead(k, f),
    kvWrite: (k, v) => resolveDb().kvWrite(k, v),
  };

  function servicesOf(ctx) {
    if (ctx.services && typeof ctx.services.register === 'function') return ctx.services;
    if (typeof ctx.has === 'function' && ctx.has('services')) {
      const s = ctx.use('services');
      if (s && typeof s.register === 'function') return s;
    }
    return null;
  }

  function run(c) {
    if (stopSvc) return;
    stopSvc = startReviewWaitService({
      waits,
      store: c.store,
      onClientMessage: c.onClientMessage ?? c.clientWs?.onClientMessage,
    });
  }

  return {
    name: 'hub-review-waits',
    modes: ['hub'],
    register(ctx) {
      base = ctx;
      waits = createReviewWaits({
        db: lazyDb,
        now: typeof ctx.now === 'function' ? ctx.now : Date.now,
        cfg: ctx.config ?? {},
      });
      if (typeof ctx.provide === 'function') ctx.provide('reviewWaits', waits);
      ctx.route('GET', '/api/review-waits', (req, res) => {
        let since;
        try { since = parseSince(new URL(req.url, 'http://hub.invalid').searchParams.get('since') ?? undefined); } catch { since = undefined; }
        return ctx.json(res, {
          open: waits.open().map(({ fkey, waitingMs }) => ({ fkey, waitingMs })),
          stats: waits.stats({ since }),
          windowMs: WINDOW_MS,
          overdueMs: waits.overdueMs,
        });
      });
      const services = servicesOf(ctx);
      if (services) {
        viaHook = true;
        services.register({
          name: 'review-waits',
          start(sctx) {
            base = { ...ctx, ...sctx, has: ctx.has, use: ctx.use };
            run({ ...ctx, ...sctx });
            return () => { stopSvc?.(); stopSvc = null; };
          },
        });
      }
    },
    start(ctx) {
      if (viaHook || !ctx.store) return;
      run(ctx);
    },
    stop() {
      stopSvc?.();
      stopSvc = null;
    },
  };
}

export default createModule();
