// Network (#/network, `g n`): the machines as "the wire" (docs/network.md).
// The tailnet is one wire; every machine hangs on it with one tap. Boxes in
// boxes say what lives where: a host, the foreman in it, its rooms, and in each
// room the run with its loop spot. An event is a packet on the wire; nothing
// moves unless something happened.
//
// Read-only. One read: GET /api/engines/runs (the Runs view's own, with each
// engine's health). Nothing here is invented: what foundry does not send is
// "not reported yet".
//
// Engine text goes in through textContent and setAttribute only.
import { el, svg } from '../core/dom.js';
import { money } from '../core/format.js';
import { rnClean } from '../core/run-text.js';
import { engineStateOf, isBlocked, loadEngineRuns, loopGlyph, rowName } from './runs-engine.js';

const POLL_MS = 5_000;
const DAY_MS = 86_400_000;
const LIVE = new Set(['running', 'at-gate', 'waiting-approval', 'paused', 'queued']);
const UP_ROOM = new Set(['up', 'creating']);
const runHref = (key) => `#/runs?run=${encodeURIComponent(key)}`;
export const hostHref = (id) => `#/network?sel=${encodeURIComponent(`node:${id}`)}`;

function age(ms) {
  if (typeof ms !== 'number') return null;
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`;
}

/**
 * The picture as data. Pure: `engines` and `rows` as loadEngineRuns gives them.
 * -> {you: {needs, questions}, hosts: [{id, role, state, updatedAt, reporting,
 * foreman, live: [slot], ended: [run], strip: [{from, to, live}]}], foremen}
 */
export function networkModel(engines = [], rows = [], now = Date.now()) {
  const hosts = new Map();
  const host = (id) => {
    if (!hosts.has(id)) hosts.set(id, { id, role: null, state: null, updatedAt: null, reporting: false, foreman: null, live: [], ended: [], strip: [] });
    return hosts.get(id);
  };
  let questions = 0;
  for (const e of Array.isArray(engines) ? engines : []) {
    if (typeof e?.questions === 'number') questions += e.questions;
    const h = e?.health;
    if (!h) continue;
    for (const x of Array.isArray(h.hosts) ? h.hosts : []) {
      if (typeof x?.id !== 'string') continue;
      Object.assign(host(x.id), { role: x.role ?? null, state: x.state ?? null, updatedAt: x.updatedAt ?? null, reporting: true });
    }
    // Which host the foreman runs on: foundry's own word when it sends one, else the steady host (a guess, said so).
    const named = typeof h.host === 'string' ? h.host : null;
    const list = Array.isArray(h.hosts) ? h.hosts : [];
    const at = named ?? list.find((x) => x?.role === 'steady')?.id ?? list[0]?.id ?? null;
    if (at) {
      host(at).foreman = { engine: e.id, state: h.foreman ?? 'unknown', beatAge: h.beatAge ?? null, queue: h.queue ?? null,
        active: h.active ?? null, guessed: !named };
    }
  }
  const list = Array.isArray(rows) ? rows.filter((r) => r?.engineRow) : [];
  for (const r of list) {
    const state = r.engineState ?? r.state;
    const live = LIVE.has(state);
    for (const room of Array.isArray(r.rooms) ? r.rooms : []) {
      if (typeof room?.host !== 'string') continue;
      const h = host(room.host);
      const from = r.startedAt;
      const to = live ? now : (r.endedAt ?? r.updatedAt ?? now);
      if (typeof from === 'number' && to > now - DAY_MS) h.strip.push({ from: Math.max(from, now - DAY_MS), to, live: live && UP_ROOM.has(room.state) });
      // A live run keeps its slot even when its room ended (a blocked run's room ends): it still waits there.
      if (live && (UP_ROOM.has(room.state) || !r.rooms.some((x) => UP_ROOM.has(x?.state)))) {
        h.live.push({ key: r.run ?? r.key, name: rowName(r), goalTitle: r.goalTitle ?? null, room: room.name ?? null, roomState: room.state,
          purpose: room.purpose ?? null, state, row: r, blocked: isBlocked({ ...r, state }), usd: r.usage?.usd ?? null, lastSeq: r.lastSeq ?? null });
      } else if (!live && typeof r.endedAt === 'number' && r.endedAt > now - DAY_MS) {
        h.ended.push({ key: r.run ?? r.key, name: rowName(r), stop: r.stop ?? null, endedAt: r.endedAt });
      }
    }
  }
  const needs = list.filter((r) => {
    const state = r.engineState ?? r.state;
    return state === 'at-gate' || state === 'waiting-approval' || r.waiting?.length > 0;
  }).length;
  // Reporting hosts first (the foreman's first), then the ones known only from runs.
  const ordered = [...hosts.values()].sort((a, b) => (b.reporting - a.reporting) || (Boolean(b.foreman) - Boolean(a.foreman)) || a.id.localeCompare(b.id));
  return { you: { needs, questions }, hosts: ordered };
}

// ---------------------------------------------------------------- drawing

function slotNode(s) {
  const a = el('a', 'nw-slot');
  a.href = runHref(s.key);
  a.dataset.run = rnClean(s.key, 120) ?? '';
  const st = engineStateOf({ ...s.row, engineState: s.state, state: s.state });
  a.dataset.p = st.p;
  const top = el('div', 'nw-slot-top');
  top.append(el('b', null, rnClean(s.room, 48) ?? 'room'), el('span', null, `${rnClean(s.purpose, 16) ?? 'run'} room · ${rnClean(s.roomState, 12) ?? '?'}`));
  if (typeof s.usd === 'number') top.append(el('span', 'nw-r', money(s.usd)));
  a.append(top, el('div', 'nw-slot-run', `${rnClean(s.name, 120)} →`));
  if (s.goalTitle) a.append(el('div', 'nw-slot-goal', rnClean(s.goalTitle, 200)));
  if (s.row.loop) a.append(loopGlyph(s.row.loop));
  const word = s.blocked ? `■ blocked${s.row.loop?.label ? ` at ${rnClean(s.row.loop.label, 24)}` : ''}${s.row.loop?.node ? ` · ${rnClean(s.row.loop.node, 48)}` : ''}`
    : s.state === 'at-gate' || s.state === 'waiting-approval' || s.row.waiting?.length ? '▲ waits for you' : st.word;
  a.append(el('div', 'nw-slot-st', word));
  return a;
}

function stripNode(h, now) {
  const box = el('div', 'nw-day');
  const trk = el('div', 'nw-trk');
  for (const b of h.strip) {
    const i = el('i', b.live ? 'nw-bar nw-bar--live' : 'nw-bar');
    i.style.left = `${(((b.from - (now - DAY_MS)) / DAY_MS) * 100).toFixed(2)}%`;
    i.style.width = `${Math.max(0.5, ((b.to - b.from) / DAY_MS) * 100).toFixed(2)}%`;
    trk.append(i);
  }
  const cap = el('div', 'nw-cap');
  cap.append(el('span', null, 'rooms up, 24 h'), el('span', null, 'now'));
  box.append(trk, cap);
  return box;
}

function hostNode(h, now, selected) {
  const sec = el('section', `nw-host${h.reporting ? '' : ' nw-host--dash'}`);
  sec.dataset.host = rnClean(h.id, 48) ?? '';
  sec.setAttribute('aria-label', `Host ${rnClean(h.id, 48)}`);
  if (selected) sec.setAttribute('aria-current', 'true');
  const hd = el('div', 'nw-hd');
  hd.append(el('span', 'nw-nm', rnClean(h.id, 48) ?? '?'));
  if (h.role) hd.append(el('span', 'nw-plate', rnClean(h.role, 16)));
  hd.append(el('span', `nw-st nw-st--${h.reporting ? rnClean(h.state, 12) ?? 'unknown' : 'off'}`, h.reporting ? `● ${rnClean(h.state, 12) ?? '?'}` : '○ not reporting'));
  const right = el('span', 'nw-r');
  if (h.reporting) {
    right.append(el('span', null, `host · updated ${age(now - h.updatedAt) ?? '?'} · load `));
    const ny = el('span', 'dr-notyet', 'not reported yet');
    ny.title = 'foundry does not send host load yet';
    right.append(ny);
  } else right.append(el('span', null, 'known from its runs only'));
  hd.append(right);
  sec.append(hd);
  const body = el('div', 'nw-body');
  if (h.foreman) {
    const f = el('div', 'nw-foreman');
    f.dataset.foreman = rnClean(h.foreman.state, 12) ?? 'unknown';
    f.append(el('span', 'nw-ttl', `Foreman · ${rnClean(h.foreman.state, 12) ?? 'unknown'}`));
    const d = [h.foreman.beatAge === null ? null : `beat ${age(h.foreman.beatAge)}`, typeof h.foreman.queue === 'number' ? `queue ${h.foreman.queue}` : null,
      typeof h.foreman.active === 'number' ? `${h.foreman.active} ${h.foreman.active === 1 ? 'run' : 'runs'} on` : null].filter(Boolean).join(' · ');
    f.append(el('span', 'nw-d', d));
    if (h.foreman.guessed) {
      const g = el('span', 'nw-guess', 'here by its steady role');
      g.title = 'foundry does not say which host the foreman runs on yet; this is the steady host';
      f.append(g);
    }
    body.append(f);
  }
  const rooms = el('div', 'nw-rooms');
  rooms.append(el('div', 'nw-lab', `Rooms · ${h.live.length} live`));
  if (h.live.length) for (const s of h.live) rooms.append(slotNode(s));
  else rooms.append(el('div', 'nw-slot nw-slot--empty', 'no room up'));
  if (h.ended.length) {
    const e = el('div', 'nw-ended');
    const pips = el('span', 'nw-pips');
    for (const r of h.ended) {
      const i = el('i', `nw-pip nw-pip--${r.stop === 'done' ? 'done' : r.stop === 'errors' ? 'err' : 'stop'}`);
      i.title = `${rnClean(r.name, 120)} · ${rnClean(r.stop, 24) ?? 'ended'}`;
      pips.append(i);
    }
    e.append(pips, el('span', null, `${h.ended.length} ended today`));
    rooms.append(e);
  }
  body.append(rooms);
  sec.append(body, stripNode(h, now));
  return sec;
}

function youNode(you) {
  const box = el('div', 'nw-you');
  const hd = el('div', 'nw-hd');
  hd.append(el('span', 'nw-nm', 'you'), el('span', 'nw-plate', 'owner'));
  box.append(hd);
  const a = el('a', `nw-you-l${you.needs ? ' nw-you-l--needs' : ''}`, you.needs ? `■ ${you.needs} ${you.needs === 1 ? 'run waits' : 'runs wait'} for you` : 'nothing waits');
  a.href = '#/runs';
  box.append(a);
  if (you.questions) {
    const q = el('a', 'nw-you-q', `${you.questions} ${you.questions === 1 ? 'question' : 'questions'} in the Inbox`);
    q.href = '#/inbox';
    box.append(q);
  }
  return box;
}

/** The whole view's DOM from the model. `sel` is a host id to mark, or null. */
export function renderNetwork(container, m, { sel = null, now = Date.now(), failed = false } = {}) {
  const root = el('div', 'nw');
  const head = el('p', 'nw-headline');
  const reporting = m.hosts.filter((h) => h.reporting).length;
  const fh = m.hosts.find((h) => h.foreman);
  head.append(el('span', 'nw-k', 'Network'), el('span', null, `${reporting} ${reporting === 1 ? 'host' : 'hosts'} reporting · ${m.hosts.length} known`));
  if (fh) head.append(el('span', null, `foreman on ${rnClean(fh.id, 48)}`));
  if (m.you.needs) head.append(el('span', 'nw-needs', `■ ${m.you.needs} ${m.you.needs === 1 ? 'run waits' : 'runs wait'} for you`));
  root.append(head);
  if (failed) root.append(el('p', 'rn-stale', 'The runs could not be read; this is the last picture.'));
  const stage = el('div', 'nw-stage');
  stage.append(youNode(m.you));
  const bus = el('div', 'nw-bus');
  const lab = el('span', 'nw-bus-l', 'tailnet');
  const ph = el('span', 'dr-notyet', 'links not reported yet');
  ph.title = 'laneboard has no tailnet feed: the wire shows who is on it, not how they are linked';
  bus.append(lab, ph);
  stage.append(bus);
  const machines = el('div', 'nw-machines');
  if (!m.hosts.length) machines.append(el('p', 'nw-none', 'No machine is known yet: no engine reports hosts, and no run names one.'));
  for (const h of m.hosts) machines.append(hostNode(h, now, sel === h.id));
  stage.append(machines);
  const wires = svg('svg', { class: 'nw-wires', 'aria-hidden': 'true' });
  wires.append(svg('g', { class: 'nw-wl' }), svg('g', { class: 'nw-fx' }));
  stage.append(wires);
  root.append(stage);
  if (container) {
    container.textContent = '';
    container.append(root);
  }
  return root;
}

// ---------------------------------------------------------------- the wire, once the boxes have a size

/** Draw the wire and its taps over the stage. Browser only (needs layout); a no-op without it. */
export function layoutWires(root) {
  const stage = root?.querySelector?.('.nw-stage');
  const g = stage?.querySelector?.('.nw-wl');
  if (!stage || !g || typeof stage.getBoundingClientRect !== 'function') return null;
  const o = stage.getBoundingClientRect();
  const R = (n) => { const b = n.getBoundingClientRect(); return { l: b.left - o.left, t: b.top - o.top, r: b.right - o.left, b: b.bottom - o.top, cy: (b.top + b.bottom) / 2 - o.top }; };
  const you = stage.querySelector('.nw-you');
  const bus = stage.querySelector('.nw-bus');
  const hosts = [...stage.querySelectorAll('.nw-host')];
  if (!you || !bus || !hosts.length) return null;
  const svgEl = stage.querySelector('.nw-wires');
  svgEl.setAttribute('viewBox', `0 0 ${Math.round(o.width)} ${Math.round(o.height)}`);
  g.textContent = '';
  const line = (pts, cls) => g.append(svg('polyline', { points: pts.map((p) => p.map((v) => Math.round(v) + 0.5).join(',')).join(' '), class: cls }));
  const tap = (x, y, cls = '') => g.append(svg('circle', { cx: Math.round(x) + 0.5, cy: Math.round(y) + 0.5, r: 3.5, class: `nw-tap ${cls}` }));
  const taps = {};
  const phone = o.width < 560;
  const Y = R(you);
  const B = R(bus);
  if (!phone) {
    const by = B.b - 6;
    const hs = hosts.map(R);
    line([[Math.min(Y.l + 24, hs[0].l + 16) - 10, by], [Math.max(...hs.map((h) => h.l + 16)) + 10, by]], 'nw-w nw-w--bus');
    line([[Y.l + 24, Y.b], [Y.l + 24, by]], 'nw-w');
    tap(Y.l + 24, by);
    taps.you = [[Y.l + 24, by], [Y.l + 24, Y.b]];
    hosts.forEach((n, i) => {
      const h = hs[i];
      line([[h.l + 16, by], [h.l + 16, h.t]], `nw-w${n.classList.contains('nw-host--dash') ? ' nw-w--dash' : ''}`);
      tap(h.l + 16, by, n.classList.contains('nw-host--dash') ? 'nw-tap--dash' : '');
      taps[n.dataset.host] = [[h.l + 16, by], [h.l + 16, h.t + 14]];
    });
  } else {
    const bx = 6;
    const hs = hosts.map(R);
    line([[bx, Y.cy], [bx, hs.at(-1).t + 18]], 'nw-w nw-w--bus');
    line([[bx, Y.cy], [Y.l, Y.cy]], 'nw-w');
    tap(bx, Y.cy);
    taps.you = [[bx, Y.cy], [Y.l, Y.cy]];
    hosts.forEach((n, i) => {
      const h = hs[i];
      line([[bx, h.t + 18], [h.l, h.t + 18]], 'nw-w');
      tap(bx, h.t + 18);
      taps[n.dataset.host] = [[bx, h.t + 18], [h.l, h.t + 18]];
    });
  }
  return taps;
}

/**
 * A packet along the wire, from a host's tap to the foreman's host (and on to
 * you when the run now waits for you). Browser only; nothing under reduced motion.
 */
export function packet(root, taps, from, to, tone = '') {
  const fx = root?.querySelector?.('.nw-fx');
  if (!fx || !taps?.[from] || !taps?.[to] || typeof requestAnimationFrame !== 'function') return;
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Each tap is [point on the wire, point at the box]: box → wire → wire → box.
  const path = [taps[from][1], taps[from][0], taps[to][0], taps[to][1]];
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segs.push(l);
    total += l;
  }
  const dot = svg('circle', { r: 3, class: `nw-pkt ${tone}` });
  fx.append(dot);
  const ms = Math.min(1600, Math.max(500, total * 2));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    let d = k * total;
    let i = 0;
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i += 1; }
    const f = segs[i] ? d / segs[i] : 0;
    dot.setAttribute('cx', String(path[i][0] + (path[i + 1][0] - path[i][0]) * f));
    dot.setAttribute('cy', String(path[i][1] + (path[i + 1][1] - path[i][1]) * f));
    if (k < 1) requestAnimationFrame(step);
    else dot.remove();
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- the view

const ST = { host: null, timer: null, model: null, failed: false, seq: new Map(), taps: null, sel: null, fetchFn: null, onResize: null };

const selOf = (ctx) => {
  const s = ctx?.route?.sel;
  return typeof s === 'string' && s.startsWith('node:') ? s.slice(5, 53) : null;
};

async function nwRefresh() {
  const res = await loadEngineRuns(ST.fetchFn ?? globalThis.fetch);
  if (!ST.host) return;
  ST.failed = res.failed;
  if (res.failed && ST.model) { nwPaint(); return; }
  const prev = ST.seq;
  ST.model = networkModel(res.engines, res.rows, Date.now());
  ST.seq = new Map();
  const moved = [];
  for (const h of ST.model.hosts) {
    for (const s of h.live) {
      ST.seq.set(s.key, s.lastSeq);
      const was = prev.get(s.key);
      if (typeof was === 'number' && typeof s.lastSeq === 'number' && s.lastSeq > was) moved.push({ host: h.id, waits: s.blocked || s.state === 'at-gate' });
    }
  }
  nwPaint();
  const fh = ST.model.hosts.find((h) => h.foreman)?.id;
  for (const m of moved) {
    if (fh && m.host !== fh) packet(ST.root, ST.taps, m.host, fh);
    if (m.waits && fh) packet(ST.root, ST.taps, fh, 'you', 'nw-pkt--needs');
  }
}

function nwPaint() {
  if (!ST.host || !ST.model) return;
  ST.root = renderNetwork(ST.host, ST.model, { sel: ST.sel, failed: ST.failed });
  ST.taps = layoutWires(ST.root);
  if (ST.sel) ST.root.querySelector?.(`.nw-host[data-host="${globalThis.CSS?.escape ? globalThis.CSS.escape(ST.sel) : ST.sel}"]`)?.scrollIntoView?.({ block: 'nearest' });
}

function nwMount(host, ctx) {
  ST.host = host;
  ST.sel = selOf(ctx);
  ST.fetchFn = ctx.fetchFn ?? null;
  host.textContent = '';
  host.append(el('p', 'nw-none', 'Loading the machines…'));
  nwRefresh();
  ST.timer = setInterval(nwRefresh, POLL_MS);
  ST.onResize = () => { if (ST.root) ST.taps = layoutWires(ST.root); };
  globalThis.addEventListener?.('resize', ST.onResize);
}

function nwUnmount() {
  clearInterval(ST.timer);
  globalThis.removeEventListener?.('resize', ST.onResize);
  Object.assign(ST, { host: null, timer: null, root: null, taps: null });
}

function nwUpdate(ctx) {
  const sel = selOf(ctx);
  if (sel !== ST.sel) { ST.sel = sel; nwPaint(); }
}

export default {
  id: 'network',
  icon: 'lane',
  title: 'Network',
  mount: (host, ctx = {}) => { nwMount(host, ctx); },
  unmount: () => nwUnmount(),
  update: (_store, ctx = {}) => { nwUpdate(ctx); },
};
