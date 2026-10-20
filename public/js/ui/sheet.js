// The terminal sheet (L4) and its quick-bar, moved from public/app.js (fleet
// F1), plus the phone shell (fleet D6b, plan §4 2.4 "Phone <700"): the builder
// chip strip in #shell-strip and the three-snap bottom sheet in #shell-sheet
// with the MAP/LIST/INBOX segmented control.
//
// Pure at import time: no `document` until init() or a builder runs. The
// models (snapFor, snapTops, stepSnap, stripModel, peekModel, sheetRows) are
// tested in test/sheet.test.mjs. Every builder-supplied text (names, codes,
// alarm text) goes in through textContent or setAttribute, never as markup.
import { $, el } from '../core/dom.js';
import { STATE_LABEL, STATE_RANK, ago } from '../core/format.js';
import { deriveCode } from '../core/keys.js';
import { store, subscribe } from '../core/store.js';
import { currentRoute, formatHash, navigate, onRoute } from '../core/router.js';
import { scheduleVisible, sendKeys, sendText } from '../core/net.js';
import { icon } from '../core/icons.js';
import { closeTerminal, isLive, openTerminal, writeTo } from './terminal.js';
import { lamp, normP } from './components.js';
import { layoutFor, toast } from './shell.js';

/**
 * The hash that names an open sheet: `#/board?sel=<fkey>`, the form a push
 * notification opens, keeping the route's filters (b, s, q). A selection
 * routes to the Board (core/router.js applyHash), so the hash says so too.
 */
export function sheetHash(k, route) {
  return formatHash({ ...(route ?? currentRoute()), view: 'board', sel: k, open: null });
}

/** Where L4 shows: 'sheet' (full screen, the phone and the default) or 'centre' (desktop takeover). */
export const L4_MODES = Object.freeze(['sheet', 'centre']);

/**
 * Open L4, the terminal of session `k` (a fleet key, the store.sessions index
 * key), in the existing #sheet with its quick-bar. `mode` 'centre' is the
 * desktop takeover of the centre column (D6 calls it so), 'sheet' the full
 * screen. Without a mode a re-open of the same session keeps its mode, and a
 * fresh one is a full-screen sheet, as before.
 */
export function openSheet(k, { mode } = {}) {
  const s = store.sessions.get(k);
  if (!s) return;
  const already = store.openSession === k && !$('sheet').hidden;
  const node = $('sheet');
  if (L4_MODES.includes(mode)) node.dataset.mode = mode;
  else if (!already || !L4_MODES.includes(node.dataset.mode)) node.dataset.mode = 'sheet';
  store.openSession = k;
  $('sheet-title').textContent = s.name;
  $('sheet-title').title = store.builders.size > 1 && s.builder ? s.builder : '';
  const pill = $('sheet-state');
  pill.className = `pill s-${s.state}`;
  pill.textContent = STATE_LABEL[s.state] || s.state;
  $('sheet').hidden = false;
  // Opening the sheet writes `sel`; the hashchange this causes routes back
  // here, and the terminal is not opened twice.
  const want = sheetHash(s.key);
  if (location.hash !== want) location.hash = want;
  if (!already) openTerminal(k, $('sheet-body'));
  scheduleVisible();
}

export function closeSheet() {
  if (!store.openSession) return;
  closeTerminal(store.openSession, $('sheet-body'));
  store.openSession = null;
  $('sheet').hidden = true;
  // Closing removes `sel`: back to the view's own hash, not to a bare path,
  // so a sheet opened from a push notification leaves you on the Board.
  const h = location.hash || '';
  if (h.startsWith('#session=')) history.replaceState(null, '', `#${store.view}`);
  else if (h.includes('sel=')) history.replaceState(null, '', formatHash({ ...currentRoute(), view: store.view, sel: null, open: null }));
  scheduleVisible();
}

// Claude's prompts are numbered menus, so "Yes" is 1 then Enter.
export const QUICK_KEYS = {
  yes: { raw: '1\r', keys: ['1', 'Enter'] },
  no: { raw: '\x1b', keys: ['Escape'] },
  esc: { raw: '\x1b', keys: ['Escape'] },
  enter: { raw: '\r', keys: ['Enter'] },
  'ctrl-c': { raw: '\x03', keys: ['C-c'] },
};

