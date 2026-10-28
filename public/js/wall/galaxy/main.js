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
// `__wallPerf` also carries `scriptMs`, `frameMs` and `level` (and, from
// perf.js, `worstGapMs` over the last ~10 s and `bootGapMs` apart); `?perf=1`
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
// Moons (night 5 T8, scene.js openMoons): a tapped planet's moons open onto a
// ring round it (a tapped moon keeps its planet's open), named and targets
// while open; another planet, its system or the overview folds them.
// The words are not sky (night 4 T1, touch.js coverHit): a tap on the plate,
// the fleet line, the tag or the clock opens nothing and steps nothing back,
// but a sheet row (or the trouble word) naming a planet opens that planet.
// The loudest thing is a target (night 4 T2): a tap on the fleet line opens
// what it names, its site first, then the planet in it (its `+N more` opens
// nothing yet); with `fx=beacon` a pillar, foot to tip, is its site's.
// Every planet can be picked (night 4 T3, fan.js): a tap whose finger holds
// two or more planets opens none; they fan out round it as rows, and the
// next tap on a row opens that planet (anywhere else closes the fan).
// Back returns to the pose you left (night 4 T4, touch.js createReturn): back
// to the overview flies to where the finger had turned the galaxy before it
// opened a site, not the default fit; a wake and the tour's hand-back fit.
// The tour resumes (T14, touch.js IDLE): a minute after the last touch the
// tour takes the page back at its next leg, trouble first (tour.js
// `resume`), the camera flying there from where the finger left it; a
// show's undo hands it back with the overview instead (c4 §5). In
// reduced motion every step is a cut (camera.js `cut`) and the scene fades
// in over CUT.fadeMs (still.js createCutFade): a tapped site, back out, the
// hand-back.
// Explore looks like a person is driving (night 4 T5, touch.js manualLine):
// under the tag, `MANUAL · TOUR IN 0:40` counts down to the hand-back while a
// finger explores; at the overview the back control is `▶ TOUR`, which hands
// the page back at once (touch.js handBack, the same resume as the minute's).
// `?role=explore` (night 4 T42, touch.js roleOf): a person's screen. The page
// starts in explore at the overview, no tour until `▶ TOUR` (or
// `__galaxyTouch.handBack()`) asks for it, and no minute hands it back after a
// touch: the line reads `MANUAL`. A show moves its camera as any explore's,
// and no minute hands it to the tour after. `?role=tour` (the default) is the page as above.
// One camera director (night 4 T14, director.js createDirector): nothing here
// calls camera.js's moves. The tour flies through `director.as('tour')`, a
// finger (wake, taps, back, gestures) through `finger`, a show command
// through `show`; the director plays the one that has the camera (touch >
// show > tour; a tour leg under the others is refused), every hand-over eased from the pose.
// Effects (§7.C, fx.js): `?fx=beacon,warp,afterglow,activity,sweep` (comma-separated, all off by default);
// `<html data-fx>` lists those on. `sweep` (night 4 T18) turns once per tour cycle while the camera
// rests at the overview in the tour's hands; a finger, a show or a flight stops it.
// Show commands (night 4 T37, show.js createShow; aligned with the cockpit spec 2026-10-27,
// c4-show-canvas.md §2-§5, protocols.md §4): the room's `show` (`fly_to`, `highlight`, `pin`,
// `clear`), `show.undo`, `pin.put`, `pin.remove`; the page answers `show.result` (and `pin.close`).
// A show is a touch that did not come from the owner: the tour stops, `data-wall-state` reads
// `explore`, the camera flies in 320-900 ms, and the tour comes back 60 s after the movement ended
// (touch.js's minute), dropping the highlight and the undo. The owner's finger wins (D70, show.js).
// Highlights are accent brackets with the rest dimmed; pins sit beside their nodes with a `✕`.
// Until the Wall is a paired screen they arrive (night 4 T38, transport.js, a dev adapter) by
// `BroadcastChannel('laneboard.show')` from the same origin, or by `postMessage` from this origin
// and those in `?showOrigins=https://hub.example.invalid,…` (exact origins); each answered on its road.
// `?show=demo` (night 4 T39, showdemo.js) plays a recorded conversation's messages over the large
// demo fleet into the same show, with the tour between: fly to the crit, pin a note, highlight what it breaks.
// The cockpit's handle (screens.md §9, D221): `window.__cockpitView` = `{ page: 'wall', wall: { state,
// tour: { pause, resume }, idle: { hold, restart, remaining }, onState },
// map: { flyTo, fitNodes, camera, setCamera, screenOf, onDraw, emphasis }, show: { state } }`;
// display only, nothing in it sends or changes the fleet.

