// Package rows: one row per (repo, package), the shape the Packages view, the
// alarms (§7 O8) and the Map read. Pure: no I/O, no clock, no config reads.
// The hub runs it over the merged fleet data; a standalone builder runs the
// same function over its own one-builder data. One code path for rows.
//
//   buildRows(fleetRepos, lanesByFkey, prsByFkey) -> rows
//
// `fleetRepos` are repo blocks as in the builder snapshot `repos` key (§2.9):
// {name, slug, head, packages, workflows, jobMap, ci:{provider, auth, runs},
//  lastTested, untested, branches, conflicts, commits, plans}. Missing pieces
// are tolerated everywhere; a builder that has not polled yet gives a row of
// greys, not a crash.
//
// `lanesByFkey` maps a fleet key ("<builderId>/<name>") to a lane
// ({repo, branch, ...}). It joins a branch to the lane working on it when the
// branch block does not already carry `fkey` (the hub sets it) or a local
// `laneId`.
//
// `prsByFkey` maps a fleet key to the lane's PR summary (pr.mjs: {number,
// state, verdict, checks:{failedNames}, failedJobs?:[{workflow, job}]}).

export const STATUS_ORDER = Object.freeze(['fail', 'running', 'not-run', 'ok', 'none', 'unknown']);
export const LAMP_ORDER = Object.freeze(['crit', 'warn', 'low', 'ok', 'none']);
export const OTHER = '_other';

// ---------------------------------------------------------------- globs
// A small matcher for package path globs (`web/**`, `*.md`, `!web/docs/**`).
// It mirrors the subset §2.3 needs; kept local so rows stay dependency-free.

const reCache = new Map();

function globRe(glob) {
  let re = reCache.get(glob);
  if (re) return re;
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more whole segments; a trailing `**` anything.
        if (glob[i + 2] === '/') { src += '(?:.*/)?'; i += 2; }
        else { src += '.*'; i += 1; }
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp(`^${src}$`);
  if (reCache.size > 2000) reCache.clear();
  reCache.set(glob, re);
  return re;
}

/** True when `file` is matched by `globs` (later `!` globs exclude). */
export function matchesPaths(file, globs) {
  if (!Array.isArray(globs) || typeof file !== 'string') return false;
  let hit = false;
  for (const g of globs) {
    if (typeof g !== 'string' || !g) continue;
    if (g[0] === '!') { if (hit && globRe(g.slice(1)).test(file)) hit = false; }
    else if (!hit && globRe(g).test(file)) hit = true;
  }
  return hit;
}

// ---------------------------------------------------------------- helpers

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const short = (sha) => String(sha || '').slice(0, 7);
const ts = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

function first(order, set) {
  for (const s of order) if (set.has(s)) return s;
  return order[order.length - 1];
}

/** Packages a jobMap entry gates, or '*' for every package. */
function entryCovers(entry, pkg) {
  if (!entry) return false;
  if (entry.packages === '*') return true;
  return arr(entry.packages).includes(pkg);
}

function isIgnored(entry) {
  return !entry || entry.via === 'ignored' || entry.ignored === true;
}

/** jobMap lookup for a job of a run: by `file#name`, then by matrix base or id. */
function lookupJob(jobMap, file, job, workflowJobs) {
  if (!file) return null;
  const name = String(job?.name ?? '');
  const direct = jobMap[`${file}#${name}`];
  if (direct) return direct;
  // Matrix jobs report `test (ubuntu, 20)`; the workflow knows `test`.
  const base = name.replace(/\s*\(.*\)\s*$/, '');
  if (base !== name && jobMap[`${file}#${base}`]) return jobMap[`${file}#${base}`];
  for (const wj of workflowJobs) {
    if (wj.id === name || wj.id === base || wj.name === base) {
      const e = jobMap[`${file}#${wj.name}`] || jobMap[`${file}#${wj.id}`];
      if (e) return e;
    }
  }
  return null;
}

/** Workflow file of a run: `run.file`, else the workflow whose name matches. */
function runFile(run, workflows) {
  if (run?.file) return run.file;
  const w = workflows.find((x) => x.name && x.name === run?.workflow);
  return w ? w.file : null;
}

const ACTIVE = new Set(['in_progress', 'queued', 'requested', 'waiting', 'pending', 'action_required']);
const runActive = (run) => ACTIVE.has(String(run?.status || '').toLowerCase());

