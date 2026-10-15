// The lane archive (fleet §10 2.9, R9): retire writes a row captured before the
// worktree goes; a failed retire writes none; the backfill never duplicates;
// LIKE search is literal; cost is the sum of each session's max; restore is a
// launch under a new id, refused at validate when the branch is gone.
//
// Hermetic: in-memory db, scratch ~/lanes, ~/code, tmux dir and `claude`; the
// slot provider is a fake that takes nothing down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-archive-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const claude = path.join(bin, 'claude');
fs.writeFileSync(claude, `#!/bin/sh\ncat <<'EOF'\n  --permission-mode <mode>  Permission mode\n     (choices: "acceptEdits", "auto", "default", "plan")\nEOF\n`, { mode: 0o755 });
delete process.env.TMUX;
delete process.env.TMUX_PANE;
process.env.LANEBOARD_DB = ':memory:';
process.env.LANEBOARD_CONFIG ??= '/dev/null';
process.env.LANEBOARD_CLAUDE_BIN = claude;
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_REPOS = 'example-repo';
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');
process.env.LANEBOARD_STATE_DIR = path.join(tmp, 'state');
process.env.LANEBOARD_AUDIT_FILE = path.join(tmp, 'audit.jsonl');
process.env.TMUX_TMPDIR = path.join(tmp, 'tmux');
fs.mkdirSync(process.env.TMUX_TMPDIR);

const providers = await import('../server/providers/index.mjs');
const fakeSlots = {
  name: 'fake', available: true, slotCount: 5, calls: [], downResult: null,
  ports: (n) => ({ pg: 15432 + (n - 1) * 100 }),
  envCommand: () => '',
  list: async () => ({ ok: true, bySlot: new Map() }),
  existing: async () => [],
  up: async () => ({ ok: true }),
  env: async () => ({ ok: false, error: 'not in this test' }),
  down: async (n) => { fakeSlots.calls.push(['down', n]); return fakeSlots.downResult ?? { ok: true }; },
  dropVolumes: async (n) => { fakeSlots.calls.push(['dropVolumes', n]); return { ok: true, removed: [], skipped: [] }; },
};
providers._set('slots', fakeSlots);

const db = await import('../server/db.mjs');
const store = await import('../server/lanes/store.mjs');
const archive = await import('../server/lanes/archive.mjs');
const R = await import('../server/lanes/retire.mjs');
const L = await import('../server/lanes/launch.mjs');
const routesMod = await import('../server/routes/archive.mjs');

R.init({ state: { all: () => [] }, prFor: (id) => prs[id] ?? null });
L.init({ state: { get: () => null, tick: async () => {} } });
const prs = {};
const progress = new Map();
archive.init({ progress: { get: (id) => progress.get(id) ?? null } });

const mainRepo = path.join(tmp, 'code', 'example-repo');
fs.mkdirSync(mainRepo, { recursive: true });
const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }).toString();
gitIn(mainRepo, 'init', '-q', '-b', 'main');
gitIn(mainRepo, 'commit', '-q', '--allow-empty', '-m', 'first');

const PLAN = '# Lane alpha: make the widget\n\n## Stage 1: parse\n\nx\n\n## Stage 2: render\n\ny\n';

