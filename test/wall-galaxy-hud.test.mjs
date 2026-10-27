// The galaxy's words (Wall plan night 2 T5): galaxy.html has the layers the
// Wall's caption and frame need, and the tour's legs feed the caption with
// `captionLines` from the newest model (a site leg shows, an overview hides).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CRIT_HOLD, SHEET_LOCK, agoText, bannerEcho, bannerModel, clearedOf, createHud, farNode, firstSeen, galaxyCaption, legNode, plateFollows, sheetCaption, staleCaption } from '../public/js/wall/galaxy/hud.js';
import { captionLines } from '../public/js/wall/caption.js';
import { clearedLine, worstLine } from '../public/js/wall/frame.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';
import { lockTarget } from '../public/js/wall/lock.js';
import { freshness } from '../public/js/wall/galaxy/fresh.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const model = () => ({
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'hv1-b', parent: 'hv1', kind: 'builder', label: 'builder-a', status: 'ok' },
    { id: 'lab', parent: '__core', kind: 'site', label: 'lab', status: 'crit' },
    { id: 'lab-b', parent: 'lab', kind: 'builder', label: 'builder-b', status: 'crit', why: 'disk full' },
  ],
});

function fakes() {
  const calls = [];
  const caption = {
    show: (leg, cap) => calls.push(['show', leg, cap]),
    hide: () => calls.push(['hide']),
    cover: () => ({ left: 0, top: 0, right: 10, bottom: 10 }),
  };
  const frame = {
    update: (m) => calls.push(['frame', m]),
    live: (on) => calls.push(['live', on]),
    cover: () => null,
  };
  return { calls, caption, frame };
}

test('galaxy.html: the frame and caption layers over the canvas, in that order', () => {
  const html = read('galaxy.html');
  const at = (id) => html.indexOf(`id="${id}"`);
  for (const id of ['galaxy', 'wall-frame', 'wall-caption']) assert.ok(at(id) > 0, `#${id}`);
  assert.ok(at('galaxy') < at('wall-frame') && at('wall-frame') < at('wall-caption'), 'canvas, frame, caption');
  assert.match(html, /class="wall-frame-layer" id="wall-frame"/);
  assert.match(html, /class="wall-caption-layer" id="wall-caption"/);
});

test('galaxy/main.js makes the Wall caption and frame from those ids and wires the tour', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createCaption\(document\.getElementById\('wall-caption'\)/);
  assert.match(js, /createFrame\(document\.getElementById\('wall-frame'\)\)/);
  assert.match(js, /createHud\(\{ caption, frame, tour:/);
  assert.match(js, /hud\.update\(model\)/);
  // The socket's state reaches the tag through the feed's (night 3 T5, fresh.js).
  assert.match(js, /hud\.fresh\(f\)/);
});

test('legNode finds a site leg\'s node, null for the overview or a gone site', () => {
  const m = model();
  assert.equal(legNode({ kind: 'site', id: 'lab' }, m).label, 'lab');
  assert.equal(legNode({ kind: 'overview' }, m), null);
  assert.equal(legNode({ kind: 'site', id: 'gone' }, m), null);
  assert.equal(legNode({ kind: 'site', id: 'lab' }, null), null);
});

test('the tour\'s legs show the caption at each system with captionLines, and hide it at the overview', () => {
  const pending = [];
  const timers = {
    setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; },
    clearTimeout: () => {},
  };
  const map = { focus: () => {}, fit: () => {} };
  const tour = createTour(map, { timing: DEMO_TIMING, timers });
  const { calls, caption, frame } = fakes();
  const hud = createHud({ caption, frame, tour });
  const m = model();
  hud.update(m);
  tour.update(m);
  tour.start();
  assert.deepEqual(calls.at(-1), ['hide'], 'the first leg is the overview');
  pending.shift().fn();
  const [kind, leg, cap] = calls.at(-1);
  assert.equal(kind, 'show');
  assert.equal(leg.id, 'lab', 'trouble first');
  assert.equal(leg.arriveMs, DEMO_TIMING.flyMs);
  assert.deepEqual(cap, galaxyCaption(captionLines(m.nodes[3], m, 1, 2), 'site'));
  assert.equal(cap.status, 'crit');
  pending.shift().fn();
  assert.equal(calls.at(-1)[1].id, 'hv1');
  pending.shift().fn();
  assert.deepEqual(calls.at(-1), ['hide'], 'back at the overview');
});

test('the frame gets every model and the socket state; covers are the shown boxes', () => {
  const { calls, caption, frame } = fakes();
  const hud = createHud({ caption, frame });
  const m = model();
  hud.update(m);
  hud.update(null);
  hud.live(1);
  hud.live(false);
  assert.deepEqual(calls, [['frame', m], ['live', true], ['live', false]]);
  assert.deepEqual(hud.covers(), [{ left: 0, top: 0, right: 10, bottom: 10 }]);
});

test('covers: the warn-step fleet line keeps the names off it too, its box read once per words', () => {
  const { caption } = fakes();
  let reads = 0;
  const line = { dataset: { key: 'line|▲|remote · office-printer · paper jam' } };
  const fleet = {
    dataset: { step: 'line' },
    querySelector: (sel) => (sel === '.wall-fleet-line' ? line : null),
    get offsetLeft() { reads += 1; return 800; }, offsetTop: 700, offsetWidth: 500, offsetHeight: 90,
  };
  let far = null;
  const frame = { update() {}, live() {}, cover: () => far, el: { fleet } };
  const hud = createHud({ caption: { ...caption, cover: () => null }, frame });
  assert.deepEqual(hud.covers(), [{ left: 800, top: 700, right: 1300, bottom: 790 }]);
  hud.covers(); hud.covers();
  assert.equal(reads, 1, 'not per frame');
  line.dataset.key = 'line|▲|hv1 · feat-search · waiting';
  hud.covers();
  assert.equal(reads, 2, 'again when the words change');
  // The far step: frame.js's own cover; calm: none.
  far = { left: 1, top: 2, right: 3, bottom: 4 };
  assert.deepEqual(hud.covers(), [far]);
  far = null;
  fleet.dataset.step = 'calm';
  assert.deepEqual(hud.covers(), []);
});

test('a parked system gets its caption at once, without a tour', () => {
  const { calls, caption, frame } = fakes();
  const hud = createHud({ caption, frame });
  hud.update(model());
  hud.park({ id: 'hv1', index: 2, count: 2 });
  const [kind, leg, cap] = calls.at(-1);
  assert.equal(kind, 'show');
  assert.equal(leg.arriveMs, 0);
  assert.match(cap.name, /hv1/i);
  assert.match(cap.kicker, /02 \/ 02/);
});

