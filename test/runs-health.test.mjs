// The foreman's health above the Runs list, and what waits on a run's own row
// (docs/runs-health.md): the server's `foremanOf` and `runsBody`, the page's
// `healthLines`, `healthNode` and `gatesNode`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import * as fake from '../server/engine/fake.mjs';
import { BEAT_STALE_MS, BEAT_UP_MS, foremanOf, namedRun, nameRuns, runsBody } from '../server/routes/engines.mjs';
import {
  blockedNode, chipsNode, engineNeedsYou, filterOptions, filterRuns, gatesNode, isBlocked, needsBand, rowName, runControls, runCounts,
  statusLine, statusNode, toListRow,
} from '../public/js/views/runs-engine.js';

const T = Date.parse('2026-11-11T12:00:00Z');
const answer = (lag, o = {}) => ({ ok: true, at: T, data: { heartbeatAt: T - lag, hosts: [{ id: 'steady', state: 'up' }], queue: 0, active: 1, windows: null }, ...o });

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}

test('foremanOf: up, stale and down by the heartbeat age on the engine clock; unknown without a fresh answer', () => {
  assert.equal(foremanOf(answer(5_000)).foreman, 'up');
  assert.equal(foremanOf(answer(BEAT_UP_MS)).foreman, 'up');
  assert.equal(foremanOf(answer(BEAT_UP_MS + 1)).foreman, 'stale');
  assert.equal(foremanOf(answer(BEAT_STALE_MS + 1)).foreman, 'down');
  assert.equal(foremanOf(answer(5_000)).beatAge, 5_000);
  const old = foremanOf(answer(5_000, { stale: true, age: 90_000, reason: 'timed out' }));
  assert.equal(old.foreman, 'unknown');
  assert.equal(old.reason, 'timed out');
  const none = foremanOf({ ok: false, code: 'engine-down', reason: 'cannot start' });
  assert.deepEqual([none.foreman, none.reason], ['unknown', 'cannot start']);
});

test('runsBody: each engine carries its foreman health, each run its own waiting items', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const h = b.engines[0].health;
  assert.equal(h.foreman, 'up');
  assert.equal(h.beatAge, 5_000);
  assert.equal(h.queue, 0);
  assert.deepEqual(h.windows.window5h, { usedPct: 40, resetsAt: Date.parse('2026-11-01T13:00:00Z'), known: true });
  const by = Object.fromEntries(b.runs.map((r) => [r.id, r.waiting.map((w) => w.kind)]));
  assert.deepEqual(by['R-20261101-acme-shop-1'], ['recipe', 'variant', 'change']);
  assert.deepEqual(by['R-20261029-acme-shop-1'], ['merge']);
  for (const r of b.runs) for (const w of r.waiting) assert.match(w.revision, /^sha256:[0-9a-f]{16}$/);
});

test('runsBody: a foreman that cannot be reached is unknown, and its runs still list', async () => {
  const e = fake.create({ id: 'main', override: { health: () => { throw new Error('no foreman'); } } });
  const b = await runsBody([e]);
  assert.equal(b.engines[0].health.foreman, 'unknown');
  assert.ok(b.runs.length > 0);
});

test('statusLine: what needs you, the foreman with its beat, hosts, what is on, usage; questions link to the Inbox', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const rows = b.runs.map(toListRow);
  b.engines[0].health.windows.window7d.known = false;
  const parts = statusLine(b.engines, rows, T);
  const by = Object.fromEntries(parts.map((x) => [x.key.split(':')[0], x]));
  assert.equal(by.needs.text, '3 need you', 'every run with a waiting item, a done one waiting for its merge too');
  assert.equal(by.needs.p, '1');
  assert.match(by.foreman.text, /^foreman up · beat 5s ago · on steady-1, heavy-1 · 2 on now · queue 0 · usage 5h 40% · 7d unknown$/);
  assert.equal(by.questions.text, '4 questions');
  assert.equal(by.questions.href, '#/inbox');
  assert.equal(statusLine([], [], T)[0].text, 'nothing needs you');
});

