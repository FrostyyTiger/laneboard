// The one action dispatcher (fleet plan §2 2.6, README §3.5). REVIEW-REQUIRED (SR5).
//
// Every mutation, whatever door it came through (v1 from the hub, v1 from a browser through serve, a legacy
// REST adapter, the CLI), is one envelope handed to dispatch(). The order of checks is fixed:
//
//   shape -> registry -> hub control -> remote-only (flag) -> target -> args -> remote-only (predicate)
//         -> tier -> rate limit -> audit (start) -> run -> audit (outcome)
//
// dispatch() is only ever called with an already authenticated `auth` (A4 classify / verifyEnvelope), so
// every outcome, refusals included, lands an audit entry. A refusal lands exactly one entry (its outcome). An
// action that gets as far as running lands two: a `{phase:'start'}` entry appended BEFORE run (fail closed: if
// that append throws, the action does not run and the caller gets 503 `audit-unavailable`, SR5 M2) and the
// outcome entry (`phase:'done'`) after it. A failed outcome append is logged and surfaced as `auditFailed:true`.
//
// `via` is derived from auth.kind only (hub -> 'hub', direct -> 'direct', local -> 'legacy'); whatever the
// envelope says is ignored (SR5 L1). The envelope is the value A4 verified
// (`canonicalJson(JSON.parse(body))`, SR1 I1): dispatch never sees, re-reads or re-parses a raw body. It
// validates the parsed value once and hands run() a private deep copy of the validated args, so nothing that
// mutates the caller's object after validation can change what runs.
//
// Feature modules import this module singleton directly (README §3.1): registerAction / registerAllHandler
// at module register time, tiers() for hello.actions.
//
// Pure apart from what the injected deps do: no config import, no timers.

import { argsHashOf } from './audit.mjs';
import { isSafeSessionName } from '../util.mjs';

