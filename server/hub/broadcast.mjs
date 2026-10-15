// Hub-local `broadcast` action (fleet plan §8 2.4, §3 2.10 step 7; task C8). REVIEW-REQUIRED (SR18).
//
// createBroadcast({now?, concurrency?}) -> { run(req, ctx), lastAt(user), _reset() }
//
// `run` is registered with the relay's registerHubAction('broadcast', {run}) (server/hub/routes/broadcast.mjs)
// and gets `req = {builder, action, target, args}` and the relay ctx `{user, id, send, view, ...}`. The relay
// has already required a `direct` user (local -> 403 remote-only) and audits this request once (`phase:'local'`)
// under `ctx.id`; every `ctx.send` is its own signed envelope with a fresh nonce and its own sent/done audit pair.
//
// Rules:
// - target '*', builder null or '*', args exactly {targets, text, enter?, confirmCount}; anything else -> 400.
// - validateBroadcast (caps: ≤30 targets, text ≤2000) and the rate limit: one accepted broadcast per user per
//   10 s, in hub memory, stamped synchronously before the first send so two concurrent requests cannot both pass.
// - The plan comes from the hub's own fleet-store view (builder rows from the hub config; a builder that is not
//   up, or has a major version skew, is 'builder-down'). Lanes showing a permission prompt, a question, a held
//   approval or a dialog are skipped, as are paused, dead, shell and unknown ones.
// - Confirm contract (SR18 L1). Every 409 carries `result: {plan, preview, confirmCount, planHash}`, where
//   planHash = sha256hex(planHashInput(plan, preview, sha256hex(preview.text))) binds the exact sorted lane list,
//   the typed text and the Enter flag. The confirmed request must carry args.planHash (64 lower-case hex) echoing
//   it AND confirmCount === plan.send.length. Order of checks on the fresh plan: no sends -> 409 `nothing-to-send`;
//   no planHash -> 409 `plan-required` (the UI's first call: it gets the plan to show); planHash differs from the
//   fresh plan -> 409 `plan-changed` (re-show the fresh plan); count differs -> 409 `confirm-mismatch`. A malformed
//   planHash is 400 `bad-plan-hash`. Nothing is sent and nothing is stamped on any refusal, so the UI re-asks.
// - Refusals are rate-limited too (SR18 L4): at most REFUSAL_LIMIT.max refused requests (400/409/429) per user per
//   REFUSAL_LIMIT.windowMs; beyond that the request answers 429 `too-many-refusals` before planning.
// - Audit (SR18 L3): an accepted broadcast writes one hub audit entry through ctx.audit (id = ctx.id,
//   result.phase 'outcome') with the planned skips (reason per fkey) and the sent/skipped/failed summary: counts,
//   per-reason skip counts and the first N keys of each list, N shrunk until the result fits the audit's 4 KiB
//   cap. The text is never written (the relay's argsHash covers it).
// - Fan-out: one `send-text` per planned target with {text, enter, guardPrompt:true, fanout:{parent:ctx.id}},
//   concurrency 6. `text` is the previewed (already cleaned) text, so what the user saw is what is typed. Each
//   builder re-checks guardPrompt against its own current state and answers 409 `prompting` instead of typing;
//   that target lands in `skipped` with reason 'prompting'.
// - Result {id, sent:[key], skipped:[{key, reason}], failed:[{key, error, outcome?}], preview}.
import {
  BROADCAST_LIMITS, planBroadcast, validateBroadcast, checkConfirm, previewBroadcast, planHashInput, PLAN_HASH_RE,
} from '../control/broadcast.mjs';
import crypto from 'node:crypto';
import { parseFkey } from '../fleet/keys.mjs';

export const ACTION = 'broadcast';
export const CONCURRENCY = 6;
const ARG_KEYS = new Set(['targets', 'text', 'enter', 'confirmCount', 'planHash']);
const ERROR_MAX = 200;
/** SR18 L4: refused requests per user per window before the hub answers 429 without planning. */
export const REFUSAL_LIMIT = Object.freeze({ max: 30, windowMs: 60_000 });
/** SR18 L3: audit summary bounds (first N keys per list; the result must stay under the audit's 4 KiB cap). */
export const AUDIT_FIRST_N = 8;
const AUDIT_RESULT_BUDGET = 3500;
const AUDIT_ERROR_MAX = 60;

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** The planHash the hub returns with a 409 plan and requires back on the confirmed request (SR18 L1). */
export function planHashOf(plan, preview) {
  return sha256Hex(planHashInput(plan, preview, sha256Hex(preview.text)));
}

