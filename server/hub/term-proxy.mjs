// The hub's terminal proxy: WS /ws/term/:builder/:name <-> builder WS /api/v1/term/:name
// (fleet plan §3 2.12, README §3, SECURITY-FIXES S4/S5). REVIEW-REQUIRED (SR12).
//
//   const tp = createTermProxy({store, key, keyId?, cfg, audit, now?, log?});
//   upgradeHandler: if (tp.attach(req, socket, head, url)) return;   // true = this path is ours
//   tp.live(builderId) -> number of proxied terms (pending included); tp.close() closes them all (1001).
//
// Order of an attach (any refusal answers `HTTP/1.1 <status>` on the raw socket and destroys it; an
// 'error' listener is set on the socket first, so a client RST during a refusal is not an uncaught error):
//   0. The browser handshake is validated BEFORE anything else (SR12 M1): GET, Upgrade: websocket,
//      Sec-WebSocket-Key /^[+/0-9A-Za-z]{22}==$/, Sec-WebSocket-Version 13, no Sec-WebSocket-Protocol
//      (the UI sends none) -> else 400/405, so ws.handleUpgrade cannot fail after the upstream opened.
//      In hub mode a terminal also needs fleet.ingressPeerUid (SR12 M3; the config refuses a Linux hub
//      without it, and elsewhere the check cannot run) -> else 403, logged once.
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
//   5. term-attach is audited (fails closed: no audit line, no terminal; `audit` is required), then the
//      browser is upgraded. If that upgrade still fails (the socket went away, ws aborted) or has not
//      completed within limits.upgradeMs, the upstream is terminated, the slot freed and term-detach
//      written. Every attach audited ok gets exactly one term-detach carrying the same `id` (SR12 L4).
// Piping: frames are not interpreted, `isBinary` is preserved, a browser frame is capped at 64 KiB (ws
// maxPayload -> 1009). Upstream frames that arrive before the browser socket exists are buffered (64 KiB,
// then 1013). Backpressure: a receiver's bufferedAmount > 1 MiB pauses the sender's TCP socket; a 50 ms
// timer resumes it below 256 KiB. Close codes propagate when sendable, else 1000 (normal) / 1011.
// Control frames (SR12 M2): both sockets run with autoPong off; a ping is answered at most once per
// limits.pongMinMs and only while that socket's queue is below lowWater, else dropped. Whatever the cause,
// a socket whose queued bytes (bufferedAmount) exceed limits.maxQueuedBytes (4 MiB) is terminated and the
// other side is closed with 1008. Liveness (SR12 L2): every limits.pingMs both sides are pinged; a side
// that sent nothing (no pong, no frame) for 2 intervals while we were reading it is terminated.
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
  maxQueuedBytes: 4 * 1024 * 1024,
  drainCheckMs: 50,
  handshakeMs: 10_000,
  upgradeMs: 1000,
  pingMs: 30_000,
  pongMinMs: 1000,
  maxTermsPerBuilder: 8,
});

export const BUILDER_DOWN_CODE = 4001;
export const OVERFLOW_CODE = 1008;
const PATH_PREFIX = '/ws/term/';
const STATUS_TEXT = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const REASON_RX = /^[\x20-\x7e]{0,120}$/;
const WS_KEY_RX = /^[+/0-9A-Za-z]{22}==$/;
const noop = () => {};

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
 * null when `req` is a WebSocket handshake ws.handleUpgrade will accept (with perMessageDeflate off and no
 * subprotocols), else the HTTP status to refuse it with (SR12 M1).
 */
