// The Audit view (fleet plan §4 D12; §3 H13 reconciliation, README 3.5 audit authority).
//
// Hub mode: the hub's own log, `GET /api/fleet/audit?since=&builder=&limit=` (H13 `list({since, builder,
// limit})` -> {entries:[{ts, id, user, via, builder, action, target, ok, state, builderEntry}], more, forks}),
// one row per relayed action with its reconciliation state (match / pending / missing-on-builder /
// outcome-differs / unknown-settled; null for hub-only entries such as anchors), plus builder `via:'hub'`
// actions the hub never sent (unknown-on-hub, when the body carries `mismatches`). Fork alarms (`forks`, and
// the store's `audit-fork` alarms) are shown with the text the hub wrote.
// Builder mode: `GET /api/v1/audit?since=&limit=` (A8: {builder, head:{hash, count}, entries, more}), the raw
// chain with its head and a hint to run `laneboard audit verify`.
//
// Until the hub route is wired (H11) a 404/503 renders an empty state, never an error banner.
// Filters: `b` (builder) and `q` (text) live in the route; the action and state chips are view-local.
// Everything in an audit entry may come from a builder: it is untrusted text, clamped, stripped of control
// characters and put on the page with textContent only. Pure at import time (no `document` until mount).
// Styles: public/css/views/audit.css (linked from index.html).
import { panel, setPanel, dataTable, scopeChip } from '../ui/components.js';

export const SINCE_MS = 24 * 3600_000;
export const LIMIT = 1000;
export const POLL_MS = 30_000;
const FIELD_MAX = 200;
const TEXT_MAX = 400;
const ID_RX = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Every reconciliation state the view knows, in chip order (mismatches first). */
export const AUDIT_STATES = Object.freeze([
  'missing-on-builder', 'outcome-differs', 'unknown-on-hub', 'unknown-settled', 'pending', 'match',
]);

/** state -> {shape, p, label}: ▲ a mismatch, ◆ settled after an unknown outcome, ○ pending; match is plain. */
export const STATE_MARK = Object.freeze({
  'missing-on-builder': Object.freeze({ shape: '▲', p: '2', label: 'missing on builder' }),
  'outcome-differs': Object.freeze({ shape: '▲', p: '2', label: 'outcome differs' }),
  'unknown-on-hub': Object.freeze({ shape: '▲', p: '2', label: 'unknown on hub' }),
  'unknown-settled': Object.freeze({ shape: '◆', p: '3', label: 'unknown, settled by builder' }),
  pending: Object.freeze({ shape: '○', p: 'off', label: 'pending' }),
  match: Object.freeze({ shape: '', p: 'off', label: 'match' }),
});

