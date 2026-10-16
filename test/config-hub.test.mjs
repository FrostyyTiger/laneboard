// server/config/hub.mjs: fleet.builders, hubKeyFile, timings, placement (fleet H1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as hub from '../server/config/hub.mjs';
import * as paths from '../server/fleet/paths.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-hub-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const cfg = (body, env = {}) => build({ env, file: body === undefined ? MISSING : write(body) });
const fails = (fn, rx) => assert.throws(fn, (err) => {
  assert.ok(err instanceof ConfigError, `ConfigError, got ${err}`);
  assert.match(err.message, rx);
  return true;
});

const A = { id: 'builder-a', url: 'https://builder-a.example.invalid' };
const B = { id: 'builder-b', url: 'https://builder-b.example.invalid:8443/' };
/** A valid hub config with `fleet` overrides. */
const hubCfg = (fleet = {}, extra = {}) => cfg({ mode: 'hub', fleet: { builders: [A], ingressPort: 7778, ingressPeerUid: 0, ...fleet }, ...extra });

test('the fragment is loaded from server/config/', () => {
  assert.ok(FRAGMENTS.some((f) => f.defaults === hub.defaults), 'hub.mjs is among FRAGMENTS');
});

test('defaults: no builders, the timings and placement gates of the plan', () => {
  const c = cfg();
  assert.equal(c.mode, 'builder');
  assert.deepEqual(c.fleet.builders, []);
  assert.equal(c.fleet.hubKeyFile, paths.hubKeyFile());
  assert.equal(c.fleet.staleMs, 15000);
  assert.equal(c.fleet.downMs, 60000);
  assert.equal(c.fleet.batchMs, 250);
  assert.equal(c.fleet.pingMs, 5000);
  assert.equal(c.fleet.actionTimeoutMs, 15000);
  assert.equal(c.fleet.maxTermsPerBuilder, 8);
  assert.deepEqual(c.fleet.placement, { minFreeMemMb: 4096, maxSwapFrac: 0.5 });
});

test('a valid hub: directUrl and account defaulted, code uppercased, unset code left to the store', () => {
  const c = hubCfg({ builders: [{ ...A, code: 'ba', repos: ['web', 'acme.api'] }, { ...B, directUrl: 'http://builder-b.example.invalid:7777/ui', account: 'acme' }] });
  assert.equal(c.mode, 'hub');
  assert.deepEqual(c.fleet.builders, [
    { ...A, code: 'BA', repos: ['web', 'acme.api'], directUrl: A.url, account: 'default' },
    { ...B, directUrl: 'http://builder-b.example.invalid:7777/ui', account: 'acme' },
  ]);
  assert.equal('code' in c.fleet.builders[1], false);
});

test('a hub accepts http only on a loopback host', () => {
  for (const url of ['http://127.0.0.1:7801', 'http://localhost:7801/', 'http://[::1]:7801']) {
    assert.equal(hubCfg({ builders: [{ id: 'builder-a', url }] }).fleet.builders[0].url, url);
  }
});

test('env LANEBOARD_FLEET_BUILDERS=id=url,id=url', () => {
  const c = cfg({ mode: 'hub', fleet: { ingressPort: 7778, ingressPeerUid: 0 } }, {
    LANEBOARD_FLEET_BUILDERS: ' builder-a=https://builder-a.example.invalid , builder-b=http://127.0.0.1:7802,,',
  });
  assert.deepEqual(c.fleet.builders.map((b) => [b.id, b.url]), [
    ['builder-a', 'https://builder-a.example.invalid'], ['builder-b', 'http://127.0.0.1:7802'],
  ]);
  assert.deepEqual(hub.fromEnv({}), {});
  assert.deepEqual(hub.fromEnv({ LANEBOARD_FLEET_BUILDERS: '' }), {});
  fails(() => cfg({ mode: 'hub', fleet: { ingressPort: 7778, ingressPeerUid: 0 } }, { LANEBOARD_FLEET_BUILDERS: 'builder-a' }), /builder-a.*url \(missing\)/);
});

test('rejects duplicate builder ids', () => {
  fails(() => hubCfg({ builders: [A, { ...B, id: 'builder-a' }] }), /"builder-a" is used by more than one builder/);
});

test('rejects a hub with no builders', () => {
  fails(() => cfg({ mode: 'hub', fleet: { ingressPort: 7778, ingressPeerUid: 0 } }), /mode "hub" needs at least one entry in fleet.builders/);
  fails(() => hubCfg({ builders: [] }), /at least one entry/);
  // builder mode does not care
  assert.deepEqual(cfg({ fleet: { builders: [] } }).fleet.builders, []);
});

test('rejects a hub with a null ingressPort', () => {
  fails(() => hubCfg({ ingressPort: null }), /mode "hub" needs fleet.ingressPort/);
  fails(() => cfg({ mode: 'hub', fleet: { builders: [A] } }), /fleet.ingressPort/);
});

test('rejects staleMs >= downMs and non-positive timings', () => {
  fails(() => hubCfg({ staleMs: 60000, downMs: 60000 }), /staleMs \(60000\) must be less than fleet.downMs/);
  fails(() => hubCfg({ staleMs: 900, downMs: 300 }), /less than/);
  assert.equal(hubCfg({ staleMs: 300, downMs: 900 }).fleet.downMs, 900);
  for (const k of ['staleMs', 'downMs', 'batchMs', 'pingMs', 'actionTimeoutMs', 'maxTermsPerBuilder']) {
    for (const v of [0, -1, 1.5, '100', null]) fails(() => hubCfg({ [k]: v }), new RegExp(`fleet.${k} must be a positive integer`));
  }
});

