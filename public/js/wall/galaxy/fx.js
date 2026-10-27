// The galaxy's effects (Wall plan night 2 §7.C, README D9): each one behind
// `galaxy.html?fx=<name>` (comma-separated, unknown names ignored, all off
// by default), so the owner can see each and keep or drop it.
//
// `comets` (T13): something that just travelled a link (an event with
// `link`: a job's image pushed, a deploy, a dump; the Map's comet) is one
// small comet with a tail, once, from the planet it left to the planet it
// lands on, arcing over the plane. Grey unless the event itself is trouble.
//
// `twinkle` (T14): a planet with a working session on it (an agent at work:
// a lane or session whose status is `working` and calm) glimmers softly,
// slow and low, in the grey of a calm thing: "busy", never "look here". A
// planet in trouble does not twinkle (it breathes already: one motion per thing).
//
// `beacon` (T21, r15-dreamer): above each cluster in crit a thin pillar of
// light rises from the plane, its height how long the crit has lasted (log
// scale, capped), so two crits are no longer twins: the tall one has been
// burning for hours, the short one just began. Calm and warn get none. It
// grows only as the crit ages (a motion nobody sees), rises once when the
// crit starts and sinks when it clears. Night 3 T9 finished it: sized in
// the overview's screen (a young crit already stands a quarter of the
// frame), a white-hot core at its foot, wider as well as taller with age,
// its sheath fading to nothing at the top.
//
// `warp` (night 3 T12, r59-dreamer 1; T28 r36-dreamer): during a flight the
// dust and the far stars stretch into short streaks that point at where the
// camera is going (a vanishing point on the target), longest at the flight's
// top speed, their ends nearest the target in its status hue (grey for calm,
// amber or red for trouble), and gone before it lands; the dust thins while
// it flies. You know the next target is red before the caption types it.
// Nothing at rest, nothing in still mode, and nothing on a flight to a calm
// site or to the overview (night 4 T15): a streak means "trouble ahead".

import { hash } from './layout.js';
import { toneOf } from './palette.js';

/** Every effect this page knows, in the order the README lists them. */
export const FX_NAMES = Object.freeze(['comets', 'twinkle', 'beacon', 'warp']);

/** The effects `?fx=` asks for (a `location.search` string or URLSearchParams): a Set of known names. */
export function parseFx(search = '') {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  const asked = q.getAll('fx').flatMap((v) => v.split(',')).map((v) => v.trim().toLowerCase());
  return new Set(FX_NAMES.filter((n) => asked.includes(n)));
}

const MAX_DEPTH = 50;

/** The site a node is in (a `site` or `host` up its parents), else null. */
function placeOf(id, byId) {
  let n = byId.get(id);
  for (let k = 0; n && n.kind !== 'site' && n.kind !== 'host' && k < MAX_DEPTH; k++) n = byId.get(n.parent);
  return n && (n.kind === 'site' || n.kind === 'host') ? n.id : null;
}

/**
 * The comet's timing and look: one flight takes `travelMs` (eased), once
 * per event; an event older than `windowMs` (by the model's clock) when
 * the page first sees it flies no more; at most `max` in the sky at once.
 * `head` is the bright sprite's size as a share of the flight's length
 * (clamped to `headMin`..`headMax` world units), `tail` how many smaller
 * ones follow it, `gap` their spacing along the arc (0..1), `lift` how high
 * the arc rises over the straight line (a share of its length, `liftMin`).
 */
export const COMETS = Object.freeze({
  travelMs: 3200, windowMs: 10000, max: 6,
  head: 0.07, headMin: 22, headMax: 90, tail: 10, gap: 0.016, opacity: 0.55,
  lift: 0.3, liftMin: 60,
});

/**
 * The comets in `model`: one per event that travelled a link (`event.link`,
 * by the link's id or `from>to`) in the last `windowMs`, by the model's own
 * clock. Each end is the nearest thing the galaxy draws (`drawn`: ids of
 * sites and their members) up the node's parents: `{ key, from, to,
 * fromSite, toSite, tone, ageMs }`, `key` the event's own (time and link),
 * so the same event in the next model is the same comet. A link whose two
 * ends are drawn as one thing (a folded service in its own room) is none.
 */
