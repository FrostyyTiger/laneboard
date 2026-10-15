// Hash-chained, append-only audit log (fleet plan §2 2.8). REVIEW-REQUIRED (SR2).
//
// One JSON line per entry:
//   {ts, id, user, via, builder, action, target, argsHash, result, prevHash, hash}
//   argsHash = sha256Hex(canonicalJson(args))      args themselves are never stored (they may hold prompts)
//   hash     = sha256Hex(prevHash + "\n" + canonicalJson(entryWithoutHash))
//   genesis prevHash = "0" x 64
// Every line is exactly `canonicalJson(entry)`: a line with duplicate keys, extra whitespace or another key order
// does not verify, so what a grep or a first-wins parser shows is what was hashed.
// `argsHash` is NOT confidential: it is unsalted, so short args (`y`, `1`, `continue`) can be recovered from a
// dictionary by anyone who can read the log or `GET /api/v1/audit` (the formula is fixed by README 3.5).
// Stored strings have C0/C1 control characters (and U+2028/2029) replaced, so a raw `read()` cannot carry
// terminal escapes; consumers must still escape for their medium (HTML, terminal).
//
// Authority (README 3.5, SECURITY-FIXES S8): on a builder this log is a cooperative control; an agent with a
// shell there can rewrite and re-chain it. It is authoritative only up to the hub's last `audit.anchor` of its
// head. For that the head is `{hash, count}` where `count` is the number of entries in the WHOLE chain (all
// rotated files plus the current one; torn/unparsable lines are not entries and are not counted), so "the
// entry at index count-1 has hash H" is a stable claim the hub can check later: `hasHead(head)` here, and
// `read({after}).afterIndex` over HTTP.
//
// Single writer (SR2 M1): `openAudit` takes an exclusive lock `<file>.lock` (created atomically with link(2),
// holding `<pid> <hostname>`). A second writer, in this process or another, gets an `AUDIT_LOCKED` error. A
// lock whose pid is dead on this host is stale and is taken over. Before every append the writer checks that
// its lock file is still the one it created (else `AUDIT_LOCK_LOST`, the instance stops writing) and that its
// open fd is still the file at `file` (dev/ino): a replaced file is reopened and re-verified, a removed or
// renamed one fails with `AUDIT_DETACHED` (never write into a detached inode). The writer also refuses to
// extend a chain that does not verify (`AUDIT_CHAIN_INVALID`); a torn tail is the one tolerated defect.
// `verifyChain` and other readers take no lock.
//
// Layout and rotation:
// - The current file is `file` (mode 0600, its directory 0700: created so, tightened when wider; a symlinked or
//   foreign-owned directory is refused). Before an append that would push it past `maxBytes` it gets a second
//   name `<stem>-<UTC yyyymmddThhmmss>[-n].jsonl` (link(2), which fails rather than overwrite an existing
//   rotated file), and a new current file that starts with `{action:'audit.rotate', target:<old file name>,
//   prevHash:<old head>}` replaces it, so the chain continues across files. File order is reconstructed by
//   following those `target` links backwards from the current file (never by sorting names or mtimes), so stray
//   files in the directory are ignored and a missing link is a verification failure. Rotated files are never
//   deleted, and are read without following symlinks.
// - Rotation is crash-safe: link the full file to its rotated name, write and fsync the new current file as
//   `<file>.rotating`, then rename it over `file` (atomic: `file` always exists). A crash leaves at worst a
//   stray duplicate rotated file and a `.rotating` file that `openAudit` discards (or, for a log written by an
//   older version that renamed the old file away first, moves into place). A failed rotation is undone; when
//   the instance cannot get back to a consistent state it refuses further appends (`AUDIT_FAILED`).
// - `append` is synchronous: write + fsync (actions are rare; durability beats latency). The head is cached in
//   memory, recomputed from disk at open and whenever the file is not what this process last wrote.
// - A torn line (crash mid-write, or a truncation) is never repaired or hidden: the next append starts on a
//   fresh line and chains from the last verified entry. `verify` reports such a line as a `torn` warning (and
//   keeps verifying) when the next entry chains onto the entry before it; a torn line at the end of the current
//   file, or one the chain does not continue past, is `bad_json`.
// - Reads stream files in 64 KiB chunks; a line over 64 KiB is `bad_json`. Rotated files are immutable, so
//   their summaries are cached by {dev, ino, size, mtime, ctime}; `read({after})` and `hasHead` scan newest
//   first and touch only the files they need.
//
// Unauthenticated failures (bad signature, replay) are NOT chained (an attacker could flood the chain); use
// `createUnauthWarner` for them: at most one log line per 10 s, with a counter. Nothing here ever logs keys,
// signatures or args.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
const LINE_MAX = 64 * 1024;
const CHUNK = 64 * 1024;
const TS_FUTURE_MAX_MS = 60_000;
const CACHE_MAX = 4096;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEX64 = /^[0-9a-f]{64}$/;
const ENTRY_KEYS = ['ts', 'id', 'user', 'via', 'builder', 'action', 'target', 'argsHash', 'result'];
const INPUT_KEYS = new Set([...ENTRY_KEYS, 'args']);
// A rotated file name as written by this module: a plain basename, no path separators, no leading dot.
const ROTATED_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,200}\.jsonl$/;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = fs.constants.O_NONBLOCK ?? 0;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function auditError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------------------------------------
// Entry construction

