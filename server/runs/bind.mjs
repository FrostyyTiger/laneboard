// Sessions tied to the rounds of a run (docs/plans/runs/README.md §3 A1, T12).
//
// A loop starts short Claude Code sessions; laneboard knows them from their
// hook events (session id, cwd, first and last time seen) and their cost
// snapshots. A round "has" a session when:
//
//   - the round names it (`session` on `round.start`/`round.end`, e.g. a loop
//     that passes `claude --session-id <uuid>`): exact, whatever the dir; or
//   - the session was first seen during the round's window and its cwd is one
//     of the run's dirs (or below one): the cwd + time window guess.
//
// A round's window runs from its start to its end, else to the next round's
// start, else to the run's stop, else to now. A session started before the
// first round, or in no run's dir, belongs to nothing.
//
// Two runs in one dir at the same time cannot be told apart by cwd and time:
// a guessed session that fits rounds of more than one run is listed in each
// with `maybe: true`, never handed to one of them by chance. Within one run a
// session goes to the latest round started before it was first seen.
//
// The run's dirs: `cwd` from its `run.start`, plus `<dir>` of every
// `<dir>/.laneboard/run.jsonl` it was read from. A run written elsewhere
// (`runs.files` globs, the API's state dir) without `cwd` is bound only by
// the `session` field.
//
// Pure: no files, no database. The route gathers runs and sessions.
import path from 'node:path';

const LANE_TAIL = path.join('.laneboard', 'run.jsonl');

/** The dirs a run works in, from its fold and the files it was read from. Sorted, unique. */
export function runDirs(run, files = []) {
  const dirs = new Set();
  if (typeof run?.cwd === 'string' && path.isAbsolute(run.cwd)) dirs.add(path.normalize(run.cwd));
  for (const f of Array.isArray(files) ? files : []) {
    if (typeof f !== 'string' || !path.isAbsolute(f)) continue;
    const norm = path.normalize(f);
    if (norm.endsWith(`${path.sep}${LANE_TAIL}`)) dirs.add(path.dirname(path.dirname(norm)));
  }
  return [...dirs].sort();
}

/** Whether `cwd` is `dir` or below it (path segments, not string prefixes). */
export function inDir(cwd, dir) {
  if (typeof cwd !== 'string' || typeof dir !== 'string' || !path.isAbsolute(cwd) || !path.isAbsolute(dir)) return false;
  const c = path.normalize(cwd);
  const d = path.normalize(dir);
  if (c === d) return true;
  return c.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Each round's window `{n, from, to}`, by start time. A round with no start
 * time has no window (it can still be bound by its `session` field).
 */
export function roundWindows(run, now = Date.now()) {
  const rounds = (Array.isArray(run?.rounds) ? run.rounds : []).filter((r) => isNum(r?.startedAt));
  const byStart = rounds.slice().sort((a, b) => a.startedAt - b.startedAt || a.n - b.n);
  const stopAt = run?.state === 'stopped' && isNum(run?.stop?.ts) ? run.stop.ts : null;
  return byStart.map((r, i) => {
    const next = byStart[i + 1];
    let to = isNum(r.endedAt) && r.endedAt >= r.startedAt ? r.endedAt
      : next ? next.startedAt
        : stopAt ?? now;
    if (to < r.startedAt) to = r.startedAt;
    return { n: r.n, from: r.startedAt, to };
  });
}

/** One session as a round lists it. */
function entry(s, how, maybe = false) {
  return {
    sessionId: s.sessionId,
    name: s.name ?? null,
    cwd: s.cwd ?? null,
    firstAt: isNum(s.firstAt) ? s.firstAt : null,
    lastAt: isNum(s.lastAt) ? s.lastAt : null,
    usd: isNum(s.usd) ? s.usd : null,
    how,
    maybe,
  };
}

/**
 * Bind sessions to the rounds of several runs at once (ties need all of them).
 *
 * `runs`: `[{run, dirs}]` (a folded run and its `runDirs`); `sessions`:
 * `[{sessionId, name, cwd, firstAt, lastAt, usd}]`. Returns a Map
 * `runId -> Map n -> [entry]`, where an entry is the session plus `how`
 * (`'id'` or `'cwd'`) and `maybe`. Entries are sorted by first seen.
 */
export function bindRuns(runs, sessions, now = Date.now()) {
  const list = (Array.isArray(sessions) ? sessions : []).filter((s) => s && typeof s.sessionId === 'string' && s.sessionId);
  const byId = new Map(list.map((s) => [s.sessionId, s]));
  const out = new Map();
  const named = new Set(); // session ids some round names: never guessed elsewhere
  const slot = (runId, n) => {
    let m = out.get(runId);
    if (!m) { m = new Map(); out.set(runId, m); }
    let l = m.get(n);
    if (!l) { l = []; m.set(n, l); }
    return l;
  };

  const items = (Array.isArray(runs) ? runs : []).filter((x) => x?.run?.run);
  for (const { run } of items) {
    for (const r of run.rounds ?? []) {
      for (const id of Array.isArray(r.sessions) ? r.sessions : []) {
        named.add(id);
        const l = slot(run.run, r.n);
        if (!l.some((e) => e.sessionId === id)) l.push(entry(byId.get(id) ?? { sessionId: id }, 'id'));
      }
    }
  }

  // The guess: for each session, the round of each run it fits (the latest started before it).
  const windows = items.map(({ run, dirs }) => ({ id: run.run, dirs: Array.isArray(dirs) ? dirs : [], wins: roundWindows(run, now) }));
  for (const s of list) {
    if (named.has(s.sessionId) || !isNum(s.firstAt) || typeof s.cwd !== 'string') continue;
    const hits = [];
    for (const w of windows) {
      if (!w.dirs.some((d) => inDir(s.cwd, d))) continue;
      let best = null;
      for (const win of w.wins) if (win.from <= s.firstAt && s.firstAt <= win.to) best = win;
      if (best) hits.push({ id: w.id, n: best.n });
    }
    for (const h of hits) slot(h.id, h.n).push(entry(s, 'cwd', hits.length > 1));
  }

  for (const m of out.values()) {
    for (const l of m.values()) l.sort((a, b) => (a.firstAt ?? Infinity) - (b.firstAt ?? Infinity) || a.sessionId.localeCompare(b.sessionId));
  }
  return out;
}

/**
 * A copy of `run` whose rounds carry `sessions` (the bound entries) and a
 * `sessionsUsd` (their summed cost, null when none is known). The round's own
 * `sessions` field (ids it named) is replaced by the entries.
 */
export function withSessions(run, bound) {
  const m = bound instanceof Map ? bound.get(run.run) : null;
  const rounds = (run.rounds ?? []).map((r) => {
    const sessions = m?.get(r.n) ?? [];
    const costs = sessions.map((s) => s.usd).filter(isNum);
    const usd = costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null;
    return { ...r, sessions, sessionsUsd: usd };
  });
  return { ...run, rounds };
}
