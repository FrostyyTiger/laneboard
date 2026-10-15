// The split view's dense lane table (fleet plan §5 2.7, task M5).
//
// `\` (registered by §4 D8) toggles localStorage['lb.split'] and dispatches
// `lb:split`; views/map.js then lays the Map out at 60% (left) and this table
// at 40% (right). One row per lane, or per session for a lane that has
// session nodes, worst first:
//
//   ■/▲ state · B · lane · sess · tool/sub · ctx% · $24h · age
//
// Hover a row and the map lights that node (map.highlight); hover a node and
// its row gets `.is-hot`. Selection goes through the router (`sel=`), the one
// source of truth, so a click here and a click on the map are the same thing.
// More than VIRTUAL_FROM rows render as a window over a padded scroll area.
//
// The rows come from the map model (server/map.mjs nodes): builder-supplied
// labels, subs and names reach the page through textContent only. The pure
// parts (rows, sorting, formatting, the window) are tested in
// test/map-view.test.mjs.
import { SEVERITY } from './model.js';

/** localStorage key the hotkey writes (§4 D8). */
export const SPLIT_KEY = 'lb.split';
/** Below this width (CSS px) split is refused and the map stays full. */
export const SPLIT_MIN_W = 900;
/** Row height of the dense table, px. */
export const ROW_H = 22;
/** Above this many rows the table renders only what is in view. */
export const VIRTUAL_FROM = 80;
/** Extra rows rendered above and below the viewport when virtualized. */
export const OVERSCAN = 8;

/** The table's columns, in order: [key, header, numeric]. */
export const COLUMNS = Object.freeze([
  ['state', 'STATE', false],
  ['b', 'B', false],
  ['lane', 'LANE', false],
  ['sess', 'SESS', false],
  ['sub', 'TOOL/SUB', false],
  ['ctx', 'CTX%', true],
  ['usd', '$24H', true],
  ['age', 'AGE', true],
]);

/** True when the stored `lb.split` value turns split on. Pure. */
export function splitOn(stored) {
  return stored === '1';
}

/** True when a viewport this wide can show the split. Pure. */
export function canSplit(width) {
  return Number.isFinite(width) && width >= SPLIT_MIN_W;
}

/** The glyph of a status in the STATE column (2.5 shapes). Pure. */
export function stateGlyph(status) {
  switch (status) {
    case 'crit': case 'down': return '■';
    case 'warn': case 'attention': return '▲';
    case 'low': return '◆';
    case 'unknown': return '○';
    default: return '·';
  }
}

const STATE_WORD = {
  crit: 'CRIT', down: 'DOWN', warn: 'WARN', attention: 'WAIT', low: 'LOW',
  unknown: 'UNKN', working: 'WORK', ok: 'OK', idle: 'IDLE',
};

/** The four-letter word of a status. Pure. */
export function stateWord(status) {
  return STATE_WORD[status] ?? 'UNKN';
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v, max = 200) => (typeof v === 'string' ? (v.length > max ? `${v.slice(0, max)}…` : v) : '');

/** ctx% as a whole number, or an em dash. Pure. */
export function fmtCtx(pct) {
  return finite(pct) ? String(Math.round(Math.max(0, pct))) : '—';
}

