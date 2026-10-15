// Fleet kill with undo, on the hub (fleet plan §8 2.6, §3 2.10). REVIEW-REQUIRED (SR19).
//
// A hub-local `kill` with `builder:'*'`, target '*' and the typed confirm `fleet`. The hub module
// server/hub/routes/fleetkill.mjs registers start() with the relay (registerHubAction('kill',
// {scope:'fanout'})); the relay hands it `ctx.send` (one signed, audited envelope to one builder), `ctx.view`
// (the fleet-store view of this request) and `ctx.fanout`. Builders never accept `fleet` (S13): every
// sub-send carries that builder's own id as `args.confirm`. Every sub-send is signed and audited per envelope
// by the relay (parent = the hub-local request); the relay audits the hub-local request itself.
//
//   t=0         pause '*' (interrupt) to every `up` builder, one send per builder (ctx.send; ctx.fanout only
//               when the relay gives no ctx.send/ctx.view). State `pausing` until every send settled.
//               Undo during `pausing` (SR19 F2): 202 `cancelling`; the timer is never armed; builders whose
//               pause already landed get `resume *` at once, outstanding sends are no longer waited for: each
//               one gets its `resume *` when it lands. Nothing is killed.
//               A pause that reached no builder fails the job: no window, no kill (SR19 F6); builders the
//               pause did not reach are named in `pauseIncomplete` and are never sent the kill.
//   t=0..undoMs undo window, in this process's memory only. Undo = the same request with
//               `args.cancel:<fleetJob>`: the timer is cleared and `resume '*'` goes out. Nothing is killed.
//               Builders that answer the resume 429 (their `all` rate limit, still held by the pause) get one
//               fresh resume envelope after RESUME_RETRY_MS. They stay paused until then (fails safe).
//   t=undoMs    `kill '*'` with graceMs:0 to the builders the pause reached (each builder pauses + Escapes
//               again, then kills its lanes). A builder that answers 429 gets one fresh kill envelope after
//               KILL_RETRY_MS (SR19 F3: the kill must win).
//
// Every delayed retry is bound to its job: a newer fleet kill start drops the older job's pending retries,
// and a retry whose job is no longer the latest is dropped when it fires (SR19 F3), so a stale undo can never
// resume the fleet during a later kill.
//
// If the hub dies (or the module stops) inside the window, the kill never happens and the fleet stays paused:
// fails safe. Builders that are not `up` are skipped and listed by name in the result of each phase.
// One fleet kill at a time: a second start while one is pausing, cancelling, pending or killing is refused
// 409 `active-job` with that job (SR19 F2).
//
// Pure apart from the injected clock and ctx.send/ctx.fanout: no config, no network of its own.

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
/** One fresh kill envelope per builder that answered the kill 429, after its `all` window (SR19 F3). */
export const KILL_RETRY_MS = 10_500;
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

function sentRow(builder, x) {
  return {
    builder, ok: x?.ok === true, status: x?.status ?? null,
    ...(x?.error ? { error: clip(String(x.error)) } : {}), ...(x?.outcome ? { outcome: clip(String(x.outcome)) } : {}),
  };
}

/** Did a pause reach the builder (ok, or sent with an unknown outcome)? A refusal means it did not. */
const reached = (s) => s.ok === true || s.outcome === 'unknown';

function pub(j) {
  return {
    job: j.job, state: j.state, by: j.user, startedAt: j.startedAt, killAt: j.killAt,
    pause: j.pause, kill: j.kill, undo: j.undo,
    ...(j.pauseIncomplete ? { pauseIncomplete: j.pauseIncomplete } : {}),
    ...(j.undoneBy !== undefined ? { undoneBy: j.undoneBy } : {}),
    ...(j.error ? { error: j.error } : {}),
  };
}

const ACTIVE = new Set(['pausing', 'cancelling', 'pending', 'killing']);