/** A session's display name for a toast: the local name behind a fleet key. */
function shownName(k) {
  return store.sessions.get(k)?.name ?? k;
}

/** Prefer the open pty — it is instant. Fall back to tmux send-keys. `k`: a fleet key. */
export function sendQuick(k, spec, label) {
  if (isLive(k) && writeTo(k, spec.raw)) toast(`${label} → ${shownName(k)}`);
  else sendKeys(k, spec.keys);
}

// ================================================================ phone shell

/** The sheet's snap points, lowest first. */
export const SNAPS = Object.freeze(['peek', 'half', 'full']);
/** Peek height (px above the bottom safe area): handle row plus the counts line. */
export const PEEK_PX = 96;
/** The full sheet leaves this much of the screen above it (px, below the top safe area). */
export const FULL_GAP_PX = 80;
/** A release faster than this (px/ms) snaps in the drag direction. */
export const FLICK_PX_MS = 0.5;
/** The segmented control's tabs. */
export const SHEET_TABS = Object.freeze(['map', 'list', 'inbox']);
/** The views behind the `⋯` menu (every routable nav view the tabs do not cover). */
export const MORE_VIEWS = Object.freeze(['board', 'packages', 'morning', 'credit', 'box', 'audit', 'runs']);
const TAB_LABEL = Object.freeze({ map: 'MAP', list: 'LIST', inbox: 'INBOX' });
const VIEW_LABEL = Object.freeze({ board: 'Board', packages: 'Packages', morning: 'Morning', credit: 'Credit', box: 'Box', audit: 'Audit', runs: 'Runs' });
const MAX_ROWS = 200;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * The sheet's top edge (px from the viewport top) at each snap point for a
 * viewport `h` px high, with `safeTop`/`safeBottom` insets. Always
 * full <= half <= peek. Pure.
 */
export function snapTops(h, { safeTop = 0, safeBottom = 0 } = {}) {
  const H = Math.max(0, num(h));
  const peek = Math.max(0, H - PEEK_PX - Math.max(0, num(safeBottom)));
  const full = Math.min(peek, FULL_GAP_PX + Math.max(0, num(safeTop)));
  const half = Math.min(peek, Math.max(full, Math.round(H / 2)));
  return { peek, half, full };
}

/**
 * Where a released sheet settles. `y`: its top edge (px from the viewport
 * top), `vy`: that edge's velocity at release (px/ms, positive = moving down,
 * the screen's axis), `h`: the viewport height. A flick (|vy| over
 * FLICK_PX_MS) goes to the next snap point in its direction; a slow release
 * goes to the nearest one. Returns 'peek' | 'half' | 'full'. Pure.
 */
export function snapFor(y, vy, h, insets = {}) {
  const tops = snapTops(h, insets);
  const top = num(y, tops.peek);
  const v = num(vy);
  // Lowest on screen (largest top) first: peek, half, full.
  if (Math.abs(v) > FLICK_PX_MS) {
    if (v > 0) {
      // Down: the first point below the edge, else peek.
      for (const name of ['full', 'half', 'peek']) if (tops[name] > top) return name;
      return 'peek';
    }
    for (const name of ['peek', 'half', 'full']) if (tops[name] < top) return name;
    return 'full';
  }
  let best = 'peek';
  for (const name of SNAPS) if (Math.abs(tops[name] - top) < Math.abs(tops[best] - top)) best = name;
  return best;
}

/** One keyboard step from snap `cur`: dir > 0 is up (taller), dir < 0 down. Clamped. Pure. */
export function stepSnap(cur, dir) {
  const i = Math.max(0, SNAPS.indexOf(cur));
  const d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  return SNAPS[Math.min(SNAPS.length - 1, Math.max(0, i + d))];
}

/** A tab name -> a known tab ('map' for anything else). Pure. */
export function normTab(t) {
  return SHEET_TABS.includes(t) ? t : 'map';
}

function codeOf(b, id) {
  return (typeof b?.code === 'string' && b.code) || deriveCode(id);
}