export const TIERS = Object.freeze(['read', 'click', 'ask', 'confirm']);
export const KINDS = Object.freeze(['local', 'direct', 'hub']);
export const VIAS = Object.freeze(['hub', 'direct', 'legacy']);
/** Target kinds; each may carry the suffix `-or-all` to also accept `*`. `all` accepts only `*`. */
export const TARGET_KINDS = Object.freeze(['session', 'session-new', 'lane', 'builder', 'alarm', 'all']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HUB_USER_RE = /^[^\s]{1,128}$/;
const ALARM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Same rule as server/lanes/store.mjs isLaneId; copied because store.mjs imports config.mjs.
// test/dispatch.test.mjs checks they agree.
export const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const ERROR_MAX = 300;
const VIA_OF_KIND = Object.freeze({ hub: 'hub', 'hub-pending': 'hub', direct: 'direct', local: 'legacy' });
// auth.mjs's `hub-pending` (a -Sig/-Key whose envelope was never verified, SR3 H1) is accepted here only so
// that its refusal (403 unverified) is audited; it never runs anything.
const HUB_KINDS = Object.freeze(['hub', 'hub-pending']);
/** Audit `user` of a direct auth that carries no user (refused 403 no-identity, never recorded as `local`). */
export const UNKNOWN_DIRECT_USER = 'unknown-direct';
/** The only actions allowed to register `allConfirm:false` (SR5 L5). */
export const ALL_CONFIRM_EXEMPT = Object.freeze(['ack-alarm', 'broadcast']);
// C0 controls except \t \n, DEL, C1 controls.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Clean text that is typed into a pane (send-text, SR5 L3): CRLF and CR become LF; every control character
 * other than TAB and LF is removed (ESC, Ctrl-C, bracketed-paste markers, DEL, C1); with `enter === false` an
 * LF would submit the input, so each line break becomes a space.
 */
export function cleanTypedText(text, enter) {
  let t = String(text).replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (enter === false) t = t.replace(/\n/g, ' ');
  return t;
}
const ARG_TYPES = new Set(['string', 'boolean', 'number', 'integer', 'array', 'object', 'null']);
const SPEC_KEYS = new Set(['type', 'required', 'default', 'min', 'max', 're', 'enum', 'items', 'fields', 'check']);
const DEF_KEYS = new Set(['tier', 'target', 'args', 'allArgs', 'hubOnly', 'localOnly', 'remoteOnly', 'allConfirm',
  'confirmCheck', 'prepare', 'status', 'runsAll', 'run']);

/** A refusal with an HTTP status and a stable machine code. `result` (optional) is returned to the caller. */
export class ActionRefused extends Error {
  constructor(status, code, message = code, result = undefined) {
    super(message);
    this.name = 'ActionRefused';
    this.status = status;
    this.code = code;
    if (result !== undefined) this.result = result;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Registry

const ACTIONS = new Map();      // name -> frozen def
const ALL_HANDLERS = new Map(); // name -> run for target '*'

function parseTarget(t) {
  if (typeof t !== 'string') throw new TypeError('registerAction: target must be a string');
  const orAll = t.endsWith('-or-all');
  const kind = orAll ? t.slice(0, -'-or-all'.length) : t;
  if (!TARGET_KINDS.includes(kind) || (orAll && kind === 'all')) throw new TypeError(`registerAction: unknown target kind ${JSON.stringify(t)}`);
  return { kind, allowAll: orAll || kind === 'all' };
}

function checkSpec(where, spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError(`${where}: spec must be an object`);
  for (const k of Object.keys(spec)) if (!SPEC_KEYS.has(k)) throw new TypeError(`${where}: unknown spec key ${JSON.stringify(k)}`);
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  if (!types.length || !types.every((t) => ARG_TYPES.has(t))) throw new TypeError(`${where}: bad type ${JSON.stringify(spec.type)}`);
  if (spec.re !== undefined && !(spec.re instanceof RegExp)) throw new TypeError(`${where}: re must be a RegExp`);
  if (spec.re?.global || spec.re?.sticky) throw new TypeError(`${where}: re must not be global or sticky`);
  if (spec.enum !== undefined && !Array.isArray(spec.enum) && typeof spec.enum !== 'function') throw new TypeError(`${where}: enum must be an array or a function`);
  if (spec.check !== undefined && typeof spec.check !== 'function') throw new TypeError(`${where}: check must be a function`);
  if (types.includes('array')) {
    if (spec.items === undefined) throw new TypeError(`${where}: array needs items`);
    checkSpec(`${where}[]`, spec.items);
  }
  if (types.includes('object')) {
    if (spec.fields === undefined) throw new TypeError(`${where}: object needs fields`);
    checkSchema(where, spec.fields);
  }
}

function checkSchema(where, schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new TypeError(`${where}: args must be an object`);
  for (const [k, spec] of Object.entries(schema)) checkSpec(`${where}.${k}`, spec);
}

/**
 * registerAction(name, {tier, target, args, allArgs?, hubOnly?, localOnly?, remoteOnly?, allConfirm?, prepare?,
 *   status?, run})
 *   tier: 'read'|'click'|'ask'|'confirm'.
 *   target: one of TARGET_KINDS, optionally with '-or-all' ('session-or-all', 'lane-or-all', 'alarm-or-all').
 *   args: {field: spec}, strict (unknown keys -> 400 bad_args). spec = {type (or an array of types), required?,
 *     default?, min?, max? (string/array length or number range), re?, enum? (array or (config) => array),
 *     items? (array element spec), fields? (object, strict), check? ((value, ctx) => error string | null)}.
 *   allArgs: extra fields accepted only when target is '*'.
 *   hubOnly: refused on a builder (400 hub_only). localOnly: refused for hub kind (403 local-only).
 *   remoteOnly: true, or a predicate ({action, target, args, user, via, kind}, deps) => bool evaluated after the
 *     args; refused for kind 'local' (403 remote-only). A predicate must decide on `kind` (the auth kind), never
 *     on `via` or `user`; anything other than `false` (a throw included) refuses.
 *   runsAll: run() itself handles target '*' (otherwise '*' needs registerAllHandler(name, fn), else 501).
 *   allConfirm: false exempts target '*' from the `args.confirm === fleet.id` rule; only the actions in
 *     ALL_CONFIRM_EXEMPT (ack-alarm, broadcast) may set it, and a confirm-tier one must then give confirmCheck.
 *   confirmCheck: async? ({target, args, deps, config}) => error string | null (only null/undefined pass), the action's own confirm rule (e.g.
 *     broadcast's confirmCount), run at the tier step; a throw or a non-null value refuses (fail closed).
 *   prepare: async ({target, args, deps, config}) => args, after the schema (normalise, e.g. realpath); a throw is
 *     400 bad_args unless it is an ActionRefused.
 *   status: (result, args) => HTTP status of a success (default 200).
 *   run: async ({action, target, args, user, via, kind, auth, deps, config}) => result (plain object).
 */
export function registerAction(name, def) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError(`registerAction: invalid name ${JSON.stringify(name)}`);
  if (ACTIONS.has(name)) throw new TypeError(`registerAction: ${name} is already registered`);
  if (def === null || typeof def !== 'object') throw new TypeError('registerAction: def must be an object');
  for (const k of Object.keys(def)) if (!DEF_KEYS.has(k)) throw new TypeError(`registerAction(${name}): unknown key ${JSON.stringify(k)}`);
  if (!TIERS.includes(def.tier)) throw new TypeError(`registerAction(${name}): unknown tier ${JSON.stringify(def.tier)}`);
  const target = parseTarget(def.target);
  const args = def.args ?? {};
  checkSchema(`registerAction(${name}).args`, args);
  const allArgs = def.allArgs ?? {};
  checkSchema(`registerAction(${name}).allArgs`, allArgs);
  if (Object.keys(allArgs).length && !target.allowAll) throw new TypeError(`registerAction(${name}): allArgs needs a target that accepts '*'`);
  for (const k of Object.keys(allArgs)) if (Object.hasOwn(args, k)) throw new TypeError(`registerAction(${name}): ${k} is in args and allArgs`);
  if (def.tier === 'confirm' && def.hubOnly !== true && !Object.hasOwn(args, 'confirm')) throw new TypeError(`registerAction(${name}): confirm tier needs a confirm arg`);
  if (target.allowAll && def.allConfirm !== false && def.hubOnly !== true && !Object.hasOwn(args, 'confirm')) throw new TypeError(`registerAction(${name}): a '*' target needs a confirm arg`);
  if (typeof def.run !== 'function') throw new TypeError(`registerAction(${name}): run must be a function`);
  for (const k of ['prepare', 'status']) if (def[k] !== undefined && typeof def[k] !== 'function') throw new TypeError(`registerAction(${name}): ${k} must be a function`);
  const ro = def.remoteOnly ?? false;
  if (typeof ro !== 'boolean' && typeof ro !== 'function') throw new TypeError(`registerAction(${name}): remoteOnly must be a boolean or a function`);
  for (const k of ['hubOnly', 'localOnly']) if (def[k] !== undefined && typeof def[k] !== 'boolean') throw new TypeError(`registerAction(${name}): ${k} must be a boolean`);
  if (def.runsAll !== undefined && typeof def.runsAll !== 'boolean') throw new TypeError(`registerAction(${name}): runsAll must be a boolean`);
  if (def.runsAll && !target.allowAll) throw new TypeError(`registerAction(${name}): runsAll needs a target that accepts '*'`);
  if (def.allConfirm !== undefined && def.allConfirm !== false) throw new TypeError(`registerAction(${name}): allConfirm may only be false`);
  if (def.allConfirm === false && !ALL_CONFIRM_EXEMPT.includes(name)) throw new TypeError(`registerAction(${name}): allConfirm:false is reserved for ${ALL_CONFIRM_EXEMPT.join(', ')}`);
  if (def.confirmCheck !== undefined && typeof def.confirmCheck !== 'function') throw new TypeError(`registerAction(${name}): confirmCheck must be a function`);
  if (def.allConfirm === false && def.tier === 'confirm' && typeof def.confirmCheck !== 'function') throw new TypeError(`registerAction(${name}): a confirm tier with allConfirm:false needs confirmCheck`);
  ACTIONS.set(name, Object.freeze({
    name, tier: def.tier, target, args, allArgs,
    hubOnly: def.hubOnly === true, localOnly: def.localOnly === true, remoteOnly: ro,
    allConfirm: def.allConfirm !== false, confirmCheck: def.confirmCheck ?? null,
    prepare: def.prepare ?? null, status: def.status ?? null, runsAll: def.runsAll === true, run: def.run,
  }));
}

/** The `*` handler for an action registered elsewhere (e.g. §8 C9 registerAllHandler('kill', killAll)). */
export function registerAllHandler(name, run) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError(`registerAllHandler: invalid name ${JSON.stringify(name)}`);
  if (typeof run !== 'function') throw new TypeError('registerAllHandler: run must be a function');
  if (ALL_HANDLERS.has(name)) throw new TypeError(`registerAllHandler: ${name} already has a '*' handler`);
  ALL_HANDLERS.set(name, run);
}

/** {name: tier} of every action this builder serves (hubOnly ones are left out); hello.actions. */
export function tiers() {
  const out = {};
  for (const [name, def] of [...ACTIONS].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!def.hubOnly) out[name] = def.tier;
  }
  return out;
}

