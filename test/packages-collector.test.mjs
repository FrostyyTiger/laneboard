// The packages collector, the `repos` snapshot key, GET /api/packages and the
// hello capabilities (fleet §6, P9).
//
// Every repo is a throwaway built with `git init` under os.tmpdir(); the git
// cache dir is a temp dir too. CI comes from a fake provider (or, for the
// route module, from gh with its runner swapped for fixtures): gh never runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@example.invalid';
delete process.env.GIT_DIR;
delete process.env.GIT_OBJECT_DIRECTORY;
delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-p9-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.LANEBOARD_DB = ':memory:';
process.env.LANEBOARD_CONFIG = '/dev/null';
process.env.LANEBOARD_LANES_DIR = path.join(TMP, 'lanes');
process.env.LANEBOARD_STATE_DIR = path.join(TMP, 'state');
process.env.LANEBOARD_AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.XDG_STATE_HOME = path.join(TMP, 'state');
process.env.XDG_CONFIG_HOME = path.join(TMP, 'config');
process.env.XDG_CACHE_HOME = path.join(TMP, 'cache');

const { createCollector, parseLogNames, lastTestedOf, branchOf } = await import('../server/collector/packages.mjs');
const db = await import('../server/db.mjs');
const gh = await import('../server/providers/ci/gh.mjs');
const apiV1 = await import('../server/fleet/api-v1.mjs');
const packagesRoute = await import('../server/routes/packages.mjs');
const { textualAvailable } = await import('../server/packages/conflicts.mjs');

const DAY = 24 * 3600 * 1000;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function commit(dir, files, msg, env = {}) {
  for (const [f, t] of Object.entries(files)) write(dir, f, t);
  git(dir, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env: { ...process.env, ...env } });
  return git(dir, 'rev-parse', 'HEAD');
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) n++;
  return n;
}

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  web-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
        working-directory: web
  api-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest
        working-directory: api
  promote:
    runs-on: ubuntu-latest
    steps:
      - run: echo promote
`;

// code/acme (main checkout, origin = a bare repo) with:
//   main: npm workspaces web + api, the CI workflow, a plan file; the last
//         commit touches api only (so api is "untested" since the older run)
//   a, b: remote-only, both edit line 1 of web/x.txt (a textual conflict)
//   old:  remote-only, 10 days old, edits docs/old.md (stale)
//   lane-c: a local worktree lane editing api/y.txt
function buildFixture() {
  const code = path.join(TMP, 'code');
  const origin = path.join(TMP, 'origin.git');
  const work = path.join(code, 'acme');
  fs.mkdirSync(code, { recursive: true });
  git(TMP, 'init', '-q', '--bare', origin);
  git(code, 'init', '-q', work);
  git(work, 'remote', 'add', 'origin', origin);
  const base = commit(work, {
    'package.json': JSON.stringify({ name: 'acme', private: true, workspaces: ['web', 'api'] }),
    'web/package.json': '{"name":"web"}',
    'web/x.txt': 'one\ntwo\n',
    'api/package.json': '{"name":"api"}',
    'api/y.txt': 'y\n',
    '.github/workflows/ci.yml': WORKFLOW,
    'docs/plans/web-redesign.md': '# Web redesign\n\n**Plan status:** `OPEN`\n',
    'docs/plans/api-cleanup.md': '# Api cleanup\n\n**Plan status:** DONE\n',
  }, 'base');
  const head = commit(work, { 'api/z.txt': 'z\n' }, 'api change');
  git(work, 'push', '-q', 'origin', 'main');
  for (const [b, file, text, env] of [
    ['a', 'web/x.txt', 'ONE-a\ntwo\n'],
    ['b', 'web/x.txt', 'ONE-b\ntwo\n'],
    ['old', 'docs/old.md', 'old\n', { GIT_COMMITTER_DATE: new Date(Date.now() - 10 * DAY).toISOString(), GIT_AUTHOR_DATE: new Date(Date.now() - 10 * DAY).toISOString() }],
  ]) {
    git(work, 'checkout', '-q', '-b', b, 'main');
    commit(work, { [file]: text }, `branch ${b}`, env);
    git(work, 'push', '-q', 'origin', b);
    git(work, 'checkout', '-q', 'main');
    git(work, 'branch', '-q', '-D', b);
  }
  git(work, 'fetch', '-q', 'origin');
  const lane = path.join(code, 'acme-lane-c');
  git(work, 'worktree', 'add', '-q', '-b', 'lane-c', lane, 'main');
  const laneSha = commit(lane, { 'api/y.txt': 'y changed\n' }, 'lane c');
  return { code, work, lane, base, head, laneSha };
}

const FX = buildFixture();
const CACHE = path.join(TMP, 'cache', 'laneboard', 'git');

const config = {
  codeDir: FX.code,
  lanePollMs: 60_000,
  repos: [{ name: 'acme', ci: { provider: 'gh', repo: 'acme/widgets' } }],
  packages: { autodetect: true, mainRef: 'origin/main', branchWindowDays: 14, maxBranches: 40, fetch: 'none', fetchEverySec: 300, cacheDir: CACHE, ciEverySec: 120, staleDays: 7, staleBehind: 50 },
  plans: { globs: ['docs/plans/**/*.md'], statusLine: '^\\*\\*Plan status:\\*\\*\\s*`?([A-Z][A-Z-]+)', states: { open: ['OPEN'], partial: ['PARTIAL'], done: ['DONE'], deferred: ['DEFERRED'] } },
};

