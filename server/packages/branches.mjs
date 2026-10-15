// Lane -> package touches over every branch of a repo (fleet §6 2.6, P6).
//
// Per repo, strictly sequential git (same discipline as collector/lanes.mjs):
//   refs     remote branches from `refs/remotes/origin` of the checkout, or
//            `refs/heads` of the bare mirror (`packages.fetch:'mirror'`), newest
//            first; older than `branchWindowDays` or already merged into main
//            -> dropped; capped at `maxBranches`. Local worktree branches come
//            from the caller (lanes.knownWorktrees()) and always count.
//   branch   `merge-base <main> <sha>`, `diff --name-only -z <mb> <sha>`,
//            `--shortstat`, ahead/behind; cached by (sha, mainSha), LRU 2000.
//
// Every git call runs with the scratch env from gitenv.mjs, so objects from
// the mirror are visible to the checkout and nothing is ever written into the
// checkout's object store. Commits are passed by sha (validated), never by a
// ref name a branch author chose. Nothing here fetches, checks out, or writes.
import fs from 'node:fs';
import path from 'node:path';
import { matchAny } from './glob.mjs';
import {
  runGit, scratchEnv, withEnv, gitCommonDir, mirrorDir, mirrorRef, repoOf, defaultCacheDir,
} from './gitenv.mjs';

const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_FILES = 5000;
const BRANCH_CACHE_MAX = 2000;
const DAY_MS = 24 * 3600 * 1000;

export const isSha = (s) => typeof s === 'string' && SHA_RE.test(s);

/** Tiny LRU on Map insertion order. */
export class Lru {
  constructor(max) { this.max = max; this.map = new Map(); this.hits = 0; this.misses = 0; }
  get(k) {
    if (!this.map.has(k)) { this.misses++; return undefined; }
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v); this.hits++;
    return v;
  }
  set(k, v) {
    this.map.delete(k); this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
}

const branchCache = new Lru(BRANCH_CACHE_MAX);
export function _clearCache() { branchCache.clear(); }
export function cacheStats() { return { size: branchCache.size, hits: branchCache.hits, misses: branchCache.misses }; }

function git(dir, args, env, timeout = 8000) {
  return runGit(['-C', dir, ...args], { timeout, env: withEnv(env) });
}

/** Parse `for-each-ref --format='%(refname)%09%(objectname)%09%(committerdate:unix)%09%(symref)'`. */
export function parseRefs(stdout, prefix) {
  const out = [];
  for (const line of String(stdout).split('\n')) {
    if (!line) continue;
    const [ref, sha, ts, symref] = line.split('\t');
    if (symref) continue; // origin/HEAD
    if (!ref || !ref.startsWith(prefix) || !isSha(sha)) continue;
    const branch = ref.slice(prefix.length);
    if (!branch || branch === 'HEAD') continue;
    const t = Number(ts);
    out.push({ branch, sha, lastCommitAt: Number.isFinite(t) ? t * 1000 : null });
  }
  return out;
}

const REF_FORMAT = '--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(symref)';

/** Remote branches, newest first: `[{branch, sha, lastCommitAt}]`. */
export async function remoteBranches(dir, { mirror = null, env } = {}) {
  const prefix = mirror ? 'refs/heads/' : 'refs/remotes/origin/';
  const where = mirror || dir;
  const r = await git(where, ['for-each-ref', '--sort=-committerdate', REF_FORMAT, prefix.slice(0, -1)], mirror ? undefined : env);
  if (!r.ok) return [];
  return parseRefs(r.stdout, prefix);
}

/** Resolve a ref to a commit sha in `dir` (or the mirror), or null. */
export async function resolveCommit(dir, ref, env) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-')) return null;
  const r = await git(dir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], env);
  const sha = r.ok ? r.stdout.trim() : '';
  return isSha(sha) ? sha : null;
}

/** True when `a` is an ancestor of `b` (both shas). */
export async function isAncestor(dir, a, b, env) {
  if (!isSha(a) || !isSha(b)) return false;
  const r = await git(dir, ['merge-base', '--is-ancestor', a, b], env);
  return r.ok;
}

/** Parse `git diff --shortstat`: `{files, ins, del}`. */
export function parseShortstat(s) {
  const n = (re) => Number(re.exec(s)?.[1] ?? 0);
  return { files: n(/(\d+) files? changed/), ins: n(/(\d+) insertions?\(\+\)/), del: n(/(\d+) deletions?\(-\)/) };
}

