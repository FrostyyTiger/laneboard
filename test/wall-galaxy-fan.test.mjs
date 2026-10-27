// The fan (Wall plan night 4 T3, reviews/r51-touch galaxy 3, option (a)):
// galaxy/fan.js and touch.js hitAll. In an open system of the large demo
// most planets have a neighbour nearer than the finger's disc; a tap that
// holds two or more fans them out round the finger as rows of at least
// 48 px, and the next tap on a row opens that planet. On the large fixture
// every trouble member of HV1 (`lab`) and HV2 is reachable in two taps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { document, makeEl } from './helpers/fakedom.mjs';
import { FAN, createFan, fanHit, fanLayout, fanText } from '../public/js/wall/galaxy/fan.js';
import { TAP, TOUCH, createTaps, createTouch, hitAll, hitTest, memberPoints } from '../public/js/wall/galaxy/touch.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { DEMO_TIMING } from '../public/js/wall/tour.js';
import * as THREE from '../public/vendor/three/three.module.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const LARGE = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

const W = 1368, H = 912; // the tablet's css px (night 1's Q6)

/** Two boxes overlap (touching edges do not). */
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const centre = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/** Every pair of rows: their centres at least `min` apart, no two boxes on each other. */
function assertApart(fan, min = 48) {
  const its = fan.items;
  for (let i = 0; i < its.length; i++) {
    for (let j = i + 1; j < its.length; j++) {
      const a = centre(its[i].box), b = centre(its[j].box);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= min, `${its[i].id} and ${its[j].id} ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)} px apart`);
      assert.ok(!overlap(its[i].box, its[j].box), `${its[i].id} on ${its[j].id}`);
    }
  }
}

function assertOnStage(fan) {
  for (const it of fan.items) {
    const b = it.box;
    assert.ok(b.bottom - b.top >= 48, `${it.id}: a row at least 48 px tall`);
    assert.ok(b.right - b.left >= 48, `${it.id}: and wide`);
    assert.ok(b.left >= 0 && b.top >= 0 && b.right <= W && b.bottom <= H, `${it.id} on the stage: ${JSON.stringify(b)}`);
  }
}

const pt = (id, x, y, tone = 'calm') => ({ id, site: 's', x, y, r: 3, tone, box: null });

test('hitAll: every point in the finger\'s disc or under it by name, worst first, then the nearest', () => {
  const pts = [
    pt('far', 200, 100),
    pt('calm-near', 101, 100),
    pt('calm-mid', 110, 100),
    pt('warn', 120, 100, 'warn'),
    pt('crit', 125, 100, 'crit'),
    { ...pt('named', 400, 400), box: { x: 95, y: 95, w: 10, h: 10 } },
  ];
  assert.deepEqual(hitAll(pts, 100, 100).map((p) => p.id), ['crit', 'warn', 'named', 'calm-near', 'calm-mid']);
  assert.equal(hitAll(pts, 100, 100)[0], hitTest(pts, 100, 100), 'its first is hitTest\'s pick');
  assert.deepEqual(hitAll(pts, 600, 600), []);
  assert.deepEqual(hitAll(null, 0, 0), []);
  assert.equal(TAP.radiusPx * 2, 54);
});

test('fanLayout: rows of at least 48 px round the finger, 48 px apart or more, none on another, 2 to FAN.max', () => {
  for (let n = 2; n <= FAN.max; n++) {
    const hits = Array.from({ length: n }, (_, i) => pt(`m${i}`, 600 + (i % 5) * 7 - 14, 450 + i * 3));
    const fan = fanLayout(hits, 600, 450, { W, H });
    assert.equal(fan.items.length, n);
    assertApart(fan);
    assertOnStage(fan);
    assert.ok(FAN.rowPx >= 48 && FAN.pitchPx >= FAN.rowPx);
    // Round the finger: every row's inner end at least FAN.ringPx/2 off it, the two arcs either side.
    for (const it of fan.items) {
      assert.ok(Math.hypot(it.anchor.x - fan.x, it.anchor.y - fan.y) >= FAN.ringPx - 1, `${it.id}: on the ring`);
      assert.ok(it.side === 'left' ? it.box.right <= fan.x : it.box.left >= fan.x, `${it.id}: on its side`);
    }
    assert.ok(Math.abs(fan.items.filter((it) => it.side === 'left').length - fan.items.filter((it) => it.side === 'right').length) <= 1, 'balanced');
  }
});

