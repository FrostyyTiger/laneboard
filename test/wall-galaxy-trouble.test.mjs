// Trouble inside an open system (Wall plan night 2 T15, reviews/r8-film-ui.md
// 3): a lane or session in warn/crit is drawn at least the size of a calm
// planet, with its status shape facing the camera and its glow, and the dust
// round the held system thins to a fifth so a problem never looks like a
// grain. The scene runs on a fake renderer and clock, as in the live tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteFrom, toneOf } from '../public/js/wall/galaxy/palette.js';
import {
  createGalaxyScene, dustFade, dustFadeRadius, dustSightDist, memberRadius, DUST_FADE, MARK_SHAPE, MOON, SIZE,
} from '../public/js/wall/galaxy/scene.js';
import { LIVE } from '../public/js/wall/galaxy/live.js';

/** Two sites; hv1's builder carries three lanes, statuses by id in `st`. */
function fleet(st = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', status: 'ok' });
  }
  for (const l of ['calm', 'ask', 'jam']) nodes.push({ id: `lane:${l}`, parent: 'hv1-b', kind: 'lane', status: 'working' });
  for (const n of nodes) if (st[n.id]) n.status = st[n.id];
  return { nodes };
}

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

function sceneAt() {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

const member = (galaxy, id) => galaxy.world.byId.get('hv1').members.find((m) => m.id === id);
/** The radius a member is drawn at: its sphere's radius times its scale. */
const drawnR = (m) => m.mesh.geometry.parameters.radius * m.mesh.scale.x;

const BAD = { 'lane:ask': 'attention', 'lane:jam': 'down' };

test('the statuses used here are warn and crit', () => {
  assert.equal(toneOf('attention'), 'warn');
  assert.equal(toneOf('down'), 'crit');
});

test('memberRadius: a planet, or anything in warn/crit, is planet-sized; the rest are dots', () => {
  assert.equal(memberRadius(true, 'calm'), SIZE.planet);
  assert.equal(memberRadius(false, 'calm'), SIZE.dot);
  assert.equal(memberRadius(false, 'low'), SIZE.dot);
  assert.equal(memberRadius(false, 'warn'), SIZE.planet);
  assert.equal(memberRadius(false, 'crit'), SIZE.planet);
});

test('open, a lane in trouble is drawn at least as large as a calm planet, a calm lane is a folded moon (T7)', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet(BAD));
  galaxy.setOpen('hv1', 1);
  at(1000);
  // A planet is drawn by what it carries (night 5 A3): the builder with three lanes at 1.5x;
  // a lane in trouble takes the planet size itself, never smaller.
  const planet = SIZE.planet;
  assert.equal(drawnR(member(galaxy, 'hv1-b')), SIZE.planet * 1.5);
  assert.ok(drawnR(member(galaxy, 'lane:ask')) >= planet, 'warn');
  assert.ok(drawnR(member(galaxy, 'lane:jam')) >= planet, 'crit');
  assert.equal(drawnR(member(galaxy, 'lane:calm')), MOON.calm * MOON.foldK, 'a moon of its builder, folded: half size');
  assert.ok(member(galaxy, 'lane:jam').haloSize > member(galaxy, 'hv1-b').haloSize, 'its glow outshines a calm planet\'s');
});

test('each trouble member carries its shape, shown as the system opens; calm ones carry none', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet(BAD));
  at(1000);
  const ask = member(galaxy, 'lane:ask'), jam = member(galaxy, 'lane:jam'), calm = member(galaxy, 'lane:calm');
  assert.equal(ask.mark.visible, false, 'folded: the nebula carries it');
  galaxy.setOpen('hv1', 1);
  at(1100);
  assert.equal(MARK_SHAPE.warn, 'tri');
  assert.equal(MARK_SHAPE.crit, 'square');
  assert.ok(ask.mark.visible && jam.mark.visible);
  assert.notEqual(ask.mark.material, jam.mark.material, '▲ and ■ differ');
  assert.equal(ask.mark.material.depthTest, false, 'drawn over its own sphere');
  assert.ok(ask.mark.scale.x > 0 && ask.mark.scale.x < 2 * SIZE.planet, 'inside the sphere\'s width');
  assert.equal(calm.mark.visible, false);
});