import { createPerf } from '../perf.js';
import { TIMING, createTour, timingFor, tourOrder } from '../tour.js';
import { arrivedTimingFor, createCaption, coverOf, STILL_CAPTION_TIMING } from '../caption.js';
import { createFrame } from '../frame.js';
import { LOCK_TIMING, STILL_LOCK_TIMING } from '../lock.js';
import { pxPerMm, screenOf, stepsFor } from '../type.js';
import { FIT, FLIGHT, createGalaxyCamera, fitPose, showFlightMs } from './camera.js';
import { createHud } from './hud.js';
import { createGalaxyLock } from './lock.js';
import { createLabels } from './labels.js';
import { createFan } from './fan.js';
import { demoAsked, fallbackHref, hasWebGL } from './fallback.js';
import { applyLift, paletteFrom } from './palette.js';
import { budgetStart, budgetStep, createFrameWindow, perfLine, ratioPin } from './budget.js';
import { createGalaxyScene, overviewShot, siteShot } from './scene.js';
import { createCutFade, prefersStill, stillTourTimingFor } from './still.js';
import { IDLE, OVERVIEW, STAY, createDirector, showNode, showTarget } from './director.js';
import { SHOW, createFingerWatch, createShow } from './show.js';
import { createTransport, showOrigins } from './transport.js';
import { createShowDemo, wantsShowDemo } from './showdemo.js';
import { createSweep, critAges, flowJobs, parseFx, planeAngle, siteNews, sweepStep, workingPlanets } from './fx.js';
import { freeRect, unionBox } from './framing.js';
import { createOverviewFit, siteMarks, widestFar } from './overview.js';
import { freshness, sameFresh, sunLook } from './fresh.js';
import {
  AT_OVERVIEW, COVERED, TOUCH, backControl, backStep, beamSegments, canGoBack, coverHit, createBack, createGestures, createReturn, createTaps, createTouch, hitAll, hitTest, roleOf,
  manualLine, memberPoints, moonsAt, orbitLimits, placeOf, ringHit, showPlace, tapPoints,
} from './touch.js';

const BACKOFF_START_MS = 1000;
/** The fan's rows are never set smaller than this (css px), whatever the room step. */
const FAN_MIN_PX = 18;
const BACKOFF_MAX_MS = 30000;

