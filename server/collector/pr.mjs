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

const BACKOFF_MS = 10 * 60 * 1000;

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
  if (!provider.active) return snapshot();
  if (!force && Date.now() < nextAt) return snapshot();
  const next = {};
  // Sequential across lanes: one call at a time.
  for (const rec of store.active()) {
    if (!rec.branch || !rec.repo) continue;
    const s = await provider.prForBranch({ repo: rec.repo, branch: rec.branch });
    if (s.auth === false) { markAuthFailed(); return snapshot(); }
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
