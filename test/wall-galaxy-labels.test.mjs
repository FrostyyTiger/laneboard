// The galaxy's names (Wall plan night 2 T6): the screen pass never shows two
// names on top of each other, a trouble name always wins its place, and on
// the large demo the busiest builder's system held by the tour's camera
// names its trouble lanes without a pile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from '../public/vendor/three/three.module.js';
import {
  placeLabels, candidates, overlaps, boxOf, dotNamed, labelRank, labelText, labelSize, labelFace,
  createLabels, stacks, GAP, RANK, DOT_NAMED_PX, OPEN_FADE,
} from '../public/js/wall/galaxy/labels.js';
import { galaxyLayout, rng } from '../public/js/wall/galaxy/layout.js';
import { siteShot, FOV } from '../public/js/wall/galaxy/scene.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { tourSites } from '../public/js/wall/tour.js';


const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const STATUS = new Map(tourSites(FLEET).map((s) => [s.id, s.status]));
const worstOf = (s) => STATUS.get(s.id) ?? s.node.status;
const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

const noOverlap = (boxes) => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], boxes[j]), `boxes ${i} and ${j} overlap: ${JSON.stringify([boxes[i], boxes[j]])}`);
    }
  }
};

test('placeLabels: a crowd never shows two names on top of each other', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const items = Array.from({ length: 80 }, (_, i) => {
      const rank = Math.floor(r() * 4);
      return { id: `n${i}`, rank, near: r() * 20, cands: candidates(200 + r() * 400, 150 + r() * 300, 4 + r() * 10, 40 + r() * 80, 16, rank === RANK.trouble) };
    });
    const shown = placeLabels(items, { W: 800, H: 600 });
    assert.ok(shown.size > 0);
    noOverlap([...shown.values()].map((s) => s.box));
    for (const { box } of shown.values()) {
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 800 && box.y + box.h <= 600, 'on screen');
    }
  }
});

test('placeLabels: a trouble name wins over a site, a room and the rest in its place', () => {
  const at = (id, rank, near = 0) => ({ id, rank, near, cands: [{ x: 100, y: 100, w: 80, h: 20 }] });
  for (const other of [RANK.site, RANK.room, RANK.rest]) {
    // Whatever order they come in, and however close the other is.
    for (const items of [[at('calm', other, 99), at('bad', RANK.trouble)], [at('bad', RANK.trouble), at('calm', other, 99)]]) {
      const shown = placeLabels(items, { W: 800, H: 600, was: new Set(['calm']) });
      assert.deepEqual([...shown.keys()], ['bad']);
    }
  }
});

test('placeLabels: in a crowd every trouble name that has a free side is shown', () => {
  const r = rng(5);
  const items = [];
  for (let i = 0; i < 60; i++) items.push({ id: `c${i}`, rank: RANK.site, near: 100, cands: candidates(300 + r() * 100, 300 + r() * 100, 8, 90, 20) });
  for (let i = 0; i < 4; i++) items.push({ id: `t${i}`, rank: RANK.trouble, near: 0, cands: candidates(300 + i * 120, 200, 8, 90, 20, true) });
  const shown = placeLabels(items, { W: 1200, H: 800 });
  for (let i = 0; i < 4; i++) assert.ok(shown.has(`t${i}`), `t${i} shown`);
  noOverlap([...shown.values()].map((s) => s.box));
});