/** A worktree on feat/<id> with the plan committed, and its record. */
async function lane(id, { plan = PLAN, createdAt = 1000, session = id } = {}) {
  const root = path.join(tmp, 'code', `example-repo-${id}`);
  gitIn(mainRepo, 'worktree', 'add', '-q', '-b', `feat/${id}`, root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', `${id}.md`), plan);
  gitIn(root, 'add', '.');
  gitIn(root, 'commit', '-q', '-m', 'Stage 1: parse');
  const rec = {
    id, repo: 'example-repo', root, branch: `feat/${id}`, plan: `docs/plans/${id}.md`, slot: 2,
    model: 'opus', permissionMode: 'auto', session, createdAt, retiredAt: null,
  };
  await store.write(rec);
  return rec;
}

// --- db ------------------------------------------------------------------------

test('listArchive LIKE search is literal: % and _ match only themselves', () => {
  db.addArchive({ lane: 'pct', retired_at: 10, summary: 'got to 100% done' });
  db.addArchive({ lane: 'under', retired_at: 11, summary: 'snake_case' });
  db.addArchive({ lane: 'plain', retired_at: 12, summary: 'nothing special', branch: 'feat/plain', plan_title: 'Widget' });
  assert.deepEqual(db.listArchive({ q: '%' }).map((r) => r.lane), ['pct']);
  assert.deepEqual(db.listArchive({ q: '_' }).map((r) => r.lane), ['under']);
  assert.deepEqual(db.listArchive({ q: 'e_c' }).map((r) => r.lane), ['under']);
  assert.deepEqual(db.listArchive({ q: 'widget' }).map((r) => r.lane), ['plain'], 'plan_title, case-insensitive');
  assert.deepEqual(db.listArchive({ q: 'feat/pl' }).map((r) => r.lane), ['plain'], 'branch');
  assert.deepEqual(db.listArchive({ q: '\\' }), []);
  assert.deepEqual(db.listArchive({}).slice(0, 3).map((r) => r.lane), ['plain', 'under', 'pct'], 'newest first');
  assert.deepEqual(db.listArchive({ before: 12, limit: 1 }).map((r) => r.lane), ['under']);
  assert.equal(db.listArchive({})[0].plan_head, undefined, 'the list leaves the plan head out');
});

test('addArchive upserts and never clears restored_as; setRestoredAs needs a row', () => {
  db.addArchive({ lane: 'up', retired_at: 20, summary: 'a', markers: [{ kind: 'done', text: 'a' }] });
  assert.equal(db.setRestoredAs('up', 'up-r1'), true);
  db.addArchive({ lane: 'up', retired_at: 21, summary: 'b' });
  const r = db.getArchive('up');
  assert.equal(r.summary, 'b');
  assert.equal(r.retired_at, 21);
  assert.equal(r.restored_as, 'up-r1');
  assert.deepEqual(r.markers, []);
  assert.equal(db.setRestoredAs('nosuch', 'x'), false);
  assert.equal(db.getArchive('nosuch'), null);
  assert.throws(() => db.addArchive({ lane: 'x' }), /retired_at/);
});

test('archive rows are never pruned by retention', () => {
  db.addArchive({ lane: 'ancient', retired_at: 1 });
  db.pruneOldRows();
  assert.ok(db.getArchive('ancient'));
});

test('laneCostAllTime sums the max per session, by lane or by session name', () => {
  const s = (sessionName, sessionId, usd, laneId, ts) => db.addCostSnapshot({ ts, sessionName, sessionId, usd, tokens: { in: usd * 10, out: 1 }, lane: laneId });
  // cumulative snapshots: the max (last) of each session counts once
  s('costy', 'sid-1', 1, 'costy', 100);
  s('costy', 'sid-1', 3, 'costy', 200);
  // a second transcript under the same name (claude restarted): its own max
  s('costy', 'sid-2', 2, null, 300);
  // attributed by lane alone, under a renamed session
  s('other-name', 'sid-3', 0.5, 'costy', 400);
  // someone else's
  s('unrelated', 'sid-4', 50, 'unrelated', 500);
  const c = db.laneCostAllTime('costy', ['costy']);
  assert.equal(c.usd, 5.5);
  assert.equal(c.sessions, 3);
  assert.equal(c.tokens, 31 + 21 + 6);
  assert.equal(db.laneCostAllTime('costy', []).usd, 3.5, 'without the name only lane-attributed rows count');
});

// --- capture and commit through retire -------------------------------------------

test('retire writes a row captured before the worktree goes: plan, progress, PR, cost, markers incl. dismissed', async () => {
  const rec = await lane('alpha', { createdAt: Date.now() - 60_000 });
  progress.set('alpha', { n: 1, m: 2 });
  prs.alpha = { number: 7, url: 'https://example.invalid/acme/pr/7', state: 'MERGED' };
  db.addMarker({ lane: 'alpha', sessionName: 'alpha', kind: 'blocked', text: 'waiting on tests', source: 'pane', ts: 1 });
  const dismissed = db.listMarkers({ lane: 'alpha' })[0].id;
  db.dismissMarker(dismissed);
  db.addMarker({ lane: 'alpha', sessionName: 'alpha', kind: 'done', text: 'widget renders', source: 'pane', ts: 2 });
  db.addCostSnapshot({ ts: 10, sessionName: 'alpha', sessionId: 'a1', usd: 2.25, tokens: { in: 100 }, lane: 'alpha' });

  const r = await R.retire('alpha', { force: true, confirm: 'alpha' });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(rec.root), false, 'the worktree is gone');
  const row = db.getArchive('alpha');
  assert.ok(row, 'a row was written');
  assert.equal(row.plan_title, 'Lane alpha: make the widget');
  assert.equal(row.plan_head, PLAN, 'read from the worktree before it was removed');
  assert.equal(row.repo, 'example-repo');
  assert.equal(row.branch, 'feat/alpha');
  assert.equal(row.plan_path, 'docs/plans/alpha.md');
  assert.equal(row.stage_n, 1);
  assert.equal(row.stage_m, 2);
  assert.equal(row.pr_number, 7);
  assert.equal(row.pr_url, 'https://example.invalid/acme/pr/7');
  assert.equal(row.pr_state, 'MERGED');
  assert.equal(row.merged, true);
  assert.equal(row.cost_usd, 2.25);
  assert.equal(row.tokens, 100);
  assert.equal(row.summary, 'widget renders');
  assert.equal(row.markers.length, 2);
  assert.ok(row.markers.some((m) => m.id === dismissed && m.dismissed_at), 'dismissed markers are kept');
  assert.equal(row.retired_at, store.read('alpha').retiredAt);
  assert.equal(row.duration_ms, row.retired_at - rec.createdAt);
  assert.equal(row.record.model, 'opus');
  assert.equal(row.record.permissionMode, 'auto');
});

