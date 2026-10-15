// Glob matcher + git pathspec builder for package path globs (fleet §6, P1).
// No dependencies. Paths are repo-relative, '/'-separated, without a leading './'.
//
// Syntax:
//   **      any number of path segments, including zero (`a/**/b` matches `a/b`)
//   *       any run of characters except '/'
//   ?       one character except '/'
//   {a,b}   alternatives (may nest, may be empty: `{,x}`)
//   trailing '/'  means '/**' (`web/` == `web/**`)
//   leading '!'   negation (only meaningful in matchAny / toPathspec)
//   \x      the literal character x
// Everything else is matched literally.

const MAX_GLOB_LEN = 1024;
const MAX_EXPANSIONS = 256;
const cache = new Map();
const CACHE_MAX = 2048;

function fail(g, why) {
  return new TypeError(`invalid glob ${JSON.stringify(String(g).slice(0, 80))}: ${why}`);
}

function checkGlob(g) {
  if (typeof g !== 'string') throw fail(g, 'not a string');
  if (g.length === 0) throw fail(g, 'empty');
  if (g.length > MAX_GLOB_LEN) throw fail(g, 'too long');
  if (g.includes('\0')) throw fail(g, 'contains NUL');
}

/** Split a leading '!' off: `{negate, body}`. */
export function parseNegation(g) {
  checkGlob(g);
  if (g.startsWith('!')) {
    const body = g.slice(1);
    if (!body) throw fail(g, 'empty after "!"');
    return { negate: true, body };
  }
  return { negate: false, body: g };
}

function normalize(body) {
  let b = body;
  while (b.startsWith('./')) b = b.slice(2);
  if (b.startsWith('/')) b = b.replace(/^\/+/, '');
  if (b.endsWith('/') && !b.endsWith('\\/')) b += '**';
  return b;
}

// Index of the '}' closing the '{' at i, or -1. Respects escapes and nesting.
function closeBrace(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

// Split the inside of a brace group on top-level commas.
function splitAlternatives(inner) {
  const out = [];
  let depth = 0, start = 0;
  for (let j = 0; j < inner.length; j++) {
    const c = inner[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(inner.slice(start, j)); start = j + 1; }
  }
  out.push(inner.slice(start));
  return out;
}

/** Expand `{a,b}` groups into plain globs: `src/{a,b}/*.js` -> ['src/a/*.js', 'src/b/*.js']. */
export function expandBraces(g) {
  checkGlob(g);
  const out = [];
  const walk = (s) => {
    if (out.length > MAX_EXPANSIONS) throw fail(g, 'too many brace expansions');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '}') throw fail(g, 'unbalanced "}"');
      if (c === '{') {
        const end = closeBrace(s, i);
        if (end < 0) throw fail(g, 'unbalanced "{"');
        const head = s.slice(0, i), tail = s.slice(end + 1);
        for (const alt of splitAlternatives(s.slice(i + 1, end))) walk(head + alt + tail);
        return;
      }
    }
    out.push(s);
  };
  walk(g);
  if (out.length > MAX_EXPANSIONS) throw fail(g, 'too many brace expansions');
  return out;
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\/]/;

function escapeChar(c) {
  return RE_SPECIAL.test(c) ? '\\' + c : c;
}

// Token kinds for a brace-free glob body.
const LIT = 0;      // literal character (value in .c)
const STAR = 1;     // '*'  : [^/]*
const ONE = 2;      // '?'  : [^/]
const DEEP = 3;     // '**/': (?:.*/)?   zero or more whole segments
const REST = 4;     // trailing '/**': .+   (bare '**': .*)
const ALL = 5;      // bare '**' alone: .*

function tokenize(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      out.push({ k: LIT, c: i + 1 < s.length ? s[++i] : '\\' });
      continue;
    }
    if (c === '*') {
      let j = i;
      while (s[j] === '*') j++;
      if (j - i >= 2) {
        const atStart = i === 0 || s[i - 1] === '/';
        const atEnd = j === s.length || s[j] === '/';
        if (atStart && atEnd) {
          if (j === s.length) out.push({ k: i === 0 ? ALL : REST });
          else { out.push({ k: DEEP }); j++; } // consume the '/'
          i = j - 1;
          continue;
        }
      }
      // '*' (or 'a**b' inside a segment, which behaves like '*'); collapse runs.
      if (out.at(-1)?.k !== STAR) out.push({ k: STAR });
      i = j - 1;
      continue;
    }
    if (c === '?') { out.push({ k: ONE }); continue; }
    out.push({ k: LIT, c });
  }
  return out;
}

const RE_SRC = { [STAR]: '[^/]*', [ONE]: '[^/]', [DEEP]: '(?:.*/)?', [REST]: '.+', [ALL]: '.*' };

function tokensToSource(tokens) {
  return tokens.map((t) => (t.k === LIT ? escapeChar(t.c) : RE_SRC[t.k])).join('');
}

