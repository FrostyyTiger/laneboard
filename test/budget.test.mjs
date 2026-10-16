// Budget caps, ceilings, the quota guard, set-budget, and the launch fields they read (fleet plan §8 2.5, C7).
//
// Hermetic: the state dir, ~/lanes, ~/code and `claude` are scratch stand-ins; db and state are fakes handed
// to budget.init(); the dispatcher is the real one with an in-memory audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-budget-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const claude = path.join(bin, 'claude');
fs.writeFileSync(claude, `#!/bin/sh\ncat <<'EOF'\n  --permission-mode <mode>  Permission mode\n     (choices: "acceptEdits", "auto", "default", "plan")\nEOF\n`, { mode: 0o755 });
process.env.LANEBOARD_CLAUDE_BIN = claude;
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_REPOS = 'example-repo';
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');
process.env.LANEBOARD_STATE_DIR = path.join(tmp, 'never-used-state');
process.env.TMUX_TMPDIR = path.join(tmp, 'tmux');
fs.mkdirSync(process.env.TMUX_TMPDIR);
fs.mkdirSync(path.join(tmp, 'code', 'example-repo', '.git'), { recursive: true });

const budget = await import('../server/control/budget.mjs');
const pause = await import('../server/control/pause.mjs');
const dispatchMod = await import('../server/fleet/dispatch.mjs');
const handlers = await import('../server/control/handlers.mjs');
const { windowStart } = await import('../server/util.mjs');

const SID1 = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID2 = '7f00aa11-2222-4333-8444-555566667777';
const SID3 = '9a9a9a9a-2222-4333-8444-555566667777';
const NOW = Date.parse('2026-09-05T05:00:00Z');

function stateDir() {
  return fs.mkdtempSync(path.join(tmp, 'state-'));
}

function makeConfig(dir, budgetPatch = {}) {
  return {
    stateDir: dir,
    timezone: 'Europe/Zurich',
    fleet: { id: 'builder-a' },
    budget: {
      window: 'tonight', perLaneUsd: null, perBuilderUsd: null, warnPct: 80, pausePct: 100,
      quota: { enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false },
      ...budgetPatch,
    },
  };
}

function fakeDb() {
  const kv = new Map();
  const db = {
    kv,
    events: [],
    rows: [],
    sample: null,
    kvRead: (k, fb = null) => (kv.has(k) ? structuredClone(kv.get(k)) : fb),
    kvWrite: (k, v) => kv.set(k, structuredClone(v)),
    costRowsForWindow: () => db.rows,
    lastRateLimitSample: () => db.sample,
    addEvent: (e) => db.events.push(e),
  };
  return db;
}

/** sessions: [{name, lane, sid, usd, statusline}] */
function setup({ budgetPatch = {}, sessions = [], records = [] } = {}) {
  const dir = stateDir();
  const config = makeConfig(dir, budgetPatch);
  const db = fakeDb();
  const live = sessions.map((s) => ({
    name: s.name, lane: s.lane ?? null, claude: s.sid ? { sessionId: s.sid } : null,
    cost: { usd: s.usd ?? 0, tokens: {} }, statuslineCostUsd: s.statusline ?? null,
  }));
  const env = { dir, config, db, sessions: live, records, clock: NOW };
  budget.init({ config, db, state: { all: () => env.sessions }, laneRecords: () => env.records, now: () => env.clock });
  return env;
}

const rec = (id, extra = {}) => ({ id, retiredAt: null, session: id, ...extra });

// --- limits and levels -----------------------------------------------------------------------------------

test('limitsFor: override > lane record budgetUsd > config.perLaneUsd; retired lanes are left out', () => {
  const config = makeConfig('/x', { perLaneUsd: 5, perBuilderUsd: 50 });
  const laneRecords = [rec('a', { budgetUsd: 10 }), rec('b'), rec('c', { budgetUsd: 7 }), rec('gone', { budgetUsd: 3, retiredAt: 9 })];
  const overrides = { lanes: { c: 2, orphan: 4, 'Bad Id': 9, d: -1 }, builder: 80 };
  const l = budget.limitsFor({ config, overrides, laneRecords });
  assert.equal(l.lanes.get('a'), 5, 'a local record cannot raise the config default (SR17 M2)');
  assert.equal(l.lanes.get('b'), 5, 'config default');
  assert.equal(l.lanes.get('c'), 2, 'override beats record');
  assert.equal(l.lanes.get('orphan'), 4, 'an override for a lane with no record still counts');
  assert.equal(l.lanes.has('gone'), false);
  assert.equal(l.lanes.has('Bad Id'), false);
  assert.equal(l.lanes.has('d'), false, 'a non-positive override is ignored');
  assert.equal(l.builder, 80, 'builder override beats config');
  assert.equal(budget.limitsFor({ config, overrides: {}, laneRecords }).builder, 50);
  const remote = budget.limitsFor({ config, overrides: {}, laneRecords: [rec('a', { budgetUsd: 10, budgetSource: 'remote' }), rec('l', { budgetUsd: 3 })] });
  assert.equal(remote.lanes.get('a'), 10, 'a remote launch may raise it');
  assert.equal(remote.lanes.get('l'), 3, 'a record may lower it');
  assert.equal(budget.limitsFor({ config: makeConfig('/x'), overrides: {}, laneRecords: [rec('a', { budgetUsd: 10 })] }).lanes.get('a'), 10, 'no default: the record is the cap');
  const none = budget.limitsFor({ config: makeConfig('/x'), overrides: null, laneRecords: [rec('a')] });
  assert.equal(none.lanes.size, 0);
  assert.equal(none.builder, null);
});

