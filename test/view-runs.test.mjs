// The Runs list (runs plan §3 A2, task T7): the fixture run folded and
// summarized by the server, then rendered in the fake DOM; the empty state;
// the pure row models (trend, burn, time left, sort). The run page (T8): the
// fixture's full fold rendered as timeline, stop, needs, artifacts, raw. The
// score charts (T11): the loop fixture's `tests` and `tasks` lines, point by point.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import { parseLine, parseLines, foldRun } from '../server/runs/protocol.mjs';
import { summarize } from '../server/routes/runs.mjs';
import runsView, {
  renderRuns, mountRuns, unmountRuns, loadRuns, sortRuns, scoreList, scoreTrend, scoreText, burnOf,
  timeLeft, roundText, stateOf, needsOf, needsYou, spanText, EMPTY_HOW, EMPTY_HUB, LIST_URL, SCORE_MAX,
  renderRunPage, roundRows, roundSessions, stopOf, artifactsOf, rawOf, runSummaryOf, loadRun, safeHref, updateRuns,
  runHref, runUrl, LIST_HREF, needActions, ackNeed, ACK_BY, EVENTS_URL, TL_NARROW_HIDDEN, RAW_SHOW, stuckOf, scoreCharts, chartPoints, chartDomain, chartNum, CHART_W, CHART_H,
  needsCell, tlColumns, ackedNeedsOf, runCostOf, outcomeText,
} from '../public/js/views/runs.js';
import { parseHash, emptyRoute } from '../public/js/core/router.js';

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

/** The fixture as GET /api/runs/readiness would answer it: the whole fold. */
function fixtureRun() {
  const text = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/readiness.jsonl'), 'utf8');
  const events = text.split('\n').filter(Boolean).map(parseLine).filter((r) => r.ok).map((r) => r.event);
  return JSON.parse(JSON.stringify(foldRun(events)));
}
const RUN = fixtureRun();
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
  assert.deepEqual(scores, ['lint9↓', 'tests0.93↑']);
  assert.deepEqual(byClass(row, 'rn-score').map((s) => s.dataset.trend), ['better', 'better']);
  // burn from the last usage event
  assert.deepEqual(byClass(row, 'rn-win-v').map((n) => n.textContent), ['19%', '14%']);
  assert.equal(byClass(row, 'rn-win').some((n) => n.dataset.p), false, 'far from the stop levels: grey');
  // stopped: the reason where the time left would be, coloured (no progress needs a look)
  const left = byClass(row, 'rn-left')[0];
  assert.equal(left.textContent, 'stopno-progress');
  assert.equal(byClass(left, 'rn-v')[0].textContent, 'no-progress');
  assert.equal(left.dataset.p, '2');
  assert.equal(byClass(row, 'rn-cost')[0].textContent, 'cost$3.75');
  const needs = byClass(row, 'rn-needs')[0];
  assert.equal(needs.dataset.p, '2');
  assert.match(needs.textContent, /^▲decision: Drop the v1 export endpoint/);
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
  assert.equal(byClass(row, 'rn-needs').length, 0, 'nothing open: no needs line, no "—" (T31)');
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

test('a stuck run (T8) carries the stuck badge in p2 with its reason, sorts after the runs that need you', () => withDom(() => {
  const stuck = { ...LIVE, run: 'loopy', stuck: { rule: 'same-task', reason: 'task T7 failed in rounds 4, 5' } };
  const host = document.createElement('div');
  renderRuns(host, [stuck, LIVE], { status: 'ok' }, FIX.updatedAt);
  const [row, calm] = byClass(host, 'rn-row');
  assert.equal(row.dataset.run, 'loopy');
  assert.equal(row.dataset.stuck, '');
  const badge = byClass(row, 'rn-stuck')[0];
  assert.equal(badge.dataset.p, '2');
  assert.equal(badge.dataset.rule, 'same-task');
  assert.equal(badge.title, 'stuck: task T7 failed in rounds 4, 5');
  assert.match(byClass(row, 'rn-state')[0].title, /stuck: task T7 failed/);
  assert.equal(calm.dataset.stuck, undefined);
  assert.equal(byClass(calm, 'rn-stuck').length, 0, 'stuck: null draws no badge');
  assert.deepEqual(sortRuns([LIVE, stuck, FIX]).map((r) => r.run), ['readiness', 'loopy', 'nightly']);
  assert.equal(stuckOf({ stuck: 'yes' }), null, 'only an object counts');
  assert.deepEqual(stuckOf({ stuck: { rule: 'deadline' } }), { rule: 'deadline', reason: 'deadline' });
  assert.equal(stuckOf({ stuck: {} }), null);
}));

test('a server without runs (a hub) names the next step: a builder or docs/runs.md (T21)', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [], { status: 'unavailable' });
  assert.equal(byClass(host, 'rn-row').length, 0);
  assert.equal(byClass(host, 'rn-empty-lead').length, 1, 'a lead line, then the step');
  const t = host.textContent;
  assert.match(t, /hub/);
  assert.match(t, /Open Runs on a builder/);
  assert.match(t, /docs\/runs\.md/);
  assert.equal(EMPTY_HUB.length, 2);
}));

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
  for (const line of EMPTY_HUB) assert.ok(texts(host).includes(line), line);
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
  assert.match(host.textContent, /collects no runs: a hub/);
  unmountRuns();

  assert.deepEqual(await loadRuns(async () => { throw new Error('offline'); }), { kind: 'error', message: 'offline' });
  assert.deepEqual(await loadRuns(async () => ({ ok: false, status: 500 })), { kind: 'error', message: 'HTTP 500' });
  assert.deepEqual(await loadRuns(async () => ({ ok: true, status: 200, json: async () => ({}) })), { kind: 'ok', runs: [] });
}));

test('pure helpers: trend, burn, time left, round text, state', () => {
  assert.deepEqual(scoreTrend({ value: 9, prev: 14, better: 'lower' }), { dir: 'down', good: true, mark: '↓', delta: -5 });
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
  // one write since T28: the ACK's POST of a needs.ack event to /api/runs/events, nothing else
  assert.doesNotMatch(SRC, /method:\s*'(PUT|DELETE|PATCH)'/);
  assert.equal(SRC.match(/method:\s*'POST'/g)?.length, 1, 'one POST only (an ack)');
});

// ---------------------------------------------------------------- the run page (T8)

test('a row links to its page, and the link is a route the router parses back', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [FIX, { ...LIVE, run: 'bad/id' }], { status: 'ok' }, FIX.updatedAt);
  const links = byClass(host, 'rn-open');
  assert.equal(links.length, 1, 'only a protocol run id gets a link');
  assert.equal(links[0].tagName, 'A');
  assert.equal(links[0].href, '#/runs?run=readiness');
  assert.deepEqual(parseHash(links[0].href), { ...emptyRoute('runs'), run: 'readiness' });
  assert.equal(runHref('a.b-c'), '#/runs?run=a.b-c');
  assert.equal(runUrl('readiness'), '/api/runs/readiness');
  assert.equal(LIST_HREF, '#/runs');
}));

test('artifact rows print the PR title (the URL as fallback) and its state as a muted word', () => withDom(() => {
  const url = 'https://example.invalid/acme/acme-api/pull/9';
  const run = { run: 'r', state: 'running', rounds: [], scores: {}, better: {}, needs: [], raw: [], stop: null, cost: null, usage: null,
    artifacts: [
      { kind: 'pr', url, title: 'Paged search', state: 'merged', n: 2 },
      { kind: 'pr', url: 'https://example.invalid/acme/acme-api/pull/10', title: null, state: 'bogus', n: 3 },
    ] };
  assert.deepEqual(artifactsOf(run).map((a) => [a.title, a.state]), [['Paged search', 'merged'], ['https://example.invalid/acme/acme-api/pull/10', null]]);
  const host = document.createElement('div');
  const page = renderRunPage(host, run, { status: 'ok', id: 'r' }, Date.now());
  const items = byClass(page, 'rn-art');
  assert.equal(items.length, 2);
  assert.equal(byClass(items[0], 'rn-item-t')[0].textContent, 'Paged search ↗');
  assert.equal(byClass(items[0], 'rn-item-arrow')[0].getAttribute('aria-hidden'), 'true');
  assert.equal(byClass(items[0], 'rn-item-t')[0].href, url);
  assert.deepEqual(byClass(items[0], 'rn-item-s').map((n) => n.textContent), ['· merged']);
  assert.equal(byClass(items[0], 'rn-item-s')[0].dataset.state, 'merged');
  // T16: `title ↗ · state · round n`, the state never runs into the round
  assert.equal(items[0].textContent, 'prPaged search ↗· merged· round 2');
  assert.equal(byClass(items[1], 'rn-item-t')[0].textContent, 'https://example.invalid/acme/acme-api/pull/10 ↗');
  assert.equal(byClass(items[1], 'rn-item-s').length, 0, 'no state word for an unknown state');
  assert.equal(items[1].textContent, 'prhttps://example.invalid/acme/acme-api/pull/10 ↗· round 3');
}));

