// The galaxy's effects (Wall plan night 2 T12, README §7.C, D9): `?fx=`
// turns them on one by one, none by default (night 4 T15 removed `lanes`);
// `activity` (T17, replacing night 2's `comets` and `twinkle`) lights what
// is at work and dims what is quiet, flashes a job's target once when it
// lands and lets a failed one stop short.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AFTERGLOW, AFTERGLOW_STEPS, afterglowAt, afterglows,
  ACTIVITY, BEACON, FX_NAMES, WARP, activityLook, beaconAt, beaconHeight, beaconNear, beaconScale, beaconWidth, beamProfile, coreProfile, critAges, flowJobs,
  jobAt, jobFailed, parseFx, trackJobs, trackWork, workAt, workingPlanets,
  warpAt, warpCone, warpCovered, warpTail,
} from '../public/js/wall/galaxy/fx.js';
import * as THREE from '../public/vendor/three/three.module.js';
import { ease } from '../public/js/wall/galaxy/layout.js';
import { NEBULA, paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { FOV, WARP_DUST, WARP_STARS, createGalaxyScene, overviewShot } from '../public/js/wall/galaxy/scene.js';
import { ndcOf } from '../public/js/wall/galaxy/framing.js';

test('parseFx: nothing by default, known names only, comma-separated or repeated, any case', () => {
  assert.deepEqual([...parseFx('')], []);
  assert.deepEqual([...parseFx('?demo=1')], []);
  assert.deepEqual([...parseFx('?fx=activity,bogus')], ['activity']);
  assert.deepEqual([...parseFx('?fx=bogus')], []);
  assert.deepEqual([...parseFx('?fx= Activity ')], ['activity']);
  assert.deepEqual([...parseFx('?fx=bogus&fx=activity')], ['activity']);
  assert.deepEqual([...parseFx(new URLSearchParams('fx=activity'))], ['activity']);
  assert.deepEqual([...parseFx('?fx=activity,beacon')].sort(), ['activity', 'beacon']);
  assert.deepEqual([...parseFx('?fx=beacon')], ['beacon'], 'activity only when asked');
  assert.deepEqual([...parseFx('?fx=beacon')], ['beacon']);
  assert.deepEqual([...parseFx('?fx=warp,beacon')].sort(), ['beacon', 'warp']);
  assert.deepEqual([...parseFx('?fx=beacon')].includes('warp'), false, 'warp only when asked');
});

/** Three sites under a core; `db` in hv1, `storage` in hv2, `nas` in remote, `api` a second hv1 room. */
function model({ links = [], events = [], generatedAt = 100_000 } = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'remote']) nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
  nodes.push(
    { id: 'db', parent: 'hv1', kind: 'room', status: 'ok' },
    { id: 'api', parent: 'hv1', kind: 'room', status: 'ok' },
    { id: 'db-svc', parent: 'db', kind: 'service', status: 'ok' },
    { id: 'storage', parent: 'hv2', kind: 'room', status: 'ok' },
    { id: 'nas', parent: 'remote', kind: 'room', status: 'ok' },
  );
  return { nodes, links, events, generatedAt };
}
const SITES = ['hv1', 'hv2', 'remote'];

test('lanes is gone (night 4 T15): not a name, and ?fx=lanes is ignored', () => {
  assert.equal(FX_NAMES.includes('lanes'), false);
  assert.deepEqual([...parseFx('?fx=lanes')], []);
  assert.deepEqual([...parseFx('?fx=lanes,warp')], ['warp']);
});

// --- in the scene ---------------------------------------------------------------

const fakeDoc = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    }),
  }),
};

function sceneAt(opts = {}) {
  const clock = { now: 1000 };
  const galaxy = createGalaxyScene({ clientWidth: 1600, clientHeight: 900 }, {
    palette: paletteFrom(), doc: fakeDoc, clock: () => clock.now,
    makeRenderer: (canvas) => ({ domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() {} }),
    ...opts,
  });
  const at = (ms) => { clock.now = ms; galaxy.frame(ms); };
  return { galaxy, at };
}

// --- fx=activity ------------------------------------------------------------------

test('activity replaces comets and twinkle (night 4 T17): neither is a name any more', () => {
  assert.deepEqual([...FX_NAMES], ['beacon', 'warp', 'afterglow', 'activity', 'sweep']);
  assert.deepEqual([...parseFx('?fx=comets,twinkle')], []);
  assert.deepEqual([...parseFx('?fx=twinkle,activity')], ['activity']);
});

test('activityLook: at work is a step brighter and larger with a ring, more a little more, capped; quiet recedes', () => {
  const quiet = activityLook(0);
  assert.deepEqual(quiet, { glow: 0, grow: 1, ring: 0, light: ACTIVITY.quiet });
  assert.ok(ACTIVITY.quiet >= 0.5 && ACTIVITY.quiet < 0.8, 'one step down, still readable');
  const one = activityLook(1), two = activityLook(2), full = activityLook(ACTIVITY.full), lots = activityLook(40);
  assert.equal(one.ring, 1);
  assert.equal(one.light, 1);
  assert.ok(one.glow > 0 && one.grow > 1);
  assert.ok(two.glow > one.glow && two.grow > one.grow, 'more at work, a little more');
  assert.deepEqual(lots, full, 'capped');
  assert.ok(one.grow >= 1.1 && full.grow <= 1.15 + 1e-9, 'a step, never a jump (Q18: 10-15 %)');
  // Calm stays calm: quieter than any trouble halo, a slow breath.
  assert.ok(full.glow < 0.5 && ACTIVITY.ringOpacity <= 0.5);
  assert.ok(ACTIVITY.periodMs >= 3000 && ACTIVITY.periodMs <= 6000);
  assert.deepEqual(activityLook(-3), quiet);
  assert.deepEqual(activityLook('x'), quiet);
});

/** hv1 with a builder whose lanes are at work (or not), hv2 with a room in trouble and a working session in it. */
function workModel({ lanes = [], extra = [] } = {}) {
  const m = model();
  m.nodes.push(
    { id: 'builder:a', parent: 'api', kind: 'builder', label: 'builder-a', status: 'ok' },
    ...lanes.map((l) => ({ parent: 'builder:a', kind: 'lane', ...l })),
    ...extra,
  );
  return m;
}

test('workingPlanets: a planet with a working, calm session or job below it is lit, counted', () => {
  const m = workModel({
    lanes: [
      { id: 'lane:a/x', status: 'working' },
      { id: 'lane:a/y', status: 'idle' },
      { id: 'lane:a/z', status: 'attention' },
    ],
    extra: [
      { id: 'sess:a/y1', parent: 'lane:a/y', kind: 'session', status: 'working' },
      { id: 'sess:a/y2', parent: 'lane:a/y', kind: 'session', status: 'idle' },
      { id: 'runner', parent: 'storage', kind: 'service', status: 'working' },
      { id: 'cron', parent: 'storage', kind: 'service', status: 'ok' },
    ],
  });
  const planets = new Set(['hv1', 'hv2', 'remote', 'db', 'api', 'storage', 'nas', 'builder:a']);
  assert.deepEqual(workingPlanets(m, planets), [
    { id: 'builder:a', site: 'hv1', count: 2 },
    { id: 'storage', site: 'hv2', count: 1 },
  ]);
  // The builder not drawn as a planet: its room's planet is lit instead.
  planets.delete('builder:a');
  assert.deepEqual(workingPlanets(m, planets).map((w) => w.id), ['api', 'storage']);
  // A working thing drawn as a planet itself is its own.
  assert.deepEqual(workingPlanets(m, new Set([...planets, 'runner'])).map((w) => w.id), ['api', 'runner']);
});

test('workingPlanets: idle, waiting, stuck, a room, or nothing drawn lights nothing', () => {
  const m = workModel({
    lanes: [
      { id: 'lane:a/idle', status: 'idle' },
      { id: 'lane:a/ask', status: 'attention' },
      { id: 'lane:a/stuck', status: 'working', flags: { stuck: { rule: 'tool-loop' } } },
    ],
    extra: [{ id: 'busy-room', parent: 'hv2', kind: 'room', status: 'working' }],
  });
  assert.deepEqual(workingPlanets(m, ['hv1', 'hv2', 'api', 'storage', 'builder:a', 'busy-room']), [], 'calm stays calm: only things at work');
  assert.deepEqual(workingPlanets(workModel({ lanes: [{ id: 'l', status: 'working' }] }), []), []);
  assert.deepEqual(workingPlanets({}, ['hv1']), []);
  assert.deepEqual(workingPlanets(null, null), []);
});

