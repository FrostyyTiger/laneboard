// The Board: lane cards, the grid, the lane rail. Moved from public/app.js
// (fleet F1); redesigned as ATC data blocks in an inset-title panel (fleet D9,
// plan §4 2.7). The view registry (views/index.js) picks up the default
// export at the bottom of this file.
import { $, el } from '../core/dom.js';
import { STATE_RANK, ago, hueFromId, money } from '../core/format.js';
import { laneById, laneVisible, store } from '../core/store.js';
import { fkey } from '../core/keys.js';
import { scheduleVisible, unwatchCard, watchCard } from '../core/net.js';
import { icon } from '../core/icons.js';
import { panel, setPanel } from '../ui/components.js';
import { prChip } from '../ui/widgets.js';
import { openSheet } from '../ui/sheet.js';
import {
  FIELDS, builderCode, builderStale, checksLabel, dataBlock, emptyField, markTrouble, renderCard, showCodes,
} from './board-card.js';

/** True when a builder id names a hub builder that is not live. */
function staleBuilder(id) {
  const b = id ? store.builders.get(id) : null;
  return Boolean(b) && store.source.kind === 'hub' && (b.status === 'stale' || b.status === 'down');
}

export const cardNodes = new Map(); // fleet key -> element

export function orderedSessions() {
  const rank = { waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 };
  return [...store.sessions.values()].sort(
    (a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || a.name.localeCompare(b.name) || cmp(a.key, b.key)
  );
}

// ---------------------------------------------------------------- board units
//
// v3 hard rule 5: the Board's unit is the LANE CARD, and lane cards sort by the
// most urgent thing inside them; a session with no lane sorts among them by the
// same key. Lane is a container, never a sort key. The session cards inside a
// lane card are the same nodes as before (cursor, pin, menu, visibility all
// keep working), rendered as compact rows.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** lane fleet key -> { node, head, rows, sig } */
const laneNodes = new Map();

/** One session's urgency: the guard's danger first, then v2's state order. */
function sessionRank(s) {
  return s.danger ? -1 : (STATE_RANK[s.state] ?? 9);
}

/** The box (lane records, PRs, slots, jobs) of the builder that owns a lane. */
function boxOf(builderId) {
  return store.builders.get(builderId)?.box ?? (store.builders.size <= 1 ? store.box : null) ?? null;
}

function laneRecord(u) {
  return boxOf(u.builder)?.launched?.find((r) => r.id === u.id) ?? null;
}

/** A lane's fleet key; a session or record without a builder falls back to the bare id. */
function laneKeyOf(builderId, id) {
  try { return fkey(builderId, id); } catch { return id; }
}

/**
 * Units in board order. A lane card for every lane with a live session, and
 * for every launched lane that is not retired even when nothing runs in it
 * (it then shows its retire readiness). Sessions with no lane stay lone cards.
 */
export function orderedUnits() {
  const lanes = new Map();
  const units = [];
  for (const s of orderedSessions()) {
    if (!s.lane) { units.push({ kind: 'session', key: `s:${s.key}`, rank: sessionRank(s), name: s.name, s }); continue; }
    const lk = s.laneKey ?? laneKeyOf(s.builder, s.lane);
    if (!lanes.has(lk)) lanes.set(lk, { kind: 'lane', key: `l:${lk}`, laneKey: lk, id: s.lane, builder: s.builder, sessions: [] });
    lanes.get(lk).sessions.push(s);
  }
  for (const b of store.builders.values()) {
    for (const r of boxOf(b.id)?.launched ?? []) {
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      const lk = laneKeyOf(b.id, r.id);
      if (!lanes.has(lk)) lanes.set(lk, { kind: 'lane', key: `l:${lk}`, laneKey: lk, id: r.id, builder: b.id, sessions: [] });
    }
  }
  for (const u of lanes.values()) {
    u.rank = u.sessions.length ? Math.min(...u.sessions.map(sessionRank)) : 8;
    u.name = u.id;
    units.push(u);
  }
  return units.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || cmp(a.key, b.key));
}

/** The session's node, re-rendered only when it changed or moved in/out of a lane card. */
function sessionNode(s, changedKeys, asRow) {
  const k = s.key;
  let node = cardNodes.get(k);
  const wasRow = node?.dataset.row === '1';
  if (!node) {
    node = renderCard(s, { row: asRow });
    cardNodes.set(k, node);
    watchCard(node);
  } else if ((wasRow !== asRow || !changedKeys || changedKeys.includes(k)) && !node.querySelector('.menu')) {
    // Never re-render a card whose ⋯ menu is open — a delta arriving mid-click
    // would replace the menu just as it is being aimed at.
    const fresh = renderCard(s, { row: asRow });
    unwatchCard(node);
    node.replaceWith(fresh);
    cardNodes.set(k, fresh);
    node = fresh;
    watchCard(node);
  }
  return node;
}