test('a failed retire writes no row', async () => {
  await lane('beta');
  fakeSlots.downResult = { ok: false, error: 'compose said no' };
  try {
    const r = await R.retire('beta', { force: true, confirm: 'beta' });
    assert.equal(r.ok, false);
  } finally {
    fakeSlots.downResult = null;
  }
  assert.equal(db.getArchive('beta'), null);
  assert.equal(store.read('beta').retiredAt, null);
});

test('retire still refuses an unready lane without force, and a force without confirm; no row either way', async () => {
  const rec = await lane('gamma');
  fs.writeFileSync(path.join(rec.root, 'dirty.txt'), 'x');
  await assert.rejects(R.retire('gamma'), (e) => e.status === 409 && /not ready to retire/.test(e.message));
  await assert.rejects(R.retire('gamma', { force: true }), (e) => e.status === 400 && /confirm/.test(e.message));
  assert.equal(db.getArchive('gamma'), null);
  assert.ok(fs.existsSync(rec.root));
});

test('the plan head is capped at 64 KiB', async () => {
  const big = `# Big\n\n## Stage 1: x\n\n${'é'.repeat(70 * 1024)}`;
  const rec = await lane('big', { plan: big });
  const snap = await archive.capture(rec);
  assert.ok(Buffer.byteLength(snap.plan_head) <= archive.PLAN_HEAD_BYTES);
  assert.ok(Buffer.byteLength(snap.plan_head) > archive.PLAN_HEAD_BYTES - 4);
  assert.equal(snap.plan_title, 'Big');
});

// --- backfill ------------------------------------------------------------------

test('backfill adds a row for a retired record without one, from the kept branch, and never duplicates', async () => {
  const rec = await lane('delta', { createdAt: 500 });
  // retired by an older laneboard: worktree removed, no row written
  gitIn(mainRepo, 'worktree', 'remove', '--force', rec.root);
  await store.write({ ...rec, retiredAt: 9000 });
  const before = db.listArchive({ limit: 200 }).length;
  const first = await archive.backfill();
  assert.ok(first.added.includes('delta'));
  assert.ok(!first.added.includes('alpha'), 'alpha already has its row');
  const row = db.getArchive('delta');
  assert.equal(row.retired_at, 9000);
  assert.equal(row.duration_ms, 8500);
  assert.equal(row.plan_head, PLAN, 'the plan survives on the local branch');
  assert.equal(row.stage_m, 2);
  const mid = db.listArchive({ limit: 200 }).length;
  assert.equal(mid, before + first.added.length);
  const second = await archive.backfill();
  assert.deepEqual(second.added, []);
  assert.equal(db.listArchive({ limit: 200 }).length, mid);
});

