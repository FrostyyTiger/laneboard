// Fleet kill with undo, on the hub (fleet plan §8 2.6, §3 2.10). REVIEW-REQUIRED (SR19).
//
// A hub-local `kill` with `builder:'*'`, target '*' and the typed confirm `fleet`. The hub module
// server/hub/routes/fleetkill.mjs registers start() with the relay (registerHubAction('kill',
// {scope:'fanout'})); the relay hands it `ctx.fanout`, which checks the typed `fleet` once more and sends each
// `up` builder its own id as `args.confirm` (builders never accept `fleet`, S13). Every sub-send is signed and
// audited per envelope by the relay; the relay audits the hub-local request itself.
//
//   t=0         pause '*' (interrupt) fan-out to every builder.
//   t=0..undoMs undo window, in this process's memory only. Undo = the same request with
//               `args.cancel:<fleetJob>`: the timer is cleared and `resume '*'` fans out. Nothing is killed.
//               Builders that answer the resume 429 (their `all` rate limit, still held by the pause) get one
//               fresh resume envelope after RESUME_RETRY_MS. They stay paused until then (fails safe).
//   t=undoMs    `kill '*'` with graceMs:0 fan-out (each builder pauses + Escapes again, then kills its lanes).
//
// If the hub dies (or the module stops) inside the window, the kill never happens and the fleet stays paused:
// fails safe. Builders that are not `up` are skipped and listed by name in the result of each phase.
// One fleet kill at a time: a second start inside a window is refused 409 with the pending job.
//
// Pure apart from the injected clock and ctx.fanout: no config, no network of its own.

import crypto from 'node:crypto';

import { RelayError, FLEET_CONFIRM } from './relay.mjs';

export const UNDO_MS = 10_000;
export const KILL_ARGS = Object.freeze({ graceMs: 0 });
export const PAUSE_REASON = 'fleet kill';
/**
 * A builder refuses a second target-'*' action of the same hub key within its `all` rate-limit window (1 per
 * 10 s by default), so an undo inside the window gets 429 from builders the pause reached a moment ago. Those
 * builders get one fresh `resume *` envelope (new nonce, not a replay) after this delay.
 */
export const RESUME_RETRY_MS = 10_500;
const JOB_RE = /^fleetkill-[0-9]{1,16}-[0-9a-f]{8}$/;
const ALLOWED_ARGS = new Set(['confirm', 'cancel']);
const KEEP = 20;
const ERR_MAX = 200;

const clip = (v) => (typeof v === 'string' ? v.slice(0, ERR_MAX) : v);

/** The per-phase summary kept on the job and returned: who got it, who was skipped (by name), who failed. */
function summary(r) {
  const res = r && typeof r === 'object' ? (r.result ?? {}) : {};
  const sent = Array.isArray(res.sent) ? res.sent : [];
  return {
    ok: r?.ok === true,
    ...(r?.error ? { error: clip(String(r.error)) } : {}),
    sent: sent.map((s) => ({ builder: s.builder, ok: s.ok === true, status: s.status ?? null, ...(s.error ? { error: clip(String(s.error)) } : {}), ...(s.outcome ? { outcome: s.outcome } : {}) })),
    skipped: Array.isArray(res.skipped) ? res.skipped.map((s) => ({ builder: s.builder, reason: s.reason })) : [],
    failed: Array.isArray(res.failed) ? [...res.failed] : [],
  };
}

function pub(j) {
  return {
    job: j.job, state: j.state, by: j.user, startedAt: j.startedAt, killAt: j.killAt,
    pause: j.pause, kill: j.kill, undo: j.undo, ...(j.error ? { error: j.error } : {}),
  };
}

/**
 * createFleetKill({undoMs?, timers?: {now, setTimeout, clearTimeout}, log?, uuid?})
 *   -> {run(req, ctx), get(job), list(), stop()}   (run: start, or undo with args.cancel)
 * `run` is the relay's hub-action run: `req = {builder:'*', action:'kill', target:'*', args}`,
 * `ctx = {user, fanout(action, target, args)}`.
 */
