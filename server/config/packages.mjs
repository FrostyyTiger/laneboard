// Config fragment: repos, packages, CI per package, plans (fleet plan §6, P2).
//
//   packages   collection knobs for the Packages view (§6 2.2):
//              autodetect      detect packages when a repo has no packages[]
//              mainRef         the ref lanes are compared against
//              branchWindowDays, maxBranches   which remote branches count
//              fetch           'none' (refs as they are) | 'mirror' (a bare
//                              mirror under cacheDir, fetched by laneboard)
//              fetchEverySec, ciEverySec, staleDays, staleBehind
//              cacheDir        $XDG_CACHE_HOME/laneboard/git, else
//                              ~/.cache/laneboard/git; a leading `~/` is
//                              expanded, a relative path is refused
//   plans      {globs, statusLine (first capture group = the state word),
//              states: {open, partial, done, deferred: [words]}}
//
// The `repos[]` entries themselves are a core key (server/config.mjs); this
// fragment only validates the §6 additions on each entry:
//   ci?: {provider: 'gh'|'none', repo?: 'owner/name', collect?: true} | null
//   packages?: [{name, paths: [globs], jobs?: [names], workflow?, plans?: [globs]}]
//   global?: [job names], ignoreJobs?: [job names]
// The legacy `ci.repo` (a directory name) is normalised at run time by
// server/packages/repos.mjs#resolveRepos, not here.
//
// Every default leaves an old config loading unchanged. This file must not
// import server/config.mjs (see the fragment notes there).
import os from 'node:os';
import path from 'node:path';

import { globError } from '../packages/glob.mjs';
import { defaultCacheDir } from '../packages/gitenv.mjs';

/**
 * The CI provider names a `repos[].ci.provider` accepts. Kept in step with
 * PROVIDERS.ci in server/config.mjs (which this file may not import); the
 * test asserts the two agree.
 */
export const CI_PROVIDERS = Object.freeze(['none', 'gh']);
export const FETCH_MODES = Object.freeze(['none', 'mirror']);
export const SLUG_RX = /^[\w.-]+\/[\w.-]+$/;
export const MAX_BRANCHES_CAP = 500;
export const MIN_EVERY_SEC = 30;

export const DEFAULT_STATUS_LINE = '^\\*\\*Plan status:\\*\\*\\s*`?([A-Z][A-Z-]+)';

export function defaults() {
  return {
    packages: {
      autodetect: true,
      mainRef: 'origin/main',
      branchWindowDays: 14,
      maxBranches: 40,
      fetch: 'none',
      fetchEverySec: 300,
      cacheDir: defaultCacheDir(),
      ciEverySec: 120,
      staleDays: 7,
      staleBehind: 50,
    },
    plans: {
      globs: ['docs/plans/**/*.md'],
      statusLine: DEFAULT_STATUS_LINE,
      states: {
        open: ['OPEN', 'READY', 'PROPOSAL', 'IN-PROGRESS'],
        partial: ['PARTIAL'],
        done: ['DONE', 'SUPERSEDED', 'DECIDED'],
        deferred: ['DEFERRED'],
      },
    },
  };
}

export function fromEnv() {
  return {};
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v !== '';
const J = (v) => JSON.stringify(v);

/** Expand a leading `~/` in packages.cacheDir. Tolerates wrong types. */
export function finalize(c) {
  const p = c.packages;
  if (isObj(p) && typeof p.cacheDir === 'string') {
    if (p.cacheDir === '~') p.cacheDir = os.homedir();
    else if (p.cacheDir.startsWith('~/')) p.cacheDir = path.join(os.homedir(), p.cacheDir.slice(2));
  }
  return c;
}

/** null when `ref` is safe to hand to git as one argv entry, else why. */
export function refProblem(ref) {
  if (!isStr(ref)) return 'must be a non-empty string';
  if (ref.startsWith('-')) return 'must not start with "-"';
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(ref) || ref.includes('..') || ref.includes('@{')) return 'is not a valid git ref name';
  return null;
}

/** true when `src` compiles and has at least one capture group. */
export function statusLineProblem(src) {
  if (typeof src !== 'string' || src === '') return 'must be a non-empty regular expression';
  let re;
  try { re = new RegExp(src); } catch (err) { return `is not a valid regular expression: ${err.message}`; }
  // A pattern's group count, without needing it to match anything.
  const groups = new RegExp(`${re.source}|`).exec('').length - 1;
  if (groups < 1) return 'needs a capture group for the state word';
  return null;
}

function checkStrList(v, where, bad, { nonEmpty = false } = {}) {
  if (!Array.isArray(v) || v.some((x) => !isStr(x))) bad(`${where} must be a list of non-empty strings, got ${J(v)}`);
  if (nonEmpty && !v.length) bad(`${where} must not be empty`);
}

function checkGlobs(v, where, bad, opts) {
  checkStrList(v, where, bad, opts);
  for (const g of v) {
    const why = globError(g);
    if (why) bad(`${where} entry ${J(g)} is not a valid glob: ${why}`);
  }
}

