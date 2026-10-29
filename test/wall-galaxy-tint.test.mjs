// Colour (Wall plan night 5 A4, T3; the owner's sketch picks `sk_tint=2
// sk_pal=1 sk_sun=1`): each site a quiet warm-set tint in its calm nebula and
// dust, calm text a step lighter on a blue-black ground, a warmer and softer
// sun. One frozen table in palette.js; the status hues stay the loudest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  LOOK, applyLift, lifted, oklchCss, paletteFrom, parseColor, rgbToOklch, tintOf, siteTint, nebulaTint, tintGrain,
  dustTintWeight,
} from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, overviewShot } from '../public/js/wall/galaxy/scene.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

/** tokens.css's dark theme plus wall.css's steps, as the galaxy page sees them before the lift. */
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

const chroma = (rgb) => rgbToOklch(rgb)[1];
const light = (rgb) => rgbToOklch(rgb)[0];
const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

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

function galaxyOf(nodes, palette = paletteFrom(lifted(tokens())), clock = () => 1000) {
  const galaxy = createGalaxyScene({ clientWidth: 1368, clientHeight: 912 }, {
    palette, doc: fakeDoc, clock,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {},
    }),
  });
  galaxy.update({ nodes });
  const shot = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.frame(1000);
  return galaxy;
}

const sameRgb = (c, rgb) => {
  const want = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return Math.abs(c.r - want.r) + Math.abs(c.g - want.g) + Math.abs(c.b - want.b) < 1e-6;
};

test('the tints are the warm set (teal, indigo, plum, sage) and wrap round by place', () => {
  assert.deepEqual(LOOK.tints.map(([h]) => h), [180, 275, 335, 145]);
  assert.ok(Object.isFrozen(LOOK) && Object.isFrozen(LOOK.tints) && Object.isFrozen(LOOK.lift));
  assert.deepEqual(tintOf(0), LOOK.tints[0]);
  assert.deepEqual(tintOf(5), LOOK.tints[1]);
  assert.deepEqual(tintOf(-1), LOOK.tints[3]);
  assert.deepEqual(tintOf(undefined), LOOK.tints[0]);
  // Neighbours differ.
  for (let i = 0; i < 6; i++) assert.notDeepEqual(tintOf(i), tintOf(i + 1));
  // No amber or yellow: nothing near warn's hue (95) or crit's (25).
  for (const [h] of LOOK.tints) assert.ok(Math.abs(h - 95) > 40 && Math.abs(h - 25) > 40, `hue ${h}`);
});

test('every tint, as a nebula and as tinted dust, is quieter in chroma than every status hue', () => {
  const p = paletteFrom(lifted(tokens()));
  const status = ['crit', 'warn', 'low'].map((k) => chroma(p[k]));
  const quietest = Math.min(...status);
  for (let i = 0; i < LOOK.tints.length; i++) {
    for (const [what, rgb] of [
      ['tint', siteTint(i)], ['nebula', nebulaTint(i)],
      ['dust by the sun', tintGrain(p.dustIn, i, 1)], ['dust at the rim', tintGrain(p.dustOut, i, 1)],
    ]) {
      assert.ok(chroma(rgb) < quietest, `${what} ${i}: ${chroma(rgb).toFixed(3)} vs status ${quietest.toFixed(3)}`);
    }
    // A tint is a hue, not a grey.
    assert.ok(chroma(nebulaTint(i)) > 0.05);
  }
  // A grain keeps its brightness within a little when it takes a tint.
  for (let i = 0; i < LOOK.tints.length; i++) {
    assert.ok(Math.abs(lum(tintGrain(p.dustIn, i, 1)) / lum(p.dustIn) - 1) < 0.25);
  }
  assert.equal(dustTintWeight(0), 1);
  assert.ok(dustTintWeight(LOOK.dustReach ** 2 * 9) < 0.001, 'far from a site, the dust stays grey');
});

test('the lift: calm text a step lighter and still under --text-1, the ground a deep blue-black', () => {
  const base = paletteFrom(tokens()), p = paletteFrom(lifted(tokens()));
  const t1 = parseColor('oklch(96% 0.002 250)');
  assert.ok(lum(p.calm) > lum(base.calm), 'text-3 a step lighter');
  assert.ok(lum(p.calm) < lum(p.bright) && lum(p.bright) < lum(t1), 'text-3 < text-2 < text-1');
  assert.ok(lum(p.bright) < lum(p.sun));
  // Stone: barely a hue, warm side.
  for (const k of ['calm', 'bright']) {
    assert.ok(chroma(p[k]) < 0.02, `${k} is quiet (${chroma(p[k]).toFixed(3)})`);
    assert.ok(p[k][0] >= p[k][2], `${k} warm, not blue`);
  }
  // The ground: lighter than the near-black it was, blue, and still far under every node.
  assert.ok(light(p.bg) > light(base.bg));
  assert.ok(p.bg[2] > p.bg[0], 'blue-black');
  assert.ok(chroma(p.bg) < 0.03);
  assert.ok(lum(p.bg) < lum(p.dustOut) && lum(p.dustOut) < lum(p.calm));
  // The status hues are read from their own tokens, untouched by the lift.
  assert.deepEqual([p.crit, p.warn, p.low], [base.crit, base.warn, base.low]);
});

