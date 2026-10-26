// The galaxy's live data (Wall plan night 2 T8, README §7.A4): a status
// change recolours the same objects and eases, nothing rebuilt; a tree change
// folds the system it touches, lays it out again while folded and opens it
// again; a site that goes shrinks away and the stars after it glide, so the
// camera, which reads their homes, never cuts. The scene runs here on a fake
// renderer and a fake clock (three.js itself needs no WebGL to build objects).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE, glide, planLive, relayPhase, siteKeys, treeKey,
} from '../public/js/wall/galaxy/live.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';

/** Five sites under a core, each with a room and two builders; `bad` sets statuses by id. */
function fleet(bad = {}, { extra = [], without = [] } = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'remote', 'home']) {
    nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    nodes.push({ id: `${s}-room`, parent: s, kind: 'room', status: 'ok' });
    nodes.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', status: 'ok' });
    nodes.push({ id: `${s}-c`, parent: s, kind: 'builder', status: 'ok' });
  }
  nodes.push(...extra);
  for (const n of nodes) if (bad[n.id]) n.status = bad[n.id];
  const gone = new Set(without);
  return { nodes: nodes.filter((n) => !gone.has(n.id) && !gone.has(n.parent)) };
}

/** Just enough canvas for the scene's sprite textures. */
const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
    }),
  }),
};

function sceneAt() {
  const clock = { now: 1000 };
  const renders = [];
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(),
    doc: fakeDoc,
    clock: () => clock.now,
    makeRenderer: (canvas) => ({
      domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
      render: () => renders.push(clock.now),
    }),
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, clock, at, renders };
}

const rgb = (c) => [c.r, c.g, c.b].map((x) => Math.round(x * 1000) / 1000);
const member = (galaxy, siteId, id) => galaxy.world.byId.get(siteId).members.find((m) => m.id === id);

test('treeKey ignores statuses and notices a node added, moved or a site shown', () => {
  const a = fleet().nodes, b = fleet({ 'hv1-b': 'crit' }).nodes;
  assert.equal(treeKey(a, ['hv1']), treeKey(b, ['hv1']));
  assert.notEqual(treeKey(a, ['hv1']), treeKey(fleet({}, { extra: [{ id: 'x', parent: 'hv1', kind: 'builder' }] }).nodes, ['hv1']));
  const moved = a.map((n) => (n.id === 'hv1-c' ? { ...n, parent: 'hv1-room' } : n));
  assert.notEqual(treeKey(a, ['hv1']), treeKey(moved, ['hv1']));
  assert.notEqual(treeKey(a, ['hv1']), treeKey(a, ['hv1', '__repos']));
});

test('planLive sorts the sites into kept, changed, added and removed', () => {
  const before = siteKeys(galaxyLayout(fleet().nodes).sites);
  const after = siteKeys(galaxyLayout(fleet({}, {
    extra: [{ id: 'hv1-d', parent: 'hv1', kind: 'builder' }, { id: 'lab', parent: '__core', kind: 'site' }],
    without: ['remote'],
  }).nodes).sites);
  const plan = planLive(before, after);
  assert.deepEqual(plan.changed, ['hv1']);
  assert.deepEqual(plan.added, ['lab']);
  assert.deepEqual(plan.removed, ['remote']);
  assert.deepEqual(plan.kept, ['hv2', 'cloud', 'home']);
});

test('relayPhase folds to nothing, swaps there, opens again; from a half fold it starts at half', () => {
  assert.equal(relayPhase(0).squeeze, 1);
  assert.equal(relayPhase(0).swap, false);
  const mid = relayPhase(LIVE.foldMs / 2);
  assert.ok(mid.squeeze > 0 && mid.squeeze < 1 && !mid.swap);
  const bottom = relayPhase(LIVE.foldMs);
  assert.equal(bottom.squeeze, 0);
  assert.equal(bottom.swap, true);
  assert.equal(bottom.done, false);
  const end = relayPhase(LIVE.foldMs + LIVE.reopenMs);
  assert.deepEqual(end, { squeeze: 1, swap: true, done: true });
  assert.equal(relayPhase(0, 0.4).squeeze, 0.4);
  // Never a step: the squeeze falls monotonically to the swap.
  let prev = 1;
  for (let t = 0; t <= LIVE.foldMs; t += 35) {
    const s = relayPhase(t).squeeze;
    assert.ok(s <= prev + 1e-9);
    prev = s;
  }
});

test('glide eases numbers and points from a to b', () => {
  assert.equal(glide(2, 4, 0), 2);
  assert.equal(glide(2, 4, 1), 4);
  assert.equal(glide(2, 4, 0.5), 3);
  assert.deepEqual(glide({ x: 0, y: 0, z: 0 }, { x: 10, y: -10, z: 4 }, 1), { x: 10, y: -10, z: 4 });
});

