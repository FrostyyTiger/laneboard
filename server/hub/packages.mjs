// Hub packages merge (fleet §6 2.9, P11). Builders collect CI and git data
// for the repos they have checked out; the hub only merges.
//
//   merge(perBuilder, opts) -> {generatedAt, builders, repos, rows, edges,
//                               hotspots, order, stale}
//     perBuilder: [{builder:<id>, stale?:bool, data:{repos, lanes?, prs?}}]
//       repos: the sanitized per-builder `snap.repos` of the fleet store (a
//              Map name -> repo block), or the same as an object or an array
//              (the wire shapes); lanes: the builder's `snap.lanes`; prs: an
//              optional {laneId: pr} (a standalone builder passes its own).
//     Pure: no IO, no timers, time comes from opts.now.
//   createPackagesService({store, broadcast, now, cfg, debounceMs, timers})
//     re-merges on fleet-store changes and broadcasts {type:'packages', data}
//     at most once per 2 s burst, and only when the result changed.
//
// Merge rules:
//   - repos are keyed by `slug || name`; the repo-level fields (head,
//     packages, workflows, jobMap, ...) come from the freshest live report;
//   - runs are deduped by (slug, id, attempt), keeping the greatest
//     `updatedAt`; reports with equal `updatedAt` and different `conclusion`
//     mark the run `disputed:[builderIds]` with every report in `reports`;
//   - branches are keyed by (repo, branch), preferring the `local` report
//     (true head); a branch is joined to the fkey of the lane working on it,
//     on any builder;
//   - conflicts are deduped by the sorted sha pair (textual overrides
//     overlap); an `overlap` is added for lane pairs no single builder sees
//     together (conflicts.mjs overlapPairs);
//   - edges for the Map: [{a:fkey, b:fkey|'main:<repo>', kind, files:n, repo}].
//
// Builder data is UNTRUSTED (SECURITY-FIXES S2/S3). The fleet store already
// sanitized it (routing keys removed, strings clamped, prototypes safe); on
// top of that every hub-owned tag (`via`, `fkey`, `laneFkey`, `disputed`,
// `reports`, `live`, `builders`) a builder may have sent is dropped and
// recomputed here, and `via` always names the connection's builder id.
// Nothing here triggers an action: everything is display-only.
import { BUILDER_ID_RX, fkey as makeFkey } from '../fleet/keys.mjs';
import { isLaneId, isBranch } from './fleet-store.mjs';
import { overlapPairs, hotspots as hotspotsOf, pairKey } from '../packages/conflicts.mjs';
import { isSha } from '../packages/branches.mjs';
import { buildRows } from '../packages/rows.mjs';
import { mergeOrder, isCandidate } from '../packages/order.mjs';
import { staleBranches } from '../packages/stale.mjs';

export const DEBOUNCE_MS = 2000;
const MAX_FILES = 500;
const HUB_TAGS = ['via', 'fkey', 'laneFkey', 'disputed', 'reports', 'live', 'builders'];

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ts = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Shallow copy without the hub-owned tags. */
function strip(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!HUB_TAGS.includes(k)) out[k] = v;
  }
  return out;
}

const fileList = (v) => [...new Set(arr(v).filter((f) => typeof f === 'string' && f))].slice(0, MAX_FILES);

/** Repo blocks of one builder, from a Map, an object or an array. */
function repoBlocks(repos) {
  let entries;
  if (repos instanceof Map) entries = [...repos.entries()];
  else if (Array.isArray(repos)) entries = repos.map((r) => [null, r]);
  else if (isObj(repos)) entries = Object.entries(repos);
  else return [];
  const out = [];
  for (const [k, r] of entries) {
    if (!isObj(r)) continue;
    const name = typeof r.name === 'string' && r.name ? r.name : typeof k === 'string' ? k : null;
    const slug = typeof r.slug === 'string' && r.slug ? r.slug : null;
    if (!name && !slug) continue;
    out.push({ ...r, name: name ?? slug, slug });
  }
  return out;
}

