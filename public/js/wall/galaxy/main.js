// The galaxy page (Wall plan night 2 T3, README §5): public/galaxy.html.
// The same model the app and wall.html load (GET /api/map, then the `map`
// frames of /ws with a reconnect and backoff as wall/main.js does, D2),
// drawn by scene.js in WebGL. `window.__wallPerf` counts rendered frames
// (perf.js), so the filmstrip tool reads it as it does on wall.html.
//
// The tour (tour.js, trouble first) drives the 3D camera (camera.js) as it
// drives the Map on wall.html; `?demo=1` is its video speed. The Wall's
// caption and frame (hud.js) sit over the canvas and follow the tour's legs;
// the names (labels.js) sit between them and the canvas.
// `?at=<site>&open=0..1` parks the camera on one system, for stills.
// Speed (T10, budget.js): every frame's script time is timed; windows that
// miss the frame budget step the scene's quality down, roomy ones back up.
// `__wallPerf` also carries `scriptMs`, `frameMs` and `level`; `?perf=1`
// shows them with three's renderer counts; `?quality=<0..2>` pins a level.
// Reduced motion (T11, D5, still.js): no flights, no turn, no drift; the
// overview with every cluster folded and the caption rotating through the
// sites, trouble first.
// Effects (§7.C, fx.js): `?fx=lanes` (comma-separated, all off by default);
// `<html data-fx>` lists those on.

