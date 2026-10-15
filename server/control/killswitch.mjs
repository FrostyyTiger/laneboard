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
//   2. after `graceMs` (default 10 s): kill the victims (selectVictims, SR19 re-review R1). A session is a
//      victim when it is a live Claude agent (isLiveClaude: kind claude, a non-shell foreground command that is
//      `claude`, a versioned native binary or has a registry pid) AND it either is bound to an active lane
//      record (the record launch wrote: lane id + `session` name, deps.laneRecords) OR its pane cwd is inside
//      a linked git worktree (a `.git` FILE pointing at `<repo>/.git/worktrees/<name>`), so `spawn`ed agents,
//      lanes without a lane.json and agents started by hand in a worktree are stopped too. Never a victim by
//      that rule: shells and other non-Claude panes, sessions whose cwd is in a main checkout (a `.git`
//      directory: the operator's checkout, the hub, a dotfiles repo; SR19 F4). Explicitly named sessions in
//      `include` (validated: they must exist in the live inventory, else they are reported in `notIncluded`)
//      are killed whatever they run. `_laneboard*` sessions (config ownSessionPrefixes) and the session
//      laneboard itself runs in (TMUX_PANE, any of its panes) are never killed, `include` or not. The victim
//      list is taken again from the live inventory at kill time (a lane launched during the grace is killed
//      too). The kills are appended to the fleet audit (`kill.done`, SR19 F5) as counts, a sha256 of the
//      sorted name lists and only the first names that fit, so a large kill stays within the audit's result
//      cap (SR19 re-review R2).
//   cancel: `{confirm, cancel: job}` within the grace clears the timer. The pause stays: the operator decides
//   whether to resume. The principal that started the job may cancel it (same kind + user, and for a hub the
//   same key), and so may any other `direct` user (an operator with control rights on this builder: the
//   dispatcher has already refused read-only users); such an override is audited (`kill.cancel`) with both
//   users (SR19 re-review R4). A hub key that did not start the job gets 403 not-owner (SR19 F7). The
//   dispatcher's takeLimits asks cancelGate() first (SR19 F1): only a permitted cancel of an existing job in
//   its grace skips the `all` bucket (still charged `kill`/`global`/`hub` plus a small cancel bucket of the
//   canceller's own); any other cancel takes the normal limits and is then refused (404 unknown-job / 409
//   too-late / 403 not-owner) before the start audit entry.
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
// Deps (injected, as in handlers.mjs): {actions, state, config, db?, timers?, ownPane?, laneRecords?, audit?,
// worktreeOf?} (laneRecords: array or function -> lane.json records; audit: {append} or a function returning
// it; worktreeOf: dir -> {root, linked} | null, default a read-only walk up the directory tree, tests stub it
// or use tmp dirs); the deps a dispatch()
// call carries win over the ones given to registerKillSwitch. `timers` = {now, setTimeout, clearTimeout}
// (tests pass a fake clock).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { registerAllHandler, ActionRefused } from '../fleet/dispatch.mjs';
import * as pause from './pause.mjs';
import { invalidate as invalidatePaused } from '../flags/paused.mjs';
import { isLiveClaude } from '../fleet/builtin-actions.mjs';

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
/** Audit sample of a kill's name lists (SR19 re-review R2): bytes of JSON per list, chars per name. */
export const AUDIT_NAMES_BYTES = 1400;
const AUDIT_NAME_MAX = 64;
const GIT_FILE_MAX = 1024;
const WALK_MAX = 128;
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

/**
 * The git checkout a directory is in, from the filesystem only (no git call, read-only): walk up to the first
 * `.git`. A `.git` directory is a main checkout ({linked:false}); a `.git` file whose `gitdir:` ends in
 * `/worktrees/<name>` is a linked worktree ({linked:true}); any other `.git` file (a submodule) or one that
 * cannot be read counts as not linked. Null when the directory is not inside a checkout.
 */
export function worktreeOf(dir, fsi = fs) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) return null;
  let p = path.resolve(dir);
  for (let i = 0; i < WALK_MAX; i++) {
    const g = path.join(p, '.git');
    let st = null;
    try { st = fsi.statSync(g); } catch { st = null; }
    if (st?.isDirectory()) return { root: p, linked: false };
    if (st?.isFile()) {
      let text = '';
      try {
        const fd = fsi.openSync(g, 'r');
        try {
          const buf = Buffer.alloc(GIT_FILE_MAX);
          const n = fsi.readSync(fd, buf, 0, GIT_FILE_MAX, 0);
          text = buf.toString('utf8', 0, n);
        } finally {
          fsi.closeSync(fd);
        }
      } catch {
        return { root: p, linked: false };
      }
      const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(text);
      const gitdir = m ? m[1].replace(/[\\/]+$/, '') : '';
      return { root: p, linked: /[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) };
    }
    const up = path.dirname(p);
    if (up === p) return null;
    p = up;
  }
  return null;
}

function paneIdsOf(s) {
  const ids = [];
  if (typeof s.paneId === 'string') ids.push(s.paneId);
  if (Array.isArray(s.panes)) for (const p of s.panes) if (typeof p?.paneId === 'string') ids.push(p.paneId);
  return ids;
}

