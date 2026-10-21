// Run stuck rules (runs plan §3 A3 "Stuck", task T8): server/runs/stuck.mjs
// on runs folded by the real foldRun, each rule firing and not firing, the
// order between rules, the config switches, and `stuck` in the list row.
import test from 'node:test';
import assert from 'node:assert/strict';

import { foldRun, parseLine } from '../server/runs/protocol.mjs';
import { runStuck, RULES, DEFAULTS } from '../server/runs/stuck.mjs';
import { summarize } from '../server/runs/summary.mjs';
import { listBody } from '../server/routes/runs.mjs';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 22, 0, 0);
const RUN = 'acme';

/** Events through the real parser (so the fixtures are valid protocol lines). */
function fold(objs) {
  return foldRun(objs.map((o) => {
    const r = parseLine(JSON.stringify({ v: 1, run: RUN, ...o }));
    assert.ok(r.ok, `${JSON.stringify(o)}: ${r.reason}`);
    return r.event;
  }));
}

/**
 * A run of rounds: each spec {task, outcome, min (duration), score} gives a
 * round.start, an optional score and a round.end; rounds follow each other.
 */
function run(specs, { start = {}, before = [], after = [], better = 'higher' } = {}) {
  const ev = [{ t: 'run.start', ts: T0, goal: 'g', ...start }, ...before];
  let at = T0 + MIN;
  specs.forEach((s, i) => {
    const n = i + 1;
    ev.push({ t: 'round.start', n, ts: at, role: 'builder', ...(s.task ? { task: s.task } : {}) });
    at += (s.min ?? 10) * MIN;
    if (s.score !== undefined) ev.push({ t: 'score', name: 'tests', value: s.score, better, n, ts: at });
    ev.push({ t: 'round.end', n, ts: at, outcome: s.outcome ?? 'kept' });
    at += MIN;
  });
  return { run: fold([...ev, ...after]), end: at };
}

const NO_RULES = { patience: 0, sameTaskFails: 0, shorterRounds: 0, deadlineMin: 0 };
const only = (rule) => ({ ...NO_RULES, ...{
  'no-progress': { patience: DEFAULTS.patience },
  'same-task': { sameTaskFails: DEFAULTS.sameTaskFails },
  'shorter-rounds': { shorterRounds: DEFAULTS.shorterRounds },
  deadline: { deadlineMin: DEFAULTS.deadlineMin },
}[rule] });

test('the rules and their defaults', () => {
  assert.deepEqual(RULES, ['deadline', 'same-task', 'no-progress', 'shorter-rounds']);
  assert.deepEqual(DEFAULTS, { patience: 3, minDelta: 0, sameTaskFails: 2, shorterRounds: 3, deadlineMin: 30 });
});

test('no-progress: no score better in the last 3 rounds fires, naming the best', () => {
  const { run: r, end } = run([{ score: 0.8 }, { score: 0.9 }, { score: 0.9 }, { score: 0.85 }, { score: 0.9 }]);
  assert.deepEqual(runStuck(r, only('no-progress'), end),
    { rule: 'no-progress', reason: 'no score better in the last 3 rounds (tests best 0.9)' });
});

test('no-progress: a better score in the window, too few rounds, or no history does not fire', () => {
  const better = run([{ score: 0.8 }, { score: 0.9 }, { score: 0.9 }, { score: 0.9 }, { score: 0.91 }]);
  assert.equal(runStuck(better.run, only('no-progress'), better.end), null);
  const young = run([{ score: 0.8 }, { score: 0.8 }, { score: 0.8 }]);
  assert.equal(runStuck(young.run, only('no-progress'), young.end), null, 'needs patience + 1 ended rounds');
  const none = run([{}, {}, {}, {}, {}]);
  assert.equal(runStuck(none.run, only('no-progress'), none.end), null, 'no scores: silent');
  const late = run([{}, {}, { score: 1 }, { score: 1 }, { score: 1 }]);
  assert.equal(runStuck(late.run, only('no-progress'), late.end), null, 'no value before the window: not judged');
});

test('no-progress: `better: lower` and minDelta decide what counts as better', () => {
  const lower = run([{ score: 10 }, { score: 9 }, { score: 8 }, { score: 7 }], { better: 'lower' });
  assert.equal(runStuck(lower.run, only('no-progress'), lower.end), null, 'falling is better');
  const rising = run([{ score: 10 }, { score: 11 }, { score: 12 }, { score: 13 }], { better: 'lower' });
  assert.equal(runStuck(rising.run, only('no-progress'), rising.end).rule, 'no-progress');
  const tiny = run([{ score: 0.9 }, { score: 0.901 }, { score: 0.902 }, { score: 0.903 }]);
  assert.equal(runStuck(tiny.run, only('no-progress'), tiny.end), null, 'minDelta 0: any gain counts');
  assert.equal(runStuck(tiny.run, { ...only('no-progress'), minDelta: 0.01 }, tiny.end).rule, 'no-progress');
});

