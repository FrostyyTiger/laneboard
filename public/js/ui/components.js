// The component kit (plan §4 2.5): status lamp, stamped plate, corner brackets,
// inset-title panel, segment bar, data table, scope chip. Styles live in
// public/css/components.css; the gallery is public/dev/kit.html.
//
// Pure at import time: no `document` until a builder runs. The model functions
// (normP, lampLabel, laneMix, mixLabel, panelTitle, sortRows, flashDelay, ...)
// are tested in test/components.test.mjs. Every text that may come from a
// builder goes in through textContent or setAttribute, never as markup.
import { icon } from '../core/icons.js';
import { STATE_MARK, itemP } from '../core/marks.js';
import { TILE_FIXED_P, tileOf } from '../core/alarm-tiles.js';

// ---------------------------------------------------------------- priorities

/** The `data-p` values of a lamp, worst first. */
export const LAMP_P = Object.freeze(['1', '2', '3', 'ok', 'run', 'off', 'stale']);

/** Words for the accessible name of each lamp priority. */
export const P_WORDS = Object.freeze({
  1: 'critical', 2: 'warning', 3: 'low', ok: 'ok', run: 'working', off: 'off', stale: 'stale',
});

/** The shape a priority is drawn with (guardrail 5: colour always has a shape). */
export const P_SHAPE = Object.freeze({
  1: '■', 2: '▲', 3: '◆', ok: '●', run: '●', off: '○', stale: '○',
});

/**
 * Anything priority-like -> a lamp `data-p`: 1/2/3 (number or string), 'p1',
 * alarm priorities 'P1'..'P4' (P4 -> 3), 'ok' 'run' 'off' 'stale', 'crit'
 * 'warn' 'info', or a session state. Unknown -> 'off' (never a colour).
 */
export function normP(p) {
  if (p === 1 || p === 2 || p === 3) return String(p);
  const s = String(p ?? '').trim();
  const low = s.toLowerCase();
  if (/^p?[123]$/.test(low)) return low.slice(-1);
  if (low === 'p4') return '3';
  if (LAMP_P.includes(low)) return low;
  if (low === 'crit') return '1';
  if (low === 'warn') return '2';
  if (low === 'info') return '3';
  if (low === 'dead' || low === 'down') return 'off';
  return Object.hasOwn(STATE_MARK, low) ? STATE_MARK[low] : 'off';
}

/** The lamp's aria-label: the given label (or the priority word), plus ", unacknowledged". */
export function lampLabel(p, { unack = false, label = null } = {}) {
  const base = label == null || label === '' ? P_WORDS[normP(p)] : String(label);
  return unack ? `${base}, unacknowledged` : base;
}

/** The animation delay that puts a flashing node in phase with the 1 Hz clock. */
export function flashDelay(now) {
  const t = Number.isFinite(now) ? now : 0;
  return `${-Math.round(t % 1000)}ms`;
}

/** Give a flashing node the shared phase, so every unacked element blinks together. */
export function syncFlash(node, now) {
  const t = now ?? (globalThis.performance ? globalThis.performance.now() : Date.now());
  node.style.animationDelay = flashDelay(t);
  return node;
}

// ---------------------------------------------------------------- lamp, plate, brackets

/** <span class="lamp" data-p=.. [data-unack] role="img" aria-label=..>. */
export function lamp(p, { unack = false, label = null } = {}) {
  const n = document.createElement('span');
  n.className = 'lamp';
  n.dataset.p = normP(p);
  n.setAttribute('role', 'img');
  const name = lampLabel(p, { unack, label });
  n.setAttribute('aria-label', name);
  n.title = name;
  if (unack) {
    n.dataset.unack = '';
    syncFlash(n);
  }
  return n;
}

const PLATE_KINDS = new Set(['solid', 'quiet', 'p1', 'p2']);

/** <span class="plate [plate--solid|plate--quiet|plate--p1|plate--p2]">B1</span>. */
export function plate(text, { kind = null, title = null } = {}) {
  const n = document.createElement('span');
  n.className = PLATE_KINDS.has(kind) ? `plate plate--${kind}` : 'plate';
  n.textContent = String(text ?? '');
  if (title != null && title !== '') n.title = String(title);
  return n;
}

/** Corner brackets (selection): toggles `.sel`, whose ::after draws the four L-corners. */
export function markSel(node, on = true) {
  node.classList.toggle('sel', Boolean(on));
  return node;
}

