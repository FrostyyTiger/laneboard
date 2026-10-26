// Type for a wall (docs/plans/wall/README.md §2, research Q3): label sizes
// from the distance they are read at, in mm on the glass, turned into CSS px
// for this screen and set on one 4:3 scale (11 · 15 · 20 · 26 · 35 · 47).
//
// A browser does not know how big a CSS px is. `pxPerMm` takes the screen's
// height in mm when the page is told it (`?mm=173`), else guesses from
// `devicePixelRatio`: a dense screen (2x and up) is the 12.3" tablet
// (10.5 device px per mm), anything else a desk monitor (24" 1080p, 3.6).
//
// Pure: no DOM, so test/wall-type.test.mjs imports it directly.

/** The type scale in CSS px: the Map's 11, then 4:3 steps. */
export const SCALE = Object.freeze([11, 15, 20, 26, 35, 47]);

/** Device px per mm of the two screens Q3 measured. */
export const DENSITY = Object.freeze({ tablet: 10.5, desk: 3.6 });

/** Barlow Condensed's cap height, in em (the label face, tokens.css --font-label). */
export const CAP_EM = 0.7;

/**
 * A caps name's width in CSS px at `px` in the label face, without a canvas:
 * the face is condensed, a caps character about 0.44 em (`OFFICE-PRINTER`
 * measures 97 px at 15 px on the tablet), plus the Map's tracking (render.js:
 * 6 % of the size a character, 1 px at least).
 */
export function textW(text, px) {
  return String(text ?? '').length * (0.44 * px + Math.max(1, Math.round(px * 0.06)));
}

/** One arc minute, in radians. */
const ARCMIN = Math.PI / (180 * 60);

/**
 * The cap height in mm that subtends `arcmin` at `metres` (Q3: 16' is the
 * floor for a short read, 20-22' comfortable).
 */
export function capMm(metres, arcmin = 16) {
  return metres * 1000 * Math.tan(arcmin * ARCMIN);
}

/**
 * CSS px per mm on this screen. `screenMm` (the screen's height in mm) wins
 * with `cssHeight` (its height in CSS px); otherwise the density guess from `dpr`.
 */
export function pxPerMm({ dpr = 1, cssHeight, screenMm } = {}) {
  if (Number.isFinite(screenMm) && screenMm > 0 && Number.isFinite(cssHeight) && cssHeight > 0) {
    return cssHeight / screenMm;
  }
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return (d >= 1.5 ? DENSITY.tablet : DENSITY.desk) / d;
}

/** The scale step nearest (in ratio) to the font size whose cap is `mm` tall at `ppm` CSS px per mm. */
export function stepFor(mm, ppm) {
  const want = (mm * ppm) / CAP_EM;
  if (!(want > 0)) return SCALE[0];
  let best = SCALE[0];
  for (const s of SCALE) if (Math.abs(Math.log(s / want)) < Math.abs(Math.log(best / want))) best = s;
  return best;
}

/**
 * Who reads which label from where. Sites are read from a metre, rooms at
 * arm's length (a tablet under a monitor): a 12.3" tablet carries no more
 * than that (Q3: the 3 m read is shape and colour, the trouble line, the
 * caption). Rooms at 0.6 m (20 px on the tablet) did not fit the radial's
 * 45 rooms: the collision pass pushed names off their nodes (round 35 still).
 */
export const READ = Object.freeze({
  site: Object.freeze({ metres: 1, arcmin: 16 }),
  room: Object.freeze({ metres: 0.45, arcmin: 16 }),
});

/** The label steps (CSS px) for a screen: `{site, room}`, site above room. */
export function stepsFor(ppm) {
  let site = stepFor(capMm(READ.site.metres, READ.site.arcmin), ppm);
  let room = stepFor(capMm(READ.room.metres, READ.room.arcmin), ppm);
  // One step apart at least, whatever the rounding did: the room keeps its
  // step where it can, the site goes up when the room is already the smallest.
  if (room >= site) {
    if (SCALE.indexOf(site) > 0) room = SCALE[SCALE.indexOf(site) - 1];
    else site = SCALE[1];
  }
  return Object.freeze({ site, room });
}

/** The screen the Wall is shown on, from the page: `{dpr, cssHeight, screenMm}`. */
export function screenOf(search, { dpr, cssHeight } = {}) {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === 'string' ? search : '');
  const mm = Number(q.get('mm'));
  return { dpr, cssHeight, screenMm: Number.isFinite(mm) && mm > 0 ? mm : undefined };
}
