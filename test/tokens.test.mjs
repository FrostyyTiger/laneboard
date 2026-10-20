// public/css/tokens.css (fleet plan §4 2.2, task D1): every token exists in
// both themes, text and status hues keep contrast against the canvas, the old
// token names the legacy sheets and the map read still resolve, and the
// vendored fonts are wired up and served as font/woff2.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './helpers/boot.mjs';
import { contrast, luminance, oklch, oklchToLinearSrgb } from './helpers/oklch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(PUBLIC, 'vendor', 'fonts');
const CSS = fs.readFileSync(path.join(PUBLIC, 'css', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// --- a tiny CSS reader: top-level and @media rules as {prelude, body, media} --

function rules(css, media = null, out = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (/^@media/.test(prelude)) rules(body, prelude, out);
    else out.push({ prelude: prelude.replace(/\s+/g, ' '), body, media });
    i = j;
  }
  return out;
}

function decls(body) {
  const out = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return out;
}

const RULES = rules(CSS);
const block = (prelude) => {
  const r = RULES.find((x) => x.prelude === prelude && !x.media);
  assert.ok(r, `tokens.css has a top-level "${prelude}" block`);
  return decls(r.body);
};
const ROOT_T = block(':root');
const DARK = block(':root, [data-theme="dark"]');
const LIGHT = block('[data-theme="light"]');
const DERIVED = block(':root, [data-theme]');

/** Resolve a token in a theme the way the cascade would on <html data-theme>. */
function resolve(name, theme, seen = new Set()) {
  assert.ok(!seen.has(name), `var() cycle through ${name}`);
  seen.add(name);
  const own = theme === 'light' ? LIGHT : DARK;
  const v = own.get(name) ?? DERIVED.get(name) ?? ROOT_T.get(name);
  assert.ok(v != null, `${name} is defined for the ${theme} theme`);
  return v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(n, theme, new Set(seen)));
}

// --- the token list of §2.2 -------------------------------------------------

const THEMED = [
  '--bg-canvas', '--bg-surface', '--bg-elevated', '--bg-sunken', '--bg-hover', '--bg-selected',
  '--line-weak', '--line', '--line-strong',
  '--text-1', '--text-2', '--text-3', '--text-inv',
  '--accent', '--accent-weak',
  '--p1', '--p2', '--p3', '--ok',
  '--p1-weak', '--p2-weak', '--p3-weak', '--p1-line', '--p2-line', '--p3-line',
];
const INVARIANT = [
  '--font-mono', '--font-label', '--font-ui', '--ls-label',
  '--fs-10', '--fs-11', '--fs-12', '--fs-13', '--fs-16', '--fs-20', '--fs-28', '--lh-tight', '--lh',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-6', '--sp-8',
  '--row-dense', '--row-comfy', '--row-touch', '--row-h',
  '--header-h', '--rail-w-min', '--rail-w', '--insp-w', '--tape-h', '--tape-h-open',
  '--icon-s', '--icon-m', '--icon-l', '--lamp',
  '--z-rail', '--z-insp', '--z-tape', '--z-sheet', '--z-palette', '--z-toast', '--z-dialog',
  '--radius', '--bw', '--dur', '--ease',
];
const DERIVED_T = ['--run', '--off', '--tex-dots', '--tex-hatch', '--bracket-img'];
/** Names the legacy sheets (public/css/**) and the map's readPalette still use. */
const OLD = [
  '--crit', '--warn', '--info', '--idle', '--border-weak', '--border', '--border-strong',
  '--accent-dim', '--glass-fill', '--glass-fill-strong', '--shadow-float', '--highlight-inset',
  '--radius-s', '--radius-m', '--radius-l', '--radius-pill', '--dur-fast', '--gap',
];

test('every themed token is defined in both the dark and the light block, and nothing else is', () => {
  assert.deepEqual([...DARK.keys()].sort(), [...THEMED].sort(), 'dark block');
  assert.deepEqual([...LIGHT.keys()].sort(), [...THEMED].sort(), 'light block');
  for (const t of THEMED) assert.notEqual(DARK.get(t), LIGHT.get(t), `${t} differs between themes`);
});

test('every invariant, derived and old token resolves in both themes', () => {
  for (const theme of ['dark', 'light']) {
    for (const t of [...THEMED, ...INVARIANT, ...DERIVED_T, ...OLD]) {
      assert.ok(resolve(t, theme).length > 0, `${t} (${theme})`);
    }
  }
  for (const t of INVARIANT) assert.ok(ROOT_T.has(t), `${t} sits on :root`);
});

