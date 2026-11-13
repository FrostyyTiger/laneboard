// The loop on a run page (docs/run-loop.md): the pattern model checked
// station by station and edge by edge against foundry's pattern doc (a copy in
// test/fixtures/patterns/), where a run is in it, the drawing and the callout,
// and the row glyph the server works out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import * as fake from '../server/engine/fake.mjs';
import { loopSpots, runsBody } from '../server/routes/engines.mjs';
import { glyphOf, loopPosition, paramsOf, patternOf, PATTERNS } from '../public/js/core/loop.js';
import { edgePoints, LAYOUTS, loopSection } from '../public/js/views/run-loop.js';
import { engineRow, runControls, toListRow } from '../public/js/views/runs-engine.js';

const DOC = path.join(import.meta.dirname, 'fixtures', 'patterns', 'build-until-green.md');
const doc = fs.readFileSync(DOC, 'utf8');
const flat = doc.replace(/\s+/g, ' ');
const P = PATTERNS['build-until-green@1'];

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}

const section = (name) => {
  const i = doc.indexOf(`## ${name}`);
  assert.ok(i >= 0, `the doc has a "${name}" section`);
  const j = doc.indexOf('\n## ', i + 3);
  return doc.slice(i, j < 0 ? undefined : j);
};
const tableKeys = (sec) => [...sec.matchAll(/^\| `([^`]+)`(?: \/ `([^`]+)`)? \|/gm)].flatMap((m) => [m[1], m[2]].filter(Boolean));

// ---------------------------------------------------------------- the model against the doc

test('build-until-green@1: every parameter in the doc is in the model, and no other', () => {
  assert.deepEqual(Object.keys(P.params).sort(), tableKeys(section('Parameters')).sort());
  assert.deepEqual(Object.keys(P.params.suite).sort(), ['after_merge', 'every_tasks']);
  assert.equal(P.params.task_rounds, 4);
  assert.equal(P.params.escalate_after, 2);
});

test('build-until-green@1: every stop reason in the doc is in the model, and no other', () => {
  assert.deepEqual(Object.keys(P.stops).sort(), tableKeys(section('Stop conditions')).sort());
});

test('build-until-green@1: every role the doc names is a station', () => {
  const terms = [...section('Roles, in order').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].toLowerCase());
  const known = new Set(P.stations.map((s) => s.term).filter(Boolean));
  const notRoles = new Set(['frozen']);
  for (const t of terms) if (!notRoles.has(t)) assert.ok(known.has(t), `the role "${t}" has a station`);
  for (const k of known) assert.ok(terms.includes(k), `the station term "${k}" is a role in the doc`);
});

test('build-until-green@1: every station and every edge quotes the doc', () => {
  for (const s of P.stations) assert.ok(flat.includes(s.doc.replace(/\s+/g, ' ')), `station ${s.id}: "${s.doc}"`);
  for (const [from, to, , , quote] of P.edges) assert.ok(flat.includes(quote.replace(/\s+/g, ' ')), `edge ${from}>${to}: "${quote}"`);
});

test('build-until-green@1: the steps the first mockup missed are there', () => {
  const ids = new Set(P.stations.map((s) => s.id));
  for (const id of ['doubt', 'suite', 'merge', 'goalblame', 'end']) assert.ok(ids.has(id), id);
  const has = (a, b) => P.edges.some(([f, t]) => f === a && t === b);
  assert.ok(has('review', 'build'), 'review findings become tasks');
  assert.ok(has('fixer', 'doubt') && has('doubt', 'build'), 'the doubt round');
  assert.ok(has('taskcheck', 'suite') && has('merge', 'suite'), 'suite jobs');
  assert.ok(has('goalcheck', 'goalblame') && has('goalblame', 'fixer'), 'the goal blame');
  assert.match(P.stations.find((s) => s.id === 'fixer').text, /escalate_after/);
});

test('build-until-green@1: every edge joins two stations, every station is reached from Plan, and all are drawn', () => {
  const ids = new Set(P.stations.map((s) => s.id));
  for (const [f, t, kind] of P.edges) {
    assert.ok(ids.has(f) && ids.has(t), `${f}>${t}`);
    assert.ok(['fwd', 'back', 'next', 'side'].includes(kind));
  }
  const seen = new Set(['plan']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [f, t] of P.edges) if (seen.has(f) && !seen.has(t)) { seen.add(t); grew = true; }
  }
  assert.deepEqual([...ids].filter((id) => !seen.has(id)), []);
  const L = LAYOUTS[P.id];
  for (const id of ids) assert.ok(L.at[id], `station ${id} has a place`);
  for (const [f, t] of P.edges) assert.ok(edgePoints(L, f, t)?.length >= 2, `edge ${f}>${t} has a path`);
});

