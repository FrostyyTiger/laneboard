// Kill switches (fleet C9): the builder `kill *` handler through the real dispatcher with stubbed tmux actions
// and a fake clock, and the hub's fleet kill with undo through the real relay with a fake fetch. Nothing here
// touches tmux: actions.sendKeys / actions.kill are stubs. State dir and audit log live in a tmp dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const { dispatch, _reset } = await import('../server/fleet/dispatch.mjs');
const { registerBuiltins, _resetBuiltins } = await import('../server/fleet/builtin-actions.mjs');
const { openAudit } = await import('../server/fleet/audit.mjs');
const { createLimiter } = await import('../server/fleet/ratelimit.mjs');
const ks = await import('../server/control/killswitch.mjs');
const pause = await import('../server/control/pause.mjs');
const ksRoute = (await import('../server/routes/killswitch.mjs')).default;
const { createRelay, _resetHubActions } = await import('../server/hub/relay.mjs');
const { createFleetKill, UNDO_MS, RESUME_RETRY_MS } = await import('../server/hub/fleetkill.mjs');
const { createModule: createFleetKillModule, registerFanoutKill } = await import('../server/hub/routes/fleetkill.mjs');

const BID = 'builder-a';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-killswitch-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const LOCAL = { kind: 'local', user: 'local' };
const DIRECT = { kind: 'direct', user: 'alice@example.invalid' };
const HUB = { kind: 'hub', scopes: new Set(['control']), keyLabel: 'hub-main', verified: true };

/** A fake clock: setTimeout callbacks run only on advance(). */
function fakeClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      t += ms;
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t) { timers.delete(id); await x.fn(); }
      }
      await new Promise((r) => setImmediate(r));
    },
  };
}

const SESSIONS = () => [
  { name: 'lane-a', paneId: '%1', lane: 'a' },
  { name: 'lane-b', paneId: '%2', lane: 'b' },
  { name: 'scratch', paneId: '%3', lane: null },
  { name: 'notes', paneId: '%4', lane: null },
  { name: '_laneboard-term', paneId: '%5', lane: 'x' },
  { name: '_laneboard', paneId: '%6', lane: null },
  { name: 'board', paneId: '%7', lane: 'own' },
];

let n = 0;
function setup({ sessions = SESSIONS(), hubControl = true, failKill = null } = {}) {
  _reset();
  _resetBuiltins();
  ks._resetKillSwitch();
  const stateDir = fs.mkdtempSync(path.join(tmp, 'state-'));
  const calls = [];
  let inv = sessions;
  const clock = fakeClock();
  const config = { mode: 'builder', stateDir, fleet: { id: BID, hubControl }, ownSessionPrefixes: ['_laneboard-test', '_laneboard'] };
  const actions = {
    async sendKeys(name, keys, who) { calls.push(['sendKeys', name, keys, who]); return { ok: true }; },
    async kill(name, who) {
      calls.push(['kill', name, who]);
      if (name === failKill) throw new Error('kill-session failed: no server\u001b[0m');
      return { ok: true, name };
    },
  };
  const steps = [];
  const deps = {
    config,
    actions,
    state: { get: (x) => inv.find((s) => s.name === x) ?? null, all: () => inv },
    db: { addJobStep: (s) => { steps.push(s); return steps.length; } },
    timers: clock,
    ownPane: '%7',
  };
  registerBuiltins(deps);
  ks.registerKillSwitch(deps);
  const audit = openAudit({ file: path.join(tmp, `audit-${++n}.jsonl`), builder: BID });
  const limiter = createLimiter();
  const go = (target, args = {}, auth = DIRECT) => dispatch(
    { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: BID, action: 'kill', target, args, user: 'ops@example.invalid', via: 'hub' },
    { auth, deps, audit, limiter },
  );
  return { calls, steps, clock, go, stateDir, setInventory: (x) => { inv = x; }, audit };
}

// --- selectVictims ----------------------------------------------------------------------------------------

