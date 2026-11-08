// The Flow view `#/flow?product=<id>&goal=<id>`: one overview of where a goal
// stands, from its first source to its PR (docs/flow.md). Read-only. Everything
// shown was written by an engine: textContent only, external links only when http(s).
import { el } from '../core/dom.js';
import { buildFlow, pickRun } from '../core/flow-model.js';
import { rnClean, safeHref } from '../core/run-text.js';
import { panel, setPanel } from '../ui/components.js';
import { loadWaiting } from './inbox-waiting.js';
import { loadKnowledge } from './knowledge.js';
import { loadEngineRun, loadEngineRuns } from './runs-engine.js';

export const FLOW_POLL_MS = 15_000;
const KNOWLEDGE_TTL_MS = 60_000;
const ROWS = Object.freeze([['Discover + Shape', 'what is true, and what has to exist'], ['Build', 'how, proved against the requirements']]);

export const flowHref = (product, goal) => `#/flow?product=${encodeURIComponent(product)}&goal=${encodeURIComponent(goal)}`;

function lineNode(l) {
  const text = rnClean(l.text, 300) ?? '';
  let n;
  if (l.href && !l.external) { n = el('a', 'fl-line', text); n.href = l.href; }
  else if (l.href && safeHref(l.href)) {
    n = el('a', 'fl-line', text);
    n.href = safeHref(l.href);
    n.target = '_blank';
    n.rel = 'noopener noreferrer';
  } else n = el('span', 'fl-line', text);
  if (l.p) n.dataset.p = l.p;
  if (l.strong) n.dataset.strong = '';
  return n;
}

function flowBox(b, open) {
  const box = el('article', 'fl-box');
  box.dataset.box = b.id;
  box.dataset.state = b.state;
  const head = el('h3', 'fl-title');
  if (b.state !== 'ahead') head.append(el('span', 'fl-mark', b.state === 'lit' ? '● ' : b.state === 'waiting' ? '▲ ' : '✓ '));
  head.append(el('span', null, b.title));
  box.append(head);
  if (b.note) box.append(el('span', 'fl-note', rnClean(b.note, 40)));
  for (const l of b.lines) box.append(lineNode(l));
  if (b.detail.length) {
    const more = el('button', 'fl-more', open ? 'less' : `more (${b.detail.length})`);
    more.type = 'button';
    more.dataset.more = b.id;
    more.setAttribute('aria-expanded', String(open));
    box.append(more);
    if (open) {
      const ul = el('ul', 'fl-detail');
      for (const d of b.detail) { const li = el('li'); li.append(lineNode(d)); ul.append(li); }
      box.append(ul);
    }
  }
  return box;
}

export function renderFlow(container, st) {
  const out = el('div', 'fl-page');
  if (st.status === 'ok') {
    const head = el('header', 'fl-head');
    head.append(el('span', 'fl-goal', [rnClean(st.product, 64), rnClean(st.goal?.id, 32), rnClean(st.goal?.title)].filter(Boolean).join(' · ')));
    if (st.run) {
      const a = el('a', 'fl-line', 'run page');
      a.href = `#/runs?run=${encodeURIComponent(`${st.engine}/${st.run.id}`)}`;
      head.append(a);
    }
    out.append(head);
    const flow = buildFlow({ product: st.product, goal: st.goal, run: st.run, events: st.events, items: st.items, waiting: st.waiting, now: st.now ?? Date.now() });
    ROWS.forEach(([name, sub], i) => {
      const sec = el('section', 'fl-section');
      const h = el('h2', 'fl-row-t', name);
      h.append(el('span', 'fl-row-s', sub));
      const row = el('div', 'fl-row');
      row.dataset.row = String(i);
      for (const b of flow.boxes.filter((x) => x.row === i)) row.append(flowBox(b, st.open.has(b.id)));
      sec.append(h, row);
      out.append(sec);
    });
  } else if (st.status === 'picker') {
    if (!st.products.length) out.append(el('p', 'empty', 'No goals to show. A run engine reports them: see docs/engines.md.'));
    for (const p of st.products) {
      for (const g of p.goals ?? []) {
        const row = el('p');
        const a = el('a', 'fl-line', `${rnClean(p.title ?? p.id)} · ${rnClean(g.id, 32)} ${rnClean(g.title) ?? ''}`);
        a.href = flowHref(p.id, g.id);
        row.append(a);
        out.append(row);
      }
    }
  } else {
    out.append(el('p', 'empty', st.status === 'loading' ? 'Loading the flow…'
      : st.status === 'unavailable' ? 'This server reads no engines: a hub does not carry engine data yet.'
        : st.status === 'missing' ? `No goal ${rnClean(st.goalId, 32)} on product ${rnClean(st.product, 64)} here.`
          : `The flow could not be loaded: ${rnClean(st.message) ?? 'request failed'}.`));
  }
  if (container) {
    const focus = container.ownerDocument?.activeElement?.dataset?.more ?? null;
    container.textContent = '';
    container.append(out);
    if (focus) [...out.querySelectorAll('[data-more]')].find((b) => b.dataset.more === focus)?.focus();
  }
  return out;
}

