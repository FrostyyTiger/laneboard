// A tiny per-line syntax highlighter for the diff view (fleet plan §10 2.12, R11).
//
// Pure ES module: no imports, no DOM. tokenize(line, lang) -> [{k, s}], where
// k is 'comment' | 'string' | 'number' | 'keyword', or null for plain text;
// joining every `s` gives the line back exactly. The view turns each token
// into a <span class="hl-<k>"> with textContent, so nothing here is ever
// parsed as markup.
//
// Every line comes from a builder's diff: untrusted, possibly hostile. So:
//   - lines longer than MAX_LINE (2000) characters are returned as one plain
//     token, untokenized;
//   - the scanner walks the line once, left to right. Strings and comments
//     are closed by indexOf / a single escape-aware loop, and the only
//     regexes are sticky single-class runs ([\w$]*, [\w.]*) with no nested
//     quantifiers and no alternation, so no input can make them backtrack.
//     The whole pass is linear in the line length.
//
// Per line means per line: a block comment or a template string that spans
// lines is highlighted only on the line where it opens (to its end).

export const MAX_LINE = 2000;

const words = (s) => Object.freeze(new Set(s.split(/\s+/).filter(Boolean)));

const JS_KW = words(`
  async await break case catch class const continue debugger default delete do else enum export
  extends false finally for from function if implements import in instanceof interface let new null
  of private protected public return static super switch this throw true try type typeof undefined
  var void while with yield as readonly declare namespace abstract keyof satisfies`);
const PY_KW = words(`
  and as assert async await break class continue def del elif else except False finally for from
  global if import in is lambda None nonlocal not or pass raise return True try while with yield
  match case self`);
const SH_KW = words(`
  if then else elif fi for in do done case esac while until function return export local readonly
  set unset shift exit source declare true false`);
const C_KW = words(`
  auto break case catch char class const continue default defer delete do double else enum extern
  false fn for func go goto if impl import int interface let long loop match mod move mut new nil
  null package private protected pub public return self short signed sizeof static struct super
  switch template this throw trait true try type typedef union unsafe unsigned use using var void
  volatile where while chan map range select fallthrough bool string float int32 int64 uint u8 u16
  u32 u64 i8 i16 i32 i64 f32 f64 usize isize`);
const CSS_KW = words('important inherit initial unset none auto');
const YAML_KW = words('true false null yes no on off True False Null TRUE FALSE NULL');

/**
 * Language specs. `line`: line-comment openers; `block`: [open, close];
 * `hashAfterSpace`: '#' starts a comment only at the line start or after
 * whitespace (sh, yaml: `a#b` is not a comment); `quotes`: string quotes;
 * `at`: '@word' is a keyword (css).
 */
const LANGS = Object.freeze({
  js: { line: ['//'], block: ['/*', '*/'], quotes: '\'"`', kw: JS_KW },
  py: { line: ['#'], quotes: '\'"', kw: PY_KW },
  sh: { line: ['#'], hashAfterSpace: true, quotes: '\'"', kw: SH_KW },
  c: { line: ['//'], block: ['/*', '*/'], quotes: '\'"`', kw: C_KW },
  css: { block: ['/*', '*/'], quotes: '\'"', kw: CSS_KW, at: true },
  yaml: { line: ['#'], hashAfterSpace: true, quotes: '\'"', kw: YAML_KW },
});

const EXT = Object.freeze({
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', json: 'js', jsonc: 'js',
  py: 'py', pyi: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh', ksh: 'sh',
  go: 'c', rs: 'c', c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c', java: 'c',
  kt: 'c', kts: 'c', swift: 'c', cs: 'c', scala: 'c', dart: 'c', zig: 'c',
  css: 'css', scss: 'css', less: 'css',
  yml: 'yaml', yaml: 'yaml',
});
const BASENAME = Object.freeze({ makefile: 'sh', dockerfile: 'sh', '.bashrc': 'sh', '.profile': 'sh', '.envrc': 'sh' });

/** The language for a file path, from its extension; null = no highlighting (md and anything unknown). */
export function langOf(path) {
  if (typeof path !== 'string' || path === '') return null;
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (Object.hasOwn(BASENAME, base)) return BASENAME[base];
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  return Object.hasOwn(EXT, ext) ? EXT[ext] : null;
}

const IDENT_START = /[A-Za-z_$]/;
const DIGIT = /[0-9]/;
// Sticky single-class runs: linear, no backtracking possible.
const IDENT_REST = /[\w$]*/y;
const NUM_REST = /[\w.]*/y;
const SPACE = /\s/;

function runEnd(re, s, from) {
  re.lastIndex = from;
  re.exec(s);
  return re.lastIndex;
}

/** End index (exclusive) of the string opened by quote `q` at `i`; the line end when unterminated. */
function stringEnd(s, i, q) {
  let j = i + 1;
  const n = s.length;
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    j += 1;
  }
  return n;
}

/**
 * One line -> [{k, s}]. `lang` is a langOf() result (or null: one plain
 * token). Lines over `max` characters (default MAX_LINE) are not tokenized.
 * An empty line gives [].
 */
export function tokenize(line, lang, { max = MAX_LINE } = {}) {
  const s = typeof line === 'string' ? line : String(line ?? '');
  if (s === '') return [];
  const spec = typeof lang === 'string' && Object.hasOwn(LANGS, lang) ? LANGS[lang] : null;
  if (!spec || s.length > max) return [{ k: null, s }];

  const out = [];
  const push = (k, text) => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.s += text;
    else out.push({ k, s: text });
  };
  const n = s.length;
  let plainFrom = 0;
  let i = 0;
  const flush = (to) => { if (to > plainFrom) push(null, s.slice(plainFrom, to)); };
  const emit = (k, from, to) => { flush(from); push(k, s.slice(from, to)); i = to; plainFrom = to; };

  while (i < n) {
    const c = s[i];
    // Comments.
    if (spec.block && s.startsWith(spec.block[0], i)) {
      const close = s.indexOf(spec.block[1], i + spec.block[0].length);
      emit('comment', i, close < 0 ? n : close + spec.block[1].length);
      continue;
    }
    if (spec.line && spec.line.some((p) => s.startsWith(p, i))
      && (!spec.hashAfterSpace || i === 0 || SPACE.test(s[i - 1]))) {
      emit('comment', i, n);
      continue;
    }
    // Strings.
    if (spec.quotes.includes(c)) {
      emit('string', i, stringEnd(s, i, c));
      continue;
    }
    // Words: keywords, or plain identifiers skipped whole (so `x1` has no number).
    if (IDENT_START.test(c)) {
      const end = runEnd(IDENT_REST, s, i + 1);
      const w = s.slice(i, end);
      if (spec.kw.has(w)) emit('keyword', i, end);
      else i = end;
      continue;
    }
    if (spec.at && c === '@' && i + 1 < n && IDENT_START.test(s[i + 1])) {
      emit('keyword', i, runEnd(IDENT_REST, s, i + 2));
      continue;
    }
    if (spec.at && c === '!' && s.startsWith('!important', i)) {
      emit('keyword', i, i + 10);
      continue;
    }
    // Numbers: 42, 0x1f, 1_000, 3.14, 1e9 (exponent signs stay plain).
    if (DIGIT.test(c) || (c === '.' && i + 1 < n && DIGIT.test(s[i + 1]))) {
      emit('number', i, runEnd(NUM_REST, s, i + 1));
      continue;
    }
    i += 1;
  }
  flush(n);
  return out;
}

/** tokenize() for a file path: the language is picked from its extension. */
export function highlight(line, path, opts) {
  return tokenize(line, langOf(path), opts);
}
