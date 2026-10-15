// The Archive: a Board filter over retired lanes, and the restore sheet
// (fleet plan §10 2.9/2.10 and §10 R14; security review S12a).
//
// Reached as `#/board?s=archive&q=<search>` (the conventions' `s` param, no
// view of its own). The rows come from
//   builder  GET /api/v1/archive?q=           {rows}
//   hub      GET /api/fleet/archive?q=        {rows, missing}  rows carry builder + fkey
// and a row's detail (markers, plan head, the `restore` prefill) from
//   builder  GET /api/v1/archive/:lane
//   hub      GET /api/fleet/:builder/v1/archive/:lane   (§3 H12 signed read proxy)
//
// Restore is the `launch` action under the new id the builder chose
// (`restore.lane`, the first free `<id>-r<N>`), sent through act() after the
// §4 confirm dialog. It defaults to the row's SOURCE builder; choosing another
// builder shows a "from builder X data" warning and the full archived plan
// text, and the send button stays disabled until the user ticks that they have
// read it (S12a: the plan and the branch were written by X's agent). A branch
// that is gone (`restore.branchExists === false`) is refused in the sheet,
// before anything is sent.
//
// Everything in an archive row was written by an agent: it is only ever put on
// the page as textContent (no HTML sinks). Routes only select and filter: the
// route listener here reads, it never sends (S20); only a click in the sheet
// sends the launch.
//
// Pure at import time.
import { $ } from '../core/dom.js';
import { ago, money } from '../core/format.js';
import { BUILDER_ID_RX, fkey } from '../core/keys.js';
import { localBuilderId, store } from '../core/store.js';
import { act as pageAct } from '../core/actions.js';
import { navigate, onRoute } from '../core/router.js';
import { confirmAction } from '../ui/confirm.js';

export const ARCHIVE_STATE = 'archive';
/** launch.mjs / builtin-actions LANE_RE: what a restore id must look like. */
export const LANE_RX = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const Q_MAX = 200;
/** Cap on the plan text shown in the sheet (the archive keeps the first 64 KiB). */
export const PLAN_SHOW_MAX = 64 * 1024;
const MARKERS_SHOWN = 50;
const SEARCH_DEBOUNCE_MS = 250;
/** The launch arguments a restore sends, in this order (builtin-actions `launch` schema). */
export const RESTORE_ARG_KEYS = Object.freeze(['repo', 'branch', 'plan', 'model', 'permissionMode', 'restoredFrom']);

const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const isStr = (v) => typeof v === 'string' && v !== '';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Is this route the Archive filter of the Board? */
export function isArchiveRoute(route) {
  return Boolean(route) && route.view === 'board' && route.s === ARCHIVE_STATE;
}

/** The list URL for a source of `kind` ('hub' or local). */
export function listUrl(kind, q = null) {
  const base = kind === 'hub' ? '/api/fleet/archive' : '/api/v1/archive';
  const text = typeof q === 'string' ? q.trim().slice(0, Q_MAX) : '';
  return text ? `${base}?q=${encodeURIComponent(text)}` : base;
}

/** The detail URL of one archived lane, or null for an id that cannot be one. */
export function detailUrl(kind, builder, lane) {
  if (!isStr(lane) || !LANE_RX.test(lane)) return null;
  const seg = encodeURIComponent(lane);
  if (kind === 'hub') {
    if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) return null;
    return `/api/fleet/${builder}/v1/archive/${seg}`;
  }
  return `/api/v1/archive/${seg}`;
}

/**
 * A list response -> {rows, missing}. Each row is tagged with its builder: the
 * hub's tag (validated) on a hub, the local builder otherwise. Rows without a
 * usable lane id or builder are dropped.
 */
export function normRows(body, { kind = 'local', localId = null } = {}) {
  const list = Array.isArray(body?.rows) ? body.rows : [];
  const rows = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || !isStr(r.lane) || !LANE_RX.test(r.lane)) continue;
    const builder = kind === 'hub' ? r.builder : localId;
    if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) continue;
    rows.push({ ...r, builder, fkey: fkey(builder, r.lane) });
  }
  const missing = Array.isArray(body?.missing) ? body.missing.filter((b) => typeof b === 'string' && BUILDER_ID_RX.test(b)) : [];
  return { rows, missing };
}

