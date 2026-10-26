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

/** Every effect this page knows, in the order the README lists them. */
export const FX_NAMES = Object.freeze(['lanes']);

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