// Linear-time matcher: a Thompson-style simulation over token positions, so
// hostile globs or paths cannot cause catastrophic backtracking (which the plain
// RegExp form could). State i = "before token i"; state T+1+i = "inside the
// segment(s) consumed by DEEP/REST token i".
function matchTokens(tokens, p) {
  const T = tokens.length;
  const N = 2 * T + 2;
  let cur = new Uint8Array(N), next = new Uint8Array(N);
  const add = (set, i) => {
    // epsilon closure: STAR, DEEP and ALL may match nothing
    while (i < T && !set[i]) {
      set[i] = 1;
      const k = tokens[i].k;
      if (k === STAR || k === DEEP || k === ALL) i++;
      else return;
    }
    if (i === T) set[T] = 1;
  };
  add(cur, 0);
  for (let pi = 0; pi < p.length; pi++) {
    const c = p[pi];
    next.fill(0);
    let any = false;
    for (let i = 0; i < T; i++) {
      if (cur[i]) {
        const t = tokens[i];
        switch (t.k) {
          case LIT: if (c === t.c) { add(next, i + 1); any = true; } break;
          case ONE: if (c !== '/') { add(next, i + 1); any = true; } break;
          case STAR: if (c !== '/') { add(next, i); any = true; } break;
          case DEEP:
            if (c === '/') add(next, i); else next[T + 1 + i] = 1;
            any = true; break;
          case REST: case ALL: next[T + 1 + i] = 1; any = true; break;
        }
      }
      if (cur[T + 1 + i]) {
        const k = tokens[i].k;
        if (k === DEEP) { if (c === '/') add(next, i); else next[T + 1 + i] = 1; }
        else next[T + 1 + i] = 1; // REST/ALL: anything
        any = true;
      }
    }
    if (!any) return false;
    [cur, next] = [next, cur];
  }
  if (cur[T]) return true;
  // REST/ALL are always the last token; being inside one means matched.
  const last = T - 1;
  return last >= 0 && cur[T + 1 + last] === 1 && (tokens[last].k === REST || tokens[last].k === ALL);
}

class GlobRegExp extends RegExp {
  test(str) {
    const p = String(str);
    return this.alternatives.some((tokens) => matchTokens(tokens, p));
  }
  exec(str) {
    if (!this.test(str)) return null;
    const m = [String(str)];
    m.index = 0;
    m.input = String(str);
    return m;
  }
}

/**
 * Compile one glob into an anchored RegExp (a leading '!' is stripped; matchAny
 * applies it). The returned object is a RegExp whose `.source` is the plain regex,
 * but `.test`/`.exec` run a linear-time matcher.
 */
export function compileGlob(g) {
  const cached = cache.get(g);
  if (cached) return cached;
  const { body } = parseNegation(g);
  const alternatives = expandBraces(normalize(body)).map(tokenize);
  const re = new GlobRegExp(`^(?:${alternatives.map(tokensToSource).join('|')})$`, 's');
  Object.defineProperty(re, 'alternatives', { value: alternatives });
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(g, re);
  return re;
}

/** True when `g` is a syntactically valid glob (for config validation). */
export function isValidGlob(g) {
  try { compileGlob(g); return true; } catch { return false; }
}

/** Error message for an invalid glob, or null. */
export function globError(g) {
  try { compileGlob(g); return null; } catch (e) { return e.message; }
}

function normPath(p) {
  let s = String(p).replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s.replace(/^\/+/, '');
}

/** Match one glob against a path (a leading '!' inverts the result). */
export function matchGlob(g, path) {
  const { negate } = parseNegation(g);
  const hit = compileGlob(g).test(normPath(path));
  return negate ? !hit : hit;
}

/**
 * Ordered match: walk the list, the last glob that matches decides
 * (a positive glob includes, a '!' glob excludes). Nothing matched -> false.
 * `["web/**", "!web/docs/**"]` matches `web/a.ts` but not `web/docs/x.md`.
 */
export function matchAny(globs, path) {
  if (!Array.isArray(globs) || globs.length === 0) return false;
  const p = normPath(path);
  let result = false;
  for (const g of globs) {
    const { negate } = parseNegation(g);
    if (compileGlob(g).test(p)) result = !negate;
  }
  return result;
}

/**
 * Literal path prefix of a glob up to the first wildcard, cut back to a whole
 * directory: `web/src/*.ts` -> 'web/src/', `web/**` -> 'web/', `*.md` -> ''.
 * Negation is stripped. Used for prefix overlap checks (job map, §6).
 */
export function globPrefix(g) {
  const { body } = parseNegation(g);
  const s = normalize(body);
  let lit = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { if (i + 1 < s.length) lit += s[++i]; continue; }
    if (c === '*' || c === '?' || c === '{') {
      const k = lit.lastIndexOf('/');
      return k < 0 ? '' : lit.slice(0, k + 1);
    }
    lit += c;
  }
  return lit;
}

// Git ':(glob)' magic: '*' and '?' never cross '/', '**/' and '/**' as here. Braces
// are not supported by git, so they are expanded; the escape character is the same.
function toGitGlob(body) {
  return expandBraces(normalize(body));
}

/**
 * Pathspec args for `git log|rev-list|diff ... <these>`:
 * `['web/**', '!web/docs/**']` -> ['--', ':(glob)web/**', ':(exclude,glob)web/docs/**'].
 * Git applies excludes after includes (not "last match wins"); with only excludes,
 * git treats the includes as "everything". Empty list -> ['--'] (whole tree).
 */
export function toPathspec(globs) {
  const out = ['--'];
  if (!Array.isArray(globs)) return out;
  const seen = new Set();
  for (const g of globs) {
    const { negate, body } = parseNegation(g);
    for (const one of toGitGlob(body)) {
      const spec = (negate ? ':(exclude,glob)' : ':(glob)') + one;
      if (!seen.has(spec)) { seen.add(spec); out.push(spec); }
    }
  }
  return out;
}
