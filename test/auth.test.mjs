// server/fleet/auth.mjs: classify, signed reads, envelopes, guards (fleet plan §2 2.3-2.5, §4 test list,
// SECURITY-FIXES S4/S5/S6/S16). Pure over fake requests {method, url, headers, rawHeaders?, socket}.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import * as auth from '../server/fleet/auth.mjs';
import { createNonceCache } from '../server/fleet/nonces.mjs';
import { publicKeyString, publicKeyPem, keyId, sign } from '../server/fleet/keys-ed25519.mjs';
import { canonicalJson as canonicalDirect } from '../server/fleet/canonical.mjs';

const {
  classify, verifyRead, verifyEnvelope, guardRequest, guardUpgrade, signedReadString, signRead, signEnvelope,
  termHeaders, actionHeaders, AuthError, canonicalJson, appCapsReadOnly, decodeDisplayName, writeUpgradeRefusal,
} = auth;

const T0 = 1_760_000_000_000;
const PORT = 7777;
const INGRESS = 7778;
const PUBLIC_HOST = 'builder-a.example.invalid:8443';
const ORIGIN = `https://${PUBLIC_HOST}`;

const hubKey = crypto.generateKeyPairSync('ed25519').privateKey; // control + term
const readKey = crypto.generateKeyPairSync('ed25519').privateKey; // bare string: read only
const ctlKey = crypto.generateKeyPairSync('ed25519').privateKey; // read + control
const otherKey = crypto.generateKeyPairSync('ed25519').privateKey; // never pinned
const HUB_KID = keyId(hubKey);
const READ_KID = keyId(readKey);
const CTL_KID = keyId(ctlKey);

function makeCfg(fleet = {}, top = {}) {
  return {
    port: PORT,
    mode: 'builder',
    publicUrl: ORIGIN,
    bindAddresses: ['127.0.0.1'],
    ...top,
    fleet: {
      id: 'builder-a',
      ingressPort: INGRESS,
      hubKeys: [
        { key: publicKeyPem(hubKey), id: 'hub-full', scopes: ['read', 'control', 'term'] },
        publicKeyString(readKey),
        { key: publicKeyString(ctlKey), id: 'hub-ctl', scopes: ['read', 'control'] },
      ],
      hubControl: true,
      hubAddrs: [],
      ingressPeerUid: null,
      allowedUsers: [],
      publicHosts: [PUBLIC_HOST],
      enforce: true,
      clockSkewMs: 60000,
      allowedOrigins: [],
      ...fleet,
    },
  };
}

function ctx(extra = {}) {
  return { nonces: createNonceCache({ now: () => T0 }), now: () => T0, warn: () => {}, ...extra };
}

/** A fake request. `serve: true` adds what tailscale serve adds on the ingress listener. */
function req({ method = 'GET', url = '/api/v1/hello', headers = {}, port = INGRESS, serve = port === INGRESS, raw = true, socket = {} } = {}) {
  const h = {};
  if (serve) {
    h.host = PUBLIC_HOST;
    h['x-forwarded-for'] = '100.64.0.10';
    h['x-forwarded-host'] = PUBLIC_HOST;
    h['x-forwarded-proto'] = 'https';
  } else {
    h.host = `127.0.0.1:${port}`;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) delete h[k.toLowerCase()];
    else h[k.toLowerCase()] = v;
  }
  const r = { method, url, headers: h, socket: { localPort: port, ...socket } };
  if (raw) r.rawHeaders = Object.entries(h).flatMap(([k, v]) => [k, v]);
  return r;
}

const lower = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

function readHeaders(method, url, { key = hubKey, ts = T0, nonce = crypto.randomUUID(), builderId = 'builder-a' } = {}) {
  return lower(signRead({ method, url, builderId, key, now: () => ts, uuid: () => nonce }));
}

function envelope(fields = {}) {
  return { v: 1, id: crypto.randomUUID(), ts: T0, builder: 'builder-a', action: 'send-text', target: 'web', args: { text: 'hi', enter: true }, user: 'alice@example.invalid', via: 'hub', ...fields };
}

function expectAuth(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AuthError, `expected AuthError, got ${err}`);
    assert.equal(err.status, status, `status for ${err.code}`);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

// --- exports -------------------------------------------------------------------------------------------------

test('exports the functions other tasks expect; canonicalJson is the canonical.mjs one', () => {
  for (const n of ['classify', 'signEnvelope', 'verifyEnvelope', 'signedReadString', 'signRead', 'verifyRead', 'guardRequest', 'guardUpgrade', 'canonicalJson']) {
    assert.equal(typeof auth[n], 'function', n);
  }
  assert.equal(canonicalJson, canonicalDirect);
});

// --- signedReadString / signRead -------------------------------------------------------------------------

test('signedReadString is `v1 METHOD builderId pathWithQuery ts nonce` and refuses ambiguous input', () => {
  const nonce = '11111111-2222-4333-8444-555555555555';
  assert.equal(signedReadString({ method: 'GET', builderId: 'builder-a', pathWithQuery: '/api/v1/audit?since=5', ts: 42, nonce }),
    `v1 GET builder-a /api/v1/audit?since=5 42 ${nonce}`);
  const ok = { method: 'GET', builderId: 'builder-a', pathWithQuery: '/x', ts: 1, nonce };
  for (const bad of [{ method: 'get' }, { method: 'G T' }, { builderId: 'Builder A' }, { pathWithQuery: '/a b' }, { pathWithQuery: 'x' },
    { pathWithQuery: '/a\nb' }, { ts: 1.5 }, { ts: -1 }, { ts: '1' }, { nonce: 'n' }]) {
    assert.throws(() => signedReadString({ ...ok, ...bad }), TypeError, JSON.stringify(bad));
  }
});

test('signRead returns the four headers; an absolute URL signs its path+query', () => {
  const nonce = crypto.randomUUID();
  const h = signRead({ method: 'get', url: 'https://builder-a.example.invalid:8443/api/v1/snapshot?x=1', builderId: 'builder-a', key: hubKey, now: () => T0, uuid: () => nonce });
  assert.deepEqual(Object.keys(h).sort(), ['X-Laneboard-Key', 'X-Laneboard-Nonce', 'X-Laneboard-Sig', 'X-Laneboard-Ts']);
  assert.equal(h['X-Laneboard-Ts'], String(T0));
  assert.equal(h['X-Laneboard-Nonce'], nonce);
  assert.equal(h['X-Laneboard-Key'], HUB_KID);
  assert.match(h['X-Laneboard-Sig'], /^ed25519 [A-Za-z0-9+/]{86}==$/);
  const a = verifyRead(req({ url: '/api/v1/snapshot?x=1', headers: lower(h) }), makeCfg(), ctx());
  assert.equal(a.kind, 'hub');
});

