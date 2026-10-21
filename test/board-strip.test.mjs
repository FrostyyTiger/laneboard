// The Board's NEEDS YOU strip at phone width sits on the type scale of
// docs/design.md (runs night 4 T30, r22-designer Board 1): body mono at
// --fs-13, no tracked caps, a 1 px border with no fill, and it wraps so no
// half chip is cut at the right edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declarations } from './helpers/css-guardrails.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public/css/rail.css'), 'utf8');
const DECLS = declarations(css).decls;
const on = (sel) => DECLS.filter((d) => d.prelude.split(',').some((s) => s.trim() === sel));
const val = (sel, prop) => on(sel).filter((d) => d.prop === prop).map((d) => d.value).at(-1);

test('a NEEDS YOU strip chip is body mono at --fs-13 with no letter-spacing (T30)', () => {
  const chip = '.attention-strip .chip';
  assert.equal(val(chip, 'font-family'), 'var(--font-mono)');
  assert.equal(val(chip, 'font-size'), 'var(--fs-13)');
  assert.equal(val(chip, 'letter-spacing'), '0', 'the kit chip tracking is undone');
  assert.equal(val(chip, 'text-transform'), 'none', 'the kit chip caps are undone');
  assert.ok(!on(chip).some((d) => d.prop === 'font'), 'no `font` shorthand that would inherit the phone body size');
});

test('a NEEDS YOU strip chip has a 1 px border and no fill (T30)', () => {
  const chip = '.attention-strip .chip';
  assert.match(val(chip, 'border'), /^var\(--bw\) solid /);
  assert.equal(val(chip, 'background'), 'transparent');
});

test('the strip wraps, so no chip is cut at the right edge (T30)', () => {
  assert.equal(val('.attention-strip', 'flex-wrap'), 'wrap');
  assert.ok(!on('.attention-strip').some((d) => d.prop === 'overflow-x'), 'no horizontal scroll that cuts a chip');
  assert.equal(val('.attention-strip .chip', 'max-width'), '100%', 'a long name ellipsizes inside the line');
});
