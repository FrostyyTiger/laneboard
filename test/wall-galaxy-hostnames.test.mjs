// HV1's builders named in the tour's hold (Wall plan night 5 T6b, split from
// T6): with the trouble plate up, `ba` and `bb` lost every side to their own
// lanes in trouble, moons (T7) a few px off them. A planet's name now goes
// just before its own moons' names and may stand just outside their ring; a
// moon in trouble that loses its place to it is said by the planet, in the
// moon's shape and hue. The scene runs on a fake renderer and clock, as in
// the moons test.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteFrom, toneOf } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, FOV } from '../public/js/wall/galaxy/scene.js';
import { createLabels, candidates, overlaps, placeLabels, GAP, RANK } from '../public/js/wall/galaxy/labels.js';
import { zoomedSiteShot } from '../public/js/wall/galaxy/camera.js';
import { freeRect } from '../public/js/wall/galaxy/framing.js';
import { DEMO_TIMING } from '../public/js/wall/tour.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

// The tablet's css frame and the trouble plate's covers (as the framing test measures them).
const W = 1368, H = 912;
const COVERS = [
  { left: 82, top: 73, right: 793, bottom: 560 },
  { left: 496, top: 675, right: 1369, bottom: 912 },
  { left: 992, top: 95, right: 1286, bottom: 111 },
];

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

const span = () => ({
  style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, dataset: {}, textContent: '', className: '', remove() {}, append: () => {},
});

function heldLab() {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  galaxy.update({ nodes: LARGE });
  galaxy.setOpen('lab', 1);
  const view = { fov: FOV, aspect: W / H, free: freeRect(W, H, COVERS) };
  return (t) => {
    clock.now = t;
    galaxy.frame(t);
    const lab = galaxy.world.byId.get('lab');
    const shot = zoomedSiteShot(lab, t, DEMO_TIMING.zoom, view);
    galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
    galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
    galaxy.camera.updateMatrixWorld();
    const labels = createLabels(span(), galaxy, { steps: { site: 26, room: 15 }, covers: () => COVERS, doc: { createElement: span } });
    labels.draw();
    return { lab, shown: labels.shown() };
  };
}

test('T6b: HV1 held with the trouble plate up names ba, bb and bc at four times, clear of the plate and of each other', () => {
  const at = heldLab();
  for (const t of [5000, 30_000, 60_000, 90_000]) {
    const { lab, shown } = at(t);
    const byId = new Map(shown.map((s) => [s.id, s]));
    for (const [id, word] of [['builder:builder-a', 'ba'], ['builder:builder-b', 'bb'], ['builder:builder-c', 'bc']]) {
      const s = byId.get(id);
      assert.ok(s, `@${t}: ${word} named (${shown.map((x) => x.id).join(' ')})`);
      assert.ok(s.text.endsWith(word), `@${t}: ${s.text}`);
      for (const c of COVERS) assert.ok(!overlaps(s.box, { x: c.left, y: c.top, w: c.right - c.left, h: c.bottom - c.top }), `@${t}: ${word} off the plate`);
    }
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) assert.ok(!overlaps(shown[i].box, shown[j].box), `@${t}: ${shown[i].id} and ${shown[j].id} overlap`);
    }
    // Every moon in trouble is named, or its planet says it in the moon's shape and hue.
    for (const m of lab.members.filter((x) => x.moon && ['warn', 'crit'].includes(toneOf(x.node)))) {
      if (byId.has(m.id)) continue;
      const host = byId.get(m.moon.host.id);
      assert.ok(host && host.tone !== 'calm' && host.text.startsWith('▲'), `@${t}: ${m.id} unnamed, so ${host?.text} carries it`);
    }
  }
});

test('placeLabels: a planet goes just before the first of its own moons, ahead of their trouble', () => {
  // The moon's name takes the only free side unless its planet goes first.
  const planet = { id: 'p', rank: RANK.room, near: 10, cands: [{ x: 100, y: 100, w: 30, h: 16 }] };
  const moon = { id: 'm', rank: RANK.trouble, near: 5, host: 'p', cands: [{ x: 110, y: 100, w: 60, h: 16 }, { x: 300, y: 300, w: 60, h: 16 }] };
  const shown = placeLabels([moon, planet]);
  assert.deepEqual([...shown.keys()], ['p', 'm']);
  assert.equal(shown.get('m').at, 1, 'the moon takes its other side');
  // Without the tie the trouble goes first, as before.
  const loose = placeLabels([{ ...moon, host: undefined }, planet]);
  assert.deepEqual([...loose.keys()], ['m']);
  // Another planet's trouble still goes ahead of a calm planet.
  const other = { ...moon, id: 'o', host: 'q' };
  assert.deepEqual([...placeLabels([planet, other]).keys()], ['o']);
});

test('candidates: a ring adds the four sides again just outside it, after the near ones', () => {
  const near = candidates(100, 100, 8, 20, 10);
  const ringed = candidates(100, 100, 8, 20, 10, false, 30);
  assert.deepEqual(ringed.slice(0, 4), near);
  assert.equal(ringed.length, 8);
  assert.deepEqual(ringed[4], { x: 100 + 30 + GAP, y: 95, w: 20, h: 10 });
  assert.deepEqual(ringed[7], { x: 90, y: 100 + 30 + GAP, w: 20, h: 10 });
  assert.equal(candidates(100, 100, 8, 20, 10, false, 6).length, 4, 'a ring inside the body adds nothing');
});
