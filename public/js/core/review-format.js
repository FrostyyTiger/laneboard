// Review message format and pull-to-local commands (plan §10 2.6, task R3).
//
// Pure ES module: no imports, no DOM, no globals beyond the language, so the
// browser (diff view, send sheet, Pull popover) and the builder
// (server/review/actions.mjs imports ../../public/js/core/review-format.js)
// share one implementation and node --test can import it directly.
//
// Trust: everything here is untrusted text. Quotes come from a builder's diff,
// branch/repo/lane names come from a builder's snapshot, bodies and notes are
// typed by a person. The review text is typed into an agent's terminal, and
// the pull commands are pasted into the user's own shell, so:
//   - formatReview strips control characters (ESC, C1, DEL, bidi overrides)
//     from every part before it goes into the text;
//   - pullCommands validates every input against a strict allowlist and
//     returns NO command at all when any check fails (security review S11a);
//     values that pass are still single-quoted with shq.

/** Default for config.review.inlineMaxChars (server/config/review.mjs). */
export const DEFAULT_INLINE_MAX_CHARS = 7000;

export const MAX_COMMENTS = 100;
export const MAX_QUOTE_LINES = 12;
export const MAX_QUOTE_LINE_CHARS = 200;
export const MAX_BODY_CHARS = 2000;
export const MAX_NOTE_CHARS = 2000;
const MAX_PATH_CHARS = 4096;
const MAX_REF_CHARS = 200;
const ELLIPSIS = '…';

const ERROR_NAME = 'ReviewFormatError';

/** The error thrown for a comment that cannot be placed. */
export function ReviewFormatError(message) {
  const e = new Error(message);
  e.name = ERROR_NAME;
  Object.setPrototypeOf(e, ReviewFormatError.prototype);
  return e;
}
ReviewFormatError.prototype = Object.create(Error.prototype, {
  constructor: { value: ReviewFormatError, writable: true, configurable: true },
  name: { value: ERROR_NAME, writable: true, configurable: true },
});

// ---------------------------------------------------------------------------
// Quoting and cleaning

/** POSIX single-quote, same rule as server/actions.mjs shellQuote. */
export function shq(s) {
  return "'" + String(s).split("'").join("'\\''") + "'";
}

// C0 controls except TAB and LF, DEL, C1 controls (ESC is in C0), plus the
// bidi embedding/override/isolate marks that can make text read differently
// from what it is (CVE-2021-42574 "trojan source").
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex
const ANY_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;

/**
 * Multi-line text: CRLF and lone CR become LF, then control characters are
 * stripped (TAB and LF survive). Backticks and quotes are kept as typed.
 */
export function cleanText(s) {
  if (s == null) return '';
  return String(s).replace(/\r\n?/g, '\n').replace(STRIP_RE, '');
}

/** One line: like cleanText, but line breaks and tabs become spaces. */
export function cleanLine(s) {
  return cleanText(s).replace(/[\n\t]/g, ' ');
}

function cap(s, n) {
  return s.length > n ? s.slice(0, n - 1) + ELLIPSIS : s;
}

// ---------------------------------------------------------------------------
// Review message

function shortSha(s) {
  const v = cleanLine(s).trim();
  if (/^[0-9a-f]{7,64}$/i.test(v)) return v.slice(0, 7).toLowerCase();
  return cap(v, 40) || '?';
}

function isPosInt(n) {
  return Number.isSafeInteger(n) && n > 0;
}

function validPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH_CHARS && !ANY_CONTROL_RE.test(p);
}

/**
 * Validate and normalize one comment. Throws ReviewFormatError on a comment
 * that cannot be placed (bad path, path not in the diff, bad line numbers);
 * text parts are cleaned, never rejected.
 */
