// The Diff view: a stub from the shell task (fleet D4). R11 (§10) replaces this
// file with the real view; the registry (views/index.js) picks up the default
// export as it is. Pure at import time; text via textContent only.
import { panel } from '../ui/components.js';

let root = null;

/** The scope shown in the panel title: the builder filter, or ALL. */
export function diffScope(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

export default {
  id: 'diff',
  icon: 'review',
  title: 'Diff',
  /** Render an empty `.panel` into the view's section. */
  mount: (el, ctx = {}) => {
    if (!el) return;
    el.textContent = '';
    const p = panel({ name: 'DIFF', scope: diffScope(ctx.route) });
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Select a lane to see its diff.';
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
