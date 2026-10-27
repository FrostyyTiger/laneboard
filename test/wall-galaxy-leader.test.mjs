// No stray hard lines (Wall plan night 3 T16, reviews/r4-film-ui.md galaxy 4):
// no tether from the fleet line to its cluster at the overview, and the
// caption's leader to its node is one style, 2 px as the brackets, one
// elbow (a level run, then 45° or 90°), routed so it crosses no name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { FOV } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera, zoomedSiteShot } from '../public/js/wall/galaxy/camera.js';
import { LEADER, cornerCovers, createGalaxyLock, leaderCovers, lockGeometry3d, leaderPath, segmentHitsBox } from '../public/js/wall/galaxy/lock.js';
import { createLabels } from '../public/js/wall/galaxy/labels.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { lockTarget } from '../public/js/wall/lock.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');
const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const endOf = (sg) => ({ x: sg.x + Math.cos(sg.angle) * sg.len, y: sg.y + Math.sin(sg.angle) * sg.len });

test('leaderPath: a level run out of the plate, then 45° into the bracket corner nearest it', () => {
  const from = { x: 500, y: 200 }, at = { x: 900, y: 420 }, d = 20;
  const l = leaderPath(from, at, d, 16);
  assert.equal(l.route, 'run-45');
  // The corner: the brackets' left side, top (the anchor is above the node).
  assert.deepEqual(l.points.at(-1), { x: 880, y: 400 });
  assert.deepEqual(l.points[0], from);
  assert.equal(l.segs[0].angle, 0, 'level out of the plate');
  assert.ok(near(l.segs[1].angle, Math.PI / 4), '45° down');
  const e = endOf(l.segs[1]);
  assert.ok(near(e.x, 880) && near(e.y, 400), 'it ends on the corner');
  assert.ok(near(l.len, 180 + 200 * Math.SQRT2));
  // Below the anchor's level the corner is the bottom one, the leg 45° up.
  const up = leaderPath({ x: 500, y: 600 }, at, d, 16);
  assert.deepEqual(up.points.at(-1), { x: 880, y: 440 });
  assert.ok(near(up.segs[1].angle, -Math.PI / 4));
  // Level with the anchor: one straight run.
  const flat = leaderPath({ x: 500, y: 400 }, at, d, 16);
  assert.equal(flat.points.length, 2);
  assert.equal(flat.segs[0].angle, 0);
});

test('leaderPath: draws out from the plate, the first leg before the second', () => {
  const from = { x: 500, y: 200 }, at = { x: 900, y: 420 };
  const full = leaderPath(from, at, 20, 16);
  const half = leaderPath(from, at, 20, 16, 0.2);
  assert.ok(near(half.segs[0].len, full.len * 0.2), 'the run first');
  assert.equal(half.segs[1].len, 0, 'the second leg waits');
  const most = leaderPath(from, at, 20, 16, 0.9);
  assert.ok(near(most.segs[0].len, full.segs[0].len));
  assert.ok(near(most.segs[0].len + most.segs[1].len, full.len * 0.9));
  assert.equal(leaderPath(from, at, 20, 16, 0).segs.every((s) => s.len === 0), true);
});

test('leaderPath: routed round the names, 45° first or a right angle, keeping the route it drew', () => {
  const from = { x: 500, y: 200 }, at = { x: 900, y: 420 }, d = 20;
  // A name on the level run: the 45° leg goes first, then the level run into the corner.
  const onRun = { x: 640, y: 190, w: 60, h: 20 };
  const a = leaderPath(from, at, d, 16, 1, [onRun]);
  assert.equal(a.route, '45-run');
  assert.ok(near(a.segs[0].angle, Math.PI / 4));
  assert.equal(a.segs[1].angle, 0);
  // A name on each slant: the right angle (level, then down the bracket's side).
  const onSlant = { x: 770, y: 290, w: 20, h: 20 }, onFirstSlant = { x: 600, y: 300, w: 60, h: 20 };
  const b = leaderPath(from, at, d, 16, 1, [onSlant, onFirstSlant]);
  assert.equal(b.route, 'run-90');
  assert.deepEqual(b.points[1], { x: 880, y: 200 });
  assert.ok(near(b.segs[1].angle, Math.PI / 2));
  // Steeper than 45° all the way: only the right angle draws.
  assert.equal(leaderPath({ x: 800, y: 100 }, at, d, 16).route, 'run-90');
  // Nothing clear: the route meeting fewest names.
  const blockAll = { x: 500, y: 150, w: 400, h: 300 };
  assert.ok(LEADER.routes.includes(leaderPath(from, at, d, 16, 1, [blockAll]).route));
  // The route the lock already draws is kept while it is clear, even if a liked one is clear too.
  assert.equal(leaderPath(from, at, d, 16, 1, [], 'run-90').route, 'run-90');
  assert.equal(leaderPath(from, at, d, 16, 1, [{ x: 860, y: 190, w: 40, h: 20 }], 'run-90').route, 'run-45', 'not when a name sits on it');
});

