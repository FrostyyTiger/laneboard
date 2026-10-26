// Sketch: islands with mosaic's trouble tiles (tiles.js).
import * as islands from './islands.js';
import { withTiles } from './tiles.js';

const v = withTiles(islands);
export const { optionsFor, mapOptions, ambient } = v;
