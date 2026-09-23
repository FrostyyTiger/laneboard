// Laneboard dashboard. Vanilla ES modules, no framework (hard rule 7).
import { openTerminal, closeTerminal, fitAll, writeTo, isLive } from '/terminal.js';

const $ = (id) => document.getElementById(id);

const STATE_LABEL = {
  waiting_permission: 'permission',
  waiting_question: 'question',
  working: 'working',
  done: 'done',
  idle: 'idle',
  shell: 'shell',
  dead: 'dead',
};

// ---------------------------------------------------------------- store

const store = {
  sessions: new Map(),
  attention: [],
  lanes: [],
  // Which lanes the grid is filtered to. Empty = show everything.
  //
  // UI-local by design (lanes plan hard rule 5): not on the server, not in
  // SQLite, not in localStorage. A filter you forgot you set is a board that
  // lies to you, and this board's whole job is to be believed.
  laneFilter: new Set(),
  vitals: null,
  // v3: lane records, PRs, slots, the dev stack, readiness, jobs (server box payload).
  box: null,
  generatedAt: 0,
  connected: false,
  cursor: null,           // session name the keyboard is on
  pinned: loadPinned(),   // Set of names, persisted
  dockLayout: null,      // null = auto (stacked for 1-2 pins, 2x2 for 3-4)
  openSession: null,      // name shown in the sheet
  view: 'board',          // board | morning | credit | box
};

// ---------------------------------------------------------------- views
//
// Four views, one page, hash-routed. The Board keeps every behaviour it had;
// the others are sections that are simply hidden. Nothing is torn down when a
// view is hidden, so switching back is instant and the terminals in the dock
// survive — but an IntersectionObserver reports a display:none subtree as
// off-screen, so the capture-pane rate drops on its own while you are elsewhere.
// v3: Machine and Files are gone. A stale #machine or #files is not in VIEWS,
// so it lands on the Board.
const VIEWS = ['board', 'morning', 'credit', 'box'];
const VIEW_KEYS = { b: 'board', m: 'morning', c: 'credit', x: 'box' };

