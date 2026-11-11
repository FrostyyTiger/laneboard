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

/**
 * One line per engine that reports health: the foreman's state, the
 * heartbeat's age, its hosts, queue and usage windows, and the live runs with
 * their node. Pure: `engines` and `rows` as loadEngineRuns gives them.
 */
export function healthLines(engines, rows = []) {
  const out = [];
  for (const e of Array.isArray(engines) ? engines : []) {
    const h = e?.health;
    if (!h) continue;
    const id = rnClean(e.id, 32) ?? '?';
    const foreman = FOREMAN_P[h.foreman] ? h.foreman : 'unknown';
    const parts = [];
    const beat = shortAge(h.beatAge);
    if (beat) parts.push(`heartbeat ${beat}`);
    if (h.foreman === 'unknown' && h.reason) parts.push(rnClean(h.reason, 120));
    const hosts = (Array.isArray(h.hosts) ? h.hosts : []).map((x) => `${rnClean(x.id, 32)} ${rnClean(x.state, 12)}`);
    if (hosts.length) parts.push(hosts.join(', '));
    if (typeof h.queue === 'number') parts.push(`queue ${h.queue}`);
    const wins = [windowText('5h', h.windows?.window5h), windowText('7d', h.windows?.window7d)].filter(Boolean);
    if (wins.length) parts.push(`usage ${wins.join(' · ')}`);
    const live = (Array.isArray(rows) ? rows : []).filter((r) => r.engine === e.id && LIVE.has(r.engineState))
      .map((r) => ({ key: r.run, text: [rnClean(r.runId, 64), engineStateOf(r).word, r.node ? `at ${rnClean(r.node, 48)}` : null].filter(Boolean).join(' ') }));
    out.push({ engine: id, foreman, p: FOREMAN_P[foreman], text: parts.filter(Boolean).join(' · '), live });
  }
  return out;
}

export function healthNode(lines) {
  const box = el('div', 'rn-health');
  box.setAttribute('aria-label', 'Run engines');
  for (const l of lines) {
    const row = el('p', 'rn-health-line');
    row.dataset.foreman = l.foreman;
    row.append(lamp(l.p, { label: `foreman ${l.foreman}` }), el('b', null, `${l.engine}: foreman ${l.foreman}`));
    if (l.text) row.append(el('span', 'rn-health-t', l.text));
    if (l.live.length) {
      for (const r of l.live) {
        const a = el('a', 'rn-health-run', r.text);
        a.href = runHref(r.key);
        row.append(a);
      }
    } else row.append(el('span', 'rn-health-t', 'no run now'));
    box.append(row);
  }
  return box;
}

// ---------------------------------------------------------------- what waits, on a run's row

