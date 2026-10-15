// Hub module: the hub-local `broadcast` action (fleet plan §8 2.4, task C8). REVIEW-REQUIRED (SR18).
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// Registers `broadcast` with the relay's registerHubAction (the ctx `relay`, else the relay module's global
// registry), so `POST /api/fleet/actions {builder:'*'|null, action:'broadcast', target:'*', args}` is planned
// and fanned out on the hub (server/hub/broadcast.mjs) and never relayed to a builder as-is. It adds no HTTP
// route of its own: the preview is the same pure planner in the browser (public/js/core/broadcast-plan.js), and
// a confirmCount mismatch answers 409 with the fresh plan. `broadcast` is a hub-only name (no builder action
// collides with it), so no `override` is needed.
//
// Imports only hub-safe modules: no server/state.mjs, server/db.mjs, server/config.mjs, server/routes/*.
import { createBroadcast, ACTION } from '../broadcast.mjs';

function opt(c, name) {
  try { return c && typeof c.has === 'function' && c.has(name) ? c.use(name) : null; } catch { return null; }
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

export function createModule({ now } = {}) {
  const broadcast = createBroadcast(now ? { now } : {});
  let unregister = null;
  return {
    name: 'hub-broadcast',
    modes: ['hub'],
    broadcast,
    async register(ctx) {
      const registerHubAction = await hubActionRegistrar(ctx);
      if (!registerHubAction) {
        ctx.log?.warn?.('broadcast: no relay registerHubAction; broadcast is not served on this hub');
        return;
      }
      const off = registerHubAction(ACTION, { run: (req, rctx) => broadcast.run(req, rctx) });
      unregister = typeof off === 'function' ? off : null;
    },
    stop() {
      if (unregister) unregister();
      unregister = null;
    },
  };
}

export default createModule();
