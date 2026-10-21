// The demo's recorded run (runs plan night 3 T2): test/fixtures/runs/demo-run.jsonl
// folded by the real foldRun and summarized by the real summarize, as the demo's
// forwarder answers it at GET /api/runs and GET /api/runs/<id> (a hub has no
// runs route). The list row the Runs view draws, and both paths of the helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLines } from '../server/runs/protocol.mjs';
import { summarize, LIST_PATH } from '../server/routes/runs.mjs';
import { scoreList, stateOf, needsYou, runUrl, LIST_URL } from '../public/js/views/runs.js';
import {
  DEMO_RUN_FILE, DEMO_RUN_AGO_MS, DEMO_RUNS, RUNS_PATH, demoRun, demoRuns, demoRunText, demoRunsAnswer,
  demoMapWithRuns, demoWsText,
} from './helpers/demo-hub.mjs';

const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);

test('the fixture parses whole: every line known, nothing skipped', () => {
  const { events, skipped } = parseLines(fs.readFileSync(DEMO_RUN_FILE, 'utf8'));
  assert.deepEqual(skipped, {});
  assert.ok(events.every((e) => e.known), 'no raw events');
  assert.ok(events.length >= 30);
  const rounds = new Set(events.filter((e) => e.t === 'round.start').map((e) => e.n));
  assert.ok(rounds.size >= 6 && rounds.size <= 8, `6-8 rounds, got ${rounds.size}`);
});

test('the times move so the run stopped DEMO_RUN_AGO_MS before now; the deadline moves with them', () => {
  const run = demoRun(NOW);
  assert.equal(run.updatedAt, NOW - DEMO_RUN_AGO_MS);
  assert.equal(run.stop.ts, NOW - DEMO_RUN_AGO_MS);
  assert.ok(run.deadlineAt > run.startedAt && run.deadlineAt > NOW, 'the deadline is still ahead');
  // The original gaps stay.
  const orig = parseLines(fs.readFileSync(DEMO_RUN_FILE, 'utf8')).events;
  const moved = parseLines(demoRunText(NOW)).events;
  assert.equal(moved[5].ts - moved[0].ts, orig[5].ts - orig[0].ts);
  assert.equal(moved.length, orig.length);
  assert.ok(run.usage.fiveHourResetsAt > run.usage.ts, 'the 5 h reset is after the last usage');
});

test('the list row: rounds, latest scores with trend, one open need, the stop reason', () => {
  const row = summarize(demoRun(NOW));
  assert.equal(row.run, 'acme-search');
  assert.ok(row.goal);
  assert.equal(row.state, 'stopped');
  assert.equal(row.stop, 'budget');
  assert.equal(stateOf(row).title, 'stopped: budget');
  assert.equal(row.rounds, 7);
  assert.equal(row.round, 7);
  assert.equal(row.maxRounds, 10);
  assert.deepEqual(Object.keys(row.scores).sort(), ['tasks', 'tests']);
  const scores = Object.fromEntries(scoreList(row.scores).map((s) => [s.name, s]));
  assert.equal(scores.tests.value, 0.94);
  assert.equal(scores.tests.dir, 'up');
  assert.equal(scores.tests.good, true);
  assert.equal(scores.tasks.value, 3);
  assert.equal(scores.tasks.dir, 'up');
  assert.equal(row.needs.length, 1, 'one open need');
  assert.equal(row.needs[0].kind, 'decision');
  assert.ok(needsYou(row));
  assert.equal(row.artifacts, 1);
  assert.ok(row.cost.usd > 0);
});

test('the run page: rounds with roles and outcomes, a pr artifact, the scores over rounds', () => {
  const run = demoRun(NOW);
  assert.deepEqual(run.rounds.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(run.rounds.every((r) => r.role && r.outcome && r.usd > 0));
  assert.ok(run.rounds.some((r) => r.outcome === 'no-task-done'), 'one round got nothing done');
  assert.deepEqual(run.artifacts.map((a) => a.kind), ['pr']);
  assert.ok(run.scores.tests.length >= 4 && run.scores.tasks.length >= 4);
});

test('demoRunsAnswer: GET /api/runs and GET /api/runs/<id>; anything else is not its business', () => {
  assert.equal(RUNS_PATH, LIST_PATH);
  assert.equal(RUNS_PATH, LIST_URL);
  const list = demoRunsAnswer('GET', '/api/runs', NOW);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.runs.map((r) => r.run), ['acme-search', 'acme-docs', 'acme-billing']);
  assert.deepEqual(list.body.runs[0], summarize(demoRun(NOW), { now: NOW }));
  assert.equal(demoRunsAnswer('GET', '/api/runs?x=1', NOW).status, 200);

  const one = demoRunsAnswer('GET', runUrl('acme-search'), NOW);
  assert.equal(one.status, 200);
  assert.equal(one.body.run.run, 'acme-search');
  assert.ok(one.body.run.rounds.every((r) => Array.isArray(r.sessions) && r.sessionsUsd === null), 'rounds carry (no) sessions like the route');
  assert.equal(demoRunsAnswer('GET', runUrl('acme-billing'), NOW).body.run.run, 'acme-billing');
  assert.equal(demoRunsAnswer('GET', '/api/runs/other', NOW).status, 404);
  assert.equal(demoRunsAnswer('GET', '/api/runs/%E0%A4%A', NOW).status, 404);

  assert.equal(demoRunsAnswer('POST', '/api/runs/events', NOW), null);
  assert.equal(demoRunsAnswer('GET', '/api/map', NOW), null);
  assert.equal(demoRunsAnswer('GET', '/api/runsx', NOW), null);
  // A JSON round trip is what the browser gets.
  const needs = JSON.parse(JSON.stringify(one.body)).run.needs;
  assert.deepEqual(needs.map((n) => [n.kind, n.open, n.by]), [['fence', false, 'inbox'], ['decision', true, null]],
    'one open need, and a fence the Inbox acked (night 4 T6: the run page shows who)');
});

