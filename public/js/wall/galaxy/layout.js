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

/**
 * How much tighter the galaxy is than nights 1-4's (night 5 A1, the owner's
 * sketch pick `sk_tight=2`): arms, gaps, dust and ribbon at `arm`; the
 * nebulae and the sun's halo at `neb` (a little less tight, so clouds may
 * touch; palette.js NEBULA, scene.js SIZE); a system's spread at `spread`.
 */
export const TIGHT = Object.freeze({ arm: 0.5, neb: 0.64, spread: 0.75 });

/**
 * Room inside a system (night 5 B1, the owner's `sk_sys=1`): an open system
 * spreads `spread` times wider, and no two of its planets stand closer on its
 * plane than `gap` of its reach (spaceOut), so HV1's builders and their names
 * keep apart. `arms` (the sketch's ROOM, 1 + 0.6 of the extra spread) pushes
 * the rosette out with it: a bigger open system is framed from farther back,
 * and without it the sun came into HV1's held frame and onto HV2's words
 * (test/wall-galaxy-framing.test.mjs); scene.js OVERVIEW_MARGIN follows it, so
 * the overview is the same picture from farther back.
 */
export const ROOM = Object.freeze({ spread: 1.4, gap: 0.13, arms: 1.24 });

/**
 * The arms (night 5 A2, the rosette, `sk_arr=2`): the first site's radius,
 * the step outward per turn, the angle per step. A gentle, wide-wound
 * two-arm spiral; with the second arm half a step out (siteSpot) a site
 * stands every 72° round the sun. `r0` keeps the nearest open system off the
 * sun's halo (test/wall-galaxy-layout.test.mjs). `step` is the sketch's 165
 * (330 x TIGHT.arm) raised to 180: past five sites the rosette laps, and the
 * sixth stands 2.5 steps behind the first on the same ray, so 2.5 steps must
 * be at least MIN_SITE_GAP or their nebulae would meet. Both at ROOM.arms.
 */
export const ARM = Object.freeze({ r0: 1250 * TIGHT.arm * ROOM.arms, step: 180 * ROOM.arms, turn: (2 * Math.PI) / 5 });

/**
 * Where the i-th site sits on the arms, `{ arm, t }`: even ones on arm 0,
 * odd ones on arm 1 half a step further out, so the radii interleave and
 * (with ARM.turn a fifth of a turn) the angles step by 72°.
 */
export function siteSpot(i) {
  const arm = i % 2, k = Math.floor(i / 2);
  return { arm, t: k + 0.6 + (arm ? 0.5 : 0) };
}

/** spaceOut's least gap between two planets, in world units, however small the system. */
export const SPACE_MIN = 40;

/**
 * A folded cluster's size against its open system: 0.16 of the old spread,
 * so a folded cluster stays the size it was before ROOM.
 */
export const CLOSED = 0.16 / ROOM.spread;

/**
 * How long a cluster takes to open or fold (ms). Night 5 A6 (the owner's
 * `sk_soft`): slower, on `smoother`, so an opening has no jerk at either end.
 */
export const OPEN_MS = 2800;

/** The orbits layout's units to the galaxy's: a system's spread on the plane. */
export const SPREAD = 2.2 * TIGHT.spread * ROOM.spread;

/**
 * How far a site's star may sit above or below the galaxy's plane (each
 * way). The rosette keeps every site level (y 0): this is the ceiling.
 */
export const SITE_LIFT = 130 * TIGHT.arm;

/**
 * No two sites' stars closer than this: their nebulae (at most 680 x
 * TIGHT.neb across, palette.js NEBULA) never meet. It follows the nebulae,
 * not the arms (0.64x, not 0.5x), or it would no longer say that; the
 * rosette's nearest pair stands about twice as far apart.
 */
export const MIN_SITE_GAP = 700 * TIGHT.neb;

/** Planets lie above or below their system's plane by 0.15-0.5 of their distance. */
export const TILT = Object.freeze({ min: 0.15, max: 0.5 });

/** What hangs below a planet scatters this much up or down round its parent. */
export const JITTER = 30;

/**
 * Size is what it carries (night 5 A3, the owner's sketch pick `sk_size=1`):
 * a planet's radius factor grows by `planet` per doubling of what hangs below
 * it, a star's by `star` per doubling of its planets, from `base` (a planet
 * with nothing below it is a little smaller than nights 1-4's), clamped to
 * `min`-`max`. Never by status: trouble speaks in hue, halo and mark.
 */
