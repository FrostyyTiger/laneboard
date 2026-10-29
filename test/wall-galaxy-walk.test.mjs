// The night's touch walk, end to end (Wall plan night 5 C, T16): tap a site →
// tap a planet (its moons open) → drag-turn the system (it stays open, its
// star stays put) → tap empty sky (nothing) → tap a moon → Back three times →
// the overview. Every flight's length is asserted: a tap on a site or a planet
// flies FLIGHT.ms, a moon of the framed planet and the first two Backs keep
// the camera (0 ms), the last Back eases out in ZOOM_OUT's 3000 ms. The page:
// test/helpers/galaxy-page.mjs, the large demo wired as galaxy/main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { ZOOM_OUT } from '../public/js/wall/galaxy/director.js';
import { AT_OVERVIEW, ORBIT, TAP, memberPoints } from '../public/js/wall/galaxy/touch.js';
import { BA, SKY, flown, page, samePose } from './helpers/galaxy-page.mjs';

const near = (t, ms, what) => assert.ok(Math.abs(t - ms) <= 32, `${what}: flew ${t} ms, want ${ms}`);
const off = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the walk: site → planet → turn → empty tap → moon → Back ×3 → overview, each flight timed', () => {
  const p = page();
  const lab = () => p.galaxy.world.byId.get('lab');
  p.run(200);
  const home = p.cam.pose();

  // 1. A tap on HV1's star: FLIGHT.ms into the system, which opens.
  p.tapAt(10, p.cam.screenOf('lab'));
  assert.deepEqual([p.place().level, p.place().site], ['site', 'lab']);
  p.tick(16);
  near(16 + flown(p), FLIGHT.ms, 'site');
  p.run(OPEN_MS + 200);
  assert.ok(lab().open > 0.99, 'lab is open');
  assert.equal(p.galaxy.moonsOpen(), null, 'no ring yet');

  // 2. A tap on builder-a: FLIGHT.ms to its pick shot, its moons open.
  p.tapAt(11, p.cam.screenOf(BA));
  assert.deepEqual([p.place().level, p.place().planet], ['planet', BA]);
  p.tick(16);
  near(16 + flown(p), FLIGHT.ms, 'planet');
  p.run(OPEN_MS + 200);
  assert.equal(p.galaxy.moonsOpen(), BA, 'its ring is open');
  const picked = p.cam.pose();

  // 3. A drag turns the system round its own star: still held and open, the star unmoved.
  const star = p.cam.screenOf('lab');
  p.drag(20, { x: 700, y: 450 }, 160, 40);
  let worst = 0;
  for (let t = 0; t < 8 * ORBIT.tauMs; t += 16) { p.tick(16); worst = Math.max(worst, off(p.cam.screenOf('lab'), star)); }
  assert.ok(p.cam.want().turned, 'turned round lab\'s star');
  assert.ok(!samePose(p.cam.pose(), picked, 1), 'the camera moved');
  assert.ok(worst < 2, `the star stayed put through the turn and its coast (worst ${worst.toFixed(2)} px)`);
  assert.deepEqual([p.cam.want().id, p.place().level, p.place().planet], ['lab', 'planet', BA], 'still the system, still the planet');
  assert.ok(lab().open > 0.99, 'the system stays open');
  assert.equal(p.galaxy.moonsOpen(), BA, 'the ring stays open');
  const turned = p.cam.pose();

  // 4. A tap on empty sky: nothing at all.
  assert.ok(p.isSky(SKY), 'the corner is empty sky');
  const n = p.moves.length;
  p.tapAt(30, SKY);
  p.run(TAP.doubleMs + 50);
  assert.deepEqual([p.place().level, p.place().planet, p.moves.length], ['planet', BA, n], 'no step, no move');
  assert.ok(samePose(p.cam.pose(), turned, 1e-6), 'the camera where the finger left it');

  // 5. A tap on one of builder-a's moons: picked, the turned camera kept (0 ms).
  const ring = memberPoints(p.galaxy.world.sites, p.cam.screenOf).filter((q) => q.host === BA && q.onRing);
  assert.ok(ring.length >= 2, `builder-a's ring has moons (${ring.length})`);
  const moon = ring.find((q) => q.tone === 'calm') ?? ring[0];
  p.tapAt(31, moon);
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().moon, p.place().planet], ['moon', moon.id, BA], 'the moon is picked');
  assert.deepEqual([p.card.selected(), p.sheets.at(-1)], [moon.id, null], 'the moon\'s card, no sheet (T17)');
  assert.equal(p.moves.length, n, 'no camera move');
  assert.equal(flown(p), 0, 'moon: no flight');

  // 6. Back ×3 with the control: moon → planet (0 ms), planet → system (0 ms, moons fold), system → overview (3000 ms).
  assert.equal(p.button.dataset.kind, 'back');
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().planet, p.card.selected()], ['planet', BA, BA]);
  assert.equal(flown(p), 0, 'Back to the planet: no flight');
  assert.equal(p.galaxy.moonsOpen(), BA);
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().site, p.sheets.at(-1), p.card.shown()], ['site', 'lab', 'lab', false]);
  assert.equal(flown(p), 0, 'Back to the system: no flight');
  assert.equal(p.galaxy.moonsOpen(), null, 'the moons fold');
  assert.equal(p.moves.length, n, 'the camera never moved since the turn');
  assert.ok(samePose(p.cam.pose(), turned, 1e-6), 'the turned pose kept');
  p.press();
  p.tick(16);
  assert.equal(p.place(), AT_OVERVIEW);
  assert.deepEqual([p.cam.want().kind, p.cam.want().ms, p.cam.want().soft], ['overview', ZOOM_OUT.ms, true]);
  near(16 + flown(p), ZOOM_OUT.ms, 'overview');

  // 7. The overview: the fit (no explore pose was left), lab folded, the control ▶ TOUR.
  p.run(OPEN_MS + 200);
  assert.ok(samePose(p.cam.pose(), home, 1), 'back at the overview\'s fit');
  assert.equal(lab().open, 0, 'folded');
  assert.equal(p.button.dataset.kind, 'tour');
  assert.equal(p.place(), AT_OVERVIEW);
});
