// The galaxy's target lock (Wall plan night 2 T9): `screenOf` projects a node
// to the screen with its drawn radius from its distance (the centre at the
// camera's look-at, bigger as the camera closes in), the brackets close round
// that radius each frame, and the hud locks on the node the caption's trouble
// word names, a leader joining the two.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { SIZE } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, zoomedSiteShot } from '../public/js/wall/galaxy/camera.js';
import { createGalaxyLock, lockGeometry3d } from '../public/js/wall/galaxy/lock.js';
import { createHud } from '../public/js/wall/galaxy/hud.js';
import { LOCK_SIZE, LOCK_TIMING, lockGeometry } from '../public/js/wall/lock.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

const W = 1600, H = 900;

function nodes() {
  const out = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud']) {
    out.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    out.push({ id: `${s}-room`, parent: s, kind: 'room', label: `${s} room`, status: 'ok' });
    out.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', label: 'builder-a', status: s === 'hv2' ? 'crit' : 'ok', why: s === 'hv2' ? 'disk full' : undefined });
  }
  return out;
}

/** The scene as the camera sees it: sites with planets (open), a real three camera, no WebGL. */
function fakeGalaxy(list) {
  const lay = galaxyLayout(list);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 1, alive: 1,
    members: s.members.map((m) => ({
      id: m.id, planet: m.planet,
      mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z), scale: { x: 1 } },
    })),
  }));
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(42, W / H, 1, 30000),
    renderer: { domElement: { clientWidth: W, clientHeight: H } },
  };
}

const aim = (galaxy, shot) => {
  galaxy.camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  galaxy.camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
};

test('galaxy lock: screenOf puts the look-at at the screen centre and grows with zoom', () => {
  const galaxy = fakeGalaxy(nodes());
  const cam = createGalaxyCamera(galaxy);
  const site = galaxy.world.byId.get('hv2');

  aim(galaxy, zoomedSiteShot(site, 0, 2.3));
  const near = cam.screenOf('hv2');
  assert.ok(Math.abs(near.x - W / 2) < 1e-6 && Math.abs(near.y - H / 2) < 1e-6, 'the look-at is the centre');
  assert.ok(near.r > 0);

  aim(galaxy, zoomedSiteShot(site, 0, 1.15));
  const far = cam.screenOf('hv2');
  assert.ok(Math.abs(far.x - W / 2) < 1e-6 && Math.abs(far.y - H / 2) < 1e-6);
  assert.ok(near.r > far.r * 1.5, `closer is bigger: ${near.r} vs ${far.r}`);

  // A planet is drawn at its size over its distance: twice as close, twice as big.
  const b = site.members.find((m) => m.id === 'hv2-b');
  const d = galaxy.camera.position.distanceTo(b.mesh.position);
  const fy = H / (2 * Math.tan((42 * Math.PI) / 360));
  const sp = cam.screenOf('hv2-b');
  assert.ok(sp.r > SIZE.planet * fy / d * 0.95 && sp.r < SIZE.planet * fy / d * 1.6, 'radius from distance');

  // Behind the camera or unknown: nothing.
  aim(galaxy, { pos: { x: site.home.x, y: site.home.y, z: site.home.z + 500 }, look: { x: site.home.x, y: site.home.y, z: site.home.z + 1000 } });
  assert.equal(cam.screenOf('hv2'), null);
  assert.equal(cam.screenOf('nope'), null);
});

test('galaxy lock: the brackets close round the drawn radius, with the Wall lock\'s gaps', () => {
  const side = 912;
  const shut = lockGeometry3d({ r: 30, side, t: 1 });
  assert.ok(Math.abs(shut.d - (30 + side * LOCK_SIZE.gap)) < 1e-9);
  assert.equal(shut.alpha, 1);
  const open = lockGeometry3d({ r: 30, side, t: 0 });
  assert.ok(open.d > shut.d && open.alpha === 0, 'starts further out, unseen');
  assert.ok(lockGeometry3d({ r: 60, side, t: 1 }).d > shut.d, 'a bigger planet, wider brackets');
  // Same numbers as the Map's lock for the same radius.
  const map = lockGeometry({ kind: 'site', ns: 3, side, t: 0.4 });
  const g = lockGeometry3d({ r: map.r, side, t: 0.4 });
  assert.deepEqual(g, map);
});

