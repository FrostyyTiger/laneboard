// One row of the runs list (GET /api/runs, server/routes/runs.mjs) from a
// folded run (server/runs/protocol.mjs foldRun). Pure: no database, no config,
// so the demo's forwarder (test/helpers/demo-hub.mjs) can use the real thing.
// `stuck` is the run rules' verdict (server/runs/stuck.mjs, `runs.stuck`).
import { runStuck, DEFAULTS as STUCK_DEFAULTS } from './stuck.mjs';

/** The latest value of a score series and the one before it (the list's trend). */
function lastScore(list, better) {
  const last = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  return { n: last.n, value: last.value, prev: prev ? prev.value : null, better: better ?? null };
}

/**
 * One row of the runs list: what README §3 A2 shows per run, without the
 * per-round detail. `stuck` is `runs.stuck` (false = rules off), `now` the time
 * the deadline rule measures from.
 */
export function summarize(run, { stuck = STUCK_DEFAULTS, now = Date.now() } = {}) {
  const last = run.rounds[run.rounds.length - 1] ?? null;
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
    rounds: run.rounds.length,
    maxRounds: run.budget?.rounds ?? null,
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
