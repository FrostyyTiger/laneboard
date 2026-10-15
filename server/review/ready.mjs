// The review-ready rule (fleet plan §10 2.4, R5). Pure: no I/O, no clock.
//
// A lane is ready for review when the agent has stopped and left something to
// look at. The inputs are gathered by server/collector/review.mjs; this file
// only decides what they mean, so the rule can be tested case by case.
//
//   reviewReadyOf({lane, sessions, pr, doneMarkers, diffStat, dirtyCount,
//                  reviewSentAt, greenSince})
//     -> {ready: true, reasons: ('done-marker'|'pr-green'|'stop-diff')[], since}
//        | null
//
// null (not ready) when the lane is a main checkout, is merged, its PR is
// MERGED or CLOSED, a session is still working or waiting on a permission, or
// no trigger holds. `since` is the earliest trigger time.

export const REASONS = Object.freeze(['done-marker', 'pr-green', 'stop-diff']);
/** A session in one of these states is still busy: the lane is not ready. */
export const BUSY_STATES = Object.freeze(['working', 'waiting_permission']);
/** At most this many changed paths are kept per lane (for packagesFor). */
export const MAX_PATHS = 500;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** true when `ts` happened after the last review was sent (or none was). */
function afterSent(ts, reviewSentAt) {
  const sent = num(reviewSentAt);
  return sent == null || ts > sent;
}

/** A usable PR record: drops the collector's `{none}` / `{error}` shapes. */
export function prOf(pr) {
  if (!pr || typeof pr !== 'object' || pr.none || pr.error) return null;
  return pr;
}

/** true for `pr-green`: an open, non-draft PR whose checks verdict is green. */
export function isPrGreen(pr) {
  const p = prOf(pr);
  return !!p && p.state === 'OPEN' && !p.isDraft && p.verdict === 'green';
}

/**
 * kv `review.greenSince[lane]` bookkeeping: the first refresh a PR is seen
 * green sets it, a non-green PR (or no PR) clears it, an unknown/error read
 * keeps what was there. Returns the new value (ms or null).
 */
export function nextGreenSince(prev, pr, now) {
  if (pr && typeof pr === 'object' && pr.error) return num(prev);
  if (pr === undefined) return num(prev);
  if (isPrGreen(pr)) return num(prev) ?? now;
  return null;
}

export function reviewReadyOf({
  lane, sessions = [], pr = null, doneMarkers = [], diffStat = null, dirtyCount = 0, reviewSentAt = null, greenSince = null,
} = {}) {
  if (!lane || lane.isMain || lane.merged === true) return null;
  const p = prOf(pr);
  if (p && (p.state === 'MERGED' || p.state === 'CLOSED')) return null;
  const list = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  if (list.some((s) => BUSY_STATES.includes(s.state))) return null;

  const reasons = [];
  const times = [];

  // done-marker: the newest undismissed `done` marker is newer than sentAt.
  let newest = null;
  for (const m of Array.isArray(doneMarkers) ? doneMarkers : []) {
    if (!m || m.dismissed_at != null || (m.kind != null && m.kind !== 'done')) continue;
    const ts = num(m.ts);
    if (ts != null && (newest == null || ts > newest)) newest = ts;
  }
  if (newest != null && afterSent(newest, reviewSentAt)) {
    reasons.push('done-marker');
    times.push(newest);
  }

  // pr-green: the PR verdict, timed by when it was first seen green.
  if (isPrGreen(p)) {
    reasons.push('pr-green');
    const g = num(greenSince);
    if (g != null) times.push(g);
  }

  // stop-diff: a session stopped (`done`, set by the Stop hook) after the last
  // review, and the lane has changes against its base.
  const changed = (num(diffStat?.files) ?? 0) + (num(dirtyCount) ?? 0);
  if (changed > 0) {
    let stopped = null;
    for (const s of list) {
      if (s.state !== 'done') continue;
      const t = num(s.stateSince);
      if (t == null || !afterSent(t, reviewSentAt)) continue;
      if (stopped == null || t < stopped) stopped = t;
    }
    if (stopped != null) {
      reasons.push('stop-diff');
      times.push(stopped);
    }
  }

  if (!reasons.length) return null;
  return { ready: true, reasons, since: times.length ? Math.min(...times) : null };
}

/**
 * Parse `git diff --numstat -z` output: `{files, add, del, paths}`. A rename
 * (`-M`) is `add\tdel\t\0old\0new\0` and counts once under its new path; a
 * binary file is `-\t-\tpath` and adds no lines. `paths` is capped at
 * `maxPaths`; `files` is the true count.
 */
export function parseNumstat(stdout, maxPaths = MAX_PATHS) {
  const parts = String(stdout ?? '').split('\0');
  let files = 0, add = 0, del = 0;
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(rec.replace(/^\n+/, ''));
    if (!m) continue;
    let file = m[3];
    if (file === '') {
      // rename/copy: the next two fields are the old and the new path
      file = parts[i + 2] ?? parts[i + 1] ?? '';
      i += 2;
    }
    files += 1;
    if (m[1] !== '-') add += Number(m[1]);
    if (m[2] !== '-') del += Number(m[2]);
    if (file && paths.length < maxPaths) paths.push(file);
  }
  return { files, add, del, paths };
}
