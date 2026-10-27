// fx=sweep (Wall plan night 4 T18, README §7 Night 3 D `sweep`): once per
// tour cycle, at the overview only, one faint line from the sun turns once
// round the plane; a cluster it crosses pings only if its site sent new data
// since the line last crossed it, so a silent site stays dark. None in still
// mode, never during a flight, never under a finger; off by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FX_NAMES, SWEEP, createSweep, crossAt, parseFx, pingAt, planeAngle, siteNews, sweepAt, sweepStep,
} from '../public/js/wall/galaxy/fx.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';
import { createGalaxyScene, overviewShot, sweepShape } from '../public/js/wall/galaxy/scene.js';

const TURN = Math.PI * 2;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function model({ cpu = 0.2, events = [] } = {}) {
  const nodes = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'remote']) nodes.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
  nodes.push(
    { id: 'db', parent: 'hv1', kind: 'room', status: 'ok', metrics: { cpu } },
    { id: 'db-svc', parent: 'db', kind: 'service', status: 'ok' },
    { id: 'storage', parent: 'hv2', kind: 'room', status: 'ok', metrics: { cpu: 0.4 } },
    { id: 'nas', parent: 'remote', kind: 'room', status: 'ok' },
  );
  return { nodes, links: [], events, generatedAt: 100_000 };
}

test('sweep is a name, off by default', () => {
  assert.equal(FX_NAMES.at(-1), 'sweep');
  assert.deepEqual([...parseFx('?fx=sweep')], ['sweep']);
  assert.equal(parseFx('').has('sweep'), false);
  assert.equal(parseFx('?fx=beacon,warp,afterglow,activity').has('sweep'), false);
});

test('siteNews: one number per site for its data; a change in one site changes only its number', () => {
  const a = siteNews(model());
  assert.deepEqual([...a.keys()].sort(), ['hv1', 'hv2', 'remote']);
  assert.deepEqual(siteNews(model()), a, 'the same data, the same numbers');
  const b = siteNews(model({ cpu: 0.21 }));
  assert.notEqual(b.get('hv1'), a.get('hv1'), 'a metric deep in hv1 (a service\'s room) changed hv1');
  assert.equal(b.get('hv2'), a.get('hv2'));
  assert.equal(b.get('remote'), a.get('remote'));
  const c = siteNews(model({ events: [{ at: 99_000, node: 'nas', kind: 'ok', text: 'backup done' }] }));
  assert.notEqual(c.get('remote'), a.get('remote'), 'an event on a node in remote is news for remote');
  assert.equal(c.get('hv1'), a.get('hv1'));
  assert.deepEqual([...siteNews(model(), ['hv2']).keys()], ['hv2'], 'only the drawn sites');
});

test('sweepAt: the line turns once at an even speed from where it starts, fades in and out, none when still', () => {
  const sw = { t0: 1000, ms: 6000, from: 0.5, stopAt: null };
  assert.equal(sweepAt(sw, 999), null, 'not yet');
  for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const at = sweepAt(sw, 1000 + p * 6000);
    assert.ok(near(at.angle, 0.5 + TURN * p), `${p} of the turn is ${p} of the way round`);
    assert.equal(at.k, 1, 'full in the middle');
  }
  assert.equal(sweepAt(sw, 1000).k, 0, 'fades in');
  assert.ok(sweepAt(sw, 1000 + 6000 * SWEEP.fadeShare / 2).k < 0.6);
  assert.ok(sweepAt(sw, 7000 - 6000 * SWEEP.fadeShare / 2).k < 0.6, 'fades out');
  assert.equal(sweepAt(sw, 7000), undefined, 'over after one turn');
  assert.equal(sweepAt(sw, 4000, SWEEP, true), undefined, 'still mode: no sweep');
  // Stopped: held where it was, gone over outMs.
  const st = { ...sw, stopAt: 4000 };
  assert.ok(near(sweepAt(st, 4000 + SWEEP.outMs / 2).angle, sweepAt(sw, 4000).angle));
  assert.ok(sweepAt(st, 4000 + SWEEP.outMs / 2).k <= 0.5 + 1e-9);
  assert.equal(sweepAt(st, 4000 + SWEEP.outMs), undefined);
  // When it reaches an angle.
  assert.equal(crossAt(sw, 0.5), 1000);
  assert.ok(near(crossAt(sw, 0.5 + Math.PI), 4000));
  assert.ok(near(crossAt(sw, 0.5 - Math.PI / 2), 1000 + 6000 * 0.75), 'behind the start: three quarters on');
});

