// Builder kill switch: `kill` target `*` (fleet plan §8 2.6, README §3.5). REVIEW-REQUIRED (SR19).
//
// Registered with §2's dispatcher as the '*' handler of the built-in `kill` action
// (dispatch.registerAllHandler('kill', killAll), done by server/routes/killswitch.mjs). The dispatcher owns
// the order of checks and the audit entries; before killAll runs it has already:
//   - refused `local` (builtin `kill` is remoteOnly for target '*': 403 remote-only, S7);
//   - required `args.confirm === fleet.id` and refused the hub's constant `fleet` (400, S13);
//   - validated the strict '*' args: confirm, graceMs (0..600000), include (<=50 session names), cancel (job id).
// killAll repeats the local / confirm rules (defence in depth) and then:
//
//   1. pause '*' (the builder-wide `ALL` operator sentinel, written with config.stateDir passed explicitly)
//      and Escape to every victim session;
//   2. after `graceMs` (default 10 s): kill every session bound to an active lane record (the record launch
//      wrote: lane id + `session` name, deps.laneRecords), plus only the explicitly named sessions in
//      `include`. A cwd inside some git repo is NOT enough (SR19 F4): main-checkout shells, the hub's own
//      session and any other non-lane session are killed only when named in `include`. The victim list is
//      taken again from the live inventory at kill time (a lane launched during the grace is killed too).
//      `_laneboard*` sessions (config ownSessionPrefixes) and the session laneboard itself runs in (TMUX_PANE,
//      any of its panes) are never killed. The kills are appended to the fleet audit (`kill.done`, SR19 F5).
//   cancel: `{confirm, cancel: job}` within the grace clears the timer. The pause stays: the operator decides
//   whether to resume. Only the principal that started the job may cancel it (same kind + user, and for a
//   hub the same key; 403 not-owner, SR19 F7). The dispatcher's takeLimits asks cancelGate() first (SR19 F1):
//   only a cancel of an existing job in its grace, by its owner, skips the `all` bucket (still charged
//   `kill`/`global`/`hub` plus a small cancel bucket of its own); any other cancel takes the normal limits and
//   is then refused (404 unknown-job / 409 too-late / 403 not-owner) before the start audit entry.
//
// Every step goes to db.addJobStep (kind `killall`, lane `*`). The kill uses actions.kill (exact `=name`
// tmux target, server/actions.mjs). Results are returned as `{job, ...}` so the dispatcher's outcome audit
// entry carries the job id.
//
// The grace timer lives in this process: a laneboard restart inside the grace drops the kill and leaves the
// builder paused (fails safe). This is a cooperative control on the builder itself: an agent with a shell on
// this uid can unpause or survive it (docs/fleet/control.md, SECURITY.md). Out-of-band path when laneboard
// cannot act (e.g. a corrupt audit line makes the dispatcher refuse every action, SR2 I3): ssh to the builder,
// `laneboard pause --all` (no server needed), then `tmux kill-session -t '=<name>'` per lane.
//
// Deps (injected, as in handlers.mjs): {actions, state, config, db?, timers?, ownPane?, laneRecords?, audit?}
// (laneRecords: array or function -> lane.json records; audit: {append} or a function returning it); the deps a dispatch()
// call carries win over the ones given to registerKillSwitch. `timers` = {now, setTimeout, clearTimeout}
// (tests pass a fake clock).

import crypto from 'node:crypto';

import { registerAllHandler, ActionRefused } from '../fleet/dispatch.mjs';
import * as pause from './pause.mjs';
import { invalidate as invalidatePaused } from '../flags/paused.mjs';

