import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const { reviewReadyOf, nextGreenSince, parseNumstat, isPrGreen } = await import('../server/review/ready.mjs');
const review = await import('../server/collector/review.mjs');
const stateMod = await import('../server/state.mjs');
const { createContext } = await import('../server/modules.mjs');
const flag = (await import('../server/flags/review.mjs')).default;

const lane = (over = {}) => ({ id: 'x1', isMain: false, merged: false, sessions: ['builder-a-x1'], ...over });
const done = (stateSince) => ({ name: 'builder-a-x1', state: 'done', stateSince });
const greenPr = (over = {}) => ({ number: 7, state: 'OPEN', isDraft: false, verdict: 'green', ...over });
const marker = (ts) => ({ id: ts, ts, kind: 'done', dismissed_at: null });

// --- the pure rule -------------------------------------------------------------

test('done marker newer than reviewSentAt is ready', () => {
  const r = reviewReadyOf({ lane: lane(), sessions: [{ name: 'builder-a-x1', state: 'idle', stateSince: 1 }], doneMarkers: [marker(2000)], reviewSentAt: 1000 });
  assert.deepEqual(r, { ready: true, reasons: ['done-marker'], since: 2000 });
});

test('done marker older than reviewSentAt is not ready', () => {
  assert.equal(reviewReadyOf({ lane: lane(), doneMarkers: [marker(500)], reviewSentAt: 1000 }), null);
});

test('done marker with no review sent yet is ready; dismissed markers do not count', () => {
  assert.equal(reviewReadyOf({ lane: lane(), doneMarkers: [marker(5)] })?.ready, true);
  assert.equal(reviewReadyOf({ lane: lane(), doneMarkers: [{ ...marker(5), dismissed_at: 9 }] }), null);
});

test('PR green is ready, green but draft is not', () => {
  const r = reviewReadyOf({ lane: lane(), pr: greenPr(), greenSince: 3000 });
  assert.deepEqual(r, { ready: true, reasons: ['pr-green'], since: 3000 });
  assert.equal(reviewReadyOf({ lane: lane(), pr: greenPr({ isDraft: true }), greenSince: 3000 }), null);
  assert.equal(reviewReadyOf({ lane: lane(), pr: greenPr({ verdict: 'pending' }) }), null);
  assert.equal(isPrGreen({ none: true }), false);
});

test('stop-diff needs changes: 0 files and 0 dirty is not ready', () => {
  assert.equal(reviewReadyOf({ lane: lane(), sessions: [done(4000)], diffStat: { files: 0, add: 0, del: 0 }, dirtyCount: 0 }), null);
  assert.deepEqual(
    reviewReadyOf({ lane: lane(), sessions: [done(4000)], diffStat: { files: 2, add: 3, del: 1 }, dirtyCount: 0 }),
    { ready: true, reasons: ['stop-diff'], since: 4000 },
  );
  // dirty files alone count
  assert.equal(reviewReadyOf({ lane: lane(), sessions: [done(4000)], diffStat: null, dirtyCount: 1 })?.ready, true);
  // a stop before the last review does not count
  assert.equal(reviewReadyOf({ lane: lane(), sessions: [done(4000)], diffStat: { files: 2 }, reviewSentAt: 5000 }), null);
});

test('any working or waiting_permission session is not ready', () => {
  for (const state of ['working', 'waiting_permission']) {
    const sessions = [done(1), { name: 'builder-a-x1b', state, stateSince: 2 }];
    assert.equal(reviewReadyOf({ lane: lane(), sessions, doneMarkers: [marker(5)], pr: greenPr(), diffStat: { files: 1 } }), null, state);
  }
});

test('merged lane, main checkout and MERGED/CLOSED PR are not ready', () => {
  const ready = { doneMarkers: [marker(5)] };
  assert.equal(reviewReadyOf({ lane: lane({ merged: true }), ...ready }), null);
  assert.equal(reviewReadyOf({ lane: lane({ isMain: true }), ...ready }), null);
  assert.equal(reviewReadyOf({ lane: lane(), pr: greenPr({ state: 'CLOSED' }), ...ready }), null);
  assert.equal(reviewReadyOf({ lane: lane(), pr: greenPr({ state: 'MERGED' }), ...ready }), null);
  assert.equal(reviewReadyOf({ lane: null, ...ready }), null);
});

