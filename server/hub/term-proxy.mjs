// The hub's terminal proxy: WS /ws/term/:builder/:name <-> builder WS /api/v1/term/:name
// (fleet plan §3 2.12, README §3, SECURITY-FIXES S4/S5). REVIEW-REQUIRED (SR12).
//
//   const tp = createTermProxy({store, key, keyId?, cfg, audit, now?, log?});
//   upgradeHandler: if (tp.attach(req, socket, head, url)) return;   // true = this path is ours
//   tp.live(builderId) -> number of proxied terms (pending included); tp.close() closes them all (1001).
//
// Order of an attach (any refusal answers `HTTP/1.1 <status>` on the raw socket and destroys it):
//   1. Path: exactly /ws/term/<builder>/<name> parsed from the RAW req.url (no URL normalization, so
//      dot segments cannot move the target). <builder> must be a fleet-store id (Map lookup); <name> is
//      percent-decoded once and must be a safe session name; '.', '..' and anything with '/' or '\' are
//      refused (404).
//   2. Auth (auth.mjs guardUpgrade: Host, classification by the hub's ingress listener, Origin required for
//      `direct`, read-only users refused). Only kind `direct` may open a terminal: `local` (the loopback
//      listener on the hub box) gets 403 remote-only; `hub` kind is refused by classify on a hub.
//   3. The builder must `controls` (up, no major version skew), else 503; and live + pending terms for that
//      builder must be below fleet.maxTermsPerBuilder (default 8), else 503.
//   4. The upstream socket is opened FIRST, to {builder url}/api/v1/term/<encoded name>?cols&rows[&window],
//      with a signed `term` envelope in headers (termHeaders: X-Laneboard-Envelope/-Sig/-Key). Never a read
//      signature, never query-param signatures, never an Origin. `args` are exactly the clamped query the
//      builder will re-derive (termArgsFromQuery), so the builder's binding check matches.
//      Builder 404 -> browser 404; 401/403 -> 403; anything else (refused, timeout, 5xx) -> 502/503.
//   5. term-attach is audited (fails closed: no audit line, no terminal), then the browser is upgraded.
// Piping: frames are not interpreted, `isBinary` is preserved, a browser frame is capped at 64 KiB (ws
// maxPayload -> 1009). Upstream frames that arrive before the browser socket exists are buffered (64 KiB,
// then 1013). Backpressure: a receiver's bufferedAmount > 1 MiB pauses the sender's TCP socket; a 50 ms
// timer resumes it below 256 KiB. Close codes propagate when sendable, else 1000 (normal) / 1011.
// A builder going `down` (store conn event) closes its proxied terms with 4001 "builder down".
// term-detach is audited with {bytesIn, bytesOut, code, durationMs} inside `result`. Keystrokes are never
// logged; nothing here logs keys, signatures or envelopes.
import crypto from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

import { AuthError, guardUpgrade, termArgsFromQuery, termHeaders, WINDOW_RE, BUILDER_ID_RE, ENVELOPE_USER_RE } from '../fleet/auth.mjs';
import { isSafeName } from './fleet-store.mjs';
import { log as defaultLog } from '../log.mjs';

export const LIMITS = Object.freeze({
  browserFrameBytes: 64 * 1024,
  upstreamFrameBytes: 1024 * 1024,
  pendingBytes: 64 * 1024,
  highWater: 1024 * 1024,
  lowWater: 256 * 1024,
  drainCheckMs: 50,
  handshakeMs: 10_000,
  maxTermsPerBuilder: 8,
});

export const BUILDER_DOWN_CODE = 4001;
const PATH_PREFIX = '/ws/term/';
const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const REASON_RX = /^[\x20-\x7e]{0,120}$/;

/** True when `code` may be sent in a close frame (RFC 6455 + ws). */
export function sendableCode(code) {
  return Number.isInteger(code) && ((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999));
}

/** The code to forward for a close received with `code`: itself if sendable, 1000 for "no status", else 1011. */
export function forwardCode(code) {
  if (sendableCode(code)) return code;
  return code === 1005 ? 1000 : 1011;
}

function cleanReason(reason) {
  const s = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason ?? '');
  return REASON_RX.test(s) ? s : '';
}

/**
 * Parse /ws/term/<builder>/<name> from a raw request target. Returns {builder, name, search} or null when
 * the path is not ours, {error: 404} when it is ours but malformed or unsafe.
 */
export function parseTermPath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith(PATH_PREFIX)) return null;
  const q = rawUrl.indexOf('?');
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  const search = q === -1 ? '' : rawUrl.slice(q);
  const parts = rawPath.slice(PATH_PREFIX.length).split('/');
  if (parts.length !== 2) return { error: 404 };
  const [b, n] = parts;
  if (!BUILDER_ID_RE.test(b)) return { error: 404 };
  let name;
  try { name = decodeURIComponent(n); } catch { return { error: 404 }; }
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || !isSafeName(name)) return { error: 404 };
  return { builder: b, name, search };
}

