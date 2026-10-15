// Merge-order hint (fleet §6 2.8, P7). A hint only: nothing here merges.
//
//   isCandidate(lane, pr)            lanes with reviewReady, a `done` marker, or
//                                    an OPEN non-draft PR whose verdict is green
//                                    or pending.
//   dependencies(dir, items, {env})  `[[shaA, shaB]]` where B contains A
//                                    (`merge-base --is-ancestor`), per pair,
//                                    cached by sha pair. Runs on the builder.
//   mergeOrder(candidates, edges, deps)   pure:
//     1. dependencies first: if B contains A, A comes before B;
//     2. then greedy: no textual conflict with main, then the fewest textual
//        edges to the remaining candidates, then the smallest diff
//        (size.ins+del), then the oldest PR, then fkey.
//     -> {order:[{fkey, rank, reasons[], after:[fkey]}], warnings:[{first,
//        then, files, text}]}, one warning per textual pair ("merging X first
//        makes Y conflict on 2 files").
import { runGit, withEnv } from './gitenv.mjs';
import { Lru, isSha } from './branches.mjs';

const ANC_CACHE_MAX = 5000;
const ancCache = new Lru(ANC_CACHE_MAX);
export function _clearCache() { ancCache.clear(); }
export function cacheStats() { return { size: ancCache.size, hits: ancCache.hits, misses: ancCache.misses }; }

const GOOD_VERDICTS = new Set(['green', 'pending']);

function hasDoneMarker(lane) {
  if (lane.done === true) return true;
  const kinds = [];
  if (lane.marker && typeof lane.marker === 'object') kinds.push(lane.marker.kind);
  if (Array.isArray(lane.markers)) for (const m of lane.markers) kinds.push(m && typeof m === 'object' ? m.kind : m);
  return kinds.includes('done');
}

/** Whether a lane (and its PR, if any) belongs in the merge-order list. */
export function isCandidate(lane, pr = lane?.pr) {
  if (!lane || typeof lane !== 'object') return false;
  if (lane.reviewReady) return true;
  if (hasDoneMarker(lane)) return true;
  if (pr && typeof pr === 'object' && pr.state === 'OPEN' && !pr.isDraft && !pr.draft && GOOD_VERDICTS.has(pr.verdict)) return true;
  return false;
}

/**
 * Ancestry between candidate commits: `[[shaA, shaB]]` for every ordered pair
 * where A is an ancestor of B (B contains A, so A merges first). `items` are
 * shas or `{sha}`. Sequential git, one `merge-base --is-ancestor` per pair and
 * direction, cached by the ordered sha pair.
 */
export async function dependencies(dir, items, { env } = {}) {
  const shas = [...new Set((Array.isArray(items) ? items : []).map((x) => (typeof x === 'string' ? x : x?.sha)).filter(isSha))];
  const out = [];
  for (const a of shas) {
    for (const b of shas) {
      if (a === b) continue;
      const key = `${a}>${b}`;
      let anc = ancCache.get(key);
      if (anc === undefined) {
        const r = await runGit(['-C', dir, 'merge-base', '--is-ancestor', a, b], { timeout: 8000, env: withEnv(env) });
        if (!r.ok && r.code !== 1) continue; // error: unknown, not cached
        anc = r.ok;
        ancCache.set(key, anc);
      }
      if (anc) out.push([a, b]);
    }
  }
  return out;
}

