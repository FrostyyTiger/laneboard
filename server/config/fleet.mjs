// Config fragment: this laneboard's fleet identity (docs/fleet/identity.md).
//
//   fleet.id              the builder id, a slug /^[a-z0-9-]{1,24}$/;
//                         default: the sanitized hostname
//   fleet.code            2-3 char UI code /^[A-Z0-9]{2,3}$/; '' derives it
//                         from the id after the merge (finalize)
//   fleet.allowedOrigins  extra exact origins (beyond same-origin) allowed on
//                         WebSocket upgrades and mutating routes; https, or
//                         http on loopback only; never same-site matching
//
// With no `fleet` keys and `mode` unset, behaviour is exactly as before: these
// values are only read by fleet features.
//
// The auth keys (hubKeys, ingressPort, ...) live in server/config/fleet-auth.mjs,
// the hub's builder list in server/config/hub.mjs. Like every fragment, this
// file must not import server/config.mjs.
import os from 'node:os';

import { sanitizeId, deriveCode, BUILDER_ID_RX } from '../fleet/keys.mjs';

export const CODE_RX = /^[A-Z0-9]{2,3}$/;

/** A comma-separated env value as a list, or undefined when unset/empty. */
const list = (v) => (v === undefined || v === null || v === '' ? undefined : String(v).split(',').map((a) => a.trim()).filter(Boolean));
const str = (v) => (v === undefined || v === null || v === '' ? undefined : String(v).trim());

export function defaults() {
  return { fleet: { id: sanitizeId(os.hostname()), code: '', allowedOrigins: [] } };
}

export function fromEnv(env = process.env) {
  const fleet = {};
  const id = str(env.LANEBOARD_FLEET_ID);
  const code = str(env.LANEBOARD_FLEET_CODE);
  const origins = list(env.LANEBOARD_ALLOWED_ORIGINS);
  if (id !== undefined) fleet.id = id;
  if (code !== undefined) fleet.code = code;
  if (origins !== undefined) fleet.allowedOrigins = origins;
  return Object.keys(fleet).length ? { fleet } : {};
}

/** `code ||= deriveCode(id)`, uppercasing a given code. Tolerates wrong types. */
export function finalize(c) {
  const f = c.fleet;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return c;
  if (typeof f.code === 'string' && f.code !== '') f.code = f.code.trim().toUpperCase();
  else if (f.code === '' || f.code === undefined) {
    if (typeof f.id === 'string' && BUILDER_ID_RX.test(f.id)) f.code = deriveCode(f.id);
  }
  return c;
}

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]']);
function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** null when `v` is an acceptable allowed origin, else the reason. */
export function originProblem(v) {
  if (typeof v !== 'string' || v === '') return 'must be a non-empty string';
  let u;
  try { u = new URL(v); } catch { return 'is not a URL'; }
  if (u.origin !== v) return `must be an exact origin (scheme://host[:port], no path or trailing slash), e.g. ${JSON.stringify(u.origin)}`;
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return null;
  return 'must use https (http only on loopback)';
}

export function validate(c, bad) {
  const f = c.fleet;
  if (!f || typeof f !== 'object' || Array.isArray(f)) bad('fleet must be an object');
  if (typeof f.id !== 'string' || !BUILDER_ID_RX.test(f.id)) {
    bad(`fleet.id must match ${BUILDER_ID_RX} (lowercase letters, digits, '-', 1-24 chars), got ${JSON.stringify(f.id)}`);
  }
  if (typeof f.code !== 'string' || !CODE_RX.test(f.code)) {
    bad(`fleet.code must be 2-3 letters or digits (or '' to derive it from fleet.id), got ${JSON.stringify(f.code)}`);
  }
  if (!Array.isArray(f.allowedOrigins)) bad('fleet.allowedOrigins must be a list of origins');
  for (const o of f.allowedOrigins) {
    const why = originProblem(o);
    if (why) bad(`fleet.allowedOrigins entry ${JSON.stringify(o)} ${why}`);
  }
}
