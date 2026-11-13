// What waits for a person from the run engines, shown in full in the Inbox
// (docs/waiting.md). Its buttons are actions (views/engine-actions.js).
//
// `content` keeps keys laneboard does not know, so it is drawn by a generic
// walk: every value goes in through textContent, a link only when http(s).
import { el } from '../core/dom.js';
import { rnClean, safeHref } from '../core/run-text.js';
import { decisionButton } from './engine-actions.js';

export const WAITING_URL = '/api/engines/waiting';
const MAX_DEPTH = 5;
const TEXT_MAX = 20000;

const LABELS = Object.freeze({ acceptance_tests: 'acceptance tests', test: 'acceptance test', because: 'because of', accepted_risks: 'accepted risks' });

/** GET /api/engines/waiting -> {items, engines}, or null when there is no such route (a hub). Never throws. */
export async function loadWaiting(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(WAITING_URL, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404 || !r.ok) return null;
    const b = await r.json();
    return { items: Array.isArray(b?.items) ? b.items : [], engines: Array.isArray(b?.engines) ? b.engines : [] };
  } catch {
    return null;
  }
}

/** Long text keeps its line breaks; other control characters go. */
function longText(v) {
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '�');
  return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s;
}

const labelOf = (k) => LABELS[k] ?? String(k).replace(/_/g, ' ');

function valueNode(v, key, depth) {
  if (v === null || v === undefined || v === '') return el('span', 'wt-none', '—');
  if (typeof v === 'string') {
    const href = /^https?:/.test(v) ? safeHref(v) : null;
    if (href) {
      const a = el('a', 'wt-link', rnClean(key === 'url' ? v : v, 300));
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => e.stopPropagation());
      return a;
    }
    return el(v.includes('\n') ? 'pre' : 'span', 'wt-text', longText(v));
  }
  if (typeof v === 'number' || typeof v === 'boolean') return el('span', 'wt-text', String(v));
  if (depth >= MAX_DEPTH) return el('span', 'wt-none', '…');
  if (Array.isArray(v)) {
    const ul = el('ul', 'wt-list');
    for (const x of v) { const li = el('li'); li.append(valueNode(x, key, depth + 1)); ul.append(li); }
    return ul;
  }
  if (typeof v === 'object') return fieldsNode(v, depth + 1);
  return el('span', 'wt-none', '—');
}

export function fieldsNode(obj, depth = 0) {
  const box = el('div', 'wt-fields');
  for (const [k, v] of Object.entries(obj)) {
    const row = el('div', 'wt-field');
    row.dataset.key = rnClean(k, 48) ?? '';
    row.append(el('span', 'wt-k', rnClean(labelOf(k), 48) ?? ''), valueNode(v, k, depth));
    box.append(row);
  }
  return box;
}

/** The decisions an item takes (docs/decisions.md). Pure. */
export function decisionPlans(item, engine) {
  // A blocked run: nothing to approve. Fix the cause, then Resume; or Stop (it asks first).
  if (item.kind === 'needs') {
    if (typeof item.run !== 'string' || !item.run) return [];
    const run = `${engine}/${item.run}`;
    const lines = [rnClean(run, 100) ?? '', 'Gentle: the current step finishes first.'];
    return [
      { label: 'Resume', word: 'resume', action: 'engine-resume', target: run, tier: 'click', args: {}, lines },
      { label: 'Stop', word: 'stop', action: 'engine-stop', target: run, tier: 'confirm', args: {}, lines },
    ];
  }
  const target = `${engine}/${item.id}`;
  const title = rnClean(item.title, 200) ?? rnClean(item.id, 120) ?? '';
  const lines = [title, `revision ${item.revision}`];
  const reject = { label: 'Reject', word: 'reject', action: 'engine-reject', target, tier: 'confirm', args: { expect: item.revision }, lines, askText: { title: 'Why not?', key: 'why' } };
  if (item.kind === 'question') return [{ label: 'Answer', word: 'answer', action: 'engine-answer', target, tier: 'click', args: {}, lines: [title], askText: { title: rnClean(item.content?.question, 300) ?? title, key: 'text' }, showBack: true }];
  if (item.kind === 'variant') {
    const picks = (Array.isArray(item.content?.options) ? item.content.options : []).filter((o) => typeof o?.id === 'string').map((o) => {
      const name = rnClean(o.title ?? o.id, 60) ?? o.id;
      return { label: `Pick ${name}`, word: 'pick', action: 'engine-pick', target, tier: 'confirm', args: { expect: item.revision, choice: o.id }, lines: [...lines, `choice: ${name}`] };
    });
    return [...picks, reject];
  }
  return [{ label: 'Approve', word: 'approve', action: 'engine-approve', target, tier: 'confirm', args: { expect: item.revision }, lines }, reject];
}

/** The item's decision buttons. */
export function decisionsNode(item, engine, onDone) {
  const box = el('div', 'wt-actions');
  for (const plan of decisionPlans(item, engine)) box.append(decisionButton(plan, onDone));
  return box;
}

/** The whole item, as a row opens it. */
export function waitingBody(item, engine, onDone) {
  const body = el('div', 'wt-body');
  body.dataset.kind = rnClean(item.kind, 24) ?? '';
  body.addEventListener('click', (e) => e.stopPropagation());
  const meta = el('div', 'wt-meta');
  meta.append(el('span', 'wt-id', rnClean(item.id, 120) ?? ''));
  if (item.run) {
    const a = el('a', 'wt-link', 'run');
    a.href = `#/runs?run=${encodeURIComponent(`${engine}/${item.run}`)}`;
    meta.append(a);
  }
  for (const l of Array.isArray(item.links) ? item.links : []) {
    const text = rnClean(l?.ref ?? l?.rel, 80);
    const href = safeHref(l?.url);
    if (!text || !href || l?.rel === 'run') continue;
    const a = el('a', 'wt-link', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    meta.append(a);
  }
  body.append(meta, fieldsNode(item.content ?? {}), decisionsNode(item, engine, onDone));
  return body;
}

export const waitingKindWord = (kind) => (kind === 'needs' ? 'blocked' : rnClean(kind, 24) ?? '');
