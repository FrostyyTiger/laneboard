// The node card's place (Wall plan night 5 T17, README §7 Night 5 D1):
// galaxy/card.js cardPlace beside the node, docked right when it fits on
// neither side or would cover a planet, never over the fleet line or the tag;
// on the page a tapped planet gets a card (no sheet) whose leader joins it.
// What it says (T18, D2): card.js describe for a site, a room, a builder, a
// service moon and a lane moon; only an off value takes a hue; a Below chip
// selects its node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD, CARD_SAYS, cardBodies, cardCover, cardInfo, cardPlace, cardRing, createCard, describe } from '../public/js/wall/galaxy/card.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { BA, LARGE, page } from './helpers/galaxy-page.mjs';
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
  assert.equal(card.el.hidden, true, 'placed on the next frame, not at the tap');
  card.draw();
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

test('createCard: a new card waits for the camera to land, then stays put on its side through later moves', () => {
  let flying = true, at = { x: 300, y: 400, r: 10 };
  const card = createCard(listening('main'), {
    screenOf: () => at, size: () => ({ W, H }), flying: () => flying, doc: { createElement: (t) => listening(t) },
  });
  card.open({ id: 'a', name: 'a', kind: 'room' });
  card.draw();
  assert.deepEqual([card.el.hidden, card.leaderEl.hidden, card.place()], [true, true, null], 'nothing while it flies in');
  flying = false;
  card.draw();
  assert.deepEqual([card.el.hidden, card.leaderEl.hidden, card.place().side], [false, false, 'right']);
  flying = true;
  at = { x: 720, y: 400, r: 10 }; // past the middle: a new card would take the left
  card.draw();
  assert.deepEqual([card.el.hidden, card.place().side], [false, 'right'], 'shown and on its side while the camera moves again');
});

test('the page: a tapped planet gets a card, no sheet, its leader joining card and node; its system\'s step gives the system\'s card', () => {
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
  // Back to the system (T19b): the system's card, not its sheet; it waits for the camera to land.
  p.press();
  p.tick(16);
  assert.deepEqual([p.place().level, p.card.selected(), p.card.el.hidden, p.sheets.at(-1)], ['site', 'lab', true, null]);
  p.run(FLIGHT.ms + OPEN_MS);
  assert.equal(p.card.el.hidden, false, 'the system\'s card once landed');
});

