// Transcript rows for the PEEK tab (fleet plan §10 2.12, R12). Pure: no DOM,
// no store, no fetch.
//
// Input: the entries of GET /api/v1/sessions/:name/transcript (server
// review/transcript.mjs, R4):
//   {off, ts, role: 'user'|'assistant'|'tool_use'|'tool_result'|'system',
//    text, tool?, isError?, truncated?}
// Output of rowsFor(entries): [{cls, label, text, off, ts, truncated}] in the
// same order, one row per displayable entry. Unknown roles and empty entries
// are dropped.
//
// Everything in a transcript is untrusted (the agent read arbitrary files and
// web pages into it). The server already strips ANSI and control characters;
// this module does it again (defence in depth: an old builder, the hub proxy)
// and also drops bidi overrides and lone surrogates, then caps every text.
// Rows are plain strings: the view sets them with textContent only.

/** Per-row caps (characters) by kind. */
export const CAPS = Object.freeze({ user: 600, assistant: 600, tool: 240, result: 300, system: 300 });
/** Lines kept per row before the rest is cut. */
export const MAX_LINES = Object.freeze({ user: 8, assistant: 8, tool: 2, result: 3, system: 3 });
/** Longest tool name shown as a label. */
export const LABEL_CAP = 24;
/** Entries kept in a peek tail (forward + older pages), oldest dropped first. */
export const KEEP_ENTRIES = 400;
export const ELLIPSIS = '…';

// ANSI CSI / OSC / single-character escapes.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;
// C0 except \t \n, DEL, C1; bidi embeddings/overrides/isolates; zero-width
// joiners stay (emoji), the BOM goes.
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g;

/** Strip ANSI and control characters from untrusted text; CRLF/CR become LF. */
export function cleanRowText(s) {
  if (typeof s !== 'string' || s === '') return '';
  let t = s.replace(/\r\n?/g, '\n').replace(ANSI_RE, '').replace(CTRL_RE, '');
  if (typeof t.toWellFormed === 'function') t = t.toWellFormed();
  return t;
}

/**
 * Cap `s` at `maxLines` lines and `cap` characters (never splitting a
 * surrogate pair). Trailing blank lines are trimmed first. Returns
 * {text, cut} where `cut` says something was removed (an ellipsis is appended).
 */
export function truncate(s, cap, maxLines = Infinity) {
  let t = String(s ?? '').replace(/\s+$/, '');
  let cut = false;
  const lines = t.split('\n');
  if (lines.length > maxLines) {
    t = lines.slice(0, Math.max(1, maxLines)).join('\n').replace(/\s+$/, '');
    cut = true;
  }
  if (t.length > cap) {
    let end = Math.max(0, cap - 1);
    const c = t.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
    t = t.slice(0, end).replace(/\s+$/, '');
    cut = true;
  }
  return { text: cut ? `${t}${ELLIPSIS}` : t, cut };
}

function toolLabel(name) {
  const n = cleanRowText(typeof name === 'string' ? name : '').replace(/\s+/g, ' ').trim();
  if (!n) return 'TOOL';
  return n.length > LABEL_CAP ? `${n.slice(0, LABEL_CAP - 1)}${ELLIPSIS}` : n;
}

/** One entry -> {kind, cls, label} or null for a role that is not shown. */
function kindOf(e) {
  switch (e.role) {
    case 'user': return { kind: 'user', cls: 'user', label: 'YOU' };
    case 'assistant': return { kind: 'assistant', cls: 'assistant', label: 'CLAUDE' };
    case 'tool_use': return { kind: 'tool', cls: 'tool', label: toolLabel(e.tool) };
    case 'tool_result': return e.isError === true
      ? { kind: 'result', cls: 'error', label: 'ERROR' }
      : { kind: 'result', cls: 'result', label: 'RESULT' };
    case 'system': return { kind: 'system', cls: 'system', label: 'SUMMARY' };
    default: return null;
  }
}

