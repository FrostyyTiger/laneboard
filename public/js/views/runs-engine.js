// Engine runs in the Runs view (docs/runs-home.md): their list rows and their
// page, with the tree. Read-only: every read goes through /api/engines/runs and
// /api/engine/<id>/..., laneboard's own shapes (docs/engines.md).
//
// Everything here was written by an engine: it goes in through textContent and
// setAttribute only, and a link only when it is http(s) (safeHref).
import { decisionButton } from './engine-actions.js';
import { decisionPlans, waitingKindWord } from './inbox-waiting.js';
import { el } from '../core/dom.js';
import { money } from '../core/format.js';
import { rnClean, safeHref } from '../core/run-text.js';
import {
  buildTree, costBelow, defaultOpen, isOpen, mergeEvents, noteFailures, parseRunKey, placeEvents, retriesOf,
} from '../core/run-tree.js';
import { lamp } from '../ui/components.js';
import { loopSection } from './run-loop.js';
import { drawerNode, miniLoops, tabsNode } from './run-drawer.js';
import { patternOf } from '../core/loop.js';

export const ENGINE_RUNS_URL = '/api/engines/runs';
const LIST_HREF = '#/runs';
const DASH = '—';
const EVENTS_SHOWN = 20;
const EVENT_PAGES = 5;

const RUN_STATES = Object.freeze({
  'waiting-approval': { p: '2', word: 'approval' },
  queued: { p: '3', word: 'queued' },
  running: { p: 'run', word: 'running' },
  'at-gate': { p: '2', word: 'at gate' },
  paused: { p: '3', word: 'paused' },
  done: { p: 'ok', word: 'done' },
  stopped: { p: 'off', word: 'stopped' },
});
const STOP_P = Object.freeze({ 'checks-red': '1', errors: '1', 'no-progress': '2', budget: '2', 'window-7d': '2' });
const NODE_STATES = Object.freeze({
  planned: 'off', ready: 'off', building: 'run', checking: 'run', passed: 'ok', frozen: 'ok',
  reopened: '2', paused: '3', blocked: '2', dropped: 'off',
});

export function engineStateOf(row) {
  if (isBlocked({ ...row, state: row?.engineState ?? row?.state })) {
    return { p: '1', word: 'blocked', title: `blocked: ${rnClean(row.reason, 300) ?? 'it waits for you to fix the cause, then resume'}` };
  }
  const m = RUN_STATES[row?.engineState ?? row?.state] ?? { p: 'off', word: rnClean(row?.state, 16) ?? '?' };
  const stop = rnClean(row?.stop, 32);
  return { p: (row?.engineState ?? row?.state) === 'stopped' ? STOP_P[stop] ?? 'off' : m.p, word: m.word, title: stop ? `${m.word}: ${stop}` : m.word };
}

/** An engine's row as the list holds it: `run` is its `<engine>/<run>` key, `state` the list's own sort word. */
export function toListRow(r) {
  const live = r.state !== 'done' && r.state !== 'stopped';
  return { ...r, engineRow: true, engineState: r.state, runId: r.id, run: r.key, state: live ? 'running' : 'stopped' };
}

export const engineNeedsYou = (row) => row.engineState === 'at-gate' || row.engineState === 'waiting-approval' || row.waiting?.length > 0;

/** GET /api/engines/runs -> {rows, engines, failed}. A hub has no such route: no rows, no complaint. */
export async function loadEngineRuns(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(ENGINE_RUNS_URL, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 404) return { rows: [], engines: [], failed: false };
    if (!r.ok) return { rows: [], engines: [], failed: true };
    const b = await r.json();
    return { rows: (Array.isArray(b?.runs) ? b.runs : []).map(toListRow), engines: Array.isArray(b?.engines) ? b.engines : [], failed: false };
  } catch {
    return { rows: [], engines: [], failed: true };
  }
}

/** One line per engine that is not simply up, or whose list could not be read. */
export function engineBanners(engines, failed = false) {
  const out = (Array.isArray(engines) ? engines : []).filter((e) => e && !['up', 'off', 'unknown'].includes(e.state))
    .map((e) => `Engine ${rnClean(e.id, 32) ?? '?'} is ${rnClean(e.state, 16) ?? '?'}${e.reason ? `: ${rnClean(e.reason)}` : ''}. Its runs may be old or missing.`);
  if (failed) out.push('The engines could not be read. Only run-file runs are listed.');
  return out;
}

// ---------------------------------------------------------------- the foreman's health

const FOREMAN_P = Object.freeze({ up: 'ok', stale: '2', down: '1', unknown: 'off' });
const LIVE = new Set(['running', 'at-gate', 'waiting-approval', 'paused', 'queued']);

function shortAge(ms) {
  if (typeof ms !== 'number') return null;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  return engineAge(ms);
}

function windowText(name, w) {
  if (!w || typeof w.usedPct !== 'number') return null;
  return w.known === false ? `${name} unknown` : `${name} ${Math.round(w.usedPct)}%`;
}

