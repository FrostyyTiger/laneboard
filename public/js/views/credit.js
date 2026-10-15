// The Credit view (fleet plan §4 D13; moved from public/app.js by F1).
//
// Two sources, one view:
//   builder (local source)  GET /api/credit             one builder's charts and lanes
//   hub                     GET /api/fleet/credit[?b=]  §7 O11 mergeCredit: per-builder
//                           charts, per-account windows, lanes as {builder, lane: fkey,
//                           localLane}, totals and totalsByBuilder, missing/stale builders
// `charts.sevenDay/fiveHour` have the same shape in both, so usageChart draws
// either. The 5 h / 7 d windows are account-wide counters: they are shown per
// account and NEVER summed. Cost is per builder and is summed by the hub.
//
// The default export is the view for the registry (views/index.js):
// mount loads (20 s cache), update reloads only when the source or the
// builder filter (`b=`) changed, unmount keeps the painted content.
//
// Everything a builder sends is untrusted: text goes in through textContent
// only (el()/lamp()/panel()), numbers are checked before they are formatted,
// and a lane hue reaches CSS only as a finite number.
import { $, el, svg } from '../core/dom.js';
import { BUILDER_ID_RX } from '../core/keys.js';
import { ago, compactCount, money, resetsIn } from '../core/format.js';
import { laneStripe } from '../ui/widgets.js';
import { lamp, panel, scopeChip } from '../ui/components.js';

export const BUILDER_PATH = '/api/credit';
export const HUB_PATH = '/api/fleet/credit';
export const CACHE_MS = 20000;
const COST_COLS = ['tonight', 'day', 'week', 'allTime'];
const TOKEN_COLS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const MAX_ROWS = 2000;
const MAX_POINTS = 2000;

// ---------------------------------------------------------------- pure model

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (fin(v) ? v : 0);
const txt = (v, max = 200) => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null);
const list = (v, max = MAX_ROWS) => (Array.isArray(v) ? v.slice(0, max) : []);

/** True when the page is fed by a hub (the store's source kind). */
export function isHubSource(s) {
  return s?.source?.kind === 'hub';
}

/** A builder filter from the route: a builder id, or null for all. */
export function builderFilter(route) {
  const b = route?.b;
  return typeof b === 'string' && b !== 'all' && BUILDER_ID_RX.test(b) ? b : null;
}

/** The URL to read: the builder's own route, or the hub's (with `?b=` when filtered). */
export function creditUrl({ hub = false, b = null } = {}) {
  if (!hub) return BUILDER_PATH;
  return b ? `${HUB_PATH}?b=${encodeURIComponent(b)}` : HUB_PATH;
}

function cleanChart(c, title) {
  const r = isObj(c) ? c : {};
  const points = [];
  for (const p of list(r.points, MAX_POINTS)) {
    if (isObj(p) && fin(p.t) && fin(p.v)) points.push({ t: p.t, v: p.v });
  }
  const resets = list(r.resets, MAX_POINTS).filter(fin);
  const now = fin(r.now) ? r.now : Date.now();
  const since = fin(r.since) ? r.since : (points[0]?.t ?? now);
  return { title: txt(r.title, 80) ?? title, since, now, points, resets };
}

function cleanWindow(w) {
  if (!isObj(w) || !fin(w.usedPct)) return null;
  return { usedPct: Math.max(0, Math.min(100, w.usedPct)), resetsAt: fin(w.resetsAt) ? w.resetsAt : null, builder: txt(w.builder, 64) };
}

function cleanTotals(t) {
  const o = isObj(t) ? t : {};
  const out = {};
  for (const k of COST_COLS) out[k] = num(o[k]);
  return out;
}

function cleanLane(row, fallbackBuilder) {
  if (!isObj(row)) return null;
  const out = {
    builder: txt(row.builder, 64) ?? fallbackBuilder,
    lane: txt(row.lane),
    localLane: txt(row.localLane) ?? txt(row.lane),
    hue: fin(row.hue) ? row.hue : null,
  };
  for (const k of COST_COLS) out[k] = k === 'allTime' && row.allTime === null ? null : num(row[k]);
  const t = isObj(row.tokens) ? row.tokens : {};
  out.tokens = {};
  for (const k of TOKEN_COLS) out.tokens[k] = num(t[k]);
  return out;
}

