// The galaxy page (Wall plan night 2 T3, README §5): public/galaxy.html.
// The same model the app and wall.html load (GET /api/map, then the `map`
// frames of /ws with a reconnect and backoff as wall/main.js does, D2),
// drawn by scene.js in WebGL. `window.__wallPerf` counts rendered frames
// (perf.js), so the filmstrip tool reads it as it does on wall.html.
//
// No tour yet (T4 brings the camera): the camera holds the overview and
// turns slowly. `?at=<site>&open=0..1` parks it on one system, for stills.

import { createPerf } from '../perf.js';
import { paletteFrom } from './palette.js';
import { createGalaxyScene, overviewShot, siteShot } from './scene.js';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export function boot() {
  const page = document.documentElement;
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) page.dataset.demo = '1';
  const canvas = document.getElementById('galaxy');

  const style = getComputedStyle(page);
  const palette = paletteFrom((name) => style.getPropertyValue(name));
  let galaxy;
  try {
    galaxy = createGalaxyScene(canvas, { palette });
  } catch (err) {
    // No WebGL here (T7 sends such a browser to the 2D page).
    page.dataset.webgl = '0';
    console.warn('galaxy: no WebGL', err);
    return;
  }

  const perf = createPerf();
  globalThis.__wallPerf = perf.stats;
  document.addEventListener('visibilitychange', () => perf.pause());

  const park = q.get('at');
  const parkOpen = Math.max(0, Math.min(1, Number(q.get('open') ?? 1) || 0));
  const aim = (shot) => {
    galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
    galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  };
  const parked = () => (park ? galaxy.world?.sites.find((s) => s.id === park || String(s.node.label ?? '').toLowerCase() === park.toLowerCase()) : null);

  const tick = (now) => {
    requestAnimationFrame(tick);
    const w = galaxy.world;
    if (!w) return;
    const at = parked();
    if (at) {
      if (at.open !== parkOpen) galaxy.setOpen(at.id, parkOpen);
      aim(siteShot(at, 0));
    } else aim(overviewShot(w.sites, now));
    galaxy.frame(now);
    perf.frame(performance.now());
  };

  let have = false;
  const showModel = (model) => {
    if (!model || typeof model !== 'object') return;
    have = true;
    galaxy.update(model);
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
      // Keep the last galaxy on screen and try again.
      const next = opened ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
      setTimeout(() => openSocket(next), next);
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* closing */ } });
  };
  openSocket(BACKOFF_START_MS);
  requestAnimationFrame(tick);

  // For the console and later tasks.
  globalThis.__galaxy = galaxy;
}

boot();