/** Midnight of `now`'s day, local time: where "today" starts. */
function dayStart(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The one status line above the Runs list (docs/runs-home.md): what needs you,
 * then per engine the foreman, its heartbeat, hosts, what is on and queued, the
 * usage windows, then the spend of runs started today and the questions that
 * belong to no run. Pure: `engines` and `rows` as loadEngineRuns gives them.
 * -> [{key, text, p?, href?, title?}]
 */
export function statusLine(engines, rows = [], now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const needs = list.filter(rowNeedsYou).length;
  out.push(needs
    ? { key: 'needs', text: `${needs} ${needs === 1 ? 'needs' : 'need'} you`, p: '1' }
    : { key: 'needs', text: 'nothing needs you', p: 'ok' });
  const withHealth = (Array.isArray(engines) ? engines : []).filter((e) => e?.health);
  for (const e of withHealth) {
    const h = e.health;
    const id = rnClean(e.id, 32) ?? '?';
    const foreman = FOREMAN_P[h.foreman] ? h.foreman : 'unknown';
    const parts = [`${withHealth.length > 1 ? `${id}: ` : ''}foreman ${foreman}`];
    const beat = shortAge(h.beatAge);
    if (beat) parts.push(`beat ${beat}`);
    if (foreman === 'unknown' && h.reason) parts.push(rnClean(h.reason, 120));
    const up = (Array.isArray(h.hosts) ? h.hosts : []).filter((x) => x?.state === 'up').map((x) => rnClean(x.id, 32));
    if (up.length) parts.push(`on ${up.join(', ')}`);
    const on = list.filter((r) => r.engine === e.id && LIVE.has(r.engineState)).length;
    parts.push(`${on} on now`);
    if (typeof h.queue === 'number') parts.push(`queue ${h.queue}`);
    const wins = [windowText('5h', h.windows?.window5h), windowText('7d', h.windows?.window7d)].filter(Boolean);
    if (wins.length) parts.push(`usage ${wins.join(' · ')}`);
    out.push({ key: `foreman:${id}`, text: parts.join(' · '), p: FOREMAN_P[foreman], foreman, href: '#/network', title: 'The foreman and its machines, on the Network view' });
  }
  const since = dayStart(now);
  const today = list.filter((r) => r.engineRow && typeof r.startedAt === 'number' && r.startedAt >= since && usdOf(r) !== null);
  if (today.length) {
    out.push({ key: 'spend', text: `${money(today.reduce((n, r) => n + usdOf(r), 0))} today`,
      title: 'API price of the runs started today (a run counts on the day it started)' });
  }
  const q = (Array.isArray(engines) ? engines : []).reduce((n, e) => n + (typeof e?.questions === 'number' ? e.questions : 0), 0);
  if (q) out.push({ key: 'questions', text: `${q} ${q === 1 ? 'question' : 'questions'}`, href: '#/inbox', title: 'Product questions that belong to no run, in the Inbox' });
  return out;
}

export function statusNode(parts) {
  const box = el('p', 'rn-status');
  box.setAttribute('aria-label', 'Status');
  for (const x of parts) {
    const n = el(x.href ? 'a' : 'span', 'rn-status-x');
    if (x.href) n.href = x.href;
    if (x.p) n.append(lamp(x.p, { label: x.text }));
    n.append(el('span', 'rn-status-t', x.text));
    n.dataset.key = x.key.split(':')[0];
    if (x.foreman) n.dataset.foreman = x.foreman;
    if (x.title) n.title = x.title;
    box.append(n);
  }
  return box;
}

// ---------------------------------------------------------------- Needs you, chips, filters

/** Does this row (engine or run file) need you? */
export function rowNeedsYou(row) {
  if (row?.engineRow) return engineNeedsYou(row);
  return row?.needs?.length > 0 || row?.state === 'waiting';
}

/** A row's product and kind, for the filters. */
export const productOf = (r) => (r?.engineRow ? rnClean(r.product, 64) : null);
export const kindOf = (r) => (r?.engineRow ? rnClean(r.recipe?.kind, 32) ?? 'run' : 'run file');
const isHistory = (r) => r?.state === 'stopped';

export const SHOWS = Object.freeze(['live', 'needs', 'history']);
export const defaultFilter = () => ({ show: 'live', product: '', kind: '', open: false });

/** How many rows each chip holds. */
export function runCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    live: list.filter((r) => !isHistory(r)).length,
    needs: list.filter(rowNeedsYou).length,
    history: list.filter(isHistory).length,
  };
}

/** The rows a filter keeps. `show`: live (not finished), needs (needs you) or history (finished or stopped). */
export function filterRuns(rows, f = defaultFilter()) {
  const show = SHOWS.includes(f?.show) ? f.show : 'live';
  return (Array.isArray(rows) ? rows : []).filter((r) => (show === 'live' ? !isHistory(r) : show === 'needs' ? rowNeedsYou(r) : isHistory(r))
    && (!f?.product || productOf(r) === f.product)
    && (!f?.kind || kindOf(r) === f.kind));
}

/** The values the product and kind filters offer: [{value, label}], from the rows themselves. */
export function filterOptions(rows) {
  const products = new Map();
  const kinds = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = productOf(r);
    if (p && !products.has(p)) products.set(p, rnClean(r.productTitle, 64) ?? p);
    kinds.add(kindOf(r));
  }
  return {
    products: [...products].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    kinds: [...kinds].sort().map((k) => ({ value: k, label: k })),
  };
}

