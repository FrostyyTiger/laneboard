// Builder lane diff (fleet plan §10 2.2, R2).
//
// laneDiff() returns one lane's diff against its base as structured data: a
// file list from `git diff --numstat -z` and `--name-status -z`, then the
// unified diff of the files that fit the caps, parsed into hunks and lines.
// Everything in the result (file names included) is untrusted text written by
// the agent; it is returned as plain strings and never as HTML. Escaping is
// the renderer's job.
//
// Read-only by construction:
//   - never fetch (as progress.mjs): a remote lane is diffed against the
//     already-fetched origin/<branch>, and a missing ref is a 404;
//   - plumbing only: `git diff-index <mb>` for the working tree (it compares
//     content and never refreshes or writes the index, unlike porcelain
//     `git diff`, which rewrites a stat-dirty index even with
//     GIT_OPTIONAL_LOCKS=0 on git 2.43) and `git diff-tree -r` for commits,
//     plus GIT_OPTIONAL_LOCKS=0 everywhere, so no index.lock ever appears in
//     a worktree an agent is using;
//   - core.fsmonitor off, no external diff, no textconv, so the repo's own
//     config does not get to run a program for a read.
// Refs come only from BASE_RE-validated input or resolved shas, always after
// --end-of-options. Paths reach git only as literal pathspecs after `--`, and
// a client path is used only when it is in the numstat list.
//
// Caps (config.review.diff): maxFiles files get patches, the patch total is
// estimated against maxBytes before the run and checked after it, and each
// file stops at maxFileLines / maxFileBytes. Generated files (review.generated)
// and files over the budget are `deferred`: listed, loaded one by one with
// `path`. At most one diff runs at a time; a second gets a 429.
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../util.mjs';
import { config } from '../config.mjs';
import { BASE_RE, baseProblem, defaults } from '../config/review.mjs';
import { compileGlob } from '../packages/glob.mjs';
import * as store from '../lanes/store.mjs';

export { BASE_RE };

const KiB = 1024;
const MiB = 1024 * KiB;
/** Bytes per changed line used to estimate a patch before running it. */
export const AVG_LINE = 100;
/** Headroom over maxBytes for the one-shot patch run (headers, context). */
const PATCH_SLACK = 256 * KiB;
/** Ceiling on the file list itself (names only past maxFiles). */
export const MAX_LISTED = 10000;
const LIST_BUFFER = 32 * MiB;
const PATH_MAX = 4096;

const DEFAULT_CAPS = defaults().review.diff;
const DEFAULT_GENERATED = defaults().review.generated;

export class DiffError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DiffError';
    this.status = status;
  }
}

// --- lane source ------------------------------------------------------------

let lanesSource = null;
/** Inject the live-lane list (tests, or a caller that already has state). */
export function init({ lanes } = {}) {
  lanesSource = typeof lanes === 'function' ? lanes : null;
}

async function liveLanes() {
  if (lanesSource) return lanesSource() ?? [];
  try {
    const state = await import('../state.mjs');
    return state.snapshot().lanes ?? [];
  } catch {
    return [];
  }
}

// --- concurrency gate -------------------------------------------------------

let busy = false;
export function _resetGate() { busy = false; }

// --- git ---------------------------------------------------------------------

const GIT_ENV = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' });

/** Config overrides on every call: nothing in the repo config may run a program or reshape output. */
const GIT_C = [
  '--no-pager', '--literal-pathspecs',
  '-c', 'core.quotepath=off', '-c', 'diff.external=', '-c', 'core.fsmonitor=false',
  '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.relative=false',
  '-c', 'color.ui=false',
];
/** Options on every diff call. */
const DIFF_OPTS = ['--no-ext-diff', '--no-textconv', '--no-color', '-M', '--src-prefix=a/', '--dst-prefix=b/'];

/** {cmd, revs} -> argv with options first, revs after --end-of-options, literal paths after --. */
function diffArgs({ cmd, revs }, extra, specs = null) {
  const flags = cmd === 'diff-tree' ? ['-r'] : [];
  return [cmd, ...flags, ...DIFF_OPTS, ...extra, '--end-of-options', ...revs, ...(specs ? ['--', ...specs] : [])];
}

