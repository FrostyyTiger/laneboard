// The galaxy's effects (Wall plan night 2 T12, README §7.C, D9): `?fx=`
// turns them on one by one, none by default; `lanes` runs a light pulse
// along the hyperlanes between two sites while a link between them is live
// (the model's `live`, or an event that travelled it a moment ago);
// `comets` (T13) flies one comet per event that travelled a link, once,
// from the planet it left to the one it lands on; `twinkle` (T14) lights a
// planet softly while a session on it is at work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEACON, COMETS, FX_NAMES, LANES, TWINKLE, beaconAt, beaconHeight, beaconNear, beaconScale, beaconWidth, beamProfile, coreProfile, cometAt, critAges, cometPath, flowComets, parseFx, pulseAt, routePath, siteRoutes, trackComets,
  trackRoutes, trackTwinkles, twinkleAt, workingPlanets,
} from '../public/js/wall/galaxy/fx.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { FOV, createGalaxyScene, overviewShot } from '../public/js/wall/galaxy/scene.js';
import { ndcOf } from '../public/js/wall/galaxy/framing.js';

test('parseFx: nothing by default, known names only, comma-separated or repeated, any case', () => {
  assert.deepEqual([...parseFx('')], []);
  assert.deepEqual([...parseFx('?demo=1')], []);
  assert.deepEqual([...parseFx('?fx=lanes,bogus')], ['lanes']);
  assert.deepEqual([...parseFx('?fx=bogus')], []);
  assert.deepEqual([...parseFx('?fx= Lanes ')], ['lanes']);
  assert.deepEqual([...parseFx('?fx=bogus&fx=lanes')], ['lanes']);
  assert.deepEqual([...parseFx(new URLSearchParams('fx=lanes'))], ['lanes']);
  assert.ok(FX_NAMES.includes('lanes'));
  assert.deepEqual([...parseFx('?fx=comets,lanes')].sort(), ['comets', 'lanes']);
  assert.deepEqual([...parseFx('?fx=lanes')], ['lanes'], 'comets only when asked');
  assert.deepEqual([...parseFx('?fx=twinkle,bogus')], ['twinkle']);
  assert.deepEqual([...parseFx('?fx=beacon')], ['beacon']);
});

/** Three sites under a core; `db` in hv1, `storage` in hv2, `nas` in remote, `api` a second hv1 room. */
function model({ links = [], events = [], generatedAt = 100_000 } = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'remote']) nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
  nodes.push(
    { id: 'db', parent: 'hv1', kind: 'room', status: 'ok' },
    { id: 'api', parent: 'hv1', kind: 'room', status: 'ok' },
    { id: 'db-svc', parent: 'db', kind: 'service', status: 'ok' },
    { id: 'storage', parent: 'hv2', kind: 'room', status: 'ok' },
    { id: 'nas', parent: 'remote', kind: 'room', status: 'ok' },
  );
  return { nodes, links, events, generatedAt };
}
const SITES = ['hv1', 'hv2', 'remote'];

test('siteRoutes: a live link between two sites is a route, by the sites its ends are in', () => {
  const m = model({ links: [{ from: 'db-svc', to: 'storage', kind: 'flow', live: true }] });
  assert.deepEqual(siteRoutes(m, SITES), [{ key: 'hv1>hv2', from: 'hv1', to: 'hv2', live: true, ageMs: 0 }]);
});

test('siteRoutes: an idle link, a link inside one site, or to a site not drawn is no route', () => {
  const m = model({
    links: [
      { from: 'db', to: 'storage', kind: 'flow', live: false },
      { from: 'db', to: 'api', kind: 'flow', live: true },
      { from: 'storage', to: 'nas', kind: 'flow', live: true },
    ],
  });
  assert.deepEqual(siteRoutes(m, SITES).map((r) => r.key), ['hv2>remote']);
  assert.deepEqual(siteRoutes(m, ['hv1', 'hv2']), [], 'remote is not drawn');
  assert.deepEqual(siteRoutes({}, SITES), []);
  assert.deepEqual(siteRoutes(null, SITES), []);
});

test('siteRoutes: an event that travelled a link makes it live for the window, by the model clock', () => {
  const links = [{ id: 'dump', from: 'db', to: 'storage', kind: 'flow' }, { from: 'storage', to: 'nas', kind: 'flow' }];
  const events = [
    { at: 95_000, node: 'db', kind: 'ok', text: 'dump', link: 'dump' }, // by id, 5 s ago
    { at: 100_000 - LANES.windowMs - 1, node: 'storage', kind: 'ok', text: 'copy', link: 'storage>nas' }, // too old
    { at: 99_000, node: 'db', kind: 'ok', text: '?', link: 'nowhere>else' },
  ];
  const got = siteRoutes(model({ links, events }), SITES);
  assert.deepEqual(got, [{ key: 'hv1>hv2', from: 'hv1', to: 'hv2', live: false, ageMs: 5000 }]);
  // A fresh copy along the second link too, by `from>to`.
  events.push({ at: 99_500, node: 'storage', kind: 'ok', text: 'copy', link: 'storage>nas' });
  assert.deepEqual(siteRoutes(model({ links, events }), SITES).map((r) => [r.key, r.ageMs]), [['hv1>hv2', 5000], ['hv2>remote', 500]]);
  // Two links between the same two sites are one route, the newest age.
  const two = siteRoutes(model({
    links: [{ from: 'db', to: 'storage' }, { from: 'api', to: 'storage' }],
    events: [{ at: 90_000, link: 'db>storage' }, { at: 98_000, link: 'api>storage' }],
  }), SITES);
  assert.deepEqual(two.map((r) => [r.key, r.ageMs]), [['hv1>hv2', 2000]]);
});

const T = { ...LANES, travelMs: 1000, restMs: 500, windowMs: 4000 };

