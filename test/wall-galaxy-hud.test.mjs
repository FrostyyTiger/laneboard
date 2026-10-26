// The galaxy's words (Wall plan night 2 T5): galaxy.html has the layers the
// Wall's caption and frame need, and the tour's legs feed the caption with
// `captionLines` from the newest model (a site leg shows, an overview hides).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CRIT_HOLD, agoText, bannerModel, createHud, farNode, galaxyCaption, heldModel, legNode } from '../public/js/wall/galaxy/hud.js';
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
    { id: 'hv1-c', parent: 'hv1', kind: 'builder', label: 'builder-c', status: 'crit', why: 'no contact' },
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

test('farNode is the far line\'s node; heldModel puts a cleared crit back with how long ago', () => {
  assert.equal(farNode(contact('crit', 'no contact for 19s')).id, 'vm-c');
  assert.equal(farNode(contact('ok')), null, 'a warn line is not far');
  const m = contact('ok');
  assert.equal(heldModel(m, null, 0), m);
  const kept = heldModel(m, { id: 'vm-c', status: 'crit', clearedAt: 1000 }, 13400);
  const w = worstLine(kept);
  assert.equal(w.step, 'far');
  assert.equal(w.word, 'hv1 · builder-c');
  assert.equal(w.why, 'cleared 12s ago');
  assert.equal(m.nodes[2].status, 'ok', 'the model itself is not touched');
  assert.equal(heldModel(m, { id: 'gone', status: 'crit', clearedAt: 0 }, 5), m, 'a node that went: no hold');
  assert.equal(agoText(59400), '59s');
  assert.equal(agoText(185000), '3m');
});

test('crit → warn → crit within 20 s never drops the line below crit; it ends one cycle after the crit clears', () => {
  const pending = [];
  const timers = { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout: () => {} };
  const tour = createTour({ focus() {}, fit() {} }, { timing: DEMO_TIMING, timers });
  const fed = [];
  const fleet = { dataset: {} };
  const frame = { update: (m) => fed.push({ line: worstLine(m), held: fleet.dataset.held }), live() {}, cover: () => null, el: { fleet } };
  let t = 0;
  const hud = createHud({ caption: { show() {}, hide() {} }, frame, tour, now: () => t });
  const leg = () => pending.shift().fn();
  hud.update(contact('crit', 'no contact for 19s'));
  tour.update(contact('crit', 'no contact for 19s'));
  tour.start();
  assert.equal(fed.at(-1).line.step, 'far');
  assert.equal(fed.at(-1).held, undefined);
  // Flapping: down to warn at 4 s, crit again at 9 s, calm at 14 s, crit at 18 s.
  for (const [at, m] of [[4000, contact('warn', 'slow contact')], [9000, contact('crit', 'no contact for 3s')],
    [14000, contact('ok')], [18000, contact('crit', 'no contact for 2s')]]) {
    t = at;
    hud.update(m);
    assert.equal(fed.at(-1).line.status, 'crit', `at ${at} ms the line is still crit`);
    assert.equal(fed.at(-1).line.word, 'hv1 · builder-c');
  }
  // Clears for good at 20 s: held, dimmed, through the legs of this cycle.
  t = 20000;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).line.why, 'cleared 0s ago');
  assert.equal(fed.at(-1).held, '1');
  t = 26000;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).line.why, 'cleared 6s ago');
  // The tour flies on: hv1, remote, then the overview. Too soon (< minMs): still held.
  leg(); leg();
  t = 40000;
  leg();
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).line.status, 'crit', 'the overview at 20 s after the clear keeps it');
  // The next cycle's overview, past minMs: the line goes to the warn that is left.
  leg(); leg();
  t = 20000 + CRIT_HOLD.minMs + 5000;
  leg();
  assert.equal(fed.at(-1).line.status, 'warn');
  assert.equal(fed.at(-1).line.word, 'remote · office-printer');
  assert.equal(fed.at(-1).held, undefined, 'no longer dimmed');
});

test('a newer crit takes the line from a held one at once', () => {
  const fleet = { dataset: {} };
  const fed = [];
  const frame = { update: (m) => fed.push(worstLine(m)), live() {}, cover: () => null, el: { fleet } };
  let t = 0;
  const hud = createHud({ caption: { show() {}, hide() {} }, frame, now: () => t });
  hud.update(contact('crit', 'no contact'));
  t = 1000;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).name, 'builder-c');
  const other = contact('ok');
  other.nodes[4] = { ...other.nodes[4], status: 'crit', why: 'on fire' };
  t = 2000;
  hud.update(other);
  assert.equal(fed.at(-1).name, 'office-printer');
  assert.equal(fed.at(-1).status, 'crit');
  assert.equal(fleet.dataset.held, undefined);
  // Without a tour (a parked view) a hold ends after minMs.
  hud.update(contact('crit', 'no contact'));
  t = 3000;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).name, 'builder-c');
  t = 3000 + CRIT_HOLD.minMs;
  hud.update(contact('ok'));
  assert.equal(fed.at(-1).status, 'warn');
});

test('wall.css dims a held crit line and greys its why', () => {
  const css = read('css/wall.css');
  assert.match(css, /\.wall-fleet\[data-held\] \.wall-fleet-line \{ opacity: 0\.72; \}/);
  assert.match(css, /\.wall-fleet\[data-held\] \.wall-fleet-sub-why \{ color: var\(--text-2\); \}/);
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
    assert.equal(root.dataset.plate, '1', 'a system held, its plate up: the banner steps down');
    pending.shift().fn();
    assert.equal('plate' in root.dataset, false, 'the next flight: the banner again');
    const next = waits.at(-1);
    pending.shift().fn();
    assert.equal(next.live, false, 'a leg that ends before its arrival leaves no late step-down');
    assert.equal('plate' in root.dataset, false, 'back at the overview');
    // A parked still shows its plate too.
    hud.park({ id: 'lab' });
    assert.equal(root.dataset.plate, '1');
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
    frame.plate(true);
    assert.equal(frame.cover().bottom, 720, 'read again after the plate came');
    h = 200;
    frame.plate(true);
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
  assert.match(rule('.wall-frame-layer[data-plate] .wall-fleet[data-step="far"] .wall-fleet-line'), /font-size: var\(--cap-name\)/);
  assert.match(rule('.wall-fleet[data-step="far"] .wall-fleet-line'), /font-size: var\(--fleet-far\)/, 'no plate: the 3 m size');
  // The glyph is in em, so it steps down with the line.
  assert.match(rule('.wall-fleet[data-step="far"] .wall-fleet-glyph'), /font-size: 0\.62em/);
  // The name step lives on the stage, where caption and frame both read it.
  assert.match(rule('.wall-stage'), /--cap-name: 6\.9vmin/);
  assert.match(rule('.wall-caption-name'), /font-size: var\(--cap-name\)/);
});
