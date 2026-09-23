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

test('pr_samples key changes only when a recorded field does', () => {
  const a = gh.summarisePr(JSON.parse(fx('pr-green.json')));
  const b = { ...a, url: 'changed', mergeable: 'MERGEABLE' };
  assert.equal(pr.sampleKey(a), pr.sampleKey(b));
  assert.notEqual(pr.sampleKey(a), pr.sampleKey(gh.summarisePr(JSON.parse(fx('pr-red.json')))));
  assert.equal(pr.sampleKey({ none: true }), 'none');
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

// --- the `none` provider ------------------------------------------------------

test('the none CI provider reports no PR and no queue, and never calls out', async () => {
  assert.equal(none.active, false);
  assert.deepEqual(await none.prForBranch({ repo: 'x', branch: 'y' }), { none: true });
  assert.deepEqual(await none.runs({ repo: 'x' }), { ok: false });
});

test('both CI providers export the same interface', () => {
  for (const k of ['name', 'active', 'prForBranch', 'runs']) {
    assert.ok(k in gh, `gh is missing ${k}`);
    assert.ok(k in none, `none is missing ${k}`);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