export function has(name) { return ACTIONS.has(name); }

/** Tests only. */
export function _reset() {
  ACTIONS.clear();
  ALL_HANDLERS.clear();
}

// ---------------------------------------------------------------------------------------------------------
// Validation helpers

const bad = (message) => new ActionRefused(400, 'bad_args', message);

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : 'nonfinite';
  return typeof v;
}

function checkValue(path, v, spec, ctx) {
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const t = typeOf(v);
  const okType = types.some((want) => (want === 'integer' ? t === 'number' && Number.isSafeInteger(v) : want === t));
  if (!okType) throw bad(`${path} must be ${types.join(' or ')}`);
  if (t === 'string') {
    if (!v.isWellFormed()) throw bad(`${path} is not well-formed text`);
    if (spec.min !== undefined && v.length < spec.min) throw bad(`${path} is shorter than ${spec.min}`);
    if (spec.max !== undefined && v.length > spec.max) throw bad(`${path} is longer than ${spec.max}`);
    if (spec.re && !spec.re.test(v)) throw bad(`${path} has an invalid format`);
  } else if (t === 'number') {
    if (spec.min !== undefined && v < spec.min) throw bad(`${path} is below ${spec.min}`);
    if (spec.max !== undefined && v > spec.max) throw bad(`${path} is above ${spec.max}`);
  }
  if (spec.enum !== undefined && t !== 'null') {
    const allowed = typeof spec.enum === 'function' ? spec.enum(ctx.config) : spec.enum;
    if (!Array.isArray(allowed) || !allowed.includes(v)) throw bad(`${path} is not an allowed value`);
  }
  let out = v;
  if (t === 'array') {
    if (spec.min !== undefined && v.length < spec.min) throw bad(`${path} needs at least ${spec.min} entries`);
    if (spec.max !== undefined && v.length > spec.max) throw bad(`${path} has more than ${spec.max} entries`);
    out = v.map((item, i) => checkValue(`${path}[${i}]`, item, spec.items, ctx));
  } else if (t === 'object') {
    out = checkObject(path, v, spec.fields, ctx);
  }
  if (spec.check) {
    const err = spec.check(out, ctx);
    if (err) throw bad(`${path}: ${String(err)}`);
  }
  return out;
}

