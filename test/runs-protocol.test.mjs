// The run protocol v1 (docs/plans/runs/README.md §3 A1): parseLine checks one
// line or says why it skipped it, foldRun turns a run's events into its picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseLine, parseLines, foldRun, ackTarget, KNOWN_TYPES, MAX_LINE, MAX_TEXT, FENCE_ACK_BY,
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
  check({ t: 'needs.ack', ref: 2, by: 'owner' }, { ref: 2, refBy: 'index', by: 'owner' });
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

test('artifact state: open, merged or closed in any case; anything else is null (night 5 T1)', () => {
  const url = 'https://example.invalid/acme/acme-api/pull/7';
  assert.equal(ok({ t: 'artifact', kind: 'pr', url }).state, null);
  assert.equal(ok({ t: 'artifact', kind: 'pr', url, state: 'open' }).state, 'open');
  assert.equal(ok({ t: 'artifact', kind: 'pr', url, state: 'MERGED' }).state, 'merged', 'gh pr view prints upper case');
  assert.equal(ok({ t: 'artifact', kind: 'pr', url, state: ' closed ' }).state, 'closed');
  for (const bad of ['draft', 'gone', '', 3, true, ['open'], { s: 'open' }]) {
    assert.equal(ok({ t: 'artifact', kind: 'pr', url, state: bad }).state, null, JSON.stringify(bad));
  }
});

test('a later artifact line with the same URL updates state and title, in its first place (night 5 T1)', () => {
  const pr = 'https://example.invalid/acme/acme-api/pull/7';
  const run = foldRun([
    ok({ t: 'artifact', kind: 'report', url: 'https://example.invalid/report' }),
    ok({ t: 'artifact', kind: 'pr', url: pr, title: 'v2 export (draft)', state: 'open' }),
    ok({ t: 'artifact', kind: 'link', url: 'https://example.invalid/other' }),
    ok({ t: 'artifact', kind: 'pr', url: pr, title: 'v2 export', state: 'merged' }),
    ok({ t: 'artifact', kind: 'pr', url: pr, title: '', state: 'bogus' }),
  ]);
  assert.equal(run.artifacts.length, 3);
  assert.equal(run.artifacts[1].url, pr, 'keeps its place');
  assert.equal(run.artifacts[1].state, 'merged', 'a bad state later does not clear it');
  assert.equal(run.artifacts[1].title, 'v2 export', 'the later title; an empty one does not clear it');
  assert.equal(run.artifacts[1].kind, 'pr');
  assert.equal(run.artifacts[0].state, null);
});

test('needs.ack: a ref is a place (below 1e9) or a time; anything else is skipped', () => {
  assert.deepEqual([ok({ t: 'needs.ack', ref: 0 })].map((e) => [e.ref, e.refBy, e.by]), [[0, 'index', null]]);
  assert.equal(ok({ t: 'needs.ack', ref: '3' }).ref, 3);
  assert.deepEqual([ok({ t: 'needs.ack', ref: 1792483200 })].map((e) => [e.ref, e.refBy]), [[1792483200000, 'ts']], 'seconds');
  assert.equal(ok({ t: 'needs.ack', ref: 1792483200000 }).ref, 1792483200000);
  assert.equal(ok({ t: 'needs.ack', ref: '2026-10-21T05:00:00Z' }).ref, Date.parse('2026-10-21T05:00:00Z'));
  for (const ref of [undefined, -1, 1.5, 'soon', null, [0], { i: 0 }]) {
    assert.equal(reason(line({ t: 'needs.ack', ref })), 'needs.ack: bad ref', String(ref));
  }
});

test('needs.ack closes a need by its place or its ts; a second ack changes nothing; an unknown ref is kept raw', () => {
  const run = foldRun([
    ok({ t: 'run.start' }),
    ok({ t: 'round.start', n: 1 }),
    ok({ t: 'needs', text: 'first?', ts: 1792483201000 }),
    ok({ t: 'needs', text: 'second?', ts: 1792483202000 }),
    ok({ t: 'needs', text: 'third?', ts: 1792483203000 }),
    ok({ t: 'needs.ack', ref: 0, by: 'owner', ts: 1792483300000 }),
    ok({ t: 'needs.ack', ref: 1792483202, ts: 1792483400000 }),
    ok({ t: 'needs.ack', ref: 0, by: 'someone else', ts: 1792483500000 }),
    ok({ t: 'needs.ack', ref: 7, ts: 1792483600000 }),
    ok({ t: 'needs.ack', ref: 1792483999000, ts: 1792483700000 }),
  ]);
  assert.deepEqual(run.needs.map((n) => [n.i, n.text, n.open, n.acked, n.ackedAt, n.by]), [
    [0, 'first?', false, true, 1792483300000, 'owner'],
    [1, 'second?', false, true, 1792483400000, null],
    [2, 'third?', true, false, null, null],
  ]);
  assert.deepEqual(run.raw.map((e) => [e.t, e.ref]), [['needs.ack', 7], ['needs.ack', 1792483999000]]);
  assert.equal(run.state, 'running');
});

