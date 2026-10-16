// The dashboard source, visibility reports and the POST/DELETE helpers.
// Moved from public/app.js (fleet F1); sources (fleet F8a, plan §1 2.5).
//
// A source is one WebSocket. Builder mode has one local source (the builder's
// own /ws, first frame `hello`); hub mode has one hub source carrying many
// builders (first frame `fleet`). The kind is taken from the first frame, so
// one page works on both. Every frame goes through the store's ingest(), which
// routes by the source's own identity, never by builder-supplied fields.
import { $ } from './dom.js';
import { isFkey, parseFkey, fkey } from './keys.js';
import { ingest, localBuilderId, setHello, setSourceKind, setSourceStatus, store } from './store.js';
import { act, isDotSegment } from './actions.js';
import { applyHash } from './router.js';
import { fitAll } from '../ui/terminal.js';
import { renderAll } from '../ui/render.js';
import { toast } from '../ui/shell.js';
import { pulseMapFor, updateMap } from '../views/map.js';

export const BACKOFF_START_MS = 500;
export const BACKOFF_FACTOR = 1.8;
export const BACKOFF_MAX_MS = 15000;

/** The next reconnect delay (500 ms, x1.8, 15 s cap; as app.js:91,128 did). */
export function nextBackoff(ms) {
  return Math.min(ms * BACKOFF_FACTOR, BACKOFF_MAX_MS);
}

/**
 * The terminal socket path for a fleet key on a source of `kind`, or null
 * when there is none (callers treat null as "terminal unavailable"). Names
 * '.' and '..' are refused: they would collapse the path segment (SR8 L2).
 */
export function termPath(kind, k) {
  const p = parseFkey(k);
  const seg = (name) => (typeof name === 'string' && name !== '' && !isDotSegment(name) ? encodeURIComponent(name) : null);
  if (kind === 'hub') {
    const n = p ? seg(p.name) : null;
    return n ? `/ws/term/${p.builder}/${n}` : null;
  }
  const n = seg(p ? p.name : k);
  return n ? `/ws/term/${n}` : null;
}

/**
 * Frames held while an 'auto' source has not yet seen `hello` or `fleet`
 * (SR8 L4). Bounded; the overflow is dropped and counted.
 */
export const PREKIND_BUFFER_MAX = 64;

/**
 * One WebSocket source. kind 'local' | 'hub' | 'auto' (decided by the first
 * frame: `hello` -> local, `fleet` -> hub). onMessage(msg, source) gets every
 * parsed object frame; onStatus('connecting'|'open'|'closed', source).
 */
export function createSource(opts = {}) {
  const { url, kind = 'auto' } = opts;
  const onMessage = opts.onMessage ?? (() => {});
  const onStatus = opts.onStatus ?? (() => {});
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket;
  let ws = null;
  let backoff = BACKOFF_START_MS;
  let stopped = false;
  const source = {
    kind, send: null, reconnect: null, close: null, termUrl: null, backoffMs: () => backoff,
    pending: [], droppedBeforeKind: 0,
  };

  function open() {
    if (stopped) return;
    onStatus('connecting', source);
    const sock = new WebSocketImpl(url);
    ws = sock;
    sock.addEventListener('open', () => {
      if (ws !== sock) return;
      backoff = BACKOFF_START_MS;
      onStatus('open', source);
    });
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (source.kind === 'auto') {
        if (msg.type === 'fleet') source.kind = 'hub';
        else if (msg.type === 'hello') source.kind = 'local';
        else if (msg.builder !== undefined && msg.builder !== null) {
          // A frame that claims a builder is not routed until the kind is
          // known: it would otherwise be filed under that claim, or a hub's
          // frame under the local fallback (SR8 L4). A frame that claims no
          // builder (a pre-hello legacy server) goes on to the local fallback.
          if (source.pending.length < PREKIND_BUFFER_MAX) source.pending.push(msg);
          else source.droppedBeforeKind += 1;
          return;
        } else {
          onMessage(msg, source);
          return;
        }
        onMessage(msg, source);
        const held = source.pending;
        source.pending = [];
        for (const m of held) {
          if (ws !== sock) return;
          onMessage(m, source);
        }
        return;
      }
      onMessage(msg, source);
    });
    const drop = () => {
      if (ws !== sock) return;
      ws = null;
      source.pending = [];
      onStatus('closed', source);
      if (stopped) return;
      // Keep the last snapshot on screen and retry with backoff.
      backoff = nextBackoff(backoff);
      schedule(open, backoff);
    };
    sock.addEventListener('close', drop);
    sock.addEventListener('error', () => { try { sock.close(); } catch { /* already closing */ } });
  }

  source.send = (obj) => {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  };
  /** Drop the socket; the close handler reconnects with backoff. */
  source.reconnect = () => { try { ws?.close(); } catch { /* reconnect handles it */ } };
  source.close = () => { stopped = true; try { ws?.close(); } catch { /* closing */ } };
  source.termUrl = (k) => termPath(source.kind, k);
  open();
  return source;
}