/** Keep `parent`'s children in exactly this order without rebuilding them. */
function placeInOrder(parent, nodes) {
  let prev = null;
  for (const node of nodes) {
    const after = prev ? prev.nextSibling : parent.firstChild;
    if (node !== after) parent.insertBefore(node, after);
    prev = node;
  }
}

/** `changedKeys`: the fleet keys a delta touched; undefined re-renders every card. */
export function renderGrid(changedKeys) {
  const grid = $('grid');
  const units = orderedUnits();

  const liveKeys = new Set([...store.sessions.values()].map((s) => s.key));
  for (const [k, node] of cardNodes) {
    if (!liveKeys.has(k)) { unwatchCard(node); node.remove(); cardNodes.delete(k); }
  }
  const liveLanes = new Set(units.filter((u) => u.kind === 'lane').map((u) => u.laneKey));
  for (const [id, ln] of laneNodes) {
    if (!liveLanes.has(id)) { ln.node.remove(); laneNodes.delete(id); }
  }

  let shown = 0;
  const top = [];
  for (const u of units) {
    if (u.kind === 'session') {
      const node = sessionNode(u.s, changedKeys, false);
      node.hidden = !laneVisible(u.s);
      if (!node.hidden) shown++;
      top.push(node);
      continue;
    }
    const ln = laneCardNode(u);
    placeInOrder(ln.rows, u.sessions.map((s) => sessionNode(s, changedKeys, true)));
    for (const n of u.sessions.map((s) => cardNodes.get(s.key))) n.hidden = false;
    // Filter by lane: the whole card hides, and clearing the filter restores
    // the same nodes rather than rebuilding them.
    ln.node.hidden = store.laneFilter.size > 0 && !store.laneFilter.has(u.laneKey);
    if (!ln.node.hidden) shown++;
    top.push(ln.node);
  }
  placeInOrder(grid, top);

  lastShown = shown;
  syncPanel();

  const empty = $('grid-empty');
  empty.hidden = shown > 0;
  empty.textContent = units.length
    ? 'No sessions in the selected lanes.'
    : 'No sessions and no lanes. Launch one with the button above, or `laneboard launch`.';
}

/** The lane card: header rebuilt when its data changes, rows kept as nodes. */
function laneCardNode(u) {
  const lane = laneById(u.laneKey);
  const rec = laneRecord(u);
  const b = boxOf(u.builder) ?? {};
  const headData = {
    lane, rec,
    pr: b.prs?.[u.id] ?? null,
    slot: rec ? (b.slots ?? []).find((x) => x.slot === rec.slot) ?? null : null,
    burn: b.burn5h?.[u.id] ?? null,
    readiness: b.readiness?.[u.id] ?? null,
    job: (b.jobs ?? []).find((j) => j.lane === u.id) ?? null,
    live: u.sessions.map((s) => s.key),
    // What the head's data block shows of its sessions: state, age, flags.
    states: u.sessions.map((s) => [s.state, s.stateSince ?? null, s.context?.usedPct ?? null, Boolean(s.stuck),
      Boolean(s.paused), Boolean(s.awaitingApproval), Boolean(s.danger)]),
    code: showCodes() ? builderCode(store.builders.get(u.builder) ?? { id: u.builder ?? '' }) : null,
    stale: u.sessions.some(builderStale) || (!u.sessions.length && staleBuilder(u.builder)),
    marker: newestMarker(u.sessions),
    danger: u.sessions.some((s) => s.danger),
  };
  const sig = JSON.stringify(headData);
  let ln = laneNodes.get(u.laneKey);
  if (!ln) {
    const node = el('div', 'card lane-card has-lane');
    node.dataset.lane = u.id;
    node.dataset.laneKey = u.laneKey;
    const head = el('div', 'lane-head');
    const rows = el('div', 'lane-rows');
    node.append(head, rows);
    ln = { node, head, rows, sig: null };
    laneNodes.set(u.laneKey, ln);
  }
  if (ln.sig !== sig) {
    ln.sig = sig;
    ln.node.style.setProperty('--lane-hue', String(lane?.hue ?? hueFromId(u.id)));
    ln.node.classList.toggle('danger', headData.danger);
    // Dimmed and hatched by board.css (`.stale`), never an inline opacity.
    ln.node.classList.toggle('stale', headData.stale);
    ln.head.textContent = '';
    // The lane bar is grey unless the card is in trouble (board.css).
    markTrouble(ln.node, renderLaneHead(ln.head, u.id, headData, u.sessions));
  }
  return ln;
}

