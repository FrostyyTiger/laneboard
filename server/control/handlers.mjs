// Control actions: pause, resume, approve, deny, release (fleet plan §8 2.2/2.3, README §3.5).
// REVIEW-REQUIRED (SR16).
//
// Registered with §2's dispatcher (server/fleet/dispatch.mjs registerAction) by the route module
// server/routes/control.mjs. The dispatcher owns the order of checks and the audit entries; these handlers
// only do the work once every check passed.
//
// Security (SECURITY-FIXES S7, S19):
//   - approve / deny / release are `remoteOnly: true`: refused for `local` (403 remote-only), so an agent on
//     the builder cannot answer its own permission request through the local API. A `direct` user (serve) or
//     a hub request with the `control` scope (and fleet.hubControl) may decide.
//   - decide() is always called with `target` (the action's session): an approval of another session is
//     refused 409 and stays pending (S19).
//   - resume is remote-only by predicate: with `override`, or when the target (or the builder-wide `ALL`
//     sentinel) is held by a `budget`/`quota` pause. The predicate reads the sentinel kind from
//     config.stateDir and fails closed (any error refuses). The run step repeats the rule: without an
//     override (and always for `local`) it lifts only `kind:'operator'` sentinels, so a budget pause written
//     between the predicate and the run is kept (409).
//   - pause * / resume * need `args.confirm === fleet.id` (the dispatcher's '*' rule; `fleet` is refused).
//   These controls are cooperative on the builder itself: anything running as this uid can delete the
//   sentinel files (docs/fleet/control.md, SECURITY.md).
//
// The state dir always comes from config.stateDir and is passed explicitly to pause.mjs (its
// defaultStateDir ignores XDG_STATE_HOME). After every sentinel write the paused flag's cache is dropped
// (flags/paused.mjs invalidate), so the next snapshot shows the change.
//
// Deps (injected, as in builtin-actions.mjs): {actions, state, config, capturePane?, approvals?}; the deps a
// dispatch() call carries win over the ones given to registerControlActions.

import { registerAction, has, ActionRefused } from '../fleet/dispatch.mjs';
import * as pause from './pause.mjs';
import * as approvalsCore from './approvals.mjs';
import { invalidate as invalidatePaused } from '../flags/paused.mjs';
import { capturePane as tmuxCapturePane } from '../collector/tmux.mjs';

export const CONTROL_ACTIONS = Object.freeze(['pause', 'resume', 'approve', 'deny', 'release']);
/** Pause kinds only a remote user may lift (README §3.5, S7). */
export const REMOTE_ONLY_KINDS = Object.freeze(['budget', 'quota']);
/** Session states in which resume nudges with "continue" (§8 2.3). */
export const NUDGE_STATES = Object.freeze(['done', 'idle']);
export const NUDGE_TEXT = 'continue';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;
const NOTE_MAX = 500;
const ERR_MAX = 200;
// C0 controls, DEL, C1 controls: never into a sentinel (it is shown on the board).
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

let captured = {};

function D(deps) {
  return { ...captured, ...(deps ?? {}) };
}

function cfgOf(config, deps) {
  if (config && typeof config === 'object' && Object.keys(config).length) return config;
  return D(deps).config ?? {};
}

/** config.stateDir, or a refusal: pause.mjs must never fall back to its own default. */
export function stateDirOf(config) {
  const dir = config?.stateDir;
  if (typeof dir !== 'string' || dir === '') throw new ActionRefused(500, 'no-state-dir', 'config.stateDir is not set');
  return dir;
}

function errText(err) {
  return String(err?.message ?? err).toWellFormed().replace(CONTROL_RE, ' ').slice(0, ERR_MAX);
}

function cleanReason(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, REASON_MAX) : null;
}

/** The sentinel scopes that hold `target`: '*' is the builder-wide one; a session is also held by ALL. */
export function heldScopes(target) {
  return target === '*' ? ['ALL'] : [target, 'ALL'];
}

/**
 * resume's remoteOnly predicate (dispatcher step 7): true (refuse for `local`) with `override`, or when a
 * sentinel holding the target is a budget/quota pause. Throws when the state dir is unknown: the dispatcher
 * treats a throw as a refusal (fail closed).
 */
export function resumeRemoteOnly(view, deps) {
  if (view?.args?.override === true) return true;
  const stateDir = stateDirOf(D(deps).config);
  return heldScopes(view?.target).some((scope) => REMOTE_ONLY_KINDS.includes(pause.kindOf(scope, { stateDir })));
}

function laneSessions(state) {
  const list = typeof state?.all === 'function' ? state.all() : [];
  return list.filter((s) => s && typeof s.name === 'string' && !s.name.startsWith('_laneboard') && s.lane != null).map((s) => s.name);
}

async function escapeAll(names, d, user) {
  const sent = [];
  const failed = [];
  for (const name of names) {
    try {
      await d.actions.sendKeys(name, ['Escape'], user);
      sent.push(name);
    } catch (err) {
      failed.push({ name, error: errText(err) });
    }
  }
  return { sent, failed };
}

function sessionIdOf(s) {
  const id = s?.claude?.sessionId ?? s?.sessionId ?? null;
  return typeof id === 'string' && pause.SID_RE.test(id) ? id : null;
}