function checkPackagesBlock(p, bad) {
  if (!isObj(p)) bad('packages must be an object');
  if (typeof p.autodetect !== 'boolean') bad(`packages.autodetect must be true or false, got ${J(p.autodetect)}`);
  const ref = refProblem(p.mainRef);
  if (ref) bad(`packages.mainRef ${ref}, got ${J(p.mainRef)}`);
  if (!isNum(p.branchWindowDays) || p.branchWindowDays <= 0) bad(`packages.branchWindowDays must be a positive number of days, got ${J(p.branchWindowDays)}`);
  if (!Number.isInteger(p.maxBranches) || p.maxBranches < 1 || p.maxBranches > MAX_BRANCHES_CAP) {
    bad(`packages.maxBranches must be an integer from 1 to ${MAX_BRANCHES_CAP}, got ${J(p.maxBranches)}`);
  }
  if (!FETCH_MODES.includes(p.fetch)) bad(`packages.fetch must be one of ${FETCH_MODES.join(', ')}, got ${J(p.fetch)}`);
  for (const k of ['fetchEverySec', 'ciEverySec']) {
    if (!isNum(p[k]) || p[k] < MIN_EVERY_SEC) bad(`packages.${k} must be at least ${MIN_EVERY_SEC} seconds, got ${J(p[k])}`);
  }
  if (typeof p.cacheDir !== 'string' || !path.isAbsolute(p.cacheDir)) bad(`packages.cacheDir must be an absolute path (or start with ~/), got ${J(p.cacheDir)}`);
  if (!isNum(p.staleDays) || p.staleDays <= 0) bad(`packages.staleDays must be a positive number of days, got ${J(p.staleDays)}`);
  if (!Number.isInteger(p.staleBehind) || p.staleBehind < 0) bad(`packages.staleBehind must be a non-negative integer, got ${J(p.staleBehind)}`);
}

function checkPlansBlock(pl, bad) {
  if (!isObj(pl)) bad('plans must be an object');
  checkGlobs(pl.globs, 'plans.globs', bad);
  const why = statusLineProblem(pl.statusLine);
  if (why) bad(`plans.statusLine ${why}`);
  if (!isObj(pl.states)) bad('plans.states must be an object of state -> [words]');
  for (const [k, words] of Object.entries(pl.states)) checkStrList(words, `plans.states.${k}`, bad);
}

function checkRepo(r, i, bad) {
  const at = `repos[${i}] (${J(r.name)})`;
  if (typeof r.name !== 'string') bad(`${at}.name must be a string`);
  if (r.path !== undefined && !isStr(r.path)) bad(`${at}.path must be a non-empty string`);
  if (r.ci !== undefined && r.ci !== null) {
    const ci = r.ci;
    if (!isObj(ci)) bad(`${at}.ci must be an object {provider, repo?, collect?} or null`);
    if (ci.provider !== undefined && !CI_PROVIDERS.includes(ci.provider)) {
      bad(`${at}.ci.provider must be one of ${CI_PROVIDERS.join(', ')}, got ${J(ci.provider)}`);
    }
    if (ci.repo !== undefined && (typeof ci.repo !== 'string' || !SLUG_RX.test(ci.repo) || ci.repo.split('/').some((s) => /^\.+$/.test(s)))) {
      bad(`${at}.ci.repo must be an "owner/name" slug matching ${SLUG_RX}, got ${J(ci.repo)}`);
    }
    if (ci.collect !== undefined && typeof ci.collect !== 'boolean') bad(`${at}.ci.collect must be true or false, got ${J(ci.collect)}`);
  }
  if (r.packages !== undefined) {
    if (!Array.isArray(r.packages)) bad(`${at}.packages must be a list of {name, paths}`);
    const seen = new Set();
    r.packages.forEach((p, j) => {
      const pat = `${at}.packages[${j}]`;
      if (!isObj(p)) bad(`${pat} must be an object {name, paths}`);
      if (!isStr(p.name)) bad(`${pat}.name must be a non-empty string`);
      if (seen.has(p.name)) bad(`${pat}.name ${J(p.name)} is used twice in this repo`);
      seen.add(p.name);
      checkGlobs(p.paths, `${pat}.paths`, bad, { nonEmpty: true });
      if (p.jobs !== undefined) checkStrList(p.jobs, `${pat}.jobs`, bad);
      if (p.workflow !== undefined && !isStr(p.workflow)) bad(`${pat}.workflow must be a workflow file name`);
      if (p.plans !== undefined) checkGlobs(p.plans, `${pat}.plans`, bad);
    });
  }
  for (const k of ['global', 'ignoreJobs']) {
    if (r[k] !== undefined) checkStrList(r[k], `${at}.${k}`, bad);
  }
}

export function validate(c, bad) {
  checkPackagesBlock(c.packages, bad);
  checkPlansBlock(c.plans, bad);
  // The core already refused a non-list and nameless entries.
  if (Array.isArray(c.repos)) c.repos.forEach((r, i) => checkRepo(r, i, bad));
}