const steps = (ran, skipped = 0) => ({ total: ran + 2, ran, skipped, failed: 0, skippedNames: skipped ? ['Test'] : [] });

/** A fake CI provider: the head run (web green, api failed) and an older run on the base (both green). */
function fakeProvider() {
  const calls = { mainRuns: [], runJobs: [], rateLimit: 0 };
  const iso = (ms) => ms;
  const runs = [
    { id: 201, attempt: 1, workflow: 'CI', workflowId: 9, headSha: FX.head, event: 'push', status: 'completed', conclusion: 'failure', createdAt: iso(Date.now() - 1000), updatedAt: iso(Date.now() - 500) },
    { id: 200, attempt: 1, workflow: 'CI', workflowId: 9, headSha: FX.base, event: 'push', status: 'completed', conclusion: 'success', createdAt: iso(Date.now() - 5000), updatedAt: iso(Date.now() - 4000) },
  ];
  const jobs = {
    201: [
      { id: 1, name: 'web-check', status: 'completed', conclusion: 'success', steps: steps(2) },
      { id: 2, name: 'api-check', status: 'completed', conclusion: 'failure', steps: steps(2) },
      { id: 3, name: 'promote', status: 'completed', conclusion: 'success', steps: steps(1) },
    ],
    200: [
      { id: 4, name: 'web-check', status: 'completed', conclusion: 'success', steps: steps(2, 1) },
      { id: 5, name: 'api-check', status: 'completed', conclusion: 'success', steps: steps(2) },
    ],
  };
  const p = {
    name: 'gh', active: true, calls, auth: true,
    async rateLimit() { calls.rateLimit++; return p.auth ? { ok: true, remaining: 4900, limit: 5000, resetAt: null } : { auth: false }; },
    async mainRuns(args) { calls.mainRuns.push(args); return p.auth ? { ok: true, runs: args.workflow ? [] : runs } : { auth: false }; },
    async runJobs({ runId }) { calls.runJobs.push(runId); return { ok: true, jobs: jobs[runId] ?? [] }; },
    async failedJobsForCommit() { return []; },
  };
  return p;
}

test('pure helpers: branchOf, parseLogNames, lastTestedOf', () => {
  assert.equal(branchOf('origin/main'), 'main');
  assert.equal(branchOf('refs/remotes/origin/trunk'), 'trunk');
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  assert.deepEqual(parseLogNames(`\x1e${a}\t100\0\nweb/x\0api/y\0\x1e${b}\t50\0\nweb/z\0`), [
    { sha: a, at: 100000, files: ['web/x', 'api/y'] }, { sha: b, at: 50000, files: ['web/z'] },
  ]);
  const jobMap = { 'ci.yml#t': { packages: ['web'], via: 'name', prOnly: false }, 'ci.yml#pr': { packages: '*', via: 'default', prOnly: true } };
  const runs = [
    { id: 2, sha: a, file: 'ci.yml', createdAt: 2, jobs: [{ name: 't', verdict: 'not-run' }, { name: 'pr', verdict: 'ok' }] },
    { id: 1, sha: b, file: 'ci.yml', createdAt: 1, updatedAt: 9, jobs: [{ name: 't', verdict: 'ok' }] },
  ];
  assert.deepEqual(lastTestedOf([{ name: 'web' }, { name: 'api' }], runs, jobMap), { web: { sha: b, at: 9, runId: 1 } },
    'a not-run job and a PR-only job do not count as tested');
});