test('a status change keeps every object and eases the nebula to its new hue', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  at(1000);
  const w = galaxy.world;
  const hv1 = w.byId.get('hv1');
  const objects = [hv1.star, hv1.starHalo, hv1.nebulaSprite, hv1.lane, hv1.lines, hv1.plane, ...hv1.members.map((m) => m.mesh), ...hv1.members.map((m) => m.halo)];
  const calmNeb = rgb(hv1.nebulaSprite.material.color);
  const calmLane = hv1.lane.material.opacity;

  assert.equal(galaxy.update(fleet({ 'hv1-b': 'crit' })), true);
  assert.equal(galaxy.world, w, 'the same world');
  const after = galaxy.world.byId.get('hv1');
  assert.equal(after, hv1, 'the same site');
  const same = [after.star, after.starHalo, after.nebulaSprite, after.lane, after.lines, after.plane, ...after.members.map((m) => m.mesh), ...after.members.map((m) => m.halo)];
  assert.deepEqual(same, objects, 'no object made again');
  const b = member(galaxy, 'hv1', 'hv1-b');
  assert.equal(b.tone, 'crit');
  assert.equal(b.mesh.material.color.equals(galaxy.world.byId.get('hv2').members[0].mesh.material.color), false, 'recoloured');
  assert.equal(after.nebula.tone, 'crit');
  assert.equal(after.relay, null, 'no fold for a status change');

  // No jump: the nebula starts from its calm grey and reaches the crit hue.
  at(1000);
  assert.deepEqual(rgb(after.nebulaSprite.material.color), calmNeb);
  at(1000 + LIVE.recolourMs / 2);
  const half = rgb(after.nebulaSprite.material.color);
  assert.notDeepEqual(half, calmNeb);
  at(1000 + LIVE.recolourMs);
  const crit = rgb(after.nebulaSprite.material.color);
  assert.notDeepEqual(crit, half);
  assert.ok(after.lane.material.opacity > calmLane, 'the hyperlane lights in the hue');
  // The halo of a dot in trouble grows from nothing; a calm dot has none.
  assert.ok(b.haloSize > 0);
  // A metric alone changes nothing.
  const m = fleet({ 'hv1-b': 'crit' });
  m.nodes[0].metrics = { cpu: 0.9 };
  assert.equal(galaxy.update(m), false);
});

test('a tree change folds the system, swaps the new layout in while folded, then opens it again', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  galaxy.setOpen('hv1', 1);
  at(1000);
  const hv1 = galaxy.world.byId.get('hv1');
  const hv2Meshes = galaxy.world.byId.get('hv2').members.map((m) => m.mesh);
  const v0 = galaxy.world.version;

  galaxy.update(fleet({}, { extra: [{ id: 'hv1-d', parent: 'hv1-room', kind: 'builder', status: 'ok' }] }));
  assert.equal(galaxy.world.byId.get('hv1'), hv1, 'the same site, its star stays');
  assert.ok(hv1.relay, 'a relayout is scheduled');
  assert.equal(member(galaxy, 'hv1', 'hv1-d'), undefined, 'not before the fold');

  at(1000 + LIVE.foldMs / 2);
  assert.ok(hv1.unfold > 0 && hv1.unfold < 1, `folding (${hv1.unfold})`);
  assert.equal(member(galaxy, 'hv1', 'hv1-d'), undefined);

  at(1000 + LIVE.foldMs + 1);
  assert.ok(member(galaxy, 'hv1', 'hv1-d'), 'swapped in at the bottom of the fold');
  assert.ok(hv1.unfold < 0.01, 'while folded');
  assert.ok(galaxy.world.version > v0, 'the labels learn the new ids');

  at(1000 + LIVE.foldMs + LIVE.reopenMs / 2);
  assert.ok(hv1.unfold > 0 && hv1.unfold < 1, 'opening again');
  at(1000 + LIVE.foldMs + LIVE.reopenMs);
  assert.equal(hv1.unfold, 1);
  assert.equal(hv1.relay, null);
  assert.deepEqual(galaxy.world.byId.get('hv2').members.map((m) => m.mesh), hv2Meshes, 'other systems untouched');
});

test('a site that goes shrinks away, the stars after it glide; the camera never sees a jump', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet());
  at(1000);
  const remote = galaxy.world.byId.get('remote');
  const home = galaxy.world.byId.get('home');
  const from = { ...home.home };

  galaxy.update(fleet({}, { without: ['hv2'] }));
  const hv2 = galaxy.world.byId.get('hv2');
  assert.ok(hv2.gone, 'shrinking, not cut');
  assert.equal(galaxy.world.byId.get('remote'), remote, 'the others are the same objects');
  const to = galaxyLayout(fleet({}, { without: ['hv2'] }).nodes).sites.find((s) => s.id === 'home').home;
  assert.notDeepEqual(to, from, 'the fixture moves home on the arms');

  let prev = { ...home.home };
  const step = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const whole = step(from, to);
  for (let t = 1000; t <= 1000 + LIVE.glideMs; t += 50) {
    at(t);
    assert.ok(step(prev, home.home) < whole * 0.1, `no jump at ${t}`);
    prev = { ...home.home };
  }
  assert.deepEqual(home.home, to);
  assert.equal(galaxy.world.byId.has('hv2'), false, 'gone once it shrank');

  // And it comes back: it grows in on its spot.
  galaxy.update(fleet());
  const back = galaxy.world.byId.get('hv2');
  assert.equal(back.alive, 0);
  at(1000 + LIVE.glideMs + LIVE.foldMs + 10);
  assert.equal(back.alive, 1);
});

test('dispose drops every site', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(fleet({ 'cloud-b': 'warn' }));
  at(1000);
  galaxy.dispose();
  assert.equal(galaxy.world, null);
});
