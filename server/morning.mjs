// The Morning view: what needs you, what finished, what it cost.
//
// One function builds exactly what the view renders, so `bin/laneboard morning`
// prints the same numbers the browser shows and neither can drift from the
// other.
import { config } from './config.mjs';
import { windowStart, windowLabel, WINDOWS } from './util.mjs';
import * as db from './db.mjs';
import * as state from './state.mjs';
import * as prs from './collector/pr.mjs';

const NEEDS_KINDS = ['danger', 'need', 'blocked', 'limit'];

/**
 * Spend from a session that no longer exists.
 *
 * Nine sessions were killed on this box tonight alone, and their snapshots stay
 * in the table forever. Folding them into "(no lane)" put $625 of dead sessions
 * next to a live lane's $5.88 all-time and made an honest number look like a
 * bug. They get their own row instead, and no all-time figure, because all-time
 * is computed from the live sessions and a dead one is not there to ask.
 */
export const ENDED = '(ended sessions)';

/** Resolve a session name to its lane, or to ENDED when it is gone. */
export function laneResolver(sessionByName) {
  return (name) => (sessionByName.has(name) ? sessionByName.get(name).lane ?? null : ENDED);
}

/** Fall back to the session id when a row predates the name column. */
export const defaultNameOf = (r) => r.session_name || r.session_id || null;

/** Total tokens across whatever split the cost engine recorded. */
export function sumTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return 0;
  return Object.values(tokens).reduce((a, v) => a + (Number(v) || 0), 0);
}

/**
 * Spend per session over a window, from the cumulative snapshots.
 *
 * A session's recorded cost only ever grows, so what it spent in a window is
 * (value at the end) - (value just before the start). Two details matter:
 *
 *   - The baseline is the last snapshot BEFORE the window. Without it a session
 *     that was already running looks like it spent its whole lifetime tonight.
 *   - A session that is still alive uses its LIVE cost as the endpoint, not its
 *     last hourly snapshot, so the totals reconcile with /api/cost rather than
 *     lagging up to an hour behind it.
 */
export function spendBySession({ rows, since, live = new Map(), nameOf = defaultNameOf }) {
  const bySession = new Map();
  for (const r of rows) {
    // Snapshots written before v2 have a NULL session_name and only a
    // sessionId, so the caller maps ids back to names; a row that resolves to
    // neither is unattributable and is dropped rather than guessed at.
    const key = nameOf(r);
    if (!key) continue;
    let e = bySession.get(key);
    if (!e) {
      e = { baseline: null, last: null, lane: null };
      bySession.set(key, e);
    }
    if (r.lane && !e.lane) e.lane = r.lane;
    if (r.ts < since) {
      // Rows arrive ordered, but be explicit: the newest pre-window row wins.
      if (!e.baseline || r.ts > e.baseline.ts) e.baseline = r;
    } else if (!e.last || r.ts >= e.last.ts) {
      e.last = r;
    }
  }

  const out = new Map();
  const names = new Set([...bySession.keys(), ...live.keys()]);
  for (const name of names) {
    const e = bySession.get(name) ?? { baseline: null, last: null, lane: null };
    const liveCost = live.get(name) ?? null;
    const endUsd = liveCost ? (liveCost.usd ?? 0) : (e.last?.usd ?? e.baseline?.usd ?? 0);
    const endTok = liveCost ? sumTokens(liveCost.tokens) : sumTokens(e.last?.tokens ?? e.baseline?.tokens);
    // No pre-window snapshot means the session did not exist before the window,
    // so all of its cost belongs to it.
    const baseUsd = e.baseline?.usd ?? 0;
    const baseTok = sumTokens(e.baseline?.tokens);
    out.set(name, {
      name,
      lane: e.lane,
      usd: Math.max(0, endUsd - baseUsd),
      tokens: Math.max(0, endTok - baseTok),
    });
  }
  return out;
}

/** Roll per-session spend up to lanes, attributing by the session's lane now. */
export function spendByLane(spend, laneOfSession) {
  const lanes = new Map();
  let totalUsd = 0;
  let totalTokens = 0;
  for (const s of spend.values()) {
    // The row's own lane is used when it has one; otherwise the session's
    // current lane, which is what makes nine days of pre-column rows usable.
    const lane = s.lane || laneOfSession(s.name) || null;
    const key = lane ?? '—';
    const e = lanes.get(key) ?? { lane, usd: 0, tokens: 0, sessions: [] };
    e.usd += s.usd;
    e.tokens += s.tokens;
    if (s.usd > 0 || s.tokens > 0) e.sessions.push(s.name);
    lanes.set(key, e);
    totalUsd += s.usd;
    totalTokens += s.tokens;
  }
  return {
    lanes: [...lanes.values()].sort((a, b) => b.usd - a.usd),
    totalUsd,
    totalTokens,
  };
}

/**
 * Build the whole view. Pure apart from the database and the live snapshot,
 * both of which are passed in by the caller in tests.
 */
