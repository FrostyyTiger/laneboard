// Night-1 bug (runs-n2 T2): the minimap stayed light in the dark theme. It
// cached readPalette(canvas) on its first frame and dropped it only on an
// `lb:theme` event, so a theme that changed any other way (or while the PiP
// was not listening) kept the old colours. These tests swap the computed
// tokens under a fake getComputedStyle and look at the background the next
// frame fills.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMinimap } from '../public/js/views/map/minimap.js';
import { SHAPE_CODE, TONE_CODE } from '../public/js/views/map/overlays.js';

const TOKENS = {
  light: { '--bg-canvas': 'LIGHT-BG', '--line': 'LIGHT-LINE' },
  dark: { '--bg-canvas': 'DARK-BG', '--line': 'DARK-LINE' },
};

/** Fake <html>, getComputedStyle and a 2d context recording each fillRect's colour. */
function setup(theme = 'light') {
  const saved = { document: globalThis.document, gcs: globalThis.getComputedStyle };
  const html = { dataset: { theme }, className: '' };
  globalThis.document = { documentElement: html };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => TOKENS[html.dataset.theme]?.[n] ?? '' });
  const fills = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === 'fillRect' ? () => fills.push(o.fillStyle) : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener() {}, removeEventListener() {} };
  let version = 1;
  const pts = new Float32Array([0, 0, SHAPE_CODE.disc, TONE_CODE.grey]);
  const mini = createMinimap(canvas, () => ({ version, pts, outer: 400 }), { now: () => 10_000, reduced: () => true });
  const restore = () => {
    mini.destroy();
    globalThis.document = saved.document;
    globalThis.getComputedStyle = saved.gcs;
  };
  return { html, fills, mini, bump: () => { version += 1; }, restore };
}

test('a theme switched without an lb:theme event: the next frame uses the dark tokens', () => {
  const t = setup('light');
  try {
    t.mini.draw(true);
    assert.equal(t.fills.at(-1), 'LIGHT-BG');
    t.html.dataset.theme = 'dark';
    t.bump();
    t.mini.draw(true);
    assert.equal(t.fills.at(-1), 'DARK-BG', 'was the cached light palette');
  } finally { t.restore(); }
});

test('start() reads the tokens of the theme it starts under', () => {
  const t = setup('light');
  try {
    t.mini.draw(true);
    t.mini.stop();
    t.html.dataset.theme = 'dark';
    t.mini.start();
    assert.equal(t.fills.at(-1), 'DARK-BG');
  } finally { t.restore(); }
});

test('the shell\'s lb:theme event repaints with the new tokens', () => {
  const t = setup('light');
  const saved = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  try {
    t.restore();
    const handlers = new Map();
    globalThis.addEventListener = (type, fn) => handlers.set(type, fn);
    globalThis.removeEventListener = () => {};
    const u = setup('light');
    try {
      u.mini.draw(true);
      u.html.dataset.theme = 'dark';
      handlers.get('lb:theme')();
      assert.equal(u.fills.at(-1), 'DARK-BG');
    } finally { u.restore(); }
  } finally {
    globalThis.addEventListener = saved.add;
    globalThis.removeEventListener = saved.remove;
  }
});

test('the palette is not re-read while the theme stays the same', () => {
  const t = setup('dark');
  let reads = 0;
  const gcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el) => { reads += 1; return gcs(el); };
  try {
    t.mini.draw(true);
    t.mini.draw(true);
    t.mini.draw(true);
    assert.equal(reads, 1);
  } finally { t.restore(); }
});
