// Run scripts (fleet plan §10 2.8, R8). REVIEW-REQUIRED (SR20).
//
// A lane can run one of the commands its repo lists in the builder's own
// config (`repos[].scripts`, validated and frozen by server/config/review.mjs)
// in a background tmux window of the lane session, inside the lane worktree,
// with the lane's slot environment. The rules:
//
//   1. no command text ever comes from the request: the wire carries a script
//      NAME (SCRIPT_NAME_RE), looked up with Object.hasOwn in the frozen
//      null-prototype scripts object of the lane's repo. Anything else is a 400
//      `unknown_script` and nothing is spawned;
//   2. the lane (repo, root, slot, session) comes from its lane.json, never from
//      the request; the root must be an absolute directory inside codeDir;
//   3. the window is `run-<name>` (RUN_WINDOW_RE), created with `-d` so the
//      agent's window stays current, `-c <root>`, and `remain-on-exit on` in the
//      same tmux invocation, so the output stays readable after it exits. Every
//      session target is exact (`=sess`, `=sess:=run-<name>`);
//   4. the slot exports are eval'd in the window's shell exactly as
//      actions.spawn does (slots.envCommand + shellQuote). Before anything is
//      spawned the same prefix is evaluated once in a probe shell and the
//      result checked like a launch (checkLaneEnv): a DB URL on a forbidden
//      port, or a slot env without its own Postgres port, refuses the run;
//   5. a live `run-<name>` window is reported `alreadyRunning`; a dead one
//      (remain-on-exit) is replaced;
//   6. stopScript kills only a window whose name matches RUN_WINDOW_RE, by its
//      window id, in the lane's own session.
//
// The dispatcher (server/fleet/dispatch.mjs) audits every call; the action is
// registered by server/routes/scripts.mjs (tier ask, target lane).
//
// Deps are injectable ({run, readLane, repos, slots, codeDir, nodeBin,
// forbiddenPorts, probeEnv}) so tests stub tmux and the slot provider.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { isSafeSessionName } from '../util.mjs';
import { runTmux, exactTarget, RUN_WINDOW_RE, framedFormat } from '../collector/tmux.mjs';
import { slots as slotProvider } from '../providers/index.mjs';
import { shellQuote } from '../actions.mjs';
import * as store from '../lanes/store.mjs';
import { checkLaneEnv, parseEnviron, urlPort, DB_VARS, forbiddenPorts as liveForbiddenPorts } from '../lanes/launch.mjs';
import { run as liveRun } from '../util.mjs';
import { SCRIPT_NAME_RE } from '../config/review.mjs';
import { ActionRefused } from '../fleet/dispatch.mjs';

export { SCRIPT_NAME_RE, RUN_WINDOW_RE };
export const WINDOW_PREFIX = 'run-';
const LIST_FIELDS = ['#{window_id}', '#{window_index}', '#{pane_dead}', '#{window_name}'];

/** The window a script runs in. */
export function windowFor(name) {
  return `${WINDOW_PREFIX}${name}`;
}

function liveDeps() {
  return {
    run: runTmux,
    readLane: (id) => store.read(id),
    repos: () => config.repos,
    slots: slotProvider,
    codeDir: config.codeDir,
    nodeBin: config.nodeBin,
    forbiddenPorts: liveForbiddenPorts,
    probeEnv: defaultProbeEnv,
  };
}

let captured = {};

/** Live deps, then the ones given at registration, then the per-call ones. */
export function depsOf(deps) {
  return { ...liveDeps(), ...captured, ...(deps ?? {}) };
}

/** Registration-time deps (server/routes/scripts.mjs). */
export function setDeps(deps = {}) {
  captured = { ...deps };
}

/** Tests only. */
export function _resetDeps() {
  captured = {};
}