function cleanStr(v, max) {
  const s = String(v).toWellFormed();
  return s.length > max ? s.slice(0, max) : s;
}

// Stored text: well-formed, no control characters (tab/CR/LF become a space, the rest U+FFFD), truncated.
function storeStr(v, max) {
  return cleanStr(v, max).replace(CONTROL, (c) => (c === '\t' || c === '\n' || c === '\r' ? ' ' : '\ufffd'));
}

function optStr(name, v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new TypeError(`audit: ${name} must be a string`);
  return storeStr(v, FIELD_MAX);
}

// Strings are made well-formed and truncated (an error message may echo builder text); the result must be a
// plain JSON object of bounded size. canonicalJson rejects everything else (prototype keys, cycles, getters…).
function cleanValue(v, depth) {
  if (typeof v === 'string') return storeStr(v, ERROR_MAX);
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

/** argsHash = sha256Hex(canonicalJson(args)); missing args hash as {}. Not confidential (unsalted). */
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
  else id = storeStr(id, 128);
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

// Parse one line into an entry object or null when it is not a well-formed entry.
function parseEntry(text) {
  if (typeof text !== 'string' || text.length > LINE_MAX) return null;
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

// Incremental verifier: feed(line, text) for every line (text '' = empty line, skipped; null = over-long line),
// then result({tailOk}). An unparsable line is held as "pending": when the next entry chains onto the last
// verified head it becomes a `torn` warning, otherwise it is the `bad_json` failure. Trailing pending lines are
// warnings with `tailOk` (a rotated file's torn tail; the writer's own current file) and `bad_json` otherwise.
function createVerifier(prevHash, lastTs, file) {
  let head = prevHash;
  let ts = lastTs;
  let count = 0;
  let pending = [];
  const warnings = [];
  let failed = null;
  function feed(line, text) {
    if (failed) return false;
    if (text === '') return true;
    const e = parseEntry(text);
    if (!e) {
      pending.push(line);
      return true;
    }
    let canon;
    try {
      canon = canonicalJson(e);
    } catch {
      canon = null; // e.g. a "__proto__" key or lone surrogate canonicalJson refuses
    }
    if (canon !== text) {
      failed = { file, line: pending.length ? pending[0] : line, reason: 'bad_json' };
      return false;
    }
    if (e.prevHash !== head) {
      failed = pending.length ? { file, line: pending[0], reason: 'bad_json' } : { file, line, reason: 'prev_mismatch' };
      return false;
    }
    const { hash, ...rest } = e;
    if (hash !== entryHash(rest)) {
      failed = { file, line, reason: 'hash_mismatch' };
      return false;
    }
    if (e.ts < ts) {
      failed = { file, line, reason: 'ts_regressed' };
      return false;
    }
    for (const l of pending) warnings.push({ file, line: l, reason: 'torn' });
    pending = [];
    head = hash;
    ts = e.ts;
    count++;
    return true;
  }
  function result({ tailOk = false } = {}) {
    if (!failed && pending.length) {
      if (tailOk) {
        for (const l of pending) warnings.push({ file, line: l, reason: 'torn' });
        pending = [];
      } else {
        failed = { file, line: pending[0], reason: 'bad_json' };
      }
    }
    const out = failed ? { ok: false, count, head, lastTs: ts, firstBad: failed } : { ok: true, count, head, lastTs: ts };
    if (warnings.length) out.warnings = warnings.slice();
    return out;
  }
  return { feed, result };
}

/**
 * verifyFile(lines, prevHash = GENESIS, {file, lastTs, tailOk} = {})
 *   -> {ok, count, head, lastTs, firstBad?: {file, line, reason}, warnings?: [{file, line, reason:'torn'}]}
 *
 * Pure. `lines` is an array of line strings (empty strings are skipped but still count for line numbers) or the
 * whole file text. Reasons: `bad_json` (not a parsable entry, or not byte-identical to canonicalJson of the
 * parsed entry), `prev_mismatch` (does not chain onto the previous entry), `hash_mismatch` (content changed),
 * `ts_regressed` (ts older than the previous entry's). An unparsable line followed by an entry that chains onto
 * the entry before it is a `torn` warning, not a failure (`tailOk`: trailing ones too). `head` is the hash of
 * the last entry that verified (or `prevHash` when none did); `count` the number of entries verified.
 */
export function verifyFile(lines, prevHash = GENESIS, { file = null, lastTs = -Infinity, tailOk = false } = {}) {
  const list = typeof lines === 'string' ? lines.split('\n') : lines;
  if (!Array.isArray(list)) throw new TypeError('verifyFile: lines must be an array or a string');
  const v = createVerifier(prevHash, lastTs, file);
  for (let i = 0; i < list.length; i++) {
    const text = list[i];
    if (!v.feed(i + 1, typeof text === 'string' ? text : null)) break;
  }
  return v.result({ tailOk });
}

// ---------------------------------------------------------------------------------------------------------
// Files

// Open a file for reading without following a symlink (and without blocking on a planted FIFO). ENOENT -> null.
function openRead(p) {
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const st = fs.fstatSync(fd);
  if (!st.isFile()) {
    fs.closeSync(fd);
    throw auditError('AUDIT_UNSAFE_FILE', `audit: ${p} is not a regular file`);
  }
  return { fd, st };
}

// Lines of an open file, streamed: {line (1-based), text ('' for an empty line, null when over LINE_MAX), eol}.
// `meta.bytes` is set to the number of bytes read.
function* fdLines(fd, meta = {}) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let parts = [];
  let partLen = 0;
  let over = false;
  let line = 1;
  let pos = 0;
  for (;;) {
    const n = fs.readSync(fd, buf, 0, CHUNK, pos);
    if (n === 0) break;
    pos += n;
    meta.bytes = pos;
    const chunk = buf.subarray(0, n);
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(10, start);
      const end = nl === -1 ? n : nl;
      if (!over) {
        if (partLen + (end - start) > LINE_MAX) {
          over = true;
          parts = [];
          partLen = 0;
        } else if (end > start) {
          parts.push(Buffer.from(chunk.subarray(start, end)));
          partLen += end - start;
        }
      }
      if (nl === -1) break;
      yield { line, text: over ? null : Buffer.concat(parts, partLen).toString('utf8'), eol: true };
      line++;
      parts = [];
      partLen = 0;
      over = false;
      start = nl + 1;
    }
  }
  meta.bytes = pos;
  if (partLen > 0 || over) yield { line, text: over ? null : Buffer.concat(parts, partLen).toString('utf8'), eol: false };
}

