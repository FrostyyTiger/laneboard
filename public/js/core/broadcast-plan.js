// Broadcast planner (fleet plan §8 2.4, task C8). REVIEW-REQUIRED (SR18).
//
// This file has two byte-identical copies: server/control/broadcast.mjs (node: the hub's `broadcast` action)
// and public/js/core/broadcast-plan.js (browser: the broadcast dialog's live preview). Edit both together;
// test/broadcast.test.mjs asserts the copies are identical and agree on a shared vector table.
// Pure ES module: no imports, no DOM, no globals beyond the language.
//
// Trust: every session field read here comes from a builder snapshot (untrusted, possibly stale by up to the
// hub's stale window), and targets/text come from the browser. The plan is advisory for the hub's own choice
// of which envelopes to sign; each builder re-checks `guardPrompt` against its own current state before typing.
//
// - planBroadcast(targets, sessionsByKey, {builderUp?}) -> {send:[fkey], skip:[{key, reason}]}
//   A target is sent to only when its builder is up, the session is known, it is a live Claude session
//   (state working|done|idle), it is not prompting (waiting_permission|waiting_question, awaitingApproval, or
//   the pane preview shows a dialog) and it is not paused. Everything else is skipped with a reason; an
//   unrecognised state fails closed ('unknown').
// - validateBroadcast({targets, text, enter, confirmCount}, lastAt, now) -> error code | null
// - typedText(text, enter): exactly what a builder types (the same cleaning as the dispatcher's
//   cleanTypedText), so the preview is the text that lands in each pane.
// - checkConfirm(plan, confirmCount): the typed count must EQUAL the planned sends (not merely ≤ targets).
// - planHashInput(plan, preview, textHash) -> string: the canonical text the hub hashes (sha256, hex) into the
//   `planHash` it returns with every 409 plan (SR18 L1). The confirmed request echoes that planHash, which binds
//   the exact sorted lane list, the typed text (via its sha256 `textHash`) and the Enter flag, not only the count.

export const BROADCAST_LIMITS = Object.freeze({ maxTargets: 30, maxText: 2000, minIntervalMs: 10_000 });

export const SKIP_REASONS = Object.freeze([
  'invalid', 'duplicate', 'builder-down', 'unknown', 'dead', 'shell', 'prompting', 'paused',
]);

/** Session states a broadcast may type into. */
export const SENDABLE_STATES = Object.freeze(['working', 'done', 'idle']);
/** States that mean a permission prompt, a question or a dialog is on screen. */
export const PROMPTING_STATES = Object.freeze(['waiting_permission', 'waiting_question', 'trust_dialog', 'dialog']);

// Builder id as in fleet/keys (`^[a-z0-9-]{1,24}$`), local name as the builder's session-name rule.
const BROADCAST_KEY_RE = /^[a-z0-9-]{1,24}\/[A-Za-z0-9 _.()-]{1,64}$/;
// C0 controls except \t \n, DEL, C1 controls (server/fleet/dispatch.mjs CONTROL_RE).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// CSI, OSC (BEL or ST terminated) and two-byte escapes.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// The pane heuristics of server/state.mjs promptReadiness: a trust dialog or a "Do you want ..." dialog.
const DIALOG_RE = /trust this folder|Is this a project you created|Yes, I trust|Do you want|Would you like to proceed/i;
const PREVIEW_SCAN_LINES = 25;
const PREVIEW_SCAN_CHARS = 400;

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** A well-formed fleet key a broadcast may target. */
export function isBroadcastKey(k) {
  return typeof k === 'string' && BROADCAST_KEY_RE.test(k) && !k.slice(k.indexOf('/') + 1).startsWith('_laneboard');
}

/** True when the last preview lines show a dialog (pane heuristic; raw ANSI lines from the snapshot). */
export function looksLikeDialog(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const text = lines
    .slice(-PREVIEW_SCAN_LINES)
    .map((l) => (typeof l === 'string' ? l.slice(0, PREVIEW_SCAN_CHARS).replace(ANSI_RE, '') : ''))
    .join('\n');
  return DIALOG_RE.test(text);
}