function normalizeComment(c, i, fileSet) {
  const where = `comment ${i + 1}`;
  if (!c || typeof c !== 'object') throw ReviewFormatError(`${where}: not an object`);
  if (!validPath(c.path)) throw ReviewFormatError(`${where}: invalid path`);
  if (fileSet && !fileSet.has(c.path)) throw ReviewFormatError(`${where}: path is not in the diff`);
  const side = c.side == null ? 'new' : c.side;
  if (side !== 'new' && side !== 'old') throw ReviewFormatError(`${where}: side must be 'new' or 'old'`);
  if (!isPosInt(c.line)) throw ReviewFormatError(`${where}: line must be a positive integer`);
  let endLine = c.endLine == null ? c.line : c.endLine;
  if (!isPosInt(endLine) || endLine < c.line) throw ReviewFormatError(`${where}: invalid endLine`);

  const rawQuote = Array.isArray(c.quote) ? c.quote : (c.quote == null ? [] : String(c.quote).split('\n'));
  const quote = rawQuote.slice(0, MAX_QUOTE_LINES).map((l) => cap(cleanLine(l), MAX_QUOTE_LINE_CHARS));
  const quoteMore = Math.max(0, rawQuote.length - MAX_QUOTE_LINES);

  const body = cap(cleanText(c.body).trim(), MAX_BODY_CHARS);
  return { path: c.path, side, line: c.line, endLine, quote, quoteMore, body };
}

function compareComments(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.endLine !== b.endLine) return a.endLine - b.endLine;
  if (a.side !== b.side) return a.side === 'old' ? -1 : 1;
  return a.idx - b.idx;
}

function indentLines(text, prefix) {
  return text.split('\n').map((l) => (l ? prefix + l : prefix.trimEnd())).join('\n');
}

/**
 * Build the review text typed into the lane's session.
 *
 *   REVIEW of feat/x (origin/main @ 1a2b3c4 .. 5e6f7a8), 3 comments.
 *   Address each comment, commit, then print DONE: or NEED-HUMAN:.
 *
 *   1. src/a.js:42-44
 *      > const x = y;
 *      Rename x; it shadows the import.
 *
 * `files` (optional, array or Set of the lane's diff paths): when given, a
 * comment whose path is not in it throws. `lane` is accepted for the caller's
 * convenience and not printed.
 */
export function formatReview({ lane, branch, base, mergeBase, headSha, comments, note, files } = {}) {
  void lane;
  const list = Array.isArray(comments) ? comments : [];
  if (list.length > MAX_COMMENTS) throw ReviewFormatError(`at most ${MAX_COMMENTS} comments`);
  const fileSet = files == null ? null : new Set(files);
  const norm = list
    .map((c, i) => ({ ...normalizeComment(c, i, fileSet), idx: i }))
    .sort(compareComments);

  const n = norm.length;
  const head =
    `REVIEW of ${cap(cleanLine(branch).trim(), MAX_REF_CHARS) || '?'} ` +
    `(${cap(cleanLine(base).trim(), MAX_REF_CHARS) || '?'} @ ${shortSha(mergeBase)} .. ${shortSha(headSha)}), ` +
    `${n} comment${n === 1 ? '' : 's'}.`;
  const out = [head, 'Address each comment, commit, then print DONE: or NEED-HUMAN:.'];

  const noteText = cap(cleanText(note).trim(), MAX_NOTE_CHARS);
  if (noteText) out.push('', indentLines(noteText, ''));

  norm.forEach((c, i) => {
    const range = c.endLine > c.line ? `${c.line}-${c.endLine}` : `${c.line}`;
    const lines = [`${i + 1}. ${cleanLine(c.path)}:${range}${c.side === 'old' ? ' (old)' : ''}`];
    for (const q of c.quote) lines.push(`   > ${q}`.trimEnd());
    if (c.quoteMore) lines.push(`   > ${ELLIPSIS} (${c.quoteMore} more line${c.quoteMore === 1 ? '' : 's'})`);
    if (c.body) lines.push(indentLines(c.body, '   '));
    out.push('', lines.join('\n'));
  });
  return out.join('\n') + '\n';
}

