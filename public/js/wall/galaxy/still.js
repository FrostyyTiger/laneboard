// The galaxy for a reduced-motion screen (Wall plan night 2 T11, README D5):
// no flights, no turn, no drift. The camera stays on the overview with every
// cluster folded; the tour (tour.js, trouble first) still runs, but only the
// caption moves with it: each site leg shows that site's caption at once
// (caption.js STILL_CAPTION_TIMING) and the lock shuts round it where it lies
// on the overview, so the words rotate through the fleet and the picture
// stands still. Trouble glows at its brightest instead of breathing.
//
// Pure (test/wall-galaxy-still.test.mjs); galaxy/main.js, camera.js and
// scene.js read it when `prefers-reduced-motion: reduce` matches.

/**
 * The tour's timing when nothing flies: the bare overview a short while,
 * then each site's caption ~12 s (long enough to read three metres away,
 * short enough that five sites come round in a minute). `flyMs` is 0, so
 * a leg's caption is there at once.
 */
export const STILL_TOUR_TIMING = Object.freeze({ overviewMs: 8000, flyMs: 0, holdMs: 12000, zoom: 2.3 });

/** `?demo=1` without motion: the same rotation, faster, for videos. */
export const STILL_DEMO_TOUR_TIMING = Object.freeze({ overviewMs: 2000, flyMs: 0, holdMs: 3000, zoom: 2.3 });

export const stillTourTimingFor = (demo) => (demo ? STILL_DEMO_TOUR_TIMING : STILL_TOUR_TIMING);

/** Whether the screen asks for reduced motion (`matchMedia` injectable for tests). */
export function prefersStill(matchMedia = globalThis.matchMedia) {
  try {
    return Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * The breathing of trouble at `now` (ms), -1..1, over `periodMs`; held at
 * its peak when `still` (trouble stays the brightest thing, it just stops
 * moving).
 */
export function breathWave(now, periodMs, still = false) {
  if (still) return 1;
  return Math.sin((now / periodMs) * Math.PI * 2);
}

/** The dust's turn at `now` (radians): once in about 26 minutes, none when `still`. */
export const dustTurn = (now, still = false) => (still ? 0 : now * 0.000004);
