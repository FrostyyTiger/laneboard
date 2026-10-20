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
//   latest score per metric with its trend (▲ ▼ =, `better` says which is good)
//   budget burn against the 5 h / 7 d windows (from the last `usage` event)
//   time left to the deadline, or the stop reason · cost · open needs
// Grey unless something needs you: a hue only for a worse score, a window
// near its stop level, an overage, an error or no-progress stop, an open need;
// each also carries a shape or a word.
//
// Everything in a summary was written by a loop: it goes in through
// textContent, title and setAttribute only. Pure at import time.
// Styles: public/css/views/runs.css (linked from index.html).
import { el } from '../core/dom.js';
import { money } from '../core/format.js';
import { lamp, panel, setPanel } from '../ui/components.js';

export const LIST_URL = '/api/runs';
export const POLL_MS = 15_000;
/** The loop's own stop levels (README §7): a window at or past one is drawn as trouble. */
export const WARN_5H = 90;
export const WARN_7D = 85;
/** At most this many scores per row, then `+n`. */
export const SCORE_MAX = 3;
const TEXT_MAX = 200;
const DASH = '—';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
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
  return { dir, good, mark: dir === 'up' ? '▲' : dir === 'down' ? '▼' : '=', delta };
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

/** usage {fiveHourPct, sevenDayPct, overage} -> {fiveHour, sevenDay, overage} (each null when unknown). */
export function burnOf(usage) {
  if (!isObj(usage)) return { fiveHour: null, sevenDay: null, overage: false };
  return {
    fiveHour: windowBurn(usage.fiveHourPct, WARN_5H),
    sevenDay: windowBurn(usage.sevenDayPct, WARN_7D),
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

/** A `wait` need is the loop sleeping (rate limit); every other kind needs a person. */
export function needsYou(row) {
  return needsOf(row).some((n) => n.kind !== 'wait');
}

const LIVE = { running: 0, waiting: 0, stopped: 1 };

/** Sort order: runs that need you first, then live runs, then latest activity. Returns a new array. */
export function sortRuns(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => isObj(r) && typeof r.run === 'string');
  const at = (r) => (isNum(r.updatedAt) ? r.updatedAt : isNum(r.startedAt) ? r.startedAt : 0);
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (needsYou(b.r) - needsYou(a.r))
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

function stateNode(row) {
  const s = stateOf(row);
  const n = el('span', 'rn-f rn-state');
  n.dataset.p = s.p;
  n.append(lamp(s.p, { label: s.title }), el('span', 'rn-state-t', s.word));
  n.title = s.title;
  return n;
}

function goalNode(row) {
  const n = el('span', 'rn-f rn-goal');
  const id = rnClean(row.run, 64) ?? '?';
  const goal = rnClean(row.goal);
  n.append(el('span', 'rn-goal-t', goal ?? id));
  const sub = [id, rnClean(row.branch, 80)].filter(Boolean).join(' · ');
  n.append(el('span', 'rn-goal-sub', goal ? sub : rnClean(row.branch, 80) ?? ''));
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
  const b = burnOf(row.usage);
  const n = el('span', 'rn-f rn-burn');
  n.append(meterNode('5h', b.fiveHour), meterNode('7d', b.sevenDay));
  if (b.overage) {
    const o = rnField('rn-over', '■ overage', 'the account is in paid extra usage');
    o.dataset.p = '1';
    n.append(o);
  }
  return n;
}

function needsNode(row) {
  const list = needsOf(row);
  const n = el('span', 'rn-f rn-needs');
  if (!list.length) {
    n.textContent = DASH;
    n.title = 'nothing open';
    return n;
  }
  const you = list.filter((x) => x.kind !== 'wait');
  n.dataset.p = you.length ? '2' : '3';
  const first = you[0] ?? list[0];
  n.append(el('span', 'rn-needs-n', `${you.length ? '▲' : '○'} ${list.length}`), el('span', 'rn-needs-t', `${first.kind}: ${first.text}`));
  n.title = list.map((x) => `${x.kind}: ${x.text}${x.link ? ` (${x.link})` : ''}`).join('\n');
  return n;
}

/** One `.rn-row` <li> for a summary row at `now`. */
export function runRow(row, now = Date.now()) {
  const li = el('li', 'rn-row');
  li.dataset.run = rnClean(row.run, 64) ?? '';
  li.dataset.state = STATE_META[row.state] ? row.state : 'running';
  if (needsYou(row)) li.dataset.needs = '';
  const left = timeLeft(row, now);
  const leftEl = rnField('rn-left', left.text, left.title);
  if (left.over) leftEl.dataset.p = '2';
  const stopP = row.state === 'stopped' ? STOP_P[rnClean(row.stop, 32)] : null;
  if (stopP && stopP !== 'ok') leftEl.dataset.p = stopP;
  const cost = isNum(row.cost?.usd) ? money(row.cost.usd) : DASH;
  li.append(
    stateNode(row),
    goalNode(row),
    rnField('rn-round', roundText(row), `round ${roundText(row)}${isNum(row.rounds) ? `, ${row.rounds} recorded` : ''}`),
    scoresNode(row),
    burnNode(row),
    leftEl,
    rnField('rn-cost', cost, 'cost of the run (sum of its cost events)'),
    needsNode(row),
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

function emptyNode(st) {
  const box = el('div', 'empty rn-empty');
  if (st.status === 'loading') { box.append(el('p', null, 'Loading the runs…')); return box; }
  if (st.status === 'unavailable') {
    box.append(el('p', null, 'Runs are read on a builder: this server has no runs route (a hub does not collect runs yet).'));
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

// ---------------------------------------------------------------- the view

const STATE_OF = { view: null };

function rnPaint(st) {
  if (!st.panel) return;
  const n = st.status === 'ok' ? st.runs.length : null;
  setPanel(st.panel.root, { n });
  renderRuns(st.panel.body, st.runs, { status: st.status, message: st.message }, Date.now());
}

async function rnRefresh(st) {
  const seq = ++st.seq;
  const res = await loadRuns(st.fetchFn);
  if (STATE_OF.view !== st || seq !== st.seq) return; // unmounted, or a newer load is running
  if (res.kind === 'ok') {
    st.status = 'ok';
    st.runs = res.runs;
  } else if (res.kind === 'unavailable') {
    st.status = 'unavailable';
    st.runs = [];
  } else {
    st.status = 'error';
    st.message = res.message;
    // keep the last good rows on a transient error
  }
  rnPaint(st);
}

/** Mount; `fetchFn` is injectable for tests (GET only). Returns the first load's promise. */
export function mountRuns(host, ctx = {}, { fetchFn = globalThis.fetch, poll = true } = {}) {
  if (!host) return Promise.resolve();
  unmountRuns();
  host.textContent = '';
  const st = { el: host, ctx, fetchFn, status: 'loading', message: null, runs: [], seq: 0, timer: null, panel: null };
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

/** A route or store change: repaint (time left moves); the poll does the fetching. */
export function updateRuns(_store, ctx = {}) {
  const st = STATE_OF.view;
  if (!st) return;
  st.ctx = { ...st.ctx, ...ctx };
  rnPaint(st);
}

export default {
  id: 'runs',
  icon: 'runs',
  title: 'Runs',
  mount: (host, ctx = {}) => { mountRuns(host, ctx); },
  unmount: () => unmountRuns(),
  update: (store, ctx = {}) => { updateRuns(store, ctx); },
};
