// Package auto-detect (fleet §6.3, P3). Pure: the caller hands in the file list of
// `git ls-tree -r --name-only <mainRef>` and a `readFile(path)` that returns the
// file's text at that ref (`git show <mainRef>:<path>`), or null when it is missing.
//
// Rules, applied in order, deduped by path:
//   1. root package.json `workspaces` (array or {packages:[]})          kind 'npm'
//   2. root pyproject.toml [tool.setuptools.packages.find] include/where,
//      [tool.setuptools] packages = [...], [tool.poetry] packages        kind 'python'
//   3. root Cargo.toml [workspace] members (minus exclude)               kind 'cargo'
//   4. a depth-1 dir with its own package.json / pyproject.toml / Cargo.toml
//      (a sub-dir Cargo workspace lists its members as `parts`)
//   5. a depth-1 dir with its own CLAUDE.md not covered by 1-4           kind 'claude'
//   (6. `_other`, every file in no package, is computed in rows.mjs.)
// Overlaps are allowed. Name collisions get the parent dir appended (`app-desktop`).
//
// Everything read here comes from a repo branch, so it is untrusted: sizes and
// counts are capped, bad JSON/TOML is skipped, dir names are glob-escaped.

import { compileGlob, matchAny } from './glob.mjs';

const MAX_MANIFEST = 1024 * 1024;   // bytes; larger manifests are ignored
const MAX_ENTRIES = 256;            // workspace/include/member entries per manifest
const MAX_PACKAGES = 500;
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', 'vendor', '__pycache__']);

const MANIFESTS = [['package.json', 'npm'], ['pyproject.toml', 'python'], ['Cargo.toml', 'cargo']];

// ---------------------------------------------------------------- helpers

/** Escape glob metacharacters in a literal path segment (see glob.mjs syntax). */
export function escapeGlob(s) {
  return String(s).replace(/[\\*?{}!,[\]]/g, (c) => '\\' + c);
}

function base(dir) {
  const i = dir.lastIndexOf('/');
  return i < 0 ? dir : dir.slice(i + 1);
}

function parent(dir) {
  const i = dir.lastIndexOf('/');
  return i < 0 ? '' : dir.slice(0, i);
}

function joinDir(where, d) {
  const w = normDir(where);
  return w ? `${w}/${d}` : d;
}

function normDir(p) {
  let s = String(p ?? '').replace(/\\/g, '/').trim();
  while (s.startsWith('./')) s = s.slice(2);
  if (s === '.') s = '';
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

function skippable(dir) {
  return dir.split('/').some((seg) => seg.startsWith('.') || SKIP_DIRS.has(seg));
}

function safeRead(readFile, p) {
  let txt;
  try { txt = readFile(p); } catch { return null; }
  if (txt == null) return null;
  if (typeof txt !== 'string') txt = Buffer.isBuffer(txt) ? txt.toString('utf8') : String(txt);
  if (txt.length > MAX_MANIFEST) return null;
  return txt;
}

function safeGlob(g) {
  try { compileGlob(g); return true; } catch { return false; }
}

/** Index the tree: the file set and every directory that holds a file. */
export function indexTree(tree) {
  const files = new Set();
  const dirs = new Set();
  for (const raw of Array.isArray(tree) ? tree : []) {
    if (typeof raw !== 'string' || !raw) continue;
    const f = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!f || f.endsWith('/')) continue;
    files.add(f);
    let d = parent(f);
    while (d && !dirs.has(d)) { dirs.add(d); d = parent(d); }
  }
  return { files, dirs };
}

// Directories (relative to `root`) matching an ordered glob list with `!` excludes,
// optionally required to contain `marker`. Results keep tree order, sorted.
function expandDirs(idx, globs, { root = '', marker = null } = {}) {
  const list = globs
    .filter((g) => typeof g === 'string')
    .map((g) => {
      const neg = g.startsWith('!');
      let b = normDir(neg ? g.slice(1) : g);
      if (marker && b.endsWith('/' + marker)) b = b.slice(0, -marker.length - 1);
      if (!b) return null;
      return (neg ? '!' : '') + (root ? `${escapeGlob(root)}/${b}` : b);
    })
    .filter((g) => g && safeGlob(g));
  if (!list.some((g) => !g.startsWith('!'))) return [];
  const candidates = [];
  for (const d of [...idx.dirs].sort()) {
    if (root && !d.startsWith(root + '/')) continue;
    if (skippable(root ? d.slice(root.length + 1) : d)) continue;
    if (marker && !idx.files.has(`${d}/${marker}`)) continue;
    if (matchAny(list, d)) candidates.push(d);
  }
  // Keep the manifest's entry order (first entry's dirs first, each sorted).
  const out = [];
  const seen = new Set();
  for (const g of list) {
    if (g.startsWith('!')) continue;
    for (const d of candidates) {
      if (!seen.has(d) && matchAny([g], d)) { seen.add(d); out.push(d); }
    }
  }
  return out;
}

