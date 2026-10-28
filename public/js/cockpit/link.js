// The page's room link (cockpit spec protocols.md §2, screens.md §7, §7.1,
// c1-talk.md §5.1, D10, D11, D94, D118, D139, D263): one WebSocket to
// /api/cockpit/ws, its own loop (not net.js createSource: it needs the 5 s
// grace, the 25 s silence, close codes that stop retrying and the marks), with
// net.js's backoff rule imported, no number copied (D263).
//
//   const link = createRoomLink({ url, page, onState, onMessage });
//   link.start();          // the page's load: the first link, the 5 s snapshot wait
//   link.send(msg)         // a screen message; the link's own `seq` is added; false when not live
//   link.retryNow()        // RETRY NOW (screens.md §7.1, D220)
//   link.state()           // {status, since, retryAt, trying, welcome, refused}
//
// `status` is the root's `data-cockpit` value this link decides: `connecting`
// (from the load until the last snapshot part is drawn, D118), `live`,
// `room-down` (after the grace, or at once for the codes that say so),
// `unpaired` (4401, 4402, 4403 insecure-origin). `onMessage(msg)` gets every
// session message in `seq` order (the snapshot as one message with every
// part's turns joined, oldest first) and every message without `seq` at once.
import { nextBackoff, BACKOFF_START_MS } from '../core/net.js';
import {
  LINK_GRACE_MS, LINK_SILENCE_MS, SNAPSHOT_WAIT_MS, PROTOCOL, TOO_MANY_LINKS_RETRY_MS, TOO_MANY_RETRY_MS,
} from '../core/cockpit-constants.js';

/** protocols.md §2.3: the close codes after which the screen does not retry. */
const NO_RETRY = new Set([4002, 4401, 4402, 4403]);

const defaultMark = (name, opts) => {
  try { globalThis.performance?.mark?.(name, opts); } catch { /* no marks: nothing the owner sees changes (c1-talk.md §1.2) */ }
};

