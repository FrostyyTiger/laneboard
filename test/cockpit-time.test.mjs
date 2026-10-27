// The cockpit's time module (spec README.md "Times on the screen", D232):
// the table's 13 rows with timeZone Europe/Zurich, then the same rows with
// timeZone unset under TZ=Europe/Zurich (the page's path), in a child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { clockText, ageText, sinceText, atText, hhmm } from '../public/js/core/cockpit-time.js';

const TZ = 'Europe/Zurich';
const NOW = Date.parse('2026-10-27T07:30:00+01:00');
// [ms, clockText, ageText, atText]
const ROWS = [
  ['2026-10-27T07:30:00+01:00', '07:30', '(0 min)', 'at 07:30'],
  ['2026-10-27T07:29:01+01:00', '07:29', '(0 min)', 'at 07:29'],
  ['2026-10-27T06:41:00+01:00', '06:41', '(49 min)', 'at 06:41'],
  ['2026-10-27T06:30:00+01:00', '06:30', '(1 h 00)', 'at 06:30'],
  ['2026-10-27T06:18:00+01:00', '06:18', '(1 h 12)', 'at 06:18'],
  ['2026-10-27T00:00:00+01:00', '00:00', '(7 h 30)', 'at 00:00'],
  ['2026-10-26T22:10:00+01:00', 'yesterday 22:10', '(9 h 20)', 'yesterday at 22:10'],
  ['2026-10-26T07:31:00+01:00', 'yesterday 07:31', '(23 h 59)', 'yesterday at 07:31'],
  ['2026-10-26T06:00:00+01:00', 'yesterday 06:00', '(1 d 1 h)', 'yesterday at 06:00'],
  ['2026-10-25T22:10:00+01:00', '25 Oct 22:10', '(1 d 9 h)', 'on 25 Oct at 22:10'],
  ['2026-10-01T09:00:00+02:00', '1 Oct 09:00', '(25 d 23 h)', 'on 1 Oct at 09:00'],
  ['2026-10-27T07:31:00+01:00', '07:31', '(0 min)', 'at 07:31'],
];
const MIDNIGHT = { now: '2026-10-28T00:00:30+01:00', ms: '2026-10-27T23:50:00+01:00', clock: 'yesterday 23:50', age: '(10 min)' };

test('cockpit-time: the 13 rows of the table, timeZone Europe/Zurich', () => {
  for (const [iso, clock, age, at] of ROWS) {
    const ms = Date.parse(iso);
    assert.equal(clockText(ms, NOW, TZ), clock, iso);
    assert.equal(ageText(ms, NOW), age, iso);
    assert.equal(atText(ms, NOW, TZ), at, iso);
  }
  assert.equal(clockText(Date.parse(MIDNIGHT.ms), Date.parse(MIDNIGHT.now), TZ), MIDNIGHT.clock);
  assert.equal(ageText(Date.parse(MIDNIGHT.ms), Date.parse(MIDNIGHT.now)), MIDNIGHT.age);
  assert.equal(sinceText(Date.parse('2026-10-27T06:41:00+01:00'), NOW, TZ), 'since 06:41 (49 min)');
  assert.equal(hhmm(Date.parse('2026-10-27T07:02:59+01:00'), TZ), '07:02');
});

test('cockpit-time: the same rows with timeZone unset under TZ=Europe/Zurich (the page\'s path)', () => {
  const mod = pathToFileURL(path.resolve(import.meta.dirname, '..', 'public', 'js', 'core', 'cockpit-time.js')).href;
  const rows = [...ROWS.map(([iso]) => [iso, NOW]), [MIDNIGHT.ms, Date.parse(MIDNIGHT.now)]];
  const src = `import(${JSON.stringify(mod)}).then((m) => { const rows = ${JSON.stringify(rows)};
    process.stdout.write(JSON.stringify(rows.map(([iso, now]) => [m.clockText(Date.parse(iso), now), m.atText(Date.parse(iso), now)]))); });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: { ...process.env, TZ }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  const want = [...ROWS.map(([, clock, , at]) => [clock, at]), [MIDNIGHT.clock, 'yesterday at 23:50']];
  assert.deepEqual(got, want);
});
