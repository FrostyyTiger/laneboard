// Touch on the galaxy (Wall plan night 3 T7, README §7 Night 3 C1, C6): the
// first touch anywhere on the stage stops the tour and eases the camera back
// to the overview (about 1.5 s); nothing under that first touch is activated,
// so a finger that only meant "wake up" never opens a system by accident.
//
// One state machine with an injected clock: `tour` (the screensaver runs) →
// `easing` (the camera flies out, FIT_MS) → `explore` (the finger has it).
// `touchStep` is pure (test/wall-galaxy-touch.test.mjs); `createTouch` puts
// one `pointerdown` listener on the stage and tells the page through `wake`.
// Later steps (drag, pinch, tap a site, back, the tour resuming) listen with
// `onPointer`, which never hears the waking pointer: not its down, not its
// move, not its up.
//
// Drag and pinch (T8, README §7 Night 3 C2): in `explore` one finger orbits
// the galaxy, two pinch, the wheel zooms; all of it coasts to rest after the
// finger lifts. The camera is an orbit `{ look, yaw, pitch, dist }` round a
// point on the plane (the overview's centre at the widest): `orbitOf`,
// `orbitPose`, `orbitStep`, `zoomStep`, `inertia` and `planeAt` are pure;
// `createGestures` turns pointer events into them and steers the camera
// (camera.js `steer`, which only this sets).
//
// A tap (T10, README §7 Night 3 C3): a finger down and up within TAP.ms and
// the drag's slop, alone and not a palm. `hitTest` finds the site under it in
// screen space (a finger-sized disc round each star, or its shown name;
// `tapPoints` lists them), worst tone first, then the nearest; `createTaps`
// tells the page, which flies there and opens it. In an open system a tap
// on a planet (T11, `memberPoints`, asked before the sites) opens its own
// sheet (hud.js `sheetCaption`).
//
// Back (T13, README §7 Night 3 C4): a big control (`createBack`, BACK.hitPx)
// and a tap on empty sky each go one step back (`backStep`): a planet → its
// system → the overview. The control shows only while exploring away from
// the overview.
//
// The tour resumes (T14, README §7 Night 3 C5): IDLE.ms after the last
// touch (any pointer on the stage, the wheel, a press on the back control:
// `poke()`), with no finger down, `explore` goes back to `tour` and the page
// hears `resume`: the tour starts again at its next leg, trouble first
// (tour.js `resume`), the camera flying there from wherever the finger left
// it. The next touch wakes the page again.
//
// The page itself never scrolls, zooms or shows a menu under a finger: the
// viewport has no user scaling (galaxy.html), the stage `touch-action: none`
// (wall.css), and the context menu (a long press) is refused here.

import { toneOf, worseTone } from './palette.js';

/** How long the camera takes from wherever it is back to the overview on the first touch (ms). */
export const TOUCH = Object.freeze({ fitMs: 1500 });

/**
 * How long the page waits after the last touch before the tour takes it back
 * (T14): one minute (README §7 Night 3 C5; night 1's Q6 and Q13 give 30-60 s
 * for a kiosk's hand-back, the long end because a person reading a sheet
 * from a step away is not touching it).
 */
export const IDLE = Object.freeze({ ms: 60000 });

export const TOUCH_MODES = Object.freeze(['tour', 'easing', 'explore']);

/**
 * The next state after `event` at `now` (ms). `state` is `{ mode, since,
 * last }` (`last`: the last touch, ms); `event` is `'down'` (a pointer went
 * down), `'touch'` (a pointer moved or lifted, the wheel turned, the back
 * control was pressed) or `'tick'` (time passed). `held` says a finger is
 * down now: the tour never takes the page from under it.
 * Returns `{ state, wake, swallow, resume }`: `wake` when this down is the
 * one that stops the tour (the page fits the camera), `swallow` when the
 * pointer must not reach anything under it, `resume` when `idleMs` passed
 * since the last touch in `explore` (T14: the tour takes the page back). Pure.
 */
