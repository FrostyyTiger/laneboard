// Fleet aggregates (§3 2.6): attention, rate limit, cost, CI queue, counts.
//
// Pure: no IO, no timers, time is passed in. Input is fleet-store's view(now).
// Builder data is untrusted, so every number is checked before it is summed or
// compared, and a missing field contributes nothing rather than throwing.
//
// The one rule that matters most: the 5 h / 7 d rate-limit windows are
// account-wide. Every builder under one subscription reports the same counter,
// so they are NEVER summed. Per `account` group the current window is the one
// with the latest `resetsAt`, and within it the highest `usedPct` wins.
import { fkey } from '../fleet/keys.mjs';
import { freshest } from '../collector/ratelimits.mjs';

export const ATTENTION_CAP = 100;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : null);

function safeFkey(id, name) {
  try {
    return fkey(id, name);
  } catch {
    return null;
  }
}

function sessionsOf(b) {
  const s = b?.snap?.sessions;
  if (s instanceof Map) return [...s.values()];
  return Array.isArray(s) ? s : [];
}

// --- attention ---------------------------------------------------------------

export function attention(view) {
  const live = [];
  const stale = [];
  for (const b of view?.builders ?? []) {
    const list = Array.isArray(b?.snap?.attention) ? b.snap.attention : [];
    const isStale = b.state !== 'up';
    for (const a of list) {
      const name = str(a?.name);
      const k = name && safeFkey(b.id, name);
      if (!k) continue;
      const entry = {
        fkey: k,
        builder: b.id,
        code: b.code ?? null,
        name,
        state: str(a.state),
        score: num(a.score) ?? 0,
        since: num(a.since),
        danger: str(a.danger),
        stale: isStale,
      };
      (isStale ? stale : live).push(entry);
    }
  }
  // Same order as server/state.mjs snapshot(): score desc, then since asc.
  const order = (x, y) => y.score - x.score || (x.since ?? 0) - (y.since ?? 0);
  live.sort(order);
  stale.sort(order);
  return live.concat(stale).slice(0, ATTENTION_CAP);
}

// --- rate limit --------------------------------------------------------------

function windowSample(w) {
  const usedPct = num(w?.usedPct);
  const resetsAt = num(w?.resetsAt);
  if (usedPct === null || resetsAt === null) return null;
  return { usedPct, resetsAt };
}

/** Latest resetsAt wins; among equal resetsAt, the max usedPct. */
function better(a, b) {
  if (!a) return true;
  if (b.resetsAt !== a.resetsAt) return b.resetsAt > a.resetsAt;
  return b.usedPct > a.usedPct;
}

function severity(acc) {
  return Math.max(acc.fiveHour?.usedPct ?? -1, acc.sevenDay?.usedPct ?? -1);
}

export function rateLimit(view) {
  const groups = new Map(); // account -> { fiveHour, sevenDay, builders }
  for (const b of view?.builders ?? []) {
    const account = typeof b?.account === 'string' && b.account ? b.account : 'default';
    let g = groups.get(account);
    if (!g) {
      g = { fiveHour: null, sevenDay: null, builders: [] };
      groups.set(account, g);
    }
    g.builders.push(b.id);
    let found = null;
    try {
      found = freshest(sessionsOf(b).filter((s) => s && typeof s === 'object'));
    } catch {
      found = null;
    }
    if (!found) continue;
    const source = typeof found.session === 'string' ? safeFkey(b.id, found.session) : null;
    for (const w of ['fiveHour', 'sevenDay']) {
      const s = windowSample(found.rateLimits?.[w]);
      if (s && better(g[w], s)) g[w] = { ...s, source };
    }
  }
  let worst = null;
  for (const [, g] of groups) {
    if ((g.fiveHour || g.sevenDay) && (!worst || severity(g) > severity(worst))) worst = g;
  }
  return {
    fiveHour: worst?.fiveHour ?? null,
    sevenDay: worst?.sevenDay ?? null,
    source: worst ? (worst.fiveHour?.source ?? worst.sevenDay?.source ?? null) : null,
    accounts: Object.fromEntries(groups),
  };
}

// --- cost --------------------------------------------------------------------

const round2 = (v) => Math.round(v * 100) / 100;

export function cost(view) {
  let usdToday = 0;
  let usd = 0;
  let burn5h = 0;
  const byBuilder = {};
  for (const b of view?.builders ?? []) {
    let bToday = 0;
    let bUsd = 0;
    for (const s of sessionsOf(b)) {
      bToday += num(s?.cost?.usdToday) ?? 0;
      bUsd += num(s?.cost?.usd) ?? 0;
    }
    let bBurn = 0;
    const burn = b?.snap?.box?.burn5h;
    if (burn && typeof burn === 'object' && !Array.isArray(burn)) {
      for (const v of Object.values(burn)) bBurn += num(v) ?? 0;
    }
    usdToday += bToday;
    usd += bUsd;
    burn5h += bBurn;
    byBuilder[b.id] = { usdToday: round2(bToday), burn5h: round2(bBurn) };
  }
  return { usdToday: round2(usdToday), usd: round2(usd), burn5h: round2(burn5h), byBuilder, label: 'API-equivalent' };
}

// --- CI queue ----------------------------------------------------------------

const QUEUED = new Set(['queued', 'waiting', 'pending']);

export function ci(view) {
  const runs = new Map(); // dedupe key -> run
  for (const b of view?.builders ?? []) {
    const queue = b?.snap?.box?.ci?.queue;
    if (!queue || !Array.isArray(queue.runs)) continue;
    const repo = str(queue.repo);
    for (const r of queue.runs) {
      if (!r || typeof r !== 'object') continue;
      const run = {
        repo,
        name: str(r.name),
        branch: str(r.branch),
        status: str(r.status),
        conclusion: str(r.conclusion),
        createdAt: num(r.createdAt),
      };
      const key = JSON.stringify([run.repo, run.name, run.branch, run.createdAt]);
      const seen = runs.get(key);
      if (seen) {
        if (!seen.builders.includes(b.id)) seen.builders.push(b.id);
        continue;
      }
      runs.set(key, { ...run, builders: [b.id] });
    }
  }
  const list = [...runs.values()].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
  return {
    queued: list.filter((r) => QUEUED.has(r.status)).length,
    running: list.filter((r) => r.status === 'in_progress').length,
    runs: list,
  };
}

// --- counts ------------------------------------------------------------------

export function counts(view) {
  const out = { builders: { up: 0, stale: 0, down: 0 }, sessions: 0, lanes: 0, working: 0, needsYou: 0 };
  for (const b of view?.builders ?? []) {
    if (b.state === 'up') out.builders.up++;
    else if (b.state === 'stale') out.builders.stale++;
    else out.builders.down++; // connecting, down, misconfigured, incompatible
    const sessions = sessionsOf(b);
    out.sessions += sessions.length;
    out.lanes += Array.isArray(b?.snap?.lanes) ? b.snap.lanes.length : 0;
    for (const s of sessions) {
      if (s?.state === 'working') out.working++;
      else if (s?.state === 'waiting_permission' || s?.state === 'waiting_question') out.needsYou++;
    }
  }
  return out;
}

/** Everything the `fleet` message and GET /api/fleet carry as `aggregates`. */
export function aggregates(view, now = view?.now ?? Date.now()) {
  void now; // every input is already time-resolved by view(now); kept for the contract
  return {
    attention: attention(view),
    rateLimit: rateLimit(view),
    cost: cost(view),
    ci: ci(view),
    counts: counts(view),
  };
}

export default aggregates;
