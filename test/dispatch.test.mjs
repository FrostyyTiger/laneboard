import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  dispatch, registerAction, registerAllHandler, tiers, TIERS, ActionRefused, LANE_ID_RE, _reset,
} from '../server/fleet/dispatch.mjs';
import { registerBuiltins, resolveSpawnDir, BUILTIN_ACTIONS, _resetBuiltins } from '../server/fleet/builtin-actions.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { createLimiter } from '../server/fleet/ratelimit.mjs';

const BID = 'builder-a';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-dispatch-'));
const root = path.join(tmp, 'code');
const repoDir = path.join(root, 'acme');
const outside = path.join(tmp, 'elsewhere');
fs.mkdirSync(repoDir, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.symlinkSync(outside, path.join(root, 'sneaky'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let auditN = 0;

function setup({ hubControl = false, sessions = null, readiness = 'ready', rules = null, mode = 'builder' } = {}) {
  _reset();
  _resetBuiltins();
  const calls = [];
  const sess = new Map(Object.entries(sessions ?? {
    'agent-1': { name: 'agent-1', paneId: '%1', state: 'idle' },
    'agent-2': { name: 'agent-2', paneId: '%2', state: 'working' },
    '_laneboard-x': { name: '_laneboard-x', paneId: '%3', state: 'idle' },
  }));
  const stub = (name) => async (...a) => { calls.push([name, ...a]); return { ok: true, via: name }; };
  const config = {
    mode,
    fleet: { id: BID, hubControl, allowedPermissionModes: ['default', 'acceptEdits', 'plan', 'auto'] },
    repoNames: ['acme'],
    dirRoots: [root],
  };
  const deps = {
    config,
    actions: {
      sendText: stub('sendText'), sendKeys: stub('sendKeys'), kill: stub('kill'),
      restart: stub('restart'), spawn: stub('spawn'),
    },
    launcher: { launch: async (req, who) => { calls.push(['launch', req, who]); return { ok: true, job: 'launch-x-1', lane: req.lane }; } },
    retirer: { retire: stub('retire') },
    state: { get: (n) => sess.get(n) ?? null, all: () => [...sess.values()], promptReadiness: () => readiness },
    capturePane: async () => ['❯ '],
  };
  registerBuiltins(deps);
  const audit = openAudit({ file: path.join(tmp, `audit-${++auditN}.jsonl`), builder: BID });
  const limiter = createLimiter(rules);
  const go = (env, auth = { kind: 'direct', user: 'alice@example.invalid' }) =>
    dispatch(env, { auth, deps, audit, limiter });
  return { calls, deps, audit, limiter, go, sess, config };
}

function env(action, target, args = {}, extra = {}) {
  return { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: BID, action, target, args, user: 'alice@example.invalid', via: 'direct', ...extra };
}
const hubEnv = (...a) => ({ ...env(...a), via: 'hub' });
const LOCAL = { kind: 'local', user: 'local' };
const hub = (scopes) => ({ kind: 'hub', scopes: new Set(scopes), keyLabel: 'hub-main' });

function entries(audit) {
  return audit.read({ since: 0 }).entries;
}

const VALID = {
  'send-text': ['agent-1', { text: 'hi' }],
  'send-keys': ['agent-1', { keys: ['Enter'] }],
  interrupt: ['agent-1', {}],
  kill: ['agent-1', { confirm: 'agent-1' }],
  restart: ['agent-1', { confirm: 'agent-1' }],
  spawn: ['new-one', { dir: repoDir }],
  launch: ['lane-1', { repo: 'acme', plan: 'docs/plans/lane-1.md' }],
  retire: ['lane-1', { confirm: 'lane-1' }],
};

test('lane id rule matches server/lanes/store.mjs', async () => {
  process.env.LANEBOARD_CONFIG ??= path.join(import.meta.dirname, 'fixtures', 'empty-config.json');
  process.env.LANEBOARD_DB ??= ':memory:';
  const store = await import('../server/lanes/store.mjs');
  assert.equal(String(LANE_ID_RE), String(store.LANE_ID_RE));
});

test('tiers lists every builder action, not the hub-only broadcast', () => {
  setup();
  const t = tiers();
  assert.deepEqual(t, {
    interrupt: 'click', kill: 'confirm', launch: 'ask', restart: 'confirm', retire: 'confirm',
    'send-keys': 'click', 'send-text': 'click', spawn: 'ask',
  });
  for (const v of Object.values(t)) assert.ok(TIERS.includes(v));
  assert.equal(BUILTIN_ACTIONS.length, 9);
});

test('every built-in action runs with valid args and rejects unknown keys (stub not called)', async () => {
  for (const [action, [target, args]] of Object.entries(VALID)) {
    const s = setup();
    const ok = await s.go(env(action, target, args));
    assert.equal(ok.ok, true, `${action}: ${ok.error}`);
    assert.equal(s.calls.length, 1, action);
    const bad = await s.go(env(action, target, { ...args, extra: 1 }));
    assert.equal(bad.status, 400, action);
    assert.equal(bad.code, 'bad_args', action);
    assert.equal(s.calls.length, 1, `${action} stub called on bad args`);
  }
});

test('handlers receive validated args with defaults', async () => {
  const s = setup();
  await s.go(env('send-text', 'agent-1', { text: 'hello' }));
  assert.deepEqual(s.calls[0], ['sendText', 'agent-1', 'hello', true, 'alice@example.invalid']);
  const r = await s.go(env('launch', 'lane-2', { repo: 'acme', plan: 'docs/plans/x.md', priority: 'low' }));
  assert.equal(r.status, 202);
  assert.deepEqual(s.calls[1], ['launch', { lane: 'lane-2', repo: 'acme', plan: 'docs/plans/x.md', priority: 'low' }, 'alice@example.invalid']);
  const d = await s.go(env('launch', 'lane-3', { repo: 'acme', plan: 'p.md', dryRun: true }));
  assert.equal(d.status, 200);
  await s.go(env('retire', 'lane-1', { confirm: 'lane-1' }));
  assert.deepEqual(s.calls[3], ['retire', 'lane-1', { force: false, confirm: 'lane-1' }, 'alice@example.invalid']);
});

test('direct user comes from auth, never from the envelope', async () => {
  const s = setup();
  await s.go(env('send-keys', 'agent-1', { keys: ['a'] }, { user: 'mallory' }), { kind: 'direct', user: 'alice@example.invalid' });
  assert.equal(s.calls[0][3], 'alice@example.invalid');
  await s.go(env('send-keys', 'agent-1', { keys: ['a'] }, { user: 'mallory' }), LOCAL);
  assert.equal(s.calls[1][3], 'local');
});

test('kill without / with a wrong confirm -> 400 confirm_required, stub not called', async () => {
  const s = setup();
  let r = await s.go(env('kill', 'agent-1', {}));
  assert.equal(r.status, 400);
  r = await s.go(env('kill', 'agent-1', { confirm: 'agent-2' }));
  assert.equal(r.status, 400);
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('restart', 'agent-1', { confirm: 'AGENT-1' }));
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('retire', 'lane-1', { confirm: 'lane-2' }));
  assert.equal(r.code, 'confirm_required');
  assert.equal(s.calls.length, 0);
});

test('target * refused for restart, retire, spawn, launch, send-text, send-keys', async () => {
  const s = setup();
  for (const [action, [, args]] of Object.entries(VALID)) {
    if (action === 'kill' || action === 'interrupt') continue;
    const r = await s.go(env(action, '*', { ...args, confirm: BID }));
    assert.equal(r.status, 400, action);
    assert.equal(r.code, 'bad_target', action);
  }
  assert.equal(s.calls.length, 0);
});

test('kill * : 501 without an all-handler, handler called with confirm:<builderId>', async () => {
  const s = setup();
  let r = await s.go(env('kill', '*', { confirm: BID }));
  assert.equal(r.status, 501);
  assert.equal(r.code, 'not_implemented');
  const seen = [];
  registerAllHandler('kill', async ({ target, args, user }) => { seen.push({ target, args, user }); return { ok: true, job: 'killall-1' }; });
  r = await s.go(env('kill', '*', { confirm: BID, graceMs: 5000, include: ['agent-2'] }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(seen, [{ target: '*', args: { confirm: BID, graceMs: 5000, include: ['agent-2'] }, user: 'alice@example.invalid' }]);
  assert.equal(s.calls.length, 0, 'the per-session kill never ran');
  const last = entries(s.audit).at(-1);
  assert.equal(last.result.job, 'killall-1');
  // '*'-only args are refused on a single session
  r = await s.go(env('kill', 'agent-1', { confirm: 'agent-1', graceMs: 5 }));
  assert.equal(r.code, 'bad_args');
});

test('kill * : confirm "fleet" or another id refused, from local refused (remote-only)', async () => {
  const s = setup();
  registerAllHandler('kill', async () => ({ ok: true }));
  let r = await s.go(env('kill', '*', { confirm: 'fleet' }));
  assert.equal(r.status, 400);
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('kill', '*', { confirm: 'builder-b' }));
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('kill', '*', { confirm: BID }), LOCAL);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'remote-only');
  // a single-session kill from local is fine
  r = await s.go(env('kill', 'agent-1', { confirm: 'agent-1' }), LOCAL);
  assert.equal(r.ok, true);
});

