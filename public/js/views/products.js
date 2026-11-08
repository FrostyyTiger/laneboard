// The Products view `#/products` (`g p`): is each product ready for its next
// goal, and if not, why? Read-only, from GET /api/engines/products
// (docs/products.md). Everything shown was written by an engine: it goes in
// through textContent only, and a link only when it is http(s).
import { el } from '../core/dom.js';
import { rnClean, safeHref } from '../core/run-text.js';
import { lamp, panel, setPanel } from '../ui/components.js';

export const PRODUCTS_URL = '/api/engines/products';
export const POLL_MS = 60_000;

const REASON_WORD = Object.freeze({ 'question-open': 'question', 'intent-unapproved': 'requirement', 'requirement-unapproved': 'requirement', 'low-claim': 'claim', budget: 'budget' });

export const EMPTY_HOW = Object.freeze([
  'No products yet. A product shows up here when a run engine reports it.',
  '{ "engines": [{ "id": "main", "kind": "fake" }] }',
  'That config key shows invented demo products. docs/engines.md says how an engine connects.',
]);
export const EMPTY_HUB = 'This server reads no engines: a hub does not carry engine data yet. Open Products on the builder next to the engine.';

/** -> {kind:'ok', products, engines} | {kind:'unavailable'} | {kind:'error', message}. Never throws. */
export async function loadProducts(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(PRODUCTS_URL, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404) return { kind: 'unavailable' };
    if (!r.ok) return { kind: 'error', message: `HTTP ${r.status}` };
    const b = await r.json();
    return { kind: 'ok', products: Array.isArray(b?.products) ? b.products : [], engines: Array.isArray(b?.engines) ? b.engines : [] };
  } catch (err) {
    return { kind: 'error', message: rnClean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

function extLink(cls, text, href) {
  const safe = safeHref(href);
  if (!safe) return el('span', cls, text);
  const a = el('a', cls, text);
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** A reason's id opens that item in the Knowledge view. */
function knowledgeLink(product, ref) {
  const a = el('a', 'pd-ref', rnClean(ref, 48));
  a.href = `#/knowledge?q=${encodeURIComponent(ref)}&product=${encodeURIComponent(product.id)}`;
  return a;
}

function reasonRow(r, product) {
  const li = el('li', 'pd-reason');
  li.dataset.kind = rnClean(r.kind, 24) ?? '';
  li.append(el('span', 'pd-reason-k', REASON_WORD[r.kind] ?? rnClean(r.kind, 24) ?? ''));
  li.append(r.ref ? knowledgeLink(product, r.ref) : el('span', 'pd-ref', '—'));
  li.append(el('span', 'pd-reason-t', rnClean(r.text, 400) ?? ''));
  return li;
}

function goalRow(g, product) {
  const li = el('li', 'pd-goal');
  const ready = g.readiness === 'ready';
  li.dataset.ready = ready ? 'yes' : 'no';
  const head = el('div', 'pd-goal-h');
  const word = ready ? 'ready' : 'not ready';
  const state = el('span', 'pd-state');
  state.dataset.p = ready ? 'ok' : '2';
  state.append(lamp(ready ? 'ok' : '2', { label: word }), el('span', 'pd-state-t', word));
  head.append(state, el('span', 'pd-goal-id', rnClean(g.id, 32) ?? ''), extLink('pd-goal-t', rnClean(g.title) ?? '', g.url));
  const runs = el('span', 'pd-runs');
  for (const id of Array.isArray(g.runs) ? g.runs : []) {
    const a = el('a', 'pd-run', rnClean(id, 64));
    a.href = `#/runs?run=${encodeURIComponent(`${product.engine}/${id}`)}`;
    runs.append(a);
  }
  head.append(runs);
  li.append(head);
  if (!ready && g.reasons?.length) {
    const ul = el('ul', 'pd-reasons');
    for (const r of g.reasons) ul.append(reasonRow(r, product));
    li.append(ul);
  }
  return li;
}

export function productCard(p) {
  const card = el('article', 'pd-card');
  card.dataset.product = rnClean(p.id, 64) ?? '';
  if (p.stale) card.dataset.stale = '';
  const head = el('header', 'pd-head');
  head.append(el('h3', 'pd-title', rnClean(p.title) ?? rnClean(p.id, 64) ?? ''), el('span', 'pd-engine', `${rnClean(p.id, 64)} · ${rnClean(p.engine, 32)}`));
  if (safeHref(p.repo)) head.append(extLink('pd-link', 'repo', p.repo));
  const know = el('a', 'pd-link', 'knowledge');
  know.href = `#/knowledge?product=${encodeURIComponent(p.id)}`;
  head.append(know);
  card.append(head);
  const ul = el('ul', 'pd-goals');
  for (const g of Array.isArray(p.goals) ? p.goals : []) ul.append(goalRow(g, p));
  card.append(ul);
  return card;
}

export function renderProducts(container, st) {
  const out = el('div', 'pd-page');
  for (const e of st.engines ?? []) {
    if (['up', 'off', 'unknown'].includes(e?.state)) continue;
    out.append(el('p', 'rn-banner', `Engine ${rnClean(e.id, 32) ?? '?'} is ${rnClean(e.state, 16) ?? '?'}${e.reason ? `: ${rnClean(e.reason)}` : ''}.`));
  }
  if (st.products?.length) {
    for (const p of st.products) out.append(productCard(p));
  } else {
    const box = el('div', 'empty');
    if (st.status === 'loading') box.append(el('p', null, 'Loading the products…'));
    else if (st.status === 'unavailable') box.append(el('p', null, EMPTY_HUB));
    else if (st.status === 'error') box.append(el('p', null, `The products could not be loaded: ${rnClean(st.message) ?? 'request failed'}.`));
    else box.append(el('p', null, EMPTY_HOW[0]), el('code', 'rn-empty-cmd', EMPTY_HOW[1]), el('p', null, EMPTY_HOW[2]));
    out.append(box);
  }
  if (container) { container.textContent = ''; container.append(out); }
  return out;
}

const VIEW = { st: null };

async function refreshProducts(st) {
  const res = await loadProducts(st.fetchFn);
  if (VIEW.st !== st) return;
  if (res.kind === 'ok') Object.assign(st, { status: 'ok', products: res.products, engines: res.engines });
  else if (res.kind === 'unavailable') Object.assign(st, { status: 'unavailable', products: [], engines: [] });
  else Object.assign(st, { status: 'error', message: res.message });
  paintProducts(st);
}

function paintProducts(st) {
  setPanel(st.panel.root, { scope: null, n: st.status === 'ok' ? st.products.length : null });
  renderProducts(st.panel.body, st);
}

export function mountProducts(host, { fetchFn = globalThis.fetch, poll = true } = {}) {
  if (!host) return Promise.resolve();
  unmountProducts();
  host.textContent = '';
  const st = { el: host, fetchFn, status: 'loading', message: null, products: [], engines: [], panel: panel({ name: 'Products' }), timer: null };
  host.append(st.panel.root);
  VIEW.st = st;
  paintProducts(st);
  if (poll && typeof setInterval === 'function') {
    st.timer = setInterval(() => { refreshProducts(st); }, POLL_MS);
    st.timer?.unref?.();
  }
  return refreshProducts(st);
}

export function unmountProducts() {
  const st = VIEW.st;
  if (!st) return;
  if (st.timer) clearInterval(st.timer);
  st.el.textContent = '';
  VIEW.st = null;
}

export default {
  id: 'products',
  icon: 'packages',
  title: 'Products',
  mount: (host) => { mountProducts(host); },
  unmount: () => unmountProducts(),
  update: () => {},
};
