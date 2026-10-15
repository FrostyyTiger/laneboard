// Textual conflict prediction between open branches and main (fleet §6 2.7, P7).
//
//   mergeTree(dir, a, b)   `git merge-tree --write-tree --name-only --no-messages -z a b`
//                          exit 0 clean, exit 1 conflicts (first NUL field is
//                          the tree oid, the rest the conflicted paths), any
//                          other outcome -> {error}. Cached by the sorted sha
//                          pair (LRU 5000), so only changed shas cost git time.
//   predictConflicts(...)  every branch vs main, plus every unordered pair of
//                          branches whose `files[]` intersect (disjoint file
//                          sets cannot conflict textually). Needs git >= 2.38;
//                          below that the textual pass is off and only
//                          `kind:'overlap'` (file-set intersection) is reported.
//   overlapPairs(...)      the pure overlap pass (also used by the hub for lanes
//                          no single builder can see both of).
//   hotspots(...)          files touched by >= 2 open lanes or in any conflict.
//
// Every git call runs with the scratch env from gitenv.mjs: merge-tree writes
// its tree and conflict blobs into laneboard's cache, never into the repo.
// Commits are passed by validated sha only. Display-only: nothing here merges,
// checks out, or writes a ref.
import { runGit, scratchEnv, withEnv, repoOf, defaultCacheDir } from './gitenv.mjs';
import { Lru, isSha, branchInfo } from './branches.mjs';

export const MIN_GIT = [2, 38];
const PAIR_CACHE_MAX = 5000;
const MERGE_TREE_TIMEOUT_MS = 15_000;
const MAX_CONFLICT_FILES = 500;
const HOTSPOT_TOP = 20;

const pairCache = new Lru(PAIR_CACHE_MAX);
let versionPromise = null;

export function _clearCache() { pairCache.clear(); versionPromise = null; }
export function cacheStats() { return { size: pairCache.size, hits: pairCache.hits, misses: pairCache.misses }; }

/** Parse `git version 2.43.0` (also `2.39.3 (Apple Git-146)`) -> [major, minor, patch] or null. */
export function parseGitVersion(s) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** True when version `v` is at least `[major, minor]`. */
export function atLeast(v, [maj, min] = MIN_GIT) {
  if (!Array.isArray(v)) return false;
  return v[0] > maj || (v[0] === maj && v[1] >= min);
}

/** `{version:[..]|null, textual:bool}`, asked of git once per process. */
export function gitVersion() {
  if (!versionPromise) {
    versionPromise = runGit(['version'], { timeout: 4000 }).then((r) => {
      const version = r.ok ? parseGitVersion(r.stdout) : null;
      return { version, textual: atLeast(version) };
    });
  }
  return versionPromise;
}

/** Whether `merge-tree --write-tree` is available (the `conflicts:textual` capability). */
export async function textualAvailable() {
  return (await gitVersion()).textual;
}

export const pairKey = (a, b) => [a, b].sort().join(':');

/** Parse merge-tree's `-z --name-only` output: `{tree, files[]}`. */
export function parseMergeTree(stdout) {
  const parts = String(stdout ?? '').split('\0');
  const tree = parts.shift() || '';
  const files = [...new Set(parts.filter(Boolean))];
  return { tree: tree.trim(), files };
}

/**
 * `{clean:true, files:[]}`, `{clean:false, files:[paths]}` or `{error}` for the
 * merge of commits `a` and `b` in `dir`. `opts.env` is the scratch env (from
 * gitenv.scratchEnv); without one, nothing is run (it would write into the
 * repo). Results (not errors) are cached by the sorted sha pair.
 */
export async function mergeTree(dir, a, b, { env } = {}) {
  if (!isSha(a) || !isSha(b)) return { error: 'bad sha' };
  if (!env || !env.GIT_OBJECT_DIRECTORY) return { error: 'no scratch env' };
  const key = pairKey(a, b);
  const hit = pairCache.get(key);
  if (hit) return hit;
  const r = await runGit(
    ['-C', dir, '-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', a, b],
    { timeout: MERGE_TREE_TIMEOUT_MS, env: withEnv(env) });
  let res;
  if (r.ok) {
    res = { clean: true, files: [] };
  } else if (r.code === 1 && !r.signal) {
    const { tree, files } = parseMergeTree(r.stdout);
    if (!isSha(tree)) return { error: 'merge-tree: no tree' };
    res = { clean: false, files: files.slice(0, MAX_CONFLICT_FILES) };
  } else {
    return { error: r.signal ? `merge-tree ${r.signal}` : `merge-tree exit ${r.code}` };
  }
  pairCache.set(key, res);
  return res;
}

function intersect(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return [];
  const set = new Set(b);
  return [...new Set(a.filter((f) => set.has(f)))].sort();
}

const ref = (br) => ({ branch: br.branch ?? null, sha: br.sha, ...(br.fkey ? { fkey: br.fkey } : {}) });

/**
 * Pure overlap pass: every unordered pair of `items` (`{branch, sha, files[],
 * fkey?}`) whose files intersect -> `{a, b, kind:'overlap', files, at}`.
 * Pairs whose sorted sha key is in `skip` (a Set, e.g. pairs a textual result
 * already covers) are left out.
 */