test('the run page shows the fixture: head, stop reason, open need, timeline, artifact, raw folded away', () => withDom(() => {
  const host = document.createElement('div');
  const page = renderRunPage(host, RUN, { status: 'ok', id: 'readiness' }, RUN.updatedAt);
  assert.equal(host.children[0], page);
  assert.equal(byClass(page, 'rn-back')[0].href, '#/runs');
  const t = texts(page);
  assert.ok(t.includes('Make acme-api ready for review: tests green, docs current'));
  assert.equal(byClass(page, 'rn-round')[0].textContent, 'round 3 / 6');
  assert.deepEqual(byClass(page, 'rn-score').map((n) => n.textContent), ['lint9↓', 'tests0.93↑']);
  assert.equal(byClass(page, 'rn-cost')[0].textContent, 'cost$3.75');
  assert.equal(byClass(page, 'rn-events')[0].textContent, '22 events');
  // stop reason in the state label (T17), coloured: no progress needs a look
  const state = byClass(byClass(page, 'rn-head')[0], 'rn-state')[0];
  assert.match(state.textContent, /stopped· no-progress · after 3 rounds$/);
  assert.equal(state.dataset.p, '2');
  assert.match(state.title, /^stopped at 2026-/);
  // the open need, with its link
  const need = byClass(page, 'rn-need');
  assert.equal(need.length, 1);
  assert.equal(need[0].dataset.p, '2');
  assert.match(need[0].textContent, /▲decisionDrop the v1 export endpoint/);
  // T28: OPEN and ACK as buttons on the right, not a grey word
  const needLink = byClass(need[0], 'rn-need-open')[0];
  assert.equal(needLink.tagName, 'A');
  assert.match(needLink.className, /\bbtn btn--s\b/);
  assert.equal(needLink.href, 'https://example.invalid/acme/acme-api/pull/7');
  assert.equal(needLink.rel, 'noopener noreferrer');
  const ackB = byClass(need[0], 'rn-need-ack')[0];
  assert.equal(ackB.tagName, 'BUTTON');
  assert.match(ackB.className, /\bbtn btn--s ok\b/);
  assert.equal(ackB.textContent, 'Ack');
  // the timeline: round, role, task, outcome, commit, cost, duration (no round has a session: no sessions column, T40)
  const rows = byClass(page, 'rn-tl-row');
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.textContent)), [
    ['1', 'planner', '—', 'kept', 'a1b2c3d', '$0.90', '9m'],
    ['2', 'builder', 'A2.4', 'kept', 'b2c3d4e', '$1.60', '29m'],
    ['3', 'builder', 'A2.5', 'no task done', '—', '$1.25', '29m'],
  ]);
  // T21: the outcome prints words, the protocol slug stays on the cell
  assert.equal(rows[2].children[3].dataset.outcome, 'no-task-done');
  assert.equal(rows[2].children[3].title, 'outcome: no-task-done');
  assert.equal(byClass(page, 'rn-tl')[0].children[0].children[0].children.some((th) => th.dataset.col === 'sessions'), false, 'no sessions header either');
  assert.equal(rows.some((r) => 'live' in r.dataset), false, 'a stopped run has no live round');
  // every cell names its column, so a phone can drop the minor ones (T22); task and duration stay as title
  assert.deepEqual(rows[1].children.map((c) => c.dataset.col), ['n', 'role', 'task', 'outcome', 'commit', 'cost', 'span']);
  assert.equal(rows[1].title, 'task: A2.4 · took 29m');
  assert.equal(rows[0].title, 'took 9m', 'no task, the duration only');
  // the PR
  const art = byClass(page, 'rn-art');
  assert.equal(art.length, 1);
  const a = byClass(art[0], 'rn-item-t')[0];
  assert.equal(a.tagName, 'A');
  assert.equal(a.textContent, 'Readiness (agent loop) ↗');
  assert.equal(a.href, 'https://example.invalid/acme/acme-api/pull/7');
  assert.match(art[0].textContent, /^prReadiness \(agent loop\) ↗· round 2$/);
  // the unknown event, folded away
  const raw = byClass(page, 'rn-raw')[0];
  assert.equal(raw.tagName, 'DETAILS');
  assert.equal(raw.attrs.open, undefined, 'closed');
  assert.match(byClass(raw, 'rn-raw-s')[0].textContent, /^1 other event/);
  assert.match(byClass(raw, 'rn-raw-e')[0].textContent, /"t":"review\.note".*README install step 3/);
}));

test('the timeline: a live round runs to now, retries are counted, rounds sort by n', () => {
  const run = {
    state: 'running',
    rounds: [
      { n: 5, role: 'builder', startedAt: 1000, endedAt: null, starts: 2 },
      { n: 4, role: 'checker', startedAt: 0, endedAt: 500, outcome: 'kept', usd: 0.5, commit: '0123456789abcdef' },
      null, { n: 'x' },
    ],
  };
  const rows = roundRows(run, 1000 + 125_000);
  assert.deepEqual(rows.map((r) => r.n), [4, 5]);
  assert.equal(rows[0].short, '0123456');
  assert.equal(rows[0].commit, '0123456789abcdef');
  assert.equal(rows[0].span, '1s');
  assert.equal(rows[1].live, true);
  assert.equal(rows[1].outcome, 'running');
  assert.equal(rows[1].span, '2m');
  assert.equal(rows[1].starts, 2);
  assert.equal(rows[1].cost, '—');
  const stopped = roundRows({ ...run, state: 'stopped' }, 5000);
  assert.equal(stopped[1].live, false);
  assert.equal(stopped[1].outcome, null);
  assert.equal(stopped[1].span, '—');
  withDom(() => {
    const page = renderRunPage(null, { run: 'x', ...run }, { status: 'ok' }, 126_000);
    const live = byClass(page, 'rn-tl-row')[1];
    assert.equal(live.dataset.live, '');
    assert.equal(byClass(live, 'rn-tl-re')[0].textContent, ' ×2');
    assert.equal(byClass(page, 'rn-state-why').length, 0, 'no stop reason while it runs');
  });
  assert.equal(stopOf({ state: 'running' }), null);
  assert.deepEqual(stopOf({ state: 'stopped', stop: { reason: 'error', rounds: 1 } }),
    { reason: 'error', p: '1', why: 'error · after 1 round', detail: null, text: 'stopped · error · after 1 round', title: 'stopped: error' });
  assert.equal(stopOf({ state: 'stopped' }).text, 'stopped · unknown');
  assert.equal(stopOf({ state: 'stopped', stop: { reason: 'budget', ts: 0, usd: 9.98 } }).title,
    'stopped at 1970-01-01T00:00:00.000Z · the loop reported $9.98');
});

test('a run with nothing yet: empty sections say so, no null or undefined text', () => withDom(() => {
  const bare = { run: 'fresh', state: 'running', rounds: [], scores: {}, better: {}, needs: [], artifacts: [], raw: [], stop: null, cost: null, usage: null };
  const page = renderRunPage(null, bare, { status: 'ok' }, 0);
  const t = page.textContent;
  assert.doesNotMatch(t, /null|undefined|NaN/);
  assert.match(t, /No round has started yet/);
  assert.match(t, /Nothing open/);
  assert.match(t, /Nothing produced yet/);
  assert.equal(byClass(page, 'rn-raw').length, 0, 'no unknown events: no fold');
  assert.equal(byClass(page, 'rn-goal-t')[0].textContent, 'fresh', 'the id stands in for a missing goal');
  // a closed need (a wait after the next round) is not listed
  const waited = { ...bare, needs: [{ kind: 'wait', text: 'limit', open: false }, { kind: 'wait', text: 'again', open: true }] };
  const p2 = renderRunPage(null, waited, { status: 'ok' }, 0);
  const needs = byClass(p2, 'rn-need');
  assert.equal(needs.length, 1);
  assert.equal(needs[0].dataset.p, '3', 'a wait is the loop sleeping');
  assert.equal(runSummaryOf(null), null);
}));

test('a run made only of a posted run.stop: the id is the title, no null or undefined text', () => withDom(() => {
  for (const [line, reason] of [
    ['{"v":1,"t":"run.stop","run":"demo","reason":"human","ts":1760990000000}', 'human'],
    ['{"v":1,"t":"run.stop","run":"demo","ts":1760990000000}', 'unknown'],
  ]) {
    const parsed = parseLine(line);
    assert.ok(parsed.ok);
    const run = JSON.parse(JSON.stringify(foldRun([parsed.event])));
    const row = JSON.parse(JSON.stringify(summarize(run)));
    assert.equal(row.goal, null);
    assert.equal(row.rounds, 0);
    const host = document.createElement('div');
    renderRuns(host, [row], { status: 'ok' }, row.updatedAt + HOUR);
    const li = byClass(host, 'rn-row')[0];
    assert.doesNotMatch(li.textContent, /null|undefined|NaN/);
    assert.equal(byClass(li, 'rn-goal-t')[0].textContent, 'demo', 'the id stands in for the goal');
    assert.equal(byClass(li, 'rn-goal-sub').length, 0, 'no id repeated under itself, no empty line (T54)');
    assert.equal(byClass(li, 'rn-round')[0].textContent, '—');
    assert.equal(byClass(byClass(li, 'rn-left')[0], 'rn-v')[0].textContent, reason);
    assert.equal(li.dataset.state, 'stopped');
    const page = renderRunPage(null, run, { status: 'ok' }, row.updatedAt + HOUR);
    assert.doesNotMatch(page.textContent, /null|undefined|NaN/);
    assert.equal(byClass(page, 'rn-goal-t')[0].textContent, 'demo');
    assert.equal(byClass(page, 'rn-events')[0].textContent, '1 event');
    assert.match(page.textContent, /No round has started yet/);
  }
}));

test('loading, missing and error pages; an error keeps the last good run', () => withDom(() => {
  let page = renderRunPage(null, null, { status: 'loading', id: 'readiness' });
  assert.match(page.textContent, /Loading run readiness/);
  page = renderRunPage(null, null, { status: 'missing', id: 'gone' });
  assert.match(page.textContent, /No run gone here/);
  assert.equal(byClass(page, 'rn-back')[0].href, '#/runs');
  page = renderRunPage(null, null, { status: 'error', message: 'HTTP 500', id: 'x' });
  assert.match(page.textContent, /could not be loaded: HTTP 500/);
  page = renderRunPage(null, RUN, { status: 'error', message: 'offline', id: 'readiness' });
  assert.equal(byClass(page, 'rn-tl-row').length, 3);
  assert.match(byClass(page, 'rn-stale')[0].textContent, /Not refreshed: offline/);
}));

test('links from a loop: only http(s) becomes an <a>; everything else stays text', () => withDom(() => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'vbscript:x', ' https://a.example.invalid', 'https://a\nb', 42, null]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
  assert.equal(safeHref('http://example.invalid/x'), 'http://example.invalid/x');
  const evil = { run: 'x', state: 'running', artifacts: [{ kind: 'pr', url: 'javascript:alert(1)', n: 1 }],
    needs: [{ kind: 'decision', text: '<b>hi</b>', link: 'javascript:alert(2)', open: true }],
    raw: [{ t: 'x', raw: { t: 'x', html: '<img src=x onerror=alert(1)>' } }] };
  const page = renderRunPage(null, evil, { status: 'ok' }, 0);
  const art = byClass(page, 'rn-art')[0];
  assert.equal(byClass(art, 'rn-item-t')[0].tagName, 'SPAN');
  assert.equal(byClass(art, 'rn-item-t')[0].textContent, 'javascript:alert(1)');
  assert.equal(byClass(byClass(page, 'rn-need')[0], 'rn-item-l')[0].tagName, 'SPAN');
  assert.ok(texts(page).join('').includes('<b>hi</b>')); // as text (split at its `/` by T26's break chances)
  const walk = (n) => { assert.equal(n.innerHTML, '', 'no innerHTML'); n.children.forEach(walk); };
  walk(page);
  assert.deepEqual(artifactsOf(evil).map((a) => a.href), [null]);
}));

