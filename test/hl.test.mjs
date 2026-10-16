// public/js/core/hl.js: the diff view's per-line tokenizer (fleet R11, plan §10 2.12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, langOf, highlight, MAX_LINE } from '../public/js/core/hl.js';

const join = (toks) => toks.map((t) => t.s).join('');
const kinds = (toks) => toks.filter((t) => t.k).map((t) => [t.k, t.s]);

test('langOf picks the language from the extension; md and unknown get none', () => {
  assert.equal(langOf('src/a.js'), 'js');
  assert.equal(langOf('x/y.MJS'), 'js');
  assert.equal(langOf('a.ts'), 'js');
  assert.equal(langOf('package.json'), 'js');
  assert.equal(langOf('tool.py'), 'py');
  assert.equal(langOf('bin/run.sh'), 'sh');
  assert.equal(langOf('Makefile'), 'sh');
  assert.equal(langOf('main.go'), 'c');
  assert.equal(langOf('lib.rs'), 'c');
  assert.equal(langOf('x.c'), 'c');
  assert.equal(langOf('style.css'), 'css');
  assert.equal(langOf('ci.yml'), 'yaml');
  assert.equal(langOf('README.md'), null);
  assert.equal(langOf('LICENSE'), null);
  assert.equal(langOf('weird.constructor'), null, 'no prototype lookups');
  assert.equal(langOf('a.__proto__'), null);
  assert.equal(langOf(''), null);
  assert.equal(langOf(null), null);
});

test('js: keywords, strings, numbers and comments', () => {
  const t = tokenize('const x = "a\\"b" + 42; // hi', 'js');
  assert.deepEqual(t, [
    { k: 'keyword', s: 'const' },
    { k: null, s: ' x = ' },
    { k: 'string', s: '"a\\"b"' },
    { k: null, s: ' + ' },
    { k: 'number', s: '42' },
    { k: null, s: '; ' },
    { k: 'comment', s: '// hi' },
  ]);
  assert.deepEqual(kinds(tokenize("if (a) return 'x' /* c */ + 0x1f;", 'js')), [
    ['keyword', 'if'], ['keyword', 'return'], ['string', "'x'"], ['comment', '/* c */'], ['number', '0x1f'],
  ]);
  assert.deepEqual(kinds(tokenize('let s = `t ${x}`', 'js')), [['keyword', 'let'], ['string', '`t ${x}`']]);
  assert.deepEqual(kinds(tokenize('x1 = y2 + 3.5', 'js')), [['number', '3.5']], 'digits inside identifiers are not numbers');
  assert.deepEqual(kinds(tokenize('a /* open', 'js')), [['comment', '/* open']], 'an unclosed block comment runs to the line end');
  assert.deepEqual(kinds(tokenize('"open', 'js')), [['string', '"open']], 'an unclosed string runs to the line end');
});

test('py, sh, yaml, css, c-like', () => {
  assert.deepEqual(kinds(tokenize('def f(x): return None  # done', 'py')), [
    ['keyword', 'def'], ['keyword', 'return'], ['keyword', 'None'], ['comment', '# done'],
  ]);
  assert.deepEqual(kinds(tokenize('echo a#b # c', 'sh')), [['comment', '# c']], "sh: '#' inside a word is not a comment");
  assert.deepEqual(kinds(tokenize('if [ -f "$x" ]; then exit 1; fi', 'sh')), [
    ['keyword', 'if'], ['string', '"$x"'], ['keyword', 'then'], ['keyword', 'exit'], ['number', '1'], ['keyword', 'fi'],
  ]);
  assert.deepEqual(kinds(tokenize('enabled: true # on', 'yaml')), [['keyword', 'true'], ['comment', '# on']]);
  assert.deepEqual(kinds(tokenize('@media (x) { a { width: 10px !important; } } /* c */', 'css')), [
    ['keyword', '@media'], ['number', '10px'], ['keyword', '!important'], ['comment', '/* c */'],
  ]);
  assert.deepEqual(kinds(tokenize('func main() { return nil } // go', 'c')), [
    ['keyword', 'func'], ['keyword', 'return'], ['keyword', 'nil'], ['comment', '// go'],
  ]);
});

