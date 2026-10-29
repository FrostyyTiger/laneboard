// The node card's place (Wall plan night 5 T17, README §7 Night 5 D1):
// galaxy/card.js cardPlace beside the node, docked right when it fits on
// neither side or would cover a planet, never over the fleet line or the tag;
// on the page a tapped planet gets a card (no sheet) whose leader joins it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD, cardBodies, cardCover, cardInfo, cardPlace, cardRing, createCard } from '../public/js/wall/galaxy/card.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { BA, page } from './helpers/galaxy-page.mjs';
import { listening } from './helpers/galaxy-page.mjs';

const W = 1368, H = 912;
const SIZE = { w: 360, h: 200 };
// The tablet's words as hud.covers() gives them: the tag top right, the fleet line bottom right.
const TAG = { left: 1100, top: 60, right: 1300, bottom: 100 };
const FLEET = { left: 760, top: 720, right: 1300, bottom: 840 };
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const insideFrame = (r) => r.left >= CARD.edge && r.top >= CARD.edge && r.right <= W - CARD.edge && r.bottom <= H - CARD.edge;
const distToCircle = (c, rect) => Math.hypot(c.x - Math.max(rect.left, Math.min(c.x, rect.right)), c.y - Math.max(rect.top, Math.min(c.y, rect.bottom)));

test('cardPlace: beside the node, away from the nearer edge, clear of its hit circle, its leader node to card', () => {
  const at = { x: 400, y: 420, r: 12 };
  const p = cardPlace({ at, size: SIZE, W, H, covers: [TAG, FLEET] });
  assert.equal(p.side, 'right', 'left half: on the right');
  const r = cardCover(p);
  assert.ok(r.left >= at.x + CARD.hitPx + CARD.gap - 0.5, 'past the finger\'s reach and the gap');
  assert.ok(insideFrame(r));
  assert.ok(Math.abs((r.top + r.bottom) / 2 - at.y) < 1, 'centred on the node');
  assert.ok(Math.abs(Math.hypot(p.leader.x1 - at.x, p.leader.y1 - at.y) - CARD.spot) < 1e-9, 'the leader leaves the node\'s ring');
  assert.equal(p.leader.x2, r.left, 'and ends on the card\'s near edge');
  assert.ok(p.leader.y2 >= r.top && p.leader.y2 <= r.bottom);

  const q = cardPlace({ at: { x: 1000, y: 420, r: 12 }, size: SIZE, W, H, covers: [TAG, FLEET] });
  assert.equal(q.side, 'left', 'right half: on the left');
  assert.equal(q.leader.x2, q.x + q.w);
  assert.ok(Number.isInteger(q.x) && Number.isInteger(q.y), 'whole px: no blurred text');
});

test('cardPlace: docks right when it fits on neither side, or with the node off the frame', () => {
  const narrow = cardPlace({ at: { x: 400, y: 300, r: 8 }, size: SIZE, W: 800, H: 600 });
  assert.equal(narrow.side, 'dock');
  assert.equal(narrow.x, 800 - CARD.edge - SIZE.w, 'against the right edge');
  // Near the right edge the left side is tried; a wall of words on the left leaves only the dock.
  const wall = { left: 0, top: 0, right: 1040, bottom: H };
  const edge = cardPlace({ at: { x: 1250, y: 450, r: 10 }, size: SIZE, W, H, covers: [wall] });
  assert.equal(edge.side, 'dock', 'off the right edge and no room on the left');
  assert.ok(insideFrame(cardCover(edge)));
  const off = cardPlace({ at: { x: -40, y: 300 }, size: SIZE, W, H, covers: [TAG, FLEET] });
  assert.deepEqual([off.side, off.leader], ['dock', null], 'a node off the frame: docked, no leader');
  assert.equal(cardPlace({ at: null, size: SIZE, W, H }).side, 'dock');
});

test('cardPlace: docks when beside would cover a planet of the open system, and the dock keeps off it', () => {
  const at = { x: 500, y: 450, r: 12 };
  // Planets just right of the node and just left of it: both sides would cover one.
  const bodies = [{ x: 700, y: 450, r: 14 }, { x: 290, y: 450, r: 14 }, { x: 640, y: 380, r: 10 }];
  const p = cardPlace({ at, size: SIZE, W, H, covers: [TAG, FLEET], bodies });
  assert.equal(p.side, 'dock');
  const r = cardCover(p);
  for (const b of bodies) assert.ok(distToCircle(b, r) >= Math.max(b.r, CARD.bodyPx), `planet at ${b.x},${b.y} uncovered`);
  // One planet on the right only: the left side takes it.
  const q = cardPlace({ at, size: SIZE, W, H, covers: [TAG, FLEET], bodies: [bodies[0]] });
  assert.equal(q.side, 'left');
  assert.ok(distToCircle(bodies[0], cardCover(q)) > 14);
  // A planet below the node's height on the right: the card slides up past it, still beside.
  const low = cardPlace({ at, size: SIZE, W, H, covers: [], bodies: [{ x: 640, y: 560, r: 10 }] });
  assert.equal(low.side, 'right');
  assert.ok(distToCircle({ x: 640, y: 560 }, cardCover(low)) >= CARD.bodyPx);
});

