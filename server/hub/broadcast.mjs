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
// - confirmCount must EQUAL plan.send.length (the builder's dispatcher only checks ≤ targets); otherwise 409
//   `confirm-mismatch` with the fresh plan and preview, nothing sent, nothing stamped, so the UI re-asks.
// - Fan-out: one `send-text` per planned target with {text, enter, guardPrompt:true, fanout:{parent:ctx.id}},
//   concurrency 6. `text` is the previewed (already cleaned) text, so what the user saw is what is typed. Each
//   builder re-checks guardPrompt against its own current state and answers 409 `prompting` instead of typing;
//   that target lands in `skipped` with reason 'prompting'.
// - Result {id, sent:[key], skipped:[{key, reason}], failed:[{key, error, outcome?}], preview}.
import {
  BROADCAST_LIMITS, planBroadcast, validateBroadcast, checkConfirm, previewBroadcast,
} from '../control/broadcast.mjs';
import { parseFkey } from '../fleet/keys.mjs';

export const ACTION = 'broadcast';
export const CONCURRENCY = 6;
const ARG_KEYS = new Set(['targets', 'text', 'enter', 'confirmCount']);
const ERROR_MAX = 200;

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

  function prune(t) {
    for (const [u, at] of last) if (t - at >= BROADCAST_LIMITS.minIntervalMs) last.delete(u);
  }

  async function run(req, ctx) {
    const user = ctx?.user;
    // The relay already enforces `direct`; refuse again here rather than trust the caller (defence in depth).
    if (typeof user !== 'string' || user === '' || user === 'local') return refuse(403, 'remote-only');
    if (typeof ctx.send !== 'function') return refuse(503, 'hub-action-unavailable');
    if (req?.target !== '*') return refuse(400, 'bad-target', { detail: "broadcast targets '*'" });
    if (req.builder !== null && req.builder !== undefined && req.builder !== '*') {
      return refuse(400, 'bad-builder', { detail: "broadcast is hub-local: builder must be '*' or null" });
    }
    const args = req.args;
    if (!isPlain(args)) return refuse(400, 'bad-args');
    for (const k of Object.keys(args)) if (!ARG_KEYS.has(k)) return refuse(400, 'bad-args', { detail: `unknown arg ${k.slice(0, 40)}` });
    const enter = args.enter === undefined ? true : args.enter;
    const t = Math.floor(Number(now()));
    prune(t);
    const err = validateBroadcast({ ...args, enter }, last.get(user) ?? null, t);
    if (err === 'rate-limited') {
      const retryAfterMs = BROADCAST_LIMITS.minIntervalMs - (t - last.get(user));
      return refuse(429, err, { detail: 'one broadcast per 10 s', retryAfterMs });
    }
    if (err) return refuse(400, err);

    const targets = args.targets;
    const view = ctx.view ?? (typeof ctx.store?.view === 'function' ? ctx.store.view(t) : { builders: [] });
    const { sessions, builderUp } = sessionsFromView(view, targets);
    const plan = planBroadcast(targets, sessions, { builderUp });
    const preview = previewBroadcast(args.text, enter);
    const mismatch = checkConfirm(plan, args.confirmCount);
    if (mismatch) {
      return refuse(409, mismatch, {
        detail: `type ${plan.send.length} to send to ${plan.send.length} lanes`,
        result: { plan, preview, confirmCount: plan.send.length },
      });
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
    return {
      ok: failed.length === 0,
      status: 200,
      result: { id, sent, skipped, failed, preview },
    };
  }

  return {
    run,
    lastAt: (user) => last.get(user) ?? null,
    _reset: () => last.clear(),
  };
}
