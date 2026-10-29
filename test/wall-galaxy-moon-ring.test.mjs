// Moons, opened (Wall plan night 5 B2 open, T8; the owner's sketch pick
// `sk_moons=1`): tapping a planet (or one of its moons) eases its moons out
// onto one ring round it, over the site's open time on smootherstep, the ring
// facing the camera with its top tilted toward it, a faint orbit line and
// thin tethers. On screen its moons stand about 110 px apart and at least
// 72 px from the planet; open, they are named and targets; another planet's
// tap folds the first's. No picker. The scene runs on a fake renderer and
// clock, as in the moons, carry and trouble tests.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom, toneOf } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, moonRingPx, ringAngle, siteShot, MOON, MOON_RING } from '../public/js/wall/galaxy/scene.js';
import { createLabels } from '../public/js/wall/galaxy/labels.js';
import { AT_OVERVIEW, TAP, memberHit, memberPoints, moonsAt, placeOf } from '../public/js/wall/galaxy/touch.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const W = 1368, H = 912;
const troubled = (m) => ['warn', 'crit'].includes(toneOf(m.node));

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

function fakeLabelDoc() {
  const el = () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return { style, dataset: {}, textContent: '', className: '', removed: false, remove() { this.removed = true; }, append: () => {} };
  };
  return { doc: { createElement: el }, root: el() };
}

/** The large demo on the scene, HV1 (`lab`) open and the camera on its held shot. */
function heldLab(opts = {}) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
    ...opts,
  });
  galaxy.update({ nodes: LARGE });
  galaxy.setOpen('lab', 1);
  const lab = galaxy.world.byId.get('lab');
  const shot = siteShot(lab, 0);
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  at(1000);
  const v = galaxy.camera.position.clone();
  const screenOf = (id) => {
    const m = lab.members.find((x) => x.id === id);
    if (!m) return null;
    v.copy(m.mesh.position).project(galaxy.camera);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, r: 10 };
  };
  const { doc, root } = fakeLabelDoc();
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, doc });
  const named = () => { labels.draw(); return new Set(labels.shown().map((s) => s.id)); };
  const targets = () => new Set(memberPoints(galaxy.world.sites, screenOf).map((p) => p.id));
  // Every member point within a finger's reach (T11's 48 px), and what the page's pick makes of them.
  const hits = (x, y) => memberPoints(galaxy.world.sites, screenOf).filter((p) => Math.hypot(p.x - x, p.y - y) <= Math.max(TAP.fingerPx, p.r));
  const pick = (x, y) => memberHit(memberPoints(galaxy.world.sites, screenOf), x, y);
  return { galaxy, lab, at, clock, screenOf, named, targets, hits, pick };
}

const moonsOf = (lab, host) => lab.members.filter((m) => m.moon?.host?.id === host);
const px = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const BA = 'builder:builder-a', BB = 'builder:builder-b';

test('moonRingPx: neighbours gapPx apart along the circle, never under minPx, clear of a big planet; ringAngle from the top, clockwise', () => {
  const c = Math.cos(MOON_RING.tilt);
  assert.ok(Math.abs(moonRingPx(1) * c - MOON_RING.minPx) < 1e-9, 'one moon: the least distance');
  assert.ok(Math.abs(moonRingPx(2) * c - MOON_RING.minPx) < 1e-9, 'two moons stand 2·minPx apart already');
  for (const n of [3, 5, 8, 12]) {
    const R = moonRingPx(n) * c;
    assert.ok(2 * R * Math.sin(Math.PI / n) >= MOON_RING.gapPx - 1e-9, `${n} moons: neighbours ${MOON_RING.gapPx} px apart after the tilt`);
  }
  assert.ok(moonRingPx(1, 90, 10) * c >= 90 + 10 + MOON_RING.clearPx - 1e-9, 'past a close planet\'s disc and the moon\'s');
  assert.ok(Math.abs(ringAngle(0, 4) - Math.PI / 2) < 1e-12, 'the first at the top');
  assert.ok(ringAngle(1, 4) < ringAngle(0, 4), 'then clockwise');
});

test('moonsAt: a picked planet (or moon) opens its ring; a system and the overview fold it', () => {
  assert.equal(moonsAt(placeOf('lab', BA)), BA);
  assert.equal(moonsAt(placeOf('lab', 'lane:builder-a/fix-login')), 'lane:builder-a/fix-login');
  assert.equal(moonsAt(placeOf('lab')), null);
  assert.equal(moonsAt(AT_OVERVIEW), null);
  assert.equal(moonsAt(undefined), null);
});

