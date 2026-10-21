// The run protocol, v1 (docs/plans/runs/README.md §3 A1): a loop appends one JSON
// object per line to `<run dir>/.laneboard/run.jsonl`; laneboard reads and folds them.
//
// Two pure functions, nothing else: `parseLine` checks one line and says why it
// skipped it, `foldRun` turns a run's events into what the Runs view shows.
// Nothing here reads files or trusts the writer. Loops write what they can: the
// reference loop (`docs/plans/runs/loop/run.sh`) writes every number as a float
// (`"n": 3.0`), restarts with a second `run.start`, retries a round under the same
// `n`, and once wrote a score of `"0\n0"`. All of that is taken as is or skipped
// with a reason, never thrown.

export const VERSION = 1;

/** Event types v1 knows. Anything else is kept raw and shown as is. */
export const KNOWN_TYPES = [
  'run.start', 'round.start', 'round.end', 'score', 'needs', 'needs.ack', 'artifact', 'run.stop', 'usage', 'cost',
];

/** Stop reasons from the plan plus the ones the reference loop writes. Others are kept as written. */
export const STOP_REASONS = [
  'done', 'deadline', 'budget', 'rounds', 'no-progress', 'error', 'human', 'overage', '7d-window',
];

/** Folded states: a run is running until it stops; `waiting` while its last word is a `wait` need. */
export const STATES = ['running', 'waiting', 'stopped'];

export const MAX_LINE = 16 * 1024;   // characters; a longer line is skipped, not cut
export const MAX_TEXT = 2000;        // goal, needs text
export const MAX_STR = 300;          // every other string
export const MAX_PATH = 1024;        // `cwd`; a longer one is dropped, not cut
const MAX_RAW_KEYS = 40;

// Run ids end up in file names (`<stateDir>/runs/<run>.jsonl`), so they are strict.
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/;

// A `needs.ack` ref below this is a need's place in the run's needs list; at or
// above it, a time (epoch seconds start at 1e9 in 2001, so the two never meet).
export const MAX_NEED_INDEX = 1e9;

/**
 * Who may close a `fence` need (a round touched a fenced file and was reverted):
 * a person, never the loop. `inbox` and `run page` are what the UI writes,
 * `owner` what `laneboard run ack --by owner` writes. An ack with another `by`
 * (the loop's own `by: "loop"`) or none leaves a fence need open and is kept raw.
 */
export const FENCE_ACK_BY = ['inbox', 'run page', 'owner'];

/**
 * The need a `needs.ack` names in `needs`, or undefined. By place: that one. By
 * ts: the first open need of that time this ack can close (a fence need only
 * with a FENCE_ACK_BY `by`), else the first open one, else the first one.
 */
export function ackTarget(needs, ack) {
  if (ack.refBy === 'index') return needs[ack.ref];
  const at = needs.filter((x) => x.ts === ack.ref);
  const closes = (x) => x.kind !== 'fence' || FENCE_ACK_BY.includes(ack.by);
  return at.find((x) => !x.acked && closes(x)) ?? at.find((x) => !x.acked) ?? at[0];
}

function clamp(s, max = MAX_STR) {
  if (typeof s !== 'string') return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function str(v, max = MAX_STR) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return clamp(v, max);
}

/** A finite number, from a number or a plain numeric string; else null. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC.test(v)) return Number(v);
  return null;
}

/** An integer: integral floats (`3.0`) become ints, anything else is null. */
function int(v) {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Epoch ms from ms, seconds (anything below 1e12) or an ISO string. */
function epochMs(v) {
  const n = num(v);
  if (n !== null) {
    if (n <= 0) return null;
    return Math.round(n < 1e12 ? n * 1000 : n);
  }
  if (typeof v === 'string' && v.length <= 64) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  const n = num(v);
  if (n !== null) return n !== 0;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/** A short commit sha written as a number (all digits) lost its leading zeros; give them back. */
function commit(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v).padStart(7, '0');
  const s = str(v, 64);
  return s && /^[0-9a-f]{4,64}$/i.test(s.trim()) ? s.trim() : null;
}

/** Only a positive percentage counts; the loop writes -1 or 0 when it does not know yet. */
function pct(v) {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
}

/** A need ref: `{ref, refBy: 'index'}` (0 = the run's first need), `{ref, refBy: 'ts'}` (epoch ms), or null. */
function needRef(v) {
  const i = int(v);
  if (i !== null && i >= 0 && i < MAX_NEED_INDEX) return { ref: i, refBy: 'index' };
  const ts = epochMs(v);
  return ts === null || ts < MAX_NEED_INDEX * 1000 ? null : { ref: ts, refBy: 'ts' };
}

/** The directory a run works in: an absolute path, never cut (a cut path names another dir). */
function dir(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || v.length > MAX_PATH || /[\0\n\r]/.test(v)) return null;
  return v.replace(/(.)\/+$/, '$1');
}

/** A Claude Code session id (a UUID, `claude --session-id`), or any short id a loop knows. */
function sessionId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v) ? v : null;
}

function rawCopy(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, MAX_RAW_KEYS)) {
    if (typeof v === 'string') out[k] = clamp(v);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = clamp(JSON.stringify(v));
  }
  return out;
}