/** Why `session` must not be typed into, or null when it may. Fails closed on anything unexpected. */
export function skipReason(session) {
  if (session === null || typeof session !== 'object' || Array.isArray(session)) return 'unknown';
  const state = session.state;
  if (state === 'dead') return 'dead';
  if (state === 'shell' || session.kind === 'shell') return 'shell';
  if (PROMPTING_STATES.includes(state) || session.awaitingApproval) return 'prompting';
  if (looksLikeDialog(session.previewLines)) return 'prompting';
  if (session.paused) return 'paused';
  if (!SENDABLE_STATES.includes(state)) return 'unknown';
  return null;
}

function lookup(sessionsByKey, key) {
  if (sessionsByKey instanceof Map) return sessionsByKey.get(key) ?? null;
  return own(sessionsByKey, key) ? sessionsByKey[key] ?? null : null;
}

/**
 * Plan a broadcast. `targets` are fleet keys; `sessionsByKey` maps fleet key -> session (a Map or a plain
 * object); `builderUp(builderId)` (optional) says whether the hub can reach that builder now.
 * Order is kept; duplicates after the first are skipped.
 */
export function planBroadcast(targets, sessionsByKey, opts = {}) {
  const isUp = typeof opts?.builderUp === 'function' ? opts.builderUp : null;
  const send = [];
  const skip = [];
  const seen = new Set();
  const list = Array.isArray(targets) ? targets.slice(0, BROADCAST_LIMITS.maxTargets) : [];
  for (const key of list) {
    if (!isBroadcastKey(key)) { skip.push({ key: typeof key === 'string' ? key.slice(0, 120) : String(key).slice(0, 120), reason: 'invalid' }); continue; }
    if (seen.has(key)) { skip.push({ key, reason: 'duplicate' }); continue; }
    seen.add(key);
    const builder = key.slice(0, key.indexOf('/'));
    if (isUp && isUp(builder) !== true) { skip.push({ key, reason: 'builder-down' }); continue; }
    const reason = skipReason(lookup(sessionsByKey, key));
    if (reason) skip.push({ key, reason });
    else send.push(key);
  }
  return { send, skip };
}

/** Exactly what a builder types for `text` (dispatch.mjs cleanTypedText). */
export function typedText(text, enter) {
  let t = String(text).replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (enter === false) t = t.replace(/\n/g, ' ');
  return t;
}

/** The preview the dialog shows and the hub returns: the typed text and whether Enter follows it. */
export function previewBroadcast(text, enter = true) {
  const t = typedText(typeof text === 'string' ? text : '', enter);
  return { text: t, enter: enter !== false, chars: t.length, lines: t === '' ? 0 : t.split('\n').length };
}

/**
 * Shape, caps and rate limit of a broadcast request. `lastAt` is this user's previous accepted broadcast
 * (ms, or null), `now` the current time. Returns an error code or null.
 */
export function validateBroadcast({ targets, text, enter, confirmCount } = {}, lastAt = null, now = 0) {
  if (!Array.isArray(targets) || targets.length < 1) return 'bad-targets';
  if (targets.length > BROADCAST_LIMITS.maxTargets) return 'too-many-targets';
  if (!targets.every(isBroadcastKey)) return 'bad-targets';
  if (typeof text !== 'string' || text.length < 1) return 'bad-text';
  if (text.length > BROADCAST_LIMITS.maxText) return 'text-too-long';
  if (enter !== undefined && typeof enter !== 'boolean') return 'bad-enter';
  if (typedText(text, enter).trim() === '') return 'bad-text';
  if (!Number.isInteger(confirmCount) || confirmCount < 1 || confirmCount > BROADCAST_LIMITS.maxTargets) return 'bad-confirm';
  if (typeof lastAt === 'number' && Number.isFinite(lastAt) && now - lastAt < BROADCAST_LIMITS.minIntervalMs) return 'rate-limited';
  return null;
}

/** Lower-case hex sha256, the shape of a planHash. */
export const PLAN_HASH_RE = /^[0-9a-f]{64}$/;

/** Canonical planHash input: version, sorted planned sends, Enter flag and the sha256 hex of the typed text. */
export function planHashInput(plan, preview, textHash) {
  const send = Array.isArray(plan?.send) ? plan.send.filter((k) => typeof k === 'string').slice().sort() : [];
  return JSON.stringify({ v: 1, send, enter: preview?.enter !== false, textHash: String(textHash) });
}

/** The typed confirmation must equal the number of planned sends. */
export function checkConfirm(plan, confirmCount) {
  const n = Array.isArray(plan?.send) ? plan.send.length : 0;
  if (n === 0) return 'nothing-to-send';
  return confirmCount === n ? null : 'confirm-mismatch';
}
