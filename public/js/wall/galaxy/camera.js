// The galaxy's camera (Wall plan night 2 T4, README §5): a Map look-alike, so
// the Wall's tour (tour.js `createTour`) and later its lock and glow drive the
// 3D camera as they drive the Map: `focus(id, zoom)`, `fit()`, `onDraw(cb)`,
// `screenOf(id)`, `snapshotScene()`.
//
// One camera with intent: a flight eases from wherever the camera is to the
// shot it wants, rising over a long hop so it never skims the plane or the
// sun; the system it flies to opens once the camera is most of the way there
// (layout.js OPEN_MS), the one it leaves folds while it goes; held, the camera
// drifts slowly round the system so the depth reads (scene.js `siteShot`).
//
// `flightPose` and `openStep` are pure (test/wall-galaxy-camera.test.mjs);
// `createGalaxyCamera` is the small part that moves the scene's camera.

import * as THREE from '../../../vendor/three/three.module.js';
import { ease, OPEN_MS } from './layout.js';
import { overviewShot, siteShot } from './scene.js';
import { TIMING } from '../tour.js';

/**
 * A flight takes the tour's `flyMs` (tour.js TIMING, 2250 ms); the target system starts opening at
 * `openAt` of it (so it is open just after the camera arrives) and a long
 * hop rises by `lift` of its length at the middle, at most `maxLift`.
 */
export const FLIGHT = Object.freeze({ ms: 2250, openAt: 0.45, lift: 0.18, maxLift: 900 });

/** The longest frame step the opening follows (ms). */
const MAX_STEP_MS = 500;

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Where the camera is `k` (0..1, already eased) of the way from shot `a` to
 * shot `b` (`{ pos, look }`): a straight line for the look-at, an arc for the
 * position that rises in the middle with the hop's length. Pure.
 */
export function flightPose(a, b, k, flight = FLIGHT) {
  const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
  const rise = Math.min(flight.maxLift, dist * flight.lift) * Math.sin(Math.PI * k);
  return {
    pos: { x: lerp(a.pos.x, b.pos.x, k), y: lerp(a.pos.y, b.pos.y, k) + rise, z: lerp(a.pos.z, b.pos.z, k) },
    look: { x: lerp(a.look.x, b.look.x, k), y: lerp(a.look.y, b.look.y, k), z: lerp(a.look.z, b.look.z, k) },
  };
}

/** A system's opening `open` moved `dtMs` toward `want` (0 or 1) at OPEN_MS a full turn. Pure. */
export function openStep(open, want, dtMs, openMs) {
  const step = Math.max(0, dtMs) / (openMs > 0 ? openMs : OPEN_MS);
  return want > open ? Math.min(want, open + step) : Math.max(want, open - step);
}

/** The shot for a site at `zoom` (the tour's zoom is siteShot's distance), `heldMs` into its drift. */
export function zoomedSiteShot(site, heldMs, zoom) {
  const s = siteShot(site, heldMs);
  const z = Number.isFinite(zoom) && zoom > 0 ? TIMING.zoom / zoom : 1;
  if (z === 1) return s;
  return {
    pos: { x: s.look.x + (s.pos.x - s.look.x) * z, y: s.look.y + (s.pos.y - s.look.y) * z, z: s.look.z + (s.pos.z - s.look.z) * z },
    look: s.look,
  };
}

/**
 * The camera over `galaxy` (scene.js `createGalaxyScene`: `world`,
 * `setOpen`, `camera`). Call `frame(now)` before the scene draws and
 * `drawn()` after it. `flight` is injectable for tests.
 */
export function createGalaxyCamera(galaxy, { flight = FLIGHT } = {}) {
  // What the camera wants: the overview or one site, since `t0` (ms).
  let want = { kind: 'overview', t0: null };
  let from = null; // the pose the current flight left from
  let pose = null; // where the camera is now
  let last = null;
  let version = 0;
  const drawCbs = new Set();

  const sites = () => galaxy.world?.sites ?? [];
  const siteOf = (id) => galaxy.world?.byId.get(id) ?? null;

  const target = (now) => {
    if (want.kind === 'site') {
      const s = siteOf(want.id);
      if (s) return zoomedSiteShot(s, Math.max(0, now - want.t0 - flight.ms), want.zoom);
    }
    return overviewShot(sites(), now);
  };

  const go = (next) => {
    from = pose;
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
    const k = from ? ease((now - want.t0) / flight.ms) : 1;
    const to = target(now);
    pose = from && k < 1 ? flightPose(from, to, k, flight) : to;
    if (k >= 1) from = null;

    // The held system opens once the camera is most of the way there; the rest fold.
    const opening = want.kind === 'site' && now - want.t0 >= flight.ms * flight.openAt ? want.id : null;
    for (const s of sites()) {
      const o = openStep(s.open, s.id === opening ? 1 : 0, dt);
      if (o !== s.open) galaxy.setOpen(s.id, o);
    }

    galaxy.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    galaxy.camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
    return pose;
  };

  const v = new THREE.Vector3();
  /** Where a site or a node in one is drawn now (canvas css px), null when behind the camera or unknown. */
  const screenOf = (id) => {
    const w = galaxy.world;
    if (!w) return null;
    let p = w.byId.get(id)?.home ?? null;
    if (!p) {
      for (const s of w.sites) {
        const m = s.members.find((x) => x.id === id);
        if (m) { p = m.mesh.position; break; }
      }
    }
    if (!p) return null;
    const cam = galaxy.camera;
    cam.updateMatrixWorld();
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    if (v.z >= 0) return null; // behind the camera
    v.applyMatrix4(cam.projectionMatrix);
    const el = galaxy.renderer?.domElement;
    const W = el?.clientWidth ?? 0, H = el?.clientHeight ?? 0;
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
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