/** Nudge one session with "continue" when it is unpaused, done/idle and its prompt is ready. */
async function nudge(name, d, user, entries) {
  const s = typeof d.state?.get === 'function' ? d.state.get(name) : null;
  if (!s) return { name, nudged: false, reason: 'unknown session' };
  if (pause.isPaused(name, sessionIdOf(s), entries)) return { name, nudged: false, reason: 'still paused' };
  if (s.awaitingApproval) return { name, nudged: false, reason: 'awaiting approval' };
  if (!NUDGE_STATES.includes(s.state)) return { name, nudged: false, reason: `state ${String(s.state).slice(0, 40)}` };
  if (typeof d.state?.promptReadiness !== 'function') return { name, nudged: false, reason: 'readiness unknown' };
  let readiness;
  try {
    const lines = await (d.capturePane ?? tmuxCapturePane)(s.paneId, { ansi: true });
    readiness = d.state.promptReadiness(Array.isArray(lines) ? lines : []);
  } catch (err) {
    return { name, nudged: false, reason: `capture failed: ${errText(err)}` };
  }
  if (readiness !== 'ready') return { name, nudged: false, reason: `prompt ${String(readiness).slice(0, 40)}` };
  try {
    await d.actions.sendText(name, NUDGE_TEXT, true, user);
  } catch (err) {
    return { name, nudged: false, reason: `send failed: ${errText(err)}` };
  }
  return { name, nudged: true };
}

function keptRefusal(kept) {
  const kinds = [...new Set(kept.map((k) => k.kind))];
  const msg = kinds.includes('budget')
    ? 'over budget: raise it with set-budget or pass override'
    : `held by a ${kinds.join('/')} pause: pass override`;
  return new ActionRefused(409, kinds.includes('budget') ? 'over-budget' : 'held', msg, { ok: false, kept });
}

// ---------------------------------------------------------------------------------------------------------
// Handlers (exported for tests; they run only through dispatch() in the server)

export async function runPause({ target, args, user, deps, config }) {
  const d = D(deps);
  const stateDir = stateDirOf(cfgOf(config, deps));
  const scope = target === '*' ? 'ALL' : target;
  let r;
  try {
    r = pause.pause(scope, { kind: 'operator', by: user, reason: cleanReason(args.reason) }, { stateDir });
  } finally {
    invalidatePaused();
  }
  const out = { ok: true, scope, kind: r.kind };
  if (r.kept) out.kept = true;
  if (args.interrupt === true) {
    const names = target === '*' ? laneSessions(d.state) : [target];
    const { sent, failed } = await escapeAll(names, d, user);
    out.interrupted = sent;
    if (failed.length) out.failed = failed;
  }
  return out;
}

export async function runResume({ target, args, user, kind, deps, config }) {
  const d = D(deps);
  const stateDir = stateDirOf(cfgOf(config, deps));
  const scope = target === '*' ? 'ALL' : target;
  // never lift a budget/quota pause for `local`, whatever the predicate said (defence in depth)
  const override = args.override === true && kind !== 'local';
  let r;
  try {
    r = pause.resume(scope, override ? {} : { kinds: ['operator'] }, { stateDir });
  } finally {
    invalidatePaused();
  }
  if (r.kept.length) throw keptRefusal(r.kept);
  const out = { ok: true, scope, removed: r.removed };
  if (args.nudge !== false) {
    let entries = [];
    try { entries = pause.list({ stateDir, mirrors: true }); } catch { entries = [{ scope: 'ALL', kind: 'operator' }]; }
    const names = target === '*' ? laneSessions(d.state) : [target];
    const nudges = [];
    for (const name of names) nudges.push(await nudge(name, d, user, entries));
    if (target === '*') out.nudges = nudges;
    else Object.assign(out, { nudged: nudges[0].nudged }, nudges[0].reason ? { reason: nudges[0].reason } : {});
  }
  return out;
}

function decider(behavior) {
  return async function runDecide({ target, args, user, deps }) {
    const core = D(deps).approvals ?? approvalsCore;
    const d = { behavior, target };
    if (behavior === 'deny') {
      if (args.note !== undefined) d.note = args.note;
      d.interrupt = args.interrupt === true;
    }
    const a = core.decide(args.approvalId, d, user);
    return { ok: true, approvalId: a.id, session: a.session, status: a.status };
  };
}

export const runApprove = decider('allow');
export const runDeny = decider('deny');
export const runRelease = decider('release');

/**
 * registerControlActions({actions, state, config, capturePane?, approvals?}) -> names registered.
 * Safe to call more than once: later calls only replace the default deps.
 */
export function registerControlActions(deps = {}) {
  captured = { ...deps };
  if (has('pause')) return [];

  registerAction('pause', {
    tier: 'click',
    target: 'session-or-all',
    runsAll: true,
    args: {
      confirm: { type: 'string', max: 128 },
      interrupt: { type: 'boolean' },
      reason: { type: 'string', max: REASON_MAX },
    },
    run: runPause,
  });

  registerAction('resume', {
    tier: 'click',
    target: 'session-or-all',
    runsAll: true,
    remoteOnly: resumeRemoteOnly,
    args: {
      confirm: { type: 'string', max: 128 },
      nudge: { type: 'boolean', default: true },
      override: { type: 'boolean' },
    },
    run: runResume,
  });

  const approvalId = { type: 'string', required: true, re: UUID_RE };
  registerAction('approve', {
    tier: 'click', target: 'session', remoteOnly: true,
    args: { approvalId },
    run: runApprove,
  });
  registerAction('deny', {
    tier: 'click', target: 'session', remoteOnly: true,
    args: { approvalId, note: { type: 'string', max: NOTE_MAX }, interrupt: { type: 'boolean' } },
    run: runDeny,
  });
  registerAction('release', {
    tier: 'click', target: 'session', remoteOnly: true,
    args: { approvalId },
    run: runRelease,
  });
  return [...CONTROL_ACTIONS];
}

/** Tests only. */
export function _resetControl() {
  captured = {};
}