test('since is the minimum of the triggers', () => {
  const r = reviewReadyOf({
    lane: lane(), sessions: [done(7000)], doneMarkers: [marker(9000), marker(8000)], pr: greenPr(), greenSince: 6000, diffStat: { files: 1 },
  });
  assert.deepEqual(r.reasons, ['done-marker', 'pr-green', 'stop-diff']);
  assert.equal(r.since, 6000);
  const r2 = reviewReadyOf({ lane: lane(), sessions: [done(7000)], doneMarkers: [marker(9000)], diffStat: { files: 1 } });
  assert.equal(r2.since, 7000);
});

test('nextGreenSince: set on first green, kept while green, cleared on non-green, kept on error', () => {
  assert.equal(nextGreenSince(null, greenPr(), 100), 100);
  assert.equal(nextGreenSince(100, greenPr(), 200), 100);
  assert.equal(nextGreenSince(100, greenPr({ verdict: 'red' }), 300), null);
  assert.equal(nextGreenSince(100, { error: 'x' }, 300), 100);
  assert.equal(nextGreenSince(100, null, 300), null);
});

test('parseNumstat: counts, binary, rename, path cap', () => {
  const out = '3\t1\ta.js\0-\t-\timg.png\0' + '2\t0\t\0old/b.js\0new/b.js\0' + '1\t1\tsp ace.md\0';
  assert.deepEqual(parseNumstat(out), { files: 4, add: 6, del: 2, paths: ['a.js', 'img.png', 'new/b.js', 'sp ace.md'] });
  assert.deepEqual(parseNumstat(''), { files: 0, add: 0, del: 0, paths: [] });
  const many = Array.from({ length: 10 }, (_, i) => `1\t0\tf${i}`).join('\0') + '\0';
  const p = parseNumstat(many, 3);
  assert.equal(p.files, 10);
  assert.deepEqual(p.paths, ['f0', 'f1', 'f2']);
});

// --- the collector against a temp repo -------------------------------------------

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-review-ready-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const g = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { env, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'b.txt'), 'b\n');
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('checkout', '-q', '-b', 'feat/x');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nTWO\nthree\n');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  g('add', '.');
  g('commit', '-q', '-m', 'work');
  return { dir, g };
}

function memKv() {
  const m = new Map();
  return { kvRead: (k) => (m.has(k) ? JSON.parse(m.get(k)) : {}), kvWrite: (k, v) => m.set(k, JSON.stringify(v)), m };
}

test('collector: diffStat from git against the merge base, working tree included', async (t) => {
  const { dir } = tmpRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  review._reset();
  const kv = memKv();
  const calls = [];
  const { run } = await import('../server/util.mjs');
  review.init({
    ...kv,
    worktrees: () => [{ id: 'x1', root: dir, isMain: false }, { id: 'acme', root: '/nonexistent', isMain: true }],
    repoFor: () => 'acme',
    repoConfig: () => ({ name: 'acme', packages: [{ name: 'pkg', paths: ['pkg/**'] }, { name: 'root', paths: ['*.txt'] }] }),
    baseRef: () => 'origin/main',
    markersFor: () => [],
    run: (cmd, args, opts) => { calls.push({ args, env: opts.env }); return run(cmd, args, opts); },
  });
  // uncommitted change to a tracked file counts
  fs.writeFileSync(path.join(dir, 'pkg', 'b.txt'), 'b\nmore\n');
  await review.refresh(1000);
  assert.deepEqual(review.diffStatOf('x1'), { files: 3, add: 4, del: 1 });
  assert.deepEqual([...review.pathsOf('x1')].sort(), ['a.txt', 'c.txt', 'pkg/b.txt']);
  assert.equal(review.diffStatOf('acme'), null, 'main checkouts are skipped');
  assert.ok(calls.every((c) => c.env.GIT_OPTIONAL_LOCKS === '0'));
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'index.lock')));
  const mbCalls = calls.filter((c) => c.args.includes('merge-base')).length;
  await review.refresh(2000);
  assert.equal(calls.filter((c) => c.args.includes('merge-base')).length, mbCalls, 'merge base is cached');

  const deco = review.decorate(
    { id: 'x1', isMain: false, merged: false, sessions: ['builder-a-x1'] },
    { now: 3000, sessions: [{ name: 'builder-a-x1', state: 'done', stateSince: 2500, cost: { usd: 1.25 } }, { name: 'other', state: 'done', cost: { usd: 9 } }] },
  );
  assert.deepEqual(deco.reviewReady, { ready: true, reasons: ['stop-diff'], since: 2500 });
  assert.deepEqual(deco.diffStat, { files: 3, add: 4, del: 1 });
  assert.deepEqual(deco.packages.sort(), ['pkg', 'root']);
  assert.equal(deco.costUsd, 1.25);
  assert.equal(deco.reviewSentAt, null);
  review._reset();
});

