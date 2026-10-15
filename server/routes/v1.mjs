// Route module: the /api/v1 read endpoints (fleet plan §1 2.8). Builder only,
// so a hub never registers them (404 there). Handlers and the hello registry
// live in server/fleet/api-v1.mjs; §2 A8 extends both.
import { ROUTES } from '../fleet/api-v1.mjs';

export default {
  name: 'v1',
  modes: ['builder'],
  register(ctx) {
    for (const r of ROUTES) ctx.route(r.method, r.path, (req, res) => r.handler(req, res, ctx));
  },
};