test('snapshot().repos[0] carries every §2.9 key, from a temp repo and a fake provider', async () => {
  const fake = fakeProvider();
  const changes = [];
  const objectsBefore = countFiles(path.join(FX.work, '.git', 'objects'));
  const c = createCollector({
    config,
    providerFor: () => fake,
    worktrees: () => [{ id: 'lane-c', root: FX.lane }],
    onChange: (repo, data) => changes.push({ repo, data }),
  });
  const snap = await c.refresh({ force: true });
  assert.equal(snap.repos.length, 1);
  const r = snap.repos[0];
  for (const k of ['name', 'slug', 'mainRef', 'head', 'packages', 'workflows', 'jobMap', 'ci', 'lastTested', 'untested',
    'branches', 'conflicts', 'deps', 'commits', 'plans', 'stale', 'warnings']) {
    assert.ok(Object.hasOwn(r, k), `repos[0].${k}`);
  }
  for (const k of ['provider', 'auth', 'at', 'rate', 'runs']) assert.ok(Object.hasOwn(r.ci, k), `ci.${k}`);
  assert.deepEqual(Object.keys(r.ci.rate).sort(), ['low', 'remaining']);
  assert.equal(r.name, 'acme');
  assert.equal(r.slug, 'acme/widgets');
  assert.equal(r.mainRef, 'origin/main');
  assert.equal(r.head.sha, FX.head);
  assert.ok(r.head.at > 0);

  // Packages auto-detected from the npm workspaces.
  assert.deepEqual(r.packages.map((p) => [p.name, p.source]).sort(), [['api', 'auto'], ['web', 'auto']]);

  // Workflows and the job map.
  assert.equal(r.workflows.length, 1);
  assert.equal(r.workflows[0].file, 'ci.yml');
  assert.deepEqual(r.workflows[0].jobs.map((j) => j.id).sort(), ['api-check', 'promote', 'web-check']);
  assert.deepEqual(r.jobMap['ci.yml#web-check'].packages, ['web']);
  assert.deepEqual(r.jobMap['ci.yml#api-check'].packages, ['api']);
  assert.equal(r.jobMap['ci.yml#promote'].via, 'ignored');

  // CI runs with per-job verdicts, mapped to the workflow file.
  assert.equal(r.ci.provider, 'gh');
  assert.equal(r.ci.auth, true);
  assert.equal(r.ci.rate.remaining, 4900);
  assert.equal(r.ci.rate.low, false);
  assert.deepEqual(r.ci.runs.map((x) => x.id), [201, 200]);
  const head = r.ci.runs[0];
  assert.equal(head.file, 'ci.yml');
  assert.equal(head.sha, FX.head);
  for (const k of ['id', 'attempt', 'workflow', 'file', 'sha', 'event', 'status', 'conclusion', 'createdAt', 'updatedAt', 'jobs']) {
    assert.ok(Object.hasOwn(head, k), `run.${k}`);
  }
  assert.deepEqual(head.jobs.map((j) => [j.name, j.verdict]), [['web-check', 'ok'], ['api-check', 'fail'], ['promote', 'ok']]);
  for (const k of ['id', 'name', 'status', 'conclusion', 'verdict', 'partial', 'skippedNames']) assert.ok(Object.hasOwn(head.jobs[0], k));
  assert.equal(r.ci.runs[1].jobs[0].partial, true, 'some work steps skipped: partial');

  // lastTested / untested: web tested on the head; api last tested on the base,
  // and the head commit touched api since.
  assert.equal(r.lastTested.web.sha, FX.head);
  assert.equal(r.lastTested.web.runId, 201);
  assert.equal(r.lastTested.api.sha, FX.base);
  assert.equal(r.untested.web, 0);
  assert.equal(r.untested.api, 1);

  // Branches: the local lane and the remote-only ones; what they touch.
  const byName = Object.fromEntries(r.branches.map((b) => [b.branch, b]));
  assert.deepEqual(Object.keys(byName).sort(), ['a', 'b', 'lane-c', 'old']);
  assert.equal(byName['lane-c'].local, true);
  assert.equal(byName['lane-c'].laneId, 'lane-c');
  assert.equal(byName['lane-c'].sha, FX.laneSha);
  assert.deepEqual(byName['lane-c'].packages, ['api']);
  assert.equal(byName.a.local, false);
  assert.deepEqual(byName.a.files, ['web/x.txt']);
  assert.deepEqual(byName.a.packages, ['web']);

  // Conflicts: a vs b on web/x.txt (textual with git >= 2.38, overlap below).
  const ab = r.conflicts.find((x) => !x.b.main && [x.a.branch, x.b.branch].sort().join() === 'a,b');
  assert.ok(ab, JSON.stringify(r.conflicts));
  assert.equal(ab.kind, (await textualAvailable()) ? 'textual' : 'overlap');
  assert.deepEqual(ab.files, ['web/x.txt']);
  assert.ok(Array.isArray(r.deps));

  // Commits per package, plans, stale.
  assert.equal(r.commits.api.n7d, 2);
  assert.equal(r.commits.api.lastSha, FX.head);
  assert.equal(r.commits.web.n7d, 1);
  assert.equal(r.commits.web.lastSha, FX.base);
  assert.equal(r.plans.counts.open, 1);
  assert.equal(r.plans.counts.done, 1);
  assert.deepEqual(r.plans.files.map((f) => [f.path, f.state, f.pkg]).sort(), [
    ['docs/plans/api-cleanup.md', 'done', 'api'], ['docs/plans/web-redesign.md', 'open', 'web'],
  ]);
  assert.deepEqual(r.stale.map((s) => [s.branch, s.suggestion]), [['old', 'delete-branch']]);
  assert.equal(r.stale[0].command, 'git push origin --delete old');

  // One change reported; the checkout's object store untouched by merge-tree.
  assert.equal(changes.length, 1);
  assert.equal(changes[0].repo, 'acme');
  assert.equal(countFiles(path.join(FX.work, '.git', 'objects')), objectsBefore, 'nothing written into the repo');

  // The collector's other views.
  assert.deepEqual(Object.keys(c.reposByName()), ['acme']);
  assert.equal(c.repo('acme/widgets').name, 'acme');
  assert.equal(c.health().repos, 1);
});

