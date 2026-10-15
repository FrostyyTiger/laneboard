// The Review group renderer (fleet plan §10 R13): renders a fixture queue in
// the fake DOM, one row per item, with the wait timer text present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import {
  renderReviewQueue, mountReviewQueue, rowActions, pullFor, prChip, checksParts, checksTitle,
  diffStatText, ciRepoOf, waitAt, builderCodeOf, queueFor, OVERDUE_MS, PKG_MAX,
} from '../public/js/views/review-queue.js';
import { buildReviewQueue, formatWait } from '../public/js/core/review-queue.js';

const SRC = fs.readFileSync(path.resolve(import.meta.dirname, '../public/js/views/review-queue.js'), 'utf8');
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}

const byClass = (node, cls) => node.querySelectorAll(`.${cls}`);

function lane(id, builder, sinceAgo, extra = {}) {
  return {
    id, builder, key: `${builder}/${id}`, branch: `feat/${id}`, repo: 'acme',
    reviewReady: { ready: true, reasons: ['done-marker', 'pr-green'], since: NOW - sinceAgo },
    reviewSentAt: null,
    diffStat: { files: 4, add: 12, del: 3 },
    packages: ['core', 'web'],
    costUsd: 1.5,
    ...extra,
  };
}

const FIXTURE_LANES = [
  lane('auth', 'builder-a', 30 * MIN, {
    pr: { number: 42, url: 'https://github.com/acme/acme/pull/42', state: 'OPEN', isDraft: false,
      checks: { passed: 3, failed: 1, pending: 2, total: 6 } },
  }),
  lane('billing', 'hub', 5 * HOUR, { packages: ['a', 'b', 'c', 'd', 'e', 'f'] }),
  lane('cache', 'builder-a', 2 * MIN, { reviewReady: { ready: false, reasons: [], since: NOW - HOUR } }),
  lane('docs', 'hub', 10 * MIN, {
    pr: { number: 7, url: 'https://github.com/acme/acme/pull/7', state: 'MERGED', isDraft: false },
    reviewSentAt: NOW - 4 * MIN,
  }),
];
const FIXTURE = buildReviewQueue(FIXTURE_LANES, NOW);

test('renders one row per queue item, longest wait first, with the wait timer text', () => withDom(() => {
  const host = document.createElement('div');
  const view = renderReviewQueue(host, FIXTURE, { now: NOW, navigate: () => {} });
  const rows = byClass(host, 'rq-row');
  assert.equal(FIXTURE.length, 3, 'the not-ready lane is filtered out');
  assert.equal(rows.length, 3);
  assert.equal(view.rows.length, 3);
  assert.deepEqual(rows.map((r) => r.dataset.fkey), ['hub/billing', 'builder-a/auth', 'hub/docs']);
  const waits = byClass(host, 'rq-wait-t').map((n) => n.textContent);
  assert.deepEqual(waits, [formatWait(5 * HOUR), formatWait(30 * MIN), formatWait(6 * MIN)]);
  assert.deepEqual(waits, ['5h00m', '30m', '6m']);
  // overdue past 4 h
  const waitEls = byClass(host, 'rq-wait');
  assert.equal(waitEls[0].dataset.p, '2');
  assert.equal(waitEls[1].dataset.p, undefined);
}));

test('a row carries plate, lane, PR chip and checks glyphs, diff stat, packages, cost and reasons', () => withDom(() => {
  const host = document.createElement('div');
  renderReviewQueue(host, FIXTURE, { now: NOW, navigate: () => {} });
  const auth = byClass(host, 'rq-row').find((r) => r.dataset.fkey === 'builder-a/auth');
  const t = texts(auth);
  assert.ok(t.includes('BA'), 'builder plate (derived code)');
  assert.ok(t.includes('auth'));
  assert.ok(t.includes('#42'));
  assert.deepEqual(byClass(auth, 'ck').map((n) => n.textContent), ['✓3', '✗1', '…2']);
  assert.ok(t.includes('+12 −3 · 4 files'));
  assert.deepEqual(byClass(auth, 'rq-pkg').map((n) => n.textContent), ['core', 'web']);
  assert.ok(t.includes('$1.50'));
  assert.equal(byClass(auth, 'rq-reason').length, 2);
  const acts = byClass(auth, 'rq-act').map((b) => b.dataset.act);
  assert.deepEqual(acts, ['diff', 'inspect', 'pull']);

  const billing = byClass(host, 'rq-row').find((r) => r.dataset.fkey === 'hub/billing');
  const pk = byClass(billing, 'rq-pkg').map((n) => n.textContent);
  assert.equal(pk.length, PKG_MAX + 1);
  assert.equal(pk.at(-1), '+2');
  assert.ok(texts(billing).includes('—'), 'no PR -> dash');
}));

test('row actions navigate to the diff view and the inspector; archive only for merged with a handler', () => {
  const calls = [];
  const navigate = (p) => calls.push(p);
  const [billing, auth, docs] = FIXTURE;
  const acts = rowActions(auth, { navigate });
  acts.find((a) => a.id === 'diff').run();
  acts.find((a) => a.id === 'inspect').run();
  assert.deepEqual(calls, [{ view: 'diff', sel: 'builder-a/auth' }, { sel: 'builder-a/auth' }]);
  assert.equal(acts.some((a) => a.id === 'archive'), false);
  assert.equal(rowActions(docs, { navigate }).some((a) => a.id === 'archive'), false, 'no handler, no archive');
  const archived = [];
  const withArchive = rowActions(docs, { navigate, archive: (i) => archived.push(i.fkey) });
  withArchive.find((a) => a.id === 'archive').run();
  assert.deepEqual(archived, ['hub/docs']);
  assert.equal(rowActions(billing, { navigate, archive: () => {} }).some((a) => a.id === 'archive'), false, 'not merged');
  assert.deepEqual(rowActions(auth, {}).map((a) => a.id), ['pull'], 'no navigate, no nav actions');
});