export const KIND = 'killall';
export const JOB_LANE = '*';
export const DEFAULT_GRACE_MS = 10_000;
export const MAX_GRACE_MS = 600_000;
export const FLEET_CONFIRM = 'fleet';
/** Never killed, whatever `include` says. */
export const PROTECTED_PREFIXES = Object.freeze(['_laneboard']);
/** Cancels per owner per window (SR19 F1): an operator cancels a job once; a retry or two is fine. */
export const CANCEL_LIMIT = 3;
export const CANCEL_WINDOW_MS = 10_000;
/** The limiter target a gated cancel is charged under: anything but '*' (so the `all` bucket is not taken). */
export const CANCEL_TARGET = '*cancel';
const KEEP_DONE = 50;
const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const ERR_MAX = 200;
// C0 controls, DEL, C1 controls
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

let captured = {};
let registered = false;
/** job id -> {job, user, owner, via, state:'grace'|'killing'|'killed'|'cancelled', include, deadline, timer, result} */
const jobs = new Map();
/** owner key -> timestamps of recent gated cancels */
const cancelHits = new Map();

/**
 * The identity a job belongs to: kind + user, and for a hub caller its signing key too (a key that rotates
 * `user` is still one owner per user; another key never owns this job).
 */
export function ownerKey({ kind, user, keyLabel } = {}) {
  const u = typeof user === 'string' ? user : '';
  if (kind === 'hub') return JSON.stringify(['hub', typeof keyLabel === 'string' && keyLabel ? keyLabel : 'unknown-key', u]);
  return JSON.stringify([typeof kind === 'string' ? kind : 'unknown', u]);
}

function D(deps) {
  return { ...captured, ...(deps ?? {}) };
}

function timersOf(d) {
  const t = d.timers ?? {};
  return {
    now: typeof t.now === 'function' ? t.now : Date.now,
    setTimeout: typeof t.setTimeout === 'function' ? t.setTimeout : globalThis.setTimeout,
    clearTimeout: typeof t.clearTimeout === 'function' ? t.clearTimeout : globalThis.clearTimeout,
  };
}

function errText(err) {
  return String(err?.message ?? err).toWellFormed().replace(CONTROL_RE, ' ').slice(0, ERR_MAX);
}

function isProtectedName(name, prefixes) {
  return typeof name !== 'string' || prefixes.some((p) => name.startsWith(p));
}

/**
 * Pure: session name -> lane id, from the lane records launch wrote (`record.session`, else the lane id, which
 * is what launch names the session). Retired and malformed records are left out.
 */
export function laneSessions(records) {
  const m = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== 'object' || r.retiredAt || typeof r.id !== 'string' || !LANE_ID_RE.test(r.id) || r.id.includes('..')) continue;
    const name = typeof r.session === 'string' && r.session ? r.session : r.id;
    if (!m.has(name)) m.set(name, r.id);
  }
  return m;
}

function paneIdsOf(s) {
  const ids = [];
  if (typeof s.paneId === 'string') ids.push(s.paneId);
  if (Array.isArray(s.panes)) for (const p of s.panes) if (typeof p?.paneId === 'string') ids.push(p.paneId);
  return ids;
}

/**
 * Pure: the sessions a builder kill switch kills. The sessions bound to an active lane record
 * (`opts.lanes`, see laneSessions; `s.lane` from the cwd is never enough, SR19 F4) plus the sessions named in
 * `include` that exist in `sessions`; never a `_laneboard*` session (or one of `opts.prefixes`), never a
 * session in `opts.protect` (names) or one with a pane `opts.ownPane`. Sorted, unique.
 */
export function selectVictims(sessions, include = [], opts = {}) {
  const prefixes = [...PROTECTED_PREFIXES, ...(Array.isArray(opts.prefixes) ? opts.prefixes.filter((p) => typeof p === 'string' && p) : [])];
  const protect = new Set(Array.isArray(opts.protect) ? opts.protect : []);
  const ownPane = typeof opts.ownPane === 'string' && opts.ownPane ? opts.ownPane : null;
  const wanted = new Set(Array.isArray(include) ? include.filter((n) => typeof n === 'string') : []);
  const bound = opts.lanes instanceof Map ? opts.lanes : laneSessions(opts.lanes);
  const out = new Set();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || typeof s !== 'object') continue;
    const name = s.name;
    if (isProtectedName(name, prefixes) || protect.has(name)) continue;
    if (ownPane && paneIdsOf(s).includes(ownPane)) continue;
    if (bound.has(name) || wanted.has(name)) out.add(name);
  }
  return [...out].sort();
}

