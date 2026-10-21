// The Morning view. Moved from public/app.js (fleet F1); fleet blocks (fleet R15,
// plan §10 2.11/2.12).
//
// Data: hub mode reads GET /api/fleet/morning?window=&b= (server/hub/morning.mjs
// mergeMorning: builders[], review, stuck, approvals, costByPackage, totals,
// missing, deferred); builder mode reads GET /api/morning (morning.build()), which
// the view wraps as one builder with empty fleet blocks. Both go through the pure
// morningModel() before anything is drawn, so the renderer sees one shape.
//
// Hub mode is grouped by builder: one panel per builder (needs you, finished,
// stuck incidents, what it cost), then the fleet blocks: review wait, approvals
// answered, cost by package (equal split, so "≈"), and what the notifier held
// back while you were away (quiet hours or rate limit). A builder that did not
// answer draws no block: the summary strip names it with a stale lamp (runs
// plan T33). A fleet block with nothing in the window is not drawn either; the
// empty ones share one muted line at the end ("Nothing on review wait, …").
//
// Runs (runs plan A3, T7): one block per run with events in the window
// (server/runs/digest.mjs runsInWindow, `runs` in GET /api/morning): goal
// linking to the run page, rounds, each score start -> end with its direction,
// the stop reason, PR chips and the cost. A payload without `runs` (an older
// builder, or the hub merge, which does not carry them yet) draws no block.
//
// Everything in the payload was written by a builder or its agents: it goes in
// through textContent, title or dataset only, never markup.
import { $, el } from '../core/dom.js';
import { STATE_LABEL, ago, compactCount, money, resetsIn } from '../core/format.js';
import { localBuilderId, store, toIndexKey } from '../core/store.js';
import { BUILDER_ID_RX, deriveCode, fkey, parseFkey } from '../core/keys.js';
import { act } from '../core/actions.js';
import { setView } from '../core/router.js';
import { block, gauge, laneStripe, prChip } from '../ui/widgets.js';
import { lamp, panel } from '../ui/components.js';
import { toast } from '../ui/shell.js';
import { openSheet } from '../ui/sheet.js';
import { RUN_ID_RX, STOP_P, STATE_META, burnOf, rnClean, runHref, safeHref, scoreText } from './runs.js';

// ---------------------------------------------------------------- morning
//
// The view is fetched rather than derived from the socket: it needs database
// history (cost snapshots, markers over a window) that the live snapshot does
// not carry, and it is read once in the morning rather than watched all day.

/**
 * The fleet key of something the Morning payload names by local id. The
 * payload comes from this page's own builder (GET /api/morning) unless an
 * entry carries its builder; a hub payload already names things by fleet key.
 */
export function morningKey(entry, local) {
  if (local === undefined || local === null || local === '') return null;
  const b = typeof entry?.builder === 'string' && BUILDER_ID_RX.test(entry.builder) ? entry.builder : localBuilderId(store);
  const s = String(local);
  const p = parseFkey(s);
  if (p && p.builder === b && typeof entry?.builder === 'string') return s;
  try { return fkey(b, s); } catch { return null; }
}

export const morning = { window: 'tonight', data: null, loading: false, at: 0, url: null, hub: false, b: 'all' };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** True when the page is fed by a hub. */
export function morningIsHub(s) {
  return (s ?? store)?.source?.kind === 'hub';
}

/** The fetch URL for a window: the hub's fleet merge (optionally one builder), or the builder's own. */
export function morningUrl(window, { hub = false, b = 'all' } = {}) {
  const w = /^[a-z0-9]{1,16}$/.test(String(window)) ? String(window) : 'tonight';
  if (!hub) return `/api/morning?window=${encodeURIComponent(w)}`;
  const one = typeof b === 'string' && b !== 'all' && BUILDER_ID_RX.test(b) ? `&b=${encodeURIComponent(b)}` : '';
  return `/api/fleet/morning?window=${encodeURIComponent(w)}${one}`;
}