/** One entry -> one row, or null (unknown role, nothing to show). Pure. */
export function rowFor(e) {
  if (!e || typeof e !== 'object') return null;
  const k = kindOf(e);
  if (!k) return null;
  const raw = cleanRowText(e.text);
  // Tool calls and results read best on one line each: collapse runs of blanks.
  const body = k.kind === 'tool' ? raw.replace(/[ \t]+/g, ' ').trim() : raw.replace(/\n{3,}/g, '\n\n').trim();
  if (!body && k.kind !== 'tool' && k.kind !== 'result') return null;
  const { text, cut } = truncate(body, CAPS[k.kind], MAX_LINES[k.kind]);
  return {
    cls: k.cls,
    label: k.label,
    text,
    off: Number.isSafeInteger(e.off) && e.off >= 0 ? e.off : null,
    ts: typeof e.ts === 'string' ? cleanRowText(e.ts).slice(0, 64) : null,
    truncated: cut || e.truncated === true,
  };
}

/** entries -> [{cls, label, text, off, ts, truncated}]. Pure. */
export function rowsFor(entries) {
  const out = [];
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const r = rowFor(e);
    if (r) out.push(r);
  }
  return out;
}

/** HH:MM of an ISO timestamp (UTC-free: the viewer's local time), or ''. */
export function timeOf(ts, toLocal = true) {
  if (typeof ts !== 'string' || ts === '') return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const h = toLocal ? d.getHours() : d.getUTCHours();
  const m = toLocal ? d.getMinutes() : d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- the tail

/**
 * An empty peek tail: the entries held, the byte window they cover, and
 * whether older pages exist.
 */
export function emptyTail() {
  return { entries: [], startOffset: null, endOffset: null, size: null, hasOlder: false };
}

const offOk = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Fold one transcript response into `tail` (returns a new tail; pure).
 * `dir` is 'tail' (the first, backward read), 'after' (a forward poll) or
 * 'before' (the "older" button). A `reset` response (the file shrank or was
 * replaced) starts over from empty; the caller then re-reads the tail.
 * Entries are de-duplicated by (off, role, index-within-line) so a repeated
 * page never doubles rows, and at most `keep` entries are held.
 */
export function mergeTail(tail, res, dir = 'tail', keep = KEEP_ENTRIES) {
  const prev = tail && Array.isArray(tail.entries) ? tail : emptyTail();
  if (!res || typeof res !== 'object') return prev;
  if (res.reset === true) return { ...emptyTail(), reset: true };
  const list = Array.isArray(res.entries) ? res.entries.filter((e) => e && typeof e === 'object') : [];
  const size = offOk(res.size) ? res.size : prev.size;
  const start = offOk(res.startOffset) ? res.startOffset : null;
  const end = offOk(res.endOffset) ? res.endOffset : null;
  // Keys are (off, role, index among that line's entries of the same page),
  // so a page read twice matches itself while one line's several entries
  // (a user line with two tool results) all stay.
  const keyed = (arr) => {
    const n = new Map();
    return arr.map((e) => {
      const off = offOk(e.off) ? e.off : -1;
      const k0 = `${off}:${e.role}`;
      const i = n.get(k0) ?? 0;
      n.set(k0, i + 1);
      return { e, key: off >= 0 ? `${k0}:${i}` : null };
    });
  };
  let parts;
  let startOffset = prev.startOffset;
  let endOffset = prev.endOffset;
  if (dir === 'tail' || prev.endOffset == null) {
    parts = [keyed(list)];
    startOffset = start;
    endOffset = end;
  } else if (dir === 'before') {
    parts = [keyed(list), keyed(prev.entries)];
    if (start != null) startOffset = start;
  } else {
    parts = [keyed(prev.entries), keyed(list)];
    if (end != null) endOffset = end;
  }
  const seen = new Set();
  const dedup = [];
  for (const { e, key } of parts.flat()) {
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    dedup.push(e);
  }
  let dropped = false;
  if (dedup.length > keep) {
    const cut = dedup.length - keep;
    // Dropping old entries moves the window's start up to the first one kept.
    dedup.splice(0, cut);
    dropped = true;
    if (offOk(dedup[0]?.off)) startOffset = dedup[0].off;
  }
  const hasOlder = startOffset != null && startOffset > 0;
  return { entries: dedup, startOffset, endOffset, size, hasOlder, dropped };
}