export function handshakeProblem(req) {
  const h = req?.headers ?? {};
  if (req?.method !== 'GET') return 405;
  if (typeof h.upgrade !== 'string' || h.upgrade.toLowerCase() !== 'websocket') return 400;
  if (typeof h['sec-websocket-key'] !== 'string' || !WS_KEY_RX.test(h['sec-websocket-key'])) return 400;
  if (h['sec-websocket-version'] !== '13') return 400;
  if (h['sec-websocket-protocol'] !== undefined) return 400;
  return null;
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
    socket.on?.('error', noop);
    socket.once?.('finish', () => socket.destroy());
    setTimeout(() => socket.destroy?.(), 1000).unref?.();
    socket.end(`HTTP/1.1 ${s} ${STATUS_TEXT[s]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    try { socket.destroy?.(); } catch { /* gone */ }
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byteLen = (d) => (Buffer.isBuffer(d) ? d.length : Array.isArray(d) ? d.reduce((n, b) => n + b.length, 0) : d?.byteLength ?? 0);
const mono = () => performance.now();

/**
 * createTermProxy({store, key, keyId?, cfg, audit, now?, log?, limits?, authOpts?})
 *   store  the hub fleet store (H3); `key` the hub's Ed25519 private KeyObject; cfg the merged hub config
 *   (mode 'hub', fleet.ingressPort, fleet.ingressPeerUid, fleet.maxTermsPerBuilder...); audit an openAudit()
 *   instance (required: a terminal is never opened unaudited). `wss` is a test seam (a WebSocketServer).
 */
export function createTermProxy({ store, key, keyId, cfg = {}, audit = null, now = Date.now, log = defaultLog, limits = {}, authOpts = {}, wss: wssOpt = null } = {}) {
  if (!store || typeof store.builder !== 'function') throw new TypeError('term-proxy: store is required');
  if (!key) throw new TypeError('term-proxy: key is required');
  if (!audit || typeof audit.append !== 'function') throw new TypeError('term-proxy: audit is required');
  const L = { ...LIMITS, ...limits };
  const f = isObj(cfg.fleet) ? cfg.fleet : {};
  const maxTerms = Number.isInteger(f.maxTermsPerBuilder) && f.maxTermsPerBuilder > 0 ? f.maxTermsPerBuilder : L.maxTermsPerBuilder;
  const downMs = Number.isInteger(f.downMs) && f.downMs > 0 ? f.downMs : null;
  const wss = wssOpt ?? new WebSocketServer({ noServer: true, maxPayload: L.browserFrameBytes, perMessageDeflate: false, autoPong: false });
  /** builderId -> Set<term> (pending and open). */
  const byBuilder = new Map();
  let closed = false;
  const stats = { pauses: 0, droppedPongs: 0, overflows: 0, deadPeers: 0, upgradeFailures: 0 };
  const warned = new Set();

  const warn = (msg) => { try { (log?.warn ?? log?.info ?? (() => {}))(msg); } catch { /* never fail on logging */ } };
  const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); warn(msg); } };

  function setOf(id) {
    let s = byBuilder.get(id);
    if (!s) { s = new Set(); byBuilder.set(id, s); }
    return s;
  }
  function live(id) { return byBuilder.get(id)?.size ?? 0; }

  function writeAudit(entry) {
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
    // SR12 L3: a client RST while we answer must not become an uncaught 'error'.
    try { socket.on('error', noop); } catch { /* not an emitter */ }
    if (closed) { refuseSocket(socket, 503); return true; }
    if (parsed.error) { refuseSocket(socket, parsed.error); return true; }
    const hs = handshakeProblem(req);
    if (hs !== null) { refuseSocket(socket, hs); return true; }
    // SR12 M3: without the peer-uid check any local process on the hub can forge serve headers.
    if (cfg.mode === 'hub' && !Number.isInteger(f.ingressPeerUid)) {
      warnOnce('peer-uid', 'term-proxy: refusing terminals: fleet.ingressPeerUid is not set on this hub (set it to the uid tailscaled runs as)');
      refuseSocket(socket, 403);
      return true;
    }

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

    // state: pending (upstream connecting) -> upgrading (browser handshake) -> open; any -> gone.
    const t = {
      id, name, user, env, up: null, browser: null, state: 'pending', bytesIn: 0, bytesOut: 0,
      startedAt: now(), pendingUp: [], pendingBytes: 0, timers: new Map(), shut: null, detached: false,
      attached: false, upgradeTimer: null, liveTimer: null,
      sides: { up: { lastPong: -Infinity, lastSeen: 0 }, browser: { lastPong: -Infinity, lastSeen: 0 } },
    };
    set.add(t);

    const release = () => {
      set.delete(t);
      if (set.size === 0 && byBuilder.get(id) === set) byBuilder.delete(id);
      // A paused socket must be resumed, or its close handshake would hang until ws's close timeout.
      for (const [tm, sock] of t.timers) {
        clearInterval(tm);
        try { sock.resume(); } catch { /* ignore */ }
      }
      t.timers.clear();
      if (t.upgradeTimer) { clearTimeout(t.upgradeTimer); t.upgradeTimer = null; }
      if (t.liveTimer) { clearInterval(t.liveTimer); t.liveTimer = null; }
    };

    /** Free the slot; every attach that was audited ok gets exactly one term-detach (same id). */
    const detach = (code) => {
      if (t.detached) return;
      t.detached = true;
      release();
      if (!t.attached) return;
      if (!writeAudit({
        id: env.id, user, via: 'direct', builder: id, action: 'term-detach', target: name, args,
        result: { ok: true, bytesIn: t.bytesIn, bytesOut: t.bytesOut, code: Number.isInteger(code) ? code : null, durationMs: Math.max(0, now() - t.startedAt) },
      })) warn('term-proxy: term-detach could not be audited');
    };

    /** Before the browser is open: drop everything (upstream, slot, raw socket). */
    const abort = (status) => {
      if (t.state !== 'pending' && t.state !== 'upgrading') return;
      const wasUpgrading = t.state === 'upgrading';
      t.state = 'gone';
      try { t.up?.terminate(); } catch { /* ignore */ }
      detach(null);
      if (wasUpgrading || status === null) { try { socket.destroy(); } catch { /* ignore */ } } else refuseSocket(socket, status);
    };

    // Before the browser is upgraded, a "close" of the raw socket means: drop everything.
    const onSocketGone = () => abort(null);
    socket.on('close', onSocketGone);

    t.shut = (code, reason) => {
      if (t.state === 'pending' || t.state === 'upgrading') { abort(503); return; }
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
        autoPong: false,
      });
    } catch {
      t.state = 'gone';
      socket.off('close', onSocketGone);
      detach(null);
      refuseSocket(socket, 503);
      return true;
    }
    t.up = up;

    const failPending = (status) => { if (t.state === 'pending') abort(status); };

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
      t.sides.up.lastSeen = mono();
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
      if (overQueued()) return;
      backpressure(b, up);
    });
    up.on('ping', (data) => { t.sides.up.lastSeen = mono(); if (t.state === 'open') pongMaybe(up, t.sides.up, data); });
    up.on('pong', () => { t.sides.up.lastSeen = mono(); });

    up.on('error', () => {
      if (t.state === 'pending' || t.state === 'upgrading') { abort(503); return; }
      if (t.state === 'open') { try { t.browser.terminate(); } catch { /* ignore */ } }
    });

    up.on('close', (code, reason) => {
      if (t.state === 'pending' || t.state === 'upgrading') { abort(503); return; }
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
      t.attached = true;
      if (socket.destroyed) { abort(null); return; }
      t.state = 'upgrading';
      // SR12 M1: an upgrade that does not complete (ws aborted it, the socket went away) must not keep the slot.
      t.upgradeTimer = setTimeout(() => {
        t.upgradeTimer = null;
        if (t.state === 'upgrading') { stats.upgradeFailures++; abort(null); }
      }, L.upgradeMs);
      t.upgradeTimer.unref?.();
      try {
        wss.handleUpgrade(req, socket, head, (ws) => onBrowser(ws));
      } catch {
        stats.upgradeFailures++;
        abort(null);
        return;
      }
      if (t.state === 'upgrading' && socket.destroyed) { stats.upgradeFailures++; abort(null); }
    });

    function onBrowser(b) {
      if (t.state !== 'upgrading') { try { b.terminate(); } catch { /* ignore */ } return; }
      if (t.upgradeTimer) { clearTimeout(t.upgradeTimer); t.upgradeTimer = null; }
      t.browser = b;
      t.state = 'open';
      t.startedAt = now();
      b.on('error', () => {
        try { up.terminate(); } catch { /* ignore */ }
        try { b.terminate(); } catch { /* ignore */ }
      });
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
      const m = mono();
      t.sides.up.lastSeen = m;
      t.sides.browser.lastSeen = m;
      b.on('message', (data, isBinary) => {
        t.sides.browser.lastSeen = mono();
        t.bytesIn += byteLen(data);
        if (up.readyState !== WebSocket.OPEN) return;
        up.send(data, { binary: isBinary });
        if (overQueued()) return;
        backpressure(up, b);
      });
      b.on('ping', (data) => { t.sides.browser.lastSeen = mono(); pongMaybe(b, t.sides.browser, data); });
      b.on('pong', () => { t.sides.browser.lastSeen = mono(); });
      b.on('close', (code, reason) => {
        if (up.readyState === WebSocket.OPEN) {
          try { up.close(forwardCode(code), cleanReason(reason)); } catch { up.terminate(); }
        } else if (up.readyState === WebSocket.CONNECTING) {
          up.terminate();
        }
        detach(code);
      });
      t.liveTimer = setInterval(liveness, L.pingMs);
      t.liveTimer.unref?.();
    }

    /** Answer a ping only rarely and only while that socket's queue is short (SR12 M2). */
    function pongMaybe(ws, side, data) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const m = mono();
      if (ws.bufferedAmount >= L.lowWater || m - side.lastPong < L.pongMinMs) { stats.droppedPongs++; return; }
      side.lastPong = m;
      try { ws.pong(data); } catch { /* ignore */ }
      overQueued();
    }

    /** Hard cap on what either socket has queued (SR12 M2): terminate it, close the other with 1008. */
    function overQueued() {
      if (t.state !== 'open') return false;
      const b = t.browser;
      const over = b.bufferedAmount > L.maxQueuedBytes ? 'browser' : up.bufferedAmount > L.maxQueuedBytes ? 'up' : null;
      if (!over) return false;
      stats.overflows++;
      warn(`term-proxy: ${over === 'up' ? 'builder' : 'browser'} socket queued over ${L.maxQueuedBytes} bytes; closing the terminal`);
      const [bad, other] = over === 'up' ? [up, b] : [b, up];
      t.state = 'gone';
      detach(OVERFLOW_CODE);
      try { bad.terminate(); } catch { /* ignore */ }
      try { other.close(OVERFLOW_CODE, 'queue overflow'); } catch { try { other.terminate(); } catch { /* ignore */ } }
      return true;
    }

    /** Ping both sides; a side silent for 2 intervals while we were reading it is dead (SR12 L2). */
    function liveness() {
      if (t.state !== 'open') return;
      if (overQueued()) return;
      const m = mono();
      for (const [ws, side] of [[up, t.sides.up], [t.browser, t.sides.browser]]) {
        // A socket we paused (backpressure) cannot deliver its pong; it is not silent.
        if (ws._socket?.isPaused?.()) { side.lastSeen = m; continue; }
        if (m - side.lastSeen > 2 * L.pingMs) {
          stats.deadPeers++;
          t.state = 'gone';
          detach(null);
          try { up.terminate(); } catch { /* ignore */ }
          try { t.browser.terminate(); } catch { /* ignore */ }
          return;
        }
      }
      for (const ws of [up, t.browser]) {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < L.lowWater) { try { ws.ping(); } catch { /* ignore */ } }
      }
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
