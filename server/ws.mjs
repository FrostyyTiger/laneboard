// WebSocket fan-out: one snapshot per client on connect, then deltas.
import { WebSocketServer } from 'ws';
import { log } from './log.mjs';
import * as state from './state.mjs';

const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

/** The raw ANSI preview is big and only the expanded view needs it. */
export function forWire(session) {
  const { preview, ...rest } = session;
  return rest;
}

/**
 * Diff a snapshot against the previously sent one.
 * Pure, so the merge rule is testable without a browser.
 */
export function diffSessions(prev, sessions) {
  const next = serialiseAll(sessions);
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

function serialiseAll(sessions) {
  const m = new Map();
  for (const s of sessions) m.set(s.name, JSON.stringify(forWire(s)));
  return m;
}

export function send(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch { /* client is going away */ }
    }
  }
}

/** Push a hook event straight through, so the log ticks live. */
export function broadcastEvent(event) {
  if (clients.size) send({ type: 'event', event });
}

export function attach(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.visible = new Set();
    const snap = state.snapshot();
    ws.send(JSON.stringify({ type: 'snapshot', ...snap, sessions: snap.sessions.map(forWire) }));
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === 'visible' && Array.isArray(msg.names)) {
        ws.visible = new Set(msg.names.slice(0, 64));
        recomputeVisible();
      } else if (msg?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', at: Date.now() }));
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