test('evaluate: 79% ok, 80% warn, 100% over; the builder row has key *', () => {
  const limits = { lanes: new Map([['a', 100], ['b', 100], ['c', 100]]), builder: 1000 };
  const rows = budget.evaluate({ spendByLane: new Map([['a', 79], ['b', 80], ['c', 100]]), builderUsd: 259, limits, warnPct: 80, pausePct: 100 });
  const by = Object.fromEntries(rows.map((r) => [`${r.scope}:${r.key}`, r]));
  assert.equal(by['lane:a'].level, 'ok');
  assert.equal(by['lane:b'].level, 'warn');
  assert.equal(by['lane:c'].level, 'over');
  assert.deepEqual(by['lane:c'], { scope: 'lane', key: 'c', usd: 100, limit: 100, pct: 100, level: 'over' });
  assert.equal(by['builder:*'].level, 'ok');
  assert.equal(by['builder:*'].pct, 25.9);
  // morning's lanes array works as input too; a lane without spend is at 0
  const rows2 = budget.evaluate({ spendByLane: [{ lane: 'a', usd: 50 }], limits: { lanes: new Map([['a', 100], ['z', 1]]), builder: null } });
  assert.equal(rows2.find((r) => r.key === 'a').pct, 50);
  assert.equal(rows2.find((r) => r.key === 'z').usd, 0);
  assert.equal(rows2.some((r) => r.scope === 'builder'), false);
});

test('ceilings: statusline total + what is left before the pause threshold, the smaller of lane and builder', () => {
  const limits = { lanes: new Map([['a', 10]]), builder: 100 };
  const evaluation = budget.evaluate({ spendByLane: new Map([['a', 6]]), builderUsd: 97, limits });
  const sessions = [
    { name: 'a', lane: 'a', claude: { sessionId: SID1 }, statuslineCostUsd: 4 },   // lane left 4, builder 3
    { name: 'x', lane: null, claude: { sessionId: SID2 }, statuslineCostUsd: 1.5 }, // builder only: 3
    { name: 'y', lane: null, claude: { sessionId: SID3 }, statuslineCostUsd: null }, // no statusline: none
    { name: 'z', lane: 'a', claude: null, statuslineCostUsd: 2 },                  // no session id: none
  ];
  const c = budget.ceilings({ sessions, evaluation, limits });
  assert.deepEqual([...c].sort(), [[SID1, 7], [SID2, 4.5]].sort());
  // lane only, at pausePct 90: 10*0.9 - 6 = 3
  const l2 = { lanes: new Map([['a', 10]]), builder: null };
  const e2 = budget.evaluate({ spendByLane: new Map([['a', 6]]), limits: l2, pausePct: 90 });
  assert.deepEqual([...budget.ceilings({ sessions, evaluation: e2, limits: l2, pausePct: 90 })], [[SID1, 7]]);
  // over: never negative, the ceiling is the current total (stop now)
  const e3 = budget.evaluate({ spendByLane: new Map([['a', 12]]), limits: l2 });
  assert.deepEqual([...budget.ceilings({ sessions, evaluation: e3, limits: l2 })], [[SID1, 4]]);
  // no cap: no ceiling
  assert.equal(budget.ceilings({ sessions, evaluation: [], limits: { lanes: new Map(), builder: null } }).size, 0);
});

// --- the tick ----------------------------------------------------------------------------------------------

test('a warn is raised once per window on the first crossing; the snapshot key carries the evaluation', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 8.5, statusline: 8.5 }], records: [rec('a', { budgetUsd: 10 })] });
  assert.deepEqual(budget.snapshotValue(), []);
  const r = await budget.tick(NOW);
  assert.equal(r.evaluation[0].level, 'warn');
  assert.deepEqual(budget.snapshotValue(), r.evaluation);
  await budget.tick(NOW + 30_000);
  env.sessions[0].cost.usd = 9;
  await budget.tick(NOW + 60_000);
  const warns = env.db.events.filter((e) => e.type === 'budget' && e.subtype === 'warn');
  assert.equal(warns.length, 1, 'first crossing only');
  assert.equal(warns[0].sessionName, 'a');
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null, 'a warn pauses nothing');
  // the ceiling for the gate: statusline 8.5 + (10 - 9) left
  assert.equal(fs.readFileSync(pause.ceilingPath(env.dir, SID1), 'utf8').trim(), '9.5');
  // a new window warns again
  const next = NOW + 26 * 3600 * 1000;
  assert.notEqual(windowStart('tonight', 'Europe/Zurich', next), windowStart('tonight', 'Europe/Zurich', NOW));
  await budget.tick(next);
  assert.equal(env.db.events.filter((e) => e.subtype === 'warn').length, 2);
});

test('over: every live session of the lane gets a kind:budget pause; nothing else is touched', async () => {
  const env = setup({
    sessions: [
      { name: 'a', lane: 'a', sid: SID1, usd: 6, statusline: 6 },
      { name: 'a-2', lane: 'a', sid: SID2, usd: 5, statusline: 5 },
      { name: 'b', lane: 'b', sid: SID3, usd: 1, statusline: 1 },
    ],
    records: [rec('a'), rec('b')],
    budgetPatch: { perLaneUsd: 10 },
  });
  const r = await budget.tick(NOW);
  assert.deepEqual(r.paused.sort(), ['a', 'a-2']);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  assert.equal(pause.kindOf('a-2', { stateDir: env.dir }), 'budget');
  assert.equal(pause.kindOf('b', { stateDir: env.dir }), null);
  assert.equal(pause.kindOf('ALL', { stateDir: env.dir }), null);
  const entry = pause.list({ stateDir: env.dir }).find((e) => e.scope === 'a');
  assert.equal(entry.by, 'budget');
  assert.match(entry.reason, /over budget: lane a spent \$11\.00 of \$10\.00/);
  assert.equal(env.db.events.filter((e) => e.subtype === 'over').length, 1);
  // a second tick does not rewrite or re-announce
  const r2 = await budget.tick(NOW + 30_000);
  assert.deepEqual(r2.paused, []);
  assert.equal(env.db.events.filter((e) => e.subtype === 'over').length, 1);
});

