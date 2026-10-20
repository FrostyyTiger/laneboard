// The Runs list (runs plan §3 A2, task T7): the fixture run folded and
// summarized by the server, then rendered in the fake DOM; the empty state;
// the pure row models (trend, burn, time left, sort).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import { parseLine, foldRun } from '../server/runs/protocol.mjs';
import { summarize } from '../server/routes/runs.mjs';
import runsView, {
  renderRuns, mountRuns, unmountRuns, loadRuns, sortRuns, scoreList, scoreTrend, scoreText, burnOf,
  timeLeft, roundText, stateOf, needsOf, needsYou, spanText, EMPTY_HOW, LIST_URL, SCORE_MAX,
} from '../public/js/views/runs.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/views/runs.js'), 'utf8');
const MIN = 60_000;
const HOUR = 60 * MIN;

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}

async function withDomAsync(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return await fn(globalThis.document); } finally { globalThis.document = prev; }
}

const byClass = (node, cls) => node.querySelectorAll(`.${cls}`);

/** The fixture as GET /api/runs would list it (through the server's own fold and summary). */
function fixtureRow() {
  const text = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/readiness.jsonl'), 'utf8');
  const events = text.split('\n').filter(Boolean).map(parseLine).filter((r) => r.ok).map((r) => r.event);
  return JSON.parse(JSON.stringify(summarize(foldRun(events))));
}

const FIX = fixtureRow();
const LIVE = {
  run: 'nightly', goal: 'Make the tests green', state: 'running', round: 4, rounds: 4, maxRounds: 10,
  scores: { tests: { n: 4, value: 120, prev: 118, better: 'higher' } },
  usage: { fiveHourPct: 92, sevenDayPct: 40, overage: false }, cost: { usd: 2, rounds: 4 },
  deadline: '2026-10-21T05:00:00Z', deadlineAt: FIX.updatedAt + 3 * HOUR + 5 * MIN,
  needs: [], artifacts: 0, stop: null, startedAt: FIX.startedAt, updatedAt: FIX.updatedAt + HOUR,
};

test('the fixture renders one row with goal, state, round, scores and trend, burn, stop reason, cost, needs', () => withDom(() => {
  const host = document.createElement('div');
  const { rows } = renderRuns(host, [FIX], { status: 'ok' }, FIX.updatedAt);
  assert.equal(rows.length, 1);
  const row = byClass(host, 'rn-row')[0];
  assert.equal(row.dataset.run, 'readiness');
  assert.equal(row.dataset.state, 'stopped');
  assert.equal(row.dataset.needs, '', 'an open decision marks the row');
  const t = texts(row);
  assert.ok(t.includes('Make acme-api ready for review: tests green, docs current'));
  assert.ok(t.includes('stopped'));
  assert.equal(byClass(row, 'rn-round')[0].textContent, '3 / 6');
  // scores by name: lint 14 -> 9 (lower is better), tests 0.88 -> 0.93 (higher is better)
  const scores = byClass(row, 'rn-score').map((s) => s.textContent);
  assert.deepEqual(scores, ['lint9▼', 'tests0.93▲']);
  assert.deepEqual(byClass(row, 'rn-score').map((s) => s.dataset.trend), ['better', 'better']);
  // burn from the last usage event
  assert.deepEqual(byClass(row, 'rn-win-v').map((n) => n.textContent), ['19%', '14%']);
  assert.equal(byClass(row, 'rn-win').some((n) => n.dataset.p), false, 'far from the stop levels: grey');
  // stopped: the reason where the time left would be, coloured (no progress needs a look)
  const left = byClass(row, 'rn-left')[0];
  assert.equal(left.textContent, 'no-progress');
  assert.equal(left.dataset.p, '2');
  assert.equal(byClass(row, 'rn-cost')[0].textContent, '$3.75');
  const needs = byClass(row, 'rn-needs')[0];
  assert.equal(needs.dataset.p, '2');
  assert.match(needs.textContent, /▲ 1decision: Drop the v1 export endpoint/);
}));

test('a live run shows the time left, and a window at its stop level is marked', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [LIVE], { status: 'ok' }, FIX.updatedAt);
  const row = byClass(host, 'rn-row')[0];
  assert.equal(byClass(row, 'rn-left')[0].textContent, '3h 05m left');
  assert.equal(byClass(row, 'rn-round')[0].textContent, '4 / 10');
  const wins = byClass(row, 'rn-win');
  assert.equal(wins[0].dataset.p, '2', '5 h at 92 % is past 90');
  assert.match(wins[0].attrs['aria-label'], /near the stop level/);
  assert.equal(wins[1].dataset.p, undefined);
  assert.equal(byClass(row, 'rn-needs')[0].textContent, '—');
  assert.equal(byClass(row, 'rn-state')[0].dataset.p, 'run');
}));

test('rows that need you come first, then live runs, then the latest activity', () => {
  const old = { ...LIVE, run: 'old', state: 'stopped', stop: 'done', updatedAt: 1 };
  const wait = { ...LIVE, run: 'sleepy', state: 'waiting', needs: [{ kind: 'wait', text: 'rate limit' }], updatedAt: 5 };
  const sorted = sortRuns([old, wait, LIVE, FIX, null, { goal: 'no id' }]);
  assert.deepEqual(sorted.map((r) => r.run), ['readiness', 'nightly', 'sleepy', 'old']);
  assert.equal(needsYou(wait), false, 'a wait is the loop sleeping, not a question');
  assert.equal(needsYou(FIX), true);
});