test('needs.ack by ts picks the first open need of that time; an acked wait stays closed when the round moves on', () => {
  const run = foldRun([
    ok({ t: 'needs', text: 'a', ts: 1792483201000 }),
    ok({ t: 'needs', text: 'b', ts: 1792483201000 }),
    ok({ t: 'needs.ack', ref: 1792483201000 }),
    ok({ t: 'needs.ack', ref: 1792483201000 }),
    ok({ t: 'needs.ack', ref: 1792483201000, by: 'late' }),
    ok({ t: 'needs', kind: 'wait', text: 'limit' }),
    ok({ t: 'needs.ack', ref: 2 }),
    ok({ t: 'round.start', n: 2 }),
  ]);
  assert.deepEqual(run.needs.map((n) => [n.text, n.open, n.acked, n.by]), [['a', false, true, null], ['b', false, true, null], ['limit', false, true, null]]);
  assert.deepEqual(run.raw, [], 'a third ack of a known ts is a second ack, not an unknown ref');
});

test('a fence need closes only on an ack by a person (inbox, run page, owner), never by the loop or a new round (night 4 T6)', () => {
  assert.deepEqual(FENCE_ACK_BY, ['inbox', 'run page', 'owner']);
  const fence = (ts) => ok({ t: 'needs', kind: 'fence', text: 'round 3 wanted to change fenced files', ts });
  const run = foldRun([
    ok({ t: 'round.start', n: 3 }),
    fence(1792483201000),
    ok({ t: 'needs.ack', ref: 1792483201000, by: 'loop', ts: 1792483300000 }),
    ok({ t: 'needs.ack', ref: 0, ts: 1792483310000 }),
    ok({ t: 'round.start', n: 4 }),
    ok({ t: 'needs.ack', ref: 1792483201000, by: 'inbox', ts: 1792483400000 }),
    ok({ t: 'needs.ack', ref: 1792483201000, by: 'loop', ts: 1792483500000 }),
  ]);
  assert.deepEqual(run.needs.map((n) => [n.kind, n.open, n.acked, n.ackedAt, n.by]), [['fence', false, true, 1792483400000, 'inbox']]);
  assert.deepEqual(run.raw.map((e) => [e.t, e.by]), [['needs.ack', 'loop'], ['needs.ack', null]], 'refused acks are kept raw; one after the close changes nothing');

  const open = foldRun([fence(1792483201000), ok({ t: 'needs.ack', ref: 0, by: 'loop' }), ok({ t: 'run.stop', reason: 'done' })]);
  assert.deepEqual(open.needs.map((n) => [n.open, n.acked]), [[true, false]], 'run.stop closes wait needs, not a fence');
  for (const by of FENCE_ACK_BY) {
    const r = foldRun([fence(1792483201000), ok({ t: 'needs.ack', ref: 1792483201000, by })]);
    assert.equal(r.needs[0].open, false, by);
  }
  const other = foldRun([ok({ t: 'needs', kind: 'decision', text: 'x' }), ok({ t: 'needs.ack', ref: 0, by: 'loop' })]);
  assert.equal(other.needs[0].open, false, 'other kinds still close on any ack');
});

test('a ts ack skips a fence need of that time its by cannot close, and closes the next one', () => {
  const ts = 1792483201000;
  const run = foldRun([
    ok({ t: 'needs', kind: 'fence', text: 'fenced', ts }),
    ok({ t: 'needs', text: 'plain', ts }),
    ok({ t: 'needs.ack', ref: ts, by: 'loop' }),
  ]);
  assert.deepEqual(run.needs.map((n) => [n.kind, n.open, n.by]), [['fence', true, null], ['decision', false, 'loop']]);
  assert.deepEqual(run.raw, []);
  // A person's by takes the fence need first; with only the fence need open, the
  // loop's ack still names it (and is kept raw), not nothing.
  assert.equal(ackTarget(run.needs, { refBy: 'ts', ref: ts, by: 'owner' }).kind, 'fence');
  const only = foldRun([ok({ t: 'needs', kind: 'fence', text: 'fenced', ts }), ok({ t: 'needs.ack', ref: ts, by: 'loop' })]);
  assert.deepEqual([only.needs[0].open, only.raw.length], [true, 1]);
});

test('run.start may name its host and a score its max (T9, the Map); a bad max is dropped', () => {
  assert.equal(ok({ t: 'run.start', host: 'builder-a' }).host, 'builder-a');
  assert.equal(ok({ t: 'run.start' }).host, null);
  assert.equal(ok({ t: 'score', name: 'tasks', value: 3, max: 12 }).max, 12);
  for (const max of [0, -1, 'x', null]) assert.equal(ok({ t: 'score', name: 'tasks', value: 3, max }).max, null);
  const run = foldRun([
    ok({ t: 'run.start', host: 'scratch-1' }),
    ok({ t: 'score', name: 'tasks', value: 3, max: 12 }),
  ]);
  assert.equal(run.host, 'scratch-1');
  assert.equal(run.scores.tasks[0].max, 12);
});

test('a score before any round lands on round 0 (night 4 T36)', () => {
  const run = foldRun([ok({ t: 'run.start' }), ok({ t: 'score', name: 'tests', value: 0.5 }), ok({ t: 'round.start', n: 1 }), ok({ t: 'score', name: 'tests', value: 0.7 })]);
  assert.deepEqual(run.scores.tests.map((x) => [x.n, x.value]), [[0, 0.5], [1, 0.7]]);
});