test('selectVictims: lane sessions plus explicit include only, never _laneboard*', () => {
  const s = SESSIONS();
  assert.deepEqual(ks.selectVictims(s), ['board', 'lane-a', 'lane-b']);
  assert.deepEqual(ks.selectVictims(s, ['scratch']), ['board', 'lane-a', 'lane-b', 'scratch']);
  // include cannot reach a protected session or a session that does not exist
  assert.deepEqual(ks.selectVictims(s, ['_laneboard', '_laneboard-term', 'ghost']), ['board', 'lane-a', 'lane-b']);
  // the session laneboard runs in, and extra protected names/prefixes
  assert.deepEqual(ks.selectVictims(s, ['notes'], { ownPane: '%7' }), ['lane-a', 'lane-b', 'notes']);
  assert.deepEqual(ks.selectVictims(s, [], { protect: ['lane-a'], prefixes: ['lane-b'] }), ['board']);
  // garbage in, nothing out
  assert.deepEqual(ks.selectVictims(null, null), []);
  assert.deepEqual(ks.selectVictims([null, { lane: 'a' }, { name: 5, lane: 'a' }], ['x']), []);
});

// --- builder kill * ---------------------------------------------------------------------------------------

test('kill * from local is refused 403 remote-only; nothing paused, nothing killed', async () => {
  const { go, calls, stateDir } = setup();
  const r = await go('*', { confirm: BID, graceMs: 0 }, LOCAL);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'remote-only');
  assert.deepEqual(calls, []);
  assert.equal(pause.kindOf('ALL', { stateDir }), null);
});

test("kill * with confirm 'fleet' or a wrong id is refused 400 on the builder", async () => {
  const { go, calls } = setup();
  for (const confirm of ['fleet', 'builder-b', '']) {
    const r = await go('*', { confirm, graceMs: 0 }, DIRECT);
    assert.equal(r.status, 400, confirm);
    assert.equal(r.code, 'confirm_required');
  }
  assert.deepEqual(calls, []);
  // the handler repeats the rules when called directly
  await assert.rejects(ks.killAll({ args: { confirm: 'fleet' }, kind: 'direct', user: 'u' }), (e) => e.status === 400);
  await assert.rejects(ks.killAll({ args: { confirm: BID }, kind: 'local', user: 'u' }), (e) => e.status === 403);
});

test('kill *: pause and Escape first, kill only after the grace (fake clock)', async () => {
  const { go, calls, clock, stateDir, steps } = setup();
  const r = await go('*', { confirm: BID, include: ['scratch', '_laneboard'] }, HUB);
  assert.equal(r.ok, true, JSON.stringify(r));
  const { job } = r.result;
  assert.match(job, /^killall-/);
  assert.equal(r.result.graceMs, ks.DEFAULT_GRACE_MS);
  assert.equal(r.result.state, 'grace');
  assert.deepEqual(r.result.victims, ['lane-a', 'lane-b', 'scratch']);
  assert.deepEqual(r.result.notIncluded, ['_laneboard']);
  assert.equal(r.result.paused, true);
  assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
  assert.deepEqual(calls.map((c) => c[0]), ['sendKeys', 'sendKeys', 'sendKeys']);
  assert.ok(calls.every((c) => c[2][0] === 'Escape'));

  await clock.advance(ks.DEFAULT_GRACE_MS - 1);
  assert.equal(calls.filter((c) => c[0] === 'kill').length, 0, 'nothing killed inside the grace');
  await clock.advance(1);
  const kills = calls.filter((c) => c[0] === 'kill').map((c) => c[1]);
  assert.deepEqual(kills, ['lane-a', 'lane-b', 'scratch']);
  // order: every Escape before the first kill
  const firstKill = calls.findIndex((c) => c[0] === 'kill');
  assert.ok(calls.slice(0, firstKill).every((c) => c[0] === 'sendKeys'));
  assert.equal(ks.jobState(job).state, 'killed');
  // job steps: kind killall, start -> pause -> interrupt -> kills -> done
  assert.ok(steps.every((s) => s.kind === 'killall' && s.job === job && s.lane === '*'));
  assert.deepEqual(steps.map((s) => s.step), ['start', 'pause', 'interrupt', 'kill lane-a', 'kill lane-b', 'kill scratch', 'done']);
  // the outcome audit entry carries the job
  const done = r.auditId;
  assert.ok(done);
});