test('fanLayout: a row stands where its planet is (left of the finger on the left, top to bottom as on screen)', () => {
  const hits = [pt('ne', 610, 440, 'warn'), pt('sw', 590, 460), pt('nw', 590, 440), pt('se', 610, 460)];
  const fan = fanLayout(hits, 600, 450, { W, H });
  const at = Object.fromEntries(fan.items.map((it) => [it.id, it]));
  assert.deepEqual([at.nw.side, at.sw.side, at.ne.side, at.se.side], ['left', 'left', 'right', 'right']);
  assert.ok(at.nw.box.top < at.sw.box.top && at.ne.box.top < at.se.box.top);
  assert.deepEqual(at.ne.to, { x: 610, y: 440 });
  assert.equal(at.ne.tone, 'warn');
});

test('fanLayout: near an edge or a corner the ring moves inward as one, every row on the stage', () => {
  const hits = Array.from({ length: 8 }, (_, i) => pt(`m${i}`, (i % 2 ? 1 : -1) * 5, i * 2, i === 3 ? 'crit' : 'calm'));
  for (const [x, y] of [[4, 4], [W - 4, 4], [4, H - 4], [W - 4, H - 4], [W / 2, 2], [W / 2, H - 2]]) {
    const fan = fanLayout(hits.map((h) => ({ ...h, x: h.x + x, y: h.y + y })), x, y, { W, H });
    assertOnStage(fan);
    assertApart(fan);
  }
});

test('fanLayout: past FAN.max the worst stay and the calm nearest the edge of the disc go', () => {
  const hits = Array.from({ length: FAN.max + 4 }, (_, i) => pt(`m${i}`, 600 + i, 450, i >= FAN.max ? 'warn' : 'calm'));
  const sorted = hitAll(hits, 600, 450);
  const fan = fanLayout(sorted, 600, 450, { W, H });
  assert.equal(fan.items.length, FAN.max);
  for (let i = FAN.max; i < FAN.max + 4; i++) assert.ok(fan.items.some((it) => it.id === `m${i}`), `trouble m${i} kept`);
});

test('fanHit: a row is hit anywhere on it, and the gap between two rows is the nearer one\'s', () => {
  const fan = fanLayout([pt('a', 590, 440), pt('b', 590, 460), pt('c', 610, 440), pt('d', 610, 460)], 600, 450, { W, H });
  for (const it of fan.items) assert.equal(fanHit(fan, centre(it.box).x, centre(it.box).y), it);
  const [up, down] = fan.items.filter((it) => it.side === 'right');
  const mid = (up.box.bottom + down.box.top) / 2;
  assert.equal(fanHit(fan, up.box.left + 10, mid - 1), up);
  assert.equal(fanHit(fan, up.box.left + 10, mid + 1), down);
  assert.equal(fanHit(fan, fan.x, fan.y), null, 'the finger\'s own spot is no row');
  assert.equal(fanHit(null, 0, 0), null);
});

test('fanText: a row says what the planet\'s name says, its shape first when in trouble', () => {
  assert.equal(fanText({ id: 'x', node: { id: 'x', label: 'Fix-Login', kind: 'lane' }, tone: 'warn' }), '▲ fix-login');
  assert.equal(fanText({ id: 'vm-a', tone: 'calm' }), 'vm-a');
});

// ---- the large fixture, on the camera ----

/** The large fixture as the scene holds it (members at their open offsets), as the touch tests' fakeGalaxy. */
function largeGalaxy() {
  const lay = galaxyLayout(LARGE);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0,
    members: s.members.map((m) => ({ id: m.id, node: m.node, planet: m.planet, mesh: { position: new THREE.Vector3(s.home.x + m.off.x, s.home.y + m.off.y, s.home.z + m.off.z) } })),
  }));
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen(id, k) { this.world.byId.get(id).open = k; },
    setHeld() {},
    camera: new THREE.PerspectiveCamera(42, W / H, 1, 30000),
    renderer: { domElement: { clientWidth: W, clientHeight: H } },
    size: () => ({ W, H }),
  };
}

