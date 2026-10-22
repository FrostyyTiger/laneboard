// The Inbox model (fleet plan §8 2.9, task C13). Pure: no DOM, no globals,
// importable by node --test (test/inbox-model.test.mjs).
//
//   buildInbox(store, {now, scope, review, ghost}) -> {groups, order, rows, count}
//   keyAction(key, focusId, model)                 -> plan | {none: reason}
//   ackEvent(plan)                                 -> the needs.ack event to post
//   moveFocus(model, focusId, dir)                 -> row id | null
//   effectiveTier(action, liveTier)                -> read|click|ask|confirm
//
// Groups, in order: approvals (pending PermissionRequests from every builder,
// oldest first, countdown to expiresAt), needs (waiting_* sessions from the
// attention list, the dev-stack guard, need/blocked markers), runs (runs plan
// T5: the open needs of agent loops from GET /api/runs, newest first; absent
// when there is no runs route, e.g. on a hub), review (§10's reviewReady lanes,
// rows from core/review-queue.js), runprs (the runs' recent PRs: news, so after
// review), paused (with kind), and stale (stuck sessions with their reason,
// archive candidates, §6's stale branches; read-only, all grey). Runs night 4
// T16: the groups with rows come first in that order, the empty ones after
// them (`empty: true`, the view draws one muted line each).
//
// Everything a builder sent is untrusted text. This module only type-checks
// it, copies it into fresh objects and clips its length; the view renders it
// with textContent and nothing else.
//
// Keys act on the FOCUSED ROW'S ID, never on "the first one": a list that
// re-sorts must not change what a key hits. A focused approval that is no
// longer pending stays in the list as a closed ghost row (the view passes the
// last row it saw as `ghost`) and every action key on it does nothing.

import { fkey as makeFkey, BUILDER_ID_RX } from './keys.js';
import { markP, markWord } from './marks.js';

export const GROUPS = Object.freeze(['approvals', 'needs', 'runs', 'review', 'runprs', 'paused', 'stale']);

export const GROUP_TITLES = Object.freeze({
  approvals: 'Approvals',
  needs: 'Needs you',
  runs: 'Run needs',
  review: 'Review',
  runprs: 'Run PRs',
  paused: 'Paused',
  stale: 'Archive / stale',
});

/** Security review S7: the note on the approvals group header (title + aria). */
/** The one line an empty group shows: "Review · none". */
export const emptyLine = (title) => `${title} · none`;

export const COOPERATIVE_NOTE = 'Approvals, pause, budget and kill are cooperative on the builder: an agent with a shell there can bypass them';

/** README §3.5: approve/deny/release are remoteOnly. */
export const REMOTE_ONLY_NOTE = 'Approve, deny and release are remote-only: the builder refuses them from its local API, so an agent cannot approve its own request that way.';

/** Clip sizes for untrusted text. */
export const LIMITS = Object.freeze({
  summary: 200,
  name: 200,
  tool: 128,
  input: 4000,
  previewLines: 60,
  previewLine: 300,
  reason: 200,
  note: 500,
});

/** The run protocol's id (server/runs/protocol.mjs RUN_ID): other ids get no row. */
const RUN_ID_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * A PR artifact with no `state` is listed while its run is live and for this
 * long after the run's last event, then it drops. One with a state follows it:
 * `open` stays, `merged` and `closed` leave at once (README §8 Q10).
 */
export const RUN_PR_FRESH_MS = 24 * 3600_000;
/**
 * A run whose last event is older than this asks nothing any more: its open
 * needs are left out of the Inbox and Morning (server/morning.mjs
 * morningRunNeeds), so an old hand-made run cannot top the list.
 */
export const RUN_NEED_MAX_AGE_MS = 7 * 24 * 3600_000;

/** When a run last moved: its last event, else its start, else 0. */
export function runLastAt(r) {
  return isNum(r?.updatedAt) ? r.updatedAt : isNum(r?.startedAt) ? r.startedAt : 0;
}
/** Who an ack from the Inbox names (`needs.ack` `by`). */
export const ACK_BY = 'inbox';

/** The artifact states (server/runs/protocol.mjs ARTIFACT_STATES). */
export const PR_STATES = new Set(['open', 'merged', 'closed']);
const WAITING = new Set(['waiting_permission', 'waiting_question']);
const MARKER_KINDS = new Set(['need', 'blocked']);
/** A marker's word beside its mark: the header tile's word (core/alarm-tiles.js). */
const MARKER_WORD = Object.freeze({ need: 'NEED', blocked: 'BLKD' });