/** True when the formatted text may be typed inline (send-review step 3). */
export function fitsInline(text, inlineMaxChars = DEFAULT_INLINE_MAX_CHARS) {
  const max = isPosInt(inlineMaxChars) ? inlineMaxChars : DEFAULT_INLINE_MAX_CHARS;
  return String(text).length <= max;
}

/**
 * The only text typed when the review is too long and was written to a file
 * (send-review step 4). `file` must be an absolute path without control
 * characters; it is server-generated, but checked anyway.
 */
export function reviewPointer(count, file) {
  if (!Number.isSafeInteger(count) || count < 0) throw ReviewFormatError('invalid comment count');
  if (!validPath(file) || !file.startsWith('/')) throw ReviewFormatError('invalid review file path');
  return `REVIEW with ${count} comment${count === 1 ? '' : 's'} is in ${file}. ` +
    'Read it fully, address each comment, commit, then print DONE:.';
}

// ---------------------------------------------------------------------------
// Pull-to-local commands (copy only; nothing is executed)

// server/lanes/launch.mjs BRANCH_RE, server/lanes/store.mjs LANE_ID_RE.
// Copied, not imported: this module must stay importable in the browser.
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;
const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const CI_REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const PR_RE = /^[1-9][0-9]{0,9}$/;

export function isPullBranch(b) {
  return typeof b === 'string' && BRANCH_RE.test(b) && !b.startsWith('-') && !b.includes('..') &&
    !b.includes('//') && !b.endsWith('/') && !b.endsWith('.') && !b.endsWith('.lock') && !b.includes('/.');
}
export function isPullRepo(r) {
  return typeof r === 'string' && REPO_RE.test(r) && !r.startsWith('-') && r !== '.' && r !== '..';
}
export function isPullLaneId(id) {
  return typeof id === 'string' && LANE_ID_RE.test(id) && !id.includes('..');
}
export function isCiRepo(s) {
  return typeof s === 'string' && s.length <= 200 && CI_REPO_RE.test(s) && !s.startsWith('-') && !s.includes('..');
}
function prNumber(pr) {
  if (typeof pr === 'number') return Number.isSafeInteger(pr) && pr > 0 ? pr : null;
  if (typeof pr === 'string' && PR_RE.test(pr)) return Number(pr);
  return null;
}

/**
 * Copyable commands to pull a lane's branch to the laptop.
 *
 * `branch`, `repo` and `laneId` are required; `pr` and `ciRepo` are optional,
 * but when present they must be valid too. If ANY check fails the result is
 * [] (no partial output). `local: true` means the branch already exists in the
 * local clone, so no fetch is needed.
 */
export function pullCommands({ repo, branch, laneId, pr, ciRepo, local = false } = {}) {
  if (!isPullBranch(branch) || !isPullRepo(repo) || !isPullLaneId(laneId)) return [];
  let prNum = null;
  if (pr != null) {
    prNum = prNumber(pr);
    if (prNum == null) return [];
  }
  if (ciRepo != null && !isCiRepo(ciRepo)) return [];

  const dir = `../${repo}-${laneId}`;
  const cmds = [];
  if (local === true) {
    cmds.push({ label: 'Worktree from the local branch', cmd: `git worktree add ${shq(dir)} ${shq(branch)}` });
  } else {
    cmds.push({
      label: 'Fetch the branch into a new worktree',
      cmd: `git fetch origin ${shq(branch)} && git worktree add --track -b ${shq(branch)} ${shq(dir)} ${shq('origin/' + branch)}`,
    });
  }
  if (prNum != null && ciRepo != null) {
    cmds.push({ label: `Check out PR #${prNum}`, cmd: `gh pr checkout ${prNum} --repo ${shq(ciRepo)}` });
  }
  return cmds;
}
