// The galaxy page in `explore` on the large demo, wired as galaxy/main.js
// wires it (night 5 T13, shared with T16): the real scene with a fake
// renderer, stage and clock; the touch, gestures, taps (a member first, then
// a site), Back control, director and camera; main.js's toOverview,
// openSite, openPlanet, pickCard, backToSite and goBack copied (and pinned against its
// source in test/wall-galaxy-back.test.mjs); the node card (night 5 T17) as main.js makes it.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { OPEN_MS } from '../../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, FLIGHT } from '../../public/js/wall/galaxy/camera.js';
import { ZOOM_OUT, createDirector } from '../../public/js/wall/galaxy/director.js';
import { freeRect } from '../../public/js/wall/galaxy/framing.js';
import { cardBodies, cardRing, createCard, describe } from '../../public/js/wall/galaxy/card.js';
import {
  AT_OVERVIEW, TAP, TOUCH, backControl, backStep, canGoBack, createBack, createGestures, createReturn, createTaps, createTouch,
  hitNearest, memberHit, memberPoints, moonsAt, orbitLimits, placeOf, tapPoints,
} from '../../public/js/wall/galaxy/touch.js';
import { TIMING } from '../../public/js/wall/tour.js';
import { makeEl } from './fakedom.mjs';


export const LARGE = JSON.parse(fs.readFileSync(new URL('../fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
export const W = 1368, H = 912;
const WORDS = [{ left: 110, top: 70, right: 780, bottom: 570 }, { left: 990, top: 90, right: 1285, bottom: 135 }, { left: 670, top: 690, right: 1285, bottom: 840 }];
export const BA = 'builder:builder-a';
export const SKY = { x: 24, y: H - 24 };

const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    }),
  }),
};

/** A fakedom element that keeps its listeners, so pointer events can be dispatched on it. */
export function listening(tag) {
  const el = makeEl(tag);
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, init = {}) => {
    const ev = { type, pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, ...init, preventDefault() {}, stopPropagation() { ev.stopped = true; } };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  return el;
}