// Strict: unknown keys are refused, defaults are filled, the output is a fresh null-prototype-free copy.
function checkObject(path, obj, schema, ctx) {
  if (!isPlainObject(obj)) throw bad(`${path} must be an object`);
  for (const k of Object.keys(obj)) {
    if (!Object.hasOwn(schema, k)) throw bad(`${path}: unknown key ${JSON.stringify(k.slice(0, 40))}`);
  }
  const out = {};
  for (const [k, spec] of Object.entries(schema)) {
    const present = Object.hasOwn(obj, k) && obj[k] !== undefined;
    if (!present) {
      if (spec.default !== undefined) out[k] = structuredClone(spec.default);
      else if (spec.required) throw bad(`${path}.${k} is required`);
      continue;
    }
    out[k] = checkValue(`${path}.${k}`, obj[k], spec, ctx);
  }
  return out;
}

function checkTarget(def, target, deps, config) {
  if (typeof target !== 'string' || target === '') throw new ActionRefused(400, 'bad_target', 'target must be a non-empty string');
  if (target === '*') {
    if (!def.target.allowAll) throw new ActionRefused(400, 'bad_target', `${def.name} does not accept target *`);
    return;
  }
  switch (def.target.kind) {
    case 'all':
      throw new ActionRefused(400, 'bad_target', `${def.name} only accepts target *`);
    case 'session':
    case 'session-new':
      if (!isSafeSessionName(target)) throw new ActionRefused(400, 'bad_target', 'invalid session name');
      if (def.target.kind === 'session') {
        if (typeof deps?.state?.get !== 'function') throw new ActionRefused(500, 'internal', 'no session inventory');
        if (!deps.state.get(target)) throw new ActionRefused(404, 'unknown_session', 'unknown session');
      }
      return;
    case 'lane':
      if (!LANE_ID_RE.test(target) || target.includes('..')) throw new ActionRefused(400, 'bad_target', 'invalid lane id');
      return;
    case 'builder':
      if (!config?.fleet?.id || target !== config.fleet.id) throw new ActionRefused(400, 'bad_target', 'target is not this builder');
      return;
    case 'alarm':
      if (!ALARM_ID_RE.test(target)) throw new ActionRefused(400, 'bad_target', 'invalid alarm id');
      return;
    default:
      throw new ActionRefused(500, 'internal', 'bad target kind');
  }
}

