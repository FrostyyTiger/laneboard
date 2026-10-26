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
