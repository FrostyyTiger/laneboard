// A dead feed, the state (Wall plan night 3 T5, README §7 Night 3 B):
// galaxy/fresh.js on a fake clock, and galaxy/main.js stamping every map frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FRESH, ageText, freshness, sameFresh } from '../public/js/wall/galaxy/fresh.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('stale after 30 s without a frame: three of the hub\'s 10 s resends missed', () => {
  assert.equal(FRESH.staleMs, 30000);
});

test('ageText: tens of seconds, then minutes, then hours', () => {
  assert.equal(ageText(0), '0S');
  assert.equal(ageText(34_999), '30S');
  assert.equal(ageText(59_999), '50S');
  assert.equal(ageText(60_000), '1M');
  assert.equal(ageText(150_000), '2M');
  assert.equal(ageText(59 * 60_000 + 59_000), '59M');
  assert.equal(ageText(2 * 3600_000 + 5), '2H');
  assert.equal(ageText(-5), '0S');
  assert.equal(ageText(NaN), '0S');
});

test('a fake clock walks live → stale at 30 s → the age growing → live on the next frame', () => {
  let now = 1_000_000;
  let last = now;
  const at = () => freshness(last, now, { open: true });

  assert.deepEqual(at(), { state: 'live', ageMs: 0, text: 'LIVE', line: '' });
  now += 29_999;
  assert.equal(at().state, 'live');
  assert.equal(at().line, '');
  now += 1;
  assert.deepEqual(at(), { state: 'stale', ageMs: 30_000, text: 'STALE 30S', line: 'no new data for 30s' });
  now += 30_000;
  assert.equal(at().text, 'STALE 1M');
  now += 60_000;
  assert.equal(at().text, 'STALE 2M');
  assert.equal(at().line, 'no new data for 2m');
  // The next frame: live at once.
  last = now;
  assert.deepEqual(at(), { state: 'live', ageMs: 0, text: 'LIVE', line: '' });
});

test('a closed socket is dead: OFFLINE at once, with the age once the data is old', () => {
  const t0 = 5_000;
  assert.deepEqual(freshness(t0, t0 + 2_000, { open: false }), { state: 'dead', ageMs: 2_000, text: 'OFFLINE', line: '' });
  assert.deepEqual(freshness(t0, t0 + 95_000, { open: false }), { state: 'dead', ageMs: 95_000, text: 'OFFLINE 1M', line: 'no new data for 1m' });
});

test('before the first frame there is no age: LIVE or OFFLINE, never stale', () => {
  assert.deepEqual(freshness(null, 9e12, { open: true }), { state: 'live', ageMs: null, text: 'LIVE', line: '' });
  assert.deepEqual(freshness(null, 9e12, { open: false }), { state: 'dead', ageMs: null, text: 'OFFLINE', line: '' });
});

test('sameFresh: equal when the tag and the line read the same, whatever the age', () => {
  const a = freshness(0, 31_000);
  const b = freshness(0, 38_000);
  assert.ok(sameFresh(a, b), 'both STALE 30S');
  assert.ok(!sameFresh(a, freshness(0, 41_000)));
  assert.ok(!sameFresh(a, null));
});

test('galaxy/main.js stamps every map frame and the first /api/map answer, and says the state each second', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /from '\.\/fresh\.js'/);
  assert.match(js, /if \(msg\?\.type === 'map'\) \{ frameCame\(\); showModel\(msg\.map\); \}/);
  assert.match(js, /if \(!have && m\) \{ frameCame\(\); showModel\(m\); \}/);
  assert.match(js, /freshness\(lastFrameAt, Date\.now\(\), \{ open \}\)/);
  assert.match(js, /setInterval\(/);
  assert.match(js, /page\.dataset\.fresh = f\.state/);
  assert.match(js, /hud\.fresh\(f\)/);
  // The socket's close says it at once.
  assert.match(js, /addEventListener\('close', \(\) => \{[^}]*open = false;\s*sayFresh\(\);/);
});