test('cardPlace: never over the fleet line or the tag, beside or docked, at any node height', () => {
  for (const y of [40, 90, 200, 450, 700, 780, 880]) {
    for (const x of [200, 700, 1250]) {
      for (const bodies of [[], [{ x: x + 60, y, r: 12 }, { x: x - 60, y, r: 12 }]]) {
        const p = cardPlace({ at: { x, y, r: 10 }, size: SIZE, W, H, covers: [TAG, FLEET], bodies });
        const r = cardCover(p);
        assert.ok(!overlaps(r, TAG), `${x},${y} ${p.side}: off the tag`);
        assert.ok(!overlaps(r, FLEET), `${x},${y} ${p.side}: off the fleet line`);
        assert.ok(insideFrame(r), `${x},${y} ${p.side}: inside the frame`);
      }
    }
  }
});

test('cardPlace: keeps the side it stood on while that still fits (no flip mid-flight)', () => {
  const at = { x: 720, y: 450, r: 10 }; // just right of the middle: the left side first
  assert.equal(cardPlace({ at, size: SIZE, W, H }).side, 'left');
  assert.equal(cardPlace({ at, size: SIZE, W, H, prev: 'right' }).side, 'right', 'kept');
  const tight = cardPlace({ at: { x: 1100, y: 450, r: 10 }, size: SIZE, W, H, prev: 'right' });
  assert.equal(tight.side, 'left', 'flipped only once it no longer fits');
});

test('cardPlace and cardRing: with the node\'s ring open the card stands past its moons, not over them', () => {
  const at = { x: 400, y: 450, r: 14 };
  const moons = [0, 1, 2, 3, 4].map((i) => ({ x: at.x + 100 * Math.cos(i * 1.256), y: at.y + 100 * Math.sin(i * 1.256), r: 8 }));
  assert.equal(cardPlace({ at, size: SIZE, W, H, bodies: moons }).side, 'dock', 'its own moons in the way on both sides');
  const world = { byId: new Map([['hv1', { members: [
    { id: 'p' }, ...moons.map((_, i) => ({ id: `m${i}`, moon: { host: 'p' }, ringOpen: true })), { id: 'x', moon: { host: 'q' }, ringOpen: true },
  ] }]]) };
  const sp = (id) => (id === 'p' ? at : id === 'x' ? { x: 0, y: 0, r: 5 } : moons[Number(id.slice(1))]);
  const ring = cardRing(world, 'hv1', 'p', sp);
  assert.ok(Math.abs(ring - (100 + CARD.bodyPx)) < 1e-9, `the ring's reach (${ring})`);
  assert.equal(cardRing(world, 'hv1', 'm0', sp), 0, 'a moon has no ring of its own');
  const p = cardPlace({ at, size: SIZE, W, H, bodies: moons, ring });
  assert.equal(p.side, 'right');
  for (const b of moons) assert.ok(distToCircle(b, cardCover(p)) >= CARD.bodyPx, 'no moon under it');
});

test('cardInfo and cardBodies: a member\'s header from the world; the open system\'s other bodies on screen', () => {
  const node = { id: 'room:vm-a', kind: 'room', label: 'vm-a', status: 'down' };
  const world = { byId: new Map([['hv1', { id: 'hv1', open: 1, members: [{ id: node.id, node }, { id: 'svc:dns', node: { id: 'svc:dns', kind: 'service' } }] }]]) };
  assert.deepEqual(cardInfo(world, 'hv1', node.id), { id: node.id, site: 'hv1', name: 'vm-a', kind: 'room', tone: 'crit' });
  assert.equal(cardInfo(world, 'hv1', 'nope'), null);
  const sp = (id) => (id === 'svc:dns' ? { x: 5, y: 6, r: 3 } : { x: 1, y: 2, r: 9 });
  assert.deepEqual(cardBodies(world, 'hv1', node.id, sp), [{ x: 5, y: 6, r: 3 }]);
  world.byId.get('hv1').open = 0.2;
  assert.deepEqual(cardBodies(world, 'hv1', node.id, sp), [], 'a folded system: none');
});

