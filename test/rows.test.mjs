// Package rows (§6 2.9): main.status precedence, the lamp table, and the joins
// of lanes, PRs, conflicts, commits and plans onto each (repo, package).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, matchesPaths, lampRank, STATUS_ORDER } from '../server/packages/rows.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

function job(name, over = {}) {
  return { id: name, name, status: 'completed', conclusion: 'success', verdict: 'ok', partial: false, skippedNames: [], ...over };
}

function run(jobs, over = {}) {
  return {
    id: 1, attempt: 1, workflow: 'CI', file: 'ci.yml', sha: HEAD, event: 'push',
    status: 'completed', conclusion: 'success', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:05:00Z',
    jobs, ...over,
  };
}

/** A repo with web, web-admin and api; jobs web-check, web-admin-check, api-test, lint (global), pr-lint (prOnly). */
function repo(over = {}) {
  return {
    name: 'acme', slug: 'acme/acme', mainRef: 'origin/main', head: { sha: HEAD, at: '2026-10-14T10:00:00Z' },
    packages: [
      { name: 'web', paths: ['web/**'], source: 'config', kind: 'npm' },
      { name: 'web-admin', paths: ['web-admin/**'], source: 'config', kind: 'npm' },
      { name: 'api', paths: ['api/**', '!api/docs/**'], source: 'config', kind: 'py' },
    ],
    workflows: [{ file: 'ci.yml', name: 'CI', jobs: [
      { id: 'web-check', name: 'web-check', prOnly: false },
      { id: 'web-admin-check', name: 'web-admin-check', prOnly: false },
      { id: 'api-test', name: 'api-test', prOnly: false },
      { id: 'lint', name: 'lint', prOnly: false },
      { id: 'pr-lint', name: 'pr-lint', prOnly: true },
      { id: 'promote', name: 'promote', prOnly: false },
    ] }],
    jobMap: {
      'ci.yml#web-check': { packages: ['web'], via: 'name', prOnly: false },
      'ci.yml#web-admin-check': { packages: ['web-admin'], via: 'name', prOnly: false },
      'ci.yml#api-test': { packages: ['api'], via: 'workdir', prOnly: false },
      'ci.yml#lint': { packages: '*', via: 'default', prOnly: false },
      'ci.yml#pr-lint': { packages: ['web'], via: 'name', prOnly: true },
      'ci.yml#promote': { packages: [], via: 'ignored', prOnly: false },
    },
    ci: { provider: 'gh', auth: true, at: '2026-10-14T10:06:00Z', rate: { remaining: 4900, low: false },
      runs: [run([job('web-check'), job('web-admin-check'), job('api-test'), job('lint'), job('promote')])] },
    lastTested: { web: { sha: HEAD, at: '2026-10-14T10:00:00Z', runId: 1 } },
    untested: {},
    branches: [], conflicts: [], deps: [],
    commits: { web: { n7d: 4, lastAt: '2026-10-13T09:00:00Z', lastSha: OLD } },
    plans: { counts: {}, files: [] },
    ...over,
  };
}

const row = (rows, pkg, name = 'acme') => rows.find((r) => r.repo === name && r.package === pkg);

test('matchesPaths: globs, double star, negation', () => {
  assert.equal(matchesPaths('web/a/b.ts', ['web/**']), true);
  assert.equal(matchesPaths('web-admin/x', ['web/**']), false);
  assert.equal(matchesPaths('a/b', ['a/**/b']), true);
  assert.equal(matchesPaths('a/x/y/b', ['a/**/b']), true);
  assert.equal(matchesPaths('api/docs/x.md', ['api/**', '!api/docs/**']), false);
  assert.equal(matchesPaths('api/x.py', ['api/**', '!api/docs/**']), true);
  assert.equal(matchesPaths('README.md', ['*.md']), true);
  assert.equal(matchesPaths('docs/README.md', ['*.md']), false);
});