test('unknown events: at most RAW_SHOW shown, the last ones, each clamped', () => {
  const raw = Array.from({ length: RAW_SHOW + 5 }, (_, i) => ({ t: 'x', raw: { t: 'x', i, pad: 'p'.repeat(3000) } }));
  const r = rawOf({ raw });
  assert.equal(r.total, RAW_SHOW + 5);
  assert.equal(r.shown.length, RAW_SHOW);
  assert.match(r.shown[0].text, /"i":5,/);
  assert.ok(r.shown.every((e) => e.text.length <= 2000));
  assert.deepEqual(rawOf(null), { total: 0, shown: [] });
});

test('mount with route.run fetches GET /api/runs/<id>; a route change switches list <-> page', async () => withDomAsync(async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init?.method ?? 'GET']);
    if (url === '/api/runs/readiness') return { ok: true, status: 200, json: async () => ({ run: RUN }) };
    if (url === LIST_URL) return { ok: true, status: 200, json: async () => ({ runs: [FIX] }) };
    return { ok: false, status: 404, json: async () => ({ error: 'unknown run' }) };
  };
  const host = document.createElement('div');
  await mountRuns(host, { route: { ...emptyRoute('runs'), run: 'readiness' } }, { fetchFn, poll: false });
  assert.deepEqual(calls, [['/api/runs/readiness', 'GET']]);
  assert.equal(byClass(host, 'rn-tl-row').length, 3);
  const frame = byClass(host, 'panel')[0];
  assert.equal(frame.dataset.page, '', 'a run page marks its frame for the reading width (T31)');

  await updateRuns(null, { route: { ...emptyRoute('runs'), run: null } });
  assert.deepEqual(calls.at(-1), [LIST_URL, 'GET']);
  assert.equal(byClass(host, 'rn-row').length, 1);
  assert.equal(frame.dataset.page, undefined, 'the list takes the full width');
  assert.equal(byClass(host, 'rn-tl-row').length, 0);

  await updateRuns(null, { route: { ...emptyRoute('runs'), run: 'gone' } });
  assert.deepEqual(calls.at(-1), ['/api/runs/gone', 'GET']);
  assert.match(host.textContent, /No run gone here/);

  const n = calls.length;
  await updateRuns(null, { route: { ...emptyRoute('runs'), run: 'gone' } });
  assert.equal(calls.length, n, 'the same route again only repaints');
  unmountRuns();
  assert.equal(host.children.length, 0);

  assert.deepEqual(await loadRun('x', async () => { throw new Error('offline'); }), { kind: 'error', message: 'offline' });
  assert.deepEqual(await loadRun('x', async () => ({ ok: false, status: 500 })), { kind: 'error', message: 'HTTP 500' });
  assert.deepEqual(await loadRun('x', async () => ({ ok: true, status: 200, json: async () => ({}) })), { kind: 'missing', status: 200 });
}));

// ---------------------------------------------------------------- score charts (T11)

/** The loop's own night (test/fixtures/runs/loop-runs-n1.jsonl) as GET /api/runs/runs-n1 answers it. */
function loopRun() {
  const text = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/loop-runs-n1.jsonl'), 'utf8');
  const { events, skipped } = parseLines(text);
  return JSON.parse(JSON.stringify(foldRun(events, { skipped })));
}
const LOOP = loopRun();

test('charts: the loop fixture\'s tests and tasks, x by round on one shared scale, y in each range', () => {
  assert.deepEqual(chartDomain(LOOP), { lo: 0, hi: 11 }, 'the check before round 1 is round 0, the last round is 11');
  const charts = scoreCharts(LOOP);
  assert.deepEqual(charts.map((c) => c.name), ['tasks', 'tests']);
  const [tasks, tests] = charts;
  // x = 1 + n * 158 / 11, y = 1 + (1 - t) * 30 in a 160 x 32 box
  assert.deepEqual(tasks.points.map((p) => [p.n, p.value, p.x, p.y]), [
    [3, 0, 44.09, 31], [4, 1, 58.45, 21], [5, 1, 72.82, 21], [7, 1, 101.55, 21], [8, 2, 115.91, 11], [9, 3, 130.27, 1],
  ]);
  // two scores in round 3: the last one counts, so 9 points from 10 events
  assert.deepEqual(tests.points.map((p) => [p.n, p.value, p.x, p.y]), [
    [0, 0.9997, 1, 13.86], [2, 1, 29.73, 1], [3, 1, 44.09, 1], [4, 0.9993, 58.45, 31], [5, 1, 72.82, 1],
    [6, 1, 87.18, 1], [8, 1, 115.91, 1], [9, 1, 130.27, 1], [11, 1, CHART_W - 1, 1],
  ]);
  assert.equal(tasks.better, 'higher');
  assert.deepEqual([tasks.trend.mark, tasks.trend.good], ['↑', true]);
  assert.deepEqual([tests.trend.mark, tests.trend.good], ['=', null]);
  assert.equal(tests.title, 'tests: 0.9997 at round 0 to 1 at round 11, range 0.9993 to 1, higher is better');
  for (const c of charts) for (const p of c.points) {
    assert.ok(p.x >= 0 && p.x <= CHART_W && p.y >= 0 && p.y <= CHART_H, `${c.name} round ${p.n} inside the box`);
  }
});

test('charts on the page: one SVG line per metric between the needs and the timeline, no animation', () => withDom(() => {
  const page = renderRunPage(null, LOOP, { status: 'ok', id: 'runs-n1' }, LOOP.updatedAt);
  const secs = page.children.filter((c) => c.tagName === 'SECTION').map((c) => c.className);
  assert.deepEqual(secs, ['rn-sec rn-needs-sec', 'rn-sec rn-charts-sec', 'rn-sec rn-tl-sec', 'rn-sec rn-art-sec']);
  assert.equal(byClass(page, 'rn-charts-sec')[0].children[0].textContent, 'Scores (2)');
  const items = byClass(page, 'rn-chart');
  assert.deepEqual(items.map((li) => li.dataset.metric), ['tasks', 'tests']);
  const line = byClass(items[0], 'spark-line')[0];
  assert.equal(line.attrs.points, '44.09,31 58.45,21 72.82,21 101.55,21 115.91,11 130.27,1');
  const svg = byClass(items[0], 'rn-chart-svg')[0];
  assert.equal(svg.attrs.viewBox, `0 0 ${CHART_W} ${CHART_H}`);
  assert.equal(svg.attrs.role, 'img');
  assert.match(svg.attrs['aria-label'], /^tasks: 0 at round 3 to 3 at round 9, range 0 to 3, higher is better$/);
  const last = byClass(items[0], 'spark-last')[0];
  assert.equal(last.tagName.toLowerCase(), 'line');
  assert.deepEqual([last.attrs.x1, last.attrs.y1, last.attrs.x2, last.attrs.y2], ['130.27', '1', '130.27', '1']);
  assert.deepEqual(byClass(page, 'rn-chart-v').map((n) => n.textContent), ['3 ↑', '1 =']);
  assert.deepEqual(byClass(page, 'rn-chart-r').map((n) => n.textContent), ['0–3', '0.9993–1']);
  assert.equal(byClass(page, 'rn-chart-v').some((n) => n.dataset.p), false, 'nothing got worse: grey');
  assert.doesNotMatch(SRC.slice(SRC.indexOf('score charts')), /animate|transition|requestAnimationFrame/);
}));

test('charts: a score with a max reads "3 of 10" and is drawn against 0..max; no max keeps its range (T19)', () => withDom(() => {
  const base = { run: 'docs', state: 'running', rounds: [{ n: 1 }, { n: 2 }, { n: 3 }], needs: [], artifacts: [], raw: [], stop: null, cost: null, usage: null };
  const run = {
    ...base,
    scores: {
      tasks: [{ n: 1, value: 1, max: 8 }, { n: 2, value: 2, max: 10 }, { n: 3, value: 3, max: 10 }],
      tests: [{ n: 1, value: 0.84 }, { n: 3, value: 0.94 }],
    },
    better: { tasks: 'higher', tests: 'higher' },
  };
  const [tasks, tests] = scoreCharts(run);
  assert.equal(tasks.max, 10);
  // y = 1 + (1 - v / 10) * 30: 3 of 10 sits at 70% down, not at the top as its own 1..3 range would put it
  assert.deepEqual(tasks.points.map((p) => p.y), [28, 25, 22]);
  assert.equal(tasks.title, 'tasks: 1 at round 1 to 3 of 10 at round 3, scope 8 → 10, higher is better');
  assert.equal(tests.max, null);
  assert.deepEqual(tests.points.map((p) => p.y), [31, 1]);
  const page = renderRunPage(null, run, { status: 'ok' }, 0);
  const sec = byClass(page, 'rn-charts-sec')[0];
  assert.deepEqual(byClass(sec, 'rn-chart-v').map((n) => n.textContent), ['3 of 10 ↑', '0.94 ↑']);
  assert.deepEqual(byClass(sec, 'rn-chart-r').map((n) => n.textContent), ['scope 8 → 10', '0.84–0.94']);
  assert.doesNotMatch(sec.textContent, /1–3|0–3/);
  // a max that never moved: no scope note, an empty range cell
  const still = { ...run, scores: { tasks: [{ n: 1, value: 1, max: 10 }, { n: 3, value: 3, max: 10 }] } };
  const p2 = renderRunPage(null, still, { status: 'ok' }, 0);
  assert.equal(byClass(p2, 'rn-chart-r')[0].textContent, '');
  // a value past its max widens the scale, the line stays in the box
  const over = scoreCharts({ ...run, scores: { tasks: [{ n: 1, value: 2, max: 10 }, { n: 3, value: 12, max: 10 }] } })[0];
  for (const p of over.points) assert.ok(p.y >= 0 && p.y <= CHART_H);
}));