const strings = (v) => list(v).map((x) => txt(x, 64)).filter(Boolean);

/**
 * Any credit body (builder, hub merge, or hub `?b=`) -> one checked shape:
 * {hub, builder, charts:{sevenDay, fiveHour, account, accounts, byBuilder},
 *  rateLimits:{fiveHour, sevenDay, account, accounts}, lanes, totals,
 *  totalsByBuilder, builders, missing, stale, partial, sampler, label}.
 * Pure; never throws on garbage.
 */
export function normalizeCredit(raw, { hub = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const rc = isObj(r.charts) ? r.charts : {};
  const rl = isObj(r.rateLimits) ? r.rateLimits : {};
  const builder = txt(r.builder, 64);
  const accounts = {};
  if (isObj(rc.accounts)) {
    for (const [name, a] of Object.entries(rc.accounts).slice(0, 64)) {
      if (!isObj(a)) continue;
      accounts[name.slice(0, 64)] = {
        builders: strings(a.builders),
        sevenDay: cleanChart(a.sevenDay, '7-day window'),
        fiveHour: cleanChart(a.fiveHour, '5-hour window'),
      };
    }
  }
  const byBuilder = {};
  if (isObj(rc.byBuilder)) {
    for (const [id, c] of Object.entries(rc.byBuilder).slice(0, 256)) {
      if (!isObj(c)) continue;
      byBuilder[id.slice(0, 64)] = { sevenDay: cleanChart(c.sevenDay, '7-day window'), fiveHour: cleanChart(c.fiveHour, '5-hour window') };
    }
  }
  const gauges = {};
  if (isObj(rl.accounts)) {
    for (const [name, g] of Object.entries(rl.accounts).slice(0, 64)) {
      if (!isObj(g)) continue;
      gauges[name.slice(0, 64)] = { builders: strings(g.builders), fiveHour: cleanWindow(g.fiveHour), sevenDay: cleanWindow(g.sevenDay) };
    }
  }
  const totalsByBuilder = {};
  if (isObj(r.totalsByBuilder)) {
    for (const [id, t] of Object.entries(r.totalsByBuilder).slice(0, 256)) totalsByBuilder[id.slice(0, 64)] = cleanTotals(t);
  }
  const builders = [];
  for (const b of list(r.builders, 256)) {
    if (!isObj(b) || !txt(b.id, 64)) continue;
    builders.push({
      id: txt(b.id, 64),
      code: txt(b.code, 8),
      account: txt(b.account, 64),
      stale: b.stale === true,
      ok: b.ok === true,
      ageMs: fin(b.ageMs) ? b.ageMs : null,
      error: txt(b.error, 120),
      sampler: isObj(b.sampler) ? { rows: num(b.sampler.rows), lastSampleAt: fin(b.sampler.lastSampleAt) ? b.sampler.lastSampleAt : null } : null,
    });
  }
  const missing = strings(r.missing);
  const stale = strings(r.stale);
  const rs = isObj(r.sampler) ? r.sampler : {};
  return {
    hub,
    builder,
    charts: {
      sevenDay: cleanChart(rc.sevenDay, '7-day window'),
      fiveHour: cleanChart(rc.fiveHour, '5-hour window'),
      account: txt(rc.account, 64),
      accounts,
      byBuilder,
    },
    rateLimits: {
      fiveHour: cleanWindow(rl.fiveHour),
      sevenDay: cleanWindow(rl.sevenDay),
      account: txt(rl.account, 64),
      accounts: gauges,
    },
    lanes: list(r.lanes).map((row) => cleanLane(row, builder)).filter(Boolean),
    totals: cleanTotals(r.totals),
    totalsByBuilder,
    builders,
    missing,
    stale,
    partial: r.partial === true || missing.length > 0 || stale.length > 0,
    sampler: { rows: num(rs.rows), lastSampleAt: fin(rs.lastSampleAt) ? rs.lastSampleAt : null },
    label: txt(r.label, 80) ?? '',
  };
}

/** Status of builder `id` in a merged result: 'missing', 'stale' or 'ok'. */
export function builderStatus(d, id) {
  if (d.missing.includes(id)) return 'missing';
  if (d.stale.includes(id)) return 'stale';
  const b = d.builders.find((x) => x.id === id);
  if (b && (b.stale || !b.ok)) return 'stale';
  return 'ok';
}

/**
 * One row per builder for the breakdown: every builder the hub listed, plus
 * any that appear only in totals or `missing`. Sorted by all-time cost, then id.
 */
export function builderRows(d) {
  const ids = new Set([...d.builders.map((b) => b.id), ...Object.keys(d.totalsByBuilder), ...d.missing, ...d.stale]);
  const rows = [];
  for (const id of ids) {
    const b = d.builders.find((x) => x.id === id) ?? null;
    const status = builderStatus(d, id);
    rows.push({
      id,
      code: b?.code ?? null,
      account: b?.account ?? null,
      status,
      ageMs: b?.ageMs ?? null,
      error: b?.error ?? null,
      sampler: b?.sampler ?? null,
      totals: status === 'missing' ? null : (d.totalsByBuilder[id] ?? null),
    });
  }
  return rows.sort((a, b) => (b.totals?.allTime ?? -1) - (a.totals?.allTime ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The account windows, one row per account, as reported (never summed). A
 * single builder's result (no `accounts`) gives one row with no name.
 */
export function accountRows(d) {
  const names = Object.keys(d.rateLimits.accounts);
  if (!names.length) {
    if (!d.rateLimits.fiveHour && !d.rateLimits.sevenDay) return [];
    return [{ account: d.rateLimits.account, builders: d.builder ? [d.builder] : [], fiveHour: d.rateLimits.fiveHour, sevenDay: d.rateLimits.sevenDay }];
  }
  return names.sort().map((account) => ({ account, ...d.rateLimits.accounts[account] }));
}

export const CREDIT_COLUMNS = Object.freeze([
  { key: 'builder', label: 'builder', hub: true },
  { key: 'lane', label: 'lane' },
  { key: 'tonight', label: 'tonight', num: true },
  { key: 'day', label: '24 h', num: true },
  { key: 'week', label: '7 d', num: true },
  { key: 'allTime', label: 'all time', num: true },
  { key: 'input', label: 'in', num: true, tok: true },
  { key: 'output', label: 'out', num: true, tok: true },
  { key: 'cacheRead', label: 'cache rd', num: true, tok: true },
  { key: 'cacheWrite', label: 'cache wr', num: true, tok: true },
]);

/** The columns shown: the builder column only on a hub. */
export function columnsFor(hub) {
  return CREDIT_COLUMNS.filter((c) => !c.hub || hub);
}

/** The value a column sorts by. */
export function creditValue(row, col) {
  if (col.key === 'lane') return row.localLane ?? row.lane ?? '';
  if (col.key === 'builder') return row.builder ?? '';
  if (col.tok) return row.tokens?.[col.key] ?? 0;
  return row[col.key] ?? 0;
}

/** Visible lane rows (rows with no spend are hidden), sorted by `sort`, filtered to builder `b`. */
export function laneRows(d, { sort = 'allTime', desc = true, b = null } = {}) {
  const col = CREDIT_COLUMNS.find((c) => c.key === sort) ?? CREDIT_COLUMNS.find((c) => c.key === 'allTime');
  return d.lanes
    .filter((r) => r.allTime || r.tonight || r.week)
    .filter((r) => !b || !r.builder || r.builder === b)
    .sort((x, y) => {
      const av = creditValue(x, col);
      const bv = creditValue(y, col);
      const cmp = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv)) : av - bv;
      return desc ? -cmp : cmp;
    });
}

// ---------------------------------------------------------------- state and loading

/** The mounted section (`#view-credit`), or null. */
let root = null;
const credit = { data: null, loading: false, at: 0, url: null, sort: 'allTime', desc: true, hub: false, b: null, navigate: null, known: [] };

/** The view's state (tests read it). */
export function creditState() {
  return credit;
}

/** Point the view at a source/filter; true when that changes the URL. */
export function setSource({ hub = false, b = null } = {}) {
  credit.hub = Boolean(hub);
  credit.b = credit.hub ? b : null;
  return creditUrl(credit) !== credit.url;
}

export async function loadCredit(force = false) {
  if (credit.loading) return;
  const url = creditUrl(credit);
  if (!force && credit.data && credit.url === url && Date.now() - credit.at < CACHE_MS) {
    renderCredit();
    return;
  }
  credit.loading = true;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    credit.data = normalizeCredit(await r.json(), { hub: credit.hub });
    credit.at = Date.now();
    if (credit.hub && !credit.b && credit.data.builders.length) credit.known = credit.data.builders.map((b) => b.id);
  } catch (err) {
    credit.data = { error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    credit.url = url;
    credit.loading = false;
    renderCredit();
  }
  // The source or filter moved while the request was in flight.
  if (creditUrl(credit) !== credit.url) loadCredit(true);
}

// ---------------------------------------------------------------- charts

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
  const points = Array.isArray(chart.points) ? chart.points : [];
  const resets = Array.isArray(chart.resets) ? chart.resets : [];
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

  for (const at of resets) {
    root.append(svg('line', { class: 'reset-tick', x1: x(at), x2: x(at), y1: pad.t, y2: pad.t + h }));
  }

  if (!points.length) {
    const t = svg('text', { class: 'axis-label', x: pad.l + w / 2, y: pad.t + h / 2, 'text-anchor': 'middle' });
    t.textContent = 'no samples yet';
    root.append(t);
    return root;
  }

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  root.append(svg('polyline', { class: 'series', points: line }));

  // One <title> per point group so hovering says what and when, with no
  // tooltip machinery and no library.
  for (const p of points) {
    const g = svg('g');
    const c = svg('circle', { class: 'point', cx: x(p.t).toFixed(1), cy: y(p.v).toFixed(1), r: 6 });
    const title = svg('title');
    title.textContent = `${Math.round(p.v)}% · ${new Date(p.t).toLocaleString('en-GB', { hour12: false })}`;
    g.append(c, title);
    root.append(g);
  }
  return root;
}

function pctTag(w) {
  const n = el('span', 'chart-now', `${Math.round(w.usedPct)}%`);
  if (w.usedPct >= 95) n.classList.add('hot');
  else if (w.usedPct >= 80) n.classList.add('warn');
  return n;
}

function chartBlock(chart, current, { note = null, small = false } = {}) {
  const sec = el('section', 'mblock');
  const head = el('div', 'chart-head');
  head.append(el('h3', 'rail-h', chart.title));
  if (note) head.append(el('span', 'chart-range', note));
  if (current) {
    head.append(pctTag(current));
    head.append(el('span', 'chart-reset', resetsIn(current.resetsAt)));
  }
  head.append(el('span', 'chart-range',
    `${new Date(chart.since).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} → now`));
  sec.append(head);
  const scroller = el('div', 'chart-scroll');
  scroller.append(usageChart(chart, small ? { width: 480, height: 100 } : {}));
  sec.append(scroller);
  return sec;
}

// ---------------------------------------------------------------- render

const STATUS_P = Object.freeze({ ok: 'ok', stale: 'stale', missing: 'off' });
const STATUS_WORD = Object.freeze({ ok: 'ok', stale: 'stale', missing: 'missing' });

/** A lamp plus the word: colour never carries the meaning alone. */
function statusMark(status, id) {
  const s = el('span', `credit-status credit-${status}`);
  s.append(lamp(STATUS_P[status] ?? 'off', { label: `${id}: ${STATUS_WORD[status] ?? status}` }));
  s.append(el('span', null, ` ${STATUS_WORD[status] ?? status}`));
  return s;
}

function windowCell(w) {
  const td = el('td', 'num');
  if (!w) { td.textContent = '—'; return td; }
  td.append(pctTag(w));
  if (w.resetsAt) td.append(el('span', 'chart-reset', ` ${resetsIn(w.resetsAt)}`));
  return td;
}

function samplerText(d) {
  const s = d.sampler;
  const base = s.lastSampleAt ? `${s.rows} samples · last ${ago(s.lastSampleAt)} ago` : 'sampler has written nothing yet';
  if (!d.hub) return base;
  const parts = [base];
  if (d.missing.length) parts.push(`missing: ${d.missing.join(', ')}`);
  if (d.stale.length) parts.push(`stale: ${d.stale.join(', ')}`);
  return parts.join(' · ');
}

function filterBar(d) {
  const bar = el('div', 'credit-filter');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Builder filter');
  const ids = credit.known.length ? credit.known : d.builders.map((b) => b.id);
  const go = (b) => { if (credit.navigate) credit.navigate({ b }); };
  if (credit.b) {
    bar.append(scopeChip(credit.b, { param: 'b', title: `Show every builder (remove ${credit.b})`, onRemove: () => go('all') }));
    return bar;
  }
  for (const id of ['all', ...ids]) {
    const btn = el('button', `btn${id === 'all' ? ' on' : ''}`, id);
    btn.type = 'button';
    if (id === 'all') btn.setAttribute('aria-pressed', 'true');
    btn.onclick = () => go(id);
    bar.append(btn);
  }
  return bar;
}

function accountsPanel(d) {
  const rows = accountRows(d);
  const p = panel({ name: 'Accounts', scope: 'windows, never summed', n: rows.length });
  if (!rows.length) { p.body.append(el('p', 'empty', 'No rate-limit window reported yet.')); return p.root; }
  const table = el('table', 'dtable');
  const hr = el('tr');
  for (const [label, n] of [['account', false], ['builders', false], ['5 h', true], ['7 d', true]]) hr.append(el('th', n ? 'num' : null, label));
  const thead = el('thead');
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const a of rows) {
    const tr = el('tr');
    tr.append(el('td', null, a.account ?? 'this account'));
    tr.append(el('td', 'dim', a.builders.join(', ') || '—'));
    tr.append(windowCell(a.fiveHour));
    tr.append(windowCell(a.sevenDay));
    tbody.append(tr);
  }
  table.append(tbody);
  p.body.append(table);
  // More than one subscription: each account's own series, side by side.
  const names = Object.keys(d.charts.accounts);
  if (names.length > 1) {
    for (const name of names.sort()) {
      const a = d.charts.accounts[name];
      const g = d.rateLimits.accounts[name] ?? {};
      p.body.append(chartBlock(a.fiveHour, g.fiveHour, { note: name, small: true }));
      p.body.append(chartBlock(a.sevenDay, g.sevenDay, { note: name, small: true }));
    }
  }
  return p.root;
}

