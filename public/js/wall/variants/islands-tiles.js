// The 2D fallback (Wall plan night 2 T7, README §5 "Fallback"): islands with
// trouble as filled hex tiles (tiles.js), links only on the held site. The
// galaxy sends a browser without WebGL here (`wall.html?variant=islands-tiles`,
// once variants.js registers it with `links`). Not polished further.

import * as islands from './islands.js';
import { tiledOptions } from './tiles.js';

/** The tablet's aspect, as islands'. */
export const ASPECT = islands.ASPECT;

/** Islands' Map options for a screen of `aspect`, trouble tiles over its layout. */
export function optionsFor(aspect = ASPECT, screen) {
  return tiledOptions(islands, aspect, screen);
}

/** What `createMap` takes for this direction at the tablet's aspect. */
export const mapOptions = Object.freeze(optionsFor(ASPECT));

/** Islands' ambient settings: no turn. */
export const ambient = islands.ambient;
/** Which links the page draws: only the held site's (tiles.js `focusLinks`). */
export const links = 'focus';