test('createCard: a labelled region with a 48 px ×; its pointers never reach the stage; the × closes it', () => {
  const stage = listening('main');
  let closed = 0;
  const card = createCard(stage, {
    screenOf: () => ({ x: 300, y: 300, r: 10 }), size: () => ({ W, H }), onClose: () => { closed += 1; },
    doc: { createElement: (t) => listening(t) },
  });
  assert.equal(card.el.hidden, true);
  card.open({ id: 'room:vm-a', name: 'vm-a', kind: 'room', tone: 'crit' });
  assert.equal(card.el.hidden, false);
  assert.equal(card.el.getAttribute('role'), 'region');
  assert.match(card.el.getAttribute('aria-label'), /vm-a/);
  assert.equal(card.el.dataset.tone, 'crit');
  for (const type of ['pointerdown', 'pointerup', 'click']) assert.equal(card.el.dispatch(type).stopped, true, `${type} stays on the card`);
  const x = card.el.children[0].children.at(-1);
  assert.equal(x.tagName, 'BUTTON');
  assert.equal(x.getAttribute('aria-label'), 'Close');
  x.dispatch('click');
  assert.equal(closed, 1);
  const css = fs.readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.galaxy-card-x {'), css.indexOf('}', css.indexOf('.galaxy-card-x {')));
  assert.match(rule, /width: 48px;/);
  assert.match(rule, /height: 48px;/);
  assert.match(rule, /touch-action: manipulation;/);
  assert.match(css, /\.galaxy-card-x:active \{/, 'a visible pressed state');
});

test('the page: a tapped planet gets a card, no sheet, its leader joining card and node; its system\'s step closes it', () => {
  const p = page();
  p.toBuilder();
  assert.equal(p.card.shown(), true, 'a card');
  assert.equal(p.card.selected(), BA);
  assert.equal(p.sheets.at(-1), null, 'the plate went: no sheet');
  assert.ok(!p.sheets.includes(BA), 'no sheet for the planet at any step');
  assert.equal(p.card.el.hidden, false);
  const at = p.cam.screenOf(BA);
  const pl = p.card.place();
  const r = cardCover(pl);
  assert.ok(pl.leader, 'a leader');
  assert.ok(Math.hypot(pl.leader.x1 - at.x, pl.leader.y1 - at.y) <= CARD.spot + 1e-6, 'from the node');
  const onEdge = (pt) => (Math.abs(pt.x - r.left) < 1e-6 || Math.abs(pt.x - r.right) < 1e-6 || Math.abs(pt.y - r.top) < 1e-6 || Math.abs(pt.y - r.bottom) < 1e-6)
    && pt.x >= r.left - 1e-6 && pt.x <= r.right + 1e-6 && pt.y >= r.top - 1e-6 && pt.y <= r.bottom + 1e-6;
  assert.ok(onEdge({ x: pl.leader.x2, y: pl.leader.y2 }), `to the card's edge (${pl.side})`);
  assert.equal(p.card.leaderEl.hidden, false);
  assert.match(p.card.el.style.transform, new RegExp(`translate\\(${pl.x}px, ${pl.y}px\\)`));
  // The open system's other planets stay in sight.
  for (const b of cardBodies(p.galaxy.world, 'lab', BA, p.cam.screenOf)) {
    assert.ok(distToCircle(b, r) >= Math.max(b.r, CARD.bodyPx), 'no planet under the card');
  }
  // Back to the system: its sheet again, the card gone.
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.card.shown(), p.card.el.hidden, p.sheets.at(-1)], ['site', false, true, 'lab']);
  p.run(FLIGHT.ms + OPEN_MS);
});

test('galaxy/main.js makes the card under the stage, a tapped planet or moon gets it, a site and the overview close it', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(js, /card = touch \? createCard\(stage, \{/);
  assert.match(js, /covers: \(\) => \[\.\.\.hud\.covers\(\), \.\.\.touchCovers\(\), \.\.\.showCovers\(\)\]/);
  assert.match(js, /if \(card\) cam\.onDraw\(card\.draw\);/);
  const pick = js.slice(js.indexOf('const pickCard = '), js.indexOf('\n  };', js.indexOf('const pickCard = ')));
  assert.match(pick, /hud\.release\(\);\s*card\?\.open\(cardInfo\(galaxy\.world, site, id\)\);/);
  const site = js.slice(js.indexOf('const openSite = '), js.indexOf('\n  };', js.indexOf('const openSite = ')));
  assert.match(site, /card\?\.close\(\);\s*hud\.open\(/);
  const over = js.slice(js.indexOf('const toOverview = '), js.indexOf('\n  };', js.indexOf('const toOverview = ')));
  assert.match(over, /card\?\.close\(\);/);
  assert.match(js, /if \(card\?\.shown\(\) && card\.selected\(\) !== \(place\.moon \?\? place\.planet\)\) card\.close\(\);/);
});
