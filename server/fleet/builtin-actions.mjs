// Built-in v1 actions (fleet plan §2 2.6: the rows with a "calls" entry, plus the hub-only `broadcast` that a
// builder refuses). REVIEW-REQUIRED (SR5).
//
// Each registration is an allowlist: strict args, no shell strings, no free paths except `spawn.dir`, which is
// resolved with realpath and must lie inside one of `config.dirRoots`. `launch.repo` must be one of
// `config.repoNames`, `permissionMode` one of `config.fleet.allowedPermissionModes`. The test-only launch
// fields (`fakeTakenSlots`, `localBranch`, `promptOverride`) are not in the schema, so v1 refuses them.
//
// Deps are injected ({actions, launcher, retirer, state, config, capturePane?}) so tests use stubs; the deps
// a dispatch() call carries win over the ones given here, so a later registerBuiltins (or a test server with
// other stubs) never runs against stale modules.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { capturePane as tmuxCapturePane } from '../collector/tmux.mjs';
import { registerAction, has, ActionRefused, cleanTypedText } from './dispatch.mjs';

export const DEFAULT_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan', 'auto']);
export const PROMPTING_STATES = Object.freeze(['waiting_permission', 'waiting_question']);
export const BUILTIN_ACTIONS = Object.freeze(['send-text', 'send-keys', 'interrupt', 'kill', 'restart', 'spawn', 'launch', 'retire', 'broadcast']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_.^-]{1,16}$/;
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,40}$/;
const RESUME_RE = /^[0-9a-f-]{8,40}$/i;
const SESSION_RE = /^[A-Za-z0-9 _.()-]{1,64}$/;
const LANE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const JOB_RE = /^[A-Za-z0-9._-]{1,128}$/;
const REPO_PATH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const FKEY_RE = /^[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z0-9 _.()-]{1,64}$/;

const noDotDot = (v) => (v.split('/').includes('..') || v.includes('..') ? 'must not contain ..' : null);

let captured = {};

function permissionModes(config) {
  const m = config?.fleet?.allowedPermissionModes;
  return Array.isArray(m) ? m : DEFAULT_PERMISSION_MODES;
}

/** What the downstream code uses when no mode is given (server/lanes/launch.mjs, server/actions.mjs). */
export const DOWNSTREAM_DEFAULT_MODE = Object.freeze({ launch: 'auto', spawn: 'default' });

/**
 * The permission mode a launch/spawn really runs with (SR5 M1): the requested one, else the downstream default
 * when it is allowed, else the first allowed mode. Always one of `fleet.allowedPermissionModes`; with none
 * allowed it refuses (400 bad_args). The result is always passed explicitly, so no downstream fallback is used.
 */
export function effectivePermissionMode(requested, action, config) {
  const allowed = permissionModes(config).filter((m) => typeof m === 'string' && m);
  if (requested !== undefined) {
    if (!allowed.includes(requested)) throw new ActionRefused(400, 'bad_args', 'args.permissionMode is not an allowed value');
    return requested;
  }
  const dflt = DOWNSTREAM_DEFAULT_MODE[action];
  if (allowed.includes(dflt)) return dflt;
  if (allowed.length) return allowed[0];
  throw new ActionRefused(400, 'bad_args', 'no permission mode is allowed on this builder (fleet.allowedPermissionModes)');
}

// Config of this call: the dispatch-time config, else the one given to registerBuiltins.
function cfgOf(config) {
  return config && typeof config === 'object' && Object.keys(config).length ? config : (captured.config ?? {});
}

// Deps of this call: dispatch-time deps win, the registerBuiltins ones fill gaps.
function D(deps) {
  return { ...captured, ...(deps ?? {}) };
}

function inside(child, root) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** realpath(dir) when it lies inside realpath(some dirRoot); otherwise throws (400 bad_args). Exported for tests. */
export async function resolveSpawnDir(dir, dirRoots) {
  if (!Array.isArray(dirRoots) || dirRoots.length === 0) throw new ActionRefused(400, 'bad_args', 'no dirRoots configured');
  if (!path.isAbsolute(dir)) throw new ActionRefused(400, 'bad_args', 'dir must be an absolute path');
  let real;
  try {
    real = await fsp.realpath(dir);
  } catch {
    throw new ActionRefused(400, 'bad_args', 'dir does not exist');
  }
  for (const root of dirRoots) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) continue;
    let realRoot;
    try { realRoot = await fsp.realpath(root); } catch { continue; }
    if (inside(real, realRoot)) return real;
  }
  throw new ActionRefused(400, 'bad_args', 'dir is outside the configured dirRoots');
}

/** States in which a session's main pane is not a live Claude (SR20 M1). */
export const NOT_CLAUDE_STATES = Object.freeze(['shell', 'dead', 'unknown']);
/** promptReadiness() values that mean a dialog is on screen. */
export const DIALOG_READINESS = Object.freeze(['trust_dialog', 'dialog']);