function newestMarker(sessions) {
  let best = null;
  for (const s of sessions) if (s.lastMarker && (!best || s.lastMarker.ts > best.ts)) best = s.lastMarker;
  return best;
}

/**
 * The lane card's head: the lane's data block (plan §4 2.7) on two lines.
 * Line 1: code, the most urgent session's state, lane, stage n/m and the
 * current stage, flags, age. Line 2: PR, checks, ctx, $ 5h, model, branch,
 * slot, each left out when it has nothing to show. Then the job line, the
 * newest marker, and the retire readiness. Returns the data block.
 */
function renderLaneHead(head, id, d, sessions = []) {
  const p = d.lane?.progress;
  const db = dataBlock(d.lane ?? { id }, null, {
    sessions, pr: d.pr, usd5h: d.burn, stale: d.stale, code: d.code ?? undefined, model: d.rec?.model,
  });
  const o = {
    showCode: d.code != null,
    builder: d.lane?.builder ?? null,
    checksLabel: checksLabel(d.pr?.checks),
    usdTitle: 'API-equivalent spend of this lane over the last 5 hours',
    ageTitle: 'time the most urgent session has been in its state',
  };

  const top = el('div', 'db db-1 lane-top');
  top.append(FIELDS.code(db, o), FIELDS.state(db, o));
  const title = el('span', 'db-f db-lane lane-title', id);
  title.title = [id, d.lane?.root ?? d.rec?.root ?? ''].filter(Boolean).join(' · ');
  top.append(title);
  if (p?.m != null) {
    const st = el('span', 'db-f db-stage lane-stage', `${p.n ?? 0}/${p.m}`);
    st.title = p.n == null ? `no stage of ${p.m} finished yet` : `stage ${p.n} of ${p.m}`;
    top.append(st);
    if (p.current?.title) top.append(el('span', 'lane-current', p.current.n != null ? `S${p.current.n} ${p.current.title}` : p.current.title));
  } else if (!emptyField(db, 'stage')) {
    top.append(FIELDS.stage(db, o));
  }
  top.append(FIELDS.flags(db, o));
  if (!emptyField(db, 'age')) top.append(FIELDS.age(db, o));
  head.append(top);

  const meta = el('div', 'card-meta lane-meta db db-2');
  if (d.rec) {
    // A launched lane always says something about its PR, "no PR" included.
    const pr = el('span', 'db-f db-pr');
    pr.append(icon(db.pr?.icon ?? 'pr', { size: 's' }), prChip(d.pr));
    meta.append(pr);
  } else if (!emptyField(db, 'pr')) {
    meta.append(FIELDS.pr(db, o));
  }
  // An empty field is left out, never a `—` (runs night 4 T15).
  for (const f of ['checks', 'ctx']) if (!emptyField(db, f)) meta.append(FIELDS[f](db, o));
  if (d.burn != null && d.burn > 0.005) {
    const burn = el('span', 'db-f db-usd lane-burn', `${money(d.burn)}/5h`);
    burn.title = o.usdTitle;
    meta.append(burn);
  }
  if (d.rec?.model) meta.append(el('span', 'db-f db-model model', d.rec.model));
  else if (!emptyField(db, 'model')) meta.append(FIELDS.model(db, o));
  // The branch only when it is not the lane's own name (r10 Board 6).
  const branch = d.rec?.branch ?? d.lane?.branch;
  if (branch && branch !== id) meta.append(el('span', 'branch', `⌥${branch}`));
  if (d.rec?.slot != null) {
    const up = d.slot?.up;
    const slot = el('span', `chip-slot ${up ? 'slot-up' : 'slot-down'}`, `slot ${d.rec.slot}${d.slot?.ports ? ` :${d.slot.ports.pg}` : ''}`);
    slot.title = up ? 'agent stack up' : 'agent stack down';
    meta.append(slot);
  }
  if (!d.rec && d.lane && !d.lane.isMain && d.lane.merged === true) meta.append(el('span', 'lane-merged', 'merged'));
  if (meta.children.length) head.append(meta);

  if (d.job && !['done'].includes(d.job.last?.step)) {
    const j = d.job.last;
    const line = el('div', `marker-line mk-${j?.ok === false ? 'blocked' : 'progress'}`);
    line.append(el('span', 'mk-kind', d.job.kind));
    line.append(el('span', 'mk-text', `${j?.step ?? '…'}${j?.detail?.error ? ` — ${j.detail.error}` : ''}`));
    head.append(line);
  }
  if (d.marker) {
    const mk = el('div', `marker-line mk-${d.marker.kind}`);
    mk.append(el('span', 'mk-kind', d.marker.kind));
    mk.append(el('span', 'mk-text', d.marker.text));
    mk.title = `${d.marker.session_name ?? ''} · ${new Date(d.marker.ts).toLocaleString('en-GB')}`;
    head.append(mk);
  }
  // Nothing live and not retired: say whether it could be let go of, and why
  // not. A flag with reasons; retiring is `laneboard retire`, a human's act.
  if (!d.live.length && d.rec) {
    const r = d.readiness;
    const box = el('div', `lane-ready ${r?.ready ? 'ready' : 'not-ready'}`);
    box.append(el('span', 'mk-kind', r ? (r.ready ? 'ready to retire' : 'not ready') : 'readiness …'));
    if (r) box.append(el('span', 'mk-text', (r.ready ? r.reasons : r.blockers).join(' · ')));
    head.append(box);
  }
  return db;
}

