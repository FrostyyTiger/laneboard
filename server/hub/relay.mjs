// Hub action relay (fleet plan §3 2.10) and the hub-local action registry. REVIEW-REQUIRED (SR11).
//
// createRelay({store, key, keyId?, sign?, audit, fetchImpl?, now?, uuid?, cfg?, placement?})
//   -> { relay(body, user), send(builder, action, target, args, user, opts?), fanout(...), place(opts),
//        registerHubAction(name, def), validateArgs }
//
// relay(body, user): body is the parsed `POST /api/fleet/actions` JSON `{builder|'*'|null, action, target, args}`
// (or `{fkey, action, args}`); `user` is the hub request's `req.auth.user` (Tailscale-User-Login of a `direct`
// caller) or the `req.auth` object itself. It is never read from the body. Always resolves (never rejects on a
// refusal) to `{ok, status, result|error, auditId, builder, ...}`; `status` is the HTTP status the route
// should answer with.
//
// Security rules (SECURITY-FIXES S2, S7, S12, S13; README 3.2/3.5):
// - Every hub action needs a `direct` user: `local`, a missing user or a `hub`/`local` auth object -> 403
//   `remote-only`.
// - Routing comes only from the hub's own config: the builder id is the body's `builder` (or the prefix of the
//   UI's `fkey`), looked up in the fleet store, and the URL posted to is that store entry's configured `url`.
//   Nothing a builder sent (snapshot fields, hello) ever chooses where an envelope goes.
// - A builder that is not `up` (or has a major version skew) gets nothing: 503, nothing sent, nothing queued.
// - One envelope = one fresh nonce (`id`) = one POST. No retry, ever. A timeout is "sent, outcome unknown".
// - Each relayed envelope is audited twice on the hub with the same id: `{phase:'sent'}` before the POST
//   (an audit failure means nothing is sent) and `{phase:'done', ok: true|false|'unknown', ...}` after.
// - Redirects are not followed; the response body is capped at 64 KB.
// - Keys and signatures are never logged or returned.
import crypto from 'node:crypto';

import { signEnvelope, ENVELOPE_USER_RE } from '../fleet/auth.mjs';
import { canonicalJson, sha256Hex } from '../fleet/canonical.mjs';
import { keyId as keyIdOf } from '../fleet/keys-ed25519.mjs';
import { parseFkey, BUILDER_ID_RX } from '../fleet/keys.mjs';
import * as placementLib from './placement.mjs';

/** Allowlist: the README 3.5 action table (`term` goes through the term-proxy only). */
export const ACTIONS = Object.freeze([
  'send-text', 'send-keys', 'interrupt', 'pause', 'resume', 'kill', 'restart', 'spawn', 'launch', 'retire',
  'approve', 'deny', 'release', 'set-budget', 'broadcast', 'ack-alarm', 'send-review', 'run-script',
]);
const ACTION_SET = new Set(ACTIONS);
/** Never relayed as-is: handled only by a registered hub-local action. */
export const HUB_ONLY = Object.freeze(['broadcast', 'ack-alarm']);
/** Built-in `builder:'*'` fan-out (typed confirm `fleet`, rewritten per builder). */
export const FANOUT_BUILTIN = Object.freeze(['pause', 'resume']);
export const FLEET_CONFIRM = 'fleet';
export const PLACED_ACTIONS = Object.freeze(['spawn', 'launch']);

export const LIMITS = Object.freeze({
  text: 8000,
  keys: 20,
  target: 128,
  argsBytes: 32 * 1024,
  responseBytes: 64 * 1024,
  error: 200,
});
export const KEY_RE = /^[A-Za-z0-9_.^-]{1,16}$/;
const DEFAULT_TIMEOUT_MS = 15000;
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