test('trackWork and workAt: fades in, breathes slow, takes new counts, fades out when work stops', () => {
  let t = trackWork(null, [{ id: 'p', site: 'hv1', count: 1 }], 0);
  const p = () => t.get('p');
  assert.equal(workAt(p(), 0).k, 0, 'comes in from nothing');
  assert.equal(workAt(p(), ACTIVITY.fadeMs).k, 1);
  const breath = [];
  for (let ms = 2000; ms < 2000 + ACTIVITY.periodMs; ms += 100) breath.push(workAt(p(), ms).ring);
  assert.ok(Math.max(...breath) > 0.95 && Math.min(...breath) < 0.05, 'one full breath a period');
  for (let i = 1; i < breath.length; i++) assert.ok(Math.abs(breath[i] - breath[i - 1]) < 0.15, 'slow: no jumps');
  t = trackWork(t, [{ id: 'p', site: 'hv1', count: 3 }], 3000);
  assert.equal(p().count, 3);
  assert.equal(p().t0, 0, 'keeps its start');
  t = trackWork(t, [], 4000);
  assert.equal(p().until, 4000);
  assert.ok(workAt(p(), 4000 + ACTIVITY.fadeMs / 2).k < 0.6);
  assert.equal(workAt(p(), 4000 + ACTIVITY.fadeMs), undefined);
  // Two planets breathe out of step; still: steady, full.
  const a = { id: 'builder-a', t0: 0, until: Infinity }, b = { id: 'builder-b', t0: 0, until: Infinity };
  let apart = 0;
  for (let ms = 0; ms < 20000; ms += 500) apart = Math.max(apart, Math.abs(workAt(a, ms).ring - workAt(b, ms).ring));
  assert.ok(apart > 0.3);
  assert.deepEqual(workAt(a, 5000, ACTIVITY, true), { k: 1, ring: 1 });
  assert.deepEqual(workAt(a, 9000, ACTIVITY, true), workAt(a, 5000, ACTIVITY, true));
  // Capped, the oldest kept.
  const many = Array.from({ length: ACTIVITY.max + 5 }, (_, i) => ({ id: `p${i}`, site: 'hv1', count: 1 }));
  assert.equal(trackWork(null, many, 0).size, ACTIVITY.max);
});

test('flowJobs: a link event is a job from the drawn thing it left to the one it lands on, failed or not', () => {
  const m = model({
    links: [{ from: 'db', to: 'storage', kind: 'flow' }, { id: 'push', from: 'db-svc', to: 'nas', kind: 'flow' }],
    events: [
      { at: 99_000, node: 'db', kind: 'ok', text: 'db dumps → storage', link: 'db>storage' },
      { at: 99_500, node: 'db-svc', kind: 'failed', text: 'push failed', link: 'push' },
      { at: 99_600, node: 'db', kind: 'crit', text: 'dump broke', link: 'db>storage' },
    ],
  });
  const drawn = new Set(['hv1', 'hv2', 'remote', 'db', 'api', 'storage', 'nas']);
  assert.deepEqual(flowJobs(m, drawn), [
    { key: '99000:db>storage', from: 'db', to: 'storage', fromSite: 'hv1', toSite: 'hv2', failed: false, ageMs: 1000 },
    { key: '99500:push', from: 'db', to: 'nas', fromSite: 'hv1', toSite: 'remote', failed: true, ageMs: 500 },
    { key: '99600:db>storage', from: 'db', to: 'storage', fromSite: 'hv1', toSite: 'hv2', failed: true, ageMs: 400 },
  ]);
  for (const kind of ['fail', 'failed', 'error', 'crit', 'Failed']) assert.equal(jobFailed({ kind }), true, kind);
  for (const kind of ['ok', 'done', 'working', 'warn', undefined]) assert.equal(jobFailed({ kind }), false, String(kind));
});

test('flowJobs: too old, unknown link, two ends drawn as one, or nothing drawn is no job', () => {
  const links = [{ from: 'db', to: 'storage' }, { from: 'db', to: 'db-svc' }];
  const ev = (at, link) => ({ at, node: 'db', kind: 'ok', link });
  const drawn = ['hv1', 'hv2', 'db', 'storage'];
  assert.deepEqual(flowJobs(model({ links, events: [ev(100_000 - ACTIVITY.windowMs - 1, 'db>storage')] }), drawn), []);
  assert.deepEqual(flowJobs(model({ links, events: [ev(99_000, 'nope')] }), drawn), []);
  assert.deepEqual(flowJobs(model({ links, events: [ev(99_000, 'db>db-svc')] }), drawn), [], 'db-svc folds into db');
  assert.deepEqual(flowJobs(model({ links, events: [ev(99_000, 'db>storage')] }), []), []);
  assert.equal(flowJobs(model({ links, events: [ev(99_000, 'db>storage'), ev(99_000, 'db>storage')] }), drawn).length, 1);
  assert.deepEqual(flowJobs(null, null), []);
});

test('jobAt: a landed job is one opening flash; a failed one flies, stops short and breaks up, never a flash', () => {
  const landed = { key: 'a', failed: false, t0: 1000 }, failed = { key: 'b', failed: true, t0: 1000 };
  assert.equal(jobAt(landed, 999), null);
  assert.equal(jobAt(landed, 1000 + ACTIVITY.flashMs), undefined, 'once');
  let r = -1, peak = 0;
  for (let ms = 1000; ms < 1000 + ACTIVITY.flashMs; ms += 30) {
    const at = jobAt(landed, ms);
    assert.equal(at.miss, undefined);
    assert.ok(at.flash.r >= r, 'it only opens');
    r = at.flash.r;
    peak = Math.max(peak, at.flash.k);
  }
  assert.ok(peak > 0.8, 'a plain flash');
  assert.ok(jobAt(landed, 1000 + ACTIVITY.flashMs * 0.95).flash.k < 0.05, 'gone as it opens');
  let u = -1;
  for (let ms = 1000; ms < 1000 + ACTIVITY.missMs; ms += 30) {
    const at = jobAt(failed, ms);
    assert.equal(at.flash, undefined, 'a failed job never flashes');
    assert.ok(at.miss.u >= u && at.miss.u <= ACTIVITY.reach + 1e-9, 'it stops short');
    u = at.miss.u;
  }
  assert.ok(Math.abs(u - ACTIVITY.reach) < 1e-9 && ACTIVITY.reach < 0.5, 'it gets less than half way');
  assert.ok(jobAt(failed, 1000 + ACTIVITY.missMs * 0.97).miss.k < 0.05, 'breaks up');
  assert.ok(jobAt(failed, 1000 + ACTIVITY.missMs * 0.9).miss.spread > 0.5);
  assert.equal(jobAt(failed, 1000 + ACTIVITY.missMs), undefined);
  // Still: the end state, steady.
  assert.deepEqual(jobAt(landed, 1100, ACTIVITY, true), jobAt(landed, 1800, ACTIVITY, true));
  assert.deepEqual(jobAt(failed, 1100, ACTIVITY, true).miss.u, ACTIVITY.reach);
});

test('trackJobs: a job plays once from when the page sees it, capped', () => {
  const job = (key, failed = false) => ({ key, from: 'db', to: 'storage', fromSite: 'hv1', toSite: 'hv2', failed, ageMs: 0 });
  let t = trackJobs(null, [job('1:a')], 5000);
  assert.deepEqual(t.playing.map((j) => [j.key, j.t0, j.failed]), [['1:a', 5000, false]]);
  t = trackJobs(t, [job('1:a')], 5300);
  assert.equal(t.playing.length, 1, 'the next model repeats it: not again');
  t = trackJobs(t, [job('1:a')], 5000 + ACTIVITY.flashMs + 10);
  assert.equal(t.playing.length, 0);
  const many = Array.from({ length: ACTIVITY.jobs + 3 }, (_, i) => job(`${i}:x`, i % 2 === 1));
  t = trackJobs(t, many, 8000);
  assert.equal(t.playing.length, ACTIVITY.jobs);
  assert.equal(t.playing[1].failed, true);
});

/** The scene's sprites named `name` (fx-activity, fx-activity-ring, fx-land, fx-miss). */
function spritesNamed(galaxy, name) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return root.children.filter((o) => o.isSprite && o.name === name);
}
const ACT_POOLS = ['fx-activity', 'fx-activity-ring', 'fx-land', 'fx-miss'];

const busyModel = () => workModel({
  lanes: [{ id: 'lane:a/x', status: 'working' }],
  extra: [
    { id: 'jam', parent: 'hv2', kind: 'room', status: 'crit' },
    { id: 'lane:jam/x', parent: 'jam', kind: 'lane', status: 'working' },
  ],
});
const memberOf = (galaxy, site, id) => galaxy.world.byId.get(site).members.find((x) => x.id === id);

test('without fx=activity the scene makes none of it, ignores work and jobs and changes no planet', () => {
  const plain = sceneAt({ fx: new Set(['warp']) });
  const m = busyModel();
  plain.galaxy.update(m);
  plain.galaxy.setActivity(workingPlanets(m, plain.galaxy.planets()));
  plain.galaxy.setJobs([{ key: '1:a', from: 'db', to: 'storage', fromSite: 'hv1', toSite: 'hv2', failed: false }]);
  plain.at(1000 + ACTIVITY.fadeMs * 2);
  for (const name of ACT_POOLS) assert.equal(spritesNamed(plain.galaxy, name).length, 0, name);
  assert.equal(plain.galaxy.activity.size, 0);
  assert.equal(plain.galaxy.jobs.length, 0);
  const builder = memberOf(plain.galaxy, 'hv1', 'builder:a'), db = memberOf(plain.galaxy, 'hv1', 'db');
  assert.equal(builder.mesh.material, db.mesh.material, 'one calm material for all');
  assert.equal(builder.lift, undefined);
});

