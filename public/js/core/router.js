// Views and the hash router. Moved from public/app.js (fleet F1).
import { $ } from './dom.js';
import { store } from './store.js';
import { scheduleVisible } from './net.js';
import { fitAll } from '../ui/terminal.js';
import { openSheet } from '../ui/sheet.js';
import { loadMorning } from '../views/morning.js';
import { loadCredit } from '../views/credit.js';
import { renderBox } from '../views/box.js';
import { showMap } from '../views/map.js';

// ---------------------------------------------------------------- views
//
// Four views, one page, hash-routed. The Board keeps every behaviour it had;
// the others are sections that are simply hidden. Nothing is torn down when a
// view is hidden, so switching back is instant and the terminals in the dock
// survive — but an IntersectionObserver reports a display:none subtree as
// off-screen, so the capture-pane rate drops on its own while you are elsewhere.
// v3: Machine and Files are gone. A stale #machine or #files is not in VIEWS,
// so it lands on the Board.
export const VIEWS = ['board', 'morning', 'credit', 'box', 'map'];
export const VIEW_KEYS = { b: 'board', m: 'morning', c: 'credit', x: 'box', p: 'map' };

export function setView(name, { pushHash = true } = {}) {
  const view = VIEWS.includes(name) ? name : 'board';
  store.view = view;
  for (const v of VIEWS) {
    const node = $(`view-${v}`);
    if (node) node.hidden = v !== view;
  }
  for (const btn of document.querySelectorAll('.view-tab, .tab')) {
    btn.classList.toggle('on', btn.dataset.view === view);
  }
  if (pushHash && !store.openSession) {
    const want = `#${view}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  if (view === 'morning') loadMorning();
  if (view === 'credit') loadCredit();
  if (view === 'box') renderBox();
  if (view === 'map') showMap();
  scheduleVisible();
  fitAll();
}

/**
 * One route parser for the load path and for hashchange.
 * `#session=<name>` is the push notification's deep link: it must always land
 * on the Board with the sheet open, whatever view was last shown.
 */
export function applyHash() {
  const m = /^#session=(.+)$/.exec(location.hash);
  if (m) {
    setView('board', { pushHash: false });
    openSheet(decodeURIComponent(m[1]));
    return;
  }
  const view = location.hash.replace(/^#/, '');
  setView(VIEWS.includes(view) ? view : 'board', { pushHash: false });
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('hashchange', applyHash);
}
