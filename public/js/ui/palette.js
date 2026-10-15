// The command palette (fleet plan §4 2.5, task D8): a native <dialog class="pal">
// with a combobox input and a listbox of typed rows (HOST LANE PKG ACT VIEW).
//
// Opens with ⌘K, Ctrl-K outside a terminal, or `:` (which presets `>`); the
// keys live in ui/hotkeys.js. Prefixes `h:`/`host:`, `l:`/`lane:`,
// `p:`/`pkg:`, `>`/`act:` narrow the type (ui/fuzzy.js parsePrefix). An empty
// query lists the recent ids (last 20, localStorage['lb.pal.recent']), then
// the current alarms' lanes, then the views. Results are capped at 50.
//
// ACT rows come from core/commands.js. A row that sends an action runs
// through runAction(): confirmAction() (ui/confirm.js) with the action's tier
// first, act() (core/actions.js) only after an OK. Destructive verbs never run
// without a dialog, even where the tier table says `click`.
//
// Every name shown here (builders, lanes, sessions, packages) comes from a
// builder: it is untrusted text and goes in through textContent only.
// Pure at import time: the dialog is built on the first open.
import { store, builders, toIndexKey } from '../core/store.js';
import { fkey, isFkey, BUILDER_ID_RX, deriveCode } from '../core/keys.js';
import { currentRoute, navigate } from '../core/router.js';
import { act, tierOf } from '../core/actions.js';
import { icon } from '../core/icons.js';
import * as commands from '../core/commands.js';
import { plate } from './components.js';
import { confirmAction, DESTRUCTIVE } from './confirm.js';
import { toast } from './toast.js';
import { rankItems, parsePrefix, CAP } from './fuzzy.js';
import { attentionKeys, keysFor } from './hotkeys.js';

export const RECENT_KEY = 'lb.pal.recent';
export const RECENT_MAX = 20;
const ID_MAX = 300;
const LABEL_MAX = 120;

// ---------------------------------------------------------------- recent