// ---------------------------------------------------------------- panel

/** `[42]`, or '' when there is no count. */
export function countTag(n) {
  return Number.isFinite(n) ? `[${n}]` : '';
}

/** The title as it reads on screen: "LANES · ALL [42]". */
export function panelTitle({ name = '', scope = null, n = null } = {}) {
  return [String(name).toUpperCase(), scope ? `· ${String(scope).toUpperCase()}` : '', countTag(n)]
    .filter(Boolean).join(' ');
}

let panelSeq = 0;

/**
 * <section class="panel" aria-labelledby=id><h2 class="panel-t" id=id>
 *   <span class="panel-name">LANES</span><span class="panel-scope">· ALL</span>
 *   <span class="panel-n">[42]</span><span class="panel-tools"></span></h2>
 *   <div class="panel-b"></div></section>
 * Returns {root, title, tools, body}.
 */
export function panel({ name = '', scope = null, n = null, id = null, tools = [] } = {}) {
  const root = document.createElement('section');
  root.className = 'panel';
  const tid = id ?? `panel-${++panelSeq}`;
  const title = document.createElement('h2');
  title.className = 'panel-t';
  title.id = tid;
  root.setAttribute('aria-labelledby', tid);
  const nameEl = document.createElement('span');
  nameEl.className = 'panel-name';
  nameEl.textContent = String(name).toUpperCase();
  title.appendChild(nameEl);
  const scopeEl = document.createElement('span');
  scopeEl.className = 'panel-scope';
  title.appendChild(scopeEl);
  const nEl = document.createElement('span');
  nEl.className = 'panel-n';
  title.appendChild(nEl);
  const toolsEl = document.createElement('span');
  toolsEl.className = 'panel-tools';
  for (const t of tools) toolsEl.appendChild(t);
  title.appendChild(toolsEl);
  const body = document.createElement('div');
  body.className = 'panel-b';
  root.append(title, body);
  setPanel(root, { scope, n });
  return { root, title, tools: toolsEl, body };
}

/** Update a panel's scope and count in place. */
export function setPanel(root, { scope, n } = {}) {
  const scopeEl = root.querySelector('.panel-scope');
  const nEl = root.querySelector('.panel-n');
  if (scope !== undefined && scopeEl) {
    scopeEl.textContent = scope ? `· ${String(scope).toUpperCase()}` : '';
    scopeEl.hidden = !scope;
  }
  if (n !== undefined && nEl) {
    nEl.textContent = countTag(n);
    nEl.hidden = !Number.isFinite(n);
  }
  return root;
}

// ---------------------------------------------------------------- segment bar

/** Segment order, worst first; `dead` is hatched. */
export const MIX_ORDER = Object.freeze(['p1', 'p2', 'run', 'ok', 'off', 'dead']);
const MIX_WORD = Object.freeze({ p1: 'permission', p2: 'question', run: 'working', ok: 'done', off: 'idle', dead: 'dead' });
// The p1 (permission) and p2 (question) buckets both want you: one amber ▲
// (runs night 4 T23, core/marks.js). The bucket names stay for the counts.
const MIX_P = Object.freeze({ p1: '2', p2: '2', run: 'run', ok: 'ok', off: 'off', dead: 'dead' });

/** One session or lane -> its mix bucket. */
export function mixBucket(item) {
  if (!item || typeof item !== 'object') return 'off';
  if (item.awaitingApproval) return 'p1';
  const st = String(item.state ?? '').toLowerCase();
  if (st === 'dead' || item.stale === true) return 'dead';
  if (st === 'waiting_permission' || st === 'permission') return 'p1';
  if (st === 'waiting_question' || st === 'question') return 'p2';
  if (st === 'working') return 'run';
  if (st === 'done') return 'ok';
  return 'off';
}

/**
 * lanes (sessions with a `state`) -> {p1, p2, run, ok, off, dead, total, p}.
 * `p` is the worst trouble mark of the live lanes by itemP ('1' ■, '2' ▲, else
 * null), so a stuck working lane marks its builder ▲ as the status line counts
 * it, not the ● of its bucket.
 */
