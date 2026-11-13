// The drawer under a run's loop (docs/run-drawer.md): what opens it, a
// station's rounds and checks, Built with a mini loop per node, the timeline
// with long idle gaps cut, and the page that keeps the tree in the drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import * as fake from '../server/engine/fake.mjs';
import { checksOf, miniLoop, paramsOf, PATTERNS, roundsOf, stationLog } from '../public/js/core/loop.js';
import { drawerNode, GAP_MS, parseDrawer, stationPanel, tabsNode, timeAxis, timelinePanel, toggleDrawer } from '../public/js/views/run-drawer.js';
import { loopPosition } from '../public/js/core/loop.js';
import { newPage, renderEnginePage } from '../public/js/views/runs-engine.js';

const P = PATTERNS['build-until-green@1'];
function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}

let seq = 0;
const ev = (type, o = {}) => ({ seq: (seq += 1), at: 1_000_000 + seq * 60_000, type, level: 'run', ...o });
function events() {
  seq = 0;
  return [
    ev('run.state', { state: 'running' }),
    ev('round.start', { level: 'goal', node: 'G1', role: 'decomposer', tier: 'large' }),
    ev('round.end', { level: 'goal', node: 'G1', role: 'decomposer', result: 'ok', usd: 0.24 }),
    ev('check', { level: 'goal', node: 'G1', name: 'tree format', pass: true, counts: { passed: 3, failed: 0, skipped: 0 } }),
    ev('round.start', { level: 'feature', node: 'G1.F1', role: 'test-writer', tier: 'large', model: 'a-model' }),
    ev('round.end', { level: 'feature', node: 'G1.F1', role: 'test-writer', result: 'ok', usd: 1.5 }),
    ev('check', { level: 'feature', node: 'G1.F1', name: 'acceptance tests written REQ-1', pass: false, counts: { passed: 1, failed: 2, skipped: 0 }, output: 'https://example.test/out.json' }),
    ev('round.start', { level: 'task', node: 'G1.F1.T1', role: 'builder', tier: 'mid' }),
    ev('round.end', { level: 'task', node: 'G1.F1.T1', role: 'builder', result: 'ok', usd: 0.5 }),
    ev('check', { level: 'task', node: 'G1.F1.T1', name: 'task tests', pass: false }),
    ev('round.start', { level: 'feature', node: 'G1.F1', role: 'test-writer', tier: 'large' }),
    ev('round.end', { level: 'feature', node: 'G1.F1', role: 'test-writer', result: 'ok' }),
    ev('round.start', { level: 'task', node: 'G1.F1.T1', role: 'fixer', tier: 'mid' }),
  ];
}
const tree = [
  { id: 'G1', level: 'goal', title: 'A goal', state: 'building' },
  { id: 'G1.F1', level: 'feature', parent: 'G1', title: 'A feature', state: 'building' },
  { id: 'G1.F1.T1', level: 'task', parent: 'G1.F1', title: 'Task one', state: 'building' },
  { id: 'G1.F1.T2', level: 'task', parent: 'G1.F1', title: 'Task two', state: 'frozen' },
];
const run = () => ({ id: 'R', state: 'running', node: 'G1.F1.T1', recipe: { kind: 'build' }, gates: [{ id: 'R/recipe-1', kind: 'recipe', state: 'decided', decided: { decision: 'approved', by: 'owner', via: 'laneboard', at: 1_000_000 } }], tree });

test('parseDrawer and toggleDrawer: a station or a tab opens, the same again or × closes', () => {
  assert.deepEqual(parseDrawer('station:tests'), { kind: 'station', id: 'tests' });
  assert.deepEqual(parseDrawer('tab:built'), { kind: 'tab', id: 'built' });
  assert.equal(parseDrawer('close'), null);
  assert.equal(parseDrawer('tab:<b>'), undefined);
  const page = { drawer: null };
  const hit = (v) => ({ closest: () => ({ dataset: { drawer: v } }) });
  assert.equal(toggleDrawer(page, hit('station:tests')), true);
  assert.deepEqual(page.drawer, { kind: 'station', id: 'tests' });
  toggleDrawer(page, hit('tab:timeline'));
  assert.deepEqual(page.drawer, { kind: 'tab', id: 'timeline' });
  toggleDrawer(page, hit('tab:timeline'));
  assert.equal(page.drawer, null);
  toggleDrawer(page, hit('station:fixer'));
  toggleDrawer(page, hit('close'));
  assert.equal(page.drawer, null);
  assert.equal(toggleDrawer(page, { closest: () => null }), false);
  assert.equal(toggleDrawer(page, hit('nonsense')), false);
});

