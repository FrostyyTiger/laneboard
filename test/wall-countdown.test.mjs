// A scheduled job's countdown (Wall plan night 4 T40, README §7.C, research
// Q17): a feed's `countdown: {at, label}` reaches the node (server/map.mjs
// feedExtras), countdown.js words it in Q17's format, and the galaxy's names
// carry it as a second line under the thing it runs on, at the site step,
// only once its system opens. The large demo carries three, one per phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as THREE from '../public/vendor/three/three.module.js';
import { countdownText, countdownPhase, countdownOf, countdownLine, SOON_MS } from '../public/js/wall/countdown.js';
import { labelCount, labelBox, labelSize, createLabels, overlaps } from '../public/js/wall/galaxy/labels.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { siteShot, FOV } from '../public/js/wall/galaxy/scene.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';
import { buildFleet, parseTopology, feedExtras, COUNTDOWN_LABEL_MAX } from '../server/map.mjs';
import { DEMO_TOPOLOGY_LARGE, demoFeedsLarge, countdownAt } from './helpers/demo-hub.mjs';

const NOW = 1_790_000_000_000;
const S = 1000, M = 60 * S, H = 60 * M;

test('countdown: Q17\'s table, at a distance and held', () => {
  const rows = [
    // left (ms), distance, held, phase
    [3 * H + 12 * M, 'in 3 h', '3:12 h', 'far'],
    [H, 'in 1 h', '1:00 h', 'far'],
    [12 * M + 4 * S, 'in 12 min', '12:04', 'far'],
    [SOON_MS + 1, 'in 5 min', '5:01', 'far'],
    [4 * M + 12 * S, 'in 4 min', '4:12', 'soon'],
    [41 * S, '< 1 min', '0:41', 'soon'],
    [300, '< 1 min', '0:01', 'soon'],
    [0, 'now', '0:00', 'now'],
    [-7 * S, 'now', '+0:07', 'now'],
    [-2 * M - 7 * S, '+2 min', '+2:07', 'late'],
    [-75 * M, '+75 min', '+75:00', 'late'],
  ];
  for (const [left, far, held, phase] of rows) {
    const at = NOW + left;
    assert.deepEqual(countdownText(at, NOW), { text: far, phase }, `distance, ${left} ms left`);
    assert.deepEqual(countdownText(at, NOW, { held: true }), { text: held, phase }, `held, ${left} ms left`);
    assert.equal(countdownPhase(at, NOW), phase);
  }
  // Whole minutes change once a minute: every second of one minute says the same.
  const words = new Set();
  for (let s = 0; s < 60; s++) words.add(countdownText(NOW + 12 * M + 30 * S, NOW + s * S).text);
  assert.ok(words.size <= 2, `${[...words]}`);
  assert.equal(countdownText(Number.NaN, NOW), null);
  assert.equal(countdownText(NOW, undefined), null);
});

test('countdown: a node\'s line is its label and the count; a bad one is none', () => {
  assert.deepEqual(countdownOf({ countdown: { at: NOW, label: ' dumps ' } }), { at: NOW, label: 'dumps' });
  assert.deepEqual(countdownOf({ countdown: { at: NOW } }), { at: NOW, label: null });
  for (const n of [{}, null, { countdown: {} }, { countdown: { at: '2026-10-27' } }, { countdown: { at: Number.NaN } }]) {
    assert.equal(countdownOf(n), null, JSON.stringify(n));
  }
  assert.deepEqual(countdownLine({ countdown: { at: NOW + 12 * M, label: 'dumps' } }, NOW), { text: 'dumps in 12 min', phase: 'far' });
  assert.deepEqual(countdownLine({ countdown: { at: NOW - 3 * M } }, NOW), { text: '+3 min', phase: 'late' });
  assert.equal(countdownLine({ kind: 'room' }, NOW), null);
});

test('countdown: feedExtras keeps a valid countdown, as epoch ms, and drops a bad one whole', () => {
  assert.deepEqual(feedExtras({ countdown: { at: NOW, label: 'dumps' } }), { countdown: { at: NOW, label: 'dumps' } });
  assert.deepEqual(feedExtras({ countdown: { at: new Date(NOW).toISOString(), label: 'dumps' } }), { countdown: { at: NOW, label: 'dumps' } });
  assert.deepEqual(feedExtras({ countdown: { at: NOW } }), { countdown: { at: NOW } });
  assert.deepEqual(feedExtras({ countdown: { at: NOW, label: '  ' } }), { countdown: { at: NOW } }, 'an empty label is no label');
  assert.deepEqual(feedExtras({ countdown: { at: NOW, label: 'x', repeat: 'daily' } }), { countdown: { at: NOW, label: 'x' } }, 'only the known fields');
  const bad = [
    'soon', NOW, {}, { at: 'tomorrow' }, { at: -1 }, { at: 0 }, { at: Number.POSITIVE_INFINITY }, { at: null },
    { at: NOW, label: 7 }, { at: NOW, label: 'x'.repeat(COUNTDOWN_LABEL_MAX + 1) }, [NOW, 'dumps'],
  ];
  for (const countdown of bad) assert.deepEqual(feedExtras({ countdown }), {}, JSON.stringify(countdown));
  // A bad countdown does not take a good ring with it.
  assert.deepEqual(feedExtras({ ring: { progress: 0.5 }, countdown: { at: 'x' } }), { ring: { progress: 0.5 } });
});