test('the pattern copy matches foundry when FOUNDRY_DIR points at a checkout', { skip: !process.env.FOUNDRY_DIR }, () => {
  const live = fs.readFileSync(path.join(process.env.FOUNDRY_DIR, P.doc), 'utf8');
  assert.equal(live, doc, 'test/fixtures/patterns/build-until-green.md is out of date: copy it again and check the model');
});

// ---------------------------------------------------------------- which pattern

test('patternOf: the recipe names it; else a build or change run is build-until-green@1; anything else has none', () => {
  assert.equal(patternOf({ recipe: { kind: 'build' } }).pattern, P);
  assert.equal(patternOf({ recipe: { kind: 'build' } }).from, 'kind');
  assert.equal(patternOf({ recipe: { kind: 'change' } }).pattern, P);
  assert.equal(patternOf({ recipe: { kind: 'build', patterns: ['build-until-green@1'] } }).from, 'recipe');
  assert.equal(patternOf({ recipe: { kind: 'build', patterns: ['build-until-green@2'] } }).pattern, null);
  assert.match(patternOf({ recipe: { kind: 'build', patterns: ['review-panel@1'] } }).why, /does not know/);
  assert.equal(patternOf({ recipe: { kind: 'explore' } }).pattern, null);
  assert.equal(patternOf({}).pattern, null);
});

test('paramsOf: the recipe\'s numbers win, the rest are the pattern defaults', () => {
  const p = paramsOf({ recipe: { loop: { task_rounds: 6 } } }, P);
  assert.deepEqual(p.task_rounds, { value: 6, from: 'recipe' });
  assert.deepEqual(p.escalate_after, { value: 2, from: 'pattern' });
});

// ---------------------------------------------------------------- where the run is

const tree = (o = {}) => [
  { id: 'G1', level: 'goal', title: 'A goal', state: 'building', ...o.G1 },
  { id: 'G1.F1', level: 'feature', parent: 'G1', title: 'A feature', state: 'building', ...o.F1 },
  { id: 'G1.F1.T1', level: 'task', parent: 'G1.F1', title: 'Task one', state: 'planned', ...o.T1 },
  { id: 'G1.F1.T2', level: 'task', parent: 'G1.F1', title: 'Task two', state: 'planned', ...o.T2 },
];
const approved = [{ id: 'R/recipe-1', kind: 'recipe', state: 'decided', decided: { decision: 'approved', by: 'owner' } }];
let seq = 0;
const ev = (type, o = {}) => ({ seq: (seq += 1), at: 1_000_000 + seq * 1000, type, level: 'run', ...o });
function blockedAtTests() {
  seq = 0;
  return [
    ev('run.state', { state: 'waiting-approval' }),
    ev('round.start', { level: 'goal', node: 'G1', role: 'decomposer' }), ev('round.end', { level: 'goal', node: 'G1', role: 'decomposer', result: 'ok' }),
    ev('check', { level: 'goal', node: 'G1', name: 'tree format', pass: true }),
    ev('gate'), ev('decision'), ev('run.state', { state: 'running' }),
    ev('check', { level: 'goal', node: 'G1', name: 'install', pass: true }),
    ev('round.start', { level: 'feature', node: 'G1.F1', role: 'test-writer', tier: 'large' }),
    ev('round.end', { level: 'feature', node: 'G1.F1', role: 'test-writer', result: 'ok' }),
    ev('check', { level: 'feature', node: 'G1.F1', name: 'acceptance tests written REQ-1', pass: false }),
    ev('node.state', { level: 'feature', node: 'G1.F1', state: 'blocked' }),
    ev('run.state', { state: 'at-gate' }),
  ];
}
const blockedRun = () => ({
  id: 'R', state: 'at-gate', node: 'G1.F1', recipe: { kind: 'build' }, gates: approved, waiting: [],
  reason: 'blocked at G1.F1 (tests): The tests must live in a folder this round may not change. More text follows here.',
  tree: tree({ F1: { state: 'blocked' } }),
});

test('loopPosition: a run blocked while its tests are written stops at Tests, Plan and Recipe done', () => {
  const pos = loopPosition(blockedRun(), blockedAtTests(), P);
  assert.equal(pos.current, 'tests');
  assert.equal(pos.blocked, true);
  assert.equal(pos.exact, false);
  assert.equal(pos.stations.tests.mark, 'blocked');
  assert.equal(pos.stations.plan.mark, 'done');
  assert.equal(pos.stations.recipe.mark, 'done');
  assert.equal(pos.stations.build.mark, 'idle');
  assert.equal(pos.stations.tests.sub, '1 round, 1 red');
  assert.equal(pos.stations.plan.sub, '2 tasks');
  assert.equal(pos.stations.recipe.sub, 'approved · owner');
  assert.deepEqual(pos.focus, { feature: 'G1.F1', task: 'G1.F1.T1', featureTitle: 'A feature' });
});

