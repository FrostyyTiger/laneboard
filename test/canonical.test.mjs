// canonicalJson / sha256Hex (fleet A1, REVIEW-REQUIRED SR1).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalJson, sha256Hex, CanonicalJsonError, MAX_DEPTH } from '../server/fleet/canonical.mjs';

const rejects = (v, re) => assert.throws(() => canonicalJson(v), (e) => e instanceof CanonicalJsonError && (!re || re.test(e.message)));

test('primitives match JSON.stringify', () => {
  for (const v of [null, true, false, 0, 1, -1, 1.5, 'x', '', 'a"b\\c\n\t\u0001', 1e21, 5e-324, 0.1 + 0.2, Number.MAX_SAFE_INTEGER, -1e-7]) {
    assert.equal(canonicalJson(v), JSON.stringify(v));
  }
  assert.equal(canonicalJson(-0), '0');
  assert.equal(canonicalJson(1.0), '1');
  assert.equal(canonicalJson(1e21), '1e+21');
});

test('key order is irrelevant, output has no whitespace', () => {
  const a = { b: 1, a: [1, 2], c: { z: null, y: 'q' } };
  const b = { c: { y: 'q', z: null }, a: [1, 2], b: 1 };
  assert.equal(canonicalJson(a), '{"a":[1,2],"b":1,"c":{"y":"q","z":null}}');
  assert.equal(canonicalJson(a), canonicalJson(b));
  // wire whitespace / order do not matter after parse
  assert.equal(canonicalJson(JSON.parse('{ "c" : {"z":null , "y":"q"},\n"b":1, "a":[1 ,2]}')), canonicalJson(a));
});

test('integer-like keys sort as strings, not numerically', () => {
  // Object.keys puts integer keys first in numeric order; canonical order is code-unit order.
  assert.equal(canonicalJson({ 10: 'a', 9: 'b', x: 'c', 1: 'd' }), '{"1":"d","10":"a","9":"b","x":"c"}');
});

test('keys sort by UTF-16 code unit, not code point', () => {
  // U+1D11E (surrogate pair D834 DD1E) sorts before U+FFFD by code unit.
  const o = { '�': 1, '\u{1D11E}': 2, 'é': 3, z: 4, Z: 5, '': 6 };
  assert.equal(canonicalJson(o), '{"":6,"Z":5,"z":4,"é":3,"\u{1D11E}":2,"�":1}');
});

