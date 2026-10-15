// Keyboard shortcuts (fleet plan §4 2.6, task D8; the handler F1 moved here
// from public/app.js is replaced).
//
// Two halves:
// - pure: KEYMAP (the authoritative §4 2.6 table as data) and
//   resolve(keyEvent, ctx) -> commandId | null. test/hotkeys.test.mjs drives
//   it with plain objects.
// - DOM: init() registers the commands (core/commands.js) and installs the
//   one keydown listener. It builds the ctx (view, route, focus facts, the
//   pending chord) and runs whatever resolve() names through the registry,
//   the same path the palette (ui/palette.js) uses.
//
// Terminal focus: Claude Code uses Esc to interrupt and readline uses Ctrl-K
// to kill a line, so while an xterm has focus EVERY key goes to the session.
// Only ⌘K (meta) still opens the palette. After that, text inputs are left
// alone, and an open modal dialog (palette, help, confirm) keeps its keys.
//
// Nothing here dispatches an action without its tier's dialog: the ack keys
// go through confirmAction() (ui/confirm.js) like every palette action.
import { store, builders, toIndexKey } from '../core/store.js';
import { isFkey } from '../core/keys.js';
import { VIEWS, currentRoute, navigate } from '../core/router.js';
import { tierOf, act, hubAct } from '../core/actions.js';
import * as commands from '../core/commands.js';
import { nextOverlay } from '../views/map/overlays.js';
import { VIEW_META } from '../views/index.js';
import * as mapModule from '../views/map.js';
import * as railModule from './rail.js';
import { togglePin } from './dock.js';
import { closeSheet, openSheet } from './sheet.js';
import { closeTop, toggleTheme } from './shell.js';
import { confirmAction } from './confirm.js';
import { toast } from './toast.js';
import { cardNodes, focusSession, orderedSessions } from '../views/board.js';
import { closeMenus } from '../views/board-card.js';
import { openPalette, closePalette, isPaletteOpen, registerPaletteCommands } from './palette.js';

/** A chord's second key must come within this many ms (as app.js:1872 did). */
export const CHORD_MS = 1000;
/** resolve() returns this for a key that starts a chord (`g`). */
export const CHORD_PREFIX = 'chord:';

/**
 * True when the keystroke belongs to a terminal. Claude Code uses Esc to
 * interrupt, so while an xterm has focus EVERY key — Escape included — must
 * reach the session and none of the dashboard shortcuts may fire. The sheet
 * is closed with the X button (or Escape while focus is outside the terminal).
 */
export function keyBelongsToTerminal(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('.xterm, .term-host, .sheet-body, .xterm-helper-textarea'));
}

// ---------------------------------------------------------------- the table

const row = (keys, id, label, group, view = null) => Object.freeze({
  keys: Object.freeze(Array.isArray(keys) ? keys : [keys]), id, label, group, view,
});

/**
 * The §4 2.6 hotkey table. `keys` are KeyboardEvent.key values; a space makes
 * a chord (`g m`), `Mod+k` is ⌘ (meta) and `Ctrl+k` the control key. A row
 * with a `view` only applies while that view is active and then wins over the
 * global row for the same key. The inbox and diff rows name commands their
 * views register (§8 C13, §10 R11); until then the key resolves and runs
 * nothing.
 */