test('the route module start() runs the backfill once', async () => {
  const rec = await lane('eps');
  await store.write({ ...rec, retiredAt: 9100 });
  routesMod.default.start({ log: { warn() {} } });
  for (let i = 0; i < 50 && !db.getArchive('eps'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(db.getArchive('eps'));
});

// --- restore -------------------------------------------------------------------

test('restoreId is the first free <id>-r<N>', async () => {
  assert.equal(archive.restoreId('alpha'), 'alpha-r1');
  db.addArchive({ lane: 'alpha-r1', retired_at: 1 });
  await store.write({ id: 'alpha-r2', repo: 'example-repo', root: '/nonexistent', branch: 'b', retiredAt: null, createdAt: 1 });
  assert.equal(archive.restoreId('alpha'), 'alpha-r3');
  assert.equal(archive.restoreId('x'.repeat(39)), null, 'no id fits');
  fs.rmSync(store.laneDir('alpha-r2'), { recursive: true });
});

const restoreReq = (over = {}) => ({
  lane: 'alpha-r1', repo: 'example-repo', branch: 'feat/alpha', plan: 'docs/plans/alpha.md',
  permissionMode: 'auto', restoredFrom: 'alpha', dryRun: true, ...over,
});

test('a restore launches under a new id from a retired lane, restoredFrom carried', async () => {
  // free the slots the earlier tests' lanes hold (three lane slots in all)
  for (const id of ['beta', 'big']) await store.write({ ...store.read(id), retiredAt: Date.now() });
  const r = await L.launch(restoreReq());
  assert.equal(r.ok, true);
  assert.equal(r.plan.restoredFrom, 'alpha');
  assert.equal(r.plan.lane, 'alpha-r1');
  assert.equal(r.plan.branch, 'feat/alpha');
});

test('a restore is refused at validate: retired id reused, unknown source, missing branch', async () => {
  await assert.rejects(L.launch(restoreReq({ lane: 'alpha' })), (e) => e.status === 409);
  await assert.rejects(L.launch(restoreReq({ restoredFrom: 'nosuch-lane' })), (e) => e.status === 404 && /not a retired lane/.test(e.message));
  await assert.rejects(L.launch(restoreReq({ restoredFrom: 'gamma' })), (e) => e.status === 409 && /not a retired lane/.test(e.message), 'gamma is still active');
  await assert.rejects(L.launch(restoreReq({ restoredFrom: 'Bad Id' })), /invalid restoredFrom/);
  // the branch was deleted (merged and cleaned up): refused now, with the reason
  gitIn(mainRepo, 'branch', '-D', 'feat/delta');
  await assert.rejects(
    L.launch(restoreReq({ lane: 'delta-r1', branch: 'feat/delta', plan: 'docs/plans/delta.md', restoredFrom: 'delta' })),
    (e) => e.status === 409 && /branch feat\/delta exists neither locally nor as origin/.test(e.message),
  );
  assert.equal(await archive.branchExists('example-repo', 'feat/delta'), false);
  assert.equal(await archive.branchExists('example-repo', 'feat/alpha'), true);
  assert.equal(await archive.branchExists('example-repo', '--upload-pack=x'), false);
});

test('a launch without restoredFrom skips the branch pre-check (the fetch comes later)', async () => {
  const r = await L.launch({ lane: 'fresh', repo: 'example-repo', plan: 'docs/plans/fresh.md', permissionMode: 'auto', dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.plan.restoredFrom, undefined);
});

// --- routes ----------------------------------------------------------------------

function call(handler, { url = '/', params = {} } = {}) {
  return new Promise((resolve) => {
    const res = {};
    const h = routesMod.createHandlers({
      json: (_res, body, status = 200) => resolve({ status, body }),
      log: { error() {} },
    })[handler];
    Promise.resolve(h({ url, params }, res));
  });
}

test('GET /api/v1/archive lists rows and refuses bad params', async () => {
  const ok = await call('list', { url: '/api/v1/archive?q=widget&limit=5' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.rows.some((r) => r.lane === 'alpha'));
  assert.ok(ok.body.rows.every((r) => r.plan_head === undefined && r.markers === undefined));
  assert.equal((await call('list', { url: '/api/v1/archive?limit=-1' })).status, 400);
  assert.equal((await call('list', { url: '/api/v1/archive?before=x' })).status, 400);
  assert.equal((await call('list', { url: `/api/v1/archive?q=${'a'.repeat(201)}` })).status, 400);
});

test('GET /api/v1/archive/:lane returns the full row and the restore it would send', async () => {
  const r = await call('one', { params: { lane: 'alpha' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.plan_head, PLAN);
  assert.ok(Array.isArray(r.body.markers));
  assert.deepEqual(r.body.restore, {
    lane: 'alpha-r2', repo: 'example-repo', branch: 'feat/alpha', plan: 'docs/plans/alpha.md',
    model: 'opus', permissionMode: 'auto', restoredFrom: 'alpha', branchExists: true,
  });
  assert.equal((await call('one', { params: { lane: 'nosuch' } })).status, 404);
  assert.equal((await call('one', { params: { lane: '../x' } })).status, 400);
});

test('the module registers two GET reads and the archive capability', () => {
  const seen = [];
  routesMod.default.register({ route: (m, p) => seen.push(`${m} ${p}`), json: () => {}, log: {} });
  assert.deepEqual(seen, ['GET /api/v1/archive', 'GET /api/v1/archive/:lane']);
  assert.ok(routesMod.routes(routesMod.createHandlers()).every((r) => r.tier === 'read'));
});
