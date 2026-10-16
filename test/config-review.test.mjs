// server/config/review.mjs: review.*, transcript, repos[].base/scripts
// (fleet plan §10, R1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as review from '../server/config/review.mjs';
import * as packages from '../server/config/packages.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-review-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  return f;
};
const frag = { name: 'review', ...review };
const cfg = (fileBody, env = {}, fragments = [frag]) => build({ env, file: fileBody ? write(fileBody) : MISSING, fragments });
const refused = (fileBody, re, fragments) => assert.throws(() => cfg(fileBody, {}, fragments), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});
const repo = (extra) => ({ repos: [{ name: 'acme', ...extra }] });

// --- defaults ----------------------------------------------------------------

test('the fragment is loaded from server/config/ and contributes the contract defaults', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'review'), 'review.mjs is a loaded fragment');
  const c = build({ env: {}, file: MISSING });
  assert.deepEqual(c.review, {
    overdueHours: 4,
    base: 'origin/main',
    inlineMaxChars: 7000,
    diff: { maxFiles: 300, maxBytes: 2 * 1024 * 1024, maxFileBytes: 256 * 1024, maxFileLines: 4000, maxUntracked: 200, timeoutMs: 15000 },
    generated: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '*.lock', '*.min.js', '*.map'],
    postToGitHub: false,
  });
  assert.deepEqual(c.transcript, { tailMaxBytes: 1024 * 1024, maxEntries: 200, textCap: 4000 });
  assert.deepEqual(c.repos, [], 'core repos default untouched');
  assert.equal(c.port, 7777, 'core keys untouched');
});

test('defaults are fresh objects each call', () => {
  const a = review.defaults();
  a.review.generated.push('x');
  a.review.diff.maxFiles = 1;
  assert.equal(review.defaults().review.generated.length, 6);
  assert.equal(review.defaults().review.diff.maxFiles, 300);
});

test('no env layer: nothing review-related can come from the environment', () => {
  assert.deepEqual(review.fromEnv({ LANEBOARD_REVIEW_BASE: 'origin/x', LANEBOARD_SCRIPTS: 'a=b' }), {});
});

test('old configs (repos without base/scripts) load unchanged', () => {
  const c = cfg({ repos: [{ name: 'web', markers: { done: 'SHIPPED' } }, { name: 'api', kickoff: '/x/k.md' }] });
  assert.deepEqual(c.repos.map((r) => r.name), ['web', 'api']);
  assert.equal(c.repos[0].scripts, undefined);
  assert.equal(c.repos[0].base, undefined);
});

test('partial review/transcript blocks deep-merge over the defaults', () => {
  const c = cfg({ review: { overdueHours: 8, diff: { maxFiles: 50 } }, transcript: { maxEntries: 50 } });
  assert.equal(c.review.overdueHours, 8);
  assert.equal(c.review.base, 'origin/main');
  assert.equal(c.review.diff.maxFiles, 50);
  assert.equal(c.review.diff.maxBytes, 2 * 1024 * 1024);
  assert.equal(c.transcript.maxEntries, 50);
  assert.equal(c.transcript.textCap, 4000);
});

// --- review.* ----------------------------------------------------------------

test('review.base and repos[].base accept origin refs and shas', () => {
  const c = cfg({ review: { base: 'origin/develop' }, repos: [{ name: 'a', base: 'origin/release/1.2' }, { name: 'b', base: 'abcdef1' }] });
  assert.equal(c.review.base, 'origin/develop');
  assert.equal(c.repos[0].base, 'origin/release/1.2');
  assert.equal(c.repos[1].base, 'abcdef1');
});

for (const base of ['main', '--output=/tmp/x', 'origin/main;rm', 'origin/../x', 'origin/a..b', 'origin/', 'origin/a b', 'ABCDEF1', '', 7, null, 'origin/x.lock']) {
  test(`review.base and repos[].base refuse ${JSON.stringify(base)}`, () => {
    refused({ review: { base } }, /review\.base/);
    refused(repo({ base }), /repos\[0\] \("acme"\)\.base/);
  });
}