/**
 * The branch's diff against its merge base with main:
 * `{mergeBase, ahead, behind, files[], truncated, size:{files, ins, del}}`, or
 * `{error}`. Cached by `(sha, mainSha)`.
 */
export async function branchInfo(dir, sha, mainSha, { env } = {}) {
  if (!isSha(sha) || !isSha(mainSha)) return { error: 'bad sha' };
  const key = `${sha}:${mainSha}`;
  const hit = branchCache.get(key);
  if (hit) return hit;
  const mbr = await git(dir, ['merge-base', mainSha, sha], env);
  const mergeBase = mbr.ok ? mbr.stdout.trim() : '';
  if (!isSha(mergeBase)) return { error: 'no merge base' };
  const names = await git(dir, ['-c', 'core.quotePath=false', 'diff', '--no-renames', '--no-ext-diff', '--name-only', '-z', mergeBase, sha], env, 15000);
  if (!names.ok) return { error: 'diff failed' };
  let files = names.stdout.split('\0').filter(Boolean);
  const truncated = files.length > MAX_FILES;
  if (truncated) files = files.slice(0, MAX_FILES);
  const stat = await git(dir, ['diff', '--no-renames', '--no-ext-diff', '--shortstat', mergeBase, sha], env, 15000);
  const size = stat.ok ? parseShortstat(stat.stdout) : { files: files.length, ins: 0, del: 0 };
  const ab = await git(dir, ['rev-list', '--left-right', '--count', `${mainSha}...${sha}`], env);
  let ahead = 0, behind = 0;
  if (ab.ok) {
    const m = /^(\d+)\s+(\d+)/.exec(ab.stdout.trim());
    if (m) { behind = Number(m[1]); ahead = Number(m[2]); }
  }
  const info = { mergeBase, ahead, behind, files, truncated, size };
  branchCache.set(key, info);
  return info;
}

/** Files a branch changes since its merge base with main (repo-relative). */
export async function touches(dir, sha, mainSha, opts) {
  const info = await branchInfo(dir, sha, mainSha, opts);
  return info.error ? [] : info.files;
}

/** Package names (`[{name, paths}]`) whose globs match any of `files`. */
export function packagesFor(files, packages) {
  const out = [];
  if (!Array.isArray(packages)) return out;
  for (const p of packages) {
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.paths) || !p.paths.length) continue;
    if (files.some((f) => matchAny(p.paths, f))) out.push(p.name);
  }
  return out;
}

