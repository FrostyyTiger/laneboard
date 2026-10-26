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
// once per cycle.

import { SEVERITY, TROUBLE, byIdOf, kidsOf, rollup } from '../views/map/model.js';

/**
 * Normal speed: the overview ~20 s, then each site ~25 s once the camera is
 * there. `flyMs` is the time a flight takes in ambient mode (the Map's
 * longest flight, 900 ms, times its ambient 2.5), counted before the hold so
 * the hold starts on arrival.
 */
export const TIMING = Object.freeze({ overviewMs: 20000, flyMs: 2250, holdMs: 25000, zoom: 2.3 });

/** `?demo=1`, for videos: ~4 s per site, overview included. */
export const DEMO_TIMING = Object.freeze({ overviewMs: 4000, flyMs: 2250, holdMs: 1750, zoom: 2.3 });

export const timingFor = (demo) => (demo ? DEMO_TIMING : TIMING);

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
      state: { cycle, phase: 'overview', visited: [], count: order.length },
      leg: { kind: 'overview', cycle, ms: timing.overviewMs },
    };
  }
  const seen = new Set(state.visited);
  const next = order.find((s) => !seen.has(s.id));
  if (!next) {
    return nextLeg({ ...state, phase: 'done' }, nodes, timing);
  }
  const visited = [...state.visited, next.id];
  // Sites that appear mid-cycle count from the next one; the index never passes the count.
  const count = Math.max(state.count, visited.length);
  return {
    state: { cycle: state.cycle, phase: 'site', visited, count },
    leg: {
      kind: 'site', id: next.id, label: next.label, status: next.status,
      index: visited.length, count, cycle: state.cycle,
      arriveMs: timing.flyMs, ms: timing.flyMs + timing.holdMs,
    },
  };
}

/**
 * The driver: runs legs on a timer and moves the map. `map` needs
 * `focus(id, zoom)` and `fit()`; `update(model)` gives it the newest model;
 * `onLeg(cb)` tells later layers (caption, lock) where the camera goes,
 * each site leg with the `zoom` it flies to: `zoomFor(leg)` when the page
 * gives one (a variant whose overview is not the scale its holds want),
 * else the timing's. `timers` is injectable for tests.
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