function hasScope(scopes, s) {
  if (scopes instanceof Set) return scopes.has(s);
  if (Array.isArray(scopes)) return scopes.includes(s);
  return false;
}

function errorText(err) {
  return String(err?.message ?? err).toWellFormed().slice(0, ERROR_MAX);
}

// ---------------------------------------------------------------------------------------------------------
// dispatch

/**
 * dispatch(envelope, {auth, deps, config?, audit, limiter, now?, log?})
 *   -> {ok:true, status, result, auditId, auditFailed?}
 *    | {ok:false, status, error, code, result?, retryAfterMs?, auditId, auditFailed?}
 *
 * envelope: {v:1, id:uuid, ts, builder, action, target, args, user?, via} (already parsed and, for hub kind,
 *   signature-verified by A4; this function re-checks the shape it relies on). `via` is ignored: it is derived
 *   from auth.kind.
 * auth: {kind:'local'|'direct'|'hub', user? (required for direct), scopes? (Set|array, hub), keyLabel?, readOnly?,
 *   verified (hub: must be true, else 403 unverified, audited; `hub-pending` is always refused that way)}.
 * deps: handed to run() (actions, launcher, retirer, state, config, ...). config defaults to deps.config.
 * audit: openAudit() result (append); limiter: createLimiter() result (take); auditId = the outcome entry's hash.
 * Never throws for a bad envelope or a failing action; throws TypeError only for a missing auth/audit (a
 * wiring bug, nothing to audit against).
 */
