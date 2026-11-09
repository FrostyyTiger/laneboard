// Route module: what this server has switched on, for the page's first paint.
//
//   GET /api/features   {lanes: bool, peerCheck}   (docs/lanes-flag.md, docs/decisions.md)
import { lanesOn } from '../config/lanes.mjs';
import { peerCheck } from '../engine/peer-check.mjs';

export default {
  name: 'features',
  modes: ['builder', 'hub'],
  register(ctx) {
    ctx.route('GET', '/api/features', (req, res) => ctx.json(res, { lanes: lanesOn(ctx.config), peerCheck: peerCheck(ctx.config) }));
  },
};
