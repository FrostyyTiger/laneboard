// Laneboard dashboard. Vanilla ES modules, no framework (hard rule 7).
// Entry point: the old public/app.js, split into ./core, ./ui and ./views (fleet F1).
// boot() runs the old top-level wiring in its original source order.
import { ago } from './core/format.js';
import { store } from './core/store.js';
import { connect, init as initNet } from './core/net.js';
import { applyHash, setView, init as initRouter } from './core/router.js';
import { reportUiError } from './ui/render.js';
import { init as initShell } from './ui/shell.js';
import { init as initTape } from './ui/tape.js';
import { init as initAnnunciator } from './ui/annunciator.js';
import { renderAttention } from './ui/rail.js';
import { init as initSheet } from './ui/sheet.js';
import { init as initHotkeys } from './ui/hotkeys.js';
import { init as initPush } from './ui/push.js';
import { init as initNotifyPrefs } from './ui/notify-prefs.js';
import { cardNodes } from './views/board.js';
import { init as initMap } from './views/map.js';
import { views } from './views/index.js';
import { init as initArchive } from './views/archive.js';

export function boot() {
  initNet(); // app.js:208 (resize: scheduleVisible + fitAll)
  initSheet(); // app.js:1742, 1766-1782 (sheet close, quick-bar, qb-form)
  initShell(); // app.js:1744-1749 (dock layout, refresh) and 1911-1927 (launch, morning window, view nav); no target shared with the inits between
  initMap(); // app.js:1846 (resize: sizeMap)
  initTape(); // fleet D7: the event tape in #tape
  initAnnunciator(); // fleet D7: the alarm tiles in #ann
  initHotkeys(); // app.js:1856-1891 (keydown, outside click)
  initRouter(); // app.js:1909 (hashchange)
  initArchive(); // fleet R14: the Board's archive filter (#/board?s=archive)
  // The view registry (fleet D4): every route mounts its view through
  // views/index.js (router.js setView -> activateView). Built here, after the
  // modules have evaluated, so each view's default export is initialised.
  views();

  // Refresh the relative "since" labels without waiting for a delta.
  setInterval(() => {
    for (const [name, node] of cardNodes) {
      const s = store.sessions.get(name);
      const since = node.querySelector('.card-since');
      if (s && since) since.textContent = ago(s.stateSince);
    }
    renderAttention();
  }, 10000);

  // A ReferenceError anywhere used to leave the page blank with nothing on
  // screen to say why.
  addEventListener('error', (e) => reportUiError(e.message || 'script error', e.error));
  addEventListener('unhandledrejection', (e) => reportUiError(`unhandled: ${e.reason?.message || e.reason}`, e.reason));

  connect();
  // `#/` (or no hash) is the Map, the home view; legacy `#board`, `#map`, ...
  // and push links `#session=<name>` keep working (core/router.js parseHash).
  if (location.hash.startsWith('#session=')) {
    // The session may not be in the store yet on a cold load.
    addEventListener('load', applyHash);
    setView('board', { pushHash: false });
  } else {
    applyHash();
  }

  initPush(); // app.js:1953-2025 (push / PWA)
  initNotifyPrefs(); // fleet D14: hub-only notification prefs sheet, entry in #push-box
}

boot();
