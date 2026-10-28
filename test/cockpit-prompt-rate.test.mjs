// The room's prompt rate (server/cockpit/prompt-rate.mjs; spec c1-talk.md §7
// "Rate", screens.md §6.4; D228, D165): 10 prompts per key in the 60 s before
// each prompt, a refused prompt not counted, one refusal line per key per
// minute and the rest counted into the next line. The link's use of it is in
// test/cockpit-link.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptRate, RATE_MAX, RATE_WINDOW_MS, REFUSAL_LINE_MS } from '../server/cockpit/prompt-rate.mjs';

const T0 = Date.parse('2026-10-27T07:00:00+01:00');
function at(ms = 0) {
  const c = { t: T0 + ms, now: () => c.t, to(m) { c.t = T0 + m; } };
  return c;
}

test('prompt rate: the constants are the spec\'s (c1-talk.md §16, D228, D165)', () => {
  assert.equal(RATE_MAX, 10);
  assert.equal(RATE_WINDOW_MS, 60_000);
  assert.equal(REFUSAL_LINE_MS, 60_000);
  assert.throws(() => createPromptRate({}), /now/);
});

test('prompt rate: 10 in the 60 s before a prompt, the 11th refused; one more once the first is older than 60 s', () => {
  const c = at();
  const rate = createPromptRate({ now: c.now });
  for (let i = 0; i < 10; i++) {
    c.to(i * 2_000);
    assert.ok(rate.take('board'), `prompt ${i + 1} at ${i * 2} s`);
  }
  c.to(20_000);
  assert.equal(rate.take('board'), null, 'the 11th');
  c.to(59_999);
  assert.equal(rate.take('board'), null, 'the first is 59.999 s old: still inside');
  c.to(60_000);
  assert.ok(rate.take('board'), 'exactly 60 s old is out of the window (B233)');
  assert.equal(rate.take('board'), null, 'and the window is full again');
});

test('prompt rate: a refused prompt is not counted; a slot given back frees its place (D228)', () => {
  const c = at();
  const rate = createPromptRate({ now: c.now });
  for (let i = 0; i < 9; i++) rate.take('board');
  const tenth = rate.take('board');
  assert.ok(tenth);
  assert.equal(rate.take('board'), null);
  rate.giveBack(tenth); // e.g. agent-down after it was counted
  assert.ok(rate.take('board'), 'its place is free');
  rate.giveBack(null);
  rate.giveBack({ key: 'other', at: 1 }); // unknown: nothing happens
  assert.equal(rate.take('board'), null);
});

test('prompt rate: each key has its own 10', () => {
  const rate = createPromptRate({ now: at().now });
  for (let i = 0; i < 10; i++) rate.take('screen:desk');
  assert.equal(rate.take('screen:desk'), null);
  assert.ok(rate.take('screen:desk2'));
});

test('refusal lines: the first of the minute is a line, the rest are held for the next line (D165)', () => {
  const c = at();
  const rate = createPromptRate({ now: c.now });
  assert.deepEqual(rate.refusal('board'), { line: true });
  assert.equal(rate.takeHeld('board'), 0, 'nothing held by the line itself');
  c.to(5_000);
  assert.deepEqual(rate.refusal('board'), { line: false });
  c.to(59_999);
  assert.deepEqual(rate.refusal('board'), { line: false });
  assert.deepEqual(rate.refusal('screen:desk2'), { line: true }, 'per key');
  c.to(60_000);
  assert.deepEqual(rate.refusal('board'), { line: true }, 'a minute after the last line');
  assert.equal(rate.takeHeld('board'), 2, 'the two held ones ride on the next line');
  assert.equal(rate.takeHeld('board'), 0, 'taken once');
  rate.putBack('board', 2); // that line failed to be written
  assert.equal(rate.takeHeld('board'), 2);
  rate.putBack('nobody', 0);
  assert.equal(rate.takeHeld('nobody'), 0);
});
