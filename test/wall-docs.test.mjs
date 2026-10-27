// docs/wall.md (Wall plan night 4 T43, README §7 Night 4 E): the page a
// stranger reads before putting the Wall on a tablet. Every URL switch, every
// effect and every feed field is in it; README's views table has the Wall row;
// docs/map.md says which page paints the feed's extras.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FX_NAMES } from '../public/js/wall/galaxy/fx.js';
import { ROLES } from '../public/js/wall/galaxy/touch.js';
import { VARIANTS } from '../public/js/wall/variants.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const flat = (f) => read(f).replace(/\s+/g, ' ');

test('T43: docs/wall.md lists every URL switch in its table', () => {
  const doc = read('docs/wall.md');
  for (const s of ['demo', 'pace', 'fx', 'perf', 'quality', 'ratio', 'at', 'open', 'role', 'show', 'showOrigins', 'mm', 'variant']) {
    assert.match(doc, new RegExp(`^\\| \`\\?${s}=`, 'm'), `a table row for ?${s}=`);
  }
});

test('T43: docs/wall.md names every effect, role and 2D variant the page knows', () => {
  const doc = read('docs/wall.md');
  for (const n of FX_NAMES) assert.match(doc, new RegExp(`^\\| \`${n}\` \\|`, 'm'), `an effects row for ${n}`);
  for (const r of ROLES) assert.ok(doc.includes(`\`${r}\``), `role ${r}`);
  for (const v of VARIANTS) assert.ok(doc.includes(`\`${v.id}\``), `variant ${v.id}`);
});

test('T43: docs/wall.md covers kiosk mode, touch, stopping the tour and the feed fields', () => {
  const doc = flat('docs/wall.md');
  assert.match(doc, /## A tablet in kiosk mode/);
  assert.match(doc, /## Touch/);
  assert.match(doc, /To stop the tour/);
  assert.match(doc, /To give the page back to the tour/);
  for (const f of ['glow', 'ring', 'countdown']) assert.ok(doc.includes(`| \`${f}\` |`), `a feed-field row for ${f}`);
});

test('T43: README has a Wall row in its views table and links docs/wall.md', () => {
  const readme = read('README.md');
  assert.match(readme, /^\| \*\*Wall\*\* `\/galaxy\.html` \|/m);
  assert.match(readme, /^\| \[docs\/wall\.md\]\(docs\/wall\.md\) \|/m);
});

test('T43: docs/map.md says which page paints glow, ring and countdown', () => {
  const map = flat('docs/map.md');
  assert.match(map, /`glow` and `ring` are painted by `wall\.html`, `countdown` by `galaxy\.html`/);
});