export function touchStep(state, event, now, { fitMs = TOUCH.fitMs, idleMs = IDLE.ms, held = false } = {}) {
  const s = state && TOUCH_MODES.includes(state.mode) ? state : { mode: 'tour', since: null, last: null };
  // `easing` ends on its own: any event after fitMs finds the camera out.
  let cur = s.mode === 'easing' && now - s.since >= fitMs ? { ...s, mode: 'explore', since: s.since + fitMs } : s;
  if (event === 'down' && cur.mode === 'tour') {
    return { state: { mode: 'easing', since: now, last: now }, wake: true, swallow: true, resume: false };
  }
  if (event === 'down' || event === 'touch') {
    if (cur.mode !== 'tour') cur = { ...cur, last: now };
  } else if (cur.mode === 'explore' && !held && now - (cur.last ?? cur.since) >= idleMs) {
    return { state: { mode: 'tour', since: now, last: cur.last }, wake: false, swallow: false, resume: true };
  }
  return { state: cur, wake: false, swallow: false, resume: false };
}

/**
 * `createTouch(stage, { wake, resume, clock, fitMs, idleMs })` → `{ mode(),
 * onPointer(cb), poke(), stop() }`. `stage` gets the listeners; `wake()` is
 * called once per first touch (the page stops the tour and fits the camera);
 * `resume()` once when the page has gone `idleMs` untouched in `explore`
 * (T14; noticed by `mode()`, which the page asks every frame); `clock` is
 * `performance.now` by default. `onPointer(cb)` hears every pointer event
 * (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) of every
 * pointer but the waking one, with the mode at the time. `poke()` counts as a
 * touch (the back control's press, whose pointers never reach the stage).
 */