test('planeAngle: round the sun from +x toward +z', () => {
  assert.ok(near(planeAngle({ x: 1, y: 9, z: 0 }), 0));
  assert.ok(near(planeAngle({ x: 0, z: 1 }), Math.PI / 2));
  assert.ok(near(Math.abs(planeAngle({ x: -1, z: 0 })), Math.PI));
});

test('pingAt: a ring opens once and fades, soft from the start', () => {
  assert.equal(pingAt(1000, 999), null);
  const a = pingAt(1000, 1000), b = pingAt(1000, 1000 + SWEEP.pingMs / 2);
  assert.ok(near(a.r, SWEEP.ping[0]) && a.k === 0);
  assert.ok(b.r > a.r && b.r < SWEEP.ping[1] && b.k > 0 && b.k < 1);
  assert.equal(pingAt(1000, 1000 + SWEEP.pingMs), undefined);
});

const SITES = [{ id: 'hv1', angle: 0.2 }, { id: 'hv2', angle: 2.2 }, { id: 'remote', angle: 4.4 }];
const pinged = (sw, now) => sw.frame(now).pings.map((p) => p.id).sort();

test('createSweep: the first sweep pings every site with data; later ones only the sites with news since', () => {
  const sw = createSweep();
  sw.model(siteNews(model()));
  assert.equal(sw.start(0, 6000, 0, SITES), true);
  assert.equal(sw.start(10, 6000, 0, SITES), false, 'one at a time');
  assert.deepEqual(pinged(sw, 0), [], 'nothing reached yet');
  assert.deepEqual(pinged(sw, 6000 * (0.2 / TURN) + 100), ['hv1'], 'hv1 pings as the line reaches it');
  assert.deepEqual(pinged(sw, 6000 * (2.2 / TURN) + 50), ['hv2'], 'hv1\'s ring is done, hv2\'s begins');
  const f = sw.frame(6000 * (4.4 / TURN) + 50);
  assert.deepEqual(f.pings.map((p) => p.id), ['remote']);
  assert.ok(f.line && f.line.k === 1);
  assert.equal(sw.frame(6000).line, null, 'over');
  assert.equal(sw.running(), false);
  // Only hv1 sends news before the next sweep: only hv1 pings; hv2 and remote stay dark.
  sw.model(siteNews(model({ cpu: 0.3 })));
  sw.start(20_000, 6000, 0, SITES);
  const seen = new Set();
  for (let t = 20_000; t <= 26_000 + SWEEP.pingMs; t += 50) for (const p of sw.frame(t).pings) seen.add(p.id);
  assert.deepEqual([...seen], ['hv1']);
  // Nothing new at all: a sweep with no ping.
  sw.start(40_000, 6000, 0, SITES);
  for (let t = 40_000; t <= 46_000 + SWEEP.pingMs; t += 50) assert.deepEqual(sw.frame(t).pings, []);
});

test('createSweep: stopped half-way, the sites not yet reached keep their news for the next sweep', () => {
  const sw = createSweep();
  sw.model(siteNews(model()));
  sw.start(0, 6000, 0, SITES);
  for (let t = 0; t <= 6000 + SWEEP.pingMs; t += 100) sw.frame(t);
  sw.model(siteNews(model({ cpu: 0.5, events: [{ at: 1, node: 'nas', kind: 'ok', text: 'x' }] })));
  sw.start(10_000, 6000, 0, SITES);
  sw.frame(10_000 + 6000 * (0.2 / TURN) + 10);
  sw.stop(10_500);
  const seen = new Set();
  for (let t = 10_500; t <= 12_000 + SWEEP.pingMs; t += 50) for (const p of sw.frame(t).pings) seen.add(p.id);
  assert.deepEqual([...seen], ['hv1'], 'remote was never reached');
  assert.equal(sw.running(), false, 'gone after its fade');
  sw.start(20_000, 6000, 0, SITES);
  for (let t = 20_000; t <= 26_000; t += 50) for (const p of sw.frame(t).pings) seen.add(p.id);
  assert.ok(seen.has('remote'), 'the next sweep still finds remote\'s news');
  assert.ok(!seen.has('hv2'), 'hv2 never had any');
});

