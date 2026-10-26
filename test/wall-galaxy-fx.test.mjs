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
  COMETS, FX_NAMES, LANES, TWINKLE, cometAt, cometPath, flowComets, parseFx, pulseAt, routePath, siteRoutes, trackComets,
  trackRoutes, trackTwinkles, twinkleAt, workingPlanets,
} from '../public/js/wall/galaxy/fx.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';

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