// T25 (reviews/r26-skeptic.md 8): a calm hold says its number and its name, nothing else.
test('galaxyCaption: a calm site is kicker and name, a site in trouble keeps its lines; no `· SITE`', () => {
  const m = model();
  m.nodes[2].metrics = { cpu: 0.4, mem: 0.6 };
  m.nodes[1].detail = { where: 'office' };
  const calm = galaxyCaption(captionLines(m.nodes[1], m, 4, 5), 'site');
  assert.equal(calm.kicker, 'TARGET 04 / 05');
  assert.equal(calm.name, 'HV1');
  assert.deepEqual(calm.lines, []);
  assert.ok(captionLines(m.nodes[1], m, 4, 5).lines.length > 0, 'captionLines itself still lists them');
  const bad = galaxyCaption(captionLines(m.nodes[3], m, 1, 5), 'site');
  assert.equal(bad.kicker, 'CRIT · TARGET 01 / 05');
  assert.deepEqual(bad.lines, captionLines(m.nodes[3], m, 1, 5).lines);
  assert.ok(bad.lines.some((l) => l.kind === 'trouble') && bad.lines.some((l) => l.kind === 'status'));
  // Unnumbered (a parked still without a tour), the kind is the kicker's only word: kept.
  assert.equal(galaxyCaption(captionLines(m.nodes[1], m), 'site').kicker, 'SITE');
});

test('the hud feeds the caption the short plate on a calm leg and the trouble lines on a trouble leg', () => {
  const { calls, caption, frame } = fakes();
  const hud = createHud({ caption, frame });
  hud.update(model());
  hud.park({ id: 'hv1', index: 2, count: 2 });
  const calm = calls.at(-1)[2];
  assert.equal(calm.kicker, 'TARGET 02 / 02');
  assert.deepEqual(calm.lines, []);
  hud.park({ id: 'lab', index: 1, count: 2 });
  const bad = calls.at(-1)[2];
  assert.equal(bad.kicker, 'CRIT · TARGET 01 / 02');
  assert.equal(bad.lines[0].kind, 'trouble');
  assert.equal(bad.lines[1].kind, 'status');
});

// T23 (reviews/r21-operator.md 5): the banner does not repeat the caption.
// Two crits by default; `level` 'warn' makes both problems warns (lab, its
// builder and hv1's): since night 4 T8 the line steps past a held problem
// only at the line step, two crits are named together.
const twoProblems = (level = 'crit') => {
  const m = model();
  m.nodes.push(
    { id: 'hv1-c', parent: 'hv1', kind: 'builder', label: 'builder-c', status: level, why: 'no contact' },
    { id: 'hv1-s', parent: 'hv1-c', kind: 'session', label: 's1', status: 'warn' },
  );
  if (level !== 'crit') for (const n of m.nodes) if (n.id.startsWith('lab')) n.status = level;
  return m;
};

test('bannerModel: the held problem reads calm so the line names the next, else the model as it is', () => {
  const m = twoProblems('warn');
  assert.match(worstLine(m).text, /^lab · warn/);
  const held = bannerModel(m, 'lab-b');
  assert.notEqual(held, m);
  assert.match(worstLine(held).text, /hv1 · builder-c · no contact/);
  assert.equal(m.nodes.find((n) => n.id === 'lab-b').status, 'warn', 'the model itself is untouched');
  // The held site is in trouble too (its root is lab): all of it steps aside.
  assert.equal(held.nodes.find((n) => n.id === 'lab').status, 'ok');
  // Holding the second problem (or a node inside it): the line already names another.
  assert.equal(bannerModel(m, 'hv1-c'), m);
  assert.equal(bannerModel(m, 'hv1-s'), m);
  // Nothing held, a calm node held, an unknown id: as it is.
  assert.equal(bannerModel(m, null), m);
  assert.equal(bannerModel(m, 'hv1-b'), m);
  assert.equal(bannerModel(m, 'nope'), m);
  // One problem only: never "all calm" while the caption says trouble.
  const one = model();
  assert.equal(bannerModel(one, 'lab-b'), one);
  // T30: never down a step, from a held crit to a warn (the 3 m line would flip red, yellow, red).
  const warnNext = twoProblems();
  warnNext.nodes.find((n) => n.id === 'hv1-c').status = 'warn';
  assert.equal(bannerModel(warnNext, 'lab-b'), warnNext);
  assert.equal(worstLine(bannerModel(warnNext, 'lab-b')).step, 'far');
  // +N more counts the problems past the two.
  m.nodes.push({ id: 'hv1-d', parent: 'hv1', kind: 'builder', label: 'builder-d', status: 'warn' });
  assert.equal(worstLine(bannerModel(m, 'lab-b')).more, 1);
  assert.equal(worstLine(m).more, 2);
});

test('bannerModel (night 4 T8): with two crits standing the line is the same whatever is held', () => {
  const m = twoProblems();
  const since = new Map([['hv1-c', 1000], ['lab', 2000]]);
  const want = worstLine(m, { since });
  assert.equal(want.text, '2 crit · hv1 · lab · builder-c · no contact', 'oldest first: hv1 was seen before lab');
  for (const held of [null, 'lab', 'lab-b', 'hv1', 'hv1-b', 'hv1-c', 'hv1-s', 'nope']) {
    assert.equal(bannerModel(m, held, since), m, `held ${held}: the model as it is`);
    assert.equal(worstLine(bannerModel(m, held, since), { since }).text, want.text, `held ${held}`);
  }
  // Without `since`, model order: still one line for every held thing.
  const plain = worstLine(m).text;
  assert.equal(plain, '2 crit · lab · hv1 · crit', 'lab, a site in trouble itself, speaks for its problem');
  for (const held of ['lab-b', 'hv1-c']) assert.equal(worstLine(bannerModel(m, held)).text, plain);
  // The line speaks for the oldest: holding it is an echo (the line drops out under its plate), holding the other is not.
  assert.equal(bannerEcho(m, 'hv1-c', since), true);
  assert.equal(bannerEcho(m, 'lab-b', since), false);
  assert.equal(bannerEcho(m, 'lab-b'), true);
  assert.equal(farNode(m, since).id, 'hv1-c');
  assert.equal(farNode(m).id, 'lab', 'model order: lab speaks for itself (the site is crit)');
});

test('firstSeen (night 4 T8): a crit keeps the time it was first seen, a new one gets now, a cleared one is forgotten', () => {
  const one = model();
  const a = firstSeen(one, null, 100);
  assert.deepEqual([...a], [['lab', 100]]);
  assert.equal(firstSeen(one, a, 200), a, 'nothing new: the same map');
  const two = twoProblems();
  const b = firstSeen(two, a, 300);
  assert.deepEqual([...b], [['lab', 100], ['hv1-c', 300]]);
  // A warn is not counted; lab clears and comes back: it is new then.
  const hv1Only = twoProblems();
  for (const n of hv1Only.nodes) if (n.id.startsWith('lab')) n.status = 'warn';
  const c = firstSeen(hv1Only, b, 400);
  assert.deepEqual([...c], [['hv1-c', 300]]);
  assert.deepEqual([...firstSeen(two, c, 500)], [['lab', 500], ['hv1-c', 300]]);
  assert.equal(worstLine(two, { since: firstSeen(two, c, 500) }).word, '2 crit · hv1 · lab');
  assert.deepEqual([...firstSeen(null, c, 600)], []);
});

