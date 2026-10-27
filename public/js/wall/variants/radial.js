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
import { runRound } from '../../views/map/overlays.js';
import { stepsFor, pxPerMm, textW } from '../type.js';

/**
 * The ring radii on a wall, in the Map's world units (its RINGS: 0 150 290
 * 420 540 640). The outermost stays about where it was; the site ring moves
 * out to nearly double (big names between it and the core), the room ring by
 * 60 % (45 rooms around it on the large demo fleet), and services, lanes and
 * sessions, unnamed at the overview, close up outside. The overview fits the
 * outer rings to the safe area (`fitBounds`, T17), so every world unit the
 * outside gives up is screen the sites and rooms get: at 0.51 on the tablet
 * the room ring is as wide on the glass as it was at the old full-screen fit.
 */
export const WALL_RINGS = Object.freeze([0, 280, 470, 535, 580, 625]);

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

/**
 * The share of the screen kept clear at each edge at the overview (T17): 6 %
 * at the sides, 8 % at the top, and at the bottom the band the frame's clock
 * and fleet line stand in (T9: 8vh up from the bottom, the fleet line's two
 * lines about 7.5vmin above that). What is drawn fits the rectangle left.
 */
export const SAFE = Object.freeze({ side: 0.06, top: 0.08, bottom: 0.16 });

/**
 * The Map's ambient settings for this direction: the view's centre (the
 * turn's) in the middle of the safe rectangle, not of the screen, so the
 * constellation turns in place above the bottom band.
 */
export const ambient = Object.freeze({ centerY: SAFE.top + (1 - SAFE.top - SAFE.bottom) / 2 });

/** The safe area as the Map's `labelInset`: the collision pass moves a name only inside it. */
export const LABEL_INSET = Object.freeze({ top: SAFE.top, right: SAFE.side, bottom: SAFE.bottom, left: SAFE.side });

/** The screen a layout is planned for when the page does not say (the tablet at 1368 x 912 CSS px). */
export const REF = Object.freeze({ aspect: 1.5, cssHeight: 912 });

/**
 * What a node draws around its centre at the overview, in screen px: its
 * rings and marks (render.js ringOuter, a builder's square the widest); a
 * name starts 6 px past them (render.js drawLabels).
 */
const NODE_PX = 20;
const NAME_GAP = 6;
/** Room for what the estimate does not see: tracking rounding, a run's round, a fold plate. */
const SLACK = 10;
/** The bearing dial outside the outermost ring hairline (render.js: 26 px out) and its numbers. */
const DIAL_PX = 26 + 14;
/** Bearings the turn is checked at: every 5°. */
const BEARINGS = 72;

/** The name a node is drawn with (render.js builderName: a builder by its builder name). */
const nameOf = (n) => String((n?.kind === 'builder' ? n.builder : null) ?? n?.label ?? n?.id ?? '');

/**
 * What a node draws past its centre at the overview, in screen px:
 * `{ ring, w, half }`, its rings, and the width and half line of the name
 * it carries there or could carry (trouble names any node at the room step,
 * and trouble comes and goes: the fit must not jump when it does). A site's
 * name points inward, so only its rings count; the core is the tag's.
 */
export function reachOf(node, steps = STEPS) {
  const kind = node?.kind;
  const none = { ring: NODE_PX, w: 0, half: 0 };
  if (kind === 'core') return none;
  if (PLACE.has(kind) && !String(node.id ?? '').startsWith('__')) return none;
  const px = labelSizeFor(steps)(node, { s: 1, trouble: true });
  const step = typeof px === 'object' ? px.px : px;
  if (!(step > 0)) return none;
  // A run's round rides after its name (render.js: 7 px a character and 8).
  const round = kind === 'run' ? runRound(node) : null;
  const extra = round ? round.length * 7 + 8 : 0;
  return { ring: NODE_PX, w: textW(nameOf(node).toUpperCase(), step) + extra + SLACK, half: Math.round(step * 0.64) };
}

/**
 * The overview's fit for a laid-out fleet on a screen (`aspect` width /
 * height, `cssHeight` in CSS px): the largest scale at which every node,
 * with its rings and its name, lies inside the safe rectangle at every
 * bearing the turn carries it through. A name runs sideways from its
 * anchor (render.js drawLabels: out past the rings, then its width away
 * from the core), so at 3 or 9 o'clock it takes the width it has, at 12 or
 * 6 its line. Returned as the Map's `bounds` (world half extents, polarLayout)
 * and `safe`, the rectangle on screen around the view's centre, for tests.
 */
export function fitBounds(pos, byId, { aspect = REF.aspect, cssHeight = REF.cssHeight, steps = STEPS } = {}) {
  const H = cssHeight, W = aspect * H;
  const X = W * (0.5 - SAFE.side), Y = (H * (1 - SAFE.top - SAFE.bottom)) / 2;
  let k = Infinity, outer = 0;
  for (const [id, p] of pos) {
    outer = Math.max(outer, p.ringR ?? 0);
    const r = Math.hypot(p.x, p.y);
    if (!(r > 0)) continue;
    const { ring, w, half } = reachOf(byId.get(id), steps);
    k = Math.min(k, (Math.min(X, Y) - ring) / r);
    if (!w) continue;
    for (let i = 0; i < BEARINGS / 4; i++) {
      // A quarter is enough: the rectangle is symmetric about the view's centre.
      const t = (i / BEARINGS) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const anchor = ring + NAME_GAP + half * s;
      if (c > 1e-6) k = Math.min(k, (X - anchor * c - w) / (r * c));
      if (s > 1e-6) k = Math.min(k, (Y - anchor * s - half) / (r * s));
    }
  }
  if (outer > 0) k = Math.min(k, (Math.min(X, Y) - DIAL_PX) / outer);
  if (!(k > 0) || !Number.isFinite(k)) k = 1;
  return { x: W / (2 * k), y: H / (2 * k), cy: 0, safe: { x: X, y: Y, k } };
}

