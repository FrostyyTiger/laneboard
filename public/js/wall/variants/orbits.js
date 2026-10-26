// The `orbits` direction (docs/plans/wall/README.md §5): the fleet as a
// solar system that uses the whole wide screen. The core is the sun; the
// sites are planets on one ellipse around it, stretched to the screen's
// aspect; each planet's rooms (and the services under them) ride its own
// orbit, a circle around it. What lies deeper (a lane's sessions) hangs
// just outside its parent. Names point away from the planet they circle;
// the planet's own name sits in its orbit at six o'clock, where the moons
// leave a gap for it.
//
// Labels are the radial direction's (sites big, rooms one step down,
// services dots at the overview) on the steps type.js gives the screen
// (35 / 15 on the tablet), pinned to their side; the Map's rings are off and the layout
// draws its own orbit lines (`guides`) and fits by its own extents
// (`bounds`), see views/map/layout.js polarLayout. No turn: an ellipse
// that turns would leave the screen.
//
// Pure: no DOM, so test/wall-orbits.test.mjs imports it directly.

import { labelSize, labelSizeFor, STEPS } from './radial.js';
import { stepsFor, pxPerMm } from '../type.js';

/** The tablet's 2736 x 1824: what the layout stretches to when nobody says. */
export const ASPECT = 3 / 2;

/**
 * Sizes in world units, laid out so the overview's scale comes near 1 on a
 * 1368 x 912 CSS px screen: then a gap here is about a gap on the glass.
 * `named` and `dot` are the arc of orbit a named node and a dot take,
 * `minOrbit` the smallest orbit (the planet's name sits inside it), `sat`
 * the step outward of what hangs below an orbit, `gap` between two planet
 * systems and around the sun, `sun` the sun's half box, `inner` the orbit
 * round the sun of what hangs on the core and is no place (a run).
 */
export const SIZES = Object.freeze({ named: 34, dot: 11, minOrbit: 72, sat: 16, gap: 28, sun: 48, inner: 84 });

/**
 * The share of the screen kept clear at each edge: T17's safe area (6 %
 * left and right, 8 % at the top), and at the bottom the band the frame's
 * clock and fleet line sit in (T9). `bounds` is the layout plus that.
 */
export const SAFE = Object.freeze({ side: 0.06, top: 0.08, bottom: 0.2 });

const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);
const TAU = Math.PI * 2;
const LABEL_CAP = 130;

/** A site's name width at the site step (px), 0.62 em a character plus its tracking. */
const siteW = (n, steps) => String(n?.label ?? n?.id ?? '').length * (0.62 * steps.site + 1.5);

/**
 * The overview's scale on the large demo fleet at 1368 x 912 (0.69 at the
 * tablet's 35 px site names, 0.73 at 26):
 * names are set in screen px, so a gap meant to hold one is that much wider
 * in world units.
 */
export const OVERVIEW_SCALE = 0.68;

/** A name's width at the room step, the 0.62 em a caps character takes plus 1px tracking. */
const nameW = (n, steps) => Math.min(LABEL_CAP, String(n?.label ?? n?.id ?? '').length * (0.62 * steps.room + 1));

/**
 * The tree the Map's layouts use: parents from `parent`, roots and orphans
 * under the core (or a virtual one). Returns `{ byId, kids, center }`.
 */
function tree(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null);
  const byId = new Map(list.map((n) => [n.id, n]));
  const core = list.find((n) => n.kind === 'core');
  const kids = new Map();
  const roots = [];
  for (const n of list) {
    if (n === core) continue;
    const p = n.parent != null && byId.has(n.parent) && n.parent !== n.id ? n.parent : null;
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  }
  const center = core ?? { id: '__core', kind: 'core', label: '', virtual: true };
  kids.set(center.id, [...(kids.get(center.id) ?? []), ...roots]);
  for (const list2 of kids.values()) list2.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { byId, kids, center };
}