test('placeLabels: a lower name tries its other sides, keeps last frame\'s, and stays clear of covers and edges', () => {
  const hi = { id: 'site', rank: RANK.site, cands: candidates(100, 100, 10, 60, 20) };
  const lo = { id: 'room', rank: RANK.room, cands: candidates(100, 100, 10, 60, 20) };
  const first = placeLabels([lo, hi], { W: 800, H: 600 });
  assert.equal(first.get('site').at, 0);
  assert.equal(first.get('room').at, 1, 'the left side, the right is taken');
  // Last frame it sat below: it keeps that while it is free.
  const kept = placeLabels([{ ...lo, prefer: 3 }, hi], { W: 800, H: 600 });
  assert.equal(kept.get('room').at, 3);
  // A cover (caption.js coverOf's shape) takes the right; the edge takes nothing off screen.
  const covered = placeLabels([hi], { W: 800, H: 600, covers: [{ left: 105, top: 0, right: 400, bottom: 400 }] });
  assert.equal(covered.get('site').at, 1);
  assert.equal(placeLabels([{ id: 'far', rank: 1, cands: candidates(-200, 100, 4, 60, 20) }], { W: 800, H: 600 }).size, 0);
  // A sphere on screen: a name covers no body but its own.
  const sphere = { x: 112, y: 80, w: 40, h: 40, owner: 'other' };
  assert.equal(placeLabels([hi], { W: 800, H: 600, bodies: [sphere] }).get('site').at, 1);
  assert.equal(placeLabels([hi], { W: 800, H: 600, bodies: [{ ...sphere, owner: 'site' }] }).get('site').at, 0);
  assert.deepEqual(boxOf({ left: 1, top: 2, right: 4, bottom: 8 }), { x: 1, y: 2, w: 3, h: 6 });
  assert.equal(boxOf(null), null);
});

test('ranks, words, sizes: trouble first, sites caps, the rest lowercase with the shape when it needs you', () => {
  assert.equal(labelRank('lane', 'crit'), RANK.trouble);
  assert.equal(labelRank('site', 'warn'), RANK.trouble);
  assert.equal(labelRank('site', 'calm'), RANK.site);
  assert.equal(labelRank('core', 'calm'), RANK.site);
  assert.equal(labelRank('room', 'calm'), RANK.room);
  assert.equal(labelRank('builder', 'low'), RANK.room, 'low is not trouble');
  assert.equal(labelRank('service', 'calm'), RANK.rest);
  assert.equal(labelText({ kind: 'site', label: 'hv1', status: 'ok' }), 'HV1');
  assert.equal(labelText({ kind: 'room', label: 'Storage', status: 'crit' }), '■ storage');
  assert.equal(labelText({ kind: 'site', label: 'hv2', status: 'ok' }, 'crit'), '■ HV2', 'a folded site in its worst tone');
  assert.equal(labelText({ kind: 'lane', id: 'x', label: 'feat-search', status: 'attention' }), '▲ feat-search');
  const caps = labelSize('HV1', 26, 'label'), mono = labelSize('hv1', 26, 'mono');
  assert.ok(mono.w > caps.w, 'mono is wider than the condensed face');
  assert.equal(caps.h, Math.ceil(26 * 1.25));
  assert.equal(dotNamed('calm', DOT_NAMED_PX - 1), false);
  assert.equal(dotNamed('calm', DOT_NAMED_PX), true);
  assert.equal(dotNamed('warn', 0), true, 'trouble is named however far');
});

// A DOM just big enough for createLabels.
function fakeDoc() {
  const made = [];
  const el = () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    const e = { style, dataset: {}, textContent: '', className: '', removed: false, remove() { this.removed = true; }, append: () => {} };
    made.push(e);
    return e;
  };
  return { doc: { createElement: el }, made, root: el() };
}

// The scene's world for the large demo, every member where an open system puts it.
function worldOf(openId) {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => {
    const open = s.id === openId ? 1 : 0;
    const members = s.members.map((m) => {
      const k = open ? 1 : 0.16;
      const p = new THREE.Vector3(s.home.x + m.off.x * k, s.home.y + m.off.y * k, s.home.z + m.off.z * k);
      return { ...m, tone: toneOf(m.node), mesh: { position: p } };
    });
    return { ...s, members, open, status: worstOf(s) };
  });
  return { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
}

function galaxyAt(world, shot, W = 1368, H = 912) {
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  camera.updateMatrixWorld();
  return { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } };
}

