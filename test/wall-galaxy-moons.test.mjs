// Moons, folded (Wall plan night 5 B2, T7; the owner's sketch pick
// `sk_moons=1`): what hangs below a planet and is no planet (services under
// a room, lanes under a builder, sessions under a lane) is a moon of the
// nearest planet above it. Folded, a moon sits tight to its planet at half
// size, unnamed and no target, and the overview never draws a calm one. A
// moon in trouble stays as loud as a dot in trouble was (planet size, named,
// a target): readable trouble wins (README §2). Layout is pure; the scene
// runs on a fake renderer and clock, as in the carry and trouble tests.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { galaxyLayout, moonHosts } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom, toneOf } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, moonAt, moonOrbit, moonRing, siteShot, sphereSegs, MOON, SIZE } from '../public/js/wall/galaxy/scene.js';
import { createLabels } from '../public/js/wall/galaxy/labels.js';
import { memberPoints } from '../public/js/wall/galaxy/touch.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const troubled = (m) => ['warn', 'crit'].includes(toneOf(m.node));

/** host id → its moons' ids in order, for one site of a layout. */
const tree = (site) => {
  const out = {};
  for (const m of site.members) if (m.moon) (out[m.moon.host] ??= [])[m.moon.i] = m.id;
  return out;
};

test('layout: the large fixture\'s moon tree (lanes and sessions under the builders, services and runs under rooms)', () => {
  const lay = galaxyLayout(LARGE);
  const lab = tree(lay.sites.find((s) => s.id === 'lab'));
  assert.deepEqual(lab['builder:builder-a'], [
    'lane:builder-a/feat-search', 'sess:builder-a/search api', 'sess:builder-a/search ui',
    'lane:builder-a/fix-login', 'lane:builder-a/docs-refresh',
  ], 'its lanes, and the sessions under a lane orbit the builder too');
  assert.deepEqual(lab['builder:builder-b'], ['lane:builder-b/ci-retry', 'lane:builder-b/deps-bump', 'run:acme-billing']);
  assert.deepEqual(lab['builder:builder-c'], ['lane:builder-c/release-notes']);
  assert.deepEqual(lab['room-a'], ['run:acme-docs'], 'a run on a room');
  assert.deepEqual(lab.ci, ['ci-runner-1', 'ci-runner-2', 'ci-runner-3'], 'services under a room');
  assert.equal(lab['room-b'], undefined, 'a builder is a planet of its own, never a moon');
  const repos = tree(lay.sites.find((s) => s.id === '__repos'));
  assert.deepEqual(repos['repo:acme'], ['pkg:acme/web', 'pkg:acme/api', 'pkg:acme/docs']);
  for (const s of lay.sites) {
    const planets = new Set(s.members.filter((m) => m.planet).map((m) => m.id));
    for (const m of s.members) {
      if (m.planet) { assert.equal(m.moon, undefined, `${m.id}: a planet is no moon`); continue; }
      assert.ok(m.moon && planets.has(m.moon.host), `${m.id}: every dot of the large demo hangs under a planet`);
      assert.equal(tree(s)[m.moon.host].length, m.moon.n, `${m.id}: n counts its planet's moons`);
    }
  }
});

