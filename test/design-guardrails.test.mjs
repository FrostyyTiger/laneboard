// The hard guardrails of the industrial design (fleet plan §4 2.8, task D1),
// checked over every stylesheet in public/css/**. Sheets that predate the
// redesign sit on LEGACY until their owner restyles them (D4 shell, D5 rail,
// D9 board, §5 M3 the map, the rest with their views); a restyled sheet drops
// off the list and is checked like any new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_DIR = path.join(ROOT, 'public', 'css');
const JS_DIR = path.join(ROOT, 'public', 'js');

/** Pre-redesign sheets and the task that empties each entry. */
const LEGACY = new Map([
  ['shell.css', 'D4'],
  ['rail.css', 'D5'],
  ['board.css', 'D9'],
  ['terminal.css', 'view owner'],
  ['misc.css', 'view owner'],
  ['lanes.css', 'view owner'],
  ['views/data.css', 'view owner'],
  ['views/box.css', 'D11'],
]);

const sheets = () => fs.readdirSync(CSS_DIR, { recursive: true })
  .map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.css')).sort();

// --- a small CSS reader ------------------------------------------------------

/** Split at `sep` outside (), [], quotes. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Every declaration as {prelude, at, prop, value}; `at` lists enclosing at-rules. */
function declarations(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const keyframes = [];
  (function walk(src, at) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const prelude = src.slice(i, open).replace(/\s+/g, ' ').trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      i = j;
      const kf = /^@keyframes\s+([\w-]+)/.exec(prelude);
      if (kf) { keyframes.push(kf[1]); continue; }
      if (prelude.startsWith('@') && prelude !== '@font-face') { walk(body, [...at, prelude]); continue; }
      for (const d of splitTop(body, ';')) {
        const k = d.indexOf(':');
        if (k < 0) continue;
        out.push({ prelude, at, prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim().replace(/\s+/g, ' ') });
      }
    }
  })(css, []);
  return { decls: out, keyframes };
}