function setView(name, { pushHash = true } = {}) {
  const view = VIEWS.includes(name) ? name : 'board';
  store.view = view;
  for (const v of VIEWS) {
    const node = $(`view-${v}`);
    if (node) node.hidden = v !== view;
  }
  for (const btn of document.querySelectorAll('.view-tab, .tab')) {
    btn.classList.toggle('on', btn.dataset.view === view);
  }
  if (pushHash && !store.openSession) {
    const want = `#${view}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  if (view === 'morning') loadMorning();
  if (view === 'credit') loadCredit();
  if (view === 'box') renderBox();
  scheduleVisible();
  fitAll();
}

function loadPinned() {
  try {
    const raw = localStorage.getItem('laneboard.pinned');
    if (raw === null) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}
function savePinned() {
  try { localStorage.setItem('laneboard.pinned', JSON.stringify([...store.pinned])); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- websocket

let ws = null;
let backoff = 500;
let visibleTimer = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    backoff = 500;
    setConnected(true);
    sendVisible();
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'snapshot') {
      store.sessions = new Map(msg.sessions.map((s) => [s.name, s]));
      applyCommon(msg);
      renderAll();
    } else if (msg.type === 'delta') {
      for (const s of msg.sessions || []) store.sessions.set(s.name, s);
      for (const n of msg.removed || []) store.sessions.delete(n);
      applyCommon(msg);
      renderAll(msg.sessions?.map((s) => s.name));
    } else if (msg.type === 'event') {
      // Events already move state via the next delta; nothing to draw yet.
    }
  });

  const drop = () => {
    setConnected(false);
    // Keep the last snapshot on screen and retry with backoff.
    backoff = Math.min(backoff * 1.8, 15000);
    setTimeout(connect, backoff);
  };
  ws.addEventListener('close', drop);
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
}

function applyCommon(msg) {
  if (msg.attention) store.attention = msg.attention;
  if (msg.lanes) store.lanes = msg.lanes;
  if (msg.vitals) {
    store.vitals = msg.vitals;
    // The host label next to the brand: whatever the server calls itself.
    const host = $('brand-host');
    if (host && msg.vitals.host && host.textContent !== msg.vitals.host) host.textContent = msg.vitals.host;
  }
  if (msg.box !== undefined) { store.box = msg.box; boxDirty = true; }
  if (msg.generatedAt) store.generatedAt = msg.generatedAt;
}

/** Lane id -> the lane object the server sent. */
function laneById(id) {
  if (!id) return null;
  return store.lanes.find((l) => l.id === id) ?? null;
}

/** Is this session shown under the current lane filter? */
function laneVisible(s) {
  if (!store.laneFilter.size) return true;
  return Boolean(s.lane) && store.laneFilter.has(s.lane);
}

function setConnected(on) {
  store.connected = on;
  $('offline').hidden = on;
  const c = $('conn');
  c.textContent = on ? 'live' : 'offline';
  c.classList.toggle('down', !on);
}

/**
 * Which cards are on screen, tracked by IntersectionObserver.
 * Measuring each card with getBoundingClientRect on every scroll forced a
 * layout per card per frame; the observer reports the same thing off the main
 * thread and keeps the render path free of reads.
 */
const onScreen = new Set();
const visibility = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const name = e.target.dataset.name;
        if (!name) continue;
        if (e.isIntersecting) onScreen.add(name);
        else onScreen.delete(name);
      }
      scheduleVisible();
    }, { rootMargin: '120px' })
  : null;

function watchCard(node) {
  if (visibility) visibility.observe(node);
  else onScreen.add(node.dataset.name); // no observer: treat everything as visible
}
function unwatchCard(node) {
  if (visibility) visibility.unobserve(node);
  onScreen.delete(node.dataset.name);
}

/** Tell the server which cards are on screen, so it captures those panes faster. */
function sendVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const names = [...onScreen];
  if (store.openSession) names.push(store.openSession);
  for (const n of store.pinned) names.push(n);
  ws.send(JSON.stringify({ type: 'visible', names: [...new Set(names)] }));
}
function scheduleVisible() {
  clearTimeout(visibleTimer);
  visibleTimer = setTimeout(sendVisible, 250);
}
addEventListener('resize', () => { scheduleVisible(); fitAll(); }, { passive: true });

// ---------------------------------------------------------------- helpers

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function money(v) {
  if (v == null) return '—';
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

/** 12345 -> "12.3k". */
function compactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function shortDir(dir) {
  if (!dir) return '';
  return dir.replace(/^\/home\/[^/]+/, '~');
}

function gauge(label, pct, extra) {
  const row = el('div', 'gauge-row');
  const lab = el('div', 'gauge-label');
  lab.append(el('span', null, label));
  const b = el('b', null, pct == null ? '—' : `${Math.round(pct)}%`);
  if (extra) b.title = extra;
  lab.append(b);
  const track = el('div', 'gauge-track');
  const fill = el('div', 'gauge-fill');
  fill.style.width = `${Math.min(100, Math.max(0, pct || 0))}%`;
  if (pct >= 90) fill.classList.add('hot');
  else if (pct >= 70) fill.classList.add('warn');
  track.append(fill);
  row.append(lab, track);
  return row;
}

function compactGauge(label, pct, title) {
  const n = el('span', 'gauge-compact');
  n.append(document.createTextNode(`${label} `));
  n.append(el('b', null, pct == null ? '—' : `${Math.round(pct)}%`));
  if (pct >= 90) n.classList.add('hot');
  else if (pct >= 70) n.classList.add('warn');
  if (title) n.title = title;
  return n;
}

/**
 * How loud a waiting session should look. Urgency is state x time, so the ring
 * fills on a log scale: 2 min ~ 15 %, 1 h ~ 57 %, 24 h and beyond = full.
 */
function pressure(state, since) {
  if (state !== 'waiting_permission' && state !== 'waiting_question') return 0;
  const minutes = Math.max(0, (Date.now() - (since ?? Date.now())) / 60000);
  return Math.min(1, Math.log10(1 + minutes) / Math.log10(1 + 1440));
}

/** The state dot, with the pressure ring around it. */
function stateDot(state, since) {
  const dot = el('span', `dot s-${state}`);
  const p = pressure(state, since);
  if (p) dot.style.setProperty('--pressure', p.toFixed(3));
  dot.title = STATE_LABEL[state] || state;
  return dot;
}

function resetsIn(ts) {
  if (!ts) return '';
  const m = Math.round((ts - Date.now()) / 60000);
  if (m <= 0) return 'resetting';
  if (m < 60) return `resets in ${m}m`;
  return `resets in ${Math.round(m / 60)}h`;
}

// ---------------------------------------------------------------- rendering

const cardNodes = new Map(); // name -> element

/**
 * Each section is isolated: a throw in one must not blank the whole dashboard.
 * A deleted renderGrid once took the entire page down silently, so failures are
 * also surfaced instead of only reaching the console.
 */
/** Rolling render timings, so the 16 ms budget can be checked in the console. */
const renderStats = { count: 0, total: 0, worst: 0, last: 0 };
globalThis.laneboardRenderStats = () => ({
  ...renderStats,
  average: renderStats.count ? renderStats.total / renderStats.count : 0,
});

function renderAll(changedNames) {
  const t0 = performance.now();
  performance.mark('laneboard:render:start');
  const sections = [
    ['lanes', renderLanes],
    ['grid', () => renderGrid(changedNames)],
    ['attention', renderAttention],
    ['vitals', renderVitals],
    ['rate limits', renderRateLimits],
    ['dock', renderDock],
    ['box', renderBox],
    ['rail box', renderRailBox],
    ['topbar', renderTopbar],
  ];
  for (const [name, fn] of sections) {
    try {
      fn();
    } catch (err) {
      reportUiError(`${name}: ${err.message}`, err);
    }
  }
  boxDirty = false;

  performance.mark('laneboard:render:end');
  try { performance.measure('laneboard:render', 'laneboard:render:start', 'laneboard:render:end'); } catch { /* marks cleared */ }
  const ms = performance.now() - t0;
  renderStats.count++;
  renderStats.total += ms;
  renderStats.last = ms;
  if (ms > renderStats.worst) renderStats.worst = ms;
  // The budget is 16 ms; a delta that misses it drops a frame on the 49".
  if (ms > 16) console.warn(`[laneboard] render took ${ms.toFixed(1)}ms (budget 16ms)`);
  reportRenderStats();
}

/**
 * Send the render timings back once a minute.
 * The budget can only be measured in a real browser — a headless harness has a
 * far cheaper DOM and would flatter the number — and asking a human to read
 * numbers out of a console is how measurements get skipped. So the page
 * reports its own, and the handoff can quote something real.
 */
let statsSentAt = 0;
function reportRenderStats() {
  if (renderStats.count < 5) return;
  const now = Date.now();
  if (now - statsSentAt < 60000) return;
  statsSentAt = now;
  const body = {
    count: renderStats.count,
    averageMs: Math.round((renderStats.total / renderStats.count) * 100) / 100,
    worstMs: Math.round(renderStats.worst * 100) / 100,
    lastMs: Math.round(renderStats.last * 100) / 100,
    sessions: store.sessions.size,
    terminals: [...store.pinned].filter((n) => store.sessions.has(n)).length + (store.openSession ? 1 : 0),
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: globalThis.devicePixelRatio || 1,
    ua: navigator.userAgent?.slice(0, 120) || '',
  };
  fetch('/api/client-metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => { /* metrics must never disturb the page */ });
}

const reportedErrors = new Set();

/** Show a UI failure on the page — a silent one cost a whole stage. */
function reportUiError(what, err) {
  console.error('[laneboard]', what, err);
  if (reportedErrors.has(what)) return;
  reportedErrors.add(what);
  const box = $('ui-error');
  if (!box) return;
  box.hidden = false;
  const line = document.createElement('div');
  line.textContent = what;
  box.append(line);
}

function orderedSessions() {
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

/** Set when the box payload changed, so lane heads and the Box re-render. */
let boxDirty = true;
/** lane id -> { node, head, rows, sig } */
const laneNodes = new Map();

const STATE_RANK = { waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 };

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
function orderedUnits() {
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

function renderGrid(changedNames) {
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

/** Same string hash as the server (collector/lanes.mjs hueFor), for a lane with no worktree yet. */
function hueFromId(id) {
  if (!id) return 0;
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function newestMarker(sessions) {
  let best = null;
  for (const s of sessions) if (s.lastMarker && (!best || s.lastMarker.ts > best.ts)) best = s.lastMarker;
  return best;
}

/** draft #12 · ✓ 9/10 — or "no PR". Links to GitHub when there is one. */
function prChip(pr) {
  if (!pr || pr.none) return el('span', 'chip-pr pr-none', 'no PR');
  if (pr.error) {
    const e = el('span', 'chip-pr pr-none', 'PR ?');
    e.title = pr.error;
    return e;
  }
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  const a = el('a', `chip-pr pr-${state} ck-${pr.verdict}`);
  a.href = pr.url || '#';
  a.target = '_blank';
  a.rel = 'noopener';
  const c = pr.checks || {};
  const checks = pr.verdict === 'red' ? `✗ ${c.failed}/${c.total}`
    : pr.verdict === 'pending' ? `◌ ${c.pending}/${c.total}`
      : pr.verdict === 'green' ? `✓ ${c.passed}/${c.total}` : '';
  a.textContent = `${state} #${pr.number}${checks ? ` · ${checks}` : ''}`;
  a.title = c.failedNames?.length ? `failing: ${c.failedNames.join(', ')}` : `${state} PR #${pr.number}`;
  return a;
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

function renderCard(s, { row = false } = {}) {
  const card = el('div', `card s-${s.state}${row ? ' card-row' : ''}${s.danger ? ' danger' : ''}`);
  card.dataset.name = s.name;
  card.dataset.row = row ? '1' : '0';
  if (store.cursor === s.name) card.classList.add('cursor');
  if (store.pinned.has(s.name)) card.classList.add('pinned');

  // The lane stripe: 3 px down the left edge, one stable colour per worktree.
  // Pre-attentive — you see the grouping from across the 49" without reading
  // anything — and it survives the attention sort completely, because it
  // changes no order. A session with no repo gets NO stripe rather than a grey
  // one: absence reads faster than a null colour.
  // Inside a lane card the card's own stripe and chip would repeat its header.
  const lane = row ? null : laneById(s.lane);
  if (lane) {
    card.classList.add('has-lane');
    card.style.setProperty('--lane-hue', String(lane.hue));
  }

  const top = el('div', 'card-top');
  top.append(stateDot(s.state, s.stateSince));
  top.append(el('span', 'card-name', s.name));
  // The chip makes the stripe legible: the stripe says "these three are the
  // same thing", the chip says which thing.
  if (lane) {
    const chip = el('span', 'lane-chip', lane.id);
    chip.style.setProperty('--lane-hue', String(lane.hue));
    chip.title = `${lane.root}${lane.branch ? ` · ${lane.branch}` : ''}` +
      `${lane.sessions.length > 1 ? ` · ${lane.sessions.length} sessions` : ''}`;
    chip.onclick = (e) => { e.stopPropagation(); toggleLane(lane.id); };
    top.append(chip);
  }
  top.append(el('span', `pill s-${s.state}`, STATE_LABEL[s.state] || s.state));
  top.append(el('span', 'card-since', ago(s.stateSince)));
  card.append(top);

  // The guard's finding, above everything else on the card (v3).
  if (s.danger) {
    const dg = el('div', 'marker-line mk-danger');
    dg.append(el('span', 'mk-kind', 'danger'));
    dg.append(el('span', 'mk-text', s.danger.reason));
    card.append(dg);
  }

  const meta = el('div', 'card-meta');
  if (s.dir && !row) meta.append(el('span', 'dir', shortDir(s.dir)));
  if (s.branch && !row) meta.append(el('span', 'branch', `⌥${s.branch}`));
  // In a row the context bar folds into the meta line: one row, one height.
  if (row && s.context?.usedPct != null) {
    const c = el('span', `ctxn${s.context.usedPct >= 85 ? ' hot' : s.context.usedPct >= 65 ? ' warn' : ''}`, `ctx ${s.context.usedPct}%`);
    meta.append(c);
  }
  if (s.dirty) meta.append(el('span', 'dirty', `●${s.dirty}`));
  if (s.ahead) meta.append(el('span', 'ahead', `↑${s.ahead}`));
  if (s.behind) meta.append(el('span', 'ahead', `↓${s.behind}`));
  if (s.claude?.model) meta.append(el('span', 'model', s.claude.model));
  if (s.cost?.usd) {
    const c = el('span', 'cost', money(s.cost.usd));
    c.title = `API-equivalent, all time. Today ${money(s.cost.usdToday)}.` +
      (s.statuslineCostUsd ? ` Claude Code reports ${money(s.statuslineCostUsd)}.` : '');
    meta.append(c);
  }
  // RSS and swap moved here from the Machine view in v3.
  if (s.claude?.rssMb) {
    const mem = el('span', 'mem', `${s.claude.rssMb}MB`);
    mem.title = `resident memory${s.claude.swapMb ? `, ${s.claude.swapMb} MB swapped out` : ''}`;
    meta.append(mem);
    if (s.claude.swapMb) meta.append(el('span', 'dirty', `+${s.claude.swapMb}M swap`));
  }
  if (meta.childNodes.length) card.append(meta);

  if (!row && s.context?.usedPct != null) {
    const ctx = el('div', 'ctx');
    const lab = el('div', 'ctx-label');
    lab.append(el('span', null, 'context'));
    lab.append(el('span', null, `${s.context.usedPct}%${s.context.size ? ` of ${Math.round(s.context.size / 1000)}k` : ''}`));
    const track = el('div', 'gauge-track');
    const fill = el('div', 'gauge-fill');
    fill.style.width = `${s.context.usedPct}%`;
    if (s.context.usedPct >= 85) fill.classList.add('hot');
    else if (s.context.usedPct >= 65) fill.classList.add('warn');
    track.append(fill);
    ctx.append(lab, track);
    card.append(ctx);
  }

  // One line in this slot, never two. A running tool wins it — that is what
  // the session is doing *now*; the marker is what it last shouted, and while
  // a tool is running the marker has almost always been dealt with. When
  // nothing is running the marker takes the slot, so the card costs the same
  // height either way and a NEED-HUMAN is never invisible on an idle card.
  if (s.activity?.tool) {
    const t = el('div', 'tool-line');
    t.append(el('span', 'tname', s.activity.tool));
    if (s.activity.toolInput) t.append(el('span', 'targ', s.activity.toolInput));
    if (s.lastMarker) t.title = `last marker — ${s.lastMarker.kind}: ${s.lastMarker.text}`;
    card.append(t);
  } else if (s.lastMarker) {
    const mk = el('div', `marker-line mk-${s.lastMarker.kind}`);
    mk.append(el('span', 'mk-kind', s.lastMarker.kind));
    mk.append(el('span', 'mk-text', s.lastMarker.text));
    mk.title = `${s.lastMarker.source} · ${new Date(s.lastMarker.ts).toLocaleString('en-GB')}`;
    card.append(mk);
  }

  if (s.activity?.lastUserPrompt && (s.state === 'working' || s.state.startsWith('waiting'))) {
    card.append(el('div', 'say say-user', `“${s.activity.lastUserPrompt}”`));
  }
  if (s.activity?.lastAssistant) {
    card.append(el('div', 'say', s.activity.lastAssistant));
  }

  if (s.previewHtml?.length) {
    const pre = el('div', 'preview');
    // Server-side converter already escapes every text run.
    pre.innerHTML = s.previewHtml.join('\n');
    card.append(pre);
  }

  const actions = el('div', 'card-actions');
  const open = el('button', 'btn', 'open');
  open.onclick = () => openSheet(s.name);
  actions.append(open);

  const pin = el('button', `btn${store.pinned.has(s.name) ? ' on' : ''}`, store.pinned.has(s.name) ? 'pinned' : 'pin');
  pin.onclick = () => togglePin(s.name);
  actions.append(pin);

  if (s.state === 'waiting_permission' || s.state === 'waiting_question') {
    const yes = el('button', 'btn ok', 'Yes');
    yes.onclick = () => sendQuick(s.name, QUICK_KEYS.yes, 'Yes');
    const no = el('button', 'btn primary', 'No');
    no.onclick = () => sendQuick(s.name, QUICK_KEYS.no, 'No');
    actions.append(yes, no);
  }

  const more = el('button', 'btn btn-more', '⋯');
  more.title = 'Send text, restart, kill';
  more.setAttribute('aria-label', 'More actions');
  more.onclick = (e) => { e.stopPropagation(); toggleMenu(card, s); };
  actions.append(more);

  card.append(actions);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    store.cursor = s.name;
    for (const n of cardNodes.values()) n.classList.remove('cursor');
    card.classList.add('cursor');
  });

  return card;
}