test('with fx=activity a working planet is brighter, a step larger and ringed; quiet ones recede; trouble untouched', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['activity']) });
  const m = busyModel();
  galaxy.update(m);
  for (const name of ['fx-activity', 'fx-activity-ring']) assert.equal(spritesNamed(galaxy, name).length, ACTIVITY.max, 'one pool, made once');
  galaxy.setActivity(workingPlanets(m, galaxy.planets()));
  assert.deepEqual([...galaxy.activity.keys()].sort(), ['builder:a', 'jam']);
  const builder = memberOf(galaxy, 'hv1', 'builder:a'), db = memberOf(galaxy, 'hv1', 'db'), jam = memberOf(galaxy, 'hv2', 'jam');
  at(1000 + ACTIVITY.fadeMs + 800);
  assert.notEqual(builder.mesh.material, db.mesh.material, 'busy and quiet look apart');
  assert.ok(builder.mesh.material.emissive.r > db.mesh.material.emissive.r, 'busy is lit from inside');
  assert.ok(db.mesh.material.color.r < builder.mesh.material.color.r * 0.8, 'quiet recedes a step');
  assert.ok(Math.abs(builder.lift - activityLook(1).grow) < 1e-9, 'a step larger');
  const scaleOf = (x) => x.mesh.scale.x * x.mesh.geometry.parameters.radius;
  assert.ok(scaleOf(builder) > scaleOf(db) * 1.08);
  assert.equal(jam.lift ?? 1, 1, 'trouble keeps its size');
  assert.ok(jam.mesh.material !== builder.mesh.material && jam.mesh.material !== db.mesh.material, 'and its material');
  const lit = (name) => spritesNamed(galaxy, name).filter((s) => s.visible);
  const ring = [];
  for (let t = 1000 + ACTIVITY.fadeMs; t < 1000 + ACTIVITY.fadeMs + ACTIVITY.periodMs; t += 200) {
    at(t);
    assert.equal(lit('fx-activity').length, 1, 'only the calm planet: the crit room breathes already');
    assert.equal(lit('fx-activity-ring').length, 1);
    const glow = lit('fx-activity')[0], r = lit('fx-activity-ring')[0];
    assert.deepEqual(glow.position.toArray(), builder.mesh.position.toArray());
    assert.deepEqual(r.position.toArray(), builder.mesh.position.toArray());
    assert.ok(r.scale.x > builder.size * 2 * 2, 'the ring stands clear of its sphere');
    assert.ok(glow.material.opacity <= activityLook(1).glow + 1e-9);
    assert.ok(r.material.opacity >= ACTIVITY.ringOpacity * ACTIVITY.ringFloor - 1e-9, 'never off while at work');
    ring.push(r.material.opacity);
    // No hue: the light is the sun's grey.
    assert.equal(glow.material.color.getHexString(), r.material.color.getHexString());
  }
  assert.ok(Math.max(...ring) > Math.min(...ring) * 1.5, 'the ring breathes');
  // Work stops: the light fades, the size steps back, it recedes with the rest.
  galaxy.setActivity(workingPlanets(workModel(), galaxy.planets()));
  at(1000 + ACTIVITY.fadeMs * 3 + ACTIVITY.periodMs);
  assert.equal(lit('fx-activity').length, 0);
  assert.equal(builder.lift, 1);
  assert.equal(builder.mesh.material, db.mesh.material);
});

test('with fx=activity seen from far the glow and ring keep a floor on screen, so they read from 3 m', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['activity']) });
  const m = busyModel();
  galaxy.update(m);
  galaxy.setActivity(workingPlanets(m, galaxy.planets()));
  const builder = memberOf(galaxy, 'hv1', 'builder:a');
  galaxy.camera.position.set(0, 30_000, 30_000);
  galaxy.camera.lookAt(0, 0, 0);
  at(1000 + ACTIVITY.fadeMs * 2);
  const tall = 2 * Math.tan((galaxy.camera.fov * Math.PI) / 360) * galaxy.camera.position.distanceTo(builder.mesh.position);
  const glow = spritesNamed(galaxy, 'fx-activity').find((s) => s.visible);
  const ring = spritesNamed(galaxy, 'fx-activity-ring').find((s) => s.visible);
  assert.ok(glow.scale.x / 2 / tall >= ACTIVITY.minGlow - 1e-9, 'the glow');
  assert.ok((ring.scale.x * 0.85) / 2 / tall >= ACTIVITY.minRing - 1e-9, 'the ring');
  assert.ok(ACTIVITY.minRing * 2 < ACTIVITY.minGlow * 1.5, 'the ring stays inside its glow');
});


test('with fx=activity a landed job flashes its target once; a failed one stops short, no flash', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['activity']) });
  const links = [{ from: 'db', to: 'storage', kind: 'flow' }, { from: 'api', to: 'nas', kind: 'flow' }];
  const m = model({
    links,
    events: [
      { at: 99_000, node: 'db', kind: 'ok', text: 'db dumps → storage', link: 'db>storage' },
      { at: 99_200, node: 'api', kind: 'failed', text: 'api push → nas failed', link: 'api>nas' },
    ],
  });
  galaxy.update(m);
  assert.equal(spritesNamed(galaxy, 'fx-land').length, ACTIVITY.jobs);
  galaxy.setJobs(flowJobs(m, galaxy.drawn()));
  const lit = (name) => spritesNamed(galaxy, name).filter((s) => s.visible);
  const storage = memberOf(galaxy, 'hv2', 'storage').mesh.position, nas = memberOf(galaxy, 'remote', 'nas').mesh.position;
  const api = memberOf(galaxy, 'hv1', 'api').mesh.position;
  const flat = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  at(1000 + ACTIVITY.flashMs * 0.3);
  assert.equal(lit('fx-land').length, 1, 'one flash: the landed job');
  assert.deepEqual(lit('fx-land')[0].position.toArray(), storage.toArray());
  assert.equal(lit('fx-miss').length, 1);
  at(1000 + ACTIVITY.missMs * 0.6);
  const grain = lit('fx-miss')[0].position;
  const whole = flat(api, nas);
  assert.ok(Math.abs(flat(api, grain) - ACTIVITY.reach * whole) < whole * 0.02, 'stopped short of nas');
  assert.ok(flat(grain, nas) > whole / 2);
  at(1000 + ACTIVITY.missMs + 10);
  assert.equal(lit('fx-land').length + lit('fx-miss').length, 0);
  // The next model repeats both events: neither plays again; nothing flashes nas, ever.
  galaxy.setJobs(flowJobs(m, galaxy.drawn()));
  for (let t = 1000 + ACTIVITY.missMs + 20; t < 1000 + ACTIVITY.missMs * 3; t += 100) {
    at(t);
    assert.equal(lit('fx-land').length, 0);
  }
  assert.equal(galaxy.jobs.length, 0);
});

test('with fx=activity under reduced motion the ring is steady and a job holds its end state', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['activity']), still: true });
  const m = busyModel();
  m.links.push({ from: 'db', to: 'storage', kind: 'flow' });
  m.events.push({ at: 99_000, node: 'db', kind: 'ok', link: 'db>storage' });
  galaxy.update(m);
  galaxy.setActivity(workingPlanets(m, galaxy.planets()));
  galaxy.setJobs(flowJobs(m, galaxy.drawn()));
  const lit = () => ACT_POOLS.flatMap((n) => spritesNamed(galaxy, n)).filter((s) => s.visible).map((s) => [s.name, s.scale.x, s.material.opacity]);
  at(1000 + 100);
  const a = lit();
  assert.deepEqual(a.map(([n]) => n).sort(), ['fx-activity', 'fx-activity-ring', 'fx-land']);
  at(1000 + 700);
  assert.deepEqual(lit(), a, 'nothing moves');
  assert.equal(memberOf(galaxy, 'hv1', 'builder:a').lift, activityLook(1).grow, 'the size step at once');
});

// --- fx=beacon --------------------------------------------------------------------

const MIN = 60_000, HOUR = 60 * MIN;

