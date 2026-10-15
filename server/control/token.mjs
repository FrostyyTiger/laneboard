// Hook token (fleet plan §8 2.2, task C4). REVIEW-REQUIRED (SR15).
//
// The PermissionRequest curl hook proves it runs as the builder's user by
// sending `X-Laneboard-Hook: <token>`, read from `<stateDir>/hook.header`
// (`curl -H @file`). The token is 32 random bytes as 64 lowercase hex chars in
// `<stateDir>/hook.token`. Both files are mode 0600, owned by this uid.
//
// Rules, each one load-bearing:
// - Files are written to a temp name with O_CREAT|O_EXCL and mode 0600, fsynced,
//   then renamed into place: a reader never sees a half-written token and an
//   existing file (or a planted symlink) is never written through.
// - A token file is reused only when it is a regular file (lstat, not a
//   symlink), owned by this uid, with no group/other bits and exactly 64 hex
//   chars. Anything else is replaced by a fresh token.
// - The comparison is constant-time over equal-length buffers; a missing,
//   malformed or duplicated header never matches.
// - The token is never logged.
//
// Also a tiny CLI for the installer (C10): `node server/control/token.mjs
// [stateDir]` creates the files if missing and prints the header file path.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TOKEN_FILE = 'hook.token';
export const HEADER_FILE = 'hook.header';
/** The request header the hook sends (lowercase, as node exposes it). */
export const HEADER_NAME = 'x-laneboard-hook';
export const TOKEN_RE = /^[0-9a-f]{64}$/;

const MODE = 0o600;
const uid = () => (typeof process.getuid === 'function' ? process.getuid() : null);

export function tokenPath(stateDir) {
  return path.join(dirOf(stateDir), TOKEN_FILE);
}

export function headerPath(stateDir) {
  return path.join(dirOf(stateDir), HEADER_FILE);
}

function dirOf(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir)) {
    throw new TypeError('hook token: stateDir must be an absolute path');
  }
  return stateDir;
}

/** A fresh 64-hex token. */
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** The header file's content for `token`. */
export function headerLine(token) {
  return `X-Laneboard-Hook: ${token}\n`;
}

/**
 * Read a private regular file (not a symlink, our uid, no group/other bits).
 * Returns its content, or null for anything else (missing included).
 */
function readPrivate(file, maxBytes = 256) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    if ((st.mode & 0o077) !== 0) return null;
    const me = uid();
    if (me !== null && st.uid !== me) return null;
    if (st.size > maxBytes) return null;
    const buf = Buffer.alloc(st.size);
    const n = st.size ? fs.readSync(fd, buf, 0, st.size, 0) : 0;
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/** Write `content` to `file` atomically with mode 0600 (temp + rename). */
function writePrivate(file, content) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), MODE);
  try {
    fs.fchmodSync(fd, MODE); // a umask cannot widen it, but be explicit
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** The current valid token in `stateDir`, or null (missing, unsafe or malformed). Never creates. */
export function readToken(stateDir) {
  const raw = readPrivate(tokenPath(stateDir));
  if (raw === null) return null;
  const t = raw.trim();
  return TOKEN_RE.test(t) ? t : null;
}

/**
 * Make sure `hook.token` and `hook.header` exist, are private and agree.
 * Creates `stateDir` (0700) when missing. Returns {token, tokenFile,
 * headerFile, created}. Throws on a filesystem error (the caller then
 * refuses every hook request: fail open to the terminal dialog).
 */
export function ensureToken(stateDir) {
  const dir = dirOf(stateDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tokenFile = tokenPath(dir);
  const headerFile = headerPath(dir);
  let token = readToken(dir);
  let created = false;
  if (!token) {
    token = generateToken();
    writePrivate(tokenFile, `${token}\n`);
    created = true;
  }
  if (readPrivate(headerFile) !== headerLine(token)) writePrivate(headerFile, headerLine(token));
  return { token, tokenFile, headerFile, created };
}

/**
 * Constant-time check of a request's header value against the expected
 * token. False for a missing, non-string (duplicated header), malformed or
 * wrong value.
 */
export function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!TOKEN_RE.test(expected)) return false;
  const p = provided.trim().toLowerCase();
  if (!TOKEN_RE.test(p)) return false;
  return crypto.timingSafeEqual(Buffer.from(p, 'utf8'), Buffer.from(expected, 'utf8'));
}

// CLI for the installer: create the files if missing, print the header path.
if (import.meta.main) {
  const arg = process.argv[2];
  let dir = arg;
  if (!dir) {
    const env = process.env.LANEBOARD_STATE_DIR;
    if (env) dir = path.resolve(env);
    else dir = (await import('../fleet/paths.mjs')).stateDir();
  }
  try {
    const r = ensureToken(path.resolve(dir));
    process.stdout.write(`${r.headerFile}\n`);
  } catch (err) {
    process.stderr.write(`laneboard: cannot create the hook token: ${err?.message || err}\n`);
    process.exitCode = 1;
  }
}