test('the builder cap pauses ALL', async () => {
  const env = setup({
    sessions: [{ name: 'x', sid: SID1, usd: 30, statusline: 30 }, { name: 'y', sid: SID2, usd: 25, statusline: 25 }],
    budgetPatch: { perBuilderUsd: 50 },
  });
  const r = await budget.tick(NOW);
  assert.equal(r.evaluation[0].scope, 'builder');
  assert.equal(r.evaluation[0].level, 'over');
  assert.equal(pause.kindOf('ALL', { stateDir: env.dir }), 'budget');
});

test('an operator resume cannot lift a budget pause; the hold is remote-only', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 20, statusline: 20 }], records: [rec('a', { budgetUsd: 10 })] });
  await budget.tick(NOW);
  // the CLI / operator path lifts only operator pauses
  const r = pause.resume('a', { kinds: ['operator'] }, { stateDir: env.dir });
  assert.deepEqual(r.removed, []);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  // an operator pause written over it does not downgrade it
  pause.pause('a', { kind: 'operator', by: 'builder-a' }, { stateDir: env.dir });
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  // SR17 L5: C7's own predicate is gone; C6's resumeRemoteOnly is the one
  assert.equal(budget.isRemoteOnlyHold, undefined);
  assert.equal(budget.remoteOnlyPredicate, undefined);
  assert.deepEqual(budget.REMOTE_ONLY_KINDS, handlers.REMOTE_ONLY_KINDS);
  const cdeps = { config: env.config };
  assert.equal(handlers.resumeRemoteOnly({ target: 'a', args: {} }, cdeps), true);
  assert.equal(handlers.resumeRemoteOnly({ target: '*', args: {} }, cdeps), false);

  // the predicate as a dispatcher would run it, for a resume-like action
  dispatchMod._reset();
  const ran = [];
  dispatchMod.registerAction('resume', {
    tier: 'click', target: 'session-or-all', runsAll: true,
    args: { override: { type: 'boolean' }, confirm: { type: 'string' } },
    remoteOnly: handlers.resumeRemoteOnly,
    run: ({ target }) => { ran.push(target); return { ok: true }; },
  });
  const state = { get: (n) => env.sessions.find((s) => s.name === n) ?? null };
  const go = (kind, args, target = 'a') => send('resume', target, args, { kind, user: kind === 'direct' ? 'user@example.invalid' : undefined }, { config: env.config, state });
  const local = await go('local', {});
  assert.equal(local.status, 403);
  assert.equal(local.code, 'remote-only');
  const localOverride = await go('local', { override: true });
  assert.equal(localOverride.status, 403, 'refused from local even with override');
  assert.deepEqual(ran, []);
  assert.equal((await go('direct', { override: true })).ok, true);
  assert.deepEqual(ran, ['a']);
  // a plain operator pause stays a local action
  pause.resume('a', {}, { stateDir: env.dir });
  pause.pause('a', { kind: 'operator', by: 'builder-a' }, { stateDir: env.dir });
  assert.equal((await go('local', {})).ok, true);
  dispatchMod._reset();
});

// --- set-budget --------------------------------------------------------------------------------------------

function auditStub() {
  const entries = [];
  return { entries, append: (e) => { entries.push(e); return { hash: crypto.randomBytes(8).toString('hex') }; } };
}

async function send(action, target, args, auth, deps) {
  const env = { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: 'builder-a', action, target, args };
  return dispatchMod.dispatch(env, { auth, deps, config: deps.config, audit: auditStub() });
}

