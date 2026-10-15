// Branches/touches + scratch git env + mirror (fleet §6, P6). P7 extends this
// file with the conflicts / merge-order / stale assertions.
//
// Every repo here is a throwaway built with `git init` under os.tmpdir(); the
// cache dir is a temp dir too. Nothing reads or writes a real checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate git from the host's global/system config (signing, hooks, aliases).
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@example.invalid';
delete process.env.GIT_DIR;
delete process.env.GIT_OBJECT_DIRECTORY;
delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;

const gitenv = await import('../server/packages/gitenv.mjs');
const branches = await import('../server/packages/branches.mjs');
const { scratchEnv, syncMirror, pruneScratch, scratchDir, mirrorDir, mirrorRef, safeRepoName, withEnv } = gitenv;
const { collectBranches, touches, branchInfo, packagesFor, parseRefs, parseShortstat, cacheStats, _clearCache } = branches;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function commit(dir, file, text, msg, env) {
  write(dir, file, text);
  git(dir, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env: { ...process.env, ...env } });
  return git(dir, 'rev-parse', 'HEAD');
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) n++;
  return n;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-p6-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// origin (bare) <- work (main checkout) with branches a, b, c, d, gone
// a, b: both edit line 1 of x.txt; c: edits y.txt; d: based on a, edits z.txt
// gone: pushed to origin then deleted locally (remote-only)
// wt-c: a linked worktree on branch c (a local lane)
function buildFixture(name) {
  const root = path.join(TMP, name);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'init', '-q', work);
  write(work, 'x.txt', 'one\ntwo\n');
  write(work, 'y.txt', 'y\n');
  write(work, 'web/app.ts', 'app\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'remote', 'add', 'origin', origin);
  const sha = {};
  sha.main0 = git(work, 'rev-parse', 'HEAD');
  git(work, 'checkout', '-q', '-b', 'a');
  sha.a = commit(work, 'x.txt', 'ONE-a\ntwo\n', 'a');
  git(work, 'checkout', '-q', '-b', 'd');
  sha.d = commit(work, 'z.txt', 'z\n', 'd');
  git(work, 'checkout', '-q', '-b', 'b', 'main');
  sha.b = commit(work, 'x.txt', 'ONE-b\ntwo\n', 'b');
  git(work, 'checkout', '-q', '-b', 'c', 'main');
  sha.c = commit(work, 'y.txt', 'y-c\n', 'c');
  git(work, 'checkout', '-q', '-b', 'gone', 'main');
  sha.gone = commit(work, 'web/app.ts', 'app-gone\n', 'gone');
  const old = '2020-01-01T00:00:00Z';
  git(work, 'checkout', '-q', '-b', 'old', 'main');
  sha.old = commit(work, 'web/old.ts', 'old\n', 'old', { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
  git(work, 'checkout', '-q', '-b', 'merged', 'main');
  git(work, 'checkout', '-q', 'main');
  git(work, 'push', '-q', 'origin', 'main', 'a', 'b', 'd', 'gone', 'old', 'merged');
  git(work, 'branch', '-q', '-D', 'gone');
  git(work, 'fetch', '-q', 'origin');
  const wtc = path.join(root, 'work-c');
  git(work, 'worktree', 'add', '-q', wtc, 'c');
  return { root, origin, work, wtc, sha, cacheDir: path.join(root, 'cache') };
}

const fx = buildFixture('fx');
const PACKAGES = [{ name: 'web', paths: ['web/**'] }, { name: 'core', paths: ['*.txt', '!z.txt'] }];

test('parsers: refs, shortstat', () => {
  const s = 'a'.repeat(40);
  const refs = parseRefs([
    `refs/remotes/origin/HEAD\t${s}\t100\trefs/remotes/origin/main`,
    `refs/remotes/origin/feat/x\t${s}\t100\t`,
    `refs/remotes/origin/bad\tnot-a-sha\t100\t`,
    `refs/heads/other\t${s}\t100\t`,
  ].join('\n'), 'refs/remotes/origin/');
  assert.deepEqual(refs, [{ branch: 'feat/x', sha: s, lastCommitAt: 100000 }]);
  assert.deepEqual(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)'), { files: 3, ins: 10, del: 2 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)'), { files: 1, ins: 1, del: 0 });
  assert.deepEqual(packagesFor(['web/a.ts', 'x.txt'], PACKAGES), ['web', 'core']);
  assert.deepEqual(packagesFor(['z.txt'], PACKAGES), []);
});