export function build({ window = 'tonight', now = Date.now(), snapshot = null, prFor = null } = {}) {
  const prOf = (id) => {
    const p = (prFor ?? prs.get)(id);
    return p && !p.none && !p.error ? { number: p.number, url: p.url, state: p.state, isDraft: p.isDraft, verdict: p.verdict, checks: p.checks } : null;
  };
  const win = WINDOWS.includes(window) ? window : 'tonight';
  const since = windowStart(win, config.timezone, now);
  const snap = snapshot ?? state.snapshot();
  const sessions = snap.sessions ?? [];
  const lanes = snap.lanes ?? [];
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const sessionByName = new Map(sessions.map((s) => [s.name, s]));
  const hueOf = (id) => laneById.get(id)?.hue ?? null;

  // --- 1. needs you --------------------------------------------------------
  // The attention queue and the markers answer the same question from two
  // directions: one is "this session is sitting on a prompt", the other is
  // "this session said out loud that it needs you". Both belong in one list.
  const needs = [];
  for (const a of snap.attention ?? []) {
    const s = sessionByName.get(a.name);
    needs.push({
      source: 'attention',
      id: `attention:${a.name}`,
      name: a.name,
      lane: s?.lane ?? null,
      hue: hueOf(s?.lane),
      state: a.state,
      at: a.since ?? null,
      // v3: a session the dev-stack guard flagged is `danger`, whatever its state.
      kind: a.danger ? 'danger' : a.state,
      text: a.danger || s?.activity?.lastAssistant || s?.activity?.toolInput || '',
    });
  }
  for (const m of db.listMarkers({ since, kinds: NEEDS_KINDS, limit: 200 })) {
    const s = m.session_name ? sessionByName.get(m.session_name) : null;
    needs.push({
      source: 'marker',
      id: `marker:${m.id}`,
      markerId: m.id,
      name: m.session_name,
      lane: m.lane ?? s?.lane ?? null,
      hue: hueOf(m.lane ?? s?.lane),
      state: s?.state ?? null,
      at: m.ts,
      kind: m.kind,
      text: m.text,
    });
  }
  // `danger` first, always (v3); then newest first.
  needs.sort((a, b) => Number(b.kind === 'danger') - Number(a.kind === 'danger') || (b.at ?? 0) - (a.at ?? 0));

  // --- 2. finished ---------------------------------------------------------
  const doneMarkers = db.listMarkers({ since, kinds: ['done'], limit: 200 });
  const markersByLane = new Map();
  for (const m of doneMarkers) {
    const key = m.lane ?? (m.session_name ? sessionByName.get(m.session_name)?.lane : null) ?? '—';
    if (!markersByLane.has(key)) markersByLane.set(key, []);
    markersByLane.get(key).push(m);
  }

  const finished = [];
  for (const lane of lanes) {
    const laneSessions = lane.sessions.map((n) => sessionByName.get(n)).filter(Boolean);
    const done = markersByLane.get(lane.id) ?? [];
    const committedInWindow = lane.lastCommitAt != null && lane.lastCommitAt >= since;
    const stagedInWindow = lane.progress?.at != null && lane.progress.at >= since;
    const active = laneSessions.some((s) => (s.stateSince ?? 0) >= since);
    // "Any activity in the window" — a session that moved, a commit, a stage,
    // or something the lane said it had finished.
    if (!done.length && !committedInWindow && !stagedInWindow && !active) continue;
    finished.push({
      lane: lane.id,
      hue: lane.hue,
      branch: lane.branch,
      merged: lane.merged,
      isMain: lane.isMain,
      idle: lane.idle,
      progress: lane.progress ?? null,
      lastCommitAt: lane.lastCommitAt ?? null,
      newCommit: committedInWindow,
      doneMarkers: done.map((m) => ({ id: m.id, ts: m.ts, text: m.text, session: m.session_name })),
      // v3: the lane's PR and its checks, when it is a launched lane with one.
      pr: prOf(lane.id),
      sessions: laneSessions.map((s) => ({ name: s.name, state: s.state, since: s.stateSince })),
    });
  }
  // A lane that says it is done, or whose branch has landed on main, is the
  // news; everything else is just a lane that moved. Within each group, most
  // recently committed first.
  const newsRank = (l) => (l.doneMarkers.length || (l.merged === true && !l.isMain) ? 0 : 1);
  finished.sort(
    (a, b) => newsRank(a) - newsRank(b)
      || (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0)
      || a.lane.localeCompare(b.lane)
  );

  // --- 3. what it cost -----------------------------------------------------
  const live = new Map();
  for (const s of sessions) if (s.cost) live.set(s.name, s.cost);
  // Nine days of snapshots were written with a NULL session_name (fixed in
  // v2, but the history stays), so ids are mapped back to the names of the
  // sessions that are still alive.
  const idToName = new Map();
  for (const s of sessions) if (s.claude?.sessionId) idToName.set(s.claude.sessionId, s.name);
  const nameOf = (r) => r.session_name || idToName.get(r.session_id) || r.session_id || null;
  const spend = spendBySession({ rows: db.costRowsForWindow(since), since, live, nameOf });
  const cost = spendByLane(spend, laneResolver(sessionByName));
  const costLanes = cost.lanes.map((l) => ({ ...l, hue: hueOf(l.lane) }));

  return {
    window: win,
    label: windowLabel(win),
    since,
    now,
    needsYou: needs,
    finished,
    cost: {
      lanes: costLanes,
      totalUsd: cost.totalUsd,
      totalTokens: cost.totalTokens,
      label: 'API-equivalent',
    },
    rateLimits: freshestRateLimits(sessions),
  };
}

/** The same rule the board's rail uses: whichever statusline fired last. */
export function freshestRateLimits(sessions) {
  let best = null;
  for (const s of sessions) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best?.rateLimits ?? null;
}