test('set-budget: remote-only, ask tier, * needs confirm = builder id; a raise lifts the budget pause', async () => {
  const routes = (await import('../server/routes/budget.mjs'));
  dispatchMod._reset();
  routes.registerBudgetAction();
  routes.registerBudgetAction(); // idempotent
  assert.equal(dispatchMod.tiers()['set-budget'], 'ask');

  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 12, statusline: 12 }], records: [rec('a', { budgetUsd: 10 })] });
  await budget.tick(NOW);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  const deps = { config: env.config };
  const direct = { kind: 'direct', user: 'user@example.invalid' };

  const local = await send('set-budget', 'a', { usd: 50 }, { kind: 'local' }, deps);
  assert.equal(local.status, 403);
  assert.equal(local.code, 'remote-only');
  assert.equal(env.db.kv.has(budget.OVERRIDES_KEY), false, 'nothing persisted');

  const badUsd = await send('set-budget', 'a', { usd: 0 }, direct, deps);
  assert.equal(badUsd.status, 400);
  assert.equal((await send('set-budget', 'a', { usd: 5, window: 'forever' }, direct, deps)).status, 400);
  assert.equal((await send('set-budget', 'a', {}, direct, deps)).status, 400, 'usd is required');
  assert.equal((await send('set-budget', '*', { usd: 5 }, direct, deps)).code, 'confirm_required');
  assert.equal((await send('set-budget', '*', { usd: 5, confirm: 'fleet' }, direct, deps)).code, 'confirm_required');

  const raised = await send('set-budget', 'a', { usd: 50 }, direct, deps);
  assert.equal(raised.ok, true, JSON.stringify(raised));
  assert.deepEqual(raised.result.lifted, ['a']);
  assert.equal(raised.result.budget.level, 'ok');
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null, 'the budget pause is gone');
  assert.deepEqual(env.db.kv.get(budget.OVERRIDES_KEY), { lanes: { a: 50 }, builder: null, window: null });
  assert.equal(fs.readFileSync(pause.ceilingPath(env.dir, SID1), 'utf8').trim(), '50', 'ceiling rewritten: 12 + 38');

  // lowering it pauses again at once
  const lowered = await send('set-budget', 'a', { usd: 5 }, direct, deps);
  assert.deepEqual(lowered.result.paused, ['a']);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  // null drops the override: back to the record's 10, still over
  const reset = await send('set-budget', 'a', { usd: null }, direct, deps);
  assert.equal(reset.result.budget.limit, 10);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');

  // builder scope + window
  const all = await send('set-budget', '*', { usd: 100, window: '24h', confirm: 'builder-a' }, direct, deps);
  assert.equal(all.ok, true, JSON.stringify(all));
  assert.equal(all.result.window, '24h');
  assert.equal(all.result.budget.scope, 'builder');
  assert.equal(env.db.kv.get(budget.OVERRIDES_KEY).builder, 100);
  // a budget pause on a session no cap holds any more is lifted by set-budget too
  env.records = [rec('a')];
  const freed = await send('set-budget', 'a', { usd: null }, direct, deps);
  assert.deepEqual(freed.result.lifted, ['a']);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null);
  dispatchMod._reset();
});

test('an operator pause is never lifted by set-budget', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 1, statusline: 1 }], records: [rec('a', { budgetUsd: 10 })] });
  pause.pause('a', { kind: 'operator', by: 'builder-a' }, { stateDir: env.dir });
  const r = await budget.setBudget({ target: 'a', usd: 100 }, { now: NOW });
  assert.deepEqual(r.lifted, []);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'operator');
  await assert.rejects(budget.setBudget({ target: '../x', usd: 1 }), /invalid target/);
  await assert.rejects(budget.setBudget({ target: 'a', usd: Infinity }), /usd/);
});

test('without config.stateDir the tick refuses instead of using a default directory', async () => {
  const db = fakeDb();
  budget.init({ config: { budget: { perLaneUsd: 1 } }, db, state: { all: () => [] }, laneRecords: () => [] });
  await assert.rejects(budget.tick(NOW), /stateDir/);
  assert.equal(fs.existsSync(process.env.LANEBOARD_STATE_DIR), false, 'the env/default state dir was never written');
});

// --- SR17 regressions -----------------------------------------------------------------------------------------

test('SR17 M3: a recorded session is charged, paused and ceilinged under its lane whatever its cwd says', async () => {
  // x's agent did `cd` into y's worktree (s.lane 'y'); z's agent left every lane (s.lane null)
  const env = setup({
    budgetPatch: { perLaneUsd: 10 },
    sessions: [
      { name: 'x', lane: 'y', sid: SID1, usd: 12, statusline: 12 },
      { name: 'y', lane: 'y', sid: SID2, usd: 1, statusline: 1 },
      { name: 'z', lane: null, sid: SID3, usd: 11, statusline: 11 },
    ],
    records: [rec('x'), rec('y'), rec('z')],
  });
  // a cost row written after the cd carries the cwd lane: the binding still wins
  env.db.rows = [{ session_name: 'x', ts: NOW - 60_000, usd: 12, tokens: {}, lane: 'y' }];
  const r = await budget.tick(NOW);
  const row = (k) => r.evaluation.find((e) => e.key === k);
  assert.equal(row('x').usd, 12, 'x keeps its spend');
  assert.equal(row('y').usd, 1, 'y is not charged for x');
  assert.equal(row('z').usd, 11);
  assert.equal(pause.kindOf('x', { stateDir: env.dir }), 'budget');
  assert.equal(pause.kindOf('z', { stateDir: env.dir }), 'budget');
  assert.equal(pause.kindOf('y', { stateDir: env.dir }), null, 'the wrong lane is not paused');
  assert.ok(fs.existsSync(pause.ceilingPath(env.dir, SID1)), 'x keeps its ceiling');
  assert.ok(fs.existsSync(pause.ceilingPath(env.dir, SID3)), 'z keeps its ceiling');
  assert.equal(fs.readFileSync(pause.ceilingPath(env.dir, SID2), 'utf8').trim(), '10');
  // the resolver: recorded binding first, cwd only for unrecorded sessions
  const laneOf = budget.laneOfFor([rec('x'), rec('old', { retiredAt: 1 })]);
  assert.equal(laneOf({ name: 'x', lane: 'y' }), 'x');
  assert.equal(laneOf({ name: 'adhoc', lane: 'y' }), 'y');
  assert.equal(laneOf({ name: 'old', lane: null }), null, 'a retired record binds nothing');
});

test('SR17 M3: the quota guard pauses a low lane by its record, not by its cwd', async () => {
  const env = setup({
    budgetPatch: { quota: { enabled: true, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false } },
    sessions: [{ name: 'low-1', lane: 'norm', sid: SID1 }, { name: 'norm', lane: 'low-1', sid: SID2 }],
    records: [rec('low-1', { priority: 'low' }), rec('norm', { priority: 'normal' })],
  });
  env.db.sample = { ts: NOW, five_hour_pct: 95 };
  const r = await budget.tick(NOW);
  assert.deepEqual(r.quota.paused, ['low-1']);
  assert.equal(pause.kindOf('norm', { stateDir: env.dir }), null);
});

