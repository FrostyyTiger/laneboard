// The app shell (fleet plan §4 2.4, task D4): header (brand, conn lamp, view
// nav, scope chips, annunciator slot, UTC + local clock), the left rail slot,
// the centre view host, the inspector slot, the bottom bar shared by the
// event tape and the hotkey legend, and the phone hooks. Also the top bar
// figures, the builder chips (F8b) and the toast re-export. Moved from
// public/app.js (fleet F1).
//
// Slots other tasks fill (ids in index.html): #shell-rail (D5 builder rail),
// #shell-insp (D6 inspector), #tape and #legend (D7 tape; the legend is drawn
// here until D8's KEYMAP replaces it), #ann (D7 annunciator), #shell-strip and
// #shell-sheet (D6b phone chip strip and bottom sheet). setRail/setInspector
// flip the grid; the layout attribute on <html> is the phone/tablet hook.
import { $, el } from '../core/dom.js';
import { money } from '../core/format.js';
import { builders, loadPinned, savePinned, setKeyMode, store, subscribe } from '../core/store.js';
import { BUILDER_ID_RX, deriveCode } from '../core/keys.js';
import { reconnect } from '../core/net.js';
import { VIEW_KEYS, currentRoute, navigate, onRoute } from '../core/router.js';
import { fitAll } from './terminal.js';
import { renderDock } from './dock.js';
import { closeLaunch, openLaunch, submitLaunch } from './launch.js';
import { plate, scopeChip } from './components.js';
import { closeSheet } from './sheet.js';
import { closeMenus } from '../views/board-card.js';
import { VIEW_META, updateActive } from '../views/index.js';
import { loadMorning, morning } from '../views/morning.js';

// The kit's stacking toast (ui/toast.js, the component kit) under the old name.
export { toast } from './toast.js';

/**
 * The header spend figure: {text, label, title}. Pure. It sums the live
 * sessions' `cost.usdToday` and says so in its label ("sessions today"): runs
 * are fetched by the Runs view only and a hub has no `/api/runs`, so a run's
 * cost is not in this number and the label must not claim it is (T39).
 * When no session reported a cost today the figure is `—`, not `$0.00`: an
 * unknown cost is never shown as a zero; a reported zero stays `$0.00` (T15).
 * The line is dim (`cls: 'dim'`) unless a builder's whole-builder budget row
 * (the `budget` snapshot key, scope `builder`) is at level `over`, then it
 * takes the warn hue (`cls: 'over'`); with no budget configured it stays dim
 * (T55, designer r10 idea 2). `budgets` is the builders' budget rows, flat.
 */
export function topbarSpend(sessions, budgets) {
  let today = 0;
  let all = 0;
  let reported = false;
  for (const s of sessions || []) {
    if (Number.isFinite(s?.cost?.usdToday)) {
      today += s.cost.usdToday;
      reported = true;
    }
    all += Number.isFinite(s?.cost?.usd) ? s.cost.usd : 0;
  }
  const over = (budgets || []).filter((r) => r?.scope === 'builder' && r.level === 'over');
  const overNote = over.length
    ? ` Over the builder budget: ${over.map((r) => `${money(r.usd)} of ${money(r.limit)}`).join(', ')}.`
    : '';
  return {
    usd: reported ? today : null,
    text: reported ? money(today) : '—',
    label: ' sessions today',
    cls: over.length ? 'over' : 'dim',
    title: `API-equivalent spend of live sessions today; runs show their own cost on the Runs view. All time across live sessions: ${money(all)}. On a subscription the rate-limit gauges are the real constraint.${overNote}`,
  };
}

/** Every builder's budget rows, flat (store.js keeps the `budget` snapshot key per builder). */
function budgetRows() {
  return builders(store).flatMap((b) => (Array.isArray(b.budget) ? b.budget : []));
}

export function renderTopbar() {
  const m = topbarSpend(store.sessions.values(), budgetRows());
  const n = $('stat-cost');
  n.textContent = '';
  n.append(el('b', null, m.text));
  n.append(document.createTextNode(m.label));
  n.className = `stat stat-${m.cls}`;
  n.title = m.title;
}

