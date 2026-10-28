// The show commands on the Wall (Wall plan night 4 T37; aligned with the
// cockpit spec on 2026-10-27: c4-show-canvas.md §2-§5, protocols.md §4,
// D68-D73): the room's `show` / `show.undo` / `pin.put` / `pin.remove` in,
// `show.result` / `pin.close` out; the owner's finger rule; one highlight,
// three pins, the limits; the undo; the looks. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAMERA_CMDS, INBOUND, RESULT_STATES, SHOW, SHOW_CMDS, SHOW_LATER, UNLIT, WHY, bracketBox, clockText, createFingerWatch, createShow,
  cutText, emphasisOf, initialShow, leaderOf, notePlace, pinOf, pinPlace, readShow, showStep,
} from '../public/js/wall/galaxy/show.js';
import { fitPose, showFlightMs } from '../public/js/wall/galaxy/camera.js';
import { makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const t0 = 100_000;
let n = 0;
/** A room's `show` message (protocols.md §4). */
const show = (cmd, args, extra = {}) => ({ type: 'show', showId: `sh-${String(++n).padStart(4, '0')}`, turnId: 't-0132', cmd, args, receivedAt: 1793080932210, ...extra });
const KNOWN = new Set(['hv1', 'hv2', 'hv1-a', 'hv2-a', 'storage', 'db']);
const ctx = (extra = {}) => ({ time: 1793080932210, camera: { x: 1, y: 2, z: 3 }, wall: 'tour', known: (id) => KNOWN.has(id), inSight: () => false, ...extra });

/** Runs `events` (`[at, event, ctx?]`) from an empty show, returning each step's result. */
function run(events, state = initialShow()) {
  const out = [];
  for (const [at, ev, c] of events) {
    const r = showStep(state, ev, at, c ?? ctx());
    out.push(r);
    state = r.state;
  }
  return out;
}

test('show: the spec\'s commands, limits and answers (c4 §3, D72, D73, protocols.md §4)', () => {
  assert.deepEqual([...SHOW_CMDS], ['fly_to', 'highlight', 'pin', 'clear']);
  assert.deepEqual([...SHOW_LATER], ['compare', 'scrub']);
  assert.deepEqual([...CAMERA_CMDS], ['fly_to', 'highlight']);
  assert.deepEqual([...RESULT_STATES], ['shown', 'waiting', 'skipped']);
  assert.equal(WHY.inUse, 'in use');
  assert.deepEqual([...INBOUND], ['show', 'show.undo', 'pin.put', 'pin.remove']);
  assert.equal(SHOW.maxNodes, 12);
  assert.equal(SHOW.maxNote, 120);
  assert.equal(SHOW.maxTitle, 48);
  assert.equal(SHOW.maxBody, 280);
  assert.equal(SHOW.pins, 3);
  assert.equal(SHOW.waitMs, 3000);
  assert.equal(SHOW.giveUpMs, 10000);
  assert.equal(UNLIT, 0.16, 'the spec\'s UNLIT, one named constant to tune on the panel');
  assert.equal(SHOW.unlit, UNLIT);
  assert.equal(SHOW.zoom, 1.9);
  assert.equal(SHOW.xPx, 48);
});

test('readShow: each command\'s args, cut to the limits as text; compare, scrub and other blocks unsupported; bad shapes', () => {
  assert.equal(readShow({ type: 'show.line' }), null, 'not a show: no answer');
  assert.equal(readShow(null), null);
  assert.deepEqual(readShow({ type: 'show', cmd: 'fly_to', args: { node: 'x' } }), { ok: false, showId: null, why: 'bad-args' });
  const fly = readShow(show('fly_to', { node: 'builder-a' }));
  assert.deepEqual([fly.ok, fly.cmd, fly.args, fly.turnId, fly.receivedAt], [true, 'fly_to', { node: 'builder-a' }, 't-0132', 1793080932210]);
  for (const cmd of ['compare', 'scrub', 'fly', 'flyTo']) assert.equal(readShow(show(cmd, { a: 'x', b: 'y' })).why, 'unsupported', cmd);
  const nodes = Array.from({ length: 15 }, (_, i) => `n${i}`);
  const hi = readShow(show('highlight', { nodes: [...nodes, 'n0'], note: `${'x'.repeat(130)}` }));
  assert.equal(hi.args.nodes.length, 12, 'the first 12');
  assert.equal(hi.args.note.length, 120);
  assert.ok(hi.args.note.endsWith('…'));
  assert.equal(readShow(show('highlight', { nodes: ['a'], note: 'same task\n failed  <b>here</b>' })).args.note, 'same task failed <b>here</b>', 'text kept as text');
  for (const args of [{ nodes: [] }, { nodes: 'a' }, { nodes: [1] }, { nodes: ['a'], note: 3 }]) {
    assert.equal(readShow(show('highlight', args)).why, 'bad-args', JSON.stringify(args));
  }
  const pin = readShow(show('pin', { node: 'db', card: { block: 'text', title: 't'.repeat(60), body: 'b'.repeat(300) } }));
  assert.equal(pin.args.card.title.length, 48);
  assert.equal(pin.args.card.body.length, 280);
  assert.equal(readShow(show('pin', { node: 'db', card: { body: 'no block: text' } })).args.card.block, 'text');
  assert.equal(readShow(show('pin', { node: 'db', card: { block: 'chart', series: [] } })).why, 'unsupported', 'kit blocks later');
  for (const args of [{ node: 'db' }, { card: { body: 'x' } }, { node: 'db', card: {} }]) assert.equal(readShow(show('pin', args)).why, 'bad-args');
  assert.deepEqual(readShow(show('clear', { screen: 'all' })).args, {});
  assert.equal(cutText('  a\n b ', 10), 'a b');
  assert.match(clockText(new Date(2026, 9, 27, 7, 2).getTime()), /^07:02$/);
});

test('showStep fly_to: shown at once, the camera to the node, undoable; a node not drawn is skipped', () => {
  const [r, ghost] = run([
    [t0, { type: 'msg', msg: show('fly_to', { node: 'hv2-a' }) }],
    [t0 + 10, { type: 'msg', msg: show('fly_to', { node: 'vm-x' }) }],
  ]);
  assert.deepEqual(r.out, [{ type: 'show.result', showId: 'sh-0001', state: 'shown' }].map((m) => ({ ...m, showId: r.out[0].showId })));
  assert.deepEqual(r.act, { kind: 'fly', node: 'hv2-a', showId: r.out[0].showId });
  assert.equal(r.state.undo.showId, r.out[0].showId);
  assert.deepEqual(r.state.undo.saved, { camera: { x: 1, y: 2, z: 3 }, wall: 'tour', highlight: null });
  assert.deepEqual(ghost.out.map((m) => [m.state, m.why]), [['skipped', 'not drawn']]);
  assert.equal(ghost.act, null);
  assert.equal(ghost.state.undo.showId, r.out[0].showId, 'a skipped command takes no undo');
});

test('showStep highlight: brackets for the drawn nodes, the camera stays when all are in sight, else fits; a new one replaces it', () => {
  const [a, b] = run([
    [t0, { type: 'msg', msg: show('highlight', { nodes: ['hv1', 'ghost', 'hv2'], note: 'these break' }) }, ctx({ inSight: () => true })],
    [t0 + 500, { type: 'msg', msg: show('highlight', { nodes: ['db'] }) }],
  ]);
  assert.deepEqual(a.state.highlight.nodes, ['hv1', 'hv2']);
  assert.equal(a.state.highlight.note, 'these break');
  assert.equal(a.state.highlight.at, 1793080932210, 'the time the command arrived (receivedAt)');
  assert.equal(a.act.kind, 'stay');
  assert.deepEqual(b.state.highlight.nodes, ['db']);
  assert.equal(b.state.highlight.note, '');
  assert.deepEqual(b.act, { kind: 'fit', nodes: ['db'], showId: b.out[0].showId });
  assert.equal(b.state.undo.saved.highlight, a.state.highlight, 'its undo brings the old marks back');
  const [none] = run([[t0, { type: 'msg', msg: show('highlight', { nodes: ['vm-x'] }) }]]);
  assert.deepEqual(none.out.map((m) => m.why), ['not drawn']);
});

test('showStep pin: at most 3, a 4th replaces the oldest; its undo removes it; clear keeps it; the room\'s pin.put / pin.remove', () => {
  const ids = [];
  let s = initialShow();
  for (const node of ['hv1', 'hv2', 'db', 'storage']) {
    const m = show('pin', { node, card: { block: 'text', title: 'disk', body: 'full in 2 h' } });
    ids.push(m.showId);
    const r = showStep(s, { type: 'msg', msg: m }, t0, ctx({ blocked: true }));
    assert.deepEqual(r.out.map((o) => o.state), ['shown'], 'a pin moves no camera: shown even under a finger');
    s = r.state;
  }
  assert.deepEqual(s.pins.map((p) => p.node), ['hv2', 'db', 'storage'], 'the oldest went');
  s = showStep(s, { type: 'msg', msg: show('clear', {}) }, t0).state;
  assert.equal(s.pins.length, 3, 'clear keeps the pins');
  s = showStep(s, { type: 'undo', showId: ids[2] }, t0).state;
  assert.deepEqual(s.pins.map((p) => p.node), ['hv2', 'storage']);
  s = showStep(s, { type: 'pin.put', pin: { id: 'pin-0008', node: 'builder-a', block: 'text', title: 'stuck since 03:12', by: 'agent', at: '2026-10-27T07:02:09+01:00', fields: { body: 'No log line for 3 h 50.' } }, replaced: s.pins[0].id }, t0).state;
  assert.deepEqual(s.pins.map((p) => p.id), [`pin-${ids[3]}`, 'pin-0008']);
  assert.deepEqual(pinOf({ id: 'p', node: 'n', title: 'x', fields: { body: 'y' }, at: '2026-10-27T07:02:09+01:00' }).body, 'y');
  const closed = showStep(s, { type: 'pin.close', pin: 'pin-0008' }, t0);
  assert.deepEqual(closed.out, [{ type: 'pin.close', pin: 'pin-0008' }]);
  s = showStep(closed.state, { type: 'pin.remove', pin: `pin-${ids[3]}` }, t0).state;
  assert.equal(s.pins.length, 0);
});

test('showStep finger rule (D70, S-C4-08): waiting under a finger, shown 3 s after the lift, skipped "in use" at 10 s', () => {
  const m = show('fly_to', { node: 'hv1' });
  // The owner drags from t = 0; the command comes at 1 s; the finger lifts at 4 s.
  const blockedUntil = (lift) => (at) => ctx({ blocked: at < lift + SHOW.waitMs });
  const c = blockedUntil(t0 + 4000);
  const [wait, still, go] = run([
    [t0 + 1000, { type: 'msg', msg: m }, c(t0 + 1000)],
    [t0 + 6999, { type: 'tick' }, c(t0 + 6999)],
    [t0 + 7000, { type: 'tick' }, c(t0 + 7000)],
  ]);
  assert.deepEqual(wait.out, [{ type: 'show.result', showId: m.showId, state: 'waiting' }]);
  assert.equal(wait.act, null, 'never flies under the finger');
  assert.equal(still.act, null);
  assert.deepEqual(go.out, [{ type: 'show.result', showId: m.showId, state: 'shown' }]);
  assert.equal(go.act.kind, 'fly');
  // Second run: the finger stays down until 12 s: dropped at 11 s (10 s after it came), never flies.
  const m2 = show('fly_to', { node: 'hv1' });
  const c2 = blockedUntil(t0 + 12_000);
  const [, before, drop, after] = run([
    [t0 + 1000, { type: 'msg', msg: m2 }, c2(t0 + 1000)],
    [t0 + 10_999, { type: 'tick' }, c2(t0 + 10_999)],
    [t0 + 11_000, { type: 'tick' }, c2(t0 + 11_000)],
    [t0 + 16_000, { type: 'tick' }, c2(t0 + 16_000)],
  ]);
  assert.deepEqual(before.out, []);
  assert.deepEqual(drop.out, [{ type: 'show.result', showId: m2.showId, state: 'skipped', why: 'in use' }]);
  assert.equal(drop.state.waiting, null);
  assert.equal(after.act, null, 'and nothing later');
  // A newer camera command replaces a waiting one, which is answered skipped.
  const a = show('fly_to', { node: 'hv1' }), b = show('highlight', { nodes: ['hv2'] });
  const [, second] = run([
    [t0, { type: 'msg', msg: a }, ctx({ blocked: true })],
    [t0 + 500, { type: 'msg', msg: b }, ctx({ blocked: true })],
  ]);
  assert.deepEqual(second.out.map((o) => [o.showId, o.state, o.why]), [[a.showId, 'skipped', 'in use'], [b.showId, 'waiting', undefined]]);
});

test('showStep undo (D71, c4 §5): the latest camera command only; it restores camera, marks and the wall state; a replacing flight takes over the saved state', () => {
  const hi = show('highlight', { nodes: ['hv1', 'hv2'], note: 'n' });
  const fly = show('fly_to', { node: 'db' });
  const fly2 = show('fly_to', { node: 'storage' });
  const [h, f, f2, old, undo, again] = run([
    [t0, { type: 'msg', msg: hi }, ctx({ wall: 'tour', camera: 'C0' })],
    [t0 + 5000, { type: 'msg', msg: fly }, ctx({ wall: 'explore', camera: 'C1' })],
    // 200 ms later, mid-flight: the second takes over the first's saved state (S-C4-10).
    [t0 + 5200, { type: 'msg', msg: fly2 }, ctx({ wall: 'explore', camera: 'C-mid', moving: true })],
    [t0 + 6000, { type: 'undo', showId: fly.showId }],
    [t0 + 6000, { type: 'undo', showId: fly2.showId }],
    [t0 + 6100, { type: 'undo', showId: fly2.showId }],
  ]);
  assert.equal(h.state.undo.saved.wall, 'tour');
  assert.equal(f.state.undo.saved.camera, 'C1');
  assert.equal(f2.state.undo.saved.camera, 'C1', 'back to before both');
  assert.equal(old.act, null, 'an older line has no undo');
  assert.deepEqual(undo.act, { kind: 'restore', saved: f2.state.undo.saved });
  assert.deepEqual(undo.state.highlight.nodes, ['hv1', 'hv2'], 'the marks as they were');
  assert.equal(again.act, null, 'once');
  // clear: its undo brings the marks back and moves nothing; with nothing to clear it has no undo.
  const cl = show('clear', {});
  const [, c, cu] = run([
    [t0, { type: 'msg', msg: hi }],
    [t0 + 100, { type: 'msg', msg: cl }],
    [t0 + 200, { type: 'undo', showId: cl.showId }],
  ]);
  assert.equal(c.state.highlight, null);
  assert.equal(c.act, null, 'the camera does not move');
  assert.deepEqual(cu.state.highlight.nodes, ['hv1', 'hv2']);
  assert.equal(cu.act, null);
  const [empty] = run([[t0, { type: 'msg', msg: show('clear', {}) }]]);
  assert.equal(empty.state.undo, null);
  assert.deepEqual(empty.out.map((o) => o.state), ['shown']);
  // The tour coming back drops the highlight, the note and the undo; pins stay.
  const [, , back] = run([
    [t0, { type: 'msg', msg: show('pin', { node: 'db', card: { body: 'x' } }) }],
    [t0, { type: 'msg', msg: show('highlight', { nodes: ['hv1'] }) }],
    [t0 + 60_000, { type: 'tour' }],
  ]);
  assert.equal(back.state.highlight, null);
  assert.equal(back.state.undo, null);
  assert.equal(back.state.pins.length, 1);
});

test('showStep undo of a command still waiting for the finger: it never runs and gets no second answer', () => {
  const m = show('fly_to', { node: 'hv1' });
  const [wait, undo, later] = run([
    [t0, { type: 'msg', msg: m }, ctx({ blocked: true })],
    [t0 + 500, { type: 'undo', showId: m.showId }, ctx({ blocked: true })],
    [t0 + 5000, { type: 'tick' }, ctx({ blocked: false })],
  ]);
  assert.deepEqual(wait.out.map((o) => o.state), ['waiting']);
  assert.equal(undo.state.waiting, null, 'dropped');
  assert.deepEqual(undo.out, []);
  assert.equal(undo.act, null);
  assert.equal(later.act, null, 'never flies');
  assert.deepEqual(later.out, []);
});

test('showStep pin.put without a time: headed with the time it came, not 00:00', () => {
  const r = showStep(initialShow(), { type: 'pin.put', pin: { id: 'p1', node: 'db', title: 'x', fields: { body: 'y' } } }, t0, ctx());
  assert.equal(r.state.pins[0].at, 1793080932210);
  const at = '2026-10-27T07:02:09+01:00';
  const r2 = showStep(initialShow(), { type: 'pin.put', pin: { id: 'p2', node: 'db', title: 'x', at } }, t0, ctx());
  assert.equal(r2.state.pins[0].at, Date.parse(at), 'the room\'s own time when it sends one');
});

test('showStep: a repeated showId is neither shown nor answered twice; unsupported and bad shapes are answered skipped', () => {
  const m = show('fly_to', { node: 'hv1' });
  const [, twice, cmp, bad] = run([
    [t0, { type: 'msg', msg: m }],
    [t0 + 10, { type: 'msg', msg: m }],
    [t0 + 20, { type: 'msg', msg: show('compare', { a: 'hv1', b: 'hv2' }) }],
    [t0 + 30, { type: 'msg', msg: show('fly_to', {}) }],
  ]);
  assert.deepEqual(twice.out, []);
  assert.deepEqual(cmp.out.map((o) => [o.state, o.why]), [['skipped', 'unsupported']]);
  assert.deepEqual(bad.out.map((o) => [o.state, o.why]), [['skipped', 'bad-args']]);
});

test('emphasis and placements: UNLIT 0.16 for the rest over the fade; brackets close in from 24 px; note and pins on the stage', () => {
  const [h] = run([[t0, { type: 'msg', msg: show('highlight', { nodes: ['hv1'] }) }]]);
  assert.equal(emphasisOf(h.state, 'hv1', t0 + 1000), 1);
  assert.equal(emphasisOf(h.state, 'hv2', t0), 1);
  assert.ok(Math.abs(emphasisOf(h.state, 'hv2', t0 + 1000) - 0.16) < 1e-9);
  assert.ok(Math.abs(emphasisOf(h.state, 'hv2', t0, { still: true }) - 0.16) < 1e-9);
  assert.equal(emphasisOf(initialShow(), 'hv2', t0), 1);
  const at = { x: 400, y: 300, r: 10 };
  assert.equal(bracketBox(at, 0).R, 10 + 8 + 24);
  assert.equal(bracketBox(at, 300).R, 18, '8 px outside the drawn radius after 300 ms');
  assert.equal(bracketBox(at, 0, { still: true }).R, 18, 'reduced motion: at its final size');
  // The note: up and right of the brackets, 16 px off; flipped near an edge; clear of the other marks.
  assert.deepEqual(notePlace(at, 18, 360, 100, { W: 1368, H: 912 }), { x: 434, y: 166 });
  assert.deepEqual(notePlace({ x: 1300, y: 60, r: 10 }, 18, 360, 100, { W: 1368, H: 912 }), { x: 906, y: 94 });
  const avoid = [{ left: 500, top: 150, right: 540, bottom: 190 }];
  const p = notePlace(at, 18, 360, 100, { W: 1368, H: 912, avoid });
  assert.ok(!(p.x < 540 && p.x + 360 > 500 && p.y < 190 && p.y + 100 > 150), 'not over another marked node');
  // A pin: 48 px right of the node, centred on it; flipped left at the right edge; below an earlier one.
  assert.deepEqual(pinPlace(at, 320, 120, { W: 1368, H: 912 }), { x: 448, y: 240, side: 'right' });
  assert.equal(pinPlace({ x: 1200, y: 300 }, 320, 120, { W: 1368, H: 912 }).x, 1200 - 48 - 320);
  const first = { left: 448, top: 240, right: 768, bottom: 360 };
  assert.equal(pinPlace({ x: 400, y: 320, r: 10 }, 320, 120, { W: 1368, H: 912, above: [first] }).y, 368);
  for (const [W, H] of [[759, 912], [1271, 912], [1368, 912]]) {
    for (const x of [0, W / 2, W]) {
      const q = pinPlace({ x, y: 456 }, 320, 240, { W, H });
      assert.ok(q.x >= 16 && q.x + 320 <= W - 16, `${W}: the pin 16 px inside at x ${x}`);
      const nq = notePlace({ x, y: 456, r: 6 }, 14, 360, 120, { W, H });
      assert.ok(nq.x >= 16 && nq.x + 360 <= W - 16, `${W}: the note 16 px inside at x ${x}`);
    }
  }
  assert.deepEqual(leaderOf(at, { x: 448, y: 240, side: 'right' }, 320, 120), { x1: 410, y1: 300, x2: 448, y2: 300 });
});

test('camera: a show flight takes the Map\'s 320-900 ms by distance (D68); fitPose keeps every point inside the box with the pad', () => {
  const shot = (x, z, d) => ({ pos: { x, y: d * 0.8, z: z + d * 0.6 }, look: { x, y: 0, z } });
  const near = showFlightMs(shot(0, 0, 500), shot(10, 0, 500));
  const far = showFlightMs(shot(0, 0, 500), shot(6000, 4000, 300));
  assert.ok(near >= 320 && near <= 900, `${near}`);
  assert.ok(far >= 320 && far <= 900, `${far}`);
  assert.ok(far > near);
  assert.equal(showFlightMs(null, shot(0, 0, 1)), 900);
  const pts = [{ x: -800, y: 0, z: 200 }, { x: 900, y: 0, z: -300 }, { x: 100, y: 0, z: 700 }];
  const W = 1368, H = 912, fov = 50, pad = 64;
  const box = { x0: 0, y0: 0, x1: 0.7, y1: 0.75 };
  const pose = fitPose(pts, shot(0, 0, 3000), { fov, W, H, padPx: pad, box, minDist: 100, maxDist: 1e5 });
  // Project each point with the same camera (lookAt, +y up) and check it lands inside the box less the pad.
  const f = norm(sub(pose.look, pose.pos)), r = norm({ x: -f.z, y: 0, z: f.x }), u = cross(r, f);
  const t = Math.tan((fov * Math.PI) / 360);
  for (const p of pts) {
    const v = sub(p, pose.pos), z = dot(v, f);
    const sx = ((dot(v, r) / (z * t * (W / H))) + 1) / 2 * W, sy = (1 - dot(v, u) / (z * t)) / 2 * H;
    assert.ok(sx >= pad - 0.5 && sx <= box.x1 * W - pad + 0.5, `x ${sx}`);
    assert.ok(sy >= pad - 0.5 && sy <= box.y1 * H - pad + 0.5, `y ${sy}`);
  }
  assert.equal(fitPose([], null), null);
  const close = fitPose([{ x: 0, y: 0, z: 0 }], null, { minDist: 250 });
  assert.ok(Math.abs(Math.hypot(close.pos.x - close.look.x, close.pos.y - close.look.y, close.pos.z - close.look.z) - 250) < 1e-6, 'never nearer than minDist');
});
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

// ---- createShow: the page's part, over fake camera ops ----

/** An element whose listeners run (fakedom's are no-ops). */
function liveEl(tag) {
  const el = makeEl(tag);
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.removeEventListener = (type, fn) => on.get(type)?.delete(fn);
  el.dispatch = (type, extra = {}) => {
    const ev = { type, stopped: false, prevented: false, ...extra, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  el.replaceChildren = (...kids) => { el.children.length = 0; el.append(...kids); };
  return el;
}

function page({ still = false } = {}) {
  let now = t0, blocked = false, wall = 'tour';
  const calls = [];
  const sent = [];
  const marks = liveEl('div');
  const shows = createShow({
    marks, still, doc: { createElement: (tag) => liveEl(tag) }, clock: () => now, time: () => 1793080932210,
    blocked: () => blocked,
    send: (m, reply) => sent.push({ m, reply }),
    screenOf: (id) => (KNOWN.has(id) ? { x: 400, y: 300, r: 8 } : null),
    size: () => ({ W: 1368, H: 912 }),
    ops: {
      camera: () => `cam@${now}`, wall: () => wall, moving: () => false, known: (id) => KNOWN.has(id), inSight: () => false,
      fly: (...a) => calls.push(['fly', ...a]), fit: (...a) => calls.push(['fit', ...a]), stay: (...a) => calls.push(['stay', ...a]),
      restore: (saved) => calls.push(['restore', saved]),
    },
  });
  const kids = (cls) => marks.children.filter((c) => c.classList.contains(cls));
  return {
    shows, marks, calls, sent, kids, at: (ms) => { now = t0 + ms; }, finger: (v) => { blocked = v; }, setWall: (w) => { wall = w; },
  };
}

test('createShow: show messages in, show.result out with seq on the road they came by; marks, note and pins as text', () => {
  const p = page();
  assert.equal(p.marks.hidden, true, 'nothing shown');
  const road = () => {};
  const fly = show('fly_to', { node: 'hv2-a' });
  p.shows.receive(fly, road);
  assert.deepEqual(p.calls.at(-1), ['fly', 'hv2-a', fly.showId]);
  assert.deepEqual(p.sent.at(-1), { m: { type: 'show.result', showId: fly.showId, state: 'shown', seq: 1 }, reply: road });
  const hi = show('highlight', { nodes: ['hv1', 'hv2'], note: 'same task failed twice <b>here</b>' });
  p.shows.receive(hi);
  assert.equal(p.sent.at(-1).reply, null, 'no road: the transport broadcasts');
  assert.equal(p.sent.at(-1).m.seq, 2);
  const marks = p.kids('galaxy-show-mark');
  assert.deepEqual(marks.map((m) => m.dataset.node), ['hv1', 'hv2']);
  assert.ok(marks.every((m) => 'showMark' in m.dataset && m.children.length === 4), 'four corners each');
  const [note] = p.kids('galaxy-show-note');
  assert.ok('showNote' in note.dataset);
  assert.equal(note.textContent, `AGENT · ${clockText(1793080932210)}same task failed twice <b>here</b>`);
  assert.equal(note.children[1].children.length, 0, 'the note is text, no element in it');
  p.shows.receive(show('pin', { node: 'db', card: { block: 'text', title: 'disk', body: 'full in 2 h' } }));
  const [pin] = p.kids('galaxy-pin');
  assert.ok('pin' in pin.dataset);
  assert.equal(pin.dataset.node, 'db');
  const x = pin.children[0].children[1];
  assert.equal(x.tagName, 'BUTTON');
  assert.equal(x.textContent, '✕');
  assert.equal(x.getAttribute('aria-label'), 'Remove pin');
  assert.ok('pinRemove' in x.dataset);
  assert.match(pin.style.transform, /^translate3d\(/, 'drawn beside its node');
  assert.equal(p.marks.hidden, false);
  // The pin's ✕: gone here at once, pin.close to the room; a press on the card never reaches the stage.
  assert.equal(pin.dispatch('pointerdown').stopped, true);
  x.dispatch('click');
  assert.equal(p.kids('galaxy-pin').length, 0);
  assert.deepEqual(p.sent.at(-1).m, { type: 'pin.close', pin: pin.dataset.pinId, seq: 4 });
  // The test handle's view.
  const v = p.shows.view();
  assert.deepEqual(v.highlight, { showId: hi.showId, nodes: ['hv1', 'hv2'], note: 'same task failed twice <b>here</b>' });
  assert.equal(v.undoable, hi.showId);
  assert.equal(v.results.length, 4);
  assert.equal(p.shows.emphasis('hv1'), 1);
});

test('createShow: the finger rule through tick(); show.undo restores; the tour back clears; compare is unsupported', () => {
  const p = page();
  p.finger(true);
  const fly = show('fly_to', { node: 'hv1' });
  p.shows.receive(fly);
  assert.deepEqual(p.sent.map((s) => s.m.state), ['waiting']);
  assert.equal(p.calls.length, 0);
  p.at(2000);
  p.shows.tick();
  assert.equal(p.calls.length, 0);
  p.finger(false);
  p.shows.tick();
  assert.deepEqual(p.sent.map((s) => s.m.state), ['waiting', 'shown']);
  assert.deepEqual(p.calls.at(-1), ['fly', 'hv1', fly.showId]);
  // Undo: the camera and the wall state saved before it, through ops.restore.
  p.shows.receive({ type: 'show.undo', showId: fly.showId });
  assert.deepEqual(p.calls.at(-1), ['restore', { camera: `cam@${t0 + 2000}`, wall: 'tour', highlight: null }]);
  // A highlight, then the tour comes back: marks and undo go.
  p.setWall('explore');
  p.shows.receive(show('highlight', { nodes: ['hv1'] }));
  assert.equal(p.kids('galaxy-show-mark').length, 1);
  p.shows.tourBack();
  assert.equal(p.kids('galaxy-show-mark').length, 0);
  assert.equal(p.shows.view().undoable, null);
  p.shows.receive(show('compare', { a: 'hv1', b: 'hv2' }));
  assert.deepEqual([p.sent.at(-1).m.state, p.sent.at(-1).m.why], ['skipped', 'unsupported']);
  // Not ours: nothing.
  const n = p.sent.length;
  p.shows.receive({ type: 'show.result', showId: 'x', state: 'shown' });
  p.shows.receive({ type: 'turn.end' });
  assert.equal(p.sent.length, n);
});

test('createShow: a node out of sight hides its card and brackets; a pin keeps off the page\'s controls', () => {
  const el = (tag) => { const e = makeEl(tag); e.replaceChildren = (...k) => { e.children.length = 0; e.append(...k); }; return e; };
  const marks = el('div');
  const at = { hv1: { x: 700, y: 120, r: 8 }, hv2: { x: 300, y: -40, r: 8 } };
  const shows = createShow({
    marks, doc: { createElement: el }, clock: () => t0, screenOf: (id) => at[id] ?? null, size: () => ({ W: 759, H: 912 }),
    avoid: () => [{ left: 600, top: 130, right: 743, bottom: 218 }], // ▶ TOUR at 759 px
    ops: { known: (id) => id in at },
  });
  shows.receive(show('pin', { node: 'hv1', card: { body: 'x' } }));
  shows.receive(show('pin', { node: 'hv2', card: { body: 'y' } }));
  const [p1, p2] = marks.children.filter((c) => c.classList.contains('galaxy-pin'));
  assert.equal(p2.hidden, true, 'hv2 is above the stage: its card hides, not clamped on screen');
  assert.equal(p1.hidden, false);
  const y = Number(p1.style.transform.match(/translate3d\([\d.-]+px, ([\d.-]+)px/)[1]);
  assert.ok(y >= 218, `below the control (${y})`);
});

test('createShow: the note keeps off the site names (names()) as off the marked nodes', () => {
  const el = (tag) => { const e = makeEl(tag); e.replaceChildren = (...k) => { e.children.length = 0; e.append(...k); }; return e; };
  const marks = el('div');
  const at = { hv1: { x: 600, y: 400, r: 8 } };
  // A site name right where the note goes first (up and to the right of the brackets).
  const name = { left: 620, top: 220, right: 760, bottom: 380 };
  const shows = createShow({
    marks, doc: { createElement: el }, clock: () => t0, screenOf: (id) => at[id] ?? null, size: () => ({ W: 1368, H: 912 }),
    names: () => [name], ops: { known: (id) => id in at, inSight: () => true },
  });
  shows.receive(show('highlight', { nodes: ['hv1'], note: 'look here' }));
  const [note] = marks.children.filter((c) => c.classList.contains('galaxy-show-note'));
  const [x, y] = note.style.transform.match(/translate3d\(([\d.-]+)px, ([\d.-]+)px/).slice(1).map(Number);
  const w = SHOW.noteW, h = 80;
  const hits = x < name.right && x + w > name.left && y < name.bottom && y + h > name.top;
  assert.equal(hits, false, `the note (${x}, ${y}) is off the name`);
});

test('createFingerWatch: blocked while a finger is down and 3 s after the last lift; a press on a pin does not count', () => {
  let now = 0;
  const stage = liveEl('div');
  const w = createFingerWatch(stage, { clock: () => now, ignore: (ev) => ev.onPin === true });
  assert.equal(w.blocked(), false);
  stage.dispatch('pointerdown', { pointerId: 1 });
  now = 5000;
  assert.equal(w.blocked(), true, 'held');
  stage.dispatch('pointerup', { pointerId: 1 });
  now = 7999;
  assert.equal(w.blocked(), true);
  now = 8000;
  assert.equal(w.blocked(), false);
  stage.dispatch('pointerdown', { pointerId: 2, onPin: true });
  assert.equal(w.blocked(), false, 'a pin is not the galaxy');
  stage.dispatch('pointerup', { pointerId: 2 });
  assert.equal(w.blocked(), false);
  stage.dispatch('wheel', {});
  assert.equal(w.blocked(), true, 'a wheel turn is a touch');
});

test('galaxy.html has the show layers; wall.css draws the D72 looks; main.js wires show, finger rule, transport and the handle', () => {
  const html = read('galaxy.html');
  assert.match(html, /<canvas class="galaxy-show-veil" id="galaxy-show-veil" aria-hidden="true" hidden><\/canvas>/);
  assert.match(html, /<div class="galaxy-show-marks" id="galaxy-show-marks" hidden><\/div>/);
  assert.doesNotMatch(html, /id="galaxy-show"/, 'no SHOWN BY rows');
  assert.ok(html.indexOf('id="galaxy-labels"') < html.indexOf('id="galaxy-show-veil"'), 'the veil dims the names too');
  assert.ok(html.indexOf('id="galaxy-show-veil"') < html.indexOf('id="wall-frame"'), 'not the Wall\'s words');
  assert.ok(html.indexOf('id="galaxy-show-marks"') < html.indexOf('id="wall-caption"'), 'the marks under the caption');
  const css = read('css/wall.css');
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.>]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.galaxy-show-mark > i'), /width: 12px;[^]*height: 12px;[^]*border: 0 solid var\(--accent\);/);
  assert.match(css, /\.galaxy-show-mark > \.tl \{ top: 0; left: 0; border-top-width: 2px; border-left-width: 2px; \}/);
  assert.match(rule('.galaxy-show-note'), /max-width: 360px;[^]*padding: 16px;/);
  assert.match(rule('.galaxy-show-note,\n.galaxy-pin'), /background: color-mix\(in oklch, var\(--bg-elevated\) 99%, transparent\);[^]*border: 1px solid var\(--line-strong\);/);
  assert.match(rule('.galaxy-show-who'), /font-size: 16px;[^]*text-transform: uppercase;[^]*color: var\(--text-3\);/);
  assert.match(rule('.galaxy-show-note-text'), /font-size: 20px;[^]*color: var\(--text-1\);[^]*-webkit-line-clamp: 3;/);
  assert.match(css, /\n\.galaxy-pin \{\n  width: 320px;\n  max-height: 240px;/);
  assert.match(rule('.galaxy-pin-head'), /height: 48px;[^]*padding-left: 16px;/);
  assert.match(rule('.galaxy-pin-remove'), /width: 48px;[^]*height: 48px;[^]*font-size: 24px;[^]*color: var\(--text-2\);/);
  assert.match(rule('.galaxy-pin-title'), /font-size: 20px;/);
  assert.match(rule('.galaxy-pin-body'), /font-size: 18px;/);
  assert.match(rule('.galaxy-pin-leader'), /height: 1px;[^]*background: var\(--line-strong\);/);
  assert.doesNotMatch(css, /\.galaxy-show-row|\.galaxy-show-x|\.galaxy-show-ring/);
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /const shows = park \? null : createShow\(\{/);
  assert.match(js, /createFingerWatch\(stage, \{ ignore: \(ev\) => Boolean\(ev\.target\?\.closest\?\.\('\[data-pin\]'\)\) \}\)/);
  assert.match(js, /shows\?\.tick\(\)/);
  assert.match(js, /shows\?\.tourBack\(\)/);
  assert.match(js, /cam\.onDraw\(shows\.draw\)/);
  assert.match(js, /touch\?\.explore\(performance\.now\(\) \+ ms\)/, 'a show explores until its movement ends');
  assert.match(js, /showFlightMs\(cam\.pose\(\), cam\.shotFor\(to\)\)/, 'the Map\'s flight time');
  assert.match(js, /page\.dataset\.wallState = ws/, 'data-wall-state on the root (W1)');
  assert.match(js, /globalThis\.__cockpitView = \{/);
  for (const k of ['flyTo', 'fitNodes', 'camera: cameraNow', 'setCamera', 'screenOf', 'onDraw', 'emphasis']) assert.ok(js.includes(k), k);
  assert.doesNotMatch(js, /shows\?\.drop\(\)/, 'a touch no longer wipes what the agent drew');
  // Words are text only: show.js never writes markup.
  assert.doesNotMatch(read('js/wall/galaxy/show.js'), /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('main.js: an undo of a command made while touring hands the page back with the overview (c4 §5, screens.md §2); the note keeps off site names', () => {
  const js = read('js/wall/galaxy/main.js');
  // Every hand-back but `▶ TOUR` starts with the overview (screens.md §2, W4; cockpit build B239), an undo's too.
  assert.match(js, /if \(saved\.wall === 'tour'\) \{\s*touch\?\.handBack\(\);/);
  assert.match(js, /tour\.resume\(\{ overview: !nextLeg \}\)/);
  assert.match(js, /nextLeg = true;\s*try \{ touch\?\.handBack\(\); \} finally \{ nextLeg = false; \}/);
  assert.match(js, /names: \(\) => labels\.shown\(\)\.filter/);
});