test('interrupt * with confirm:<builderId> reaches every session except _laneboard*, "fleet" refused', async () => {
  const s = setup();
  let r = await s.go(env('interrupt', '*', { confirm: 'fleet' }));
  assert.equal(r.status, 400);
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('interrupt', '*', {}));
  assert.equal(r.code, 'confirm_required');
  r = await s.go(env('interrupt', '*', { confirm: BID }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.sent, ['agent-1', 'agent-2']);
  assert.deepEqual(s.calls.map((c) => [c[1], c[2]]), [['agent-1', ['Escape']], ['agent-2', ['Escape']]]);
});

test('hub kind: hubControl false -> 403 control-disabled (audited); scopes {read} -> scope-missing; {read,control} -> runs', async () => {
  let s = setup({ hubControl: false });
  let r = await s.go(hubEnv('send-keys', 'agent-1', { keys: ['a'] }), hub(['read', 'control']));
  assert.equal(r.status, 403);
  assert.equal(r.code, 'control-disabled');
  assert.ok(r.auditId);
  let e = entries(s.audit);
  assert.equal(e.length, 1);
  assert.equal(e[0].result.ok, false);
  assert.equal(e[0].result.code, 'control-disabled');
  assert.equal(e[0].result.key, 'hub-main');
  assert.equal(e[0].hash, r.auditId);

  s = setup({ hubControl: true });
  r = await s.go(hubEnv('send-keys', 'agent-1', { keys: ['a'] }), hub(['read']));
  assert.equal(r.code, 'scope-missing');
  r = await s.go(hubEnv('send-keys', 'agent-1', { keys: ['a'] }), { kind: 'hub', scopes: ['read', 'control'] });
  assert.equal(r.ok, true, r.error);
  assert.equal(s.calls[0][3], 'alice@example.invalid', 'hub user is the envelope user');
  // a hub envelope must say via:'hub', and a non-hub one must not
  r = await s.go(env('send-keys', 'agent-1', { keys: ['a'] }), hub(['read', 'control']));
  assert.equal(r.code, 'bad_envelope');
  r = await s.go(hubEnv('send-keys', 'agent-1', { keys: ['a'] }));
  assert.equal(r.code, 'bad_envelope');
  r = await s.go(hubEnv('send-keys', 'agent-1', { keys: ['a'] }, { user: 'has space' }), hub(['read', 'control']));
  assert.equal(r.code, 'bad_envelope');
});

