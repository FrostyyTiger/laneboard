import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument } from './helpers/fakedom.mjs';
import { create as fakeEngine } from '../server/engine/fake.mjs';
import { productsBody } from '../server/routes/engines.mjs';
import { EMPTY_HOW, loadProducts, mountProducts, renderProducts, unmountProducts } from '../public/js/views/products.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const byClass = (n, c) => n.querySelectorAll(`.${c}`);
async function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return await fn(globalThis.document); } finally { globalThis.document = prev; }
}
const body = () => productsBody([fakeEngine({ id: 'main' })]);

test('every fixture product renders, with its goals and links to its runs', async () => withDom(async (doc) => {
  const b = await body();
  const host = doc.createElement('div');
  renderProducts(host, { status: 'ok', ...b });
  const cards = byClass(host, 'pd-card');
  assert.deepEqual(cards.map((c) => c.dataset.product), b.products.map((p) => p.id));
  assert.equal(byClass(host, 'pd-goal').length, b.products.flatMap((p) => p.goals).length);
  assert.ok(byClass(host, 'pd-run').some((a) => a.href === '#/runs?run=main%2FR-20261101-acme-shop-1'));
}));

test('a not-ready goal lists each reason; a reason with a ref links, budget does not', async () => withDom(async (doc) => {
  const host = doc.createElement('div');
  renderProducts(host, { status: 'ok', ...(await body()) });
  const g4 = byClass(host, 'pd-goal').find((g) => g.dataset.ready === 'no');
  const reasons = byClass(g4, 'pd-reason');
  assert.deepEqual(reasons.map((r) => r.dataset.kind), ['intent-unapproved', 'question-open', 'low-claim', 'budget']);
  const ref = byClass(reasons[0], 'pd-ref')[0];
  assert.equal(ref.tagName.toLowerCase(), 'a');
  assert.equal(ref.textContent, 'I-5');
  assert.equal(ref.href, '#/knowledge?q=I-5&product=acme-shop');
  assert.equal(byClass(reasons[3], 'pd-ref')[0].tagName.toLowerCase(), 'span');
}));

test('hostile text stays text', async () => withDom(async (doc) => {
  const host = doc.createElement('div');
  renderProducts(host, { status: 'ok', engines: [], products: [{ id: 'x', engine: 'e', title: '<img>', goals: [
    { id: 'G1', title: 't', readiness: 'not-ready', runs: [], reasons: [{ kind: 'question-open', ref: 'Q-1', text: 'q', url: 'javascript:alert(1)' }] }] }] });
  assert.equal(byClass(host, 'pd-title')[0].textContent, '<img>');
}));

test('no engine: the page says how to add one; a hub says so; a down engine has a line', async () => withDom(async (doc) => {
  const host = doc.createElement('div');
  await mountProducts(host, { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ products: [], engines: [] }) }), poll: false });
  assert.ok(host.textContent.includes(EMPTY_HOW[1]));
  unmountProducts();
  await mountProducts(host, { fetchFn: async () => ({ ok: false, status: 404 }), poll: false });
  assert.match(host.textContent, /hub does not carry engine data/);
  unmountProducts();
  assert.equal(host.children.length, 0);
  renderProducts(host, { status: 'ok', products: [], engines: [{ id: 'main', state: 'down', reason: 'gone' }] });
  assert.match(host.textContent, /Engine main is down: gone/);
  assert.deepEqual(await loadProducts(async () => { throw new Error('offline'); }), { kind: 'error', message: 'offline' });
}));

test('the shell knows the view: section, tab, stylesheet', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="view-products"/);
  assert.match(html, /data-view="products" title="Products \(g p\)"/);
  assert.match(html, /css\/views\/products\.css/);
});
