// Route module: the control actions pause, resume, approve, deny, release (fleet plan §8 2.3).
// REVIEW-REQUIRED (SR16). Builder only. The handlers live in server/control/handlers.mjs and are registered
// with §2's dispatcher singleton; they are reached through POST /api/v1/actions (A8), never a route of their
// own. Adds `pause` to hello.capabilities.
import { registerControlActions } from '../control/handlers.mjs';
import { addCapability } from '../fleet/api-v1.mjs';

export default {
  name: 'control',
  modes: ['builder'],
  register(ctx) {
    registerControlActions({ actions: ctx.actions, state: ctx.state, config: ctx.config });
    addCapability('pause');
  },
};