test('charts: `better` decides which way is good; a worse latest value is p2', () => withDom(() => {
  // readiness: lint 14 -> 9 with lower better is good, tests 0.88 -> 0.93 higher is good
  const page = renderRunPage(null, RUN, { status: 'ok', id: 'readiness' }, RUN.updatedAt);
  assert.deepEqual(byClass(page, 'rn-chart-v').map((n) => [n.textContent, n.dataset.p ?? null]), [['9 ↓', null], ['0.93 ↑', null]]);
  const worse = { ...RUN, scores: { lint: [{ n: 1, value: 9 }, { n: 2, value: 14 }] }, better: { lint: 'lower' } };
  const p2 = renderRunPage(null, worse, { status: 'ok' }, RUN.updatedAt);
  const v = byClass(p2, 'rn-chart-v')[0];
  assert.deepEqual([v.textContent, v.dataset.p], ['14 ↑', '2']);
}));

test('charts: a run with no score has an empty chart section; one point is a mark, no line', () => withDom(() => {
  const bare = { run: 'fresh', state: 'running', rounds: [], scores: {}, better: {}, needs: [], artifacts: [], raw: [], stop: null, cost: null, usage: null };
  assert.deepEqual(scoreCharts(bare), []);
  assert.equal(chartDomain(bare), null);
  const page = renderRunPage(null, bare, { status: 'ok' }, 0);
  const sec = byClass(page, 'rn-charts-sec')[0];
  assert.equal(sec.children[0].textContent, 'Scores (0)');
  assert.match(sec.textContent, /No score yet/);
  assert.equal(byClass(page, 'rn-chart').length, 0);
  assert.deepEqual(scoreCharts(null), []);
  // one score, in a run of three rounds: x at its round, y in the middle, no polyline
  const one = { ...bare, rounds: [{ n: 1 }, { n: 2 }, { n: 3 }], scores: { cov: [{ n: 2, value: 0.5 }] }, better: { cov: 'higher' } };
  const [c] = scoreCharts(one);
  assert.deepEqual(c.points.map((p) => [p.x, p.y]), [[80, CHART_H / 2]]);
  assert.equal(c.title, 'cov: 0.5 at round 2, higher is better');
  const p1 = renderRunPage(null, one, { status: 'ok' }, 0);
  assert.equal(byClass(p1, 'spark-line').length, 0);
  assert.equal(byClass(p1, 'spark-last').length, 1);
  assert.equal(byClass(p1, 'rn-chart-r')[0].textContent, 'round 2');
  assert.doesNotMatch(p1.textContent, /null|undefined|NaN/);
}));

test('charts: bad points are skipped, a huge round number does not blow up, names are clamped text', () => {
  const dom = { lo: 0, hi: 1e9 };
  const pts = chartPoints([{ n: 0, value: 1 }, { n: 1e9, value: 2 }, { n: 1.5, value: 3 }, { n: 2, value: 'x' }, null], dom);
  assert.deepEqual(pts.map((p) => [p.n, p.x, p.y]), [[0, 1, 31], [1e9, CHART_W - 1, 1]]);
  assert.deepEqual(chartPoints([{ n: 1, value: 1 }], null), []);
  const [c] = scoreCharts({ scores: { 'a\u0000b<i>': [{ n: 1, value: 1 }] }, better: {} });
  assert.doesNotMatch(c.name, /\u0000/);
  assert.match(c.name, /^a.b<i>$/, 'kept as text, the control character replaced');
  assert.equal(c.better, null);
  assert.equal(c.title, `${c.name}: 1 at round 1`);
  assert.deepEqual([chartNum(0.99974), chartNum(3), chartNum(null)], ['0.9997', '3', '—']);
});

// Seen at 390 (shots r7-T2 page-after): COST, DURATION and SESSIONS were cut at the right edge.
test('runs.css: a phone drops the rounds table\'s minor columns and keeps round, role, outcome, cost (T22)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const at = css.indexOf('@media (width < 700px)');
  assert.ok(at > 0, 'a phone block exists');
  const phone = css.slice(at);
  const hidden = [...phone.matchAll(/\.rn-tl \[data-col="([a-z]+)"\]/g)].map((m) => m[1]);
  assert.deepEqual(hidden.sort(), TL_NARROW_HIDDEN.slice().sort());
  assert.match(phone, /\.rn-tl \[data-col="sessions"\] \{ display: none; \}/);
  for (const keep of ['n', 'role', 'outcome', 'cost']) {
    assert.ok(!TL_NARROW_HIDDEN.includes(keep), `${keep} stays on a phone`);
    assert.doesNotMatch(css, new RegExp(`\\[data-col="${keep}"\\][^{]*\\{[^}]*display: none`), `${keep} is never hidden`);
  }
});

// reviews/13-designer.md Run page 6: at 390 the round title, T4's addition, did not show at all.
test('T23: a phone keeps each round\'s title and task id on a second line under the round', () => withDom(() => {
  assert.ok(!TL_NARROW_HIDDEN.includes('task'), 'the task cell is drawn on a phone');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media (width < 700px)'));
  assert.doesNotMatch(phone, /\.rn-tl \[data-col="task"\]/, 'no phone rule hides the task cell');
  // the rows are grid contents, the task cell spans the row as line two, in --text-2
  assert.match(phone, /\.rn-tl \{ display: grid;[^}]*grid-auto-flow: row dense;/, "line one fills back in after the task cell");
  assert.match(phone, /\.rn-tl tr \{ display: contents; \}/);
  const cell = phone.match(/\.rn-tl td\[data-col="task"\] \{([^}]*)\}/)?.[1] ?? '';
  assert.match(cell, /grid-column: 1 \/ -1;/);
  assert.match(cell, /color: var\(--text-2\);/);
  assert.match(cell, /white-space: normal;/, 'a long title wraps instead of being cut');
  assert.match(phone, /\.rn-tl th\[data-col="task"\] \{ display: none; \}/, 'no TASK header over line one');
  // the markup a phone draws: the title and task id in the row, an empty task cell flagged
  const run = JSON.parse(JSON.stringify(foldRun([
    { t: 'run.start', goal: 'g', ts: 1000 },
    { t: 'round.start', n: 1, role: 'builder', task: 'T4', title: 'The run page shows them', ts: 2000 },
    { t: 'round.end', n: 1, outcome: 'kept', commit: 'c3e4a5b0', usd: 3.68, ts: 3000 },
    { t: 'round.start', n: 2, role: 'reviewer', ts: 4000 },
  ].map((e) => parseLine(JSON.stringify({ v: 1, run: 'demo', ...e }))).map((r) => r.event))));
  const rows = byClass(renderRunPage(document.createElement('div'), run, { status: 'ok', id: 'demo' }, 9000), 'rn-tl-row');
  const task = byClass(rows[0], 'rn-tl-task')[0];
  assert.equal(task.dataset.col, 'task');
  assert.equal(task.textContent, 'The run page shows themT4');
  assert.equal(task.dataset.none, undefined);
  assert.equal(byClass(rows[1], 'rn-tl-task')[0].dataset.none, '', 'no title, no task: no second line');
  // line one, in column order: round, role, outcome, commit, cost
  const one = rows[0].children.filter((c) => !['task', ...TL_NARROW_HIDDEN].includes(c.dataset.col));
  assert.deepEqual(one.map((c) => c.textContent), ['1', 'builder', 'kept', 'c3e4a5b', '$3.68']);
}));

// Seen at 390 (shots r8-T3/before page/custom-*-390.png): the sparklines took half the row
// and the goal ended in "…" with no way to read it.
test('T26: a narrow run page stretches the score line to the row and wraps the goal whole', () => withDom(() => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
  assert.match(narrow, /\.rn-chart-svg \{[^}]*grid-column: 1 \/ -1;[^}]*width: 100%;/);
  assert.match(css, /\.rn-chart-svg \.spark-last \{[^}]*stroke-linecap: square;[^}]*vector-effect: non-scaling-stroke;/);
  const phone = css.slice(css.indexOf('@media (width < 700px)'));
  assert.match(phone, /\.rn-head \.rn-goal-t \{[^}]*white-space: normal;/);
  assert.match(phone, /\.rn-head \.rn-goal-t \{ overflow: visible; \}/);
  const goal = 'Add paged search to acme-api and the client, keep the old endpoint for one release';
  const page = renderRunPage(null, { ...RUN, goal }, { status: 'ok' }, FIX.updatedAt);
  const head = byClass(page, 'rn-head')[0];
  assert.equal(byClass(head, 'rn-goal-t')[0].textContent, goal, 'the page draws the goal whole');
  assert.ok(byClass(head, 'rn-goal')[0].title.startsWith(`${goal}\n`), 'and carries it as title');
  const svg = byClass(page, 'rn-chart-svg')[0];
  assert.equal(svg.attrs.preserveAspectRatio, 'none');
}));

// Seen at 1440 (reviews/11-designer.md, new 2): the page spread over 1650 px, the line sat at
// 220 px with its value floating mid-row, and task/sessions took the table's width.
test('T27: the run page stops at a reading width and its score line fills the row', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const tokens = fs.readFileSync(path.join(ROOT, 'public/css/tokens.css'), 'utf8');
  const px = Number(tokens.match(/--read-max: (\d+)px;/)?.[1]);
  assert.ok(px >= 960 && px <= 1100, `a reading width near 1000 px, got ${px}`);
  const wide = css.slice(0, css.indexOf('@media (max-width: 1024px)'));
  assert.match(wide, /\.rn-page \{[^}]*max-width: var\(--read-max\);/);
  // name, line, value, range: the svg fills its column (T57 caps that column at half the row)
  assert.match(wide, /\.rn-chart \{[^}]*grid-template-columns: minmax\(8ch, 16ch\) minmax\(0, 50%\) minmax\(10ch, max-content\) minmax\(8ch, 1fr\);/);
  assert.match(wide, /\.rn-chart-svg \{ width: 100%; \}/);
  // the minor columns stay narrow
  const task = Number(wide.match(/\.rn-tl-task \{ max-width: (\d+)ch;/)?.[1]);
  assert.ok(task > 0 && task <= 24, `task column at most 24ch, got ${task}`);
  assert.match(wide, /\.rn-tl td\.rn-tl-ses \{[^}]*white-space: normal;/);
  assert.match(wide, /\.rn-tl-s \{ white-space: nowrap; \}/);
});