const countBy = (list) => {
  const out = {};
  for (const { reason } of list) out[reason] = (out[reason] ?? 0) + 1;
  return out;
};

/** The bounded audit summary of a broadcast (SR18 L3): counts plus the first n entries of each list. */
export function auditSummary({ targets, plan, sent, skipped, failed }, n = AUDIT_FIRST_N) {
  for (let k = n; ; k--) {
    const r = {
      phase: 'outcome',
      local: true,
      targets,
      planned: { send: plan.send.length, skip: plan.skip.length, skipReasons: countBy(plan.skip), skips: plan.skip.slice(0, k) },
      sent: { n: sent.length, keys: sent.slice(0, k) },
      skipped: { n: skipped.length, reasons: countBy(skipped), keys: skipped.slice(0, k) },
      failed: {
        n: failed.length,
        keys: failed.slice(0, k).map((f) => ({ key: f.key, error: String(f.error).slice(0, AUDIT_ERROR_MAX), ...(f.outcome ? { outcome: f.outcome } : {}) })),
      },
      ...(k < Math.max(plan.skip.length, sent.length, skipped.length, failed.length) ? { firstN: k } : {}),
    };
    if (k <= 0 || Buffer.byteLength(JSON.stringify(r), 'utf8') <= AUDIT_RESULT_BUDGET) return r;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function refuse(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

/** fkey -> session from a fleet-store view, plus the set of builders the hub can control now. */
export function sessionsFromView(view, targets) {
  const rows = new Map((Array.isArray(view?.builders) ? view.builders : []).map((r) => [r.id, r]));
  const sessions = new Map();
  for (const key of targets) {
    const p = parseFkey(key);
    if (!p) continue;
    const row = rows.get(p.builder);
    const map = row?.snap?.sessions;
    let s = null;
    if (map instanceof Map) s = map.get(p.name) ?? null;
    else if (Array.isArray(map)) s = map.find((x) => x?.name === p.name) ?? null;
    if (s) sessions.set(key, s);
  }
  const builderUp = (id) => rows.get(id)?.controls === true;
  return { sessions, builderUp };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const clamp = (v) => (typeof v === 'string' ? v.slice(0, ERROR_MAX) : null);

export function createBroadcast({ now = Date.now, concurrency = CONCURRENCY } = {}) {
  const last = new Map(); // user -> ms of the last accepted broadcast
  const refused = new Map(); // user -> ms timestamps of refused requests inside the window (≤ REFUSAL_LIMIT.max)

  function prune(t) {
    for (const [u, at] of last) if (t - at >= BROADCAST_LIMITS.minIntervalMs) last.delete(u);
    for (const [u, list] of refused) {
      while (list.length > 0 && t - list[0] >= REFUSAL_LIMIT.windowMs) list.shift();
      if (list.length === 0) refused.delete(u);
    }
  }

  async function run(req, ctx) {
    const user = ctx?.user;
    // The relay already enforces `direct`; refuse again here rather than trust the caller (defence in depth).
    if (typeof user !== 'string' || user === '' || user === 'local') return refuse(403, 'remote-only');
    if (typeof ctx.send !== 'function') return refuse(503, 'hub-action-unavailable');
    const t = Math.floor(Number(now()));
    prune(t);
    const list = refused.get(user);
    if (list && list.length >= REFUSAL_LIMIT.max) {
      return refuse(429, 'too-many-refusals', {
        detail: `more than ${REFUSAL_LIMIT.max} refused broadcasts per minute`,
        retryAfterMs: Math.max(0, REFUSAL_LIMIT.windowMs - (t - list[0])),
      });
    }
    const out = await attempt(req, ctx, user, t);
    if (out.ok === false && out.status >= 400 && out.status < 500) {
      const l = refused.get(user) ?? [];
      l.push(t);
      if (l.length > REFUSAL_LIMIT.max) l.splice(0, l.length - REFUSAL_LIMIT.max);
      refused.set(user, l);
    }
    return out;
  }

  async function attempt(req, ctx, user, t) {
    if (req?.target !== '*') return refuse(400, 'bad-target', { detail: "broadcast targets '*'" });
    if (req.builder !== null && req.builder !== undefined && req.builder !== '*') {
      return refuse(400, 'bad-builder', { detail: "broadcast is hub-local: builder must be '*' or null" });
    }
    const args = req.args;
    if (!isPlain(args)) return refuse(400, 'bad-args');
    for (const k of Object.keys(args)) if (!ARG_KEYS.has(k)) return refuse(400, 'bad-args', { detail: `unknown arg ${k.slice(0, 40)}` });
    const enter = args.enter === undefined ? true : args.enter;
    const err = validateBroadcast({ ...args, enter }, last.get(user) ?? null, t);
    if (err === 'rate-limited') {
      const retryAfterMs = BROADCAST_LIMITS.minIntervalMs - (t - last.get(user));
      return refuse(429, err, { detail: 'one broadcast per 10 s', retryAfterMs });
    }
    if (err) return refuse(400, err);
    if (args.planHash !== undefined && (typeof args.planHash !== 'string' || !PLAN_HASH_RE.test(args.planHash))) {
      return refuse(400, 'bad-plan-hash');
    }

    const targets = args.targets;
    const view = ctx.view ?? (typeof ctx.store?.view === 'function' ? ctx.store.view(t) : { builders: [] });
    const { sessions, builderUp } = sessionsFromView(view, targets);
    const plan = planBroadcast(targets, sessions, { builderUp });
    const preview = previewBroadcast(args.text, enter);
    const planHash = planHashOf(plan, preview);
    const n = plan.send.length;
    let mismatch = checkConfirm(plan, args.confirmCount);
    if (mismatch !== 'nothing-to-send') {
      if (args.planHash === undefined) mismatch = 'plan-required';
      else if (!crypto.timingSafeEqual(Buffer.from(args.planHash), Buffer.from(planHash))) mismatch = 'plan-changed';
    }
    if (mismatch) {
      const detail = mismatch === 'nothing-to-send' ? 'no target lane can be sent to now'
        : mismatch === 'plan-required' ? `confirm this plan: type ${n} to send to ${n} lanes`
          : mismatch === 'plan-changed' ? `the plan changed: type ${n} to send to ${n} lanes`
            : `type ${n} to send to ${n} lanes`;
      return refuse(409, mismatch, { detail, result: { plan, preview, confirmCount: n, planHash } });
    }

    // Accepted: stamp before the first await.
    last.set(user, t);
    const id = ctx.id;
    const sendArgs = { text: preview.text, enter: preview.enter, guardPrompt: true, fanout: { parent: id } };
    const results = await pool(plan.send, concurrency, async (key) => {
      const p = parseFkey(key);
      try {
        return { key, r: await ctx.send(p.builder, 'send-text', p.name, { ...sendArgs, fanout: { ...sendArgs.fanout } }) };
      } catch {
        return { key, r: { ok: false, error: 'send-failed' } };
      }
    });

    const sent = [];
    const skipped = [...plan.skip];
    const failed = [];
    for (const { key, r } of results) {
      if (r?.ok === true) sent.push(key);
      else if (r?.status === 409 && (r.code === 'prompting' || r.error === 'prompting')) skipped.push({ key, reason: 'prompting' });
      else {
        const f = { key, error: clamp(r?.error) ?? 'failed' };
        if (r?.outcome === 'unknown') f.outcome = 'unknown';
        failed.push(f);
      }
    }
    const result = { id, sent, skipped, failed, preview };
    if (ctx.audit && typeof ctx.audit.append === 'function') {
      try {
        ctx.audit.append({
          id, user, via: 'hub', builder: null, action: ACTION, target: '*', args,
          result: auditSummary({ targets: targets.length, plan, sent, skipped, failed }),
        });
      } catch {
        result.auditError = 'audit-failed';
      }
    }
    return { ok: failed.length === 0, status: 200, result };
  }

  return {
    run,
    lastAt: (user) => last.get(user) ?? null,
    _reset: () => last.clear(),
  };
}