// ---------------------------------------------------------------- builders

/** Builder.status -> the chip's status word. */
const CHIP_STATUS = { live: 'live', stale: 'stale', down: 'down', connecting: 'connecting' };

/**
 * One chip per builder for the `#builders` strip: {id, code, status, title}.
 * Pure (reads only `s`). In builder mode there is exactly one chip, and it
 * mirrors the source; in hub mode each chip follows its own builder row.
 */
export function builderChips(s) {
  s ||= store;
  return builders(s).map((b) => {
    const status = CHIP_STATUS[b.status] ?? 'down';
    const code = (typeof b.code === 'string' && b.code) || deriveCode(b.id);
    const parts = [b.id, status];
    if (b.state && b.state !== 'up' && b.state !== status) parts.push(b.state);
    if (b.versionSkew) parts.push(`version ${b.versionSkew}`);
    return { id: b.id, code, status, title: parts.join(' · ') };
  });
}

/**
 * The `#builders` strip next to the source badge `#conn`. A down builder
 * turns its chip red (`down`); the global `#offline` banner belongs to the
 * source alone (core/net.js setConnected), so in hub mode one builder down
 * never raises it.
 */
export function renderBuilders() {
  const strip = $('builders');
  if (!strip) return;
  const chips = builderChips(store);
  strip.textContent = '';
  strip.hidden = chips.length === 0;
  for (const c of chips) {
    const chip = el('span', `conn builder-chip status-${c.status}${c.status === 'down' ? ' down' : ''}`, c.code);
    chip.dataset.builder = c.id;
    chip.dataset.status = c.status;
    chip.title = c.title;
    strip.append(chip);
  }
  const conn = $('conn');
  if (conn) conn.title = `${store.source.kind === 'hub' ? 'hub' : 'builder'} connection: ${store.source.status}`;
}

/**
 * The views read fleet keys (`s.key`, `dataset.key`). The page's store starts
 * in keyMode 'name' until the local source names its builder; on the first
 * builder-scoped frame it switches to fleet keys, and the pins saved under
 * local names migrate to `<localId>/<name>` (loadPinned, migratePins). A hub
 * source is in fleet keys from its first frame (store.setSourceKind).
 * Returns true when it switched.
 */
export function adoptFleetKeys(change, s) {
  s ||= store;
  if (s.keyMode === 'fkey' || !change) return false;
  if (!['hello', 'snapshot', 'delta', 'stuck', 'fleet'].includes(change.type)) return false;
  setKeyMode(s, 'fkey');
  const id = s.source.id ?? change.builder ?? null;
  if (s === store && typeof id === 'string' && BUILDER_ID_RX.test(id)) {
    s.pinned = loadPinned(id);
    savePinned();
  }
  return true;
}

// ---------------------------------------------------------------- clock

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The header clock for `date`: UTC `HH:MM:SSZ` on the first line, local
 * `HH:MM` and the zone abbreviation on the second. `timeZone` is for tests
 * (default: the browser's). Pure.
 */
export function clockParts(date = new Date(), { timeZone } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  const utc = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
  let local = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  let tz = '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}),
    }).formatToParts(d);
    const get = (type) => parts.find((x) => x.type === type)?.value ?? '';
    local = `${get('hour')}:${get('minute')}`;
    tz = get('timeZoneName');
  } catch { /* no Intl zone data: the local time without a name */ }
  return { utc, local, tz };
}

/** Write the clock (textContent only). */
export function renderClock(now = new Date()) {
  const { utc, local, tz } = clockParts(now);
  const u = $('clock-utc');
  const l = $('clock-local');
  if (u && u.textContent !== utc) u.textContent = utc;
  const lt = tz ? `${local} ${tz}` : local;
  if (l && l.textContent !== lt) l.textContent = lt;
}

// ---------------------------------------------------------------- scope chips