/** Foreground commands that are a shell: typed text there runs as a command line (SR20 M1). */
export const SHELL_COMMANDS = Object.freeze(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'xonsh']);
/** A native Claude Code binary is installed as `versions/<semver>`, so tmux reports e.g. `2.1.301`. */
const VERSIONED_BINARY = /^\d+\.\d+\.\d+([.-][\w.]+)?$/;

/** True when a pane's foreground command is a known shell, including a login shell (`-bash`). */
export function isShellCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  const base = cmd.replace(/^-/, '').split('/').pop();
  return SHELL_COMMANDS.includes(base);
}

/**
 * Foreground commands that may be Claude only when the pid proves it (SR21 M1): an npm-installed Claude Code runs
 * as `node`. Anything else that is not `claude` or a versioned binary name (python3, ssh, psql, vim, sudo, ...)
 * is never Claude, whatever the registry says: the registry matches by tmux session name, so a Claude in another
 * pane of the session sets `claude.pid` while the main pane runs a REPL.
 */
export const PID_MATCH_COMMANDS = Object.freeze(['node']);

function validPid(p) {
  return Number.isInteger(p) && p > 0 && p <= 0x3fffffff;
}

/**
 * foregroundPgid(pid, read) -> the foreground process group (tpgid) of the terminal `pid` is attached to, or
 * null. Reads /proc/<pid>/stat; the comm field may contain spaces and ')' so fields are split after the LAST ')'.
 * Never throws.
 */
export function foregroundPgid(pid, read = fs.readFileSync) {
  try {
    if (!validPid(pid)) return null;
    const text = String(read(`/proc/${pid}/stat`, 'utf8'));
    const close = text.lastIndexOf(')');
    if (close < 0) return null;
    // after comm: state ppid pgrp session tty_nr tpgid ...
    const f = text.slice(close + 1).trim().split(/\s+/);
    const tpgid = Number(f[5]);
    return validPid(tpgid) ? tpgid : null;
  } catch {
    return null;
  }
}

/**
 * True when `session` looks like a Claude agent session for the kill switch's victim selection (the N1-fix rule):
 * kind `claude`, a live state, a main-pane command that is not a shell, and that command is `claude`, a versioned
 * binary name, or the session has a live registry pid. Deliberately WIDER than isLiveClaude: a kill must not
 * spare an agent because a REPL is the main pane. Never use it to decide whether typed text is safe.
 */
export function isClaudeAgentSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.kind !== 'claude') return false;
  if (typeof session.state !== 'string' || !session.state || NOT_CLAUDE_STATES.includes(session.state)) return false;
  const cmd = session.paneCmd;
  if (typeof cmd !== 'string' || !cmd || isShellCommand(cmd)) return false;
  return cmd === 'claude' || VERSIONED_BINARY.test(cmd) || Boolean(session.claude?.pid);
}

/**
 * True when `session` is a live Claude session (SR20 M1, SR21 M1): kind `claude`, a state that is not
 * shell/dead/unknown, and the main pane's foreground process IS Claude:
 *   - its command is `claude` or a versioned native binary name (`2.1.301`: ~/.local/bin/claude links to
 *     versions/<semver>, N1-fix); or
 *   - its command is in PID_MATCH_COMMANDS (`node`) AND the registry pid is the main pane's own process
 *     (`session.panePid`, tmux #{pane_pid}) or the foreground process group of the main pane's terminal.
 * Anything else, including a missing paneCmd, a shell, an interpreter, a remote shell or an editor, is false:
 * typed text there would run as a command. `deps.fgPgid(panePid)` is injectable for tests.
 */
export function isLiveClaude(session, deps = {}) {
  if (!session || typeof session !== 'object') return false;
  if (session.kind !== 'claude') return false;
  if (typeof session.state !== 'string' || !session.state || NOT_CLAUDE_STATES.includes(session.state)) return false;
  const cmd = session.paneCmd;
  if (typeof cmd !== 'string' || !cmd || isShellCommand(cmd)) return false;
  if (cmd === 'claude' || VERSIONED_BINARY.test(cmd)) return true;
  if (!PID_MATCH_COMMANDS.includes(cmd)) return false;
  const pid = session.claude?.pid;
  const panePid = session.panePid;
  if (!validPid(pid) || !validPid(panePid)) return false;
  if (pid === panePid) return true;
  const fg = typeof deps?.fgPgid === 'function' ? deps.fgPgid : foregroundPgid;
  let pgid = null;
  try { pgid = fg(panePid); } catch { pgid = null; }
  return validPid(pgid) && pgid === pid;
}

