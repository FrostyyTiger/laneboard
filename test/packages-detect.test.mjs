// Package auto-detect (fleet §6.3, P3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectPackages, detectPackagesAsync, manifestPaths, createDetectCache,
  tomlSection, tomlStringArray, escapeGlob,
} from '../server/packages/detect.mjs';
import { matchAny } from '../server/packages/glob.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOS = path.join(HERE, 'fixtures', 'repos');

// A fixture dir as `git ls-tree -r --name-only` + `git show` would see it.
function fixture(name) {
  const root = path.join(REPOS, name);
  const tree = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else tree.push(r);
    }
  };
  walk('');
  const reads = [];
  const readFile = (p) => {
    reads.push(p);
    try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return null; }
  };
  return { tree: tree.sort(), readFile, reads };
}

// An in-memory repo: {path: text}.
function mem(files) {
  return { tree: Object.keys(files), readFile: (p) => (p in files ? files[p] : null) };
}

const brief = (list) => list.map((p) => [p.name, p.kind, ...p.paths]);

test('npm workspaces ["apps/*","lib"] give one package per dir', () => {
  const { tree, readFile } = fixture('npm-ws');
  const got = detectPackages(tree, readFile);
  assert.deepEqual(brief(got), [
    ['api', 'npm', 'apps/api/**'],
    ['web', 'npm', 'apps/web/**'],
    ['lib', 'npm', 'lib/**'],
  ]);
  for (const p of got) assert.equal(p.source, 'auto');
  // apps/notes has no package.json; lib's CLAUDE.md and own package.json dedupe.
  assert.ok(!got.some((p) => p.name === 'notes'));
});

test('npm workspaces object form and excludes', () => {
  const { tree, readFile } = mem({
    'package.json': JSON.stringify({ workspaces: { packages: ['pkgs/*', '!pkgs/old'] } }),
    'pkgs/a/package.json': '{}', 'pkgs/b/package.json': '{}', 'pkgs/old/package.json': '{}',
  });
  assert.deepEqual(detectPackages(tree, readFile).map((p) => p.name), ['a', 'b']);
});

test('setuptools packages.find include over several lines gives core, api', () => {
  const { tree, readFile } = fixture('py-find');
  const got = detectPackages(tree, readFile);
  assert.deepEqual(brief(got), [
    ['api', 'python', 'api/**'],
    ['core', 'python', 'core/**'],
  ]);
});

test('core* matches a core_extra/ dir only when it exists', () => {
  const toml = '[tool.setuptools.packages.find]\ninclude = [\n  "core*",\n  "api*",\n]\n';
  const without = mem({ 'pyproject.toml': toml, 'core/__init__.py': '', 'api/__init__.py': '' });
  assert.deepEqual(detectPackages(without.tree, without.readFile).map((p) => p.name), ['api', 'core']);
  const withExtra = mem({
    'pyproject.toml': toml, 'core/__init__.py': '', 'api/__init__.py': '', 'core_extra/x.py': '',
  });
  assert.deepEqual(detectPackages(withExtra.tree, withExtra.readFile).map((p) => p.name),
    ['api', 'core', 'core_extra']);
});

test('setuptools where = ["src"] and dotted includes', () => {
  const { tree, readFile } = mem({
    'pyproject.toml': '[tool.setuptools.packages.find]\nwhere = ["src"]\ninclude = ["acme.*", "acme"]\n',
    'src/acme/__init__.py': '', 'src/acme/sub/__init__.py': '', 'src/other/__init__.py': '',
  });
  assert.deepEqual(brief(detectPackages(tree, readFile)), [['acme', 'python', 'src/acme/**']]);
});

test('poetry packages and explicit setuptools packages', () => {
  const poetry = mem({
    'pyproject.toml': '[tool.poetry]\nname = "x"\npackages = [\n  { include = "svc" },\n  { include = "lib", from = "src" },\n]\n',
    'svc/__init__.py': '', 'src/lib/__init__.py': '',
  });
  assert.deepEqual(brief(detectPackages(poetry.tree, poetry.readFile)),
    [['svc', 'python', 'svc/**'], ['lib', 'python', 'src/lib/**']]);
  const explicit = mem({
    'pyproject.toml': '[tool.setuptools]\npackages = ["alpha", "beta.sub"]\n',
    'alpha/__init__.py': '', 'beta/sub/__init__.py': '',
  });
  assert.deepEqual(detectPackages(explicit.tree, explicit.readFile).map((p) => p.name), ['alpha', 'beta']);
});

test('root Cargo workspace members give one package each (exclude honoured)', () => {
  const { tree, readFile } = fixture('cargo-ws');
  assert.deepEqual(brief(detectPackages(tree, readFile)), [
    ['parser', 'cargo', 'crates/parser/**'],
    ['render', 'cargo', 'crates/render/**'],
    ['cli', 'cargo', 'cli/**'],
  ]);
});

test('CLAUDE.md dirs give kind claude; the root and hidden dirs do not', () => {
  const { tree, readFile } = fixture('claude-dirs');
  assert.deepEqual(brief(detectPackages(tree, readFile)), [
    ['infra', 'claude', 'infra/**'],
    ['web', 'claude', 'web/**'],
  ]);
});