function inside(child, root) {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The command for script `name` of lane record `rec`: {cmd, root, repo}, or an
 * ActionRefused. The command comes only from `repos` (the builder's config).
 */
export function resolveScript(rec, name, repos = config.repos) {
  if (typeof name !== 'string' || !SCRIPT_NAME_RE.test(name)) throw new ActionRefused(400, 'bad_args', 'invalid script name');
  if (!rec || typeof rec !== 'object') throw new ActionRefused(404, 'unknown_lane', 'no such lane');
  if (rec.retiredAt) throw new ActionRefused(409, 'retired', 'the lane is retired');
  const repo = typeof rec.repo === 'string' ? rec.repo : '';
  const list = Array.isArray(repos) ? repos : [];
  const repoCfg = repo ? list.find((r) => r && typeof r === 'object' && r.name === repo) : null;
  const scripts = repoCfg?.scripts;
  if (!scripts || typeof scripts !== 'object' || !Object.hasOwn(scripts, name)) {
    throw new ActionRefused(400, 'unknown_script', `no script ${JSON.stringify(name)} is configured for this lane's repo`);
  }
  const cmd = scripts[name];
  if (typeof cmd !== 'string' || !cmd.trim() || /[\0\r\n]/.test(cmd)) throw new ActionRefused(500, 'bad_script', 'the configured script is not a valid command');
  const root = rec.root;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root) {
    throw new ActionRefused(409, 'no_worktree', 'the lane has no usable worktree');
  }
  return { cmd, root, repo };
}

/** {name: [script names]} of every configured repo with scripts (hello.scripts). Names only. */
export function scriptNames(repos = config.repos) {
  const out = {};
  for (const r of Array.isArray(repos) ? repos : []) {
    if (!r || typeof r.name !== 'string' || !r.scripts || typeof r.scripts !== 'object') continue;
    const names = Object.keys(r.scripts).filter((n) => SCRIPT_NAME_RE.test(n)).sort();
    if (names.length) out[r.name] = names;
  }
  return out;
}

/** The lane's tmux session name and its lane record. */
function laneOf(laneId, d) {
  if (!store.isLaneId(laneId)) throw new ActionRefused(400, 'bad_target', 'invalid lane id');
  const rec = d.readLane(laneId);
  if (!rec) throw new ActionRefused(404, 'unknown_lane', 'no such lane');
  if (rec.retiredAt) throw new ActionRefused(409, 'retired', 'the lane is retired');
  const session = typeof rec.session === 'string' && rec.session ? rec.session : laneId;
  if (!isSafeSessionName(session)) throw new ActionRefused(409, 'bad_session', 'the lane session name is not valid');
  return { rec, session };
}

/** [{id, index, dead, name}] of the session's windows; refuses when the session is gone. */
export async function listWindows(session, d) {
  // SR20 L4: framed rows (a window name cannot forge one); only `@N` ids and integer indexes.
  const { fmt, parse } = framedFormat(LIST_FIELDS);
  const r = await d.run(['list-windows', '-t', `${exactTarget(session)}:`, '-F', fmt], { timeout: 5000 });
  if (!r?.ok) throw new ActionRefused(409, 'no_session', 'the lane session is not running');
  return parse(r.stdout).filter(([id, index]) => /^@\d+$/.test(id) && /^\d{1,6}$/.test(index))
    .map(([id, index, dead, name]) => ({ id, index: Number(index), dead: dead === '1', name }));
}

/** The environment the window's shell will see: `<prefix> env -0` in a probe shell. */
export async function defaultProbeEnv(prefix, root) {
  const r = await liveRun('sh', ['-c', `${prefix}env -0`], { cwd: root, timeout: 20000, env: process.env });
  if (!r.ok) return null;
  return parseEnviron(r.stdout);
}

/**
 * The forbidden-port check (2.8 step 5): {ok, reason}. With a slot it is
 * launch's checkLaneEnv (DATABASE_ADMIN_URL set, on the slot's Postgres port,
 * no DB URL on a forbidden port); without one, only the forbidden ports.
 */
export function checkScriptEnv(env, { slot, expectPgPort, forbidden }) {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'could not determine the script environment' };
  if (slot != null) return checkLaneEnv(env, expectPgPort ?? null, forbidden);
  for (const k of DB_VARS) {
    const p = urlPort(env[k]);
    if (p != null && forbidden.includes(p)) return { ok: false, reason: `${k} points at :${p}, which is forbidden` };
  }
  return { ok: true, reason: null };
}

/** The shell text the window runs: PATH, slot env, the command, an exit line. */
export function windowScript({ name, cmd, envCmd = '', nodeBin }) {
  const pathLine = nodeBin ? `PATH=${shellQuote(nodeBin)}:"$PATH"; export PATH` : '';
  // One line each: a `#` in the configured command can only comment out its
  // own line. The subshell keeps an `exit` in the command from skipping the
  // exit line.
  return [pathLine, envCmd, '(', cmd, ')', 's=$?', 'echo', `echo "[${name} exited $s]"`].filter(Boolean).join('\n');
}