// HEAD of a local worktree: `{branch|null, sha}`.
async function worktreeHead(root) {
  const h = await runGit(['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD'], { timeout: 4000 });
  const sha = h.ok ? h.stdout.trim() : '';
  if (!isSha(sha)) return null;
  const b = await runGit(['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 4000 });
  return { sha, branch: b.ok ? b.stdout.trim() || null : null };
}

// When the refs were last refreshed: FETCH_HEAD mtime of the mirror or checkout.
function refsAt(gitDir) {
  for (const f of ['FETCH_HEAD', 'packed-refs']) {
    try { return fs.statSync(path.join(gitDir, f)).mtimeMs; } catch { /* next */ }
  }
  return null;
}

function stripRemote(mainRef) {
  const s = String(mainRef);
  if (s.startsWith('refs/remotes/origin/')) return s.slice('refs/remotes/origin/'.length);
  if (s.startsWith('origin/')) return s.slice('origin/'.length);
  if (s.startsWith('refs/heads/')) return s.slice('refs/heads/'.length);
  return s;
}

/**
 * Every open branch of one repo with what it touches.
 *
 * `repo`: `{name, dir, packages?:[{name, paths}]}` (dir = the main checkout).
 * `opts`: `mainRef` ('origin/main'), `branchWindowDays` (14), `maxBranches`
 * (40), `fetch` ('none'|'mirror'), `cacheDir`, `worktrees` ([{id, root,
 * branch?, head?}] from lanes.knownWorktrees(); only those sharing this repo's
 * git dir are used), `now`.
 *
 * Returns `{repo, mainRef, mainSha, refsAt, source, branches:[{repo, branch,
 * sha, local, pushed, laneId, mergeBase, ahead, behind, lastCommitAt, files[],
 * packages[], size:{files, ins, del}}], errors[]}`. Local lanes always come
 * first and are never dropped; remote-only branches fill up to `maxBranches`.
 */
export async function collectBranches(repo, opts = {}) {
  const r = repoOf(repo);
  const {
    mainRef = 'origin/main', branchWindowDays = 14, maxBranches = 40, fetch = 'none',
    cacheDir = defaultCacheDir(), worktrees = [], now = Date.now(),
  } = opts;
  const errors = [];
  const result = { repo: r.name, mainRef, mainSha: null, refsAt: null, source: 'refs', branches: [], errors };
  const common = await gitCommonDir(r.dir);
  if (!common) { errors.push('not a git repo'); return result; }

  const mirror = fetch === 'mirror' && fs.existsSync(path.join(mirrorDir(r.name, cacheDir), 'HEAD'))
    ? mirrorDir(r.name, cacheDir) : null;
  if (fetch === 'mirror' && !mirror) errors.push('mirror missing; using local refs');
  const env = await scratchEnv(r, { cacheDir, mirror: mirror || false, now });
  result.source = mirror ? 'mirror' : 'refs';
  result.refsAt = refsAt(mirror || common);

  const mainSha = mirror
    ? await resolveCommit(mirror, mirrorRef(mainRef))
    : await resolveCommit(r.dir, mainRef, env);
  if (!mainSha) { errors.push(`cannot resolve ${mainRef}`); return result; }
  result.mainSha = mainSha;
  const mainName = stripRemote(mainRef);

  // Local worktree lanes of this repo.
  const locals = new Map(); // branch|`@sha` -> {branch, sha, laneId}
  for (const w of Array.isArray(worktrees) ? worktrees : []) {
    if (!w || typeof w.root !== 'string') continue;
    if (await gitCommonDir(w.root) !== common) continue;
    let head = isSha(w.head) ? { sha: w.head, branch: w.branch ?? null } : await worktreeHead(w.root);
    if (!head) continue;
    if (head.branch === mainName && path.resolve(w.root) === r.dir) continue; // the main checkout itself
    const key = head.branch || `@${head.sha}`;
    if (!locals.has(key)) locals.set(key, { branch: head.branch, sha: head.sha, laneId: w.id ?? null });
  }

  const remote = await remoteBranches(r.dir, { mirror, env });
  const remoteByName = new Map(remote.map((b) => [b.branch, b]));
  const cutoff = now - branchWindowDays * DAY_MS;

  const picked = [];
  for (const l of locals.values()) {
    const rem = l.branch ? remoteByName.get(l.branch) : null;
    picked.push({ branch: l.branch, sha: l.sha, local: true, pushed: !!rem && rem.sha === l.sha, laneId: l.laneId, lastCommitAt: null });
  }
  let room = Math.max(0, maxBranches - picked.length);
  for (const b of remote) {
    if (room <= 0) break;
    if (b.branch === mainName || locals.has(b.branch)) continue;
    if (b.lastCommitAt != null && b.lastCommitAt < cutoff) continue;
    if (b.sha === mainSha || await isAncestor(r.dir, b.sha, mainSha, env)) continue; // merged
    picked.push({ branch: b.branch, sha: b.sha, local: false, pushed: true, laneId: null, lastCommitAt: b.lastCommitAt });
    room--;
  }

  for (const p of picked) {
    const info = await branchInfo(r.dir, p.sha, mainSha, { env });
    if (info.error) { errors.push(`${p.branch || p.sha.slice(0, 8)}: ${info.error}`); continue; }
    let lastCommitAt = p.lastCommitAt;
    if (lastCommitAt == null) {
      const t = await git(r.dir, ['show', '-s', '--format=%ct', p.sha], env);
      const n = Number(t.stdout.trim());
      lastCommitAt = t.ok && Number.isFinite(n) ? n * 1000 : null;
    }
    result.branches.push({
      repo: r.name, branch: p.branch, sha: p.sha, local: p.local, pushed: p.pushed, laneId: p.laneId,
      mergeBase: info.mergeBase, ahead: info.ahead, behind: info.behind, lastCommitAt,
      files: info.files, ...(info.truncated ? { truncated: true } : {}),
      packages: packagesFor(info.files, r.packages), size: info.size,
    });
  }
  return result;
}
