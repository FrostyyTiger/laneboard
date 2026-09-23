// The `gh` CI provider: GitHub through the CLI the person is already logged
// into. Read-only — `gh pr view` and `gh run list`, nothing that writes.
//
// Not logged in is a state, not an error: the caller backs off and says so
// once. Everything here is the code v3 ran, moved; the parsers are unchanged.
import path from 'node:path';
import { config } from '../../config.mjs';
import { run } from '../../util.mjs';

export const name = 'gh';
export const active = true;

const PR_FIELDS = 'number,url,state,isDraft,mergeable,headRefOid,statusCheckRollup';
const RUN_FIELDS = 'status,conclusion,name,headBranch,createdAt';

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', 'ERROR']);

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
  };
}

/** Is this gh failure "not logged in" rather than anything else? */
export function isAuthFailure(r) {
  return r.code === 4 || /gh auth login|not logged in|authentication required|HTTP 401/i.test(r.stderr || '');
}

export function isNoPr(r) {
  return /no pull requests found/i.test(r.stderr || '');
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
  const r = await ghRun(['pr', 'view', branch, '--json', PR_FIELDS], {
    cwd: path.join(config.codeDir, repo), timeout: 20000,
  });
  if (!r.ok) {
    if (isAuthFailure(r)) return { auth: false };
    if (isNoPr(r)) return { none: true };
    return { error: (r.stderr || '').trim().slice(-200) || `gh exited ${r.code}` };
  }
  try {
    return summarisePr(JSON.parse(r.stdout));
  } catch {
    return { error: 'unparseable gh output' };
  }
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