/**
 * What a waiting session asks, in its own words (as Morning and the push
 * body read it): a question is the assistant's last line, a permission the
 * tool and its input. Null when the session sent nothing.
 */
function waitingText(state, activity) {
  if (!activity || typeof activity !== 'object') return null;
  const said = str(activity.lastAssistant);
  if (state === 'waiting_permission') {
    const input = str(activity.toolInput);
    if (input) return `${str(activity.tool) ?? ''} ${input}`.trim();
  }
  return said;
}
const PAUSE_KINDS = new Set(['operator', 'budget', 'quota', 'stuck']);
const TIER_RANK = Object.freeze({ read: 0, click: 1, ask: 2, confirm: 3 });
/**
 * The UI's own floor per action. Approving lets an agent run a tool, so it
 * always gets at least the `ask` dialog (tier 2), whatever the live table says;
 * the server-side tier is unchanged (README §3.5).
 */
export const TIER_FLOOR = Object.freeze({ approve: 'ask' });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

/** A string cut to `n` chars with an ellipsis, or null. Control chars become spaces. */
export function inboxClip(v, n) {
  if (typeof v !== 'string' || v === '') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
}

/** Same as clip, but newlines are kept (for the <pre> of the tool input). */
function clipBlock(v, n) {
  if (typeof v !== 'string' || v === '') return null;
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

const valuesOf = (m) => (m instanceof Map ? [...m.values()] : Array.isArray(m) ? m : m && typeof m === 'object' ? Object.values(m) : []);

function safeFkey(builder, name) {
  if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder) || typeof name !== 'string' || name === '') return null;
  try { return makeFkey(builder, name); } catch { return null; }
}

function inboxInScope(builder, scope) {
  return !scope || scope === 'all' || builder === scope;
}

/** Preview {kind, lines:[{t,s}], truncated} -> a clipped copy, or null. */
export function previewOf(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.lines)) return null;
  const lines = [];
  let truncated = p.truncated === true;
  for (const l of p.lines) {
    if (lines.length >= LIMITS.previewLines) { truncated = true; break; }
    if (!l || typeof l !== 'object') continue;
    const t = l.t === '+' || l.t === '-' ? l.t : ' ';
    lines.push({ t, s: inboxClip(typeof l.s === 'string' ? l.s : '', LIMITS.previewLine) ?? '' });
  }
  return { kind: p.kind === 'diff' ? 'diff' : 'text', lines, truncated };
}

/** The diff-line class for a preview line: d-add, d-del or d-ctx. */
export function lineClass(t) {
  return t === '+' ? 'd-add' : t === '-' ? 'd-del' : 'd-ctx';
}

