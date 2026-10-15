// The v1 stream (fleet plan §2 2.9): WS /api/v1/stream, builder -> hub.
//
// Every frame /ws broadcasts (delta, event, map, and the new health,
// approval, stuck, repos, alarms messages, all sent with ws.send) reaches the
// stream through the ws tap, as the original object with `builder`, `seq` and
// `epoch` added at top level:
//
//   {type:'delta', ..., builder:'builder-a', seq:4812, epoch:'k3f9...'}
//
// - `seq` is ws.mjs's per-process counter, so /ws and the v1 stream share one
//   seq space and GET /api/v1/snapshot's `seq` (ws.currentSeq()) lines up.
// - `epoch` is a random id per process start: a restart resets seq, and the
//   epoch tells the receiver that its `lastSeq` means nothing any more.
// - The last RING_SIZE broadcast frames are kept. A client's
//   `{type:'resync', fromSeq[, epoch]}` replays `fromSeq+1..now` when its
//   epoch matches (or is absent) and every one of those frames is still in the
//   ring; otherwise it gets a fresh `snapshot`.
//
// Receiver rule (the hub, §3 H6): on an `epoch` change or `seq !== last+1`,
// resync (this message, or GET /api/v1/snapshot).
//
// On connect a client gets a `snapshot` stamped with the current seq (not
// moving it), so the next broadcast is seq + 1. No `hello`, no map greeting:
// the hub reads /api/v1/hello over HTTP and builds its own Map.
//
// Client messages: `resync`, `visible` (fkeys; legacy `names` one release),
// `ping`. Anything else is ignored.
//
// Authorization is NOT done here: attachStream is called by the v1 route
// (§2 A8) only after the upgrade was classified and verified; the `auth` it
// passes is kept on the socket for logging (never a key or signature).
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { warnRateLimited } from '../security.mjs';
import * as state from '../state.mjs';
import * as ws from '../ws.mjs';

export const RING_SIZE = 500;
/** Client frames are tiny (resync, visible ≤64 keys, ping). */
export const MAX_CLIENT_PAYLOAD = 64 * 1024;
/** A client this far behind is dropped; it reconnects and gets a snapshot. */
export const MAX_BUFFERED = 16 * 1024 * 1024;
/** Fresh-snapshot resyncs allowed per client per RESYNC_WINDOW_MS. */
export const RESYNC_LIMIT = 10;
export const RESYNC_WINDOW_MS = 10_000;
/** Ring replays allowed per client per RESYNC_WINDOW_MS (SR6 L2). */
export const REPLAY_LIMIT = 20;
/** Replayed bytes allowed per client per RESYNC_WINDOW_MS (SR6 L2). */
export const REPLAY_BYTES_LIMIT = 4 * 1024 * 1024;
/** A replay is refused (the client closed) while this much is still unsent to it (SR6 L2). */
export const MAX_REPLAY_BUFFERED = 1024 * 1024;
/** Concurrent v1 stream clients (SR6 L2); the hub needs one per builder. */
export const MAX_STREAM_CLIENTS = 32;

let EPOCH = randomBytes(9).toString('base64url');
export function epoch() { return EPOCH; }

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_PAYLOAD });
const clients = new Set();

/** Ring of {seq, data} (data = the stamped JSON), oldest first. */
let ring = [];

function builderId() { return config.fleet?.id ?? null; }

/** `builder`, `seq`, `epoch` on a frame (README §3.4). */
export function stampV1(msg, s = ws.currentSeq()) {
  return { ...msg, builder: builderId(), seq: s, epoch: EPOCH };
}

// The snapshot body; §2 A8 may swap in api-v1's snapshot via setSnapshotSource.
let snapshotSource = () => {
  const snap = state.snapshot();
  return { ...snap, sessions: (snap.sessions ?? []).map(ws.forWire) };
};

