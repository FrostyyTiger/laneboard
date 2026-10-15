/**
 * Approval queue core (fleet plan §8 2.2).
 *
 * Claude Code's PermissionRequest hook is a synchronous curl to
 * POST /api/hook/permission (C4). The route calls open(), then waits on
 * `wait` (raced with its own timer and the request closing) and writes
 * hookOutput(). Empty output means "no decision": Claude Code shows its
 * normal dialog in the pane, so every failure path falls through to the
 * terminal.
 *
 * Approval: { id, session, lane, sessionId, builder, tool, mcpServer, summary,
 *   input, inputTruncated, preview, cwd, permissionMode, suggestions,
 *   createdAt, expiresAt,
 *   status: 'pending'|'allowed'|'denied'|'released'|'timeout'|'abandoned'|'superseded',
 *   decidedBy, decidedAt, note }
 *
 * Decision (what `wait` resolves to): null for "no decision" (timeout with
 * onTimeout 'prompt', supersede, abandon), otherwise
 *   { approvalId, behavior: 'allow'|'deny'|'release', note, interrupt, who, output }
 * where `output` is hookOutput(decision) ('' for release).
 *
 * In memory only: a restart drops the curl connections, which is "no
 * decision". Every open and close is logged with db.addEvent({type:'approval'}).
 *
 * Security: the tool input is untrusted agent text. `input` is
 * JSON.stringify(tool_input) cut to 4 KB and kept as plain text (escaping is
 * the renderer's job: textContent only); `preview` comes from preview.mjs,
 * which neutralises control characters and caps size. decide() refuses an
 * approval that does not belong to the action's target session (409, S19).
 * Who may call decide() at all (remote-only, S7) is the dispatcher's rule
 * (C6 registers approve/deny/release with remoteOnly: true).
 */
import crypto from 'node:crypto';

import { ActionError } from '../actions.mjs';
import { addEvent } from '../db.mjs';
import { summariseToolInput } from '../collector/hooks.mjs';
import { previewFor, cleanLine } from './preview.mjs';

export const APPROVAL_LIMITS = Object.freeze({
  inputBytes: 4096,
  maxPending: 200,          // more than this → 429, the hook falls through to the dialog
  keepClosed: 200,          // recently closed approvals kept for 409 and the UI
  keepClosedMs: 10 * 60_000,
  minHoldMs: 0,
  maxHoldMs: 1800_000,
  defaultHoldMs: 600_000,
  maxWho: 128,
  maxNote: 500,
  maxField: 512,
  maxSuggestions: 20,
  maxSuggestionBytes: 4096,
});

export const STATUSES = Object.freeze(['pending', 'allowed', 'denied', 'released', 'timeout', 'abandoned', 'superseded']);
const BEHAVIORS = new Set(['allow', 'deny', 'release']);
const SID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** id → { approval, resolve, timer } for pending approvals. */
const open_ = new Map();
/** id → approval for recently closed ones (insertion order = close order). */
const closed = new Map();
const listeners = new Set();

/** Cut a string to at most `max` UTF-8 bytes without splitting a character. */
export function truncateBytes(s, max) {
  const str = String(s ?? '');
  if (Buffer.byteLength(str, 'utf8') <= max) return { text: str, truncated: false };
  const buf = Buffer.from(str, 'utf8');
  let end = Math.max(0, max - 3); // room for '…'
  // Step back over UTF-8 continuation bytes (10xxxxxx).
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString('utf8') + '…', truncated: true };
}

function field(v, max = APPROVAL_LIMITS.maxField) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  return cleanLine(v, max);
}

function cleanWho(who) {
  const w = typeof who === 'string' ? who : who?.user ?? who?.login ?? null;
  const s = field(w, APPROVAL_LIMITS.maxWho);
  return s && s.trim() ? s.trim() : 'unknown';
}

function cleanNote(note) {
  if (note == null || note === '') return null;
  const s = String(note).replace(/\s+/g, ' ').trim();
  return s ? cleanLine(s, APPROVAL_LIMITS.maxNote) : null;
}

function cleanSuggestions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, APPROVAL_LIMITS.maxSuggestions)) {
    if (!s || typeof s !== 'object') continue;
    let json;
    try { json = JSON.stringify(s); } catch { continue; }
    if (Buffer.byteLength(json, 'utf8') > APPROVAL_LIMITS.maxSuggestionBytes) continue;
    out.push(JSON.parse(json)); // a plain-data copy, no prototypes or getters
  }
  return out;
}

function stringifyInput(input) {
  try { return JSON.stringify(input ?? null) ?? 'null'; } catch { return '"[unserialisable input]"'; }
}

