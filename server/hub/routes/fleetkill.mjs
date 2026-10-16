// Hub module: fleet kill with undo (fleet plan §8 2.6, §3 2.10, C9). REVIEW-REQUIRED (SR19).
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// - Registers the hub-local `kill` for `builder:'*'` with the relay: registerHubAction('kill',
//   {scope:'fanout', run}). Only a `builder:'*'` request reaches it; a `kill` for one builder is relayed as
//   usual. The relay has already required a `direct` user (403 remote-only otherwise) and hands `ctx.fanout`,
//   which rewrites the typed `fleet` confirm to each builder's id. The handler (server/hub/fleetkill.mjs)
//   checks the typed `fleet` itself before anything is sent, validates an optional `include` of fleet keys
//   against the fleet store (ctx.store) and audits an undo with both users (ctx.audit).
// - `kill` is also a builder action name. The relay's registry (SR11 L1, HUB_REGISTRABLE) allows `kill` in the
//   fan-out scope without `override`, so none is passed. A registry error is never retried with `override`
//   (SR11 R1: override is honoured only for boot/hub.mjs's core allowlist); it propagates.
// - GET /api/fleet/kill: the recent fleet kill jobs (read-only, for the dialog's countdown) as
//   {jobs:[{job, state, by, startedAt, killAt, pause, kill, undo}]}.
// - stop(): a pending undo window is dropped, nothing is killed, the fleet stays paused (fails safe).
//
// Imports only hub-safe modules.
import { createFleetKill } from '../fleetkill.mjs';

export const PATH = '/api/fleet/kill';
export const ACTION = 'kill';

function opt(ctx, name) {
  try {
    return typeof ctx.has === 'function' && ctx.has(name) ? ctx.use(name) : null;
  } catch {
    return null;
  }
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

/** Register `def` for the fan-out scope. Never asks for `override` and never retries (SR11 R1). */
export function registerFanoutKill(register, run) {
  return register(ACTION, { scope: 'fanout', run });
}

export function createModule(opts = {}) {
  let svc = null;
  let unregister = null;

  return {
    name: 'hub-fleetkill',
    modes: ['hub'],
    async register(ctx) {
      svc = createFleetKill({ log: ctx.log ?? null, ...opts });
      if (typeof ctx.provide === 'function') ctx.provide('fleetkill', { get: svc.get, list: svc.list });
      ctx.route('GET', PATH, (req, res) => ctx.json(res, { jobs: svc.list() }));
      const register = await hubActionRegistrar(ctx);
      if (!register) {
        ctx.log?.warn?.('fleetkill: no relay registerHubAction; fleet kill is not served on this hub');
        return;
      }
      const ret = registerFanoutKill(register, (req, rctx) => svc.run(req, rctx));
      unregister = typeof ret === 'function' ? ret : null;
    },
    stop() {
      svc?.stop();
      unregister?.();
      unregister = null;
    },
    // for tests
    get service() { return svc; },
  };
}

export default createModule();
