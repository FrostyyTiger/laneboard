// T9 (runs plan §3 A3): a run is a Map node (docs/map.md "Runs"), under the
// core or under the machine its `run.start` names in `host`; a throwaway VM a
// feed lists carries its run, and the run falls back to the core when the
// feed no longer lists it. No runs, no run nodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFleet } from '../server/map.mjs';
import { runNodes, runProgress } from '../server/map/runs.mjs';
import { parseLine, foldRun } from '../server/runs/protocol.mjs';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** Fold a run from event objects (each gets v, run and a ts if missing). */
function fold(run, list) {
  const events = list.map((o, i) => {
    const r = parseLine(JSON.stringify({ v: 1, run, ts: NOW - (list.length - i) * MIN, ...o }));
    assert.equal(r.ok, true, JSON.stringify(o));
    return r.event;
  });
  return foldRun(events);
}

const running = (extra = {}) => fold('acme-search', [
  { t: 'run.start', goal: 'Add paged search to acme-api', budget: { rounds: 10 }, ...extra },
  { t: 'round.start', n: 1, role: 'builder', task: 'T1' },
  { t: 'round.end', n: 1, outcome: 'done' },
  { t: 'round.start', n: 2, role: 'builder', task: 'T2' },
]);

const scratchFeed = () => ({
  source: 'hv1', at: NOW,
  host: { name: 'hv1', status: 'online' },
  guests: [{ vmid: 120, name: 'scratch-1', type: 'qemu', status: 'running' }],
});
const feeds = (...list) => new Map(list.map((f) => [f.source, f]));
const runNode = (m) => m.nodes.find((n) => n.kind === 'run');

test('no runs: no run nodes, the rest of the model unchanged', () => {
  const base = buildFleet({ topology: null, feeds: feeds(scratchFeed()), now: NOW, hostname: 'builder-a' });
  const none = buildFleet({ topology: null, feeds: feeds(scratchFeed()), now: NOW, hostname: 'builder-a', runs: [] });
  assert.equal(none.nodes.filter((n) => n.kind === 'run').length, 0);
  assert.deepEqual(none.nodes, base.nodes);
  assert.deepEqual(none.links, base.links);
  assert.deepEqual(runNodes(null), []);
});

test('a running run hangs on the core with its progress, round and link', () => {
  const m = buildFleet({ topology: null, now: NOW, hostname: 'builder-a', runs: [running()] });
  const n = runNode(m);
  assert.equal(n.id, 'run:acme-search');
  assert.equal(n.parent, '__core');
  assert.equal(n.status, 'working');
  assert.equal(n.state, 'running');
  assert.equal(n.round, 2);
  assert.equal(n.maxRounds, 10);
  assert.equal(n.progress, 0.2, 'rounds / budget.rounds');
  assert.equal(n.stuck, null);
  assert.equal(n.goal, 'Add paged search to acme-api');
  assert.equal(n.href, '#/runs?run=acme-search');
  assert.equal(n.detail.Round, '2 / 10');
});

test('progress: the tasks score over its max beats rounds; none without either', () => {
  const r = fold('acme-tasks', [
    { t: 'run.start', goal: 'g', budget: { rounds: 10 } },
    { t: 'round.start', n: 1 },
    { t: 'score', name: 'tasks', value: 3, max: 12 },
    { t: 'score', name: 'tests', value: 400 },
  ]);
  assert.equal(runProgress(r), 0.25);
  assert.equal(runProgress(fold('x', [{ t: 'run.start', goal: 'g' }, { t: 'round.start', n: 1 }])), null);
  // A tasks score without max falls back to rounds; values past max are clamped.
  assert.equal(runProgress(fold('y', [{ t: 'run.start', budget: { rounds: 4 } }, { t: 'round.start', n: 1 }, { t: 'score', name: 'tasks', value: 3 }])), 0.25);
  assert.equal(runProgress(fold('z', [{ t: 'run.start' }, { t: 'score', name: 'tasks', value: 20, max: 12 }])), 1);
  // a wrap-up round after the stop does not move the ring past the rounds done (T4)
  assert.equal(runProgress(fold('w', [{ t: 'run.start', budget: { rounds: 2 } }, { t: 'round.start', n: 1 }, { t: 'round.start', n: 2 },
    { t: 'run.stop', reason: 'rounds' }, { t: 'round.start', n: 3, wrapup: true }])), 1);
  assert.equal(runProgress(fold('v', [{ t: 'run.start', budget: { rounds: 4 } }, { t: 'round.start', n: 1 }, { t: 'run.stop', reason: 'x' }, { t: 'round.start', n: 2, wrapup: true }])), 0.25);
  assert.equal(runProgress(fold('w', [{ t: 'run.start' }, { t: 'score', name: 'tasks', value: 0, max: 12 }])), 0);
});