// Designer r10 idea 5: at 1440 the score line ran 600 px with no axes and the rounds table spread
// outcome and cost to the page edge, far from the round they belong to.
test('T57: the score line is at most half the row and the rounds table is content-sized, at most 900 px', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const tokens = fs.readFileSync(path.join(ROOT, 'public/css/tokens.css'), 'utf8');
  const wide = css.slice(0, css.indexOf('@media (max-width: 1024px)'));
  const cols = wide.match(/\.rn-chart \{[^}]*grid-template-columns:\s*([^;]+);/)[1].trim().match(/[a-z-]+\([^)]*\)|\S+/g);
  assert.equal(cols.length, 4, 'name, line, value, range');
  const cap = Number(cols[1].match(/^minmax\(0, (\d+)%\)$/)?.[1]);
  assert.ok(cap > 0 && cap <= 50, `the line's column is at most 50 % of the row, got ${cols[1]}`);
  assert.match(cols[2], /max-content/, 'the value sits right after the line, not mid-row');
  assert.equal(cols.filter((c) => /fr\b/.test(c)).length, 1, 'the range takes what is left');
  assert.match(cols[3], /1fr/);
  // the table: content-sized columns, capped by a token near 900 px, never wider than the page
  const tl = wide.match(/\.rn-tl \{([^}]*)\}/)[1];
  assert.match(tl, /width: auto;/);
  assert.doesNotMatch(tl, /(^|[^-])width: 100%/);
  assert.match(tl, /max-width: min\(100%, var\(--table-max\)\);/);
  const px = Number(tokens.match(/--table-max: (\d+)px;/)?.[1]);
  assert.ok(px >= 860 && px <= 940, `a table width near 900 px, got ${px}`);
  assert.ok(px < Number(tokens.match(/--read-max: (\d+)px;/)?.[1]), 'inside the page\'s reading width');
});

test('T25: a label and its value share one cell: "stop budget", "cost $9.98"', () => withDom(() => {
  const host = document.createElement('div');
  const budget = { ...FIX, stop: 'budget', cost: { usd: 9.98 } };
  renderRuns(host, [budget, LIVE], { status: 'ok' }, FIX.updatedAt);
  const [stopped, live] = byClass(host, 'rn-row');
  // the row is a grid: each of its direct children is one column
  const cells = stopped.children.map((c) => c.className);
  const left = byClass(stopped, 'rn-left')[0];
  const cost = byClass(stopped, 'rn-cost')[0];
  assert.ok(cells.includes(left.className) && cells.includes(cost.className), 'stop and cost are row cells');
  assert.deepEqual(left.children.map((c) => [c.className, c.textContent]), [['rn-k', 'stop'], ['rn-v', 'budget']]);
  assert.deepEqual(cost.children.map((c) => [c.className, c.textContent]), [['rn-k', 'cost'], ['rn-v', '$9.98']]);
  assert.equal(left.title, 'stopped: budget');
  // a live run keeps its one-piece "3h 05m left"; its cost is labelled too
  assert.equal(byClass(live, 'rn-left')[0].children.length, 0);
  assert.equal(byClass(byClass(live, 'rn-cost')[0], 'rn-k')[0].textContent, 'cost');
  // the run page head uses the same cells
  const page = renderRunPage(null, RUN, { status: 'ok' }, FIX.updatedAt);
  assert.equal(byClass(byClass(page, 'rn-cost')[0], 'rn-k')[0].textContent, 'cost');
  // the label is muted text inside the cell, not a grid column of its own
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  assert.match(css, /\.rn-k \{[^}]*color: var\(--text-3\)/);
  assert.doesNotMatch(css, /\.rn-k \{[^}]*grid-column/);
}));

test('T17: the run page folds the stop into the state label: one label, no stop line, no stop cell', () => withDom(() => {
  const run = { ...RUN, stop: { reason: 'budget', rounds: 7, usd: 9.98, ts: RUN.updatedAt } };
  const page = renderRunPage(null, run, { status: 'ok' }, FIX.updatedAt);
  const head = byClass(page, 'rn-head')[0];
  const labels = byClass(page, 'rn-state');
  assert.equal(labels.length, 1, 'one state label on the page');
  const label = labels[0];
  assert.deepEqual(label.children.slice(1).map((c) => [c.className, c.textContent]),
    [['rn-state-t', 'stopped'], ['rn-state-why', '· budget · after 7 rounds']]);
  assert.equal(label.dataset.p, 'off', 'a budget stop is grey');
  assert.match(label.title, /^stopped at .* · the loop reported \$9\.98$/);
  // no second stop line, and the head's facts hold no "stop budget" cell
  assert.equal(byClass(page, 'rn-stop').length, 0);
  assert.equal(byClass(head, 'rn-left').length, 0);
  const said = (page.textContent.match(/budget/g) ?? []).length;
  assert.equal(said, 1, 'the reason is said once');
  assert.equal(byClass(head, 'rn-cost')[0].textContent, 'cost$3.75', 'the cost stays a fact');
  // a running run keeps its time-left cell and a bare label
  const live = renderRunPage(null, { ...RUN, state: 'running', stop: null }, { status: 'ok' }, FIX.updatedAt);
  assert.equal(byClass(live, 'rn-left').length, 1);
  assert.equal(byClass(live, 'rn-state-why').length, 0);
  // the list row is unchanged: its stop reason stays a cell of the grid
  const host = document.createElement('div');
  renderRuns(host, [{ ...FIX, stop: 'budget' }], { status: 'ok' }, FIX.updatedAt);
  assert.equal(byClass(host, 'rn-state-why').length, 0);
  assert.equal(byClass(byClass(host, 'rn-left')[0], 'rn-v')[0].textContent, 'budget');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  assert.doesNotMatch(css, /\.rn-stop\b/, 'the stop line rules are gone');
  assert.match(css, /\.rn-state\[data-p="2"\] \.rn-state-why \{ color: var\(--p2\); \}/);
}));

test('T44: the goal is the one flexible column of the list, every row a subgrid of it, the full goal its title', () => withDom(() => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const wide = css.slice(0, css.indexOf('@media (max-width: 1024px)'));
  const list = wide.match(/\.rn-list \{[^}]*grid-template-columns:\s*([^;]+);/);
  assert.ok(list, 'the list holds the columns');
  // split on top-level spaces: one entry per column, in row order (state, goal, round, scores, burn, left, cost)
  const cols = list[1].trim().match(/[a-z-]+\([^)]*(?:\([^)]*\)[^)]*)*\)|\S+/g);
  assert.equal(cols.length, 7, 'no needs column: the need is the goal\'s second line (T31)');
  assert.deepEqual(cols.filter((c) => /fr\b/.test(c)), ['minmax(0, 1fr)'], 'one flexible column');
  assert.equal(cols[1], 'minmax(0, 1fr)', 'and it is the goal');
  assert.match(wide, /\.rn-row \{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: subgrid;/);
  // the narrow layout moves its columns to the list too
  const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
  assert.match(narrow, /\.rn-list \{[^}]*grid-template-columns: minmax\(10ch, auto\) minmax\(0, 1fr\) auto;/);
  // a goal that clips still reads whole in the cell's title
  const goal = 'Move acme-api billing to the new invoice table, test every path and keep the old one readable';
  const host = document.createElement('div');
  renderRuns(host, [{ ...FIX, goal }], { status: 'ok' }, FIX.updatedAt);
  const cell = byClass(host, 'rn-goal')[0];
  assert.equal(cell.title.split('\n')[0], goal);
  assert.equal(byClass(cell, 'rn-goal-t')[0].textContent, goal);
}));

// Seen at 1440 (reviews/r22-designer.md, Runs list 1, Run page 2): the meters and their "—" floated,
// the need was a last column clipped where there was room, and the run page's frame ran 270 px past
// its content.
test('T31: the list columns have fixed widths, the need sits under the goal, the run page frame is one width', () => withDom(() => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const wide = css.slice(0, css.indexOf('@media (max-width: 1024px)'));
  const list = wide.match(/\.rn-list \{[^}]*grid-template-columns:\s*([^;]+);/);
  const cols = list[1].trim().match(/[a-z-]+\([^)]*(?:\([^)]*\)[^)]*)*\)|\S+/g);
  // state, round, scores, burn, stop/left, cost: a fixed `ch` each, no auto, no fit-content
  for (const i of [0, 2, 3, 4, 5, 6]) assert.match(cols[i], /^\d+ch$/, `column ${i} is fixed: ${cols[i]}`);
  assert.match(wide, /\.rn-list \{[^}]*font-family: var\(--font-mono\);[^}]*font-size: var\(--fs-12\);/, 'a ch is the row\'s mono digit');
  // each window a fixed label/bar/value grid, so a "—" sits where a value would
  assert.match(wide, /\.rn-win \{[^}]*grid-template-columns: 2ch 40px 4ch;/);
  // the need is in the goal cell, never a cell of the row
  const host = document.createElement('div');
  renderRuns(host, [FIX], { status: 'ok' }, FIX.updatedAt);
  const row = byClass(host, 'rn-row')[0];
  assert.equal(row.children.length, 7);
  assert.equal(row.children.some((c) => /\brn-needs\b/.test(c.className)), false, 'no needs column');
  assert.ok(!/\brn-needs\b/.test(row.children.at(-1).className));
  const line = byClass(byClass(row, 'rn-goal')[0], 'rn-goal-2')[0];
  assert.ok(line, 'the goal has a second line');
  assert.deepEqual(line.children.map((c) => c.className.split(' ').at(-1)), ['rn-goal-sub', 'rn-needs']);
  assert.match(byClass(line, 'rn-needs-t')[0].textContent, /^decision: Drop the v1 export endpoint/);
  assert.equal(byClass(row, 'rn-cost')[0], row.children.at(-1), 'cost closes the row');
  // the run page: its frame stops at the token the page does
  assert.match(wide, /#view-runs > \.panel\[data-page\] \{ max-width: var\(--read-max\); \}/);
  assert.match(wide, /\.rn-page \{[^}]*max-width: var\(--read-max\);/);
  const tokens = css.match(/max-width: var\(--[a-z-]+\)/g).filter((x) => !/100%/.test(x));
  assert.deepEqual([...new Set(tokens)], ['max-width: var(--read-max)'], 'one width token on the page and its frame');
}));

