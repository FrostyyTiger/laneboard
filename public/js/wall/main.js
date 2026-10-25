// The Wall page (docs/plans/wall/README.md, D1): laneboard's Map as
// something to look at from across a room. Its own page, not an app view:
// it loads the same model the app does (GET /api/map, then the `map` frames
// of /ws, D2) into the shared Map module in ambient mode.
//
// The socket here is deliberately smaller than the app's (core/net.js): the
// Wall reads one frame type and needs no store, so it keeps only the
// reconnect with backoff.

import { createMap } from '../views/map/index.js';
import { pickVariant } from './variants.js';
import { createPerf } from './perf.js';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export function boot() {
  const pick = pickVariant(location.search);
  const page = document.documentElement;
  page.dataset.variant = pick.id;
  if (pick.demo) page.dataset.demo = '1';
  if (pick.asked != null && pick.asked !== pick.id) {
    console.warn(`wall: unknown variant "${pick.asked}", showing ${pick.id}`);
  }

  const map = createMap(document.getElementById('wall-map'), { ambient: true });

  const perf = createPerf();
  globalThis.__wallPerf = perf.stats;
  map.onDraw(() => perf.frame(performance.now()));
  document.addEventListener('visibilitychange', () => perf.pause());

  let have = false;
  const showModel = (model) => {
    if (!model || typeof model !== 'object') return;
    have = true;
    map.update(model);
  };

  fetch('/api/map')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (!have) showModel(m); })
    .catch(() => { /* the socket brings the model when the hub is back */ });

  const openSocket = (backoff) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    let opened = false;
    ws.addEventListener('open', () => { opened = true; page.dataset.live = '1'; });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.type === 'map') showModel(msg.map);
    });
    ws.addEventListener('close', () => {
      delete page.dataset.live;
      // Keep the last model on screen and try again.
      const next = opened ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
      setTimeout(() => openSocket(next), next);
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* closing */ } });
  };
  openSocket(BACKOFF_START_MS);

  // For the console and later tasks (the tour drives it): the map and the pick.
  globalThis.__wall = { map, variant: pick.id, demo: pick.demo };
}

boot();
