// One row of the runs list (GET /api/runs, server/routes/runs.mjs) from a
// folded run (server/runs/protocol.mjs foldRun). Pure: no database, no config,
// so the demo's forwarder (test/helpers/demo-hub.mjs) can use the real thing.
// `stuck` is the run rules' verdict (server/runs/stuck.mjs, `runs.stuck`).
import { runStuck, DEFAULTS as STUCK_DEFAULTS } from './stuck.mjs';

/**
 * The max of a score series: the latest one a line gave and the first one, so
 * a moved max (scope that grew or shrank, research Q18) shows; nulls when no
 * line gave one.
 */
export function scoreMax(list) {
  const maxes = (Array.isArray(list) ? list : []).map((p) => p?.max).filter((m) => typeof m === 'number' && m > 0);
  return { max: maxes.length ? maxes[maxes.length - 1] : null, firstMax: maxes.length ? maxes[0] : null };
}

/** The latest value of a score series, the one before it (the list's trend) and its max. */
function lastScore(list, better) {
  const last = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  return { n: last.n, value: last.value, prev: prev ? prev.value : null, better: better ?? null, ...scoreMax(list) };
}

/**
 * One row of the runs list: what README §3 A2 shows per run, without the
 * per-round detail. `stuck` is `runs.stuck` (false = rules off), `now` the time
 * the deadline rule measures from.
 */
export function summarize(run, { stuck = STUCK_DEFAULTS, now = Date.now() } = {}) {
  // A wrap-up round (after run.stop) is not one of the budget's rounds: "63 of 63", never "64 of 63".
  const last = run.rounds.findLast((r) => !r.wrapup) ?? null;
  const scores = {};
  for (const [name, list] of Object.entries(run.scores)) {
    if (list.length) scores[name] = lastScore(list, run.better[name]);
  }
  return {
    run: run.run,
    goal: run.goal,
    plan: run.plan,
    branch: run.branch,
    state: run.state,
    round: last ? last.n : null,
    rounds: run.counted ?? run.rounds.length,
    wrapup: run.rounds[run.rounds.length - 1]?.wrapup === true,
    maxRounds: run.budget?.maxRounds ?? run.budget?.rounds ?? null,
    scores,
    usage: run.usage,
    cost: run.cost,
    deadline: run.deadline,
    deadlineAt: run.deadlineAt,
    needs: run.needs.filter((n) => n.open),
    artifacts: run.artifacts.length,
    prs: run.artifacts.filter((a) => a.kind === 'pr').map((a) => ({ url: a.url, title: a.title, state: a.state ?? null, ts: a.ts })),
    stop: run.stop ? run.stop.reason : null,
    stopUsd: typeof run.stop?.usd === 'number' ? run.stop.usd : null,
    stuck: runStuck(run, stuck, now),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}