export const CARRY = Object.freeze({ base: 0.8, planet: 0.35, star: 0.2, min: 0.8, max: 2.2 });

/** The radius factor of a body carrying `n` (`per`: CARRY.planet or CARRY.star). Pure. */
export function carryScale(n, per) {
  const k = CARRY.base + per * Math.log2(1 + Math.max(0, Number(n) || 0));
  return Math.max(CARRY.min, Math.min(CARRY.max, k));
}

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

/** Ease in and out (cubic), 0..1 to 0..1. Flights, the overview, a status change. */
export const ease = (x) => {
  const k = Math.max(0, Math.min(1, x));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};

/**
 * Smootherstep, 0..1 to 0..1: zero slope and zero acceleration at both ends,
 * so nothing starts or stops with a jolt. A system's opening and folding
 * (`foldAt` and every fade that follows it, night 5 A6).
 */
export const smoother = (x) => {
  const k = Math.max(0, Math.min(1, x));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

/**
 * Where the i-th of n sites sits on the plane: even ones on one arm, odd
 * ones on the other, half a turn round. `n` does not move anything: a site
 * added at the end leaves the others where they were.
 */
export function armPoint(i, n) {
  const { arm, t } = siteSpot(i);
  return armSpine(arm, t);
}

/** A point on arm `arm` (0 or 1) at `t` steps out: the spiral armPoint puts the sites on. */
export function armSpine(arm, t) {
  const r = ARM.r0 + ARM.step * t;
  const a = arm * Math.PI + t * ARM.turn;
  return { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
}

/**
 * The arm ribbon (night 3 T3, r59-dreamer 2): a soft band along each arm's
 * spine, under the dust, so the overview reads as a galaxy and not as five
 * crumbs on a black disc. `from`/`tail`: where it starts (steps, before the
 * first site, fading in from the sun) and how far it runs past an arm's last
 * site; `half` its half width at the start and `grow` per step out; `fadeIn`
 * and `fadeOut` the steps it takes to come and go along the arm; `steps` and
 * `across` its grid. Its strength and colour are the scene's (scene.js RIBBON).
 * T19 (r11-dreamer galaxy 2): narrowed so no point of it is wider than
 * `maxHalf` (it was 170 growing to ~350, a haze rather than an arm).
 */
export const ARM_RIBBON = Object.freeze({
  from: -0.9, tail: 1.1, minTo: 2.4, half: 90 * TIGHT.arm, grow: 16 * TIGHT.arm, maxHalf: 170 * TIGHT.arm,
  fadeIn: 1.1, fadeOut: 1.3, steps: 72, across: 9,
});

/**
 * The near-site band (T19, r11-dreamer galaxy 2): a second, tighter strip on
 * the spine round each site only, so the arm reads where it carries data.
 * `reach` steps either side of the site, fading in and out over all of it;
 * `half` its half width. Brighter than the ribbon (scene.js BAND).
 */
export const ARM_BAND = Object.freeze({ reach: 0.55, half: 55 * TIGHT.arm, steps: 16, across: 7 });

/** How far out the ribbon runs on arm `arm` with `n` sites: past the arm's last site. */
export function ribbonEnd(arm, n) {
  const count = Math.max(0, Math.ceil((Math.max(0, n) - arm) / 2));
  return Math.max(ARM_RIBBON.minTo, count ? siteSpot(2 * (count - 1) + arm).t + ARM_RIBBON.tail : 0);
}

const smooth01 = (x) => {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
};

/**
 * One strip along arm `arm` from `from` to `to` steps out, written into
 * `positions`/`shade`/`index` from vertex `base`: `width(t)` its half width,
 * `along(t)` its strength along the arm, the profile across `(1 - u²)²`.
 */
function armStrip(out, base, arm, from, to, steps, across, width, along) {
  const { positions, shade, index } = out;
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const p = armSpine(arm, t);
    // The tangent of the spiral (as nebula.js armTangent), its normal on the plane.
    const r = ARM.r0 + ARM.step * t, a = arm * Math.PI + t * ARM.turn;
    const tx = ARM.step * Math.cos(a) - r * ARM.turn * Math.sin(a);
    const tz = ARM.step * Math.sin(a) + r * ARM.turn * Math.cos(a);
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    const w = width(t), s = along(t);
    for (let j = 0; j < across; j++) {
      const u = (2 * j) / (across - 1) - 1;
      const k = base + i * across + j;
      positions[k * 3] = p.x + nx * w * u;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = p.z + nz * w * u;
      shade[k] = s * (1 - u * u) ** 2;
      if (i < steps && j < across - 1) index.push(k, k + across, k + 1, k + 1, k + across, k + across + 1);
    }
  }
}

/**
 * The ribbon's mesh for `n` sites: `{ positions, shade, index }`, two strips
 * (one per arm) on the plane, `shade` 0..1 per vertex (0 at the edges and
 * both ends, 1 on the spine), triangles in `index`. One still shape: the
 * same `n` gives the same ribbon.
 */
export function armRibbon(n) {
  const { from, half, grow, maxHalf, fadeIn, fadeOut, steps, across } = ARM_RIBBON;
  const perArm = (steps + 1) * across;
  const out = { positions: new Float32Array(2 * perArm * 3), shade: new Float32Array(2 * perArm), index: [] };
  for (let arm = 0; arm < 2; arm++) {
    const to = ribbonEnd(arm, n);
    armStrip(out, arm * perArm, arm, from, to, steps, across,
      (t) => Math.min(maxHalf, half + grow * Math.max(0, t - from)),
      (t) => smooth01((t - from) / fadeIn) * smooth01((to - t) / fadeOut));
  }
  return out;
}

/**
 * The near-site bands' mesh for `n` sites, as armRibbon: one short strip per
 * site on its arm's spine, centred on the site (armPoint), 1 there and 0 at
 * both ends and both edges.
 */
export function armBand(n) {
  const { reach, half, steps, across } = ARM_BAND;
  const count = Math.max(0, Math.floor(n) || 0), per = (steps + 1) * across;
  const out = { positions: new Float32Array(count * per * 3), shade: new Float32Array(count * per), index: [] };
  for (let i = 0; i < count; i++) {
    const { arm, t: at } = siteSpot(i);
    armStrip(out, i * per, arm, at - reach, at + reach, steps, across, () => half,
      (t) => smooth01(1 - Math.abs(t - at) / reach));
  }
  return out;
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
    const r = 180 * TIGHT.arm + ARM.step * s + (rand() - 0.5) * 380 * TIGHT.arm;
    const a = arm * Math.PI + s * ARM.turn + (rand() - 0.5) * 0.55;
    const y = (rand() - 0.5) * 120 * TIGHT.arm * Math.exp(-s * 0.25);
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
 * farthest member's distance; `carry` on the site and on each member is
 * its radius factor (carryScale: a star by its planets, a planet by
 * everything below it in the site, 1 for the rest). What hangs on the core and is no place (a
 * run) is in no site. `shown` (ids, optional): the sites the galaxy shows;
 * they take the arm slots first, in model order, so a hidden site leaves no
 * gap in the rosette (the rest follow, farther out).
 */
export function galaxyLayout(nodes, aspect = 16 / 9, shown = null) {
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

  const want = shown ? new Set(shown) : null;
  const slots = want ? [...places.filter((s) => want.has(s.id)), ...places.filter((s) => !want.has(s.id))] : places;
  const sites = places.map((s, index) => {
    const at = armPoint(slots.indexOf(s), places.length);
    // All sites level (the rosette): the galaxy reads as one disc.
    const home = { x: at.x, y: 0, z: at.z };
    const base = flat(s) ?? { x: 0, z: 0 };
    const offs = new Map();
    for (const n of members.get(s.id)) {
      const f = flat(n);
      if (f) offs.set(n.id, { x: f.x - base.x, z: f.z - base.z });
    }
    spaceOut(members.get(s.id), offs, byId, s);
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
    // What each member carries: every member of the site below it, at any depth.
    const below = new Map();
    for (const n of members.get(s.id)) {
      if (!offs.has(n.id)) continue;
      let p = byId.get(n.parent);
      for (let k = 0; p && p !== s && k < 50; k++, p = byId.get(p.parent)) below.set(p.id, (below.get(p.id) ?? 0) + 1);
    }
    const out = [];
    let reach = 0;
    for (const n of members.get(s.id)) {
      const o = offs.get(n.id);
      if (!o) continue;
      const off = { x: o.x, y: height(n), z: o.z };
      reach = Math.max(reach, Math.hypot(off.x, off.y, off.z));
      const planet = NAMED.has(n.kind);
      out.push({ id: n.id, node: n, off, planet, carry: planet ? carryScale(below.get(n.id) ?? 0, CARRY.planet) : 1 });
    }
    const carry = carryScale(out.filter((m) => m.planet).length, CARRY.star);
    return { id: s.id, node: s, index, home, members: out, reach, carry };
  });
  return { core, sites };
}

/**
 * Room between planets (night 5 B1): no two planets of a system closer on its
 * plane than ROOM.gap of its reach (at least SPACE_MIN), nor nearer the star
 * than 0.8 of that. A few rounds push close pairs apart, half each; the star
 * never moves. What hangs below a planet moves as its planet did, so it stays
 * by its parent; then the dots (lanes, sessions, services) step off anything
 * nearer than 0.55 of the gap, and only they move. `offs` (id → {x, z}) is
 * changed in place. Deterministic: no randomness, a tie broken by `hash`.
 */
export function spaceOut(list, offs, byId, site) {
  const named = list.filter((n) => NAMED.has(n.kind) && offs.has(n.id));
  if (named.length < 2) return;
  let reach = 0;
  for (const n of named) { const o = offs.get(n.id); reach = Math.max(reach, Math.hypot(o.x, o.z)); }
  const gap = Math.max(SPACE_MIN, reach * ROOM.gap);
  const pos = new Map(named.map((n) => [n.id, { ...offs.get(n.id) }]));
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < named.length; i++) {
      const a = pos.get(named[i].id);
      const da = Math.hypot(a.x, a.z);
      if (da < gap * 0.8) {
        if (da > 1e-6) { const k = (gap * 0.8) / da; a.x *= k; a.z *= k; } else a.x = gap * 0.8;
        moved = true;
      }
      for (let j = i + 1; j < named.length; j++) {
        const b = pos.get(named[j].id);
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= gap) continue;
        if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
        const push = (gap - d) / 2 / d;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // What hangs below a planet moves as its nearest planet above it did.
  const shift = new Map(named.map((n) => {
    const o = offs.get(n.id), p = pos.get(n.id);
    return [n.id, { x: p.x - o.x, z: p.z - o.z }];
  }));
  for (const n of list) {
    if (!offs.has(n.id)) continue;
    let d = shift.get(n.id);
    for (let p = byId.get(n.parent), k = 0; !d && p && p !== site && k < 50; p = byId.get(p.parent), k++) d = shift.get(p.id);
    if (!d) continue;
    const o = offs.get(n.id);
    offs.set(n.id, { x: o.x + d.x, z: o.z + d.z });
  }
  // Then the dots step off anything nearer than 0.55 of the gap.
  const dots = list.filter((n) => !NAMED.has(n.kind) && offs.has(n.id));
  const all = list.filter((n) => offs.has(n.id));
  const small = gap * 0.55;
  for (let round = 0; round < 30; round++) {
    let moved = false;
    for (const n of dots) {
      const a = offs.get(n.id);
      for (const m of all) {
        if (m === n) continue;
        const b = offs.get(m.id);
        let dx = a.x - b.x, dz = a.z - b.z;
        let d = Math.hypot(dx, dz);
        if (d >= small) continue;
        if (d < 1e-6) { dx = hash(`${n.id}|${m.id}`) - 0.5; dz = 0.5 - hash(`${m.id}|${n.id}`); d = Math.hypot(dx, dz) || 1; }
        const k = (small - d) / d / (NAMED.has(m.kind) ? 1 : 2);
        a.x += dx * k; a.z += dz * k;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Where a member sits from its star with the system `open` (0 folded, 1
 * open, eased): folded it is CLOSED of its open distance and flat on the
 * plane; open it is at `p`. The height comes in with the opening, so a
 * folded cluster is a disc and an open one a 3D system.
 */
export function foldAt(open, p) {
  const k = smoother(open);
  const spread = CLOSED + (1 - CLOSED) * k;
  return { x: p.x * spread, y: k === 0 ? 0 : p.y * spread * k, z: p.z * spread };
}
