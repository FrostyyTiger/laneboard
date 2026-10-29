// Wall night 5 B1 (T6, the owner's `sk_sys=1`): an open system spreads 1.4x,
// no two planets closer on its plane than 13 % of its reach, what hangs below
// a planet moves with it, the arms move out with the room, and HV1's open
// names never overlap.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  galaxyLayout, spaceOut, foldAt, ARM, CLOSED, ROOM, SPACE_MIN, SPREAD, TIGHT,
} from '../public/js/wall/galaxy/layout.js';
import { layoutFor } from '../public/js/wall/variants/orbits.js';
import { createLabels, overlaps } from '../public/js/wall/galaxy/labels.js';
import { siteShot, FOV, OVERVIEW_MARGIN } from '../public/js/wall/galaxy/scene.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { tourSites } from '../public/js/wall/tour.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const byId = new Map(FLEET.map((n) => [n.id, n]));
const NAMED = new Set(['host', 'room', 'repo', 'builder']);
const flat = (o) => Math.hypot(o.x, o.z);

test('room: 1.4x spread, 13 % gap, the arms 1.24x, a folded cluster the size it was', () => {
  assert.deepEqual({ ...ROOM }, { spread: 1.4, gap: 0.13, arms: 1.24 });
  assert.equal(SPREAD, 2.2 * TIGHT.spread * ROOM.spread);
  assert.ok(Math.abs(CLOSED * ROOM.spread - 0.16) < 1e-12, 'folded: 0.16 of the old spread');
  assert.equal(ARM.r0, 1250 * TIGHT.arm * ROOM.arms);
  assert.equal(ARM.step, 180 * ROOM.arms);
  assert.equal(OVERVIEW_MARGIN, 400 * TIGHT.arm * ROOM.arms, 'the overview is the same picture from farther back');
});

test('room: every planet pair of every open system of the large demo stands at least 0.13 of its reach apart, clear of the star', () => {
  for (const s of galaxyLayout(FLEET).sites) {
    const planets = s.members.filter((m) => m.planet);
    if (planets.length < 2) continue;
    const reach = Math.max(...planets.map((m) => flat(m.off)));
    const gap = Math.max(SPACE_MIN, reach * ROOM.gap);
    for (let i = 0; i < planets.length; i++) {
      assert.ok(flat(planets[i].off) >= gap * 0.8 - 1e-6, `${s.id}: ${planets[i].id} clear of the star`);
      for (let j = i + 1; j < planets.length; j++) {
        const d = Math.hypot(planets[i].off.x - planets[j].off.x, planets[i].off.z - planets[j].off.z);
        assert.ok(d >= reach * ROOM.gap, `${s.id}: ${planets[i].id} and ${planets[j].id} ${d.toFixed(0)} apart, reach ${reach.toFixed(0)}`);
      }
    }
  }
});

test('room: on the large demo each child keeps its offset from its planet (the orbits layout\'s), give or take the dots\' step-off', () => {
  const { pos } = layoutFor(16 / 9)(FLEET);
  let exact = 0, all = 0;
  for (const s of galaxyLayout(FLEET).sites) {
    const planets = new Map(s.members.filter((m) => m.planet).map((m) => [m.id, m]));
    const reach = Math.max(...[...planets.values()].map((m) => flat(m.off)));
    const small = Math.max(SPACE_MIN, reach * ROOM.gap) * 0.55;
    for (const m of s.members) {
      if (m.planet) continue;
      let p = byId.get(m.node.parent);
      while (p && !planets.has(p.id)) p = byId.get(p.parent);
      if (!p) continue;
      const want = { x: (pos.get(m.id).x - pos.get(p.id).x) * SPREAD, z: (pos.get(m.id).y - pos.get(p.id).y) * SPREAD };
      const o = planets.get(p.id).off;
      const off = Math.hypot(m.off.x - o.x - want.x, m.off.z - o.z - want.z);
      assert.ok(off <= small, `${s.id}: ${m.id} ${off.toFixed(1)} off its place by ${p.id} (step-off ${small.toFixed(1)})`);
      all += 1;
      if (off < 1e-6) exact += 1;
    }
  }
  assert.ok(exact > all / 2, `most children exactly at their offset (${exact} of ${all})`);
});