export function createTouch(stage, opts = {}) {
  const o = { wake: () => {}, resume: () => {}, clock: () => performance.now(), fitMs: TOUCH.fitMs, idleMs: IDLE.ms, ...opts };
  const timing = () => ({ fitMs: o.fitMs, idleMs: o.idleMs, held: fingers.size > 0 });
  let state = { mode: 'tour', since: null, last: null };
  const waking = new Set(); // the pointers that woke the page: theirs never reach `onPointer`
  const fingers = new Set(); // every pointer down now, waking or not
  const cbs = new Set();
  const tell = (ev) => { for (const cb of cbs) cb(ev, state.mode); };
  const step = (event) => {
    const r = touchStep(state, event, o.clock(), timing());
    state = r.state;
    if (r.resume) o.resume();
    return r;
  };

  const down = (ev) => {
    step('tick'); // a resume that came due is the tour's: this down then wakes it again
    fingers.add(ev.pointerId);
    const r = step('down');
    if (r.swallow) {
      waking.add(ev.pointerId);
      ev.preventDefault?.();
      ev.stopPropagation?.();
    }
    if (r.wake) o.wake();
    if (!r.swallow) tell(ev);
  };
  const rest = (ev) => {
    const lift = ev.type === 'pointerup' || ev.type === 'pointercancel';
    if (lift) fingers.delete(ev.pointerId);
    step('touch'); // the mode it is now, not at the last down
    if (waking.has(ev.pointerId)) {
      if (lift) waking.delete(ev.pointerId);
      ev.preventDefault?.();
      ev.stopPropagation?.();
      return;
    }
    tell(ev);
  };
  const menu = (ev) => ev.preventDefault?.();
  const wheel = () => { step('touch'); };

  const on = [['pointerdown', down], ['pointermove', rest], ['pointerup', rest], ['pointercancel', rest], ['contextmenu', menu], ['wheel', wheel]];
  for (const [type, fn] of on) stage.addEventListener(type, fn);

  return {
    mode: () => step('tick').state.mode,
    onPointer: (cb) => {
      if (typeof cb !== 'function') return () => {};
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    poke: () => { step('touch'); },
    stop: () => { for (const [type, fn] of on) stage.removeEventListener(type, fn); },
  };
}

/**
 * The orbit's feel (T8): `perPx` rad of turn per css px dragged; `pitch` the
 * elevation's range in rad (20° to 83°: never edge-on, never over the top);
 * `near` the closest the camera comes to what it looks at (a close system,
 * scene.js siteShot's nearest); `slopPx` how far a finger moves before it
 * drags (T10's tap is within it, so a tap never turns the galaxy); `tauMs`
 * the coast's time constant after release; `stillMs` a finger held that long
 * before lifting throws nothing; `wheel` log-zoom per wheel px.
 */
export const ORBIT = Object.freeze({
  perPx: 0.005, pitch: Object.freeze([0.35, 1.45]), near: 700, slopPx: 12, tauMs: 250, stillMs: 80, wheel: 0.0015,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The orbit a pose stands in (`{ pos, look }`), pitch clamped to ORBIT's range. Pure. */
export function orbitOf(pose, { pitch = ORBIT.pitch } = {}) {
  const v = { x: pose.pos.x - pose.look.x, y: pose.pos.y - pose.look.y, z: pose.pos.z - pose.look.z };
  const dist = Math.hypot(v.x, v.y, v.z) || 1;
  return {
    look: { ...pose.look },
    yaw: Math.atan2(v.x, v.z),
    pitch: clamp(Math.asin(clamp(v.y / dist, -1, 1)), pitch[0], pitch[1]),
    dist,
  };
}

/** The pose `{ pos, look }` of an orbit. Pure. */
export function orbitPose(o) {
  const c = Math.cos(o.pitch);
  return {
    pos: { x: o.look.x + o.dist * c * Math.sin(o.yaw), y: o.look.y + o.dist * Math.sin(o.pitch), z: o.look.z + o.dist * c * Math.cos(o.yaw) },
    look: { ...o.look },
  };
}

/**
 * The orbit after a drag of `dx`, `dy` css px: right turns the galaxy with
 * the finger (the camera goes the other way), down looks from higher; the
 * pitch stays in ORBIT's range. A drag of 0 px returns the same orbit. Pure.
 */
export function orbitStep(o, dx, dy, { perPx = ORBIT.perPx, pitch = ORBIT.pitch } = {}) {
  if (!dx && !dy) return o;
  return { ...o, yaw: o.yaw - dx * perPx, pitch: clamp(o.pitch + dy * perPx, pitch[0], pitch[1]) };
}

/**
 * The orbit zoomed by `factor` (< 1 closer), its distance kept in
 * `[limits.near, limits.far]`. With `at` (a point on the plane, `planeAt`)
 * the look moves toward it as the camera closes in, so what is under the
 * fingers stays under them; the look stays within `limits.reach` of
 * `limits.centre`, a reach that shrinks to 0 at the widest, so zooming all
 * the way out lands on the overview's own centre. Pure.
 */
export function zoomStep(o, factor, limits, at = null) {
  const { near, far } = limits;
  const dist = clamp(o.dist * (factor > 0 ? factor : 1), near, far);
  let look = o.look;
  if (at && dist < o.dist) {
    const k = 1 - dist / o.dist;
    look = { x: look.x + (at.x - look.x) * k, y: look.y, z: look.z + (at.z - look.z) * k };
  }
  const c = limits.centre ?? { x: 0, y: 0, z: 0 };
  const room = (limits.reach ?? 0) * (far > near ? clamp((far - dist) / (far - near), 0, 1) : 0);
  const off = Math.hypot(look.x - c.x, look.z - c.z);
  if (off > room) {
    const k = off > 0 ? room / off : 0;
    look = { x: c.x + (look.x - c.x) * k, y: look.y, z: c.z + (look.z - c.z) * k };
  }
  if (dist === o.dist && look === o.look) return o;
  return { ...o, dist, look };
}

/** Speeds below these are rest (px/ms for the turn, log-zoom/ms). */
const REST = Object.freeze({ turn: 0.002, zoom: 0.00001 });

/**
 * The coast's speeds `{ x, y, zoom }` (px/ms dragged, log-zoom/ms) `dtMs`
 * later: decaying as exp(-dt/tau), exactly 0 once below rest. Pure.
 */
export function inertia(v, dtMs, { tauMs = ORBIT.tauMs } = {}) {
  const e = Math.exp(-Math.max(0, dtMs) / tauMs);
  const x = v.x * e, y = v.y * e, zoom = v.zoom * e;
  const turning = Math.hypot(x, y) >= REST.turn;
  return { x: turning ? x : 0, y: turning ? y : 0, zoom: Math.abs(zoom) >= REST.zoom ? zoom : 0 };
}

/** Whether a coast has come to rest. */
export const atRest = (v) => !v || (v.x === 0 && v.y === 0 && v.zoom === 0);

/**
 * The point on the plane (y = 0) under css px `x`, `y` of a `W`×`H` frame
 * seen from `pose` with vertical `fov` (deg), or null when that ray never
 * meets it (above the horizon). Pure.
 */
export function planeAt(pose, x, y, W, H, fov) {
  if (!(W > 0 && H > 0)) return null;
  const f = norm({ x: pose.look.x - pose.pos.x, y: pose.look.y - pose.pos.y, z: pose.look.z - pose.pos.z });
  const r = norm({ x: -f.z, y: 0, z: f.x }); // f × up
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const t = Math.tan((fov * Math.PI) / 360);
  const nx = ((2 * x) / W - 1) * t * (W / H), ny = (1 - (2 * y) / H) * t;
  const d = { x: f.x + r.x * nx + u.x * ny, y: f.y + r.y * nx + u.y * ny, z: f.z + r.z * nx + u.z * ny };
  if (!(d.y < 0)) return null;
  const k = -pose.pos.y / d.y;
  return { x: pose.pos.x + d.x * k, y: 0, z: pose.pos.z + d.z * k };
}

function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * The orbit's limits from the overview's shot (scene.js overviewShot, or the
 * fitted one) and the sites: `far` the overview's own distance, `near`
 * ORBIT's, `centre` where the overview looks, `reach` the farthest site from
 * it. Pure.
 */
export function orbitLimits(overview, sites = [], { near = ORBIT.near } = {}) {
  const far = Math.hypot(overview.pos.x - overview.look.x, overview.pos.y - overview.look.y, overview.pos.z - overview.look.z);
  let reach = 0;
  for (const s of sites) if (s?.home) reach = Math.max(reach, Math.hypot(s.home.x - overview.look.x, s.home.z - overview.look.z));
  return { near: Math.min(near, far), far, centre: { ...overview.look }, reach };
}

/**
 * Drag, pinch and the wheel (T8). `createGestures(stage, touch, cam, {
 * limits, view, clock })`: `touch` is createTouch's (its `onPointer`, its
 * mode); `cam` gives `pose()` (where it is) and `steer(pose)` (camera.js,
 * the free pose); `limits()` is `orbitLimits`; `view()` is `{ W, H, fov }`.
 * Only in `explore` does a finger move the camera. Call `frame(now)` once a
 * frame before the camera's: a coast steps there, and the gesture's newest
 * orbit is handed to the camera then (one steer a frame, however many
 * pointer events came). `moved()` (optional) is told each time a gesture
 * starts to move the camera from rest (for what belongs to the overview's
 * pose). Returns `{ frame, busy(), stop() }`.
 */
export function createGestures(stage, touch, cam, opts = {}) {
  const o = { clock: () => performance.now(), ...opts };
  const pointers = new Map(); // id → { x, y }
  let orbit = null; // the orbit being steered, null when the camera is someone else's
  let dirty = false;
  let vel = { x: 0, y: 0, zoom: 0 };
  let zoomAt = null; // where a coasting zoom closes in on
  let drag = null; // { id, sx, sy, moved, t } the one finger turning
  let pinch = null; // { span, t }
  let last = null;
  let far = 0;

  const limits = () => {
    const l = o.limits();
    return { ...l, far: Math.max(l.far, far) };
  };
  const take = () => {
    if (orbit) return orbit;
    const p = cam.pose?.();
    if (!p) return null;
    orbit = orbitOf(p);
    far = orbit.dist; // a fitted overview may stand farther back than the plain one: it stays reachable
    return orbit;
  };
  let still = true; // no gesture has moved the camera since it was last at rest
  const set = (next) => {
    if (next === orbit) return;
    orbit = next;
    dirty = true;
    if (still) { still = false; o.moved?.(); }
  };
  const at = (x, y) => {
    const v = o.view();
    return orbit ? planeAt(orbitPose(orbit), x, y, v.W, v.H, v.fov) : null;
  };
  const span = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const regrip = () => {
    const now = o.clock();
    const was = pinch; // a finger left of a pinch: its lift may still throw the pinch's zoom
    drag = null;
    pinch = null;
    if (pointers.size === 1) {
      const [[id, p]] = [...pointers];
      drag = { id, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false, t: now, afterPinch: Boolean(was) };
    } else if (pointers.size === 2) {
      pinch = { ...span(), t: now };
    }
  };

  const onPointer = (ev, mode) => {
    const now = o.clock();
    if (ev.type === 'pointerdown') {
      if (mode !== 'explore') return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      vel = { x: 0, y: 0, zoom: 0 }; // a finger down catches a coast
      if (!take()) return;
      regrip();
      return;
    }
    if (!pointers.has(ev.pointerId)) return;
    if (ev.type === 'pointermove') {
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!orbit) return;
      if (drag && drag.id === ev.pointerId) {
        if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < ORBIT.slopPx) return;
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y, dt = Math.max(1, now - drag.t);
        if (!drag.moved) {
          // Past the slop: the turn starts from here, so it does not jump by the slop.
          const d = Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy);
          const k = (d - ORBIT.slopPx) / d;
          drag.moved = true;
          set(orbitStep(orbit, dx * k, dy * k));
        } else {
          set(orbitStep(orbit, dx, dy));
          vel = { x: (vel.x + dx / dt) / 2, y: (vel.y + dy / dt) / 2, zoom: 0 };
        }
        Object.assign(drag, { x: ev.clientX, y: ev.clientY, t: now });
      } else if (pinch && pointers.size === 2) {
        const s = span();
        if (s.d > 0 && pinch.d > 0) {
          const f = pinch.d / s.d; // fingers apart: closer
          zoomAt = at(s.x, s.y);
          set(zoomStep(orbit, f, limits(), zoomAt));
          vel = { x: 0, y: 0, zoom: Math.log(f) / Math.max(1, now - pinch.t) };
        }
        pinch = { ...s, t: now };
      }
      return;
    }
    // pointerup / pointercancel
    pointers.delete(ev.pointerId);
    const held = drag?.id === ev.pointerId ? now - drag.t : pinch ? now - pinch.t : Infinity;
    if (ev.type === 'pointercancel' || held > ORBIT.stillMs || (drag && !drag.moved && !drag.afterPinch)) vel = { x: 0, y: 0, zoom: 0 };
    regrip();
  };

  const wheel = (ev) => {
    ev.preventDefault?.(); // never the page's zoom (ctrl+wheel) or scroll
    if (touch.mode() !== 'explore' || !take()) return;
    const px = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
    if (!px) return;
    // An impulse that coasts out to exactly this much zoom: ∫ v e^(-t/τ) dt = v τ.
    zoomAt = at(ev.clientX, ev.clientY);
    vel = { x: 0, y: 0, zoom: vel.zoom + (px * ORBIT.wheel) / ORBIT.tauMs };
  };

  const off = touch.onPointer(onPointer);
  stage.addEventListener('wheel', wheel, { passive: false });

  const frame = (now) => {
    const dt = last == null ? 0 : Math.min(100, now - last);
    last = now;
    const fingers = pointers.size > 0;
    if (orbit && !fingers && !atRest(vel) && dt > 0) {
      let next = orbitStep(orbit, vel.x * dt, vel.y * dt);
      if (vel.zoom) next = zoomStep(next, Math.exp(vel.zoom * dt), limits(), zoomAt);
      set(next);
      vel = inertia(vel, dt);
    }
    if (dirty && orbit) {
      cam.steer(orbitPose(orbit));
      dirty = false;
    }
    // At rest with no finger down, the camera is free for others (a tap's flight, T10; the tour, T14):
    // the next gesture starts from wherever it is then.
    if (!fingers && atRest(vel)) { orbit = null; still = true; }
  };

  return {
    frame,
    busy: () => pointers.size > 0 || !atRest(vel),
    stop: () => { off(); stage.removeEventListener('wheel', wheel, { passive: false }); },
  };
}