test('pulseAt: one eased pass per period, fading at both ends, nothing in the rest, over after until', () => {
  const r = { t0: 1000, until: Infinity };
  assert.equal(pulseAt(r, 500, T), null, 'not started');
  const start = pulseAt(r, 1000, T);
  assert.equal(start.u, 0);
  assert.equal(start.k, 0, 'fades in');
  const mid = pulseAt(r, 1500, T);
  assert.equal(mid.u, 0.5);
  assert.equal(mid.k, 1);
  assert.ok(pulseAt(r, 1100, T).u < 0.1, 'eased out of the star');
  assert.equal(pulseAt(r, 2200, T), null, 'resting');
  assert.equal(pulseAt(r, 2500, T).u, 0, 'the next pulse');
  // Until 2000: the first pulse lands, the second never starts.
  const ending = { t0: 1000, until: 1800 };
  assert.ok(pulseAt(ending, 1900, T).u > 0.8);
  assert.equal(pulseAt(ending, 2200, T), null);
  assert.equal(pulseAt(ending, 2600, T), undefined);
});

test('trackRoutes: an event keeps its route for the rest of the window; a live one until it is not', () => {
  let m = trackRoutes(null, [{ key: 'a>b', from: 'a', to: 'b', live: false, ageMs: 1000 }], 10_000, T);
  assert.deepEqual(m.get('a>b'), { key: 'a>b', from: 'a', to: 'b', t0: 10_000, until: 13_000 });
  // The same route again later keeps its start (no jump), takes the new window.
  m = trackRoutes(m, [{ key: 'a>b', from: 'a', to: 'b', live: false, ageMs: 0 }], 11_200, T);
  assert.equal(m.get('a>b').t0, 10_000);
  assert.equal(m.get('a>b').until, 15_200);
  // Live: no end while the model says so; gone from the model mid-pulse, it lands and stops.
  let l = trackRoutes(null, [{ key: 'c>d', from: 'c', to: 'd', live: true, ageMs: 0 }], 0, T);
  assert.equal(l.get('c>d').until, Infinity);
  l = trackRoutes(l, [], 3200, T);
  assert.equal(l.get('c>d').until, 3200, 'kept: the pulse that started at 3000 is on its way');
  assert.ok(pulseAt(l.get('c>d'), 3900, T).u > 0.5);
  l = trackRoutes(l, [], 4600, T);
  assert.equal(l.size, 0, 'gone once it is over');
  // A route that ended and comes back starts fresh.
  const back = trackRoutes(new Map([['a>b', { key: 'a>b', from: 'a', to: 'b', t0: 0, until: 100 }]]), [{ key: 'a>b', from: 'a', to: 'b', live: false, ageMs: 0 }], 9000, T);
  assert.equal(back.get('a>b').t0, 9000);
  // At most maxRoutes: those already running keep their place.
  const many = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}>x`, from: `s${i}`, to: 'x', live: true, ageMs: 0 }));
  let k = new Map();
  for (const [i, r] of many.entries()) k = trackRoutes(k, many.slice(0, i + 1), i * 10, T);
  assert.equal(k.size, T.maxRoutes);
  assert.ok(k.has('s0>x') && !k.has('s8>x'));
});

test('routePath: out of the first star, through the sun, out to the second, by length', () => {
  // Two straight lanes from the sun: to (1000,0,0) and to (0,0,500).
  const lane = (x, z, n = 10) => Float32Array.from({ length: (n + 1) * 3 }, (_, i) => [x, 0, z][i % 3] * Math.floor(i / 3) / n);
  const p = routePath(lane(1000, 0), lane(0, 500));
  assert.equal(Math.round(p.length), 1500);
  const at = (u) => Object.values(p.at(u)).map((v) => Math.round(v));
  assert.deepEqual(at(0), [1000, 0, 0]);
  assert.deepEqual(at(1 / 3), [500, 0, 0]);
  assert.deepEqual(at(2 / 3), [0, 0, 0], 'the sun');
  assert.deepEqual(at(1), [0, 0, 500]);
  assert.deepEqual(at(2), [0, 0, 500], 'clamped');
});

// --- in the scene ---------------------------------------------------------------

const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    }),
  }),
};

function sceneAt(opts = {}) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
    ...opts,
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

/** The scene's pulse lights (named `fx-lane`). */
function pulseSprites(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return root.children.filter((o) => o.isSprite && o.name === 'fx-lane');
}

const liveModel = () => model({ links: [{ from: 'db', to: 'storage', kind: 'flow', live: true }] });

test('without fx=lanes the scene makes no pulse and ignores routes', () => {
  const { galaxy, at } = sceneAt();
  const m = liveModel();
  galaxy.update(m);
  assert.equal(pulseSprites(galaxy).length, 0, 'no pool');
  galaxy.setRoutes(siteRoutes(m, galaxy.world.byId.keys()));
  at(1000 + LANES.travelMs / 2);
  assert.equal(galaxy.routes.size, 0);
  assert.equal(pulseSprites(galaxy).length, 0);
});

test('with fx=lanes a live link runs a pulse from one star to the other, and stops after it goes', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['lanes']) });
  const m = liveModel();
  galaxy.update(m);
  const pool = pulseSprites(galaxy);
  assert.equal(pool.length, LANES.maxRoutes * (1 + LANES.trail), 'one pool, made once');
  galaxy.setRoutes(siteRoutes(m, galaxy.world.byId.keys()));
  assert.deepEqual([...galaxy.routes.keys()], ['hv1>hv2']);
  const hv1 = galaxy.world.byId.get('hv1').home, hv2 = galaxy.world.byId.get('hv2').home;
  const head = () => pool.find((s) => s.visible && s.scale.x === LANES.head);
  at(1000 + LANES.travelMs * 0.02);
  const near = (p, h) => Math.hypot(p.x - h.x, p.z - h.z);
  assert.ok(near(head().position, hv1) < near(head().position, hv2), 'leaves hv1');
  at(1000 + LANES.travelMs * 0.5);
  assert.ok(Math.hypot(head().position.x, head().position.z) < Math.hypot(hv1.x, hv1.z) * 0.5, 'by the sun halfway');
  assert.ok(pool.filter((s) => s.visible).length > 1, 'a trail behind it');
  at(1000 + LANES.travelMs * 0.98);
  assert.ok(near(head().position, hv2) < near(head().position, hv1), 'lands at hv2');
  for (const s of pool.filter((x) => x.visible)) assert.ok(s.material.opacity <= LANES.opacity, 'never brighter than its cap');
  at(1000 + LANES.travelMs + LANES.restMs / 2);
  assert.equal(pool.filter((s) => s.visible).length, 0, 'rest between pulses');
  // The link idles: the next pulse never starts and the route is dropped.
  galaxy.setRoutes([]);
  at(1000 + 3 * (LANES.travelMs + LANES.restMs));
  assert.equal(galaxy.routes.size, 0);
  assert.equal(pool.filter((s) => s.visible).length, 0);
});

test('with fx=lanes under reduced motion the route is a still row of lights', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['lanes']), still: true });
  const m = liveModel();
  galaxy.update(m);
  galaxy.setRoutes(siteRoutes(m, galaxy.world.byId.keys()));
  const lit = () => pulseSprites(galaxy).filter((s) => s.visible).map((s) => [s.position.x, s.position.z, s.material.opacity]);
  at(1000 + LANES.travelMs * 0.3);
  const a = lit();
  at(1000 + LANES.travelMs * 1.1); // the moving one would be resting here
  assert.equal(a.length, 1 + LANES.trail);
  assert.deepEqual(lit(), a, 'nothing moves');
});

// --- fx=comets ------------------------------------------------------------------

test('flowComets: an event along a link is a comet from the drawn thing it left to the one it lands on', () => {
  const links = [{ id: 'dump', from: 'db-svc', to: 'storage', kind: 'flow' }, { from: 'db', to: 'api', kind: 'flow' }];
  const events = [
    { at: 97_000, node: 'db', kind: 'ok', text: 'db dumps → storage', link: 'dump' },
    { at: 99_000, node: 'db', kind: 'crit', text: 'deploy failed', link: 'db>api' },
    { at: 99_500, node: 'db', kind: 'ok', text: 'no link' },
  ];
  // db-svc is drawn: it is its own end.
  const drawn = ['hv1', 'hv2', 'remote', 'db', 'api', 'db-svc', 'storage', 'nas'];
  assert.deepEqual(flowComets(model({ links, events }), drawn), [
    { key: '97000:dump', from: 'db-svc', to: 'storage', fromSite: 'hv1', toSite: 'hv2', tone: 'calm', ageMs: 3000 },
    { key: '99000:db>api', from: 'db', to: 'api', fromSite: 'hv1', toSite: 'hv1', tone: 'crit', ageMs: 1000 },
  ], 'oldest first; a failed one in its hue');
  // db-svc not drawn: the comet leaves its room.
  assert.equal(flowComets(model({ links, events }), drawn.filter((d) => d !== 'db-svc'))[0].from, 'db');
});

test('flowComets: too old, unknown link, two ends drawn as one, or nothing drawn is no comet', () => {
  const links = [{ from: 'db-svc', to: 'db', kind: 'flow' }, { from: 'db', to: 'storage', kind: 'flow' }];
  const old = { at: 100_000 - COMETS.windowMs - 1, link: 'db>storage' };
  const events = [old, { at: 99_000, link: 'nowhere>else' }, { at: 99_000, link: 'db-svc>db' }];
  assert.deepEqual(flowComets(model({ links, events }), ['hv1', 'hv2', 'db', 'storage']), [], 'db-svc folds into db');
  assert.deepEqual(flowComets(model({ links, events: [{ at: 99_000, link: 'db>storage' }] }), []), []);
  assert.deepEqual(flowComets({}, ['hv1']), []);
  assert.deepEqual(flowComets(null, null), []);
  // The same event twice in one model is one comet.
  const twice = [{ at: 99_000, link: 'db>storage' }, { at: 99_000, link: 'db>storage' }];
  assert.equal(flowComets(model({ links, events: twice }), ['hv1', 'hv2', 'db', 'storage']).length, 1);
});

const CT = { ...COMETS, travelMs: 1000, max: 2 };
const comet = (key) => ({ key, from: 'db', to: 'storage', fromSite: 'hv1', toSite: 'hv2', tone: 'calm', ageMs: 0 });

test('trackComets: each event flies once, even when the next model repeats it; at most max at once', () => {
  let t = trackComets(null, [comet('1:a')], 5000, CT);
  assert.deepEqual(t.flying.map((c) => [c.key, c.t0]), [['1:a', 5000]]);
  t = trackComets(t, [comet('1:a')], 5400, CT);
  assert.deepEqual(t.flying.map((c) => [c.key, c.t0]), [['1:a', 5000]], 'the same event: no second start');
  t = trackComets(t, [comet('1:a')], 6200, CT);
  assert.equal(t.flying.length, 0, 'landed and never again');
  t = trackComets(t, [comet('2:a'), comet('3:a'), comet('4:a')], 7000, CT);
  assert.deepEqual(t.flying.map((c) => c.key), ['2:a', '3:a'], 'the sky is full');
  t = trackComets(t, [comet('3:a'), comet('4:a')], 8100, CT);
  assert.deepEqual(t.flying.map((c) => c.key), ['4:a'], 'the waiting one flies when there is room');
});

test('cometAt and cometPath: one eased flight over the plane, fading in and out, then over', () => {
  const c = { t0: 1000 };
  assert.equal(cometAt(c, 900, CT), null);
  assert.deepEqual(cometAt(c, 1000, CT), { u: 0, k: 0 });
  assert.equal(cometAt(c, 1500, CT).u, 0.5);
  assert.equal(cometAt(c, 1500, CT).k, 1);
  assert.ok(cometAt(c, 1100, CT).u < 0.05, 'eased out of the planet');
  assert.ok(cometAt(c, 1990, CT).k < 0.1, 'fades as it lands');
  assert.equal(cometAt(c, 2000, CT), undefined);
  const a = { x: 0, y: 0, z: 0 }, b = { x: 1000, y: 0, z: 0 };
  const p = cometPath(a, b);
  assert.equal(p.length, 1000);
  assert.deepEqual(p.at(0), a);
  assert.deepEqual(p.at(1), b);
  const mid = p.at(0.5);
  assert.equal(mid.x, 500);
  assert.ok(mid.y > 100, 'arcs over the plane');
  assert.ok(cometPath(a, { x: 10, y: 0, z: 0 }).at(0.5).y >= COMETS.liftMin / 2, 'a short hop still lifts');
});

/** The scene's comet lights (named `fx-comet`). */
function cometSprites(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return root.children.filter((o) => o.isSprite && o.name === 'fx-comet');
}

const flowModel = () => model({
  links: [{ from: 'db', to: 'storage', kind: 'flow' }],
  events: [{ at: 99_000, node: 'db', kind: 'ok', text: 'db dumps → storage', link: 'db>storage' }],
});

test('without fx=comets the scene makes no comet and ignores flows', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['lanes']) });
  const m = flowModel();
  galaxy.update(m);
  galaxy.setComets(flowComets(m, galaxy.drawn()));
  at(1000 + COMETS.travelMs / 2);
  assert.equal(cometSprites(galaxy).length, 0);
  assert.equal(galaxy.comets.length, 0);
});

test('with fx=comets a flow event flies once from its planet to where it lands, grey and capped', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['comets']) });
  const m = flowModel();
  galaxy.update(m);
  const pool = cometSprites(galaxy);
  assert.equal(pool.length, COMETS.max * (1 + COMETS.tail), 'one pool, made once');
  assert.ok(galaxy.drawn().has('db') && galaxy.drawn().has('hv2'));
  galaxy.setComets(flowComets(m, galaxy.drawn()));
  assert.deepEqual(galaxy.comets.map((c) => [c.from, c.to]), [['db', 'storage']]);
  const member = (site, id) => galaxy.world.byId.get(site).members.find((x) => x.id === id).mesh.position;
  const db = member('hv1', 'db'), storage = member('hv2', 'storage');
  const lit = () => pool.filter((s) => s.visible);
  const head = () => lit().reduce((a, s) => (s.scale.x > a.scale.x ? s : a));
  const near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  at(1000 + COMETS.travelMs * 0.05);
  assert.ok(near(head().position, db) < near(head().position, storage), 'leaves db');
  at(1000 + COMETS.travelMs * 0.5);
  assert.ok(head().position.y > Math.max(db.y, storage.y) + COMETS.liftMin / 2, 'high over the plane midway');
  assert.ok(lit().length > 3, 'a tail behind it');
  for (const s of lit()) {
    assert.ok(s.material.opacity <= COMETS.opacity, 'never brighter than its cap');
    assert.equal(s.material.color.getHexString(), cometSprites(galaxy)[0].material.color.getHexString());
  }
  at(1000 + COMETS.travelMs * 0.95);
  assert.ok(near(head().position, storage) < near(head().position, db), 'lands at storage');
  // The next model repeats the event: it does not fly again.
  galaxy.setComets(flowComets(m, galaxy.drawn()));
  at(1000 + COMETS.travelMs * 1.5);
  assert.equal(lit().length, 0);
  assert.equal(galaxy.comets.length, 0);
});

test('with fx=comets under reduced motion a comet is its arc, still, for as long as it would fly', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['comets']), still: true });
  const m = flowModel();
  galaxy.update(m);
  galaxy.setComets(flowComets(m, galaxy.drawn()));
  const lit = () => cometSprites(galaxy).filter((s) => s.visible).map((s) => [s.position.x, s.position.y, s.position.z, s.material.opacity]);
  at(1000 + COMETS.travelMs * 0.2);
  const a = lit();
  assert.equal(a.length, 1 + COMETS.tail);
  at(1000 + COMETS.travelMs * 0.8);
  assert.deepEqual(lit(), a, 'nothing moves');
  at(1000 + COMETS.travelMs * 1.1);
  assert.equal(lit().length, 0, 'gone after');
});

/** hv1 with a builder whose lanes are at work (or not), hv2 with a room in trouble and a working session in it. */
function workModel({ lanes = [], extra = [] } = {}) {
  const m = model();
  m.nodes.push(
    { id: 'builder:a', parent: 'api', kind: 'builder', label: 'builder-a', status: 'ok' },
    ...lanes.map((l) => ({ parent: 'builder:a', kind: 'lane', ...l })),
    ...extra,
  );
  return m;
}

test('workingPlanets: a planet with a working, calm session below it twinkles, once however many', () => {
  const m = workModel({
    lanes: [
      { id: 'lane:a/x', status: 'working' },
      { id: 'lane:a/y', status: 'idle' },
      { id: 'lane:a/z', status: 'attention' },
    ],
    extra: [
      { id: 'sess:a/y1', parent: 'lane:a/y', kind: 'session', status: 'working' },
      { id: 'sess:a/y2', parent: 'lane:a/y', kind: 'session', status: 'idle' },
    ],
  });
  const planets = new Set(['hv1', 'hv2', 'remote', 'db', 'api', 'storage', 'nas', 'builder:a']);
  assert.deepEqual(workingPlanets(m, planets), [{ id: 'builder:a', site: 'hv1', count: 2 }]);
  // The builder not drawn as a planet: its room's planet twinkles instead.
  planets.delete('builder:a');
  assert.deepEqual(workingPlanets(m, planets).map((w) => w.id), ['api']);
});

test('workingPlanets: idle, waiting, stuck, a working service, or nothing drawn twinkles nothing', () => {
  const m = workModel({
    lanes: [
      { id: 'lane:a/idle', status: 'idle' },
      { id: 'lane:a/ask', status: 'attention' },
      { id: 'lane:a/stuck', status: 'working', flags: { stuck: { rule: 'tool-loop' } } },
    ],
    extra: [{ id: 'runner', parent: 'storage', kind: 'service', status: 'working' }],
  });
  assert.deepEqual(workingPlanets(m, ['hv1', 'hv2', 'api', 'storage', 'builder:a']), [], 'calm stays calm: only agents at work');
  assert.deepEqual(workingPlanets(workModel({ lanes: [{ id: 'l', status: 'working' }] }), []), []);
  assert.deepEqual(workingPlanets({}, ['hv1']), []);
  assert.deepEqual(workingPlanets(null, null), []);
});

test('twinkleAt and trackTwinkles: fades in, glimmers slow and low, fades out when work stops', () => {
  const list = [{ id: 'builder:a', site: 'hv1', count: 1 }];
  let tw = trackTwinkles(null, list, 0);
  const one = () => tw.get('builder:a');
  assert.equal(twinkleAt(one(), 0).k, 0, 'comes in from nothing');
  assert.equal(twinkleAt(one(), TWINKLE.fadeMs).k, 1);
  // Slow: over any half second the glimmer moves little; over the long period it swings.
  const g = [];
  for (let t = 2000; t < 2000 + TWINKLE.periods[0]; t += 100) g.push(twinkleAt(one(), t).glimmer);
  for (let i = 5; i < g.length; i++) assert.ok(Math.abs(g[i] - g[i - 5]) < 0.5, 'no blink');
  assert.ok(Math.max(...g) - Math.min(...g) > 0.4, 'it does glimmer');
  assert.ok(g.every((x) => x >= 0 && x <= 1));
  // The same planet in the next model keeps its start.
  tw = trackTwinkles(tw, list, 3000);
  assert.equal(one().t0, 0);
  // Work stops: it fades out over fadeMs, then is gone.
  tw = trackTwinkles(tw, [], 4000);
  assert.equal(one().until, 4000);
  assert.ok(twinkleAt(one(), 4000 + TWINKLE.fadeMs / 2).k < 0.6);
  assert.equal(twinkleAt(one(), 4000 + TWINKLE.fadeMs), undefined);
  assert.equal(trackTwinkles(tw, [], 4000 + TWINKLE.fadeMs).size, 0);
  // Two neighbours by name never glimmer in step.
  const a = { id: 'builder:builder-a', t0: 0, until: Infinity }, b = { id: 'builder:builder-b', t0: 0, until: Infinity };
  let apart = 0;
  for (let t = 0; t < 20000; t += 500) apart = Math.max(apart, Math.abs(twinkleAt(a, t).glimmer - twinkleAt(b, t).glimmer));
  assert.ok(apart > 0.3, 'out of step');
  // Still: steady, the same at any time.
  assert.deepEqual(twinkleAt({ id: 'x', t0: 0, until: Infinity }, 5000, TWINKLE, true), twinkleAt({ id: 'x', t0: 0, until: Infinity }, 9000, TWINKLE, true));
});

test('trackTwinkles: at most max at once, the oldest kept; one back while fading picks up from its light', () => {
  const many = Array.from({ length: TWINKLE.max + 5 }, (_, i) => ({ id: `p${i}`, site: 'hv1', count: 1 }));
  let tw = trackTwinkles(null, many.slice(0, 3), 0);
  tw = trackTwinkles(tw, many, 500);
  assert.equal(tw.size, TWINKLE.max);
  for (const id of ['p0', 'p1', 'p2']) assert.equal(tw.get(id).t0, 0);
  let one = trackTwinkles(null, [many[0]], 0);
  one = trackTwinkles(one, [], 5000);
  const half = 5000 + TWINKLE.fadeMs / 2;
  const before = twinkleAt(one.get('p0'), half).k;
  one = trackTwinkles(one, [many[0]], half);
  assert.ok(Math.abs(twinkleAt(one.get('p0'), half).k - before) < 1e-9, 'no jump');
  assert.equal(one.get('p0').until, Infinity);
});

/** The scene's twinkle lights (named `fx-twinkle`). */
function twinkleSprites(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return root.children.filter((o) => o.isSprite && o.name === 'fx-twinkle');
}

const busyModel = () => workModel({
  lanes: [{ id: 'lane:a/x', status: 'working' }],
  extra: [
    { id: 'jam', parent: 'hv2', kind: 'room', status: 'crit' },
    { id: 'lane:jam/x', parent: 'jam', kind: 'lane', status: 'working' },
  ],
});

test('without fx=twinkle the scene makes no twinkle and ignores working sessions', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['comets']) });
  const m = busyModel();
  galaxy.update(m);
  galaxy.setTwinkles(workingPlanets(m, galaxy.planets()));
  at(1000 + TWINKLE.fadeMs * 2);
  assert.equal(twinkleSprites(galaxy).length, 0);
  assert.equal(galaxy.twinkles.size, 0);
});

test('with fx=twinkle a working planet glimmers on its sphere, low and grey; trouble does not', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['twinkle']) });
  const m = busyModel();
  galaxy.update(m);
  assert.equal(twinkleSprites(galaxy).length, TWINKLE.max, 'one pool, made once');
  assert.ok(galaxy.planets().has('builder:a') && galaxy.planets().has('jam') && !galaxy.planets().has('db-svc'));
  galaxy.setTwinkles(workingPlanets(m, galaxy.planets()));
  assert.deepEqual([...galaxy.twinkles.keys()].sort(), ['builder:a', 'jam']);
  const lit = () => twinkleSprites(galaxy).filter((s) => s.visible);
  const builder = galaxy.world.byId.get('hv1').members.find((x) => x.id === 'builder:a');
  const seen = [];
  for (let t = 1000 + TWINKLE.fadeMs; t < 1000 + TWINKLE.fadeMs + TWINKLE.periods[0]; t += 250) {
    at(t);
    assert.equal(lit().length, 1, 'only the calm planet: the crit room breathes already');
    const sp = lit()[0];
    assert.deepEqual(sp.position.toArray(), builder.mesh.position.toArray());
    assert.ok(sp.material.opacity <= TWINKLE.opacity + 1e-9);
    assert.ok(sp.material.opacity >= TWINKLE.opacity * TWINKLE.floor - 1e-9, 'never off while at work');
    seen.push(sp.material.opacity);
  }
  assert.ok(Math.max(...seen) > Math.min(...seen) * 1.5, 'it twinkles');
  // Quieter than any trouble halo.
  assert.ok(TWINKLE.opacity < 0.5);
  // Work stops: it fades out.
  galaxy.setTwinkles(workingPlanets(workModel(), galaxy.planets()));
  at(1000 + TWINKLE.fadeMs * 2 + TWINKLE.periods[0] + 10);
  assert.equal(lit().length, 0);
});

test('with fx=twinkle under reduced motion the light is steady', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['twinkle']), still: true });
  const m = busyModel();
  galaxy.update(m);
  galaxy.setTwinkles(workingPlanets(m, galaxy.planets()));
  const lit = () => twinkleSprites(galaxy).filter((s) => s.visible).map((s) => s.material.opacity);
  at(1000 + TWINKLE.fadeMs);
  const a = lit();
  assert.equal(a.length, 1);
  at(1000 + TWINKLE.fadeMs + 2345);
  assert.deepEqual(lit(), a, 'nothing moves');
});

// --- fx=beacon --------------------------------------------------------------------

const MIN = 60_000, HOUR = 60 * MIN;

test('beaconHeight and beaconWidth: both grow with the crit\'s age, by log, capped; none for calm, warn or no age', () => {
  const ages = [0, 5000, MIN, 10 * MIN, HOUR, 6 * HOUR, 24 * HOUR];
  for (const size of [beaconHeight, beaconWidth]) {
    const hs = ages.map((a) => size(a));
    for (let i = 1; i < hs.length; i++) assert.ok(hs[i] > hs[i - 1], `${size.name}: ${ages[i]} ms is more than ${ages[i - 1]} ms`);
    assert.equal(size(30 * 24 * HOUR), size(24 * HOUR), 'capped');
    assert.equal(size(HOUR, 'calm'), 0);
    assert.equal(size(HOUR, 'warn'), 0);
    assert.equal(size(HOUR, 'low'), 0);
    assert.equal(size(NaN), 0);
    assert.equal(size(-5), size(0), 'a clock a hair ahead is just begun');
  }
  // A crit that just began already stands a quarter of the frame (shows at once from 3 m).
  assert.equal(beaconHeight(0), BEACON.floor);
  assert.ok(BEACON.floor >= 0.22 && BEACON.floor <= 0.28);
  assert.equal(beaconHeight(24 * HOUR), BEACON.top);
  assert.equal(beaconWidth(0), BEACON.wide[0]);
  assert.equal(beaconWidth(24 * HOUR), BEACON.wide[1]);
  // Log: the first hour takes more of the growth than the next 23.
  assert.ok(beaconHeight(HOUR) - beaconHeight(0) > beaconHeight(24 * HOUR) - beaconHeight(HOUR));
  // Two crits ten minutes and a day old are visibly different (not twins): taller and wider.
  assert.ok(beaconHeight(24 * HOUR) - beaconHeight(10 * MIN) > 0.08);
  assert.ok(beaconWidth(24 * HOUR) / beaconWidth(10 * MIN) > 1.5);
});

test('beaconScale: a height lands its share of the frame above its base on screen, never past the room', () => {
  const shot = { pos: { x: 0, y: 6000, z: 4800 }, look: { x: 0, y: 0, z: 0 } };
  for (const base of [{ x: 0, y: 0, z: 0 }, { x: -1800, y: 40, z: 900 }, { x: 1500, y: -30, z: -400 }]) {
    const sc = beaconScale(shot, base, FOV);
    const span = (h) => (ndcOf(shot, { ...base, y: base.y + h }, FOV, 16 / 9).y - ndcOf(shot, base, FOV, 16 / 9).y) / 2;
    assert.ok(Math.abs(span(sc.rise(BEACON.floor)) - BEACON.floor) < 1e-9, 'a quarter of the frame');
    assert.ok(Math.abs(span(sc.rise(0.1)) - 0.1) < 1e-9);
    assert.equal(sc.rise(0), 0);
    assert.ok(sc.rise(0.4) > sc.rise(0.2));
    // Its width is its share of the frame's height at its depth.
    const z = Math.hypot(base.x - shot.pos.x, base.y - shot.pos.y, base.z - shot.pos.z);
    assert.ok(sc.across(0.02) > 0 && sc.across(0.02) < 0.02 * 2 * z * Math.tan((FOV * Math.PI) / 360) * 1.001);
  }
  // Near the frame's top the tip stops at the room; a base above it gets nothing.
  const high = { x: 0, y: 0, z: -3000 }; // ndc y 0.64: a quarter of the frame would pass the room
  const sc = beaconScale(shot, high, FOV);
  const tip = ndcOf(shot, { ...high, y: sc.rise(0.9) }, FOV, 16 / 9).y;
  assert.ok(Math.abs(tip - BEACON.room) < 1e-9, `stops at the room: ${tip}`);
  assert.equal(beaconScale(shot, high, FOV, sc.ndc0 - 0.01).rise(0.3), 0);
  assert.equal(beaconScale(shot, { x: 0, y: 9000, z: 9000 }, FOV), null, 'behind the camera');
});

test('beaconNear: full until it looks much wider than at the overview, then eased out', () => {
  assert.equal(beaconNear(1), 1);
  assert.equal(beaconNear(BEACON.near[0]), 1);
  assert.equal(beaconNear(BEACON.near[1]), 0);
  assert.equal(beaconNear(50), 0);
  assert.equal(beaconNear(NaN), 1);
  for (let r = 1; r < 4; r += 0.1) assert.ok(beaconNear(r + 0.1) <= beaconNear(r));
});

test('beamProfile: full at the foot, gone at the tip over its top fifth, smooth; the core is brightest at the foot', () => {
  assert.equal(beamProfile(0), 1);
  assert.equal(beamProfile(1), 0, 'no flat end at the tip');
  assert.ok(BEACON.fade >= 0.2);
  assert.ok(beamProfile(1 - BEACON.fade) > 0.5, 'the body is still strong where the fade begins');
  for (let v = 0.01; v <= 1; v += 0.01) assert.ok(beamProfile(v) <= beamProfile(v - 0.01) + 1e-12, `falls: ${v}`);
  // No step where the fade begins.
  const e = 1 - BEACON.fade;
  assert.ok(Math.abs(beamProfile(e - 1e-6) - beamProfile(e + 1e-6)) < 1e-4);
  assert.ok(beamProfile(0.99) < 0.01);
  assert.equal(coreProfile(0), 1);
  assert.equal(coreProfile(1), 0);
  for (let v = 0.01; v <= 1; v += 0.01) assert.ok(coreProfile(v) <= coreProfile(v - 0.01) + 1e-12);
});

/** `model()` with storage (hv2) and nas (remote) in crit, each with the events that began it. */
function critModel({ now = 10 * HOUR, events = null } = {}) {
  const m = model({ generatedAt: now });
  for (const n of m.nodes) if (n.id === 'storage' || n.id === 'nas') n.status = 'crit';
  m.events = events ?? [
    { at: now - 3 * HOUR, node: 'storage', kind: 'crit', text: 'storage is failing' },
    { at: now - 2 * HOUR, node: 'storage', kind: 'ok', text: 'storage is back' },
    { at: now - HOUR, node: 'storage', kind: 'crit', text: 'storage is failing again' },
    { at: now - 5 * MIN, node: 'nas', kind: 'crit', text: 'nas is down' },
    { at: now - 4 * HOUR, node: 'db', kind: 'crit', text: 'db was down (it is fine now)' },
  ];
  return m;
}

test('critAges: per crit site, from the newest crit event on each node still in crit, the oldest wins', () => {
  const ages = critAges(critModel(), SITES);
  assert.deepEqual([...ages].sort(), [['hv2', HOUR], ['remote', 5 * MIN]], 'storage\'s spell began an hour ago; db is calm');
  // Two crit rooms in one site: the site has been in crit since the older one.
  const m = critModel();
  m.nodes.find((n) => n.id === 'api').status = 'crit';
  m.nodes.find((n) => n.id === 'db').status = 'crit';
  assert.equal(critAges(m, SITES).get('hv1'), 4 * HOUR);
  // A site not drawn, a crit with no event: nothing (the page dates it itself).
  assert.deepEqual([...critAges(critModel(), ['hv1', 'hv2']).keys()], ['hv2']);
  assert.equal(critAges(critModel({ events: [] }), SITES).size, 0);
  assert.equal(critAges({}, SITES).size, 0);
});

test('beaconAt: rises eased from the plane, sinks when the crit clears, at once when still', () => {
  const b = { from: 0, crit: true, t0: 1000, k0: 0 };
  assert.equal(beaconAt(b, 1000).rise, 0);
  const mid = beaconAt(b, 1000 + BEACON.riseMs / 2).rise;
  assert.ok(mid > 0.4 && mid < 0.6);
  assert.equal(beaconAt(b, 1000 + BEACON.riseMs).rise, 1);
  assert.equal(beaconAt(b, 1000 + 5 * BEACON.riseMs).rise, 1);
  assert.equal(beaconAt(b, 1000, BEACON, true).rise, 1, 'still: stands at once');
  assert.equal(beaconAt(b, HOUR).height, beaconHeight(HOUR), 'its height is its age');
  assert.equal(beaconAt(b, HOUR).width, beaconWidth(HOUR), 'and so is its width');
  const gone = { ...b, crit: false, t0: 5000, k0: 1 };
  assert.equal(beaconAt(gone, 5000).rise, 1);
  assert.equal(beaconAt(gone, 5000 + BEACON.riseMs).rise, 0);
});

/** The scene's beacon pillars and their tips. */
function beaconParts(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return {
    pillars: root.children.filter((o) => o.isMesh && o.name === 'fx-beacon'),
    cores: root.children.filter((o) => o.isMesh && o.name === 'fx-beacon-core'),
    tips: root.children.filter((o) => o.isSprite && o.name === 'fx-beacon-tip'),
  };
}

/** How much of the frame's height `p` (a pillar) spans seen from the overview, and its foot's ndc y. */
function overviewSpan(galaxy, p) {
  const shot = overviewShot(galaxy.world.sites);
  const foot = ndcOf(shot, p.position, FOV, 16 / 9).y;
  const top = ndcOf(shot, { x: p.position.x, y: p.position.y + p.scale.y, z: p.position.z }, FOV, 16 / 9).y;
  return { span: (top - foot) / 2, foot, top };
}

/** Puts the scene's camera at the overview (the tests' scene never moves it itself). */
function toOverview(galaxy) {
  const { pos, look } = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(pos.x, pos.y, pos.z);
  galaxy.camera.lookAt(look.x, look.y, look.z);
}

/** The share of the frame a beacon `share` tall should span from `foot` (the room caps it). */
const wantSpan = (share, foot) => Math.min(share, (BEACON.room - foot) / 2);

test('without fx=beacon the scene makes no pillar and ignores crit ages', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['lanes']) });
  const m = critModel();
  galaxy.update(m);
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000 + BEACON.riseMs * 2);
  assert.equal(beaconParts(galaxy).pillars.length, 0);
  assert.equal(galaxy.beacons.size, 0);
});

test('with fx=beacon each crit cluster stands a pillar as tall as its crit is old; calm gets none; it sinks when cleared', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']) });
  const m = critModel();
  galaxy.update(m);
  toOverview(galaxy);
  const { pillars, tips } = beaconParts(galaxy);
  assert.equal(pillars.length, BEACON.max, 'one pool, made once');
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000 + BEACON.riseMs * 2);
  const shown = () => pillars.filter((p) => p.visible);
  assert.equal(shown().length, 2, 'hv2 and remote, not hv1');
  const on = (id) => {
    const h = galaxy.world.byId.get(id).home;
    return shown().find((p) => p.position.x === h.x && p.position.z === h.z);
  };
  assert.ok(on('hv2') && on('remote') && !on('hv1'));
  const hv2 = on('hv2').scale.y;
  // Sized in the overview's screen: as tall as its age says, in shares of the frame.
  const sHv2 = overviewSpan(galaxy, on('hv2')), sRemote = overviewSpan(galaxy, on('remote'));
  assert.ok(Math.abs(sHv2.span - wantSpan(beaconHeight(HOUR), sHv2.foot)) < 1e-3, `an hour of crit: ${sHv2.span}`);
  assert.ok(Math.abs(sRemote.span - wantSpan(beaconHeight(5 * MIN), sRemote.foot)) < 1e-3, `five minutes: ${sRemote.span}`);
  assert.ok(sRemote.span >= Math.min(BEACON.floor, (BEACON.room - sRemote.foot) / 2) - 1e-3, 'a young crit already stands the floor');
  assert.ok(sHv2.top <= BEACON.room + 1e-9 && sRemote.top <= BEACON.room + 1e-9, 'short of the frame\'s top');
  assert.ok(on('hv2').scale.x > on('remote').scale.x, 'the older crit is wider');
  // Each tip sits on its pillar's top; each pillar has its white core, as tall, narrower.
  const { cores } = beaconParts(galaxy);
  for (const p of shown()) {
    const tip = tips.find((t) => t.visible && t.position.x === p.position.x && t.position.z === p.position.z);
    assert.ok(Math.abs(tip.position.y - (p.position.y + p.scale.y)) < 1e-6);
    assert.ok(p.material.opacity <= BEACON.opacity + 1e-9);
    const core = cores.find((c) => c.visible && c.position.x === p.position.x && c.position.z === p.position.z);
    assert.ok(core, 'a core in every pillar');
    assert.equal(core.scale.y, p.scale.y);
    assert.ok(Math.abs(core.scale.x - p.scale.x * BEACON.core) < 1e-9);
    assert.ok(core.material.opacity > p.material.opacity * 0.9, 'the core is the brightest part');
    // White-hot: the text's white (--text-1), no hue, so it carries in greyscale and without red.
    const { r, g, b } = core.material.color;
    assert.ok(Math.min(r, g, b) > 0.8 && Math.max(r, g, b) - Math.min(r, g, b) < 0.05, `white core: ${r} ${g} ${b}`);
    assert.ok(p.material.color.r > p.material.color.g * 2, 'the sheath is the crit hue');
  }
  // A camera close by (held in a system next to it): the pillar sized for the
  // overview fades rather than stand as a red wall across the shot.
  const far = on('remote').material.opacity;
  const rh = galaxy.world.byId.get('remote').home;
  galaxy.camera.position.set(rh.x + 300, rh.y + 400, rh.z + 300);
  galaxy.camera.lookAt(rh.x, rh.y, rh.z);
  at(1000 + BEACON.riseMs * 2 + 8);
  assert.ok(far > 0.3, `at the overview it stands: ${far}`);
  assert.ok(!on('remote'), 'close by it is gone');
  toOverview(galaxy);
  at(1000 + BEACON.riseMs * 2 + 12);
  assert.ok(on('remote'), 'back at the overview it stands again');
  // A crit that begins while the page looks rises from the plane, not at once
  // (those already there on the first frame stand: they did not just begin).
  const fresh = sceneAt({ fx: new Set(['beacon']) });
  fresh.galaxy.update(model());
  toOverview(fresh.galaxy);
  fresh.at(1000);
  assert.equal(beaconParts(fresh.galaxy).pillars.filter((p) => p.visible).length, 0, 'calm: none');
  fresh.galaxy.update(m);
  fresh.at(1016);
  fresh.at(1016 + BEACON.riseMs * 0.25);
  const rising = beaconParts(fresh.galaxy).pillars.filter((p) => p.visible);
  assert.ok(rising.length === 2 && rising.every((p) => overviewSpan(fresh.galaxy, p).span < BEACON.floor * 0.9), 'still rising');
  // The site opens: the pillar dims, its system is the loud thing.
  const open0 = on('hv2').material.opacity;
  galaxy.setOpen('hv2', 1);
  at(1000 + BEACON.riseMs * 2 + 16);
  assert.ok(on('hv2').material.opacity < open0 * 0.5);
  // hv2 clears: its pillar sinks and goes; remote's stays.
  const calm = critModel();
  calm.nodes.find((n) => n.id === 'storage').status = 'ok';
  galaxy.update(calm);
  galaxy.setCritAges(critAges(calm, galaxy.world.byId.keys()));
  const t1 = 1000 + BEACON.riseMs * 3;
  at(t1);
  at(t1 + BEACON.riseMs / 2);
  assert.ok(on('hv2').scale.y < hv2 * 0.6, 'sinking');
  at(t1 + BEACON.riseMs + 16);
  assert.equal(shown().length, 1);
  assert.ok(on('remote') && !on('hv2'));
  assert.deepEqual([...galaxy.beacons.keys()], ['remote']);
});

test('with fx=beacon a crit with no event is dated from when the page first saw it, and grows', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']), still: true });
  const m = critModel({ events: [] });
  galaxy.update(m);
  toOverview(galaxy);
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000);
  const hv2 = () => {
    const h = galaxy.world.byId.get('hv2').home;
    return beaconParts(galaxy).pillars.find((p) => p.visible && p.position.x === h.x && p.position.z === h.z);
  };
  const s0 = overviewSpan(galaxy, hv2());
  assert.ok(Math.abs(s0.span - wantSpan(BEACON.floor, s0.foot)) < 1e-3, `still: stands at once, just begun: ${s0.span}`);
  const w0 = hv2().scale.x;
  at(1000 + HOUR);
  const s1 = overviewSpan(galaxy, hv2());
  assert.ok(Math.abs(s1.span - wantSpan(beaconHeight(HOUR), s1.foot)) < 1e-3, 'an hour later, an hour tall');
  assert.ok(hv2().scale.x > w0, 'and wider');
});
