// The terminal sheet and its quick-bar. Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { STATE_LABEL } from '../core/format.js';
import { store } from '../core/store.js';
import { currentRoute, formatHash } from '../core/router.js';
import { scheduleVisible, sendKeys, sendText } from '../core/net.js';
import { closeTerminal, isLive, openTerminal, writeTo } from './terminal.js';
import { toast } from './shell.js';

/**
 * The hash that names an open sheet: `#/board?sel=<fkey>`, the form a push
 * notification opens, keeping the route's filters (b, s, q). A selection
 * routes to the Board (core/router.js applyHash), so the hash says so too.
 */
export function sheetHash(k, route) {
  return formatHash({ ...(route ?? currentRoute()), view: 'board', sel: k, open: null });
}

/** `k`: a session's fleet key (store.sessions index key). */
export function openSheet(k) {
  const s = store.sessions.get(k);
  if (!s) return;
  const already = store.openSession === k && !$('sheet').hidden;
  store.openSession = k;
  $('sheet-title').textContent = s.name;
  $('sheet-title').title = store.builders.size > 1 && s.builder ? s.builder : '';
  const pill = $('sheet-state');
  pill.className = `pill s-${s.state}`;
  pill.textContent = STATE_LABEL[s.state] || s.state;
  $('sheet').hidden = false;
  // Opening the sheet writes `sel`; the hashchange this causes routes back
  // here, and the terminal is not opened twice.
  const want = sheetHash(s.key);
  if (location.hash !== want) location.hash = want;
  if (!already) openTerminal(k, $('sheet-body'));
  scheduleVisible();
}

export function closeSheet() {
  if (!store.openSession) return;
  closeTerminal(store.openSession, $('sheet-body'));
  store.openSession = null;
  $('sheet').hidden = true;
  // Closing removes `sel`: back to the view's own hash, not to a bare path,
  // so a sheet opened from a push notification leaves you on the Board.
  const h = location.hash || '';
  if (h.startsWith('#session=')) history.replaceState(null, '', `#${store.view}`);
  else if (h.includes('sel=')) history.replaceState(null, '', formatHash({ ...currentRoute(), view: store.view, sel: null, open: null }));
  scheduleVisible();
}

// Claude's prompts are numbered menus, so "Yes" is 1 then Enter.
export const QUICK_KEYS = {
  yes: { raw: '1\r', keys: ['1', 'Enter'] },
  no: { raw: '\x1b', keys: ['Escape'] },
  esc: { raw: '\x1b', keys: ['Escape'] },
  enter: { raw: '\r', keys: ['Enter'] },
  'ctrl-c': { raw: '\x03', keys: ['C-c'] },
};

/** A session's display name for a toast: the local name behind a fleet key. */
function shownName(k) {
  return store.sessions.get(k)?.name ?? k;
}

/** Prefer the open pty — it is instant. Fall back to tmux send-keys. `k`: a fleet key. */
export function sendQuick(k, spec, label) {
  if (isLive(k) && writeTo(k, spec.raw)) toast(`${label} → ${shownName(k)}`);
  else sendKeys(k, spec.keys);
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  // ---------------------------------------------------------------- input

  $('sheet-close').onclick = closeSheet;

  $('quickbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn || !store.openSession) return;
    const spec = QUICK_KEYS[btn.dataset.key];
    if (spec) sendQuick(store.openSession, spec, btn.textContent);
  });

  $('qb-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('qb-input');
    const text = input.value.trim();
    if (!text || !store.openSession) return;
    const k = store.openSession;
    if (isLive(k) && writeTo(k, `${text}\r`)) toast(`Sent → ${shownName(k)}`);
    else sendText(k, text);
    input.value = '';
  });
}
