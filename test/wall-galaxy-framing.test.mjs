// Wall night 2 T18 (reviews/r15-dreamer.md 1): the held system no longer
// hides under its own caption plate. `siteShot` with a view puts the star at
// the middle of what the plate and the fleet block leave free and stands back
// so the open reach fits in it; the camera eases that box, never cuts.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { siteShot, FOV, SIZE } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, zoomedSiteShot, FLIGHT } from '../public/js/wall/galaxy/camera.js';
import {
  panShot, blendRect, fitDistance, freeCentre, freeRect, ndcOf, unionBox, FRAMING,
} from '../public/js/wall/galaxy/framing.js';
import { lockTarget } from '../public/js/wall/lock.js';

const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

// The tablet's css frame and the boxes measured on galaxy.html there (round 36,
// `?at=hv1` / `?at=cloud`): the widest caption plate (a trouble site), the far fleet block and the tag.
const W = 1368, H = 912;
const PLATE = { left: 82, top: 73, right: 793, bottom: 560 };
const FLEET_BLOCK = { left: 496, top: 675, right: 1369, bottom: 912 };
const TAG = { left: 992, top: 95, right: 1286, bottom: 111 };
const COVERS = [PLATE, FLEET_BLOCK, TAG];

const meets = (p, c, r = 0) => p.x + r > c.left && p.x - r < c.right && p.y + r > c.top && p.y - r < c.bottom;

/** A real three camera at `shot`, and where a world point lands in css px with its drawn radius. */
function projector(shot, w = W, h = H) {
  const cam = new THREE.PerspectiveCamera(FOV, w / h, 1, 30000);
  cam.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  cam.lookAt(shot.look.x, shot.look.y, shot.look.z);
  cam.updateMatrixWorld();
  const v = new THREE.Vector3();
  return (p, radius = 0) => {
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (depth <= 0) return null;
    v.applyMatrix4(cam.projectionMatrix);
    const unit = h / (2 * Math.tan((FOV * Math.PI) / 360) * depth);
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, r: radius * unit };
  };
}

