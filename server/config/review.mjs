// Config fragment: review workflow (fleet plan §10, R1; §7 O10 reads
// review.overdueHours).
//
//   review       {overdueHours   open review wait older than this raises
//                                `review-overdue` (§7 O10)
//                 base           the ref a lane's diff is taken against;
//                                per repo: repos[].base
//                 inlineMaxChars above this, send-review writes a file
//                                (send-text is capped at 8000)
//                 diff           caps for server/review/diff.mjs
//                 generated      globs whose diff is deferred (lock files...)
//                 postToGitHub   phase 2, off}
//   transcript   {tailMaxBytes, maxEntries, textCap} for the transcript tail
//
// The `repos[]` entries are a core key (server/config.mjs), and P2's
// server/config/packages.mjs validates its own additions on them. This
// fragment validates only two more per-repo keys:
//   base?     a ref matching BASE_RE
//   scripts?  {name: command}: the ONLY commands `run-script` may run. Names
//             match SCRIPT_NAME_RE, at most MAX_SCRIPTS per repo; a command is
//             a non-empty string of at most SCRIPT_MAX_CHARS with no NUL,
//             newline or other control character (tab allowed). They come
//             only from this builder's own config file: there is no env
//             layer, and finalize replaces each scripts object with a frozen,
//             null-prototype copy so a lookup like scripts['constructor']
//             finds nothing and nothing at run time can add or change one.
//
// Every default leaves an old config loading unchanged. This file must not
// import server/config.mjs (see the fragment notes there).
import { globError } from '../packages/glob.mjs';

/** A diff base: an origin/ ref or a commit sha (the same rule diff.mjs uses). */
export const BASE_RE = /^(origin\/[A-Za-z0-9._/-]{1,100}|[0-9a-f]{7,40})$/;
export const SCRIPT_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;
export const MAX_SCRIPTS = 12;
export const SCRIPT_MAX_CHARS = 500;
/** send-text's own cap (server/actions.mjs); an inline review must fit under it. */
export const SEND_TEXT_MAX = 8000;

export const DEFAULT_GENERATED = Object.freeze(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '*.lock', '*.min.js', '*.map']);

const MiB = 1024 * 1024;
const KiB = 1024;

/** Upper bounds for the integer caps, so a typo cannot ask for gigabytes. */
export const LIMITS = Object.freeze({
  'review.diff.maxFiles': 5000,
  'review.diff.maxBytes': 64 * MiB,
  'review.diff.maxFileBytes': 16 * MiB,
  'review.diff.maxFileLines': 100000,
  'review.diff.maxUntracked': 5000,
  'review.diff.timeoutMs': 120000,
  'transcript.tailMaxBytes': 16 * MiB,
  'transcript.maxEntries': 2000,
  'transcript.textCap': 100000,
});

export function defaults() {
  return {
    review: {
      overdueHours: 4,
      base: 'origin/main',
      inlineMaxChars: 7000,
      diff: {
        maxFiles: 300,
        maxBytes: 2 * MiB,
        maxFileBytes: 256 * KiB,
        maxFileLines: 4000,
        maxUntracked: 200,
        timeoutMs: 15000,
      },
      generated: [...DEFAULT_GENERATED],
      postToGitHub: false,
    },
    transcript: { tailMaxBytes: 1 * MiB, maxEntries: 200, textCap: 4000 },
  };
}

