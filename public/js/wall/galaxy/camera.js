// The galaxy's camera (Wall plan night 2 T4, README §5): a Map look-alike, so
// the Wall's tour (tour.js `createTour`) and later its lock and glow drive the
// 3D camera as they drive the Map: `focus(id, zoom)`, `fit()`, `onDraw(cb)`,
// `screenOf(id)` (with the drawn radius, for the lock: galaxy/lock.js),
// `snapshotScene()`.
//
// One camera with intent: a flight eases from wherever the camera is to the
// shot it wants, rising over a long hop so it never skims the plane or the
// sun, and keeps the star it left or the one it flies to in frame (night 3
// T1: it steps back rather than look at empty sky); the system it flies to
// opens once the camera is most of the way there (layout.js OPEN_MS), the one it leaves folds while it goes; held, the camera
// drifts slowly round the system so the depth reads (scene.js `siteShot`).
//
// The overview is one fixed pose (T24); only a held system drifts.
//
// `still` (reduced motion, T11, still.js): the camera never leaves the
// overview; `focus`/`fit` only say where the tour is (the
// caption and lock follow it), and every system stays folded.
//
// `flightPose` and `openStep` are pure (test/wall-galaxy-camera.test.mjs);
// `createGalaxyCamera` is the small part that moves the scene's camera.

import * as THREE from '../../../vendor/three/three.module.js';
import { ease, OPEN_MS } from './layout.js';
import { overviewShot, siteShot, SIZE, FOV } from './scene.js';
import { TIMING } from '../tour.js';
import { blendRect, ndcOf, standBack } from './framing.js';
import { sizeOf } from './stage.js';

/**
 * A flight takes the tour's `flyMs` (tour.js TIMING, 2250 ms); the target system starts opening at
 * `openAt` of it (so it is open just after the camera arrives) and a long
 * hop rises by `lift` of its length at the middle, at most `maxLift`.
 */
export const FLIGHT = Object.freeze({ ms: 2250, openAt: 0.45, lift: 0.18, maxLift: 900 });

/** Where the sun is: the overview's star. */
const SUN = Object.freeze({ x: 0, y: 0, z: 0 });

/** How quickly a held shot follows a change of the free box (ms, exponential). */
export const FREE_EASE_MS = 450;

/** The longest frame step the opening follows (ms). */
const MAX_STEP_MS = 500;

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * How much of the frame's half-width and half-height an end of a flight must
 * stay inside (night 3 T1): 0.85 keeps it clear of the very edge.
 */
export const FLIGHT_KEEP = 0.85;

/** How many points of a flight `flightPose` samples to size its step back. */
const FLIGHT_SAMPLES = 24;

/** The step back's shape over a flight: 0 at both ends, 1 in the middle, smooth. */
const swell = (k) => Math.sin(Math.PI * Math.min(1, Math.max(0, k))) ** 2;

/**
 * How far a flight stays from what it does not fly to (night 3 T2,
 * r54-film-ui 3): `reach` times a third system's reach from its star, and
 * `sun` world units from the sun (half again its halo's radius, so the
 * halo never fills the frame).
 */
export const FLIGHT_CLEAR = Object.freeze({ reach: 1.5, sun: SIZE.sunHalo * 0.75 });

/** The arc between shots `a` and `b` at `k`, raised by `extra` more at its middle. */
function arcPose(a, b, k, flight, extra = 0) {
  const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
  const rise = k > 0 && k < 1 ? (Math.min(flight.maxLift, dist * flight.lift) + extra) * Math.sin(Math.PI * k) : 0;
  return {
    pos: { x: lerp(a.pos.x, b.pos.x, k), y: lerp(a.pos.y, b.pos.y, k) + rise, z: lerp(a.pos.z, b.pos.z, k) },
    look: { x: lerp(a.look.x, b.look.x, k), y: lerp(a.look.y, b.look.y, k), z: lerp(a.look.z, b.look.z, k) },
  };
}

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/**
 * How much higher than `p` the camera must be to stand `r` from each of
 * `avoid` (`[{ x, y, z, r }]`, world): 0 when it already does. Rising is
 * the way out because the stars lie on the plane and the camera above it.
 */
