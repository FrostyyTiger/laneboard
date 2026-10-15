// Control handlers (fleet C6): pause/resume/approve/deny/release through the real dispatcher with fake
// auth contexts (local, direct, hub). Everything writes into a tmp dir: state dir, audit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const { dispatch, tiers, _reset } = await import('../server/fleet/dispatch.mjs');
const { openAudit } = await import('../server/fleet/audit.mjs');
const { createLimiter } = await import('../server/fleet/ratelimit.mjs');
const handlers = await import('../server/control/handlers.mjs');
const pause = await import('../server/control/pause.mjs');
const approvals = await import('../server/control/approvals.mjs');
const pausedFlag = await import('../server/flags/paused.mjs');
const apiV1 = await import('../server/fleet/api-v1.mjs');
const controlRoute = (await import('../server/routes/control.mjs')).default;

const BID = 'builder-a';
const SID_A = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID_B = '7f00aa11-2222-4333-8444-555566667777';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-handlers-'));
test.after(() => {
  approvals._reset();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const LOCAL = { kind: 'local', user: 'local' };
const DIRECT = { kind: 'direct', user: 'alice@example.invalid' };
const hub = (scopes = ['control']) => ({ kind: 'hub', scopes: new Set(scopes), keyLabel: 'hub-main', verified: true });

let n = 0;
function setup({ hubControl = false, readiness = 'ready', stateDir: sd } = {}) {
  _reset();
  handlers._resetControl();
  approvals._reset();
  const stateDir = sd === undefined ? fs.mkdtempSync(path.join(tmp, 'state-')) : sd;
  const calls = [];
  const sess = new Map(Object.entries({
    'lane-a': { name: 'lane-a', paneId: '%1', state: 'idle', lane: 'a', claude: { sessionId: SID_A } },
    'lane-b': { name: 'lane-b', paneId: '%2', state: 'working', lane: 'b', claude: { sessionId: SID_B } },
    scratch: { name: 'scratch', paneId: '%3', state: 'idle', lane: null },
    '_laneboard-x': { name: '_laneboard-x', paneId: '%4', state: 'idle', lane: 'x' },
  }));
  const stub = (name) => async (...a) => { calls.push([name, ...a]); return { ok: true }; };
  const config = { mode: 'builder', stateDir, fleet: { id: BID, hubControl } };
  const deps = {
    config,
    actions: { sendKeys: stub('sendKeys'), sendText: stub('sendText') },
    state: { get: (x) => sess.get(x) ?? null, all: () => [...sess.values()], promptReadiness: () => readiness },
    capturePane: async () => ['❯ '],
  };
  handlers.registerControlActions(deps);
  const audit = openAudit({ file: path.join(tmp, `audit-${++n}.jsonl`), builder: BID });
  const limiter = createLimiter();
  const go = (action, target, args = {}, auth = DIRECT) => dispatch(
    { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: BID, action, target, args, user: 'ops@example.invalid', via: 'hub' },
    { auth, deps, audit, limiter },
  );
  const entries = () => audit.read({ since: 0 }).entries;
  return { calls, deps, go, stateDir, sess, entries, config };
}

function openApproval(sessionId = SID_A) {
  return approvals.open(
    { session_id: sessionId, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' }, cwd: '/nonexistent-lb-cwd' },
    { timeoutMs: 60_000, nameOf: (sid) => (sid === SID_A ? 'lane-a' : sid === SID_B ? 'lane-b' : null) },
  );
}

const status = (id) => approvals.get(id)?.status;

test('registers the five actions as click tier; registering twice is a no-op', () => {
  setup();
  const t = tiers();
  for (const a of handlers.CONTROL_ACTIONS) assert.equal(t[a], 'click', a);
  assert.deepEqual(handlers.registerControlActions({}), []);
});

test('route module registers the handlers and the pause capability', () => {
  _reset();
  handlers._resetControl();
  controlRoute.register({ actions: {}, state: {}, config: { stateDir: tmp } });
  assert.ok(tiers().approve);
  assert.ok(apiV1.capabilityList().includes('pause'));
  assert.deepEqual(controlRoute.modes, ['builder']);
});

test('pause a session from local: operator sentinel under config.stateDir, audited start + done', async () => {
  const { go, stateDir, entries, calls } = setup();
  const r = await go('pause', 'lane-a', { reason: 'look\u001b[31m at this' }, LOCAL);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.scope, 'lane-a');
  const [e] = pause.list({ stateDir });
  assert.equal(e.scope, 'lane-a');
  assert.equal(e.kind, 'operator');
  assert.equal(e.by, 'local');
  assert.ok(!/\u001b/.test(e.reason), 'control characters stripped');
  assert.equal(calls.length, 0, 'no Escape without interrupt');
  const audited = entries().filter((x) => x.action === 'pause');
  assert.deepEqual(audited.map((x) => x.result.phase), ['start', 'done']);
  assert.equal(audited[1].result.ok, true);
});

test('pause invalidates the paused flag cache', async () => {
  const { go, stateDir } = setup();
  pausedFlag.default.register({ config: { stateDir }, state: { addDecorator() {}, onTick() {} } });
  const s = { name: 'lane-a', claude: { sessionId: SID_A } };
  assert.equal(pausedFlag.pausedFor(s), null); // cached empty list
  assert.equal((await go('pause', 'lane-a')).ok, true);
  assert.equal(pausedFlag.pausedFor(s)?.kind, 'operator');
  assert.equal((await go('resume', 'lane-a', { nudge: false })).ok, true);
  assert.equal(pausedFlag.pausedFor(s), null);
});

test('pause with interrupt sends Escape to the target', async () => {
  const { go, calls } = setup();
  const r = await go('pause', 'lane-b', { interrupt: true }, LOCAL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.interrupted, ['lane-b']);
  assert.deepEqual(calls, [['sendKeys', 'lane-b', ['Escape'], 'local']]);
});

test('pause * needs confirm equal to the builder id (never "fleet"); interrupt hits lane sessions only', async () => {
  const { go, stateDir, calls } = setup();
  for (const args of [{}, { confirm: 'fleet' }, { confirm: 'other' }]) {
    const r = await go('pause', '*', args);
    assert.equal(r.status, 400, JSON.stringify(args));
    assert.equal(r.code, 'confirm_required');
  }
  assert.deepEqual(pause.list({ stateDir }), []);
  const r = await go('pause', '*', { confirm: BID, interrupt: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.scope, 'ALL');
  assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
  assert.deepEqual(calls.map((c) => c[1]).sort(), ['lane-a', 'lane-b']);
});

test('pause of an unknown session is 404 and writes nothing', async () => {
  const { go, stateDir } = setup();
  const r = await go('pause', 'nope');
  assert.equal(r.status, 404);
  assert.deepEqual(pause.list({ stateDir }), []);
});

test('pause never downgrades a budget pause', async () => {
  const { go, stateDir } = setup();
  pause.pause('lane-a', { kind: 'budget', by: 'budget' }, { stateDir });
  const r = await go('pause', 'lane-a');
  assert.equal(r.ok, true);
  assert.equal(r.result.kind, 'budget');
  assert.equal(r.result.kept, true);
});

for (const action of ['approve', 'deny', 'release']) {
  test(`${action} from local is 403 remote-only and the approval stays pending`, async () => {
    const { go, entries } = setup();
    const { approval } = openApproval();
    const r = await go(action, 'lane-a', { approvalId: approval.id }, LOCAL);
    assert.equal(r.status, 403);
    assert.equal(r.code, 'remote-only');
    assert.equal(status(approval.id), 'pending');
    const audited = entries().filter((x) => x.action === action);
    assert.equal(audited.length, 1);
    assert.equal(audited[0].result.code, 'remote-only');
  });
}

test('approve from direct allows and resolves the hook wait', async () => {
  const { go } = setup();
  const { approval, wait } = openApproval();
  const r = await go('approve', 'lane-a', { approvalId: approval.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result, { ok: true, approvalId: approval.id, session: 'lane-a', status: 'allowed' });
  const d = await wait;
  assert.equal(JSON.parse(d.output).hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(d.who, 'alice@example.invalid');
});

test('deny from direct carries note and interrupt', async () => {
  const { go } = setup();
  const { approval, wait } = openApproval();
  const r = await go('deny', 'lane-a', { approvalId: approval.id, note: 'not that', interrupt: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.status, 'denied');
  const dec = JSON.parse((await wait).output).hookSpecificOutput.decision;
  assert.equal(dec.behavior, 'deny');
  assert.equal(dec.interrupt, true);
  assert.match(dec.message, /Denied by alice@example\.invalid via laneboard: not that/);
});

test('release from direct returns empty hook output', async () => {
  const { go } = setup();
  const { approval, wait } = openApproval();
  const r = await go('release', 'lane-a', { approvalId: approval.id });
  assert.equal(r.result.status, 'released');
  assert.equal((await wait).output, '');
});

test('approve with an approvalId of another session is 409 and the approval stays pending (S19)', async () => {
  const { go } = setup();
  const { approval } = openApproval(SID_B); // belongs to lane-b
  for (const action of ['approve', 'deny', 'release']) {
    const r = await go(action, 'lane-a', { approvalId: approval.id });
    assert.equal(r.status, 409, action);
    assert.equal(status(approval.id), 'pending');
  }
  const ok = await go('approve', 'lane-b', { approvalId: approval.id });
  assert.equal(ok.result.status, 'allowed');
});

test('approve: unknown id 404, decided twice 409, bad id 400, unknown arg 400', async () => {
  const { go } = setup();
  assert.equal((await go('approve', 'lane-a', { approvalId: crypto.randomUUID() })).status, 404);
  const { approval } = openApproval();
  assert.equal((await go('approve', 'lane-a', { approvalId: approval.id })).ok, true);
  assert.equal((await go('approve', 'lane-a', { approvalId: approval.id })).status, 409);
  assert.equal((await go('approve', 'lane-a', { approvalId: 'x' })).code, 'bad_args');
  const { approval: a2 } = openApproval();
  assert.equal((await go('approve', 'lane-a', { approvalId: a2.id, note: 'x' })).code, 'bad_args');
  assert.equal(status(a2.id), 'pending');
});

test('approve from the hub: needs hubControl and the control scope', async () => {
  const off = setup({ hubControl: false });
  const { approval } = openApproval();
  assert.equal((await off.go('approve', 'lane-a', { approvalId: approval.id }, hub())).code, 'control-disabled');
  const on = setup({ hubControl: true });
  const { approval: a } = openApproval();
  assert.equal((await on.go('approve', 'lane-a', { approvalId: a.id }, hub(['read']))).code, 'scope-missing');
  assert.equal(status(a.id), 'pending');
  const r = await on.go('approve', 'lane-a', { approvalId: a.id }, hub());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(approvals.get(a.id).decidedBy, 'ops@example.invalid');
});

test('resume from local of an operator pause runs and nudges a ready idle session', async () => {
  const { go, stateDir, calls } = setup();
  pause.pause('lane-a', { kind: 'operator', by: 'x' }, { stateDir });
  const r = await go('resume', 'lane-a', {}, LOCAL);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.removed, ['lane-a']);
  assert.equal(r.result.nudged, true);
  assert.deepEqual(calls, [['sendText', 'lane-a', 'continue', true, 'local']]);
  assert.deepEqual(pause.list({ stateDir }), []);
});

test('resume does not nudge a working, not-ready or still-paused session, or with nudge:false', async () => {
  let s = setup();
  pause.pause('lane-b', { kind: 'operator' }, { stateDir: s.stateDir });
  let r = await s.go('resume', 'lane-b', {}, LOCAL);
  assert.deepEqual([r.result.nudged, r.result.reason], [false, 'state working']);

  s = setup({ readiness: 'dialog' });
  pause.pause('lane-a', { kind: 'operator' }, { stateDir: s.stateDir });
  r = await s.go('resume', 'lane-a', {}, LOCAL);
  assert.deepEqual([r.result.nudged, r.result.reason], [false, 'prompt dialog']);

  s = setup();
  pause.pause('ALL', { kind: 'operator' }, { stateDir: s.stateDir });
  r = await s.go('resume', 'lane-a', {}, LOCAL);
  assert.deepEqual([r.result.nudged, r.result.reason], [false, 'still paused']);

  s = setup();
  r = await s.go('resume', 'lane-a', { nudge: false }, LOCAL);
  assert.equal(r.ok, true);
  assert.equal(r.result.nudged, undefined);
  assert.equal(s.calls.length, 0);
});

test('resume from local of a budget or quota pause is 403 even with override; the sentinel stays', async () => {
  for (const kind of ['budget', 'quota']) {
    const { go, stateDir, entries } = setup();
    pause.pause('lane-a', { kind, by: kind }, { stateDir });
    for (const args of [{}, { override: true }]) {
      const r = await go('resume', 'lane-a', args, LOCAL);
      assert.equal(r.status, 403, `${kind} ${JSON.stringify(args)}`);
      assert.equal(r.code, 'remote-only');
    }
    assert.equal(pause.kindOf('lane-a', { stateDir }), kind);
    assert.equal(entries().filter((e) => e.action === 'resume').length, 2);
  }
});

test('resume from local is 403 when the builder-wide pause is a budget pause', async () => {
  const { go, stateDir } = setup();
  pause.pause('ALL', { kind: 'budget' }, { stateDir });
  pause.pause('lane-a', { kind: 'operator' }, { stateDir });
  assert.equal((await go('resume', 'lane-a', {}, LOCAL)).code, 'remote-only');
  assert.equal((await go('resume', '*', { confirm: BID }, LOCAL)).code, 'remote-only');
  assert.equal(pause.kindOf('ALL', { stateDir }), 'budget');
});

test('resume from local with override is 403 even of an operator pause', async () => {
  const { go, stateDir } = setup();
  pause.pause('lane-a', { kind: 'operator' }, { stateDir });
  assert.equal((await go('resume', 'lane-a', { override: true }, LOCAL)).code, 'remote-only');
  assert.equal(pause.kindOf('lane-a', { stateDir }), 'operator');
});

test('resume from direct of a budget pause: 409 without override, lifted with override', async () => {
  const { go, stateDir } = setup();
  pause.pause('lane-a', { kind: 'budget' }, { stateDir });
  const r = await go('resume', 'lane-a');
  assert.equal(r.status, 409);
  assert.equal(r.code, 'over-budget');
  assert.match(r.error, /set-budget/);
  assert.equal(pause.kindOf('lane-a', { stateDir }), 'budget');
  const ok = await go('resume', 'lane-a', { override: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(pause.kindOf('lane-a', { stateDir }), null);
});

test('runResume keeps a budget pause for local even if the predicate was bypassed (defence in depth)', async () => {
  const { deps, config, stateDir } = setup();
  pause.pause('lane-a', { kind: 'budget' }, { stateDir });
  await assert.rejects(
    handlers.runResume({ target: 'lane-a', args: { override: true, nudge: false }, user: 'local', kind: 'local', deps, config }),
    (e) => e.status === 409,
  );
  assert.equal(pause.kindOf('lane-a', { stateDir }), 'budget');
});

test('resume * needs confirm; with it lifts ALL only and nudges lane sessions', async () => {
  const { go, stateDir, calls } = setup();
  pause.pause('ALL', { kind: 'operator' }, { stateDir });
  pause.pause('lane-b', { kind: 'operator' }, { stateDir });
  assert.equal((await go('resume', '*', {}, LOCAL)).code, 'confirm_required');
  assert.equal((await go('resume', '*', { confirm: 'fleet' }, LOCAL)).code, 'confirm_required');
  const r = await go('resume', '*', { confirm: BID }, LOCAL);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.removed, ['ALL']);
  assert.equal(pause.kindOf('lane-b', { stateDir }), 'operator');
  const byName = Object.fromEntries(r.result.nudges.map((x) => [x.name, x]));
  assert.equal(byName['lane-a'].nudged, true);
  assert.equal(byName['lane-b'].reason, 'still paused');
  assert.equal(byName.scratch, undefined);
  assert.deepEqual(calls.map((c) => c[1]), ['lane-a']);
});

test('no config.stateDir: pause is refused 500, resume from local fails closed (403)', async () => {
  const { go } = setup({ stateDir: null });
  const p = await go('pause', 'lane-a');
  assert.equal(p.status, 500);
  assert.equal(p.code, 'no-state-dir');
  assert.equal((await go('resume', 'lane-a', {}, LOCAL)).code, 'remote-only');
});

test('unknown args are refused for every control action', async () => {
  const { go } = setup();
  assert.equal((await go('pause', 'lane-a', { kind: 'budget' })).code, 'bad_args');
  assert.equal((await go('resume', 'lane-a', { kinds: ['budget'] })).code, 'bad_args');
  assert.equal((await go('release', 'lane-a', { approvalId: crypto.randomUUID(), note: 'x' })).code, 'bad_args');
});

// SR16 L1: a tmux session literally named ALL (or a dot / sid- name) never reaches the builder-wide sentinel.
test('SR16 L1: a session named ALL, .x or sid-x is refused 400 bad_target for pause and resume', async () => {
  for (const auth of [LOCAL, DIRECT, hub()]) {
    const { go, stateDir, sess } = setup({ hubControl: true });
    for (const name of ['ALL', '.x', 'sid-x']) sess.set(name, { name, paneId: '%9', state: 'idle', lane: 'z' });
    for (const name of ['ALL', '.x', 'sid-x']) {
      const p = await go('pause', name, {}, auth);
      assert.equal(p.status, 400, `${auth.kind} pause ${name}: ${JSON.stringify(p)}`);
      assert.equal(p.code, 'bad_target');
    }
    assert.deepEqual(pause.list({ stateDir, mirrors: true }), [], 'nothing written');
    // an operator pause * (with confirm) is not liftable through the ALL session
    pause.pause('ALL', { kind: 'operator', by: 'ops' }, { stateDir });
    const r = await go('resume', 'ALL', { nudge: false }, auth);
    assert.equal(r.status, 400, `${auth.kind} resume ALL: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'bad_target');
    assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
    // only '*' with confirm reaches ALL
    const ok = await go('resume', '*', { confirm: BID, nudge: false }, auth);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(pause.kindOf('ALL', { stateDir }), null);
  }
});

test('SR16 L1: runPause / runResume refuse a reserved target even when called directly', async () => {
  const { deps, stateDir } = setup();
  pause.pause('ALL', { kind: 'operator' }, { stateDir });
  for (const run of [handlers.runPause, handlers.runResume]) {
    await assert.rejects(run({ target: 'ALL', args: { nudge: false }, user: 'local', kind: 'direct', deps }), (e) => e.status === 400 && e.code === 'bad_target');
  }
  assert.equal(pause.kindOf('ALL', { stateDir }), 'operator');
  assert.equal(handlers.resumeRemoteOnly({ target: 'ALL', args: {} }, deps), true);
  assert.equal(handlers.isReservedTarget('*'), false);
  assert.equal(handlers.isReservedTarget('lane-a'), false);
});

// SR16 L2: a corrupt sentinel counts as the most restrictive kind for resume.
test('SR16 L2: local resume of a corrupt, oversize or non-file sentinel is 403 and it stays', async () => {
  const variants = {
    truncated: (f) => fs.writeFileSync(f, '{"kind":"budget",'),
    oversize: (f) => fs.writeFileSync(f, JSON.stringify({ kind: 'budget', reason: 'x'.repeat(5000) })),
    unknownKind: (f) => fs.writeFileSync(f, '{"kind":"mystery"}'),
    notJsonObject: (f) => fs.writeFileSync(f, '[1]'),
    directory: (f) => fs.mkdirSync(f),
  };
  for (const [label, make] of Object.entries(variants)) {
    for (const scope of ['lane-a', 'ALL']) {
      const { go, stateDir } = setup();
      fs.mkdirSync(path.join(stateDir, 'paused'), { recursive: true });
      const file = path.join(stateDir, 'paused', scope);
      make(file);
      const r = await go('resume', 'lane-a', { nudge: false }, LOCAL);
      assert.equal(r.status, 403, `${label} ${scope}: ${JSON.stringify(r)}`);
      assert.equal(r.code, 'remote-only');
      if (scope === 'ALL') assert.equal((await go('resume', '*', { confirm: BID, nudge: false }, LOCAL)).code, 'remote-only');
      assert.ok(fs.existsSync(file), `${label} ${scope} kept`);
    }
  }
});

test('SR16 L2: a valid operator sentinel is still liftable from local', async () => {
  const { go, stateDir } = setup();
  pause.pause('lane-a', { kind: 'operator' }, { stateDir });
  assert.equal(handlers.heldKind('lane-a', stateDir), 'operator');
  assert.equal(handlers.heldKind('lane-b', stateDir), null);
  assert.equal((await go('resume', 'lane-a', { nudge: false }, LOCAL)).ok, true);
});

// SR16 L3: predicate and run read the state dir from the same source (the deps config).
test('SR16 L3: the dispatcher ctx.config cannot move the run step to another state dir', async () => {
  const { deps, stateDir, config } = setup();
  const other = fs.mkdtempSync(path.join(tmp, 'other-'));
  const audit = openAudit({ file: path.join(tmp, `audit-${++n}.jsonl`), builder: BID });
  const go = (action, target, args, auth) => dispatch(
    { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: BID, action, target, args, user: 'ops@example.invalid', via: 'hub' },
    { auth, deps, audit, limiter: createLimiter(), config: { ...config, stateDir: other } },
  );
  assert.equal((await go('pause', 'lane-a', {}, LOCAL)).ok, true);
  assert.equal(pause.kindOf('lane-a', { stateDir }), 'operator', 'written under deps.config.stateDir');
  assert.deepEqual(pause.list({ stateDir: other }), [], 'nothing under ctx.config.stateDir');
  // budget pause in the deps dir: predicate (deps dir) refuses local; the run would read the same dir
  pause.pause('lane-b', { kind: 'budget' }, { stateDir });
  assert.equal((await go('resume', 'lane-b', { nudge: false }, LOCAL)).code, 'remote-only');
  // runResume ignores a `config` argument for the state dir
  await assert.rejects(
    handlers.runResume({ target: 'lane-b', args: { nudge: false }, user: 'x', kind: 'direct', deps, config: { stateDir: other } }),
    (e) => e.status === 409,
  );
  assert.equal(pause.kindOf('lane-b', { stateDir }), 'budget');
  assert.equal(handlers.stateDirFor(deps), stateDir);
});