/** The ⋯ menu: the actions that are too destructive for a one-tap button. */
function toggleMenu(card, s) {
  const existing = card.querySelector('.menu');
  closeMenus();
  if (existing) return;

  const menu = el('div', 'menu');
  const item = (label, cls, fn) => {
    const b = el('button', cls || null, label);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); fn(); };
    menu.append(b);
  };

  item('Send text…', null, async () => {
    const text = globalThis.prompt(`Send to ${s.name}:`);
    if (text?.trim()) {
      const r = await post(`/api/sessions/${encodeURIComponent(s.name)}/text`, { text: text.trim(), enter: true });
      if (r) toast(`Sent → ${s.name}`);
    }
  });
  item('Open terminal', null, () => openSheet(s.name));
  item(store.pinned.has(s.name) ? 'Unpin' : 'Pin to dock', null, () => togglePin(s.name));
  item('Restart (resume)', null, async () => {
    if (!globalThis.confirm(`Restart ${s.name}? It resumes the same conversation.`)) return;
    const r = await post(`/api/sessions/${encodeURIComponent(s.name)}/restart`);
    if (r) toast(`Restarting ${s.name}…`);
  });
  item('Kill session', 'danger', async () => {
    if (!globalThis.confirm(`Kill ${s.name}? This cannot be undone.`)) return;
    const r = await del(`/api/sessions/${encodeURIComponent(s.name)}`);
    if (r) toast(`Killed ${s.name}`);
  });

  card.append(menu);
}