export class RelayError extends Error {
  constructor(status, code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RelayError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? null;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const clampStr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

/**
 * Coarse, pure pre-filter of `args` for `action` (the builder's dispatcher is authoritative). Throws
 * RelayError(400). Returns the args as a plain JSON copy.
 */
export function validateArgs(action, args) {
  if (!ACTION_SET.has(action)) throw new RelayError(400, 'unknown-action');
  const a = args === undefined || args === null ? {} : args;
  if (!isPlain(a)) throw new RelayError(400, 'bad-args', 'args must be an object');
  let text;
  try { text = canonicalJson(a); } catch { throw new RelayError(400, 'bad-args', 'args are not plain JSON'); }
  if (Buffer.byteLength(text, 'utf8') > LIMITS.argsBytes) throw new RelayError(400, 'bad-args', `args larger than ${LIMITS.argsBytes} bytes`);
  const out = JSON.parse(text);
  if (action === 'send-text') {
    if (typeof out.text !== 'string' || out.text.length < 1 || out.text.length > LIMITS.text) {
      throw new RelayError(400, 'bad-args', `text must be 1..${LIMITS.text} characters`);
    }
  } else if (action === 'send-keys') {
    if (!Array.isArray(out.keys) || out.keys.length < 1 || out.keys.length > LIMITS.keys
      || !out.keys.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
      throw new RelayError(400, 'bad-args', `keys must be 1..${LIMITS.keys} key names`);
    }
  }
  return out;
}

function checkTarget(target) {
  if (typeof target !== 'string' || target.length < 1 || target.length > LIMITS.target) {
    throw new RelayError(400, 'bad-target', `target must be 1..${LIMITS.target} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(target)) throw new RelayError(400, 'bad-target', 'control characters');
  return target;
}

/** The acting user: a `direct` login only (README 3.5: on the hub every action needs `direct`). */
function actingUser(user) {
  let login = user;
  if (user !== null && typeof user === 'object') {
    if (user.kind !== 'direct') throw new RelayError(403, 'remote-only');
    login = user.user;
  }
  if (typeof login !== 'string' || login === '' || login === 'local') throw new RelayError(403, 'remote-only');
  if (!ENVELOPE_USER_RE.test(login)) throw new RelayError(403, 'bad-user');
  return login;
}

// --- module-level hub-local registry (shared by every relay; instances may add their own) -----------------

const globalHubActions = new Map();

function normDef(name, def) {
  if (!ACTION_SET.has(name)) throw new TypeError(`registerHubAction: ${name} is not a relay action`);
  const run = typeof def === 'function' ? def : def?.run;
  if (typeof run !== 'function') throw new TypeError('registerHubAction: run must be a function');
  const scope = def?.scope ?? 'any';
  if (scope !== 'any' && scope !== 'fanout') throw new TypeError("registerHubAction: scope must be 'any' or 'fanout'");
  return { name, run, scope };
}

function addTo(map, name, def) {
  const d = normDef(name, def);
  const k = `${d.scope}:${name}`;
  if (map.has(k)) throw new TypeError(`registerHubAction: ${name} (${d.scope}) is already registered`);
  map.set(k, d);
  return () => { if (map.get(k) === d) map.delete(k); };
}

/**
 * Register hub-local handling for `name`: `{run(req, ctx), scope?}`. scope 'any' (default) takes every request
 * for the action (broadcast, ack-alarm); scope 'fanout' only `builder:'*'` (fleet kill, C9). `run` gets
 * `req = {builder, action, target, args}` and `ctx = {user, id, send, fanout, store, view, now, audit, place}`;
 * its return value (or `{ok, result|error, status?}`) is the response. Sub-sends through `ctx.send` /
 * `ctx.fanout` are signed and audited per envelope; the relay audits the hub-local request itself once.
 * Returns an unregister function.
 */
export function registerHubAction(name, def) {
  return addTo(globalHubActions, name, def);
}

/** Tests only. */
export function _resetHubActions() { globalHubActions.clear(); }

// --- response handling ---------------------------------------------------------------------------------

async function readCapped(res, cap) {
  if (!res.body) return { text: '', over: false };
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  let over = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { over = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), over };
}

function errorName(err) {
  const code = err?.cause?.code ?? err?.code;
  if (err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError') return { error: 'timeout', sent: 'unknown' };
  if (err?.name === 'AbortError') return { error: 'timeout', sent: 'unknown' };
  if (typeof code === 'string' && NOT_SENT_CODES.has(code)) return { error: 'unreachable', sent: false };
  return { error: 'network-error', sent: 'unknown' };
}

// --- the relay ------------------------------------------------------------------------------------------

export function createRelay({
  store, key, keyId, sign = signEnvelope, audit, fetchImpl = fetch, now = Date.now,
  uuid = crypto.randomUUID, cfg = {}, placement = placementLib,
} = {}) {
  if (!store || typeof store.view !== 'function' || typeof store.builder !== 'function') throw new TypeError('createRelay: store is required');
  if (!audit || typeof audit.append !== 'function') throw new TypeError('createRelay: audit is required');
  if (!key) throw new TypeError('createRelay: key is required');
  const kid = keyId ?? keyIdOf(key);
  const fleetCfg = cfg?.fleet && typeof cfg.fleet === 'object' ? cfg.fleet : cfg;
  const timeoutMs = Number.isInteger(fleetCfg?.actionTimeoutMs) && fleetCfg.actionTimeoutMs > 0 ? fleetCfg.actionTimeoutMs : DEFAULT_TIMEOUT_MS;
  const placementCfg = fleetCfg?.placement ?? {};
  const localActions = new Map();
  const nowMs = () => Math.floor(Number(now()));

  function hubAction(action, fanout) {
    const order = fanout ? ['fanout', 'any'] : ['any'];
    for (const scope of order) {
      const k = `${scope}:${action}`;
      const d = localActions.get(k) ?? globalHubActions.get(k);
      if (d) return d;
    }
    return null;
  }

  function rowOf(view, id) {
    return view.builders.find((b) => b.id === id) ?? null;
  }

  function appendAudit(entry) {
    return audit.append(entry);
  }

  /**
   * Relay one envelope to one builder: steps 2-6 of 2.10. `view` is an optional fleet-store view to reuse
   * within one request. Resolves to `{ok, status, builder, auditId, result|error, ...}`.
   */
  async function send(builder, action, target, args, user, { view } = {}) {
    let login;
    try {
      login = actingUser(user);
      if (!ACTION_SET.has(action) || HUB_ONLY.includes(action)) throw new RelayError(400, 'not-relayable');
      args = validateArgs(action, args);
      checkTarget(target);
      if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) throw new RelayError(400, 'bad-builder');
    } catch (err) {
      return refusal(err, builder);
    }
    const entry = store.builder(builder);
    if (!entry) return { ok: false, status: 404, error: 'unknown-builder', builder };
    const v = view ?? store.view(nowMs());
    const row = rowOf(v, builder);
    if (!row || !row.controls) {
      return { ok: false, status: 503, error: 'builder down', state: row?.state ?? 'unknown', ageMs: row?.ageMs ?? null, builder };
    }
    // The URL comes from the hub's own config (store entry), never from builder data.
    const base = typeof entry.url === 'string' ? entry.url : null;
    let endpoint;
    try { endpoint = new URL('/api/v1/actions', base); } catch { endpoint = null; }
    if (!endpoint || (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')) {
      return { ok: false, status: 503, error: 'builder misconfigured', builder };
    }

    const envelope = { v: 1, id: uuid(), ts: nowMs(), builder, action, target, args, user: login, via: 'hub' };
    let body;
    let headers;
    try {
      body = canonicalJson(envelope);
      headers = {
        'content-type': 'application/json',
        'x-laneboard': '1',
        'x-laneboard-key': kid,
        'x-laneboard-sig': sign(envelope, key),
      };
    } catch {
      return { ok: false, status: 500, error: 'sign-failed', builder };
    }
    const argsHash = sha256Hex(canonicalJson(args));
    const base0 = { id: envelope.id, user: login, via: 'hub', builder, action, target, argsHash };
    try {
      appendAudit({ ...base0, ts: envelope.ts, result: { phase: 'sent' } });
    } catch {
      // Fail closed: an action the hub cannot record is not sent.
      return { ok: false, status: 500, error: 'audit-failed', builder };
    }

    let status = null;
    let parsed = null;
    let outcome;
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      const { text, over } = await readCapped(res, LIMITS.responseBytes);
      if (!over) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      const bodyOk = isPlain(parsed) ? parsed.ok : undefined;
      if (status >= 300 && status < 400) {
        outcome = { ok: false, error: 'redirect-refused' };
      } else if (status >= 200 && status < 300) {
        if (!isPlain(parsed)) outcome = { ok: 'unknown', error: over ? 'response-too-large' : 'bad-response' };
        else outcome = bodyOk === false ? { ok: false, error: clampStr(parsed.error, LIMITS.error) ?? 'refused' } : { ok: true };
      } else {
        outcome = { ok: false, error: (isPlain(parsed) && clampStr(parsed.error, LIMITS.error)) || `http-${status}` };
      }
    } catch (err) {
      const e = errorName(err);
      outcome = { ok: e.sent === false ? false : 'unknown', error: e.error };
    }
    const builderAuditId = isPlain(parsed) ? clampStr(parsed.auditId, 128) : null;
    const done = { phase: 'done', ok: outcome.ok, status };
    if (outcome.error) done.error = outcome.error;
    if (builderAuditId) done.builderAuditId = builderAuditId;
    let auditError = null;
    try {
      appendAudit({ ...base0, result: done });
    } catch {
      auditError = 'audit-failed';
    }

    const out = { ok: outcome.ok === true, builder, auditId: envelope.id };
    if (outcome.ok === 'unknown') {
      out.outcome = 'unknown';
      out.error = outcome.error;
      out.status = 504;
      if (status !== null) out.builderStatus = status;
    } else if (outcome.ok) {
      out.status = status;
      out.result = isPlain(parsed) && 'result' in parsed ? parsed.result : null;
    } else {
      out.status = status === null ? 502 : (status >= 300 && status < 400 ? 502 : status);
      out.error = outcome.error;
      if (isPlain(parsed) && typeof parsed.code === 'string') out.code = clampStr(parsed.code, 64);
    }
    if (builderAuditId) out.builderAuditId = builderAuditId;
    if (auditError) out.auditError = auditError;
    return out;
  }

  /**
   * One envelope per `up` builder (config order) with the typed `fleet` confirm rewritten to each builder's id
   * (builders never accept `fleet`, S13). Non-`up` builders are listed in `skipped` by name.
   */
  async function fanout(action, target, args, user, { view } = {}) {
    const a = validateArgs(action, args);
    if (target !== '*') throw new RelayError(400, 'bad-target', "a fleet fan-out targets '*'");
    if (a.confirm !== FLEET_CONFIRM) throw new RelayError(400, 'confirm-mismatch', `type ${FLEET_CONFIRM} to confirm`);
    const v = view ?? store.view(nowMs());
    const skipped = [];
    const jobs = [];
    for (const row of v.builders) {
      if (!row.controls) { skipped.push({ builder: row.id, reason: row.state === 'up' ? 'version-skew' : row.state }); continue; }
      jobs.push(send(row.id, action, '*', { ...a, confirm: row.id }, user, { view: v }));
    }
    const sent = await Promise.all(jobs);
    const failed = sent.filter((r) => !r.ok);
    return {
      ok: failed.length === 0 && sent.length > 0,
      status: sent.length === 0 ? 503 : 200,
      builder: '*',
      result: {
        sent: sent.map((r) => ({ builder: r.builder, ok: r.ok, status: r.status, auditId: r.auditId ?? null, ...(r.error ? { error: r.error } : {}), ...(r.outcome ? { outcome: r.outcome } : {}) })),
        skipped,
        failed: failed.map((r) => r.builder),
      },
      ...(sent.length === 0 ? { error: 'no builder up' } : {}),
    };
  }

  function place(opts = {}) {
    return placement.rank(store.view(nowMs()), { ...opts, cfg: placementCfg });
  }

  async function runLocal(def, req, login, v) {
    const id = uuid();
    const ctx = {
      user: login,
      id,
      store,
      view: v,
      now: nowMs,
      audit,
      send: (b, act, tgt, args) => send(b, act, tgt, args, login),
      fanout: (act, tgt, args) => fanout(act, tgt, args, login),
      place,
    };
    let out;
    try {
      const ret = await def.run({ ...req }, ctx);
      out = isPlain(ret) && 'ok' in ret
        ? { status: ret.ok ? 200 : 400, ...ret }
        : { ok: true, status: 200, result: ret ?? null };
    } catch (err) {
      out = err instanceof RelayError
        ? { ok: false, status: err.status, error: err.code, ...(err.detail ? { detail: err.detail } : {}) }
        : { ok: false, status: 500, error: 'hub-action-failed' };
    }
    try {
      appendAudit({
        id, user: login, via: 'hub', builder: req.builder ?? null, action: req.action, target: req.target,
        argsHash: sha256Hex(canonicalJson(req.args)),
        result: { phase: 'local', ok: out.ok === true, status: out.status, ...(out.error ? { error: clampStr(String(out.error), LIMITS.error) } : {}) },
      });
    } catch {
      out.auditError = 'audit-failed';
    }
    return { builder: req.builder ?? null, ...out, auditId: id };
  }

  /** The `POST /api/fleet/actions` entry point. */
  async function relay(body, user) {
    try {
      const login = actingUser(user);
      if (!isPlain(body)) throw new RelayError(400, 'bad-request', 'body must be an object');
      const action = body.action;
      if (typeof action !== 'string' || !ACTION_SET.has(action)) throw new RelayError(400, 'unknown-action');
      let builder = body.builder;
      let target = body.target;
      if (body.fkey !== undefined) {
        // The UI's fleet key, parsed here against the hub's own config (S2).
        const p = parseFkey(body.fkey);
        if (!p) throw new RelayError(400, 'bad-fkey');
        if (builder !== undefined && builder !== null && builder !== p.builder) throw new RelayError(400, 'fkey-mismatch');
        if (target !== undefined && target !== p.name) throw new RelayError(400, 'fkey-mismatch');
        builder = p.builder;
        target = p.name;
      }
      if (builder !== undefined && builder !== null && builder !== '*' && (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder))) {
        throw new RelayError(400, 'bad-builder');
      }
      const args = validateArgs(action, body.args);
      checkTarget(target);
      const isFan = builder === '*';
      const req = { builder: builder ?? null, action, target, args };

      const def = hubAction(action, isFan);
      if (def) return await runLocal(def, req, login, store.view(nowMs()));
      if (HUB_ONLY.includes(action)) throw new RelayError(503, 'hub-action-unavailable', `${action} is handled on the hub and is not set up`);
      if (isFan) {
        if (!FANOUT_BUILTIN.includes(action)) throw new RelayError(400, 'fanout-not-supported', `${action} cannot fan out`);
        return await fanout(action, target, args, login);
      }

      const v = store.view(nowMs());
      if (builder === undefined || builder === null) {
        if (!PLACED_ACTIONS.includes(action)) throw new RelayError(400, 'bad-builder', 'builder is required');
        const opts = { repo: typeof args.repo === 'string' ? args.repo : undefined, need: action === 'launch' ? 'launch' : null, cfg: placementCfg };
        const ranking = placement.rank(v, opts);
        const top = ranking[0];
        if (!top || !top.eligible) return { ok: false, status: 503, error: 'no-eligible-builder', builder: null, placement: ranking };
        const out = await send(top.builder, action, target, args, login, { view: v });
        return { ...out, placedBy: 'hub', score: top.score };
      }
      if (!store.builder(builder)) return { ok: false, status: 404, error: 'unknown-builder', builder };
      let warning;
      if (PLACED_ACTIONS.includes(action)) {
        const opts = { repo: typeof args.repo === 'string' ? args.repo : undefined, need: action === 'launch' ? 'launch' : null, cfg: placementCfg };
        warning = placement.check(v, builder, opts)?.warning;
      }
      const out = await send(builder, action, target, args, login, { view: v });
      return warning ? { ...out, warning } : out;
    } catch (err) {
      return refusal(err, body?.builder);
    }
  }

  function refusal(err, builder) {
    if (err instanceof RelayError) {
      return { ok: false, status: err.status, error: err.code, ...(err.detail ? { detail: err.detail } : {}), builder: typeof builder === 'string' ? builder : null };
    }
    return { ok: false, status: 500, error: 'relay-failed', builder: typeof builder === 'string' ? builder : null };
  }

  return {
    relay,
    send,
    fanout: async (...a) => { try { return await fanout(...a); } catch (err) { return refusal(err, '*'); } },
    place,
    validateArgs,
    registerHubAction: (name, def) => addTo(localActions, name, def),
  };
}