/** C6's real remote-only resume path, as a `direct` user (budget.init's db receives the override mark). */
function remoteResume(env, target, args = { override: true }, kind = 'direct') {
  return handlers.runResume({ target, args: { nudge: false, ...args }, user: 'user@example.invalid', kind, deps: { config: env.config, state: { all: () => env.sessions, get: () => null } } });
}

test('SR17 L1: a remote override resume of a budget pause is not re-applied by the next tick', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 20, statusline: 20 }, { name: 'b', lane: 'b', sid: SID2, usd: 20, statusline: 20 }], records: [rec('a', { budgetUsd: 10 }), rec('b', { budgetUsd: 10 })] });
  await budget.tick(NOW);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  const out = await remoteResume(env, 'a');
  assert.equal(out.overrideNoted, true);
  assert.equal(env.db.kv.get(budget.OVERRIDE_BY_KEY).scopes.a.by, 'user@example.invalid');
  const r = await budget.tick(NOW + 30_000);
  assert.deepEqual(r.paused, []);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null, 'not re-paused');
  assert.equal(fs.existsSync(pause.ceilingPath(env.dir, SID1)), false, 'and its lane ceiling is not re-armed');
  assert.equal(pause.kindOf('b', { stateDir: env.dir }), 'budget', 'other sessions keep theirs');
  await budget.tick(NOW + 60_000);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null, 'stays lifted for the window');
  // a new set-budget decision on that lane forgets the override: lowering it pauses again
  const lowered = await budget.setBudget({ target: 'a', usd: 5 }, { now: NOW + 90_000 });
  assert.deepEqual(lowered.paused, ['a']);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
});

test('SR17 R1: a hand-removed budget sentinel is re-paused at the next tick and its ceiling kept', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 20, statusline: 20 }], records: [rec('a', { budgetUsd: 10 })] });
  const audit = auditStub();
  budget.init({ config: env.config, db: env.db, state: { all: () => env.sessions }, laneRecords: () => env.records, audit, now: () => env.clock });
  await budget.tick(NOW);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  assert.equal(fs.existsSync(pause.ceilingPath(env.dir, SID1)), true);
  // `rm paused/a`: no override mark
  fs.rmSync(pause.pausePath(env.dir, 'a'));
  const r = await budget.tick(NOW + 30_000);
  assert.deepEqual(r.paused, ['a']);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget', 're-paused');
  assert.equal(fs.existsSync(pause.ceilingPath(env.dir, SID1)), true, 'ceiling kept');
  assert.ok(audit.entries.some((e) => e.action === 'budget-sentinel-missing' && e.target === 'a'));
  // legacy `override:` keys in budget.marks grant nothing
  const marks = env.db.kv.get(budget.MARKS_KEY);
  env.db.kv.set(budget.MARKS_KEY, { ...marks, keys: [...marks.keys, 'override:a'] });
  fs.rmSync(pause.pausePath(env.dir, 'a'));
  await budget.tick(NOW + 60_000);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
  assert.equal(fs.existsSync(pause.ceilingPath(env.dir, SID1)), true);
  // local resume with override cannot write a mark (refused, sentinel kept)
  await assert.rejects(remoteResume(env, 'a', { override: true }, 'local'), (e) => e.status === 409);
  assert.equal(env.db.kv.get(budget.OVERRIDE_BY_KEY), undefined);
});

test('SR17 R1: rm of the builder ALL sentinel re-pauses ALL and keeps the builder ceiling for every session', async () => {
  const env = setup({
    budgetPatch: { perBuilderUsd: 30 },
    sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 20, statusline: 20 }, { name: 'b', lane: 'b', sid: SID2, usd: 20, statusline: 20 }],
    records: [rec('a'), rec('b')],
  });
  await budget.tick(NOW);
  assert.equal(pause.kindOf('ALL', { stateDir: env.dir }), 'budget');
  fs.rmSync(pause.pausePath(env.dir, 'ALL'));
  const r = await budget.tick(NOW + 30_000);
  assert.deepEqual(r.paused, ['ALL']);
  assert.equal(pause.kindOf('ALL', { stateDir: env.dir }), 'budget');
  for (const sid of [SID1, SID2]) assert.equal(fs.existsSync(pause.ceilingPath(env.dir, sid)), true, 'builder ceiling kept');
  // the remote override of ALL lifts it (and the builder ceiling) for the window
  await remoteResume(env, '*');
  await budget.tick(NOW + 60_000);
  assert.equal(pause.kindOf('ALL', { stateDir: env.dir }), null);
  for (const sid of [SID1, SID2]) assert.equal(fs.existsSync(pause.ceilingPath(env.dir, sid)), false);
});

test('SR17 R1: an override mark expires at the end of its window', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 20, statusline: 20 }], records: [rec('a', { budgetUsd: 10 })] });
  await budget.tick(NOW);
  await remoteResume(env, 'a');
  await budget.tick(NOW + 30_000);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), null);
  // the next window: spend rows are per window, the live cost still counts; the old mark is void
  const later = NOW + 26 * 3600_000;
  assert.notEqual(windowStart('tonight', 'Europe/Zurich', later), windowStart('tonight', 'Europe/Zurich', NOW));
  await budget.tick(later);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget', 're-paused in the new window');
});