test('moonHosts: the nearest planet above, through a lane; a dot hung straight on the site is no moon', () => {
  const nodes = [
    { id: 's', kind: 'site' },
    { id: 'r', parent: 's', kind: 'room' },
    { id: 'b', parent: 'r', kind: 'builder' },
    { id: 'l', parent: 'b', kind: 'lane' },
    { id: 'x', parent: 'l', kind: 'session' },
    { id: 'svc', parent: 'r', kind: 'service' },
    { id: 'loose', parent: 's', kind: 'service' },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hosts = moonHosts(nodes.slice(1), byId, nodes[0]);
  assert.deepEqual(Object.fromEntries(hosts), { l: 'b', x: 'b', svc: 'r' });
});

test('moonOrbit: the same on every load, 40-90 s a turn, inclined at most 40°; moonAt keeps the radius', () => {
  assert.deepEqual(moonOrbit('lane:x'), moonOrbit('lane:x'));
  for (const m of LARGE) {
    const o = moonOrbit(m.id);
    assert.ok(o.period >= 40000 && o.period <= 90000, m.id);
    assert.ok(Math.abs(o.inc) <= 0.7 + 1e-9, m.id);
    for (const t of [0, 12345, 77777]) {
      const p = moonAt(o, 30, t);
      assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 30) < 1e-9, `${m.id} on its orbit at ${t}`);
    }
  }
});

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
  const galaxy = createGalaxyScene({ clientWidth: 1368, clientHeight: 912 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
    ...opts,
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  galaxy.update({ nodes: LARGE });
  return { galaxy, at };
}

const drawnR = (mesh) => mesh.geometry.parameters.radius * mesh.scale.x;
const moonsOf = (s) => s.members.filter((m) => m.moon);

test('scene: open, every moon sits tight to its planet, clear of its body; calm at half size, trouble at the planet size', () => {
  const { galaxy, at } = sceneAt();
  galaxy.setOpen('lab', 1);
  at(5000);
  const lab = galaxy.world.byId.get('lab');
  const moons = moonsOf(lab);
  assert.ok(moons.length >= 15);
  for (const m of moons) {
    const h = m.moon.host;
    assert.ok(h.planet, `${m.id}: orbits a planet`);
    const hostR = drawnR(h.mesh), r = drawnR(m.mesh);
    const d = m.mesh.position.distanceTo(h.mesh.position);
    assert.ok(Math.abs(d - (hostR * MOON.tight + MOON.pad + r)) < 1e-6, `${m.id}: ${d.toFixed(1)} from ${h.id}`);
    assert.ok(d - r > hostR, `${m.id}: off its planet's body`);
    assert.ok(d < 0.25 * lab.reach, `${m.id}: inside its planet's reach, not out where the layout put the dot`);
    assert.equal(m.mesh.visible, true);
    if (troubled(m)) {
      assert.equal(r, SIZE.planet, `${m.id}: trouble is never the smallest thing in the frame`);
      assert.equal(m.mesh.geometry.parameters.widthSegments, sphereSegs('planet')[0], `${m.id}: as round as a planet`);
      assert.ok(m.halo.visible);
    } else {
      assert.equal(r, MOON.calm * MOON.foldK, `${m.id}: half size`);
    }
  }
  assert.ok(moons.some(troubled) && moons.some((m) => !troubled(m)), 'the fixture has both');
});

test('scene: at the overview no calm moon is drawn, a moon in trouble is; they come in with the opening', () => {
  const { galaxy, at } = sceneAt();
  at(1000);
  const lab = galaxy.world.byId.get('lab');
  for (const m of moonsOf(lab)) assert.equal(m.mesh.visible, troubled(m), `${m.id} folded`);
  // The overview draws fewer meshes than nights 1-4, which drew every dot.
  const all = galaxy.world.sites.flatMap((s) => s.members);
  const drawn = all.filter((m) => m.mesh.visible).length;
  assert.ok(drawn <= all.length - 50, `${drawn} of ${all.length} member meshes at the overview`);
  const calm = moonsOf(lab).find((m) => !troubled(m));
  galaxy.setOpen('lab', MOON.from);
  at(1100);
  assert.equal(calm.mesh.visible, false, 'not before MOON.from of the opening');
  galaxy.setOpen('lab', (MOON.from + MOON.to) / 2);
  at(1200);
  const mid = drawnR(calm.mesh);
  assert.ok(calm.mesh.visible && mid > 0 && mid < MOON.calm * MOON.foldK, `growing in: ${mid}`);
  galaxy.setOpen('lab', MOON.to);
  at(1300);
  assert.ok(Math.abs(drawnR(calm.mesh) - MOON.calm * MOON.foldK) < 1e-9);
});

test('scene: moons turn slowly on their orbits, and hold still in still mode', () => {
  const moving = sceneAt();
  moving.galaxy.setOpen('lab', 1);
  moving.at(5000);
  const m = moonsOf(moving.galaxy.world.byId.get('lab'))[0];
  const p0 = m.mesh.position.clone();
  moving.at(5000 + 1000);
  const step = m.mesh.position.distanceTo(p0);
  const d = m.mesh.position.distanceTo(m.moon.host.mesh.position);
  assert.ok(step > 0, 'it moves on with no relayout');
  assert.ok(step < (2 * Math.PI * d) / 40, 'at most a 40th of its orbit a second');
  const held = sceneAt({ still: true });
  held.galaxy.setOpen('lab', 1);
  held.at(5000);
  const h = moonsOf(held.galaxy.world.byId.get('lab'))[0];
  const q0 = h.mesh.position.clone();
  held.at(25000);
  assert.equal(h.mesh.position.distanceTo(q0), 0);
});

test('scene: a planet\'s moons share one ring, evenly spaced, and never touch each other as they turn', () => {
  const { galaxy, at } = sceneAt();
  galaxy.setOpen('lab', 1);
  const a = moonRing({ host: 'h', i: 0, n: 4 }), b = moonRing({ host: 'h', i: 1, n: 4 });
  assert.equal(a.period, b.period);
  assert.ok(Math.abs(b.phase - a.phase - Math.PI / 2) < 1e-12);
  for (const t of [5000, 17000, 41000, 66000]) {
    at(t);
    const moons = moonsOf(galaxy.world.byId.get('lab'));
    for (const m of moons) {
      for (const o of moons) {
        if (o === m || o.moon.host !== m.moon.host) continue;
        const d = m.mesh.position.distanceTo(o.mesh.position);
        assert.ok(d >= drawnR(m.mesh) + drawnR(o.mesh), `${m.id} and ${o.id} ${d.toFixed(1)} apart at ${t}`);
      }
    }
  }
});

function fakeLabelDoc() {
  const el = () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return { style, dataset: {}, textContent: '', className: '', removed: false, remove() { this.removed = true; }, append: () => {} };
  };
  return { doc: { createElement: el }, root: el() };
}

