// server/config/fleet-auth.mjs: hubKeys (scopes), ingressPort, hubControl and
// the other fleet auth keys (fleet plan §2 2.2, SECURITY-FIXES S5/S6).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as auth from '../server/config/fleet-auth.mjs';
import { keyId, publicKeyString, publicKeyPem } from '../server/fleet/keys-ed25519.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-fleet-auth-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const cfg = (env = {}, file = MISSING) => build({ env, file });
const withFleet = (fleet, top = {}) => cfg({}, write({ ...top, fleet: { id: 'builder-a', ...fleet } }));
const fails = (fn, rx) => assert.throws(fn, (err) => {
  assert.ok(err instanceof ConfigError, `ConfigError, got ${err}`);
  assert.match(err.message, rx);
  return true;
});

const pair = () => crypto.generateKeyPairSync('ed25519');
const K1 = pair().publicKey;
const K2 = pair().publicKey;
const K3 = pair().publicKey;
const S1 = publicKeyString(K1);
const P1 = publicKeyPem(K1);
const S2 = publicKeyString(K2);
const S3 = publicKeyString(K3);

test('the fragment is loaded from server/config/', () => {
  assert.ok(FRAGMENTS.some((f) => f.defaults === auth.defaults), 'fleet-auth.mjs is among FRAGMENTS');
});

test('no fleet block: today\'s behaviour (no ingress, no enforce, read-only defaults)', () => {
  const c = cfg();
  const f = c.fleet;
  assert.deepEqual(f.hubKeys, []);
  assert.equal(f.ingressPort, null);
  assert.equal(f.enforce, false);
  assert.equal(f.hubControl, false);
  assert.deepEqual(f.hubAddrs, []);
  assert.equal(f.ingressPeerUid, null);
  assert.deepEqual(f.allowedUsers, []);
  assert.deepEqual(f.publicHosts, [], 'default publicUrl is loopback');
  assert.equal(f.clockSkewMs, 60000);
  assert.deepEqual(f.allowedPermissionModes, ['default', 'acceptEdits', 'plan', 'auto']);
  assert.ok(!f.allowedPermissionModes.includes('bypassPermissions'));
  assert.deepEqual(f.rateLimits, {});
  assert.equal(f.audit.maxBytes, 10485760);
  assert.equal(f.legacyBrowserRoutes, true);
  assert.deepEqual(auth.hubKeyring(f), []);
});

test('a fleet block turns on ingressPort 7778 and enforce', () => {
  const c = withFleet({});
  assert.equal(c.fleet.ingressPort, 7778);
  assert.equal(c.fleet.enforce, true);
  assert.equal(c.fleet.hubControl, false);
  // an empty block counts too
  assert.equal(cfg({}, write({ fleet: {} })).fleet.ingressPort, 7778);
});

test('ingressPort: explicit value, env, and the explicit-null refusal', () => {
  assert.equal(withFleet({ ingressPort: 7790 }).fleet.ingressPort, 7790);
  fails(() => withFleet({ ingressPort: null }), /fleet\.ingressPort is mandatory when the config has a fleet block/);
  fails(() => withFleet({ ingressPort: 7777 }), /fleet\.ingressPort must differ from port/);
  fails(() => withFleet({ ingressPort: 7790 }, { port: 7790 }), /must differ from port/);
  for (const p of [0, 70000, 1.5, '7778', true]) fails(() => withFleet({ ingressPort: p }), /fleet\.ingressPort must be a port number/);
  assert.equal(cfg({ LANEBOARD_INGRESS_PORT: '7791' }).fleet.ingressPort, 7791);
  assert.equal(cfg({ LANEBOARD_INGRESS_PORT: '7791' }, write({ fleet: { ingressPort: 7790 } })).fleet.ingressPort, 7791, 'env wins');
  fails(() => cfg({ LANEBOARD_INGRESS_PORT: 'abc' }), /fleet\.ingressPort must be a port number, got "abc"/);
  assert.deepEqual(auth.fromEnv({ LANEBOARD_INGRESS_PORT: '' }), {});
  assert.deepEqual(auth.fromEnv({}), {});
});