export function laneMix(lanes) {
  const mix = { p1: 0, p2: 0, run: 0, ok: 0, off: 0, dead: 0, total: 0, p: null };
  for (const l of Array.isArray(lanes) ? lanes : []) {
    const k = mixBucket(l);
    mix[k]++;
    mix.total++;
    if (k === 'dead') continue;
    const q = itemP(l);
    if (q === '1' || (q === '2' && mix.p !== '1')) mix.p = q;
  }
  return mix;
}

/** The sessions of a store (F8a) in one builder scope, ready for laneMix. */
export function scopeSessions(s, scope = 'all') {
  const out = [];
  if (!s || !s.builders) return out;
  for (const b of s.builders.values()) {
    if (scope !== 'all' && scope != null && b.id !== scope) continue;
    const down = b.status === 'stale' || b.status === 'down';
    for (const sess of b.sessions.values()) out.push(down ? { ...sess, stale: true } : sess);
  }
  return out;
}

const MARK_RANK = Object.freeze({ 1: 0, 2: 1, 3: 2, stale: 3, run: 4, ok: 5, off: 6 });
const ALARM_P = new Set(['1', '2', '3']);

/**
 * One builder's mark, the single rule the 1440 rail row and the 390 scope
 * chip share (runs T43): {p, unack, label, n}. `list` is the store's alarms
 * ({builder, priority 'P1'..'P4', acked}), `mix` its laneMix. Down -> p1,
 * stale -> 'stale', else the worst of its alarms (at their header tile's mark,
 * and its health sample's) and its lanes (a permission or a question lane is
 * p2, T23): unack when an open alarm sits at that priority. Else working (a lane running) or ok. Pure.
 */
export function builderMark(b, list = [], mix = null) {
  if (!b || typeof b !== 'object') return { p: 'off', unack: false, label: 'unknown', n: 0 };
  if (b.status === 'down') return { p: '1', unack: false, label: 'down', n: 0 };
  if (b.status === 'stale') return { p: 'stale', unack: false, label: 'stale', n: 0 };
  let p = null;
  let unack = false;
  let n = 0;
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== 'object' || a.builder !== b.id) continue;
    // A kind with no header tile (review: the Inbox; reboot, health-warn: the
    // Box) is not counted by the header or the status line, so it does not
    // mark the builder either: the rail never shows a ▲ the header calls 0.
    if (typeof a.kind === 'string' && a.kind && !tileOf(a.kind)) continue;
    // The alarm's tile mark wins over its priority, so the rail agrees with
    // the header: an approval is the amber ▲ even when sent as P1 (T23).
    const fixed = TILE_FIXED_P[tileOf(a.kind)];
    const q = fixed != null ? String(fixed) : normP(a.priority);
    if (!ALARM_P.has(q)) continue;
    n++;
    const open = a.acked !== true;
    if (p === null || MARK_RANK[q] < MARK_RANK[p]) { p = q; unack = open; } else if (q === p && open) unack = true;
  }
  // The health sample's own alarms (§7), in case the alarm feed lags or is
  // absent: crit is the DOWN tile's health-crit (■); warn is health-warn, which
  // only the Box shows, so it marks nothing here.
  for (const h of Array.isArray(b.health?.alarms) ? b.health.alarms : []) {
    const q = h?.level === 'crit' ? '1' : null;
    if (q && (p === null || MARK_RANK[q] < MARK_RANK[p])) { p = q; unack = false; }
  }
  // The worst lane, by the rule the status line counts with (core/marks.js
  // itemP: stuck is ▲, the guard's danger ■), else the segment bar's buckets.
  const lane = mix?.p ?? (mix?.p1 > 0 || mix?.p2 > 0 ? '2' : null);
  if (lane && (p === null || MARK_RANK[lane] < MARK_RANK[p])) { p = lane; unack = false; }
  if (p) {
    const parts = [];
    if (n) parts.push(`${n} ${n === 1 ? 'alarm' : 'alarms'}`);
    if (mix?.p1 > 0) parts.push(`${mix.p1} permission`);
    if (mix?.p2 > 0) parts.push(`${mix.p2} question`);
    return { p, unack, label: [lampLabel(p), ...parts].join(', '), n };
  }
  if (b.status === 'connecting') return { p: 'off', unack: false, label: 'connecting', n: 0 };
  if (mix?.run > 0) return { p: 'run', unack: false, label: 'working', n: 0 };
  return { p: 'ok', unack: false, label: 'ok', n: 0 };
}

