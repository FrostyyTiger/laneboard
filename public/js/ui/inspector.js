// The inspector (L3, fleet plan §4 D6): the right-hand panel in #shell-insp,
// 360px, closed by default. It opens on the route's `sel=<fkey>` and closes on
// `sel=null` (Esc: shell.js closeTop), so `sel` means the same lane on every
// view (§5 2.3: the inspector is the single detail surface).
//
//   header      builder plate, lane/session title, state lamp + word, age, close
//   tabs        a registry: OVERVIEW is built in; PEEK (§10 R12), DIFF (§10
//               R11) and TRANSCRIPT register themselves with registerTab()
//   overview    data block, ctx and $ sparklines, git/PR/checks, last prompt,
//               assistant line, tool/marker, flags, preview (previewLines via
//               core/ansi.js)
//   action bar  ui/actionbar.js (D6 stub; §8 C14 owns it)
//   hairline    a 1px tether from the selected Map node to the panel, via the
//               map API's screenOf(id) (§5 M4), once the map view calls bindMap()
//
// Opening the inspector on the hub sends `{type:'touch', fkey, how:'inspect'}`
// (README §3.4) so the review-wait timer (§7 O10) records the human touch.
// L4 from here is D6b's openSheet(key, {mode:'centre'}) on desktop.
//
// Pure at import time: no `document` until init()/a renderer runs. The pure
// parts (resolveSel, inspectorModel, tabsModel, hairline, touchMessage, ...)
// are tested in test/inspector.test.mjs. Builder-supplied text is untrusted:
// it reaches the page through textContent / setAttribute only.
import { $, el } from '../core/dom.js';
import { STATE_LABEL, ago, money, shortDir } from '../core/format.js';
import { deriveCode, parseFkey } from '../core/keys.js';
import { previewToNodes } from '../core/ansi.js';
import { icon } from '../core/icons.js';
import { act } from '../core/actions.js';
import { store, subscribe, toIndexKey } from '../core/store.js';
import { currentSource } from '../core/net.js';
import { currentRoute, navigate, onRoute } from '../core/router.js';
import { lamp, markSel, normP, plate } from './components.js';
import { sparkline } from './spark.js';
import { confirmAction } from './confirm.js';
import { toast } from './toast.js';
import { openSheet } from './sheet.js';
import { layoutFor, setInspector } from './shell.js';
import { renderActionBar } from './actionbar.js';
import { runFacts } from '../views/map/overlays.js';

// ---------------------------------------------------------------- constants

/** The four-letter state words of the data block (§4 2.7). */
export const STATE_WORD = Object.freeze({
  waiting_permission: 'PERM', waiting_question: 'QUES', working: 'WORK',
  done: 'DONE', idle: 'IDLE', shell: 'SHEL', dead: 'DEAD',
});
/** Worst first, for picking a lane's lead session. */
const STATE_ORDER = ['waiting_permission', 'waiting_question', 'working', 'done', 'idle', 'shell', 'dead'];

/** Tab slots in strip order; registered tabs outside these go after them. */
export const TAB_SLOTS = Object.freeze(['overview', 'peek', 'diff', 'transcript']);
/** The `how` of the touch message the inspector sends (README §3.4). */
export const TOUCH_HOW = 'inspect';
/** Samples kept per key for the ctx and $ sparklines. */
export const SPARK_SAMPLES = 30;
/** Longest untrusted text shown in one line of the panel. */
const TEXT_MAX = 2000;
const PREVIEW_MAX = 60;