test('signEnvelope signs canonicalJson(env): key order does not matter', () => {
  const env = envelope();
  const shuffled = Object.fromEntries(Object.entries(env).reverse());
  assert.equal(signEnvelope(env, hubKey), signEnvelope(shuffled, hubKey));
  assert.equal(signEnvelope(env, hubKey), `ed25519 ${sign(canonicalJson(env), hubKey)}`);
  assert.throws(() => signEnvelope(null, hubKey), TypeError);
  assert.throws(() => signEnvelope({ ...env, args: { __proto__: null, constructor: 1 } }, hubKey));
});

// --- classify: listeners and header spoofing -------------------------------------------------------------

test('local listener: local; Tailscale-* headers are deleted from headers and rawHeaders', () => {
  const r = req({ port: PORT, headers: { 'tailscale-user-login': 'mallory@example.invalid', 'Tailscale-User-Name': 'M', 'tailscale-app-capabilities': '{}' } });
  const a = classify(r, makeCfg(), ctx());
  assert.deepEqual(a, { kind: 'local', user: 'local' });
  assert.equal(r.headers['tailscale-user-login'], undefined);
  assert.equal(r.headers['tailscale-user-name'], undefined);
  assert.equal(r.headers['tailscale-app-capabilities'], undefined);
  assert.ok(!r.rawHeaders.some((x) => /^tailscale-/i.test(x)));
});

test('local listener: X-Forwarded-* and a signature do not make a request ingress (heuristic deleted)', () => {
  const h = { 'x-forwarded-for': '100.64.0.10', 'x-forwarded-proto': 'https', ...readHeaders('GET', '/api/v1/hello') };
  const a = classify(req({ port: PORT, headers: h }), makeCfg(), ctx());
  assert.equal(a.kind, 'local');
});

test('no ingress listener configured (no fleet block): everything local, login kept for attribution', () => {
  const cfg = makeCfg({ ingressPort: null, enforce: false });
  assert.deepEqual(classify(req({ port: PORT, headers: { 'tailscale-user-login': 'alice@example.invalid' } }), cfg, ctx()), { kind: 'local', user: 'alice@example.invalid' });
  assert.deepEqual(classify(req({ port: PORT }), cfg, ctx()), { kind: 'local', user: 'local' });
});

test('ingress without X-Forwarded-For or X-Forwarded-Proto: https → 403 not-from-serve', () => {
  const cfg = makeCfg();
  const login = { 'tailscale-user-login': 'alice@example.invalid' };
  expectAuth(() => classify(req({ headers: { ...login, 'x-forwarded-for': undefined } }), cfg, ctx()), 403, 'not-from-serve');
  expectAuth(() => classify(req({ headers: { ...login, 'x-forwarded-proto': undefined } }), cfg, ctx()), 403, 'not-from-serve');
  expectAuth(() => classify(req({ headers: { ...login, 'x-forwarded-proto': 'http' } }), cfg, ctx()), 403, 'not-from-serve');
  expectAuth(() => classify(req({ headers: { ...login, 'x-forwarded-for': '  ' } }), cfg, ctx()), 403, 'not-from-serve');
});

test('ingress + Tailscale-User-Login → direct with decoded display name', () => {
  const a = classify(req({ headers: { 'tailscale-user-login': 'alice@example.invalid', 'tailscale-user-name': '=?utf-8?q?Al=C3=AFce_B?=' } }), makeCfg(), ctx());
  assert.deepEqual(a, { kind: 'direct', user: 'alice@example.invalid', name: 'Alïce B', readOnly: false });
});

test('ingress: user header + signature → 400 ambiguous-identity (also with a term envelope)', () => {
  const h = { 'tailscale-user-login': 'alice@example.invalid', ...readHeaders('GET', '/api/v1/hello') };
  expectAuth(() => classify(req({ headers: h }), makeCfg(), ctx()), 400, 'ambiguous-identity');
  const t = { 'tailscale-user-login': 'alice@example.invalid', 'x-laneboard-envelope': 'e30' };
  expectAuth(() => classify(req({ headers: t }), makeCfg(), ctx()), 400, 'ambiguous-identity');
});

test('ingress with neither header: enforce → 403 unidentified; not enforcing → direct/local', () => {
  expectAuth(() => classify(req(), makeCfg(), ctx()), 403, 'unidentified');
  assert.deepEqual(classify(req(), makeCfg({ enforce: false, insecureNoEnforce: true }), ctx()), { kind: 'direct', user: 'local', name: null, readOnly: false });
});

test('ingress: a login with spaces/controls is refused; repeated identity headers → 400', () => {
  expectAuth(() => classify(req({ headers: { 'tailscale-user-login': 'a b' } }), makeCfg(), ctx()), 403, 'unidentified');
  const r = req({ headers: { 'tailscale-user-login': 'alice@example.invalid' } });
  r.rawHeaders.push('Tailscale-User-Login', 'mallory@example.invalid');
  expectAuth(() => classify(r, makeCfg(), ctx()), 400, 'duplicate-header');
  const arr = req({ raw: false, headers: { 'x-laneboard-sig': ['ed25519 a', 'ed25519 b'] } });
  expectAuth(() => classify(arr, makeCfg(), ctx()), 400, 'duplicate-header');
});

test('allowedUsers: listed login → direct, other → 403 user-not-allowed', () => {
  const cfg = makeCfg({ allowedUsers: ['alice@example.invalid'] });
  assert.equal(classify(req({ headers: { 'tailscale-user-login': 'alice@example.invalid' } }), cfg, ctx()).kind, 'direct');
  expectAuth(() => classify(req({ headers: { 'tailscale-user-login': 'bob@example.invalid' } }), cfg, ctx()), 403, 'user-not-allowed');
});