test('hub mode: ingressPort has no default, must be set and cannot be null', () => {
  // Validate the fragment alone: a hub config also needs H1's keys.
  const bad = (m) => { throw new ConfigError(m); };
  for (const layers of [{ file: {}, env: {} }, { file: { fleet: {} }, env: {} }, { file: {}, env: { fleet: { ingressPort: null } } }]) {
    const c = { mode: 'hub', port: 7777, fleet: auth.defaults().fleet };
    auth.finalize(c, layers);
    assert.equal(c.fleet.ingressPort, null);
    fails(() => auth.validate(c, bad, layers), /mode "hub" needs fleet\.ingressPort/);
  }
  const ok = { mode: 'hub', port: 7777, fleet: { ...auth.defaults().fleet } };
  const layers = { file: { fleet: { ingressPort: 7778 } }, env: {} };
  ok.fleet.ingressPort = 7778;
  auth.finalize(ok, layers);
  auth.validate(ok, bad, layers);
  assert.equal(ok.fleet.ingressPort, 7778);
});

test('hubKeys: a bare string (ed25519: or PEM) parses to scopes {read}', () => {
  const c = withFleet({ hubKeys: [S1] });
  const [k] = auth.hubKeyring(c.fleet);
  assert.equal(k.keyId, keyId(K1));
  assert.equal(k.label, k.keyId, 'a bare key is labelled by its keyId');
  assert.deepEqual([...k.scopes], ['read']);
  assert.ok(k.pub.equals(K1));
  assert.equal(auth.hubKeyring(c.fleet), auth.hubKeyring(c.fleet), 'parsed once');
  const p = auth.hubKeyring(withFleet({ hubKeys: [P1] }).fleet)[0];
  assert.equal(p.keyId, k.keyId, 'PEM and ed25519: spellings share a keyId');
  assert.deepEqual([...p.scopes], ['read']);
  // surrounding whitespace is fine
  assert.equal(auth.hubKeyring(withFleet({ hubKeys: [`  ${S1}\n`] }).fleet)[0].keyId, k.keyId);
});

test('hubKeys: an object entry {key, id, scopes} parses; several keys allow rotation', () => {
  const c = withFleet({
    hubKeys: [
      { key: S1, id: 'hub-2026', scopes: ['read', 'control', 'term'] },
      { key: publicKeyPem(K2), id: 'hub-next', scopes: ['read'] },
      S3,
    ],
  });
  const ring = auth.hubKeyring(c.fleet);
  assert.equal(ring.length, 3);
  assert.equal(ring[0].label, 'hub-2026');
  assert.equal(ring[0].keyId, keyId(K1));
  assert.deepEqual([...ring[0].scopes].sort(), ['control', 'read', 'term']);
  assert.equal(ring[1].keyId, keyId(K2));
  assert.deepEqual([...ring[1].scopes], ['read']);
  assert.deepEqual([...ring[2].scopes], ['read']);
  assert.ok(Object.isFrozen(ring) && Object.isFrozen(ring[0]));
  assert.throws(() => ring[1].scopes.add('control'), TypeError, 'scopes cannot be widened at runtime');
  assert.ok(!ring[1].scopes.has('control'));
});

