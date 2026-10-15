// The Credit view. Moved from public/app.js (fleet F1).
import { $, el, svg } from '../core/dom.js';
import { ago, compactCount, money, resetsIn } from '../core/format.js';
import { laneStripe } from '../ui/widgets.js';

// ---------------------------------------------------------------- credit

const credit = { data: null, loading: false, at: 0, sort: 'allTime', desc: true };

export async function loadCredit(force = false) {
  if (credit.loading) return;
  if (!force && credit.data && Date.now() - credit.at < 20000) return;
  credit.loading = true;
  try {
    const r = await fetch('/api/credit');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    credit.data = await r.json();
    credit.at = Date.now();
  } catch (err) {
    credit.data = { error: err.message };
  } finally {
    credit.loading = false;
    renderCredit();
  }
}

/**
 * A usage chart, hand-written (hard rule 3: no chart library).
 *
 * Percent is a fixed 0-100 scale, so the y axis needs no domain calculation and
 * two charts can be compared by eye. Bands at 80 % and 95 % are drawn behind
 * the line: the number that matters is not "how much" but "how close to the
 * wall", and a band says that without a legend.
 */
export function usageChart(chart, { width = 720, height = 150 } = {}) {
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const root = svg('svg', {
    class: 'chart', viewBox: `0 0 ${width} ${height}`,
    width, height, role: 'img', 'aria-label': chart.title,
  });
  const span = Math.max(1, chart.now - chart.since);
  const x = (t) => pad.l + ((t - chart.since) / span) * w;
  const y = (v) => pad.t + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  // Threshold bands first, so the line sits on top of them.
  root.append(svg('rect', { class: 'band band-warn', x: pad.l, y: y(95), width: w, height: y(80) - y(95) }));
  root.append(svg('rect', { class: 'band band-crit', x: pad.l, y: y(100), width: w, height: y(95) - y(100) }));

  // A 4px grid would be noise at this size; label the axis instead.
  for (const v of [0, 50, 100]) {
    root.append(svg('line', { class: 'axis', x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v) }));
    const t = svg('text', { class: 'axis-label', x: pad.l - 6, y: y(v) + 3, 'text-anchor': 'end' });
    t.textContent = `${v}`;
    root.append(t);
  }

  for (const at of chart.resets) {
    root.append(svg('line', { class: 'reset-tick', x1: x(at), x2: x(at), y1: pad.t, y2: pad.t + h }));
  }

  if (!chart.points.length) {
    const t = svg('text', { class: 'axis-label', x: pad.l + w / 2, y: pad.t + h / 2, 'text-anchor': 'middle' });
    t.textContent = 'no samples yet';
    root.append(t);
    return root;
  }

  const d = chart.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  root.append(svg('polyline', { class: 'series', points: d }));

  // One <title> per point group so hovering says what and when, with no
  // tooltip machinery and no library.
  for (const p of chart.points) {
    const g = svg('g');
    const c = svg('circle', { class: 'point', cx: x(p.t).toFixed(1), cy: y(p.v).toFixed(1), r: 6 });
    const title = svg('title');
    title.textContent = `${Math.round(p.v)}% · ${new Date(p.t).toLocaleString('en-GB', { hour12: false })}`;
    g.append(c, title);
    root.append(g);
  }
  return root;
}

function chartBlock(chart, current) {
  const sec = el('section', 'mblock');
  const head = el('div', 'chart-head');
  const h = el('h3', 'rail-h', chart.title);
  head.append(h);
  if (current) {
    const now = el('span', 'chart-now', `${Math.round(current.usedPct)}%`);
    if (current.usedPct >= 95) now.classList.add('hot');
    else if (current.usedPct >= 80) now.classList.add('warn');
    head.append(now);
    head.append(el('span', 'chart-reset', resetsIn(current.resetsAt)));
  }
  head.append(el('span', 'chart-range',
    `${new Date(chart.since).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} → now`));
  sec.append(head);
  const scroller = el('div', 'chart-scroll');
  scroller.append(usageChart(chart));
  sec.append(scroller);
  return sec;
}

const CREDIT_COLUMNS = [
  { key: 'lane', label: 'lane' },
  { key: 'tonight', label: 'tonight', num: true },
  { key: 'day', label: '24 h', num: true },
  { key: 'week', label: '7 d', num: true },
  { key: 'allTime', label: 'all time', num: true },
  { key: 'input', label: 'in', num: true, tok: true },
  { key: 'output', label: 'out', num: true, tok: true },
  { key: 'cacheRead', label: 'cache rd', num: true, tok: true },
  { key: 'cacheWrite', label: 'cache wr', num: true, tok: true },
];

function creditValue(row, col) {
  if (col.key === 'lane') return row.lane ?? '';
  if (col.tok) return row.tokens?.[col.key] ?? 0;
  return row[col.key] ?? 0;
}

export function renderCredit() {
  const box = $('credit-body');
  if (!box) return;
  box.textContent = '';
  const d = credit.data;
  if (!d) { box.append(el('p', 'empty', 'Loading…')); return; }
  if (d.error) { box.append(el('p', 'empty', `Could not load: ${d.error}`)); return; }

  const s = d.sampler || {};
  $('credit-sampler').textContent = s.lastSampleAt
    ? `${s.rows} samples · last ${ago(s.lastSampleAt)} ago`
    : 'sampler has written nothing yet';

  box.append(chartBlock(d.charts.sevenDay, d.rateLimits?.sevenDay));
  box.append(chartBlock(d.charts.fiveHour, d.rateLimits?.fiveHour));

  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Cost per lane'));
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const col of CREDIT_COLUMNS) {
    const th = el('th', `${col.num ? 'num' : ''}${credit.sort === col.key ? ' sorted' : ''}`.trim() || null, col.label);
    th.onclick = () => {
      if (credit.sort === col.key) credit.desc = !credit.desc;
      else { credit.sort = col.key; credit.desc = true; }
      renderCredit();
    };
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);

  const col = CREDIT_COLUMNS.find((c) => c.key === credit.sort) ?? CREDIT_COLUMNS[4];
  const rows = [...d.lanes].sort((a, b) => {
    const av = creditValue(a, col);
    const bv = creditValue(b, col);
    const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv;
    return credit.desc ? -cmp : cmp;
  });

  const tbody = el('tbody');
  for (const row of rows) {
    if (!row.allTime && !row.tonight && !row.week) continue;
    const tr = el('tr');
    const td = el('td');
    td.append(laneStripe(row.hue));
    td.append(el('span', null, row.lane || '(no lane)'));
    tr.append(td);
    tr.append(el('td', 'num', money(row.tonight)));
    tr.append(el('td', 'num', money(row.day)));
    tr.append(el('td', 'num', money(row.week)));
    // null means "the session is gone, so there is nothing to total".
    tr.append(el('td', 'num', row.allTime == null ? '—' : money(row.allTime)));
    tr.append(el('td', 'num', compactCount(row.tokens.input)));
    tr.append(el('td', 'num', compactCount(row.tokens.output)));
    tr.append(el('td', 'num', compactCount(row.tokens.cacheRead)));
    tr.append(el('td', 'num', compactCount(row.tokens.cacheWrite)));
    tbody.append(tr);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(d.totals.tonight)));
  fr.append(el('td', 'num', money(d.totals.day)));
  fr.append(el('td', 'num', money(d.totals.week)));
  fr.append(el('td', 'num', money(d.totals.allTime)));
  const note = el('td', 'dim', d.label);
  note.setAttribute('colspan', '4');
  fr.append(note);
  tfoot.append(fr);
  table.append(tfoot);
  sec.append(table);
  box.append(sec);
}