test('galaxy lock: the hud locks on the trouble planet the caption names, the brackets follow it, a leader joins them', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let now = 0;
    const list = nodes();
    const galaxy = fakeGalaxy(list);
    const cam = createGalaxyCamera(galaxy);
    const site = galaxy.world.byId.get('hv2');
    aim(galaxy, zoomedSiteShot(site, 0, 2.3));
    const lock = createGalaxyLock(makeEl('div'), cam, {
      clock: { now: () => now }, size: () => ({ W, H }), leaderFrom: () => ({ x: 20, y: 40 }),
    });
    const tl = lock.el.children[0];
    let legCb = null;
    const tour = { onLeg: (cb) => { legCb = cb; return () => {}; } };
    const hud = createHud({
      caption: { show() {}, hide() {}, cover: () => null }, frame: { update() {}, live() {}, cover: () => null }, tour, lock,
    });
    hud.update({ nodes: list });

    legCb({ kind: 'site', id: 'hv2', status: 'crit', index: 1, count: 3, arriveMs: 2250 });
    now = 2250 - LOCK_TIMING.leadMs + LOCK_TIMING.closeMs;
    cam.drawn();
    const st = lock.state();
    assert.equal(st.cur.id, 'hv2-b', 'the trouble word\'s builder, not the system');
    assert.equal(lock.el.dataset.tone, 'crit');
    const sp = cam.screenOf('hv2-b');
    const g = lockGeometry3d({ r: sp.r, side: H, t: 1 });
    assert.equal(tl.style.transform, `translate3d(${(sp.x - g.d).toFixed(1)}px, ${(sp.y - g.d).toFixed(1)}px, 0)`);
    assert.ok(g.d > sp.r, 'the brackets sit outside the planet');
    assert.ok(st.drawn.leader, 'a leader from the trouble word');
    // The names keep out of the shut brackets.
    assert.deepEqual(lock.held(), { id: 'hv2-b', r: g.d });

    // The camera closes in: the brackets widen with the planet.
    aim(galaxy, zoomedSiteShot(site, 0, 4));
    cam.drawn();
    assert.ok(lock.state().drawn.d > g.d);

    // The overview: it opens and goes.
    legCb({ kind: 'overview' });
    now += LOCK_TIMING.outMs + 1;
    cam.drawn();
    assert.equal(lock.el.style.opacity, '0');
    assert.equal(lock.state().cur, null);
    assert.equal(lock.held(), null, 'no lock, nothing to keep out of');

    // A calm system: grey brackets on the star, no leader.
    legCb({ kind: 'site', id: 'hv1', status: 'ok', arriveMs: 0 });
    aim(galaxy, zoomedSiteShot(galaxy.world.byId.get('hv1'), 0, 2.3));
    now += LOCK_TIMING.closeMs;
    cam.drawn();
    assert.equal(lock.state().cur.id, 'hv1');
    assert.equal(lock.el.dataset.tone, 'calm');
    assert.equal(lock.state().drawn.leader, null);

    // A parked still (`?at=`, no tour status): the brackets still take the trouble word's hue.
    hud.park({ id: 'hv2', index: 1, count: 3 });
    aim(galaxy, zoomedSiteShot(site, 0, 2.3));
    now += LOCK_TIMING.outMs + 1;
    cam.drawn();
    assert.equal(lock.state().cur.id, 'hv2-b');
    assert.equal(lock.el.dataset.tone, 'crit');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('galaxy.html has the lock layer between the frame and the caption; main.js makes the galaxy lock', () => {
  const pub = path.resolve(import.meta.dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'galaxy.html'), 'utf8');
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.match(html, /class="wall-lock-layer" id="wall-lock"/);
  assert.ok(at('wall-frame') < at('wall-lock') && at('wall-lock') < at('wall-caption'));
  const main = fs.readFileSync(path.join(pub, 'js/wall/galaxy/main.js'), 'utf8');
  assert.match(main, /createGalaxyLock\(document\.getElementById\('wall-lock'\), cam/);
  assert.match(main, /leaderFrom: \(\) => caption\.leaderFrom\(\)/);
  assert.match(main, /createHud\(\{[^}]*lock \}\)/);
  assert.match(main, /held: lock\.held/);
});