export async function dispatch(envelope, ctx = {}) {
  const { auth, deps = {}, audit, limiter, now = Date.now, log = null } = ctx;
  const config = ctx.config ?? deps.config ?? {};
  if (!auth || !(KINDS.includes(auth.kind) || auth.kind === 'hub-pending')) throw new TypeError('dispatch: auth.kind is required');
  if (!audit || typeof audit.append !== 'function') throw new TypeError('dispatch: audit is required');

  const env = isPlainObject(envelope) ? envelope : {};
  const str = (v) => (typeof v === 'string' ? v : null);
  let user;
  if (HUB_KINDS.includes(auth.kind)) user = str(env.user) && HUB_USER_RE.test(env.user) ? env.user : null;
  else if (auth.kind === 'direct') user = str(auth.user) || UNKNOWN_DIRECT_USER;
  else user = str(auth.user) || 'local';
  // What we know for the audit entry, filled in as checks pass.
  const rec = {
    id: str(env.id) && UUID_RE.test(env.id) ? env.id : undefined,
    user,
    via: VIA_OF_KIND[auth.kind],
    builder: str(env.builder),
    action: str(env.action) && NAME_RE.test(env.action) ? env.action : 'invalid',
    target: str(env.target),
    rawArgs: env.args,
  };
  let argsHash;
  try { argsHash = argsHashOf(rec.rawArgs); } catch { argsHash = argsHashOf({ unhashable: true }); }
  const append = (result) => {
    if (HUB_KINDS.includes(auth.kind) && typeof auth.keyLabel === 'string') result.key = auth.keyLabel;
    return audit.append({
      ts: now(), id: rec.id, user: rec.user, via: rec.via, builder: rec.builder,
      action: rec.action, target: rec.target, argsHash, result,
    });
  };

  let out;
  let job;
  let started = false;
  try {
    const p = await runChecked(env, rec, { auth, deps, config, limiter });
    // pre-action audit: fail closed, the action must not run unaudited (SR5 M2)
    try {
      append({ phase: 'start' });
    } catch (err) {
      log?.error?.(`dispatch ${rec.action}: audit append failed, action refused: ${errorText(err)}`);
      throw new ActionRefused(503, 'audit-unavailable', 'the audit log is unavailable; the action did not run');
    }
    started = true;
    const r = await execute(p);
    job = typeof r.result?.job === 'string' ? r.result.job : undefined;
    out = { ok: true, status: r.status, result: r.result };
  } catch (err) {
    if (err instanceof ActionRefused) {
      out = { ok: false, status: err.status, error: errorText(err), code: err.code };
      if (err.result !== undefined) out.result = err.result;
      if (err.retryAfterMs !== undefined) out.retryAfterMs = err.retryAfterMs;
    } else if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600) {
      // ActionError / LaneError from the existing modules: their messages are written for the user.
      out = { ok: false, status: err.status, error: errorText(err), code: typeof err.code === 'string' ? err.code : (err.status >= 500 ? 'failed' : 'refused') };
    } else {
      log?.error?.(`dispatch ${rec.action}: ${errorText(err)}`);
      out = { ok: false, status: 500, error: 'internal error', code: 'internal' };
    }
  }
  // Audit the outcome. Not in a `finally`: an audit failure must not mask the outcome already reached.
  let auditId = null;
  let auditFailed = false;
  try {
    const result = { ok: out.ok, status: out.status };
    if (!out.ok) { result.code = out.code; result.error = out.error; }
    if (job) result.job = job;
    if (started) result.phase = 'done';
    const entry = append(result);
    auditId = entry?.hash ?? null;
  } catch (err) {
    auditFailed = true;
    log?.error?.(`dispatch ${rec.action}: audit append failed${started ? ' after the action ran' : ''}: ${errorText(err)}`);
  }
  const res = { ...out, auditId };
  if (auditFailed) res.auditFailed = true;
  return res;
}