const skip = (reason) => ({ ok: false, reason });

// One normaliser per known type: the checked fields, or a skip reason (string).
const SHAPES = {
  'run.start'(o) {
    const b = o.budget && typeof o.budget === 'object' ? o.budget : {};
    const budget = {
      rounds: int(b.rounds ?? o.rounds),
      windowPct: num(b.windowPct ?? o.windowPct),
      pause5h: num(b.pause5h ?? o.pause5h),
      stop7d: num(b.stop7d ?? o.stop7d),
    };
    return {
      goal: str(o.goal, MAX_TEXT),
      plan: str(o.plan),
      branch: str(o.branch),
      cwd: dir(o.cwd),
      host: str(o.host, 64),
      deadline: str(o.deadline, 64),
      deadlineAt: epochMs(o.deadline),
      budget,
    };
  },
  'round.start'(o) {
    const n = int(o.n);
    if (n === null || n < 0) return 'bad n';
    return { n, role: str(o.role), task: str(o.task), session: sessionId(o.session) };
  },
  'round.end'(o) {
    const n = int(o.n);
    if (n === null || n < 0) return 'bad n';
    return { n, outcome: str(o.outcome), commit: commit(o.commit), open: int(o.open), usd: num(o.usd),
      session: sessionId(o.session) };
  },
  score(o) {
    const name = str(o.name, 64);
    if (!name) return 'no name';
    const value = num(o.value);
    if (value === null) return 'bad value';
    const max = num(o.max);
    return { name, value, better: o.better === 'lower' ? 'lower' : 'higher', n: int(o.n), max: max !== null && max > 0 ? max : null };
  },
  needs(o) {
    return { kind: str(o.kind, 32) || 'decision', text: str(o.text, MAX_TEXT), link: str(o.link), n: int(o.n) };
  },
  'needs.ack'(o) {
    const ref = needRef(o.ref);
    if (!ref) return 'bad ref';
    return { ...ref, by: str(o.by, 64) };
  },
  artifact(o) {
    const url = str(o.url);
    if (!url) return 'no url';
    return { kind: str(o.kind, 32) || 'link', url, title: str(o.title) };
  },
  'run.stop'(o) {
    return { reason: str(o.reason, 32) || 'unknown', rounds: int(o.rounds), usd: num(o.usd) };
  },
  usage(o) {
    return {
      n: int(o.n),
      fiveHourPct: pct(o.fiveHourPct),
      sevenDayPct: pct(o.sevenDayPct),
      fiveHourResetsAt: epochMs(o.fiveHourResetsAt),
      overage: bool(o.overage),
    };
  },
  cost(o) {
    const usd = num(o.usd);
    if (usd === null || usd < 0) return 'bad usd';
    return { n: int(o.n), usd, total: num(o.total) };
  },
};

/**
 * Check one line. Returns `{ ok: true, event }` or `{ ok: false, reason }`.
 * Every event has `v`, `t`, `run`, `ts` (epoch ms or null) and `known`; a known
 * type adds its checked fields, an unknown one keeps a clamped copy in `raw`.
 */