test('SR17 L2: a budget pause keeps the operator pause it upgrades and restores it when lifted', async () => {
  const env = setup({ sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 12, statusline: 12 }], records: [rec('a', { budgetUsd: 10 })] });
  pause.pause('a', { kind: 'operator', by: 'user@example.invalid', reason: 'hold for review' }, { stateDir: env.dir, now: NOW - 5000 });
  await budget.tick(NOW);
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget', 'most restrictive while over');
  assert.equal(env.db.kv.get(budget.UNDER_KEY).a.reason, 'hold for review');
  const r = await budget.setBudget({ target: 'a', usd: 50 }, { now: NOW + 1000 });
  assert.deepEqual(r.lifted, ['a']);
  const e = pause.list({ stateDir: env.dir }).find((x) => x.scope === 'a');
  assert.equal(e.kind, 'operator', 'the operator pause is back, not erased');
  assert.equal(e.by, 'user@example.invalid');
  assert.equal(e.reason, 'hold for review');
  assert.equal(e.at, NOW - 5000);
  assert.deepEqual(env.db.kv.get(budget.UNDER_KEY), {});
});

test('SR17 L3: set-budget with a window is refused for a lane target', async () => {
  const env = setup({ sessions: [], records: [rec('a')] });
  await assert.rejects(budget.setBudget({ target: 'a', usd: 5, window: '12h' }), /window applies to every cap/);
  assert.equal(env.db.kv.has(budget.OVERRIDES_KEY), false);
  const ok = await budget.setBudget({ target: '*', usd: 5, window: '12h' }, { now: NOW });
  assert.equal(ok.window, '12h');
});

test('SR17 L4: two sessions claiming one Claude session id get the smaller ceiling', () => {
  const limits = { lanes: new Map([['a', 10]]), builder: null };
  const evaluation = budget.evaluate({ spendByLane: new Map([['a', 2]]), limits });
  const sessions = [
    { name: 'a', lane: 'a', claude: { sessionId: SID1 }, statuslineCostUsd: 2 },
    { name: 'free', lane: null, claude: { sessionId: SID1 }, statuslineCostUsd: 1 },
  ];
  assert.deepEqual([...budget.ceilings({ sessions, evaluation, limits })], [[SID1, 10]], 'the uncapped twin does not drop it');
  const both = [...sessions, { name: 'a2', lane: 'a', claude: { sessionId: SID1 }, statuslineCostUsd: 0 }];
  assert.deepEqual([...budget.ceilings({ sessions: both, evaluation, limits })], [[SID1, 8]], 'the smaller wins, whatever the order');
  assert.deepEqual([...budget.ceilings({ sessions: [...both].reverse(), evaluation, limits })], [[SID1, 8]]);
});

test('SR17 L6: automatic budget and quota pauses and lifts are appended to the fleet audit', async () => {
  const a = auditStub();
  const env = setup({
    budgetPatch: { quota: { enabled: true, fiveHourPct: 90, resumeBelowPct: 70, autoResume: true } },
    sessions: [{ name: 'a', lane: 'a', sid: SID1, usd: 12, statusline: 12 }, { name: 'low-1', lane: 'low-1', sid: SID2 }],
    records: [rec('a', { budgetUsd: 10 }), rec('low-1', { priority: 'low' })],
  });
  budget.init({ config: env.config, db: env.db, state: { all: () => env.sessions }, laneRecords: () => env.records, audit: () => a });
  env.db.sample = { ts: NOW, five_hour_pct: 95 };
  await budget.tick(NOW);
  env.db.sample = { ts: NOW + 1000, five_hour_pct: 10 };
  await budget.setBudget({ target: 'a', usd: 50 }, { now: NOW + 1000 });
  const seen = a.entries.map((e) => [e.action, e.target, e.user, e.result.by]);
  assert.deepEqual(seen, [
    ['budget-pause', 'a', 'budget', 'budget'],
    ['quota-pause', 'low-1', 'budget', 'budget'],
    ['budget-lift', 'a', 'budget', 'budget'],
    ['quota-resume', 'low-1', 'budget', 'budget'],
  ]);
  // a broken audit never breaks the tick
  budget.init({ config: env.config, db: env.db, state: { all: () => env.sessions }, laneRecords: () => env.records, audit: { append() { throw new Error('locked'); } }, log: { warn() {} } });
  await budget.setBudget({ target: 'a', usd: 5 }, { now: NOW + 2000 });
  assert.equal(pause.kindOf('a', { stateDir: env.dir }), 'budget');
});

test('SR17 M2 + L7: the v1 launch schema refuses budgetUsd <= 0 and hands the caller kind to the launcher', async () => {
  const builtins = await import('../server/fleet/builtin-actions.mjs');
  dispatchMod._reset();
  builtins._resetBuiltins();
  const calls = [];
  const config = { mode: 'builder', fleet: { id: 'builder-a', hubControl: false, allowedPermissionModes: ['default', 'acceptEdits', 'plan', 'auto'] }, repoNames: ['acme'] };
  const deps = { config, launcher: { launch: async (req, who, opts) => { calls.push(opts); return { ok: true, job: 'j', lane: req.lane }; } } };
  builtins.registerBuiltins(deps);
  const args = (budgetUsd) => ({ repo: 'acme', plan: 'docs/plans/l1.md', budgetUsd });
  for (const usd of [0, -0, -1]) {
    const r = await send('launch', 'l1', args(usd), { kind: 'local' }, deps);
    assert.equal(r.status, 400, `budgetUsd ${usd}`);
  }
  assert.deepEqual(calls, []);
  assert.equal((await send('launch', 'l1', args(5), { kind: 'local' }, deps)).ok, true);
  assert.equal((await send('launch', 'l1', args(5), { kind: 'direct', user: 'user@example.invalid' }, deps)).ok, true);
  assert.deepEqual(calls, [{ callerKind: 'local' }, { callerKind: 'direct' }]);
  dispatchMod._reset();
  builtins._resetBuiltins();
});

