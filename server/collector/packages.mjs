// The packages collector (fleet §6 2.13, P9): per repo, CI per job on main,
// lane -> package touches over every open branch, textual conflict
// prediction, plan status, stale branches. The orchestrator only: every piece
// of logic lives in server/packages/*.mjs; this file decides when each runs and
// assembles the per-repo block of the builder snapshot key `repos` (§2.9):
//
//   {name, slug, mainRef, head:{sha, at}, packages, workflows, jobMap,
//    ci:{provider, auth, at, rate:{remaining, low}, runs:[... jobs]},
//    lastTested, untested, branches, conflicts, deps, commits, plans, stale,
//    refsAt, warnings}
//
// Cadence (all sequential, one repo and one git/gh call at a time):
//   git     every `lanePollMs` (first pass 50 s after start, offset from the
//           lanes/progress/markers/pr passes), and whenever main moves
//   ci      every `packages.ciEverySec`; 10 min when gh is not logged in or the
//           REST budget is below 10 % (`ci.rate.low`)
//   fetch   `packages.fetch: 'mirror'` only, every `packages.fetchEverySec`
//
// Budget (per repo): one `gh run list` per CI pass, `gh run view --json jobs`
// only for runs that are new or not yet completed (a completed run's jobs are
// immutable: kept in memory under (runId, attempt) and in SQLite `ci_jobs`),
// one `--workflow <file> --limit 1` per workflow not seen in the 30-run window
// every 15 min, `gh api rate_limit` every 10 min.
//
// Display-only: nothing here writes to a forge, fetches the user's checkout,
// merges, or deletes. Every git call that may write objects (merge-tree) runs
// in the scratch env (gitenv.mjs).
import { log } from '../log.mjs';
import * as db from '../db.mjs';
import * as ghCi from '../providers/ci/gh.mjs';
import * as noneCi from '../providers/ci/none.mjs';
import { resolveRepos } from '../packages/repos.mjs';
import { detectPackagesAsync, createDetectCache } from '../packages/detect.mjs';
import { readWorkflows } from '../packages/workflow-scan.mjs';
import { mapJobs } from '../packages/jobmap.mjs';
import { withVerdicts } from '../packages/jobs.mjs';
import { collectBranches, resolveCommit, isSha, Lru, packagesFor as packagesForFiles } from '../packages/branches.mjs';
import { runGit, scratchEnv, withEnv, syncMirror, mirrorDir, mirrorRef, defaultCacheDir } from '../packages/gitenv.mjs';
import { predictConflicts, textualAvailable, pairKey } from '../packages/conflicts.mjs';
import { dependencies } from '../packages/order.mjs';
import { staleBranches } from '../packages/stale.mjs';
import { readPlans } from '../packages/plans.mjs';
import { toPathspec } from '../packages/glob.mjs';
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60 * 1000;
const AUTH_BACKOFF_MS = 10 * MIN;
const RATE_EVERY_MS = 10 * MIN;
const PROBE_EVERY_MS = 15 * MIN;
const COMMITS_EVERY_MS = 5 * MIN;
const LOW_RATE_FRAC = 0.1;
const RUN_LIMIT = 30;
const FIRST_PASS_MS = 50_000;
const JOB_CACHE_MAX = 2000;
const COUNT_CACHE_MAX = 5000;

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `origin/main` -> `main` (the branch name gh filters runs by). */
export function branchOf(mainRef) {
  const s = String(mainRef || 'origin/main');
  for (const p of ['refs/remotes/origin/', 'origin/', 'refs/heads/']) if (s.startsWith(p)) return s.slice(p.length);
  return s;
}

/** Parse `git log --format=%x1e%H%x09%ct --name-only -z`: `[{sha, at, files[]}]`. */
export function parseLogNames(stdout) {
  const out = [];
  for (const chunk of String(stdout ?? '').split('\x1e')) {
    if (!chunk) continue;
    const parts = chunk.split('\0');
    const [sha, ct] = String(parts.shift() || '').split('\t');
    if (!isSha(sha)) continue;
    const files = parts.map((f) => f.replace(/^\n/, '')).filter(Boolean);
    out.push({ sha, at: Number(ct) * 1000 || null, files });
  }
  return out;
}

/** The jobMap entry for one job of a run (by `file#name`, then the matrix base name). */
function jobEntry(jobMap, file, name) {
  if (!file) return null;
  const n = String(name ?? '');
  return jobMap[`${file}#${n}`] ?? jobMap[`${file}#${n.replace(/\s*\(.*\)\s*$/, '')}`] ?? null;
}