// The rate-limit identity of a request (SR5 L4): a hub request is charged under its signing key as well as
// under (key, user), so a key that rotates `user` still hits the per-key buckets.
function takeLimits(limiter, rec, def, target, args, auth) {
  // C9: cancelling a builder kill inside its grace only clears a timer; the `all` bucket (1 per 10 s) would
  // otherwise refuse the cancel of a `kill *` just sent by the same user (default grace 10 s)
  if (def.name === 'kill' && target === '*' && args.cancel !== undefined) return { ok: true, retryAfterMs: 0 };
  const fanoutParent = def.name === 'send-text' ? args.fanout?.parent : undefined;
  if (auth.kind !== 'hub') return limiter.take(rec.user, def.name, target, { kind: auth.kind, fanoutParent });
  const key = typeof auth.keyLabel === 'string' && auth.keyLabel ? auth.keyLabel : 'unknown-key';
  // per key first (it also carries the shared `hub` bucket); a refusal there consumes nothing
  const perKey = limiter.take(JSON.stringify(['hub-key', key]), def.name, target, { kind: 'hub', fanoutParent });
  if (!perKey.ok) return perKey;
  return limiter.take(JSON.stringify(['hub-key', key, rec.user]), def.name, target, { kind: 'direct', fanoutParent });
}

async function execute({ def, runFn, target, args, rec, auth, deps, config }) {
  const result = await runFn({ action: def.name, target, args: structuredClone(args), user: rec.user, via: rec.via, kind: auth.kind, auth, deps, config });
  const plain = result === undefined || result === null ? {} : result;
  let status = 200;
  if (def.status) {
    // the side effect already happened: a throwing status() must not turn it into a reported failure (SR5 L2)
    try { status = def.status(plain, args); } catch { status = 200; }
  }
  return { status: Number.isInteger(status) ? status : 200, result: plain };
}