/** USD with two decimals under $100, whole dollars above, or an em dash. Pure. */
export function fmtUsd(usd) {
  if (!finite(usd)) return '—';
  const v = Math.max(0, usd);
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

/** An age in ms as `45s`, `12m`, `3h`, `2d`, or an em dash. Pure. */
export function fmtAge(ms) {
  if (!finite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const sevRank = (s) => Math.max(0, SEVERITY.indexOf(s ?? 'unknown'));

/** A row's urgency: status first, then the flags that need a human. Pure. */
export function rowRank(row) {
  let r = sevRank(row.status) * 10;
  if (row.flags?.awaitingApproval) r += 4;
  if (row.flags?.stuck) r += 3;
  if (row.flags?.reviewReady) r += 1;
  return r;
}

/** Worst first, then builder, lane and session names (stable for equal rows). Pure. */
export function compareRows(a, b) {
  return rowRank(b) - rowRank(a)
    || a.builder.localeCompare(b.builder)
    || a.lane.localeCompare(b.lane)
    || a.sess.localeCompare(b.sess)
    || a.id.localeCompare(b.id);
}

/** The part of a fleet key after the builder (`builder-a/s1` -> `s1`). */
function localName(k) {
  if (typeof k !== 'string') return '';
  const i = k.indexOf('/');
  return i >= 0 ? k.slice(i + 1) : k;
}

/**
 * The table rows for a map model: lane nodes without session children, plus
 * every session node (its lane named from the parent). `scope` (rail `b=`)
 * keeps one builder's rows. Sorted worst first. Pure.
 */
export function splitRows(model, { scope = 'all' } = {}) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const byId = new Map();
  for (const n of nodes) if (n && typeof n.id === 'string') byId.set(n.id, n);
  const codes = new Map();
  for (const b of Array.isArray(model?.fleet?.builders) ? model.fleet.builders : []) {
    if (b && typeof b.id === 'string' && typeof b.code === 'string') codes.set(b.id, b.code);
  }
  for (const n of byId.values()) {
    if (n.kind === 'builder' && typeof n.builder === 'string' && !codes.has(n.builder) && typeof n.label === 'string') codes.set(n.builder, n.label);
  }
  const withSessions = new Set();
  for (const n of byId.values()) if (n.kind === 'session' && typeof n.parent === 'string') withSessions.add(n.parent);
  const rows = [];
  for (const n of byId.values()) {
    if (n.kind !== 'lane' && n.kind !== 'session') continue;
    if (n.kind === 'lane' && withSessions.has(n.id)) continue;
    const builder = typeof n.builder === 'string' ? n.builder : '';
    if (scope && scope !== 'all' && builder !== scope) continue;
    const parent = n.kind === 'session' ? byId.get(n.parent) : null;
    const m = n.m && typeof n.m === 'object' ? n.m : {};
    const pm = parent?.m && typeof parent.m === 'object' ? parent.m : {};
    const status = typeof n.status === 'string' ? n.status : 'unknown';
    rows.push({
      id: n.id,
      sel: typeof n.fkey === 'string' ? n.fkey : n.id,
      kind: n.kind,
      builder,
      code: text(codes.get(builder) ?? builder, 8),
      lane: text(n.kind === 'session' ? parent?.label ?? localName(parent?.fkey) : n.label ?? localName(n.fkey), 80),
      sess: text(n.kind === 'session' ? n.label ?? localName(n.fkey) : localName(n.session), 80),
      sub: text(n.sub ?? parent?.sub ?? '', 200),
      status,
      flags: n.flags && typeof n.flags === 'object' ? n.flags : (parent?.flags ?? {}),
      ctx: finite(m.ctxPct) ? m.ctxPct : finite(pm.ctxPct) ? pm.ctxPct : null,
      usd: finite(m.costUsd) ? m.costUsd : null,
      age: finite(m.ageMs) ? m.ageMs : finite(pm.ageMs) ? pm.ageMs : null,
    });
  }
  return rows.sort(compareRows);
}

/** The cells of a row, as display strings in COLUMNS order. Pure. */
export function rowCells(row) {
  return [
    `${stateGlyph(row.status)} ${stateWord(row.status)}`,
    row.code || '—',
    row.lane || '—',
    row.sess || '—',
    row.sub || '',
    fmtCtx(row.ctx),
    fmtUsd(row.usd),
    fmtAge(row.age),
  ];
}

/**
 * Which rows to render: all of them up to VIRTUAL_FROM, else a window around
 * the viewport with spacer heights above and below. Pure.
 */
export function visibleWindow(n, scrollTop = 0, viewportH = 0, rowH = ROW_H, overscan = OVERSCAN) {
  const count = Math.max(0, n | 0);
  if (count <= VIRTUAL_FROM) return { start: 0, end: count, padTop: 0, padBottom: 0 };
  const top = Math.max(0, Number(scrollTop) || 0);
  const h = Math.max(rowH, Number(viewportH) || 0);
  const start = Math.max(0, Math.min(count, Math.floor(top / rowH) - overscan));
  const end = Math.min(count, Math.ceil((top + h) / rowH) + overscan);
  return { start, end, padTop: start * rowH, padBottom: (count - end) * rowH };
}

// ---------------------------------------------------------------- DOM

function splitEl(doc, tag, cls, txt) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

/**
 * The table inside `host`. `opts.onSelect(sel)` on a row click or Enter,
 * `opts.onHover(nodeId|null)` on row hover. Returns
 * {el, update(model, {scope}), setSelected(sel), setHot(nodeId), rows(), destroy()}.
 */
export function createSplitTable(host, opts = {}) {
  const doc = host.ownerDocument ?? globalThis.document;
  const pane = splitEl(doc, 'div', 'map-split-pane');
  pane.setAttribute('aria-label', 'Lanes, worst first');
  const s = pane.style;
  s.minWidth = '0';
  s.minHeight = '0';
  s.overflow = 'hidden';
  s.display = 'flex';
  s.flexDirection = 'column';
  s.borderLeft = 'var(--bw) solid var(--line)';
  s.background = 'var(--bg-surface)';
  const wrap = splitEl(doc, 'div', 'dt-wrap');
  wrap.style.flex = '1';
  wrap.style.minHeight = '0';
  const table = splitEl(doc, 'table', 'dt map-split-table');
  table.setAttribute('role', 'grid');
  const thead = splitEl(doc, 'thead');
  const hr = splitEl(doc, 'tr');
  for (const [key, label, numeric] of COLUMNS) {
    const th = splitEl(doc, 'th', numeric ? 'num' : null, label);
    th.scope = 'col';
    th.dataset.col = key;
    th.style.padding = '0 var(--sp-2)';
    hr.append(th);
  }
  thead.append(hr);
  const tbody = splitEl(doc, 'tbody');
  table.append(thead, tbody);
  wrap.append(table);
  const empty = splitEl(doc, 'p', 'map-split-empty', 'No lanes in scope.');
  empty.style.margin = 'var(--sp-4)';
  empty.style.color = 'var(--text-3)';
  empty.style.font = 'var(--fs-12) var(--font-mono)';
  empty.hidden = true;
  pane.append(wrap, empty);
  host.append(pane);

  let rows = [];
  let selected = null;
  let hot = null;
  let lastHover = null;

  const hover = (id) => {
    if (id === lastHover) return;
    lastHover = id;
    opts.onHover?.(id);
  };

  function rowEl(row) {
    const tr = splitEl(doc, 'tr', 'map-split-row');
    tr.dataset.node = row.id;
    tr.dataset.p = row.status;
    tr.tabIndex = -1;
    tr.style.height = `${ROW_H}px`;
    tr.style.cursor = 'pointer';
    tr.setAttribute('aria-selected', row.sel === selected || row.id === selected ? 'true' : 'false');
    if (row.id === hot) markHot(tr, true);
    const cells = rowCells(row);
    COLUMNS.forEach(([key, , numeric], i) => {
      const td = splitEl(doc, 'td', numeric ? 'num' : null, cells[i]);
      if (key === 'state') {
        const tone = row.status === 'crit' || row.status === 'down' ? 'var(--p1)'
          : row.status === 'warn' || row.status === 'attention' ? 'var(--p2)'
            : row.status === 'low' ? 'var(--p3)' : 'var(--text-3)';
        td.style.color = tone;
      }
      if (key === 'sub') td.title = row.sub;
      tr.append(td);
    });
    tr.addEventListener('click', () => opts.onSelect?.(row.sel));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onSelect?.(row.sel); });
    tr.addEventListener('mouseenter', () => hover(row.id));
    return tr;
  }

  function markHot(tr, on) {
    tr.classList.toggle('is-hot', on);
    tr.style.background = on ? 'var(--bg-hover)' : '';
  }

  function spacer(px) {
    const tr = splitEl(doc, 'tr', 'map-split-pad');
    tr.setAttribute('aria-hidden', 'true');
    tr.style.height = `${px}px`;
    return tr;
  }

  function render() {
    const win = visibleWindow(rows.length, wrap.scrollTop, wrap.clientHeight);
    const out = [];
    if (win.padTop) out.push(spacer(win.padTop));
    for (let i = win.start; i < win.end; i++) out.push(rowEl(rows[i]));
    if (win.padBottom) out.push(spacer(win.padBottom));
    tbody.replaceChildren(...out);
    empty.hidden = rows.length > 0;
  }

  const onScroll = () => { if (rows.length > VIRTUAL_FROM) render(); };
  wrap.addEventListener('scroll', onScroll, { passive: true });
  tbody.addEventListener('mouseleave', () => hover(null));

  function update(model, { scope = 'all' } = {}) {
    rows = splitRows(model, { scope });
    render();
  }
  function setSelected(sel) {
    selected = sel ?? null;
    for (const tr of tbody.children) {
      if (!tr.dataset?.node) continue;
      const row = rows.find((r) => r.id === tr.dataset.node);
      tr.setAttribute('aria-selected', row && (row.sel === selected || row.id === selected) ? 'true' : 'false');
    }
  }
  function setHot(id) {
    hot = id ?? null;
    for (const tr of tbody.children) if (tr.dataset?.node) markHot(tr, tr.dataset.node === hot);
  }
  function destroy() {
    wrap.removeEventListener('scroll', onScroll);
    pane.remove();
  }
  return { el: pane, update, setSelected, setHot, rows: () => rows.slice(), destroy };
}