test('countdown: the large demo carries three, one far, one by the minute, one late, on its rooms', () => {
  const now = NOW;
  const m = buildFleet({
    topology: parseTopology(DEMO_TOPOLOGY_LARGE),
    feeds: new Map(demoFeedsLarge(now).map((f) => [f.source, { ...f, receivedAt: now }])),
    now,
    hostname: 'demo-host',
  });
  const with_ = m.nodes.filter((n) => n.countdown);
  assert.deepEqual(with_.map((n) => n.id).sort(), ['db', 'object-store', 'office-nas']);
  for (const n of with_) assert.equal(n.kind, 'room', `${n.id} is a planet, named once its system opens`);
  const byId = new Map(with_.map((n) => [n.id, n]));
  assert.equal(byId.get('db').countdown.label, 'dumps');
  const left = (id) => byId.get(id).countdown.at - now;
  assert.ok(left('db') > 0 && left('db') <= 15 * M);
  assert.ok(left('office-nas') > 0 && left('office-nas') <= 3 * H);
  assert.ok(left('object-store') <= -2 * M && left('object-store') > -22 * M, 'always overdue');
  // Over a whole beat the dumps show both the minutes and the last five.
  const phases = new Set();
  for (let t = now; t < now + 15 * M; t += 30 * S) phases.add(countdownPhase(countdownAt({ everyMs: 15 * M }, t), t));
  assert.deepEqual([...phases].sort(), ['far', 'soon']);
  // The next run is always ahead, never at `now`.
  assert.ok(countdownAt({ everyMs: 15 * M }, 15 * M) > 15 * M);
});

test('countdown: labelCount is caps for the label face; labelBox makes room for the second line at the site step', () => {
  const node = { kind: 'room', label: 'db', countdown: { at: NOW + 12 * M, label: 'dumps' } };
  const count = labelCount(node, NOW);
  assert.deepEqual(count, { text: 'DUMPS IN 12 MIN', phase: 'far' });
  assert.equal(labelCount({ kind: 'room' }, NOW), null);
  const steps = { site: 26, room: 15 };
  const name = labelSize('db', 15, 'mono');
  const line = labelSize('DUMPS IN 12 MIN', 26, 'label');
  assert.deepEqual(labelBox('db', 'mono', steps), name);
  assert.deepEqual(labelBox('db', 'mono', steps, count), { w: Math.max(name.w, line.w), h: name.h + line.h });
});

// The large demo as the Wall gets it, with the demo's countdowns hung on.
const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes
  .map((n) => (n.id === 'db' ? { ...n, countdown: { at: NOW + 12 * M + 30 * S, label: 'dumps' } } : n));

function worldOf(openId) {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => {
    const open = s.id === openId ? 1 : 0;
    const members = s.members.map((m) => {
      const k = open ? 1 : 0.16;
      const p = new THREE.Vector3(s.home.x + m.off.x * k, s.home.y + m.off.y * k, s.home.z + m.off.z * k);
      return { ...m, tone: toneOf(m.node), mesh: { position: p } };
    });
    return { ...s, members, open };
  });
  return { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
}

function fakeDoc() {
  const el = () => ({ style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, dataset: {}, textContent: '', remove() {}, append: () => {} });
  const made = [];
  return { doc: { createElement: () => { const e = el(); made.push(e); return e; } }, made, root: el() };
}

function galaxyAt(world, shot, W = 1368, H = 912) {
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  camera.updateMatrixWorld();
  return { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } };
}

test('createLabels: an open system names its countdown under the thing, once a minute; the overview does not', () => {
  const world = worldOf('lab');
  const galaxy = galaxyAt(world, siteShot(world.byId.get('lab'), 0));
  let t = NOW;
  const { doc, root, made } = fakeDoc();
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, now: () => t, doc });
  labels.draw();
  const db = labels.shown().find((s) => s.id === 'db');
  assert.ok(db, 'the db room is named in its open system');
  assert.equal(db.count, 'DUMPS IN 12 MIN');
  assert.ok(db.box.h >= Math.ceil(15 * 1.25) + Math.ceil(26 * 1.25), 'its box has room for both lines');
  const all = labels.shown();
  for (const s of all) {
    for (const o of all) if (o !== s) assert.ok(!overlaps(s.box, o.box), `${s.id} and ${o.id}`);
  }
  const span = made.find((e) => e.textContent === 'db');
  assert.equal(span.dataset.count, 'DUMPS IN 12 MIN');
  assert.equal(span.dataset.countPhase, 'far');
  // Ten seconds on, the same words: nothing is written.
  t = NOW + 10 * S;
  labels.draw();
  assert.equal(span.dataset.count, 'DUMPS IN 12 MIN');
  // Into the last five minutes: brighter, by phase, never by hue.
  t = NOW + 8 * M;
  labels.draw();
  assert.equal(span.dataset.count, 'DUMPS IN 4 MIN');
  assert.equal(span.dataset.countPhase, 'soon');
  assert.equal(span.dataset.tone, 'calm');

  // At the overview every system is folded: no member is named, so no countdown shows.
  const folded = worldOf(null);
  const fd = fakeDoc();
  const over = createLabels(fd.root, galaxyAt(folded, siteShot(folded.byId.get('lab'), 0)), { steps: { site: 26, room: 15 }, now: () => NOW, doc: fd.doc });
  over.draw();
  assert.ok(over.shown().every((s) => s.count == null));
});

test('countdown: wall.css draws the line in the label face, tabular, grey by phase', () => {
  const css = fs.readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = css.match(/\.galaxy-label\[data-count\]::after \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /content: attr\(data-count\)/);
  assert.match(rule, /font-variant-numeric: tabular-nums/);
  assert.match(rule, /font-size: var\(--gl-site\)/);
  assert.doesNotMatch(css.match(/\[data-count-phase[^{]*\{[^}]*\}/g).join('\n'), /--(crit|warn|p\d)/, 'no hue for a clock');
});
