// Icon sprite and icons.js helper (fleet D2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spritePath = path.join(root, 'public/vendor/lucide/sprite.svg');
const licensePath = path.join(root, 'public/vendor/lucide/LICENSE');
const sprite = fs.readFileSync(spritePath, 'utf8');
const table = JSON.parse(fs.readFileSync(path.join(root, 'scripts/icons.json'), 'utf8'));

const { ICONS, SPRITE, icon, iconMarkup, iconName } = await import('../public/js/core/icons.js');
const { svgBody, buildSprite } = await import('../scripts/build-sprite.mjs');

const symbolIds = [...sprite.matchAll(/<symbol\b[^>]*\bid="i-([^"]+)"/g)].map((m) => m[1]);

// Minimal SVG DOM double: records namespace, attributes, children and textContent.
function fakeDocument() {
  const make = (ns, tag) => ({
    ns, tagName: tag, attrs: new Map(), children: [], textContent: '',
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    hasAttribute(k) { return this.attrs.has(k); },
    appendChild(c) { this.children.push(c); return c; },
    get firstChild() { return this.children[0] ?? null; },
    set innerHTML(_v) { throw new Error('innerHTML used'); },
  });
  return { createElementNS: (ns, tag) => make(ns, tag), createElement: () => { throw new Error('HTML element used'); } };
}

test('icons.js imports without a document', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(SPRITE, '/vendor/lucide/sprite.svg');
  assert.ok(Object.isFrozen(ICONS));
});

test('ICONS matches scripts/icons.json and the lucide-static version is pinned', () => {
  assert.deepEqual([...ICONS].sort(), Object.keys(table.icons).sort());
  assert.match(table.lucideStatic, /^\d+\.\d+\.\d+$/, 'exact version, no range');
});

test('every ICONS entry has a <symbol id="i-…"> in the sprite and vice versa', () => {
  assert.equal(new Set(symbolIds).size, symbolIds.length, 'no duplicate symbol ids');
  assert.deepEqual([...symbolIds].sort(), [...ICONS].sort());
});

test('no symbol carries stroke=/fill= on its root; each has the 24x24 viewBox', () => {
  const roots = [...sprite.matchAll(/<symbol\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(roots.length, ICONS.length);
  for (const r of roots) {
    assert.doesNotMatch(r, /\s(stroke(-[a-z]+)?|fill)=/, r);
    assert.match(r, /viewBox="0 0 24 24"/, r);
  }
  // Nothing in the sprite overrides the .i styling either.
  assert.doesNotMatch(sprite, /\s(stroke(-[a-z]+)?|fill)=/);
  assert.doesNotMatch(sprite, /<script|\son[a-z]+=|href=|<foreignObject/i, 'sprite is plain geometry');
});

test('LICENSE exists, is ISC and names the pinned version; sprite is under 40 KB', () => {
  const lic = fs.readFileSync(licensePath, 'utf8');
  assert.match(lic, /ISC License/);
  assert.ok(lic.includes(`lucide-static v${table.lucideStatic}`));
  assert.ok(sprite.includes(`lucide-static v${table.lucideStatic}`));
  assert.ok(fs.statSync(spritePath).size < 40 * 1024, 'sprite under 40 KB');
});

test('icon() builds an aria-hidden SVG with a <use> into the sprite', () => {
  globalThis.document = fakeDocument();
  try {
    const s = icon('pause');
    assert.equal(s.ns, 'http://www.w3.org/2000/svg');
    assert.equal(s.tagName, 'svg');
    assert.equal(s.getAttribute('class'), 'i i-m');
    assert.equal(s.getAttribute('aria-hidden'), 'true');
    assert.equal(s.getAttribute('focusable'), 'false');
    assert.equal(s.getAttribute('role'), null);
    assert.equal(s.children.length, 1);
    assert.equal(s.children[0].tagName, 'use');
    assert.equal(s.children[0].getAttribute('href'), '/vendor/lucide/sprite.svg#i-pause');

    const l = icon('kill', { size: 'l', cls: 'danger x' });
    assert.equal(l.getAttribute('class'), 'i i-l danger x');
  } finally { delete globalThis.document; }
});

test('icon() with a label is role=img with aria-label and a <title> first child', () => {
  globalThis.document = fakeDocument();
  try {
    const s = icon('approve', { label: 'Approve', size: 's' });
    assert.equal(s.getAttribute('class'), 'i i-s');
    assert.equal(s.getAttribute('role'), 'img');
    assert.equal(s.getAttribute('aria-label'), 'Approve');
    assert.equal(s.hasAttribute('aria-hidden'), false);
    assert.equal(s.firstChild.tagName, 'title');
    assert.equal(s.firstChild.textContent, 'Approve');
    assert.equal(s.children[1].getAttribute('href'), '/vendor/lucide/sprite.svg#i-approve');
  } finally { delete globalThis.document; }
});

test('icon() output is safe with hostile input', () => {
  globalThis.document = fakeDocument();
  const warn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const evil = '"><img src=x onerror=alert(1)>';
    const s = icon(evil, { label: evil, cls: `ok ${evil} also-ok`, size: '"><x' });
    // Unknown name: falls back to 'alarm', the href never carries the input.
    assert.equal(s.children.at(-1).getAttribute('href'), '/vendor/lucide/sprite.svg#i-alarm');
    // Label lands only as attribute value / text node, never parsed.
    assert.equal(s.getAttribute('aria-label'), evil);
    assert.equal(s.firstChild.textContent, evil);
    // Class tokens that are not plain identifiers are dropped; bad size falls back to m.
    assert.equal(s.getAttribute('class'), 'i i-m ok also-ok');
    // Warned once per unknown name, never throws.
    icon(evil); icon(undefined);
    assert.equal(warnings.filter((w) => w.includes('img src')).length, 1);
    assert.equal(iconName(null), 'alarm');
    assert.equal(iconName('__proto__'), 'alarm');
  } finally { console.warn = warn; delete globalThis.document; }
});

test('iconMarkup() only ever emits fixed markup for known names', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(iconMarkup('map'), '<svg class="i i-m" aria-hidden="true" focusable="false"><use href="/vendor/lucide/sprite.svg#i-map"/></svg>');
    assert.equal(iconMarkup('<script>'), iconMarkup('alarm'));
  } finally { console.warn = warn; }
});

test('icons.js uses no HTML string sinks in icon()', () => {
  const src = fs.readFileSync(path.join(root, 'public/js/core/icons.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|DOMParser/);
});

test('build-sprite strips stroke/fill and exits non-zero on a missing Lucide name', () => {
  assert.equal(
    svgBody('<!-- c -->\n<svg width="24" fill="none" stroke="currentColor" stroke-width="2">\n  <path d="M1 1" stroke-linecap="round" />\n  <circle cx="1" fill="red" />\n</svg>'),
    '<path d="M1 1" /><circle cx="1" />',
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-icons-'));
  try {
    fs.writeFileSync(path.join(dir, 'map.svg'), '<svg fill="none"><path d="M0 0"/></svg>');
    const one = { lucideStatic: '0.0.0', icons: { map: 'map' } };
    assert.match(buildSprite(dir, one), /<symbol id="i-map" viewBox="0 0 24 24"><path d="M0 0"\/><\/symbol>/);
    assert.throws(() => buildSprite(dir, { lucideStatic: '0.0.0', icons: { map: 'map', filter: 'filter' } }), /filter -> filter/);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/build-sprite.mjs'), dir], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing lucide icons/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