import { createPerf } from '../perf.js';
import { createTour, timingFor, tourOrder } from '../tour.js';
import { createCaption, captionTimingFor, STILL_CAPTION_TIMING } from '../caption.js';
import { createFrame } from '../frame.js';
import { LOCK_TIMING, STILL_LOCK_TIMING } from '../lock.js';
import { pxPerMm, screenOf, stepsFor } from '../type.js';
import { createGalaxyCamera } from './camera.js';
import { createHud } from './hud.js';
import { createGalaxyLock } from './lock.js';
import { createLabels } from './labels.js';
import { fallbackHref, hasWebGL } from './fallback.js';
import { paletteFrom } from './palette.js';
import { budgetStart, budgetStep, createFrameWindow, perfLine } from './budget.js';
import { createGalaxyScene, overviewShot, siteShot } from './scene.js';
import { prefersStill, stillTourTimingFor } from './still.js';
import { parseFx, siteRoutes } from './fx.js';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export function boot() {
  const page = document.documentElement;
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) page.dataset.demo = '1';
  const canvas = document.getElementById('galaxy');

  const style = getComputedStyle(page);
  const palette = paletteFrom((name) => style.getPropertyValue(name));
  const reduced = prefersStill();
  if (reduced) page.dataset.motion = 'still';
  const fx = parseFx(q);
  if (fx.size) page.dataset.fx = [...fx].join(' ');
  // No WebGL here: the 2D page instead (islands with trouble tiles).
  const toFallback = (why) => {
    page.dataset.webgl = '0';
    console.warn('galaxy: no WebGL, going to the 2D page', why);
    location.replace(fallbackHref(location.search));
  };
  if (!hasWebGL(() => document.createElement('canvas'))) { toFallback('no context'); return; }
  let galaxy;
  try {
    galaxy = createGalaxyScene(canvas, { palette, still: reduced, fx });
  } catch (err) {
    toFallback(err);
    return;
  }

  const perf = createPerf();
  Object.assign(perf.stats, { scriptMs: 0, frameMs: 0, level: 0 });
  globalThis.__wallPerf = perf.stats;
  const windows = createFrameWindow();
  let budget = budgetStart();
  const pinned = q.has('quality') ? Number(q.get('quality')) : null;
  if (pinned != null) { galaxy.setQuality(pinned); perf.stats.level = galaxy.quality; }
  document.addEventListener('visibilitychange', () => { perf.pause(); windows.pause(); });
  let overlay = null;
  if (q.get('perf') === '1') {
    overlay = document.createElement('div');
    overlay.className = 'galaxy-perf';
    overlay.setAttribute('aria-hidden', 'true');
    document.getElementById('galaxy-stage').append(overlay);
  }
  // One closed window of frames: the budget's verdict, the numbers, the overlay.
  const measured = (w) => {
    if (pinned == null) {
      budget = budgetStep(budget, w);
      galaxy.setQuality(budget.level);
    }
    Object.assign(perf.stats, {
      scriptMs: Math.round(w.scriptMs * 100) / 100,
      frameMs: Math.round(w.frameMs * 10) / 10,
      level: galaxy.quality,
    });
    if (!overlay) return;
    const lines = perfLine({ w, level: galaxy.quality, info: galaxy.renderer.info, memory: performance.memory });
    overlay.replaceChildren(...lines.map((t) => {
      const row = document.createElement('div');
      row.textContent = t;
      return row;
    }));
  };

  const park = q.get('at');
  const parkOpen = Math.max(0, Math.min(1, Number(q.get('open') ?? 1) || 0));
  const aim = (shot) => {
    galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
    galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  };
  const parked = () => (park ? galaxy.world?.sites.find((s) => s.id === park || String(s.node.label ?? '').toLowerCase() === park.toLowerCase()) : null);

  const demo = page.dataset.demo === '1';
  const cam = createGalaxyCamera(galaxy, { still: reduced });
  const tour = createTour(cam, { timing: reduced ? stillTourTimingFor(demo) : timingFor(demo) });

  // The words over the canvas: the caption names each system as the camera
  // gets there; the frame (vignette, clock, fleet line, tag) stays put.
  // A parked still gets its caption at once, nothing typing.
  const still = Boolean(park) || reduced;
  const caption = createCaption(document.getElementById('wall-caption'), {
    timing: still ? STILL_CAPTION_TIMING : captionTimingFor(demo),
  });
  const frame = createFrame(document.getElementById('wall-frame'));
  // The lock closes on the node the caption's trouble word names (the system
  // when calm) as the camera gets there, a leader joining the two (T9).
  const lock = createGalaxyLock(document.getElementById('wall-lock'), cam, {
    timing: still ? STILL_LOCK_TIMING : LOCK_TIMING,
    leaderFrom: () => caption.leaderFrom(),
  });
  const hud = createHud({ caption, frame, tour: park ? null : tour, lock });
  let parkedSaid = false;

  // The names, over the scene and under the words: placed after each frame
  // where the camera is now, clear of the caption plate, the fleet line and
  // the lock's brackets (drawn first: the lock's onDraw comes before theirs).
  const labels = createLabels(document.getElementById('galaxy-labels'), galaxy, {
    steps: stepsFor(pxPerMm(screenOf(q, { dpr: globalThis.devicePixelRatio || 1, cssHeight: innerHeight }))),
    covers: hud.covers,
    held: lock.held,
  });
  cam.onDraw(labels.draw);

  const tick = (now) => {
    requestAnimationFrame(tick);
    const w = galaxy.world;
    if (!w) return;
    const t0 = performance.now();
    const at = parked();
    if (at) {
      if (at.open !== parkOpen) galaxy.setOpen(at.id, parkOpen);
      aim(siteShot(at, 0));
    } else if (!park) cam.frame(now);
    else aim(overviewShot(w.sites, reduced ? 0 : now));
    galaxy.frame(now);
    cam.drawn();
    const t1 = performance.now();
    perf.frame(t1);
    const closed = windows.frame(now, t1 - t0);
    if (closed) measured(closed);
  };

  let have = false;
  const showModel = (model) => {
    if (!model || typeof model !== 'object') return;
    have = true;
    galaxy.update(model);
    if (fx.has('lanes')) galaxy.setRoutes(siteRoutes(model, galaxy.world?.byId.keys() ?? []));
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
  globalThis.__galaxyHud = { caption, frame, lock, covers: hud.covers };
  globalThis.__galaxyLabels = labels;
}

boot();