/**
 * A tap (T10, README §7 Night 3 C3; night 2's r31-touch note): `ms` the
 * longest a finger may stay down, `slopPx` the farthest it may move (the
 * drag's slop: what turns the galaxy is never a tap); `radiusPx` the finger's
 * reach round a thing's drawn centre, a disc 54 px across (night 1's Q6: 10 mm
 * is 53 css px on the tablet; above night 2's 48 px floor); `palmPx` a contact
 * wider or taller than this is a palm, not a finger.
 */
export const TAP = Object.freeze({ ms: 300, slopPx: ORBIT.slopPx, radiusPx: 27, palmPx: 120 });

/** Louder first: the order a tie is broken in. */
const TAP_TONES = ['crit', 'warn', 'low', 'calm'];
const toneRank = (t) => {
  const i = TAP_TONES.indexOf(t);
  return i < 0 ? TAP_TONES.length : i;
};

/**
 * What a tap at `x`, `y` (css px) hits among `points` (`[{ id, x, y, r,
 * tone, box }]`: a thing's drawn centre and radius on screen, its tone, its
 * shown name's box `{ x, y, w, h }` or null). A point is hit within
 * `max(radius, r)` of its centre, or anywhere on its name. Of several, the
 * worst tone wins, then the nearest (a name under the finger counts as 0
 * away). Returns the point or null. Pure.
 */
