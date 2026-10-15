// Hash-chained, append-only audit log (fleet plan §2 2.8). REVIEW-REQUIRED (SR2).
//
// One JSON line per entry:
//   {ts, id, user, via, builder, action, target, argsHash, result, prevHash, hash}
//   argsHash = sha256Hex(canonicalJson(args))      args themselves are never stored (they may hold prompts)
//   hash     = sha256Hex(prevHash + "\n" + canonicalJson(entryWithoutHash))
//   genesis prevHash = "0" x 64
//
// Authority (README 3.5, SECURITY-FIXES S8): on a builder this log is a cooperative control; an agent with a
// shell there can rewrite and re-chain it. It is authoritative only up to the hub's last `audit.anchor` of its
// head. For that the head is `{hash, count}` where `count` is the number of entries in the WHOLE chain (all
// rotated files plus the current one), so "the entry at index count-1 has hash H" is a stable claim the hub can
// check later: `hasHead(head)` here, and `read({after}).afterIndex` over HTTP.
//
// Layout and rotation:
// - The current file is `file` (mode 0600, its directory 0700 when we create it). Before an append that would
//   push it past `maxBytes` it is renamed to `<stem>-<UTC yyyymmddThhmmss>[-n].jsonl` in the same directory, and
//   a new current file starts with `{action:'audit.rotate', target:<old file name>, prevHash:<old head>}`, so the
//   chain continues across files. File order is reconstructed by following those `target` links backwards from
//   the current file (never by sorting names or mtimes), so stray files in the directory are ignored and a
//   missing link is a verification failure. Rotated files are never deleted.
// - Rotation is crash-safe: the new current file is written to `<file>.rotating` and fsynced first, then the old
//   file is renamed away, then `.rotating` is renamed into place. `openAudit` finishes or discards a rotation
//   that was interrupted.
// - `append` is synchronous: write + fsync (actions are rare; durability beats latency). One process owns the
//   file; the head is cached in memory, recomputed from disk at open and whenever the file size is not what this
//   process last wrote (someone else touched the file).
// - A torn last line (crash mid-write, or a truncation) is never repaired or hidden: the next append starts on a
//   fresh line and chains from the last parsable entry, and `verifyAll` keeps reporting the torn line as
//   `bad_json`.
//
// Unauthenticated failures (bad signature, replay) are NOT chained (an attacker could flood the chain); use
// `createUnauthWarner` for them: at most one log line per 10 s, with a counter. Nothing here ever logs keys,
// signatures or args.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson, sha256Hex } from './canonical.mjs';
import { auditFile } from './paths.mjs';

export const GENESIS = '0'.repeat(64);
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_READ_LIMIT = 1000;
export const ROTATE_ACTION = 'audit.rotate';
export const ANCHOR_ACTION = 'audit.anchor';

const ERROR_MAX = 300;
const FIELD_MAX = 256;
const RESULT_MAX_BYTES = 4096;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEX64 = /^[0-9a-f]{64}$/;
const ENTRY_KEYS = ['ts', 'id', 'user', 'via', 'builder', 'action', 'target', 'argsHash', 'result'];
const INPUT_KEYS = new Set([...ENTRY_KEYS, 'args']);
// A rotated file name as written by this module: a plain basename, no path separators, no leading dot.
const ROTATED_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,200}\.jsonl$/;

// ---------------------------------------------------------------------------------------------------------
// Entry construction

function cleanStr(v, max) {
  const s = String(v).toWellFormed();
  return s.length > max ? s.slice(0, max) : s;
}

function optStr(name, v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new TypeError(`audit: ${name} must be a string`);
  return cleanStr(v, FIELD_MAX);
}