test('beaconHeight and beaconWidth: both grow with the crit\'s age, by log, capped; none for calm, warn or no age', () => {
  const ages = [0, 5000, MIN, 10 * MIN, HOUR, 6 * HOUR, 24 * HOUR];
  for (const size of [beaconHeight, beaconWidth]) {
    const hs = ages.map((a) => size(a));
    for (let i = 1; i < hs.length; i++) assert.ok(hs[i] > hs[i - 1], `${size.name}: ${ages[i]} ms is more than ${ages[i - 1]} ms`);
    assert.equal(size(30 * 24 * HOUR), size(24 * HOUR), 'capped');
    assert.equal(size(HOUR, 'calm'), 0);
    assert.equal(size(HOUR, 'warn'), 0);
    assert.equal(size(HOUR, 'low'), 0);
    assert.equal(size(NaN), 0);
    assert.equal(size(-5), size(0), 'a clock a hair ahead is just begun');
  }
  // A crit that just began already stands a quarter of the frame (shows at once from 3 m).
  assert.equal(beaconHeight(0), BEACON.floor);
  assert.ok(BEACON.floor >= 0.22 && BEACON.floor <= 0.28);
  assert.equal(beaconHeight(24 * HOUR), BEACON.top);
  assert.equal(beaconWidth(0), BEACON.wide[0]);
  assert.equal(beaconWidth(24 * HOUR), BEACON.wide[1]);
  // Log: the first hour takes more of the growth than the next 23.
  assert.ok(beaconHeight(HOUR) - beaconHeight(0) > beaconHeight(24 * HOUR) - beaconHeight(HOUR));
  // Two crits ten minutes and a day old are visibly different (not twins): taller and wider.
  assert.ok(beaconHeight(24 * HOUR) - beaconHeight(10 * MIN) > 0.08);
  assert.ok(beaconWidth(24 * HOUR) / beaconWidth(10 * MIN) > 1.5);
});

test('beaconScale: a height lands its share of the frame above its base on screen, never past the room', () => {
  const shot = { pos: { x: 0, y: 6000, z: 4800 }, look: { x: 0, y: 0, z: 0 } };
  for (const base of [{ x: 0, y: 0, z: 0 }, { x: -1800, y: 40, z: 900 }, { x: 1500, y: -30, z: -400 }]) {
    const sc = beaconScale(shot, base, FOV);
    const span = (h) => (ndcOf(shot, { ...base, y: base.y + h }, FOV, 16 / 9).y - ndcOf(shot, base, FOV, 16 / 9).y) / 2;
    assert.ok(Math.abs(span(sc.rise(BEACON.floor)) - BEACON.floor) < 1e-9, 'a quarter of the frame');
    assert.ok(Math.abs(span(sc.rise(0.1)) - 0.1) < 1e-9);
    assert.equal(sc.rise(0), 0);
    assert.ok(sc.rise(0.4) > sc.rise(0.2));
    // Its width is its share of the frame's height at its depth.
    const z = Math.hypot(base.x - shot.pos.x, base.y - shot.pos.y, base.z - shot.pos.z);
    assert.ok(sc.across(0.02) > 0 && sc.across(0.02) < 0.02 * 2 * z * Math.tan((FOV * Math.PI) / 360) * 1.001);
  }
  // Near the frame's top the tip stops at the room; a base above it gets nothing.
  const high = { x: 0, y: 0, z: -3000 }; // ndc y 0.64: a quarter of the frame would pass the room
  const sc = beaconScale(shot, high, FOV);
  const tip = ndcOf(shot, { ...high, y: sc.rise(0.9) }, FOV, 16 / 9).y;
  assert.ok(Math.abs(tip - BEACON.room) < 1e-9, `stops at the room: ${tip}`);
  assert.equal(beaconScale(shot, high, FOV, sc.ndc0 - 0.01).rise(0.3), 0);
  assert.equal(beaconScale(shot, { x: 0, y: 9000, z: 9000 }, FOV), null, 'behind the camera');
});

test('beaconNear: full until it looks much wider than at the overview, then eased out', () => {
  assert.equal(beaconNear(1), 1);
  assert.equal(beaconNear(BEACON.near[0]), 1);
  assert.equal(beaconNear(BEACON.near[1]), 0);
  assert.equal(beaconNear(50), 0);
  assert.equal(beaconNear(NaN), 1);
  for (let r = 1; r < 4; r += 0.1) assert.ok(beaconNear(r + 0.1) <= beaconNear(r));
});

test('beamProfile: full at the foot, gone at the tip over its top fifth, smooth; the core is brightest at the foot', () => {
  assert.equal(beamProfile(0), 1);
  assert.equal(beamProfile(1), 0, 'no flat end at the tip');
  assert.ok(BEACON.fade >= 0.2);
  assert.ok(beamProfile(1 - BEACON.fade) > 0.5, 'the body is still strong where the fade begins');
  for (let v = 0.01; v <= 1; v += 0.01) assert.ok(beamProfile(v) <= beamProfile(v - 0.01) + 1e-12, `falls: ${v}`);
  // No step where the fade begins.
  const e = 1 - BEACON.fade;
  assert.ok(Math.abs(beamProfile(e - 1e-6) - beamProfile(e + 1e-6)) < 1e-4);
  assert.ok(beamProfile(0.99) < 0.01);
  assert.equal(coreProfile(0), 1);
  assert.equal(coreProfile(1), 0);
  for (let v = 0.01; v <= 1; v += 0.01) assert.ok(coreProfile(v) <= coreProfile(v - 0.01) + 1e-12);
});

/** `model()` with storage (hv2) and nas (remote) in crit, each with the events that began it. */
function critModel({ now = 10 * HOUR, events = null } = {}) {
  const m = model({ generatedAt: now });
  for (const n of m.nodes) if (n.id === 'storage' || n.id === 'nas') n.status = 'crit';
  m.events = events ?? [
    { at: now - 3 * HOUR, node: 'storage', kind: 'crit', text: 'storage is failing' },
    { at: now - 2 * HOUR, node: 'storage', kind: 'ok', text: 'storage is back' },
    { at: now - HOUR, node: 'storage', kind: 'crit', text: 'storage is failing again' },
    { at: now - 5 * MIN, node: 'nas', kind: 'crit', text: 'nas is down' },
    { at: now - 4 * HOUR, node: 'db', kind: 'crit', text: 'db was down (it is fine now)' },
  ];
  return m;
}

test('critAges: per crit site, from the newest crit event on each node still in crit, the oldest wins', () => {
  const ages = critAges(critModel(), SITES);
  assert.deepEqual([...ages].sort(), [['hv2', HOUR], ['remote', 5 * MIN]], 'storage\'s spell began an hour ago; db is calm');
  // Two crit rooms in one site: the site has been in crit since the older one.
  const m = critModel();
  m.nodes.find((n) => n.id === 'api').status = 'crit';
  m.nodes.find((n) => n.id === 'db').status = 'crit';
  assert.equal(critAges(m, SITES).get('hv1'), 4 * HOUR);
  // A site not drawn, a crit with no event: nothing (the page dates it itself).
  assert.deepEqual([...critAges(critModel(), ['hv1', 'hv2']).keys()], ['hv2']);
  assert.equal(critAges(critModel({ events: [] }), SITES).size, 0);
  assert.equal(critAges({}, SITES).size, 0);
});

test('beaconAt: rises eased from the plane, sinks when the crit clears, at once when still', () => {
  const b = { from: 0, crit: true, t0: 1000, k0: 0 };
  assert.equal(beaconAt(b, 1000).rise, 0);
  const mid = beaconAt(b, 1000 + BEACON.riseMs / 2).rise;
  assert.ok(mid > 0.4 && mid < 0.6);
  assert.equal(beaconAt(b, 1000 + BEACON.riseMs).rise, 1);
  assert.equal(beaconAt(b, 1000 + 5 * BEACON.riseMs).rise, 1);
  assert.equal(beaconAt(b, 1000, BEACON, true).rise, 1, 'still: stands at once');
  assert.equal(beaconAt(b, HOUR).height, beaconHeight(HOUR), 'its height is its age');
  assert.equal(beaconAt(b, HOUR).width, beaconWidth(HOUR), 'and so is its width');
  const gone = { ...b, crit: false, t0: 5000, k0: 1 };
  assert.equal(beaconAt(gone, 5000).rise, 1);
  assert.equal(beaconAt(gone, 5000 + BEACON.riseMs).rise, 0);
});

/** The scene's beacon pillars and their tips. */
function beaconParts(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return {
    pillars: root.children.filter((o) => o.isMesh && o.name === 'fx-beacon'),
    cores: root.children.filter((o) => o.isMesh && o.name === 'fx-beacon-core'),
    tips: root.children.filter((o) => o.isSprite && o.name === 'fx-beacon-tip'),
  };
}

/** How much of the frame's height `p` (a pillar) spans seen from the overview, and its foot's ndc y. */
function overviewSpan(galaxy, p) {
  const shot = overviewShot(galaxy.world.sites);
  const foot = ndcOf(shot, p.position, FOV, 16 / 9).y;
  const top = ndcOf(shot, { x: p.position.x, y: p.position.y + p.scale.y, z: p.position.z }, FOV, 16 / 9).y;
  return { span: (top - foot) / 2, foot, top };
}

/** Puts the scene's camera at the overview (the tests' scene never moves it itself). */
function toOverview(galaxy) {
  const { pos, look } = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(pos.x, pos.y, pos.z);
  galaxy.camera.lookAt(look.x, look.y, look.z);
}

