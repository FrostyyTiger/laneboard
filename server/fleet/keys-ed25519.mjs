// Ed25519 key helpers for hub ↔ builder signatures.
//
// REVIEW-REQUIRED (SR1). Plan §2 2.4 and README §3.2:
//   - hub private key: PEM PKCS8 Ed25519, file mode 0600 (dir 0700), from
//     `laneboard fleet keygen` (generateHubKey) or `openssl genpkey -algorithm ed25519`;
//   - pinned public keys (`fleet.hubKeys`): PEM SPKI or `ed25519:<base64 raw 32 bytes>`,
//     both accepted, both strict;
//   - keyId = first 16 hex of sha256(raw 32-byte public key), the same for both spellings;
//   - signatures: plain Ed25519 (crypto.sign(null, …)) over UTF-8 bytes, carried as
//     base64 of the 64-byte signature.
//
// Defensive choices beyond the plan text:
//   - base64 is checked strictly (alphabet, padding, canonical round trip);
//     Buffer.from(…, 'base64') alone silently skips garbage;
//   - PEM public keys must be exactly one SPKI block whose DER is the 44-byte
//     Ed25519 SPKI (RFC 8410), nothing before or after it;
//   - public keys of small order (identity, order 2/4/8 points) and
//     non-canonical encodings (y >= p) are refused: no honest key is one, and
//     a pinned weak key is the classic way to make forgeries cheap;
//   - strings to sign/verify must be well-formed UTF-16 (a lone surrogate
//     would be encoded lossily, letting two strings share a signature);
//   - verify() never throws on wire input (bad signature text → false); it
//     throws only on programming errors (wrong argument types, bad pinned key).
// Nothing here logs; error messages never contain key material or signatures.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // SEQ{SEQ{OID 1.3.101.112}, BIT STRING(33)}
const PEM_PUBLIC_RE = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n-----END PUBLIC KEY-----$/;
const RAW_B64_RE = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes
const SIG_B64_RE = /^[A-Za-z0-9+/]{86}==$/; // 64 bytes
const MAX_KEY_TEXT = 4096;
const MAX_KEY_FILE = 16384;

// --- weak public keys --------------------------------------------------------

const P = 2n ** 255n - 19n;

function yOf(raw) {
  // little-endian y with the x sign bit (top bit of byte 31) cleared
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? raw[i] & 0x7f : raw[i]);
  return y;
}

// y coordinates of every point of order 1, 2, 4 and 8 (libsodium's list).
const SMALL_ORDER_Y = new Set([
  0n, // order 4
  1n, // order 1 (identity)
  P - 1n, // order 2
  yOf(Buffer.from('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', 'hex')), // order 8
  yOf(Buffer.from('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'hex')), // order 8
]);

function assertStrongRaw(raw) {
  if (raw.length !== 32) throw new TypeError('ed25519 public key must be 32 bytes');
  const y = yOf(raw);
  if (y >= P) throw new TypeError('ed25519 public key is not canonically encoded');
  if (SMALL_ORDER_Y.has(y)) throw new TypeError('ed25519 public key has small order');
}

// --- helpers -----------------------------------------------------------------

function isEd25519(k, type) {
  return k instanceof crypto.KeyObject && k.type === type && k.asymmetricKeyType === 'ed25519';
}

function strictB64(s, re, len) {
  if (typeof s !== 'string' || !re.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  if (buf.length !== len || buf.toString('base64') !== s) return null;
  return buf;
}

function toPublic(k) {
  if (typeof k === 'string') return parsePublicKey(k);
  if (isEd25519(k, 'public')) return k;
  if (isEd25519(k, 'private')) return crypto.createPublicKey(k);
  throw new TypeError('expected an Ed25519 key (KeyObject or public key string)');
}

function dataBytes(data, fn) {
  if (typeof data === 'string') {
    if (!data.isWellFormed()) return null;
    return Buffer.from(data, 'utf8');
  }
  if (data instanceof Uint8Array) return data;
  throw new TypeError(`${fn}: data must be a string or bytes`);
}

/** Raw 32-byte public key of an Ed25519 KeyObject (public or private) or key string. */
export function rawPublicKey(k) {
  const pub = toPublic(k);
  const raw = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url');
  if (raw.length !== 32) throw new TypeError('ed25519 public key must be 32 bytes');
  return raw;
}

// --- public API --------------------------------------------------------------

/**
 * Parse a pinned public key: `ed25519:<base64 of the raw 32 bytes>` or a PEM
 * SPKI block (`-----BEGIN PUBLIC KEY-----`). Surrounding whitespace is
 * ignored. Anything else, any other algorithm, a weak key → TypeError.
 */
export function parsePublicKey(str) {
  if (typeof str !== 'string') throw new TypeError('public key must be a string');
  if (str.length > MAX_KEY_TEXT) throw new TypeError('public key text too long');
  const s = str.trim();
  let raw;
  if (s.startsWith('ed25519:')) {
    raw = strictB64(s.slice('ed25519:'.length), RAW_B64_RE, 32);
    if (!raw) throw new TypeError('ed25519: key must be base64 of exactly 32 bytes');
  } else if (s.startsWith('-----BEGIN PUBLIC KEY-----')) {
    const m = PEM_PUBLIC_RE.exec(s);
    if (!m) throw new TypeError('malformed PEM public key (expected one SPKI block)');
    const body = m[1].replace(/[\r\n]/g, '');
    const der = body.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(body) ? Buffer.from(body, 'base64') : null;
    if (!der || der.toString('base64') !== body) throw new TypeError('malformed PEM public key (bad base64)');
    if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_PREFIX)) {
      throw new TypeError('PEM public key is not an Ed25519 SPKI key');
    }
    raw = der.subarray(12);
  } else {
    throw new TypeError('public key must be "ed25519:<base64>" or a PEM SPKI block');
  }
  assertStrongRaw(raw);
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') },
    format: 'jwk',
  });
  if (!isEd25519(key, 'public')) throw new TypeError('not an Ed25519 public key');
  return key;
}

