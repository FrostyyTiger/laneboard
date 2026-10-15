// API v1 (fleet plan §1 2.8, §2 2.9): the handlers behind /api/v1/*, the
// hello registry other builder modules extend, and the one door every
// mutation goes through (runAction -> dispatch). REVIEW-REQUIRED (SR6).
//
// The registry is a module singleton. Route modules import it directly, never
// through ctx (modules.mjs rule):
//
//   import { addCapability, addHelloField } from '../fleet/api-v1.mjs';
//   addCapability('packages');                       // hello.capabilities
//   addHelloField('repos', () => [...]);             // hello.repos
//
// ROUTES is the v1 route table that server/routes/v1.mjs registers; the
// WebSocket paths (/api/v1/stream, /api/v1/term/:name) go through upgradeV1.
// Classification and the kind rules (local / direct / signed hub, Host,
// Origin, CSRF) already ran in http.mjs / boot/common.mjs before any handler
// here; a hub action envelope is verified HERE (auth.verifyEnvelope over the
// parsed body) and only the returned frozen `auth.envelope` is acted on.
//
// Services (audit log, rate limiter, default deps) are set once at boot by
// initV1() / configureV1(); without an audit log every mutation answers 503
// `audit-unavailable` (fail closed: nothing runs unaudited).
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import { VERSION } from '../version.mjs';
import { log } from '../log.mjs';
import * as state from '../state.mjs';
import * as ws from '../ws.mjs';
import * as stream from './stream.mjs';
import * as auth from './auth.mjs';
import { tiers, dispatch, registerAction, has, ActionRefused } from './dispatch.mjs';
import { openAudit, createUnauthWarner, argsHashOf } from './audit.mjs';
import { createLimiter } from './ratelimit.mjs';
import { auditFile } from './paths.mjs';
import { isSafeSessionName } from '../util.mjs';
import { json, readBody, authOptions } from '../http.mjs';

export const API_VERSION = 1;

/** Keys a hello field may not take: the core shape, and A8's `auth`. */
export const RESERVED_HELLO_KEYS = Object.freeze([
  'id', 'code', 'version', 'apiVersion', 'mode', 'capabilities', 'actions', 'time', 'auth',
]);

// Capability names: `snapshot`, `conflicts:textual`, `launch`.
const CAPABILITY_RE = /^[a-z][a-z0-9-]{0,31}(:[a-z][a-z0-9-]{0,31})?$/;
// Hello field names: plain camelCase identifiers (no `__proto__`, no dots).
const FIELD_RE = /^[a-z][A-Za-z0-9]{0,31}$/;

const capabilities = new Set();
const helloFields = new Map(); // name -> fn()

/** Add a capability to hello.capabilities. Idempotent. */
export function addCapability(name) {
  if (typeof name !== 'string' || !CAPABILITY_RE.test(name)) {
    throw new TypeError(`addCapability: bad capability name ${JSON.stringify(name)}`);
  }
  capabilities.add(name);
}

/**
 * Add `hello[name] = fn()`. A core key, `auth`, or a second registration of
 * the same name is refused. `fn` runs on every hello; a throw or `undefined`
 * leaves the field out (logged, never fatal for the hello).
 */
export function addHelloField(name, fn) {
  if (typeof name !== 'string' || !FIELD_RE.test(name)) {
    throw new TypeError(`addHelloField: bad field name ${JSON.stringify(name)}`);
  }
  if (RESERVED_HELLO_KEYS.includes(name)) throw new TypeError(`addHelloField: '${name}' is reserved`);
  if (helloFields.has(name)) throw new TypeError(`addHelloField: '${name}' is already registered`);
  if (typeof fn !== 'function') throw new TypeError('addHelloField: fn must be a function');
  helloFields.set(name, fn);
}

/** ['snapshot', ...registered, sorted], deduplicated. */
export function capabilityList() {
  return ['snapshot', ...[...capabilities].filter((c) => c !== 'snapshot').sort()];
}

