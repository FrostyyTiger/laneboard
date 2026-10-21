// The rail: attention, vitals, rate limits, the 49" box blocks. Moved from public/app.js (fleet F1).
// Plus the builder rail in #shell-rail (fleet plan §4 2.4, task D5), at the end of this file.
import { $, el } from '../core/dom.js';
import { ago, resetsIn } from '../core/format.js';
import { alarms, builders, store, subscribe } from '../core/store.js';
import { deriveCode } from '../core/keys.js';
import { icon } from '../core/icons.js';
import { currentRoute, navigate, onRoute } from '../core/router.js';
import { builderMark, lamp, lampLabel, laneMix, markSel, mixLabel, plate, scopeSessions, segbar } from './components.js';
import { setRail } from './shell.js';
import { compactGauge, gauge, stateDot } from './widgets.js';
import { focusSession } from '../views/board.js';
import { boxBlocks } from '../views/box.js';

/** On the 49" the Box is rail blocks, not a tab (the CSS hides the tab there). */
export function renderRailBox() {
  const host = $('rail-box');
  if (!host) return;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 2000px)').matches;
  host.hidden = !wide;
  if (!wide || !store.boxDirty) return;
  host.textContent = '';
  for (const b of boxBlocks()) host.append(b);
}

export function renderAttention() {
  const list = $('attention-list');
  const strip = $('attention-strip');
  list.textContent = '';
  strip.textContent = '';
  const items = store.attention.slice(0, 12);
  $('attention-count').textContent = String(store.attention.length);
  $('attention-empty').hidden = items.length > 0;

  items.forEach((a, i) => {
    const li = document.createElement('li');
    const b = el('button', `attention-item s-${a.danger ? 'danger' : a.state}`);
    if (a.danger) b.title = a.danger;
    b.append(el('span', 'idx', String(i + 1)));
    b.append(stateDot(a.state, a.since));
    b.append(el('span', 'nm', a.name));
    b.append(el('span', 'ago', ago(a.since)));
    b.dataset.key = a.key;
    b.onclick = () => focusSession(a.key);
    li.append(b);
    list.append(li);

    const chip = el('button', `chip s-${a.danger ? 'danger' : a.state}`);
    chip.append(stateDot(a.state, a.since));
    chip.append(el('span', 'nm', a.name));
    chip.append(el('span', 'ago', ago(a.since)));
    chip.dataset.key = a.key;
    chip.onclick = () => focusSession(a.key);
    strip.append(chip);
  });
}

