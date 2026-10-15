// Top bar, toast and the shell buttons. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { money } from '../core/format.js';
import { store } from '../core/store.js';
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
