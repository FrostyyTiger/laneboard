// Workflow scanner, job -> package map and jobVerdict (fleet §6, P4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanWorkflow, readYaml, stripComment, parseFilters, readWorkflows, _clearCache } from '../server/packages/workflow-scan.mjs';
import { mapJobs, tokens, packagesForGlobs, jobKey } from '../server/packages/jobmap.mjs';
import { jobVerdict, isSetupStep, withVerdicts, tested } from '../server/packages/jobs.mjs';
import { normaliseJobs } from '../server/providers/ci/gh.mjs';

const FIX = path.join(import.meta.dirname, 'fixtures', 'workflows');
const load = (f) => scanWorkflow(fs.readFileSync(path.join(FIX, f), 'utf8'), f);
const pkg = (name, ...paths) => ({ name, paths });
const PKGS = [pkg('web', 'web/**'), pkg('web-admin', 'web-admin/**'), pkg('api', 'api/**'), pkg('core', 'core/**'), pkg('pkg', 'pkg/**')];
const job = (wf, id) => wf.jobs.find((j) => j.id === id);

// --- scanner -----------------------------------------------------------------

test('gates.yml: changes job exports dorny filters, gated jobs carry gates', () => {
  const wf = load('gates.yml');
  assert.equal(wf.name, 'CI');
  assert.equal(wf.file, 'gates.yml');
  assert.deepEqual(wf.on.events, ['push', 'pull_request']);
  assert.deepEqual(wf.warnings, []);
  assert.deepEqual(wf.jobs.map((j) => j.id), ['changes', 'web-check', 'web-admin-check', 'lint-and-test', 'promote']);
  const ch = job(wf, 'changes');
  assert.deepEqual(ch.filters, { code: ['**/*.py', 'pyproject.toml'], web: ['web/**'], web_admin: ['web-admin/**'] });
  assert.deepEqual(ch.stepFilters, ch.filters);
  assert.deepEqual(job(wf, 'web-check').gates, [{ job: 'changes', output: 'web' }]);
  assert.deepEqual(job(wf, 'web-admin-check').needs, ['changes']);
  assert.deepEqual(job(wf, 'web-admin-check').gates, [{ job: 'changes', output: 'web_admin' }]);
  assert.deepEqual(job(wf, 'lint-and-test').gates, [{ job: 'changes', output: 'code' }]);
  assert.deepEqual(job(wf, 'promote').needs, ['lint-and-test', 'web-check']);
  assert.equal(job(wf, 'promote').if, "github.ref == 'refs/heads/main'");
  assert.ok(wf.jobs.every((j) => j.prOnly === false));
});

test('workdir.yml: working-directory from defaults, steps and a matrix', () => {
  const wf = load('workdir.yml');
  assert.deepEqual(wf.on.events, ['push', 'pull_request']);
  assert.equal(job(wf, 'api').name, 'api (ruff, pytest)');
  assert.deepEqual(job(wf, 'api').workingDirs, ['api']);
  assert.equal(job(wf, 'web').name, 'web (tsc, eslint)');
  assert.deepEqual(job(wf, 'web').workingDirs, ['web']); // ./web and web/ normalise to one
  assert.deepEqual(job(wf, 'frontend-build').workingDirs, ['web', 'web-admin']);
  assert.deepEqual(job(wf, 'smoke').workingDirs, []);
});

test('dorny.yml: on.paths, filters block and job-level gates', () => {
  const wf = load('dorny.yml');
  assert.deepEqual(wf.on.paths, ['pkg/**', '.github/workflows/dorny.yml']);
  assert.deepEqual(job(wf, 'x').filters.macos, ['pkg/macos/**', 'pkg/shared/**']);
  assert.deepEqual(job(wf, 'x').filters.windows, ['pkg/windows/**', 'pkg/shared/**']);
  assert.deepEqual(job(wf, 'build-macos').gates, [{ job: 'x', output: 'macos' }]);
  assert.equal(job(wf, 'build-windows').if, "needs.x.outputs.windows == 'true'");
});

