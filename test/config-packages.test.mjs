// server/config/packages.mjs + server/packages/repos.mjs (fleet plan §6, P2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { build, FRAGMENTS, ConfigError, PROVIDERS } from '../server/config.mjs';
import * as pkgs from '../server/config/packages.mjs';
import { defaultCacheDir } from '../server/packages/gitenv.mjs';
import { parseRemote, githubSlug, resolveRepos, repoDir, isSlug, _clearCache } from '../server/packages/repos.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-packages-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const frag = { name: 'packages', ...pkgs };
const cfg = (fileBody, env = {}) => build({ env, file: fileBody ? write(fileBody) : MISSING, fragments: [frag] });
const refused = (fileBody, re) => assert.throws(() => cfg(fileBody), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});

// --- the fragment -------------------------------------------------------------

test('the fragment is loaded from server/config/ and contributes the contract defaults', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'packages'), 'packages.mjs is a loaded fragment');
  const c = build({ env: {}, file: MISSING });
  assert.deepEqual(c.packages, {
    autodetect: true, mainRef: 'origin/main', branchWindowDays: 14, maxBranches: 40, fetch: 'none',
    fetchEverySec: 300, cacheDir: defaultCacheDir(), ciEverySec: 120, staleDays: 7, staleBehind: 50,
  });
  assert.deepEqual(c.plans.globs, ['docs/plans/**/*.md']);
  assert.deepEqual(c.plans.states, {
    open: ['OPEN', 'READY', 'PROPOSAL', 'IN-PROGRESS'], partial: ['PARTIAL'],
    done: ['DONE', 'SUPERSEDED', 'DECIDED'], deferred: ['DEFERRED'],
  });
  assert.equal(new RegExp(c.plans.statusLine).exec('**Plan status:** `IN-PROGRESS`')[1], 'IN-PROGRESS');
  assert.equal(new RegExp(c.plans.statusLine).exec('**Plan status:** DONE')[1], 'DONE');
  assert.deepEqual(c.repos, [], 'core repos default untouched');
  assert.deepEqual(c.ci, { provider: 'none', repo: '' });
});

test('CI_PROVIDERS agrees with PROVIDERS.ci in server/config.mjs', () => {
  assert.deepEqual([...pkgs.CI_PROVIDERS], PROVIDERS.ci);
});

test('old configs load unchanged', () => {
  const body = {
    repos: [{ name: 'web', markers: { done: 'SHIPPED' } }, { name: 'api', kickoff: '/x/k.md' }],
    ci: { provider: 'gh', repo: 'web' },
  };
  const c = cfg(body);
  assert.deepEqual(c.repos, body.repos);
  assert.deepEqual(c.ci, body.ci);
});

test('the full §6 repos[] shape is accepted', () => {
  const c = cfg({
    repos: [{
      name: 'web', path: '~/code/web',
      ci: { provider: 'gh', repo: 'acme/web.site', collect: false },
      packages: [
        { name: 'ui', paths: ['web/**', '!web/docs/**'], jobs: ['ui-test'], workflow: 'ci.yml', plans: ['docs/plans/ui/*.md'] },
        { name: 'api', paths: ['api/{src,lib}/**'] },
      ],
      global: ['secret-scan'], ignoreJobs: ['deploy'],
    }, { name: 'off', ci: null }, { name: 'none', ci: { provider: 'none' } }],
  });
  assert.equal(c.repos[0].packages.length, 2);
});

test('knobs: file values win, cacheDir ~/ is expanded', () => {
  const c = cfg({ packages: { fetch: 'mirror', cacheDir: '~/lbcache', maxBranches: 10 }, plans: { globs: ['plans/*.md'] } });
  assert.equal(c.packages.fetch, 'mirror');
  assert.equal(c.packages.cacheDir, path.join(os.homedir(), 'lbcache'));
  assert.equal(c.packages.maxBranches, 10);
  assert.equal(c.packages.mainRef, 'origin/main', 'other keys keep defaults');
  assert.deepEqual(c.plans.globs, ['plans/*.md']);
  assert.deepEqual(c.plans.states.partial, ['PARTIAL']);
});

