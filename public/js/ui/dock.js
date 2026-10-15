// The pinned dock. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { savePinned, store } from '../core/store.js';
import { scheduleVisible } from '../core/net.js';
import { closeTerminal, openTerminal } from './terminal.js';
import { renderGrid } from '../views/board.js';

// ---------------------------------------------------------------- dock, sheet, actions

export function renderDock() {
  const body = $('dock-body');
  // Pins are fleet keys; a pin whose session is gone stays pinned (it comes
  // back with its session) but takes no pane.
  const names = [...store.pinned].filter((k) => store.sessions.has(k)).slice(0, 4);
  $('dock-count').textContent = String(names.length);
  // One or two pins get the dock's full width — a 2x2 grid would waste half of
  // it and leave the terminal too narrow. Three or four fall back to 2x2.
  const autoStacked = names.length <= 2;
  body.classList.toggle('stacked', store.dockLayout === null ? autoStacked : store.dockLayout);
  $('dock-layout').title = store.dockLayout === null
    ? `Layout: auto (${autoStacked ? 'stacked' : '2x2'}) — click to override`
    : `Layout: ${store.dockLayout ? 'stacked' : '2x2'} — click to cycle`;

  const existing = new Set();
  for (const pane of body.querySelectorAll('.term-pane')) {
    if (names.includes(pane.dataset.key)) existing.add(pane.dataset.key);
    else { closeTerminal(pane.dataset.key); pane.remove(); }
  }
  const emptyMsg = body.querySelector('.empty');
  if (names.length && emptyMsg) emptyMsg.remove();
  if (!names.length && !emptyMsg) {
    body.append(el('p', 'empty', 'Pin a session to watch it live here.'));
    return;
  }
  for (const k of names) {
    if (existing.has(k)) continue;
    const s = store.sessions.get(k);
    const pane = el('div', 'term-pane');
    pane.dataset.key = k;
    const head = el('div', 'term-head');
    head.append(el('span', 'nm', paneLabel(s, k)));
    const un = el('button', 'icon-btn', '✕');
    un.title = 'Unpin';
    un.onclick = () => togglePin(k);
    head.append(un);
    const host = el('div', 'term-host');
    pane.append(head, host);
    body.append(pane);
    openTerminal(k, host);
  }
}

/** A pane's title: the local name, with the builder when there are several. */
export function paneLabel(s, k) {
  const name = s?.name ?? k;
  return store.builders.size > 1 && s?.builder ? `${s.builder} · ${name}` : name;
}

/** `k`: a session's fleet key. */
export function togglePin(k) {
  if (store.pinned.has(k)) store.pinned.delete(k);
  else store.pinned.add(k);
  savePinned();
  renderGrid([k]);
  renderDock();
  scheduleVisible();
}
