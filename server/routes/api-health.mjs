// Route module: the health a stranger's `curl` guesses (runs n5 T8).
//
//   GET /api/health -> {ok: true, version, mode}
//
// Read-only and small on purpose (research Q20): no paths, hostnames, names
// or error text. /healthz keeps the operator's fields (pid, memory, counts);
// /api/v1/health is the host sampler. Builder only (the hub loads hub/routes).
import { VERSION } from '../version.mjs';

export const PATH = '/api/health';

/** The response body (pure). */
export function body({ version = VERSION, mode } = {}) {
  return { ok: true, version, mode: mode === 'hub' ? 'hub' : 'builder' };
}

export default {
  name: 'api-health',
  modes: ['builder'],
  register(ctx) {
    ctx.route('GET', PATH, (req, res) => ctx.json(res, body({ version: ctx.version ?? VERSION, mode: ctx.mode })));
  },
};