test('createSweep: still mode never starts', () => {
  const sw = createSweep({ still: true });
  sw.model(siteNews(model()));
  assert.equal(sw.start(0, 6000, 0, SITES), false);
  assert.deepEqual(sw.frame(1000), { line: null, pings: [] });
});

const REST = { now: 10_000, running: false, swept: null, leg: { cycle: 3, end: 20_000 }, driver: 'tour', mode: 'tour', want: 'overview', flight: null };

test('sweepStep: once per cycle, only at rest on the tour\'s overview; never held, flying or under a finger', () => {
  const s = sweepStep(REST);
  assert.deepEqual(s, { rest: true, start: { ms: SWEEP.turnMs }, swept: 3 });
  assert.deepEqual(sweepStep({ ...REST, swept: 3 }).start, null, 'once per cycle');
  assert.deepEqual(sweepStep({ ...REST, swept: 2, leg: { cycle: 4, end: 20_000 } }).start, { ms: SWEEP.turnMs }, 'the next cycle sweeps again');
  for (const [why, over] of [
    ['a site leg', { leg: null }],
    ['held on a site', { want: 'site' }],
    ['a finger has it', { mode: 'explore' }],
    ['the wake\'s ease', { mode: 'easing' }],
    ['a show has it', { driver: 'show' }],
    ['a free pose', { want: 'free' }],
    ['a flight', { flight: { k: 0.4, to: null } }],
  ]) {
    const r = sweepStep({ ...REST, ...over });
    assert.equal(r.rest, false, why);
    assert.equal(r.start, null, why);
    assert.equal(r.swept, null, `${why}: the cycle's sweep is not spent`);
  }
  assert.equal(sweepStep({ ...REST, running: true }).start, null, 'one at a time');
  // It turns in the time the leg has left, never under minMs.
  const short = sweepStep({ ...REST, leg: { cycle: 3, end: 10_000 + 3000 } });
  assert.deepEqual(short.start, { ms: 3000 - SWEEP.marginMs });
  const none = sweepStep({ ...REST, leg: { cycle: 3, end: 10_000 + SWEEP.minMs } });
  assert.equal(none.start, null, 'too little time: none');
  assert.equal(none.swept, 3, 'and none later in that cycle');
  // Parked (`?at=`): the overview sweeps every parkedMs, a parked site never.
  const P = { now: 0, running: false, swept: null, leg: null, parked: true, held: false };
  assert.deepEqual(sweepStep(P).start, { ms: SWEEP.turnMs });
  assert.equal(sweepStep({ ...P, now: 1000, swept: 0 }).start, null);
  assert.deepEqual(sweepStep({ ...P, now: SWEEP.parkedMs, swept: 0 }).start, { ms: SWEEP.turnMs });
  assert.equal(sweepStep({ ...P, held: true }).rest, false);
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
  galaxy.update(model());
  const { pos, look } = overviewShot(galaxy.world.sites);
  galaxy.camera.position.set(pos.x, pos.y, pos.z);
  galaxy.camera.lookAt(look.x, look.y, look.z);
  return { galaxy, at };
}

test('sweepShape: a bright edge, a fading trail behind it, no hard end at either radius', () => {
  const { positions, shade, index } = sweepShape(3000);
  assert.equal(index.length % 3, 0);
  let edge = 0, trailMax = 0;
  for (let v = 0; v < shade.length; v++) {
    const x = positions[v * 3], z = positions[v * 3 + 2], r = Math.hypot(x, z);
    assert.ok(z <= 1e-6, 'the trail lies behind the edge (toward -z)');
    if (r < SWEEP.inner + 1 || r > 3000 - 1) assert.equal(shade[v], 0, 'no hard end');
    const a = Math.atan2(-z, x);
    if (a <= SWEEP.head + 1e-9) edge = Math.max(edge, shade[v]);
    else trailMax = Math.max(trailMax, shade[v]);
  }
  assert.equal(edge, 1);
  assert.ok(trailMax <= SWEEP.trailShare + 1e-6 && trailMax > 0);
});

test('without fx=sweep the scene makes no line and no ping rings, whatever it is told', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['beacon']) });
  galaxy.setSweep({ line: { angle: 1, k: 1 }, pings: [{ id: 'hv1', r: 0.5, k: 1 }] });
  at(1100);
  assert.equal(galaxy.sweep.line, null);
  assert.equal(galaxy.sweep.pings.length, 0);
});

