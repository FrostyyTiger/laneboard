// Fleet keys: "<builderId>/<localName>".
//
// This file has two byte-identical copies: server/fleet/keys.mjs (node) and
// public/js/core/keys.js (browser). Edit both together; test/keys.test.mjs
// asserts the copies are identical and behave the same on a shared vector table.
// Pure ES module: no imports, no globals beyond the language.

export const BUILDER_ID_RX = /^[a-z0-9-]{1,24}$/;
export const SEP = '/';

const CODE_RX = /^[A-Z0-9]{2,3}$/;

function isBuilderId(id) {
  return typeof id === 'string' && BUILDER_ID_RX.test(id);
}

// fkey('builder-a', 'web') -> 'builder-a/web'
export function fkey(builderId, name) {
  if (!isBuilderId(builderId)) throw new TypeError('fkey: invalid builder id');
  if (typeof name !== 'string' || name === '') throw new TypeError('fkey: name must be a non-empty string');
  return builderId + SEP + name;
}

// Splits at the FIRST '/', so local names may themselves contain '/'.
export function parseFkey(k) {
  if (typeof k !== 'string') return null;
  const i = k.indexOf(SEP);
  if (i < 1) return null;
  const builder = k.slice(0, i);
  const name = k.slice(i + 1);
  if (!BUILDER_ID_RX.test(builder) || name === '') return null;
  return { builder, name };
}

export function isFkey(k) {
  return parseFkey(k) !== null;
}

// The local name if k belongs to builderId, else null.
export function localKey(k, builderId) {
  const p = parseFkey(k);
  return p !== null && p.builder === builderId ? p.name : null;
}

export function laneNodeId(builderId, laneId) {
  return `lane:${fkey(builderId, laneId)}`;
}

// Any string -> a valid builder id ('' -> 'builder').
export function sanitizeId(s) {
  const id = String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  return id === '' ? 'builder' : id;
}

// Short UI code for a builder id: 'builder-a' -> 'BA', 'ci-2' -> 'C2', 'hub' -> 'HU'.
// Multi-part ids take the first character of up to three parts; a single-part
// id takes its first two characters. Always matches /^[A-Z0-9]{2,3}$/.
export function deriveCode(id) {
  const parts = sanitizeId(id).split('-').filter(Boolean);
  let code = parts.length > 1
    ? parts.slice(0, 3).map((p) => p[0]).join('')
    : parts[0].slice(0, 2);
  if (code.length < 2) code = (code + parts.join('').slice(1) + '0').slice(0, 2);
  code = code.toUpperCase();
  return CODE_RX.test(code) ? code : 'BU';
}