export function hitTest(points, x, y, radius = TAP.radiusPx) {
  let best = null, bestD = Infinity;
  for (const p of points ?? []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const b = p.box;
    const onName = b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    // A beacon's pillar (night 4 T2) is the finger's disc swept from its foot to its tip.
    const d = onName ? 0 : Math.min(Math.hypot(x - p.x, y - p.y), p.beam ? segDist(p.beam, x, y) : Infinity);
    if (!onName && d > Math.max(radius, Number(p.r) || 0)) continue;
    const worse = best ? toneRank(p.tone) - toneRank(best.tone) : -1;
    if (worse < 0 || (worse === 0 && d < bestD)) { best = p; bestD = d; }
  }
  return best;
}

/** How far `x`, `y` is from the segment `{ x0, y0, x1, y1 }`, in its px. */
function segDist(g, x, y) {
  const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - g.x0) * dx + (y - g.y0) * dy) / len2)) : 0;
  return Math.hypot(x - (g.x0 + t * dx), y - (g.y0 + t * dy));
}

/**
 * The things a tap can hit now (T10), for hitTest: every site drawn at least
 * half grown (as labels.js names them), at `screenOf(id)` (camera.js: css px
 * and drawn radius; null behind the camera), in its nebula's tone (the worst
 * of the site and what it holds), with its shown name's box from `names`
 * (labels.js `shown()`: `[{ id, box }]`). With `fx=beacon` (night 4 T2,
 * reviews/r51-touch fx-beacon 1) `beams` (beamSegments) gives a site its
 * pillar on screen as `beam`: a finger within the tap's reach of it, foot to
 * tip, is on the site, so the loudest mark at the overview is a target.
 * Sites only, at the overview and in a system alike: a planet is
 * memberPoints'. Pure but for `screenOf`.
 */
