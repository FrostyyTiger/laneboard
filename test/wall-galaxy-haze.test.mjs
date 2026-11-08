// Depth haze (Wall plan night 5 A5, T4; the owner's sketch pick `sk_haze=1`):
// a linear fog from 0.6x to 2.6x of the look-at distance, on calm things only.
// Status-hued materials and trouble nebulae are never fogged, so trouble is as
// loud on the far side of the galaxy as on the near one (README §2.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../public/vendor/three/three.module.js';
import { lifted, paletteFrom, toneOf } from '../public/js/wall/galaxy/palette.js';
import {
  HAZE, createGalaxyScene, hazeRange, hazed, overviewShot, siteShot,
} from '../public/js/wall/galaxy/scene.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

function tokens() {
  const vars = {};
  const grab = (file, selector) => {
    const css = fs.readFileSync(path.join(PUBLIC, 'css', file), 'utf8');
    const block = css.slice(css.indexOf(selector));
    const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  };
  grab('tokens.css', '[data-theme="dark"] {');
  grab('wall.css', 'html.wall {');
  return (name) => vars[name] ?? '';
}

const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    }),
  }),
};

/** A galaxy of `nodes` with the large demo's lifted palette; `drawn()` is the scene as last rendered. */
function galaxyOf(nodes, clock = () => 1000, fx = null) {
  let scene = null;
  const galaxy = createGalaxyScene({ clientWidth: 1368, clientHeight: 912 }, {
    palette: paletteFrom(lifted(tokens())), doc: fakeDoc, clock, fx,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
      render(s) { scene = s; },
    }),
  });
  galaxy.update({ nodes });
  return { galaxy, drawn: () => scene };
}