// Strings are made well-formed and truncated (an error message may echo builder text); the result must be a
// plain JSON object of bounded size. canonicalJson rejects everything else (prototype keys, cycles, getters…).
function cleanValue(v, depth) {
  if (typeof v === 'string') return cleanStr(v, ERROR_MAX);
  if (v === null || typeof v !== 'object') return v;
  if (depth > 4) throw new TypeError('audit: result nested too deeply');
  if (Array.isArray(v)) return v.map((x) => cleanValue(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('audit: result holds a non-plain object');
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (FORBIDDEN_KEYS.has(k)) throw new TypeError(`audit: forbidden key ${JSON.stringify(k)} in result`);
    if (x === undefined) continue;
    out[k] = cleanValue(x, depth + 1);
  }
  return out;
}

function cleanResult(result) {
  if (result === undefined || result === null) return {};
  if (typeof result !== 'object' || Array.isArray(result)) throw new TypeError('audit: result must be an object');
  const proto = Object.getPrototypeOf(result);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('audit: result must be a plain object');
  const out = cleanValue(result, 0);
  const text = canonicalJson(out); // throws on anything non-JSON
  if (Buffer.byteLength(text) > RESULT_MAX_BYTES) throw new TypeError(`audit: result larger than ${RESULT_MAX_BYTES} bytes`);
  return out;
}

/** hash = sha256Hex(prevHash + "\n" + canonicalJson(entryWithoutHash)). */
export function entryHash(entryWithoutHash) {
  return sha256Hex(`${entryWithoutHash.prevHash}\n${canonicalJson(entryWithoutHash)}`);
}

/** argsHash = sha256Hex(canonicalJson(args)); missing args hash as {}. */
export function argsHashOf(args) {
  return sha256Hex(canonicalJson(args === undefined || args === null ? {} : args));
}

// Build the stored entry (without prevHash/hash) from caller input. Unknown top-level keys are refused, so a
// caller cannot smuggle args or other payload into the chain by accident; extra data belongs in `result`.
function buildEntry(input, { ts, defaultBuilder, internal }) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('audit: entry must be an object');
  for (const k of Object.keys(input)) {
    if (!INPUT_KEYS.has(k)) throw new TypeError(`audit: unknown entry field ${JSON.stringify(cleanStr(k, 40))} (put extra data in result)`);
  }
  const action = optStr('action', input.action);
  if (!action) throw new TypeError('audit: action is required');
  if (action === ROTATE_ACTION && !internal) throw new TypeError(`audit: ${ROTATE_ACTION} is written by the audit log only`);
  let argsHash;
  if (input.argsHash !== undefined && input.argsHash !== null) {
    if (input.args !== undefined) throw new TypeError('audit: pass args or argsHash, not both');
    if (typeof input.argsHash !== 'string' || !HEX64.test(input.argsHash)) throw new TypeError('audit: argsHash must be 64 lower-case hex');
    argsHash = input.argsHash;
  } else {
    argsHash = argsHashOf(input.args);
  }
  let id = input.id;
  if (id === undefined || id === null) id = crypto.randomUUID();
  else if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('audit: id must be a non-empty string of at most 128 characters');
  else id = id.toWellFormed();
  return {
    ts,
    id,
    user: optStr('user', input.user),
    via: optStr('via', input.via),
    builder: input.builder === undefined ? defaultBuilder : optStr('builder', input.builder),
    action,
    target: optStr('target', input.target),
    argsHash,
    result: cleanResult(input.result),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Pure verification

function splitLines(text) {
  // Returns [{line (1-based), text}] for every non-empty line, plus whether the text ended mid-line.
  const out = [];
  const parts = text.split('\n');
  const torn = parts.length > 0 && parts[parts.length - 1] !== '';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '') continue;
    out.push({ line: i + 1, text: parts[i] });
  }
  return { lines: out, torn };
}

// Parse one line into an entry object or null when it is not a well-formed entry.
function parseEntry(text) {
  let e;
  try {
    e = JSON.parse(text);
  } catch {
    return null;
  }
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return null;
  if (typeof e.prevHash !== 'string' || typeof e.hash !== 'string') return null;
  if (!Number.isSafeInteger(e.ts)) return null;
  if (typeof e.action !== 'string') return null;
  return e;
}

/**
 * verifyFile(lines, prevHash = GENESIS, {file, lastTs} = {}) -> {ok, count, head, lastTs, firstBad?: {file, line, reason}}
 *
 * Pure. `lines` is an array of line strings (empty strings are skipped but still count for line numbers) or the
 * whole file text. Reasons: `bad_json` (not a parsable entry), `prev_mismatch` (does not chain onto the previous
 * entry), `hash_mismatch` (content changed), `ts_regressed` (ts older than the previous entry's). `head` is the
 * hash of the last entry that verified (or `prevHash` when none did); `count` the number of entries verified.
 */