export const KEYMAP = Object.freeze([
  // The view chord, as core/router.js VIEW_KEYS (test/hotkeys.test.mjs keeps them equal).
  row('g m', 'view.map', 'Map', 'views'),
  row('g b', 'view.board', 'Board', 'views'),
  row('g i', 'view.inbox', 'Inbox', 'views'),
  row('g p', 'view.packages', 'Packages', 'views'),
  row('g x', 'view.box', 'Box', 'views'),
  row('g a', 'view.audit', 'Audit', 'views'),
  row('g c', 'view.credit', 'Credit', 'views'),
  row('g o', 'view.morning', 'Morning', 'views'),
  row('[', 'builder.prev', 'Previous builder', 'scope'),
  row(']', 'builder.next', 'Next builder', 'scope'),
  row('0', 'builder.all', 'All builders', 'scope'),
  row('1', 'builder.1', 'Builder 1', 'scope'),
  row('2', 'builder.2', 'Builder 2', 'scope'),
  row('3', 'builder.3', 'Builder 3', 'scope'),
  row('4', 'builder.4', 'Builder 4', 'scope'),
  row('5', 'builder.5', 'Builder 5', 'scope'),
  row('6', 'builder.6', 'Builder 6', 'scope'),
  row('7', 'builder.7', 'Builder 7', 'scope'),
  row('8', 'builder.8', 'Builder 8', 'scope'),
  row('9', 'builder.9', 'Builder 9', 'scope'),
  row(['j', 'ArrowDown'], 'cursor.next', 'Next item', 'move'),
  row(['k', 'ArrowUp'], 'cursor.prev', 'Previous item', 'move'),
  row('Enter', 'drill.down', 'Drill down', 'move'),
  row(['u', 'Backspace'], 'drill.up', 'Up one level', 'move'),
  row('/', 'find', 'Find', 'move'),
  row('n', 'attention.next', 'Next alarm lane', 'move'),
  row('N', 'attention.prev', 'Previous alarm lane', 'move'),
  row('f', 'map.fit', 'Fit the map', 'map', 'map'),
  row('c', 'map.fold', 'Fold / unfold', 'map', 'map'),
  row('o', 'map.overlay.next', 'Next overlay', 'map', 'map'),
  row('O', 'map.overlay.prev', 'Previous overlay', 'map', 'map'),
  row('a', 'inbox.approve', 'Approve', 'inbox', 'inbox'),
  row('d', 'inbox.deny', 'Deny', 'inbox', 'inbox'),
  row('r', 'inbox.release', 'Release to terminal', 'inbox', 'inbox'),
  row('p', 'inbox.pause', 'Pause', 'inbox', 'inbox'),
  row('c', 'diff.comment', 'Comment on lines', 'diff', 'diff'),
  row('p', 'lane.pin', 'Pin lane to dock', 'lane'),
  row('a', 'alarm.ack', 'Ack focused alarm', 'lane'),
  row('A', 'alarm.ack-all', 'Ack all visible alarms', 'lane'),
  row(['Mod+k', 'Ctrl+k'], 'palette.open', 'Command palette', 'shell'),
  row(':', 'palette.act', 'Palette: actions', 'shell'),
  row('\\', 'split.toggle', 'Split view', 'shell'),
  row('`', 'tape.toggle', 'Event tape', 'shell'),
  row('?', 'help', 'Keys (this help)', 'shell'),
  row('Escape', 'layer.close', 'Close the top layer', 'shell'),
]);

/** Keys a focused list (a `.dt` table, a listbox) handles itself. */
const LIST_KEYS = new Set(['j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End', ' ']);
/** Keys a focused button or link handles itself. */
const CONTROL_KEYS = new Set(['Enter', ' ']);

function isModK(e) {
  return String(e.key ?? '').toLowerCase() === 'k';
}

/**
 * keyEvent ({key, metaKey, ctrlKey, altKey}) + ctx -> command id, or null.
 * ctx: {view, inTerminal, inInput, inList, inControl, dialogOpen,
 *       chord, chordAt, now, keymap}
 * - ⌘K always opens the palette, even from a terminal or an input.
 * - a terminal swallows everything else (Ctrl-K included: readline).
 * - Ctrl-K outside a terminal opens the palette, inputs included.
 * - inputs and open dialogs swallow the rest; other modifiers are ignored.
 * - a pending chord (`g`) younger than CHORD_MS completes first; a chord
 *   prefix returns `chord:<key>`.
 * - a view-scoped row wins over the global row while its view is active.
 */