test('kill *: a lane started during the grace is killed too; a protected one never', async () => {
  const { go, calls, clock, setInventory } = setup();
  const r = await go('*', { confirm: BID, graceMs: 5000 });
  assert.equal(r.ok, true);
  setInventory([...SESSIONS(), { name: 'lane-c', paneId: '%9', lane: 'c' }, { name: '_laneboard-new', paneId: '%10', lane: 'z' }]);
  await clock.advance(5000);
  assert.deepEqual(calls.filter((c) => c[0] === 'kill').map((c) => c[1]), ['lane-a', 'lane-b', 'lane-c']);
});

test('kill * cancel within the grace: no kill, the pause stays', async () => {
  const { go, calls, clock, stateDir, steps } = setup();
  const r = await go('*', { confirm: BID, graceMs: 10000 });
  const { job } = r.result;
  await clock.advance(4000);
  const c = await go('*', { confirm: BID, cancel: job });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.deepEqual(c.result, { ok: true, job, cancelled: true, paused: true });
  assert.equal(clock.pending(), 0);
  await clock.advance(60000);
  assert.equal(calls.filter((x) => x[0] === 'kill').length, 0);
  assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
  assert.ok(steps.some((s) => s.step === 'cancel'));
  // a second cancel is too late; an unknown job is 404
  const again = await go('*', { confirm: BID, cancel: job });
  assert.equal(again.status, 409);
  const unknown = await go('*', { confirm: BID, cancel: 'killall-1-deadbeef' });
  assert.equal(unknown.status, 404);
  // cancel also needs the builder id confirm and is remote-only
  assert.equal((await go('*', { confirm: 'fleet', cancel: job })).status, 400);
  assert.equal((await go('*', { confirm: BID, cancel: job }, LOCAL)).status, 403);
});

