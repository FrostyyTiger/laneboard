// The Inbox view: a stub from the shell task (fleet D4). C13 (§8) replaces this
// file with the real view; the registry (views/index.js) picks up the default
// export as it is. Pure at import time; text via textContent only.
import { panel } from '../ui/components.js';

let root = null;

/** The scope shown in the panel title: the builder filter, or ALL. */
export function inboxScope(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

export default {
  id: 'inbox',
  icon: 'inbox',
  title: 'Inbox',
  /** Render an empty `.panel` into the view's section. */
  mount: (el, ctx = {}) => {
    if (!el) return;
    el.textContent = '';
    const p = panel({ name: 'INBOX', scope: inboxScope(ctx.route) });
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Needs-you, approvals and reviews arrive here.';
    p.body.append(empty);
    el.append(p.root);
    root = { el, panel: p };
  },
  unmount: () => {
    if (root) root.el.textContent = '';
    root = null;
  },
  update: () => {},
};
