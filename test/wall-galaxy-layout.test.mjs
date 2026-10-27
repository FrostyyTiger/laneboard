// The galaxy's layout (Wall plan night 2 T1, public/js/wall/galaxy/layout.js):
// sites on two spiral arms, the dust band, a system's planets on inclined
// orbits from the orbits layout, and the fold from a tight cluster to an
// open system. Pure, so it runs without a DOM or three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  armPoint, dustPoints, farStars, galaxyLayout, foldAt, ease, hash, rng,
  CLOSED, MIN_SITE_GAP, SITE_LIFT, TILT,
} from '../public/js/wall/galaxy/layout.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

/** n sites with a few rooms each, a builder with lanes under the first. */
function fleet(n) {
  const nodes = [{ id: '__core', kind: 'core', label: 'acme', status: 'ok' }];
  for (let s = 0; s < n; s++) {
    nodes.push({ id: `site-${s}`, kind: 'site', parent: '__core', label: `hv${s}`, status: 'ok' });
    for (let r = 0; r < 4 + (s % 3); r++) {
      nodes.push({ id: `site-${s}/room-${r}`, kind: 'room', parent: `site-${s}`, label: `room-${r}`, status: 'ok' });
      nodes.push({ id: `site-${s}/room-${r}/svc`, kind: 'service', parent: `site-${s}/room-${r}`, label: 'svc', status: 'ok' });
    }
  }
  nodes.push({ id: 'builder-a', kind: 'builder', parent: 'site-0', label: 'builder-a', status: 'ok' });
  for (let l = 0; l < 3; l++) {
    nodes.push({ id: `builder-a/lane-${l}`, kind: 'lane', parent: 'builder-a', label: `lane-${l}`, status: 'ok' });
    nodes.push({ id: `builder-a/lane-${l}/s`, kind: 'session', parent: `builder-a/lane-${l}`, label: 's', status: 'ok' });
  }
  nodes.push({ id: 'run-1', kind: 'run', parent: '__core', label: 'run', status: 'ok' });
  return nodes;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('arms: deterministic for one model, the same on every call', () => {
  const a = galaxyLayout(FLEET);
  const b = galaxyLayout(structuredClone(FLEET));
  assert.equal(a.sites.length, 6);
  assert.deepEqual(a.sites.map((s) => s.home), b.sites.map((s) => s.home));
  assert.deepEqual(
    a.sites.map((s) => s.members.map((m) => m.off)),
    b.sites.map((s) => s.members.map((m) => m.off)),
  );
  assert.deepEqual(armPoint(3, 6), armPoint(3, 6));
});

test('arms: a site added at the end leaves the others where they were', () => {
  for (let i = 0; i < 6; i++) assert.deepEqual(armPoint(i, 6), armPoint(i, 7));
});

test('arms: alternate sites sit on opposite arms, each farther out than the last on its arm', () => {
  const r = (p) => Math.hypot(p.x, p.z);
  for (let i = 0; i + 2 < 12; i++) assert.ok(r(armPoint(i + 2, 12)) > r(armPoint(i, 12)));
  const a = armPoint(0, 2), b = armPoint(1, 2);
  assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.z + b.z) < 1e-9, 'the first two face each other');
  assert.equal(armPoint(4, 6).y, 0);
});

test('arms: no two sites closer than the minimum, for 1 to 12 sites and the large demo', () => {
  const check = (sites) => {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const d = dist(sites[i].home, sites[j].home);
        assert.ok(d >= MIN_SITE_GAP, `${sites[i].id} and ${sites[j].id} are ${d.toFixed(0)} apart`);
      }
      assert.ok(Math.abs(sites[i].home.y) <= SITE_LIFT);
      assert.ok(Math.hypot(sites[i].home.x, sites[i].home.z) >= MIN_SITE_GAP, 'clear of the sun');
    }
  };
  for (let n = 1; n <= 12; n++) check(galaxyLayout(fleet(n)).sites);
  check(galaxyLayout(FLEET).sites);
});