/** Puts the camera at `shot` (`{ pos, look }`) and draws one frame. */
function shoot(galaxy, shot, now = 1000) {
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  galaxy.frame(now);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** How much of the ground colour three's linear fog mixes in at `d` (0 clear, 1 gone). */
const fogged = (fog, d) => Math.min(1, Math.max(0, (d - fog.near) / (fog.far - fog.near)));

test('the haze runs from 0.6x to 2.6x of the look-at distance, the owner\'s sketch pick', () => {
  assert.deepEqual({ near: HAZE.near, far: HAZE.far }, { near: 0.6, far: 2.6 });
  assert.ok(Object.isFrozen(HAZE));
  // Looking down at a point on the plane: the distance to it.
  const pos = { x: 300, y: 800, z: 600 };
  const look = new THREE.Vector3(-300, 0, -200);
  const dir = look.clone().sub(new THREE.Vector3(pos.x, pos.y, pos.z)).normalize();
  const r = hazeRange(pos, dir);
  const d = Math.hypot(600, 800, 800);
  assert.ok(Math.abs(r.d - d) < 1e-6);
  assert.ok(Math.abs(r.near - 0.6 * d) < 1e-6 && Math.abs(r.far - 2.6 * d) < 1e-6);
  // Looking up or along the plane: the distance to the sun.
  assert.ok(Math.abs(hazeRange(pos, { x: 0, y: 1, z: 0 }).d - Math.hypot(300, 800, 600)) < 1e-6);
  assert.ok(Math.abs(hazeRange(pos, { x: 1, y: 0, z: 0 }).d - Math.hypot(300, 800, 600)) < 1e-6);
  // Close in, never under the floor: the planet in front of the camera stays clear.
  assert.equal(hazeRange({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }).d, HAZE.min);
  assert.equal(hazed('calm'), true);
  for (const t of ['warn', 'crit', 'low']) assert.equal(hazed(t), false, t);
});

test('the scene\'s fog is linear in the ground colour and follows the camera from the overview to a held system', () => {
  const { galaxy, drawn } = galaxyOf(LARGE);
  const sites = galaxy.world.sites;
  const over = overviewShot(sites);
  shoot(galaxy, over);
  const fog = drawn().fog;
  assert.ok(fog instanceof THREE.Fog && !(fog instanceof THREE.FogExp2), 'linear fog');
  assert.equal(galaxy.haze, fog);
  const d0 = dist(over.pos, over.look);
  assert.ok(Math.abs(fog.near - 0.6 * d0) < 1e-3 && Math.abs(fog.far - 2.6 * d0) < 1e-3, `overview ${fog.near}..${fog.far}`);
  // The far side of the galaxy fades: the farthest star is past the haze's start.
  const far = Math.max(...sites.map((s) => dist(over.pos, s.home)));
  assert.ok(far > fog.near, 'the far side is in the haze');

  const hv2 = sites.find((s) => s.id === 'hv2');
  const held = siteShot(hv2, 0);
  shoot(galaxy, held, 2000);
  const d1 = dist(held.pos, held.look);
  assert.ok(d1 < d0 / 2, 'a held system is looked at from closer');
  assert.ok(Math.abs(fog.near - 0.6 * d1) < 1e-3 && Math.abs(fog.far - 2.6 * d1) < 1e-3, `held ${fog.near}..${fog.far}`);
  // What the camera looks at keeps 80 % of itself; the near side of the system less hazed
  // still; the far side of the galaxy sinks into the ground.
  assert.ok(Math.abs(fogged(fog, d1) - 0.2) < 1e-9);
  const reach = dist(held.pos, hv2.home) - hv2.reach;
  assert.ok(fogged(fog, reach) < 0.2, 'the near side of the held system is clearer than its star');
  const farthest = Math.max(...sites.map((s) => dist(held.pos, s.home)));
  assert.ok(fogged(fog, farthest) > 0.5, `the farthest site ${fogged(fog, farthest).toFixed(2)} hazed`);
  galaxy.dispose();
});

test('status hues are never fogged: trouble bodies, halos, marks, trouble nebulae and lanes; calm bodies, nebulae and dust are', () => {
  // The large demo: HV2 crit, HV1 (lab) warn; the rest calm.
  const { galaxy, drawn } = galaxyOf(LARGE);
  shoot(galaxy, overviewShot(galaxy.world.sites));
  const sites = galaxy.world.sites;
  let trouble = 0, calm = 0;
  for (const s of sites) {
    const t = s.nebula.tone;
    for (const l of s.lobes) assert.equal(l.mesh.material.fog, t === 'calm', `${s.id} nebula (${t})`);
    assert.equal(s.lane.material.fog, t === 'calm', `${s.id} lane (${t})`);
    for (const m of s.members) {
      const want = m.tone === 'calm';
      assert.equal(m.mesh.material.fog, want, `${m.id} body (${m.tone})`);
      assert.equal(m.halo.material.fog, want, `${m.id} halo (${m.tone})`);
      assert.equal(m.mark.material.fog, false, `${m.id} mark`);
      if (want) calm++; else trouble++;
    }
    assert.equal(s.star.material.fog, hazed(toneOf(s.node)), `${s.id} star (${toneOf(s.node)})`);
    assert.equal(s.starHalo.material.fog, hazed(toneOf(s.node)), `${s.id} star halo`);
  }
  assert.ok(trouble >= 2 && calm >= 20, `${trouble} trouble, ${calm} calm members`);
  assert.ok(sites.some((s) => s.nebula.tone === 'crit') && sites.some((s) => s.nebula.tone === 'calm'));
  const dust = drawn().children.find((o) => o.name === 'dust');
  assert.equal(dust.material.fog, true, 'the dust fogs');
  assert.equal(galaxy.sun.core.material.fog, false, 'the sun (freshness) is never fogged');
  assert.equal(galaxy.sun.halo.material.fog, false);
  galaxy.dispose();
});

test('a nebula fogs again when its trouble clears, and stops fogging when trouble comes', () => {
  let now = 1000;
  const nodes = LARGE.map((n) => (n.id === 'edge-1' ? { ...n, status: 'crit' } : n));
  const { galaxy } = galaxyOf(nodes, () => now);
  shoot(galaxy, overviewShot(galaxy.world.sites), now);
  const cloud = galaxy.world.sites.find((s) => s.id === 'cloud');
  assert.equal(cloud.nebula.tone, 'crit');
  for (const l of cloud.lobes) assert.equal(l.mesh.material.fog, false);
  assert.equal(cloud.lane.material.fog, false);
  const v = cloud.lobes[0].mesh.material.version;
  galaxy.update({ nodes: LARGE });
  now += 60_000;
  galaxy.frame(now);
  assert.equal(cloud.nebula.tone, 'calm');
  for (const l of cloud.lobes) assert.equal(l.mesh.material.fog, true);
  assert.equal(cloud.lane.material.fog, true);
  assert.ok(cloud.lobes[0].mesh.material.version > v, 'the program is rebuilt for the change');
  // Recolouring at the same tone leaves the program alone.
  const v2 = cloud.lobes[0].mesh.material.version;
  galaxy.update({ nodes: LARGE.map((n) => (n.id === 'edge-1' ? { ...n, status: 'idle' } : n)) });
  galaxy.frame(now + 1000);
  assert.equal(cloud.lobes[0].mesh.material.version, v2);
  galaxy.dispose();
});

test('the beacon and afterglow fx (status hues) are never fogged', () => {
  const { galaxy, drawn } = galaxyOf(LARGE, () => 1000, new Set(['beacon', 'afterglow']));
  shoot(galaxy, overviewShot(galaxy.world.sites));
  const named = (prefix) => drawn().children.filter((o) => o.name.startsWith(prefix));
  for (const prefix of ['fx-beacon', 'fx-afterglow']) {
    const objs = named(prefix);
    assert.ok(objs.length > 0, prefix);
    for (const o of objs) assert.equal(o.material.fog, false, o.name);
  }
  galaxy.dispose();
});