test('nested arrays keep order; nested objects are sorted', () => {
  const v = [[3, 1, 2], { b: [{ d: 1, c: 2 }], a: [] }, [], {}];
  assert.equal(canonicalJson(v), '[[3,1,2],{"a":[],"b":[{"c":2,"d":1}]},[],{}]');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('unicode strings are serialized like JSON.stringify (lone surrogates escaped)', () => {
  for (const s of ['héllo', '日本', '\u{1F600}', '  ', '\ud800', 'a\udc00b']) {
    assert.equal(canonicalJson(s), JSON.stringify(s));
    assert.equal(JSON.parse(canonicalJson(s)), s);
  }
  assert.equal(canonicalJson('\ud800'), '"\\ud800"');
  assert.equal(canonicalJson({ '\ud800': 1 }), '{"\\ud800":1}');
});

test('round trip: canonicalJson(JSON.parse(canonicalJson(v))) is stable', () => {
  const v = { v: 1, id: crypto.randomUUID(), ts: 1700000000000, args: { text: 'hi\n', keys: ['C-c'], n: -0.5, deep: { a: [null, true] } } };
  const c = canonicalJson(v);
  assert.equal(canonicalJson(JSON.parse(c)), c);
});

test('null-prototype objects are accepted like plain objects', () => {
  const o = Object.create(null);
  o.b = 1;
  o.a = 2;
  assert.equal(canonicalJson(o), '{"a":2,"b":1}');
});

test('forbidden keys are rejected (from literals and from JSON.parse)', () => {
  rejects(JSON.parse('{"__proto__":{"x":1}}'), /__proto__/);
  rejects(JSON.parse('{"a":{"__proto__":1}}'), /__proto__/);
  rejects({ constructor: 1 }, /constructor/);
  rejects({ a: [{ prototype: 1 }] }, /prototype/);
  // the message names the path
  assert.throws(() => canonicalJson({ a: [{ prototype: 1 }] }), /\$\["a"\]\[0\]/);
});

test('non-JSON-safe values are rejected', () => {
  rejects(undefined);
  rejects({ a: undefined });
  rejects([undefined]);
  rejects(NaN);
  rejects({ a: Infinity });
  rejects([-Infinity]);
  rejects(1n);
  rejects({ a: 1n });
  rejects(() => 1);
  rejects({ f() {} });
  rejects(Symbol('s'));
  rejects(new Date(0));
  rejects({ d: new Date(0) });
  rejects(new Map());
  rejects(new Set());
  rejects(Buffer.from('x'));
  rejects(new Uint8Array(1));
  rejects(/re/);
  rejects(new Error('x'));
  rejects(new String('x'));
  rejects(new Number(1));
  rejects(new Boolean(true));
  rejects(new (class Foo {})());
  rejects({ toJSON: () => 1, a: () => 1 });
});

test('toJSON is never called: a data key named toJSON is plain data, a class with toJSON is rejected', () => {
  assert.equal(canonicalJson({ toJSON: 'x', a: 1 }), '{"a":1,"toJSON":"x"}');
  class K { toJSON() { return 'x'; } }
  rejects(new K());
});

test('hidden or lying properties are rejected, not dropped', () => {
  const sym = { a: 1, [Symbol('s')]: 2 };
  rejects(sym, /symbol/);
  const nonEnum = { a: 1 };
  Object.defineProperty(nonEnum, 'b', { value: 2, enumerable: false });
  rejects(nonEnum, /non-enumerable/);
  let n = 0;
  rejects({ get a() { return n++; } }, /accessor/);
  rejects(new Proxy({ a: 1 }, {}), /proxy/);
  rejects([new Proxy([], {})], /proxy/);
});

test('arrays: holes, extra properties and subclasses are rejected', () => {
  // eslint-disable-next-line no-sparse-arrays
  rejects([1, , 3], /hole/);
  rejects(new Array(2), /hole/);
  const extra = [1, 2];
  extra.x = 1;
  rejects(extra, /extra/);
  const symArr = [1];
  symArr[Symbol('s')] = 1;
  rejects(symArr);
  class A extends Array {}
  rejects(A.from([1]), /non-plain array/);
  const getter = [1];
  Object.defineProperty(getter, 0, { get: () => 1, enumerable: true });
  rejects(getter, /accessor/);
});

test('cycles are rejected; shared (non-cyclic) references are fine', () => {
  const a = { x: 1 };
  a.self = a;
  rejects(a, /cycle/);
  const arr = [];
  arr.push(arr);
  rejects(arr, /cycle/);
  const shared = { k: 1 };
  assert.equal(canonicalJson({ a: shared, b: shared, c: [shared, shared] }), '{"a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":1}]}');
});

test('nesting deeper than MAX_DEPTH is rejected cleanly (no stack overflow)', () => {
  const mk = (n) => { let v = 0; for (let i = 0; i < n; i++) v = [v]; return v; };
  assert.equal(canonicalJson(mk(MAX_DEPTH)), '['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH));
  rejects(mk(MAX_DEPTH + 1), /nesting/);
  rejects(JSON.parse('['.repeat(30000) + ']'.repeat(30000)), /nesting/);
});

test('error messages do not echo values', () => {
  try {
    canonicalJson({ secret: { a: undefined, note: 'hunter2-prompt-text' }, x: 1n });
    assert.fail('should throw');
  } catch (e) {
    assert.ok(!/hunter2/.test(e.message));
  }
});

test('sha256Hex: strings as UTF-8, bytes as-is, known vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(Buffer.from('abc')), sha256Hex('abc'));
  assert.equal(sha256Hex('é'), crypto.createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex'));
  assert.match(sha256Hex(canonicalJson({ a: 1 })), /^[0-9a-f]{64}$/);
});

test('sha256Hex refuses lossy or non-string input', () => {
  assert.throws(() => sha256Hex('\ud800'), TypeError);
  assert.throws(() => sha256Hex({ a: 1 }), TypeError);
  assert.throws(() => sha256Hex(1), TypeError);
  assert.throws(() => sha256Hex(undefined), TypeError);
});