test('with fx=sweep the line turns to the angle asked, grey and faint; a ping is a grey ring flat round its cluster', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['sweep']) });
  const { line, pings } = galaxy.sweep;
  assert.equal(pings.length, SWEEP.max, 'one pool, made once');
  at(1016);
  assert.equal(line.visible, false, 'nothing at rest');
  galaxy.setSweep({ line: { angle: 1.3, k: 1 }, pings: [{ id: 'hv2', r: 0.7, k: 0.8 }] });
  at(1032);
  assert.equal(line.visible, true);
  assert.ok(near(line.rotation.y, -1.3), 'turned to the angle');
  assert.ok(near(line.material.opacity, SWEEP.opacity) && SWEEP.opacity <= 0.25, 'faint');
  const c = line.material.color;
  assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.03, 'grey');
  // Its reach covers every cluster.
  const R = Math.max(...Array.from(line.geometry.attributes.position.array).filter((_, i) => i % 3 === 0));
  for (const s of galaxy.world.sites) assert.ok(Math.hypot(s.home.x, s.home.z) < R, `${s.id} under the line`);
  const shown = pings.filter((r) => r.visible);
  assert.equal(shown.length, 1);
  const h = galaxy.world.byId.get('hv2').home;
  assert.deepEqual([shown[0].position.x, shown[0].position.y, shown[0].position.z], [h.x, h.y, h.z]);
  assert.ok(near(shown[0].rotation.x, -Math.PI / 2), 'flat on the plane');
  assert.ok(shown[0].geometry.parameters.innerRadius > 0.9, 'a thin ring, not a disc');
  const p = shown[0].material.color;
  assert.ok(Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 0.03, 'grey: fresh data is not trouble');
  assert.ok(near(shown[0].material.opacity, SWEEP.pingOpacity * 0.8, 1e-6));
  // Told it is over: all gone.
  galaxy.setSweep(null);
  at(1048);
  assert.equal(line.visible, false);
  assert.equal(pings.filter((r) => r.visible).length, 0);
});

test('fx=sweep in still mode: nothing is made', () => {
  const { galaxy, at } = sceneAt({ fx: new Set(['sweep']), still: true });
  galaxy.setSweep({ line: { angle: 1, k: 1 }, pings: [{ id: 'hv1', r: 0.5, k: 1 }] });
  at(1100);
  assert.equal(galaxy.sweep.line, null);
  assert.equal(galaxy.sweep.pings.length, 0);
});

test('galaxy/main.js runs the sweep only under fx=sweep, never in still mode, by sweepStep, and feeds it each model', () => {
  const src = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(src, /const sweep = fx\.has\('sweep'\) && !reduced \? createSweep\(\) : null;/);
  assert.match(src, /if \(sweep\) runSweep\(now, at\);/);
  assert.match(src, /if \(sweep\) sweep\.model\(siteNews\(model,/);
  assert.match(src, /if \(!step\.rest\) sweep\.stop\(now\);/);
  assert.match(src, /mode: touch\?\.mode\(\) \?\? 'tour'/);
  assert.match(src, /flight: cam\.flight\(\)/);
});
