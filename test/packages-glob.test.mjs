import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  compileGlob, matchGlob, matchAny, toPathspec, expandBraces, globPrefix,
  isValidGlob, globError, parseNegation,
} from '../server/packages/glob.mjs';

const m = (g, p) => compileGlob(g).test(p);

test('** matches any depth and not sibling prefixes', () => {
  assert.ok(m('web/**', 'web/a/b.ts'));
  assert.ok(m('web/**', 'web/a.ts'));
  assert.ok(!m('web/**', 'web-admin/x'));
  assert.ok(!m('web/**', 'web'));
  assert.ok(m('**', 'anything/at/all.md'));
  assert.ok(m('**/*.md', 'README.md'));
  assert.ok(m('**/*.md', 'docs/a/b.md'));
  assert.ok(!m('**/*.md', 'docs/a/b.mdx'));
});

test('a/**/b matches zero or more directories in between', () => {
  assert.ok(m('a/**/b', 'a/b'));
  assert.ok(m('a/**/b', 'a/x/b'));
  assert.ok(m('a/**/b', 'a/x/y/b'));
  assert.ok(!m('a/**/b', 'a/xb'));
  assert.ok(!m('a/**/b', 'ab'));
  assert.ok(m('docs/plans/**/*.md', 'docs/plans/x.md'));
  assert.ok(m('docs/plans/**/*.md', 'docs/plans/fleet/x.md'));
});

test('* and ? never cross a slash', () => {
  assert.ok(m('src/*.js', 'src/a.js'));
  assert.ok(!m('src/*.js', 'src/a/b.js'));
  assert.ok(m('a?c', 'abc'));
  assert.ok(!m('a?c', 'a/c'));
  assert.ok(!m('*.md', 'docs/x.md'));
  assert.ok(m('a**b', 'axxb'));
  assert.ok(!m('a**b', 'a/b'));
});

test('{a,b} alternatives, nested and empty', () => {
  assert.ok(m('src/{a,b}/*.ts', 'src/a/x.ts'));
  assert.ok(m('src/{a,b}/*.ts', 'src/b/x.ts'));
  assert.ok(!m('src/{a,b}/*.ts', 'src/c/x.ts'));
  assert.ok(m('*.{js,mjs}', 'x.mjs'));
  assert.ok(m('{a,b/{c,d}}/x', 'b/d/x'));
  assert.ok(m('x{,.bak}', 'x'));
  assert.ok(m('x{,.bak}', 'x.bak'));
  assert.deepEqual(expandBraces('src/{a,b}/{c,d}'), ['src/a/c', 'src/a/d', 'src/b/c', 'src/b/d']);
});

test('trailing slash means /**, leading ./ and / are ignored', () => {
  assert.ok(m('web/', 'web/a/b'));
  assert.ok(!m('web/', 'webx/a'));
  assert.ok(m('./web/**', 'web/a'));
  assert.ok(m('/web/**', 'web/a'));
});

test('everything else is literal (regex metacharacters escaped)', () => {
  assert.ok(m('a.b', 'a.b'));
  assert.ok(!m('a.b', 'axb'));
  assert.ok(m('a+(b)|c$', 'a+(b)|c$'));
  assert.ok(m('x[1]', 'x[1]'));
  assert.ok(!m('x[1]', 'x1'));
  assert.ok(m('lit\\*', 'lit*'));
  assert.ok(!m('lit\\*', 'litx'));
  assert.ok(m('a\\{b,c\\}', 'a{b,c}'));
});

