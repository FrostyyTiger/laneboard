// The in-memory map of runs (docs/plans/runs/README.md §3 A1, T4).
//
// The collector (server/collector/runs.mjs) feeds it parsed events per source
// (one source = one file); the store keeps them per run, caps them and folds a
// run on demand with protocol.mjs's foldRun. Nothing here touches the disk.
//
// - One file may hold several runs, and one run may be written to several
//   files (a loop's own file plus the API's `<stateDir>/runs/<run>.jsonl`).
//   Within a source events keep file order; across sources they are merged by
//   time (an event without `ts` takes its predecessor's in the same source).
// - A truncated or replaced file is `reset`: its events are dropped and it is
//   read again from the start.
// - A file that is no longer found keeps its events: a run outlives the
//   worktree it ran in, until `keepDays` forgets it. If it comes back, the
//   collector resets it before reading it again from the start.
// - Over `maxEvents` for one run, the oldest events go first, except
//   `run.start` lines (they carry the goal, the plan and the budget).
// - Skipped lines have no trustworthy run id: they are counted for the run of
//   the last good line before them in the same source (or the next one, for a
//   file that starts with bad lines).
import { foldRun } from './protocol.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function createStore({ maxEvents = 5000, keepDays = 30, now = () => Date.now() } = {}) {
  // source -> { runs: Map<runId, {events: [], skipped: n}>, lastRun, pendingSkipped, seq, lastTs }
  const sources = new Map();
  const folded = new Map(); // runId -> folded run (cache), dropped when the run changes
  let order = 0; // arrival counter, the tie-breaker of the cross-source merge

  function source(name) {
    let s = sources.get(name);
    if (!s) {
      s = { runs: new Map(), lastRun: null, pendingSkipped: 0, lastTs: 0 };
      sources.set(name, s);
    }
    return s;
  }

  function slot(s, run) {
    let r = s.runs.get(run);
    if (!r) { r = { events: [], skipped: 0 }; s.runs.set(run, r); }
    return r;
  }

  /** Drop the oldest non-`run.start` events of a run until it fits, across its sources. */
  function cap(run) {
    const lists = [];
    let total = 0;
    for (const s of sources.values()) {
      const r = s.runs.get(run);
      if (r) { lists.push(r.events); total += r.events.length; }
    }
    if (total <= maxEvents) return;
    const all = lists.flatMap((l) => l.filter((e) => e.event.t !== 'run.start')).sort(byTime);
    const drop = new Set(all.slice(0, total - maxEvents));
    for (const l of lists) {
      const keep = l.filter((e) => !drop.has(e));
      l.length = 0;
      l.push(...keep);
    }
  }

  /**
   * Add what one read of `name` produced: `events` (parsed, in file order) and
   * `skipped` lines as a list of positions: the number of good events read
   * before each skipped line in this batch.
   */
  function ingest(name, events = [], skippedAt = []) {
    const s = source(name);
    const touched = new Set();
    let i = 0;
    const skipBefore = (k) => {
      while (i < skippedAt.length && skippedAt[i] <= k) {
        if (s.lastRun) slot(s, s.lastRun).skipped++;
        else s.pendingSkipped++;
        i++;
      }
    };
    events.forEach((event, k) => {
      skipBefore(k);
      if (event.ts) s.lastTs = Math.max(s.lastTs, event.ts);
      const r = slot(s, event.run);
      r.events.push({ event, at: s.lastTs, order: order++ });
      if (s.pendingSkipped) { r.skipped += s.pendingSkipped; s.pendingSkipped = 0; }
      s.lastRun = event.run;
      touched.add(event.run);
    });
    skipBefore(Infinity);
    if (s.lastRun) touched.add(s.lastRun);
    for (const run of touched) { cap(run); folded.delete(run); }
  }

  /** Forget everything read from `name` (the file was truncated or replaced). */
  function reset(name) {
    const s = sources.get(name);
    if (!s) return;
    for (const run of s.runs.keys()) folded.delete(run);
    sources.delete(name);
  }

  function runIds() {
    const ids = new Set();
    for (const s of sources.values()) for (const id of s.runs.keys()) ids.add(id);
    return ids;
  }

  function foldOne(id) {
    if (folded.has(id)) return folded.get(id);
    const entries = [];
    let skipped = 0;
    for (const s of sources.values()) {
      const r = s.runs.get(id);
      if (!r) continue;
      entries.push(...r.events);
      skipped += r.skipped;
    }
    if (!entries.length) return null;
    entries.sort(byTime);
    const run = foldRun(entries.map((e) => e.event), { skipped });
    folded.set(id, run);
    return run;
  }

  const fresh = (run) => run.updatedAt === null || run.updatedAt >= now() - keepDays * DAY_MS;

  /** One folded run, or null (unknown or older than keepDays). */
  function get(id) {
    const run = foldOne(id);
    return run && fresh(run) ? run : null;
  }

  /** Every folded run still within keepDays, latest activity first. */
  function list() {
    const out = [];
    for (const id of runIds()) {
      const run = get(id);
      if (run) out.push(run);
    }
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.run.localeCompare(b.run));
  }

  /** Drop runs older than keepDays from memory. Returns how many went. */
  function prune() {
    let gone = 0;
    for (const id of runIds()) {
      const run = foldOne(id);
      if (run && fresh(run)) continue;
      for (const s of sources.values()) {
        if (s.runs.delete(id) && s.lastRun === id) s.lastRun = null;
      }
      folded.delete(id);
      gone++;
    }
    return gone;
  }

  function sourceNames() {
    return [...sources.keys()];
  }

  /** The sources (files) that hold events of run `id`, sorted. */
  function filesOf(id) {
    const out = [];
    for (const [name, s] of sources) if (s.runs.get(id)?.events.length) out.push(name);
    return out.sort();
  }

  return { ingest, reset, get, list, prune, sources: sourceNames, filesOf };
}

function byTime(a, b) {
  return a.at - b.at || a.order - b.order;
}
