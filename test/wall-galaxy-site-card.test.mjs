// A tapped site gets the node card (Wall plan night 5 T19b, README §7 Night 5 D5: "the old left-hand
// sheet for a tapped node gives way to the card; the caption and the fleet line stay"), as a planet's
// did in T17, and as the owner's sketch did (`sk_card=1`): the plate goes, the fleet line and the tag
// stay, the card comes as the camera lands, beside the star or docked, off the open system's planets,
// with the site's actions `Open · What's below · Board · Pin`. Back from a planet gives the system's
// card again; `Open` from it after a turn flies back to the system's hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD, cardBodies, cardCover } from '../public/js/wall/galaxy/card.js';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { page, samePose } from './helpers/galaxy-page.mjs';

const all = (e) => [e, ...e.children.flatMap(all)];
const acts = (card) => all(card.el).filter((e) => e.className === 'galaxy-card-act' && !e.parentNode?.dataset?.more);
const distToRect = (b, r) => Math.hypot(b.x - Math.max(r.left, Math.min(b.x, r.right)), b.y - Math.max(r.top, Math.min(b.y, r.bottom)));

test('the page: a tapped site gets its card, not its sheet, as the camera lands; its actions, its leader, no planet under it', () => {
  const p = page();
  p.run(200);
  p.tapAt(10, p.cam.screenOf('lab'));
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().site], ['site', 'lab']);
  assert.deepEqual([p.card.selected(), p.sheets.at(-1)], ['lab', null], 'the site\'s card; the plate went (no sheet)');
  assert.ok(!p.sheets.includes('lab'), 'no sheet for the site at any step');
  assert.equal(p.card.el.hidden, true, 'not while the camera flies in');
  p.run(FLIGHT.ms + OPEN_MS + 200);
  assert.ok(p.galaxy.world.byId.get('lab').open > 0.99, 'the system is open');
  assert.equal(p.card.el.hidden, false, 'the card once landed');
  assert.equal(p.card.el.getAttribute('aria-label'), 'hv1, site');
  assert.deepEqual(acts(p.card).map((e) => e.dataset.act), ['open', 'below', 'board', 'pin'], 'the site\'s row (README §7 Night 5 D3)');
  const pl = p.card.place();
  const r = cardCover(pl);
  const star = p.cam.screenOf('lab');
  assert.ok(pl.leader, 'a leader to its star');
  assert.ok(Math.hypot(pl.leader.x1 - star.x, pl.leader.y1 - star.y) <= CARD.spot + 1e-6, 'from the star');
  const bodies = cardBodies(p.galaxy.world, 'lab', 'lab', p.cam.screenOf);
  assert.ok(bodies.length > 5, `the open system's planets are the bodies it keeps off (${bodies.length})`);
  for (const b of bodies) assert.ok(distToRect(b, r) >= Math.max(b.r, CARD.bodyPx), 'no planet under the card');
});

test('the page: Back from a planet gives the system\'s card; Open after a turn flies back to its hold, the card kept', () => {
  const p = page();
  p.toBuilder();
  p.drag(20, { x: 1100, y: 800 }, -160, 0); // turn the system round its star
  p.run(4000); // the turn's coast at rest (a coast still running takes the camera back from a card's move)
  p.press(); // Back: planet → system, the turned camera kept
  p.tick(16);
  assert.deepEqual([p.place().level, p.card.selected(), p.sheets.at(-1)], ['site', 'lab', null]);
  const turned = p.cam.want();
  assert.ok(turned.kind === 'site' && turned.turned != null, 'held, turned');
  p.run(400);
  assert.equal(p.card.el.hidden, false, 'its card where the finger left the camera');
  const pose = p.cam.pose();
  const open = acts(p.card).find((e) => e.dataset.act === 'open');
  open.dispatch('click');
  p.tick(16);
  const w = p.cam.want();
  assert.deepEqual([w.kind, w.id, w.member ?? null, w.turned ?? null], ['site', 'lab', null, null], 'Open: the system\'s hold again');
  assert.ok(p.cam.flight() != null, 'a flight');
  p.run(FLIGHT.ms + 200);
  assert.ok(!samePose(p.cam.pose(), pose, 1), 'the camera moved back to the hold');
  assert.deepEqual([p.card.selected(), p.card.el.hidden, p.place().level], ['lab', false, 'site'], 'the card stays');
  // Open on the held, unturned system: nothing to fly.
  const n = p.moves.length;
  acts(p.card).find((e) => e.dataset.act === 'open').dispatch('click');
  p.tick(16);
  assert.equal(p.moves.length, n, 'no move');
  // Back once more: the overview, the card gone.
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.card.shown()], ['overview', false]);
});