// First line of a file as an entry (or null), reading at most LINE_MAX bytes.
function firstEntryOf(p) {
  const h = openRead(p);
  if (!h) return undefined;
  try {
    for (const { text } of fdLines(h.fd)) return parseEntry(text);
    return null;
  } finally {
    fs.closeSync(h.fd);
  }
}

// Summary of one file, in one streaming pass: {info: {first, entries, maxTs, bytes, lines, torn}, v?}.
// `entries` counts parsable entries (the chain index), `lines` non-empty lines. With `ctx` = {prev, lastTs,
// tailOk} the file is also verified. Rotated files (`cacheable`) are cached by identity and stat.
const fileCache = new Map();

function statKey(st) {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
}

function scanFile(p, ctx, cacheable) {
  const h = openRead(p);
  if (!h) return null;
  try {
    const key = statKey(h.st);
    const vKey = ctx ? `${ctx.prev}:${ctx.lastTs}:${ctx.tailOk ? 1 : 0}` : null;
    if (cacheable) {
      const c = fileCache.get(p);
      if (c && c.key === key && (!ctx || c.vKey === vKey)) return { info: c.info, v: c.v };
    }
    const info = { first: null, entries: 0, maxTs: -Infinity, bytes: 0, lines: 0, torn: false };
    const ver = ctx ? createVerifier(ctx.prev, ctx.lastTs, p) : null;
    const meta = { bytes: 0 };
    for (const { line, text, eol } of fdLines(h.fd, meta)) {
      const e = text === '' ? null : parseEntry(text);
      if (line === 1) info.first = e;
      if (text !== '') info.lines++;
      if (e) {
        info.entries++;
        if (e.ts > info.maxTs) info.maxTs = e.ts;
      }
      if (!eol) info.torn = true;
      if (ver) ver.feed(line, text);
    }
    info.bytes = meta.bytes;
    const v = ver ? ver.result({ tailOk: ctx.tailOk }) : undefined;
    if (cacheable) {
      if (fileCache.size >= CACHE_MAX) fileCache.clear();
      const old = fileCache.get(p);
      const keep = old && old.key === key ? old : null;
      fileCache.set(p, { key, info, vKey: v ? vKey : keep?.vKey ?? null, v: v ?? keep?.v });
    }
    return { info, v };
  } finally {
    fs.closeSync(h.fd);
  }
}