/** ms -> "4:05" / "0:09" / "expired". */
export function formatCountdown(ms) {
  if (!isNum(ms)) return '';
  if (ms <= 0) return 'expired';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Every session of every builder in scope: [{builder, name, fkey, session}]. */
function inboxSessionsOf(s, scope) {
  const out = [];
  for (const b of valuesOf(s?.builders)) {
    if (!b || !inboxInScope(b.id, scope)) continue;
    for (const sess of valuesOf(b.sessions)) {
      if (!sess || typeof sess !== 'object') continue;
      const k = safeFkey(b.id, sess.name);
      if (k) out.push({ builder: b.id, name: sess.name, fkey: k, session: sess });
    }
  }
  return out;
}

function approvalRows(s, scope, now) {
  const rows = [];
  for (const b of valuesOf(s?.builders)) {
    if (!b || !inboxInScope(b.id, scope)) continue;
    for (const a of valuesOf(b.approvals)) {
      if (!a || typeof a !== 'object' || !str(a.id)) continue;
      if (a.status !== undefined && a.status !== 'pending') continue;
      const session = str(a.session) ?? str(a.name);
      const k = session ? safeFkey(b.id, session) : null;
      if (!k) continue;
      const expiresAt = isNum(a.expiresAt) ? a.expiresAt : null;
      rows.push({
        id: `ap:${b.id}:${a.id}`,
        group: 'approvals',
        kind: 'approval',
        approvalId: a.id,
        builder: b.id,
        fkey: k,
        name: inboxClip(session, LIMITS.name),
        lane: inboxClip(str(a.lane), LIMITS.name),
        p: markP('approval'),
        status: 'pending',
        tool: inboxClip(str(a.tool), LIMITS.tool) ?? '?',
        mcpServer: inboxClip(str(a.mcpServer), LIMITS.tool),
        summary: inboxClip(str(a.summary), LIMITS.summary) ?? '',
        input: clipBlock(str(a.input), LIMITS.input),
        inputTruncated: a.inputTruncated === true,
        preview: previewOf(a.preview),
        createdAt: isNum(a.createdAt) ? a.createdAt : 0,
        expiresAt,
        expiresInMs: expiresAt === null ? null : expiresAt - now,
      });
    }
  }
  rows.sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return rows;
}

function needsRows(s, scope, sessions) {
  const byKey = new Map(sessions.map((e) => [e.fkey, e]));
  const rows = [];
  const seen = new Set();
  const add = (e, extra) => {
    if (seen.has(e.fkey)) return;
    // A held approval is listed in Approvals already.
    if (e.session.awaitingApproval) return;
    seen.add(e.fkey);
    rows.push({
      id: `nd:${e.fkey}`, group: 'needs', kind: 'session', builder: e.builder, fkey: e.fkey,
      name: inboxClip(e.name, LIMITS.name), lane: inboxClip(str(e.session.lane), LIMITS.name),
      state: str(e.session.state), ...extra,
    });
  };
  // The attention list first, in its own order (score desc, since asc).
  for (const a of Array.isArray(s?.attention) ? s.attention : []) {
    if (!a || typeof a !== 'object' || a.stale) continue;
    const k = safeFkey(a.builder, a.name);
    const e = k ? byKey.get(k) : null;
    if (!e) continue;
    const danger = str(a.danger);
    if (!WAITING.has(a.state) && !danger) continue;
    // Runs n5 T27: the Board's word after the shape (`▲ QUES`), then the
    // session's own words; the generic `question` only when it has none.
    const text = danger ?? waitingText(a.state, e.session.activity);
    add(e, {
      p: danger ? markP('danger') : markP(a.state),
      word: markWord({ state: a.state, stuck: e.session.stuck }),
      reason: text ? inboxClip(text, LIMITS.reason) : a.state === 'waiting_permission' ? 'permission' : 'question',
      fallback: !text,
      since: isNum(a.since) ? a.since : 0,
    });
  }
  // Then need/blocked markers, oldest first.
  const marked = sessions.filter((e) => {
    const m = e.session.lastMarker;
    return m && typeof m === 'object' && MARKER_KINDS.has(m.kind) && !m.dismissed_at;
  }).sort((x, y) => (x.session.lastMarker.ts ?? 0) - (y.session.lastMarker.ts ?? 0) || (x.fkey < y.fkey ? -1 : 1));
  for (const e of marked) {
    const m = e.session.lastMarker;
    const text = inboxClip(str(m.text), LIMITS.reason);
    add(e, {
      p: markP(m.kind),
      word: MARKER_WORD[m.kind],
      reason: text ?? m.kind,
      fallback: !text,
      since: isNum(m.ts) ? m.ts : 0,
    });
  }
  return rows;
}

function reviewRows(items) {
  const rows = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || typeof it.fkey !== 'string') continue;
    const first = Array.isArray(it.sessions) ? it.sessions.find((x) => x && typeof x.fkey === 'string') : null;
    rows.push({
      id: `rv:${it.fkey}`, group: 'review', kind: 'lane', builder: it.builder, fkey: it.fkey,
      sessionKey: first ? first.fkey : null,
      name: inboxClip(it.lane, LIMITS.name), lane: inboxClip(it.lane, LIMITS.name), p: '3',
      waitMs: isNum(it.waitMs) ? it.waitMs : 0,
      reason: Array.isArray(it.reasons) ? it.reasons.join(' · ') : '',
      item: it,
    });
  }
  return rows;
}

function pausedRows(sessions) {
  const rows = [];
  for (const e of sessions) {
    const pz = e.session.paused;
    if (!pz || typeof pz !== 'object') continue;
    const kind = PAUSE_KINDS.has(pz.kind) ? pz.kind : 'operator';
    rows.push({
      id: `pz:${e.fkey}`, group: 'paused', kind: 'session', builder: e.builder, fkey: e.fkey,
      name: inboxClip(e.name, LIMITS.name), lane: inboxClip(str(e.session.lane), LIMITS.name),
      p: kind === 'budget' || kind === 'quota' ? '2' : '3',
      pauseKind: kind, scope: pz.scope === 'all' ? 'all' : 'session',
      reason: `${kind}${pz.scope === 'all' ? ' (builder)' : ''}${str(pz.by) ? ` by ${inboxClip(pz.by, 64)}` : ''}`,
      since: isNum(pz.at) ? pz.at : 0,
    });
  }
  rows.sort((x, y) => x.since - y.since || (x.fkey < y.fkey ? -1 : 1));
  return rows;
}

