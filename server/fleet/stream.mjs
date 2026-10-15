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

function sendRaw(client, data) {
  if (client.readyState !== client.OPEN) return;
  if (client.bufferedAmount > MAX_BUFFERED) {
    log.warn('v1 stream client too far behind; dropping it');
    client.terminate();
    clients.delete(client);
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

function handleClientMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'resync') {
    const plan = resyncPlan(msg.fromSeq, msg.epoch);
    if (plan.replay) {
      for (const data of plan.replay) sendRaw(client, data);
      return;
    }
    const now = Date.now();
    client.resyncs = (client.resyncs ?? []).filter((t) => now - t < RESYNC_WINDOW_MS);
    if (client.resyncs.length >= RESYNC_LIMIT) {
      log.warn('v1 stream client resyncing too often; closing it');
      client.close(1008, 'resync rate');
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
  wss.handleUpgrade(req, socket, head, (client) => {
    client.isAlive = true;
    client.visible = new Set();
    client.auth = auth;
    clients.add(client);
    // Sent before any later publish can interleave (all synchronous).
    sendRaw(client, JSON.stringify(snapshotFrame()));
    client.on('pong', () => { client.isAlive = true; });
    client.on('message', (raw) => handleClientMessage(client, raw));
    const gone = () => { if (clients.delete(client)) ws.recomputeVisible(); };
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
