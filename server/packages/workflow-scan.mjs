// GitHub Actions workflow scanner (fleet §6 2.5, P4).
//
// A minimal, indentation-based reader for the YAML subset workflow files use,
// not a YAML parser. It understands block mappings and sequences, `key: value`,
// inline `[a, b]`, single/double-quoted scalars, `|`/`>` block scalars and `#`
// comments outside quotes. Anchors, aliases, merge keys, tags and flow maps are
// not supported: they are skipped and named in `warnings[]`, never thrown.
//
// From the tree it extracts only what the job -> package map needs:
//   {name, file, on:{events, paths, pathsIgnore},
//    jobs:[{id, name, needs, if, prOnly, workingDirs, gates:[{job, output}],
//           stepGates:[{step, output}], filters:{out:[globs]}, stepFilters:{out:[globs]}}],
//    warnings}
// `filters` are the dorny/paths-filter globs this job exports as job outputs
// (what `needs.<job>.outputs.<out>` in another job refers to); `stepFilters`
// are every dorny filter of this job's steps, keyed by filter name; `stepGates`
// are the `steps.<id>.outputs.<out>` references in this job's step `if:`s.
//
// Workflow text comes from the repo's main ref through `readWorkflows` (git
// ls-tree + git show, cached by sha); the working tree is never read.

const MAX_TEXT = 512 * 1024;
const MAX_LINES = 20000;
const MAX_DEPTH = 64;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- line model --------------------------------------------------------------

/**
 * Strip a `#` comment outside quotes. A quote opens a quoted scalar only where
 * a scalar can start (line start, after `:`/`-`/`[`/`{`/`,`/`?` and spaces), so
 * an apostrophe inside a plain word (`don't`) does not.
 */
export function stripComment(s) {
  let q = null;
  let prev = ''; // previous non-space char outside quotes ('' = start)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c === "'") { if (s[i + 1] === "'") { i++; continue; } q = null; prev = c; }
      continue;
    }
    if (q === '"') {
      if (c === '\\') { i++; continue; }
      if (c === '"') { q = null; prev = c; }
      continue;
    }
    if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) return s.slice(0, i).replace(/\s+$/, '');
    if ((c === "'" || c === '"') && (prev === '' || ':-[{,?'.includes(prev))) { q = c; continue; }
    if (c !== ' ' && c !== '\t') prev = c;
  }
  return s.replace(/\s+$/, '');
}

function toLines(text, warn) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (raw.length > MAX_LINES) { warn(`truncated at ${MAX_LINES} lines`); raw.length = MAX_LINES; }
  return raw.map((r, n) => {
    const m = /^[ \t]*/.exec(r)[0];
    if (m.includes('\t')) warn(`line ${n + 1}: tab indentation`);
    return { n: n + 1, raw: r, indent: m.replace(/\t/g, '  ').length, text: null };
  });
}

// The comment-stripped content of a line (lazily: block scalars keep raw text).
function content(line) {
  if (line.text === null) line.text = stripComment(line.raw.slice(/^[ \t]*/.exec(line.raw)[0].length));
  return line.text;
}

function isBlank(line) {
  const t = content(line);
  return t === '' || t === '---' || t === '...' || t.startsWith('%');
}

// --- scalars -----------------------------------------------------------------

function unquote(s, warn) {
  const t = s.trim();
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/' }[c] ?? c));
  }
  return stripProps(t, warn);
}

// Drop `!!tag` and `&anchor` prefixes; an alias `*x` has no value here.
function stripProps(t, warn) {
  let s = t;
  for (;;) {
    const m = /^(!!?[\w-]*|&[\w-]+)(\s+|$)/.exec(s);
    if (!m) break;
    if (m[1][0] === '&') warn(`anchor ${m[1]} ignored`);
    s = s.slice(m[0].length);
  }
  if (/^\*[\w-]+$/.test(s)) { warn(`alias ${s} unsupported`); return null; }
  return s;
}