/**
 * One planet system around (0, 0): its orbit members (children and
 * grandchildren, depth first, each at its angle), what hangs deeper, the
 * orbit radius and the half extents the system takes with its names:
 * `{ orbit, members: [{node, depth, angle}], deep: [{node, parent, level}], hx, hy }`.
 * `steps` are the label sizes (px) the names are measured at.
 */
export function planet(site, kids, sizes = SIZES, steps) {
  steps ??= STEPS;
  const members = [];
  const deep = [];
  const seen = new Set([site.id]);
  const walk = (n, depth) => {
    for (const c of kids.get(n.id) ?? []) {
      if (seen.has(c.id)) continue; // a parent cycle in bad data
      seen.add(c.id);
      if (depth <= 2) members.push({ node: c, depth });
      else deep.push({ node: c, parent: n.id, level: depth - 2 });
      walk(c, depth + 1);
    }
  };
  walk(site, 1);
  if (!members.length) {
    const w = String(site.label ?? site.id).length * 0.62 * steps.site;
    return { orbit: 0, members, deep, hx: Math.max(40, w / 2 + 12), hy: 50 };
  }
  const arcs = members.map((m) => (NAMED.has(m.node.kind) ? sizes.named : sizes.dot));
  const sum = arcs.reduce((s, a) => s + a, 0);
  // The planet's name sits in its orbit at six o'clock, in a gap the moons
  // leave for it: the name's width at the site step, in world units at the
  // overview's usual scale, plus air.
  const gapLen = siteW(site, steps) / OVERVIEW_SCALE + 2 * sizes.gap;
  const orbit = Math.max(sizes.minOrbit, (sum + gapLen) / TAU);
  const gapA = Math.min(Math.PI, gapLen / orbit);
  // From just past the gap, clockwise, each member in the middle of its arc;
  // a small system spreads its arcs round the rest of the orbit.
  const k = (TAU - gapA) / sum;
  let a = Math.PI / 2 + gapA / 2;
  members.forEach((m, i) => { m.angle = a + (arcs[i] * k) / 2; a += arcs[i] * k; });
  const levels = deep.reduce((mx, d) => Math.max(mx, d.level), 0);
  const label = members.reduce((mx, m) => (NAMED.has(m.node.kind) ? Math.max(mx, nameW(m.node, steps)) : mx), 0);
  const out = orbit + levels * sizes.sat;
  // Below, the planet's name hangs half its line under the orbit at six o'clock.
  const below = Math.max(30, Math.round((steps.site * 0.64) / OVERVIEW_SCALE) + 4);
  return { orbit, members, deep, hx: out + 8 + Math.max(label, 24), hy: out + below };
}

/**
 * The angle of planet `i` of `n`, evenly round the ellipse clockwise from
 * the left end (`phase` 0) or half a step on (`phase` 1: from the upper left).
 */
export const planetAngle = (i, n, phase = 1) => -Math.PI + (phase * Math.PI) / n + (i * TAU) / n;

const apart = (p, q, gap) => Math.abs(p.x - q.x) >= p.hx + q.hx + gap || Math.abs(p.y - q.y) >= p.hy + q.hy + gap;

/**
 * Where the planets go: on an ellipse with half axes `(stretch * t, t)`,
 * at planetAngle (either phase), each system's box (half extents hx, hy) clear of the
 * others and of the sun (`sunBox`, half extents) by `gap`. Tries stretches from round to very wide
 * and keeps the one whose overall box fills a screen of `aspect` best (the
 * largest overview scale; of near ties the widest, as the width is free
 * once the height binds). Returns `{ rx, ry, centres: [{x, y}], half: {x, y} }`.
 */