test('localOnly action refused from the hub', async () => {
  const s = setup({ hubControl: true });
  registerAction('ack-alarm', {
    tier: 'click', target: 'alarm-or-all', localOnly: true, allConfirm: false,
    args: { tile: { type: 'string', max: 64 }, builder: { type: 'string', max: 64 } },
    runsAll: true, run: async ({ target }) => ({ ok: true, target }),
  });
  let r = await s.go(hubEnv('ack-alarm', 'a-1', {}), hub(['read', 'control']));
  assert.equal(r.code, 'local-only');
  r = await s.go(env('ack-alarm', '*', {}));
  assert.equal(r.ok, true, 'ack-alarm * needs no builder-id confirm');
});

test('remote-only: approve from local -> 403, from direct and control-scoped hub -> runs', async () => {
  const s = setup({ hubControl: true });
  let ran = 0;
  registerAction('approve', {
    tier: 'click', target: 'session', remoteOnly: true,
    args: { approvalId: { type: 'string', required: true, max: 64 } },
    run: async () => { ran++; return { ok: true }; },
  });
  let r = await s.go(env('approve', 'agent-1', { approvalId: 'x1' }), LOCAL);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'remote-only');
  assert.equal(ran, 0);
  r = await s.go(env('approve', 'agent-1', { approvalId: 'x1' }));
  assert.equal(r.ok, true);
  r = await s.go(hubEnv('approve', 'agent-1', { approvalId: 'x1' }), hub(['read', 'control']));
  assert.equal(r.ok, true);
  assert.equal(ran, 2);
});