export function tapPoints(sites, screenOf, names = [], beams = []) {
  const boxes = new Map();
  for (const n of names ?? []) if (n?.id != null && n.box) boxes.set(n.id, n.box);
  const pillars = new Map();
  for (const g of beams ?? []) if (g?.id != null) pillars.set(g.id, g);
  const out = [];
  for (const s of sites ?? []) {
    if (!s || s.gone || (s.alive ?? 1) < 0.5) continue;
    const sp = screenOf(s.id);
    if (!sp) continue;
    const p = { id: s.id, x: sp.x, y: sp.y, r: sp.r, tone: worseTone(toneOf(s.node), toneOf(s.status)), box: boxes.get(s.id) ?? null };
    const g = pillars.get(s.id);
    if (g) p.beam = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
    out.push(p);
  }
  return out;
}

/**
 * The beacons' pillars on screen (night 4 T2): `beams` the scene's
 * (`[{ id, foot, tip }]` in world units, scene.js `beams()`: the pillars
 * drawn now), each projected by `screenAt` (camera.js) to `{ id, x0, y0, x1,
 * y1 }` in css px, foot then tip. A pillar with an end behind the camera is
 * left out. Pure but for `screenAt`.
 */
export function beamSegments(beams, screenAt) {
  const out = [];
  for (const b of beams ?? []) {
    const a = b?.foot ? screenAt(b.foot) : null;
    const z = b?.tip ? screenAt(b.tip) : null;
    if (a && z) out.push({ id: b.id, x0: a.x, y0: a.y, x1: z.x, y1: z.y });
  }
  return out;
}