export function createRoomLink(opts = {}) {
  const url = opts.url;
  const page = opts.page ?? 'app';
  const WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
  const now = opts.now ?? (() => Date.now());
  const mark = opts.mark ?? defaultMark;
  const warn = opts.warn ?? ((...a) => console.warn(...a));
  const onState = opts.onState ?? (() => {});
  const onMessage = opts.onMessage ?? (() => {});

  let ws = null;
  let outSeq = 0; // the link's own counter, from 1 on each new link (§2.1)
  let lastSeq = null; // the highest room seq applied
  let epoch = null; // the last welcome's epoch
  let welcomed = false;
  let parts = null; // snapshot parts in flight: {parts: [], held: []}
  let drawn = false; // a snapshot has been drawn since the load
  let backoff = BACKOFF_START_MS;
  let attempt = 0; // tries since the loss (the first link of a load is not a retry)
  let lossAt = null; // when the link was last lost and is not back
  let loadAt = null;
  let retryTimer = null;
  let graceTimer = null;
  let silenceTimer = null;
  let snapshotTimer = null;
  let stopped = false;
  const st = { status: 'connecting', since: null, retryAt: null, trying: false, welcome: null, refused: null };

  const emit = () => onState({ ...st });
  const set = (patch) => {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) if (st[k] !== v) { st[k] = v; changed = true; }
    if (changed) emit();
  };
  const clear = (t) => { if (t !== null) clearTimer(t); return null; };

  function open({ delayMs = null } = {}) {
    if (stopped) return;
    retryTimer = clear(retryTimer);
    if (delayMs !== null) {
      attempt += 1;
      mark('cockpit:retry', { detail: { attempt, delayMs } }); // screens.md §7.1, D220
    }
    outSeq = 0;
    welcomed = false;
    parts = null;
    let sock;
    try {
      sock = new WebSocketImpl(url);
    } catch {
      lost();
      return;
    }
    ws = sock;
    set({ trying: delayMs !== null, retryAt: null });
    sock.addEventListener('open', () => {
      if (ws !== sock) return;
      backoff = BACKOFF_START_MS; // a link that opens resets the delay (screens.md §7.1)
      const hello = { type: 'hello', seq: ++outSeq, page, protocol: PROTOCOL };
      if (epoch !== null && lastSeq !== null) { hello.epoch = epoch; hello.lastSeq = lastSeq; }
      sock.send(JSON.stringify(hello));
      heard();
    });
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      heard();
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;
      receive(msg, sock);
    });
    sock.addEventListener('close', (ev) => {
      if (ws !== sock) return;
      ws = null;
      closed(ev.code, ev.reason ?? '');
    });
    sock.addEventListener('error', () => { try { sock.close(); } catch { /* closing */ } });
  }

  /** Any frame: the 25 s silence starts again (protocols.md §2.2, D139). */
  function heard() {
    silenceTimer = clear(silenceTimer);
    silenceTimer = setTimer(() => {
      silenceTimer = null;
      const sock = ws;
      if (!sock) return;
      ws = null; // the loss is now, not at the socket's later close
      try { sock.close(); } catch { /* closing */ }
      lost();
    }, LINK_SILENCE_MS);
  }

  function receive(msg, sock) {
    if (msg.type === 'welcome') {
      welcomed = true;
      if (typeof msg.epoch === 'string') {
        if (msg.epoch !== epoch) lastSeq = null; // another epoch: the room restarted
        epoch = msg.epoch;
      }
      // A link that had its welcome ends the loss: no room-down for it (D139).
      graceTimer = clear(graceTimer);
      lossAt = null;
      attempt = 0;
      set({ welcome: msg, refused: null, trying: false, retryAt: null });
      onMessage(msg);
      if (msg.resume === 'replay' && drawn) back();
      return;
    }
    if (msg.type === 'snapshot') {
      parts ??= { list: [], held: [] };
      parts.list.push(msg);
      if (msg.part !== msg.parts) return;
      const { list, held } = parts;
      parts = null;
      const last = list[list.length - 1];
      const snap = { ...last, turns: list.flatMap((p) => (Array.isArray(p.turns) ? p.turns : [])) };
      lastSeq = typeof last.seq === 'number' ? last.seq : null;
      onMessage(snap);
      drawn = true;
      snapshotTimer = clear(snapshotTimer);
      back();
      for (const m of held) if (ws === sock) ordered(m, sock);
      return;
    }
    if (typeof msg.seq === 'number') {
      if (parts) { parts.held.push(msg); return; } // held until the last part (§2.2)
      ordered(msg, sock);
      return;
    }
    onMessage(msg); // no seq: heartbeat, speech, show… act at once
  }

  function ordered(msg, sock) {
    if (lastSeq !== null && msg.seq <= lastSeq) return; // never applied twice (§2.2)
    if (lastSeq !== null && msg.seq !== lastSeq + 1) { gap(sock); return; }
    lastSeq = msg.seq;
    onMessage(msg);
  }

  /** A seq other than the last + 1: close 4000 `gap`, reconnect at once for a snapshot (§2.2). */
  function gap(sock = ws) {
    if (!sock) return;
    epoch = null; // no epoch: the room sends a snapshot
    lastSeq = null;
    ws = null;
    mark('cockpit:close', { detail: { code: 4000, reason: 'gap' } });
    try { sock.close(4000, 'gap'); } catch { /* closing */ }
    open();
  }

  function back() {
    if (st.status === 'live') return;
    set({ status: 'live', since: null, retryAt: null, trying: false });
  }

  function down(since) {
    set({ status: 'room-down', since });
  }

  function closed(code, reason) {
    silenceTimer = clear(silenceTimer);
    mark('cockpit:close', { detail: { code, reason } }); // protocols.md §2.3
    if (code >= 4401 && code <= 4503) warn('cockpit: link refused', code, reason);
    if (code === 4002 || code === 4401 || code === 4402 || code === 4403) {
      retryTimer = clear(retryTimer);
      graceTimer = clear(graceTimer);
      snapshotTimer = clear(snapshotTimer);
      const status = code === 4401 || code === 4402 || reason === 'insecure-origin' ? 'unpaired' : 'room-down';
      set({ status, since: status === 'room-down' ? now() : null, refused: { code, reason }, trying: false, retryAt: null });
      return;
    }
    if (code === 4503) { // room-down at once, no grace; every 30 s, no backoff
      graceTimer = clear(graceTimer);
      lossAt ??= now();
      set({ status: 'room-down', since: drawn ? lossAt : (loadAt ?? lossAt), refused: { code, reason } });
      schedule(TOO_MANY_LINKS_RETRY_MS);
      return;
    }
    if (code === 4429) { lost({ delayMs: TOO_MANY_RETRY_MS }); return; }
    lost();
  }

  /** The link is lost now: the grace starts, the next try is scheduled with backoff. */
  function lost({ delayMs = null } = {}) {
    if (stopped) return;
    if (lossAt === null) {
      lossAt = now();
      attempt = 0;
      if (st.status !== 'room-down' && graceTimer === null) {
        const since = drawn ? lossAt : (loadAt ?? lossAt); // a fresh page's "since" is its load (D118)
        graceTimer = setTimer(() => { graceTimer = null; down(since); }, LINK_GRACE_MS);
      }
    }
    if (delayMs !== null) schedule(delayMs);
    else { backoff = nextBackoff(backoff); schedule(backoff); }
  }

  /** The next try in `ms` (4503 and 4429 leave the backoff where it was). */
  function schedule(ms) {
    retryTimer = clear(retryTimer);
    set({ trying: false, retryAt: now() + ms });
    retryTimer = setTimer(() => { retryTimer = null; open({ delayMs: ms }); }, ms);
  }

  function start() {
    loadAt = now();
    snapshotTimer = setTimer(() => {
      snapshotTimer = null;
      if (!drawn && st.status === 'connecting') down(loadAt); // no snapshot 5 s after the load (D118)
    }, SNAPSHOT_WAIT_MS);
    open();
  }

  /** A screen message with the link's own seq (its number); false when no welcomed link is open. */
  function send(msg) {
    if (!ws || !welcomed || ws.readyState !== 1) return false;
    const out = { ...msg, seq: ++outSeq };
    try { ws.send(JSON.stringify(out)); return out.seq; } catch { return false; }
  }

  /** RETRY NOW: the pending try at once; on failure the series goes on from the cancelled delay (D220). */
  function retryNow() {
    if (ws || retryTimer === null || NO_RETRY.has(st.refused?.code)) return false;
    open({ delayMs: 0 });
    return true;
  }

  function stop() {
    stopped = true;
    for (const t of [retryTimer, graceTimer, silenceTimer, snapshotTimer]) clear(t);
    retryTimer = graceTimer = silenceTimer = snapshotTimer = null;
    const sock = ws;
    ws = null;
    try { sock?.close(1000, 'bye'); } catch { /* closing */ }
  }

  // `gap` is also the missed-something rule of c1-talk.md §5.1 (D119): close 4000 and take the snapshot.
  return { start, send, retryNow, gap: () => gap(), state: () => ({ ...st }), stop };
}