const CHIP_WORDS = Object.freeze({ live: 'Live', needs: 'Needs you', history: 'History' });

function selectNode(label, value, options, onPick) {
  const wrap = el('label', 'rn-filter-f');
  const sel = el('select', 'rn-filter-sel');
  const opt = (text, value) => { const o = el('option', null, text); o.value = value; return o; };
  sel.append(opt(`all ${label}s`, ''));
  for (const o of options) sel.append(opt(o.label, o.value));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onPick(sel.value));
  wrap.append(el('span', 'rn-filter-k', label), sel);
  return wrap;
}

/** The chips row: Live · Needs you · History with their counts, and `filter ⋯` for product and kind. */
export function chipsNode(rows, f, onFilter) {
  const counts = runCounts(rows);
  const box = el('div', 'rn-chips');
  box.setAttribute('role', 'toolbar');
  box.setAttribute('aria-label', 'Show runs');
  for (const k of SHOWS) {
    const b = el('button', 'rn-chip', CHIP_WORDS[k]);
    b.type = 'button';
    b.dataset.show = k;
    b.append(el('span', 'rn-chip-n', String(counts[k])));
    b.setAttribute('aria-pressed', String(f.show === k));
    if (k === 'needs' && counts.needs) b.dataset.p = '1';
    b.addEventListener('click', () => onFilter({ ...f, show: k }));
    box.append(b);
  }
  const narrowed = Boolean(f.product || f.kind);
  const more = el('button', 'rn-chip rn-chip-more', narrowed ? 'filter · on' : 'filter ⋯');
  more.type = 'button';
  more.setAttribute('aria-expanded', String(Boolean(f.open)));
  more.addEventListener('click', () => onFilter({ ...f, open: !f.open }));
  box.append(more);
  if (f.open) {
    const opts = filterOptions(rows);
    const row = el('div', 'rn-filter');
    row.append(
      selectNode('product', f.product, opts.products, (v) => onFilter({ ...f, product: v })),
      selectNode('kind', f.kind, opts.kinds, (v) => onFilter({ ...f, kind: v })),
    );
    if (narrowed) {
      const clear = el('button', 'btn btn--s', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => onFilter({ ...f, product: '', kind: '' }));
      row.append(clear);
    }
    box.append(row);
  }
  return box;
}

/** What a needing run waits for, in one word. */
function needWord(row) {
  if (isBlocked({ ...row, state: row.engineState })) return 'blocked';
  if (row.waiting?.length) return [...new Set(row.waiting.map((w) => waitingKindWord(w.kind)))].join(', ');
  return engineStateOf(row).word;
}

/**
 * The Needs you band on top of Runs: one card per engine run that waits for
 * you. A blocked run says what is wrong, with Resume and a small Stop (it asks
 * first); a run at a gate lists its items with Approve and Reject. Null when
 * nothing waits.
 */
export function needsBand(rows, onDone, now = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r?.engineRow && engineNeedsYou(r));
  if (!list.length) return null;
  const box = el('section', 'rn-band');
  box.setAttribute('aria-label', 'Needs you');
  box.append(el('h2', 'rn-band-h', 'Needs you'));
  for (const row of list) {
    const blocked = isBlocked({ ...row, state: row.engineState });
    const card = el('article', 'rn-card');
    card.dataset.run = rnClean(row.run, 100) ?? '';
    if (blocked) card.dataset.blocked = '';
    const head = el('p', 'rn-card-head');
    head.append(el('span', 'rn-card-kind', needWord(row)));
    if (row.node) head.append(el('span', 'rn-card-node', rnClean(row.node, 48)));
    const seen = typeof row.updatedAt === 'number' ? now - row.updatedAt : null;
    head.append(el('span', 'rn-card-ago', engineAge(seen)));
    const name = el('p', 'rn-card-name');
    const a = el('a', 'rn-card-open', rowName(row));
    a.href = runHref(row.run);
    a.title = rnClean(row.run, 100) ?? '';
    name.append(a);
    if (row.goalTitle) name.append(el('span', 'rn-card-goal', rnClean(row.goalTitle, 200)));
    card.append(head, name);
    if (blocked) {
      const why = el('p', 'rn-card-why');
      const t = rnClean(row.reason, 300) ?? 'It stopped and waits for you.';
      why.append(el('span', 'rn-card-k', 'What is wrong'), el('span', 'rn-card-t', t));
      why.title = rnClean(row.reason, 2000) ?? '';
      card.append(why, el('p', 'rn-card-hint', 'Nothing to approve. Fix the cause, then Resume: the foreman tries again.'));
      const btns = el('p', 'rn-card-btns');
      const plans = runControls(row.run, { ...row, state: row.engineState }).filter((x) => x.word !== 'pause');
      for (const plan of plans) {
        const b = decisionButton(plan, onDone);
        if (plan.word === 'resume') b.classList.add('btn--primary', 'rn-go');
        else b.classList.add('rn-quiet');
        btns.append(b);
      }
      const open = el('a', 'btn btn--s rn-card-go', 'Open');
      open.href = runHref(row.run);
      btns.append(open);
      card.append(btns);
    } else {
      const gates = gatesNode(row, onDone);
      if (gates) card.append(gates);
    }
    box.append(card);
  }
  return box;
}