function staleRows(s, scope, sessions) {
  const rows = [];
  // Stuck sessions (§7), with the detector's reason.
  const stuck = sessions.filter((e) => e.session.stuck && typeof e.session.stuck === 'object')
    .sort((x, y) => (x.session.stuck.since ?? 0) - (y.session.stuck.since ?? 0) || (x.fkey < y.fkey ? -1 : 1));
  for (const e of stuck) {
    const st = e.session.stuck;
    rows.push({
      id: `st:${e.fkey}`, group: 'stale', kind: 'stuck', builder: e.builder, fkey: e.fkey,
      // Archive / stale is read-only news (T16): grey, never the amber ▲.
      name: inboxClip(e.name, LIMITS.name), lane: inboxClip(str(e.session.lane), LIMITS.name), p: 'off',
      rule: inboxClip(str(st.rule), 64), reason: inboxClip(str(st.reason), LIMITS.reason) ?? inboxClip(str(st.rule), 64) ?? 'stuck',
      since: isNum(st.since) ? st.since : 0,
    });
  }
  // Archive candidates: readiness.ready lanes whose PR (or branch) is merged.
  for (const b of valuesOf(s?.builders)) {
    if (!b || !inboxInScope(b.id, scope)) continue;
    const box = b.box && typeof b.box === 'object' ? b.box : null;
    const ready = box?.readiness && typeof box.readiness === 'object' ? box.readiness : null;
    if (!ready) continue;
    for (const lane of valuesOf(b.lanes)) {
      if (!lane || typeof lane !== 'object' || !str(lane.id)) continue;
      const r = Object.hasOwn(ready, lane.id) ? ready[lane.id] : null;
      if (!r || r.ready !== true) continue;
      const pr = box.prs && typeof box.prs === 'object' && Object.hasOwn(box.prs, lane.id) ? box.prs[lane.id] : null;
      const merged = lane.merged === true || (pr && typeof pr === 'object' && (pr.state === 'MERGED' || pr.merged === true));
      if (!merged) continue;
      const k = safeFkey(b.id, lane.id);
      if (!k) continue;
      rows.push({
        id: `ar:${k}`, group: 'stale', kind: 'archive', builder: b.id, fkey: k,
        name: inboxClip(lane.id, LIMITS.name), lane: inboxClip(lane.id, LIMITS.name), p: 'off',
        reason: 'merged, ready to retire', since: 0,
      });
    }
  }
  // §6 stale branches, read-only.
  const stale = Array.isArray(s?.packages?.stale) ? s.packages.stale : [];
  for (const x of stale.slice(0, 200)) {
    if (!x || typeof x !== 'object' || !str(x.branch)) continue;
    const lk = str(x.laneFkey);
    const builder = lk ? lk.slice(0, Math.max(0, lk.indexOf('/'))) : null;
    if (builder && !inboxInScope(builder, scope)) continue;
    rows.push({
      id: `sb:${inboxClip(x.repo, 64) ?? ''}:${x.branch}`, group: 'stale', kind: 'branch',
      builder, fkey: lk, name: inboxClip(x.branch, LIMITS.name), lane: null, p: 'off',
      reason: `stale${isNum(x.behind) ? `, ${x.behind} behind` : ''}${x.suggestion === 'retire' ? ', retire' : ''}`,
      since: isNum(x.lastCommitAt) ? x.lastCommitAt : 0,
    });
  }
  return rows;
}

/** The run page's route (views/runs.js runHref). */
export const runPageHref = (id) => `#/runs?run=${encodeURIComponent(id)}`;

