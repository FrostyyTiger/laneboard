// A picked planet (Wall plan night 5 B3, T9): a tap on a planet in an open
// system flies the camera about 45 % closer, along the system hold's own line
// of sight, the planet in the left part of the box the words leave free, so
// its ring of moons (T8) and the card (T17) take the empty right side. A tap
// on one of its moons keeps the camera; Back flies out to the system's hold.
// The large demo on the real scene with a fake renderer and clock, the
// camera and the director as main.js wires them, the covers where a 1368 px
// tablet draws them while a planet's sheet stands (r24's stills).
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, moonRingPx } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, planetShot, FLIGHT, PICK } from '../public/js/wall/galaxy/camera.js';
import { createDirector } from '../public/js/wall/galaxy/director.js';
import { freeRect } from '../public/js/wall/galaxy/framing.js';
import { TIMING } from '../public/js/wall/tour.js';

const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const W = 1368, H = 912;
const BA = 'builder:builder-a', BB = 'builder:builder-b';

// Where the words and the touch controls stand on a 1368 px tablet with a planet's sheet up.
const PLATE = { left: 110, top: 70, right: 780, bottom: 570 };
const TAG = { left: 990, top: 90, right: 1285, bottom: 135 };
const FLEET = { left: 670, top: 690, right: 1285, bottom: 840 };
const BACK = { left: 1160, top: 150, right: 1285, bottom: 230 };
const WORDS = [PLATE, TAG, FLEET];

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

/** The page's camera over the large demo: a finger has the page (the `explore` role), the clock is ours. */
function page({ still = false } = {}) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now, still,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  galaxy.update({ nodes: LARGE });
  const cam = createGalaxyCamera(galaxy, {
    still, steer: !still, free: () => freeRect(W, H, WORDS), pickFree: () => freeRect(W, H, [...WORDS, BACK]),
  });
  const director = createDirector(cam, { clock: () => clock.now, still, driver: 'touch' });
  const finger = director.as('touch');
  const run = (ms, step = 1000 / 30) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + step);
      cam.frame(clock.now);
      galaxy.frame(clock.now);
    }
  };
  // As main.js: a tap on a planet asks its moons' ring open and the camera on to it (openPlanet).
  const pick = (id) => {
    if (still) finger.cut('lab', TIMING.zoom, { member: id }); else finger.focus('lab', TIMING.zoom, { member: id });
    galaxy.openMoons(id);
  };
  const lab = galaxy.world.byId.get('lab');
  const away = () => { const p = cam.pose(); return Math.hypot(p.pos.x - p.look.x, p.pos.y - p.look.y, p.pos.z - p.look.z); };
  return { galaxy, cam, finger, run, pick, lab, away, clock };
}

const inside = (p, b, pad = 0) => p.x - p.r >= b.left - pad && p.x + p.r <= b.right + pad && p.y - p.r >= b.top - pad && p.y + p.r <= b.bottom + pad;
const meets = (p, b) => p.x + p.r > b.left && p.x - p.r < b.right && p.y + p.r > b.top && p.y - p.r < b.bottom;