/** The local part of a fleet key ("builder-a/web" -> "web"); anything else as text. */
export function localPart(k) {
  const p = parseFkey(k);
  return p ? p.name : txt(k);
}

/** 90061000 -> "1d 1h"; 61000 -> "1m"; null -> "—". */
export function dur(ms) {
  const v = fin(ms);
  if (v === null || v < 0) return '—';
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function codeFor(id, given, s) {
  if (typeof given === 'string' && /^[A-Z0-9]{2,3}$/.test(given)) return given;
  const b = s?.builders?.get?.(id);
  if (b && typeof b.code === 'string' && b.code) return b.code;
  return BUILDER_ID_RX.test(id) ? deriveCode(id) : '?';
}

function costOf(c) {
  const lanes = arr(c?.lanes).filter(isObj);
  return {
    lanes,
    totalUsd: fin(c?.totalUsd) ?? lanes.reduce((a, l) => a + (fin(l.usd) ?? 0), 0),
    totalTokens: fin(c?.totalTokens) ?? lanes.reduce((a, l) => a + (fin(l.tokens) ?? 0), 0),
    label: typeof c?.label === 'string' ? c.label : 'API-equivalent',
  };
}

function morningBuilderOf(x, s) {
  const id = typeof x?.id === 'string' && BUILDER_ID_RX.test(x.id) ? x.id : localBuilderId(s);
  return {
    id,
    code: codeFor(id, x?.code, s),
    error: typeof x?.error === 'string' && x.error ? x.error : null,
    stale: x?.stale === true || (typeof x?.error === 'string' && x.error !== ''),
    needsYou: arr(x?.needsYou).filter(isObj),
    finished: arr(x?.finished).filter(isObj),
    cost: costOf(x?.cost),
    stuck: [],
  };
}

// --- runs (T7) ----------------------------------------------------------------

/** One digest score {start, end, better} -> {name, text, dir, good, mark, title}. */
export function runScoreOf(name, s) {
  const start = fin(s?.start);
  const end = fin(s?.end);
  const better = s?.better === 'higher' || s?.better === 'lower' ? s.better : null;
  const dir = start === null || end === null ? null : end > start ? 'up' : end < start ? 'down' : 'same';
  const good = dir === null || dir === 'same' || better === null ? null : (dir === 'up') === (better === 'higher');
  const mark = dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'same' ? '=' : '';
  const text = start === null || start === end ? scoreText(end ?? start) : `${scoreText(start)} → ${scoreText(end)}`;
  const word = good === true ? ', better' : good === false ? ', worse' : '';
  return { name, text, dir, good, mark, title: `${name}: ${scoreText(start)} → ${scoreText(end)}${word}` };
}

/** A PR URL -> {href, text} ("PR #12"), or null when it is not http(s). */
export function runPrOf(url) {
  const href = safeHref(url);
  if (!href) return null;
  const n = /\/pull\/(\d{1,9})(?:[/?#]|$)/.exec(href)?.[1];
  return { href, text: n ? `PR #${n}` : 'PR' };
}

/** One digest row (server/runs/digest.mjs) -> what the block draws; null when it names no run. */
export function morningRunOf(r, builder = null) {
  if (!isObj(r)) return null;
  const id = rnClean(r.run, 64);
  if (!id) return null;
  const state = Object.hasOwn(STATE_META, r.state) ? r.state : r.stop ? 'stopped' : 'running';
  const reason = rnClean(r.stop, 32);
  const scores = isObj(r.scores) ? r.scores : {};
  const usage = burnOf(r.usage, state);
  return {
    run: id,
    builder: typeof builder === 'string' && BUILDER_ID_RX.test(builder) ? builder : null,
    href: RUN_ID_RX.test(id) ? runHref(id) : null,
    goal: rnClean(r.goal) ?? id,
    state,
    rounds: Number.isInteger(r.rounds) && r.rounds >= 0 ? r.rounds : 0,
    scores: Object.keys(scores).sort().map((k) => runScoreOf(rnClean(k, 32) ?? '?', scores[k])),
    stop: state === 'stopped' ? { reason: reason ?? 'unknown', p: STOP_P[reason] ?? 'off' } : null,
    prs: arr(r.prs).map(runPrOf).filter(Boolean),
    usd: fin(r.usd),
    usage,
  };
}

/** The runs of a payload: its own `runs`, then any a builder row carries (a future hub merge). */
export function morningRuns(data) {
  const out = arr(data?.runs).map((r) => morningRunOf(r, typeof data?.builder === 'string' ? data.builder : null));
  for (const b of arr(data?.builders).filter(isObj)) {
    for (const r of arr(b.runs)) out.push(morningRunOf(r, b.id));
  }
  return out.filter(Boolean);
}

const EMPTY_REVIEW = Object.freeze({ n: 0, waiting: 0, medianWaitMs: null, p90WaitMs: null, longest: [] });
const EMPTY_APPROVALS = Object.freeze({ answered: 0, approved: 0, denied: 0, released: 0, medianAnswerMs: null });

/**
 * The fleet blocks with nothing in the window, in drawing order, by the words
 * the one muted line uses (T33): ['review wait', 'approvals', 'package cost', 'held back'].
 */
export function emptyFleetBlocks(m) {
  const out = [];
  const r = m.review;
  if (!r.n && !r.waiting && !r.longest.length) out.push('review wait');
  const a = m.approvals;
  if (!a.answered && !a.approved && !a.denied && !a.released) out.push('approvals');
  if (!m.costByPackage.length) out.push('package cost');
  if (!m.deferred.length) out.push('held back');
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The window's start for the head row, short and in local time (`since 20 Oct
 * 18:00`): no year, no seconds, so it stays on the picker's row at 390 (runs
 * plan T41). null when there is no start.
 */
export function sinceText(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `since ${d.getDate()} ${MONTHS[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * Any Morning payload -> one shape:
 *   {hub, error?, window, label, since, sinceText, builders:[{id, code, error, stale, needsYou,
 *    finished, cost, stuck}], totals:{needsYou, finished, usd, tokens, sessions:{finished,
 *    usd}, runs:{finished, usd}} (finished/usd = sessions + runs stopped in the window), review,
 *    approvals, costByPackage, stuck (no known builder), deferred, missing, rateLimits,
 *    runs:[morningRunOf()], empty:[emptyFleetBlocks()]}
 * `hub` is whether the page is fed by a hub. A hub merge has `builders[]`; a hub
 * `?b=` answer is one builder row; a builder's own answer is wrapped as one builder.
 */
export function morningModel(data, { hub = false, s = null } = {}) {
  s = s ?? store;
  if (!isObj(data)) return { hub, error: 'bad response' };
  if (typeof data.error === 'string' && !Array.isArray(data.builders) && !(hub && typeof data.id === 'string')) {
    return { hub, error: data.error };
  }
  const fleet = Array.isArray(data.builders);
  let rows;
  if (fleet) rows = data.builders.filter(isObj).map((x) => morningBuilderOf(x, s));
  else if (hub && typeof data.id === 'string') rows = [morningBuilderOf(data, s)];
  else rows = [morningBuilderOf({ ...data, id: typeof data.builder === 'string' ? data.builder : undefined, error: undefined }, s)];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const stuckFleet = [];
  for (const x of arr(data.stuck).filter(isObj)) {
    const b = typeof x.builder === 'string' ? x.builder : parseFkey(x.fkey)?.builder;
    const row = b ? byId.get(b) : null;
    (row ? row.stuck : stuckFleet).push(x);
  }
  const rv = isObj(data.review) ? data.review : EMPTY_REVIEW;
  const ap = isObj(data.approvals) ? data.approvals : EMPTY_APPROVALS;
  const missing = new Set(arr(data.missing).filter((m) => typeof m === 'string'));
  for (const r of rows) if (r.error) missing.add(r.id);
  const runs = morningRuns(data);
  // A run that stopped in the window finished there too, and what it cost is
  // spend (runs plan T32): the strip counts sessions and runs, kept apart below
  // so the package table still totals sessions only.
  const sessions = {
    finished: rows.reduce((a, r) => a + r.finished.length, 0),
    usd: fin(data.totalUsd) ?? rows.reduce((a, r) => a + r.cost.totalUsd, 0),
  };
  const runTotals = {
    finished: runs.filter((r) => r.state === 'stopped').length,
    usd: runs.reduce((a, r) => a + (r.usd ?? 0), 0),
  };
  const m = {
    hub,
    fleet: hub,
    window: typeof data.window === 'string' ? data.window : morning.window,
    label: typeof data.label === 'string' ? data.label : null,
    since: fin(data.since),
    sinceText: sinceText(fin(data.since)),
    builders: rows,
    totals: {
      needsYou: rows.reduce((a, r) => a + r.needsYou.length, 0),
      finished: sessions.finished + runTotals.finished,
      usd: sessions.usd + runTotals.usd,
      sessions,
      runs: runTotals,
      tokens: fin(data.totalTokens) ?? rows.reduce((a, r) => a + r.cost.totalTokens, 0),
    },
    review: {
      n: fin(rv.n) ?? 0,
      waiting: fin(rv.waiting) ?? 0,
      medianWaitMs: fin(rv.medianWaitMs),
      p90WaitMs: fin(rv.p90WaitMs),
      longest: arr(rv.longest).filter(isObj),
    },
    approvals: {
      answered: fin(ap.answered) ?? 0,
      approved: fin(ap.approved) ?? 0,
      denied: fin(ap.denied) ?? 0,
      released: fin(ap.released) ?? 0,
      medianAnswerMs: fin(ap.medianAnswerMs),
    },
    costByPackage: arr(data.costByPackage).filter(isObj),
    stuck: stuckFleet,
    deferred: arr(data.deferred).filter(isObj),
    missing: [...missing].sort(),
    rateLimits: isObj(data.rateLimits) ? data.rateLimits : null,
    runs,
  };
  m.empty = emptyFleetBlocks(m);
  return m;
}

export async function loadMorning(force = false) {
  if (morning.loading) return;
  const hub = morningIsHub(store);
  const url = morningUrl(morning.window, { hub, b: morning.b });
  if (!force && morning.data && morning.url === url && Date.now() - morning.at < 20000) return;
  morning.loading = true;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    morning.data = await r.json();
    morning.at = Date.now();
  } catch (err) {
    morning.data = { error: err.message };
  } finally {
    morning.url = url;
    morning.hub = hub;
    morning.loading = false;
    renderMorning();
  }
}

export function renderMorning() {
  const box = $('morning-body');
  if (!box) return;
  for (const btn of $('morning-window')?.children || []) {
    btn.classList.toggle('on', btn.dataset.window === morning.window);
  }
  box.textContent = '';
  if (!morning.data) { box.append(el('p', 'empty', 'Loading…')); return; }
  const m = morningModel(morning.data, { hub: morning.hub });
  if (m.error) { box.append(el('p', 'empty', `Could not load: ${m.error}`)); return; }
  const sinceEl = $('morning-since');
  if (sinceEl && m.sinceText) sinceEl.textContent = m.sinceText;
  renderModel(box, m);
}

// ---------------------------------------------------------------- render

/** Paint a morningModel() into `box` (cleared by the caller). Exported for tests. */
export function renderModel(box, m) {
  const runs = m.runs?.length ? runsBlock(m.runs) : null;
  if (!m.hub) {
    const b = m.builders[0];
    if (runs) box.append(runs);
    if (b) for (const n of builderBlocks(b, m)) box.append(n);
    return box;
  }
  box.append(morningSummary(m));
  if (runs) box.append(runs);
  // A builder with no answer is the strip's "no answer from …" line, not a block.
  for (const b of m.builders) if (!b.error) box.append(builderGroup(b, m));
  if (!m.builders.length) box.append(el('p', 'empty', 'No builder is configured.'));
  const empty = new Set(m.empty ?? []);
  if (!empty.has('review wait')) box.append(reviewBlock(m.review, m));
  if (m.stuck.length) box.append(stuckBlock(m.stuck, 'Stuck incidents · fleet'));
  if (!empty.has('approvals')) box.append(approvalsBlock(m.approvals));
  if (!empty.has('package cost')) box.append(packageBlock(m.costByPackage, m.totals.sessions.usd));
  if (!empty.has('held back')) box.append(deferredBlock(m.deferred, m));
  if (empty.size) box.append(el('p', 'empty morning-quiet', `Nothing on ${[...empty].join(', ')}.`));
  return box;
}

function kv(k, v, cls = '') {
  const n = el('span', `mkv ${cls}`.trim());
  n.append(el('span', 'mkv-k', k));
  n.append(el('span', 'mkv-v', v));
  return n;
}

function morningSummary(m) {
  const sec = el('section', 'mblock morning-summary');
  const row = el('div', 'mrow-top');
  row.append(kv('builders', String(m.builders.length)));
  row.append(kv('needs you', String(m.totals.needsYou), m.totals.needsYou ? 'warn' : ''));
  const { sessions, runs } = m.totals;
  const finCell = kv('finished', String(m.totals.finished));
  finCell.title = `${sessions.finished} lanes + ${runs.finished} runs stopped`;
  row.append(finCell);
  const spend = kv('spend', money(m.totals.usd));
  spend.title = `sessions ${money(sessions.usd)} + runs ${money(runs.usd)}`;
  row.append(spend);
  row.append(kv('tokens', compactCount(m.totals.tokens)));
  row.append(kv('review', `${m.review.n} · ${m.review.waiting} waiting`));
  row.append(kv('approvals', String(m.approvals.answered)));
  sec.append(row);
  if (m.missing.length) {
    const miss = el('div', 'mrow-sub morning-missing');
    miss.append(lamp('stale', { label: 'stale: did not answer' }));
    miss.append(el('span', null, ` no answer from ${m.missing.join(', ')}`));
    const why = m.builders.filter((b) => b.error).map((b) => `${b.id}: ${b.error}`);
    if (why.length) miss.title = why.join('\n');
    sec.append(miss);
  }
  return sec;
}

function builderGroup(b, m) {
  const p = panel({ name: b.code, scope: b.id, n: b.needsYou.length });
  p.root.classList.add('morning-builder');
  p.root.dataset.builder = b.id;
  // [0] already says nothing waits; a lone hollow lamp on the frame read as a toggle (T37)
  if (b.needsYou.length) p.tools.append(lamp('2', { label: 'needs you' }));
  for (const n of builderBlocks(b, m)) p.body.append(n);
  return p.root;
}

function builderBlocks(b, m) {
  const out = [needsBlock(b), finishedBlock(b)];
  if (m.hub) out.push(stuckBlock(b.stuck, 'Stuck incidents'));
  out.push(costBlock(b.cost, m.rateLimits));
  return out;
}

// --- runs ------------------------------------------------------------------

function runsBlock(list) {
  const sec = block('Runs', list.length);
  for (const r of list) {
    const row = el('div', 'mrow morning-run');
    row.dataset.run = r.run;
    const p = r.stop ? r.stop.p : STATE_META[r.state].p;
    row.append(lamp(p, { label: r.stop ? `stopped: ${r.stop.reason}` : STATE_META[r.state].word }));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    const goal = r.href ? el('a', 'mrow-name', r.goal) : el('span', 'mrow-name', r.goal);
    if (r.href) goal.setAttribute('href', r.href);
    goal.title = r.run;
    top.append(goal);
    top.append(el('span', 'mrow-stage', `${r.rounds} ${r.rounds === 1 ? 'round' : 'rounds'}`));
    top.append(el('span', 'mrow-kind', r.stop ? `stopped: ${r.stop.reason}` : STATE_META[r.state].word));
    if (r.usd !== null) top.append(el('span', 'mrow-age', money(r.usd)));
    if (r.usage.fiveHour) top.append(el('span', 'mrow-age', `5h ${r.usage.fiveHour.text}`));
    main.append(top);
    if (r.scores.length || r.prs.length) {
      const sub = el('div', 'mrow-top morning-run-sub');
      for (const s of r.scores) {
        const chip = el('span', 'rn-score');
        chip.title = s.title;
        if (s.good === false) chip.dataset.trend = 'worse';
        else if (s.good === true) chip.dataset.trend = 'better';
        chip.append(el('span', 'rn-score-k', s.name));
        chip.append(el('span', 'rn-score-v', s.text));
        if (s.mark) chip.append(el('span', 'rn-score-m', s.mark));
        sub.append(chip);
      }
      for (const pr of r.prs) {
        const a = el('a', 'chip-pr pr-link', pr.text);
        a.setAttribute('href', pr.href);
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = pr.href;
        sub.append(a);
      }
      main.append(sub);
    }
    row.append(main);
    sec.append(row);
  }
  return sec;
}

// --- needs you -------------------------------------------------------------

function needsBlock(b) {
  const needs = block('Needs you', b.needsYou.length);
  if (!b.needsYou.length) needs.append(el('p', 'empty', 'Nothing is waiting.'));
  for (const n of b.needsYou) {
    const kind = txt(n.kind);
    const row = el('div', 'mrow');
    if (/^[a-z_]{1,32}$/.test(kind)) row.classList.add(`need-${kind}`);
    row.append(laneStripe(fin(n.hue)));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-kind', kind));
    top.append(el('span', 'mrow-name', n.name ? localPart(n.name) : '—'));
    if (n.lane) top.append(el('span', 'mrow-lane', localPart(n.lane)));
    top.append(el('span', 'mrow-age', ago(fin(n.at))));
    main.append(top);
    // Full text, wrapped, never truncated: this is the one place the whole
    // sentence a lane wrote is worth reading.
    if (n.text) main.append(el('div', 'mrow-text', txt(n.text)));
    row.append(main);
    const acts = el('div', 'mrow-acts');
    const k = n.name ? morningKey(n, n.name) : null;
    const ik = k ? toIndexKey(store, k) : null;
    if (ik && store.sessions.has(ik)) {
      const open = el('button', 'btn', 'Open');
      open.onclick = () => { setView('board'); openSheet(ik); };
      acts.append(open);
    }
    if (n.source === 'marker' && n.markerId != null) {
      const dis = el('button', 'btn', 'Dismiss');
      dis.onclick = async () => {
        dis.disabled = true;
        const r = await act(morningKey(n, n.markerId) ?? String(n.markerId), 'dismiss-marker');
        if (r?.ok === true) { toast('Dismissed'); loadMorning(true); } else {
          toast(r?.ok === 'unknown' ? 'Sent, outcome unknown' : `Failed: ${r?.error ?? 'no answer'}`);
          dis.disabled = false;
        }
      };
      acts.append(dis);
    }
    row.append(acts);
    needs.append(row);
  }
  return needs;
}

// --- finished --------------------------------------------------------------

function finishedBlock(b) {
  const sec = block('Finished', b.finished.length);
  if (!b.finished.length) sec.append(el('p', 'empty', 'No lane moved in this window.'));
  for (const f of b.finished) {
    const row = el('div', 'mrow');
    row.append(laneStripe(fin(f.hue)));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-name', localPart(f.lane)));
    if (f.progress?.n != null) top.append(el('span', 'mrow-stage', `${txt(f.progress.n)} of ${txt(f.progress.m)}`));
    if (f.branch) top.append(el('span', 'mrow-branch', `⌥${txt(f.branch)}`));
    if (!f.isMain && f.merged === true) top.append(el('span', 'lane-merged', 'merged'));
    if (!f.isMain && f.merged === false) top.append(el('span', 'lane-unmerged', 'unmerged'));
    if (isObj(f.pr)) top.append(prChip(f.pr));
    if (fin(f.lastCommitAt)) top.append(el('span', 'mrow-age', `commit ${ago(f.lastCommitAt)}`));
    for (const p of arr(f.packages).slice(0, 6)) top.append(el('span', 'mrow-pkg', txt(p)));
    main.append(top);
    const states = arr(f.sessions).filter(isObj)
      .map((s) => `${localPart(s.name)} · ${STATE_LABEL[s.state] || txt(s.state)}`).join('   ');
    main.append(el('div', 'mrow-sub', states || 'no session running'));
    for (const d of arr(f.doneMarkers).filter(isObj)) main.append(el('div', 'mrow-text mrow-done', txt(d.text)));
    row.append(main);
    sec.append(row);
  }
  return sec;
}

// --- what it cost ----------------------------------------------------------

function morningTable(head) {
  const t = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const [h, cls] of head) hr.append(el('th', cls, h));
  thead.append(hr);
  t.append(thead);
  const tbody = el('tbody');
  t.append(tbody);
  return { t, tbody };
}

function costBlock(c, rateLimits) {
  const cost = block('What it cost', null);
  const { t, tbody } = morningTable([['lane', ''], ['spend', 'num'], ['tokens', 'num'], ['sessions', '']]);
  for (const l of c.lanes) {
    if (!(fin(l.usd) > 0.0005)) continue;
    const tr = el('tr');
    const td = el('td');
    td.append(laneStripe(fin(l.hue)));
    td.append(el('span', null, l.lane ? localPart(l.lane) : txt(l.label) || '(no lane)'));
    tr.append(td);
    tr.append(el('td', 'num', money(l.usd)));
    tr.append(el('td', 'num', compactCount(l.tokens)));
    tr.append(el('td', 'dim', arr(l.sessions).slice(0, 4).map(localPart).join(', ')));
    tbody.append(tr);
  }
  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(c.totalUsd)));
  fr.append(el('td', 'num', compactCount(c.totalTokens)));
  fr.append(el('td', 'dim', c.label));
  tfoot.append(fr);
  t.append(tfoot);
  cost.append(t);

  const rl = rateLimits;
  if (rl) {
    const g = el('div', 'gauges morning-gauges');
    if (rl.fiveHour) g.append(gauge(`5 h window · ${resetsIn(rl.fiveHour.resetsAt)}`, rl.fiveHour.usedPct));
    if (rl.sevenDay) g.append(gauge(`7 d window · ${resetsIn(rl.sevenDay.resetsAt)}`, rl.sevenDay.usedPct));
    cost.append(g);
  }
  return cost;
}

// --- fleet blocks ----------------------------------------------------------

function stuckBlock(list, title) {
  const sec = block(title, list.length);
  if (!list.length) sec.append(el('p', 'empty', 'Nothing got stuck.'));
  for (const x of list) {
    const row = el('div', 'mrow morning-stuck');
    const open = fin(x.resolvedAt) === null;
    row.append(lamp(open ? '2' : 'off', { label: open ? 'still stuck' : 'resolved' }));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-name', x.fkey ? localPart(x.fkey) : '—'));
    top.append(el('span', 'mrow-age', fin(x.since) ? `since ${ago(x.since)}` : ''));
    top.append(el('span', 'mrow-sub', open ? 'open' : `resolved after ${dur(x.resolvedAt - x.since)}`));
    main.append(top);
    if (x.reason) main.append(el('div', 'mrow-text', txt(x.reason)));
    row.append(main);
    sec.append(row);
  }
  return sec;
}

function codeOfKey(k, m) {
  const p = parseFkey(k);
  if (!p) return '';
  return m.builders.find((b) => b.id === p.builder)?.code ?? codeFor(p.builder, null, store);
}

function reviewBlock(r, m) {
  const sec = block('Review wait', r.waiting);
  const top = el('div', 'mrow-top');
  top.append(kv('median', dur(r.medianWaitMs)));
  top.append(kv('p90', dur(r.p90WaitMs)));
  top.append(kv('reviews', String(r.n)));
  top.append(kv('waiting', String(r.waiting)));
  sec.append(top);
  if (!r.longest.length) sec.append(el('p', 'empty', 'Nothing is waiting for review.'));
  else {
    const { t, tbody } = morningTable([['lane', ''], ['builder', ''], ['waiting', 'num']]);
    for (const w of r.longest) {
      const tr = el('tr');
      tr.append(el('td', null, localPart(w.fkey)));
      tr.append(el('td', 'dim', codeOfKey(w.fkey, m)));
      tr.append(el('td', 'num', dur(w.waitMs)));
      tbody.append(tr);
    }
    sec.append(t);
  }
  return sec;
}

function approvalsBlock(a) {
  const sec = block('Approvals answered', a.answered);
  const top = el('div', 'mrow-top');
  top.append(kv('approved', String(a.approved)));
  top.append(kv('denied', String(a.denied)));
  top.append(kv('released', String(a.released)));
  top.append(kv('median answer', dur(a.medianAnswerMs)));
  sec.append(top);
  if (!a.answered) sec.append(el('p', 'empty', 'No approval was answered in this window.'));
  return sec;
}

function packageBlock(rows, totalUsd) {
  const sec = block('Cost by package', rows.length);
  if (!rows.length) { sec.append(el('p', 'empty', 'No package spend in this window.')); return sec; }
  const { t, tbody } = morningTable([['package', ''], ['≈ spend', 'num'], ['lanes', 'num']]);
  for (const p of rows) {
    const tr = el('tr');
    tr.append(el('td', null, txt(p.package)));
    tr.append(el('td', 'num', `≈ ${money(fin(p.usd) ?? 0)}`));
    tr.append(el('td', 'num', String(fin(p.lanes) ?? 0)));
    tbody.append(tr);
  }
  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(totalUsd)));
  fr.append(el('td', 'dim', 'equal split'));
  tfoot.append(fr);
  t.append(tfoot);
  sec.append(t);
  return sec;
}