test('T28: an open need gives the needs.ack payload and its link; a closed or waiting one no ack', () => {
  const need = { i: 2, kind: 'decision', text: 'Keep the old export?', link: 'https://example.invalid/acme/pull/7', open: true };
  assert.deepEqual(needActions(need, 'acme-search'), {
    ack: { v: 1, t: 'needs.ack', run: 'acme-search', ref: 2, by: ACK_BY },
    open: 'https://example.invalid/acme/pull/7',
  });
  assert.deepEqual(needActions({ ...need, open: false }, 'acme-search'), { ack: null, open: null }, 'closed: no buttons');
  assert.equal(needActions({ ...need, kind: 'wait' }, 'acme-search').ack, null, 'a wait closes itself');
  assert.equal(needActions({ ...need, i: undefined }, 'acme-search').ack, null, 'no place, no ack');
  // T5: a need with a time is acked by its ts (places shift across sources).
  assert.equal(needActions({ ...need, ts: 1792483201000 }, 'acme-search').ack.ref, 1792483201000);
  assert.equal(needActions(need, '../x').ack, null, 'not a run id');
  assert.equal(needActions({ ...need, link: 'javascript:alert(1)' }, 'acme-search').open, null);
  assert.deepEqual(needActions(null, 'acme-search'), { ack: null, open: null });
  assert.equal(EVENTS_URL, '/api/runs/events');
});

test('T28: ACK on the run page posts needs.ack to POST /api/runs/events and reloads the run', async () => withDomAsync(async () => {
  const calls = [];
  let open = true;
  const get = async (url) => {
    calls.push(['GET', url]);
    const run = { ...RUN, needs: RUN.needs.map((n) => ({ ...n, open: open && n.open })) };
    return { ok: true, status: 200, json: async () => ({ run }) };
  };
  const post = async (url, init) => {
    calls.push([init.method, url, JSON.parse(init.body), init.headers['x-laneboard']]);
    open = false;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const host = document.createElement('div');
  await mountRuns(host, { route: { run: RUN.run } }, { fetchFn: get, postFn: post, poll: false });
  assert.equal(byClass(host, 'rn-need-ack').length, 1);
  const i = RUN.needs.find((n) => n.open).i;
  assert.equal(await ackNeed(needActions(RUN.needs.find((n) => n.open), RUN.run).ack, { confirm: async () => ({ ok: false }) }), false, 'cancelled');
  assert.equal(calls.length, 1, 'nothing posted on cancel');
  const done = await ackNeed({ v: 1, t: 'needs.ack', run: RUN.run, ref: i, by: ACK_BY }, { confirm: async () => ({ ok: true }) });
  assert.equal(done, true);
  assert.deepEqual(calls.slice(1), [
    ['POST', '/api/runs/events', { v: 1, t: 'needs.ack', run: RUN.run, ref: i, by: ACK_BY }, '1'],
    ['GET', runUrl(RUN.run)],
  ]);
  assert.equal(byClass(host, 'rn-need-ack').length, 0, 'the need is gone after the reload');
  unmountRuns();
}));

test('night 4 T6: the run page shows who acked a closed need, and a fence the loop acked stays open', () => withDom((document) => {
  const text = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/readiness.jsonl'), 'utf8');
  const fence = { v: 1, t: 'needs', run: 'readiness', ts: 1792487401000, kind: 'fence', text: 'round 3 wanted to change fenced files: server/http.mjs' };
  const extra = [
    fence,
    { ...fence, ts: 1792487402000, text: 'round 4 wanted to change fenced files: .github/ci.yml' },
    { v: 1, t: 'needs.ack', run: 'readiness', ts: 1792487403000, ref: 1792487401000, by: 'loop' },
    { v: 1, t: 'needs.ack', run: 'readiness', ts: 1792487404000, ref: 1792487401000, by: 'inbox' },
    { v: 1, t: 'needs.ack', run: 'readiness', ts: 1792487405000, ref: 1792487402000, by: 'loop' },
  ].map((o) => JSON.stringify(o)).join('\n');
  const run = JSON.parse(JSON.stringify(foldRun(parseLines(`${text}\n${extra}`).events)));
  const now = 1792487404000 + 5 * MIN;
  assert.deepEqual(ackedNeedsOf(run, now).map((x) => [x.kind, x.by, x.line, x.title]), [
    ['fence', 'inbox', 'acked by inbox 5m ago', `acked at ${new Date(1792487404000).toISOString()}`],
  ]);
  assert.deepEqual(ackedNeedsOf({ needs: [{ acked: true, ackedAt: null, by: null, text: 'x' }] }).map((x) => x.line), ['acked by ?']);
  assert.deepEqual(ackedNeedsOf(null), []);

  const host = document.createElement('div');
  renderRunPage(host, run, { status: 'ok' }, now);
  assert.deepEqual([...byClass(host, 'rn-need-by')].map((n) => n.textContent), ['acked by inbox 5m ago']);
  const acked = byClass(host, 'rn-need--acked');
  assert.equal(acked.length, 1);
  assert.equal(acked[0].dataset.p, 'off', 'a closed need is grey');
  assert.equal(byClass(acked[0], 'rn-need-ack').length, 0, 'no Ack on a closed need');
  // the decision and the fence the loop tried to ack are still open, each with its Ack
  assert.equal(byClass(host, 'rn-need-ack').length, 2);
  assert.equal(byClass(byClass(host, 'rn-needs-sec')[0], 'rn-sec-t')[0].textContent, 'Open needs (2)');
}));

test('T22: score trends on the Runs list and the run page are arrows, never the ▲/■ status shapes', () => withDom(() => {
  const host = document.createElement('div');
  renderRuns(host, [FIX], { status: 'ok' }, FIX.updatedAt);
  const page = renderRunPage(null, RUN, { status: 'ok', id: 'readiness' }, RUN.updatedAt);
  const cells = [...byClass(host, 'rn-score'), ...byClass(page, 'rn-score'), ...byClass(page, 'rn-chart-v')];
  assert.ok(cells.length >= 6);
  for (const c of cells) assert.doesNotMatch(c.textContent, /[▲▼■]/, c.textContent);
  assert.deepEqual([3, 1, 2].map((value) => scoreTrend({ value, prev: 2 }).mark), ['↑', '↓', '=']);
}));

test('needs cell: one line, the count only when more than one need is open (T29)', () => {
  const one = needsCell({ needs: [{ kind: 'decision', text: 'Keep the old flag?' }] });
  assert.equal(one.count, null, 'one need: no count');
  assert.equal(one.mark, '▲');
  assert.equal(one.text, 'decision: Keep the old flag?');
  const two = needsCell({ needs: [{ kind: 'wait', text: 'rate limit' }, { kind: 'decision', text: 'Keep the old flag?' }] });
  assert.equal(two.count, 2);
  assert.equal(two.text, 'decision: Keep the old flag?', 'the need a person answers is the one shown');
  assert.equal(needsCell({ needs: [{ kind: 'wait', text: 'rate limit' }] }).mark, '○');
  assert.equal(needsCell({ needs: [] }), null);
  withDom(() => {
    const host = document.createElement('div');
    renderRuns(host, [{ run: 'r', state: 'running', needs: [{ kind: 'decision', text: 'a' }, { kind: 'review', text: 'b' }] }]);
    assert.equal(byClass(host, 'rn-needs-n')[0].textContent, '▲ 2');
  });
});

test('runs.css: on a narrow screen the needs cell does not wrap its count away from the text (T29)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
  const rule = narrow.match(/\.rn-needs\s*\{([^}]*)\}/);
  assert.ok(rule, 'a narrow .rn-needs rule');
  assert.doesNotMatch(rule[1], /flex-wrap:\s*wrap|white-space:\s*normal/);
  assert.match(css, /\.rn-needs-t\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
});

test('T30: a stopped run\'s windows stay grey at 92 %; a running one near the limit is amber', () => withDom(() => {
  assert.equal(burnOf(LIVE.usage, 'running').fiveHour.warn, true);
  assert.equal(burnOf(LIVE.usage, 'waiting').fiveHour.warn, true);
  assert.equal(burnOf(LIVE.usage, 'stopped').fiveHour.warn, false);
  assert.equal(burnOf({ sevenDayPct: 99 }, 'stopped').sevenDay.warn, false);
  assert.equal(burnOf(LIVE.usage, 'stopped').fiveHour.text, '92%', 'the value still shows');
  const host = document.createElement('div');
  renderRuns(host, [{ ...LIVE, state: 'stopped', stop: 'budget' }], { status: 'ok' }, FIX.updatedAt);
  const wins = byClass(byClass(host, 'rn-row')[0], 'rn-win');
  assert.equal(wins[0].dataset.p, undefined, 'no hue on a stopped run');
  assert.doesNotMatch(wins[0].attrs['aria-label'], /near the stop level/);
}));

// Seen in reviews/25-designer.md (new 3): SESSIONS read `—` in every row of the run page.
test('T40: the rounds table draws the sessions column only when some round has a session', () => {
  const keys = (rows) => tlColumns(rows).map(([k]) => k);
  const bare = { sessions: [] };
  assert.deepEqual(keys([bare, bare]), ['n', 'role', 'task', 'outcome', 'commit', 'cost', 'span']);
  assert.deepEqual(keys([]), ['n', 'role', 'task', 'outcome', 'commit', 'cost', 'span']);
  assert.deepEqual(keys([bare, { sessions: [{ id: 'x' }] }]), ['n', 'role', 'task', 'outcome', 'commit', 'cost', 'span', 'sessions']);
  assert.deepEqual(tlColumns([bare, { sessions: [{ id: 'x' }] }]).at(-1), ['sessions', 'sessions']);
});