function closeMenus() {
  for (const m of document.querySelectorAll('.menu')) m.remove();
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
function renderLanes() {
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

function toggleLane(id) {
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
function applyLaneFilter() {
  renderLanes();
  renderGrid([]);
  scheduleVisible();
}

// ---------------------------------------------------------------- launch
//
// The sheet posts to /api/lanes and then shows the job's steps as they land.
// Validation errors (a taken id, no free slot, a plan that is not pushed)
// come back as the server's own sentence.

let launchPoll = null;

function openLaunch() {
  $('launch-sheet').hidden = false;
  $('lf-steps').textContent = '';
  $('lf-submit').disabled = false;
  $('lf-lane').focus();
}

function closeLaunch() {
  $('launch-sheet').hidden = true;
  clearTimeout(launchPoll);
  launchPoll = null;
}

function launchStep(text, cls) {
  const li = el('li', cls || null, text);
  $('lf-steps').append(li);
  return li;
}

async function submitLaunch(e) {
  e?.preventDefault?.();
  const lane = $('lf-lane').value.trim();
  const body = {
    lane,
    repo: $('lf-repo').value.trim() || undefined,
    branch: $('lf-branch').value.trim() || undefined,
    plan: $('lf-plan').value.trim() || `docs/plans/${lane}.md`,
    model: $('lf-model').value,
  };
  $('lf-steps').textContent = '';
  $('lf-submit').disabled = true;
  let res;
  try {
    const r = await fetch('/api/lanes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
  } catch (err) {
    launchStep(`refused: ${err.message}`, 'bad');
    $('lf-submit').disabled = false;
    return;
  }
  launchStep(`${res.lane} on slot ${res.slot} — job ${res.job}`, 'dim');
  followLaunch(res.job, new Set());
}

async function followLaunch(job, seen) {
  let data = null;
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(job)}`);
    if (r.ok) data = await r.json();
  } catch { /* a restart mid-launch: keep polling */ }
  for (const st of data?.steps ?? []) {
    if (seen.has(st.id)) continue;
    seen.add(st.id);
    const why = st.detail?.error || st.detail?.warning || '';
    launchStep(`${st.ok === false ? '✗' : '✓'} ${st.step}${why ? ` — ${why}` : ''}`, st.ok === false ? 'bad' : 'ok');
    if (['done', 'failed', 'interrupted'].includes(st.step)) {
      $('lf-submit').disabled = false;
      return;
    }
  }
  if ($('launch-sheet').hidden) return;
  launchPoll = setTimeout(() => followLaunch(job, seen), 1500);
}

// ---------------------------------------------------------------- morning
//
// The view is fetched rather than derived from the socket: it needs database
// history (cost snapshots, markers over a window) that the live snapshot does
// not carry, and it is read once in the morning rather than watched all day.

const morning = { window: 'tonight', data: null, loading: false, at: 0 };

async function loadMorning(force = false) {
  if (morning.loading) return;
  if (!force && morning.data && Date.now() - morning.at < 20000) return;
  morning.loading = true;
  try {
    const r = await fetch(`/api/morning?window=${encodeURIComponent(morning.window)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    morning.data = await r.json();
    morning.at = Date.now();
  } catch (err) {
    morning.data = { error: err.message };
  } finally {
    morning.loading = false;
    renderMorning();
  }
}

/** A lane stripe for any row that belongs to one. */
function laneStripe(hue) {
  const n = el('span', 'row-stripe');
  if (hue != null) n.style.setProperty('--lane-hue', String(hue));
  else n.classList.add('no-lane');
  return n;
}

function block(title, count) {
  const sec = el('section', 'mblock');
  const h = el('h3', 'rail-h', title);
  if (count != null) h.append(el('span', 'count', String(count)));
  sec.append(h);
  return sec;
}

function renderMorning() {
  const box = $('morning-body');
  if (!box) return;
  for (const btn of $('morning-window').children || []) {
    btn.classList.toggle('on', btn.dataset.window === morning.window);
  }
  box.textContent = '';
  const d = morning.data;
  if (!d) { box.append(el('p', 'empty', 'Loading…')); return; }
  if (d.error) { box.append(el('p', 'empty', `Could not load: ${d.error}`)); return; }
  $('morning-since').textContent = `since ${new Date(d.since).toLocaleString('en-GB', { hour12: false })}`;

  // --- needs you ---------------------------------------------------------
  const needs = block('Needs you', d.needsYou.length);
  if (!d.needsYou.length) needs.append(el('p', 'empty', 'Nothing is waiting.'));
  for (const n of d.needsYou) {
    const row = el('div', `mrow need-${n.kind}`);
    row.append(laneStripe(n.hue));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-kind', n.kind));
    top.append(el('span', 'mrow-name', n.name || '—'));
    if (n.lane) top.append(el('span', 'mrow-lane', n.lane));
    top.append(el('span', 'mrow-age', ago(n.at)));
    main.append(top);
    // Full text, wrapped, never truncated: this is the one place the whole
    // sentence a lane wrote is worth reading.
    if (n.text) main.append(el('div', 'mrow-text', n.text));
    row.append(main);
    const acts = el('div', 'mrow-acts');
    if (n.name && store.sessions.has(n.name)) {
      const open = el('button', 'btn', 'Open');
      open.onclick = () => { setView('board'); openSheet(n.name); };
      acts.append(open);
    }
    if (n.source === 'marker') {
      const dis = el('button', 'btn', 'Dismiss');
      dis.onclick = async () => {
        dis.disabled = true;
        const r = await del(`/api/markers/${n.markerId}`);
        if (r) { toast('Dismissed'); loadMorning(true); } else dis.disabled = false;
      };
      acts.append(dis);
    }
    row.append(acts);
    needs.append(row);
  }
  box.append(needs);

  // --- finished ----------------------------------------------------------
  const fin = block('Finished', d.finished.length);
  if (!d.finished.length) fin.append(el('p', 'empty', 'No lane moved in this window.'));
  for (const f of d.finished) {
    const row = el('div', 'mrow');
    row.append(laneStripe(f.hue));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-name', f.lane));
    if (f.progress?.n != null) top.append(el('span', 'mrow-stage', `${f.progress.n} of ${f.progress.m}`));
    if (f.branch) top.append(el('span', 'mrow-branch', `⌥${f.branch}`));
    if (!f.isMain && f.merged === true) top.append(el('span', 'lane-merged', 'merged'));
    if (!f.isMain && f.merged === false) top.append(el('span', 'lane-unmerged', 'unmerged'));
    if (f.pr) top.append(prChip(f.pr));
    if (f.lastCommitAt) top.append(el('span', 'mrow-age', `commit ${ago(f.lastCommitAt)}`));
    main.append(top);
    const states = f.sessions.map((s) => `${s.name} · ${STATE_LABEL[s.state] || s.state}`).join('   ');
    main.append(el('div', 'mrow-sub', states || 'no session running'));
    for (const m of f.doneMarkers) main.append(el('div', 'mrow-text mrow-done', m.text));
    row.append(main);
    fin.append(row);
  }
  box.append(fin);

  // --- what it cost ------------------------------------------------------
  const cost = block('What it cost', null);
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const [h, cls] of [['lane', ''], ['spend', 'num'], ['tokens', 'num'], ['sessions', '']]) {
    hr.append(el('th', cls, h));
  }
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const l of d.cost.lanes) {
    if (!(l.usd > 0.0005)) continue;
    const tr = el('tr');
    const td = el('td');
    td.append(laneStripe(l.hue));
    td.append(el('span', null, l.lane || '(no lane)'));
    tr.append(td);
    tr.append(el('td', 'num', money(l.usd)));
    tr.append(el('td', 'num', compactCount(l.tokens)));
    tr.append(el('td', 'dim', l.sessions.slice(0, 4).join(', ')));
    tbody.append(tr);
  }
  table.append(tbody);
  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(d.cost.totalUsd)));
  fr.append(el('td', 'num', compactCount(d.cost.totalTokens)));
  fr.append(el('td', 'dim', d.cost.label));
  tfoot.append(fr);
  table.append(tfoot);
  cost.append(table);

  const rl = d.rateLimits;
  if (rl) {
    const g = el('div', 'gauges morning-gauges');
    if (rl.fiveHour) g.append(gauge(`5 h window · ${resetsIn(rl.fiveHour.resetsAt)}`, rl.fiveHour.usedPct));
    if (rl.sevenDay) g.append(gauge(`7 d window · ${resetsIn(rl.sevenDay.resetsAt)}`, rl.sevenDay.usedPct));
    cost.append(g);
  }
  box.append(cost);
}