function liftFrom(p, avoid) {
  let need = 0;
  for (const o of avoid) {
    const across = Math.hypot(p.x - o.x, p.z - o.z);
    if (across < o.r) need = Math.max(need, o.y + Math.sqrt(o.r * o.r - across * across) - p.y);
  }
  return need;
}

/**
 * Where the camera is `k` (0..1, already eased) of the way from shot `a` to
 * shot `b` (`{ pos, look }`): a straight line for the look-at, from the
 * start's target to the destination, and an arc for the position that rises
 * in the middle with the hop's length. With a `frame` (`{ fov, aspect,
 * ends: [from, to], avoid }`):
 * - `avoid` (`[{ x, y, z, r }]`: the stars of the other systems and the
 *   sun, each with the room it wants, FLIGHT_CLEAR; night 3 T2) bends the
 *   arc up just enough that no step comes nearer than `r` to one, nor
 *   nearer than either shot itself already stands (an end is where it is);
 * - `ends` (the two stars, night 3 T1, r59-dreamer 1) steps the camera back
 *   along its line of sight just far enough that one of the two ends stays
 *   within FLIGHT_KEEP of the frame, so no flight frame is empty sky.
 * At either end both are 0, so the ends do not change. Pure.
 */
export function flightPose(a, b, k, flight = FLIGHT, frame = null) {
  const avoid = (frame?.avoid ?? [])
    .filter((o) => o && [o.x, o.y, o.z, o.r].every(Number.isFinite))
    .map((o) => ({ ...o, r: Math.min(o.r, gap(a.pos, o), gap(b.pos, o)) }))
    .filter((o) => o.r > 0);
  // One extra rise over the whole flight (the arc's own sin shape, so the
  // path stays one smooth curve) that covers the need at every sample.
  let extra = 0;
  if (avoid.length) {
    for (let i = 1; i < FLIGHT_SAMPLES; i++) {
      const j = i / FLIGHT_SAMPLES;
      extra = Math.max(extra, liftFrom(arcPose(a, b, j, flight).pos, avoid) / Math.sin(Math.PI * j));
    }
    extra *= 1.1; // a need that peaks between two samples stays under the curve
  }
  const pose = arcPose(a, b, k, flight, extra);
  const ends = frame?.ends?.filter(Boolean) ?? [];
  if (!ends.length) return pose;
  // How far back each step of the flight needs to be (the base pose, sampled),
  // then one smooth swell over the whole flight that covers every one of
  // them: a step back that follows the need frame by frame would kink where
  // the nearer end changes and jolt the camera.
  const fov = frame.fov ?? FOV, aspect = frame.aspect ?? 16 / 9, keep = frame.keep ?? FLIGHT_KEEP;
  const need = (pz) => Math.min(...ends.map((p) => standBack(pz, p, fov, aspect, keep)));
  let scale = 0;
  for (let i = 1; i < FLIGHT_SAMPLES; i++) {
    const j = i / FLIGHT_SAMPLES;
    scale = Math.max(scale, need(arcPose(a, b, j, flight, extra)) / swell(j));
  }
  // 10 % over the samples, so a need that peaks between two of them stays under the swell.
  const back = Math.max(scale * 1.1 * swell(k), need(pose));
  if (!(back > 0)) return pose;
  const f = { x: pose.look.x - pose.pos.x, y: pose.look.y - pose.pos.y, z: pose.look.z - pose.pos.z };
  const l = Math.hypot(f.x, f.y, f.z) || 1;
  pose.pos = { x: pose.pos.x - (f.x / l) * back, y: pose.pos.y - (f.y / l) * back, z: pose.pos.z - (f.z / l) * back };
  return pose;
}

/** A system's opening `open` moved `dtMs` toward `want` (0 or 1) at OPEN_MS a full turn. Pure. */
export function openStep(open, want, dtMs, openMs) {
  const step = Math.max(0, dtMs) / (openMs > 0 ? openMs : OPEN_MS);
  return want > open ? Math.min(want, open + step) : Math.max(want, open - step);
}

