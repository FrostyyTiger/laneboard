// No words on words or off the frame (Wall plan night 3 T26, r31-film-ui
// galaxy 4): every name the galaxy shows keeps a margin inside the frame's
// edge (`HOME` was cut by the top edge), and stays off the clock, the tag,
// the plate, the fleet line and the lock's brackets, on the large demo at
// `?at=home`, the overview and a held site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as THREE from '../public/vendor/three/three.module.js';
import { placeLabels, createLabels, overlaps, boxOf, edgeOf, EDGE, GAP } from '../public/js/wall/galaxy/labels.js';
import { cornerCovers, lockGeometry3d } from '../public/js/wall/galaxy/lock.js';
import { createHud } from '../public/js/wall/galaxy/hud.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { siteShot, FOV } from '../public/js/wall/galaxy/scene.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { tourSites } from '../public/js/wall/tour.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const STATUS = new Map(tourSites(FLEET).map((s) => [s.id, s.status]));
const W = 1368, H = 912;
const STEPS = { site: 26, room: 15 };

// The frame's blocks where wall.css puts them on a 1368 x 912 stage (r58 film): the plate top left (a sheet,
// every row in), the tag top right, the clock bottom left, the fleet line bottom right at its far step.
const PLATE = { left: 82, top: 72, right: 560, bottom: 330 };
const TAG = { left: 990, top: 92, right: 1286, bottom: 112 };
const CLOCK = { left: 82, top: 762, right: 216, bottom: 842 };
const FLEET_LINE = { left: 670, top: 688, right: 1286, bottom: 842 };
const FRAME = [PLATE, TAG, CLOCK, FLEET_LINE];

function fakeDoc() {
  const el = () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return { style, dataset: {}, textContent: '', className: '', remove() {}, append: () => {} };
  };
  return { doc: { createElement: el }, root: el() };
}

function worldOf(openId) {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => {
    const open = s.id === openId ? 1 : 0;
    const members = s.members.map((m) => {
      const k = open ? 1 : 0.16;
      const p = new THREE.Vector3(s.home.x + m.off.x * k, s.home.y + m.off.y * k, s.home.z + m.off.z * k);
      return { ...m, tone: toneOf(m.node), mesh: { position: p } };
    });
    return { ...s, members, open, status: STATUS.get(s.id) ?? s.node.status };
  });
  return { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
}

function galaxyAt(world, shot) {
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  camera.updateMatrixWorld();
  return { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } };
}

