// The dashboard socket, visibility reports and the POST/DELETE helpers. Moved from public/app.js (fleet F1).
import { $ } from './dom.js';
import { store } from './store.js';
import { fitAll } from '../ui/terminal.js';
import { renderAll } from '../ui/render.js';
import { toast } from '../ui/shell.js';
import { pulseMapFor, updateMap } from '../views/map.js';

// ---------------------------------------------------------------- websocket

let ws = null;
let backoff = 500;
let visibleTimer = null;

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    backoff = 500;
    setConnected(true);
    sendVisible();
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'snapshot') {
      store.sessions = new Map(msg.sessions.map((s) => [s.name, s]));
      applyCommon(msg);
      renderAll();
    } else if (msg.type === 'delta') {
      for (const s of msg.sessions || []) store.sessions.set(s.name, s);
      for (const n of msg.removed || []) store.sessions.delete(n);
      applyCommon(msg);
      renderAll(msg.sessions?.map((s) => s.name));
    } else if (msg.type === 'event') {
      // State moves via the next delta; the Map shows the event as a pulse.
      pulseMapFor(msg.event);
    } else if (msg.type === 'map') {
      store.map = msg.map;
      updateMap(msg.map);
    }
  });

  const drop = () => {
    setConnected(false);
    // Keep the last snapshot on screen and retry with backoff.
    backoff = Math.min(backoff * 1.8, 15000);
    setTimeout(connect, backoff);
  };
  ws.addEventListener('close', drop);
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
}

/** Drop the socket; the close handler reconnects with backoff. */
export function reconnect() {
  try { ws?.close(); } catch { /* reconnect handles it */ }
}

export function applyCommon(msg) {
  if (msg.attention) store.attention = msg.attention;
  if (msg.lanes) store.lanes = msg.lanes;
  if (msg.vitals) {
    store.vitals = msg.vitals;
    // The host label next to the brand: whatever the server calls itself.
    const host = $('brand-host');
    if (host && msg.vitals.host && host.textContent !== msg.vitals.host) host.textContent = msg.vitals.host;
  }
  if (msg.box !== undefined) { store.box = msg.box; store.boxDirty = true; }
  if (msg.generatedAt) store.generatedAt = msg.generatedAt;
}

export function setConnected(on) {
  store.connected = on;
  $('offline').hidden = on;
  const c = $('conn');
  c.textContent = on ? 'live' : 'offline';
  c.classList.toggle('down', !on);
}

/**
 * Which cards are on screen, tracked by IntersectionObserver.
 * Measuring each card with getBoundingClientRect on every scroll forced a
 * layout per card per frame; the observer reports the same thing off the main
 * thread and keeps the render path free of reads.
 */
const onScreen = new Set();
const visibility = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const name = e.target.dataset.name;
        if (!name) continue;
        if (e.isIntersecting) onScreen.add(name);
        else onScreen.delete(name);
      }
      scheduleVisible();
    }, { rootMargin: '120px' })
  : null;

export function watchCard(node) {
  if (visibility) visibility.observe(node);
  else onScreen.add(node.dataset.name); // no observer: treat everything as visible
}
export function unwatchCard(node) {
  if (visibility) visibility.unobserve(node);
  onScreen.delete(node.dataset.name);
}

/** Tell the server which cards are on screen, so it captures those panes faster. */
export function sendVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const names = [...onScreen];
  if (store.openSession) names.push(store.openSession);
  for (const n of store.pinned) names.push(n);
  ws.send(JSON.stringify({ type: 'visible', names: [...new Set(names)] }));
}
export function scheduleVisible() {
  clearTimeout(visibleTimer);
  visibleTimer = setTimeout(sendVisible, 250);
}

export async function post(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-laneboard': '1' },
      body: JSON.stringify(body ?? {}),
    });
    if (r.status === 404) throw new Error('endpoint not wired yet');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    toast(`Failed: ${err.message}`);
    return null;
  }
}

export async function del(url) {
  try {
    const r = await fetch(url, { method: 'DELETE', headers: { 'x-laneboard': '1' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    toast(`Failed: ${err.message}`);
    return null;
  }
}

export function sendKeys(name, keys) {
  post(`/api/sessions/${encodeURIComponent(name)}/keys`, { keys });
  toast(`Sent ${keys.join(' ')} → ${name}`);
}

export function sendText(name, text) {
  post(`/api/sessions/${encodeURIComponent(name)}/text`, { text, enter: true });
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('resize', () => { scheduleVisible(); fitAll(); }, { passive: true });
}
