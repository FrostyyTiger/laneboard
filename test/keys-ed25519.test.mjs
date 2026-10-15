// Ed25519 key helpers and XDG paths (fleet A1, REVIEW-REQUIRED SR1).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  generateHubKey, writePrivateKey, loadPrivateKey, publicKeyString, publicKeyPem,
  parsePublicKey, keyId, rawPublicKey, sign, verify,
} from '../server/fleet/keys-ed25519.mjs';
import { stateDir, configDir, hubKeyFile, auditFile } from '../server/fleet/paths.mjs';
import { canonicalJson } from '../server/fleet/canonical.mjs';

// `openssl genpkey -algorithm ed25519 | openssl pkey -pubout`; the ed25519: form and the
// keyId were computed independently with
// `openssl pkey -pubin -outform DER | tail -c 32 | base64` and `… | sha256sum | cut -c1-16`.
const OPENSSL_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKDfLUXCDZEyvg5oeEV9ZmrKqWn2KxiMVAzZd9wrEXj0=
-----END PUBLIC KEY-----
`;
const OPENSSL_RAW = 'ed25519:KDfLUXCDZEyvg5oeEV9ZmrKqWn2KxiMVAzZd9wrEXj0=';
const OPENSSL_ID = '742777c4d1433a65';

// RFC 8032 §7.1 test vectors 1 and 2.
const RFC = [
  {
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    pub: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    msg: '',
    sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    pub: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    msg: '72',
    sig: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
];
const b64u = (hex) => Buffer.from(hex, 'hex').toString('base64url');
const rfcPriv = (v) => crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64u(v.seed), x: b64u(v.pub) }, format: 'jwk' });

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lb-keys-'));
}
const sameKey = (a, b) => assert.ok(a.equals(b), 'keys differ');

// --- generate / round trips -------------------------------------------------

test('sign → verify round trip; tampering fails', () => {
  const { privateKey, publicKey, file } = generateHubKey();
  assert.equal(file, null);
  const data = canonicalJson({ v: 1, id: crypto.randomUUID(), action: 'send-text', args: { text: 'héllo \u{1F600}' } });
  const sig = sign(data, privateKey);
  assert.match(sig, /^[A-Za-z0-9+/]{86}==$/);
  assert.equal(verify(data, sig, publicKey), true);
  assert.equal(verify(data, sig, publicKeyString(publicKey)), true);
  assert.equal(verify(data, sig, publicKeyPem(publicKey)), true);
  assert.equal(verify(Buffer.from(data), sig, publicKey), true);
  assert.equal(verify(data + ' ', sig, publicKey), false);
  const flipped = Buffer.from(sig, 'base64');
  flipped[5] ^= 1;
  assert.equal(verify(data, flipped.toString('base64'), publicKey), false);
  assert.equal(verify(data, sig, generateHubKey().publicKey), false);
});

test('parsePublicKey(publicKeyString(k)) and parsePublicKey(publicKeyPem(k)) equal k, same keyId', () => {
  const { privateKey, publicKey } = generateHubKey();
  const s = publicKeyString(publicKey);
  const pem = publicKeyPem(publicKey);
  assert.match(s, /^ed25519:[A-Za-z0-9+/]{43}=$/);
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----\n/);
  sameKey(parsePublicKey(s), publicKey);
  sameKey(parsePublicKey(pem), publicKey);
  const id = keyId(publicKey);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(keyId(s), id);
  assert.equal(keyId(pem), id);
  assert.equal(keyId(parsePublicKey(s)), id);
  assert.equal(keyId(privateKey), id);
  assert.equal(publicKeyString(privateKey), s);
  assert.equal(publicKeyPem(privateKey), pem);
  assert.equal(id, crypto.createHash('sha256').update(rawPublicKey(publicKey)).digest('hex').slice(0, 16));
});

test('openssl-produced PEM fixture parses; both spellings give the same key and keyId', () => {
  const k = parsePublicKey(OPENSSL_PEM);
  assert.equal(k.asymmetricKeyType, 'ed25519');
  assert.equal(publicKeyString(k), OPENSSL_RAW);
  sameKey(parsePublicKey(OPENSSL_RAW), k);
  assert.equal(keyId(OPENSSL_PEM), OPENSSL_ID);
  assert.equal(keyId(OPENSSL_RAW), OPENSSL_ID);
  // CRLF line endings and surrounding whitespace are fine
  sameKey(parsePublicKey(`  ${OPENSSL_PEM.replace(/\n/g, '\r\n')}  `), k);
  sameKey(parsePublicKey(`\n${OPENSSL_RAW}\n`), k);
});

test('RFC 8032 vectors: sign gives the expected signature, verify accepts it', () => {
  for (const v of RFC) {
    const priv = rfcPriv(v);
    const msg = Buffer.from(v.msg, 'hex');
    const sigB64 = Buffer.from(v.sig, 'hex').toString('base64');
    assert.equal(sign(msg, priv), sigB64);
    assert.equal(verify(msg, sigB64, `ed25519:${Buffer.from(v.pub, 'hex').toString('base64')}`), true);
  }
});

test('live openssl: genpkey key loads, its pubout PEM parses to the same keyId', { skip: !hasOpenssl() }, () => {
  const dir = tmpdir();
  const f = path.join(dir, 'hub.key');
  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', f], { stdio: 'ignore' });
  fs.chmodSync(f, 0o600);
  const priv = loadPrivateKey(f);
  const pubPem = execFileSync('openssl', ['pkey', '-in', f, '-pubout'], { encoding: 'utf8' });
  assert.equal(keyId(pubPem), keyId(priv));
  assert.equal(verify('x', sign('x', priv), pubPem), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

function hasOpenssl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// --- parsePublicKey rejections ---------------------------------------------

test('parsePublicKey rejects malformed ed25519: strings', () => {
  const good = OPENSSL_RAW.slice('ed25519:'.length);
  const raw = Buffer.from(good, 'base64');
  const bad = [
    '', 'ed25519:', 'ed25519', `ED25519:${good}`, `ed25519 ${good}`, good,
    `ed25519:${raw.subarray(0, 31).toString('base64')}`, // 31 bytes
    `ed25519:${Buffer.concat([raw, Buffer.from([0])]).toString('base64')}`, // 33 bytes
    `ed25519:${raw.toString('base64url')}`, // base64url alphabet / no padding
    `ed25519:${good.slice(0, -1)}`, // missing padding
    `ed25519:${good.slice(0, 20)} ${good.slice(20)}`, // embedded space
    `ed25519:${good.slice(0, -2)}!=`, // garbage char Buffer.from would skip
    `ed25519:${good.slice(0, -2)}1=`, // non-canonical last char (nonzero pad bits)
    `ed25519:${good}x`,
    'ed25519:' + 'A'.repeat(5000),
  ];
  for (const s of bad) assert.throws(() => parsePublicKey(s), TypeError, s.slice(0, 60));
  for (const v of [undefined, null, 1, {}, Buffer.from(OPENSSL_PEM), parsePublicKey(OPENSSL_RAW)]) {
    assert.throws(() => parsePublicKey(v), TypeError);
  }
});

test('parsePublicKey rejects malformed or foreign PEM', () => {
  const lines = OPENSSL_PEM.trim().split('\n');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' });
  const x25519 = crypto.generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'pem' });
  const ed448 = crypto.generateKeyPairSync('ed448').publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = generateHubKey().privateKey.export({ type: 'pkcs8', format: 'pem' });
  const bad = [
    rsa, ec, x25519, ed448, privPem,
    `${lines[0]}\n${lines[2]}`, // empty body
    `${lines[0]}\n${lines[1]}`, // no END
    `${lines[0]}\n${lines[1].slice(0, -4)}\n${lines[2]}`, // truncated body
    `${lines[0]}\n${lines[1]}!\n${lines[2]}`, // garbage char
    `${lines[0]}\n${lines[1]}\n${lines[2]}\n${OPENSSL_PEM}`, // two blocks
    `${lines[0]}\n${lines[1]}\n${lines[2]}\ntrailing`, // trailing garbage
    `junk\n${OPENSSL_PEM}`, // leading garbage
    OPENSSL_PEM.replace('PUBLIC KEY-----\n', 'PUBLIC KEY-----'), // header glued to body
    OPENSSL_PEM.replace('-----END PUBLIC KEY-----', '-----END PRIVATE KEY-----'),
  ];
  for (const s of bad) assert.throws(() => parsePublicKey(s), TypeError, s.slice(0, 80));
});

test('parsePublicKey refuses small-order and non-canonical public keys', () => {
  const P = 2n ** 255n - 19n;
  const le = (n) => { const b = Buffer.alloc(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };
  const weak = [
    le(0n), le(1n), le(P - 1n), le(P), le(P + 1n), le(2n ** 255n - 1n),
    Buffer.from('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', 'hex'),
    Buffer.from('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85', 'hex'),
    Buffer.from('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'hex'),
    Buffer.from('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', 'hex'),
  ];
  // the identity with the sign bit set, too
  const negId = le(1n); negId[31] |= 0x80; weak.push(negId);
  for (const raw of weak) {
    assert.throws(() => parsePublicKey(`ed25519:${raw.toString('base64')}`), /small order|canonical/, raw.toString('hex'));
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64')}\n-----END PUBLIC KEY-----\n`;
    assert.throws(() => parsePublicKey(pem), /small order|canonical/, raw.toString('hex'));
  }
});

