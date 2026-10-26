// The Wall's camera tour (Wall plan T5, docs/plans/wall/README.md §3, D4):
// trouble visited first, worst first; a cleared site back in the calm order
// next cycle; the demo speed; and the driver moving the map on its timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tourSites, tourOrder, nextLeg, initialTour, createTour, TIMING, DEMO_TIMING, timingFor, holdFor,
} from '../public/js/wall/tour.js';

/** TIMING without the trouble revisits: each site once per cycle. */
const ONCE = { ...TIMING, revisitEvery: 0 };

/** Five sites under a core, each with a room and a service; `bad` sets statuses by id. */
function fleet(bad = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-svc`, parent: `${s}-room`, kind: 'service', status: 'ok' });
  }
  nodes.push({ id: '__repos', parent: '__core', kind: 'site', label: 'REPOS', status: 'ok' });
  for (const n of nodes) if (bad[n.id]) n.status = bad[n.id];
  return nodes;
}

/** The site ids one whole cycle visits, starting from `state`. */
function cycle(state, nodes, timing = TIMING) {
  let r = nextLeg(state, nodes, timing);
  assert.equal(r.leg.kind, 'overview', 'a cycle starts on the overview');
  const ids = [];
  for (;;) {
    const n = nextLeg(r.state, nodes, timing);
    if (n.leg.kind === 'overview') return { ids, state: r.state };
    ids.push(n.leg.id);
    r = n;
  }
}

test('tour: sites carry the worst status below them; the repo index only when in trouble', () => {
  const sites = tourSites(fleet({ 'hv2-svc': 'crit', 'remote-room': 'warn' }));
  assert.deepEqual(sites.map((s) => [s.id, s.status, s.trouble]), [
    ['hv1', 'ok', false], ['hv2', 'crit', true], ['cloud', 'ok', false], ['remote', 'warn', true], ['home', 'ok', false],
  ]);
  const withRepoTrouble = fleet();
  withRepoTrouble.push({ id: 'repo:x', parent: '__repos', kind: 'repo', status: 'attention' });
  assert.ok(tourSites(withRepoTrouble).some((s) => s.id === '__repos'));
  assert.equal(tourSites(fleet({ home: 'down' })).find((s) => s.id === 'home').status, 'down');
  assert.deepEqual(tourSites(null), []);
});

test('tour: trouble first, worst first, then the calm sites in model order', () => {
  const order = tourOrder(fleet({ 'cloud-svc': 'warn', 'home-room': 'crit', 'hv1-svc': 'attention' }));
  assert.deepEqual(order.map((s) => s.id), ['home', 'hv1', 'cloud', 'hv2', 'remote']);
  assert.deepEqual(tourOrder(fleet()).map((s) => s.id), ['hv1', 'hv2', 'cloud', 'remote', 'home']);
  // down beats crit; equal trouble keeps model order
  const o2 = tourOrder(fleet({ remote: 'down', 'hv2-svc': 'crit', 'cloud-svc': 'crit' }));
  assert.deepEqual(o2.map((s) => s.id), ['remote', 'hv2', 'cloud', 'hv1', 'home']);
});

test('tour: a cycle visits each site once, trouble first; a cleared site falls back next cycle', () => {
  const bad = fleet({ 'home-svc': 'crit' });
  const c1 = cycle(initialTour(), bad, ONCE);
  assert.deepEqual(c1.ids, ['home', 'hv1', 'hv2', 'cloud', 'remote']);
  const calm = fleet();
  const c2 = cycle(c1.state, calm, ONCE);
  assert.deepEqual(c2.ids, ['hv1', 'hv2', 'cloud', 'remote', 'home'], 'home is calm again: last, in model order');
});

test('tour: trouble that starts mid-cycle jumps ahead of the calm sites still to come', () => {
  let r = nextLeg(initialTour(), fleet());
  r = nextLeg(r.state, fleet());
  assert.equal(r.leg.id, 'hv1');
  r = nextLeg(r.state, fleet({ 'remote-svc': 'warn' }));
  assert.equal(r.leg.id, 'remote', 'the warn goes before hv2 and cloud');
  r = nextLeg(r.state, fleet({ 'remote-svc': 'warn' }));
  assert.equal(r.leg.id, 'hv2', 'and is not visited twice');
});

test('tour: legs carry index and count for the caption, and the timing', () => {
  let r = nextLeg(initialTour(), fleet());
  assert.deepEqual(r.leg, { kind: 'overview', cycle: 0, ms: TIMING.overviewMs });
  r = nextLeg(r.state, fleet({ 'cloud-svc': 'crit' }));
  assert.equal(r.leg.kind, 'site');
  assert.equal(r.leg.id, 'cloud');
  assert.equal(r.leg.status, 'crit');
  assert.equal(r.leg.index, 1);
  assert.equal(r.leg.count, 5);
  assert.equal(r.leg.arriveMs, TIMING.flyMs);
  assert.equal(r.leg.ms, TIMING.flyMs + TIMING.troubleHoldMs, 'trouble holds longer');
  r = nextLeg(r.state, fleet({ 'cloud-svc': 'crit' }));
  assert.equal(r.leg.ms, TIMING.flyMs + TIMING.holdMs, 'a calm site the normal hold');
  // the next cycle counts up
  const c = cycle(initialTour(), fleet());
  assert.equal(nextLeg(c.state, fleet()).leg.cycle, 1);
});

test('tour: at normal speed trouble comes back after every two calm sites, in turn', () => {
  const c = cycle(initialTour(), fleet({ 'home-svc': 'crit', 'cloud-svc': 'warn' }));
  assert.deepEqual(c.ids, ['home', 'cloud', 'hv1', 'hv2', 'home', 'remote']);
  const legs = [];
  let r = nextLeg(initialTour(), fleet({ 'home-svc': 'crit' }));
  for (let i = 0; i < 7; i++) {
    r = nextLeg(r.state, fleet({ 'home-svc': 'crit' }));
    legs.push(r.leg);
  }
  assert.deepEqual(legs.map((l) => l.kind === 'site' ? l.id : 'overview'),
    ['home', 'hv1', 'hv2', 'home', 'cloud', 'remote', 'overview']);
  assert.equal(legs[3].index, 1, 'a revisit keeps the index of its first visit');
  assert.ok(legs.every((l) => l.kind !== 'site' || l.index <= l.count));
  // without trouble the cycle is the plain calm round
  assert.deepEqual(cycle(initialTour(), fleet()).ids, ['hv1', 'hv2', 'cloud', 'remote', 'home']);
});

test('tour: no sites means the overview, cycle after cycle', () => {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  let r = nextLeg(initialTour(), nodes);
  r = nextLeg(r.state, nodes);
  assert.equal(r.leg.kind, 'overview');
  assert.equal(r.leg.cycle, 1);
});

test('tour: timing, normal and demo', () => {
  assert.equal(timingFor(false), TIMING);
  assert.equal(timingFor(true), DEMO_TIMING);
  assert.equal(TIMING.overviewMs, 10000);
  assert.equal(TIMING.holdMs, 6000);
  assert.equal(TIMING.troubleHoldMs, 14000);
  assert.equal(TIMING.revisitEvery, 2);
  assert.equal(holdFor({ trouble: true }, DEMO_TIMING), DEMO_TIMING.holdMs, 'the demo holds trouble no longer');
  assert.equal(TIMING.zoom, 2.3);
  assert.equal(DEMO_TIMING.zoom, TIMING.zoom);
  const perSite = DEMO_TIMING.flyMs + DEMO_TIMING.holdMs;
  assert.ok(perSite >= 3500 && perSite <= 4500, `demo ~4 s per site (${perSite})`);
  assert.ok(DEMO_TIMING.overviewMs <= 5000);
});

test('tour driver: fits, flies to each site at the tour zoom on the timer, stops cleanly', () => {
  const calls = [];
  const map = { fit: () => calls.push(['fit']), focus: (id, z) => calls.push(['focus', id, z]) };
  const queue = [];
  const timers = {
    setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
    clearTimeout: (h) => { queue[h - 1].fn = null; },
  };
  const tour = createTour(map, { timing: DEMO_TIMING, timers });
  const legs = [];
  tour.onLeg((l) => legs.push(l.kind === 'site' ? l.id : 'overview'));
  tour.update({ nodes: fleet({ 'hv2-svc': 'warn' }) });
  tour.start();
  tour.start(); // a second start (every model) does nothing
  assert.deepEqual(calls, [['fit']]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].ms, DEMO_TIMING.overviewMs);
  const run = () => { const t = queue[queue.length - 1]; t.fn?.(); };
  run();
  assert.deepEqual(calls.at(-1), ['focus', 'hv2', 2.3]);
  assert.equal(queue.at(-1).ms, DEMO_TIMING.flyMs + DEMO_TIMING.holdMs);
  for (let i = 0; i < 5; i++) run();
  assert.deepEqual(legs, ['overview', 'hv2', 'hv1', 'cloud', 'remote', 'home', 'overview']);
  assert.deepEqual(calls.at(-1), ['fit']);
  assert.equal(tour.leg().kind, 'overview');
  tour.stop();
  const n = calls.length;
  run();
  assert.equal(calls.length, n, 'stopped: no more moves');
});

test('tour driver: a page\'s zoomFor sets the zoom of each site leg, the timing\'s when it gives none', () => {
  const calls = [];
  const map = { fit: () => calls.push(['fit']), focus: (id, z) => calls.push(['focus', id, z]) };
  const queue = [];
  const timers = { setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; }, clearTimeout: () => {} };
  let z = 3.2;
  const tour = createTour(map, { timing: DEMO_TIMING, timers, zoomFor: () => z });
  const legs = [];
  tour.onLeg((l) => legs.push(l));
  tour.update({ nodes: fleet({ 'hv2-svc': 'warn' }) });
  tour.start();
  queue.at(-1).fn();
  assert.deepEqual(calls.at(-1), ['focus', 'hv2', 3.2]);
  assert.equal(legs.at(-1).zoom, 3.2, 'the leg says the zoom, for the lock and the glow');
  z = NaN;
  queue.at(-1).fn();
  assert.deepEqual(calls.at(-1), ['focus', 'hv1', DEMO_TIMING.zoom]);
  assert.equal(legs[0].zoom, undefined, 'an overview leg has none');
});
