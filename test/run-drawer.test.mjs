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
  assert.deepEqual(pressed, [['Built', 'false'], ['Timeline', 'true']]);
  assert.equal(drawerNode(run(), { drawer: null }), null);
}));
