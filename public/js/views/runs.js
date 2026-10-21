// The Runs view `#/runs` (`g r`): one row per unattended agent run
// (docs/plans/runs/README.md §3 A2, task T7; protocol in docs/runs.md).
//
// Data: GET /api/runs -> {runs: [summary]} (server/routes/runs.mjs summarize),
// fetched by the view itself like the Audit and Morning views, every POLL_MS
// while it is shown. The route is builder-only for now: a hub answers 404,
// which renders a note, never an error banner.
//
// One row per run, worst first (open needs, then live runs, then latest
// activity):
//   state lamp + word · goal (run id, branch) · round n / max
//   latest score per metric with its trend (↑ ↓ =, never the ▲ status shape; `better` says which is good)
//   budget burn against the 5 h / 7 d windows (from the last `usage` event)
//   time left to the deadline, or the stop reason · cost · open needs
// A run the stuck rules flag (server/runs/stuck.mjs, `stuck: {rule, reason}`)
// carries the Board's stuck badge (the `stuck` icon, p2) next to its state
// word, and sorts after the runs that need you.
// Grey unless something needs you: a hue only for a worse score, a window
// near its stop level, an overage, an error or no-progress stop, an open need;
// each also carries a shape or a word.
//
// A run's page `#/runs?run=<id>` (task T8; the router checks the id against
// the protocol's pattern): GET /api/runs/<id> -> {run} (the whole fold),
// polled the same way. Under a header with the row's facts (a stopped run's
// reason and rounds follow STOPPED in its state label, T17): the open needs, the timeline of rounds (role, task, outcome, commit, cost,
// duration), the artifacts (PR links), and the unknown events folded away in
// a <details>. A row of the list opens its page through a plain link.
// An open need gets OPEN (its link) and ACK (task T28): ACK posts T4's
// `needs.ack` to POST /api/runs/events, the one write of this view.
// Between the header and the timeline (task T11): one small SVG line per
// score metric, x by round n on one scale shared by every metric and the
// timeline, y the metric's own range; the spark.js classes, no animation.
//
// Everything in a summary was written by a loop: it goes in through
// textContent, title and setAttribute only, and a link only when it is
// http(s) (safeHref). Pure at import time.
// Styles: public/css/views/runs.css (linked from index.html).
import { el } from '../core/dom.js';
import { money } from '../core/format.js';
import { icon } from '../core/icons.js';
import { lamp, panel, setPanel } from '../ui/components.js';
import { confirmAction } from '../ui/confirm.js';
import { needAckRef } from '../core/inbox-model.js';
import { toast } from '../ui/toast.js';
import { sparkRange } from '../ui/spark.js';