/**
 * The things in an open system a tap can hit (T11, README §7 Night 3 C3):
 * every member (planet or dot) of a site at least `minOpen` open, at
 * `screenOf(id)`, in its own tone, with its shown name's box. The page asks
 * these first, so a finger on a planet beside its star opens the planet, not
 * the star. Pure but for `screenOf`.
 */
export function memberPoints(sites, screenOf, names = [], minOpen = 0.5) {
  const boxes = new Map();
  for (const n of names ?? []) if (n?.id != null && n.box) boxes.set(n.id, n.box);
  const out = [];
  for (const s of sites ?? []) {
    if (!s || s.gone || !((s.open ?? 0) >= minOpen)) continue;
    for (const m of s.members ?? []) {
      const sp = m?.id != null ? screenOf(m.id) : null;
      if (!sp) continue;
      out.push({ id: m.id, site: s.id, x: sp.x, y: sp.y, r: sp.r, tone: toneOf(m.node), box: boxes.get(m.id) ?? null });
    }
  }
  return out;
}

/** What a tap on the words over the canvas hits when it opens nothing (T1): not a star, not empty sky. */
export const COVERED = Object.freeze({ covered: true });

const inBox = (b, x, y) => Boolean(b) && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;

/**
 * The words are not transparent to the finger (night 4 T1, reviews/r51-touch
 * galaxy 2): a tap at `x`, `y` (css px on the stage) inside one of `covers`
 * (hud.covers(): the plate, the fleet line, the tag, the clock; `{ left, top,
 * right, bottom }`) is never a star under it nor empty sky (a step back). The
 * first of `rows` (hud.targets(), `[{ id, box, step }]`) under the finger
 * decides: one whose subject is a member of a site in `sites` is that member,
 * `{ id, site }` as memberPoints says it; a `step` row (the fleet line, T2)
 * opens its subject's site first, `{ id: site }`, and the member only while
 * that site is `open` (the one a finger opened), and a `step` row naming a
 * site opens it. Anywhere else on the words (a row with no subject, as the
 * fleet line's `+N more`) it is COVERED. Null off every box: the scene's hit
 * tests decide. Pure.
 */
export function coverHit(covers, rows, sites, x, y, open = null) {
  const row = (rows ?? []).find((r) => inBox(r?.box, x, y));
  if (row) return rowHit(row, sites, open) ?? COVERED;
  return (covers ?? []).some((b) => inBox(b, x, y)) ? COVERED : null;
}

function rowHit(row, sites, open) {
  if (row.id == null) return null;
  for (const s of sites ?? []) {
    if (!s || s.gone) continue;
    if (row.step && s.id === row.id) return { id: s.id };
    if (!(s.members ?? []).some((m) => m?.id === row.id)) continue;
    return row.step && open !== s.id ? { id: s.id } : { id: row.id, site: s.id };
  }
  return null;
}

/**
 * True when a pointer event's contact is palm-sized: `width` or `height`
 * over `palmPx`. A device that does not measure its contacts reports 1
 * (Pointer Events): never a palm.
 */
export const isPalm = (ev, palmPx = TAP.palmPx) => (Number(ev?.width) || 0) > palmPx || (Number(ev?.height) || 0) > palmPx;

