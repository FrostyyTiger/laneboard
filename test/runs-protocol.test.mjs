// The run protocol v1 (docs/plans/runs/README.md §3 A1): parseLine checks one
// line or says why it skipped it, foldRun turns a run's events into its picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseLine, parseLines, foldRun, KNOWN_TYPES, MAX_LINE, MAX_TEXT,
} from '../server/runs/protocol.mjs';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'runs', 'readiness.jsonl');
const line = (o) => JSON.stringify({ v: 1, run: 'r1', ts: 1792483200000, ...o });
const ok = (o) => {
  const r = parseLine(line(o));
  assert.equal(r.ok, true, `expected ok, got ${r.reason}`);
  return r.event;
};
const reason = (text) => {
  const r = parseLine(text);
  assert.equal(r.ok, false);
  return r.reason;
};

test('every known type parses, with its checked fields', () => {
  const seen = new Set();
  const check = (o, expect) => {
    const e = ok(o);
    seen.add(e.t);
    assert.equal(e.known, true);
    assert.equal(e.run, 'r1');
    for (const [k, v] of Object.entries(expect)) assert.deepEqual(e[k], v, `${o.t}.${k}`);
  };
  check({ t: 'run.start', goal: 'g', plan: 'p.md', deadline: '2026-10-21T05:00:00Z', budget: { rounds: 15, windowPct: 90 } },
    { goal: 'g', plan: 'p.md', deadlineAt: Date.parse('2026-10-21T05:00:00Z'),
      budget: { rounds: 15, windowPct: 90, pause5h: null, stop7d: null } });
  check({ t: 'round.start', n: 3, role: 'builder', task: 'A2.4' }, { n: 3, role: 'builder', task: 'A2.4' });
  check({ t: 'round.end', n: 3, outcome: 'kept', commit: 'abc1234' }, { n: 3, outcome: 'kept', commit: 'abc1234' });
  check({ t: 'score', name: 'tests', value: 0.93, better: 'higher' }, { name: 'tests', value: 0.93, better: 'higher', n: null });
  check({ t: 'needs', kind: 'decision', text: 'which?', link: 'https://example.invalid/x' },
    { kind: 'decision', text: 'which?', link: 'https://example.invalid/x' });
  check({ t: 'artifact', kind: 'pr', url: 'https://example.invalid/pull/1' }, { kind: 'pr', url: 'https://example.invalid/pull/1' });
  check({ t: 'run.stop', reason: 'deadline' }, { reason: 'deadline', rounds: null, usd: null });
  check({ t: 'usage', n: 1, fiveHourPct: 2, sevenDayPct: 10, fiveHourResetsAt: 1792534200, overage: 0 },
    { n: 1, fiveHourPct: 2, sevenDayPct: 10, fiveHourResetsAt: 1792534200000, overage: false });
  check({ t: 'cost', n: 1, usd: 0.89, total: 0.89 }, { n: 1, usd: 0.89, total: 0.89 });
  assert.deepEqual([...seen].sort(), [...KNOWN_TYPES].sort());
});

test('the reference loop\'s shapes: floats, top-level budget, numeric commit', () => {
  const start = ok({ t: 'run.start', goal: 'g', deadline: '2026-10-21 07:00', rounds: 15.0, pause5h: 90.0, stop7d: 85.0, branch: 'run/x' });
  assert.deepEqual(start.budget, { rounds: 15, windowPct: null, pause5h: 90, stop7d: 85 });
  assert.equal(start.deadline, '2026-10-21 07:00');
  assert.equal(start.branch, 'run/x');
  const r = ok({ t: 'round.start', n: 3.0, role: 'fix' });
  assert.ok(Number.isInteger(r.n) && r.n === 3);
  assert.equal(ok({ t: 'round.end', n: '4', commit: 1234567 }).commit, '1234567');
  assert.equal(ok({ t: 'round.end', n: 4, commit: 123456 }).commit, '0123456', 'leading zero given back');
  assert.equal(ok({ t: 'round.end', n: 4, commit: 'not a sha' }).commit, null);
  assert.equal(ok({ t: 'usage', fiveHourResetsAt: 1792534200000 }).fiveHourResetsAt, 1792534200000, 'ms stays ms');
  assert.equal(ok({ t: 'usage', fiveHourPct: -1, fiveHourResetsAt: 0 }).fiveHourPct, null);
  assert.equal(ok({ t: 'usage', overage: 1.0 }).overage, true);
  assert.equal(ok({ t: 'score', name: 'tasks', value: '3' }).value, 3);
  assert.equal(ok({ t: 'score', name: 'x', value: 1, better: 'sideways' }).better, 'higher');
  assert.equal(ok({ t: 'run.stop', reason: '7d-window', rounds: 12.0, usd: 9.5 }).rounds, 12);
  assert.equal(parseLine(JSON.stringify({ t: 'run.stop', run: 'r1' })).event.v, 1, 'v defaults to 1');
});

