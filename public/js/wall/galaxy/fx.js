// The galaxy's effects (Wall plan night 2 §7.C, README D9): each one behind
// `galaxy.html?fx=<name>` (comma-separated, unknown names ignored, all off
// by default), so the owner can see each and keep or drop it.
//
// `lanes` (T12): while a link between two sites is live, a light pulse runs
// along the hyperlanes from the site it leaves, in through the sun, out to
// the site it reaches. Live is the model's `live: true` on the link, or an
// event that travelled it (`event.link`, docs/map.md) in the last
// `LANES.windowMs`. Grey like everything calm: it says "these two are
// talking", never "look here". Pure: the scene (scene.js) draws it.
//
// `comets` (T13): something that just travelled a link (an event with
// `link`: a job's image pushed, a deploy, a dump; the Map's comet) is one
// small comet with a tail, once, from the planet it left to the planet it
// lands on, arcing over the plane (a lane pulse follows the hyperlanes; a
// comet flies straight). Grey unless the event itself is trouble.
//
// `twinkle` (T14): a planet with a working session on it (an agent at work:
// a lane or session whose status is `working` and calm) glimmers softly,
// slow and low, in the grey of a calm thing: "busy", never "look here". A
// planet in trouble does not twinkle (it breathes already: one motion per thing).

import { hash } from './layout.js';
import { toneOf } from './palette.js';

/** Every effect this page knows, in the order the README lists them. */
export const FX_NAMES = Object.freeze(['lanes', 'comets', 'twinkle']);

/** The effects `?fx=` asks for (a `location.search` string or URLSearchParams): a Set of known names. */
export function parseFx(search = '') {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  const asked = q.getAll('fx').flatMap((v) => v.split(',')).map((v) => v.trim().toLowerCase());
  return new Set(FX_NAMES.filter((n) => asked.includes(n)));
}

/**
 * The lane pulse's timing and look: one pulse takes `travelMs` from star to
 * star (eased, so it leaves and lands gently), then `restMs` of nothing; an
 * event keeps its route live `windowMs`; at most `maxRoutes` at once.
 * `head` is the bright sprite's size in world units, `trail` how many
 * smaller ones follow it, `gap` their spacing along the route (0..1).
 */
export const LANES = Object.freeze({
  travelMs: 4800, restMs: 1600, windowMs: 20000, maxRoutes: 6,
  head: 110, trail: 7, gap: 0.012, opacity: 0.6,
});

const MAX_DEPTH = 50;

/** The site a node is in (a `site` or `host` up its parents), else null. */
function placeOf(id, byId) {
  let n = byId.get(id);
  for (let k = 0; n && n.kind !== 'site' && n.kind !== 'host' && k < MAX_DEPTH; k++) n = byId.get(n.parent);
  return n && (n.kind === 'site' || n.kind === 'host') ? n.id : null;
}

/**
 * The live routes between sites in `model`: `{ key, from, to, live, ageMs }`
 * per pair of sites (`from>to`, the link's direction), only between two
 * different sites in `sites` (ids the galaxy draws). `live` is a link the
 * model marks live (it stays while it is); otherwise `ageMs` is how long ago
 * the newest event travelled it, by the model's own clock (`generatedAt`).
 */
export function siteRoutes(model, sites, { windowMs = LANES.windowMs } = {}) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const links = Array.isArray(model?.links) ? model.links : [];
  const events = Array.isArray(model?.events) ? model.events : [];
  const byId = new Map(nodes.filter((n) => n && n.id != null).map((n) => [n.id, n]));
  const shown = sites instanceof Set ? sites : new Set(sites ?? []);
  const now = Number.isFinite(model?.generatedAt) ? model.generatedAt : Math.max(0, ...events.map((e) => Number(e?.at) || 0));
  const named = new Map();
  for (const l of links) {
    if (!l || l.from == null || l.to == null) continue;
    named.set(`${l.from}>${l.to}`, l);
    if (l.id != null) named.set(String(l.id), l);
  }
  const out = new Map();
  const add = (l, live, ageMs) => {
    const from = placeOf(l.from, byId), to = placeOf(l.to, byId);
    if (!from || !to || from === to || !shown.has(from) || !shown.has(to)) return;
    const key = `${from}>${to}`;
    const had = out.get(key);
    if (!had) { out.set(key, { key, from, to, live, ageMs }); return; }
    had.live = had.live || live;
    had.ageMs = Math.min(had.ageMs, ageMs);
  };
  for (const l of links) if (l?.live === true) add(l, true, 0);
  for (const e of events) {
    if (!e || e.link == null) continue;
    const l = named.get(String(e.link));
    const age = now - (Number(e.at) || 0);
    if (l && age >= 0 && age < windowMs) add(l, false, age);
  }
  return [...out.values()];
}