test('negation: matchGlob inverts, matchAny is ordered and the last match wins', () => {
  assert.deepEqual(parseNegation('!web/docs/**'), { negate: true, body: 'web/docs/**' });
  assert.ok(!matchGlob('!web/docs/**', 'web/docs/a.md'));
  assert.ok(matchGlob('!web/docs/**', 'web/a.md'));
  const g = ['web/**', '!web/docs/**'];
  assert.ok(matchAny(g, 'web/src/a.ts'));
  assert.ok(!matchAny(g, 'web/docs/a.md'));
  assert.ok(!matchAny(g, 'api/x'));
  // re-include after an exclude
  assert.ok(matchAny(['web/**', '!web/docs/**', 'web/docs/keep.md'], 'web/docs/keep.md'));
  // order matters
  assert.ok(matchAny(['!web/docs/**', 'web/**'], 'web/docs/a.md'));
  assert.ok(!matchAny([], 'x'));
  assert.ok(!matchAny(undefined, 'x'));
  assert.ok(!matchAny(['!x/**'], 'y'));
});

test('invalid globs throw and are reported', () => {
  for (const bad of ['', '!', 'a{b', 'a}b', 42, null, 'x'.repeat(2000)]) {
    assert.equal(isValidGlob(bad), false, String(bad).slice(0, 20));
    assert.match(globError(bad), /invalid glob/);
  }
  assert.throws(() => compileGlob('a{b'), TypeError);
  assert.throws(() => expandBraces('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}{q,r}'), /too many/);
  assert.equal(globError('web/**'), null);
});

test('globPrefix: literal directory prefix up to the first wildcard', () => {
  assert.equal(globPrefix('web/**'), 'web/');
  assert.equal(globPrefix('web/src/*.ts'), 'web/src/');
  assert.equal(globPrefix('web/sr*'), 'web/');
  assert.equal(globPrefix('*.md'), '');
  assert.equal(globPrefix('!web/docs/**'), 'web/docs/');
  assert.equal(globPrefix('web/'), 'web/');
  assert.equal(globPrefix('pkg/{a,b}/**'), 'pkg/');
  assert.equal(globPrefix('Cargo.toml'), 'Cargo.toml');
});

test('toPathspec emits :(glob) and :(exclude,glob), expanding braces', () => {
  assert.deepEqual(toPathspec(['web/**', '!web/docs/**']),
    ['--', ':(glob)web/**', ':(exclude,glob)web/docs/**']);
  assert.deepEqual(toPathspec(['src/{a,b}/', 'src/a/**']),
    ['--', ':(glob)src/a/**', ':(glob)src/b/**']);
  assert.deepEqual(toPathspec([]), ['--']);
  assert.throws(() => toPathspec(['a{']), TypeError);
});

test('toPathspec agrees with matchAny in a real git repo', (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('no git'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'lb-glob-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ['web/a.ts', 'web/x/b.ts', 'web/docs/c.md', 'web-admin/d.ts', 'api/e.go', 'README.md', 'src/a/f.js', 'src/b/g/h.js'];
  for (const f of files) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), f);
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  for (const globs of [['web/**', '!web/docs/**'], ['**/*.md'], ['src/{a,b}/**'], ['web/'], ['!web/**']]) {
    const listed = git('ls-files', ...toPathspec(globs)).split('\n').filter(Boolean).sort();
    const expected = files.filter((f) => {
      const pos = globs.filter((g) => !g.startsWith('!'));
      const neg = globs.filter((g) => g.startsWith('!'));
      // git: includes (all when none), then excludes
      return (pos.length === 0 || matchAny(pos, f)) && !neg.some((g) => matchAny([g.slice(1)], f));
    }).sort();
    assert.deepEqual(listed, expected, JSON.stringify(globs));
    // include-then-exclude lists: the ordered matcher agrees with git
    if (globs[0] && !globs[0].startsWith('!')) {
      assert.deepEqual(files.filter((f) => matchAny(globs, f)).sort(), expected, JSON.stringify(globs));
    }
  }
});

test('matching is linear on hostile input (no catastrophic backtracking)', () => {
  const g = '**/a*a*a*a*a*a*a*a*b';
  const p = 'x/'.repeat(200) + 'a'.repeat(60);
  const t0 = Date.now();
  assert.equal(m(g, p), false);
  assert.ok(Date.now() - t0 < 1000);
});