test('no language, empty lines and non-strings', () => {
  assert.deepEqual(tokenize('# Title', null), [{ k: null, s: '# Title' }]);
  assert.deepEqual(tokenize('x', 'nope'), [{ k: null, s: 'x' }]);
  assert.deepEqual(tokenize('x', '__proto__'), [{ k: null, s: 'x' }]);
  assert.deepEqual(tokenize('', 'js'), []);
  assert.deepEqual(tokenize(null, 'js'), []);
  assert.deepEqual(highlight('const a', 'a.js'), [{ k: 'keyword', s: 'const' }, { k: null, s: ' a' }]);
});

test('tokens always join back to the exact line, markup included', () => {
  const lines = [
    '<img src=x onerror="alert(1)"> // </script>',
    'a = "\\" + \'\\\\\' + `x` # y /* z',
    '‮ evil ⁦ bidi \0 nul \r',
    '1..2 .5 1e9 0b1010 1_000',
  ];
  for (const lang of ['js', 'py', 'sh', 'c', 'css', 'yaml', null]) {
    for (const l of lines) assert.equal(join(tokenize(l, lang)), l, `${lang}: ${JSON.stringify(l)}`);
  }
});

test(`a line over ${MAX_LINE} characters is left untokenized`, () => {
  const at = 'const x = 1;'.padEnd(MAX_LINE, ' ');
  assert.equal(at.length, MAX_LINE);
  assert.ok(tokenize(at, 'js').some((t) => t.k === 'keyword'), 'exactly MAX_LINE is still tokenized');
  const over = 'const x = 1;'.padEnd(2001, ' ');
  assert.deepEqual(tokenize(over, 'js'), [{ k: null, s: over }]);
});

test("adversarial '\"'.repeat(1e5) finishes in under 50 ms", () => {
  const evil = '"'.repeat(1e5);
  const t0 = performance.now();
  const out = tokenize(evil, 'js');
  const ms = performance.now() - t0;
  assert.deepEqual(out, [{ k: null, s: evil }]);
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});

test('hostile long lines tokenize in linear time even with the length cap lifted', () => {
  // The cap is the first defence; the scanner itself must also be linear, so
  // run it with no cap over 100k-char lines built to trip backtracking or
  // repeated rescans.
  const hostile = [
    '"'.repeat(1e5),
    '"\\'.repeat(5e4),
    "'".repeat(1e5),
    '`'.repeat(1e5),
    '/*'.repeat(5e4),
    '/'.repeat(1e5),
    '*/'.repeat(5e4),
    'a'.repeat(1e5),
    '1'.repeat(1e5),
    '1.'.repeat(5e4),
    '\\'.repeat(1e5),
    ' #'.repeat(5e4),
    '@'.repeat(1e5),
    '!'.repeat(1e5),
    'if '.repeat(33333),
    '"a\\"'.repeat(25000),
  ];
  for (const lang of ['js', 'py', 'sh', 'c', 'css', 'yaml']) {
    for (const line of hostile) {
      const t0 = performance.now();
      const out = tokenize(line, lang, { max: Infinity });
      const ms = performance.now() - t0;
      assert.equal(join(out), line);
      assert.ok(ms < 250, `${lang} ${JSON.stringify(line.slice(0, 6))}…: ${ms.toFixed(1)} ms`);
    }
  }
});

test('within the cap, 2000-char hostile lines are fast', () => {
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) {
    tokenize('"\\'.repeat(1000), 'js');
    tokenize('/*'.repeat(1000), 'c');
    tokenize(' #'.repeat(1000), 'sh');
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `600 lines took ${ms.toFixed(1)} ms`);
});