/**
 * The routes the page keeps at page time `now` (its own clock, so a skewed
 * hub clock only counts through `ageMs`): `prev` (a Map by key, or null)
 * updated with `routes` (siteRoutes'). A route keeps the time it started
 * (`t0`) while it stays; `until` is when it stops starting new pulses
 * (Infinity while the model calls it live). A route the model no longer
 * names finishes the pulse it is in. Returns a new Map, at most
 * `maxRoutes` of them: those already running keep their place (a new one
 * waits for a free one), so a busy fleet never swaps pulses mid-flight.
 */
export function trackRoutes(prev, routes, now, timing = LANES) {
  const next = new Map();
  const old = prev instanceof Map ? prev : new Map();
  for (const r of routes ?? []) {
    const had = old.get(r.key);
    const until = r.live ? Infinity : now + Math.max(0, timing.windowMs - r.ageMs);
    next.set(r.key, { key: r.key, from: r.from, to: r.to, t0: had && pulseAt(had, now, timing) !== undefined ? had.t0 : now, until });
  }
  for (const [key, r] of old) {
    if (next.has(key)) continue;
    const kept = { ...r, until: Math.min(r.until, now) };
    if (pulseAt(kept, now, timing) !== undefined) next.set(key, kept);
  }
  const list = [...next.values()].sort((a, b) => a.t0 - b.t0).slice(0, timing.maxRoutes);
  return new Map(list.map((r) => [r.key, r]));
}

/**
 * Where a route's pulse is at `now`: `{ u, k }` with `u` 0..1 along the
 * route (eased: it leaves and lands gently) and `k` 0..1 its strength
 * (fading in at the start, out at the end); `null` between pulses;
 * `undefined` once the route is over (the period now running started
 * at or after `until`, so a pulse already on its way always lands).
 */
export function pulseAt(route, now, timing = LANES) {
  const period = timing.travelMs + timing.restMs;
  const since = now - route.t0;
  if (since < 0) return null;
  const n = Math.floor(since / period);
  const start = route.t0 + n * period;
  const p = (since - n * period) / timing.travelMs;
  if (start >= route.until) return undefined;
  if (p >= 1) return null;
  const u = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  const k = Math.min(1, p / 0.12, (1 - p) / 0.12);
  return { u, k };
}

/**
 * One route's path from its two hyperlanes (each a flat array of x,y,z
 * from the sun out to its star, as scene.js draws them): out of `from`'s
 * star, in to the sun, out to `to`'s star. Returns `{ at(u) }` giving a
 * point `{ x, y, z }` at `u` 0..1 of its length.
 */
export function routePath(fromLane, toLane) {
  const pts = [];
  const push = (a, i) => pts.push([a[i], a[i + 1], a[i + 2]]);
  for (let i = fromLane.length - 3; i >= 0; i -= 3) push(fromLane, i);
  for (let i = 3; i < toLane.length; i += 3) push(toLane, i);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    acc.push(acc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = acc.at(-1) || 1;
  const at = (u) => {
    const d = Math.max(0, Math.min(1, u)) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < d) i++;
    const [a, b] = [pts[i - 1] ?? [0, 0, 0], pts[i] ?? pts[i - 1] ?? [0, 0, 0]];
    const seg = acc[i] - acc[i - 1];
    const f = seg > 0 ? (d - acc[i - 1]) / seg : 0;
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f };
  };
  return { at, length: total };
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
