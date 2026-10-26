// Wall night 2 T16 (reviews/r8-film-ui.md 2): the sun no longer outshouts
// the trouble. Its core is the text-2 grey at 70 % of its old radius, its
// halo at most half the crit nebula's strength and narrower than it, the
// dust is depth-tested against it, and a held system's shot keeps the hub
// out of the frame.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { NEBULA, paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, overviewShot, siteShot, FOV, SIZE, SUN_HALO } from '../public/js/wall/galaxy/scene.js';
import { zoomedSiteShot } from '../public/js/wall/galaxy/camera.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

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

/** The three.js scene the galaxy draws, caught from a fake renderer. */
function drawnScene() {
  let drawn = null;
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => 1000,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
      render(scene) { drawn = scene; },
    }),
  });
  galaxy.update({ nodes: FLEET });
  // The camera at the overview, as the page puts it (inside the sun its halo fades, T2).
  const shot = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.frame(1000);
  return { galaxy, scene: drawn };
}

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The share of a `w`:`h` frame the disc of radius `r` round the origin covers, seen from `shot` (0 behind). */
function sunShare(shot, aspect, r) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 1, 30000);
  cam.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  cam.lookAt(shot.look.x, shot.look.y, shot.look.z);
  cam.updateMatrixWorld();
  const v = new THREE.Vector3().applyMatrix4(cam.matrixWorldInverse);
  if (v.z > -1) return 0;
  const c = new THREE.Vector3().project(cam);
  const rr = r / (-v.z * Math.tan((FOV * Math.PI) / 360));
  const N = 48;
  let hit = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -1 + (2 * (i + 0.5)) / N, y = -1 + (2 * (j + 0.5)) / N;
      if (Math.hypot((x - c.x) * aspect, y - c.y) < rr) hit++;
    }
  }
  return hit / (N * N);
}

test('the sun core is the text-2 grey, a step under the white light it gives', () => {
  const p = paletteFrom();
  assert.deepEqual(p.sunCore, p.bright);
  assert.ok(lum(p.sunCore) < lum(p.sun));
});

test('the sun is 70 % of the sketch radius, its halo narrower than and at most half as strong as a crit nebula', () => {
  assert.equal(SIZE.sun, 60 * 0.7);
  assert.ok(SUN_HALO <= NEBULA.crit.opacity / 2, `halo ${SUN_HALO} vs crit ${NEBULA.crit.opacity}`);
  assert.ok(SIZE.sunHalo < NEBULA.crit.size);
});

test('the drawn sun uses the core grey and the halo strength; the dust is depth-tested', () => {
  const { galaxy, scene } = drawnScene();
  const p = paletteFrom();
  const core = new THREE.Color().setRGB(...p.sunCore, THREE.SRGBColorSpace);
  const sun = scene.children.find((o) => o.isMesh && o.geometry?.parameters?.radius === SIZE.sun);
  assert.ok(sun, 'a sphere of the sun radius at the origin');
  assert.ok(sun.material.color.equals(core));
  const halo = scene.children.find((o) => o.isSprite && o.scale.x === SIZE.sunHalo);
  assert.ok(halo);
  assert.equal(halo.material.opacity, SUN_HALO);
  assert.ok(halo.material.color.equals(core));
  const points = scene.children.filter((o) => o.isPoints);
  assert.ok(points.length >= 2);
  for (const pts of points) assert.equal(pts.material.depthTest, true);
  assert.equal(galaxy.world.sunRadius, SIZE.sun);
  galaxy.dispose();
});

test('siteShot keeps the hub out of the frame for every site of the large demo, over a long hold and zoomed in', () => {
  const { sites } = galaxyLayout(FLEET);
  // The halo's bright middle: a quarter of its width round the sun.
  const r = SIZE.sunHalo / 4;
  for (const s of sites) {
    for (let t = 0; t <= 6 * 60_000; t += 7_500) {
      for (const zoom of [2.3, 3.5]) {
        for (const aspect of [1.5, 16 / 9]) {
          const share = sunShare(zoomedSiteShot(s, t, zoom), aspect, r);
          assert.ok(share < 0.15, `${s.id} t=${t} zoom ${zoom}: the sun covers ${(share * 100).toFixed(1)} %`);
          assert.equal(share, 0, `${s.id} t=${t}: the sun is out of shot`);
        }
      }
    }
  }
});

test('the held drift still moves with time, and starts slowly', () => {
  const s = { id: 'hv1', home: { x: 900, y: 0, z: 300 }, reach: 300 };
  const a = siteShot(s, 0), b = siteShot(s, 1000), c = siteShot(s, 30_000);
  const d = (p, q) => Math.hypot(p.pos.x - q.pos.x, p.pos.z - q.pos.z);
  assert.ok(d(a, b) > 0 && d(a, b) < 20);
  assert.ok(d(a, c) > d(a, b));
  assert.deepEqual(c.look, s.home);
});

test('T2: a flight that passes near the sun fades its halo, never a frame of grey', () => {
  const { galaxy, scene } = drawnScene();
  const halo = scene.children.find((o) => o.isSprite && o.scale.x === SIZE.sunHalo);
  assert.equal(halo.material.opacity, SUN_HALO, 'at the overview, whole');
  galaxy.camera.position.set(0, 300, 200);
  galaxy.camera.lookAt(0, 0, 0);
  galaxy.frame(1100);
  assert.equal(halo.material.opacity, 0, 'close by, gone');
  galaxy.dispose();
});
