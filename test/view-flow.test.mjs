import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { create as fakeEngine } from '../server/engine/fake.mjs';
import { parseHash, formatHash, emptyRoute } from '../public/js/core/router.js';
import { BOX_IDS, buildFlow, litBox, pickRun, waitingFor } from '../public/js/core/flow-model.js';
import { mountFlow, renderFlow, unmountFlow } from '../public/js/views/flow.js';

const byClass = (n, c) => n.querySelectorAll(`.${c}`);
async function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return await fn(globalThis.document); } finally { globalThis.document = prev; }
}
const NOW = Date.parse('2026-11-01T10:45:00Z');
async function world(goalId, runId) {
  const e = fakeEngine({ id: 'main' });
  const goal = (await e.products()).data.products[0].goals.find((g) => g.id === goalId);
  const run = runId ? (await e.run(runId)).data.run : null;
  const events = runId === 'R-20261101-acme-shop-1' ? (await e.events(runId, 0)).data.events : [];
  return { product: 'acme-shop', goal, run, events, items: (await e.knowledge('acme-shop', {})).data.items, waiting: (await e.waiting({})).data.items, now: NOW };
}
const task = (state, extra = {}) => ({ id: 'T', level: 'task', state, ...extra });

const CASES = [
  ['run done', { run: { state: 'done', tree: [] } }, 'pr'],
  ['a merge gate open', { run: { state: 'at-gate', tree: [] }, waiting: [{ kind: 'merge' }] }, 'pr'],
  ['a deploy gate open', { run: { state: 'running', tree: [] }, waiting: [{ kind: 'deploy' }] }, 'pr'],
  ['waiting approval', { run: { state: 'waiting-approval', tree: [] } }, 'gate'],
  ['queued', { run: { state: 'queued', tree: [] } }, 'goal'],
  ['a task checking', { run: { state: 'running', tree: [task('checking')] } }, 'checks'],
  ['the current node failed', { run: { state: 'running', node: 'T', tree: [task('reopened', { lastCheck: { pass: false } })] } }, 'checks'],
  ['a task building', { run: { state: 'running', tree: [task('building')] } }, 'builder'],
  ['tasks, none moving', { run: { state: 'running', tree: [task('planned')] } }, 'tasks'],
  ['no tasks yet', { run: { state: 'running', tree: [] } }, 'tester'],
  ['no run, ready', { goal: { readiness: 'ready' } }, 'goal'],
  ['no run, a draft requirement', { goal: { readiness: 'not-ready' }, requirements: [{ status: 'draft' }] }, 'gate'],
  ['no run, otherwise', { goal: { readiness: 'not-ready' }, requirements: [{ status: 'approved' }] }, 'requirements'],
];
for (const [name, input, want] of CASES) test(`lit: ${name} -> ${want}`, () => assert.equal(litBox(input), want));

test('the running goal is at the builder: what, for which requirement, which round, last step', async () => {
  const f = buildFlow(await world('G1', 'R-20261101-acme-shop-1'));
  assert.equal(f.lit, 'builder');
  assert.deepEqual(f.boxes.map((b) => b.id), BOX_IDS);
  assert.equal(f.boxes.find((b) => b.id === 'tasks').state, 'done');
  assert.equal(f.boxes.find((b) => b.id === 'checks').state, 'ahead');
  const text = f.boxes.find((b) => b.id === 'builder').lines.map((l) => l.text).join('\n');
  assert.match(text, /Confirmation e-mail/);
  assert.match(text, /for REQ-1 /);
  assert.match(text, /round \d+/);
  assert.match(text, /last step: .* ✓/);
});

test('every box says something for the running goal; counts add up', async () => {
  const w = await world('G1', 'R-20261101-acme-shop-1');
  const f = buildFlow(w);
  for (const b of f.boxes) assert.ok(b.lines.length > 0, b.id);
  const by = (id) => f.boxes.find((b) => b.id === id).lines.map((l) => l.text).join(' | ');
  assert.match(by('sources'), new RegExp(`^${w.items.filter((i) => i.type === 'source').length} sources`));
  assert.match(by('claims'), new RegExp(`^${w.items.filter((i) => i.type === 'claim').length} claims`));
  assert.match(by('requirements'), /^2 requirements/);
  assert.match(by('tester'), /acceptance tests/);
  assert.match(by('checks'), /suite: ✗ *212 passed/);
  assert.equal(f.boxes.find((b) => b.id === 'gate').state, 'waiting', 'moved past, still open');
});

