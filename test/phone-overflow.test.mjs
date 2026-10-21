// No horizontal overflow at 390 px (runs night 4 T37, r49-stranger 1): no sheet
// gives a piece a fixed width wider than the phone, the phone header fits its
// annunciator and refresh button (the clock goes, the tiles go icon + count),
// and the phone bar reaches every view (MAP | LIST | INBOX plus the ⋯ menu).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { declarations } from './helpers/css-guardrails.mjs';
import { SHEET_TABS, MORE_VIEWS } from '../public/js/ui/sheet.js';
import { VIEWS } from '../public/js/core/router.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS = path.join(ROOT, 'public/css');
const SHEETS = [
  ...fs.readdirSync(CSS).filter((f) => f.endsWith('.css')),
  ...fs.readdirSync(path.join(CSS, 'views')).filter((f) => f.endsWith('.css')).map((f) => `views/${f}`),
];
const DECLS = SHEETS.flatMap((f) => declarations(fs.readFileSync(path.join(CSS, f), 'utf8')).decls.map((d) => ({ ...d, file: f })));
const W = 390;

/** Does an at-rule stack apply at a viewport `w` px wide? Container queries count as applying. */
function appliesAt(at, w) {
  return at.every((a) => {
    if (!a.startsWith('@media')) return true;
    for (const [, k, n] of a.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)) {
      if (k === 'min' && w < Number(n)) return false;
      if (k === 'max' && w > Number(n)) return false;
    }
    return true;
  });
}
const AT_390 = DECLS.filter((d) => appliesAt(d.at, W));
const on = (re) => AT_390.filter((d) => d.prelude.split(',').some((s) => re.test(s.trim())));
const last = (decls, prop) => decls.filter((d) => d.prop === prop).at(-1)?.value;

// A wider piece is fine only inside a box that scrolls on its own.
const SCROLLS_INSIDE = new Map([['.chart', 'inside .chart-scroll (overflow-x: auto)']]);

test('no sheet fixes a width or min-width wider than 390 px at 390 (T37)', () => {
  const wide = AT_390.filter((d) => /^(?:min-)?width$/.test(d.prop))
    .filter((d) => Number(d.value.match(/^(\d+)px$/)?.[1] ?? 0) > W)
    .filter((d) => !SCROLLS_INSIDE.has(d.prelude.trim()));
  assert.deepEqual(wide.map((d) => `${d.file}: ${d.prelude} { ${d.prop}: ${d.value} }`), []);
  assert.ok(on(/^\.chart-scroll$/).some((d) => d.prop === 'overflow-x' && d.value === 'auto'), 'the chart scrolls in its box');
});

test('the phone header fits 390: 48 px icon tiles, no clock (T37)', () => {
  const cols = last(on(/^\.ann$/), 'grid-template-columns');
  assert.equal(cols, 'repeat(4, 48px)', 'the annunciator is four 48 px tiles at 390');
  assert.equal(last(on(/^\.clock$/), 'display'), 'none', 'the clock is hidden on a phone');
  assert.equal(last(on(/^\.ann-label$/), 'display'), 'none', 'a tile shows icon and count, no label');
  assert.equal(last(on(/^\.ann-i$/), 'display'), 'inline-block', 'a tile shows its icon');
  // head-right starts at x 125 at 390 (padding, brand, LIVE, gaps; measured headless), then
  // 4 x 48 tiles + 3 x 2 px gaps, an 8 px gap, the 28 px refresh button and 12 px padding.
  assert.ok(125 + 4 * 48 + 3 * 2 + 8 + 28 + 12 <= W);
});

test('the phone bar reaches every view: segments plus the ⋯ menu (T37)', () => {
  const reach = new Set([...SHEET_TABS, ...MORE_VIEWS]);
  assert.deepEqual(VIEWS.filter((v) => !reach.has(v)), []);
  assert.deepEqual([...SHEET_TABS], ['map', 'list', 'inbox']);
});