test('an unknown type is kept raw, clamped', () => {
  const e = ok({ t: 'review.note', by: 'stranger', text: 'x'.repeat(5000), nested: { a: 1 } });
  assert.equal(e.known, false);
  assert.equal(e.t, 'review.note');
  assert.equal(e.raw.by, 'stranger');
  assert.ok(e.raw.text.length <= 300);
  assert.equal(e.raw.nested, '{"a":1}');
});

test('malformed lines are skipped with a reason', () => {
  assert.equal(reason(''), 'empty');
  assert.equal(reason('{"t":'), 'not json');
  assert.equal(reason('[1,2]'), 'not an object');
  assert.equal(reason('"run.start"'), 'not an object');
  assert.equal(reason(line({ v: 2, t: 'score' })), 'unsupported version');
  assert.equal(reason(JSON.stringify({ v: 1, run: 'r1' })), 'no type');
  assert.equal(reason(JSON.stringify({ v: 1, t: 'score' })), 'bad run id');
  assert.equal(reason(line({ t: 'score', run: '../etc' })), 'bad run id');
  assert.equal(reason(line({ t: 'score', run: 'a/b' })), 'bad run id');
  assert.equal(reason(line({ t: 'round.start', n: 2.5 })), 'round.start: bad n');
  assert.equal(reason(line({ t: 'round.end' })), 'round.end: bad n');
  assert.equal(reason(line({ t: 'score', name: 'tasks', value: '0\n0' })), 'score: bad value');
  assert.equal(reason(line({ t: 'score', value: 1 })), 'score: no name');
  assert.equal(reason(line({ t: 'artifact', kind: 'pr' })), 'artifact: no url');
  assert.equal(reason(line({ t: 'cost', usd: 'lots' })), 'cost: bad usd');
});

test('an oversized line is skipped, long strings are clamped', () => {
  assert.equal(reason(line({ t: 'needs', text: 'x'.repeat(MAX_LINE) })), 'too long');
  const e = ok({ t: 'needs', text: 'y'.repeat(MAX_TEXT + 500), link: 'z'.repeat(1000) });
  assert.equal(e.text.length, MAX_TEXT);
  assert.ok(e.text.endsWith('…'));
  assert.equal(e.link.length, 300);
});

test('parseLines counts skipped lines by reason', () => {
  const text = [line({ t: 'run.start' }), 'garbage', '', line({ t: 'score', name: 'a', value: 'x' }), 'more garbage'].join('\n');
  const { events, skipped } = parseLines(text);
  assert.equal(events.length, 1);
  assert.deepEqual(skipped, { 'not json': 2, 'score: bad value': 1 });
  assert.equal(foldRun(events, { skipped }).skipped, 3);
});

