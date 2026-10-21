// Selection is a 1 px accent border, never a fill (runs night 4 T28,
// r22-designer across 4): the selected builder chip, the phone bar's lit
// segment and the Board's NEEDS YOU chips carry no background in any sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declarations } from './helpers/css-guardrails.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS = path.join(ROOT, 'public/css');
const SHEETS = [
  ...fs.readdirSync(CSS).filter((f) => f.endsWith('.css')),
  ...fs.readdirSync(path.join(CSS, 'views')).filter((f) => f.endsWith('.css')).map((f) => `views/${f}`),
];
const DECLS = SHEETS.flatMap((f) => declarations(fs.readFileSync(path.join(CSS, f), 'utf8')).decls.map((d) => ({ ...d, file: f })));

/** Declarations whose selector list holds a selector matching `re`. */
const on = (re) => DECLS.filter((d) => d.prelude.split(',').some((s) => re.test(s.trim())));
const FILL = new Set(['background', 'background-color', 'background-image']);

const SELECTED = [
  ['the selected chip', /^\.chip\[aria-(?:pressed|selected)="true"\]$/],
  ['the selected builder chip', /^\.strip-chip\[aria-pressed="true"\]$/],
  ['the lit phone-bar segment', /^\.ps-tab\[aria-selected="true"\]$/],
];

for (const [name, re] of SELECTED) {
  test(`${name} has no fill and an accent border (T28)`, () => {
    const decls = on(re);
    assert.ok(decls.length, `${name}: a rule exists`);
    const fills = decls.filter((d) => FILL.has(d.prop));
    assert.deepEqual(fills.map((d) => `${d.file}: ${d.prelude} { ${d.prop}: ${d.value} }`), [], `${name} is not filled`);
    assert.ok(
      decls.some((d) => /^(?:border(?:-color)?|outline(?:-color)?)$/.test(d.prop) && /var\(--accent\)/.test(d.value)),
      `${name} is drawn by a 1 px accent border`,
    );
  });
}

test('a NEEDS YOU chip on the Board strip is a status border and its lamp, no fill (T28)', () => {
  const decls = on(/^\.attention-strip \.chip(?:\.[\w-]+)*$/);
  assert.ok(decls.length);
  const fills = decls.filter((d) => FILL.has(d.prop) && d.value !== 'var(--bg-surface)');
  assert.deepEqual(fills.map((d) => `${d.prelude} { ${d.prop}: ${d.value} }`), [], 'no tinted fill on a NEEDS YOU chip');
  assert.ok(on(/^\.attention-strip \.chip\.s-waiting_permission$/).some((d) => d.prop === 'border-color'), 'the state rides on the border');
});

test('docs/design.md names the selection rule next to the accent (T28)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs/design.md'), 'utf8');
  assert.match(md, /One accent\.[\s\S]{0,400}Selection is a 1 px accent border, never a fill/);
});