test('the scale values are the plan’s', () => {
  const want = {
    '--fs-10': '10px', '--fs-11': '11px', '--fs-12': '12px', '--fs-13': '13px', '--fs-16': '16px',
    '--fs-20': '20px', '--fs-28': '28px', '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px',
    '--sp-4': '16px', '--sp-6': '24px', '--sp-8': '32px', '--row-dense': '28px', '--row-comfy': '36px',
    '--row-touch': '44px', '--radius': '2px', '--bw': '1px', '--dur': '120ms', '--ls-label': '0.06em',
    '--header-h': '40px', '--rail-w': '220px', '--insp-w': '360px', '--lamp': '8px',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(ROOT_T.get(k), v, k);
  assert.match(ROOT_T.get('--font-mono'), /^"JetBrains Mono", .*monospace$/);
  assert.match(ROOT_T.get('--font-label'), /^"Barlow Condensed", .*sans-serif$/);
  assert.equal(ROOT_T.get('--font-ui'), 'var(--font-label)');
});

test('old names map onto the new tokens', () => {
  const want = {
    '--crit': 'var(--p1)', '--warn': 'var(--p2)', '--info': 'var(--p3)', '--idle': 'var(--off)',
    '--border-weak': 'var(--line-weak)', '--border': 'var(--line)', '--border-strong': 'var(--line-strong)',
    '--run': 'var(--text-2)', '--off': 'var(--text-3)',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(DERIVED.get(k), v, k);
  // No glass and no shadow survive behind the old names.
  for (const t of ['--glass-fill', '--glass-fill-strong']) assert.equal(resolve(t, 'dark'), resolve('--bg-elevated', 'dark'));
  for (const t of ['--shadow-float', '--highlight-inset']) assert.equal(ROOT_T.get(t), 'none');
});

test('textures use hard stops only', () => {
  assert.match(DERIVED.get('--tex-dots'), /^radial-gradient\(circle, var\(--line\) 0\.75px, transparent 1px\) 0 0 \/ 16px 16px$/);
  assert.match(DERIVED.get('--tex-hatch'), /^repeating-linear-gradient\(45deg, var\(--line\) 0 1px, transparent 1px 6px\)$/);
  const layers = DERIVED.get('--bracket-img').split(/,\s*(?=linear-gradient)/);
  assert.equal(layers.length, 8, 'four corners, two bars each');
  for (const l of layers) assert.match(l, /^linear-gradient\(var\(--accent\) 0 0\) (left|right) (top|bottom) \/ (8px 2px|2px 8px) no-repeat$/);
});

test('density, the one keyframe and reduced motion', () => {
  assert.ok(RULES.some((r) => r.media === '@media (max-width: 1199px)' && decls(r.body).get('--row-h') === 'var(--row-comfy)'));
  assert.ok(RULES.some((r) => r.media === '@media (pointer: coarse)' && decls(r.body).get('--row-h') === 'var(--row-touch)'));
  assert.ok(RULES.some((r) => r.prelude === ':root[data-density="dense"]'));
  assert.ok(RULES.some((r) => r.prelude === ':root[data-density="comfy"]'));
  assert.match(CSS, /@keyframes lb-flash\s*\{\s*0%, 49%\s*\{\s*opacity: 1;\s*\}\s*50%, 100%\s*\{\s*opacity: \.35;\s*\}\s*\}/);
  const rm = RULES.filter((r) => r.media === '@media (prefers-reduced-motion: reduce)');
  assert.ok(rm.some((r) => decls(r.body).get('--dur') === '0ms'));
  const unack = rm.find((r) => r.prelude === '[data-unack]');
  assert.ok(unack, 'reduced motion swaps the flash for a dashed outline');
  assert.match(unack.body, /animation:\s*none/);
  assert.match(unack.body, /outline:\s*1px dashed currentColor/);
});

// --- contrast: OKLCH -> linear sRGB -> WCAG relative luminance ----------------

test('the converter agrees with known points', () => {
  assert.ok(Math.abs(luminance({ L: 1, C: 0, H: 0 }) - 1) < 1e-3, 'white');
  assert.equal(luminance({ L: 0, C: 0, H: 0 }), 0, 'black');
  assert.ok(Math.abs(contrast({ L: 1, C: 0, H: 0 }, { L: 0, C: 0, H: 0 }) - 21) < 0.05, 'white on black is 21:1');
  // sRGB red #ff0000 is oklch(62.8% 0.2577 29.23).
  const [r, g, b] = oklchToLinearSrgb({ L: 0.628, C: 0.2577, H: 29.23 });
  assert.ok(r > 0.99 && g < 0.01 && b < 0.01, `red: ${r} ${g} ${b}`);
});

test('text and status hues keep contrast against the canvas in both themes', () => {
  const floors = { '--text-1': 7, '--text-2': 4.5, '--text-3': 3, '--p1': 3, '--p2': 3, '--p3': 3, '--accent': 3 };
  for (const theme of ['dark', 'light']) {
    const bg = oklch(resolve('--bg-canvas', theme));
    for (const [t, min] of Object.entries(floors)) {
      const c = oklch(resolve(t, theme));
      assert.equal(c.alpha, 1, `${t} is opaque`);
      const ratio = contrast(c, bg);
      assert.ok(ratio >= min, `${theme} ${t} on --bg-canvas: ${ratio.toFixed(2)} < ${min}`);
    }
    // Text on the filled alarm tiles.
    const inv = oklch(resolve('--text-inv', theme));
    for (const p of ['--p1', '--p2', '--p3']) {
      const r = contrast(inv, oklch(resolve(p, theme)));
      assert.ok(r >= 3, `${theme} --text-inv on ${p}: ${r.toFixed(2)}`);
    }
  }
});

test('one accent: a single hue, apart from p1 by lightness and chroma', () => {
  for (const theme of ['dark', 'light']) {
    const a = oklch(resolve('--accent', theme));
    const w = oklch(resolve('--accent-weak', theme));
    assert.equal(w.H, a.H, 'accent-weak shares the accent hue');
    assert.equal(a.H, 45, 'safety orange');
    const p1 = oklch(resolve('--p1', theme));
    assert.ok(Math.abs(a.H - p1.H) >= 15, 'accent and p1 differ in hue');
    assert.ok(a.L !== p1.L && a.C !== p1.C, 'and in lightness and chroma');
  }
});

test('greys are grey: surfaces, lines and text carry (almost) no chroma', () => {
  for (const theme of ['dark', 'light']) {
    for (const t of ['--bg-canvas', '--bg-surface', '--bg-elevated', '--bg-sunken', '--bg-hover', '--bg-selected',
      '--line-weak', '--line', '--line-strong', '--text-1', '--text-2', '--text-3', '--text-inv']) {
      assert.ok(oklch(resolve(t, theme)).C <= 0.005, `${theme} ${t} is neutral`);
    }
    // --ok is muted on purpose: well below the alarm hues.
    assert.ok(oklch(resolve('--ok', theme)).C <= 0.1, `${theme} --ok is muted`);
  }
});

// --- fonts ------------------------------------------------------------------

const FONT_FILES = [
  ['JetBrains Mono', 400, 'jetbrains-mono/JetBrainsMono-Regular.woff2'],
  ['JetBrains Mono', 600, 'jetbrains-mono/JetBrainsMono-SemiBold.woff2'],
  ['Barlow Condensed', 500, 'barlow-condensed/BarlowCondensed-Medium.woff2'],
  ['Barlow Condensed', 600, 'barlow-condensed/BarlowCondensed-SemiBold.woff2'],
];
const fontsMissing = fs.existsSync(path.join(FONTS, 'MISSING'));

test('four @font-face blocks, swap, latin subset range, vendored urls', () => {
  const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, 4);
  for (const [family, weight, file] of FONT_FILES) {
    const f = faces.find((b) => b.includes(`"${family}"`) && new RegExp(`font-weight:\\s*${weight};`).test(b));
    assert.ok(f, `${family} ${weight}`);
    assert.match(f, /font-display:\s*swap;/);
    assert.match(f, /font-style:\s*normal;/);
    assert.ok(f.includes(`url("/vendor/fonts/${file}") format("woff2")`), `${family} ${weight} points at ${file}`);
    assert.match(f, /unicode-range:\s*U\+0000-00FF, U\+2000-206F, U\+2190-21FF, U\+2500-25FF, U\+20AC;/);
  }
});

test('the vendored font files are real woff2 with their OFL licence', (t) => {
  if (fontsMissing) return t.skip('public/vendor/fonts/MISSING: fonts not vendored yet (HUMAN)');
  for (const [, , file] of FONT_FILES) {
    const buf = fs.readFileSync(path.join(FONTS, file));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is woff2`);
    assert.ok(buf.length > 10_000 && buf.length < 400_000, `${file} size ${buf.length}`);
  }
  for (const dir of ['jetbrains-mono', 'barlow-condensed']) {
    const ofl = fs.readFileSync(path.join(FONTS, dir, 'OFL.txt'), 'utf8');
    assert.match(ofl, /SIL Open Font License, Version 1\.1/, `${dir}/OFL.txt`);
  }
});

test('the server hands the fonts out as font/woff2 from public/vendor', { timeout: 30_000 }, async (t) => {
  if (fontsMissing) return t.skip('public/vendor/fonts/MISSING: fonts not vendored yet (HUMAN)');
  const b = await boot();
  try {
    for (const [, , file] of FONT_FILES) {
      const res = await fetch(`${b.url}/vendor/fonts/${file}`, { method: 'HEAD' });
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get('content-type'), 'font/woff2', file);
    }
  } finally {
    await b.stop();
  }
});
