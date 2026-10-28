// The context chip's row (cockpit spec c3-see.md §9 "The chip", c1-talk.md §1.1; D65, D133):
// public/js/cockpit/chip.js on the fake DOM. The rects in the stack are S-C1-34's
// (e2e/cockpit/c1-stack.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { chipFrom, createChipRow } from '../public/js/cockpit/chip.js';

function row() {
  const calls = { change: 0 };
  const r = createChipRow({ doc: makeDocument(), onChange: () => { calls.change += 1; } });
  return { r, calls };
}

const chipOf = (r) => r.node.children[0];
const removeOf = (r) => chipOf(r).children.at(-1);

test('chipFrom: an id is needed, the label falls back to it, the kind is optional', () => {
  assert.equal(chipFrom(null), null);
  assert.equal(chipFrom({}), null);
  assert.equal(chipFrom({ id: '' }), null);
  assert.equal(chipFrom({ id: 7 }), null);
  assert.deepEqual(chipFrom({ id: 'room-b', label: 'vm-b', kind: 'room' }), { id: 'room-b', label: 'vm-b', kind: 'room' });
  assert.deepEqual(chipFrom({ id: 'vm-b' }), { id: 'vm-b', label: 'vm-b', kind: '' });
});

test('the row is hidden and empty until a chip is set', () => {
  const { r, calls } = row();
  assert.equal(r.node.hidden, true);
  assert.equal(r.node.children.length, 0);
  assert.equal(r.current(), null);
  assert.equal(r.set({}), false, 'no id: nothing drawn');
  assert.equal(r.node.hidden, true);
  assert.equal(calls.change, 0);
});

test('a chip reads ABOUT, the label and the kind, then the ✕ with its name (c3-see.md §9)', () => {
  const { r, calls } = row();
  assert.equal(r.set({ id: 'room-b', label: 'vm-b', kind: 'room' }), true);
  assert.equal(r.node.hidden, false);
  assert.equal(calls.change, 1);
  const chip = chipOf(r);
  assert.equal(chip.attrs['data-cockpit-chip'], '');
  assert.equal(chip.attrs['data-node'], 'room-b');
  assert.deepEqual(chip.children.map((c) => c.textContent), ['ABOUT', 'vm-b', 'room', '✕']);
  const remove = removeOf(r);
  assert.equal(remove.tagName, 'BUTTON');
  assert.equal(remove.attrs['data-cockpit-chip-remove'], '');
  assert.equal(remove.attrs['aria-label'], 'Remove context');
  assert.equal(remove.attrs.type, 'button');
  assert.deepEqual(r.current(), { id: 'room-b', label: 'vm-b', kind: 'room' });
});

test('one chip at a time (D65): a second replaces the first', () => {
  const { r, calls } = row();
  r.set({ id: 'room-b', label: 'vm-b', kind: 'room' });
  r.set({ id: 'backup', label: 'backup', kind: 'room' });
  assert.equal(r.node.children.length, 1);
  assert.equal(chipOf(r).attrs['data-node'], 'backup');
  assert.equal(calls.change, 2);
});

test('clear() takes the chip away once, and the row hides', () => {
  const { r, calls } = row();
  r.set({ id: 'vm-b', label: 'vm-b', kind: 'room' });
  r.clear();
  assert.equal(r.node.hidden, true);
  assert.equal(r.node.children.length, 0);
  assert.equal(r.current(), null);
  r.clear();
  assert.equal(calls.change, 2, 'a second clear changes nothing');
});

test('a label is text, never markup', () => {
  const { r } = row();
  r.set({ id: 'x', label: '<img src=x onerror=alert(1)>', kind: '' });
  const chip = chipOf(r);
  assert.equal(chip.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(chip.children[1].innerHTML, '');
  assert.deepEqual(chip.children.map((c) => c.textContent), ['ABOUT', '<img src=x onerror=alert(1)>', '✕'], 'no kind: no kind span');
});