function buildersPanel(d) {
  const rows = builderRows(d);
  const p = panel({ name: 'Builders', scope: 'cost per builder', n: rows.length });
  if (!rows.length) { p.body.append(el('p', 'empty', 'No builder has answered yet.')); return p.root; }
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const [label, n] of [['builder', false], ['status', false], ['account', false], ['tonight', true], ['24 h', true], ['7 d', true], ['all time', true], ['samples', true]]) {
    hr.append(el('th', n ? 'num' : null, label));
  }
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const b of rows) {
    const tr = el('tr', b.status === 'ok' ? null : 'is-stale');
    const name = el('td');
    const btn = el('button', 'linkish', b.id);
    btn.type = 'button';
    btn.title = `Only ${b.id}`;
    btn.onclick = () => { if (credit.navigate) credit.navigate({ b: b.id }); };
    name.append(btn);
    tr.append(name);
    const st = el('td');
    st.append(statusMark(b.status, b.id));
    if (b.status === 'stale' && b.ageMs != null) st.append(el('span', 'dim', ` ${ago(Date.now() - b.ageMs)} old`));
    if (b.error && b.status !== 'ok') st.title = b.error;
    tr.append(st);
    tr.append(el('td', 'dim', b.account ?? '—'));
    for (const k of COST_COLS) tr.append(el('td', 'num', b.totals ? money(b.totals[k]) : '—'));
    tr.append(el('td', 'num', b.sampler ? compactCount(b.sampler.rows) : '—'));
    tbody.append(tr);
  }
  table.append(tbody);
  p.body.append(table);

  // Each builder's own samples, folded away: the account series above is the
  // number that matters; these say which box reported what.
  const ids = Object.keys(d.charts.byBuilder).sort();
  if (ids.length) {
    const more = el('details', 'credit-per-builder');
    more.append(el('summary', null, `per-builder charts (${ids.length})`));
    for (const id of ids) {
      const c = d.charts.byBuilder[id];
      more.append(chartBlock(c.fiveHour, null, { note: id, small: true }));
      more.append(chartBlock(c.sevenDay, null, { note: id, small: true }));
    }
    p.body.append(more);
  }
  return p.root;
}

