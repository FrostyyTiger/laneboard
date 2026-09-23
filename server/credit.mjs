// The Credit view: where the two rate-limit windows stand over time, and what
// each lane has cost across four windows.
//
// A subscription, not the API. The dollars here are labelled API-equivalent
// throughout and the percentages are the real constraint, which is why the
// charts get the top of the view and the money gets a table.
import { config } from './config.mjs';
import { windowStart } from './util.mjs';
import * as db from './db.mjs';
import * as state from './state.mjs';
import * as ratelimits from './collector/ratelimits.mjs';
import { spendBySession, spendByLane, laneResolver, ENDED } from './morning.mjs';

/** The windows the cost table has a column for. */
export const COST_WINDOWS = ['tonight', '24h', '7d'];

/**
 * One series per chart, thinned to at most `max` points.
 *
 * A week of one-a-minute samples is 10 080 points and no 700 px chart can show
 * them; drawing them all would just cost the browser a 10 000-node path. The
 * thinning keeps the FIRST and LAST point exactly and takes the MAXIMUM of each
 * bucket in between — for a usage gauge the peak is the number that matters, and
 * averaging would hide the spike that actually stopped work.
 */
export function thin(points, max = 240) {
  if (points.length <= max) return points;
  // The two edges are kept whole, so the buckets divide what is left between
  // the remaining slots — otherwise `max` would quietly mean `max + 2`.
  const bucket = Math.ceil((points.length - 2) / (max - 2));
  // The first and last samples are the two edges of the range and are kept
  // exactly; a bucket peak in their place would put the line's start and end at
  // the wrong time. Every point plotted is a real (t, v) pair either way — the
  // thinning omits samples, it never invents or averages one.
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += bucket) {
    const slice = points.slice(i, Math.min(i + bucket, points.length - 1));
    if (!slice.length) continue;
    let peak = slice[0];
    for (const p of slice) if ((p.v ?? 0) > (peak.v ?? 0)) peak = p;
    out.push(peak);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Reset boundaries inside the range, drawn as vertical ticks. */
export function resetTicks(rows, key, since, now) {
  const ticks = new Set();
  for (const r of rows) {
    const at = r[key];
    if (at && at >= since && at <= now) ticks.add(at);
  }
  return [...ticks].sort((a, b) => a - b);
}

export function build({ now = Date.now(), snapshot = null } = {}) {
  const snap = snapshot ?? state.snapshot();
  const sessions = snap.sessions ?? [];
  const lanes = snap.lanes ?? [];
  const hueOf = (id) => lanes.find((l) => l.id === id)?.hue ?? null;
  const sessionByName = new Map(sessions.map((s) => [s.name, s]));
  const idToName = new Map();
  for (const s of sessions) if (s.claude?.sessionId) idToName.set(s.claude.sessionId, s.name);
  const nameOf = (r) => r.session_name || idToName.get(r.session_id) || r.session_id || null;

  // --- charts --------------------------------------------------------------
  // The 7 d window is shown over seven days; the 5 h window over a day, because
  // a 5 h gauge plotted over a week is four resets a day and unreadable.
  const weekSince = now - 7 * 24 * 3600 * 1000;
  const daySince = now - 24 * 3600 * 1000;
  const weekRows = db.rateLimitSamples({ since: weekSince });
  const dayRows = weekRows.filter((r) => r.ts >= daySince);

  const charts = {
    sevenDay: {
      title: '7-day window',
      since: weekSince,
      now,
      points: thin(weekRows
        .filter((r) => r.seven_day_pct != null)
        .map((r) => ({ t: r.ts, v: r.seven_day_pct }))),
      resets: resetTicks(weekRows, 'seven_day_resets_at', weekSince, now),
    },
    fiveHour: {
      title: '5-hour window',
      since: daySince,
      now,
      points: thin(dayRows
        .filter((r) => r.five_hour_pct != null)
        .map((r) => ({ t: r.ts, v: r.five_hour_pct }))),
      resets: resetTicks(dayRows, 'five_hour_resets_at', daySince, now),
    },
  };

  // --- cost per lane, across four windows ----------------------------------
  const live = new Map();
  for (const s of sessions) if (s.cost) live.set(s.name, s.cost);
  const laneOfSession = laneResolver(sessionByName);

  // One read for all three windows.
  //
  // The 7 d row set is a superset of the other two, and spendBySession picks
  // its own baseline (the newest row before `since`) from whatever it is given,
  // so the narrower windows can be computed from the same rows. Reading the
  // table once per window ran the correlated baseline subquery over ~3 500 rows
  // three times and cost 260 ms per request, which is most of what this view
  // was spending — and most of the RSS high-water it left behind.
  const widest = windowStart(COST_WINDOWS[COST_WINDOWS.length - 1], config.timezone, now);
  const snapshotRows = db.costRowsForWindow(widest);
  const perWindow = {};
  for (const w of COST_WINDOWS) {
    const since = windowStart(w, config.timezone, now);
    perWindow[w] = spendByLane(spendBySession({ rows: snapshotRows, since, live, nameOf }), laneOfSession);
  }
  // All time comes from the live sessions, not from snapshot deltas: it is the
  // same number /api/cost reports, so the two views cannot disagree.
  const allTime = new Map();
  let allTimeTotal = 0;
  const tokensByLane = new Map();
  for (const s of sessions) {
    const lane = s.lane ?? null;
    const usd = s.cost?.usd ?? 0;
    if (!usd && !s.cost) continue;
    allTime.set(lane, (allTime.get(lane) ?? 0) + usd);
    allTimeTotal += usd;
    const t = tokensByLane.get(lane) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const tk = s.cost?.tokens ?? {};
    t.input += Number(tk.input) || 0;
    t.output += Number(tk.output) || 0;
    t.cacheRead += Number(tk.cacheRead) || 0;
    t.cacheWrite += (Number(tk.cacheWrite5m) || 0) + (Number(tk.cacheWrite1h) || 0);
    tokensByLane.set(lane, t);
  }

  const ids = new Set();
  for (const w of COST_WINDOWS) for (const l of perWindow[w].lanes) ids.add(l.lane ?? null);
  for (const l of allTime.keys()) ids.add(l);

  const rows = [...ids].map((lane) => {
    const pick = (w) => perWindow[w].lanes.find((l) => (l.lane ?? null) === lane) ?? { usd: 0, tokens: 0 };
    return {
      lane,
      hue: hueOf(lane),
      tonight: pick('tonight').usd,
      day: pick('24h').usd,
      week: pick('7d').usd,
      // A killed session cannot be asked what it cost in total, so the column
      // is null rather than a zero that would read as "this lane is free".
      allTime: lane === ENDED ? null : allTime.get(lane) ?? 0,
      tokens: tokensByLane.get(lane) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }).sort((a, b) => (b.allTime ?? -1) - (a.allTime ?? -1) || b.tonight - a.tonight);

  return {
    now,
    charts,
    lanes: rows,
    totals: {
      tonight: perWindow.tonight.totalUsd,
      day: perWindow['24h'].totalUsd,
      week: perWindow['7d'].totalUsd,
      allTime: allTimeTotal,
    },
    rateLimits: snap.sessions ? freshest(sessions) : null,
    sampler: ratelimits.health(),
    label: 'API-equivalent',
  };
}

function freshest(sessions) {
  let best = null;
  for (const s of sessions) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best?.rateLimits ?? null;
}