// Parsable entries of a file with their local index, streamed.
function* fileEntries(p) {
  const h = openRead(p);
  if (!h) return;
  try {
    let k = 0;
    for (const { text } of fdLines(h.fd)) {
      const e = text === '' ? null : parseEntry(text);
      if (e) yield { k: k++, entry: e };
    }
  } finally {
    fs.closeSync(h.fd);
  }
}

/**
 * Chain files oldest first, found by following `audit.rotate` targets back from `file`.
 * -> {files: [abs paths], brokenLink: null | {file, target}}  (brokenLink: a rotate entry names a file that is
 * missing, unsafe (a symlink, not a regular file) or already visited)
 */
function chainFiles(file) {
  const dir = path.dirname(file);
  const files = [file];
  const seen = new Set([path.basename(file)]);
  let cur = file;
  let first = firstEntryOf(cur);
  for (;;) {
    if (!first || first.action !== ROTATE_ACTION) return { files: files.reverse(), brokenLink: null };
    const target = first.target;
    if (typeof target !== 'string' || !ROTATED_NAME.test(target) || seen.has(target)) {
      return { files: files.reverse(), brokenLink: { file: cur, target } };
    }
    const prev = path.join(dir, target);
    let pf;
    try {
      pf = firstEntryOf(prev);
    } catch {
      pf = undefined; // ELOOP (symlink), not a regular file, unreadable
    }
    if (pf === undefined) return { files: files.reverse(), brokenLink: { file: cur, target } };
    seen.add(target);
    files.push(prev);
    cur = prev;
    first = pf;
  }
}