test('a lane going into trouble grows to the planet size over the recolour, no jump; back to calm it shrinks', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  galaxy.setOpen('hv1', 1);
  at(1000);
  const m = member(galaxy, 'lane:jam');
  const folded = MOON.calm * MOON.foldK; // a calm lane is a folded moon of its builder (T7)
  assert.equal(drawnR(m), folded);
  galaxy.update(fleet({ 'lane:jam': 'down' }));
  at(1000 + LIVE.recolourMs / 2);
  const mid = drawnR(m);
  assert.ok(mid > folded && mid < SIZE.planet, `halfway: ${mid}`);
  at(1000 + LIVE.recolourMs + 10);
  assert.ok(Math.abs(drawnR(m) - SIZE.planet) < 1e-6);
  galaxy.update(fleet());
  at(5000 + LIVE.recolourMs + 10);
  assert.ok(Math.abs(drawnR(m) - folded) < 1e-6);
  assert.equal(m.mark.visible, false);
});

test('dustFade: a fifth inside the held reach, whole outside, fading over the edge, none while folded', () => {
  const reach = 400, r = dustFadeRadius(reach);
  assert.equal(r, reach * DUST_FADE.outer);
  assert.equal(dustFadeRadius(10), DUST_FADE.min, 'a small system still clears room round it');
  assert.ok(Math.abs(dustFade(0, reach) - 0.2) < 1e-9, 'at the star');
  assert.ok(Math.abs(dustFade(reach, reach) - 0.2) < 1e-9, 'at the reach itself');
  assert.equal(dustFade(r + 1, reach), 1, 'outside');
  const edge = dustFade(reach * (DUST_FADE.inner + DUST_FADE.outer) / 2, reach);
  assert.ok(edge > 0.2 && edge < 1, `soft edge: ${edge}`);
  assert.equal(dustFade(0, reach, 0), 1, 'folded: no fade');
  assert.ok(Math.abs(dustFade(0, reach, 0.5) - 0.6) < 1e-9, 'halfway open: halfway faded');
  let prev = 0;
  for (let d = 0; d <= r * 1.2; d += 10) {
    const f = dustFade(d, reach);
    assert.ok(f >= prev, 'never brighter nearer the star');
    prev = f;
  }
});

test('dustSightDist: a grain behind or before the held star on screen counts as on it', () => {
  const cam = { x: 0, y: 0, z: 0 }, star = { x: 0, y: 0, z: -1000 };
  assert.equal(dustSightDist({ x: 0, y: 0, z: -3000 }, star, cam), 0, 'far behind it, on the same line');
  assert.equal(dustSightDist({ x: 0, y: 0, z: -200 }, star, cam), 0, 'between it and the camera');
  assert.ok(Math.abs(dustSightDist({ x: 300, y: 0, z: -1000 }, star, cam) - 300) < 1e-9, 'beside it, at its depth');
  assert.ok(Math.abs(dustSightDist({ x: 600, y: 0, z: -2000 }, star, cam) - 300) < 1e-9, 'twice as far, twice as wide');
  assert.equal(dustSightDist({ x: 0, y: 0, z: 500 }, star, cam), Infinity, 'behind the camera');
});

test('the dust thins round the most open system only, and not at all at the overview', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet(BAD));
  at(1000);
  assert.equal(galaxy.dustHold.k, 0, 'overview');
  galaxy.setOpen('hv2', 0.3);
  galaxy.setOpen('hv1', 1);
  at(1100);
  const h = galaxy.dustHold, hv1 = galaxy.world.byId.get('hv1');
  assert.deepEqual([h.x, h.y, h.z], [hv1.home.x, hv1.home.y, hv1.home.z]);
  assert.equal(h.r, dustFadeRadius(hv1.reach));
  assert.equal(h.k, 1);
});
