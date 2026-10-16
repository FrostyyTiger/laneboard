// Scratch git environment + optional bare mirror (fleet §6 2.6, P6).
//
// laneboard never writes into a user's repository. Two things here would
// otherwise do it:
//
//   - `git merge-tree --write-tree` (P7) writes the merged tree and the
//     conflict-marker blobs into the object store. `scratchEnv(repo)` points
//     GIT_OBJECT_DIRECTORY at laneboard's own cache and lists the checkout's
//     object store (and the mirror's) as read-only alternates, so every object
//     git writes lands under `cacheDir/scratch-objects/<repo>` and the
//     checkout's `.git/objects` is never touched. Commits are passed by sha, so
//     local and mirror objects mix freely.
//   - `packages.fetch:'mirror'` keeps a bare clone under
//     `cacheDir/mirrors/<repo>.git`, fetched with an explicit refspec. The
//     user's checkout is never fetched, checked out or modified.
//
// No config import: callers (the P9 collector) pass `cacheDir` etc. explicitly,
// so this module is testable against temp dirs only.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { run as defaultRun } from '../util.mjs';

let runner = defaultRun;
/** Test hook: replace the process runner (same shape as util.run). */
export function _setRunner(fn) { runner = fn || defaultRun; }
export function runGit(args, opts) { return runner('git', args, opts); }

export const SCRATCH_MAX_BYTES = 200 * 1024 * 1024;
export const SCRATCH_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const PRUNE_CHECK_MS = 10 * 60 * 1000;
const MIRROR_TIMEOUT_MS = 60_000;
// Transports a mirror clone/fetch may use. `ext::` (runs a command) and other
// exotic helpers are refused even if a checkout's origin names them.
const ALLOW_PROTOCOL = 'https:ssh:git:file';

/** `$XDG_CACHE_HOME/laneboard/git`, else `~/.cache/laneboard/git`. */
export function defaultCacheDir(env = process.env) {
  const base = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)
    ? env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  return path.join(base, 'laneboard', 'git');
}

/** A repo name safe as one path segment: `acme/web` -> `acme_web`, never `..`. */
export function safeRepoName(name) {
  let s = String(name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '_').replace(/^\./, '_').slice(0, 100);
  if (!s) s = '_';
  return s;
}

/** Normalise a repo argument: a dir string or `{name?, dir}`. */
export function repoOf(repo) {
  if (typeof repo === 'string') return { name: path.basename(path.resolve(repo)), dir: path.resolve(repo) };
  if (!repo || typeof repo.dir !== 'string') throw new TypeError('repo needs a dir');
  const dir = path.resolve(repo.dir);
  return { ...repo, name: repo.name || path.basename(dir), dir };
}

export function scratchDir(name, cacheDir = defaultCacheDir()) {
  return path.join(cacheDir, 'scratch-objects', safeRepoName(name));
}

export function mirrorDir(name, cacheDir = defaultCacheDir()) {
  return path.join(cacheDir, 'mirrors', safeRepoName(name) + '.git');
}

// The git dir that owns the object store. For a worktree that is the main
// checkout's git dir (`--git-common-dir`). Cached for the process lifetime: it
// essentially never changes, and this path is polled.
const commonDirs = new Map();
export async function gitCommonDir(dir) {
  const key = path.resolve(dir);
  if (commonDirs.has(key)) return commonDirs.get(key);
  const r = await runGit(['-C', key, 'rev-parse', '--git-common-dir'], { timeout: 4000 });
  if (!r.ok) return null;
  const out = r.stdout.trim();
  if (!out) return null;
  const abs = fs.realpathSync.native(path.resolve(key, out));
  commonDirs.set(key, abs);
  return abs;
}
export function _clearCaches() { commonDirs.clear(); lastPruneCheck.clear(); }

/** `<common git dir>/objects`, honouring an existing GIT_OBJECT_DIRECTORY-free layout. */
export async function objectsDir(dir) {
  const common = await gitCommonDir(dir);
  return common ? path.join(common, 'objects') : null;
}

function ensureScratch(dir) {
  fs.mkdirSync(path.join(dir, 'pack'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true, mode: 0o700 });
  const stamp = path.join(dir, '.created');
  if (!fs.existsSync(stamp)) fs.writeFileSync(stamp, String(Date.now()), { mode: 0o600 });
}

/**
 * The env additions for read-only git against `repo`:
 * `{GIT_OBJECT_DIRECTORY: cacheDir/scratch-objects/<repo>,
 *   GIT_ALTERNATE_OBJECT_DIRECTORIES: <checkout>/.git/objects[:<mirror>/objects]}`.
 * The scratch dir is created (and pruned when over 200 MB or 7 days old).
 * `opts.mirror`: a mirror git dir to add as an alternate; `true` = the default
 * mirror path when it exists. Returns null when `repo.dir` is not a git repo.
 */
export async function scratchEnv(repo, { cacheDir = defaultCacheDir(), mirror = true, now = Date.now() } = {}) {
  const r = repoOf(repo);
  const objects = await objectsDir(r.dir);
  if (!objects) return null;
  const alts = [objects];
  const m = mirror === true ? mirrorDir(r.name, cacheDir) : mirror || null;
  if (m && fs.existsSync(path.join(m, 'objects'))) alts.push(path.join(path.resolve(m), 'objects'));
  const scratch = scratchDir(r.name, cacheDir);
  await pruneScratch(scratch, { now });
  ensureScratch(scratch);
  return {
    GIT_OBJECT_DIRECTORY: scratch,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alts.join(path.delimiter),
  };
}

