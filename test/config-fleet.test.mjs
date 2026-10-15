// server/config/fleet.mjs: fleet.id / fleet.code / fleet.allowedOrigins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as fleet from '../server/config/fleet.mjs';
import { sanitizeId, deriveCode } from '../server/fleet/keys.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-fleet-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const cfg = (env = {}, file = MISSING) => build({ env, file });
const fails = (fn, rx) => assert.throws(fn, (err) => {
  assert.ok(err instanceof ConfigError, `ConfigError, got ${err}`);
  assert.match(err.message, rx);
  return true;
});

test('the fragment is loaded from server/config/', () => {
  assert.ok(FRAGMENTS.some((f) => f.defaults === fleet.defaults), 'fleet.mjs is among FRAGMENTS');
});

test('defaults: id from the hostname, code derived, no extra origins', () => {
  const c = cfg();
  const id = sanitizeId(os.hostname());
  assert.equal(c.fleet.id, id);
  assert.equal(c.fleet.code, deriveCode(id));
  assert.deepEqual(c.fleet.allowedOrigins, []);
  assert.equal(c.mode, 'builder', 'mode untouched');
  assert.deepEqual(fleet.defaults().fleet.code, '', 'the raw default code is empty');
});

test('env: LANEBOARD_FLEET_ID, LANEBOARD_FLEET_CODE, LANEBOARD_ALLOWED_ORIGINS', () => {
  const c = cfg({
    LANEBOARD_FLEET_ID: 'builder-a',
    LANEBOARD_FLEET_CODE: 'b1',
    LANEBOARD_ALLOWED_ORIGINS: ' https://hub.example.invalid , http://127.0.0.1:7780,,',
  });
  assert.equal(c.fleet.id, 'builder-a');
  assert.equal(c.fleet.code, 'B1', 'uppercased');
  assert.deepEqual(c.fleet.allowedOrigins, ['https://hub.example.invalid', 'http://127.0.0.1:7780']);
});

test('env id alone derives the code from it', () => {
  assert.equal(cfg({ LANEBOARD_FLEET_ID: 'builder-a' }).fleet.code, 'BA');
  assert.equal(cfg({ LANEBOARD_FLEET_ID: 'hub' }).fleet.code, 'HU');
});

test('empty env values contribute nothing', () => {
  assert.deepEqual(fleet.fromEnv({}), {});
  assert.deepEqual(fleet.fromEnv({ LANEBOARD_FLEET_ID: '', LANEBOARD_FLEET_CODE: '', LANEBOARD_ALLOWED_ORIGINS: '' }), {});
});

test('the file sets the keys; env wins over the file', () => {
  const file = write({ fleet: { id: 'ci-2', allowedOrigins: ['https://hub.example.invalid'] } });
  const c = cfg({}, file);
  assert.equal(c.fleet.id, 'ci-2');
  assert.equal(c.fleet.code, 'C2');
  assert.deepEqual(c.fleet.allowedOrigins, ['https://hub.example.invalid']);
  const e = cfg({ LANEBOARD_FLEET_ID: 'builder-a' }, file);
  assert.equal(e.fleet.id, 'builder-a');
  assert.equal(e.fleet.code, 'BA');
});

test('an explicit code in the file wins over the derived one', () => {
  assert.equal(cfg({}, write({ fleet: { id: 'builder-a', code: 'XYZ' } })).fleet.code, 'XYZ');
});

test('bad id is refused', () => {
  for (const id of ['Builder A', 'UPPER', 'a_b', 'x'.repeat(25), 7, null]) {
    fails(() => cfg({}, write({ fleet: { id } })), /fleet\.id must match/);
  }
  fails(() => cfg({ LANEBOARD_FLEET_ID: 'not ok' }), /fleet\.id must match .*"not ok"/);
});

test('bad code is refused', () => {
  for (const code of ['A', 'ABCD', 'A-B', 'é1', 12, null]) {
    fails(() => cfg({}, write({ fleet: { id: 'builder-a', code } })), /fleet\.code must be/);
  }
  fails(() => cfg({ LANEBOARD_FLEET_ID: 'builder-a', LANEBOARD_FLEET_CODE: 'TOOLONG' }), /fleet\.code must be/);
});

test('bad origins are refused', () => {
  const bad = [
    ['not a url', /is not a URL/],
    ['https://hub.example.invalid/', /exact origin/],
    ['https://hub.example.invalid/path', /exact origin/],
    ['HTTPS://Hub.example.invalid', /exact origin/],
    ['https://hub.example.invalid:443', /exact origin/],
    ['http://hub.example.invalid', /https/],
    ['http://10.0.0.1:7777', /https/],
    ['ws://127.0.0.1:7777', /https/],
    ['', /non-empty string/],
  ];
  for (const [o, rx] of bad) {
    fails(() => cfg({}, write({ fleet: { allowedOrigins: [o] } })), rx);
  }
  fails(() => cfg({}, write({ fleet: { allowedOrigins: 'https://hub.example.invalid' } })), /must be a list/);
  fails(() => cfg({}, write({ fleet: { allowedOrigins: [42] } })), /non-empty string/);
  fails(() => cfg({ LANEBOARD_ALLOWED_ORIGINS: 'https://hub.example.invalid,http://hub.example.invalid' }), /"http:\/\/hub\.example\.invalid" must use https/);
});

test('good origins: https anywhere, http on loopback only', () => {
  const ok = ['https://hub.example.invalid', 'https://hub.example.invalid:8443', 'http://127.0.0.1:7780', 'http://localhost:7780', 'http://[::1]:7780'];
  assert.deepEqual(cfg({}, write({ fleet: { allowedOrigins: ok } })).fleet.allowedOrigins, ok);
  for (const o of ok) assert.equal(fleet.originProblem(o), null, o);
});

test('a non-object fleet block is refused, not crashed on', () => {
  fails(() => cfg({}, write({ fleet: 'x' })), /fleet/);
  fails(() => cfg({}, write({ fleet: [] })), /fleet/);
});

test('finalize leaves a valid given code alone and tolerates wrong types', () => {
  assert.equal(fleet.finalize({ fleet: { id: 'builder-a', code: 'Q7' } }).fleet.code, 'Q7');
  assert.equal(fleet.finalize({ fleet: { id: 'Bad Id', code: '' } }).fleet.code, '', 'no derive from a bad id; validate reports it');
  assert.deepEqual(fleet.finalize({ fleet: null }), { fleet: null });
  assert.deepEqual(fleet.finalize({}), {});
});