export function arrange(systems, aspect = ASPECT, sizes = SIZES, sunBox = { hx: sizes.sun, hy: sizes.sun }) {
  const n = systems.length;
  const sun = { x: 0, y: 0, hx: sunBox.hx, hy: sunBox.hy };
  if (!n) return { rx: 0, ry: 0, centres: [], half: { x: sun.hx, y: sun.hy } };
  const at = (stretch, t, phase) => systems.map((s, i) => {
    const a = planetAngle(i, n, phase);
    return { x: Math.cos(a) * stretch * t, y: Math.sin(a) * t, hx: s.hx, hy: s.hy };
  });
  const clear = (ps) => ps.every((p, i) => apart(p, sun, sizes.gap) && ps.every((q, j) => j <= i || apart(p, q, sizes.gap)));
  const all = [];
  // Both phases: with a planet straight above the sun the height can be
  // stuck at what clears the sun, however wide the ellipse gets.
  for (const phase of [1, 0]) for (let stretch = 1; stretch <= 3.2001; stretch += 0.05) {
    const at1 = (t) => at(stretch, t, phase);
    let lo = 0, hi = 1;
    while (!clear(at1(hi)) && hi < 1e5) hi *= 2;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (clear(at1(mid))) hi = mid; else lo = mid;
    }
    const ps = at1(hi);
    const half = {
      x: Math.max(sun.hx, ...ps.map((p) => Math.abs(p.x) + p.hx)),
      y: Math.max(sun.hy, ...ps.map((p) => Math.abs(p.y) + p.hy)),
    };
    const scale = Math.min(aspect / half.x, 1 / half.y);
    // How much of the screen's width the box takes once the height fits.
    const fill = Math.min(1, half.x / half.y / aspect);
    all.push({ scale, fill, rx: stretch * hi, ry: hi, centres: ps.map(({ x, y }) => ({ x, y })), half });
  }
  // The largest scale; of those about as large (within 0.5 %), the one that
  // spreads widest: when the height is what binds, the width is free air.
  const top = Math.max(...all.map((c) => c.scale));
  const best = all.filter((c) => c.scale >= top * 0.995).reduce((b, c) => (c.fill > b.fill + 1e-9 ? c : b));
  return { rx: best.rx, ry: best.ry, centres: best.centres, half: best.half };
}

/**
 * The orbits layout for a screen of `aspect` (width / height), in the
 * shape of views/map/layout.js `layout` plus what polarLayout passes on:
 * `{ pos, center, kids, guides, bounds }`. Each position says how its branch
 * from the parent is drawn (`branch`: none from the sun, a straight spoke
 * from a planet to a room, an arc along the orbit from a room to what it
 * holds) and which way its name points (`labelAngle`, away from its planet;
 * a planet's name centred in the gap of its orbit, `labelAt`). `steps`:
 * the label sizes the names are spaced for (type.js `stepsFor`).
 */
