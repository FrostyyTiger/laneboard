// Canonical JSON and sha256 for fleet signatures and the audit chain.
//
// REVIEW-REQUIRED (SR1). Everything that is signed (action envelopes, `term`
// envelopes) or hash-chained (audit entries, argsHash) goes through
// `canonicalJson`, so two parties that hold the same JSON *value* always
// produce the same bytes, whatever key order or whitespace the wire carried.
//
// Rules (plan §2 2.4):
//   - objects: keys sorted by UTF-16 code unit order (`Array#sort` default),
//     recursively; arrays keep their order; no whitespace;
//   - strings, finite numbers, booleans and null are written by JSON.stringify
//     (so -0 is "0", lone surrogates come out as \udXXX escapes);
//   - anything JSON cannot represent exactly is REJECTED, never coerced:
//     undefined, functions, symbols, BigInt, NaN/±Infinity, Dates, Maps,
//     Buffers, class instances, boxed primitives, Proxies, accessor (getter)
//     properties, non-enumerable or symbol keys, sparse arrays or arrays with
//     extra properties, cycles, nesting deeper than MAX_DEPTH, and the keys
//     `__proto__`, `constructor`, `prototype`.
// The point of rejecting rather than dropping: a value the serializer would
// silently skip (a symbol key, a getter, a hole) is data the signer did not
// sign but the receiver might act on.
//
// Error messages name the path to the offending node, never its value (args
// can hold prompts).
import crypto from 'node:crypto';
import { types } from 'node:util';

export const MAX_DEPTH = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class CanonicalJsonError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function fmtPath(path) {
  let s = '$';
  for (const k of path) {
    if (typeof k === 'number') s += `[${k}]`;
    else s += `[${JSON.stringify(k.length > 64 ? `${k.slice(0, 64)}…` : k)}]`;
  }
  return s;
}

function fail(path, why) {
  throw new CanonicalJsonError(`canonicalJson: ${why} at ${fmtPath(path)}`);
}

function encodeArray(arr, path, seen) {
  if (Object.getPrototypeOf(arr) !== Array.prototype) fail(path, 'non-plain array');
  const n = arr.length;
  // Exactly the indices 0..n-1 plus `length`: no holes, no extra string or
  // symbol properties.
  if (Reflect.ownKeys(arr).length !== n + 1) fail(path, 'array with holes or extra properties');
  const parts = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = Object.getOwnPropertyDescriptor(arr, i);
    if (!d) fail(path, `array hole at index ${i}`);
    if (!('value' in d)) fail([...path, i], 'accessor property');
    path.push(i);
    parts[i] = encode(d.value, path, seen);
    path.pop();
  }
  return `[${parts.join(',')}]`;
}

function encodeObject(obj, path, seen) {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) fail(path, 'non-plain object');
  const own = Reflect.ownKeys(obj);
  const keys = [];
  const values = new Map();
  for (const k of own) {
    if (typeof k !== 'string') fail(path, 'symbol key');
    if (FORBIDDEN_KEYS.has(k)) fail(path, `forbidden key ${JSON.stringify(k)}`);
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (!('value' in d)) fail([...path, k], 'accessor property');
    if (!d.enumerable) fail([...path, k], 'non-enumerable property');
    keys.push(k);
    values.set(k, d.value);
  }
  keys.sort(); // default sort: UTF-16 code unit order
  const parts = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    path.push(k);
    parts[i] = `${JSON.stringify(k)}:${encode(values.get(k), path, seen)}`;
    path.pop();
  }
  return `{${parts.join(',')}}`;
}

function encode(v, path, seen) {
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) fail(path, 'non-finite number');
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'object':
      break;
    default: // undefined, function, symbol, bigint
      fail(path, `unsupported type ${typeof v}`);
  }
  if (v === null) return 'null';
  if (types.isProxy(v)) fail(path, 'proxy');
  if (path.length >= MAX_DEPTH) fail(path, `nesting deeper than ${MAX_DEPTH}`);
  if (seen.has(v)) fail(path, 'cycle');
  seen.add(v);
  try {
    return Array.isArray(v) ? encodeArray(v, path, seen) : encodeObject(v, path, seen);
  } finally {
    seen.delete(v);
  }
}

/** Canonical JSON text of a JSON-safe value. Throws CanonicalJsonError otherwise. */
export function canonicalJson(value) {
  return encode(value, [], new Set());
}

/**
 * Lower-case hex sha256 of a string (UTF-8) or bytes. A string that is not
 * well-formed UTF-16 (lone surrogate) is refused: its UTF-8 encoding would be
 * lossy and two different strings could hash the same.
 */
export function sha256Hex(data) {
  if (typeof data === 'string') {
    if (!data.isWellFormed()) throw new TypeError('sha256Hex: string is not well-formed UTF-16');
  } else if (!(data instanceof Uint8Array)) {
    throw new TypeError('sha256Hex: expected a string or bytes');
  }
  return crypto.createHash('sha256').update(data).digest('hex');
}
