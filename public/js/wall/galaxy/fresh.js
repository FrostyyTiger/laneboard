// Is the galaxy's data still coming (Wall plan night 3 T5, README §7 Night 3
// B: a dead feed looks dead)? Pure, so test/wall-galaxy-fresh.test.mjs walks
// it on a fake clock.
//
// A hub sends a `map` frame on /ws at every change and again every 10 s
// when nothing changed (a builder every 5 s, server/map.mjs `emit`), so 30 s
// without one is three missed resends: the page is showing old data.
//   live   the socket is open and the last frame is younger than `staleMs`
//   stale  the socket is open, but no frame for `staleMs` or longer
//   dead   the socket is closed (galaxy/main.js retries with a backoff)
// `text` is the tag's word (`LIVE`, `STALE 2M`, `OFFLINE 40S`); `line` is the
// caption's grey line once the data is old (`''` while it is not).

/** After how long without a map frame the data counts as old. */
export const FRESH = Object.freeze({ staleMs: 30000 });

/**
 * How old, in the tag's words: `30S`, `40S` (tens of seconds, so the tag
 * does not tick every second), `2M`, `1H`. Pure.
 */
export function ageText(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${Math.floor(s / 10) * 10}S`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}M`;
  return `${Math.floor(m / 60)}H`;
}

/**
 * The feed's state at `now` for a last map frame at `lastFrameAt` (ms, or
 * null before the first) and the socket's `open`: `{ state, ageMs, text,
 * line }`. Before any frame the age is null and the tag says only `LIVE` or
 * `OFFLINE`. Pure.
 */
export function freshness(lastFrameAt, now, { open = true, staleMs = FRESH.staleMs } = {}) {
  const ageMs = Number.isFinite(lastFrameAt) ? Math.max(0, now - lastFrameAt) : null;
  const old = ageMs != null && ageMs >= staleMs;
  const age = ageMs != null ? ` ${ageText(ageMs)}` : '';
  const line = old ? `no new data for ${ageText(ageMs).toLowerCase()}` : '';
  if (!open) return { state: 'dead', ageMs, text: `OFFLINE${old ? age : ''}`, line };
  if (old) return { state: 'stale', ageMs, text: `STALE${age}`, line };
  return { state: 'live', ageMs, text: 'LIVE', line };
}

/** Whether two answers read the same (the tag and the caption need no write). */
export const sameFresh = (a, b) => Boolean(a && b) && a.state === b.state && a.text === b.text && a.line === b.line;

// The sun says it too (night 3 T6, README §7 Night 3 B): its corona swells
// softly once per map frame that arrives, and once the data is old it
// shrinks and the sun goes cold, a flat dimmer grey. Its absence is the
// alarm, so even the swell's peak stays under half the crit nebula's
// strength (test/wall-galaxy-fresh.test.mjs): trouble stays the loudest.

/**
 * The sun's look. `swell`: how much the halo grows (scale) and brightens
 * (glow) at a frame's peak, `riseMs` up, then fading with `fallMs` as its
 * time constant. `cold`: at old data the halo shrinks to `scale` and dims
 * to `glow` of its strength while the core and halo turn the text-3 grey,
 * over `ms` after the data went old. `ease`: how fast the drawn sun follows
 * (time constants, ms), so a frame after a cold spell warms it, not cuts it.
 */
export const SUN = Object.freeze({
  swell: Object.freeze({ scale: 0.06, glow: 0.3, riseMs: 250, fallMs: 700 }),
  cold: Object.freeze({ scale: 0.6, glow: 0.4, ms: 2000 }),
  ease: Object.freeze({ swellMs: 120, coldMs: 500 }),
});

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** The swell's envelope `ageMs` after a frame, 0..1 (0 before the first frame). Pure. */
export function swellAt(ageMs, s = SUN.swell) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return ageMs < s.riseMs ? smooth(ageMs / s.riseMs) : Math.exp(-(ageMs - s.riseMs) / s.fallMs);
}

/**
 * The sun the data asks for, `ageMs` after the last map frame (null before
 * the first: as live, no swell): `{ scale, glow, cold }`, the halo's size
 * and strength as factors and how far the greys have gone cold (0..1).
 * `still` (reduced motion): no swell, the cold sun only. Pure.
 */
export function sunLook(ageMs, { still = false, staleMs = FRESH.staleMs } = {}) {
  const old = Number.isFinite(ageMs) ? smooth((ageMs - staleMs) / SUN.cold.ms) : 0;
  const up = still || old > 0 ? 0 : swellAt(ageMs);
  return {
    scale: 1 + SUN.swell.scale * up - (1 - SUN.cold.scale) * old,
    glow: 1 + SUN.swell.glow * up - (1 - SUN.cold.glow) * old,
    cold: old,
  };
}

/** `from` toward `to` after `dtMs` with time constant `tauMs` (no overshoot). Pure. */
export function easeToward(from, to, dtMs, tauMs) {
  if (!(tauMs > 0)) return to;
  if (!(dtMs > 0)) return from;
  return to + (from - to) * Math.exp(-dtMs / tauMs);
}
