// Transcript tail by byte offset (fleet plan §10 2.3, R4).
//
// Reads a page of a Claude Code JSONL transcript, forward from `after` or
// backward from `before`, and turns each line into zero or more plain-text
// entries for the peek tab. It is independent of the cost tailer
// (server/collector/transcripts.mjs): its own file handle, never the
// `transcript_offsets` table.
//
// Everything in a transcript is untrusted (the agent read arbitrary files and
// web pages into it). Entries are plain text only: ANSI and control characters
// are stripped, every text is capped, and nothing is ever interpreted as HTML
// here; escaping is the renderer's job.
//
// Offsets: an entry's `off` is the byte offset of the first byte of its line,
// so offsets are stable across calls. `endOffset` is always the byte after the
// last whole line consumed (a trailing partial line is never read until its
// `\n` arrives); `startOffset` is the offset of the earliest line examined.
// Paging backward with `before=startOffset` and forward with `after=endOffset`
// therefore gives no overlap and no gap.
//
// Path safety: the client never sends a path. The route builds one from the
// session and must pass it through resolveTranscriptFile, which only accepts
// a `.jsonl` regular file whose realpath lies inside realpath(projectsDir).
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { stripAnsi } from '../util.mjs';
import { LIMITS, defaults } from '../config/review.mjs';

const CHUNK = 64 * 1024;
const NL = 0x0a;
export const SUMMARY_CAP = 300;
const TOOL_NAME_CAP = 100;
const TS_CAP = 64;
const SKIPPED_TEXT = '[line too long, skipped]';

const DEFAULTS = defaults().transcript;

export class TranscriptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'TranscriptError';
    this.status = status;
  }
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (v === undefined || v === null || !Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function offsetArg(v, name) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 0) throw new TranscriptError(`bad ${name}`, 400);
  return n;
}

// C0 controls except \t and \n, DEL, and C1 controls.
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Clean untrusted text: strip ANSI and control chars, cap at `cap` chars. */
function clean(s, cap) {
  if (typeof s !== 'string') return { text: '', truncated: false };
  let t = stripAnsi(s).replace(CTRL_RE, '');
  if (t.length <= cap) return { text: t, truncated: false };
  let end = cap;
  // Never split a surrogate pair.
  const c = t.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  t = t.slice(0, end);
  return { text: t, truncated: true };
}

/** strip ANSI (util stripAnsi) + C0 except \n\t, cap. Returns the text. */
export function cleanText(s, cap = DEFAULTS.textCap) {
  return clean(s, cap).text;
}

function str(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  try { return JSON.stringify(v) ?? ''; } catch { return ''; }
}

/** One-line summary of a tool call's input, capped at SUMMARY_CAP chars. Pure. */
export function summarizeToolInput(name, input) {
  const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : str(v));
  let out;
  switch (name) {
    case 'Bash':
      out = s(inp.command);
      break;
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      out = s(inp.file_path ?? inp.notebook_path);
      break;
    case 'Grep': case 'Glob':
      out = s(inp.pattern) + (inp.path != null && inp.path !== '' ? ` in ${s(inp.path)}` : '');
      break;
    case 'Task': case 'Agent':
      out = s(inp.description);
      break;
    case 'WebFetch':
      out = s(inp.url);
      break;
    default:
      out = Object.keys(inp).slice(0, 3)
        .map((k) => `${k}=${s(inp[k]).slice(0, SUMMARY_CAP)}`)
        .join(' ');
  }
  return cleanText(out, SUMMARY_CAP);
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }
  return '';
}

function tsOf(obj) {
  const t = obj.timestamp;
  return typeof t === 'string' && t.length <= TS_CAP ? cleanText(t, TS_CAP) : null;
}