test('bannerEcho (night 3 T20): true only when the fed line would still name the held problem', () => {
  // One problem: the line can only say what the plate says.
  assert.equal(bannerEcho(model(), 'lab-b'), true);
  // Two crits: the line steps to the other one, no echo.
  const two = twoProblems('warn');
  assert.equal(bannerEcho(two, 'lab-b'), false);
  // The next problem is only a warn (T30: never a step down): the line would repeat the held crit.
  const warnNext = twoProblems();
  warnNext.nodes.find((n) => n.id === 'hv1-c').status = 'warn';
  assert.equal(bannerEcho(warnNext, 'lab-b'), true);
  // Holding the milder problem: the line names the other one anyway.
  assert.equal(bannerEcho(warnNext, 'hv1-c'), false);
  // A warn held alone in the fleet: an echo at the line step too.
  const warnOnly = model();
  for (const n of warnOnly.nodes) if (n.status === 'crit') n.status = 'ok';
  warnOnly.nodes.find((n) => n.id === 'hv1-b').status = 'warn';
  assert.equal(bannerEcho(warnOnly, 'hv1-b'), true);
  // Nothing held, a calm thing held, an unknown id, no model: no echo.
  assert.equal(bannerEcho(model(), null), false);
  assert.equal(bannerEcho(model(), 'hv1-b'), false);
  assert.equal(bannerEcho(model(), 'nope'), false);
  assert.equal(bannerEcho(null, 'lab-b'), false);
});

test('not three reds saying one thing (night 3 T20): under the plate the echoing line drops out and the hero\'s node is not named', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createFrame } = await import('../public/js/wall/frame.js');
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const root = makeEl('div');
    const frame = createFrame(root, { timers: { setTimeout: () => 0, clearTimeout() {} } });
    const fleet = frame.el.fleet;
    for (const [k, v] of [['offsetLeft', 900], ['offsetTop', 600], ['offsetWidth', 400], ['offsetHeight', 200]]) {
      Object.defineProperty(fleet, k, { value: v, configurable: true });
    }
    const { caption } = fakes();
    const legs = [];
    const tour = { onLeg: (cb) => { legs.push(cb); return () => {}; } };
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const hud = createHud({ caption, frame, tour, timers, size: () => ({ W: 1368, H: 912 }) });
    // Lab's builder is the trouble, the site itself calm: the hero names the planet.
    const planet = () => {
      const m = model();
      m.nodes.find((n) => n.id === 'lab').status = 'ok';
      return m;
    };
    hud.update(planet());
    assert.equal('echo' in fleet.dataset, false, 'the overview: the line is the headline');
    legs[0]({ kind: 'site', id: 'lab', index: 1, count: 2, arriveMs: 3000 });
    assert.equal('echo' in fleet.dataset, true, 'lab held, nothing else wrong: the line would echo the plate');
    assert.equal(hud.named(), null, 'in the flight the planet keeps its name');
    assert.equal(frame.hushed(), false, 'and the line its place (no plate yet)');
    assert.ok(hud.fleetCover(), 'the names keep off it in the flight');
    waits.at(-1).fn();
    assert.equal(root.dataset.plate, 'crit');
    assert.equal(frame.hushed(), true, 'the plate is up: the line is dropped');
    assert.equal(frame.cover(), null, 'and covers nothing');
    assert.equal(hud.fleetCover(), null);
    assert.equal(hud.named(), 'lab-b', 'the hero names builder-b: its label gives way to the brackets');
    // A second warn elsewhere: the line steps to it, back in sight (T23), the planet still unnamed.
    const next = planet();
    next.nodes.push({ id: 'hv1-c', parent: 'hv1', kind: 'builder', label: 'builder-c', status: 'warn', why: 'no contact' });
    hud.update(next);
    assert.equal('echo' in fleet.dataset, true, 'never a step down from the held crit to a warn (T30)');
    // A second crit elsewhere (night 4 T8): the line names both, the held one first (seen first), so it still echoes.
    next.nodes.at(-1).status = 'crit';
    hud.update({ ...next });
    assert.equal(fleet.dataset.step, 'far');
    assert.match(fleet.textContent ?? '', /2 crit · lab · hv1/);
    assert.match(fleet.textContent ?? '', /builder-b · disk full/);
    assert.equal(frame.hushed(), true);
    assert.equal(hud.named(), 'lab-b');
    hud.update(planet());
    assert.equal(frame.hushed(), true);
    // A site in trouble itself: its hero says `CRIT`, not a name; the site keeps its label.
    hud.update(model());
    legs[0]({ kind: 'site', id: 'lab', index: 1, count: 2, arriveMs: 0 });
    assert.equal(frame.hushed(), true);
    assert.equal(hud.named(), null);
    // The overview: the plate goes, the line is back, every name too.
    legs[0]({ kind: 'overview' });
    assert.equal(frame.hushed(), false);
    assert.equal('echo' in fleet.dataset, false);
    assert.equal(hud.named(), null);
    // A calm system held: no hero, nothing hidden; the line names the crit elsewhere.
    legs[0]({ kind: 'site', id: 'hv1', index: 2, count: 2, arriveMs: 0 });
    assert.equal(root.dataset.plate, 'grey', 'a calm plate: the crit line elsewhere keeps its 3 m size (T30)');
    assert.equal(frame.hushed(), false);
    assert.equal(hud.named(), null);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('wall.css: an echoing line is hidden only under a plate, its place kept (T20)', () => {
  const css = read('css/wall.css');
  const at = css.indexOf('.wall-frame-layer[data-plate] .wall-fleet[data-echo] {');
  assert.ok(at >= 0);
  assert.match(css.slice(at, css.indexOf('}', at)), /visibility: hidden/);
  assert.equal(/\.wall-fleet\[data-echo\]\s*\{/.test(css.replace(/\.wall-frame-layer\[data-plate\] \.wall-fleet\[data-echo\]/g, '')), false, 'no rule hides it without a plate');
});

test('the frame names the second problem while the first is held, the first otherwise', () => {
  const { calls, caption, frame } = fakes();
  const legs = [];
  const tour = { onLeg: (cb) => { legs.push(cb); return () => {}; } };
  const hud = createHud({ caption, frame, tour });
  const fed = () => worstLine(calls.filter((c) => c[0] === 'frame').at(-1)[1]).text;
  const frames = () => calls.filter((c) => c[0] === 'frame').length;
  const m = twoProblems('warn');
  hud.update(m);
  assert.match(fed(), /^lab · warn/, 'the overview: the worst');
  legs[0]({ kind: 'site', id: 'lab', index: 1, count: 2 });
  assert.match(fed(), /^hv1 · builder-c/, 'lab held: the next problem');
  const n = frames();
  hud.update(m);
  assert.equal(frames(), n, 'the same model and held thing: not fed again');
  hud.update(twoProblems('warn'));
  assert.match(fed(), /^hv1 · builder-c/, 'a new model while held: still the next');
  legs[0]({ kind: 'site', id: 'hv1', index: 2, count: 2 });
  assert.match(fed(), /^lab · warn/, 'hv1 held: lab is the line again');
  legs[0]({ kind: 'overview' });
  assert.match(fed(), /^lab · warn/);
});

test('night 4 T8: with two crits the fed line is the same at every leg, oldest first', () => {
  let t = 1000;
  const fed = [];
  const { caption } = fakes();
  const frame = { update: (m, o) => fed.push(worstLine(m, { since: o?.since }).text), live() {}, cover: () => null };
  const legs = [];
  const tour = { onLeg: (cb) => { legs.push(cb); return () => {}; } };
  const hud = createHud({ caption, frame, tour, now: () => t });
  // hv1's builder goes crit first, lab a minute later.
  const first = twoProblems();
  for (const n of first.nodes) if (n.id.startsWith('lab')) n.status = 'ok';
  hud.update(first);
  t += 60000;
  hud.update(twoProblems());
  const line = '2 crit · hv1 · lab · builder-c · no contact';
  assert.equal(fed.at(-1), line, 'the oldest first, though model order puts lab first');
  for (const leg of [{ kind: 'site', id: 'lab' }, { kind: 'site', id: 'hv1' }, { kind: 'overview' }, { kind: 'site', id: 'lab' }]) {
    legs[0]({ index: 1, count: 2, ...leg });
    t += 5000;
    hud.update(twoProblems());
    assert.equal(fed.at(-1), line, `${leg.kind} ${leg.id ?? ''}`);
  }
});

// T30 (reviews/r43-stranger.md galaxy 1): a crit that clears and returns within seconds must not flip the line.
const contact = (status, why) => ({
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'vm-c', parent: 'hv1', kind: 'builder', label: 'builder-c', status, why },
    { id: 'remote', parent: '__core', kind: 'site', label: 'remote', status: 'ok' },
    { id: 'printer', parent: 'remote', kind: 'room', label: 'office-printer', status: 'warn', why: 'paper jam' },
  ],
});