test('review numbers are bounded', () => {
  refused({ review: { overdueHours: 0 } }, /review\.overdueHours/);
  refused({ review: { overdueHours: 'four' } }, /review\.overdueHours/);
  refused({ review: { inlineMaxChars: 9000 } }, /review\.inlineMaxChars .*8000/);
  refused({ review: { inlineMaxChars: 1.5 } }, /review\.inlineMaxChars/);
  refused({ review: { diff: { maxFiles: 0 } } }, /review\.diff\.maxFiles/);
  refused({ review: { diff: { maxBytes: 1e12 } } }, /review\.diff\.maxBytes/);
  refused({ review: { diff: { maxFileLines: -1 } } }, /review\.diff\.maxFileLines/);
  refused({ review: { diff: { timeoutMs: 10 } } }, /review\.diff\.timeoutMs/);
  refused({ review: { diff: { maxFileBytes: 4 * 1024 * 1024 } } }, /maxFileBytes .* must not exceed review\.diff\.maxBytes/);
  refused({ review: { diff: 'big' } }, /review\.diff must be an object/);
  refused({ review: 'yes' }, /review must be an object/);
  assert.equal(cfg({ review: { diff: { maxUntracked: 0 } } }).review.diff.maxUntracked, 0);
});

test('review.generated is a list of valid globs and replaces the default', () => {
  assert.deepEqual(cfg({ review: { generated: ['dist/**', '*.snap'] } }).review.generated, ['dist/**', '*.snap']);
  refused({ review: { generated: 'package-lock.json' } }, /review\.generated must be a list/);
  refused({ review: { generated: [''] } }, /review\.generated must be a list/);
  refused({ review: { generated: [3] } }, /review\.generated must be a list/);
});

test('review.postToGitHub is a boolean', () => {
  assert.equal(cfg({ review: { postToGitHub: true } }).review.postToGitHub, true);
  refused({ review: { postToGitHub: 'yes' } }, /review\.postToGitHub/);
});

// --- transcript --------------------------------------------------------------

test('transcript numbers are bounded integers', () => {
  refused({ transcript: { tailMaxBytes: 10 } }, /transcript\.tailMaxBytes/);
  refused({ transcript: { tailMaxBytes: 1e12 } }, /transcript\.tailMaxBytes/);
  refused({ transcript: { maxEntries: 0 } }, /transcript\.maxEntries/);
  refused({ transcript: { textCap: '4000' } }, /transcript\.textCap/);
  refused({ transcript: [] }, /transcript must be an object/);
});

// --- repos[].scripts ---------------------------------------------------------

test('configured scripts load and are an allowlist only', () => {
  const c = cfg(repo({ scripts: { test: 'npm test', dev: 'npm run dev', 'e2e-ui': 'npx playwright test\t--ui' } }));
  const s = c.repos[0].scripts;
  assert.deepEqual(Object.keys(s), ['test', 'dev', 'e2e-ui']);
  assert.equal(s.test, 'npm test');
  assert.ok(Object.isFrozen(s), 'scripts cannot be changed at run time');
  assert.equal(Object.getPrototypeOf(s), null, 'no inherited names');
  assert.equal(s.constructor, undefined);
  assert.equal(s.toString, undefined);
  assert.throws(() => { 'use strict'; s.evil = 'rm -rf /'; }, TypeError);
  assert.equal(s.evil, undefined);
  assert.equal(JSON.stringify(s), '{"test":"npm test","dev":"npm run dev","e2e-ui":"npx playwright test\\t--ui"}');
});

test('an empty scripts object is fine', () => {
  assert.deepEqual(Object.keys(cfg(repo({ scripts: {} })).repos[0].scripts), []);
});

for (const name of ['Test', '1test', '-x', 'te_st', 'te st', 'a'.repeat(25), '', 'run;x', 'tést', '__proto__', 'constructor-']) {
  test(`script name ${JSON.stringify(name)} is refused`, () => {
    // A raw JSON body so that "__proto__" arrives as an own key, as it would from the file.
    const body = `{"repos":[{"name":"acme","scripts":{${JSON.stringify(name)}:"npm test"}}]}`;
    if (name === 'constructor-') {
      // Valid by the pattern: shows that the pattern, not a deny-list, decides.
      assert.equal(cfg(body).repos[0].scripts['constructor-'], 'npm test');
      return;
    }
    refused(body, /repos\[0\] \("acme"\)\.scripts name .* must match/);
  });
}