/**
 * createFleetKill({undoMs?, resumeRetryMs?, killRetryMs?, timers?: {now, setTimeout, clearTimeout}, log?, rand?})
 *   -> {run(req, ctx), get(job), list(), stop()}   (run: start, or undo with args.cancel)
 * `run` is the relay's hub-action run: `req = {builder:'*', action:'kill', target:'*', args}`,
 * `ctx = {user, send(builder, action, target, args), view: {builders:[{id, state, controls}]}, fanout(action, target, args)}`.
 */
export function createFleetKill({
  undoMs = UNDO_MS, resumeRetryMs = RESUME_RETRY_MS, killRetryMs = KILL_RETRY_MS, timers = {}, log = null,
  rand = () => crypto.randomBytes(4).toString('hex'),
} = {}) {
  const now = typeof timers.now === 'function' ? timers.now : Date.now;
  const setT = typeof timers.setTimeout === 'function' ? timers.setTimeout : globalThis.setTimeout;
  const clearT = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : globalThis.clearTimeout;
  const jobs = new Map();
  /** retry timer -> {job, rec}: every delayed send, bound to its job */
  const retries = new Map();
  let latest = null; // the job id of the newest start
  let stopped = false;

  function prune() {
    for (const [id, j] of jobs) {
      if (jobs.size <= KEEP) break;
      if (!ACTIVE.has(j.state)) jobs.delete(id);
    }
  }

  function active() {
    for (const j of jobs.values()) if (ACTIVE.has(j.state)) return j;
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

  const perBuilder = (ctx) => typeof ctx.send === 'function' && Array.isArray(ctx.view?.builders);

  async function sendOne(send, builder, action, args) {
    try {
      return sentRow(builder, await send(builder, action, '*', { ...args, confirm: builder }));
    } catch {
      return sentRow(builder, { ok: false, error: `${action}-failed` });
    }
  }

  /** A delayed send bound to job `j`: dropped when a newer job started, or on stop(). */
  function later(j, rec, ms, fn) {
    const t = setT(async () => {
      retries.delete(t);
      if (stopped) { rec.dropped = 'hub-stopping'; return; }
      if (latest !== j.job) { rec.dropped = `superseded by ${latest}`; return; }
      try { await fn(); } catch (err) { log?.error?.(`fleet kill ${j.job}: retry: ${String(err?.message ?? err).slice(0, ERR_MAX)}`); }
    }, ms);
    t?.unref?.();
    retries.set(t, { job: j.job, rec });
  }

  function dropRetriesOtherThan(jobId) {
    for (const [t, x] of retries) {
      if (x.job === jobId) continue;
      clearT(t);
      retries.delete(t);
      x.rec.dropped = `superseded by ${jobId}`;
    }
  }

  /** Builders that answered 429 get one fresh envelope of `action` after `ms` (bound to the job). */
  function retryLimited(j, phase, send, action, args, ms) {
    const limited = phase.sent.filter((s) => s.status === 429).map((s) => s.builder);
    if (!limited.length || typeof send !== 'function') return;
    phase.retry = { builders: limited, at: now() + ms, sent: null };
    const rec = phase.retry;
    later(j, rec, ms, async () => {
      const out = [];
      for (const b of limited) out.push(await sendOne(send, b, action, args));
      rec.sent = out;
    });
  }

  // --- t=0: pause -----------------------------------------------------------------------------------------

  async function pausePhase(j, ctx) {
    const args = { interrupt: true, reason: PAUSE_REASON };
    if (!perBuilder(ctx)) {
      let r;
      try { r = await ctx.fanout('pause', '*', { confirm: FLEET_CONFIRM, ...args }); } catch (err) { r = { ok: false, error: err?.code ?? 'pause-fanout-failed' }; }
      return summary(r);
    }
    const skipped = [];
    const sends = [];
    j.pauseSettled = new Map();
    for (const row of ctx.view.builders) {
      if (!row || typeof row.id !== 'string') continue;
      if (!row.controls) { skipped.push({ builder: row.id, reason: row.state === 'up' ? 'version-skew' : row.state }); continue; }
      const b = row.id;
      sends.push(sendOne(ctx.send, b, 'pause', args).then((s) => {
        j.pauseSettled.set(b, s);
        // undone while this send was outstanding: its builder is resumed as soon as the pause landed
        if (j.cancelRequested && reached(s)) resumeOne(j, ctx, b);
        return s;
      }));
    }
    const sent = await Promise.all(sends);
    const failed = sent.filter((s) => !s.ok).map((s) => s.builder);
    return { ok: sent.length > 0 && failed.length === 0, ...(sent.length === 0 ? { error: 'no builder up' } : {}), sent, skipped, failed };
  }

  // --- undo -----------------------------------------------------------------------------------------------

  function resumeOne(j, ctx, b) {
    if (j.resumed.has(b)) return;
    j.resumed.add(b);
    j.resumes.push(sendOne(ctx.send, b, 'resume', {}));
  }

  /** After an undo during `pausing`: every reached builder was resumed; collect and retry the 429s. */
  async function finishCancel(j, ctx) {
    j.state = 'cancelled';
    if (perBuilder(ctx)) {
      for (const s of j.pause.sent) if (reached(s)) resumeOne(j, ctx, s.builder);
      const sent = await Promise.all(j.resumes);
      j.undo = { ok: sent.every((s) => s.ok), sent, skipped: j.pause.skipped, failed: sent.filter((s) => !s.ok).map((s) => s.builder) };
    } else {
      let r;
      try { r = await ctx.fanout('resume', '*', { confirm: FLEET_CONFIRM }); } catch (err) { r = { ok: false, error: err?.code ?? 'resume-fanout-failed' }; }
      j.undo = summary(r);
    }
    retryLimited(j, j.undo, ctx.send, 'resume', {}, resumeRetryMs);
    log?.warn?.(`fleet kill ${j.job} undone by ${j.undoneBy} during the pause fan-out: no kill; resume sent`);
    prune();
  }

  async function undo(jobId, ctx) {
    const j = jobs.get(jobId);
    if (!j) return { ok: false, status: 404, error: 'unknown-job' };
    if (j.state === 'pausing' || j.state === 'cancelling') {
      if (!j.cancelRequested) {
        j.cancelRequested = true;
        j.state = 'cancelling';
        j.undoneBy = typeof ctx.user === 'string' ? ctx.user : null;
        // builders whose pause already landed are resumed now; the rest when their pause lands
        if (j.pauseSettled && perBuilder(ctx)) for (const [b, s] of j.pauseSettled) if (reached(s)) resumeOne(j, ctx, b);
      }
      return { ok: true, status: 202, result: pub(j) };
    }
    if (j.state !== 'pending') return { ok: false, status: 409, error: 'too-late', result: pub(j) };
    clearT(j.timer);
    j.timer = null;
    j.state = 'cancelled';
    j.undoneBy = typeof ctx.user === 'string' ? ctx.user : null;
    let r;
    try {
      r = await ctx.fanout('resume', '*', { confirm: FLEET_CONFIRM });
    } catch (err) {
      r = { ok: false, error: err?.code ?? 'resume-fanout-failed' };
    }
    j.undo = summary(r);
    retryLimited(j, j.undo, ctx.send, 'resume', {}, resumeRetryMs);
    log?.warn?.(`fleet kill ${jobId} undone by ${j.undoneBy}: no kill; resume sent`);
    prune();
    return { ok: true, status: 200, result: pub(j) };
  }

  // --- t=undoMs: kill -------------------------------------------------------------------------------------

  async function killPhase(j, ctx) {
    if (j.state !== 'pending') return;
    j.state = 'killing';
    j.timer = null;
    const send = ctx.send;
    if (typeof send === 'function' && Array.isArray(j.pause?.sent) && j.perBuilder) {
      // only the builders the pause reached (SR19 F6): one that came up later was never paused or warned
      const targets = j.pause.sent.filter(reached).map((s) => s.builder);
      const sent = await Promise.all(targets.map((b) => sendOne(send, b, 'kill', KILL_ARGS)));
      const skipped = [...j.pause.skipped, ...j.pause.sent.filter((s) => !reached(s)).map((s) => ({ builder: s.builder, reason: 'not-paused' }))];
      j.kill = { ok: sent.length > 0 && sent.every((s) => s.ok), sent, skipped, failed: sent.filter((s) => !s.ok).map((s) => s.builder) };
    } else {
      let r;
      try {
        r = await ctx.fanout('kill', '*', { confirm: FLEET_CONFIRM, ...KILL_ARGS });
      } catch (err) {
        r = { ok: false, error: err?.code ?? 'kill-fanout-failed' };
      }
      j.kill = summary(r);
    }
    retryLimited(j, j.kill, send, 'kill', KILL_ARGS, killRetryMs);
    j.state = 'killed';
    log?.warn?.(`fleet kill ${j.job}: kill sent to ${j.kill.sent.length} builder(s), skipped ${j.kill.skipped.map((s) => s.builder).join(',') || 'none'}`);
    prune();
  }

  // --- start ----------------------------------------------------------------------------------------------

  async function start(req, ctx) {
    check(req, ctx);
    const open = active();
    if (open) return { ok: false, status: 409, error: 'active-job', result: pub(open) };
    const t0 = now();
    const job = `fleetkill-${Math.floor(t0)}-${rand()}`;
    const j = {
      job, user: typeof ctx.user === 'string' ? ctx.user : null, state: 'pausing', startedAt: t0, killAt: null,
      pause: null, kill: null, undo: null, timer: null, cancelRequested: false, resumes: [], resumed: new Set(),
      perBuilder: perBuilder(ctx),
    };
    jobs.set(job, j);
    // a newer fleet kill: older jobs never send anything again (SR19 F3)
    latest = job;
    dropRetriesOtherThan(job);
    j.pause = await pausePhase(j, ctx);
    if (stopped) { j.state = 'aborted'; return { ok: false, status: 503, error: 'hub-stopping', result: pub(j) }; }
    if (j.cancelRequested) {
      await finishCancel(j, ctx);
      return { ok: true, status: 200, result: pub(j) };
    }
    const reachedN = j.pause.sent.filter(reached).length;
    if (reachedN === 0) {
      // the pause reached nobody: no window, no kill (SR19 F6); the operator starts again when builders are up
      j.state = 'failed';
      j.error = j.pause.sent.length === 0 ? 'no-builder-up' : 'pause-not-delivered';
      log?.warn?.(`fleet kill ${job} by ${j.user}: pause reached no builder (${j.error}); no kill armed`);
      prune();
      return { ok: false, status: j.pause.sent.length === 0 ? 503 : 502, error: j.error, result: pub(j) };
    }
    const missed = j.pause.sent.filter((s) => !reached(s)).map((s) => s.builder);
    if (missed.length) j.pauseIncomplete = missed;
    j.state = 'pending';
    j.killAt = now() + undoMs;
    const kctx = { send: ctx.send, fanout: ctx.fanout };
    j.timer = setT(() => {
      killPhase(j, kctx).catch((err) => log?.error?.(`fleet kill ${job}: ${String(err?.message ?? err).slice(0, ERR_MAX)}`));
    }, undoMs);
    j.timer?.unref?.();
    log?.warn?.(`fleet kill ${job} by ${j.user}: paused, kill in ${undoMs} ms unless undone`);
    return { ok: true, status: 202, result: { ...pub(j), undoMs } };
  }

  async function run(req, ctx) {
    const args = check(req, ctx);
    if (args.cancel !== undefined) return undo(args.cancel, ctx);
    return start(req, ctx);
  }

  function stop() {
    stopped = true;
    for (const [t, x] of retries) { clearT(t); x.rec.dropped = 'hub-stopping'; }
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
