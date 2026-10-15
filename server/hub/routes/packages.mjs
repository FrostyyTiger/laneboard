// Hub module (fleet §6 P11): `GET /api/packages` and the packages-merge
// service. Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// The service registers on the §3 services hook (`ctx.services`, H11) when
// it is there, so it starts with the other fleet services and gets their
// `{store, broadcast, now, config}`. Without the hook (before H11, or a test
// ctx) start(ctx) runs it directly from `ctx.store` / `ctx.broadcast`.
//
// The merge reads only the fleet store's sanitized view (never a raw builder
// frame); see server/hub/packages.mjs for the merge and its trust rules.
import { createPackagesService } from '../packages.mjs';

export function createModule() {
  let svc = null;
  let viaHook = false;

  function ensure(c) {
    if (!svc) {
      svc = createPackagesService({
        store: c.store,
        broadcast: typeof c.broadcast === 'function' ? c.broadcast : () => {},
        now: typeof c.now === 'function' ? c.now : Date.now,
        cfg: c.config?.packages ?? {},
      });
    }
    return svc;
  }

  function servicesOf(ctx) {
    if (ctx.services && typeof ctx.services.register === 'function') return ctx.services;
    if (typeof ctx.has === 'function' && ctx.has('services')) {
      const s = ctx.use('services');
      if (s && typeof s.register === 'function') return s;
    }
    return null;
  }

  return {
    name: 'hub-packages',
    modes: ['hub'],
    register(ctx) {
      ctx.route('GET', '/api/packages', (req, res) => {
        if (!svc) return ctx.json(res, { error: 'packages service not started' }, 503);
        return ctx.json(res, svc.current());
      });
      const services = servicesOf(ctx);
      if (services) {
        viaHook = true;
        services.register({
          name: 'packages',
          start(sctx) {
            const s = ensure({ ...ctx, ...sctx });
            s.start();
            return () => s.stop();
          },
        });
      }
    },
    start(ctx) {
      if (viaHook || !ctx.store) return;
      ensure(ctx).start();
    },
    stop() {
      svc?.stop();
      svc = null;
    },
  };
}

export default createModule();