test('gitenv: names and refs', () => {
  assert.equal(safeRepoName('acme/web'), 'acme_web');
  assert.equal(safeRepoName('..'), '_');
  assert.ok(!scratchDir('../../etc', '/c').includes('..'));
  assert.equal(mirrorRef('origin/main'), 'refs/heads/main');
  assert.equal(mirrorRef('refs/remotes/origin/dev'), 'refs/heads/dev');
  assert.equal(mirrorRef('main'), 'refs/heads/main');
});

test('touches(a) is x.txt; branchInfo has size and ahead/behind', async () => {
  const env = await scratchEnv({ name: 'fx', dir: fx.work }, { cacheDir: fx.cacheDir });
  assert.deepEqual(await touches(fx.work, fx.sha.a, fx.sha.main0, { env }), ['x.txt']);
  assert.deepEqual(await touches(fx.work, fx.sha.d, fx.sha.main0, { env }), ['x.txt', 'z.txt']);
  const info = await branchInfo(fx.work, fx.sha.a, fx.sha.main0, { env });
  assert.equal(info.mergeBase, fx.sha.main0);
  assert.equal(info.ahead, 1);
  assert.equal(info.behind, 0);
  assert.deepEqual(info.size, { files: 1, ins: 1, del: 1 });
  assert.deepEqual(await touches(fx.work, 'not-a-sha', fx.sha.main0, { env }), []);
});

test('collectBranches: local and remote-only branches, window and merged dropped', async () => {
  _clearCache();
  const res = await collectBranches({ name: 'fx', dir: fx.work, packages: PACKAGES }, {
    cacheDir: fx.cacheDir,
    worktrees: [{ id: 'fx', root: fx.work }, { id: 'c', root: fx.wtc }, { id: 'elsewhere', root: TMP }],
  });
  assert.deepEqual(res.errors, []);
  assert.equal(res.mainSha, fx.sha.main0);
  assert.equal(res.source, 'refs');
  assert.ok(res.refsAt > 0);
  const by = Object.fromEntries(res.branches.map((b) => [b.branch, b]));
  assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'c', 'd', 'gone']);
  // local lane (worktree c, never pushed)
  assert.equal(by.c.local, true);
  assert.equal(by.c.pushed, false);
  assert.equal(by.c.laneId, 'c');
  assert.deepEqual(by.c.files, ['y.txt']);
  assert.deepEqual(by.c.packages, ['core']);
  assert.ok(by.c.lastCommitAt > 0);
  // remote-only branch, deleted locally, found via refs/remotes
  assert.equal(by.gone.local, false);
  assert.equal(by.gone.pushed, true);
  assert.equal(by.gone.laneId, null);
  assert.equal(by.gone.sha, fx.sha.gone);
  assert.deepEqual(by.gone.files, ['web/app.ts']);
  assert.deepEqual(by.gone.packages, ['web']);
  assert.deepEqual(by.a.files, ['x.txt']);
  for (const b of res.branches) {
    for (const k of ['repo', 'branch', 'sha', 'local', 'pushed', 'laneId', 'mergeBase', 'ahead', 'behind', 'lastCommitAt', 'files', 'packages', 'size']) {
      assert.ok(k in b, `${b.branch} has ${k}`);
    }
  }
  assert.equal(res.branches[0].branch, 'c', 'local lanes first');
});

test('collectBranches: a local branch that is also pushed uses the local head', async () => {
  const res = await collectBranches({ name: 'fx', dir: fx.work }, {
    cacheDir: fx.cacheDir, worktrees: [{ id: 'lane-a', root: fx.work, branch: 'a', head: fx.sha.a }],
  });
  const a = res.branches.find((b) => b.branch === 'a');
  assert.equal(a.local, true);
  assert.equal(a.pushed, true);
  assert.equal(a.laneId, 'lane-a');
});

