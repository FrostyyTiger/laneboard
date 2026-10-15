// Keyboard shortcuts. Moved from public/app.js (fleet F1).
import { store } from '../core/store.js';
import { VIEW_KEYS, setView } from '../core/router.js';
import { togglePin } from './dock.js';
import { closeSheet, openSheet } from './sheet.js';
import { cardNodes, focusSession, orderedSessions } from '../views/board.js';
import { closeMenus } from '../views/board-card.js';

/**
 * True when the keystroke belongs to a terminal or a text field.
 * Claude Code uses Esc to interrupt, so while an xterm has focus EVERY key —
 * Escape included — must reach the session and none of the dashboard
 * shortcuts may fire. The sheet is closed with the X button (or Escape while
 * focus is outside the terminal).
 */
export function keyBelongsToTerminal(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('.xterm, .term-host, .sheet-body, .xterm-helper-textarea'));
}

/**
 * `g` starts a two-key view chord (g b / g m / g c / g k / g f). It expires
 * after a second so a stray g does not swallow the next real keystroke — and
 * `g k` has to win over the Board's `k`, which is why the chord is checked
 * before anything else.
 */
let pendingG = 0;

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('keydown', (e) => {
    if (keyBelongsToTerminal(e.target)) return;
    if (e.target.matches('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (pendingG && Date.now() - pendingG < 1000) {
      pendingG = 0;
      const view = VIEW_KEYS[e.key];
      if (view) { setView(view); e.preventDefault(); return; }
    }
    pendingG = 0;
    if (e.key === 'g') { pendingG = Date.now(); e.preventDefault(); return; }

    if (e.key === 'Escape') { closeMenus(); closeSheet(); return; }
    // Everything below moves a cursor through cards, so it only means anything
    // on the Board.
    if (store.view !== 'board') return;
    if (e.key >= '1' && e.key <= '9') {
      const a = store.attention[Number(e.key) - 1];
      if (a) { focusSession(a.key); e.preventDefault(); }
      return;
    }
    const list = orderedSessions().map((s) => s.key);
    if (!list.length) return;
    const i = list.indexOf(store.cursor);
    if (e.key === 'j') { store.cursor = list[Math.min(list.length - 1, i + 1)] ?? list[0]; e.preventDefault(); }
    else if (e.key === 'k') { store.cursor = list[Math.max(0, i - 1)] ?? list[0]; e.preventDefault(); }
    else if (e.key === 'Enter' && store.cursor) { openSheet(store.cursor); e.preventDefault(); return; }
    else if (e.key === 'p' && store.cursor) { togglePin(store.cursor); e.preventDefault(); return; }
    else return;

    for (const [k, node] of cardNodes) node.classList.toggle('cursor', k === store.cursor);
    cardNodes.get(store.cursor)?.scrollIntoView({ block: 'nearest' });
  });

  addEventListener('click', (e) => { if (!e.target.closest?.('.menu, .btn-more')) closeMenus(); });
}
