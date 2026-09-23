// PRs and CI, per launched lane, through `gh`. Read-only, 60 s, sequential.
//
//   per active lane  gh pr view <branch> --json number,url,state,isDraft,mergeable,headRefOid,statusCheckRollup
//   once per cycle   gh run list --limit 15 --json status,conclusion,name,headBranch,createdAt
//
// `gh` not logged in is a state, not an error loop: the cycle backs off to
// 10 min and says NEED-HUMAN once. Red checks raise a `blocked` marker through
// the existing marker/push path; green after red dismisses it.
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';
import * as db from '../db.mjs';
import * as store from '../lanes/store.mjs';
import * as markers from './markers.mjs';

const PR_FIELDS = 'number,url,state,isDraft,mergeable,headRefOid,statusCheckRollup';
const RUN_FIELDS = 'status,conclusion,name,headBranch,createdAt';
const BACKOFF_MS = 10 * 60 * 1000;

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

/** The fields pr_samples records; a row is written only when these change. */
export function sampleKey(s) {
  if (!s || s.none) return 'none';
  return [s.number, s.state, s.isDraft, s.checks.passed, s.checks.failed, s.checks.pending].join('|');
}

// --- live --------------------------------------------------------------------

let ghRun = (args, opts) => run('gh', args, opts);
/** Tests swap gh for a fixture reader. */
export function _setRunner(fn) { ghRun = fn; }

let prs = {}; // lane id -> summary | { none: true } | { error }
let queue = null;
let auth = { ok: true, checkedAt: 0 };
let saidNeedAuth = false;
let refreshedAt = 0;
let nextAt = 0;
const lastKey = new Map();
/** Called with a fresh marker row so it reaches the card and the push path. */
let onMarker = () => {};

export function init({ noteMarker } = {}) {
  if (noteMarker) onMarker = noteMarker;
}

export function get(laneId) {
  return prs[laneId] ?? null;
}

export function snapshot() {
  return { prs, queue, auth, refreshedAt };
}

function markAuthFailed() {
  auth = { ok: false, checkedAt: Date.now(), message: 'gh not logged in' };
  nextAt = Date.now() + BACKOFF_MS;
  if (!saidNeedAuth) {
    saidNeedAuth = true;
    log.warn('NEED-HUMAN: gh auth login on this host');
  }
}

async function onePr(rec) {
  const cwd = path.join(config.codeDir, rec.repo);
  const r = await ghRun(['pr', 'view', rec.branch, '--json', PR_FIELDS], { cwd, timeout: 20000 });
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

/** Red raises one `blocked` marker per head commit; green after red dismisses it. */
export function reactToChecks(rec, s, prev) {
  if (!s || s.none || s.error || s.state !== 'OPEN') return;
  if (s.verdict === 'red') {
    const names = s.checks.failedNames.slice(0, 3).join(', ');
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
  if (!force && Date.now() < nextAt) return snapshot();
  const next = {};
  // Sequential across lanes: one gh at a time.
  for (const rec of store.active()) {
    if (!rec.branch || !rec.repo) continue;
    const s = await onePr(rec);
    if (s.auth === false) { markAuthFailed(); return snapshot(); }
    reactToChecks(rec, s, prs[rec.id]);
    next[rec.id] = { ...s, at: Date.now() };
    const key = sampleKey(s);
    if (!s.error && lastKey.get(rec.id) !== key) {
      lastKey.set(rec.id, key);
      if (!s.none) db.addPrSample({ lane: rec.id, ...s });
    }
  }
  const r = await ghRun(['run', 'list', '--limit', '15', '--json', RUN_FIELDS], {
    cwd: path.join(config.codeDir, config.ciRepo), timeout: 20000,
  });
  if (!r.ok && isAuthFailure(r)) { markAuthFailed(); return snapshot(); }
  if (r.ok) {
    try { queue = { ...summariseRuns(JSON.parse(r.stdout)), repo: config.ciRepo, at: Date.now() }; } catch { /* keep the last */ }
  }
  auth = { ok: true, checkedAt: Date.now() };
  prs = next;
  refreshedAt = Date.now();
  nextAt = 0;
  return snapshot();
}

export function start() {
  // Offset from the lanes (5 s), progress (20 s) and markers (35 s) passes.
  const first = setTimeout(() => refresh().catch((err) => log.error('pr refresh failed', String(err))), 45_000);
  first.unref();
  const timer = setInterval(() => refresh().catch((err) => log.error('pr refresh failed', String(err))), config.lanePollMs);
  timer.unref();
}
