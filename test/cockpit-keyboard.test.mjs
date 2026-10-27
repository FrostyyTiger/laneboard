// The on-screen keyboard's numbers (cockpit spec c1-talk.md §7.1, D130, D131):
// public/js/cockpit/keyboard.js. The layout itself is S-C1-32/33 (e2e/cockpit/c1-keyboard.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleBottom, keyboardWord, inputCap, createTallest, KEYBOARD_MIN_PX, KEYBOARD_ROW_PX, CONVO_KEEP_PX,
} from '../public/js/cockpit/keyboard.js';

test('the visible bottom: the visual viewport inside the layout one, less the virtualKeyboard rect', () => {
  // A browser that resizes the visual viewport only: 912 tall, 532 in sight.
  assert.equal(visibleBottom({ innerHeight: 912, vvTop: 0, vvHeight: 532 }), 532);
  // Scrolled visual viewport: its top plus its height, never past the layout bottom.
  assert.equal(visibleBottom({ innerHeight: 912, vvTop: 100, vvHeight: 532 }), 632);
  assert.equal(visibleBottom({ innerHeight: 912, vvTop: 500, vvHeight: 532 }), 912);
  // navigator.virtualKeyboard with overlaysContent: the viewport unchanged, the rect 380 px.
  assert.equal(visibleBottom({ innerHeight: 912, vvTop: 0, vvHeight: 912, vkHeight: 380 }), 532);
  // No visual viewport: the layout bottom.
  assert.equal(visibleBottom({ innerHeight: 912 }), 912);
});

test('data-keyboard: up from a 120 px keyboard with the input focused, held during a talk press, else down', () => {
  assert.equal(KEYBOARD_MIN_PX, 120);
  assert.equal(keyboardWord({ height: 380, focused: true }), 'up');
  assert.equal(keyboardWord({ height: 120, focused: true }), 'up');
  assert.equal(keyboardWord({ height: 119, focused: true }), 'down');
  assert.equal(keyboardWord({ height: 380, focused: false }), 'down');
  assert.equal(keyboardWord({ height: 0, focused: false, held: true }), 'held');
});

test('the input grows only while the conversation keeps 200 px: clamp(64, 64 + left − 200, 182)', () => {
  assert.equal(KEYBOARD_ROW_PX, 88);
  assert.equal(CONVO_KEEP_PX, 200);
  // 1368x532, nothing stacked: left 532 − 64 − 88 = 380 → four lines.
  assert.equal(inputCap(380), 181.6);
  // S-C1-33: the 80 px status line and a one-line note: left 268 → 132 px.
  assert.equal(inputCap(532 - 64 - 80 - 32 - 88), 132);
  // The status line, a note and a chip: left 204 → 68 px.
  assert.equal(inputCap(204), 68);
  // Less than 200 left: never under one line.
  assert.equal(inputCap(150), 64);
});

test('H: the tallest innerHeight seen at the current width; a width change resets it', () => {
  const t = createTallest();
  assert.equal(t.seen(1368, 912), 912);
  assert.equal(t.seen(1368, 532), 912);
  assert.equal(t.seen(1368, 912), 912);
  assert.equal(t.seen(912, 1368), 1368); // a rotation
  assert.equal(t.seen(912, 988), 1368);
  assert.equal(t.seen(1368, 532), 532); // back to the first width: a new count
});
