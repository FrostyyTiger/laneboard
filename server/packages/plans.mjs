// Plan status parsing (fleet plan §6 2.10, P8).
//
// A plan file says where it stands on a status line near its top, e.g.
//
//   **Plan status:** `PARTIAL` (stage 2 of 4 shipped)
//
// `plans.statusLine` is a regular expression whose first capture group is the
// state word (backticks optional in the default); `plans.states` maps state
// names to the words that mean them:
//
//   {open: ['OPEN', …], partial: ['PARTIAL'], done: ['DONE', …], deferred: […]}
//
// `planState(text, cfg.plans)` scans the first 60 lines and returns
// `{word, state}`. A word no state lists becomes `state: 'unknown'` and `word`
// is kept (the view shows it in the tooltip); no status line at all is
// `{word: null, state: 'unknown'}`.
//
// Plan files are listed from the main ref with `git ls-tree -r -z <ref>`
// (which gives each blob's oid), filtered by `plans.globs`, and read with
// `git cat-file blob <oid>`. The parsed word is cached by blob oid, so a
// changed plan costs one read and an unchanged one none. The working tree is
// never read.
//
// Plan -> package: `packages[].plans` globs when configured, else the file
// name's tokens start with the package name's tokens (`web-admin-auth.md` ->
// `web-admin`, longest package name first, as in §2.5), else `null`
// (repo-level only). Stage progress (collector/progress.mjs) is a separate
// signal and is unchanged.
//
// `PLAN-DONE: <TOKEN> <rest>` printed by a lane is an ordinary `done` marker
// (core `markers.done` default); there is no marker machinery here.
import { run as defaultRun } from '../util.mjs';
import { matchAny } from './glob.mjs';
import { tokens } from './jobmap.mjs';
import { DEFAULT_STATUS_LINE, refProblem } from '../config/packages.mjs';

export const SCAN_LINES = 60;
export const MAX_PLAN_FILES = 2000;
export const MAX_PLAN_BYTES = 1024 * 1024;
export const UNKNOWN = 'unknown';
const CACHE_MAX = 5000;
const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_WORD = 64;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

// --- the word -> state table ---------------------------------------------------

const tableCache = new WeakMap(); // states object -> Map(WORD -> state)

/**
 * `{state: [words]}` as a `Map(word -> state)`, words upper-cased. The first
 * state listing a word wins. Cached per `states` object (configs are built
 * once, so this is computed once per process).
 */
export function stateTable(states) {
  if (!isObj(states)) return new Map();
  const hit = tableCache.get(states);
  if (hit) return hit;
  const table = new Map();
  for (const [state, words] of Object.entries(states)) {
    if (state === '__proto__') continue;
    for (const w of arr(words)) {
      if (typeof w !== 'string' || !w) continue;
      const k = w.toUpperCase();
      if (!table.has(k)) table.set(k, state);
    }
  }
  tableCache.set(states, table);
  return table;
}

/** The state names a counts object has: every configured state + unknown. */
export function stateNames(states) {
  const names = isObj(states) ? Object.keys(states).filter((k) => k !== '__proto__' && k !== UNKNOWN) : [];
  return [...names, UNKNOWN];
}

const reCache = new Map(); // source -> RegExp | null
/** The compiled status line, or null when it does not compile. */
export function statusRegex(source = DEFAULT_STATUS_LINE) {
  const src = typeof source === 'string' && source ? source : DEFAULT_STATUS_LINE;
  if (!reCache.has(src)) {
    let re = null;
    try { re = new RegExp(src); } catch { re = null; }
    if (reCache.size > 32) reCache.clear();
    reCache.set(src, re);
  }
  return reCache.get(src);
}

/** The state word of a plan text (first capture group), or null. */
export function statusWord(text, statusLine) {
  if (typeof text !== 'string' || !text) return null;
  const re = statusRegex(statusLine);
  if (!re) return null;
  let start = 0;
  for (let i = 0; i < SCAN_LINES && start <= text.length; i++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    const m = re.exec(line);
    if (m && typeof m[1] === 'string' && m[1].trim()) return m[1].trim().slice(0, MAX_WORD);
    start = end + 1;
  }
  return null;
}

/** Map a word through the states table: `{word, state}`. */
export function stateOf(word, states) {
  if (typeof word !== 'string' || !word) return { word: null, state: UNKNOWN };
  const state = stateTable(states).get(word.toUpperCase());
  return { word, state: state ?? UNKNOWN };
}

/**
 * `{word, state}` for one plan's text. `cfg` is `config.plans`
 * (`{statusLine, states}`); missing pieces fall back to the default line.
 */
export function planState(text, cfg = {}) {
  return stateOf(statusWord(text, cfg?.statusLine), cfg?.states);
}

// --- plan -> package -----------------------------------------------------------