export function boot() {
  const page = document.documentElement;
  const q = new URLSearchParams(location.search);
  if (demoAsked(q)) page.dataset.demo = '1';
  const role = roleOf(q.get('role'));
  if (role !== 'tour') page.dataset.role = role;
  const canvas = document.getElementById('galaxy');

  // Night 5 A4: calm text a step lighter on a blue-black ground, before the palette reads it.
  applyLift(page);
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
  // A picked planet (night 5 B3, camera.js PICK) is framed clear of the touch controls too: its ring
  // and their names never run under `‹ BACK` or the manual line. `kept` is fresh: freeBox() came first.
  const pickBox = () => {
    const { W, H } = galaxy.size();
    return freeRect(W, H, [...kept.filter(Boolean), ...touchCovers()]);
  };
  const cam = createGalaxyCamera(galaxy, {
    still: reduced, free: freeBox, pickFree: pickBox, fitOverview: overviewFit(reduced, reduced ? 0 : null), steer: !park && !reduced,
  });
  const parkedOverview = overviewFit(false, 0);
  // `?pace=wall`: the demo's data at the normal, readable speed (the demo's own
  // speed is for films).
  const fast = demo && q.get('pace') !== 'wall';
  // One camera director (night 4 T14, director.js): the tour, a finger and a
  // show each get a camera of their own whose moves are requests; only the
  // director moves `cam`, so no two of them ever fight for it.
  let touch = null;
  let tour = null;
  // `▶ TOUR` hands the page back at the tour's next leg, trouble first (night 4 T5); every other
  // hand-back (the idle minute, W4, an undo) starts with the overview (cockpit build B239).
  let nextLeg = false;
  const director = createDirector(cam, {
    still: reduced,
    driver: role === 'explore' && !park ? 'touch' : 'tour', // a person's screen: the finger drives from the start
    held: () => touch != null && touch.mode() !== 'tour', // touch.js's minute hands a finger's page back
    resume: () => undefined, // every hand-back comes through touch.js's resume, which asks the tour itself
  });
  const finger = director.as('touch');
  tour = createTour(director.as('tour'), { timing: reduced ? stillTourTimingFor(demo) : timingFor(fast) });
  // A show's camera move (c4 §2): the tour stops under it (its plate goes, so no word names a site
  // the camera has left), the page explores, and its idle minute counts from the movement's end.
  // The flight takes the Map's 320-900 ms by distance (D68); reduced motion jumps.
  const show = (to, id = null) => {
    const ms = reduced || to.kind === 'stay' || to.cut ? 0 : showFlightMs(cam.pose(), cam.shotFor(to));
    const r = director.show({ id, to, ms });
    stateBy = 'call';
    tour.stop();
    hud.release();
    fan?.hide();
    touch?.explore(performance.now() + ms);
    // A moon's flight opens its planet's ring (T10): the place is its planet's, as after a tap.
    if (touch && to.kind !== 'stay') { place = showPlace(to, place, shownPlace); shownPlace = to.member != null ? place : null; }
    return r;
  };

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
    plateAlpha: (t) => caption.alpha(t), // the leader fades with the plate, first out (night 4 T20)
    avoid: () => shownNames().map((n) => n.box),
    size: galaxy.size,
  });
  // `touring`: the tour runs its legs (and so ends a cleared crit's hold at its overview) only while it drives.
  const hud = createHud({ caption, frame, tour: park ? null : tour, touring: () => director.driver() === 'tour', size: galaxy.size, lock });
  let parkedSaid = false;

  // The names, over the scene and under the words: placed after each frame
  // where the camera is now, clear of the caption plate, the fleet line and
  // the lock's brackets (drawn first: the lock's onDraw comes before theirs).
  // The back control's box (T13) and the manual line's (night 4 T5) while they show, read again
  // only when they come, change words or the stage resizes.
  let touchCovers = () => [];
  // The fan (night 4 T3, fan.js): two or more planets under one finger fan out as rows for the next tap.
  const fan = park ? null : createFan(document.getElementById('galaxy-fan'), {
    screenOf: cam.screenOf, size: galaxy.size, fontPx: () => Math.max(FAN_MIN_PX, steps.room), still: reduced,
    avoid: () => [...hud.covers(), ...touchCovers()], // the rows keep off the words
  });
  // The show's cards (T37): the names keep off them too; set once the show exists.
  let showCovers = () => [];
  const labels = createLabels(document.getElementById('galaxy-labels'), galaxy, {
    steps,
    // The lock's leader too (T16): the names keep off the line, as off the words.
    covers: () => {
      return [...hud.covers(), ...lock.covers(), ...(fan?.covers() ?? []), ...touchCovers(), ...showCovers()];
    },
    held: lock.held,
    flight: cam.flight,
    named: hud.named,
  });
  cam.onDraw(labels.draw);
  if (fan) cam.onDraw(fan.draw);
  shownNames = labels.shown;

  // The show commands (show.js): the camera through the director's `show`, the rest drawn here.
  // A node is known when the galaxy draws it: a site (fly there), a member (fly to its site) or the
  // sun (the overview).
  // A moon too (night 5 T10): it is drawn in its system.
  const nodeAt = (id) => showNode(galaxy.world, id);
  const SUN = { x: 0, y: 0, z: 0 };
  // Where a show flies for a node: its site's shot at the Map's zoom, or the overview for the sun;
  // a moon's frames its planet with the ring open (director.js showTarget, show() below).
  const targetOf = (id, z = SHOW.zoom) => showTarget(galaxy.world, id, z);
  // fitNodes (screens.md §9.2 M2): the ids' stars in sight with `pad` to spare; one system's own
  // nodes fly to that system (it opens), the rest fit their stars (a fitted pose folds the systems).
  const fitTarget = (ids, pad = FIT.padPx) => {
    const ats = ids.map((id) => nodeAt(id)).filter(Boolean);
    if (!ats.length) return null;
    const sites = new Set(ats.map((a) => a.site));
    if (sites.size === 1) return targetOf(ids.find((id) => nodeAt(id)));
    const w = galaxy.world;
    const pts = ats.map((a) => (a.site ? w.byId.get(a.site)?.home : SUN)).filter(Boolean);
    const anySite = w.sites.find((x) => !x.gone);
    const near = anySite ? cam.shotFor({ kind: 'site', id: anySite.id, zoom: FIT.maxZoom }) : null;
    const far = cam.home();
    const dist = (p) => (p ? Math.hypot(p.pos.x - p.look.x, p.pos.y - p.look.y, p.pos.z - p.look.z) : 0);
    const pose = fitPose(pts, cam.pose() ?? far, {
      fov: galaxy.camera.fov, ...galaxy.size(), padPx: pad, minDist: dist(near), maxDist: 3 * dist(far), box: freeBox(),
    });
    return pose ? { kind: 'free', pose } : null;
  };
  // A Promise for a camera move (M1, M2, M4): true once it lands, false when a newer move cut it.
  const landed = () => new Promise((resolve) => {
    const v = cam.version();
    const off = cam.onDraw(() => {
      if (cam.version() !== v) { off(); resolve(false); } else if (!cam.flight()) { off(); resolve(true); }
    });
  });
  const cameraNow = () => {
    const p = cam.pose();
    return p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z, spin: 0, look: { ...p.look }, want: cam.want() } : null;
  };
  // setCamera (M4): back to a saved camera, its site or overview as it was held, else its free pose.
  const cameraTarget = (c) => {
    const w = c?.want;
    if (w?.kind === 'site') return { kind: 'site', id: w.id, zoom: w.zoom };
    if (w?.kind === 'overview') return OVERVIEW;
    return c && [c.x, c.y, c.z].every(Number.isFinite) && c.look ? { kind: 'free', pose: { pos: { x: c.x, y: c.y, z: c.z }, look: { ...c.look } } } : null;
  };
  const setCamera = (c, { flight = true } = {}) => {
    let to = cameraTarget(c);
    if (!to) return Promise.resolve(false);
    if (!flight) to = to.kind === 'site' ? { ...to, cut: true } : { kind: 'free', pose: cam.shotFor(to), cut: true };
    show(to);
    return landed();
  };
  const stage = document.getElementById('galaxy-stage');
  const canvasBox = () => canvas.getBoundingClientRect();
  // In sight: inside the part the words leave free (framing.js), `pad` to spare.
  const inSight = (ids, pad = SHOW.padPx) => {
    const { W, H } = galaxy.size();
    const b = freeBox();
    return ids.every((id) => {
      const at = cam.screenOf(id);
      return at != null && at.x >= b.x0 * W + pad && at.x <= b.x1 * W - pad && at.y >= b.y0 * H + pad && at.y <= b.y1 * H - pad;
    });
  };
  // The owner's finger rule (D70): a capturing ear on the stage; a press on a pin does not count.
  const fingers = park ? null : createFingerWatch(stage, { ignore: (ev) => Boolean(ev.target?.closest?.('[data-pin]')) });
  let wire = null;
  const shows = park ? null : createShow({
    marks: document.getElementById('galaxy-show-marks'),
    veil: document.getElementById('galaxy-show-veil'),
    veilColor: style.getPropertyValue('--bg-canvas').trim() || undefined,
    still: reduced,
    blocked: () => fingers.blocked(),
    send: (msg, reply) => wire?.send(msg, reply),
    screenOf: cam.screenOf,
    size: galaxy.size,
    avoid: () => touchCovers(), // the back control and the manual line: a pin's ✕ never under ▶ TOUR
    // The site names the note keeps off (a name over the plate would be hidden under it).
    names: () => labels.shown().filter((n) => galaxy.world?.byId.has(n.id))
      .map(({ box }) => ({ left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h })),
    ops: {
      camera: cameraNow,
      wall: () => (touch?.mode() === 'tour' ? 'tour' : 'explore'),
      moving: () => director.driver() === 'show' && cam.flight() != null,
      known: (id) => nodeAt(id) != null,
      inSight,
      fly: (node, id) => { const to = targetOf(node); if (to) show(to, id); },
      fit: (nodes, id) => { const to = fitTarget(nodes); if (to) show(to, id); },
      stay: (id) => show(STAY, id),
      // An undo (c4 §5): touring before → the tour at once, with the overview (screens.md §2);
      // else the camera back by a normal flight.
      restore: (saved) => {
        stateBy = 'call';
        if (saved.wall === 'tour') {
          touch?.handBack();
        } else if (saved.camera) setCamera(saved.camera);
      },
    },
  });
  if (shows) {
    cam.onDraw(shows.draw);
    showCovers = shows.covers;
  }
  // The senders' roads (T38, a dev adapter until the room link): a same-origin channel and
  // origin-checked postMessage, both into `receive`, each answered on its road.
  wire = shows ? createTransport({
    receive: shows.receive, win: window, Channel: globalThis.BroadcastChannel ?? null,
    origins: showOrigins(q.get('showOrigins'), location.origin),
  }) : null;
  // `?show=demo` (T39, showdemo.js): a recorded conversation's messages into the same `receive`, over and over.
  const showDemo = shows && wantsShowDemo(q) ? createShowDemo({ receive: shows.receive }) : null;

  // Where a finger has taken the page (T13): the overview, a system, a planet in it.
  let place = AT_OVERVIEW;
  let shownPlace = null; // the place a show's moon flight set (T10): a later show move takes it back
  let moonsAsked = null; // the planet (or moon) whose ring the scene was last asked to open (T8)
  // Reduced motion (T14): a finger's step is a cut, the scene (canvas and names) fading in.
  const fade = reduced && !park ? createCutFade([canvas, document.getElementById('galaxy-labels')]) : null;
  // The camera is on a cut-to site (reduced motion): leaving it is a cut too.
  const cutAway = () => {
    if (fade && cam.want().cut) fade.cut();
  };
  // The pose a finger left the overview in (night 4 T4): back flies there, not to the fit.
  const left = createReturn();
  // Out to the whole galaxy in TOUCH.fitMs (or to the pose it was left in): the plate and the lock go.
  const toOverview = (pose = null) => {
    cutAway();
    fan?.hide();
    if (pose && !reduced) finger.fly(pose, { ms: TOUCH.fitMs }); // reduced motion has no free poses to fly to: a cut to the fit
    else finger.fit({ ms: TOUCH.fitMs });
    hud.release();
    place = AT_OVERVIEW;
  };
  // The first touch (T7): the tour stops where it is, the camera eases out to the overview.
  touch = park ? null : createTouch(document.getElementById('galaxy-stage'), {
    role,
    wake: () => {
      tour.stop();
      left.clear();
      toOverview();
    },
    // A minute untouched (T14): the sheet goes and the tour starts again with the overview, flying
    // out from where the finger left the camera (cockpit spec screens.md §2, §9.1 W4, W5: "the tour
    // starts with the overview"; cockpit build B239 over T14's worst-site-first). `▶ TOUR`: its next leg.
    resume: () => {
      cutAway();
      fan?.hide();
      hud.release();
      left.clear();
      place = AT_OVERVIEW;
      shows?.tourBack(); // the tour clears what the agent drew: the highlight, its note, the undo (c4 §2)
      director.handBack();
      tour.resume({ overview: !nextLeg });
    },
  });
  let touchSaid = 'tour';
  let wallSaid = null; // `data-wall-state` (screens.md §9.1 W1): `tour` or `explore`
  // Who changes the Wall's state next (W6's `by`): `call` (the cockpit's handle, a show command,
  // an undo) or `touch` (`▶ TOUR`); else the frame's guess: `idle` back to the tour, `touch` out of it.
  let stateBy = null;
  const stateCbs = new Set();
  const sayWall = (ws, by) => {
    if (ws === wallSaid) return;
    wallSaid = ws;
    page.dataset.wallState = ws;
    for (const cb of [...stateCbs]) {
      try { cb(ws, { by }); } catch (err) { console.error(err); }
    }
  };
  // Drag, pinch and the wheel in `explore` (T8): the orbit's far end is the overview, as fitted.
  const gestures = touch && !reduced ? createGestures(document.getElementById('galaxy-stage'), touch, finger, {
    limits: () => orbitLimits(cam.home(), galaxy.world?.sites ?? []),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
    moved: () => fan?.hide(), // a turn or a zoom takes the rows' planets from under them
  }) : null;
  // A tap on a site (T10): the camera flies there at the tour's zoom and opens
  // it, the brackets close on it at once, its plate comes as the camera does.
  // A tap on empty sky is a step back (T13).
  const stageEl = stage;
  // A site's sheet; the camera flies there unless it already holds it (a step back from a planet).
  const openSite = (id) => {
    left.leave(place, cam); // off the overview: where the finger had it is where back returns
    const w = cam.want();
    // In reduced motion the tour's site legs leave the camera on the overview: only a cut is there.
    const there = w.kind === 'site' && w.id === id && w.member == null && (!reduced || w.cut);
    if (!there && reduced) {
      finger.cut(id, TIMING.zoom);
      fade?.cut();
    } else if (!there) finger.focus(id, TIMING.zoom);
    // A sheet says what was touched, not the tour's count (T25).
    hud.open({ id, arriveMs: there || reduced ? 0 : FLIGHT.ms });
    place = placeOf(id);
  };
  // A planet in an open system (T11) is asked first: its sheet comes at once, and the camera flies
  // about 45 % closer with the planet left in the free box, its ring and the card on the empty side
  // (night 5 B3, camera.js PICK); a moon's planet stays framed, so a tap on its ring keeps the camera.
  const openPlanet = (id, site) => {
    left.leave(place, cam);
    hud.open({ id, arriveMs: 0 });
    if (reduced) {
      finger.cut(site, TIMING.zoom, { member: id });
      fade?.cut();
    } else finger.focus(site, TIMING.zoom, { member: id });
    place = placeOf(site, id);
  };
  // One step back (T13): a planet's sheet gives way to its system's, a system to the overview.
  const goBack = () => {
    touch?.poke(); // the control's press never reaches the stage: it counts as a touch here
    fan?.hide();
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'site') openSite(next.site);
    else toOverview(left.pose());
  };
  // `▶ TOUR` at the overview (night 4 T5): the tour has the page at once, as after the minute.
  const handBack = () => {
    stateBy = 'touch';
    nextLeg = true;
    try { touch?.handBack(); } finally { nextLeg = false; }
  };
  const backEl = document.getElementById('galaxy-back');
  const back = touch ? createBack(backEl, {
    back: goBack, tour: handBack, glyph: backEl.querySelector('.galaxy-back-glyph'), word: backEl.querySelector('.galaxy-back-word'),
  }) : null;
  // The manual line under the tag (night 4 T5): written only when its words change, once a second.
  const manualEl = document.getElementById('galaxy-manual');
  let manualSaid = null;
  const sayManual = (text) => {
    if (text === manualSaid) return;
    manualSaid = text;
    manualEl.hidden = text == null;
    if (text != null) manualEl.textContent = text;
  };
  if (back) {
    // The manual line's width changes only with its digits' count, so its box is read on those and the stage.
    const boxOf = (el) => coverOf({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
    let seen = null, boxes = [];
    touchCovers = () => {
      const { W, H } = galaxy.size();
      const k = `${back.kind()}|${manualSaid?.length ?? 0}|${W}x${H}`;
      if (seen !== k) {
        seen = k;
        boxes = [back.shown() ? boxOf(backEl) : null, manualSaid != null ? boxOf(manualEl) : null].filter(Boolean);
      }
      return boxes;
    };
  }
  const taps = touch ? createTaps(touch, {
    pick: (x, y) => {
      const o = stageEl.getBoundingClientRect();
      // A fan up (night 4 T3): its rows are the only targets; anywhere else only closes it.
      if (fan?.shown()) return fan.hit(x - o.left, y - o.top) ?? COVERED;
      // The words first (night 4 T1): a finger on the plate, the fleet line, the tag or the clock is
      // never the star under them nor empty sky; a row naming a planet opens it.
      // The fleet line too (night 4 T2): its subject's site first, then the planet in it.
      const rows = hud.targets().map((r) => ({ ...r, box: { left: r.box.left - o.left, top: r.box.top - o.top, right: r.box.right - o.left, bottom: r.box.bottom - o.top } }));
      const worded = coverHit([...hud.covers(), ...touchCovers()], rows, galaxy.world?.sites, x - o.left, y - o.top, place.site);
      if (worded) return worded;
      const names = labels.shown();
      // A beacon's pillar is its site's target (night 4 T2).
      const beams = fx.has('beacon') ? beamSegments(galaxy.beams?.(), cam.screenAt) : [];
      // Two or more planets under the finger (night 4 T3): none is guessed, they fan out for the next tap.
      // A planet with its own folded moons is one planet, and a moon on an open ring wins (T8, ringHit).
      const members = hitAll(memberPoints(galaxy.world?.sites, cam.screenOf, names), x - o.left, y - o.top);
      const one = ringHit(members);
      if (members.length > 1 && !one) return { fan: members, x: x - o.left, y: y - o.top };
      return one ?? hitTest(tapPoints(galaxy.world?.sites, cam.screenOf, labels.shown(), beams), x - o.left, y - o.top);
    },
    tap: (hit) => {
      if (hit?.fan) { fan.show(hit.fan, hit.x, hit.y); return; }
      fan?.hide();
      if (hit?.covered) return; if (hit?.site) openPlanet(hit.id, hit.site); else if (hit) openSite(hit.id); else goBack();
    },
  }) : null;

  // fx=sweep (night 4 T18, fx.js createSweep): once per tour cycle, while the tour holds the camera
  // at rest on the overview, the line turns once in the time its leg has left (SWEEP.turnMs at most;
  // too little time, none that cycle). A finger, a show, a flight or a held site stops it where it is.
  // A parked overview (`?at=overview`, no tour) sweeps every SWEEP.parkedMs. None in still mode.
  const sweep = fx.has('sweep') && !reduced ? createSweep() : null;
  let sweepLeg = null; // the tour's overview leg: `{ cycle, end }` (page time), null on a site leg
  let swept = null; // the cycle (parked: the time) the last sweep started
  if (sweep && !park) tour.onLeg((leg) => { sweepLeg = leg.kind === 'overview' ? { cycle: leg.cycle, end: performance.now() + leg.ms } : null; });
  const runSweep = (now, heldSite) => {
    const step = sweepStep({
      now, running: sweep.running(), swept, leg: sweepLeg, parked: Boolean(park), held: Boolean(heldSite),
      driver: director.driver(), mode: touch?.mode() ?? 'tour', want: cam.want().kind, flight: cam.flight(),
    });
    swept = step.swept; // once per cycle, even when it had too little time
    if (!step.rest) sweep.stop(now);
    else if (step.start) {
      // From the top of the frame (where the camera looks along the plane), turning clockwise.
      const e = galaxy.camera.matrixWorld.elements;
      const sites = galaxy.world.sites.filter((s) => !s.gone).map((s) => ({ id: s.id, angle: planeAngle(s.home) }));
      sweep.start(now, step.start.ms, planeAngle({ x: -e[8], z: -e[10] }), sites);
    }
    galaxy.setSweep(sweep.frame(now));
  };

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
      const ws = m === 'tour' ? 'tour' : 'explore';
      sayWall(ws, stateBy ?? (ws === 'tour' ? 'idle' : 'touch'));
      stateBy = null;
      back?.show(backControl(m, place));
      // A picked planet's moons open onto their ring (night 5 T8), a picked moon's planet's; any other
      // step (its system, the overview, the tour's hand-back) folds them.
      const moonsFor = moonsAt(place);
      if (moonsFor !== moonsAsked) { moonsAsked = moonsFor; galaxy.openMoons(moonsFor); }
      // MANUAL says a person drives: not while a show holds the camera.
      sayManual(director.driver() === 'show' ? null : manualLine(touch.left()));
    }
    const at = parked();
    if (at) {
      if (at.open !== parkOpen) galaxy.setOpen(at.id, parkOpen);
      aim(siteShot(at, 0, view()));
    } else if (!park) {
      director.tick(); // a finger's minute (touch.js's, held) runs out here
      shows?.tick(); // a command waiting for the owner's finger
      showDemo?.tick();
      gestures?.frame(now);
      cam.frame(now);
      if (fx.has('warp')) galaxy.setWarp(cam.flight());
      fade?.frame(now);
    }
    else {
      freeBox();
      aim(parkedOverview(overviewShot(w.sites), w.sites, now));
    }
    if (sweep) runSweep(now, at);
    caption.tick(Date.now()); // the plate's countdown, `m:ss` while held (T53): written only when its second turns
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
    if (fx.has('activity')) {
      galaxy.setActivity(workingPlanets(model, galaxy.planets()));
      galaxy.setJobs(flowJobs(model, galaxy.drawn()));
    }
    if (fx.has('beacon')) galaxy.setCritAges(critAges(model, galaxy.world?.byId.keys() ?? []));
    if (sweep) sweep.model(siteNews(model, galaxy.world?.sites.map((s) => s.id) ?? []));
    hud.update(model);
    tour.update(model);
    if (!park && touch?.mode() === 'tour' && director.driver() === 'tour') tour.start();
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
  globalThis.__galaxyFan = fan;
  globalThis.__galaxyCam = cam;
  globalThis.__galaxyDirector = { ...director, show };
  globalThis.__galaxyShow = shows;
  globalThis.__galaxyWire = wire;
  globalThis.__galaxyShowDemo = showDemo;
  // The cockpit's handle (screens.md §9, D221, D222): the camera and the show state, page px.
  const flyTo = (id, z = SHOW.zoom) => {
    const to = targetOf(id, z);
    if (!to || park) return Promise.resolve(false);
    show(to);
    return landed();
  };
  const fitNodes = (ids, { pad = FIT.padPx } = {}) => {
    const to = park ? null : fitTarget(Array.isArray(ids) ? ids : [], pad);
    if (!to) return Promise.resolve(false);
    show(to);
    return landed();
  };
  // W3: the tour stops mid-flight and the camera holds the frame it had (a cut to where it is; in
  // reduced motion the camera does not fly, so it only stays); `explore` at once. Not while exploring.
  const pauseTour = () => {
    if (!touch || touch.mode() !== 'tour') return;
    const p = reduced ? null : cam.pose();
    show(p ? { kind: 'free', pose: p, cut: true } : STAY);
    sayWall('explore', 'call');
  };
  // W4: the tour at once, starting with the overview; nothing while touring.
  const resumeTourNow = () => {
    if (!touch || touch.mode() === 'tour') return;
    stateBy = 'call';
    touch.handBack();
    if (touch.mode() === 'tour') sayWall('tour', 'call');
  };
  globalThis.__cockpitView = {
    page: 'wall',
    // W1-W6 (screens.md §9.1): the state, the tour, the one idle timer (touch.js's minute), changes.
    wall: park ? null : {
      state: () => page.dataset.wallState ?? null,
      tour: { pause: pauseTour, resume: resumeTourNow },
      idle: {
        hold: () => touch?.hold(),
        restart: (ms = IDLE.ms) => touch?.restart(ms),
        remaining: () => (!touch || touch.holding() ? null : touch.left()),
      },
      onState: (cb) => {
        if (typeof cb !== 'function') return () => {};
        stateCbs.add(cb);
        return () => stateCbs.delete(cb);
      },
    },
    map: {
      flyTo,
      fitNodes,
      camera: cameraNow,
      setCamera: (c, o) => (park ? Promise.resolve(false) : setCamera(c, o)),
      screenOf: (id) => {
        const at = cam.screenOf(id);
        if (!at) return null;
        const b = canvasBox();
        return { x: at.x + b.left, y: at.y + b.top };
      },
      onDraw: cam.onDraw,
      emphasis: (id) => shows?.emphasis(id) ?? 1,
    },
    show: { state: () => shows?.view() ?? null },
  };
}

boot();