test('the longest valid script name is 24 characters', () => {
  const name = 'a'.repeat(24);
  assert.equal(cfg(repo({ scripts: { [name]: 'true' } })).repos[0].scripts[name], 'true');
});

for (const [label, cmd] of [
  ['a newline', 'npm test\nrm -rf ~'],
  ['a carriage return', 'npm test\rrm -rf ~'],
  ['a trailing newline', 'npm test\n'],
  ['a NUL byte', 'npm\0test'],
  ['an escape character', 'npm test \x1b[2J'],
  ['a line separator', 'npm test\u2028rm'],
  ['an empty string', ''],
  ['only spaces', '   '],
  ['a number', 42],
  ['a list', ['npm', 'test']],
  ['an object', { cmd: 'npm test' }],
  ['null', null],
  ['501 characters', 'x'.repeat(501)],
]) {
  test(`a script command with ${label} is refused`, () => {
    refused(repo({ scripts: { test: cmd } }), /repos\[0\] \("acme"\)\.scripts\.test /);
  });
}

test('a 500-character command is accepted', () => {
  assert.equal(cfg(repo({ scripts: { long: 'x'.repeat(500) } })).repos[0].scripts.long.length, 500);
});

test('at most 12 scripts per repo', () => {
  const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, 'true']));
  assert.equal(Object.keys(cfg(repo({ scripts: twelve })).repos[0].scripts).length, 12);
  refused(repo({ scripts: { ...twelve, s12: 'true' } }), /13 entries, at most 12/);
});

test('scripts must be an object of name -> command', () => {
  refused(repo({ scripts: ['npm test'] }), /\.scripts must be an object/);
  refused(repo({ scripts: 'npm test' }), /\.scripts must be an object/);
  refused(repo({ scripts: null }), /\.scripts must be an object/);
});

test('the error names the offending repo by index and name', () => {
  refused({ repos: [{ name: 'ok', scripts: { test: 'npm test' } }, { name: 'web', scripts: { BAD: 'x' } }] }, /repos\[1\] \("web"\)\.scripts name "BAD"/);
});

// --- coexistence with packages.mjs (P2) -------------------------------------

test('coexists with the packages fragment: both validate their own repos[] keys', () => {
  const both = [{ name: 'packages', ...packages }, frag];
  const c = cfg({
    repos: [{
      name: 'acme',
      base: 'origin/trunk',
      scripts: { test: 'npm test' },
      ci: { provider: 'gh', repo: 'acme/acme' },
      packages: [{ name: 'web', paths: ['web/**'] }],
    }],
  }, {}, both);
  assert.equal(c.repos[0].base, 'origin/trunk');
  assert.equal(c.repos[0].scripts.test, 'npm test');
  assert.equal(c.repos[0].ci.repo, 'acme/acme');
  refused(repo({ ci: { provider: 'jenkins' }, scripts: { test: 'npm test' } }), /ci\.provider/, both);
  refused(repo({ ci: { provider: 'gh' }, scripts: { 'Bad!': 'x' } }), /scripts name/, both);
});

test('the full fragment set loads with no duplicate keys', () => {
  const c = build({ env: {}, file: write(repo({ base: 'origin/main', scripts: { test: 'npm test' } })) });
  assert.equal(c.repos[0].scripts.test, 'npm test');
  assert.equal(c.review.overdueHours, 4);
});

// --- helpers -----------------------------------------------------------------

test('exported helpers', () => {
  assert.equal(review.baseProblem('origin/main'), null);
  assert.match(review.baseProblem('-x'), /origin/);
  assert.equal(review.scriptNameProblem('test'), null);
  assert.ok(review.scriptNameProblem('Test'));
  assert.equal(review.scriptCommandProblem('npm test'), null);
  assert.ok(review.scriptCommandProblem('a\nb'));
  assert.equal(review.MAX_SCRIPTS, 12);
  assert.ok(review.BASE_RE.test('0123456789abcdef0123456789abcdef01234567'));
  assert.ok(!review.BASE_RE.test('0123456789abcdef0123456789abcdef012345678'));
});

test('finalize tolerates wrong types', () => {
  for (const repos of [undefined, null, 'x', [null], [{ name: 'a', scripts: 'x' }], [{ name: 'a', scripts: [] }]]) {
    assert.doesNotThrow(() => review.finalize({ repos }));
  }
});