/** The run's waiting items under its row: kind, title, revision, and the board's own buttons. */
export function gatesNode(row, onDone) {
  const items = Array.isArray(row?.waiting) ? row.waiting : [];
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

export function engineRow(row, now = Date.now(), onDone = null) {
  const li = el('li', 'rn-row');
  li.dataset.run = rnClean(row.run, 100) ?? '';
  li.dataset.state = row.state;
  li.dataset.engine = rnClean(row.engine, 32) ?? '';
  if (engineNeedsYou(row)) li.dataset.needs = '';
  if (row.stale) li.dataset.stale = '';

  const goal = el('span', 'rn-f rn-goal');
  const a = el('a', 'rn-goal-t rn-open', goalText(row) || rnClean(row.runId, 64));
  a.href = runHref(row.run);
  goal.append(a, sourceLabel(row.product, row.engine), el('span', 'rn-goal-sub', rnClean(row.run, 100) ?? ''));
  goal.title = [goalText(row), rnClean(row.run, 100)].filter(Boolean).join('\n');

  const node = el('span', 'rn-f rn-node', rnClean(row.node, 80) ?? DASH);
  node.title = row.node ? `working on ${rnClean(row.node, 80)}` : 'no current node';
  const rooms = el('span', 'rn-f rn-rooms', row.rooms?.length ? `${row.rooms.length} ${row.rooms.length === 1 ? 'room' : 'rooms'}` : DASH);
  const seen = typeof row.updatedAt === 'number' ? now - row.updatedAt : null;
  const left = el('span', 'rn-f rn-left', row.stop ? rnClean(row.stop, 32) : engineAge(seen));
  if (row.stale) left.title = `last good answer, ${engineAge(row.age)}`;
  const usd = usdOf(row);
  li.append(engineStateCell(engineStateOf(row)), goal, node, rooms, left, el('span', 'rn-f rn-cost', usd === null ? DASH : money(usd)));
  const gates = gatesNode(row, onDone);
  if (gates) li.append(gates);
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
export const newPage = () => ({ run: null, stale: false, age: null, events: [], next: 0, eventsFailed: false, overrides: new Map(), seen: new Set() });

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
export function runControls(key, run) {
  const out = [];
  const on = (label, word, action, tier) => out.push({ label, word, action, target: key, tier, args: {}, lines: [rnClean(key, 100) ?? '', 'Gentle: the current step finishes first.'] });
  if (['running', 'at-gate', 'queued'].includes(run?.state)) on('Pause', 'pause', 'engine-pause', 'click');
  if (run?.state === 'paused') on('Resume', 'resume', 'engine-resume', 'click');
  if (run && !['done', 'stopped'].includes(run.state)) on('Stop', 'stop', 'engine-stop', 'confirm');
  return out;
}

function enginePageHead(key, run, page, now) {
  const head = el('header', 'rn-head');
  const back = el('a', 'rn-back', '← Runs');
  back.href = LIST_HREF;
  const top = el('div', 'rn-head-top');
  const goal = el('span', 'rn-f rn-goal');
  const title = run.goalTitle ?? (Array.isArray(run.tree) ? run.tree.find((n) => n.id === run.goal)?.title : null);
  goal.append(el('span', 'rn-goal-t', [rnClean(run.product, 48), rnClean(run.goal, 32), rnClean(title)].filter(Boolean).join(' · ')),
    el('span', 'rn-goal-sub', rnClean(key, 100) ?? ''));
  top.append(engineStateCell(engineStateOf(run)), goal);
  const facts = el('div', 'rn-facts');
  const add = (cls, text, t) => { const f = el('span', `rn-f ${cls}`, text); if (t) f.title = t; facts.append(f); };
  if (run.node) add('rn-node', `at ${rnClean(run.node, 80)}`);
  if (run.stop) add('rn-left', `stop: ${rnClean(run.stop, 32)}`);
  if (usdOf(run) !== null) add('rn-cost', money(usdOf(run)), 'API price equivalent');
  if (run.rooms?.length) add('rn-rooms', run.rooms.map((r) => `${rnClean(r.name, 48)} ${rnClean(r.state, 16) ?? ''}`.trim()).join(', '));
  if (typeof run.updatedAt === 'number') add('rn-left', `updated ${engineAge(now - run.updatedAt)}`);
  if (run.product && run.goal) {
    const flow = el('a', 'rn-back', 'Flow overview');
    flow.href = `#/flow?product=${encodeURIComponent(run.product)}&goal=${encodeURIComponent(run.goal)}`;
    facts.append(flow);
  }
  head.append(back, top, facts);
  const controls = runControls(key, run);
  if (controls.length) {
    const box = el('div', 'rn-facts');
    for (const c of controls) box.append(decisionButton(c));
    head.append(box);
  }
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
export function renderEnginePage(container, key, page, st = { status: 'ok' }, now = Date.now()) {
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
    const open = (run.gates ?? []).filter((g) => g.state === 'open');
    if (open.length) root.append(gatesSection(run.gates));
    const treeSec = engineSection('rt-tree', 'Tree', tree.byId.size);
    const ul = el('ul', 'rt-list');
    for (const r of tree.roots) ul.append(nodeItem(r, v, 0));
    treeSec.append(ul);
    root.append(treeSec);
    if (page.eventsFailed) root.append(el('p', 'rn-stale', 'The events could not be read.'));
    if (run.prs?.length) root.append(prsSection(run.prs));
    if (run.report) {
      const s = engineSection('rt-report', 'Report');
      s.append(el('p', null, rnClean(run.report.summary, 2000) ?? ''), link('rt-pr', 'Full report', run.report.url));
      root.append(s);
    }
    if (placed.run.length) {
      const d = el('details', 'rt-runev');
      d.dataset.keep = 'run-events';
      d.open = page.runEventsOpen === true;
      d.append(el('summary', null, `Run events (${placed.run.length})`), eventList(placed.run));
      root.append(d);
    }
  }
  if (container) {
    const focus = container.ownerDocument?.activeElement?.dataset?.fold ?? null;
    container.textContent = '';
    container.append(root);
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
