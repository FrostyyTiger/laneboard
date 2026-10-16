// The `send-review` action (fleet plan §10 2.7, R7). REVIEW-REQUIRED (SR20).
//
// A review is a batch of line comments the operator wrote in the diff view.
// It is typed into the lane's Claude session as one message:
//
//   1. strict args (dispatch schema): base / mergeBase / headSha refs, at most
//      100 comments, an optional note. No free path, no command, no file name
//      ever comes from the wire;
//   2. the lane and its session are resolved here (lane.json `session`, else
//      the lane's only live session), never taken from the request, and the
//      session must be one of the lane's own live sessions (SR20 L2);
//   3. every comment path must be in the lane's own diff file list (laneDiff,
//      names only), so a comment cannot point the agent at an arbitrary file;
//   4. the text is built by the shared formatReview (control characters and
//      bidi marks stripped, caps applied); a ReviewFormatError is a 400;
//   5. readiness (SR20 M1): the session must be a live Claude (kind claude,
//      not shell/dead/unknown, pane command `claude`), else 409 not_claude; a
//      session on a permission or trust dialog is refused with 409 (typing
//      would answer the dialog); the screen must be the ready input box, or
//      the session `working` (Claude Code queues typed input). Checked last,
//      on the freshest session state, right before typing; the text and its
//      Enter then go out in one tmux invocation (SR20 L3);
//   6. a text within review.inlineMaxChars is typed inline (send-text rules:
//      control characters removed). A longer one is written to
//      <lanesDir>/<id>/reviews/<ts>.md (0600, dir 0700, created exclusively,
//      outside the worktree, no symlinked component, realpath re-checked after
//      the create: SR20 L5) and only the fixed reviewPointer line is typed;
//   7. review.sentAt[lane] is set (server/collector/review.mjs setReviewSent).
//
// The dispatcher audits the call (argsHash over the args the text is built
// from); the result carries `textHash`, the sha256 of the exact text typed or
// written, so the audit outcome and the delivered text can be matched up.
//
// Deps are injected ({state, actions, capturePane, laneDiff, setReviewSent,
// readLane, liveLanes, config, now}) so tests stub tmux and git; the deps a
// dispatch() call carries win over the ones given to registerSendReview.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { registerAction, has, ActionRefused, cleanTypedText } from '../fleet/dispatch.mjs';
import { assertTypable, DIALOG_READINESS as TYPABLE_DIALOGS } from '../fleet/builtin-actions.mjs';
import { BASE_RE } from '../config/review.mjs';
import {
  formatReview, fitsInline, reviewPointer, ReviewFormatError,
  MAX_COMMENTS, MAX_BODY_CHARS, MAX_NOTE_CHARS, MAX_QUOTE_LINES, DEFAULT_INLINE_MAX_CHARS,
} from '../../public/js/core/review-format.js';

export const ACTION = 'send-review';
/** States in which typing would answer a prompt instead of reaching Claude. */
export const PROMPT_STATES = Object.freeze(['waiting_permission', 'waiting_question']);
/** promptReadiness() values that mean a dialog is on screen. */
export const DIALOG_READINESS = TYPABLE_DIALOGS;
/** send-text's own cap (server/actions.mjs sendText). */
const SEND_TEXT_MAX = 8000;
const SHA_RE = /^[0-9a-f]{7,64}$/;
const MAX_PATH_CHARS = 4096;
const MAX_QUOTE_LINE_IN = 1000;

const comment = {
  type: 'object',
  fields: {
    path: { type: 'string', required: true, min: 1, max: MAX_PATH_CHARS },
    side: { type: 'string', enum: ['new', 'old'], default: 'new' },
    line: { type: 'integer', required: true, min: 1, max: 10_000_000 },
    endLine: { type: 'integer', min: 1, max: 10_000_000 },
    quote: { type: 'array', max: MAX_QUOTE_LINES, default: [], items: { type: 'string', max: MAX_QUOTE_LINE_IN } },
    body: { type: 'string', required: true, max: MAX_BODY_CHARS },
  },
  check: (c) => (c.endLine !== undefined && c.endLine < c.line ? 'endLine is before line' : null),
};

/** The strict args schema of send-review (README §3.5). */
export const ARGS = Object.freeze({
  review: {
    type: 'object',
    required: true,
    fields: {
      base: { type: 'string', required: true, min: 1, max: 120, re: BASE_RE },
      mergeBase: { type: 'string', required: true, re: SHA_RE },
      headSha: { type: 'string', required: true, re: SHA_RE },
      comments: { type: 'array', required: true, max: MAX_COMMENTS, items: comment },
      note: { type: 'string', max: MAX_NOTE_CHARS },
    },
    check: (r) => (r.comments.length === 0 && !(typeof r.note === 'string' && r.note.trim()) ? 'a review needs a comment or a note' : null),
  },
});

let captured = {};

function D(deps) {
  return { ...captured, ...(deps ?? {}) };
}

