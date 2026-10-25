// The Wall's caption (Wall plan T6, docs/plans/wall/README.md §3): what the
// plate says for a calm site, a site in trouble and a node without detail,
// and that its beats fit the tour's legs at both speeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionLines, captionSchedule, captionTimingFor, CAPTION_TIMING, DEMO_CAPTION_TIMING,
  MAX_LINES, MAX_TEXT,
} from '../public/js/wall/caption.js';
import { TIMING, DEMO_TIMING } from '../public/js/wall/tour.js';

/** Two sites as the large demo has them: hv1 calm, hv2 with a full pool. */
function model() {
  return {
    nodes: [
      { id: '__core', kind: 'core', status: 'ok' },
      {
        id: 'lab', parent: '__core', kind: 'site', label: 'hv1', status: 'ok', sub: 'demo hypervisor · 128 GB',
        metrics: { cpu: 0.34, mem: 0.62, disk: 0.48 }, detail: { Where: 'rack 1', Hardware: '2× 16-core · 128 GB' },
      },
      { id: 'room-a', parent: 'lab', kind: 'room', label: 'vm-a', status: 'ok', detail: { ID: 101, Uptime: '240h' } },
      { id: 'room-b', parent: 'lab', kind: 'room', label: 'vm-b', status: 'ok' },
      { id: 'svc-a', parent: 'room-a', kind: 'service', label: 'web', status: 'working' },
      { id: 'host-a', parent: 'lab', kind: 'host', label: 'nas', status: 'ok' },
      {
        id: 'hv2', parent: '__core', kind: 'site', label: 'hv2', status: 'ok',
        metrics: { cpu: 0.41, mem: 0.71 }, detail: { Hardware: '24-core · 192 GB · 1 GPU', Where: 'rack 2', Power: '310 W', Fans: 'quiet' },
      },
      { id: 'storage', parent: 'hv2', kind: 'room', label: 'storage', status: 'crit', why: 'pool 97% full' },
      { id: 'media', parent: 'hv2', kind: 'room', label: 'media', status: 'warn', why: 'transcode queue' },
      { id: 'gpu-box', parent: 'hv2', kind: 'room', label: 'gpu-box', status: 'ok' },
    ],
  };
}
const node = (m, id) => m.nodes.find((n) => n.id === id);

test('caption: a calm site says calm, in grey, with its metrics, facts and what it holds', () => {
  const m = model();
  const c = captionLines(node(m, 'lab'), m, 2, 5);
  assert.equal(c.kicker, 'TARGET 02 / 05 · SITE');
  assert.equal(c.name, 'HV1');
  assert.equal(c.status, 'ok');
  assert.deepEqual(c.lines.map((l) => l.kind), ['status', 'metrics', 'fact', 'fact', 'count']);
  assert.ok(!c.lines.some((l) => l.kind === 'trouble'), 'no trouble line when calm');
  assert.equal(c.lines[0].text, 'ok · all 4 calm');
  assert.deepEqual(c.lines[1].bars, [
    { label: 'cpu', value: 0.34, text: '34%' },
    { label: 'mem', value: 0.62, text: '62%' },
  ]);
  // hardware before where (the plan's order), whatever order the detail had
  assert.deepEqual(c.lines.filter((l) => l.kind === 'fact').map((l) => [l.label, l.text]), [
    ['hardware', '2× 16-core · 128 GB'], ['where', 'rack 1'],
  ]);
  assert.equal(c.lines.at(-1).text, '2 rooms · 1 host');
  assert.ok(c.lines.length >= 3 && c.lines.length <= MAX_LINES);
});