test('rejects an http builder url on a non-loopback host, and other bad urls', () => {
  const bad = (url, rx) => fails(() => hubCfg({ builders: [{ id: 'builder-a', url }] }), rx);
  bad('http://builder-a.example.invalid', /must use https \(http only on a loopback host\)/);
  bad('http://10.0.0.5:7777', /must use https/);
  bad('http://127.0.0.1.example.invalid', /must use https/);
  bad('ws://builder-a.example.invalid', /must use https/);
  bad('https://user:pw@builder-a.example.invalid', /must not carry credentials/);
  bad('https://user@builder-a.example.invalid', /must not carry credentials/);
  bad('https://builder-a.example.invalid/api', /no path, query or fragment/);
  bad('https://builder-a.example.invalid/?x=1', /no path, query or fragment/);
  bad('https://builder-a.example.invalid/#x', /no path, query or fragment/);
  bad('not a url', /is not a URL/);
  bad('', /non-empty string/);
  bad(7, /non-empty string/);
});

test('rejects bad ids, codes, directUrls, accounts and unknown keys', () => {
  for (const id of ['Builder-A', 'b_1', '', 'x'.repeat(25), 7, undefined]) {
    fails(() => hubCfg({ builders: [{ ...A, id }] }), /fleet.builders\[0\].id must match/);
  }
  for (const code of ['X', 'ABCD', 'A-1', '', 12]) fails(() => hubCfg({ builders: [{ ...A, code }] }), /code must be 2-3 letters or digits/);
  fails(() => hubCfg({ builders: [{ ...A, directUrl: 'ftp://builder-a.example.invalid' }] }), /directUrl .* must use http or https/);
  fails(() => hubCfg({ builders: [{ ...A, directUrl: 'https://u:p@builder-a.example.invalid' }] }), /directUrl .* must not carry credentials/);
  fails(() => hubCfg({ builders: [{ ...A, account: '' }] }), /account must be a short name/);
  fails(() => hubCfg({ builders: [{ ...A, account: 'a\nb' }] }), /account must be a short name/);
  fails(() => hubCfg({ builders: [{ ...A, token: 'x' }] }), /unknown key "token"/);
  fails(() => cfg({ mode: 'hub', fleet: { ingressPort: 7778, ingressPeerUid: 0, builders: [JSON.parse('{"id":"builder-a","url":"https://a.example.invalid","__proto__":{"x":1}}')] } }), /unknown key "__proto__"/);
  fails(() => hubCfg({ builders: ['builder-a'] }), /fleet.builders\[0\] must be an object/);
  fails(() => hubCfg({ builders: { 'builder-a': A } }), /fleet.builders must be a list/);
  fails(() => hubCfg({ builders: Array.from({ length: hub.MAX_BUILDERS + 1 }, (_, i) => ({ id: `b${i}`, url: `https://b${i}.example.invalid` })) }), /at most/);
});

test('repos allowlist entries validate as repo names', () => {
  assert.deepEqual(hubCfg({ builders: [{ ...A, repos: [] }] }).fleet.builders[0].repos, []);
  for (const r of ['../etc', 'a..b', '-web', '.hidden', 'acme/web', '', 'x'.repeat(65), 7, null]) {
    fails(() => hubCfg({ builders: [{ ...A, repos: [r] }] }), /repos entry .* is not a repo name/);
  }
  fails(() => hubCfg({ builders: [{ ...A, repos: 'web' }] }), /repos must be a list/);
  assert.equal(hub.isRepoName('acme-web_2.x'), true);
});

test('rejects a hub allowedOrigins entry equal to a builder url or directUrl origin', () => {
  fails(() => hubCfg({ allowedOrigins: ['https://builder-a.example.invalid'] }), /is the origin of builder "builder-a"/);
  fails(() => hubCfg({ builders: [B], allowedOrigins: ['https://builder-b.example.invalid:8443'] }), /builder "builder-b"/);
  fails(() => hubCfg({
    builders: [{ ...A, directUrl: 'https://ui-a.example.invalid/board' }],
    allowedOrigins: ['https://ui-a.example.invalid'],
  }), /builder "builder-a"/);
  // a different port or host is a different origin
  assert.deepEqual(hubCfg({ allowedOrigins: ['https://builder-a.example.invalid:8443', 'https://hub.example.invalid'] }).fleet.allowedOrigins.length, 2);
});

test('hubKeyFile: absolute or ~/, anything else refused', () => {
  assert.equal(hubCfg({ hubKeyFile: '/srv/hub.key' }).fleet.hubKeyFile, '/srv/hub.key');
  assert.equal(hubCfg({ hubKeyFile: '~/keys/hub.key' }).fleet.hubKeyFile, path.join(os.homedir(), 'keys/hub.key'));
  for (const v of ['hub.key', '', null]) fails(() => hubCfg({ hubKeyFile: v }), /fleet.hubKeyFile must be an absolute path/);
});

test('placement gates validate', () => {
  assert.deepEqual(hubCfg({ placement: { minFreeMemMb: 0, maxSwapFrac: 1 } }).fleet.placement, { minFreeMemMb: 0, maxSwapFrac: 1 });
  // a partial override merges with the defaults
  assert.deepEqual(hubCfg({ placement: { maxSwapFrac: 0.2 } }).fleet.placement, { minFreeMemMb: 4096, maxSwapFrac: 0.2 });
  fails(() => hubCfg({ placement: { minFreeMemMb: -1 } }), /minFreeMemMb must be a number >= 0/);
  fails(() => hubCfg({ placement: { maxSwapFrac: 1.5 } }), /maxSwapFrac must be a fraction/);
  fails(() => hubCfg({ placement: { maxSwapFrac: '0.5' } }), /maxSwapFrac must be a fraction/);
  fails(() => hubCfg({ placement: [] }), /fleet.placement must be an object/);
});