/** A stage element that keeps its listeners (as the touch tests'). */
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

/**
 * The page's taps as main.js wires them: a fan up takes the tap (a row, or
 * nothing but closing it); else two or more members under the finger fan
 * out, one opens, none falls to the sites (left out here: only planets count).
 */
function fanPage(site) {
  let now = 100_000;
  const galaxy = largeGalaxy();
  const cam = createGalaxyCamera(galaxy, { steer: true });
  const stage = stageEl();
  const touch = createTouch(stage, { clock: () => now, wake: () => {} });
  const root = makeEl('div');
  const fan = createFan(root, { screenOf: cam.screenOf, size: galaxy.size, clock: () => now, doc: document });
  const opened = [];
  createTaps(touch, {
    clock: () => now,
    pick: (x, y) => {
      if (fan.shown()) return fan.hit(x, y) ?? { covered: true };
      const members = hitAll(memberPoints(galaxy.world.sites, cam.screenOf), x, y);
      if (members.length > 1) return { fan: members, x, y };
      return members[0] ?? null;
    },
    tap: (hit) => {
      if (hit?.fan) { fan.show(hit.fan, hit.x, hit.y); return; }
      fan.hide();
      if (hit?.site) opened.push(hit.id);
    },
  });
  const tick = (ms = 16) => { now += ms; touch.mode(); cam.frame(now); fan.draw(); };
  const run = (ms) => { for (let t = 0; t < ms; t += 16) tick(16); };
  stage.dispatch('pointerdown', { pointerId: 1 }); // the waking touch
  stage.dispatch('pointerup', { pointerId: 1 });
  run(TOUCH.fitMs + 100);
  cam.focus(site, DEMO_TIMING.zoom);
  run(6000);
  assert.equal(galaxy.world.byId.get(site).open, 1, `${site} open`);
  let id = 10;
  const tapAt = ({ x, y }) => {
    stage.dispatch('pointerdown', { pointerId: ++id, clientX: x, clientY: y });
    tick(60);
    stage.dispatch('pointerup', { pointerId: id, clientX: x, clientY: y });
    tick(16);
  };
  return { galaxy, cam, fan, root, opened, tapAt, run, tick };
}

for (const site of ['lab', 'hv2']) {
  test(`the large fixture, ${site} open: every member, trouble first, is reachable in two taps, fan rows 48 px apart`, () => {
    const p = fanPage(site);
    const s = p.galaxy.world.byId.get(site);
    const trouble = s.members.filter((m) => toneOf(m.node) !== 'calm');
    assert.ok(trouble.length >= (site === 'lab' ? 5 : 1), `${site}: ${trouble.length} in trouble`);
    let crowded = 0;
    // The trouble members first (the task's bar), then the calm ones (r51: "a calm planet next to a trouble one can never be picked").
    for (const m of [...trouble, ...s.members.filter((x) => !trouble.includes(x))]) {
      const at = p.cam.screenOf(m.id);
      assert.ok(at && at.x > 0 && at.x < W && at.y > 0 && at.y < H, `${m.id} on screen`);
      const before = p.opened.length;
      p.tapAt(at);
      if (p.fan.shown()) {
        crowded++;
        assert.equal(p.opened.length, before, `${m.id}: the first tap opens nothing, it fans out`);
        const rows = p.fan.covers();
        assert.ok(rows.length >= 2);
        for (const b of rows) assert.ok(b.bottom - b.top >= 48 && b.left >= 0 && b.right <= W && b.top >= 0 && b.bottom <= H);
        for (let i = 0; i < rows.length; i++) {
          for (let j = i + 1; j < rows.length; j++) {
            const a = centre(rows[i]), b = centre(rows[j]);
            assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 48 && !overlap(rows[i], rows[j]), `${m.id}'s fan: rows ${i} and ${j}`);
          }
        }
        const row = p.root.children.find((c) => c.className === 'galaxy-fan-row' && c.textContent === fanText({ id: m.id, node: m.node, tone: toneOf(m.node) }));
        assert.ok(row, `${m.id} has a row`);
        const i = p.root.children.filter((c) => c.className === 'galaxy-fan-row').indexOf(row);
        p.tapAt(centre(rows[i]));
      }
      assert.deepEqual([p.opened.length, p.opened.at(-1)], [before + 1, m.id], `${m.id} opened`);
      assert.equal(p.fan.shown(), false, 'and the fan gone');
    }
    if (site === 'lab') assert.ok(crowded >= 10, `in lab many planets are crowded (${crowded} of ${s.members.length} fanned)`);
  });
}

