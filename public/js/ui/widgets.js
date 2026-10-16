// Small shared widgets. Moved from public/app.js (fleet F1).
import { el } from '../core/dom.js';
import { STATE_LABEL, pressure } from '../core/format.js';

export function gauge(label, pct, extra) {
  const row = el('div', 'gauge-row');
  const lab = el('div', 'gauge-label');
  lab.append(el('span', null, label));
  const b = el('b', null, pct == null ? '—' : `${Math.round(pct)}%`);
  if (extra) b.title = extra;
  lab.append(b);
  const track = el('div', 'gauge-track');
  const fill = el('div', 'gauge-fill');
  fill.style.width = `${Math.min(100, Math.max(0, pct || 0))}%`;
  if (pct >= 90) fill.classList.add('hot');
  else if (pct >= 70) fill.classList.add('warn');
  track.append(fill);
  row.append(lab, track);
  return row;
}

export function compactGauge(label, pct, title) {
  const n = el('span', 'gauge-compact');
  n.append(document.createTextNode(`${label} `));
  n.append(el('b', null, pct == null ? '—' : `${Math.round(pct)}%`));
  if (pct >= 90) n.classList.add('hot');
  else if (pct >= 70) n.classList.add('warn');
  if (title) n.title = title;
  return n;
}

/** The state dot, with the pressure ring around it. */
export function stateDot(state, since) {
  const dot = el('span', `dot s-${state}`);
  const p = pressure(state, since);
  if (p) dot.style.setProperty('--pressure', p.toFixed(3));
  dot.title = STATE_LABEL[state] || state;
  return dot;
}

/** draft #12 · ✓ 9/10 — or "no PR". Links to GitHub when there is one. */
export function prChip(pr) {
  if (!pr || pr.none) return el('span', 'chip-pr pr-none', 'no PR');
  if (pr.error) {
    const e = el('span', 'chip-pr pr-none', 'PR ?');
    e.title = pr.error;
    return e;
  }
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  const a = el('a', `chip-pr pr-${state} ck-${pr.verdict}`);
  a.href = pr.url || '#';
  a.target = '_blank';
  a.rel = 'noopener';
  const c = pr.checks || {};
  const checks = pr.verdict === 'red' ? `✗ ${c.failed}/${c.total}`
    : pr.verdict === 'pending' ? `◌ ${c.pending}/${c.total}`
      : pr.verdict === 'green' ? `✓ ${c.passed}/${c.total}` : '';
  a.textContent = `${state} #${pr.number}${checks ? ` · ${checks}` : ''}`;
  a.title = c.failedNames?.length ? `failing: ${c.failedNames.join(', ')}` : `${state} PR #${pr.number}`;
  return a;
}

/** A lane stripe for any row that belongs to one. */
export function laneStripe(hue) {
  const n = el('span', 'row-stripe');
  if (hue != null) n.style.setProperty('--lane-hue', String(hue));
  else n.classList.add('no-lane');
  return n;
}

export function block(title, count) {
  const sec = el('section', 'mblock');
  const h = el('h3', 'rail-h', title);
  if (count != null) h.append(el('span', 'count', String(count)));
  sec.append(h);
  return sec;
}