test('roundsOf pairs each start with its end; an open round stays open', () => {
  const r = roundsOf(events());
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((x) => x.role), ['decomposer', 'test-writer', 'builder', 'test-writer', 'fixer']);
  assert.equal(r[0].usd, 0.24);
  assert.equal(r[0].ms, 60_000);
  assert.equal(r[1].model, 'a-model');
  assert.equal(r.at(-1).open, true);
  assert.equal(checksOf(events()).length, 3);
});

test('stationLog: a test writer round after the first build is the doubt round', () => {
  const r = roundsOf(events());
  const c = checksOf(events());
  const levels = new Map(tree.map((n) => [n.id, n.level]));
  assert.equal(stationLog('tests', r, c, levels).rounds.length, 1);
  assert.equal(stationLog('tests', r, c, levels).checks.length, 1);
  assert.equal(stationLog('doubt', r, c, levels).rounds.length, 1);
  assert.equal(stationLog('plan', r, c, levels).rounds.length, 1);
  assert.equal(stationLog('plan', r, c, levels).checks[0].name, 'tree format');
  assert.equal(stationLog('taskcheck', r, c, levels).checks.length, 1);
  assert.equal(stationLog('fixer', r, c, levels).rounds.length, 1);
});

test('stationPanel: what happens there, the node it is on, the rounds and checks', () => withDom(() => {
  const e = events();
  const pos = loopPosition(run(), e, P);
  assert.equal(pos.current, 'fixer');
  const box = stationPanel(run(), e, P, pos, 'fixer', 2_000_000);
  const t = texts(box).join(' | ');
  assert.match(t, /Fixer/);
  assert.match(t, /tier up/);
  assert.match(t, /on G1\.F1\.T1 \| Task one · building/);
  assert.match(t, /Rounds \(1\)/);
  assert.match(t, /running/);
  assert.match(t, /Checks \(1\)/);
  const tests = stationPanel(run(), e, P, pos, 'tests', 2_000_000);
  assert.match(texts(tests).join(' | '), /acceptance tests written REQ-1 \| ■ red \| 1 passed, 2 failed/);
  assert.equal(tests.querySelectorAll('dr-a')[0]?._text, 'output ↗');
  const recipe = stationPanel(run(), e, P, pos, 'recipe', 2_000_000);
  assert.match(texts(recipe).join(' | '), /Gates \(1\) .*recipe \| decided \| approved \| owner \| laneboard/);
}));

test('miniLoop: a task, a feature and the goal in a few words', () => {
  const r = roundsOf(events());
  const c = checksOf(events());
  const params = paramsOf(run(), P);
  assert.equal(miniLoop(tree[2], tree, r, c, params), '1 of 4 rounds · last check red');
  assert.equal(miniLoop(tree[1], tree, r, c, params), 'tests written · 1 of 2 tasks frozen · review 0 of 2');
  assert.equal(miniLoop(tree[0], tree, r, c, params), '0 of 1 features merged · last check green');
});

test('timeAxis: idle gaps over 30 minutes are cut, the rest keeps its order', () => {
  const t0 = 0;
  const ax = timeAxis([t0, t0 + 60_000, t0 + 5 * 3_600_000, t0 + 5 * 3_600_000 + 120_000], 1000, 18, GAP_MS);
  assert.equal(ax.spans.length, 2);
  assert.equal(ax.cuts.length, 1);
  assert.ok(ax.x(t0) < ax.x(t0 + 60_000));
  assert.ok(ax.x(t0 + 60_000) < ax.x(t0 + 5 * 3_600_000));
  assert.ok(ax.x(t0 + 5 * 3_600_000 + 120_000) <= 1000);
});