test('statusLine: spend counts the runs started today, by the local day', () => {
  const day = new Date(T); day.setHours(0, 0, 0, 0);
  const rows = [
    { engineRow: true, engine: 'm', startedAt: day.getTime() + 1, usage: { usd: 1.5 } },
    { engineRow: true, engine: 'm', startedAt: day.getTime() - 1, usage: { usd: 9 } },
  ];
  assert.equal(statusLine([], rows, T).find((x) => x.key === 'spend').text, '$1.50 today');
});

test('statusNode: one line, the foreman marked by its state', () => withDom(() => {
  const n = statusNode([{ key: 'needs', text: '1 needs you', p: '1' }, { key: 'foreman:main', text: 'foreman down', p: '1', foreman: 'down' }]);
  assert.match(texts(n).join(' '), /1 needs you/);
  assert.equal(n.children[1].dataset.foreman, 'down');
}));

test('nameRuns: product title, kind and the count of that kind for that product, oldest first', () => {
  const runs = nameRuns([
    { id: 'R-20261111-bau-2', engine: 'f', product: 'bau', productTitle: 'Bauplan', recipe: { kind: 'build' }, startedAt: 3 },
    { id: 'R-20261111-bau-1', engine: 'f', product: 'bau', productTitle: 'Bauplan', recipe: { kind: 'explore' }, startedAt: 2 },
    { id: 'R-20261109-bau-1', engine: 'f', product: 'bau', productTitle: 'Bauplan', recipe: { kind: 'build' }, startedAt: 1 },
    { id: 'R-1', engine: 'f', product: 'x', productTitle: null, recipe: null },
  ]);
  assert.deepEqual(runs.map((r) => r.name), ['Bauplan · build #2', 'Bauplan · explore #1', 'Bauplan · build #1', 'x · run #1']);
});

