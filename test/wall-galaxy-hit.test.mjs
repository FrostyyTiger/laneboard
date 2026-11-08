// Hit targets in screen space, no picker (Wall plan night 5 C1, T11): a tap
// reaches 48 css px round a drawn centre for a finger (or a pen) and 28 for a
// mouse, by the pointer event's `pointerType`, and the nearest centre wins.
// The owner: "it's so tiny I need to select which one I meant", so night 4's
// fan (the planets under one finger as rows for a second tap) is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeEl } from './helpers/fakedom.mjs';
import { TAP, createTaps, createTouch, hitNearest, hitRadius, memberHit } from '../public/js/wall/galaxy/touch.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** A fakedom element that keeps its listeners, so pointer events can be dispatched on it. */
function stageEl() {
  const el = makeEl('main');
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, init = {}) => {
    const ev = { type, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, ...init, preventDefault() {}, stopPropagation() {} };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  return el;
}

const pt = (id, x, y, tone = 'calm', extra = {}) => ({ id, x, y, r: 4, tone, box: null, ...extra });

test('hitRadius: 48 css px for a finger or a pen (the cockpit\'s D224 floor), 28 for a mouse', () => {
  assert.equal(TAP.fingerPx, 48);
  assert.equal(TAP.mousePx, 28);
  assert.equal(hitRadius('touch'), 48);
  assert.equal(hitRadius('pen'), 48);
  assert.equal(hitRadius('mouse'), 28);
  assert.equal(hitRadius(undefined), 48, 'an event that does not say is a finger: the larger reach');
});

test('hitNearest: of two members under one finger the nearest centre wins, whatever their tones', () => {
  const near = pt('builder-a', 410, 300);
  const far = pt('builder-b', 360, 300, 'crit');
  assert.equal(hitNearest([near, far], 400, 300)?.id, 'builder-a', 'nearer beats louder: no picker, no guess by tone');
  assert.equal(hitNearest([far, near], 400, 300)?.id, 'builder-a', 'whatever the order');
  assert.equal(hitNearest([near, far], 375, 300)?.id, 'builder-b');
  // Within 2 px of each other the two are one distance: the louder takes it.
  const twin = pt('vm-c', 390, 300, 'warn');
  assert.equal(hitNearest([near, twin], 400.5, 300)?.id, 'vm-c', 'a tie goes to the louder');
  assert.equal(hitNearest([], 1, 1), null);
  assert.equal(hitNearest([pt('x', NaN, 0, 'crit')], 0, 0), null, 'nothing placed, nothing hit');
});

test('hitNearest: a mouse 30 px off a member picks nothing, a finger 30 px off picks it', () => {
  const p = [pt('hv1', 400, 300)];
  assert.equal(hitNearest(p, 430, 300, hitRadius('mouse')), null, 'a mouse aims: 30 px is a miss');
  assert.equal(hitNearest(p, 430, 300, hitRadius('touch'))?.id, 'hv1', 'a finger covers it');
  assert.equal(hitNearest(p, 400, 300 + TAP.fingerPx + 1, hitRadius('touch')), null, 'past the finger\'s reach');
  assert.equal(hitNearest(p, 400 + TAP.mousePx, 300, hitRadius('mouse'))?.id, 'hv1', 'the mouse\'s reach is inclusive');
  // A drawn sphere bigger than the reach counts whole; a shown name counts as 0 away; a pillar by its nearest point.
  assert.equal(hitNearest([{ ...p[0], r: 80 }], 470, 300, hitRadius('mouse'))?.id, 'hv1');
  const named = pt('hv2', 100, 100, 'calm', { box: { x: 130, y: 90, w: 160, h: 24 } });
  assert.equal(hitNearest([named, pt('hv3', 290, 100)], 285, 100)?.id, 'hv2', 'a finger on a name is on its site');
  const beam = pt('hv4', 600, 600, 'calm', { beam: { x0: 600, y0: 600, x1: 600, y1: 300 } });
  assert.equal(hitNearest([beam], 620, 400, hitRadius('mouse'))?.id, 'hv4');
});

test('memberHit: two planets under one finger give the nearer, never a fan or a null', () => {
  const a = pt('builder-a', 100, 100), b = pt('builder-b', 140, 100);
  assert.equal(memberHit([a, b], 118, 100)?.id, 'builder-a');
  assert.equal(memberHit([a, b], 122, 100)?.id, 'builder-b');
});

test('taps hand pick the pointer event: a mouse 30 px off a planet taps empty sky, a finger 30 px off taps the planet', () => {
  const stage = stageEl();
  let now = 1000;
  const touch = createTouch(stage, { role: 'explore', clock: () => now });
  const planets = [pt('builder-a', 400, 300)];
  const tapped = [];
  createTaps(touch, {
    clock: () => now,
    pick: (x, y, ev) => hitNearest(planets, x, y, hitRadius(ev?.pointerType)),
    tap: (hit) => tapped.push(hit?.id ?? null),
  });
  const tapAt = (pointerType, x, y) => {
    stage.dispatch('pointerdown', { pointerId: 7, pointerType, clientX: x, clientY: y });
    now += 80;
    stage.dispatch('pointerup', { pointerId: 7, pointerType, clientX: x, clientY: y });
    now += 500;
  };
  tapAt('mouse', 430, 300);
  tapAt('touch', 430, 300);
  tapAt('pen', 400, 330);
  tapAt('mouse', 410, 300);
  assert.deepEqual(tapped, [null, 'builder-a', 'builder-a', 'builder-a']);
});

test('no picker left: fan.js, its test and its wiring are gone; main.js picks the nearest by the event\'s reach', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'public/js/wall/galaxy/fan.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'test/wall-galaxy-fan.test.mjs')), false);
  const js = read('public/js/wall/galaxy/main.js');
  assert.doesNotMatch(js, /createFan|fan\.js|galaxy-fan|__galaxyFan|fan\?\./, 'no fan in the page');
  const pick = js.slice(js.indexOf('pick: (x, y, ev) =>'), js.indexOf('tap: (hit)'));
  assert.match(pick, /const reach = hitRadius\(ev\?\.pointerType\);/);
  assert.match(pick, /memberHit\(memberPoints\(galaxy\.world\?\.sites, cam\.screenOf, names\), x - o\.left, y - o\.top, reach\)/);
  assert.match(pick, /hitNearest\(tapPoints\(/);
  const touchJs = read('public/js/wall/galaxy/touch.js');
  assert.match(touchJs, /o\.pick\(ev\.clientX, ev\.clientY, ev\)/, 'createTaps passes the event on');
  assert.doesNotMatch(touchJs, /export function (hitAll|ringHit)\b/, 'the fan\'s helpers went with it');
});