export function resolve(e, ctx = {}) {
  if (!e || typeof e.key !== 'string') return null;
  const map = ctx.keymap ?? KEYMAP;
  const key = e.key;
  if (e.metaKey && !e.ctrlKey && !e.altKey && isModK(e)) return 'palette.open';
  if (ctx.inTerminal) return null;
  if (e.ctrlKey && !e.metaKey && !e.altKey && isModK(e)) return 'palette.open';
  if (ctx.inInput || ctx.dialogOpen) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (ctx.inList && LIST_KEYS.has(key)) return null;
  if (ctx.inControl && CONTROL_KEYS.has(key)) return null;

  const view = ctx.view ?? null;
  const applies = (r) => r.view === null || r.view === view;
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  if (ctx.chord && Number.isFinite(ctx.chordAt) && now - ctx.chordAt < CHORD_MS) {
    const seq = `${ctx.chord} ${key}`;
    const hit = pickRow(map.filter((r) => applies(r) && r.keys.includes(seq)), view);
    if (hit) return hit;
    // Not a chord: the key counts on its own (a stray `g` swallows nothing).
  }
  if (map.some((r) => applies(r) && r.keys.some((k) => k.startsWith(`${key} `)))) return `${CHORD_PREFIX}${key}`;
  return pickRow(map.filter((r) => applies(r) && r.keys.includes(key)), view);
}

/** The view-scoped row first, else the global one. */
function pickRow(rows, view) {
  if (!rows.length) return null;
  return (rows.find((r) => r.view !== null && r.view === view) ?? rows.find((r) => r.view === null) ?? null)?.id ?? null;
}

/** '`Mod+k`' -> '⌘K', 'Escape' -> 'Esc', ... for the help overlay and the palette hints. */
export function keyLabel(k) {
  const s = String(k);
  const named = { 'Mod+k': '⌘K', 'Ctrl+k': 'Ctrl-K', Escape: 'Esc', Enter: '⏎', Backspace: '⌫', ArrowDown: '↓', ArrowUp: '↑', ' ': 'Space' };
  return named[s] ?? s;
}

/** The key hint for command `id` (its first keys row), or ''. */
export function keysFor(id, view = null, keymap = KEYMAP) {
  const r = keymap.find((x) => x.id === id && (x.view === null || x.view === view)) ?? keymap.find((x) => x.id === id);
  return r ? r.keys.map(keyLabel).join(' / ') : '';
}

/**
 * The help overlay's model: groups of {keys, label, view} in table order.
 * View-scoped rows say their view. Pure.
 */
export function helpModel(keymap = KEYMAP) {
  const groups = new Map();
  for (const r of keymap) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push({ keys: r.keys.map(keyLabel).join(' / '), label: r.label, view: r.view });
  }
  return [...groups].map(([group, rows]) => ({ group, rows }));
}

// ---------------------------------------------------------------- pure helpers

/** The scope `dir` steps from `cur` in ['all', ...ids], wrapping. Pure. */
export function stepBuilder(ids, cur, dir = 1) {
  const order = ['all', ...ids];
  let i = order.indexOf(cur ?? 'all');
  if (i < 0) i = 0;
  const d = dir < 0 ? -1 : 1;
  return order[(i + d + order.length) % order.length];
}

const P_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const pRank = (a) => P_RANK[a?.priority] ?? 9;

/** Alarms worst first: unacked first, then priority, then oldest. Pure. */
export function alarmOrder(list) {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a === 'object')
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(Boolean(x.a.acked)) - Number(Boolean(y.a.acked))
      || pRank(x.a) - pRank(y.a)
      || (x.a.since ?? 0) - (y.a.since ?? 0)
      || x.i - y.i)
    .map((x) => x.a);
}

/** An alarm's lane/session fleet key, or null. Pure. */
export function alarmKey(a) {
  if (typeof a?.builder !== 'string' || typeof a?.target !== 'string' || !a.target) return null;
  const k = `${a.builder}/${a.target}`;
  return isFkey(k) ? k : null;
}

/**
 * The lanes `n`/`N` cycle through, worst first: the alarm lanes, or when no
 * alarm names a lane, the attention list's keys. Pure.
 */