test('spaceOut: two planets on top of each other part by the gap; each child moves with its planet', () => {
  const site = { id: 's', kind: 'site' };
  const list = [
    { id: 'a', kind: 'room', parent: 's' }, { id: 'b', kind: 'room', parent: 's' }, { id: 'c', kind: 'room', parent: 's' },
    { id: 'a1', kind: 'service', parent: 'a' }, { id: 'b1', kind: 'service', parent: 'b' },
  ];
  const ids = new Map([site, ...list].map((n) => [n.id, n]));
  const offs = new Map([
    ['a', { x: 200, z: 0 }], ['b', { x: 201, z: 0 }], ['c', { x: -400, z: 0 }],
    ['a1', { x: 200, z: 60 }], ['b1', { x: 201, z: -60 }],
  ]);
  spaceOut(list, offs, ids, site);
  const gap = 400 * ROOM.gap;
  const a = offs.get('a'), b = offs.get('b');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= gap - 1e-6, 'parted');
  assert.deepEqual(offs.get('c'), { x: -400, z: 0 }, 'a planet with room does not move');
  // The children kept their place against their planets (60 out, far over the dots' step-off).
  assert.ok(Math.abs(offs.get('a1').x - a.x) < 1e-9 && Math.abs(offs.get('a1').z - a.z - 60) < 1e-9);
  assert.ok(Math.abs(offs.get('b1').x - b.x) < 1e-9 && Math.abs(offs.get('b1').z - b.z + 60) < 1e-9);
  // One planet: nothing to part.
  const one = new Map([['a', { x: 1, z: 0 }]]);
  spaceOut([list[0]], one, ids, site);
  assert.deepEqual(one.get('a'), { x: 1, z: 0 });
  // Folded, the cluster is the same size it was before the room.
  assert.ok(Math.abs(foldAt(0, { x: 100, y: 0, z: 0 }).x - 100 * CLOSED) < 1e-12);
});

// A DOM just big enough for createLabels (as test/wall-galaxy-labels.test.mjs).
function fakeDoc() {
  const el = () => ({
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, dataset: {}, textContent: '', className: '', remove() {}, append: () => {},
  });
  return { doc: { createElement: el }, root: el() };
}

test('room: HV1 open at 1368 px names every room and builder, and no two shown names overlap', () => {
  const status = new Map(tourSites(FLEET).map((s) => [s.id, s.status]));
  const lay = galaxyLayout(FLEET, undefined, status.keys());
  const sites = lay.sites.map((s) => {
    const open = s.id === 'lab' ? 1 : 0;
    const members = s.members.map((m) => {
      const k = open ? 1 : CLOSED;
      const p = new THREE.Vector3(s.home.x + m.off.x * k, s.home.y + m.off.y * k, s.home.z + m.off.z * k);
      return { ...m, tone: toneOf(m.node), mesh: { position: p } };
    });
    return { ...s, members, open, status: status.get(s.id) ?? s.node.status };
  });
  const world = { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
  const lab = world.byId.get('lab');
  const W = 1368, H = 912;
  for (const now of [0, 30_000, 90_000]) {
    const shot = siteShot(lab, now);
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
    camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
    camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
    camera.updateMatrixWorld();
    const { doc, root } = fakeDoc();
    const labels = createLabels(root, { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } }, { steps: { site: 26, room: 15 }, doc });
    labels.draw();
    const shown = labels.shown();
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) assert.ok(!overlaps(shown[i].box, shown[j].box), `@${now}: ${shown[i].id} and ${shown[j].id} overlap`);
    }
    const ids = new Set(shown.map((s) => s.id));
    for (const m of lab.members.filter((x) => x.planet)) assert.ok(ids.has(m.id), `@${now}: ${m.id} named`);
  }
});