/** `ed25519:<base64 raw 32 bytes>` for an Ed25519 KeyObject (public, or private → its public half). */
export function publicKeyString(k) {
  return `ed25519:${rawPublicKey(k).toString('base64')}`;
}

/** PEM SPKI for an Ed25519 KeyObject (public, or private → its public half). */
export function publicKeyPem(k) {
  return toPublic(k).export({ type: 'spki', format: 'pem' });
}

/** First 16 hex chars of sha256(raw 32-byte public key). Accepts a key string or KeyObject. */
export function keyId(k) {
  return crypto.createHash('sha256').update(rawPublicKey(k)).digest('hex').slice(0, 16);
}

/**
 * Write an Ed25519 private key as PEM PKCS8 to `file`, mode 0600, refusing to
 * overwrite (flag `wx`); missing parent dirs are created 0700.
 */
export function writePrivateKey(file, privateKey) {
  if (!isEd25519(privateKey, 'private')) throw new TypeError('writePrivateKey: expected an Ed25519 private KeyObject');
  if (typeof file !== 'string' || file === '') throw new TypeError('writePrivateKey: file must be a path');
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fd = fs.openSync(abs, 'wx', 0o600);
  let ok = false;
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, pem);
    fs.fsyncSync(fd);
    ok = true;
  } finally {
    fs.closeSync(fd);
    if (!ok) {
      try { fs.unlinkSync(abs); } catch { /* best effort */ }
    }
  }
  return abs;
}

/**
 * New Ed25519 key pair. With `{file}`, the private key is also written there
 * (see writePrivateKey). Returns {privateKey, publicKey, file|null}.
 */
export function generateHubKey({ file } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const written = file === undefined || file === null ? null : writePrivateKey(file, privateKey);
  return { privateKey, publicKey, file: written };
}

/**
 * Load the hub's PEM PKCS8 Ed25519 private key. Refuses a file that is not a
 * regular file, is readable/writable by group or other, is owned by another
 * user (unless we are root), is larger than 16 KiB, is encrypted, or holds
 * anything but one unencrypted PKCS8 Ed25519 key.
 */
export function loadPrivateKey(file) {
  if (typeof file !== 'string' || file === '') throw new TypeError('loadPrivateKey: file must be a path');
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`hub key ${file} is not a regular file`);
    if (st.mode & 0o077) {
      throw new Error(`hub key ${file} is accessible by group/other (mode ${(st.mode & 0o777).toString(8)}); run chmod 600 on it`);
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid !== null && uid !== 0 && st.uid !== uid) throw new Error(`hub key ${file} is owned by another user`);
    if (st.size > MAX_KEY_FILE) throw new Error(`hub key ${file} is too large to be an Ed25519 key`);
    text = fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  const s = text.trim();
  const blocks = s.match(/-----BEGIN [A-Z0-9 ]+-----/g) || [];
  if (blocks.length !== 1 || !s.startsWith('-----BEGIN PRIVATE KEY-----') || !s.endsWith('-----END PRIVATE KEY-----')) {
    throw new Error(`hub key ${file} is not an unencrypted PEM PKCS8 private key`);
  }
  let key;
  try {
    key = crypto.createPrivateKey({ key: s, format: 'pem' });
  } catch {
    throw new Error(`hub key ${file} could not be parsed as a PEM PKCS8 private key`);
  }
  if (!isEd25519(key, 'private')) throw new Error(`hub key ${file} is not an Ed25519 key`);
  return key;
}

/** Base64 Ed25519 signature (64 bytes) of `data` (string → UTF-8, or bytes). */
export function sign(data, privateKey) {
  if (!isEd25519(privateKey, 'private')) throw new TypeError('sign: expected an Ed25519 private KeyObject');
  const bytes = dataBytes(data, 'sign');
  if (!bytes) throw new TypeError('sign: string is not well-formed UTF-16');
  return crypto.sign(null, bytes, privateKey).toString('base64');
}

/**
 * Verify a base64 Ed25519 signature. `pub` is a public KeyObject or a key
 * string (a bad pinned key throws). Malformed signature text, a non-string
 * signature or an ill-formed data string → false, never a throw.
 */
export function verify(data, sigB64, pub) {
  let key;
  if (typeof pub === 'string') key = parsePublicKey(pub);
  else if (isEd25519(pub, 'public')) {
    key = pub;
    assertStrongRaw(rawPublicKey(pub));
  } else throw new TypeError('verify: expected an Ed25519 public KeyObject or key string');
  const bytes = dataBytes(data, 'verify');
  if (!bytes) return false;
  const sig = strictB64(sigB64, SIG_B64_RE, 64);
  if (!sig) return false;
  try {
    return crypto.verify(null, bytes, key, sig) === true;
  } catch {
    return false;
  }
}
