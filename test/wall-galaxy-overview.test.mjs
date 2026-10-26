// Wall night 2 T19 (reviews/r15-dreamer.md 2): at the overview CLOUD sat
// under the far fleet block, so the hallway counted four systems of five.
// overview.js slides (and if it must, stands back) the overview until every
// site's star and name are clear of the words, eased, held while it clears.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { overviewShot, FOV, SIZE } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { candidates, labelRank, labelSize, labelText, placeLabels, RANK } from '../public/js/wall/galaxy/labels.js';
import { toneOf, worseTone } from '../public/js/wall/galaxy/palette.js';
import {
  createOverviewFit, fitOverview, fitShot, siteMarks, NO_FIT, OVERVIEW_FIT,
} from '../public/js/wall/galaxy/overview.js';
import { tourSites } from '../public/js/wall/tour.js';
import { pxPerMm, screenOf, stepsFor } from '../public/js/wall/type.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

// The tablet's css frame (dpr 2) and the boxes measured on galaxy.html there
// (round 36, as test/wall-galaxy-framing.test.mjs): the widest plate, the far fleet block, the tag.
const W = 1368, H = 912;
const PLATE = { left: 82, top: 73, right: 793, bottom: 560 };
const FLEET_BLOCK = { left: 496, top: 675, right: 1369, bottom: 912 };
const TAG = { left: 992, top: 95, right: 1286, bottom: 111 };
const STEPS = stepsFor(pxPerMm(screenOf(new URLSearchParams(), { dpr: 2, cssHeight: H })));

/** The large demo's sites as the scene holds them: layout plus the tour's rolled-up status. */
function world() {
  const status = new Map(tourSites(FLEET).map((s) => [s.id, s.status]));
  return galaxyLayout(FLEET).sites.map((s) => ({ ...s, status: status.get(s.id) ?? s.node.status }));
}

/** The names labels.js would show seen from `shot` (sites folded, and the sun), through a real three camera. */
function shownFrom(shot, sites, covers) {
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  cam.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  cam.lookAt(shot.look.x, shot.look.y, shot.look.z);
  cam.updateMatrixWorld();
  const v = new THREE.Vector3();
  const items = [];
  const add = (id, node, p, radius, kind, tone) => {
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    v.applyMatrix4(cam.projectionMatrix);
    const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
    const r = radius * (H / (2 * Math.tan((FOV * Math.PI) / 360) * depth));
    const { w, h } = labelSize(labelText(node, tone), STEPS.site, 'label');
    const rank = labelRank(kind, tone);
    items.push({ id, rank, near: r, cands: candidates(x, y, r, w, h, rank === RANK.trouble) });
  };
  const core = FLEET.find((n) => n.kind === 'core');
  if (core) add(core.id, core, { x: 0, y: 0, z: 0 }, SIZE.sun, 'core', toneOf(core));
  for (const s of sites) add(s.id, s.node, s.home, SIZE.star, 'site', worseTone(toneOf(s.node), toneOf(s.status)));
  return placeLabels(items, { W, H, covers });
}

const view = (covers) => ({ fov: FOV, W, H, covers });

test('without the fit the overview hides a site under the fleet block (the bug); with it every site is named', () => {
  const sites = world();
  const covers = [FLEET_BLOCK, TAG];
  const bare = shownFrom(overviewShot(sites, 0), sites, covers);
  assert.ok(sites.some((s) => !bare.has(s.id)), 'the plain overview loses a site (CLOUD on round 37)');
  const fit = fitOverview(overviewShot(sites, 0), siteMarks(sites, STEPS.site), view(covers));
  assert.equal(fit.clear, true);
  const shown = shownFrom(fitShot(overviewShot(sites, 0), fit, FOV, W / H), sites, covers);
  for (const s of sites) assert.ok(shown.has(s.id), `${s.id} named at the overview`);
});

test('as the overview turns, the eased fit keeps every site named, and never jumps', () => {
  const sites = world();
  const covers = [FLEET_BLOCK, TAG];
  const fit = createOverviewFit({ view: () => view(covers), marks: (ss) => siteMarks(ss, STEPS.site) });
  let prev = null, maxStep = 0;
  for (let t = 0; t <= 7 * 60_000; t += 50) {
    const shot = fit(overviewShot(sites, t), sites, t);
    if (prev) {
      const step = Math.hypot(shot.pos.x - prev.pos.x, shot.pos.y - prev.pos.y, shot.pos.z - prev.pos.z);
      maxStep = Math.max(maxStep, step);
      assert.ok(step < 30, `@${t}: the camera moved ${step.toFixed(1)} world units in one 50 ms frame`);
    }
    prev = shot;
    // Checked once the ease after a refit has settled (a refit starts at half the gap).
    if (t % 15_000 === 0) {
      const shown = shownFrom(shot, sites, covers);
      for (const s of sites) assert.ok(shown.has(s.id), `@${t}: ${s.id} named`);
    }
  }
});

