// The Board: lane cards, the grid, the lane rail. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { STATE_RANK, ago, hueFromId, money } from '../core/format.js';
import { laneById, laneVisible, store } from '../core/store.js';
import { scheduleVisible, unwatchCard, watchCard } from '../core/net.js';
import { prChip } from '../ui/widgets.js';
import { openSheet } from '../ui/sheet.js';
import { renderCard } from './board-card.js';

export const cardNodes = new Map(); // name -> element

export function orderedSessions() {
  const rank = { waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 };
  return [...store.sessions.values()].sort(
    (a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------- board units
//
// v3 hard rule 5: the Board's unit is the LANE CARD, and lane cards sort by the
// most urgent thing inside them; a session with no lane sorts among them by the
// same key. Lane is a container, never a sort key. The session cards inside a
// lane card are the same nodes as before (cursor, pin, menu, visibility all
// keep working), rendered as compact rows.

/** lane id -> { node, head, rows, sig } */
const laneNodes = new Map();

/** One session's urgency: the guard's danger first, then v2's state order. */
function sessionRank(s) {
  return s.danger ? -1 : (STATE_RANK[s.state] ?? 9);
}

function laneRecord(id) {
  return store.box?.launched?.find((r) => r.id === id) ?? null;
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
    if (!s.lane) { units.push({ kind: 'session', key: `s:${s.name}`, rank: sessionRank(s), name: s.name, s }); continue; }
    if (!lanes.has(s.lane)) lanes.set(s.lane, { kind: 'lane', key: `l:${s.lane}`, id: s.lane, sessions: [] });
    lanes.get(s.lane).sessions.push(s);
  }
  for (const r of store.box?.launched ?? []) {
    if (!lanes.has(r.id)) lanes.set(r.id, { kind: 'lane', key: `l:${r.id}`, id: r.id, sessions: [] });
  }
  for (const u of lanes.values()) {
    u.rank = u.sessions.length ? Math.min(...u.sessions.map(sessionRank)) : 8;
    u.name = u.id;
    units.push(u);
  }
  return units.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

/** The session's node, re-rendered only when it changed or moved in/out of a lane card. */
function sessionNode(s, changedNames, asRow) {
  let node = cardNodes.get(s.name);
  const wasRow = node?.dataset.row === '1';
  if (!node) {
    node = renderCard(s, { row: asRow });
    cardNodes.set(s.name, node);
    watchCard(node);
  } else if ((wasRow !== asRow || !changedNames || changedNames.includes(s.name)) && !node.querySelector('.menu')) {
    // Never re-render a card whose ⋯ menu is open — a delta arriving mid-click
    // would replace the menu just as it is being aimed at.
    const fresh = renderCard(s, { row: asRow });
    unwatchCard(node);
    node.replaceWith(fresh);
    cardNodes.set(s.name, fresh);
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

export function renderGrid(changedNames) {
  const grid = $('grid');
  const units = orderedUnits();

  const liveNames = new Set(store.sessions.keys());
  for (const [name, node] of cardNodes) {
    if (!liveNames.has(name)) { unwatchCard(node); node.remove(); cardNodes.delete(name); }
  }
  const liveLanes = new Set(units.filter((u) => u.kind === 'lane').map((u) => u.id));
  for (const [id, ln] of laneNodes) {
    if (!liveLanes.has(id)) { ln.node.remove(); laneNodes.delete(id); }
  }

  let shown = 0;
  const top = [];
  for (const u of units) {
    if (u.kind === 'session') {
      const node = sessionNode(u.s, changedNames, false);
      node.hidden = !laneVisible(u.s);
      if (!node.hidden) shown++;
      top.push(node);
      continue;
    }
    const ln = laneCardNode(u);
    placeInOrder(ln.rows, u.sessions.map((s) => sessionNode(s, changedNames, true)));
    for (const n of u.sessions.map((s) => cardNodes.get(s.name))) n.hidden = false;
    // Filter by lane: the whole card hides, and clearing the filter restores
    // the same nodes rather than rebuilding them.
    ln.node.hidden = store.laneFilter.size > 0 && !store.laneFilter.has(u.id);
    if (!ln.node.hidden) shown++;
    top.push(ln.node);
  }
  placeInOrder(grid, top);

  const empty = $('grid-empty');
  empty.hidden = shown > 0;
  empty.textContent = units.length
    ? 'No sessions in the selected lanes.'
    : 'No sessions and no lanes. Launch one with the button above, or `laneboard launch`.';
}

/** The lane card: header rebuilt when its data changes, rows kept as nodes. */
function laneCardNode(u) {
  const lane = laneById(u.id);
  const rec = laneRecord(u.id);
  const b = store.box ?? {};
  const headData = {
    lane, rec,
    pr: b.prs?.[u.id] ?? null,
    slot: rec ? (b.slots ?? []).find((x) => x.slot === rec.slot) ?? null : null,
    burn: b.burn5h?.[u.id] ?? null,
    readiness: b.readiness?.[u.id] ?? null,
    job: (b.jobs ?? []).find((j) => j.lane === u.id) ?? null,
    live: u.sessions.map((s) => s.name),
    marker: newestMarker(u.sessions),
    danger: u.sessions.some((s) => s.danger),
  };
  const sig = JSON.stringify(headData);
  let ln = laneNodes.get(u.id);
  if (!ln) {
    const node = el('div', 'card lane-card has-lane');
    node.dataset.lane = u.id;
    const head = el('div', 'lane-head');
    const rows = el('div', 'lane-rows');
    node.append(head, rows);
    ln = { node, head, rows, sig: null };
    laneNodes.set(u.id, ln);
  }
  if (ln.sig !== sig) {
    ln.sig = sig;
    ln.node.style.setProperty('--lane-hue', String(lane?.hue ?? hueFromId(u.id)));
    ln.node.classList.toggle('danger', headData.danger);
    ln.head.textContent = '';
    renderLaneHead(ln.head, u.id, headData);
  }
  return ln;
}

function newestMarker(sessions) {
  let best = null;
  for (const s of sessions) if (s.lastMarker && (!best || s.lastMarker.ts > best.ts)) best = s.lastMarker;
  return best;
}

function renderLaneHead(head, id, d) {
  const top = el('div', 'lane-top');
  top.append(el('span', 'lane-title', id));
  const p = d.lane?.progress;
  if (p?.m != null) {
    const st = el('span', 'lane-stage', `${p.n ?? 0}/${p.m}`);
    st.title = p.n == null ? `no stage of ${p.m} finished yet` : `stage ${p.n} of ${p.m}`;
    top.append(st);
    if (p.current?.title) top.append(el('span', 'lane-current', p.current.n != null ? `S${p.current.n} ${p.current.title}` : p.current.title));
  }
  if (d.burn != null && d.burn > 0.005) {
    const burn = el('span', 'lane-burn', `${money(d.burn)}/5h`);
    burn.title = 'API-equivalent spend of this lane over the last 5 hours';
    top.append(burn);
  }
  head.append(top);

  const meta = el('div', 'card-meta lane-meta');
  const branch = d.rec?.branch ?? d.lane?.branch;
  if (branch) meta.append(el('span', 'branch', `⌥${branch}`));
  if (d.rec) meta.append(prChip(d.pr));
  if (d.rec?.slot != null) {
    const up = d.slot?.up;
    const slot = el('span', `chip-slot ${up ? 'slot-up' : 'slot-down'}`, `slot ${d.rec.slot}${d.slot?.ports ? ` :${d.slot.ports.pg}` : ''}`);
    slot.title = up ? 'agent stack up' : 'agent stack down';
    meta.append(slot);
  }
  if (d.rec?.model) meta.append(el('span', 'model', d.rec.model));
  if (!d.rec && d.lane && !d.lane.isMain && d.lane.merged === true) meta.append(el('span', 'lane-merged', 'merged'));
  if (meta.childNodes.length) head.append(meta);

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
    const on = store.laneFilter.has(lane.id);
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
    pill.onclick = () => toggleLane(lane.id);
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
    if (lane.branch) item.append(el('span', 'lane-branch', `⌥${lane.branch}`));
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

export function focusSession(name) {
  store.cursor = name;
  const node = cardNodes.get(name);
  if (node && innerWidth >= 700) {
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    for (const n of cardNodes.values()) n.classList.remove('cursor');
    node.classList.add('cursor');
  } else {
    openSheet(name);
  }
}
