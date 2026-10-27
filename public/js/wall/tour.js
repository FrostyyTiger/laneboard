// The Wall's camera tour (docs/plans/wall/README.md §3, D4): the screensaver.
// An overview, then the camera flies into one site, holds, and goes on to the
// next; when every site was visited it flies back out and the cycle starts
// again. Trouble first (§2.1): a site with anything at warn or worse below it
// is visited before the calm ones, worst first, every cycle while it lasts.
//
// The order and the timing are pure (test/wall-tour.test.mjs imports them);
// `createTour` is the small driver that turns them into `map.focus(id, zoom)`
// and `map.fit()` calls on a timer.
//
// The order is taken again before every site, from the model as it is then:
// a site that turns bad mid-cycle jumps ahead of the calm ones still to come,
// and a site that cleared falls back into the calm order. A site is visited
// once per cycle, except trouble at the normal speed: it holds longer, and
// after every `revisitEvery` calm sites the camera goes back to it (in turn,
// worst first), so a crit is never long out of sight (owner, 2026-10-26).
// A site already visited this cycle whose status rose since (calm to warn,
// warn to crit) jumps the queue at the next leg like new trouble does: the
// camera does not wait for the next cycle to show a crit as crit (T21).

import { SEVERITY, TROUBLE, byIdOf, kidsOf, rollup } from '../views/map/model.js';

/**
 * Normal speed, slow enough to read from across the room (owner, 2026-10-26):
 * the overview 10 s, a calm site 6 s and a site in trouble 14 s once the
 * camera is there, and trouble revisited after every 2 calm sites. `flyMs` is
 * the time a flight takes in ambient mode (the Map's longest flight, 900 ms,
 * times its ambient 2.5), counted before the hold so the hold starts on arrival.
 */
export const TIMING = Object.freeze({
  overviewMs: 10000, flyMs: 2250, holdMs: 6000, troubleHoldMs: 14000, revisitEvery: 2, zoom: 2.3,
});

/** `?demo=1`, for videos: ~4 s per site, overview included. */
export const DEMO_TIMING = Object.freeze({ overviewMs: 4000, flyMs: 2250, holdMs: 1750, zoom: 2.3 });

export const timingFor = (demo) => (demo ? DEMO_TIMING : TIMING);

/** How long the camera holds on `site` (a tourSites entry). */
export const holdFor = (site, timing = TIMING) =>
  (site.trouble && timing.troubleHoldMs > 0 ? timing.troubleHoldMs : timing.holdMs);

// laneboard's repo index is a site in the model but no place in the fleet:
// toured only when something in it is in trouble.
const CALM_SKIP = new Set(['__repos']);

/**
 * The sites to tour with the status each shows (its subtree's trouble rolled
 * up, model.js `rollup`), in model order: `[{ id, label, status, trouble }]`.
 */
export function tourSites(nodes) {
  const list = Array.isArray(nodes) ? nodes.filter((n) => n && typeof n.id === 'string') : [];
  const byId = byIdOf(list);
  const kids = kidsOf(list, byId);
  const memo = new Map();
  const out = [];
  for (const n of list) {
    if (n.kind !== 'site') continue;
    // `down` on the site itself stays down; below it, rollup reads it as crit.
    const status = n.status === 'down' ? 'down' : rollup(n.id, byId, kids, memo);
    const trouble = TROUBLE.includes(status);
    if (!trouble && CALM_SKIP.has(n.id)) continue;
    out.push({ id: n.id, label: n.label ?? n.id, status, trouble });
  }
  return out;
}

/**
 * The order to visit sites in: those in trouble first, worst first, then the
 * calm ones; ties keep model order. Returns the site entries of tourSites.
 */
export function tourOrder(nodes) {
  const sites = tourSites(nodes);
  const rank = (s) => (s.trouble ? SEVERITY.indexOf(s.status) : -1);
  return sites
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(b.s) - rank(a.s) || a.i - b.i)
    .map((x) => x.s);
}

/** A tour that has not started: the next leg is the overview. */
export const initialTour = () => ({ cycle: 0, phase: 'start', visited: [], count: 0 });

/**
 * The leg after `state`, pure. Returns `{ state, leg }`: `leg` is
 * `{ kind: 'overview', cycle, ms }` or `{ kind: 'site', id, label, status,
 * index, count, cycle, ms, arriveMs }` (index 1-based of count sites this
 * cycle, for the caption's `TARGET 02 / 05`; `arriveMs` when the camera is
 * there; `ms` the whole leg).
 */
