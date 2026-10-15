// Builder lane diff (fleet §10 2.2, R2). Hermetic: a temp bare remote, a
// clone `acme` and a worktree `acme-lane1` on feat/lane1, all under a scratch
// dir that config.codeDir and lanesDir point at.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-diff-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');

const D = await import('../server/review/diff.mjs');
const store = await import('../server/lanes/store.mjs');
D.init({ lanes: () => [] });

const code = path.join(tmp, 'code');
const remote = path.join(tmp, 'acme.git');
const mainRepo = path.join(code, 'acme');
const root = path.join(code, 'acme-lane1');
fs.mkdirSync(code, { recursive: true });
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...a], { stdio: 'pipe' }).toString();
const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';

execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
execFileSync('git', ['clone', '-q', remote, mainRepo], { stdio: 'pipe' });
fs.writeFileSync(path.join(mainRepo, 'a.txt'), lines(10));
fs.writeFileSync(path.join(mainRepo, 'b.txt'), lines(30, 'rename me'));
fs.writeFileSync(path.join(mainRepo, 'keep.txt'), 'keep\n');
sh(mainRepo, 'checkout', '-q', '-b', 'main');
sh(mainRepo, 'add', '.');
sh(mainRepo, 'commit', '-q', '-m', 'base');
sh(mainRepo, 'push', '-q', '-u', 'origin', 'main');
sh(mainRepo, 'worktree', 'add', '-q', '-b', 'feat/lane1', root);

// Committed lane work.
write('a.txt', lines(10).replace('line 3\n', 'line three\nline 3b\n'));
fs.renameSync(path.join(root, 'b.txt'), path.join(root, 'c.txt'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
write('img.png', Buffer.concat([PNG, Buffer.from([0, 0, 0, 1, 2, 0, 255])]));
write('big.txt', lines(120, 'big'));
write('package-lock.json', '{\n  "lockfileVersion": 3\n}\n');
sh(root, 'add', '-A');
sh(root, 'commit', '-q', '-m', 'Stage 1: work');
sh(root, 'push', '-q', '-u', 'origin', 'feat/lane1');

// Uncommitted edit and an untracked file.
fs.writeFileSync(path.join(root, 'keep.txt'), 'keep\nuncommitted\n');
write('notes/new file.md', 'hello\n');

await store.write({ id: 'lane1', repo: 'acme', root, branch: 'feat/lane1', createdAt: 1, retiredAt: null });

// Index mtime after setup; touch a tracked file so a refreshing git would rewrite the index.
const wtIndex = path.join(mainRepo, '.git', 'worktrees', 'acme-lane1', 'index');
const later = new Date(Date.now() + 5000);
fs.utimesSync(path.join(root, 'a.txt'), later, later);
const indexMtime = fs.statSync(wtIndex).mtimeMs;

const byPath = (r) => Object.fromEntries(r.files.map((f) => [f.path, f]));

async function refused(p, status, re) {
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof D.DiffError, `expected a DiffError, got ${err}`);
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

test('modified, renamed, binary, truncated and generated files', async () => {
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', caps: { maxFileLines: 50 } });
  assert.equal(r.source, 'worktree');
  assert.equal(r.mode, 'all');
  assert.equal(r.lane, 'lane1');
  assert.equal(r.base, 'origin/main');
  assert.match(r.mergeBase, /^[0-9a-f]{40}$/);
  assert.match(r.headSha, /^[0-9a-f]{40}$/);
  const f = byPath(r);

  assert.equal(f['a.txt'].status, 'M');
  assert.equal(f['a.txt'].add, 2);
  assert.equal(f['a.txt'].del, 1);
  const h = f['a.txt'].hunks[0];
  assert.equal(h.oldStart, 1);
  assert.deepEqual(h.lines.find((l) => l.t === '-'), { t: '-', o: 3, n: null, s: 'line 3' });
  assert.deepEqual(h.lines.find((l) => l.t === '+'), { t: '+', o: null, n: 3, s: 'line three' });

  assert.equal(f['c.txt'].status, 'R');
  assert.equal(f['c.txt'].oldPath, 'b.txt');

  assert.equal(f['img.png'].binary, true);
  assert.deepEqual(f['img.png'].hunks, []);

  assert.equal(f['big.txt'].truncated, true);
  const kept = f['big.txt'].hunks.reduce((n, x) => n + x.lines.length, 0);
  assert.equal(kept, 50);
  assert.equal(r.truncated, true);

  const lock = f['package-lock.json'];
  assert.equal(lock.generated, true);
  assert.equal(lock.deferred, true);
  assert.deepEqual(lock.hunks, []);
  assert.equal(r.totals.files, r.files.length);
});

test('path= loads a deferred generated file', async () => {
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', path: 'package-lock.json' });
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].path, 'package-lock.json');
  assert.equal(r.files[0].status, 'A');
  assert.ok(r.files[0].hunks.length > 0);
  assert.ok(r.files[0].hunks[0].lines.some((l) => l.s.includes('lockfileVersion')));
});

