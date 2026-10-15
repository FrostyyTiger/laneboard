// Config fragment: the hub's view of its builders (fleet plan §3 2.2).
//
//   fleet.builders            [{ id, url, code?, directUrl?, account?, repos? }]
//                             the builders this hub connects to; a hub needs
//                             at least one. `id` matches BUILDER_ID_RX and is
//                             unique; `url` is https (http only on a loopback
//                             host, for tests) with no credentials, path,
//                             query or fragment; `code` is 2-3 [A-Z0-9]
//                             (unset: the builder's hello.code once connected,
//                             else deriveCode(id), done by the fleet store);
//                             `directUrl` is the URL a browser uses for that
//                             builder's own UI (http(s), default `url`);
//                             `account` groups builders that share one
//                             subscription (default "default"); `repos` is an
//                             optional placement allowlist of repo names
//                             (builder claims are untrusted).
//   fleet.hubKeyFile          the hub's signing key (default paths.hubKeyFile())
//   fleet.staleMs / downMs    no frame for this long -> stale / down (stale < down)
//   fleet.batchMs             hub->browser delta coalescing window
//   fleet.pingMs              upstream ping cadence
//   fleet.actionTimeoutMs     relayed action timeout
//   fleet.maxTermsPerBuilder  proxied terminals per builder
//   fleet.placement           { minFreeMemMb, maxSwapFrac } placement gates
//
// Env: LANEBOARD_FLEET_BUILDERS as `id=url,id=url` (a scratch hub).
//
// In hub mode the fragment refuses an empty fleet.builders and a null
// fleet.ingressPort (the key itself is server/config/fleet-auth.mjs's). Hub
// fleet.allowedOrigins may not contain any builder url/directUrl origin, so a
// builder page can never drive the hub. Builder mode ignores these keys.
// Like every fragment, this file must not import server/config.mjs.
import os from 'node:os';
import path from 'node:path';

import * as paths from '../fleet/paths.mjs';
import { BUILDER_ID_RX } from '../fleet/keys.mjs';
import { CODE_RX } from './fleet.mjs';

export const MAX_BUILDERS = 64;
export const MAX_REPOS = 200;
const BUILDER_KEYS = new Set(['id', 'url', 'code', 'directUrl', 'account', 'repos']);
// Same rule as server/hub/fleet-store.mjs isRepoName (not imported: a config
// fragment must not pull hub modules into builder mode).
const REPO_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ACCOUNT_RX = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;

export function isRepoName(r) {
  return typeof r === 'string' && REPO_RX.test(r) && !r.includes('..');
}

export function defaults() {
  return {
    fleet: {
      builders: [],
      hubKeyFile: paths.hubKeyFile(),
      staleMs: 15_000,
      downMs: 60_000,
      batchMs: 250,
      pingMs: 5_000,
      actionTimeoutMs: 15_000,
      maxTermsPerBuilder: 8,
      placement: { minFreeMemMb: 4096, maxSwapFrac: 0.5 },
    },
  };
}

/** `id=url,id=url` as builder entries; a malformed entry is kept for validate to name. */
export function parseBuildersEnv(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? { id: s } : { id: s.slice(0, i).trim(), url: s.slice(i + 1).trim() };
  });
}

export function fromEnv(env = process.env) {
  const builders = parseBuildersEnv(env.LANEBOARD_FLEET_BUILDERS);
  return builders ? { fleet: { builders } } : {};
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Uppercase a given code, default directUrl/account, expand `~/` in hubKeyFile. Tolerates wrong types. */
export function finalize(c) {
  const f = c.fleet;
  if (!isPlainObject(f)) return c;
  if (typeof f.hubKeyFile === 'string' && f.hubKeyFile.startsWith('~/')) {
    f.hubKeyFile = path.join(os.homedir(), f.hubKeyFile.slice(2));
  }
  if (Array.isArray(f.builders)) {
    f.builders = f.builders.map((b) => {
      if (!isPlainObject(b)) return b;
      const out = { ...b };
      if (typeof out.code === 'string') out.code = out.code.trim().toUpperCase();
      if (out.directUrl === undefined && typeof out.url === 'string') out.directUrl = out.url;
      if (out.account === undefined) out.account = 'default';
      return out;
    });
  }
  return c;
}

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]']);
function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** [URL, null] when `v` is an acceptable builder url, else [null, reason]. */
export function builderUrlProblem(v) {
  if (typeof v !== 'string' || v === '') return [null, 'must be a non-empty string'];
  let u;
  try { u = new URL(v); } catch { return [null, 'is not a URL']; }
  if (u.username || u.password) return [null, 'must not carry credentials'];
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
    return [null, 'must use https (http only on a loopback host)'];
  }
  if (u.pathname !== '/' || u.search || u.hash || v.includes('?') || v.includes('#')) {
    return [null, `must be scheme://host[:port] with no path, query or fragment, e.g. ${JSON.stringify(u.origin)}`];
  }
  return [u, null];
}

/** [URL, null] when `v` is an acceptable directUrl (http or https, no credentials), else [null, reason]. */
export function directUrlProblem(v) {
  if (typeof v !== 'string' || v === '') return [null, 'must be a non-empty string'];
  let u;
  try { u = new URL(v); } catch { return [null, 'is not a URL']; }
  if (u.username || u.password) return [null, 'must not carry credentials'];
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return [null, 'must use http or https'];
  return [u, null];
}