/** Clamped `term` args from the browser's query: {cols?, rows?, window?}; invalid values are dropped. */
export function termArgs(search) {
  const raw = termArgsFromQuery(new URLSearchParams(search ?? ''));
  const out = {};
  if (Number.isInteger(raw.cols)) out.cols = raw.cols;
  if (Number.isInteger(raw.rows)) out.rows = raw.rows;
  if (typeof raw.window === 'string' && WINDOW_RE.test(raw.window)) out.window = raw.window;
  return out;
}

/** ws(s)://.../api/v1/term/<name>?<args> for a builder base url (http -> ws, https -> wss). */
export function upstreamUrl(base, name, args) {
  const u = new URL(base);
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:') u.protocol = 'ws:';
  else throw new TypeError('term-proxy: builder url must be http(s)');
  const prefix = u.pathname.replace(/\/+$/, '');
  u.pathname = `${prefix}/api/v1/term/${encodeURIComponent(name)}`;
  const qs = new URLSearchParams();
  for (const k of ['cols', 'rows', 'window']) if (args[k] !== undefined) qs.set(k, String(args[k]));
  u.search = qs.toString();
  u.hash = '';
  return u.toString();
}

function refuseSocket(socket, status) {
  const s = STATUS_TEXT[status] ? status : 403;
  try {
    socket.once?.('finish', () => socket.destroy());
    setTimeout(() => socket.destroy?.(), 1000).unref?.();
    socket.end(`HTTP/1.1 ${s} ${STATUS_TEXT[s]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    try { socket.destroy?.(); } catch { /* gone */ }
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byteLen = (d) => (Buffer.isBuffer(d) ? d.length : Array.isArray(d) ? d.reduce((n, b) => n + b.length, 0) : d?.byteLength ?? 0);

/**
 * createTermProxy({store, key, keyId?, cfg, audit, now?, log?, limits?})
 *   store  the hub fleet store (H3); `key` the hub's Ed25519 private KeyObject; cfg the merged hub config
 *   (mode 'hub', fleet.ingressPort, fleet.maxTermsPerBuilder...); audit an openAudit() instance.
 */
export function createTermProxy({ store, key, keyId, cfg = {}, audit = null, now = Date.now, log = defaultLog, limits = {}, authOpts = {} } = {}) {
  if (!store || typeof store.builder !== 'function') throw new TypeError('term-proxy: store is required');
  if (!key) throw new TypeError('term-proxy: key is required');
  const L = { ...LIMITS, ...limits };
  const f = isObj(cfg.fleet) ? cfg.fleet : {};
  const maxTerms = Number.isInteger(f.maxTermsPerBuilder) && f.maxTermsPerBuilder > 0 ? f.maxTermsPerBuilder : L.maxTermsPerBuilder;
  const downMs = Number.isInteger(f.downMs) && f.downMs > 0 ? f.downMs : null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: L.browserFrameBytes, perMessageDeflate: false });
  /** builderId -> Set<term> (pending and open). */
  const byBuilder = new Map();
  let closed = false;
  const stats = { pauses: 0 };

  const warn = (msg) => { try { (log?.warn ?? log?.info ?? (() => {}))(msg); } catch { /* never fail on logging */ } };

  function setOf(id) {
    let s = byBuilder.get(id);
    if (!s) { s = new Set(); byBuilder.set(id, s); }
    return s;
  }
  function live(id) { return byBuilder.get(id)?.size ?? 0; }

  function writeAudit(entry) {
    if (!audit || typeof audit.append !== 'function') return true;
    try { audit.append(entry); return true; } catch (err) {
      warn(`term-proxy: audit append failed (${err?.code ?? 'error'})`);
      return false;
    }
  }

  function controls(id) {
    const v = store.view(now()).builders.find((b) => b.id === id);
    return v ? v.controls === true : false;
  }

  function isDown(entry) {
    if (!entry) return true;
    if (entry.conn?.state === 'down') return true;
    const seen = entry.conn?.lastSeen;
    return downMs !== null && Number.isFinite(seen) && now() - seen >= downMs;
  }

  const unsubscribe = typeof store.subscribe === 'function' ? store.subscribe((ev) => {
    if (ev?.kind !== 'conn') return;
    const set = byBuilder.get(ev.builder);
    if (!set || set.size === 0) return;
    if (!isDown(store.builder(ev.builder))) return;
    for (const t of [...set]) t.shut(BUILDER_DOWN_CODE, 'builder down');
  }) : () => {};

  /**
   * Handle an upgrade. Returns false when the path is not /ws/term/..., else true (the socket is then
   * answered: refused, or upgraded once the builder accepted).
   */
  function attach(req, socket, head, _url) {
    const parsed = parseTermPath(typeof req?.url === 'string' ? req.url : '');
    if (parsed === null) return false;
    if (closed) { refuseSocket(socket, 503); return true; }
    if (parsed.error) { refuseSocket(socket, parsed.error); return true; }

    let auth;
    try {
      auth = guardUpgrade(req, req.url, cfg, authOpts);
    } catch (err) {
      refuseSocket(socket, err instanceof AuthError ? err.status : 403);
      return true;
    }
    if (auth?.kind !== 'direct') { refuseSocket(socket, 403); return true; } // remote-only
    const user = auth.user;
    if (typeof user !== 'string' || !ENVELOPE_USER_RE.test(user)) { refuseSocket(socket, 403); return true; }

    const { builder: id, name } = parsed;
    const entry = store.builder(id);
    if (!entry || typeof entry.url !== 'string') { refuseSocket(socket, 404); return true; }
    if (!controls(id)) { refuseSocket(socket, 503); return true; }
    const set = setOf(id);
    if (set.size >= maxTerms) { refuseSocket(socket, 503); return true; }

    const args = termArgs(parsed.search);
    let target;
    try { target = upstreamUrl(entry.url, name, args); } catch { refuseSocket(socket, 503); return true; }
    const env = { v: 1, id: crypto.randomUUID(), ts: now(), builder: id, action: 'term', target: name, args, user, via: 'hub' };
    let headers;
    try { headers = termHeaders(env, key, keyId); } catch { refuseSocket(socket, 500); return true; }

    const t = {
      id, name, user, env, up: null, browser: null, state: 'pending', bytesIn: 0, bytesOut: 0,
      startedAt: now(), pendingUp: [], pendingBytes: 0, timers: new Map(), shut: null, detached: false,
    };
    set.add(t);

    const release = () => {
      set.delete(t);
      if (set.size === 0) byBuilder.delete(id);
      // A paused socket must be resumed, or its close handshake would hang until ws's close timeout.
      for (const [tm, sock] of t.timers) {
        clearInterval(tm);
        try { sock.resume(); } catch { /* ignore */ }
      }
      t.timers.clear();
    };

    const detach = (code) => {
      if (t.detached) return;
      t.detached = true;
      release();
      if (t.state !== 'open') return;
      writeAudit({
        user, via: 'direct', builder: id, action: 'term-detach', target: name, args,
        result: { ok: true, bytesIn: t.bytesIn, bytesOut: t.bytesOut, code: Number.isInteger(code) ? code : null, durationMs: Math.max(0, now() - t.startedAt) },
      });
    };

    // Before the browser is upgraded, a "close" means: refuse the raw socket.
    const onSocketGone = () => {
      if (t.state !== 'pending') return;
      t.state = 'gone';
      try { t.up?.terminate(); } catch { /* ignore */ }
      detach(null);
    };
    socket.on('close', onSocketGone);
    socket.on('error', onSocketGone);

    t.shut = (code, reason) => {
      if (t.state === 'pending') {
        t.state = 'gone';
        try { t.up?.terminate(); } catch { /* ignore */ }
        refuseSocket(socket, 503);
        detach(null);
        return;
      }
      if (t.state !== 'open') return;
      try { t.browser.close(code, reason); } catch { try { t.browser.terminate(); } catch { /* ignore */ } }
      try { t.up.close(code, reason); } catch { try { t.up.terminate(); } catch { /* ignore */ } }
    };

    let up;
    try {
      up = new WebSocket(target, {
        headers,
        handshakeTimeout: L.handshakeMs,
        maxPayload: L.upstreamFrameBytes,
        perMessageDeflate: false,
        followRedirects: false,
      });
    } catch {
      release();
      refuseSocket(socket, 503);
      return true;
    }
    t.up = up;

    const failPending = (status) => {
      if (t.state !== 'pending') return;
      t.state = 'gone';
      socket.off('close', onSocketGone);
      socket.off('error', onSocketGone);
      try { up.terminate(); } catch { /* ignore */ }
      detach(null);
      refuseSocket(socket, status);
    };

    up.on('unexpected-response', (_r, res) => {
      const s = res?.statusCode;
      if (s === 401 || s === 403) {
        writeAudit({ id: env.id, user, via: 'direct', builder: id, action: 'term-attach', target: name, args, result: { ok: false, status: s } });
      }
      try { res.resume(); } catch { /* ignore */ }
      failPending(s === 404 ? 404 : s === 401 || s === 403 ? 403 : 502);
    });

    // Upstream frames before the browser exists are buffered (bounded).
    up.on('message', (data, isBinary) => {
      if (t.state === 'pending' || t.state === 'upgrading') {
        t.pendingBytes += byteLen(data);
        if (t.pendingBytes > L.pendingBytes) {
          if (t.state === 'pending') failPending(503);
          else { t.overflow = true; try { up.terminate(); } catch { /* ignore */ } }
          return;
        }
        t.pendingUp.push([data, isBinary]);
        return;
      }
      if (t.state !== 'open') return;
      t.bytesOut += byteLen(data);
      const b = t.browser;
      if (b.readyState !== WebSocket.OPEN) return;
      b.send(data, { binary: isBinary });
      backpressure(b, up);
    });

    up.on('error', () => {
      if (t.state === 'pending') { failPending(503); return; }
      if (t.state === 'open') { try { t.browser.terminate(); } catch { /* ignore */ } }
    });

    up.on('close', (code, reason) => {
      if (t.state === 'pending') { failPending(503); return; }
      if (t.state !== 'open') return;
      const b = t.browser;
      if (b.readyState === WebSocket.OPEN) {
        try { b.close(forwardCode(code), cleanReason(reason)); } catch { b.terminate(); }
      }
      detach(code);
    });

    up.on('open', () => {
      if (t.state !== 'pending') { try { up.terminate(); } catch { /* ignore */ } return; }
      // Fail closed: a terminal without its audit line is never opened.
      if (!writeAudit({ id: env.id, user, via: 'direct', builder: id, action: 'term-attach', target: name, args, result: { ok: true } })) {
        failPending(503);
        return;
      }
      socket.off('close', onSocketGone);
      socket.off('error', onSocketGone);
      if (socket.destroyed) { t.state = 'gone'; try { up.terminate(); } catch { /* ignore */ } detach(null); return; }
      t.state = 'upgrading';
      try {
        wss.handleUpgrade(req, socket, head, (ws) => onBrowser(ws));
      } catch {
        t.state = 'gone';
        try { up.terminate(); } catch { /* ignore */ }
        detach(null);
        refuseSocket(socket, 500);
      }
    });

    function onBrowser(b) {
      t.browser = b;
      t.state = 'open';
      t.startedAt = now();
      for (const [data, isBinary] of t.pendingUp) {
        t.bytesOut += byteLen(data);
        b.send(data, { binary: isBinary });
      }
      t.pendingUp = [];
      t.pendingBytes = 0;
      if (up.readyState !== WebSocket.OPEN) {
        // The builder went away (or overflowed the pre-open buffer) during the upgrade.
        try { b.close(t.overflow ? 1013 : 1011, ''); } catch { b.terminate(); }
        detach(null);
        return;
      }
      b.on('message', (data, isBinary) => {
        t.bytesIn += byteLen(data);
        if (up.readyState !== WebSocket.OPEN) return;
        up.send(data, { binary: isBinary });
        backpressure(up, b);
      });
      b.on('error', () => {
        try { up.terminate(); } catch { /* ignore */ }
        try { b.terminate(); } catch { /* ignore */ }
      });
      b.on('close', (code, reason) => {
        if (up.readyState === WebSocket.OPEN) {
          try { up.close(forwardCode(code), cleanReason(reason)); } catch { up.terminate(); }
        } else if (up.readyState === WebSocket.CONNECTING) {
          up.terminate();
        }
        detach(code);
      });
    }

    /** `receiver` is buffering too much: pause the TCP socket we read `sender`'s frames from. */
    function backpressure(receiver, sender) {
      if (receiver.bufferedAmount <= L.highWater) return;
      const sock = sender._socket;
      if (!sock || sock.isPaused?.()) return;
      sock.pause();
      const tm = setInterval(() => {
        if (receiver.readyState !== WebSocket.OPEN || receiver.bufferedAmount < L.lowWater) {
          clearInterval(tm);
          t.timers.delete(tm);
          try { sock.resume(); } catch { /* ignore */ }
        }
      }, L.drainCheckMs);
      tm.unref?.();
      t.timers.set(tm, sock);
      stats.pauses++;
    }

    return true;
  }

  function close() {
    closed = true;
    unsubscribe();
    for (const set of [...byBuilder.values()]) for (const t of [...set]) t.shut(1001, 'hub shutting down');
  }

  return { attach, live, close, stats: () => ({ ...stats }), limits: Object.freeze({ ...L, maxTermsPerBuilder: maxTerms }) };
}

const instances = new WeakMap();

/**
 * attach(req, socket, head, url, {store, key, keyId?, cfg, audit}) -> bool: the §3 2.12 signature; keeps one
 * proxy per store (so counts and the down-listener are shared).
 */
export function attach(req, socket, head, url, deps = {}) {
  let tp = instances.get(deps.store);
  if (!tp) {
    tp = createTermProxy(deps);
    instances.set(deps.store, tp);
  }
  return tp.attach(req, socket, head, url);
}

export default createTermProxy;