test('applyLift sets the lift tokens one property at a time; lifted() reads them the same way', () => {
  const set = new Map();
  const root = { style: { setProperty: (k, v) => set.set(k, v) } };
  applyLift(root);
  assert.deepEqual([...set.keys()].sort(), ['--bg-canvas', '--text-2', '--text-3']);
  for (const [k, v] of set) assert.equal(lifted(() => '')(k), v);
  assert.equal(set.get('--text-3'), oklchCss(LOOK.lift['--text-3']));
  assert.equal(set.get('--text-3'), 'oklch(76% 0.012 75)');
  assert.equal(lifted(() => 'x')('--p1'), 'x', 'other tokens pass through');
  applyLift(null); // no page, no harm
});

test('the sun: a warm off-white light and a warm stone core, quieter than warn', () => {
  const p = paletteFrom(lifted(tokens()));
  const warn = chroma(p.warn);
  for (const k of ['sunLight', 'sunCore']) {
    assert.ok(chroma(p[k]) < warn / 3, `${k} far from the warn hue's chroma`);
    assert.ok(p[k][0] > p[k][2], `${k} warm`);
  }
  assert.ok(lum(p.sunCore) < lum(p.sunLight));
});

test('the scene: calm nebulae take their site tint, a trouble nebula its status hue, and clearing returns to the tint', () => {
  const p = paletteFrom(lifted(tokens()));
  // The large demo has HV2 in crit and HV1 in warn; cloud (calm) goes crit too, then clears.
  const nodes = LARGE.map((n) => (n.id === 'edge-1' ? { ...n, status: 'crit' } : n));
  let now = 1000;
  const galaxy = galaxyOf(nodes, p, () => now);
  const sites = galaxy.world.sites;
  const cloud = sites.find((s) => s.id === 'cloud');
  for (const id of ['cloud', 'hv2']) {
    const s = sites.find((x) => x.id === id);
    assert.equal(s.nebula.tone, 'crit');
    for (const l of s.lobes) assert.ok(sameRgb(l.mesh.material.color, p.crit), `${id}: the crit nebula in the status hue`);
  }
  const warn = sites.find((s) => s.id === 'lab');
  for (const l of warn.lobes) assert.ok(sameRgb(l.mesh.material.color, p.warn), 'the warn nebula in its hue');
  const calm = sites.filter((s) => s.nebula.tone === 'calm');
  assert.ok(calm.length >= 2);
  for (const s of calm) {
    for (const l of s.lobes) assert.ok(sameRgb(l.mesh.material.color, nebulaTint(s.index)), `${s.id} tinted`);
  }
  assert.ok(new Set(calm.map((s) => s.lobes[0].mesh.material.color.getHex())).size === calm.length, 'sites differ');

  // Trouble clears: the nebula eases back to the site's own tint, not to grey.
  galaxy.update({ nodes: LARGE });
  now += 60_000;
  galaxy.frame(now);
  assert.equal(cloud.nebula.tone, 'calm');
  for (const l of cloud.lobes) assert.ok(sameRgb(l.mesh.material.color, nebulaTint(cloud.index)));
  galaxy.dispose();
});

test('the dust: grains by a site lean to its tint, grains far from every site stay grey', () => {
  const p = paletteFrom(lifted(tokens()));
  let drawn = null;
  const galaxy = createGalaxyScene({ clientWidth: 1368, clientHeight: 912 }, {
    palette: p, doc: fakeDoc, clock: () => 1000,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
      render(scene) { drawn = scene; },
    }),
  });
  galaxy.update({ nodes: LARGE });
  galaxy.frame(1000);
  const dust = drawn.children.find((o) => o.name === 'dust');
  const pos = dust.geometry.attributes.position.array, col = dust.geometry.attributes.color.array;
  const base = dust.userData.base;
  assert.ok(base && base.length === col.length);
  const sites = galaxy.world.sites;
  let near = 0, far = 0;
  for (let i = 0; i < col.length / 3; i++) {
    const x = pos[i * 3], z = pos[i * 3 + 2];
    let best = null, d2 = Infinity;
    for (const s of sites) {
      const d = (s.home.x - x) ** 2 + (s.home.z - z) ** 2;
      if (d < d2) { d2 = d; best = s; }
    }
    const got = [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]], was = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
    const w = dustTintWeight(d2);
    if (w > 0.9 && near < 50) {
      const want = tintGrain(was, best.index, w);
      assert.ok(got.every((v, c) => Math.abs(v - want[c]) < 1e-5), `grain ${i} by ${best.id}`);
      near++;
    } else if (w < 0.02 && far < 50) {
      assert.ok(got.every((v, c) => Math.abs(v / was[c] - 1) < 0.02), `grain ${i} far from every site`);
      far++;
    }
  }
  assert.ok(near >= 20 && far >= 20, `${near} near, ${far} far`);
  galaxy.dispose();
});