test('remote-only predicate: resume of a budget pause from local -> 403 even without override; operator pause runs', async () => {
  const s = setup();
  const pauseKind = { 'agent-1': 'budget', 'agent-2': 'operator' };
  let ran = [];
  registerAction('resume', {
    tier: 'click', target: 'session-or-all', runsAll: true,
    remoteOnly: (e) => e.args.override === true || ['budget', 'quota'].includes(pauseKind[e.target]),
    args: { confirm: { type: 'string' }, nudge: { type: 'boolean', default: true }, override: { type: 'boolean' } },
    run: async ({ target }) => { ran.push(target); return { ok: true }; },
  });
  let r = await s.go(env('resume', 'agent-1', {}), LOCAL);
  assert.equal(r.code, 'remote-only');
  r = await s.go(env('resume', 'agent-2', {}), LOCAL);
  assert.equal(r.ok, true);
  r = await s.go(env('resume', 'agent-2', { override: true }), LOCAL);
  assert.equal(r.code, 'remote-only');
  r = await s.go(env('resume', 'agent-1', {}));
  assert.equal(r.ok, true, 'direct user may lift a budget pause');
  assert.deepEqual(ran, ['agent-2', 'agent-1']);
});

test('remote-only predicate that throws fails closed', async () => {
  const s = setup();
  registerAction('odd', { tier: 'click', target: 'session', remoteOnly: () => { throw new Error('boom'); }, run: async () => ({ ok: true }) });
  const r = await s.go(env('odd', 'agent-1', {}), LOCAL);
  assert.equal(r.code, 'remote-only');
});