export function renderVitals() {
  const v = store.vitals;
  const box = $('vitals');
  box.textContent = '';
  if (!v) return;
  const add = (k, val, sub) => {
    const d = el('div', 'vital');
    d.append(el('div', 'k', k));
    const vv = el('div', 'v', val);
    if (sub) { const s = el('small', null, ` ${sub}`); vv.append(s); }
    d.append(vv);
    box.append(d);
  };
  add('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, v.load ? `load ${v.load[0].toFixed(2)}` : '');
  if (v.mem) add('mem', `${(v.mem.usedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`);
  if (v.mem) add('swap', `${(v.mem.swapUsedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`);
  if (v.disk) add('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free');
  add('claude', `${(v.claudeRssMb / 1024).toFixed(1)}G`, `${v.sessionCount} sessions`);
  if (v.gpu) add('gpu', `${v.gpu.utilPct}%`, `${(v.gpu.memUsedMb / 1024).toFixed(1)}G`);
  add('laneboard', `${v.laneboardRssMb}MB`, '');
}

/** Rate limits come from whichever session's statusline fired most recently. */
export function freshestRateLimits() {
  let best = null;
  for (const s of store.sessions.values()) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best?.rateLimits ?? null;
}

export function renderRateLimits() {
  const box = $('rate-limits');
  const top = $('topbar-gauges');
  box.textContent = '';
  top.textContent = '';
  const rl = freshestRateLimits();
  if (!rl) { box.append(el('p', 'empty', 'No statusline data yet.')); return; }
  for (const [key, label] of [['fiveHour', '5 h window'], ['sevenDay', '7 d window']]) {
    const g = rl[key];
    if (!g) continue;
    const short = key === 'fiveHour' ? '5h' : '7d';
    box.append(gauge(`${label} · ${resetsIn(g.resetsAt)}`, g.usedPct));
    // Both forms are always in the DOM; CSS picks one per breakpoint.
    top.append(gauge(short, g.usedPct, resetsIn(g.resetsAt)));
    top.append(compactGauge(short, g.usedPct, resetsIn(g.resetsAt)));
  }
}

// ================================================================ builder rail (D5)
//
// The left rail in #shell-rail (plan §4 2.4): an ALL row with the fleet
// totals, then one row per builder in builders() order (by id): an 8 px
// health lamp, the builder's code plate, its lane count `[12]` and a segment
// bar of the lane-state mix. Collapsed (56 px) shows the lamp and code only.
// Clicking a row, or Enter/Space on it, sets the scope `b=<id>` (ALL clears
// it) through the router; routes only select and filter.
//
// The lamp is the shared builder mark (components.js builderMark, as the phone
// chip): the worst of its alarms (§7 `alarms`, plus its `health`
// sample's own alarms) and its lanes (permission p1, question p2), or its link state: down -> p1 (the trouble red), stale
// -> the grey hollow `stale` lamp (as the phone sheet), and both rows are
// hatched: the hatch is the shape cue, so no third hue (runs T31). Builder names and codes are untrusted: they reach the DOM
// through textContent and setAttribute only.
//
// The collapse state lives in localStorage['lb.rail'] ('open' | 'min'). On a
// tablet the rail is fixed collapsed and toggleRail() opens it as an overlay
// for the moment, without touching the stored choice.
//
// For the hotkeys (`[` `]`, `0`, `1-9`): selectNext(dir), selectIndex(n) and
// toggleRail(). The pure models (railRows, builderLamp, railOrder,
// stepScope, scopeAt, railModeFrom) are tested in test/rail.test.mjs.

export const RAIL_KEY = 'lb.rail';
export const RAIL_MODES = Object.freeze(['open', 'min']);
/** Longest code the plate shows; the full id is in the title. */
export const CODE_MAX = 6;

/** Severity order of a lamp `data-p`, worst first. */
const LAMP_RANK = Object.freeze({ 1: 0, 2: 1, 3: 2, stale: 3, run: 4, ok: 5, off: 6 });
const BUILDER_STATUS = new Set(['live', 'stale', 'down', 'connecting']);
// eslint-disable-next-line no-control-regex
const CONTROL_RX = /[\u0000-\u001f\u007f]/g;

/** A stored value -> a rail mode ('open' unless it says 'min'). Pure. */
export function railModeFrom(raw) {
  return raw === 'min' ? 'min' : 'open';
}

/** The stored collapse state. */
export function loadRailMode(storage = globalThis.localStorage) {
  try { return railModeFrom(storage?.getItem(RAIL_KEY)); } catch { return 'open'; }
}

/** Remember the collapse state; returns the mode stored. */
export function saveRailMode(mode, storage = globalThis.localStorage) {
  const m = railModeFrom(mode);
  try { storage?.setItem(RAIL_KEY, m); } catch { /* private mode */ }
  return m;
}

/** A builder code for the plate: no control characters, upper case, at most CODE_MAX. Pure. */
export function codeText(code, id = '') {
  const c = String(code ?? '').replace(CONTROL_RX, '').trim().toUpperCase().slice(0, CODE_MAX);
  if (c) return c;
  try { return deriveCode(String(id)); } catch { return 'BU'; }
}

/** The worse of two lamp priorities. Pure. */
export function worseP(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return (LAMP_RANK[b] ?? 9) < (LAMP_RANK[a] ?? 9) ? b : a;
}

/** One builder's lamp: the shared builder mark (components.js `builderMark`, runs T43). */
export function builderLamp(b, list = [], mix = null) {
  return builderMark(b, list, mix);
}

function addMix(into, mix) {
  for (const k of Object.keys(into)) into[k] += mix[k] || 0;
  return into;
}

/**
 * The rail's rows for store `s` under `route`: the ALL row first, then one
 * per builder. Each row is {id, code, p, unack, lampLabel, n, mix, status,
 * hatched, selected, title, label}. `n` counts the builder's lanes (the
 * sessions the segment bar is drawn from). Pure.
 */
export function railRows(s, route = null) {
  s ||= store;
  const scope = route?.b && route.b !== 'all' ? route.b : 'all';
  const list = alarms(s);
  const rows = [];
  const total = laneMix([]);
  let worst = null;
  let unackAll = false;
  for (const b of builders(s)) {
    const mix = laneMix(scopeSessions(s, b.id));
    addMix(total, mix);
    const lp = builderLamp(b, list, mix);
    const status = BUILDER_STATUS.has(b.status) ? b.status : 'down';
    const code = codeText(b.code, b.id);
    const mixText = mixLabel(mix);
    rows.push({
      id: b.id, code, p: lp.p, unack: lp.unack, lampLabel: lp.label,
      n: mix.total, mix, status, hatched: status === 'stale' || status === 'down',
      selected: scope === b.id,
      title: `${b.id} · ${status} · ${lp.label} · ${mixText}`,
      label: `${code} ${b.id}, ${lp.label}, ${mixText}`,
    });
  }
  for (const r of rows) worst = worseP(worst, r.p);
  for (const r of rows) if (r.p === worst && r.unack) unackAll = true;
  const p = worst ?? 'off';
  const allText = mixLabel(total);
  const n = rows.length;
  const word = p === 'ok' || p === 'run' || p === 'off' ? lampLabel(p) : `worst ${lampLabel(p)}`;
  rows.unshift({
    id: 'all', code: 'ALL', p, unack: unackAll, lampLabel: word,
    n: total.total, mix: total, status: 'all', hatched: false, selected: scope === 'all',
    title: `All builders (${n}) · ${word} · ${allText}`,
    label: `All ${n} ${n === 1 ? 'builder' : 'builders'}, ${word}, ${allText}`,
  });
  return rows;
}

/** The scopes in rail order: 'all', then the builder ids. Pure. */
export function railOrder(s) {
  s ||= store;
  return ['all', ...builders(s).map((b) => b.id)];
}

/** The scope at rail index `i` (0 = all, 1-9 = builder N), or null. Pure. */
export function scopeAt(order, i) {
  const k = Number(i);
  return Number.isInteger(k) && k >= 0 && k < order.length ? order[k] : null;
}

/** The scope one step from `cur` in `order` (dir > 0 down, < 0 up), wrapping. Pure. */
export function stepScope(order, cur, dir = 1) {
  if (!order.length) return null;
  let i = order.indexOf(cur ?? 'all');
  if (i < 0) i = 0;
  const d = dir < 0 ? -1 : 1;
  return order[(i + d + order.length) % order.length];
}

// ---------------------------------------------------------------- DOM

function countText(n) {
  return Number.isFinite(n) ? `[${n}]` : '';
}

function railOption(r, onSelect) {
  const o = document.createElement('div');
  o.className = ['brail-row', r.id === 'all' ? 'brail-row--all' : '', r.hatched ? 'brail-row--hatch' : ''].filter(Boolean).join(' ');
  o.setAttribute('role', 'option');
  o.setAttribute('aria-selected', r.selected ? 'true' : 'false');
  o.setAttribute('aria-label', r.label);
  o.title = r.title;
  o.tabIndex = -1;
  o.dataset.b = r.id;
  o.dataset.status = r.status;
  markSel(o, r.selected);
  const code = plate(r.code, { kind: r.id === 'all' ? 'solid' : null });
  code.classList.add('brail-code');
  const n = document.createElement('span');
  n.className = 'brail-n';
  n.textContent = countText(r.n);
  const bar = segbar(r.mix);
  bar.classList.add('brail-seg');
  o.append(lamp(r.p, { unack: r.unack, label: r.lampLabel }), code, n, bar);
  o.addEventListener('click', () => onSelect?.(r.id));
  return o;
}

/**
 * The rail element for `rows` (railRows): a collapse toggle and a listbox of
 * options. `onSelect(id)` runs on click, Enter or Space; arrows, Home and End
 * move the focus (roving tabindex). Returns the root.
 */
export function buildRail(rows, { mode = 'open', onSelect = null, onToggle = null } = {}) {
  const m = railModeFrom(mode);
  const root = document.createElement('div');
  root.className = 'brail';
  root.dataset.mode = m;

  const tog = document.createElement('button');
  tog.type = 'button';
  tog.className = 'brail-tog';
  const name = m === 'open' ? 'Collapse builder rail' : 'Expand builder rail';
  tog.setAttribute('aria-label', name);
  tog.setAttribute('aria-expanded', m === 'open' ? 'true' : 'false');
  tog.title = name;
  tog.append(icon(m === 'open' ? 'chev-l' : 'chev-r', { size: 's' }));
  tog.addEventListener('click', () => onToggle?.());

  const list = document.createElement('div');
  list.className = 'brail-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Builders');
  list.setAttribute('aria-orientation', 'vertical');
  const opts = rows.map((r) => railOption(r, onSelect));
  const cur = opts.find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0];
  if (cur) cur.tabIndex = 0;
  list.append(...opts);

  list.addEventListener('keydown', (e) => {
    let i = opts.indexOf(e.target);
    if (i < 0) i = Math.max(0, opts.findIndex((o) => o.tabIndex === 0));
    let next = null;
    if (e.key === 'ArrowDown') next = opts[Math.min(i + 1, opts.length - 1)];
    else if (e.key === 'ArrowUp') next = opts[Math.max(i - 1, 0)];
    else if (e.key === 'Home') next = opts[0];
    else if (e.key === 'End') next = opts[opts.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation?.();
      if (opts[i]) onSelect?.(opts[i].dataset.b);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation?.();
    if (!next) return;
    for (const o of opts) o.tabIndex = o === next ? 0 : -1;
    next.focus?.();
  });

  root.append(tog, list);
  return root;
}

