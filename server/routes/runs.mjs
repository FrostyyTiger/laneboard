// Route module: runs (docs/plans/runs/README.md §3 A1; protocol in docs/runs.md).
//
// Starts the run-file collector (server/collector/runs.mjs) and provides its
// store as the `runs` service. The HTTP routes (`/api/runs…`, T5) are added
// here. Builder only: runs on a hub need server/hub/* (see PROGRESS "For the
// owner").
import * as collector from '../collector/runs.mjs';
import { knownWorktrees } from '../collector/lanes.mjs';
import { config as globalConfig } from '../config.mjs';

export default {
  name: 'runs',
  modes: ['builder'],
  register(ctx) {
    // The store exists once start() ran; handlers call ctx.use('runs').store().
    ctx.provide('runs', { store: () => collector.store() });
  },
  start(ctx) {
    const cfg = ctx.config ?? globalConfig;
    collector.start({
      cfg: cfg.runs,
      stateDir: cfg.stateDir,
      laneRoots: () => knownWorktrees().map((w) => w.root),
    });
  },
  stop() {
    collector.stop();
  },
};