test('guardPrompt: 409 prompting when waiting_permission, awaitingApproval, or pane not ready', async () => {
  let s = setup({ sessions: { 'agent-1': { name: 'agent-1', paneId: '%1', state: 'waiting_permission' } } });
  let r = await s.go(env('send-text', 'agent-1', { text: 'go', guardPrompt: true }));
  assert.equal(r.status, 409);
  assert.equal(r.code, 'prompting');
  assert.deepEqual(r.result, { ok: false, skipped: 'prompting' });
  assert.equal(s.calls.length, 0);
  // without guardPrompt it types
  r = await s.go(env('send-text', 'agent-1', { text: 'go' }));
  assert.equal(r.ok, true);

  s = setup({ sessions: { 'agent-1': { name: 'agent-1', paneId: '%1', state: 'idle', awaitingApproval: { id: 'a' } } } });
  r = await s.go(env('send-text', 'agent-1', { text: 'go', guardPrompt: true }));
  assert.equal(r.code, 'prompting');

  s = setup({ readiness: 'dialog' });
  r = await s.go(env('send-text', 'agent-1', { text: 'go', guardPrompt: true }));
  assert.equal(r.code, 'prompting');

  s = setup({ readiness: 'ready' });
  r = await s.go(env('send-text', 'agent-1', { text: 'go', guardPrompt: true }));
  assert.equal(r.ok, true);
});

test('broadcast is refused on a builder', async () => {
  const s = setup();
  const r = await s.go(env('broadcast', '*', { targets: [`${BID}/agent-1`], text: 'x', confirmCount: 1 }));
  assert.equal(r.status, 400);
  assert.equal(r.code, 'hub_only');
  assert.ok(!('broadcast' in tiers()));
});

test('launch: repo not in repoNames, test-only fields, bypassPermissions -> 400', async () => {
  const s = setup();
  const base = { repo: 'acme', plan: 'docs/plans/l.md' };
  for (const args of [
    { ...base, repo: 'other' },
    { ...base, fakeTakenSlots: [2] },
    { ...base, localBranch: true },
    { ...base, promptOverride: 'x' },
    { ...base, permissionMode: 'bypassPermissions' },
    { ...base, plan: '../etc/passwd' },
    { repo: 'acme' },
  ]) {
    const r = await s.go(env('launch', 'lane-1', args));
    assert.equal(r.status, 400, JSON.stringify(args));
    assert.equal(r.code, 'bad_args', JSON.stringify(args));
  }
  const bad = await s.go(env('launch', 'Bad Lane', base));
  assert.equal(bad.code, 'bad_target');
  assert.equal(s.calls.length, 0);
});

test('spawn: dir outside dirRoots, through a symlink, relative, missing -> 400; bypassPermissions refused', async () => {
  const s = setup();
  for (const dir of [outside, path.join(root, 'sneaky'), 'code/acme', path.join(root, 'nope'), `${root}/../elsewhere`]) {
    const r = await s.go(env('spawn', 'new-one', { dir }));
    assert.equal(r.status, 400, dir);
    assert.equal(r.code, 'bad_args', dir);
  }
  let r = await s.go(env('spawn', 'new-one', { dir: repoDir, permissionMode: 'bypassPermissions' }));
  assert.equal(r.code, 'bad_args');
  assert.equal(s.calls.length, 0);
  r = await s.go(env('spawn', 'new-one', { dir: `${root}/./acme`, permissionMode: 'plan', slot: 2 }));
  assert.equal(r.ok, true, r.error);
  assert.equal(s.calls[0][1].dir, fs.realpathSync(repoDir));
  assert.equal(s.calls[0][1].name, 'new-one');
  // allowedPermissionModes can opt in
  s.config.fleet.allowedPermissionModes = ['default', 'bypassPermissions'];
  r = await s.go(env('spawn', 'new-two', { dir: repoDir, permissionMode: 'bypassPermissions' }));
  assert.equal(r.ok, true, r.error);
});

test('resolveSpawnDir accepts a root itself and refuses without roots', async () => {
  assert.equal(await resolveSpawnDir(root, [root]), fs.realpathSync(root));
  await assert.rejects(resolveSpawnDir(root, []), ActionRefused);
  await assert.rejects(resolveSpawnDir(`${root}-x`, [root]), ActionRefused);
});