test('loopPosition: without the step in the reason, the last event still says Tests', () => {
  const run = { ...blockedRun(), reason: 'G1.F1: the acceptance tests were rejected twice by their check; a person decides' };
  assert.equal(loopPosition(run, blockedAtTests(), P).current, 'tests');
});

test('loopPosition: an open round is the spot; a fixer round counts toward the task\'s rounds', () => {
  const events = blockedAtTests().slice(0, 10);
  seq = events.length;
  events.push(
    ev('node.state', { level: 'task', node: 'G1.F1.T1', state: 'building' }),
    ev('round.start', { level: 'task', node: 'G1.F1.T1', role: 'builder' }), ev('round.end', { level: 'task', node: 'G1.F1.T1', role: 'builder', result: 'ok' }),
    ev('check', { level: 'task', node: 'G1.F1.T1', name: 'task tests', pass: false }),
    ev('round.start', { level: 'task', node: 'G1.F1.T1', role: 'fixer', tier: 'mid' }), ev('round.end', { level: 'task', node: 'G1.F1.T1', role: 'fixer', result: 'ok' }),
    ev('round.start', { level: 'task', node: 'G1.F1.T1', role: 'fixer', tier: 'large', round: 3 }),
  );
  const run = { id: 'R', state: 'running', node: 'G1.F1.T1', recipe: { kind: 'build' }, gates: approved, tree: tree({ T1: { state: 'building' } }) };
  const pos = loopPosition(run, events, P);
  assert.equal(pos.current, 'fixer');
  assert.equal(pos.openRound.role, 'fixer');
  assert.equal(pos.stations.fixer.mark, 'current');
  assert.equal(pos.stations.tests.mark, 'done');
  assert.equal(pos.stations.build.mark, 'done');
  assert.equal(pos.stations.fixer.sub, '2 of 4 · tier up');
  // A test-writer round after the tasks started is the doubt round, not Tests.
  seq = events.length;
  const doubt = [...events.slice(0, -1), ev('round.start', { level: 'feature', node: 'G1.F1', role: 'test-writer' })];
  assert.equal(loopPosition(run, doubt, P).current, 'doubt');
});

test('loopPosition: the node\'s phase, when foundry sends it, is exact', () => {
  const run = { id: 'R', state: 'running', node: 'G1.F1', recipe: { kind: 'build' }, gates: approved, tree: tree({ F1: { phase: 'review' } }) };
  const pos = loopPosition(run, [], P);
  assert.deepEqual([pos.current, pos.exact], ['review', true]);
  assert.equal(pos.stations.featurecheck.mark, 'done');
  const merged = { ...run, tree: tree({ G1: { phase: 'blame' }, F1: { state: 'passed', phase: 'done' } }) };
  assert.equal(loopPosition(merged, [], P).current, 'goalblame');
});

test('loopPosition: waiting for the recipe; done; a recipe revision open beside the work', () => {
  assert.equal(loopPosition({ state: 'waiting-approval', recipe: { kind: 'build' }, gates: [{ kind: 'recipe', state: 'open' }], tree: [] }, [], P).stations.recipe.mark, 'gate');
  const done = loopPosition({ state: 'done', stop: 'done', recipe: { kind: 'build' }, gates: approved, tree: tree({ F1: { state: 'passed' } }) }, [], P);
  assert.equal(done.current, 'end');
  for (const id of ['plan', 'recipe', 'tests', 'build', 'taskcheck', 'featurecheck', 'review', 'merge', 'goalcheck', 'pr']) assert.equal(done.stations[id].mark, 'done', id);
  assert.equal(done.stations.end.sub, 'done');
});

test('loopPosition: the published example run is building G1.F1.T3 with a new recipe revision waiting', async () => {
  const e = fake.create();
  const run = (await e.run('R-20261101-acme-shop-1')).data.run;
  const events = (await e.events('R-20261101-acme-shop-1', 0)).data.events;
  const pos = loopPosition(run, events, P);
  assert.equal(pos.current, 'build');
  assert.equal(pos.focus.task, 'G1.F1.T3');
  assert.equal(pos.stations.recipe.mark, 'gate');
  assert.equal(pos.stations.suite.n, 1);
});