test('completed runs: jobs are read once, kept in ci_jobs, and survive a new collector', async () => {
  const fake = fakeProvider();
  const changes = [];
  const c = createCollector({ config, providerFor: () => fake, onChange: (repo) => changes.push(repo) });
  await c.refresh({ force: true });
  const firstJobs = fake.calls.runJobs.length;
  assert.ok(db.ciJobsGet({ runId: 201, attempt: 1, slug: 'acme/widgets' }), 'stored in ci_jobs');
  assert.equal(db.ciJobsGet({ runId: 201, attempt: 1, slug: 'other/repo' }), null, 'never another repo\'s row');
  await c.refresh({ force: true });
  assert.equal(fake.calls.runJobs.length, firstJobs, 'completed run jobs are not read again');
  assert.equal(changes.length, 1, 'an unchanged block is not reported again');

  // Cadence: a non-forced pass inside ciEverySec does not call gh.
  const before = fake.calls.mainRuns.length;
  await c.refresh();
  assert.equal(fake.calls.mainRuns.length, before);

  // A fresh process (new collector, same db) asks SQLite, not gh.
  const fake2 = fakeProvider();
  const c2 = createCollector({ config, providerFor: () => fake2 });
  await c2.refresh({ force: true });
  assert.deepEqual(fake2.calls.runJobs, [], 'jobs of completed runs come from ci_jobs');
  assert.equal(c2.snapshot().repos[0].ci.runs[0].jobs.length, 3);
});

test('gh not logged in: ci.auth false and a 10 min back-off; no CI block keeps every key', async () => {
  let t = Date.now();
  const fake = fakeProvider();
  fake.auth = false;
  const c = createCollector({ config, providerFor: () => fake, now: () => t });
  const r = (await c.refresh({ force: true })).repos[0];
  assert.equal(r.ci.auth, false);
  const n = fake.calls.mainRuns.length + fake.calls.rateLimit;
  t += 5 * 60 * 1000;
  await c.refresh();
  assert.equal(fake.calls.mainRuns.length + fake.calls.rateLimit, n, 'backing off');

  const noCi = createCollector({ config: { ...config, repos: [{ name: 'acme', ci: null }] }, providerFor: () => fake });
  const b = (await noCi.refresh({ force: true })).repos[0];
  assert.equal(b.slug, null);
  assert.equal(b.ci.provider, 'none');
  assert.deepEqual(b.ci.runs, []);
  assert.equal(b.packages.length, 2, 'git data without CI');
});

test('a repo that is not a git checkout gives a block of greys, not a throw', async () => {
  const c = createCollector({ config: { ...config, repos: [{ name: 'missing', ci: null }] }, providerFor: () => fakeProvider() });
  const r = (await c.refresh({ force: true })).repos[0];
  assert.equal(r.name, 'missing');
  assert.equal(r.head.sha, null);
  assert.ok(r.warnings.length);
});