const covers = (entry, pkg) => Boolean(entry) && !entry.ignored && entry.via !== 'ignored'
  && !entry.prOnly && (entry.packages === '*' || arr(entry.packages).includes(pkg));

/**
 * Per package, the newest main run in which a job mapped to it actually ran
 * green (verdict ok, partial or not): `{[pkg]: {sha, at, runId}}`. Pure.
 */
export function lastTestedOf(packages, runs, jobMap) {
  const out = {};
  const sorted = arr(runs).slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const p of arr(packages)) {
    for (const run of sorted) {
      if (!isSha(run.sha)) continue;
      if (arr(run.jobs).some((j) => j.verdict === 'ok' && covers(jobEntry(jobMap, run.file, j.name), p.name))) {
        out[p.name] = { sha: run.sha, at: run.updatedAt ?? run.createdAt ?? null, runId: run.id };
        break;
      }
    }
  }
  return out;
}

/** The snapshot shape of a scanned workflow. */
function workflowOut(w) {
  return { file: w.file, name: w.name, jobs: arr(w.jobs).map((j) => ({ id: j.id, name: j.name, prOnly: Boolean(j.prOnly) })) };
}

/** The snapshot shape of one run job. */
function jobOut(j) {
  return {
    id: j.id ?? null, name: j.name ?? null, status: j.status ?? null, conclusion: j.conclusion ?? null,
    verdict: j.verdict, partial: Boolean(j.partial), skippedNames: arr(j.skippedNames),
  };
}

/** Signature of a block for change detection: `ci.at` alone never counts as a change. */
function signature(block) {
  return JSON.stringify({ ...block, ci: block.ci ? { ...block.ci, at: null } : block.ci });
}

/**
 * Create a collector. Everything with a side effect is injectable for tests:
 *   config       the built config (repos, packages, plans, lanePollMs, ...)
 *   resolve      (config) -> Promise<repos> (default: repos.mjs#resolveRepos)
 *   providerFor  (name) -> CI provider module (default gh / none)
 *   run          (cmd, args, opts) -> util.run-shaped result (default: gitenv.runGit for git)
 *   jobsStore    {get({runId, attempt, slug}), put({runId, attempt, slug, jobs})} (default: db ci_jobs)
 *   worktrees    () -> [{id, root}] (lanes.knownWorktrees)
 *   isLive       (branch) -> bool, a branch with a live session (never stale)
 *   hasRecord    (branch) -> bool, a launched lane with a record (stale -> retire)
 *   onChange     (repoName, block) when a repo's block changed
 *   now          () -> ms
 */