/**
 * Taps (T10). `createTaps(touch, { pick, tap, clock })`: `touch` is
 * createTouch's; `pick(x, y)` says what is under a finger (hitTest over the
 * page's points), asked at the `pointerdown` so a thing that drifts under
 * the finger is not lost by the lift; `tap(hit, { x, y })` hears a tap that
 * landed, with `hit` null on empty sky. Only in `explore`; a finger that
 * moves past the slop, stays down past `TAP.ms`, is a palm or has company (a
 * second finger at any time while it is down) is no tap. Returns `{ stop() }`.
 */
export function createTaps(touch, opts = {}) {
  const o = { pick: () => null, tap: () => {}, clock: () => performance.now(), ...opts };
  const downs = new Map(); // id → { x, y, t, hit, ok }
  const onPointer = (ev, mode) => {
    if (ev.type === 'pointerdown') {
      if (mode !== 'explore') return;
      const crowd = downs.size > 0;
      for (const d of downs.values()) d.ok = false; // a second finger: a pinch, nobody's tap
      const ok = !crowd && !isPalm(ev);
      downs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: o.clock(), ok, hit: ok ? o.pick(ev.clientX, ev.clientY) : null });
      return;
    }
    const d = downs.get(ev.pointerId);
    if (!d) return;
    if (ev.type === 'pointermove') {
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) >= TAP.slopPx || isPalm(ev)) d.ok = false;
      return;
    }
    downs.delete(ev.pointerId);
    if (ev.type !== 'pointerup' || !d.ok || mode !== 'explore') return;
    if (o.clock() - d.t > TAP.ms || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) >= TAP.slopPx) return;
    o.tap(d.hit ?? null, { x: d.x, y: d.y });
  };
  const off = touch.onPointer(onPointer);
  return { stop: () => off() };
}

/**
 * Back (T13, README §7 Night 3 C4): `hitPx` the control's smallest side, in
 * css px (night 1's Q6: 15 mm, the size for a main control, is 79 css px on
 * the tablet). wall.css `.galaxy-back` keeps to it.
 */
export const BACK = Object.freeze({ hitPx: 80 });

/** Where a finger has taken the page: the whole galaxy, a site's system, or a planet in it. */
export const AT_OVERVIEW = Object.freeze({ level: 'overview', site: null, planet: null });

/** The place a tapped site (`placeOf(site)`) or planet (`placeOf(site, planet)`) is. Pure. */
export const placeOf = (site = null, planet = null) => (site == null
  ? AT_OVERVIEW
  : Object.freeze({ level: planet == null ? 'site' : 'planet', site, planet: planet ?? null }));

/** Whether there is a step back from `place` (anywhere but the overview). */
export const canGoBack = (place) => place?.level === 'site' || place?.level === 'planet';

/** Whether the back control shows: only while a finger explores (never in the tour) and there is a step back. */
export const backShown = (mode, place) => mode === 'explore' && canGoBack(place);

/**
 * One step back (T13): a planet → its system, a system → the overview; the
 * overview stays. Pure.
 */
export function backStep(place) {
  if (place?.level === 'planet' && place.site != null) return placeOf(place.site);
  return AT_OVERVIEW;
}

/**
 * The back control (T13): `button` (a `<button>` on the stage) shows while
 * `show(true)` and goes with `show(false)`; a press on it calls `back()`.
 * Its pointers never reach the stage, so a press on the control is not also
 * a tap on empty sky (a second step back) nor the start of a drag. Returns
 * `{ show(on), shown(), stop() }`.
 */
export function createBack(button, opts = {}) {
  const o = { back: () => {}, ...opts };
  let on = false;
  const set = (v) => {
    on = Boolean(v);
    button.hidden = !on;
  };
  set(false);
  const keep = (ev) => ev.stopPropagation?.();
  const press = (ev) => {
    ev.preventDefault?.();
    ev.stopPropagation?.();
    if (on) o.back();
  };
  const listen = [['pointerdown', keep], ['pointermove', keep], ['pointerup', keep], ['pointercancel', keep], ['click', press]];
  for (const [type, fn] of listen) button.addEventListener(type, fn);
  return {
    show: (v) => { if (Boolean(v) !== on) set(v); },
    shown: () => on,
    stop: () => { for (const [type, fn] of listen) button.removeEventListener(type, fn); },
  };
}