test('galaxy/main.js makes the card under the stage, a tapped site, planet or moon gets it, the overview closes it', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(js, /card = touch \? createCard\(stage, \{/);
  assert.match(js, /covers: \(\) => \[\.\.\.hud\.covers\(\), \.\.\.touchCovers\(\), \.\.\.showCovers\(\)\]/);
  assert.match(js, /if \(card\) cam\.onDraw\(card\.draw\);/);
  const pick = js.slice(js.indexOf('const pickCard = '), js.indexOf('\n  };', js.indexOf('const pickCard = ')));
  assert.match(pick, /hud\.release\(\);\s*card\?\.open\(describe\(\{ id, site \}, galaxy\.world\)\);/);
  assert.match(js, /onPick: \(id\) => openPlanet\(id, place\.site\),/, 'a Below chip opens its node as a tap on it would');
  const site = js.slice(js.indexOf('const openSite = '), js.indexOf('\n  };', js.indexOf('const openSite = ')));
  assert.match(site, /pickCard\(id, id\);/, 'a site\'s card (T19b), not its sheet');
  assert.doesNotMatch(js, /hud\.open\(/, 'no sheet for a finger\'s tap any more');
  const over = js.slice(js.indexOf('const toOverview = '), js.indexOf('\n  };', js.indexOf('const toOverview = ')));
  assert.match(over, /card\?\.close\(\);/);
  assert.match(js, /if \(card\?\.shown\(\) && card\.selected\(\) !== \(place\.moon \?\? place\.planet \?\? place\.site\)\) card\.close\(\);/);
});

// The large demo's world, as scene.js lays it out.
const LARGE_WORLD = (() => {
  const g = galaxyLayout(LARGE);
  return { byId: new Map(g.sites.map((x) => [x.id, x])) };
})();
const say = (id, site) => describe({ id, site }, LARGE_WORLD);

test('describe: a site, its status, its problems by name, its rooms up and loads, its rooms as chips worst first, +N', () => {
  const d = say('lab', 'lab');
  assert.deepEqual([d.name, d.kind, d.chip, d.path, d.tone], ['hv1', 'site', 'SITE', null, 'warn']);
  assert.deepEqual(d.status, { word: 'OK', text: 'demo hypervisor · 128 GB', tone: 'calm' }, 'its own word and what it is');
  assert.deepEqual(d.problems.map((p) => p.text), [
    'FEAT-SEARCH · waiting on a permission prompt · 10m', 'FIX-LOGIN · asked a question · 10m', 'ACME-BILLING · task T2 failed in rounds 2, 3',
  ], 'the trouble below it, named as the sheet named it');
  assert.deepEqual(d.problems.map((p) => [p.glyph, p.word, p.tone]), [['▲', 'ATTENTION', 'warn'], ['▲', 'ATTENTION', 'warn'], ['▲', 'WARN', 'warn']]);
  assert.equal(d.more, 0);
  assert.deepEqual(d.stats.map((x) => [x.label, x.value]), [['rooms up', '13/13'], ['cpu', '34%'], ['mem', '62%'], ['disk', '48%']]);
  assert.equal(d.stats.length, CARD_SAYS.stats);
  assert.deepEqual(d.below.map((c) => c.id), ['room-a', 'room-b', 'room-c', 'ci', 'backup', 'proxy'], 'rooms in trouble first, then the model\'s order');
  assert.deepEqual(d.below.slice(0, 2).map((c) => c.tone), ['warn', 'warn'], 'a room by the worst in it');
  assert.equal(d.belowMore, 13 - CARD_SAYS.below, '+N for the rest');
});

test('describe: a room and a builder, their path, their waiting lanes named, the lanes a stat with only the off one in a hue', () => {
  const room = say('ci', 'lab');
  assert.deepEqual([room.chip, room.path, room.status.word, room.status.text, room.tone], ['ROOM', 'hv1', 'OK', 'CI runners', 'calm']);
  assert.deepEqual(room.stats, [{ label: 'cpu', value: '46%', tone: null }, { label: 'mem', value: '66%', tone: null }]);
  assert.deepEqual(room.below.map((c) => c.label), ['runner-1', 'runner-2', 'runner-3']);
  assert.deepEqual(room.problems, []);
  const ba = say(BA, 'lab');
  assert.deepEqual([ba.name, ba.chip, ba.path, ba.tone], ['BA', 'BUILDER', 'hv1 › vm-a', 'warn']);
  assert.deepEqual(ba.status, { word: 'OK', text: 'builder-a · 3 lanes', tone: 'calm' });
  assert.deepEqual(ba.problems.map((p) => p.id), ['lane:builder-a/feat-search', 'lane:builder-a/fix-login'], 'a lane and its waiting session are one problem');
  assert.deepEqual(ba.stats.slice(0, 2), [{ label: 'lanes', value: '3', tone: null }, { label: 'waiting', value: '2', tone: 'warn' }]);
  assert.deepEqual(ba.below.map((c) => [c.label, c.tone]), [['feat-search', 'warn'], ['fix-login', 'warn'], ['docs-refresh', 'calm']]);
});

test('describe: a service moon and a lane moon, their path down to the host, their own why, no chips past the leaves', () => {
  const svc = say('ci-runner-1', 'lab');
  assert.deepEqual([svc.kind, svc.chip, svc.path, svc.tone], ['service', 'SERVICE', 'hv1 › ci', 'calm']);
  assert.deepEqual(svc.status, { word: 'WORKING', text: 'job · 4m', tone: 'calm' });
  assert.deepEqual([svc.below, svc.belowMore, svc.problems], [[], 0, []]);
  const lane = say('lane:builder-a/feat-search', 'lab');
  assert.deepEqual([lane.chip, lane.path, lane.tone], ['LANE', 'hv1 › vm-a › BA', 'warn']);
  assert.deepEqual(lane.status, { word: 'ATTENTION', text: 'waiting on a permission prompt · 10m', tone: 'warn' });
  assert.deepEqual(lane.stats.map((x) => x.label), ['cost', 'context', 'age']);
  assert.deepEqual(lane.stats[0], { label: 'cost', value: '$5.30', tone: null });
  assert.deepEqual(lane.below.map((c) => c.label), ['search ui', 'search api'], 'its sessions, the waiting one first');
  assert.equal(describe({ id: 'nope', site: 'lab' }, LARGE_WORLD), null);
  assert.equal(describe({ id: 'lab', site: 'nope' }, LARGE_WORLD), null);
});

test('describe and the card: a calm stat has no hue, an off one takes its tone; the ID goes to the chip; more than three problems give +N', () => {
  const site = { id: 's', kind: 'site', label: 'hv9', status: 'ok' };
  const room = { id: 'r', parent: 's', kind: 'room', label: 'vm-z', status: 'ok', metrics: { cpu: 0.4, mem: 0.9, disk: 0.97 }, detail: { ID: 301, Uptime: '3h' } };
  const svcs = [1, 2, 3, 4, 5].map((i) => ({ id: `r-${i}`, parent: 'r', kind: 'service', label: `svc-${i}`, status: i === 5 ? 'down' : 'warn', why: `why ${i}` }));
  const world = { byId: new Map([['s', { id: 's', node: site, members: [room, ...svcs].map((n) => ({ id: n.id, node: n })) }]]) };
  const d = describe({ id: 'r', site: 's' }, world);
  assert.equal(d.chip, 'ROOM · 301');
  assert.deepEqual(d.stats, [
    { label: 'cpu', value: '40%', tone: null }, { label: 'mem', value: '90%', tone: 'warn' }, { label: 'disk', value: '97%', tone: 'crit' }, { label: 'uptime', value: '3h', tone: null },
  ]);
  assert.deepEqual([d.tone, d.problems[0].text, d.problems.length, d.more], ['crit', 'SVC-5 · why 5', CARD_SAYS.problems, 2], 'worst first, +2 more');
  assert.equal(d.below[0].id, 'r-5');

  const card = createCard(listening('main'), { screenOf: () => ({ x: 300, y: 300, r: 10 }), size: () => ({ W, H }), doc: { createElement: (t) => listening(t) } });
  card.open(d);
  card.draw();
  const all = (e) => [e, ...e.children.flatMap(all)];
  const els = all(card.el);
  const values = els.filter((e) => e.className === 'galaxy-card-value');
  assert.deepEqual(values.map((e) => [e.textContent, e.dataset.tone]), [['40%', undefined], ['90%', 'warn'], ['97%', 'crit'], ['3h', undefined]], 'a calm value carries no tone');
  assert.equal(els.find((e) => e.className === 'galaxy-card-kind').textContent, 'ROOM · 301');
  assert.equal(els.find((e) => e.className === 'galaxy-card-path').textContent, 'hv9');
  assert.equal(els.find((e) => e.className === 'galaxy-card-more').textContent, '+2 MORE');
  const word = els.find((e) => e.className === 'galaxy-card-word');
  assert.deepEqual([word.textContent, word.dataset.tone], ['OK', undefined], 'its own calm status word is grey');
  const chips = els.filter((e) => e.className === 'galaxy-card-chip');
  assert.deepEqual(chips.map((c) => [c.tagName, c.textContent, c.getAttribute('aria-label')]).slice(0, 2), [['BUTTON', 'svc-5', 'Fly to svc-5'], ['BUTTON', 'svc-1', 'Fly to svc-1']]);
  assert.equal(chips[0].dataset.tone, 'crit');
  assert.ok(!els.some((e) => e.innerHTML), 'no innerHTML');
  const css = fs.readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.galaxy-card-chip {'), css.indexOf('}', css.indexOf('.galaxy-card-chip {')));
  assert.match(rule, /min-height: 48px;/);
  assert.match(rule, /touch-action: manipulation;/);
  assert.match(css, /\.galaxy-card-chip:active \{/, 'a visible pressed state');
  // Opened again on another node: what it said before is gone.
  card.open(describe({ id: 'r-1', site: 's' }, world));
  assert.equal(all(card.el).filter((e) => e.className === 'galaxy-card-chip').length, 0);
});

test('the page: a Below chip on a planet\'s card selects that node and flies there, its card replacing the old one', () => {
  const p = page();
  p.toBuilder();
  p.run(FLIGHT.ms + OPEN_MS);
  const all = (e) => [e, ...e.children.flatMap(all)];
  const chip = all(p.card.el).find((e) => e.className === 'galaxy-card-chip' && e.dataset.id === 'lane:builder-a/feat-search');
  assert.ok(chip, 'the waiting lane is a chip');
  const ev = chip.dispatch('click');
  assert.equal(ev.stopped, true, 'the press stays on the card');
  p.tick(16);
  assert.deepEqual([p.place().level, p.place().moon, p.card.selected()], ['moon', 'lane:builder-a/feat-search', 'lane:builder-a/feat-search']);
  p.run(FLIGHT.ms + OPEN_MS);
  assert.equal(p.card.el.hidden, false, 'its card shows');
  assert.ok(all(p.card.el).some((e) => e.className === 'galaxy-card-chip' && e.dataset.id === 'sess:builder-a/search ui'), 'the lane\'s own chips now');
});

test('cardPlace: docked, the card never covers its own node; the right edge first, else the left; the leader meets its edge', () => {
  // A moon too near the right edge for the right side, planets left of it: the dock, but not over the moon.
  const at = { x: 1051, y: 350, r: 13 };
  const bodies = [{ x: 860, y: 350, r: 14 }, { x: 900, y: 250, r: 12 }, { x: 880, y: 450, r: 12 }];
  const p = cardPlace({ at, size: { w: 360, h: 350 }, W, H, covers: [TAG, FLEET], bodies });
  assert.equal(p.side, 'dock');
  const r = cardCover(p);
  assert.ok(distToCircle(at, r) >= Math.max(at.r, CARD.hitPx), 'the node stays in sight');
  assert.ok(p.leader, 'a leader to it');
  assert.ok(Math.abs(p.leader.y2 - r.top) < 1e-6 || Math.abs(p.leader.y2 - r.bottom) < 1e-6 || Math.abs(p.leader.x2 - r.left) < 1e-6 || Math.abs(p.leader.x2 - r.right) < 1e-6, 'ending on the card\'s edge');
  // Words fill the right edge's whole height: the left edge takes it.
  const right = { left: W - 400, top: 0, right: W, bottom: H };
  const q = cardPlace({ at: { x: 700, y: 450, r: 12 }, size: { w: 360, h: 350 }, W, H, covers: [right], bodies: [{ x: 640, y: 450, r: 14 }, { x: 760, y: 450, r: 14 }] });
  assert.deepEqual([q.side, q.x], ['dock', CARD.edge]);
});
