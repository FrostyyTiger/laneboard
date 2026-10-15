// WebSocket fan-out: one snapshot per client on connect, then deltas.
import { WebSocketServer } from 'ws';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { VERSION } from './version.mjs';
import { localKey } from './fleet/keys.mjs';
import * as state from './state.mjs';

const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

/**
 * The 40-line raw `preview` is big and only the expanded view needs it; the
 * card's 8 raw ANSI `previewLines` ride the wire and the client renders them
 * (public/js/core/ansi.js, fleet F6). No HTML preview goes on the wire either:
 * a stray `previewHtml` (an old decorator, a stale object) is stripped too.
 */
export function forWire(session) {
  const { preview, previewHtml, ...rest } = session;
  return rest;
}

/**
 * Diff a snapshot against the previously sent one.
 * Pure, so the merge rule is testable without a browser. `keyOf` picks the
 * diff key (and so the `removed` entries): the local name here, an fkey on
 * the hub (fleet F7).
 */
export function diffSessions(prev, sessions, keyOf = (s) => s.name) {
  const next = serialiseAll(sessions, keyOf);
  const changed = [];
  for (const [name, str] of next) {
    if (prev.get(name) !== str) changed.push(JSON.parse(str));
  }
  const removed = [...prev.keys()].filter((n) => !next.has(n));
  return { changed, removed, next };
}

let lastSerialised = new Map(); // name -> JSON string
let lastVitalsAt = 0;
// Lanes change when a worktree is created or merged — minutes apart, not
// seconds — so they ride the delta only when they actually differ.
let lastLanes = '';
// The Box and the lane cards' extras change on the collectors' beat (15-60 s).
let lastBox = '';

export function broadcastFrom(snapshot) {
  if (!clients.size) {
    // Keep the diff baseline current so the next client's first delta is small.
    lastSerialised = serialiseAll(snapshot.sessions);
    lastLanes = JSON.stringify(snapshot.lanes ?? []);
    lastBox = JSON.stringify(snapshot.box ?? null);
    return;
  }
  const now = Date.now();
  const { changed, removed, next } = diffSessions(lastSerialised, snapshot.sessions);
  lastSerialised = next;

  const msg = { type: 'delta', generatedAt: snapshot.generatedAt };
  if (changed.length) msg.sessions = changed;
  if (removed.length) msg.removed = removed;
  msg.attention = snapshot.attention;
  const lanesJson = JSON.stringify(snapshot.lanes ?? []);
  if (lanesJson !== lastLanes) {
    lastLanes = lanesJson;
    msg.lanes = snapshot.lanes;
  }
  const boxJson = JSON.stringify(snapshot.box ?? null);
  if (boxJson !== lastBox) {
    lastBox = boxJson;
    msg.box = snapshot.box;
  }
  if (now - lastVitalsAt >= 5000) {
    msg.vitals = snapshot.vitals;
    lastVitalsAt = now;
  }
  if (!msg.sessions && !msg.removed && !msg.vitals && !msg.lanes && !msg.box) return; // attention alone is derived
  send(msg);
}

function serialiseAll(sessions, keyOf = (s) => s.name) {
  const m = new Map();
  for (const s of sessions) m.set(keyOf(s), JSON.stringify(forWire(s)));
  return m;
}

// --- fleet stamping (F7) ----------------------------------------------------

/** One per-process counter, incremented by every broadcast send(). */
let seq = 0;
export function currentSeq() { return seq; }

/**
 * `builder` (this builder's id) and `seq` on a frame. A frame for one client
 * (its snapshot, hello, greeting) carries the current seq without moving it,
 * so the next broadcast is seq + 1.
 */
export function stamp(msg, s = seq) {
  return { ...msg, builder: config.fleet?.id ?? null, seq: s };
}

/** The first frame on every /ws connection (README §3.4). */
export function helloMessage() {
  return {
    type: 'hello',
    builder: { id: config.fleet?.id ?? null, code: config.fleet?.code ?? null },
    mode: config.mode ?? 'builder',
    version: VERSION,
    apiVersion: 1,
  };
}

/**
 * Apply a browser's `visible` message to a set of local names: `keys` (fkeys,
 * those of other builders dropped) or the legacy `names` (one release).
 * Returns null for a message that carries neither.
 */
export function visibleNames(msg, builderId = config.fleet?.id) {
  if (Array.isArray(msg?.keys)) {
    const out = [];
    for (const k of msg.keys.slice(0, 64)) {
      const name = localKey(k, builderId);
      if (name !== null) out.push(name);
    }
    return new Set(out);
  }
  if (Array.isArray(msg?.names)) return new Set(msg.names.slice(0, 64).filter((n) => typeof n === 'string'));
  return null;
}

export function send(msg) {
  seq += 1;
  const data = JSON.stringify(stamp(msg));
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch { /* client is going away */ }
    }
  }
}

/** An event on the wire: `key` is the fkey of its session (fleet F7). */
export function eventForWire(event) {
  if (!event || typeof event !== 'object') return event;
  return { ...event, key: event.session_name ? state.keyFor(event.session_name) : null };
}

/** Push a hook event straight through, so the log ticks live. */
export function broadcastEvent(event) {
  if (clients.size) send({ type: 'event', event: eventForWire(event) });
}

export function attach(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.visible = new Set();
    // hello first (README §3.4), then the snapshot, then the greeting.
    ws.send(JSON.stringify(stamp(helloMessage())));
    const snap = state.snapshot();
    ws.send(JSON.stringify(stamp({ type: 'snapshot', ...snap, sessions: snap.sessions.map(forWire) })));
    for (const extra of greeting()) ws.send(JSON.stringify(stamp(extra)));
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === 'visible') {
        const names = visibleNames(msg);
        if (names) { ws.visible = names; recomputeVisible(); }
      } else if (msg?.type === 'ping') {
        ws.send(JSON.stringify(stamp({ type: 'pong', at: Date.now() })));
      }
    });
    ws.on('close', () => { clients.delete(ws); recomputeVisible(); });
    ws.on('error', () => { clients.delete(ws); recomputeVisible(); });
    log.info(`ws client connected (${clients.size} total)`);
  });
}

/** Union of what every open browser can see — drives the capture-pane rate. */
function recomputeVisible() {
  state.visibleSessions.clear();
  for (const ws of clients) for (const n of ws.visible ?? []) state.visibleSessions.add(n);
}

const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closing */ }
  }
}, 30000);
heartbeat.unref();

export function clientCount() { return clients.size; }

/** Messages a new client gets right after its snapshot (the Map's model). */
let greeting = () => [];
export function onConnect(fn) { greeting = fn; }
