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
import { SOURCES } from '../public/js/wall/galaxy/director.js';
import { SHOW, SHOW_TYPES } from '../public/js/wall/galaxy/show.js';
import { SHOW_DEMO_SCRIPT } from '../public/js/wall/galaxy/showdemo.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const flat = (f) => read(f).replace(/\s+/g, ' ');

// The URL switches each page parses (T44): every module a page's entry point
// reaches by relative imports, scanned for `q.get('x')`, `q.getAll('x')`,
// `q.has('x')` (`q?.get?.('x')` too). Every Wall module names its
// URLSearchParams `q`. Returns Map(name → Set of pages).
const ENTRIES = { wall: 'public/js/wall/main.js', galaxy: 'public/js/wall/galaxy/main.js' };
function parsedSwitches() {
  const out = new Map();
  for (const [page, entry] of Object.entries(ENTRIES)) {
    const seen = new Set();
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = read(file);
      for (const m of src.matchAll(/from\s+'(\.\.?\/[^']+\.js)'/g)) walk(path.posix.join(path.posix.dirname(file), m[1]));
      for (const m of src.matchAll(/\bq\??\.(?:get|getAll|has)\??\.?\(\s*'([A-Za-z]+)'/g)) {
        if (!out.has(m[1])) out.set(m[1], new Set());
        out.get(m[1]).add(page);
      }
    };
    walk(entry);
  }
  return out;
}

// The switch table's rows in docs/wall.md: Map(name → its Page cell).
function documentedSwitches() {
  const rows = new Map();
  for (const m of read('docs/wall.md').matchAll(/^\| `\?([A-Za-z]+)=[^`]*` \| (\w+) \|/gm)) rows.set(m[1], m[2]);
  return rows;
}

// A `## ` section of docs/wall.md, white space flattened.
const section = (title) => {
  const doc = read('docs/wall.md');
  const at = doc.indexOf(`\n## ${title}\n`);
  assert.ok(at >= 0, `a "## ${title}" section`);
  const end = doc.indexOf('\n## ', at + 1);
  return doc.slice(at, end < 0 ? undefined : end).replace(/\s+/g, ' ');
};

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

test('T44: the switch table is the pages\' parsers: every switch parsed has a row with the right page, every row is parsed', () => {
  const parsed = parsedSwitches();
  const rows = documentedSwitches();
  assert.ok(parsed.size >= 13, `the scan finds the parsers (${[...parsed.keys()]})`);
  for (const [name, pages] of parsed) {
    assert.ok(rows.has(name), `?${name}= is parsed by ${[...pages]} but has no row in docs/wall.md`);
    const want = pages.size === 2 ? 'both' : [...pages][0];
    assert.equal(rows.get(name), want, `?${name}= row's Page`);
  }
  for (const name of rows.keys()) assert.ok(parsed.has(name), `docs/wall.md documents ?${name}=, which no page parses`);
});

test('T44: docs/wall.md says who drives the camera (D10), in the director\'s order', () => {
  const doc = section('Who drives the camera');
  const at = SOURCES.map((s) => doc.indexOf(`\`${s}\``));
  for (const [i, s] of SOURCES.entries()) assert.ok(at[i] >= 0, `source ${s}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'touch, then show, then tour');
  assert.match(doc, /refused \(`busy`\), not queued/);
  assert.match(doc, /never a cut/);
});

test('T44: docs/wall.md gives the show message: envelope, every command, every answer code, both roads', () => {
  const doc = section('Show commands');
  assert.ok(doc.includes(`"v": ${SHOW.v}, "ch": "${SHOW.ch}"`), 'the envelope');
  for (const t of SHOW_TYPES) assert.ok(doc.includes(`| \`${t}\` |`), `a row for ${t}`);
  const codes = new Set();
  for (const f of ['show.js', 'transport.js', 'director.js']) {
    for (const m of read(`public/js/wall/galaxy/${f}`).matchAll(/(?:reply\([^)]*|code: |refused: )'([a-z-]+)'/g)) codes.add(m[1]);
  }
  assert.deepEqual([...codes].sort(), ['bad-shape', 'busy', 'unknown-node']);
  for (const c of codes) assert.ok(doc.includes(`| \`${c}\` |`), `a row for code ${c}`);
  assert.ok(doc.includes(`BroadcastChannel('${SHOW.ch}')`), 'the channel');
  assert.match(doc, /`postMessage`/);
  assert.match(doc, /`\?showOrigins=`/);
  for (const n of [SHOW.ttlS, SHOW.maxTtlS, SHOW.maxNodes, SHOW.maxText, SHOW.maxTitle, SHOW.maxId]) {
    assert.ok(doc.includes(String(n)), `the limit ${n}`);
  }
  assert.match(doc, /`\?show=demo`/);
});

test('T44: every feature has demo data: the large demo sets each feed field, the show demo sends each command', () => {
  const hub = read('test/helpers/demo-hub.mjs');
  assert.match(hub, /glow: \{ rgb:/, 'a light with glow');
  assert.match(hub, /\.ring = \{ progress/, 'a print with ring');
  assert.match(hub, /\.countdown = \{ at:/, 'a scheduled job with countdown');
  assert.deepEqual([...new Set(SHOW_DEMO_SCRIPT.map((c) => c.type))].sort(), [...SHOW_TYPES].sort());
  const doc = section('Feed fields');
  assert.match(doc, /demo fleet \(`--size large`\) carries all three/);
});