/** Verdict of one run job, normalised (a collector may omit `verdict`). */
function jobVerdictOf(job) {
  if (job?.verdict) return job.verdict;
  const st = String(job?.status || '').toLowerCase();
  if (st === 'queued' || st === 'waiting' || st === 'pending' || st === 'requested') return 'queued';
  if (st && st !== 'completed') return 'running';
  const c = String(job?.conclusion || '').toLowerCase();
  if (c === 'success' || c === 'neutral') return 'ok';
  if (c === 'skipped') return 'not-run';
  if (c === 'failure' || c === 'timed_out' || c === 'cancelled' || c === 'startup_failure' || c === 'action_required') return 'fail';
  return 'queued';
}

// ---------------------------------------------------------------- per repo

function ciUnavailable(repo) {
  const ci = repo.ci;
  if (!ci || typeof ci !== 'object') return 'no CI data';
  if (!ci.provider || ci.provider === 'none') return 'CI provider none';
  if (ci.auth === false) return 'CI auth missing';
  if (!repo.slug) return 'no repo slug';
  return null;
}

/**
 * Latest relevant main run per workflow file. A run still going on an old sha
 * (head moved on) is skipped for the newest completed one; a run going on the
 * head sha is kept, it is what "running" means.
 */
function latestRuns(repo, workflows) {
  const byFile = new Map();
  const headSha = repo.head?.sha || null;
  const runs = arr(repo.ci?.runs).slice()
    .sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || (b.attempt || 0) - (a.attempt || 0));
  for (const run of runs) {
    const file = runFile(run, workflows);
    if (!file || byFile.has(file)) continue;
    if (runActive(run) && headSha && run.sha && run.sha !== headSha) continue;
    byFile.set(file, run);
  }
  return byFile;
}

function mainFor(repo, pkg, ctx) {
  const { jobMap, workflows, runsByFile, unavailable } = ctx;
  const headSha = repo.head?.sha || null;
  const tested = obj(obj(repo.lastTested)[pkg]);
  const untestedCommits = Number(obj(repo.untested)[pkg]) || 0;
  const reasons = [];

  // Which workflow files have at least one job gating this package?
  const mappedFiles = new Set(); // files with a non-prOnly job mapped here
  for (const [key, entry] of Object.entries(jobMap)) {
    if (isIgnored(entry) || !entryCovers(entry, pkg)) continue;
    const file = key.slice(0, key.lastIndexOf('#'));
    if (!entry.prOnly) mappedFiles.add(file);
  }

  const jobs = [];
  const flags = new Set();
  const verdicts = [];
  const failed = [];
  const partial = [];

  for (const [file, run] of runsByFile) {
    const wjobs = arr(workflows.find((w) => w.file === file)?.jobs);
    for (const job of arr(run.jobs)) {
      const entry = lookupJob(jobMap, file, job, wjobs);
      if (isIgnored(entry) || !entryCovers(entry, pkg)) continue;
      const verdict = jobVerdictOf(job);
      const prOnly = Boolean(entry.prOnly);
      jobs.push({
        name: job.name ?? null, workflow: run.workflow ?? file, conclusion: job.conclusion ?? null,
        verdict, prOnly, partial: Boolean(job.partial), via: entry.via ?? null,
      });
      if (prOnly) continue; // PR-only jobs never speak for main
      verdicts.push(verdict);
      if (verdict === 'fail') failed.push(job.name);
      if (verdict === 'ok' && job.partial) partial.push(job.name);
    }
    // A run on the head sha that has not listed its jobs yet still counts.
    if (runActive(run) && mappedFiles.has(file) && (!headSha || !run.sha || run.sha === headSha)) {
      flags.add('running');
    }
  }

  let status;
  if (unavailable) {
    status = mappedFiles.size ? 'unknown' : 'none';
    if (status === 'unknown') reasons.push(`CI unknown: ${unavailable}`);
  } else {
    if (verdicts.includes('fail')) flags.add('fail');
    if (verdicts.some((v) => v === 'running' || v === 'queued')) flags.add('running');
    if (verdicts.length && verdicts.every((v) => v === 'not-run')) flags.add('not-run');
    if (untestedCommits > 0) flags.add('not-run');
    if (verdicts.length) flags.add('ok');
    flags.add('none');
    status = first(STATUS_ORDER, flags);
  }

  if (status === 'fail') reasons.push(`main red: ${failed.join(', ')}`);
  if (status === 'running') reasons.push(headSha ? `CI running on ${short(headSha)}` : 'CI running');
  if (status === 'not-run') {
    if (untestedCommits > 0) {
      reasons.push(`${untestedCommits} commit${untestedCommits === 1 ? '' : 's'} to ${pkg} since last tested run`);
    } else reasons.push(`mapped jobs did not run on ${short(headSha) || 'main'}`);
  }
  if (partial.length && (status === 'ok' || status === 'not-run')) {
    reasons.push(`partial: skipped steps in ${partial.join(', ')}`);
  }

  return {
    main: {
      status, sha: headSha, at: repo.head?.at ?? null,
      tested: { sha: tested.sha ?? null, at: tested.at ?? null },
      untestedCommits, jobs,
    },
    reasons,
  };
}

