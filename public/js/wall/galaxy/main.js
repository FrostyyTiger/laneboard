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
// Each level draws at its own pixel ratio (T28, capped by the screen's);
// `?ratio=<n>` pins it (still capped by the screen's), for filming or comparing frames.
// Reduced motion (T11, D5, still.js): no flights, no turn, no drift; the
// overview with every cluster folded and the caption rotating through the
// sites, trouble first.
// No line ties the fleet line to its cluster at the overview (night 3 T16:
// night 2's tether read as a stray hard line, a second beacon); the
// cluster's own glyph and hue carry it.
// A dead feed (night 3 T5, fresh.js): every map frame (and the first
// /api/map answer) stamps the time; 30 s without one, the tag reads
// `STALE <age>` and the next plate says the data is old; a closed socket
// reads `OFFLINE`. `<html data-fresh>` carries the state. The sun says it
// from 3 m (T6, fresh.js `sunLook`): its corona swells once per frame, and
// on old data it shrinks and goes a cold grey.
// Touch (night 3 T7, touch.js): the first touch anywhere stops the tour and
// eases the camera to the overview in TOUCH.fitMs; nothing under that touch
// is activated. `<html data-touch>` says the mode (`easing`, `explore`).
// Then (T8) one finger orbits the galaxy, a pinch or the wheel zooms between
// the overview and a close system, and both coast to rest (touch.js
// createGestures steering camera.js's free pose). Reduced motion: no steering
// (a turning galaxy is the motion D5 refuses); taps and back work (T14).
// A tap on a site (T10, touch.js createTaps, hitTest) flies there and opens
// it: brackets at once, the plate as the camera arrives. The plate is then the
// site's sheet (T11, hud.js sheetCaption: every line, worst first); in an
// open system a tap on a planet shows the planet's sheet where the camera is.
// Back (T13, touch.js backStep): the big control top right (only while
// exploring away from the overview) and a tap on empty sky each go one step
// back, planet → system → overview, the sheet going with its step.
// The words are not sky (night 4 T1, touch.js coverHit): a tap on the plate,
// the fleet line, the tag or the clock opens nothing and steps nothing back,
// but a sheet row (or the trouble word) naming a planet opens that planet.
// The loudest thing is a target (night 4 T2): a tap on the fleet line opens
// what it names, its site first, then the planet in it (its `+N more` opens
// nothing yet); with `fx=beacon` a pillar, foot to tip, is its site's.
// The tour resumes (T14, touch.js IDLE): a minute after the last touch the
// tour takes the page back at its next leg, trouble first (tour.js
// `resume`), the camera flying there from where the finger left it. In
// reduced motion every step is a cut (camera.js `cut`) and the scene fades
// in over CUT.fadeMs (still.js createCutFade): a tapped site, back out, the
// hand-back.
// Effects (§7.C, fx.js): `?fx=lanes,comets,twinkle,beacon,warp` (comma-separated, all off by default);
// `<html data-fx>` lists those on.