const REASON_WORD = Object.freeze({ quiet: 'quiet hours', rate: 'rate limit' });

function deferredBlock(list, m) {
  const sec = block('While you were away', list.length);
  if (!list.length) { sec.append(el('p', 'empty', 'Nothing was held back.')); return sec; }
  for (const d of list) {
    const row = el('div', 'mrow morning-deferred');
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-kind', REASON_WORD[d.reason] ?? 'held'));
    const code = d.builder ? (m.builders.find((b) => b.id === d.builder)?.code ?? codeFor(d.builder, null, store)) : '';
    if (code) top.append(el('span', 'mrow-lane', code));
    if (typeof d.url === 'string' && /^#\/[a-z]/.test(d.url)) {
      const a = el('a', 'mrow-name', txt(d.title) || '—');
      a.setAttribute('href', d.url);
      top.append(a);
    } else top.append(el('span', 'mrow-name', txt(d.title) || '—'));
    top.append(el('span', 'mrow-age', ago(fin(d.at))));
    main.append(top);
    if (d.body) main.append(el('div', 'mrow-text', txt(d.body)));
    row.append(main);
    sec.append(row);
  }
  return sec;
}

// ---------------------------------------------------------------- the view

const scopeOf = (ctx) => {
  const b = ctx?.route?.b;
  return typeof b === 'string' && b && BUILDER_ID_RX.test(b) ? b : 'all';
};

export default {
  id: 'morning',
  icon: 'morning',
  title: 'Morning',
  short: 'MORN',
  /** Paint into #morning-body (the section keeps its head and window picker) and fetch. */
  mount: (_el, ctx = {}) => {
    morning.b = scopeOf(ctx);
    loadMorning();
  },
  unmount: () => {},
  /** Its own fetch: refetch only when the builder filter or the source kind changed. */
  update: (_store, ctx = {}) => {
    if (ctx.route) morning.b = scopeOf(ctx);
    const url = morningUrl(morning.window, { hub: morningIsHub(store), b: morning.b });
    if (morning.url !== null && url !== morning.url) loadMorning(true);
  },
};
