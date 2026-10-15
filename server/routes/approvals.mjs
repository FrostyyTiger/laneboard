// Route module: the approval queue's HTTP side (fleet plan §8 2.2, task C4).
// REVIEW-REQUIRED (SR15).
//
//   POST /api/hook/permission   Claude Code's synchronous PermissionRequest
//                               curl hook. Held until a decision, the hold
//                               time, or the curl connection closing.
//   GET  /api/v1/approvals      the pending approvals (a v1 read).
//
// Fail-open contract: the hook is `curl -sf ... || true`, so every non-2xx
// status and every empty 200 means "no decision" and Claude Code shows its
// normal dialog in the pane. This route therefore answers every refusal and
// error with an EMPTY body (403/400/413/429/503), and a decision with 200 +
// approvals.hookOutput() (which is '' for release and timeout).
//
// The intake is accepted only when ALL of these hold (anything else → 403,
// empty body, nothing opened):
//   - req.auth, when §2's classifier has set it, has kind 'local';
//   - the request did not arrive on fleet.ingressPort (tailscale serve's target);
//   - the peer address is loopback;
//   - no tailscale serve / proxy header at all (Tailscale-User-*,
//     X-Forwarded-*, Forwarded), checked in req.headers AND req.rawHeaders so
//     a classifier that strips them from req.headers cannot hide them;
//   - no Origin header (a hook is never a browser);
//   - X-Laneboard-Hook equals the 0600 token in <stateDir>/hook.token
//     (server/control/token.mjs), compared in constant time.
// Host/Origin are also checked earlier by server/security.mjs (F5); the CSRF
// header is exempt for this path (HOOK_PATHS) because curl cannot send it.
//
// Decisions never come in here: they are the remote-only approve/deny/release
// actions (C6), refused for kind 'local', so an agent cannot approve itself
// through this API.
import { config as liveConfig } from '../config.mjs';
import { log as liveLog } from '../log.mjs';
import { readBody } from '../http.mjs';
import { securityHeaders, warnRateLimited } from '../security.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import * as hooks from '../collector/hooks.mjs';
import * as approvalsCore from '../control/approvals.mjs';
import * as tokens from '../control/token.mjs';

export const INTAKE_PATH = '/api/hook/permission';
export const LIST_PATH = '/api/v1/approvals';
export const BODY_LIMIT = 4 * 1024 * 1024;
/** Extra time after the hold before the route gives up on its own. */
export const BACKSTOP_MS = 5000;
/** Hook events after which a held request for the same Claude session was answered elsewhere. */
export const SUPERSEDE_EVENTS = Object.freeze(['PostToolUse', 'Stop', 'SessionEnd', 'UserPromptSubmit']);

/**
 * Headers that `tailscale serve` (or any proxy) adds. Their presence means
 * the request did not come straight from the local hook.
 */
const PROXY_HEADER_RE = /^(tailscale-|x-forwarded-|forwarded$|x-real-ip$)/i;

const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

/** 127.0.0.0/8, ::1 and the v4-mapped 127/8. */
export function isLoopbackAddress(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  const a = addr.toLowerCase();
  if (a === '::1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  return Boolean(m) && m.slice(1).every((x) => Number(x) <= 255);
}

function hasProxyHeader(req) {
  for (const k of Object.keys(req.headers ?? {})) if (PROXY_HEADER_RE.test(k)) return true;
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let i = 0; i < raw.length; i += 2) if (PROXY_HEADER_RE.test(String(raw[i]))) return true;
  return Boolean(req.tsUser);
}

function originPresent(req) {
  if (req.headers?.origin !== undefined) return true;
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let i = 0; i < raw.length; i += 2) if (String(raw[i]).toLowerCase() === 'origin') return true;
  return false;
}

/** The raw X-Laneboard-Hook values (a repeated header must not be merged into a match). */
function hookHeaderValues(req) {
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  const out = [];
  for (let i = 0; i < raw.length; i += 2) if (String(raw[i]).toLowerCase() === tokens.HEADER_NAME) out.push(raw[i + 1]);
  if (!raw.length && req.headers?.[tokens.HEADER_NAME] !== undefined) out.push(req.headers[tokens.HEADER_NAME]);
  return out;
}

/**
 * Why a hook intake request is refused, or null when it is accepted.
 * `token` is the expected token (null = not available → always refused).
 * Pure apart from reading `req`; exported for tests.
 */
export function refuseReason(req, { config = {}, token = null, reload = null } = {}) {
  if (req.auth !== undefined && req.auth !== null) {
    if (typeof req.auth !== 'object' || req.auth.kind !== 'local') return 'not-local';
  }
  const ingress = config?.fleet?.ingressPort;
  if (isPort(ingress) && req.socket?.localPort === ingress) return 'ingress';
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return 'not-loopback';
  if (hasProxyHeader(req)) return 'serve-header';
  if (originPresent(req)) return 'origin';
  const values = hookHeaderValues(req);
  if (values.length !== 1) return 'token';
  if (tokens.tokenMatches(values[0], token)) return null;
  // The installer may have re-created the files while we run: re-read once.
  const fresh = typeof reload === 'function' ? reload() : null;
  if (fresh && fresh !== token && tokens.tokenMatches(values[0], fresh)) return null;
  return 'token';
}

function empty(res, status) {
  if (res.headersSent || res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-length': 0, 'cache-control': 'no-store', ...securityHeaders(null) });
  res.end();
}

function reply(res, body) {
  if (res.headersSent || res.destroyed || res.writableEnded) return;
  const buf = Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    ...securityHeaders(null),
  });
  res.end(buf);
}