test('night 4 T26: a need row has a fixed kind column, a path breaks at `/`, and on a phone its end drops to its own line', () => withDom((document) => {
  const text = fs.readFileSync(path.join(ROOT, 'test/fixtures/runs/readiness.jsonl'), 'utf8');
  const fence = { v: 1, t: 'needs', run: 'readiness', ts: 1792487401000, kind: 'fence', text: 'round 4 wanted to change fenced files: server/http.mjs' };
  const extra = [fence, { v: 1, t: 'needs.ack', run: 'readiness', ts: 1792487404000, ref: 1792487401000, by: 'inbox' }]
    .map((o) => JSON.stringify(o)).join('\n');
  const run = JSON.parse(JSON.stringify(foldRun(parseLines(`${text}\n${extra}`).events)));
  const host = document.createElement('div');
  renderRunPage(host, run, { status: 'ok' }, 1792487404000 + 5 * MIN);
  const rows = [...byClass(host, 'rn-need')];
  assert.ok(rows.some((r) => r.classList.contains('rn-need--acked')) && rows.some((r) => !r.classList.contains('rn-need--acked')));
  for (const r of rows) {
    // mark, kind, text, end: the same four cells open or closed, so the grid lines them up
    const cells = ['rn-need-m', 'rn-need-k', 'rn-need-t', 'rn-need-end'];
    assert.equal(r.children.length, 4);
    cells.forEach((cls, k) => assert.ok(r.children[k].classList.contains(cls), `${cls} at ${k}`));
  }
  const closed = byClass(host, 'rn-need--acked')[0];
  const t = byClass(closed, 'rn-need-t')[0];
  assert.equal(t.textContent, 'round 4 wanted to change fenced files: server/http.mjs');
  assert.deepEqual(t.children.map((c) => c.tagName.toLowerCase()), ['#text', 'wbr', '#text'], 'one break chance, after the /');
  assert.equal(t.children[0].textContent, 'round 4 wanted to change fenced files: server/');
  assert.equal(byClass(closed, 'rn-need-k')[0].title, 'fence');

  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const wide = css.slice(0, css.indexOf('@media'));
  assert.match(wide, /\.rn-need\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*2ch 8ch minmax\(0, 1fr\) auto/, 'a fixed kind column');
  assert.match(wide, /\.rn-need-t\s*\{[^}]*overflow-wrap:\s*break-word/, 'no break inside a word');
  assert.doesNotMatch(wide.match(/\.rn-need-t\s*\{[^}]*\}/)[0], /anywhere/);
  const phone = css.slice(css.indexOf('@media (width < 700px)'));
  assert.match(phone, /\.rn-need\s*\{\s*grid-template-columns:\s*2ch 8ch minmax\(0, 1fr\);/, 'three columns on a phone');
  assert.match(phone, /\.rn-need-end\s*\{\s*grid-column:\s*1 \/ -1;/, 'the end on its own line');
  assert.match(wide, /\.rn-need-end\s*\{\s*justify-self:\s*end;/, 'right-aligned');
}));

test('a run stopped with usd 2 and no cost event shows $2 on its row and page, marked as the loop\'s (night 4 T34)', () => withDom(() => {
  const events = [
    { t: 'run.start', goal: 'Try it' },
    { t: 'round.start', n: 1 },
    { t: 'run.stop', reason: 'budget', rounds: 1, usd: 2 },
  ].map((e) => parseLine(JSON.stringify({ v: 1, run: 'demo', ...e }))).map((r) => r.event);
  const run = JSON.parse(JSON.stringify(foldRun(events)));
  assert.deepEqual(run.cost, { usd: null, rounds: 0, from: null });
  const row = JSON.parse(JSON.stringify(summarize(run)));
  assert.equal(row.stopUsd, 2);
  const host = document.createElement('div');
  renderRuns(host, [row], { status: 'ok' }, run.updatedAt);
  const li = byClass(host, 'rn-row')[0];
  const cell = byClass(li, 'rn-cost')[0];
  assert.equal(cell.textContent, 'cost$2.00loop');
  assert.equal(cell.dataset.src, 'stop');
  assert.match(cell.title, /loop reported at run\.stop/);
  const page = renderRunPage(document.createElement('div'), run, { status: 'ok', id: 'demo' }, run.updatedAt);
  const pcell = byClass(page, 'rn-cost')[0];
  assert.equal(pcell.textContent, 'cost$2.00loop');
  assert.ok(!pcell.textContent.includes('$0'));
  // a run with cost events keeps their sum, whatever the stop says
  assert.deepEqual(runCostOf({ cost: { usd: 3.75, rounds: 3 }, stopUsd: 9 }).text, '$3.75');
  assert.equal(runCostOf({ cost: { usd: 3.75, rounds: 3 }, stopUsd: 9 }).loop, false);
  assert.equal(runCostOf({ cost: { usd: 0, rounds: 0 }, stopUsd: null }).text, '$0.00');
  // T6: no cost events, the rounds' usd summed: that sum, not the stop's figure
  const fromRounds = runCostOf({ cost: { usd: 1.75, rounds: 0, from: 'rounds' }, stopUsd: 9 });
  assert.equal(fromRounds.text, '$1.75');
  assert.equal(fromRounds.loop, false);
  assert.match(fromRounds.title, /rounds' usd/);
  assert.equal(runCostOf({ cost: { usd: null, rounds: 0, from: null }, stopUsd: null }).text, '—');
}));

test('T4: the run page shows round titles, session links, the stop detail and the wrap-up round', () => withDom(() => {
  const events = [
    { t: 'run.start', goal: 'Build it', budget: { rounds: 2 }, ts: 1000 },
    { t: 'round.start', n: 1, role: 'builder', task: 'T4', title: 'The run page shows them', session: 'aaaaaaaa-1111-2222-3333-444444444444', ts: 2000 },
    { t: 'round.end', n: 1, outcome: 'done', usd: 0.5, ts: 3000 },
    { t: 'round.start', n: 2, role: 'builder', task: 'T5', session: 'bbbbbbbb-1111-2222-3333-444444444444', ts: 4000 },
    { t: 'round.end', n: 2, outcome: 'done', ts: 5000 },
    { t: 'run.stop', reason: 'rounds', rounds: 2, detail: 'the cap of 2 rounds was reached', ts: 6000 },
    { t: 'round.start', n: 3, role: 'operator', task: 'wrap-up', wrapup: true, ts: 7000 },
    { t: 'round.end', n: 3, outcome: 'done', ts: 8000 },
  ].map((e) => parseLine(JSON.stringify({ v: 1, run: 'demo', ...e }))).map((r) => r.event);
  const run = JSON.parse(JSON.stringify(foldRun(events)));
  // the route's bind: round 1's session is one the board saw under a name, round 2's only an id
  run.rounds[0].sessions = [{ sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'builder-a-run', how: 'id' }];
  run.rounds[1].sessions = [{ sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', how: 'id' }];
  assert.equal(run.state, 'stopped');

  const sum = runSummaryOf(run);
  assert.equal(sum.round, 2, 'the wrap-up is not the head round');
  assert.equal(sum.rounds, 2);
  assert.equal(roundText(sum), '2 / 2');

  const page = renderRunPage(null, run, { status: 'ok', id: 'demo' }, 9000);
  const t = page.textContent;
  assert.doesNotMatch(t, /3 \/ 2|3 of 2/, 'never more rounds than the cap');
  assert.doesNotMatch(t, /null|undefined|NaN/);

  const rows = byClass(page, 'rn-tl-row');
  assert.equal(rows.length, 3);
  // the title, the task id muted beside it; a round without a title keeps its task
  assert.equal(byClass(rows[0], 'rn-tl-title')[0].textContent, 'The run page shows them');
  assert.equal(byClass(rows[0], 'rn-tl-tid')[0].textContent, 'T4');
  assert.match(rows[0].title, /^The run page shows them · task: T4/);
  assert.equal(byClass(rows[1], 'rn-tl-task')[0].textContent, 'T5');
  assert.equal(byClass(rows[1], 'rn-tl-title').length, 0);
  // an unknown round cost is a dash, a known one money
  assert.equal(byClass(rows[0], 'rn-tl-cost')[0].textContent, '$0.50');
  assert.equal(byClass(rows[1], 'rn-tl-cost')[0].textContent, '—');
  // the wrap-up round
  assert.equal(rows[2].dataset.wrapup, '');
  assert.equal(byClass(rows[2], 'rn-tl-n')[0].textContent, 'wrap-up');
  assert.match(byClass(rows[2], 'rn-tl-n')[0].title, /not counted/);
  // T21: `wrap-up` once in the row, in the ROUND cell; the task cell is empty, the tooltip has no task
  assert.equal(rows[2].textContent.match(/wrap-up/g).length, 1);
  assert.equal(byClass(rows[2], 'rn-tl-task')[0].textContent, '');
  assert.doesNotMatch(rows[2].title, /task: wrap-up/);

  // a named session links to its sheet; an id-only one is plain text
  const linked = byClass(rows[0], 'rn-tl-s')[0];
  assert.equal(linked.tagName.toLowerCase(), 'a');
  assert.equal(linked.href, '#session=builder-a-run');
  assert.equal(parseHash(linked.href, { localId: 'builder-a' }).sel, 'builder-a/builder-a-run', 'the router opens that session');
  const plain = byClass(rows[1], 'rn-tl-s')[0];
  assert.equal(plain.tagName.toLowerCase(), 'span');
  assert.equal(plain.href, undefined);
  assert.equal(plain.textContent, 'bbbbbbbb —');

  // T22: the link is marked: a ↗ inside the session anchor, and the role links to the same session
  assert.equal(byClass(linked, 'rn-item-arrow')[0].textContent, ' ↗');
  assert.equal(byClass(linked, 'rn-item-arrow')[0].getAttribute('aria-hidden'), 'true');
  const role = byClass(rows[0], 'rn-tl-role')[0];
  const roleLink = byClass(role, 'rn-tl-role-a')[0];
  assert.equal(roleLink.tagName.toLowerCase(), 'a');
  assert.equal(roleLink.href, '#session=builder-a-run');
  assert.match(roleLink.textContent, / ↗$/);
  assert.equal(byClass(rows[1], 'rn-tl-role-a').length, 0, 'a session known only by its id links nothing');
  assert.equal(byClass(rows[1], 'rn-item-arrow').length, 0);

  // the stop's detail on its own line under the reason
  const state = byClass(page, 'rn-state')[0];
  assert.equal(state.dataset.detail, '');
  assert.equal(byClass(state, 'rn-state-why')[0].textContent, '· rounds · after 2 rounds');
  assert.equal(byClass(state, 'rn-state-detail')[0].textContent, 'the cap of 2 rounds was reached');
  assert.match(state.title, /the cap of 2 rounds was reached/);
  // no detail, no line
  const plainStop = renderRunPage(null, { ...run, stop: { ...run.stop, detail: null } }, { status: 'ok' }, 9000);
  assert.equal(byClass(plainStop, 'rn-state-detail').length, 0);
}));

test('T4: a session name the router would refuse gets no link', () => {
  const r = { sessions: [{ sessionId: 'x1', name: 'a/b' }, { sessionId: 'x2', name: 'ok\u0007' }, { sessionId: 'x3', name: 'web 1' }] };
  const out = roundSessions(r);
  assert.deepEqual(out.map((s) => s.href), [null, null, '#session=web%201']);
});

test('T4: the wrap-up and title rules have their CSS', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  assert.match(css, /\.rn-state-detail \{[^}]*flex-basis: 100%/);
  assert.match(css, /\.rn-tl-tid \{[^}]*color: var\(--text-3\)/);
});

// runs-n5 T5: the `tasks` score's max drives "44 of 63", and a moved max shows as scope (research Q18).
const SCOPED = (() => {
  const lines = [
    { t: 'run.start', goal: 'Build the night', budget: { rounds: 80 } },
    { t: 'round.start', n: 1, role: 'planner' },
    { t: 'score', n: 1, name: 'tasks', value: 0, max: 12 },
    { t: 'round.start', n: 2, role: 'builder' },
    { t: 'score', n: 2, name: 'tasks', value: 30, max: 40 },
    { t: 'round.start', n: 3, role: 'builder' },
    { t: 'score', n: 3, name: 'tasks', value: 44, max: 63 },
    { t: 'score', n: 3, name: 'tests', value: 0.9 },
  ];
  const events = lines.map((o, i) => parseLine(JSON.stringify({ v: 1, run: 'scoped', ts: 1_800_000_000_000 + i * MIN, ...o })))
    .filter((r) => r.ok).map((r) => r.event);
  return JSON.parse(JSON.stringify(foldRun(events)));
})();

test('T5: the summary gives a score its latest and first max; "44 of 63" and the scope line in the list and on the page', () => withDom(() => {
  const row = JSON.parse(JSON.stringify(summarize(SCOPED)));
  assert.deepEqual([row.scores.tasks.value, row.scores.tasks.max, row.scores.tasks.firstMax], [44, 63, 12]);
  assert.deepEqual([row.scores.tests.max, row.scores.tests.firstMax], [null, null], 'no max given: none');
  const [tasks, tests] = scoreList(row.scores);
  assert.equal(tasks.text, '44 of 63');
  assert.equal(tasks.scope, 'scope 12 → 63');
  assert.match(tasks.title, /tasks: 44 of 63 \(was 30, better\), scope 12 → 63$/);
  assert.equal(tests.text, '0.9');
  assert.equal(tests.scope, null);
  // the page builds its summary from the fold itself: the same numbers
  assert.deepEqual(runSummaryOf(SCOPED).scores.tasks, row.scores.tasks);
  const host = document.createElement('div');
  renderRuns(host, [row], { status: 'ok' }, row.updatedAt);
  const chip = byClass(host, 'rn-score')[0];
  assert.equal(byClass(chip, 'rn-score-v')[0].textContent, '44 of 63');
  assert.equal(byClass(host, 'rn-score-scope')[0].textContent, 'scope 12 → 63', 'in the scores cell');
  const page = renderRunPage(document.createElement('div'), SCOPED, { status: 'ok', id: 'scoped' }, row.updatedAt);
  const pchip = byClass(page, 'rn-score')[0];
  assert.equal(byClass(pchip, 'rn-score-v')[0].textContent, '44 of 63');
  assert.equal(byClass(page, 'rn-score-scope')[0].textContent, 'scope 12 → 63');
}));

// runs-n5 T20 (review 13-designer, Run page 2 + Runs list 1): the scope note stays inline in the
// tasks chip, so the stat line is one line; a cell too narrow wraps in the chip, the row top-aligned.
test('T20: the scope note sits inside the tasks chip, never on a line of its own', () => withDom(() => {
  const row = runSummaryOf(SCOPED);
  const host = document.createElement('div');
  renderRuns(host, [row], { status: 'ok' }, row.updatedAt);
  const page = renderRunPage(document.createElement('div'), SCOPED, { status: 'ok', id: 'scoped' }, row.updatedAt);
  for (const root of [host, page]) {
    const scope = byClass(root, 'rn-score-scope');
    assert.equal(scope.length, 1);
    const chip = scope[0].parent;
    assert.ok(chip.classList.contains('rn-score'), 'the scope is a child of the chip');
    assert.equal(byClass(chip, 'rn-score-k')[0].textContent, 'tasks');
    assert.equal(byClass(chip, 'rn-score-v')[0].textContent, '44 of 63');
    assert.equal(chip.children.at(-1), scope[0], 'after the value and the mark');
  }
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  const rule = css.match(/\.rn-score-scope \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /flex: 1 1 100%|display: block|flex-basis/, 'no block-level break');
  assert.match(rule, /--text-3/, 'muted');
  assert.match(css, /\.rn-score-scope::before \{ content: "· "; \}/);
  assert.doesNotMatch(css, /\.rn-scores:has\(\.rn-score-scope\) \{ flex-wrap/, 'the cell does not wrap the scope to its own line');
  assert.match(css, /\.rn-row:has\(\.rn-score-scope\) \{ align-items: start; \}/, 'a wrapped row is top-aligned');
}));

test('T5: a max that never moved prints no scope line', () => {
  const [s] = scoreList({ tasks: { n: 2, value: 7, prev: 5, better: 'higher', max: 10, firstMax: 10 } });
  assert.equal(s.text, '7 of 10');
  assert.equal(s.scope, null);
  const [old] = scoreList({ tasks: { n: 2, value: 7, prev: 5, better: 'higher' } });
  assert.equal(old.text, '7', 'a summary without max (an older board) reads as before');
});

// runs-n5 T21 (reviews/13-designer.md Run page 3 + 4): rounds table words.
test('T21: outcome slugs print as words, plain words stay', () => {
  assert.equal(outcomeText('no-task-done'), 'no task done');
  assert.equal(outcomeText('still-red'), 'still red');
  assert.equal(outcomeText('timed_out'), 'timed out');
  assert.equal(outcomeText('kept'), 'kept');
  assert.equal(outcomeText(''), null);
  assert.equal(outcomeText(null), null);
});

test('T21: a titled wrap-up round says wrap-up only in the ROUND cell, the title stays', () => withDom(() => {
  const events = [
    { t: 'run.start', goal: 'Build it', budget: { rounds: 1 }, ts: 1000 },
    { t: 'round.start', n: 1, role: 'builder', task: 'T3', ts: 2000 },
    { t: 'round.end', n: 1, outcome: 'no-task-done', ts: 3000 },
    { t: 'run.stop', reason: 'rounds', rounds: 1, ts: 4000 },
    { t: 'round.start', n: 2, role: 'operator', task: 'wrap-up', title: 'Review the night and write the report', wrapup: true, ts: 5000 },
    { t: 'round.end', n: 2, outcome: 'reported', ts: 6000 },
  ].map((e) => parseLine(JSON.stringify({ v: 1, run: 'demo', ...e }))).map((r) => r.event);
  const page = renderRunPage(null, JSON.parse(JSON.stringify(foldRun(events))), { status: 'ok', id: 'demo' }, 9000);
  const rows = byClass(page, 'rn-tl-row');
  assert.equal(rows[1].textContent.match(/wrap-up/g).length, 1);
  assert.equal(byClass(rows[1], 'rn-tl-n')[0].textContent, 'wrap-up');
  assert.equal(byClass(rows[1], 'rn-tl-title')[0].textContent, 'Review the night and write the report');
  assert.equal(byClass(rows[1], 'rn-tl-tid').length, 0);
  assert.match(page.textContent, /no task done/);
  assert.doesNotMatch(page.textContent, /no-task-done/);
}));

test('T21: the wrap-up ROUND cell is left-aligned in --text-2', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  assert.match(css, /\.rn-tl-row\[data-wrapup\] \.rn-tl-n \{[^}]*color: var\(--text-2\);[^}]*text-align: left/);
});

// n3 T50 + review 10 idea 4: a stuck run says so in its state cell, a run with no usage shows one dash.
test('T54: a stuck list row reads ▲ STUCK in p2 with the reason under it; no usage is one muted —; no empty cell', () => withDom(() => {
  const stuck = { ...LIVE, run: 'loopy', needs: [], stuck: { rule: 'same-task', reason: 'task T7 failed in rounds 4, 5' } };
  const bare = { run: 'fresh', state: 'running', usage: null, needs: [] };
  const host = document.createElement('div');
  renderRuns(host, [stuck, bare], { status: 'ok' }, FIX.updatedAt);
  const [row, fresh] = byClass(host, 'rn-row');
  const st = byClass(row, 'rn-state')[0];
  assert.equal(st.dataset.p, '2');
  assert.match(st.textContent, /^▲stuck/);
  assert.equal(byClass(st, 'rn-state-t')[0].textContent.toUpperCase(), 'STUCK');
  assert.equal(byClass(st, 'rn-state-t').length, 1, 'no RUNNING beside it');
  assert.equal(byClass(st, 'rn-state-sub')[0].textContent, 'task T7 failed in rounds 4, 5');
  assert.match(st.title, /stuck: task T7 failed in rounds 4, 5/);
  // the run page keeps the lamp, the state word and the stuck icon
  const css = fs.readFileSync(path.join(ROOT, 'public/css/views/runs.css'), 'utf8');
  assert.match(css, /\.rn-state\[data-p="2"\] \.rn-state-t \{ color: var\(--p2\); \}/);
  assert.match(css, /\.rn-state-sub \{[^}]*contain: inline-size;[^}]*color: var\(--text-3\)/);
  // review n5: the reason wraps whole, never "task T2 faile…"
  const sub = css.match(/\.rn-state-sub \{[^}]*\}/)[0];
  assert.match(sub, /white-space: normal;/);
  assert.doesNotMatch(sub, /text-overflow: ellipsis/);
  // no usage: one dash, no bar tracks
  const burn = byClass(fresh, 'rn-burn')[0];
  assert.equal(burn.textContent, '—');
  assert.equal(byClass(burn, 'rn-bar').length, 0);
  assert.equal(burn.title, 'no usage reported');
  assert.match(css, /\.rn-burn\[data-none\] \{ color: var\(--text-3\); \}/);
  const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
  assert.match(narrow, /\.rn-burn\[data-none\] \{ display: none; \}/, 'no line of its own on a phone');
  // a partial usage keeps both meters, the unknown one reading —
  renderRuns(host, [{ ...bare, usage: { sevenDayPct: 30 } }], { status: 'ok' }, FIX.updatedAt);
  assert.equal(byClass(host, 'rn-bar').length, 2);
  // no empty cell in either row
  for (const r of [row, fresh]) {
    for (const cell of r.children) assert.notEqual(cell.textContent.trim(), '', `${cell.className} is empty`);
    for (const sub of byClass(r, 'rn-goal-sub')) assert.notEqual(sub.textContent, '', 'no empty goal line');
  }
}));
