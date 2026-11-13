// Network, "the wire" (docs/network.md): the model from the Runs read, the
// boxes it draws, the link from a run page to its host and back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import * as fake from '../server/engine/fake.mjs';
import { runsBody } from '../server/routes/engines.mjs';
import { hostHref, layoutWires, networkModel, renderNetwork } from '../public/js/views/network.js';
import { newPage, renderEnginePage, statusLine, toListRow } from '../public/js/views/runs-engine.js';
import { parseHash } from '../public/js/core/router.js';

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}
const NOW = Date.parse('2026-11-01T12:00:00Z');

async function demo() {
  const b = await runsBody([fake.create({ id: 'main' })]);
  return { engines: b.engines, rows: b.runs.map(toListRow) };
}

test('networkModel: reporting hosts from health, the foreman on the steady host (said to be a guess), live rooms in their host', async () => {
  const { engines, rows } = await demo();
  const m = networkModel(engines, rows, NOW);
  const ids = m.hosts.map((h) => h.id);
  assert.ok(ids.length >= 1);
  const fh = m.hosts.find((h) => h.foreman);
  assert.ok(fh, 'one host has the foreman');
  assert.equal(fh.role, 'steady');
  assert.equal(fh.foreman.guessed, true);
  assert.equal(fh.foreman.state, 'up');
  const live = m.hosts.flatMap((h) => h.live);
  assert.ok(live.length >= 1);
  for (const s of live) assert.match(s.key, /^main\//);
  assert.equal(m.you.needs, rows.filter((r) => r.engineState === 'at-gate' || r.engineState === 'waiting-approval' || r.waiting?.length).length);
  assert.equal(m.you.questions, engines.reduce((n, e) => n + (e.questions ?? 0), 0));
});

test('networkModel: a host named only by a run is known but not reporting; ended runs of the last day are pips', () => {
  const engines = [{ id: 'e', health: { foreman: 'up', beatAge: 1000, queue: 0, active: 1, hosts: [{ id: 'steady', role: 'steady', state: 'up', updatedAt: NOW - 1000 }] } }];
  const rows = [
    toListRow({ id: 'R1', key: 'e/R1', engine: 'e', state: 'running', name: 'P · build #1', rooms: [{ name: 'room-1', host: 'steady', state: 'up', purpose: 'run' }], startedAt: NOW - 3_600_000, lastSeq: 10 }),
    toListRow({ id: 'R2', key: 'e/R2', engine: 'e', state: 'done', stop: 'done', name: 'P · build #0', rooms: [{ name: 'room-0', host: 'laptop', state: 'ended' }], startedAt: NOW - 7_200_000, endedAt: NOW - 3_000_000 }),
  ];
  const m = networkModel(engines, rows, NOW);
  assert.deepEqual(m.hosts.map((h) => [h.id, h.reporting]), [['steady', true], ['laptop', false]]);
  assert.equal(m.hosts[0].live[0].room, 'room-1');
  assert.equal(m.hosts[1].ended.length, 1);
  assert.equal(m.hosts[1].strip.length, 1);
  assert.equal(m.hosts[0].strip[0].live, true);
});

test('networkModel: the foreman host foundry names wins over the steady guess', () => {
  const engines = [{ id: 'e', health: { foreman: 'up', host: 'vm-1', hosts: [{ id: 'steady', role: 'steady', state: 'up' }, { id: 'vm-1', role: 'heavy', state: 'up' }] } }];
  const m = networkModel(engines, [], NOW);
  const fh = m.hosts.find((h) => h.foreman);
  assert.deepEqual([fh.id, fh.foreman.guessed], ['vm-1', false]);
});

test('renderNetwork: you, the wire label, a box per host, a slot per live room linking to its run; the selected host marked', async () => {
  const { engines, rows } = await demo();
  const m = networkModel(engines, rows, NOW);
  withDom(() => {
    const sel = m.hosts[0].id;
    const root = renderNetwork(null, m, { sel, now: NOW });
    const t = texts(root).join(' | ');
    assert.match(t, /^Network \| \d+ hosts? reporting · \d+ known/);
    assert.match(t, /you \| owner/);
    assert.match(t, /tailnet \| links not reported yet/);
    assert.match(t, /Foreman · up/);
    assert.match(t, /here by its steady role/);
    const hosts = root.querySelectorAll('nw-host');
    assert.equal(hosts.length, m.hosts.length);
    assert.equal(hosts[0].getAttribute('aria-current'), 'true');
    const slots = root.querySelectorAll('nw-slot').filter((s) => s.dataset.run);
    assert.equal(slots.length, m.hosts.flatMap((h) => h.live).length);
    for (const s of slots) assert.match(s.href, /^#\/runs\?run=main%2F/);
    assert.ok(root.querySelectorAll('rn-glyph').length >= 1, 'a live build run shows its loop glyph');
    assert.equal(layoutWires(root), null, 'no layout, no wire (the browser draws it)');
  });
});

test('renderNetwork: no machine known says so', () => withDom(() => {
  const root = renderNetwork(null, { you: { needs: 0, questions: 0 }, hosts: [] }, { now: NOW });
  assert.match(texts(root).join(' '), /No machine is known yet/);
}));

test('the tie-in: #/network?sel=node:<host> selects a host; a run page links each host there; the foreman line too', () => {
  const r = parseHash('#/network?sel=node%3Aheavy-1');
  assert.deepEqual([r.view, r.sel], ['network', 'node:heavy-1']);
  assert.equal(hostHref('heavy-1'), '#/network?sel=node%3Aheavy-1');
  const run = { id: 'R', state: 'running', recipe: { kind: 'explore' }, rooms: [{ name: 'room', host: 'heavy-1', state: 'up' }], tree: [] };
  withDom(() => {
    const root = renderEnginePage(null, 'main/R', Object.assign(newPage(), { run }), { status: 'ok' }, 0);
    const a = root.querySelectorAll('rn-host')[0];
    assert.equal(a.href, '#/network?sel=node%3Aheavy-1');
  });
  const line = statusLine([{ id: 'main', health: { foreman: 'up', beatAge: 1000, hosts: [] } }], []);
  assert.equal(line.find((p) => p.key === 'foreman:main').href, '#/network');
});

test('networkModel: a blocked run whose room ended keeps its slot in that host', () => {
  const rows = [toListRow({ id: 'R', key: 'e/R', engine: 'e', state: 'at-gate', name: 'P · build #2', reason: 'blocked at G1.F1.T3 (build): x',
    rooms: [{ name: 'room-2', host: 'heavy', state: 'ended', purpose: 'run' }], startedAt: NOW - 3_600_000 })];
  const m = networkModel([], rows, NOW);
  assert.equal(m.hosts[0].live.length, 1);
  assert.equal(m.hosts[0].live[0].roomState, 'ended');
  assert.equal(m.hosts[0].live[0].blocked, true);
  assert.equal(m.hosts[0].ended.length, 0);
});