/** The scene's camera on `site`'s held shot at `t`. */
function hold(galaxy, site, t) {
  const shot = siteShot(site, t);
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  galaxy.camera.updateMatrixWorld();
}

test('labels and hit points: HV1 open, no calm moon is named or a target; a moon in trouble is both', () => {
  const { galaxy, at } = sceneAt();
  galaxy.setOpen('lab', 1);
  at(5000);
  const lab = galaxy.world.byId.get('lab');
  hold(galaxy, lab, 0);
  const { doc, root } = fakeLabelDoc();
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, doc });
  labels.draw();
  const named = new Set(labels.shown().map((s) => s.id));
  const calm = moonsOf(lab).filter((m) => !troubled(m));
  for (const m of calm) assert.equal(named.has(m.id), false, `${m.id} unnamed`);
  assert.ok(named.has('lane:builder-a/feat-search'), 'a lane in trouble keeps its name');
  // `ba` itself loses its sides to its trouble moons' names: T6b lets a planet's name win over its own children's.
  assert.ok(named.has('room-a') && named.has('builder:builder-b'), `the planets are named: ${[...named].join(' ')}`);
  const v = galaxy.camera.position.clone();
  const screenOf = (id) => {
    const m = lab.members.find((x) => x.id === id);
    if (!m) return null;
    v.copy(m.mesh.position).project(galaxy.camera);
    return { x: (v.x + 1) / 2 * 1368, y: (1 - v.y) / 2 * 912, r: 10 };
  };
  const ids = new Set(memberPoints(galaxy.world.sites, screenOf).map((p) => p.id));
  for (const m of calm) assert.equal(ids.has(m.id), false, `${m.id} is no target folded`);
  assert.ok(ids.has('lane:builder-a/feat-search') && ids.has('run:acme-billing'), 'trouble moons are targets');
  assert.ok(ids.has('builder:builder-a'), 'a finger there means the planet');
});