/**
 * Build the two handlers. Every dependency is injectable for tests:
 *   config()        the merged config (default: the live one)
 *   token()         the expected token or null; reloadToken() re-reads the file
 *   state           {sessionNameBySessionId(id), get(name)} for session/lane names
 *   approvals       the queue (default server/control/approvals.mjs)
 *   holdMs()        override of approvals.holdSec * 1000 (tests)
 *   log
 */
export function createHandlers(deps = {}) {
  const cfg = deps.config ?? (() => liveConfig);
  const api = deps.approvals ?? approvalsCore;
  const log = deps.log ?? liveLog;
  const getToken = deps.token ?? (() => null);
  const reloadToken = deps.reloadToken ?? null;
  const st = deps.state ?? null;

  const nameOf = (sid) => (st?.sessionNameBySessionId ? st.sessionNameBySessionId(sid) : null);
  const laneOf = (name) => (st?.get ? st.get(name)?.lane ?? null : null);

  function holdMsOf(c) {
    if (typeof deps.holdMs === 'function') return deps.holdMs();
    const s = c?.approvals?.holdSec;
    return (Number.isFinite(s) ? s : 600) * 1000;
  }

  function refused(req, res, reason) {
    warnRateLimited((r, detail) => log.warn(`refused hook permission request (${r})`, detail), `hook-permission-${reason}`,
      `peer=${JSON.stringify(String(req.socket?.remoteAddress ?? '').slice(0, 64))}`);
    // Drain nothing: answer and let node discard the body.
    empty(res, 403);
  }

  async function intake(req, res) {
    const c = cfg();
    const reason = refuseReason(req, { config: c, token: getToken(), reload: reloadToken });
    if (reason) return refused(req, res, reason);
    if (c?.approvals?.enabled === false) return empty(res, 200);

    let body;
    try {
      const buf = await readBody(req, BODY_LIMIT);
      body = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      return empty(res, /too large/.test(String(err?.message)) ? 413 : 400);
    }

    const holdMs = holdMsOf(c);
    let opened;
    try {
      opened = api.open(body, {
        timeoutMs: holdMs,
        onTimeout: c?.approvals?.onTimeout,
        previewMaxLines: c?.approvals?.previewMaxLines,
        builder: c?.fleet?.id ?? null,
        nameOf,
        laneOf,
      });
    } catch (err) {
      const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status === 500) log.error('hook permission open failed', String(err?.message || err));
      return empty(res, status);
    }

    const id = opened.approval.id;
    let done = false;
    let backstop = null;
    const finish = () => {
      done = true;
      if (backstop) clearTimeout(backstop);
      res.off('close', onClose);
    };
    // The curl connection went away before a decision: Claude Code cancelled
    // the hook, or the human answered at the terminal.
    function onClose() {
      if (done) return;
      finish();
      api.abandon(id, 'hook connection closed');
    }
    res.on('close', onClose);
    if (res.destroyed || req.socket?.destroyed) return onClose();
    backstop = setTimeout(() => {
      if (done) return;
      finish();
      api.abandon(id, 'hold expired');
      empty(res, 200);
    }, holdMs + BACKSTOP_MS);
    backstop.unref?.();

    const decision = await opened.wait;
    if (done) return;
    finish();
    reply(res, decision ? (decision.output ?? api.hookOutput(decision)) : '');
  }

  function list(req, res, json) {
    const c = cfg();
    json(res, { builder: { id: c?.fleet?.id ?? null, code: c?.fleet?.code ?? null }, approvals: api.pending() });
  }

  return { intake, list };
}

let unsubs = [];
let currentToken = null;

function stateDirOf(c) {
  return c?.stateDir;
}

export default {
  name: 'approvals',
  modes: ['builder'],
  register(ctx) {
    const c = ctx.config ?? liveConfig;
    const handlers = createHandlers({
      config: () => ctx.config ?? liveConfig,
      token: () => currentToken,
      reloadToken: () => {
        try { return tokens.readToken(stateDirOf(ctx.config ?? liveConfig)); } catch { return null; }
      },
      state: ctx.state,
      log: ctx.log,
    });
    ctx.route('POST', INTAKE_PATH, (req, res) => handlers.intake(req, res));
    ctx.route('GET', LIST_PATH, (req, res) => handlers.list(req, res, ctx.json));
    if (c?.approvals?.enabled !== false) addCapability('approvals');
  },
  start(ctx) {
    const log = ctx.log ?? liveLog;
    const c = ctx.config ?? liveConfig;
    try {
      currentToken = tokens.ensureToken(stateDirOf(c)).token;
    } catch (err) {
      // No token → every intake is refused → every hook falls through to the dialog.
      currentToken = null;
      log.warn(`hook token unavailable, approvals fall through to the terminal: ${err?.message || err}`);
    }
    for (const u of unsubs) u();
    unsubs = [
      hooks.subscribe((body, info) => {
        const ev = body?.hook_event_name;
        if (!SUPERSEDE_EVENTS.includes(ev)) return;
        const sid = info?.sessionId ?? body?.session_id;
        if (typeof sid === 'string' && sid) approvalsCore.supersede(sid, `${ev} seen`);
      }),
      approvalsCore.onChange((msg) => {
        try { ctx.ws?.send?.({ type: 'approval', op: msg.op, approval: msg.approval }); } catch { /* best effort */ }
      }),
    ];
  },
  stop() {
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    unsubs = [];
    currentToken = null;
  },
};
