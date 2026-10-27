// How the cockpit fits the screen it is on (cockpit spec c1-talk.md §1.2, D249, D250):
// the pane's width by the viewport, the size floor, and the browser floor. Pure, so
// node:test reads the same rules the page uses.
//
//   paneFit(innerWidth, innerHeight)  'side' | 'full' | 'none'
//   tooOld(win)                       true when the cockpit cannot run in this browser
import { FULL_PANE_BELOW_W, FLOOR_W, FLOOR_H } from '../core/cockpit-constants.js';

/**
 * c1-talk.md §1.2's table, on the layout viewport (so the on-screen keyboard never
 * trips the floor): `side` the right 608 px with the view usable left of it, `full`
 * the whole width with the view behind `inert` (D249), `none` below the floor, where
 * neither corner control is drawn (D250).
 */
export function paneFit(w, h) {
  const width = Number(w) || 0;
  const height = Number(h) || 0;
  if (width < FLOOR_W || height < FLOOR_H) return 'none';
  if (width < FULL_PANE_BELOW_W) return 'full';
  return 'side';
}

/**
 * D250: the page checks features, never the version. Without `WebSocket`, CSS `min()`
 * or the `inert` attribute the pane only says the browser is too old and opens no link.
 */
export function tooOld(win = globalThis) {
  if (typeof win?.WebSocket !== 'function') return true;
  const css = win.CSS;
  if (typeof css?.supports !== 'function' || !css.supports('width', 'min(1px, 100vw)')) return true;
  const he = win.HTMLElement;
  if (typeof he !== 'function' || !('inert' in he.prototype)) return true;
  return false;
}

/** c1-talk.md §1.2's line for a browser below the floor (D250). */
export const TOO_OLD_TEXT = 'This browser is too old for the cockpit. It needs Chrome 108 or Safari 16 or newer.';