function lanesSection(d) {
  const cols = columnsFor(d.hub);
  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Cost per lane'));
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const col of cols) {
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

  const tbody = el('tbody');
  for (const row of laneRows(d, { sort: credit.sort, desc: credit.desc, b: credit.b })) {
    const status = d.hub && row.builder ? builderStatus(d, row.builder) : 'ok';
    const tr = el('tr', status === 'ok' ? null : 'is-stale');
    if (d.hub) {
      const bt = el('td');
      if (status !== 'ok') bt.append(lamp(STATUS_P[status], { label: `${row.builder}: ${STATUS_WORD[status]}` }));
      bt.append(el('span', null, row.builder ?? '—'));
      tr.append(bt);
    }
    const td = el('td');
    td.append(laneStripe(row.hue));
    const name = el('span', null, row.localLane || '(no lane)');
    if (row.lane && row.lane !== row.localLane) name.title = row.lane;
    td.append(name);
    tr.append(td);
    tr.append(el('td', 'num', money(row.tonight)));
    tr.append(el('td', 'num', money(row.day)));
    tr.append(el('td', 'num', money(row.week)));
    // null means "the session is gone, so there is nothing to total".
    tr.append(el('td', 'num', row.allTime == null ? '—' : money(row.allTime)));
    for (const k of TOKEN_COLS) tr.append(el('td', 'num', compactCount(row.tokens[k])));
    tbody.append(tr);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, credit.b ? `total · ${credit.b}` : 'total'));
  if (d.hub) fr.append(el('td'));
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
  return sec;
}