const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const COLOUR_LITERAL = /\b(?:oklch|oklab|lch|lab|rgba?|hsla?|hwb|color)\(|#[0-9a-f]{3,8}\b/i;
const TEXTURE_TOKEN = /^--(?:tex-[\w-]+|bracket-img)$/;
const RADIUS_OK = new Set(['var(--radius)', '0', '50%']);
const TRANSITION_PROPS = new Set(['opacity', 'transform', 'width']);
const LAMP_GLOW = /^\.lamp\[data-p="[12]"\]$/;

function ms(t) {
  const m = /^([\d.]+)(ms|s)$/.exec(t);
  return m ? +m[1] * (m[2] === 's' ? 1000 : 1) : null;
}

/** Guardrail breaches in one sheet, as readable strings. */
function violations(file, cssText) {
  const isTokens = file === 'tokens.css';
  const { decls, keyframes } = declarations(cssText);
  const v = [];
  const where = (d) => `${file}: ${d.prelude} { ${d.prop}: ${d.value} }`;
  for (const kf of keyframes) if (kf !== 'lb-flash') v.push(`${file}: @keyframes ${kf} (only lb-flash) [6]`);
  for (const d of decls) {
    const { prop, value } = d;
    // 1. Gradients only inside the texture tokens.
    if (GRADIENT.test(value) && !(isTokens && TEXTURE_TOKEN.test(prop))) v.push(`${where(d)} gradient [1]`);
    // 2. No backdrop-filter, no glass.
    if (/^(-webkit-)?backdrop-filter$/.test(prop)) v.push(`${where(d)} backdrop-filter [2]`);
    // 3. No box-shadow; drop-shadow only as the p1/p2 lamp glow.
    if (prop === 'box-shadow' && value !== 'none') v.push(`${where(d)} box-shadow [3]`);
    if (/drop-shadow\(/.test(value) && !splitTop(d.prelude, ',').every((s) => LAMP_GLOW.test(s.trim()))) {
      v.push(`${where(d)} drop-shadow outside .lamp[data-p="1"|"2"] [3]`);
    }
    // 4. Colour literals only in tokens.css.
    if (!isTokens && COLOUR_LITERAL.test(value)) v.push(`${where(d)} colour literal [4]`);
    // 6. Transitions: 120ms or less, opacity/transform/width only; animation only lb-flash.
    if (prop === 'transition' || prop === 'transition-property' || prop === 'transition-duration') {
      for (const part of splitTop(value, ',')) {
        const words = part.trim().split(' ');
        for (const w of words) { const t = ms(w); if (t != null && t > 120) v.push(`${where(d)} ${w} > 120ms [6]`); }
        if (prop !== 'transition-duration' && words[0] !== 'none' && !TRANSITION_PROPS.has(words[0])) {
          v.push(`${where(d)} transitions ${words[0]} [6]`);
        }
      }
    }
    if ((prop === 'animation' || prop === 'animation-name') && !/^(none|lb-flash\b)/.test(value)) {
      v.push(`${where(d)} animation other than lb-flash [6]`);
    }
    // 7. Radius: var(--radius), 0 or 50%.
    if (/^border(-[a-z]+)*-radius$/.test(prop) && !value.split(/[ /]+/).every((p) => RADIUS_OK.has(p))) {
      v.push(`${where(d)} radius [7]`);
    }
    // 8. Fonts only through the two tokens (the @font-face names are their sources).
    if (prop === 'font-family' && d.prelude !== '@font-face' && !/^(var\(--font-(mono|label)\)|inherit)$/.test(value)) {
      v.push(`${where(d)} font-family [8]`);
    }
    if (prop === 'font' && !/^(inherit|var\(--font-(mono|label)\))$/.test(value) && !/var\(--font-(mono|label)\)/.test(value)) {
      v.push(`${where(d)} font shorthand without a font token [8]`);
    }
  }
  return v;
}

// --- the self-test: the checker catches what it should --------------------------

test('the checker flags every guardrail and passes the allowed forms', () => {
  const bad = `
    .a { background: linear-gradient(red, blue); }
    .b { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .c { box-shadow: 0 1px 2px var(--line); }
    .d { filter: drop-shadow(0 0 3px currentColor); }
    .e { color: #ff0000; border-color: oklch(50% 0 0); background: rgb(1 2 3); }
    .f { transition: opacity 200ms, color 100ms; }
    .g { border-radius: 4px; }
    .h { font-family: Inter, sans-serif; }
    .i { animation: spin 1s; }
    @keyframes spin { to { transform: rotate(1turn); } }
  `;
  const v = violations('x.css', bad);
  for (const tag of ['[1]', '[2]', '[3]', '[4]', '[6]', '[7]', '[8]']) assert.ok(v.some((s) => s.endsWith(tag)), `catches ${tag}`);
  assert.equal(v.filter((s) => s.endsWith('[2]')).length, 2, 'both backdrop-filter spellings');
  assert.equal(v.filter((s) => s.endsWith('[4]')).length, 3, 'hex, oklch and rgb');
  const good = `
    #sheet .x { color: var(--text-1); background: var(--tex-dots); border-radius: var(--radius); }
    .lamp[data-p="1"], .lamp[data-p="2"] { filter: drop-shadow(0 0 3px currentColor); }
    .lamp { border-radius: 50%; box-shadow: none; }
    .t { transition: opacity var(--dur) var(--ease), width 120ms; animation: lb-flash 1s linear infinite; }
    .f { font-family: var(--font-label); } .g { font: inherit; } .z { border-radius: 0 var(--radius) 0 0; }
    .u { background: url("data:image/svg+xml;utf8,<svg/>"); }
  `;
  assert.deepEqual(violations('x.css', good), []);
});

// --- the real sheets -------------------------------------------------------------

test('every LEGACY entry is a sheet that exists', () => {
  const all = new Set(sheets());
  for (const f of LEGACY.keys()) assert.ok(all.has(f), `LEGACY lists ${f}, which is gone: drop the entry`);
});

test('every non-legacy sheet in public/css keeps the guardrails', (t) => {
  const checked = sheets().filter((f) => !LEGACY.has(f));
  assert.ok(checked.includes('tokens.css') && checked.includes('base.css'), 'tokens.css and base.css are always checked');
  const found = checked.flatMap((f) => violations(f, fs.readFileSync(path.join(CSS_DIR, f), 'utf8')));
  assert.deepEqual(found, []);
  // A ratchet note, not a failure: tells a restyling task when it may drop its entry.
  for (const [f, owner] of LEGACY) {
    const n = violations(f, fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).length;
    t.diagnostic(n ? `legacy ${f} (${owner}): ${n} breaches left` : `legacy ${f} (${owner}) is clean: remove it from LEGACY`);
  }
});

test('tokens.css holds the only gradients, and the only chromatic colours are the accent and status hues', () => {
  const { decls } = declarations(fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8'));
  const chromatic = /^--(accent(-weak)?|p[123](-weak|-line)?|ok)$/;
  const accentHues = new Set();
  for (const d of decls) {
    for (const m of d.value.matchAll(/oklch\(\s*[\d.]+%\s+([\d.]+)\s+([\d.]+)/g)) {
      if (+m[1] > 0.02) assert.match(d.prop, chromatic, `${d.prop} is a chromatic literal outside the accent/status set`);
      if (/^--accent/.test(d.prop)) accentHues.add(+m[2]);
    }
    if (/^--accent/.test(d.prop)) assert.match(d.prop, /^--accent(-weak|-dim)?$/, 'one accent: no second --accent-* token');
  }
  assert.equal(accentHues.size, 1, `one accent hue, got ${[...accentHues]}`);
});

test('no code sets the style attribute wholesale (only el.style.x) [9]', () => {
  const files = fs.readdirSync(JS_DIR, { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    assert.ok(!/setAttribute\(\s*['"`]style['"`]/.test(src), `public/js/${f} uses setAttribute('style')`);
  }
});