test('createLabels: the busiest builder held (lab, open) names its trouble lanes and piles nothing', () => {
  const world = worldOf('lab');
  const lab = world.byId.get('lab');
  for (const now of [0, 4000, 9000, 15000]) {
    const { doc, root } = fakeDoc();
    const labels = createLabels(root, galaxyAt(world, siteShot(lab, now)), { steps: { site: 26, room: 15 }, doc });
    labels.draw();
    const shown = labels.shown();
    noOverlap(shown.map((s) => s.box));
    const ids = new Set(shown.map((s) => s.id));
    assert.ok(ids.has('lab'), 'the site is named');
    assert.ok(ids.has('lane:builder-a/feat-search') && ids.has('lane:builder-a/fix-login'), `the trouble lanes at ${now}`);
    assert.ok(shown.filter((s) => s.tone === 'calm').length >= 5, 'the calm rooms are named too');
    assert.equal(root.style.props['--gl-site'], '26px');
  }
});

test('createLabels: the name of what the lock holds goes outside its shut brackets (T9)', () => {
  const world = worldOf('lab');
  const lab = world.byId.get('lab');
  const id = 'lane:builder-a/feat-search';
  const galaxy = galaxyAt(world, siteShot(lab, 0));
  const { doc, root } = fakeDoc();
  const free = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, doc });
  free.draw();
  const before = free.shown().find((s) => s.id === id);
  assert.ok(before, 'named without a lock');
  // Where the lane is drawn, and brackets well wider than its dot.
  const m = lab.members.find((x) => x.id === id);
  const v = m.mesh.position.clone().project(galaxy.camera);
  const at = { x: (v.x + 1) / 2 * 1368, y: (1 - v.y) / 2 * 912 };
  const r = 40;
  const fd = fakeDoc();
  const held = createLabels(fd.root, galaxy, { steps: { site: 26, room: 15 }, held: () => ({ id, r }), doc: fd.doc });
  held.draw();
  const shown = held.shown();
  noOverlap(shown.map((s) => s.box));
  const after = shown.find((s) => s.id === id);
  assert.ok(after, 'still named: trouble wins');
  const ring = { x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r };
  // Its own name and every calm one stay off the brackets (another trouble
  // name may cross them when it has no free side: trouble wins over bodies).
  for (const s of shown.filter((x) => x.id === id || x.tone === 'calm')) {
    assert.ok(!overlaps(s.box, ring), `${s.text} clear of the brackets`);
  }
});

test('labelFace: the held thing in trouble is named like a site, caps at the site step (T22, r21-operator 8)', () => {
  assert.equal(labelFace('site', 'calm'), 'label');
  assert.equal(labelFace('core', 'calm'), 'label');
  assert.equal(labelFace('room', 'crit'), 'mono', 'trouble not held: mono');
  assert.equal(labelFace('room', 'crit', true), 'label');
  assert.equal(labelFace('lane', 'warn', true), 'label');
  assert.equal(labelFace('room', 'calm', true), 'mono', 'a calm held thing keeps its size');
  assert.equal(labelFace('builder', 'low', true), 'mono', 'low is not trouble');
  const storage = { kind: 'room', label: 'Storage', status: 'crit' };
  assert.equal(labelText(storage), '■ storage');
  assert.equal(labelText(storage, 'crit', 'label'), '■ STORAGE');
});