// --- quota guard ---------------------------------------------------------------------------------------------

test('quotaPct: a stale sample is ignored, a reset window counts as 0', () => {
  assert.equal(budget.quotaPct(null, NOW), null);
  assert.equal(budget.quotaPct({ ts: NOW - 60_000, five_hour_pct: 95 }, NOW), 95);
  assert.equal(budget.quotaPct({ ts: NOW - 2 * 3600_000, five_hour_pct: 95 }, NOW), null);
  assert.equal(budget.quotaPct({ ts: NOW - 60_000, five_hour_pct: 95, five_hour_resets_at: NOW - 1 }, NOW), 0);
  assert.equal(budget.quotaPct({ ts: NOW - 60_000, five_hour_pct: null }, NOW), null);
});

test('the quota guard pauses only priority:low lanes and auto-resumes only kind:quota', async () => {
  const quota = { enabled: true, fiveHourPct: 90, resumeBelowPct: 70, autoResume: true };
  const env = setup({
    budgetPatch: { quota },
    sessions: [
      { name: 'low-1', lane: 'low-1', sid: SID1 },
      { name: 'low-2', lane: 'low-2', sid: SID2 },
      { name: 'norm', lane: 'norm', sid: SID3 },
      { name: 'adhoc' },
    ],
    records: [rec('low-1', { priority: 'low' }), rec('low-2', { priority: 'low' }), rec('norm', { priority: 'normal' })],
  });
  // low-2 is already held by an operator: it stays an operator pause
  pause.pause('low-2', { kind: 'operator', by: 'builder-a' }, { stateDir: env.dir });
  env.db.sample = { ts: NOW, five_hour_pct: 95 };
  const r = await budget.tick(NOW);
  assert.deepEqual(r.quota.paused, ['low-1']);
  assert.equal(pause.kindOf('low-1', { stateDir: env.dir }), 'quota');
  assert.equal(pause.kindOf('low-2', { stateDir: env.dir }), 'operator');
  assert.equal(pause.kindOf('norm', { stateDir: env.dir }), null);
  assert.equal(pause.kindOf('adhoc', { stateDir: env.dir }), null);
  assert.equal(handlers.resumeRemoteOnly({ target: 'low-1', args: {} }, { config: env.config }), true);
  // between the thresholds: nothing changes
  env.db.sample = { ts: NOW + 30_000, five_hour_pct: 80 };
  const mid = await budget.tick(NOW + 30_000);
  assert.deepEqual(mid.quota, { pct: 80, paused: [], lifted: [] });
  // a budget pause on another session is not a quota pause
  pause.pause('norm', { kind: 'budget', by: 'budget' }, { stateDir: env.dir });
  env.db.sample = { ts: NOW + 60_000, five_hour_pct: 50 };
  const low = await budget.tick(NOW + 60_000);
  assert.deepEqual(low.quota.lifted, ['low-1']);
  assert.equal(pause.kindOf('low-1', { stateDir: env.dir }), null);
  assert.equal(pause.kindOf('low-2', { stateDir: env.dir }), 'operator');
  assert.equal(pause.kindOf('norm', { stateDir: env.dir }), 'budget');
});

test('without autoResume the quota guard leaves its pauses and raises one event', async () => {
  const env = setup({
    budgetPatch: { quota: { enabled: true, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false } },
    sessions: [{ name: 'low-1', lane: 'low-1', sid: SID1 }],
    records: [rec('low-1', { priority: 'low' })],
  });
  env.db.sample = { ts: NOW, five_hour_pct: 99 };
  await budget.tick(NOW);
  env.db.sample = { ts: NOW + 1000, five_hour_pct: 10 };
  await budget.tick(NOW + 1000);
  await budget.tick(NOW + 2000);
  assert.equal(pause.kindOf('low-1', { stateDir: env.dir }), 'quota');
  assert.equal(env.db.events.filter((e) => e.subtype === 'quota-resumable').length, 1);
});

test('the quota guard is off by default', async () => {
  const env = setup({ sessions: [{ name: 'low-1', lane: 'low-1', sid: SID1 }], records: [rec('low-1', { priority: 'low' })] });
  env.db.sample = { ts: NOW, five_hour_pct: 100 };
  const r = await budget.tick(NOW);
  assert.equal(r.quota, null);
  assert.equal(pause.kindOf('low-1', { stateDir: env.dir }), null);
  assert.equal(fs.existsSync(path.join(env.dir, 'paused')), false);
  assert.equal(fs.existsSync(path.join(env.dir, 'ceiling')), false, 'no caps: no ceiling dir (the gate keeps its fast path)');
});

// --- the route module --------------------------------------------------------------------------------------------

test('the route module publishes snapshot key budget, the capability, and set-budget', async () => {
  const routes = (await import('../server/routes/budget.mjs')).default;
  const apiV1 = await import('../server/fleet/api-v1.mjs');
  dispatchMod._reset();
  const keys = new Map();
  const dir = stateDir();
  const ctx = {
    config: makeConfig(dir), db: fakeDb(), log: { warn() {} },
    state: { all: () => [], addSnapshotKey: (n, fn) => keys.set(n, fn) },
  };
  routes.register(ctx);
  assert.equal(typeof keys.get('budget'), 'function');
  assert.deepEqual(keys.get('budget')(), []);
  assert.equal(dispatchMod.has('set-budget'), true);
  assert.ok(apiV1.capabilityList().includes('budget'));
  routes.start(ctx);
  routes.stop();
  dispatchMod._reset();
});