// ---------------------------------------------------------------- runtime

const railRt = { host: null, sig: '', overlay: false, armed: false };

function isTablet() {
  return globalThis.document?.documentElement?.dataset?.layout === 'tablet';
}

/** The mode shown now: the stored one, or on a tablet min unless the overlay is open. */
export function railMode() {
  if (isTablet()) return railRt.overlay ? 'open' : 'min';
  return loadRailMode();
}

/** Set the scope to builder `id` ('all' clears it). Routes only select. */
export function selectScope(id) {
  if (typeof id !== 'string' || !id) return null;
  railRt.overlay = false;
  navigate({ b: id === 'all' ? null : id });
  return id;
}

function currentScope() {
  const b = currentRoute().b;
  return b && b !== 'all' ? b : 'all';
}

/** `]` / `[`: the next (dir 1) or previous (dir -1) scope in rail order. Returns the id. */
export function selectNext(dir = 1) {
  return selectScope(stepScope(railOrder(store), currentScope(), dir));
}

/** `0` / `1-9`: scope N in rail order (0 = all). Returns the id, or null past the end. */
export function selectIndex(n) {
  const id = scopeAt(railOrder(store), n);
  return id ? selectScope(id) : null;
}

/** Collapse or expand the rail. Desktop: stored; tablet: a transient overlay. */
export function toggleRail() {
  if (isTablet()) railRt.overlay = !railRt.overlay;
  else saveRailMode(loadRailMode() === 'open' ? 'min' : 'open');
  railRt.sig = '';
  renderRail();
  return railMode();
}

