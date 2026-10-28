// Moons in the page contract (Wall plan night 5 B2, T10), additive only: the
// cockpit's `__cockpitView.map` takes a moon's id as it takes a site's or a
// planet's. `screenOf(moon)` is a point, `emphasis(moon)` follows a highlight
// that names it, and a show's `fly_to` on a moon frames it as a finger's tap
// on it does: its site held, the camera on its planet (camera.js PICK), its
// planet's ring open. A site, a planet and the sun fly as before.
// The large demo on the real scene with a fake renderer and clock, the camera
// and the director as main.js wires them (as wall-galaxy-pick.test.mjs).
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, showFlightMs } from '../public/js/wall/galaxy/camera.js';
import { OVERVIEW, createDirector, showNode, showTarget } from '../public/js/wall/galaxy/director.js';
import { SHOW, emphasisOf, initialShow, showStep } from '../public/js/wall/galaxy/show.js';
import { AT_OVERVIEW, moonsAt, placeOf, showPlace } from '../public/js/wall/galaxy/touch.js';
import { freeRect } from '../public/js/wall/galaxy/framing.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const W = 1368, H = 912;
const BA = 'builder:builder-a', BB = 'builder:builder-b';
const LANE = 'lane:builder-a/fix-login';
const MAIN = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');

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

/** The page over the large demo, the tour driving; `fly(id)` is main.js's flyTo: the show's target, its place, the ring asked. */
function page() {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  galaxy.update({ nodes: LARGE });
  const cam = createGalaxyCamera(galaxy, { steer: true, free: () => freeRect(W, H, []) });
  const director = createDirector(cam, { clock: () => clock.now, driver: 'tour' });
  let place = AT_OVERVIEW, byShow = null;
  const run = (ms, step = 1000 / 30) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + step);
      cam.frame(clock.now);
      galaxy.frame(clock.now);
    }
  };
  const fly = (id) => {
    const to = showTarget(galaxy.world, id, SHOW.zoom);
    if (!to) return null;
    const ms = showFlightMs(cam.pose(), cam.shotFor(to));
    director.show({ id: 'sh-1', to, ms });
    place = showPlace(to, place, byShow);
    byShow = to.member != null ? place : null;
    galaxy.openMoons(moonsAt(place));
    return { to, ms };
  };
  run(100);
  return { galaxy, cam, director, run, fly, place: () => place };
}

test('showNode and showTarget: a moon is known in its system and frames its planet; a site, a planet and the sun as before', () => {
  const { galaxy } = page();
  const w = galaxy.world;
  assert.deepEqual({ ...showNode(w, LANE), node: null }, { node: null, site: 'lab', moon: true });
  assert.equal(showNode(w, BA).moon, false);
  assert.equal(showNode(w, 'nope'), null);
  assert.equal(showNode(null, BA), null);
  assert.deepEqual(showTarget(w, LANE, 1.9), { kind: 'site', id: 'lab', zoom: 1.9, member: LANE });
  // Unchanged: a planet and its site fly to the site's shot, with no member; the sun is the overview.
  assert.deepEqual(showTarget(w, BA, 1.9), { kind: 'site', id: 'lab', zoom: 1.9 });
  assert.deepEqual(showTarget(w, 'lab', 1.9), { kind: 'site', id: 'lab', zoom: 1.9 });
  if (w.core) assert.equal(showTarget(w, w.core.id, 1.9), OVERVIEW);
  assert.equal(showTarget(w, 'nope', 1.9), null);
});

test('showPlace: a moon\'s flight is its planet\'s place; another show move takes back only the place a show set', () => {
  const moon = { kind: 'site', id: 'lab', zoom: 1.9, member: LANE };
  const site = { kind: 'site', id: 'hv2', zoom: 1.9 };
  const p = showPlace(moon, AT_OVERVIEW);
  assert.deepEqual(p, placeOf('lab', LANE));
  assert.equal(moonsAt(p), LANE, 'the scene opens the moon\'s planet\'s ring (scene.js openMoons)');
  assert.equal(showPlace(site, p, p), AT_OVERVIEW, 'the show flies elsewhere: its ring folds');
  assert.equal(showPlace(OVERVIEW, p, p), AT_OVERVIEW);
  const finger = placeOf('lab', BB);
  assert.equal(showPlace(site, finger, p), finger, 'a finger\'s place stays as before T10');
  assert.equal(showPlace(site, finger), finger);
});

