// The terminal sheet and its quick-bar. Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { STATE_LABEL } from '../core/format.js';
import { store } from '../core/store.js';
import { scheduleVisible, sendKeys, sendText } from '../core/net.js';
import { closeTerminal, isLive, openTerminal, writeTo } from './terminal.js';
import { toast } from './shell.js';

export function openSheet(name) {
  const s = store.sessions.get(name);
  if (!s) return;
  store.openSession = name;
  $('sheet-title').textContent = name;
  const pill = $('sheet-state');
  pill.className = `pill s-${s.state}`;
  pill.textContent = STATE_LABEL[s.state] || s.state;
  $('sheet').hidden = false;
  location.hash = `session=${encodeURIComponent(name)}`;
  openTerminal(name, $('sheet-body'));
  scheduleVisible();
}

export function closeSheet() {
  if (!store.openSession) return;
  closeTerminal(store.openSession, $('sheet-body'));
  store.openSession = null;
  $('sheet').hidden = true;
  // Back to the view's own hash, not to a bare path: closing a sheet opened
  // from a push notification should leave you on the Board, not nowhere.
  if (location.hash.startsWith('#session=')) history.replaceState(null, '', `#${store.view}`);
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

/** Prefer the open pty — it is instant. Fall back to tmux send-keys. */
export function sendQuick(name, spec, label) {
  if (isLive(name) && writeTo(name, spec.raw)) toast(`${label} → ${name}`);
  else sendKeys(name, spec.keys);
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
    const name = store.openSession;
    if (isLive(name) && writeTo(name, `${text}\r`)) toast(`Sent → ${name}`);
    else sendText(name, text);
    input.value = '';
  });
}