export function parseLine(text) {
  if (typeof text !== 'string' || !text.trim()) return skip('empty');
  if (text.length > MAX_LINE) return skip('too long');
  let o;
  try { o = JSON.parse(text); } catch { return skip('not json'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return skip('not an object');
  const v = o.v === undefined ? VERSION : int(o.v);
  if (v !== VERSION) return skip('unsupported version');
  if (typeof o.t !== 'string' || !o.t || o.t.length > 64) return skip('no type');
  if (typeof o.run !== 'string' || !RUN_ID.test(o.run)) return skip('bad run id');
  const base = { v, t: o.t, run: o.run, ts: epochMs(o.ts) };
  const shape = SHAPES[o.t];
  if (!shape) return { ok: true, event: { ...base, known: false, raw: rawCopy(o) } };
  const fields = shape(o);
  if (typeof fields === 'string') return skip(`${o.t}: ${fields}`);
  return { ok: true, event: { ...base, known: true, ...fields } };
}

/** Parse a whole file's text: the events and how many lines were skipped, by reason. */
export function parseLines(text) {
  const events = [];
  const skipped = {};
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const r = parseLine(line);
    if (r.ok) events.push(r.event);
    else skipped[r.reason] = (skipped[r.reason] || 0) + 1;
  }
  return { events, skipped };
}

function round(rounds, n) {
  let r = rounds.get(n);
  if (!r) {
    r = { n, role: null, task: null, starts: 0, startedAt: null, endedAt: null, outcome: null,
      commit: null, usd: null, open: null, usage: null, sessions: [] };
    rounds.set(n, r);
  }
  return r;
}

/**
 * Fold one run's events (in file order) into its current picture.
 *
 * - A second `run.start` (the loop restarted) updates the run and reopens it.
 * - Rounds are keyed by `n` and sorted, whatever order they came in; a round
 *   started twice (a retry) counts its `starts` and adds up its cost.
 * - A score without `n` belongs to the latest round started before it (0 = before any).
 * - `cost.usd` is summed: `total` restarts when the loop does.
 * - A `wait` need closes when the next round starts or the run stops; any need
 *   closes when a `needs.ack` names it (by its place in the list or its `ts`).
 *   The first ack counts; a second one changes nothing. An ack naming no need is
 *   kept in `raw`. A `fence` need closes only on an ack whose `by` is in
 *   FENCE_ACK_BY (a person); any other ack of it is kept in `raw`.
 * Events of another run than the first one are ignored.
 */
export function foldRun(events, { skipped = 0 } = {}) {
  const run = {
    run: null, goal: null, plan: null, branch: null, cwd: null, host: null, state: 'running', deadline: null, deadlineAt: null,
    budget: null, rounds: [], scores: {}, better: {}, needs: [], artifacts: [], stop: null,
    cost: { usd: 0, rounds: 0 }, usage: null, raw: [], startedAt: null, updatedAt: null,
    events: 0, skipped: typeof skipped === 'number' ? skipped : Object.values(skipped).reduce((a, b) => a + b, 0),
  };
  const rounds = new Map();
  const urls = new Set();
  let current = 0;
  let last = null;

  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (run.run === null) run.run = e.run;
    if (e.run !== run.run) continue;
    run.events++;
    if (e.ts) {
      if (run.startedAt === null || e.ts < run.startedAt) run.startedAt = e.ts;
      if (run.updatedAt === null || e.ts > run.updatedAt) run.updatedAt = e.ts;
    }
    last = e;
    if (!e.known) { run.raw.push(e); continue; }

    switch (e.t) {
      case 'run.start':
        for (const k of ['goal', 'plan', 'branch', 'cwd', 'host', 'deadline', 'deadlineAt']) if (e[k] !== null) run[k] = e[k];
        run.budget = { ...e.budget };
        run.stop = null;
        break;
      case 'round.start': {
        const r = round(rounds, e.n);
        r.starts++;
        if (e.role) r.role = e.role;
        if (e.task) r.task = e.task;
        if (e.session && !r.sessions.includes(e.session)) r.sessions.push(e.session);
        if (e.ts && (r.startedAt === null || e.ts < r.startedAt)) r.startedAt = e.ts;
        current = Math.max(current, e.n);
        for (const need of run.needs) if (need.kind === 'wait') need.open = false;
        break;
      }
      case 'round.end': {
        const r = round(rounds, e.n);
        for (const k of ['outcome', 'commit', 'open']) if (e[k] !== null) r[k] = e[k];
        if (e.usd !== null) r.usd = (r.usd ?? 0) + e.usd;
        if (e.session && !r.sessions.includes(e.session)) r.sessions.push(e.session);
        if (e.ts) r.endedAt = e.ts;
        current = Math.max(current, e.n);
        break;
      }
      case 'score': {
        const n = e.n ?? current;
        (run.scores[e.name] ||= []).push({ n, value: e.value, ts: e.ts, max: e.max ?? null });
        run.better[e.name] = e.better;
        break;
      }
      case 'needs':
        run.needs.push({ i: run.needs.length, kind: e.kind, text: e.text, link: e.link, n: e.n ?? current, ts: e.ts,
          open: true, acked: false, ackedAt: null, by: null });
        break;
      case 'needs.ack': {
        const need = ackTarget(run.needs, e);
        if (!need || (need.kind === 'fence' && !need.acked && !FENCE_ACK_BY.includes(e.by))) { run.raw.push(e); break; }
        if (!need.acked) Object.assign(need, { open: false, acked: true, ackedAt: e.ts, by: e.by });
        break;
      }
      case 'artifact':
        if (!urls.has(e.url)) {
          urls.add(e.url);
          run.artifacts.push({ kind: e.kind, url: e.url, title: e.title, n: current, ts: e.ts });
        }
        break;
      case 'run.stop':
        run.stop = { reason: e.reason, rounds: e.rounds, usd: e.usd, ts: e.ts };
        for (const need of run.needs) if (need.kind === 'wait') need.open = false;
        break;
      case 'usage': {
        const u = { fiveHourPct: e.fiveHourPct, sevenDayPct: e.sevenDayPct,
          fiveHourResetsAt: e.fiveHourResetsAt, overage: e.overage, ts: e.ts };
        run.usage = u;
        if (e.n !== null) round(rounds, e.n).usage = u;
        break;
      }
      case 'cost': {
        run.cost.usd += e.usd;
        run.cost.rounds++;
        if (e.n !== null) { const r = round(rounds, e.n); r.usd = (r.usd ?? 0) + e.usd; }
        break;
      }
    }
  }

  const cents = (x) => Math.round(x * 1e6) / 1e6;
  run.cost.usd = cents(run.cost.usd);
  run.rounds = [...rounds.values()].sort((a, b) => a.n - b.n);
  for (const r of run.rounds) if (r.usd !== null) r.usd = cents(r.usd);
  for (const list of Object.values(run.scores)) list.sort((a, b) => a.n - b.n);
  if (run.stop) run.state = 'stopped';
  else if (last?.t === 'needs' && last.kind === 'wait') run.state = 'waiting';
  return run;
}