test('ingressPeerUid: recorded uid must match; different or null → 403 not-from-serve; lookup fallback', () => {
  const cfg = makeCfg({ ingressPeerUid: 0 });
  const login = { 'tailscale-user-login': 'alice@example.invalid' };
  assert.equal(classify(req({ headers: login, socket: { lbPeerUid: 0 } }), cfg, ctx()).kind, 'direct');
  expectAuth(() => classify(req({ headers: login, socket: { lbPeerUid: 1000 } }), cfg, ctx()), 403, 'not-from-serve');
  expectAuth(() => classify(req({ headers: login, socket: { lbPeerUid: null } }), cfg, ctx()), 403, 'not-from-serve');
  // not recorded on the socket: looked up through opts.peerUid (socketPeerUid by default)
  assert.equal(classify(req({ headers: login }), cfg, ctx({ peerUid: () => 0 })).kind, 'direct');
  expectAuth(() => classify(req({ headers: login }), cfg, ctx({ peerUid: () => null })), 403, 'not-from-serve');
  expectAuth(() => classify(req({ headers: login }), cfg, ctx({ peerUid: () => { throw new Error('x'); } })), 403, 'not-from-serve');
  // a signed hub request is refused too, before any signature work
  const nonces = createNonceCache({ now: () => T0 });
  expectAuth(() => classify(req({ headers: readHeaders('GET', '/api/v1/hello'), socket: { lbPeerUid: 7 } }), cfg, ctx({ nonces })), 403, 'not-from-serve');
  assert.equal(nonces.size(), 0);
  // off: no lookup at all
  assert.equal(classify(req({ headers: login }), makeCfg(), ctx({ peerUid: () => { throw new Error('must not be called'); } })).kind, 'direct');
});

test('Tailscale-App-Capabilities role read makes direct read-only and blocks mutations; absent changes nothing', () => {
  const caps = JSON.stringify({ 'laneboard.dev/cap': [{ role: 'read' }] });
  assert.equal(appCapsReadOnly(caps), true);
  assert.equal(appCapsReadOnly(undefined), false);
  assert.equal(appCapsReadOnly('not json'), false);
  assert.equal(appCapsReadOnly(JSON.stringify({ 'laneboard.dev/cap': [{ role: 'control' }] })), false);
  const cfg = makeCfg();
  const h = { 'tailscale-user-login': 'alice@example.invalid', 'tailscale-app-capabilities': caps, origin: ORIGIN, 'x-laneboard': '1', 'content-type': 'application/json' };
  const r = req({ method: 'POST', url: '/api/v1/actions', headers: h });
  expectAuth(() => guardRequest(r, '/api/v1/actions', cfg, ctx()), 403, 'read-only');
  const g = req({ url: '/api/v1/snapshot', headers: h });
  assert.equal(guardRequest(g, '/api/v1/snapshot', cfg, ctx()).readOnly, true);
  const up = req({ url: '/ws/term/web', headers: h });
  expectAuth(() => guardUpgrade(up, '/ws/term/web', cfg, ctx()), 403, 'read-only');
  const noCaps = { ...h, 'tailscale-app-capabilities': undefined };
  assert.equal(guardRequest(req({ method: 'POST', url: '/api/v1/actions', headers: noCaps }), '/api/v1/actions', cfg, ctx()).readOnly, false);
});

test('decodeDisplayName: base64 words, controls stripped, capped', () => {
  assert.equal(decodeDisplayName(`=?UTF-8?B?${Buffer.from('Bob Ö').toString('base64')}?=`), 'Bob Ö');
  assert.equal(decodeDisplayName('Plain\x1b[31m'), 'Plain[31m');
  assert.equal(decodeDisplayName('x'.repeat(300)).length, 128);
  assert.equal(decodeDisplayName(undefined), null);
});

// --- signed reads ----------------------------------------------------------------------------------------

test('valid signed read → hub with the pinned scopes; bare-string key gets {read}', () => {
  const a = classify(req({ headers: readHeaders('GET', '/api/v1/hello') }), makeCfg(), ctx());
  assert.equal(a.kind, 'hub');
  assert.equal(a.signature, 'read');
  assert.equal(a.verified, true);
  assert.equal(a.keyId, HUB_KID);
  assert.equal(a.keyLabel, 'hub-full');
  assert.deepEqual([...a.scopes], ['read', 'control', 'term']);
  const b = classify(req({ headers: readHeaders('GET', '/api/v1/hello', { key: readKey }) }), makeCfg(), ctx());
  assert.equal(b.keyId, READ_KID);
  assert.equal(b.scopes.has('read'), true);
  assert.equal(b.scopes.has('control'), false);
  assert.equal(b.scopes.size, 1);
});

test('expired and future timestamps (±61 s) → 401 stale; ±59 s ok; clockSkewMs honoured', () => {
  for (const d of [-61000, 61000]) {
    expectAuth(() => classify(req({ headers: readHeaders('GET', '/api/v1/hello', { ts: T0 + d }) }), makeCfg(), ctx()), 401, 'stale');
  }
  for (const d of [-59000, 59000]) {
    assert.equal(classify(req({ headers: readHeaders('GET', '/api/v1/hello', { ts: T0 + d }) }), makeCfg(), ctx()).kind, 'hub');
  }
  expectAuth(() => classify(req({ headers: readHeaders('GET', '/api/v1/hello', { ts: T0 - 20000 }) }), makeCfg({ clockSkewMs: 10000 }), ctx()), 401, 'stale');
});

test('replayed signed read (same nonce twice) → 401 replay', () => {
  const c = ctx();
  const h = readHeaders('GET', '/api/v1/hello');
  classify(req({ headers: { ...h } }), makeCfg(), c);
  expectAuth(() => classify(req({ headers: { ...h } }), makeCfg(), c), 401, 'replay');
});

test('forged reads → 401 and never enter the nonce cache', () => {
  const c = ctx();
  const h = readHeaders('GET', '/api/v1/hello');
  const flipped = Buffer.from(h['x-laneboard-sig'].slice(8), 'base64');
  flipped[5] ^= 1;
  const cases = [
    { ...h, 'x-laneboard-sig': `ed25519 ${flipped.toString('base64')}` },
    { ...h, 'x-laneboard-ts': String(T0 + 1) },
    { ...readHeaders('GET', '/api/v1/hello', { key: otherKey }), 'x-laneboard-key': HUB_KID },
    { ...h, 'x-laneboard-sig': 'ed25519 !!!' },
    { ...h, 'x-laneboard-sig': 'rsa abc' },
  ];
  for (const hh of cases) expectAuth(() => classify(req({ headers: hh }), makeCfg(), c), 401);
  assert.equal(c.nonces.size(), 0, 'garbage never enters the nonce cache');
  // the genuine one still works afterwards (its nonce was not burnt)
  assert.equal(classify(req({ headers: h }), makeCfg(), c).kind, 'hub');
});

