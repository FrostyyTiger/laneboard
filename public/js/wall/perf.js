// The Wall's frame counter (README §7.2): `window.__wallPerf = {frames,
// worstGapMs}`, counted after every drawn Map frame. The filmstrip tool
// (docs/plans/wall/loop/film.mjs) reads it twice and divides by the time
// between, so fps is what was really drawn under the CPU throttle.
//
// Pure: the caller passes the clock and says when the page was hidden (a
// hidden tab draws nothing, and that gap is not jank).

/** A counter object to expose as-is, and the two calls that feed it. */
export function createPerf() {
  const stats = { frames: 0, worstGapMs: 0 };
  let last = null;
  return {
    stats,
    /** One drawn frame at time `now` (ms). */
    frame: (now) => {
      stats.frames += 1;
      if (last != null) stats.worstGapMs = Math.max(stats.worstGapMs, Math.round(now - last));
      last = now;
    },
    /** The page was hidden or the Map stopped on purpose: the next gap does not count. */
    pause: () => { last = null; },
  };
}