/** No env layer: scripts and review settings come only from the config file. */
export function fromEnv() {
  return {};
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const J = (v) => JSON.stringify(v) ?? String(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A plain JSON object (from JSON.parse or a literal), not a class instance. */
function isPlain(v) {
  if (!isObj(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** null when `ref` is an acceptable diff base, else why. */
export function baseProblem(ref) {
  if (typeof ref !== 'string' || ref === '') return 'must be a non-empty string';
  if (!BASE_RE.test(ref)) return 'must be "origin/<branch>" or a commit sha';
  if (ref.split('/').some((s) => s === '' || s === '.' || s === '..') || ref.includes('..') || ref.endsWith('.lock') || ref.endsWith('/')) {
    return 'is not a valid git ref name';
  }
  return null;
}

/** null when `name` is an acceptable script name, else why. */
export function scriptNameProblem(name) {
  if (typeof name !== 'string' || !SCRIPT_NAME_RE.test(name)) return `must match ${SCRIPT_NAME_RE}`;
  return null;
}

/** null when `cmd` is an acceptable script command, else why. */
export function scriptCommandProblem(cmd) {
  if (typeof cmd !== 'string' || cmd.trim() === '') return 'must be a non-empty string';
  if (cmd.length > SCRIPT_MAX_CHARS) return `must be at most ${SCRIPT_MAX_CHARS} characters`;
  if (cmd.includes('\0')) return 'must not contain a NUL byte';
  if (/[\r\n\u2028\u2029]/.test(cmd)) return 'must be one line (no newline)';
  // eslint-disable-next-line no-control-regex
  if (/[\x01-\x08\x0b-\x1f\x7f]/.test(cmd)) return 'must not contain control characters';
  return null;
}

/**
 * Replace each repos[].scripts plain object with a frozen null-prototype copy
 * of its own keys. Tolerates wrong types (validate reports them).
 */
export function finalize(c) {
  if (!Array.isArray(c.repos)) return c;
  for (const r of c.repos) {
    if (!isObj(r) || !isPlain(r.scripts)) continue;
    const copy = Object.create(null);
    for (const k of Object.keys(r.scripts)) copy[k] = r.scripts[k];
    r.scripts = Object.freeze(copy);
  }
  return c;
}

function int(bad, key, v, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) bad(`${key} must be an integer from ${lo} to ${hi}, got ${J(v)}`);
}

function checkReview(rv, bad) {
  if (!isObj(rv)) bad(`review must be an object, got ${J(rv)}`);
  if (!isNum(rv.overdueHours) || rv.overdueHours <= 0 || rv.overdueHours > 24 * 30) {
    bad(`review.overdueHours must be a positive number of hours (at most ${24 * 30}), got ${J(rv.overdueHours)}`);
  }
  const why = baseProblem(rv.base);
  if (why) bad(`review.base ${why}, got ${J(rv.base)}`);
  int(bad, 'review.inlineMaxChars', rv.inlineMaxChars, 1, SEND_TEXT_MAX);

  const d = rv.diff;
  if (!isObj(d)) bad(`review.diff must be an object, got ${J(d)}`);
  for (const k of ['maxFiles', 'maxBytes', 'maxFileBytes', 'maxFileLines', 'maxUntracked', 'timeoutMs']) {
    int(bad, `review.diff.${k}`, d[k], k === 'maxUntracked' ? 0 : 1, LIMITS[`review.diff.${k}`]);
  }
  if (d.maxFileBytes > d.maxBytes) bad(`review.diff.maxFileBytes (${d.maxFileBytes}) must not exceed review.diff.maxBytes (${d.maxBytes})`);
  if (d.timeoutMs < 1000) bad(`review.diff.timeoutMs must be at least 1000, got ${J(d.timeoutMs)}`);

  const g = rv.generated;
  if (!Array.isArray(g) || g.some((x) => typeof x !== 'string' || x === '')) {
    bad(`review.generated must be a list of non-empty glob strings, got ${J(g)}`);
  }
  for (const glob of g) {
    const gwhy = globError(glob);
    if (gwhy) bad(`review.generated entry ${J(glob)} is not a valid glob: ${gwhy}`);
  }
  if (typeof rv.postToGitHub !== 'boolean') bad(`review.postToGitHub must be true or false, got ${J(rv.postToGitHub)}`);
}

function checkTranscript(t, bad) {
  if (!isObj(t)) bad(`transcript must be an object, got ${J(t)}`);
  for (const k of ['tailMaxBytes', 'maxEntries', 'textCap']) {
    int(bad, `transcript.${k}`, t[k], 1, LIMITS[`transcript.${k}`]);
  }
  if (t.tailMaxBytes < 4096) bad(`transcript.tailMaxBytes must be at least 4096, got ${J(t.tailMaxBytes)}`);
}

function checkScripts(s, at, bad) {
  if (!isPlain(s)) bad(`${at}.scripts must be an object of {name: command}, got ${J(s)}`);
  const names = Object.keys(s);
  if (Object.getOwnPropertySymbols(s).length) bad(`${at}.scripts must only have string keys`);
  if (names.length > MAX_SCRIPTS) bad(`${at}.scripts has ${names.length} entries, at most ${MAX_SCRIPTS} are allowed`);
  for (const name of names) {
    const nwhy = scriptNameProblem(name);
    if (nwhy) bad(`${at}.scripts name ${J(name)} ${nwhy}`);
    const cwhy = scriptCommandProblem(s[name]);
    if (cwhy) bad(`${at}.scripts.${name} ${cwhy}`);
  }
}

function checkRepo(r, i, bad) {
  const at = `repos[${i}] (${J(r.name)})`;
  if (hasOwn(r, 'base') && r.base !== undefined) {
    const why = baseProblem(r.base);
    if (why) bad(`${at}.base ${why}, got ${J(r.base)}`);
  }
  if (hasOwn(r, 'scripts') && r.scripts !== undefined) checkScripts(r.scripts, at, bad);
}

export function validate(c, bad) {
  checkReview(c.review, bad);
  checkTranscript(c.transcript, bad);
  // The core already refused a non-list and nameless entries.
  if (Array.isArray(c.repos)) c.repos.forEach((r, i) => checkRepo(r, i, bad));
}