// --- the route module ---------------------------------------------------------

test('route module: snapshot key `repos`, repos stream message, GET /api/packages, packagesFor, hello capabilities', async () => {
  apiV1._reset();
  const runFx = (args) => {
    const ok = (v) => ({ ok: true, code: 0, stdout: JSON.stringify(v), stderr: '' });
    if (args[0] === 'api') return ok({ resources: { core: { remaining: 4000, limit: 5000, reset: 1 } } });
    if (args[0] === 'run' && args[1] === 'list') {
      return ok(args.includes('--workflow') ? [] : [{
        databaseId: 300, attempt: 1, workflowName: 'CI', workflowDatabaseId: 9, headSha: FX.head, event: 'push',
        status: 'completed', conclusion: 'success', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);
    }
    if (args[0] === 'run' && args[1] === 'view') {
      return ok({ jobs: [{ databaseId: 9, name: 'web-check', status: 'completed', conclusion: 'success', steps: [{ name: 'Run tests', status: 'completed', conclusion: 'success' }] }] });
    }
    return { ok: false, code: 1, stdout: '', stderr: 'unexpected' };
  };
  const ghCalls = [];
  gh._setRunner(async (args) => { ghCalls.push(args); return runFx(args); });

  const keys = new Map();
  const routes = new Map();
  const sent = [];
  const ctx = {
    config: { ...config, fleet: { id: 'builder-a' } },
    state: { addSnapshotKey: (n, fn) => keys.set(n, fn), snapshot: () => ({ lanes: [{ id: 'lane-c', branch: 'lane-c', sessions: ['s1'], idle: false }] }) },
    ws: { send: (m) => sent.push(m), clientCount: () => 0 },
    prs: { snapshot: () => ({ prs: {} }) },
    route: (m, p, h) => routes.set(`${m} ${p}`, h),
    json: (res, body) => { res.body = body; },
  };
  const mod = packagesRoute.default;
  assert.equal(mod.name, 'packages');
  assert.deepEqual(mod.modes, ['builder']);
  mod.register(ctx);
  await mod.start(ctx);
  try {
    const caps = apiV1.hello().capabilities;
    assert.equal(caps.includes('conflicts:textual'), await textualAvailable(), 'conflicts:textual iff git >= 2.38');
    assert.ok(caps.includes('ci:jobs'));

    assert.deepEqual(packagesRoute.packagesFor('acme', ['web/x.txt']), [], 'nothing polled yet');
    await packagesRoute.getCollector().refresh({ force: true });

    const repos = keys.get('repos')();
    assert.deepEqual(Object.keys(repos), ['acme'], 'object keyed by repo name, as the hub store ingests it');
    assert.equal(repos.acme.ci.runs[0].id, 300);
    assert.ok(ghCalls.every((a) => a.includes('-R') || a[0] === 'api'), 'gh named the repo by slug');

    const msg = sent.find((m) => m.type === 'repos');
    assert.equal(msg.repo, 'acme');
    assert.equal(msg.data.head.sha, FX.head);

    const res = {};
    routes.get('GET /api/packages')({}, res);
    const body = res.body;
    for (const k of ['repos', 'rows', 'edges', 'hotspots', 'order', 'stale']) assert.ok(Object.hasOwn(body, k), k);
    assert.deepEqual(body.builders, ['builder-a']);
    const web = body.rows.find((x) => x.repo === 'acme' && x.package === 'web');
    assert.ok(web, JSON.stringify(body.rows.map((x) => x.package)));
    assert.equal(web.main.status, 'ok');
    // No lanes pass ran here (knownWorktrees is empty): only the remote branches,
    // none of which a lane of this builder works on.
    assert.deepEqual(body.repos[0].branches.map((b) => [b.branch, b.fkey]), [['a', null], ['b', null], ['old', null]]);
    assert.equal(body.repos[0].via, 'builder-a');

    assert.deepEqual(packagesRoute.packagesFor('acme', ['web/x.txt', 'api/y.txt']).sort(), ['api', 'web']);
    assert.deepEqual(packagesRoute.packagesFor('acme/widgets', ['docs/readme.md']), []);
    assert.deepEqual(packagesRoute.packagesFor('nope', ['web/x.txt']), []);
    assert.deepEqual(packagesRoute.packagesFor('acme', null), []);
  } finally {
    mod.stop();
    apiV1._reset();
  }
});
