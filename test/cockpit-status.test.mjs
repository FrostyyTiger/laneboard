// The pane's status line (public/js/cockpit/status.js; spec c1-talk.md §10.1, screens.md §7, §7.1,
// D152, D232): which row holds, and the room-down and back texts S-SCR-17..19 read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStatus, statusText, hasAge, STATUS_ROWS } from '../public/js/cockpit/status.js';

const TZ = 'Europe/Zurich';
const LOSS = Date.parse('2026-10-28T06:41:00+01:00');

test('status: room-down counts its minutes and the whole seconds to the next try, rounded up (screens.md §7, §7.1)', () => {
  const row = (retryAt, trying = false) => ({ code: 'room-down', since: LOSS, retryAt, trying });
  assert.equal(statusText(row(LOSS + 5_436), LOSS + 5_000, TZ), 'Cockpit room unreachable since 06:41 (0 min). Retrying in 1 s.');
  assert.equal(statusText(row(LOSS + 50_133), LOSS + 35_200, TZ), 'Cockpit room unreachable since 06:41 (0 min). Retrying in 15 s.');
  assert.equal(statusText(row(LOSS + 65_133), LOSS + 60_000, TZ), 'Cockpit room unreachable since 06:41 (1 min). Retrying in 6 s.');
  assert.equal(statusText(row(LOSS + 1_000), LOSS + 1_000, TZ), 'Cockpit room unreachable since 06:41 (0 min). Retrying in 0 s.');
  // RETRY NOW (D220): `Retrying now…` while the try runs.
  assert.equal(statusText(row(null, true), LOSS + 8_436, TZ), 'Cockpit room unreachable since 06:41 (0 min). Retrying now…');
  // No try scheduled (a refused link): the head only.
  assert.equal(statusText(row(null), LOSS + 3 * 60_000, TZ), 'Cockpit room unreachable since 06:41 (3 min).');
  // Since the evening before: the day and the age (README.md "Times on the screen").
  const evening = Date.parse('2026-10-27T22:10:00+01:00');
  assert.equal(statusText({ code: 'room-down', since: evening, retryAt: null, trying: false }, LOSS, TZ),
    'Cockpit room unreachable since yesterday 22:10 (8 h 31).');
});

test('status: `Back since` is the clock only, no age (screens.md §7 "Back")', () => {
  assert.equal(statusText({ code: 'back', at: LOSS + 65_200 }, LOSS + 67_000, TZ), 'Back since 06:42.');
});

test('status: offline outranks room-down, room-down outranks the room\'s rows and back (c1-talk.md §10.1)', () => {
  const roomDown = { since: LOSS, retryAt: LOSS + 900, trying: false };
  const room = { code: 'agent-down', since: '2026-10-28T06:30:00+01:00' };
  const back = { at: LOSS };
  assert.equal(pickStatus({ offline: { since: LOSS }, roomDown, room, back }).code, 'offline');
  assert.deepEqual(pickStatus({ roomDown, room, back }), { code: 'room-down', ...roomDown });
  assert.equal(pickStatus({ room, back }).code, 'agent-down');
  assert.deepEqual(pickStatus({ back }), { code: 'back', at: LOSS });
  assert.equal(pickStatus({}), null);
  // A room row this screen does not draw from the room (offline, room-down, back) is ignored.
  assert.equal(pickStatus({ room: { code: 'room-down', since: '2026-10-28T06:30:00+01:00' } }), null);
  assert.deepEqual(STATUS_ROWS.slice(0, 2), ['offline', 'room-down']);
});

test('status: the rows with an age are redrawn every second; back is not', () => {
  assert.equal(hasAge({ code: 'room-down' }), true);
  assert.equal(hasAge({ code: 'offline' }), true);
  assert.equal(hasAge({ code: 'back' }), false);
  assert.equal(hasAge(null), false);
});