/**
 * The scope chips for a route: one per active filter, {param, text, title}.
 * `b` shows the builder's code when the store knows it. Empty = no scope
 * (the shell shows the plate ALL). Pure.
 */
export function scopeModel(route, s) {
  s ||= store;
  const out = [];
  if (route?.b && route.b !== 'all') {
    const b = s.builders?.get?.(route.b);
    const code = (typeof b?.code === 'string' && b.code) || deriveCode(route.b);
    out.push({ param: 'b', text: code, title: `Builder ${route.b}: remove filter` });
  }
  if (route?.s) out.push({ param: 's', text: String(route.s).toUpperCase(), title: `State ${route.s}: remove filter` });
  if (route?.q) out.push({ param: 'q', text: `“${route.q}”`, title: `Search ${route.q}: remove filter` });
  return out;
}

/** The #scope toolbar for `route`. Removing a chip navigates the param away. */
export function renderScope(route) {
  const bar = $('scope');
  if (!bar) return;
  bar.textContent = '';
  const chips = scopeModel(route ?? currentRoute());
  if (!chips.length) {
    bar.append(plate('ALL', { title: 'No filter: every builder' }));
    return;
  }
  for (const c of chips) {
    bar.append(scopeChip(c.text, { param: c.param, title: c.title, onRemove: (param) => navigate({ [param]: null }) }));
  }
}

// ---------------------------------------------------------------- legend

/** View-scoped keys, shown first in the legend while the view is active. */
const VIEW_LEGEND = {
  board: [['j k', 'MOVE'], ['⏎', 'OPEN'], ['p', 'PIN']],
  map: [['/', 'FIND'], ['f', 'FIT']],
};

/**
 * The hotkey legend for `view`: [{keys, label}], the view's own keys first,
 * then the view chord for the other views and the palette/help. Pure; the
 * labels are the nav's short names. D8's KEYMAP replaces the source later.
 */
export function legendItems(view) {
  const out = (VIEW_LEGEND[view] ?? []).map(([keys, label]) => ({ keys, label }));
  for (const [k, v] of Object.entries(VIEW_KEYS)) {
    if (v === view) continue;
    out.push({ keys: `g ${k}`, label: VIEW_META[v]?.short ?? v.toUpperCase() });
  }
  out.push({ keys: '⌘K', label: 'CMD' }, { keys: '?', label: 'HELP' });
  return out;
}

export function renderLegend(view) {
  const box = $('legend');
  if (!box) return;
  box.textContent = '';
  for (const it of legendItems(view ?? store.view)) {
    const item = el('span', 'legend-i');
    item.append(el('kbd', null, it.keys), el('span', 'legend-l', it.label));
    box.append(item);
  }
}

// ---------------------------------------------------------------- layout hooks

/** The shell layout for a viewport width: phone <700, tablet 700-1199, desktop. Pure. */
export function layoutFor(width) {
  const w = Number(width) || 0;
  if (w < 700) return 'phone';
  if (w < 1200) return 'tablet';
  return 'desktop';
}

/** Default row density: dense on desktop, comfy on tablet, touch on a coarse pointer. Pure. */
export function densityFor(width, { coarse = false } = {}) {
  if (coarse) return 'touch';
  return layoutFor(width) === 'desktop' ? 'dense' : 'comfy';
}

/** Stamp data-layout (and data-density unless set by hand) on <html>. */
export function applyLayout() {
  const root = document.documentElement;
  if (!root?.dataset) return;
  const w = globalThis.innerWidth ?? 1200;
  root.dataset.layout = layoutFor(w);
  if (!root.dataset.densityPinned) {
    const coarse = Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches);
    root.dataset.density = densityFor(w, { coarse });
  }
}

/** The left rail: 'open' (220px), 'min' (56px) or 'none' (no column, the default until D5). */
export function setRail(mode) {
  const shell = $('shell');
  if (shell) shell.dataset.rail = ['open', 'min'].includes(mode) ? mode : 'none';
}

