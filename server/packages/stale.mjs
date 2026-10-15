// Stale-branch report (fleet §6 2.11, P7). Suggestions only: laneboard never
// deletes a branch or retires a lane on its own. `retire` goes through the
// existing retire action (a human confirms); `delete-branch` is shown as
// copyable text.
//
// staleBranches(branches, mainSha, cfg), pure over branches[] from
// branches.collectBranches (they already carry `behind` and `lastCommitAt`).
// A branch is stale when it is unmerged and either older than `staleDays` or
// more than `staleBehind` commits behind main, and it has no live session.

const DAY_MS = 24 * 3600 * 1000;
// Branch names git accepts may still hold shell metacharacters (`$`, `;`,
// backticks, quotes). Anything outside this set is single-quoted.
const SHELL_SAFE = /^[A-Za-z0-9._/@+=,-]+$/;

/** POSIX single-quote a word for display as copyable shell text. */
export function shellQuote(s) {
  const str = String(s);
  return SHELL_SAFE.test(str) ? str : `'${str.replace(/'/g, `'\\''`)}'`;
}

/** The copyable command for a delete suggestion, or null for an unsafe name. */
export function deleteCommand(branch, { remote = true } = {}) {
  if (typeof branch !== 'string' || !branch || branch.startsWith('-') || /[\u0000-\u001f\u007f]/.test(branch)) return null;
  return remote ? `git push origin --delete ${shellQuote(branch)}` : `git branch -D ${shellQuote(branch)}`;
}

function fkeyOf(b) {
  return b.laneFkey ?? b.fkey ?? null;
}

function call(fn, b) {
  try { return typeof fn === 'function' ? Boolean(fn(b)) : false; } catch { return false; }
}

/**
 * `[{branch, sha, behind, lastCommitAt, laneFkey|null, suggestion:'retire'|
 * 'delete-branch', reasons[], command|null}]`, oldest first.
 *
 * `cfg`: `staleDays` (7), `staleBehind` (50), `now`, `isLive(b)` (a live
 * session; also `b.live`), `hasRecord(b)` (a launched lane with a record; also
 * `b.record`). A branch is merged when its sha is main's or `ahead === 0`.
 */
export function staleBranches(branches, mainSha, cfg = {}) {
  const staleDays = Number.isFinite(cfg.staleDays) ? cfg.staleDays : 7;
  const staleBehind = Number.isFinite(cfg.staleBehind) ? cfg.staleBehind : 50;
  const now = Number.isFinite(cfg.now) ? cfg.now : Date.now();
  const out = [];
  for (const b of Array.isArray(branches) ? branches : []) {
    if (!b || typeof b !== 'object' || typeof b.sha !== 'string') continue;
    if (b.sha === mainSha || b.ahead === 0) continue; // merged
    if (b.live || call(cfg.isLive, b)) continue;
    const reasons = [];
    const age = Number.isFinite(b.lastCommitAt) ? now - b.lastCommitAt : null;
    if (age != null && age > staleDays * DAY_MS) reasons.push(`no commit for ${Math.floor(age / DAY_MS)} days`);
    if (Number.isFinite(b.behind) && b.behind > staleBehind) reasons.push(`${b.behind} commits behind main`);
    if (!reasons.length) continue;
    const laneFkey = fkeyOf(b);
    const retire = Boolean(laneFkey) && (b.record === true || call(cfg.hasRecord, b));
    const suggestion = retire ? 'retire' : 'delete-branch';
    const remote = b.pushed !== false || b.local === false;
    out.push({
      branch: b.branch ?? null, sha: b.sha, behind: Number.isFinite(b.behind) ? b.behind : null,
      lastCommitAt: Number.isFinite(b.lastCommitAt) ? b.lastCommitAt : null,
      laneFkey, suggestion, reasons,
      command: suggestion === 'delete-branch' && b.branch ? deleteCommand(b.branch, { remote }) : null,
    });
  }
  out.sort((x, y) => (x.lastCommitAt ?? 0) - (y.lastCommitAt ?? 0) || String(x.branch).localeCompare(String(y.branch)));
  return out;
}
