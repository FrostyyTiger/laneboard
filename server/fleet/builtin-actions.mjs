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

import fsp from 'node:fs/promises';
import path from 'node:path';
import { capturePane as tmuxCapturePane } from '../collector/tmux.mjs';
import { registerAction, has, ActionRefused } from './dispatch.mjs';

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

/** True when a send-text with guardPrompt must not type into this session now. */
export async function isPrompting(session, deps) {
  if (!session) return true;
  if (PROMPTING_STATES.includes(session.state) || session.awaitingApproval) return true;
  if (typeof deps.state?.promptReadiness !== 'function') return true; // cannot tell: fail safe
  const capture = deps.capturePane ?? tmuxCapturePane;
  let lines;
  try {
    lines = await capture(session.paneId, { ansi: true });
  } catch {
    return true;
  }
  return deps.state.promptReadiness(Array.isArray(lines) ? lines : []) !== 'ready';
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
    async run({ target, args, user, deps: rd }) {
      const d = D(rd);
      if (args.guardPrompt === true && await isPrompting(d.state.get(target), d)) {
        throw new ActionRefused(409, 'prompting', 'the session is prompting', { ok: false, skipped: 'prompting' });
      }
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
      return { ...args, dir: await resolveSpawnDir(args.dir, cfgOf(config).dirRoots) };
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
      budgetUsd: { type: 'number', min: 0, max: 100000 },
      dryRun: { type: 'boolean' },
      restoredFrom: { type: 'string', re: LANE_RE, check: noDotDot },
    },
    status: (result, args) => (args.dryRun === true ? 200 : 202),
    async run({ target, args, user, deps: rd }) {
      const req = { lane: target };
      for (const [k, v] of Object.entries(args)) if (v !== undefined) req[k] = v;
      return D(rd).launcher.launch(req, user);
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
