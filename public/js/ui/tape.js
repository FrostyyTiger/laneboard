// The event tape (fleet plan §4 2.4, task D7): the bottom bar's left part.
//
// - Keeps a ring of the last 500 `event` messages (hook events, stamped by
//   the store with `builder` and the fleet `key`).
// - Collapsed (28px): one line, newest on the left. Never auto-scrolls; while
//   the pointer is over the tape it is paused (new events wait in the ring
//   and appear on leave), so the item under the pointer never moves away.
//   A click on an item jumps to its lane (`sel=<fkey>` through the router).
// - Expanded (the toggle button, or toggleTape() for the `` ` `` key, D8):
//   a 200px log drawer above the bar with the newest 200 rows as a `.dt`.
//   Its scroll position is the user's: rows are added at the top and nothing
//   scrolls it.
// - Each item has a severity left bar (`data-p`, the lamp priorities).
// - Filtered by the route scope: `b=` (builder), `q=` (text) and `s=<tile>`
//   (the lanes of that annunciator tile).
//
// Pure at import time. The model functions (createRing, eventP, tapeItem,
// filterItems, ...) are tested in test/annunciator.test.mjs. Event fields
// come from builders: they reach the DOM through textContent only.
import { $ } from '../core/dom.js';
import { deriveCode, isFkey } from '../core/keys.js';
import { alarms, store, subscribe } from '../core/store.js';
import { currentRoute, navigate, onRoute } from '../core/router.js';
import { tileFromParam, tileKeys, tileModel } from '../core/alarm-tiles.js';
import { icon } from '../core/icons.js';
import { dataTable } from './components.js';

export const TAPE_MAX = 500;
export const DRAWER_ROWS = 200;
/** Items drawn on the collapsed line (the bar is one line; the rest is clipped). */
export const LINE_ITEMS = 40;
const FIELD_MAX = 80;

/** A bounded ring, newest first: {push(x), list(), size(), clear()}. */
export function createRing(max = TAPE_MAX) {
  const cap = Math.max(1, Math.floor(Number(max) || TAPE_MAX));
  let buf = [];
  return {
    push: (x) => {
      buf.unshift(x);
      if (buf.length > cap) buf.length = cap;
      return buf.length;
    },
    list: () => buf,
    size: () => buf.length,
    clear: () => { buf = []; },
  };
}

/** A builder-supplied field as one short plain line ('' when absent). */
export function clip(v, max = FIELD_MAX) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const PERMISSION_SUBTYPES = new Set(['permission_prompt', 'permission']);

/**
 * The severity of a hook event, as a lamp `data-p`:
 * permission prompt '1'; other notifications and failures '2'; stop 'ok';
 * session start/end 'off'; tool use and everything else 'run'. Pure.
 */
export function eventP(ev) {
  const type = String(ev?.type ?? '');
  const sub = String(ev?.subtype ?? '');
  if (type === 'Notification') return PERMISSION_SUBTYPES.has(sub) ? '1' : '2';
  if (PERMISSION_SUBTYPES.has(sub)) return '1';
  if (/fail|error/i.test(type)) return '2';
  if (type === 'Stop' || type === 'SubagentStop') return 'ok';
  if (type === 'SessionStart' || type === 'SessionEnd') return 'off';
  return 'run';
}

const pad2 = (n) => String(n).padStart(2, '0');