/** "12 lanes: 1 permission, 2 question, 6 working, 3 idle" (zero buckets omitted). */
export function mixLabel(mix) {
  const total = mix?.total ?? 0;
  const head = `${total} ${total === 1 ? 'lane' : 'lanes'}`;
  const parts = MIX_ORDER.filter((k) => mix?.[k] > 0).map((k) => `${mix[k]} ${MIX_WORD[k]}`);
  return parts.length ? `${head}: ${parts.join(', ')}` : head;
}

/** <span class="segbar" role="img" aria-label=..><i data-p=.. style="flex-grow:n"></i>...</span>. */
export function segbar(mixOrLanes, { label = null } = {}) {
  const mix = Array.isArray(mixOrLanes) ? laneMix(mixOrLanes) : (mixOrLanes ?? laneMix([]));
  const n = document.createElement('span');
  n.className = mix.total ? 'segbar' : 'segbar segbar--empty';
  n.setAttribute('role', 'img');
  const name = label == null || label === '' ? mixLabel(mix) : String(label);
  n.setAttribute('aria-label', name);
  n.title = name;
  for (const k of MIX_ORDER) {
    if (!(mix[k] > 0)) continue;
    const seg = document.createElement('i');
    seg.dataset.p = MIX_P[k];
    seg.style.flexGrow = String(mix[k]);
    n.appendChild(seg);
  }
  return n;
}

// ---------------------------------------------------------------- data table

