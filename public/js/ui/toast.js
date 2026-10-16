// Toasts (plan §4 2.5): a stack of at most 3 in #toast, bottom-right above the
// tape, 4 s (err 8 s), fading by opacity only. `toast(msg, {kind, action})`
// keeps the old name; ui/shell.js re-exports it once the shell switches over.
//
// Pure at import time. toastKind/toastDuration/stackAfter are tested in
// test/components.test.mjs. The message is text (textContent), never markup.
import { lamp } from './components.js';

export const TOAST_MAX = 3;
export const TOAST_MS = Object.freeze({ info: 4000, ok: 4000, err: 8000 });
/** The fade-out, matched to --dur (120 ms). */
const FADE_MS = 120;
const KINDS = new Set(['info', 'ok', 'err']);

/** Any kind -> 'info' | 'ok' | 'err' ('error' and 'warn' count as err). */
export function toastKind(kind) {
  const k = String(kind ?? 'info').toLowerCase();
  if (KINDS.has(k)) return k;
  if (k === 'error' || k === 'warn' || k === 'fail') return 'err';
  return 'info';
}

export function toastDuration(kind) {
  return TOAST_MS[toastKind(kind)];
}

/**
 * The stack after pushing `id` onto `ids` (oldest first): which stay and
 * which must go so at most `max` are shown.
 */
export function stackAfter(ids, id, max = TOAST_MAX) {
  const all = [...(Array.isArray(ids) ? ids : []), id];
  const cut = Math.max(0, all.length - max);
  return { keep: all.slice(cut), drop: all.slice(0, cut) };
}

/** The #toast container, upgraded to the stacking `.toasts` region. */
function container(root) {
  const c = root ?? document.getElementById('toast');
  if (!c) return null;
  if (!c.classList.contains('toasts')) {
    c.classList.add('toasts');
    c.textContent = '';
  }
  c.setAttribute('aria-live', 'polite');
  c.hidden = false;
  return c;
}

function dismiss(node) {
  if (!node || node.dataset.out) return;
  node.dataset.out = '1';
  clearTimeout(node.lbTimer);
  node.classList.add('is-out');
  setTimeout(() => node.remove(), FADE_MS);
}

/**
 * Show a toast. kind 'info' | 'ok' | 'err'; action {label, run} adds a button.
 * Returns {node, close}. `root` and `timeout` exist for the kit page and tests.
 */
function showToast(msg, { kind = 'info', action = null, root = null, timeout = null } = {}) {
  const c = container(root);
  if (!c) return { node: null, close() {} };
  const k = toastKind(kind);
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = k;
  if (k === 'err') node.setAttribute('role', 'alert');
  if (k === 'err') node.appendChild(lamp('1', { label: 'error' }));
  else if (k === 'ok') node.appendChild(lamp('ok', { label: 'ok' }));
  const text = document.createElement('span');
  text.className = 'toast-m';
  text.textContent = String(msg ?? '');
  node.appendChild(text);
  if (action && typeof action.run === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--s';
    b.textContent = String(action.label ?? 'OK');
    b.addEventListener('click', () => { dismiss(node); action.run(); });
    node.appendChild(b);
  }
  const live = [...c.querySelectorAll('.toast:not(.is-out)')];
  const { drop } = stackAfter(live, node);
  for (const old of drop) dismiss(old);
  c.appendChild(node);
  const ms = Number.isFinite(timeout) ? timeout : toastDuration(k);
  if (ms > 0) node.lbTimer = setTimeout(() => dismiss(node), ms);
  return { node, close: () => dismiss(node) };
}

export { showToast as toast };