/**
 * The sessions a builder kill switch kills (pure apart from `opts.worktreeOf`, default worktreeOf):
 *   - a live Claude agent (isLiveClaude) that is bound to an active lane record (`opts.lanes`, see
 *     laneSessions) or whose cwd (`s.dir`) is inside a linked git worktree (SR19 re-review R1); never one whose
 *     cwd is in a main checkout (`s.lane` from the cwd is never enough, SR19 F4), never a shell or other
 *     non-Claude pane;
 *   - plus the sessions named in `include` that exist in `sessions`, whatever they run;
 *   - never a `_laneboard*` session (or one of `opts.prefixes`), a session in `opts.protect` (names) or one
 *     with a pane `opts.ownPane`, `include` or not.
 * Sorted, unique.
 */
export function selectVictims(sessions, include = [], opts = {}) {
  const prefixes = [...PROTECTED_PREFIXES, ...(Array.isArray(opts.prefixes) ? opts.prefixes.filter((p) => typeof p === 'string' && p) : [])];
  const protect = new Set(Array.isArray(opts.protect) ? opts.protect : []);
  const ownPane = typeof opts.ownPane === 'string' && opts.ownPane ? opts.ownPane : null;
  const wanted = new Set(Array.isArray(include) ? include.filter((n) => typeof n === 'string') : []);
  const bound = opts.lanes instanceof Map ? opts.lanes : laneSessions(opts.lanes);
  const checkoutOf = typeof opts.worktreeOf === 'function' ? opts.worktreeOf : worktreeOf;
  const memo = new Map();
  const where = (dir) => {
    if (!memo.has(dir)) {
      let r = null;
      try { r = checkoutOf(dir); } catch { r = null; }
      memo.set(dir, r && typeof r === 'object' ? r : null);
    }
    return memo.get(dir);
  };
  const out = new Set();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || typeof s !== 'object') continue;
    const name = s.name;
    if (isProtectedName(name, prefixes) || protect.has(name)) continue;
    if (ownPane && paneIdsOf(s).includes(ownPane)) continue;
    if (wanted.has(name)) { out.add(name); continue; }
    if (!isLiveClaude(s)) continue;
    const wt = typeof s.dir === 'string' && s.dir ? where(s.dir) : null;
    if (wt && wt.linked !== true) continue; // a main checkout (or a submodule of one)
    if (bound.has(name) || wt?.linked === true) out.add(name);
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
  return { prefixes, ownPane, lanes: laneRecordsOf(d), worktreeOf: typeof d.worktreeOf === 'function' ? d.worktreeOf : undefined };
}

/**
 * A name list for the audit (SR19 re-review R2): the count, a sha256 of the sorted full list, and the first
 * names (each clipped) whose JSON fits in `budget` bytes. `more` is how many were left out.
 */
export function auditNames(names, budget = AUDIT_NAMES_BYTES) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n));
  const sorted = [...list].sort();
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  const first = [];
  let used = 2;
  for (const n of list) {
    const clipped = n.toWellFormed().replace(CONTROL_RE, ' ').slice(0, AUDIT_NAME_MAX);
    const cost = Buffer.byteLength(JSON.stringify(clipped)) + 1;
    if (used + cost > budget) break;
    first.push(clipped);
    used += cost;
  }
  return { n: list.length, first, more: list.length - first.length, sha256 };
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
  auditNote(d, j, 'kill.done', { ok: failed.length === 0, killed: auditNames(killed), failed: auditNames(failed.map((f) => f.name)) });
  prune();
  return j.result;
}

/**
 * May `who` cancel job `j` (SR19 F7, re-review R4)? Its owner may, and so may any `direct` user that is not
 * read-only (an operator with control rights here: the dispatcher refuses read-only users before this runs).
 * A hub key (or a hub user) that did not start the job may not.
 */
function mayCancel(j, owner, who) {
  if (owner === undefined || j.owner === undefined || owner === j.owner) return true;
  return who?.kind === 'direct' && who.readOnly !== true && typeof who.user === 'string' && who.user !== '';
}

function cancelRefusal(jobId, owner, who) {
  const j = typeof jobId === 'string' ? jobs.get(jobId) : undefined;
  if (!j) return new ActionRefused(404, 'unknown-job', 'no such kill job on this builder');
  if (!mayCancel(j, owner, who)) {
    return new ActionRefused(403, 'not-owner', 'only the principal that started this kill job, or a direct operator, may cancel it');
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
  const refusal = cancelRefusal(jobId, owner, who);
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
 * given, with `who` ({kind, user, readOnly}) for the direct-operator override; killAll always gives both.
 * The cancel is audited (`kill.cancel`) with the canceller and the user that started the job.
 */
export function cancel(jobId, { user, deps, owner, who, via } = {}) {
  const d = D(deps);
  const refusal = cancelRefusal(jobId, owner, who);
  if (refusal) throw refusal;
  const j = jobs.get(jobId);
  timersOf(d).clearTimeout(j.timer);
  j.timer = null;
  j.state = 'cancelled';
  const by = typeof user === 'string' ? user.slice(0, 128) : null;
  const startedBy = typeof j.user === 'string' ? j.user.slice(0, 128) : null;
  const override = owner !== undefined && j.owner !== undefined && owner !== j.owner;
  step(d, jobId, 'cancel', true, { by, startedBy, override });
  auditNote(d, { ...j, user: by, via: typeof via === 'string' ? via : j.via }, 'kill.cancel', { ok: true, by, startedBy, override });
  prune();
  return { ok: true, job: jobId, cancelled: true, paused: true, by, startedBy, ...(override ? { override: true } : {}) };
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
  if (args.cancel !== undefined) {
    return cancel(args.cancel, { user, deps, owner, via, who: { kind, user, readOnly: auth?.readOnly === true } });
  }

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