const screenOf = (galaxy, pos) => {
  const v = pos.clone().project(galaxy.camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
};

// Every shown name inside the margin and off every cover.
function clear(shown, covers, what) {
  const e = edgeOf(W, H);
  assert.ok(shown.length >= 3, `${what}: names are shown (${shown.length})`);
  for (const s of shown) {
    const b = s.box;
    assert.ok(b.x >= e && b.y >= e && b.x + b.w <= W - e && b.y + b.h <= H - e, `${what}: ${s.text} inside the frame's margin ${JSON.stringify(b)}`);
    for (const c of covers) assert.ok(!overlaps(b, boxOf(c)), `${what}: ${s.text} on a cover ${JSON.stringify([b, c])}`);
  }
}

test('edgeOf: 2 vmin of the short side, never under two gaps, nothing for no stage', () => {
  assert.equal(EDGE.min, 2 * GAP);
  assert.ok(Math.abs(edgeOf(1368, 912) - 18.24) < 1e-9);
  assert.ok(Math.abs(edgeOf(3840, 2160) - 43.2) < 1e-9);
  assert.equal(edgeOf(400, 300), 12);
  assert.equal(edgeOf(0, 0), 0);
  assert.equal(edgeOf(Infinity, Infinity), 0);
});

test('placeLabels: a name keeps the edge margin; it takes another side, or none', () => {
  const item = (cands) => ({ id: 'a', rank: 0, cands });
  const top = { x: 100, y: 4, w: 60, h: 20 }, below = { x: 100, y: 60, w: 60, h: 20 };
  assert.equal(placeLabels([item([top])], { W: 500, H: 400 }).get('a').at, 0, 'no margin: the edge is the frame');
  assert.equal(placeLabels([item([top, below])], { W: 500, H: 400, edge: 12 }).get('a').at, 1, 'too near the top: below');
  assert.equal(placeLabels([item([top])], { W: 500, H: 400, edge: 12 }).has('a'), false, 'or not named');
  const right = { x: 430, y: 200, w: 60, h: 20 };
  assert.equal(placeLabels([item([right])], { W: 500, H: 400, edge: 12 }).has('a'), false, 'the right edge too');
});

test('cornerCovers: the four arms where the brackets rest, not where they are while closing', () => {
  const c = cornerCovers({ x: 200, y: 100 }, 30, 16);
  assert.deepEqual(c, [
    { x: 170, y: 70, w: 16, h: 16 }, { x: 214, y: 70, w: 16, h: 16 },
    { x: 170, y: 114, w: 16, h: 16 }, { x: 214, y: 114, w: 16, h: 16 },
  ]);
  assert.deepEqual(cornerCovers(null, 30, 16), []);
  assert.deepEqual(cornerCovers({ x: 1, y: 1 }, NaN, 16), []);
});

test('placeLabels: a trouble name may take a sphere\'s place, never a bracket\'s', () => {
  const corner = { x: 100, y: 100, w: 16, h: 16 };
  const it = { id: 't', rank: 0, cands: [{ x: 90, y: 104, w: 60, h: 18 }] };
  const sphere = { x: 90, y: 100, w: 30, h: 30, owner: 'x' };
  assert.equal(placeLabels([it], { W: 500, H: 400, bodies: [sphere] }).has('t'), true, 'over a sphere: trouble wins');
  assert.equal(placeLabels([it], { W: 500, H: 400, covers: [corner] }).has('t'), false, 'over a bracket: not there');
});

test('hud covers: the clock\'s block too, its box read once per minute\'s words', () => {
  let reads = 0;
  const clock = { textContent: '07:05mon 26 oct', get offsetLeft() { reads += 1; return 82; }, offsetTop: 762, offsetWidth: 134, offsetHeight: 80 };
  const frame = { update() {}, live() {}, cover: () => null, el: { clock } };
  const hud = createHud({ caption: { show() {}, hide() {}, cover: () => null }, frame, size: () => ({ W, H }) });
  assert.deepEqual(hud.covers(), [CLOCK]);
  hud.covers(); hud.covers();
  assert.equal(reads, 1, 'not per frame');
  clock.textContent = '07:06mon 26 oct';
  hud.covers();
  assert.equal(reads, 2, 'again when the minute turns');
  assert.equal(createHud({ caption: { cover: () => null }, frame: { el: {} } }).clockCover(), null, 'no clock, no cover');
});

test('large demo at ?at=home: every name inside the margin, off the plate, tag, clock and fleet line', () => {
  const world = worldOf('home');
  const home = world.byId.get('home');
  // The held shot over time, and slid as a flight or a framing pan leaves it: the
  // system then runs to the frame's edges (`HOME` at the top, `kitchen-light` at the right).
  const slid = (shot, [dx, dy, dz]) => ({
    pos: { x: shot.pos.x + dx, y: shot.pos.y + dy, z: shot.pos.z + dz },
    look: { x: shot.look.x + dx, y: shot.look.y + dy, z: shot.look.z + dz },
  });
  const shots = [0, 5000, 10000].map((now) => [`at ${now}`, siteShot(home, now)]);
  for (const d of [[0, 0, 300], [0, 250, 0], [0, -250, 0], [400, 0, 0]]) shots.push([`slid ${d}`, slid(siteShot(home, 0), d)]);
  for (const [what, shot] of shots) {
    const { doc, root } = fakeDoc();
    const labels = createLabels(root, galaxyAt(world, shot), { steps: STEPS, covers: () => FRAME, doc });
    labels.draw();
    clear(labels.shown(), FRAME, `home ${what}`);
  }
});

test('large demo at the overview: every site name inside the margin and off the frame\'s blocks', () => {
  const world = worldOf(null);
  for (const shot of [
    { pos: { x: 0, y: 5200, z: 4200 }, look: { x: 0, y: 0, z: 0 } },
    // Wider: the outer sites near the frame's edge.
    { pos: { x: 0, y: 3000, z: 2600 }, look: { x: 0, y: 0, z: 0 } },
  ]) {
    const { doc, root } = fakeDoc();
    const labels = createLabels(root, galaxyAt(world, shot), { steps: STEPS, covers: () => FRAME, doc });
    labels.draw();
    clear(labels.shown(), FRAME, `overview from ${shot.pos.y}`);
  }
});

test('large demo, a held site (hv1 open, its trouble lane locked): no name on a bracket, the held one outside them', () => {
  const world = worldOf('lab');
  const lab = world.byId.get('lab');
  const id = 'lane:builder-a/feat-search';
  const m = lab.members.find((x) => x.id === id);
  for (const now of [0, 6000, 12000]) {
    const galaxy = galaxyAt(world, siteShot(lab, now));
    const sp = screenOf(galaxy, m.mesh.position);
    const g = lockGeometry3d({ r: 12, side: Math.min(W, H), t: 1 });
    const corners = cornerCovers(sp, g.d, Math.round(g.arm));
    const covers = [...FRAME, ...corners];
    const { doc, root } = fakeDoc();
    const labels = createLabels(root, galaxy, { steps: STEPS, covers: () => covers, held: () => ({ id, r: g.d }), doc });
    labels.draw();
    const shown = labels.shown();
    clear(shown, covers, `hv1 at ${now}`);
    // Nothing with a trouble word is lost to the brackets: the held lane still says its name.
    if (sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H) assert.ok(shown.some((s) => s.id === id), `the held lane named at ${now}`);
  }
});