/** Names in `include` that will not be killed (unknown, protected), for the result. */
function refusedIncludes(sessions, include, victims) {
  const v = new Set(victims);
  return (Array.isArray(include) ? include : []).filter((n) => !v.has(n));
}

function inventory(d) {
  const list = typeof d.state?.all === 'function' ? d.state.all() : [];
  return Array.isArray(list) ? list : [];
}

function laneRecordsOf(d) {
  try {
    const r = typeof d.laneRecords === 'function' ? d.laneRecords() : d.laneRecords;
    return Array.isArray(r) ? r : [];
  } catch (err) {
    d.log?.warn?.(`killswitch: lane records unreadable: ${errText(err)}`);
    return [];
  }
}

function victimOpts(d) {
  const prefixes = Array.isArray(d.config?.ownSessionPrefixes) ? d.config.ownSessionPrefixes : [];
  const ownPane = d.ownPane !== undefined ? d.ownPane : process.env.TMUX_PANE;
  return { prefixes, ownPane, lanes: laneRecordsOf(d) };
}

/** Append one entry to the fleet audit (SR19 F5). Never throws: the kill already happened. */
function auditNote(d, j, action, result) {
  try {
    const a = typeof d.audit === 'function' ? d.audit() : d.audit;
    if (!a || typeof a.append !== 'function') return;
    a.append({ user: j.user ?? null, via: j.via ?? null, action, target: '*', args: { job: j.job }, result: { job: j.job, ...result } });
  } catch (err) {
    d.log?.error?.(`killswitch ${j.job}: audit append for ${action} failed: ${errText(err)}`);
  }
}

function step(d, job, name, ok, detail) {
  const add = d.db?.addJobStep;
  if (typeof add !== 'function') return;
  try {
    add({ ts: timersOf(d).now(), job, lane: JOB_LANE, kind: KIND, step: name, ok, detail });
  } catch (err) {
    d.log?.warn?.(`killswitch ${job}: job step ${name} not recorded: ${errText(err)}`);
  }
}

function prune() {
  if (jobs.size <= KEEP_DONE) return;
  for (const [id, j] of jobs) {
    if (jobs.size <= KEEP_DONE) break;
    if (j.state === 'killed' || j.state === 'cancelled') jobs.delete(id);
  }
}

function stateDirOf(config) {
  const dir = config?.stateDir;
  return typeof dir === 'string' && dir ? dir : null;
}

/** Step 1: the builder-wide pause and an Escape to every victim. Never throws. */
async function pauseAndInterrupt(d, job, user, victims) {
  const out = { paused: false };
  const stateDir = stateDirOf(d.config);
  if (!stateDir) {
    // pause.mjs must never fall back to its own default dir; the kill still goes ahead
    out.pauseError = 'config.stateDir is not set';
  } else {
    try {
      const r = pause.pause('ALL', { kind: 'operator', by: user, reason: `kill switch ${job}` }, { stateDir });
      out.paused = true;
      out.pauseKind = r.kind;
    } catch (err) {
      out.pauseError = errText(err);
    } finally {
      try { invalidatePaused(); } catch { /* cache only */ }
    }
  }
  step(d, job, 'pause', out.paused, out.pauseError ? { error: out.pauseError } : { scope: 'ALL' });
  const escaped = [];
  const failed = [];
  for (const name of victims) {
    try {
      await d.actions.sendKeys(name, ['Escape'], user);
      escaped.push(name);
    } catch (err) {
      failed.push({ name, error: errText(err) });
    }
  }
  step(d, job, 'interrupt', failed.length === 0, { escaped, failed });
  return { ...out, escaped, interruptFailed: failed };
}