test('glyphOf: seven dots, the lit one where the run is', () => {
  const g = glyphOf(P, loopPosition(blockedRun(), blockedAtTests(), P));
  assert.deepEqual(g.dots.map((d) => d.word), ['Plan', 'Recipe', 'Tests', 'Build', 'Check', 'Review', 'PR']);
  assert.deepEqual(g.dots.map((d) => d.mark), ['done', 'done', 'blocked', 'idle', 'idle', 'idle', 'idle']);
  assert.equal(g.at, 2);
});

// ---------------------------------------------------------------- the page

test('loopSection: the drawing, the list, and a callout that says what is wrong with Resume and Stop', () => withDom(() => {
  const run = blockedRun();
  const sec = loopSection(run, { events: blockedAtTests(), controls: runControls('fake/R', run), now: 2_000_000 });
  assert.equal(sec.dataset.mark, 'blocked');
  assert.equal(sec.dataset.station, 'tests');
  assert.equal(sec.querySelectorAll('lp-svg').length, 1);
  const st = sec.querySelectorAll('lp-st');
  assert.equal(st.length, P.stations.length);
  assert.equal(st.find((g) => g.dataset.station === 'tests').dataset.mark, 'blocked');
  assert.equal(sec.querySelectorAll('lp-edge').length, P.edges.length);
  assert.equal(sec.querySelectorAll('lp-li').length, P.stations.length);
  const t = texts(sec).join(' | ');
  assert.match(t, /■ Stopped at Tests · G1\.F1 · since/);
  assert.match(t, /What is wrong \| blocked at G1\.F1 \(tests\): The tests must live in a folder this round may not change\./);
  assert.match(t, /full text/);
  assert.match(t, /Fix the cause, then Resume/);
  assert.match(t, /build-until-green@1/);
  assert.match(t, /4 rounds a task · a tier up after 2 · 2 reviews \(pattern defaults\)/);
  const btns = sec.querySelectorAll('wt-btn');
  assert.deepEqual(btns.map((b) => b._text), ['Resume', 'Stop']);
  assert.ok(btns[0].classList.contains('btn--primary'));
}));

test('loopSection: a run with no known loop gets a note and no drawing', () => withDom(() => {
  const sec = loopSection({ id: 'R', state: 'running', recipe: { kind: 'explore' }, tree: [] }, { controls: runControls('fake/R', { state: 'running' }) });
  assert.equal(sec.dataset.mark, 'none');
  assert.equal(sec.querySelectorAll('lp-svg').length, 0);
  assert.match(texts(sec).join(' '), /No loop drawing: an explore run follows its recipe's steps, not a loop/);
  assert.deepEqual(sec.querySelectorAll('wt-btn').map((b) => b._text), ['Pause', 'Stop']);
}));

// ---------------------------------------------------------------- the row glyph

test('runsBody: a live build run carries its loop spot; it is read again only when the run moved', async () => {
  let runReads = 0;
  const e = fake.create({ id: 'main' });
  const orig = e.run.bind(e);
  e.run = (id) => { runReads += 1; return orig(id); };
  const b = await runsBody([e]);
  const live = b.runs.find((r) => r.id === 'R-20261101-acme-shop-1');
  assert.deepEqual([live.loop.station, live.loop.label, live.loop.node], ['build', 'Build', 'G1.F1.T3']);
  assert.equal(live.loop.marks.length, 7);
  assert.equal(b.runs.find((r) => r.state === 'done').loop, undefined);
  const first = runReads;
  await loopSpots([e], b.runs.map((r) => ({ ...r, loop: undefined })));
  assert.equal(runReads, first, 'nothing moved, nothing read');
  await loopSpots([e], b.runs.map((r) => ({ ...r, lastSeq: (r.lastSeq ?? 0) + 1 })));
  assert.ok(runReads > first, 'a new event, read again');
});

test('engineRow: the glyph and its word take the node cell', () => withDom(() => {
  const row = toListRow({ id: 'R', key: 'main/R', engine: 'main', state: 'running', recipe: { kind: 'build' }, node: 'G1.F1.T3', rooms: [],
    loop: { station: 'build', label: 'Build', node: 'G1.F1.T3', at: 3, marks: ['done', 'done', 'done', 'current', 'idle', 'idle', 'idle'], words: P.glyph.map(([w]) => w), exact: false } });
  const li = engineRow(row, 0);
  const g = li.querySelectorAll('rn-glyph')[0];
  assert.ok(g);
  assert.equal(g.querySelectorAll('rn-dot').length, 7);
  assert.equal(g.querySelectorAll('rn-dot')[3].dataset.mark, 'current');
  assert.match(texts(g).join(' '), /Build · G1\.F1\.T3/);
}));
