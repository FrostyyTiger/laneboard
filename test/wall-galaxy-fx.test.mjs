// The galaxy's effects (Wall plan night 2 T12, README §7.C, D9): `?fx=`
// turns them on one by one, none by default; `lanes` runs a light pulse
// along the hyperlanes between two sites while a link between them is live
// (the model's `live`, or an event that travelled it a moment ago).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_NAMES, LANES, parseFx, pulseAt, routePath, siteRoutes, trackRoutes } from '../public/js/wall/galaxy/fx.js';
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