test('timelinePanel: a lane per role, a bar per round, a mark per check', () => withDom(() => {
  const box = timelinePanel(run(), events(), 1_000_000 + 20 * 60_000);
  const lanes = box.querySelectorAll('dr-tl-lane').map((n) => n._text);
  assert.deepEqual(lanes, ['run', 'checks', 'decomposer', 'test-writer', 'builder', 'fixer']);
  assert.equal(box.querySelectorAll('dr-tl-bar').length, 5);
  assert.equal(box.querySelectorAll('dr-tl-chk').length, 3);
  assert.equal(box.querySelectorAll('dr-tl-now').length, 1);
}));

test('the run page: the tree is in Built, closed by default; an explore run keeps it in sight', async () => {
  const e = fake.create();
  const r = (await e.run('R-20261101-acme-shop-1')).data.run;
  const evs = (await e.events('R-20261101-acme-shop-1', 0)).data.events;
  withDom(() => pageChecks(r, evs));
});

function pageChecks(r, evs) {
  const page = Object.assign(newPage(), { run: r, events: evs });
  let root = renderEnginePage(null, 'main/R-20261101-acme-shop-1', page, { status: 'ok' }, 0);
  assert.equal(root.querySelectorAll('dr-tabs').length, 1);
  assert.equal(root.querySelectorAll('rt-node').length, 0, 'no tree until Built is open');
  assert.equal(root.querySelectorAll('dr-panel').length, 0);
  page.drawer = { kind: 'tab', id: 'built' };
  root = renderEnginePage(null, 'main/R-20261101-acme-shop-1', page, { status: 'ok' }, 0);
  assert.ok(root.querySelectorAll('rt-node').length > 0);
  assert.ok(root.querySelectorAll('rt-mini').length > 0);
  page.drawer = { kind: 'station', id: 'build' };
  root = renderEnginePage(null, 'main/R-20261101-acme-shop-1', page, { status: 'ok' }, 0);
  assert.equal(root.querySelectorAll('dr-panel')[0].dataset.panel, 'station:build');
  assert.equal(root.querySelectorAll('lp-st').find((g) => g.dataset.station === 'build').getAttribute('aria-pressed'), 'true');
  const explore = Object.assign(newPage(), { run: { ...r, recipe: { ...r.recipe, kind: 'explore' } }, events: evs });
  root = renderEnginePage(null, 'main/R-20261101-acme-shop-1', explore, { status: 'ok' }, 0);
  assert.equal(root.querySelectorAll('dr-tabs').length, 0);
  assert.ok(root.querySelectorAll('rt-node').length > 0);
}

test('tabsNode marks the open tab; drawerNode is null when nothing is open', () => withDom(() => {
  const row = tabsNode({ drawer: { kind: 'tab', id: 'timeline' } });
  const pressed = row.children.map((b) => [b._text, b.getAttribute('aria-pressed')]);
  assert.deepEqual(pressed, [['Built', 'false'], ['Timeline', 'true'], ['Usage', 'false'], ['Recipe', 'false'], ['Gates', 'false'], ['Events', 'false']]);
  assert.equal(drawerNode(run(), { drawer: null }), null);
}));

// ---------------------------------------------------------------- step 4: usage, recipe, gates, events

import { eventsPanel, EVENTS_PAGE, gatesPanel, recipePanel, usagePanel } from '../public/js/views/run-drawer.js';
import { toShape } from '../server/engine/contract.mjs';

const usage = {
  usd: 2, tokens: { in: 10, out: 20, cacheRead: 30, cacheWrite: 40 },
  byRole: { 'test-writer': { usd: 1.5, tokens: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 } }, builder: { usd: 0.5, tokens: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 } } },
  byTier: { large: { usd: 2, tokens: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 } } },
};

