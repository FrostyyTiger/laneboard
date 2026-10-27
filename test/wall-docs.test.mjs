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
import { RESULT_STATES, SHOW, SHOW_CMDS, SHOW_LATER, WHY } from '../public/js/wall/galaxy/show.js';
import { TRANSPORT } from '../public/js/wall/galaxy/transport.js';
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
  assert.match(doc, /data-wall-state="tour"/);
  assert.match(doc, /waits while a finger is on the galaxy and for 3 s after it lifts/, 'the owner\'s finger rule (D70)');
  assert.match(doc, /10 s after it came, it is dropped/);
  assert.match(doc, /0\.3-0\.9 s by distance/, 'D68');
  assert.match(doc, /never a cut/);
});

test('T44: docs/wall.md gives the show messages (the cockpit\'s protocol §4): every command, state and why, the undo, the handle, both dev roads', () => {
  const doc = section('Show commands');
  assert.ok(doc.includes('"type": "show", "showId": "sh-0041", "turnId": "t-0132", "cmd":'), 'the message');
  assert.ok(doc.includes('"type": "show.result"'), 'the answer');
  for (const c of SHOW_CMDS) assert.ok(doc.includes(`| \`${c}\` |`), `a row for ${c}`);
  for (const c of SHOW_LATER) assert.ok(doc.includes(`\`${c}\``), `${c} named`);
  for (const st of RESULT_STATES) assert.ok(doc.includes(`| \`${st}\` |`), `a row for state ${st}`);
  const whys = new Set();
  for (const m of read('public/js/wall/galaxy/show.js').matchAll(/WHY\.(\w+)/g)) whys.add(WHY[m[1]]);
  assert.deepEqual([...whys].sort(), Object.values(WHY).sort(), 'show.js uses every why');
  for (const w of Object.values(WHY)) assert.ok(doc.includes(`| \`${w}\` |`), `a row for why ${w}`);
  assert.ok(doc.includes('"type": "show.undo"'), 'the undo');
  assert.match(doc, /window\.__cockpitView/);
  for (const k of ['flyTo', 'fitNodes', 'camera()', 'setCamera', 'screenOf', 'onDraw', 'emphasis', 'show.state()']) assert.ok(doc.includes(k), k);
  assert.ok(doc.includes(`BroadcastChannel('${TRANSPORT.ch}')`), 'the channel');
  assert.match(doc, /`postMessage`/);
  assert.match(doc, /`\?showOrigins=`/);
  for (const n of [SHOW.maxNodes, SHOW.maxNote, SHOW.maxTitle, SHOW.maxBody]) assert.ok(doc.includes(String(n)), `the limit ${n}`);
  assert.match(doc, /Three at most/);
  assert.ok(doc.includes(`${TRANSPORT.maxBytes / 1024} KB`));
  assert.match(doc, /`\?show=demo`/);
});

test('T44: every feature has demo data: the large demo sets each feed field, the show demo sends each command', () => {
  const hub = read('test/helpers/demo-hub.mjs');
  assert.match(hub, /glow: \{ rgb:/, 'a light with glow');
  assert.match(hub, /\.ring = \{ progress/, 'a print with ring');
  assert.match(hub, /\.countdown = \{ at:/, 'a scheduled job with countdown');
  assert.deepEqual([...new Set(SHOW_DEMO_SCRIPT.filter((c) => c.cmd).map((c) => c.cmd))].sort(), [...SHOW_CMDS].sort());
  const doc = section('Feed fields');
  assert.match(doc, /demo fleet \(`--size large`\) carries all three/);
});
