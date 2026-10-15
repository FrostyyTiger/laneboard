/**
 * Approval previews (fleet plan §8 2.2). Pure: no server imports, so the
 * approvals core, the route and the tests can call it without a running
 * laneboard.
 *
 *   previewFor(tool, input, opts?) -> { kind: 'diff'|'text', lines: [{t, s}], truncated, note? }
 *
 *   t is '+', '-' or ' '; s is one line of plain text.
 *
 * - Edit: the old_string lines as '-', the new_string lines as '+'.
 *   MultiEdit: the same per edit, each edit headed by a ' ' label line.
 * - Write: a line diff against the current file when it is a regular file of
 *   at most 256 KB whose real path lies under the real path of `cwd`;
 *   otherwise (missing, too big, outside cwd, no cwd) the first 80 lines of
 *   the new content as '+'.
 * - Bash: the command (and the description, when given) as text.
 * - Anything else: the input as indented JSON, as text.
 *
 * The tool input is untrusted text from the agent. Every line has C0
 * controls (except tab), DEL, C1 controls and ESC replaced by U+FFFD, so an
 * escape sequence never reaches a terminal or the CLI, and is capped in
 * length; the whole preview is capped at `maxLines` lines (default 300) and
 * 16 KB. HTML escaping is NOT done here: the renderer uses textContent only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PREVIEW_LIMITS = Object.freeze({
  maxLines: 300,        // default line cap (config.approvals.previewMaxLines)
  hardMaxLines: 1000,   // a configured cap is clamped to 1..hardMaxLines
  maxBytes: 16 * 1024,  // total UTF-8 bytes of all `s`
  maxLineChars: 1000,   // one line, before the byte cap
  maxFileBytes: 256 * 1024,
  writeHeadLines: 80,
  lcsMaxLines: 400,
});

// C0 except tab, DEL, C1 (which includes the 8-bit CSI 0x9b). ESC is C0.
// Newlines never reach here: callers split first. CR is replaced too.
const CONTROL_RE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

/** Plain text for one line: controls neutralised, length capped. */
export function cleanLine(s, max = PREVIEW_LIMITS.maxLineChars) {
  let str = typeof s === 'string' ? s : s == null ? '' : String(s);
  if (str.length > max) str = str.slice(0, max - 1) + '…';
  return str.replace(CONTROL_RE, '�');
}