test('signed read path or query changed → 401; method changed → 401', () => {
  const h = readHeaders('GET', '/api/v1/audit?since=1');
  expectAuth(() => classify(req({ url: '/api/v1/audit?since=0', headers: h }), makeCfg(), ctx()), 401, 'bad-signature');
  expectAuth(() => classify(req({ url: '/api/v1/snapshot', headers: h }), makeCfg(), ctx()), 401, 'bad-signature');
  expectAuth(() => classify(req({ method: 'HEAD', url: '/api/v1/audit?since=1', headers: h }), makeCfg(), ctx()), 401, 'bad-signature');
});

test('wrong builder id in the signed read string → 401', () => {
  const h = readHeaders('GET', '/api/v1/hello', { builderId: 'builder-b' });
  expectAuth(() => classify(req({ headers: h }), makeCfg(), ctx()), 401, 'bad-signature');
});

test('signature covers the raw req.url: percent-encoded path verifies, decoded spelling does not', () => {
  const raw = '/api/v1/sessions/a%20b/preview';
  const h = readHeaders('GET', raw);
  assert.equal(classify(req({ url: raw, headers: { ...h } }), makeCfg(), ctx()).kind, 'hub');
  const h2 = readHeaders('GET', raw);
  expectAuth(() => classify(req({ url: '/api/v1/sessions/a b/preview', headers: h2 }), makeCfg(), ctx()), 401, 'bad-signature');
});

test('unknown X-Laneboard-Key → 403; missing/malformed key or headers → 401', () => {
  const h = readHeaders('GET', '/api/v1/hello', { key: otherKey });
  expectAuth(() => classify(req({ headers: h }), makeCfg(), ctx()), 403, 'unknown-key');
  const g = readHeaders('GET', '/api/v1/hello');
  expectAuth(() => classify(req({ headers: { ...g, 'x-laneboard-key': undefined } }), makeCfg(), ctx()), 401, 'missing-signature');
  expectAuth(() => classify(req({ headers: { ...g, 'x-laneboard-key': 'XYZ' } }), makeCfg(), ctx()), 401, 'malformed-signature');
  expectAuth(() => classify(req({ headers: { ...g, 'x-laneboard-nonce': 'nope' } }), makeCfg(), ctx()), 401, 'malformed-signature');
  expectAuth(() => classify(req({ headers: { ...g, 'x-laneboard-ts': '12.5' } }), makeCfg(), ctx()), 401, 'malformed-signature');
  expectAuth(() => classify(req({ headers: { ...g, 'x-laneboard-sig': undefined, 'x-laneboard-envelope': undefined } }), makeCfg(), ctx()), 403, 'unidentified');
});

test('query-param signatures (lb_ts/lb_nonce/lb_key/lb_sig) → 401 on ingress', () => {
  for (const p of ['lb_ts=1', 'lb_nonce=x', 'lb_key=k', 'lb_sig=s', 'LB_SIG=s']) {
    expectAuth(() => classify(req({ url: `/api/v1/stream?${p}` }), makeCfg(), ctx()), 401, 'query-signature-not-allowed');
  }
});

test('nonce cache full → 503 nonce-cache-full and live nonces are not evicted', () => {
  const nonces = createNonceCache({ max: 2, now: () => T0 });
  const c = ctx({ nonces });
  const first = readHeaders('GET', '/api/v1/hello');
  classify(req({ headers: { ...first } }), makeCfg(), c);
  classify(req({ headers: readHeaders('GET', '/api/v1/hello') }), makeCfg(), c);
  expectAuth(() => classify(req({ headers: readHeaders('GET', '/api/v1/hello') }), makeCfg(), c), 503, 'nonce-cache-full');
  expectAuth(() => classify(req({ headers: { ...first } }), makeCfg(), c), 401, 'replay');
});

test('hubAddrs: signed request from an unlisted X-Forwarded-For → 403 hub-addr; listed (also v4-mapped) ok', () => {
  const cfg = makeCfg({ hubAddrs: ['100.64.0.10'] });
  assert.equal(classify(req({ headers: readHeaders('GET', '/api/v1/hello') }), cfg, ctx()).kind, 'hub');
  assert.equal(classify(req({ headers: { ...readHeaders('GET', '/api/v1/hello'), 'x-forwarded-for': '::ffff:100.64.0.10' } }), cfg, ctx()).kind, 'hub');
  expectAuth(() => classify(req({ headers: { ...readHeaders('GET', '/api/v1/hello'), 'x-forwarded-for': '100.64.0.11' } }), cfg, ctx()), 403, 'hub-addr');
  expectAuth(() => classify(req({ headers: { ...readHeaders('GET', '/api/v1/hello'), 'x-forwarded-for': '100.64.0.10, 100.64.0.11' } }), cfg, ctx()), 403, 'hub-addr');
  // direct users are not subject to hubAddrs
  assert.equal(classify(req({ headers: { 'tailscale-user-login': 'alice@example.invalid', 'x-forwarded-for': '100.64.0.99' } }), cfg, ctx()).kind, 'direct');
});

test('hub mode: a signed request is refused 403 (a hub never takes signed requests)', () => {
  const cfg = makeCfg({}, { mode: 'hub' });
  expectAuth(() => classify(req({ headers: readHeaders('GET', '/api/v1/hello') }), cfg, ctx()), 403, 'hub-kind-refused');
  expectAuth(() => verifyEnvelope(envelope(), lower(actionHeaders(envelope(), hubKey)), cfg, ctx()), 403, 'hub-kind-refused');
});

// --- action envelopes ------------------------------------------------------------------------------------

function envHeaders(env, key = hubKey) {
  return lower(actionHeaders(env, key));
}