// Split on top-level commas, respecting quotes and brackets.
function splitFlow(inner) {
  const out = [];
  let q = null, depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(inner.slice(start, i)); start = i + 1; }
  }
  out.push(inner.slice(start));
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function scalar(v, warn) {
  const t = v.trim();
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) { warn('unterminated flow sequence'); return t; }
    return splitFlow(t.slice(1, -1)).map((x) => {
      if (x.startsWith('[') || x.startsWith('{')) { warn('nested flow collection ignored'); return null; }
      return unquote(x, warn);
    }).filter((x) => x !== null);
  }
  if (t.startsWith('{')) { warn('flow mapping unsupported'); return t; }
  return unquote(t, warn);
}

// `key: rest` -> {key, rest} or null. Keys may be quoted.
function splitKey(t) {
  let m = /^'((?:[^']|'')*)'\s*:(?:\s+|$)(.*)$/.exec(t);
  if (m) return { key: m[1].replace(/''/g, "'"), rest: m[2] };
  m = /^"((?:[^"\\]|\\.)*)"\s*:(?:\s+|$)(.*)$/.exec(t);
  if (m) return { key: m[1], rest: m[2] };
  m = /^([^\s'"\[\]{}#&*!|>%@`,-][^:]*?|-[^\s:][^:]*?|\?[^:]*?)\s*:(?:\s+|$)(.*)$/.exec(t);
  if (m) return { key: m[1], rest: m[2] };
  return null;
}

const isSeqItem = (t) => t === '-' || t.startsWith('- ');

// --- tree builder ------------------------------------------------------------

function makeParser(lines, warn) {
  let i = 0;
  const skip = () => { while (i < lines.length && isBlank(lines[i])) i++; };

  function blockScalar(header, parentIndent) {
    const fold = header[0] === '>';
    const chomp = /-/.test(header) ? 'strip' : /\+/.test(header) ? 'keep' : 'clip';
    const body = [];
    while (i < lines.length) {
      const l = lines[i];
      const blank = l.raw.trim() === '';
      if (!blank && l.indent <= parentIndent) break;
      body.push(l);
      i++;
    }
    const ind = Math.min(...body.filter((l) => l.raw.trim() !== '').map((l) => l.indent), Infinity);
    let rows = body.map((l) => (l.raw.trim() === '' ? '' : l.raw.replace(/\t/g, '  ').slice(Number.isFinite(ind) ? ind : 0)));
    let s;
    if (fold) {
      s = '';
      for (const r of rows) s += r === '' ? '\n' : (s && !s.endsWith('\n') ? ' ' : '') + r;
    } else s = rows.join('\n');
    if (chomp === 'strip') s = s.replace(/\n+$/, '');
    else if (chomp === 'clip') s = s.replace(/\n+$/, '') + (s ? '\n' : '');
    else s += '\n';
    return s;
  }

  // Plain or quoted scalar continued on more-indented lines.
  function continued(first, parentIndent) {
    let s = first;
    const quoted = /^\s*['"]/.test(first) && !/^\s*(['"]).*\1\s*$/.test(first);
    while (i < lines.length) {
      const l = lines[i];
      if (l.raw.trim() === '') { i++; continue; }
      if (l.indent <= parentIndent) break;
      const t = quoted ? l.raw.trim() : content(l);
      if (!quoted && (splitKey(t) || isSeqItem(t))) break;
      s += ' ' + t;
      i++;
    }
    return s;
  }

  function value(rest, parentIndent, depth) {
    const r = rest.trim();
    if (r === '') {
      skip();
      if (i >= lines.length) return null;
      const l = lines[i];
      if (l.indent > parentIndent) return node(l.indent, depth + 1);
      if (l.indent === parentIndent && isSeqItem(content(l))) return seq(l.indent, depth + 1);
      return null;
    }
    if (/^[|>][-+0-9]*$/.test(r)) return blockScalar(r, parentIndent);
    if (/^(&[\w-]+|!!?[\w-]*)$/.test(r)) { stripProps(r, warn); return value('', parentIndent, depth); }
    return scalar(continued(r, parentIndent), warn);
  }

  function map(indent, depth) {
    const out = {};
    while (i < lines.length) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent !== indent) break;
      const t = content(l);
      if (isSeqItem(t)) break;
      const kv = splitKey(t);
      if (!kv) { warn(`line ${l.n}: not a key`); i++; continue; }
      i++;
      let key = kv.key.trim();
      if (key === '<<') { warn(`line ${l.n}: merge key unsupported`); value(kv.rest, indent, depth); continue; }
      if (key.startsWith('? ')) { warn(`line ${l.n}: complex key unsupported`); value(kv.rest, indent, depth); continue; }
      const v = value(kv.rest, indent, depth);
      if (BAD_KEYS.has(key)) { warn(`line ${l.n}: key ${key} ignored`); continue; }
      out[key] = v;
    }
    return out;
  }

  function seq(indent, depth) {
    const out = [];
    while (i < lines.length) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent !== indent) break;
      const t = content(l);
      if (!isSeqItem(t)) break;
      const rest = t === '-' ? '' : t.slice(2);
      const lead = rest.length - rest.trimStart().length;
      const r = rest.trim();
      if (r === '') { i++; out.push(value('', indent, depth)); continue; }
      if (isSeqItem(r) || splitKey(r)) {
        // `- key: v` / `- - x`: re-read the same line as a nested node at the item's column.
        l.indent = indent + 2 + lead;
        l.text = r;
        out.push(node(l.indent, depth + 1));
        continue;
      }
      i++;
      out.push(value(r, indent + 1, depth));
    }
    return out;
  }

  function node(indent, depth = 0) {
    if (depth > MAX_DEPTH) { warn('nesting too deep'); while (i < lines.length && (isBlank(lines[i]) || lines[i].indent >= indent)) i++; return null; }
    skip();
    if (i >= lines.length) return null;
    const t = content(lines[i]);
    if (isSeqItem(t)) return seq(indent, depth);
    if (splitKey(t)) return map(indent, depth);
    const l = lines[i++];
    return scalar(continued(t, l.indent - 1), warn);
  }

  return {
    root() {
      skip();
      if (i >= lines.length) return null;
      const v = node(lines[i].indent);
      skip();
      if (i < lines.length) warn(`line ${lines[i].n}: unparsed content after the top level`);
      return v;
    },
  };
}

