// Upstream client: one per builder (fleet plan §3 2.3, SECURITY-FIXES S3).
// REVIEW-REQUIRED (SR10).
//
//   const up = new Upstream({ builder, key, keyId, store, cfg });
//   up.start(); ... up.stop();
//   up.send({type:'visible', keys:[fkey...]})   // the only thing the hub sends on the stream
//   up.setVisible(keys)                         // same, direct
//   up.status() -> {state, lastSeen, latencyMs, attempts, error, connectedAt, seq, epoch, resyncs, dropped}
//   backoffMs(attempt, rand)                    // pure
//   classify({lastSeen, connected, now, staleMs, downMs, since})  // pure
//
// Lifecycle of one connection:
//   1. hello: signed GET {url}/api/v1/hello (10 s timeout, 64 KiB cap). `id` must equal the configured
//      builder id, else `misconfigured` (retry every 60 s, nothing else is opened). `apiVersion` must be
//      1, else `incompatible` (read-only: the last snapshot stays, no stream, retry every 60 s).
//   2. stream: signed WS {url}/api/v1/stream. The signature travels in headers only (never the query),
//      no Origin header, maxPayload 8 MiB (ws closes with 1009 before any JSON.parse), no
//      permessage-deflate, no redirects.
//   3. frames {builder, seq, epoch, ...}: a frame naming another builder is dropped (logged once a
//      minute). `snapshot` resets seq/epoch. Any other frame must be seq === last + 1 in the same
//      epoch; otherwise ONE resync: signed GET /api/v1/snapshot (10 s, 8 MiB cap) while later frames
//      are buffered (200 frames / 16 MiB cap, else the socket is closed), then the buffer is replayed
//      dropping seq <= snap.seq. A second gap within 10 s closes the socket instead.
//      delta -> store.applyDelta; event/health/approval/stuck/repos -> store.applyEvent;
//      map/alarms/pong and unknown types are ignored (seq still advances).
//   4. liveness: protocol ping every pingMs (EWMA latency, α 0.3); a 1 s tick classifies
//      up (< staleMs since last frame) / stale (< downMs) / down. A closed socket is stale, not down,
//      until downMs has passed. A connected socket silent for staleMs is terminated.
//   5. reconnect: backoffMs(n) = min(30 s, 500 ms * 1.8^n) * (0.8 + 0.4 * rand); n resets after 30 s up.
//   6. bounds: received bytes in a 1 s sliding window above 2 MiB → close 1008 `rate`; every HTTP read
//      has a timeout and a byte cap before parsing (over → `response too large`).
//
// Everything a builder sends is untrusted: only plain objects are accepted, the store sanitizes, and
// routing identity is the configured builder id (the store recomputes fkeys from it). Errors recorded
// in status() are fixed strings: never a key, a signature, a header or builder-supplied text.
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { signRead } from '../fleet/auth.mjs';
import { BUILDER_ID_RX, localKey, fkey } from '../fleet/keys.mjs';
import { log as defaultLog } from '../log.mjs';

const KiB = 1024;
const MiB = 1024 * KiB;

export const DEFAULTS = Object.freeze({
  staleMs: 15_000,
  downMs: 60_000,
  pingMs: 5_000,
  tickMs: 1_000,
  maxPayload: 8 * MiB,
  handshakeTimeoutMs: 10_000,
  helloTimeoutMs: 10_000,
  snapshotTimeoutMs: 10_000,
  helloMaxBytes: 64 * KiB,
  snapshotMaxBytes: 8 * MiB,
  maxBytesPerSec: 2 * MiB,
  retryMisconfiguredMs: 60_000,
  resyncBufferFrames: 200,
  resyncBufferBytes: 16 * MiB,
  gapWindowMs: 10_000,
  stableMs: 30_000,
  closeGraceMs: 2_000,
  visibleMax: 64,
  sendMaxBytes: 64 * KiB,
});

export const BACKOFF = Object.freeze({ baseMs: 500, factor: 1.8, capMs: 30_000, jitter: 0.2 });