export function nextLeg(state, nodes, timing = TIMING) {
  const order = tourOrder(nodes);
  if (state.phase !== 'site' && state.phase !== 'overview') {
    // A new cycle: back out to the overview, then take the order afresh.
    const cycle = state.phase === 'start' ? state.cycle : state.cycle + 1;
    return {
      state: { cycle, phase: 'overview', visited: [], count: order.length, shown: {} },
      leg: { kind: 'overview', cycle, ms: timing.overviewMs },
    };
  }
  const seen = new Set(state.visited);
  // `shown`: the status each visited site had when the camera was last there.
  const shown = state.shown ?? {};
  const rose = (s) => s.trouble && seen.has(s.id) && s.id in shown
    && SEVERITY.indexOf(s.status) > SEVERITY.indexOf(shown[s.id]);
  // Trouble comes first in the order, worst first, so a site that rose is
  // taken before a milder unvisited one and before every calm one.
  let next = order.find((s) => !seen.has(s.id) || rose(s));
  if (!next) {
    return nextLeg({ ...state, phase: 'done' }, nodes, timing);
  }
  // After `revisitEvery` calm sites in a row, back to trouble already seen
  // this cycle (in turn, worst first) before the next calm one.
  const every = timing.revisitEvery > 0 ? timing.revisitEvery : 0;
  let calmRun = state.calmRun ?? 0;
  let revisits = state.revisits ?? 0;
  if (!next.trouble && every && calmRun >= every) {
    const seenTrouble = order.filter((s) => s.trouble && seen.has(s.id));
    if (seenTrouble.length) {
      next = seenTrouble[revisits % seenTrouble.length];
      revisits += 1;
    }
  }
  calmRun = next.trouble ? 0 : calmRun + 1;
  const visited = seen.has(next.id) ? state.visited : [...state.visited, next.id];
  // Sites that appear mid-cycle count from the next one; the index never passes the count.
  const count = Math.max(state.count, visited.length);
  return {
    state: {
      cycle: state.cycle, phase: 'site', visited, count, calmRun, revisits,
      shown: { ...shown, [next.id]: next.status },
    },
    leg: {
      kind: 'site', id: next.id, label: next.label, status: next.status,
      index: visited.indexOf(next.id) + 1, count, cycle: state.cycle,
      arriveMs: timing.flyMs, ms: timing.flyMs + holdFor(next, timing),
    },
  };
}

/**
 * The tour taken up again after a finger had the page (night 3 T14, README
 * §7 Night 3 C5): a fresh cycle whose next leg is the worst site of the
 * order as it is now (trouble first), not the overview the finger just saw
 * and not whatever calm site was due when it stopped. `overview: true` (a
 * show's undo, cockpit c4-show-canvas.md §5 and screens.md §2) starts the
 * fresh cycle with the overview instead. Pure.
 */
export function resumeTour(state, nodes, { overview = false } = {}) {
  const cycle = (state?.cycle ?? 0) + 1;
  if (overview) return { ...initialTour(), cycle };
  return {
    cycle, phase: 'overview', visited: [], count: tourOrder(nodes).length, shown: {},
  };
}

/**
 * The driver: runs legs on a timer and moves the map. `map` needs
 * `focus(id, zoom)` and `fit()`; `update(model)` gives it the newest model;
 * `onLeg(cb)` tells later layers (caption, lock) where the camera goes,
 * each site leg with the `zoom` it flies to: `zoomFor(leg)` when the page
 * gives one (a variant whose overview is not the scale its holds want),
 * else the timing's. `resume(opts)` starts a stopped tour again at `resumeTour`'s
 * next leg (T14; `{ overview: true }` with the overview). `timers` is injectable for tests.
 */
export function createTour(map, { timing = TIMING, timers = globalThis, zoomFor = null } = {}) {
  let nodes = [];
  let state = initialTour();
  let timer = null;
  let running = false;
  let current = null;
  const legCbs = new Set();

  const step = () => {
    timer = null;
    if (!running) return;
    const r = nextLeg(state, nodes, timing);
    state = r.state;
    current = r.leg;
    if (current.kind === 'overview') map.fit();
    else {
      const z = typeof zoomFor === 'function' ? zoomFor(current) : null;
      current = { ...current, zoom: Number.isFinite(z) && z > 0 ? z : timing.zoom };
      map.focus(current.id, current.zoom);
    }
    for (const cb of legCbs) cb(current);
    timer = timers.setTimeout(step, current.ms);
  };

  return {
    update: (model) => { nodes = Array.isArray(model?.nodes) ? model.nodes : []; },
    start: () => {
      if (running) return;
      running = true;
      step();
    },
    resume: (opts) => {
      if (running) return;
      state = resumeTour(state, nodes, opts);
      running = true;
      step();
    },
    stop: () => {
      running = false;
      if (timer != null) timers.clearTimeout(timer);
      timer = null;
    },
    onLeg: (cb) => {
      if (typeof cb !== 'function') return () => {};
      legCbs.add(cb);
      return () => legCbs.delete(cb);
    },
    leg: () => current,
    state: () => state,
  };
}
