// Flag module: the review fields on lanes (fleet plan §10 2.4, R5).
//
// A lane decorator adds, on every snapshot:
//   reviewReady  {ready, reasons, since} | null   (server/review/ready.mjs)
//   reviewSentAt ms | null                        (kv review.sentAt)
//   diffStat     {files, add, del} | null         (server/collector/review.mjs)
//   packages     [name]                           (§6 packagesFor; [] when absent)
//   costUsd      number                           (sum of the lane's live sessions' cost.usd)
//
// The collector runs from this module's start (first pass at 50 s, then 60 s).
// Nothing here touches state.mjs, lanes.mjs or the boot file: the PR records
// come from ctx.prs, the dirty counts from ctx.retirer's cached readiness.
import * as review from '../collector/review.mjs';
import { log } from '../log.mjs';

/** P9's packagesFor(repo, paths), when server/routes/packages.mjs exports it. */
async function loadPackagesFor() {
  try {
    const mod = await import('../routes/packages.mjs');
    return typeof mod.packagesFor === 'function' ? mod.packagesFor : null;
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') log.warn('review: packagesFor unavailable', String(err?.message || err));
    return null;
  }
}

export function wire(ctx = {}) {
  const d = {};
  if (typeof ctx.prs?.get === 'function') d.prFor = (id) => ctx.prs.get(id);
  if (typeof ctx.retirer?.cached === 'function') {
    d.dirtyFor = (id) => {
      const files = ctx.retirer.cached()?.[id]?.dirtyFiles;
      return Array.isArray(files) ? files.length : 0;
    };
  }
  review.init(d);
  return d;
}

export default {
  name: 'flag-review',
  modes: ['builder'],
  register(ctx) {
    wire(ctx);
    ctx.state.addDecorator('review', { lane: review.decorate });
  },
  async start(ctx) {
    const pf = await loadPackagesFor();
    if (pf) {
      const d = wire(ctx);
      review.init({ ...d, packagesFor: (repo, paths) => pf(repo, paths) });
    }
    review.start();
  },
  stop() {
    review.stop();
  },
};