export const LIST_URL = '/api/runs';
/** The list's own hash, and a run page's (router.js parses `run` with the protocol's RUN_ID). */
export const LIST_HREF = '#/runs';
export const runHref = (id) => `${LIST_HREF}?run=${encodeURIComponent(id)}`;
export const runUrl = (id) => `${LIST_URL}/${encodeURIComponent(id)}`;
/** At most this many unknown events are shown, newest last; each clamped to RAW_MAX characters. */
export const RAW_SHOW = 50;
const RAW_MAX = 2000;
const URL_MAX = 2000;
export const POLL_MS = 15_000;
/** The loop's own stop levels (README §7): a window at or past one is drawn as trouble. */
export const WARN_5H = 90;
export const WARN_7D = 85;
/** At most this many scores per row, then `+n`. */
export const SCORE_MAX = 3;
const TEXT_MAX = 200;
const DASH = '—';
const SESSIONS_SHOW = 20; // sessions listed per round

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** The protocol's run id (server/runs/protocol.mjs RUN_ID): only such ids get a page link. */
export const RUN_ID_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Untrusted -> a display string (or null): control characters replaced, length clamped. */
export function rnClean(v, max = TEXT_MAX) {
  if (isNum(v)) v = String(v);
  if (typeof v !== 'string' || v === '') return null;
  const s = (typeof v.toWellFormed === 'function' ? v.toWellFormed() : v).replace(CONTROL, '\ufffd');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A link from a loop -> an absolute http(s) URL, or null (never `javascript:` and friends). */
export function safeHref(v) {
  // eslint-disable-next-line no-control-regex
  if (typeof v !== 'string' || v === '' || v.length > URL_MAX || /[\u0000-\u0020\u007f-\u009f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- pure models

/** Run state -> {p, word}: running is live, waiting is p3, stopped is grey. */
export const STATE_META = Object.freeze({
  running: Object.freeze({ p: 'run', word: 'running' }),
  waiting: Object.freeze({ p: '3', word: 'waiting' }),
  stopped: Object.freeze({ p: 'off', word: 'stopped' }),
});

/** Stop reasons that need a look: an error is p1, no progress is p2; `done` is ok. */
export const STOP_P = Object.freeze({ error: '1', 'no-progress': '2', overage: '2', done: 'ok' });

/** The lamp and word of a run: a stop reason colours a stopped run. */
export function stateOf(row) {
  const meta = STATE_META[row?.state] ?? STATE_META.running;
  if (row?.state !== 'stopped') return { p: meta.p, word: meta.word, title: meta.word };
  const reason = rnClean(row.stop, 32);
  return {
    p: STOP_P[reason] ?? 'off',
    word: 'stopped',
    title: reason ? `stopped: ${reason}` : 'stopped',
  };
}

/** A number as a score reads: integers as is, fractions to at most 3 places. */
export function scoreText(v) {
  if (!isNum(v)) return DASH;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(3)));
}

/**
 * One score summary {n, value, prev, better} -> {dir, good, mark, title}:
 * dir 'up' | 'down' | 'same' | null (no previous value); good true/false/null
 * (null when `better` is unknown or nothing moved).
 */
export function scoreTrend(s) {
  if (!isObj(s) || !isNum(s.value) || !isNum(s.prev)) return { dir: null, good: null, mark: '', delta: null };
  const delta = s.value - s.prev;
  const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const good = dir === 'same' || (s.better !== 'higher' && s.better !== 'lower') ? null
    : (dir === 'up') === (s.better === 'higher');
  return { dir, good, mark: dir === 'up' ? '↑' : dir === 'down' ? '↓' : '=', delta };
}

/** The row's scores, by name, each with its trend: [{name, value, text, dir, good, mark, title}]. */
export function scoreList(scores) {
  if (!isObj(scores)) return [];
  return Object.keys(scores).sort().map((k) => {
    const s = scores[k];
    const name = rnClean(k, 32) ?? '?';
    const t = scoreTrend(s);
    const text = scoreText(s?.value);
    const was = t.dir ? ` (was ${scoreText(s.prev)}${t.good === true ? ', better' : t.good === false ? ', worse' : ''})` : '';
    return { name, value: isNum(s?.value) ? s.value : null, text, ...t, title: `${name}: ${text}${was}` };
  });
}

/** The burn against one window: {pct, text, warn}; null when unknown. */
function windowBurn(pct, warnAt) {
  if (!isNum(pct)) return null;
  return { pct, text: `${Math.round(pct)}%`, warn: pct >= warnAt };
}

/**
 * usage {fiveHourPct, sevenDayPct, overage} -> {fiveHour, sevenDay, overage} (each null when unknown).
 * A stopped run burns nothing more, so its windows never warn (grey unless something needs you, T30).
 */
export function burnOf(usage, state = null) {
  if (!isObj(usage)) return { fiveHour: null, sevenDay: null, overage: false };
  const live = state !== 'stopped';
  return {
    fiveHour: windowBurn(usage.fiveHourPct, live ? WARN_5H : Infinity),
    sevenDay: windowBurn(usage.sevenDayPct, live ? WARN_7D : Infinity),
    overage: usage.overage === true,
  };
}

/** ms -> "2h 05m", "12m", "40s". */
export function spanText(ms) {
  if (!isNum(ms) || ms < 0) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * What is left of a run at `now`: the stop reason once it stopped, else the
 * time to `deadlineAt`. -> {text, title, over}.
 */
export function timeLeft(row, now) {
  if (row?.state === 'stopped') {
    const reason = rnClean(row.stop, 32) ?? 'unknown';
    return { text: reason, title: `stopped: ${reason}`, over: false };
  }
  if (!isNum(row?.deadlineAt)) return { text: DASH, title: 'no deadline', over: false };
  const left = row.deadlineAt - now;
  const at = rnClean(row.deadline, 40);
  if (left <= 0) return { text: 'past deadline', title: at ? `deadline ${at}` : 'past the deadline', over: true };
  return { text: `${spanText(left)} left`, title: at ? `deadline ${at}` : `${spanText(left)} to the deadline`, over: false };
}

/** "3 / 6", "3", or DASH before the first round. */
export function roundText(row) {
  const n = Number.isInteger(row?.round) ? row.round : null;
  const max = Number.isInteger(row?.maxRounds) && row.maxRounds > 0 ? row.maxRounds : null;
  if (n === null) return max ? `0 / ${max}` : DASH;
  return max ? `${n} / ${max}` : String(n);
}

/** The open needs of a row as [{kind, text, link}] (clamped). */
export function needsOf(row) {
  return (Array.isArray(row?.needs) ? row.needs : []).filter(isObj).map((n) => ({
    kind: rnClean(n.kind, 32) ?? 'decision',
    text: rnClean(n.text) ?? '',
    link: rnClean(n.link, 400),
  }));
}

/** Who an ack from the run page names (`needs.ack` `by`; the Inbox's is `inbox`). */
export const ACK_BY = 'run page';
/** Where an ack is posted (the runs route, docs/runs.md; no route of its own). */
export const EVENTS_URL = `${LIST_URL}/events`;

/**
 * One need of run `runId` -> its buttons: {ack, open}. `ack` is the
 * `needs.ack` event to post (an open need a person must answer, named by its
 * `ts`, or its place `i` from the fold when it has no time: core/inbox-model.js
 * needAckRef), `open` the need's http(s) link; both null on a closed need.
 */
export function needActions(need, runId) {
  if (!isObj(need) || need.open === false) return { ack: null, open: null };
  const kind = rnClean(need.kind, 32) ?? 'decision';
  const ack = kind !== 'wait' && Number.isInteger(need.i) && need.i >= 0
    && typeof runId === 'string' && RUN_ID_RX.test(runId)
    ? { v: 1, t: 'needs.ack', run: runId, ref: needAckRef(need), by: ACK_BY } : null;
  return { ack, open: safeHref(rnClean(need.link, 400)) };
}

/**
 * The acked needs of a folded run at `now`, oldest first: [{kind, text, by, at,
 * line, title}]. `line` is "acked by <by> <span> ago" (who closed it, night 4 T6;
 * `by` is "?" when the ack named no one), `title` the ack's ISO time.
 */
export function ackedNeedsOf(run, now = Date.now()) {
  return (Array.isArray(run?.needs) ? run.needs : []).filter((n) => isObj(n) && n.acked === true).map((n) => {
    const by = rnClean(n.by, 64) ?? '?';
    const at = isNum(n.ackedAt) ? n.ackedAt : null;
    const when = at !== null && now >= at ? ` ${spanText(now - at)} ago` : '';
    return {
      kind: rnClean(n.kind, 32) ?? 'decision',
      text: rnClean(n.text) ?? '',
      by,
      at,
      line: `acked by ${by}${when}`,
      title: at !== null ? `acked at ${new Date(at).toISOString()}` : 'acked',
    };
  });
}

/** A `wait` need is the loop sleeping (rate limit); every other kind needs a person. */
export function needsYou(row) {
  return needsOf(row).some((n) => n.kind !== 'wait');
}

/** The stuck verdict of a row as {rule, reason} (clamped), or null. */
export function stuckOf(row) {
  const s = row?.stuck;
  if (!isObj(s)) return null;
  const rule = rnClean(s.rule, 32);
  const reason = rnClean(s.reason, 160) ?? rule;
  return reason ? { rule, reason } : null;
}

const LIVE = { running: 0, waiting: 0, stopped: 1 };

/** Sort order: runs that need you first, then stuck ones, then live runs, then latest activity. Returns a new array. */
export function sortRuns(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => isObj(r) && typeof r.run === 'string');
  const at = (r) => (isNum(r.updatedAt) ? r.updatedAt : isNum(r.startedAt) ? r.startedAt : 0);
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (needsYou(b.r) - needsYou(a.r))
      || (Boolean(stuckOf(b.r)) - Boolean(stuckOf(a.r)))
      || ((LIVE[a.r.state] ?? 0) - (LIVE[b.r.state] ?? 0))
      || (at(b.r) - at(a.r))
      || (a.i - b.i))
    .map((x) => x.r);
}

/**
 * GET /api/runs. -> {kind:'ok', runs} | {kind:'unavailable', status} (404/503:
 * no runs route here, e.g. on a hub) | {kind:'error', message}. Never throws.
 */
export async function loadRuns(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(LIST_URL, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404 || r.status === 503) return { kind: 'unavailable', status: r.status };
    if (!r.ok) return { kind: 'error', message: `HTTP ${r.status}` };
    const body = await r.json();
    return { kind: 'ok', runs: Array.isArray(body?.runs) ? body.runs : [] };
  } catch (err) {
    return { kind: 'error', message: rnClean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

// ---------------------------------------------------------------- DOM

function rnField(cls, text, title) {
  const n = el('span', `rn-f ${cls}`, text);
  if (title) n.title = title;
  return n;
}

/** Lamp + word; on the run page a stopped run's `stop` (stopOf) follows the word (T17). */
function stateNode(row, stop = null) {
  const s = stateOf(row);
  const n = el('span', 'rn-f rn-state');
  n.dataset.p = s.p;
  n.append(lamp(s.p, { label: s.title }), el('span', 'rn-state-t', s.word));
  n.title = s.title;
  if (stop) {
    n.append(el('span', 'rn-state-why', `· ${stop.why}`));
    n.title = s.title = stop.title;
  }
  const stuck = stuckOf(row);
  if (stuck) {
    const words = `stuck: ${stuck.reason}`;
    const f = el('span', 'rn-stuck flag-stuck');
    f.dataset.p = '2';
    if (stuck.rule) f.dataset.rule = stuck.rule;
    f.title = words;
    f.append(icon('stuck', { size: 's', label: words }));
    n.append(f);
    n.title = `${s.title}\n${words}`;
  }
  return n;
}

/**
 * The goal and, on its second line, the run id and branch. A list row puts its
 * open need on that line too (`extra`, T31): a last column clipped it at 1440.
 */
function goalNode(row, asLink = false, extra = null) {
  const n = el('span', 'rn-f rn-goal');
  const id = rnClean(row.run, 64) ?? '?';
  const goal = rnClean(row.goal);
  if (asLink && RUN_ID_RX.test(row.run ?? '')) {
    const a = el('a', 'rn-goal-t rn-open', goal ?? id);
    a.href = runHref(row.run);
    n.append(a);
  } else {
    n.append(el('span', 'rn-goal-t', goal ?? id));
  }
  const sub = [id, rnClean(row.branch, 80)].filter(Boolean).join(' · ');
  const subEl = el('span', 'rn-goal-sub', goal ? sub : rnClean(row.branch, 80) ?? '');
  if (extra) {
    const line = el('span', 'rn-goal-2');
    line.append(subEl, extra);
    n.append(line);
  } else {
    n.append(subEl);
  }
  n.title = [goal, sub, rnClean(row.plan)].filter(Boolean).join('\n');
  return n;
}

function scoresNode(row) {
  const n = el('span', 'rn-f rn-scores');
  const list = scoreList(row.scores);
  for (const s of list.slice(0, SCORE_MAX)) {
    const chip = el('span', 'rn-score');
    if (s.good === false) chip.dataset.trend = 'worse';
    else if (s.good === true) chip.dataset.trend = 'better';
    chip.append(el('span', 'rn-score-k', s.name), el('span', 'rn-score-v', s.text));
    if (s.mark) chip.append(el('span', 'rn-score-m', s.mark));
    chip.title = s.title;
    n.append(chip);
  }
  if (list.length > SCORE_MAX) {
    n.append(rnField('rn-more', `+${list.length - SCORE_MAX}`, list.slice(SCORE_MAX).map((s) => s.title).join('\n')));
  }
  if (!list.length) {
    n.textContent = DASH;
    n.title = 'no scores yet';
  } else {
    n.title = list.map((s) => s.title).join('\n');
  }
  return n;
}

/** A label and its value in one cell (".rn-k" muted, ".rn-v" the value), like "5h ▬ 92%". */
function keyedField(cls, key, value, title) {
  const n = rnField(cls, null, title);
  n.append(el('span', 'rn-k', key), el('span', 'rn-v', value));
  return n;
}

/** Time left ("3h 05m left") or, once stopped, "stop <reason>" in one cell. */
function leftNode(row, now) {
  const left = timeLeft(row, now);
  const n = row?.state === 'stopped'
    ? keyedField('rn-left', 'stop', left.text, left.title)
    : rnField('rn-left', left.text, left.title);
  if (left.over) n.dataset.p = '2';
  return n;
}

/**
 * The cost a row shows -> {usd, text, title, loop}: the sum of the run's `cost`
 * events; when none was sent and the loop reported a `usd` at `run.stop`, that
 * figure instead, marked as the loop's own (`loop` true, T34).
 */
export function runCostOf(row) {
  const sum = isNum(row?.cost?.usd) ? row.cost.usd : null;
  const none = !(row?.cost?.rounds > 0) && !(sum > 0);
  if (none && isNum(row?.stopUsd)) {
    return {
      usd: row.stopUsd, text: money(row.stopUsd), loop: true,
      title: 'what the loop reported at run.stop (no cost events were sent)',
    };
  }
  return { usd: sum, text: sum === null ? DASH : money(sum), loop: false, title: 'cost of the run (sum of its cost events)' };
}

/** "cost $9.98" in one cell; "cost $2.00 loop" when the figure is the stop's (T34). */
function costNode(row) {
  const c = runCostOf(row);
  const n = keyedField('rn-cost', 'cost', c.text, c.title);
  if (c.loop) {
    n.dataset.src = 'stop';
    n.append(el('span', 'rn-k', 'loop'));
  }
  return n;
}

function meterNode(label, w) {
  const n = el('span', 'rn-win');
  n.append(el('span', 'rn-win-k', label));
  const bar = el('span', 'rn-bar');
  const fill = el('span', 'rn-bar-f');
  if (w) fill.style.width = `${Math.max(0, Math.min(100, w.pct))}%`;
  bar.append(fill);
  n.append(bar, el('span', 'rn-win-v', w ? w.text : DASH));
  if (w?.warn) n.dataset.p = '2';
  n.setAttribute('role', 'img');
  const words = w ? `${label} window ${w.text} used${w.warn ? ', near the stop level' : ''}` : `${label} window unknown`;
  n.setAttribute('aria-label', words);
  n.title = words;
  return n;
}

function burnNode(row) {
  const b = burnOf(row.usage, row.state);
  const n = el('span', 'rn-f rn-burn');
  n.append(meterNode('5h', b.fiveHour), meterNode('7d', b.sevenDay));
  if (b.overage) {
    const o = rnField('rn-over', '■ overage', 'the account is in paid extra usage');
    o.dataset.p = '1';
    n.append(o);
  }
  return n;
}

/**
 * The needs cell of a list row: one line "▲ decision: Keep the old…" (T29).
 * `mark` is ▲ when a person must answer, ○ when the run only waits; `count`
 * is the number of open needs, null when there is just one; `p` its hue.
 * Null when nothing is open.
 */
export function needsCell(row) {
  const list = needsOf(row);
  if (!list.length) return null;
  const you = list.filter((x) => x.kind !== 'wait');
  const first = you[0] ?? list[0];
  return {
    mark: you.length ? '▲' : '○',
    count: list.length > 1 ? list.length : null,
    p: you.length ? '2' : '3',
    text: `${first.kind}: ${first.text}`,
    title: list.map((x) => `${x.kind}: ${x.text}${x.link ? ` (${x.link})` : ''}`).join('\n'),
  };
}

/** The open need under a list row's goal, null when nothing is open (no "—" to read). */
function needsNode(row) {
  const c = needsCell(row);
  if (!c) return null;
  const n = el('span', 'rn-f rn-needs');
  n.dataset.p = c.p;
  n.append(el('span', 'rn-needs-n', c.count ? `${c.mark} ${c.count}` : c.mark), el('span', 'rn-needs-t', c.text));
  n.title = c.title;
  return n;
}

/** One `.rn-row` <li> for a summary row at `now`. */
export function runRow(row, now = Date.now()) {
  const li = el('li', 'rn-row');
  li.dataset.run = rnClean(row.run, 64) ?? '';
  li.dataset.state = STATE_META[row.state] ? row.state : 'running';
  if (needsYou(row)) li.dataset.needs = '';
  if (stuckOf(row)) li.dataset.stuck = '';
  const leftEl = leftNode(row, now);
  const stopP = row.state === 'stopped' ? STOP_P[rnClean(row.stop, 32)] : null;
  if (stopP && stopP !== 'ok') leftEl.dataset.p = stopP;
  li.append(
    stateNode(row),
    goalNode(row, true, needsNode(row)),
    rnField('rn-round', roundText(row), `round ${roundText(row)}${isNum(row.rounds) ? `, ${row.rounds} recorded` : ''}`),
    scoresNode(row),
    burnNode(row),
    leftEl,
    costNode(row),
  );
  return li;
}

/** How to start a run: what the empty state says. */
export const EMPTY_HOW = Object.freeze([
  'No runs yet. A run shows up here when a loop reports itself:',
  'laneboard run start --run nightly --goal "Make the tests green"',
  'or appends JSON lines to .laneboard/run.jsonl in a lane (runs.files reads other places).',
  'The protocol is in docs/runs.md.',
]);

/** What a server without a runs route (a hub) says: where runs live, what to do. */
export const EMPTY_HUB = Object.freeze([
  'This server collects no runs: a hub does not read run files yet.',
  'Open Runs on a builder, the machine the loop runs on, or see docs/runs.md for how a loop reports a run.',
]);

function emptyNode(st) {
  const box = el('div', 'empty rn-empty');
  if (st.status === 'loading') { box.append(el('p', null, 'Loading the runs…')); return box; }
  if (st.status === 'unavailable') {
    const [lead, next] = EMPTY_HUB;
    box.append(el('p', 'rn-empty-lead', lead), el('p', null, next));
    return box;
  }
  if (st.status === 'error') {
    box.append(el('p', null, `The runs could not be loaded: ${st.message ?? 'request failed'}.`));
    return box;
  }
  const [lead, cmd, alt, doc] = EMPTY_HOW;
  box.append(el('p', null, lead), el('code', 'rn-empty-cmd', cmd), el('p', null, alt), el('p', null, doc));
  return box;
}

/**
 * Paint `runs` (summaries) into `container`, replacing what was there.
 * `st` is {status: 'loading'|'ok'|'unavailable'|'error', message?}. Returns
 * {list, rows}: the list node (or the empty box) and the row nodes.
 */
export function renderRuns(container, runs, st = { status: 'ok' }, now = Date.now()) {
  const sorted = st.status === 'ok' || st.status === 'error' ? sortRuns(runs) : [];
  const rows = sorted.map((r) => runRow(r, now));
  let out;
  if (rows.length) {
    out = el('ol', 'rn-list');
    out.setAttribute('aria-label', `Runs, ${rows.length} ${rows.length === 1 ? 'run' : 'runs'}`);
    for (const r of rows) out.append(r);
  } else {
    out = emptyNode(st);
  }
  if (container) {
    container.textContent = '';
    container.append(out);
  }
  return { list: out, rows };
}

// ---------------------------------------------------------------- one run's page

/** The fold's latest value per score series, as the list's summary has it. */
function rnLastScores(run) {
  const out = {};
  const scores = isObj(run?.scores) ? run.scores : {};
  const better = isObj(run?.better) ? run.better : {};
  for (const [name, list] of Object.entries(scores)) {
    if (!Array.isArray(list) || !list.length) continue;
    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    out[name] = { n: last?.n ?? null, value: last?.value ?? null, prev: prev ? prev.value : null, better: better[name] ?? null };
  }
  return out;
}

/** A folded run (GET /api/runs/<id>) -> the summary shape the list helpers take. */
export function runSummaryOf(run) {
  if (!isObj(run)) return null;
  const rounds = Array.isArray(run.rounds) ? run.rounds.filter(isObj) : [];
  const last = rounds[rounds.length - 1] ?? null;
  return {
    run: run.run, goal: run.goal, plan: run.plan, branch: run.branch, state: run.state,
    round: Number.isInteger(last?.n) ? last.n : null,
    rounds: rounds.length,
    maxRounds: isObj(run.budget) ? run.budget.rounds ?? null : null,
    scores: rnLastScores(run),
    usage: run.usage, cost: run.cost, deadline: run.deadline, deadlineAt: run.deadlineAt,
    needs: (Array.isArray(run.needs) ? run.needs : []).filter((x) => isObj(x) && x.open !== false),
    artifacts: Array.isArray(run.artifacts) ? run.artifacts.length : 0,
    stop: isObj(run.stop) ? run.stop.reason : null,
    stopUsd: isObj(run.stop) && isNum(run.stop.usd) ? run.stop.usd : null,
    startedAt: run.startedAt, updatedAt: run.updatedAt,
  };
}

/**
 * The timeline: one entry per round, by `n`, at `now`:
 * {n, role, task, outcome, commit, usd, cost, ms, span, live, starts, sessions}.
 * A round with no end is `live` while the run is not stopped (its duration
 * runs to `now`); in a stopped run it just has no outcome.
 */
export function roundRows(run, now = Date.now()) {
  const stopped = run?.state === 'stopped';
  const rounds = (Array.isArray(run?.rounds) ? run.rounds : []).filter((r) => isObj(r) && Number.isInteger(r.n));
  return rounds.slice().sort((a, b) => a.n - b.n).map((r) => {
    const live = !isNum(r.endedAt) && !stopped;
    const end = isNum(r.endedAt) ? r.endedAt : live ? now : null;
    const ms = isNum(r.startedAt) && isNum(end) && end >= r.startedAt ? end - r.startedAt : null;
    const commit = rnClean(r.commit, 64);
    return {
      n: r.n,
      role: rnClean(r.role, 40),
      task: rnClean(r.task, 120),
      outcome: rnClean(r.outcome, 40) ?? (live ? 'running' : null),
      commit,
      short: commit ? commit.slice(0, 7) : null,
      usd: isNum(r.usd) ? r.usd : null,
      cost: isNum(r.usd) ? money(r.usd) : DASH,
      ms,
      span: ms === null ? DASH : spanText(ms),
      live,
      starts: Number.isInteger(r.starts) && r.starts > 1 ? r.starts : 1,
      sessions: roundSessions(r),
    };
  });
}

/**
 * The sessions tied to a round (T12, server/runs/bind.mjs), first seen first:
 * [{id, label, cost, usd, maybe, title}]. The label is the session's name, or
 * the first 8 characters of its id; `maybe` when another run worked in the
 * same dir at the same time. Bare ids (a fold without the bind) are taken too.
 */
export function roundSessions(r) {
  const list = Array.isArray(r?.sessions) ? r.sessions : [];
  const out = [];
  for (const x of list.slice(0, SESSIONS_SHOW)) {
    const s = typeof x === 'string' ? { sessionId: x, how: 'id' } : x;
    const id = isObj(s) && typeof s.sessionId === 'string' ? rnClean(s.sessionId, 128) : null;
    if (!id) continue;
    const usd = isNum(s.usd) ? s.usd : null;
    const how = s.how === 'cwd' ? 'by its dir and time' : 'named by the round';
    const bits = [id, how];
    if (rnClean(s.cwd, 300)) bits.push(rnClean(s.cwd, 300));
    if (s.maybe) bits.push('possibly: another run worked in this dir at the same time');
    out.push({
      id,
      label: rnClean(s.name, 40) ?? id.slice(0, 8),
      usd,
      cost: usd === null ? DASH : money(usd),
      maybe: s.maybe === true,
      title: bits.join(' · '),
    });
  }
  return out;
}

/**
 * The stop of a folded run -> {reason, p, why, text, title}, or null while it runs.
 * `why` ("budget · after 7 rounds") follows STOPPED in the run page's state label
 * (T17); the loop's own `usd` stays in the title, the head's cost cell has the sum.
 */
export function stopOf(run) {
  if (run?.state !== 'stopped') return null;
  const s = isObj(run.stop) ? run.stop : {};
  const reason = rnClean(s.reason, 32) ?? 'unknown';
  const bits = [reason];
  if (Number.isInteger(s.rounds)) bits.push(`after ${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}`);
  const why = bits.join(' · ');
  const title = [isNum(s.ts) ? `stopped at ${new Date(s.ts).toISOString()}` : `stopped: ${reason}`];
  if (isNum(s.usd)) title.push(`the loop reported ${money(s.usd)}`);
  return {
    reason,
    p: STOP_P[reason] ?? 'off',
    why,
    text: `stopped · ${why}`,
    title: title.join(' · '),
  };
}

/** Artifacts -> [{kind, title, href, n}]: `href` only for an http(s) URL. */
export function artifactsOf(run) {
  return (Array.isArray(run?.artifacts) ? run.artifacts : []).filter(isObj).map((a) => ({
    kind: rnClean(a.kind, 32) ?? 'link',
    title: rnClean(a.title) ?? rnClean(a.url, 400) ?? '?',
    url: rnClean(a.url, 400),
    href: safeHref(a.url),
    n: Number.isInteger(a.n) ? a.n : null,
  }));
}

/** The unknown events, newest last, at most RAW_SHOW: [{t, n, text}] (JSON text, clamped). */
export function rawOf(run) {
  const list = (Array.isArray(run?.raw) ? run.raw : []).filter(isObj);
  return {
    total: list.length,
    shown: list.slice(-RAW_SHOW).map((e) => {
      let text;
      try { text = JSON.stringify(isObj(e.raw) ? e.raw : e); } catch { text = '?'; }
      return { t: rnClean(e.t, 64) ?? '?', text: rnClean(text, RAW_MAX) ?? '' };
    }),
  };
}

/**
 * GET /api/runs/<id>. -> {kind:'ok', run} | {kind:'missing', status} (404:
 * no such run here, or no runs route) | {kind:'error', message}. Never throws.
 */
export async function loadRun(id, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(runUrl(id), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404 || r.status === 503) return { kind: 'missing', status: r.status };
    if (!r.ok) return { kind: 'error', message: `HTTP ${r.status}` };
    const body = await r.json();
    if (!isObj(body?.run)) return { kind: 'missing', status: r.status };
    return { kind: 'ok', run: body.run };
  } catch (err) {
    return { kind: 'error', message: rnClean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

function rnLink(cls, text, href) {
  if (!href) return el('span', cls, text);
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = href;
  return a;
}

function rnSection(cls, name, count) {
  const sec = el('section', `rn-sec ${cls}`);
  sec.append(el('h3', 'rn-sec-t', count === null ? name : `${name} (${count})`));
  return sec;
}

function pageHead(run, row, now) {
  const head = el('header', 'rn-head');
  const back = el('a', 'rn-back', '← Runs');
  back.href = LIST_HREF;
  const facts = el('div', 'rn-facts');
  const stop = stopOf(run);
  facts.append(
    rnField('rn-round', `round ${roundText(row)}`, isNum(row.rounds) ? `${row.rounds} rounds recorded` : null),
    scoresNode(row),
    burnNode(row),
  );
  // once stopped, the reason is in the state label: no second "stop …" cell (T17)
  if (!stop) facts.append(leftNode(row, now));
  facts.append(costNode(row));
  const ev = Number.isInteger(run.events) ? run.events : null;
  if (ev !== null) {
    const skipped = Number.isInteger(run.skipped) && run.skipped > 0 ? run.skipped : 0;
    const n = rnField('rn-events', `${ev} ${ev === 1 ? 'event' : 'events'}${skipped ? ` · ${skipped} skipped` : ''}`,
      skipped ? `${skipped} ${skipped === 1 ? 'line' : 'lines'} could not be read (docs/runs.md "Values")` : 'lines read');
    if (skipped) n.dataset.p = '3';
    facts.append(n);
  }
  const top = el('div', 'rn-head-top');
  top.append(stateNode(row, stop), goalNode(row));
  head.append(back, top, facts);
  return head;
}

function needButtons(acts, x, busy) {
  const box = el('span', 'rn-need-acts rn-need-end');
  if (acts.open) {
    const a = el('a', 'btn btn--s no rn-need-open');
    a.append(icon('external', { size: 's' }), el('span', 'btn-l', 'Open'));
    a.href = acts.open;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = acts.open;
    box.append(a);
  } else if (x.link) box.append(el('span', 'rn-item-l', x.link));
  if (acts.ack) {
    const b = el('button', 'btn btn--s ok rn-need-ack');
    b.type = 'button';
    b.append(icon('approve', { size: 's' }), el('span', 'btn-l', busy ? 'Sending…' : 'Ack'));
    b.title = 'Acknowledge this need: the run page and the Inbox stop showing it';
    if (busy) b.disabled = true;
    else b.addEventListener('click', () => { ackNeed(acts.ack); });
    box.append(b);
  }
  return box;
}

/**
 * A need row (night 4 T26) is a grid: mark, a fixed kind column (`rn-need-k`,
 * so open and closed texts start on one line), the text, and its end (`acked
 * by …` or OPEN/ACK, `rn-need-end`), which drops to its own right-aligned line
 * on a phone. A kind longer than the column is clipped, whole in its title.
 */
function needKind(kind) {
  const k = el('span', 'rn-item-k rn-need-k', kind);
  k.title = kind;
  return k;
}

/** The need's text with a break chance after each `/` (`<wbr>`), so a path wraps there, never inside a word. */
export function needText(text) {
  const t = el('span', 'rn-item-t rn-need-t');
  const parts = String(text ?? '').split(/(?<=\/)/);
  parts.forEach((part, k) => {
    t.append(document.createTextNode(part));
    if (k < parts.length - 1) t.append(document.createElement('wbr'));
  });
  return t;
}

function needsSection(row, run, now, busy = new Set()) {
  const list = needsOf(row);
  const raw = (Array.isArray(row?.needs) ? row.needs : []).filter(isObj); // needsOf's order, with `i` and `open`
  const sec = rnSection('rn-needs-sec', 'Open needs', list.length);
  const acked = ackedNeedsOf(run, now);
  if (!list.length) sec.append(el('p', 'rn-none', 'Nothing open.'));
  else sec.append(openNeedsList(row, list, raw, busy));
  if (acked.length) sec.append(ackedNeedsList(acked));
  return sec;
}

/** Closed needs, muted, each with who acked it. */
function ackedNeedsList(acked) {
  const ul = el('ul', 'rn-items rn-acked');
  for (const x of acked) {
    const li = el('li', 'rn-item rn-need rn-need--acked');
    li.dataset.p = 'off';
    li.append(el('span', 'rn-need-m', '✓'), needKind(x.kind), needText(x.text));
    const by = el('span', 'rn-item-n rn-need-by rn-need-end', x.line);
    by.title = x.title;
    li.append(by);
    ul.append(li);
  }
  return ul;
}

function openNeedsList(row, list, raw, busy) {
  const ul = el('ul', 'rn-items');
  list.forEach((x, k) => {
    const li = el('li', 'rn-item rn-need');
    const you = x.kind !== 'wait';
    li.dataset.p = you ? '2' : '3';
    li.append(el('span', 'rn-need-m', you ? '▲' : '○'), needKind(x.kind), needText(x.text));
    const acts = needActions(raw[k], rnClean(row.run, 64));
    if (acts.open || acts.ack || x.link) li.append(needButtons(acts, x, acts.ack ? busy.has(acts.ack.ref) : false));
    li.title = you ? 'needs a person' : 'the loop is waiting (a usage limit)';
    ul.append(li);
  });
  return ul;
}

const TL_COLS = [
  ['n', 'round'], ['role', 'role'], ['task', 'task'], ['outcome', 'outcome'],
  ['commit', 'commit'], ['cost', 'cost'], ['span', 'duration'], ['sessions', 'sessions'],
];
/** Columns a phone does not draw (runs.css, width < 700px, the phone breakpoint): the row carries task and duration as its title. */
export const TL_NARROW_HIDDEN = ['task', 'span', 'sessions'];
/** Columns drawn only when some row has a value (T40, reviews/25-designer.md: SESSIONS read `—` in every row). */
const TL_OPTIONAL = { sessions: (r) => r.sessions.length > 0 };

/** The rounds table's columns, [key, label] in order: an optional column no row fills is left out, header included. */
export function tlColumns(rows) {
  return TL_COLS.filter(([key]) => !TL_OPTIONAL[key] || rows.some(TL_OPTIONAL[key]));
}

function sessionsCell(list) {
  const td = el('td', 'rn-tl-ses');
  if (!list.length) { td.textContent = DASH; return td; }
  for (const s of list) {
    const span = el('span', 'rn-tl-s', `${s.maybe ? '? ' : ''}${s.label} ${s.cost}`);
    span.dataset.session = s.id;
    if (s.maybe) span.dataset.maybe = '';
    span.title = s.title;
    td.append(span);
  }
  return td;
}

function timelineSection(run, now) {
  const rows = roundRows(run, now);
  const sec = rnSection('rn-tl-sec', 'Rounds', rows.length);
  if (!rows.length) { sec.append(el('p', 'rn-none', 'No round has started yet.')); return sec; }
  const table = el('table', 'rn-tl');
  const cols = tlColumns(rows);
  const head = el('tr');
  for (const [key, label] of cols) {
    const th = el('th', null, label);
    th.setAttribute('scope', 'col');
    th.dataset.col = key;
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr', 'rn-tl-row');
    tr.dataset.n = String(r.n);
    if (r.live) tr.dataset.live = '';
    tr.title = [r.task ? `task: ${r.task}` : null, r.span && r.span !== DASH ? `took ${r.span}` : null].filter(Boolean).join(' · ');
    const nCell = el('td', 'rn-tl-n', String(r.n));
    if (r.starts > 1) {
      const re = el('span', 'rn-tl-re', ` ×${r.starts}`);
      re.title = `started ${r.starts} times (retries)`;
      nCell.append(re);
    }
    const commit = el('td', 'rn-tl-commit', r.short ?? DASH);
    if (r.commit) commit.title = r.commit;
    const outcome = el('td', 'rn-tl-outcome', r.outcome ?? DASH);
    if (r.outcome) outcome.dataset.outcome = r.outcome;
    const cells = {
      n: nCell,
      role: el('td', 'rn-tl-role', r.role ?? DASH),
      task: el('td', 'rn-tl-task', r.task ?? DASH),
      outcome,
      commit,
      cost: el('td', 'rn-tl-cost', r.cost),
      span: el('td', 'rn-tl-span', r.span),
      sessions: sessionsCell(r.sessions),
    };
    for (const [key] of cols) {
      cells[key].dataset.col = key;
      tr.append(cells[key]);
    }
    body.append(tr);
  }
  table.append(thead, body);
  sec.append(table);
  return sec;
}

function artifactsSection(run) {
  const list = artifactsOf(run);
  const sec = rnSection('rn-art-sec', 'Artifacts', list.length);
  if (!list.length) { sec.append(el('p', 'rn-none', 'Nothing produced yet.')); return sec; }
  const ul = el('ul', 'rn-items');
  for (const a of list) {
    const li = el('li', 'rn-item rn-art');
    li.append(el('span', 'rn-item-k', a.kind), rnLink('rn-item-t', a.title, a.href));
    if (a.n !== null) li.append(el('span', 'rn-item-n', `round ${a.n}`));
    if (!a.href && a.url) li.title = `${a.url} (not an http link)`;
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

// ---------------------------------------------------------------- score charts

export const CHART_W = 160;
export const CHART_H = 32;
const CHART_PAD = 1;
const SVGNS = 'http://www.w3.org/2000/svg';
const r2 = (v) => Math.round(v * 100) / 100;
/** A chart value: integers as is, fractions to 4 significant digits (0.9997 stays apart from 1). */
export const chartNum = (v) => (!isNum(v) ? DASH : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));

/** The rounds every chart spans: the run's round and score `n`s, {lo, hi}, or null. */
export function chartDomain(run) {
  const ns = [];
  for (const r of Array.isArray(run?.rounds) ? run.rounds : []) if (Number.isInteger(r?.n)) ns.push(r.n);
  const scores = isObj(run?.scores) ? run.scores : {};
  for (const list of Object.values(scores)) {
    for (const p of Array.isArray(list) ? list : []) if (Number.isInteger(p?.n) && isNum(p?.value)) ns.push(p.n);
  }
  if (!ns.length) return null;
  return { lo: Math.min(...ns), hi: Math.max(...ns) };
}

/**
 * One series [{n, value}] -> [{n, value, x, y}] in a w x h box: x by round n
 * on `dom` (a one-round domain sits at the right edge, like a sparkline's
 * single point), y in the series' own range (top is high, flat sits in the
 * middle). Several scores in one round: the last one counts.
 */
export function chartPoints(list, dom, w = CHART_W, h = CHART_H) {
  const byN = new Map();
  for (const p of Array.isArray(list) ? list : []) if (Number.isInteger(p?.n) && isNum(p?.value)) byN.set(p.n, p.value);
  if (!byN.size || !dom) return [];
  const pts = [...byN].sort((a, b) => a[0] - b[0]);
  const { lo, hi } = sparkRange(pts.map((p) => p[1]));
  const span = dom.hi - dom.lo;
  return pts.map(([n, value]) => {
    const x = span === 0 ? w - CHART_PAD : r2(CHART_PAD + ((n - dom.lo) * (w - 2 * CHART_PAD)) / span);
    const y = hi === lo ? r2(h / 2) : r2(CHART_PAD + (1 - (value - lo) / (hi - lo)) * (h - 2 * CHART_PAD));
    return { n, value, x, y };
  });
}

/**
 * The run's charts, by metric name: [{name, better, points, lo, hi, first,
 * last, trend, title}]. `trend` is the latest value against the one before
 * (scoreTrend), so the chart reads like the header's score.
 */
export function scoreCharts(run) {
  const scores = isObj(run?.scores) ? run.scores : {};
  const betterOf = isObj(run?.better) ? run.better : {};
  const dom = chartDomain(run);
  const out = [];
  for (const key of Object.keys(scores).sort()) {
    const points = chartPoints(scores[key], dom);
    if (!points.length) continue;
    const name = rnClean(key, 32) ?? '?';
    const better = betterOf[key] === 'lower' ? 'lower' : betterOf[key] === 'higher' ? 'higher' : null;
    const first = points[0];
    const last = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const trend = scoreTrend({ value: last.value, prev: prev ? prev.value : null, better });
    const { lo, hi } = sparkRange(points.map((p) => p.value));
    const way = better ? `, ${better} is better` : '';
    const title = points.length === 1
      ? `${name}: ${chartNum(last.value)} at round ${last.n}${way}`
      : `${name}: ${chartNum(first.value)} at round ${first.n} to ${chartNum(last.value)} at round ${last.n}, range ${chartNum(lo)} to ${chartNum(hi)}${way}`;
    out.push({ name, better, points, lo, hi, first, last, trend, title });
  }
  return out;
}

function svgNode(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function chartSvg(c) {
  const svg = svgNode('svg', {
    class: 'spark rn-chart-svg', viewBox: `0 0 ${CHART_W} ${CHART_H}`, width: CHART_W, height: CHART_H, role: 'img',
    // a narrow row stretches the line to its width (runs.css); the strokes do not scale (T26)
    preserveAspectRatio: 'none',
  });
  svg.setAttribute('aria-label', c.title);
  const title = document.createElementNS(SVGNS, 'title');
  title.textContent = c.title;
  svg.appendChild(title);
  if (c.points.length > 1) {
    svg.appendChild(svgNode('polyline', { class: 'spark-line', points: c.points.map((p) => `${p.x},${p.y}`).join(' ') }));
  }
  const last = c.last;
  // the last value: a zero-length line with a square cap, so it stays a 2 px square when stretched
  svg.appendChild(svgNode('line', { class: 'spark-last', x1: last.x, y1: last.y, x2: last.x, y2: last.y }));
  return svg;
}

function chartsSection(run) {
  const charts = scoreCharts(run);
  const sec = rnSection('rn-charts-sec', 'Scores', charts.length);
  if (!charts.length) { sec.append(el('p', 'rn-none', 'No score yet: a loop sends them with laneboard run score.')); return sec; }
  const ul = el('ul', 'rn-charts');
  for (const c of charts) {
    const li = el('li', 'rn-chart');
    li.dataset.metric = c.name;
    li.title = c.title;
    const val = el('span', 'rn-chart-v', `${chartNum(c.last.value)}${c.trend.mark ? ` ${c.trend.mark}` : ''}`);
    if (c.trend.good === false) val.dataset.p = '2';
    const range = c.points.length > 1 ? `${chartNum(c.lo)}–${chartNum(c.hi)}` : `round ${c.last.n}`;
    li.append(el('span', 'rn-chart-k', c.name), chartSvg(c), val, el('span', 'rn-chart-r', range));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

function rawSection(run) {
  const raw = rawOf(run);
  if (!raw.total) return null;
  const box = el('details', 'rn-raw');
  const more = raw.total > raw.shown.length ? `, the last ${raw.shown.length} shown` : '';
  box.append(el('summary', 'rn-raw-s', `${raw.total} other ${raw.total === 1 ? 'event' : 'events'} (types laneboard does not know${more})`));
  for (const e of raw.shown) box.append(el('pre', 'rn-raw-e', e.text));
  return box;
}

/**
 * Paint one run's page into `container`. `run` is the fold (or null), `st`
 * {status: 'loading'|'ok'|'missing'|'error', message?, id}. Returns the page node.
 */
export function renderRunPage(container, run, st = { status: 'ok' }, now = Date.now(), busy = new Set()) {
  const page = el('div', 'rn-page');
  const id = rnClean(st.id ?? run?.run, 64) ?? '?';
  if (!isObj(run)) {
    const back = el('a', 'rn-back', '← Runs');
    back.href = LIST_HREF;
    const box = el('div', 'empty rn-empty');
    const msg = st.status === 'loading' ? `Loading run ${id}…`
      : st.status === 'error' ? `The run could not be loaded: ${st.message ?? 'request failed'}.`
        : `No run ${id} here: it may be older than runs.keepDays, or this server collects no runs.`;
    box.append(el('p', null, msg));
    page.append(back, box);
  } else {
    const row = runSummaryOf(run);
    page.append(pageHead(run, row, now));
    if (st.status === 'error') page.append(el('p', 'rn-stale', `Not refreshed: ${st.message ?? 'request failed'}.`));
    page.append(needsSection(row, run, now, busy), chartsSection(run), timelineSection(run, now), artifactsSection(run));
    const raw = rawSection(run);
    if (raw) page.append(raw);
  }
  if (container) {
    container.textContent = '';
    container.append(page);
  }
  return page;
}

// ---------------------------------------------------------------- the view

const STATE_OF = { view: null };

/** The run id the route asks for (router.js already checked it), or null for the list. */
const routeRun = (ctx) => (typeof ctx?.route?.run === 'string' && RUN_ID_RX.test(ctx.route.run) ? ctx.route.run : null);

function rnPaint(st) {
  if (!st.panel) return;
  if (st.runId) {
    setPanel(st.panel.root, { scope: st.runId, n: null });
    st.panel.root.dataset.page = '';
    renderRunPage(st.panel.body, st.run, { status: st.status, message: st.message, id: st.runId }, Date.now(), st.busy);
    return;
  }
  const n = st.status === 'ok' ? st.runs.length : null;
  delete st.panel.root.dataset.page;
  setPanel(st.panel.root, { scope: null, n });
  renderRuns(st.panel.body, st.runs, { status: st.status, message: st.message }, Date.now());
}

async function rnRefresh(st) {
  const seq = ++st.seq;
  const id = st.runId;
  const res = id ? await loadRun(id, st.fetchFn) : await loadRuns(st.fetchFn);
  if (STATE_OF.view !== st || seq !== st.seq || id !== st.runId) return; // unmounted, newer load, or moved
  if (res.kind === 'ok') {
    st.status = 'ok';
    if (id) st.run = res.run;
    else st.runs = res.runs;
  } else if (res.kind === 'unavailable' || res.kind === 'missing') {
    st.status = id ? 'missing' : 'unavailable';
    st.runs = [];
    st.run = null;
  } else {
    st.status = 'error';
    st.message = res.message;
    // keep the last good rows (or run) on a transient error
  }
  rnPaint(st);
}

/** POST one event to EVENTS_URL -> true when the server took it. Never throws. */
async function postEvent(ev, fetchFn) {
  try {
    const r = await fetchFn(EVENTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-laneboard': '1' },
      body: JSON.stringify(ev),
      credentials: 'same-origin',
    });
    if (!r.ok) { toast(`Ack failed: HTTP ${r.status}`, { kind: 'err' }); return false; }
    return true;
  } catch (err) {
    toast(`Ack failed: ${rnClean(String(err?.message ?? err), 120) ?? 'request failed'}`, { kind: 'err' });
    return false;
  }
}

/**
 * The ACK button on an open need: confirmAction (click tier, like the Inbox's
 * `a`), post the `needs.ack` event, reload the page. `confirm` is injectable
 * for tests. Resolves to true when the server took it.
 */
export async function ackNeed(ev, { confirm = confirmAction } = {}) {
  const st = STATE_OF.view;
  if (!st || !ev || st.busy.has(ev.ref)) return false;
  const ok = await confirm({ action: 'ack', targets: [ev.run], tier: 'click' });
  if (!ok?.ok || STATE_OF.view !== st) return false;
  st.busy.add(ev.ref);
  rnPaint(st);
  let done;
  try {
    done = await postEvent(ev, st.postFn);
  } finally {
    st.busy.delete(ev.ref);
  }
  if (done) toast('Acknowledged', { kind: 'ok' });
  if (STATE_OF.view === st) await rnRefresh(st);
  return done;
}

/**
 * Mount; `fetchFn` is injectable for tests (GET only), `postFn` likewise for
 * the one POST (an ack). Returns the first load's promise.
 */
export function mountRuns(host, ctx = {}, { fetchFn = globalThis.fetch, postFn = fetchFn, poll = true } = {}) {
  if (!host) return Promise.resolve();
  unmountRuns();
  host.textContent = '';
  const st = {
    el: host, ctx, fetchFn, postFn, busy: new Set(), status: 'loading', message: null, runs: [], run: null,
    runId: routeRun(ctx), seq: 0, timer: null, panel: null,
  };
  st.panel = panel({ name: 'Runs' });
  host.append(st.panel.root);
  STATE_OF.view = st;
  rnPaint(st);
  if (poll && typeof setInterval === 'function') {
    st.timer = setInterval(() => { rnRefresh(st); }, POLL_MS);
    st.timer?.unref?.();
  }
  return rnRefresh(st);
}

export function unmountRuns() {
  const st = STATE_OF.view;
  if (!st) return;
  if (st.timer) clearInterval(st.timer);
  st.el.textContent = '';
  STATE_OF.view = null;
}

/**
 * A route or store change: a different `run` in the route switches between
 * the list and a page and loads at once (the returned promise); otherwise a
 * repaint (time left moves) and the poll does the fetching.
 */
export function updateRuns(_store, ctx = {}) {
  const st = STATE_OF.view;
  if (!st) return Promise.resolve();
  st.ctx = { ...st.ctx, ...ctx };
  const want = routeRun(st.ctx);
  if (want !== st.runId) {
    st.runId = want;
    st.status = 'loading';
    st.message = null;
    st.run = null;
    rnPaint(st);
    return rnRefresh(st);
  }
  rnPaint(st);
  return Promise.resolve();
}

export default {
  id: 'runs',
  icon: 'runs',
  title: 'Runs',
  mount: (host, ctx = {}) => { mountRuns(host, ctx); },
  unmount: () => unmountRuns(),
  update: (store, ctx = {}) => { updateRuns(store, ctx); },
};