const isMainEnd = (x) => x === 'main' || (typeof x === 'string' && x.startsWith('main:')) || (x && typeof x === 'object' && x.main === true);
const fileCount = (f) => (Array.isArray(f) ? f.length : Number.isFinite(f) ? f : 0);
const sizeOf = (c) => (Number(c.size?.ins) || 0) + (Number(c.size?.del) || 0);
function prAt(c) {
  const v = c.prCreatedAt ?? c.pr?.createdAt ?? null;
  if (v == null) return Infinity;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : Infinity;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Pure merge-order hint.
 *
 * `candidates`: `[{fkey, sha?, size?:{ins, del}, prCreatedAt?|pr?:{createdAt}}]`.
 * `edges`: `[{a, b, kind:'textual'|'overlap', files:n|[...]}]` with fkeys, and
 * `'main'`, `'main:<repo>'` or `{main:true}` for main. Only textual edges count.
 * `deps`: `[[A, B]]` (A before B) as shas or fkeys.
 */
export function mergeOrder(candidates, edges = [], deps = []) {
  const cands = [];
  const byKey = new Map();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || typeof c.fkey !== 'string' || !c.fkey || byKey.has(c.fkey)) continue;
    byKey.set(c.fkey, c);
    cands.push(c);
  }
  const bySha = new Map();
  for (const c of cands) if (isSha(c.sha) && !bySha.has(c.sha)) bySha.set(c.sha, c.fkey);
  const keyOf = (x) => (byKey.has(x) ? x : bySha.get(x) ?? null);

  // Dependencies: before.get(B) = set of A that must come first.
  const before = new Map(cands.map((c) => [c.fkey, new Set()]));
  for (const d of Array.isArray(deps) ? deps : []) {
    if (!Array.isArray(d) || d.length < 2) continue;
    const a = keyOf(d[0]), b = keyOf(d[1]);
    if (a && b && a !== b) before.get(b).add(a);
  }

  // Textual edges: vs main and between candidates.
  const mainConflict = new Map(); // fkey -> files
  const pair = new Map();         // fkey -> Map(fkey -> files)
  const addPair = (a, b, n) => {
    if (!pair.has(a)) pair.set(a, new Map());
    pair.get(a).set(b, Math.max(pair.get(a).get(b) ?? 0, n));
  };
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || e.kind !== 'textual') continue;
    const n = fileCount(e.files);
    const aMain = isMainEnd(e.a), bMain = isMainEnd(e.b);
    const a = aMain ? null : keyOf(e.a), b = bMain ? null : keyOf(e.b);
    if (a && bMain) mainConflict.set(a, Math.max(mainConflict.get(a) ?? 0, n));
    else if (b && aMain) mainConflict.set(b, Math.max(mainConflict.get(b) ?? 0, n));
    else if (a && b && a !== b) { addPair(a, b, n); addPair(b, a, n); }
  }

  const remaining = new Set(cands.map((c) => c.fkey));
  const order = [];
  const edgesTo = (k) => { let n = 0; for (const o of pair.get(k)?.keys() ?? []) if (remaining.has(o) && o !== k) n++; return n; };
  const cmp = (x, y) =>
    (mainConflict.has(x.fkey) ? 1 : 0) - (mainConflict.has(y.fkey) ? 1 : 0)
    || edgesTo(x.fkey) - edgesTo(y.fkey)
    || sizeOf(x) - sizeOf(y)
    || prAt(x) - prAt(y)
    || (x.fkey < y.fkey ? -1 : x.fkey > y.fkey ? 1 : 0);

  while (remaining.size) {
    let ready = cands.filter((c) => remaining.has(c.fkey) && [...before.get(c.fkey)].every((a) => !remaining.has(a)));
    let cycle = false;
    if (!ready.length) { ready = cands.filter((c) => remaining.has(c.fkey)); cycle = true; }
    ready.sort(cmp);
    const pick = ready[0];
    const reasons = [];
    const nEdges = edgesTo(pick.fkey);
    if (mainConflict.has(pick.fkey)) reasons.push(`conflicts with main on ${plural(mainConflict.get(pick.fkey), 'file')}`);
    else if (nEdges === 0) reasons.push('no conflicts');
    else reasons.push('no conflict with main');
    if (nEdges > 0) reasons.push(`conflicts with ${plural(nEdges, 'other lane')}`);
    if (ready.length > 1) {
      const rest = ready.slice(1);
      const tiedSoFar = (o) => (mainConflict.has(o.fkey) === mainConflict.has(pick.fkey)) && edgesTo(o.fkey) === nEdges;
      const tied = rest.filter(tiedSoFar);
      if (tied.length && tied.every((o) => sizeOf(o) > sizeOf(pick))) reasons.push('smallest diff');
      else if (tied.length && tied.every((o) => sizeOf(o) === sizeOf(pick)) && tied.every((o) => prAt(o) > prAt(pick))) reasons.push('oldest PR');
    }
    const after = [...before.get(pick.fkey)].filter((a) => byKey.has(a)).sort();
    if (after.length) reasons.push(`after ${after.join(', ')} (contains it)`);
    if (cycle) reasons.push('dependency cycle');
    order.push({ fkey: pick.fkey, rank: order.length + 1, reasons, after });
    remaining.delete(pick.fkey);
  }

  const rank = new Map(order.map((o) => [o.fkey, o.rank]));
  const warnings = [];
  for (const [a, m] of pair) {
    for (const [b, n] of m) {
      if (rank.get(a) >= rank.get(b)) continue;
      warnings.push({ first: a, then: b, files: n, text: `merging ${a} first makes ${b} conflict${n ? ` on ${plural(n, 'file')}` : ''}` });
    }
  }
  warnings.sort((x, y) => rank.get(x.first) - rank.get(y.first) || rank.get(x.then) - rank.get(y.then));
  return { order, warnings };
}