export function attentionKeys(alarmList, attention = []) {
  const out = [];
  for (const a of alarmOrder(alarmList)) {
    if (a.acked) continue;
    const k = alarmKey(a);
    if (k && !out.includes(k)) out.push(k);
  }
  if (out.length) return out;
  for (const a of Array.isArray(attention) ? attention : []) {
    const k = a?.key;
    if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The key after (dir 1) or before (dir -1) `cur` in `keys`, wrapping; the first when cur is absent. Pure. */
export function stepKey(keys, cur, dir = 1) {
  if (!keys.length) return null;
  const i = keys.indexOf(cur);
  if (i < 0) return dir < 0 ? keys[keys.length - 1] : keys[0];
  const d = dir < 0 ? -1 : 1;
  return keys[(i + d + keys.length) % keys.length];
}

/**
 * The alarm `a` acks: the one on the focused lane (sel or the board cursor,
 * matched by fleet key or alarm id), else the worst unacked one in scope. Pure.
 */
export function focusedAlarm(alarmList, { focus = null, b = null } = {}) {
  const live = alarmOrder(alarmList).filter((a) => !a.acked && (!b || b === 'all' || a.builder === b));
  if (focus) {
    const hit = live.find((a) => alarmKey(a) === focus || a.id === focus);
    if (hit) return hit;
  }
  return live[0] ?? null;
}

/** The new `lb.split` value after a toggle ('1' on, '0' off). Pure. */
export function toggledSplit(stored) {
  return stored === '1' ? '0' : '1';
}

// ---------------------------------------------------------------- DOM: context

/** The map view's API (§5 M4 createMap), when the map is loaded. */
function mapApi(ctx) {
  if (ctx?.mapView) return ctx.mapView;
  try { return mapModule.getMapView?.() ?? null; } catch { return null; }
}

function routeNow() {
  try { return currentRoute(); } catch { return { view: store.view, b: null, s: null, q: null, sel: null, open: null }; }
}

/** The ctx resolve() and the commands read, for event `e` (or none: the palette). */
export function hotkeyContext(e = null) {
  const t = e?.target ?? null;
  const closest = (sel) => (t && typeof t.closest === 'function' ? t.closest(sel) : null);
  const matches = (sel) => (t && typeof t.matches === 'function' ? t.matches(sel) : false);
  return {
    store,
    view: store.view,
    route: routeNow(),
    now: Date.now(),
    chord: pendingG ? 'g' : null,
    chordAt: pendingG || null,
    inTerminal: keyBelongsToTerminal(t),
    inInput: matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
    inList: Boolean(closest('.dt-wrap, [role="listbox"], [role="grid"]')),
    inControl: matches('button, a[href], summary, [role="button"]'),
    dialogOpen: Boolean(globalThis.document?.querySelector?.('dialog[open]')),
  };
}

// ---------------------------------------------------------------- DOM: commands

/**
 * `g` starts a two-key view chord. It expires after CHORD_MS so a stray g
 * does not swallow the next real keystroke, and `g k`-style chords have to
 * win over single keys, which is why the chord is checked before anything
 * else (resolve) and before any view gate below.
 */
let pendingG = 0;

/** The key the board cursor or the selection is on. */
function focusKey(ctx) {
  return store.cursor ?? ctx.route?.sel ?? null;
}

function moveBoardCursor(dir) {
  // j/k/p/Enter move a cursor through cards: only on the Board.
  if (store.view !== 'board') return false;
  const list = orderedSessions().map((s) => s.key);
  if (!list.length) return false;
  const i = list.indexOf(store.cursor);
  store.cursor = dir > 0 ? list[Math.min(list.length - 1, i + 1)] ?? list[0] : list[Math.max(0, i - 1)] ?? list[0];
  for (const [k, node] of cardNodes) node.classList.toggle('cursor', k === store.cursor);
  cardNodes.get(store.cursor)?.scrollIntoView({ block: 'nearest' });
  return true;
}

function cursor(dir, ctx) {
  if (ctx.view === 'map') {
    const mv = mapApi(ctx);
    if (!mv?.selectNext) return false;
    mv.selectNext(dir);
    return true;
  }
  return moveBoardCursor(dir);
}

function setScope(id) {
  navigate({ b: !id || id === 'all' ? null : id });
  return true;
}

function builderStep(dir) {
  if (typeof railModule.selectNext === 'function') return railModule.selectNext(dir) !== null;
  const cur = routeNow().b ?? 'all';
  return setScope(stepBuilder(builders(store).map((b) => b.id), cur, dir));
}

function builderIndex(n) {
  if (typeof railModule.selectIndex === 'function') return railModule.selectIndex(n) !== null;
  if (n === 0) return setScope('all');
  const b = builders(store)[n - 1];
  return b ? setScope(b.id) : false;
}

function drillDown(ctx) {
  const r = ctx.route ?? {};
  if (ctx.view === 'board' && store.cursor && !r.sel) { openSheet(store.cursor); return true; }
  if (ctx.view === 'map') {
    const sel = mapApi(ctx)?.selected?.() ?? null;
    if (sel && sel !== r.sel) { navigate({ sel }); return true; }
  }
  if (r.sel && !r.open) {
    const k = toIndexKey(store, r.sel);
    if (k && store.sessions.has(k)) { openSheet(k); return true; }
    navigate({ open: 'term' });
    return true;
  }
  return false;
}

function drillUp(ctx) {
  const r = ctx.route ?? {};
  if (store.openSession) { closeSheet(); return true; }
  if (r.open) { navigate({ open: null }, { replace: true }); return true; }
  if (r.sel) { navigate({ sel: null }, { replace: true }); return true; }
  if (r.b && r.b !== 'all') { navigate({ b: null }); return true; }
  return false;
}

function find(ctx) {
  if (ctx.view === 'map') {
    const mv = mapApi(ctx);
    if (mv?.focusFind) { mv.focusFind(); return true; }
  }
  const box = globalThis.document?.getElementById?.(`view-${ctx.view}`);
  const input = box?.querySelector?.('input[type="search"], [data-find]');
  if (input && typeof input.focus === 'function') { input.focus(); return true; }
  openPalette({ ctx: hotkeyContext() });
  return true;
}

function attentionJump(dir, ctx) {
  const keys = attentionKeys(store.alarms, store.attention);
  const next = stepKey(keys, focusKey(ctx), dir);
  if (!next) return false;
  const k = toIndexKey(store, next) ?? next;
  if (ctx.view === 'board' && store.sessions.has(k)) { focusSession(k); return true; }
  if (isFkey(next)) navigate({ sel: next });
  else if (store.sessions.has(k)) focusSession(k);
  return true;
}

/** Ack through the confirm tiers (ack-alarm is `click`: no dialog), then act(). */
export async function ackAlarm(target, args = {}) {
  const tier = tierOf('ack-alarm');
  const ok = await confirmAction({ action: 'ack-alarm', targets: [target], tier });
  if (!ok.ok) return { ok: false, error: 'cancelled' };
  const res = store.source.kind === 'hub'
    ? await hubAct({ builder: target === '*' ? '*' : null, action: 'ack-alarm', target, args })
    : await act(target, 'ack-alarm', args);
  if (res?.ok === true) toast(target === '*' ? 'Alarms acked' : 'Alarm acked', { kind: 'ok' });
  else if (res?.ok === 'unknown') toast('Ack sent, outcome unknown');
  else toast(`Ack failed: ${res?.error ?? 'error'}`, { kind: 'err' });
  return res;
}

function ackFocused(ctx) {
  const a = focusedAlarm(store.alarms, { focus: focusKey(ctx), b: ctx.route?.b });
  if (!a || typeof a.id !== 'string') return false;
  ackAlarm(a.id);
  return true;
}

function ackAll(ctx) {
  const b = ctx.route?.b && ctx.route.b !== 'all' ? ctx.route.b : null;
  const live = (store.alarms ?? []).filter((a) => a && !a.acked && (!b || a.builder === b));
  if (!live.length) return false;
  ackAlarm('*', b ? { builder: b } : {});
  return true;
}

function toggleSplit() {
  let next = '1';
  try {
    next = toggledSplit(globalThis.localStorage?.getItem('lb.split'));
    globalThis.localStorage?.setItem('lb.split', next);
  } catch { /* private mode: the event still tells the map */ }
  if (typeof CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('lb:split', { detail: { on: next === '1' } }));
  return true;
}

function toggleTape() {
  const tape = globalThis.document?.getElementById?.('tape');
  const open = tape?.dataset ? tape.dataset.open !== '1' : true;
  if (tape?.dataset) tape.dataset.open = open ? '1' : '0';
  if (typeof CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('lb:tape', { detail: { open } }));
  return true;
}

// ---------------------------------------------------------------- DOM: help overlay

let helpDlg = null;

/** The `?` overlay, generated from KEYMAP (textContent only). */
export function openHelp() {
  const doc = globalThis.document;
  if (!doc) return false;
  if (helpDlg?.open) { helpDlg.close(); return true; }
  helpDlg?.remove?.();
  const dlg = doc.createElement('dialog');
  dlg.className = 'pal pal-help';
  dlg.setAttribute('aria-labelledby', 'pal-help-t');
  const h = doc.createElement('h2');
  h.className = 'pal-help-t';
  h.id = 'pal-help-t';
  h.textContent = 'Keys';
  dlg.append(h);
  const grid = doc.createElement('div');
  grid.className = 'pal-help-g';
  for (const g of helpModel()) {
    const sec = doc.createElement('section');
    const t = doc.createElement('h3');
    t.textContent = g.group.toUpperCase();
    sec.append(t);
    const dl = doc.createElement('dl');
    for (const r of g.rows) {
      const dt = doc.createElement('dt');
      const kbd = doc.createElement('kbd');
      kbd.textContent = r.keys;
      dt.append(kbd);
      const dd = doc.createElement('dd');
      dd.textContent = r.view ? `${r.label} (${r.view})` : r.label;
      dl.append(dt, dd);
    }
    sec.append(dl);
    grid.append(sec);
  }
  dlg.append(grid);
  dlg.addEventListener('close', () => { dlg.remove(); if (helpDlg === dlg) helpDlg = null; });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  doc.body.append(dlg);
  helpDlg = dlg;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  return true;
}

// ---------------------------------------------------------------- DOM: registration

const mapCmd = (fn) => (ctx) => {
  const mv = mapApi(ctx);
  if (!mv) return false;
  return fn(mv) !== false;
};

let registered = false;

/** Register every command the keymap names that this module owns. Idempotent. */
export function registerCommands() {
  if (registered) return;
  registered = true;
  const reg = commands.register;
  for (const v of VIEWS) {
    const meta = VIEW_META[v] ?? { title: v, icon: 'map' };
    reg({ id: `view.${v}`, title: meta.title, icon: meta.icon, type: 'VIEW', run: () => { navigate({ view: v }); return true; } });
  }
  reg({ id: 'builder.prev', title: 'Previous builder', icon: 'chev-l', run: () => builderStep(-1) });
  reg({ id: 'builder.next', title: 'Next builder', icon: 'chev-r', run: () => builderStep(1) });
  reg({ id: 'builder.all', title: 'All builders', icon: 'builder', run: () => builderIndex(0) });
  for (let n = 1; n <= 9; n++) reg({ id: `builder.${n}`, title: `Builder ${n}`, icon: 'builder', palette: false, run: () => builderIndex(n) });
  reg({ id: 'cursor.next', title: 'Next item', icon: 'chev-d', palette: false, run: (ctx) => cursor(1, ctx) });
  reg({ id: 'cursor.prev', title: 'Previous item', icon: 'chev-d', palette: false, run: (ctx) => cursor(-1, ctx) });
  reg({ id: 'drill.down', title: 'Drill down', icon: 'chev-r', palette: false, run: drillDown });
  reg({ id: 'drill.up', title: 'Up one level', icon: 'chev-l', run: drillUp });
  reg({ id: 'find', title: 'Find', icon: 'search', run: find });
  reg({ id: 'attention.next', title: 'Next alarm lane', icon: 'alarm', run: (ctx) => attentionJump(1, ctx) });
  reg({ id: 'attention.prev', title: 'Previous alarm lane', icon: 'alarm', run: (ctx) => attentionJump(-1, ctx) });
  const onMap = (ctx) => ctx.view === 'map';
  reg({ id: 'map.fit', title: 'Fit the map', icon: 'map', when: onMap, run: mapCmd((mv) => mv.fit?.()) });
  reg({ id: 'map.fold', title: 'Fold / unfold the selection', icon: 'chev-d', when: onMap, run: mapCmd((mv) => mv.toggleFold?.()) });
  reg({ id: 'map.overlay.next', title: 'Next map overlay', icon: 'filter', when: onMap, run: mapCmd((mv) => mv.setOverlay?.(nextOverlay(mv.overlay?.(), 1))) });
  reg({ id: 'map.overlay.prev', title: 'Previous map overlay', icon: 'filter', when: onMap, run: mapCmd((mv) => mv.setOverlay?.(nextOverlay(mv.overlay?.(), -1))) });
  const pinKey = (ctx) => {
    const k = store.cursor ?? (ctx.route?.sel ? toIndexKey(store, ctx.route.sel) : null);
    return k && store.sessions.has(k) ? k : null;
  };
  reg({ id: 'lane.pin', title: 'Pin lane to dock', icon: 'pin', when: (ctx) => Boolean(pinKey(ctx)), run: (ctx) => { togglePin(pinKey(ctx)); return true; } });
  reg({ id: 'alarm.ack', title: 'Ack focused alarm', icon: 'ack', tier: 'click', when: () => (store.alarms ?? []).some((a) => a && !a.acked), run: ackFocused });
  reg({ id: 'alarm.ack-all', title: 'Ack all visible alarms', icon: 'ack', tier: 'click', when: () => (store.alarms ?? []).some((a) => a && !a.acked), run: ackAll });
  reg({ id: 'palette.open', title: 'Command palette', icon: 'command', palette: false, run: () => { if (isPaletteOpen()) closePalette(); else openPalette({ ctx: hotkeyContext() }); return true; } });
  reg({ id: 'palette.act', title: 'Palette: actions', icon: 'command', palette: false, run: () => { openPalette({ preset: '>', ctx: hotkeyContext() }); return true; } });
  reg({ id: 'split.toggle', title: 'Split view (map + list)', icon: 'split', run: toggleSplit });
  reg({ id: 'tape.toggle', title: 'Event tape', icon: 'clock', run: toggleTape });
  reg({ id: 'help', title: 'Keys', icon: 'keyboard', run: openHelp });
  reg({ id: 'layer.close', title: 'Close the top layer', icon: 'close', palette: false, run: () => closeTop() !== null });
  reg({ id: 'theme', title: 'Theme: dark / light', icon: 'theme', run: () => { toggleTheme(); return true; } });
  registerPaletteCommands();
}

/** Top-level wiring, run once by boot(). */
export function init() {
  registerCommands();
  addEventListener('keydown', (e) => {
    const ctx = hotkeyContext(e);
    const id = resolve(e, ctx);
    pendingG = 0;
    if (!id) return;
    if (id.startsWith(CHORD_PREFIX)) { pendingG = Date.now(); e.preventDefault(); return; }
    const r = commands.run(id, ctx);
    if (r.ok && r.value !== false) e.preventDefault();
  });

  addEventListener('click', (e) => { if (!e.target.closest?.('.menu, .btn-more')) closeMenus(); });
}
