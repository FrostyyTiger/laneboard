// The Map's geometry: rings by kind, sectors, clearance, stagger, labels, dial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, RINGS, RING_OF, SIZE, ringLabels, ticks, CLEARANCE } from '../public/js/views/map/layout.js';

const N = (id, parent, kind, extra = {}) => ({ id, parent, kind, label: id, ...extra });
const TAU = Math.PI * 2;

const fleet = () => [
  N('__core', null, 'core'),
  N('lab', '__core', 'site', { order: 0 }),
  N('agents', 'lab', 'room'),
  N('builder:builder-a', 'agents', 'builder'),
  N('lane:builder-a/pay', 'builder:builder-a', 'lane'),
  N('sess:builder-a/s1', 'lane:builder-a/pay', 'session'),
  N('__fleet', '__core', 'site', { order: 1 }),
  N('builder:builder-b', '__fleet', 'builder'),
  N('lane:builder-b/api', 'builder:builder-b', 'lane'),
  N('__repos', '__core', 'site', { order: 2 }),
  N('repo:acme-app', '__repos', 'repo'),
  N('pkg:acme-app/api', 'repo:acme-app', 'package'),
];

test('ring tables cover every fleet kind', () => {
  assert.deepEqual(RINGS, [0, 150, 290, 420, 540, 640]);
  for (const k of ['core', 'site', 'host', 'room', 'builder', 'service', 'repo', 'package', 'lane', 'pr', 'session']) {
    assert.ok(Number.isInteger(RING_OF[k]), `RING_OF.${k}`);
    assert.ok(SIZE[k] > 0, `SIZE.${k}`);
  }
});

test('a node\'s radius comes from its kind, not its depth', () => {
  const { pos } = layout(fleet());
  const r = (id) => pos.get(id).ring;
  assert.equal(r('builder:builder-a'), 3, 'builder under a room');
  assert.equal(r('builder:builder-b'), 3, 'builder directly under __fleet');
  assert.equal(pos.get('builder:builder-a').depth, 3);
  assert.equal(pos.get('builder:builder-b').depth, 2);
  assert.equal(r('lane:builder-a/pay'), 4);
  assert.equal(r('lane:builder-b/api'), 4);
  assert.equal(r('sess:builder-a/s1'), 5);
  assert.equal(r('lab'), 1);
  assert.equal(r('agents'), 2);
  assert.equal(r('repo:acme-app'), 2);
  assert.equal(r('pkg:acme-app/api'), 3);
  assert.equal(r('__core'), 0);
  assert.equal(pos.get('__core').r, 0);
  // Unstaggered nodes sit exactly on their ring.
  assert.equal(pos.get('lab').r, RINGS[1]);
  const b = pos.get('builder:builder-b');
  assert.ok(Math.abs(Math.hypot(b.x, b.y) - b.r) < 1e-9);
});

test('a child always sits outside its parent, unknown kinds fall back to depth', () => {
  const { pos } = layout([
    N('c', null, 'core'),
    N('h', 'c', 'host'),
    N('s1', 'h', 'service'),
    N('s2', 's1', 'service'),
    N('x', 'h', 'gizmo'),
  ]);
  assert.equal(pos.get('s1').ring, 3);
  assert.equal(pos.get('s2').ring, 4, 'a nested service moves out a ring');
  assert.equal(pos.get('x').ring, 2, 'unknown kind: its depth');
});

test('the twelve o\'clock clearance is kept', () => {
  const { pos } = layout(fleet());
  const start = -Math.PI / 2 + CLEARANCE / 2;
  for (const [id, p] of pos) {
    if (id === '__core') continue;
    assert.ok(p.a0 >= start - 1e-9 && p.a1 <= start + TAU - CLEARANCE + 1e-9, `${id} sector inside the dial`);
    // No node centre within the cleared wedge around -90°.
    const off = Math.abs(Math.atan2(Math.sin(p.angle + Math.PI / 2), Math.cos(p.angle + Math.PI / 2)));
    assert.ok(off >= CLEARANCE / 2 - 1e-9, `${id} is in the clearance`);
  }
});