test('scene: a picked builder\'s moons open onto a ring, >= 72 px from it and >= 100 px apart on screen, named and targets only while open', () => {
  const { galaxy, lab, at, screenOf, named, targets } = heldLab();
  const moons = moonsOf(lab, BA);
  assert.equal(moons.length, 5, 'builder-a: three lanes and two sessions');
  const calm = moons.filter((m) => !troubled(m));
  assert.ok(calm.length >= 2, 'the fixture has calm moons on builder-a');
  // Folded: the calm ones are neither named nor targets (T7).
  let n = named(), t = targets();
  for (const m of calm) assert.ok(!n.has(m.id) && !t.has(m.id), `${m.id} folded`);
  assert.equal(galaxy.openMoons(BA), BA);
  assert.equal(galaxy.moonsOpen(), BA);
  // Half way through the opening they are on their way, not there.
  at(1000 + OPEN_MS / 2);
  const p = screenOf(BA);
  const mid = Math.min(...moons.map((m) => px(screenOf(m.id), p)));
  at(1000 + OPEN_MS + 50);
  const near = Math.min(...moons.map((m) => px(screenOf(m.id), p)));
  assert.ok(mid < near, `still opening at half time (${mid.toFixed(0)} < ${near.toFixed(0)} px)`);
  for (const m of moons) {
    const d = px(screenOf(m.id), p);
    assert.ok(d >= 72, `${m.id} ${d.toFixed(0)} px from builder-a`);
    for (const o of moons) {
      if (o === m) continue;
      const g = px(screenOf(m.id), screenOf(o.id));
      assert.ok(g >= 100, `${m.id} and ${o.id} ${g.toFixed(0)} px apart`);
    }
  }
  // Spaced near 110 px, not flung across the frame.
  assert.ok(near < 160, `the ring stays close: ${near.toFixed(0)} px`);
  // Opened, a calm moon is drawn at MOON.calm and is named and a target.
  n = named(); t = targets();
  for (const m of moons) {
    assert.ok(t.has(m.id), `${m.id} a target while open`);
    assert.ok(n.has(m.id), `${m.id} named while open`);
  }
  for (const m of calm) assert.ok(Math.abs(m.mesh.scale.x * m.mesh.geometry.parameters.radius - MOON.calm) < 1e-9, `${m.id} at MOON.calm`);
  assert.ok(n.has(BA), 'the planet keeps its name');
  // It holds still on the ring while open: a finger aims at it.
  const before = moons.map((m) => screenOf(m.id));
  at(1000 + OPEN_MS + 20000);
  moons.forEach((m, i) => assert.ok(px(screenOf(m.id), before[i]) < 0.5, `${m.id} stays put`));
  // The faint orbit line and the tethers are drawn, faint.
  assert.equal(lab.moonLines.visible, true);
  const verts = lab.moonLines.geometry.drawRange.count;
  assert.equal(verts, (MOON_RING.segs + moons.length) * 2, 'one ring and a tether per moon');
  assert.ok(lab.moonLines.material.opacity > 0 && lab.moonLines.material.opacity <= 0.5, `faint: ${lab.moonLines.material.opacity}`);
});

test('scene: another planet\'s pick folds the first\'s ring; null folds them all; a moon\'s pick keeps its planet\'s open', () => {
  const { galaxy, lab, at, screenOf, named, targets } = heldLab();
  galaxy.openMoons(BA);
  at(1000 + OPEN_MS + 50);
  const aCalm = moonsOf(lab, BA).filter((m) => !troubled(m));
  // A tap on one of its moons keeps the ring as it is.
  assert.equal(galaxy.openMoons('lane:builder-a/fix-login'), BA);
  const kept = screenOf(aCalm[0].id);
  at(1000 + OPEN_MS + 500);
  assert.ok(px(screenOf(aCalm[0].id), kept) < 0.5, 'no fold and open again');
  // Builder-b: its ring opens, builder-a's folds.
  assert.equal(galaxy.openMoons(BB), BB);
  const t1 = 1000 + OPEN_MS + 500;
  at(t1 + OPEN_MS + 50);
  const n = named(), t = targets();
  for (const m of aCalm) {
    assert.ok(!n.has(m.id) && !t.has(m.id), `${m.id} folded again: unnamed, no target`);
    const d = m.mesh.position.distanceTo(m.moon.host.mesh.position);
    const hostR = m.moon.host.mesh.scale.x * m.moon.host.mesh.geometry.parameters.radius;
    assert.ok(Math.abs(d - (hostR * MOON.tight + MOON.pad + MOON.calm * MOON.foldK)) < 1e-6, `${m.id} back on its tight orbit`);
  }
  for (const m of moonsOf(lab, BB)) assert.ok(t.has(m.id), `${m.id} open`);
  assert.equal(lab.moonLines.geometry.drawRange.count, (MOON_RING.segs + moonsOf(lab, BB).length) * 2, 'only builder-b\'s ring drawn');
  // A planet with no moons folds every ring; so does null.
  const bare = lab.members.find((m) => m.planet && !lab.members.some((x) => x.moon?.host === m));
  assert.ok(bare, 'a planet with no moons');
  assert.equal(galaxy.openMoons(bare.id), null);
  assert.equal(galaxy.moonsOpen(), null);
  at(t1 + 2 * OPEN_MS + 100);
  for (const m of moonsOf(lab, BB).filter((x) => !troubled(x))) assert.ok(!targets().has(m.id), `${m.id} folded by a bare planet`);
  assert.equal(lab.moonLines.visible, false, 'no ring line left');
  galaxy.openMoons(BA);
  galaxy.openMoons(null);
  assert.equal(galaxy.moonsOpen(), null);
});

