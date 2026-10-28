// A new conversation in the pane (cockpit spec c1-talk.md §11, protocols.md §3.6; D36):
// public/js/cockpit/newconv.js on the fake DOM. The page-level rects and timings are
// S-C1-22's (e2e/cockpit/c1-session.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { createDivider, createNewBar, dividerText, NEWBAR_TEXT, FORCED_TAIL } from '../public/js/cockpit/newconv.js';
import { NEWBAR_MS } from '../public/js/core/cockpit-constants.js';

const TZ = 'Europe/Zurich';
const AT = '2026-10-27T07:10:00+01:00';

/** A hand-run timer: `fire()` runs what is due. */
function timers() {
  const t = { pending: new Map(), next: 1 };
  t.set = (fn, ms) => { const id = t.next++; t.pending.set(id, { fn, ms }); return id; };
  t.clear = (id) => { t.pending.delete(id); };
  t.fire = () => { const all = [...t.pending]; t.pending.clear(); for (const [, x] of all) x.fn(); };
  return t;
}

function bar() {
  const t = timers();
  const calls = { start: 0, hide: [] };
  const b = createNewBar({
    doc: makeDocument(), setTimer: t.set, clearTimer: t.clear,
    onStart: () => { calls.start += 1; }, onHide: (h) => calls.hide.push(h),
  });
  return { b, t, calls };
}

test('the divider reads NEW CONVERSATION · HH:MM, the forced one with its tail (c1-talk.md §11)', () => {
  const ms = Date.parse(AT);
  assert.equal(dividerText('owner', ms, TZ), 'NEW CONVERSATION · 07:10');
  assert.equal(dividerText('forced', ms, TZ), 'NEW CONVERSATION · 07:10 · THE OLD ONE COULD NOT GO ON');
  assert.equal(FORCED_TAIL, ' · THE OLD ONE COULD NOT GO ON');
});

test("the divider row takes the room's `at` onto the page's clock and names its reason", () => {
  const doc = makeDocument();
  const row = createDivider(doc, { type: 'conversation.new', conversation: 'c-0008', reason: 'forced', at: AT }, 0);
  assert.equal(row.getAttribute('data-cockpit-divider'), 'forced');
  assert.match(row.textContent, /^NEW CONVERSATION · \d\d:\d\d · THE OLD ONE COULD NOT GO ON$/);
  const owner = createDivider(doc, { reason: 'owner', at: AT }, 0);
  assert.equal(owner.getAttribute('data-cockpit-divider'), 'owner');
  // A page clock 2 min ahead of the room's: the time moves with it (c1-talk.md §9).
  const a = createDivider(doc, { reason: 'owner', at: AT }, 0).textContent.slice(-5);
  const b = createDivider(doc, { reason: 'owner', at: AT }, 120_000).textContent.slice(-5);
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  assert.equal(((bh * 60 + bm) - (ah * 60 + am) + 1440) % 1440, 2);
});

test('the bar: hidden at first, the question, START then KEEP (KEEP the rightmost)', () => {
  const { b } = bar();
  assert.equal(b.isShown(), false);
  assert.equal(b.node.hidden, true);
  assert.equal(b.node.getAttribute('data-cockpit-newbar'), '');
  const [text, start, keep] = b.node.children;
  assert.equal(text.textContent, NEWBAR_TEXT);
  assert.equal(NEWBAR_TEXT, 'Start a new conversation? Cards, jobs and notes stay.');
  assert.equal(start.getAttribute('data-newbar'), 'start');
  assert.equal(start.textContent, 'START');
  assert.equal(keep.getAttribute('data-newbar'), 'keep');
  assert.equal(keep.textContent, 'KEEP');
});

test('NEW shows it; a second NEW, KEEP or 10 s without a tap hide it and nothing is sent (D36)', () => {
  const { b, t, calls } = bar();
  b.toggle();
  assert.equal(b.isShown(), true);
  assert.deepEqual([...t.pending.values()].map((x) => x.ms), [NEWBAR_MS]);
  assert.equal(NEWBAR_MS, 10_000);
  b.toggle();
  assert.equal(b.isShown(), false);
  assert.equal(t.pending.size, 0, 'the 10 s timer goes with the bar');
  b.toggle();
  b.keep();
  assert.equal(b.isShown(), false);
  b.toggle();
  t.fire();
  assert.equal(b.isShown(), false);
  assert.equal(calls.start, 0);
  assert.deepEqual(calls.hide, [false, true, false, true, false, true]);
});

test('START hides the bar and starts once; a START with the bar hidden does nothing', () => {
  const { b, t, calls } = bar();
  b.start();
  assert.equal(calls.start, 0);
  b.show();
  b.start();
  assert.equal(calls.start, 1);
  assert.equal(b.isShown(), false);
  assert.equal(t.pending.size, 0);
  b.start();
  assert.equal(calls.start, 1);
});

test('hide() on a hidden bar and show() on a shown one change nothing but the 10 s count', () => {
  const { b, t, calls } = bar();
  b.hide();
  assert.deepEqual(calls.hide, []);
  b.show();
  b.show();
  assert.equal(t.pending.size, 1, 'one timer, started again');
  assert.deepEqual(calls.hide, [false]);
});