test('usagePanel: cost, time, the windows as reported or not yet, by role and by tier', () => withDom(() => {
  const r = { ...run(), usage, startedAt: 1_000_000 };
  let box = usagePanel(r, events(), 1_000_000 + 30 * 60_000);
  let t = texts(box).join(' | ');
  assert.match(t, /cost \| \$2\.00/);
  assert.match(t, /30\.0 min since start/);
  assert.match(t, /5 h window \| not reported yet/);
  assert.match(t, /test-writer \| 2 \| 1 \| 2 \| 3 \| 4 \| \$1\.50 \| 75%/);
  assert.match(t, /large \| 3 \|/);
  const withWin = [...events(), { seq: 99, at: 2_000_000, type: 'usage', level: 'run', window5h: { usedPct: 41.6, resetsAt: 3_000_000, known: true } }];
  box = usagePanel(r, withWin, 2_000_000);
  t = texts(box).join(' | ');
  assert.match(t, /5 h window \| 42% · resets/);
  assert.match(t, /7 d window \| not reported yet/);
}));

test('the contract keeps the windows on a usage event', () => {
  const d = toShape('events', { run: 'R', since: 0, next: 1, events: [{ seq: 1, ts: '2026-11-13T10:00:00Z', type: 'usage', level: 'run', usd_notional: 1,
    window_5h: { used_pct: 40, resets_at: '2026-11-13T12:00:00Z' }, window_7d: { used_pct: 0, resets_at: '2026-11-13T10:00:00Z', known: false } }] });
  assert.equal(d.ok, true);
  const e = d.value.events[0];
  assert.deepEqual(e.window5h, { usedPct: 40, resetsAt: Date.parse('2026-11-13T12:00:00Z'), known: true });
  assert.equal(e.window7d.known, false);
});

test('recipePanel: the pattern and its numbers with where each comes from, the stop reasons', () => withDom(() => {
  const r = { ...run(), recipe: { kind: 'build', revision: 2, url: 'https://example.test/recipe.md', loop: { task_rounds: 6 } } };
  const t = texts(recipePanel(r)).join(' | ');
  assert.match(t, /build · rev 2/);
  assert.match(t, /recipe\.md ↗/);
  assert.match(t, /build-until-green@1 \(by the run kind\)/);
  assert.match(t, /task_rounds \| 6 \| the recipe/);
  assert.match(t, /escalate_after \| 2 \| pattern default/);
  assert.match(t, /budget \| not reported yet/);
  assert.match(t, /no-progress \|/);
}));

test('gatesPanel: every gate, open or decided, with how long it took', () => withDom(() => {
  const r = { ...run(), gates: [
    { id: 'R/recipe-1', kind: 'recipe', state: 'decided', for: 'owner', openedAt: 1_000_000, decided: { decision: 'approved', by: 'owner', via: 'laneboard', at: 1_300_000 } },
    { id: 'R/merge-1', kind: 'merge', state: 'open', for: 'owner', openedAt: 2_000_000 },
  ] };
  const t = texts(gatesPanel(r, 2_600_000)).join(' | ');
  assert.match(t, /R\/recipe-1 \| recipe \| owner \| — \| .* \| approved \| owner \| laneboard \| 5\.0 min/);
  assert.match(t, /R\/merge-1 \| merge \| owner \| — \| .* \| open \| — \| — \| 10\.0 min so far/);
}));

test('eventsPanel: newest first, a page at a time', () => withDom(() => {
  const many = Array.from({ length: EVENTS_PAGE + 5 }, (_, i) => ({ seq: i + 1, at: 1_000_000 + i, type: 'step', level: 'task', node: 'G1.F1.T1', what: 'x' }));
  const page = { events: many, drawer: { kind: 'tab', id: 'events' } };
  let box = eventsPanel(page);
  const rows = box.querySelectorAll('dr-events')[0];
  assert.ok(rows);
  assert.match(texts(box).join(' | '), /^Events \| 105 \| × \| # \| at \| type \| node \|  ?\|? ?105/);
  assert.equal(box.querySelectorAll('dr-more').length, 1);
  assert.equal(toggleDrawer(page, { closest: () => ({ dataset: { drawer: 'more:events' } }) }), true);
  box = eventsPanel(page);
  assert.equal(box.querySelectorAll('dr-more').length, 0);
}));