/** A row's plain name: the server's `name`, else product · goal, else the run id. */
export function rowName(row) {
  return rnClean(row?.name, 120) ?? (goalText(row) || rnClean(row?.runId, 64) || '?');
}

const DAY_FMT = { day: 'numeric', month: 'short' };
const dayText = (ms) => (typeof ms === 'number' ? new Date(ms).toLocaleDateString('en-GB', DAY_FMT) : null);

// ---------------------------------------------------------------- what waits, on a run's row

/** The run's waiting items under its row: kind, title, revision, and the board's own buttons. */
export function gatesNode(row, onDone) {
  // A `needs` item is the block, which has its own card with Resume and Stop.
  const items = Array.isArray(row?.waiting) ? row.waiting.filter((w) => w?.kind !== 'needs') : [];
  if (!items.length) return null;
  const box = el('div', 'rn-gates');
  for (const it of items) {
    const g = el('div', 'rn-gate');
    g.dataset.item = rnClean(it.id, 120) ?? '';
    const rev = typeof it.revision === 'string' ? it.revision.replace(/^sha256:/, '').slice(0, 8) : '';
    const rv = el('span', 'rn-gate-rev', rev ? `rev ${rev}` : '');
    rv.title = `revision ${rnClean(it.revision, 40) ?? '?'}: a decision applies only to this exact content`;
    g.append(el('span', 'rn-gate-kind', waitingKindWord(it.kind)), el('span', 'rn-gate-t', rnClean(it.title, 200) ?? rnClean(it.id, 120) ?? ''), rv);
    const btns = el('span', 'rn-gate-btns');
    for (const plan of decisionPlans(it, row.engine)) btns.append(decisionButton(plan, onDone));
    g.append(btns);
    box.append(g);
  }
  return box;
}

/** A blocked run's line under its row: why, and Resume or Stop. */
export function blockedNode(row, onDone) {
  if (!isBlocked({ ...row, state: row?.engineState ?? row?.state })) return null;
  const box = el('div', 'rn-gates');
  const g = el('div', 'rn-gate');
  g.dataset.blocked = '';
  const t = el('span', 'rn-gate-t', rnClean(row.reason, 300) ?? 'Blocked: it waits for you to fix the cause, then resume.');
  t.title = rnClean(row.reason, 2000) ?? '';
  g.append(el('span', 'rn-gate-kind', 'blocked'), t);
  const btns = el('span', 'rn-gate-btns');
  const plans = runControls(row.run, { ...row, state: row.engineState ?? row.state }).filter((p) => p.word !== 'pause');
  for (const plan of plans) btns.append(decisionButton(plan, onDone));
  g.append(btns);
  box.append(g);
  return box;
}

export function bannersNode(lines) {
  const box = el('div', 'rn-banners');
  box.setAttribute('role', 'status');
  for (const l of lines) box.append(el('p', 'rn-banner', l));
  return box;
}

function engineStateCell(s, cls = 'rn-f rn-state') {
  const n = el('span', cls);
  n.dataset.p = s.p;
  n.append(lamp(s.p, { label: s.title }), el('span', 'rn-state-t', s.word));
  n.title = s.title;
  return n;
}

const usdOf = (r) => (typeof r?.usage?.usd === 'number' ? r.usage.usd : null);
const goalText = (r) => [rnClean(r.goal, 32), rnClean(r.goalTitle)].filter(Boolean).join(' ');