/** The share of the frame a beacon `share` tall should span from `foot` (the room caps it). */
const wantSpan = (share, foot) => Math.min(share, (BEACON.room - foot) / 2);

test('without fx=beacon the scene makes no pillar and ignores crit ages', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['warp']) });
  const m = critModel();
  galaxy.update(m);
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000 + BEACON.riseMs * 2);
  assert.equal(beaconParts(galaxy).pillars.length, 0);
  assert.equal(galaxy.beacons.size, 0);
});

test('with fx=beacon each crit cluster stands a pillar as tall as its crit is old; calm gets none; it sinks when cleared', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']) });
  const m = critModel();
  galaxy.update(m);
  toOverview(galaxy);
  const { pillars, tips } = beaconParts(galaxy);
  assert.equal(pillars.length, BEACON.max, 'one pool, made once');
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000 + BEACON.riseMs * 2);
  const shown = () => pillars.filter((p) => p.visible);
  assert.equal(shown().length, 2, 'hv2 and remote, not hv1');
  const on = (id) => {
    const h = galaxy.world.byId.get(id).home;
    return shown().find((p) => p.position.x === h.x && p.position.z === h.z);
  };
  assert.ok(on('hv2') && on('remote') && !on('hv1'));
  const hv2 = on('hv2').scale.y;
  // Sized in the overview's screen: as tall as its age says, in shares of the frame.
  const sHv2 = overviewSpan(galaxy, on('hv2')), sRemote = overviewSpan(galaxy, on('remote'));
  assert.ok(Math.abs(sHv2.span - wantSpan(beaconHeight(HOUR), sHv2.foot)) < 1e-3, `an hour of crit: ${sHv2.span}`);
  assert.ok(Math.abs(sRemote.span - wantSpan(beaconHeight(5 * MIN), sRemote.foot)) < 1e-3, `five minutes: ${sRemote.span}`);
  assert.ok(sRemote.span >= Math.min(BEACON.floor, (BEACON.room - sRemote.foot) / 2) - 1e-3, 'a young crit already stands the floor');
  assert.ok(sHv2.top <= BEACON.room + 1e-9 && sRemote.top <= BEACON.room + 1e-9, 'short of the frame\'s top');
  assert.ok(on('hv2').scale.x > on('remote').scale.x, 'the older crit is wider');
  // Each tip sits on its pillar's top; each pillar has its white core, as tall, narrower.
  const { cores } = beaconParts(galaxy);
  for (const p of shown()) {
    const tip = tips.find((t) => t.visible && t.position.x === p.position.x && t.position.z === p.position.z);
    assert.ok(Math.abs(tip.position.y - (p.position.y + p.scale.y)) < 1e-6);
    assert.ok(p.material.opacity <= BEACON.opacity + 1e-9);
    const core = cores.find((c) => c.visible && c.position.x === p.position.x && c.position.z === p.position.z);
    assert.ok(core, 'a core in every pillar');
    assert.equal(core.scale.y, p.scale.y);
    assert.ok(Math.abs(core.scale.x - p.scale.x * BEACON.core) < 1e-9);
    assert.ok(core.material.opacity > p.material.opacity * 0.9, 'the core is the brightest part');
    // White-hot: the text's white (--text-1), no hue, so it carries in greyscale and without red.
    const { r, g, b } = core.material.color;
    assert.ok(Math.min(r, g, b) > 0.8 && Math.max(r, g, b) - Math.min(r, g, b) < 0.05, `white core: ${r} ${g} ${b}`);
    assert.ok(p.material.color.r > p.material.color.g * 2, 'the sheath is the crit hue');
  }
  // A camera close by (held in a system next to it): the pillar sized for the
  // overview fades rather than stand as a red wall across the shot.
  const far = on('remote').material.opacity;
  const rh = galaxy.world.byId.get('remote').home;
  galaxy.camera.position.set(rh.x + 300, rh.y + 400, rh.z + 300);
  galaxy.camera.lookAt(rh.x, rh.y, rh.z);
  at(1000 + BEACON.riseMs * 2 + 8);
  assert.ok(far > 0.3, `at the overview it stands: ${far}`);
  assert.ok(!on('remote'), 'close by it is gone');
  toOverview(galaxy);
  at(1000 + BEACON.riseMs * 2 + 12);
  assert.ok(on('remote'), 'back at the overview it stands again');
  // A crit that begins while the page looks rises from the plane, not at once
  // (those already there on the first frame stand: they did not just begin).
  const fresh = sceneAt({ fx: new Set(['beacon']) });
  fresh.galaxy.update(model());
  toOverview(fresh.galaxy);
  fresh.at(1000);
  assert.equal(beaconParts(fresh.galaxy).pillars.filter((p) => p.visible).length, 0, 'calm: none');
  fresh.galaxy.update(m);
  fresh.at(1016);
  fresh.at(1016 + BEACON.riseMs * 0.25);
  const rising = beaconParts(fresh.galaxy).pillars.filter((p) => p.visible);
  assert.ok(rising.length === 2 && rising.every((p) => overviewSpan(fresh.galaxy, p).span < BEACON.floor * 0.9), 'still rising');
  // The site opens: the pillar dims, its system is the loud thing.
  const open0 = on('hv2').material.opacity;
  galaxy.setOpen('hv2', 1);
  at(1000 + BEACON.riseMs * 2 + 16);
  assert.ok(on('hv2').material.opacity < open0 * 0.5);
  // hv2 clears: its pillar sinks and goes; remote's stays.
  const calm = critModel();
  calm.nodes.find((n) => n.id === 'storage').status = 'ok';
  galaxy.update(calm);
  galaxy.setCritAges(critAges(calm, galaxy.world.byId.keys()));
  const t1 = 1000 + BEACON.riseMs * 3;
  at(t1);
  at(t1 + BEACON.riseMs / 2);
  assert.ok(on('hv2').scale.y < hv2 * 0.6, 'sinking');
  at(t1 + BEACON.riseMs + 16);
  assert.equal(shown().length, 1);
  assert.ok(on('remote') && !on('hv2'));
  assert.deepEqual([...galaxy.beacons.keys()], ['remote']);
});

test('with fx=beacon a crit with no event is dated from when the page first saw it, and grows', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']), still: true });
  const m = critModel({ events: [] });
  galaxy.update(m);
  toOverview(galaxy);
  galaxy.setCritAges(critAges(m, galaxy.world.byId.keys()));
  at(1000);
  const hv2 = () => {
    const h = galaxy.world.byId.get('hv2').home;
    return beaconParts(galaxy).pillars.find((p) => p.visible && p.position.x === h.x && p.position.z === h.z);
  };
  const s0 = overviewSpan(galaxy, hv2());
  assert.ok(Math.abs(s0.span - wantSpan(BEACON.floor, s0.foot)) < 1e-3, `still: stands at once, just begun: ${s0.span}`);
  const w0 = hv2().scale.x;
  at(1000 + HOUR);
  const s1 = overviewSpan(galaxy, hv2());
  assert.ok(Math.abs(s1.span - wantSpan(beaconHeight(HOUR), s1.foot)) < 1e-3, 'an hour later, an hour tall');
  assert.ok(hv2().scale.x > w0, 'and wider');
});

// --- fx=warp (night 3 T12, T28) -------------------------------------------------------

test('warpAt: zero outside a flight, in still mode and from 0.9 on; length follows the camera\'s speed; the head is the tone\'s', () => {
  const zero = { k: 0, len: 0, head: 'calm', thin: 0 };
  for (const k of [null, undefined, NaN, -0.2, 0, 1, 1.4]) assert.deepEqual(warpAt(k, 'crit'), zero, `not a flight: ${k}`);
  for (const k of [0.1, 0.5, 0.85]) assert.deepEqual(warpAt(k, 'crit', true), zero, 'still: no warp');
  // T28: at rest before the plate types (T15 types it at arrival, after 0.9 of the flight).
  for (let k = 0.9; k < 1; k += 0.005) assert.deepEqual(warpAt(k, 'crit'), zero, `at rest by 0.9: ${k}`);
  const mid = warpAt(0.5, 'warn');
  assert.equal(mid.k, 1);
  assert.equal(mid.len, WARP.len);
  assert.equal(mid.head, 'warn');
  assert.equal(mid.thin, WARP.thin);
  assert.equal(warpAt(0.5, 'crit').head, 'crit');
  // T15: a flight to a calm site (or the overview, whose tone is calm) draws nothing.
  for (const t of ['calm', 'low', 'bogus', undefined]) {
    for (const k of [0.1, 0.5, 0.85]) assert.deepEqual(warpAt(k, t), zero, `quiet toward ${t} at ${k}`);
  }
  // Tied to the camera's speed (the cubic ease's slope): longer where it flies faster, before the cut.
  const slope = (k) => (ease(k + 1e-4) - ease(k - 1e-4)) / 2e-4;
  for (const [x, y] of [[0.1, 0.3], [0.2, 0.45], [0.75, 0.6], [0.7, 0.55]]) {
    assert.ok(slope(x) < slope(y) && warpAt(x, 'crit').len < warpAt(y, 'crit').len, `${x} slower and shorter than ${y}`);
  }
  for (const k of [0.1, 0.25, 0.4, 0.6, 0.75]) {
    assert.ok(Math.abs(warpAt(k, 'crit').k - Math.sqrt(slope(k) / slope(0.5))) < 1e-3, `speed share at ${k}`);
  }
  assert.ok(warpAt(0.02, 'crit').len < 0.05 * WARP.len, 'barely there as it leaves');
  // Every number scales with the stretch.
  const q = warpAt(0.15, 'crit');
  assert.ok(q.k > 0 && q.k < 1);
  assert.ok(Math.abs(q.len - WARP.len * q.k) < 1e-12 && Math.abs(q.thin - WARP.thin * q.k) < 1e-12);
  assert.ok(WARP.head > 0.1 && WARP.head <= 0.2, 'only the leading tip takes the hue (T21)');
});