// ---------------------------------------------------------------- credit

const credit = { data: null, loading: false, at: 0, sort: 'allTime', desc: true };

async function loadCredit(force = false) {
  if (credit.loading) return;
  if (!force && credit.data && Date.now() - credit.at < 20000) return;
  credit.loading = true;
  try {
    const r = await fetch('/api/credit');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    credit.data = await r.json();
    credit.at = Date.now();
  } catch (err) {
    credit.data = { error: err.message };
  } finally {
    credit.loading = false;
    renderCredit();
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
}

/**
 * A usage chart, hand-written (hard rule 3: no chart library).
 *
 * Percent is a fixed 0-100 scale, so the y axis needs no domain calculation and
 * two charts can be compared by eye. Bands at 80 % and 95 % are drawn behind
 * the line: the number that matters is not "how much" but "how close to the
 * wall", and a band says that without a legend.
 */
function usageChart(chart, { width = 720, height = 150 } = {}) {
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const root = svg('svg', {
    class: 'chart', viewBox: `0 0 ${width} ${height}`,
    width, height, role: 'img', 'aria-label': chart.title,
  });
  const span = Math.max(1, chart.now - chart.since);
  const x = (t) => pad.l + ((t - chart.since) / span) * w;
  const y = (v) => pad.t + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  // Threshold bands first, so the line sits on top of them.
  root.append(svg('rect', { class: 'band band-warn', x: pad.l, y: y(95), width: w, height: y(80) - y(95) }));
  root.append(svg('rect', { class: 'band band-crit', x: pad.l, y: y(100), width: w, height: y(95) - y(100) }));

  // A 4px grid would be noise at this size; label the axis instead.
  for (const v of [0, 50, 100]) {
    root.append(svg('line', { class: 'axis', x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v) }));
    const t = svg('text', { class: 'axis-label', x: pad.l - 6, y: y(v) + 3, 'text-anchor': 'end' });
    t.textContent = `${v}`;
    root.append(t);
  }

  for (const at of chart.resets) {
    root.append(svg('line', { class: 'reset-tick', x1: x(at), x2: x(at), y1: pad.t, y2: pad.t + h }));
  }

  if (!chart.points.length) {
    const t = svg('text', { class: 'axis-label', x: pad.l + w / 2, y: pad.t + h / 2, 'text-anchor': 'middle' });
    t.textContent = 'no samples yet';
    root.append(t);
    return root;
  }

  const d = chart.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  root.append(svg('polyline', { class: 'series', points: d }));

  // One <title> per point group so hovering says what and when, with no
  // tooltip machinery and no library.
  for (const p of chart.points) {
    const g = svg('g');
    const c = svg('circle', { class: 'point', cx: x(p.t).toFixed(1), cy: y(p.v).toFixed(1), r: 6 });
    const title = svg('title');
    title.textContent = `${Math.round(p.v)}% · ${new Date(p.t).toLocaleString('en-GB', { hour12: false })}`;
    g.append(c, title);
    root.append(g);
  }
  return root;
}

function chartBlock(chart, current) {
  const sec = el('section', 'mblock');
  const head = el('div', 'chart-head');
  const h = el('h3', 'rail-h', chart.title);
  head.append(h);
  if (current) {
    const now = el('span', 'chart-now', `${Math.round(current.usedPct)}%`);
    if (current.usedPct >= 95) now.classList.add('hot');
    else if (current.usedPct >= 80) now.classList.add('warn');
    head.append(now);
    head.append(el('span', 'chart-reset', resetsIn(current.resetsAt)));
  }
  head.append(el('span', 'chart-range',
    `${new Date(chart.since).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} → now`));
  sec.append(head);
  const scroller = el('div', 'chart-scroll');
  scroller.append(usageChart(chart));
  sec.append(scroller);
  return sec;
}

const CREDIT_COLUMNS = [
  { key: 'lane', label: 'lane' },
  { key: 'tonight', label: 'tonight', num: true },
  { key: 'day', label: '24 h', num: true },
  { key: 'week', label: '7 d', num: true },
  { key: 'allTime', label: 'all time', num: true },
  { key: 'input', label: 'in', num: true, tok: true },
  { key: 'output', label: 'out', num: true, tok: true },
  { key: 'cacheRead', label: 'cache rd', num: true, tok: true },
  { key: 'cacheWrite', label: 'cache wr', num: true, tok: true },
];

function creditValue(row, col) {
  if (col.key === 'lane') return row.lane ?? '';
  if (col.tok) return row.tokens?.[col.key] ?? 0;
  return row[col.key] ?? 0;
}

