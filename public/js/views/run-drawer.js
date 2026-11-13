// The drawer under a run's loop (docs/run-drawer.md): closed by default, one
// panel at a time. A click on a loop station opens that station's rounds and
// checks; the tabs open Built (the tree with a mini loop per node) and the
// Timeline. The × closes it. What is open lives on the page state, so the 5 s
// repaint keeps it.
//
// Engine text goes in through textContent and setAttribute only.
import { el, svg } from '../core/dom.js';
import { money } from '../core/format.js';
import { rnClean, safeHref } from '../core/run-text.js';
import { checksOf, miniLoop, paramsOf, patternOf, roundsOf, stationLog, stationOf } from '../core/loop.js';

/** The tabs, in order. Later steps add more. */
export const TABS = Object.freeze([['built', 'Built'], ['timeline', 'Timeline']]);

const DASH = '—';
const hm = (ms) => {
  if (typeof ms !== 'number') return DASH;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dayHm = (ms) => (typeof ms === 'number' ? `${new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm(ms)}` : DASH);
export const dur = (ms) => (typeof ms !== 'number' ? DASH : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** Parse a `data-drawer` value: `station:<id>`, `tab:<id>`, `close`. */
export function parseDrawer(v) {
  if (v === 'close') return null;
  const m = /^(station|tab):([a-z]{1,16})$/.exec(String(v ?? ''));
  return m ? { kind: m[1], id: m[2] } : undefined;
}

/**
 * A click (or Enter) on something with `data-drawer`: open it, or close the drawer
 * when it is the one already open or the ×. Returns true when the page changed.
 */
export function toggleDrawer(page, target) {
  const hit = target?.closest?.('[data-drawer]');
  if (!hit || !page) return false;
  const want = parseDrawer(hit.dataset?.drawer ?? hit.getAttribute?.('data-drawer'));
  if (want === undefined) return false;
  const same = want && page.drawer && page.drawer.kind === want.kind && page.drawer.id === want.id;
  page.drawer = same ? null : want;
  return true;
}

function drTable(cols, rows, cls) {
  const wrap = el('div', 'dr-tw');
  const t = el('table', `dr-tbl ${cls}`);
  const head = el('tr');
  for (const c of cols) head.append(el('th', null, c));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const cell of r) {
      const td = el('td');
      if (cell !== null && typeof cell === 'object') td.append(cell);
      else td.textContent = cell == null ? DASH : String(cell);
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(thead, body);
  wrap.append(t);
  return wrap;
}

function outLink(c) {
  if (!safeHref(c.output)) return DASH;
  const a = el('a', 'dr-a', 'output ↗');
  a.href = c.output;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const countsText = (c) => (c?.counts ? `${c.counts.passed} passed, ${c.counts.failed} failed${c.counts.skipped ? `, ${c.counts.skipped} skipped` : ''}` : DASH);

/** The rounds table. */
export function roundsTable(rounds, now = Date.now()) {
  return drTable(['#', 'role', 'tier', 'model', 'node', 'start', 'time', 'cost', 'result'], rounds.map((r) => [
    String(r.n), rnClean(r.role, 24), rnClean(r.tier, 12), rnClean(r.model, 32), rnClean(r.node, 48), dayHm(r.start),
    r.open ? `${dur(now - r.start)} so far` : dur(r.ms), typeof r.usd === 'number' ? money(r.usd) : DASH, r.open ? 'running' : rnClean(r.result, 16),
  ]), 'dr-rounds');
}

/** The checks table. */
export function checksTable(checks) {
  return drTable(['check', 'result', 'counts', 'node', 'at', ''], checks.map((c) => [
    rnClean(c.name, 64), c.pass ? '✓ green' : '■ red', countsText(c), rnClean(c.node, 48) ?? 'run', dayHm(c.at), outLink(c),
  ]), 'dr-checks');
}

function gatesTable(gates) {
  return drTable(['gate', 'state', 'decided', 'by', 'via', 'at'], gates.map((g) => [
    rnClean(g.kind, 16), rnClean(g.state, 16), rnClean(g.decided?.decision, 16), rnClean(g.decided?.by, 32), rnClean(g.decided?.via, 32), dayHm(g.decided?.at ?? g.openedAt),
  ]), 'dr-gates');
}

function panelHead(title, sub) {
  const h = el('div', 'dr-head');
  const t = el('h3', 'dr-t', title);
  h.append(t);
  if (sub) h.append(el('span', 'dr-sub', sub));
  const x = el('button', 'btn btn--s dr-x', '×');
  x.type = 'button';
  x.dataset.drawer = 'close';
  x.setAttribute('aria-label', 'Close');
  h.append(x);
  return h;
}

/** A station's panel: what happens there, the node it is on, its rounds and checks. */
export function stationPanel(run, events, pattern, pos, id, now = Date.now()) {
  const st = stationOf(pattern, id);
  const box = el('section', 'dr-panel');
  box.dataset.panel = `station:${id}`;
  const m = pos.stations[id] ?? {};
  box.append(panelHead(st?.label ?? id, m.more ?? m.sub ?? null));
  if (st?.text) box.append(el('p', 'dr-text', st.text));
  const tree = Array.isArray(run?.tree) ? run.tree : [];
  const byId = new Map(tree.map((n) => [n.id, n]));
  if (id === pos.current && pos.node && byId.get(pos.node)) {
    const n = byId.get(pos.node);
    const p = el('p', 'dr-node');
    p.append(el('span', 'dr-k', `on ${rnClean(n.id, 48)}`), el('span', null, [rnClean(n.title, 200), rnClean(n.state, 16)].filter(Boolean).join(' · ')));
    box.append(p);
    if (n.reason) box.append(el('p', 'dr-reason', rnClean(n.reason, 2000)));
  }
  const rounds = roundsOf(events);
  const log = stationLog(id, rounds, checksOf(events), new Map(tree.map((n) => [n.id, n.level])));
  if (st?.gate) {
    const gates = (run?.gates ?? []).filter((g) => g.kind === st.gate);
    box.append(el('h4', 'dr-h', `Gates (${gates.length})`), gates.length ? gatesTable(gates) : el('p', 'dr-none', 'None yet.'));
  }
  if (!['taskcheck', 'featurecheck', 'suite', 'merge', 'recipe', 'pr', 'end'].includes(id)) {
    box.append(el('h4', 'dr-h', `Rounds (${log.rounds.length})`), log.rounds.length ? roundsTable(log.rounds, now) : el('p', 'dr-none', 'No rounds here yet.'));
  }
  if (log.checks.length || ['taskcheck', 'featurecheck', 'suite', 'goalcheck'].includes(id)) {
    box.append(el('h4', 'dr-h', `Checks (${log.checks.length})`), log.checks.length ? checksTable(log.checks) : el('p', 'dr-none', 'No checks here yet.'));
  }
  if (id === 'end' && run?.stop) box.append(el('p', 'dr-text', `${rnClean(run.stop, 32)}: ${pattern.stops[run.stop] ?? ''}`));
  return box;
}

/** The mini loop per node, for the Built tree: id -> words. */
export function miniLoops(run, events) {
  const { pattern } = patternOf(run);
  const tree = Array.isArray(run?.tree) ? run.tree : [];
  if (!pattern) return new Map();
  const params = paramsOf(run, pattern);
  const rounds = roundsOf(events);
  const checks = checksOf(events);
  return new Map(tree.map((n) => [n.id, miniLoop(n, tree, rounds, checks, params)]));
}

// ---------------------------------------------------------------- the timeline

/** Idle gaps longer than this are cut out of the timeline, with a mark. */
export const GAP_MS = 30 * 60_000;

/**
 * The time axis with long idle gaps cut: [{from, to}] spans of activity.
 * `x(t)` maps a time into 0..width, a cut taking `cutW`.
 */
export function timeAxis(times, width, cutW = 18, gap = GAP_MS) {
  const ts = times.filter((t) => typeof t === 'number').sort((a, b) => a - b);
  if (!ts.length) return { spans: [], x: () => 0, cuts: [] };
  const spans = [{ from: ts[0], to: ts[0] }];
  for (const t of ts.slice(1)) {
    const s = spans.at(-1);
    if (t - s.to > gap) spans.push({ from: t, to: t });
    else s.to = t;
  }
  const total = spans.reduce((a, s) => a + Math.max(s.to - s.from, 60_000), 0);
  const usable = Math.max(width - cutW * (spans.length - 1), 10);
  let off = 0;
  for (const s of spans) {
    s.x0 = off;
    s.w = (Math.max(s.to - s.from, 60_000) / total) * usable;
    off += s.w + cutW;
  }
  const x = (t) => {
    for (const s of spans) if (t <= s.to + 1) return s.x0 + (Math.max(0, t - s.from) / Math.max(s.to - s.from, 60_000)) * s.w;
    const s = spans.at(-1);
    return s.x0 + s.w;
  };
  const cuts = spans.slice(1).map((s, i) => ({ x: s.x0 - cutW / 2, ms: s.from - spans[i].to }));
  return { spans, x, cuts };
}

const LANE_H = 22;
const LEFT = 92;

/** The timeline: lanes for the run, its checks, and one per role, each round a bar. */
export function timelinePanel(run, events, now = Date.now()) {
  const box = el('section', 'dr-panel');
  box.dataset.panel = 'tab:timeline';
  box.append(panelHead('Timeline', 'idle gaps over 30 min are cut'));
  const rounds = roundsOf(events);
  const checks = checksOf(events);
  const states = (events ?? []).filter((e) => e.type === 'run.state' && typeof e.at === 'number');
  const live = !['done', 'stopped'].includes(run?.state);
  const end = live ? now : (run?.endedAt ?? states.at(-1)?.at ?? now);
  const times = [...(events ?? []).map((e) => e.at), end];
  if (!rounds.length && !checks.length && !states.length) {
    box.append(el('p', 'dr-none', 'Nothing has happened yet.'));
    return box;
  }
  const roles = [...new Set(rounds.map((r) => r.role).filter(Boolean))];
  const lanes = ['run', 'checks', ...roles];
  const W = 1000;
  const H = 24 + lanes.length * LANE_H + 8;
  const ax = timeAxis(times, W - LEFT - 8);
  const X = (t) => LEFT + ax.x(t);
  const s = svg('svg', { class: 'dr-tl', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Timeline of ${rounds.length} rounds and ${checks.length} checks` });
  const y = (lane) => 24 + lanes.indexOf(lane) * LANE_H;
  lanes.forEach((lane) => {
    const t = svg('text', { x: 4, y: y(lane) + 14, class: 'dr-tl-lane' });
    t.textContent = rnClean(lane, 14) ?? '';
    s.append(t, svg('line', { x1: LEFT, x2: W - 8, y1: y(lane) + LANE_H - 2, y2: y(lane) + LANE_H - 2, class: 'dr-tl-rule' }));
  });
  for (const sp of ax.spans) {
    if (sp.w < 60 && sp !== ax.spans[0]) continue;
    const nearEnd = LEFT + sp.x0 > W - 120;
    const t = svg('text', { x: nearEnd ? W - 8 : LEFT + sp.x0, y: 12, 'text-anchor': nearEnd ? 'end' : 'start', class: 'dr-tl-tick' });
    t.textContent = dayHm(sp.from);
    s.append(t);
  }
  for (const c of ax.cuts) {
    const g = svg('g', { class: 'dr-tl-cut' });
    g.append(svg('line', { x1: LEFT + c.x, x2: LEFT + c.x, y1: 16, y2: H - 4 }));
    const tip = svg('title');
    tip.textContent = `${dur(c.ms)} idle, cut`;
    g.append(tip);
    s.append(g);
  }
  // The run lane: blocked and waiting spans, then a tick per state change.
  states.forEach((e, i) => {
    const to = states[i + 1]?.at ?? end;
    if (e.state === 'at-gate' || e.state === 'waiting-approval' || e.state === 'paused') {
      const r = svg('rect', { x: X(e.at), y: y('run') + 3, width: Math.max(2, X(to) - X(e.at)), height: LANE_H - 8, class: `dr-tl-span dr-tl-span--${e.state}` });
      const tip = svg('title');
      tip.textContent = `${e.state} ${dayHm(e.at)} → ${dayHm(to)}${e.reason ? `\n${rnClean(e.reason, 300)}` : ''}`;
      r.append(tip);
      s.append(r);
    }
    s.append(svg('line', { x1: X(e.at), x2: X(e.at), y1: y('run') + 2, y2: y('run') + LANE_H - 4, class: 'dr-tl-st' }));
  });
  for (const c of checks) {
    const t = svg('text', { x: X(c.at), y: y('checks') + 14, 'text-anchor': 'middle', class: `dr-tl-chk dr-tl-chk--${c.pass ? 'ok' : 'red'}` });
    t.textContent = c.pass ? '✓' : '■';
    const tip = svg('title');
    tip.textContent = `${rnClean(c.name, 64)} ${c.pass ? 'green' : 'red'} · ${rnClean(c.node, 48) ?? 'run'} · ${dayHm(c.at)} · ${countsText(c)}`;
    t.append(tip);
    s.append(t);
  }
  for (const r of rounds) {
    const to = r.open ? now : r.end ?? r.start;
    const b = svg('rect', { x: X(r.start), y: y(r.role) + 3, width: Math.max(3, X(to) - X(r.start)), height: LANE_H - 8, class: `dr-tl-bar dr-tl-bar--${r.open ? 'open' : r.result === 'ok' ? 'ok' : 'bad'}` });
    const tip = svg('title');
    tip.textContent = `round ${r.n} · ${rnClean(r.role, 24)} · ${rnClean(r.tier, 12) ?? '?'} · ${rnClean(r.node, 48) ?? ''} · ${r.open ? `${dur(now - r.start)} so far` : dur(r.ms)}${typeof r.usd === 'number' ? ` · ${money(r.usd)}` : ''} · ${r.open ? 'running' : rnClean(r.result, 16) ?? '?'}`;
    b.append(tip);
    s.append(b);
  }
  if (live) s.append(svg('line', { x1: X(now), x2: X(now), y1: 16, y2: H - 4, class: 'dr-tl-now' }));
  const wrap = el('div', 'dr-tw');
  wrap.append(s);
  box.append(wrap);
  return box;
}

/** The tab row under the loop. */
export function tabsNode(page) {
  const row = el('div', 'dr-tabs');
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', 'Detail');
  for (const [id, label] of TABS) {
    const b = el('button', 'btn btn--s dr-tab', label);
    b.type = 'button';
    b.dataset.drawer = `tab:${id}`;
    const on = page?.drawer?.kind === 'tab' && page.drawer.id === id;
    b.setAttribute('aria-pressed', String(on));
    row.append(b);
  }
  return row;
}

/**
 * The open panel, or null. `built` is the Built panel's body, the tree (the
 * run page owns it).
 */
export function drawerNode(run, page, { built, now = Date.now() } = {}) {
  const d = page?.drawer;
  if (!d || !run) return null;
  const events = page.events ?? [];
  if (d.kind === 'station') {
    const { pattern } = patternOf(run);
    if (!pattern || !stationOf(pattern, d.id)) return null;
    return stationPanel(run, events, pattern, page.pos ?? { stations: {} }, d.id, now);
  }
  if (d.id === 'timeline') return timelinePanel(run, events, now);
  if (d.id === 'built') {
    const box = el('section', 'dr-panel');
    box.dataset.panel = 'tab:built';
    const tree = Array.isArray(run.tree) ? run.tree : [];
    box.append(panelHead('Built', `${tree.length} nodes`));
    if (built) box.append(built);
    return box;
  }
  return null;
}