/** `HH:MM:SS` local time of a timestamp, or '--:--:--'. Pure. */
export function tapeTime(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '--:--:--';
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

let seq = 0;

/**
 * A store event -> a tape item {uid, ts, time, builder, code, name, what, p, key}.
 * `s` is the store (for the builder's code). Pure apart from the uid counter.
 */
export function tapeItem(ev, s = null) {
  const e = ev && typeof ev === 'object' ? ev : {};
  const builder = typeof e.builder === 'string' ? e.builder : '';
  const b = builder ? s?.builders?.get?.(builder) : null;
  const code = (typeof b?.code === 'string' && /^[A-Z0-9]{2,3}$/.test(b.code) && b.code) || (builder ? deriveCode(builder) : '');
  const name = clip(e.session_name);
  const type = clip(e.type, 40);
  const sub = clip(e.subtype, 40);
  const ts = Number(e.ts) || Date.now();
  return {
    uid: `t${++seq}`,
    ts,
    time: tapeTime(ts),
    builder,
    code,
    name,
    what: sub ? `${type} · ${sub}` : type,
    p: eventP(e),
    key: typeof e.key === 'string' && isFkey(e.key) ? e.key : null,
  };
}

/**
 * The items the scope lets through: `b` (builder id; 'all' or null = every),
 * `q` (case-insensitive substring of name, event, code), and `keys` (a Set of
 * fleet keys, from `s=<tile>`; null = no tile filter). Keeps the order. Pure.
 */
export function filterItems(items, { b = null, q = null, keys = null } = {}) {
  const needle = typeof q === 'string' && q !== '' ? q.toLowerCase() : null;
  return (Array.isArray(items) ? items : []).filter((it) => {
    if (b && b !== 'all' && it.builder !== b) return false;
    if (keys && !(it.key && keys.has(it.key))) return false;
    if (needle && !`${it.code} ${it.name} ${it.what}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The scope of a route for filterItems (the tile's lanes for `s=<tile>`). Pure. */
export function tapeScope(route, alarmList) {
  const tile = tileFromParam(route?.s ?? null);
  return {
    b: route?.b ?? null,
    q: route?.q ?? null,
    keys: tile ? tileKeys(tileModel(alarmList), tile) : null,
  };
}

/** The accessible text of one item. Pure. */
export function itemLabel(it) {
  return [it.time, it.code, it.name, it.what].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- DOM

const ring = createRing(TAPE_MAX);
let box = null;
let line = null;
let drawer = null;
let table = null;
let toggle = null;
let open = false;
let paused = false;
let dirty = false;
let frame = 0;
let byUid = new Map();

/** The ring (newest first), for tests in a page and for D8's palette. */
export function tapeItems() {
  return ring.list();
}

function jump(it) {
  if (it?.key) navigate({ sel: it.key });
}

function itemNode(it) {
  const n = document.createElement('button');
  n.type = 'button';
  n.className = 'tape-i';
  n.dataset.p = it.p;
  n.dataset.uid = it.uid;
  if (!it.key) n.disabled = true;
  const label = itemLabel(it);
  n.title = label;
  n.setAttribute('aria-label', label);
  const t = document.createElement('span');
  t.className = 'tape-t';
  t.textContent = it.time;
  n.append(t);
  if (it.code) {
    const c = document.createElement('span');
    c.className = 'tape-c';
    c.textContent = it.code;
    n.append(c);
  }
  const nm = document.createElement('span');
  nm.className = 'tape-n';
  nm.textContent = it.name || '—';
  const w = document.createElement('span');
  w.className = 'tape-w';
  w.textContent = it.what;
  n.append(nm, w);
  return n;
}

function textCell(text, cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function ensureTable() {
  if (table) return table;
  table = dataTable({
    label: 'Event log',
    rowKey: (it) => it.uid,
    onOpen: jump,
    columns: [
      { key: 'p', label: '', cell: (it) => { const s = textCell('', 'tape-bar'); s.dataset.p = it.p; return s; } },
      { key: 'time', label: 'TIME' },
      { key: 'code', label: 'B' },
      { key: 'name', label: 'SESSION' },
      { key: 'what', label: 'EVENT' },
    ],
  });
  table.root.classList.add('tape-dt');
  table.root.addEventListener('click', (e) => {
    const tr = e.target?.closest?.('tr[data-key]');
    if (tr) jump(byUid.get(tr.dataset.key));
  });
  drawer.append(table.root);
  return table;
}

function paint() {
  frame = 0;
  if (!box) return;
  if (paused) { dirty = true; return; }
  dirty = false;
  const items = filterItems(ring.list(), tapeScope(currentRoute(), alarms(store)));
  byUid = new Map(items.map((it) => [it.uid, it]));
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'tape-empty';
    empty.textContent = ring.size() ? 'no events in this scope' : 'no events yet';
    line.replaceChildren(empty);
  } else {
    line.replaceChildren(...items.slice(0, LINE_ITEMS).map(itemNode));
  }
  if (open) ensureTable().update(items.slice(0, DRAWER_ROWS));
}

function schedule() {
  if (frame) return;
  const raf = globalThis.requestAnimationFrame;
  frame = typeof raf === 'function' ? raf(paint) : setTimeout(paint, 16);
}

/** Open or close the log drawer (the `` ` `` key; D8 binds it). */
export function setTapeOpen(on) {
  open = Boolean(on);
  if (!box) return open;
  box.dataset.open = open ? 'true' : 'false';
  drawer.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.title = open ? 'Close the event log (`)' : 'Open the event log (`)';
  if (open) { paused = false; paint(); }
  return open;
}

export function toggleTape() {
  return setTapeOpen(!open);
}

/** Add one store event (the subscriber does this; exported for D8/tests in a page). */
export function pushEvent(ev) {
  ring.push(tapeItem(ev, store));
  schedule();
}

/** Wire #tape once, run by boot(). */
export function init() {
  box = $('tape');
  if (!box) return;
  box.textContent = '';
  box.setAttribute('role', 'region');
  toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tape-tog icon-btn';
  toggle.setAttribute('aria-controls', 'tape-drawer');
  toggle.append(icon('chev-d', { size: 's', cls: 'tape-tog-i' }));
  line = document.createElement('div');
  line.className = 'tape-line';
  line.setAttribute('aria-live', 'off');
  drawer = document.createElement('div');
  drawer.className = 'tape-drawer';
  drawer.id = 'tape-drawer';
  drawer.hidden = true;
  box.append(toggle, line, drawer);
  setTapeOpen(false);

  toggle.addEventListener('click', () => toggleTape());
  line.addEventListener('click', (e) => {
    const n = e.target?.closest?.('.tape-i');
    if (n) jump(byUid.get(n.dataset.uid));
  });
  // Hover pauses the collapsed line (and the drawer under the pointer).
  box.addEventListener('pointerenter', () => { paused = true; });
  box.addEventListener('pointerleave', () => {
    paused = false;
    if (dirty) schedule();
  });

  subscribe((change) => {
    if (change.type === 'event' && change.event) pushEvent(change.event);
    else if (change.type === 'alarms' && tileFromParam(currentRoute().s)) schedule();
  });
  onRoute(() => schedule());
  paint();
}
