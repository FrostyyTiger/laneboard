// The Knowledge view `#/knowledge?product=<id>`, opened from a product: claims,
// questions, requirements, source summaries and the links between them.
// Read-only (docs/knowledge.md).
//
// Never raw sources: the contract mapping already drops a source's `ref` and
// body, and this view also leaves out each evidence line's quote and a source's
// `who`. Everything goes in through textContent.
import { el } from '../core/dom.js';
import { rnClean, safeHref } from '../core/run-text.js';
import { panel, setPanel } from '../ui/components.js';
import { fieldsNode } from './inbox-waiting.js';

const PAGES = 10;
const KINDS = Object.freeze(['requirement', 'question', 'claim', 'source']);
export const typeOf = (it) => it.type;
export const EMPTY_HUB = 'This server reads no engines: a hub does not carry engine data yet.';
export const EMPTY_HOW = 'No products to show. A run engine reports them: see docs/engines.md.';

const qs = (p, q) => `#/knowledge?${q ? `q=${encodeURIComponent(q)}&` : ''}product=${encodeURIComponent(p)}`;

/** Each item's outgoing ids: what it cites, blocks, or is superseded by. Bare ids only. */
export function linksOf(it) {
  const bare = (v) => String(v).split(':').pop();
  const out = [];
  for (const id of it.because ?? []) out.push(['because of', bare(id)]);
  for (const id of it.blocks ?? []) out.push(['blocks', bare(id)]);
  if (it.answer) out.push(['answered by', bare(it.answer)]);
  if (it.supersededBy) out.push(['superseded by', bare(it.supersededBy)]);
  for (const e of it.evidence ?? []) out.push(['source', bare(e.source)]);
  return out;
}

/** id -> [[label, id]] of the items that point at it, so a link can be followed back. */
export function backLinks(items) {
  const back = new Map();
  for (const it of items) {
    for (const [, to] of linksOf(it)) {
      if (!back.has(to)) back.set(to, []);
      if (!back.get(to).includes(it.id)) back.get(to).push(it.id);
    }
  }
  return back;
}

/** Items that pass the filters: `q` is an exact id when one matches, else text. */
export function filterKnowledge(items, { kind = '', status = '', q = '' } = {}) {
  let list = items.filter((it) => (!kind || typeOf(it) === kind) && (!status || it.status === status));
  if (q) {
    const exact = list.filter((it) => it.id === q);
    if (exact.length) return exact;
    const low = q.toLowerCase();
    list = list.filter((it) => [it.id, it.statement, it.question, it.title, it.summary].some((t) => typeof t === 'string' && t.toLowerCase().includes(low)));
  }
  return list;
}

/**
 * The product's knowledge, every page. -> {kind:'ok', engine, items} | {kind:'picker', products}
 * | {kind:'unavailable'} | {kind:'missing'} | {kind:'error', message}. Never throws.
 */