/**
 * The guard before typing into a session (send-text with guardPrompt, send-review). Throws ActionRefused 409:
 *   - `no_pane` when there is no session or pane;
 *   - `not_claude` unless isLiveClaude(session);
 *   - `prompting` on a permission/question state, awaitingApproval, a dialog on screen, a capture that fails,
 *     or a screen that is neither the ready input box nor a `working` session (fail safe: unknown refuses).
 *   - `paused` when `opts.refusePaused` and the session (or the builder) is paused (SR18 M1).
 * `deps` = {state: {promptReadiness}, capturePane?, fgPgid?}. Resolves when typing is allowed.
 */
export async function assertTypable(session, deps = {}, opts = {}) {
  const prompting = () => new ActionRefused(409, 'prompting', 'the session is prompting', { ok: false, skipped: 'prompting' });
  if (!session?.paneId) throw new ActionRefused(409, 'no_pane', 'the session has no pane', { ok: false, skipped: 'no_pane' });
  if (!isLiveClaude(session, deps)) {
    throw new ActionRefused(409, 'not_claude', 'the session is not a live Claude session', { ok: false, skipped: 'not_claude' });
  }
  if (opts.refusePaused && session.paused) throw new ActionRefused(409, 'paused', 'the session is paused', { ok: false, skipped: 'paused' });
  if (PROMPTING_STATES.includes(session.state) || session.awaitingApproval) throw prompting();
  if (typeof deps.state?.promptReadiness !== 'function') throw prompting(); // cannot tell: fail safe
  const capture = deps.capturePane ?? tmuxCapturePane;
  let lines;
  try {
    lines = await capture(session.paneId, { ansi: true });
  } catch {
    throw prompting();
  }
  const r = deps.state.promptReadiness(Array.isArray(lines) ? lines : []);
  if (DIALOG_READINESS.includes(r)) throw prompting();
  // Claude Code queues input typed while it works; any other screen is refused.
  if (r !== 'ready' && session.state !== 'working') throw prompting();
}

/** True when a send-text with guardPrompt must not type into this session now. */
export async function isPrompting(session, deps) {
  try {
    await assertTypable(session, deps ?? {}, { refusePaused: true });
    return false;
  } catch (err) {
    if (err instanceof ActionRefused) return true;
    throw err;
  }
}

function sessionNames(state) {
  const list = typeof state?.all === 'function' ? state.all() : [];
  return list.map((s) => s?.name).filter((n) => typeof n === 'string' && !n.startsWith('_laneboard'));
}

/**
 * registerBuiltins({actions, launcher, retirer, state, config, capturePane?}) -> names registered.
 * Safe to call more than once: later calls only replace the default deps.
 */
