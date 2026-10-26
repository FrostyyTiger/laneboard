// Sketch: orbits with mosaic's trouble tiles and the hub named in the middle (tiles.js).
import * as orbits from './orbits.js';
import { withTiles } from './tiles.js';

const v = withTiles(orbits, { sunName: 22 });
export const { optionsFor, mapOptions, ambient } = v;