/** Read the YAML subset into plain values (objects, arrays, strings, null). */
export function readYaml(text, warnings = []) {
  const warn = (w) => { if (warnings.length < 50 && !warnings.includes(w)) warnings.push(w); };
  let src = String(text ?? '');
  if (src.length > MAX_TEXT) { warn(`truncated at ${MAX_TEXT} bytes`); src = src.slice(0, MAX_TEXT); }
  return makeParser(toLines(src, warn), warn).root();
}

// --- extraction --------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(str).filter(Boolean);
const uniq = (a) => [...new Set(a)];

/** Strip one `${{ … }}` wrapper from a whole-expression `if:`. */
function expr(v) {
  const s = str(v).trim();
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
  return m ? m[1].trim() : s;
}

function onBlock(on) {
  const events = [];
  const paths = [], pathsIgnore = [];
  if (typeof on === 'string') events.push(on);
  else if (Array.isArray(on)) events.push(...list(on));
  else if (isObj(on)) {
    for (const [ev, cfg] of Object.entries(on)) {
      events.push(ev);
      paths.push(...list(own(cfg, 'paths')));
      pathsIgnore.push(...list(own(cfg, 'paths-ignore')));
    }
  }
  return { events: uniq(events), paths: uniq(paths), pathsIgnore: uniq(pathsIgnore) };
}