/** Packages a failed PR job blames: names, or '*' for a global job. */
function blamedPackages(repo, ctx, failure) {
  const { jobMap, workflows } = ctx;
  const out = new Set();
  const add = (entry) => {
    if (isIgnored(entry)) return;
    if (entry.packages === '*') out.add('*');
    else for (const p of arr(entry.packages)) out.add(p);
  };
  const name = String(failure.job ?? '');
  if (failure.workflow != null) {
    const w = workflows.find((x) => x.name === failure.workflow || x.file === failure.workflow);
    if (w) {
      const e = lookupJob(jobMap, w.file, { name }, arr(w.jobs));
      if (e) { add(e); return out; }
    }
  }
  // A bare name: a job name anywhere, else a workflow name (run-level fallback).
  let hit = false;
  for (const [key, entry] of Object.entries(jobMap)) {
    const jn = key.slice(key.lastIndexOf('#') + 1);
    if (jn === name || jn === name.replace(/\s*\(.*\)\s*$/, '')) { add(entry); hit = true; }
  }
  if (hit) return out;
  const w = workflows.find((x) => x.name === name || x.file === name);
  if (w) {
    for (const [key, entry] of Object.entries(jobMap)) {
      if (key.startsWith(`${w.file}#`)) add(entry);
    }
  }
  return out;
}

function prFailures(pr) {
  const jobs = arr(pr.failedJobs);
  if (jobs.length) return jobs.map((j) => ({ workflow: j.workflow ?? null, job: j.job ?? j.name ?? '' }));
  return arr(pr.checks?.failedNames).map((n) => ({ workflow: null, job: n }));
}

/** fkey of the lane on a branch, or null for a branch nobody works on. */
function branchFkey(repo, br, lanesByFkey) {
  if (br.fkey) return br.fkey;
  if (br.laneFkey) return br.laneFkey;
  const keys = Object.keys(lanesByFkey);
  if (br.laneId) {
    if (br.via) return `${br.via}/${br.laneId}`;
    const k = keys.find((x) => x.slice(x.indexOf('/') + 1) === br.laneId);
    if (k) return k;
  }
  const k = keys.find((x) => {
    const l = lanesByFkey[x];
    return l && l.branch === br.branch && (!l.repo || l.repo === repo.name || l.repo === repo.slug);
  });
  return k || null;
}

function touches(br, pkg, pkgPaths, unmatched) {
  if (pkg === OTHER) return unmatched.length > 0;
  if (arr(br.packages).includes(pkg)) return true;
  return arr(br.files).some((f) => matchesPaths(f, pkgPaths));
}