test('leaderPath: none back under the plate or shorter than two arms', () => {
  assert.equal(leaderPath({ x: 500, y: 200 }, { x: 400, y: 300 }, 20, 16), null);
  assert.equal(leaderPath({ x: 500, y: 200 }, { x: 540, y: 210 }, 20, 16), null);
  assert.equal(leaderPath(null, { x: 900, y: 400 }, 20, 16), null);
});

test('segmentHitsBox and leaderCovers: every point of the leader is under a cover', () => {
  const box = { x: 10, y: 10, w: 20, h: 10 };
  assert.ok(segmentHitsBox({ x: 0, y: 15 }, { x: 40, y: 15 }, box));
  assert.ok(!segmentHitsBox({ x: 0, y: 0 }, { x: 40, y: 5 }, box));
  assert.ok(segmentHitsBox({ x: 0, y: 0 }, { x: 40, y: 5 }, box, 6), 'grown by the pad');
  assert.ok(segmentHitsBox({ x: 0, y: 0 }, { x: 40, y: 40 }, box), 'a slant through it');
  for (const l of [
    leaderPath({ x: 500, y: 200 }, { x: 900, y: 420 }, 20, 16),
    leaderPath({ x: 500, y: 600 }, { x: 900, y: 420 }, 20, 16, 1, [{ x: 600, y: 590, w: 100, h: 20 }]),
    leaderPath({ x: 800, y: 100 }, { x: 900, y: 420 }, 20, 16),
  ]) {
    const covers = leaderCovers(l);
    const inside = (p) => covers.some((c) => p.x >= c.x + LEADER.pad - 1e-9 && p.x <= c.x + c.w - LEADER.pad + 1e-9
      && p.y >= c.y + LEADER.pad - 1e-9 && p.y <= c.y + c.h - LEADER.pad + 1e-9);
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1], b = l.points[i];
      for (let k = 0; k <= 50; k++) {
        const p = { x: a.x + (b.x - a.x) * k / 50, y: a.y + (b.y - a.y) * k / 50 };
        assert.ok(inside(p), `${l.route}: (${p.x}, ${p.y}) covered`);
      }
    }
    // A slanted leg is a row of small squares, not one box over the whole triangle.
    assert.ok(covers.every((c) => c.w * c.h <= (l.len + 2 * LEADER.pad) * (LEADER.tile + 2 * LEADER.pad)));
  }
  assert.deepEqual(leaderCovers(null), []);
});

// The large demo with one system open and the camera on its held shot (as wall-galaxy-labels.test.mjs).
const W = 1368, H = 912;
function galaxyOpen(openId) {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => {
    const open = s.id === openId ? 1 : 0;
    const members = s.members.map((mb) => {
      const k = open ? 1 : 0.16;
      const p = new THREE.Vector3(s.home.x + mb.off.x * k, s.home.y + mb.off.y * k, s.home.z + mb.off.z * k);
      return { ...mb, tone: toneOf(mb.node), mesh: { position: p, scale: { x: 1 } } };
    });
    return { ...s, members, open, alive: 1, status: s.node.status };
  });
  const world = { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  const shot = zoomedSiteShot(world.byId.get(openId), 0, 2.3);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  camera.updateMatrixWorld();
  return { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } };
}

