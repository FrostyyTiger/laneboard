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
const { collectBranches, touches, branchInfo, packagesFor, parseRefs, parseShortstat, cacheStats, _clearCache, isSha } = branches;

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
  assert.equal(path.dirname(scratchDir('../../etc', '/c')), '/c/scratch-objects');
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

// ---------------------------------------------------------------------------
// P7: conflict prediction, merge order, stale branches.

const conflicts = await import('../server/packages/conflicts.mjs');
const order = await import('../server/packages/order.mjs');
const stale = await import('../server/packages/stale.mjs');
const { run: realRun } = await import('../server/util.mjs');
const { mergeTree, predictConflicts, overlapPairs, hotspots, parseGitVersion, atLeast, parseMergeTree, gitVersion, textualAvailable } = conflicts;
const { mergeOrder, dependencies, isCandidate } = order;
const { staleBranches, deleteCommand, shellQuote } = stale;

// Spy on every git call; `fake(args)` may return a result to short-circuit.
function spyGit(fake) {
  const calls = [];
  gitenv._setRunner(async (cmd, args, opts) => {
    calls.push(args);
    const f = fake?.(args);
    return f ?? realRun(cmd, args, opts);
  });
  return calls;
}
const mergeTreeCalls = (calls) => calls.filter((a) => a.includes('merge-tree'));
const resetSpies = () => { gitenv._setRunner(null); conflicts._clearCache(); order._clearCache(); };

const cx = buildFixture('cx');
const cxRepo = { name: 'cx', dir: cx.work, packages: PACKAGES };
// main moves on a file no branch touches
cx.sha.main1 = (() => { git(cx.work, 'checkout', '-q', 'main'); return commit(cx.work, 'w.txt', 'w\n', 'main moves'); })();
const cxEnv = await scratchEnv(cxRepo, { cacheDir: cx.cacheDir });
async function cxBranches(mainSha = cx.sha.main1) {
  _clearCache();
  const res = await collectBranches(cxRepo, { cacheDir: cx.cacheDir, mainRef: mainSha, worktrees: [{ id: 'c', root: cx.wtc }] });
  assert.deepEqual(res.errors, []);
  return res;
}

test('git version parsing and the 2.38 gate', async () => {
  assert.deepEqual(parseGitVersion('git version 2.43.0\n'), [2, 43, 0]);
  assert.deepEqual(parseGitVersion('git version 2.39.3 (Apple Git-146)'), [2, 39, 3]);
  assert.equal(parseGitVersion('nope'), null);
  assert.equal(atLeast([2, 38, 0]), true);
  assert.equal(atLeast([2, 37, 9]), false);
  assert.equal(atLeast([3, 0, 0]), true);
  assert.equal(atLeast(null), false);
  resetSpies();
  const calls = spyGit();
  const v = await gitVersion();
  await gitVersion();
  assert.equal(calls.filter((a) => a[0] === 'version').length, 1, 'checked once');
  assert.equal(v.textual, atLeast(v.version));
  assert.equal(await textualAvailable(), v.textual);
  resetSpies();
  assert.deepEqual(parseMergeTree(`${'e'.repeat(40)}\0x.txt\0x.txt\0y.txt\0`), { tree: 'e'.repeat(40), files: ['x.txt', 'y.txt'] });
});

test('mergeTree: a/b conflict on x.txt, a/c clean, bad input refused', async () => {
  resetSpies();
  assert.deepEqual(await mergeTree(cx.work, cx.sha.a, cx.sha.b, { env: cxEnv }), { clean: false, files: ['x.txt'] });
  assert.deepEqual(await mergeTree(cx.work, cx.sha.a, cx.sha.c, { env: cxEnv }), { clean: true, files: [] });
  assert.deepEqual(await mergeTree(cx.work, cx.sha.b, cx.sha.a, { env: cxEnv }), { clean: false, files: ['x.txt'] }, 'symmetric');
  assert.deepEqual(await mergeTree(cx.work, '--output=/tmp/x', cx.sha.a, { env: cxEnv }), { error: 'bad sha' });
  assert.deepEqual(await mergeTree(cx.work, cx.sha.a, cx.sha.b, {}), { error: 'no scratch env' }, 'never runs without the scratch env');
  const missing = 'f'.repeat(40);
  assert.ok((await mergeTree(cx.work, cx.sha.a, missing, { env: cxEnv })).error, 'unknown commit -> error');
});

