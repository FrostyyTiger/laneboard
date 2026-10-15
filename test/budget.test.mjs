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
  const env = { dir, config, db, sessions: live, records };
  budget.init({ config, db, state: { all: () => env.sessions }, laneRecords: () => env.records });
  return env;
}

const rec = (id, extra = {}) => ({ id, retiredAt: null, session: id, ...extra });

// --- limits and levels -----------------------------------------------------------------------------------

test('limitsFor: override > lane record budgetUsd > config.perLaneUsd; retired lanes are left out', () => {
  const config = makeConfig('/x', { perLaneUsd: 5, perBuilderUsd: 50 });
  const laneRecords = [rec('a', { budgetUsd: 10 }), rec('b'), rec('c', { budgetUsd: 7 }), rec('gone', { budgetUsd: 3, retiredAt: 9 })];
  const overrides = { lanes: { c: 2, orphan: 4, 'Bad Id': 9, d: -1 }, builder: 80 };
  const l = budget.limitsFor({ config, overrides, laneRecords });
  assert.equal(l.lanes.get('a'), 10, 'record beats config');
  assert.equal(l.lanes.get('b'), 5, 'config default');
  assert.equal(l.lanes.get('c'), 2, 'override beats record');
  assert.equal(l.lanes.get('orphan'), 4, 'an override for a lane with no record still counts');
  assert.equal(l.lanes.has('gone'), false);
  assert.equal(l.lanes.has('Bad Id'), false);
  assert.equal(l.lanes.has('d'), false, 'a non-positive override is ignored');
  assert.equal(l.builder, 80, 'builder override beats config');
  assert.equal(budget.limitsFor({ config, overrides: {}, laneRecords }).builder, 50);
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
  assert.equal(budget.isRemoteOnlyHold('a', { stateDir: env.dir }), true);
  assert.equal(budget.isRemoteOnlyHold('*', { stateDir: env.dir }), false);
  assert.throws(() => budget.isRemoteOnlyHold('a', {}), /stateDir/);

  // the predicate as a dispatcher would run it, for a resume-like action
  dispatchMod._reset();
  const ran = [];
  dispatchMod.registerAction('resume', {
    tier: 'click', target: 'session-or-all', runsAll: true,
    args: { override: { type: 'boolean' }, confirm: { type: 'string' } },
    remoteOnly: budget.remoteOnlyPredicate(env.config),
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
  // no state dir: fail closed
  const broken = budget.remoteOnlyPredicate({});
  assert.throws(() => broken({ target: 'a', args: {} }, {}), /stateDir/);
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
  assert.equal(budget.isRemoteOnlyHold('low-1', { stateDir: env.dir }), true);
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
  // the budget module reads it straight from the record
  assert.equal(budget.limitsFor({ config: makeConfig('/x'), overrides: null, laneRecords: [r] }).lanes.get('real'), 3);
  await new Promise((res) => setTimeout(res, 200)); // let the background job fail at git and log
});