/**
 * The lane rail: filter, never reorder.
 *
 * This is the "show me only the character epic" view, on demand, without
 * paying for it on every other glance. Filtering preserves the attention sort
 * within the filtered set, so nothing is lost.
 *
 * Idle lanes — a worktree with no live session — are a muted second row. They
 * are not sessions: no card, no state, no attention score. What they answer is
 * "finished and mergeable" vs "abandoned", which is why they carry the
 * merged-into-main verdict and the age of their last commit.
 */
export function renderLanes() {
  const rail = $('lane-rail');
  rail.textContent = '';
  const lanes = store.lanes || [];
  rail.hidden = lanes.length === 0;
  if (!lanes.length) return;

  const active = lanes.filter((l) => !l.idle);
  const idle = lanes.filter((l) => l.idle);

  const row = el('div', 'lane-row');
  for (const lane of active) {
    const lk = lane.key ?? lane.id;
    const on = store.laneFilter.has(lk);
    const pill = el('button', `lane-pill${on ? ' on' : ''}`);
    pill.style.setProperty('--lane-hue', String(lane.hue));
    pill.append(el('span', 'lane-swatch'));
    pill.append(el('span', 'lane-id', lane.id));
    // TODO: a plain count. The useful version is not "3 sessions" but
    // "one of them wants you".
    pill.append(el('span', 'lane-n', String(lane.sessions.length)));
    // A plan with no finished stage is 0/M: a launched lane starts there.
    if (lane.progress?.m != null) {
      const n = lane.progress.n ?? 0;
      const p = el('span', 'lane-stage', `${n}/${lane.progress.m}`);
      p.title = lane.progress.n == null
        ? `no stage of ${lane.progress.m} finished yet`
        : `stage ${n} of ${lane.progress.m}, according to the ` +
          `${lane.progress.source === 'commit' ? 'branch commits' : 'status doc'}`;
      pill.append(p);
    }
    pill.title = `${lane.root}${lane.branch ? ` · ${lane.branch}` : ''}\n${lane.sessions.join(', ')}`;
    pill.onclick = () => toggleLane(lk);
    row.append(pill);
  }
  if (store.laneFilter.size) {
    const clear = el('button', 'lane-pill lane-clear', `clear filter (${store.laneFilter.size})`);
    clear.onclick = () => { store.laneFilter.clear(); applyLaneFilter(); };
    row.append(clear);
  }
  if (active.length) rail.append(row);

  if (!idle.length) return;
  const idleRow = el('div', 'lane-row lane-row-idle');
  idleRow.append(el('span', 'lane-idle-label', 'idle'));
  for (const lane of idle) {
    const item = el('span', 'lane-idle');
    item.style.setProperty('--lane-hue', String(lane.hue));
    item.append(el('span', 'lane-swatch'));
    item.append(el('span', 'lane-id', lane.id));
    // The name once: the branch only when it differs from the lane's id (r10 Board 6).
    if (lane.branch && lane.branch !== lane.id) item.append(el('span', 'lane-branch', `⌥${lane.branch}`));
    if (lane.progress?.m != null) item.append(el('span', 'lane-stage', `${lane.progress.n ?? 0}/${lane.progress.m}`));
    // A main checkout is always an ancestor of origin/main; saying "merged"
    // there is noise, not news.
    if (!lane.isMain && lane.merged === true) item.append(el('span', 'lane-merged', 'merged'));
    if (!lane.isMain && lane.merged === false) item.append(el('span', 'lane-unmerged', 'unmerged'));
    if (lane.lastCommitAt) item.append(el('span', 'lane-age', ago(lane.lastCommitAt)));
    item.title = `${lane.root}\nno session running` +
      (lane.lastCommitAt ? `\nlast commit ${new Date(lane.lastCommitAt).toLocaleString('en-GB')}` : '');
    idleRow.append(item);
  }
  rail.append(idleRow);
}