test('mixed repo: sub-dir manifests, cargo parts, coverage, a name collision', () => {
  const { tree, readFile } = fixture('mixed');
  const got = detectPackages(tree, readFile);
  assert.deepEqual(brief(got), [
    ['app', 'npm', 'packages/app/**'],
    ['ui', 'npm', 'packages/ui/**'],
    ['app-desktop', 'npm', 'desktop/app/**'],
    ['engine', 'cargo', 'engine/**'],
    ['service', 'python', 'service/**'],
    ['ops', 'claude', 'ops/**'],
  ]);
  assert.deepEqual(got.find((p) => p.name === 'engine').parts, ['crates/core', 'crates/io']);
  // packages/ and desktop/ have a CLAUDE.md but are covered by rule 1.
  assert.ok(!got.some((p) => p.name === 'packages' || p.name === 'desktop'));
  // Every package path is a valid glob that matches its own files.
  assert.equal(matchAny(got[0].paths, 'packages/app/src/app.ts'), true);
  assert.equal(matchAny(got[0].paths, 'packages/ui/src/button.ts'), false);
});

test('a sub-dir pyproject.toml gives the dir as a package', () => {
  const { tree, readFile } = mem({ 'tools/pyproject.toml': '[project]\nname="t"\n', 'tools/cli.py': '' });
  assert.deepEqual(brief(detectPackages(tree, readFile)), [['tools', 'python', 'tools/**']]);
});

test('rules dedupe by path', () => {
  const { tree, readFile } = mem({
    'package.json': JSON.stringify({ workspaces: ['web', 'web'] }),
    'web/package.json': '{}', 'web/CLAUDE.md': '#',
    'Cargo.toml': '[workspace]\nmembers = ["web"]\n', 'web/Cargo.toml': '[package]\n',
  });
  const got = detectPackages(tree, readFile);
  assert.deepEqual(brief(got), [['web', 'npm', 'web/**']]);
});

test('name collisions without a parent get a counter', () => {
  const { tree, readFile } = mem({
    'pyproject.toml': '[tool.poetry]\npackages = [{ include = "x", from = "a" }, { include = "x", from = "b" }]\n',
    'a/x/__init__.py': '', 'b/x/__init__.py': '', 'x/package.json': '{}',
  });
  assert.deepEqual(detectPackages(tree, readFile).map((p) => p.name), ['x', 'x-b', 'x-2']);
});

test('bad input is skipped, not thrown', () => {
  const { tree } = mem({
    'package.json': '{ not json', 'pyproject.toml': '[tool.setuptools.packages.find]\ninclude = [',
    'Cargo.toml': '[workspace]\nmembers = "nope"\n', 'a/b.txt': '',
  });
  assert.deepEqual(detectPackages(tree, (p) => (p === 'Cargo.toml' ? '[workspace]\nmembers = "x"' : '{ not json')), []);
  assert.deepEqual(detectPackages(tree, () => { throw new Error('git show failed'); }), []);
  assert.deepEqual(detectPackages(null, null), []);
  // Hostile workspace globs are dropped one by one.
  const ws = mem({ 'package.json': JSON.stringify({ workspaces: ['{a', 42, 'ok'] }), 'ok/package.json': '{}' });
  assert.deepEqual(detectPackages(ws.tree, ws.readFile).map((p) => p.name), ['ok']);
});

test('glob metacharacters in dir names are escaped in paths', () => {
  const { tree, readFile } = mem({ 'we*rd{x}/CLAUDE.md': '#', 'we*rd{x}/a.txt': '', 'weZrdx/b.txt': '' });
  const [p] = detectPackages(tree, readFile);
  assert.equal(p.name, 'we*rd{x}');
  assert.deepEqual(p.paths, [`${escapeGlob('we*rd{x}')}/**`]);
  assert.equal(matchAny(p.paths, 'we*rd{x}/a.txt'), true);
  assert.equal(matchAny(p.paths, 'weZrdx/b.txt'), false);
});

test('minimal TOML reader: sections, multi-line arrays, comments, quotes', () => {
  const t = '[a]\nx = [\n  "p", # c\n  \'q\', "r#s",\n]\n[a.b]\nx = ["no"]\n';
  assert.deepEqual(tomlStringArray(tomlSection(t, 'a'), 'x'), ['p', 'q', 'r#s']);
  assert.deepEqual(tomlStringArray(tomlSection(t, 'a.b'), 'x'), ['no']);
  assert.equal(tomlSection(t, 'zzz'), null);
});

test('reads are few: manifestPaths lists them, async variant agrees', async () => {
  const fx = fixture('mixed');
  const sync = detectPackages(fx.tree, fx.readFile);
  assert.ok(fx.reads.length <= 5, `reads: ${fx.reads.join(', ')}`);
  assert.deepEqual(manifestPaths(fx.tree), ['package.json', 'engine/Cargo.toml']);
  const fs2 = fixture('mixed');
  const async = await detectPackagesAsync(fs2.tree, async (p) => fs2.readFile(p));
  assert.deepEqual(async, sync);
});

test('cache by (repo, mainSha): computes once, a new sha replaces the old', async () => {
  const c = createDetectCache({ max: 3 });
  let n = 0;
  const compute = () => { n++; return [{ name: 'x' }]; };
  const a = c.get('acme', 's1', compute);
  assert.equal(c.get('acme', 's1', compute), a);
  assert.equal(n, 1);
  c.get('acme', 's2', compute);
  assert.equal(n, 2);
  assert.equal(c.has('acme', 's1'), false);
  c.get('other', 's1', compute);
  assert.equal(c.size, 2);
  assert.equal(c.get('acme', 'nope'), undefined);
  // A rejected async compute is not cached.
  const p = c.get('bad', 's', () => Promise.reject(new Error('x')));
  await assert.rejects(p);
  assert.equal(c.has('bad', 's'), false);
});