test('sectors are proportional to the leaves under each node', () => {
  const nodes = [N('c', null, 'core'), N('a', 'c', 'site'), N('b', 'c', 'site')];
  for (let i = 0; i < 3; i++) nodes.push(N(`a${i}`, 'a', 'room'));
  nodes.push(N('b0', 'b', 'room'));
  const { pos } = layout(nodes);
  const span = (id) => pos.get(id).a1 - pos.get(id).a0;
  assert.ok(Math.abs(span('a') / span('b') - 3) < 1e-9, `${span('a')} vs ${span('b')}`);
  assert.ok(Math.abs(span('a0') - span('a1')) < 1e-12);
});

test('stagger applies only on rings 3 and out', () => {
  const nodes = [N('c', null, 'core'), N('s', 'c', 'site'), N('r', 's', 'room')];
  for (let i = 0; i < 80; i++) nodes.push(N(`room${i}`, 's', 'room'));
  for (let i = 0; i < 80; i++) nodes.push(N(`lane${i}`, 'r', 'lane'));
  const { pos } = layout(nodes);
  for (let i = 0; i < 80; i++) assert.equal(pos.get(`room${i}`).r, RINGS[2], 'ring 2 never staggers');
  const radii = new Set(Array.from({ length: 80 }, (_, i) => pos.get(`lane${i}`).r));
  assert.deepEqual([...radii].sort((a, b) => a - b), [RINGS[4] - 10, RINGS[4] + 16]);
});

test('layout is deterministic and has a virtual centre when there is no core', () => {
  const a = layout(fleet()), b = layout(fleet());
  assert.deepEqual([...a.pos], [...b.pos]);
  const v = layout([N('x', null, 'site'), N('y', 'x', 'room')]);
  assert.equal(v.center.virtual, true);
  assert.equal(v.pos.get('__core').ring, 0);
  assert.equal(v.pos.get('x').ring, 1);
  assert.deepEqual(v.kids.get('__core').map((n) => n.id), ['x']);
});

test('layout tolerates a parent cycle and a self-parent', () => {
  const { pos } = layout([N('c', null, 'core'), N('a', 'b', 'room'), N('b', 'a', 'room'), N('s', 's', 'site')]);
  assert.equal(pos.get('s').ring, 1, 'a self-parent is a root');
  assert.equal(pos.has('a'), false);
});

test('ringLabels combines the kinds on each ring', () => {
  const nodes = fleet();
  const { pos } = layout(nodes);
  const labels = ringLabels(pos, nodes);
  assert.deepEqual(labels.map((l) => [l.ring, l.label]), [
    [1, 'SITE'], [2, 'ROOM · REPO'], [3, 'BUILDER · PKG'], [4, 'LANE'], [5, 'SESSION'],
  ]);
  assert.equal(labels[0].r, RINGS[1]);
  const svc = [...nodes, N('svc', 'agents', 'service')];
  assert.equal(ringLabels(layout(svc).pos, new Map(svc.map((n) => [n.id, n])))[2].label, 'BUILDER · SVC · PKG');
  // A virtual centre carries no label.
  const v = [N('x', null, 'site')];
  assert.deepEqual(ringLabels(layout(v).pos, v).map((l) => l.ring), [1]);
});

test('ticks: 72 around the dial, long every 30°, bearings every 90°', () => {
  const t = ticks(700);
  assert.equal(t.length, 72);
  assert.equal(t.filter((x) => x.long).length, 12);
  assert.deepEqual(t.filter((x) => x.label).map((x) => x.label), ['000', '090', '180', '270']);
  assert.ok(Math.abs(t[0].a + Math.PI / 2) < 1e-12, '000 at twelve o\'clock');
  assert.ok(Math.abs(t[18].a) < 1e-12, '090 at three o\'clock');
  assert.equal(t[0].r0, 700);
  assert.equal(t[0].r1, 707);
  assert.equal(t[1].r1, 703);
});