test('collector: readySince persists across restarts, sentAt closes the episode', async () => {
  review._reset();
  const kv = memKv();
  let markers = [marker(1000)];
  const base = { ...kv, worktrees: () => [], markersFor: () => markers };
  review.init(base);
  await review.refresh(1500);
  const l = { id: 'x1', isMain: false, merged: false, sessions: [] };
  assert.equal(review.readyFor(l, [], 2000).since, 1000);
  assert.equal(JSON.parse(kv.m.get(review.KV_READY)).x1, 1000);

  // "restart": a newer marker would move since, the stored episode wins
  review._reset();
  review.init(base);
  markers = [marker(1800)];
  await review.refresh(2500);
  assert.equal(review.readyFor(l, [], 3000).since, 1000);

  // a review is sent: the marker is older than it, not ready, episode cleared
  review.setReviewSent('x1', 2000);
  assert.equal(review.reviewSentAt('x1'), 2000);
  assert.equal(review.readyFor(l, [], 10_000), null);
  assert.equal(JSON.parse(kv.m.get(review.KV_READY)).x1, undefined);
  review._reset();
});

test('collector: greenSince tracking and PR MERGED sets reviewSentAt', async () => {
  review._reset();
  const kv = memKv();
  let pr = greenPr();
  review.init({ ...kv, worktrees: () => [{ id: 'x1', root: '/nonexistent-lb', isMain: false }], prFor: () => pr, markersFor: () => [], run: async () => ({ ok: false, stdout: '' }) });
  await review.refresh(100);
  assert.equal(review.greenSince('x1'), 100);
  await review.refresh(200);
  assert.equal(review.greenSince('x1'), 100);
  const l = { id: 'x1', isMain: false, merged: false, sessions: [] };
  assert.deepEqual(review.readyFor(l, [], 250), { ready: true, reasons: ['pr-green'], since: 100 });
  pr = greenPr({ verdict: 'red' });
  await review.refresh(300);
  assert.equal(review.greenSince('x1'), null);
  assert.equal(review.reviewSentAt('x1'), null);
  pr = greenPr({ state: 'MERGED' });
  await review.refresh(400);
  assert.equal(review.reviewSentAt('x1'), 400);
  await review.refresh(500);
  assert.equal(review.reviewSentAt('x1'), 400, 'only the transition sets it');
  review._reset();
});

test('flag module registers a lane decorator: snapshot lanes carry the review fields', async () => {
  stateMod._resetHooks();
  review._reset();
  const ctx = createContext({
    state: stateMod,
    prs: { get: () => null },
    retirer: { cached: () => ({ x1: { dirtyFiles: ['a', 'b'] } }) },
  }, { route: () => {}, upgradeHandlers: [] });
  flag.register(ctx);
  review.init({ ...memKv(), prFor: () => null, dirtyFor: (id) => (id === 'x1' ? 2 : 0), worktrees: () => [], markersFor: () => [] });
  await review.refresh(10);
  const lanes = stateMod.decorateLanes(
    [{ id: 'x1', isMain: false, merged: false, sessions: ['builder-a-x1'] }, { id: 'acme', isMain: true, merged: null, sessions: [] }],
    1000,
    [{ name: 'builder-a-x1', state: 'done', stateSince: 900, cost: { usd: 0.5 } }],
  );
  assert.deepEqual(lanes[0].reviewReady, { ready: true, reasons: ['stop-diff'], since: 900 });
  assert.equal(lanes[0].costUsd, 0.5);
  assert.equal(lanes[0].diffStat, null);
  assert.deepEqual(lanes[0].packages, []);
  assert.equal(lanes[1].reviewReady, null);
  for (const k of ['reviewReady', 'reviewSentAt', 'diffStat', 'packages', 'costUsd']) assert.ok(k in lanes[1], k);
  // wire() maps ctx.retirer to dirtyFor
  const { wire } = await import('../server/flags/review.mjs');
  assert.equal(wire(ctx).dirtyFor('x1'), 2);
  flag.stop();
  stateMod._resetHooks();
  review._reset();
});