/** Replace the snapshot body (a function returning the snapshot object). */
export function setSnapshotSource(fn) {
  if (typeof fn !== 'function') throw new TypeError('setSnapshotSource: fn must be a function');
  snapshotSource = fn;
}

/** A `snapshot` frame at the current seq (seq does not move). */
export function snapshotFrame() {
  const { type, builder, seq, epoch: _e, ...body } = snapshotSource() ?? {};
  return stampV1({ type: 'snapshot', ...body });
}

function warnClient(reason, text) {
  // SR6 L3: one line per reason per minute, whatever a client sends
  warnRateLimited(() => log.warn(text), `v1-stream-${reason}`, '');
}

/**
 * Drop a client and ignore anything it still sends (SR6 L3). With a close
 * `code` a close frame is sent first (the client learns why) and the socket is
 * terminated after a second if the handshake does not finish; without one it
 * is terminated at once.
 */
function dropClient(client, reason, text, code = null, why = '') {
  if (client.lbClosing) return;
  client.lbClosing = true;
  warnClient(reason, text);
  if (clients.delete(client)) ws.recomputeVisible();
  if (code === null) {
    try { client.terminate(); } catch { /* gone */ }
    return;
  }
  try { client.close(code, why); } catch { /* gone */ }
  setTimeout(() => { try { client.terminate(); } catch { /* gone */ } }, 1000).unref?.();
}

function sendRaw(client, data) {
  if (client.lbClosing || client.readyState !== client.OPEN) return;
  if (client.bufferedAmount > MAX_BUFFERED) {
    dropClient(client, 'behind', 'v1 stream client too far behind; dropping it');
    return;
  }
  try { client.send(data); } catch { /* going away */ }
}

/**
 * publish(msg) puts a message on /ws and the v1 stream (it is ws.send: one
 * seq for both). publish(msg, seq) is the tap's entry: stamp, keep in the
 * ring, fan out to v1 clients.
 */
export function publish(msg, s) {
  if (s === undefined) { ws.send(msg); return; }
  const data = JSON.stringify(stampV1(msg, s));
  ring.push({ seq: s, data });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  for (const c of clients) sendRaw(c, data);
}

/**
 * Frames to send for a resync: `{replay: [data...]}` when fromSeq+1..now is
 * all in the ring under this epoch, else `{snapshot: true}`.
 */
export function resyncPlan(fromSeq, clientEpoch) {
  const now = ws.currentSeq();
  if (clientEpoch !== undefined && clientEpoch !== EPOCH) return { snapshot: true };
  if (!Number.isSafeInteger(fromSeq) || fromSeq < 0 || fromSeq > now) return { snapshot: true };
  if (fromSeq === now) return { replay: [] };
  const first = ring.length ? ring[0].seq : Infinity;
  const last = ring.length ? ring[ring.length - 1].seq : -Infinity;
  if (fromSeq + 1 < first || last !== now) return { snapshot: true };
  const out = ring.filter((f) => f.seq > fromSeq);
  // Contiguity check: a hole (a frame sent before the tap existed) means the
  // replay would leave a gap the receiver cannot see.
  if (out.length !== now - fromSeq) return { snapshot: true };
  return { replay: out.map((f) => f.data) };
}

/**
 * SR6 L2: a replay is allowed while the client has drained what it was sent
 * (at most one outstanding replay) and stays within REPLAY_LIMIT replays and
 * REPLAY_BYTES_LIMIT replayed bytes per RESYNC_WINDOW_MS. 'close' → the client
 * is dropped; 'snapshot' (the bytes budget) → a fresh snapshot instead.
 */
