// Per-session signal ring (plan §7.3.1). Every hook event leaves a small,
// hashed trace here so the stuck detector (§7 O4) can spot loops without the
// raw tool input ever leaving the builder: only hashes and the existing
// one-line summary are kept.
//
// Pure in-memory state, keyed by Claude's session_id. No imports from state.mjs
// (state.prune calls prune(liveIds) the other way round, O3).
import crypto from 'node:crypto';
import { oneLine } from '../util.mjs';

export const RING_SIZE = 64;
export const COST_MIN_GAP_MS = 60 * 1000;          // at most one cost sample per minute
export const COST_KEEP_MS = 2 * 60 * 60 * 1000;    // 2 h of cost samples
export const COMPACTIONS_KEEP = 16;                // newest PostCompact timestamps kept
const STABLE_JSON_MAX = 4096;
const ERROR_NORM_MAX = 400;
const ERR_TEXT_MAX = 160;

/** Fixed-size ring, oldest first on read. */
class Ring {
  constructor(cap) { this.cap = cap; this.buf = []; this.start = 0; }
  push(v) {
    if (this.buf.length < this.cap) this.buf.push(v);
    else { this.buf[this.start] = v; this.start = (this.start + 1) % this.cap; }
  }
  toArray() { return [...this.buf.slice(this.start), ...this.buf.slice(0, this.start)]; }
  get size() { return this.buf.length; }
}

/** sessionId -> {ring, counters, cost: [{t, usd}]} */
const sessions = new Map();

function freshCounters() {
  return { tools: 0, fails: 0, perms: 0, denied: 0, subagentsLive: 0, compactions: [], lastEventAt: null, lastSubagentAt: null };
}

function slot(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { ring: new Ring(RING_SIZE), counters: freshCounters(), cost: [] };
    sessions.set(sessionId, s);
  }
  return s;
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function stableJson(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? String(v) : v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    let out;
    if (Array.isArray(v)) out = v.map(norm);
    else {
      out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    }
    seen.delete(v);
    return out;
  };
  const s = JSON.stringify(norm(value));
  return s === undefined ? '' : s;
}

/** sha1(tool + '\0' + stableJson(input) cut to 4 KB), first 12 hex chars. */
export function inputHash(toolName, toolInput) {
  const json = stableJson(toolInput ?? null).slice(0, STABLE_JSON_MAX);
  return sha1(`${toolName ?? ''}\0${json}`).slice(0, 12);
}

/**
 * Normalise an error text so incidental detail (line numbers, addresses,
 * paths) does not change its identity: lowercase; absolute paths -> P;
 * 0x.. and hex runs of 8+ -> H; digit runs -> N; whitespace collapsed; cut to 400.
 */