// ---------------------------------------------------------------- the page's source

let source = null;
let visibleTimer = null;
let helloLoaded = false;

/** The page's current source (null before connect()). */
export function currentSource() {
  return source;
}

/** The terminal socket path for a key on the page's source. */
export function termUrl(k) {
  return termPath(source?.kind === 'hub' ? 'hub' : 'local', k);
}

export function connect() {
  if (source) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  source = createSource({
    url: `${proto}//${location.host}/ws`,
    onStatus: (status) => {
      setSourceStatus(store, status);
      if (status === 'connecting') return;
      setConnected(status === 'open');
      if (status === 'open') sendVisible();
    },
    onMessage: (msg, src) => {
      if (src.kind === 'hub' && store.source.kind !== 'hub') setSourceKind(store, 'hub');
      handleMessage(msg);
    },
  });
}

function handleMessage(msg) {
  const r = ingest(store, msg, Date.now());
  if (!r) return;
  if (r.type === 'hello') {
    loadHello();
    scheduleVisible();
  } else if (r.type === 'snapshot' || r.type === 'fleet') {
    brandHost();
    renderAll();
    if (r.type === 'snapshot') deepLinkOnce();
  } else if (r.type === 'delta') {
    brandHost();
    renderAll(r.changed ?? undefined);
  } else if (r.type === 'stuck' && r.changed?.length) {
    renderAll(r.changed);
  } else if (r.type === 'event') {
    // State moves via the next delta; the Map shows the event as a pulse.
    pulseMapFor(r.event);
  } else if (r.type === 'map') {
    updateMap(store.map);
  }
}

/**
 * A deep link (`#/board?sel=<fkey>`, `#session=`) opened on a cold load names
 * a session the store does not hold yet: route it again after the first
 * snapshot. Routing only selects; it never sends an action.
 */
let deepLinkDone = false;
function deepLinkOnce() {
  if (deepLinkDone) return;
  deepLinkDone = true;
  const h = location.hash || '';
  if (store.openSession || !(h.includes('sel=') || h.startsWith('#session='))) return;
  applyHash();
}

/** GET /api/v1/hello once per page: capabilities and the live tier table. */
function loadHello() {
  if (helloLoaded || store.source.kind === 'hub') return;
  helloLoaded = true;
  Promise.resolve()
    .then(() => fetch('/api/v1/hello'))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((h) => { if (h) setHello(store, h); })
    .catch(() => { helloLoaded = false; });
}

/** The host label next to the brand: whatever the server calls itself. */
function brandHost() {
  const host = $('brand-host');
  const name = store.vitals?.host;
  if (host && name && host.textContent !== name) host.textContent = name;
}

/** Drop the socket; the close handler reconnects with backoff. */
export function reconnect() {
  source?.reconnect();
}

export function setConnected(on) {
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
const cardKey = (node) => node.dataset.key || node.dataset.name;
const visibility = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const k = cardKey(e.target);
        if (!k) continue;
        if (e.isIntersecting) onScreen.add(k);
        else onScreen.delete(k);
      }
      scheduleVisible();
    }, { rootMargin: '120px' })
  : null;

export function watchCard(node) {
  if (visibility) visibility.observe(node);
  else onScreen.add(cardKey(node)); // no observer: treat everything as visible
}
export function unwatchCard(node) {
  if (visibility) visibility.unobserve(node);
  onScreen.delete(cardKey(node));
}

/**
 * The `visible` message for a list of UI keys: fleet keys (`keys`) once the
 * source has named its builder, else the legacy `names` (one release).
 */
export function visibleMessage(list, s) {
  s ||= store;
  const uniq = [...new Set(list.filter((k) => typeof k === 'string' && k))];
  if (s.source.kind === 'hub') return { type: 'visible', keys: uniq.filter(isFkey) };
  if (!s.source.id) return { type: 'visible', names: uniq.filter((k) => !isFkey(k)) };
  const id = localBuilderId(s);
  return { type: 'visible', keys: uniq.map((k) => (isFkey(k) ? k : fkey(id, k))) };
}

/** Tell the server which cards are on screen, so it captures those panes faster. */
export function sendVisible() {
  if (!source) return;
  const list = [...onScreen];
  if (store.openSession) list.push(store.openSession);
  for (const n of store.pinned) list.push(n);
  source.send(visibleMessage(list));
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

function failed(r) {
  if (r && r.ok === false) toast(`Failed: ${r.error}`);
  else if (r && r.ok === 'unknown') toast('Sent, outcome unknown');
}

export function sendKeys(name, keys) {
  act(name, 'send-keys', { keys }).then(failed);
  toast(`Sent ${keys.join(' ')} → ${name}`);
}

export function sendText(name, text) {
  act(name, 'send-text', { text, enter: true }).then(failed);
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('resize', () => { scheduleVisible(); fitAll(); }, { passive: true });
}