test('the fixture folds into the run', () => {
  const { events, skipped } = parseLines(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(skipped, {});
  const run = foldRun(events);
  assert.equal(run.run, 'readiness');
  assert.match(run.goal, /acme-api/);
  assert.equal(run.state, 'stopped');
  assert.deepEqual(run.budget, { rounds: 6, windowPct: 90, pause5h: null, stop7d: null });
  assert.equal(run.deadlineAt, Date.parse('2026-10-21T05:00:00Z'));
  assert.deepEqual(run.stop, { reason: 'no-progress', rounds: 3, usd: 3.75, ts: 1792487410000 });

  assert.deepEqual(run.rounds.map((r) => [r.n, r.role, r.task, r.outcome, r.commit, r.usd]), [
    [1, 'planner', null, 'kept', 'a1b2c3d', 0.9],
    [2, 'builder', 'A2.4', 'kept', 'b2c3d4e', 1.6],
    [3, 'builder', 'A2.5', 'no-task-done', null, 1.25],
  ]);
  assert.equal(run.rounds[2].startedAt, 1792485610000, 'round 3 ended before its start line, still whole');
  assert.equal(run.rounds[2].endedAt, 1792487400300);
  assert.equal(run.rounds[1].usage.fiveHourPct, 11);

  assert.deepEqual(run.scores.tests.map((s) => [s.n, s.value]), [[0, 0.81], [2, 0.88], [3, 0.93]]);
  assert.deepEqual(run.scores.lint.map((s) => [s.n, s.value]), [[2, 14], [3, 9]]);
  assert.deepEqual(run.better, { tests: 'higher', lint: 'lower' });

  assert.equal(run.needs.length, 1);
  assert.equal(run.needs[0].open, true);
  assert.equal(run.needs[0].kind, 'decision');
  assert.deepEqual(run.artifacts.map((a) => [a.kind, a.url]), [['pr', 'https://example.invalid/acme/acme-api/pull/7']]);
  assert.deepEqual(run.cost, { usd: 3.75, rounds: 3 });
  assert.equal(run.usage.fiveHourPct, 19);
  assert.equal(run.usage.fiveHourResetsAt, 1792497600000);
  assert.deepEqual(run.raw.map((e) => e.t), ['review.note']);
  assert.equal(run.startedAt, 1792483200000);
  assert.equal(run.updatedAt, 1792487410000);
  assert.equal(run.events, 22);
});

test('out-of-order rounds come out sorted', () => {
  const run = foldRun([
    ok({ t: 'round.end', n: 2, outcome: 'kept' }),
    ok({ t: 'round.start', n: 3, role: 'builder' }),
    ok({ t: 'round.start', n: 1, role: 'planner' }),
    ok({ t: 'round.start', n: 2, role: 'builder' }),
  ]);
  assert.deepEqual(run.rounds.map((r) => r.n), [1, 2, 3]);
  assert.equal(run.rounds[1].outcome, 'kept');
  assert.equal(run.rounds[1].role, 'builder');
});

test('a retried round counts its starts and adds its costs; a restart reopens the run', () => {
  const run = foldRun([
    ok({ t: 'run.start', goal: 'g', rounds: 15.0 }),
    ok({ t: 'round.start', n: 3.0, role: 'research' }),
    ok({ t: 'cost', n: 3.0, usd: 0.52, total: 1.8 }),
    ok({ t: 'needs', kind: 'wait', text: 'usage limit, waiting 1200s' }),
    ok({ t: 'run.stop', reason: 'error' }),
    ok({ t: 'run.start', goal: 'g again', rounds: 15 }),
    ok({ t: 'round.start', n: 3, role: 'research' }),
    ok({ t: 'cost', n: 3, usd: 0.24, total: 0.24 }),
  ]);
  assert.equal(run.state, 'running');
  assert.equal(run.stop, null);
  assert.equal(run.goal, 'g again');
  assert.equal(run.rounds.length, 1);
  assert.equal(run.rounds[0].starts, 2);
  assert.equal(run.rounds[0].usd, 0.76);
  assert.equal(run.cost.usd, 0.76, 'summed, not the restarted total');
  assert.equal(run.needs[0].open, false, 'a wait closes when the next round starts');
});

test('a run whose last word is a wait need is waiting', () => {
  const run = foldRun([
    ok({ t: 'run.start' }),
    ok({ t: 'round.start', n: 1 }),
    ok({ t: 'needs', kind: 'wait', text: '5 h window at 91 %' }),
  ]);
  assert.equal(run.state, 'waiting');
  assert.equal(run.needs[0].open, true);
  assert.equal(run.needs[0].n, 1);
});

test('events of another run are ignored, an empty fold is harmless', () => {
  const run = foldRun([ok({ t: 'round.start', n: 1 }), ok({ t: 'round.start', n: 2, run: 'other' })]);
  assert.equal(run.rounds.length, 1);
  assert.equal(run.events, 1);
  const empty = foldRun([]);
  assert.equal(empty.run, null);
  assert.deepEqual(empty.rounds, []);
  assert.equal(empty.state, 'running');
});

test('duplicate artifacts are kept once', () => {
  const run = foldRun([
    ok({ t: 'artifact', kind: 'pr', url: 'https://example.invalid/pull/1' }),
    ok({ t: 'artifact', kind: 'pr', url: 'https://example.invalid/pull/1' }),
  ]);
  assert.equal(run.artifacts.length, 1);
});