function replayVerdict(client, frames, now) {
  if (client.bufferedAmount > MAX_REPLAY_BUFFERED) return 'close';
  client.replays = (client.replays ?? []).filter((r) => now - r.at < RESYNC_WINDOW_MS);
  if (client.replays.length >= REPLAY_LIMIT) return 'close';
  let bytes = 0;
  for (const d of frames) bytes += Buffer.byteLength(d);
  const used = client.replays.reduce((n, r) => n + r.bytes, 0);
  // too many bytes: a fresh snapshot instead (bounded by RESYNC_LIMIT)
  if (used + bytes > REPLAY_BYTES_LIMIT) return 'snapshot';
  client.replays.push({ at: now, bytes });
  return 'replay';
}

function handleClientMessage(client, raw) {
  if (client.lbClosing) return;
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'resync') {
    const now = Date.now();
    const plan = resyncPlan(msg.fromSeq, msg.epoch);
    if (plan.replay) {
      if (plan.replay.length === 0) return;
      const verdict = replayVerdict(client, plan.replay, now);
      if (verdict === 'close') {
        dropClient(client, 'replay-rate', 'v1 stream client replaying too often or not reading its replays; closing it', 1008, 'replay rate');
        return;
      }
      if (verdict === 'replay') {
        for (const data of plan.replay) sendRaw(client, data);
        return;
      }
    }
    client.resyncs = (client.resyncs ?? []).filter((t) => now - t < RESYNC_WINDOW_MS);
    if (client.resyncs.length >= RESYNC_LIMIT) {
      dropClient(client, 'resync-rate', 'v1 stream client resyncing too often; closing it', 1008, 'resync rate');
      return;
    }
    client.resyncs.push(now);
    sendRaw(client, JSON.stringify(snapshotFrame()));
  } else if (msg.type === 'visible') {
    const names = ws.visibleNames(msg);
    if (names) { client.visible = names; ws.recomputeVisible(); }
  } else if (msg.type === 'ping') {
    sendRaw(client, JSON.stringify(stampV1({ type: 'pong', at: Date.now() })));
  }
}

/**
 * Upgrade an already-authorized request to a v1 stream client. `auth` is the
 * classification result from §2 A8 (kept for logs, e.g. `{kind:'hub'}`).
 */
export function attachStream(req, socket, head, auth = null) {
  if (clients.size >= MAX_STREAM_CLIENTS) {
    // SR6 L2: bounded fan-out (and so bounded buffered bytes in total)
    warnClient('full', `v1 stream: ${MAX_STREAM_CLIENTS} clients already connected; refusing another`);
    try { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* gone */ }
    setTimeout(() => { try { socket.destroy(); } catch { /* gone */ } }, 1000).unref?.();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    client.isAlive = true;
    client.visible = new Set();
    client.auth = auth;
    clients.add(client);
    // Sent before any later publish can interleave (all synchronous).
    sendRaw(client, JSON.stringify(snapshotFrame()));
    client.on('pong', () => { client.isAlive = true; });
    client.on('message', (raw) => handleClientMessage(client, raw));
    const gone = () => { client.lbClosing = true; if (clients.delete(client)) ws.recomputeVisible(); };
    client.on('close', gone);
    client.on('error', gone);
    log.info(`v1 stream client connected${auth?.kind ? ` (${auth.kind})` : ''} (${clients.size} total)`);
  });
  return true;
}

const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.isAlive) { c.terminate(); clients.delete(c); ws.recomputeVisible(); continue; }
    c.isAlive = false;
    try { c.ping(); } catch { /* closing */ }
  }
}, 30000);
heartbeat.unref();

export function streamClientCount() { return clients.size; }

ws.addTap(publish, {
  count: () => clients.size,
  visible: () => {
    const out = [];
    for (const c of clients) for (const n of c.visible ?? []) out.push(n);
    return out;
  },
});

/** Tests only: empty the ring, drop clients, optionally a new epoch. */
export function _reset({ newEpoch = false } = {}) {
  ring = [];
  for (const c of clients) { try { c.terminate(); } catch { /* gone */ } }
  clients.clear();
  if (newEpoch) EPOCH = randomBytes(9).toString('base64url');
  ws.recomputeVisible();
}
