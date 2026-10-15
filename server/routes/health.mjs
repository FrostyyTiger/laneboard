// Route module: builder health (fleet plan §7.3.3, O6).
//
//   GET /api/v1/health            -> {latest}
//   GET /api/v1/health?history=1  -> {latest, history}   (history: the thinned ring)
//
// A read (capability `health` in hello). Starts the 10 s sampler in
// server/collector/health.mjs and sends `{type:'health', health}` on the
// builder stream after every sample (latest sample only). Builder only.
import * as health from '../collector/health.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import { config as globalConfig } from '../config.mjs';

export const PATH = '/api/v1/health';

/** The response body for a request URL (pure; `src` swaps the sampler for tests). */
export function body(url, src = health) {
  const q = new URL(url ?? '/', 'http://local.invalid').searchParams;
  const out = { latest: src.latest() };
  const h = q.get('history');
  if (h === '1' || h === 'true') {
    const since = Number(q.get('since'));
    out.history = src.history({ since: Number.isFinite(since) && since > 0 ? since : null });
  }
  return out;
}

export default {
  name: 'health',
  modes: ['builder'],
  register(ctx) {
    addCapability('health');
    ctx.route('GET', PATH, (req, res) => ctx.json(res, body(req.url)));
  },
  start(ctx) {
    const cfg = ctx.config ?? globalConfig;
    health.start({
      cfg: cfg.health,
      worktreeDir: cfg.codeDir,
      slots: ctx.slots?.snapshot ? () => ctx.slots.snapshot().slots : null,
      onSample: (s) => ctx.ws?.send?.({ type: 'health', health: s }),
    });
  },
  stop() {
    health.stop();
  },
};