test('runsBody names every run and counts the questions that belong to no run; the run page gets the same name', async () => {
  const e = fake.create({ id: 'main' });
  const b = await runsBody([e]);
  for (const r of b.runs) assert.match(r.name, /^Acme Shop · build #\d$/);
  assert.equal(b.runs[0].productTitle, 'Acme Shop');
  assert.equal(b.engines[0].questions, 4);
  const page = await namedRun(e, await e.run(b.runs[0].id));
  assert.equal(page.data.run.name, b.runs[0].name);
  assert.equal(page.data.run.productTitle, 'Acme Shop');
  assert.equal((await namedRun(e, { ok: false, code: 'not-found' })).code, 'not-found');
});

test('filters: Live, Needs you and History, then product and kind; counts per chip', () => {
  const rows = [
    toListRow({ id: 'a', key: 'm/a', engine: 'm', product: 'bau', productTitle: 'Bauplan', recipe: { kind: 'build' }, state: 'at-gate', waiting: [] }),
    toListRow({ id: 'b', key: 'm/b', engine: 'm', product: 'bau', productTitle: 'Bauplan', recipe: { kind: 'explore' }, state: 'done', waiting: [] }),
    toListRow({ id: 'c', key: 'm/c', engine: 'm', product: 'shop', recipe: { kind: 'build' }, state: 'running', waiting: [] }),
    { run: 'loop', state: 'stopped', needs: [] },
  ];
  assert.deepEqual(runCounts(rows), { live: 2, needs: 1, history: 2 });
  const ids = (f) => filterRuns(rows, f).map((r) => r.run);
  assert.deepEqual(ids({ show: 'live' }), ['m/a', 'm/c']);
  assert.deepEqual(ids({ show: 'needs' }), ['m/a']);
  assert.deepEqual(ids({ show: 'history' }), ['m/b', 'loop']);
  assert.deepEqual(ids({ show: 'history', product: 'bau' }), ['m/b']);
  assert.deepEqual(ids({ show: 'live', kind: 'build', product: 'shop' }), ['m/c']);
  assert.deepEqual(ids({ show: 'history', kind: 'run file' }), ['loop']);
  const o = filterOptions(rows);
  assert.deepEqual(o.products, [{ value: 'bau', label: 'Bauplan' }, { value: 'shop', label: 'shop' }]);
  assert.deepEqual(o.kinds.map((k) => k.value), ['build', 'explore', 'run file']);
  withDom(() => {
    const n = chipsNode(rows, { show: 'live', product: '', kind: '', open: true }, () => {});
    const t = texts(n).join(' ');
    assert.match(t, /Live/);
    assert.match(t, /Needs you/);
    assert.match(t, /History/);
    assert.match(t, /all products/);
  });
});

test('needsBand: a blocked run says what is wrong, Resume big and Stop small; a gate lists its items; nothing waits, no band', async () => {
  const blocked = toListRow({ id: 'R-1', key: 'main/R-1', engine: 'main', name: 'Bauplan · build #2', goalTitle: 'PDF fixes', state: 'at-gate', node: 'G1.F1', reason: 'the stack needs Docker', waiting: [] });
  const b = await runsBody([fake.create({ id: 'main' })]);
  const gate = toListRow(b.runs.find((r) => r.id === 'R-20261101-acme-shop-1'));
  withDom(() => {
    const n = needsBand([blocked, gate, toListRow({ id: 'R-3', key: 'main/R-3', engine: 'main', state: 'running', waiting: [] })], null, T);
    assert.equal(n.querySelectorAll('.rn-card').length, 2);
    const t = texts(n).join(' ');
    assert.match(t, /Needs you/);
    assert.match(t, /blocked/);
    assert.match(t, /Bauplan · build #2/);
    assert.match(t, /What is wrong/);
    assert.match(t, /the stack needs Docker/);
    assert.match(t, /Approve/);
    const card = n.querySelectorAll('.rn-card')[0];
    const btns = card.querySelectorAll('.wt-btn');
    assert.deepEqual(btns.map((x) => x.textContent), ['Resume', 'Stop']);
    assert.ok(btns[0].classList.contains('rn-go'));
    assert.ok(btns[1].classList.contains('rn-quiet'));
    assert.equal(needsBand([toListRow({ id: 'R-3', key: 'main/R-3', engine: 'main', state: 'running', waiting: [] })]), null);
  });
  assert.equal(rowName(blocked), 'Bauplan · build #2');
  assert.equal(rowName(toListRow({ id: 'R-9', key: 'm/R-9', goal: 'G1', goalTitle: 'Wish list' })), 'G1 Wish list');
});

test('gatesNode: kind, title, short revision and the board own buttons; a run with items needs you', async () => {
  const b = await runsBody([fake.create({ id: 'main' })]);
  const row = toListRow(b.runs.find((r) => r.id === 'R-20261101-acme-shop-1'));
  assert.equal(engineNeedsYou(row), true);
  withDom(() => {
    const n = gatesNode(row);
    const t = texts(n).join(' ');
    assert.match(t, /recipe/);
    assert.match(t, /rev 8ed771e8/);
    assert.match(t, /Approve/);
    assert.match(t, /Reject/);
    assert.equal(gatesNode({ ...row, waiting: [] }), null);
  });
});

test('a blocked run (at a gate, nothing to decide) shows why, with Resume and Stop; a run with a gate does not', () => {
  const row = toListRow({ id: 'R-1', key: 'main/R-1', engine: 'main', state: 'at-gate', reason: 'blocked at G1.F1 (tests): the stack needs Docker', waiting: [] });
  assert.equal(isBlocked({ ...row, state: 'at-gate' }), true);
  assert.equal(isBlocked({ state: 'at-gate', gates: [{ state: 'open' }] }), false);
  assert.equal(isBlocked({ state: 'paused' }), false);
  assert.deepEqual(runControls('main/R-1', { state: 'at-gate', gates: [] }).map((p) => p.word), ['pause', 'resume', 'stop']);
  assert.deepEqual(runControls('main/R-1', { state: 'at-gate', gates: [{ state: 'open' }] }).map((p) => p.word), ['pause', 'stop']);
  withDom(() => {
    const t = texts(blockedNode(row)).join(' ');
    assert.match(t, /blocked/);
    assert.match(t, /the stack needs Docker/);
    assert.match(t, /Resume/);
    assert.match(t, /Stop/);
    assert.doesNotMatch(t, /Pause/);
    assert.equal(blockedNode({ ...row, waiting: [{ id: 'x' }] }), null);
    assert.equal(blockedNode(toListRow({ id: 'R-2', key: 'main/R-2', engine: 'main', state: 'running', waiting: [] })), null);
  });
});