const VIEW = { st: null };

function paintFlow(st) {
  setPanel(st.panel.root, { scope: st.goalId ? `${st.product} ${st.goalId}` : null, n: null });
  renderFlow(st.panel.body, st);
}

async function refreshFlow(st) {
  const seq = ++st.seq;
  const { product, goalId } = st;
  const stale = () => VIEW.st !== st || seq !== st.seq;
  const kn = await loadKnowledge(product, st.fetchFn);
  if (stale()) return;
  if (kn.kind === 'picker' || !goalId) {
    if (kn.kind === 'picker') Object.assign(st, { status: 'picker', products: kn.products });
    else Object.assign(st, { status: 'missing' });
    paintFlow(st);
    return;
  }
  if (kn.kind !== 'ok') { Object.assign(st, { status: kn.kind, message: kn.message ?? null }); paintFlow(st); return; }
  const goal = kn.products.find((p) => p.id === product)?.goals?.find((g) => g.id === goalId);
  if (!goal) { st.status = 'missing'; paintFlow(st); return; }
  const [runs, waiting] = await Promise.all([loadEngineRuns(st.fetchFn), loadWaiting(st.fetchFn)]);
  if (stale()) return;
  const row = pickRun(runs.rows.map((r) => ({ ...r, state: r.engineState })), product, goalId);
  let run = null;
  let events = [];
  if (row) {
    const res = await loadEngineRun(row.run, 0, st.fetchFn);
    if (stale()) return;
    if (res.kind === 'ok') { run = res.run; events = res.events; }
  }
  Object.assign(st, { status: 'ok', engine: kn.engine, goal, run, events, items: kn.items, waiting: waiting?.items ?? [] });
  paintFlow(st);
}

export function mountFlow(host, ctx = {}, { fetchFn = globalThis.fetch, poll = true } = {}) {
  if (!host) return Promise.resolve();
  unmountFlow();
  host.textContent = '';
  const st = {
    el: host, fetchFn, status: 'loading', message: null, seq: 0, timer: null, open: new Set(), products: [], items: [], waiting: [], events: [], run: null, goal: null, engine: null,
    product: ctx.route?.product ?? null, goalId: ctx.route?.goal ?? null, panel: panel({ name: 'Flow' }),
  };
  host.append(st.panel.root);
  st.panel.body.addEventListener?.('click', (e) => {
    const id = e.target?.closest?.('[data-more]')?.dataset?.more;
    if (!id) return;
    if (st.open.has(id)) st.open.delete(id); else st.open.add(id);
    paintFlow(st);
  });
  VIEW.st = st;
  paintFlow(st);
  if (poll && typeof setInterval === 'function') {
    st.timer = setInterval(() => { refreshFlow(st); }, FLOW_POLL_MS);
    st.timer?.unref?.();
  }
  return refreshFlow(st);
}

export function unmountFlow() {
  const st = VIEW.st;
  if (!st) return;
  if (st.timer) clearInterval(st.timer);
  st.el.textContent = '';
  VIEW.st = null;
}

export function updateFlow(ctx = {}) {
  const st = VIEW.st;
  if (!st || !ctx.route) return Promise.resolve();
  const product = ctx.route.product ?? null;
  const goalId = ctx.route.goal ?? null;
  if (product === st.product && goalId === st.goalId) return Promise.resolve();
  Object.assign(st, { product, goalId, status: 'loading', run: null, goal: null });
  paintFlow(st);
  return refreshFlow(st);
}

export default {
  id: 'flow',
  icon: 'runs',
  title: 'Flow',
  mount: (host, ctx = {}) => { mountFlow(host, ctx); },
  unmount: () => unmountFlow(),
  update: (_store, ctx = {}) => { updateFlow(ctx); },
};