export function overlapPairs(items, { skip = null, now = Date.now() } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((b) => b && isSha(b.sha) && Array.isArray(b.files));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (A.sha === B.sha) continue;
      if (skip && skip.has(pairKey(A.sha, B.sha))) continue;
      const files = intersect(A.files, B.files);
      if (files.length) out.push({ a: ref(A), b: ref(B), kind: 'overlap', files, at: now });
    }
  }
  return out;
}

/**
 * Predict conflicts for one repo's open branches.
 *
 * `repo`: `{name, dir}` (dir = the main checkout). `input`: `{branches, mainSha}`
 * as returned by branches.collectBranches. `opts`: `cacheDir`, `env` (a scratch
 * env; computed when absent), `textual` (force the mode; default: the git
 * version check), `now`.
 *
 * Returns `{textual, conflicts:[{a:{branch, sha}, b:{branch, sha}|{main:true},
 * kind, files[], at}], checked, skipped, errors[]}`. `checked` counts the pairs
 * merge-tree ran on (cache hits included), `skipped` the branch pairs the
 * file-set pre-filter dropped. In textual mode only conflicting pairs are
 * listed; in overlap mode (old git) the file-set intersections are.
 */
export async function predictConflicts(repo, { branches = [], mainSha = null } = {}, opts = {}) {
  const r = repoOf(repo);
  const now = opts.now ?? Date.now();
  const errors = [];
  const textual = opts.textual ?? await textualAvailable();
  const list = (Array.isArray(branches) ? branches : []).filter((b) => b && isSha(b.sha) && b.sha !== mainSha);
  const out = { textual, conflicts: [], checked: 0, skipped: 0, errors };
  if (!list.length) return out;

  let env = opts.env;
  if (!env) env = await scratchEnv(r, { cacheDir: opts.cacheDir ?? defaultCacheDir(), mirror: opts.mirror ?? true, now });
  if (!env) { errors.push('not a git repo'); return out; }

  const label = (b) => b.branch || b.sha.slice(0, 8);

  if (!textual) {
    // Old git: what main changed since each branch's merge base, intersected
    // with the branch's own files; then branch-vs-branch file overlap.
    if (isSha(mainSha)) {
      for (const b of list) {
        const info = await branchInfo(r.dir, mainSha, b.sha, { env });
        if (info.error) { errors.push(`${label(b)} vs main: ${info.error}`); continue; }
        const files = intersect(b.files, info.files);
        if (files.length) out.conflicts.push({ a: ref(b), b: { main: true }, kind: 'overlap', files, at: now });
      }
    }
    out.conflicts.push(...overlapPairs(list, { now }));
    return out;
  }

  if (isSha(mainSha)) {
    for (const b of list) {
      const m = await mergeTree(r.dir, b.sha, mainSha, { env });
      out.checked++;
      if (m.error) { errors.push(`${label(b)} vs main: ${m.error}`); continue; }
      if (!m.clean) out.conflicts.push({ a: ref(b), b: { main: true }, kind: 'textual', files: m.files, at: now });
    }
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (A.sha === B.sha) continue;
      if (!intersect(A.files, B.files).length) { out.skipped++; continue; }
      const m = await mergeTree(r.dir, A.sha, B.sha, { env });
      out.checked++;
      if (m.error) { errors.push(`${label(A)} vs ${label(B)}: ${m.error}`); continue; }
      if (!m.clean) out.conflicts.push({ a: ref(A), b: ref(B), kind: 'textual', files: m.files, at: now });
    }
  }
  return out;
}

/**
 * Per-repo hotspots: `[{file, lanes:[key], conflicts:n}]` for files touched by
 * >= 2 open lanes or named in any conflict, sorted by `conflicts` desc, then
 * lane count desc, then file name; top 20. A lane's key is `keyOf(branch)`
 * (default: fkey, laneId, branch name, short sha).
 */
export function hotspots(branches, conflicts, { keyOf = defaultKey, top = HOTSPOT_TOP } = {}) {
  const spots = new Map();
  const spot = (file) => {
    let s = spots.get(file);
    if (!s) { s = { file, lanes: [], conflicts: 0 }; spots.set(file, s); }
    return s;
  };
  for (const b of Array.isArray(branches) ? branches : []) {
    if (!b || !Array.isArray(b.files)) continue;
    const k = keyOf(b);
    if (!k) continue;
    for (const f of new Set(b.files)) {
      const s = spot(f);
      if (!s.lanes.includes(k)) s.lanes.push(k);
    }
  }
  for (const c of Array.isArray(conflicts) ? conflicts : []) {
    if (!c || !Array.isArray(c.files)) continue;
    for (const f of new Set(c.files)) spot(f).conflicts++;
  }
  return [...spots.values()]
    .filter((s) => s.lanes.length >= 2 || s.conflicts > 0)
    .map((s) => ({ ...s, lanes: s.lanes.sort() }))
    .sort((x, y) => y.conflicts - x.conflicts || y.lanes.length - x.lanes.length || (x.file < y.file ? -1 : x.file > y.file ? 1 : 0))
    .slice(0, top);
}

function defaultKey(b) {
  return b.fkey || b.laneId || b.branch || (typeof b.sha === 'string' ? b.sha.slice(0, 8) : null);
}