export function verifyFile(lines, prevHash = GENESIS, { file = null, lastTs = -Infinity } = {}) {
  const list = typeof lines === 'string' ? lines.split('\n') : lines;
  if (!Array.isArray(list)) throw new TypeError('verifyFile: lines must be an array or a string');
  let head = prevHash;
  let ts = lastTs;
  let count = 0;
  const bad = (line, reason) => ({ ok: false, count, head, lastTs: ts, firstBad: { file, line, reason } });
  for (let i = 0; i < list.length; i++) {
    const text = list[i];
    if (text === '') continue;
    const line = i + 1;
    const e = typeof text === 'string' ? parseEntry(text) : null;
    if (!e) return bad(line, 'bad_json');
    if (e.prevHash !== head) return bad(line, 'prev_mismatch');
    const { hash, ...rest } = e;
    let want;
    try {
      want = entryHash(rest);
    } catch {
      return bad(line, 'bad_json'); // e.g. a "__proto__" key or lone surrogate canonicalJson refuses
    }
    if (hash !== want) return bad(line, 'hash_mismatch');
    if (e.ts < ts) return bad(line, 'ts_regressed');
    head = hash;
    ts = e.ts;
    count++;
  }
  return { ok: true, count, head, lastTs: ts };
}

// ---------------------------------------------------------------------------------------------------------
// Files

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function firstEntry(text) {
  if (!text) return null;
  const nl = text.indexOf('\n');
  return parseEntry(nl === -1 ? text : text.slice(0, nl));
}

/**
 * Chain files oldest first, found by following `audit.rotate` targets back from `file`.
 * -> {files: [abs paths], brokenLink: null | {file, target}}  (brokenLink: a rotate entry names a file that is
 * missing, unsafe or already visited)
 */
function chainFiles(file) {
  const dir = path.dirname(file);
  const files = [file];
  const seen = new Set([path.basename(file)]);
  let cur = file;
  for (;;) {
    const first = firstEntry(readText(cur));
    if (!first || first.action !== ROTATE_ACTION) return { files: files.reverse(), brokenLink: null };
    const target = first.target;
    if (typeof target !== 'string' || !ROTATED_NAME.test(target) || seen.has(target)) {
      return { files: files.reverse(), brokenLink: { file: cur, target } };
    }
    const prev = path.join(dir, target);
    if (readText(prev) === null) return { files: files.reverse(), brokenLink: { file: cur, target } };
    seen.add(target);
    files.push(prev);
    cur = prev;
  }
}

