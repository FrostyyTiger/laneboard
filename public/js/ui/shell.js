// Top bar, toast and the shell buttons. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { money } from '../core/format.js';
import { builders, loadPinned, savePinned, setKeyMode, store, subscribe } from '../core/store.js';
import { BUILDER_ID_RX, deriveCode } from '../core/keys.js';
import { reconnect } from '../core/net.js';
import { setView } from '../core/router.js';
import { fitAll } from './terminal.js';
import { renderDock } from './dock.js';
import { closeLaunch, openLaunch, submitLaunch } from './launch.js';
import { loadMorning, morning } from '../views/morning.js';

export function renderTopbar() {
  let today = 0;
  let all = 0;
  for (const s of store.sessions.values()) {
    today += s.cost?.usdToday || 0;
    all += s.cost?.usd || 0;
  }
  const n = $('stat-cost');
  n.textContent = '';
  n.append(el('b', null, money(today)));
  n.append(document.createTextNode(' today'));
  n.title = `API-equivalent. All time across live sessions: ${money(all)}. On a subscription the rate-limit gauges are the real constraint.`;
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

let toastTimer = null;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  // Fleet keys from the first frame on; the chips follow the source status.
  subscribe((change) => {
    adoptFleetKeys(change);
    if (change.type === 'status' || change.type === 'hello') {
      try { renderBuilders(); } catch { /* the render path reports its own errors */ }
    }
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

  for (const nav of ['views', 'tabs']) {
    $(nav)?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-view]');
      if (btn) setView(btn.dataset.view);
    });
  }
}
