import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as server from '../server/fleet/keys.mjs';
import * as client from '../public/js/core/keys.js';

const EXPORTS = ['BUILDER_ID_RX', 'SEP', 'fkey', 'parseFkey', 'isFkey', 'localKey', 'laneNodeId', 'sanitizeId', 'deriveCode'];

test('both copies export the same names', () => {
  assert.deepEqual(Object.keys(server).sort(), [...EXPORTS].sort());
  assert.deepEqual(Object.keys(client).sort(), [...EXPORTS].sort());
  assert.equal(server.SEP, '/');
  assert.equal(client.SEP, '/');
  assert.equal(String(server.BUILDER_ID_RX), String(client.BUILDER_ID_RX));
});

test('client file is a byte-identical copy of the server file', () => {
  const a = readFileSync(new URL('../server/fleet/keys.mjs', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../public/js/core/keys.js', import.meta.url), 'utf8');
  assert.equal(b, a);
  assert.doesNotMatch(a, /^\s*import\s/m, 'browser copy must not import anything');
});

test('fkey/parseFkey round-trip, including names with /, unicode and spaces', () => {
  const names = ['web', 'lane/sub/deep', 'café ☕', 'with space', ' lead', '/', 'a//b', 'x-1.2_y', '日本語'];
  for (const b of ['builder-a', 'hub', 'ci-2', 'a', 'x'.repeat(24), '0', '-']) {
    for (const n of names) {
      const k = server.fkey(b, n);
      assert.equal(k, `${b}/${n}`);
      assert.deepEqual(server.parseFkey(k), { builder: b, name: n });
      assert.equal(server.isFkey(k), true);
      assert.equal(server.localKey(k, b), n);
    }
  }
});

test('fkey rejects bad builder ids and bad names', () => {
  for (const b of ['', 'Builder', 'a b', 'a/b', 'a_b', 'x'.repeat(25), 'é', null, undefined, 1, {}]) {
    assert.throws(() => server.fkey(b, 'web'), TypeError, String(b));
  }
  for (const n of ['', null, undefined, 3, {}, ['a']]) {
    assert.throws(() => server.fkey('builder-a', n), TypeError, String(n));
  }
  assert.throws(() => server.laneNodeId('Bad Id', 'l1'), TypeError);
  assert.throws(() => server.laneNodeId('builder-a', ''), TypeError);
});

test('parseFkey rejects malformed keys', () => {
  for (const k of ['', 'web', '/web', 'builder-a/', 'Bad/web', 'a b/web', `${'x'.repeat(25)}/w`, null, undefined, 7, {}, ['a/b']]) {
    assert.equal(server.parseFkey(k), null, String(k));
    assert.equal(server.isFkey(k), false);
  }
});

test('localKey keeps own keys and drops foreign ones', () => {
  assert.equal(server.localKey('builder-a/web', 'builder-a'), 'web');
  assert.equal(server.localKey('builder-a/x/y', 'builder-a'), 'x/y');
  assert.equal(server.localKey('builder-b/web', 'builder-a'), null);
  assert.equal(server.localKey('builder-ab/web', 'builder-a'), null);
  assert.equal(server.localKey('web', 'builder-a'), null);
  assert.equal(server.localKey(null, 'builder-a'), null);
});

test('laneNodeId', () => {
  assert.equal(server.laneNodeId('builder-a', 'l-42'), 'lane:builder-a/l-42');
});

test('sanitizeId', () => {
  assert.equal(server.sanitizeId('Builder_A.local'), 'builder-a-local');
  assert.equal(server.sanitizeId(''), 'builder');
  assert.equal(server.sanitizeId(undefined), 'builder');
  assert.equal(server.sanitizeId('---'), 'builder');
  assert.equal(server.sanitizeId('é'), 'builder');
  const long = 'abcdefghij'.repeat(4);
  assert.equal(long.length, 40);
  assert.equal(server.sanitizeId(long), long.slice(0, 24));
  assert.equal(server.sanitizeId('  Hub  '), 'hub');
  assert.equal(server.sanitizeId(`${'a'.repeat(23)}.b`), 'a'.repeat(23)); // no trailing '-' after the cut
  for (const s of ['Builder_A.local', '', long, 'ÄÖÜ host', 'a'.repeat(30), '-x-', 'CI 2']) {
    assert.match(server.sanitizeId(s), server.BUILDER_ID_RX);
  }
});

test('deriveCode vectors', () => {
  const vectors = {
    'builder-a': 'BA', 'ci-2': 'C2', hub: 'HU', 'builder-a-b': 'BAB', 'a-b-c-d': 'ABC',
    a: 'A0', '7': '70', ab: 'AB', 'acme-box-1': 'AB1', 'x--y': 'XY',
  };
  for (const [id, code] of Object.entries(vectors)) assert.equal(server.deriveCode(id), code, id);
  for (const id of ['builder-a', 'a', 'Weird Host.local', '', '9', 'a-b-c-d-e']) {
    assert.match(server.deriveCode(id), /^[A-Z0-9]{2,3}$/);
  }
});

// Shared vector table: [function, args]. Every case must give the same
// result (or the same error class) from both copies.
const VECTORS = [
  ['fkey', ['builder-a', 'web']], ['fkey', ['hub', 'a/b/c']], ['fkey', ['ci-2', 'café ☕']],
  ['fkey', ['builder-a', 'with space']], ['fkey', ['Bad', 'web']], ['fkey', ['builder-a', '']],
  ['fkey', ['', 'x']], ['fkey', ['builder-a', null]], ['fkey', ['x'.repeat(25), 'w']], ['fkey', ['x'.repeat(24), 'w']],
  ['parseFkey', ['builder-a/web']], ['parseFkey', ['builder-a/x/y']], ['parseFkey', ['/web']], ['parseFkey', ['web']],
  ['parseFkey', ['builder-a/']], ['parseFkey', ['B/web']], ['parseFkey', [null]], ['parseFkey', ['日本/語']],
  ['parseFkey', ['hub/日本語']], ['parseFkey', ['a b/c']],
  ['isFkey', ['builder-a/web']], ['isFkey', ['web']], ['isFkey', [42]], ['isFkey', ['hub//']],
  ['localKey', ['builder-a/web', 'builder-a']], ['localKey', ['builder-b/web', 'builder-a']],
  ['localKey', ['builder-a/x/y', 'builder-a']], ['localKey', ['nope', 'builder-a']], ['localKey', [undefined, 'hub']],
  ['laneNodeId', ['builder-a', 'l-1']], ['laneNodeId', ['hub', 'lane/x']], ['laneNodeId', ['Bad', 'l']], ['laneNodeId', ['hub', '']],
  ['sanitizeId', ['Builder_A.local']], ['sanitizeId', ['']], ['sanitizeId', ['abcdefghij'.repeat(4)]], ['sanitizeId', [null]],
  ['sanitizeId', ['ÄÖÜ host']], ['sanitizeId', ['--x--']], ['sanitizeId', [`${'a'.repeat(23)}.b`]], ['sanitizeId', [12345]],
  ['deriveCode', ['builder-a']], ['deriveCode', ['ci-2']], ['deriveCode', ['hub']], ['deriveCode', ['a']],
  ['deriveCode', ['a-b-c-d']], ['deriveCode', ['']], ['deriveCode', ['Weird Host.local']], ['deriveCode', ['acme-box-1']],
  ['deriveCode', ['9']],
];

function run(mod, fn, args) {
  try { return { ok: mod[fn](...args) }; } catch (e) { return { err: e.constructor.name }; }
}

test('parity: server and client copies agree on the shared vector table', () => {
  assert.ok(VECTORS.length >= 50, `need at least 50 vectors, have ${VECTORS.length}`);
  for (const [fn, args] of VECTORS) {
    assert.deepEqual(run(client, fn, args), run(server, fn, args), `${fn}(${JSON.stringify(args)})`);
  }
  // Spot-check that the table exercises both outcomes.
  assert.ok(VECTORS.some(([fn, a]) => 'err' in run(server, fn, a)));
  assert.ok(VECTORS.some(([fn, a]) => 'ok' in run(server, fn, a)));
});