test('a green main run gives ok rows with jobs, and the row has every key', () => {
  const rows = buildRows([repo()], {}, {});
  assert.deepEqual(rows.map((r) => r.package), ['web', 'web-admin', 'api']);
  const r = row(rows, 'web');
  assert.deepEqual(Object.keys(r).sort(),
    ['commits7d', 'conflicts', 'lamp', 'lanes', 'lastChange', 'main', 'package', 'plans', 'prs', 'reasons', 'repo'].sort());
  assert.equal(r.main.status, 'ok');
  assert.equal(r.lamp, 'ok');
  assert.equal(r.main.sha, HEAD);
  assert.deepEqual(r.main.tested, { sha: HEAD, at: '2026-10-14T10:00:00Z' });
  assert.equal(r.main.untestedCommits, 0);
  // web-check and the global lint; the ignored promote job is not there.
  assert.deepEqual(r.main.jobs.map((j) => j.name).sort(), ['lint', 'web-check']);
  assert.deepEqual(r.main.jobs.find((j) => j.name === 'web-check'),
    { name: 'web-check', workflow: 'CI', conclusion: 'success', verdict: 'ok', prOnly: false, partial: false, via: 'name' });
  assert.deepEqual(r.lastChange, { sha: OLD, at: '2026-10-13T09:00:00Z' });
  assert.equal(r.commits7d, 4);
  assert.equal(row(rows, 'api').commits7d, 0);
});

test('status: fail beats running beats not-run beats ok', () => {
  const failing = repo({ ci: { ...repo().ci, runs: [run([job('web-check', { conclusion: 'failure', verdict: 'fail' }), job('lint', { status: 'in_progress', conclusion: null, verdict: 'running' })])] } });
  let r = row(buildRows([failing]), 'web');
  assert.equal(r.main.status, 'fail');
  assert.equal(r.lamp, 'crit');
  assert.match(r.reasons.join('\n'), /main red: web-check/);
  // The global lint job running makes every package running, but not web-admin "fail".
  r = row(buildRows([failing]), 'web-admin');
  assert.equal(r.main.status, 'running');
  assert.equal(r.lamp, 'low');

  const notRun = repo({ ci: { ...repo().ci, runs: [run([job('web-check', { conclusion: 'skipped', verdict: 'not-run' }), job('web-admin-check'), job('lint', { verdict: 'not-run' })])] } });
  r = row(buildRows([notRun]), 'web');
  assert.equal(r.main.status, 'not-run');
  assert.equal(r.lamp, 'low');
  // web-admin: its own job is ok but global lint not-run -> not every job is not-run -> ok.
  assert.equal(row(buildRows([notRun]), 'web-admin').main.status, 'ok');
});

test('status: running when a run is in progress on the head sha before it lists jobs', () => {
  const r0 = repo();
  r0.ci.runs = [run([], { id: 2, status: 'in_progress', conclusion: null, createdAt: '2026-10-14T11:00:00Z' }), ...r0.ci.runs];
  assert.equal(row(buildRows([r0]), 'web').main.status, 'running');
});

test('status: a run still going on an old sha does not hide the newest completed run', () => {
  const r0 = repo();
  r0.ci.runs = [
    run([job('web-check', { status: 'in_progress', conclusion: null, verdict: 'running' })], { id: 3, sha: OLD, status: 'in_progress', createdAt: '2026-10-14T12:00:00Z' }),
    run([job('web-check', { conclusion: 'failure', verdict: 'fail' })], { id: 2, createdAt: '2026-10-14T11:00:00Z' }),
    ...r0.ci.runs,
  ];
  assert.equal(row(buildRows([r0]), 'web').main.status, 'fail');
});

test('status: untested commits make an ok package not-run, with the tooltip text', () => {
  const r = row(buildRows([repo({ untested: { web: 3 } })]), 'web');
  assert.equal(r.main.status, 'not-run');
  assert.equal(r.main.untestedCommits, 3);
  assert.equal(r.lamp, 'low');
  assert.ok(r.reasons.includes('3 commits to web since last tested run'));
  // ...and a failing package stays fail.
  const failing = repo({ untested: { web: 3 }, ci: { ...repo().ci, runs: [run([job('web-check', { conclusion: 'failure', verdict: 'fail' })])] } });
  assert.equal(row(buildRows([failing]), 'web').main.status, 'fail');
});

test('status: partial jobs stay ok and say which', () => {
  const r0 = repo({ ci: { ...repo().ci, runs: [run([job('web-check', { partial: true, skippedNames: ['e2e'] }), job('lint')])] } });
  const r = row(buildRows([r0]), 'web');
  assert.equal(r.main.status, 'ok');
  assert.equal(r.lamp, 'ok');
  assert.equal(r.main.jobs.find((j) => j.name === 'web-check').partial, true);
  assert.match(r.reasons.join('\n'), /partial: skipped steps in web-check/);
});

