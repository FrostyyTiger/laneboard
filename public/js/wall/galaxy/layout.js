// The galaxy's layout (docs/plans/wall/README.md §5, Wall plan night 2 T1):
// where everything sits, before three.js draws it. The hub is the sun at the
// origin; the sites are star clusters on two spiral arms in a band of dust;
// a site's rooms and builders are planets round its star, on inclined orbits
// above and below the system's plane by at most half their distance from the
// star; at the overview a system is folded to CLOSED of its size, flat, and
// opens as the camera arrives.
//
// World axes are three.js's: the galaxy's plane is x/z, y is up. Shapes
// inside a system come from the orbits layout (variants/orbits.js), its 2D
// x/y laid on the plane as x/z.
//
// Pure: no DOM, no three, no Math.random (the same model gives the same
// galaxy on every load), so test/wall-galaxy-layout.test.mjs imports it
// directly. Ported from the sketch, docs/plans/wall/sketch/galaxy.js.

import { layoutFor } from '../variants/orbits.js';

/** The arms: the first site's radius, the step outward per turn, the angle per step. */
export const ARM = Object.freeze({ r0: 650, step: 520, turn: 0.85 });

/** A folded cluster's size against its open system. */
export const CLOSED = 0.16;

/** How long a cluster takes to open or fold (ms). */
export const OPEN_MS = 1800;

/** The orbits layout's units to the galaxy's: a system's spread on the plane. */
export const SPREAD = 2.2;

/** How far a site's star may sit above or below the galaxy's plane (each way). */
export const SITE_LIFT = 130;

/** No two sites' stars closer than this: their nebulae (at most 680 across) never meet. */
export const MIN_SITE_GAP = 700;

/** Planets lie above or below their system's plane by 0.15-0.5 of their distance. */
export const TILT = Object.freeze({ min: 0.15, max: 0.5 });

/** What hangs below a planet scatters this much up or down round its parent. */
export const JITTER = 30;

const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);

/** A stable number in [0, 1) for a string (FNV-1a). */
export function hash(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ease in and out (cubic), 0..1 to 0..1. */
export const ease = (x) => {
  const k = Math.max(0, Math.min(1, x));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};

/**
 * Where the i-th of n sites sits on the plane: even ones on one arm, odd
 * ones on the other, half a turn round. `n` does not move anything: a site
 * added at the end leaves the others where they were.
 */
export function armPoint(i, n) {
  const arm = i % 2;
  const t = Math.floor(i / 2) + 0.6;
  const r = ARM.r0 + ARM.step * t;
  const a = arm * Math.PI + t * ARM.turn;
  return { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
}

/**
 * The dust band: `n` points along the two arms, thicker near the sun, and
 * for each how far out along its arm it lies (`t`, 0 at the sun, 1 at the
 * rim), which the scene turns into its colour (warm inside, cool outside).
 */
export function dustPoints(n = 9000, seed = 7) {
  const rand = rng(seed);
  const positions = new Float32Array(n * 3);
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const s = rand() ** 0.8 * 4.2;
    const r = 180 + ARM.step * s + (rand() - 0.5) * 380;
    const a = arm * Math.PI + s * ARM.turn + (rand() - 0.5) * 0.55;
    const y = (rand() - 0.5) * 120 * Math.exp(-s * 0.25);
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;
    t[i] = Math.min(1, s / 3.5);
  }
  return { positions, t };
}

/** Far stars: `n` points on a shell 9000-15000 out, all round. */
export function farStars(n = 2500, seed = 11) {
  const rand = rng(seed);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 9000 + rand() * 6000;
    const a = rand() * Math.PI * 2;
    const b = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(b) * Math.cos(a);
    positions[i * 3 + 1] = r * Math.cos(b);
    positions[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
  }
  return positions;
}

/**
 * The galaxy for a model's nodes: `{ core, sites }`. A site is
 * `{ id, node, index, home, members, reach }`: `home` its star in the
 * world, `members` everything below it as `{ id, node, off, planet }`
 * with `off` the open position from the star (`planet`: a named kind,
 * drawn as a lit sphere with a stem; the rest are dots), `reach` the
 * farthest member's distance. What hangs on the core and is no place (a
 * run) is in no site.
 */
export function galaxyLayout(nodes, aspect = 16 / 9) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null);
  const byId = new Map(list.map((n) => [n.id, n]));
  const { pos } = layoutFor(aspect)(list);
  const core = list.find((n) => n.kind === 'core') ?? null;
  const places = list.filter((n) => PLACE.has(n.kind));
  const siteOf = (n) => {
    let c = byId.get(n.parent);
    for (let k = 0; c && !PLACE.has(c.kind) && k < 50; k++) c = byId.get(c.parent);
    return c && PLACE.has(c.kind) ? c : null;
  };
  const members = new Map(places.map((s) => [s.id, []]));
  for (const n of list) {
    if (PLACE.has(n.kind) || n === core) continue;
    const s = siteOf(n);
    if (s) members.get(s.id).push(n);
  }
  const flat = (n) => {
    const p = pos.get(n.id);
    return p ? { x: p.x * SPREAD, z: p.y * SPREAD } : null;
  };

  const sites = places.map((s, index) => {
    const at = armPoint(index, places.length);
    const home = { x: at.x, y: (hash(s.id) - 0.5) * 2 * SITE_LIFT, z: at.z };
    const base = flat(s) ?? { x: 0, z: 0 };
    const offs = new Map();
    for (const n of members.get(s.id)) {
      const f = flat(n);
      if (f) offs.set(n.id, { x: f.x - base.x, z: f.z - base.z });
    }
    // Heights: a planet straight below the site picks a side and a tilt;
    // what hangs below it stays near its parent's height. Every height
    // is kept within half the distance from the star.
    const ys = new Map();
    const height = (n) => {
      if (ys.has(n.id)) return ys.get(n.id);
      const o = offs.get(n.id);
      const d = o ? Math.hypot(o.x, o.z) : 0;
      const parent = byId.get(n.parent);
      let y;
      if (parent === s && NAMED.has(n.kind)) {
        const side = hash(`${n.id}^`) < 0.5 ? -1 : 1;
        y = side * d * (TILT.min + (TILT.max - TILT.min) * hash(`${n.id}~`));
      } else {
        const up = parent && parent !== s && offs.has(parent.id) ? height(parent) : 0;
        y = up + (hash(n.id) - 0.5) * JITTER;
      }
      y = Math.max(-TILT.max * d, Math.min(TILT.max * d, y));
      ys.set(n.id, y);
      return y;
    };
    const out = [];
    let reach = 0;
    for (const n of members.get(s.id)) {
      const o = offs.get(n.id);
      if (!o) continue;
      const off = { x: o.x, y: height(n), z: o.z };
      reach = Math.max(reach, Math.hypot(off.x, off.y, off.z));
      out.push({ id: n.id, node: n, off, planet: NAMED.has(n.kind) });
    }
    return { id: s.id, node: s, index, home, members: out, reach };
  });
  return { core, sites };
}

/**
 * Where a member sits from its star with the system `open` (0 folded, 1
 * open, eased): folded it is CLOSED of its open distance and flat on the
 * plane; open it is at `p`. The height comes in with the opening, so a
 * folded cluster is a disc and an open one a 3D system.
 */
export function foldAt(open, p) {
  const k = ease(open);
  const spread = CLOSED + (1 - CLOSED) * k;
  return { x: p.x * spread, y: k === 0 ? 0 : p.y * spread * k, z: p.z * spread };
}
