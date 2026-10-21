// The Inbox view (fleet plan §8 2.9, task C13). Replaces D4's stub; the
// registry (views/index.js) picks up the default export.
//
// The grouping, ordering and key mapping are pure (core/inbox-model.js); this
// file only draws the model and wires the keys. Everything shown came from a
// builder or an agent and is untrusted: text goes in with textContent only,
// already clipped by the model, never as HTML.
//
// Keys: a/d/r/p are view-scoped commands registered with core/commands.js
// (inbox.approve, inbox.deny, inbox.release, inbox.pause; §4's hotkey table
// maps the keys to them and they win over the global a/p while the inbox is
// active). j/k/Enter are handled by the list itself (role=listbox: the global
// handler leaves list keys to a focused list). Every key acts on the FOCUSED
// ROW'S ID. approve/deny/release/pause go through confirmAction() with the
// action's tier (approve at least `ask`, see TIER_FLOOR) and then act().
//
// The Review group: §10 R13's views/review-queue.js mountReviewQueue(container,
// ctx) owns its slot (`data-slot="review-queue"`), which this view keeps across
// redraws; the inbox's 1 Hz clock calls its tick(). The review rows are still
// in the model so that j/k, p and Enter reach them.
//
// The Runs group (runs plan T5): the view polls GET /api/runs (views/runs.js
// loadRuns, every POLL_MS); a 404/503 (no runs route, e.g. a hub) leaves the
// group out. Enter on a run row opens the run page; `a` on a run need posts a
// `needs.ack` (core/inbox-model.js ackEvent) to POST /api/runs/events.
import { store } from '../core/store.js';
import { post } from '../core/net.js';
import { loadRuns, POLL_MS as RUNS_POLL_MS } from './runs.js';
import { act, tierOf } from '../core/actions.js';
import { currentRoute, navigate as routerNavigate } from '../core/router.js';
import { register } from '../core/commands.js';
import { buildReviewQueue, formatWait, storeLookups } from '../core/review-queue.js';
import { mountReviewQueue } from './review-queue.js';
import {
  ackEvent, buildInbox, COOPERATIVE_NOTE, REMOTE_ONLY_NOTE, effectiveTier, formatCountdown, keyAction,
  lineClass, moveFocus, reconcileFocus, rowOf, withNote,
} from '../core/inbox-model.js';
import { lamp, panel, plate, markSel, setPanel } from '../ui/components.js';
import { confirmAction } from '../ui/confirm.js';
import { toast } from '../ui/toast.js';

// ---------------------------------------------------------------- view state

const state = {
  root: null,       // {el, panel, list}
  ctx: {},
  model: null,
  focusId: null,
  ghost: null,      // the last row seen for focusId (kept as closed when gone)
  expanded: new Set(),
  noteFor: null,    // row id whose deny-note field is open
  busy: new Set(),  // row ids with an action in flight
  timer: null,
  review: null,     // {slot, handle} from mountReviewQueue
  runs: null,       // the GET /api/runs list, null when there is no runs route
  runsTimer: null,
};

/** GET /api/runs: kept on an error (a blip), dropped when there is no runs route. */
async function refreshRuns() {
  const r = await loadRuns();
  if (!state.root) return;
  if (r.kind === 'ok') state.runs = r.runs;
  else if (r.kind === 'unavailable') state.runs = null;
  else return;
  if (state.noteFor) { compute(); return; }
  inboxRefresh();
}