test('createLabels: the held trouble target is big caps; others, and the same thing unheld, unchanged (T22)', () => {
  const world = worldOf('lab');
  const lab = world.byId.get('lab');
  const id = 'lane:builder-a/feat-search';
  const steps = { site: 26, room: 15 };
  const galaxy = galaxyAt(world, siteShot(lab, 0));
  const a = fakeDoc();
  const free = createLabels(a.root, galaxy, { steps, doc: a.doc });
  free.draw();
  const b = fakeDoc();
  const held = createLabels(b.root, galaxy, { steps, held: () => ({ id, r: 30 }), doc: b.doc });
  held.draw();
  const before = new Map(free.shown().map((s) => [s.id, s]));
  const after = new Map(held.shown().map((s) => [s.id, s]));
  assert.equal(before.get(id).face, 'mono');
  assert.equal(before.get(id).text, '▲ feat-search');
  const big = after.get(id);
  assert.ok(big, 'the held trouble is named');
  assert.equal(big.face, 'label');
  assert.equal(big.text, '▲ FEAT-SEARCH');
  assert.equal(big.box.h, labelSize(big.text, steps.site, 'label').h, 'the site step');
  assert.equal(big.box.w, labelSize(big.text, steps.site, 'label').w);
  noOverlap(held.shown().map((s) => s.box));
  for (const [k, s] of after) {
    if (k === id) continue;
    const want = world.byId.has(k) || k === world.core.id ? 'label' : 'mono';
    assert.equal(s.face, want, `${s.text} keeps its face`);
  }
  // A calm thing held keeps its mono name.
  const calm = lab.members.find((m) => m.planet && m.tone === 'calm');
  const c = fakeDoc();
  const calmHeld = createLabels(c.root, galaxy, { steps, held: () => ({ id: calm.id, r: 30 }), doc: c.doc });
  calmHeld.draw();
  const named = calmHeld.shown().find((s) => s.id === calm.id);
  if (named) assert.equal(named.face, 'mono');
});

test('createLabels: at the overview only sites are named, a site in trouble in its hue; caption covers are kept clear', () => {
  const world = worldOf(null);
  const shot = { pos: { x: 0, y: 5200, z: 4200 }, look: { x: 0, y: 0, z: 0 } };
  const { doc, root } = fakeDoc();
  const plate = { left: 0, top: 0, right: 500, bottom: 300 };
  const labels = createLabels(root, galaxyAt(world, shot), { steps: { site: 26, room: 15 }, covers: () => [plate], doc });
  labels.draw();
  const shown = labels.shown();
  noOverlap(shown.map((s) => s.box));
  for (const s of shown) {
    assert.ok(world.byId.has(s.id) || s.id === world.core.id, `${s.text}: only sites and the sun at the overview`);
    assert.ok(!overlaps(s.box, boxOf(plate)), `${s.text} clear of the plate`);
  }
  // The folded site with a crit room says so on its own name.
  const crit = world.sites.find((s) => toneOf(s.status) === 'crit');
  const named = shown.find((s) => s.id === crit.id);
  assert.ok(named, 'the crit site is named');
  assert.equal(named.tone, 'crit');
  assert.match(named.text, /^■ /);
  assert.ok(OPEN_FADE.from > 0, 'calm planets wait for their system to open');
});

// Where a star is drawn through `camera` now, and its radius in css px (labels.js: starRadius, else 24).
function starAt(camera, s, W = 1368, H = 912) {
  const v = new THREE.Vector3(s.home.x, s.home.y, s.home.z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -v.z;
  v.applyMatrix4(camera.projectionMatrix);
  const unit = H / (2 * Math.tan((camera.fov * Math.PI) / 360) * depth);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, r: (s.starRadius ?? 24) * unit };
}
const sameBox = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 1e-6);