test('reduced motion: the overview with the widest plate up as well still names every site', () => {
  const sites = world();
  const covers = [PLATE, FLEET_BLOCK, TAG];
  const fit = createOverviewFit({ view: () => view(covers), marks: (ss) => siteMarks(ss, STEPS.site), easeMs: 0 });
  const shot = fit(overviewShot(sites, 0), sites, 0);
  const shown = shownFrom(shot, sites, covers);
  for (const s of sites) assert.ok(shown.has(s.id), `${s.id} named beside the plate`);
  assert.deepEqual(fit(overviewShot(sites, 0), sites, 5000), shot, 'and it holds: nothing moves in reduced motion');
});

test('fitShot slides and stands back without turning; no covers, no change', () => {
  const sites = world();
  const shot = overviewShot(sites, 0);
  assert.deepEqual(fitShot(shot, NO_FIT, FOV, W / H), shot);
  const dir = (q) => { const l = Math.hypot(q.look.x - q.pos.x, q.look.y - q.pos.y, q.look.z - q.pos.z); return [(q.look.x - q.pos.x) / l, (q.look.y - q.pos.y) / l, (q.look.z - q.pos.z) / l]; };
  const moved = fitShot(shot, { k: 1.3, dx: -0.2, dy: 0.15 }, FOV, W / H);
  dir(moved).forEach((d, i) => assert.ok(Math.abs(d - dir(shot)[i]) < 1e-9, 'same direction'));
  const back = (q) => Math.hypot(q.pos.x - q.look.x, q.pos.y - q.look.y, q.pos.z - q.look.z);
  assert.ok(Math.abs(back(moved) / back(shot) - 1.3) < 1e-9);
  assert.deepEqual(fitOverview(shot, siteMarks(sites, STEPS.site), view([])), { ...NO_FIT, clear: true });
  assert.deepEqual(fitOverview(shot, [], view([FLEET_BLOCK])), { ...NO_FIT, clear: true });
  // the pull never passes the last one allowed
  const walls = view([{ left: 0, top: 0, right: W, bottom: H }]);
  const none = fitOverview(shot, siteMarks(sites, STEPS.site), walls);
  assert.equal(none.clear, false);
  assert.ok(none.k <= OVERVIEW_FIT.pulls.at(-1));
});

test('siteMarks: the folded name in its worst tone, trouble flagged, a going site left out', () => {
  const sites = world();
  const marks = siteMarks(sites, STEPS.site);
  assert.equal(marks.length, sites.length);
  for (const [i, s] of sites.entries()) {
    const tone = worseTone(toneOf(s.node), toneOf(s.status));
    assert.equal(marks[i].w, labelSize(labelText(s.node, tone), STEPS.site, 'label').w);
    assert.equal(marks[i].trouble, tone === 'warn' || tone === 'crit');
  }
  assert.equal(siteMarks([{ ...sites[0], alive: 0.2 }], STEPS.site).length, 0);
});

test('the camera uses the fitter at the overview, still or turning, and not on a held site', () => {
  const sites = world();
  const galaxy = {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    camera: new THREE.PerspectiveCamera(FOV, W / H, 1, 30000),
    setOpen: (id, k) => { sites.find((s) => s.id === id).open = k; },
  };
  const calls = [];
  const fitOv = (shot, ss, now) => { calls.push(now); return { pos: { ...shot.pos, y: shot.pos.y + 1 }, look: shot.look }; };
  const cam = createGalaxyCamera(galaxy, { fitOverview: fitOv });
  const pose = cam.frame(1000);
  assert.equal(pose.pos.y, overviewShot(sites, 1000).pos.y + 1);
  cam.focus(sites[0].id);
  cam.frame(1100);
  cam.frame(10_000);
  assert.ok(calls.length >= 1 && calls.length <= 2, 'the overview is only asked for while it is a flight\'s start or the target');
  const still = createGalaxyCamera(galaxy, { still: true, fitOverview: fitOv });
  assert.equal(still.frame(5000).pos.y, overviewShot(sites, 0).pos.y + 1);
});
