// The draft in the input row (cockpit spec c1-talk.md §7, §10 E1, D30, D271):
// public/js/cockpit/draft.js. The page-level behaviour is S-C1-14, S-C1-15 and
// S-C1-18's (e2e/cockpit/c1-typing.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inputHeight, linesFromScroll, groupDigits, lengthNote, canSend, isSendKey, restoreDraft,
  INPUT_ONE_LINE_PX, INPUT_LINE_PX,
} from '../public/js/cockpit/draft.js';

test('the input: 64 px for one line, +39.2 px a line, 181.6 px at 4 lines and above', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map(inputHeight), [64, 103.2, 142.4, 181.6, 181.6, 181.6, 181.6]);
  assert.equal(inputHeight(0), 64);
  assert.equal(inputHeight(Number.NaN), 64);
});

test('lines from scrollHeight: the padding and lines of a 1 px-bordered textarea at its one-line height', () => {
  // scrollHeight = the box less its border: 22.8 px of padding plus 39.2 px a line.
  for (const n of [1, 2, 3, 4, 6]) {
    const sh = Math.round(INPUT_ONE_LINE_PX - 2 + (n - 1) * INPUT_LINE_PX);
    assert.equal(linesFromScroll(sh, 2), n, `${n} lines`);
  }
  assert.equal(linesFromScroll(0, 0), 1, 'a hidden input counts one line');
});

test('the length note: none at or under the limit, the spec\'s words above it', () => {
  assert.equal(groupDigits(8214), '8 214');
  assert.equal(groupDigits(8000), '8 000');
  assert.equal(groupDigits(999), '999');
  assert.equal(groupDigits(1234567), '1 234 567');
  assert.equal(lengthNote(8000), null);
  assert.equal(lengthNote(0), null);
  assert.equal(lengthNote(8001), '8 001 / 8 000 CHARACTERS');
  assert.equal(lengthNote(8214), '8 214 / 8 000 CHARACTERS');
  assert.equal(lengthNote(120, 100), '120 / 100 CHARACTERS');
});

test('canSend: not white space alone, not over the limit', () => {
  assert.equal(canSend(''), false);
  assert.equal(canSend('   '), false);
  assert.equal(canSend(' \n\t'), false);
  assert.equal(canSend('how is'), true);
  assert.equal(canSend('x'.repeat(8000)), true);
  assert.equal(canSend('x'.repeat(8001)), false);
});

test('keys: Enter sends, Shift+Enter and a composing Enter do not', () => {
  assert.equal(isSendKey({ key: 'Enter' }), true);
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(isSendKey({ key: 'Enter', isComposing: true }), false);
  assert.equal(isSendKey({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(isSendKey({ key: 'a' }), false);
});

test('EDIT: the text back, a kept draft after it on a new line, the caret after the text (D271)', () => {
  assert.deepEqual(restoreDraft('restart the tour'), { value: 'restart the tour', caret: 16 });
  assert.deepEqual(restoreDraft('restart the tour', 'and hv1'), { value: 'restart the tour\nand hv1', caret: 16 });
});