const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);
const PR_IF = /github\.event_name\s*==\s*['"]pull_request(?:_target)?['"]/;
const NEEDS_OUT = /needs\.([\w-]+)\.outputs\.([\w-]+)/g;
const STEPS_OUT = /steps\.([\w-]+)\.outputs\.([\w-]+)/g;
const DORNY = /^dorny\/paths-filter@/i;

function refs(re, s) {
  const out = [];
  for (const m of str(s).matchAll(re)) out.push([m[1], m[2]]);
  return out;
}

/** dorny `filters:` text -> {out: [globs]}. Items may be `glob` or `{added|modified|…: glob}`. */
export function parseFilters(text, warn = () => {}) {
  const out = {};
  const t = str(text);
  if (!t.includes('\n') && /\.ya?ml$/i.test(t.trim())) { warn(`filters from file ${t.trim()} not read`); return out; }
  const w = [];
  const tree = readYaml(t, w);
  for (const x of w) warn(`filters: ${x}`);
  if (!isObj(tree)) return out;
  for (const [name, v] of Object.entries(tree)) {
    const globs = [];
    const add = (item) => {
      if (typeof item === 'string') globs.push(item);
      else if (Array.isArray(item)) item.forEach(add);
      else if (isObj(item)) Object.values(item).forEach(add);
    };
    add(v);
    out[name] = uniq(globs.filter(Boolean));
  }
  return out;
}

// `${{ matrix.k }}` in a working directory -> each value of the matrix list `k`.
function expandMatrix(dir, matrix) {
  const m = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}(.*)$/.exec(dir) || /^(.*?)\$\{\{\s*matrix\.([\w-]+)\s*\}\}(.*)$/.exec(dir);
  if (!dir.includes('${{')) return [dir];
  if (!m) return [];
  const [pre, key, post] = m.length === 3 ? ['', m[1], m[2]] : [m[1], m[2], m[3]];
  const vals = own(matrix, key);
  if (!Array.isArray(vals)) return [];
  return vals.filter((v) => typeof v === 'string' && !v.includes('${{')).map((v) => pre + v + post);
}

function normDir(d) {
  let s = str(d).trim().replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s === '.' ? '' : s;
}

function scanJob(id, job, wf, warn) {
  const steps = Array.isArray(own(job, 'steps')) ? own(job, 'steps').filter(isObj) : [];
  const ifExpr = own(job, 'if') == null ? null : expr(own(job, 'if'));
  const matrix = own(own(job, 'strategy'), 'matrix');

  const dirs = [];
  const pushDir = (d) => { if (typeof d === 'string') for (const x of expandMatrix(d.trim(), matrix)) dirs.push(normDir(x)); };
  pushDir(own(own(own(job, 'defaults'), 'run'), 'working-directory'));
  pushDir(own(own(own(wf, 'defaults'), 'run'), 'working-directory'));
  for (const s of steps) {
    pushDir(own(s, 'working-directory'));
    pushDir(own(own(s, 'with'), 'working-directory'));
  }

  const gates = [];
  const stepGates = [];
  const seen = new Set();
  const addGate = (arr, a, b, kA, kB) => {
    const k = `${kA}:${a}.${b}`;
    if (!seen.has(k)) { seen.add(k); arr.push({ [kA]: a, [kB]: b }); }
  };
  const ifs = [ifExpr, ...steps.map((s) => own(s, 'if'))];
  for (const s of ifs) {
    for (const [j, o] of refs(NEEDS_OUT, s)) addGate(gates, j, o, 'job', 'output');
  }
  for (const s of steps) {
    for (const [st, o] of refs(STEPS_OUT, own(s, 'if'))) addGate(stepGates, st, o, 'step', 'output');
  }

  const byStep = {};
  const stepFilters = {};
  for (const s of steps) {
    if (!DORNY.test(str(own(s, 'uses')))) continue;
    const f = parseFilters(own(own(s, 'with'), 'filters'), warn);
    const sid = str(own(s, 'id'));
    if (sid && !BAD_KEYS.has(sid)) byStep[sid] = f;
    for (const [k, g] of Object.entries(f)) stepFilters[k] = uniq([...(stepFilters[k] || []), ...g]);
  }
  const filters = {};
  const outputs = own(job, 'outputs');
  if (isObj(outputs)) {
    for (const [out, v] of Object.entries(outputs)) {
      for (const [sid, o] of refs(STEPS_OUT, v)) {
        const g = Object.hasOwn(byStep, sid) && Object.hasOwn(byStep[sid], o) ? byStep[sid][o] : null;
        if (g) filters[out] = uniq([...(filters[out] || []), ...g]);
      }
    }
  }

  const name = typeof own(job, 'name') === 'string' && own(job, 'name').trim() ? own(job, 'name').trim() : id;
  const needs = list(own(job, 'needs'));
  return {
    id, name, needs, if: ifExpr,
    prOnly: false, // set by the caller (needs the workflow `on`)
    workingDirs: uniq(dirs.filter(Boolean)),
    gates, stepGates, filters, stepFilters,
    ...(typeof own(job, 'uses') === 'string' ? { uses: own(job, 'uses') } : {}),
  };
}