test('actions: classify only looks up the key; verifyEnvelope verifies the parsed body', () => {
  const env = envelope();
  const h = envHeaders(env);
  const r = req({ method: 'POST', url: '/api/v1/actions', headers: { ...h, 'x-laneboard': '1' } });
  const pre = classify(r, makeCfg(), ctx());
  assert.deepEqual({ kind: pre.kind, signature: pre.signature, verified: pre.verified, keyId: pre.keyId }, { kind: 'hub', signature: 'envelope', verified: false, keyId: HUB_KID });
  // the body arrives with other key order and whitespace: the parsed value is what is verified
  const body = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(env).reverse()), null, 2));
  const a = verifyEnvelope(body, r.headers, makeCfg(), ctx());
  assert.equal(a.kind, 'hub');
  assert.equal(a.verified, true);
  assert.equal(a.signature, 'envelope');
  assert.equal(a.user, 'alice@example.invalid');
  assert.deepEqual(a.envelope, env);
  assert.ok(Object.isFrozen(a.envelope) && Object.isFrozen(a.envelope.args), 'verified envelope is frozen');
  assert.notEqual(a.envelope, body, 'a fresh copy of exactly what was signed');
});

test('envelope expired (±61 s) → 401 stale; replayed → 401 replay', () => {
  for (const d of [-61000, 61000]) {
    const env = envelope({ ts: T0 + d });
    expectAuth(() => verifyEnvelope(env, envHeaders(env), makeCfg(), ctx()), 401, 'stale');
  }
  const c = ctx();
  const env = envelope();
  verifyEnvelope(env, envHeaders(env), makeCfg(), c);
  expectAuth(() => verifyEnvelope(env, envHeaders(env), makeCfg(), c), 401, 'replay');
});

test('forged envelopes → 401 (flipped byte, field changed after signing, other key) and burn no nonce', () => {
  const c = ctx();
  const env = envelope();
  const h = envHeaders(env);
  const sig = Buffer.from(h['x-laneboard-sig'].slice(8), 'base64');
  sig[0] ^= 0x80;
  expectAuth(() => verifyEnvelope(env, { ...h, 'x-laneboard-sig': `ed25519 ${sig.toString('base64')}` }, makeCfg(), c), 401, 'bad-signature');
  expectAuth(() => verifyEnvelope({ ...env, target: 'other' }, h, makeCfg(), c), 401, 'bad-signature');
  expectAuth(() => verifyEnvelope({ ...env, args: { ...env.args, text: 'rm -rf' } }, h, makeCfg(), c), 401, 'bad-signature');
  expectAuth(() => verifyEnvelope(env, { ...envHeaders(env, otherKey), 'x-laneboard-key': HUB_KID }, makeCfg(), c), 401, 'bad-signature');
  assert.equal(c.nonces.size(), 0);
  assert.equal(verifyEnvelope(env, h, makeCfg(), c).verified, true, 'genuine envelope still accepted');
});

test('envelope for another builder → 401 wrong-builder', () => {
  const env = envelope({ builder: 'builder-b' });
  expectAuth(() => verifyEnvelope(env, envHeaders(env), makeCfg(), ctx()), 401, 'wrong-builder');
});

test('envelope shape: v, id, via, user, unknown fields, non-canonical values → 400', () => {
  const bad = [
    { v: 2 }, { id: 'not-a-uuid' }, { via: 'direct' }, { user: 'two words' }, { user: '' }, { action: 'Bad Action' },
    { args: [] }, { ts: 1.5 }, { extra: 1 },
  ];
  for (const b of bad) {
    const env = envelope(b);
    expectAuth(() => verifyEnvelope(env, envHeaders(env), makeCfg(), ctx()), 400, 'bad-envelope');
  }
  const missing = envelope();
  delete missing.target;
  expectAuth(() => verifyEnvelope(missing, envHeaders(missing), makeCfg(), ctx()), 400, 'bad-envelope');
  expectAuth(() => verifyEnvelope(JSON.parse('{"__proto__":{"x":1},"v":1}'), envHeaders(envelope()), makeCfg(), ctx()), 400, 'bad-envelope');
  expectAuth(() => verifyEnvelope(null, envHeaders(envelope()), makeCfg(), ctx()), 400, 'bad-envelope');
});

test('envelope with unknown key → 403; missing signature headers → 401', () => {
  const env = envelope();
  expectAuth(() => verifyEnvelope(env, envHeaders(env, otherKey), makeCfg(), ctx()), 403, 'unknown-key');
  expectAuth(() => verifyEnvelope(env, { 'x-laneboard-key': HUB_KID }, makeCfg(), ctx()), 401, 'missing-signature');
  expectAuth(() => verifyEnvelope(env, { 'x-laneboard-sig': envHeaders(env)['x-laneboard-sig'] }, makeCfg(), ctx()), 401, 'missing-signature');
});

test('envelope scopes are reported for dispatch: bare-string key → {read}; control key → {read, control}', () => {
  const env = envelope();
  const a = verifyEnvelope(env, envHeaders(env, readKey), makeCfg(), ctx());
  assert.deepEqual([...a.scopes], ['read']);
  const env2 = envelope();
  const b = verifyEnvelope(env2, envHeaders(env2, ctlKey), makeCfg(), ctx());
  assert.equal(b.keyLabel, 'hub-ctl');
  assert.equal(b.scopes.has('control'), true);
  assert.equal(b.scopes.has('term'), false);
});

// --- guardRequest ----------------------------------------------------------------------------------------

test('guardRequest: hub GET with a verified read; POST /api/v1/actions with an envelope signature', () => {
  const cfg = makeCfg();
  const g = req({ url: '/api/v1/snapshot', headers: readHeaders('GET', '/api/v1/snapshot') });
  assert.equal(guardRequest(g, '/api/v1/snapshot', cfg, ctx()).kind, 'hub');
  assert.equal(g.auth.kind, 'hub', 'sets req.auth');
  const env = envelope();
  const p = req({ method: 'POST', url: '/api/v1/actions', headers: envHeaders(env) });
  const a = guardRequest(p, '/api/v1/actions', cfg, ctx());
  assert.equal(a.signature, 'envelope');
  assert.equal(a.verified, false);
});