test('the fan closes on a tap off its rows, which opens nothing; its leaders follow their planets', () => {
  const p = fanPage('lab');
  const crowded = p.galaxy.world.byId.get('lab').members.find((m) => toneOf(m.node) !== 'calm' && hitAll(memberPoints(p.galaxy.world.sites, p.cam.screenOf), p.cam.screenOf(m.id).x, p.cam.screenOf(m.id).y).length > 1);
  assert.ok(crowded, 'a crowded trouble planet in lab');
  p.tapAt(p.cam.screenOf(crowded.id));
  assert.ok(p.fan.shown());
  assert.equal(p.root.hidden, false);
  const leaders = p.root.children.filter((c) => c.className === 'galaxy-fan-leader');
  const rows = p.root.children.filter((c) => c.className === 'galaxy-fan-row');
  assert.equal(leaders.length, rows.length);
  p.run(FAN.inMs + 400);
  for (const r of rows) assert.equal(r.style.opacity, '1.000', 'every row out by FAN.inMs and a stagger');
  for (const l of leaders) assert.match(l.style.transform, /^translate3d\(-?\d+px, -?\d+px, 0\) rotate\(-?[\d.]+rad\) scaleX\([\d.]+\)$/);
  const n = p.opened.length;
  p.tapAt({ x: 4, y: 4 });
  assert.equal(p.fan.shown(), false, 'closed');
  assert.equal(p.root.hidden, true);
  assert.equal(p.root.children.length, 0);
  assert.equal(p.opened.length, n, 'and nothing opened');
});

test('createFan: still (reduced motion) puts the rows in place at once; covers() are the rows; a single hit is no fan', () => {
  const root = makeEl('div');
  const fan = createFan(root, { size: () => ({ W, H }), still: true, clock: () => 0, doc: document });
  assert.equal(root.hidden, true);
  fan.show([pt('a', 590, 440, 'crit'), pt('b', 610, 460)], 600, 450);
  const rows = root.children.filter((c) => c.className === 'galaxy-fan-row');
  assert.deepEqual(rows.map((r) => r.style.opacity), ['1.000', '1.000']);
  assert.deepEqual(rows.map((r) => [r.dataset.tone, r.dataset.side]), [['crit', 'left'], ['calm', 'right']]);
  assert.equal(fan.covers().length, 2);
  const c = centre(fan.covers()[0]);
  assert.deepEqual(fan.hit(c.x, c.y), { id: 'a', site: 's' });
  fan.hide();
  assert.deepEqual(fan.covers(), []);
  assert.equal(fan.hit(c.x, c.y), null);
});