// The line the frame sets from what the hud feeds it (frame.js update: a memory only while calm).
const shown = (m, opts = {}) => {
  const w = worstLine(m);
  return w.step === 'calm' ? clearedLine(m, opts.cleared) ?? w : w;
};
// `contact` without the printer's warn: the fleet is calm once vm-c clears.
const alone = (status, why) => {
  const m = contact(status, why);
  m.nodes[4] = { ...m.nodes[4], status: 'ok', why: undefined };
  return m;
};

test('farNode is the far line\'s node; clearedOf says how long a cleared crit was in trouble', () => {
  assert.equal(farNode(contact('crit', 'no contact for 19s')).id, 'vm-c');
  assert.equal(farNode(contact('ok')), null, 'a warn line is not far');
  assert.equal(clearedOf(null), null);
  assert.deepEqual(clearedOf({ id: 'vm-c', status: 'crit', since: 1000, clearedAt: 361000 }), { id: 'vm-c', status: 'crit', forMs: 360000 });
  assert.equal(clearedLine(alone('ok'), clearedOf({ id: 'vm-c', status: 'down', since: 0, clearedAt: 360000 })).text,
    'hv1 · builder-c ok · was down 6m');
  assert.equal(agoText(59400), '59s');
  assert.equal(agoText(185000), '3m');
});

test('the red goes when the trouble goes (night 3 T18): a cleared crit is a calm grey line until one cycle after', () => {
  const pending = [];
  const timers = { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout: () => {} };
  const tour = createTour({ focus() {}, fit() {} }, { timing: DEMO_TIMING, timers });
  const fed = [];
  const frame = { update: (m, opts) => fed.push(shown(m, opts)), live() {}, cover: () => null, el: { fleet: { dataset: {} } } };
  let t = 0;
  const hud = createHud({ caption: { show() {}, hide() {} }, frame, tour, now: () => t });
  const leg = () => pending.shift().fn();
  hud.update(alone('crit', 'no contact for 19s'));
  tour.update(alone('crit', 'no contact for 19s'));
  tour.start();
  assert.equal(fed.at(-1).step, 'far');
  // Flapping: warn at 4 s shows the live warn (honest before steady), crit again at 9 s keeps its start.
  t = 4000;
  hud.update(alone('warn', 'slow contact'));
  assert.equal(fed.at(-1).status, 'warn');
  assert.equal(fed.at(-1).step, 'line');
  t = 9000;
  hud.update(alone('crit', 'no contact for 3s'));
  assert.equal(fed.at(-1).step, 'far');
  // Clears for good at 20 s: at once no red slab, the calm step, how long it was crit (from 0 s).
  t = 20000;
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).step, 'calm');
  assert.equal(fed.at(-1).tone, 'cleared');
  assert.equal(fed.at(-1).text, 'hv1 · builder-c ok · was crit 20s');
  // A warn elsewhere while remembered: the live warn takes the line, the memory comes back after it.
  t = 22000;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).text, 'remote · office-printer · paper jam');
  t = 24000;
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).tone, 'cleared');
  // The tour flies on: hv1, remote, then the overview. Too soon (< minMs): still remembered.
  leg(); leg();
  t = 40000;
  leg();
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).tone, 'cleared', 'the overview 20 s after the clear keeps it');
  // The next cycle's overview, past minMs: all calm.
  leg(); leg();
  t = 20000 + CRIT_HOLD.minMs + 5000;
  leg();
  assert.equal(fed.at(-1).text, 'all calm');
  assert.equal(fed.at(-1).tone, 'grey');
});

test('a newer crit takes the line from a remembered one at once', () => {
  const fed = [];
  const frame = { update: (m, opts) => fed.push(shown(m, opts)), live() {}, cover: () => null, el: { fleet: { dataset: {} } } };
  let t = 0;
  const hud = createHud({ caption: { show() {}, hide() {} }, frame, now: () => t });
  hud.update(alone('crit', 'no contact'));
  t = 1000;
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).tone, 'cleared');
  const other = alone('ok');
  other.nodes[4] = { ...other.nodes[4], status: 'crit', why: 'on fire' };
  t = 2000;
  hud.update(other);
  assert.equal(fed.at(-1).name, 'office-printer');
  assert.equal(fed.at(-1).status, 'crit');
  assert.equal(fed.at(-1).step, 'far');
  // Without a tour (a parked view) a memory ends after minMs.
  hud.update(alone('crit', 'no contact'));
  t = 3000;
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).tone, 'cleared');
  t = 3000 + CRIT_HOLD.minMs;
  hud.update(alone('ok'));
  assert.equal(fed.at(-1).text, 'all calm');
});

test('wall.css sets a cleared crit at the calm step in --text-2 with only its glyph in the old hue (T18)', () => {
  const css = read('css/wall.css');
  const rule = css.match(/\.wall-fleet\[data-tone="cleared"\] \.wall-fleet-line \{([^}]*)\}/);
  assert.ok(rule, 'a rule for the cleared line');
  assert.match(rule[1], /font-size: 2\.7vmin;/, 'the calm line\'s size');
  assert.match(rule[1], /color: var\(--text-2\);/);
  assert.match(css, /\.wall-fleet\[data-was="crit"\] \.wall-fleet-glyph \{ color: var\(--crit\); \}/);
  assert.doesNotMatch(css, /data-held/, 'no dimmed red slab any more');
  assert.doesNotMatch(css, /\[data-tone="cleared"\][^{]*\{[^}]*--crit/, 'no crit hue on the words');
});

