// The `send-review` action (fleet plan §10 2.7, R7). REVIEW-REQUIRED (SR20).
//
// A review is a batch of line comments the operator wrote in the diff view.
// It is typed into the lane's Claude session as one message:
//
//   1. strict args (dispatch schema): base / mergeBase / headSha refs, at most
//      100 comments, an optional note. No free path, no command, no file name
//      ever comes from the wire;
//   2. the lane and its session are resolved here (lane.json `session`, else
//      the lane id), never taken from the request;
//   3. every comment path must be in the lane's own diff file list (laneDiff,
//      names only), so a comment cannot point the agent at an arbitrary file;
//   4. the text is built by the shared formatReview (control characters and
//      bidi marks stripped, caps applied); a ReviewFormatError is a 400;
//   5. readiness: a session on a permission or trust dialog is refused with 409
//      (typing would answer the dialog); `working` is allowed, Claude Code
//      queues typed input. Checked last, right before typing, so the window
//      between capture and send stays small;
//   6. a text within review.inlineMaxChars is typed inline (send-text rules:
//      control characters removed). A longer one is written to
//      <lanesDir>/<id>/reviews/<ts>.md (0600, dir 0700, created exclusively,
//      outside the worktree) and only the fixed reviewPointer line is typed;
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
import { BASE_RE } from '../config/review.mjs';
import {
  formatReview, fitsInline, reviewPointer, ReviewFormatError,
  MAX_COMMENTS, MAX_BODY_CHARS, MAX_NOTE_CHARS, MAX_QUOTE_LINES, DEFAULT_INLINE_MAX_CHARS,
} from '../../public/js/core/review-format.js';

export const ACTION = 'send-review';
/** States in which typing would answer a prompt instead of reaching Claude. */
export const PROMPT_STATES = Object.freeze(['waiting_permission', 'waiting_question']);
/** promptReadiness() values that mean a dialog is on screen. */
export const DIALOG_READINESS = Object.freeze(['trust_dialog', 'dialog']);
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
  const session = typeof rec?.session === 'string' && rec.session ? rec.session : id;
  return { rec, live, session, branch: rec?.branch ?? live?.branch ?? null };
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

/** Refuse (409) when the session is on a prompt; `working` passes. Fail safe: unknown means refuse. */
export async function checkReadiness(session, d) {
  const onPrompt = () => new ActionRefused(409, 'prompting', 'session is on a prompt; answer it first', { ok: false, skipped: 'prompting' });
  if (!session?.paneId) throw new ActionRefused(409, 'no_pane', 'the session has no pane');
  if (PROMPT_STATES.includes(session.state) || session.awaitingApproval) throw onPrompt();
  if (typeof d.state?.promptReadiness !== 'function' || typeof d.capturePane !== 'function') throw onPrompt();
  let lines;
  try {
    lines = await d.capturePane(session.paneId, { ansi: true });
  } catch {
    throw onPrompt();
  }
  const r = d.state.promptReadiness(Array.isArray(lines) ? lines : []);
  if (DIALOG_READINESS.includes(r)) throw onPrompt();
}

function inside(child, root) {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Write `text` to <lanesDir>/<id>/reviews/<ts>.md: dir 0700, file 0600,
 * created exclusively (never through an existing file or symlink), and the
 * real directory must lie inside realpath(lanesDir). Returns the absolute path.
 */
export async function writeReviewFile(lanesDir, id, text, ts) {
  if (typeof lanesDir !== 'string' || !path.isAbsolute(lanesDir)) throw new ActionRefused(500, 'internal', 'lanesDir is not configured');
  const dir = path.join(lanesDir, id, 'reviews');
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const realRoot = await fsp.realpath(lanesDir);
  const realDir = await fsp.realpath(dir);
  if (!inside(realDir, realRoot) || realDir !== path.join(realRoot, id, 'reviews')) {
    throw new ActionRefused(500, 'review_dir', 'the review directory is not inside lanesDir');
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
  for (let i = 0; i < 20; i++) {
    const file = path.join(realDir, `${ts}${i ? `-${i}` : ''}.md`);
    let fh;
    try {
      fh = await fsp.open(file, flags, 0o600);
    } catch (err) {
      if (err?.code === 'EEXIST') continue;
      throw err;
    }
    try {
      await fh.writeFile(text, 'utf8');
    } finally {
      await fh.close();
    }
    return file;
  }
  throw new ActionRefused(409, 'review_file', 'could not pick a review file name');
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
