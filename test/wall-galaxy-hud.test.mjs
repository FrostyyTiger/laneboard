// The galaxy's words (Wall plan night 2 T5): galaxy.html has the layers the
// Wall's caption and frame need, and the tour's legs feed the caption with
// `captionLines` from the newest model (a site leg shows, an overview hides).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createHud, legNode } from '../public/js/wall/galaxy/hud.js';
import { captionLines } from '../public/js/wall/caption.js';
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
  assert.deepEqual(cap, captionLines(m.nodes[3], m, 1, 2));
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