export function flowComets(model, drawn, { windowMs = COMETS.windowMs } = {}) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const links = Array.isArray(model?.links) ? model.links : [];
  const events = Array.isArray(model?.events) ? model.events : [];
  const byId = new Map(nodes.filter((n) => n && n.id != null).map((n) => [n.id, n]));
  const shown = drawn instanceof Set ? drawn : new Set(drawn ?? []);
  const now = Number.isFinite(model?.generatedAt) ? model.generatedAt : Math.max(0, ...events.map((e) => Number(e?.at) || 0));
  const named = new Map();
  for (const l of links) {
    if (!l || l.from == null || l.to == null) continue;
    named.set(`${l.from}>${l.to}`, l);
    if (l.id != null) named.set(String(l.id), l);
  }
  const up = (id) => {
    let n = byId.get(id);
    for (let k = 0; n && !shown.has(n.id) && k < MAX_DEPTH; k++) n = byId.get(n.parent);
    return n && shown.has(n.id) ? n.id : null;
  };
  const out = [];
  const seen = new Set();
  for (const e of events) {
    if (!e || e.link == null) continue;
    const l = named.get(String(e.link));
    const ageMs = now - (Number(e.at) || 0);
    if (!l || !(ageMs >= 0 && ageMs < windowMs)) continue;
    const from = up(l.from), to = up(l.to);
    const fromSite = placeOf(l.from, byId), toSite = placeOf(l.to, byId);
    if (!from || !to || from === to || !fromSite || !toSite) continue;
    const key = `${Number(e.at) || 0}:${e.link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, from, to, fromSite, toSite, tone: toneOf(e.kind), ageMs });
  }
  return out.sort((a, b) => b.ageMs - a.ageMs);
}

/**
 * The comets the page flies at page time `now`: `prev` (`{ flying, seen }`
 * or null) with `list` (flowComets') added. A comet starts when the page
 * first sees its event and flies once; `seen` remembers the keys it has
 * flown (the last few hundred) so the next model's copy of the same event
 * never flies it again. A finished comet leaves `flying`; when `max` are in
 * the sky a new one waits for the next model (and is dropped once too old).
 */
export function trackComets(prev, list, now, timing = COMETS) {
  const seen = new Set(prev?.seen ?? []);
  const flying = [...(prev?.flying ?? [])].filter((c) => cometAt(c, now, timing) !== undefined);
  for (const c of list ?? []) {
    if (seen.has(c.key) || flying.length >= timing.max) continue;
    seen.add(c.key);
    flying.push({ key: c.key, from: c.from, to: c.to, fromSite: c.fromSite, toSite: c.toSite, tone: c.tone, t0: now });
  }
  const keep = [...seen].slice(-400);
  return { flying, seen: new Set(keep) };
}

/**
 * Where a comet is at `now`: `{ u, k }`, `u` 0..1 along its arc (eased: it
 * leaves and lands gently), `k` 0..1 its strength (in at the start, out as
 * it lands); `null` before it starts; `undefined` once it has landed.
 */
export function cometAt(comet, now, timing = COMETS) {
  const p = (now - comet.t0) / timing.travelMs;
  if (p < 0) return null;
  if (p >= 1) return undefined;
  const u = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  const k = Math.min(1, p / 0.1, (1 - p) / 0.15);
  return { u, k };
}

/**
 * A comet's arc from `a` to `b` (`{ x, y, z }`): a curve lifted over the
 * straight line by `lift` of its length (at least `liftMin`), so it flies
 * over the plane, not along it. Returns `{ at(u), length }`.
 */
export function cometPath(a, b, timing = COMETS) {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const h = Math.max(timing.liftMin, length * timing.lift);
  const c = { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + h, z: (a.z + b.z) / 2 };
  const at = (u) => {
    const t = Math.max(0, Math.min(1, u)), s = 1 - t;
    return {
      x: s * s * a.x + 2 * s * t * c.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * c.y + t * t * b.y,
      z: s * s * a.z + 2 * s * t * c.z + t * t * b.z,
    };
  };
  return { at, length };
}

/**
 * The twinkle's timing and look: two slow waves (`periods`, ms, not
 * multiples of each other, so it never ticks like a clock) set how bright
 * the glimmer is, each planet at its own pace within `spread` of them; it comes and goes over `fadeMs`; at most `max` at once.
 * `size` is the light's size against the sphere it sits on, `opacity` its
 * peak and `floor` its low share of it (low contrast: never off, never loud).
 */
export const TWINKLE = Object.freeze({
  periods: [5600, 3700], spread: 0.3, fadeMs: 1200, max: 24, size: 5, opacity: 0.3, floor: 0.3,
});

const AT_WORK = new Set(['lane', 'session']);

/**
 * The planets that twinkle in `model`: one per planet with a working
 * session below it (a `lane` or `session` node whose status is `working`
 * and whose tone is calm: a stuck one is warn, trouble's to show). Each is
 * the nearest thing up the session's parents in `planets` (ids the galaxy
 * draws as planets or stars), so a session in a folded lane twinkles its
 * builder. `{ id, site, count }`, `count` the working sessions on it, `site`
 * its site (the star to fall back on). In the model's order.
 */
export function workingPlanets(model, planets) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const byId = new Map(nodes.filter((n) => n && n.id != null).map((n) => [n.id, n]));
  const shown = planets instanceof Set ? planets : new Set(planets ?? []);
  const out = new Map();
  for (const n of nodes) {
    if (!n || !AT_WORK.has(n.kind) || n.status !== 'working' || toneOf(n) !== 'calm') continue;
    let p = byId.get(n.parent);
    for (let k = 0; p && !shown.has(p.id) && k < MAX_DEPTH; k++) p = byId.get(p.parent);
    if (!p || !shown.has(p.id)) continue;
    const had = out.get(p.id);
    if (had) { had.count += 1; continue; }
    out.set(p.id, { id: p.id, site: placeOf(p.id, byId), count: 1 });
  }
  return [...out.values()];
}

/**
 * The twinkles the page draws at page time `now`: `prev` (a Map by id, or
 * null) with `list` (workingPlanets'). One that stays keeps its start; one
 * the model drops fades out from `now` (`until`); one that comes back while
 * fading picks up from where its light is. At most `max`, the oldest first.
 */
export function trackTwinkles(prev, list, now, timing = TWINKLE) {
  const old = prev instanceof Map ? prev : new Map();
  const next = new Map();
  for (const w of list ?? []) {
    const had = old.get(w.id);
    let t0 = now;
    if (had) {
      const lit = twinkleAt(had, now, timing);
      t0 = had.until === Infinity ? had.t0 : now - (lit ? lit.k : 0) * timing.fadeMs;
    }
    next.set(w.id, { id: w.id, site: w.site, t0, until: Infinity });
  }
  for (const [id, w] of old) {
    if (next.has(id)) continue;
    const gone = { ...w, until: Math.min(w.until, now) };
    if (twinkleAt(gone, now, timing) !== undefined) next.set(id, gone);
  }
  const keep = [...next.values()].sort((a, b) => a.t0 - b.t0).slice(0, timing.max);
  return new Map(keep.map((w) => [w.id, w]));
}

/**
 * How a twinkle shines at `now`: `{ k, glimmer }`, `k` 0..1 its fade in or
 * out, `glimmer` 0..1 the slow waves (each planet at its own phase, by
 * its id; 0.5 and still when `still`); `undefined` once it has faded out.
 */
export function twinkleAt(tw, now, timing = TWINKLE, still = false) {
  const into = Math.max(0, Math.min(1, (now - tw.t0) / timing.fadeMs));
  const out = tw.until === Infinity ? 1 : 1 - (now - tw.until) / timing.fadeMs;
  if (out <= 0) return undefined;
  const k = Math.min(into, Math.min(1, out));
  if (still) return { k, glimmer: 0.5 };
  // Its own phase and pace by its id (salted after the id: `builder-a` and
  // `builder-b` would otherwise hash a hair apart and glimmer in step).
  const ph = hash(`${tw.id}|twinkle`) * Math.PI * 2;
  const pace = 1 - timing.spread / 2 + timing.spread * hash(`${tw.id}|pace`);
  const [p0, p1] = timing.periods.map((p) => p * pace);
  const glimmer = 0.5 + 0.3 * Math.sin((now / p0) * Math.PI * 2 + ph) + 0.2 * Math.sin((now / p1) * Math.PI * 2 + ph * 2);
  return { k, glimmer };
}

/**
 * The beacon's scale and look, in the overview's screen (night 3 T9): a
 * crit that just began stands `floor` of the frame's height (seen from the
 * overview shot, so a young crit shows at once from 3 m), one `capMs` old
 * or more `top`, by log of its age in `unitMs` (1 min 0.29, 10 min 0.33,
 * 1 h 0.36, 6 h 0.40, 1 d 0.42); its tip never rises past `room` (ndc y) so
 * it stops short of the frame's top. Its width grows with its age too, from
 * `wide[0]` to `wide[1]` of the frame's height, so an old crit is a column
 * and a new one a thread. `core` is the white-hot core's share of the
 * width (it carries in greyscale and without red: it is the brightest
 * line on screen), `fade` the top share over which the sheath goes to
 * nothing (no flat end for the plate to cut). It rises over and sinks over
 * `riseMs`; `tip` is the soft light at its top (world units, it marks the
 * height so two pillars compare at a glance). `opacity` is the sheath's
 * peak, `coreOpacity` the core's, `held` their share while its system is
 * open (the system is the loud thing then). `near` fades it while the
 * camera is close (beaconNear). At most `max` at once.
 */
export const BEACON = Object.freeze({
  unitMs: 60_000, capMs: 24 * 3_600_000, floor: 0.25, top: 0.42, room: 0.9,
  wide: Object.freeze([0.016, 0.036]), core: 0.3, fade: 0.2,
  riseMs: 1400, tip: 90, opacity: 0.75, coreOpacity: 0.9, held: 0.3, max: 8,
  near: Object.freeze([1.8, 3.5]),
});

/** How far a crit `ageMs` old has grown, 0 (just began) to 1 (`capMs` or older), by log. */
function beaconGrowth(ageMs, timing = BEACON) {
  const k = Math.log1p(Math.max(0, ageMs) / timing.unitMs) / Math.log1p(timing.capMs / timing.unitMs);
  return Math.min(1, k);
}

/**
 * How tall a beacon stands for a cluster whose worst tone is `tone`, in
 * crit for `ageMs`, as a share of the frame's height at the overview: 0
 * for anything but crit (or no age); else from `floor` (just began) up to
 * `top` at `capMs`, by log, never past it.
 */
export function beaconHeight(ageMs, tone = 'crit', timing = BEACON) {
  if (tone !== 'crit' || !Number.isFinite(ageMs)) return 0;
  return timing.floor + (timing.top - timing.floor) * beaconGrowth(ageMs, timing);
}

/** How wide a beacon is (its sheath, a share of the frame's height), as beaconHeight: grows with age. */
export function beaconWidth(ageMs, tone = 'crit', timing = BEACON) {
  if (tone !== 'crit' || !Number.isFinite(ageMs)) return 0;
  const [lo, hi] = timing.wide;
  return lo + (hi - lo) * beaconGrowth(ageMs, timing);
}

const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vnorm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/**
 * A beacon on `base` (`{ x, y, z }`, its star) in world units, seen from
 * `shot` (`{ pos, look }`, the overview) with vertical field of view `fov`
 * (degrees): `rise(share)` is the height whose tip lands `share` of the
 * frame's height above the base on screen (straight up the plane's normal,
 * so foreshortened by the camera's pitch), never past `room` (ndc y, 0
 * when the base is already there); `across(share)` the width that is
 * `share` of the frame's height at the base's depth. Closed form, cheap
 * enough for every frame. Null when the base is behind the camera.
 */
export function beaconScale(shot, base, fov, room = BEACON.room) {
  const f = vnorm(vsub(shot.look, shot.pos));
  const r = vnorm({ x: -f.z, y: 0, z: f.x }); // f × up
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = vsub(base, shot.pos);
  const z0 = vdot(d, f), y0 = vdot(d, u);
  if (!(z0 > 0)) return null;
  const t = Math.tan((fov * Math.PI) / 360);
  const ndc0 = y0 / (z0 * t);
  // The tip (base + h up) at ndc y T: y0 + h u.y = T t (z0 + h f.y).
  const rise = (share) => {
    const T = Math.min(ndc0 + 2 * Math.max(0, share), room);
    const den = u.y - T * t * f.y;
    if (!(T > ndc0) || !(den > 0)) return 0;
    return Math.max(0, (T * t * z0 - y0) / den);
  };
  const across = (share) => share * 2 * z0 * t;
  return { rise, across, ndc0 };
}

/**
 * How strong a beacon stays when it looks `ratio` times as wide on screen
 * as it does at the overview (the camera is close: held in a system near
 * it): 1 up to `near[0]`, eased to 0 at `near[1]`, so a pillar sized for
 * the overview never stands as a red wall across a close shot.
 */
export function beaconNear(ratio, timing = BEACON) {
  const [a, b] = timing.near;
  if (!(ratio > a)) return 1;
  if (ratio >= b) return 0;
  const k = (ratio - a) / (b - a);
  return 1 - k * k * (3 - 2 * k);
}

/**
 * The sheath's strength up its height, `v` 0 (foot) to 1 (tip): full at
 * the foot, easing down, then gone over the top `fade` (smooth, so no
 * edge: a plate over it never cuts a flat end).
 */
export function beamProfile(v, timing = BEACON) {
  const x = Math.max(0, Math.min(1, v));
  const body = 1 - 0.45 * (x / (1 - timing.fade));
  if (x <= 1 - timing.fade) return body;
  const k = (1 - x) / timing.fade; // 1 at the fade's start, 0 at the tip
  return 0.55 * k * k * (3 - 2 * k);
}

/** The white-hot core's strength up the pillar: brightest at its foot, gone by two thirds of the way up. */
export function coreProfile(v) {
  const x = Math.max(0, Math.min(1, v)) / 0.66;
  if (x >= 1) return 0;
  return (1 - x) ** 1.5;
}

/**
 * How long each site in `sites` (ids the galaxy draws) has been in crit,
 * by the model's events: for each node in crit now, the newest crit event
 * on it (the one that began this spell); a site's age is its oldest such
 * crit. `Map` site id → ageMs by the model's clock (`generatedAt`). A crit
 * with no event (the hub's list is short) is not here: the page counts it
 * from when it first saw it.
 */
export function critAges(model, sites) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const events = Array.isArray(model?.events) ? model.events : [];
  const byId = new Map(nodes.filter((n) => n && n.id != null).map((n) => [n.id, n]));
  const shown = sites instanceof Set ? sites : new Set(sites ?? []);
  const now = Number.isFinite(model?.generatedAt) ? model.generatedAt : Math.max(0, ...events.map((e) => Number(e?.at) || 0));
  const began = new Map();
  for (const e of events) {
    if (!e || e.node == null || toneOf(e.kind) !== 'crit') continue;
    const at = Number(e.at);
    if (Number.isFinite(at) && at > (began.get(e.node) ?? -Infinity)) began.set(e.node, at);
  }
  const out = new Map();
  for (const n of nodes) {
    if (!n || toneOf(n) !== 'crit' || !began.has(n.id)) continue;
    const site = placeOf(n.id, byId);
    if (!site || !shown.has(site)) continue;
    const age = Math.max(0, now - began.get(n.id));
    out.set(site, Math.max(out.get(site) ?? 0, age));
  }
  return out;
}

/**
 * Where a beacon stands at page time `now`: `rise` 0..1 (eased up from
 * the plane when the crit starts, down when it clears; at once when
 * `still`), `height` its full height for its age. `b` is the scene's
 * `{ from, crit, t0 }`: `from` when its crit began (page time), `crit`
 * whether it is in crit now, `t0` when that last changed, `k0` its rise then.
 * `height` and `width` are its full size for its age (shares of the frame,
 * beaconHeight and beaconWidth).
 */
export function beaconAt(b, now, timing = BEACON, still = false) {
  const to = b.crit ? 1 : 0;
  const p = still ? 1 : Math.max(0, Math.min(1, (now - b.t0) / timing.riseMs));
  const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  const rise = (b.k0 ?? 0) + (to - (b.k0 ?? 0)) * e;
  return { rise, height: beaconHeight(now - b.from, 'crit', timing), width: beaconWidth(now - b.from, 'crit', timing) };
}

/**
 * The warp's look over a flight (night 3 T12, T28): a streak's length is
 * `len` times its point's distance from the camera (so every streak is the
 * same angle, about 3 degrees at full stretch, near grain or far star; the
 * dust takes `dust` of it, the far stars `stars`), scaled by the camera's
 * speed (the flight's ease, `ease` in layout.js, so it is longest mid-way
 * and short as the camera leaves and slows) and gone over `snap` of the
 * flight's progress, by 0.9: the sky is at rest before the plate types
 * (T15). Each streak runs from its grain toward the destination's point on
 * screen (a vanishing point at the target); the `head` share of it nearest
 * the target carries the destination's hue at full token value when its
 * tone is one of `hued` (calm stays grey). `thin` is how much of the dust's
 * light goes while it flies, `opacity` the streaks' peak (additive, so faint).
 */
export const WARP = Object.freeze({
  len: 0.055, dust: 1, stars: 0.6,
  snap: Object.freeze([0.8, 0.9]),
  head: 0.3, hued: Object.freeze(['warn', 'crit']),
  thin: 0.55, opacity: 0.4,
});

const smooth = (a, b, x) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * The warp at flight progress `k` (0..1, the flight's own time, not eased)
 * toward a destination whose worst tone is `tone`: `{ k, len, head, thin }`,
 * `k` the stretch 0..1 (the camera's speed under the flight's cubic ease,
 * as a share of its peak, square-rooted so it reads over more of the
 * flight: 2k up to half-way, 2(1 - k) after; then cut over `snap`), `len`
 * the streak length (WARP.len's share), `head` the tone whose hue the
 * streak's target end takes (`calm` unless the tone is hued), `thin` the
 * dust's loss. All 0 (head calm) outside a flight (k not strictly inside
 * 0..1, or not a number), from `snap[1]` on, in still mode, and toward a
 * tone that is not hued (calm, or the overview: night 4 T15, calm flights
 * are quiet).
 */
export function warpAt(k, tone = 'calm', still = false, timing = WARP) {
  const none = { k: 0, len: 0, head: 'calm', thin: 0 };
  if (still || !timing.hued.includes(tone) || !Number.isFinite(k) || !(k > 0 && k < 1)) return none;
  const speed = 2 * Math.min(k, 1 - k); // sqrt(ease'(k) / max ease') of the cubic ease
  const e = speed * (1 - smooth(timing.snap[0], timing.snap[1], k));
  if (!(e > 0)) return none;
  return { k: e, len: timing.len * e, head: tone, thin: timing.thin * e };
}

/**
 * Where a streak's target end sits (view space, the camera looking down -z),
 * the scene's vertex shader in plain JS so a test can pin it (T28): from the
 * grain at `p` toward the target's ray (`aim`, the target in view space) at
 * the grain's depth, by `len` of the grain's distance, never past that ray
 * (a grain by the vanishing point barely streaks). Null when the grain or the
 * target is behind the camera: the shader then streaks along the travel.
 */
export function warpTail(p, aim, len) {
  if (!(p.z < -1e-3) || !(aim.z < -1e-3)) return null;
  const s = p.z / aim.z;
  const dx = aim.x * s - p.x, dy = aim.y * s - p.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 1e-6)) return { x: p.x, y: p.y, z: p.z };
  const step = Math.min(len * Math.hypot(p.x, p.y, p.z), gap) / gap;
  return { x: p.x + dx * step, y: p.y + dy * step, z: p.z };
}