test('page: fly_to a moon ends with its site held, the camera on its planet, its planet\'s ring open and the moon a point in the frame', () => {
  const p = page();
  assert.ok(p.cam.screenOf(LANE), 'screenOf(moon) is a point while folded too');
  const { ms } = p.fly(LANE);
  assert.equal(p.director.driver(), 'show');
  p.run(ms + OPEN_MS + 200);
  assert.equal(p.cam.flight(), null, 'landed');
  const want = p.cam.want();
  assert.equal(want.kind, 'site');
  assert.equal(want.id, 'lab', 'its site held');
  assert.equal(want.member, LANE, 'framed as a tap on the moon: on its planet');
  assert.equal(p.galaxy.moonsOpen(), BA, 'builder-a\'s ring open');
  const at = p.cam.screenOf(LANE);
  assert.ok(at && at.x > 0 && at.x < W && at.y > 0 && at.y < H, `the moon in the frame: ${JSON.stringify(at)}`);
  const planet = p.cam.screenOf(BA);
  assert.ok(Math.hypot(at.x - planet.x, at.y - planet.y) >= 72, 'on its open ring, clear of the planet');
  // Another show move (a site) folds the ring the show opened.
  const { ms: back } = p.fly('hv2');
  p.run(back + OPEN_MS + 200);
  assert.equal(p.cam.want().member, undefined);
  assert.equal(p.galaxy.moonsOpen(), null, 'folded with the show\'s move');
});

test('page: fly_to a planet is as before T10: its site, no member, no ring', () => {
  const p = page();
  const { ms } = p.fly(BA);
  p.run(ms + OPEN_MS + 200);
  assert.deepEqual([p.cam.want().kind, p.cam.want().id, p.cam.want().member], ['site', 'lab', undefined]);
  assert.equal(p.galaxy.moonsOpen(), null);
  assert.equal(p.place(), AT_OVERVIEW);
});

test('emphasis: a highlight naming a moon keeps it lit and dims the rest; one leaving it out dims it', () => {
  const { galaxy } = page();
  const known = (id) => showNode(galaxy.world, id) != null;
  const msg = (nodes) => ({ type: 'show', showId: 'sh-0001', turnId: 't-1', cmd: 'highlight', args: { nodes }, receivedAt: 1 });
  const ctx = { time: 1, known, inSight: () => true };
  const lit = showStep(initialShow(), { type: 'msg', msg: msg([LANE]) }, 1000, ctx);
  assert.deepEqual(lit.state.highlight.nodes, [LANE], 'a moon is a known node');
  assert.equal(emphasisOf(lit.state, LANE, 5000), 1);
  assert.ok(emphasisOf(lit.state, BA, 5000) < 1);
  const other = showStep(initialShow(), { type: 'msg', msg: msg([BA]) }, 1000, ctx);
  assert.ok(emphasisOf(other.state, LANE, 5000) < 1);
});

test('main.js: the show\'s node and target are director.js\'s, its moves set the place, the handle keeps every name', () => {
  assert.match(MAIN, /const nodeAt = \(id\) => showNode\(galaxy\.world, id\)/);
  assert.match(MAIN, /const targetOf = \(id, z = SHOW\.zoom\) => showTarget\(galaxy\.world, id, z\)/);
  assert.match(MAIN, /place = showPlace\(to, place, shownPlace\)/);
  for (const k of ['flyTo,', 'fitNodes,', 'camera: cameraNow', 'setCamera:', 'screenOf: (id)', 'onDraw: cam.onDraw', 'emphasis: (id)']) assert.ok(MAIN.includes(k), k);
});
