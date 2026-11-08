import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { create as fakeEngine } from '../server/engine/fake.mjs';
import { parseHash, formatHash, emptyRoute, HIDDEN_VIEWS, VIEWS } from '../public/js/core/router.js';
import { backLinks, filterKnowledge, itemCard, loadKnowledge, mountKnowledge, renderKnowledge, unmountKnowledge } from '../public/js/views/knowledge.js';

const byClass = (n, c) => n.querySelectorAll(`.${c}`);
async function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return await fn(globalThis.document); } finally { globalThis.document = prev; }
}
const items = async () => (await fakeEngine({ id: 'main' }).knowledge('acme-shop', {})).data.items;

test('claims, questions, requirements and sources all render; links go both ways', async () => withDom(async (doc) => {
  const all = await items();
  const host = doc.createElement('div');
  renderKnowledge(host, { status: 'ok', product: 'acme-shop', items: all, kind: '', statusFilter: '', q: '' });
  const cards = byClass(host, 'kn-item');
  assert.equal(cards.length, all.length);
  assert.deepEqual([...new Set(cards.map((c) => c.dataset.type))].sort(), ['claim', 'question', 'requirement', 'source']);
  const i1 = cards.find((c) => c.dataset.id === 'REQ-1');
  assert.ok(byClass(i1, 'kn-link').some((a) => a.href === '#/knowledge?q=C-1&product=acme-shop'));
  const c1 = cards.find((c) => c.dataset.id === 'C-1');
  assert.match(c1.textContent, /used by/);
  assert.ok(byClass(c1, 'kn-link').some((a) => a.href === '#/knowledge?q=REQ-1&product=acme-shop'));
  assert.ok(backLinks(all).get('C-1').includes('REQ-1'));
}));

test('no raw source content: no evidence quote, no who, no ref or body even if sent', async () => withDom(async () => {
  const all = await items();
  const claim = all.find((i) => i.id === 'C-1');
  const src = all.find((i) => i.type === 'source');
  const back = new Map();
  assert.ok(!itemCard(claim, 'p', back).textContent.includes(claim.evidence[0].says));
  assert.ok(!itemCard(src, 'p', back).textContent.includes(src.who));
  const hostile = { ...src, ref: 'SECRET-REF', body: 'SECRET-BODY' };
  assert.doesNotMatch(itemCard(hostile, 'p', back).textContent, /SECRET/);
}));

test('filters: kind, status, an exact id, text', async () => {
  const all = await items();
  assert.ok(filterKnowledge(all, { kind: 'requirement' }).every((i) => i.type === 'requirement'));
  assert.ok(filterKnowledge(all, { status: 'approved' }).every((i) => i.status === 'approved'));
  assert.deepEqual(filterKnowledge(all, { q: 'C-1' }).map((i) => i.id), ['C-1'], 'not C-10 and C-11');
  assert.ok(filterKnowledge(all, { q: 'account' }).length > 1);
});

test('hostile text stays text, a hostile url is no link', async () => withDom(async () => {
  const c = itemCard({ type: 'claim', id: 'C-1', statement: '<img>', url: 'javascript:1', evidence: [] }, 'p', new Map());
  assert.equal(byClass(c, 'kn-text')[0].textContent, '<img>');
  assert.equal(byClass(c, 'kn-link').length, 0);
}));

test('it is a drill-down: routable, never in the nav; product survives the hash', () => {
  assert.ok(HIDDEN_VIEWS.includes('knowledge') && !VIEWS.includes('knowledge'));
  const r = parseHash('#/knowledge?q=REQ-5&product=acme-shop');
  assert.equal(r.product, 'acme-shop');
  assert.equal(r.q, 'REQ-5');
  assert.equal(formatHash(r), '#/knowledge?q=REQ-5&product=acme-shop');
  assert.equal(parseHash('#/knowledge?product=..%2Fx').product, undefined);
  assert.deepEqual(parseHash('#/runs'), emptyRoute('runs'), 'other routes have no product key');
});

test('no product: a picker; an unknown one says so; a hub says so', async () => withDom(async (doc) => {
  const fetchFn = async (u) => ({ ok: true, status: 200, json: async () => ({ products: [{ id: 'a', title: 'A', engine: 'main' }] }), u });
  assert.equal((await loadKnowledge(null, fetchFn)).kind, 'picker');
  assert.equal((await loadKnowledge('nope', fetchFn)).kind, 'missing');
  const host = doc.createElement('div');
  await mountKnowledge(host, { route: { product: 'a' } }, { fetchFn: async () => ({ ok: false, status: 404 }) });
  assert.match(host.textContent, /hub does not carry/);
  unmountKnowledge();
}));