/** Parse the stored recent list: unique strings, newest first, at most RECENT_MAX. Pure. */
export function parseRecent(raw) {
  let v;
  try { v = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (typeof x === 'string' && x && x.length <= ID_MAX && !out.includes(x)) out.push(x);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** `id` moved to the front of `list`, capped. Pure. */
export function pushRecent(list, id) {
  return [id, ...(Array.isArray(list) ? list : []).filter((x) => x !== id)].slice(0, RECENT_MAX);
}

function loadRecent() {
  try { return parseRecent(globalThis.localStorage?.getItem(RECENT_KEY)); } catch { return []; }
}

function saveRecent(list) {
  try { globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- items

const clip = (s) => String(s ?? '').slice(0, LABEL_MAX);

/** A session's or lane's fleet key for `sel=`, or null. */
function selKey(builder, name, key) {
  if (typeof key === 'string' && isFkey(key)) return key;
  if (typeof builder === 'string' && BUILDER_ID_RX.test(builder) && typeof name === 'string' && name) {
    try { return fkey(builder, name); } catch { return null; }
  }
  return null;
}

/** The repos the packages frame lists (hub merge or builder collector), defensively. */
function repoNames(pk) {
  const repos = Array.isArray(pk?.repos) ? pk.repos : Array.isArray(pk) ? pk : [];
  const out = [];
  for (const r of repos.slice(0, 500)) {
    const name = typeof r === 'string' ? r : (r?.slug || r?.name);
    if (typeof name === 'string' && name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Every palette row for `ctx` ({store, view, route}):
 * {id, type, label, sub, icon, hint, run}. Commands (ACT/VIEW) first, then
 * HOST, LANE and PKG rows. `run` is called by the palette after it closes.
 */
export function paletteItems(ctx = {}) {
  const s = ctx.store ?? store;
  const items = [];
  for (const c of commands.list(ctx)) {
    if (!c.palette) continue;
    items.push({
      id: `cmd:${c.id}`, type: c.type === 'VIEW' ? 'VIEW' : 'ACT', label: c.title, sub: c.sub, icon: c.icon,
      hint: keysFor(c.id, ctx.view), run: () => commands.run(c.id, ctx),
    });
  }
  for (const b of builders(s)) {
    const code = (typeof b.code === 'string' && b.code) || deriveCode(b.id);
    items.push({
      id: `host:${b.id}`, type: 'HOST', label: clip(b.id), sub: clip(`${code} · ${b.status ?? ''}`), icon: 'builder', hint: '',
      run: () => navigate({ b: b.id }),
    });
  }
  const seen = new Set();
  for (const l of s.lanes ?? []) {
    const k = selKey(l.builder, l.id ?? l.name, l.key);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push({
      id: `lane:${k}`, type: 'LANE', label: clip(l.id ?? l.name ?? k), sub: clip(l.builder ?? ''), icon: 'lane', hint: '', key: k,
      run: () => navigate({ sel: k }),
    });
  }
  for (const sess of s.sessions?.values?.() ?? []) {
    const k = selKey(sess.builder, sess.name, sess.key);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push({
      id: `lane:${k}`, type: 'LANE', label: clip(sess.name ?? k), sub: clip([sess.lane, sess.builder].filter(Boolean).join(' · ')), icon: 'terminal', hint: '', key: k,
      run: () => navigate({ view: 'board', sel: k }),
    });
  }
  for (const name of repoNames(s.packages)) {
    items.push({
      id: `pkg:${name}`, type: 'PKG', label: clip(name), sub: 'package', icon: 'packages', hint: '',
      run: () => navigate({ view: 'packages', q: name.slice(0, 200) }),
    });
  }
  return items;
}

/**
 * The rows for query `q`. Empty: recent first, then the alarm lanes, then
 * the views. A bare prefix lists that type. Otherwise fuzzy ranked (recent
 * breaks ties). Capped at 50. Pure given its inputs.
 */
export function paletteRows(items, q, { recent = [], alarmKeys = [] } = {}) {
  const { type, text } = parsePrefix(q);
  if (!type && !text) {
    const byId = new Map(items.map((it) => [it.id, it]));
    const out = [];
    const add = (it) => { if (it && !out.includes(it)) out.push(it); };
    for (const id of recent) add(byId.get(id));
    for (const k of alarmKeys) add(byId.get(`lane:${k}`));
    for (const it of items) if (it.type === 'VIEW') add(it);
    return out.slice(0, CAP);
  }
  return rankItems(items, q, { recent, cap: CAP });
}

// ---------------------------------------------------------------- actions

/**
 * Send `action` to key `k` the safe way: the tier's dialog first (a
 * destructive verb is at least `ask`), then act(). `confirm` goes into args
 * only for the confirm tier, as the dispatcher expects.
 */
export async function runAction(action, k, { consequence = null } = {}) {
  const live = tierOf(action);
  let tier = live;
  if (DESTRUCTIVE.has(action) && (tier === 'read' || tier === 'click')) tier = 'ask';
  const ok = await confirmAction({ action, targets: [k], tier, consequence });
  if (!ok?.ok) return { ok: false, error: 'cancelled' };
  const args = live === 'confirm' && ok.confirm != null ? { confirm: ok.confirm } : {};
  const res = await act(k, action, args);
  if (res?.ok === true) toast(`${action}: done`, { kind: 'ok' });
  else if (res?.ok === 'unknown') toast(`${action}: sent, outcome unknown`);
  else toast(`${action} failed: ${String(res?.error ?? 'error').slice(0, 200)}`, { kind: 'err' });
  return res;
}

/** The selected session's key, if the selection (or the board cursor) is a session. */
function selectedSession(ctx) {
  const s = ctx.store ?? store;
  const sel = ctx.route?.sel ?? null;
  const k = (sel && toIndexKey(s, sel)) || s.cursor || null;
  return k && s.sessions?.has?.(k) ? k : null;
}

const SESSION_ACTIONS = [
  ['interrupt', 'Interrupt', 'interrupt'],
  ['restart', 'Restart session', 'restart'],
  ['kill', 'Kill session', 'kill'],
];

let paletteCommandsDone = false;

/** The palette's own ACT rows (session actions on the selection). Idempotent. */
export function registerPaletteCommands() {
  if (paletteCommandsDone) return;
  paletteCommandsDone = true;
  for (const [action, title, ico] of SESSION_ACTIONS) {
    commands.register({
      id: `act.${action}`,
      title,
      icon: ico,
      tier: DESTRUCTIVE.has(action) && tierOf(action) === 'click' ? 'ask' : tierOf(action),
      when: (ctx) => Boolean(selectedSession(ctx)),
      run: (ctx) => runAction(action, selectedSession(ctx)),
    });
  }
}

// ---------------------------------------------------------------- DOM

let ui = null; // {dlg, input, list, rows, active, ctx, items}

function build() {
  const doc = globalThis.document;
  const dlg = doc.createElement('dialog');
  dlg.className = 'pal';
  dlg.setAttribute('aria-label', 'Command palette');
  const input = doc.createElement('input');
  input.className = 'pal-in';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search  ·  h: host  l: lane  p: pkg  > action';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'pal-list');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', 'Command');
  const list = doc.createElement('ul');
  list.className = 'pal-list';
  list.id = 'pal-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  dlg.append(input, list);

  input.addEventListener('input', () => refresh());
  input.addEventListener('keydown', (e) => {
    const n = ui.rows.length;
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setActive(n ? (ui.active + 1) % n : -1); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setActive(n ? (ui.active - 1 + n) % n : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(ui.active); }
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest?.('li[role="option"]');
    if (li) setActive(Number(li.dataset.i));
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest?.('li[role="option"]');
    if (li) choose(Number(li.dataset.i));
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closePalette(); });
  dlg.addEventListener('close', () => { input.value = ''; });
  doc.body.append(dlg);
  return { dlg, input, list, rows: [], active: -1, ctx: {}, items: [] };
}

function rowNode(it, i) {
  const doc = globalThis.document;
  const li = doc.createElement('li');
  li.setAttribute('role', 'option');
  li.id = `pal-o-${i}`;
  li.dataset.i = String(i);
  li.setAttribute('aria-selected', 'false');
  li.className = 'pal-o';
  const ic = icon(it.icon ?? 'command', { size: 's' });
  const tag = plate(it.type);
  tag.classList.add('pal-type');
  const label = doc.createElement('span');
  label.className = 'pal-l';
  label.textContent = it.label;
  const sub = doc.createElement('span');
  sub.className = 'pal-s';
  sub.textContent = it.sub ?? '';
  const hint = doc.createElement('kbd');
  hint.className = 'pal-k';
  hint.textContent = it.hint ?? '';
  li.append(ic, tag, label, sub, hint);
  return li;
}

function setActive(i) {
  if (!ui) return;
  const nodes = ui.list.children;
  if (ui.active >= 0 && nodes[ui.active]) {
    nodes[ui.active].setAttribute('aria-selected', 'false');
    nodes[ui.active].classList.remove('is-cursor');
  }
  ui.active = i;
  const node = i >= 0 ? nodes[i] : null;
  if (node) {
    node.setAttribute('aria-selected', 'true');
    node.classList.add('is-cursor');
    ui.input.setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView?.({ block: 'nearest' });
  } else {
    ui.input.removeAttribute('aria-activedescendant');
  }
}

function refresh() {
  if (!ui) return;
  const s = ui.ctx.store ?? store;
  ui.rows = paletteRows(ui.items, ui.input.value, {
    recent: loadRecent(),
    alarmKeys: attentionKeys(s.alarms, s.attention),
  });
  ui.list.textContent = '';
  ui.active = -1;
  ui.rows.forEach((it, i) => ui.list.append(rowNode(it, i)));
  if (!ui.rows.length) {
    const li = globalThis.document.createElement('li');
    li.className = 'pal-empty';
    li.textContent = 'No match';
    ui.list.append(li);
  }
  setActive(ui.rows.length ? 0 : -1);
}

function choose(i) {
  const it = ui?.rows[i];
  if (!it) return;
  saveRecent(pushRecent(loadRecent(), it.id));
  closePalette();
  try {
    const r = it.run();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (err) {
    toast(`Command failed: ${String(err?.message ?? err).slice(0, 200)}`, { kind: 'err' });
  }
}

/** Open the palette; `preset` fills the input (`:` passes '>'). */
export function openPalette({ preset = '', ctx = null } = {}) {
  if (!globalThis.document) return false;
  ui ||= build();
  ui.ctx = ctx ?? { store, view: store.view, route: currentRoute() };
  ui.items = paletteItems(ui.ctx);
  ui.input.value = preset;
  if (!ui.dlg.open) {
    if (typeof ui.dlg.showModal === 'function') ui.dlg.showModal();
    else ui.dlg.setAttribute('open', '');
  }
  refresh();
  ui.input.focus();
  return true;
}

export function closePalette() {
  if (!ui?.dlg) return false;
  if (ui.dlg.open && typeof ui.dlg.close === 'function') ui.dlg.close();
  else ui.dlg.removeAttribute?.('open');
  return true;
}

export function isPaletteOpen() {
  return Boolean(ui?.dlg?.open || ui?.dlg?.hasAttribute?.('open'));
}
