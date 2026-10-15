// Route module: the builder's Credit data as a v1 read (fleet plan §7.3.8, O11).
//
//   GET /api/v1/credit  -> credit.build() + {builder}   (capability `credit`)
//
// A read tier route: the request classification in http.mjs (A8) admits
// `local`, `direct` and signed `hub` callers, as for every /api/v1 read. The
// hub's /api/fleet/credit fans out to this through the read proxy (H12).
// Builder only. The result is memoized for 15 s like the legacy
// `memo('credit')` in boot/builder.mjs: building it reads a week of samples.
import * as credit from '../credit.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import { config as globalConfig } from '../config.mjs';

export const PATH = '/api/v1/credit';
export const CACHE_MS = 15_000;

/** The builder id the result is tagged with: `fleet.id`, else null. */
export function builderId(cfg = globalConfig) {
  const id = cfg?.fleet?.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * A memoized body source. `build` and `now` swap the real ones for tests.
 * Returns `() => body`.
 */
export function createSource({ build = credit.build, now = Date.now, cfg = globalConfig, cacheMs = CACHE_MS } = {}) {
  let cached = null;
  let at = 0;
  return function body() {
    const t = now();
    if (cached && t - at < cacheMs) return cached;
    cached = build({ now: t, builder: builderId(cfg) });
    at = t;
    return cached;
  };
}

export function createModule(opts = {}) {
  let source = null;
  return {
    name: 'v1-credit',
    modes: ['builder'],
    register(ctx) {
      addCapability('credit');
      source = createSource({ cfg: ctx.config ?? globalConfig, ...opts });
      ctx.route('GET', PATH, (req, res) => ctx.json(res, source()));
    },
  };
}

export default createModule();