test('hubKeys: bad entries are refused', () => {
  const cases = [
    [['not a key'], /fleet\.hubKeys\[0\]: public key must be/],
    [['ed25519:AAAA'], /fleet\.hubKeys\[0\]: ed25519: key must be base64 of exactly 32 bytes/],
    [['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'], /fleet\.hubKeys\[0\]/],
    [[42], /fleet\.hubKeys\[0\] must be a key string or/],
    [[null], /fleet\.hubKeys\[0\] must be a key string or/],
    [[S1, 'ed25519:'], /fleet\.hubKeys\[1\]/],
    [[{ key: S1, id: 'hub', scopes: ['control'] }], /scopes must contain "read"/],
    [[{ key: S1, id: 'hub', scopes: [] }], /scopes must contain "read"/],
    [[{ key: S1, id: 'hub', scopes: ['read', 'admin'] }], /unknown scope "admin"/],
    [[{ key: S1, id: 'hub', scopes: ['read', 'read'] }], /duplicate scope/],
    [[{ key: S1, id: 'hub' }], /scopes must be a list/],
    [[{ key: S1, id: 'hub', scopes: 'read' }], /scopes must be a list/],
    [[{ key: S1, scopes: ['read'] }], /\.id must match/],
    [[{ key: S1, id: 'Hub Key', scopes: ['read'] }], /\.id must match/],
    [[{ key: S1, id: 'x'.repeat(33), scopes: ['read'] }], /\.id must match/],
    [[{ id: 'hub', scopes: ['read'] }], /\.key must be/],
    [[{ key: S1, id: 'hub', scopes: ['read'], extra: 1 }], /unknown field "extra"/],
    [[{ key: S1, id: 'a', scopes: ['read'] }, { key: S2, id: 'a', scopes: ['read'] }], /fleet\.hubKeys\[1\]: duplicate id "a"/],
    [[S1, { key: P1, id: 'again', scopes: ['read', 'control'] }], /fleet\.hubKeys\[1\]: the same key is pinned twice/],
    [Array(auth.MAX_HUB_KEYS + 1).fill(S1), /at most/],
  ];
  for (const [hubKeys, rx] of cases) fails(() => withFleet({ hubKeys }), rx);
  fails(() => withFleet({ hubKeys: S1 }), /fleet\.hubKeys must be a list/);
  // __proto__ in a JSON file becomes an own key, refused as unknown
  const f = path.join(tmp, `proto${++n}.json`);
  fs.writeFileSync(f, `{"fleet":{"hubKeys":[{"key":${JSON.stringify(S1)},"id":"hub","scopes":["read"],"__proto__":{"x":1}}]}}`);
  fails(() => cfg({}, f), /unknown field "__proto__"/);
});

test('hubKeys errors never echo the key text', () => {
  const secretish = `ed25519:${Buffer.alloc(31, 7).toString('base64')}`;
  assert.throws(() => withFleet({ hubKeys: [secretish] }), (err) => {
    assert.ok(!err.message.includes(secretish.slice(8)));
    return true;
  });
});

test('hubControl, enforce and legacyBrowserRoutes are booleans', () => {
  assert.equal(withFleet({ hubControl: true }).fleet.hubControl, true);
  assert.equal(withFleet({ enforce: false }).fleet.enforce, false);
  assert.equal(withFleet({ legacyBrowserRoutes: false }).fleet.legacyBrowserRoutes, false);
  for (const k of ['hubControl', 'enforce', 'legacyBrowserRoutes']) {
    for (const v of ['true', 1, null]) fails(() => withFleet({ [k]: v }), new RegExp(`fleet\\.${k} must be true or false`));
  }
});

test('hubAddrs entries are IP literals', () => {
  assert.deepEqual(withFleet({ hubAddrs: ['192.0.2.7', '2001:db8::7'] }).fleet.hubAddrs, ['192.0.2.7', '2001:db8::7']);
  for (const a of ['hub.example.invalid', '192.0.2.0/24', '192.0.2.7:443', '', 7, ' 192.0.2.7']) {
    fails(() => withFleet({ hubAddrs: [a] }), /fleet\.hubAddrs entry .* must be an IP address literal/);
  }
  fails(() => withFleet({ hubAddrs: '192.0.2.7' }), /fleet\.hubAddrs must be a list/);
});

test('ingressPeerUid: integer ≥ 0 or null, Linux only', () => {
  const bad = (m) => { throw new ConfigError(m); };
  const mk = (uid) => {
    const c = { port: 7777, fleet: { ...auth.defaults().fleet, ingressPort: 7778, ingressPeerUid: uid } };
    return c;
  };
  auth.validate(mk(0), bad, {}, { platform: 'linux' });
  auth.validate(mk(1000), bad, {}, { platform: 'linux' });
  auth.validate(mk(null), bad, {}, { platform: 'darwin' });
  for (const uid of [-1, 1.5, '0', true, 2 ** 32]) {
    fails(() => auth.validate(mk(uid), bad, {}, { platform: 'linux' }), /fleet\.ingressPeerUid must be a uid/);
  }
  fails(() => auth.validate(mk(0), bad, {}, { platform: 'darwin' }), /fleet\.ingressPeerUid needs Linux/);
  if (process.platform === 'linux') assert.equal(withFleet({ ingressPeerUid: 0 }).fleet.ingressPeerUid, 0);
});