test('predictConflicts: pairs pre-filtered by touches, vsMain clean, cache hits, repo objects unchanged', async () => {
  const { branches: brs, mainSha } = await cxBranches();
  const objects = path.join(cx.work, '.git', 'objects');
  const objBefore = countFiles(objects);
  resetSpies();
  const calls = spyGit();
  const res = await predictConflicts(cxRepo, { branches: brs, mainSha }, { env: cxEnv, now: 1000 });
  assert.equal(res.textual, true);
  assert.deepEqual(res.errors, []);
  // no branch conflicts with main (main moved on w.txt only)
  assert.ok(!res.conflicts.some((c) => c.b.main), 'vsMain clean');
  const pairs = res.conflicts.map((c) => [c.a.branch, c.b.branch].sort().join('|')).sort();
  assert.deepEqual(pairs, ['a|b', 'b|d']);
  for (const c of res.conflicts) {
    assert.equal(c.kind, 'textual');
    assert.deepEqual(c.files, ['x.txt']);
    assert.equal(c.at, 1000);
    assert.ok(isSha(c.a.sha) && isSha(c.b.sha));
  }
  // the pre-filter skipped (b,c): disjoint files, never merge-treed
  const mt = mergeTreeCalls(calls);
  const ran = (x, y) => mt.some((a) => a.includes(x) && a.includes(y));
  assert.equal(ran(cx.sha.b, cx.sha.c), false, '(b,c) skipped');
  assert.equal(ran(cx.sha.a, cx.sha.b), true);
  assert.equal(ran(cx.sha.a, cx.sha.c), false);
  assert.ok(res.skipped > 0);
  // 5 branches vs main + the 3 pairs sharing x.txt (a-b, a-d, b-d)
  assert.equal(res.checked, brs.length + 3);
  assert.equal(mt.length, res.checked);
  // second pass: every pair is a cache hit
  const again = await predictConflicts(cxRepo, { branches: brs, mainSha }, { env: cxEnv, now: 1000 });
  assert.equal(mergeTreeCalls(calls).length, mt.length, 'no merge-tree on the second pass');
  assert.deepEqual(again.conflicts, res.conflicts);
  assert.ok(conflicts.cacheStats().hits >= res.checked);
  resetSpies();
  assert.equal(countFiles(objects), objBefore, 'repo objects unchanged (scratch env)');
});

test('predictConflicts: a branch that conflicts with main', async () => {
  git(cx.work, 'checkout', '-q', 'main');
  const main2 = commit(cx.work, 'x.txt', 'ONE-main\ntwo\n', 'main edits x line 1');
  const { branches: brs } = await cxBranches(main2);
  resetSpies();
  const res = await predictConflicts(cxRepo, { branches: brs, mainSha: main2 }, { env: cxEnv });
  const vsMain = res.conflicts.filter((c) => c.b.main).map((c) => c.a.branch).sort();
  assert.deepEqual(vsMain, ['a', 'b', 'd']);
  assert.ok(res.conflicts.every((c) => c.files.includes('x.txt')));
  git(cx.work, 'reset', '-q', '--hard', cx.sha.main1);
});

test('predictConflicts: with git < 2.38 faked, degrades to overlap without merge-tree', async () => {
  const { branches: brs, mainSha } = await cxBranches();
  resetSpies();
  const calls = spyGit((args) => (args[0] === 'version' ? { ok: true, stdout: 'git version 2.30.2\n', stderr: '', code: 0, signal: null } : null));
  assert.equal(await textualAvailable(), false);
  const res = await predictConflicts(cxRepo, { branches: brs, mainSha }, { env: cxEnv, now: 5 });
  assert.equal(res.textual, false);
  assert.equal(mergeTreeCalls(calls).length, 0, 'no merge-tree below 2.38');
  assert.ok(res.conflicts.every((c) => c.kind === 'overlap'));
  const pairs = res.conflicts.map((c) => (c.b.main ? `${c.a.branch}|main` : [c.a.branch, c.b.branch].sort().join('|'))).sort();
  assert.deepEqual(pairs, ['a|b', 'a|d', 'b|d'], 'file-set overlap; main moved on w.txt only');
  resetSpies();
  assert.equal(await textualAvailable(), true, 'real git on this host is >= 2.38');
});