function renderCredit() {
  const box = $('credit-body');
  if (!box) return;
  box.textContent = '';
  const d = credit.data;
  if (!d) { box.append(el('p', 'empty', 'Loading…')); return; }
  if (d.error) { box.append(el('p', 'empty', `Could not load: ${d.error}`)); return; }

  const s = d.sampler || {};
  $('credit-sampler').textContent = s.lastSampleAt
    ? `${s.rows} samples · last ${ago(s.lastSampleAt)} ago`
    : 'sampler has written nothing yet';

  box.append(chartBlock(d.charts.sevenDay, d.rateLimits?.sevenDay));
  box.append(chartBlock(d.charts.fiveHour, d.rateLimits?.fiveHour));

  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Cost per lane'));
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const col of CREDIT_COLUMNS) {
    const th = el('th', `${col.num ? 'num' : ''}${credit.sort === col.key ? ' sorted' : ''}`.trim() || null, col.label);
    th.onclick = () => {
      if (credit.sort === col.key) credit.desc = !credit.desc;
      else { credit.sort = col.key; credit.desc = true; }
      renderCredit();
    };
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);

  const col = CREDIT_COLUMNS.find((c) => c.key === credit.sort) ?? CREDIT_COLUMNS[4];
  const rows = [...d.lanes].sort((a, b) => {
    const av = creditValue(a, col);
    const bv = creditValue(b, col);
    const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv;
    return credit.desc ? -cmp : cmp;
  });

  const tbody = el('tbody');
  for (const row of rows) {
    if (!row.allTime && !row.tonight && !row.week) continue;
    const tr = el('tr');
    const td = el('td');
    td.append(laneStripe(row.hue));
    td.append(el('span', null, row.lane || '(no lane)'));
    tr.append(td);
    tr.append(el('td', 'num', money(row.tonight)));
    tr.append(el('td', 'num', money(row.day)));
    tr.append(el('td', 'num', money(row.week)));
    // null means "the session is gone, so there is nothing to total".
    tr.append(el('td', 'num', row.allTime == null ? '—' : money(row.allTime)));
    tr.append(el('td', 'num', compactCount(row.tokens.input)));
    tr.append(el('td', 'num', compactCount(row.tokens.output)));
    tr.append(el('td', 'num', compactCount(row.tokens.cacheRead)));
    tr.append(el('td', 'num', compactCount(row.tokens.cacheWrite)));
    tbody.append(tr);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(d.totals.tonight)));
  fr.append(el('td', 'num', money(d.totals.day)));
  fr.append(el('td', 'num', money(d.totals.week)));
  fr.append(el('td', 'num', money(d.totals.allTime)));
  const note = el('td', 'dim', d.label);
  note.setAttribute('colspan', '4');
  fr.append(note);
  tfoot.append(fr);
  table.append(tfoot);
  sec.append(table);
  box.append(sec);
}

// ---------------------------------------------------------------- box
//
// What this box is carrying. v3 Stage 1 is the shell: the vitals, drawn from
// the snapshot the board already has. The dev stack, CI queue and slots join
// it in later stages. It never acts.

function vitalTile(k, v, sub) {
  const d = el('div', 'vital');
  d.append(el('div', 'k', k));
  const vv = el('div', 'v', v);
  if (sub) vv.append(el('small', null, ` ${sub}`));
  d.append(vv);
  return d;
}