/**
 * Scan one workflow file. Never throws; anything it cannot read lands in
 * `warnings`. `file` is the basename the job map keys use (`ci.yml`).
 */
export function scanWorkflow(text, file = '') {
  const warnings = [];
  const warn = (w) => { if (warnings.length < 50 && !warnings.includes(w)) warnings.push(w); };
  let tree;
  try {
    tree = readYaml(text, warnings);
  } catch (e) {
    warn(`unreadable: ${String(e?.message || e).slice(0, 120)}`);
    tree = null;
  }
  const wf = isObj(tree) ? tree : {};
  if (!isObj(tree)) warn('not a mapping');
  // YAML 1.1 reads a bare `on` as `true`; workflows mean the key.
  const on = onBlock(own(wf, 'on') ?? own(wf, 'true'));
  const pushes = on.events.includes('push');
  const wfPrOnly = !pushes && on.events.some((e) => PR_EVENTS.has(e));
  const jobs = [];
  const jobsNode = own(wf, 'jobs');
  if (isObj(jobsNode)) {
    for (const [id, job] of Object.entries(jobsNode)) {
      if (!isObj(job)) { warn(`job ${id}: not a mapping`); continue; }
      const j = scanJob(id, job, wf, warn);
      j.prOnly = wfPrOnly || (j.if != null && PR_IF.test(j.if));
      jobs.push(j);
    }
  } else warn('no jobs');
  const name = typeof own(wf, 'name') === 'string' && own(wf, 'name').trim() ? own(wf, 'name').trim() : file;
  return { name, file, on, jobs, warnings };
}

// --- reading from git --------------------------------------------------------

const wfCache = new Map(); // `${repoPath}\0${sha}` -> workflows[]
const WF_CACHE_MAX = 64;

/**
 * Workflows of `ref` (a sha or ref) in the repo at `cwd`, read with git only:
 * `git ls-tree <ref> .github/workflows/` then `git show <ref>:<path>` per file.
 * `run(cmd, args, opts)` is util.mjs#run (injected for tests). Cached by
 * `(cwd, sha)` when `sha` is given. Failure is a value: `[]` plus nothing thrown.
 */
export async function readWorkflows({ cwd, ref, sha = null, run }) {
  const key = sha ? `${cwd}\0${sha}` : null;
  if (key && wfCache.has(key)) return wfCache.get(key);
  const at = sha || ref;
  const ls = await run('git', ['-C', cwd, 'ls-tree', '-z', '--name-only', at, '.github/workflows/'], { timeout: 10000 });
  if (!ls.ok) return [];
  const files = ls.stdout.split('\0').filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 100);
  const out = [];
  for (const p of files) {
    const r = await run('git', ['-C', cwd, 'show', `${at}:${p}`], { timeout: 10000, maxBuffer: 2 * MAX_TEXT });
    if (!r.ok) continue;
    out.push(scanWorkflow(r.stdout, p.slice(p.lastIndexOf('/') + 1)));
  }
  if (key) {
    if (wfCache.size >= WF_CACHE_MAX) wfCache.delete(wfCache.keys().next().value);
    wfCache.set(key, out);
  }
  return out;
}

/** Tests: forget cached workflows. */
export function _clearCache() { wfCache.clear(); }