/** Reconnect delay for attempt `n` (0-based): min(30 s, 500 ms * 1.8^n) * (0.8 + 0.4 * rand). Pure. */
export function backoffMs(attempt, rand = Math.random) {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const base = Math.min(BACKOFF.capMs, BACKOFF.baseMs * BACKOFF.factor ** Math.min(n, 64));
  let r = Number(rand());
  if (!Number.isFinite(r)) r = 0.5;
  r = Math.min(1, Math.max(0, r));
  return Math.round(base * (1 - BACKOFF.jitter + 2 * BACKOFF.jitter * r));
}

/**
 * Liveness state. Pure.
 *   connected && now - lastSeen < staleMs -> up
 *   now - lastSeen < downMs               -> stale (a closed socket lands here first)
 *   otherwise                             -> down
 *   never seen                            -> connecting (or down once `since` is downMs old)
 */
export function classify({ lastSeen, connected, now, staleMs = DEFAULTS.staleMs, downMs = DEFAULTS.downMs, since = null } = {}) {
  if (!Number.isFinite(lastSeen)) {
    if (Number.isFinite(since) && now - since >= downMs) return 'down';
    return 'connecting';
  }
  const age = now - lastSeen;
  if (connected && age < staleMs) return 'up';
  if (age < downMs) return 'stale';
  return 'down';
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const STORE_EVENT_TYPES = new Set(['event', 'health', 'approval', 'stuck', 'repos']);
const IGNORED_TYPES = new Set(['map', 'alarms']);
const EPOCH_RX = /^[A-Za-z0-9_-]{1,64}$/;

class HttpError extends Error {}

/** Read at most `cap` bytes of a fetch Response body; parse JSON. Throws HttpError with a fixed message. */
async function readJsonCapped(res, cap, what) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > cap) {
    try { await res.body?.cancel(); } catch { /* gone */ }
    throw new HttpError(`${what}: response too large`);
  }
  const chunks = [];
  let total = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        try { await reader.cancel(); } catch { /* gone */ }
        throw new HttpError(`${what}: response too large`);
      }
      chunks.push(value);
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) throw new HttpError(`${what}: response too large`);
    chunks.push(buf);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
  } catch {
    throw new HttpError(`${what}: bad encoding`);
  }
  try { return JSON.parse(text); } catch { throw new HttpError(`${what}: not JSON`); }
}

/** Map a thrown fetch/abort error to a fixed string. */
function fetchError(err, what) {
  if (err instanceof HttpError) return err.message;
  if (err?.name === 'TimeoutError') return `${what}: timeout`;
  if (err?.name === 'AbortError') return `${what}: aborted`;
  return `${what}: unreachable`;
}