export function createFleetKill({ undoMs = UNDO_MS, resumeRetryMs = RESUME_RETRY_MS, timers = {}, log = null, rand = () => crypto.randomBytes(4).toString('hex') } = {}) {
  const now = typeof timers.now === 'function' ? timers.now : Date.now;
  const setT = typeof timers.setTimeout === 'function' ? timers.setTimeout : globalThis.setTimeout;
  const clearT = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : globalThis.clearTimeout;
  const jobs = new Map();
  const retries = new Set();
  let stopped = false;

  function prune() {
    for (const [id, j] of jobs) {
      if (jobs.size <= KEEP) break;
      if (j.state !== 'pending' && j.state !== 'killing') jobs.delete(id);
    }
  }

  function pending() {
    for (const j of jobs.values()) if (j.state === 'pending') return j;
    return null;
  }

  function check(req, ctx) {
    if (!req || req.builder !== '*') throw new RelayError(400, 'bad-builder', "fleet kill targets builder '*'");
    if (req.target !== '*') throw new RelayError(400, 'bad-target', "fleet kill targets '*'");
    const args = req.args && typeof req.args === 'object' ? req.args : {};
    for (const k of Object.keys(args)) if (!ALLOWED_ARGS.has(k)) throw new RelayError(400, 'bad-args', `unknown key ${k.slice(0, 40)}`);
    // the typed confirm is checked here, before anything is sent (ctx.fanout checks it again)
    if (args.confirm !== FLEET_CONFIRM) throw new RelayError(400, 'confirm-mismatch', `type ${FLEET_CONFIRM} to confirm`);
    if (args.cancel !== undefined && (typeof args.cancel !== 'string' || !JOB_RE.test(args.cancel))) {
      throw new RelayError(400, 'bad-args', 'cancel must be a fleet kill job id');
    }
    if (!ctx || typeof ctx.fanout !== 'function') throw new RelayError(500, 'no-fanout');
    if (stopped) throw new RelayError(503, 'hub-stopping');
    return args;
  }

  async function killPhase(j, fanout) {
    if (j.state !== 'pending') return;
    j.state = 'killing';
    j.timer = null;
    let r;
    try {
      r = await fanout('kill', '*', { confirm: FLEET_CONFIRM, ...KILL_ARGS });
    } catch (err) {
      r = { ok: false, error: err?.code ?? 'kill-fanout-failed' };
    }
    j.kill = summary(r);
    j.state = 'killed';
    log?.warn?.(`fleet kill ${j.job}: kill sent to ${j.kill.sent.length} builder(s), skipped ${j.kill.skipped.map((s) => s.builder).join(',') || 'none'}`);
    prune();
  }

  async function start(req, ctx) {
    check(req, ctx);
    const open = pending();
    if (open) {
      return { ok: false, status: 409, error: 'fleet-kill-pending', result: pub(open) };
    }
    const t0 = now();
    const job = `fleetkill-${Math.floor(t0)}-${rand()}`;
    const j = { job, user: typeof ctx.user === 'string' ? ctx.user : null, state: 'pausing', startedAt: t0, killAt: null, pause: null, kill: null, undo: null, timer: null };
    jobs.set(job, j);
    let r;
    try {
      r = await ctx.fanout('pause', '*', { confirm: FLEET_CONFIRM, interrupt: true, reason: PAUSE_REASON });
    } catch (err) {
      // nothing was sent (a refusal before the fan-out): no undo window, no kill
      j.state = 'failed';
      j.error = err?.code ?? 'pause-fanout-failed';
      throw err;
    }
    j.pause = summary(r);
    if (stopped) { j.state = 'aborted'; return { ok: false, status: 503, error: 'hub-stopping', result: pub(j) }; }
    j.state = 'pending';
    j.killAt = now() + undoMs;
    const fanout = ctx.fanout;
    j.timer = setT(() => {
      killPhase(j, fanout).catch((err) => log?.error?.(`fleet kill ${job}: ${String(err?.message ?? err).slice(0, ERR_MAX)}`));
    }, undoMs);
    log?.warn?.(`fleet kill ${job} by ${j.user}: paused, kill in ${undoMs} ms unless undone`);
    return { ok: true, status: 202, result: { ...pub(j), undoMs } };
  }

  async function undo(jobId, ctx) {
    const j = jobs.get(jobId);
    if (!j) return { ok: false, status: 404, error: 'unknown-job' };
    if (j.state !== 'pending') return { ok: false, status: 409, error: 'too-late', result: pub(j) };
    clearT(j.timer);
    j.timer = null;
    j.state = 'cancelled';
    let r;
    try {
      r = await ctx.fanout('resume', '*', { confirm: FLEET_CONFIRM });
    } catch (err) {
      r = { ok: false, error: err?.code ?? 'resume-fanout-failed' };
    }
    j.undo = summary(r);
    j.undoneBy = typeof ctx.user === 'string' ? ctx.user : null;
    const limited = j.undo.sent.filter((s) => s.status === 429).map((s) => s.builder);
    if (limited.length && typeof ctx.send === 'function') {
      j.undo.retry = { builders: limited, at: now() + resumeRetryMs, sent: null };
      const send = ctx.send;
      const t = setT(async () => {
        retries.delete(t);
        const out = [];
        for (const b of limited) {
          let x;
          try { x = await send(b, 'resume', '*', { confirm: b }); } catch { x = { ok: false, error: 'resume-failed' }; }
          out.push({ builder: b, ok: x?.ok === true, status: x?.status ?? null, ...(x?.error ? { error: clip(String(x.error)) } : {}) });
        }
        j.undo.retry.sent = out;
      }, resumeRetryMs);
      retries.add(t);
    }
    log?.warn?.(`fleet kill ${jobId} undone by ${j.undoneBy}: no kill; resume sent`);
    prune();
    return { ok: true, status: 200, result: pub(j) };
  }

  async function run(req, ctx) {
    const args = check(req, ctx);
    if (args.cancel !== undefined) return undo(args.cancel, ctx);
    return start(req, ctx);
  }

  function stop() {
    stopped = true;
    for (const t of retries) clearT(t);
    retries.clear();
    for (const j of jobs.values()) {
      if (j.state === 'pending') {
        clearT(j.timer);
        j.timer = null;
        j.state = 'aborted';
      }
    }
  }

  return {
    run,
    get: (jobId) => (jobs.has(jobId) ? pub(jobs.get(jobId)) : null),
    list: () => [...jobs.values()].reverse().map(pub),
    stop,
  };
}
