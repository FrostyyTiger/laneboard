// Which page a Wall address opens (night 4 T45): `wall.html?variant=galaxy`
// goes to the galaxy with its other switches, an unknown name says so on the
// tag, the galaxy's no-WebGL fallback (`islands-tiles`) is a real layout with
// only the held site's links, and the galaxy has a web manifest of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickVariant, pageHref, unknownNote, PAGES, VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';
import { FALLBACK_VARIANT, fallbackHref } from '../public/js/wall/galaxy/fallback.js';
import * as islandsTiles from '../public/js/wall/variants/islands-tiles.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { createFrame } from '../public/js/wall/frame.js';
import { bannerEcho } from '../public/js/wall/galaxy/hud.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('pages: ?variant=galaxy opens galaxy.html, every other switch along', () => {
  assert.deepEqual(PAGES, { galaxy: 'galaxy.html' });
  assert.equal(pageHref('?variant=galaxy'), 'galaxy.html');
  assert.equal(pageHref('variant=Galaxy'), 'galaxy.html', 'case and the leading ? do not matter');
  assert.equal(pageHref('?variant=galaxy&demo=1&fx=beacon&at=hv1'), 'galaxy.html?demo=1&fx=beacon&at=hv1');
  assert.equal(pageHref(new URLSearchParams('demo=1&variant=galaxy&role=explore')), 'galaxy.html?demo=1&role=explore');
  for (const s of ['', '?variant=radial', '?variant=islands-tiles', '?variant=nope', '?variant=__proto__',
    '?variant=hasOwnProperty', '?demo=1', undefined, null]) {
    assert.equal(pageHref(s), null, `${s} stays on wall.html`);
  }
});

test('pages: wall.html leaves for the page before it builds anything', () => {
  const main = read('js/wall/main.js');
  const go = main.indexOf('location.replace(away)');
  assert.ok(go > 0, 'main.js replaces the location');
  assert.ok(go < main.indexOf('pickVariant(location.search)'), 'before the variant is picked');
  assert.ok(go < main.indexOf('createMap('), 'before the Map is made');
  assert.match(main, /const away = pageHref\(location\.search\);\s*if \(away\) \{ location\.replace\(away\); return; \}/);
});

test('pages: an unknown variant is a grey note on the tag, a known one none', () => {
  assert.equal(unknownNote(pickVariant('?variant=nope')), 'unknown variant "nope" · radial');
  assert.equal(unknownNote(pickVariant('?variant=a-very-long-mistyped-name')), 'unknown variant "a-very-long-mis…" · radial');
  for (const s of ['', '?variant=', '?variant=radial', '?variant=RADIAL', '?variant= orbits ', '?variant=islands-tiles']) {
    assert.equal(unknownNote(pickVariant(s)), null, `${s}: no note`);
  }
  assert.equal(unknownNote(null), null);
  assert.match(read('js/wall/main.js'), /frame\.note\(unknownNote\(pick\)\)/);
  assert.match(read('js/wall/main.js'), /covers = \(\) => \[caption\.cover\(\), frame\.cover\(\), frame\.tagCover\(\), frame\.clockCover\(\)\]/);

  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const frame = createFrame(makeEl('div'), { timers: { setTimeout: () => 1, clearTimeout() {} }, now: () => 0 });
    const { tag, tagNote } = frame.el;
    assert.equal(tag.children[1], tagNote, 'between the name and the live word');
    assert.equal(tagNote.textContent, '', 'empty (hidden) by default');
    frame.note('UNKNOWN VARIANT "NOPE" · RADIAL');
    assert.equal(tagNote.textContent, 'unknown variant "nope" · radial', 'lower case, the tag sets caps');
    // A cover for the Map's names while the note is up: the tag and the line under it.
    Object.assign(tag, { offsetLeft: 900, offsetTop: 40, offsetWidth: 300, offsetHeight: 20 });
    Object.assign(tagNote, { offsetLeft: -200, offsetTop: 30, offsetWidth: 500, offsetHeight: 20 });
    assert.deepEqual(frame.tagCover(), { left: 700, top: 40, right: 1200, bottom: 90 });
    frame.note(null);
    assert.equal(tagNote.textContent, '');
    // No note: the tag alone is still a cover (T46: in a hold the Map's names ran over it).
    assert.deepEqual(frame.tagCover(), { left: 900, top: 40, right: 1200, bottom: 60 }, 'the tag alone');
    // The clock too (bottom left): read again when its words change, not every frame.
    const { clock } = frame.el;
    Object.assign(clock, { offsetLeft: 80, offsetTop: 800, offsetWidth: 160, offsetHeight: 70 });
    assert.deepEqual(frame.clockCover(), { left: 80, top: 800, right: 240, bottom: 870 });
    Object.assign(clock, { offsetWidth: 999 });
    assert.equal(frame.clockCover().right, 240, 'same words: the box it read');
  } finally {
    globalThis.document = prevDoc;
  }
  const css = read('css/wall.css');
  assert.match(css, /\.wall-tag-note \{[^}]*position: absolute;[^}]*color: var\(--text-2\); \}/, 'under the tag, grey one step up: not a trouble hue');
  assert.match(css, /\.wall-tag-note:empty \{ display: none; \}/);
});