/** Step 2: kill the victims of the live inventory. Never throws. */
async function killPhase(d, j) {
  j.state = 'killing';
  j.timer = null;
  const victims = selectVictims(inventory(d), j.include, victimOpts(d));
  const killed = [];
  const failed = [];
  for (const name of victims) {
    try {
      await d.actions.kill(name, j.user);
      killed.push(name);
      step(d, j.job, `kill ${name}`, true, null);
    } catch (err) {
      const error = errText(err);
      failed.push({ name, error });
      step(d, j.job, `kill ${name}`, false, { error });
    }
  }
  j.state = 'killed';
  j.result = { killed, failed };
  step(d, j.job, 'done', failed.length === 0, { killed: killed.length, failed: failed.length });
  auditNote(d, j, 'kill.done', { ok: failed.length === 0, killed, failed: failed.map((f) => f.name) });
  prune();
  return j.result;
}

function cancelRefusal(jobId, owner) {
  const j = typeof jobId === 'string' ? jobs.get(jobId) : undefined;
  if (!j) return new ActionRefused(404, 'unknown-job', 'no such kill job on this builder');
  if (owner !== undefined && j.owner !== undefined && owner !== j.owner) {
    return new ActionRefused(403, 'not-owner', 'only the principal that started this kill job may cancel it');
  }
  if (j.state !== 'grace') return new ActionRefused(409, 'too-late', `kill job is ${j.state}`, { ok: false, job: jobId, state: j.state });
  return null;
}

/**
 * The dispatcher's rate-limit hook for `kill * {cancel}` (SR19 F1), called by takeLimits before any audit
 * entry. who = {user, kind, keyLabel}. Returns
 *   {ok:true}                      an existing job in its grace, owned by `who`, within the cancel bucket
 *                                  (consumed): the caller charges the normal limits except `all`;
 *   {ok:false, limited:true, retryAfterMs}   the cancel bucket is empty (429);
 *   {ok:false, refusal}            anything else: the caller takes the normal limits (`all` included) and
 *                                  then throws `refusal` (404 / 403 / 409).
 */
export function cancelGate(jobId, who = {}) {
  const owner = ownerKey(who);
  const refusal = cancelRefusal(jobId, owner);
  if (refusal) return { ok: false, refusal };
  const t = timersOf(D()).now();
  const hits = (cancelHits.get(owner) ?? []).filter((x) => x > t - CANCEL_WINDOW_MS && x <= t);
  if (hits.length >= CANCEL_LIMIT) {
    cancelHits.set(owner, hits);
    return { ok: false, limited: true, retryAfterMs: Math.max(1, Math.ceil(hits[0] + CANCEL_WINDOW_MS - t)) };
  }
  hits.push(t);
  cancelHits.set(owner, hits);
  if (cancelHits.size > 1024) for (const [k, v] of cancelHits) if (!v.some((x) => x > t - CANCEL_WINDOW_MS)) cancelHits.delete(k);
  return { ok: true };
}

/**
 * Cancel a builder kill within its grace. The pause stays. `owner` (ownerKey of the caller) is checked when
 * given; killAll always gives it.
 */
export function cancel(jobId, { user, deps, owner } = {}) {
  const d = D(deps);
  const refusal = cancelRefusal(jobId, owner);
  if (refusal) throw refusal;
  const j = jobs.get(jobId);
  timersOf(d).clearTimeout(j.timer);
  j.timer = null;
  j.state = 'cancelled';
  step(d, jobId, 'cancel', true, { by: typeof user === 'string' ? user.slice(0, 128) : null });
  prune();
  return { ok: true, job: jobId, cancelled: true, paused: true };
}