function cfgOf(config, d) {
  if (config && typeof config === 'object' && Object.keys(config).length) return config;
  return d.config ?? {};
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** {rec, live, session, branch} of lane `id`; 404 when it is unknown. */
export async function resolveLane(id, d) {
  const rec = typeof d.readLane === 'function' ? d.readLane(id) : null;
  let live = null;
  if (typeof d.liveLanes === 'function') {
    try { live = (await d.liveLanes())?.find((l) => l && l.id === id) ?? null; } catch { live = null; }
  }
  if (!rec && !live) throw new ActionRefused(404, 'unknown_lane', 'no such lane');
  if (rec?.retiredAt) throw new ActionRefused(409, 'retired', 'the lane is retired');
  return { rec, live, session: laneSession(id, rec, live), branch: rec?.branch ?? live?.branch ?? null };
}

/**
 * The lane's session (SR20 L2): lane.json's `session` when it is one of the
 * lane's own live sessions (the collector's `sessions`: sessions whose
 * directory is in the lane); without one, the lane's only live session, or
 * the one named like the lane among them. A name alone never binds: a session
 * of that name in another directory is refused.
 */
export function laneSession(id, rec, live) {
  const own = Array.isArray(live?.sessions) ? live.sessions.filter((n) => typeof n === 'string' && n) : [];
  if (typeof rec?.session === 'string' && rec.session) {
    if (own.includes(rec.session)) return rec.session;
    throw new ActionRefused(409, 'session_not_in_lane', "the lane's session is not running in the lane");
  }
  if (own.length === 1) return own[0];
  if (own.includes(id)) return id;
  if (!own.length) throw new ActionRefused(404, 'unknown_session', 'the lane has no live session');
  throw new ActionRefused(409, 'ambiguous_session', 'the lane has several sessions and none is named in lane.json');
}

/**
 * The lane's diff paths (new and old names) against `base`: names only
 * (maxFiles 0: no patch is read). Worktree lanes add the committed view, so a
 * comment made in either mode places. DiffError statuses pass through.
 */
export async function diffPaths(laneId, base, d, config) {
  if (typeof d.laneDiff !== 'function') throw new ActionRefused(500, 'internal', 'no diff source');
  const caps = { ...(config.review?.diff ?? {}), maxFiles: 0, maxUntracked: 0 };
  const paths = new Set();
  const add = (r) => {
    for (const f of r?.files ?? []) {
      if (typeof f.path === 'string') paths.add(f.path);
      if (typeof f.oldPath === 'string' && f.oldPath) paths.add(f.oldPath);
    }
  };
  const call = async (mode) => {
    try {
      return await d.laneDiff({ laneId, base, mode, caps });
    } catch (err) {
      if (Number.isInteger(err?.status)) throw new ActionRefused(err.status, err.status === 429 ? 'busy' : 'diff', String(err.message || 'diff failed'));
      throw err;
    }
  };
  const all = await call('all');
  add(all);
  if (all?.source === 'worktree') add(await call('committed'));
  return paths;
}

/**
 * Refuse (409) unless typing reaches a live Claude now (SR20 M1): not_claude
 * for a shell/dead/unknown session or a pane not running claude, prompting for
 * a prompt state, awaitingApproval, a dialog, or a screen that is neither the
 * ready box nor `working`. Fail safe: unknown means refuse. The session is
 * re-read from state first, so the hook state is the freshest one (SR20 L3).
 * Returns the session it checked.
 */
export async function checkReadiness(session, d) {
  const fresh = session?.name && typeof d.state?.get === 'function' ? d.state.get(session.name) : session;
  if (!fresh) throw new ActionRefused(404, 'unknown_session', 'the lane has no live session');
  if (typeof d.capturePane !== 'function') throw new ActionRefused(409, 'prompting', 'session is on a prompt; answer it first', { ok: false, skipped: 'prompting' });
  await assertTypable(fresh, { state: d.state, capturePane: d.capturePane });
  return fresh;
}

function inside(child, root) {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const sameNode = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;

/** mkdir one component (0700) and require a real directory, not a symlink, there. */
async function ownDir(p) {
  try {
    await fsp.mkdir(p, { mode: 0o700 });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  const st = await fsp.lstat(p);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new ActionRefused(500, 'review_dir', 'the review directory is not inside lanesDir');
  return st;
}

/**
 * Write `text` to <lanesDir>/<id>/reviews/<ts>.md: dir 0700, file 0600,
 * created exclusively (never through an existing file or symlink), and the
 * real directory must lie inside realpath(lanesDir). Returns the absolute path.
 *
 * SR20 L5: no component below realpath(lanesDir) may be a symlink; the
 * directory is opened with O_DIRECTORY|O_NOFOLLOW and the file is created
 * relative to that descriptor (/proc/self/fd/<fd>/<name>, Linux's openat),
 * so swapping a component for a symlink after the check cannot move it. Before
 * any byte is written, the path is re-verified (realpath, and the directory
 * and file at the path are the very ones opened); a mismatch removes the new,
 * still empty file and refuses.
 */
export async function writeReviewFile(lanesDir, id, text, ts) {
  if (typeof lanesDir !== 'string' || !path.isAbsolute(lanesDir)) throw new ActionRefused(500, 'internal', 'lanesDir is not configured');
  const bad = () => new ActionRefused(500, 'review_dir', 'the review directory is not inside lanesDir');
  await fsp.mkdir(lanesDir, { recursive: true, mode: 0o700 });
  const realRoot = await fsp.realpath(lanesDir);
  const realDir = path.join(realRoot, id, 'reviews');
  if (!inside(realDir, realRoot)) throw bad();
  await ownDir(path.join(realRoot, id));
  await ownDir(realDir);
  const C = fs.constants;
  let dh;
  try {
    dh = await fsp.open(realDir, C.O_RDONLY | (C.O_DIRECTORY ?? 0) | (C.O_NOFOLLOW ?? 0));
  } catch (err) {
    if (err?.code === 'ELOOP' || err?.code === 'ENOTDIR') throw bad();
    throw err;
  }
  try {
    const dirSt = await dh.stat();
    if (!dirSt.isDirectory()) throw bad();
    const viaFd = `/proc/self/fd/${dh.fd}`;
    let base = realDir;
    try {
      if (sameNode(await fsp.stat(viaFd), dirSt)) base = viaFd;
    } catch { /* no /proc: path plus the re-check below */ }
    const flags = C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW ?? 0);
    for (let i = 0; i < 20; i++) {
      const name = `${ts}${i ? `-${i}` : ''}.md`;
      const file = path.join(realDir, name);
      let fh;
      try {
        fh = await fsp.open(path.join(base, name), flags, 0o600);
      } catch (err) {
        if (err?.code === 'EEXIST') continue;
        throw err;
      }
      try {
        const fileSt = await fh.stat();
        let ok = false;
        try {
          ok = (await fsp.realpath(file)) === file
            && sameNode(await fsp.lstat(realDir), dirSt)
            && sameNode(await fsp.lstat(file), fileSt)
            && (await fsp.realpath(lanesDir)) === realRoot;
        } catch { ok = false; }
        if (!ok) {
          await fsp.unlink(path.join(base, name)).catch(() => {});
          throw bad();
        }
        await fh.writeFile(text, 'utf8');
      } finally {
        await fh.close();
      }
      return file;
    }
    throw new ActionRefused(409, 'review_file', 'could not pick a review file name');
  } finally {
    await dh.close();
  }
}

/**
 * The action body. -> {ok, inline, file?, comments, chars, textHash}
 */
export async function sendReview({ target, args, user, deps, config }) {
  const d = D(deps);
  const cfg = cfgOf(config, d);
  const id = target;
  const review = args.review;
  const now = typeof d.now === 'function' ? d.now : Date.now;

  const lane = await resolveLane(id, d);
  const session = typeof d.state?.get === 'function' ? d.state.get(lane.session) : null;
  if (!session) throw new ActionRefused(404, 'unknown_session', 'the lane has no live session');

  const files = review.comments.length ? await diffPaths(id, review.base, d, cfg) : new Set();
  let text;
  try {
    text = formatReview({
      lane: id,
      branch: lane.branch ?? id,
      base: review.base,
      mergeBase: review.mergeBase,
      headSha: review.headSha,
      comments: review.comments,
      note: review.note,
      files,
    });
  } catch (err) {
    if (err instanceof ReviewFormatError || err?.name === 'ReviewFormatError') throw new ActionRefused(400, 'bad_review', String(err.message));
    throw err;
  }
  const typedText = cleanTypedText(text, true).replace(/\n+$/, '');
  const inlineMax = Math.min(SEND_TEXT_MAX, Number.isSafeInteger(cfg.review?.inlineMaxChars) && cfg.review.inlineMaxChars > 0 ? cfg.review.inlineMaxChars : DEFAULT_INLINE_MAX_CHARS);
  const inline = fitsInline(typedText, inlineMax);
  const n = review.comments.length;

  let file;
  let typed;
  if (inline) {
    typed = typedText;
  } else {
    file = await writeReviewFile(cfg.lanesDir, id, text, now());
    typed = reviewPointer(n, file);
  }
  try {
    // Last check before typing (the capture/send race stays as small as possible).
    await checkReadiness(session, d);
    await d.actions.sendText(lane.session, typed, true, user);
  } catch (err) {
    if (file) await fsp.rm(file, { force: true }).catch(() => {});
    throw err;
  }
  if (typeof d.setReviewSent === 'function') d.setReviewSent(id, now());
  const out = { ok: true, inline, comments: n, chars: text.length, textHash: sha256(inline ? typed : text) };
  if (file) out.file = file;
  return out;
}

/**
 * Register send-review with the dispatcher (tier ask, target lane). Safe to
 * call more than once: later calls only replace the default deps.
 */
export function registerSendReview(deps = {}) {
  captured = { ...deps };
  if (has(ACTION)) return false;
  registerAction(ACTION, {
    tier: 'ask',
    target: 'lane',
    args: ARGS,
    run: sendReview,
  });
  return true;
}

/** Tests only. */
export function _resetDeps() {
  captured = {};
}
