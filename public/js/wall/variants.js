// Wall variants (docs/plans/wall/README.md §5): the layout directions night 1
// builds side by side, chosen with `wall.html?variant=<id>`, plus the
// `?demo=1` speed flag (the tour runs ~4 s per site, for filming).
//
// Pure: no DOM, so test/wall-variant.test.mjs imports it directly. Each
// direction's task adds its entry to VARIANTS with the Map options it needs
// (`mapOptions`, from its module in variants/; the page adds `ambient`), and
// may add `optionsFor(aspect, screen)` (the options for the screen's width / height
// and density, type.js `screenOf`)
// and `ambient` (its own ambient settings, over the Map's defaults),
// `halos` (glow.js trouble halos under the Map, T16), and
// `holdZoom(fitScale, zoom)` (the tour's zoom into a site, from the overview's
// scale and the timing's zoom, when its holds want a scale of their own).

import * as radial from './variants/radial.js';
import * as orbits from './variants/orbits.js';
import * as islands from './variants/islands.js';
import * as mosaic from './variants/mosaic.js';
import * as islandsTiles from './variants/islands-tiles.js';

/** The directions, in the order a morning report lists them. */
export const VARIANTS = Object.freeze([
  Object.freeze({
    id: 'radial', label: 'Radial', mapOptions: radial.mapOptions,
    optionsFor: radial.optionsFor, ambient: radial.ambient, halos: radial.halos, holdZoom: radial.holdZoom,
  }),
  Object.freeze({
    id: 'orbits', label: 'Orbits', mapOptions: orbits.mapOptions,
    optionsFor: orbits.optionsFor, ambient: orbits.ambient,
  }),
  Object.freeze({
    id: 'islands', label: 'Islands', mapOptions: islands.mapOptions,
    optionsFor: islands.optionsFor, ambient: islands.ambient,
  }),
  Object.freeze({
    id: 'mosaic', label: 'Mosaic', mapOptions: mosaic.mapOptions,
    optionsFor: mosaic.optionsFor, ambient: mosaic.ambient,
  }),
  // The galaxy's 2D fallback (README §5): where a browser without WebGL is
  // sent (galaxy/fallback.js). `links: 'focus'`: only the held site's links.
  Object.freeze({
    id: 'islands-tiles', label: 'Islands + tiles', mapOptions: islandsTiles.mapOptions,
    optionsFor: islandsTiles.optionsFor, ambient: islandsTiles.ambient, links: islandsTiles.links,
  }),
]);

/**
 * Names that are pages of their own, not a 2D layout: `wall.html?variant=galaxy`
 * opens `galaxy.html` (night 4 T45) instead of falling back to radial.
 */
export const PAGES = Object.freeze({ galaxy: 'galaxy.html' });

/**
 * Where `wall.html` with query `search` should go instead, or null to stay:
 * `?variant=<a page>` gives that page with every other switch kept (the
 * shared `?demo`, `?pace`, `?mm`; the galaxy's `?at`, `?fx`, `?role`, …).
 */
export function pageHref(search) {
  const q = new URLSearchParams(search instanceof URLSearchParams ? search : (typeof search === 'string' ? search : ''));
  const asked = q.get('variant');
  const key = typeof asked === 'string' ? asked.trim().toLowerCase() : '';
  if (!Object.hasOwn(PAGES, key)) return null;
  q.delete('variant');
  const rest = q.toString();
  return rest ? `${PAGES[key]}?${rest}` : PAGES[key];
}

/**
 * The tag's note when `?variant=` named nothing known (null otherwise):
 * `UNKNOWN VARIANT "X" · RADIAL`, so a mistyped address says so on the screen
 * instead of only in the console.
 */
export function unknownNote(pick) {
  if (pick?.asked == null || pick.asked === pick.id) return null;
  const asked = String(pick.asked).trim();
  if (!asked || asked.toLowerCase() === pick.id) return null;
  const shown = asked.length > 16 ? `${asked.slice(0, 15)}…` : asked;
  return `unknown variant "${shown}" · ${pick.id}`;
}

/**
 * The Map options a page creates its Map with for `variant` on a screen of
 * `aspect` (width / height): the variant's own, `ambient` its settings or on.
 * Link labels are off in every direction (T27: at 3 m they collide with names).
 * `screen` (type.js `screenOf`) is passed on for the type steps.
 */
export function mapOptionsFor(variant, aspect, screen) {
  const own = typeof variant?.optionsFor === 'function' && Number.isFinite(aspect) && aspect > 0
    ? variant.optionsFor(aspect, screen) : variant?.mapOptions;
  return { ...own, edgeLabels: false, ambient: variant?.ambient ?? true };
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
