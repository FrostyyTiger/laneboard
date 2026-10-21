// The hard guardrails of the industrial design (fleet plan §4 2.8, task D1),
// checked over every stylesheet in public/css/**. Sheets that predate the
// redesign sit on LEGACY until their owner restyles them (D4 shell, D5 rail,
// D9 board, §5 M3 the map, the rest with their views); a restyled sheet drops
// off the list and is checked like any new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declarations, splitTop, violations } from './helpers/css-guardrails.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_DIR = path.join(ROOT, 'public', 'css');
const JS_DIR = path.join(ROOT, 'public', 'js');

/** Pre-redesign sheets and the task that empties each entry. */
const LEGACY = new Map([
  ['shell.css', 'D4'],
  ['rail.css', 'D5'],
  ['terminal.css', 'view owner'],
  ['misc.css', 'view owner'],
  ['lanes.css', 'view owner'],
  ['views/data.css', 'view owner'],
]);

const sheets = () => fs.readdirSync(CSS_DIR, { recursive: true })
  .map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.css')).sort();

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

// reviews/20-designer.md, Morning 5: `STOPPED: BUDGET` sat in a filled chip in
// dark and read as bare text in light (the shared .mrow-kind wash is white).
test('T36: the Morning run state word has one treatment in both themes, no fill', () => {
  const all = sheets().flatMap((f) => declarations(fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).decls);
  const run = all.filter((d) => d.prelude.split(',').map((s) => s.trim()).includes('.morning-run .mrow-kind'));
  const val = (prop) => run.filter((d) => d.prop === prop).at(-1)?.value;
  assert.match(val('background') ?? '', /^(none|transparent)$/, 'no fill behind the state word');
  assert.equal(val('padding'), '0', 'no chip padding');
  // nothing themes the run row's word, or any .mrow-kind fill, per theme
  const themed = all.filter((d) => /data-theme|prefers-color-scheme/.test(d.prelude + d.at.join(' '))
    && /mrow-kind/.test(d.prelude) && /^background/.test(d.prop));
  assert.deepEqual(themed, []);
});