export function normaliseError(text) {
  if (text == null) return '';
  return String(text)
    .toLowerCase()
    .replace(/(^|[\s"'`(\[=:,])(?:~|\.{1,2})?\/[^\s"'`()\[\]:,;]+/g, '$1P')
    .replace(/[a-z]:\\[^\s"'`()\[\]:,;]+/g, 'P')
    .replace(/0x[0-9a-f]+/g, 'H')
    .replace(/\b[0-9a-f]{8,}\b/g, 'H')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_NORM_MAX);
}

/** Hash of the normalised error text (first 12 hex chars), or null without text. */
export function errorHash(text) {
  const n = normaliseError(text);
  return n ? sha1(n).slice(0, 12) : null;
}

function asText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'object') {
    if (typeof v.message === 'string' && v.message) return v.message;
    try { return JSON.stringify(v); } catch { return null; }
  }
  return String(v);
}

/**
 * The error text of a failure event, read defensively because the payload
 * field names are undocumented: error, then tool_response.error, then message.
 */
export function errorTextOf(body) {
  if (!body || typeof body !== 'object') return null;
  return asText(body.error) ?? asText(body.tool_response?.error) ?? asText(body.message) ?? null;
}

const FAILURE_EVENTS = new Set(['PostToolUseFailure', 'StopFailure']);

/** True for the events whose payload carries an error text. */
export function isFailureEvent(name) { return FAILURE_EVENTS.has(name); }

// Same one-liner as hooks.summariseToolInput (kept local: hooks imports this module).
function summarise(input) {
  if (!input || typeof input !== 'object') return null;
  const first =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    input.prompt ?? input.query ?? input.description ?? null;
  if (first != null) return oneLine(first, 160);
  return oneLine(JSON.stringify(input), 160);
}

/**
 * Record one hook event. Called by hooks.ingest for every event, before
 * classify. Returns the ring entry, or null when the payload has no session.
 * Entry: {t, ev, tool, inHash, errHash, errText} plus `kind` (Notification)
 * and `summary` (PermissionRequest).
 */
export function note(body, now = Date.now()) {
  const sessionId = body?.session_id;
  if (!sessionId || typeof sessionId !== 'string') return null;
  const ev = typeof body.hook_event_name === 'string' ? body.hook_event_name : 'unknown';
  const s = slot(sessionId);
  const c = s.counters;
  const tool = typeof body.tool_name === 'string' ? body.tool_name : null;
  const entry = { t: now, ev, tool, inHash: null, errHash: null, errText: null };
  if (tool && body.tool_input !== undefined) entry.inHash = inputHash(tool, body.tool_input);
  if (FAILURE_EVENTS.has(ev)) {
    const text = errorTextOf(body);
    entry.errHash = errorHash(text);
    entry.errText = text ? oneLine(text, ERR_TEXT_MAX) : null;
  }
  if (ev === 'Notification') entry.kind = body.matcher || body.notification_type || body.subtype || null;

  switch (ev) {
    case 'PreToolUse': c.tools++; break;
    case 'PostToolUseFailure': c.fails++; break;
    case 'PermissionRequest': c.perms++; entry.summary = summarise(body.tool_input); break;
    case 'PermissionDenied': c.denied++; break;
    case 'SubagentStart': c.subagentsLive++; c.lastSubagentAt = now; break;
    case 'SubagentStop': c.subagentsLive = Math.max(0, c.subagentsLive - 1); c.lastSubagentAt = now; break;
    case 'PostCompact':
      c.compactions.push(now);
      if (c.compactions.length > COMPACTIONS_KEEP) c.compactions.splice(0, c.compactions.length - COMPACTIONS_KEEP);
      break;
    case 'SessionEnd': c.subagentsLive = 0; break;
    default: break;
  }
  c.lastEventAt = now;
  s.ring.push(entry);
  return entry;
}

/** The ring for a session, oldest first (copies). */
export function recent(sessionId) {
  const s = sessions.get(sessionId);
  return s ? s.ring.toArray().map((e) => ({ ...e })) : [];
}

/** {tools, fails, perms, denied, subagentsLive, compactions:[t...], lastEventAt, lastSubagentAt} */
export function counters(sessionId) {
  const s = sessions.get(sessionId);
  const c = s ? s.counters : freshCounters();
  return { ...c, compactions: [...c.compactions] };
}

/** Sample a session's cumulative cost: at most one sample per minute, 2 h kept. */
export function sampleCost(sessionId, usd, now = Date.now()) {
  if (!sessionId || typeof usd !== 'number' || !Number.isFinite(usd)) return false;
  const s = slot(sessionId);
  const last = s.cost[s.cost.length - 1];
  if (last && now - last.t < COST_MIN_GAP_MS) return false;
  s.cost.push({ t: now, usd });
  const cutoff = now - COST_KEEP_MS;
  let drop = 0;
  while (drop < s.cost.length && s.cost[drop].t < cutoff) drop++;
  if (drop) s.cost.splice(0, drop);
  return true;
}

/** usd of the newest cost sample taken at or before t, or null. */
export function costAt(sessionId, t) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  for (let i = s.cost.length - 1; i >= 0; i--) if (s.cost[i].t <= t) return s.cost[i].usd;
  return null;
}

/** Drop every session not in liveIds (a Set or an iterable of session ids). */
export function prune(liveIds) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds ?? []);
  for (const id of [...sessions.keys()]) if (!live.has(id)) sessions.delete(id);
}

/** Session ids currently tracked (tests, diagnostics). */
export function sessionIds() { return [...sessions.keys()]; }

/** Test helper: forget everything. */
export function _reset() { sessions.clear(); }