test('caption: a site in trouble leads with its worst problem, in its status colour and shape', () => {
  const m = model();
  const c = captionLines(node(m, 'hv2'), m, 1, 5);
  assert.equal(c.kicker, 'TARGET 01 / 05 · SITE');
  assert.equal(c.status, 'crit');
  const [first] = c.lines;
  assert.deepEqual(
    { kind: first.kind, label: first.label, text: first.text, tone: first.tone, shape: first.shape, glyph: first.glyph },
    { kind: 'trouble', label: 'storage', text: 'pool 97% full', tone: 'crit', shape: 'square', glyph: '■' },
  );
  assert.equal(c.lines[1].text, 'crit · 2 of 3 in trouble');
  // never more than six lines: the extra facts give way, the count stays last
  assert.equal(c.lines.length, MAX_LINES);
  assert.equal(c.lines.at(-1).kind, 'count');
  assert.equal(c.lines.at(-1).text, '3 rooms');
  assert.deepEqual(c.lines.filter((l) => l.kind === 'fact').map((l) => l.label), ['hardware', 'where']);

  // a warn alone shows the triangle in the warn tone; attention reads as warn too
  const w = model();
  node(w, 'storage').status = 'ok';
  const cw = captionLines(node(w, 'hv2'), w);
  assert.equal(cw.lines[0].glyph, '▲');
  assert.equal(cw.lines[0].tone, 'warn');
  node(w, 'media').status = 'attention';
  assert.equal(captionLines(node(w, 'hv2'), w).lines[0].tone, 'warn');

  // a node in trouble itself names its own status and why
  const own = captionLines(node(m, 'storage'), m, 3, 5);
  assert.equal(own.kicker, 'TARGET 03 / 05 · ROOM');
  assert.equal(own.lines[0].label, 'crit');
  assert.equal(own.lines[0].text, 'pool 97% full');
});

test('caption: a node without detail or metrics still gives a status line, nothing undefined', () => {
  const m = model();
  const c = captionLines(node(m, 'room-b'), m);
  assert.equal(c.kicker, 'ROOM', 'no target number without an index');
  assert.equal(c.name, 'VM-B');
  assert.deepEqual(c.lines.map((l) => l.kind), ['status']);
  assert.equal(c.lines[0].text, 'ok');
  for (const l of c.lines) assert.doesNotMatch(JSON.stringify(l), /undefined|null|NaN/);

  // a node the model does not hold, with odd data: status and sub only
  const stray = captionLines({ id: 'x', status: 'unknown', sub: 'no feed', metrics: { cpu: 'high', mem: -1 }, detail: [1, 2] }, m);
  assert.equal(stray.kicker, 'NODE');
  assert.equal(stray.name, 'X');
  assert.deepEqual(stray.lines, [{ kind: 'status', label: 'status', text: 'unknown · no feed' }]);
  assert.deepEqual(captionLines(null, null).lines.map((l) => l.kind), ['status']);
});

test('caption: long values are clipped so the plate keeps its width', () => {
  const m = model();
  node(m, 'storage').why = 'pool '.repeat(30);
  const t = captionLines(node(m, 'hv2'), m).lines[0].text;
  assert.ok(t.length <= MAX_TEXT, t);
  assert.ok(t.endsWith('…'));
  assert.equal(captionLines({ id: 'y', label: 'a'.repeat(80) }, m).name.length, MAX_TEXT);
});

test('caption: every beat fits the tour leg, and the plate is then still for the reading', () => {
  for (const [timing, tour, demo] of [[CAPTION_TIMING, TIMING, false], [DEMO_CAPTION_TIMING, DEMO_TIMING, true]]) {
    assert.equal(captionTimingFor(demo), timing);
    const leg = { arriveMs: tour.flyMs, ms: tour.flyMs + tour.holdMs };
    const s = captionSchedule(leg, 'OFFICE-PRINTER', MAX_LINES, timing);
    assert.ok(s.startMs >= 0 && s.startMs <= leg.arriveMs, 'starts by the arrival');
    assert.ok(s.nameAt > s.startMs && s.nameDoneAt > s.nameAt, 'plate, then the name');
    assert.ok(s.lineAt[0] >= s.nameDoneAt, 'lines after the name');
    assert.ok(s.lineAt.every((t, i) => i === 0 || t > s.lineAt[i - 1]), 'one line at a time');
    // research Q1: everything in by ~1.5-2 s after the plate
    assert.ok(s.doneAt - s.startMs <= 2000, `in by 2 s (${s.doneAt - s.startMs} ms)`);
    // still for the reading before the camera leaves: 3 s at normal speed, a beat in the demo
    assert.ok(leg.ms - s.doneAt >= (demo ? 500 : 3000), `still for ${leg.ms - s.doneAt} ms`);
  }
  // normal speed waits for the camera (Q1: arrive, then type)
  assert.equal(captionSchedule({ arriveMs: 2250 }, 'HV1', 3).startMs, 2250);
  assert.deepEqual(captionSchedule({}, '', 0, CAPTION_TIMING).lineAt, []);
});