/** Worst lamp `data-p` of a builder: stale when its link is down, else its worst session. Pure. */
export function builderP(b) {
  if (!b) return 'off';
  if (b.status === 'stale' || b.status === 'down') return 'stale';
  let best = null;
  const order = ['1', '2', '3', 'run', 'ok', 'off'];
  for (const sess of b.sessions?.values?.() ?? []) {
    const p = normP(sess?.state);
    if (best === null || order.indexOf(p) < order.indexOf(best)) best = p;
  }
  return best ?? 'off';
}

function worstP(ps) {
  const order = ['1', '2', '3', 'run', 'ok', 'off', 'stale'];
  let best = null;
  for (const p of ps) if (best === null || order.indexOf(p) < order.indexOf(best)) best = p;
  return best ?? 'off';
}

/**
 * The #shell-strip chips for store `s` and `route`: ALL first, then one per
 * builder by id, each {id, code, p, on, title}. `on` follows route.b. Pure.
 */
export function stripModel(s, route) {
  const list = [...(s?.builders?.values?.() ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scope = route?.b && route.b !== 'all' ? route.b : null;
  const chips = list.map((b) => {
    const p = builderP(b);
    const status = typeof b.status === 'string' ? b.status : 'down';
    return { id: b.id, code: codeOf(b, b.id), p, on: scope === b.id, title: `${b.id} · ${status}` };
  });
  const all = { id: 'all', code: 'ALL', p: worstP(chips.map((c) => (c.p === 'stale' ? 'off' : c.p))), on: !scope, title: 'Every builder' };
  return [all, ...chips];
}

function inScope(item, scope) {
  return !scope || item?.builder === scope;
}

function scopedSessions(s, scope) {
  const out = [];
  for (const b of s?.builders?.values?.() ?? []) {
    if (scope && b.id !== scope) continue;
    for (const sess of b.sessions?.values?.() ?? []) out.push(sess);
  }
  return out;
}

function laneName(s, item, name) {
  const multi = (s?.builders?.size ?? 0) > 1;
  const b = s?.builders?.get?.(item?.builder);
  return multi && item?.builder ? `${codeOf(b, item.builder)}/${name}` : String(name ?? '');
}

/**
 * The peek line for store `s` in builder scope `scope` (null = all):
 * {p1, p2, run, total, latest}. `latest` is the top needs-you entry, else the
 * most recently changed session: {key, text, p, since}. Pure.
 */
export function peekModel(s, scope = null) {
  const b = scope && scope !== 'all' ? scope : null;
  const sess = scopedSessions(s, b);
  const out = { p1: 0, p2: 0, run: 0, total: sess.length, latest: null };
  for (const x of sess) {
    const p = normP(x?.state);
    if (p === '1') out.p1++;
    else if (p === '2') out.p2++;
    else if (p === 'run') out.run++;
  }
  const att = (s?.attention ?? []).filter((a) => inScope(a, b));
  if (att.length) {
    const a = att[0];
    out.latest = { key: a.key, text: `${laneName(s, a, a.name)} ${STATE_LABEL[a.state] || a.state || ''}`.trim(), p: a.danger ? '1' : normP(a.state), since: a.since ?? null };
  } else if (sess.length) {
    const x = sess.reduce((m, c) => (num(c.stateSince) > num(m.stateSince) ? c : m));
    out.latest = { key: x.key, text: `${laneName(s, x, x.name)} ${STATE_LABEL[x.state] || x.state || ''}`.trim(), p: normP(x.state), since: x.stateSince ?? null };
  }
  return out;
}

/**
 * The rows of sheet tab `tab` for store `s` in scope `scope`, each
 * {key, sel, p, unack, name, sub, since}: MAP the needs-you list, LIST every
 * session (worst state first, then name), INBOX the alarms. `sel` is the
 * fleet key a tap selects (null: nothing to select). At most MAX_ROWS. Pure.
 */
export function sheetRows(s, tab, scope = null) {
  const b = scope && scope !== 'all' ? scope : null;
  const t = normTab(tab);
  let rows;
  if (t === 'map') {
    rows = (s?.attention ?? []).filter((a) => inScope(a, b)).map((a) => ({
      key: a.key, sel: a.key ?? null, p: a.danger ? '1' : normP(a.state), unack: false,
      name: laneName(s, a, a.name), sub: STATE_LABEL[a.state] || String(a.state ?? ''), since: a.since ?? null,
    }));
  } else if (t === 'list') {
    rows = scopedSessions(s, b)
      .sort((x, y) => (STATE_RANK[x.state] ?? 9) - (STATE_RANK[y.state] ?? 9) || String(x.name).localeCompare(String(y.name)))
      .map((x) => ({
        key: x.key, sel: x.key ?? null, p: normP(x.state), unack: false,
        name: laneName(s, x, x.name), sub: STATE_LABEL[x.state] || String(x.state ?? ''), since: x.stateSince ?? null,
      }));
  } else {
    rows = (s?.alarms ?? []).filter((a) => inScope(a, b)).map((a, i) => {
      const target = typeof a.target === 'string' && a.target && a.target !== '*' ? a.target : null;
      const sel = target && a.builder ? `${a.builder}/${target}` : null;
      return {
        key: `alarm:${a.id ?? i}`, sel, p: normP(a.priority), unack: a.acked === false,
        name: laneName(s, a, target ?? String(a.kind ?? 'alarm')), sub: String(a.text ?? a.kind ?? ''), since: a.since ?? null,
      };
    });
  }
  return rows.slice(0, MAX_ROWS);
}

// ---------------------------------------------------------------- phone DOM

const phone = { built: false, snap: 'peek', tab: 'map', parts: null, drag: null, queued: false };

function loadTab() {
  try { return normTab(localStorage.getItem('lb.sheet.tab')); } catch { return 'map'; }
}

function saveTab(t) {
  try { localStorage.setItem('lb.sheet.tab', t); } catch { /* private mode */ }
}

const isPhone = () => layoutFor(globalThis.innerWidth ?? 1200) === 'phone';

/** Move the sheet to snap `name` (aria on the handle follows). */
export function setSnap(name) {
  const snap = SNAPS.includes(name) ? name : 'peek';
  phone.snap = snap;
  const p = phone.parts;
  if (!p) return snap;
  p.root.dataset.snap = snap;
  p.root.style.transform = '';
  p.handle.setAttribute('aria-valuenow', String(SNAPS.indexOf(snap)));
  p.handle.setAttribute('aria-valuetext', snap);
  return snap;
}

/** The current snap point. */
export function currentSnap() {
  return phone.snap;
}

/** Build the strip chips into `box` from `model` (stripModel). */
export function renderStrip(box, model, onPick) {
  box.textContent = '';
  box.setAttribute('role', 'toolbar');
  for (const c of model) {
    const b = el('button', 'chip strip-chip');
    b.type = 'button';
    b.dataset.b = c.id;
    b.setAttribute('aria-pressed', c.on ? 'true' : 'false');
    b.append(lamp(c.p, { label: c.p === 'stale' ? 'stale' : null }), el('span', 'chip-t', c.code));
    b.title = c.title;
    b.setAttribute('aria-label', c.id === 'all' ? 'All builders' : `Builder ${c.title}`);
    if (onPick) b.addEventListener('click', () => onPick(c.id));
    box.append(b);
  }
  return box;
}

/** One 44px sheet row (a button when it selects something). */
export function sheetRow(r, onPick) {
  const n = el(r.sel ? 'button' : 'div', 'ps-row');
  if (r.sel) {
    n.type = 'button';
    n.dataset.sel = r.sel;
    if (onPick) n.addEventListener('click', () => onPick(r.sel));
  }
  n.append(lamp(r.p, { unack: r.unack }), el('span', 'ps-name', r.name), el('span', 'ps-sub', r.sub), el('span', 'ps-ago', r.since ? ago(r.since) : ''));
  n.title = `${r.name} ${r.sub}`.trim();
  return n;
}

function buildSheet(root) {
  root.textContent = '';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Fleet sheet');
  const head = el('div', 'ps-head');
  const handle = el('div', 'ps-handle');
  handle.setAttribute('role', 'slider');
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', 'Sheet height');
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', String(SNAPS.length - 1));
  handle.append(el('span', 'ps-grip'));
  const seg = el('div', 'ps-seg');
  seg.setAttribute('role', 'tablist');
  seg.setAttribute('aria-label', 'Sheet content');
  const tabs = {};
  for (const t of SHEET_TABS) {
    const b = el('button', 'ps-tab', TAB_LABEL[t]);
    b.type = 'button';
    b.id = `ps-tab-${t}`;
    b.dataset.tab = t;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'ps-body');
    b.addEventListener('click', () => pickTab(t));
    tabs[t] = b;
    seg.append(b);
  }
  const more = el('button', 'ps-more');
  more.type = 'button';
  more.setAttribute('aria-label', 'More views');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.title = 'More views';
  more.append(icon('more'));
  const menu = el('div', 'ps-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const v of MORE_VIEWS) {
    const b = el('button', 'ps-menu-i', VIEW_LABEL[v]);
    b.type = 'button';
    b.dataset.view = v;
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { toggleMoreMenu(false); navigate({ view: v }); });
    menu.append(b);
  }
  more.addEventListener('click', () => toggleMoreMenu(menu.hidden));
  const peek = el('button', 'ps-peek');
  peek.type = 'button';
  const body = el('div', 'ps-body');
  body.id = 'ps-body';
  body.setAttribute('role', 'tabpanel');
  head.append(handle, seg, more, menu);
  root.append(head, peek, body);
  phone.parts = { root, handle, seg, tabs, more, menu, peek, body };
  wireDrag(handle);
  handle.addEventListener('keydown', (e) => {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    let next = null;
    if (dir) next = stepSnap(phone.snap, dir);
    else if (e.key === 'Home') next = 'peek';
    else if (e.key === 'End') next = 'full';
    else if (e.key === 'Enter' || e.key === ' ') next = phone.snap === 'peek' ? 'half' : 'peek';
    if (!next) return;
    e.preventDefault?.();
    setSnap(next);
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleMoreMenu(false); more.focus?.(); } });
  peek.addEventListener('click', () => {
    const k = peek.dataset.sel;
    if (k) pickLane(k);
    else setSnap(phone.snap === 'peek' ? 'half' : 'peek');
  });
  phone.built = true;
  setSnap(phone.snap);
}