function safeCall(fn, arg) {
  if (typeof fn !== 'function') return null;
  try {
    const v = fn(arg);
    return typeof v === 'string' && v ? v : null;
  } catch { return null; }
}

/** A deep copy: callers and listeners never hold the queue's own objects. */
function snapshot(a) {
  return structuredClone(a);
}

function emit(op, approval) {
  const msg = { op, approval: snapshot(approval) };
  for (const fn of listeners) {
    try { fn(msg); } catch { /* a listener never breaks the queue */ }
  }
}

function logEvent(a) {
  addEvent({
    ts: a.status === 'pending' ? a.createdAt : (a.decidedAt ?? Date.now()),
    sessionId: a.sessionId,
    sessionName: a.session,
    type: 'approval',
    subtype: a.status,
    payload: { id: a.id, tool: a.tool, summary: a.summary, lane: a.lane, by: a.decidedBy, note: a.note },
  });
}

function rememberClosed(a) {
  closed.set(a.id, a);
  const cutoff = (a.decidedAt ?? Date.now()) - APPROVAL_LIMITS.keepClosedMs;
  for (const [id, c] of closed) {
    if (closed.size <= APPROVAL_LIMITS.keepClosed && (c.decidedAt ?? 0) >= cutoff) break;
    closed.delete(id);
  }
}

/** Close a pending approval: status, log, notify, resolve `wait`. */
function close(id, status, { who = null, note = null, decision = null, at = Date.now() } = {}) {
  const entry = open_.get(id);
  if (!entry) return null;
  open_.delete(id);
  if (entry.timer) clearTimeout(entry.timer);
  const a = entry.approval;
  a.status = status;
  a.decidedBy = who;
  a.decidedAt = at;
  a.note = note;
  rememberClosed(a);
  logEvent(a);
  emit('close', a);
  entry.resolve(decision);
  return a;
}

function makeDecision(a, behavior, { note = null, interrupt = false, who }) {
  const d = { approvalId: a.id, behavior, note, interrupt: behavior === 'deny' ? Boolean(interrupt) : false, who };
  d.output = hookOutput(d, who);
  return d;
}

/**
 * Open a held PermissionRequest.
 * @param body the hook JSON (session_id, tool_name, tool_input, cwd, permission_mode, permission_suggestions, mcp_server)
 * @param opts { now, timeoutMs, onTimeout: 'prompt'|'deny', nameOf(sessionId), laneOf(name), builder, previewMaxLines, io }
 * @returns { approval, wait: Promise<Decision|null> }
 */
export function open(body, opts = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ActionError('invalid permission request', 400);
  if (body.hook_event_name != null && body.hook_event_name !== 'PermissionRequest') {
    throw new ActionError('not a PermissionRequest', 400);
  }
  const tool = field(body.tool_name, 128);
  if (!tool) throw new ActionError('tool_name missing', 400);
  if (open_.size >= APPROVAL_LIMITS.maxPending) throw new ActionError('too many pending approvals', 429);

  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const holdMs = Number.isFinite(opts.timeoutMs)
    ? Math.max(APPROVAL_LIMITS.minHoldMs, Math.min(APPROVAL_LIMITS.maxHoldMs, opts.timeoutMs))
    : APPROVAL_LIMITS.defaultHoldMs;
  const onTimeout = opts.onTimeout === 'deny' ? 'deny' : 'prompt';

  const sessionId = typeof body.session_id === 'string' && SID_RE.test(body.session_id) ? body.session_id : null;
  const session = sessionId ? safeCall(opts.nameOf, sessionId) : null;
  const lane = session ? safeCall(opts.laneOf, session) : null;
  const cwd = field(body.cwd, 4096);
  const { text: input, truncated: inputTruncated } = truncateBytes(stringifyInput(body.tool_input), APPROVAL_LIMITS.inputBytes);

  let summary = null;
  try { summary = summariseToolInput(body.tool_input); } catch { summary = null; }
  summary = summary ? cleanLine(summary, 200) : null;

  let preview = null;
  try {
    preview = previewFor(tool, body.tool_input, { cwd, maxLines: opts.previewMaxLines, io: opts.io });
  } catch { preview = null; }

  const approval = {
    id: crypto.randomUUID(),
    session,
    lane,
    sessionId,
    builder: field(opts.builder, 64),
    tool,
    mcpServer: field(body.mcp_server, 256),
    summary,
    input,
    inputTruncated,
    preview,
    cwd,
    permissionMode: field(body.permission_mode, 64),
    suggestions: cleanSuggestions(body.permission_suggestions),
    createdAt: now,
    expiresAt: now + holdMs,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    note: null,
  };

  let resolve;
  const wait = new Promise((r) => { resolve = r; });
  const entry = { approval, resolve, timer: null };
  open_.set(approval.id, entry);
  entry.timer = setTimeout(() => {
    if (onTimeout === 'deny') {
      const who = 'laneboard';
      const note = `no decision within ${Math.round(holdMs / 1000)} s`;
      close(approval.id, 'timeout', { who, note, decision: makeDecision(approval, 'deny', { note, who }) });
    } else {
      close(approval.id, 'timeout', { who: null, decision: null });
    }
  }, holdMs);
  entry.timer.unref?.();

  logEvent(approval);
  emit('open', approval);
  return { approval: snapshot(approval), wait };
}