function sortKey(row, key) {
  const v = typeof key === 'function' ? key(row) : row?.[key];
  if (v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return null;
  return v;
}

function compareValues(a, b) {
  const na = typeof a === 'number' || typeof a === 'bigint';
  const nb = typeof b === 'number' || typeof b === 'bigint';
  if (na && nb) return a < b ? -1 : a > b ? 1 : 0;
  if (na !== nb) return na ? -1 : 1; // numbers before text
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Stable sort by `key` (a field name or a row -> value function), `dir` 'asc'
 * or 'desc'. Nulls (undefined, null, '', NaN) always go last, in either
 * direction. Returns a new array.
 */
export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return (Array.isArray(rows) ? rows : [])
    .map((row, i) => ({ row, i, k: sortKey(row, key) }))
    .sort((x, y) => {
      if (x.k === null || y.k === null) {
        if (x.k === null && y.k === null) return x.i - y.i;
        return x.k === null ? 1 : -1;
      }
      return compareValues(x.k, y.k) * sign || x.i - y.i;
    })
    .map((e) => e.row);
}

/** The next sort state after clicking column `key`: same column flips, a new one starts asc. */
export function nextSort(cur, key) {
  if (cur && cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Roving-cursor move for j, k, the arrows, Home and End over n rows; null when the key is not a move. */
export function rowMove(key, idx, n) {
  if (n <= 0) return null;
  const i = Number.isInteger(idx) ? idx : -1;
  switch (key) {
    case 'j': case 'ArrowDown': return Math.min(n - 1, i + 1);
    case 'k': case 'ArrowUp': return Math.max(0, i - 1);
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return null;
  }
}

/**
 * <div class="dt-wrap" tabindex="0"><table class="dt" aria-rowcount>...</table></div>
 * columns: [{key, label, num?, title?, cell?(row) -> Node|string}]. Options:
 * sort {key, dir}, rowKey(row), stale(row), onOpen(row), onSort(sort),
 * select (adds a checkbox column toggled with Space). Returns
 * {root, table, update(rows), selected(): Set}.
 */
export function dataTable(opts = {}) {
  const columns = Array.isArray(opts.columns) ? opts.columns : [];
  const rowKey = typeof opts.rowKey === 'function' ? opts.rowKey : (r, i) => String(i);
  const stale = typeof opts.stale === 'function' ? opts.stale : () => false;
  const onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : null;
  const onSort = typeof opts.onSort === 'function' ? opts.onSort : null;
  const select = Boolean(opts.select);
  const label = opts.label ?? null;
  const sort = opts.sort ?? null;
  const rows = opts.rows ?? [];
  const root = document.createElement('div');
  root.className = 'dt-wrap';
  root.tabIndex = 0;
  const table = document.createElement('table');
  table.className = 'dt';
  if (label) table.setAttribute('aria-label', String(label));
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  root.appendChild(table);
  const chosen = new Set();
  let state = sort;
  let data = rows;
  let cursor = -1;

  function head() {
    const tr = document.createElement('tr');
    if (select) {
      const th = document.createElement('th');
      th.className = 'dt-sel';
      th.scope = 'col';
      th.setAttribute('aria-label', 'Select');
      tr.appendChild(th);
    }
    for (const c of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      if (c.num) th.className = 'num';
      const on = state && state.key === c.key;
      th.setAttribute('aria-sort', on ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(c.label ?? c.key);
      if (c.title) b.title = String(c.title);
      b.addEventListener('click', () => {
        state = nextSort(state, c.key);
        if (onSort) onSort(state);
        paint();
      });
      th.appendChild(b);
      tr.appendChild(th);
    }
    thead.replaceChildren(tr);
  }

  function cellOf(c, row) {
    const td = document.createElement('td');
    if (c.num) td.className = 'num';
    const v = c.cell ? c.cell(row) : row?.[c.key];
    if (v && typeof v === 'object' && typeof v.nodeType === 'number') td.appendChild(v);
    else {
      const text = v === undefined || v === null || v === '' ? '—' : String(v);
      td.textContent = text;
      if (!c.num) td.title = text;
    }
    return td;
  }

  function focusRow(i) {
    const trs = tbody.rows;
    if (!trs.length) return;
    cursor = Math.max(0, Math.min(trs.length - 1, i));
    for (let k = 0; k < trs.length; k++) trs[k].tabIndex = k === cursor ? 0 : -1;
    trs[cursor].focus();
  }

  function paint() {
    head();
    const list = state ? sortRows(data, state.key, state.dir) : (Array.isArray(data) ? data : []);
    table.setAttribute('aria-rowcount', String(list.length + 1));
    const trs = list.map((row, i) => {
      const tr = document.createElement('tr');
      const k = rowKey(row, i);
      tr.dataset.key = k;
      tr.tabIndex = i === Math.max(0, cursor) ? 0 : -1;
      tr.setAttribute('aria-rowindex', String(i + 2));
      if (stale(row)) tr.classList.add('is-stale');
      if (select) {
        const td = document.createElement('td');
        td.className = 'dt-sel';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.tabIndex = -1;
        box.checked = chosen.has(k);
        box.setAttribute('aria-label', `Select row ${i + 1}`);
        box.addEventListener('change', () => { if (box.checked) chosen.add(k); else chosen.delete(k); });
        td.appendChild(box);
        tr.appendChild(td);
        tr.setAttribute('aria-selected', chosen.has(k) ? 'true' : 'false');
      }
      for (const c of columns) tr.appendChild(cellOf(c, row));
      tr.addEventListener('keydown', (e) => {
        const to = rowMove(e.key, i, list.length);
        if (to !== null) { e.preventDefault(); focusRow(to); return; }
        if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(row); return; }
        if (e.key === ' ' && select) {
          e.preventDefault();
          if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
          tr.setAttribute('aria-selected', chosen.has(k) ? 'true' : 'false');
          const box = tr.querySelector('input[type="checkbox"]');
          if (box) box.checked = chosen.has(k);
        }
      });
      tr.addEventListener('focus', () => { cursor = i; });
      if (onOpen) tr.addEventListener('dblclick', () => onOpen(row));
      return tr;
    });
    tbody.replaceChildren(...trs);
  }

  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    const to = rowMove(e.key, cursor, tbody.rows.length);
    if (to !== null) { e.preventDefault(); focusRow(to); }
  });
  paint();
  return {
    root,
    table,
    update: (next) => { data = next; paint(); },
    selected: () => new Set(chosen),
  };
}

// ---------------------------------------------------------------- scope chip

/**
 * <button class="chip" data-param="b|s|q">[lamp] text [x]</button>. `onRemove`
 * runs on click (the caller navigates). `p` adds a lamp in front.
 */
export function scopeChip(text, { param = 'q', p = null, onRemove = null, title = null } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.param = String(param);
  if (p != null) b.appendChild(lamp(p));
  const t = document.createElement('span');
  t.className = 'chip-t';
  t.textContent = String(text ?? '');
  b.appendChild(t);
  b.appendChild(icon('close', { size: 's' }));
  const name = title ? String(title) : `Remove filter ${String(text ?? '')}`;
  b.setAttribute('aria-label', name);
  b.title = name;
  if (onRemove) b.addEventListener('click', () => onRemove(param));
  return b;
}