// --- sign / verify argument handling ----------------------------------------

test('verify returns false (never throws) for malformed signatures', () => {
  const { privateKey, publicKey } = generateHubKey();
  const sig = sign('m', privateKey);
  for (const s of [undefined, null, 1, {}, '', 'ed25519 ' + sig, sig.slice(0, -2), sig + 'A', sig.replace(/=+$/, ''),
    Buffer.from(sig, 'base64').toString('base64url'), Buffer.alloc(64).toString('base64'), 'A'.repeat(100000)]) {
    assert.equal(verify('m', s, publicKey), false);
  }
  // ill-formed data string: false, not a lossy-encoded match
  assert.equal(verify('\ud800', sig, publicKey), false);
});

test('a lone surrogate cannot share a signature with U+FFFD', () => {
  const { privateKey, publicKey } = generateHubKey();
  assert.throws(() => sign('a\ud800', privateKey), TypeError);
  const sig = sign('a�', privateKey);
  assert.equal(verify('a\ud800', sig, publicKey), false);
});

test('sign/verify reject wrong key kinds and data types', () => {
  const { privateKey, publicKey } = generateHubKey();
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  assert.throws(() => sign('x', publicKey), TypeError);
  assert.throws(() => sign('x', rsa.privateKey), TypeError);
  assert.throws(() => sign('x', 'not a key'), TypeError);
  assert.throws(() => sign({ a: 1 }, privateKey), TypeError);
  assert.throws(() => sign(1, privateKey), TypeError);
  const sig = sign('x', privateKey);
  assert.throws(() => verify('x', sig, privateKey), TypeError); // a private key is not a pinned key
  assert.throws(() => verify('x', sig, rsa.publicKey), TypeError);
  assert.throws(() => verify('x', sig, 'ed25519:nope'), TypeError);
  assert.throws(() => verify({ a: 1 }, sig, publicKey), TypeError);
  assert.throws(() => keyId('nope'), TypeError);
  assert.throws(() => keyId(rsa.publicKey), TypeError);
  assert.throws(() => publicKeyString({}), TypeError);
});