const str = (v, max = TEXT_MAX) => (typeof v === 'string' && v !== '' ? (v.length > max ? `${v.slice(0, max)}…` : v) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------- selection

/**
 * Strip a Map node-id prefix (`lane:` / `sess:`) from a `sel` value, the same
 * mapping as the map's selForId (§5 2.3). A `node:<id>` sel (a machine or a
 * service the palette flew to, T11) has no lane panel: null. Pure.
 */
export function selTarget(sel) {
  if (typeof sel !== 'string' || sel === '' || sel.startsWith('node:')) return null;
  for (const prefix of ['lane:', 'sess:']) {
    if (sel.startsWith(prefix) && parseFkey(sel.slice(prefix.length))) return sel.slice(prefix.length);
  }
  return sel;
}

function findLane(s, key, builder, name) {
  const list = Array.isArray(s.lanes) ? s.lanes : [];
  return list.find((l) => l && l.key === key)
    ?? list.find((l) => l && l.id === name && (!builder || !l.builder || l.builder === builder))
    ?? null;
}

/**
 * What a `sel` names in store `s`: {sel, key, builder, name, session,
 * sessionKey, lane}. A session wins over a lane of the same name; a lane
 * resolves to its lead session (worst state first). Nothing found keeps
 * `builder`/`name` so the panel can say what it looked for. Pure.
 */
export function resolveSel(s, sel) {
  const key = selTarget(sel);
  const out = { sel: key, key, builder: null, name: null, session: null, sessionKey: null, lane: null };
  if (!key || !s) return out;
  const p = parseFkey(key);
  out.builder = p?.builder ?? null;
  out.name = p?.name ?? key;
  const sk = toIndexKey(s, key);
  const sess = sk ? s.sessions.get(sk) : null;
  if (sess) {
    out.session = sess;
    out.sessionKey = sk;
    out.builder = sess.builder ?? out.builder;
    if (sess.lane) out.lane = findLane(s, sess.laneKey, out.builder, sess.lane);
    return out;
  }
  const lane = findLane(s, key, out.builder, out.name);
  if (!lane) return out;
  out.lane = lane;
  out.builder = lane.builder ?? out.builder;
  const names = Array.isArray(lane.sessions) ? lane.sessions : [];
  let best = null;
  for (const n of names) {
    const k2 = toIndexKey(s, out.builder ? `${out.builder}/${n}` : n) ?? (s.sessions.has(n) ? n : null);
    const cand = k2 ? s.sessions.get(k2) : null;
    if (!cand) continue;
    const rank = STATE_ORDER.indexOf(cand.state);
    if (!best || (rank >= 0 ? rank : 99) < best.rank) best = { k: k2, cand, rank: rank >= 0 ? rank : 99 };
  }
  if (best) {
    out.session = best.cand;
    out.sessionKey = best.k;
  }
  return out;
}

// ---------------------------------------------------------------- model

function inspPr(pr) {
  if (!pr || typeof pr !== 'object' || pr.none || pr.error) return null;
  const n = num(pr.number);
  if (n == null) return null;
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  // Only an https link is ever followed (the URL is builder-supplied).
  let url = null;
  if (typeof pr.url === 'string') {
    try { if (new URL(pr.url).protocol === 'https:') url = pr.url; } catch { /* not a URL */ }
  }
  const c = pr.checks && typeof pr.checks === 'object' ? pr.checks : {};
  return {
    number: n, state, url,
    verdict: ['green', 'red', 'pending'].includes(pr.verdict) ? pr.verdict : null,
    checks: { passed: num(c.passed) ?? 0, failed: num(c.failed) ?? 0, pending: num(c.pending) ?? 0, total: num(c.total) ?? 0 },
    failing: Array.isArray(c.failedNames) ? c.failedNames.filter((x) => typeof x === 'string').slice(0, 12) : [],
  };
}

/** The lane's PR from its builder's box payload (the Board's source), or null. */
export function prFor(s, builder, laneId) {
  if (!s || !laneId) return null;
  const box = (builder && s.builders?.get?.(builder)?.box) ?? ((s.builders?.size ?? 0) <= 1 ? s.box : null);
  const pr = box?.prs?.[laneId];
  return pr ?? null;
}

/**
 * The inspector model for a lane (§4 D6 `inspectorModel(lane)`), with the
 * selected session in `opts.session` (default: none; a lane alone still
 * renders). `opts`: {session, sessionKey, key, builder, builderInfo, pr,
 * multi, history: {ctx:[], usd:[]}}. Every text field is a plain string for
 * textContent. `found` is false when there is neither a lane nor a session.
 * Pure.
 */
export function inspectorModel(lane, opts = {}) {
  const s = opts.session ?? null;
  const l = lane && typeof lane === 'object' ? lane : null;
  const found = Boolean(s || l);
  const builder = str(opts.builder, 64) ?? str(s?.builder, 64) ?? str(l?.builder, 64);
  const b = opts.builderInfo ?? null;
  const code = str(b?.code, 8) ?? (builder ? deriveCode(builder) : null);
  const state = typeof s?.state === 'string' ? s.state : null;
  const laneId = str(l?.id, 200) ?? str(s?.lane, 200);
  const sessionName = str(s?.name, 200);
  const title = laneId ?? sessionName ?? str(opts.key, 200) ?? '';
  const ctx = num(s?.context?.usedPct);
  const usd = num(s?.cost?.usd);
  const prog = l?.progress && num(l.progress.m) != null ? { n: num(l.progress.n) ?? 0, m: l.progress.m } : null;
  const flags = [];
  if (s?.danger) flags.push({ id: 'danger', icon: 'alarm', p: '1', text: str(s.danger.reason) ?? 'danger' });
  if (s?.awaitingApproval) flags.push({ id: 'approval', icon: 'approval', p: '2', text: 'approval pending' });
  if (s?.stuck) flags.push({ id: 'stuck', icon: 'stuck', p: '2', text: str(s.stuck.reason) ?? str(s.stuck.rule) ?? 'stuck' });
  if (s?.paused) flags.push({ id: 'paused', icon: 'pause', p: '3', text: `paused${str(s.paused.by, 80) ? ` by ${s.paused.by}` : ''}` });
  if (l?.reviewReady?.ready) flags.push({ id: 'review', icon: 'review', p: '3', text: 'ready for review' });
  const down = b && (b.status === 'down' || b.status === 'stale');
  const marker = s?.lastMarker && typeof s.lastMarker === 'object'
    ? { kind: str(s.lastMarker.kind, 24) ?? 'note', text: str(s.lastMarker.text) ?? '' } : null;
  const hist = opts.history ?? {};
  return {
    found,
    key: str(opts.key, 400),
    builder, code,
    builderDown: Boolean(down && opts.hub),
    multi: Boolean(opts.multi),
    title,
    sessionName,
    sessionKey: opts.sessionKey ?? (s ? s.key ?? null : null),
    laneId,
    laneKey: l ? (l.key ?? (builder && laneId ? `${builder}/${laneId}` : laneId)) : null,
    isMain: Boolean(l?.isMain),
    sessions: Array.isArray(l?.sessions) ? l.sessions.filter((x) => typeof x === 'string').slice(0, 20) : [],
    state,
    p: state ? normP(state) : 'off',
    word: state ? STATE_WORD[state] ?? state.slice(0, 4).toUpperCase() : (l ? 'LANE' : '----'),
    stateLabel: state ? STATE_LABEL[state] ?? state : (l ? 'no session' : 'not found'),
    since: num(s?.stateSince),
    dead: state === 'dead',
    stage: prog,
    branch: str(s?.branch, 200) ?? str(l?.branch, 200),
    dir: str(s?.dir, 400),
    git: { dirty: num(s?.dirty) ?? 0, ahead: num(s?.ahead) ?? 0, behind: num(s?.behind) ?? 0 },
    model: str(s?.claude?.model, 80),
    ctx,
    ctxSize: num(s?.context?.size),
    usd,
    usdToday: num(s?.cost?.usdToday),
    ctxHistory: Array.isArray(hist.ctx) ? hist.ctx.slice(-SPARK_SAMPLES) : (ctx != null ? [ctx] : []),
    usdHistory: Array.isArray(hist.usd) ? hist.usd.slice(-SPARK_SAMPLES) : (usd != null ? [usd] : []),
    pr: inspPr(opts.pr),
    prompt: str(s?.activity?.lastUserPrompt),
    assistant: str(s?.activity?.lastAssistant),
    tool: str(s?.activity?.tool, 120) ? { name: str(s.activity.tool, 120), input: str(s.activity.toolInput) } : null,
    marker,
    flags,
    approvalId: str(s?.awaitingApproval, 128),
    paused: s?.paused ? true : false,
    previewLines: Array.isArray(s?.previewLines) ? s.previewLines.filter((x) => typeof x === 'string').slice(-PREVIEW_MAX) : [],
  };
}

/** The Map's run node a `run:<id>` sel names in store `s`, or null. */
export function runNodeFor(s, sel) {
  if (typeof sel !== 'string' || !sel.startsWith('run:')) return null;
  const nodes = Array.isArray(s?.map?.nodes) ? s.map.nodes : [];
  return nodes.find((n) => n && n.kind === 'run' && n.id === sel) ?? null;
}

/**
 * A run node's panel model (server/map/runs.mjs; overlays.js runFacts): the
 * header says the run and its state, the overview its goal, round, progress
 * and the run page link. Not `found` (no lane, no session: no actions). Pure.
 */
export function runInspectorModel(node, key = null) {
  const base = inspectorModel(null, { key });
  const f = runFacts(node);
  if (!f) return base;
  const word = f.tone === 'crit' ? 'FAIL' : f.tone === 'warn' ? 'STCK' : f.state === 'stopped' ? 'STOP' : 'RUN';
  return {
    ...base,
    title: str(node.label, 200) ?? str(node.run, 200) ?? base.title,
    p: f.tone === 'crit' ? '1' : f.tone === 'warn' ? '2' : 'off',
    word,
    stateLabel: f.why ?? f.state ?? 'run',
    run: { ...f, goal: f.goal ? str(f.goal) : null },
  };
}

/** The model for `sel` in store `s` (resolveSel + inspectorModel). */
export function modelFor(s, sel, { history = null } = {}) {
  const runNode = runNodeFor(s, sel);
  if (runNode) return runInspectorModel(runNode, sel);
  const r = resolveSel(s, sel);
  const builderInfo = r.builder ? s.builders?.get?.(r.builder) ?? null : null;
  return inspectorModel(r.lane, {
    session: r.session, sessionKey: r.sessionKey, key: r.key, builder: r.builder, builderInfo,
    hub: s.source?.kind === 'hub',
    multi: (s.builders?.size ?? 0) > 1,
    pr: prFor(s, r.builder, r.lane?.id ?? r.session?.lane ?? null),
    history: history ?? undefined,
  });
}

// ---------------------------------------------------------------- sparkline samples

/**
 * Append one sample per series to `hist` (a Map key -> {ctx:[], usd:[]}),
 * skipping a repeat of the last value, keeping at most `max`. Returns the
 * entry. Mutates `hist` only.
 */
export function pushSample(hist, key, { ctx = null, usd = null } = {}, max = SPARK_SAMPLES) {
  if (!key) return null;
  let h = hist.get(key);
  if (!h) { h = { ctx: [], usd: [] }; hist.set(key, h); }
  const put = (arr, v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (arr.length && arr[arr.length - 1] === v) return;
    arr.push(v);
    while (arr.length > max) arr.shift();
  };
  put(h.ctx, ctx);
  put(h.usd, usd);
  return h;
}

// ---------------------------------------------------------------- tab registry

const tabRegistry = new Map();
const TAB_ID_RX = new RegExp('^[a-z][a-z0-9-]{0,23}$');

/**
 * Register an inspector tab: {id, title, icon?, mount(el, sel, ctx),
 * unmount(), update?(sel, ctx)}. `title` is the short tab label (≤ 5 chars
 * shown, the long name goes in `long`). Replaces a tab of the same id.
 * Returns an unregister function. OVERVIEW is built in and not replaceable.
 */
export function registerTab(spec) {
  if (!spec || !TAB_ID_RX.test(String(spec.id))) throw new TypeError('registerTab: bad id');
  if (spec.id === 'overview') throw new TypeError('registerTab: overview is built in');
  if (typeof spec.mount !== 'function') throw new TypeError('registerTab: mount(el, sel, ctx) is required');
  const tab = Object.freeze({ ...spec, title: String(spec.title ?? spec.id) });
  tabRegistry.set(spec.id, tab);
  scheduleInspector();
  return () => {
    if (tabRegistry.get(spec.id) !== tab) return;
    tabRegistry.delete(spec.id);
    scheduleInspector();
  };
}

export function unregisterTab(id) {
  const had = tabRegistry.delete(id);
  if (had) scheduleInspector();
  return had;
}

/** Registered tabs (overview excluded), slot order first, then by id. */
export function registeredTabs() {
  const rank = (id) => { const i = TAB_SLOTS.indexOf(id); return i < 0 ? TAB_SLOTS.length : i; };
  return [...tabRegistry.values()].sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Tests only. */
export function _resetTabs() {
  tabRegistry.clear();
}

/**
 * The tab strip: [{id, label, long, active}] with overview first. An unknown
 * or unregistered `active` falls back to overview. Pure over `list`.
 */
export function tabsModel(list, active) {
  const tabs = [{ id: 'overview', label: 'OVW', long: 'Overview' }];
  for (const t of list) {
    const long = String(t.long ?? t.title);
    tabs.push({ id: t.id, label: String(t.title).slice(0, 5).toUpperCase(), long });
  }
  const on = tabs.some((t) => t.id === active) ? active : 'overview';
  return tabs.map((t) => ({ ...t, active: t.id === on }));
}

// ---------------------------------------------------------------- touch, L4, hairline

/** The touch message for opening `fkey` in the inspector (README §3.4). Pure. */
export function touchMessage(fkey, how = TOUCH_HOW) {
  return { type: 'touch', fkey, how };
}

/**
 * Whether opening `sel` (after `prev`) should send a touch: only on the hub
 * (the builder `/ws` has no review-wait), only for a fleet key, once per
 * selection. Pure.
 */
export function shouldTouch(prev, sel, sourceKind) {
  return sourceKind === 'hub' && typeof sel === 'string' && sel !== prev && Boolean(parseFkey(sel));
}

/** Where L4 opens for a viewport width: the centre takeover on desktop, else the full sheet. Pure. */
export function l4Mode(width) {
  return layoutFor(width) === 'desktop' ? 'centre' : 'sheet';
}

/**
 * The tether from point `from` (the node, in the host's px) to the panel's
 * left edge `rect` ({left, top, bottom}, same px): {x, y, len, angle} for a
 * 1px line drawn from (x, y), rotated by `angle` radians. The end is the
 * panel edge at the node's height, clamped 8px inside the panel. Null when
 * there is no point, no panel, or the node is under the panel. Pure.
 */
export function hairline(from, rect) {
  if (!from || !rect) return null;
  const x = num(from.x), y = num(from.y), left = num(rect.left), top = num(rect.top), bottom = num(rect.bottom);
  if (x == null || y == null || left == null || top == null || bottom == null) return null;
  if (x >= left - 4) return null;
  const ty = Math.min(Math.max(y, top + 8), Math.max(top + 8, bottom - 8));
  const dx = left - x, dy = ty - y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  return { x, y, len: Math.round(len * 10) / 10, angle: Math.atan2(dy, dx) };
}

// ---------------------------------------------------------------- DOM

const page = {
  root: null,          // #shell-insp
  sel: null,           // the open fkey
  touched: null,       // the last fkey a touch was sent for
  tab: 'overview',
  mounted: null,       // {id, tab, el} of a registered tab's mount
  history: new Map(),  // key -> {ctx:[], usd:[]}
  map: null,           // {api, root, hairline}
  line: null,          // the hairline element
  timer: null,
  tetherTimer: null,
  inited: false,
};

/** The panel element while it is open (the map's tether target, §5 2.3), else null. */
export function anchorEl() {
  return page.sel && page.root && !page.root.hidden ? page.root : null;
}

/** The open selection (fkey), or null. */
export function selected() {
  return page.sel;
}

/** Open L4 for a session key: D6b's sheet, in the centre on desktop. */
export function openTerminal(k) {
  if (!k) return;
  openSheet(k, { mode: l4Mode(globalThis.innerWidth ?? 1200) });
}

function tabCtx(m) {
  return { store, route: currentRoute(), navigate, act, model: m, openTerminal };
}

function unmountTab() {
  const m = page.mounted;
  page.mounted = null;
  if (!m) return;
  try { m.tab.unmount?.(); } catch { /* a tab never breaks the panel */ }
}

function row(label, value, cls = null) {
  const r = el('div', `insp-row${cls ? ` ${cls}` : ''}`);
  r.append(el('span', 'insp-k', label));
  const v = el('span', 'insp-v');
  if (value != null && typeof value === 'object') v.append(value);
  else v.textContent = String(value ?? '—');
  r.append(v);
  return r;
}

function prNode(pr) {
  const n = el(pr.url ? 'a' : 'span', `insp-pr pr-${pr.state}`);
  if (pr.url) {
    n.href = pr.url;
    n.target = '_blank';
    n.rel = 'noopener noreferrer';
  }
  n.append(icon(pr.state === 'merged' ? 'pr-merged' : pr.state === 'draft' ? 'pr-draft' : 'pr', { size: 's' }));
  const c = pr.checks;
  const checks = pr.verdict === 'red' ? ` ✗ ${c.failed}/${c.total}`
    : pr.verdict === 'pending' ? ` ◌ ${c.pending}/${c.total}`
      : pr.verdict === 'green' ? ` ● ${c.passed}/${c.total}` : '';
  n.append(el('span', null, `#${pr.number}${checks}`));
  if (pr.verdict) n.dataset.verdict = pr.verdict;
  n.title = pr.failing.length ? `failing: ${pr.failing.join(', ')}` : `${pr.state} PR #${pr.number}`;
  return n;
}

/** The header: builder plate, title, lamp + word, age, L4 and close buttons. */
export function renderHeader(m) {
  const head = el('header', 'insp-head');
  markSel(head, m.found);
  const line = el('div', 'insp-head-l');
  if (m.code) line.append(plate(m.code, { title: m.builder ?? '' }));
  const t = el('h2', 'insp-title', m.title || '—');
  t.title = m.sessionName && m.laneId && m.sessionName !== m.laneId ? `${m.laneId} · ${m.sessionName}` : m.title;
  line.append(t);
  const tools = el('span', 'insp-tools');
  if (m.sessionKey && !m.dead) {
    const term = el('button', 'icon-btn insp-term');
    term.type = 'button';
    term.setAttribute('aria-label', 'Open terminal (Enter)');
    term.title = 'Open terminal (Enter)';
    term.append(icon('terminal', { size: 's' }));
    term.onclick = () => openTerminal(m.sessionKey);
    tools.append(term);
  }
  const close = el('button', 'icon-btn insp-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close inspector (Esc)');
  close.title = 'Close inspector (Esc)';
  close.append(icon('close', { size: 's' }));
  close.onclick = () => navigate({ sel: null, open: null }, { replace: true });
  tools.append(close);
  line.append(tools);
  head.append(line);

  const st = el('div', 'insp-state');
  st.append(lamp(m.p, { label: m.stateLabel }));
  st.append(el('span', 'insp-word', m.word));
  if (m.sessionName && m.sessionName !== m.title) st.append(el('span', 'insp-sess', m.sessionName));
  if (m.since != null) st.append(el('span', 'insp-age', ago(m.since)));
  head.append(st);
  return head;
}

/** The OVERVIEW tab body for model `m`. */
export function renderOverview(m, doc = globalThis.document) {
  const box = el('div', 'insp-ovw');
  if (m.run) {
    const r = m.run;
    if (r.goal) box.append(el('p', 'insp-say', r.goal));
    const dl = el('div', 'insp-data');
    if (r.round) dl.append(row('RND', r.round.replace(/^round /, '')));
    if (r.progress) dl.append(row('PROG', r.progress));
    if (r.why) dl.append(row('WHY', r.why));
    if (dl.childNodes.length) box.append(dl);
    if (r.href) {
      const a = el('a', 'insp-pr insp-run-open', 'Open run ›');
      a.href = r.href;
      box.append(a);
    }
    return box;
  }
  if (!m.found) {
    box.append(el('p', 'insp-empty', 'Nothing by that key on any builder this board can see.'));
    return box;
  }
  if (m.flags.length) {
    const fl = el('ul', 'insp-flags');
    for (const f of m.flags) {
      const li = el('li', 'insp-flag');
      li.dataset.p = f.p;
      li.append(icon(f.icon, { size: 's' }), el('span', null, f.text));
      fl.append(li);
    }
    box.append(fl);
  }

  const dl = el('div', 'insp-data');
  if (m.stage) dl.append(row('STG', `${m.stage.n}/${m.stage.m}`));
  if (m.branch) dl.append(row('BR', `⌥${m.branch}`));
  if (m.dir) dl.append(row('DIR', shortDir(m.dir)));
  const g = m.git;
  if (g.dirty || g.ahead || g.behind) dl.append(row('GIT', `●${g.dirty} ↑${g.ahead} ↓${g.behind}`));
  if (m.pr) dl.append(row('PR', prNode(m.pr)));
  if (m.model) dl.append(row('MDL', m.model));
  if (m.ctx != null) {
    const v = el('span', 'insp-spark');
    v.append(sparkline(m.ctxHistory, { label: `ctx ${m.ctx}%`, threshold: 65, min: 0, max: 100 }));
    const pct = el('span', `insp-n${m.ctx >= 85 ? ' is-p1' : m.ctx >= 65 ? ' is-p2' : ''}`,
      `${m.ctx}%${m.ctxSize ? ` of ${Math.round(m.ctxSize / 1000)}k` : ''}`);
    v.append(pct);
    dl.append(row('CTX', v));
  }
  if (m.usd != null) {
    const v = el('span', 'insp-spark');
    v.append(sparkline(m.usdHistory, { label: `cost ${money(m.usd)}` }));
    const n = el('span', 'insp-n', money(m.usd));
    n.title = `API-equivalent, all time. Today ${money(m.usdToday ?? 0)}.`;
    v.append(n);
    dl.append(row('$', v));
  }
  if (m.sessions.length > 1) dl.append(row('SESS', m.sessions.join(' · ')));
  if (dl.childNodes.length) box.append(dl);

  if (m.tool) {
    const t = el('div', 'insp-line insp-tool');
    t.append(el('span', 'insp-tname', m.tool.name));
    if (m.tool.input) t.append(el('span', 'insp-targ', m.tool.input));
    box.append(t);
  } else if (m.marker) {
    const t = el('div', `insp-line insp-marker mk-${m.marker.kind.replace(/[^a-z0-9-]/gi, '')}`);
    t.append(el('span', 'insp-tname', m.marker.kind), el('span', 'insp-targ', m.marker.text));
    box.append(t);
  }
  if (m.prompt) box.append(el('blockquote', 'insp-say insp-say-user', m.prompt));
  if (m.assistant) box.append(el('p', 'insp-say', m.assistant));
  if (m.previewLines.length) {
    const pre = el('div', 'insp-preview');
    pre.setAttribute('aria-label', 'Pane preview');
    pre.append(...previewToNodes(m.previewLines, doc));
    box.append(pre);
  }
  return box;
}

function renderTabs(m, strip, body) {
  if (m.run) {
    // A run node has no lane to peek at or diff: its overview only.
    strip.hidden = true;
    unmountTab();
    body.append(renderOverview(m));
    return;
  }
  const list = registeredTabs();
  const tabs = tabsModel(list, page.tab);
  const active = tabs.find((t) => t.active).id;
  strip.hidden = tabs.length < 2;
  for (const t of tabs) {
    const b = el('button', 'insp-tab', t.label);
    b.type = 'button';
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', t.active ? 'true' : 'false');
    b.title = t.long;
    b.onclick = () => { if (page.tab !== t.id) { page.tab = t.id; renderInspector(); } };
    strip.append(b);
  }
  if (active === 'overview') {
    unmountTab();
    body.append(renderOverview(m));
    return;
  }
  const tab = list.find((x) => x.id === active);
  const host = el('div', 'insp-tabhost');
  body.append(host);
  // A tab keeps its mount across store updates (update?() hears them); a new
  // selection or a tab switch remounts it.
  if (page.mounted && page.mounted.id === active && page.mounted.sel === page.sel) {
    host.append(page.mounted.el);
    try { tab.update?.(page.sel, tabCtx(m)); } catch { /* a tab never breaks the panel */ }
    return;
  }
  unmountTab();
  const mountEl = el('div', 'insp-tabbody');
  host.append(mountEl);
  page.mounted = { id: active, tab, el: mountEl, sel: page.sel };
  try { tab.mount(mountEl, page.sel, tabCtx(m)); } catch (err) {
    mountEl.textContent = `This tab failed: ${err?.message ?? err}`;
  }
}

/** Rebuild the open panel from the store. */
export function renderInspector() {
  const root = page.root;
  if (!root || !page.sel) return;
  const r = resolveSel(store, page.sel);
  const s = r.session;
  const hk = r.sessionKey ?? r.key;
  if (s) pushSample(page.history, hk, { ctx: num(s.context?.usedPct), usd: num(s.cost?.usd) });
  const m = modelFor(store, page.sel, { history: page.history.get(hk) ?? null });
  const keep = page.mounted?.el ?? null;
  if (keep) keep.remove();
  root.textContent = '';
  root.dataset.p = m.p;
  root.append(renderHeader(m));
  const strip = el('nav', 'insp-tabs');
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Inspector tabs');
  const body = el('div', 'insp-body');
  body.setAttribute('role', 'tabpanel');
  root.append(strip, body);
  renderTabs(m, strip, body);
  const bar = el('div', 'insp-actions');
  root.append(bar);
  renderActionBar(bar, { model: m, act, confirmAction, toast, openTerminal });
  updateTether();
}

function scheduleInspector() {
  if (!page.sel || page.timer) return;
  page.timer = setTimeout(() => { page.timer = null; try { renderInspector(); } catch { /* reported by the next render */ } }, 60);
}

/** Open, switch or close for a route. */
export function applyRoute(route) {
  const sel = selTarget(route?.sel ?? null);
  page.root = $('shell-insp') ?? page.root;
  if (sel === page.sel) { if (sel) scheduleInspector(); return; }
  unmountTab();
  page.sel = sel;
  if (!sel) {
    page.tab = 'overview';
    setInspector(false);
    if (page.root) page.root.textContent = '';
    insetsChanged();
    updateTether();
    return;
  }
  setInspector(true);
  if (shouldTouch(page.touched, sel, store.source?.kind)) {
    page.touched = sel;
    try { currentSource()?.send?.(touchMessage(sel)); } catch { /* best effort */ }
  }
  renderInspector();
  insetsChanged();
}

// ---------------------------------------------------------------- map wiring

function insetsChanged() {
  const api = page.map?.api;
  if (!api || typeof api.setInsets !== 'function') return;
  const w = page.sel && page.root ? page.root.getBoundingClientRect?.().width ?? 0 : 0;
  try { api.setInsets({ right: w }); } catch { /* the map's own problem */ }
}

/**
 * The Map view (§5 M5) hands its API here: `api.screenOf(sel)` -> {x, y} in
 * the map root's px, `api.setInsets({right})`. `opts.root` is the map root
 * (default #map-root). `opts.hairline` false leaves the tether to the map's
 * canvas (when the map was created with `anchorEl` from this module). Pass
 * null to unbind (the map unmounted).
 */
export function bindMap(api, { root = null, hairline: draw = true } = {}) {
  if (!api) {
    page.map = null;
    clearInterval(page.tetherTimer);
    page.tetherTimer = null;
    updateTether();
    return;
  }
  page.map = { api, root: root ?? $('map-root'), hairline: draw !== false };
  insetsChanged();
  if (page.map.hairline && !page.tetherTimer) {
    // The map moves (flights, zoom) without telling anyone; a slow poll keeps
    // the hairline near its node with no animation frame in ui/ (guardrail 6).
    page.tetherTimer = setInterval(updateTether, 200);
  }
  updateTether();
}

/** Place (or hide) the hairline from the selected Map node to the panel. */
export function updateTether() {
  const host = $('shell-main');
  const m = page.map;
  let geo = null;
  if (m?.hairline && page.sel && store.view === 'map' && host && m.root && page.root && !page.root.hidden
    && layoutFor(globalThis.innerWidth ?? 1200) !== 'phone') {
    let p = null;
    try { p = m.api.screenOf?.(page.sel); } catch { p = null; }
    if (p) {
      const hr = host.getBoundingClientRect();
      const mr = m.root.getBoundingClientRect();
      const pr = page.root.getBoundingClientRect();
      geo = hairline(
        { x: mr.left - hr.left + p.x, y: mr.top - hr.top + p.y },
        { left: pr.left - hr.left, top: pr.top - hr.top, bottom: pr.bottom - hr.top },
      );
    }
  }
  if (!geo) {
    if (page.line) page.line.hidden = true;
    return;
  }
  if (!page.line) {
    page.line = el('div', 'insp-tether');
    page.line.setAttribute('aria-hidden', 'true');
  }
  if (page.line.parentNode !== host) host.append(page.line);
  page.line.hidden = false;
  page.line.style.width = `${geo.len}px`;
  page.line.style.transform = `translate(${geo.x}px, ${geo.y}px) rotate(${geo.angle}rad)`;
}

// ---------------------------------------------------------------- init

/** Wire the inspector to the route and the store. Run once by boot(). */
export function init() {
  if (page.inited) return;
  page.inited = true;
  page.root = $('shell-insp');
  if (!page.root) return;
  page.root.setAttribute('aria-live', 'off');
  onRoute(applyRoute);
  subscribe(() => scheduleInspector());
  addEventListener('resize', () => { insetsChanged(); updateTether(); }, { passive: true });
}
