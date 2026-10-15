// Route module: Builder API v1 (fleet plan §1 2.8, §2 2.9). REVIEW-REQUIRED (SR6).
// Builder only, so a hub never registers them (404 there). Handlers and the
// hello registry live in server/fleet/api-v1.mjs.
//
//   GET  /api/v1/hello, /api/v1/snapshot, /api/v1/audit, /api/v1/jobs/:id
//   POST /api/v1/actions                 -> dispatch (hub envelopes verified first)
//   WS   /api/v1/stream                  -> server/fleet/stream.mjs (imported here: activates the ws tap)
//   WS   /api/v1/term/:name              -> terminals.attachNamed, audited as `term`
//
// Every request reached these handlers through http.mjs / boot/common.mjs,
// which classified it (local / direct / signed hub) and applied the kind
// rules first. register() also registers the built-in actions (A6) and the
// audit-only `term` action; the audit log, the limiter and the nonce
// pre-load are opened by builder.mjs (api-v1 initV1) before it listens.
import '../fleet/stream.mjs';
import { ROUTES, addCapability, configureV1, upgradeV1, registerTermAction } from '../fleet/api-v1.mjs';
import { registerBuiltins } from '../fleet/builtin-actions.mjs';

/** The dispatch deps a builder's ctx provides. */
export function depsFrom(ctx) {
  return {
    actions: ctx.actions,
    launcher: ctx.launcher,
    retirer: ctx.retirer,
    state: ctx.state,
    config: ctx.config,
    terminals: ctx.terminals,
    db: ctx.db,
  };
}

export default {
  name: 'v1',
  modes: ['builder'],
  register(ctx) {
    const deps = depsFrom(ctx);
    registerBuiltins(deps);
    registerTermAction();
    configureV1({ deps });
    for (const c of ['stream', 'actions', 'audit', 'term']) addCapability(c);
    for (const r of ROUTES) ctx.route(r.method, r.path, (req, res) => r.handler(req, res, ctx));
    ctx.upgrade((req, socket, head, url) => upgradeV1(req, socket, head, url));
  },
};