test('rate limit: 429 after the configured count with retryAfterMs, audited', async () => {
  const s = setup({ rules: { kill: { limit: 2, windowMs: 60000 } } });
  for (let i = 0; i < 2; i++) assert.equal((await s.go(env('kill', 'agent-1', { confirm: 'agent-1' }))).ok, true);
  const r = await s.go(env('kill', 'agent-1', { confirm: 'agent-1' }));
  assert.equal(r.status, 429);
  assert.equal(r.code, 'rate_limited');
  assert.ok(r.retryAfterMs > 0);
  assert.equal(s.calls.length, 2);
  assert.equal(entries(s.audit).at(-1).result.code, 'rate_limited');
});

test('unknown session -> 404, bad session name -> 400, unknown action -> 400', async () => {
  const s = setup();
  assert.equal((await s.go(env('send-keys', 'ghost', { keys: ['a'] }))).status, 404);
  assert.equal((await s.go(env('send-keys', 'bad/name', { keys: ['a'] }))).code, 'bad_target');
  const u = await s.go(env('frobnicate', 'agent-1', {}));
  assert.equal(u.status, 400);
  assert.equal(u.code, 'unknown_action');
});

test('envelope shape: v, id, builder, args, ts', async () => {
  const s = setup();
  const cases = [
    { v: 2 }, { id: 'not-a-uuid' }, { builder: 'builder-b' }, { args: [1] }, { ts: 'now' }, { via: 'carrier' }, { target: 5 },
  ];
  for (const c of cases) {
    const r = await s.go(env('send-keys', 'agent-1', { keys: ['a'] }, c));
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.equal(r.code, 'bad_envelope', JSON.stringify(c));
  }
  assert.equal((await s.go(null)).code, 'bad_envelope');
  assert.equal(s.calls.length, 0);
  assert.equal(entries(s.audit).length, cases.length + 1);
});

test('args type checks: send-keys key format and count, text length, __proto__ key', async () => {
  const s = setup();
  for (const args of [
    { keys: [] }, { keys: Array(21).fill('a') }, { keys: ['a b'] }, { keys: ['x'.repeat(17)] }, { keys: 'Enter' },
  ]) assert.equal((await s.go(env('send-keys', 'agent-1', args))).code, 'bad_args', JSON.stringify(args));
  for (const args of [{ text: '' }, { text: 'x'.repeat(8001) }, { text: 'x', enter: 'yes' }, { text: 'x', fanout: { parent: 'nope' } }, { text: 'x', fanout: { parent: crypto.randomUUID(), more: 1 } }]) {
    assert.equal((await s.go(env('send-text', 'agent-1', args))).code, 'bad_args', JSON.stringify(args).slice(0, 60));
  }
  const proto = JSON.parse('{"text":"x","__proto__":{"enter":false}}');
  const r = await s.go(env('send-text', 'agent-1', proto));
  assert.equal(r.code, 'bad_args');
  assert.equal(s.calls.length, 0);
  assert.ok(r.auditId, 'still audited');
});

test('run gets a private copy: mutating the envelope after dispatch starts changes nothing', async () => {
  const s = setup();
  let seen;
  registerAction('probe', {
    tier: 'click', target: 'session', args: { list: { type: 'array', items: { type: 'string', max: 3 } } },
    run: async ({ args }) => { await new Promise((r) => setImmediate(r)); seen = args.list.slice(); return { ok: true }; },
  });
  const e = env('probe', 'agent-1', { list: ['a'] });
  const p = s.go(e);
  e.args.list.push('toolong');
  await p;
  assert.deepEqual(seen, ['a']);
});