function engineAge(ms) {
  if (typeof ms !== 'number') return DASH;
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const runHref = (key) => `${LIST_HREF}?run=${encodeURIComponent(key)}`;

/** The source of a list row: its product (if any) and engine, as one small label. */
export function sourceLabel(product, engine) {
  const s = el('span', 'rn-src', [rnClean(product, 48), rnClean(engine, 32)].filter(Boolean).join(' · '));
  s.title = `${product ? `product ${rnClean(product, 48)}, ` : ''}engine ${rnClean(engine, 32)}`;
  return s;
}

const GLYPH_MARKS = new Set(['done', 'current', 'blocked', 'gate', 'stopped', 'idle']);

/**
 * A live row's small loop: seven dots (Plan · Recipe · Tests · Build · Check ·
 * Review · PR), the lit one where the run is, and the word with its node. The
 * server works the spot out (`loop`, routes/engines.mjs loopSpots).
 */
export function loopGlyph(loop) {
  const box = el('span', 'rn-f rn-node rn-glyph');
  const dots = el('span', 'rn-glyph-dots');
  dots.setAttribute('aria-hidden', 'true');
  const marks = Array.isArray(loop.marks) ? loop.marks.slice(0, 7) : [];
  marks.forEach((m, i) => {
    const d = el('span', 'rn-dot');
    d.dataset.mark = GLYPH_MARKS.has(m) ? m : 'idle';
    if (i === loop.at) d.dataset.at = '';
    dots.append(d);
  });
  const word = [rnClean(loop.label, 24), rnClean(loop.node, 48)].filter(Boolean).join(' · ');
  box.append(dots, el('span', 'rn-glyph-w', word || DASH));
  const words = Array.isArray(loop.words) ? loop.words.map((w) => rnClean(w, 16)).filter(Boolean).join(' → ') : '';
  box.title = `${loop.blocked ? 'blocked at' : 'at'} ${word}${words ? `\n${words}` : ''}${loop.exact ? '' : '\n(worked out from the events)'}`;
  box.dataset.station = rnClean(loop.station, 24) ?? '';
  return box;
}

/** One engine run's list row. What waits on it is in the Needs you band above the list (needsBand). */
export function engineRow(row, now = Date.now()) {
  const li = el('li', 'rn-row');
  li.dataset.run = rnClean(row.run, 100) ?? '';
  li.dataset.state = row.state;
  li.dataset.engine = rnClean(row.engine, 32) ?? '';
  if (engineNeedsYou(row)) li.dataset.needs = '';
  if (row.stale) li.dataset.stale = '';

  const goal = el('span', 'rn-f rn-goal');
  const a = el('a', 'rn-goal-t rn-open', rowName(row));
  a.href = runHref(row.run);
  const sub = [rnClean(row.goalTitle, 200), dayText(row.startedAt)].filter(Boolean).join(' · ');
  goal.append(a, el('span', 'rn-goal-sub', sub || (rnClean(row.run, 100) ?? '')));
  goal.title = [rowName(row), rnClean(row.goalTitle, 200), rnClean(row.run, 100)].filter(Boolean).join('\n');

  const node = row.loop ? loopGlyph(row.loop) : el('span', 'rn-f rn-node', rnClean(row.node, 80) ?? DASH);
  if (!row.loop) node.title = row.node ? `working on ${rnClean(row.node, 80)}` : 'no current node';
  const hosts = [...new Set((row.rooms ?? []).map((r) => rnClean(r.host, 32)).filter(Boolean))];
  const rooms = el('span', 'rn-f rn-rooms', hosts.length ? `on ${hosts.join(', ')}` : DASH);
  if (row.rooms?.length) rooms.title = row.rooms.map((r) => `${rnClean(r.name, 48)} ${rnClean(r.state, 16) ?? ''}`.trim()).join(', ');
  const seen = typeof row.updatedAt === 'number' ? now - row.updatedAt : null;
  const left = el('span', 'rn-f rn-left', row.stop ? rnClean(row.stop, 32) : engineAge(seen));
  if (row.stale) left.title = `last good answer, ${engineAge(row.age)}`;
  const usd = usdOf(row);
  li.append(engineStateCell(engineStateOf(row)), goal, node, rooms, left, el('span', 'rn-f rn-cost', usd === null ? DASH : money(usd)));
  return li;
}

// ---------------------------------------------------------------- one run's page

async function engineGet(url, fetchFn) {
  const r = await fetchFn(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  let body = null;
  try { body = await r.json(); } catch { /* the status says enough */ }
  return { status: r.status, ok: r.ok, body };
}

/**
 * The run and the events after `since`. -> {kind:'ok', run, stale, age, events, next}
 * | {kind:'missing'} | {kind:'error', message}. Never throws. Events that fail
 * leave the tree standing: `events` is empty and `eventsFailed` true.
 */
export async function loadEngineRun(key, since = 0, fetchFn = globalThis.fetch) {
  const k = parseRunKey(key);
  if (!k) return { kind: 'missing' };
  const base = `/api/engine/${encodeURIComponent(k.engine)}`;
  try {
    const a = await engineGet(`${base}/run/${encodeURIComponent(k.id)}`, fetchFn);
    if (a.status === 404) return { kind: 'missing' };
    if (!a.ok) return { kind: 'error', message: rnClean(a.body?.error, 160) ?? `HTTP ${a.status}` };
    const run = a.body?.data?.run;
    if (!run) return { kind: 'error', message: 'the engine sent no run' };
    let events = [];
    let next = since;
    let eventsFailed = false;
    for (let i = 0; i < EVENT_PAGES; i += 1) {
      const e = await engineGet(`${base}/events/${encodeURIComponent(k.id)}?since=${next}`, fetchFn);
      if (e.status === 404) break;
      if (!e.ok) { eventsFailed = true; break; }
      const d = e.body?.data;
      events = events.concat(Array.isArray(d?.events) ? d.events : []);
      next = Number.isInteger(d?.next) ? d.next : next;
      if (d?.more !== true) break;
    }
    return { kind: 'ok', run, stale: a.body.stale === true, age: a.body.age ?? null, events, next, eventsFailed };
  } catch (err) {
    return { kind: 'error', message: rnClean(String(err?.message ?? err), 120) ?? 'request failed' };
  }
}

/** A new page state for one run. */
export const newPage = () => ({ run: null, stale: false, age: null, events: [], next: 0, eventsFailed: false, overrides: new Map(), seen: new Set(), drawer: null, pos: null });

/** A good answer folded into the page state. */
export function applyRun(page, res) {
  page.run = res.run;
  page.stale = res.stale;
  page.age = res.age;
  page.events = mergeEvents(page.events, res.events);
  page.next = res.next;
  page.eventsFailed = res.eventsFailed;
  noteFailures(buildTree(res.run.tree), page.overrides, page.seen);
}

function hm(ms) {
  if (typeof ms !== 'number') return DASH;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function eventText(e) {
  const counts = e.counts ? ` ${e.counts.passed} passed, ${e.counts.failed} failed` : '';
  const verdict = typeof e.pass === 'boolean' ? (e.pass ? ' ✓' : ' ✗') : typeof e.ok === 'boolean' ? (e.ok ? ' ✓' : ' ✗') : '';
  const words = [e.what, e.name, e.title, e.state, e.result, e.decision, e.gate, e.reason, e.text].map((x) => rnClean(x)).filter(Boolean);
  return `${words.slice(0, 2).join(' · ')}${verdict}${counts}`;
}

function eventList(events) {
  const shown = events.slice(-EVENTS_SHOWN);
  const ul = el('ul', 'rt-events');
  if (events.length > shown.length) ul.append(el('li', 'rt-more', `${events.length - shown.length} earlier not shown`));
  for (const e of shown) {
    const li = el('li', 'rt-ev');
    li.dataset.type = rnClean(e.type, 32) ?? '';
    if (e.pass === false || e.ok === false) li.dataset.p = '1';
    li.append(el('time', 'rt-ev-t', hm(e.at)), el('span', 'rt-ev-k', rnClean(e.type, 32) ?? ''), el('span', 'rt-ev-x', eventText(e)));
    ul.append(li);
  }
  return ul;
}

function link(cls, text, href) {
  const safe = safeHref(href);
  if (!safe) return el('span', cls, text);
  const a = el('a', cls, text);
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function checkChip(c) {
  if (!c) return null;
  const n = c.counts;
  const tally = n ? (c.pass ? `${n.passed}/${n.passed + n.failed}` : `${n.failed} failed`) : '';
  const chip = link('rt-check', `${c.pass ? '✓' : '✗'} ${rnClean(c.name, 48) ?? 'check'} ${tally}`.trim(), c.output);
  chip.dataset.p = c.pass ? 'ok' : '1';
  chip.dataset.result = c.pass ? 'pass' : 'fail';
  if (n?.skipped) chip.title = `${n.skipped} skipped`;
  return chip;
}

function detail(label, value) {
  const d = el('div', 'rt-d');
  d.append(el('span', 'rt-d-k', label), el('span', 'rt-d-v', value));
  return d;
}

function nodeItem(item, v, depth) {
  const n = item.node;
  const li = el('li', 'rt-node');
  li.dataset.node = rnClean(n.id, 100) ?? '';
  li.dataset.state = rnClean(n.state, 16) ?? '';
  li.dataset.level = rnClean(n.level, 16) ?? '';
  li.style.setProperty('--depth', String(depth));
  const open = isOpen(n.id, v.defaults, v.overrides);
  const events = v.placed.byNode.get(n.id) ?? [];

  const row = el('div', 'rt-row');
  const fold = el('button', 'rt-fold', open ? '▾' : '▸');
  fold.type = 'button';
  fold.dataset.fold = n.id;
  fold.setAttribute('aria-expanded', String(open));
  fold.setAttribute('aria-label', `${open ? 'Fold' : 'Open'} ${rnClean(n.id, 100)}`);
  row.append(fold);

  const p = NODE_STATES[n.state] ?? 'off';
  const state = engineStateCell({ p, word: rnClean(n.state, 16) ?? '?', title: rnClean(n.state, 16) ?? '?' }, 'rn-f rt-state');
  row.append(state);
  if (n.state === 'frozen') {
    const f = el('span', 'rt-frozen', '❄');
    f.title = 'frozen: passed and will not be touched again';
    row.append(f);
  }
  row.append(el('span', 'rt-id', rnClean(n.id, 100) ?? ''), el('span', 'rt-title', rnClean(n.title) ?? ''));
  const mini = v.mini?.get(n.id);
  if (mini) row.append(el('span', 'rt-mini', rnClean(mini, 200)));
  const chip = checkChip(n.lastCheck);
  if (chip) row.append(chip);
  const retries = retriesOf(n);
  if (retries) {
    const r = el('span', 'rt-retries', `↻${retries}`);
    r.title = `${retries} ${retries === 1 ? 'retry' : 'retries'}`;
    row.append(r);
  }
  const usd = v.cost.get(n.id);
  if (usd) row.append(el('span', 'rt-cost', money(usd)));
  li.append(row);

  if (open) {
    const body = el('div', 'rt-body');
    if (n.reason) body.append(detail('why', rnClean(n.reason, 400)));
    if (n.blockedBy?.length) body.append(detail('blocked by', n.blockedBy.map((b) => rnClean(b, 100)).join(', ')));
    if (n.check) body.append(detail('check', rnClean(n.check, 400)));
    if (safeHref(n.url)) {
      const d = el('div', 'rt-d');
      d.append(el('span', 'rt-d-k', 'file'), link('rt-d-v', 'open', n.url));
      body.append(d);
    }
    if (events.length) body.append(eventList(events));
    if (item.children.length) {
      const ul = el('ul', 'rt-list');
      for (const c of item.children) ul.append(nodeItem(c, v, depth + 1));
      body.append(ul);
    }
    li.append(body);
  }
  return li;
}

function engineSection(cls, name, count = null) {
  const s = el('section', `rn-sec ${cls}`);
  s.append(el('h3', 'rn-sec-t', count === null ? name : `${name} (${count})`));
  return s;
}

/** What a person can do to an engine run in this state. Pure. */
/**
 * Blocked: at a gate with nothing to decide. A round hit its stop rule or a
 * check could not run; the person fixes the cause and resumes (or stops).
 */
export function isBlocked(run) {
  if (run?.state !== 'at-gate') return false;
  // A `needs` item says the same as this rule: blocked, nothing to decide (docs/waiting.md).
  if (Array.isArray(run.waiting) && run.waiting.some((w) => w?.kind !== 'needs')) return false;
  if (Array.isArray(run.gates) && run.gates.some((g) => g?.state === 'open' && g.kind !== 'needs')) return false;
  return true;
}

export function runControls(key, run) {
  const out = [];
  const on = (label, word, action, tier) => out.push({ label, word, action, target: key, tier, args: {}, lines: [rnClean(key, 100) ?? '', 'Gentle: the current step finishes first.'] });
  if (['running', 'at-gate', 'queued'].includes(run?.state)) on('Pause', 'pause', 'engine-pause', 'click');
  if (run?.state === 'paused' || isBlocked(run)) on('Resume', 'resume', 'engine-resume', 'click');
  if (run && !['done', 'stopped'].includes(run.state)) on('Stop', 'stop', 'engine-stop', 'confirm');
  return out;
}

/** The `⋯` menu in a run page's head: the links and raw facts that are rarely needed. */
function moreMenu(key, run) {
  const d = el('details', 'rn-more rn-keep');
  d.dataset.keep = 'more';
  d.append(el('summary', 'rn-more-s', '⋯'));
  d.querySelector?.('summary')?.setAttribute('aria-label', 'More about this run');
  const ul = el('ul', 'rn-more-l');
  const item = (node) => { const li = el('li'); li.append(node); ul.append(li); };
  if (safeHref(run.url)) item(link('rn-more-a', 'state repo ↗', run.url));
  if (safeHref(run.recipe?.url)) item(link('rn-more-a', `recipe${typeof run.recipe.revision === 'number' ? ` rev ${run.recipe.revision}` : ''} ↗`, run.recipe.url));
  if (run.product && run.goal) {
    const flow = el('a', 'rn-more-a', 'Flow of the goal');
    flow.href = `#/flow?product=${encodeURIComponent(run.product)}&goal=${encodeURIComponent(run.goal)}`;
    item(flow);
  }
  for (const r of run.rooms ?? []) item(el('span', 'rn-more-f', `room ${rnClean(r.name, 48) ?? '?'} · ${rnClean(r.host, 32) ?? '?'} · ${rnClean(r.state, 16) ?? '?'}`));
  item(el('span', 'rn-more-f', `${rnClean(key, 100) ?? ''}${typeof run.lastSeq === 'number' ? ` · ${run.lastSeq} events` : ''}`));
  d.append(ul);
  return d;
}

const DAY_TIME = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

function enginePageHead(key, run, page, now) {
  const head = el('header', 'rn-head');
  const back = el('a', 'rn-back', '← Runs');
  back.href = LIST_HREF;
  const top = el('div', 'rn-head-top');
  const goal = el('span', 'rn-f rn-goal');
  const title = run.goalTitle ?? (Array.isArray(run.tree) ? run.tree.find((n) => n.id === run.goal)?.title : null);
  const name = rnClean(run.name, 120);
  const t = el('span', 'rn-goal-t', name ?? [rnClean(run.product, 48), rnClean(run.goal, 32), rnClean(title)].filter(Boolean).join(' · '));
  t.title = rnClean(key, 100) ?? '';
  goal.append(t, el('span', 'rn-goal-sub', (name ? rnClean(title) : null) ?? rnClean(key, 100) ?? ''));
  top.append(engineStateCell(engineStateOf(run)), goal, moreMenu(key, run));
  const facts = el('div', 'rn-facts');
  const add = (cls, text, t) => { const f = el('span', `rn-f ${cls}`, text); if (t) f.title = t; facts.append(f); };
  if (run.node) add('rn-node', `at ${rnClean(run.node, 80)}`);
  if (run.stop) add('rn-left', `stop: ${rnClean(run.stop, 32)}`);
  if (typeof run.startedAt === 'number') add('rn-left', `started ${new Date(run.startedAt).toLocaleString('en-GB', DAY_TIME)}`);
  if (usdOf(run) !== null) add('rn-cost', money(usdOf(run)), 'API price equivalent');
  const hosts = [...new Set((run.rooms ?? []).map((r) => rnClean(r.host, 32)).filter(Boolean))];
  if (hosts.length) {
    // Each host is a link to it on the Network view (docs/network.md).
    const f = el('span', 'rn-f rn-rooms', 'on ');
    hosts.forEach((h, i) => {
      if (i) f.append(', ');
      const a = el('a', 'rn-host', h);
      a.href = `#/network?sel=${encodeURIComponent(`node:${h}`)}`;
      a.title = `${h} on the Network view`;
      f.append(a);
    });
    facts.append(f);
  }
  if (typeof run.updatedAt === 'number') add('rn-left', `updated ${engineAge(now - run.updatedAt)}`);
  head.append(back, top, facts);
  if (page.stale) head.append(el('p', 'rn-stale', `The engine is not answering. This is its last good answer, ${engineAge(page.age)}.`));
  return head;
}

function gatesSection(gates) {
  const open = gates.filter((g) => g.state === 'open');
  const s = engineSection('rt-gates', 'Waiting for a person', open.length);
  const ul = el('ul', 'rt-plain');
  for (const g of open) {
    const li = el('li');
    li.append(el('span', 'rt-gate-k', rnClean(g.kind, 16) ?? ''), el('span', null, rnClean(g.id, 120) ?? ''));
    if (g.node) li.append(el('span', 'rt-gate-n', `at ${rnClean(g.node, 80)}`));
    ul.append(li);
  }
  s.append(ul);
  return s;
}

function prsSection(prs) {
  const s = engineSection('rt-prs', 'PRs', prs.length);
  const ul = el('ul', 'rt-plain');
  for (const pr of prs) {
    const li = el('li');
    li.append(link('rt-pr', `#${rnClean(pr.id, 32)} ${rnClean(pr.title) ?? ''}`.trim(), pr.url), el('span', 'rt-gate-k', rnClean(pr.state, 16) ?? ''));
    ul.append(li);
  }
  s.append(ul);
  return s;
}

/** The whole page. `st` is {status, message}; `page` from newPage/applyRun. */
export function renderEnginePage(container, key, page, st = { status: 'ok' }, now = Date.now(), onDone = undefined) {
  const root = el('div', 'rn-page');
  const run = page?.run;
  if (!run) {
    const back = el('a', 'rn-back', '← Runs');
    back.href = LIST_HREF;
    const box = el('div', 'empty rn-empty');
    box.append(el('p', null, st.status === 'loading' ? `Loading run ${rnClean(key, 100)}…`
      : st.status === 'error' ? `The run could not be loaded: ${rnClean(st.message) ?? 'request failed'}.`
        : `No run ${rnClean(key, 100)} here: its engine does not know it, or is not configured.`));
    root.append(back, box);
  } else {
    root.append(enginePageHead(key, run, page, now));
    if (st.status === 'error') root.append(el('p', 'rn-stale', `Not refreshed: ${rnClean(st.message) ?? 'request failed'}.`));
    const tree = buildTree(run.tree);
    const placed = placeEvents(tree, page.events);
    const v = { defaults: defaultOpen(tree, run.node), overrides: page.overrides, placed, cost: costBelow(tree, page.events) };
    const gates = gatesNode({ ...run, engine: parseRunKey(key)?.engine ?? run.engine }, onDone);
    root.append(loopSection(run, { events: page.events, controls: runControls(key, run), gates, onDone, now, page }));
    const open = (run.gates ?? []).filter((g) => g.state === 'open');
    if (open.length && !gates) root.append(gatesSection(run.gates));
    v.mini = miniLoops(run, page.events);
    const treeList = () => {
      const ul = el('ul', 'rt-list');
      for (const r of tree.roots) ul.append(nodeItem(r, v, 0));
      return ul;
    };
    if (patternOf(run).pattern) {
      // The loop is the picture; the tree and the rest are in the drawer, closed by default.
      root.append(tabsNode(page));
      const d = drawerNode(run, page, { built: page.drawer?.id === 'built' ? treeList() : null, now });
      if (d) root.append(d);
    } else {
      const treeSec = engineSection('rt-tree', 'Tree', tree.byId.size);
      treeSec.append(treeList());
      root.append(treeSec);
    }
    if (page.eventsFailed) root.append(el('p', 'rn-stale', 'The events could not be read.'));
    if (run.prs?.length) root.append(prsSection(run.prs));
    if (run.report) {
      const s = engineSection('rt-report', 'Report');
      s.append(el('p', null, rnClean(run.report.summary, 2000) ?? ''), link('rt-pr', 'Full report', run.report.url));
      root.append(s);
    }
    if (placed.run.length && !patternOf(run).pattern) {
      const d = el('details', 'rt-runev');
      d.dataset.keep = 'run-events';
      d.open = page.runEventsOpen === true;
      d.append(el('summary', null, `Run events (${placed.run.length})`), eventList(placed.run));
      root.append(d);
    }
  }
  if (container) {
    const focus = container.ownerDocument?.activeElement?.dataset?.fold ?? null;
    // A repaint keeps what the person opened (the ⋯ menu, a full reason).
    const kept = new Set([...(container.querySelectorAll?.('.rn-keep') ?? [])].filter((d) => d.open).map((d) => d.dataset.keep));
    container.textContent = '';
    container.append(root);
    if (kept.size) for (const d of root.querySelectorAll('.rn-keep')) if (kept.has(d.dataset.keep)) d.open = true;
    if (focus) [...root.querySelectorAll('[data-fold]')].find((b) => b.dataset.fold === focus)?.focus();
  }
  return root;
}

/** A click on a fold button flips that node; returns true when one was hit. */
export function toggleFold(page, target) {
  const id = target?.closest?.('[data-fold]')?.dataset?.fold;
  if (!id || !page?.run) return false;
  const tree = buildTree(page.run.tree);
  page.overrides.set(id, !isOpen(id, defaultOpen(tree, page.run.node), page.overrides));
  return true;
}

export { parseRunKey };