test('no-progress: one score moving is progress, even if another is flat', () => {
  const ev = run([{ score: 1 }, { score: 1 }, { score: 1 }, { score: 1 }]);
  const r = ev.run;
  r.scores.tasks = [{ n: 1, value: 1 }, { n: 4, value: 2 }];
  r.better.tasks = 'higher';
  assert.equal(runStuck(r, only('no-progress'), ev.end), null);
});

test('same-task: the latest round failed and its task failed twice in a row fires', () => {
  const { run: r, end } = run([{ task: 'T6' }, { task: 'T7', outcome: 'no-task-done' }, { task: 'T7', outcome: 'failed' }]);
  assert.deepEqual(runStuck(r, only('same-task'), end), { rule: 'same-task', reason: 'task T7 failed in rounds 2, 3' });
});

test('same-task: rounds of other tasks between failures do not break the count', () => {
  const { run: r, end } = run([{ task: 'T7', outcome: 'error' }, { task: 'Q1', outcome: 'researched' }, { task: 'T7', outcome: 'still-red' }]);
  assert.equal(runStuck(r, only('same-task'), end).reason, 'task T7 failed in rounds 1, 3');
});

test('same-task: one failure, a success since, a good latest round, or no task does not fire', () => {
  const once = run([{ task: 'T7', outcome: 'kept' }, { task: 'T7', outcome: 'failed' }]);
  assert.equal(runStuck(once.run, only('same-task'), once.end), null);
  const healed = run([{ task: 'T7', outcome: 'failed' }, { task: 'T7', outcome: 'kept' }, { task: 'T7', outcome: 'failed' }]);
  assert.equal(runStuck(healed.run, only('same-task'), healed.end), null, 'a success resets the count');
  const moved = run([{ task: 'T7', outcome: 'failed' }, { task: 'T7', outcome: 'failed' }, { task: 'T8', outcome: 'kept' }]);
  assert.equal(runStuck(moved.run, only('same-task'), moved.end), null, 'a later good round clears it');
  const anon = run([{ outcome: 'failed' }, { outcome: 'failed' }]);
  assert.equal(runStuck(anon.run, only('same-task'), anon.end), null, 'rounds without a task: silent');
  const three = run([{ task: 'T7', outcome: 'failed' }, { task: 'T7', outcome: 'failed' }]);
  assert.equal(runStuck(three.run, { ...only('same-task'), sameTaskFails: 3 }, three.end), null);
});

test('shorter-rounds: the last 3 rounds each shorter than the one before fires', () => {
  const { run: r, end } = run([{ min: 40 }, { min: 30 }, { min: 20 }, { min: 2 }]);
  assert.deepEqual(runStuck(r, only('shorter-rounds'), end),
    { rule: 'shorter-rounds', reason: 'rounds are getting shorter (3 in a row, last 2m): possible usage limit' });
});

test('shorter-rounds: a longer round in the tail, too few rounds, or a waiting run does not fire', () => {
  const bump = run([{ min: 40 }, { min: 30 }, { min: 35 }, { min: 2 }]);
  assert.equal(runStuck(bump.run, only('shorter-rounds'), bump.end), null);
  const equal = run([{ min: 40 }, { min: 30 }, { min: 30 }, { min: 2 }]);
  assert.equal(runStuck(equal.run, only('shorter-rounds'), equal.end), null, 'equal is not shorter');
  const few = run([{ min: 30 }, { min: 20 }, { min: 2 }]);
  assert.equal(runStuck(few.run, only('shorter-rounds'), few.end), null);
  const waiting = run([{ min: 40 }, { min: 30 }, { min: 20 }, { min: 2 }],
    { after: [{ t: 'needs', kind: 'wait', text: 'usage limit, back at 04:00' }] });
  assert.equal(waiting.run.state, 'waiting');
  assert.equal(runStuck(waiting.run, only('shorter-rounds'), waiting.end), null, 'waiting is not stuck');
});