test('createLabels: a site name stays on its star: each draw anchors it to the star projected then, at a fixed side (T17)', () => {
  const world = worldOf(null);
  const galaxy = galaxyAt(world, { pos: { x: 0, y: 5200, z: 4200 }, look: { x: 0, y: 0, z: 0 } });
  const { doc, root } = fakeDoc();
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, doc });
  // The camera moves between draws: it slides, closes in and swings round.
  const poses = [
    [{ x: 0, y: 5200, z: 4200 }, { x: 0, y: 0, z: 0 }],
    [{ x: 900, y: 4800, z: 3900 }, { x: 300, y: 0, z: -200 }],
    [{ x: -1500, y: 3600, z: 2600 }, { x: -400, y: 0, z: 300 }],
    [{ x: 2400, y: 3000, z: -1800 }, { x: 0, y: 0, z: 0 }],
  ];
  let seen = 0;
  for (const [pos, look] of poses) {
    galaxy.camera.position.set(pos.x, pos.y, pos.z);
    galaxy.camera.lookAt(look.x, look.y, look.z);
    labels.draw();
    galaxy.camera.updateMatrixWorld();
    for (const name of labels.shown().filter((x) => world.byId.has(x.id))) {
      const st = starAt(galaxy.camera, world.byId.get(name.id));
      const sides = candidates(st.x, st.y, st.r, name.box.w, name.box.h);
      assert.equal(sides.length, 4);
      assert.ok(sides.some((b) => sameBox(b, name.box)), `${name.text} at a fixed side of its star ${JSON.stringify([st, name.box])}`);
      seen += 1;
    }
  }
  assert.ok(seen >= 12, `sites named over the moves (${seen})`);
});

test('createLabels: a site in trouble with no free side is not named two lines under its star, and no star out of frame is named (T17)', () => {
  const world = worldOf(null);
  const crit = world.sites.find((s) => toneOf(s.status) === 'crit');
  const shot = { pos: { x: 0, y: 5200, z: 4200 }, look: { x: 0, y: 0, z: 0 } };
  const galaxy = galaxyAt(world, shot);
  const st = starAt(galaxy.camera, crit);
  const d = st.r + GAP, h = labelSize(labelText(crit.node, 'crit', 'label'), 26, 'label').h;
  // A plate over its star's four sides that leaves the old stack under it free.
  const wall = { left: st.x - 400, top: st.y - 200, right: st.x + 400, bottom: st.y + d + h - 1 };
  const a = fakeDoc();
  const walled = createLabels(a.root, galaxy, { steps: { site: 26, room: 15 }, covers: () => [wall], doc: a.doc });
  walled.draw();
  assert.equal(walled.shown().find((x) => x.id === crit.id), undefined, 'hidden, not stacked away from its star');
  assert.equal(stacks('site', RANK.trouble), false);
  assert.equal(stacks('core', RANK.trouble), false);
  assert.equal(stacks('service', RANK.trouble), true, 'a crowd of trouble dots still stacks');
  assert.equal(stacks('service', RANK.rest), false);

  // The same star 10 px above the frame: its name would fit below it, inside; it is not shown.
  galaxy.camera.setViewOffset(1368, 912, 0, st.y + 10, 1368, 912);
  galaxy.camera.updateMatrixWorld();
  assert.ok(Math.abs(starAt(galaxy.camera, crit).y + 10) < 1e-6);
  const b = fakeDoc();
  const off = createLabels(b.root, galaxy, { steps: { site: 26, room: 15 }, doc: b.doc });
  off.draw();
  assert.equal(off.shown().find((x) => x.id === crit.id), undefined, 'a star out of frame has no name');
  for (const name of off.shown()) {
    const s = world.byId.get(name.id);
    if (!s) continue;
    const p = starAt(galaxy.camera, s);
    assert.ok(p.x >= 0 && p.x <= 1368 && p.y >= 0 && p.y <= 912, `${name.text}: its star is in the frame`);
  }
});

test('galaxy.html has the names layer between the canvas and the frame, and main.js draws it after each frame', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'galaxy.html'), 'utf8');
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('galaxy') > 0 && at('galaxy') < at('galaxy-labels') && at('galaxy-labels') < at('wall-frame'));
  const main = fs.readFileSync(path.join(PUBLIC, 'js/wall/galaxy/main.js'), 'utf8');
  assert.match(main, /cam\.onDraw\(labels\.draw\)/);
  assert.match(fs.readFileSync(path.join(PUBLIC, 'css/wall.css'), 'utf8'), /\.galaxy-label\[data-tone="crit"\]/);
});