test('every authenticated outcome lands exactly one audit entry (ok, refused, thrown)', async () => {
  const s = setup();
  registerAction('boom', { tier: 'click', target: 'session', run: async () => { throw new Error('secret internals'); } });
  registerAction('lane-err', { tier: 'click', target: 'session', run: async () => { const e = new Error('lane busy'); e.status = 409; throw e; } });
  const outs = [];
  outs.push(await s.go(env('send-keys', 'agent-1', { keys: ['a'] })));
  outs.push(await s.go(env('kill', 'agent-1', {})));
  outs.push(await s.go(env('boom', 'agent-1', {})));
  outs.push(await s.go(env('lane-err', 'agent-1', {})));
  assert.deepEqual(outs.map((o) => [o.ok, o.status]), [[true, 200], [false, 400], [false, 500], [false, 409]]);
  assert.equal(outs[2].error, 'internal error', 'unknown errors do not leak');
  assert.equal(outs[3].error, 'lane busy');
  const e = entries(s.audit);
  assert.equal(e.length, 4);
  assert.deepEqual(e.map((x) => x.hash), outs.map((o) => o.auditId));
  assert.deepEqual(e.map((x) => x.action), ['send-keys', 'kill', 'boom', 'lane-err']);
  assert.equal(e[0].user, 'alice@example.invalid');
  assert.equal(e[0].via, 'direct');
  assert.equal(e[0].builder, BID);
  assert.equal(e[0].target, 'agent-1');
  assert.ok(!JSON.stringify(e).includes('"keys"'), 'args are hashed, not stored');
  assert.equal(s.audit.verifyAll().ok, true);
});

test('an audit failure does not mask the outcome', async () => {
  const s = setup();
  const r = await dispatch(env('send-keys', 'agent-1', { keys: ['a'] }), {
    auth: { kind: 'direct', user: 'u' }, deps: s.deps, limiter: s.limiter,
    audit: { append() { throw new Error('disk full'); } },
  });
  assert.equal(r.ok, true);
  assert.equal(r.auditId, null);
  await assert.rejects(dispatch(env('send-keys', 'agent-1', {}), { deps: s.deps, audit: s.audit }), TypeError);
});

test('hub mode: every action needs a direct user', async () => {
  const s = setup({ mode: 'hub' });
  const r = await s.go(env('send-keys', 'agent-1', { keys: ['a'] }), LOCAL);
  assert.equal(r.code, 'remote-only');
});

test('registerAction validates definitions', () => {
  setup();
  const run = async () => ({});
  assert.throws(() => registerAction('send-text', { tier: 'click', target: 'session', run }), /already/);
  assert.throws(() => registerAction('x1', { tier: 'nope', target: 'session', run }), /tier/);
  assert.throws(() => registerAction('x2', { tier: 'click', target: 'galaxy', run }), /target/);
  assert.throws(() => registerAction('x3', { tier: 'confirm', target: 'session', run }), /confirm/);
  assert.throws(() => registerAction('x4', { tier: 'click', target: 'session-or-all', run }), /confirm/);
  assert.throws(() => registerAction('x5', { tier: 'click', target: 'session', args: { a: { type: 'blob' } }, run }), /type/);
  assert.throws(() => registerAction('x6', { tier: 'click', target: 'session', bogus: 1, run }), /unknown key/);
  assert.throws(() => registerAction('x7', { tier: 'click', target: 'session', remoteOnly: 'yes', run }), /remoteOnly/);
  assert.throws(() => registerAllHandler('kill', 'nope'), TypeError);
  registerAllHandler('kill', run);
  assert.throws(() => registerAllHandler('kill', run), /already/);
});

test('registerBuiltins is idempotent and dispatch-time deps win', async () => {
  const s = setup();
  assert.deepEqual(registerBuiltins(s.deps), []);
  const other = [];
  const deps2 = { ...s.deps, actions: { ...s.deps.actions, sendKeys: async (...a) => { other.push(a); return { ok: true }; } } };
  const r = await dispatch(env('send-keys', 'agent-1', { keys: ['a'] }), { auth: { kind: 'direct', user: 'u' }, deps: deps2, audit: s.audit, limiter: s.limiter });
  assert.equal(r.ok, true);
  assert.equal(other.length, 1);
  assert.equal(s.calls.length, 0);
});