test('prOnly: job if on pull_request, or a workflow without push', () => {
  const wf = load('pronly.yml');
  assert.equal(job(wf, 'title-lint').prOnly, true);
  assert.equal(job(wf, 'web-e2e').prOnly, true); // `${{ … }}` and double quotes
  assert.equal(job(wf, 'deploy-preview').prOnly, false); // `!=` is the opposite
  const pr = load('pr-trigger.yml');
  assert.deepEqual(pr.on.events, ['pull_request']);
  assert.equal(job(pr, 'size-label').prOnly, true);
  // schedule/dispatch-only workflows run on main: not PR-only
  const sched = scanWorkflow('on:\n  schedule:\n    - cron: "0 3 * * *"\njobs:\n  nightly:\n    runs-on: x\n', 'n.yml');
  assert.equal(sched.jobs[0].prOnly, false);
});

test('scanner survives comments with ":" and quoted "#"', () => {
  const wf = load('quirks.yml');
  assert.equal(wf.name, 'Quirks: #1');
  assert.deepEqual(wf.on.events, ['push']);
  assert.deepEqual(wf.on.pathsIgnore, ['docs/**', '**/*.md']);
  assert.equal(job(wf, 'core-test').name, 'core #test');
  assert.deepEqual(wf.jobs.map((j) => j.id), ['core-test', 'other']);
  // unsupported constructs are warnings, never errors
  assert.ok(wf.warnings.some((w) => /anchor/.test(w)));
  assert.ok(wf.warnings.some((w) => /merge key/.test(w)));
  assert.ok(wf.warnings.some((w) => /flow mapping/.test(w)));
  const tree = readYaml(fs.readFileSync(path.join(FIX, 'quirks.yml'), 'utf8'));
  const steps = tree.jobs['core-test'].steps;
  assert.equal(steps[0].run, 'echo "#not a comment"'); // ` #` after a plain scalar is a comment (as in YAML)
  assert.equal(steps[1].name, "don't trip on apostrophes");
  assert.equal(steps[1].run, "echo it's fine");
  assert.equal(steps[2].run, 'echo one echo two\n');
});

test('stripComment keeps # inside quotes and words', () => {
  assert.equal(stripComment("name: 'a # b' # c"), "name: 'a # b'");
  assert.equal(stripComment('name: "a # b" # c'), 'name: "a # b"');
  assert.equal(stripComment('url: http://x/#frag'), 'url: http://x/#frag');
  assert.equal(stripComment("# key: value: 'x'"), '');
  assert.equal(stripComment("run: echo it's # here"), "run: echo it's");
  assert.equal(stripComment("x: 'it''s # in'"), "x: 'it''s # in'");
});

test('readYaml: block scalars, flow lists, quoted keys, continuation lines', () => {
  const t = readYaml([
    'a: |',
    '  line 1',
    '  # kept',
    '',
    '  line 3',
    'b: >-',
    '  folded',
    '  text',
    'c: [x, "y, z", \'w\']',
    '"d": 1',
    'e: one',
    '  two',
    'f:',
    '- p',
    '- q: 1',
    '  r: 2',
    'g:',
    '  - - nested',
  ].join('\n'));
  assert.equal(t.a, 'line 1\n# kept\n\nline 3\n');
  assert.equal(t.b, 'folded text');
  assert.deepEqual(t.c, ['x', 'y, z', 'w']);
  assert.equal(t.d, '1');
  assert.equal(t.e, 'one two');
  assert.deepEqual(t.f, ['p', { q: '1', r: '2' }]);
  assert.deepEqual(t.g, [['nested']]);
});

test('readYaml: hostile keys and junk never throw', () => {
  const w = [];
  const t = readYaml('__proto__:\n  polluted: yes\nconstructor: 1\nok: 2\n', w);
  assert.equal(t.ok, '2');
  assert.equal(Object.hasOwn(t, '__proto__'), false);
  assert.equal({}.polluted, undefined);
  assert.ok(w.length >= 2);
  for (const junk of ['', ':::', '- [', '{a: b', '\t\tx: y', 'a:\n' + '  '.repeat(200) + 'b: c', '"unterminated', '- - - -', '? x\n: y']) {
    const r = scanWorkflow(junk, 'j.yml');
    assert.ok(Array.isArray(r.jobs));
    assert.ok(Array.isArray(r.warnings));
  }
  const deep = Array.from({ length: 120 }, (_, i) => '  '.repeat(i) + `k${i}:`).join('\n');
  assert.doesNotThrow(() => scanWorkflow(deep, 'deep.yml'));
});