/** Set the stored mode ('open' | 'min') and redraw. */
export function setRailMode(mode) {
  const m = saveRailMode(mode);
  railRt.sig = '';
  renderRail();
  return m;
}

/** Draw the rail into #shell-rail for `route`; a no-op when nothing it shows changed. */
export function renderRail(route = null, s = null) {
  s ||= store;
  const host = $('shell-rail');
  if (!host) return null;
  const mode = railMode();
  setRail(mode);
  const rows = railRows(s, route ?? currentRoute());
  const sig = JSON.stringify([mode, rows]);
  if (host === railRt.host && sig === railRt.sig) return host;
  railRt.host = host;
  railRt.sig = sig;
  const active = document.activeElement;
  const refocus = active?.dataset?.b && typeof host.contains === 'function' && host.contains(active) ? active.dataset.b : null;
  host.textContent = '';
  host.append(buildRail(rows, { mode, onSelect: selectScope, onToggle: toggleRail }));
  if (refocus) {
    for (const o of host.querySelectorAll?.('.brail-row') ?? []) {
      if (o.dataset.b !== refocus) continue;
      for (const x of host.querySelectorAll('.brail-row')) x.tabIndex = x === o ? 0 : -1;
      o.focus?.();
    }
  }
  return host;
}

function safeRender(route) {
  try { renderRail(route); } catch (err) { console.error('[laneboard] builder rail', err); }
}

/**
 * Wire the rail once: redraw on every store change, route and resize. Called
 * by itself after the module graph has evaluated when the page has a
 * #shell-rail (so no other module needs a line for it); idempotent.
 */
export function initRail() {
  if (railRt.armed || typeof document === 'undefined' || !$('shell-rail')) return false;
  railRt.armed = true;
  subscribe(() => safeRender());
  onRoute((route) => safeRender(route));
  globalThis.addEventListener?.('resize', () => safeRender(), { passive: true });
  safeRender();
  return true;
}

export { initRail as init };

// After every module of the page has evaluated (a microtask after the
// synchronous graph). Under `node --test` there is no document: nothing runs.
Promise.resolve().then(() => { try { initRail(); } catch { /* reported by safeRender */ } });
