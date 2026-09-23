import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldNotify } from '../server/push.mjs';

const MIN = 60_000;
const base = { name: 'kubic', now: 1_000_000_000 };

test('a permission prompt always notifies', () => {
  const r = shouldNotify({ ...base, from: 'working', to: 'waiting_permission' });
  assert.equal(r.notify, true);
  assert.equal(r.title, 'Needs permission');
});

test('a question always notifies', () => {
  const r = shouldNotify({ ...base, from: 'working', to: 'waiting_question' });
  assert.equal(r.notify, true);
  assert.equal(r.title, 'Needs an answer');
});

test('finishing notifies only after at least 5 minutes of work', () => {
  // The point of the rule: a two-second tool call is not worth a buzz.
  assert.equal(shouldNotify({ ...base, from: 'working', to: 'done', workingForMs: 4 * MIN }).notify, false);
  assert.equal(shouldNotify({ ...base, from: 'working', to: 'done', workingForMs: 5 * MIN }).notify, true);
  assert.equal(shouldNotify({ ...base, from: 'working', to: 'done', workingForMs: 90 * MIN }).notify, true);
});

test('the reason for a suppressed finish is explicit', () => {
  assert.equal(
    shouldNotify({ ...base, from: 'working', to: 'done', workingForMs: 10 }).reason,
    'finished too quickly'
  );
});

test('states nobody needs to act on never notify', () => {
  for (const to of ['working', 'idle', 'shell', 'dead']) {
    assert.equal(shouldNotify({ ...base, from: 'done', to }).notify, false, to);
  }
});

test('a non-transition never notifies', () => {
  const r = shouldNotify({ ...base, from: 'waiting_permission', to: 'waiting_permission' });
  assert.equal(r.notify, false);
  assert.equal(r.reason, 'no transition');
});

test('notifications coalesce to one per session per 60 s', () => {
  const first = shouldNotify({ ...base, from: 'working', to: 'waiting_permission', lastAt: null });
  assert.equal(first.notify, true);

  const tooSoon = shouldNotify({
    ...base, from: 'working', to: 'waiting_permission', lastAt: base.now - 59_000,
  });
  assert.equal(tooSoon.notify, false);
  assert.equal(tooSoon.reason, 'coalesced');

  const later = shouldNotify({
    ...base, from: 'working', to: 'waiting_permission', lastAt: base.now - 61_000,
  });
  assert.equal(later.notify, true);
});

test('coalescing applies to the finished notification too', () => {
  const r = shouldNotify({
    ...base, from: 'working', to: 'done', workingForMs: 30 * MIN, lastAt: base.now - 1000,
  });
  assert.equal(r.notify, false);
  assert.equal(r.reason, 'coalesced');
});

test('quiet wins over everything, including a permission prompt', () => {
  const r = shouldNotify({ ...base, from: 'working', to: 'waiting_permission', quiet: true });
  assert.equal(r.notify, false);
  assert.equal(r.reason, 'quiet');
});

test('a session that goes straight from idle to waiting still notifies', () => {
  // Not every waiting_permission is preceded by working — a resumed session
  // can prompt immediately.
  assert.equal(shouldNotify({ ...base, from: 'idle', to: 'waiting_permission' }).notify, true);
  assert.equal(shouldNotify({ ...base, from: 'shell', to: 'waiting_question' }).notify, true);
});

test('done reached from a non-working state does not use a stale work timer', () => {
  // workingForMs is only meaningful when the previous state was `working`;
  // callers pass 0 otherwise, which must suppress the notification.
  assert.equal(shouldNotify({ ...base, from: 'idle', to: 'done', workingForMs: 0 }).notify, false);
});