test('parseFilters: plain globs, change-type maps, file references', () => {
  assert.deepEqual(parseFilters("web:\n  - 'web/**'\n  - added: 'web/new/**'\napi: api/**\n"), { web: ['web/**', 'web/new/**'], api: ['api/**'] });
  const w = [];
  assert.deepEqual(parseFilters('.github/filters.yml', (x) => w.push(x)), {});
  assert.match(w[0], /filters\.yml/);
});

test('step-level dorny filter gating the same job yields stepGates', () => {
  const wf = scanWorkflow([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: x',
    '    steps:',
    '      - uses: dorny/paths-filter@v3',
    '        id: f',
    '        with:',
    '          filters: |',
    '            apps:',
    "              - 'web/**'",
    '      - run: make',
    "        if: steps.f.outputs.apps == 'true'",
  ].join('\n'), 's.yml');
  const j = wf.jobs[0];
  assert.deepEqual(j.stepFilters, { apps: ['web/**'] });
  assert.deepEqual(j.stepGates, [{ step: 'f', output: 'apps' }]);
  assert.deepEqual(j.filters, {});
  assert.deepEqual(mapJobs(PKGS, [wf])['s.yml#build'], { packages: ['web'], via: 'paths', prOnly: false });
});

// --- job map -----------------------------------------------------------------

test('tokens split on - _ space ( ) / : , and drop expressions', () => {
  assert.deepEqual(tokens('web-admin-check'), ['web', 'admin', 'check']);
  assert.deepEqual(tokens('api (ruff, pytest)'), ['api', 'ruff', 'pytest']);
  assert.deepEqual(tokens('test ${{ matrix.os }}'), ['test']);
});

test('gates.yml map: name beats gate, longest package first, unnamed gate -> *', () => {
  const m = mapJobs(PKGS, [load('gates.yml')]);
  assert.deepEqual(m['gates.yml#web-admin-check'], { packages: ['web-admin'], via: 'name', prOnly: false });
  assert.deepEqual(m['gates.yml#web-check'], { packages: ['web'], via: 'name', prOnly: false });
  assert.equal(m['gates.yml#lint-and-test'].packages, '*');
  assert.equal(m['gates.yml#changes'].packages, '*');
});

test('gate rule: output name `_` -> `-` names a package', () => {
  const wf = load('gates.yml');
  const renamed = { ...wf, jobs: wf.jobs.map((j) => (j.id === 'web-admin-check' ? { ...j, id: 'typecheck-b', name: 'typecheck-b' } : j)) };
  assert.deepEqual(mapJobs(PKGS, [renamed])['gates.yml#typecheck-b'], { packages: ['web-admin'], via: 'gate', prOnly: false });
});

test('workdir.yml map: name or working-directory hits', () => {
  const m = mapJobs(PKGS, [load('workdir.yml')]);
  assert.deepEqual(m['workdir.yml#api (ruff, pytest)'].packages, ['api']);
  assert.deepEqual(m['workdir.yml#web (tsc, eslint)'].packages, ['web']);
  assert.ok(['name', 'workdir'].includes(m['workdir.yml#api (ruff, pytest)'].via));
  assert.deepEqual(m['workdir.yml#frontend-build'], { packages: ['web', 'web-admin'], via: 'workdir', prOnly: false });
  assert.deepEqual(m['workdir.yml#smoke'], { packages: '*', via: 'default', prOnly: false });
  // without the name hit, the working directory decides
  const other = [pkg('backend', 'api/**'), pkg('frontend', 'web/**')];
  const m2 = mapJobs(other, [load('workdir.yml')]);
  assert.deepEqual(m2['workdir.yml#api (ruff, pytest)'], { packages: ['backend'], via: 'workdir', prOnly: false });
  assert.deepEqual(m2['workdir.yml#web (tsc, eslint)'], { packages: ['frontend'], via: 'workdir', prOnly: false });
});

test('dorny.yml map: a single-package workflow sends every job there', () => {
  const m = mapJobs(PKGS, [load('dorny.yml')]);
  for (const id of ['x', 'build-macos', 'build-windows']) {
    assert.deepEqual(m[`dorny.yml#${id}`], { packages: ['pkg'], via: 'paths', prOnly: false }, id);
  }
});

test('prOnly jobs keep prOnly in the map', () => {
  const m = mapJobs(PKGS, [load('pronly.yml'), load('pr-trigger.yml')]);
  assert.equal(m['pronly.yml#title-lint'].prOnly, true);
  assert.deepEqual(m['pronly.yml#web-e2e'], { packages: ['web'], via: 'name', prOnly: true });
  assert.equal(m['pr-trigger.yml#size-label'].prOnly, true);
});

