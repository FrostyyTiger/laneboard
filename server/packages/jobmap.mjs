// Job -> package mapping (fleet §6 2.5, P4). Pure.
//
// mapJobs(packages, workflows, repoCfg) -> {['<file>#<job name>']: {packages, via, prOnly}}
// `packages` is a list of package names or '*' (gates every package). Order,
// first hit wins:
//   1. config   repoCfg.packages[].jobs (optionally scoped by `workflow`),
//               repoCfg.global -> '*', repoCfg.ignoreJobs -> dropped from the map
//   -  ignored  names like promote/deploy/release: {packages:[], via:'ignored', ignored:true}
//   2. name     package token sequence inside the job name or id, longest package first
//   3. workdir  every working-directory falls under exactly one package
//   4. gate     `needs.<job>.outputs.<out>` where <out> (`_` -> `-`) names a package
//   5. paths    dorny filters of the gates / the job's own gated steps, else the
//               workflow `on.*.paths`; a workflow whose paths all lie in one package
//               sends every remaining job there
//   6. default  '*'
// Every hit is visible as `via` so a wrong guess can be spotted and overridden.
import { globPrefix, matchAny } from './glob.mjs';

export const IGNORED_JOB = /^(promote|deploy|release)\b/i;
const SEP = /[-_\s()/:,]+/;
const EXPR = /\$\{\{[\s\S]*?\}\}/g;

const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);

/** Lowercase tokens of a job or package name (`${{ … }}` expressions dropped). */
export function tokens(s) {
  return str(s).replace(EXPR, ' ').toLowerCase().split(SEP).filter(Boolean);
}

const normName = (s) => str(s).toLowerCase().replace(/_/g, '-');