test('status: prOnly jobs are listed but excluded from main.status', () => {
  const r0 = repo({ ci: { ...repo().ci, runs: [run([job('web-check'), job('lint'), job('pr-lint', { conclusion: 'failure', verdict: 'fail' })])] } });
  const r = row(buildRows([r0]), 'web');
  assert.equal(r.main.status, 'ok');
  const pj = r.main.jobs.find((j) => j.name === 'pr-lint');
  assert.equal(pj.prOnly, true);
  assert.equal(pj.verdict, 'fail');
  // A package with only a prOnly job mapped has no mapped jobs: none.
  const only = repo({
    packages: [{ name: 'web', paths: ['web/**'] }],
    jobMap: { 'ci.yml#pr-lint': { packages: ['web'], via: 'name', prOnly: true } },
    ci: { ...repo().ci, runs: [run([job('pr-lint')])] },
  });
  assert.equal(row(buildRows([only]), 'web').main.status, 'none');
});

test('status: none with no mapped jobs; unknown when CI cannot be read', () => {
  const r0 = repo({ jobMap: {} });
  let r = row(buildRows([r0]), 'web');
  assert.equal(r.main.status, 'none');
  assert.equal(r.lamp, 'none');
  for (const ci of [{ provider: 'gh', auth: false, runs: [] }, { provider: 'none', runs: [] }, null]) {
    r = row(buildRows([repo({ ci })]), 'web');
    assert.equal(r.main.status, 'unknown', JSON.stringify(ci));
    assert.equal(r.lamp, 'none');
    assert.match(r.reasons.join('\n'), /CI unknown/);
  }
  r = row(buildRows([repo({ slug: null })]), 'web');
  assert.equal(r.main.status, 'unknown');
  // none outranks unknown: nothing mapped and no auth is still "none".
  assert.equal(row(buildRows([repo({ jobMap: {}, ci: { provider: 'gh', auth: false } })]), 'web').main.status, 'none');
  assert.deepEqual(STATUS_ORDER, ['fail', 'running', 'not-run', 'ok', 'none', 'unknown']);
});

test('jobs without a verdict are bucketed from status/conclusion; matrix names map to the base job', () => {
  const r0 = repo({ ci: { ...repo().ci, runs: [run([
    { id: 11, name: 'web-check (ubuntu, 20)', status: 'completed', conclusion: 'failure' },
    { id: 12, name: 'lint', status: 'completed', conclusion: 'success' },
  ])] } });
  const r = row(buildRows([r0]), 'web');
  assert.equal(r.main.status, 'fail');
  assert.equal(r.main.jobs.find((j) => j.name.startsWith('web-check')).verdict, 'fail');
});

test('runs are matched to workflow files by name when run.file is missing', () => {
  const r0 = repo();
  delete r0.ci.runs[0].file;
  r0.ci.runs[0].jobs[0] = job('web-check', { conclusion: 'failure', verdict: 'fail' });
  assert.equal(row(buildRows([r0]), 'web').main.status, 'fail');
});

const lanes = {
  'builder-a/lane-web': { repo: 'acme', branch: 'lane-web' },
  'builder-b/lane-both': { repo: 'acme', branch: 'lane-both' },
  'builder-a/lane-api': { repo: 'acme', branch: 'lane-api' },
};

function withBranches(over = {}) {
  return repo({
    branches: [
      { repo: 'acme', branch: 'lane-web', sha: 'c1', local: true, laneId: 'lane-web', files: ['web/a.ts'], packages: ['web'] },
      { repo: 'acme', branch: 'lane-both', sha: 'c2', local: false, files: ['web/a.ts', 'api/x.py', 'tools/run.sh'] },
      { repo: 'acme', branch: 'lane-api', sha: 'c3', local: true, laneId: 'lane-api', files: ['api/docs/x.md'] },
      { repo: 'acme', branch: 'old-stuff', sha: 'c4', local: false, files: ['web/z.ts'] },
    ],
    ...over,
  });
}

test('lanes: joined by laneId, by (repo, branch) against any builder, by files; branches without a lane are left out', () => {
  const rows = buildRows([withBranches()], lanes, {});
  assert.deepEqual(row(rows, 'web').lanes, ['builder-a/lane-web', 'builder-b/lane-both']);
  assert.deepEqual(row(rows, 'api').lanes, ['builder-b/lane-both']); // api/docs is negated
  assert.deepEqual(row(rows, 'web-admin').lanes, []);
  const other = row(rows, '_other');
  assert.ok(other, 'an _other row exists when files match no package');
  assert.deepEqual(other.files, ['api/docs/x.md', 'tools/run.sh']);
  assert.deepEqual(other.lanes, ['builder-a/lane-api', 'builder-b/lane-both']);
  assert.equal(rows.at(-1).package, '_other');
  // No unmatched file, no _other row.
  assert.equal(row(buildRows([repo()], lanes, {}), '_other'), undefined);
});

