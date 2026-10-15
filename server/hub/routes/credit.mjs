// Hub module (fleet §7.3.8, O11): `GET /api/fleet/credit?b=`.
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// Fans out to every configured builder's `GET /api/v1/credit` through the
// signed read proxy (H12, `readProxy.get(id, '/api/v1/credit', {timeoutMs:3000})`)
// and merges with mergeCredit (server/hub/credit.mjs).
//
// - A builder that is down, slow (3 s) or answers garbage does not fail the
//   response: its last good answer (if any) is used and marked stale, a
//   builder that never answered is listed in `missing`.
// - Results are cached 15 s (like the builder's `memo('credit')`), per builder
//   and for the merge; concurrent requests share one in-flight fan-out.
// - `?b=<id>` returns that builder's result unmerged except for the fleet keys
//   (404 for an id that is not configured; 503 when it has never answered).
// - Route auth (direct or local) is the hub boot path's, as for every hub route.
//
// Hub module: imports only server/hub/* and server/fleet/*.
import { mergeCredit, sanitizePart, withFkeys } from '../credit.mjs';
import { BUILDER_ID_RX } from '../../fleet/keys.mjs';

export const PATH = '/api/fleet/credit';
export const UPSTREAM_PATH = '/api/v1/credit';
export const TIMEOUT_MS = 3000;
export const CACHE_MS = 15_000;

/**
 * The fan-out. `get` is readProxy.get; `builders()` -> [{id, code, account}]
 * (the hub's configured builders).
 */
export function createCreditService({ get, builders, now = Date.now, timeoutMs = TIMEOUT_MS, cacheMs = CACHE_MS } = {}) {
  if (typeof get !== 'function') throw new TypeError('credit service: get is required');
  if (typeof builders !== 'function') throw new TypeError('credit service: builders is required');
  const fetched = new Map(); // id -> {at, promise}   15 s fetch cache
  const good = new Map();    // id -> {data, at}       last good answer
  let merged = null;         // {at, promise}

  function configured() {
    let list;
    try { list = builders(); } catch { list = []; }
    const out = [];
    const seen = new Set();
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || typeof b.id !== 'string' || !BUILDER_ID_RX.test(b.id) || seen.has(b.id)) continue;
      seen.add(b.id);
      out.push({ id: b.id, code: b.code ?? null, account: b.account ?? 'default' });
    }
    return out;
  }

  async function pull(b) {
    let r;
    try {
      r = await get(b.id, UPSTREAM_PATH, { timeoutMs });
    } catch {
      r = { status: 502, json: { error: 'read proxy error' } };
    }
    const t = now();
    const data = r && r.status === 200 ? sanitizePart(r.json) : null;
    if (data) {
      good.set(b.id, { data, at: t });
      return { builder: b.id, code: b.code, account: b.account, data, stale: false, ageMs: 0 };
    }
    const last = good.get(b.id);
    const error = typeof r?.json?.error === 'string' ? r.json.error : `status ${r?.status ?? 'none'}`;
    return {
      builder: b.id,
      code: b.code,
      account: b.account,
      data: last ? last.data : null,
      stale: true,
      ageMs: last ? Math.max(0, t - last.at) : null,
      error,
    };
  }

  function partOf(b) {
    const t = now();
    const c = fetched.get(b.id);
    if (c && t - c.at < cacheMs) return c.promise;
    const promise = pull(b);
    fetched.set(b.id, { at: t, promise });
    return promise;
  }

  /** The merged fleet view. */
  function fleet() {
    const t = now();
    if (merged && t - merged.at < cacheMs) return merged.promise;
    const list = configured();
    for (const id of fetched.keys()) if (!list.some((b) => b.id === id)) { fetched.delete(id); good.delete(id); }
    const promise = Promise.all(list.map(partOf)).then((parts) => mergeCredit(parts, { now: now() }));
    merged = { at: t, promise };
    promise.catch(() => { if (merged?.promise === promise) merged = null; });
    return promise;
  }

  /**
   * One builder: {status, body}. 404 when `id` is not a configured builder,
   * 503 when it has never answered.
   */
  async function one(id) {
    const b = configured().find((x) => x.id === id);
    if (!b) return { status: 404, body: { ok: false, error: 'unknown builder' } };
    const p = await partOf(b);
    if (!p.data) return { status: 503, body: { ok: false, error: 'builder down', builder: id, stale: true, detail: p.error ?? null } };
    return {
      status: 200,
      body: { ...withFkeys(p.data, id), code: b.code, account: b.account, stale: p.stale, ageMs: p.ageMs, ...(p.error ? { error: p.error } : {}) },
    };
  }

  function clear() {
    fetched.clear();
    good.clear();
    merged = null;
  }

  return { fleet, one, clear };
}

/** The hub's configured builders from the fleet store (read-only use of its entries). */
function buildersFromStore(store) {
  return () => {
    if (!store || typeof store.list !== 'function') return [];
    return store.list().map((e) => ({ id: e.id, code: e.code ?? null, account: e.account ?? 'default' }));
  };
}

export function createModule(opts = {}) {
  let svc = opts.service ?? null;
  let base = null;

  function service(extra = {}) {
    if (svc) return svc;
    const c = { ...(base ?? {}), ...extra };
    const pick = (name) => {
      if (opts[name]) return opts[name];
      if (c[name]) return c[name];
      if (typeof base?.has === 'function' && base.has(name)) return base.use(name);
      return null;
    };
    const readProxy = pick('readProxy');
    const store = pick('store');
    if (!readProxy || typeof readProxy.get !== 'function' || !store) return null;
    svc = createCreditService({
      get: (id, p, o) => readProxy.get(id, p, o),
      builders: buildersFromStore(store),
      now: typeof (opts.now ?? c.now) === 'function' ? (opts.now ?? c.now) : Date.now,
    });
    return svc;
  }

  return {
    name: 'hub-credit',
    modes: ['hub'],
    register(ctx) {
      base = ctx;
      ctx.route('GET', PATH, async (req, res) => {
        const s = service();
        if (!s) return ctx.json(res, { ok: false, error: 'credit service not ready' }, 503);
        let b = null;
        try { b = new URL(req.url ?? '/', 'http://hub.invalid').searchParams.get('b'); } catch { b = null; }
        try {
          if (b !== null && b !== '') {
            if (!BUILDER_ID_RX.test(b)) return ctx.json(res, { ok: false, error: 'unknown builder' }, 404);
            const r = await s.one(b);
            return ctx.json(res, r.body, r.status);
          }
          return ctx.json(res, await s.fleet());
        } catch {
          return ctx.json(res, { ok: false, error: 'credit merge failed' }, 500);
        }
      });
      const services = ctx.services && typeof ctx.services.register === 'function'
        ? ctx.services
        : (typeof ctx.has === 'function' && ctx.has('services') ? ctx.use('services') : null);
      if (services && typeof services.register === 'function') {
        // Only to learn readProxy/store from the hook's start ctx; no timers.
        services.register({
          name: 'credit',
          start(sctx) {
            service(sctx ?? {});
            return () => {};
          },
        });
      }
    },
    stop() {
      svc?.clear?.();
    },
  };
}

export default createModule();