/**
 * The shot for a site at `zoom` (the tour's zoom is siteShot's distance), `heldMs` into its drift;
 * with a `view` (siteShot's, T18) the star sits in the free box at that zoom.
 */
export function zoomedSiteShot(site, heldMs, zoom, view = null) {
  const z = Number.isFinite(zoom) && zoom > 0 ? TIMING.zoom / zoom : 1;
  if (view?.free) return siteShot(site, heldMs, { ...view, scale: z });
  const s = siteShot(site, heldMs);
  if (z === 1) return s;
  return {
    pos: { x: s.look.x + (s.pos.x - s.look.x) * z, y: s.look.y + (s.pos.y - s.look.y) * z, z: s.look.z + (s.pos.z - s.look.z) * z },
    look: s.look,
  };
}

/**
 * The camera over `galaxy` (scene.js `createGalaxyScene`: `world`,
 * `setOpen`, `camera`). Call `frame(now)` before the scene draws and
 * `drawn()` after it. `flight` is injectable for tests; `still` holds the
 * overview (above). `free()` (T18) gives the box of the frame the words
 * leave free (framing.js `freeRect`, fractions) or null for all of it; a
 * held system is framed in it, the box eased over FREE_EASE_MS so a plate
 * that comes or goes moves the camera, never cuts it. `fitOverview(shot,
 * sites, now)` (T19, overview.js createOverviewFit) slides the overview so
 * no site sits under the words; without it the overview is as scene.js gives it.
 */