test('a bad glob list fails validate with a message', () => {
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui', paths: [] }] }] }, /repos\[0\].*packages\[0\]\.paths must not be empty/);
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui' }] }] }, /packages\[0\]\.paths must be a list/);
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui', paths: 'web/**' }] }] }, /paths must be a list/);
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui', paths: ['web/**', 3] }] }] }, /paths must be a list of non-empty strings/);
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui', paths: ['web/{a,b'] }] }] }, /"web\/\{a,b" is not a valid glob/);
  refused({ repos: [{ name: 'web', packages: [{ name: 'ui', paths: ['a/**'] }, { name: 'ui', paths: ['b/**'] }] }] }, /used twice/);
  refused({ repos: [{ name: 'web', packages: [{ paths: ['a/**'] }] }] }, /packages\[0\]\.name must be a non-empty string/);
  refused({ repos: [{ name: 'web', packages: { ui: ['a/**'] } }] }, /packages must be a list/);
  refused({ repos: [{ name: 'web', global: 'lint' }] }, /global must be a list/);
  refused({ repos: [{ name: 'web', ignoreJobs: [''] }] }, /ignoreJobs must be a list/);
  refused({ plans: { globs: ['docs/{x'] } }, /plans\.globs entry .* is not a valid glob/);
});

test('a bad slug or provider fails validate with a message', () => {
  for (const repo of ['acme', 'acme/web/extra', 'https://github.com/acme/web', 'acme/we b', '../web', 'acme/..', '']) {
    refused({ repos: [{ name: 'web', ci: { provider: 'gh', repo } }] }, /repos\[0\].*ci\.repo must be an "owner\/name" slug/);
  }
  refused({ repos: [{ name: 'web', ci: { provider: 'gitlab', repo: 'acme/web' } }] }, /ci\.provider must be one of none, gh/);
  refused({ repos: [{ name: 'web', ci: 'acme/web' }] }, /ci must be an object/);
  refused({ repos: [{ name: 'web', ci: { provider: 'gh', collect: 'yes' } }] }, /ci\.collect must be true or false/);
});

test('plans.statusLine must compile and have a capture group', () => {
  refused({ plans: { statusLine: '^Status: (' } }, /plans\.statusLine is not a valid regular expression/);
  refused({ plans: { statusLine: '^Status: [A-Z]+' } }, /plans\.statusLine needs a capture group/);
  refused({ plans: { statusLine: '^Status: (?:[A-Z]+)' } }, /needs a capture group/);
  assert.equal(cfg({ plans: { statusLine: '^Status: ([A-Z]+)' } }).plans.statusLine, '^Status: ([A-Z]+)');
  refused({ plans: { states: { open: 'OPEN' } } }, /plans\.states\.open must be a list/);
});

test('packages knobs are range- and type-checked', () => {
  refused({ packages: { fetch: 'always' } }, /packages\.fetch must be one of none, mirror/);
  refused({ packages: { mainRef: '--upload-pack=x' } }, /packages\.mainRef must not start with "-"/);
  refused({ packages: { mainRef: 'origin/main..x' } }, /packages\.mainRef is not a valid git ref/);
  refused({ packages: { mainRef: '' } }, /packages\.mainRef must be a non-empty string/);
  refused({ packages: { maxBranches: 0 } }, /maxBranches must be an integer/);
  refused({ packages: { maxBranches: 1.5 } }, /maxBranches must be an integer/);
  refused({ packages: { branchWindowDays: -1 } }, /branchWindowDays must be a positive/);
  refused({ packages: { fetchEverySec: 1 } }, /fetchEverySec must be at least 30/);
  refused({ packages: { ciEverySec: '120' } }, /ciEverySec must be at least 30/);
  refused({ packages: { cacheDir: 'rel/dir' } }, /cacheDir must be an absolute path/);
  refused({ packages: { autodetect: 'yes' } }, /autodetect must be true or false/);
  refused({ packages: { staleBehind: -2 } }, /staleBehind must be a non-negative integer/);
  refused({ packages: { staleDays: 0 } }, /staleDays must be a positive/);
  refused({ packages: 'off' }, /packages must be an object/);
});

test('the fragment does not import server/config.mjs', () => {
  const src = fs.readFileSync(new URL('../server/config/packages.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from\s+['"]\.\.\/config\.mjs['"]/);
  const repos = fs.readFileSync(new URL('../server/packages/repos.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(repos, /from\s+['"]\.\.\/config\.mjs['"]/);
});

// --- parseRemote -------------------------------------------------------------

test('parseRemote handles scp, https and ssh forms', () => {
  const want = { host: 'github.com', owner: 'acme', name: 'web', slug: 'acme/web' };
  for (const u of [
    'git@github.com:acme/web.git', 'git@github.com:acme/web', 'github.com:acme/web.git',
    'https://github.com/acme/web', 'https://github.com/acme/web.git', 'https://github.com/acme/web/',
    'http://github.com/acme/web.git', 'ssh://git@github.com/acme/web', 'ssh://git@github.com:22/acme/web.git',
    'git://github.com/acme/web.git', '  https://GitHub.com/acme/web.git\n',
  ]) assert.deepEqual(parseRemote(u), want, u);
  assert.equal(parseRemote('https://github.com/acme/my.site.git').slug, 'acme/my.site');
  assert.equal(parseRemote('git@example.invalid:acme/web.git').host, 'example.invalid');
});

test('parseRemote drops credentials and refuses anything not owner/name', () => {
  const r = parseRemote('https://user:s3cret@github.com/acme/web.git');
  assert.deepEqual(r, { host: 'github.com', owner: 'acme', name: 'web', slug: 'acme/web' });
  assert.ok(!JSON.stringify(r).includes('s3cret'));
  for (const u of [
    '', null, undefined, 42, '/srv/git/web.git', 'file:///srv/acme/web', '../web',
    'https://gitlab.example.invalid/group/sub/web.git', 'https://github.com/acme',
    'ext::sh -c touch% /tmp/x', 'git@github.com:acme/../web', 'https://github.com/acme/web\n/x',
    'https://github.com/acme/%2e%2e', 'git@github.com:acme/we b.git',
  ]) assert.equal(parseRemote(u), null, String(u));
});

test('githubSlug keeps only github.com hosts', () => {
  assert.equal(githubSlug('git@github.com:acme/web.git'), 'acme/web');
  assert.equal(githubSlug('ssh://git@ssh.github.com:443/acme/web.git'), 'acme/web');
  assert.equal(githubSlug('git@example.invalid:acme/web.git'), null);
  assert.equal(githubSlug(null), null);
  assert.ok(isSlug('acme/web') && !isSlug('acme/..') && !isSlug('a/b/c'));
});

// --- resolveRepos ------------------------------------------------------------

const fakeOrigins = (map) => {
  const calls = [];
  const fn = async (dir) => { calls.push(dir); return map[dir] ?? null; };
  fn.calls = calls;
  return fn;
};

test('legacy ci.repo (a directory name) resolves to a slug from origin', async () => {
  _clearCache();
  const codeDir = '/srv/code';
  const originUrl = fakeOrigins({ '/srv/code/web': 'git@github.com:acme/web.git' });
  const c = { codeDir, repos: [], ci: { provider: 'gh', repo: 'web' } };
  const out = await resolveRepos(c, { originUrl });
  assert.deepEqual(out, [{
    name: 'web', dir: '/srv/code/web', ci: { provider: 'gh', repo: 'acme/web', collect: true },
    packages: null, global: [], ignoreJobs: [], legacy: true,
  }]);
  // A repos[] entry of the same name is the one that gets the ci block.
  _clearCache();
  const both = await resolveRepos({ codeDir, repos: [{ name: 'api' }, { name: 'web', markers: { done: 'X' } }], ci: { provider: 'gh', repo: 'web' } }, { originUrl });
  assert.equal(both.length, 2);
  assert.equal(both[0].ci, null);
  assert.deepEqual(both[1].ci, { provider: 'gh', repo: 'acme/web', collect: true });
  assert.deepEqual(both[1].markers, { done: 'X' });
});

test('legacy is ignored when ci.provider is none or a repos[].ci exists', async () => {
  _clearCache();
  const originUrl = fakeOrigins({ '/c/web': 'git@github.com:acme/web.git' });
  const none = await resolveRepos({ codeDir: '/c', repos: [], ci: { provider: 'none', repo: 'web' } }, { originUrl });
  assert.deepEqual(none, []);
  const explicit = await resolveRepos({
    codeDir: '/c', repos: [{ name: 'api', ci: { provider: 'gh', repo: 'acme/api' } }, { name: 'web' }], ci: { provider: 'gh', repo: 'web' },
  }, { originUrl });
  assert.deepEqual(explicit.map((r) => [r.name, r.ci?.repo ?? null]), [['api', 'acme/api'], ['web', null]]);
  assert.equal(originUrl.calls.length, 0, 'an explicit slug needs no git call');
});

test('explicit ci blocks: slug wins, gh without repo reads origin, none/null mean no CI', async () => {
  _clearCache();
  const originUrl = fakeOrigins({ '/c/b': 'https://github.com/acme/b.git', '/c/e': 'git@example.invalid:acme/e.git' });
  const out = await resolveRepos({
    codeDir: '/c',
    ci: { provider: 'none', repo: '' },
    repos: [
      { name: 'a', ci: { provider: 'gh', repo: 'acme/a', collect: false } },
      { name: 'b', ci: { provider: 'gh' } },
      { name: 'c', ci: { provider: 'none', repo: 'acme/c' } },
      { name: 'd', ci: null },
      { name: 'e', ci: {} },
      { name: 'f', path: '/elsewhere/f', ci: { provider: 'gh' } },
    ],
  }, { originUrl });
  assert.deepEqual(out.map((r) => r.ci), [
    { provider: 'gh', repo: 'acme/a', collect: false },
    { provider: 'gh', repo: 'acme/b', collect: true },
    null, null,
    null, // a non-GitHub origin has no gh slug: rows show unknown
    null, // no origin at all
  ]);
  assert.equal(out[5].dir, '/elsewhere/f');
});

test('origin lookups are cached for the process lifetime; failures become null', async () => {
  _clearCache();
  let calls = 0;
  const originUrl = async () => { calls++; return 'git@github.com:acme/web.git'; };
  const c = { codeDir: '/c', repos: [{ name: 'web', ci: { provider: 'gh' } }], ci: { provider: 'none', repo: '' } };
  await resolveRepos(c, { originUrl });
  await resolveRepos(c, { originUrl });
  assert.equal(calls, 1);
  _clearCache();
  const boom = async () => { throw new Error('git missing'); };
  const out = await resolveRepos(c, { originUrl: boom });
  assert.equal(out[0].ci, null);
});

test('packages, global and ignoreJobs are normalised', async () => {
  _clearCache();
  const out = await resolveRepos({
    codeDir: '/c',
    ci: { provider: 'none', repo: '' },
    repos: [{
      name: 'web', global: ['scan'], ignoreJobs: ['deploy'],
      packages: [{ name: 'ui', paths: ['web/**'], workflow: 'ci.yml' }, { name: 'api', paths: ['api/**'], jobs: ['t'], plans: ['p/*.md'] }],
    }, { name: 'bare' }],
  }, { originUrl: async () => null });
  assert.deepEqual(out[0].packages, [
    { name: 'ui', paths: ['web/**'], jobs: [], workflow: 'ci.yml' },
    { name: 'api', paths: ['api/**'], jobs: ['t'], plans: ['p/*.md'] },
  ]);
  assert.deepEqual(out[0].global, ['scan']);
  assert.deepEqual(out[0].ignoreJobs, ['deploy']);
  assert.equal(out[1].packages, null, 'no packages[] = auto-detect');
  assert.equal(repoDir({ name: 'x', path: 'sub/x' }, '/c'), '/c/sub/x');
  assert.equal(repoDir({ name: 'x', path: '~/x' }, '/c'), path.join(os.homedir(), 'x'));
});

test('the default origin reader uses git remote get-url in a real checkout', async () => {
  _clearCache();
  const dir = path.join(tmp, 'checkout');
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:acme/web.git']);
  const out = await resolveRepos({ codeDir: tmp, repos: [], ci: { provider: 'gh', repo: 'checkout' } });
  assert.deepEqual(out[0].ci, { provider: 'gh', repo: 'acme/web', collect: true });
  _clearCache();
  const missing = await resolveRepos({ codeDir: tmp, repos: [], ci: { provider: 'gh', repo: 'nope' } });
  assert.equal(missing[0].ci, null);
});