// Seen on the demo's run page at 390 (T2 shots): the state word ran under the
// goal, and the score range was cut at the right edge.
test('runs.css: the page head keeps the state word whole; narrow charts put the line on its own row', () => {
  const css = fs.readFileSync(new URL('../public/css/views/runs.css', import.meta.url), 'utf8');
  assert.match(css, /\.rn-head-top \.rn-state \{ flex: none; \}/);
  assert.match(css, /\.rn-head-top \.rn-goal \{[^}]*min-width: 0;/);
  const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
  assert.match(narrow, /\.rn-chart-svg \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/);
});

test('demoMorningWithRuns adds the run digest to a fleet Morning answer, keeps anything else (T7)', async () => {
  const { demoMorningWithRuns } = await import('./helpers/demo-hub.mjs');
  const now = Date.now();
  const out = demoMorningWithRuns({ window: 'tonight', since: now - 12 * 3600_000, builders: [] }, now);
  assert.equal(out.runs.length, DEMO_RUNS.length);
  const search = out.runs.find((r) => r.run === 'acme-search');
  assert.ok(search.rounds > 0 && search.prs.length >= 1);
  assert.deepEqual(demoMorningWithRuns({ since: now + 1, builders: [] }, now).runs, [], 'nothing in a window that starts later');
  const has = { runs: [] };
  assert.equal(demoMorningWithRuns(has, now), has);
  assert.equal(demoMorningWithRuns(null, now), null);
  assert.deepEqual(demoMorningWithRuns([1], now), [1]);
});

// T45: the Map's run nodes (T10 draws them) need runs in each state on the demo.
test('the demo runs: one stopped, one running fine, one running and stuck; each parses whole', () => {
  for (const { file } of DEMO_RUNS) assert.deepEqual(parseLines(fs.readFileSync(file, 'utf8')).skipped, {}, file);
  const rows = Object.fromEntries(demoRuns(NOW).map((r) => [r.run, summarize(r, { now: NOW })]));
  assert.equal(rows['acme-search'].state, 'stopped');
  assert.equal(rows['acme-search'].stuck, null);
  assert.equal(rows['acme-docs'].state, 'running');
  assert.equal(rows['acme-docs'].stuck, null, 'the running run is not stuck');
  assert.equal(rows['acme-billing'].state, 'running');
  assert.equal(rows['acme-billing'].stuck?.rule, 'same-task');
});

/** A hub Map as buildFleet gives it for the demo topology, cut down. */
const hubMap = () => ({
  title: 'demo-host',
  nodes: [
    { id: '__core', kind: 'core', label: 'demo-host', status: 'ok' },
    { id: 'lab', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'room-a', parent: 'lab', kind: 'room', label: 'vm-a', status: 'ok' },
    { id: 'builder:builder-b', parent: 'lab', kind: 'builder', builder: 'builder-b', label: 'BB', status: 'ok' },
  ],
  links: [],
  events: [],
});

test('demoMapWithRuns: a run node per demo run, with its state, stuck and host', () => {
  const map = demoMapWithRuns(hubMap(), NOW);
  const runs = Object.fromEntries(map.nodes.filter((n) => n.kind === 'run').map((n) => [n.id, n]));
  assert.deepEqual(Object.keys(runs).sort(), ['run:acme-billing', 'run:acme-docs', 'run:acme-search']);
  const search = runs['run:acme-search'];
  assert.equal(search.parent, '__core', 'no host: on the core');
  assert.equal(search.state, 'stopped');
  assert.equal(search.status, 'idle');
  assert.equal(search.stuck, null);
  assert.equal(search.progress, 0.7, '7 of 10 rounds');
  const docs = runs['run:acme-docs'];
  assert.equal(docs.parent, 'room-a', 'host vm-a: on its room');
  assert.equal(docs.state, 'running');
  assert.equal(docs.status, 'working');
  assert.equal(docs.stuck, null);
  assert.ok(docs.progress > 0 && docs.progress < 1);
  const billing = runs['run:acme-billing'];
  assert.equal(billing.parent, 'builder:builder-b', 'host builder-b: on the builder');
  assert.equal(billing.status, 'warn');
  assert.equal(billing.stuck.rule, 'same-task');
  assert.equal(billing.href, '#/runs?run=acme-billing');
  // The hub's nodes stay as they were.
  assert.deepEqual(map.nodes.slice(0, 4), hubMap().nodes);
});

test('demoMapWithRuns: no core node hangs runs on __core; odd input and a map with runs kept', () => {
  const noCore = demoMapWithRuns({ nodes: [] }, NOW);
  assert.ok(noCore.nodes.every((n) => n.parent === '__core'));
  assert.equal(demoMapWithRuns(null, NOW), null);
  const odd = { nodes: 'x' };
  assert.equal(demoMapWithRuns(odd, NOW), odd);
  const has = { nodes: [{ id: 'run:x', kind: 'run' }] };
  assert.equal(demoMapWithRuns(has, NOW), has);
});

test('demoWsText: a map message gets the run nodes, anything else passes byte for byte', () => {
  const out = JSON.parse(demoWsText(JSON.stringify({ type: 'map', seq: 4, map: hubMap() }), NOW));
  assert.equal(out.type, 'map');
  assert.equal(out.seq, 4);
  assert.equal(out.map.nodes.filter((n) => n.kind === 'run').length, 3);
  for (const t of ['{"type":"delta","map":"x"}', '{"type":"hello"}', 'not json "map"', '{"type":"map"}']) {
    assert.equal(demoWsText(t, NOW), t);
  }
});