test('deadline: within 30 min or past, not stopped, no report fires', () => {
  const deadline = new Date(T0 + 5 * 60 * MIN).toISOString();
  const { run: r } = run([{}], { start: { deadline } });
  assert.deepEqual(runStuck(r, only('deadline'), T0 + 5 * 60 * MIN - 25 * MIN),
    { rule: 'deadline', reason: 'deadline in 25m, no report yet' });
  assert.deepEqual(runStuck(r, only('deadline'), T0 + 5 * 60 * MIN + 90 * MIN),
    { rule: 'deadline', reason: 'deadline passed 1h 30m ago, not stopped, no report' });
});

test('deadline: far away, a report artifact, a stop, or no deadline does not fire', () => {
  const deadline = new Date(T0 + 5 * 60 * MIN).toISOString();
  const near = T0 + 5 * 60 * MIN - 10 * MIN;
  const far = run([{}], { start: { deadline } });
  assert.equal(runStuck(far.run, only('deadline'), T0 + 60 * MIN), null);
  const reported = run([{}], { start: { deadline }, after: [{ t: 'artifact', kind: 'report', url: 'https://example.invalid/r' }] });
  assert.equal(runStuck(reported.run, only('deadline'), near), null);
  const pr = run([{}], { start: { deadline }, after: [{ t: 'artifact', kind: 'pr', url: 'https://example.invalid/pr/1' }] });
  assert.equal(runStuck(pr.run, only('deadline'), near).rule, 'deadline', 'a PR is not a report');
  const stopped = run([{}], { start: { deadline }, after: [{ t: 'run.stop', reason: 'done' }] });
  assert.equal(runStuck(stopped.run, only('deadline'), near), null);
  const open = run([{}]);
  assert.equal(runStuck(open.run, only('deadline'), near), null);
});

test('a stopped run is never stuck, whatever its rounds look like', () => {
  const { run: r, end } = run([{ task: 'T7', outcome: 'failed', score: 1 }, { task: 'T7', outcome: 'failed', score: 1 },
    { task: 'T7', outcome: 'failed', score: 1 }, { task: 'T7', outcome: 'failed', score: 1 }],
  { after: [{ t: 'run.stop', reason: 'no-progress' }] });
  assert.equal(runStuck(r, DEFAULTS, end), null);
});

test('first rule in RULES order wins; false and zero counts turn rules off', () => {
  const deadline = new Date(T0 + 5 * 60 * MIN).toISOString();
  const { run: r } = run([{ task: 'T7', outcome: 'failed', score: 1, min: 40 }, { task: 'T7', outcome: 'failed', score: 1, min: 30 },
    { task: 'T7', outcome: 'failed', score: 1, min: 20 }, { task: 'T7', outcome: 'failed', score: 1, min: 10 }],
  { start: { deadline } });
  const near = T0 + 5 * 60 * MIN - 5 * MIN;
  assert.equal(runStuck(r, DEFAULTS, near).rule, 'deadline');
  assert.equal(runStuck(r, { deadlineMin: 0 }, near).rule, 'same-task', 'missing keys take the defaults');
  assert.equal(runStuck(r, { deadlineMin: 0, sameTaskFails: 0 }, near).rule, 'no-progress');
  assert.equal(runStuck(r, { deadlineMin: 0, sameTaskFails: 0, patience: 0 }, near).rule, 'shorter-rounds');
  assert.equal(runStuck(r, NO_RULES, near), null);
  assert.equal(runStuck(r, false, near), null);
});

test('odd input never throws: an empty fold, garbage, a run with no rounds', () => {
  assert.equal(runStuck(null), null);
  assert.equal(runStuck('x'), null);
  assert.equal(runStuck(foldRun([])), null);
  assert.equal(runStuck({ state: 'running', rounds: 'x', scores: null }), null);
});

test('the list row carries stuck: {rule, reason}, null when fine or off', () => {
  const { run: r, end } = run([{ task: 'T7', outcome: 'failed' }, { task: 'T7', outcome: 'failed' }]);
  assert.deepEqual(summarize(r, { now: end }).stuck, { rule: 'same-task', reason: 'task T7 failed in rounds 1, 2' });
  assert.equal(summarize(r, { stuck: false, now: end }).stuck, null);
  const fine = run([{ task: 'T7' }]);
  assert.equal(summarize(fine.run, { now: fine.end }).stuck, null);
  const store = { list: () => [r] };
  assert.equal(listBody(store, { now: end }).runs[0].stuck.rule, 'same-task');
  assert.equal(listBody(store, { stuck: false, now: end }).runs[0].stuck, null);
  assert.equal(listBody(store, { stuck: undefined, now: end }).runs[0].stuck.rule, 'same-task', 'no config = the defaults');
});