test('guardRequest: a read signature never authorizes a POST; hub off /api/v1 or with odd paths → 403', () => {
  const cfg = makeCfg();
  const p = req({ method: 'POST', url: '/api/v1/actions', headers: { ...readHeaders('POST', '/api/v1/actions'), 'x-laneboard': '1', 'content-type': 'application/json' } });
  expectAuth(() => guardRequest(p, '/api/v1/actions', cfg, ctx()), 403, 'read-signature-not-allowed');
  for (const path of ['/api/sessions', '/api/v1/../api/sessions', '/api/v1/sessions%2F..%2Fx/preview', '/api/v1/%2e%2e/x']) {
    const r = req({ url: path, headers: readHeaders('GET', path) });
    expectAuth(() => guardRequest(r, undefined, cfg, ctx()), 403, 'hub-not-allowed');
  }
  const del = req({ method: 'DELETE', url: '/api/v1/sessions/x', headers: { ...envHeaders(envelope()), 'x-laneboard': '1' } });
  expectAuth(() => guardRequest(del, undefined, cfg, ctx()), 403, 'hub-not-allowed');
  const getEnv = req({ url: '/api/v1/hello', headers: envHeaders(envelope()) });
  expectAuth(() => guardRequest(getEnv, undefined, cfg, ctx()), 403, 'read-signature-required');
});

test('guardRequest: Origin on a hub request → 403; hub request needs X-Laneboard and JSON', () => {
  const cfg = makeCfg();
  const env = envelope();
  const g = req({ url: '/api/v1/hello', headers: { ...readHeaders('GET', '/api/v1/hello'), origin: ORIGIN } });
  // a GET is not mutating: Origin is checked for mutating requests and every upgrade
  assert.equal(guardRequest(g, undefined, cfg, ctx()).kind, 'hub');
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/v1/actions', headers: { ...envHeaders(env), origin: ORIGIN } }), undefined, cfg, ctx()), 403, 'origin-on-hub');
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/v1/actions', headers: { ...envHeaders(env), 'x-laneboard': undefined } }), undefined, cfg, ctx()), 403, 'no-csrf-header');
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/v1/actions', headers: { ...envHeaders(env), 'content-type': 'text/plain' } }), undefined, cfg, ctx()), 415, 'json-required');
});

test('guardRequest: direct mutating needs exact Origin (or none), Sec-Fetch-Site, X-Laneboard, JSON on v1 actions', () => {
  const cfg = makeCfg({ allowedOrigins: ['https://hub.example.invalid'] });
  const base = { 'tailscale-user-login': 'alice@example.invalid', 'x-laneboard': '1', 'content-type': 'application/json' };
  const post = (h) => req({ method: 'POST', url: '/api/v1/actions', headers: { ...base, ...h } });
  assert.equal(guardRequest(post({ origin: ORIGIN }), undefined, cfg, ctx()).kind, 'direct');
  assert.equal(guardRequest(post({ origin: 'https://hub.example.invalid' }), undefined, cfg, ctx()).kind, 'direct', 'allowedOrigins honoured');
  assert.equal(guardRequest(post({}), undefined, cfg, ctx()).kind, 'direct', 'no Origin (non-browser) is fine for requests');
  expectAuth(() => guardRequest(post({ origin: 'https://evil.example.invalid' }), undefined, cfg, ctx()), 403, 'bad-origin');
  expectAuth(() => guardRequest(post({ origin: 'https://other.example.invalid:8443' }), undefined, cfg, ctx()), 403, 'bad-origin');
  expectAuth(() => guardRequest(post({ origin: ORIGIN, 'sec-fetch-site': 'cross-site' }), undefined, cfg, ctx()), 403, 'sec-fetch-site');
  expectAuth(() => guardRequest(post({ origin: ORIGIN, 'sec-fetch-site': 'same-site' }), undefined, cfg, ctx()), 403, 'sec-fetch-site');
  assert.equal(guardRequest(post({ origin: ORIGIN, 'sec-fetch-site': 'same-origin' }), undefined, cfg, ctx()).kind, 'direct');
  expectAuth(() => guardRequest(post({ origin: ORIGIN, 'x-laneboard': undefined }), undefined, cfg, ctx()), 403, 'no-csrf-header');
  expectAuth(() => guardRequest(post({ origin: ORIGIN, 'content-type': 'text/plain;charset=utf-8' }), undefined, cfg, ctx()), 415, 'json-required');
  assert.equal(guardRequest(post({ origin: ORIGIN, 'content-type': 'application/json; charset=utf-8' }), undefined, cfg, ctx()).kind, 'direct');
});

test('guardRequest: Host must be a publicHost on ingress and loopback on the local listener', () => {
  const cfg = makeCfg();
  const login = { 'tailscale-user-login': 'alice@example.invalid' };
  expectAuth(() => guardRequest(req({ headers: { ...login, host: 'evil.example.invalid:8443' } }), undefined, cfg, ctx()), 403, 'bad-host');
  expectAuth(() => guardRequest(req({ headers: { ...login, host: 'builder-a.example.invalid' } }), undefined, cfg, ctx()), 403, 'bad-host');
  expectAuth(() => guardRequest(req({ headers: { ...login, host: `127.0.0.1:${PORT}` } }), undefined, cfg, ctx()), 403, 'bad-host');
  expectAuth(() => guardRequest(req({ headers: { ...login, host: undefined } }), undefined, cfg, ctx()), 403, 'bad-host');
  assert.equal(guardRequest(req({ port: PORT }), undefined, cfg, ctx()).kind, 'local');
  expectAuth(() => guardRequest(req({ port: PORT, headers: { host: PUBLIC_HOST } }), undefined, cfg, ctx()), 403, 'bad-host');
  expectAuth(() => guardRequest(req({ port: PORT, headers: { host: 'evil.example.invalid' } }), undefined, cfg, ctx()), 403, 'bad-host');
  // a non-mutating request without Host is tolerated off ingress only; mutating never
  assert.equal(guardRequest(req({ port: PORT, headers: { host: undefined } }), undefined, cfg, ctx()).kind, 'local');
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/sessions', port: PORT, headers: { host: undefined, 'x-laneboard': '1' } }), undefined, cfg, ctx()), 403, 'bad-host');
  // a bad Host is refused before any signature work
  const c = ctx();
  expectAuth(() => guardRequest(req({ headers: { ...readHeaders('GET', '/api/v1/hello'), host: 'evil.example.invalid' } }), undefined, cfg, c), 403, 'bad-host');
  assert.equal(c.nonces.size(), 0);
});