// Verify the whole chain. -> {result: verifyChain's answer, cur: the current file's info}
function analyzeChain(file, { writer = false } = {}) {
  const { files, brokenLink } = chainFiles(file);
  let prev = GENESIS;
  let lastTs = -Infinity;
  let count = 0;
  const warnings = [];
  let cur = null;
  const done = (r, ts = lastTs) => {
    if (warnings.length) r.warnings = warnings;
    return { result: r, cur, lastTs: ts };
  };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (i === 0 && brokenLink) {
      // The oldest file we could reach starts with a rotate entry whose target is gone or unsafe.
      return done({ ok: false, count, head: prev, firstBad: { file: f, line: 1, reason: 'prev_mismatch' } });
    }
    const isCur = i === files.length - 1;
    const s = scanFile(f, { prev, lastTs, tailOk: isCur ? writer : true }, !isCur);
    const info = s?.info ?? { first: null, entries: 0, maxTs: -Infinity, bytes: 0, lines: 0, torn: false };
    const r = s?.v ?? { ok: true, count: 0, head: prev, lastTs };
    if (isCur) cur = info;
    if (r.warnings) warnings.push(...r.warnings);
    count += r.count;
    if (!r.ok) return done({ ok: false, count, head: r.head, firstBad: r.firstBad }, r.lastTs);
    if (i > 0) {
      // A rotated-into file must start with the rotate entry naming its predecessor.
      const first = info.first;
      if (!first || first.action !== ROTATE_ACTION || first.target !== path.basename(files[i - 1])) {
        return done({ ok: false, count: count - r.count, head: prev, firstBad: { file: f, line: 1, reason: 'prev_mismatch' } });
      }
    }
    prev = r.head;
    lastTs = r.lastTs;
  }
  return done({ ok: true, count, head: prev });
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

function writeAll(fd, buf) {
  let off = 0;
  while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
}

function tryUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // best effort
  }
}

// The audit directory: created 0700; an existing one must be a real directory we own, and is tightened to 0700.
function prepareDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw auditError('AUDIT_UNSAFE_DIR', `audit: ${dir} is not a plain directory (symlink?)`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw auditError('AUDIT_UNSAFE_DIR', `audit: ${dir} is owned by another user; use a private directory`);
  }
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

// ---------------------------------------------------------------------------------------------------------
// Single-writer lock

const heldLocks = new Set(); // lock paths held by an open instance in this process

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLockOwner(lockFile) {
  const h = (() => {
    try {
      return openRead(lockFile);
    } catch {
      return undefined;
    }
  })();
  if (h === null) return null; // gone
  if (h === undefined) return { unreadable: true };
  try {
    const buf = Buffer.alloc(256);
    const n = fs.readSync(h.fd, buf, 0, buf.length, 0);
    const m = /^(\d{1,10}) (\S{1,200})\n$/.exec(buf.subarray(0, n).toString('utf8'));
    if (!m) return { unreadable: true };
    return { pid: Number(m[1]), host: m[2] };
  } finally {
    fs.closeSync(h.fd);
  }
}

