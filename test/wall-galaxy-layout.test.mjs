// The galaxy's layout (Wall plan night 2 T1, public/js/wall/galaxy/layout.js):
// sites on two spiral arms, the dust band, a system's planets on inclined
// orbits from the orbits layout, and the fold from a tight cluster to an
// open system. Pure, so it runs without a DOM or three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  armPoint, armSpine, dustPoints, farStars, galaxyLayout, foldAt, ease, hash, rng, siteSpot,
  ARM, ARM_BAND, ARM_RIBBON, CLOSED, MIN_SITE_GAP, ROOM, SITE_LIFT, SPREAD, TIGHT, TILT,
} from '../public/js/wall/galaxy/layout.js';
import { OVERVIEW_MARGIN, SIZE } from '../public/js/wall/galaxy/scene.js';
import { NEBULA } from '../public/js/wall/galaxy/palette.js';
import { tourSites } from '../public/js/wall/tour.js';

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

test('arms: alternate sites sit on opposite arms, each farther out than the last', () => {
  const r = (p) => Math.hypot(p.x, p.z);
  for (let i = 0; i + 1 < 12; i++) assert.ok(r(armPoint(i + 1, 12)) > r(armPoint(i, 12)), `site ${i + 1} beyond ${i}`);
  for (let i = 0; i < 12; i++) {
    assert.equal(siteSpot(i).arm, i % 2);
    assert.deepEqual(armPoint(i, 12), armSpine(siteSpot(i).arm, siteSpot(i).t));
  }
  assert.equal(armPoint(4, 6).y, 0);
});

test('arms: the rosette (night 5 A2), a site every 72° round the sun', () => {
  const deg = (p) => (((Math.atan2(p.z, p.x) * 180) / Math.PI) % 360 + 360) % 360;
  const angles = [0, 1, 2, 3, 4].map((i) => deg(armPoint(i, 5)));
  // In site order each next one is a fifth of a turn on.
  for (let i = 0; i + 1 < 5; i++) {
    const step = (((angles[i + 1] - angles[i]) % 360) + 360) % 360;
    assert.ok(Math.abs(step - 216) < 1e-6 || Math.abs(step - 72) < 1e-6, `site ${i} to ${i + 1}: ${step}°`);
  }
  const sorted = [...angles].sort((a, b) => a - b);
  for (let i = 0; i < 5; i++) {
    const gap = ((sorted[(i + 1) % 5] - sorted[i]) % 360 + 360) % 360;
    assert.ok(Math.abs(gap - 72) < 1e-6, `five sites stand 72° apart, saw ${gap}°`);
  }
});

test('arms: all sites level, on the plane', () => {
  for (const nodes of [FLEET, fleet(3), fleet(12)]) {
    for (const s of galaxyLayout(nodes).sites) assert.equal(s.home.y, 0, `${s.id} is level`);
  }
});

test('arms: only shown sites take the slots, in model order; a hidden one leaves no gap', () => {
  const nodes = fleet(6);
  const all = galaxyLayout(nodes).sites;
  const shown = ['site-0', 'site-2', 'site-3', 'site-5'];
  const g = galaxyLayout(nodes, 16 / 9, shown);
  const at = (id) => g.sites.find((s) => s.id === id).home;
  shown.forEach((id, slot) => assert.deepEqual(at(id), { ...armPoint(slot, 6), y: 0 }, `${id} takes slot ${slot}`));
  // The hidden ones follow, farther out, in model order.
  assert.deepEqual(at('site-1'), { ...armPoint(4, 6), y: 0 });
  assert.deepEqual(at('site-4'), { ...armPoint(5, 6), y: 0 });
  // Sites keep model order in the list, and without `shown` every site keeps its own slot.
  assert.deepEqual(g.sites.map((s) => s.id), all.map((s) => s.id));
  all.forEach((s, i) => assert.deepEqual(s.home, { ...armPoint(i, 6), y: 0 }));
  // The large demo's hidden repo index (calm) goes last, so the five shown sites take slots 0-4.
  const ids = tourSites(FLEET).map((s) => s.id);
  assert.equal(ids.length, 5);
  const big = galaxyLayout(FLEET, 16 / 9, ids);
  ids.forEach((id, slot) => assert.deepEqual(big.sites.find((s) => s.id === id).home, { ...armPoint(slot, 6), y: 0 }));
});

test('arms: an open system never reaches the sun\'s halo, on the large demo and 1 to 12 sites', () => {
  const halo = SIZE.sunHalo / 2;
  for (const nodes of [FLEET, ...Array.from({ length: 12 }, (_, i) => fleet(i + 1))]) {
    const ids = tourSites(nodes).map((s) => s.id);
    for (const s of galaxyLayout(nodes, 16 / 9, ids).sites) {
      const d = Math.hypot(s.home.x, s.home.y, s.home.z);
      assert.ok(d > s.reach + halo, `${s.id}: star ${d.toFixed(0)} out, open reach ${s.reach.toFixed(0)} + halo ${halo}`);
    }
  }
});

test('spacing half (night 5 A1): arms, gaps, ribbon and dust at 0.5x, nebulae and sun halo 0.64x, spread 0.75x', () => {
  assert.deepEqual({ ...TIGHT }, { arm: 0.5, neb: 0.64, spread: 0.75 });
  assert.equal(ARM.r0, 1250 * TIGHT.arm * ROOM.arms, 'and out again with the room (B1)');
  assert.ok(ARM.step >= MIN_SITE_GAP / 2.5, 'a lapped rosette keeps the gap');
  assert.ok(Math.abs(ARM.turn - (2 * Math.PI) / 5) < 1e-12);
  assert.equal(SITE_LIFT, 130 * TIGHT.arm);
  assert.equal(MIN_SITE_GAP, 700 * TIGHT.neb);
  assert.equal(SPREAD, 2.2 * TIGHT.spread * ROOM.spread);
  assert.equal(ARM_RIBBON.half, 90 * TIGHT.arm);
  assert.equal(ARM_RIBBON.grow, 16 * TIGHT.arm);
  assert.equal(ARM_RIBBON.maxHalf, 170 * TIGHT.arm);
  assert.equal(ARM_BAND.half, 55 * TIGHT.arm);
  assert.equal(SIZE.sunHalo, 640 * TIGHT.neb);
  assert.equal(OVERVIEW_MARGIN, 400 * TIGHT.arm * ROOM.arms);
  assert.deepEqual([NEBULA.calm.size, NEBULA.low.size, NEBULA.warn.size, NEBULA.crit.size], [520, 560, 640, 680].map((x) => x * TIGHT.neb));
  // The nebulae never meet: the gap holds the largest one.
  assert.ok(Math.max(...Object.values(NEBULA).map((n) => n.size)) <= MIN_SITE_GAP);
  const d = dustPoints(2000);
  let far = 0;
  for (let i = 0; i < 2000; i++) far = Math.max(far, Math.hypot(d.positions[i * 3], d.positions[i * 3 + 2]));
  assert.ok(far < 1000 * ROOM.arms, `the dust band is half as wide, out with the arms (B1): ${far.toFixed(0)}`);
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
