// The repos the Packages view covers, normalised (fleet plan §6 2.2, P2).
//
// `resolveRepos(config)` turns `config.repos[]` (plus the legacy single
// `config.ci.repo`) into
//
//   [{ name, dir, ci: {provider:'gh', repo:'owner/name', collect} | null,
//      packages: [{name, paths, jobs, workflow?, plans?}] | null,
//      global: [], ignoreJobs: [], markers? }]
//
//   - `dir` is `repos[].path` (a leading `~/` expanded, relative to codeDir),
//     else `<codeDir>/<name>`.
//   - `ci`: an explicit `repos[].ci` wins (`provider:'none'` or `null` means
//     no CI). A `gh` block without `repo` takes the slug from the checkout's
//     origin. A repo with no resolvable slug gets `ci: null` (rows: unknown).
//   - Legacy: `config.ci.repo` is a *directory name* under codeDir (the cwd
//     gh.mjs runs in), not a slug. With `ci.provider === 'gh'` and no
//     `repos[].ci` anywhere, that directory gets a `ci` block whose slug is
//     `parseRemote(git remote get-url origin)`; if it is not in `repos[]` it
//     is added as an entry of its own.
//   - `packages: null` means "none configured" (auto-detect, P3, decides).
//
// Origin lookups are cached for the process lifetime (`_clearCache()` for
// tests). No config import: the caller passes the built config.
import os from 'node:os';
import path from 'node:path';

import { run } from '../util.mjs';

const SLUG_RX = /^[\w.-]+\/[\w.-]+$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : []);

/** true for an `owner/name` slug that names no `.`/`..` segment. */
export function isSlug(s) {
  return typeof s === 'string' && SLUG_RX.test(s) && !s.split('/').some((p) => /^\.+$/.test(p));
}

/**
 * Parse a git remote URL into `{host, owner, name, slug}`, or null.
 * Handles `git@github.com:o/n.git`, `https://github.com/o/n(.git)`,
 * `ssh://git@github.com[:port]/o/n`, `git://host/o/n`, with or without a
 * trailing `/` or `.git`. Credentials in an https URL are dropped, never
 * returned. Anything that is not exactly `<owner>/<name>` after the host
 * (a GitLab subgroup, a local path, `ext::`) is null.
 */
export function parseRemote(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || u.length > 2048 || /[\s\x00-\x1f\x7f]/.test(u)) return null;
  let host;
  let rest;
  const scp = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(?!\/\/)(.+)$/.exec(u);
  if (/^(?:https?|ssh|git|git\+ssh|ssh\+git):\/\//i.test(u)) {
    let parsed;
    try { parsed = new URL(u); } catch { return null; }
    host = parsed.hostname;
    rest = decodeURIComponent(parsed.pathname);
  } else if (scp && !u.includes('::')) {
    host = scp[1];
    rest = scp[2];
  } else {
    return null;
  }
  if (!host) return null;
  rest = rest.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const slug = `${parts[0]}/${parts[1]}`;
  if (!isSlug(slug)) return null;
  return { host: host.toLowerCase(), owner: parts[0], name: parts[1], slug };
}

/** The GitHub `owner/name` slug of a remote URL, or null for other hosts. */
export function githubSlug(url) {
  const r = parseRemote(url);
  if (!r) return null;
  return r.host === 'github.com' || r.host === 'www.github.com' || r.host === 'ssh.github.com' ? r.slug : null;
}

/** `git remote get-url origin` in `dir` (insteadOf applied), or null. */
export async function defaultOriginUrl(dir) {
  const r = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
    timeout: 4000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const url = r.ok ? r.stdout.trim() : '';
  return url || null;
}

const slugCache = new Map(); // dir -> Promise<slug|null>
/** Test hook: forget every cached origin lookup. */
export function _clearCache() { slugCache.clear(); }

function slugFor(dir, originUrl) {
  if (!slugCache.has(dir)) {
    slugCache.set(dir, Promise.resolve()
      .then(() => originUrl(dir))
      .then((url) => githubSlug(url))
      .catch(() => null));
  }
  return slugCache.get(dir);
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** The checkout dir of a repos[] entry. */
export function repoDir(entry, codeDir) {
  const base = typeof codeDir === 'string' && codeDir ? codeDir : path.join(os.homedir(), 'code');
  if (typeof entry?.path === 'string' && entry.path) return path.resolve(base, expandHome(entry.path));
  return path.join(base, String(entry?.name ?? ''));
}

function normPackages(list) {
  if (!Array.isArray(list)) return null;
  return list.filter((p) => isObj(p) && typeof p.name === 'string' && p.name).map((p) => {
    const out = { name: p.name, paths: strList(p.paths), jobs: strList(p.jobs) };
    if (typeof p.workflow === 'string' && p.workflow) out.workflow = p.workflow;
    if (Array.isArray(p.plans)) out.plans = strList(p.plans);
    return out;
  });
}

/**
 * Normalise `config.repos[]` (and the legacy `config.ci.repo`) into the shape
 * above. `opts.originUrl(dir) -> Promise<string|null>` is injectable for
 * tests; it defaults to `git remote get-url origin`.
 */
export async function resolveRepos(config, { originUrl = defaultOriginUrl } = {}) {
  const codeDir = config?.codeDir;
  const entries = Array.isArray(config?.repos) ? config.repos.filter((r) => isObj(r) && typeof r.name === 'string' && r.name) : [];
  const legacyProvider = config?.ci?.provider;
  const legacyDir = typeof config?.ci?.repo === 'string' ? config.ci.repo.trim() : '';
  const anyExplicitCi = entries.some((r) => r.ci !== undefined);

  const list = entries.map((r) => ({ entry: r, legacy: false }));
  const useLegacy = legacyProvider === 'gh' && legacyDir !== '' && !anyExplicitCi;
  if (useLegacy) {
    const hit = list.find((x) => x.entry.name === legacyDir);
    if (hit) hit.legacy = true;
    else list.push({ entry: { name: legacyDir }, legacy: true });
  }

  return Promise.all(list.map(async ({ entry: r, legacy }) => {
    const dir = repoDir(r, codeDir);
    let ci = null;
    if (isObj(r.ci) && (r.ci.provider ?? 'gh') === 'gh') {
      const repo = isSlug(r.ci.repo) ? r.ci.repo : await slugFor(dir, originUrl);
      if (repo) ci = { provider: 'gh', repo, collect: r.ci.collect !== false };
    } else if (legacy) {
      const repo = await slugFor(dir, originUrl);
      if (repo) ci = { provider: 'gh', repo, collect: true };
    }
    const out = {
      name: r.name,
      dir,
      ci,
      packages: normPackages(r.packages),
      global: strList(r.global),
      ignoreJobs: strList(r.ignoreJobs),
    };
    if (isObj(r.markers)) out.markers = r.markers;
    if (legacy) out.legacy = true;
    return out;
  }));
}