// -> {fd, st} of our lock file. Throws AUDIT_LOCKED when another live writer holds it.
function acquireLock(lockFile) {
  const host = os.hostname().replace(/\s/g, '_') || 'localhost';
  const content = `${process.pid} ${host}\n`;
  const tmp = `${lockFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const tfd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeAll(tfd, Buffer.from(content));
    fs.fsyncSync(tfd);
  } finally {
    fs.closeSync(tfd);
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.linkSync(tmp, lockFile); // atomic, never replaces, and the lock is complete when it appears
        break;
      } catch (err) {
        if (err.code !== 'EEXIST' || attempt >= 3) throw err;
      }
      const owner = readLockOwner(lockFile);
      if (owner === null) continue; // released meanwhile
      const stale = owner.pid > 0 && owner.host === host
        && (owner.pid === process.pid ? !heldLocks.has(lockFile) : !pidAlive(owner.pid));
      if (!stale) {
        const who = owner.unreadable ? 'an unreadable lock' : `pid ${owner.pid} on ${owner.host}`;
        throw auditError('AUDIT_LOCKED', `audit: ${lockFile} is held by ${who}; only one writer may open the audit log `
          + '(set LANEBOARD_AUDIT_FILE to a private path for a second instance, or remove the lock if that writer is gone)');
      }
      tryUnlink(lockFile);
    }
  } finally {
    tryUnlink(tmp);
  }
  const h = openRead(lockFile);
  const owner = h && readLockOwner(lockFile);
  if (!h || !owner || owner.pid !== process.pid || owner.host !== host) {
    if (h) fs.closeSync(h.fd);
    throw auditError('AUDIT_LOCKED', `audit: lost the race for ${lockFile} to another writer`);
  }
  heldLocks.add(lockFile);
  return h;
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

// ---------------------------------------------------------------------------------------------------------
// openAudit

/**
 * openAudit({file = auditFile(), maxBytes = 10485760, now = Date.now, builder = null})
 *   -> {file, append(entry), head(), read({since, after, limit}), verifyAll(), hasHead({hash, count}), close()}
 *
 * Takes the single-writer lock `<file>.lock` (throws an Error with code `AUDIT_LOCKED` when another live writer
 * holds it, in this process too: share one instance). close() releases it.
 * append(entry) -> the stored entry (with prevHash and hash). Input fields: ts? (ms; clamped to
 *   [last entry's ts, now()+60s] so the chain never regresses and cannot be pinned in the future), id? (default
 *   a random UUID), user, via, builder (default the `builder` option), action (required; `audit.rotate` is
 *   reserved), target, args (hashed, never stored) or argsHash, result (plain object; strings truncated to 300
 *   chars, at most 4 KiB). Unknown fields throw. Throws (code) `AUDIT_CHAIN_INVALID` when the chain on disk
 *   does not verify, `AUDIT_DETACHED` when the file was removed or renamed, `AUDIT_LOCK_LOST`, `AUDIT_FAILED`.
 * head() -> {hash, count}: count = verified entries in the whole chain (rotated files included).
 * read({since, after, limit}) -> {entries, more, head, afterFound?, afterIndex?}: entries oldest first;
 *   `after` (a hash) wins over `since` (ms, ts >= since); limit 1..1000 (default 1000). An `after` that is not in
 *   the chain answers `afterFound:false` and no entries (the caller decides: a hub treats it as a fork).
 *   `afterIndex` is the 0-based chain index of the `after` entry. Torn/unparsable lines are skipped.
 * verifyAll() -> {ok, count, head, firstBad?: {file, line, reason}, warnings?} over every chain file.
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
  const lockFile = `${file}.lock`;
  const defaultBuilder = optStr('builder', builder);

  prepareDir(dir);
  let lock = acquireLock(lockFile);

  let fd = null;
  let state = null; // {hash, count, lastTs, size, fileLines, torn, invalid}
  let broken = null; // an Error: this instance must not write any more

  function recoverRotation() {
    if (!fs.existsSync(tmpFile)) return;
    if (fs.existsSync(file)) {
      // Crashed before `.rotating` was renamed into place: the rotation did not happen.
      fs.unlinkSync(tmpFile);
    } else {
      // A rotation by an older version crashed after moving the old file away: finish it.
      fs.renameSync(tmpFile, file);
    }
    fsyncDir(dir);
  }

  function computeState() {
    const { result, cur, lastTs } = analyzeChain(file, { writer: true });
    return {
      hash: result.head,
      count: result.count,
      lastTs,
      size: cur ? cur.bytes : 0,
      fileLines: cur ? cur.lines : 0,
      torn: cur ? cur.torn : false,
      invalid: result.ok ? null : result.firstBad,
    };
  }

  function openFd() {
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | O_NOFOLLOW;
    fd = fs.openSync(file, flags, 0o600);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      fs.closeSync(fd);
      fd = null;
      throw auditError('AUDIT_UNSAFE_FILE', `audit: ${file} is not a regular file`);
    }
    if ((st.mode & 0o777) !== 0o600) fs.fchmodSync(fd, 0o600);
  }

  // Our fd must still be the file at `file`: reopen a replaced file, refuse a removed or renamed one.
  function checkPath() {
    let ps;
    try {
      ps = fs.lstatSync(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      throw auditError('AUDIT_DETACHED', `audit: ${file} was removed or renamed while open; refusing to write into a detached file (reopen the audit log)`);
    }
    if (!sameFile(ps, fs.fstatSync(fd))) {
      fs.closeSync(fd);
      fd = null;
      state = null;
      openFd();
    }
  }

  function checkLock() {
    let ps = null;
    try {
      ps = fs.lstatSync(lockFile);
    } catch {
      // gone
    }
    if (!ps || !sameFile(ps, fs.fstatSync(lock.fd))) {
      broken = auditError('AUDIT_LOCK_LOST', `audit: ${lockFile} was removed or replaced; another writer may own the log, refusing to write`);
      throw broken;
    }
  }

  function ensure() {
    if (broken) throw broken;
    if (lock === null) throw auditError('AUDIT_FAILED', 'audit: the log is closed');
    if (fd === null) openFd();
    else checkPath();
    const size = fs.fstatSync(fd).size;
    if (state === null || size !== state.size) state = computeState();
  }

  function seal(entry) {
    const e = { ...entry, prevHash: state.hash };
    return { ...e, hash: entryHash(e) };
  }

  function nextTs(wanted) {
    const nowMs = Math.trunc(now());
    if (!Number.isSafeInteger(nowMs)) throw new TypeError('audit: now() must return ms');
    const t = Number.isSafeInteger(wanted) ? Math.min(wanted, nowMs + TS_FUTURE_MAX_MS) : nowMs;
    return Math.max(t, state.lastTs === -Infinity ? t : state.lastTs);
  }

  // Give the full current file a second, rotated name. link(2) never replaces an existing file.
  function linkRotated() {
    const base = `${stem}-${utcStamp(now())}`;
    for (let n = 0; n < 1000; n++) {
      const name = n === 0 ? `${base}.jsonl` : `${base}-${n}.jsonl`;
      try {
        fs.linkSync(file, path.join(dir, name));
        return name;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
    throw auditError('AUDIT_FAILED', 'audit: no free rotated file name');
  }

  function rotate() {
    const oldName = linkRotated();
    const oldPath = path.join(dir, oldName);
    let entry;
    let buf;
    try {
      entry = seal(buildEntry(
        { user: null, via: 'local', action: ROTATE_ACTION, target: oldName, result: { ok: true, count: state.count } },
        { ts: nextTs(undefined), defaultBuilder, internal: true },
      ));
      buf = Buffer.from(`${canonicalJson(entry)}\n`, 'utf8');
      // the new file, complete and durable, under a temporary name
      tryUnlink(tmpFile);
      const tfd = fs.openSync(tmpFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
      try {
        writeAll(tfd, buf);
        fs.fsyncSync(tfd);
      } finally {
        fs.closeSync(tfd);
      }
      // atomically replace the current file (its content stays reachable under oldName)
      fs.renameSync(tmpFile, file);
    } catch (err) {
      // undo: the current file is untouched, drop the extra name and the temp file
      tryUnlink(tmpFile);
      tryUnlink(oldPath);
      throw err;
    }
    fsyncDir(dir);
    const oldFd = fd;
    fd = null;
    fs.closeSync(oldFd);
    try {
      openFd();
    } catch (err) {
      broken = auditError('AUDIT_FAILED', `audit: could not reopen ${file} after rotation (${err.code ?? err.message}); reopen the audit log`);
      throw broken;
    }
    state = {
      hash: entry.hash,
      count: state.count + 1,
      lastTs: entry.ts,
      size: buf.length,
      fileLines: 1,
      torn: false,
      invalid: null,
    };
  }

  function append(input) {
    ensure();
    checkLock();
    if (state.invalid) {
      const b = state.invalid;
      throw auditError('AUDIT_CHAIN_INVALID', `audit: the chain on disk does not verify (${b.reason} at ${path.basename(b.file ?? file)}:${b.line}); `
        + 'refusing to extend it. Run `laneboard audit verify`, then move the log aside to start a new chain');
    }
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
    const buf = Buffer.from(lineText, 'utf8');
    writeAll(fd, buf);
    fs.fsyncSync(fd);
    state.size += buf.length;
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

  // Rotated files with their cached entry counts and first chain index.
  function layout() {
    const { files } = chainFiles(file);
    const out = [];
    let base = 0;
    for (let i = 0; i < files.length; i++) {
      const isCur = i === files.length - 1;
      const info = isCur ? null : scanFile(files[i], null, true)?.info ?? { entries: 0, maxTs: -Infinity };
      out.push({ f: files[i], base, entries: info ? info.entries : null, maxTs: info ? info.maxTs : Infinity });
      if (info) base += info.entries;
    }
    return out;
  }

  function read({ since, after, limit } = {}) {
    const h = head();
    let lim = limit === undefined || limit === null ? MAX_READ_LIMIT : Number(limit);
    if (!Number.isFinite(lim)) lim = MAX_READ_LIMIT;
    lim = Math.min(MAX_READ_LIMIT, Math.max(1, Math.trunc(lim)));
    const files = layout();
    const entries = [];
    let more = false;
    const useAfter = typeof after === 'string' && after !== '';
    const sinceMs = Number.isFinite(Number(since)) && since !== null && since !== '' ? Number(since) : -Infinity;
    let startFile = 0;
    let startK = 0;
    let afterIndex;
    if (useAfter) {
      // newest first: a hub poll asks for the recent head, which is almost always in the current file
      for (let i = files.length - 1; i >= 0 && afterIndex === undefined; i--) {
        for (const { k, entry } of fileEntries(files[i].f)) {
          if (entry.hash === after) {
            afterIndex = files[i].base + k;
            startFile = i;
            startK = k + 1;
            break;
          }
        }
      }
      if (afterIndex === undefined) return { entries, more, head: h, afterFound: false };
    } else if (sinceMs !== -Infinity) {
      while (startFile < files.length - 1 && files[startFile].maxTs < sinceMs) startFile++;
    }
    outer: for (let i = startFile; i < files.length; i++) {
      for (const { k, entry } of fileEntries(files[i].f)) {
        if (i === startFile && k < startK) continue;
        if (!useAfter && entry.ts < sinceMs) continue;
        if (entries.length >= lim) {
          more = true;
          break outer;
        }
        entries.push(entry);
      }
    }
    const out = { entries, more, head: h };
    if (useAfter) {
      out.afterFound = true;
      out.afterIndex = afterIndex;
    }
    return out;
  }

  function hasHead(anchor) {
    if (!anchor || typeof anchor.hash !== 'string' || !Number.isSafeInteger(anchor.count) || anchor.count < 0) return false;
    if (anchor.count === 0) return anchor.hash === GENESIS;
    const idx = anchor.count - 1;
    for (const { f, base, entries } of layout()) {
      if (idx < base) return false;
      if (entries !== null && idx >= base + entries) continue;
      for (const { k, entry } of fileEntries(f)) {
        if (base + k === idx) return entry.hash === anchor.hash;
      }
      return false;
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
    if (lock !== null) {
      try {
        const ps = fs.lstatSync(lockFile);
        if (sameFile(ps, fs.fstatSync(lock.fd))) fs.unlinkSync(lockFile);
      } catch {
        // already gone or replaced: not ours to remove
      }
      fs.closeSync(lock.fd);
      heldLocks.delete(lockFile);
      lock = null;
    }
  }

  try {
    recoverRotation();
    ensure();
  } catch (err) {
    close();
    throw err;
  }
  return { file, append, head, read, verifyAll, hasHead, close };
}

/**
 * verifyChain(file) -> {ok, count, head, firstBad?: {file, line, reason}, warnings?: [{file, line, reason}]}
 * Verifies the current file and every rotated file it links to, oldest first, without opening for writing (and
 * without the writer lock). Used by `openAudit().verifyAll()` and `laneboard audit verify --file`.
 */
export function verifyChain(file) {
  return analyzeChain(path.resolve(file)).result;
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