/** One parsed JSONL line -> 0..n entries. Pure. */
export function entriesFromLine(obj, off, textCap = DEFAULTS.textCap) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const ts = tsOf(obj);
  const out = [];
  const push = (role, raw, extra = {}) => {
    const { text, truncated } = clean(raw, textCap);
    const e = { off, ts, role, text, ...extra };
    if (truncated) e.truncated = true;
    out.push(e);
  };

  if (obj.type === 'summary') {
    if (typeof obj.summary === 'string') push('system', obj.summary);
    return out;
  }

  const content = obj.message && typeof obj.message === 'object' ? obj.message.content : undefined;

  if (obj.type === 'user') {
    if (typeof content === 'string') {
      push('user', content);
    } else if (Array.isArray(content)) {
      const texts = [];
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        else if (b.type === 'tool_result') {
          push('tool_result', blockText(b.content), { isError: b.is_error === true });
        }
      }
      if (texts.length) push('user', texts.join('\n'));
    }
    return out;
  }

  if (obj.type === 'assistant') {
    if (typeof content === 'string') {
      push('assistant', content);
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string') push('assistant', b.text);
        else if (b.type === 'tool_use') {
          const tool = cleanText(typeof b.name === 'string' ? b.name : '', TOOL_NAME_CAP);
          push('tool_use', summarizeToolInput(tool, b.input), { tool });
        }
        // thinking / redacted_thinking and anything else: dropped
      }
    }
    return out;
  }

  return out; // every other type is skipped
}

function parseLine(buf, off, textCap) {
  if (!buf.length) return [];
  let obj;
  try { obj = JSON.parse(buf.toString('utf8')); } catch { return []; }
  return entriesFromLine(obj, off, textCap);
}

function skippedEntry(off) {
  return { off, ts: null, role: 'system', text: SKIPPED_TEXT, truncated: true };
}