test('overlapPairs (pure) and hotspots', () => {
  const s = (c) => c.repeat(40);
  const items = [
    { branch: 'p', sha: s('1'), files: ['a.js', 'b.js'], fkey: 'h1:p' },
    { branch: 'q', sha: s('2'), files: ['b.js', 'c.js'] },
    { branch: 'r', sha: s('3'), files: ['d.js'] },
  ];
  const ov = overlapPairs(items, { now: 7 });
  assert.deepEqual(ov, [{ a: { branch: 'p', sha: s('1'), fkey: 'h1:p' }, b: { branch: 'q', sha: s('2') }, kind: 'overlap', files: ['b.js'], at: 7 }]);
  assert.deepEqual(overlapPairs(items, { skip: new Set([conflicts.pairKey(s('2'), s('1'))]) }), [], 'textual result overrides');
  const hs = hotspots(
    [...items, { branch: 'z', sha: s('4'), files: ['b.js', 'a.js'] }],
    [{ files: ['a.js'] }, { files: ['a.js'] }, { files: ['e.js'] }],
  );
  assert.deepEqual(hs.map((h) => [h.file, h.conflicts, h.lanes.length]), [['a.js', 2, 2], ['e.js', 1, 0], ['b.js', 0, 3]]);
  assert.deepEqual(hs[0].lanes, ['h1:p', 'z']);
  assert.equal(hotspots(Array.from({ length: 30 }, (_, i) => ({ branch: `b${i}`, files: ['f' + (i % 25), 'f' + ((i + 1) % 25)] })), []).length, 20, 'top 20');
});

test('mergeOrder: dependency first, c first (no conflicts, smallest)', async () => {
  const { branches: brs, mainSha } = await cxBranches();
  resetSpies();
  const res = await predictConflicts(cxRepo, { branches: brs, mainSha }, { env: cxEnv });
  const pick = brs.filter((b) => ['a', 'b', 'c', 'd'].includes(b.branch));
  const fk = (sha) => pick.find((b) => b.sha === sha)?.branch;
  const edges = res.conflicts.map((c) => ({ a: fk(c.a.sha), b: c.b.main ? 'main:cx' : fk(c.b.sha), kind: c.kind, files: c.files.length }));
  const deps = await dependencies(cx.work, pick, { env: cxEnv });
  assert.deepEqual(deps, [[cx.sha.a, cx.sha.d]], 'd contains a');
  const cands = pick.map((b) => ({ fkey: b.branch, sha: b.sha, size: b.size }));
  const { order: o, warnings } = mergeOrder(cands, edges, deps);
  const pos = (k) => o.findIndex((x) => x.fkey === k);
  assert.equal(o[0].fkey, 'c');
  assert.ok(o[0].reasons.includes('no conflicts'));
  const sz = (b) => b.size.ins + b.size.del;
  assert.ok(pick.every((b) => sz(b) >= sz(pick.find((x) => x.branch === 'c'))), 'c is the smallest');
  assert.ok(pos('a') < pos('d'), 'a before d');
  assert.deepEqual(o.find((x) => x.fkey === 'd').after, ['a']);
  assert.deepEqual(o.map((x) => x.rank), [1, 2, 3, 4]);
  assert.ok(warnings.some((w) => w.text === 'merging a first makes b conflict on 1 file'));
  // the sha-pair cache answers the second ancestry pass without git
  const calls = spyGit();
  assert.deepEqual(await dependencies(cx.work, pick, { env: cxEnv }), deps);
  assert.equal(calls.length, 0);
  resetSpies();
});

test('mergeOrder (pure): main conflicts sink, ties by size then oldest PR, cycles survive', () => {
  const { order: o } = mergeOrder([
    { fkey: 'x', size: { ins: 1, del: 0 } },
    { fkey: 'y', size: { ins: 50, del: 0 }, prCreatedAt: '2026-01-02T00:00:00Z' },
    { fkey: 'z', size: { ins: 50, del: 0 }, pr: { createdAt: '2026-01-01T00:00:00Z' } },
    { fkey: 'x', size: { ins: 0, del: 0 } }, // duplicate ignored
    null,
  ], [{ a: 'x', b: 'main', kind: 'textual', files: 2 }, { a: 'y', b: 'z', kind: 'overlap', files: 1 }]);
  assert.deepEqual(o.map((r) => r.fkey), ['z', 'y', 'x']);
  assert.ok(o[0].reasons.includes('oldest PR'));
  assert.ok(o[2].reasons.includes('conflicts with main on 2 files'));
  const cyc = mergeOrder([{ fkey: 'p' }, { fkey: 'q' }], [], [['p', 'q'], ['q', 'p']]);
  assert.equal(cyc.order.length, 2);
  assert.ok(cyc.order[0].reasons.includes('dependency cycle'));
  assert.deepEqual(mergeOrder([], [], []), { order: [], warnings: [] });
  assert.deepEqual(mergeOrder(undefined).order, []);
});