/** Split text into lines; a trailing newline does not make an empty last line. */
export function splitLines(text) {
  const str = typeof text === 'string' ? text : text == null ? '' : String(text);
  if (str === '') return [];
  const lines = str.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Line diff: an LCS when both sides have at most `lcsMaxLines` lines,
 * otherwise every old line as '-' then every new line as '+'.
 * Returns [{t, s}] with raw (not yet cleaned) strings.
 */
export function diffLines(a, b, { lcsMaxLines = PREVIEW_LIMITS.lcsMaxLines } = {}) {
  if (a.length > lcsMaxLines || b.length > lcsMaxLines) {
    return [...a.map((s) => ({ t: '-', s })), ...b.map((s) => ({ t: '+', s }))];
  }
  // Trim the common prefix and suffix first: Write usually changes a little.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  // dp[i][j] = LCS length of A[i..] and B[j..], flat Uint16Array (≤ 401²).
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out = a.slice(0, pre).map((s) => ({ t: ' ', s }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { out.push({ t: '-', s: A[i] }); i++; }
    else { out.push({ t: '+', s: B[j] }); j++; }
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
  for (const s of a.slice(a.length - suf)) out.push({ t: ' ', s });
  return out;
}

/** Apply the line and byte caps; cleans every line. */
export function capLines(raw, { maxLines = PREVIEW_LIMITS.maxLines, maxBytes = PREVIEW_LIMITS.maxBytes } = {}) {
  const lines = [];
  let bytes = 0;
  let truncated = false;
  for (const l of raw) {
    if (lines.length >= maxLines) { truncated = true; break; }
    const s = cleanLine(l.s);
    const size = Buffer.byteLength(s, 'utf8') + 1;
    if (bytes + size > maxBytes) { truncated = true; break; }
    bytes += size;
    lines.push({ t: l.t === '+' || l.t === '-' ? l.t : ' ', s });
  }
  return { lines, truncated };
}

const realIo = {
  realpath: (p) => fs.realpathSync.native(p),
  stat: (p) => fs.statSync(p),
  read: (p) => fs.readFileSync(p, 'utf8'),
};

function isUnder(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The current content of `filePath` when it may be read for a Write diff,
 * else `{ text: null, note }`. Never throws. Rules: `cwd` is an absolute
 * directory that is not `/` or the home directory itself; the file's real
 * path is under cwd's real path (symlinks resolved on both sides); it is a
 * regular file of at most maxFileBytes.
 */
export function readForDiff(filePath, cwd, io = realIo, maxFileBytes = PREVIEW_LIMITS.maxFileBytes) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return { text: null, note: 'no-path' };
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) return { text: null, note: 'no-cwd' };
  let realCwd;
  try { realCwd = io.realpath(cwd); } catch { return { text: null, note: 'no-cwd' }; }
  if (realCwd === path.parse(realCwd).root || realCwd === safeHome(io)) return { text: null, note: 'cwd-too-broad' };
  const abs = path.resolve(cwd, filePath);
  let real;
  try { real = io.realpath(abs); } catch (err) {
    return { text: null, note: err?.code === 'ENOENT' ? 'new-file' : 'unreadable' };
  }
  if (!isUnder(real, realCwd)) return { text: null, note: 'outside-cwd' };
  let st;
  try { st = io.stat(real); } catch { return { text: null, note: 'unreadable' }; }
  if (!st.isFile()) return { text: null, note: 'not-a-file' };
  if (st.size > maxFileBytes) return { text: null, note: 'too-large' };
  try { return { text: io.read(real), note: null }; } catch { return { text: null, note: 'unreadable' }; }
}

function safeHome(io) {
  try { return io.realpath(os.homedir()); } catch { return os.homedir(); }
}

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function editLines(edit) {
  return [
    ...splitLines(str(edit?.old_string)).map((s) => ({ t: '-', s })),
    ...splitLines(str(edit?.new_string)).map((s) => ({ t: '+', s })),
  ];
}

function jsonText(input) {
  let text;
  try { text = JSON.stringify(input ?? null, null, 2); } catch { text = '[unserialisable input]'; }
  return text ?? '';
}

/**
 * Build the preview for one tool call. `opts` may be the readFileSync-style
 * function itself (plan signature) or `{ cwd, maxLines, maxBytes, io }`
 * where `io` = `{ realpath, stat, read }` (tests stub the filesystem).
 */
export function previewFor(tool, input, opts = {}) {
  if (typeof opts === 'function') opts = { io: { ...realIo, read: (p) => opts(p, 'utf8') } };
  const io = opts.io ?? realIo;
  const maxLines = clampInt(opts.maxLines, 1, PREVIEW_LIMITS.hardMaxLines, PREVIEW_LIMITS.maxLines);
  const maxBytes = clampInt(opts.maxBytes, 256, PREVIEW_LIMITS.maxBytes, PREVIEW_LIMITS.maxBytes);
  const caps = { maxLines, maxBytes };
  const obj = input && typeof input === 'object' ? input : {};
  let kind = 'text';
  let raw;
  let note = null;
  let cut = false;

  switch (tool) {
    case 'Edit':
      kind = 'diff';
      raw = editLines(obj);
      break;
    case 'MultiEdit': {
      kind = 'diff';
      const edits = Array.isArray(obj.edits) ? obj.edits : [];
      raw = [];
      edits.forEach((e, i) => {
        if (edits.length > 1) raw.push({ t: ' ', s: `edit ${i + 1}/${edits.length}` });
        raw.push(...editLines(e));
      });
      break;
    }
    case 'Write': {
      kind = 'diff';
      const next = splitLines(str(obj.content));
      const cur = readForDiff(obj.file_path, opts.cwd, io);
      if (cur.text != null) {
        raw = diffLines(splitLines(cur.text), next);
      } else {
        note = cur.note;
        cut = next.length > PREVIEW_LIMITS.writeHeadLines;
        raw = next.slice(0, PREVIEW_LIMITS.writeHeadLines).map((s) => ({ t: '+', s }));
      }
      break;
    }
    case 'Bash':
      raw = splitLines(str(obj.command)).map((s) => ({ t: ' ', s }));
      if (obj.description) raw.unshift({ t: ' ', s: `# ${oneLineOf(obj.description)}` });
      break;
    default:
      raw = splitLines(jsonText(input)).map((s) => ({ t: ' ', s }));
  }

  const { lines, truncated } = capLines(raw, caps);
  const out = { kind, lines, truncated: truncated || cut };
  if (note) out.note = note;
  return out;
}

function oneLineOf(s) {
  return str(s).replace(/\s+/g, ' ').trim();
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
