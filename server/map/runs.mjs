// Runs on the Map (docs/map.md "Runs"; runs plan §3 A3): each run the runs
// store knows is a node, `kind: "run"`, id `run:<id>`, with a progress the
// view draws as a ring. Pure: the folded runs (server/runs/protocol.mjs
// foldRun) and the nodes built so far go in, run nodes come out.
//
// - Where: under the machine the run works on when its `run.start` names a
//   `host` and a node of the Map has that name (label or id, any case: a
//   declared node, a discovered VM, a builder); else under the core, the
//   machine whose board reads the run file. A throwaway VM a feed lists
//   carries its run; when the feed no longer lists it, the run falls back
//   to the core and says its host is not on the Map.
// - Progress 0-1: the latest `tasks` score over its latest `max` when a line
//   gave one, else rounds over `budget.rounds`; none when neither is known.
//   The label prints the same numbers the ring draws ("44 of 63").
// - A stopped run stays `runs.mapKeepMin` minutes after its stop, then leaves.
import { runStuck, DEFAULTS as STUCK_DEFAULTS } from '../runs/stuck.mjs';
import { scoreMax } from '../runs/summary.mjs';

export const PREFIX = 'run:';
export const PROGRESS_SCORE = 'tasks';
const MIN = 60 * 1000;
const HOST_KINDS = new Set(['core', 'site', 'host', 'room', 'builder']);
const MAX_TEXT = 120;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clip = (v) => (typeof v === 'string' && v !== '' ? (v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT - 1)}…` : v) : undefined);
const nameKey = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The `tasks` score as {value, max, firstMax} when a line gave it a max; else null. */
export function runTasks(run) {
  const list = run?.scores?.[PROGRESS_SCORE];
  const last = Array.isArray(list) && list.length ? list[list.length - 1] : null;
  const { max, firstMax } = scoreMax(list);
  if (!last || num(last.value) === null || max === null) return null;
  return { value: last.value, max, firstMax };
}

/** 0-1 from the `tasks` score's max, else rounds / budget.rounds; null when unknown. */
export function runProgress(run) {
  const t = runTasks(run);
  if (t) return Math.round(clamp01(t.value / t.max) * 100) / 100;
  const max = num(run?.budget?.rounds);
  // a wrap-up round (after run.stop) is not one of the budget's rounds (runs-n5 T3/T4)
  const done = Number.isInteger(run?.counted) ? run.counted : (run.rounds ?? []).filter((r) => !r?.wrapup).length;
  if (max > 0) return Math.round(clamp01(done / max) * 100) / 100;
  return null;
}

/** The node's status word: grey unless it is stuck or stopped on an error. */
function statusOf(run, stuck) {
  if (run.state === 'stopped') return run.stop?.reason === 'error' ? 'crit' : 'idle';
  if (stuck) return 'warn';
  return run.state === 'waiting' ? 'idle' : 'working';
}

const stoppedAt = (run) => num(run.stop?.ts) ?? num(run.updatedAt);

/**
 * Run nodes for the Map. `runs` are folded runs, `nodes` the Map's nodes so
 * far (to find a run's host), `coreId` the fallback parent, `keepMin` is
 * `runs.mapKeepMin`, `stuck` is `runs.stuck`.
 */
export function runNodes(runs, { nodes = [], coreId = '__core', now = Date.now(), keepMin = 60, stuck = STUCK_DEFAULTS } = {}) {
  if (!Array.isArray(runs) || !runs.length) return [];
  const hosts = new Map();
  for (const n of nodes) {
    if (!n || !HOST_KINDS.has(n.kind)) continue;
    const keys = [nameKey(n.label), nameKey(n.id), n.kind === 'builder' ? nameKey(String(n.id).replace(/^builder:/, '')) : null];
    for (const k of keys) if (k && !hosts.has(k)) hosts.set(k, n.id);
  }
  const keepMs = (num(keepMin) ?? 60) * MIN;
  const out = [];
  const seen = new Set();
  for (const run of runs) {
    if (!run || typeof run.run !== 'string' || seen.has(run.run)) continue;
    if (run.state === 'stopped') {
      const at = stoppedAt(run);
      if (keepMs === 0 || at === null || now - at > keepMs) continue;
    }
    seen.add(run.run);
    const s = runStuck(run, stuck, now);
    const host = clip(run.host);
    const parent = (host && hosts.get(nameKey(host))) || coreId;
    const counted = run.rounds?.findLast?.((r) => !r.wrapup);
    const round = counted ? counted.n : null;
    const maxRounds = num(run.budget?.rounds);
    const progress = runProgress(run);
    const tasks = runTasks(run);
    const detail = {};
    if (run.goal) detail.Goal = clip(run.goal);
    if (round !== null) detail.Round = maxRounds ? `${round} / ${maxRounds}` : String(round);
    if (tasks) detail.Tasks = `${tasks.value} of ${tasks.max}${tasks.firstMax !== tasks.max ? ` (scope ${tasks.firstMax} → ${tasks.max})` : ''}`;
    if (progress !== null) detail.Progress = `${Math.round(progress * 100)} %`;
    if (host) detail.Host = parent === coreId && !hosts.has(nameKey(host)) ? `${host} (not on the Map)` : host;
    out.push({
      id: `${PREFIX}${run.run}`,
      kind: 'run',
      parent,
      label: run.run,
      status: statusOf(run, s),
      why: s ? s.reason : run.state === 'stopped' ? `stopped: ${run.stop?.reason ?? 'unknown'}` : undefined,
      sub: clip(run.goal),
      run: run.run,
      goal: clip(run.goal),
      state: run.state,
      round,
      maxRounds,
      tasks,
      progress,
      stuck: s,
      detail: Object.keys(detail).length ? detail : undefined,
      href: `#/runs?run=${encodeURIComponent(run.run)}`,
    });
  }
  return out;
}
