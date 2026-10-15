// The `gh` CI provider: GitHub through the CLI the person is already logged
// into. Read-only — `gh pr view` and `gh run list`, nothing that writes.
//
// Not logged in is a state, not an error: the caller backs off and says so
// once. The PR and queue parsers are the code v3 ran, moved. The per-job
// reads (mainRuns, runJobs, failedJobsForCommit) and rateLimit name the repo
// with `-R <owner/name>` instead of a cwd, and only need Actions read, so they
// work with a fine-grained token that has no Checks permission.
import path from 'node:path';
import { config } from '../../config.mjs';
import { run } from '../../util.mjs';

export const name = 'gh';
export const active = true;

const PR_FIELDS = 'number,url,state,isDraft,mergeable,headRefOid,reviews,latestReviews,statusCheckRollup';
const PR_FIELDS_NO_CHECKS = 'number,url,state,isDraft,mergeable,headRefOid,reviews,latestReviews';
const MAIN_RUN_FIELDS = 'databaseId,attempt,workflowName,workflowDatabaseId,headSha,event,status,conclusion,createdAt,updatedAt';
const FAILED_RUN_FIELDS = 'databaseId,conclusion,workflowName';
const RUN_FIELDS = 'status,conclusion,name,headBranch,createdAt';
const COMMIT_RUN_FIELDS = 'status,conclusion,name';

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', 'ERROR']);

/** Steps that only prepare a job; a job whose other steps were all skipped did not test anything. */
export const SETUP_STEP = /^(Set up job|Complete job|Post .*|Run actions\/checkout.*|Run actions\/setup-.*|Checkout.*)$/;

// Arguments that reach gh. execFile means no shell, but a value starting with
// `-` would still be read as a flag, so every one is checked first.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;
const SHA_RE = /^[0-9a-f]{7,64}$/i;
const ID_RE = /^[1-9][0-9]{0,19}$/;
const WORKFLOW_RE = /^[A-Za-z0-9_.][A-Za-z0-9_. /-]{0,199}$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)[^\s~^:?*\[\\\x00-\x1f\x7f]{1,255}$/;
const BOT_LOGINS = new Set(['copilot-pull-request-reviewer', 'copilot', 'github-actions', 'dependabot', 'renovate']);

// --- pure --------------------------------------------------------------------

/** One statusCheckRollup entry -> 'passed' | 'failed' | 'pending'. */
export function checkBucket(c) {
  if (c?.__typename === 'StatusContext' || (c?.state && !c?.status)) {
    const s = String(c.state || '').toUpperCase();
    if (s === 'SUCCESS') return 'passed';
    if (s === 'FAILURE' || s === 'ERROR') return 'failed';
    return 'pending';
  }
  if (String(c?.status || '').toUpperCase() !== 'COMPLETED') return 'pending';
  const k = String(c?.conclusion || '').toUpperCase();
  if (PASSED.has(k)) return 'passed';
  if (FAILED.has(k)) return 'failed';
  return 'pending';
}

/** `gh pr view` JSON -> the summary the board and pr_samples use. */
export function summarisePr(pr) {
  const checks = { passed: 0, failed: 0, pending: 0, total: 0, failedNames: [] };
  for (const c of pr?.statusCheckRollup ?? []) {
    const b = checkBucket(c);
    checks[b] += 1;
    checks.total += 1;
    if (b === 'failed') checks.failedNames.push(c.name || c.context || 'check');
  }
  // One word for the chip: red beats pending beats green; nothing is "none".
  const verdict = checks.failed ? 'red' : checks.pending ? 'pending' : checks.total ? 'green' : 'none';
  return {
    number: pr.number ?? null,
    url: pr.url ?? null,
    state: pr.state ?? null, // OPEN | CLOSED | MERGED
    isDraft: Boolean(pr.isDraft),
    mergeable: pr.mergeable ?? null,
    headSha: pr.headRefOid ?? null,
    checks,
    verdict,
    // Checks came from the Actions runs of the head commit (fine-grained token):
    // failedNames are then workflow names, not job names.
    viaRuns: Boolean(pr.viaRuns),
    firstReviewAt: firstReviewAt(pr),
  };
}

/** A review author that is a bot, not a person: `x[bot]` logins and the known review apps. */
export function isBotLogin(login) {
  const l = String(login || '').toLowerCase();
  if (!l) return true; // a ghost author is nobody we wait for
  return l.endsWith('[bot]') || l.endsWith('-bot') || BOT_LOGINS.has(l);
}

/** Earliest submittedAt (ms) of a review by a person, over `reviews` and `latestReviews`; null if none. */
export function firstReviewAt(pr) {
  let best = null;
  for (const list of [pr?.reviews, pr?.latestReviews]) {
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || isBotLogin(r.author?.login)) continue;
      if (String(r.state || '').toUpperCase() === 'PENDING') continue;
      const t = r.submittedAt ? Date.parse(r.submittedAt) : NaN;
      if (Number.isFinite(t) && (best === null || t < best)) best = t;
    }
  }
  return best;
}