/**
 * `layout` with the overview's fit for a screen: the same positions, plus
 * `bounds`, so the Map fits the drawn nodes and their names into the safe
 * rectangle rather than the outer ring into the whole screen.
 */
export function layoutFor({ aspect = REF.aspect, cssHeight = REF.cssHeight, steps = STEPS } = {}) {
  return function fitted(nodes) {
    const lay = layout(nodes);
    const byId = new Map((nodes ?? []).map((n) => [n?.id, n]));
    const { x, y, cy } = fitBounds(lay.pos, byId, { aspect, cssHeight, steps });
    return { ...lay, bounds: { x, y, cy } };
  };
}

/**
 * The scale a hold is drawn at (world to screen px): what the tour's 2.3 gave
 * on the tablet while the overview fitted the outer ring to the whole
 * screen (0.63). The overview now fits a smaller safe area, so the tour flies
 * further in to hold the site as big as before, and services are named there
 * (IN_SITE).
 */
export const HOLD_SCALE = 1.45;

/**
 * The tour's zoom into a site for an overview at `fitScale`: HOLD_SCALE's,
 * never less than the timing's `zoom`, within the Map's 6.
 */
export function holdZoom(fitScale, zoom = 2.3) {
  if (!(fitScale > 0)) return zoom;
  return Math.min(6, Math.max(zoom, HOLD_SCALE / fitScale));
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

/** The share of a branch a stub keeps at the overview (T19): a short tick off the child, toward its parent. */
export const STUB = 0.25;
/** Below this map scale a branch is a stub; it grows to the full branch by IN_SITE. */
export const STUB_UNTIL = 0.8;

/**
 * The Map's `branch` for this direction (T19, r9-film-ui #8): at the overview
 * a branch below a site is a stub off the child, so fifteen rooms do not meet
 * in one hairball at their site; as the camera flies in (map scale from
 * STUB_UNTIL to IN_SITE) the branches grow back to their parent, and in a
 * site the fan is whole: the reveal. The core's spokes to the sites stay.
 */
export function branch(child, parent, { s = 1 } = {}) {
  if (!parent || parent.kind === 'core') return 1;
  const t = Math.min(1, Math.max(0, (s - STUB_UNTIL) / (IN_SITE - STUB_UNTIL)));
  const e = t * t * (3 - 2 * t);
  return STUB + (1 - STUB) * e;
}

/**
 * What `createMap` takes for this direction, next to `{ ambient: true }`.
 * `pinLabels`: a name keeps its side and line while it is on screen (the
 * turn used to flip names across their node as it passed the vertical).
 * `labelInset`: the collision pass keeps names inside the safe area (T17).
 * `legends` and `lamps` off (T18): the ring legends (`ROOM · REPO`) and the
 * lamp strip under a builder's name are desk chrome, 4 px specks from across
 * the room; a builder's trouble is still its mark, a stuck lane its ▲. The
 * ring hairlines and the bearing dial stay: they say "instrument".
 * `gauges: 'trouble'` and `branch` (T19, r9-film-ui #6, #8): the cpu/mem
 * rings were the same double halo on eighty nodes; now a calm room is a plain
 * dot and a site its ring, and the gauges mark "look here" (trouble, the site
 * the camera is in, a metric past the warn line). Branches are stubs at the
 * overview (`branch`).
 * `labelClear` (T46, the night 4 film of wall.html): at the ring's top a
 * builder's name and its lanes' lay on each other, and in a hold the rooms'
 * names on their neighbours'; a name now steps by its own line, and a calm one
 * with no free place is left out (trouble is always named).
 */
export const mapOptions = Object.freeze({
  layout: layoutFor(), labelSize, pinLabels: true, labelInset: LABEL_INSET, legends: false, lamps: false,
  gauges: 'trouble', branch, labelClear: true,
});

/**
 * Trouble halos on the glow layer (glow.js `HALO`, T16): at the overview a
 * crit node is the one saturated area; a waiting lane keeps to its ▲.
 */
export const halos = true;

/**
 * The options for a screen (`screen`: `{dpr, cssHeight, screenMm}`, type.js
 * `screenOf`): the type steps from its density, the overview's fit from its
 * shape and height (the positions are the same at every aspect).
 */
export function optionsFor(aspect, screen) {
  if (!screen) return Object.freeze({ ...mapOptions, layout: layoutFor({ aspect }) });
  const steps = stepsFor(pxPerMm(screen));
  const cssHeight = Number.isFinite(screen.cssHeight) && screen.cssHeight > 0 ? screen.cssHeight : REF.cssHeight;
  return Object.freeze({ ...mapOptions, layout: layoutFor({ aspect, cssHeight, steps }), labelSize: labelSizeFor(steps) });
}
