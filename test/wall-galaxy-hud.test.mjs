// The galaxy's words (Wall plan night 2 T5): galaxy.html has the layers the
// Wall's caption and frame need, and the tour's legs feed the caption with
// `captionLines` from the newest model (a site leg shows, an overview hides).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { bannerModel, createHud, galaxyCaption, legNode } from '../public/js/wall/galaxy/hud.js';
import { captionLines } from '../public/js/wall/caption.js';
import { worstLine } from '../public/js/wall/frame.js';
import { createTour, DEMO_TIMING } from '../public/js/wall/tour.js';

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
  assert.match(js, /hud\.live\(true\)/);
  assert.match(js, /hud\.live\(false\)/);
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
const twoProblems = () => {
  const m = model();
  m.nodes.push(
    { id: 'hv1-c', parent: 'hv1', kind: 'builder', label: 'builder-c', status: 'warn', why: 'no contact' },
    { id: 'hv1-s', parent: 'hv1-c', kind: 'session', label: 's1', status: 'warn' },
  );
  return m;
};

test('bannerModel: the held problem reads calm so the line names the next, else the model as it is', () => {
  const m = twoProblems();
  assert.match(worstLine(m).text, /^lab · crit/);
  const held = bannerModel(m, 'lab-b');
  assert.notEqual(held, m);
  assert.match(worstLine(held).text, /hv1 · builder-c · no contact/);
  assert.equal(m.nodes.find((n) => n.id === 'lab-b').status, 'crit', 'the model itself is untouched');
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
  // +N more counts the problems past the two.
  m.nodes.push({ id: 'hv1-d', parent: 'hv1', kind: 'builder', label: 'builder-d', status: 'warn' });
  assert.equal(worstLine(bannerModel(m, 'lab-b')).more, 1);
  assert.equal(worstLine(m).more, 2);
});

test('the frame names the second problem while the first is held, the first otherwise', () => {
  const { calls, caption, frame } = fakes();
  const legs = [];
  const tour = { onLeg: (cb) => { legs.push(cb); return () => {}; } };
  const hud = createHud({ caption, frame, tour });
  const fed = () => worstLine(calls.filter((c) => c[0] === 'frame').at(-1)[1]).text;
  const frames = () => calls.filter((c) => c[0] === 'frame').length;
  const m = twoProblems();
  hud.update(m);
  assert.match(fed(), /^lab · crit/, 'the overview: the worst');
  legs[0]({ kind: 'site', id: 'lab', index: 1, count: 2 });
  assert.match(fed(), /^hv1 · builder-c/, 'lab held: the next problem');
  const n = frames();
  hud.update(m);
  assert.equal(frames(), n, 'the same model and held thing: not fed again');
  hud.update(twoProblems());
  assert.match(fed(), /^hv1 · builder-c/, 'a new model while held: still the next');
  legs[0]({ kind: 'site', id: 'hv1', index: 2, count: 2 });
  assert.match(fed(), /^lab · crit/, 'hv1 held: lab is the line again');
  legs[0]({ kind: 'overview' });
  assert.match(fed(), /^lab · crit/);
});
