// Route module: runs (docs/plans/runs/README.md §3 A1; protocol in docs/runs.md).
//
//   GET  /api/runs          -> {runs: [summary]}   latest activity first
//   GET  /api/runs/:run     -> {run}               the folded run, each round with the
//                           sessions tied to it (server/runs/bind.mjs); 404 if unknown
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
import { bindRuns, runDirs, withSessions } from '../runs/bind.mjs';
import { summarize } from '../runs/summary.mjs';
import { sessionsSeen } from '../db.mjs';
import { setRunsSource } from '../map.mjs';

export const LIST_PATH = '/api/runs';
export const RUN_PATH = '/api/runs/:run';
export const EVENTS_PATH = '/api/runs/events';
/** A posted event is one protocol line: a body over 4 × MAX_LINE is not read to the end. */
export const BODY_LIMIT = 4 * MAX_LINE;

// `summarize` lives in server/runs/summary.mjs (pure: the demo's forwarder
// uses it without opening the database); re-exported for the callers here.
export { summarize };

/**
 * One run with its rounds' sessions. Every run of the store takes part in the
 * bind (two runs in one dir make a guess a `maybe`); the sessions are the ones
 * heard from while this run was active. `seen(since, until)` is the source
 * (db.sessionsSeen); when it fails the run is given with no sessions.
 */
export function runWithSessions(store, run, { seen = sessionsSeen, now = Date.now() } = {}) {
  const since = run.startedAt;
  if (since === null) return withSessions(run, null);
  const until = run.state === 'stopped' ? (run.stop?.ts ?? run.updatedAt ?? now) : now;
  let sessions;
  try { sessions = seen(since, Math.max(since, until)); } catch { sessions = []; }
  const files = (id) => (typeof store?.filesOf === 'function' ? store.filesOf(id) : []);
  const others = (store?.list?.() ?? []).filter((r) => r.run !== run.run);
  const runs = [run, ...others].map((r) => ({ run: r, dirs: runDirs(r, files(r.run)) }));
  return withSessions(run, bindRuns(runs, sessions, now));
}

/**
 * The body of GET /api/runs from a store (null before the collector started).
 * `opts` go to summarize: `{stuck}` is `runs.stuck`, `{now}` the time.
 */
export function listBody(store, opts = {}) {
  return { runs: store ? store.list().map((run) => summarize(run, opts)) : [] };
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

    ctx.route('GET', LIST_PATH, (req, res) => {
      const cfg = ctx.config ?? globalConfig;
      return ctx.json(res, listBody(collector.store(), { stuck: cfg.runs?.stuck }));
    });

    ctx.route('GET', RUN_PATH, (req, res) => {
      const id = req.params?.run;
      const run = typeof id === 'string' && RUN_ID.test(id) ? collector.store()?.get(id) : null;
      if (!run) return ctx.json(res, { error: 'unknown run' }, 404);
      return ctx.json(res, { run: runWithSessions(collector.store(), run) });
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
    // The Map draws each run as a node (server/map/runs.mjs).
    setRunsSource(() => collector.store()?.list() ?? []);
  },
  stop() {
    setRunsSource(null);
    collector.stop();
  },
};
