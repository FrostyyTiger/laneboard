// PRs and CI, per launched lane, through the CI provider. Read-only, 60 s,
// sequential: one call at a time, never a burst.
//
// The provider does the talking; this file decides what a result means — a
// sample worth storing, a `blocked` marker to raise, a back-off to sit out.
// "Not logged in" is a state, not an error loop: the cycle backs off to
// 10 min and says NEED-HUMAN once. Red checks raise a `blocked` marker through
// the existing marker/push path; green after red dismisses it.
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { ci as provider } from '../providers/index.mjs';
import * as db from '../db.mjs';
import * as store from '../lanes/store.mjs';
import * as markers from './markers.mjs';
import { resolveRepos, githubSlug, defaultOriginUrl, repoDir } from '../packages/repos.mjs';

const BACKOFF_MS = 10 * 60 * 1000;
const BLAME_CACHE_MAX = 500;

/** The fields pr_samples records; a row is written only when these change. */
export function sampleKey(s) {
  if (!s || s.none) return 'none';
  return [s.number, s.state, s.isDraft, s.checks.passed, s.checks.failed, s.checks.pending].join('|');
}

let prs = {}; // lane id -> summary | { none: true } | { error }
let queue = null;
let auth = { ok: true, checkedAt: 0 };
let saidNeedAuth = false;
let refreshedAt = 0;
let nextAt = 0;
const lastKey = new Map();
/** Called with a fresh marker row so it reaches the card and the push path. */
let onMarker = () => {};
// Job blame on the fine-grained path (fleet P9): `${slug}\0${headSha}` ->
// [{workflow, job}]. A head commit's failed jobs are asked for once.
const blameCache = new Map();
const slugCache = new Map(); // lane repo name -> Promise<slug|null>

/**
 * The `owner/name` slug of a lane's repo: its `repos[].ci.repo` (resolveRepos,
 * which also covers the legacy `ci.repo` dir), else the GitHub origin of
 * `<codeDir>/<repo>`. Cached for the process lifetime.
 */
let slugFor = (repo) => {
  if (!slugCache.has(repo)) {
    slugCache.set(repo, (async () => {
      const list = await resolveRepos(config).catch(() => []);
      const hit = list.find((r) => r.name === repo);
      if (hit?.ci?.repo) return hit.ci.repo;
      const dir = hit?.dir ?? repoDir({ name: repo }, config.codeDir);
      return githubSlug(await defaultOriginUrl(dir).catch(() => null));
    })().catch(() => null));
  }
  return slugCache.get(repo);
};

/** Tests: swap the repo -> slug lookup, and forget every cached blame. */
export function _setSlugResolver(fn) {
  slugFor = fn;
  blameCache.clear();
  slugCache.clear();
}

/**
 * Red on the fine-grained fallback names workflows, not jobs (gh.mjs
 * `viaRuns`). Ask the provider once per head sha which jobs failed, so the
 * package view can blame a job. Classic tokens already have per-job names.
 * Returns the summary with `failedJobs` added when there is anything to add.
 */
export async function blameJobs(rec, s) {
  if (!s || s.verdict !== 'red' || !s.viaRuns || !s.headSha) return s;
  if (typeof provider.failedJobsForCommit !== 'function') return s;
  const slug = await slugFor(rec.repo);
  if (!slug) return s;
  const key = `${slug}\0${s.headSha}`;
  if (!blameCache.has(key)) {
    const jobs = await provider.failedJobsForCommit({ slug, sha: s.headSha });
    blameCache.set(key, Array.isArray(jobs) ? jobs : []);
    while (blameCache.size > BLAME_CACHE_MAX) blameCache.delete(blameCache.keys().next().value);
  }
  const failedJobs = blameCache.get(key);
  return failedJobs.length ? { ...s, failedJobs } : s;
}

export function init({ noteMarker } = {}) {
  if (noteMarker) onMarker = noteMarker;
}

export function get(laneId) {
  return prs[laneId] ?? null;
}

export function snapshot() {
  return { prs, queue, auth, refreshedAt, provider: provider.name };
}

function markAuthFailed() {
  auth = { ok: false, checkedAt: Date.now(), message: 'not logged in' };
  nextAt = Date.now() + BACKOFF_MS;
  if (!saidNeedAuth) {
    saidNeedAuth = true;
    log.warn('NEED-HUMAN: gh auth login on this host');
  }
}

/** Red raises one `blocked` marker per head commit; green after red dismisses it. */
export function reactToChecks(rec, s, prev) {
  if (!s || s.none || s.error || s.state !== 'OPEN') return;
  if (s.verdict === 'red') {
    // Job names when the fine-grained path could blame jobs, else the check names.
    const blamed = Array.isArray(s.failedJobs) ? s.failedJobs.map((j) => j.job || j.workflow).filter(Boolean) : [];
    const names = (blamed.length ? [...new Set(blamed)] : s.checks.failedNames).slice(0, 3).join(', ');
    const text = `BLOCKED: PR #${s.number} checks red on ${String(s.headSha || '').slice(0, 7)}: ${names}`;
    const ts = Date.now();
    const id = markers.record({ lane: rec.id, sessionName: rec.session || rec.id, kind: 'blocked', text, source: 'pr', ts });
    if (id) onMarker({ id, ts, lane: rec.id, sessionName: rec.session || rec.id, kind: 'blocked', text, source: 'pr' });
  } else if (s.verdict === 'green' && prev?.verdict !== 'green') {
    for (const m of db.listMarkers({ lane: rec.id, kinds: ['blocked'], limit: 50 })) {
      if (m.source === 'pr') db.dismissMarker(m.id);
    }
  }
}

export async function refresh({ force = false } = {}) {
  if (!provider.active) return snapshot();
  if (!force && Date.now() < nextAt) return snapshot();
  const next = {};
  // Sequential across lanes: one call at a time.
  for (const rec of store.active()) {
    if (!rec.branch || !rec.repo) continue;
    let s = await provider.prForBranch({ repo: rec.repo, branch: rec.branch });
    if (s.auth === false) { markAuthFailed(); return snapshot(); }
    s = await blameJobs(rec, s);
    reactToChecks(rec, s, prs[rec.id]);
    next[rec.id] = { ...s, at: Date.now() };
    const key = sampleKey(s);
    if (!s.error && lastKey.get(rec.id) !== key) {
      lastKey.set(rec.id, key);
      if (!s.none) db.addPrSample({ lane: rec.id, ...s });
    }
  }
  const r = await provider.runs({ repo: config.ci.repo });
  if (r.auth === false) { markAuthFailed(); return snapshot(); }
  if (r.ok) queue = { ...r.queue, at: Date.now() };
  auth = { ok: true, checkedAt: Date.now() };
  prs = next;
  refreshedAt = Date.now();
  nextAt = 0;
  return snapshot();
}

export function start() {
  if (!provider.active) return;
  // Offset from the lanes (5 s), progress (20 s) and markers (35 s) passes.
  const first = setTimeout(() => refresh().catch((err) => log.error('pr refresh failed', String(err))), 45_000);
  first.unref();
  const timer = setInterval(() => refresh().catch((err) => log.error('pr refresh failed', String(err))), config.lanePollMs);
  timer.unref();
}