function normalizeInput(perBuilder) {
  const seen = new Set();
  const out = [];
  for (const [i, e] of arr(perBuilder).entries()) {
    if (!isObj(e) || typeof e.builder !== 'string' || !BUILDER_ID_RX.test(e.builder) || seen.has(e.builder)) continue;
    seen.add(e.builder);
    const data = isObj(e.data) ? e.data : {};
    out.push({
      id: e.builder, idx: i, stale: e.stale === true,
      repos: repoBlocks(data.repos),
      lanes: arr(data.lanes).filter((l) => isObj(l) && isLaneId(l.id)),
      prs: isObj(data.prs) ? data.prs : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- lanes

function laneIndex(builders) {
  const lanesByFkey = {};
  const prsByFkey = {};
  const byBranch = new Map(); // branch -> [{fkey, builder, lane}]
  for (const b of builders) {
    for (const lane of b.lanes) {
      const fk = makeFkey(b.id, lane.id);
      if (Object.hasOwn(lanesByFkey, fk)) continue;
      lanesByFkey[fk] = { ...lane, builder: b.id, fkey: fk };
      const pr = (b.prs && Object.hasOwn(b.prs, lane.id) ? b.prs[lane.id] : null) ?? lane.pr ?? null;
      if (isObj(pr)) prsByFkey[fk] = pr;
      if (isBranch(lane.branch) && !lane.isMain) {
        if (!byBranch.has(lane.branch)) byBranch.set(lane.branch, []);
        byBranch.get(lane.branch).push({ fkey: fk, builder: b.id, lane });
      }
    }
  }
  return { lanesByFkey, prsByFkey, byBranch };
}

// ---------------------------------------------------------------- runs

function runKey(slug, run) {
  const id = run.id;
  if (!((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id))) return null;
  const attempt = Number.isSafeInteger(run.attempt) && run.attempt > 0 ? run.attempt : 1;
  return `${slug}\u0000${id}\u0000${attempt}`;
}

function mergeRuns(slug, reports) {
  const best = new Map(); // key -> {u, list:[{via, run}]}
  for (const r of reports) {
    for (const run of arr(r.repo.ci?.runs)) {
      if (!isObj(run)) continue;
      const key = runKey(slug, run);
      if (!key) continue;
      const u = ts(run.updatedAt);
      const cur = best.get(key);
      const item = { via: r.via, run };
      if (!cur || u > cur.u) best.set(key, { u, list: [item] });
      else if (u === cur.u && !cur.list.some((x) => x.via === r.via)) cur.list.push(item);
    }
  }
  const out = [];
  for (const { list } of best.values()) {
    const first = list[0];
    const run = { ...strip(first.run), via: first.via };
    const conclusions = new Set(list.map((x) => String(x.run.conclusion ?? '')));
    if (conclusions.size > 1) {
      run.disputed = [...new Set(list.map((x) => x.via))].sort();
      run.reports = list.map((x) => ({ via: x.via, status: x.run.status ?? null, conclusion: x.run.conclusion ?? null }))
        .sort((a, b) => cmpStr(a.via, b.via));
    }
    out.push(run);
  }
  out.sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || (b.attempt || 0) - (a.attempt || 0));
  return out;
}

// ---------------------------------------------------------------- branches

/** True when this report wins over `cur` for the same branch. */
function betterBranch(next, cur) {
  const nl = next.br.local === true, cl = cur.br.local === true;
  if (nl !== cl) return nl;
  if (next.stale !== cur.stale) return !next.stale;
  return ts(next.br.lastCommitAt) > ts(cur.br.lastCommitAt);
}

function joinLane(repo, branch, reports, lanes) {
  // 1. a builder of this repo has the branch as a local worktree.
  for (const r of reports) {
    for (const br of arr(r.repo.branches)) {
      if (isObj(br) && br.branch === branch && br.local === true && isLaneId(br.laneId)) return makeFkey(r.via, br.laneId);
    }
  }
  // 2. any lane on any builder working on that branch.
  const cands = (lanes.byBranch.get(branch) ?? []).filter(({ lane }) =>
    typeof lane.repo !== 'string' || lane.repo === repo.name || lane.repo === repo.slug);
  if (!cands.length) return null;
  const reporting = new Set(reports.map((r) => r.via));
  cands.sort((x, y) => Number(reporting.has(y.builder)) - Number(reporting.has(x.builder)) || cmpStr(x.fkey, y.fkey));
  return cands[0].fkey;
}

function mergeBranches(repo, reports, lanes) {
  const chosen = new Map();
  for (const r of reports) {
    for (const br of arr(r.repo.branches)) {
      if (!isObj(br) || !isBranch(br.branch) || !isSha(br.sha)) continue;
      const next = { br, via: r.via, stale: r.stale };
      const cur = chosen.get(br.branch);
      if (!cur || betterBranch(next, cur)) chosen.set(br.branch, next);
    }
  }
  const out = [];
  for (const { br, via } of chosen.values()) {
    const b = { ...strip(br), via, files: fileList(br.files) };
    if (b.laneId !== undefined && b.laneId !== null && !isLaneId(b.laneId)) b.laneId = null;
    b.fkey = b.local === true && isLaneId(b.laneId) ? makeFkey(via, b.laneId) : joinLane(repo, b.branch, reports, lanes);
    out.push(b);
  }
  out.sort((a, b) => cmpStr(a.branch, b.branch));
  return out;
}

// ---------------------------------------------------------------- conflicts

function mergeConflicts(repo, reports, branches) {
  const bySha = new Map();
  const byName = new Map();
  for (const b of branches) {
    byName.set(b.branch, b);
    if (b.fkey && !bySha.has(b.sha)) bySha.set(b.sha, b.fkey);
  }
  // Shas of every builder's own local lanes, for a report with an older sha.
  for (const r of reports) {
    for (const br of arr(r.repo.branches)) {
      if (isObj(br) && br.local === true && isSha(br.sha) && isLaneId(br.laneId) && !bySha.has(br.sha)) {
        bySha.set(br.sha, makeFkey(r.via, br.laneId));
      }
    }
  }
  const end = (e) => {
    const name = isBranch(e.branch) ? e.branch : null;
    const fk = bySha.get(e.sha) ?? (name ? byName.get(name)?.fkey : null) ?? null;
    return { branch: name, sha: e.sha, ...(fk ? { fkey: fk } : {}) };
  };

  const map = new Map();
  for (const r of reports) {
    for (const c of arr(r.repo.conflicts)) {
      if (!isObj(c) || !isObj(c.a) || !isSha(c.a.sha) || !isObj(c.b)) continue;
      const vsMain = c.b.main === true;
      if (!vsMain && !isSha(c.b.sha)) continue;
      if (!vsMain && c.a.sha === c.b.sha) continue;
      const kind = c.kind === 'overlap' ? 'overlap' : 'textual';
      const key = vsMain ? `${c.a.sha}:main` : pairKey(c.a.sha, c.b.sha);
      const cur = map.get(key);
      if (cur && !(cur.kind === 'overlap' && kind === 'textual')) continue;
      map.set(key, {
        a: end(c.a), b: vsMain ? { main: true } : end(c.b), kind,
        files: fileList(c.files), at: c.at ?? null, via: r.via,
      });
    }
  }

  // Overlap fallback: lane pairs no single builder saw together.
  const shaSets = reports.map((r) => new Set(arr(r.repo.branches).filter(isObj).map((br) => br.sha)));
  const lanes = branches.filter((b) => b.fkey);
  const skip = new Set(map.keys());
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const A = lanes[i].sha, B = lanes[j].sha;
      if (shaSets.some((s) => s.has(A) && s.has(B))) skip.add(pairKey(A, B));
    }
  }
  const byFkey = new Map(lanes.map((b) => [b.fkey, b]));
  for (const o of overlapPairs(lanes, { skip, now: null })) {
    const A = byFkey.get(o.a.fkey), B = byFkey.get(o.b.fkey);
    if (!A || !B || A.fkey === B.fkey) continue;
    const at = Math.max(ts(A.lastCommitAt), ts(B.lastCommitAt)) || null;
    map.set(pairKey(A.sha, B.sha), { a: o.a, b: o.b, kind: 'overlap', files: fileList(o.files), at, via: 'hub' });
  }

  return [...map.values()].sort((x, y) =>
    cmpStr(x.kind, y.kind) || cmpStr(x.a.fkey ?? x.a.sha, y.a.fkey ?? y.a.sha)
    || cmpStr(x.b.main ? '' : (x.b.fkey ?? x.b.sha), y.b.main ? '' : (y.b.fkey ?? y.b.sha)));
}

function edgesOf(repoName, conflicts) {
  const map = new Map();
  for (const c of conflicts) {
    const a = c.a.fkey;
    const b = c.b.main ? `main:${repoName}` : c.b.fkey;
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().join('|');
    const n = c.files.length;
    const cur = map.get(key);
    if (cur && (cur.kind === 'textual' || c.kind === 'overlap')) {
      if (cur.kind === c.kind) cur.files = Math.max(cur.files, n);
      continue;
    }
    map.set(key, { a, b, kind: c.kind, files: n, repo: repoName });
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- repos

function pickPrimary(reports) {
  return [...reports].sort((x, y) =>
    Number(x.stale) - Number(y.stale) || ts(y.repo.head?.at) - ts(x.repo.head?.at) || x.idx - y.idx)[0];
}

function pickCi(reports) {
  const withCi = reports.filter((r) => isObj(r.repo.ci));
  if (!withCi.length) return null;
  return withCi.sort((x, y) =>
    Number(y.repo.ci.auth === true) - Number(x.repo.ci.auth === true)
    || Number(x.stale) - Number(y.stale) || ts(y.repo.ci.at) - ts(x.repo.ci.at) || x.idx - y.idx)[0];
}

function mergeRepo(key, reports, lanes, opts) {
  const primary = pickPrimary(reports);
  const repo = { ...strip(primary.repo), via: primary.via, builders: [...new Set(reports.map((r) => r.via))] };
  const ciFrom = pickCi(reports);
  if (ciFrom) {
    const { runs: _runs, ...ci } = strip(ciFrom.repo.ci);
    repo.ci = { ...ci, via: ciFrom.via, runs: mergeRuns(key, reports) };
  } else {
    repo.ci = null;
  }
  repo.branches = mergeBranches(repo, reports, lanes);
  repo.conflicts = mergeConflicts(repo, reports, repo.branches);
  const deps = [];
  const seenDep = new Set();
  for (const r of reports) {
    for (const d of arr(r.repo.deps)) {
      if (!Array.isArray(d) || !isSha(d[0]) || !isSha(d[1]) || seenDep.has(`${d[0]}>${d[1]}`)) continue;
      seenDep.add(`${d[0]}>${d[1]}`);
      deps.push([d[0], d[1]]);
    }
  }
  repo.deps = deps;

  const name = repo.name;
  const edges = edgesOf(name, repo.conflicts);
  const hotspots = hotspotsOf(repo.branches, repo.conflicts, { keyOf: (b) => b.fkey || null })
    .map((h) => ({ repo: name, ...h }));

  const laneOf = (b) => (b.fkey ? lanes.lanesByFkey[b.fkey] ?? null : null);
  const stale = staleBranches(repo.branches, repo.head?.sha ?? null, {
    staleDays: opts.staleDays, staleBehind: opts.staleBehind, now: opts.now,
    isLive: (b) => {
      const l = laneOf(b);
      return Boolean(l && Array.isArray(l.sessions) && l.sessions.length && l.idle !== true);
    },
    hasRecord: (b) => {
      const l = laneOf(b);
      return Boolean(l && (l.record === true || l.launched === true));
    },
  }).map((s) => ({ repo: name, ...s }));

  const candidates = [];
  const seen = new Set();
  for (const b of repo.branches) {
    const lane = laneOf(b);
    if (!lane || seen.has(b.fkey)) continue;
    const pr = lanes.prsByFkey[b.fkey] ?? null;
    if (!isCandidate(lane, pr)) continue;
    seen.add(b.fkey);
    candidates.push({ fkey: b.fkey, sha: b.sha, size: b.size, prCreatedAt: pr?.createdAt ?? null });
  }
  const { order, warnings } = mergeOrder(candidates, edges, deps);
  repo.orderWarnings = warnings;
  repo.stale = stale;
  repo.hotspots = hotspots;
  return { repo, edges, hotspots, stale, order: order.map((o) => ({ repo: name, ...o })) };
}

/**
 * Merge every builder's packages data. See the file header for the shapes.
 * `opts`: `now` (ms), `staleDays`, `staleBehind` (packages config).
 */
export function merge(perBuilder, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const o = {
    now,
    staleDays: Number.isFinite(opts.staleDays) ? opts.staleDays : undefined,
    staleBehind: Number.isFinite(opts.staleBehind) ? opts.staleBehind : undefined,
  };
  const builders = normalizeInput(perBuilder);
  // Live builders first, so ties go to fresh data.
  builders.sort((a, b) => Number(a.stale) - Number(b.stale) || a.idx - b.idx);
  const lanes = laneIndex(builders);

  const groups = new Map();
  for (const b of builders) {
    for (const repo of b.repos) {
      const key = repo.slug || repo.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ via: b.id, stale: b.stale, idx: b.idx, repo });
    }
  }

  const out = { generatedAt: now, builders: builders.map((b) => b.id), repos: [], rows: [], edges: [], hotspots: [], order: [], stale: [] };
  for (const key of [...groups.keys()].sort()) {
    const m = mergeRepo(key, groups.get(key), lanes, o);
    out.repos.push(m.repo);
    out.edges.push(...m.edges);
    out.hotspots.push(...m.hotspots);
    out.order.push(...m.order);
    out.stale.push(...m.stale);
  }
  out.rows = buildRows(out.repos, lanes.lanesByFkey, lanes.prsByFkey);
  return out;
}

/** merge() input from a fleet-store view(): the sanitized per-builder data. */
export function inputFromView(view) {
  return arr(view?.builders)
    .filter((b) => b && b.snap)
    .map((b) => ({ builder: b.id, stale: b.stale === true, data: { repos: b.snap.repos, lanes: b.snap.lanes } }));
}

const RELEVANT = new Set(['snapshot', 'repos', 'conn']);

/**
 * The hub service: merge on store changes, broadcast `packages` at most once
 * per `debounceMs` burst (and only when the data changed), serve current().
 */
export function createPackagesService({
  store, broadcast = () => {}, now = Date.now, cfg = {}, debounceMs = DEBOUNCE_MS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  if (!store || typeof store.view !== 'function') throw new TypeError('packages service: store required');
  const clock = typeof now === 'function' ? now : Date.now;
  let cache = null;
  let dirty = true;
  let lastSig = null;
  let timer = null;
  let unsubscribe = null;

  function compute() {
    const t = clock();
    cache = merge(inputFromView(store.view(t)), { now: t, staleDays: cfg?.staleDays, staleBehind: cfg?.staleBehind });
    dirty = false;
    return cache;
  }

  function current() {
    return dirty || !cache ? compute() : cache;
  }

  function flush() {
    timer = null;
    const data = compute();
    const { generatedAt: _g, ...rest } = data;
    const sig = JSON.stringify(rest);
    if (sig === lastSig) return false;
    lastSig = sig;
    try { broadcast({ type: 'packages', data }); } catch { /* a client-ws error never stops the service */ }
    return true;
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = timers.setTimeout(flush, debounceMs);
    timer?.unref?.();
  }

  function onEvent(ev) {
    if (!ev) return;
    if (RELEVANT.has(ev.kind) || (ev.kind === 'delta' && ev.lanes)) schedule();
  }

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = store.subscribe(onEvent);
      schedule();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
    current,
    flush,
  };
}