test('collectBranches: maxBranches caps remote-only, cache hits on the second pass', async () => {
  _clearCache();
  const opts = { cacheDir: fx.cacheDir, maxBranches: 2 };
  const one = await collectBranches({ name: 'fx', dir: fx.work }, opts);
  assert.equal(one.branches.length, 2);
  const before = cacheStats();
  await collectBranches({ name: 'fx', dir: fx.work }, opts);
  const after = cacheStats();
  assert.equal(after.hits - before.hits, 2);
  assert.equal(after.misses, before.misses);
  // branchWindowDays wide enough lets the old branch in
  const wide = await collectBranches({ name: 'fx', dir: fx.work }, { cacheDir: fx.cacheDir, branchWindowDays: 365 * 50 });
  assert.ok(wide.branches.some((b) => b.branch === 'old'));
  assert.ok(!wide.branches.some((b) => b.branch === 'merged'));
});

test('collectBranches: not a repo / unresolvable main', async () => {
  const notRepo = path.join(TMP, 'plain');
  fs.mkdirSync(notRepo);
  assert.deepEqual((await collectBranches({ name: 'p', dir: notRepo }, { cacheDir: fx.cacheDir })).errors, ['not a git repo']);
  const r = await collectBranches({ name: 'fx', dir: fx.work }, { cacheDir: fx.cacheDir, mainRef: 'origin/nope' });
  assert.equal(r.mainSha, null);
  assert.match(r.errors[0], /cannot resolve/);
});