test('one headline per trouble frame (night 3 T4): data-plate on the frame while the plate shows, cleared at the overview', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createFrame } = await import('../public/js/wall/frame.js');
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const pending = [];
    const timers = {
      setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; },
      clearTimeout: () => {},
    };
    const root = makeEl('div');
    const frame = createFrame(root, { timers: { setTimeout: () => 0, clearTimeout() {} } });
    const { caption } = fakes();
    const tour = createTour({ focus: () => {}, fit: () => {} }, { timing: DEMO_TIMING, timers });
    const waits = [];
    const hudTimers = {
      setTimeout: (fn, ms) => { waits.push({ fn, ms, live: true }); return waits.length; },
      clearTimeout: (id) => { if (waits[id - 1]) waits[id - 1].live = false; },
    };
    const hud = createHud({ caption, frame, tour, timers: hudTimers });
    const m = model();
    hud.update(m);
    tour.update(m);
    tour.start();
    assert.equal('plate' in root.dataset, false, 'the overview: no plate, the banner at its far size');
    pending.shift().fn();
    assert.equal('plate' in root.dataset, false, 'in the flight the banner is still the headline');
    assert.equal(waits.at(-1).ms, DEMO_TIMING.flyMs, 'it steps down as the camera arrives with the plate');
    waits.at(-1).fn();
    assert.equal(root.dataset.plate, 'crit', 'a crit system held, its plate up: the banner steps down');
    pending.shift().fn();
    assert.equal('plate' in root.dataset, false, 'the next flight: the banner again');
    const next = waits.at(-1);
    pending.shift().fn();
    assert.equal(next.live, false, 'a leg that ends before its arrival leaves no late step-down');
    assert.equal('plate' in root.dataset, false, 'back at the overview');
    // A parked still shows its plate too.
    hud.park({ id: 'lab' });
    assert.equal(root.dataset.plate, 'crit');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('frame.plate reads the far block again: its size changed with the attribute', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createFrame } = await import('../public/js/wall/frame.js');
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const root = makeEl('div');
    const frame = createFrame(root, { timers: { setTimeout: () => 0, clearTimeout() {} } });
    frame.update(model());
    const fleet = frame.el.fleet;
    assert.equal(fleet.dataset.step, 'far');
    let h = 200;
    for (const [k, v] of [['offsetLeft', 900], ['offsetTop', 600], ['offsetWidth', 400]]) {
      Object.defineProperty(fleet, k, { value: v, configurable: true });
    }
    Object.defineProperty(fleet, 'offsetHeight', { get: () => h, configurable: true });
    assert.equal(frame.cover().bottom, 800);
    h = 120;
    assert.equal(frame.cover().bottom, 800, 'cached while nothing changed');
    frame.plate('crit');
    assert.equal(frame.cover().bottom, 720, 'read again after the plate came');
    h = 200;
    frame.plate('crit');
    assert.equal(frame.cover().bottom, 720, 'the same state twice reads nothing');
    frame.plate(false);
    assert.equal(frame.cover().bottom, 800, 'and again when it goes');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('wall.css: with a plate up the far line is set at the caption name step, at the overview at its own', () => {
  const css = read('css/wall.css');
  const rule = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.wall-frame-layer[data-plate="crit"] .wall-fleet[data-step="far"] .wall-fleet-line'), /font-size: var\(--cap-name\)/);
  assert.match(rule('.wall-fleet[data-step="far"] .wall-fleet-line'), /font-size: var\(--fleet-far\)/, 'no plate: the 3 m size');
  // The glyph is in em, so it steps down with the line.
  assert.match(rule('.wall-fleet[data-step="far"] .wall-fleet-glyph'), /font-size: 0\.62em/);
  // The name step lives on the stage, where caption and frame both read it.
  assert.match(rule('.wall-stage'), /--cap-name: 6\.9vmin/);
  assert.match(rule('.wall-caption-name'), /font-size: var\(--cap-name\)/);
});

// The worst thing is the loudest (night 3 T30, r41-operator galaxy 1): data-plate carries the plate's tone, and
// only a crit plate steps the crit banner down; under a warn or calm plate it keeps its 3 m size.
test('T30: data-plate is the plate\'s tone; a warn or calm plate leaves the crit banner at full size', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createFrame } = await import('../public/js/wall/frame.js');
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const root = makeEl('div');
    const frame = createFrame(root, { timers: { setTimeout: () => 0, clearTimeout() {} } });
    const { caption } = fakes();
    const hud = createHud({ caption, frame, timers: { setTimeout: () => 0, clearTimeout() {} } });
    const m = model();
    m.nodes.push(
      { id: 'hv2', parent: '__core', kind: 'site', label: 'hv2', status: 'warn' },
      { id: 'hv2-b', parent: 'hv2', kind: 'builder', label: 'feat-search', status: 'warn', why: 'slow' },
    );
    hud.update(m);
    assert.equal(frame.el.fleet.dataset.step, 'far', 'lab is crit: the banner is at its far step');
    hud.park({ id: 'hv2' });
    assert.equal(root.dataset.plate, 'warn', 'a warn plate under a crit banner');
    hud.park({ id: 'hv1' });
    assert.equal(root.dataset.plate, 'grey', 'a calm plate under a crit banner');
    hud.park({ id: 'lab' });
    assert.equal(root.dataset.plate, 'crit', 'a crit plate under a crit banner: T4 steps it down');
    hud.park(null);
    assert.equal('plate' in root.dataset, false, 'no plate');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('wall.css (T30): the far line steps down under a crit plate only; the echo drops under any plate', () => {
  const css = read('css/wall.css');
  const steps = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{[^}]*font-size: var\(--cap-name\)/g)].map((x) => x[1].trim())
    .filter((sel) => sel.includes('wall-fleet'));
  assert.deepEqual(steps, ['.wall-frame-layer[data-plate="crit"] .wall-fleet[data-step="far"] .wall-fleet-line'],
    'only a crit plate sets the far line at the name step');
  assert.doesNotMatch(css, /\[data-plate(="warn"|="grey")?\] \.wall-fleet\[data-step="far"\]/, 'a milder plate leaves the 3 m size');
  // The 3 m size is larger than the plate's name step under a milder plate: 14vmin (fitted, 9 at the least) > 6.9vmin.
  assert.match(css, /--fleet-far: 14vmin;/);
  assert.match(css, /--cap-name: 6\.9vmin;/);
  assert.ok(css.includes('.wall-frame-layer[data-plate] .wall-fleet[data-echo] {'), 'T20 holds under any plate');
});

// A calm plate does not shrink the banner (night 3 T22, r17-operator galaxy 7; built by T30): under a calm
// plate the crit line keeps its fitted 3 m size, and that size is never level with the calm name it sits above.
test('T22: under a calm plate the crit banner stays a clear step above the plate\'s name, whatever it has to fit', async () => {
  const { STEPS } = await import('../public/js/wall/caption.js');
  const { fleetSize } = await import('../public/js/wall/frame.js');
  const css = read('css/wall.css');
  assert.match(css, new RegExp(`--cap-name: ${STEPS.name}vmin;`), 'the plate name step is STEPS.name');
  for (const word of ['DOWN', 'STORAGE', 'HV2 · STORAGE', 'BUILDER-A · FEAT-SEARCH-REINDEX']) {
    for (const [w, h] of [[1368, 912], [2736, 1824], [1920, 1080], [800, 1280]]) {
      const size = fleetSize(word, w, h);
      assert.ok(size >= STEPS.heroMin && size >= STEPS.name * 1.25, `${word} at ${w}x${h}: ${size}vmin over ${STEPS.name}`);
    }
  }
});