test('freeRect: the whole frame without covers, else the box beside them a circle fits best', () => {
  assert.deepEqual(freeRect(W, H, []), { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.deepEqual(freeRect(W, H, [null]), { x0: 0, y0: 0, x1: 1, y1: 1 });
  const f = freeRect(W, H, COVERS);
  const px = { left: f.x0 * W, top: f.y0 * H, right: f.x1 * W, bottom: f.y1 * H };
  for (const c of COVERS) {
    const apart = px.right <= c.left - FRAMING.gap + 1e-9 || px.left >= c.right + FRAMING.gap - 1e-9
      || px.bottom <= c.top - FRAMING.gap + 1e-9 || px.top >= c.bottom + FRAMING.gap - 1e-9;
    assert.ok(apart, `free box ${JSON.stringify(px)} keeps ${FRAMING.gap} px from ${JSON.stringify(c)}`);
  }
  // Right of the plate, above the fleet block: the roomiest place on this frame.
  assert.ok(px.left >= PLATE.right && px.bottom <= FLEET_BLOCK.top, JSON.stringify(px));
  assert.ok(Math.min(px.right - px.left, px.bottom - px.top) > 500);
  // Covers on every side leave no useful room: the middle, as before.
  const walls = [{ left: 0, top: 0, right: W, bottom: H * 0.45 }, { left: 0, top: H * 0.55, right: W, bottom: H }];
  assert.deepEqual(freeRect(W, H, walls), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('panShot puts a point where it is asked, fitDistance stands back for a reach, unionBox and blendRect', () => {
  const shot = { pos: { x: 300, y: 900, z: 1200 }, look: { x: 0, y: 0, z: 0 } };
  const p = { x: 0, y: 0, z: 0 };
  const aimed = panShot(shot, p, { x: 0.4, y: -0.3 }, FOV, 1.5);
  const n = ndcOf(aimed, p, FOV, 1.5);
  assert.ok(Math.abs(n.x - 0.4) < 1e-4 && Math.abs(n.y + 0.3) < 1e-4, JSON.stringify(n));
  const dir = (q) => { const l = Math.hypot(q.look.x - q.pos.x, q.look.y - q.pos.y, q.look.z - q.pos.z); return [(q.look.x - q.pos.x) / l, (q.look.y - q.pos.y) / l, (q.look.z - q.pos.z) / l]; };
  dir(aimed).forEach((d, i) => assert.ok(Math.abs(d - dir(shot)[i]) < 1e-12, 'the camera slides, it does not turn (the sun stays behind)'));
  // three agrees with ndcOf
  const at = projector(aimed, 1500, 1000)(p);
  assert.ok(Math.abs(at.x - (0.4 + 1) / 2 * 1500) < 0.5 && Math.abs(at.y - (1 + 0.3) / 2 * 1000) < 0.5);
  assert.deepEqual(freeCentre({ x0: 0.5, y0: 0, x1: 1, y1: 0.5 }), { x: 0.5, y: 0.5 });
  const whole = { x0: 0, y0: 0, x1: 1, y1: 1 }, half = { x0: 0.5, y0: 0, x1: 1, y1: 1 };
  assert.ok(Math.abs(fitDistance(300, half, FOV, 1) - 2 * fitDistance(300, whole, FOV, 1)) < 1e-9, 'half as wide (the narrow side), twice as far');
  assert.deepEqual(unionBox(null, PLATE), PLATE);
  assert.deepEqual(unionBox({ left: 0, top: 10, right: 5, bottom: 20 }, { left: 2, top: 0, right: 9, bottom: 15 }), { left: 0, top: 0, right: 9, bottom: 20 });
  assert.deepEqual(blendRect(whole, half, 0.5), { x0: 0.25, y0: 0, x1: 1, y1: 1 });
  assert.equal(blendRect(null, half, 0.1), half);
});

test('every site of the large demo, held open: the star, every planet and the lock target lie in the free box, clear of every cover', () => {
  const lay = galaxyLayout(FLEET);
  const free = freeRect(W, H, COVERS);
  const view = { fov: FOV, aspect: W / H, free };
  const box = { left: free.x0 * W, top: free.y0 * H, right: free.x1 * W, bottom: free.y1 * H };
  for (const s of lay.sites) {
    for (const t of [0, 40_000, 160_000]) {
      const at = projector(zoomedSiteShot(s, t, 2.3, view));
      const star = at(s.home);
      const c = freeCentre(free);
      assert.ok(Math.abs(star.x - (c.x + 1) / 2 * W) < 1 && Math.abs(star.y - (1 - c.y) / 2 * H) < 1, `${s.id}: star at the free box's middle`);
      for (const cover of COVERS) assert.ok(!meets(star, cover), `${s.id}: star clear of ${JSON.stringify(cover)}`);
      for (const m of s.members) {
        const p = at({ x: s.home.x + m.off.x, y: s.home.y + m.off.y, z: s.home.z + m.off.z });
        assert.ok(p, `${m.id} in front of the camera`);
        assert.ok(p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom,
          `${s.id} @${t}: ${m.id} at ${p.x.toFixed(0)},${p.y.toFixed(0)} inside ${JSON.stringify(box)}`);
      }
      const target = lockTarget(s.node, { nodes: FLEET });
      const m = s.members.find((x) => x.id === target);
      if (m) {
        const p = at({ x: s.home.x + m.off.x, y: s.home.y + m.off.y, z: s.home.z + m.off.z });
        for (const cover of COVERS) assert.ok(!meets(p, cover), `${s.id}: lock target ${target} clear of the covers`);
      }
    }
  }
});

test('without a view siteShot is as before: the star at the middle', () => {
  const s = galaxyLayout(FLEET).sites[0];
  assert.deepEqual(siteShot(s, 0).look, s.home);
  assert.deepEqual(siteShot(s, 0, null), siteShot(s, 0));
  const at = projector(siteShot(s, 0));
  const p = at(s.home);
  assert.ok(Math.abs(p.x - W / 2) < 1e-6 && Math.abs(p.y - H / 2) < 1e-6);
});

test('framed, the hub is at most a small far point: its bright middle under 2 % of the frame (T16 allows 15)', () => {
  // A big system near the hub (lab) needs the camera farther back than the
  // hub is, so the hub may come into the frame, small and grey as at the overview.
  const lay = galaxyLayout(FLEET);
  const view = { fov: FOV, aspect: W / H, free: freeRect(W, H, COVERS) };
  const r = SIZE.sunHalo / 4;
  for (const s of lay.sites) {
    for (let t = 0; t <= 6 * 60_000; t += 15_000) {
      const at = projector(zoomedSiteShot(s, t, 2.3, view));
      const sun = at({ x: 0, y: 0, z: 0 }, r);
      if (!sun) continue;
      // the disc's share of the frame, clipped to it
      const N = 64;
      let hit = 0;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        if (Math.hypot((i + 0.5) / N * W - sun.x, (j + 0.5) / N * H - sun.y) < sun.r) hit++;
      }
      assert.ok(hit / (N * N) < 0.02, `${s.id} @${t}: the hub covers ${(hit / (N * N) * 100).toFixed(1)} %`);
    }
  }
});

test('the camera frames a held system in the free box and eases when the box changes, never a cut', () => {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => ({ id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0, members: [] }));
  let covers = [];
  const galaxy = {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    camera: new THREE.PerspectiveCamera(FOV, W / H, 1, 30000),
    renderer: { domElement: { clientWidth: W, clientHeight: H } },
  };
  const cam = createGalaxyCamera(galaxy, { free: () => freeRect(W, H, covers) });
  const site = sites[1];
  cam.focus(site.id, 2.3);
  let t = 0;
  for (; t <= FLIGHT.ms + 200; t += 16) cam.frame(t);
  const centred = cam.frame(t);
  const at0 = projector(centred)(site.home);
  assert.ok(Math.abs(at0.x - W / 2) < 1 && Math.abs(at0.y - H / 2) < 1, 'no covers: the middle');

  // The plate comes up: the camera slides over to the free box in steps, not at once.
  covers = COVERS;
  let prev = centred, worst = 0;
  for (let i = 0; i < 200; i++) {
    t += 16;
    const p = cam.frame(t);
    worst = Math.max(worst, Math.hypot(p.look.x - prev.look.x, p.look.y - prev.look.y, p.look.z - prev.look.z));
    prev = p;
  }
  const want = zoomedSiteShot(site, t - FLIGHT.ms, 2.3, { fov: FOV, aspect: W / H, free: freeRect(W, H, COVERS) });
  const jump = Math.hypot(want.look.x - centred.look.x, want.look.y - centred.look.y, want.look.z - centred.look.z);
  assert.ok(worst < jump / 10, `eased: no step over a tenth of the move (${worst.toFixed(1)} of ${jump.toFixed(1)})`);
  const settled = projector(prev)(site.home);
  const c = freeCentre(freeRect(W, H, COVERS));
  assert.ok(Math.abs(settled.x - (c.x + 1) / 2 * W) < 2 && Math.abs(settled.y - (1 - c.y) / 2 * H) < 2, JSON.stringify(settled));
});

test('night 5 T1b: the sun stays off a held system\'s frame (or at least off the words) for every site of the large demo', () => {
  // The snug galaxy (T1) brings `lab` 733 from the sun; shot from outside looking
  // in, the sun's disc stood on the tag. It is shot from the side now.
  const lay = galaxyLayout(FLEET);
  const lab = lay.sites.find((s) => s.id === 'lab');
  assert.ok(lab.reach > FRAMING.inward * Math.hypot(lab.home.x, lab.home.z), 'lab is the side-shot case');
  // The widest plate (a trouble site) and a short one (a calm site's two lines).
  const CALM_PLATE = { left: 82, top: 73, right: 600, bottom: 300 };
  const off = (p, r) => p == null || p.x + r < 0 || p.x - r > W || p.y + r < 0 || p.y - r > H;
  for (const covers of [COVERS, [CALM_PLATE, FLEET_BLOCK, TAG]]) {
    const view = { fov: FOV, aspect: W / H, free: freeRect(W, H, covers) };
    for (const s of lay.sites) {
      for (let t = 0; t <= 6 * 60_000; t += 7_500) {
        for (const zoom of [2.3, 3.5]) {
          const shot = zoomedSiteShot(s, t, zoom, view);
          const at = projector(shot);
          // The disc and the halo's bright middle, a quarter of its width.
          const sun = at({ x: 0, y: 0, z: 0 }, Math.max(SIZE.sun, SIZE.sunHalo / 4));
          const where = sun ? `${sun.x.toFixed(0)},${sun.y.toFixed(0)} r ${sun.r.toFixed(0)}` : 'behind';
          if (s === lab) assert.ok(off(sun, sun?.r ?? 0), `${s.id} t=${t} zoom ${zoom}: the sun off the frame (${where})`);
          else assert.ok(off(sun, sun?.r ?? 0) || !covers.some((c) => meets(sun, c, sun.r)), `${s.id} t=${t} zoom ${zoom}: the sun clear of the words (${where})`);
        }
      }
    }
  }
});

test('night 5 T1b: the side shot keeps its own bearing, no per-site jitter, the sway still moving it', () => {
  const lab = galaxyLayout(FLEET).sites.find((s) => s.id === 'lab');
  const view = { fov: FOV, aspect: W / H, free: { x0: 0, y0: 0, x1: 1, y1: 1 } };
  const bearing = (shot) => Math.atan2(shot.pos.x - lab.home.x, shot.pos.z - lab.home.z);
  const sunward = Math.atan2(-lab.home.x, -lab.home.z);
  const turn = (a) => Math.atan2(Math.sin(a - sunward), Math.cos(a - sunward));
  assert.ok(Math.abs(turn(bearing(siteShot(lab, 0, view))) - FRAMING.aside) < 1e-9);
  assert.ok(Math.abs(turn(bearing(siteShot(lab, 40_000, view))) - FRAMING.aside) > 0.05, 'the hold still drifts');
});