function inboxScopeOf(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

/** The scope shown in the panel title: the builder filter, or ALL. */
export function inboxScope(route) {
  return inboxScopeOf(route);
}

function inboxRouteNow() {
  // The live route first: updateActive() passes no route on store changes.
  try { return currentRoute() ?? state.ctx.route ?? {}; } catch { return state.ctx.route ?? {}; }
}

function compute(now = Date.now()) {
  const route = inboxRouteNow();
  let review = [];
  try { review = buildReviewQueue(store.lanes, now, storeLookups(store)); } catch { review = []; }
  const ghost = state.ghost && state.ghost.id === state.focusId ? state.ghost : null;
  const model = buildInbox(store, { now, scope: inboxScopeOf(route), review, ghost, runs: state.runs });
  state.focusId = reconcileFocus(model, state.focusId);
  const r = rowOf(model, state.focusId);
  state.ghost = r ?? null;
  state.model = model;
  return model;
}

// ---------------------------------------------------------------- rendering

function span(cls, text) {
  const n = document.createElement('span');
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function previewNode(p) {
  const pre = document.createElement('pre');
  pre.className = 'inbox-preview';
  for (const l of p.lines) {
    const line = span(lineClass(l.t), `${l.t} ${l.s}`);
    pre.append(line, document.createTextNode('\n'));
  }
  if (p.truncated) pre.append(span('d-ctx', '… (truncated)'));
  return pre;
}

function noteField(r) {
  const wrap = document.createElement('label');
  wrap.className = 'inbox-note';
  wrap.append(span('inbox-note-l', 'Deny note (Enter sends, Esc cancels)'));
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Deny note for ${r.name ?? r.fkey}`);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const plan = keyAction('d', r.id, state.model);
      state.noteFor = null;
      if (plan.action === 'deny') perform(withNote(plan, input.value));
      else inboxRender();
      focusList();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      state.noteFor = null;
      inboxRender();
      focusList();
    }
  });
  wrap.append(input);
  setTimeout(() => input.focus(), 0);
  return wrap;
}

function inboxRowNode(r) {
  const li = document.createElement('li');
  li.className = 'inbox-row';
  li.id = `inbox-row-${cssId(r.id)}`;
  li.setAttribute('role', 'option');
  li.dataset.row = r.id;
  li.dataset.group = r.group;
  if (r.closed) li.dataset.closed = '';
  const focused = r.id === state.focusId;
  li.setAttribute('aria-selected', focused ? 'true' : 'false');
  markSel(li, focused);

  const head = document.createElement('div');
  head.className = 'inbox-row-h';
  head.append(lamp(r.closed ? 'off' : r.p, { label: r.closed ? 'closed' : r.lampLabel ?? null }));
  if (r.fkey || r.name) head.append(plate(r.fkey ?? r.name));
  if (r.kind === 'approval') {
    head.append(plate(r.mcpServer ? `${r.mcpServer}:${r.tool}` : r.tool, { kind: 'solid' }));
    head.append(span('inbox-sum', r.summary));
    if (r.closed) head.append(span('inbox-status', 'closed'));
    else if (r.expiresAt !== null) {
      const t = span('inbox-timer', formatCountdown(r.expiresAt - Date.now()));
      t.dataset.expires = String(r.expiresAt);
      t.title = 'Until the hold ends and the dialog appears in the terminal';
      head.append(t);
    }
    if (state.busy.has(r.id)) head.append(span('inbox-status', 'sending…'));
  } else if (r.group === 'runs') {
    const sum = span('inbox-sum', r.reason);
    sum.title = r.reason;
    // a run need is the one row that wants a written answer: on a phone its text
    // takes a line of its own under the run name and OPEN/ACK (fleet-views.css)
    if (r.kind === 'run-need') head.classList.add('inbox-row-h--need');
    head.append(sum);
    if (r.link) {
      const a = document.createElement('a');
      a.className = 'inbox-link';
      a.href = r.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = r.link;
      a.textContent = 'open ↗';
      a.addEventListener('click', (e) => e.stopPropagation());
      head.append(a);
    }
    if (r.closed) head.append(span('inbox-status', 'closed'));
    else if (state.busy.has(r.id)) head.append(span('inbox-status', 'sending…'));
    else if (r.kind === 'run-need') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--s inbox-ack';
      b.textContent = 'ack';
      b.title = 'Acknowledge this need (a): the run page and the Inbox stop showing it';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        state.focusId = r.id;
        runKey('a');
      });
      head.append(b);
    }
  } else if (r.group === 'review') {
    head.append(span('inbox-sum', r.reason));
    head.append(span('inbox-timer', formatWait(r.waitMs)));
  } else {
    head.append(span('inbox-sum', r.reason ?? r.state ?? ''));
    if (r.closed) head.append(span('inbox-status', 'closed'));
  }
  li.append(head);

  if (r.kind === 'approval' && state.expanded.has(r.id)) {
    if (r.input) {
      const pre = document.createElement('pre');
      pre.className = 'inbox-input';
      pre.textContent = r.input + (r.inputTruncated ? '\n… (truncated)' : '');
      li.append(pre);
    }
    if (r.preview && r.preview.lines.length) li.append(previewNode(r.preview));
  }
  if (state.noteFor === r.id && r.kind === 'approval' && !r.closed) li.append(noteField(r));

  li.addEventListener('click', () => {
    state.focusId = r.id;
    if (r.kind === 'approval') {
      if (state.expanded.has(r.id)) state.expanded.delete(r.id);
      else state.expanded.add(r.id);
    }
    inboxRender();
    focusList();
  });
  return li;
}

function cssId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

function groupNode(g) {
  const sec = document.createElement('section');
  sec.className = 'inbox-group';
  sec.dataset.group = g.id;
  const h = document.createElement('h3');
  h.className = 'inbox-group-t';
  const hid = `inbox-g-${g.id}`;
  h.id = hid;
  h.append(span('inbox-group-name', g.title.toUpperCase()), span('inbox-group-n', `[${g.rows.filter((r) => !r.closed).length}]`));
  sec.setAttribute('aria-labelledby', hid);
  if (g.note) {
    // Security review S7: say plainly that these controls are cooperative.
    h.title = g.note;
    h.setAttribute('aria-description', g.note);
    const note = span('inbox-note-coop', 'cooperative control');
    note.title = `${COOPERATIVE_NOTE}. ${REMOTE_ONLY_NOTE}`;
    h.append(note);
  }
  sec.append(h);

  if (g.id === 'review' && state.review) {
    const { slot } = state.review;
    markSel(slot, g.rows.some((r) => r.id === state.focusId));
    sec.append(slot);
    return sec;
  }
  if (!g.rows.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing here.';
    sec.append(p);
    return sec;
  }
  const ul = document.createElement('ul');
  ul.className = 'inbox-rows';
  ul.setAttribute('role', 'group');
  for (const r of g.rows) ul.append(inboxRowNode(r));
  sec.append(ul);
  return sec;
}

function inboxRender() {
  const root = state.root;
  if (!root) return;
  const model = state.model ?? compute();
  setPanel(root.panel.root, { scope: inboxScopeOf(inboxRouteNow()), n: model.count });
  const list = root.list;
  list.textContent = '';
  for (const g of model.groups) list.append(groupNode(g));
  if (state.focusId) {
    const node = list.querySelector(`#inbox-row-${cssId(state.focusId)}`);
    if (node) {
      list.setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView?.({ block: 'nearest' });
    } else list.removeAttribute('aria-activedescendant');
  }
}

/** The store as the review group should see it: lanes cut to the builder scope. */
function scopedStore() {
  const scope = inboxScopeOf(inboxRouteNow());
  if (scope === 'all') return store;
  return { ...store, lanes: (store.lanes ?? []).filter((l) => l?.builder === scope) };
}

function reviewCtx() {
  return { store: scopedStore(), navigate: nav, archive: archiveLane };
}

function mountReview() {
  const slot = document.createElement('div');
  slot.className = 'inbox-review-slot';
  slot.dataset.slot = 'review-queue';
  try {
    state.review = { slot, handle: mountReviewQueue(slot, reviewCtx()) };
  } catch (err) {
    console.error('[laneboard] review queue', err);
    state.review = null;
  }
}

function inboxRefresh() {
  compute();
  try { state.review?.handle.update(reviewCtx()); } catch (err) { console.error('[laneboard] review queue', err); }
  inboxRender();
}

function tickTimers() {
  const list = state.root?.list;
  if (!list) return;
  const now = Date.now();
  try { state.review?.handle.tick(now); } catch { /* the review group reports its own errors */ }
  for (const t of list.querySelectorAll('.inbox-timer[data-expires]')) {
    t.textContent = formatCountdown(Number(t.dataset.expires) - now);
  }
}

function focusList() {
  state.root?.list?.focus?.({ preventScroll: true });
}

// ---------------------------------------------------------------- actions

function nav(patch) {
  const fn = typeof state.ctx.navigate === 'function' ? state.ctx.navigate : routerNavigate;
  return fn(patch);
}

/** The review group's Archive button: retire the merged lane (confirm tier, never force). */
async function archiveLane(item) {
  const k = typeof item?.fkey === 'string' ? item.fkey : null;
  if (!k) return { ok: false, error: 'no-target' };
  const tier = tierOf('retire');
  const ok = await confirmAction({ action: 'retire', targets: [k], tier, consequence: ['Retires the merged lane. The record, prompt and transcripts stay.'] });
  if (!ok.ok) return { ok: false, error: 'cancelled' };
  const args = {};
  if (ok.confirm) args.confirm = ok.confirm;
  const res = await act(k, 'retire', args);
  if (res?.ok === true) toast('Retired', { kind: 'ok' });
  else if (res?.ok === 'unknown') toast('Sent, outcome unknown');
  else toast(`retire failed: ${String(res?.error ?? 'error').slice(0, 120)}`, { kind: 'err' });
  return res;
}

const VERB_DONE = Object.freeze({ approve: 'Approved', deny: 'Denied', release: 'Released to the terminal', pause: 'Paused' });

/** confirmAction at the action's tier (approve: at least ask), then act(). */
async function perform(plan) {
  if (!plan || !plan.action) return { ok: false, error: plan?.none ?? 'nothing' };
  const tier = effectiveTier(plan.action, tierOf(plan.action));
  const consequence = plan.action === 'approve'
    ? [`Lets ${plan.fkey} run the requested tool now.`, COOPERATIVE_NOTE]
    : null;
  const ok = await confirmAction({ action: plan.action, targets: [plan.fkey], tier, consequence });
  if (!ok.ok) return { ok: false, error: 'cancelled' };
  // Re-check after the dialog: the focused id must still be pending.
  if (plan.args?.approvalId) {
    const r = rowOf(compute(), plan.rowId);
    if (!r || r.closed) { inboxRender(); toast('That approval is no longer pending'); return { ok: false, error: 'closed' }; }
  }
  const args = { ...plan.args };
  if (ok.confirm && tier === 'confirm') args.confirm = ok.confirm;
  state.busy.add(plan.rowId);
  inboxRender();
  let res;
  try {
    res = await act(plan.fkey, plan.action, args);
  } finally {
    state.busy.delete(plan.rowId);
  }
  if (res?.ok === true) toast(VERB_DONE[plan.action] ?? 'Done', { kind: 'ok' });
  else if (res?.ok === 'unknown') toast('Sent, outcome unknown');
  else toast(`${plan.action} failed: ${String(res?.error ?? 'error').slice(0, 120)}`, { kind: 'err' });
  inboxRefresh();
  return res;
}

/** `a` on a run need: confirmAction (click tier), then post the needs.ack event. */
async function ackRun(plan) {
  const ok = await confirmAction({ action: 'ack', targets: [plan.run], tier: 'click' });
  if (!ok.ok) return { ok: false, error: 'cancelled' };
  state.busy.add(plan.rowId);
  inboxRender();
  let res;
  try {
    res = await post('/api/runs/events', ackEvent(plan));
  } finally {
    state.busy.delete(plan.rowId);
  }
  if (res?.ok === true) toast('Acknowledged', { kind: 'ok' });
  inboxRefresh();
  await refreshRuns();
  return res;
}

/** Run inbox key `key` on the focused row. Returns false when it did nothing. */
function runKey(key) {
  if (!state.model) compute();
  const plan = keyAction(key, state.focusId, state.model);
  if (plan.none) {
    if (plan.none === 'closed') inboxRender();
    return false;
  }
  if (plan.open) { nav({ sel: plan.open }); return true; }
  if (plan.run) { nav({ view: 'runs', run: plan.run }); return true; }
  if (plan.action === 'ack') {
    if (state.busy.has(plan.rowId)) return false;
    ackRun(plan);
    return true;
  }
  if (plan.needsNote) {
    state.noteFor = plan.rowId;
    inboxRender();
    return true;
  }
  if (state.busy.has(plan.rowId)) return false;
  perform(plan);
  return true;
}

function onListKey(e) {
  if (e.target !== state.root?.list) return; // the note field handles its own keys
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  let dir = 0;
  if (e.key === 'j' || e.key === 'ArrowDown') dir = 1;
  else if (e.key === 'k' || e.key === 'ArrowUp') dir = -1;
  if (dir) {
    e.preventDefault();
    const next = moveFocus(state.model, state.focusId, dir);
    if (next && next !== state.focusId) {
      state.focusId = next;
      state.ghost = rowOf(state.model, next);
      inboxRefresh();
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    runKey('Enter');
  } else if (e.key === ' ') {
    e.preventDefault();
    const r = rowOf(state.model, state.focusId);
    if (r?.kind === 'approval') {
      if (state.expanded.has(r.id)) state.expanded.delete(r.id); else state.expanded.add(r.id);
      inboxRender();
    }
  }
}

// ---------------------------------------------------------------- commands

let commandsRegistered = false;

/** inbox.approve / deny / release / pause / open, active while the inbox is. */
export function registerInboxCommands(regFn) {
  const page = !regFn;
  if (page && commandsRegistered) return;
  if (page) commandsRegistered = true;
  const reg = regFn ?? register;
  const when = (ctx) => ctx?.view === 'inbox' && state.root !== null;
  reg({ id: 'inbox.approve', title: 'Approve the focused request (on a run need: acknowledge it)', icon: 'approve', keys: ['a'], tier: 'ask', when, run: () => runKey('a') });
  reg({ id: 'inbox.deny', title: 'Deny the focused request', icon: 'deny', keys: ['d'], tier: 'click', when, run: () => runKey('d') });
  reg({ id: 'inbox.release', title: 'Release to the terminal', icon: 'chev-r', keys: ['r'], tier: 'click', when, run: () => runKey('r') });
  reg({ id: 'inbox.pause', title: 'Pause the focused lane', icon: 'pause', keys: ['p'], tier: 'click', when, run: () => runKey('p') });
  reg({ id: 'inbox.open', title: 'Open the focused row', icon: 'chev-r', keys: ['Enter'], palette: false, when, run: () => runKey('Enter') });
}

// ---------------------------------------------------------------- the view

export default {
  id: 'inbox',
  icon: 'inbox',
  title: 'Inbox',
  mount: (el, ctx = {}) => {
    if (!el) return;
    registerInboxCommands();
    el.textContent = '';
    state.ctx = ctx;
    const p = panel({ name: 'INBOX', scope: inboxScopeOf(ctx.route) });
    const list = document.createElement('div');
    list.className = 'inbox';
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Inbox');
    list.addEventListener('keydown', onListKey);
    p.body.append(list);
    el.append(p.root);
    state.root = { el, panel: p, list };
    mountReview();
    inboxRefresh();
    state.timer = setInterval(tickTimers, 1000);
    refreshRuns();
    state.runsTimer = setInterval(refreshRuns, RUNS_POLL_MS);
    setTimeout(() => focusList(), 0);
  },
  unmount: () => {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (state.runsTimer) clearInterval(state.runsTimer);
    state.runsTimer = null;
    try { state.review?.handle.unmount(); } catch { /* already gone */ }
    state.review = null;
    if (state.root) state.root.el.textContent = '';
    state.root = null;
    state.model = null;
    state.noteFor = null;
  },
  update: (_store, ctx = {}) => {
    if (!state.root) return;
    if (ctx.route) state.ctx = { ...state.ctx, route: ctx.route };
    // While the deny note is open, a redraw would eat the typed text.
    if (state.noteFor) { compute(); return; }
    inboxRefresh();
  },
};