/** `id`: a lane's fleet key (lane.key). */
export function toggleLane(id) {
  if (store.laneFilter.has(id)) store.laneFilter.delete(id);
  else store.laneFilter.add(id);
  applyLaneFilter();
}

/**
 * Re-evaluate the filter without re-rendering a single card.
 *
 * `renderGrid()` with no argument means "every card changed" and rebuilds all
 * of them; passing an empty list means "none did", so only visibility and DOM
 * order are recomputed. That is the difference between the filter being free
 * and the filter throwing away every card's identity — which loses an open ⋯
 * menu, the IntersectionObserver registration, and any text selection, and is
 * exactly what the lanes plan means by "the same cards, not re-created ones".
 */
export function applyLaneFilter() {
  renderLanes();
  renderGrid([]);
  scheduleVisible();
}

/** `k`: a session's fleet key. */
export function focusSession(k) {
  store.cursor = k;
  const node = cardNodes.get(k);
  if (node && innerWidth >= 700) {
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    for (const n of cardNodes.values()) n.classList.remove('cursor');
    node.classList.add('cursor');
  } else {
    openSheet(k);
  }
}

// ---------------------------------------------------------------- the view (D4 registry)

const MODE_KEY = 'lb.board.mode';
export const BOARD_MODES = Object.freeze(['cards', 'rows']);

/** A stored preference -> 'cards' (two-line data blocks) or 'rows' (one line each). Pure. */
export function boardModeFor(pref) {
  return pref === 'rows' ? 'rows' : 'cards';
}

/** The panel title's scope: the builder filter as its code plate, else ALL. Pure. */
export function boardScope(route, builders = new Map()) {
  const b = route?.b;
  if (typeof b !== 'string' || !b || b === 'all') return 'all';
  return builderCode(builders.get(b) ?? { id: b });
}

let boardPanel = null; // { root, grid, mode }
let lastShown = null;
let scope = 'all';

function readMode() {
  try { return boardModeFor(localStorage.getItem(MODE_KEY)); } catch { return 'cards'; }
}

function applyMode(mode) {
  if (!boardPanel) return;
  boardPanel.mode = boardModeFor(mode);
  boardPanel.grid.dataset.mode = boardPanel.mode;
  boardPanel.toggle.setAttribute('aria-pressed', String(boardPanel.mode === 'rows'));
}

/** Keep the panel title in step: LANES · <scope> [n]. */
function syncPanel() {
  if (!boardPanel) return;
  setPanel(boardPanel.root, { scope, n: Number.isFinite(lastShown) ? lastShown : null });
}

/**
 * Put the grid inside an inset-title panel (once): LANES · ALL [n], with a
 * tool to switch between two-line cards and one-line rows.
 */
function ensurePanel(view) {
  const grid = $('grid');
  if (!grid) return null;
  if (boardPanel && boardPanel.grid === grid) return boardPanel;
  const toggle = el('button', 'btn btn--s btn--icon board-mode');
  toggle.append(icon('board', { size: 's' }));
  toggle.title = 'Cards or rows';
  toggle.setAttribute('aria-label', 'Cards or rows');
  toggle.onclick = () => {
    const next = boardPanel?.mode === 'rows' ? 'cards' : 'rows';
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
    applyMode(next);
  };
  const p = panel({ name: 'LANES', scope, id: 'board-panel-t', tools: [toggle] });
  p.root.classList.add('board-panel');
  const host = grid.parentNode ?? view ?? null;
  if (host) host.insertBefore(p.root, grid.parentNode ? grid : host.firstChild ?? null);
  p.body.append(grid);
  boardPanel = { root: p.root, grid, toggle, mode: 'cards' };
  applyMode(readMode());
  return boardPanel;
}

export default {
  id: 'board',
  icon: 'board',
  title: 'Board',
  short: 'BRD',
  /** The grid itself is painted by renderAll (ui/render.js) on every snapshot and delta. */
  mount: (view, ctx = {}) => {
    scope = boardScope(ctx.route, store.builders);
    ensurePanel(view);
    syncPanel();
  },
  unmount: () => {},
  update: (_s, ctx = {}) => {
    if (ctx.route) scope = boardScope(ctx.route, store.builders);
    syncPanel();
  },
};
