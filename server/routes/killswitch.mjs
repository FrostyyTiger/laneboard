// Route module: the builder kill switch (fleet plan §8 2.6). REVIEW-REQUIRED (SR19). Builder only.
//
// Registers server/control/killswitch.mjs killAll as the '*' handler of the built-in `kill` action
// (dispatch.registerAllHandler). The action itself (tier confirm, remote-only for '*', strict args) is A6's
// registration in server/fleet/builtin-actions.mjs; it is reached through POST /api/v1/actions (A8), never a
// route of its own. Pending grace timers are dropped on shutdown: nothing is killed, the pause stays.
import { registerKillSwitch, stopAll } from '../control/killswitch.mjs';

export default {
  name: 'killswitch',
  modes: ['builder'],
  register(ctx) {
    registerKillSwitch({ actions: ctx.actions, state: ctx.state, config: ctx.config, db: ctx.db, log: ctx.log });
  },
  stop() {
    stopAll();
  },
};
