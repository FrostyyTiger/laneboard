// Alarms (fleet plan §7.3.5, O8): derive / reconcile / ack. REVIEW-REQUIRED (SR20).
//
// One pure model for both modes: the hub derives alarms from its fleet store
// view (server/hub/routes/alarms.mjs), a standalone builder derives them from
// a "fleet of one" built from its own snapshot (server/routes/alarms.mjs,
// fleetOfOne below). Persistence lives in alarms-store.mjs.
//
//   Alarm = {id, kind, priority:'P1'|'P2'|'P3'|'P4', builder, target, text,
//            since, acked, ackedBy, ackedAt, cleared}
//
// - Ids are deterministic: the same (kind, builder, target[, sub]) always
//   gives the same id, so deriving again is idempotent. The id is built so it
//   always matches the dispatcher's alarm-id rule
//   (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, server/fleet/dispatch.mjs), which
//   has no '/': `${kind}:${enc(builder)}:${enc(target)}[:${enc(sub)}]`, where
//   enc() keeps [A-Za-z0-9.-] and writes every other UTF-8 byte as `_hh`
//   (injective, so distinct inputs never share an id). An id that would pass
//   128 chars is `${kind}.${sha256 hex[0..32]}` instead (a '.' never follows a
//   kind in the long form). Clients read `builder`/`target` from the alarm,
//   never from the id.
// - Lifecycle (reconcile): derived but not live -> raised (since = now,
//   unacked); derived and live -> keeps since/acked/ackedBy/ackedAt, takes the
//   new text/priority; live but no longer derived -> cleared (cleared = now)
//   and dropped from the live set. A later raise is a new, unacked instance.
// - Inputs are read defensively: a missing or oddly typed field means "no
//   alarm of that kind", never a throw (INTEGRATION-REPORT: `activity.failure`
//   and `danger` are partly unverified field names).
// - Everything builder-supplied that lands in an alarm (`text`, `target`) is
//   plain text: control characters are stripped and lengths capped here, and
//   the UI renders it with textContent only. Nothing here interprets it.
//
// Pure: no IO, no timers, no config import (ALARM_KINDS comes from the config
// fragment, which imports only node:path). Safe to import on the hub.
import crypto from 'node:crypto';
import { ALARM_KINDS } from '../config/observability.mjs';
import { BUILDER_ID_RX, parseFkey } from './keys.mjs';

/** kind -> priority (§7.3.5). `stuck` is P2 for STUCK_P2_RULES, else P3. */
export const KINDS = Object.freeze({
  'danger': 'P1', 'builder-down': 'P1', 'budget-exceeded': 'P1', 'audit-fork': 'P1',
  'approval': 'P2', 'needs-input': 'P2', 'blocked': 'P2', 'failed': 'P2', 'stuck': 'P2|P3',
  'health-crit': 'P2', 'ci-red-main': 'P2',
  'builder-stale': 'P3', 'health-warn': 'P3', 'ci-red': 'P3', 'conflict': 'P3', 'review-overdue': 'P3',
  'review': 'P4', 'budget-warn': 'P4', 'reboot': 'P4',
});

// The config fragment's list must be exactly these kinds (test/alarms.test.mjs
// checks too); a mismatch is a wiring bug, caught at import.
if (ALARM_KINDS.length !== Object.keys(KINDS).length || !ALARM_KINDS.every((k) => Object.hasOwn(KINDS, k))) {
  throw new Error('alarms: KINDS and config/observability ALARM_KINDS disagree');
}

export const PRIORITIES = Object.freeze(['P1', 'P2', 'P3', 'P4']);
export const STUCK_P2_RULES = Object.freeze(['approval-wait', 'error-loop', 'tool-loop']);
/** Kinds only the hub can see (connection state, audit reconciliation, review waits). */
export const LINK_KINDS = Object.freeze(['builder-down', 'builder-stale', 'audit-fork', 'review-overdue']);

/**
 * The annunciator's kind -> tile map (§4 2.5; the UI's copy is
 * public/js/core/alarm-tiles.js KIND_TO_TILE, §4 D7). `review`, `reboot` and
 * `health-warn` have no tile (runs night 4 T38: DOWN is not a reboot hint).
 * Used by ackMany for `ack-alarm *` with `{tile}`.
 */
