// The pinned dock. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { savePinned, store } from '../core/store.js';
import { scheduleVisible } from '../core/net.js';
import { closeTerminal, openTerminal } from './terminal.js';
import { renderGrid } from '../views/board.js';

// ---------------------------------------------------------------- dock, sheet, actions

export function renderDock() {
  const body = $('dock-body');
  const names = [...store.pinned].filter((n) => store.sessions.has(n)).slice(0, 4);
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
    if (names.includes(pane.dataset.name)) existing.add(pane.dataset.name);
    else { closeTerminal(pane.dataset.name); pane.remove(); }
  }
  const emptyMsg = body.querySelector('.empty');
  if (names.length && emptyMsg) emptyMsg.remove();
  if (!names.length && !emptyMsg) {
    body.append(el('p', 'empty', 'Pin a session to watch it live here.'));
    return;
  }
  for (const name of names) {
    if (existing.has(name)) continue;
    const pane = el('div', 'term-pane');
    pane.dataset.name = name;
    const head = el('div', 'term-head');
    head.append(el('span', 'nm', name));
    const un = el('button', 'icon-btn', '✕');
    un.title = 'Unpin';
    un.onclick = () => togglePin(name);
    head.append(un);
    const host = el('div', 'term-host');
    pane.append(head, host);
    body.append(pane);
    openTerminal(name, host);
  }
}

export function togglePin(name) {
  if (store.pinned.has(name)) store.pinned.delete(name);
  else store.pinned.add(name);
  savePinned();
  renderGrid([name]);
  renderDock();
  scheduleVisible();
}