test('promote/deploy/release are ignored unless configured', () => {
  const m = mapJobs(PKGS, [load('gates.yml'), load('pronly.yml')]);
  assert.deepEqual(m['gates.yml#promote'], { packages: [], via: 'ignored', ignored: true, prOnly: false });
  assert.equal(m['pronly.yml#deploy-preview'].via, 'ignored');
  const c = mapJobs(PKGS, [load('gates.yml')], { packages: [{ name: 'web', paths: ['web/**'], jobs: ['promote'] }] });
  assert.deepEqual(c['gates.yml#promote'], { packages: ['web'], via: 'config', prOnly: false });
});

test('config: packages[].jobs (scoped by workflow), global, ignoreJobs', () => {
  const cfg = {
    packages: [
      { name: 'api', paths: ['api/**'], jobs: ['lint-and-test'] },
      { name: 'core', paths: ['core/**'], jobs: ['lint-and-test'] },
      { name: 'web', paths: ['web/**'], jobs: ['smoke'], workflow: 'other.yml' },
    ],
    global: ['changes'],
    ignoreJobs: ['web-check', 'workdir.yml#smoke'],
  };
  const m = mapJobs(PKGS, [load('gates.yml'), load('workdir.yml')], cfg);
  assert.deepEqual(m['gates.yml#lint-and-test'], { packages: ['api', 'core'], via: 'config', prOnly: false });
  assert.deepEqual(m['gates.yml#changes'], { packages: '*', via: 'config', prOnly: false });
  assert.equal(jobKey('gates.yml', 'web-check') in m, false);
  assert.equal('workdir.yml#smoke' in m, false); // `workflow` scope kept `web` from claiming it
  assert.equal(m['gates.yml#web-admin-check'].via, 'name');
});

test('packagesForGlobs: prefix overlap both ways, root globs mean *', () => {
  assert.deepEqual(packagesForGlobs(PKGS, ['web/src/**/*.ts']), ['web']);
  assert.deepEqual(packagesForGlobs(PKGS, ['web-admin/**', '.github/workflows/x.yml']), ['web-admin']);
  assert.deepEqual(packagesForGlobs([pkg('desktop', 'apps/desktop/**')], ['apps/**']), ['desktop']);
  assert.deepEqual(packagesForGlobs(PKGS, ['web']), ['web']); // literal path, not web-admin
  assert.equal(packagesForGlobs(PKGS, ['**/*.py']), '*');
  assert.deepEqual(packagesForGlobs(PKGS, ['!web/**']), []);
});

test('workflow on.paths spanning two packages maps unresolved jobs to both', () => {
  const wf = scanWorkflow("on:\n  push:\n    paths: ['web/**', 'api/**']\njobs:\n  check:\n    runs-on: x\n", 'two.yml');
  assert.deepEqual(mapJobs(PKGS, [wf])['two.yml#check'], { packages: ['web', 'api'], via: 'paths', prOnly: false });
});

// --- jobVerdict --------------------------------------------------------------

const step = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });
const SETUP = [step('Set up job'), step('Run actions/checkout@v4'), step('Post Run actions/checkout@v4'), step('Complete job')];
const done = (conclusion, steps) => ({ name: 'j', status: 'completed', conclusion, steps });

test('jobVerdict: green job with every working step skipped -> not-run', () => {
  const v = jobVerdict(done('success', [...SETUP, step('Install', 'skipped'), step('Test', 'skipped')]));
  assert.deepEqual(v, { verdict: 'not-run', partial: false, skippedNames: ['Install', 'Test'] });
});

test('jobVerdict: some working steps skipped -> ok, partial', () => {
  const v = jobVerdict(done('success', [...SETUP, step('Lint'), step('Test desktop', 'skipped')]));
  assert.deepEqual(v, { verdict: 'ok', partial: true, skippedNames: ['Test desktop'] });
});