test('the empty state says how to start a run; loading, unavailable and error say so', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [], { status: 'ok' });
  assert.equal(byClass(host, 'rn-row').length, 0);
  const t = texts(host);
  for (const line of EMPTY_HOW) assert.ok(t.includes(line), line);
  assert.equal(byClass(host, 'rn-empty-cmd')[0].textContent, 'laneboard run start --run nightly --goal "Make the tests green"');
  renderRuns(host, [], { status: 'loading' });
  assert.match(host.textContent, /Loading the runs/);
  renderRuns(host, [], { status: 'unavailable' });
  assert.match(host.textContent, /no runs route/);
  renderRuns(host, [], { status: 'error', message: 'HTTP 500' });
  assert.match(host.textContent, /could not be loaded: HTTP 500/);
  assert.equal(host.children.length, 1, 'replaces what was there');
  // an error keeps the last good rows
  renderRuns(host, [FIX], { status: 'error', message: 'x' });
  assert.equal(byClass(host, 'rn-row').length, 1);
}));

test('untrusted text goes in as text, never markup; control characters are replaced', () => withDom(() => {
  const evil = '<img src=x onerror=alert(1)>';
  const host = document.createElement('div');
  renderRuns(host, [{ ...LIVE, goal: evil, branch: 'a\u0007b', needs: [{ kind: 'decision', text: evil }] }], { status: 'ok' });
  const t = texts(host);
  assert.ok(t.includes(evil));
  assert.ok(byClass(host, 'rn-goal')[0].textContent.includes('a\ufffdb'));
  const walk = (n) => { assert.equal(n.innerHTML, '', 'no innerHTML'); n.children.forEach(walk); };
  walk(host);
  assert.doesNotMatch(SRC, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
}));

test('mount fetches GET /api/runs, paints, and unmount clears; a 404 is a note', async () => withDomAsync(async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push([url, init?.method ?? 'GET']); return { ok: true, status: 200, json: async () => ({ runs: [FIX, LIVE] }) }; };
  const host = document.createElement('div');
  await mountRuns(host, {}, { fetchFn: ok, poll: false });
  assert.deepEqual(calls, [[LIST_URL, 'GET']]);
  assert.deepEqual(byClass(host, 'rn-row').map((r) => r.dataset.run), ['readiness', 'nightly']);
  unmountRuns();
  assert.equal(host.children.length, 0);

  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await mountRuns(host, {}, { fetchFn: missing, poll: false });
  assert.match(host.textContent, /no runs route/);
  unmountRuns();

  assert.deepEqual(await loadRuns(async () => { throw new Error('offline'); }), { kind: 'error', message: 'offline' });
  assert.deepEqual(await loadRuns(async () => ({ ok: false, status: 500 })), { kind: 'error', message: 'HTTP 500' });
  assert.deepEqual(await loadRuns(async () => ({ ok: true, status: 200, json: async () => ({}) })), { kind: 'ok', runs: [] });
}));

test('pure helpers: trend, burn, time left, round text, state', () => {
  assert.deepEqual(scoreTrend({ value: 9, prev: 14, better: 'lower' }), { dir: 'down', good: true, mark: '▼', delta: -5 });
  assert.equal(scoreTrend({ value: 0.8, prev: 0.9, better: 'higher' }).good, false);
  assert.equal(scoreTrend({ value: 3, prev: 3, better: 'higher' }).mark, '=');
  assert.equal(scoreTrend({ value: 4, prev: 3 }).good, null, 'no better: no judgement');
  assert.equal(scoreTrend({ value: 4, prev: null }).dir, null);
  assert.equal(scoreText(0.93), '0.93');
  assert.equal(scoreText(1 / 3), '0.333');
  assert.equal(scoreText(null), '—');
  const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, { value: 1, prev: null }]));
  assert.equal(scoreList(many).length, 5);
  assert.equal(SCORE_MAX, 3);
  withDom(() => {
    const host = document.createElement('div');
    renderRuns(host, [{ ...LIVE, scores: many }], { status: 'ok' });
    assert.equal(byClass(host, 'rn-score').length, SCORE_MAX);
    assert.equal(byClass(host, 'rn-more')[0].textContent, '+2');
  });
  assert.deepEqual(burnOf(null), { fiveHour: null, sevenDay: null, overage: false });
  assert.equal(burnOf({ sevenDayPct: 85 }).sevenDay.warn, true);
  assert.equal(burnOf({ overage: true }).overage, true);
  assert.equal(timeLeft({ state: 'running', deadlineAt: 1000 }, 2000).text, 'past deadline');
  assert.equal(timeLeft({ state: 'running' }, 0).text, '—');
  assert.equal(timeLeft({ state: 'stopped', stop: null }, 0).text, 'unknown');
  assert.equal(spanText(40_000), '40s');
  assert.equal(spanText(3 * 24 * HOUR), '3d 0h');
  assert.equal(roundText({ round: null, maxRounds: 6 }), '0 / 6');
  assert.equal(roundText({ round: 2 }), '2');
  assert.equal(roundText({}), '—');
  assert.deepEqual(stateOf({ state: 'stopped', stop: 'error' }), { p: '1', word: 'stopped', title: 'stopped: error' });
  assert.equal(stateOf({ state: 'stopped', stop: 'done' }).p, 'ok');
  assert.equal(stateOf({ state: 'waiting' }).p, '3');
  assert.deepEqual(needsOf({ needs: [null, { text: 'x' }] }), [{ kind: 'decision', text: 'x', link: null }]);
});

test('the view has the registry shape and the Runs metadata', () => {
  assert.equal(runsView.id, 'runs');
  assert.equal(runsView.icon, 'runs');
  for (const k of ['mount', 'unmount', 'update']) assert.equal(typeof runsView[k], 'function');
  assert.doesNotMatch(SRC, /\bclass\s+\w+|\bsuper\(/);
  assert.doesNotMatch(SRC, /method:\s*'(POST|PUT|DELETE)'/, 'GET only: this view never sends an action');
});
