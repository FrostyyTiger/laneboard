// The error ends of a turn (cockpit spec c1-talk.md §10): public/js/cockpit/errors.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutDetail, endButtons, endText, retryingText, DETAIL_MAX, GO_ON_TEXT } from '../public/js/cockpit/errors.js';

const TZ = 'Europe/Zurich';
const NOW = Date.parse('2026-10-27T07:05:00+01:00');
const opts = { nowMs: NOW, timeZone: TZ };

test('each error end has its exact message (c1-talk.md §10)', () => {
  assert.equal(endText({ code: 'failed', detail: 'overloaded' }, opts), 'The answer failed: overloaded.');
  assert.equal(endText({ code: 'step-limit', steps: 40 }, opts), "Stopped after 40 steps, the agent's limit.");
  assert.equal(endText({ code: 'not-logged-in' }, opts), 'The agent is not logged in on the room. Log it in there, then send again.');
  assert.equal(endText({ code: 'agent-down', detail: 'claude: command not found' }, opts),
    'The agent cannot start: claude: command not found. The room tries again every 30 s.');
  assert.equal(endText({ code: 'something-new', detail: 'x' }, opts), 'The answer failed: x.');
});

test('E2 reads the stop as an event, then the agent back, the clock only (D232)', () => {
  const end = { code: 'agent-exited', at: '2026-10-27T07:04:00+01:00' };
  assert.equal(endText(end, opts), 'The agent stopped unexpectedly at 07:04. The room is starting it again.');
  assert.equal(endText(end, { ...opts, back: true }), 'The agent is back (07:04). Your last message was not answered.');
  const late = { code: 'agent-exited', at: '2026-10-26T23:58:00+01:00' };
  assert.equal(endText(late, opts), 'The agent stopped unexpectedly yesterday at 23:58. The room is starting it again.');
  assert.equal(endText(late, { ...opts, back: true }), 'The agent is back (yesterday 23:58). Your last message was not answered.');
  // The room's time moved onto the page's clock (build B200).
  assert.equal(endText(end, { ...opts, offset: 60_000 }), 'The agent stopped unexpectedly at 07:05. The room is starting it again.');
});

test('a detail of 300 characters shows its first 120', () => {
  const d = 'abcdefghij'.repeat(30);
  assert.equal(cutDetail(d), d.slice(0, DETAIL_MAX));
  assert.equal(endText({ code: 'failed', detail: d }, opts), `The answer failed: ${d.slice(0, 120)}.`);
  assert.equal(cutDetail('short'), 'short');
  assert.equal([...cutDetail('é'.repeat(200))].length, 120);
});

test('the buttons per code: E2 RETRY only once back, E7 GO ON, E3 and E4 none', () => {
  assert.deepEqual(endButtons('agent-exited'), []);
  assert.deepEqual(endButtons('agent-exited', true), ['RETRY']);
  assert.deepEqual(endButtons('failed'), ['RETRY']);
  assert.deepEqual(endButtons('step-limit'), ['GO ON']);
  assert.deepEqual(endButtons('not-logged-in'), []);
  assert.deepEqual(endButtons('agent-down'), []);
  assert.equal(GO_ON_TEXT, 'Go on.');
});

test("E5's row", () => {
  assert.equal(retryingText({ attempt: 2, of: 10 }), 'the model service is busy, retrying (2 of 10)');
});
