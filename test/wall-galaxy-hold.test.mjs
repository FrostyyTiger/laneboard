// One hero per held frame (Wall plan night 5 T23, reviews/r10-film-ui.md 3): the
// banner's size step follows the camera's hold, not the plate. The overview, a
// flight and a free pose keep it at its 3 m size; from the landing on a site
// until the camera leaves, `data-hold` carries the tone of the site's worst and
// wall.css steps the far line down (one line over a crit, one step over a calm
// site, none over a warn: the crit elsewhere stays the loudest, night 3 T30).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { STEPS } from '../public/js/wall/caption.js';
import { createFrame } from '../public/js/wall/frame.js';
import { createHud } from '../public/js/wall/galaxy/hud.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { LARGE, page } from './helpers/galaxy-page.mjs';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const NO_TIMERS = { setTimeout: () => 0, clearTimeout() {} };

// The real frame and hud, with a fake caption (the plate is not what this is about).
function words() {
  const root = makeEl('div');
  const frame = createFrame(root, { timers: NO_TIMERS });
  const caption = { show() {}, hide() {}, cover: () => null };
  const hud = createHud({ caption, frame, timers: NO_TIMERS });
  hud.update({ nodes: LARGE });
  return { root, frame, hud };
}

// main.js's hold read (pinned against its source below), on a camera.
function holdRead(cam, hud) {
  let holdSeen = -1, holdFlying = false;
  cam.onDraw(() => {
    const v = cam.version();
    if (v === holdSeen && !holdFlying) return;
    holdSeen = v;
    holdFlying = cam.flight() != null;
    const w = cam.want();
    hud.hold(w.kind === 'site' && !holdFlying ? w.id : null);
  });
}

const withDoc = (fn) => () => {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
};

test('hud.hold: data-hold is the tone of the held site\'s worst, none off a site; a newer model reads it again', withDoc(() => {
  const { root, frame, hud } = words();
  assert.equal(frame.el.fleet.dataset.step, 'far', 'hv2 is crit: the banner at its far step');
  assert.equal('hold' in root.dataset, false, 'nothing held yet');
  hud.hold('hv2');
  assert.equal(root.dataset.hold, 'crit');
  hud.hold('lab');
  assert.equal(root.dataset.hold, 'warn', 'hv1 (id lab) has warn members');
  hud.hold('home');
  assert.equal(root.dataset.hold, 'grey');
  hud.hold(null);
  assert.equal('hold' in root.dataset, false);
  hud.hold('no-such-site');
  assert.equal('hold' in root.dataset, false, 'a site the model does not have holds nothing');
  // The held site's trouble rises: the next model says so with no new hold call.
  hud.hold('home');
  const worse = LARGE.map((n) => (n.parent === 'home' && n.kind !== 'site' ? { ...n, status: 'crit', why: 'gone' } : n));
  assert.ok(worse.some((n, i) => n !== LARGE[i]), 'home has members');
  hud.update({ nodes: worse });
  assert.equal(root.dataset.hold, 'crit');
}));

test('frame.hold reads the far block again: the line changed size with it', withDoc(() => {
  const { frame } = words();
  const fleet = frame.el.fleet;
  let h = 200;
  for (const [k, v] of [['offsetLeft', 900], ['offsetTop', 600], ['offsetWidth', 400]]) Object.defineProperty(fleet, k, { value: v, configurable: true });
  Object.defineProperty(fleet, 'offsetHeight', { get: () => h, configurable: true });
  assert.equal(frame.cover().bottom, 800);
  h = 60;
  frame.hold('crit');
  assert.equal(frame.cover().bottom, 660, 'read again as the hold came');
  h = 200;
  frame.hold('crit');
  assert.equal(frame.cover().bottom, 660, 'the same hold twice reads nothing');
  frame.hold(false);
  assert.equal(frame.cover().bottom, 800, 'and again as it went');
}));

test('the step follows the camera, plate or not: none in the flight, the tone on landing, none out at the overview', withDoc(() => {
  const p = page();
  const { root, hud } = words();
  holdRead(p.cam, hud);
  p.run(200);
  assert.equal('hold' in root.dataset, false, 'the overview: the 3 m size');
  // A tapped crit site (its card, no plate: pickCard releases the plate): flying, then held.
  p.tapAt(10, p.cam.screenOf('hv2'));
  p.run(FLIGHT.ms / 2);
  assert.ok(p.cam.flight(), 'still flying');
  assert.equal('hold' in root.dataset, false, 'in the flight the banner is still the headline');
  assert.equal('plate' in root.dataset, false, 'no plate at any point here');
  p.run(FLIGHT.ms / 2 + OPEN_MS);
  assert.equal(p.cam.flight(), null, 'landed');
  assert.equal(root.dataset.hold, 'crit', 'held, no plate: the banner is at its one-line step');
  // A turn of the held system keeps the hold (the site stays the want).
  const at = p.cam.screenOf('hv2');
  p.drag(20, { x: at.x + 200, y: at.y + 40 }, 160, 0);
  p.run(4000); // past the drag's coast (it steers the camera with `hold` while it runs)
  assert.equal(p.cam.want().kind, 'site');
  assert.equal(root.dataset.hold, 'crit', 'turning it is still a hold');
  // On to the warn site: the flight lets the banner up, the landing keeps it (T30).
  p.cam.focus('lab', 1);
  p.tick(16);
  assert.equal('hold' in root.dataset, false, 'leaving: full size again at once');
  p.run(FLIGHT.ms + OPEN_MS);
  assert.equal(root.dataset.hold, 'warn');
  p.cam.fit();
  p.run(FLIGHT.ms + 200);
  assert.equal('hold' in root.dataset, false, 'out at the overview');
}));

test('wall.css: a crit hold takes the crit plate\'s one-line step, a calm one drops one step, a warn none', () => {
  const css = read('css/wall.css');
  const body = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)).trim();
  };
  // Every crit-plate rule of the far line (T19) has a crit-hold twin with the same declarations.
  const plateSels = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(\.wall-frame-layer\[data-plate="crit"\] \.wall-fleet\[data-step="far"\][^{]*)\{/g)].map((m) => m[1].trim());
  assert.ok(plateSels.length >= 5, plateSels.join('\n'));
  for (const sel of plateSels) assert.equal(body(sel.replace('data-plate', 'data-hold')), body(sel), sel);
  // Calm: one step, the hero's least, never level with the calm name (night 3 T22).
  assert.equal(body('.wall-frame-layer[data-hold="grey"] .wall-fleet[data-step="far"] .wall-fleet-line'), `font-size: min(var(--fleet-far), ${STEPS.heroMin}vmin);`);
  assert.ok(STEPS.heroMin >= 1.25 * STEPS.name);
  assert.ok(STEPS.heroMin < STEPS.hero, 'a real step down from the 3 m size');
  // Warn: no rule, the 3 m size.
  assert.doesNotMatch(css, /data-hold="(warn|low)"/);
});

test('galaxy/main.js reads the hold each frame of a move as the test does, before the names', () => {
  const js = read('js/wall/galaxy/main.js');
  const src = holdRead.toString().split('\n').slice(1, -1).map((l) => l.trim()).filter(Boolean);
  let at = js.indexOf('let holdSeen = -1, holdFlying = false;');
  assert.ok(at > 0);
  for (const line of src) {
    const i = js.indexOf(line, at);
    assert.ok(i >= at, `main.js has: ${line}`);
    at = i;
  }
  assert.ok(js.indexOf('hud.hold(') < js.indexOf('cam.onDraw(labels.draw)'), 'the names place round the new box');
});