function utcStamp(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // best effort (some filesystems refuse fsync on a directory)
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------------------------
// openAudit

/**
 * openAudit({file = auditFile(), maxBytes = 10485760, now = Date.now, builder = null})
 *   -> {file, append(entry), head(), read({since, after, limit}), verifyAll(), hasHead({hash, count}), close()}
 *
 * append(entry) -> the stored entry (with prevHash and hash). Input fields: ts? (ms; clamped so the chain never
 *   regresses), id? (default a random UUID), user, via, builder (default the `builder` option), action
 *   (required; `audit.rotate` is reserved), target, args (hashed, never stored) or argsHash, result (plain
 *   object; strings truncated to 300 chars, at most 4 KiB). Unknown fields throw.
 * head() -> {hash, count}: count = entries in the whole chain (rotated files included).
 * read({since, after, limit}) -> {entries, more, head, afterFound?, afterIndex?}: entries oldest first;
 *   `after` (a hash) wins over `since` (ms, ts >= since); limit 1..1000 (default 1000). An `after` that is not in
 *   the chain answers `afterFound:false` and no entries (the caller decides: a hub treats it as a fork).
 *   `afterIndex` is the 0-based chain index of the `after` entry. Torn/unparsable lines are skipped.
 * verifyAll() -> {ok, count, head, firstBad?: {file, line, reason}} over every chain file.
 * hasHead({hash, count}) -> true when the chain entry at index count-1 has that hash (an anchored head is still
 *   in the chain). count 0 matches only the genesis hash.
 */
export function openAudit({ file = auditFile(), maxBytes = DEFAULT_MAX_BYTES, now = Date.now, builder = null } = {}) {
  if (typeof file !== 'string' || file === '') throw new TypeError('audit: file must be a path');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('audit: maxBytes must be a positive integer');
  if (typeof now !== 'function') throw new TypeError('audit: now must be a function');
  file = path.resolve(file);
  const dir = path.dirname(file);
  const stem = path.basename(file).replace(/\.jsonl$/, '');
  const tmpFile = `${file}.rotating`;
  const defaultBuilder = optStr('builder', builder);

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  recoverRotation();

  let fd = null;
  let state = null; // {hash, count, lastTs, size, fileLines, torn}

  function recoverRotation() {
    if (!fs.existsSync(tmpFile)) return;
    if (fs.existsSync(file)) {
      // Crashed before the old file was renamed away: the rotation did not happen.
      fs.unlinkSync(tmpFile);
    } else {
      // Crashed after the rename: finish it.
      fs.renameSync(tmpFile, file);
    }
    fsyncDir(dir);
  }

  function computeState() {
    const { files } = chainFiles(file);
    let count = 0;
    let hash = GENESIS;
    let lastTs = -Infinity;
    let size = 0;
    let fileLines = 0;
    let torn = false;
    for (const f of files) {
      const text = readText(f) ?? '';
      const { lines, torn: t } = splitLines(text);
      count += lines.length;
      for (const l of lines) {
        const e = parseEntry(l.text);
        if (!e || !HEX64.test(e.hash)) continue;
        hash = e.hash;
        if (e.ts > lastTs) lastTs = e.ts;
      }
      if (f === file) {
        size = Buffer.byteLength(text);
        fileLines = lines.length;
        torn = t;
      }
    }
    return { hash, count, lastTs, size, fileLines, torn };
  }

  function openFd() {
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(file, flags, 0o600);
    const st = fs.fstatSync(fd);
    if ((st.mode & 0o777) !== 0o600) fs.fchmodSync(fd, 0o600);
  }

  function ensure() {
    if (fd === null) openFd();
    const size = fs.fstatSync(fd).size;
    if (state === null || size !== state.size) state = computeState();
  }

  function writeLine(lineText) {
    const buf = Buffer.from(lineText, 'utf8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
    state.size += buf.length;
  }

  function seal(entry) {
    const e = { ...entry, prevHash: state.hash };
    return { ...e, hash: entryHash(e) };
  }

  function nextTs(wanted) {
    const t = Number.isSafeInteger(wanted) ? wanted : Math.trunc(now());
    if (!Number.isSafeInteger(t)) throw new TypeError('audit: now() must return ms');
    return Math.max(t, state.lastTs === -Infinity ? t : state.lastTs);
  }

  function rotatedName() {
    const base = `${stem}-${utcStamp(now())}`;
    let name = `${base}.jsonl`;
    for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}.jsonl`;
    return name;
  }

  function rotate() {
    const oldName = rotatedName();
    const entry = seal(buildEntry(
      { user: null, via: 'local', action: ROTATE_ACTION, target: oldName, result: { ok: true, count: state.count } },
      { ts: nextTs(undefined), defaultBuilder, internal: true },
    ));
    const lineText = `${canonicalJson(entry)}\n`;
    // 1. the new file, complete and durable, under a temporary name
    const tfd = fs.openSync(tmpFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeSync(tfd, lineText);
      fs.fsyncSync(tfd);
    } finally {
      fs.closeSync(tfd);
    }
    // 2. move the full file away, 3. put the new one in place
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(file, path.join(dir, oldName));
    fs.renameSync(tmpFile, file);
    fsyncDir(dir);
    openFd();
    state = {
      hash: entry.hash,
      count: state.count + 1,
      lastTs: entry.ts,
      size: Buffer.byteLength(lineText),
      fileLines: 1,
      torn: false,
    };
  }

  function append(input) {
    ensure();
    const built = buildEntry(input, { ts: 0, defaultBuilder, internal: false });
    built.ts = nextTs(input.ts);
    let entry = seal(built);
    let lineText = `${canonicalJson(entry)}\n`;
    if (state.torn) lineText = `\n${lineText}`; // never glue onto a torn line
    if (state.fileLines > 0 && state.size + Buffer.byteLength(lineText) > maxBytes) {
      rotate();
      built.ts = nextTs(input.ts);
      entry = seal(built);
      lineText = `${canonicalJson(entry)}\n`;
    }
    writeLine(lineText);
    state.hash = entry.hash;
    state.count += 1;
    state.lastTs = entry.ts;
    state.fileLines += 1;
    state.torn = false;
    return entry;
  }

  function head() {
    ensure();
    return { hash: state.hash, count: state.count };
  }

  // Every chain entry, oldest first, as {index, entry|null}. Unparsable lines keep their index.
  function* walk(files) {
    let index = 0;
    for (const f of files) {
      const { lines } = splitLines(readText(f) ?? '');
      for (const l of lines) yield { index: index++, entry: parseEntry(l.text) };
    }
  }

  function read({ since, after, limit } = {}) {
    const h = head();
    let lim = limit === undefined || limit === null ? MAX_READ_LIMIT : Number(limit);
    if (!Number.isFinite(lim)) lim = MAX_READ_LIMIT;
    lim = Math.min(MAX_READ_LIMIT, Math.max(1, Math.trunc(lim)));
    const { files } = chainFiles(file);
    const entries = [];
    let more = false;
    const useAfter = typeof after === 'string' && after !== '';
    const sinceMs = Number.isFinite(Number(since)) && since !== null && since !== '' ? Number(since) : -Infinity;
    let afterIndex;
    let collecting = !useAfter;
    for (const { index, entry } of walk(files)) {
      if (!collecting) {
        if (entry && entry.hash === after) {
          collecting = true;
          afterIndex = index;
        }
        continue;
      }
      if (!entry) continue;
      if (!useAfter && entry.ts < sinceMs) continue;
      if (entries.length >= lim) {
        more = true;
        break;
      }
      entries.push(entry);
    }
    const out = { entries, more, head: h };
    if (useAfter) {
      out.afterFound = afterIndex !== undefined;
      if (out.afterFound) out.afterIndex = afterIndex;
    }
    return out;
  }

  function hasHead(anchor) {
    if (!anchor || typeof anchor.hash !== 'string' || !Number.isSafeInteger(anchor.count) || anchor.count < 0) return false;
    if (anchor.count === 0) return anchor.hash === GENESIS;
    const { files } = chainFiles(file);
    for (const { index, entry } of walk(files)) {
      if (index === anchor.count - 1) return !!entry && entry.hash === anchor.hash;
    }
    return false;
  }

  function verifyAll() {
    return verifyChain(file);
  }

  function close() {
    if (fd !== null) fs.closeSync(fd);
    fd = null;
    state = null;
  }

  ensure();
  return { file, append, head, read, verifyAll, hasHead, close };
}

/**
 * verifyChain(file) -> {ok, count, head, firstBad?: {file, line, reason}}
 * Verifies the current file and every rotated file it links to, oldest first, without opening for writing.
 * Used by `openAudit().verifyAll()` and `laneboard audit verify --file`.
 */
export function verifyChain(file) {
  file = path.resolve(file);
  const { files, brokenLink } = chainFiles(file);
  let prev = GENESIS;
  let lastTs = -Infinity;
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (i === 0 && brokenLink) {
      // The oldest file we could reach starts with a rotate entry whose target is gone or unsafe.
      return { ok: false, count, head: prev, firstBad: { file: f, line: 1, reason: 'prev_mismatch' } };
    }
    const text = readText(f) ?? '';
    const r = verifyFile(text.split('\n'), prev, { file: f, lastTs });
    count += r.count;
    if (!r.ok) return { ok: false, count, head: r.head, firstBad: r.firstBad };
    if (i > 0) {
      // A rotated-into file must start with the rotate entry naming its predecessor.
      const first = firstEntry(text);
      if (!first || first.action !== ROTATE_ACTION || first.target !== path.basename(files[i - 1])) {
        return { ok: false, count: count - r.count, head: prev, firstBad: { file: f, line: 1, reason: 'prev_mismatch' } };
      }
    }
    prev = r.head;
    lastTs = r.lastTs;
  }
  return { ok: true, count, head: prev };
}

// ---------------------------------------------------------------------------------------------------------
// Unauthenticated failures: rate-limited warnings, never chained

/**
 * createUnauthWarner({log, now = Date.now, intervalMs = 10000}) -> {note(reason), pending()}
 * note(reason): the first failure in a window logs one line at once; later ones in the same window are only
 * counted and reported with the next line after the window. `reason` is a short code (e.g. 'bad-signature',
 * 'replay'); it is truncated and stripped of control characters. Never pass keys, signatures or bodies.
 */
export function createUnauthWarner({ log = console, now = Date.now, intervalMs = 10000 } = {}) {
  let windowStart = -Infinity;
  let suppressed = 0;
  let lastReason = null;
  const clean = (r) => String(r ?? 'unknown').replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
  function note(reason) {
    const t = now();
    lastReason = clean(reason);
    if (t - windowStart >= intervalMs) {
      const extra = suppressed > 0 ? ` (+${suppressed} more since last report)` : '';
      log.warn(`fleet: unauthenticated request refused: ${lastReason}${extra}`);
      windowStart = t;
      suppressed = 0;
      return true;
    }
    suppressed++;
    return false;
  }
  return { note, pending: () => suppressed };
}