/**
 * Decide a pending approval.
 * @param id approval id
 * @param d { behavior: 'allow'|'deny'|'release', note?, interrupt?, target? }
 *   `target` (the action's target session name): when given it must equal
 *   the approval's session, otherwise 409 and the approval stays pending.
 * @param who the deciding user (login string, or an object with `user`)
 * @returns the closed Approval
 * @throws ActionError 400 (bad behavior), 404 (unknown id), 409 (closed, or target mismatch)
 */
export function decide(id, d = {}, who) {
  const behavior = d?.behavior;
  if (!BEHAVIORS.has(behavior)) throw new ActionError('behavior must be allow, deny or release', 400);
  if (typeof id !== 'string' || !id) throw new ActionError('approvalId missing', 400);
  const entry = open_.get(id);
  if (!entry) {
    const c = closed.get(id);
    if (c) throw new ActionError(`approval ${id} is already ${c.status}`, 409);
    throw new ActionError(`unknown approval: ${id}`, 404);
  }
  const a = entry.approval;
  if (d.target !== undefined && (a.session == null || d.target !== a.session)) {
    throw new ActionError(`approval ${id} does not belong to ${typeof d.target === 'string' ? d.target : 'that target'}`, 409);
  }
  const user = cleanWho(who);
  const note = behavior === 'deny' ? cleanNote(d.note) : null;
  const decision = makeDecision(a, behavior, { note, interrupt: d.interrupt, who: user });
  const status = behavior === 'allow' ? 'allowed' : behavior === 'deny' ? 'denied' : 'released';
  return snapshot(close(id, status, { who: user, note, decision }));
}

/** The route saw the curl connection close before a decision ("abandoned"). */
export function abandon(id, reason = null) {
  const a = close(id, 'abandoned', { note: cleanNote(reason) });
  return a ? snapshot(a) : null;
}

/**
 * Close every pending approval of a Claude session: the tool ran, the turn
 * ended or a new prompt came in, so the request was answered elsewhere.
 * Called from hooks.ingest (via hooks.subscribe, C4) on PostToolUse, Stop,
 * SessionEnd and UserPromptSubmit. Returns the closed approvals.
 */
export function supersede(sessionId, reason = null) {
  if (typeof sessionId !== 'string' || !sessionId) return [];
  const out = [];
  for (const [id, entry] of [...open_]) {
    if (entry.approval.sessionId !== sessionId) continue;
    out.push(snapshot(close(id, 'superseded', { note: cleanNote(reason) })));
  }
  return out;
}

/** Pending approvals, oldest first. */
export function pending() {
  return [...open_.values()].map((e) => snapshot(e.approval)).sort((a, b) => a.createdAt - b.createdAt);
}

/** One approval by id, pending or recently closed; null when unknown. */
export function get(id) {
  const e = open_.get(id);
  if (e) return snapshot(e.approval);
  const c = closed.get(id);
  return c ? snapshot(c) : null;
}

/**
 * The hook's stdout for a decision. '' (no decision: Claude Code shows its
 * dialog) for null, release and anything unknown.
 */
export function hookOutput(decision, who) {
  if (!decision || typeof decision !== 'object') return '';
  const user = cleanWho(who ?? decision.who);
  if (decision.behavior === 'allow') {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  }
  if (decision.behavior === 'deny') {
    const note = cleanNote(decision.note);
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: `Denied by ${user} via laneboard` + (note ? `: ${note}` : ''),
          interrupt: Boolean(decision.interrupt),
        },
      },
    });
  }
  return '';
}

/** Subscribe to {op:'open'|'close', approval}. Returns an unsubscribe function. */
export function onChange(fn) {
  if (typeof fn !== 'function') throw new TypeError('onChange needs a function');
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: drop all state (pending waits resolve null). */
export function _reset() {
  for (const e of open_.values()) { clearTimeout(e.timer); e.resolve(null); }
  open_.clear();
  closed.clear();
  listeners.clear();
}
