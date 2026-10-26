// The galaxy page (Wall plan night 2 T3, README §5): public/galaxy.html.
// The same model the app and wall.html load (GET /api/map, then the `map`
// frames of /ws with a reconnect and backoff as wall/main.js does, D2),
// drawn by scene.js in WebGL. `window.__wallPerf` counts rendered frames
// (perf.js), so the filmstrip tool reads it as it does on wall.html.
//
// The tour (tour.js, trouble first) drives the 3D camera (camera.js) as it
// drives the Map on wall.html; `?demo=1` is its video speed. The Wall's
// caption and frame (hud.js) sit over the canvas and follow the tour's legs.
// `?at=<site>&open=0..1` parks the camera on one system, for stills.

import { createPerf } from '../perf.js';
import { createTour, timingFor, tourOrder } from '../tour.js';
import { createCaption, captionTimingFor, STILL_CAPTION_TIMING } from '../caption.js';
import { createFrame } from '../frame.js';
import { createGalaxyCamera } from './camera.js';
import { createHud } from './hud.js';
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

  const cam = createGalaxyCamera(galaxy);
  const tour = createTour(cam, { timing: timingFor(page.dataset.demo === '1') });

  // The words over the canvas: the caption names each system as the camera
  // gets there; the frame (vignette, clock, fleet line, tag) stays put.
  // A parked still gets its caption at once, nothing typing.
  const still = Boolean(park) || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const caption = createCaption(document.getElementById('wall-caption'), {
    timing: still ? STILL_CAPTION_TIMING : captionTimingFor(page.dataset.demo === '1'),
  });
  const frame = createFrame(document.getElementById('wall-frame'));
  const hud = createHud({ caption, frame, tour: park ? null : tour });
  let parkedSaid = false;

  const tick = (now) => {
    requestAnimationFrame(tick);
    const w = galaxy.world;
    if (!w) return;
    const at = parked();
    if (at) {
      if (at.open !== parkOpen) galaxy.setOpen(at.id, parkOpen);
      aim(siteShot(at, 0));
    } else if (!park) cam.frame(now);
    else aim(overviewShot(w.sites, now));
    galaxy.frame(now);
    cam.drawn();
    perf.frame(performance.now());
  };

  let have = false;
  const showModel = (model) => {
    if (!model || typeof model !== 'object') return;
    have = true;
    galaxy.update(model);
    hud.update(model);
    tour.update(model);
    if (!park) tour.start();
    const at = parked();
    if (at && !parkedSaid) {
      parkedSaid = true;
      const order = tourOrder(model.nodes ?? []);
      const i = order.findIndex((s) => s.id === at.id);
      hud.park({ id: at.id, index: i >= 0 ? i + 1 : null, count: order.length || null });
    }
  };

  fetch('/api/map')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (!have) showModel(m); })
    .catch(() => { /* the socket brings the model when the hub is back */ });

  const openSocket = (backoff) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    let opened = false;
    ws.addEventListener('open', () => { opened = true; page.dataset.live = '1'; hud.live(true); });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.type === 'map') showModel(msg.map);
    });
    ws.addEventListener('close', () => {
      delete page.dataset.live;
      hud.live(false);
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
  globalThis.__galaxyTour = tour;
  globalThis.__galaxyHud = { caption, frame, covers: hud.covers };
}

boot();