test('planetShot: closer along the hold\'s line of sight, the planet at PICK.at of the free box, clear of its ring by the box edge', () => {
  const hold = { pos: { x: 1000, y: 750, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  const p = { x: 120, y: 0, z: -80 };
  const view = { fov: 42, aspect: W / H, H, free: { x0: 0.6, y0: 0.1, x1: 1, y1: 0.75 } };
  const s = planetShot(hold, p, view);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(Math.abs(d(s.pos, s.look) / d(hold.pos, hold.look) - PICK.closer) < 1e-9, 'PICK.closer of the hold\'s distance');
  const dir = (q) => { const l = d(q.pos, q.look); return [(q.pos.x - q.look.x) / l, (q.pos.y - q.look.y) / l, (q.pos.z - q.look.z) / l]; };
  dir(s).forEach((c, i) => assert.ok(Math.abs(c - dir(hold)[i]) < 1e-9, 'the same direction: no swing'));
  // Where the planet lands: project it by hand.
  const ndc = ndcAt(s, p, 42, W / H);
  const x = ((ndc.x + 1) / 2) * W, y = ((1 - ndc.y) / 2) * H;
  const b = view.free, bw = (b.x1 - b.x0) * W;
  assert.ok(Math.abs(x - (b.x0 * W + Math.max(PICK.padPx, PICK.at * bw))) < 0.5, `x ${x.toFixed(1)}`);
  assert.ok(Math.abs(y - ((b.y0 + b.y1) / 2) * H) < 0.5, `y ${y.toFixed(1)}: the box's middle`);
  // A wide ring keeps the planet in from the box's edge, never past its middle.
  const ring = planetShot(hold, p, { ...view, ringPx: 120 });
  const rx = ((ndcAt(ring, p, 42, W / H).x + 1) / 2) * W;
  assert.ok(Math.abs(rx - (b.x0 * W + 120 + PICK.padPx)) < 0.5, `ring room: ${rx.toFixed(1)}`);
  const huge = planetShot(hold, p, { ...view, ringPx: 900 });
  assert.ok(Math.abs(((ndcAt(huge, p, 42, W / H).x + 1) / 2) * W - ((b.x0 + b.x1) / 2) * W) < 0.5, 'never past the box\'s middle');
  assert.equal(planetShot(hold, null, view), hold, 'no planet: the hold');
});

test('page: a tap on builder-a flies 45 % closer, builder-a in the left 45 % of the free box, its ring inside the frame and off the words and Back', () => {
  const p = page();
  p.finger.focus('lab', TIMING.zoom);
  p.run(FLIGHT.ms + OPEN_MS + 200);
  const hold = p.away();
  const before = p.cam.screenOf(BA);
  p.pick(BA);
  assert.equal(p.cam.want().member, BA, 'the camera wants builder-a');
  p.run(FLIGHT.ms * 0.5);
  const mid = p.away();
  assert.ok(mid < hold && mid > hold * PICK.closer, `on its way: ${(mid / hold).toFixed(2)}`);
  p.run(FLIGHT.ms * 0.5 + OPEN_MS);
  const ratio = p.away() / hold;
  assert.ok(Math.abs(ratio - 0.55) < 0.03, `the camera ${ratio.toFixed(3)} of the hold's distance`);
  const box = freeRect(W, H, [...WORDS, BACK]);
  const planet = p.cam.screenOf(BA);
  const across = (planet.x / W - box.x0) / (box.x1 - box.x0);
  assert.ok(across >= 0 && across <= 0.45, `builder-a ${(across * 100).toFixed(0)} % across the free box (was at x ${before.x.toFixed(0)})`);
  assert.ok(planet.y > box.y0 * H && planet.y < box.y1 * H, 'in the free box\'s height');
  const moons = p.lab.members.filter((m) => m.moon?.host?.id === BA);
  assert.ok(moons.length >= 3, 'builder-a carries its lanes and sessions');
  const frame = { left: 0, top: 0, right: W, bottom: H };
  for (const m of moons) {
    const s = p.cam.screenOf(m.id);
    assert.ok(s && inside(s, frame), `${m.id} inside the frame: ${JSON.stringify(s)}`);
    for (const [name, c] of Object.entries({ PLATE, TAG, FLEET, BACK })) assert.ok(!meets(s, c), `${m.id} off the ${name}`);
  }
  // The ring as a whole (moonRingPx round the planet) stands inside the frame.
  const R = moonRingPx(moons.length);
  assert.ok(planet.x - R > 0 && planet.x + R < W && planet.y - R > 0 && planet.y + R < H, 'the ring inside the frame');
});

test('page: a moon\'s tap keeps the camera on its planet; another planet flies on; Back to the system flies out to its hold, the drift not restarted', () => {
  const p = page();
  p.finger.focus('lab', TIMING.zoom);
  p.run(FLIGHT.ms + OPEN_MS + 200);
  const hold = p.away();
  p.pick(BA);
  p.run(FLIGHT.ms + OPEN_MS);
  const at = p.cam.screenOf(BA);
  const moon = p.lab.members.find((m) => m.moon?.host?.id === BA);
  p.pick(moon.id);
  p.run(FLIGHT.ms);
  const still = p.cam.screenOf(BA);
  assert.ok(Math.hypot(still.x - at.x, still.y - at.y) < 6, `the moon's tap keeps builder-a where it was (${(still.x - at.x).toFixed(1)}, ${(still.y - at.y).toFixed(1)})`);
  p.pick(BB);
  p.run(FLIGHT.ms + OPEN_MS);
  const bb = p.cam.screenOf(BB);
  const box = freeRect(W, H, [...WORDS, BACK]);
  assert.ok((bb.x / W - box.x0) / (box.x1 - box.x0) <= 0.45, 'builder-b is the one framed now');
  assert.ok(Math.abs(p.away() / hold - PICK.closer) < 0.03);
  // Back to the system: the site's own shot again (main.js openSite: `there` only without a member).
  const t = p.clock.now;
  p.finger.focus('lab', TIMING.zoom);
  assert.equal(p.cam.want().member, undefined);
  p.run(FLIGHT.ms);
  assert.ok(Math.abs(p.away() / hold - 1) < 0.02, `out to the hold's distance: ${(p.away() / hold).toFixed(3)}`);
  assert.ok(p.clock.now - t >= FLIGHT.ms);
});

test('page in reduced motion: a planet\'s tap is a cut onto the same shot', () => {
  const p = page({ still: true });
  p.finger.cut('lab', TIMING.zoom);
  p.run(100);
  const hold = p.away();
  p.pick(BA);
  p.run(34);
  assert.equal(p.cam.want().cut, true);
  assert.ok(Math.abs(p.away() / hold - PICK.closer) < 0.01, `at once: ${(p.away() / hold).toFixed(3)}`);
});

test('main.js: a planet\'s tap asks the director for the planet in its site (a cut in reduced motion), Back\'s system flies when a planet was framed', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  const open = js.slice(js.indexOf('const openPlanet = '), js.indexOf('place = placeOf(site, id);'));
  assert.match(open, /finger\.focus\(site, TIMING\.zoom, \{ member: id \}\)/);
  assert.match(open, /finger\.cut\(site, TIMING\.zoom, \{ member: id \}\)/);
  assert.match(js, /const there = w\.kind === 'site' && w\.id === id && w\.member == null/);
  assert.match(js, /pickFree: pickBox/);
});

/** `p` in NDC seen from `shot` (three.js lookAt, +y up). */
function ndcAt(shot, p, fov, aspect) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  const f = norm(sub(shot.look, shot.pos));
  const r = norm({ x: -f.z, y: 0, z: f.x });
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = sub(p, shot.pos), z = dot(d, f), t = Math.tan((fov * Math.PI) / 360);
  return { x: dot(d, r) / (z * t * aspect), y: dot(d, u) / (z * t) };
}
