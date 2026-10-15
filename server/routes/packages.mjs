// Feature module: Packages on the builder (fleet §6, P9).
//
//   - starts the packages collector (server/collector/packages.mjs);
//   - snapshot key `repos`: `{<repo name>: block}` (§2.9 block per repo; the
//     object form is what the hub's fleet store ingests and what `repos`
//     stream messages update one key of);
//   - stream message `{type:'repos', repo, data}` through ws.send when a repo's
//     block changes (the §2 A7 tap adds builder/seq);
//   - `GET /api/packages`: the standalone view, the same pure
//     hub/packages.mjs#merge over this one builder's data, and a
//     `{type:'packages', data}` message on change, debounced 2 s;
//   - hello capabilities `ci:jobs` (a repo collects CI through gh) and
//     `conflicts:textual` (git >= 2.38, merge-tree --write-tree);
//   - `packagesFor(repo, paths)` for §10 R5: the package names of `repo` whose
//     globs match any of `paths` ([] when the repo is unknown or not yet polled).
//
// Display-only: no action is registered here, nothing writes to a forge.
import { addCapability } from '../fleet/api-v1.mjs';
import { createCollector } from '../collector/packages.mjs';
import { resolveRepos } from '../packages/repos.mjs';
import { packagesFor as packagesForFiles } from '../packages/branches.mjs';
import { textualAvailable } from '../packages/conflicts.mjs';
import { merge, DEBOUNCE_MS } from '../hub/packages.mjs';
import { BUILDER_ID_RX } from '../fleet/keys.mjs';
import * as lanes from '../collector/lanes.mjs';

let collector = null;
let debounce = null;
let lastSig = null;
let ctxRef = null;

/** Package names of `repo` (name or slug) touched by `paths`. Never throws. */
export function packagesFor(repo, paths) {
  if (!collector || !Array.isArray(paths) || !paths.length) return [];
  const block = collector.repo(repo);
  if (!block) return [];
  try {
    return packagesForFiles(paths.filter((p) => typeof p === 'string'), block.packages);
  } catch {
    return [];
  }
}

/** The collector (tests, and modules that want the raw blocks). */
export function getCollector() {
  return collector;
}

function selfId(config) {
  const id = config?.fleet?.id;
  return typeof id === 'string' && BUILDER_ID_RX.test(id) ? id : 'local';
}

/** Live lane ids: lanes with at least one session (cached 5 s: asked per stale candidate). */
let liveCache = { at: 0, ids: new Set() };
function liveLaneIds(state) {
  if (Date.now() - liveCache.at < 5000) return liveCache.ids;
  let ids = new Set();
  try {
    const snap = state?.snapshot?.();
    ids = new Set((snap?.lanes ?? []).filter((l) => !l.idle && l.sessions?.length).map((l) => l.id));
  } catch { /* no state yet */ }
  liveCache = { at: Date.now(), ids };
  return ids;
}

/** The standalone packages object: merge() over this builder's own data. */
export function standalone(ctx = ctxRef) {
  const config = ctx?.config ?? {};
  let laneList = [];
  try { laneList = ctx?.state?.snapshot?.().lanes ?? []; } catch { laneList = []; }
  let prs = null;
  try { prs = ctx?.prs?.snapshot?.().prs ?? null; } catch { prs = null; }
  return merge([{
    builder: selfId(config),
    data: { repos: collector ? collector.reposByName() : {}, lanes: laneList, prs },
  }], { staleDays: config.packages?.staleDays, staleBehind: config.packages?.staleBehind });
}

function schedulePackages(ctx) {
  if (debounce) return;
  debounce = setTimeout(() => {
    debounce = null;
    try {
      if (typeof ctx.ws?.clientCount === 'function' && !ctx.ws.clientCount()) return;
      const data = standalone(ctx);
      const { generatedAt: _g, ...rest } = data;
      const sig = JSON.stringify(rest);
      if (sig === lastSig) return;
      lastSig = sig;
      ctx.ws?.send?.({ type: 'packages', data });
    } catch (err) {
      ctx.log?.warn?.(`packages broadcast failed: ${err?.message || err}`);
    }
  }, DEBOUNCE_MS);
  debounce.unref?.();
}

export default {
  name: 'packages',
  modes: ['builder'],
  register(ctx) {
    ctxRef = ctx;
    lastSig = null;
    const config = ctx.config ?? {};
    collector = createCollector({
      config,
      worktrees: () => lanes.knownWorktrees(),
      isLive: (b) => Boolean(b.laneId) && liveLaneIds(ctx.state).has(b.laneId),
      onChange: (repo, data) => {
        try { ctx.ws?.send?.({ type: 'repos', repo, data }); } catch { /* a ws error never stops the collector */ }
        schedulePackages(ctx);
      },
    });
    ctx.state?.addSnapshotKey?.('repos', () => collector.reposByName());
    ctx.route('GET', '/api/packages', (req, res) => ctx.json(res, standalone(ctx)));
  },
  async start(ctx) {
    const config = ctx.config ?? {};
    try {
      if (await textualAvailable()) addCapability('conflicts:textual');
    } catch { /* old or missing git: overlap only */ }
    try {
      const repos = await resolveRepos(config);
      if (repos.some((r) => r.ci && r.ci.provider === 'gh' && r.ci.collect !== false)) addCapability('ci:jobs');
    } catch { /* no repos */ }
    collector.start();
  },
  stop() {
    collector?.stop();
    if (debounce) clearTimeout(debounce);
    debounce = null;
  },
};