export function createCollector(opts = {}) {
  const config = opts.config ?? {};
  const resolve = opts.resolve ?? ((c) => resolveRepos(c));
  const providerFor = opts.providerFor ?? ((name) => (name === 'gh' ? ghCi : noneCi));
  const run = opts.run ?? ((cmd, args, o) => runGit(args, o));
  const jobsStore = opts.jobsStore ?? { get: db.ciJobsGet, put: db.ciJobsPut };
  const worktrees = opts.worktrees ?? (() => []);
  const isLive = opts.isLive ?? (() => false);
  const hasRecord = opts.hasRecord ?? (() => false);
  const onChange = opts.onChange ?? (() => {});
  const now = opts.now ?? Date.now;

  const pk = () => ({
    autodetect: true, mainRef: 'origin/main', branchWindowDays: 14, maxBranches: 40, fetch: 'none',
    fetchEverySec: 300, cacheDir: defaultCacheDir(), ciEverySec: 120, staleDays: 7, staleBehind: 50,
    ...(isObj(config.packages) ? config.packages : {}),
  });
  const lanePollMs = () => Number(config.lanePollMs) > 0 ? Number(config.lanePollMs) : 60_000;

  const states = new Map(); // repo name -> per-repo state
  const detectCache = createDetectCache();
  const jobCache = new Lru(JOB_CACHE_MAX); // `${slug}:${id}:${attempt}` -> jobs (completed runs)
  const countCache = new Lru(COUNT_CACHE_MAX); // untested / last-change counts by sha
  let blocks = []; // last assembled blocks, config order
  let chain = Promise.resolve();
  let timer = null;
  let firstTimer = null;
  let passes = 0;
  let lastError = null;
  let lastPassAt = null;
  let textual = null;

  function serial(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  function stateFor(repo) {
    let st = states.get(repo.name);
    if (!st) {
      st = {
        repo, mainSha: null, headAt: null, packages: [], workflows: [], workflowsFull: [], jobMap: {},
        branches: [], refsAt: null, conflicts: [], conflictSeen: new Map(), deps: [],
        commits: {}, commitsAt: 0, commitsSha: null, plans: { counts: {}, files: [] }, stale: [],
        ci: null, ciNextAt: 0, rate: { remaining: null, limit: null, low: false }, rateAt: 0,
        probeAt: new Map(), gitAt: 0, warnings: [], sig: null, block: null,
      };
      states.set(repo.name, st);
    }
    st.repo = repo;
    return st;
  }

  // --- git ------------------------------------------------------------------

  async function gitPass(st, env, force) {
    const p = pk();
    const r = st.repo;
    const warnings = [];
    const mirror = p.fetch === 'mirror' && fs.existsSync(path.join(mirrorDir(r.name, p.cacheDir), 'HEAD'))
      ? mirrorDir(r.name, p.cacheDir) : null;
    const mainSha = mirror ? await resolveCommit(mirror, mirrorRef(p.mainRef)) : await resolveCommit(r.dir, p.mainRef, env);
    if (!mainSha) {
      warnings.push(`cannot resolve ${p.mainRef}`);
      st.mainSha = null;
      st.gitWarnings = warnings;
      return;
    }
    const moved = mainSha !== st.mainSha;
    if (!force && !moved && now() - st.gitAt < lanePollMs()) return;
    st.gitAt = now();
    const runE = (cmd, args, o = {}) => run(cmd, args, { ...o, env: withEnv(env) });
    const git = (args, o = {}) => runE('git', ['-C', r.dir, ...args], { timeout: 10_000, ...o });

    if (moved || st.headAt == null) {
      const t = await git(['show', '-s', '--format=%ct', mainSha]);
      st.headAt = t.ok ? Number(t.stdout.trim()) * 1000 || null : null;
    }
    st.mainSha = mainSha;

    // Packages: configured, else auto-detected at main (cached by (repo, mainSha)).
    if (Array.isArray(r.packages) && r.packages.length) {
      st.packages = r.packages.map((x) => ({ name: x.name, paths: arr(x.paths), source: 'config', kind: 'config' }));
    } else if (p.autodetect !== false) {
      const list = await detectCache.get(r.name, mainSha, async () => {
        const ls = await git(['ls-tree', '-r', '-z', '--name-only', mainSha], { maxBuffer: 64 * 1024 * 1024 });
        if (!ls.ok) return [];
        const tree = ls.stdout.split('\0').filter(Boolean);
        return detectPackagesAsync(tree, async (f) => {
          const s = await git(['show', `${mainSha}:${f}`], { maxBuffer: 4 * 1024 * 1024 });
          return s.ok ? s.stdout : null;
        });
      });
      st.packages = arr(list).map((x) => ({ name: x.name, paths: x.paths, source: 'auto', kind: x.kind }));
    } else {
      st.packages = [];
    }

    // Workflows at main, and the job -> package map.
    st.workflowsFull = await readWorkflows({ cwd: r.dir, ref: mainSha, sha: mainSha, run: runE });
    for (const w of st.workflowsFull) for (const x of arr(w.warnings)) warnings.push(`${w.file}: ${x}`);
    st.workflows = st.workflowsFull.map(workflowOut);
    st.jobMap = mapJobs(st.packages, st.workflowsFull, r);

    // Branches and what they touch.
    const wts = (() => { try { return arr(worktrees()); } catch { return []; } })();
    const br = await collectBranches({ name: r.name, dir: r.dir, packages: st.packages }, {
      mainRef: p.mainRef, branchWindowDays: p.branchWindowDays, maxBranches: p.maxBranches,
      fetch: p.fetch, cacheDir: p.cacheDir, worktrees: wts, now: now(),
    });
    warnings.push(...arr(br.errors));
    st.refsAt = br.refsAt ?? null;
    st.branches = arr(br.branches);

    // Conflicts (textual with git >= 2.38, else overlap). `at` is when a pair
    // was first seen, so an unchanged conflict does not look new every pass.
    const pc = await predictConflicts({ name: r.name, dir: r.dir }, { branches: st.branches, mainSha },
      { env, cacheDir: p.cacheDir, now: now() });
    warnings.push(...arr(pc.errors));
    const seen = new Map();
    st.conflicts = arr(pc.conflicts).map((c) => {
      const key = `${c.kind}:${c.b.main ? `${c.a.sha}:main` : pairKey(c.a.sha, c.b.sha)}`;
      const at = st.conflictSeen.get(key) ?? c.at ?? now();
      seen.set(key, at);
      return { ...c, at };
    });
    st.conflictSeen = seen;

    // Ancestry between local lane heads (merge-order rule 1; the hub ranks).
    st.deps = await dependencies(r.dir, st.branches.filter((b) => b.local), { env });

    // Commits per package over the last 7 days (and the last change of each).
    if (st.commitsSha !== mainSha || now() - st.commitsAt >= COMMITS_EVERY_MS) {
      st.commits = await commitsPass(st, git, mainSha);
      st.commitsSha = mainSha;
      st.commitsAt = now();
    }

    // Plan status.
    st.plans = await readPlans({ dir: r.dir, packages: st.packages }, config.plans ?? {}, { ref: mainSha, run: runE });

    // Stale branches (suggestions only; the hub recomputes with fleet sessions).
    st.stale = staleBranches(st.branches.map((b) => ({ ...b, laneFkey: null })), mainSha, {
      staleDays: p.staleDays, staleBehind: p.staleBehind, now: now(),
      isLive: (b) => call(isLive, b), hasRecord: (b) => call(hasRecord, b),
    }).map((s) => {
      const b = st.branches.find((x) => x.sha === s.sha && x.branch === s.branch);
      return { ...s, laneFkey: null, laneId: b?.laneId ?? null };
    });
    st.gitWarnings = warnings;
  }

  async function commitsPass(st, git, mainSha) {
    const out = {};
    for (const p of st.packages) out[p.name] = { n7d: 0, lastAt: null, lastSha: null };
    const lg = await git(['-c', 'core.quotePath=false', 'log', '--since=7.days', '--no-renames',
      '--format=%x1e%H%x09%ct', '--name-only', '-z', mainSha], { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
    const commits = lg.ok ? parseLogNames(lg.stdout) : [];
    for (const c of commits) {
      for (const name of packagesForFiles(c.files, st.packages)) {
        const e = out[name];
        e.n7d += 1;
        if (e.lastAt == null || (c.at ?? 0) > e.lastAt) { e.lastAt = c.at; e.lastSha = c.sha; }
      }
    }
    // Older last change: one `log -1 -- <pathspec>` per quiet package, cached by main sha.
    for (const p of st.packages) {
      const e = out[p.name];
      if (e.lastSha || !p.paths.length) continue;
      const key = `last:${st.repo.name}:${mainSha}:${p.name}`;
      let hit = countCache.get(key);
      if (hit === undefined) {
        const r = await git(['log', '-1', '--format=%H%x09%ct', mainSha, ...toPathspec(p.paths)]);
        const [sha, ct] = r.ok ? r.stdout.trim().split('\t') : [];
        hit = isSha(sha) ? { sha, at: Number(ct) * 1000 || null } : null;
        if (r.ok) countCache.set(key, hit);
      }
      if (hit) { e.lastSha = hit.sha; e.lastAt = hit.at; }
    }
    return out;
  }

  /** `untested[pkg]`: commits touching pkg since its last tested run, cached by sha pair. */
  async function untestedPass(st, env, lastTested) {
    const out = {};
    if (!st.mainSha) return out;
    for (const p of st.packages) {
      const t = lastTested[p.name];
      if (!t || !isSha(t.sha) || !p.paths.length) continue;
      if (t.sha === st.mainSha) { out[p.name] = 0; continue; }
      const key = `untested:${st.repo.name}:${st.mainSha}:${t.sha}:${p.name}`;
      let n = countCache.get(key);
      if (n === undefined) {
        const r = await run('git', ['-C', st.repo.dir, 'rev-list', '--count', `${t.sha}..${st.mainSha}`, ...toPathspec(p.paths)],
          { timeout: 10_000, env: withEnv(env) });
        if (!r.ok) continue; // the tested sha is not here (yet): unknown, not zero
        n = Number(r.stdout.trim()) || 0;
        countCache.set(key, n);
      }
      out[p.name] = n;
    }
    return out;
  }

  // --- ci -------------------------------------------------------------------

  function ciIdle(provider, auth = null) {
    return { provider, auth, at: null, rate: { remaining: null, low: false }, runs: [] };
  }

  async function ciPass(st, force) {
    const r = st.repo;
    const p = pk();
    if (!r.ci || r.ci.collect === false || !r.ci.repo) { st.ci = ciIdle(r.ci ? r.ci.provider : 'none'); return; }
    const provider = providerFor(r.ci.provider);
    if (!provider || !provider.active) { st.ci = ciIdle('none'); return; }
    const t = now();
    if (!force && t < st.ciNextAt) return;
    const slug = r.ci.repo;
    const prev = st.ci && st.ci.provider === r.ci.provider ? st.ci : ciIdle(r.ci.provider);

    const authFailed = () => {
      st.ci = { ...prev, auth: false, at: t };
      st.ciNextAt = t + AUTH_BACKOFF_MS;
    };

    if (t - st.rateAt >= RATE_EVERY_MS && typeof provider.rateLimit === 'function') {
      st.rateAt = t;
      const rl = await provider.rateLimit();
      if (rl?.auth === false) return authFailed();
      if (rl?.ok) {
        st.rate = { remaining: rl.remaining, limit: rl.limit, low: rl.limit > 0 && rl.remaining < rl.limit * LOW_RATE_FRAC };
      }
    }

    const branch = branchOf(p.mainRef);
    const res = await provider.mainRuns({ slug, branch, limit: RUN_LIMIT });
    if (res?.auth === false) return authFailed();
    if (!res?.ok) {
      st.ciWarning = `ci: ${res?.error || 'run list failed'}`;
      st.ciNextAt = t + Math.max(30, Number(p.ciEverySec) || 120) * 1000;
      return;
    }
    st.ciWarning = null;
    const runs = arr(res.runs).slice();
    const byName = new Map(st.workflows.map((w) => [w.name, w.file]));

    // Workflows the 30-run window does not show (path-filtered, rarely run).
    for (const w of st.workflows) {
      if (runs.some((x) => x.workflow === w.name)) continue;
      if (t - (st.probeAt.get(w.file) ?? 0) < PROBE_EVERY_MS) {
        const old = arr(prev.runs).find((x) => x.file === w.file);
        if (old && !runs.some((x) => x.id === old.id)) runs.push({ ...old, headSha: old.sha, _old: old });
        continue;
      }
      st.probeAt.set(w.file, t);
      const one = await provider.mainRuns({ slug, branch, limit: 1, workflow: w.file });
      if (one?.auth === false) return authFailed();
      for (const x of arr(one?.runs)) if (!runs.some((y) => y.id === x.id)) runs.push({ ...x, file: w.file });
    }

    const out = [];
    for (const x of runs) {
      if (x._old) { out.push(x._old); continue; }
      const completed = x.status === 'completed';
      const key = `${slug}:${x.id}:${x.attempt}`;
      let jobs = completed ? jobCache.get(key) ?? jobsStore.get({ runId: x.id, attempt: x.attempt, slug }) ?? null : null;
      if (jobs && completed) jobCache.set(key, jobs);
      if (!jobs) {
        const j = await provider.runJobs({ slug, runId: x.id });
        if (j?.auth === false) return authFailed();
        if (j?.ok) {
          jobs = j.jobs;
          if (completed) {
            jobCache.set(key, jobs);
            try { jobsStore.put({ runId: x.id, attempt: x.attempt, slug, jobs }); } catch (err) { log.warn(`ci_jobs put failed: ${err?.message || err}`); }
          }
        } else {
          jobs = [];
        }
      }
      out.push({
        id: x.id, attempt: x.attempt, workflow: x.workflow ?? null,
        file: x.file ?? byName.get(x.workflow) ?? null, sha: x.headSha ?? null, event: x.event ?? null,
        status: x.status ?? null, conclusion: x.conclusion ?? null,
        createdAt: x.createdAt ?? null, updatedAt: x.updatedAt ?? null,
        jobs: withVerdicts(jobs).map(jobOut),
      });
    }
    out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id - a.id);
    st.ci = { provider: r.ci.provider, auth: true, at: t, rate: { remaining: st.rate.remaining, low: st.rate.low }, runs: out };
    const every = st.rate.low ? AUTH_BACKOFF_MS : Math.max(30, Number(p.ciEverySec) || 120) * 1000;
    st.ciNextAt = t + every;
  }

  // --- assembly -------------------------------------------------------------

  async function repoPass(repo, { force = false } = {}) {
    const st = stateFor(repo);
    const p = pk();
    if (p.fetch === 'mirror') {
      const m = await syncMirror({ name: repo.name, dir: repo.dir }, { cacheDir: p.cacheDir, fetchEverySec: p.fetchEverySec, now: now() });
      st.mirrorError = m.error || null;
    }
    const env = await scratchEnv({ name: repo.name, dir: repo.dir }, { cacheDir: p.cacheDir, mirror: p.fetch === 'mirror', now: now() });
    if (!env) {
      st.gitWarnings = ['not a git repo'];
      st.mainSha = null;
    } else {
      await gitPass(st, env, force);
    }
    if (st.mainSha) await ciPass(st, force);
    else if (!st.ci) st.ci = ciIdle(repo.ci ? repo.ci.provider : 'none');
    const runsForTested = arr(st.ci?.runs);
    const lastTested = lastTestedOf(st.packages, runsForTested, st.jobMap);
    const untested = env ? await untestedPass(st, env, lastTested) : {};

    const warnings = [...arr(st.gitWarnings)];
    if (st.ciWarning) warnings.push(st.ciWarning);
    if (st.mirrorError) warnings.push(`mirror: ${st.mirrorError}`);

    const block = {
      name: repo.name,
      slug: repo.ci?.repo ?? null,
      mainRef: p.mainRef,
      head: { sha: st.mainSha, at: st.headAt },
      packages: st.packages,
      workflows: st.workflows,
      jobMap: st.jobMap,
      ci: st.ci,
      lastTested,
      untested,
      branches: st.branches,
      conflicts: st.conflicts,
      deps: st.deps,
      commits: st.commits,
      plans: st.plans,
      stale: st.stale,
      refsAt: st.refsAt,
      warnings: [...new Set(warnings)].slice(0, 50),
    };
    const sig = signature(block);
    st.block = block;
    if (sig !== st.sig) {
      st.sig = sig;
      try { onChange(repo.name, block); } catch (err) { log.warn(`packages onChange failed: ${err?.message || err}`); }
    }
    return block;
  }

  /** One pass over every repo, sequential. `force` ignores the cadences. */
  function refresh({ force = false } = {}) {
    return serial(async () => {
      try {
        const repos = arr(await resolve(config));
        const names = new Set(repos.map((r) => r.name));
        for (const n of [...states.keys()]) {
          if (!names.has(n)) {
            states.delete(n);
            try { onChange(n, null); } catch { /* nothing to tell */ }
          }
        }
        const next = [];
        for (const repo of repos) {
          try {
            next.push(await repoPass(repo, { force }));
          } catch (err) {
            log.warn(`packages: ${repo.name}: ${err?.message || err}`);
            const st = states.get(repo.name);
            if (st?.block) next.push(st.block);
          }
        }
        blocks = next;
        passes += 1;
        lastPassAt = now();
        lastError = null;
      } catch (err) {
        lastError = String(err?.message || err);
        log.error('packages refresh failed', lastError);
      }
      return snapshot();
    });
  }

  function snapshot() {
    return { repos: blocks, at: lastPassAt };
  }

  /** The repos as the snapshot key and the hub store want them: `{name: block}`. */
  function reposByName() {
    return Object.fromEntries(blocks.map((b) => [b.name, b]));
  }

  function health() {
    return { repos: blocks.length, passes, lastPassAt, lastError, textual };
  }

  function start() {
    if (timer || firstTimer) return;
    textualAvailable().then((v) => { textual = v; }).catch(() => { textual = false; });
    const tick = () => refresh().catch((err) => log.error('packages refresh failed', String(err)));
    firstTimer = setTimeout(() => {
      firstTimer = null;
      tick();
      const every = Math.max(10_000, Math.min(lanePollMs(), Math.max(30, Number(pk().ciEverySec) || 120) * 1000));
      timer = setInterval(tick, every);
      timer.unref?.();
    }, opts.firstPassMs ?? FIRST_PASS_MS);
    firstTimer.unref?.();
  }

  function stop() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
  }

  /** The block of one repo (by name or slug), or null. */
  function repo(nameOrSlug) {
    return blocks.find((b) => b.name === nameOrSlug || (b.slug && b.slug === nameOrSlug)) ?? null;
  }

  return { refresh, snapshot, reposByName, health, start, stop, repo };
}

function call(fn, b) {
  try { return Boolean(fn(b)); } catch { return false; }
}