function renderBox() {
  const box = $('box-body');
  if (!box || store.view !== 'box') return;
  box.textContent = '';
  const v = store.vitals;
  if (!v) { box.append(el('p', 'empty', 'Waiting for the first snapshot…')); return; }

  const vit = el('section', 'mblock');
  vit.append(el('h3', 'rail-h', 'This box'));
  const grid = el('div', 'vitals vitals-wide');
  grid.append(vitalTile('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, v.load ? `load ${v.load[0].toFixed(2)}` : ''));
  if (v.mem) grid.append(vitalTile('mem', `${(v.mem.usedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`));
  if (v.mem) grid.append(vitalTile('swap', `${(v.mem.swapUsedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`));
  if (v.disk) grid.append(vitalTile('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free'));
  if (v.gpu) grid.append(vitalTile('gpu', `${v.gpu.utilPct}%`, `${(v.gpu.memUsedMb / 1024).toFixed(1)}G`));
  grid.append(vitalTile('claude', `${(v.claudeRssMb / 1024).toFixed(1)}G`, `${v.sessionCount} sessions`));
  grid.append(vitalTile('laneboard', `${v.laneboardRssMb}MB`, ''));
  vit.append(grid);
  box.append(vit);
  for (const b of boxBlocks()) box.append(b);
}

/** The guard, the CI queue and the slots: Box sections, and rail blocks on the 49". */
function boxBlocks() {
  const b = store.box;
  if (!b) return [el('p', 'empty', 'Waiting for the collectors…')];
  const blocks = [guardBlock(b.guard), ciBlock(b.ci), slotsBlock(b.slots)].filter(Boolean);
  // With every provider off there is nothing to say here, and saying nothing
  // is better than three empty headings.
  return blocks.length ? blocks : [el('p', 'empty', 'No guard, no agent slots and no CI configured — see docs/config.md.')];
}

function guardBlock(g) {
  // No guard provider: no block at all, rather than an empty one that implies
  // something is being watched.
  if (!g || g.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const h = el('h3', 'rail-h', 'Guard');
  h.append(el('span', `guard ${g.ok ? 'guard-ok' : 'guard-danger'}`, g.ok ? 'guard ok' : 'DANGER'));
  sec.append(h);
  const probes = g.health ?? [];
  // The guard's findings first: this block exists for them.
  for (const f of [...(g.preventive ?? []), ...(g.detective ?? [])]) {
    const line = el('div', 'marker-line mk-danger');
    line.append(el('span', 'mk-kind', 'danger'));
    line.append(el('span', 'mk-text', `${f.session || `pid ${f.pid}`}: ${f.reason}`));
    sec.append(line);
  }
  const rows = el('div', 'kv');
  const health = (label, x) => {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', label));
    r.append(el('span', `kv-v ${x?.ok ? 'ok' : 'bad'}`, x?.ok ? `${x.status}` : (x?.status ? `${x.status}` : 'down')));
    rows.append(r);
  };
  for (const p of probes) health(p.name, p);
  for (const c of g.containers ?? []) {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', c.name.replace(/-1$/, '')));
    r.append(el('span', `kv-v ${c.state === 'running' ? '' : 'dim'}`, c.status));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}

function ciBlock(ci) {
  if (!ci || ci.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const q = ci?.queue;
  const h = el('h3', 'rail-h', 'CI queue');
  if (q) h.append(el('span', 'count', `${q.running} running · ${q.queued} queued`));
  sec.append(h);
  if (ci?.auth && ci.auth.ok === false) sec.append(el('p', 'empty', 'gh not logged in on this host — run `gh auth login`.'));
  if (!q) { if (ci?.auth?.ok !== false) sec.append(el('p', 'empty', 'Not checked yet.')); return sec; }
  const rows = el('div', 'kv');
  for (const r of q.runs.slice(0, 8)) {
    const row = el('div', 'kv-row');
    const verdict = r.status !== 'completed' ? r.status.replace('_', ' ') : (r.conclusion || 'done');
    row.append(el('span', 'kv-k', r.name));
    row.append(el('span', 'kv-b', r.branch || ''));
    row.append(el('span', `kv-v ${r.conclusion === 'success' ? 'ok' : r.conclusion === 'failure' ? 'bad' : r.status !== 'completed' ? 'run' : 'dim'}`, verdict));
    rows.append(row);
  }
  sec.append(rows);
  return sec;
}

function slotsBlock(slots) {
  // No slot provider: no slots, and no empty block implying there are some.
  if (!slots?.length) return null;
  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Agent slots'));
  const rows = el('div', 'kv');
  for (const x of slots ?? []) {
    if (!x.exists && !x.laneSlot) continue;
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', `slot ${x.slot} :${x.ports.pg}`));
    r.append(el('span', `kv-v ${x.orphan ? 'warn' : x.up ? 'ok' : 'dim'}`, x.owner || (x.up ? 'up' : 'free')));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}

/** On the 49" the Box is rail blocks, not a tab (the CSS hides the tab there). */
function renderRailBox() {
  const host = $('rail-box');
  if (!host) return;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 2000px)').matches;
  host.hidden = !wide;
  if (!wide || !boxDirty) return;
  host.textContent = '';
  for (const b of boxBlocks()) host.append(b);
}

function renderAttention() {
  const list = $('attention-list');
  const strip = $('attention-strip');
  list.textContent = '';
  strip.textContent = '';
  const items = store.attention.slice(0, 12);
  $('attention-count').textContent = String(store.attention.length);
  $('attention-empty').hidden = items.length > 0;

  items.forEach((a, i) => {
    const li = document.createElement('li');
    const b = el('button', `attention-item s-${a.danger ? 'danger' : a.state}`);
    if (a.danger) b.title = a.danger;
    b.append(el('span', 'idx', String(i + 1)));
    b.append(stateDot(a.state, a.since));
    b.append(el('span', 'nm', a.name));
    b.append(el('span', 'ago', ago(a.since)));
    b.onclick = () => focusSession(a.name);
    li.append(b);
    list.append(li);

    const chip = el('button', `chip s-${a.danger ? 'danger' : a.state}`);
    chip.append(stateDot(a.state, a.since));
    chip.append(el('span', 'nm', a.name));
    chip.append(el('span', 'ago', ago(a.since)));
    chip.onclick = () => focusSession(a.name);
    strip.append(chip);
  });
}

function renderVitals() {
  const v = store.vitals;
  const box = $('vitals');
  box.textContent = '';
  if (!v) return;
  const add = (k, val, sub) => {
    const d = el('div', 'vital');
    d.append(el('div', 'k', k));
    const vv = el('div', 'v', val);
    if (sub) { const s = el('small', null, ` ${sub}`); vv.append(s); }
    d.append(vv);
    box.append(d);
  };
  add('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, v.load ? `load ${v.load[0].toFixed(2)}` : '');
  if (v.mem) add('mem', `${(v.mem.usedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`);
  if (v.mem) add('swap', `${(v.mem.swapUsedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`);
  if (v.disk) add('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free');
  add('claude', `${(v.claudeRssMb / 1024).toFixed(1)}G`, `${v.sessionCount} sessions`);
  if (v.gpu) add('gpu', `${v.gpu.utilPct}%`, `${(v.gpu.memUsedMb / 1024).toFixed(1)}G`);
  add('laneboard', `${v.laneboardRssMb}MB`, '');
}

/** Rate limits come from whichever session's statusline fired most recently. */
function freshestRateLimits() {
  let best = null;
  for (const s of store.sessions.values()) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best?.rateLimits ?? null;
}

function renderRateLimits() {
  const box = $('rate-limits');
  const top = $('topbar-gauges');
  box.textContent = '';
  top.textContent = '';
  const rl = freshestRateLimits();
  if (!rl) { box.append(el('p', 'empty', 'No statusline data yet.')); return; }
  for (const [key, label] of [['fiveHour', '5 h window'], ['sevenDay', '7 d window']]) {
    const g = rl[key];
    if (!g) continue;
    const short = key === 'fiveHour' ? '5h' : '7d';
    box.append(gauge(`${label} · ${resetsIn(g.resetsAt)}`, g.usedPct));
    // Both forms are always in the DOM; CSS picks one per breakpoint.
    top.append(gauge(short, g.usedPct, resetsIn(g.resetsAt)));
    top.append(compactGauge(short, g.usedPct, resetsIn(g.resetsAt)));
  }
}

function renderTopbar() {
  let today = 0;
  let all = 0;
  for (const s of store.sessions.values()) {
    today += s.cost?.usdToday || 0;
    all += s.cost?.usd || 0;
  }
  const n = $('stat-cost');
  n.textContent = '';
  n.append(el('b', null, money(today)));
  n.append(document.createTextNode(' today'));
  n.title = `API-equivalent. All time across live sessions: ${money(all)}. On a subscription the rate-limit gauges are the real constraint.`;
}

// ---------------------------------------------------------------- dock, sheet, actions

function renderDock() {
  const body = $('dock-body');
  const names = [...store.pinned].filter((n) => store.sessions.has(n)).slice(0, 4);
  $('dock-count').textContent = String(names.length);
  // One or two pins get the dock's full width — a 2x2 grid would waste half of
  // it and leave the terminal too narrow. Three or four fall back to 2x2.
  const autoStacked = names.length <= 2;
  body.classList.toggle('stacked', store.dockLayout === null ? autoStacked : store.dockLayout);
  $('dock-layout').title = store.dockLayout === null
    ? `Layout: auto (${autoStacked ? 'stacked' : '2x2'}) — click to override`
    : `Layout: ${store.dockLayout ? 'stacked' : '2x2'} — click to cycle`;

  const existing = new Set();
  for (const pane of body.querySelectorAll('.term-pane')) {
    if (names.includes(pane.dataset.name)) existing.add(pane.dataset.name);
    else { closeTerminal(pane.dataset.name); pane.remove(); }
  }
  const emptyMsg = body.querySelector('.empty');
  if (names.length && emptyMsg) emptyMsg.remove();
  if (!names.length && !emptyMsg) {
    body.append(el('p', 'empty', 'Pin a session to watch it live here.'));
    return;
  }
  for (const name of names) {
    if (existing.has(name)) continue;
    const pane = el('div', 'term-pane');
    pane.dataset.name = name;
    const head = el('div', 'term-head');
    head.append(el('span', 'nm', name));
    const un = el('button', 'icon-btn', '✕');
    un.title = 'Unpin';
    un.onclick = () => togglePin(name);
    head.append(un);
    const host = el('div', 'term-host');
    pane.append(head, host);
    body.append(pane);
    openTerminal(name, host);
  }
}

function togglePin(name) {
  if (store.pinned.has(name)) store.pinned.delete(name);
  else store.pinned.add(name);
  savePinned();
  renderGrid([name]);
  renderDock();
  scheduleVisible();
}

function focusSession(name) {
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

function openSheet(name) {
  const s = store.sessions.get(name);
  if (!s) return;
  store.openSession = name;
  $('sheet-title').textContent = name;
  const pill = $('sheet-state');
  pill.className = `pill s-${s.state}`;
  pill.textContent = STATE_LABEL[s.state] || s.state;
  $('sheet').hidden = false;
  location.hash = `session=${encodeURIComponent(name)}`;
  openTerminal(name, $('sheet-body'));
  scheduleVisible();
}

function closeSheet() {
  if (!store.openSession) return;
  closeTerminal(store.openSession, $('sheet-body'));
  store.openSession = null;
  $('sheet').hidden = true;
  // Back to the view's own hash, not to a bare path: closing a sheet opened
  // from a push notification should leave you on the Board, not nowhere.
  if (location.hash.startsWith('#session=')) history.replaceState(null, '', `#${store.view}`);
  scheduleVisible();
}

async function post(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (r.status === 404) throw new Error('endpoint not wired yet');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    toast(`Failed: ${err.message}`);
    return null;
  }
}

async function del(url) {
  try {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    toast(`Failed: ${err.message}`);
    return null;
  }
}

function sendKeys(name, keys) {
  post(`/api/sessions/${encodeURIComponent(name)}/keys`, { keys });
  toast(`Sent ${keys.join(' ')} → ${name}`);
}

function sendText(name, text) {
  post(`/api/sessions/${encodeURIComponent(name)}/text`, { text, enter: true });
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- input

$('sheet-close').onclick = closeSheet;
// auto -> stacked -> 2x2 -> auto
$('dock-layout').onclick = () => {
  store.dockLayout = store.dockLayout === null ? true : store.dockLayout ? false : null;
  renderDock();
  fitAll();
};
$('btn-refresh').onclick = () => { try { ws?.close(); } catch { /* reconnect handles it */ } };

// Claude's prompts are numbered menus, so "Yes" is 1 then Enter.
const QUICK_KEYS = {
  yes: { raw: '1\r', keys: ['1', 'Enter'] },
  no: { raw: '\x1b', keys: ['Escape'] },
  esc: { raw: '\x1b', keys: ['Escape'] },
  enter: { raw: '\r', keys: ['Enter'] },
  'ctrl-c': { raw: '\x03', keys: ['C-c'] },
};

/** Prefer the open pty — it is instant. Fall back to tmux send-keys. */
function sendQuick(name, spec, label) {
  if (isLive(name) && writeTo(name, spec.raw)) toast(`${label} → ${name}`);
  else sendKeys(name, spec.keys);
}

$('quickbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-key]');
  if (!btn || !store.openSession) return;
  const spec = QUICK_KEYS[btn.dataset.key];
  if (spec) sendQuick(store.openSession, spec, btn.textContent);
});

$('qb-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('qb-input');
  const text = input.value.trim();
  if (!text || !store.openSession) return;
  const name = store.openSession;
  if (isLive(name) && writeTo(name, `${text}\r`)) toast(`Sent → ${name}`);
  else sendText(name, text);
  input.value = '';
});

/**
 * True when the keystroke belongs to a terminal or a text field.
 * Claude Code uses Esc to interrupt, so while an xterm has focus EVERY key —
 * Escape included — must reach the session and none of the dashboard
 * shortcuts may fire. The sheet is closed with the X button (or Escape while
 * focus is outside the terminal).
 */
function keyBelongsToTerminal(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('.xterm, .term-host, .sheet-body, .xterm-helper-textarea'));
}

/**
 * `g` starts a two-key view chord (g b / g m / g c / g k / g f). It expires
 * after a second so a stray g does not swallow the next real keystroke — and
 * `g k` has to win over the Board's `k`, which is why the chord is checked
 * before anything else.
 */
let pendingG = 0;

addEventListener('keydown', (e) => {
  if (keyBelongsToTerminal(e.target)) return;
  if (e.target.matches('input, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (pendingG && Date.now() - pendingG < 1000) {
    pendingG = 0;
    const view = VIEW_KEYS[e.key];
    if (view) { setView(view); e.preventDefault(); return; }
  }
  pendingG = 0;
  if (e.key === 'g') { pendingG = Date.now(); e.preventDefault(); return; }

  if (e.key === 'Escape') { closeMenus(); closeSheet(); return; }
  // Everything below moves a cursor through cards, so it only means anything
  // on the Board.
  if (store.view !== 'board') return;
  if (e.key >= '1' && e.key <= '9') {
    const a = store.attention[Number(e.key) - 1];
    if (a) { focusSession(a.name); e.preventDefault(); }
    return;
  }
  const list = orderedSessions().map((s) => s.name);
  if (!list.length) return;
  const i = list.indexOf(store.cursor);
  if (e.key === 'j') { store.cursor = list[Math.min(list.length - 1, i + 1)] ?? list[0]; e.preventDefault(); }
  else if (e.key === 'k') { store.cursor = list[Math.max(0, i - 1)] ?? list[0]; e.preventDefault(); }
  else if (e.key === 'Enter' && store.cursor) { openSheet(store.cursor); e.preventDefault(); return; }
  else if (e.key === 'p' && store.cursor) { togglePin(store.cursor); e.preventDefault(); return; }
  else return;

  for (const [n, node] of cardNodes) node.classList.toggle('cursor', n === store.cursor);
  cardNodes.get(store.cursor)?.scrollIntoView({ block: 'nearest' });
});

addEventListener('click', (e) => { if (!e.target.closest?.('.menu, .btn-more')) closeMenus(); });

/**
 * One route parser for the load path and for hashchange.
 * `#session=<name>` is the push notification's deep link: it must always land
 * on the Board with the sheet open, whatever view was last shown.
 */
function applyHash() {
  const m = /^#session=(.+)$/.exec(location.hash);
  if (m) {
    setView('board', { pushHash: false });
    openSheet(decodeURIComponent(m[1]));
    return;
  }
  const view = location.hash.replace(/^#/, '');
  setView(VIEWS.includes(view) ? view : 'board', { pushHash: false });
}

addEventListener('hashchange', applyHash);

$('btn-launch')?.addEventListener('click', openLaunch);
$('lf-close')?.addEventListener('click', closeLaunch);
$('launch-form')?.addEventListener('submit', submitLaunch);

$('morning-window')?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-window]');
  if (!btn) return;
  morning.window = btn.dataset.window;
  loadMorning(true);
});

for (const nav of ['views', 'tabs']) {
  $(nav)?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-view]');
    if (btn) setView(btn.dataset.view);
  });
}

