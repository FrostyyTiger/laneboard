// The error ends of a turn (cockpit spec c1-talk.md §10, protocols.md §3.2's `turn.end`
// table; D57, D232, D259, D289): the exact words of each line, pure, so the pane
// and its unit test read one table. The pane draws them as `[data-turn-error="<code>"]`
// (turns.js errorLine); E1 and E9 are the prompt's own lines (pane.js), not ends.
//
//   endText(end, { back, nowMs, offset, timeZone })  the line for a `turn.end` `error`
//   endButtons(code, back)                         the buttons' labels under it, in order
//   cutDetail(detail)                              `{detail}` cut to 120 characters
//   retryingText({attempt, of})                    E5's grey row
import { atText, clockText } from '../core/cockpit-time.js';

/** c1-talk.md §10: text from the room or the agent inside a message is cut to this. */
export const DETAIL_MAX = 120;

/** E7's `GO ON` sends this as a new prompt (c1-talk.md §10). */
export const GO_ON_TEXT = 'Go on.';

/** The codes a `turn.end` `error` carries (protocols.md §3.2). */
export const END_CODES = Object.freeze(['agent-exited', 'agent-down', 'not-logged-in', 'step-limit', 'failed']);

/** `{detail}` as the screen draws it: its first 120 characters (code points), as text. */
export function cutDetail(detail) {
  const chars = [...String(detail ?? '')];
  return chars.length > DETAIL_MAX ? chars.slice(0, DETAIL_MAX).join('') : chars.join('');
}

/** E5 (c1-talk.md §10): `the model service is busy, retrying (2 of 10)`. */
export function retryingText({ attempt, of }) {
  return `the model service is busy, retrying (${attempt} of ${of})`;
}

/**
 * The line of an error end. `end`: the `turn.end` (`code`, `steps`, `detail`, `at`);
 * `back`: E2 once the agent is back; `offset`: the page's clock minus the room's (the
 * turn's own times, build B200); E2's times are events, the clock only (README.md
 * "Times on the screen", D232). An unknown code reads as E8 with the code as its detail.
 */
export function endText(end, { back = false, nowMs = Date.now(), offset = 0, timeZone } = {}) {
  switch (end?.code) {
    case 'agent-exited': {
      const at = Date.parse(end.at ?? '');
      const ms = Number.isFinite(at) ? at + offset : nowMs;
      return back
        ? `The agent is back (${clockText(ms, nowMs, timeZone)}). Your last message was not answered.`
        : `The agent stopped unexpectedly ${atText(ms, nowMs, timeZone)}. The room is starting it again.`;
    }
    // D289: the 30 s is the restart series' last step; a refused start never ends a turn.
    case 'agent-down': return `The agent cannot start: ${cutDetail(end.detail)}. The room tries again every 30 s.`;
    case 'not-logged-in': return 'The agent is not logged in on the room. Log it in there, then send again.';
    case 'step-limit': return `Stopped after ${Number.isInteger(end.steps) ? end.steps : 0} steps, the agent's limit.`;
    case 'failed': return `The answer failed: ${cutDetail(end.detail)}.`;
    default: return `The answer failed: ${cutDetail(end?.detail ?? end?.code ?? 'unknown')}.`;
  }
}

/** The buttons of an error end, by label (c1-talk.md §10's table): E2's `RETRY` only once back. */
export function endButtons(code, back = false) {
  switch (code) {
    case 'agent-exited': return back ? ['RETRY'] : [];
    case 'agent-down':
    case 'not-logged-in': return [];
    case 'step-limit': return ['GO ON'];
    default: return ['RETRY'];
  }
}
