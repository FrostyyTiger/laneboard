// Hook ingestion. Claude Code POSTs every hook event here; the handler must be
// fast and must never fail (hard rule 5: a dead laneboard is invisible to sessions).
import { addEvent } from '../db.mjs';
import { oneLine, truncate } from '../util.mjs';
import * as state from '../state.mjs';
import * as markers from './markers.mjs';

/**
 * Map a hook payload to a state-machine transition (plan §2.2).
 * Returns { state, tool, toolInput, lastAssistant } or null for "no change".
 */
export function classify(body) {
  const event = body?.hook_event_name;
  switch (event) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      return { state: 'working', tool: null, toolInput: null };
    case 'PreToolUse':
      return { state: 'working', tool: body.tool_name ?? null, toolInput: summariseToolInput(body.tool_input) };
    case 'PostToolUse':
      return { state: 'working', tool: body.tool_name ?? null, toolInput: summariseToolInput(body.tool_input) };
    case 'Notification': {
      const kind = body.matcher || body.notification_type || body.subtype || null;
      if (kind === 'permission_prompt') return { state: 'waiting_permission' };
      if (kind === 'elicitation_dialog' || kind === 'agent_needs_input') return { state: 'waiting_question' };
      if (kind === 'idle_prompt') return { state: 'idle' };
      if (kind === 'agent_completed') return { state: 'done' };
      // Unknown notification kinds must not move the state machine.
      return null;
    }
    case 'Stop':
      return { state: 'done', lastAssistant: truncate(textOf(body.last_assistant_message), 300) };
    case 'SessionEnd':
      return { state: 'dead' };
    default:
      return null;
  }
}

function textOf(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg?.content)) {
    return msg.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  }
  if (typeof msg?.content === 'string') return msg.content;
  if (typeof msg?.text === 'string') return msg.text;
  return '';
}

/** One readable line describing what a tool is about to do. */
export function summariseToolInput(input) {
  if (!input || typeof input !== 'object') return null;
  const first =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    input.prompt ?? input.query ?? input.description ?? null;
  if (first != null) return oneLine(first, 160);
  return oneLine(JSON.stringify(input), 160);
}

/** Subtype recorded in the event log: the notification kind, or the tool name. */
export function subtypeOf(body) {
  if (body?.hook_event_name === 'Notification') {
    return body.matcher || body.notification_type || body.subtype || 'unknown';
  }
  if (body?.tool_name) return body.tool_name;
  return null;
}

/** Ingest one hook payload. Synchronous and cheap — no awaits on the hot path. */
export function ingest(body) {
  const sessionId = body?.session_id ?? null;
  const event = body?.hook_event_name ?? 'unknown';
  // May be null on SessionStart — the registry file does not exist yet. The
  // state machine does not need it, because hook state is keyed by sessionId.
  const name = sessionId ? state.sessionNameBySessionId(sessionId) : null;
  const now = Date.now();

  addEvent({
    ts: now,
    sessionId,
    sessionName: name,
    type: event,
    subtype: subtypeOf(body),
    payload: compactPayload(body),
  });

  // Hooks are the most reliable marker source: `Stop` carries the assistant's
  // actual last message, so a NEED-HUMAN reaches here before it has finished
  // being painted into the pane.
  const shouted = [textOf(body.last_assistant_message), body.message, body.reason]
    .filter((t) => typeof t === 'string' && t)
    .join('\n');
  if (shouted) {
    const session = name ? state.get(name) : null;
    for (const m of markers.ingest({
      lane: session?.lane ?? null,
      sessionName: name,
      source: 'hook',
      text: shouted,
    })) {
      state.noteMarkerFromHook(m);
    }
  }

  const transition = classify(body);
  if (!sessionId || !transition) return { name, sessionId, transition: null };

  const prev = state.hookState.get(sessionId) ?? {};
  const next = { ...prev, ...transition, at: now };
  if (event === 'UserPromptSubmit' && typeof body.prompt === 'string') {
    next.lastUserPrompt = truncate(body.prompt, 200);
  }
  if (transition.lastAssistant) next.lastAssistantAt = now;
  // Keep the tool across a permission/question prompt — "waiting on Bash:
  // ls -la /tmp" is the useful line. Clear it only once the work is over.
  if (!('tool' in transition) && ['done', 'idle', 'dead'].includes(transition.state)) {
    next.tool = null;
    next.toolInput = null;
  }
  if (event === 'UserPromptSubmit') { next.tool = null; next.toolInput = null; }
  state.hookState.set(sessionId, next);
  return { name, sessionId, transition: next };
}

/** Keep the event row small — full tool inputs can be megabytes. */
function compactPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {
    cwd: body.cwd ?? null,
    transcript_path: body.transcript_path ?? null,
  };
  if (body.tool_name) out.tool_name = body.tool_name;
  if (body.tool_use_id) out.tool_use_id = body.tool_use_id;
  const summary = summariseToolInput(body.tool_input);
  if (summary) out.tool_input = summary;
  if (typeof body.prompt === 'string') out.prompt = truncate(body.prompt, 300);
  if (body.last_assistant_message) out.last_assistant_message = truncate(textOf(body.last_assistant_message), 300);
  if (body.message) out.message = oneLine(body.message, 200);
  if (body.matcher || body.notification_type) out.matcher = body.matcher || body.notification_type;
  if (body.reason) out.reason = oneLine(body.reason, 120);
  return out;
}