// ---------------------------------------------------------------- minimal TOML

// Strip a `#` comment that is not inside a string.
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') { i++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

const HEADER = /^\s*\[\[?\s*([A-Za-z0-9_\-."' ]+?)\s*\]\]?\s*$/;

/** Body text of the `[name]` table (comments stripped), or null. */
export function tomlSection(text, name) {
  const lines = String(text).split(/\r?\n/).map(stripComment);
  let out = null;
  let depth = 0; // bracket depth of a multi-line value, so `[` lines inside it are not headers
  for (const line of lines) {
    const m = depth === 0 ? HEADER.exec(line) : null;
    if (m) {
      if (out !== null) break;
      const key = m[1].replace(/["']/g, '').replace(/\s+/g, '');
      if (key === name && !line.trim().startsWith('[[')) out = [];
      continue;
    }
    if (out !== null) out.push(line);
    depth = Math.max(0, depth + bracketDelta(line));
  }
  return out === null ? null : out.join('\n');
}

function bracketDelta(line) {
  let d = 0, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') { i++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

// The raw text of the bracket-balanced value starting at s[i] ('[' or '{').
function balanced(s, i) {
  const open = s[i], close = open === '[' ? ']' : '}';
  let depth = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === '\\' && q === '"') { j++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === close ? s.slice(i, j + 1) : null;
    }
  }
  return null;
}

/** Raw text of `key = [ ... ]` or `key = { ... }` in a section body, or null. */
export function tomlRawValue(body, key) {
  if (body == null) return null;
  const re = new RegExp(`(^|\\n)\\s*["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*=\\s*`, 'g');
  const m = re.exec(body);
  if (!m) return null;
  const i = m.index + m[0].length;
  if (body[i] !== '[' && body[i] !== '{') return null;
  return balanced(body, i);
}

// Quoted strings inside a raw TOML value (basic "..." with escapes, literal '...').
export function tomlStrings(raw) {
  if (raw == null) return [];
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)'/g;
  let m;
  while ((m = re.exec(raw)) && out.length < MAX_ENTRIES) {
    if (m[2] !== undefined) out.push(m[2]);
    else {
      try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); }
    }
  }
  return out;
}

/** Array of strings for `key = [...]` in the section body. */
export function tomlStringArray(body, key) {
  const raw = tomlRawValue(body, key);
  return raw && raw.startsWith('[') ? tomlStrings(raw) : [];
}

// Top-level `{...}` inline tables inside a raw array.
function inlineTables(raw) {
  const out = [];
  for (let i = 1; i < raw.length && out.length < MAX_ENTRIES; i++) {
    const c = raw[i];
    if (c === '"' || c === "'") {
      const end = raw.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;
    } else if (c === '{') {
      const t = balanced(raw, i);
      if (!t) break;
      out.push(t);
      i += t.length - 1;
    }
  }
  return out;
}

function inlineKey(table, key) {
  const m = new RegExp(`(?:^|[{,\\s])${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')`).exec(table);
  return m ? tomlStrings(m[1])[0] ?? null : null;
}

// ---------------------------------------------------------------- rules

function ruleNpm(idx, readFile, add) {
  if (!idx.files.has('package.json')) return;
  const txt = safeRead(readFile, 'package.json');
  if (!txt) return;
  let pkg;
  try { pkg = JSON.parse(txt); } catch { return; }
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces
    : Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : [];
  const globs = ws.slice(0, MAX_ENTRIES);
  for (const d of expandDirs(idx, globs, { marker: 'package.json' })) add(d, 'npm');
}

function hasPython(idx, dir) {
  const pre = dir + '/';
  for (const f of idx.files) if (f.startsWith(pre) && f.endsWith('.py')) return true;
  return false;
}

// A setuptools include pattern (`core*`, `core.*`, `acme.api`) applies to the
// dotted package name; only its first component picks the top-level dir.
function topPattern(p) {
  const s = String(p).trim();
  const first = s.split('.')[0];
  return first || null;
}

function rulePython(idx, readFile, add) {
  if (!idx.files.has('pyproject.toml')) return;
  const txt = safeRead(readFile, 'pyproject.toml');
  if (!txt) return;

  // [tool.setuptools.packages.find]
  const find = tomlSection(txt, 'tool.setuptools.packages.find');
  if (find !== null) {
    let where = tomlStringArray(find, 'where').map(normDir);
    if (!where.length) where = [''];
    const include = tomlStringArray(find, 'include').map(topPattern).filter(Boolean);
    const exclude = tomlStringArray(find, 'exclude').map(topPattern).filter(Boolean);
    const inc = include.length ? include : ['*'];
    const globs = [...inc, ...exclude.map((e) => '!' + e)].filter(safeGlob);
    for (const w of where.slice(0, MAX_ENTRIES)) {
      if (w && (!idx.dirs.has(w) || skippable(w))) continue;
      for (const d of [...idx.dirs].sort()) {
        if (parent(d) !== w) continue;
        const name = base(d);
        if (skippable(name) || name === 'tests' && !include.length) continue;
        if (!matchAny(globs, name)) continue;
        if (!hasPython(idx, d)) continue;
        add(d, 'python');
      }
    }
  }

  // [tool.setuptools] packages = ["a", "b.c"]   (explicit list)
  const st = tomlSection(txt, 'tool.setuptools');
  if (st !== null) {
    const raw = tomlRawValue(st, 'packages');
    if (raw && raw.startsWith('[')) {
      const dirMap = tomlSection(txt, 'tool.setuptools.package-dir');
      const m = dirMap !== null ? /(?:^|\n)\s*(?:""|'')\s*=\s*("[^"\n]*"|'[^'\n]*')/.exec(dirMap) : null;
      const rootDir = m ? normDir(tomlStrings(m[1])[0] ?? '') : '';
      for (const p of tomlStrings(raw)) {
        const top = topPattern(p);
        if (!top) continue;
        const d = joinDir(rootDir, top);
        if (idx.dirs.has(d) && !skippable(d)) add(d, 'python');
      }
    }
  }

  // [tool.poetry] packages = [{include = "x"}, {include = "y", from = "src"}]
  const poetry = tomlSection(txt, 'tool.poetry');
  if (poetry !== null) {
    const raw = tomlRawValue(poetry, 'packages');
    if (raw && raw.startsWith('[')) {
      for (const t of inlineTables(raw)) {
        const inc = inlineKey(t, 'include');
        if (!inc) continue;
        const from = normDir(inlineKey(t, 'from') ?? '');
        const target = normDir(inc);
        if (!target) continue;
        if (/[*?{[]/.test(target)) {
          const globs = [target].filter(safeGlob);
          if (!globs.length) continue;
          for (const d of [...idx.dirs].sort()) {
            if (parent(d) !== from) continue;
            if (!skippable(base(d)) && matchAny(globs, base(d))) add(d, 'python');
          }
        } else {
          const d = joinDir(from, target);
          if (idx.dirs.has(d) && !skippable(d)) add(d, 'python');
          else if (idx.files.has(d)) add(d, 'python', { file: true });
        }
      }
    }
  }
}

function cargoMembers(idx, readFile, root) {
  const p = root ? `${root}/Cargo.toml` : 'Cargo.toml';
  if (!idx.files.has(p)) return null;
  const txt = safeRead(readFile, p);
  if (!txt) return null;
  const ws = tomlSection(txt, 'workspace');
  if (ws === null) return null;
  const members = tomlStringArray(ws, 'members');
  const exclude = tomlStringArray(ws, 'exclude');
  const globs = [...members, ...exclude.map((e) => '!' + normDir(e))];
  return expandDirs(idx, globs, { root, marker: 'Cargo.toml' });
}

function ruleCargo(idx, readFile, add) {
  for (const d of cargoMembers(idx, readFile, '') ?? []) add(d, 'cargo');
}

function depth1(idx) {
  return [...idx.dirs].filter((d) => !d.includes('/') && !skippable(d)).sort();
}

function ruleManifestDirs(idx, readFile, add) {
  for (const d of depth1(idx)) {
    const hit = MANIFESTS.find(([m]) => idx.files.has(`${d}/${m}`));
    if (!hit) continue;
    let parts;
    if (idx.files.has(`${d}/Cargo.toml`)) {
      const members = cargoMembers(idx, readFile, d);
      if (members && members.length) parts = members.map((m) => m.slice(d.length + 1));
    }
    add(d, hit[1], parts ? { parts } : undefined);
  }
}

function ruleClaudeDirs(idx, add, covered) {
  for (const d of depth1(idx)) {
    if (!idx.files.has(`${d}/CLAUDE.md`)) continue;
    if (covered(d)) continue;
    add(d, 'claude');
  }
}

// ---------------------------------------------------------------- main

/**
 * Detect packages in a tree.
 * @param {string[]} tree  repo-relative file paths (`git ls-tree -r --name-only`)
 * @param {(path:string)=>string|null} readFile  file text at the same ref
 * @returns {{name:string, paths:string[], source:'auto', kind:string, parts?:string[]}[]}
 */
export function detectPackages(tree, readFile) {
  const idx = indexTree(tree);
  const read = typeof readFile === 'function' ? readFile : () => null;
  const found = [];          // {dir, kind, paths, parts?}
  const byPath = new Set();  // dedupe key: the joined paths

  const add = (dir, kind, opts = {}) => {
    if (found.length >= MAX_PACKAGES) return;
    const d = normDir(dir);
    if (!d) return;
    const paths = [opts.file ? escapeGlob(d) : `${escapeGlob(d)}/**`];
    const key = paths.join('\n');
    if (byPath.has(key)) return;
    byPath.add(key);
    const entry = { dir: d, kind, paths };
    if (opts.parts) entry.parts = opts.parts;
    found.push(entry);
  };
  const covered = (dir) => found.some((p) => p.dir === dir
    || p.dir.startsWith(dir + '/') || dir.startsWith(p.dir + '/'));

  ruleNpm(idx, read, add);
  rulePython(idx, read, add);
  ruleCargo(idx, read, add);
  ruleManifestDirs(idx, read, add);
  ruleClaudeDirs(idx, add, covered);

  // Names: the dir's basename (a `.py` file target drops its extension); a later
  // package whose name is taken gets its parent dir appended, then a counter.
  const used = new Set();
  return found.map((p) => {
    let name = base(p.dir);
    if (p.paths[0] && !p.paths[0].endsWith('/**')) name = name.replace(/\.py$/, '');
    if (used.has(name)) {
      const par = base(parent(p.dir));
      if (par && !used.has(`${name}-${par}`)) name = `${name}-${par}`;
      else {
        let n = 2;
        while (used.has(`${name}-${n}`)) n++;
        name = `${name}-${n}`;
      }
    }
    used.add(name);
    const out = { name, paths: p.paths, source: 'auto', kind: p.kind };
    if (p.parts) out.parts = p.parts;
    return out;
  });
}

/**
 * The files `detectPackages` may read for this tree, so an async caller can fetch
 * them (`git show`) up front and hand in a sync reader over the results.
 */
export function manifestPaths(tree) {
  const idx = indexTree(tree);
  const out = MANIFESTS.map(([m]) => m).filter((m) => idx.files.has(m));
  for (const d of depth1(idx)) {
    if (idx.files.has(`${d}/Cargo.toml`)) out.push(`${d}/Cargo.toml`);
  }
  return out;
}

/** Async variant: `readFile` may return a Promise (e.g. a `git show` wrapper). */
export async function detectPackagesAsync(tree, readFile) {
  const texts = new Map();
  for (const p of manifestPaths(tree)) {
    try { texts.set(p, await readFile(p)); } catch { texts.set(p, null); }
  }
  return detectPackages(tree, (p) => texts.get(p) ?? null);
}

/**
 * A small cache keyed by `(repo, mainSha)`: a repo's packages only change when
 * its main sha does. `get(repo, sha, compute)` returns the cached list or runs
 * `compute()` (sync or async) once and keeps the result.
 */
export function createDetectCache({ max = 64 } = {}) {
  const map = new Map();
  const keyOf = (repo, sha) => `${repo}\0${sha}`;
  return {
    get(repo, sha, compute) {
      const k = keyOf(repo, sha);
      if (map.has(k)) {
        const v = map.get(k);
        map.delete(k); map.set(k, v);
        return v;
      }
      if (typeof compute !== 'function') return undefined;
      const v = compute();
      // Drop older shas of the same repo: only the current main matters.
      for (const old of [...map.keys()]) if (old.startsWith(`${repo}\0`)) map.delete(old);
      map.set(k, v);
      if (v && typeof v.then === 'function') v.catch(() => { if (map.get(k) === v) map.delete(k); });
      while (map.size > max) map.delete(map.keys().next().value);
      return v;
    },
    has(repo, sha) { return map.has(keyOf(repo, sha)); },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}
