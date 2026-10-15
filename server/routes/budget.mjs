// Route module: budget caps (fleet plan §8 2.5). REVIEW-REQUIRED (SR17). Builder only.
//
// - registers the `set-budget` action (tier ask, target lane or '*', remote-only: refused for `local`, so an
//   agent on this builder cannot raise its own cap through the local API; '*' needs confirm = fleet.id);
// - publishes snapshot key `budget` ([{scope, key, usd, limit, pct, level}], from which §7 O8 derives the
//   budget-warn / budget-exceeded alarms);
// - runs budget.tick every 30 s (caps, ceilings, quota guard);
// - adds `budget` to hello.capabilities.
// No HTTP route of its own: set-budget is reached through POST /api/v1/actions.
import { registerAction, has } from '../fleet/dispatch.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import * as budget from '../control/budget.mjs';
import * as store from '../lanes/store.mjs';
import { WINDOWS } from '../util.mjs';

let timer = null;

/** The set-budget action definition (exported for tests). */
export function setBudgetDef() {
  return {
    tier: 'ask',
    target: 'lane-or-all',
    remoteOnly: true,
    runsAll: true,
    args: {
      usd: {
        type: ['number', 'null'], required: true, max: budget.MAX_USD,
        check: (v) => (v === null || v > 0 ? null : 'must be above 0, or null'),
      },
      window: { type: 'string', enum: WINDOWS },
      confirm: { type: 'string', max: 128 },
    },
    async run({ target, args }) {
      return budget.setBudget({ target, usd: args.usd, window: args.window });
    },
  };
}

/** Register set-budget once (a second module load in tests is a no-op). */
export function registerBudgetAction() {
  if (!has('set-budget')) registerAction('set-budget', setBudgetDef());
}

export default {
  name: 'budget',
  modes: ['builder'],
  register(ctx) {
    // config.stateDir is checked on every tick (budget.stateDirOf), never defaulted here.
    budget.init({
      config: ctx.config,
      db: ctx.db,
      state: ctx.state,
      laneRecords: () => store.readAll(),
      log: ctx.log,
    });
    registerBudgetAction();
    ctx.state.addSnapshotKey('budget', budget.snapshotValue);
    addCapability('budget');
  },
  start(ctx) {
    const run = () => budget.tickOnce().catch((err) => ctx.log?.warn?.(`budget tick failed: ${String(err?.message ?? err).slice(0, 300)}`));
    run();
    timer = setInterval(run, budget.TICK_MS);
    timer.unref?.();
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