function toggleMoreMenu(open) {
  const p = phone.parts;
  if (!p) return;
  p.menu.hidden = !open;
  p.more.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function pickTab(t) {
  phone.tab = normTab(t);
  saveTab(phone.tab);
  if (phone.snap === 'peek') setSnap('half');
  renderPhone();
}

/** Selecting a lane moves the sheet to half; the route's `sel` shows L3. */
function pickLane(k) {
  setSnap('half');
  navigate({ sel: k });
}

function pickBuilder(id) {
  navigate({ b: id === 'all' ? null : id });
}

/** Pointer drag on the handle: follow the finger, then snap with snapFor. */
function wireDrag(handle) {
  handle.addEventListener('pointerdown', (e) => {
    const root = phone.parts?.root;
    if (!root || (e.button != null && e.button !== 0)) return;
    const h = globalThis.innerHeight ?? 0;
    const tops = snapTops(h);
    const now = e.timeStamp ?? Date.now();
    phone.drag = { id: e.pointerId, startY: e.clientY, startTop: tops[phone.snap], top: tops[phone.snap], lastY: e.clientY, lastT: now, vy: 0, tops };
    handle.setPointerCapture?.(e.pointerId);
    root.classList.add('is-drag');
  });
  handle.addEventListener('pointermove', (e) => {
    const d = phone.drag;
    if (!d || e.pointerId !== d.id) return;
    const t = e.timeStamp ?? Date.now();
    const dt = t - d.lastT;
    if (dt > 0) d.vy = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = t;
    d.top = Math.min(d.tops.peek, Math.max(d.tops.full, d.startTop + (e.clientY - d.startY)));
    phone.parts.root.style.transform = `translateY(${Math.round(d.top - d.tops.full)}px)`;
  });
  const end = (e) => {
    const d = phone.drag;
    if (!d || e.pointerId !== d.id) return;
    phone.drag = null;
    phone.parts.root.classList.remove('is-drag');
    // A tap (no travel) toggles peek/half.
    if (Math.abs(e.clientY - d.startY) < 4) setSnap(phone.snap === 'peek' ? 'half' : 'peek');
    else setSnap(snapFor(d.top, d.vy, globalThis.innerHeight ?? 0));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** Paint the strip and the sheet from the store and the route (phone layout only). */
export function renderPhone() {
  phone.queued = false;
  const strip = $('shell-strip');
  const root = $('shell-sheet');
  if (!root || !strip) return;
  if (!isPhone()) {
    root.hidden = true;
    return;
  }
  if (!phone.built) buildSheet(root);
  root.hidden = false;
  const route = currentRoute();
  const scope = route.b && route.b !== 'all' ? route.b : null;
  renderStrip(strip, stripModel(store, route), pickBuilder);
  const p = phone.parts;
  for (const t of SHEET_TABS) {
    const on = t === phone.tab;
    p.tabs[t].setAttribute('aria-selected', on ? 'true' : 'false');
    p.tabs[t].tabIndex = on ? 0 : -1;
  }
  p.body.setAttribute('aria-labelledby', `ps-tab-${phone.tab}`);
  const pk = peekModel(store, scope);
  p.peek.textContent = '';
  const counts = el('span', 'ps-counts');
  counts.append(lamp('1', { label: `${pk.p1} permission` }), el('span', 'ps-n', String(pk.p1)),
    lamp('2', { label: `${pk.p2} question` }), el('span', 'ps-n', String(pk.p2)),
    lamp('run', { label: `${pk.run} working` }), el('span', 'ps-n', `${pk.run}/${pk.total}`));
  p.peek.append(counts);
  if (pk.latest) {
    p.peek.dataset.sel = pk.latest.key ?? '';
    p.peek.append(lamp(pk.latest.p), el('span', 'ps-name', pk.latest.text), el('span', 'ps-ago', pk.latest.since ? ago(pk.latest.since) : ''));
    p.peek.setAttribute('aria-label', `${pk.p1} permission, ${pk.p2} question, ${pk.run} of ${pk.total} working. Latest: ${pk.latest.text}`);
  } else {
    p.peek.dataset.sel = '';
    p.peek.append(el('span', 'ps-name ps-empty', 'Nothing yet'));
    p.peek.setAttribute('aria-label', `${pk.total} lanes, nothing waiting`);
  }
  const rows = sheetRows(store, phone.tab, scope);
  p.body.textContent = '';
  if (phone.tab === 'map') p.body.append(el('p', 'ps-sum', `${pk.total} ${pk.total === 1 ? 'lane' : 'lanes'} · ${rows.length} need you`));
  for (const r of rows) p.body.append(sheetRow(r, pickLane));
  if (!rows.length) p.body.append(el('p', 'ps-empty', phone.tab === 'inbox' ? 'No alarms.' : 'Nothing waiting.'));
  if (phone.tab === 'inbox') {
    const all = el('button', 'btn ps-open', 'Open INBOX');
    all.type = 'button';
    all.addEventListener('click', () => navigate({ view: 'inbox' }));
    p.body.append(all);
  }
}

/** Coalesce repaints to one per frame (none when no frame clock: the next call paints). */
function schedulePhone() {
  if (!isPhone()) {
    const root = $('shell-sheet');
    if (root && !root.hidden) root.hidden = true;
    return;
  }
  if (phone.queued) return;
  if (typeof globalThis.requestAnimationFrame === 'function') {
    phone.queued = true;
    globalThis.requestAnimationFrame(() => renderPhone());
  } else {
    renderPhone();
  }
}

function initPhone() {
  phone.tab = loadTab();
  subscribe(() => schedulePhone());
  onRoute(() => schedulePhone());
  addEventListener('resize', () => schedulePhone(), { passive: true });
  schedulePhone();
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  initPhone();

  // ---------------------------------------------------------------- input

  $('sheet-close').onclick = closeSheet;

  $('quickbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn || !store.openSession) return;
    const spec = QUICK_KEYS[btn.dataset.key];
    if (spec) sendQuick(store.openSession, spec, btn.textContent);
  });

  $('qb-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('qb-input');
    const text = input.value.trim();
    if (!text || !store.openSession) return;
    const k = store.openSession;
    if (isLive(k) && writeTo(k, `${text}\r`)) toast(`Sent → ${shownName(k)}`);
    else sendText(k, text);
    input.value = '';
  });
}
