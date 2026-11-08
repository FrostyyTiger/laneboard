// The galaxy for a reduced-motion screen (Wall plan night 2 T11, README D5):
// no flights, no turn, no drift. The camera stays on the overview with every
// cluster folded; the tour (tour.js, trouble first) still runs, but only the
// caption moves with it: each site leg shows that site's caption at once
// (caption.js STILL_CAPTION_TIMING) and the lock shuts round it where it lies
// on the overview, so the words rotate through the fleet and the picture
// stands still. Trouble glows at its brightest instead of breathing.
//
// Pure but createCutFade (test/wall-galaxy-still.test.mjs); galaxy/main.js, camera.js and
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

/** The dust's turn at `now` (radians): once in about 44 minutes (night 5 A6: 0.6x), none when `still`. */
export const dustTurn = (now, still = false) => (still ? 0 : now * 0.0000024);

/**
 * A finger's step in reduced motion (night 3 T14, README §7 Night 3 C5): no
 * flight, a cut, and the scene fades in from the canvas colour over `fadeMs`
 * so the jump reads as a new shot, not a glitch. Short: an opacity change,
 * nothing moves.
 */
export const CUT = Object.freeze({ fadeMs: 320 });

/** The scene's opacity `ms` after a cut: 0 at the cut, 1 from `fadeMs` on (eased out); 1 without a cut (`ms` null). Pure. */
export function cutFade(ms, fadeMs = CUT.fadeMs) {
  if (ms == null || !(fadeMs > 0) || ms >= fadeMs) return 1;
  const k = Math.max(0, ms) / fadeMs;
  return 1 - (1 - k) * (1 - k);
}

/**
 * The fade's driver: `createCutFade(els, { clock })` → `{ cut(), frame(now),
 * fading() }`. `cut()` starts a fade at `clock()`; `frame(now)` (once a frame,
 * the same clock) sets each element's opacity, and clears it once the fade
 * is over, so the scene is untouched between cuts.
 */
export function createCutFade(els, opts = {}) {
  const o = { clock: () => performance.now(), fadeMs: CUT.fadeMs, ...opts };
  const list = (els ?? []).filter(Boolean);
  let since = null;
  return {
    cut: () => { since = o.clock(); },
    frame: (now) => {
      if (since == null) return;
      const k = cutFade(now - since, o.fadeMs);
      if (k >= 1) since = null;
      for (const el of list) el.style.opacity = k >= 1 ? '' : k.toFixed(3);
    },
    fading: () => since != null,
  };
}