async function runChecked(env, rec, { auth, deps, config, limiter }) {
  // 0. a hub caller must carry a VERIFIED signature (SR3 H1): A4's classify only yields `hub-pending` for an
  //    action whose envelope is not verified yet; only auth.verifyPendingAction/verifyEnvelope make it `hub`.
  if (auth.kind === 'hub-pending' || (auth.kind === 'hub' && auth.verified !== true)) {
    throw new ActionRefused(403, 'unverified', 'the hub signature was not verified');
  }
  // 1. shape (env.via is not checked: it is derived from auth.kind)
  if (env.v !== 1) throw new ActionRefused(400, 'bad_envelope', 'envelope v must be 1');
  if (!rec.id) throw new ActionRefused(400, 'bad_envelope', 'envelope id must be a UUID');
  if (typeof env.ts !== 'number' || !Number.isFinite(env.ts)) throw new ActionRefused(400, 'bad_envelope', 'envelope ts must be a number');
  if (rec.action === 'invalid') throw new ActionRefused(400, 'bad_envelope', 'envelope action is invalid');
  if (auth.kind === 'direct' && rec.user === UNKNOWN_DIRECT_USER) throw new ActionRefused(403, 'no-identity', 'a direct request needs an authenticated user');
  if (!rec.user) throw new ActionRefused(400, 'bad_envelope', 'envelope user is invalid');
  if (typeof env.target !== 'string') throw new ActionRefused(400, 'bad_envelope', 'envelope target must be a string');
  if (env.args !== undefined && !isPlainObject(env.args)) throw new ActionRefused(400, 'bad_envelope', 'envelope args must be an object');
  const fleetId = config?.fleet?.id;
  if (typeof fleetId === 'string' && fleetId && env.builder !== fleetId) throw new ActionRefused(400, 'bad_envelope', 'envelope is for another builder');
  // The hub itself: every action needs a direct user (README §3.5).
  if (config?.mode === 'hub' && auth.kind !== 'direct') throw new ActionRefused(403, 'remote-only', 'on the hub every action needs a direct user');

  // 2. registry
  const def = ACTIONS.get(rec.action);
  if (!def) throw new ActionRefused(400, 'unknown_action', 'unknown action');
  if (def.hubOnly && config?.mode !== 'hub') throw new ActionRefused(400, 'hub_only', `${def.name} runs on the hub only`);

  // 3. hub control (master switch, then the key's scope), local-only
  if (auth.kind === 'hub') {
    if (config?.fleet?.hubControl !== true) throw new ActionRefused(403, 'control-disabled', 'hub control is disabled on this builder');
    if (!hasScope(auth.scopes, 'control')) throw new ActionRefused(403, 'scope-missing', 'the hub key lacks the control scope');
    if (def.localOnly) throw new ActionRefused(403, 'local-only', `${def.name} is not accepted from the hub`);
  }
  if (auth.readOnly === true) throw new ActionRefused(403, 'read-only', 'read-only role');

  // 4. remote-only (flag)
  if (def.remoteOnly === true && auth.kind === 'local') throw new ActionRefused(403, 'remote-only', `${def.name} is remote-only`);

  // 5. target
  const target = env.target;
  checkTarget(def, target, deps, config);
  const all = target === '*';

  // 6. args (strict; a deep copy of the validated value is what runs)
  const schema = all ? { ...def.args, ...def.allArgs } : def.args;
  const vctx = { config, deps, target };
  let args = checkObject('args', env.args ?? {}, schema, vctx);
  if (def.prepare) {
    try {
      args = await def.prepare({ target, args, deps, config });
    } catch (err) {
      if (err instanceof ActionRefused) throw err;
      throw bad(errorText(err));
    }
  }

  // 7. remote-only (predicate)
  const view = { action: def.name, target, args, user: rec.user, via: rec.via, kind: auth.kind };
  if (typeof def.remoteOnly === 'function' && auth.kind === 'local') {
    let ro;
    try { ro = def.remoteOnly(view, deps); } catch { ro = true; } // fail closed
    if (ro !== false) throw new ActionRefused(403, 'remote-only', `${def.name} is remote-only here`);
  }

  // 8. tier
  if (all && def.allConfirm) {
    // a builder never accepts the hub's constant "fleet"; the hub rewrites it to each builder's id
    if (typeof fleetId !== 'string' || !fleetId || args.confirm === 'fleet' || args.confirm !== fleetId) {
      throw new ActionRefused(400, 'confirm_required', 'target * needs confirm equal to this builder id');
    }
  } else if (def.tier === 'confirm' && !all) {
    if (typeof args.confirm !== 'string' || args.confirm !== target) throw new ActionRefused(400, 'confirm_required', `confirm must equal ${target}`);
  }
  if (def.confirmCheck) {
    let err;
    try { err = await def.confirmCheck({ target, args, deps, config }); } catch (e) {
      if (e instanceof ActionRefused) throw e;
      err = errorText(e) || 'confirm check failed';
    }
    if (err !== null && err !== undefined) throw new ActionRefused(400, 'confirm_required', String(err === false ? 'confirm check failed' : err).slice(0, ERROR_MAX));
  }
  const runFn = all ? (ALL_HANDLERS.get(def.name) ?? (def.runsAll || def.target.kind === 'all' ? def.run : null)) : def.run;
  if (!runFn) throw new ActionRefused(501, 'not_implemented', `${def.name} * is not available on this builder`);

  // 9. rate limit
  if (limiter) {
    const lim = takeLimits(limiter, rec, def, target, args, auth);
    if (!lim.ok) {
      const e = new ActionRefused(429, 'rate_limited', 'rate_limited');
      e.retryAfterMs = lim.retryAfterMs;
      throw e;
    }
  }

  // 10. run (dispatch appends the start entry first)
  return { def, runFn, target, args, rec, auth, deps, config };
}