export function registerBuiltins(deps = {}) {
  captured = { ...deps };
  if (has('send-text')) return [];

  registerAction('send-text', {
    tier: 'click',
    target: 'session',
    args: {
      text: { type: 'string', required: true, min: 1, max: 8000 },
      enter: { type: 'boolean', default: true },
      fanout: { type: 'object', fields: { parent: { type: 'string', required: true, re: UUID_RE } } },
      guardPrompt: { type: 'boolean' },
    },
    // control characters never reach tmux; line breaks follow `enter` (SR5 L3)
    async prepare({ args }) {
      const text = cleanTypedText(args.text, args.enter);
      if (!text.length) throw new ActionRefused(400, 'bad_args', 'args.text is empty after removing control characters');
      return { ...args, text };
    },
    async run({ target, args, user, deps: rd }) {
      const d = D(rd);
      // SR20 M1 / SR18 M1: only a live, unpaused Claude session on its input box (or working) is typed into
      if (args.guardPrompt === true) await assertTypable(d.state.get(target), d, { refusePaused: true });
      return d.actions.sendText(target, args.text, args.enter, user);
    },
  });

  registerAction('send-keys', {
    tier: 'click',
    target: 'session',
    args: { keys: { type: 'array', required: true, min: 1, max: 20, items: { type: 'string', re: KEY_RE } } },
    async run({ target, args, user, deps: rd }) {
      return D(rd).actions.sendKeys(target, args.keys, user);
    },
  });

  registerAction('interrupt', {
    tier: 'click',
    target: 'session-or-all',
    runsAll: true,
    args: { confirm: { type: 'string', max: 128 } },
    async run({ target, user, deps: rd }) {
      const d = D(rd);
      if (target !== '*') {
        await d.actions.sendKeys(target, ['Escape'], user);
        return { ok: true, sent: [target] };
      }
      const sent = [];
      const failed = [];
      for (const name of sessionNames(d.state)) {
        try {
          await d.actions.sendKeys(name, ['Escape'], user);
          sent.push(name);
        } catch (err) {
          failed.push({ name, error: String(err?.message ?? err).slice(0, 200) });
        }
      }
      return { ok: true, sent, failed };
    },
  });

  registerAction('kill', {
    tier: 'confirm',
    target: 'session-or-all',
    // the builder kill switch is never reachable through the local API (README §3.5, S7, S13)
    remoteOnly: (env) => env.target === '*',
    args: { confirm: { type: 'string', required: true, max: 128 } },
    allArgs: {
      graceMs: { type: 'integer', min: 0, max: 600000 },
      include: { type: 'array', max: 50, items: { type: 'string', re: SESSION_RE } },
      cancel: { type: 'string', re: JOB_RE },
    },
    // '*' runs the handler §8 C9 registers with registerAllHandler('kill', fn); without it: 501
    async run({ target, user, deps: rd }) {
      return D(rd).actions.kill(target, user);
    },
  });

  registerAction('restart', {
    tier: 'confirm',
    target: 'session',
    args: { confirm: { type: 'string', required: true, max: 128 } },
    async run({ target, user, deps: rd }) {
      return D(rd).actions.restart(target, user);
    },
  });

  registerAction('spawn', {
    tier: 'ask',
    target: 'session-new',
    args: {
      dir: { type: 'string', required: true, min: 1, max: 4096, check: (v) => (v.includes('\0') ? 'invalid path' : null) },
      prompt: { type: 'string', max: 8000 },
      model: { type: 'string', re: MODEL_RE },
      permissionMode: { type: 'string', enum: (c) => permissionModes(cfgOf(c)) },
      resume: { type: 'string', re: RESUME_RE },
      slot: { type: 'integer', min: 1, max: 9 },
    },
    async prepare({ args, config }) {
      const permissionMode = effectivePermissionMode(args.permissionMode, 'spawn', cfgOf(config));
      return { ...args, permissionMode, dir: await resolveSpawnDir(args.dir, cfgOf(config).dirRoots) };
    },
    async run({ target, args, user, deps: rd }) {
      const { dir, prompt, model, permissionMode, resume, slot } = args;
      return D(rd).actions.spawn({ name: target, dir, prompt, model, permissionMode, resume, slot }, user);
    },
  });

  registerAction('launch', {
    tier: 'ask',
    target: 'lane',
    args: {
      repo: { type: 'string', required: true, enum: (c) => (Array.isArray(cfgOf(c).repoNames) ? cfgOf(c).repoNames : []) },
      plan: { type: 'string', required: true, re: REPO_PATH_RE, check: noDotDot },
      branch: { type: 'string', re: BRANCH_RE, check: noDotDot },
      model: { type: 'string', re: MODEL_RE },
      permissionMode: { type: 'string', enum: (c) => permissionModes(cfgOf(c)) },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      budgetUsd: { type: 'number', min: 0, max: 100000, check: (v) => (v > 0 ? null : 'must be above 0') },
      dryRun: { type: 'boolean' },
      restoredFrom: { type: 'string', re: LANE_RE, check: noDotDot },
    },
    async prepare({ args, config }) {
      return { ...args, permissionMode: effectivePermissionMode(args.permissionMode, 'launch', cfgOf(config)) };
    },
    status: (result, args) => (args.dryRun === true ? 200 : 202),
    async run({ target, args, user, kind, deps: rd }) {
      const req = { lane: target };
      for (const [k, v] of Object.entries(args)) if (v !== undefined) req[k] = v;
      return D(rd).launcher.launch(req, user, { callerKind: kind });
    },
  });

  registerAction('retire', {
    tier: 'confirm',
    target: 'lane',
    args: { confirm: { type: 'string', required: true, max: 128 }, force: { type: 'boolean', default: false } },
    async run({ target, args, user, deps: rd }) {
      return D(rd).retirer.retire(target, { force: args.force, confirm: args.confirm }, user);
    },
  });

  // hub-local (§8 C8); registered here only so a builder refuses it explicitly (400 hub_only)
  registerAction('broadcast', {
    tier: 'confirm',
    target: 'all',
    hubOnly: true,
    allConfirm: false,
    args: {
      targets: { type: 'array', required: true, min: 1, max: 30, items: { type: 'string', re: FKEY_RE } },
      text: { type: 'string', required: true, min: 1, max: 2000 },
      enter: { type: 'boolean', default: true },
      confirmCount: { type: 'integer', required: true, min: 1, max: 30 },
    },
    // the dispatcher enforces broadcast's confirm on the hub path too (SR5 L6): the count the user confirmed can
    // never exceed the targets. The exact rule (confirmCount === planned sends, else 409 with the fresh plan) is
    // the C8 handler's, which only it can plan.
    confirmCheck: ({ args }) => (args.confirmCount > args.targets.length ? 'confirmCount exceeds the targets' : null),
    async run() {
      throw new ActionRefused(400, 'hub_only', 'broadcast runs on the hub only');
    },
  });

  return [...BUILTIN_ACTIONS];
}

/** Tests only. */
export function _resetBuiltins() {
  captured = {};
}