/** process.env + the scratch additions, ready for `run(..., {env})`. */
export function withEnv(extra) {
  return extra ? { ...process.env, ...extra } : undefined;
}

async function dirBytes(dir, cap) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try { total += (await fsp.stat(p)).size; } catch { /* raced */ }
        if (total > cap) return total;
      }
    }
  }
  return total;
}

const lastPruneCheck = new Map();
/**
 * Delete a scratch object dir when it is over `maxBytes` or older than
 * `maxAgeMs` (by its `.created` stamp). Checked at most every 10 min per dir
 * unless `force`. Returns `{pruned, reason?}`. Only ever removes a path under
 * a `scratch-objects` directory.
 */
export async function pruneScratch(dir, { maxBytes = SCRATCH_MAX_BYTES, maxAgeMs = SCRATCH_MAX_AGE_MS, now = Date.now(), force = false } = {}) {
  if (path.basename(path.dirname(dir)) !== 'scratch-objects') throw new Error('refusing to prune a non-scratch dir');
  if (!force && now - (lastPruneCheck.get(dir) ?? -Infinity) < PRUNE_CHECK_MS) return { pruned: false };
  lastPruneCheck.set(dir, now);
  if (!fs.existsSync(dir)) return { pruned: false };
  let reason = null;
  let created = NaN;
  try { created = Number(fs.readFileSync(path.join(dir, '.created'), 'utf8')); } catch { /* no stamp */ }
  if (!Number.isFinite(created)) {
    try { created = fs.statSync(dir).mtimeMs; } catch { created = now; }
  }
  if (now - created > maxAgeMs) reason = 'age';
  else if (await dirBytes(dir, maxBytes) > maxBytes) reason = 'size';
  if (!reason) return { pruned: false };
  await fsp.rm(dir, { recursive: true, force: true });
  return { pruned: true, reason };
}

function mirrorEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: ALLOW_PROTOCOL };
}

/** The checkout's `origin` URL, or null. Read, never written. */
export async function originUrl(dir) {
  const r = await runGit(['-C', dir, 'config', '--get', 'remote.origin.url'], { timeout: 4000 });
  const url = r.ok ? r.stdout.trim() : '';
  return url || null;
}

const mirrorState = new Map(); // mirror dir -> {fetchedAt, error, busy}

/**
 * Keep the bare mirror of `repo` fresh: clone it once from the checkout's
 * origin URL, then `git fetch --prune --no-tags origin '+refs/heads/*:refs/heads/*'`
 * at most every `fetchEverySec` (timeout 60 s). Never touches the checkout.
 * Returns `{dir, ok, fetched, fetchedAt, error?}`.
 */
export async function syncMirror(repo, { cacheDir = defaultCacheDir(), fetchEverySec = 300, now = Date.now(), force = false, timeoutMs = MIRROR_TIMEOUT_MS } = {}) {
  const r = repoOf(repo);
  const dir = mirrorDir(r.name, cacheDir);
  const st = mirrorState.get(dir) || { fetchedAt: 0, error: null, busy: false };
  mirrorState.set(dir, st);
  const exists = fs.existsSync(path.join(dir, 'HEAD'));
  if (st.busy) return { dir, ok: exists, fetched: false, fetchedAt: st.fetchedAt, error: st.error || undefined };
  if (exists && !force && st.fetchedAt && now - st.fetchedAt < fetchEverySec * 1000) {
    return { dir, ok: true, fetched: false, fetchedAt: st.fetchedAt };
  }
  st.busy = true;
  try {
    if (!exists) {
      const url = await originUrl(r.dir);
      if (!url) return fail(st, dir, 'no origin url');
      if (url.startsWith('-')) return fail(st, dir, 'refusing origin url');
      fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
      const tmp = `${dir}.tmp-${process.pid}`;
      await fsp.rm(tmp, { recursive: true, force: true });
      const c = await runGit(['clone', '--bare', '--no-tags', '--quiet', '--', url, tmp], { timeout: timeoutMs, env: mirrorEnv() });
      if (!c.ok) {
        await fsp.rm(tmp, { recursive: true, force: true });
        return fail(st, dir, oneErr(c));
      }
      await fsp.rename(tmp, dir);
    }
    const f = await runGit(['-C', dir, 'fetch', '--prune', '--no-tags', '--quiet', 'origin', '+refs/heads/*:refs/heads/*'],
      { timeout: timeoutMs, env: mirrorEnv() });
    if (!f.ok) return fail(st, dir, oneErr(f));
    st.fetchedAt = now;
    st.error = null;
    return { dir, ok: true, fetched: true, fetchedAt: now };
  } finally {
    st.busy = false;
  }
}

function fail(st, dir, error) {
  st.error = error;
  return { dir, ok: fs.existsSync(path.join(dir, 'HEAD')), fetched: false, fetchedAt: st.fetchedAt, error };
}

function oneErr(r) {
  if (r.signal) return `git ${r.signal}`;
  const line = String(r.stderr || '').split('\n').map((s) => s.trim()).find(Boolean) || `git exit ${r.code}`;
  return line.slice(0, 200);
}

/** Map a checkout ref (`origin/main`) to the mirror's ref (`refs/heads/main`). */
export function mirrorRef(mainRef) {
  const s = String(mainRef || 'origin/main');
  if (s.startsWith('refs/remotes/origin/')) return 'refs/heads/' + s.slice('refs/remotes/origin/'.length);
  if (s.startsWith('origin/')) return 'refs/heads/' + s.slice('origin/'.length);
  if (s.startsWith('refs/')) return s;
  return 'refs/heads/' + s;
}
