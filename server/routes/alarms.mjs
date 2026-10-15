// Route module: alarms on a standalone builder (fleet plan §7.3.5, O8). REVIEW-REQUIRED (SR20).
//
// A builder without a hub still gets the annunciator: this module derives the
// alarms over a "fleet of one" (alarms.fleetOfOne over this builder's own
// snapshot and its latest health sample), keeps them in the kv store
// (server/fleet/alarms-store.mjs) and sends `{type:'alarms', alarms}` on the
// builder `/ws` whenever the live set changes. The hub ignores builder
// `alarms` frames (it derives its own); the link kinds (builder-down/stale,
// audit-fork, review-overdue) never appear here.
//
//   GET /api/alarms -> {builder, alarms}       (initial load for the UI)
//   action ack-alarm (dispatcher, tier click, localOnly):
//     target <alarm id> | '*' with args {tile?, builder?}
//
// `ack-alarm` is `localOnly`: a signed hub request is refused (403
// `local-only`) by the dispatcher's hub-control step, because a hub acks its
// own alarms and never relays this action. `allConfirm:false` (allowlisted in
// the dispatcher for ack-alarm) lets `*` run without the builder-id confirm:
// an ack changes no session. Every outcome is audited by the dispatcher.
//
// Evaluation runs from state.onTick, throttled to max(alarms.evalMs,
// BUILDER_EVAL_MS): state.snapshot() is not free on a builder.
import { registerAction, ActionRefused } from '../fleet/dispatch.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import { derive, fleetOfOne, KIND_TO_TILE, TILES, AlarmError } from '../fleet/alarms.mjs';
import { createAlarmStore, createMemoryKv } from '../fleet/alarms-store.mjs';
import { BUILDER_ID_RX } from '../fleet/keys.mjs';
import * as health from '../collector/health.mjs';

export const PATH = '/api/alarms';
export const BUILDER_EVAL_MS = 5000;
/** Most alarms on one `alarms` frame (worst first); the store keeps them all. */
export const WIRE_MAX = 1000;

const isKv = (d) => !!d && typeof d.kvRead === 'function' && typeof d.kvWrite === 'function';

/** The ack-alarm dispatcher definition around an alarm store. Exported for tests. */
export function ackActionDef(getStore, onChange = () => {}) {
  return {
    tier: 'click',
    target: 'alarm-or-all',
    localOnly: true,
    allConfirm: false,
    runsAll: true,
    args: {
      tile: { type: 'string', enum: [...TILES] },
      builder: { type: 'string', re: BUILDER_ID_RX },
    },
    async run({ target, args, user }) {
      const store = getStore();
      if (!store) throw new ActionRefused(503, 'unavailable', 'alarms are not running');
      let acked;
      if (target === '*') {
        acked = store.ackMany({ tile: args.tile, builder: args.builder }, user, KIND_TO_TILE);
      } else {
        if (args.tile !== undefined || args.builder !== undefined) throw new ActionRefused(400, 'bad_args', 'tile and builder scope target * only');
        const r = store.ack(target, user);
        if (r instanceof AlarmError) throw new ActionRefused(r.status, r.code, r.message);
        acked = [r]; // idempotent: an already acked alarm is reported, not changed
      }
      if (acked.length) onChange();
      return { acked: acked.map((a) => a.id), n: acked.length };
    },
  };
}

export function createModule() {
  let store = null;
  let ctxRef = null;
  let lastEval = 0;
  let stopped = false;

  function builderOf(cfg) {
    const id = cfg?.fleet?.id;
    return { id: typeof id === 'string' && BUILDER_ID_RX.test(id) ? id : 'builder', code: cfg?.fleet?.code ?? null };
  }

  function wire() {
    return store ? store.live().slice(0, WIRE_MAX) : [];
  }

  function broadcast() {
    try { ctxRef?.ws?.send?.({ type: 'alarms', alarms: wire() }); } catch { /* never breaks a tick */ }
  }

  /** One evaluation over the given snapshot (exported through the module for tests). */
  function evaluate(snapshot, now = Date.now()) {
    if (!store || stopped) return null;
    const cfg = ctxRef?.config ?? {};
    let latest = null;
    try { latest = health.latest(); } catch { latest = null; }
    const view = fleetOfOne(snapshot, latest, now, { builder: builderOf(cfg) });
    const res = store.apply(derive(view, now, cfg.alarms));
    if (res.changed) broadcast();
    return res;
  }

  return {
    name: 'alarms',
    modes: ['builder'],
    register(ctx) {
      ctxRef = ctx;
      stopped = false;
      const cfg = ctx.config ?? {};
      store = createAlarmStore({
        db: isKv(ctx.db) ? ctx.db : createMemoryKv(),
        historyDays: cfg.alarms?.historyDays,
        log: ctx.log ?? null,
      });
      registerAction('ack-alarm', ackActionDef(() => store, broadcast));
      addCapability('alarms');
      ctx.route('GET', PATH, (req, res) => ctx.json(res, { builder: builderOf(cfg), alarms: wire() }));
    },
    start(ctx) {
      const st = ctx.state;
      if (!st || typeof st.onTick !== 'function' || typeof st.snapshot !== 'function') return;
      const every = Math.max(Number(ctx.config?.alarms?.evalMs) || 0, BUILDER_EVAL_MS);
      st.onTick((_tctx, now) => {
        const t = typeof now === 'number' ? now : Date.now();
        if (t - lastEval < every) return;
        lastEval = t;
        try {
          evaluate(st.snapshot(), t);
        } catch (err) {
          ctx.log?.error?.('alarms: evaluation failed', String(err?.message || err));
        }
      });
    },
    stop() {
      stopped = true;
    },
    // for tests
    evaluate,
    store: () => store,
  };
}

export default createModule();