function makeGit(dir, deadline) {
  return (args, { maxBuffer = 4 * MiB } = {}) => {
    const left = deadline - Date.now();
    if (left <= 0) throw new DiffError('diff timed out', 504);
    return run('git', ['-C', dir, ...GIT_C, ...args], { timeout: left, maxBuffer, env: GIT_ENV() });
  };
}

const overflowed = (r) => !r.ok && (r.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(String(r.stderr)) || r.code === 'ENOBUFS');
const timedOut = (r) => !r.ok && r.signal === 'SIGTERM';

async function revParse(git, ref) {
  const r = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const sha = r.stdout.trim();
  return r.ok && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

// --- pure parsers -----------------------------------------------------------

/** Split a -z buffer into fields (a trailing NUL leaves no empty field). */
function zFields(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? '');
  const parts = s.split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * `git diff --numstat -z`: `add\tdel\tpath\0`, or for a rename/copy
 * `add\tdel\t\0old\0new\0`. Binary files have `-\t-`.
 * -> [{ path, oldPath, add, del, binary }]
 */
export function parseNumstatZ(buf) {
  const f = zFields(buf);
  const out = [];
  for (let i = 0; i < f.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(f[i]);
    if (!m) continue;
    const binary = m[1] === '-' && m[2] === '-';
    const add = binary ? 0 : Number(m[1]) || 0;
    const del = binary ? 0 : Number(m[2]) || 0;
    if (m[3] === '') {
      const oldPath = f[i + 1];
      const p = f[i + 2];
      i += 2;
      if (typeof p !== 'string' || typeof oldPath !== 'string') break;
      out.push({ path: p, oldPath, add, del, binary });
    } else {
      out.push({ path: m[3], oldPath: null, add, del, binary });
    }
  }
  return out;
}

/** `git diff --name-status -z`: `X\0path\0` or `R100\0old\0new\0`. -> Map(path -> status letter) */
export function parseNameStatusZ(buf) {
  const f = zFields(buf);
  const out = new Map();
  for (let i = 0; i < f.length; i++) {
    const st = f[i];
    const letter = st[0];
    if (!/^[ACDMRTUXB]/.test(st)) continue;
    if (letter === 'R' || letter === 'C') {
      const p = f[i + 2];
      i += 2;
      if (typeof p === 'string') out.set(p, letter);
    } else {
      const p = f[i + 1];
      i += 1;
      if (typeof p === 'string') out.set(p, letter);
    }
  }
  return out;
}

/** git's C-style quoting of a path ("a\tb", octal bytes) back to a string. */
export function unquoteCPath(s) {
  if (typeof s !== 'string' || s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  const body = s.slice(1, -1);
  const bytes = [];
  const ESC = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = body[i + 1];
    if (/[0-7]/.test(n ?? '')) {
      const oct = body.slice(i + 1, i + 4);
      bytes.push(parseInt(oct, 8) & 0xff);
      i += oct.length;
    } else if (n in ESC) {
      bytes.push(ESC[n]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(p, prefix) {
  if (p == null || p === '/dev/null') return null;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** Names from `diff --git a/X b/Y` when unambiguous (quoted pair, or X === Y). */
function namesFromGitHeader(rest) {
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*"|b\/.*)$/.exec(rest);
    if (m) return [stripPrefix(unquoteCPath(m[1]), 'a/'), stripPrefix(unquoteCPath(m[2]), 'b/')];
    return [null, null];
  }
  const qb = / ("b\/(?:[^"\\]|\\.)*")$/.exec(rest);
  if (qb) return [stripPrefix(rest.slice(0, qb.index), 'a/'), stripPrefix(unquoteCPath(qb[1]), 'b/')];
  // a/P b/P: total length is 2*len(P) + 5.
  if ((rest.length - 5) % 2 === 0) {
    const len = (rest.length - 5) / 2;
    const a = rest.slice(2, 2 + len);
    const b = rest.slice(len + 5);
    if (rest.startsWith('a/') && rest.slice(2 + len, len + 5) === ' b/' && a === b) return [a, b];
  }
  return [null, null];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function capsOf(caps) {
  const c = { ...DEFAULT_CAPS, ...(caps || {}) };
  return { maxFileLines: c.maxFileLines, maxFileBytes: c.maxFileBytes };
}

const clean = (s) => (s.includes('\0') ? s.replaceAll('\0', '�') : s);

/**
 * Parse `git diff` unified output into files. Pure. Lines keep CR; NUL becomes
 * U+FFFD. A file stops at caps.maxFileLines lines or caps.maxFileBytes bytes
 * of kept line text and gets `truncated:true`.
 * -> [{ path, oldPath, header, newFile, deleted, renamed, binary, truncated, bytes,
 *       hunks: [{ header, oldStart, oldLines, newStart, newLines, lines: [{t,o,n,s}] }] }]
 */
export function parseUnifiedDiff(text, caps) {
  const { maxFileLines, maxFileBytes } = capsOf(caps);
  const src = typeof text === 'string' ? text : Buffer.isBuffer(text) ? text.toString('utf8') : '';
  const lines = src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const files = [];
  let file = null;
  let hunk = null;
  let oldLeft = 0;
  let newLeft = 0;
  let o = 0;
  let n = 0;
  let kept = 0;
  let header = false; // in the extended header, before the first @@

  const finish = () => {
    if (!file) return;
    if (file.path == null) file.path = file.oldPath;
    if (file.oldPath === file.path && !file.renamed) file.oldPath = null;
    files.push(file);
    file = null;
    hunk = null;
  };
  const keep = (ln) => {
    if (file.truncated) return;
    const b = Buffer.byteLength(ln.s, 'utf8') + 1;
    if (kept >= maxFileLines || file.bytes + b > maxFileBytes) { file.truncated = true; return; }
    kept += 1;
    file.bytes += b;
    hunk.lines.push(ln);
  };

  for (const raw of lines) {
    const line = clean(raw);
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      if (c === '+' && newLeft > 0) { keep({ t: '+', o: null, n: n++, s: line.slice(1) }); newLeft--; continue; }
      if (c === '-' && oldLeft > 0) { keep({ t: '-', o: o++, n: null, s: line.slice(1) }); oldLeft--; continue; }
      if ((c === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
        keep({ t: ' ', o: o++, n: n++, s: line.slice(1) }); oldLeft--; newLeft--; continue;
      }
      if (c === '\\') { keep({ t: '\\', o: null, n: null, s: line.slice(1).trimStart() }); continue; }
      // Malformed: fall through and treat as a new header line.
      oldLeft = 0; newLeft = 0;
    }
    if (hunk && line[0] === '\\') { keep({ t: '\\', o: null, n: null, s: line.slice(1).trimStart() }); continue; }

    if (line.startsWith('diff --git ')) {
      finish();
      const [a, b] = namesFromGitHeader(line.slice(11));
      file = { path: b, oldPath: a, header: line, newFile: false, deleted: false, renamed: false, binary: false, truncated: false, bytes: 0, hunks: [] };
      kept = 0;
      header = true;
      continue;
    }
    if (!file) continue;
    const hm = HUNK_RE.exec(line);
    if (hm) {
      header = false;
      const oldStart = Number(hm[1]);
      const oldLines = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newLines = hm[4] === undefined ? 1 : Number(hm[4]);
      hunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] };
      oldLeft = oldLines; newLeft = newLines; o = oldStart; n = newStart;
      if (!file.truncated) file.hunks.push(hunk);
      continue;
    }
    if (!header) continue;
    if (line.startsWith('rename from ') || line.startsWith('copy from ')) {
      file.oldPath = unquoteCPath(line.slice(line.indexOf(' from ') + 6)); file.renamed = true;
    } else if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      file.path = unquoteCPath(line.slice(line.indexOf(' to ') + 4)); file.renamed = true;
    } else if (line.startsWith('new file mode')) {
      file.newFile = true;
    } else if (line.startsWith('deleted file mode')) {
      file.deleted = true;
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      file.binary = true;
    } else if (line.startsWith('--- ')) {
      const p = stripPrefix(unquoteCPath(line.slice(4).replace(/\t$/, '')), 'a/');
      if (file.oldPath == null && p != null) file.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = stripPrefix(unquoteCPath(line.slice(4).replace(/\t$/, '')), 'b/');
      if (file.path == null && p != null) file.path = p;
    }
  }
  finish();
  for (const f of files) {
    if (f.newFile && !f.renamed) f.oldPath = null;
    if (f.deleted && f.path == null) f.path = f.oldPath;
  }
  return files;
}

// --- helpers ------------------------------------------------------------------

/** gitignore-style: a glob without '/' matches the basename anywhere. */
export function isGenerated(globs, p) {
  if (!Array.isArray(globs)) return false;
  const base = p.slice(p.lastIndexOf('/') + 1);
  let hit = false;
  for (const g of globs) {
    if (typeof g !== 'string' || !g) continue;
    const neg = g.startsWith('!');
    const body = neg ? g.slice(1) : g;
    let re;
    try { re = compileGlob(body); } catch { continue; }
    if (re.test(body.includes('/') ? p : base)) hit = !neg;
  }
  return hit;
}

function checkMode(mode) {
  if (mode === undefined || mode === null || mode === '') return 'all';
  if (mode !== 'all' && mode !== 'committed') throw new DiffError('mode must be "all" or "committed"', 400);
  return mode;
}

function checkBase(b) {
  const why = baseProblem(b);
  if (why) throw new DiffError(`bad base: ${why}`, 400);
  return b;
}

function checkPath(p) {
  if (p === undefined || p === null || p === '') return null;
  if (typeof p !== 'string' || p.length > PATH_MAX || p.includes('\0')) throw new DiffError('bad path', 400);
  return p;
}

const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

async function repoNameFromRoot(root) {
  const r = await run('git', ['-C', root, ...GIT_C, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 5000, env: GIT_ENV() });
  if (!r.ok) return null;
  const common = r.stdout.trim();
  return common ? path.basename(path.dirname(common)) : null;
}

/** The lane's live record merged over its lane.json. */
async function resolveLane(laneId) {
  if (!store.isLaneId(laneId)) throw new DiffError('bad lane id', 400);
  const live = (await liveLanes()).find((l) => l && l.id === laneId) ?? null;
  const rec = store.read(laneId);
  if (!live && !rec) throw new DiffError('no such lane', 404);
  return {
    id: laneId,
    root: live?.root ?? rec?.root ?? null,
    branch: live?.branch ?? rec?.branch ?? null,
    repo: rec?.repo ?? live?.repo ?? null,
  };
}

function mergeCaps(caps) {
  const c = { ...DEFAULT_CAPS, ...(caps || {}) };
  for (const k of ['maxFiles', 'maxBytes', 'maxFileBytes', 'maxFileLines', 'maxUntracked', 'timeoutMs']) {
    if (!Number.isInteger(c[k]) || c[k] < 0) c[k] = DEFAULT_CAPS[k];
  }
  return c;
}

// --- main ---------------------------------------------------------------------

/**
 * One lane's diff. Throws DiffError {status: 400 | 404 | 409 | 413 | 429 | 500 | 504}.
 */
export async function laneDiff({ laneId, base, mode = 'all', path: onePath = null, caps = config.review?.diff, generated = config.review?.generated } = {}) {
  mode = checkMode(mode);
  onePath = checkPath(onePath);
  if (base !== undefined && base !== null && base !== '') checkBase(base);
  if (busy) throw new DiffError('a diff is already running', 429);
  busy = true;
  try {
    return await diffLocked({ laneId, base, mode, onePath, caps: mergeCaps(caps), generated: Array.isArray(generated) ? generated : DEFAULT_GENERATED });
  } finally {
    busy = false;
  }
}

async function diffLocked({ laneId, base, mode, onePath, caps, generated }) {
  const deadline = Date.now() + caps.timeoutMs;
  const lane = await resolveLane(laneId);

  let source, dir, head;
  if (lane.root && isDir(lane.root)) {
    source = 'worktree';
    dir = lane.root;
    head = 'HEAD';
  } else {
    source = 'remote';
    mode = 'committed';
    if (!lane.repo || !REPO_NAME_RE.test(lane.repo) || lane.repo === '.' || lane.repo === '..') throw new DiffError('lane has no repo', 404);
    if (!lane.branch || baseProblem(`origin/${lane.branch}`)) throw new DiffError('branch not on origin (not fetched)', 404);
    dir = path.join(config.codeDir, lane.repo);
    if (!isDir(dir)) throw new DiffError('repo checkout not found', 404);
    head = `origin/${lane.branch}`;
  }
  const git = makeGit(dir, deadline);

  const repoName = lane.repo ?? (source === 'worktree' ? await repoNameFromRoot(dir) : null);
  const repoCfg = Array.isArray(config.repos) ? config.repos.find((r) => r && r.name === repoName) : null;
  const baseRef = checkBase(base || repoCfg?.base || config.review?.base || defaults().review.base);

  const headSha = await revParse(git, head);
  if (!headSha) {
    if (source === 'remote') throw new DiffError('branch not on origin (not fetched)', 404);
    throw new DiffError('lane has no HEAD', 404);
  }
  const baseSha = await revParse(git, baseRef);
  if (!baseSha) throw new DiffError(`base ${baseRef} not found`, 404);
  const mbR = await git(['merge-base', '--end-of-options', baseSha, headSha]);
  const mergeBase = mbR.stdout.trim();
  if (!mbR.ok || !/^[0-9a-f]{40,64}$/.test(mergeBase)) {
    if (timedOut(mbR)) throw new DiffError('diff timed out', 504);
    throw new DiffError('no merge base with the base', 409);
  }

  // committed: diff-tree <mb> <head>; all: diff-index <mb> (the working tree).
  const refs = mode === 'committed' ? { cmd: 'diff-tree', revs: [mergeBase, headSha] } : { cmd: 'diff-index', revs: [mergeBase] };
  const listRun = async (kind) => {
    const r = await git(diffArgs(refs, [kind, '-z']), { maxBuffer: LIST_BUFFER });
    if (timedOut(r)) throw new DiffError('diff timed out', 504);
    if (overflowed(r)) throw new DiffError('diff file list too large', 413);
    if (!r.ok) throw new DiffError('git diff failed', 500);
    return r.stdout;
  };
  const numstat = parseNumstatZ(await listRun('--numstat'));
  const statuses = parseNameStatusZ(await listRun('--name-status'));

  const totals = { files: numstat.length, add: 0, del: 0 };
  for (const e of numstat) { totals.add += e.add; totals.del += e.del; }

  const result = {
    lane: laneId, base: baseRef, mergeBase, head, headSha, source, mode,
    totals, truncated: false, files: [], untracked: [], untrackedTruncated: false,
  };

  const entryOf = (e) => ({
    path: e.path,
    oldPath: e.oldPath,
    status: statusOf(statuses.get(e.path), e),
    add: e.add,
    del: e.del,
    binary: e.binary,
    generated: isGenerated(generated, e.path),
    deferred: false,
    truncated: false,
    hunks: [],
  });

  if (onePath !== null) {
    const e = numstat.find((x) => x.path === onePath);
    if (!e) throw new DiffError('path not in diff', 404);
    const f = entryOf(e);
    if (!f.binary) await patchOne(git, refs, f, caps);
    result.files = [f];
    result.truncated = f.truncated;
    return result;
  }

  // Choose which files get patches, in numstat order.
  const listed = numstat.slice(0, MAX_LISTED).map(entryOf);
  if (numstat.length > MAX_LISTED) result.truncated = true;
  const chosen = [];
  let estimate = 0;
  listed.forEach((f, i) => {
    if (i >= caps.maxFiles) { f.deferred = true; f.truncated = true; result.truncated = true; return; }
    if (f.binary) return;
    if (f.generated) { f.deferred = true; return; }
    const est = (f.add + f.del) * AVG_LINE;
    if (estimate + est > caps.maxBytes) { f.deferred = true; result.truncated = true; return; }
    estimate += est;
    chosen.push(f);
  });
  result.files = listed;

  if (chosen.length) {
    const specs = [];
    for (const f of chosen) { if (f.oldPath) specs.push(f.oldPath); specs.push(f.path); }
    const r = await git(diffArgs(refs, ['-p', '-U3'], specs), { maxBuffer: caps.maxBytes + PATCH_SLACK });
    if (timedOut(r)) throw new DiffError('diff timed out', 504);
    if (r.ok) {
      attach(chosen, parseUnifiedDiff(r.stdout, caps));
    } else if (overflowed(r)) {
      // Too big at once: one file at a time, within the total budget.
      let total = 0;
      for (const f of chosen) {
        if (total >= caps.maxBytes) { f.deferred = true; result.truncated = true; continue; }
        await patchOne(git, refs, f, caps);
        total += f._bytes ?? 0;
      }
    } else {
      throw new DiffError('git diff failed', 500);
    }
  }
  for (const f of listed) {
    if (f.truncated) result.truncated = true;
    delete f._bytes;
  }

  if (source === 'worktree' && mode === 'all' && caps.maxUntracked > 0) {
    const r = await git(['ls-files', '--others', '--exclude-standard', '-z'], { maxBuffer: 4 * MiB });
    if (timedOut(r)) throw new DiffError('diff timed out', 504);
    let names = zFields(r.stdout);
    // An overflowed buffer ends mid-name: drop the last field.
    if (!r.ok) { if (names.length) names.pop(); result.untrackedTruncated = true; }
    if (names.length > caps.maxUntracked) { names = names.slice(0, caps.maxUntracked); result.untrackedTruncated = true; }
    result.untracked = names.map(clean);
  }
  return result;
}

function statusOf(letter, e) {
  if (letter && 'MADRCT'.includes(letter)) return letter;
  if (e.oldPath) return 'R';
  return 'M';
}

/** Patch one file (and its rename source) with per-file caps. */
async function patchOne(git, refs, f, caps) {
  const specs = f.oldPath ? [f.oldPath, f.path] : [f.path];
  const r = await git(diffArgs(refs, ['-p', '-U3'], specs), { maxBuffer: caps.maxFileBytes + PATCH_SLACK });
  if (timedOut(r)) throw new DiffError('diff timed out', 504);
  if (!r.ok && !overflowed(r)) throw new DiffError('git diff failed', 500);
  const parsed = parseUnifiedDiff(r.stdout, caps);
  const p = parsed.find((x) => x.path === f.path) ?? parsed[0];
  if (p) {
    f.hunks = p.hunks;
    f.truncated = p.truncated || !r.ok;
    f._bytes = p.bytes;
    if (p.binary) f.binary = true;
  } else if (!r.ok) {
    f.truncated = true;
  }
}

/** Give each chosen file its parsed section: by name, else by order. */
function attach(chosen, parsed) {
  const byPath = new Map();
  for (const p of parsed) if (p.path != null && !byPath.has(p.path)) byPath.set(p.path, p);
  const used = new Set();
  const unmatched = [];
  for (const f of chosen) {
    const p = byPath.get(f.path);
    if (p && !used.has(p)) { used.add(p); give(f, p); } else unmatched.push(f);
  }
  const rest = parsed.filter((p) => !used.has(p));
  unmatched.forEach((f, i) => { if (rest[i]) give(f, rest[i]); });
}

function give(f, p) {
  f.hunks = p.hunks;
  f.truncated = p.truncated;
  if (p.binary) f.binary = true;
}