const ms = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? t : null; // gh writes 0001-01-01 for "not yet"
};
const lower = (v) => (v ? String(v).toLowerCase() : null);

/** `gh run list --json MAIN_RUN_FIELDS` -> normalised runs, newest first. */
export function normaliseRuns(runs) {
  return (Array.isArray(runs) ? runs : [])
    .filter((r) => r && r.databaseId != null)
    .map((r) => ({
      id: Number(r.databaseId),
      attempt: Number(r.attempt) || 1,
      workflow: r.workflowName ?? null,
      workflowId: r.workflowDatabaseId ?? null,
      headSha: r.headSha ?? null,
      event: r.event ?? null,
      status: lower(r.status),           // queued | in_progress | completed | …
      conclusion: lower(r.conclusion),   // success | failure | skipped | … | null while running
      createdAt: ms(r.createdAt),
      updatedAt: ms(r.updatedAt),
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id - a.id);
}

/**
 * One job's steps -> counts. `ran` is the steps that are not setup (SETUP_STEP),
 * i.e. the ones meant to do the work; `skipped` and `skippedNames` are the
 * skipped ones among those; `failed` counts every failed step.
 */
export function summariseSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const work = list.filter((s) => !SETUP_STEP.test(String(s?.name || '')));
  const skippedSteps = work.filter((s) => lower(s?.conclusion) === 'skipped');
  return {
    total: list.length,
    ran: work.length,
    skipped: skippedSteps.length,
    failed: list.filter((s) => checkBucket({ status: s?.status, conclusion: s?.conclusion }) === 'failed').length,
    skippedNames: skippedSteps.map((s) => String(s.name)),
  };
}

/** `gh run view --json jobs` -> normalised jobs. */
export function normaliseJobs(view) {
  const jobs = Array.isArray(view) ? view : view?.jobs;
  return (Array.isArray(jobs) ? jobs : []).map((j) => ({
    id: j.databaseId ?? null,
    name: j.name ?? null,
    status: lower(j.status),
    conclusion: lower(j.conclusion),
    startedAt: ms(j.startedAt),
    completedAt: ms(j.completedAt),
    steps: summariseSteps(j.steps),
  }));
}

/** Did this completed run or job fail (checkBucket's sense: cancelled and timed out count)? */
function failedConclusion(conclusion) {
  return Boolean(conclusion) && checkBucket({ status: 'COMPLETED', conclusion }) === 'failed';
}

/** `gh api rate_limit` JSON -> the REST core bucket (what `run list` / `run view` spend), plus graphql. */
export function parseRateLimit(j) {
  const pick = (b) => (b && Number.isFinite(Number(b.remaining)) && Number.isFinite(Number(b.limit))
    ? { remaining: Number(b.remaining), limit: Number(b.limit), resetAt: Number(b.reset) * 1000 || null }
    : null);
  const core = pick(j?.resources?.core) || pick(j?.rate);
  if (!core) return { ok: false, error: 'unparseable rate_limit' };
  return { ok: true, ...core, graphql: pick(j?.resources?.graphql) };
}

function failure(r) {
  if (isAuthFailure(r)) return { auth: false };
  return { ok: false, error: (r.stderr || '').trim().slice(-200) || `gh exited ${r.code}` };
}

function parse(stdout) {
  try { return { ok: true, value: JSON.parse(stdout) }; } catch { return { ok: false }; }
}

/** Is this gh failure "not logged in" rather than anything else? */
export function isAuthFailure(r) {
  return r.code === 4 || /gh auth login|not logged in|authentication required|HTTP 401/i.test(r.stderr || '');
}

export function isNoPr(r) {
  return /no pull requests found/i.test(r.stderr || '');
}

/** Refused the check runs? Fine-grained tokens have no "Checks" permission, so statusCheckRollup is denied. */
export function isChecksDenied(r) {
  return /Resource not accessible by (personal access token|integration)/i.test(r.stderr || '');
}

/** `gh run list --commit` JSON -> statusCheckRollup-shaped entries, one per workflow run (coarser than per job). */
export function runsAsChecks(runs) {
  return (Array.isArray(runs) ? runs : []).map((r) => ({
    __typename: 'CheckRun',
    name: r.name,
    status: String(r.status || '').toUpperCase(),
    conclusion: String(r.conclusion || '').toUpperCase(),
  }));
}

/** `gh run list` JSON -> the queue, newest first, as the Box shows it. */
export function summariseRuns(runs) {
  const list = (Array.isArray(runs) ? runs : []).map((r) => ({
    name: r.name,
    branch: r.headBranch,
    status: r.status, // queued | in_progress | completed | …
    conclusion: r.conclusion || null,
    createdAt: r.createdAt ? Date.parse(r.createdAt) : null,
  }));
  return {
    runs: list,
    queued: list.filter((r) => r.status === 'queued' || r.status === 'waiting' || r.status === 'pending').length,
    running: list.filter((r) => r.status === 'in_progress').length,
  };
}

// --- live --------------------------------------------------------------------

let ghRun = (args, opts) => run('gh', args, opts);
/** Tests swap gh for a fixture reader. */
export function _setRunner(fn) { ghRun = fn; }

/** The PR for one branch: a summary, `{none}`, `{auth:false}` or `{error}`. */
export async function prForBranch({ repo, branch }) {
  const cwd = path.join(config.codeDir, repo);
  let r = await ghRun(['pr', 'view', branch, '--json', PR_FIELDS], { cwd, timeout: 20000 });
  let viaRuns = false;
  if (!r.ok && isChecksDenied(r)) {
    // A fine-grained token cannot read check runs: take the PR without them, then the Actions runs of its head commit.
    r = await ghRun(['pr', 'view', branch, '--json', PR_FIELDS_NO_CHECKS], { cwd, timeout: 20000 });
    viaRuns = true;
  }
  if (!r.ok) {
    if (isAuthFailure(r)) return { auth: false };
    if (isNoPr(r)) return { none: true };
    return { error: (r.stderr || '').trim().slice(-200) || `gh exited ${r.code}` };
  }
  let pr;
  try {
    pr = JSON.parse(r.stdout);
  } catch {
    return { error: 'unparseable gh output' };
  }
  pr.viaRuns = viaRuns;
  if (viaRuns && pr.headRefOid) {
    const runsR = await ghRun(['run', 'list', '--commit', pr.headRefOid, '--json', COMMIT_RUN_FIELDS], { cwd, timeout: 20000 });
    try {
      pr.statusCheckRollup = runsR.ok ? runsAsChecks(JSON.parse(runsR.stdout)) : [];
    } catch {
      pr.statusCheckRollup = [];
    }
  }
  return summarisePr(pr);
}

/** The CI queue for the configured repo. */
export async function runs({ repo = config.ci.repo } = {}) {
  if (!repo) return { ok: false };
  const r = await ghRun(['run', 'list', '--limit', '15', '--json', RUN_FIELDS], {
    cwd: path.join(config.codeDir, repo), timeout: 20000,
  });
  if (!r.ok) return isAuthFailure(r) ? { auth: false } : { ok: false };
  try {
    return { ok: true, queue: { ...summariseRuns(JSON.parse(r.stdout)), repo } };
  } catch {
    return { ok: false };
  }
}

/** Recent runs on one branch (main) of `slug`, optionally of one workflow file. */
export async function mainRuns({ slug, branch, limit = 30, workflow } = {}) {
  const n = Math.max(1, Math.min(Number(limit) || 30, 200));
  if (!SLUG_RE.test(String(slug || '')) || !BRANCH_RE.test(String(branch || ''))) return { ok: false, error: 'bad argument' };
  if (workflow != null && !WORKFLOW_RE.test(String(workflow))) return { ok: false, error: 'bad argument' };
  const args = ['run', 'list', '-R', slug, '--branch', branch, '--limit', String(n)];
  if (workflow != null) args.push('--workflow', String(workflow));
  args.push('--json', MAIN_RUN_FIELDS);
  const r = await ghRun(args, { timeout: 20000 });
  if (!r.ok) return failure(r);
  const p = parse(r.stdout);
  if (!p.ok || !Array.isArray(p.value)) return { ok: false, error: 'unparseable gh output' };
  return { ok: true, runs: normaliseRuns(p.value) };
}

/** The jobs of one run (its latest attempt), with step counts. */
export async function runJobs({ slug, runId } = {}) {
  if (!SLUG_RE.test(String(slug || '')) || !ID_RE.test(String(runId ?? ''))) return { ok: false, error: 'bad argument' };
  const r = await ghRun(['run', 'view', String(runId), '-R', slug, '--json', 'jobs'], { timeout: 20000 });
  if (!r.ok) return failure(r);
  const p = parse(r.stdout);
  if (!p.ok || !p.value || !Array.isArray(p.value.jobs)) return { ok: false, error: 'unparseable gh output' };
  return { ok: true, jobs: normaliseJobs(p.value) };
}

/** The REST budget left. `gh api rate_limit` itself does not count against it. */
export async function rateLimit() {
  const r = await ghRun(['api', 'rate_limit'], { timeout: 20000 });
  if (!r.ok) return failure(r);
  const p = parse(r.stdout);
  return p.ok ? parseRateLimit(p.value) : { ok: false, error: 'unparseable gh output' };
}

/**
 * The failed jobs of one commit, across its failed workflow runs:
 * `[{workflow, job}]`. A failed run whose jobs cannot be read, or that has no
 * failed job (a startup failure), is blamed as `{workflow, job: null}`. Any
 * failure of the listing itself gives `[]`: nothing is blamed.
 */
export async function failedJobsForCommit({ slug, sha } = {}) {
  if (!SLUG_RE.test(String(slug || '')) || !SHA_RE.test(String(sha || ''))) return [];
  const r = await ghRun(['run', 'list', '-R', slug, '--commit', sha, '--json', FAILED_RUN_FIELDS], { timeout: 20000 });
  if (!r.ok) return [];
  const p = parse(r.stdout);
  if (!p.ok || !Array.isArray(p.value)) return [];
  const out = [];
  for (const run of p.value) {
    if (!run || !failedConclusion(run.conclusion)) continue;
    const workflow = run.workflowName ?? null;
    const j = await runJobs({ slug, runId: run.databaseId });
    const failed = j.ok ? j.jobs.filter((x) => failedConclusion(x.conclusion)) : [];
    if (!failed.length) out.push({ workflow, job: null });
    for (const x of failed) out.push({ workflow, job: x.name });
  }
  return out;
}