test('PRs: a red PR with a failed job mapped here or global warns; one mapped elsewhere does not', () => {
  const prs = {
    'builder-a/lane-web': { number: 12, state: 'OPEN', verdict: 'red', checks: { failedNames: ['web-check'] } },
    'builder-b/lane-both': { number: 13, state: 'OPEN', verdict: 'red', failedJobs: [{ workflow: 'CI', job: 'api-test' }] },
  };
  const rows = buildRows([withBranches()], lanes, prs);
  const web = row(rows, 'web');
  assert.equal(web.main.status, 'ok');
  assert.equal(web.lamp, 'warn');
  assert.deepEqual(web.prs, [
    { n: 12, fkey: 'builder-a/lane-web', verdict: 'red', failed: ['web-check'] },
    { n: 13, fkey: 'builder-b/lane-both', verdict: 'red', failed: [] },
  ]);
  assert.match(web.reasons.join('\n'), /PR #12 red: web-check/);
  const api = row(rows, 'api');
  assert.equal(api.lamp, 'warn');
  assert.deepEqual(api.prs[0].failed, ['api-test']);

  // A global job failing blames every package it touches.
  const g = buildRows([withBranches()], lanes, { 'builder-a/lane-web': { number: 14, verdict: 'red', checks: { failedNames: ['lint'] } } });
  assert.equal(row(g, 'web').lamp, 'warn');
  // Run-level fallback: a workflow name blames the packages of its jobs (lint is global).
  const w = buildRows([withBranches()], lanes, { 'builder-a/lane-web': { number: 15, verdict: 'red', checks: { failedNames: ['CI'] } } });
  assert.deepEqual(row(w, 'web').prs[0].failed, ['CI']);
  // An unknown check name blames nothing; a merged PR is left out.
  const u = buildRows([withBranches()], lanes, {
    'builder-a/lane-web': { number: 16, verdict: 'red', checks: { failedNames: ['external-scan'] } },
    'builder-b/lane-both': { number: 17, state: 'MERGED', verdict: 'red', checks: { failedNames: ['web-check'] } },
  });
  assert.equal(row(u, 'web').lamp, 'ok');
  assert.equal(row(u, 'web').prs.length, 1);
});

test('conflicts: textual warns, overlap only is low, pairs use fkeys and main', () => {
  const conflicts = [
    { a: { branch: 'lane-web', sha: 'c1' }, b: { branch: 'lane-both', sha: 'c2' }, kind: 'textual', files: ['web/a.ts'] },
    { a: { branch: 'lane-both', sha: 'c2' }, b: { main: true }, kind: 'textual', files: ['web/a.ts'] },
    { a: { branch: 'lane-both', sha: 'c2' }, b: { branch: 'lane-api', sha: 'c3' }, kind: 'overlap', files: ['api/x.py'] },
    { a: { branch: 'old-stuff', sha: 'c4' }, b: { main: true }, kind: 'textual', files: ['web/z.ts'] },
  ];
  const rows = buildRows([withBranches({ conflicts })], lanes, {});
  const web = row(rows, 'web');
  assert.equal(web.conflicts.textual, 2);
  assert.equal(web.conflicts.overlap, 0);
  assert.deepEqual(web.conflicts.pairs, [['builder-a/lane-web', 'builder-b/lane-both'], ['builder-b/lane-both', 'main']]);
  assert.equal(web.lamp, 'warn');
  const api = row(rows, 'api');
  assert.deepEqual(api.conflicts, { textual: 0, overlap: 1, pairs: [['builder-b/lane-both', 'builder-a/lane-api']] });
  assert.equal(api.lamp, 'low');
  assert.match(api.reasons.join('\n'), /1 overlap between lanes/);
  // Main fail still wins over a conflict.
  const red = withBranches({ conflicts, ci: { ...repo().ci, runs: [run([job('web-check', { verdict: 'fail', conclusion: 'failure' })])] } });
  assert.equal(row(buildRows([red], lanes, {}), 'web').lamp, 'crit');
});

test('plans are counted per package', () => {
  const plans = { counts: { open: 2, partial: 1, done: 1, deferred: 0, unknown: 1 }, files: [
    { path: 'docs/plans/web-a.md', state: 'open', word: 'OPEN', pkg: 'web' },
    { path: 'docs/plans/web-b.md', state: 'done', word: 'DONE', pkg: 'web' },
    { path: 'docs/plans/web-c.md', state: 'partial', word: 'PARTIAL', pkg: 'web' },
    { path: 'docs/plans/api.md', state: 'unknown', word: 'WHAT', pkg: 'api' },
    { path: 'docs/plans/x.md', state: 'open', word: 'OPEN', pkg: null },
  ] };
  const rows = buildRows([repo({ plans })]);
  assert.deepEqual(row(rows, 'web').plans, { open: 1, partial: 1, done: 1 });
  assert.deepEqual(row(rows, 'api').plans, { open: 0, partial: 0, done: 0 });
});

test('lamp table', () => {
  const cases = [
    // [ci runs override, untested, prs, conflicts, expected lamp]
    ['fail', {}, {}, [], 'crit'],
    ['ok', {}, { 'builder-a/lane-web': { number: 1, verdict: 'red', checks: { failedNames: ['web-check'] } } }, [], 'warn'],
    ['ok', {}, {}, [{ a: { branch: 'lane-web' }, b: { main: true }, kind: 'textual', files: ['web/a.ts'] }], 'warn'],
    ['running', {}, {}, [], 'low'],
    ['not-run', {}, {}, [], 'low'],
    ['ok', { web: 1 }, {}, [], 'low'],
    ['ok', {}, {}, [{ a: { branch: 'lane-web' }, b: { branch: 'lane-both' }, kind: 'overlap', files: ['web/a.ts'] }], 'low'],
    ['ok', {}, { 'builder-a/lane-web': { number: 1, verdict: 'green', checks: { failedNames: [] } } }, [], 'ok'],
    ['none', {}, {}, [], 'none'],
  ];
  const jobsFor = {
    fail: [job('web-check', { verdict: 'fail', conclusion: 'failure' })],
    running: [job('web-check', { verdict: 'running', status: 'in_progress', conclusion: null })],
    'not-run': [job('web-check', { verdict: 'not-run', conclusion: 'skipped' })],
    ok: [job('web-check')],
    none: [],
  };
  for (const [kind, untested, prs, conflicts, lamp] of cases) {
    const r0 = withBranches({ untested, conflicts, ci: { ...repo().ci, runs: [run(jobsFor[kind])] } });
    if (kind === 'none') r0.jobMap = {};
    const r = row(buildRows([r0], lanes, prs), 'web');
    assert.equal(r.lamp, lamp, `${kind} ${JSON.stringify({ untested, prs, conflicts })}`);
  }
  assert.ok(lampRank('crit') < lampRank('warn') && lampRank('warn') < lampRank('low') && lampRank('ok') < lampRank('none'));
});

test('several repos, junk input, and purity', () => {
  const a = repo();
  const b = repo({ name: 'beta', slug: 'acme/beta', packages: [{ name: 'core', paths: ['core/**'] }], jobMap: {} });
  const before = JSON.stringify([a, b]);
  const rows = buildRows([a, null, 'x', b], null, undefined);
  assert.deepEqual(rows.map((r) => `${r.repo}:${r.package}`), ['acme:web', 'acme:web-admin', 'acme:api', 'beta:core']);
  assert.equal(JSON.stringify([a, b]), before, 'inputs are not mutated');
  assert.deepEqual(buildRows(undefined), []);
  // A repo block with nothing collected yet still gives rows.
  const bare = buildRows([{ name: 'empty', packages: [{ name: 'p', paths: ['p/**'] }] }]);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].main.status, 'none');
  assert.equal(bare[0].lamp, 'none');
  assert.deepEqual(bare[0].conflicts, { textual: 0, overlap: 0, pairs: [] });
});

test('a malformed glob from a builder is skipped, not a throw', () => {
  assert.equal(matchesPaths('web/a', ['', 'web/**']), true);
  assert.equal(matchesPaths('web/a', [null, '!']), false);
  const rows = buildRows([repo({ packages: [{ name: 'web', paths: [42, '!'] }], branches: [{ branch: 'x', files: ['web/a'] }] })]);
  assert.equal(rows[0].package, 'web');
});