test('kill * with graceMs 0 kills at once; a cancel afterwards is too late', async () => {
  const { go, calls } = setup();
  const r = await go('*', { confirm: BID, graceMs: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.result.state, 'killed');
  assert.deepEqual(r.result.killed, ['lane-a', 'lane-b']);
  const firstKill = calls.findIndex((c) => c[0] === 'kill');
  assert.equal(calls.slice(0, firstKill).filter((c) => c[0] === 'sendKeys').length, 2, 'Escape before kill');
  assert.equal((await go('*', { confirm: BID, cancel: r.result.job })).status, 409);
});

test('kill *: a failing kill is reported, the rest still go', async () => {
  const { go, steps } = setup({ failKill: 'lane-a' });
  const r = await go('*', { confirm: BID, graceMs: 0, include: ['notes'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.killed, ['lane-b', 'notes']);
  assert.equal(r.result.failed.length, 1);
  assert.equal(r.result.failed[0].name, 'lane-a');
  assert.ok(!/\u001b/.test(r.result.failed[0].error), 'control characters stripped');
  assert.equal(steps.find((s) => s.step === 'kill lane-a').ok, false);
});

test('kill * strict args: unknown keys and bad include names are refused', async () => {
  const { go, calls } = setup();
  assert.equal((await go('*', { confirm: BID, force: true })).status, 400);
  assert.equal((await go('*', { confirm: BID, include: ['a;b'] })).status, 400);
  assert.equal((await go('*', { confirm: BID, graceMs: -1 })).status, 400);
  assert.deepEqual(calls, []);
});

test('module stop() drops a pending grace: nothing killed, still paused', async () => {
  const { go, calls, clock, stateDir } = setup();
  const r = await go('*', { confirm: BID });
  assert.equal(r.ok, true);
  ksRoute.stop();
  await clock.advance(ks.DEFAULT_GRACE_MS * 2);
  assert.equal(calls.filter((c) => c[0] === 'kill').length, 0);
  assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
  assert.equal(ks.jobState(r.result.job).state, 'cancelled');
});

// --- hub fleet kill ---------------------------------------------------------------------------------------

function hubSetup({ respond = null, builders = [
  { id: 'builder-a', state: 'up', controls: true },
  { id: 'builder-b', state: 'up', controls: true },
  { id: 'builder-c', state: 'down', controls: false },
] } = {}) {
  _resetHubActions();
  const sent = [];
  const store = {
    view: () => ({ builders: builders.map((b) => ({ ...b, ageMs: 0 })) }),
    builder: (id) => (builders.some((b) => b.id === id) ? { id, url: `https://${id}.example.invalid` } : null),
  };
  const fetchImpl = async (url, init) => {
    const env = JSON.parse(init.body);
    sent.push({ host: new URL(url).hostname, action: env.action, target: env.target, builder: env.builder, args: env.args });
    const custom = respond?.(env, sent);
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const auditEntries = [];
  const relay = createRelay({
    store, key: 'test-key', keyId: 'k1', sign: () => 'sig', audit: { append: (e) => { auditEntries.push(e); return e; } }, fetchImpl,
  });
  const clock = fakeClock();
  const svc = createFleetKill({ timers: clock });
  relay.registerHubAction('kill', { scope: 'fanout', run: (req, ctx) => svc.run(req, ctx) });
  const go = (args, user = DIRECT, builder = '*') => relay.relay({ builder, action: 'kill', target: '*', args }, user);
  return { relay, svc, sent, clock, go, auditEntries };
}

test('fleet kill: pause fan-out at t=0 with each builder its own id, kill only at t=10 s', async () => {
  const { go, sent, clock, svc } = hubSetup();
  const r = await go({ confirm: 'fleet' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 202);
  const job = r.result.job;
  assert.equal(r.result.undoMs, UNDO_MS);
  assert.equal(r.result.state, 'pending');
  assert.deepEqual(sent.map((s) => [s.host, s.action, s.target, s.args.confirm, s.args.interrupt]), [
    ['builder-a.example.invalid', 'pause', '*', 'builder-a', true],
    ['builder-b.example.invalid', 'pause', '*', 'builder-b', true],
  ]);
  // skipped builders are listed by name
  assert.deepEqual(r.result.pause.skipped, [{ builder: 'builder-c', reason: 'down' }]);
  assert.ok(sent.every((s) => s.args.confirm !== 'fleet'));

  await clock.advance(UNDO_MS - 1);
  assert.equal(sent.filter((s) => s.action === 'kill').length, 0, 'no kill inside the undo window');
  await clock.advance(1);
  const kills = sent.filter((s) => s.action === 'kill');
  assert.deepEqual(kills.map((s) => [s.builder, s.args.confirm, s.args.graceMs]), [['builder-a', 'builder-a', 0], ['builder-b', 'builder-b', 0]]);
  const st = svc.get(job);
  assert.equal(st.state, 'killed');
  assert.deepEqual(st.kill.skipped, [{ builder: 'builder-c', reason: 'down' }]);
});

test('fleet undo within 10 s sends resume * and no kill', async () => {
  const { go, sent, clock, svc } = hubSetup();
  const r = await go({ confirm: 'fleet' });
  const job = r.result.job;
  await clock.advance(9000);
  const u = await go({ confirm: 'fleet', cancel: job }, { kind: 'direct', user: 'bob@example.invalid' });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.result.state, 'cancelled');
  const resumes = sent.filter((s) => s.action === 'resume');
  assert.deepEqual(resumes.map((s) => [s.builder, s.args.confirm]), [['builder-a', 'builder-a'], ['builder-b', 'builder-b']]);
  await clock.advance(UNDO_MS * 3);
  assert.equal(sent.filter((s) => s.action === 'kill').length, 0);
  assert.equal(svc.get(job).state, 'cancelled');
  // undo after the window / twice: too late
  const again = await go({ confirm: 'fleet', cancel: job });
  assert.equal(again.status, 409);
  const unknown = await go({ confirm: 'fleet', cancel: 'fleetkill-1-deadbeef' });
  assert.equal(unknown.status, 404);
});

test('fleet kill: undo after the kill phase is too late', async () => {
  const { go, clock } = hubSetup();
  const r = await go({ confirm: 'fleet' });
  await clock.advance(UNDO_MS);
  const u = await go({ confirm: 'fleet', cancel: r.result.job });
  assert.equal(u.status, 409);
});

test("fleet kill needs the typed 'fleet' and a direct user; nothing is sent otherwise", async () => {
  const { go, sent } = hubSetup();
  for (const confirm of [undefined, 'builder-a', 'FLEET', '']) {
    const r = await go(confirm === undefined ? {} : { confirm });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400, String(confirm));
  }
  assert.equal((await go({ confirm: 'fleet', graceMs: 5 })).status, 400, 'unknown args refused');
  assert.equal((await go({ confirm: 'fleet', cancel: '../x' })).status, 400);
  assert.equal((await go({ confirm: 'fleet' }, { kind: 'local', user: 'local' })).status, 403);
  assert.equal((await go({ confirm: 'fleet' }, 'local')).status, 403);
  assert.deepEqual(sent, []);
});

test('fleet kill: one at a time; a second start inside the window is 409 with the pending job', async () => {
  const { go, sent } = hubSetup();
  const r = await go({ confirm: 'fleet' });
  const second = await go({ confirm: 'fleet' });
  assert.equal(second.status, 409);
  assert.equal(second.error, 'fleet-kill-pending');
  assert.equal(second.result.job, r.result.job);
  assert.equal(sent.filter((s) => s.action === 'pause').length, 2, 'the second start sent nothing');
});

test('fleet kill: if the hub stops inside the window, the kill never happens (fails safe)', async () => {
  const { go, sent, clock, svc } = hubSetup();
  const r = await go({ confirm: 'fleet' });
  svc.stop();
  await clock.advance(UNDO_MS * 2);
  assert.equal(sent.filter((s) => s.action === 'kill').length, 0);
  assert.equal(svc.get(r.result.job).state, 'aborted');
  assert.equal((await go({ confirm: 'fleet' })).status, 503);
});

test('a kill for one builder is still relayed as-is (the hub action is fan-out scope only)', async () => {
  const { go, sent } = hubSetup();
  const r = await go({ confirm: 'builder-a', graceMs: 0 }, DIRECT, 'builder-a');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(sent.map((s) => [s.builder, s.action, s.args.confirm]), [['builder-a', 'kill', 'builder-a']]);
});

test('fleet kill with no builder up: nothing sent, the window still guards a later kill', async () => {
  const { go, sent, clock } = hubSetup({ builders: [{ id: 'builder-a', state: 'down', controls: false }] });
  const r = await go({ confirm: 'fleet' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.pause.skipped, [{ builder: 'builder-a', reason: 'down' }]);
  await clock.advance(UNDO_MS);
  assert.deepEqual(sent, []);
});

test('hub module registers kill (fanout) on the relay, serves GET /api/fleet/kill, unregisters on stop', async () => {
  const { relay, sent } = hubSetup();
  _resetHubActions();
  // a fresh relay without the test registration
  const store = {
    view: () => ({ builders: [{ id: 'builder-a', state: 'up', controls: true, ageMs: 0 }] }),
    builder: (id) => (id === 'builder-a' ? { id, url: 'https://builder-a.example.invalid' } : null),
  };
  const got = [];
  const r2 = createRelay({
    store, key: 'k', keyId: 'k1', sign: () => 'sig', audit: { append: (e) => e },
    fetchImpl: async (url, init) => { got.push(JSON.parse(init.body)); return new Response('{"ok":true,"result":{}}', { status: 200 }); },
  });
  void relay; void sent;
  const clock = fakeClock();
  const mod = createFleetKillModule({ timers: clock });
  const routes = [];
  const provided = new Map();
  const ctx = {
    relay: r2,
    route: (m, p, h) => routes.push([m, p, h]),
    json: (res, body) => { res.body = body; },
    provide: (k, v) => provided.set(k, v),
    has: () => false,
    use: () => null,
  };
  await mod.register(ctx);
  assert.deepEqual(routes.map(([m, p]) => [m, p]), [['GET', '/api/fleet/kill']]);
  assert.ok(provided.has('fleetkill'));
  const r = await r2.relay({ builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet' } }, DIRECT);
  assert.equal(r.status, 202);
  const res = {};
  routes[0][2]({}, res);
  assert.equal(res.body.jobs[0].job, r.result.job);
  mod.stop();
  await clock.advance(UNDO_MS);
  assert.equal(got.filter((e) => e.action === 'kill').length, 0, 'stop dropped the pending kill');
  // unregistered: a fleet kill is no longer a hub action
  const after = await r2.relay({ builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet' } }, DIRECT);
  assert.equal(after.status, 400);
  assert.equal(after.error, 'fanout-not-supported');
});

test('registerFanoutKill retries with override only when the registry asks for it', () => {
  const seen = [];
  const strict = (name, def) => {
    seen.push({ name, ...def });
    if (!def.override) throw new TypeError(`registerHubAction: ${name} is a builder action; pass override: true`);
    return () => {};
  };
  assert.equal(typeof registerFanoutKill(strict, () => null), 'function');
  assert.deepEqual(seen.map((d) => [d.name, d.scope, d.override ?? false]), [['kill', 'fanout', false], ['kill', 'fanout', true]]);
  const other = () => { throw new TypeError('kill (fanout) is already registered'); };
  assert.throws(() => registerFanoutKill(other, () => null), /already registered/);
});

test('fleet undo: a builder that answers the resume 429 (its * rate limit) gets one fresh resume later', async () => {
  let limited = true;
  const { go, sent, clock, svc } = hubSetup({
    respond: (env) => (env.action === 'resume' && env.builder === 'builder-b' && limited
      ? (limited = false, { status: 429, body: { ok: false, error: 'rate_limited', code: 'rate_limited' } })
      : null),
  });
  const r = await go({ confirm: 'fleet' });
  await clock.advance(1000);
  const u = await go({ confirm: 'fleet', cancel: r.result.job });
  assert.equal(u.ok, true);
  assert.deepEqual(u.result.undo.retry.builders, ['builder-b']);
  const ids = () => sent.filter((s) => s.action === 'resume').map((s) => s.builder);
  assert.deepEqual(ids(), ['builder-a', 'builder-b']);
  await clock.advance(RESUME_RETRY_MS);
  assert.deepEqual(ids(), ['builder-a', 'builder-b', 'builder-b']);
  assert.equal(sent.at(-1).args.confirm, 'builder-b');
  assert.deepEqual(svc.get(r.result.job).undo.retry.sent, [{ builder: 'builder-b', ok: true, status: 200 }]);
  assert.equal(sent.filter((s) => s.action === 'kill').length, 0);
});

test('builder cancel by the same user inside the grace is not rate limited (the * bucket is 1 per 10 s)', async () => {
  const { go, calls, clock } = setup();
  const r = await go('*', { confirm: BID }, HUB);
  assert.equal(r.ok, true);
  // a second kill * (not a cancel) inside the window is still limited
  const again = await go('*', { confirm: BID }, HUB);
  assert.equal(again.status, 429);
  const c = await go('*', { confirm: BID, cancel: r.result.job }, HUB);
  assert.equal(c.ok, true, JSON.stringify(c));
  await clock.advance(ks.DEFAULT_GRACE_MS);
  assert.equal(calls.filter((x) => x[0] === 'kill').length, 0);
});

test('the merged relay accepts kill in the fan-out scope without override, and refuses it in scope any', async () => {
  _resetHubActions();
  const { registerHubAction } = await import('../server/hub/relay.mjs');
  const un = registerFanoutKill(registerHubAction, () => null);
  assert.equal(typeof un, 'function');
  un();
  assert.throws(() => registerHubAction('kill', { run: () => null }), /collides/);
  _resetHubActions();
});
