// Where a browser without WebGL goes (Wall plan night 2 T7, README §5
// "Fallback"): the 2D page, islands with trouble tiles. `?demo=1` (the video
// speed) goes along; the galaxy's own switches (`at`, `open`, `fx`) do not.
//
// Pure: no DOM, so test/wall-tiles.test.mjs imports it directly.

/** The fallback's variant on wall.html. */
export const FALLBACK_VARIANT = 'islands-tiles';

const DEMO_OFF = new Set(['0', 'false', 'no', 'off']);

/**
 * Whether the query (URLSearchParams) asks for the demo speed: `?demo`,
 * `?demo=1` or any value but 0/false/no/off, as wall.html reads it
 * (variants.js `pickVariant`). Pure.
 */
export function demoAsked(q) {
  const d = q?.get?.('demo');
  return d != null && !DEMO_OFF.has(d.trim().toLowerCase());
}

/** The 2D page's address for the galaxy's query string `search`. */
export function fallbackHref(search = '') {
  const q = new URLSearchParams(search);
  const out = new URLSearchParams({ variant: FALLBACK_VARIANT });
  if (demoAsked(q)) out.set('demo', '1');
  return `wall.html?${out}`;
}

/**
 * True when a canvas from `makeCanvas()` gives a WebGL context: asked before
 * three.js is, so a browser without one goes to the 2D page without
 * three's console errors. The test context is given back at once.
 */
export function hasWebGL(makeCanvas) {
  try {
    const c = makeCanvas();
    const gl = c?.getContext?.('webgl2') ?? c?.getContext?.('webgl');
    if (!gl) return false;
    gl.getExtension?.('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
