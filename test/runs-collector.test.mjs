// The run-file collector and the runs store (docs/plans/runs/README.md §3 A1, T4):
// find the files, tail them by byte offset, fold into an in-memory map of runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createCollector, expandGlob, findFiles, readTail, parseTailLines, LANE_FILE,
} from '../server/collector/runs.mjs';
import { createStore } from '../server/runs/store.mjs';
import { parseLine, MAX_LINE } from '../server/runs/protocol.mjs';
import runsModule from '../server/routes/runs.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-runs-collector-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = () => {
  const d = path.join(tmp, `d${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const T0 = Date.now() - 60_000;
const ev = (run, t, extra = {}, ts = T0) => `${JSON.stringify({ v: 1, t, run, ts, ...extra })}\n`;
const append = (f, text) => fs.appendFileSync(f, text);
const collect = (opts) => createCollector({ discoverMs: 0, ...opts });

test('no config and no lane file: nothing is read, no runs', async () => {
  const c = collect({ cfg: { files: [], lanes: true, maxEvents: 5000, keepDays: 30 }, laneRoots: () => [dir()] });
  await c.tick();
  assert.deepEqual(c.files(), []);
  assert.deepEqual(c.store.list(), []);
  const none = collect({});
  await none.tick();
  assert.deepEqual(none.store.list(), []);
});

test('appended lines show up on the next tick', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, ev('r1', 'run.start', { goal: 'Make acme ready' }));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  let run = c.store.get('r1');
  assert.equal(run.goal, 'Make acme ready');
  assert.equal(run.rounds.length, 0);
  append(f, ev('r1', 'round.start', { n: 1, role: 'builder', task: 'T1' }) + ev('r1', 'round.end', { n: 1, outcome: 'kept', commit: 'abc1234' }));
  await c.tick();
  run = c.store.get('r1');
  assert.equal(run.rounds.length, 1);
  assert.equal(run.rounds[0].commit, 'abc1234');
  assert.equal(run.events, 3);
  await c.tick();
  assert.equal(c.store.get('r1').events, 3, 'nothing new: nothing added twice');
});

test('a half-written last line waits for its newline', async () => {
  const f = path.join(dir(), 'run.jsonl');
  const line = ev('r1', 'run.start', { goal: 'Half' });
  append(f, line.slice(0, 20));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  assert.equal(c.store.get('r1'), null);
  append(f, line.slice(20, -1));
  await c.tick();
  assert.equal(c.store.get('r1'), null, 'still no newline');
  append(f, '\n');
  await c.tick();
  const run = c.store.get('r1');
  assert.equal(run.goal, 'Half');
  assert.equal(run.skipped, 0);
});

test('a multi-byte character split across reads survives', async () => {
  const f = path.join(dir(), 'run.jsonl');
  const line = ev('r1', 'run.start', { goal: 'Zürich → hub' });
  const bytes = Buffer.from(line);
  const cut = bytes.indexOf(Buffer.from('ü')) + 1; // inside the two-byte ü
  fs.writeFileSync(f, bytes.subarray(0, cut));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  fs.appendFileSync(f, bytes.subarray(cut));
  await c.tick();
  assert.equal(c.store.get('r1').goal, 'Zürich → hub');
});

test('a truncated file starts over', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, ev('old', 'run.start', { goal: 'Old goal' }) + ev('old', 'round.start', { n: 1 }));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  assert.equal(c.store.get('old').rounds.length, 1);
  fs.truncateSync(f, 0);
  append(f, ev('new', 'run.start', { goal: 'New' }));
  await c.tick();
  assert.equal(c.store.get('old'), null, 'the old content is forgotten');
  assert.equal(c.store.get('new').goal, 'New');
  assert.deepEqual(c.store.list().map((r) => r.run), ['new']);
});

test('a replaced file (new inode, same or larger size) starts over', async () => {
  const d = dir();
  const f = path.join(d, 'run.jsonl');
  append(f, ev('r1', 'run.start', { goal: 'First' }));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  const g = path.join(d, 'next.jsonl');
  fs.writeFileSync(g, ev('r1', 'run.start', { goal: 'Second' }) + ev('r1', 'round.start', { n: 1 }));
  fs.renameSync(g, f);
  await c.tick();
  const run = c.store.get('r1');
  assert.equal(run.goal, 'Second');
  assert.equal(run.events, 2, 'the first file\'s line is gone');
});

test('two runs in one file are folded apart', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, [
    ev('alpha', 'run.start', { goal: 'A' }, T0),
    ev('beta', 'run.start', { goal: 'B' }, T0 + 1),
    ev('alpha', 'round.start', { n: 1 }, T0 + 2),
    ev('beta', 'score', { name: 'tests', value: 10 }, T0 + 3),
    ev('alpha', 'run.stop', { reason: 'done' }, T0 + 4),
  ].join(''));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  const a = c.store.get('alpha');
  const b = c.store.get('beta');
  assert.equal(a.goal, 'A');
  assert.equal(a.state, 'stopped');
  assert.equal(a.rounds.length, 1);
  assert.equal(b.goal, 'B');
  assert.equal(b.state, 'running');
  assert.deepEqual(b.scores.tests.map((s) => s.value), [10]);
  assert.deepEqual(c.store.list().map((r) => r.run), ['alpha', 'beta'], 'latest activity first');
});

test('one run written to two files is merged by time', async () => {
  const d = dir();
  const own = path.join(d, 'own.jsonl');
  const api = path.join(d, 'api.jsonl');
  append(own, ev('r1', 'run.start', { goal: 'G' }, T0) + ev('r1', 'round.start', { n: 2 }, T0 + 20));
  append(api, ev('r1', 'round.start', { n: 1 }, T0 + 10) + ev('r1', 'run.stop', { reason: 'done' }, T0 + 30));
  const c = collect({ cfg: { files: [own, api] } });
  await c.tick();
  const run = c.store.get('r1');
  assert.deepEqual(run.rounds.map((r) => r.n), [1, 2]);
  assert.equal(run.state, 'stopped', 'the stop, last in time, wins');
  assert.equal(run.events, 4);
});

test('bad lines are skipped and counted on the run around them', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, 'not json\n' + ev('r1', 'run.start') + '{"v":1}\n' + `${'x'.repeat(MAX_LINE + 1)}\n`);
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  assert.equal(c.store.get('r1').skipped, 3);
});

test('an endless line without a newline is dropped, not kept growing', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, ev('r1', 'run.start'));
  const c = collect({ cfg: { files: [f] }, readMax: MAX_LINE });
  await c.tick();
  for (let i = 0; i < 6; i++) { append(f, 'y'.repeat(MAX_LINE)); await c.tick(); }
  append(f, `tail\n${ev('r1', 'round.start', { n: 1 })}`);
  await c.tick();
  await c.tick();
  const run = c.store.get('r1');
  assert.equal(run.rounds.length, 1, 'the next good line after it is read');
  assert.equal(run.skipped, 1, 'the long line counts once');
});

test('the per-tick read limit catches up over several ticks', async () => {
  const f = path.join(dir(), 'run.jsonl');
  let text = ev('r1', 'run.start');
  for (let i = 1; i <= 50; i++) text += ev('r1', 'round.start', { n: i });
  append(f, text);
  const c = collect({ cfg: { files: [f] }, readMax: 512 });
  for (let i = 0; i < 40 && c.store.get('r1')?.rounds.length !== 50; i++) await c.tick();
  assert.equal(c.store.get('r1').rounds.length, 50);
  assert.equal(c.store.get('r1').skipped, 0);
});

test('maxEvents caps a run, keeping its run.start', async () => {
  const f = path.join(dir(), 'run.jsonl');
  let text = ev('r1', 'run.start', { goal: 'Kept' }, T0);
  for (let i = 1; i <= 30; i++) text += ev('r1', 'round.start', { n: i }, T0 + i);
  append(f, text);
  const c = collect({ cfg: { files: [f], maxEvents: 10 } });
  await c.tick();
  const run = c.store.get('r1');
  assert.equal(run.events, 10);
  assert.equal(run.goal, 'Kept');
  assert.deepEqual(run.rounds.map((r) => r.n), [22, 23, 24, 25, 26, 27, 28, 29, 30]);
});

test('keepDays forgets old runs', async () => {
  const f = path.join(dir(), 'run.jsonl');
  const day = 24 * 60 * 60 * 1000;
  append(f, ev('old', 'run.start', {}, Date.now() - 3 * day) + ev('new', 'run.start', {}, Date.now() - day / 2));
  const c = collect({ cfg: { files: [f], keepDays: 2 } });
  await c.tick();
  assert.deepEqual(c.store.list().map((r) => r.run), ['new']);
  assert.equal(c.store.get('old'), null);
});

test('globs are walked from their literal prefix; lane roots and the state dir are read', async () => {
  const root = dir();
  for (const name of ['a', 'b']) {
    fs.mkdirSync(path.join(root, 'runs', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'runs', name, 'run.jsonl'), ev(`g-${name}`, 'run.start'));
  }
  fs.writeFileSync(path.join(root, 'runs', 'a', 'other.txt'), 'x');
  const lane = dir();
  fs.mkdirSync(path.join(lane, '.laneboard'));
  fs.writeFileSync(path.join(lane, LANE_FILE), ev('lane-run', 'run.start'));
  const laneless = dir();
  const stateDir = dir();
  fs.mkdirSync(path.join(stateDir, 'runs'));
  fs.writeFileSync(path.join(stateDir, 'runs', 'posted.jsonl'), ev('posted', 'run.start'));

  const glob = path.join(root, 'runs', '*', 'run.jsonl');
  assert.deepEqual(await expandGlob(glob), ['a', 'b'].map((x) => path.join(root, 'runs', x, 'run.jsonl')));
  assert.deepEqual(await expandGlob(path.join(root, 'runs', 'a', 'run.jsonl')), [path.join(root, 'runs', 'a', 'run.jsonl')], 'a plain path');
  assert.deepEqual(await expandGlob(path.join(root, 'nope', '*.jsonl')), [], 'a missing prefix is no files');

  const c = collect({ cfg: { files: [glob], lanes: true }, laneRoots: () => [lane, laneless, 'relative/x', null], stateDir });
  await c.tick();
  assert.deepEqual(c.store.list().map((r) => r.run).sort(), ['g-a', 'g-b', 'lane-run', 'posted']);

  const off = await findFiles({ files: [], lanes: false, laneRoots: [lane] });
  assert.deepEqual(off, [], 'runs.lanes false: lane files are not read');
});

test('a file that appears later is found on the next discovery', async () => {
  const d = dir();
  const c = collect({ cfg: { files: [path.join(d, '*.jsonl')] } });
  await c.tick();
  assert.deepEqual(c.store.list(), []);
  fs.writeFileSync(path.join(d, 'late.jsonl'), ev('late', 'run.start'));
  await c.tick();
  assert.equal(c.store.get('late').run, 'late');
});

test('a deleted file keeps its runs (until keepDays)', async () => {
  const f = path.join(dir(), 'run.jsonl');
  append(f, ev('r1', 'run.start', { goal: 'Stays' }));
  const c = collect({ cfg: { files: [f] } });
  await c.tick();
  fs.rmSync(f);
  await c.tick();
  assert.equal(c.store.get('r1').goal, 'Stays');
});

test('readTail and parseTailLines on their own', async () => {
  const f = path.join(dir(), 'run.jsonl');
  fs.writeFileSync(f, 'a\r\nb\nc');
  const r = await readTail(f, null);
  assert.deepEqual(r.lines, ['a', 'b']);
  assert.equal(r.tail.offset, 6);
  assert.equal(r.tail.rest.toString(), 'c');
  assert.equal((await readTail(path.join(tmp, 'missing'), r.tail)).gone, true);
  const p = parseTailLines(['bad', '', ev('r', 'run.start').trim(), null]);
  assert.equal(p.events.length, 1);
  assert.deepEqual(p.skippedAt, [0, 1]);
});

test('store: skipped lines before the first good one go to that run', () => {
  const s = createStore();
  const e = parseLine(ev('r1', 'run.start').trim()).event;
  s.ingest('f', [e], [0, 0]);
  assert.equal(s.get('r1').skipped, 2);
  s.ingest('f', [], [0]);
  assert.equal(s.get('r1').skipped, 3, 'later bad lines go to the last run of the file');
  s.reset('f');
  assert.equal(s.get('r1'), null);
  assert.deepEqual(s.sources(), []);
});

test('the runs module is builder-only and provides the store', () => {
  assert.equal(runsModule.name, 'runs');
  assert.deepEqual(runsModule.modes, ['builder']);
  const provided = new Map();
  runsModule.register({ provide: (k, v) => provided.set(k, v), route: () => {} });
  assert.equal(typeof provided.get('runs').store, 'function');
});