export function createGalaxyCamera(galaxy, { flight = FLIGHT, still = false, free = null, fitOverview = null } = {}) {
  // What the camera wants: the overview or one site, since `t0` (ms).
  let want = { kind: 'overview', t0: null };
  let from = null; // the pose the current flight left from
  let fromEnd = null; // the star the current flight keeps in frame as it leaves (T1)
  let fromId = null; // the site the current flight leaves, if it left one (T2)
  let pose = null; // where the camera is now
  let last = null;
  let version = 0;
  const drawCbs = new Set();
  let freeNow = null; // the free box the shot uses, eased toward `free()`

  const sites = () => galaxy.world?.sites ?? [];
  const siteOf = (id) => galaxy.world?.byId.get(id) ?? null;

  // The overview, fitted clear of the words when given a fitter (T19, overview.js).
  const overview = (now) => (fitOverview ? fitOverview(overviewShot(sites()), sites(), now) : overviewShot(sites()));
  const target = (now) => {
    if (still) return overview(now);
    if (want.kind === 'site') {
      const s = siteOf(want.id);
      if (s) {
        const view = freeNow ? { fov: galaxy.camera.fov, aspect: galaxy.camera.aspect, free: freeNow } : null;
        return zoomedSiteShot(s, Math.max(0, now - want.t0 - flight.ms), want.zoom, view);
      }
    }
    return overview(now);
  };

  // The star a shot is about: the held site's, or the sun for the overview.
  const starOf = (w) => (w.kind === 'site' ? siteOf(w.id)?.home ?? null : SUN);
  const view = () => ({ fov: galaxy.camera.fov, aspect: galaxy.camera.aspect });
  const shows = (shot, p) => {
    const n = p && shot ? ndcOf(shot, p, galaxy.camera.fov, galaxy.camera.aspect) : null;
    return n != null && Math.abs(n.x) <= FLIGHT_KEEP && Math.abs(n.y) <= FLIGHT_KEEP;
  };
  // An end of a flight the camera already shows (so the flight starts and
  // lands where it is), else the middle of its frame.
  const endFor = (shot, stars) => stars.find((p) => shows(shot, p)) ?? shot?.look ?? null;

  // What a flight keeps clear of (T2): the sun and every system's star but
  // the one it flies to and the one it leaves (its start is where it is).
  const avoid = () => {
    const out = [{ ...SUN, r: FLIGHT_CLEAR.sun }];
    for (const s of sites()) {
      if (s.gone || (want.kind === 'site' && s.id === want.id) || s.id === fromId) continue;
      out.push({ ...s.home, r: FLIGHT_CLEAR.reach * (s.reach || 0) });
    }
    return out;
  };

  const go = (next) => {
    from = still ? null : pose;
    fromEnd = from ? endFor(from, [starOf(want), fromEnd]) : null;
    fromId = want.kind === 'site' ? want.id : null;
    want = { ...next, t0: null };
    version += 1;
  };

  const frame = (now) => {
    if (galaxy.world == null) return null;
    if (want.t0 == null) want.t0 = now;
    // Slow frames (a small tablet under load) still open a system on time;
    // only a long gap (a hidden tab) is cut short.
    const dt = last == null ? 0 : Math.min(MAX_STEP_MS, now - last);
    last = now;
    const box = typeof free === 'function' ? free() : null;
    freeNow = box ? blendRect(freeNow, box, freeNow ? 1 - Math.exp(-dt / FREE_EASE_MS) : 1) : null;
    const k = from ? ease((now - want.t0) / flight.ms) : 1;
    const to = target(now);
    pose = from && k < 1 ? flightPose(from, to, k, flight, { ...view(), ends: [fromEnd, endFor(to, [starOf(want)])], avoid: avoid() }) : to;
    if (k >= 1) from = null;

    // The held system opens once the camera is most of the way there; the rest fold.
    const opening = !still && want.kind === 'site' && now - want.t0 >= flight.ms * flight.openAt ? want.id : null;
    for (const s of sites()) {
      const o = openStep(s.open, s.id === opening ? 1 : 0, dt);
      if (o !== s.open) galaxy.setOpen(s.id, o);
    }

    // The system it flies to or holds is the subject: the scene never fades it for being near (T2).
    galaxy.setHeld?.(want.kind === 'site' && !still ? want.id : null);
    galaxy.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    galaxy.camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
    return pose;
  };

  const v = new THREE.Vector3();
  /**
   * Where a site or a node in one is drawn now: canvas css px and `r`, its
   * drawn radius in css px (the world radius over its distance, so it grows
   * as the camera closes in). Null when behind the camera or unknown.
   */
  const screenOf = (id) => {
    const w = galaxy.world;
    if (!w) return null;
    const s = w.byId.get(id);
    let p = s?.home ?? null;
    let radius = SIZE.star * (s?.alive ?? 1);
    if (!p) {
      for (const site of w.sites) {
        const m = site.members.find((x) => x.id === id);
        if (m) {
          p = m.mesh.position;
          // Its sphere's radius times its scale: a member in trouble is drawn at the planet size (scene.js memberRadius).
          radius = (m.mesh.geometry?.parameters?.radius ?? (m.planet ? SIZE.planet : SIZE.dot)) * (m.mesh.scale?.x ?? 1);
          break;
        }
      }
    }
    if (!p) return null;
    const cam = galaxy.camera;
    cam.updateMatrixWorld();
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (depth <= 0) return null; // behind the camera
    v.applyMatrix4(cam.projectionMatrix);
    const { W, H } = sizeOf(galaxy);
    const unit = H / (2 * Math.tan((cam.fov * Math.PI) / 360) * depth);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, r: radius * unit };
  };

  return {
    focus: (id, zoom) => { if (siteOf(id) || galaxy.world == null) go({ kind: 'site', id, zoom }); },
    fit: () => go({ kind: 'overview' }),
    frame,
    drawn: () => { for (const cb of drawCbs) cb(); },
    onDraw: (cb) => {
      if (typeof cb !== 'function') return () => {};
      drawCbs.add(cb);
      return () => drawCbs.delete(cb);
    },
    screenOf,
    // The Map's snapshot, as much of it as a 3D camera has: a version that
    // changes with every move; no 2D points, no fit scale.
    snapshotScene: () => ({ version, pts: new Float32Array(0), count: 0, outer: 0, fitScale: null }),
    want: () => ({ ...want }),
  };
}