test('guardRequest: empty publicHosts on ingress is allowed with one warning', () => {
  const warns = [];
  auth._resetForTests();
  const cfg = makeCfg({ publicHosts: [] });
  const login = { 'tailscale-user-login': 'alice@example.invalid' };
  guardRequest(req({ headers: login }), undefined, cfg, ctx({ warn: (m) => warns.push(m) }));
  guardRequest(req({ headers: login }), undefined, cfg, ctx({ warn: (m) => warns.push(m) }));
  assert.equal(warns.length, 1);
});

test('guardRequest: hook intake is local-only when enforcing; local CLI keeps working', () => {
  const cfg = makeCfg();
  const hook = { 'tailscale-user-login': 'alice@example.invalid', 'content-type': 'application/json' };
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/hook', headers: hook }), undefined, cfg, ctx()), 403, 'local-only');
  assert.equal(guardRequest(req({ method: 'POST', url: '/api/hook', port: PORT }), undefined, cfg, ctx()).kind, 'local');
  assert.equal(guardRequest(req({ method: 'POST', url: '/api/sessions', port: PORT, headers: { 'x-laneboard': '1' } }), undefined, cfg, ctx()).kind, 'local');
  expectAuth(() => guardRequest(req({ method: 'POST', url: '/api/sessions', port: PORT }), undefined, cfg, ctx()), 403, 'no-csrf-header');
});

test('guardRequest uses an existing req.auth and does not classify twice', () => {
  const c = ctx();
  const r = req({ url: '/api/v1/hello', headers: readHeaders('GET', '/api/v1/hello') });
  r.auth = classify(r, makeCfg(), c);
  assert.equal(guardRequest(r, undefined, makeCfg(), c).kind, 'hub', 'a second classify would be a replay');
});

// --- guardUpgrade ----------------------------------------------------------------------------------------

function termEnv(name = 'web', args = { cols: 120, rows: 40 }, fields = {}) {
  return envelope({ action: 'term', target: name, args, ...fields });
}

function termReq(url, env, key = hubKey, extra = {}) {
  return req({ url, headers: { ...lower(termHeaders(env, key)), ...extra } });
}

test('guardUpgrade: signed stream upgrade (headers) → hub; unsigned ingress upgrade → 403', () => {
  const cfg = makeCfg();
  const a = guardUpgrade(req({ url: '/api/v1/stream', headers: readHeaders('GET', '/api/v1/stream') }), undefined, cfg, ctx());
  assert.equal(a.kind, 'hub');
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/stream' }), undefined, cfg, ctx()), 403, 'unidentified');
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/stream?lb_ts=1&lb_nonce=x&lb_key=k&lb_sig=s' }), undefined, cfg, ctx()), 401, 'query-signature-not-allowed');
});

test('guardUpgrade: hub on legacy /ws or /ws/term → 403; a read signature on a terminal → 403', () => {
  const cfg = makeCfg();
  expectAuth(() => guardUpgrade(req({ url: '/ws', headers: readHeaders('GET', '/ws') }), undefined, cfg, ctx()), 403, 'read-signature-not-allowed');
  expectAuth(() => guardUpgrade(req({ url: '/ws/term/web', headers: readHeaders('GET', '/ws/term/web') }), undefined, cfg, ctx()), 403, 'read-signature-not-allowed');
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/term/web', headers: readHeaders('GET', '/api/v1/term/web') }), undefined, cfg, ctx()), 403, 'read-signature-not-allowed');
  const env = termEnv();
  expectAuth(() => guardUpgrade(termReq('/api/v1/stream?cols=120&rows=40', env), undefined, cfg, ctx()), 403, 'read-signature-required');
});

test('guardUpgrade: term envelope with hubControl:true and the term scope → ok', () => {
  const env = termEnv();
  const a = guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40', env), undefined, makeCfg(), ctx());
  assert.equal(a.kind, 'hub');
  assert.equal(a.signature, 'term');
  assert.deepEqual(a.envelope, env);
  const w = termEnv('web', { window: 'run-tests' });
  assert.equal(guardUpgrade(termReq('/api/v1/term/web?window=run-tests', w), undefined, makeCfg(), ctx()).kind, 'hub');
  const clamp = termEnv('web', { cols: 500, rows: 5 });
  assert.equal(guardUpgrade(termReq('/api/v1/term/web?cols=9999&rows=1', clamp), undefined, makeCfg(), ctx()).kind, 'hub', 'args equal the clamped query');
});

test('guardUpgrade: term from a key without term → 403 scope-missing; hubControl:false → 403 control-disabled', () => {
  const env = termEnv();
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40', env, ctlKey), undefined, makeCfg(), ctx()), 403, 'scope-missing');
  const env2 = termEnv();
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40', env2, readKey), undefined, makeCfg(), ctx()), 403, 'scope-missing');
  const env3 = termEnv();
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40', env3), undefined, makeCfg({ hubControl: false }), ctx()), 403, 'control-disabled');
});

test('guardUpgrade: term envelope bound to path and query (target, args mismatch → 403)', () => {
  const cfg = makeCfg();
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/other?cols=120&rows=40', termEnv()), undefined, cfg, ctx()), 403, 'envelope-mismatch');
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=121&rows=40', termEnv()), undefined, cfg, ctx()), 403, 'envelope-mismatch');
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120', termEnv()), undefined, cfg, ctx()), 403, 'envelope-mismatch');
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40&window=run-x', termEnv()), undefined, cfg, ctx()), 403, 'envelope-mismatch');
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=abc&rows=40', termEnv()), undefined, cfg, ctx()), 403, 'envelope-mismatch');
  const extra = termEnv('web', { cols: 120, rows: 40, evil: 1 });
  expectAuth(() => guardUpgrade(termReq('/api/v1/term/web?cols=120&rows=40', extra), undefined, cfg, ctx()), 403, 'envelope-mismatch');
});

