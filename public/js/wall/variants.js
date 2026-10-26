// Wall variants (docs/plans/wall/README.md §5): the layout directions night 1
// builds side by side, chosen with `wall.html?variant=<id>`, plus the
// `?demo=1` speed flag (the tour runs ~4 s per site, for filming).
//
// Pure: no DOM, so test/wall-variant.test.mjs imports it directly. Each
// direction's task adds its entry to VARIANTS with the Map options it needs
// (`mapOptions`, from its module in variants/; the page adds `ambient`), and
// may add `optionsFor(aspect)` (the options for the screen's width / height)
// and `ambient` (its own ambient settings, over the Map's defaults).

import * as radial from './variants/radial.js';
import * as orbits from './variants/orbits.js';

/** The directions, in the order a morning report lists them. */
export const VARIANTS = Object.freeze([
  Object.freeze({ id: 'radial', label: 'Radial', mapOptions: radial.mapOptions }),
  Object.freeze({
    id: 'orbits', label: 'Orbits', mapOptions: orbits.mapOptions,
    optionsFor: orbits.optionsFor, ambient: orbits.ambient,
  }),
]);

/**
 * The Map options a page creates its Map with for `variant` on a screen of
 * `aspect` (width / height): the variant's own, `ambient` its settings or on.
 */
export function mapOptionsFor(variant, aspect) {
  const own = typeof variant?.optionsFor === 'function' && Number.isFinite(aspect) && aspect > 0
    ? variant.optionsFor(aspect) : variant?.mapOptions;
  return { ...own, ambient: variant?.ambient ?? true };
}

/** What an unknown or missing `?variant=` falls back to. */
export const DEFAULT_VARIANT = 'radial';

const OFF = new Set(['0', 'false', 'no', 'off']);

/**
 * The variant and flags a page URL asks for. `search` is `location.search`
 * (with or without `?`) or a URLSearchParams. Returns
 * `{ id, variant, demo, asked }`: `variant` is the registry entry, `asked`
 * the raw `?variant=` (null when missing), so a page can say it fell back.
 * `demo` is on for `?demo`, `?demo=1` or any value but 0/false/no/off.
 */
export function pickVariant(search, registry = VARIANTS) {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === 'string' ? search : '');
  const asked = q.get('variant');
  const key = typeof asked === 'string' ? asked.trim().toLowerCase() : '';
  const variant = registry.find((v) => v.id === key)
    ?? registry.find((v) => v.id === DEFAULT_VARIANT)
    ?? registry[0];
  const d = q.get('demo');
  const demo = d != null && !OFF.has(d.trim().toLowerCase());
  return { id: variant.id, variant, demo, asked };
}