/** Map a ws client error to a fixed string. */
function wsError(err) {
  const code = err?.code;
  if (code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') return 'frame too large';
  const m = /^Unexpected server response: (\d{3})$/.exec(String(err?.message ?? ''));
  if (m) return `stream: http ${m[1]}`;
  if (/handshake has timed out/i.test(String(err?.message ?? ''))) return 'stream: handshake timeout';
  if (typeof code === 'string' && code.startsWith('WS_ERR_')) return 'stream: protocol error';
  return 'stream: unreachable';
}

export class Upstream extends EventEmitter {
  /**
   * builder: {id, url} (validated fleet.builders entry); key: the hub's Ed25519 private KeyObject;
   * keyId: optional; store: fleet-store; sign: signRead-compatible ({method, url, builderId, key,
   * keyId}) -> headers; cfg: overrides of DEFAULTS (config.fleet works: staleMs, downMs, pingMs).
   */
  constructor({
    builder, key, keyId, store, sign = signRead, now = Date.now, WebSocketImpl = WebSocket, fetchImpl = globalThis.fetch,
    cfg = {}, log = defaultLog, rand = Math.random, backoff = backoffMs,
  } = {}) {
    super();
    if (!builder || typeof builder.id !== 'string' || !BUILDER_ID_RX.test(builder.id)) throw new TypeError('upstream: invalid builder id');
    if (!store || typeof store.applySnapshot !== 'function') throw new TypeError('upstream: store required');
    this.id = builder.id;
    this.builder = builder;
    this._key = key;
    this._keyId = keyId;
    this.store = store;
    this._sign = sign;
    this._now = now;
    this._WS = WebSocketImpl;
    this._fetch = fetchImpl;
    this._log = log;
    this._rand = rand;
    this._backoff = backoff;
    const c = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (Number.isFinite(cfg?.[k]) && cfg[k] > 0) c[k] = cfg[k];
    if (c.staleMs >= c.downMs) throw new TypeError('upstream: staleMs must be < downMs');
    this.cfg = Object.freeze(c);
    this._base = null;
    try {
      const u = new URL(String(builder.url));
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && (u.pathname === '/' || u.pathname === '')
        && !u.search && !u.hash) this._base = u.origin;
    } catch { /* stays null */ }

    this._started = false;
    this._stopped = false;
    this._since = null;
    this._gen = 0; // bumps on every new socket; stale callbacks compare against it
    this._ws = null;
    this._connected = false;
    this._closing = false;
    this._hold = null; // 'misconfigured' | 'incompatible' while the hello says so
    this._state = 'connecting';
    this._lastSeen = null;
    this._connectedAt = null;
    this._latencyMs = null;
    this._attempts = 0;
    this._error = null;
    this._seq = null;
    this._epoch = null;
    this._resyncing = false;
    this._buffer = [];
    this._bufferBytes = 0;
    this._lastGapAt = -Infinity;
    this._resyncs = 0;
    this._rate = []; // [{t, n}] for the 1 s byte window
    this._rateBytes = 0;
    this._pingAt = null;
    this._visible = [];
    this._timers = { tick: null, ping: null, retry: null, closeGrace: null };
    this._aborts = new Set();
    this._lastWrongBuilderLog = -Infinity;
    this.dropped = { wrongBuilder: 0, binary: 0, badJson: 0, notObject: 0, noSeq: 0, duplicate: 0, ignored: 0 };
  }

  start() {
    if (this._started || this._stopped) return;
    this._started = true;
    this._since = this._now();
    this._timers.tick = setInterval(() => this._tick(), this.cfg.tickMs);
    this._timers.tick.unref?.();
    this._timers.ping = setInterval(() => this._ping(), this.cfg.pingMs);
    this._timers.ping.unref?.();
    this._publish();
    this._connect();
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    for (const k of Object.keys(this._timers)) {
      clearInterval(this._timers[k]);
      clearTimeout(this._timers[k]);
      this._timers[k] = null;
    }
    for (const ac of this._aborts) ac.abort();
    this._aborts.clear();
    this._gen++;
    const ws = this._ws;
    this._ws = null;
    this._connected = false;
    if (ws) { try { ws.terminate(); } catch { /* gone */ } }
    this._buffer = [];
    this._bufferBytes = 0;
  }

  status() {
    return {
      state: this._state,
      lastSeen: this._lastSeen,
      latencyMs: this._latencyMs,
      attempts: this._attempts,
      error: this._error,
      connectedAt: this._connectedAt,
      connected: this._connected,
      seq: this._seq,
      epoch: this._epoch,
      resyncs: this._resyncs,
      dropped: { ...this.dropped },
    };
  }

  /**
   * Send a JSON frame upstream. `visible` goes through setVisible (validated, ≤64 fkeys of this
   * builder); any other frame must be a plain object under 64 KiB. Returns true if it was sent.
   */
  send(msg) {
    if (!isPlainObject(msg) || typeof msg.type !== 'string') return false;
    if (msg.type === 'visible') return this.setVisible(msg.keys ?? []);
    return this._sendRaw(msg);
  }

  /** The hub clients' visible sessions on this builder (fkeys). Remembered and re-sent on reconnect. */
  setVisible(keys) {
    const out = [];
    const seen = new Set();
    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (out.length >= this.cfg.visibleMax) break;
        const name = localKey(k, this.id);
        if (name === null || name.length > 256 || seen.has(name)) continue;
        seen.add(name);
        out.push(fkey(this.id, name));
      }
    }
    this._visible = out;
    return this._sendRaw({ type: 'visible', keys: out });
  }

  // --- internals ----------------------------------------------------------------------------------

  _sendRaw(msg) {
    const ws = this._ws;
    if (!ws || !this._connected || this._closing || ws.readyState !== 1) return false;
    let text;
    try { text = JSON.stringify(msg); } catch { return false; }
    if (Buffer.byteLength(text) > this.cfg.sendMaxBytes) return false;
    try { ws.send(text); } catch { return false; }
    return true;
  }

  _publish() {
    const prev = this._state;
    if (this._hold) this._state = this._hold;
    else this._state = classify({ lastSeen: this._lastSeen, connected: this._connected, now: this._now(), staleMs: this.cfg.staleMs, downMs: this.cfg.downMs, since: this._since });
    this.store.setConn(this.id, {
      state: this._state,
      lastSeen: this._lastSeen,
      latencyMs: this._latencyMs,
      attempts: this._attempts,
      error: this._error,
      connectedAt: this._connectedAt,
    });
    if (prev !== this._state) this.emit('state', this.status());
  }

  _fail(error) {
    this._error = error;
    this._publish();
  }

  _schedule(ms) {
    if (this._stopped) return;
    clearTimeout(this._timers.retry);
    this._timers.retry = setTimeout(() => { this._timers.retry = null; this._connect(); }, ms);
    this._timers.retry.unref?.();
  }

  _retryLater() {
    const ms = this._backoff(this._attempts, this._rand);
    this._attempts++;
    this._publish();
    this._schedule(ms);
  }

  async _get(path, timeoutMs, cap, what) {
    const ac = new AbortController();
    this._aborts.add(ac);
    try {
      const headers = this._sign({ method: 'GET', url: path, builderId: this.id, key: this._key, keyId: this._keyId });
      const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]);
      const t0 = this._now();
      // The whole read (headers + capped body) is under the timeout.
      const res = await this._fetch(this._base + path, { method: 'GET', headers, signal, redirect: 'error' });
      if (res.status !== 200) {
        try { await res.body?.cancel(); } catch { /* gone */ }
        throw new HttpError(`${what}: http ${Number(res.status) | 0}`);
      }
      const body = await readJsonCapped(res, cap, what);
      return { body, t0, t1: this._now() };
    } finally {
      this._aborts.delete(ac);
    }
  }

  async _connect() {
    if (this._stopped || this._ws) return;
    const gen = ++this._gen;
    if (!this._base) {
      this._hold = 'misconfigured';
      this._fail('bad builder url');
      return;
    }
    let hello;
    let t0;
    let t1;
    try {
      ({ body: hello, t0, t1 } = await this._get('/api/v1/hello', this.cfg.helloTimeoutMs, this.cfg.helloMaxBytes, 'hello'));
    } catch (err) {
      if (gen !== this._gen || this._stopped) return;
      this._error = fetchError(err, 'hello');
      this._retryLater();
      return;
    }
    if (gen !== this._gen || this._stopped) return;
    if (!isPlainObject(hello)) {
      this._error = 'hello: not an object';
      this._retryLater();
      return;
    }
    if (hello.id !== this.id) {
      this._hold = 'misconfigured';
      this._fail('hello id mismatch');
      this._schedule(this.cfg.retryMisconfiguredMs);
      return;
    }
    const time = Number(hello.time);
    const clockSkewMs = Number.isFinite(time) && time > 0 ? Math.round(time - (t0 + t1) / 2) : null;
    this.store.setConn(this.id, { hello, clockSkewMs });
    if (hello.apiVersion !== 1) {
      this._hold = 'incompatible';
      this._fail('unsupported apiVersion');
      this._schedule(this.cfg.retryMisconfiguredMs);
      return;
    }
    this._hold = null;
    this._openStream(gen);
  }

  _openStream(gen) {
    const path = '/api/v1/stream';
    let ws;
    try {
      const headers = this._sign({ method: 'GET', url: path, builderId: this.id, key: this._key, keyId: this._keyId });
      ws = new this._WS(this._base.replace(/^http/, 'ws') + path, {
        headers,
        maxPayload: this.cfg.maxPayload,
        handshakeTimeout: this.cfg.handshakeTimeoutMs,
        perMessageDeflate: false,
        followRedirects: false,
      });
    } catch {
      this._error = 'stream: unreachable';
      this._retryLater();
      return;
    }
    this._ws = ws;
    this._closing = false;
    this._seq = null;
    this._epoch = null;
    this._resyncing = false;
    this._buffer = [];
    this._bufferBytes = 0;
    this._rate = [];
    this._rateBytes = 0;
    this._pingAt = null;
    let pendingError = null;

    ws.on('open', () => {
      if (gen !== this._gen) return;
      this._connected = true;
      this._connectedAt = this._now();
      this._lastSeen = this._connectedAt; // the builder accepted a signed upgrade: it is alive
      this._error = null;
      if (this._visible.length) this._sendRaw({ type: 'visible', keys: this._visible });
      this._publish();
      this.emit('open');
    });
    ws.on('message', (data, isBinary) => {
      if (gen !== this._gen) return;
      this._onMessage(gen, data, isBinary);
    });
    ws.on('pong', () => {
      if (gen !== this._gen || this._closing) return;
      const t = this._now();
      if (this._pingAt !== null) {
        const rtt = Math.max(0, t - this._pingAt);
        this._latencyMs = this._latencyMs === null ? rtt : Math.round(0.3 * rtt + 0.7 * this._latencyMs);
        this._pingAt = null;
      }
      this._lastSeen = t;
    });
    ws.on('error', (err) => {
      if (gen !== this._gen) return;
      pendingError = wsError(err);
    });
    ws.on('close', (code) => {
      if (gen !== this._gen) return;
      clearTimeout(this._timers.closeGrace);
      this._timers.closeGrace = null;
      this._ws = null;
      this._connected = false;
      this._closing = false;
      this._resyncing = false;
      this._buffer = [];
      this._bufferBytes = 0;
      for (const ac of this._aborts) ac.abort();
      this._aborts.clear();
      if (pendingError) this._error = pendingError;
      else if (code === 1009 && !this._error) this._error = 'frame too large';
      else if (!this._error) this._error = 'stream closed';
      this.emit('close', code);
      if (this._stopped) return;
      this._gen++; // the next _connect gets its own generation
      this._retryLater();
    });
  }

  /** Close the current socket on our side (rate, gaps, overflow). The 'close' handler reconnects. */
  _closeWith(code, error) {
    const ws = this._ws;
    if (!ws || this._closing) return;
    this._closing = true;
    this._error = error;
    this._resyncing = false;
    this._buffer = [];
    this._bufferBytes = 0;
    try { ws.close(code, error.slice(0, 100)); } catch { /* gone */ }
    // A peer that never answers the close frame does not get to keep the socket.
    this._timers.closeGrace = setTimeout(() => { try { ws.terminate(); } catch { /* gone */ } }, this.cfg.closeGraceMs);
    this._timers.closeGrace.unref?.();
  }

  _countBytes(n) {
    const t = this._now();
    this._rate.push({ t, n });
    this._rateBytes += n;
    while (this._rate.length && t - this._rate[0].t >= 1000) this._rateBytes -= this._rate.shift().n;
    return this._rateBytes <= this.cfg.maxBytesPerSec;
  }

  _onMessage(gen, data, isBinary) {
    if (this._closing) return;
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    const size = buf.length;
    if (!this._countBytes(size)) { this._closeWith(1008, 'rate'); return; }
    if (isBinary) { this.dropped.binary++; return; }
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { this.dropped.badJson++; return; }
    if (!isPlainObject(msg)) { this.dropped.notObject++; return; }
    if (msg.builder !== this.id) {
      this.dropped.wrongBuilder++;
      const t = this._now();
      if (t - this._lastWrongBuilderLog >= 60_000) {
        this._lastWrongBuilderLog = t;
        this._log?.warn?.(`upstream ${this.id}: dropped frame(s) naming another builder (${this.dropped.wrongBuilder} so far)`);
      }
      return;
    }
    this._lastSeen = this._now();
    if (this._resyncing) { this._bufferFrame(msg, size); return; }
    this._process(gen, msg, size);
  }

  _bufferFrame(msg, size) {
    if (this._buffer.length >= this.cfg.resyncBufferFrames || this._bufferBytes + size > this.cfg.resyncBufferBytes) {
      this._closeWith(1008, 'resync buffer overflow');
      return;
    }
    this._buffer.push(msg);
    this._bufferBytes += size;
  }

  _process(gen, msg, size = 0) {
    const type = msg.type;
    if (type === 'pong' || type === 'ping') return; // JSON heartbeats carry the current seq; not sequenced
    const epoch = typeof msg.epoch === 'string' && EPOCH_RX.test(msg.epoch) ? msg.epoch : null;
    if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) { this.dropped.noSeq++; return; }
    if (type === 'snapshot') {
      this.store.applySnapshot(this.id, msg, this._now());
      this._seq = msg.seq;
      this._epoch = epoch;
      return;
    }
    const epochChanged = this._epoch !== null && epoch !== this._epoch;
    if (!epochChanged && this._seq !== null && msg.seq <= this._seq) { this.dropped.duplicate++; return; }
    if (this._seq === null || epochChanged || msg.seq !== this._seq + 1) {
      this._gap(gen, msg, size);
      return;
    }
    this._seq = msg.seq;
    this._apply(msg);
  }

  _apply(msg) {
    const t = this._now();
    if (msg.type === 'delta') this.store.applyDelta(this.id, msg, t);
    else if (STORE_EVENT_TYPES.has(msg.type)) this.store.applyEvent(this.id, msg, t);
    else if (IGNORED_TYPES.has(msg.type)) { /* the hub builds its own Map and alarms */ } else this.dropped.ignored++;
  }

  _gap(gen, msg, size = 0) {
    const t = this._now();
    if (t - this._lastGapAt < this.cfg.gapWindowMs) {
      this._closeWith(4000, 'repeated seq gap');
      return;
    }
    this._lastGapAt = t;
    this._resyncs++;
    this._resyncing = true;
    this._buffer = [msg];
    this._bufferBytes = size;
    void this._resync(gen);
  }

  async _resync(gen) {
    let snap;
    try {
      ({ body: snap } = await this._get('/api/v1/snapshot', this.cfg.snapshotTimeoutMs, this.cfg.snapshotMaxBytes, 'snapshot'));
    } catch (err) {
      if (gen !== this._gen || this._stopped) return;
      this._closeWith(1011, fetchError(err, 'snapshot'));
      return;
    }
    if (gen !== this._gen || this._stopped || this._closing) return;
    const claimed = isPlainObject(snap?.builder) ? snap.builder.id : snap?.builder;
    if (!isPlainObject(snap) || !Array.isArray(snap.sessions) || !Number.isSafeInteger(snap.seq) || snap.seq < 0
      || (claimed !== undefined && claimed !== this.id)) {
      this._closeWith(1011, 'snapshot: bad body');
      return;
    }
    this.store.applySnapshot(this.id, snap, this._now());
    this._seq = snap.seq;
    this._epoch = typeof snap.epoch === 'string' && EPOCH_RX.test(snap.epoch) ? snap.epoch : null;
    const buffered = this._buffer;
    this._buffer = [];
    this._bufferBytes = 0;
    this._resyncing = false;
    for (const f of buffered) {
      if (gen !== this._gen || this._closing) return;
      const fe = typeof f.epoch === 'string' && EPOCH_RX.test(f.epoch) ? f.epoch : null;
      if (f.type !== 'snapshot' && fe === this._epoch && Number.isSafeInteger(f.seq) && f.seq <= this._seq) {
        this.dropped.duplicate++;
        continue;
      }
      this._process(gen, f);
    }
  }

  _ping() {
    const ws = this._ws;
    if (!ws || !this._connected || this._closing) return;
    this._pingAt = this._now();
    try { ws.ping(); } catch { /* closing */ }
  }

  _tick() {
    if (this._stopped) return;
    const t = this._now();
    if (this._connected && this._connectedAt !== null && t - this._connectedAt >= this.cfg.stableMs && this._attempts !== 0) {
      this._attempts = 0;
    }
    // A connected socket that has been silent (no frame, no pong) for staleMs is dead: drop it.
    if (this._connected && !this._closing && this._lastSeen !== null && t - this._lastSeen >= this.cfg.staleMs && this._ws) {
      this._error = 'stream: timeout';
      try { this._ws.terminate(); } catch { /* gone */ }
    }
    this._publish();
  }
}

/** One Upstream per configured builder. Returns {upstreams: Map<id, Upstream>, start(), stop(), get(id)}. */
export function createUpstreams({ builders = [], ...opts } = {}) {
  const upstreams = new Map();
  for (const b of builders) upstreams.set(b.id, new Upstream({ ...opts, builder: b }));
  return {
    upstreams,
    get: (id) => upstreams.get(id) ?? null,
    start() { for (const u of upstreams.values()) u.start(); },
    stop() { for (const u of upstreams.values()) u.stop(); },
  };
}