test('guardUpgrade: term envelope must be a term action, canonical, signed, fresh, unreplayed, for this builder', () => {
  const cfg = makeCfg();
  const url = '/api/v1/term/web?cols=120&rows=40';
  expectAuth(() => guardUpgrade(termReq(url, termEnv('web', { cols: 120, rows: 40 }, { action: 'kill' })), undefined, cfg, ctx()), 403, 'wrong-action');
  expectAuth(() => guardUpgrade(termReq(url, termEnv('web', { cols: 120, rows: 40 }, { builder: 'builder-b' })), undefined, cfg, ctx()), 401, 'wrong-builder');
  expectAuth(() => guardUpgrade(termReq(url, termEnv('web', { cols: 120, rows: 40 }, { ts: T0 - 61000 })), undefined, cfg, ctx()), 401, 'stale');
  const c = ctx();
  const env = termEnv();
  guardUpgrade(termReq(url, env), undefined, cfg, c);
  expectAuth(() => guardUpgrade(termReq(url, env), undefined, cfg, c), 401, 'replay');
  // non-canonical text in the header (whitespace) → 400
  const env2 = termEnv();
  const text = JSON.stringify(env2, null, 1);
  const h = { 'x-laneboard-envelope': Buffer.from(text).toString('base64url'), 'x-laneboard-key': HUB_KID, 'x-laneboard-sig': `ed25519 ${sign(text, hubKey)}` };
  expectAuth(() => guardUpgrade(req({ url, headers: h }), undefined, cfg, ctx()), 400, 'bad-envelope');
  // forged: a signature over another envelope
  const env3 = termEnv();
  const forged = { ...lower(termHeaders(env3, hubKey)), 'x-laneboard-sig': lower(termHeaders(termEnv(), hubKey))['x-laneboard-sig'] };
  expectAuth(() => guardUpgrade(req({ url, headers: forged }), undefined, cfg, ctx()), 401, 'bad-signature');
  expectAuth(() => guardUpgrade(req({ url, headers: { ...forged, 'x-laneboard-envelope': '!!' } }), undefined, cfg, ctx()), 400, 'bad-envelope');
});

test('guardUpgrade: a hub sig without ts/nonce/envelope cannot upgrade', () => {
  const h = envHeaders(envelope());
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/term/web', headers: h }), undefined, makeCfg(), ctx()), 401, 'missing-signature');
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/stream', headers: h }), undefined, makeCfg(), ctx()), 403, 'read-signature-required');
});

test('guardUpgrade: origin rules: cross-origin 403, missing Origin on direct 403, allowedOrigins, Sec-Fetch-Site, hub Origin 403', () => {
  const cfg = makeCfg({ allowedOrigins: ['https://hub.example.invalid'] });
  const login = { 'tailscale-user-login': 'alice@example.invalid' };
  assert.equal(guardUpgrade(req({ url: '/ws', headers: { ...login, origin: ORIGIN } }), undefined, cfg, ctx()).kind, 'direct');
  assert.equal(guardUpgrade(req({ url: '/ws', headers: { ...login, origin: 'https://hub.example.invalid' } }), undefined, cfg, ctx()).kind, 'direct');
  expectAuth(() => guardUpgrade(req({ url: '/ws', headers: { ...login, origin: 'https://evil.example.invalid' } }), undefined, cfg, ctx()), 403, 'bad-origin');
  expectAuth(() => guardUpgrade(req({ url: '/ws/term/web', headers: login }), undefined, cfg, ctx()), 403, 'no-origin');
  expectAuth(() => guardUpgrade(req({ url: '/ws', headers: { ...login, origin: ORIGIN, 'sec-fetch-site': 'cross-site' } }), undefined, cfg, ctx()), 403, 'sec-fetch-site');
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/stream', headers: { ...readHeaders('GET', '/api/v1/stream'), origin: ORIGIN } }), undefined, cfg, ctx()), 403, 'origin-on-hub');
  // local: Origin optional, but a present one must match
  assert.equal(guardUpgrade(req({ url: '/ws', port: PORT }), undefined, cfg, ctx()).kind, 'local');
  assert.equal(guardUpgrade(req({ url: '/ws', port: PORT, headers: { origin: `http://127.0.0.1:${PORT}` } }), undefined, cfg, ctx()).kind, 'local');
  expectAuth(() => guardUpgrade(req({ url: '/ws', port: PORT, headers: { origin: 'https://evil.example.invalid' } }), undefined, cfg, ctx()), 403, 'bad-origin');
  // Host is required on upgrades even off ingress
  expectAuth(() => guardUpgrade(req({ url: '/ws', port: PORT, headers: { host: undefined } }), undefined, cfg, ctx()), 403, 'bad-host');
});

test('guardUpgrade: header spoofing on each listener', () => {
  const cfg = makeCfg();
  // local listener: a forged login is stripped, the request stays local (attribution 'local')
  const r = req({ url: '/ws', port: PORT, headers: { 'tailscale-user-login': 'alice@example.invalid' } });
  assert.deepEqual(guardUpgrade(r, undefined, cfg, ctx()), { kind: 'local', user: 'local' });
  // ingress: a forged login without serve's X-Forwarded-* is refused
  expectAuth(() => guardUpgrade(req({ url: '/ws', headers: { 'tailscale-user-login': 'alice@example.invalid', origin: ORIGIN, 'x-forwarded-for': undefined } }), undefined, cfg, ctx()), 403, 'not-from-serve');
});

test('guardUpgrade on a hub process: hub kind refused; direct/local fine', () => {
  const cfg = makeCfg({}, { mode: 'hub' });
  expectAuth(() => guardUpgrade(req({ url: '/api/v1/stream', headers: readHeaders('GET', '/api/v1/stream') }), undefined, cfg, ctx()), 403, 'hub-kind-refused');
  assert.equal(guardUpgrade(req({ url: '/ws', headers: { 'tailscale-user-login': 'alice@example.invalid', origin: ORIGIN } }), undefined, cfg, ctx()).kind, 'direct');
});

test('writeUpgradeRefusal writes a bare status line and nothing secret', () => {
  let written = '';
  const sock = { once() {}, destroy() {}, end(s) { written = s; } };
  writeUpgradeRefusal(sock, new AuthError(401, 'bad-signature'));
  assert.equal(written, 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  writeUpgradeRefusal(sock, new Error('x'));
  assert.match(written, /^HTTP\/1\.1 403 Forbidden/);
});

test('AuthError carries status/code and a body without secrets', () => {
  const e = new AuthError(401, 'replay');
  assert.deepEqual(e.body, { error: 'replay' });
  assert.equal(e.message, 'replay');
});

test('the shared nonce cache is used when none is injected', () => {
  auth._resetForTests();
  const now = Date.now();
  const h = readHeaders('GET', '/api/v1/hello', { ts: now });
  classify(req({ headers: { ...h } }), makeCfg());
  expectAuth(() => classify(req({ headers: { ...h } }), makeCfg()), 401, 'replay');
  assert.equal(auth.nonceCache().size(), 1);
  auth._resetForTests();
});