test('scratch env: merge-tree writes nothing into the repo object store', async () => {
  const objects = path.join(fx.work, '.git', 'objects');
  const env = await scratchEnv({ name: 'fx', dir: fx.wtc }, { cacheDir: fx.cacheDir }); // via a worktree
  assert.equal(env.GIT_OBJECT_DIRECTORY, scratchDir('fx', fx.cacheDir));
  assert.equal(env.GIT_ALTERNATE_OBJECT_DIRECTORIES.split(':')[0], fs.realpathSync(objects));
  const before = countFiles(objects);
  const scratchBefore = countFiles(env.GIT_OBJECT_DIRECTORY);
  let code = 0, out = '';
  try {
    out = execFileSync('git', ['-C', fx.work, 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', fx.sha.a, fx.sha.b],
      { env: withEnv(env), encoding: 'utf8' });
  } catch (e) { code = e.status; out = e.stdout; }
  assert.equal(code, 1, 'a and b conflict');
  assert.deepEqual(out.split('\0').filter(Boolean).slice(1), ['x.txt']);
  assert.equal(countFiles(objects), before, 'repo objects unchanged');
  assert.ok(countFiles(env.GIT_OBJECT_DIRECTORY) > scratchBefore, 'objects landed in the scratch dir');
  // control: the same merge-tree without the scratch env does write (on a throwaway clone)
  const ctl = path.join(fx.root, 'control');
  git(fx.root, 'clone', '-q', fx.origin, ctl);
  const ctlObjects = path.join(ctl, '.git', 'objects');
  const ctlBefore = countFiles(ctlObjects);
  try { execFileSync('git', ['-C', ctl, 'merge-tree', '--write-tree', fx.sha.a, fx.sha.b], { stdio: 'ignore' }); } catch { /* exit 1 */ }
  assert.ok(countFiles(ctlObjects) > ctlBefore, 'control run writes objects');
});

test('pruneScratch: by age and by size, refuses other dirs', async () => {
  const cache = path.join(fx.root, 'prune-cache');
  const dir = scratchDir('p', cache);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.created'), String(Date.now()));
  fs.writeFileSync(path.join(dir, 'blob'), Buffer.alloc(2048));
  assert.deepEqual(await pruneScratch(dir, { force: true }), { pruned: false });
  assert.deepEqual(await pruneScratch(dir, { force: true, maxBytes: 1024 }), { pruned: true, reason: 'size' });
  assert.equal(fs.existsSync(dir), false);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.created'), String(Date.now() - 8 * 24 * 3600 * 1000));
  assert.deepEqual(await pruneScratch(dir, { force: true }), { pruned: true, reason: 'age' });
  await assert.rejects(pruneScratch(fx.work, { force: true }), /non-scratch/);
  assert.ok(fs.existsSync(path.join(fx.work, '.git')));
});

test('mirror: cloned from origin, fetched, used for refs; checkout untouched', async () => {
  const m = buildFixture('mx');
  const repo = { name: 'mx', dir: m.work, packages: PACKAGES };
  const objects = path.join(m.work, '.git', 'objects');
  const refsBefore = git(m.work, 'for-each-ref');
  const objBefore = countFiles(objects);

  const missing = await collectBranches(repo, { cacheDir: m.cacheDir, fetch: 'mirror' });
  assert.match(missing.errors[0], /mirror missing/);
  assert.equal(missing.source, 'refs');

  const s1 = await syncMirror(repo, { cacheDir: m.cacheDir });
  assert.equal(s1.ok, true, s1.error);
  assert.equal(s1.fetched, true);
  assert.equal(s1.dir, mirrorDir('mx', m.cacheDir));
  const s2 = await syncMirror(repo, { cacheDir: m.cacheDir });
  assert.equal(s2.fetched, false, 'throttled by fetchEverySec');

  // a branch pushed by someone else (another clone) shows up only after a mirror fetch
  const other = path.join(m.root, 'other');
  git(m.root, 'clone', '-q', m.origin, other);
  git(other, 'checkout', '-q', '-b', 'theirs');
  const theirs = commit(other, 'web/theirs.ts', 'theirs\n', 'theirs');
  git(other, 'push', '-q', 'origin', 'theirs');
  git(other, 'push', '-q', 'origin', '--delete', 'b');

  const s3 = await syncMirror(repo, { cacheDir: m.cacheDir, force: true });
  assert.equal(s3.fetched, true, s3.error);
  const res = await collectBranches(repo, { cacheDir: m.cacheDir, fetch: 'mirror' });
  assert.deepEqual(res.errors, []);
  assert.equal(res.source, 'mirror');
  const by = Object.fromEntries(res.branches.map((b) => [b.branch, b]));
  assert.equal(by.theirs.sha, theirs, 'object only in the mirror, read via alternates');
  assert.deepEqual(by.theirs.files, ['web/theirs.ts']);
  assert.ok(!('b' in by), 'pruned branch gone');

  assert.equal(git(m.work, 'for-each-ref'), refsBefore, 'checkout refs untouched');
  assert.equal(countFiles(objects), objBefore, 'checkout objects untouched');
  assert.throws(() => execFileSync('git', ['-C', m.work, 'cat-file', '-e', theirs], { stdio: 'ignore' }), 'checkout never received the object');
});

test('mirror: refuses ext:: and option-looking origins', async () => {
  const root = path.join(TMP, 'evil');
  fs.mkdirSync(root);
  git(root, 'init', '-q', 'w');
  const w = path.join(root, 'w');
  const marker = path.join(root, 'pwned');
  git(w, 'remote', 'add', 'origin', `ext::sh -c touch% ${marker}`);
  const r1 = await syncMirror({ name: 'evil', dir: w }, { cacheDir: path.join(root, 'cache') });
  assert.equal(r1.ok, false);
  assert.equal(fs.existsSync(marker), false);
  git(w, 'remote', 'remove', 'origin');
  fs.appendFileSync(path.join(w, '.git', 'config'), '[remote "origin"]\n\turl = --upload-pack=touch\n');
  const r2 = await syncMirror({ name: 'evil2', dir: w }, { cacheDir: path.join(root, 'cache') });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /refusing/);
  fs.mkdirSync(path.join(root, 'plain'));
  const r3 = await syncMirror({ name: 'none', dir: path.join(root, 'plain') }, { cacheDir: path.join(root, 'cache') });
  assert.equal(r3.ok, false);
});