/** The page on the large demo in `explore`, wired as main.js (night 5 T13). */
export function page() {
  let now = 50_000;
  const galaxy = createGalaxyScene({ clientWidth: W, clientHeight: H }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
  });
  galaxy.update({ nodes: LARGE });
  const cam = createGalaxyCamera(galaxy, { steer: true, free: () => freeRect(W, H, WORDS) });
  const director = createDirector(cam, { clock: () => now, driver: 'touch' });
  const moves = [];
  director.onMove((m) => moves.push(m));
  const finger = director.as('touch');
  const stage = listening('main');
  const button = listening('button');
  const touch = createTouch(stage, { clock: () => now, role: 'explore' });
  const sheets = [];
  const hud = { open: ({ id }) => sheets.push(id), release: () => sheets.push(null) };
  let place = AT_OVERVIEW;
  let moonsAsked = null;
  const left = createReturn();
  const reduced = false;
  const card = createCard(stage, {
    // The plate goes when the card comes (pickCard): the fleet line and the tag stay.
    screenOf: cam.screenOf, size: galaxy.size, covers: () => WORDS.slice(1),
    bodies: (id) => cardBodies(galaxy.world, place.site, id, cam.screenOf),
    ring: (id) => cardRing(galaxy.world, place.site, id, cam.screenOf),
    flying: () => cam.flight() != null,
    onClose: () => card.close(), onPick: (id) => openPlanet(id, place.site), doc: { createElement: (t) => listening(t) },
  });
  cam.onDraw(card.draw);
  const pickCard = (id, site) => {
    hud.release();
    card.open(describe({ id, site }, galaxy.world));
  };
  // main.js's, as written there.
  const toOverview = (pose = null, out = { ms: TOUCH.fitMs }) => {
    if (pose && !reduced) finger.fly(pose, out);
    else finger.fit(out);
    hud.release();
    card.close();
    place = AT_OVERVIEW;
  };
  const openSite = (id) => {
    left.leave(place, cam);
    const w = cam.want();
    const there = w.kind === 'site' && w.id === id && w.member == null;
    if (!there) finger.focus(id, TIMING.zoom);
    card.close();
    hud.open({ id });
    place = placeOf(id);
  };
  const hostOf = (site, id) => {
    const m = galaxy.world?.byId.get(site)?.members.find((x) => x.id === id);
    return m?.moon ? m.moon.host?.id ?? m.moon.host ?? null : null;
  };
  const openPlanet = (id, site) => {
    left.leave(place, cam);
    pickCard(id, site);
    const w = cam.want();
    const host = hostOf(site, id);
    const framed = w.kind === 'site' && w.id === site && w.member != null && (hostOf(site, w.member) ?? w.member) === (host ?? id);
    if (!framed) finger.focus(site, TIMING.zoom, { member: id });
    place = host != null ? placeOf(site, host, id) : placeOf(site, id);
  };
  const backToSite = (id) => {
    const w = cam.want();
    const kept = w.kind === 'site' && w.id === id && (w.turned != null || w.member == null);
    if (!kept) finger.focus(id, TIMING.zoom, ZOOM_OUT);
    card.close();
    hud.open({ id });
    place = placeOf(id);
  };
  const goBack = () => {
    touch.poke();
    if (!canGoBack(place)) return;
    const next = backStep(place);
    if (next.level === 'planet') {
      pickCard(next.planet, next.site);
      place = next;
    } else if (next.level === 'site') backToSite(next.site);
    else toOverview(left.pose(), ZOOM_OUT);
  };
  const back = createBack(button, { back: goBack, tour: () => {} });
  const gestures = createGestures(stage, touch, finger, {
    clock: () => now,
    limits: () => orbitLimits(cam.home(), galaxy.world.sites),
    view: () => ({ ...galaxy.size(), fov: galaxy.camera.fov }),
    pivot: () => {
      const w = cam.want();
      return w.kind === 'site' ? galaxy.world.byId.get(w.id)?.home ?? null : null;
    },
  });
  let picks = 0;
  createTaps(touch, {
    clock: () => now,
    pick: (x, y, ev) => {
      picks += 1;
      const reach = ev?.pointerType === 'mouse' ? TAP.mousePx : TAP.fingerPx;
      return memberHit(memberPoints(galaxy.world.sites, cam.screenOf), x, y, reach)
        ?? hitNearest(tapPoints(galaxy.world.sites, cam.screenOf), x, y, reach);
    },
    tap: (hit) => { if (hit?.covered) return; if (hit?.site) openPlanet(hit.id, hit.site); else if (hit) openSite(hit.id); },
    back: () => goBack(),
  });
  const tick = (ms = 16) => {
    now += ms;
    const m = touch.mode();
    back.show(backControl(m, place));
    const moonsFor = moonsAt(place);
    if (moonsFor !== moonsAsked) { moonsAsked = moonsFor; galaxy.openMoons(moonsFor); }
    if (card.shown() && card.selected() !== (place.moon ?? place.planet)) card.close();
    director.tick();
    gestures.frame(now);
    cam.frame(now);
    galaxy.frame(now);
    cam.drawn(); // as main.js: the card draws where the camera is now
  };
  const run = (ms) => { for (let t = 0; t < ms; t += 16) tick(16); };
  const tapAt = (id, sp, init = {}) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y, ...init });
    tick(60);
    stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y, ...init });
  };
  const rightClick = (id, sp, holdMs = 80) => {
    const m = { pointerType: 'mouse', button: 2 };
    stage.dispatch('pointerdown', { pointerId: id, clientX: sp.x, clientY: sp.y, ...m });
    run(holdMs);
    stage.dispatch('pointerup', { pointerId: id, clientX: sp.x, clientY: sp.y, ...m });
    stage.dispatch('contextmenu', { ...m });
  };
  const doubleTap = (id, sp, init = {}) => { tapAt(id, sp, init); tick(120); tapAt(id + 1, sp, init); };
  const press = () => {
    for (const type of ['pointerdown', 'pointerup']) button.dispatch(type, { pointerId: 90 });
    button.dispatch('click');
  };
  const drag = (id, from, dx, dy, steps = 20) => {
    stage.dispatch('pointerdown', { pointerId: id, clientX: from.x, clientY: from.y });
    for (let i = 1; i <= steps; i++) {
      stage.dispatch('pointermove', { pointerId: id, clientX: from.x + (dx * i) / steps, clientY: from.y + (dy * i) / steps });
      tick(16);
    }
    stage.dispatch('pointerup', { pointerId: id, clientX: from.x + dx, clientY: from.y + dy });
  };
  // Into HV1's system and onto builder-a, its ring open.
  const toBuilder = () => {
    run(200);
    tapAt(10, cam.screenOf('lab'));
    run(FLIGHT.ms + OPEN_MS + 200);
    assert.ok(galaxy.world.byId.get('lab').open > 0.99, 'lab is open');
    tapAt(11, cam.screenOf(BA));
    run(FLIGHT.ms + OPEN_MS + 200);
    assert.deepEqual([place.level, place.planet], ['planet', BA], 'builder-a picked');
    assert.equal(galaxy.moonsOpen(), BA, 'its ring is open');
  };
  const isSky = (sp) => memberHit(memberPoints(galaxy.world.sites, cam.screenOf), sp.x, sp.y) == null
    && hitNearest(tapPoints(galaxy.world.sites, cam.screenOf), sp.x, sp.y) == null;
  return {
    galaxy, cam, touch, button, stage, card, sheets, moves, run, tick, tapAt, rightClick, doubleTap, press, drag, toBuilder, isSky,
    place: () => place, picks: () => picks, now: () => now,
  };
}

export const samePose = (a, b, eps = 1e-6) => ['pos', 'look'].every((k) => ['x', 'y', 'z'].every((c) => Math.abs(a[k][c] - b[k][c]) <= eps));

/** How long the camera flies after a move (ms, in 16 ms frames): until `flight()` is null. */
export function flown(p, max = 6000) {
  let t = 0;
  while (p.cam.flight() && t < max) { p.tick(16); t += 16; }
  return t;
}