test('systems: everything below a site is a member, a run on the core is in none', () => {
  const g = galaxyLayout(fleet(3));
  assert.equal(g.core.id, '__core');
  const all = g.sites.flatMap((s) => s.members.map((m) => m.id));
  assert.ok(all.includes('builder-a/lane-2/s'), 'a session deep under a builder');
  assert.ok(!all.includes('run-1'));
  assert.ok(!all.includes('site-1'));
  const s0 = g.sites[0];
  assert.ok(s0.members.find((m) => m.id === 'builder-a').planet);
  assert.ok(!s0.members.find((m) => m.id === 'builder-a/lane-0').planet, 'a lane is a dot');
  assert.ok(s0.reach > 0);
});

test('systems: every height within half the distance from the star', () => {
  for (const nodes of [FLEET, fleet(5), fleet(12)]) {
    for (const s of galaxyLayout(nodes).sites) {
      for (const m of s.members) {
        const d = Math.hypot(m.off.x, m.off.z);
        assert.ok(Math.abs(m.off.y) <= TILT.max * d + 1e-9, `${m.id}: |y| ${m.off.y} against distance ${d}`);
      }
    }
  }
});

test('systems: planets really leave the plane, on both sides', () => {
  const planets = galaxyLayout(FLEET).sites.flatMap((s) => s.members.filter((m) => m.planet));
  assert.ok(planets.some((m) => m.off.y > 1) && planets.some((m) => m.off.y < -1));
  for (const m of planets) {
    if (m.node.kind !== 'room') continue;
    const d = Math.hypot(m.off.x, m.off.z);
    assert.ok(Math.abs(m.off.y) >= TILT.min * d - 1e-9, `${m.id} tilts at least ${TILT.min}`);
  }
});

test('fold: foldAt(0) is the folded disc, foldAt(1) the open position', () => {
  const p = { x: 300, y: -90, z: -120 };
  assert.deepEqual(foldAt(0, p), { x: p.x * CLOSED, y: 0, z: p.z * CLOSED });
  assert.deepEqual(foldAt(1, p), p);
  // Out of range clamps; halfway is between, and grows with the opening.
  assert.deepEqual(foldAt(-1, p), foldAt(0, p));
  assert.deepEqual(foldAt(2, p), foldAt(1, p));
  const r = (q) => Math.hypot(q.x, q.y, q.z);
  let last = r(foldAt(0, p));
  for (let k = 0.1; k <= 1.0001; k += 0.1) {
    const now = r(foldAt(k, p));
    assert.ok(now >= last - 1e-9, `opens monotonically at ${k}`);
    last = now;
  }
  assert.equal(ease(0.5), 0.5);
});

test('dust and far stars: seeded, the same on every load, along the arms', () => {
  const a = dustPoints(500), b = dustPoints(500);
  assert.deepEqual(a.positions, b.positions);
  assert.equal(a.positions.length, 1500);
  assert.ok(a.t.every((t) => t >= 0 && t <= 1));
  for (let i = 0; i < 500; i++) {
    const r = Math.hypot(a.positions[i * 3], a.positions[i * 3 + 2]);
    assert.ok(r < 3000, 'inside the galaxy');
    assert.ok(Math.abs(a.positions[i * 3 + 1]) <= 60, 'a thin band');
  }
  assert.notDeepEqual(dustPoints(50, 1).positions, dustPoints(50, 2).positions);
  const stars = farStars(200);
  assert.deepEqual(stars, farStars(200));
  for (let i = 0; i < 200; i++) {
    const r = Math.hypot(stars[i * 3], stars[i * 3 + 1], stars[i * 3 + 2]);
    assert.ok(r >= 9000 - 1e-3 && r <= 15000 + 1e-3);
  }
});

test('hash and rng: stable, in [0, 1)', () => {
  assert.equal(hash('hv1'), hash('hv1'));
  assert.notEqual(hash('hv1'), hash('hv2'));
  const r = rng(3);
  for (let i = 0; i < 100; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
});
