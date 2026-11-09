import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { create as fakeEngine } from '../server/engine/fake.mjs';
import { waitingBody as routeBody } from '../server/routes/engines.mjs';
import { buildInbox, keyAction } from '../public/js/core/inbox-model.js';
import { decisionPlans, loadWaiting, waitingBody } from '../public/js/views/inbox-waiting.js';

const byClass = (n, c) => n.querySelectorAll(`.${c}`);
async function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return await fn(); } finally { globalThis.document = prev; }
}
const items = async () => (await routeBody([fakeEngine({ id: 'main' })])).items;
const STORE = { sessions: [], lanes: [], attention: [], approvals: [], flags: [], builders: [] };

test('every fixture kind opens in full, its buttons live', async () => withDom(async () => {
  const all = await items();
  assert.deepEqual([...new Set(all.map((i) => i.kind))].sort(),
    ['change', 'deploy', 'merge', 'proposal', 'question', 'recipe', 'repo', 'requirement', 'variant']);
  for (const it of all) {
    const b = waitingBody(it, 'main');
    for (const k of Object.keys(it.content)) assert.ok(byClass(b, 'wt-field').some((f) => f.dataset.key === k), `${it.kind}: ${k}`);
    const buttons = byClass(b, 'wt-btn');
    assert.ok(buttons.length > 0, it.kind);
    assert.ok(buttons.length && buttons.every((x) => x.disabled !== true), it.kind);
  }
}));

test('a variant gets one button per option; a question gets Answer', async () => withDom(async () => {
  const all = await items();
  const v = all.find((i) => i.kind === 'variant');
  assert.equal(byClass(waitingBody(v, 'main'), 'wt-btn').length, v.content.options.length + 1);
  assert.deepEqual(byClass(waitingBody(all.find((i) => i.kind === 'question'), 'main'), 'wt-btn').map((x) => x.textContent), ['Answer']);
}));

test('unknown keys are drawn as text; a hostile link is not a link', async () => withDom(async () => {
  const b = waitingBody({ id: 'x', kind: 'proposal', content: { title: '<img src=x>', surprise: { deep: 'javascript:alert(1)' }, link: 'https://ok.example/a' }, links: [{ rel: 'x', ref: 'y', url: 'javascript:1' }] }, 'main');
  assert.ok(b.textContent.includes('<img src=x>'));
  assert.deepEqual(byClass(b, 'wt-link').map((a) => a.href), ['https://ok.example/a']);
}));

test('the group is on top, counts, and Enter opens rather than decides', async () => {
  const all = await items();
  const m = buildInbox(STORE, { now: 1, waiting: all });
  assert.equal(m.groups[0].id, 'waiting');
  assert.equal(m.count, all.length);
  const id = m.groups[0].rows[0].id;
  assert.deepEqual(keyAction('Enter', id, m), { expand: id, rowId: id });
  for (const k of ['a', 'd', 'r']) assert.ok(keyAction(k, id, m).none, k);
});

test('loadWaiting: a hub or an error is null', async () => {
  assert.equal(await loadWaiting(async () => ({ ok: false, status: 404 })), null);
  assert.equal(await loadWaiting(async () => { throw new Error('x'); }), null);
});

test('Morning lists what waits and links to the Inbox', async () => withDom(async () => {
  const { waitingBlock } = await import('../public/js/views/morning.js');
  const b = waitingBlock([{ id: 'x', kind: 'requirement', title: 'Order history' }]);
  assert.match(b.textContent, /requirement · Order history/);
}));