test('Ed25519 signatures are deterministic and bound to the exact bytes', () => {
  const { privateKey, publicKey } = generateHubKey();
  const a = canonicalJson({ b: 1, a: 2 });
  assert.equal(sign(a, privateKey), sign(canonicalJson({ a: 2, b: 1 }), privateKey));
  assert.equal(verify(canonicalJson({ a: 2, b: 2 }), sign(a, privateKey), publicKey), false);
});

// --- private key files -------------------------------------------------------

test('generateHubKey({file}) writes PKCS8 PEM 0600 in a 0700 dir; loadPrivateKey reads it back', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'nested', 'laneboard', 'hub.key');
  const { privateKey, publicKey, file } = generateHubKey({ file: f });
  assert.equal(file, f);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f)).mode & 0o777, 0o700);
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^-----BEGIN PRIVATE KEY-----\n/);
  const loaded = loadPrivateKey(f);
  assert.equal(loaded.type, 'private');
  assert.equal(loaded.asymmetricKeyType, 'ed25519');
  assert.equal(keyId(loaded), keyId(publicKey));
  assert.equal(verify('hi', sign('hi', loaded), publicKey), true);
  assert.equal(verify('hi', sign('hi', privateKey), publicKeyString(publicKey)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writePrivateKey never overwrites an existing file', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'hub.key');
  generateHubKey({ file: f });
  const before = fs.readFileSync(f);
  assert.throws(() => generateHubKey({ file: f }), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(f), before);
  assert.throws(() => writePrivateKey(path.join(dir, 'x'), generateHubKey().publicKey), TypeError);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadPrivateKey refuses group/other-accessible files', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'hub.key');
  generateHubKey({ file: f });
  for (const mode of [0o640, 0o604, 0o660, 0o644, 0o700 | 0o004, 0o620]) {
    fs.chmodSync(f, mode);
    assert.throws(() => loadPrivateKey(f), /group\/other/, mode.toString(8));
  }
  fs.chmodSync(f, 0o400);
  assert.equal(loadPrivateKey(f).asymmetricKeyType, 'ed25519');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadPrivateKey refuses non-key, foreign, encrypted, multi-block and oversized files without echoing content', () => {
  const dir = tmpdir();
  const put = (name, content) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, content, { mode: 0o600 });
    return f;
  };
  const ed = generateHubKey().privateKey;
  const edPem = ed.export({ type: 'pkcs8', format: 'pem' });
  const cases = {
    garbage: 'SECRETGARBAGE',
    empty: '',
    rsa: crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    x25519: crypto.generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    encrypted: ed.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }),
    publicOnly: OPENSSL_PEM,
    twoBlocks: edPem + edPem,
    withCert: edPem + '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
    corrupt: edPem.replace(/\n[A-Za-z0-9+/]{4}/, '\n!!!!'),
    huge: edPem + ' '.repeat(20000),
  };
  for (const [name, content] of Object.entries(cases)) {
    const f = put(name, content);
    assert.throws(() => loadPrivateKey(f), (e) => !/SECRETGARBAGE|MC4CAQAw/.test(e.message), name);
  }
  assert.throws(() => loadPrivateKey(dir), /regular file|EISDIR/);
  assert.throws(() => loadPrivateKey(path.join(dir, 'missing')), { code: 'ENOENT' });
  assert.throws(() => loadPrivateKey(''), TypeError);
  // a well-formed key with surrounding whitespace is fine
  assert.equal(keyId(loadPrivateKey(put('ws', `\n${edPem}\n\n`))), keyId(ed));
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- paths -------------------------------------------------------------------