// Refresh the relative "since" labels without waiting for a delta.
setInterval(() => {
  for (const [name, node] of cardNodes) {
    const s = store.sessions.get(name);
    const since = node.querySelector('.card-since');
    if (s && since) since.textContent = ago(s.stateSince);
  }
  renderAttention();
}, 10000);

// A ReferenceError anywhere used to leave the page blank with nothing on
// screen to say why.
addEventListener('error', (e) => reportUiError(e.message || 'script error', e.error));
addEventListener('unhandledrejection', (e) => reportUiError(`unhandled: ${e.reason?.message || e.reason}`, e.reason));

connect();
if (location.hash.startsWith('#session=')) {
  // The session may not be in the store yet on a cold load.
  addEventListener('load', applyHash);
  setView('board', { pushHash: false });
} else {
  applyHash();
}

// ---------------------------------------------------------------- push / PWA

/** VAPID keys arrive base64url; the subscribe API wants a Uint8Array. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const pushBtn = $('btn-push');
const pushNote = $('push-note');

function setPushNote(text) {
  pushNote.textContent = text;
  pushNote.hidden = !text;
}

async function refreshPushUi() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    pushBtn.disabled = true;
    setPushNote('This browser has no Web Push support.');
    return;
  }
  if (!isSecureContext) {
    // iOS only offers the prompt to an installed PWA over HTTPS.
    pushBtn.disabled = true;
    setPushNote(
      'Needs HTTPS. Open the laneboard through its tailscale serve address ' +
      '(port 8443, see deploy/tailscale.md) and add it to the Home Screen.'
    );
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    pushBtn.textContent = 'Notifications on — send a test';
    pushBtn.classList.add('on');
    setPushNote('Permission prompts and questions notify immediately; finished work only after 5 min of running.');
  } else {
    pushBtn.textContent = 'Enable notifications';
    pushBtn.classList.remove('on');
    setPushNote(Notification.permission === 'denied' ? 'Blocked in the browser settings.' : '');
  }
}

pushBtn.addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await post('/api/push/test');
      toast('Test notification sent');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setPushNote('Permission was not granted.'); return; }
    const { publicKey } = await (await fetch('/api/push/key')).json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await post('/api/push/subscribe', sub.toJSON());
    toast('Notifications enabled');
    refreshPushUi();
  } catch (err) {
    setPushNote(`Could not enable: ${err.message}`);
  }
});

if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* reported by the button */ });
}
refreshPushUi();
