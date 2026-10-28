// Wall night 3 T3 (r59-dreamer 2 = r54-film-ui 11 = r15-dreamer 9): the
// overview looks like a galaxy again. A faint ribbon along each arm's spine
// (layout.js armSpine, where armPoint puts the sites), under the dust, a few
// per cent of the text-3 grey at the fit, gone once a system is open; one
// still shape, its colour from the palette.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_BAND, ARM_RIBBON, armBand, armPoint, armRibbon, armSpine, ribbonEnd, siteSpot } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { BAND, bandOpacity, createGalaxyScene, overviewShot, RIBBON, ribbonOpacity } from '../public/js/wall/galaxy/scene.js';

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

function sceneAt(now = { t: 1000 }, palette = paletteFrom()) {
  let drawn = null;
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette, doc: fakeDoc, clock: () => now.t,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
      render(scene) { drawn = scene; },
    }),
  });
  galaxy.update({ nodes: FLEET });
  const shot = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  return { galaxy, now, drawn: () => drawn };
}

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('the ribbon follows the arms the sites sit on', () => {
  for (let i = 0; i < 8; i++) assert.deepEqual(armPoint(i, 8), armSpine(i % 2, siteSpot(i).t));
  const { positions, shade } = armRibbon(6);
  const perArm = (ARM_RIBBON.steps + 1) * ARM_RIBBON.across;
  // Every site of the large demo lies on its arm's spine, inside the band.
  for (let i = 0; i < 6; i++) {
    const p = armPoint(i, 6), base = (i % 2) * perArm;
    let best = Infinity;
    for (let k = base; k < base + perArm; k++) {
      if (shade[k] < 0.5) continue;
      best = Math.min(best, Math.hypot(positions[k * 3] - p.x, positions[k * 3 + 2] - p.z));
    }
    assert.ok(best < 80, `site ${i}: ${best} from the bright spine`);
  }
  // Flat on the plane; soft at both edges and both ends.
  for (let k = 0; k < shade.length; k++) assert.equal(positions[k * 3 + 1], 0);
  assert.ok(Math.max(...shade) > 0.9 && Math.min(...shade) === 0);
  assert.equal(shade[0], 0, 'fades in from the sun');
  assert.equal(shade[perArm - 1], 0, 'fades out past the last site');
});

test('the ribbon runs past each arm\'s last site, and is the same shape on every load', () => {
  assert.equal(ribbonEnd(0, 6), Math.max(ARM_RIBBON.minTo, 2.6 + ARM_RIBBON.tail));
  assert.ok(ribbonEnd(0, 12) > ribbonEnd(0, 6));
  assert.equal(ribbonEnd(1, 1), ARM_RIBBON.minTo, 'an arm with no site still has a short ribbon');
  assert.deepEqual(armRibbon(6), armRibbon(6));
});

test('the ribbon is in (0.04, 0.06) at the fit and 0 for an open system', () => {
  assert.ok(RIBBON.opacity > 0.04 && RIBBON.opacity < 0.06);
  assert.equal(ribbonOpacity(0), RIBBON.opacity);
  assert.equal(ribbonOpacity(1), 0);
  assert.ok(ribbonOpacity(0.5) < RIBBON.opacity && ribbonOpacity(0.5) > 0);

  const { galaxy, now } = sceneAt();
  galaxy.frame(now.t);
  const r = galaxy.ribbon;
  assert.ok(r.visible);
  assert.ok(r.material.opacity > 0.04 && r.material.opacity < 0.06, `at the fit ${r.material.opacity}`);

  galaxy.setOpen('hv2', 1);
  now.t += 5000;
  galaxy.frame(now.t);
  assert.equal(galaxy.ribbon.material.opacity, 0, 'gone with a system open');
  assert.equal(galaxy.ribbon.visible, false);

  galaxy.setOpen('hv2', 0);
  now.t += 5000;
  galaxy.frame(now.t);
  assert.ok(galaxy.ribbon.material.opacity > 0.04, 'back once it folds');
});

test('the ribbon takes its colour from the palette, never above text-3, under the dust', () => {
  const p = paletteFrom();
  assert.deepEqual(p.arm, p.calm, 'the text-3 grey');
  assert.ok(lum(p.arm) <= lum(paletteFrom().calm) + 1e-9);
  // A token change reaches it.
  const darker = paletteFrom((name) => (name === '--text-3' ? 'oklch(50% 0 0)' : ''));
  const { galaxy, now, drawn } = sceneAt({ t: 1000 }, darker);
  galaxy.frame(now.t);
  const c = galaxy.ribbon.material.color.clone().convertLinearToSRGB();
  darker.arm.forEach((v, i) => assert.ok(Math.abs([c.r, c.g, c.b][i] - v) < 1e-3));
  const dust = drawn().getObjectByName('dust');
  assert.ok(galaxy.ribbon.renderOrder < dust.renderOrder, 'drawn before the dust');
  assert.equal(galaxy.ribbon.material.depthWrite, false);
  // No motion: a later frame leaves it where it was.
  const before = galaxy.ribbon.geometry.attributes.position.array.slice();
  galaxy.frame(now.t + 60_000);
  assert.deepEqual(galaxy.ribbon.geometry.attributes.position.array, before);
  assert.equal(galaxy.ribbon.rotation.y, 0);
});