function repoRows(repo, lanesByFkey, prsByFkey) {
  const workflows = arr(repo.workflows);
  const jobMap = obj(repo.jobMap);
  const ctx = { jobMap, workflows, runsByFile: latestRuns(repo, workflows), unavailable: ciUnavailable(repo) };
  const packages = arr(repo.packages).filter((p) => p && typeof p.name === 'string' && p.name !== OTHER);

  // Branches, joined to their lane; files outside every package for `_other`.
  const branches = arr(repo.branches).map((br) => {
    const files = arr(br.files);
    const unmatched = files.filter((f) => !packages.some((p) => matchesPaths(f, p.paths)));
    return { br, fkey: branchFkey(repo, br, lanesByFkey), unmatched };
  });
  const byBranch = new Map(branches.map((b) => [b.br.branch, b]));

  const list = packages.map((p) => ({ name: p.name, paths: arr(p.paths) }));
  const otherFiles = [...new Set(branches.flatMap((b) => b.unmatched))].sort();
  if (otherFiles.length) list.push({ name: OTHER, paths: null });

  return list.map(({ name: pkg, paths }) => {
    const { main, reasons } = mainFor(repo, pkg, ctx);

    // Lanes touching the package.
    const lanes = [];
    for (const b of branches) {
      if (!b.fkey || lanes.includes(b.fkey)) continue;
      if (touches(b.br, pkg, paths, b.unmatched)) lanes.push(b.fkey);
    }
    lanes.sort();

    // Their PRs, with the failed jobs that blame this package (or every one).
    const prs = [];
    let redPr = false;
    for (const fkey of lanes) {
      const pr = prsByFkey?.[fkey];
      if (!pr || typeof pr !== 'object') continue;
      if (pr.state && pr.state !== 'OPEN') continue;
      const failedJobs = [];
      if (pr.verdict === 'red') {
        for (const f of prFailures(pr)) {
          const blamed = blamedPackages(repo, ctx, f);
          if (blamed.has('*') || blamed.has(pkg)) failedJobs.push(f.job);
        }
      }
      prs.push({ n: pr.number ?? null, fkey, verdict: pr.verdict ?? 'none', failed: failedJobs });
      if (failedJobs.length) {
        redPr = true;
        reasons.push(`PR #${pr.number ?? '?'} red: ${failedJobs.join(', ')}`);
      }
    }

    // Conflicts: textual from the builders, overlap from the hub.
    const conflicts = { textual: 0, overlap: 0, pairs: [] };
    const seen = new Set();
    for (const c of arr(repo.conflicts)) {
      const a = byBranch.get(c?.a?.branch);
      const aKey = c?.a?.fkey || a?.fkey;
      const bMain = Boolean(c?.b?.main);
      const bKey = bMain ? 'main' : (c?.b?.fkey || byBranch.get(c?.b?.branch)?.fkey);
      if (!aKey || !bKey) continue;
      const files = arr(c.files);
      let relevant;
      if (pkg === OTHER) relevant = files.some((f) => otherFiles.includes(f));
      else if (files.length) relevant = files.some((f) => matchesPaths(f, paths));
      else relevant = lanes.includes(aKey) || lanes.includes(bKey);
      if (!relevant) continue;
      const kind = c.kind === 'overlap' ? 'overlap' : 'textual';
      const id = `${kind}:${[aKey, bKey].sort().join('|')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      conflicts[kind] += 1;
      conflicts.pairs.push([aKey, bKey]);
      if (kind === 'textual') {
        reasons.push(`textual conflict: ${aKey} vs ${bKey}${files.length ? ` on ${files.length} file${files.length === 1 ? '' : 's'}` : ''}`);
      }
    }
    if (conflicts.overlap && !conflicts.textual) {
      reasons.push(`${conflicts.overlap} overlap${conflicts.overlap === 1 ? '' : 's'} between lanes`);
    }

    const commit = obj(obj(repo.commits)[pkg]);
    const plans = { open: 0, partial: 0, done: 0 };
    for (const f of arr(repo.plans?.files)) {
      if (f && f.pkg === pkg && Object.hasOwn(plans, f.state)) plans[f.state] += 1;
    }

    let lamp;
    if (main.status === 'fail') lamp = 'crit';
    else if (redPr || conflicts.textual > 0) lamp = 'warn';
    else if (main.status === 'not-run' || main.status === 'running' || conflicts.overlap > 0) lamp = 'low';
    else if (main.status === 'ok') lamp = 'ok';
    else lamp = 'none';

    const row = {
      repo: repo.name ?? repo.slug ?? null, package: pkg, main, lanes, prs, conflicts,
      lastChange: { sha: commit.lastSha ?? null, at: commit.lastAt ?? null },
      commits7d: Number(commit.n7d) || 0,
      plans, lamp, reasons,
    };
    if (pkg === OTHER) row.files = otherFiles;
    return row;
  });
}

/**
 * Rows for every package of every repo, in repo order then package order
 * (`_other` last in its repo). Sorting for display is the view's job.
 */
export function buildRows(fleetRepos, lanesByFkey = {}, prsByFkey = {}) {
  const lanes = obj(lanesByFkey);
  const prs = obj(prsByFkey);
  const rows = [];
  for (const repo of arr(fleetRepos)) {
    if (!repo || typeof repo !== 'object') continue;
    rows.push(...repoRows(repo, lanes, prs));
  }
  return rows;
}

/** Lamp severity rank, 0 = worst; for sorting rows. */
export function lampRank(lamp) {
  const i = LAMP_ORDER.indexOf(lamp);
  return i < 0 ? LAMP_ORDER.length : i;
}
