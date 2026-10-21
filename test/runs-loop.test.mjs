// The reference loop's own events (runs plan §7, task T9): a night written with
// exactly the shapes docs/plans/runs/loop/run.sh emits (floats from its older
// ev(), integers after a restart, an all-digit sha as a number, a planner round
// with no round.end, retries, wait and fence needs, the tasks_done bug line),
// folded into rounds, cost, burn, scores and stop, and shown as a list row and
// a run page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import { parseLines, foldRun } from '../server/runs/protocol.mjs';
import { summarize } from '../server/routes/runs.mjs';
import { renderRuns, renderRunPage, burnOf, roundRows } from '../public/js/views/runs.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEXT = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/loop-runs-n1.jsonl'), 'utf8');
const { events, skipped } = parseLines(TEXT);
const RUN = JSON.parse(JSON.stringify(foldRun(events, { skipped })));
const ROW = JSON.parse(JSON.stringify(summarize(RUN)));

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}
const byClass = (node, cls) => node.querySelectorAll(`.${cls}`);

test('the fixture is written the way run.sh writes: floats, then integers after a restart', () => {
  const lines = TEXT.trim().split('\n');
  assert.equal(lines.length, 72);
  for (const line of lines) assert.match(line, /^\{"v": 1, "t": "[a-z.]+", "run": "runs-n1", "ts": \d{13}, /);
  assert.ok(lines.some((l) => /"t": "round.start", .*"n": 1\.0,/.test(l)));
  assert.ok(lines.some((l) => /"t": "round.start", .*"n": 4,/.test(l)));
  assert.ok(lines.some((l) => /"commit": 4401484\.0/.test(l)), 'an all-digit sha written as a number');
  assert.equal(lines.filter((l) => l.includes('"t": "run.start"')).length, 2);
});

test('one line is skipped (the tasks score "0\\n0"), everything else folds', () => {
  assert.deepEqual(skipped, { 'score: bad value': 1 });
  assert.equal(RUN.skipped, 1);
  assert.equal(RUN.events, 71);
  assert.equal(RUN.raw.length, 0, 'every type the loop writes is known');
});

test('run.start: goal, plan, branch, deadline and the top-level budget', () => {
  assert.equal(RUN.run, 'runs-n1');
  assert.equal(RUN.goal, 'laneboard runs plan, runs-n1');
  assert.equal(RUN.plan, 'docs/plans/runs/README.md');
  assert.equal(RUN.branch, 'run/runs-n1');
  assert.equal(RUN.deadline, '2026-10-21 07:00');
  assert.equal(RUN.deadlineAt, Date.parse('2026-10-21 07:00'), 'no zone: read in laneboard\'s local time');
  assert.deepEqual(RUN.budget, { rounds: 15, windowPct: null, pause5h: 90, stop7d: 85 });
});

test('rounds: roles, retries, outcomes, commits and the cost of each', () => {
  const rounds = RUN.rounds.map((r) => [r.n, r.role, r.starts, r.outcome, r.commit, r.usd]);
  assert.deepEqual(rounds, [
    [1, 'planner', 1, null, null, 0.89],
    [2, 'fix', 1, 'fixed', null, 0.39],
    [3, 'research', 3, 'researched', null, 1.37],
    [4, 'builder', 1, 'kept', '4401484', 2.1],
    [5, 'builder', 1, 'no-task-done', null, 1.4],
    [6, 'review-stranger', 1, 'reviewed', null, 0.17],
    [7, 'triage', 1, 'triaged', null, 0.08],
    [8, 'builder', 1, 'kept', '0fd22f8', 2.67],
    [9, 'builder', 1, 'kept', '2f3e208', 1.93],
    [10, 'review-operator', 1, null, null, 0.3],
    [11, 'final', 1, null, null, 0.85],
  ]);
  assert.equal(RUN.rounds[2].open, 2, 'the researcher\'s open questions');
});

test('cost is the sum of every cost event, across the restart; the loop\'s own total starts over', () => {
  assert.deepEqual(RUN.cost, { usd: 12.15, rounds: 13 });
  assert.equal(RUN.stop.usd, 10.11, 'run.stop carries the loop\'s total since its last start');
  const perRound = RUN.rounds.reduce((a, r) => a + (r.usd ?? 0), 0);
  assert.equal(Math.round(perRound * 100) / 100, 12.15);
});

test('usage: -1 means unknown, seconds become ms, the last one is the burn', () => {
  assert.deepEqual(RUN.rounds[0].usage.fiveHourPct, null);
  assert.deepEqual(RUN.rounds[0].usage.fiveHourResetsAt, null);
  assert.equal(RUN.rounds[7].usage.fiveHourPct, 91);
  assert.equal(RUN.rounds[7].usage.fiveHourResetsAt, 1792534200000);
  const { ts, ...last } = RUN.usage;
  assert.deepEqual(last, { fiveHourPct: 6, sevenDayPct: 14, fiveHourResetsAt: 1792552200000, overage: false });
  assert.ok(ts > 0);
  const burn = burnOf(ROW.usage);
  assert.equal(burn.fiveHour.text, '6%');
  assert.equal(burn.sevenDay.text, '14%');
  assert.equal(burn.overage, false);
  assert.equal(burnOf(RUN.rounds[7].usage).fiveHour.warn, true, '91 % is past the loop\'s 90 % pause');
});

test('scores tests and tasks over rounds, both higher is better', () => {
  assert.deepEqual(RUN.better, { tests: 'higher', tasks: 'higher' });
  assert.deepEqual(RUN.scores.tasks.map((s) => [s.n, s.value]), [[3, 0], [4, 1], [5, 1], [7, 1], [8, 2], [9, 3]]);
  const tests = RUN.scores.tests.map((s) => [s.n, s.value]);
  assert.deepEqual(tests[0], [0, 0.9997], 'the check before round 1 belongs to round 0');
  assert.deepEqual(tests.find(([n]) => n === 4), [4, 0.9993]);
  assert.deepEqual(tests.at(-1), [11, 1]);
  assert.deepEqual(ROW.scores.tasks, { n: 9, value: 3, prev: 2, better: 'higher' });
});

test('needs: waits close at the next round, the fence stays open; the PR is an artifact', () => {
  assert.deepEqual(RUN.needs.map((x) => [x.kind, x.n, x.open]),
    [['wait', 3, false], ['wait', 3, false], ['fence', 5, true], ['wait', 8, false]]);
  assert.deepEqual(ROW.needs.map((x) => x.kind), ['fence']);
  assert.deepEqual(RUN.artifacts.map((a) => [a.kind, a.url, a.n]),
    [['pr', 'https://example.invalid/acme/laneboard/pull/10', 1]]);
});

test('a run whose last event is a wait need is waiting', () => {
  const cut = TEXT.split('\n');
  const at = cut.findIndex((l) => l.includes('5 h window at 91 %'));
  const run = foldRun(parseLines(cut.slice(0, at + 1).join('\n')).events);
  assert.equal(run.state, 'waiting');
  assert.equal(run.stop, null);
});

test('the stop: reason, rounds and the loop\'s total', () => {
  assert.equal(RUN.state, 'stopped');
  assert.deepEqual({ ...RUN.stop, ts: undefined }, { reason: 'deadline', rounds: 11, usd: 10.11, ts: undefined });
  assert.equal(ROW.stop, 'deadline');
  assert.equal(ROW.round, 11);
  assert.equal(ROW.maxRounds, 15);
});

test('the list row shows the loop: goal, round n / max, scores, burn, stop, cost, the fence', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [ROW], { status: 'ok' }, ROW.updatedAt);
  const row = byClass(host, 'rn-row')[0];
  assert.equal(row.dataset.run, 'runs-n1');
  assert.equal(row.dataset.state, 'stopped');
  assert.ok(texts(row).includes('laneboard runs plan, runs-n1'));
  assert.equal(byClass(row, 'rn-round')[0].textContent, '11 / 15');
  assert.deepEqual(byClass(row, 'rn-score').map((s) => s.textContent), ['tasks3↑', 'tests1=']);
  assert.deepEqual(byClass(row, 'rn-win-v').map((n) => n.textContent), ['6%', '14%']);
  assert.equal(byClass(row, 'rn-left')[0].textContent, 'stopdeadline');
  assert.equal(byClass(row, 'rn-cost')[0].textContent, 'cost$12.15');
  assert.match(byClass(row, 'rn-needs')[0].textContent, /fence: round 5 wanted to change fenced files/);
}));

test('the run page lists every round with its cost, retries and the numeric commit', () => withDom(() => {
  const host = document.createElement('div');
  renderRunPage(host, RUN, { status: 'ok', id: 'runs-n1' }, RUN.updatedAt);
  const rows = byClass(host, 'rn-tl-row');
  assert.equal(rows.length, 11);
  assert.deepEqual(byClass(host, 'rn-tl-commit').map((n) => n.textContent),
    ['—', '—', '—', '4401484', '—', '—', '—', '0fd22f8', '2f3e208', '—', '—']);
  assert.equal(byClass(rows[2], 'rn-tl-re')[0].textContent, ' ×3');
  const model = roundRows(RUN, RUN.updatedAt);
  assert.equal(model[0].outcome, null, 'a stopped run\'s planner round without round.end is not "running"');
  assert.equal(model[3].cost, '$2.10');
}));