function bodyNode() {
  let box = $('credit-body');
  if (!box && root) {
    box = el('div', 'view-body');
    root.append(box);
  }
  return box;
}

export function renderCredit() {
  const box = bodyNode();
  if (!box) return;
  box.textContent = '';
  const d = credit.data;
  if (!d) { box.append(el('p', 'empty', 'Loading…')); return; }
  if (d.error) { box.append(el('p', 'empty', `Could not load: ${d.error}`)); return; }

  const head = $('credit-sampler');
  if (head) head.textContent = samplerText(d);

  if (d.hub) box.append(filterBar(d));
  if (d.hub && d.partial) {
    const warn = el('p', 'credit-partial');
    warn.append(lamp('stale', { label: 'partial' }));
    warn.append(el('span', null, ` Partial: ${[...d.missing.map((id) => `${id} missing`), ...d.stale.map((id) => `${id} stale`)].join(', ')}`));
    box.append(warn);
  }

  const acct = d.hub && !credit.b && d.charts.account ? `account ${d.charts.account}` : (credit.b ? credit.b : null);
  box.append(chartBlock(d.charts.sevenDay, d.rateLimits.sevenDay, { note: acct }));
  box.append(chartBlock(d.charts.fiveHour, d.rateLimits.fiveHour, { note: acct }));

  if (d.hub && !credit.b) {
    box.append(accountsPanel(d));
    box.append(buildersPanel(d));
  }
  box.append(lanesSection(d));
}

// ---------------------------------------------------------------- the view

function sync(ctx = {}) {
  if (typeof ctx.navigate === 'function') credit.navigate = ctx.navigate;
  const s = ctx.store ?? null;
  const hub = s ? isHubSource(s) : credit.hub;
  const b = ctx.route ? builderFilter(ctx.route) : credit.b;
  return setSource({ hub, b });
}

export default {
  id: 'credit',
  icon: 'credit',
  title: 'Credit',
  short: 'CRED',
  mount: (node, ctx = {}) => {
    root = node ?? null;
    sync(ctx);
    loadCredit();
  },
  unmount: () => {
    // The painted view stays, so switching back is instant (as before D13).
    root = null;
  },
  update: (store, ctx = {}) => {
    if (sync({ ...ctx, store: store ?? ctx.store })) loadCredit(true);
  },
};