/** True for a state shown as a mismatch (▲). */
export function isMismatch(state) {
  return STATE_MARK[state]?.shape === '▲';
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Untrusted -> a display string (or null): control characters replaced, length clamped. */
export function clean(v, max = FIELD_MAX) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string' || v === '') return null;
  const s = (typeof v.toWellFormed === 'function' ? v.toWellFormed() : v).replace(CONTROL, '\ufffd');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** ms -> `YYYY-MM-DD HH:MM:SS` in UTC, or null. */
export function fmtTs(ts) {
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `ok` as shown: true -> 'ok', false -> 'fail', 'unknown' -> '?', anything else -> null. */
export function okText(ok) {
  if (ok === true) return 'ok';
  if (ok === false) return 'fail';
  if (ok === 'unknown') return '?';
  return null;
}

/** The fetch URL for a mode: hub -> /api/fleet/audit, builder -> /api/v1/audit. */
export function auditUrl(mode, { since = null, builder = null, limit = LIMIT } = {}) {
  const q = [];
  if (Number.isFinite(since) && since >= 0) q.push(`since=${Math.floor(since)}`);
  if (mode === 'hub' && typeof builder === 'string' && builder !== 'all' && ID_RX.test(builder)) q.push(`builder=${encodeURIComponent(builder)}`);
  if (Number.isInteger(limit) && limit >= 1) q.push(`limit=${Math.min(limit, LIMIT)}`);
  const base = mode === 'hub' ? '/api/fleet/audit' : '/api/v1/audit';
  return q.length ? `${base}?${q.join('&')}` : base;
}

function phaseOf(e, relayed) {
  const p = clean(e.phase, 16) ?? clean(isObj(e.result) ? e.result.phase : null, 16);
  if (p) return p;
  // a hub list row is the outcome entry when there is one: a boolean `ok` means the relay saw `done`
  if (relayed && (e.ok === true || e.ok === false)) return 'done';
  return null;
}

function okOf(e) {
  if (e.ok === true || e.ok === false || e.ok === 'unknown') return e.ok;
  const r = isObj(e.result) ? e.result : null;
  if (r && (r.ok === true || r.ok === false || r.ok === 'unknown')) return r.ok;
  return null;
}

function rowOf(e, i, { state = undefined } = {}) {
  const st = state !== undefined ? state : (AUDIT_STATES.includes(e.state) ? e.state : null);
  const relayed = st !== null;
  const ts = Number.isSafeInteger(e.ts) ? e.ts : null;
  const id = clean(e.id, 128);
  return {
    key: `${id ?? 'noid'}:${i}`,
    ts,
    time: fmtTs(ts),
    id,
    user: clean(e.user),
    via: clean(e.via, 32),
    builder: clean(e.builder, 64),
    action: clean(e.action, 64),
    target: clean(e.target),
    ok: okOf(e),
    phase: phaseOf(e, relayed),
    state: st,
  };
}

/**
 * A response body -> the view model. Pure.
 * {mode, rows, forks:[{builder, text, at}], head:{hash, count}|null, builder, more}
 */
export function auditModel(mode, body) {
  const b = isObj(body) ? body : {};
  const list = Array.isArray(b.entries) ? b.entries : [];
  const rows = [];
  list.forEach((e, i) => { if (isObj(e)) rows.push(rowOf(e, i, mode === 'hub' ? {} : { state: null })); });
  if (mode === 'hub' && Array.isArray(b.mismatches)) {
    // H13 signals: only unknown-on-hub has no hub row of its own
    b.mismatches.forEach((m, i) => {
      if (isObj(m) && m.state === 'unknown-on-hub') rows.push(rowOf({ ...m, via: m.via ?? 'hub' }, `u${i}`, { state: 'unknown-on-hub' }));
    });
  }
  const forks = [];
  for (const f of Array.isArray(b.forks) ? b.forks : []) {
    if (!isObj(f)) continue;
    const text = clean(f.text, TEXT_MAX);
    const builder = clean(f.builder, 64);
    if (text || builder) forks.push({ builder, text: text ?? `audit chain of ${builder} was rewritten after an anchor`, at: Number.isFinite(f.at) ? f.at : null });
  }
  let head = null;
  if (isObj(b.head) && typeof b.head.hash === 'string') {
    head = { hash: clean(b.head.hash, 64), count: Number.isSafeInteger(b.head.count) ? b.head.count : null };
  }
  return { mode: mode === 'hub' ? 'hub' : 'builder', rows, forks, head, builder: clean(b.builder, 64), more: b.more === true };
}

/** Fork alarms: the response's forks plus the store's `audit-fork` alarms, one per builder (the hub text wins). */
export function forkAlarms(model, storeAlarms) {
  const out = [];
  const seen = new Set();
  for (const f of model?.forks ?? []) {
    const k = f.builder ?? f.text;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  for (const a of Array.isArray(storeAlarms) ? storeAlarms : []) {
    if (!isObj(a) || a.kind !== 'audit-fork') continue;
    const builder = clean(a.builder, 64);
    const text = clean(a.text, TEXT_MAX);
    const k = builder ?? text;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ builder, text: text ?? `audit chain of ${builder} was rewritten after an anchor`, at: Number.isFinite(a.ts) ? a.ts : null });
  }
  return out;
}

function hay(r) {
  return [r.user, r.via, r.builder, r.action, r.target, r.id, r.state, r.phase, okText(r.ok)]
    .filter(Boolean).join(' ').toLowerCase();
}

/** Filter rows by builder `b`, text `q` (all words), and the action / state chip sets (empty = all). Pure. */
export function filterRows(rows, { b = null, q = null, actions = null, states = null } = {}) {
  const words = typeof q === 'string' ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const acts = actions instanceof Set && actions.size ? actions : null;
  const sts = states instanceof Set && states.size ? states : null;
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (b && b !== 'all' && r.builder !== b) return false;
    if (acts && !acts.has(r.action ?? '')) return false;
    if (sts && !sts.has(r.state ?? 'none')) return false;
    if (words.length) {
      const h = hay(r);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

function countBy(rows, f) {
  const m = new Map();
  for (const r of rows) {
    const k = f(r);
    if (k === null || k === undefined) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * The chip rows: builders (store builders plus those in the log), actions and states seen, with counts.
 * Pure. -> {builders:[{id, n}], actions:[{id, n}], states:[{id, n, mark}]}
 */
export function chipModel(rows, builderIds = []) {
  const list = Array.isArray(rows) ? rows : [];
  const bs = countBy(list, (r) => r.builder);
  for (const id of builderIds) if (typeof id === 'string' && id && !bs.has(id)) bs.set(id, 0);
  const as = countBy(list, (r) => r.action);
  const ss = countBy(list, (r) => r.state);
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    builders: [...bs].map(([id, n]) => ({ id, n })).sort(byId),
    actions: [...as].map(([id, n]) => ({ id, n })).sort(byId),
    states: AUDIT_STATES.filter((s) => ss.has(s)).map((s) => ({ id: s, n: ss.get(s), mark: STATE_MARK[s] })),
  };
}

/** Counts for the summary line. Pure. */
export function summary(rows) {
  const out = { total: 0, mismatch: 0, settled: 0, pending: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    out.total++;
    if (isMismatch(r.state)) out.mismatch++;
    else if (r.state === 'unknown-settled') out.settled++;
    else if (r.state === 'pending') out.pending++;
  }
  return out;
}

/**
 * Fetch one audit page. -> {kind:'ok', body} | {kind:'unavailable', status} (404/503: route not wired yet or
 * no audit log) | {kind:'error', message}. Never throws.
 */
export async function loadAudit(url, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404 || r.status === 503) return { kind: 'unavailable', status: r.status };
    if (!r.ok) return { kind: 'error', message: `HTTP ${r.status}` };
    const body = await r.json();
    return { kind: 'ok', body };
  } catch (err) {
    return { kind: 'error', message: clean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

/** 'hub' when the store is fed by a hub, else 'builder'. */
export function modeOf(store) {
  return store?.source?.kind === 'hub' || store?.source?.hello?.mode === 'hub' ? 'hub' : 'builder';
}

// ---------------------------------------------------------------- DOM (runtime only)

function auNode(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function clear(n) {
  if (typeof n.replaceChildren === 'function') n.replaceChildren();
  else n.textContent = '';
}

/** The STATE cell: shape + word, coloured only when abnormal. */
export function stateCell(state) {
  const n = auNode('span', 'au-st');
  if (!state) { n.textContent = '—'; return n; }
  const m = STATE_MARK[state];
  n.dataset.state = state;
  if (m?.p && m.p !== 'off') n.dataset.p = m.p;
  if (m?.shape) n.append(auNode('span', 'au-shape', m.shape));
  n.append(auNode('span', 'au-word', state));
  const label = m?.label ?? state;
  n.title = label;
  n.setAttribute('aria-label', `state: ${label}`);
  return n;
}

function okCell(ok) {
  const t = okText(ok);
  const n = auNode('span', 'au-ok', t ?? '—');
  if (ok === false) n.dataset.p = '2';
  return n;
}

const COLUMNS = Object.freeze([
  { key: 'ts', label: 'TS', title: 'Time (UTC)', cell: (r) => r.time },
  { key: 'user', label: 'USER', title: 'User' },
  { key: 'via', label: 'VIA', title: 'Request path (local, direct, hub)' },
  { key: 'builder', label: 'B', title: 'Builder' },
  { key: 'action', label: 'ACTION', title: 'Action' },
  { key: 'target', label: 'TARGET', title: 'Target' },
  { key: 'ok', label: 'OK', title: 'Outcome', cell: (r) => okCell(r.ok) },
  { key: 'phase', label: 'PHASE', title: 'Phase (sent, start, done)' },
  { key: 'state', label: 'STATE', title: 'Reconciliation with the builder log', cell: (r) => stateCell(r.state) },
]);

function chip(text, { pressed, title, onClick, mark = null, n = null }) {
  const b = auNode('button', 'chip au-chip');
  b.type = 'button';
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  if (mark?.shape) {
    const s = auNode('span', 'au-shape', mark.shape);
    if (mark.p && mark.p !== 'off') s.dataset.p = mark.p;
    b.append(s);
  }
  b.append(auNode('span', 'chip-t', text));
  if (Number.isFinite(n)) b.append(auNode('span', 'au-n', `[${n}]`));
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function chipGroup(label) {
  const g = auNode('div', 'au-chips');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  g.append(auNode('span', 'au-lbl', label.toUpperCase().slice(0, 5)));
  return g;
}

const STATE_OF = { view: null };

function freshState(el, ctx) {
  return {
    el, ctx, route: ctx.route ?? {}, mode: modeOf(ctx.store), model: null, status: 'loading', message: null,
    actions: new Set(), states: new Set(), timer: null, seq: 0, panel: null, parts: null,
  };
}

function navigateTo(st, patch) {
  const nav = st.ctx?.navigate;
  if (typeof nav === 'function') nav(patch, { replace: true });
}

function toggle(set, k) {
  if (set.has(k)) set.delete(k); else set.add(k);
}

function build(st) {
  const p = panel({ name: 'AUDIT', scope: st.route.b || 'all' });
  const forks = auNode('div', 'au-forks');
  forks.setAttribute('role', 'alert');
  const head = auNode('div', 'au-head');
  const filters = auNode('div', 'au-filters');
  const sumEl = auNode('p', 'au-sum');
  sumEl.setAttribute('aria-live', 'polite');
  const empty = auNode('p', 'empty au-empty');
  st.el.append(p.root);
  p.body.append(forks, head, filters, sumEl);
  let table = null;
  try {
    table = dataTable({
      columns: COLUMNS,
      label: 'Audit log',
      sort: { key: 'ts', dir: 'desc' },
      rowKey: (r) => r.key,
      stale: (r) => r.state === 'pending',
    });
    table.root.classList.add('au-table');
    p.body.append(table.root);
  } catch {
    table = null; // a DOM without replaceChildren (an old browser or a test double): text-only empty state
  }
  p.body.append(empty);
  st.panel = p;
  st.parts = { forks, head, filters, sumEl, table, empty };
}

function paintForks(st) {
  const { forks } = st.parts;
  clear(forks);
  const list = forkAlarms(st.model, st.ctx.store?.alarms);
  forks.hidden = list.length === 0;
  for (const f of list) {
    const line = auNode('div', 'au-fork');
    line.dataset.p = '1';
    line.append(auNode('span', 'au-shape', '■'));
    line.append(auNode('span', 'au-fork-k', 'FORK'));
    if (f.builder) line.append(auNode('span', 'plate', f.builder));
    line.append(auNode('span', 'au-fork-t', f.text));
    if (f.at) line.append(auNode('span', 'au-fork-at', `${fmtTs(f.at)} UTC`));
    line.title = `audit-fork: ${f.text}`;
    forks.append(line);
  }
}

function paintHead(st) {
  const { head } = st.parts;
  clear(head);
  const m = st.model;
  head.hidden = !(m && m.mode === 'builder' && st.status === 'ok');
  if (head.hidden) return;
  const h = m.head;
  head.append(auNode('span', 'au-lbl', 'HEAD'));
  const hash = auNode('span', 'au-hash', h?.hash ? h.hash.slice(0, 16) : '—');
  if (h?.hash) hash.title = h.hash;
  head.append(hash);
  head.append(auNode('span', 'au-n', Number.isFinite(h?.count) ? `[${h.count}]` : ''));
  const hint = auNode('span', 'au-hint');
  hint.append('verify the chain on this builder: ');
  hint.append(auNode('code', null, 'laneboard audit verify'));
  head.append(hint);
}

function paintFilters(st, rows) {
  const { filters } = st.parts;
  clear(filters);
  const r = st.route;
  const ids = (st.ctx.store?.builders instanceof Map) ? [...st.ctx.store.builders.keys()] : [];
  const chips = chipModel(rows, st.mode === 'hub' ? ids : []);
  if (st.mode === 'hub' && chips.builders.length) {
    const g = chipGroup('Builder');
    g.append(chip('ALL', { pressed: !r.b || r.b === 'all', title: 'All builders', onClick: () => navigateTo(st, { b: null }) }));
    for (const b of chips.builders) {
      const on = r.b === b.id;
      g.append(chip(b.id, { pressed: on, n: b.n, title: on ? `Show all builders` : `Only builder ${b.id}`, onClick: () => navigateTo(st, { b: on ? null : b.id }) }));
    }
    filters.append(g);
  }
  if (chips.actions.length) {
    const g = chipGroup('Action');
    for (const a of chips.actions) {
      g.append(chip(a.id, { pressed: st.actions.has(a.id), n: a.n, title: `Filter action ${a.id}`, onClick: () => { toggle(st.actions, a.id); paintAudit(st); } }));
    }
    filters.append(g);
  }
  if (chips.states.length) {
    const g = chipGroup('State');
    for (const s of chips.states) {
      g.append(chip(s.id, { pressed: st.states.has(s.id), n: s.n, mark: s.mark, title: `Filter state ${s.mark?.label ?? s.id}`, onClick: () => { toggle(st.states, s.id); paintAudit(st); } }));
    }
    filters.append(g);
  }
  if (r.q) {
    const g = chipGroup('Text');
    g.append(scopeChip(r.q, { param: 'q', onRemove: () => navigateTo(st, { q: null }) }));
    filters.append(g);
  }
  filters.hidden = filters.children?.length === 0;
}

function emptyText(st, all, shown) {
  if (st.status === 'loading') return 'Loading the audit log…';
  if (st.status === 'unavailable') {
    return st.mode === 'hub'
      ? 'The hub audit log is not available yet (the fleet audit route is not wired on this hub).'
      : 'This builder has no audit log: fleet auth is not configured.';
  }
  if (st.status === 'error') return `The audit log could not be loaded: ${st.message ?? 'request failed'}.`;
  if (!all.length) return 'No audit entries in the last 24 hours.';
  if (!shown.length) return 'No entries match the filters.';
  return '';
}

function paintAudit(st) {
  if (!st.parts) return;
  const all = st.model?.rows ?? [];
  const r = st.route;
  // the hub filters by builder server-side; in builder mode `b` names the builder itself
  const shown = filterRows(all, { b: st.mode === 'hub' ? r.b : null, q: r.q, actions: st.actions, states: st.states });
  setPanel(st.panel.root, { scope: (st.mode === 'hub' ? r.b : st.model?.builder) || 'all', n: st.status === 'ok' ? shown.length : null });
  paintForks(st);
  paintHead(st);
  paintFilters(st, all);
  const s = summary(shown);
  const { sumEl, table, empty } = st.parts;
  sumEl.hidden = st.status !== 'ok' || !all.length;
  sumEl.textContent = st.mode === 'hub'
    ? `${s.total} entries · ▲ ${s.mismatch} mismatch · ◆ ${s.settled} settled · ${s.pending} pending${st.model?.more ? ' · more in the log, showing the oldest page' : ''}`
    : `${s.total} entries${st.model?.more ? ' · more in the log' : ''}`;
  if (table) {
    table.update(shown);
    table.root.hidden = !shown.length;
  }
  const msg = emptyText(st, all, shown);
  empty.textContent = msg;
  empty.hidden = !msg;
  if (table) markRows(table, shown);
}

/** Mark mismatch rows on the <tr> (▲ in the STATE cell already carries the shape). */
function markRows(table, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const trs = table.table?.tBodies?.[0]?.rows ?? table.table?.children?.[1]?.children ?? [];
  for (const tr of trs) {
    const r = byKey.get(tr.dataset?.key);
    if (!r) continue;
    tr.classList.toggle('au-mis', isMismatch(r.state));
    tr.classList.toggle('au-settled', r.state === 'unknown-settled');
  }
}

async function refresh(st, fetchFn) {
  const seq = ++st.seq;
  const url = auditUrl(st.mode, { since: Date.now() - SINCE_MS, builder: st.mode === 'hub' ? st.route.b : null });
  const res = await loadAudit(url, fetchFn);
  if (STATE_OF.view !== st || seq !== st.seq) return; // unmounted, or a newer load is running
  if (res.kind === 'ok') {
    st.status = 'ok';
    st.model = auditModel(st.mode, res.body);
  } else if (res.kind === 'unavailable') {
    st.status = 'unavailable';
    st.model = null;
  } else {
    st.status = 'error';
    st.message = res.message;
    // keep the last good rows on a transient error
  }
  paintAudit(st);
}

/** Mount; `fetchFn` is injectable for tests (GET only: this view never sends an action). Returns the first load's promise. */
export function mountAudit(el, ctx = {}, { fetchFn = globalThis.fetch, poll = true } = {}) {
  if (!el) return Promise.resolve();
  unmountAudit();
  clear(el);
  const st = freshState(el, ctx);
  STATE_OF.view = st;
  build(st);
  paintAudit(st);
  if (poll && typeof setInterval === 'function') {
    st.timer = setInterval(() => { refresh(st, fetchFn); }, POLL_MS);
    st.timer?.unref?.();
  }
  st.fetchFn = fetchFn;
  return refresh(st, fetchFn);
}

export function unmountAudit() {
  const st = STATE_OF.view;
  if (!st) return;
  if (st.timer) clearInterval(st.timer);
  clear(st.el);
  STATE_OF.view = null;
}

/** A route change (same view) or a store change. Returns the reload promise when the builder filter changed. */
export function updateAudit(_store, ctx = {}) {
  const st = STATE_OF.view;
  if (!st) return null;
  if (ctx.store) st.ctx = { ...st.ctx, store: ctx.store };
  if (ctx.navigate) st.ctx.navigate = ctx.navigate;
  const mode = modeOf(st.ctx.store);
  let reload = mode !== st.mode;
  st.mode = mode;
  if (ctx.route) {
    const prevB = st.route.b ?? null;
    st.route = ctx.route;
    if (st.mode === 'hub' && (ctx.route.b ?? null) !== prevB) reload = true;
  }
  if (reload) return refresh(st, st.fetchFn);
  paintAudit(st);
  return null;
}

/** The scope shown in the panel title: the builder filter, or ALL. */
export function auditScope(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

export default {
  id: 'audit',
  icon: 'audit',
  title: 'Audit',
  mount: (el, ctx = {}) => { mountAudit(el, ctx); },
  unmount: () => unmountAudit(),
  update: (store, ctx = {}) => { updateAudit(store, ctx); },
};