test('jobVerdict: job conclusion skipped -> not-run; failure -> fail; plain green -> ok', () => {
  assert.equal(jobVerdict(done('skipped', [])).verdict, 'not-run');
  assert.equal(jobVerdict({ status: 'completed', conclusion: 'skipped' }).verdict, 'not-run');
  assert.equal(jobVerdict(done('failure', [...SETUP, step('Test', 'failure')])).verdict, 'fail');
  assert.equal(jobVerdict(done('cancelled', [])).verdict, 'fail');
  assert.equal(jobVerdict(done('timed_out', [])).verdict, 'fail');
  // a failure whose working steps were all skipped is still a failure
  assert.equal(jobVerdict(done('failure', [step('Set up job', 'failure'), step('Test', 'skipped')])).verdict, 'fail');
  assert.deepEqual(jobVerdict(done('success', [...SETUP, step('Test')])), { verdict: 'ok', partial: false, skippedNames: [] });
  assert.equal(jobVerdict(done('success', SETUP)).verdict, 'ok');
  assert.equal(jobVerdict(done('neutral')).verdict, 'ok');
  assert.equal(jobVerdict(done('SUCCESS', [step('Test')])).verdict, 'ok'); // case-insensitive
});

test('jobVerdict: running and queued', () => {
  assert.equal(jobVerdict({ status: 'in_progress', conclusion: null }).verdict, 'running');
  assert.equal(jobVerdict({ status: 'queued' }).verdict, 'queued');
  assert.equal(jobVerdict({ status: 'waiting' }).verdict, 'queued');
  assert.equal(jobVerdict({}).verdict, 'queued');
  assert.equal(jobVerdict(null).verdict, 'queued');
});

test('jobVerdict: setup steps include cache/setup actions without names', () => {
  assert.ok(isSetupStep('Run actions/cache@v4'));
  assert.ok(isSetupStep('Run actions/setup-node@v4'));
  assert.ok(isSetupStep('Post Run actions/cache@v4'));
  assert.ok(isSetupStep('Checkout'));
  assert.ok(!isSetupStep('Run tests'));
  const v = jobVerdict(done('success', [...SETUP, step('Run actions/cache@v4'), step('Test', 'skipped')]));
  assert.equal(v.verdict, 'not-run');
});

test('jobVerdict reads the runJobs summary from the gh provider fixture', () => {
  const view = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'gh', 'run-jobs-skipped.json'), 'utf8'));
  const jobs = withVerdicts(normaliseJobs(view));
  const by = Object.fromEntries(jobs.map((j) => [j.name, j]));
  assert.equal(by['web-admin-check'].verdict, 'not-run');
  assert.deepEqual(by['web-admin-check'].skippedNames, ['Install', 'Typecheck', 'Test']);
  assert.equal(by['lint-and-test'].verdict, 'ok');
  assert.equal(by['lint-and-test'].partial, true);
  assert.ok(by['lint-and-test'].skippedNames.includes('Test desktop'));
  assert.equal(tested(by['lint-and-test']), true);
  assert.equal(tested(by['web-admin-check']), false);
  // summary form directly
  assert.equal(jobVerdict({ status: 'completed', conclusion: 'success', steps: { total: 5, ran: 2, skipped: 2, failed: 0, skippedNames: ['a', 'b'] } }).verdict, 'not-run');
  assert.equal(jobVerdict({ status: 'completed', conclusion: 'success', steps: { total: 5, ran: 3, skipped: 1, failed: 0, skippedNames: ['a'] } }).partial, true);
});

// --- reading from git --------------------------------------------------------

test('readWorkflows lists and shows files at a ref, cached by sha', async () => {
  _clearCache();
  const calls = [];
  const text = fs.readFileSync(path.join(FIX, 'gates.yml'), 'utf8');
  const run = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args.includes('ls-tree')) return { ok: true, stdout: '.github/workflows/ci.yml\0.github/workflows/README.md\0.github/workflows/sub/x.yml\0' };
    if (args.includes('show')) return { ok: true, stdout: text };
    return { ok: false, stdout: '' };
  };
  const a = await readWorkflows({ cwd: '/repo', ref: 'origin/main', sha: 'abc', run });
  assert.equal(a.length, 1);
  assert.equal(a[0].file, 'ci.yml');
  assert.ok(calls.some((c) => c.includes('show abc:.github/workflows/ci.yml')));
  const n = calls.length;
  const b = await readWorkflows({ cwd: '/repo', ref: 'origin/main', sha: 'abc', run });
  assert.equal(b, a);
  assert.equal(calls.length, n);
  assert.deepEqual(await readWorkflows({ cwd: '/repo', ref: 'x', run: async () => ({ ok: false }) }), []);
});
