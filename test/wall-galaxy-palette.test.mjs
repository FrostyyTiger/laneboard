// The galaxy's colours and nebulae (Wall plan night 2 T3): the tokens read
// into numbers WebGL can use, and a site's worst status to its nebula.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  paletteFrom, parseColor, oklchToRgb, toneOf, nebulaFor, worseTone, NEBULA, TONES, DUST_INK,
} from '../public/js/wall/galaxy/palette.js';
import { sceneKey, overviewShot, siteShot } from '../public/js/wall/galaxy/scene.js';
import { tourSites } from '../public/js/wall/tour.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const near = (a, b, eps = 0.01) => a.every((x, i) => Math.abs(x - b[i]) <= eps);
const byte = (c) => c.slice(0, 3).map((x) => Math.round(x * 255));

/** The custom properties of tokens.css's dark theme plus wall.css's steps, as the page sees them. */
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

test('parseColor reads the syntaxes the tokens use', () => {
  assert.deepEqual(parseColor('#ff8000'), [1, 128 / 255, 0, 1]);
  assert.deepEqual(parseColor('#fff'), [1, 1, 1, 1]);
  assert.deepEqual(parseColor('rgb(255 0 0 / 0.5)'), [1, 0, 0, 0.5]);
  assert.deepEqual(parseColor('rgba(0, 255, 0, 1)'), [0, 1, 0, 1]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.ok(near(parseColor('oklch(100% 0 0)'), [1, 1, 1, 1]));
  assert.ok(near(parseColor('oklch(0% 0 0)'), [0, 0, 0, 1]));
  assert.equal(parseColor('oklch(100% 0 0 / 0.32)')[3], 0.32);
  assert.equal(parseColor('nonsense'), null);
  assert.equal(parseColor(''), null);
});

test('oklch to sRGB lands on known colours', () => {
  // CSS Color 4's reference: oklch(62.8% 0.2577 29.23) is #ff0000, oklch(86.6% 0.2948 142.5) is #00ff00.
  assert.deepEqual(byte(oklchToRgb(0.628, 0.2577, 29.23)), [255, 0, 0]);
  assert.deepEqual(byte(oklchToRgb(0.866, 0.2948, 142.5)), [0, 255, 0]);
  // A grey stays grey.
  const g = oklchToRgb(0.62, 0, 0);
  assert.ok(Math.abs(g[0] - g[1]) < 1e-9 && Math.abs(g[1] - g[2]) < 1e-9);
});

test('color-mix(in oklch) mixes, and mixing with transparent keeps the colour and scales alpha', () => {
  const vars = (n) => ({ '--a': 'oklch(96% 0 0)', '--b': 'oklch(12% 0 0)' })[n] ?? '';
  const half = parseColor('color-mix(in oklch, var(--a) 50%, var(--b))', vars);
  assert.ok(near(half, parseColor('oklch(54% 0 0)')));
  const thin = parseColor('color-mix(in oklch, var(--a) 30%, transparent)', vars);
  assert.ok(near(thin.slice(0, 3), parseColor('oklch(96% 0 0)').slice(0, 3)));
  assert.ok(Math.abs(thin[3] - 0.3) < 1e-9);
});

test('paletteFrom: the status hues from --p1/--p2/--p3, everything calm in greys', () => {
  const read = tokens();
  const p = paletteFrom(read);
  assert.deepEqual(p.crit, parseColor(read('--p1')).slice(0, 3));
  assert.deepEqual(p.warn, parseColor(read('--p2')).slice(0, 3));
  assert.deepEqual(p.low, parseColor(read('--p3')).slice(0, 3));
  // crit is red, warn yellow, low blue.
  assert.ok(p.crit[0] > 0.8 && p.crit[1] < 0.3);
  assert.ok(p.warn[0] > 0.8 && p.warn[1] > 0.6 && p.warn[2] < 0.4);
  assert.ok(p.low[2] > p.low[0]);
  // Grey unless something needs you: calm, the sun, the dust, the stars carry no hue.
  for (const k of ['calm', 'bright', 'sun', 'bg', 'dustIn', 'dustOut', 'stars']) {
    const c = p[k];
    assert.ok(Math.max(...c) - Math.min(...c) < 0.02, `${k} is a grey (${byte(c)})`);
  }
  // The Wall's brighter text-3 (wall.css color-mix) is the calm grey, brighter than the app's.
  assert.ok(p.calm[0] > parseColor('oklch(62% 0.004 250)')[0]);
  // The dust fades from the light grey by the sun to darker at the rim; the ground is darkest.
  assert.ok(p.dustIn[0] > p.dustOut[0] && p.dustOut[0] > p.bg[0]);
  assert.ok(p.line.alpha > 0 && p.line.alpha < 1);
});

test('the dust is darker than any node mark, by the sun and at the rim (T26)', () => {
  // Relative luminance (WCAG), the eye's measure of how bright a grey reads.
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  for (const p of [paletteFrom(tokens()), paletteFrom(() => '')]) {
    // The node marks: calm (text-3), the brighter grey and the status hues (crit is
    // the dimmest of them today, T33); the dust stays below whichever is lowest.
    const dimmest = Math.min(...['calm', 'bright', 'low', 'warn', 'crit'].map((k) => lum(p[k])));
    assert.ok(lum(p.dustIn) < dimmest, `dust by the sun ${byte(p.dustIn)} below every node colour`);
    assert.ok(lum(p.dustOut) < lum(p.dustIn) && lum(p.dustOut) > lum(p.bg), 'darker at the rim, still above the ground');
    // Not a hair below: a clear step, so a grain does not pass for a dim node.
    assert.ok(lum(p.dustIn) < dimmest * 0.75);
  }
  assert.ok(DUST_INK.in > 0 && DUST_INK.in < DUST_INK.out && DUST_INK.out < 1);
});

test('paletteFrom falls back to the dark tokens when nothing is set', () => {
  const p = paletteFrom(() => '');
  for (const k of ['crit', 'warn', 'low', 'calm', 'sun', 'bg']) {
    assert.equal(p[k].length, 3);
    assert.ok(p[k].every((x) => x >= 0 && x <= 1), k);
  }
  assert.ok(p.crit[0] > 0.8);
});

test('toneOf follows the Map: crit/down crit, warn/attention/stuck warn, low low, the rest calm', () => {
  assert.equal(toneOf('crit'), 'crit');
  assert.equal(toneOf('down'), 'crit');
  assert.equal(toneOf('warn'), 'warn');
  assert.equal(toneOf('attention'), 'warn');
  assert.equal(toneOf({ status: 'ok', flags: { stuck: true } }), 'warn');
  assert.equal(toneOf('low'), 'low');
  for (const s of ['ok', 'idle', 'working', 'unknown', undefined]) assert.equal(toneOf(s), 'calm', String(s));
  assert.equal(worseTone('calm', 'crit'), 'crit');
  assert.equal(worseTone('warn', 'low'), 'warn');
});

test('the nebula takes the site worst status; trouble is louder and bigger, only crit breathes', () => {
  assert.equal(nebulaFor('crit').tone, 'crit');
  assert.equal(nebulaFor('down').tone, 'crit');
  assert.equal(nebulaFor('attention').tone, 'warn');
  assert.equal(nebulaFor('low').tone, 'low');
  assert.equal(nebulaFor('ok').tone, 'calm');
  for (let i = 1; i < TONES.length; i++) {
    const a = NEBULA[TONES[i - 1]], b = NEBULA[TONES[i]];
    assert.ok(b.opacity > a.opacity, `${TONES[i]} louder than ${TONES[i - 1]}`);
    assert.ok(b.size >= a.size);
  }
  assert.deepEqual(TONES.filter((t) => NEBULA[t].breathes), ['crit']);
  // Nebulae never meet: the layout keeps stars MIN_SITE_GAP (448 since night 5) apart.
  assert.ok(Math.max(...TONES.map((t) => NEBULA[t].size)) <= 448);
});

test('a site nebula comes from its subtree: a crit room under a calm site makes it red', () => {
  const nodes = [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', kind: 'site', parent: '__core', status: 'ok' },
    { id: 'builder-a', kind: 'room', parent: 'hv1', status: 'crit' },
    { id: 'cloud', kind: 'site', parent: '__core', status: 'ok' },
    { id: 'db', kind: 'room', parent: 'cloud', status: 'attention' },
    { id: 'home', kind: 'site', parent: '__core', status: 'ok' },
    { id: '__repos', kind: 'site', parent: '__core', status: 'ok' },
  ];
  const neb = new Map(tourSites(nodes).map((s) => [s.id, nebulaFor(s.status).tone]));
  assert.equal(neb.get('hv1'), 'crit');
  assert.equal(neb.get('cloud'), 'warn');
  assert.equal(neb.get('home'), 'calm');
  // The calm repo index is no place: no cluster for it.
  assert.equal(neb.has('__repos'), false);
});

test('sceneKey changes with a tone or the tree, not with a metric', () => {
  const a = [{ id: 'x', kind: 'room', parent: 'hv1', status: 'ok', metrics: { cpu: 0.1 } }];
  const b = [{ ...a[0], metrics: { cpu: 0.9 } }];
  const c = [{ ...a[0], status: 'crit' }];
  const d = [{ ...a[0], parent: 'cloud' }];
  assert.equal(sceneKey(a), sceneKey(b));
  assert.notEqual(sceneKey(a), sceneKey(c));
  assert.notEqual(sceneKey(a), sceneKey(d));
});

test('the overview shot looks at the sun from above, the site shot at its star', () => {
  const sites = [{ id: 'hv1', home: { x: 1000, y: 0, z: 0 }, reach: 300 }, { id: 'cloud', home: { x: -1500, y: 40, z: 800 }, reach: 200 }];
  const o = overviewShot(sites);
  assert.deepEqual(o.look, { x: 0, y: 0, z: 0 });
  assert.ok(o.pos.y > 0 && Math.hypot(o.pos.x, o.pos.z) > 0);
  const s = siteShot(sites[1], 0);
  assert.deepEqual(s.look, sites[1].home);
  assert.ok(s.pos.y > sites[1].home.y);
});
