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
  timeLeft, roundText, stateOf, needsOf, needsYou, spanText, EMPTY_HOW, LIST_URL, SCORE_MAX,
  renderRunPage, roundRows, stopOf, artifactsOf, rawOf, runSummaryOf, loadRun, safeHref, updateRuns,
  runHref, runUrl, LIST_HREF, RAW_SHOW, stuckOf, scoreCharts, chartPoints, chartDomain, chartNum, CHART_W, CHART_H,
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

test('the run page shows the fixture: head, stop reason, open need, timeline, artifact, raw folded away', () => withDom(() => {
  const host = document.createElement('div');
  const page = renderRunPage(host, RUN, { status: 'ok', id: 'readiness' }, RUN.updatedAt);
  assert.equal(host.children[0], page);
  assert.equal(byClass(page, 'rn-back')[0].href, '#/runs');
  const t = texts(page);
  assert.ok(t.includes('Make acme-api ready for review: tests green, docs current'));
  assert.equal(byClass(page, 'rn-round')[0].textContent, 'round 3 / 6');
  assert.deepEqual(byClass(page, 'rn-score').map((n) => n.textContent), ['lint9▼', 'tests0.93▲']);
  assert.equal(byClass(page, 'rn-cost')[0].textContent, '$3.75');
  assert.equal(byClass(page, 'rn-events')[0].textContent, '22 events');
  // stop reason, coloured: no progress needs a look
  const stop = byClass(page, 'rn-stop')[0];
  assert.equal(stop.textContent, 'stopped: no-progress · after 3 rounds · $3.75');
  assert.equal(stop.dataset.p, '2');
  assert.match(stop.title, /^stopped at 2026-/);
  // the open need, with its link
  const need = byClass(page, 'rn-need');
  assert.equal(need.length, 1);
  assert.equal(need[0].dataset.p, '2');
  assert.match(need[0].textContent, /▲decisionDrop the v1 export endpoint/);
  const needLink = byClass(need[0], 'rn-item-l')[0];
  assert.equal(needLink.href, 'https://example.invalid/acme/acme-api/pull/7');
  assert.equal(needLink.rel, 'noopener noreferrer');
  // the timeline: round, role, task, outcome, commit, cost, duration, sessions
  const rows = byClass(page, 'rn-tl-row');
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.textContent)), [
    ['1', 'planner', '—', 'kept', 'a1b2c3d', '$0.900', '9m', '—'],
    ['2', 'builder', 'A2.4', 'kept', 'b2c3d4e', '$1.60', '29m', '—'],
    ['3', 'builder', 'A2.5', 'no-task-done', '—', '$1.25', '29m', '—'],
  ]);
  assert.equal(rows.some((r) => 'live' in r.dataset), false, 'a stopped run has no live round');
  // the PR
  const art = byClass(page, 'rn-art');
  assert.equal(art.length, 1);
  const a = byClass(art[0], 'rn-item-t')[0];
  assert.equal(a.tagName, 'A');
  assert.equal(a.textContent, 'Readiness (agent loop)');
  assert.equal(a.href, 'https://example.invalid/acme/acme-api/pull/7');
  assert.match(art[0].textContent, /^prReadiness \(agent loop\)round 2$/);
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
    assert.equal(byClass(page, 'rn-stop').length, 0, 'no stop line while it runs');
  });
  assert.equal(stopOf({ state: 'running' }), null);
  assert.deepEqual(stopOf({ state: 'stopped', stop: { reason: 'error', rounds: 1 } }),
    { reason: 'error', p: '1', text: 'stopped: error · after 1 round', title: 'stopped: error' });
  assert.equal(stopOf({ state: 'stopped' }).text, 'stopped: unknown');
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
    assert.equal(byClass(li, 'rn-goal-sub')[0].textContent, '', 'no id repeated under itself');
    assert.equal(byClass(li, 'rn-round')[0].textContent, '—');
    assert.equal(byClass(li, 'rn-left')[0].textContent, reason);
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
  assert.ok(texts(page).includes('<b>hi</b>'));
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

  await updateRuns(null, { route: { ...emptyRoute('runs'), run: null } });
  assert.deepEqual(calls.at(-1), [LIST_URL, 'GET']);
  assert.equal(byClass(host, 'rn-row').length, 1);
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
  assert.deepEqual([tasks.trend.mark, tasks.trend.good], ['▲', true]);
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
  assert.deepEqual([last.attrs.x, last.attrs.y], ['129.27', '0']);
  assert.deepEqual(byClass(page, 'rn-chart-v').map((n) => n.textContent), ['3 ▲', '1 =']);
  assert.deepEqual(byClass(page, 'rn-chart-r').map((n) => n.textContent), ['0–3', '0.9993–1']);
  assert.equal(byClass(page, 'rn-chart-v').some((n) => n.dataset.p), false, 'nothing got worse: grey');
  assert.doesNotMatch(SRC.slice(SRC.indexOf('score charts')), /animate|transition|requestAnimationFrame/);
}));

test('charts: `better` decides which way is good; a worse latest value is p2', () => withDom(() => {
  // readiness: lint 14 -> 9 with lower better is good, tests 0.88 -> 0.93 higher is good
  const page = renderRunPage(null, RUN, { status: 'ok', id: 'readiness' }, RUN.updatedAt);
  assert.deepEqual(byClass(page, 'rn-chart-v').map((n) => [n.textContent, n.dataset.p ?? null]), [['9 ▼', null], ['0.93 ▲', null]]);
  const worse = { ...RUN, scores: { lint: [{ n: 1, value: 9 }, { n: 2, value: 14 }] }, better: { lint: 'lower' } };
  const p2 = renderRunPage(null, worse, { status: 'ok' }, RUN.updatedAt);
  const v = byClass(p2, 'rn-chart-v')[0];
  assert.deepEqual([v.textContent, v.dataset.p], ['14 ▲', '2']);
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