// A dead feed, the words (night 3 T5): the tag reads STALE <age>, the next plate says the data is old, in grey.
test('hud.fresh: the tag gets the feed state; the next plate carries the grey line, gone when live again', () => {
  const { calls, caption, frame } = fakes();
  frame.fresh = (f) => calls.push(['fresh', f.text]);
  const hud = createHud({ caption, frame });
  hud.update(model());
  const stale = freshness(0, 150_000);
  hud.fresh(stale);
  assert.deepEqual(calls.at(-1), ['fresh', 'STALE 2M']);
  hud.park({ id: 'hv1', index: 2, count: 2 });
  const calm = calls.at(-1)[2];
  assert.deepEqual(calm.lines, [{ kind: 'stale', step: 'line', label: 'data', text: 'no new data for 2m' }]);
  hud.park({ id: 'lab', index: 1, count: 2 });
  const bad = calls.at(-1)[2];
  assert.equal(bad.lines[0].kind, 'trouble', 'the trouble word stays the hero');
  assert.equal(bad.lines[1].kind, 'stale', 'the old-data line right under it');
  assert.equal(bad.lines[1].status, undefined, 'no status, so no hue');
  hud.fresh(freshness(150_000, 150_000));
  assert.deepEqual(calls.at(-1), ['fresh', 'LIVE']);
  hud.park({ id: 'hv1', index: 2, count: 2 });
  assert.deepEqual(calls.at(-1)[2].lines, []);
});

test('hud.fresh without frame.fresh falls back to live(on)', () => {
  const { calls, caption, frame } = fakes();
  const hud = createHud({ caption, frame });
  hud.fresh(freshness(0, 1000, { open: true }));
  hud.fresh(freshness(0, 1000, { open: false }));
  hud.fresh(null);
  assert.deepEqual(calls, [['live', true], ['live', false]]);
});

test('staleCaption: after the hero, never past MAX_LINES, the cap itself while fresh', () => {
  const cap = { kicker: 'K', name: 'N', lines: [{ kind: 'trouble', step: 'hero' }, ...Array.from({ length: 5 }, (_, i) => ({ kind: 'fact', step: 'small', text: String(i) }))] };
  assert.equal(staleCaption(cap, freshness(0, 1000)), cap);
  assert.equal(staleCaption(cap, null), cap);
  const out = staleCaption(cap, freshness(0, 40_000));
  assert.equal(out.lines.length, 6);
  assert.equal(out.lines[1].kind, 'stale');
  assert.equal(out.lines.at(-1).text, '3', 'the last fact gave way');
});

test('frame.fresh writes the tag: STALE <age> grey, OFFLINE in the offline hue, LIVE', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createFrame } = await import('../public/js/wall/frame.js');
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const frame = createFrame(makeEl('div'), { timers: { setTimeout: () => 0, clearTimeout() {} } });
    const tag = frame.el.tag;
    const word = () => tag.children.find((c) => c.className === 'wall-tag-live').textContent;
    frame.fresh(freshness(0, 150_000));
    assert.equal(tag.dataset.live, 'stale');
    assert.equal(word(), 'stale 2m');
    frame.fresh(freshness(0, 1000, { open: false }));
    assert.equal(tag.dataset.live, '0');
    assert.equal(word(), 'offline');
    frame.fresh(freshness(0, 0));
    assert.equal(tag.dataset.live, '1');
    assert.equal(word(), 'live');
  } finally {
    globalThis.document = prevDoc;
  }
  const css = read('css/wall.css');
  assert.match(css, /\.wall-tag\[data-live="stale"\] \.wall-tag-live \{ color: var\(--text-1\); \}/);
  // The caption's stale line takes no status colour: no rule names it with a trouble hue.
  for (const m of css.matchAll(/[^}]*data-kind="stale"[^{]*\{[^}]*\}/g)) {
    assert.doesNotMatch(m[0], /--(crit|warn|info|down|attention)/);
  }
});

test('night 3 T7: release() (a finger took the camera) hides the plate and lets the lock go', () => {
  const pending = [];
  const timers = { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout: () => {} };
  const tour = createTour({ focus: () => {}, fit: () => {} }, { timing: DEMO_TIMING, timers });
  const { calls, caption, frame } = fakes();
  const lockCalls = [];
  const lock = { lockOn: (l) => lockCalls.push(['on', l.id]), release: () => lockCalls.push(['release']) };
  const hud = createHud({ caption, frame, tour, lock });
  const m = model();
  hud.update(m);
  tour.update(m);
  tour.start();
  pending.shift().fn();
  assert.equal(calls.at(-1)[0], 'show', 'the plate is up on lab');
  tour.stop();
  hud.release();
  assert.deepEqual(calls.at(-1), ['hide']);
  assert.deepEqual(lockCalls.at(-1), ['release']);
});

// Night 3 T11: a tapped thing's sheet (sheetCaption), every line, worst first.
const sheetModel = () => ({
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'hv1-a', parent: 'hv1', kind: 'room', label: 'vm-a', status: 'warn', why: 'disk 91%' },
    { id: 'hv1-b', parent: 'hv1', kind: 'room', label: 'vm-b', status: 'ok' },
    { id: 'hv1-c', parent: 'hv1', kind: 'room', label: 'vm-c', status: 'crit', why: 'down',
      metrics: { cpu: 0.42, mem: 0.8 }, detail: { where: 'rack 2', hardware: 'builder-a' } },
    { id: 'hub', parent: '__core', kind: 'site', label: 'hub', status: 'ok' },
    { id: 'hub-a', parent: 'hub', kind: 'room', label: 'vm-x', status: 'ok' },
  ],
});

test('sheetCaption: a site in trouble, the worst first (the crit as the hero, the count, then the warn)', () => {
  const m = sheetModel();
  const cap = sheetCaption(m.nodes[1], m);
  assert.equal(cap.sheet, true);
  assert.equal(cap.lines[0].kind, 'trouble');
  assert.equal(cap.lines[0].status, 'crit', 'the crit leads');
  assert.equal(cap.lines[0].word, 'VM-C');
  assert.equal(cap.lines[1].kind, 'status');
  assert.match(cap.lines[1].text, /crit/);
  const problems = cap.lines.filter((l) => l.kind === 'problem');
  assert.deepEqual(problems.map((l) => l.status), ['warn']);
  assert.match(problems[0].text, /^VM-A · disk 91%/);
  assert.ok(cap.lines.indexOf(problems[0]) < cap.lines.findIndex((l) => l.kind === 'count'), 'trouble before the counts');
  assert.equal(cap.kicker, 'SITE · HV1', 'what was touched (T25), not the tour\'s count');
  assert.equal(cap.mark.tone, 'crit', 'the mark\'s glyph keeps its hue');
});