test('scene: a folding system takes its open ring with it; still mode opens the ring at once and keeps it facing the camera', () => {
  const { galaxy, lab, at, targets } = heldLab();
  galaxy.openMoons(BA);
  at(1000 + OPEN_MS + 50);
  galaxy.setOpen('lab', 0);
  at(1000 + OPEN_MS + 100);
  for (const m of moonsOf(lab, BA).filter((x) => !troubled(x))) assert.equal(m.mesh.visible, false, `${m.id} goes with its folded system`);
  assert.equal(lab.moonLines.visible, false);
  assert.ok(!targets().has(moonsOf(lab, BA).find((x) => !troubled(x)).id));
  const still = heldLab({ still: true });
  still.galaxy.openMoons(BA);
  still.at(1016);
  const p = still.screenOf(BA);
  for (const m of moonsOf(still.lab, BA)) assert.ok(px(still.screenOf(m.id), p) >= 72, `${m.id} out at once in still mode`);
});

test('memberHit: no picker: the nearest centre, a planet with its own folded moons is the planet, a moon on an open ring its own target', () => {
  const P = { id: 'b', site: 's', x: 100, y: 100 };
  const m1 = { id: 'l1', site: 's', host: 'b', onRing: false, x: 110, y: 100 };
  const Q = { id: 'c', site: 's', x: 160, y: 100 };
  assert.equal(memberHit([], 0, 0), null);
  assert.equal(memberHit([m1], 112, 100), m1, 'a folded moon alone in reach is itself');
  assert.equal(memberHit([m1, P], 111, 100), P, 'its planet in reach too: the planet');
  assert.equal(memberHit([P, Q], 125, 100), P, 'two planets: the nearer, no fan');
  assert.equal(memberHit([P, Q], 140, 100), Q);
  assert.equal(memberHit([m1, P], 155, 100), m1, 'its planet out of reach: the moon itself, as before T11');
  const open = { id: 'l3', site: 's', host: 'c', onRing: true, x: 160, y: 180 };
  assert.equal(memberHit([Q, open], 160, 150), open, 'a moon on the open ring, nearest, is its own');
});

test('page pick on the large demo: a finger on builder-a (its trouble moons tight round it) means builder-a; open, each moon is its own target', () => {
  const { galaxy, lab, at, screenOf, hits, pick } = heldLab();
  // From twice the held shot's distance, as a tapped system is framed on the page, the moons crowd it.
  const look = siteShot(lab, 0).look, cp = galaxy.camera.position;
  cp.set(look.x + (cp.x - look.x) * 2, look.y + (cp.y - look.y) * 2, look.z + (cp.z - look.z) * 2);
  galaxy.camera.updateMatrixWorld();
  at(1100);
  const p = screenOf(BA);
  const under = hits(p.x, p.y);
  assert.ok(under.length > 1, `folded, its moons are under the finger too: ${under.map((h) => h.id).join(' ')}`);
  assert.equal(pick(p.x, p.y)?.id, BA, 'one planet: no picker');
  const held = siteShot(lab, 0).pos;
  galaxy.camera.position.set(held.x, held.y, held.z);
  galaxy.camera.updateMatrixWorld();
  galaxy.openMoons(BA);
  at(1000 + OPEN_MS + 50);
  for (const m of moonsOf(lab, BA)) {
    const sp = screenOf(m.id);
    const h = pick(sp.x, sp.y);
    assert.equal(h?.id, m.id, `a finger on ${m.id} opens it`);
  }
  const q = screenOf(BA);
  const onPlanet = hits(q.x, q.y);
  assert.equal(pick(q.x, q.y)?.id, BA, `the planet is still the planet: ${onPlanet.map((h) => h.id).join(' ')}`);
});
