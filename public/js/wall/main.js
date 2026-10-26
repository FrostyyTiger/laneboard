// The Wall page (docs/plans/wall/README.md, D1): laneboard's Map as
// something to look at from across a room. Its own page, not an app view:
// it loads the same model the app does (GET /api/map, then the `map` frames
// of /ws, D2) into the shared Map module in ambient mode.
//
// The socket here is deliberately smaller than the app's (core/net.js): the
// Wall reads one frame type and needs no store, so it keeps only the
// reconnect with backoff.

import { createMap } from '../views/map/index.js';
import { pickVariant, mapOptionsFor } from './variants.js';
import { createPerf } from './perf.js';
import { createTour, timingFor } from './tour.js';
import { createCaption, captionLines, captionTimingFor, STILL_CAPTION_TIMING } from './caption.js';
import { createLock, LOCK_TIMING, STILL_LOCK_TIMING } from './lock.js';
import { createGlow } from './glow.js';
import { createFrame } from './frame.js';
import { screenOf } from './type.js';

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

  const stage = document.getElementById('wall-map');
  const aspect = (stage.clientWidth || innerWidth) / (stage.clientHeight || innerHeight);
  // The type steps come from the screen's density (`?mm=<screen height>` when known).
  const screen = screenOf(location.search, { dpr: globalThis.devicePixelRatio || 1, cssHeight: stage.clientHeight || innerHeight });
  // What lies over the map (the caption plate, the far fleet block): the Map
  // keeps its names clear of it, none cut or ghosted under it (T24). Asked
  // every frame, filled in once the plate and the frame exist.
  let covers = () => [];
  const map = createMap(stage, { ...mapOptionsFor(pick.variant, aspect, screen), covers: () => covers() });

  const perf = createPerf();
  globalThis.__wallPerf = perf.stats;
  map.onDraw(() => perf.frame(performance.now()));
  document.addEventListener('visibilitychange', () => perf.pause());

  // The tour is the screensaver (D4): it starts with the first model.
  // A variant may ask for its holds at a scale of their own (`holdZoom`).
  const zoomFor = typeof pick.variant.holdZoom === 'function'
    ? () => pick.variant.holdZoom(map.snapshotScene().fitScale, timingFor(pick.demo).zoom) : null;
  const tour = createTour(map, { timing: timingFor(pick.demo), zoomFor });

  // The caption names each site as the camera gets there, from the newest model.
  const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const caption = createCaption(document.getElementById('wall-caption'), {
    timing: still ? STILL_CAPTION_TIMING : captionTimingFor(pick.demo),
  });
  // The lock closes on the same node as the camera gets there.
  const lock = createLock(document.getElementById('wall-lock'), map, {
    timing: still ? STILL_LOCK_TIMING : LOCK_TIMING,
  });
  // Lights and jobs from the feeds, under the Map, growing with its zoom; and
  // the trouble halos where the variant asks for them.
  const glow = createGlow(document.getElementById('wall-glow'), map, { halos: Boolean(pick.variant.halos) });
  // What stays put while the camera moves: vignette, clock, the fleet's worst line, the tag.
  const frame = createFrame(document.getElementById('wall-frame'));
  covers = () => [caption.cover(), frame.cover()].filter(Boolean);
  let latest = null;
  tour.onLeg((leg) => {
    const ms = still ? 0 : (leg.arriveMs ?? timingFor(pick.demo).flyMs);
    const zoom = leg.zoom ?? timingFor(pick.demo).zoom;
    glow.zoomTo(leg.kind === 'site' ? zoom : 1, ms);
    const node = leg.kind === 'site' ? latest?.nodes?.find((n) => n?.id === leg.id) : null;
    if (node) {
      caption.show(leg, captionLines(node, latest, leg.index, leg.count));
      lock.lockOn({ ...leg, node }, zoom);
    } else {
      caption.hide();
      lock.release();
    }
  });

  let have = false;
  const showModel = (model) => {
    if (!model || typeof model !== 'object') return;
    have = true;
    latest = model;
    map.update(model);
    glow.update(model);
    frame.update(model);
    tour.update(model);
    tour.start();
  };

  fetch('/api/map')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (!have) showModel(m); })
    .catch(() => { /* the socket brings the model when the hub is back */ });

  const openSocket = (backoff) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    let opened = false;
    ws.addEventListener('open', () => { opened = true; page.dataset.live = '1'; frame.live(true); });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.type === 'map') showModel(msg.map);
    });
    ws.addEventListener('close', () => {
      delete page.dataset.live;
      frame.live(false);
      // Keep the last model on screen and try again.
      const next = opened ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
      setTimeout(() => openSocket(next), next);
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* closing */ } });
  };
  openSocket(BACKOFF_START_MS);

  // For the console and later tasks (caption, lock follow `tour.onLeg`).
  globalThis.__wall = { map, tour, caption, lock, glow, frame, variant: pick.id, demo: pick.demo };
}

boot();