test('warpTail: a streak runs from its grain toward the target\'s point on screen, never past it', () => {
  // Project view space to the screen (the camera looks down -z).
  const scr = (p) => ({ x: p.x / -p.z, y: p.y / -p.z });
  const aim = { x: 30, y: -12, z: -900 };
  const vp = scr(aim);
  const grains = [{ x: -200, y: 140, z: -600 }, { x: 500, y: 20, z: -2400 }, { x: 10, y: -300, z: -120 }, { x: -40, y: -40, z: -5000 }];
  for (const p of grains) {
    const t = warpTail(p, aim, WARP.len);
    const a = scr(p), b = scr(t);
    const toVp = { x: vp.x - a.x, y: vp.y - a.y }, along = { x: b.x - a.x, y: b.y - a.y };
    const cross = toVp.x * along.y - toVp.y * along.x;
    const dot = toVp.x * along.x + toVp.y * along.y;
    assert.ok(Math.abs(cross) < 1e-9 * Math.hypot(toVp.x, toVp.y) + 1e-12, `on the line to the vanishing point: ${JSON.stringify(p)}`);
    assert.ok(dot > 0, 'toward it, not away');
    assert.ok(Math.hypot(along.x, along.y) <= Math.hypot(toVp.x, toVp.y) + 1e-12, 'never past it');
    assert.equal(t.z, p.z, 'same depth');
    const angle = Math.hypot(t.x - p.x, t.y - p.y) / Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(angle - WARP.len) < 1e-9 || angle < WARP.len, 'the same angle for near and far, or shorter by the target');
  }
  // A grain by the vanishing point barely streaks; one behind, or a target behind, has no aim.
  const near = { x: aim.x * (500 / 900) + 0.5, y: aim.y * (500 / 900), z: -500 };
  assert.ok(Math.hypot(warpTail(near, aim, WARP.len).x - near.x, warpTail(near, aim, WARP.len).y - near.y) <= 0.5 + 1e-9);
  assert.equal(warpTail({ x: 0, y: 0, z: 100 }, aim, WARP.len), null);
  assert.equal(warpTail(grains[0], { x: 0, y: 0, z: 50 }, WARP.len), null);
});

/** Two linear colours within a rounding step. */
const colourNear = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** The scene's warp streaks (both line sets, wherever they hang). */
function warpLines(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  const out = [];
  root.traverse((o) => { if (o.isLineSegments && o.name.startsWith('fx-warp')) out.push(o); });
  return out;
}

/** A frame with the camera `step` further along x (so the scene sees it travel). */
const flyStep = (galaxy, at, ms, step = 40) => {
  galaxy.camera.position.x += step;
  at(ms);
};

test('without fx=warp the scene makes no streaks and ignores a flight', () => {
  const { galaxy, at } = sceneAt();
  galaxy.update(critModel());
  toOverview(galaxy);
  galaxy.setWarp({ k: 0.5, to: 'hv2' });
  flyStep(galaxy, at, 1016);
  flyStep(galaxy, at, 1032);
  assert.equal(warpLines(galaxy).length, 0);
  assert.equal(galaxy.warp.len, 0);
  assert.deepEqual(galaxy.warp.parts, []);
});

test('with fx=warp a flight streaks the sky out of the destination, its head in the destination\'s hue; at rest nothing', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['warp']) });
  galaxy.update(critModel());
  toOverview(galaxy);
  const lines = warpLines(galaxy);
  assert.equal(lines.length, 2, 'far stars and dust, made once');
  assert.ok(lines.some((l) => l.name === 'fx-warp-dust' && l.parent?.name === 'dust'), 'the dust\'s turn with it');
  const dust = lines.find((l) => l.name === 'fx-warp-dust').parent;
  at(1000);
  assert.ok(lines.every((l) => !l.visible), 'at rest: hidden');
  assert.equal(dust.material.opacity, 0.7);

  // Flying to hv2 (crit): streaks, a red lean, the dust thinner, the travel's way.
  galaxy.setWarp({ k: 0.5, to: 'hv2' });
  flyStep(galaxy, at, 1016);
  flyStep(galaxy, at, 1032);
  assert.ok(lines.every((l) => l.visible));
  assert.equal(galaxy.warp.tone, 'crit');
  assert.equal(galaxy.warp.len, WARP.len);
  assert.equal(galaxy.warp.head, 'crit');
  assert.ok(Math.abs(dust.material.opacity - 0.7 * (1 - WARP.thin)) < 1e-9, 'the dust thins');
  assert.ok(galaxy.warp.dir.x > 0.999, `the travel, kept for a flight with no aim: ${JSON.stringify(galaxy.warp.dir)}`);
  const hv2 = galaxy.world.byId.get('hv2').home;
  assert.deepEqual(galaxy.warp.aim.toArray(), [hv2.x, hv2.y, hv2.z], 'streams from the destination\'s star');
  const u = lines[0].material.uniforms;
  assert.equal(u.warpAimOn.value, 1);
  // The head at the crit token's full value (the scene's colour from the palette), the body grey.
  const want = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).toArray();
  const pal = paletteFrom();
  assert.ok(colourNear(u.warpHead.value.toArray(), want(pal.crit)), `head = crit: ${u.warpHead.value.toArray()}`);
  assert.ok(colourNear(u.warpBody.value.toArray(), want(pal.sun)), 'body white (text-1, T21)');
  assert.ok(Math.abs(u.warpHeadFrom.value - (1 - WARP.head)) < 1e-12, 'the tip nearest the target');
  const stars = lines.find((l) => l.name === 'fx-warp-stars').material.uniforms.warpLen.value;
  const grains = lines.find((l) => l.name === 'fx-warp-dust').material.uniforms.warpLen.value;
  assert.ok(stars < grains, 'the far stars streak shorter than the dust');

  // To a calm site: quiet, no streaks (T15), the dust as it was.
  galaxy.setWarp({ k: 0.5, to: 'hv1' });
  flyStep(galaxy, at, 1048);
  assert.equal(galaxy.warp.tone, 'calm');
  assert.equal(galaxy.warp.len, 0);
  assert.ok(lines.every((l) => !l.visible), 'calm: nothing drawn');
  assert.equal(dust.material.opacity, 0.7);

  // A warn destination: the head at the warn token.
  const warned = critModel();
  warned.nodes.find((n) => n.id === 'db').status = 'warn';
  galaxy.update(warned);
  galaxy.setWarp({ k: 0.5, to: 'hv1' });
  flyStep(galaxy, at, 1056);
  assert.equal(galaxy.warp.tone, 'warn');
  assert.ok(colourNear(u.warpHead.value.toArray(), want(pal.warn)), 'head = warn');

  // To the overview: no aim, and quiet like a calm site (T15).
  galaxy.setWarp({ k: 0.5, to: null });
  flyStep(galaxy, at, 1060);
  assert.equal(galaxy.warp.aim, null);
  assert.equal(u.warpAimOn.value, 0);
  assert.equal(galaxy.warp.len, 0);
  assert.ok(lines.every((l) => !l.visible), 'the overview: nothing drawn');

  // Landed: snapped back, the dust as it was.
  galaxy.setWarp(null);
  flyStep(galaxy, at, 1064);
  assert.ok(lines.every((l) => !l.visible));
  assert.equal(galaxy.warp.len, 0);
  assert.equal(dust.material.opacity, 0.7);
});

// --- fx=warp says where, not everything (night 4 T21, r4-film-ui fx-warp 1) ----------------