async function readAt(fh, pos, len) {
  const buf = Buffer.allocUnsafe(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, pos + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  return got === len ? buf : buf.subarray(0, got);
}

/** First '\n' at or after `pos` and before `limit`, or -1. Reads in chunks, keeps nothing. */
async function findNewlineForward(fh, pos, limit) {
  while (pos < limit) {
    const buf = await readAt(fh, pos, Math.min(CHUNK, limit - pos));
    if (!buf.length) return -1;
    const i = buf.indexOf(NL);
    if (i >= 0) return pos + i;
    pos += buf.length;
  }
  return -1;
}

/** Offset of the start of the line containing byte `pos - 1` (after the previous '\n', or 0). */
async function findLineStartBackward(fh, pos) {
  while (pos > 0) {
    const start = Math.max(0, pos - CHUNK);
    const buf = await readAt(fh, start, pos - start);
    const i = buf.lastIndexOf(NL);
    if (i >= 0) return start + i + 1;
    pos = start;
  }
  return 0;
}

async function readForward(fh, size, after, limit, maxBytes, textCap) {
  const end = Math.min(size, after + maxBytes);
  const buf = await readAt(fh, after, end - after);
  const entries = [];
  let endOffset = after;
  let p = 0;
  while (p < buf.length) {
    const nl = buf.indexOf(NL, p);
    if (nl < 0) break;
    const lineEntries = parseLine(buf.subarray(p, nl), after + p, textCap);
    if (entries.length && entries.length + lineEntries.length > limit) break;
    entries.push(...lineEntries);
    p = nl + 1;
    endOffset = after + p;
    if (entries.length >= limit) break;
  }
  if (endOffset === after && end < size && buf.length === end - after) {
    // One line longer than maxBytes: skip it once it is complete, or the
    // client would never get past it.
    const nl = await findNewlineForward(fh, end, size);
    if (nl >= 0) {
      entries.push(skippedEntry(after));
      endOffset = nl + 1;
    }
  }
  return { size, startOffset: after, endOffset, reset: false, entries };
}

async function readBackward(fh, size, before, limit, maxBytes, textCap) {
  const groups = []; // per line, latest first
  let count = 0;
  let pos = before;
  let carry = Buffer.alloc(0); // the not-yet-complete first segment of the previous chunk
  let endOffset = null;
  let startOffset = null;
  let scanned = 0;
  let done = false;

  const take = (lineBuf, off) => {
    const es = parseLine(lineBuf, off, textCap);
    if (count && count + es.length > limit) { done = true; return; }
    if (es.length) { groups.push(es); count += es.length; }
    startOffset = off;
    if (count >= limit) done = true;
  };

  while (pos > 0 && !done) {
    const start = Math.max(0, pos - CHUNK);
    const chunk = await readAt(fh, start, pos - start);
    scanned += chunk.length;
    pos = start;
    const data = carry.length ? Buffer.concat([chunk, carry]) : chunk;
    let e = data.length; // exclusive end of the region still to walk (ends with '\n')
    if (endOffset === null) {
      const nl = data.lastIndexOf(NL);
      if (nl < 0) {
        if (start === 0) { endOffset = 0; startOffset = 0; break; }
        if (scanned >= maxBytes) break;
        carry = Buffer.from(data);
        continue;
      }
      endOffset = start + nl + 1; // drop the trailing partial line
      startOffset = endOffset;
      e = nl + 1;
    }
    while (!done && e > 0) {
      const nl = e >= 2 ? data.lastIndexOf(NL, e - 2) : -1;
      if (nl < 0) break;
      take(data.subarray(nl + 1, e - 1), start + nl + 1);
      e = nl + 1;
    }
    if (done) break;
    if (start === 0) {
      if (e > 0) take(data.subarray(0, e - 1), 0);
      break;
    }
    carry = Buffer.from(data.subarray(0, e));
    if (scanned >= maxBytes) break;
  }

  if (endOffset === null) {
    // Scanned maxBytes without a single '\n': the bytes before `before` are one
    // partial line. Find its start so forward polling begins there.
    endOffset = await findLineStartBackward(fh, before - scanned);
    startOffset = endOffset;
  } else if (!done && startOffset === endOffset && pos > 0 && carry.length && scanned >= maxBytes) {
    // The line ending at startOffset is longer than maxBytes: skip it so
    // paging backward is never stuck on it.
    const lineStart = await findLineStartBackward(fh, pos);
    groups.push([skippedEntry(lineStart)]);
    startOffset = lineStart;
  }

  const entries = [];
  for (let i = groups.length - 1; i >= 0; i--) entries.push(...groups[i]);
  return { size, startOffset, endOffset, reset: false, entries };
}

/**
 * Read one page of a transcript. `file` must already have passed
 * resolveTranscriptFile. `after` reads forward from a line start, otherwise
 * the page ends at `before` (default: the file size). Caps are clamped to the
 * transcript.* LIMITS of server/config/review.mjs.
 *   -> { size, startOffset, endOffset, reset, entries: [Entry] }
 */
export async function tailTranscript({ file, after = null, before = null, limit, maxBytes, textCap } = {}) {
  if (typeof file !== 'string' || !file) throw new TranscriptError('no transcript', 404);
  const a = offsetArg(after, 'after');
  const b = a === null ? offsetArg(before, 'before') : null;
  const lim = clampInt(limit, 1, LIMITS['transcript.maxEntries'], DEFAULTS.maxEntries);
  const mb = clampInt(maxBytes, 1, LIMITS['transcript.tailMaxBytes'], DEFAULTS.tailMaxBytes);
  const cap = clampInt(textCap, 1, LIMITS['transcript.textCap'], DEFAULTS.textCap);

  let fh;
  try {
    fh = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new TranscriptError('no transcript', 404);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new TranscriptError('no transcript', 404);
    const size = st.size;
    if (a !== null) {
      if (size < a) return { size, startOffset: 0, endOffset: 0, reset: true, entries: [] };
      return await readForward(fh, size, a, lim, mb, cap);
    }
    const end = b === null ? size : b;
    if (size < end) return { size, startOffset: 0, endOffset: 0, reset: true, entries: [] };
    return await readBackward(fh, size, end, lim, mb, cap);
  } finally {
    await fh.close();
  }
}

/**
 * The only way a transcript path reaches tailTranscript: realpath(file) must
 * be a `.jsonl` regular file strictly inside realpath(projectsDir). Symlinks
 * are followed by realpath, so one pointing outside is refused. Throws
 * TranscriptError(404) otherwise; returns the real path.
 */
export async function resolveTranscriptFile(file, projectsDir) {
  if (typeof file !== 'string' || !file || typeof projectsDir !== 'string' || !projectsDir || file.includes('\0')) {
    throw new TranscriptError('no transcript', 404);
  }
  let real, root;
  try {
    root = await fsp.realpath(projectsDir);
    real = await fsp.realpath(file);
  } catch {
    throw new TranscriptError('no transcript', 404);
  }
  if (!real.startsWith(root + path.sep) || !real.endsWith('.jsonl')) {
    throw new TranscriptError('no transcript', 404);
  }
  let st;
  try { st = await fsp.stat(real); } catch { throw new TranscriptError('no transcript', 404); }
  if (!st.isFile()) throw new TranscriptError('no transcript', 404);
  return real;
}