test('paths: XDG variables when absolute, home fallbacks otherwise', () => {
  const home = '/home/user';
  assert.equal(stateDir({ env: {}, home }), '/home/user/.local/state/laneboard');
  assert.equal(configDir({ env: {}, home }), '/home/user/.config/laneboard');
  assert.equal(hubKeyFile({ env: {}, home }), '/home/user/.config/laneboard/hub.key');
  assert.equal(auditFile({ env: {}, home }), '/home/user/.local/state/laneboard/audit.jsonl');
  const env = { XDG_STATE_HOME: '/srv/state', XDG_CONFIG_HOME: '/srv/cfg/' };
  assert.equal(stateDir({ env, home }), '/srv/state/laneboard');
  assert.equal(hubKeyFile({ env, home }), '/srv/cfg/laneboard/hub.key');
  assert.equal(auditFile({ env, home }), '/srv/state/laneboard/audit.jsonl');
  // relative or empty XDG values are invalid per the spec and ignored
  const rel = { XDG_STATE_HOME: 'state', XDG_CONFIG_HOME: '', LANEBOARD_AUDIT_FILE: '' };
  assert.equal(stateDir({ env: rel, home }), '/home/user/.local/state/laneboard');
  assert.equal(hubKeyFile({ env: rel, home }), '/home/user/.config/laneboard/hub.key');
  assert.equal(auditFile({ env: rel, home }), '/home/user/.local/state/laneboard/audit.jsonl');
  // XDG paths are normalized (no `..` escape left in the result)
  assert.equal(stateDir({ env: { XDG_STATE_HOME: '/srv/a/../b' }, home }), '/srv/b/laneboard');
});

test('paths: LANEBOARD_AUDIT_FILE wins and is made absolute', () => {
  assert.equal(auditFile({ env: { LANEBOARD_AUDIT_FILE: '/var/tmp/a.jsonl', XDG_STATE_HOME: '/srv' }, home: '/home/user' }), '/var/tmp/a.jsonl');
  assert.equal(auditFile({ env: { LANEBOARD_AUDIT_FILE: 'rel/a.jsonl' }, home: '/home/user' }), path.resolve('rel/a.jsonl'));
});

test('paths: defaults read process.env and os.homedir; a non-absolute home throws', () => {
  for (const f of [stateDir, configDir, hubKeyFile, auditFile]) assert.ok(path.isAbsolute(f()));
  assert.throws(() => stateDir({ env: {}, home: 'relative' }), /home directory/);
  assert.throws(() => hubKeyFile({ env: {}, home: '' }), /home directory/);
});