test('warpCone: whole inside the cone round the way, gone outside its 30 degrees, smooth at the rim', () => {
  const axis = { x: 0, y: 0, z: -1 };
  const at = (deg, d = 100) => ({ x: d * Math.sin((deg * Math.PI) / 180), y: 0, z: -d * Math.cos((deg * Math.PI) / 180) });
  assert.equal(WARP.cone, 15, 'a 30 degree cone: 15 either side');
  for (const deg of [0, 5, WARP.cone - WARP.coneEdge - 0.01]) assert.equal(warpCone(at(deg), axis), 1, `inside at ${deg}`);
  for (const deg of [WARP.cone, 20, 45, 90, 170]) assert.ok(warpCone(at(deg), axis) < 1e-9, `outside at ${deg}`);
  const rim = warpCone(at(WARP.cone - WARP.coneEdge / 2), axis);
  assert.ok(rim > 0 && rim < 1, `the rim fades: ${rim}`);
  let last = 1;
  for (let deg = 0; deg <= 20; deg += 0.5) {
    const k = warpCone(at(deg), axis);
    assert.ok(k <= last + 1e-12, `never brighter further out: ${deg}`);
    last = k;
  }
  // The axis can be any length and any way; distance does not matter.
  assert.equal(warpCone(at(5, 9000), { x: 0, y: 0, z: -40 }), 1);
  assert.equal(warpCone({ x: 0, y: 0, z: 50 }, axis), 0, 'behind the camera: nothing');
  assert.equal(warpCone({ x: 0, y: 0, z: 0 }, axis), 0);
  assert.equal(warpCone({ x: 1, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }), 0, 'no way to go: nothing');
});

test('warpCovered: a point on a crit disc is covered, off it or on a zero disc is not', () => {
  const discs = [{ x: 100, y: 100, r: 40 }, { x: 500, y: 300, r: 0 }];
  assert.equal(warpCovered(100, 100, discs), true);
  assert.equal(warpCovered(130, 120, discs), true);
  assert.equal(warpCovered(141, 100, discs), false);
  assert.equal(warpCovered(500, 300, discs), false, 'a zero disc covers nothing');
  assert.equal(warpCovered(100, 100, []), false);
  assert.equal(warpCovered(100, 100), false);
});

test('fx=warp streaks half the grains it did, and the cone leaves at most a quarter of what used to streak on screen', () => {
  assert.equal(WARP.share, 0.5);
  assert.equal(WARP_STARS, 800 * WARP.share, "half of night 3's 800 far stars");
  assert.equal(WARP_DUST, 1500 * WARP.share, "half of its 1500 grains");
  const { galaxy, at } = sceneAt({ fx: new Set(['warp']) });
  galaxy.update(critModel());
  const lines = warpLines(galaxy);
  const n = (name) => lines.find((l) => l.name === name).geometry.attributes.position.count / 2;
  assert.equal(n('fx-warp-stars'), WARP_STARS);
  assert.equal(n('fx-warp-dust'), WARP_DUST);

  // Half-way down a flight from the overview to hv2: where the camera is, looking at it.
  const { pos } = overviewShot(galaxy.world.sites);
  const hv2 = galaxy.world.byId.get('hv2').home;
  const mid = new THREE.Vector3(pos.x, pos.y, pos.z).lerp(new THREE.Vector3(hv2.x, hv2.y, hv2.z), 0.5);
  galaxy.camera.position.copy(mid);
  galaxy.camera.lookAt(hv2.x, hv2.y, hv2.z);
  galaxy.camera.updateMatrixWorld();
  at(1016);
  const view = (v, obj) => v.applyMatrix4(obj.matrixWorld).applyMatrix4(galaxy.camera.matrixWorldInverse);
  const onScreen = (v) => {
    if (!(v.z < -1)) return false;
    const c = v.clone().applyMatrix4(galaxy.camera.projectionMatrix);
    return Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1;
  };
  const aim = view(new THREE.Vector3(hv2.x, hv2.y, hv2.z), { matrixWorld: new THREE.Matrix4() });
  // Night 3's streaks: the first 800 far stars and 1500 grains, every one on screen streaked.
  const dust = lines.find((l) => l.name === 'fx-warp-dust').parent;
  let stars = null;
  dust.parent.traverse((o) => { if (o.isPoints && o !== dust && !stars) stars = o; });
  const count = (obj, first, keep) => {
    const a = obj.geometry.attributes.position.array, step = obj.isLineSegments ? 6 : 3;
    let k = 0;
    for (let i = 0; i < first; i++) {
      const v = view(new THREE.Vector3(a[i * step], a[i * step + 1], a[i * step + 2]), obj);
      if (onScreen(v)) k += keep(v);
    }
    return k;
  };
  const before = count(stars, 800, () => 1) + count(dust, 1500, () => 1);
  const now = count(lines.find((l) => l.name === 'fx-warp-stars'), WARP_STARS, (v) => warpCone(v, aim))
    + count(lines.find((l) => l.name === 'fx-warp-dust'), WARP_DUST, (v) => warpCone(v, aim));
  assert.ok(before > 200, `night 3 streaked a screenful: ${before}`);
  assert.ok(now > 40, `enough to read a vanishing point: ${now}`);
  assert.ok(now / before < 0.35, `a quarter or less: ${now} of ${before}`);
});

test('fx=warp: a crit nebula\'s disc on screen holds no streak, on a flight anywhere; an open system holds none', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['warp']) });
  const warned = critModel();
  warned.nodes.find((n) => n.id === 'db').status = 'warn';
  galaxy.update(warned);
  toOverview(galaxy);
  galaxy.setWarp({ k: 0.5, to: 'hv1' });
  flyStep(galaxy, at, 1016, 0);
  flyStep(galaxy, at, 1032, 1);
  assert.equal(galaxy.warp.tone, 'warn');
  const discs = galaxy.warp.discs;
  assert.deepEqual(discs.map((d) => d.id).sort(), ['hv2', 'remote'], 'both crits, not the warn destination');
  const disc = discs.find((d) => d.id === 'hv2');
  // Its centre on hv2's star on screen (drawing-buffer px, origin bottom left), its reach a nebula's.
  const cam = galaxy.camera;
  const hv2 = galaxy.world.byId.get('hv2').home;
  const c = new THREE.Vector3(hv2.x, hv2.y, hv2.z).project(cam);
  const [w, h] = [1600, 900].map((x) => Math.floor(x * galaxy.pixelRatio));
  assert.ok(Math.abs(disc.x - (c.x * 0.5 + 0.5) * w) < 0.5 && Math.abs(disc.y - (c.y * 0.5 + 0.5) * h) < 0.5);
  assert.ok(disc.r > 4 && disc.r < h / 2, `a nebula's size: ${disc.r}`);
  // The shaders get it: a grain that starts there is skipped, and the view's size to place it.
  const u = warpLines(galaxy)[0].material.uniforms;
  assert.equal(u.warpCrit.value.length, WARP.crits);
  discs.forEach((d, i) => assert.deepEqual(u.warpCrit.value[i].toArray(), [d.x, d.y, d.r]));
  assert.ok(u.warpCrit.value.slice(discs.length).every((v) => v.z === 0), 'the other slots cover nothing');
  assert.deepEqual(u.warpView.value.toArray(), [w, h]);
  assert.equal(warpCovered(disc.x, disc.y, discs), true);
  assert.ok(u.warpBody.value && u.warpCone.value.x < u.warpCone.value.y, 'the cone\'s rim, outer cos first');

  // Flying to the crit itself: its disc still holds none while it is folded.
  galaxy.setWarp({ k: 0.5, to: 'hv2' });
  flyStep(galaxy, at, 1048, 1);
  assert.ok(galaxy.warp.discs.some((d) => d.id === 'hv2'));
  // Open, you are inside it: no disc.
  galaxy.world.byId.get('hv2').unfold = 1;
  galaxy.setWarp({ k: 0.5, to: 'hv1' });
  flyStep(galaxy, at, 1064, 1);
  assert.deepEqual(galaxy.warp.discs.map((d) => d.id), ['remote']);
  // At rest, none.
  galaxy.setWarp(null);
  flyStep(galaxy, at, 1080, 1);
  assert.deepEqual(galaxy.warp.discs, []);
  assert.ok(u.warpCrit.value.every((v) => v.z === 0));
});

test('fx=warp in still mode: no streaks even if told of a flight', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['warp']), still: true });
  galaxy.update(critModel());
  toOverview(galaxy);
  galaxy.setWarp({ k: 0.5, to: 'hv2' });
  flyStep(galaxy, at, 1016);
  flyStep(galaxy, at, 1032);
  assert.ok(warpLines(galaxy).every((l) => !l.visible));
  assert.equal(galaxy.warp.len, 0);
});

test('fx=warp: a lower quality level draws fewer streaks, as it draws fewer stars', () => {
  const { galaxy } = sceneAt({ fx: new Set(['warp']) });
  galaxy.update(critModel());
  const counts = () => warpLines(galaxy).map((l) => l.geometry.drawRange.count);
  galaxy.setQuality(2);
  const low = counts();
  assert.ok(low.every((c) => Number.isFinite(c) && c > 0 && c % 2 === 0), JSON.stringify(low));
  galaxy.setQuality(0);
  assert.ok(counts().every((c, i) => c > low[i]));
});

test('main.js tells the scene of the camera\'s flight only under fx=warp', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(src, /if \(fx\.has\('warp'\)\) galaxy\.setWarp\(cam\.flight\(\)\);/);
});

// --- fx=afterglow (night 4 T16) -------------------------------------------------------