// Night 3 T27 (reviews/r36-dreamer.md galaxy 4): the hero and the lock at a
// held site are its worst member, never a lesser one while a crit sits in it.
test('T27: the hero and the lock target are the site\'s worst member, in the tour and on a sheet', () => {
  const heroOf = (cap) => cap.lines.find((l) => l.kind === 'trouble');
  const check = (m, what) => {
    const site = m.nodes.find((n) => n.id === 'hv1');
    const tour = galaxyCaption(captionLines(site, m, 1, 5));
    const sheet = sheetCaption(site, m);
    for (const [name, cap] of [['tour', tour], ['sheet', sheet]]) {
      assert.equal(heroOf(cap).id, 'hv1-c', `${what}: the ${name} plate's hero is the crit`);
      assert.equal(heroOf(cap).status, 'crit');
      assert.equal(cap.mark.tone, 'crit', `${what}: the ${name} kicker's mark is the crit's`);
    }
    assert.deepEqual(lockTarget(site, m)[0], { id: 'hv1-c', kind: 'room' }, `${what}: the lock closes on the crit`);
  };
  // a warn and a crit member, in either model order
  const m = sheetModel();
  check(m, 'warn before crit');
  const swapped = sheetModel();
  const [a, b] = [2, 4];
  [swapped.nodes[a], swapped.nodes[b]] = [swapped.nodes[b], swapped.nodes[a]];
  check(swapped, 'crit before warn');
  // the site's own warn does not outrank a crit inside it; it is named next
  const own = sheetModel();
  Object.assign(own.nodes[1], { status: 'warn', why: 'uplink 80%' });
  own.nodes[2].status = 'ok';
  check(own, 'site in its own warn');
  const next = galaxyCaption(captionLines(own.nodes[1], own)).lines.filter((l) => l.kind === 'problem');
  assert.deepEqual(next.map((l) => [l.status, l.text]), [['warn', 'HV1 · uplink 80%']], 'the site\'s own warn is the next problem');
  // a node's own trouble still leads a tie, and a worse own status leads anything milder below it
  const tie = sheetModel();
  Object.assign(tie.nodes[1], { status: 'crit', why: 'power' });
  assert.equal(heroOf(captionLines(tie.nodes[1], tie)).id, 'hv1', 'own crit beside a crit member: its own');
  const down = sheetModel();
  Object.assign(down.nodes[1], { status: 'down', why: 'unreachable' });
  assert.equal(heroOf(sheetCaption(down.nodes[1], down)).word, 'UNREACHABLE', 'own down above a crit member: its own');
  assert.deepEqual(lockTarget(down.nodes[1], down), [{ id: 'hv1', kind: 'site' }]);
});

test('sheetCaption: a calm site keeps its lines (the tour\'s plate drops them, a sheet was asked for)', () => {
  const m = sheetModel();
  const hub = m.nodes.find((n) => n.id === 'hub');
  assert.deepEqual(galaxyCaption(captionLines(hub, m), 'site').lines, []);
  const cap = sheetCaption(hub, m);
  assert.deepEqual(cap.lines.map((l) => l.kind), ['status', 'count']);
  assert.match(cap.lines[0].text, /all 1 calm/);
});

test('sheetCaption: a planet shows its own status, why, cpu/mem and detail, and names the site it is in', () => {
  const m = sheetModel();
  const cap = sheetCaption(m.nodes.find((n) => n.id === 'hv1-c'), m);
  assert.equal(cap.name, 'VM-C');
  assert.match(cap.kicker, /ROOM · IN HV1$/);
  assert.equal(cap.lines[0].kind, 'trouble');
  assert.equal(cap.lines[0].word, 'DOWN', 'its own why as the word');
  assert.equal(cap.lines[1].kind, 'status');
  const bars = cap.lines.find((l) => l.kind === 'metrics').bars;
  assert.deepEqual(bars.map((b) => [b.label, b.text]), [['cpu', '42%'], ['mem', '80%']]);
  const facts = cap.lines.filter((l) => l.kind === 'fact');
  assert.deepEqual(facts.map((f) => [f.label, f.text]), [['hardware', 'builder-a'], ['where', 'rack 2']]);
  // A calm planet: its status, no hero.
  const b = sheetCaption(m.nodes.find((n) => n.id === 'hv1-b'), m);
  assert.equal(b.hero, false);
  assert.equal(b.lines[0].kind, 'status');
  assert.match(b.kicker, /IN HV1$/);
});

test('the hud opens a tapped planet\'s sheet where the camera is: its own lines, not the tour\'s cut', () => {
  const shown = [];
  const hud = createHud({
    caption: { show: (leg, cap) => shown.push([leg, cap]), hide: () => {}, cover: () => null },
    frame: { update: () => {}, live: () => {}, cover: () => null },
  });
  hud.update(sheetModel());
  hud.open({ id: 'hv1-c', arriveMs: 0 });
  const [leg, cap] = shown.at(-1);
  assert.equal(leg.id, 'hv1-c');
  assert.equal(leg.sheet, true);
  assert.equal(cap.sheet, true);
  assert.match(cap.kicker, /IN HV1/);
  assert.ok(cap.lines.some((l) => l.kind === 'metrics'));
  // A calm site opened by a tap keeps its rows; the tour's park of the same site does not.
  hud.open({ id: 'hub', arriveMs: 0 });
  assert.ok(shown.at(-1)[1].lines.length > 0);
  hud.park({ id: 'hub' });
  assert.deepEqual(shown.at(-1)[1].lines, []);
});

// Night 3 T24 (reviews/r31-film-ui.md touch 1; A4): the plate follows the trouble that rises under it.
const risingModel = (cStatus = 'ok') => ({
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'hv1-a', parent: 'hv1', kind: 'lane', label: 'feat-search', status: 'attention', why: 'asked a question' },
    { id: 'hv1-b', parent: 'hv1', kind: 'lane', label: 'fix-login', status: 'attention', why: 'waiting' },
    { id: 'hv1-d', parent: 'hv1', kind: 'room', label: 'vm-d', status: 'warn', why: 'disk 91%' },
    { id: 'hv1-c', parent: 'hv1', kind: 'room', label: 'vm-c', status: cStatus, ...(cStatus === 'ok' ? {} : { why: 'no heartbeat' }) },
  ],
});

function followFakes() {
  const shown = [], refreshed = [], locks = [], plates = [];
  let up = false;
  const caption = {
    show: (leg, cap) => { shown.push([leg, cap]); up = true; },
    refresh: (cap) => { if (!up) return false; refreshed.push(cap); return true; },
    hide: () => { up = false; },
    cover: () => null,
  };
  const frame = { update: () => {}, live: () => {}, cover: () => null, plate: (t) => plates.push(t) };
  const lock = { lockOn: (leg) => locks.push(leg), release: () => locks.push('release') };
  return { shown, refreshed, locks, plates, caption, frame, lock };
}

test('T24: a sheet for HV1 re-ranks at once when VM-C turns crit: the crit as hero, STATUS counts it, the lock moves, no retyping', () => {
  const f = followFakes();
  const hud = createHud({ caption: f.caption, frame: f.frame, lock: f.lock });
  hud.update(risingModel());
  hud.open({ id: 'hv1', arriveMs: 0 });
  const first = f.shown.at(-1)[1];
  assert.equal(first.lines[0].status, 'attention');
  assert.equal(f.plates.at(-1), 'warn');
  const shows = f.shown.length;
  hud.update(risingModel('crit'));
  assert.equal(f.shown.length, shows, 'not shown again: nothing typed again');
  const cap = f.refreshed.at(-1);
  assert.ok(cap, 'the plate took the new words');
  assert.equal(cap.sheet, true);
  assert.equal(cap.lines[0].kind, 'trouble');
  assert.equal(cap.lines[0].status, 'crit', 'the crit row first');
  assert.equal(cap.lines[0].word, 'VM-C');
  const status = cap.lines.find((l) => l.kind === 'status');
  assert.equal(status.parts[0].text, '1 crit', 'STATUS counts the crit first');
  assert.equal(cap.kicker, 'SITE · HV1');
  assert.equal(cap.mark.tone, 'crit');
  assert.equal(f.plates.at(-1), 'crit', 'the plate\'s tone follows');
  const lock = f.locks.at(-1);
  assert.equal(lock.target[0].id, 'hv1-c', 'the brackets go to the crit');
  assert.equal(lock.status, 'crit');
  assert.equal(lock.cut, true);
  assert.equal(hud.named(), 'hv1-c');
  // The same model again changes nothing.
  const n = f.refreshed.length;
  hud.update(risingModel('crit'));
  assert.equal(f.refreshed.length, n);
  // A sheet follows a fall too: it says worst first, so it is never wrong about the worst.
  hud.update(risingModel());
  assert.equal(f.refreshed.at(-1).lines[0].status, 'attention');
});