export const KIND_TO_TILE = Object.freeze({
  'needs-input': 'NEED', 'review-overdue': 'NEED',
  'approval': 'APPR',
  'blocked': 'BLKD', 'failed': 'BLKD', 'danger': 'BLKD',
  'stuck': 'STCK',
  'ci-red-main': 'CI-F', 'ci-red': 'CI-F',
  'builder-down': 'DOWN', 'builder-stale': 'DOWN', 'health-crit': 'DOWN', 'audit-fork': 'DOWN',
  'budget-warn': 'BUDG', 'budget-exceeded': 'BUDG',
  'conflict': 'CONF',
});
export const TILES = Object.freeze(['NEED', 'APPR', 'BLKD', 'STCK', 'CI-F', 'DOWN', 'BUDG', 'CONF']);

/** The dispatcher's alarm-id rule (server/fleet/dispatch.mjs ALARM_ID_RE), mirrored. */
export const ALARM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const TEXT_MAX = 300;
export const TARGET_MAX = 200;
/** Upper bound on live alarms (worst priorities kept): builders are untrusted. */
export const MAX_ALARMS = 5000;

const ID_MAX = 128;
const SAFE_CHAR = /[A-Za-z0-9.-]/;
// C0 (tab and newline included: alarm text is one line), DEL, C1, bidi overrides/isolates.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Builder text as one plain line: no control chars, well-formed, capped. Never interpreted. */
export function cleanText(v, max = TEXT_MAX) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  else return '';
  s = s.slice(0, max * 2).toWellFormed().replace(CONTROL_RE, ' ').replace(/ {2,}/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function enc(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (SAFE_CHAR.test(ch)) { out += ch; continue; }
    for (const b of Buffer.from(ch, 'utf8')) out += `_${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** Deterministic alarm id; always matches ALARM_ID_RE. */
export function alarmId(kind, builder, target, sub) {
  const parts = [kind, enc(builder ?? ''), enc(target ?? '')];
  if (sub !== undefined && sub !== null && sub !== '') parts.push(enc(sub));
  const id = parts.join(':');
  if (id.length <= ID_MAX && ALARM_ID_RE.test(id)) return id;
  const h = crypto.createHash('sha256')
    .update(JSON.stringify([kind, builder ?? '', target ?? '', sub ?? '']))
    .digest('hex').slice(0, 32);
  return `${kind}.${h}`;
}

/** Priority of a kind; `stuck` takes the rule into account. */
export function priorityOf(kind, rule) {
  const p = KINDS[kind];
  if (!p) return null;
  if (kind === 'stuck') return STUCK_P2_RULES.includes(rule) ? 'P2' : 'P3';
  return p;
}

const PRANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
/** Sort: priority, then oldest first, then id (stable output for the wire and tests). */
export function compareAlarms(a, b) {
  return (PRANK[a.priority] ?? 9) - (PRANK[b.priority] ?? 9)
    || (a.since ?? 0) - (b.since ?? 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function make(kind, builder, target, text, now, { sub, rule } = {}) {
  const tgt = target === null || target === undefined ? null : cleanText(target, TARGET_MAX);
  return {
    id: alarmId(kind, builder, tgt, sub === undefined ? undefined : cleanText(sub, TARGET_MAX)),
    kind,
    priority: priorityOf(kind, rule),
    builder: builder ?? null,
    target: tgt,
    text: cleanText(text),
    since: now,
    acked: false,
    ackedBy: null,
    ackedAt: null,
    cleared: null,
  };
}

// --- fleet view accessors (tolerant of the store's Maps and the wire's arrays/objects)

function listOf(v) {
  if (Array.isArray(v)) return v;
  if (v instanceof Map) return [...v.values()];
  return [];
}

function liveMarker(s, kind) {
  const m = s?.lastMarker;
  if (!isObj(m) || m.kind !== kind || m.dismissed_at) return null;
  // A marker older than a move back to `working` has been answered.
  const ts = isNum(m.ts) ? m.ts : null;
  if (s.state === 'working' && ts !== null && isNum(s.stateSince) && s.stateSince > ts) return null;
  return m;
}

function sessionAlarms(id, s, add, now) {
  const name = s?.name;
  if (!isStr(name)) return;
  if (s.danger) {
    const why = typeof s.danger === 'string' ? s.danger : (s.danger.reason ?? s.danger.text ?? s.danger.kind);
    add(make('danger', id, name, `danger: ${cleanText(why) || 'guard finding'}`, now));
  }
  if (s.awaitingApproval) {
    add(make('approval', id, name, 'waiting for approval', now));
  }
  if (s.state === 'waiting_question') {
    add(make('needs-input', id, name, 'waiting for an answer', now));
  } else {
    const need = liveMarker(s, 'need');
    if (need) add(make('needs-input', id, name, need.text || 'needs input', now));
  }
  const blocked = liveMarker(s, 'blocked');
  if (blocked) add(make('blocked', id, name, blocked.text || 'blocked', now));
  const f = s.activity?.failure;
  if (f) {
    const t = isObj(f) ? [f.type, f.text].filter((x) => typeof x === 'string' && x).join(': ') : f;
    add(make('failed', id, name, cleanText(t) || 'stopped on a failure', now));
  }
  if (isObj(s.stuck)) {
    const rule = typeof s.stuck.rule === 'string' ? s.stuck.rule : null;
    add(make('stuck', id, name, s.stuck.reason || rule || 'stuck', now, { rule }));
  }
}

const BUDGET_EXCEEDED = new Set(['exceeded', 'over', 'pause', 'paused', 'crit']);

// The hub's fleet store deletes every `key` field from builder data at any
// depth (routing keys, SECURITY-FIXES S2), so on the hub a health alarm
// arrives as {level, text} only. Its threshold key is recovered from the
// collector's fixed text (server/collector/health.mjs LABEL), so the hub and a
// standalone builder give the same id. Unknown text falls back to the text
// with its numbers masked, which stays stable while a value moves.
const HEALTH_TEXT_KEYS = [
  [/^swap-in /, 'swapInPerSec'], [/^memory available /, 'memAvailPct'], [/^memory pressure /, 'psiMemFull10'],
  [/^io pressure /, 'psiIoFull10'], [/^cpu pressure /, 'psiCpuSome10'], [/^load .* per cpu$/, 'loadPerCpu'],
  [/docker container\(s\) unhealthy$/, 'dockerUnhealthy'], [/^reboot required$/, 'rebootRequired'],
];

export function healthKeyOf(a) {
  for (const f of ['key', 'metric', 'name']) if (isStr(a?.[f])) return a[f];
  const text = cleanText(a?.text, 120);
  if (!text) return null;
  const disk = /^disk (\S+) [\d.]+% used$/.exec(text);
  if (disk) return `fsUsedPct:${disk[1]}`;
  for (const [re, k] of HEALTH_TEXT_KEYS) if (re.test(text)) return k;
  return text.replace(/\d+(\.\d+)?/g, '#');
}

function builderAlarms(b, add, now) {
  const id = b.id;
  const state = b.state ?? b.conn?.state;
  if (state === 'down') add(make('builder-down', id, null, `builder ${id} is down`, now));
  else if (state === 'stale') add(make('builder-stale', id, null, `builder ${id} is stale`, now));
  else if (state === 'misconfigured' || state === 'incompatible') add(make('builder-stale', id, null, `builder ${id} is ${state}`, now));

  const snap = isObj(b.snap) ? b.snap : null;
  if (!snap) return;
  const sessions = listOf(snap.sessions);
  const byName = new Map();
  for (const s of sessions) {
    if (!isObj(s)) continue;
    if (isStr(s.name)) byName.set(s.name, s);
    sessionAlarms(id, s, add, now);
  }
  // Attention entries can say what the session object does not (the wire's
  // attention list keeps state and the danger reason).
  for (const a of listOf(snap.attention)) {
    if (!isObj(a) || !isStr(a.name)) continue;
    if (a.state === 'waiting_question') add(make('needs-input', id, a.name, 'waiting for an answer', now));
    if (a.danger && !byName.get(a.name)?.danger) add(make('danger', id, a.name, `danger: ${cleanText(a.danger) || 'guard finding'}`, now));
  }
  for (const ap of listOf(snap.approvals)) {
    if (!isObj(ap) || (ap.status !== undefined && ap.status !== 'pending')) continue;
    const name = isStr(ap.name) ? ap.name : null;
    const what = cleanText(ap.summary ?? ap.tool ?? '') || 'waiting for approval';
    if (name) add(make('approval', id, name, what, now));
    else if (isStr(ap.id)) add(make('approval', id, null, what, now, { sub: ap.id }));
  }
  for (const l of listOf(snap.lanes)) {
    if (!isObj(l) || !isStr(l.id)) continue;
    if (l.reviewReady?.ready === true) add(make('review', id, l.id, 'ready for review', now));
  }

  const h = isObj(snap.health) ? snap.health : null;
  if (h) {
    if (Array.isArray(h.alarms)) {
      for (const a of h.alarms) {
        const key = isObj(a) ? healthKeyOf(a) : null;
        if (!key) continue;
        if (key === 'rebootRequired') add(make('reboot', id, key, a.text || 'reboot required', now));
        else if (a.level === 'crit') add(make('health-crit', id, key, a.text || key, now));
        else if (a.level === 'warn') add(make('health-warn', id, key, a.text || key, now));
      }
    } else if (h.rebootRequired === true) {
      add(make('reboot', id, 'rebootRequired', 'reboot required', now));
    }
  }

  // §8 C7 snapshot key `budget`: [{scope, key, usd, limit, pct, level}]. The
  // hub's store strips `key` (see above), so `lane` is read first; a
  // builder-scope entry is a builder-level alarm (target null).
  for (const e of listOf(snap.budget)) {
    if (!isObj(e)) continue;
    const target = e.scope === 'builder' ? null : [e.lane, e.target, e.key, e.scope].find(isStr) ?? null;
    const pct = isNum(e.pct) ? ` (${Math.round(e.pct)}%)` : '';
    if (e.level === 'warn') add(make('budget-warn', id, target, `budget ${cleanText(e.scope) || 'warning'}${pct}`, now));
    else if (BUDGET_EXCEEDED.has(e.level)) add(make('budget-exceeded', id, target, `budget exceeded${pct}`, now));
  }
}

function fkeyParts(k) {
  const p = parseFkey(k);
  return p ? [p.builder, p.name] : null;
}

function packageAlarms(pk, add, now) {
  if (!isObj(pk)) return;
  for (const row of listOf(pk.rows)) {
    if (!isObj(row)) continue;
    const pkg = `${cleanText(row.repo, 64) || '?'}/${cleanText(row.package, 64) || '?'}`;
    if (row.main?.status === 'fail') {
      const why = Array.isArray(row.reasons) ? row.reasons.find((r) => typeof r === 'string' && r.startsWith('main red')) : null;
      add(make('ci-red-main', null, pkg, why || `main red: ${pkg}`, now));
    }
    for (const pr of listOf(row.prs)) {
      if (!isObj(pr) || pr.verdict !== 'red') continue;
      const p = fkeyParts(pr.fkey);
      if (!p) continue;
      add(make('ci-red', p[0], p[1], `PR${isNum(pr.n) ? ` #${pr.n}` : ''} red`, now));
    }
  }
  for (const e of listOf(pk.edges)) {
    if (!isObj(e) || e.kind !== 'textual') continue;
    const a = fkeyParts(e.a);
    if (!a || typeof e.b !== 'string') continue;
    const other = e.b.startsWith('main:') ? 'main' : e.b;
    add(make('conflict', a[0], a[1], `textual conflict with ${cleanText(other, 120)}`, now, { sub: e.b }));
  }
}

/**
 * Derive the alarms of a fleet view. Pure.
 *   fleet: {builders:[{id, state, conn?, snap:{sessions, attention, lanes,
 *     approvals, health, budget}}], packages?:{rows, edges},
 *     reviewWaits?:[{fkey, waitingMs}] (overdue waits, §7 O10),
 *     auditForks?:[{builder, text?}] (§3 H13)}
 *   cfg: reserved (thresholds are applied upstream), may be omitted.
 * Returns Alarm[] (one per id, sorted by compareAlarms), at most MAX_ALARMS.
 */
export function derive(fleet, now, cfg = {}) { // eslint-disable-line no-unused-vars
  const out = new Map();
  const add = (a) => {
    if (!a.priority) return;
    const cur = out.get(a.id);
    // Two sources for one id (attention + session): keep the more urgent one.
    if (!cur || (PRANK[a.priority] < PRANK[cur.priority])) out.set(a.id, a);
  };
  if (!isObj(fleet)) return [];
  for (const b of listOf(fleet.builders)) {
    if (!isObj(b) || typeof b.id !== 'string' || !BUILDER_ID_RX.test(b.id)) continue;
    try { builderAlarms(b, add, now); } catch { /* one builder's odd data never breaks the others */ }
  }
  try { packageAlarms(fleet.packages, add, now); } catch { /* same */ }
  for (const w of listOf(fleet.reviewWaits)) {
    const p = isObj(w) ? fkeyParts(w.fkey) : null;
    if (!p) continue;
    const h = isNum(w.waitingMs) ? ` for ${Math.floor(w.waitingMs / 3_600_000)} h` : '';
    add(make('review-overdue', p[0], p[1], `review waiting${h}`, now));
  }
  for (const f of listOf(fleet.auditForks)) {
    const bid = isObj(f) ? f.builder : f;
    if (typeof bid !== 'string' || !BUILDER_ID_RX.test(bid)) continue;
    add(make('audit-fork', bid, null, (isObj(f) && f.text) || `audit chain of ${bid} was rewritten after an anchor`, now));
  }
  const list = [...out.values()].sort(compareAlarms);
  return list.length > MAX_ALARMS ? list.slice(0, MAX_ALARMS) : list;
}

/**
 * Reconcile the live map with a fresh derivation. Pure: `prev` is not changed.
 *   prev: Map id -> Alarm; derived: Alarm[]; opts.hold(alarm) -> true keeps a
 *   live alarm that is not derived (e.g. its builder has not reported yet
 *   after a hub restart), without clearing it.
 * -> {next: Map, raised: Alarm[], cleared: Alarm[]}
 */
export function reconcile(prev, derived, now, opts = {}) {
  const before = prev instanceof Map ? prev : new Map();
  const hold = typeof opts.hold === 'function' ? opts.hold : null;
  const next = new Map();
  const raised = [];
  const cleared = [];
  for (const d of Array.isArray(derived) ? derived : []) {
    if (!isObj(d) || typeof d.id !== 'string' || next.has(d.id)) continue;
    const p = before.get(d.id);
    if (p) {
      next.set(d.id, { ...d, since: p.since, acked: p.acked === true, ackedBy: p.ackedBy ?? null, ackedAt: p.ackedAt ?? null, cleared: null });
    } else {
      const a = { ...d, since: now, acked: false, ackedBy: null, ackedAt: null, cleared: null };
      next.set(d.id, a);
      raised.push(a);
    }
  }
  for (const [id, p] of before) {
    if (next.has(id)) continue;
    let keep = false;
    if (hold) { try { keep = hold(p) === true; } catch { keep = false; } }
    if (keep) { next.set(id, p); continue; }
    cleared.push({ ...p, cleared: now });
  }
  return { next, raised, cleared };
}

/** An ack refusal (unknown id, bad scope). `status`/`code` follow the dispatcher's conventions. */
export class AlarmError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'AlarmError';
    this.status = status;
    this.code = code;
  }
}

function cleanUser(user) {
  const u = cleanText(user, 128);
  return u || 'unknown';
}

/**
 * Ack one live alarm (in place: the map entry is replaced with the acked
 * copy). Already acked: returned unchanged. Unknown: an AlarmError (404).
 */
export function ack(map, id, user, now) {
  const a = map instanceof Map && typeof id === 'string' ? map.get(id) : undefined;
  if (!a) return new AlarmError(404, 'unknown_alarm', 'unknown alarm');
  if (a.acked) return a;
  const next = { ...a, acked: true, ackedBy: cleanUser(user), ackedAt: now };
  map.set(id, next);
  return next;
}

/**
 * Ack every unacked live alarm in scope (target `*`): `tile` (via kindToTile)
 * and/or `builder`; no scope = all. Returns the newly acked alarms.
 */
export function ackMany(map, { tile, builder } = {}, user, now, kindToTile = KIND_TO_TILE) {
  const out = [];
  if (!(map instanceof Map)) return out;
  const who = cleanUser(user);
  for (const [id, a] of map) {
    if (a.acked) continue;
    if (tile !== undefined && tile !== null && kindToTile?.[a.kind] !== tile) continue;
    if (builder !== undefined && builder !== null && a.builder !== builder) continue;
    const next = { ...a, acked: true, ackedBy: who, ackedAt: now };
    map.set(id, next);
    out.push(next);
  }
  return out;
}

/**
 * The FleetView of a standalone builder: one `up` builder whose snap is this
 * builder's own snapshot plus its latest health sample. derive() over it
 * gives the hub's alarms for this builder, minus LINK_KINDS.
 *   snapshot: state.snapshot() (optionally with `builder:{id, code}`)
 *   health: collector/health.mjs latest() or null
 *   opts.builder: {id, code} (wins over snapshot.builder); opts.packages:
 *     the standalone packages data {rows, edges} when there is one.
 */
export function fleetOfOne(snapshot, health, now, opts = {}) {
  const snap = isObj(snapshot) ? snapshot : {};
  const who = isObj(opts.builder) ? opts.builder : (isObj(snap.builder) ? snap.builder : {});
  const id = typeof who.id === 'string' && BUILDER_ID_RX.test(who.id) ? who.id : 'builder';
  const view = {
    now,
    builders: [{
      id,
      code: typeof who.code === 'string' ? who.code : null,
      state: 'up',
      stale: false,
      snap: {
        sessions: listOf(snap.sessions),
        lanes: listOf(snap.lanes),
        attention: listOf(snap.attention),
        approvals: listOf(snap.approvals),
        budget: snap.budget ?? null,
        repos: snap.repos ?? null,
        health: isObj(health) ? health : (isObj(snap.health) ? snap.health : null),
      },
    }],
  };
  if (isObj(opts.packages)) view.packages = opts.packages;
  return view;
}