test('afterglow is a name, off by default', () => {
  assert.ok(FX_NAMES.includes('afterglow'));
  assert.deepEqual([...parseFx('?fx=afterglow')], ['afterglow']);
  assert.equal(parseFx('?fx=beacon,warp').has('afterglow'), false);
});

test('afterglows: a fall out of warn or crit is a clear in the spell\'s worst tone; a flap or a gone site drops it', () => {
  const T = (o) => new Map(Object.entries(o));
  let g = afterglows(null, T({ hv1: 'crit', hv2: 'warn', remote: 'calm' }), 0);
  assert.equal(g.clears.size, 0, 'nothing clears on the first model');
  g = afterglows(g, T({ hv1: 'warn', hv2: 'warn', remote: 'calm' }), 1000);
  assert.equal(g.clears.size, 0, 'crit to warn is still trouble');
  g = afterglows(g, T({ hv1: 'calm', hv2: 'low', remote: 'calm' }), 2000);
  assert.deepEqual(g.clears.get('hv1'), { id: 'hv1', tone: 'crit', at: 2000 }, 'the spell\'s worst, not its last');
  assert.deepEqual(g.clears.get('hv2'), { id: 'hv2', tone: 'warn', at: 2000 }, 'warn to low clears too');
  assert.equal(g.clears.has('remote'), false, 'calm all along: no ring');
  g = afterglows(g, T({ hv1: 'calm', hv2: 'low', remote: 'calm' }), 5000);
  assert.equal(g.clears.get('hv1').at, 2000, 'a later model keeps when it cleared');
  g = afterglows(g, T({ hv1: 'warn', hv2: 'low', remote: 'calm' }), 6000);
  assert.equal(g.clears.has('hv1'), false, 'a flap back to trouble drops the ring');
  g = afterglows(g, T({ hv1: 'warn', remote: 'calm' }), 7000);
  assert.equal(g.clears.has('hv2'), false, 'a site gone from the map drops it');
  g = afterglows(g, T({ hv1: 'calm', remote: 'calm' }), 8000);
  assert.equal(g.clears.get('hv1').tone, 'warn', 'a new spell, its own worst');
  g = afterglows(g, T({ hv1: 'calm', remote: 'calm' }), 8000 + AFTERGLOW.lifeMs);
  assert.equal(g.clears.size, 0, 'gone after its life');
  // At most max, the newest kept.
  const many = Array.from({ length: AFTERGLOW.max + 3 }, (_, i) => `s${i}`);
  let m = afterglows(null, many.map((id) => [id, 'crit']), 0);
  many.forEach((id, i) => { m = afterglows(m, many.map((x, j) => [x, j <= i ? 'calm' : 'crit']), 100 * (i + 1)); });
  assert.equal(m.clears.size, AFTERGLOW.max);
  assert.equal(m.clears.has('s0'), false);
  assert.ok(m.clears.has(many.at(-1)));
});

test('afterglowAt: a crit ring cools crit → warn → grey and goes at 30 min, its alpha falling under the warn nebula\'s', () => {
  const MINS = 60_000;
  assert.equal(AFTERGLOW.lifeMs, 30 * MINS);
  assert.deepEqual([...AFTERGLOW_STEPS], ['crit', 'warn', 'grey']);
  const c = { id: 'hv1', tone: 'crit', at: 0 };
  const hue = (ms) => { const a = afterglowAt(c, ms); return a.mix < 0.5 ? a.from : a.to; };
  assert.equal(hue(0), 'crit');
  assert.equal(hue(5 * MINS), 'crit');
  assert.equal(hue(15 * MINS), 'warn');
  assert.equal(hue(28 * MINS), 'grey');
  assert.equal(afterglowAt(c, 0).mix, 0, 'just cleared: the crit token itself');
  assert.equal(afterglowAt(c, 25 * MINS).from, 'grey', 'grey before it goes');
  // The hue never jumps: from one step to the next it blends.
  let last = afterglowAt(c, 0);
  for (let ms = 5000; ms < AFTERGLOW.lifeMs; ms += 5000) {
    const a = afterglowAt(c, ms);
    const pos = AFTERGLOW_STEPS.indexOf(a.from) + a.mix, was = AFTERGLOW_STEPS.indexOf(last.from) + last.mix;
    assert.ok(pos >= was - 1e-9 && pos - was < 0.2, `cools gently at ${ms}`);
    assert.ok(a.alpha < last.alpha || ms === 5000, `alpha falls at ${ms}`);
    assert.ok(a.alpha < NEBULA.warn.opacity, 'under the warn nebula\'s');
    last = a;
  }
  assert.ok(afterglowAt(c, AFTERGLOW.lifeMs - 1000).alpha < 0.01, 'almost nothing at the end');
  assert.equal(afterglowAt(c, AFTERGLOW.lifeMs), undefined, 'gone at 30 min');
  assert.ok(AFTERGLOW.opacity < NEBULA.warn.opacity);
  // A warn clear starts amber.
  const w = { id: 'hv2', tone: 'warn', at: 0 };
  assert.equal(afterglowAt(w, 0).from, 'warn');
  assert.equal(afterglowAt(w, 15 * MINS).from, 'grey');
  // It fades in when it begins, at once when still.
  assert.equal(afterglowAt(c, 0).k, 0);
  assert.equal(afterglowAt(c, AFTERGLOW.inMs).k, 1);
  assert.equal(afterglowAt(c, 0, AFTERGLOW, true).k, 1);
});

function afterglowRings(galaxy) {
  let root = galaxy.world.sites[0].star;
  while (root.parent) root = root.parent;
  return root.children.filter((o) => o.isMesh && o.name === 'fx-afterglow');
}

test('without fx=afterglow the scene makes no ring and remembers no clear', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']) });
  galaxy.update(critModel());
  at(1000);
  galaxy.update(model());
  at(2000);
  assert.equal(afterglowRings(galaxy).length, 0);
  assert.equal(galaxy.afterglows.size, 0);
});

test('with fx=afterglow a cleared crit leaves a red outline on the plane round its cluster, quieter than trouble', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['afterglow']) });
  galaxy.update(critModel());
  toOverview(galaxy);
  at(1000);
  const rings = afterglowRings(galaxy);
  assert.equal(rings.length, AFTERGLOW.max, 'one pool, made once');
  assert.equal(rings.filter((r) => r.visible).length, 0, 'standing trouble has no ring');
  // hv2 clears; remote stays crit.
  const calm = critModel();
  calm.nodes.find((n) => n.id === 'storage').status = 'ok';
  galaxy.update(calm);
  at(1016);
  at(1016 + AFTERGLOW.inMs);
  const shown = rings.filter((r) => r.visible);
  assert.equal(shown.length, 1);
  const [ring] = shown;
  const h = galaxy.world.byId.get('hv2').home;
  assert.deepEqual([ring.position.x, ring.position.y, ring.position.z], [h.x, h.y, h.z], 'round hv2');
  assert.ok(Math.abs(ring.rotation.x + Math.PI / 2) < 1e-9, 'flat on the plane');
  const p = ring.geometry.parameters;
  assert.ok(p.innerRadius > 0.9 && p.outerRadius === 1, `an outline, not a disc: ${p.innerRadius}`);
  const { r, g, b } = ring.material.color;
  const crit = paletteFrom().crit;
  assert.ok(Math.abs(r - new THREE.Color().setRGB(...crit, THREE.SRGBColorSpace).r) < 1e-6 && r > g * 2 && r > b, 'the crit hue');
  assert.ok(ring.material.opacity > 0.2 && ring.material.opacity < NEBULA.warn.opacity, `faint: ${ring.material.opacity}`);
  // It does not pulse: two frames a breath apart, the same strength.
  const o1 = ring.material.opacity;
  at(1016 + AFTERGLOW.inMs + 1300);
  assert.ok(Math.abs(ring.material.opacity - o1) < 0.002, 'never pulsing');
  // Twenty-two minutes on it is grey and fainter.
  at(1016 + 22 * 60_000);
  assert.ok(ring.visible && ring.material.opacity < o1 / 2);
  const c = ring.material.color;
  assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.05, 'cooled to grey');
  // hv2 flaps back to crit: the ring goes.
  galaxy.update(critModel());
  at(1016 + 22 * 60_000 + 16);
  assert.equal(rings.filter((x) => x.visible).length, 0);
  assert.equal(galaxy.afterglows.size, 0);
});

test('with fx=afterglow a clear that ages past 30 min draws nothing; still mode shows it at once', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['afterglow']), still: true });
  galaxy.update(critModel());
  toOverview(galaxy);
  at(1000);
  const calm = critModel();
  calm.nodes.find((n) => n.id === 'storage').status = 'ok';
  galaxy.update(calm);
  at(1000);
  assert.equal(afterglowRings(galaxy).filter((r) => r.visible).length, 1, 'still: there at once');
  at(1000 + AFTERGLOW.lifeMs);
  assert.equal(afterglowRings(galaxy).filter((r) => r.visible).length, 0);
});