test('pages: wall.html has one headline per trouble frame, as the galaxy (T46)', () => {
  const main = read('js/wall/main.js');
  assert.match(main, /import \{ bannerModel, bannerEcho \} from '\.\/galaxy\/hud\.js';/);
  assert.match(main, /frame\.update\(bannerModel\(latest, heldId\), \{ echo: bannerEcho\(latest, heldId\) \}\)/,
    'the line steps past the held problem, or drops out when it would only repeat it');
  assert.match(main, /heldId = target\[0\]\?\.id \?\? null;/, 'held: the lock\'s target, as the galaxy');
  assert.match(main, /plate\(cap\.lines\.find\(\(l\) => l\.kind === 'trouble'\)\?\.tone \?\? 'grey', ms\)/, 'the plate tone from the camera\'s arrival');
  assert.match(main, /heldId = null;\s*feedFrame\(\);\s*plate\(false, 0\);/, 'the overview: the line is the headline again');
  assert.doesNotMatch(main, /frame\.update\(model\)/, 'never the raw model');
  // The rule itself (tested with the galaxy in test/wall-galaxy-hud.test.mjs): one crit held, nothing else: it drops out.
  const model = { nodes: [
    { id: '__core', kind: 'core', status: 'crit' },
    { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'crit' },
    { id: 'hv2/storage', kind: 'room', parent: 'hv2', label: 'storage', status: 'crit', why: 'pool 97% full' },
  ] };
  assert.equal(bannerEcho(model, 'hv2/storage'), true);
  assert.equal(bannerEcho(model, null), false);
});

test('pages: the galaxy fallback lands on islands with tiles, not radial', () => {
  assert.equal(new URLSearchParams(fallbackHref('?demo=1').split('?')[1]).get('variant'), FALLBACK_VARIANT);
  const p = pickVariant(fallbackHref('?demo=1').split('?')[1]);
  assert.equal(p.id, 'islands-tiles');
  assert.equal(p.demo, true);
  assert.equal(p.variant.links, 'focus');
  assert.equal(p.variant.optionsFor, islandsTiles.optionsFor);
  assert.equal(mapOptionsFor(p.variant, 1.5).edgeLabels, false);
  assert.ok(VARIANTS.findIndex((v) => v.id === 'radial') === 0, 'radial stays first and the default');
  const main = read('js/wall/main.js');
  assert.match(main, /pick\.variant\.links === 'focus'/);
  assert.match(main, /focusLinks\(model, heldSite\)/);
  assert.match(main, /map\.update\(mapModel\(model\)\)/, 'every model goes through the link rule');
});

test('pages: the galaxy has a web manifest of its own, fullscreen and landscape', () => {
  const html = read('galaxy.html');
  const href = /<link rel="manifest" href="([^"]+)">/.exec(html)?.[1];
  assert.equal(href, '/galaxy.webmanifest');
  const m = JSON.parse(read(href.slice(1)));
  assert.equal(m.start_url, '/galaxy.html');
  assert.equal(m.id, '/galaxy.html', 'its own app, not the board\'s ("/")');
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.orientation, 'landscape');
  assert.ok(m.start_url.startsWith(m.scope), 'start_url is inside the scope');
  assert.ok(m.name && m.short_name && m.short_name.length <= 12, 'a name and a short name for the home screen');
  const theme = /<meta name="theme-color" content="([^"]+)">/.exec(html)?.[1];
  assert.equal(m.theme_color, theme, 'the page\'s theme colour');
  assert.equal(m.background_color, theme);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'the two sizes an install asks for');
  for (const i of m.icons) {
    assert.equal(i.type, 'image/png');
    assert.ok(fs.existsSync(path.join(PUBLIC, i.src)), `${i.src} exists`);
  }
  // Same rules as the board's manifest: the same keys and nothing the board does not know.
  const board = JSON.parse(read('manifest.webmanifest'));
  for (const k of Object.keys(m)) assert.ok(k in board || k === 'id', `${k} is a key the board's manifest uses`);
  assert.ok(!read('wall.html').includes('rel="manifest"'), 'wall.html stays a plain page');
});
