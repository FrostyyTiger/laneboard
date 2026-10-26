// The `radial` direction (docs/plans/wall/README.md §5): today's
// constellation, set for a wall. The layout is the Map's rings with the room
// moved inward: sites and rooms get the space their names need, the leaves
// (dots at a distance) give it up. At the overview only places are named, on two steps
// of one scale (sites big, rooms one step down); services and leaves are
// dots there, named once the camera is in their site. Trouble is always
// named, at least at the room step, so the words on the overview are the
// places and the problems.
//
// Pure: no DOM, so test/wall-radial.test.mjs imports it directly.

import { layout as ringLayout, RINGS } from '../../views/map/layout.js';
import { stepsFor, pxPerMm } from '../type.js';

/**
 * The ring radii on a wall, in the Map's world units (its RINGS: 0 150 290
 * 420 540 640). The outermost stays where it was, so the overview fits the
 * same; the site ring moves out a third (big names between it and the core),
 * the room ring a third (45 rooms around it on the large demo fleet), and
 * services, lanes and sessions, unnamed at the overview, close up outside.
 */
export const WALL_RINGS = Object.freeze([0, 200, 380, 490, 575, 650]);

/**
 * The Map's radial layout on WALL_RINGS: each node keeps its angle and its
 * stagger off the ring (RINGS[ring] to r), moved to the wall's radius, and
 * carries `ringR` so the ring hairlines follow. Same shape as layout.js `layout`.
 */
export function layout(nodes) {
  const lay = ringLayout(nodes);
  const pos = new Map();
  for (const [id, p] of lay.pos) {
    const ringR = WALL_RINGS[p.ring] ?? RINGS[p.ring] ?? 0;
    const r = p.ring === 0 ? 0 : ringR + (p.r - (RINGS[p.ring] ?? p.r));
    pos.set(id, { ...p, r, ringR, x: Math.cos(p.angle) * r, y: Math.sin(p.angle) * r });
  }
  return { ...lay, pos };
}

/** Above this map scale the camera is in a site (the Map names its depth there too). */
export const IN_SITE = 1.25;

/**
 * The type steps in CSS px on the tablet (2x, 10.5 device px per mm): from
 * the distance each is read at (type.js READ: sites at 1 m, rooms at 0.45 m,
 * 16 arc minutes of cap), on the 4:3 scale 11 · 15 · 20 · 26 · 35: 35 / 15,
 * two steps apart. A desk monitor gets 26 / 11 (`optionsFor` with its screen). `site` reads first,
 * `room` one step down or more, `near` for what the camera is in (the Map's
 * own sizes, so undefined).
 */
export const STEPS = Object.freeze({ site: 35, room: 15 });

/**
 * The steps mosaic is spaced for (round 11's 26 / 15):
 * its layout measures names at these sizes, so it keeps them until its
 * own task (T49) moves them to type.js.
 */
export const BASE_STEPS = Object.freeze({ site: 26, room: 15 });

const PLACE = new Set(['site', 'host']);
const ROOM = new Set(['room', 'repo', 'builder']);

/**
 * The Map's `labelSize` for this direction on `steps`: px for `node`'s name
 * at map scale `s` (`{px, inward}` for a site), 0 for no name, undefined for
 * the Map's own size. `trouble` is the Map's (status warn or worse, stuck,
 * or a ▲/■ rolled up into it).
 */
export function labelSizeFor(steps = STEPS) {
  return function labelSize(node, { s = 1, trouble = false } = {}) {
    const kind = node?.kind;
    // The core's name is the tag's, top right; under the core it sat among the sites'.
    if (kind === 'core') return 0;
    // A site's name faces the core, centred on it: pointing outward it would
    // land on its own rooms. A grouping the hub makes up (`__repos`) is no
    // place: the room step.
    if (PLACE.has(kind) && !String(node.id ?? '').startsWith('__')) return { px: steps.site, inward: true };
    if (PLACE.has(kind)) return steps.room;
    if (ROOM.has(kind)) return steps.room;
    if (s > IN_SITE) return trouble ? steps.room : undefined;
    return trouble ? steps.room : 0;
  };
}

/** The tablet's labelSize. */
export const labelSize = labelSizeFor(STEPS);

/** BASE_STEPS' labelSize, for the directions that borrow radial's. */
export const baseLabelSize = labelSizeFor(BASE_STEPS);

/**
 * What `createMap` takes for this direction, next to `{ ambient: true }`.
 * `pinLabels`: a name keeps its side and line while it is on screen (the
 * turn used to flip names across their node as it passed the vertical).
 */
export const mapOptions = Object.freeze({ layout, labelSize, pinLabels: true });

/**
 * The options for a screen (`screen`: `{dpr, cssHeight, screenMm}`, type.js
 * `screenOf`): the type steps from its density; the layout is the same at
 * every aspect.
 */
export function optionsFor(aspect, screen) {
  if (!screen) return mapOptions;
  return Object.freeze({ ...mapOptions, labelSize: labelSizeFor(stepsFor(pxPerMm(screen))) });
}