test('pull commands: fetch + gh checkout from a GitHub PR URL; nothing for unsafe parts', () => {
  const auth = FIXTURE[1];
  const cmds = pullFor(auth);
  assert.equal(cmds.length, 2);
  assert.match(cmds[0].cmd, /^git fetch origin 'feat\/auth'/);
  assert.equal(cmds[1].cmd, "gh pr checkout 42 --repo 'acme/acme'");
  assert.deepEqual(pullFor({ ...auth, branch: '--upload-pack=x' }), []);
  assert.deepEqual(pullFor({ ...auth, repo: '$(id)' }), []);
  assert.equal(pullFor({ ...auth, pr: { number: 42, url: 'https://evil.invalid/x' } }).length, 1, 'no ciRepo, no gh command');
  assert.equal(ciRepoOf('https://github.com/acme/acme/pull/42'), 'acme/acme');
  assert.equal(ciRepoOf('https://github.com/acme/a b/pull/42'), null);
  assert.equal(ciRepoOf(null), null);
});

test('untrusted text goes in as text, never markup', () => withDom(() => {
  const evil = '<img src=x onerror=alert(1)>';
  const items = buildReviewQueue([lane('x1', 'builder-a', MIN, { branch: evil, packages: [evil] })], NOW);
  items[0].lane = evil;
  const host = document.createElement('div');
  renderReviewQueue(host, items, { now: NOW, navigate: () => {} });
  const t = texts(host);
  assert.ok(t.includes(evil));
  const walk = (n) => { assert.equal(n.innerHTML, '', 'no innerHTML'); n.children.forEach(walk); };
  walk(host);
  assert.doesNotMatch(SRC, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
}));

test('tick: an open wait keeps counting from since; a closed one (review sent) stays put', () => withDom(() => {
  const host = document.createElement('div');
  const view = renderReviewQueue(host, FIXTURE, { now: NOW });
  view.tick(NOW + 2 * MIN);
  const waits = byClass(host, 'rq-wait-t').map((n) => n.textContent);
  assert.deepEqual(waits, ['5h02m', '32m', '6m']);
  assert.equal(view.rows[1].waitText, '32m');
  assert.equal(waitAt(FIXTURE[2], NOW, NOW + HOUR), 6 * MIN);
  assert.equal(waitAt(FIXTURE[1], NOW, NOW + HOUR), 90 * MIN);
}));

test('an empty queue renders the empty line', () => withDom(() => {
  const host = document.createElement('div');
  renderReviewQueue(host, [], { now: NOW });
  assert.equal(byClass(host, 'rq-row').length, 0);
  assert.ok(texts(host).includes('No lanes are waiting for review.'));
  renderReviewQueue(host, null, {});
  assert.equal(host.children.length, 1, 'replaces what was there');
}));

test('mountReviewQueue builds from the store (PRs from box.prs, codes from builders) and updates', () => withDom(() => {
  const store = {
    builders: new Map([
      ['builder-a', { id: 'builder-a', code: 'B1', box: { prs: { auth: { number: 9, state: 'OPEN', checks: { passed: 2 } } }, launched: [{ id: 'auth', repo: 'acme' }] } }],
      ['hub', { id: 'hub', box: null }],
    ]),
    sessions: new Map(),
    lanes: [lane('auth', 'builder-a', 20 * MIN, { repo: undefined }), lane('billing', 'hub', HOUR)],
  };
  assert.equal(builderCodeOf(store, 'builder-a'), 'B1');
  assert.equal(builderCodeOf(store, 'hub'), 'HU');
  assert.equal(queueFor(store, NOW).length, 2);
  const host = document.createElement('div');
  const m = mountReviewQueue(host, { store, now: NOW, navigate: () => {} });
  assert.equal(m.count, 2);
  assert.equal(byClass(host, 'rq-row').length, 2);
  const auth = byClass(host, 'rq-row').find((r) => r.dataset.fkey === 'builder-a/auth');
  assert.ok(texts(auth).includes('B1'));
  assert.ok(texts(auth).includes('#9'));
  assert.deepEqual(byClass(auth, 'ck').map((n) => n.textContent), ['✓2']);
  store.lanes.push(lane('cache', 'builder-a', 3 * HOUR));
  m.update();
  assert.equal(m.count, 3);
  assert.equal(byClass(host, 'rq-row')[0].dataset.fkey, 'builder-a/cache');
  m.tick(NOW + MIN);
  m.unmount();
  assert.equal(host.children.length, 0);
}));

test('pure helpers', () => {
  assert.equal(prChip(null), null);
  assert.equal(prChip({ number: 3, state: 'OPEN', isDraft: true }).icon, 'pr-draft');
  assert.equal(prChip({ number: 3, state: 'MERGED' }).state, 'merged');
  assert.deepEqual(checksParts({ passed: 0, failed: 2 }), [{ s: 'fail', g: '✗2' }]);
  assert.equal(checksTitle({ passed: 1, pending: 1 }), 'checks: 1 passed, 1 pending');
  assert.equal(checksTitle(null), 'no checks');
  assert.equal(diffStatText(null), '—');
  assert.equal(diffStatText({ files: 1, add: 0, del: 2 }), '+0 −2 · 1 file');
  assert.equal(OVERDUE_MS, 4 * HOUR);
});

test('pure at import time and free of the forbidden module shapes', () => {
  assert.doesNotMatch(SRC, /\bclass\s+\w+|\bsuper\(/);
  assert.doesNotMatch(SRC, /d3/i);
});
