#!/usr/bin/env node
// Every config key a fragment adds is documented in docs/config.md
// (fleet plan §11 X4, README §5 DoD item 6).
//
//   node scripts/check-config-docs.mjs      exit 0, or 1 and the missing keys
//
// What is checked:
//   - every leaf key of every fragment's defaults() in server/config/*.mjs
//     (a plain object with keys is walked; an array, an empty object, null or
//     a scalar is a leaf), e.g. `fleet.placement.maxSwapFrac`;
//   - RUNTIME_KEYS: keys the code reads without a default in any fragment;
//   - every `LANEBOARD_*` env var a fragment's fromEnv() reads.
//
// A key counts as documented when it appears in backticks in docs/config.md,
// exactly, or through a pattern with `<placeholder>` segments such as
// `notify.kinds.<kind>`. A pattern only covers a key when each concrete
// segment it stands for (`danger`) also appears in backticks somewhere in the
// file, so a map-shaped block still has every entry named.
//
// The fragments are imported directly, never through server/config.mjs: that
// module builds the live config at import time, and this check must not
// depend on (or read) a config file.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
export const FRAGMENTS_DIR = path.join(ROOT, 'server', 'config');
export const DOCS_FILE = path.join(ROOT, 'docs', 'config.md');

/**
 * Keys read at run time that no fragment's defaults() declares (the code
 * clamps or defaults them itself). Keep in step with the readers named here.
 */
export const RUNTIME_KEYS = Object.freeze([
  'approvals.maxBodyBytes', // server/routes/approvals.mjs bodyLimitOf
  'approvals.maxInFlight', // server/routes/approvals.mjs maxInFlightOf
  'fleet.placement.any', // server/hub/placement.mjs settings
  'push.allowedEndpointHosts', // server/hub/routes/core.mjs pushHostList
  // server/config/cockpit.mjs: `cockpit.agent` defaults to null; its keys are
  // filled in per kind by finalize when the file has the block.
  'cockpit.agent.kind', 'cockpit.agent.command', 'cockpit.agent.cwd', 'cockpit.agent.user',
  'cockpit.agent.allowSameUser', 'cockpit.agent.allowedTools', 'cockpit.agent.allowUnrestricted',
  'cockpit.agent.env', 'cockpit.agent.loginCheck', 'cockpit.agent.maxTurnsPerHour',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The dotted leaf keys of a defaults object. */
export function leafKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length) out.push(...leafKeys(v, key));
    else out.push(key);
  }
  return out;
}

/** Every backticked span in a markdown text. */
export function backticked(text) {
  const spans = new Set();
  for (const m of String(text).matchAll(/`([^`\n]+)`/g)) spans.add(m[1].trim());
  return spans;
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `<placeholder>` patterns among the spans, compiled. */
function patternsOf(spans) {
  const out = [];
  for (const s of spans) {
    if (!/<[^<>\s]+>/.test(s) || /\s/.test(s)) continue;
    const parts = s.split(/(<[^<>\s]+>)/);
    const src = parts.map((p) => (/^<[^<>\s]+>$/.test(p) ? '([^.]+)' : escapeRx(p))).join('');
    out.push(new RegExp(`^${src}$`));
  }
  return out;
}

/** Is `key` documented by `spans` (exactly, or by a pattern whose segments are named too)? */
export function isDocumented(key, spans, patterns = patternsOf(spans)) {
  if (spans.has(key)) return true;
  for (const rx of patterns) {
    const m = rx.exec(key);
    if (m && m.slice(1).every((seg) => spans.has(seg))) return true;
  }
  return false;
}

/** The fragment modules in server/config/, by name. */
export async function loadFragmentModules(dir = FRAGMENTS_DIR) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (typeof mod.defaults !== 'function') continue;
    out.push({ name: path.basename(f, '.mjs'), file: path.join(dir, f), mod });
  }
  return out;
}

/** The LANEBOARD_* names a fragment's source reads from the env. */
export function envVarsOf(source) {
  return [...new Set([...String(source).matchAll(/\benv\.(LANEBOARD_[A-Z0-9_]+)/g)].map((m) => m[1]))];
}

/**
 * -> {missing: [{key, owner}], checked: n}. `fragments` is
 * [{name, defaults(), source?}]; `docs` the text of docs/config.md.
 */
export function checkConfigDocs({ fragments, docs, runtimeKeys = RUNTIME_KEYS }) {
  const spans = backticked(docs);
  const patterns = patternsOf(spans);
  const wanted = [];
  for (const fr of fragments) {
    for (const key of leafKeys(fr.defaults())) wanted.push({ key, owner: `server/config/${fr.name}.mjs` });
    for (const env of envVarsOf(fr.source ?? '')) wanted.push({ key: env, owner: `server/config/${fr.name}.mjs (env)` });
  }
  for (const key of runtimeKeys) wanted.push({ key, owner: 'read at run time' });
  const missing = wanted.filter((w) => !isDocumented(w.key, spans, patterns));
  return { missing, checked: wanted.length };
}

/** The real fragments and docs/config.md. */
export async function checkRepo({ dir = FRAGMENTS_DIR, docsFile = DOCS_FILE } = {}) {
  const mods = await loadFragmentModules(dir);
  const fragments = mods.map(({ name, file, mod }) => ({ name, defaults: () => mod.defaults(), source: fs.readFileSync(file, 'utf8') }));
  return checkConfigDocs({ fragments, docs: fs.readFileSync(docsFile, 'utf8') });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { missing, checked } = await checkRepo();
  if (missing.length) {
    process.stderr.write(`docs/config.md is missing ${missing.length} of ${checked} config keys:\n`);
    for (const m of missing) process.stderr.write(`  ${m.key}  (${m.owner})\n`);
    process.exit(1);
  }
  process.stdout.write(`docs/config.md documents all ${checked} fragment keys and env vars\n`);
}