export async function loadKnowledge(product, fetchFn = globalThis.fetch) {
  const get = async (u) => {
    const r = await fetchFn(u, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    return { status: r.status, ok: r.ok, body: r.ok ? await r.json() : null };
  };
  try {
    const list = await get('/api/engines/products');
    if (list.status === 404) return { kind: 'unavailable' };
    if (!list.ok) return { kind: 'error', message: `HTTP ${list.status}` };
    const products = Array.isArray(list.body?.products) ? list.body.products : [];
    if (!product) return { kind: 'picker', products };
    const p = products.find((x) => x.id === product);
    if (!p) return { kind: 'missing' };
    const items = [];
    let cursor = null;
    for (let i = 0; i < PAGES; i += 1) {
      const a = await get(`/api/engine/${encodeURIComponent(p.engine)}/knowledge/${encodeURIComponent(product)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (a.status === 404) return { kind: 'missing' };
      if (!a.ok) return { kind: 'error', message: `HTTP ${a.status}` };
      items.push(...(a.body?.data?.items ?? []));
      cursor = a.body?.data?.nextCursor ?? null;
      if (!cursor) break;
    }
    return { kind: 'ok', engine: p.engine, items, products };
  } catch (err) {
    return { kind: 'error', message: rnClean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

function linkRow(product, label, ids) {
  const row = el('div', 'kn-links');
  row.append(el('span', 'kn-k', label));
  for (const id of ids) {
    const a = el('a', 'kn-link', rnClean(id, 64));
    a.href = qs(product, id);
    row.append(a);
  }
  return row;
}

export function itemCard(it, product, back) {
  const card = el('article', 'kn-item');
  card.dataset.id = rnClean(it.id, 80) ?? '';
  card.dataset.type = typeOf(it);
  const head = el('header', 'kn-head');
  head.append(el('span', 'kn-type', typeOf(it)), el('span', 'kn-id', rnClean(it.id, 80) ?? ''));
  if (it.status) head.append(el('span', 'kn-status', rnClean(it.status, 24)));
  if (it.confidence) head.append(el('span', 'kn-status', `${rnClean(it.confidence, 16)} confidence`));
  if (it.kind) head.append(el('span', 'kn-status', rnClean(it.kind, 24)));
  if (it.date) head.append(el('span', 'kn-status', rnClean(it.date, 24)));
  const href = safeHref(it.url);
  if (href) {
    const a = el('a', 'kn-link', 'file');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    head.append(a);
  }
  card.append(head, el('p', 'kn-text', rnClean(it.statement ?? it.question ?? it.title ?? it.summary, 2000) ?? ''));
  if (it.sections) card.append(fieldsNode(it.sections));
  const groups = new Map();
  for (const [label, id] of linksOf(it)) {
    if (!groups.has(label)) groups.set(label, []);
    if (!groups.get(label).includes(id)) groups.get(label).push(id);
  }
  for (const [label, ids] of groups) card.append(linkRow(product, label, ids));
  if (back.get(it.id)?.length) card.append(linkRow(product, 'used by', back.get(it.id)));
  return card;
}

function select(name, options, value) {
  const s = el('select', 'kn-filter');
  s.dataset.filter = name;
  s.setAttribute('aria-label', name);
  for (const [v, t] of options) {
    const o = el('option', null, t);
    o.value = v;
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}

export function renderKnowledge(container, st) {
  const out = el('div', 'kn-page');
  if (st.status === 'ok') {
    const all = st.items;
    const filters = el('div', 'kn-filters');
    const statuses = [...new Set(all.map((i) => i.status).filter(Boolean))].sort();
    filters.append(select('kind', [['', 'every kind'], ...KINDS.map((k) => [k, k])], st.kind),
      select('status', [['', 'every status'], ...statuses.map((s) => [s, rnClean(s, 24)])], st.statusFilter));
    if (st.q) {
      const clear = el('a', 'kn-link', `show all (now: ${rnClean(st.q, 48)})`);
      clear.href = qs(st.product, null);
      filters.append(clear);
    }
    out.append(filters);
    const list = filterKnowledge(all, { kind: st.kind, status: st.statusFilter, q: st.q });
    const back = backLinks(all);
    for (const it of list) out.append(itemCard(it, st.product, back));
    if (!list.length) out.append(el('p', 'empty', 'Nothing matches these filters.'));
  } else if (st.status === 'picker') {
    if (!st.products.length) out.append(el('p', 'empty', EMPTY_HOW));
    for (const p of st.products) {
      const a = el('a', 'kn-link', rnClean(p.title ?? p.id) ?? '');
      a.href = qs(p.id, null);
      const row = el('p');
      row.append(a);
      out.append(row);
    }
  } else {
    out.append(el('p', 'empty', st.status === 'loading' ? 'Loading the knowledge…'
      : st.status === 'unavailable' ? EMPTY_HUB
        : st.status === 'missing' ? `No product ${rnClean(st.product, 64)} here.`
          : `The knowledge could not be loaded: ${rnClean(st.message) ?? 'request failed'}.`));
  }
  if (container) { container.textContent = ''; container.append(out); }
  return out;
}

const VIEW = { st: null };

function paintKnowledge(st) {
  setPanel(st.panel.root, { scope: st.product ?? null, n: st.status === 'ok' ? st.items.length : null });
  renderKnowledge(st.panel.body, st);
}

async function refreshKnowledge(st) {
  const product = st.product;
  const res = await loadKnowledge(product, st.fetchFn);
  if (VIEW.st !== st || st.product !== product) return;
  if (res.kind === 'ok') Object.assign(st, { status: 'ok', items: res.items });
  else if (res.kind === 'picker') Object.assign(st, { status: 'picker', products: res.products });
  else Object.assign(st, { status: res.kind, message: res.message ?? null, items: [] });
  paintKnowledge(st);
}

export function mountKnowledge(host, ctx = {}, { fetchFn = globalThis.fetch } = {}) {
  if (!host) return Promise.resolve();
  unmountKnowledge();
  host.textContent = '';
  const st = {
    el: host, fetchFn, status: 'loading', message: null, items: [], products: [], kind: '', statusFilter: '',
    product: ctx.route?.product ?? null, q: ctx.route?.q ?? '', panel: panel({ name: 'Knowledge' }),
  };
  host.append(st.panel.root);
  st.panel.body.addEventListener?.('change', (e) => {
    const f = e.target?.dataset?.filter;
    if (f === 'kind') st.kind = e.target.value;
    else if (f === 'status') st.statusFilter = e.target.value;
    else return;
    paintKnowledge(st);
  });
  VIEW.st = st;
  paintKnowledge(st);
  return refreshKnowledge(st);
}

export function unmountKnowledge() {
  const st = VIEW.st;
  if (!st) return;
  st.el.textContent = '';
  VIEW.st = null;
}

export function updateKnowledge(ctx = {}) {
  const st = VIEW.st;
  if (!st || !ctx.route) return Promise.resolve();
  const product = ctx.route.product ?? null;
  const q = ctx.route.q ?? '';
  if (product !== st.product) {
    Object.assign(st, { product, q, status: 'loading', items: [] });
    paintKnowledge(st);
    return refreshKnowledge(st);
  }
  if (q !== st.q) { st.q = q; paintKnowledge(st); }
  return Promise.resolve();
}

export default {
  id: 'knowledge',
  icon: 'review',
  title: 'Knowledge',
  mount: (host, ctx = {}) => { mountKnowledge(host, ctx); },
  unmount: () => unmountKnowledge(),
  update: (_store, ctx = {}) => { updateKnowledge(ctx); },
};