// T19 (r11-dreamer galaxy 2): the ribbon could not be seen, a haze 340-700
// wide. Narrower, plus a tighter band at 8-10 % round each site only, and a
// vignette without the knee that drew rings.
test('T19: the ribbon is narrow: no point of it is more than 170 from its spine', () => {
  const { positions } = armRibbon(12);
  const { steps, across } = ARM_RIBBON;
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i <= steps; i++) {
      const row = (arm * (steps + 1) + i) * across;
      const mid = row + (across - 1) / 2;
      for (const k of [row, row + across - 1]) {
        const d = Math.hypot(positions[k * 3] - positions[mid * 3], positions[k * 3 + 2] - positions[mid * 3 + 2]);
        assert.ok(d <= 170 + 1e-3, `arm ${arm} row ${i}: half width ${d}`);
      }
    }
  }
  assert.ok(ARM_RIBBON.half < 170 && ARM_RIBBON.maxHalf <= 170);
});

test('T19: a band at 8-10 % lies on the spine round each site, and only there', () => {
  assert.ok(BAND.opacity > 0.08 && BAND.opacity < 0.10);
  assert.ok(BAND.opacity > RIBBON.opacity, 'brighter than the ribbon');
  assert.equal(bandOpacity(0), BAND.opacity);
  assert.equal(bandOpacity(1), 0);
  const n = 6, { positions, shade } = armBand(n);
  const per = (ARM_BAND.steps + 1) * ARM_BAND.across;
  assert.equal(shade.length, n * per);
  assert.ok(ARM_BAND.half < ARM_RIBBON.half, 'tighter than the ribbon');
  for (let i = 0; i < n; i++) {
    const p = armPoint(i, n);
    let peak = 0, far = 0;
    for (let k = i * per; k < (i + 1) * per; k++) {
      const d = Math.hypot(positions[k * 3] - p.x, positions[k * 3 + 2] - p.z);
      if (d < 40) peak = Math.max(peak, shade[k]);
      far = Math.max(far, d);
      assert.equal(positions[k * 3 + 1], 0);
    }
    assert.ok(peak > 0.9, `site ${i}: bright at the site (${peak})`);
    // Only near the site: it stops well short of the next site on its arm.
    const next = armPoint(i + 2, n + 2);
    assert.ok(far < 0.6 * Math.hypot(next.x - p.x, next.z - p.z), `site ${i}: reaches ${far}`);
  }
  assert.equal(armBand(0).shade.length, 0);
});

test('T19: the bands are in the scene, fade with the ribbon, in the ribbon\'s grey, under the dust', () => {
  const { galaxy, now, drawn } = sceneAt();
  galaxy.frame(now.t);
  const b = galaxy.band;
  assert.ok(b.visible);
  assert.ok(b.material.opacity > 0.08 && b.material.opacity < 0.10, `at the fit ${b.material.opacity}`);
  assert.ok(galaxy.band.material.color.equals(galaxy.ribbon.material.color), 'text-3 grey, as the ribbon');
  assert.ok(b.renderOrder < drawn().getObjectByName('dust').renderOrder);
  assert.equal(b.material.depthWrite, false);
  const sites = galaxy.world.sites.filter((s) => !s.gone).length;
  assert.equal(b.geometry.attributes.color.count, sites * (ARM_BAND.steps + 1) * ARM_BAND.across);
  galaxy.setOpen('hv2', 1);
  now.t += 5000;
  galaxy.frame(now.t);
  assert.equal(galaxy.band.material.opacity, 0, 'gone with a system open');
  assert.equal(galaxy.band.visible, false);
});

test('T19: the vignette ramps have no hard knee (smoothstep in short stops)', () => {
  const css = fs.readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');
  const v = /--tex-vignette:([^;]+);/.exec(css)[1];
  for (const ramp of v.split(/(?=radial-gradient|linear-gradient)/).filter((r) => /gradient/.test(r))) {
    const alphas = [...ramp.matchAll(/var\(--bg-canvas\) ([\d.]+)%/g)].map((m) => +m[1]);
    assert.ok(alphas.length >= 8, `${alphas.length} stops`);
    // No jump between two stops bigger than a fifth of the whole ramp.
    const span = Math.max(...alphas);
    for (let i = 1; i < alphas.length; i++) assert.ok(Math.abs(alphas[i] - alphas[i - 1]) <= span / 5, `${alphas}`);
    // Eased at the soft end: the first step off zero is small.
    assert.ok(Math.min(...alphas) <= 0.05 * span);
  }
});
