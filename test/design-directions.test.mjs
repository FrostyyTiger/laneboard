// The design directions of night 1 (runs plan T10, README §5 and §8 Q1):
// token override files in docs/plans/runs/design/*.css. Each one may only set
// custom properties that public/css/tokens.css defines, with tokens.css's own
// selectors, in both themes, and must keep the design guardrails and the
// contrast floors of test/tokens.test.mjs once laid over tokens.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declarations, violations } from './helpers/css-guardrails.mjs';
import { contrast, oklch } from './helpers/oklch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'docs', 'plans', 'runs', 'design');
const TOKENS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'tokens.css'), 'utf8');

const DARK = ':root, [data-theme="dark"]';
const LIGHT = '[data-theme="light"]';
const DERIVED = ':root, [data-theme]';

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.css')).sort();

/** Top-level blocks as Map(prelude -> Map(prop -> value)), at-rules left out. */
function blocks(cssText) {
  const out = new Map();
  for (const d of declarations(cssText).decls) {
    if (d.at.length || d.prelude === '@font-face') continue;
    if (!out.has(d.prelude)) out.set(d.prelude, new Map());
    out.get(d.prelude).set(d.prop, d.value);
  }
  return out;
}

const BASE = blocks(TOKENS);
const BASE_PROPS = new Set([...BASE.values()].flatMap((m) => [...m.keys()]));

/** tokens.css with one direction laid over it, resolved the way the cascade would on <html data-theme>. */
function resolver(over) {
  const merged = (p) => new Map([...(BASE.get(p) ?? []), ...(over.get(p) ?? [])]);
  const layers = { root: merged(':root'), dark: merged(DARK), light: merged(LIGHT), derived: merged(DERIVED) };
  const resolve = (name, theme, seen = new Set()) => {
    assert.ok(!seen.has(name), `var() cycle through ${name}`);
    seen.add(name);
    const v = layers[theme].get(name) ?? layers.derived.get(name) ?? layers.root.get(name);
    assert.ok(v != null, `${name} is defined for the ${theme} theme`);
    return v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(n, theme, new Set(seen)));
  };
  return { resolve, root: layers.root };
}

test('there are two or three directions and the README names each one', () => {
  assert.ok(files.length >= 2 && files.length <= 3, `2 or 3 directions, got ${files.join(', ')}`);
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  for (const f of files) assert.ok(readme.includes(f), `README.md describes ${f}`);
  assert.match(readme, /node test\/tools\/demo-fleet\.mjs --design /, 'README says how to view one on the demo');
});

for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  const { decls } = declarations(text);
  const over = blocks(text);

  test(`${f}: only custom properties tokens.css defines, under its selectors`, () => {
    assert.ok(decls.length > 0, 'sets something');
    for (const d of decls) {
      const where = `${d.prelude} { ${d.prop} }`;
      assert.deepEqual(d.at, [], `${where}: no at-rules (density and motion stay in tokens.css)`);
      assert.match(d.prop, /^--[\w-]+$/, `${where}: a custom property`);
      assert.ok(BASE_PROPS.has(d.prop), `${where}: tokens.css defines ${d.prop}`);
      assert.ok(BASE.has(d.prelude), `${where}: a selector of tokens.css`);
    }
  });

  test(`${f}: both themes, dark before light, and the guardrails hold`, () => {
    const dark = [...(over.get(DARK)?.keys() ?? [])].sort();
    const light = [...(over.get(LIGHT)?.keys() ?? [])].sort();
    assert.deepEqual(dark, light, 'a themed token is set in both themes or in neither');
    const order = decls.map((d) => d.prelude);
    if (dark.length) assert.ok(order.lastIndexOf(DARK) < order.indexOf(LIGHT), 'the dark block comes first, so light wins on <html data-theme="light">');
    assert.deepEqual(violations(f, text, { tokens: true }), []);
    // One accent and grey everywhere else, as in tokens.css.
    for (const d of decls) {
      for (const m of d.value.matchAll(/oklch\(\s*[\d.]+%\s+([\d.]+)\s+([\d.]+)/g)) {
        if (+m[1] > 0.02) assert.match(d.prop, /^--(accent(-weak)?|p[123](-weak|-line)?|ok)$/, `${d.prop} is chromatic outside the accent/status set`);
      }
      if (/^--accent/.test(d.prop)) assert.match(d.value, /oklch\(\s*[\d.]+%\s+[\d.]+\s+45\b/, 'the accent keeps its hue');
    }
  });

  test(`${f}: a 4px grid, an ordered type scale and the contrast floors`, () => {
    const { resolve, root } = resolver(over);
    for (const [k, v] of root) {
      if (/^--(sp-\d+|row-(dense|comfy|touch)|header-h|tape-h)$/.test(k)) {
        assert.match(v, /^\d+px$/, `${k} in px`);
        assert.equal(parseInt(v, 10) % 4, 0, `${k}: ${v} is on the 4px grid`);
      }
    }
    const scale = ['--fs-10', '--fs-11', '--fs-12', '--fs-13', '--fs-16', '--fs-20', '--fs-28'].map((k) => parseInt(root.get(k), 10));
    assert.deepEqual([...scale].sort((a, b) => a - b), scale, `type scale ascends: ${scale}`);
    assert.ok(scale[0] >= 10, 'nothing under 10px');
    const floors = { '--text-1': 7, '--text-2': 4.5, '--text-3': 3, '--p1': 3, '--p2': 3, '--p3': 3, '--accent': 3 };
    for (const theme of ['dark', 'light']) {
      for (const bgName of ['--bg-canvas', '--bg-surface', '--bg-elevated']) {
        const bg = oklch(resolve(bgName, theme));
        for (const [t, min] of Object.entries(floors)) {
          const ratio = contrast(oklch(resolve(t, theme)), bg);
          assert.ok(ratio >= min, `${theme} ${t} on ${bgName}: ${ratio.toFixed(2)} < ${min}`);
        }
      }
    }
  });
}

// Runs night 4 T11: Night was picked (§8 Q6) and folded into tokens.css v2.
test('tokens.css v2 is Night: every value night.css sets is the same in tokens.css', () => {
  assert.match(TOKENS, /^\/\* =+\n\s*laneboard tokens v2 "Night"/, 'a version line at the top');
  const night = blocks(fs.readFileSync(path.join(DIR, 'night.css'), 'utf8'));
  let n = 0;
  for (const [prelude, props] of night) {
    for (const [prop, value] of props) {
      assert.equal(BASE.get(prelude)?.get(prop), value, `${prelude} { ${prop} }`);
      n++;
    }
  }
  assert.ok(n >= 20, `night.css sets the rows, header and both themes (${n} values)`);
});

test('docs/design.md exists and names the colour rule', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'design.md'), 'utf8');
  assert.match(doc, /tokens v2/);
  assert.match(doc, /grey[^\n]*news|news[^\n]*grey/i, 'grey = news');
  assert.match(doc, /wants you[^\n]*amber[^\n]*▲/i, 'amber ▲ = wants you');
  assert.match(doc, /broken[^\n]*red[^\n]*■/i, 'red ■ = broken');
  assert.match(doc, /one accent/i);
  assert.match(doc, /no blue or cyan in content/i);
  for (const t of ['--fs-10', '--fs-28', '--row-dense', '--radius', '--bg-surface']) assert.ok(doc.includes(t), `names ${t}`);
});