// --- launch fields ---------------------------------------------------------------------------------------------

const providers = await import('../server/providers/index.mjs');
providers._set('slots', {
  name: 'fake', available: true, slotCount: 5,
  existing: async () => [1],
  up: async () => ({ ok: true }),
  env: async () => ({ ok: false, error: 'not in this test' }),
});
const L = await import('../server/lanes/launch.mjs');
const store = await import('../server/lanes/store.mjs');
L.init({ state: { get: () => null, tick: async () => {} } });

test('launch: a missing permission mode is refused (no fallback)', async () => {
  await assert.rejects(L.validate({ lane: 'nomode', plan: 'docs/plans/nomode.md' }), /permissionMode is required/);
  await assert.rejects(L.launch({ lane: 'nomode', plan: 'docs/plans/nomode.md' }), /permissionMode is required/);
  assert.equal(fs.existsSync(path.join(tmp, 'lanes', 'nomode')), false);
  // the legacy route fills in the mode it always used, explicitly
  assert.deepEqual(L.legacyRequest({ lane: 'x' }), { lane: 'x', permissionMode: 'auto' });
  assert.deepEqual(L.legacyRequest({ lane: 'x', permissionMode: 'plan' }), { lane: 'x', permissionMode: 'plan' });
  assert.deepEqual(L.legacyRequest(null), { permissionMode: 'auto' });
});

test('launch: priority and budgetUsd are validated and default to normal / null', async () => {
  const base = { lane: 'pri', plan: 'docs/plans/pri.md', permissionMode: 'auto' };
  const v = await L.validate(base);
  assert.equal(v.priority, 'normal');
  assert.equal(v.budgetUsd, null);
  const v2 = await L.validate({ ...base, priority: 'low', budgetUsd: 12.5 });
  assert.equal(v2.priority, 'low');
  assert.equal(v2.budgetUsd, 12.5);
  for (const priority of ['urgent', 3, '']) await assert.rejects(L.validate({ ...base, priority }), /invalid priority/);
  for (const budgetUsd of [0, -1, '5', Infinity, 1e9]) await assert.rejects(L.validate({ ...base, budgetUsd }), /invalid budgetUsd/);
});

test('launch: a dry run returns the plan and writes no record; a real one records priority and budgetUsd', async () => {
  const dry = await L.launch({ lane: 'dry', plan: 'docs/plans/dry.md', permissionMode: 'auto', priority: 'high', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.plan.priority, 'high');
  assert.equal(dry.plan.permissionMode, 'auto');
  assert.equal(dry.job, undefined);
  store._resetCache();
  assert.equal(store.read('dry'), null);
  assert.equal(fs.existsSync(path.join(tmp, 'lanes', 'dry')), false);

  const real = await L.launch({ lane: 'real', plan: 'docs/plans/real.md', permissionMode: 'auto', priority: 'low', budgetUsd: 3, localBranch: true });
  assert.equal(real.ok, true);
  store._resetCache();
  const r = store.read('real');
  assert.equal(r.priority, 'low');
  assert.equal(r.budgetUsd, 3);
  assert.equal(r.budgetSource, 'local', 'the record says who set the cap (SR17 M2)');
  // the budget module reads it straight from the record
  assert.equal(budget.limitsFor({ config: makeConfig('/x'), overrides: null, laneRecords: [r] }).lanes.get('real'), 3);
  await new Promise((res) => setTimeout(res, 200)); // let the background job fail at git and log
});

test('SR17 M2: a local launch cannot raise its cap above budget.perLaneUsd; a remote one can, and says so', async () => {
  const { config } = await import('../server/config.mjs');
  const saved = config.budget;
  config.budget = { ...(saved ?? {}), perLaneUsd: 20 };
  try {
    const base = { lane: 'cap', plan: 'docs/plans/cap.md', permissionMode: 'auto' };
    for (const callerKind of [undefined, 'local', 'legacy', 'bogus']) {
      await assert.rejects(L.validate({ ...base, budgetUsd: 100000 }, callerKind ? { callerKind } : undefined), (err) => {
        assert.match(err.message, /only a remote caller may raise a cap/);
        assert.equal(err.status, 403);
        return true;
      });
    }
    await assert.rejects(L.launch({ ...base, budgetUsd: 21 }), /only a remote caller/, 'launch() defaults to local');
    await assert.rejects(L.launch({ ...base, budgetUsd: 21, dryRun: true }, 'x', { callerKind: 'local' }), /only a remote caller/);
    assert.equal((await L.validate({ ...base, budgetUsd: 20 })).budgetSource, 'local', 'equal is fine');
    assert.equal((await L.validate({ ...base, budgetUsd: 5 })).budgetSource, 'local', 'lowering is fine');
    assert.equal((await L.validate(base)).budgetSource, null);
    for (const callerKind of ['direct', 'hub']) {
      const v = await L.validate({ ...base, budgetUsd: 100 }, { callerKind });
      assert.equal(v.budgetUsd, 100);
      assert.equal(v.budgetSource, 'remote');
    }
    // and on read, a local record above the default is clamped to it
    const lim = budget.limitsFor({ config: makeConfig('/x', { perLaneUsd: 20 }), overrides: null, laneRecords: [rec('cap', { budgetUsd: 100000, budgetSource: 'local' })] });
    assert.equal(lim.lanes.get('cap'), 20);
  } finally {
    config.budget = saved;
  }
});