test('large fixture: the leader crosses no shown name, whichever member of whichever system it points at', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let checked = 0;
    for (const site of galaxyLayout(FLEET).sites) {
      const galaxy = galaxyOpen(site.id);
      const cam = createGalaxyCamera(galaxy);
      // The real target (the trouble word's node) and, as if each were in trouble, every member.
      const targets = [lockTarget({ id: site.id }, FLEET), ...galaxy.world.byId.get(site.id).members.map((m) => [{ id: m.id }])];
      // The plate's right edge at the trouble word, for a short and a long plate.
      for (const anchor of [{ x: 560, y: 200 }, { x: 560, y: 330 }, { x: 480, y: 260 }]) {
        const plate = { left: 82, top: 73, right: anchor.x, bottom: 420 };
        for (const target of targets) {
          let now = 0;
          let shown = () => [];
          const lock = createGalaxyLock(makeEl('div'), cam, {
            clock: { now: () => now }, size: () => ({ W, H }), leaderFrom: () => anchor, avoid: () => shown().map((n) => n.box),
          });
          // As main.js: the lock draws first, then the names, clear of the plate and the leader.
          const labels = createLabels(makeEl('div'), galaxy, {
            steps: { site: 26, room: 15 }, covers: () => [plate, ...lock.covers()], held: lock.held,
          });
          shown = labels.shown;
          lock.lockOn({ id: site.id, target, status: 'crit', arriveMs: 0 });
          now = 5000;
          for (let f = 0; f < 3; f++) { cam.drawn(); labels.draw(); }
          const l = lock.state().drawn?.leader;
          if (l) {
            checked++;
            for (const n of labels.shown()) {
              for (let i = 1; i < l.points.length; i++) {
                assert.ok(!segmentHitsBox(l.points[i - 1], l.points[i], n.box),
                  `${site.id} → ${target[0].id} (${l.route}): the leader crosses "${n.text}"`);
              }
            }
            assert.ok(['run-45', '45-run', 'run-90'].includes(l.route));
          }
          lock.destroy();
          labels.destroy();
        }
      }
    }
    assert.ok(checked > 100, `leaders checked: ${checked}`);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('the lock draws the leader as two legs with no notch at the elbow, and keeps its route', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let now = 0;
    const galaxy = galaxyOpen('hv2');
    const cam = createGalaxyCamera(galaxy);
    let names = [];
    // The anchor 120 px above the target, well to its left: every route can be drawn.
    const target = lockTarget({ id: 'hv2' }, FLEET);
    const sp = cam.screenOf(target[0].id);
    const lock = createGalaxyLock(makeEl('div'), cam, {
      clock: { now: () => now }, size: () => ({ W, H }), leaderFrom: () => ({ x: sp.x - 400, y: sp.y - 120 }), avoid: () => names,
    });
    const legs = lock.el.children.filter((c) => c.className === 'wall-lock-leader');
    assert.equal(legs.length, 2);
    lock.lockOn({ id: 'hv2', target, status: 'crit', arriveMs: 0 });
    now = 5000;
    cam.drawn();
    const l = lock.state().drawn.leader;
    assert.equal(l.route, 'run-45', 'the liked route, nothing in its way');
    assert.equal(l.segs.length, 2, 'one elbow');
    const [a, b] = l.segs;
    assert.equal(legs[0].style.transform, `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) rotate(${a.angle.toFixed(4)}rad) scaleX(${(a.len + 1).toFixed(1)})`,
      'the run goes on half the stroke under the second leg');
    assert.equal(legs[1].style.transform, `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotate(${b.angle.toFixed(4)}rad) scaleX(${b.len.toFixed(1)})`);
    assert.ok(lock.covers().length > 1, 'the names are told where it runs');
    // The shut brackets' four corners come first (T26): no name sits on a bracket either.
    const d = lock.state().drawn;
    const arm = Math.round(lockGeometry3d({ r: 0, side: Math.min(W, H) }).arm);
    assert.deepEqual(lock.covers().slice(0, 4), cornerCovers(d, d.shut, arm));
    // A name on the elbow: the next frame takes another route; the names gone, it keeps that one.
    names = [{ x: l.points[1].x - 5, y: l.points[1].y - 5, w: 10, h: 10 }];
    cam.drawn();
    const moved = lock.state().drawn.leader.route;
    assert.notEqual(moved, l.route);
    names = [];
    cam.drawn();
    assert.equal(lock.state().drawn.leader.route, moved, 'no hop back while it is clear');
    // The lock opens and goes: no leader, nothing to keep off.
    lock.release();
    now += 10000;
    cam.drawn();
    assert.equal(lock.state().drawn, null);
    assert.deepEqual(lock.covers(), []);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('one style: the galaxy\'s leader has the brackets\' stroke; no tether anywhere on the page', () => {
  const css = read('css/wall.css');
  const rule = css.match(/\.galaxy-stage \.wall-lock-leader \{([^}]*)\}/);
  assert.ok(rule, 'a galaxy rule for the leader');
  assert.match(rule[1], /height: var\(--lock-stroke\);/);
  assert.match(rule[1], /margin-top: calc\(var\(--lock-stroke\) \/ -2\);/);
  assert.match(css, /\.wall-lock \{[^}]*--lock-stroke: 2px;/);
  assert.doesNotMatch(css, /galaxy-tether/);
  assert.doesNotMatch(read('galaxy.html'), /tether/);
  const main = read('js/wall/galaxy/main.js');
  assert.doesNotMatch(main, /createTether|tether\.(show|hide|update)/, 'no banner-to-node tether at the overview');
  assert.ok(!fs.existsSync(path.join(PUBLIC, 'js/wall/galaxy/tether.js')));
  // The lock routes round the names; the names keep off the leader.
  assert.match(main, /avoid: \(\) => shownNames\(\)\.map\(\(n\) => n\.box\)/);
  assert.match(main, /shownNames = labels\.shown;/);
  assert.match(main, /const c = \[\.\.\.hud\.covers\(\), \.\.\.lock\.covers\(\)\]/);
});