test('galaxy/main.js wires the fan (night 4 T3): asked first while up, two members under a finger fan out', () => {
  const js = read('js/wall/galaxy/main.js');
  const pick = js.slice(js.indexOf('pick: (x, y) =>'), js.indexOf('tap: (hit)'));
  assert.ok(pick.indexOf('fan?.shown()') >= 0 && pick.indexOf('fan?.shown()') < pick.indexOf('coverHit('), 'a fan up first');
  assert.match(pick, /fan\.hit\(x - o\.left, y - o\.top\) \?\? COVERED/);
  assert.match(pick, /const members = hitAll\(memberPoints\(/);
  assert.match(pick, /if \(members\.length > 1\) return \{ fan: members/);
  assert.match(js, /if \(hit\?\.fan\) \{ fan\.show\(hit\.fan, hit\.x, hit\.y\); return; \}\s*fan\?\.hide\(\);/);
  assert.match(js, /moved: \(\) => fan\?\.hide\(\)/, 'a turn or a zoom closes it');
  assert.match(js, /cam\.onDraw\(fan\.draw\)/);
  assert.match(js, /avoid: \(\) => \[\.\.\.hud\.covers\(\), \.\.\.touchCovers\(\)\]/, 'the rows keep off the words, the back control and the manual line (night 4 T5)');
  assert.match(js, /\.\.\.\(fan\?\.covers\(\) \?\? \[\]\)/, 'the names keep off the rows');
  const html = read('galaxy.html');
  assert.match(html, /<div class="galaxy-fan" id="galaxy-fan" hidden><\/div>/);
  assert.ok(html.indexOf('galaxy-fan') > html.indexOf('wall-caption') && html.indexOf('galaxy-fan') < html.indexOf('galaxy-back'), 'over the words, under back');
  const css = read('css/wall.css');
  assert.match(css, /\.galaxy-fan-row \{[^}]*height: 48px;/);
});

test('fanLayout: rows that would stand on the words move off them by the least move; never farther than FAN.shiftPx', () => {
  const hits = [pt('a', 590, 440), pt('b', 590, 460), pt('c', 610, 440, 'warn'), pt('d', 610, 460)];
  const free = fanLayout(hits, 600, 450, { W, H });
  const plate = { left: 80, top: 70, right: free.items.find((it) => it.side === 'left').box.left + 60, bottom: 600 };
  const fan = fanLayout(hits, 600, 450, { W, H, avoid: [plate] });
  for (const it of fan.items) assert.ok(!overlap(it.box, plate), `${it.id} off the plate`);
  assert.equal(fan.y, free.y, 'moved along one axis');
  assert.ok(fan.x > free.x && fan.x - free.x < 120, `to the right, a little: ${fan.x - free.x} px`);
  assertApart(fan);
  assertOnStage(fan);
  // Nowhere clear (the words everywhere): the ring stays round the finger.
  const all = fanLayout(hits, 600, 450, { W, H, avoid: [{ left: 0, top: 0, right: W, bottom: H }] });
  assert.deepEqual([all.x, all.y], [free.x, free.y]);
  // A plate too wide to clear and a line below: never more rows on the words, never far from the finger.
  const wide = { left: 0, top: 0, right: 900, bottom: 500 }, line = { left: 0, top: 560, right: W, bottom: H };
  const boxed = fanLayout(hits, 600, 450, { W, H, avoid: [wide, line] });
  const on = (fan) => fan.items.filter((it) => overlap(it.box, wide) || overlap(it.box, line)).length;
  assert.ok(on(boxed) <= on(free), `${on(boxed)} rows on the words, ${on(free)} where the finger was`);
  assert.ok(Math.hypot(boxed.x - free.x, boxed.y - free.y) <= FAN.shiftPx, 'and the ring still the finger\'s');
  assertApart(boxed);
  assertOnStage(boxed);
});

test('fanLayout: with the plate where the left arc would stand, every row goes to the right arc, none on the words', () => {
  const hits = Array.from({ length: 6 }, (_, i) => pt(`m${i}`, 960 + (i % 2 ? 6 : -6), 300 + i * 3, i < 3 ? 'warn' : 'calm'));
  const plate = { left: 82, top: 73, right: 848, bottom: 590 };
  const free = fanLayout(hits, 966, 300, { W, H });
  assert.ok(free.items.some((it) => overlap(it.box, plate)), 'both arcs: the left one on the plate');
  const fan = fanLayout(hits, 966, 300, { W, H, avoid: [plate] });
  assert.equal(fan.items.length, 6);
  assert.ok(fan.items.every((it) => it.side === 'right'), 'one arc, on the right');
  for (const it of fan.items) assert.ok(!overlap(it.box, plate), `${it.id} off the plate`);
  assert.ok(Math.hypot(fan.x - 966, fan.y - 300) <= FAN.shiftPx, 'round the finger still');
  assertApart(fan);
  assertOnStage(fan);
});