/**
 * Run script `name` in lane `laneId`.
 *   -> {ok, window: 'run-<name>', windowIndex, alreadyRunning}
 */
export async function runScript(laneId, name, who, deps) {
  const d = depsOf(deps);
  const { rec, session } = laneOf(laneId, d);
  const { cmd, root } = resolveScript(rec, name, typeof d.repos === 'function' ? d.repos() : d.repos);
  const window = windowFor(name);
  if (!RUN_WINDOW_RE.test(window)) throw new ActionRefused(400, 'bad_args', 'invalid script name');

  // The root: a real directory inside codeDir.
  let st;
  try { st = await fsp.stat(root); } catch { st = null; }
  if (!st?.isDirectory()) throw new ActionRefused(409, 'no_worktree', 'the lane worktree does not exist');
  if (typeof d.codeDir === 'string' && d.codeDir && !inside(root, path.resolve(d.codeDir))) {
    throw new ActionRefused(409, 'no_worktree', 'the lane worktree is not under the code directory');
  }

  const windows = await listWindows(session, d);
  const existing = windows.filter((w) => w.name === window);
  const alive = existing.find((w) => !w.dead);
  if (alive) return { ok: true, window, windowIndex: alive.index, alreadyRunning: true };

  // The slot environment, checked before anything is spawned.
  const slot = Number.isInteger(rec.slot) ? rec.slot : null;
  const envCmd = slot != null && typeof d.slots?.envCommand === 'function' ? d.slots.envCommand(slot, shellQuote) : '';
  const pathPrefix = d.nodeBin ? `PATH=${shellQuote(d.nodeBin)}:"$PATH"; export PATH; ` : '';
  const env = await d.probeEnv(`${pathPrefix}${envCmd}`, root);
  const forbidden = typeof d.forbiddenPorts === 'function' ? d.forbiddenPorts() : (d.forbiddenPorts ?? []);
  const expectPgPort = slot != null ? (d.slots?.ports?.(slot)?.pg ?? null) : null;
  const verdict = checkScriptEnv(env, { slot: envCmd ? slot : null, expectPgPort, forbidden: Array.isArray(forbidden) ? forbidden : [] });
  if (!verdict.ok) throw new ActionRefused(409, 'forbidden_env', `refusing to run ${name}: ${verdict.reason}`);

  // A finished run's window (remain-on-exit) makes way for the new one.
  for (const w of existing) await d.run(['kill-window', '-t', w.id], { timeout: 5000 });

  const script = windowScript({ name, cmd, envCmd, nodeBin: d.nodeBin });
  const exact = `${exactTarget(session)}:=${window}`;
  const r = await d.run([
    'new-window', '-d', '-P', '-F', '#{window_index}', '-t', `${exactTarget(session)}:`, '-n', window, '-c', root,
    '--', 'sh', '-c', script,
    ';', 'set-option', '-w', '-t', exact, 'remain-on-exit', 'on',
  ], { timeout: 10000 });
  if (!r?.ok) throw new ActionRefused(500, 'tmux_failed', 'could not open the script window');
  const windowIndex = Number(String(r.stdout ?? '').trim().split('\n')[0]);
  return { ok: true, window, windowIndex: Number.isInteger(windowIndex) ? windowIndex : null, alreadyRunning: false };
}

/**
 * Stop script `name` in lane `laneId`: kill its `run-<name>` window (only a
 * window matching RUN_WINDOW_RE, by id). -> {ok, window, stopped}
 */
export async function stopScript(laneId, name, who, deps) {
  const d = depsOf(deps);
  if (typeof name !== 'string' || !SCRIPT_NAME_RE.test(name)) throw new ActionRefused(400, 'bad_args', 'invalid script name');
  const window = windowFor(name);
  if (!RUN_WINDOW_RE.test(window)) throw new ActionRefused(400, 'bad_args', 'not a script window');
  const { session } = laneOf(laneId, d);
  const windows = await listWindows(session, d);
  const hits = windows.filter((w) => w.name === window && RUN_WINDOW_RE.test(w.name) && /^@\d+$/.test(w.id));
  for (const w of hits) {
    const r = await d.run(['kill-window', '-t', w.id], { timeout: 5000 });
    if (!r?.ok) throw new ActionRefused(500, 'tmux_failed', 'could not stop the script window');
  }
  return { ok: true, window, stopped: hits.length > 0 };
}
