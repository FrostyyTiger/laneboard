// A dead feed, the state (Wall plan night 3 T5, README §7 Night 3 B):
// galaxy/fresh.js on a fake clock, and galaxy/main.js stamping every map frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FRESH, SUN, ageText, easeToward, freshness, sameFresh, sunLook, swellAt } from '../public/js/wall/galaxy/fresh.js';
import { NEBULA } from '../public/js/wall/galaxy/palette.js';
import { SUN_HALO } from '../public/js/wall/galaxy/scene.js';

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

// T6: the sun says it from 3 m.
test('T6 swellAt: a soft rise to its peak after a frame, then it decays; nothing before the first frame', () => {
  assert.equal(swellAt(null), 0);
  assert.equal(swellAt(-5), 0);
  assert.equal(swellAt(0), 0);
  assert.ok(swellAt(SUN.swell.riseMs / 2) > 0 && swellAt(SUN.swell.riseMs / 2) < 1);
  assert.equal(swellAt(SUN.swell.riseMs), 1);
  let last = 1;
  for (let a = SUN.swell.riseMs + 100; a <= 5000; a += 100) {
    const v = swellAt(a);
    assert.ok(v < last, `decays at ${a} ms`);
    last = v;
  }
  assert.ok(swellAt(4000) < 0.01, 'gone well before the next 5 s resend');
});

test('T6 sunLook: one swell per frame, at rest between, stale shrinks it and turns it cold', () => {
  const rest = sunLook(9000);
  assert.ok(Math.abs(rest.scale - 1) < 1e-3 && Math.abs(rest.glow - 1) < 1e-3 && rest.cold === 0, 'at rest between frames');
  assert.deepEqual(sunLook(null), { scale: 1, glow: 1, cold: 0 }, 'before the first frame: as live');
  const peak = sunLook(SUN.swell.riseMs);
  assert.ok(peak.scale > 1.05 && peak.glow > 1.2 && peak.cold === 0, 'a frame swells the corona');
  // Each new frame starts the swell again (age back to 0).
  assert.equal(sunLook(0).scale, 1);
  assert.deepEqual(sunLook(FRESH.staleMs - 1), sunLook(FRESH.staleMs), 'nothing changes until the data is old');
  const cold = sunLook(FRESH.staleMs + SUN.cold.ms);
  assert.equal(cold.cold, 1);
  assert.ok(Math.abs(cold.scale - SUN.cold.scale) < 1e-9, 'shrunk');
  assert.ok(Math.abs(cold.glow - SUN.cold.glow) < 1e-9, 'dimmed');
  const mid = sunLook(FRESH.staleMs + SUN.cold.ms / 2);
  assert.ok(mid.cold > 0 && mid.cold < 1, 'goes cold over a moment, not a cut');
  assert.deepEqual(sunLook(FRESH.staleMs + 3600_000), cold, 'and stays cold');
});

test('T6 still mode: no swell, the cold sun only', () => {
  for (const a of [0, 100, SUN.swell.riseMs, 1000, 9000]) {
    assert.deepEqual(sunLook(a, { still: true }), { scale: 1, glow: 1, cold: 0 });
  }
  assert.deepEqual(sunLook(FRESH.staleMs + SUN.cold.ms, { still: true }), sunLook(FRESH.staleMs + SUN.cold.ms));
});

test('T6 never louder than live trouble: the swell\'s peak stays under half the crit nebula', () => {
  const peak = Math.max(...Array.from({ length: 100 }, (_, i) => sunLook(i * 20).glow));
  assert.ok(SUN_HALO * peak <= NEBULA.crit.opacity / 2, `peak halo ${SUN_HALO * peak}`);
  assert.ok(SUN_HALO * SUN.cold.glow < SUN_HALO, 'cold is dimmer than at rest');
});

test('T6 easeToward: follows without overshoot, holds on no time, jumps with no time constant', () => {
  assert.equal(easeToward(0, 1, 0, 100), 0);
  assert.equal(easeToward(0, 1, 50, 0), 1);
  const a = easeToward(0, 1, 100, 100);
  assert.ok(Math.abs(a - (1 - Math.exp(-1))) < 1e-12);
  assert.ok(easeToward(1, 0, 10_000, 100) >= 0 && easeToward(1, 0, 10_000, 100) < 1e-9);
});

test('T6 galaxy/main.js gives the scene the sun the data asks for each frame', () => {
  const main = read('js/wall/galaxy/main.js');
  assert.match(main, /galaxy\.setSun\(sunLook\(lastFrameAt == null \? null : Date\.now\(\) - lastFrameAt, \{ still: reduced \}\)\)/);
});