/** 90061000 -> "1d 1h"; 3720000 -> "1h 2m"; 42000 -> "42s". */
export function fmtDuration(ms) {
  const v = num(ms);
  if (v === null || v < 0) return '—';
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "#12 merged" / "#12 open" / "—". */
export function prLabel(row) {
  const n = num(row?.pr_number);
  if (n === null) return '—';
  const state = row?.merged === true || row?.merged === 1 ? 'merged' : str(row?.pr_state).toLowerCase();
  return state ? `#${n} ${state}` : `#${n}`;
}

/** "3/5" or "—". */
export function stagesLabel(row) {
  const n = num(row?.stage_n);
  const m = num(row?.stage_m);
  return n === null || m === null ? '—' : `${n}/${m}`;
}

/** The table columns, in plan order (lane, builder, repo, branch, retired, duration, cost, PR, stages, summary). */
export const COLUMNS = Object.freeze([
  ['lane', 'Lane', (r) => str(r.lane)],
  ['builder', 'Builder', (r) => str(r.builder)],
  ['repo', 'Repo', (r) => str(r.repo)],
  ['branch', 'Branch', (r) => str(r.branch)],
  ['retired', 'Retired', (r) => (num(r.retired_at) ? `${ago(r.retired_at)} ago` : '—')],
  ['duration', 'Duration', (r) => fmtDuration(r.duration_ms)],
  ['cost', 'Cost', (r) => (num(r.cost_usd) === null ? '—' : money(r.cost_usd))],
  ['pr', 'PR', prLabel],
  ['stages', 'Stages', stagesLabel],
  ['summary', 'Summary', (r) => str(r.summary).slice(0, 200)],
]);

/**
 * The launch args a restore sends: only the schema's keys, only non-empty
 * strings. `legacy` (a builder without the v1 actions endpoint) also carries
 * the lane id, because POST /api/lanes takes it in the body.
 */
export function restoreArgs(restore, { legacy = false } = {}) {
  const out = {};
  if (!restore || typeof restore !== 'object') return out;
  if (legacy && isStr(restore.lane)) out.lane = restore.lane;
  for (const k of RESTORE_ARG_KEYS) if (isStr(restore[k])) out[k] = restore[k];
  return out;
}

/**
 * The restore sheet's state for a detail row, its source builder and the
 * builder chosen in the sheet. Pure.
 *   {lane, source, chosen, cross, warning, planText, needsAck, refusal, canSend, args}
 * `refusal` is the sentence shown when nothing can be sent.
 */
export function restoreModel({ detail, source, chosen = source, builders = [], ack = false, legacy = false } = {}) {
  const r = detail && typeof detail.restore === 'object' && detail.restore ? detail.restore : null;
  const pick = isStr(chosen) ? chosen : source;
  const cross = isStr(source) && pick !== source;
  const planText = typeof detail?.plan_head === 'string' ? detail.plan_head.slice(0, PLAN_SHOW_MAX) : '';
  const m = {
    lane: r && isStr(r.lane) ? r.lane : null,
    source: source ?? null,
    chosen: pick ?? null,
    cross,
    warning: cross ? `From builder ${source} data: the plan and the branch were written by ${source}'s agent. Read the plan below before you send it to ${pick}.` : null,
    planText,
    needsAck: cross,
    refusal: null,
    canSend: false,
    args: restoreArgs(r, { legacy }),
  };
  if (!r) m.refusal = 'This archive row carries no restore data (the builder predates restore).';
  else if (r.branchExists === false) {
    m.refusal = `Cannot restore: branch ${str(r.branch) || '(none)'} no longer exists on ${source} (neither a local branch nor origin/${str(r.branch)}).`;
  } else if (!m.lane || !LANE_RX.test(m.lane)) m.refusal = 'Cannot restore: the builder found no free restore id.';
  else if (!isStr(r.repo)) m.refusal = 'Cannot restore: the archive row has no repo.';
  else if (!isStr(r.plan)) m.refusal = 'Cannot restore: the archive row has no plan path.';
  else if (!isStr(pick) || !BUILDER_ID_RX.test(pick) || !builders.includes(pick)) m.refusal = `Cannot restore: ${pick ?? 'no builder'} is not a known builder.`;
  else if (cross && !planText) m.refusal = `Cannot restore on another builder: no plan text was archived on ${source} to show first.`;
  m.canSend = m.refusal === null && (!m.needsAck || ack === true);
  return m;
}

/** The key act() resolves: a fleet key on a hub, the bare lane id on a builder. */
export function restoreKey(kind, builder, lane) {
  return kind === 'hub' ? fkey(builder, lane) : lane;
}

/** The builders a restore can go to: every hub builder, or the local one. */
export function restoreBuilders(s = store) {
  if (s?.source?.kind === 'hub') return [...(s.builders?.keys?.() ?? [])].filter((b) => BUILDER_ID_RX.test(b)).sort();
  const id = localBuilderId(s);
  return id ? [id] : [];
}

async function getJson(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error((body && typeof body.error === 'string' && body.error) || `HTTP ${r.status}`);
  if (!body || typeof body !== 'object') throw new Error('bad response');
  return body;
}

/** Fetch and normalise the list. */
export async function loadArchive({ q = null, kind = 'local', localId = null, fetchImpl = (u, i) => fetch(u, i) } = {}) {
  return normRows(await getJson(fetchImpl, listUrl(kind, q)), { kind, localId });
}

/** Fetch one row's detail. */
export async function loadDetail({ kind = 'local', builder, lane, fetchImpl = (u, i) => fetch(u, i) } = {}) {
  const url = detailUrl(kind, builder, lane);
  if (!url) throw new Error('bad lane id');
  return getJson(fetchImpl, url);
}

// ---------------------------------------------------------------- DOM

function mk(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function on(node, type, fn) {
  if (node && typeof node.addEventListener === 'function') node.addEventListener(type, fn);
}

/** The expanded part of a row: markers (newest first) and the plan head. */
export function renderDetail(detail, { doc = globalThis.document, onRestore = null } = {}) {
  const box = mk(doc, 'div', 'arc-detail');
  const markers = Array.isArray(detail?.markers) ? detail.markers.slice(0, MARKERS_SHOWN) : [];
  box.appendChild(mk(doc, 'h3', 'arc-h', `Markers (${markers.length})`));
  if (markers.length) {
    const ul = mk(doc, 'ul', 'arc-markers');
    for (const mrk of markers) {
      const li = mk(doc, 'li', 'arc-marker');
      li.appendChild(mk(doc, 'span', 'plate', str(mrk?.kind) || 'marker'));
      if (num(mrk?.ts)) li.appendChild(mk(doc, 'span', 'arc-ago', ` ${ago(mrk.ts)} ago `));
      li.appendChild(mk(doc, 'span', 'arc-text', str(mrk?.text).slice(0, 2000)));
      if (mrk?.dismissed_at) li.classList.add('is-stale');
      ul.appendChild(li);
    }
    box.appendChild(ul);
  } else {
    box.appendChild(mk(doc, 'p', 'empty', 'No markers were archived.'));
  }
  box.appendChild(mk(doc, 'h3', 'arc-h', `Plan ${str(detail?.plan_title) || str(detail?.plan_path)}`.trim()));
  box.appendChild(mk(doc, 'pre', 'arc-plan', typeof detail?.plan_head === 'string' && detail.plan_head ? detail.plan_head.slice(0, PLAN_SHOW_MAX) : '(no plan text archived)'));
  if (detail?.restored_as) box.appendChild(mk(doc, 'p', 'empty', `Already restored as ${str(detail.restored_as)}.`));
  if (onRestore) {
    const b = mk(doc, 'button', 'btn btn--primary arc-restore', 'Restore…');
    b.type = 'button';
    on(b, 'click', () => onRestore(detail));
    box.appendChild(b);
  }
  return box;
}

/**
 * The table of rows. `onExpand(row)` runs on a row click/Enter; `expanded`
 * maps fkey -> a detail node rendered right under that row.
 */
export function renderTable(rows, { doc = globalThis.document, onExpand = null, expanded = new Map() } = {}) {
  const wrap = mk(doc, 'div', 'dt-wrap');
  const table = mk(doc, 'table', 'dt arc-table');
  table.setAttribute('aria-label', 'Archived lanes');
  const thead = mk(doc, 'thead');
  const hr = mk(doc, 'tr');
  for (const [, label] of COLUMNS) {
    const th = mk(doc, 'th', null, label);
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = mk(doc, 'tbody');
  for (const row of rows) {
    const tr = mk(doc, 'tr', 'arc-row');
    tr.dataset.key = row.fkey;
    tr.tabIndex = 0;
    const open = expanded.has(row.fkey);
    tr.setAttribute('aria-expanded', open ? 'true' : 'false');
    for (const [key, , cell] of COLUMNS) {
      const text = cell(row);
      const td = mk(doc, 'td', key === 'cost' || key === 'duration' || key === 'stages' ? 'num' : null, text === '' ? '—' : text);
      if (key === 'summary') td.title = str(row.summary).slice(0, 2000);
      tr.appendChild(td);
    }
    if (onExpand) {
      on(tr, 'click', () => onExpand(row));
      on(tr, 'keydown', (e) => { if (e?.key === 'Enter') { e.preventDefault?.(); onExpand(row); } });
    }
    tbody.appendChild(tr);
    if (open) {
      const dr = mk(doc, 'tr', 'arc-detail-row');
      const td = mk(doc, 'td');
      td.colSpan = COLUMNS.length;
      td.appendChild(expanded.get(row.fkey));
      dr.appendChild(td);
      tbody.appendChild(dr);
    }
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

/**
 * The restore sheet: a <dialog> with the prefilled launch, the builder picker
 * (the source builder preselected), the cross-builder warning + full plan text
 * + "I have read it" tick, and Restore / Cancel. Restore runs the §4 confirm
 * (tier of `launch`) and then act(key, 'launch', args).
 *
 * deps: {doc, kind, builders, act, confirm, legacy, onDone(result)}.
 * Returns {root, choose(id), setAck(bool), send(), model(), close()}.
 */
export function restoreSheet(detail, source, deps = {}) {
  const doc = deps.doc ?? globalThis.document;
  const kind = deps.kind ?? 'local';
  const builders = Array.isArray(deps.builders) ? deps.builders : [];
  const actFn = deps.act ?? pageAct;
  const confirmFn = deps.confirm ?? confirmAction;
  const legacy = Boolean(deps.legacy);
  let chosen = source;
  let ack = false;
  let sending = false;
  const model = () => restoreModel({ detail, source, chosen, builders, ack, legacy });

  const root = mk(doc, 'dialog', 'cfm arc-sheet');
  root.setAttribute('aria-label', 'Restore an archived lane');
  const m0 = model();
  root.appendChild(mk(doc, 'h2', 'cfm-t', `Restore ${str(detail?.lane)}${m0.lane ? ` as ${m0.lane}` : ''}`));

  const facts = mk(doc, 'dl', 'arc-facts');
  for (const [k, label] of [['repo', 'Repo'], ['branch', 'Branch'], ['plan', 'Plan'], ['model', 'Model'], ['permissionMode', 'Permissions']]) {
    facts.appendChild(mk(doc, 'dt', null, label));
    facts.appendChild(mk(doc, 'dd', `arc-f-${k}`, str(detail?.restore?.[k]) || '—'));
  }
  root.appendChild(facts);

  const pickLab = mk(doc, 'label', 'arc-pick');
  pickLab.appendChild(mk(doc, 'span', null, 'Builder '));
  const select = mk(doc, 'select', 'arc-builder');
  for (const b of builders) {
    const o = mk(doc, 'option', null, b === source ? `${b} (source)` : b);
    o.value = b;
    if (b === source) o.selected = true;
    select.appendChild(o);
  }
  select.value = source;
  if (builders.length < 2) select.disabled = true;
  pickLab.appendChild(select);
  root.appendChild(pickLab);

  const warn = mk(doc, 'p', 'arc-warn');
  warn.setAttribute('role', 'alert');
  const plan = mk(doc, 'pre', 'arc-plan arc-plan-full');
  const ackLab = mk(doc, 'label', 'arc-ack');
  const ackBox = mk(doc, 'input');
  ackBox.type = 'checkbox';
  ackLab.append(ackBox, mk(doc, 'span', null, ' I have read the plan from the other builder'));
  const refusal = mk(doc, 'p', 'arc-refusal bad');
  refusal.setAttribute('role', 'alert');
  const status = mk(doc, 'p', 'arc-status');
  status.setAttribute('aria-live', 'polite');
  root.append(warn, plan, ackLab, refusal);

  const row = mk(doc, 'div', 'cfm-b');
  const cancel = mk(doc, 'button', 'btn', 'Cancel');
  cancel.type = 'button';
  const sendBtn = mk(doc, 'button', 'btn btn--primary arc-send', 'Restore');
  sendBtn.type = 'button';
  row.append(cancel, sendBtn);
  root.append(row, status);

  function paint() {
    const m = model();
    warn.hidden = !m.warning;
    warn.textContent = m.warning ?? '';
    // The full plan text is on screen whenever the target is not the source.
    plan.hidden = !m.cross;
    plan.textContent = m.cross ? (m.planText || '(no plan text archived)') : '';
    ackLab.hidden = !m.needsAck || m.refusal !== null;
    if (!m.needsAck) { ack = false; ackBox.checked = false; }
    refusal.hidden = !m.refusal;
    refusal.textContent = m.refusal ?? '';
    sendBtn.disabled = sending || !m.canSend;
    return m;
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (root.open && typeof root.close === 'function') root.close();
    root.remove?.();
  }

  function choose(id) {
    chosen = String(id ?? '');
    select.value = chosen;
    ack = false;
    ackBox.checked = false;
    return paint();
  }
  function setAck(v) {
    ack = v === true;
    ackBox.checked = ack;
    return paint();
  }

  async function send() {
    const m = paint();
    if (!m.canSend || sending) return { ok: false, error: m.refusal ?? 'not ready', code: 'refused' };
    sending = true;
    paint();
    const key = restoreKey(kind, m.chosen, m.lane);
    const lines = [
      `Launch ${m.lane} on ${m.chosen} from branch ${m.args.branch ?? '(default)'}`,
      `Plan ${m.args.plan}`,
      `Restored from ${m.source}/${str(detail?.lane)}`,
    ];
    if (m.cross) lines.push(`From builder ${m.source} data`);
    let res;
    try {
      const c = await confirmFn({ action: 'launch', targets: [kind === 'hub' ? key : m.lane], consequence: lines, builder: m.chosen });
      if (!c?.ok) {
        res = { ok: false, error: 'cancelled', code: 'cancelled' };
      } else {
        status.textContent = 'Sending…';
        res = await actFn(key, 'launch', m.args);
      }
    } catch (err) {
      res = { ok: false, error: String(err?.message ?? err), code: 'error' };
    }
    sending = false;
    if (res?.ok === true) {
      const job = res.result?.job ? ` (job ${str(res.result.job)})` : '';
      status.textContent = `Launched ${m.lane} on ${m.chosen}${job}.`;
      status.className = 'arc-status ok';
      sendBtn.disabled = true;
    } else if (res?.ok === 'unknown') {
      status.textContent = 'Sent, outcome unknown.';
      status.className = 'arc-status';
    } else if (res?.code !== 'cancelled') {
      status.textContent = `Refused: ${str(res?.error) || 'unknown error'}`;
      status.className = 'arc-status bad';
      paint();
    } else {
      status.textContent = '';
      paint();
    }
    deps.onDone?.(res);
    return res;
  }

  on(select, 'change', () => choose(select.value));
  on(ackBox, 'change', () => setAck(ackBox.checked === true));
  on(cancel, 'click', close);
  on(sendBtn, 'click', () => { send(); });
  on(root, 'cancel', (e) => { e?.preventDefault?.(); close(); });
  paint();
  return { root, choose, setAck, send, model, close };
}

// ---------------------------------------------------------------- page wiring

const page = { host: null, hidden: null, rows: [], missing: [], q: null, expanded: new Map(), seq: 0, timer: null, error: null, loaded: false };

function sourceKind() {
  return store.source?.kind === 'hub' ? 'hub' : 'local';
}

function hostFor() {
  const view = $('view-board');
  const grid = $('grid');
  if (!view || !grid) return null;
  if (page.host && page.host.isConnected !== false) return page.host;
  const doc = globalThis.document;
  const host = mk(doc, 'section', 'panel arc-view');
  host.id = 'archive-view';
  host.setAttribute('aria-label', 'Archive');
  const head = mk(doc, 'div', 'arc-head');
  head.appendChild(mk(doc, 'h2', 'panel-t', 'ARCHIVE'));
  const search = mk(doc, 'input', 'arc-search');
  search.type = 'search';
  search.placeholder = 'Search lane, branch, repo, plan, summary';
  search.setAttribute('aria-label', 'Search the archive');
  on(search, 'input', () => {
    clearTimeout(page.timer);
    page.timer = setTimeout(() => navigate({ q: search.value.trim() || null }, { replace: true }), SEARCH_DEBOUNCE_MS);
  });
  const back = mk(doc, 'button', 'btn btn--s', 'Back to lanes');
  back.type = 'button';
  on(back, 'click', () => navigate({ s: null, q: null }));
  head.append(search, back);
  const note = mk(doc, 'p', 'empty arc-note');
  const body = mk(doc, 'div', 'arc-body');
  host.append(head, note, body);
  host._parts = { search, note, body };
  // The lanes panel: the grid's nearest ancestor that is the board panel, else the grid.
  let lanesNode = grid;
  for (let n = grid.parentNode; n && n !== view; n = n.parentNode) {
    if (n.classList?.contains?.('board-panel')) { lanesNode = n; break; }
  }
  const parent = lanesNode.parentNode ?? view;
  parent.insertBefore(host, lanesNode.parentNode ? lanesNode : null);
  page.host = host;
  page.hidden = lanesNode;
  return host;
}

function paintPage() {
  const host = page.host;
  if (!host?._parts) return;
  const { note, body } = host._parts;
  const doc = globalThis.document;
  const bits = [];
  if (page.error) bits.push(`Could not load the archive: ${page.error}`);
  else bits.push(page.rows.length ? `${page.rows.length} archived lane${page.rows.length === 1 ? '' : 's'}` : 'No archived lanes match.');
  if (page.missing.length) bits.push(`not answering: ${page.missing.join(', ')}`);
  note.textContent = bits.join(' · ');
  body.textContent = '';
  body.appendChild(renderTable(page.rows, { doc, onExpand: expand, expanded: page.expanded }));
}

async function expand(row) {
  if (page.expanded.has(row.fkey)) {
    page.expanded.delete(row.fkey);
    paintPage();
    return;
  }
  const doc = globalThis.document;
  page.expanded.set(row.fkey, mk(doc, 'p', 'empty', 'Loading…'));
  paintPage();
  let node;
  try {
    const detail = await loadDetail({ kind: sourceKind(), builder: row.builder, lane: row.lane });
    node = renderDetail(detail, { doc, onRestore: (d) => openRestore(d, row.builder) });
  } catch (err) {
    node = mk(doc, 'p', 'bad', `Could not load ${row.lane}: ${String(err?.message ?? err)}`);
  }
  if (page.expanded.has(row.fkey)) page.expanded.set(row.fkey, node);
  paintPage();
}

/** Open the restore sheet for a loaded detail row from `source`. */
export function openRestore(detail, source) {
  const doc = globalThis.document;
  const legacy = sourceKind() !== 'hub' && !store.source?.hello?.capabilities?.includes?.('actions');
  const sheet = restoreSheet(detail, source, { doc, kind: sourceKind(), builders: restoreBuilders(store), legacy });
  doc.body?.appendChild(sheet.root);
  if (typeof sheet.root.showModal === 'function') sheet.root.showModal();
  else sheet.root.setAttribute('open', '');
  return sheet;
}

async function refresh(q) {
  const n = ++page.seq;
  try {
    const out = await loadArchive({ q, kind: sourceKind(), localId: localBuilderId(store) });
    if (n !== page.seq) return;
    page.rows = out.rows;
    page.missing = out.missing;
    page.error = null;
  } catch (err) {
    if (n !== page.seq) return;
    page.rows = [];
    page.missing = [];
    page.error = String(err?.message ?? err);
  }
  paintPage();
}

function show(route) {
  const host = hostFor();
  if (!host) return;
  host.hidden = false;
  if (page.hidden) page.hidden.hidden = true;
  const q = route.q ?? null;
  const { search } = host._parts;
  if (search.value.trim() !== (q ?? '')) search.value = q ?? '';
  if (q !== page.q || !page.loaded) {
    page.q = q;
    page.loaded = true;
    page.expanded.clear();
    refresh(q);
  }
}

function hide() {
  if (page.host) page.host.hidden = true;
  if (page.hidden) page.hidden.hidden = false;
  page.loaded = false;
}

/** Route hook: show the archive on `#/board?s=archive`, hide it elsewhere. */
export function onArchiveRoute(route) {
  if (isArchiveRoute(route)) show(route);
  else if (page.host) hide();
}

let wired = false;
/** Wire the route listener once (boot). */
export function init() {
  if (wired) return;
  wired = true;
  onRoute(onArchiveRoute);
}