function startsWithSeq(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i < needle.length; i++) if (hay[i] !== needle[i]) return false;
  return true;
}

/**
 * The package a plan file belongs to, or null (repo-level). `packages` are
 * `[{name, plans?: [globs]}]`.
 */
export function planPackage(path, packages) {
  const list = arr(packages).filter((p) => isObj(p) && typeof p.name === 'string' && p.name);
  for (const p of list) {
    if (Array.isArray(p.plans) && p.plans.length && matchAny(p.plans, path)) return p.name;
  }
  const base = String(path).slice(String(path).lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  const fileToks = tokens(base);
  const byLength = list
    .map((p) => ({ name: p.name, toks: tokens(p.name) }))
    .filter((p) => p.toks.length)
    .sort((a, b) => b.toks.length - a.toks.length || b.name.length - a.name.length);
  for (const p of byLength) if (startsWithSeq(fileToks, p.toks)) return p.name;
  return null;
}

// --- reading from git ----------------------------------------------------------

const wordCache = new Map(); // `${oid}\0${statusLine}` -> word|null (insertion-ordered LRU)
let stats = { hits: 0, misses: 0 };
/** Tests: forget cached words. */
export function _clearCache() { wordCache.clear(); stats = { hits: 0, misses: 0 }; }
export function cacheStats() { return { size: wordCache.size, ...stats }; }

function cacheGet(key) {
  if (!wordCache.has(key)) return undefined;
  const v = wordCache.get(key);
  wordCache.delete(key);
  wordCache.set(key, v);
  return v;
}
function cacheSet(key, v) {
  if (wordCache.size >= CACHE_MAX) wordCache.delete(wordCache.keys().next().value);
  wordCache.set(key, v);
}

/** Parse `git ls-tree -r -z <ref>` output into `[{path, oid}]` (blobs only). */
export function parseLsTree(stdout) {
  const out = [];
  for (const rec of String(stdout).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, oid] = rec.slice(0, tab).split(' ');
    if (type !== 'blob' || !OID_RE.test(oid || '')) continue;
    out.push({ path: rec.slice(tab + 1), oid });
  }
  return out;
}

/**
 * Plan files at `ref` in the repo at `dir`: `[{path, oid}]` matching `globs`,
 * at most MAX_PLAN_FILES, sorted by path. `[]` on any git failure.
 */
export async function listPlanFiles(dir, ref, globs, { run = defaultRun, env } = {}) {
  if (refProblem(ref)) return [];
  const g = arr(globs).filter((x) => typeof x === 'string' && x);
  if (!g.length) return [];
  const r = await run('git', ['-C', dir, 'ls-tree', '-r', '-z', ref], { timeout: 10000, maxBuffer: 64 * 1024 * 1024, env });
  if (!r.ok) return [];
  return parseLsTree(r.stdout)
    .filter((f) => matchAny(g, f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, MAX_PLAN_FILES);
}

/**
 * The plans block of a repo snapshot (§2.9):
 *   {counts: {open, partial, done, deferred, unknown}, files: [{path, state, word, pkg|null}]}
 * `repo` is `{dir, packages}` (resolveRepos + detect output); `cfg` is
 * `config.plans`; `ref` the main ref or its sha. Each blob is read once per
 * (oid, statusLine) and then served from the cache.
 */
export async function readPlans(repo, cfg = {}, { ref = 'origin/main', run = defaultRun, env } = {}) {
  const counts = Object.fromEntries(stateNames(cfg?.states).map((k) => [k, 0]));
  const files = [];
  const dir = repo?.dir;
  if (typeof dir !== 'string' || !dir) return { counts, files };
  const statusLine = typeof cfg?.statusLine === 'string' && cfg.statusLine ? cfg.statusLine : DEFAULT_STATUS_LINE;
  const list = await listPlanFiles(dir, ref, cfg?.globs, { run, env });
  for (const f of list) {
    const key = `${f.oid}\0${statusLine}`;
    let word = cacheGet(key);
    if (word === undefined) {
      stats.misses += 1;
      const r = await run('git', ['-C', dir, 'cat-file', 'blob', f.oid], { timeout: 10000, maxBuffer: MAX_PLAN_BYTES, env });
      if (r.ok) {
        word = statusWord(r.stdout, statusLine);
        cacheSet(key, word);
      } else {
        word = null; // not cached: a too-large or unreadable blob is retried next pass
      }
    } else {
      stats.hits += 1;
    }
    const s = stateOf(word, cfg?.states);
    if (!Object.hasOwn(counts, s.state)) counts[s.state] = 0;
    counts[s.state] += 1;
    files.push({ path: f.path, state: s.state, word: s.word, pkg: planPackage(f.path, repo.packages) });
  }
  return { counts, files };
}