function builderIdentity() {
  return { id: config.fleet?.id ?? null, code: config.fleet?.code ?? null };
}

/** GET /api/v1/hello (README §3.3). `opts.now` for tests; `opts.auth` adds `auth: {kind}`. */
export function hello({ now = Date.now(), auth: a } = {}) {
  const { id, code } = builderIdentity();
  const out = {
    id,
    code,
    version: VERSION,
    apiVersion: API_VERSION,
    mode: config.mode ?? 'builder',
    capabilities: capabilityList(),
    actions: tiers(),
    time: now,
  };
  if (a && typeof a.kind === 'string') out.auth = { kind: a.kind };
  for (const [name, fn] of helloFields) {
    let value;
    try {
      value = fn();
    } catch (err) {
      log.warn(`v1 hello field '${name}' failed: ${err?.message || err}`);
      continue;
    }
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * GET /api/v1/snapshot: state.snapshot() + {builder, seq, epoch}, sessions
 * through ws.forWire so no `preview`/`previewHtml` leaves the builder. `opts`
 * swaps the sources for tests.
 */
export function snapshot({ source = state.snapshot, seq = ws.currentSeq, epoch = stream.epoch } = {}) {
  const snap = source();
  return {
    ...snap,
    sessions: (snap.sessions ?? []).map(ws.forWire),
    builder: builderIdentity(),
    seq: seq(),
    epoch: epoch(),
  };
}

// The stream's snapshot frames carry the same body as GET /api/v1/snapshot.
stream.setSnapshotSource(() => snapshot());

// ---------------------------------------------------------------------------------------------------------
// Services: audit log, rate limiter, default deps

/** Body cap of POST /api/v1/actions (§2 2.4). */
export const ACTIONS_BODY_LIMIT = 65536;
/** How far back the nonce cache is pre-loaded from the audit log at boot (= the nonce TTL). */
export const NONCE_PRELOAD_MS = 300000;
const VIA_OF_KIND = Object.freeze({ hub: 'hub', direct: 'direct', local: 'legacy' });

const services = {
  audit: null,
  auditError: null,
  limiter: null,
  deps: {},
  unauth: createUnauthWarner({ log }),
};

/**
 * Tests (and initV1): set any of {audit, limiter, deps}. `deps` are the
 * dispatch deps ({actions, launcher, retirer, state, config, terminals, db}).
 */
export function configureV1({ audit, limiter, deps } = {}) {
  if (audit !== undefined) { services.audit = audit; services.auditError = null; }
  if (limiter !== undefined) services.limiter = limiter;
  if (deps !== undefined) services.deps = { ...deps };
}

export function auditLog() {
  return services.audit;
}

/**
 * Pre-load the nonce cache with every audit entry id of the last 5 minutes
 * (§2 2.4), so a restart does not re-open the replay window. Returns the count.
 */
export function preloadNonces(audit, nonces = auth.nonceCache(), now = Date.now()) {
  let n = 0;
  let after;
  const since = now - NONCE_PRELOAD_MS;
  for (let page = 0; page < 20; page++) {
    const r = after === undefined ? audit.read({ since, limit: 1000 }) : audit.read({ after, limit: 1000 });
    for (const e of r.entries) {
      if (typeof e.id === 'string' && auth.UUID_RE.test(e.id) && Number.isFinite(e.ts) && e.ts >= since) {
        const res = nonces.add(e.id, e.ts);
        if (res.ok) n++;
      }
    }
    if (!r.more || !r.entries.length) break;
    after = r.entries[r.entries.length - 1].hash;
  }
  return n;
}

/**
 * Boot (builder.mjs, before listening): open the audit log, pre-load the
 * nonce cache, create the limiter. An audit log that cannot be opened is
 * logged and leaves every mutation refused (503 audit-unavailable).
 */
export function initV1({ cfg = config, deps, file = auditFile(), openAuditFn = openAudit } = {}) {
  if (deps) services.deps = { ...deps };
  try {
    services.limiter = createLimiter(cfg.fleet?.rateLimits ?? null);
  } catch (err) {
    log.error(`fleet: bad fleet.rateLimits, using the defaults: ${err?.message || err}`);
    services.limiter = createLimiter(null);
  }
  try {
    const audit = openAuditFn({ file, maxBytes: cfg.fleet?.audit?.maxBytes ?? undefined, builder: cfg.fleet?.id ?? null });
    services.audit = audit;
    services.auditError = null;
    const n = preloadNonces(audit);
    if (n) log.info(`fleet: nonce cache pre-loaded with ${n} recent audit ids`);
  } catch (err) {
    services.audit = null;
    services.auditError = String(err?.code || err?.message || err).slice(0, 200);
    log.error(`fleet: the audit log could not be opened (${services.auditError}); every action is refused until it is fixed`);
  }
  return services;
}

function unavailable() {
  return { ok: false, status: 503, error: 'the audit log is unavailable; the action did not run', code: 'audit-unavailable', auditId: null };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Write one refusal entry the way dispatch does (an authenticated outcome is always audited). */
function auditRefusal(env, a, status, code, error) {
  const audit = services.audit;
  let user = 'local';
  if (a.kind === 'hub') user = typeof env.user === 'string' ? env.user : null;
  else if (typeof a.user === 'string' && a.user) user = a.user;
  const entry = {
    id: typeof env.id === 'string' && auth.UUID_RE.test(env.id) ? env.id : undefined,
    user, via: VIA_OF_KIND[a.kind] ?? 'legacy', builder: typeof env.builder === 'string' ? env.builder : null,
    action: typeof env.action === 'string' && auth.ACTION_RE.test(env.action) ? env.action : 'invalid',
    target: typeof env.target === 'string' ? env.target : null,
    result: { ok: false, status, code, error },
  };
  try { entry.argsHash = argsHashOf(env.args ?? {}); } catch { entry.argsHash = argsHashOf({ unhashable: true }); }
  try {
    return audit.append(entry)?.hash ?? null;
  } catch (err) {
    log.error(`v1: audit append failed for a refusal: ${String(err?.message ?? err).slice(0, 200)}`);
    return null;
  }
}

/**
 * Launch args a LOCAL caller may not set (SR17 M1): priority 'high', and a
 * budgetUsd above the configured per-lane default (`budget.perLaneUsd`; with
 * no default configured any budget is a cap where there was none). Remote
 * users and the hub may. null or the refusal message.
 */
export function localLaunchRefusal(env, a, cfg = config) {
  if (a.kind !== 'local' || env?.action !== 'launch' || !isObj(env.args)) return null;
  if (env.args.priority === 'high') return "priority 'high' is remote-only";
  const per = cfg.budget?.perLaneUsd;
  const b = env.args.budgetUsd;
  if (b !== undefined && b !== null && typeof per === 'number' && Number.isFinite(per) && per > 0 && !(typeof b === 'number' && b <= per)) {
    return `budgetUsd above the per-lane default (${per}) is remote-only`;
  }
  return null;
}

/**
 * Run one action envelope for an authenticated caller (`a` from classify, or
 * the verified hub auth). Every outcome is audited. `opts.deps` add to /
 * override the default deps, `opts.config` the dispatch config.
 */
export async function runAction(envelope, a, { deps, config: cfg = config } = {}) {
  if (!auth.isAuthenticated(a)) throw new TypeError('runAction: an authenticated auth (issued by auth.mjs) is required');
  if (!services.audit) return unavailable();
  const env = isObj(envelope) ? envelope : {};
  const local = localLaunchRefusal(env, a, cfg);
  if (local) {
    const auditId = auditRefusal(env, a, 403, 'remote-only', local);
    return { ok: false, status: 403, error: local, code: 'remote-only', auditId };
  }
  return dispatch(envelope, {
    auth: a,
    deps: { ...services.deps, config: cfg, ...(deps ?? {}) },
    config: cfg,
    audit: services.audit,
    limiter: services.limiter,
    log,
  });
}

/** The v1 response body of a dispatch outcome: {ok, result|error, code?, retryAfterMs?, auditId}. */
export function actionBody(out) {
  const body = { ok: out.ok };
  if (out.ok) body.result = out.result;
  else {
    body.error = out.error;
    if (out.code) body.code = out.code;
    if (out.result !== undefined) body.result = out.result;
    if (out.retryAfterMs !== undefined) body.retryAfterMs = out.retryAfterMs;
  }
  body.auditId = out.auditId ?? null;
  if (out.auditFailed) body.auditFailed = true;
  return body;
}

function retryHeaders(out) {
  return out.status === 429 && Number.isFinite(out.retryAfterMs) ? { 'retry-after': String(Math.max(1, Math.ceil(out.retryAfterMs / 1000))) } : {};
}

function refusal(res, err) {
  return json(res, { error: err.code, reason: err.code }, err.status);
}

/**
 * POST /api/v1/actions. Body: an action envelope (§2 2.6). A hub request is
 * verified here, over the PARSED body (auth.verifyEnvelope: key, signature,
 * shape, builder, ts, nonce) and only the frozen verified envelope runs. For
 * `direct`/`local` the envelope is unsigned; dispatch takes the user from the
 * classification, never from the body, and derives `via` from the kind.
 */
export async function postAction(req, res) {
  let buf;
  try {
    buf = await readBody(req, ACTIONS_BODY_LIMIT);
  } catch {
    return json(res, { ok: false, error: 'body too large', code: 'too_large' }, 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    return json(res, { ok: false, error: 'body is not JSON', code: 'bad_json' }, 400);
  }
  if (!isObj(parsed)) return json(res, { ok: false, error: 'body must be an envelope object', code: 'bad_envelope' }, 400);

  let a = req.auth;
  let envelope = parsed;
  if (a?.kind === 'hub-pending') {
    // A hub: verify the PARSED body against this request's -Sig/-Key (same key as the pending auth). The
    // shared boot nonce cache and the per-key budgets are auth.mjs's own (no nonces/now injected here).
    try {
      a = auth.verifyPendingAction(req, parsed, config, authOptions());
    } catch (err) {
      if (!(err instanceof auth.AuthError)) throw err;
      if (err.status === 401 || err.status === 403) services.unauth.note(err.code);
      return refusal(res, err);
    }
    if (!auth.isAuthenticated(a) || a.kind !== 'hub' || !isObj(a.envelope)) return json(res, { error: 'unauthenticated', reason: 'unauthenticated' }, 401);
    envelope = a.envelope;
  } else if (!auth.isAuthenticated(a)) {
    return json(res, { error: 'unauthenticated', reason: 'unauthenticated' }, 401);
  }
  const out = await runAction(envelope, a);
  return json(res, actionBody(out), out.status, retryHeaders(out));
}

const HASH_RE = /^[0-9a-f]{64}$/;
const MS_RE = /^\d{1,16}$/;

/** GET /api/v1/audit?since=<ms>&after=<hash>&limit=<1..1000> → {builder, head, entries, more, afterFound?}. */
export function getAudit(req, res) {
  const audit = services.audit;
  if (!audit) return json(res, { error: 'audit-unavailable' }, 503);
  const q = req.query ?? new URLSearchParams();
  const opts = {};
  const since = q.get('since');
  const after = q.get('after');
  const limit = q.get('limit');
  if (since !== null) {
    if (!MS_RE.test(since)) return json(res, { error: 'since must be a time in ms' }, 400);
    opts.since = Number(since);
  }
  if (after !== null) {
    if (!HASH_RE.test(after)) return json(res, { error: 'after must be an entry hash' }, 400);
    opts.after = after;
  }
  if (limit !== null) {
    if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000) return json(res, { error: 'limit must be 1..1000' }, 400);
    opts.limit = Number(limit);
  }
  const r = audit.read(opts);
  const body = { builder: config.fleet?.id ?? null, head: r.head, entries: r.entries, more: r.more };
  if (r.afterFound !== undefined) body.afterFound = r.afterFound;
  return json(res, body);
}

/** GET /api/v1/jobs/:id → {job, steps} (the v1 twin of /api/jobs/:job). */
export function getJob(req, res, db = services.deps.db) {
  const id = req.params?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) return json(res, { error: 'bad job id' }, 400);
  const steps = typeof db?.jobSteps === 'function' ? db.jobSteps(id) : [];
  if (!steps.length) return json(res, { error: 'no such job' }, 404);
  return json(res, { job: id, steps });
}

// ---------------------------------------------------------------------------------------------------------
// Upgrades: WS /api/v1/stream and WS /api/v1/term/:name

const TERM_PATH_RE = /^\/api\/v1\/term\/([^/]+)$/;
const STATUS_LINE = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

function writeStatus(socket, status) {
  try {
    socket.end(`HTTP/1.1 ${status} ${STATUS_LINE[status] ?? 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* gone */ }
  setTimeout(() => { try { socket.destroy(); } catch { /* gone */ } }, 1000).unref?.();
}

/** Only what the stream keeps for its log line: never a key, signature or envelope. */
function streamAuth(a) {
  return a ? { kind: a.kind, user: a.kind === 'hub' ? null : a.user, key: a.kind === 'hub' ? a.keyLabel ?? null : undefined } : null;
}

/**
 * The term "action" (§2 2.9): an audit-only entry written when a terminal
 * opens, rate-limited, tier click. From the hub the args and target are the
 * ones it signed (auth.guardUpgrade already bound them to the path and the
 * clamped query, and checked hubControl + scope `term`).
 * Returns {ok, status, auditId}.
 */
export function auditTerm(a, name, args) {
  const audit = services.audit;
  if (!audit) return { ok: false, status: 503 };
  const env = a.kind === 'hub' && isObj(a.envelope)
    ? a.envelope
    : { id: crypto.randomUUID(), user: a.user, builder: config.fleet?.id ?? null, action: 'term', target: name, args };
  let user = a.kind === 'hub' ? env.user : (typeof a.user === 'string' && a.user ? a.user : 'local');
  const rec = { id: env.id, user, via: VIA_OF_KIND[a.kind], builder: config.fleet?.id ?? null, action: 'term', target: name };
  let argsHash;
  try { argsHash = argsHashOf(env.args ?? {}); } catch { argsHash = argsHashOf({ unhashable: true }); }
  const append = (result) => audit.append({ ...rec, argsHash, result: a.kind === 'hub' && a.keyLabel ? { ...result, key: a.keyLabel } : result });
  const lim = services.limiter
    ? services.limiter.take(a.kind === 'hub' ? JSON.stringify(['hub-key', a.keyLabel ?? 'unknown-key', user]) : user, 'term', name, { kind: a.kind })
    : { ok: true };
  if (!lim.ok) {
    try { append({ ok: false, status: 429, code: 'rate_limited' }); } catch { /* logged below by the caller */ }
    return { ok: false, status: 429 };
  }
  try {
    const e = append({ ok: true, status: 101 });
    return { ok: true, status: 101, auditId: e?.hash ?? null };
  } catch (err) {
    log.error(`v1 term: audit append failed, terminal refused: ${String(err?.message ?? err).slice(0, 200)}`);
    return { ok: false, status: 503 };
  }
}

/**
 * The v1 upgrade handler (registered through the module's ctx.upgrade). The
 * request has already passed auth.guardUpgrade (boot/common.mjs handleUpgrade)
 * and req.auth is set. Returns true when it handled the request.
 */
export function upgradeV1(req, socket, head, url, { terminals = services.deps.terminals, st = services.deps.state ?? state } = {}) {
  const a = req.auth;
  if (url.pathname === '/api/v1/stream') {
    if (!auth.isAuthenticated(a) || (a.kind === 'hub' && a.signature !== 'read')) { writeStatus(socket, 401); return true; }
    stream.attachStream(req, socket, head, streamAuth(a));
    return true;
  }
  const m = TERM_PATH_RE.exec(url.pathname);
  if (!m) return false;
  if (!auth.isAuthenticated(a)) { writeStatus(socket, 401); return true; }
  let name;
  let args;
  if (a.kind === 'hub') {
    // the SIGNED values only (auth.termBinding), never re-parsed from the URL (SR3 L4)
    let b;
    try { b = auth.termBinding(a); } catch { writeStatus(socket, 401); return true; }
    name = b.name;
    args = {};
    for (const k of ['cols', 'rows', 'window']) if (b[k] !== undefined) args[k] = b[k];
  } else {
    try { name = decodeURIComponent(m[1]); } catch { writeStatus(socket, 400); return true; }
    try { args = auth.termArgsFromQuery(url.searchParams); } catch { writeStatus(socket, 400); return true; }
    if (args.cols === null || args.rows === null) { writeStatus(socket, 400); return true; }
  }
  if (args.window !== undefined && !auth.WINDOW_RE.test(args.window)) { writeStatus(socket, 400); return true; }
  if (!isSafeSessionName(name)) { writeStatus(socket, 400); return true; }
  if (!st?.get?.(name)) { writeStatus(socket, 404); return true; }
  if (typeof terminals?.attachNamed !== 'function') { writeStatus(socket, 503); return true; }
  const r = auditTerm(a, name, args);
  if (!r.ok) { writeStatus(socket, r.status); return true; }
  // attachNamed reads cols/rows/window from a URL: hand it one built from exactly the audited values
  const q = new URLSearchParams();
  for (const k of ['cols', 'rows', 'window']) if (args[k] !== undefined) q.set(k, String(args[k]));
  const bound = new URL(`/api/v1/term/${encodeURIComponent(name)}${q.size ? `?${q}` : ''}`, 'http://localhost');
  terminals.attachNamed(req, socket, head, name, bound);
  return true;
}

/** Register the audit-only `term` action, so hello.actions lists it (tier click); POSTing it is refused. */
export function registerTermAction() {
  if (has('term')) return;
  registerAction('term', {
    tier: 'click',
    target: 'session',
    args: {
      cols: { type: 'integer', min: auth.TERM_COLS[0], max: auth.TERM_COLS[1] },
      rows: { type: 'integer', min: auth.TERM_ROWS[0], max: auth.TERM_ROWS[1] },
      window: { type: 'string', re: auth.WINDOW_RE },
    },
    async run() {
      throw new ActionRefused(400, 'upgrade-only', 'a terminal is opened with WS /api/v1/term/:name');
    },
  });
}

/**
 * The v1 route table. Shape: `{method, path, name, tier, handler}` where
 * `handler(req, res, ctx)`. Reads are GET; the one mutation is
 * POST /api/v1/actions (through dispatch).
 */
export const ROUTES = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/v1/hello', name: 'hello', tier: 'read', handler: (req, res) => json(res, hello({ auth: req.auth })) }),
  Object.freeze({ method: 'GET', path: '/api/v1/snapshot', name: 'snapshot', tier: 'read', handler: (req, res) => json(res, snapshot()) }),
  Object.freeze({ method: 'GET', path: '/api/v1/audit', name: 'audit', tier: 'read', handler: (req, res) => getAudit(req, res) }),
  Object.freeze({ method: 'GET', path: '/api/v1/jobs/:id', name: 'jobs', tier: 'read', handler: (req, res, ctx) => getJob(req, res, services.deps.db ?? ctx?.db) }),
  Object.freeze({ method: 'POST', path: '/api/v1/actions', name: 'actions', tier: 'action', handler: (req, res) => postAction(req, res) }),
]);

/** Tests only. */
export function _reset() {
  capabilities.clear();
  helloFields.clear();
}