test('isCandidate: reviewReady, done marker, open non-draft green/pending PR', () => {
  assert.equal(isCandidate({ reviewReady: true }), true);
  assert.equal(isCandidate({ marker: { kind: 'done' } }), true);
  assert.equal(isCandidate({ markers: [{ kind: 'stage' }, { kind: 'done' }] }), true);
  assert.equal(isCandidate({}, { state: 'OPEN', isDraft: false, verdict: 'green' }), true);
  assert.equal(isCandidate({ pr: { state: 'OPEN', verdict: 'pending' } }), true);
  assert.equal(isCandidate({}, { state: 'OPEN', isDraft: true, verdict: 'green' }), false);
  assert.equal(isCandidate({}, { state: 'OPEN', verdict: 'red' }), false);
  assert.equal(isCandidate({}, { state: 'MERGED', verdict: 'green' }), false);
  assert.equal(isCandidate({ marker: { kind: 'blocked' } }), false);
  assert.equal(isCandidate(null), false);
});

test('staleBranches: an old-dated branch suggests delete-branch; never executed', async () => {
  _clearCache();
  const res = await collectBranches(cxRepo, { cacheDir: cx.cacheDir, branchWindowDays: 365 * 50, worktrees: [{ id: 'c', root: cx.wtc }] });
  const before = git(cx.work, 'for-each-ref');
  const originBefore = git(cx.origin, 'for-each-ref');
  const list = staleBranches(res.branches, res.mainSha, { staleDays: 7, staleBehind: 50 });
  assert.deepEqual(list.map((s) => s.branch), ['old']);
  const [s] = list;
  assert.equal(s.sha, cx.sha.old);
  assert.equal(s.suggestion, 'delete-branch');
  assert.equal(s.laneFkey, null);
  assert.equal(s.command, 'git push origin --delete old');
  assert.ok(s.lastCommitAt < Date.parse('2020-01-02'));
  assert.match(s.reasons[0], /no commit for \d+ days/);
  assert.equal(git(cx.work, 'for-each-ref'), before, 'nothing deleted locally');
  assert.equal(git(cx.origin, 'for-each-ref'), originBefore, 'nothing deleted on origin');
});

test('staleBranches (pure): behind threshold, merged, live, retire, quoting', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const day = 24 * 3600 * 1000;
  const main = 'm'.repeat(40);
  const br = (o) => ({ sha: 'a'.repeat(40), ahead: 1, behind: 0, lastCommitAt: now - day, pushed: true, ...o });
  const list = staleBranches([
    br({ branch: 'fresh' }),
    br({ branch: 'behind', behind: 51 }),
    br({ branch: 'merged', ahead: 0, lastCommitAt: now - 30 * day }),
    br({ branch: 'main-itself', sha: main, lastCommitAt: now - 30 * day }),
    br({ branch: 'live', lastCommitAt: now - 30 * day, live: true }),
    br({ branch: 'live2', lastCommitAt: now - 30 * day, laneFkey: 'b1:live2' }),
    br({ branch: 'lane', lastCommitAt: now - 9 * day, laneFkey: 'b1:lane', record: true }),
    br({ branch: 'lane-norec', lastCommitAt: now - 9 * day, laneFkey: 'b1:x' }),
    br({ branch: 'evil$(touch x)', lastCommitAt: now - 9 * day }),
    br({ branch: 'local-only', lastCommitAt: now - 9 * day, pushed: false, local: true }),
  ], main, { now, isLive: (b) => b.laneFkey === 'b1:live2', hasRecord: () => { throw new Error('boom'); } });
  const by = Object.fromEntries(list.map((s) => [s.branch, s]));
  assert.deepEqual(Object.keys(by).sort(), ['behind', 'evil$(touch x)', 'lane', 'lane-norec', 'local-only']);
  assert.deepEqual(by.behind.reasons, ['51 commits behind main']);
  assert.equal(by.lane.suggestion, 'retire');
  assert.equal(by.lane.command, null);
  assert.equal(by.lane.laneFkey, 'b1:lane');
  assert.equal(by['lane-norec'].suggestion, 'delete-branch');
  assert.equal(by['evil$(touch x)'].command, "git push origin --delete 'evil$(touch x)'");
  assert.equal(by['local-only'].command, 'git branch -D local-only');
  assert.equal(list[list.length - 1].branch, 'behind', 'oldest first');
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(deleteCommand('-rf'), null);
  assert.equal(deleteCommand('a\nb'), null);
  assert.equal(staleBranches([br({ branch: 'x', lastCommitAt: now - 3 * day })], main, { now, staleDays: 2 }).length, 1);
  assert.deepEqual(staleBranches(null, main), []);
});
