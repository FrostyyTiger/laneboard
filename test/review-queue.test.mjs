import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewQueue, reviewWaitMs, formatWait, storeLookups, REASONS } from '../public/js/core/review-queue.js';

const NOW = 10_000_000;
const MIN = 60_000;

function lane(builder, id, { since, sentAt = null, ready = true, reasons = ['done-marker'], ...extra } = {}) {
  return {
    id,
    key: `${builder}/${id}`,
    builder,
    branch: `feat/${id}`,
    hue: 120,
    sessions: [`${id}-s1`],
    reviewReady: ready === null ? null : { ready, reasons, since },
    reviewSentAt: sentAt,
    diffStat: { files: 3, add: 10, del: 2 },
    packages: ['web'],
    costUsd: 1.25,
    ...extra,
  };
}

test('filters to reviewReady.ready and sorts by wait desc across two builders', () => {
  const lanes = [
    lane('builder-a', 'x', { since: NOW - 5 * MIN }),
    lane('builder-b', 'y', { since: NOW - 30 * MIN }),
    lane('builder-a', 'z', { since: NOW - 10 * MIN }),
    lane('builder-b', 'off', { since: NOW - 60 * MIN, ready: false }),
    lane('builder-b', 'none', { ready: null }),
  ];
  const q = buildReviewQueue(lanes, NOW);
  assert.deepEqual(q.map((i) => i.fkey), ['builder-b/y', 'builder-a/z', 'builder-a/x']);
  assert.deepEqual(q.map((i) => i.waitMs), [30 * MIN, 10 * MIN, 5 * MIN]);
});

test('ties are broken by fkey', () => {
  const s = NOW - 7 * MIN;
  const q = buildReviewQueue([
    lane('builder-b', 'a', { since: s }),
    lane('builder-a', 'b', { since: s }),
    lane('builder-a', 'a', { since: s }),
  ], NOW);
  assert.deepEqual(q.map((i) => i.fkey), ['builder-a/a', 'builder-a/b', 'builder-b/a']);
});

test('waitMs = now - since when reviewSentAt is null', () => {
  const [i] = buildReviewQueue([lane('builder-a', 'x', { since: NOW - 42_000 })], NOW);
  assert.equal(i.waitMs, 42_000);
  assert.equal(i.since, NOW - 42_000);
});

test('review-wait metric: (reviewSentAt ?? now) - since, earlier-episode sentAt ignored', () => {
  assert.equal(reviewWaitMs({ since: 1000, reviewSentAt: null }, 5000), 4000);
  assert.equal(reviewWaitMs({ since: 1000, reviewSentAt: 3000 }, 5000), 2000);
  // sent before this ready episode began: the wait is still open
  assert.equal(reviewWaitMs({ since: 1000, reviewSentAt: 500 }, 5000), 4000);
  assert.equal(reviewWaitMs({ since: 9000 }, 5000), 0, 'never negative (clock skew)');
  assert.equal(reviewWaitMs({ since: 'x' }, 5000), 0);
  const [i] = buildReviewQueue([lane('builder-a', 'x', { since: NOW - 10 * MIN, sentAt: NOW - 4 * MIN })], NOW);
  assert.equal(i.waitMs, 6 * MIN);
});

test('item shape: lane fields, PR, checks, diff stat, packages, cost, sessions', () => {
  const pr = {
    number: 12, url: 'https://example.invalid/pr/12', state: 'OPEN', isDraft: false, verdict: 'green',
    checks: { passed: 4, failed: 0, pending: 1, total: 5, failedNames: [] }, headSha: 'abc',
  };
  const [i] = buildReviewQueue([
    lane('builder-a', 'x', { since: NOW - MIN, reasons: ['pr-green', 'bogus', 'pr-green'], pr, repo: 'acme' }),
  ], NOW);
  assert.deepEqual(i, {
    fkey: 'builder-a/x', builder: 'builder-a', lane: 'x', repo: 'acme', branch: 'feat/x', hue: 120,
    reasons: ['pr-green'], since: NOW - MIN, waitMs: MIN,
    pr: { number: 12, url: 'https://example.invalid/pr/12', state: 'OPEN', isDraft: false, verdict: 'green' },
    checks: { passed: 4, failed: 0, pending: 1, total: 5 },
    diffStat: { files: 3, add: 10, del: 2 }, packages: ['web'], costUsd: 1.25,
    sessions: [{ fkey: 'builder-a/x-s1', state: null }],
  });
});