test('a goal waiting for merge lights the PR box; a goal with no run has Build not started', async () => {
  assert.equal(buildFlow(await world('G3', 'R-20261029-acme-shop-1')).lit, 'pr');
  const g4 = buildFlow(await world('G4', null));
  assert.equal(g4.boxes.find((b) => b.id === 'builder').lines[0].text, 'Not started');
  assert.equal(g4.lit, 'gate');
});

test('pickRun takes a live run first; waitingFor keeps to this goal', () => {
  const rows = [{ id: 'a', product: 'p', goal: 'G', state: 'done', updatedAt: 9 }, { id: 'b', product: 'p', goal: 'G', state: 'running', updatedAt: 1 }, { id: 'c', product: 'q', goal: 'G', state: 'running', updatedAt: 9 }];
  assert.equal(pickRun(rows, 'p', 'G').id, 'b');
  assert.equal(pickRun(rows, 'p', 'X'), null);
  const items = [{ id: 1, run: 'r' }, { id: 2, run: 's' }, { id: 3, product: 'p', links: [{ ref: 'p:REQ-1' }] }, { id: 4, product: 'p', links: [{ ref: 'p:REQ-9' }] }];
  assert.deepEqual(waitingFor(items, { product: 'p', run: { id: 'r' }, requirements: ['REQ-1'] }).map((i) => i.id), [1, 3]);
});

test('it renders, two rows, one lit; hostile text stays text', async () => withDom(async (doc) => {
  const w = await world('G1', 'R-20261101-acme-shop-1');
  const host = doc.createElement('div');
  renderFlow(host, { status: 'ok', ...w, engine: 'main', open: new Set(['requirements']), items: [...w.items, { type: 'source', id: '<img>', kind: 'web' }] });
  const boxes = byClass(host, 'fl-box');
  assert.equal(boxes.length, 10);
  assert.deepEqual(boxes.filter((b) => b.dataset.state === 'lit').map((b) => b.dataset.box), ['builder']);
  assert.ok(byClass(host, 'fl-detail').length === 1);
  assert.equal(host.querySelectorAll('img').length, 0);
}));

test('route: product and goal survive; other routes have neither; a hub says so', async () => withDom(async (doc) => {
  const r = parseHash('#/flow?product=acme-shop&goal=G1');
  assert.deepEqual([r.view, r.product, r.goal], ['flow', 'acme-shop', 'G1']);
  assert.equal(formatHash(r), '#/flow?product=acme-shop&goal=G1');
  assert.deepEqual(parseHash('#/runs'), emptyRoute('runs'));
  const host = doc.createElement('div');
  await mountFlow(host, { route: { product: 'p', goal: 'G1' } }, { fetchFn: async () => ({ ok: false, status: 404 }), poll: false });
  assert.match(host.textContent, /hub does not carry/);
  unmountFlow();
}));

test('mounted on real routes it finds the goal and lights the builder (fetch is called bare)', async () => withDom(async (doc) => {
  const e = fakeEngine({ id: 'main' });
  const ok = (b) => ({ ok: true, status: 200, json: async () => b });
  async function fetchFn(u) {
    assert.equal(this, undefined, 'a real fetch throws when called as a method');
    if (u === '/api/engines/products') return ok({ products: (await e.products()).data.products.map((p) => ({ ...p, engine: 'main' })), engines: [] });
    if (u === '/api/engines/runs') return ok({ runs: (await e.runs()).data.runs.map((r) => ({ ...r, engine: 'main', key: `main/${r.id}` })), engines: [] });
    if (u === '/api/engines/waiting') return ok({ items: (await e.waiting({})).data.items, engines: [] });
    if (u.includes('/knowledge/')) return ok({ data: (await e.knowledge('acme-shop', {})).data });
    if (u.includes('/run/')) return ok({ data: (await e.run('R-20261101-acme-shop-1')).data });
    if (u.includes('/events/')) return ok({ data: (await e.events('R-20261101-acme-shop-1', 0)).data });
    return { ok: false, status: 404 };
  }
  const host = doc.createElement('div');
  await mountFlow(host, { route: { product: 'acme-shop', goal: 'G1' } }, { fetchFn, poll: false });
  assert.deepEqual(byClass(host, 'fl-box').filter((b) => b.dataset.state === 'lit').map((b) => b.dataset.box), ['builder']);
  unmountFlow();
}));