test('allowedUsers are non-empty login strings', () => {
  assert.deepEqual(withFleet({ allowedUsers: ['user@example.invalid', 'acme-dev'] }).fleet.allowedUsers, ['user@example.invalid', 'acme-dev']);
  for (const u of ['', 'two words', 'tab\t', 7, null, 'x'.repeat(257)]) {
    fails(() => withFleet({ allowedUsers: [u] }), /fleet\.allowedUsers entry/);
  }
  fails(() => withFleet({ allowedUsers: 'user@example.invalid' }), /fleet\.allowedUsers must be a list/);
});

test('publicHosts: derived from a non-loopback publicUrl, else empty; validated', () => {
  const c = cfg({}, write({ publicUrl: 'https://builder-a.example.invalid:8443' }));
  assert.deepEqual(c.fleet.publicHosts, ['builder-a.example.invalid:8443']);
  assert.deepEqual(cfg({}, write({ publicUrl: 'http://localhost:7777' })).fleet.publicHosts, []);
  assert.deepEqual(cfg({ LANEBOARD_PUBLIC_URL: 'https://b.example.invalid' }).fleet.publicHosts, ['b.example.invalid']);
  // explicit wins, even [] (no derived default)
  const e = cfg({}, write({ publicUrl: 'https://b.example.invalid', fleet: { publicHosts: [] } }));
  assert.deepEqual(e.fleet.publicHosts, []);
  assert.deepEqual(withFleet({ publicHosts: ['b.example.invalid:8443', '[2001:db8::1]:8443'] }).fleet.publicHosts, ['b.example.invalid:8443', '[2001:db8::1]:8443']);
  for (const h of ['https://b.example.invalid', 'b.example.invalid/x', 'a b', '', 'user@b.example.invalid', 'b.example.invalid:99999', 5]) {
    fails(() => withFleet({ publicHosts: [h] }), /fleet\.publicHosts entry/);
  }
});

test('clockSkewMs stays inside the nonce window', () => {
  assert.equal(withFleet({ clockSkewMs: 30000 }).fleet.clockSkewMs, 30000);
  for (const v of [0, 999, 120001, 300000, 1.5, '60000']) fails(() => withFleet({ clockSkewMs: v }), /fleet\.clockSkewMs must be an integer/);
});

test('allowedPermissionModes: known modes only, bypassPermissions off by default', () => {
  assert.deepEqual(withFleet({ allowedPermissionModes: ['plan'] }).fleet.allowedPermissionModes, ['plan']);
  // listing it explicitly is the operator's choice (§2 2.2 "unless listed")
  assert.ok(withFleet({ allowedPermissionModes: ['default', 'bypassPermissions'] }).fleet.allowedPermissionModes.includes('bypassPermissions'));
  for (const m of ['yolo', 'Default', '', 3]) fails(() => withFleet({ allowedPermissionModes: [m] }), /unknown permission mode/);
  fails(() => withFleet({ allowedPermissionModes: ['plan', 'plan'] }), /duplicates/);
  fails(() => withFleet({ allowedPermissionModes: 'plan' }), /must be a list/);
});

test('rateLimits are checked by resolveRules', () => {
  const c = withFleet({ rateLimits: { kill: { limit: 2 }, 'custom-x': { limit: 4, windowMs: 1000 } } });
  assert.equal(c.fleet.rateLimits.kill.limit, 2);
  fails(() => withFleet({ rateLimits: { kill: { limit: 0 } } }), /fleet\.rateLimits\.kill\.limit must be a positive integer/);
  fails(() => withFleet({ rateLimits: { kill: { limit: 1, bogus: 1 } } }), /unknown key/);
  fails(() => withFleet({ rateLimits: { fanout: { limit: 2, windowMs: 10000, per: 'target' } } }), /cannot be changed/);
  fails(() => withFleet({ rateLimits: [] }), /rateLimits must be an object/);
});

test('audit.maxBytes is a sane size', () => {
  assert.equal(withFleet({ audit: { maxBytes: 1048576 } }).fleet.audit.maxBytes, 1048576);
  for (const v of [0, 1000, 2 ** 31, '1', null]) fails(() => withFleet({ audit: { maxBytes: v } }), /fleet\.audit\.maxBytes must be an integer/);
});

test('F4 keys still come from fleet.mjs alongside these', () => {
  const c = withFleet({ hubKeys: [S1] });
  assert.equal(c.fleet.id, 'builder-a');
  assert.equal(c.fleet.code, 'BA');
  assert.deepEqual(c.fleet.allowedOrigins, []);
});