/** An absolute http(s) URL, or null. */
function httpHref(v) {
  if (typeof v !== 'string' || v === '' || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

/**
 * Rows from GET /api/runs summaries: every open need a person must answer (a
 * `wait` need is the loop sleeping and is left out; none from a run idle for
 * over RUN_NEED_MAX_AGE_MS) and every PR artifact still
 * to review: `open`, or with no state on a run that is live or had an event in
 * the last RUN_PR_FRESH_MS. Newest first.
 */
function runRows(runs, now) {
  const rows = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || typeof r !== 'object' || typeof r.run !== 'string' || !RUN_ID_RX.test(r.run)) continue;
    const base = { group: 'runs', builder: null, fkey: null, run: r.run, name: r.run, lane: null, href: runPageHref(r.run) };
    const at = runLastAt(r);
    const needs = now - at > RUN_NEED_MAX_AGE_MS ? [] : Array.isArray(r.needs) ? r.needs : [];
    for (const n of needs) {
      if (!n || typeof n !== 'object' || n.open === false || !Number.isInteger(n.i) || n.i < 0) continue;
      const kind = inboxClip(str(n.kind), 32) ?? 'decision';
      if (kind === 'wait') continue;
      rows.push({
        ...base, id: `rn:${r.run}:${n.i}`, kind: 'run-need', needIndex: n.i, needRef: needAckRef(n), p: '2',
        reason: `${kind}: ${inboxClip(str(n.text), LIMITS.reason) ?? ''}`.trim(),
        link: httpHref(n.link), since: isNum(n.ts) ? n.ts : 0,
      });
    }
    const fresh = r.state !== 'stopped' || now - at <= RUN_PR_FRESH_MS;
    for (const a of Array.isArray(r.prs) ? r.prs : []) {
      const link = a && typeof a === 'object' ? httpHref(a.url) : null;
      if (!link) continue;
      const state = PR_STATES.has(a.state) ? a.state : null;
      if (state === 'merged' || state === 'closed' || (state === null && !fresh)) continue;
      rows.push({
        // News, not trouble (README §5): the grey hollow lamp, never a hue.
        ...base, group: 'runprs', id: `rp:${r.run}:${link}`, kind: 'run-pr', p: 'off', lampLabel: 'pr to review',
        // T16: the group head says RUN PRS, so the row is the title alone (no `pr:`)
        reason: inboxClip(str(a.title), LIMITS.reason) ?? inboxClip(link, LIMITS.reason),
        link, since: isNum(a.ts) ? a.ts : 0,
      });
    }
  }
  rows.sort((x, y) => y.since - x.since || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return rows;
}

/**
 * What a `needs.ack` names a need by: its `ts` (epoch ms), since its place `i`
 * shifts when a later-read source holds older needs (the store merges sources
 * by time); the place only for a need without a time. The fold reads a ref at
 * or above 1e9 as a time (server/runs/protocol.mjs MAX_NEED_INDEX).
 */
export function needAckRef(n) {
  return isNum(n?.ts) && n.ts >= 1e12 ? n.ts : n?.i;
}

/** The `needs.ack` event an ack plan posts to POST /api/runs/events (docs/runs.md). */
export function ackEvent(plan) {
  return { v: 1, t: 'needs.ack', run: plan.run, ref: plan.ref, by: ACK_BY };
}

/**
 * The whole inbox from a store-like object ({builders, attention, lanes,
 * packages}). `review` is the review queue (core/review-queue.js
 * buildReviewQueue) the caller computed; `ghost` is the last row the view saw
 * for the focused id, kept as a closed row when its id is gone.
 */
export function buildInbox(s, { now = Date.now(), scope = 'all', review = [], ghost = null, runs = null } = {}) {
  const sessions = inboxSessionsOf(s, scope);
  const runRowsAll = Array.isArray(runs) ? runRows(runs, now) : [];
  const by = {
    approvals: approvalRows(s, scope, now),
    needs: needsRows(s, scope, sessions),
    runs: runRowsAll.filter((r) => r.group === 'runs'),
    review: reviewRows((Array.isArray(review) ? review : []).filter((it) => inboxInScope(it?.builder, scope))),
    runprs: runRowsAll.filter((r) => r.group === 'runprs'),
    paused: pausedRows(sessions),
    stale: staleRows(s, scope, sessions),
  };
  const rows = new Map();
  for (const g of GROUPS) for (const r of by[g]) rows.set(r.id, r);
  if (ghost && typeof ghost === 'object' && typeof ghost.id === 'string' && !rows.has(ghost.id) && GROUPS.includes(ghost.group)) {
    const g = { ...ghost, status: 'closed', closed: true };
    by[g.group].push(g);
    rows.set(g.id, g);
  }
  const shown = GROUPS.filter((id) => (id !== 'runs' && id !== 'runprs') || Array.isArray(runs) || by[id].length).map((id) => ({
    id,
    title: GROUP_TITLES[id],
    note: id === 'approvals' ? COOPERATIVE_NOTE : null,
    rows: by[id],
    empty: by[id].length === 0,
  }));
  const groups = [...shown.filter((g) => !g.empty), ...shown.filter((g) => g.empty)];
  const order = groups.flatMap((g) => g.rows.map((r) => r.id));
  const count = groups.reduce((n, g) => n + g.rows.filter((r) => !r.closed).length, 0);
  return { groups, order, rows, count };
}

/** The row for `id`, or null. */
export function rowOf(model, id) {
  return (typeof id === 'string' && model?.rows?.get(id)) || null;
}

/**
 * j/k: the next/previous row id from `focusId`. An unknown focus starts at the
 * first row (dir > 0) or the last (dir < 0). Stops at the ends.
 */
export function moveFocus(model, focusId, dir = 1) {
  const order = model?.order ?? [];
  if (!order.length) return null;
  const i = order.indexOf(focusId);
  if (i < 0) return dir < 0 ? order[order.length - 1] : order[0];
  return order[Math.max(0, Math.min(order.length - 1, i + (dir < 0 ? -1 : 1)))];
}

/** Keep the focus on its id while that row exists; otherwise the first row. */
export function reconcileFocus(model, focusId) {
  if (rowOf(model, focusId)) return focusId;
  return model?.order?.[0] ?? null;
}

/** The session key a row's pause acts on, or null. */
function sessionTarget(r) {
  if (r.kind === 'approval' || r.kind === 'session' || r.kind === 'stuck') return r.fkey;
  if (r.kind === 'lane') return r.sessionKey ?? null;
  return null;
}

/** The command id each inbox key runs (§4 hotkey table, view-scoped rows). */
export const KEY_COMMANDS = Object.freeze({
  a: 'inbox.approve',
  d: 'inbox.deny',
  r: 'inbox.release',
  p: 'inbox.pause',
  Enter: 'inbox.open',
});

/**
 * Key -> what to do on the FOCUSED row, never another one:
 *   {action, fkey, args, rowId}   send through confirmAction + act()
 *   {action:'deny', needsNote:true, ...}  open the note field first
 *   {open: fkey, rowId}           open in the inspector
 *   {run, rowId}                  open the run page (a runs row, Enter)
 *   {action:'ack', run, ref, rowId}  post ackEvent(plan) (a run need, `a`)
 *   {none: reason}                do nothing
 */
export function keyAction(key, focusId, model) {
  const r = rowOf(model, focusId);
  if (!r) return { none: 'no-focus' };
  if (key === 'Enter') {
    if (r.group === 'runs' || r.group === 'runprs') return { run: r.run, rowId: r.id };
    return r.fkey ? { open: r.fkey, rowId: r.id } : { none: 'no-target' };
  }
  if (key === 'a' && r.kind === 'run-need') {
    if (r.closed) return { none: 'closed' };
    return { action: 'ack', run: r.run, ref: r.needRef ?? r.needIndex, rowId: r.id };
  }
  if (key === 'a' || key === 'd' || key === 'r') {
    if (r.kind !== 'approval') return { none: 'not-an-approval' };
    if (r.closed || r.status !== 'pending') return { none: 'closed' };
    const action = key === 'a' ? 'approve' : key === 'd' ? 'deny' : 'release';
    const plan = { action, fkey: r.fkey, args: { approvalId: r.approvalId }, rowId: r.id };
    if (action === 'deny') plan.needsNote = true;
    return plan;
  }
  if (key === 'p') {
    if (r.closed) return { none: 'closed' };
    if (r.kind === 'session' && r.group === 'paused') return { none: 'already-paused' };
    const t = sessionTarget(r);
    return t ? { action: 'pause', fkey: t, args: {}, rowId: r.id } : { none: 'no-session' };
  }
  return { none: 'unbound' };
}

/** Deny with a note: the plan's args plus the clipped note (empty note -> none). */
export function withNote(plan, note) {
  const n = typeof note === 'string' ? note.trim().slice(0, LIMITS.note) : '';
  const args = { ...plan.args };
  if (n) args.note = n;
  const out = { ...plan, args };
  delete out.needsNote;
  return out;
}

/** The dialog tier for an action: the live tier, raised to TIER_FLOOR. */
export function effectiveTier(action, liveTier) {
  const live = Object.hasOwn(TIER_RANK, liveTier) ? liveTier : 'confirm';
  const floor = Object.hasOwn(TIER_FLOOR, action) ? TIER_FLOOR[action] : null;
  return floor && TIER_RANK[floor] > TIER_RANK[live] ? floor : live;
}