export function layoutFor(aspect = ASPECT, sizes = SIZES, steps) {
  steps ??= STEPS;
  const A = Number.isFinite(aspect) && aspect > 0 ? aspect : ASPECT;
  return function layout(nodes) {
    const { kids, center } = tree(nodes);
    // Places are planets; what else hangs on the core (a run) circles the sun.
    const top = kids.get(center.id) ?? [];
    const sites = top.filter((n) => PLACE.has(n.kind));
    const inner = top.filter((n) => !PLACE.has(n.kind));
    const systems = sites.map((s) => planet(s, kids, sizes, steps));
    const innerW = inner.reduce((mx, n) => Math.max(mx, nameW(n, steps)), 0);
    const sunBox = inner.length
      ? { hx: sizes.inner + 8 + Math.max(innerW, 24), hy: sizes.inner + 30 }
      : { hx: sizes.sun, hy: sizes.sun };
    // The free part of the screen, inside the safe area, is what the planets fill.
    const free = (A * (1 - 2 * SAFE.side)) / (1 - SAFE.top - SAFE.bottom);
    const { rx, ry, centres, half } = arrange(systems, free, sizes, sunBox);
    const pos = new Map();
    pos.set(center.id, { x: 0, y: 0, ring: 0, depth: 0 });
    const guides = [];
    if (sites.length > 1) guides.push({ x: 0, y: 0, rx, ry });
    if (inner.length) guides.push({ x: 0, y: 0, rx: sizes.inner, ry: sizes.inner });
    inner.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * TAU) / inner.length;
      pos.set(n.id, {
        x: Math.cos(a) * sizes.inner, y: Math.sin(a) * sizes.inner,
        ring: 1, depth: 1, branch: 'straight', labelAngle: a,
      });
    });
    sites.forEach((site, i) => {
      const c = centres[i];
      const sys = systems[i];
      pos.set(site.id, {
        x: c.x, y: c.y, ring: 1, depth: 1, branch: 'none', labelAngle: -Math.PI / 2,
        ...(sys.orbit > 0 ? { labelAt: { x: c.x, y: c.y + sys.orbit } } : {}),
      });
      if (sys.orbit > 0) guides.push({ x: c.x, y: c.y, rx: sys.orbit, ry: sys.orbit });
      for (const m of sys.members) {
        pos.set(m.node.id, {
          x: c.x + Math.cos(m.angle) * sys.orbit,
          y: c.y + Math.sin(m.angle) * sys.orbit,
          ring: 1 + m.depth,
          depth: 1 + m.depth,
          branch: m.depth === 1 ? 'straight' : { x: c.x, y: c.y },
          labelAngle: m.angle,
        });
      }
      // Deeper nodes fan out just outside their parent, away from the planet.
      const byParent = new Map();
      for (const d of sys.deep) {
        if (!byParent.has(d.parent)) byParent.set(d.parent, []);
        byParent.get(d.parent).push(d);
      }
      const angleOf = new Map(sys.members.map((m) => [m.node.id, m.angle]));
      const place = (parentId, list) => {
        const base = angleOf.get(parentId) ?? 0;
        list.forEach((d, j) => {
          const r = sys.orbit + d.level * sizes.sat;
          const a = base + ((j - (list.length - 1) / 2) * sizes.dot) / r;
          angleOf.set(d.node.id, a);
          pos.set(d.node.id, {
            x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r,
            ring: 3 + d.level, depth: 3 + d.level, branch: 'straight', labelAngle: a,
          });
          if (byParent.has(d.node.id)) place(d.node.id, byParent.get(d.node.id));
        });
      };
      for (const m of sys.members) if (byParent.has(m.node.id)) place(m.node.id, byParent.get(m.node.id));
    });
    // The overview's view: the planets' box plus the safe area, the camera
    // below the origin by what the bottom band takes more than the top.
    const y = half.y / (1 - SAFE.top - SAFE.bottom);
    const bounds = { x: half.x / (1 - 2 * SAFE.side), y, cy: (SAFE.bottom - SAFE.top) * y };
    return { pos, center, kids, guides, bounds };
  };
}

/** The layout for the tablet's aspect. */
export const layout = layoutFor(ASPECT);

/**
 * The Map's options for a screen of `aspect`, next to the page's `ambient`:
 * the type steps from `screen`'s density (type.js `screenOf`; the tablet's
 * without one), the layout spaced for them. `pinLabels`: a name keeps its
 * side and line while the camera flies (the collision pass re-placed names
 * as the zoom changed).
 */
export function optionsFor(aspect = ASPECT, screen) {
  const steps = screen ? stepsFor(pxPerMm(screen)) : STEPS;
  const same = steps.site === STEPS.site && steps.room === STEPS.room;
  return { layout: layoutFor(aspect, SIZES, steps), labelSize: same ? labelSize : labelSizeFor(steps), rings: false, pinLabels: true };
}

/** What `createMap` takes for this direction at the tablet's aspect. */
export const mapOptions = Object.freeze(optionsFor(ASPECT));

/** The Map's ambient settings for this direction: no turn. */
export const ambient = Object.freeze({ drift: 0 });
