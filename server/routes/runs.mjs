// Route module: runs (docs/plans/runs/README.md §3 A1; protocol in docs/runs.md).
//
//   GET  /api/runs          -> {runs: [summary]}   latest activity first
//   GET  /api/runs/:run     -> {run}               the folded run; 404 if unknown
//   POST /api/runs/events   one event as JSON -> 201 {ok, run, t}; 400 {error} if
//                           parseLine skips it; appended to <stateDir>/runs/<run>.jsonl
//
// Starts the run-file collector (server/collector/runs.mjs) and provides its
// store as the `runs` service. The routes sit behind the normal local guards
// (Host/Origin and the `x-laneboard` header, server/security.mjs), so a loop
// posts through the CLI or writes its file. Builder only: runs on a hub need
// server/hub/* (see PROGRESS "For the owner").
//
// A posted event is written as the object it was, compacted to one line, with
// `ts` set to the server's time when it had none (an API writer has no file
// order to lean on). The run id is checked by parseLine (RUN_ID: letters,
// digits, `._-`, no leading dot), so it is safe as a file name.
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as collector from '../collector/runs.mjs';
import { knownWorktrees } from '../collector/lanes.mjs';
import { config as globalConfig } from '../config.mjs';
import { parseLine, MAX_LINE, RUN_ID } from '../runs/protocol.mjs';

export const LIST_PATH = '/api/runs';
export const RUN_PATH = '/api/runs/:run';
export const EVENTS_PATH = '/api/runs/events';
/** A posted event is one protocol line: a body over 4 × MAX_LINE is not read to the end. */
export const BODY_LIMIT = 4 * MAX_LINE;

/** The latest value of a score series and the one before it (the list's trend). */
function lastScore(list, better) {
  const last = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  return { n: last.n, value: last.value, prev: prev ? prev.value : null, better: better ?? null };
}

/** One row of the runs list: what README §3 A2 shows per run, without the per-round detail. */
export function summarize(run) {
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
    stop: run.stop ? run.stop.reason : null,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

/** The body of GET /api/runs from a store (null before the collector started). */
export function listBody(store) {
  return { runs: store ? store.list().map(summarize) : [] };
}

/**
 * Check one posted body and give the line to append, or why not:
 * `{ok: true, run, t, line}` or `{ok: false, error}`.
 */
export function eventLine(text, now = Date.now()) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  const checked = parseLine(text);
  if (!checked.ok) return { ok: false, error: checked.reason };
  const o = JSON.parse(text);
  if (o.ts === undefined || o.ts === null) o.ts = now;
  const line = JSON.stringify(o);
  // `ts` added or the body compacted: check again what is written.
  if (line.length > MAX_LINE) return { ok: false, error: 'too long' };
  const again = parseLine(line);
  if (!again.ok) return { ok: false, error: again.reason };
  return { ok: true, run: again.event.run, t: again.event.t, line: `${line}\n` };
}

/** `<stateDir>/runs/<run>.jsonl`, or null for an id that is not a safe file name. */
export function eventsFile(stateDir, run) {
  if (typeof stateDir !== 'string' || !stateDir || !RUN_ID.test(run)) return null;
  return path.join(stateDir, 'runs', `${run}.jsonl`);
}

/** Append one checked line to the run's API file (dir 0700, file 0600). */
export async function appendEvent(stateDir, run, line, { fsImpl = fsp } = {}) {
  const file = eventsFile(stateDir, run);
  if (!file) throw new Error('bad run id');
  await fsImpl.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fsImpl.appendFile(file, line, { mode: 0o600 });
  return file;
}

export default {
  name: 'runs',
  modes: ['builder'],
  register(ctx) {
    // The store exists once start() ran; handlers call ctx.use('runs').store().
    ctx.provide('runs', { store: () => collector.store() });

    ctx.route('GET', LIST_PATH, (req, res) => ctx.json(res, listBody(collector.store())));

    ctx.route('GET', RUN_PATH, (req, res) => {
      const id = req.params?.run;
      const run = typeof id === 'string' && RUN_ID.test(id) ? collector.store()?.get(id) : null;
      if (!run) return ctx.json(res, { error: 'unknown run' }, 404);
      return ctx.json(res, { run });
    });

    ctx.route('POST', EVENTS_PATH, async (req, res) => {
      let text;
      try {
        text = (await ctx.readBody(req, BODY_LIMIT)).toString('utf8');
      } catch {
        return ctx.json(res, { error: 'body too large' }, 413);
      }
      const r = eventLine(text);
      if (!r.ok) return ctx.json(res, { error: r.error }, 400);
      const stateDir = (ctx.config ?? globalConfig).stateDir;
      let file;
      try {
        file = await appendEvent(stateDir, r.run, r.line);
      } catch {
        return ctx.json(res, { error: 'could not write the event' }, 500);
      }
      await collector.track(file).catch(() => {});
      return ctx.json(res, { ok: true, run: r.run, t: r.t }, 201);
    });
  },
  start(ctx) {
    const cfg = ctx.config ?? globalConfig;
    collector.start({
      cfg: cfg.runs,
      stateDir: cfg.stateDir,
      laneRoots: () => knownWorktrees().map((w) => w.root),
    });
  },
  stop() {
    collector.stop();
  },
};