const posInt = (v) => Number.isSafeInteger(v) && v > 0;

export function validate(c, bad) {
  const f = c.fleet;
  if (!isPlainObject(f)) bad('fleet must be an object');
  const hub = c.mode === 'hub';

  if (!Array.isArray(f.builders)) bad('fleet.builders must be a list of {id, url} entries');
  if (f.builders.length > MAX_BUILDERS) bad(`fleet.builders may list at most ${MAX_BUILDERS} builders`);
  if (hub && f.builders.length === 0) {
    bad('mode "hub" needs at least one entry in fleet.builders (or LANEBOARD_FLEET_BUILDERS=id=url,...)');
  }
  if (hub && (f.ingressPort === null || f.ingressPort === undefined)) {
    bad('mode "hub" needs fleet.ingressPort (the listener tailscale serve targets)');
  }

  const ids = new Set();
  const builderOrigins = new Map();
  f.builders.forEach((b, i) => {
    const at = `fleet.builders[${i}]`;
    if (!isPlainObject(b)) bad(`${at} must be an object {id, url, ...}`);
    for (const k of Object.keys(b)) {
      if (!BUILDER_KEYS.has(k)) bad(`${at} has an unknown key ${JSON.stringify(k)} (allowed: ${[...BUILDER_KEYS].join(', ')})`);
    }
    if (typeof b.id !== 'string' || !BUILDER_ID_RX.test(b.id)) {
      bad(`${at}.id must match ${BUILDER_ID_RX} (lowercase letters, digits, '-', 1-24 chars), got ${JSON.stringify(b.id)}`);
    }
    if (ids.has(b.id)) bad(`${at}.id ${JSON.stringify(b.id)} is used by more than one builder`);
    ids.add(b.id);
    const where = `fleet.builders ${JSON.stringify(b.id)}`;

    const [u, why] = builderUrlProblem(b.url);
    if (why) bad(`${where}: url ${b.url === undefined ? '(missing)' : JSON.stringify(b.url)} ${why}`);
    builderOrigins.set(u.origin, b.id);

    if (b.code !== undefined && (typeof b.code !== 'string' || !CODE_RX.test(b.code))) {
      bad(`${where}: code must be 2-3 letters or digits (or unset), got ${JSON.stringify(b.code)}`);
    }
    if (b.directUrl !== undefined) {
      const [d, dwhy] = directUrlProblem(b.directUrl);
      if (dwhy) bad(`${where}: directUrl ${JSON.stringify(b.directUrl)} ${dwhy}`);
      builderOrigins.set(d.origin, b.id);
    }
    if (b.account !== undefined && (typeof b.account !== 'string' || !ACCOUNT_RX.test(b.account))) {
      bad(`${where}: account must be a short name (letters, digits, space . _ @ -, up to 64), got ${JSON.stringify(b.account)}`);
    }
    if (b.repos !== undefined) {
      if (!Array.isArray(b.repos)) bad(`${where}: repos must be a list of repo names`);
      if (b.repos.length > MAX_REPOS) bad(`${where}: repos may list at most ${MAX_REPOS} names`);
      for (const r of b.repos) {
        if (!isRepoName(r)) bad(`${where}: repos entry ${JSON.stringify(r)} is not a repo name`);
      }
    }
  });

  // A builder origin among the hub's allowed origins would let a builder page
  // (agent-writable) send mutating requests to the hub.
  if (Array.isArray(f.allowedOrigins)) {
    for (const o of f.allowedOrigins) {
      let origin;
      try { origin = new URL(o).origin; } catch { continue; }
      if (builderOrigins.has(origin)) {
        bad(`fleet.allowedOrigins entry ${JSON.stringify(o)} is the origin of builder ${JSON.stringify(builderOrigins.get(origin))}; a hub must never allow a builder origin`);
      }
    }
  }

  if (typeof f.hubKeyFile !== 'string' || !path.isAbsolute(f.hubKeyFile)) {
    bad(`fleet.hubKeyFile must be an absolute path (or start with ~/), got ${JSON.stringify(f.hubKeyFile)}`);
  }
  for (const k of ['staleMs', 'downMs', 'batchMs', 'pingMs', 'actionTimeoutMs', 'maxTermsPerBuilder']) {
    if (!posInt(f[k])) bad(`fleet.${k} must be a positive integer, got ${JSON.stringify(f[k])}`);
  }
  if (f.staleMs >= f.downMs) bad(`fleet.staleMs (${f.staleMs}) must be less than fleet.downMs (${f.downMs})`);

  const p = f.placement;
  if (!isPlainObject(p)) bad('fleet.placement must be an object {minFreeMemMb, maxSwapFrac}');
  if (typeof p.minFreeMemMb !== 'number' || !Number.isFinite(p.minFreeMemMb) || p.minFreeMemMb < 0) {
    bad(`fleet.placement.minFreeMemMb must be a number >= 0, got ${JSON.stringify(p.minFreeMemMb)}`);
  }
  if (typeof p.maxSwapFrac !== 'number' || !(p.maxSwapFrac >= 0 && p.maxSwapFrac <= 1)) {
    bad(`fleet.placement.maxSwapFrac must be a fraction between 0 and 1, got ${JSON.stringify(p.maxSwapFrac)}`);
  }
}
