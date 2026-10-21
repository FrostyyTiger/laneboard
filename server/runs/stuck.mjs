// Run stuck rules (docs/plans/runs/README.md §3 A3 "Stuck", task T8). Pure: a
// folded run (server/runs/protocol.mjs foldRun), the `runs.stuck` config and a
// time in, `{rule, reason}` or null out. No I/O, no state between calls: it is
// computed again on every fold, so a good round clears it and nothing needs an
// ack (research Q11: the stuck flag is a label derived from the facts).
//
// These are not the session rules (server/fleet/stuck.mjs): a run is a loop of
// rounds, so the rules count rounds.
//
//   deadline        the deadline has passed and the run has no `run.stop`
//                   (night 4 review, item 1g: before the deadline a run is
//                   working to it, not stuck, and a report written before it
//                   does not make an overrun run done). `deadlineMin` has no
//                   threshold any more: it is accepted for one version, and
//                   0 still turns the rule off; any other value is ignored
//   same-task       the latest ended round failed, and its task failed in
//                   `sameTaskFails` rounds since that task last went well
//   no-progress     no score got better (by more than `minDelta`, in its
//                   `better` direction) in the last `patience` ended rounds
//   shorter-rounds  the last `shorterRounds` ended rounds were each shorter
//                   than the one before (a hint: a usage limit, or the run is
//                   simply finishing its backlog)
// First match in that order wins. A stopped run is never stuck. A rule with no
// data to judge (no deadline, no tasks, scores with no history, rounds with no
// times) is silent, never an error. `runs.stuck: false` turns every rule off;
// a rule's own count at 0 turns that rule off.

export const RULES = Object.freeze(['deadline', 'same-task', 'no-progress', 'shorter-rounds']);

/** The defaults of `runs.stuck` (server/config/runs.mjs; docs/config.md). */
export const DEFAULTS = Object.freeze({
  patience: 3,
  minDelta: 0,
  sameTaskFails: 2,
  shorterRounds: 3,
  deadlineMin: 30,
});

/**
 * Round outcomes that count as a failed round. `outcome` is free text in the
 * protocol (docs/runs.md); these are the words the reference loop and common
 * loops write for "the round did not get its task done".
 */
export const FAILED_OUTCOME = /^(fail|failed|failure|error|errored|no-task-done|still-red|reverted|blocked|timeout|timed-out)$/i;

const MIN = 60 * 1000;
const REASON_MAX = 120;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clip = (s) => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s);

function spanText(ms) {
  const m = Math.round(ms / MIN);
  if (m < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

const valueText = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/** The rounds that ended (a `round.end` was folded), in order. */
function endedRounds(run) {
  return (Array.isArray(run.rounds) ? run.rounds : []).filter((r) => r && (r.outcome !== null || r.endedAt !== null));
}

const failed = (r) => typeof r.outcome === 'string' && FAILED_OUTCOME.test(r.outcome.trim());

function deadlineRule(run, cfg, now) {
  if (!cfg.deadlineMin || !isNum(run.deadlineAt)) return null;
  if (run.stop) return null;
  const over = now - run.deadlineAt;
  if (!(over > 0)) return null;
  return `deadline passed ${spanText(over)} ago, not stopped`;
}

function sameTaskRule(ended, cfg) {
  if (!cfg.sameTaskFails) return null;
  const last = ended[ended.length - 1];
  if (!last || !last.task || !failed(last)) return null;
  const fails = [];
  for (let i = ended.length - 1; i >= 0; i--) {
    const r = ended[i];
    if (r.task !== last.task) continue;
    if (!failed(r)) break;
    fails.unshift(r.n);
  }
  if (fails.length < cfg.sameTaskFails) return null;
  const shown = fails.length > 4 ? `${fails.slice(0, 2).join(', ')} … ${fails[fails.length - 1]}` : fails.join(', ');
  return `task ${last.task} failed in rounds ${shown}`;
}

function noProgressRule(run, ended, cfg) {
  if (!cfg.patience || ended.length <= cfg.patience) return null;
  const cutoff = ended[ended.length - cfg.patience - 1].n;
  let judged = null;
  for (const [name, list] of Object.entries(run.scores ?? {})) {
    if (!Array.isArray(list)) continue;
    const higher = run.better?.[name] !== 'lower';
    const gain = (v, best) => (higher ? v - best : best - v);
    let best = null;
    for (const p of list) {
      if (!isNum(p?.value) || !(p.n <= cutoff)) continue;
      if (best === null || gain(p.value, best) > 0) best = p.value;
    }
    if (best === null) continue; // no history before the window: cannot judge this score
    const after = list.filter((p) => isNum(p?.value) && p.n > cutoff);
    if (after.some((p) => gain(p.value, best) > cfg.minDelta)) return null;
    judged ??= { name, best };
  }
  if (!judged) return null;
  return `no score better in the last ${cfg.patience} rounds (${judged.name} best ${valueText(judged.best)})`;
}

function shorterRule(run, ended, cfg) {
  if (!cfg.shorterRounds || run.state === 'waiting') return null;
  const k = cfg.shorterRounds;
  if (ended.length < k + 1) return null;
  const tail = ended.slice(-(k + 1)).map((r) => (isNum(r.startedAt) && isNum(r.endedAt) && r.endedAt >= r.startedAt
    ? r.endedAt - r.startedAt : null));
  if (tail.some((d) => d === null)) return null;
  for (let i = 1; i < tail.length; i++) if (!(tail[i] < tail[i - 1])) return null;
  return `rounds are getting shorter (${k} in a row, last ${spanText(tail[tail.length - 1])}): possible usage limit`;
}

/**
 * Is this run stuck? `cfg` is `runs.stuck` (an object, or false for off);
 * missing keys take DEFAULTS. -> `{rule, reason}` or null.
 */
export function runStuck(run, cfg = DEFAULTS, now = Date.now()) {
  if (cfg === false || !run || typeof run !== 'object') return null;
  if (run.state === 'stopped' || run.stop) return null;
  const c = { ...DEFAULTS, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  const ended = endedRounds(run);
  const checks = {
    deadline: () => deadlineRule(run, c, now),
    'same-task': () => sameTaskRule(ended, c),
    'no-progress': () => noProgressRule(run, ended, c),
    'shorter-rounds': () => shorterRule(run, ended, c),
  };
  for (const rule of RULES) {
    const reason = checks[rule]();
    if (reason) return { rule, reason: clip(reason) };
  }
  return null;
}
