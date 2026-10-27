// The Wall's frame counter (README §7.2): `window.__wallPerf = {frames,
// worstGapMs, bootGapMs}`, counted after every drawn Map frame. The filmstrip
// tool (docs/plans/wall/loop/film.mjs) reads it twice and divides by the time
// between, so fps is what was really drawn under the CPU throttle.
//
// The stutter number moves (night 4 T11): `worstGapMs` is the worst gap of
// the last ~10 s (`PERF.spanMs`, kept in one-second buckets), so a hitch
// that is over stops being reported; the boot's gaps (from the first drawn
// frame, which is the first model drawn, plus `PERF.bootMs`: shader compiles,
// the first label layout) are kept apart as `bootGapMs` and never count
// as stutter.
//
// Pure: the caller passes the clock and says when the page was hidden (a
// hidden tab draws nothing, and that gap is not jank).

/** How far back the worst gap looks, its bucket, and how long the boot lasts. */
export const PERF = Object.freeze({ spanMs: 10000, bucketMs: 1000, bootMs: 2000 });

/** A counter object to expose as-is, and the two calls that feed it. */
export function createPerf(opts = PERF) {
  const { spanMs, bucketMs, bootMs } = { ...PERF, ...opts };
  const stats = { frames: 0, worstGapMs: 0, bootGapMs: 0 };
  // The windowed worst: `[bucket index, worst gap in it]`, oldest first.
  const buckets = [];
  let last = null, first = null;
  return {
    stats,
    /** One drawn frame at time `now` (ms). */
    frame: (now) => {
      stats.frames += 1;
      if (first == null) first = now;
      if (last != null) {
        const gap = Math.round(now - last);
        if (now - first <= bootMs) stats.bootGapMs = Math.max(stats.bootGapMs, gap);
        else {
          const k = Math.floor(now / bucketMs);
          const top = buckets[buckets.length - 1];
          if (top && top[0] === k) top[1] = Math.max(top[1], gap);
          else buckets.push([k, gap]);
        }
      }
      const oldest = Math.floor((now - spanMs) / bucketMs);
      while (buckets.length && buckets[0][0] <= oldest) buckets.shift();
      let worst = 0;
      for (const b of buckets) if (b[1] > worst) worst = b[1];
      stats.worstGapMs = worst;
      last = now;
    },
    /** The page was hidden or the Map stopped on purpose: the next gap does not count. */
    pause: () => { last = null; },
  };
}
