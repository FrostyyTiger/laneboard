// What the Morning digest says about runs (docs/plans/runs/README.md §3 A3, T6).
//
//   runsInWindow(runs, {since, now}) -> [{run, goal, state, rounds, scores, stop, prs, usd, usage,
//                                         startedAt, updatedAt}]
//
// `runs` are folded runs (server/runs/protocol.mjs foldRun, as the store's
// list() gives them, latest activity first). Pure: no database, no config, so
// the demo's forwarder can use it as it uses summarize.
//
// - A run is listed when it had an event in the window: `updatedAt` at or after
//   `since` and a start no later than `now`.
// - `rounds` counts the rounds that started or ended in the window.
// - A score's `start` is its first value in the window, `end` its last; a value
//   without `ts` takes its round's start, and one with neither counts as in
//   the window (nothing says it is not). A score with no value in the window is
//   left out.
// - `prs` are the URLs of `pr` artifacts given in the window.
// - `usd`: the run's own `cost` total when the whole run is in the window and
//   it has one (its `cost` events, else its rounds' `usd`); otherwise the sum of the window's rounds' `usd`
//   (`cost` events keep no time once folded), null when no round says.
// - `stop` is the stop reason or null; `usage` the latest usage the run sent.

const inWindow = (ts, since, now) => ts >= since && ts <= now;

function windowScores(run, since, now) {
  const startOf = new Map(run.rounds.map((r) => [r.n, r.startedAt]));
  const out = {};
  for (const [name, list] of Object.entries(run.scores ?? {})) {
    const kept = list.filter((p) => {
      const ts = p.ts ?? startOf.get(p.n) ?? null;
      return ts === null || inWindow(ts, since, now);
    });
    if (!kept.length) continue;
    out[name] = { start: kept[0].value, end: kept[kept.length - 1].value, better: run.better?.[name] ?? null };
  }
  return out;
}

/** One digest row per run with events in [since, now]; the input order is kept. */
export function runsInWindow(runs, { since, now = Date.now() } = {}) {
  const out = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.updatedAt === null || run.updatedAt < since) continue;
    if (run.startedAt !== null && run.startedAt > now) continue;
    const rounds = run.rounds.filter((r) => {
      const ts = [r.startedAt, r.endedAt].filter((t) => t !== null);
      return ts.some((t) => inWindow(t, since, now));
    });
    const roundUsd = rounds.filter((r) => r.usd !== null);
    const whole = run.startedAt !== null && run.startedAt >= since && typeof run.cost?.usd === 'number';
    const usd = whole ? run.cost.usd
      : roundUsd.length ? Math.round(roundUsd.reduce((a, r) => a + r.usd, 0) * 1e6) / 1e6 : null;
    out.push({
      run: run.run,
      goal: run.goal,
      state: run.state,
      rounds: rounds.length,
      scores: windowScores(run, since, now),
      stop: run.stop ? run.stop.reason : null,
      prs: run.artifacts
        .filter((a) => a.kind === 'pr' && (a.ts === null || inWindow(a.ts, since, now)))
        .map((a) => a.url),
      usd,
      usage: run.usage,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
    });
  }
  return out;
}