/** The inspector overlay inside the centre: open or closed (D6 drives it from sel=). */
export function setInspector(open) {
  const shell = $('shell');
  if (shell) shell.dataset.insp = open ? 'open' : 'closed';
  const insp = $('shell-insp');
  if (insp) insp.hidden = !open;
}

/** The slots later tasks render into. */
export function shellSlots() {
  return {
    shell: $('shell'), head: $('shell-head'), ann: $('ann'), scope: $('scope'),
    rail: $('shell-rail'), main: $('shell-main'), insp: $('shell-insp'),
    tape: $('tape'), legend: $('legend'), strip: $('shell-strip'), sheet: $('shell-sheet'),
  };
}

// ---------------------------------------------------------------- theme

export const THEMES = ['dark', 'light'];

/** A stored preference -> a theme name ('dark' unless it says light). Pure. */
export function themeFor(pref) {
  return pref === 'light' ? 'light' : 'dark';
}

/** Set the theme on <html>, remember it, and tell the map (`lb:theme`). */
export function setTheme(theme) {
  const t = themeFor(theme);
  const root = document.documentElement;
  if (root?.dataset) root.dataset.theme = t;
  try { localStorage.setItem('lb.theme', t); } catch { /* private mode */ }
  if (typeof CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('lb:theme', { detail: { theme: t } }));
  return t;
}

export function toggleTheme() {
  return setTheme(document.documentElement?.dataset?.theme === 'light' ? 'dark' : 'light');
}

function applyStoredTheme() {
  let pref = null;
  try { pref = localStorage.getItem('lb.theme'); } catch { /* private mode */ }
  const root = document.documentElement;
  if (pref && root?.dataset) root.dataset.theme = themeFor(pref);
}

// ---------------------------------------------------------------- Esc

/**
 * Close the top layer (plan §4 2.6 Esc): an open dialog, then menus, then the
 * terminal sheet (L4), then the inspector selection, then the s/q scope.
 * Returns what it closed, or null. D8's Esc binding calls this.
 */
export function closeTop() {
  const dlg = document.querySelector?.('dialog[open]');
  if (dlg && typeof dlg.close === 'function') { dlg.close(); return 'dialog'; }
  if (document.querySelector?.('.menu')) { closeMenus(); return 'menu'; }
  if (store.openSession) { closeSheet(); return 'sheet'; }
  const r = currentRoute();
  if (r.sel) { navigate({ sel: null, open: null }, { replace: true }); return 'inspector'; }
  if (r.s || r.q) { navigate({ s: null, q: null }); return 'scope'; }
  return null;
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  applyStoredTheme();
  applyLayout();
  addEventListener('resize', applyLayout, { passive: true });
  renderClock();
  setInterval(() => renderClock(), 1000);
  onRoute((route) => {
    renderScope(route);
    renderLegend(route.view);
  });

  // Fleet keys from the first frame on; the chips follow the source status.
  subscribe((change) => {
    adoptFleetKeys(change);
    if (change.type === 'status' || change.type === 'hello') {
      try { renderBuilders(); } catch { /* the render path reports its own errors */ }
    }
    // The mounted view hears every store change (legacy views ignore it).
    updateActive(store);
  });

  // auto -> stacked -> 2x2 -> auto
  $('dock-layout').onclick = () => {
    store.dockLayout = store.dockLayout === null ? true : store.dockLayout ? false : null;
    renderDock();
    fitAll();
  };
  $('btn-refresh').onclick = () => { reconnect(); };

  $('btn-launch')?.addEventListener('click', openLaunch);
  $('lf-close')?.addEventListener('click', closeLaunch);
  $('launch-form')?.addEventListener('submit', submitLaunch);

  $('morning-window')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-window]');
    if (!btn) return;
    morning.window = btn.dataset.window;
    loadMorning(true);
  });

  // The view nav: a push, so Back returns to the previous view. The filters
  // (b, s, q) stay; a view switch drops the selection.
  $('views')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-view]');
    if (btn) navigate({ view: btn.dataset.view });
  });
}