function containsSeq(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The job key used everywhere (`ci.yml#web-check`). */
export const jobKey = (file, name) => `${file}#${name}`;

/** Matrix jobs report `name (a, b)`; reusable calls `caller / callee`. */
const baseName = (n) => str(n).replace(/\s*\(.*\)\s*$/, '');

function wfMatches(scope, file) {
  if (!scope) return true;
  const s = str(scope).replace(/^.*\//, '');
  return s === file;
}

// Does a configured job reference (`name`, `file#name`) mean this job?
function refMatches(ref, file, job) {
  const r = str(ref).trim();
  if (!r) return false;
  const hash = r.indexOf('#');
  if (hash >= 0) {
    if (r.slice(0, hash).replace(/^.*\//, '') !== file) return false;
    return refMatches(r.slice(hash + 1), file, job);
  }
  return r === job.name || r === job.id || r === baseName(job.name);
}

// "dir/" form of a literal prefix, so `web` does not overlap `web-admin/`.
function asDir(p) {
  return p === '' || p.endsWith('/') ? p : p + '/';
}

function prefixesOverlap(a, b) {
  const x = asDir(a), y = asDir(b);
  return x.startsWith(y) || y.startsWith(x);
}

function positive(globs) {
  return arr(globs).filter((g) => typeof g === 'string' && g && !g.startsWith('!'));
}

/**
 * Packages a list of path globs touches, or '*' when a glob can match anywhere
 * (`**\/*.py`, `*.toml`). Globs under no package (`.github/…`) add nothing.
 */
export function packagesForGlobs(packages, globs) {
  const hit = new Set();
  for (const g of positive(globs)) {
    let p;
    try { p = globPrefix(g); } catch { continue; }
    if (p === '') return '*';
    for (const pkg of packages) {
      if (positive(pkg.paths).some((q) => { try { return prefixesOverlap(p, globPrefix(q)); } catch { return false; } })) hit.add(pkg.name);
    }
  }
  return [...hit];
}

// The one package a working directory lies in, or null (none or ambiguous).
function packageForDir(packages, dir) {
  const d = asDir(dir);
  const hits = packages.filter((pkg) => {
    try { return matchAny(arr(pkg.paths), d + '__probe__'); } catch { return false; } // a file inside the dir
  });
  if (hits.length <= 1) return hits[0]?.name ?? null;
  // Nested packages (`web/` and `web/admin/`): the deepest prefix wins, if unique.
  const depth = (pkg) => Math.max(0, ...positive(pkg.paths).map((q) => { try { const p = globPrefix(q); return d.startsWith(asDir(p)) ? p.length : 0; } catch { return 0; } }));
  const best = Math.max(...hits.map(depth));
  const top = hits.filter((h) => depth(h) === best);
  return top.length === 1 && best > 0 ? top[0].name : null;
}

function byName(packages, jobTokens) {
  // Longest package name first (by tokens, then characters): `web-admin` before `web`.
  const sorted = [...packages]
    .map((p) => ({ name: p.name, t: tokens(p.name) }))
    .filter((p) => p.t.length)
    .sort((a, b) => b.t.length - a.t.length || b.name.length - a.name.length);
  for (const p of sorted) for (const t of jobTokens) if (containsSeq(t, p.t)) return p.name;
  return null;
}

function configHit(file, job, repoCfg) {
  for (const ref of arr(own(repoCfg, 'ignoreJobs'))) if (refMatches(ref, file, job)) return { drop: true };
  for (const ref of arr(own(repoCfg, 'global'))) if (refMatches(ref, file, job)) return { packages: '*' };
  const names = [];
  for (const pkg of arr(own(repoCfg, 'packages'))) {
    if (!isObj(pkg) || !pkg.name || !wfMatches(pkg.workflow, file)) continue;
    if (arr(pkg.jobs).some((ref) => refMatches(ref, file, job))) names.push(pkg.name);
  }
  return names.length ? { packages: [...new Set(names)] } : null;
}

/** The single package a workflow's `on.*.paths` all lie in, or null. */
function workflowPackage(packages, wf) {
  const globs = positive(own(own(wf, 'on'), 'paths'));
  if (!globs.length) return null;
  const hit = packagesForGlobs(packages, globs);
  return Array.isArray(hit) && hit.length === 1 ? hit[0] : null;
}

function gateGlobs(job, jobsById) {
  const globs = [];
  for (const g of arr(job.gates)) {
    const src = jobsById.get(g.job);
    const f = own(src?.filters, g.output) ?? own(src?.stepFilters, g.output);
    if (f) globs.push(...f);
  }
  for (const g of arr(job.stepGates)) {
    const f = own(job.stepFilters, g.output);
    if (f) globs.push(...f);
  }
  return globs;
}

function mapOne(packages, wf, job, jobsById, repoCfg, wfPkg) {
  const file = str(wf.file);
  const prOnly = Boolean(job.prOnly);
  const cfg = configHit(file, job, repoCfg);
  if (cfg?.drop) return null;
  if (cfg) return { packages: cfg.packages, via: 'config', prOnly };
  if (IGNORED_JOB.test(str(job.name)) || IGNORED_JOB.test(str(job.id))) {
    return { packages: [], via: 'ignored', ignored: true, prOnly };
  }

  const named = byName(packages, [tokens(job.name), tokens(job.id)]);
  if (named) return { packages: [named], via: 'name', prOnly };

  const dirs = arr(job.workingDirs).filter(Boolean);
  if (dirs.length) {
    const hits = dirs.map((d) => packageForDir(packages, d));
    if (hits.every(Boolean)) return { packages: [...new Set(hits)], via: 'workdir', prOnly };
  }

  const gated = [];
  let unnamedGate = false;
  for (const g of arr(job.gates)) {
    const want = normName(g.output);
    const pkg = packages.find((p) => normName(p.name) === want);
    if (pkg) gated.push(pkg.name); else unnamedGate = true;
  }
  if (gated.length && !unnamedGate) return { packages: [...new Set(gated)], via: 'gate', prOnly };

  if (wfPkg) return { packages: [wfPkg], via: 'paths', prOnly };
  const globs = gateGlobs(job, jobsById);
  const byGate = globs.length ? packagesForGlobs(packages, globs) : [];
  if (byGate === '*') return { packages: '*', via: 'paths', prOnly };
  if (byGate.length) return { packages: [...new Set([...gated, ...byGate])], via: 'paths', prOnly };
  if (!globs.length && !unnamedGate) {
    const byWf = packagesForGlobs(packages, own(own(wf, 'on'), 'paths'));
    if (Array.isArray(byWf) && byWf.length) return { packages: byWf, via: 'paths', prOnly };
  }
  return { packages: '*', via: unnamedGate ? 'gate' : 'default', prOnly };
}

/**
 * Map every job of every scanned workflow onto packages.
 * `packages`: [{name, paths}]; `workflows`: scanWorkflow() results;
 * `repoCfg`: the repo's config entry ({packages[].jobs, global, ignoreJobs}).
 */
export function mapJobs(packages, workflows, repoCfg = {}) {
  const pkgs = arr(packages).filter((p) => isObj(p) && typeof p.name === 'string' && p.name && p.name !== '_other');
  const out = {};
  for (const wf of arr(workflows)) {
    if (!isObj(wf) || !wf.file) continue;
    const jobs = arr(wf.jobs).filter(isObj);
    const jobsById = new Map(jobs.map((j) => [j.id, j]));
    const wfPkg = workflowPackage(pkgs, wf);
    for (const job of jobs) {
      const e = mapOne(pkgs, wf, job, jobsById, repoCfg, wfPkg);
      if (e) out[jobKey(wf.file, job.name)] = e;
    }
  }
  return out;
}
