// The CI providers and the cycle that drives them, on `gh` JSON recorded
// from a real repo: #1363 merged, #1360 open with every check green or
// skipped. Draft-pending and red are those recordings with the checks edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FX = path.resolve(import.meta.dirname, 'fixtures/gh');
const fx = (f) => fs.readFileSync(path.join(FX, f), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-pr-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
// Never the worktree's own data/laneboard.db: old rows there change what is "new".
process.env.LANEBOARD_DB = ':memory:';
process.env.LANEBOARD_CI_PROVIDER = 'gh';
process.env.LANEBOARD_CI_REPO = 'example-repo';
const gh = await import('../server/providers/ci/gh.mjs');
const none = await import('../server/providers/ci/none.mjs');
const pr = await import('../server/collector/pr.mjs');
const store = await import('../server/lanes/store.mjs');
const db = await import('../server/db.mjs');

// --- the five states -------------------------------------------------------------

test('no PR yet is a state, not an error', () => {
  const r = { ok: false, code: 1, stderr: fx('pr-none.stderr') };
  assert.equal(gh.isNoPr(r), true);
  assert.equal(gh.isAuthFailure(r), false);
});

test('a draft with pending checks', () => {
  const s = gh.summarisePr(JSON.parse(fx('pr-draft-pending.json')));
  assert.equal(s.isDraft, true);
  assert.equal(s.state, 'OPEN');
  assert.equal(s.verdict, 'pending');
  assert.ok(s.checks.pending >= 5, JSON.stringify(s.checks)); // 4 runs in progress + a pending status context
  assert.equal(s.checks.failed, 0);
});

test('red: one failed check makes the whole PR red, and it is named', () => {
  const s = gh.summarisePr(JSON.parse(fx('pr-red.json')));
  assert.equal(s.verdict, 'red');
  assert.equal(s.checks.failed, 1);
  assert.deepEqual(s.checks.failedNames, ['changes']);
  assert.equal(s.headSha, 'abcdef1234567890');
});

test('green: success and skipped both pass', () => {
  const s = gh.summarisePr(JSON.parse(fx('pr-green.json')));
  assert.equal(s.number, 1360);
  assert.equal(s.verdict, 'green');
  assert.equal(s.checks.failed + s.checks.pending, 0);
  assert.equal(s.checks.total, 15);
});

test('merged', () => {
  const s = gh.summarisePr(JSON.parse(fx('pr-merged.json')));
  assert.equal(s.state, 'MERGED');
  assert.equal(s.verdict, 'green');
});

test('check buckets cover check runs and status contexts', () => {
  assert.equal(gh.checkBucket({ __typename: 'CheckRun', status: 'QUEUED' }), 'pending');
  assert.equal(gh.checkBucket({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' }), 'failed');
  assert.equal(gh.checkBucket({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' }), 'passed');
  assert.equal(gh.checkBucket({ __typename: 'StatusContext', state: 'ERROR' }), 'failed');
  assert.equal(gh.checkBucket({ __typename: 'StatusContext', state: 'EXPECTED' }), 'pending');
});

test('gh not logged in is recognised', () => {
  assert.equal(gh.isAuthFailure({ code: 4, stderr: '' }), true);
  assert.equal(gh.isAuthFailure({ code: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }), true);
  assert.equal(gh.isAuthFailure({ code: 1, stderr: 'no pull requests found' }), false);
});

test('the CI queue from gh run list', () => {
  const q = gh.summariseRuns(JSON.parse(fx('runs.json')));
  assert.equal(q.runs.length, 15);
  assert.ok(q.runs.every((r) => r.name && r.status));
  const live = gh.summariseRuns([
    { name: 'lint-and-test', headBranch: 'feat/a', status: 'in_progress', conclusion: '', createdAt: '2026-09-21T08:00:00Z' },
    { name: 'web-check', headBranch: 'feat/a', status: 'queued', conclusion: '', createdAt: '2026-09-21T08:00:00Z' },
  ]);
  assert.equal(live.running, 1);
  assert.equal(live.queued, 1);
  assert.equal(live.runs[0].conclusion, null);
});

test('a fine-grained token: check runs refused, Actions runs stand in', () => {
  assert.equal(gh.isChecksDenied({ code: 1, stderr: 'GraphQL: Resource not accessible by personal access token (repository.pullRequest.commits.nodes.0.commit.statusCheckRollup)' }), true);
  assert.equal(gh.isChecksDenied({ code: 1, stderr: 'no pull requests found' }), false);
  const s = gh.summarisePr({
    number: 7, headRefOid: 'abc',
    statusCheckRollup: gh.runsAsChecks([
      { name: 'ci', status: 'completed', conclusion: 'success' },
      { name: 'web', status: 'completed', conclusion: 'failure' },
      { name: 'e2e', status: 'in_progress', conclusion: '' },
    ]),
  });
  assert.deepEqual([s.checks.passed, s.checks.failed, s.checks.pending], [1, 1, 1]);
  assert.deepEqual(s.checks.failedNames, ['web']);
  assert.equal(s.verdict, 'red');
});

test('pr_samples key changes only when a recorded field does', () => {
  const a = gh.summarisePr(JSON.parse(fx('pr-green.json')));
  const b = { ...a, url: 'changed', mergeable: 'MERGEABLE' };
  assert.equal(pr.sampleKey(a), pr.sampleKey(b));
  assert.notEqual(pr.sampleKey(a), pr.sampleKey(gh.summarisePr(JSON.parse(fx('pr-red.json')))));
  assert.equal(pr.sampleKey({ none: true }), 'none');
});

// --- reviews: the first human touch ---------------------------------------------

test('firstReviewAt is the earliest review by a person; bots and pending drafts do not count', () => {
  const s = gh.summarisePr(JSON.parse(fx('pr-reviews.json')));
  assert.equal(s.firstReviewAt, Date.parse('2026-10-14T11:30:00Z'));
  assert.equal(s.verdict, 'green');
  assert.equal(s.viaRuns, false);
  assert.equal(gh.isBotLogin('review-helper[bot]'), true);
  assert.equal(gh.isBotLogin('copilot-pull-request-reviewer'), true);
  assert.equal(gh.isBotLogin('reviewer-b'), false);
  assert.equal(gh.firstReviewAt({}), null);
  assert.equal(gh.summarisePr(JSON.parse(fx('pr-green.json'))).firstReviewAt, null);
  // latestReviews alone is enough (reviews can be truncated by gh).
  assert.equal(gh.firstReviewAt({ latestReviews: [{ author: { login: 'builder-a' }, state: 'APPROVED', submittedAt: '2026-10-14T12:10:00Z' }] }),
    Date.parse('2026-10-14T12:10:00Z'));
});

// --- per-job CI reads, gh replaced by a recording runner -----------------------

/** A runner that answers by the first args and records every call. */
function recorder(answer) {
  const calls = [];
  const fn = async (args, opts) => { calls.push({ args, opts }); return answer(args); };
  fn.calls = calls;
  return fn;
}
const okOut = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });
const notLoggedIn = { ok: false, code: 4, stdout: '', stderr: 'gh auth login' };

test('prForBranch asks for reviews in both field lists, and the fine-grained fallback still works (#8)', async () => {
  const denied = { ok: false, code: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by personal access token (repository.pullRequest.commits.nodes.0.commit.statusCheckRollup)' };
  const prNoChecks = { ...JSON.parse(fx('pr-reviews.json')) };
  delete prNoChecks.statusCheckRollup;
  const run = recorder((args) => {
    if (args[0] === 'pr') return args.at(-1).includes('statusCheckRollup') ? denied : okOut(JSON.stringify(prNoChecks));
    return okOut(JSON.stringify([
      { name: 'CI', status: 'completed', conclusion: 'failure' },
      { name: 'Web', status: 'completed', conclusion: 'success' },
    ]));
  });
  gh._setRunner(run);
  const s = await gh.prForBranch({ repo: 'example-repo', branch: 'feat/x' });
  assert.equal(run.calls.length, 3);
  for (const c of run.calls.slice(0, 2)) assert.match(c.args.at(-1), /(^|,)reviews,latestReviews(,|$)/);
  assert.deepEqual(run.calls[2].args.slice(0, 4), ['run', 'list', '--commit', prNoChecks.headRefOid]);
  assert.equal(s.verdict, 'red');
  assert.equal(s.viaRuns, true);
  assert.deepEqual(s.checks.failedNames, ['CI'], 'workflow names on the fallback path');
  assert.equal(s.firstReviewAt, Date.parse('2026-10-14T11:30:00Z'));
});

test('mainRuns: -R slug, branch, limit, optional workflow; runs normalised newest first', async () => {
  const run = recorder(() => okOut(fx('runs-main.json')));
  gh._setRunner(run);
  const r = await gh.mainRuns({ slug: 'acme/widgets', branch: 'main' });
  assert.equal(r.ok, true);
  assert.deepEqual(run.calls[0].args, ['run', 'list', '-R', 'acme/widgets', '--branch', 'main', '--limit', '30', '--json',
    'databaseId,attempt,workflowName,workflowDatabaseId,headSha,event,status,conclusion,createdAt,updatedAt']);
  assert.equal(run.calls[0].opts.cwd, undefined, 'the slug names the repo, not a cwd');
  assert.equal(r.runs.length, 6);
  const [first] = r.runs;
  assert.deepEqual(first, {
    id: 18001000005, attempt: 1, workflow: 'CI', workflowId: 901,
    headSha: 'c0ffee5000000000000000000000000000000005', event: 'push',
    status: 'in_progress', conclusion: null,
    createdAt: Date.parse('2026-10-14T09:12:03Z'), updatedAt: Date.parse('2026-10-14T09:13:40Z'),
  });
  assert.equal(r.runs.find((x) => x.id === 18001000004).attempt, 2);
  assert.equal(r.runs.find((x) => x.id === 18001000000).conclusion, null);
  assert.ok(r.runs.every((x, i, a) => i === 0 || a[i - 1].createdAt >= x.createdAt));

  await gh.mainRuns({ slug: 'acme/widgets', branch: 'main', limit: 1, workflow: 'desktop.yml' });
  assert.deepEqual(run.calls[1].args.slice(6, 10), ['--limit', '1', '--workflow', 'desktop.yml']);
});

test('mainRuns: auth, errors and bad arguments are values', async () => {
  gh._setRunner(async () => notLoggedIn);
  assert.deepEqual(await gh.mainRuns({ slug: 'acme/widgets', branch: 'main' }), { auth: false });
  gh._setRunner(async () => ({ ok: false, code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }));
  assert.deepEqual(await gh.mainRuns({ slug: 'acme/widgets', branch: 'main' }), { ok: false, error: 'HTTP 404: Not Found' });
  gh._setRunner(async () => okOut('not json'));
  assert.equal((await gh.mainRuns({ slug: 'acme/widgets', branch: 'main' })).ok, false);
  const run = recorder(() => okOut('[]'));
  gh._setRunner(run);
  for (const bad of [{ slug: '--repo=x', branch: 'main' }, { slug: 'acme/widgets', branch: '--help' },
    { slug: 'acme', branch: 'main' }, { slug: 'acme/widgets', branch: 'main', workflow: '-x' }, {}]) {
    assert.deepEqual(await gh.mainRuns(bad), { ok: false, error: 'bad argument' }, JSON.stringify(bad));
  }
  assert.equal(run.calls.length, 0, 'nothing reaches gh');
});

test('runJobs: jobs with step counts; setup steps are not "ran"', async () => {
  const run = recorder(() => okOut(fx('run-jobs.json')));
  gh._setRunner(run);
  const r = await gh.runJobs({ slug: 'acme/widgets', runId: 18001000004 });
  assert.deepEqual(run.calls[0].args, ['run', 'view', '18001000004', '-R', 'acme/widgets', '--json', 'jobs']);
  assert.equal(r.ok, true);
  assert.equal(r.jobs.length, 4);
  const api = r.jobs.find((j) => j.name === 'api (ruff, pytest)');
  assert.equal(api.id, 51000000002);
  assert.equal(api.conclusion, 'failure');
  assert.deepEqual(api.steps, { total: 7, ran: 3, skipped: 1, failed: 1, skippedNames: ['Upload coverage'] });
  const changes = r.jobs.find((j) => j.name === 'changes');
  assert.deepEqual(changes.steps, { total: 5, ran: 1, skipped: 0, failed: 0, skippedNames: [] });
  const e2e = r.jobs.find((j) => j.name === 'e2e');
  assert.equal(e2e.status, 'in_progress');
  assert.equal(e2e.conclusion, null);
  assert.equal(e2e.completedAt, null, 'gh writes year 1 for "not yet"');
  assert.equal(e2e.startedAt, Date.parse('2026-10-14T08:52:21Z'));
});

test('runJobs: a green job whose work was all skipped shows it in the counts', async () => {
  gh._setRunner(async () => okOut(fx('run-jobs-skipped.json')));
  const { jobs } = await gh.runJobs({ slug: 'acme/widgets', runId: '18001000002' });
  const admin = jobs.find((j) => j.name === 'web-admin-check');
  assert.equal(admin.conclusion, 'success');
  assert.equal(admin.steps.ran, 3);
  assert.equal(admin.steps.skipped, 3, 'every non-setup step skipped: not tested');
  assert.deepEqual(admin.steps.skippedNames, ['Install', 'Typecheck', 'Test']);
  const lint = jobs.find((j) => j.name === 'lint-and-test');
  assert.deepEqual([lint.steps.ran, lint.steps.skipped], [2, 1], 'partial');
  const mac = jobs.find((j) => j.name === 'desktop (macos)');
  assert.equal(mac.conclusion, 'skipped');
  assert.equal(mac.steps.total, 0);
  assert.ok(gh.SETUP_STEP.test('Post Run actions/checkout@v4'));
  assert.ok(!gh.SETUP_STEP.test('Install'));
});

test('runJobs: failures are values, bad ids never reach gh', async () => {
  gh._setRunner(async () => notLoggedIn);
  assert.deepEqual(await gh.runJobs({ slug: 'acme/widgets', runId: 1 }), { auth: false });
  gh._setRunner(async () => okOut('{"nojobs":1}'));
  assert.equal((await gh.runJobs({ slug: 'acme/widgets', runId: 1 })).ok, false);
  const run = recorder(() => okOut(fx('run-jobs.json')));
  gh._setRunner(run);
  for (const runId of ['--web', '0', '12a', null, undefined]) {
    assert.deepEqual(await gh.runJobs({ slug: 'acme/widgets', runId }), { ok: false, error: 'bad argument' });
  }
  assert.equal(run.calls.length, 0);
});

test('rateLimit: the core bucket, reset in ms, graphql alongside', async () => {
  const run = recorder(() => okOut(fx('rate-limit.json')));
  gh._setRunner(run);
  const r = await gh.rateLimit();
  assert.deepEqual(run.calls[0].args, ['api', 'rate_limit']);
  assert.deepEqual(r, {
    ok: true, remaining: 4688, limit: 5000, resetAt: 1792058400000,
    graphql: { remaining: 4960, limit: 5000, resetAt: 1792058700000 },
  });
  assert.equal(gh.parseRateLimit({ rate: { remaining: 1, limit: 60, reset: 2 } }).remaining, 1);
  assert.equal(gh.parseRateLimit({}).ok, false);
  gh._setRunner(async () => notLoggedIn);
  assert.deepEqual(await gh.rateLimit(), { auth: false });
  gh._setRunner(async () => okOut('<html>'));
  assert.equal((await gh.rateLimit()).ok, false);
});

test('failedJobsForCommit: one list, then jobs of each failed run only', async () => {
  const run = recorder((args) => {
    if (args[0] === 'run' && args[1] === 'list') return okOut(fx('runs-commit.json'));
    if (args[2] === '18001000004') return okOut(fx('run-jobs.json'));
    return okOut('{"jobs":[]}'); // a startup failure has no jobs
  });
  gh._setRunner(run);
  const sha = 'c0ffee4000000000000000000000000000000004';
  const r = await gh.failedJobsForCommit({ slug: 'acme/widgets', sha });
  assert.deepEqual(run.calls[0].args, ['run', 'list', '-R', 'acme/widgets', '--commit', sha, '--json', 'databaseId,conclusion,workflowName']);
  assert.deepEqual(run.calls.slice(1).map((c) => c.args[2]), ['18001000004', '18001000006'], 'the green Web run is not opened');
  assert.deepEqual(r, [
    { workflow: 'CI', job: 'api (ruff, pytest)' },
    { workflow: 'Release check', job: null },
  ]);
});

test('failedJobsForCommit: anything going wrong blames nothing', async () => {
  gh._setRunner(async () => notLoggedIn);
  assert.deepEqual(await gh.failedJobsForCommit({ slug: 'acme/widgets', sha: 'abcdef1' }), []);
  gh._setRunner(async () => okOut('nope'));
  assert.deepEqual(await gh.failedJobsForCommit({ slug: 'acme/widgets', sha: 'abcdef1' }), []);
  const run = recorder(() => okOut('[]'));
  gh._setRunner(run);
  assert.deepEqual(await gh.failedJobsForCommit({ slug: 'acme/widgets', sha: '--all' }), []);
  assert.deepEqual(await gh.failedJobsForCommit({ slug: 'x', sha: 'abcdef1' }), []);
  assert.equal(run.calls.length, 0);
  // A failed run whose jobs cannot be read is still blamed, on the workflow.
  gh._setRunner(async (args) => (args[1] === 'list'
    ? okOut('[{"conclusion":"timed_out","databaseId":5,"workflowName":"CI"}]')
    : { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' }));
  assert.deepEqual(await gh.failedJobsForCommit({ slug: 'acme/widgets', sha: 'abcdef1' }), [{ workflow: 'CI', job: null }]);
});

// --- the cycle, with gh replaced by the fixtures -----------------------------------

await store.write({ id: 'lane-a', repo: 'example-repo', root: '/x', branch: 'feat/lane-a', slot: 2, session: 'lane-a', createdAt: 1, retiredAt: null });

function ghReturning(prFile) {
  return async (args) => {
    if (args[0] === 'run') return { ok: true, code: 0, stdout: fx('runs.json'), stderr: '' };
    if (prFile === 'auth') return { ok: false, code: 4, stdout: '', stderr: 'gh auth login' };
    if (prFile === 'none') return { ok: false, code: 1, stdout: '', stderr: fx('pr-none.stderr') };
    return { ok: true, code: 0, stdout: fx(prFile), stderr: '' };
  };
}

const pushed = [];
pr.init({ noteMarker: (m) => pushed.push(m) });

test('red raises one blocked marker through the push path; green after red dismisses it', async () => {
  gh._setRunner(ghReturning('pr-red.json'));
  await pr.refresh({ force: true });
  assert.equal(pr.get('lane-a').verdict, 'red');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].kind, 'blocked');
  assert.match(pushed[0].text, /^BLOCKED: PR #1360 checks red on abcdef1: changes$/);
  assert.equal(db.listMarkers({ lane: 'lane-a', kinds: ['blocked'] }).length, 1);

  // Still red next minute: no second push.
  await pr.refresh({ force: true });
  assert.equal(pushed.length, 1);

  gh._setRunner(ghReturning('pr-green.json'));
  await pr.refresh({ force: true });
  assert.equal(pr.get('lane-a').verdict, 'green');
  assert.equal(db.listMarkers({ lane: 'lane-a', kinds: ['blocked'] }).length, 0, 'green dismissed it');
});

test('a sample is written only when the PR state changes', async () => {
  const before = db.listPrSamples({ lane: 'lane-a' }).length;
  gh._setRunner(ghReturning('pr-green.json'));
  await pr.refresh({ force: true });
  await pr.refresh({ force: true });
  assert.equal(db.listPrSamples({ lane: 'lane-a' }).length, before, 'unchanged green writes nothing');
  gh._setRunner(ghReturning('pr-merged.json'));
  await pr.refresh({ force: true });
  assert.equal(db.listPrSamples({ lane: 'lane-a' }).length, before + 1);
});

test('no PR yet shows as none', async () => {
  gh._setRunner(ghReturning('none'));
  await pr.refresh({ force: true });
  assert.equal(pr.get('lane-a').none, true);
  assert.equal(pr.snapshot().queue.runs.length, 15);
});

test('gh not logged in backs off to 10 min instead of looping', async () => {
  let calls = 0;
  const inner = ghReturning('auth');
  gh._setRunner(async (a, o) => { calls++; return inner(a, o); });
  await pr.refresh({ force: true });
  assert.equal(pr.snapshot().auth.ok, false);
  assert.equal(pr.snapshot().auth.message, 'not logged in');
  const n = calls;
  await pr.refresh(); // not forced: inside the back-off
  await pr.refresh();
  assert.equal(calls, n, 'no gh call during the back-off');
});

// --- job blame on the fine-grained red path (fleet P9) ----------------------------

test('fine-grained red: failedJobsForCommit once per head sha, failedJobs on the summary', async () => {
  const sha = 'c0ffee4000000000000000000000000000000004';
  const denied = { ok: false, code: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by personal access token (repository.pullRequest.commits.nodes.0.commit.statusCheckRollup)' };
  const prJson = JSON.stringify({ number: 77, url: 'https://example.invalid/pr/77', state: 'OPEN', isDraft: false, headRefOid: sha, reviews: [], latestReviews: [] });
  const run = recorder((args) => {
    if (args[0] === 'pr') return args.at(-1).includes('statusCheckRollup') ? denied : okOut(prJson);
    if (args[0] === 'run' && args[1] === 'list' && args.includes('-R')) return okOut(fx('runs-commit.json'));
    if (args[0] === 'run' && args[1] === 'list' && args.includes('--commit')) {
      return okOut(JSON.stringify([{ name: 'CI', status: 'completed', conclusion: 'failure' }]));
    }
    if (args[0] === 'run' && args[1] === 'view') return okOut(args[2] === '18001000004' ? fx('run-jobs.json') : '{"jobs":[]}');
    return okOut(fx('runs.json')); // the queue
  });
  gh._setRunner(run);
  const slugAsked = [];
  pr._setSlugResolver(async (repo) => { slugAsked.push(repo); return 'acme/widgets'; });
  const blameLists = () => run.calls.filter((c) => c.args[1] === 'list' && c.args.includes('-R') && c.args.includes('--commit'));

  await pr.refresh({ force: true });
  const s = pr.get('lane-a');
  assert.equal(s.verdict, 'red');
  assert.equal(s.viaRuns, true);
  assert.deepEqual(s.checks.failedNames, ['CI'], 'workflow names from the run fallback');
  assert.deepEqual(s.failedJobs, [
    { workflow: 'CI', job: 'api (ruff, pytest)' },
    { workflow: 'Release check', job: null },
  ]);
  assert.deepEqual(blameLists()[0].args.slice(0, 6), ['run', 'list', '-R', 'acme/widgets', '--commit', sha]);
  assert.deepEqual(slugAsked, ['example-repo'], 'the slug of the lane repo');
  const lastBlocked = db.listMarkers({ lane: 'lane-a', kinds: ['blocked'] })[0];
  assert.match(lastBlocked.text, /checks red on c0ffee4: api \(ruff, pytest\), Release check$/, 'the marker blames jobs');

  // Same head sha next minute: no second blame.
  await pr.refresh({ force: true });
  await pr.refresh({ force: true });
  assert.equal(blameLists().length, 1, 'failedJobsForCommit is called once per head sha');
  assert.deepEqual(pr.get('lane-a').failedJobs, s.failedJobs, 'the cached blame is still on the summary');

  // A new head sha is blamed again.
  const sha2 = 'c0ffee4000000000000000000000000000000005';
  const prJson2 = prJson.replace(sha, sha2);
  gh._setRunner(async (args, opts) => {
    const r = await run(args, opts);
    return args[0] === 'pr' && r.ok ? okOut(prJson2) : r;
  });
  await pr.refresh({ force: true });
  assert.equal(blameLists().length, 2);
  assert.equal(blameLists()[1].args[5], sha2);
});

test('job blame is skipped for green, classic-token red, and an unknown slug', async () => {
  const red = { verdict: 'red', viaRuns: false, headSha: 'abcdef1', checks: { failedNames: ['web-check'] } };
  pr._setSlugResolver(async () => 'acme/widgets');
  const run = recorder(() => okOut('[]'));
  gh._setRunner(run);
  assert.equal(await pr.blameJobs({ repo: 'example-repo' }, red), red, 'per-job names already');
  assert.equal(await pr.blameJobs({ repo: 'example-repo' }, { ...red, verdict: 'green', viaRuns: true }).then((x) => x.failedJobs), undefined);
  pr._setSlugResolver(async () => null);
  const noSlug = { ...red, viaRuns: true };
  assert.equal(await pr.blameJobs({ repo: 'example-repo' }, noSlug), noSlug);
  assert.equal(run.calls.length, 0, 'nothing reaches gh');
});

// --- the `none` provider ------------------------------------------------------

test('the none CI provider reports no PR and no queue, and never calls out', async () => {
  assert.equal(none.active, false);
  assert.deepEqual(await none.prForBranch({ repo: 'x', branch: 'y' }), { none: true });
  assert.deepEqual(await none.runs({ repo: 'x' }), { ok: false });
  assert.deepEqual(await none.mainRuns({ slug: 'acme/widgets', branch: 'main' }), { ok: false });
  assert.deepEqual(await none.runJobs({ slug: 'acme/widgets', runId: 1 }), { ok: false });
  assert.deepEqual(await none.rateLimit(), { ok: false });
  assert.deepEqual(await none.failedJobsForCommit({ slug: 'acme/widgets', sha: 'abcdef1' }), []);
});

test('both CI providers export the same interface', () => {
  for (const k of ['name', 'active', 'prForBranch', 'runs', 'mainRuns', 'runJobs', 'rateLimit', 'failedJobsForCommit']) {
    assert.ok(k in gh, `gh is missing ${k}`);
    assert.ok(k in none, `none is missing ${k}`);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