import { createPerf } from '../perf.js';
import { TIMING, createTour, timingFor, tourOrder } from '../tour.js';
import { arrivedTimingFor, createCaption, coverOf, STILL_CAPTION_TIMING } from '../caption.js';
import { createFrame } from '../frame.js';
import { LOCK_TIMING, STILL_LOCK_TIMING } from '../lock.js';
import { pxPerMm, screenOf, stepsFor } from '../type.js';
import { FLIGHT, createGalaxyCamera } from './camera.js';
import { createHud } from './hud.js';
import { createGalaxyLock } from './lock.js';
import { createLabels } from './labels.js';
import { fallbackHref, hasWebGL } from './fallback.js';
import { paletteFrom } from './palette.js';
import { budgetStart, budgetStep, createFrameWindow, perfLine, ratioPin } from './budget.js';
import { createGalaxyScene, overviewShot, siteShot } from './scene.js';
import { createCutFade, prefersStill, stillTourTimingFor } from './still.js';
import { critAges, flowComets, parseFx, siteRoutes, workingPlanets } from './fx.js';
import { freeRect, unionBox } from './framing.js';
import { createOverviewFit, siteMarks, widestFar } from './overview.js';
import { freshness, sameFresh, sunLook } from './fresh.js';
import {
  AT_OVERVIEW, TOUCH, backShown, backStep, beamSegments, canGoBack, coverHit, createBack, createGestures, createTaps, createTouch, hitTest, memberPoints,
  orbitLimits, placeOf, tapPoints,
} from './touch.js';

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
    galaxy = createGalaxyScene(canvas, { palette, still: reduced, fx, ratio: ratioPin(q.get('ratio')) });
  } catch (err) {
    toFallback(err);
    return;
  }

  const perf = createPerf();
  Object.assign(perf.stats, { scriptMs: 0, frameMs: 0, level: 0, ratio: galaxy.pixelRatio });
  globalThis.__wallPerf = perf.stats;
  const windows = createFrameWindow();
  let budget = budgetStart();
  const pinned = q.has('quality') ? Number(q.get('quality')) : null;
  if (pinned != null) {
    galaxy.setQuality(pinned);
    Object.assign(perf.stats, { level: galaxy.quality, ratio: galaxy.pixelRatio });
  }
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
      ratio: galaxy.pixelRatio,
    });
    if (!overlay) return;
    const lines = perfLine({
      w, level: galaxy.quality, ratio: galaxy.pixelRatio, info: galaxy.renderer.info, memory: performance.memory,
    });
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
  // A held system is framed in what the caption plate, the fleet block and
  // the tag leave free (T18, framing.js). Each one's box is remembered as the widest
  // seen, so the shot does not move each time a plate comes, goes or changes
  // length; before the first plate it eases over once.
  // The fourth is the fleet line at the warn step (T23: while a crit is held
  // the banner steps down to the next problem, often a warn, whose words
  // frame.js gives no cover); the overview fit reads only the first three.
  const kept = [null, null, null, null];
  const freeBox = () => {
    const now = [caption.cover?.() ?? null, frame.cover?.() ?? null, hud.tagCover(), frame.cover?.() ? null : hud.fleetCover()];
    for (let i = 0; i < kept.length; i++) kept[i] = unionBox(kept[i], now[i]);
    const { W, H } = galaxy.size();
    return freeRect(W, H, kept.filter(Boolean));
  };
  const view = () => ({ fov: galaxy.camera.fov, aspect: galaxy.camera.aspect, free: freeBox() });
  // The overview slides (stands back if it must) until no site or its name
  // is under the words (T19, overview.js). The caption plate is gone at the
  // overview unless the camera stays there all along (reduced motion), where
  // its widest box counts; the fleet block and the tag always do.
  const steps = stepsFor(pxPerMm(screenOf(q, { dpr: globalThis.devicePixelRatio || 1, cssHeight: innerHeight })));
  // The far fleet block counts as wide as it can get (its line's max-width,
  // read once per new box, not per frame), so the overview holds one pose.
  let farSeen = '', farWide = null;
  const farCover = () => {
    const box = kept[1];
    const k = box ? `${box.left},${box.top},${box.right},${box.bottom}` : '';
    if (k !== farSeen) {
      farSeen = k;
      const el = frame.el.fleet, line = el?.querySelector('.wall-fleet-line');
      const st = line ? getComputedStyle(el) : null;
      farWide = widestFar(box, st ? parseFloat(getComputedStyle(line).maxWidth) + parseFloat(st.paddingLeft) + parseFloat(st.paddingRight) : NaN);
    }
    return farWide;
  };
  const overviewFit = (withPlate, easeMs) => createOverviewFit({
    // `kept` is fresh: the camera reads freeBox() each frame before its shot.
    view: () => ({ fov: galaxy.camera.fov, ...galaxy.size(), covers: [withPlate ? kept[0] : null, farCover(), kept[2]].filter(Boolean) }),
    marks: (sites) => siteMarks(sites, steps.site),
    ...(easeMs != null ? { easeMs } : {}),
  });
  const cam = createGalaxyCamera(galaxy, {
    still: reduced, free: freeBox, fitOverview: overviewFit(reduced, reduced ? 0 : null), steer: !park && !reduced,
  });
  const parkedOverview = overviewFit(false, 0);
  // `?pace=wall`: the demo's data at the normal, readable speed (the demo's own
  // speed is for films).
  const fast = demo && q.get('pace') !== 'wall';
  const tour = createTour(cam, { timing: reduced ? stillTourTimingFor(demo) : timingFor(fast) });

  // The words over the canvas: the caption names each system as the camera
  // gets there; the frame (vignette, clock, fleet line, tag) stays put.
  // A parked still gets its caption at once, nothing typing.
  const still = Boolean(park) || reduced;
  const caption = createCaption(document.getElementById('wall-caption'), {
    timing: still ? STILL_CAPTION_TIMING : arrivedTimingFor(fast),
  });
  const frame = createFrame(document.getElementById('wall-frame'));
  // The lock closes on the node the caption's trouble word names (the system
  // when calm) as the camera gets there, a leader joining the two (T9).
  // The names on screen (set once the labels exist): the lock's leader routes round them (T16).
  let shownNames = () => [];
  const lock = createGalaxyLock(document.getElementById('wall-lock'), cam, {
    timing: still ? STILL_LOCK_TIMING : LOCK_TIMING,
    leaderFrom: () => caption.leaderFrom(),
    avoid: () => shownNames().map((n) => n.box),
    size: galaxy.size,
  });
  const hud = createHud({ caption, frame, tour: park ? null : tour, size: galaxy.size, lock });
  let parkedSaid = false;

  // The names, over the scene and under the words: placed after each frame
  // where the camera is now, clear of the caption plate, the fleet line and
  // the lock's brackets (drawn first: the lock's onDraw comes before theirs).
  // The back control's box (T13) while it shows, read again only when it comes or the stage resizes.
  let backCover = () => null;
  const labels = createLabels(document.getElementById('galaxy-labels'), galaxy, {
    steps,
    // The lock's leader too (T16): the names keep off the line, as off the words.
    covers: () => {
      const c = [...hud.covers(), ...lock.covers()], b = backCover();
      return b ? [...c, b] : c;
    },
    held: lock.held,
    flight: cam.flight,
    named: hud.named,
  });
  cam.onDraw(labels.draw);
  shownNames = labels.shown;

  // Where a finger has taken the page (T13): the overview, a system, a planet in it.
  let place = AT_OVERVIEW;
  // Reduced motion (T14): a finger's step is a cut, the scene (canvas and names) fading in.
  const fade = reduced && !park ? createCutFade([canvas, document.getElementById('galaxy-labels')]) : null;
  // The camera is on a cut-to site (reduced motion): leaving it is a cut too.
  const cutAway = () => {
    if (fade && cam.want().cut) fade.cut();
  };
  // Out to the whole galaxy in TOUCH.fitMs: the plate and the lock go.
  const toOverview = () => {
    cutAway();
    cam.fit({ ms: TOUCH.fitMs });
    hud.release();
    place = AT_OVERVIEW;
  };
  // The first touch (T7): the tour stops where it is, the camera eases out to the overview.
  const touch = park ? null : createTouch(document.getElementById('galaxy-stage'), {
    wake: () => {
      tour.stop();
      toOverview();
    },
    // A minute untouched (T14): the sheet goes, the tour flies on from here to its worst site.
    resume: () => {
      cutAway();
      hud.release();
      place = AT_OVERVIEW;
      tour.resume();
    },
  });
  let touchSaid = 'tour';
  // Drag, pinch and the wheel in `explore` (T8): the orbit's far end is the overview, as fitted.
  const gestures = touch && !reduced ? createGestures(document.getElementById('galaxy-stage'), touch, cam, {
    limits: () => orbitLimits(cam.home(), galaxy.world?.sites ?? []),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
  }) : null;
  // A tap on a site (T10): the camera flies there at the tour's zoom and opens
  // it, the brackets close on it at once, its plate comes as the camera does.
  // A tap on empty sky is a step back (T13).
  const stageEl = document.getElementById('galaxy-stage');
  // A site's sheet; the camera flies there unless it already holds it (a step back from a planet).
  const openSite = (id) => {
    const w = cam.want();
    // In reduced motion the tour's site legs leave the camera on the overview: only a cut is there.
    const there = w.kind === 'site' && w.id === id && (!reduced || w.cut);
    if (!there && reduced) {
      cam.cut(id, TIMING.zoom);
      fade?.cut();
    } else if (!there) cam.focus(id, TIMING.zoom);
    // A sheet says what was touched, not the tour's count (T25).
    hud.open({ id, arriveMs: there || reduced ? 0 : FLIGHT.ms });
    place = placeOf(id);
  };
  // A planet in an open system (T11) is asked first: the camera stays, its sheet comes at once.
  const openPlanet = (id, site) => {
    hud.open({ id, arriveMs: 0 });
    place = placeOf(site, id);
  };
  // One step back (T13): a planet's sheet gives way to its system's, a system to the overview.
  const goBack = () => {
    touch?.poke(); // the control's press never reaches the stage: it counts as a touch here
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'site') openSite(next.site);
    else toOverview();
  };
  const backEl = document.getElementById('galaxy-back');
  const back = touch ? createBack(backEl, { back: goBack }) : null;
  if (back) {
    let seen = null, box = null;
    backCover = () => {
      if (!back.shown()) return null;
      const { W, H } = galaxy.size();
      if (seen !== `${W}x${H}`) {
        seen = `${W}x${H}`;
        box = coverOf({ left: backEl.offsetLeft, top: backEl.offsetTop, width: backEl.offsetWidth, height: backEl.offsetHeight });
      }
      return box;
    };
  }
  const taps = touch ? createTaps(touch, {
    pick: (x, y) => {
      const o = stageEl.getBoundingClientRect();
      // The words first (night 4 T1): a finger on the plate, the fleet line, the tag or the clock is
      // never the star under them nor empty sky; a row naming a planet opens it.
      // The fleet line too (night 4 T2): its subject's site first, then the planet in it.
      const rows = hud.targets().map((r) => ({ ...r, box: { left: r.box.left - o.left, top: r.box.top - o.top, right: r.box.right - o.left, bottom: r.box.bottom - o.top } }));
      const worded = coverHit(hud.covers(), rows, galaxy.world?.sites, x - o.left, y - o.top, place.site);
      if (worded) return worded;
      const names = labels.shown();
      // A beacon's pillar is its site's target (night 4 T2).
      const beams = fx.has('beacon') ? beamSegments(galaxy.beams?.(), cam.screenAt) : [];
      return hitTest(memberPoints(galaxy.world?.sites, cam.screenOf, names), x - o.left, y - o.top)
        ?? hitTest(tapPoints(galaxy.world?.sites, cam.screenOf, labels.shown(), beams), x - o.left, y - o.top);
    },
    tap: (hit) => { if (hit?.covered) return; if (hit?.site) openPlanet(hit.id, hit.site); else if (hit) openSite(hit.id); else goBack(); },
  }) : null;

  const tick = (now) => {
    requestAnimationFrame(tick);
    const w = galaxy.world;
    if (!w) return;
    const t0 = performance.now();
    if (touch) {
      const m = touch.mode();
      if (m !== touchSaid) {
        touchSaid = m;
        if (m === 'tour') delete page.dataset.touch;
        else page.dataset.touch = m;
      }
      back?.show(backShown(m, place));
    }
    const at = parked();
    if (at) {
      if (at.open !== parkOpen) galaxy.setOpen(at.id, parkOpen);
      aim(siteShot(at, 0, view()));
    } else if (!park) {
      gestures?.frame(now);
      cam.frame(now);
      if (fx.has('warp')) galaxy.setWarp(cam.flight());
      fade?.frame(now);
    }
    else {
      freeBox();
      aim(parkedOverview(overviewShot(w.sites), w.sites, now));
    }
    galaxy.setSun(sunLook(lastFrameAt == null ? null : Date.now() - lastFrameAt, { still: reduced }));
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
    if (fx.has('comets')) galaxy.setComets(flowComets(model, galaxy.drawn()));
    if (fx.has('twinkle')) galaxy.setTwinkles(workingPlanets(model, galaxy.planets()));
    if (fx.has('beacon')) galaxy.setCritAges(critAges(model, galaxy.world?.byId.keys() ?? []));
    hud.update(model);
    tour.update(model);
    if (!park && touch?.mode() === 'tour') tour.start();
    const at = parked();
    if (at && !parkedSaid) {
      parkedSaid = true;
      const order = tourOrder(model.nodes ?? []);
      const i = order.findIndex((s) => s.id === at.id);
      hud.park({ id: at.id, index: i >= 0 ? i + 1 : null, count: order.length || null });
    }
  };

  // When the last map frame came and whether the socket is open (fresh.js),
  // said again each second so the age grows; written only when it reads otherwise.
  let lastFrameAt = null, open = false, said = null;
  const sayFresh = () => {
    const f = freshness(lastFrameAt, Date.now(), { open });
    if (sameFresh(f, said)) return;
    said = f;
    page.dataset.fresh = f.state;
    hud.fresh(f);
  };
  const frameCame = () => { lastFrameAt = Date.now(); if (said) sayFresh(); };
  // The tag stays empty until the socket first opens or fails (as before T5).
  setInterval(() => { if (said) sayFresh(); }, 1000);

  fetch('/api/map')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (!have && m) { frameCame(); showModel(m); } })
    .catch(() => { /* the socket brings the model when the hub is back */ });

  const openSocket = (backoff) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    let opened = false;
    ws.addEventListener('open', () => { opened = true; open = true; page.dataset.live = '1'; sayFresh(); });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.type === 'map') { frameCame(); showModel(msg.map); }
    });
    ws.addEventListener('close', () => {
      delete page.dataset.live;
      open = false;
      sayFresh();
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
  globalThis.__galaxyTouch = touch;
  globalThis.__galaxyTaps = taps;
  globalThis.__galaxyBack = back;
  globalThis.__galaxyCam = cam;
}

boot();
