// What waits for a person from the run engines, shown in full in the Inbox
// (docs/waiting.md). Read-only until decisions go through the control plane.
//
// `content` keeps keys laneboard does not know, so it is drawn by a generic
// walk: every value goes in through textContent, a link only when http(s).
import { el } from '../core/dom.js';
import { rnClean, safeHref } from '../core/run-text.js';

export const WAITING_URL = '/api/engines/waiting';
export const NEEDS_PHASE_4 = 'needs phase 4';
const MAX_DEPTH = 5;
const TEXT_MAX = 20000;

const LABELS = Object.freeze({ intent: 'requirement', journeys: 'acceptance tests', journey: 'acceptance test', because: 'because of', accepted_risks: 'accepted risks' });

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

function disabledBtn(text) {
  const b = el('button', 'btn btn--s wt-btn', text);
  b.type = 'button';
  b.disabled = true;
  b.title = NEEDS_PHASE_4;
  return b;
}

/** The decisions an item will take, drawn disabled. */
export function decisionsNode(item) {
  const box = el('div', 'wt-actions');
  if (item.kind === 'question') box.append(disabledBtn('Answer'));
  else if (item.kind === 'variant') {
    for (const o of Array.isArray(item.content?.options) ? item.content.options : []) box.append(disabledBtn(`Pick ${rnClean(o?.title ?? o?.id, 60) ?? ''}`.trim()));
    box.append(disabledBtn('Reject'));
  } else box.append(disabledBtn('Approve'), disabledBtn('Reject'));
  box.append(el('span', 'wt-why', NEEDS_PHASE_4));
  return box;
}

/** The whole item, as a row opens it. */
export function waitingBody(item, engine) {
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
  body.append(meta, fieldsNode(item.content ?? {}), decisionsNode(item));
  return body;
}

export const waitingKindWord = (kind) => ({ intent: 'requirement' }[kind] ?? rnClean(kind, 24) ?? '');