test('path= on a rename returns its hunks against the old name', async () => {
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', path: 'c.txt' });
  assert.equal(r.files[0].status, 'R');
  assert.equal(r.files[0].oldPath, 'b.txt');
});

test('maxFiles: files past the cap are listed by name, deferred and truncated', async () => {
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', caps: { maxFiles: 2 } });
  assert.ok(r.files.length >= 3);
  assert.equal(r.files[2].deferred, true);
  assert.equal(r.files[2].truncated, true);
  assert.deepEqual(r.files[2].hunks, []);
  assert.equal(r.files[0].deferred, false);
  assert.equal(r.truncated, true);
});

test('maxBytes budget defers files that would not fit', async () => {
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', caps: { maxBytes: 1000, maxFileBytes: 1000 } });
  const f = byPath(r);
  assert.equal(f['big.txt'].deferred, true);
  assert.equal(f['a.txt'].deferred, false);
  assert.ok(f['a.txt'].hunks.length > 0);
  assert.equal(r.truncated, true);
});

test('an uncommitted edit shows in mode all, not in mode committed; untracked listed by name', async () => {
  const all = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', mode: 'all' });
  assert.ok(byPath(all)['keep.txt'], 'keep.txt in mode all');
  assert.deepEqual(all.untracked, ['notes/new file.md']);
  assert.equal(all.untrackedTruncated, false);

  const committed = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', mode: 'committed' });
  assert.equal(committed.mode, 'committed');
  assert.equal(byPath(committed)['keep.txt'], undefined);
  assert.deepEqual(committed.untracked, []);
});

test('the default base comes from config (origin/main)', async () => {
  const r = await D.laneDiff({ laneId: 'lane1' });
  assert.equal(r.base, 'origin/main');
});

test('input checks: bad base, mode, path and lane id are refused', async () => {
  await refused(D.laneDiff({ laneId: 'lane1', base: '--output=/tmp/x' }), 400);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main;rm' }), 400);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/../x' }), 400);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main', path: '../etc/passwd' }), 404);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main', path: '*' }), 404);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main', path: 'a\0b' }), 400);
  await refused(D.laneDiff({ laneId: 'lane1', mode: 'everything' }), 400);
  await refused(D.laneDiff({ laneId: '../lane1' }), 400);
  await refused(D.laneDiff({ laneId: 'nosuch' }), 404);
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/nosuch' }), 404, /not found/);
});

test('one diff at a time: a concurrent call gets 429', async () => {
  const first = D.laneDiff({ laneId: 'lane1', base: 'origin/main' });
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main' }), 429);
  await first;
  // The gate is released afterwards.
  await D.laneDiff({ laneId: 'lane1', base: 'origin/main' });
});

test('no writes: no index.lock and the worktree index is untouched', async () => {
  await D.laneDiff({ laneId: 'lane1', base: 'origin/main', mode: 'all' });
  assert.equal(fs.existsSync(wtIndex + '.lock'), false);
  assert.equal(fs.existsSync(path.join(mainRepo, '.git', 'index.lock')), false);
  assert.equal(fs.statSync(wtIndex).mtimeMs, indexMtime);
});

test('remote fallback: no worktree dir -> diff of origin/feat/lane1 from acme; no remote branch -> 404', async () => {
  fs.rmSync(root, { recursive: true, force: true });
  const r = await D.laneDiff({ laneId: 'lane1', base: 'origin/main', mode: 'all' });
  assert.equal(r.source, 'remote');
  assert.equal(r.mode, 'committed');
  assert.equal(r.head, 'origin/feat/lane1');
  const f = byPath(r);
  assert.ok(f['a.txt']);
  assert.equal(f['keep.txt'], undefined);
  assert.deepEqual(r.untracked, []);

  sh(mainRepo, 'push', '-q', 'origin', '--delete', 'feat/lane1');
  await refused(D.laneDiff({ laneId: 'lane1', base: 'origin/main' }), 404, /not on origin/);
});