test('a run on a discovered VM hangs under it, and falls back to the core when the feed drops the VM', () => {
  const run = running({ host: 'SCRATCH-1' });
  const on = buildFleet({ topology: null, feeds: feeds(scratchFeed()), now: NOW, hostname: 'builder-a', runs: [run] });
  const vm = on.nodes.find((n) => n.label === 'scratch-1');
  assert.ok(vm?.discovered, 'the VM is a discovered node');
  assert.equal(runNode(on).parent, vm.id);
  assert.equal(runNode(on).detail.Host, 'SCRATCH-1');

  const gone = { ...scratchFeed(), guests: [] };
  const off = buildFleet({ topology: null, feeds: feeds(gone), now: NOW, hostname: 'builder-a', runs: [run] });
  assert.equal(off.nodes.find((n) => n.label === 'scratch-1'), undefined, 'the VM left with its feed line');
  assert.equal(runNode(off).parent, '__core');
  assert.equal(runNode(off).detail.Host, 'SCRATCH-1 (not on the Map)');
});

test('a declared core takes runs without a host', () => {
  const topology = { title: 'acme', self: null, nodes: [{ id: 'home', kind: 'core', label: 'hub' }], links: [], lanes: { show: 'active', links: [] } };
  const m = buildFleet({ topology, now: NOW, hostname: 'builder-a', runs: [running()] });
  assert.equal(runNode(m).parent, 'home');
});

test('a stopped run stays mapKeepMin minutes, then leaves; error stops are crit', () => {
  const ev = (o) => parseLine(JSON.stringify({ v: 1, run: 'acme-done', ...o })).event;
  const stopped = (reason, ago) => foldRun([
    ev({ t: 'run.start', goal: 'g', budget: { rounds: 5 }, ts: NOW - 120 * MIN }),
    ev({ t: 'round.start', n: 1, ts: NOW - 110 * MIN }),
    ev({ t: 'run.stop', reason, ts: NOW - ago }),
  ]);
  const recent = runNodes([stopped('done', 10 * MIN)], { now: NOW, keepMin: 60 });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].status, 'idle');
  assert.equal(recent[0].why, 'stopped: done');
  assert.equal(runNodes([stopped('done', 61 * MIN)], { now: NOW, keepMin: 60 }).length, 0);
  assert.equal(runNodes([stopped('done', 0)], { now: NOW, keepMin: 0 }).length, 0, '0 = leaves when it stops');
  assert.equal(runNodes([stopped('error', MIN)], { now: NOW, keepMin: 60 })[0].status, 'crit');
});

test('a stuck run carries the rule and the warn status; runs.stuck false turns it off', () => {
  const late = running({ deadline: new Date(NOW - 5 * MIN).toISOString() });
  const [n] = runNodes([late], { now: NOW });
  assert.equal(n.status, 'warn');
  assert.equal(n.stuck.rule, 'deadline');
  assert.equal(n.why, n.stuck.reason);
  const [off] = runNodes([late], { now: NOW, stuck: false });
  assert.equal(off.stuck, null);
  assert.equal(off.status, 'working');
});

test('a topology node cannot take a run: id', async () => {
  const { parseTopology, TopologyError } = await import('../server/map.mjs');
  assert.throws(() => parseTopology({ nodes: [{ id: 'run:x', kind: 'room' }] }), TopologyError);
});

test('GET /api/map on a builder that reads a run file has the run node', async (t) => {
  const { boot } = await import('./helpers/boot.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-map-runs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.jsonl');
  const now = Date.now();
  fs.writeFileSync(file, [
    { t: 'run.start', goal: 'Add paged search to acme-api', budget: { rounds: 4 }, ts: now - 2 * MIN },
    { t: 'round.start', n: 1, ts: now - MIN },
  ].map((o) => JSON.stringify({ v: 1, run: 'acme-search', ...o })).join('\n') + '\n');
  const b = await boot({ config: { fleet: { id: 'builder-a' }, runs: { files: [file], lanes: false } } });
  try {
    let node;
    for (let i = 0; i < 80 && !node; i++) {
      const m = await (await fetch(`${b.url}/api/map`)).json();
      node = m.nodes.find((n) => n.id === 'run:acme-search');
      if (!node) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(node, 'the run node shows up');
    assert.equal(node.kind, 'run');
    assert.equal(node.progress, 0.25);
    assert.equal(node.parent, '__core');
  } finally {
    await b.stop();
  }
});

test('T5: the tasks score\'s latest max drives the ring, and the node carries the numbers its label prints', () => {
  const r = fold('acme-scope', [
    { t: 'run.start', goal: 'Grow the plan', budget: { rounds: 80 } },
    { t: 'round.start', n: 1, role: 'planner' },
    { t: 'score', n: 1, name: 'tasks', value: 0, max: 12 },
    { t: 'round.start', n: 2, role: 'builder' },
    { t: 'score', n: 2, name: 'tasks', value: 44, max: 63 },
    { t: 'round.start', n: 3, role: 'builder' },
    { t: 'score', n: 3, name: 'tasks', value: 45 },
  ]);
  const n = runNode(buildFleet({ topology: null, now: NOW, hostname: 'builder-a', runs: [r] }));
  assert.deepEqual(n.tasks, { value: 45, max: 63, firstMax: 12 }, 'a line without max keeps the latest max');
  assert.equal(n.progress, Math.round((45 / 63) * 100) / 100, 'tasks over max, not rounds over budget');
  assert.equal(runProgress(r), n.progress);
  assert.equal(n.detail.Tasks, '45 of 63 (scope 12 → 63)');
  const plain = runNode(buildFleet({ topology: null, now: NOW, hostname: 'builder-a', runs: [running()] }));
  assert.equal(plain.tasks, null);
  assert.equal(plain.detail.Tasks, undefined);
});
