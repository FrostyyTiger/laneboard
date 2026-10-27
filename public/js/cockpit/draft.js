// The draft in the input row (cockpit spec c1-talk.md §7, §10 E1, D271): the
// numbers the pane lays the input out by, the length note, the keys that send and
// what `EDIT` puts back. Pure: no DOM, so `node:test` checks it whole.
import { MAX_PROMPT_CHARS } from '../core/cockpit-constants.js';

/** §7: 64 px for one line, +39.2 px per line up to 4 lines (181.6 px), then it scrolls inside. */
export const INPUT_ONE_LINE_PX = 64;
export const INPUT_LINE_PX = 39.2;
export const INPUT_MAX_LINES = 4;
/** The input's padding and border above and below its lines: 64 − 39.2 (12.4 px each side, the 1 px border in it). */
export const INPUT_EDGES_PX = INPUT_ONE_LINE_PX - INPUT_LINE_PX;

/** The input's height for `lines` lines of text (§7): 64, 103.2, 142.4, 181.6. */
export function inputHeight(lines) {
  const n = Math.min(INPUT_MAX_LINES, Math.max(1, Math.round(lines) || 1));
  return Math.round((INPUT_ONE_LINE_PX + (n - 1) * INPUT_LINE_PX) * 10) / 10;
}

/**
 * How many lines the text holds, from the textarea's `scrollHeight` (its padding and
 * lines, the border not in it) at its one-line height (build B168).
 */
export function linesFromScroll(scrollHeight, borderPx = 2) {
  const n = Math.round((scrollHeight + borderPx - INPUT_EDGES_PX) / INPUT_LINE_PX);
  return Math.max(1, n);
}

/** `8214` → `8 214` (the spec's grouping: a space every three digits). */
export function groupDigits(n) {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * §7 "Length": above the limit the line slot's note `8 214 / 8 000 CHARACTERS`
 * (`data-line="length"`); at or under it, null. The count is the input's own value,
 * as pasted (never cut short by the screen, §7), in the string's length as the room
 * counts it (server/cockpit/protocol.mjs).
 */
export function lengthNote(len, limit) {
  const max = limit ?? MAX_PROMPT_CHARS;
  if (!(len > max)) return null;
  return `${groupDigits(len)} / ${groupDigits(max)} CHARACTERS`;
}

/** Can the draft be sent? Not white space alone, not over the limit (§7). */
export function canSend(value, limit) {
  const max = limit ?? MAX_PROMPT_CHARS;
  return value.trim() !== '' && value.length <= max;
}

/**
 * §7 "Keys": `Enter` sends, on a paired and an on-screen keyboard alike;
 * `Shift+Enter` is a new line. An `Enter` that ends an IME composition is the
 * composition's, not a send.
 */
export function isSendKey(e) {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229;
}

/**
 * §10 E1 `EDIT` (D271): the block's text back in the input, an existing draft kept
 * after it on a new line; the caret after the restored text.
 */
export function restoreDraft(text, draft = '') {
  const value = draft === '' ? text : `${text}\n${draft}`;
  return { value, caret: text.length };
}
