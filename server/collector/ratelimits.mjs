// Rate-limit history.
//
// The 5 h and 7 d windows are the real constraint on this box: the work runs
// on a subscription, so the dollars are "API-equivalent" and these two percentages
// are what actually stops work. They arrive per session from the statusline
// sidecar and, until now, nothing stored them: the board could say "74 % now"
// and never "74 % and climbing since 21:00".
//
// One row a minute, from whichever session's statusline fired most recently.
import { log } from '../log.mjs';
import * as db from '../db.mjs';

/** The same rule the board's rail uses: whichever statusline is freshest. */
export function freshest(sessions) {
  let best = null;
  for (const s of sessions) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best ? { rateLimits: best.rateLimits, session: best.name } : null;
}

const STALE_MS = 10 * 60 * 1000;

/**
 * Should this sample be written?
 *
 * Skip it only when nothing has changed AND the last row is younger than ten
 * minutes. The second half matters: a flat line still has to be drawn, and a
 * chart with an hour-long hole in it looks like an outage rather than like
 * "the number did not move".
 */
export function shouldSample(prev, next, now = Date.now()) {
  if (!next) return false;
  if (!prev) return true;
  const changed =
    prev.five_hour_pct !== next.fiveHourPct ||
    prev.seven_day_pct !== next.sevenDayPct ||
    prev.five_hour_resets_at !== next.fiveHourResetsAt ||
    prev.seven_day_resets_at !== next.sevenDayResetsAt;
  if (changed) return true;
  return now - prev.ts >= STALE_MS;
}

/** Shape a snapshot's freshest rate limits into a row. */
export function rowFrom(found) {
  if (!found?.rateLimits) return null;
  const { fiveHour, sevenDay } = found.rateLimits;
  if (!fiveHour && !sevenDay) return null;
  return {
    fiveHourPct: fiveHour?.usedPct ?? null,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDayPct: sevenDay?.usedPct ?? null,
    sevenDayResetsAt: sevenDay?.resetsAt ?? null,
    sourceSession: found.session ?? null,
  };
}

export function sample(sessions, now = Date.now()) {
  const row = rowFrom(freshest(sessions));
  if (!row) return null;
  const prev = db.lastRateLimitSample();
  if (!shouldSample(prev, row, now)) return null;
  db.addRateLimitSample({ ts: now, ...row });
  return row;
}

let lastAt = 0;

export function health() {
  const last = db.lastRateLimitSample();
  return {
    rows: db.countRateLimitSamples(),
    lastSampleAt: last?.ts ?? null,
    lastSampleAgeMs: last?.ts ? Date.now() - last.ts : null,
  };
}

/**
 * Called from the tick rather than on a timer of its own: the tick already has
 * the sessions in hand, and a sampler that fires while the snapshot is being
 * rebuilt would read a half-finished one.
 */
export function maybeSample(sessions, now = Date.now()) {
  if (now - lastAt < 60_000) return null;
  lastAt = now;
  try {
    return sample(sessions, now);
  } catch (err) {
    log.error('rate-limit sample failed', String(err));
    return null;
  }
}

export const SAMPLE_MS = 60_000;