test('parseNumstatZ: plain, binary and rename records', () => {
  const buf = Buffer.from('3\t1\ta.txt\0-\t-\timg.png\0' + '0\t0\t\0old name\0new name\0' + '2\t0\ttab\tname\0');
  assert.deepEqual(D.parseNumstatZ(buf), [
    { path: 'a.txt', oldPath: null, add: 3, del: 1, binary: false },
    { path: 'img.png', oldPath: null, add: 0, del: 0, binary: true },
    { path: 'new name', oldPath: 'old name', add: 0, del: 0, binary: false },
    { path: 'tab\tname', oldPath: null, add: 2, del: 0, binary: false },
  ]);
});

test('parseUnifiedDiff: no-newline marker, CRLF, NUL and names', () => {
  const text = [
    'diff --git a/x y.txt b/x y.txt',
    'index 1111111..2222222 100644',
    '--- a/x y.txt\t',
    '+++ b/x y.txt\t',
    '@@ -1,2 +1,2 @@ section <b>',
    ' same\r',
    '-old\r',
    '\\ No newline at end of file',
    '+new\0bad\r',
    '\\ No newline at end of file',
    'diff --git "a/q\\"t.txt" "b/q\\"t.txt"',
    'new file mode 100644',
    '--- /dev/null',
    '+++ "b/q\\"t.txt"',
    '@@ -0,0 +1 @@',
    '+<img src=x onerror=alert(1)>',
    'diff --git a/old.txt b/new.txt',
    'similarity index 90%',
    'rename from old.txt',
    'rename to new.txt',
    '',
  ].join('\n');
  const files = D.parseUnifiedDiff(text, { maxFileLines: 100, maxFileBytes: 10000 });
  assert.equal(files.length, 3);
  const [a, b, c] = files;
  assert.equal(a.path, 'x y.txt');
  assert.equal(a.hunks[0].header, '@@ -1,2 +1,2 @@ section <b>');
  assert.deepEqual(a.hunks[0].lines, [
    { t: ' ', o: 1, n: 1, s: 'same\r' },
    { t: '-', o: 2, n: null, s: 'old\r' },
    { t: '\\', o: null, n: null, s: 'No newline at end of file' },
    { t: '+', o: null, n: 2, s: 'new�bad\r' },
    { t: '\\', o: null, n: null, s: 'No newline at end of file' },
  ]);
  assert.equal(b.path, 'q"t.txt');
  assert.equal(b.oldPath, null);
  assert.equal(b.newFile, true);
  assert.equal(b.hunks[0].lines[0].s, '<img src=x onerror=alert(1)>');
  assert.equal(c.path, 'new.txt');
  assert.equal(c.oldPath, 'old.txt');
  assert.deepEqual(c.hunks, []);
});

test('parseUnifiedDiff: caps stop a file and mark it truncated; a content line like "diff --git" stays content', () => {
  const body = Array.from({ length: 20 }, (_, i) => `+l${i}`);
  const text = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -0,0 +1,21 @@', '+diff --git a/z b/z', ...body,
    'diff --git a/g b/g', '--- a/g', '+++ b/g', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');
  const [f, g] = D.parseUnifiedDiff(text, { maxFileLines: 5, maxFileBytes: 10000 });
  assert.equal(f.truncated, true);
  assert.equal(f.hunks[0].lines.length, 5);
  assert.equal(f.hunks[0].lines[0].s, 'diff --git a/z b/z');
  assert.equal(g.path, 'g');
  assert.equal(g.truncated, false);
  assert.equal(g.hunks[0].lines.length, 2);

  const [byBytes] = D.parseUnifiedDiff(text, { maxFileLines: 100, maxFileBytes: 30 });
  assert.equal(byBytes.truncated, true);
  assert.ok(byBytes.bytes <= 30);
});

test('isGenerated: basename globs match anywhere, path globs match the path', () => {
  const g = ['package-lock.json', '*.lock', '*.min.js', 'dist/**'];
  assert.equal(D.isGenerated(g, 'web/package-lock.json'), true);
  assert.equal(D.isGenerated(g, 'sub/yarn.lock'), true);
  assert.equal(D.isGenerated(g, 'dist/a/b.js'), true);
  assert.equal(D.isGenerated(g, 'src/dist/b.js'), false);
  assert.equal(D.isGenerated(g, 'src/a.js'), false);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