test('T24: sheetCaption is the tour caption\'s rule (A4): a tour plate takes a rise at once, a fall waits for the leg\'s end', () => {
  const f = followFakes();
  const hud = createHud({ caption: f.caption, frame: f.frame, lock: f.lock });
  hud.update(risingModel());
  hud.park({ id: 'hv1' });
  hud.update(risingModel('crit'));
  const up = f.refreshed.at(-1);
  assert.equal(up.lines[0].status, 'crit', 'a rise re-feeds the tour plate');
  assert.equal(up.sheet, undefined, 'still the tour\'s plate');
  const n = f.refreshed.length;
  hud.update(risingModel());
  assert.equal(f.refreshed.length, n, 'a fall waits');
  // The plate's rule, pure.
  const m = risingModel(), c = risingModel('crit');
  const node = (x) => x.nodes[1];
  const tourCap = (x) => galaxyCaption(captionLines(node(x), x), 'site');
  assert.equal(plateFollows(tourCap(m), tourCap(c)), true);
  assert.equal(plateFollows(tourCap(c), tourCap(m)), false);
  assert.equal(plateFollows(sheetCaption(node(c), c), sheetCaption(node(m), m)), true);
  assert.equal(plateFollows(sheetCaption(node(m), m), sheetCaption(node(m), m)), false);
  assert.equal(plateFollows(null, tourCap(m)), false);
});

test('T24: a crit rising while the camera still flies shows the new plate for the time left, not at once', () => {
  const f = followFakes();
  let t = 1000;
  const waits = [];
  const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
  const hud = createHud({ caption: f.caption, frame: f.frame, lock: f.lock, now: () => t, timers });
  hud.update(risingModel());
  f.caption.hide();
  hud.open({ id: 'hv1', arriveMs: 3000, lockMs: 0 });
  f.caption.hide(); // the fake plate is not up until the camera arrives
  t += 1000;
  hud.update(risingModel('crit'));
  const [leg, cap] = f.shown.at(-1);
  assert.equal(leg.arriveMs, 2000, 'the time left');
  assert.equal(cap.lines[0].status, 'crit');
  // The waiting plate takes the new tone when it lands.
  waits.find((w) => w.ms === 3000).fn();
  assert.equal(f.plates.at(-1), 'crit');
});

// Night 3 T25 (reviews/r31-film-ui.md touch 2, 5): the sheet is yours, not the tour's.
test('T25: a sheet\'s kicker says what was touched, never the tour\'s count', () => {
  const m = sheetModel();
  assert.equal(sheetCaption(m.nodes[1], m).kicker, 'SITE · HV1');
  assert.equal(sheetCaption(m.nodes.find((n) => n.id === 'hub'), m).kicker, 'SITE · HUB');
  assert.equal(sheetCaption(m.nodes.find((n) => n.id === 'hv1-c'), m).kicker, 'ROOM · IN HV1');
  assert.equal(sheetCaption(m.nodes.find((n) => n.id === 'hv1-b'), m).kicker, 'ROOM · IN HV1');
  // Through the hud, with the tour's numbers on the leg: still no TARGET.
  const shown = [];
  const hud = createHud({
    caption: { show: (leg, cap) => shown.push(cap), hide: () => {}, cover: () => null },
    frame: { update: () => {}, live: () => {}, cover: () => null },
  });
  hud.update(m);
  hud.open({ id: 'hv1', index: 1, count: 5, arriveMs: 0 });
  assert.equal(shown.at(-1).kicker, 'SITE · HV1');
  assert.ok(!/TARGET/.test(shown.at(-1).kicker));
  hud.park({ id: 'hv1', index: 1, count: 5 });
  assert.match(shown.at(-1).kicker, /TARGET 01 \/ 05/, 'the tour keeps its count');
});

test('T25: a sheet\'s brackets go round the tapped site first, then step to its worst member after the arrival', () => {
  const f = followFakes();
  const waits = [];
  const timers = {
    setTimeout: (fn, ms) => { waits.push({ fn, ms, live: true }); return waits.length; },
    clearTimeout: (id) => { if (waits[id - 1]) waits[id - 1].live = false; },
  };
  const hud = createHud({ caption: f.caption, frame: f.frame, lock: f.lock, timers });
  const m = sheetModel();
  hud.update(m);
  hud.open({ id: 'hv1', arriveMs: 2500, lockMs: 0 });
  const first = f.locks.at(-1);
  assert.deepEqual(first.target.map((t) => t.id), ['hv1'], 'the site first: this is what you touched');
  assert.equal(first.arriveMs, 0, 'at once');
  assert.equal(first.status, 'crit', 'in the trouble word\'s hue');
  const step = waits.find((w) => w.live && w.ms === 2500 + SHEET_LOCK.stepMs);
  assert.ok(step, 'the step waits for the camera and the shut brackets');
  step.fn();
  const second = f.locks.at(-1);
  assert.equal(second.target[0].id, 'hv1-c', 'then the worst member, the hero\'s');
  assert.equal(second.cut, true);
  assert.equal(second.arriveMs, 0);
  // A calm site, or a planet that is itself the worst: one lock, no step.
  const n = f.locks.length;
  hud.open({ id: 'hub', arriveMs: 0 });
  assert.equal(f.locks.length, n + 1);
  assert.equal(f.locks.at(-1).target[0].id, 'hub');
  assert.ok(!waits.some((w) => w.live && w.ms === SHEET_LOCK.stepMs), 'no step waiting');
  hud.open({ id: 'hv1-c', arriveMs: 0 });
  assert.equal(f.locks.at(-1).target[0].id, 'hv1-c');
  // The tour is unchanged: straight to the worst member.
  hud.park({ id: 'hv1' });
  assert.equal(f.locks.at(-1).target[0].id, 'hv1-c');
});

test('T25: a step still waiting is dropped by a new leg and taken over by a rising trouble', () => {
  const f = followFakes();
  const waits = [];
  const timers = {
    setTimeout: (fn, ms) => { waits.push({ fn, ms, live: true }); return waits.length; },
    clearTimeout: (id) => { if (waits[id - 1]) waits[id - 1].live = false; },
  };
  const hud = createHud({ caption: f.caption, frame: f.frame, lock: f.lock, timers });
  hud.update(risingModel());
  hud.open({ id: 'hv1', arriveMs: 0 });
  assert.equal(f.locks.at(-1).target[0].id, 'hv1');
  const step = () => waits.filter((w) => w.live && w.ms === SHEET_LOCK.stepMs);
  assert.equal(step().length, 1);
  hud.update(risingModel('crit'));
  assert.equal(f.locks.at(-1).target[0].id, 'hv1-c', 'a crit goes to the brackets at once');
  assert.equal(step().length, 0, 'and the waiting step with it');
  hud.open({ id: 'hv1', arriveMs: 0 });
  assert.equal(step().length, 1);
  hud.release();
  assert.equal(step().length, 0, 'gone with the sheet');
});