/** The `kill *` handler (dispatcher run signature). */
export async function killAll({ args = {}, user, kind, via, auth, deps } = {}) {
  const d = D(deps);
  // defence in depth: the dispatcher already refused these
  if (kind === 'local' || kind === undefined) throw new ActionRefused(403, 'remote-only', 'kill * is remote-only');
  const fleetId = d.config?.fleet?.id;
  if (typeof fleetId !== 'string' || !fleetId || args.confirm === FLEET_CONFIRM || args.confirm !== fleetId) {
    throw new ActionRefused(400, 'confirm_required', 'target * needs confirm equal to this builder id');
  }
  if (typeof d.actions?.kill !== 'function' || typeof d.actions?.sendKeys !== 'function') {
    throw new ActionRefused(500, 'internal', 'no actions');
  }
  const owner = ownerKey({ kind, user, keyLabel: auth?.keyLabel });
  if (args.cancel !== undefined) return cancel(args.cancel, { user, deps, owner });

  const graceMs = Number.isSafeInteger(args.graceMs) ? Math.min(Math.max(args.graceMs, 0), MAX_GRACE_MS) : DEFAULT_GRACE_MS;
  const include = Array.isArray(args.include) ? [...new Set(args.include.filter((n) => typeof n === 'string'))] : [];
  const t = timersOf(d);
  const job = `killall-${t.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const sessions = inventory(d);
  const victims = selectVictims(sessions, include, victimOpts(d));
  const notIncluded = refusedIncludes(sessions, include, victims);
  step(d, job, 'start', null, { graceMs, victims, include, notIncluded, by: user });

  const j = { job, user, owner, via: typeof via === 'string' ? via : null, state: 'grace', include, deadline: t.now() + graceMs, timer: null, result: null };
  jobs.set(job, j);
  const p = await pauseAndInterrupt(d, job, user, victims);
  const base = { ok: true, job, graceMs, victims, ...p };
  if (notIncluded.length) base.notIncluded = notIncluded;

  if (j.state !== 'grace') return { ...base, state: j.state }; // cancelled while interrupting
  if (graceMs === 0) {
    const r = await killPhase(d, j);
    return { ...base, state: j.state, ...r };
  }
  j.timer = t.setTimeout(() => {
    killPhase(d, j).catch((err) => d.log?.error?.(`killswitch ${job}: ${errText(err)}`));
  }, graceMs);
  j.timer?.unref?.();
  return { ...base, state: 'grace', killAt: j.deadline };
}

/** A job's public state (tests, UI): {job, state, deadline, result}. */
export function jobState(jobId) {
  const j = jobs.get(jobId);
  return j ? { job: j.job, state: j.state, deadline: j.deadline, result: j.result } : null;
}

/** Drop every pending kill (shutdown): nothing is killed, the pause stays. Each drop is audited. */
export function stopAll(deps) {
  const d = D(deps);
  const t = timersOf(d);
  for (const j of jobs.values()) {
    if (j.state === 'grace') {
      t.clearTimeout(j.timer);
      j.timer = null;
      j.state = 'cancelled';
      auditNote(d, j, 'kill.dropped', { ok: true, reason: 'shutdown' });
    }
  }
}

// The dispatcher's takeLimits finds the hook on the registered '*' handler (no import cycle, SR19 F1).
killAll.cancelGate = cancelGate;

/**
 * registerKillSwitch({actions, state, config, db?, log?, timers?, ownPane?}) -> true when it registered the
 * '*' handler now. Safe to call more than once: later calls only replace the default deps.
 */
export function registerKillSwitch(deps = {}) {
  captured = { ...deps };
  if (registered) return false;
  registerAllHandler('kill', killAll);
  registered = true;
  return true;
}

/** Tests only (pair with dispatch._reset). */
export function _resetKillSwitch() {
  stopAll();
  jobs.clear();
  cancelHits.clear();
  captured = {};
  registered = false;
}
