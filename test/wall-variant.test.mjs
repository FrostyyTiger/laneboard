// The Wall page ground (Wall plan T4, docs/plans/wall/README.md §7.2): the
// variant switch and demo flag (public/js/wall/variants.js), the frame
// counter the filmstrip reads (perf.js), and the page and sheet keeping the
// app's rules (no inline script, files that exist, colour only from tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickVariant, VARIANTS, DEFAULT_VARIANT } from '../public/js/wall/variants.js';
import { createPerf } from '../public/js/wall/perf.js';
import { violations } from './helpers/css-guardrails.mjs';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('variants: radial is registered and is the default', () => {
  assert.equal(DEFAULT_VARIANT, 'radial');
  assert.ok(VARIANTS.some((v) => v.id === 'radial'));
  const ids = VARIANTS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const v of VARIANTS) assert.match(v.id, /^[a-z][a-z0-9-]*$/);
});

test('variants: ?variant= picks a registered one, with or without ?', () => {
  assert.equal(pickVariant('?variant=radial').id, 'radial');
  assert.equal(pickVariant('variant=RADIAL').id, 'radial', 'case and the leading ? do not matter');
  const reg = [{ id: 'radial' }, { id: 'orbits' }];
  const p = pickVariant(new URLSearchParams('variant=orbits&demo=1'), reg);
  assert.equal(p.id, 'orbits');
  assert.equal(p.variant, reg[1]);
  assert.equal(p.asked, 'orbits');
});

test('variants: unknown or missing falls back to radial and says what was asked', () => {
  for (const s of ['', '?', '?variant=', '?variant=nope', '?variant=__proto__', '?variant=toString', undefined, null]) {
    const p = pickVariant(s);
    assert.equal(p.id, 'radial', `${s} -> radial`);
  }
  assert.equal(pickVariant('?variant=nope').asked, 'nope');
  assert.equal(pickVariant('').asked, null);
  // a registry without radial falls back to its first entry
  assert.equal(pickVariant('?variant=x', [{ id: 'orbits' }]).id, 'orbits');
});

test('variants: the demo flag', () => {
  assert.equal(pickVariant('').demo, false);
  assert.equal(pickVariant('?variant=radial').demo, false);
  for (const s of ['?demo=1', '?demo', '?demo=true', '?variant=radial&demo=1', '?demo=yes']) assert.equal(pickVariant(s).demo, true, s);
  for (const s of ['?demo=0', '?demo=false', '?demo=OFF', '?demo=no']) assert.equal(pickVariant(s).demo, false, s);
});

test('perf: counts frames and the worst gap, a pause drops the gap across it', () => {
  const p = createPerf();
  assert.deepEqual(p.stats, { frames: 0, worstGapMs: 0 });
  p.frame(1000); p.frame(1033); p.frame(1100);
  assert.deepEqual(p.stats, { frames: 3, worstGapMs: 67 });
  p.pause();
  p.frame(9000);
  assert.deepEqual(p.stats, { frames: 4, worstGapMs: 67 }, 'a hidden page is not jank');
  p.frame(9040.4);
  assert.equal(p.stats.worstGapMs, 67);
});

test('wall.html: module script from self only, every local file exists, dark only', () => {
  const html = read('wall.html');
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\ssrc="\/[^"]+"/, 'no inline script (CSP)');
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, 'no inline handler');
  assert.match(html, /<script type="module" src="\/js\/wall\/main\.js">/);
  assert.match(html, /<html[^>]*data-theme="dark"[^>]*class="wall"/);
  const refs = [...html.matchAll(/\s(?:href|src)="(\/[^"#?]*)/g)].map((m) => m[1]);
  assert.ok(refs.includes('/css/wall.css') && refs.includes('/css/tokens.css'));
  for (const r of refs) assert.ok(fs.existsSync(path.join(PUBLIC, r)), `${r} exists`);
  assert.ok(!/href="\/css\/shell\.css"/.test(html), 'not the app shell');
});

test('wall.css: keeps the design guardrails and brightens the four tokens from tokens.css', () => {
  const css = read('css/wall.css');
  assert.deepEqual(violations('wall.css', css), []);
  const block = /html\.wall\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
  for (const t of ['--text-2', '--text-3', '--line-weak', '--line', '--line-strong']) {
    assert.match(block, new RegExp(`${t}:\\s*color-mix\\(in oklch, var\\(--text-1\\)`), `${t} mixed from --text-1`);
  }
  assert.match(block, /--line-weak:[^;]*16%/);
  assert.match(block, /--line:[^;]*30%/);
  assert.match(block, /--line-strong:[^;]*48%/);
});

test('wall.css: the stage ground is plain, no dot texture under a moving camera (T28)', () => {
  const css = read('css/wall.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /--tex-dots|--grid-dot/, 'no dot texture anywhere on the Wall');
  const stage = /\.wall-stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(stage, /background:\s*var\(--bg-canvas\);/);
  assert.match(css, /\.wall \.wall-map\.map\s*\{\s*background:\s*transparent;/, 'the Map\'s own dotted ground stays off');
});

test('the app does not load the Wall', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /wall\.css|js\/wall\//);
});