test('missing or malformed optional fields degrade to safe defaults', () => {
  const [i] = buildReviewQueue([{
    id: 'x', key: 'builder-a/x', builder: 'builder-a',
    reviewReady: { ready: true, reasons: 'done-marker', since: NOW - 1000 },
    diffStat: null, packages: ['ok', 3, ''], costUsd: NaN, pr: { none: true }, hue: 'red',
  }], NOW);
  assert.equal(i.pr, null);
  assert.equal(i.checks, null);
  assert.equal(i.diffStat, null);
  assert.deepEqual(i.packages, ['ok']);
  assert.equal(i.costUsd, 0);
  assert.deepEqual(i.reasons, []);
  assert.deepEqual(i.sessions, []);
  assert.equal(typeof i.hue, 'number');
  assert.equal(i.repo, null);
  assert.equal(i.branch, null);
});

test('skips lanes without a usable identity or since; bad input gives []', () => {
  assert.deepEqual(buildReviewQueue(null, NOW), []);
  const q = buildReviewQueue([
    null,
    { id: 'x', reviewReady: { ready: true, since: NOW } },                     // no builder, no key
    { id: 'y', builder: 'Bad Id', key: 'nope', reviewReady: { ready: true, since: NOW } },
    { id: 'z', builder: 'builder-a', reviewReady: { ready: true, since: 'soon' } },
    { id: 'w', builder: 'builder-a', reviewReady: { ready: 'yes', since: NOW } },
    { key: 'builder-b/k', reviewReady: { ready: true, since: NOW - 5 } },      // key only: ok
  ], NOW);
  assert.deepEqual(q.map((i) => [i.fkey, i.builder, i.lane]), [['builder-b/k', 'builder-b', 'k']]);
});

test('the fkey comes from the store-stamped builder, not a nested key (S2)', () => {
  const [i] = buildReviewQueue([lane('builder-a', 'x', { since: NOW - 1, key: 'builder-b/x' })], NOW);
  assert.equal(i.fkey, 'builder-a/x');
  assert.equal(i.builder, 'builder-a');
});

test('storeLookups reads PRs and repo from the builder box and session states from the index', () => {
  const store = {
    builders: new Map([
      ['builder-a', { id: 'builder-a', box: {
        prs: { x: { number: 7, state: 'OPEN', isDraft: false, verdict: 'pending', checks: { passed: 1, failed: 0, pending: 2, total: 3 } } },
        launched: [{ id: 'x', repo: 'acme' }],
      } }],
      ['builder-b', { id: 'builder-b', box: { prs: { x: { none: true } } } }],
    ]),
    sessions: new Map([['builder-a/x-s1', { state: 'done' }], ['builder-b/x-s1', { state: 'idle' }]]),
  };
  const q = buildReviewQueue([
    lane('builder-a', 'x', { since: NOW - 2 * MIN }),
    lane('builder-b', 'x', { since: NOW - MIN }),
  ], NOW, storeLookups(store));
  assert.equal(q[0].fkey, 'builder-a/x');
  assert.equal(q[0].pr.number, 7);
  assert.deepEqual(q[0].checks, { passed: 1, failed: 0, pending: 2, total: 3 });
  assert.equal(q[0].repo, 'acme');
  assert.deepEqual(q[0].sessions, [{ fkey: 'builder-a/x-s1', state: 'done' }]);
  assert.equal(q[1].pr, null);
  assert.equal(q[1].repo, null);
  assert.deepEqual(q[1].sessions, [{ fkey: 'builder-b/x-s1', state: 'idle' }]);
  // an empty store is fine
  assert.equal(buildReviewQueue([lane('builder-a', 'x', { since: NOW })], NOW, storeLookups({})).length, 1);
});

test('formatWait renders the review-wait timer text', () => {
  assert.equal(formatWait(0), '0s');
  assert.equal(formatWait(45_000), '45s');
  assert.equal(formatWait(12 * MIN), '12m');
  assert.equal(formatWait(185 * MIN), '3h05m');
  assert.equal(formatWait((2 * 24 + 4) * 60 * MIN), '2d04h');
  assert.equal(formatWait(-5), '0s');
  assert.equal(formatWait(undefined), '0s');
});

test('REASONS matches the server rule vocabulary', async () => {
  assert.deepEqual([...REASONS].sort(), ['done-marker', 'pr-green', 'stop-diff']);
});
