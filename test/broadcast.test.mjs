// Broadcast planner + hub broadcast action (fleet plan §8 2.4, task C8).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as server from '../server/control/broadcast.mjs';
import * as client from '../public/js/core/broadcast-plan.js';
import { createBroadcast, sessionsFromView, planHashOf, auditSummary, REFUSAL_LIMIT } from '../server/hub/broadcast.mjs';
import hubModule, { createModule } from '../server/hub/routes/broadcast.mjs';
import { createRelay, _resetHubActions } from '../server/hub/relay.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { fakeBuilder, hubSigner } from './helpers/fake-builder.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const USER = 'alice@example.invalid';
const { BROADCAST_LIMITS, planBroadcast, validateBroadcast, checkConfirm, typedText, previewBroadcast } = server;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-broadcast-'));
const fakes = [];
let auditN = 0;
after(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- shared vectors: the server and client copies must agree ---------------------------------------------

const S = (over) => ({ name: 'x', kind: 'claude', state: 'idle', paused: null, awaitingApproval: null, previewLines: ['❯ '], ...over });
const SESSIONS = {
  'builder-a/idle': S({ state: 'idle' }),
  'builder-a/work': S({ state: 'working' }),
  'builder-a/done': S({ state: 'done' }),
  'builder-a/perm': S({ state: 'waiting_permission' }),
  'builder-a/question': S({ state: 'waiting_question' }),
  'builder-a/held': S({ state: 'idle', awaitingApproval: 'appr-1' }),
  'builder-a/dialog': S({ state: 'idle', previewLines: ['\u001b[1mDo you want to make this edit?\u001b[0m', '❯ 1. Yes'] }),
  'builder-a/trust': S({ state: 'idle', previewLines: ['Is this a project you created or one you trust?'] }),
  'builder-a/paused': S({ state: 'idle', paused: { scope: 'session', kind: 'operator' } }),
  'builder-a/dead': S({ state: 'dead' }),
  'builder-a/shell': S({ state: 'shell', kind: 'shell' }),
  'builder-a/weird': S({ state: 'something-new' }),
  'builder-b/web': S({ state: 'idle' }),
};
const UP = (id) => id === 'builder-a';

const VECTORS = [
  { targets: ['builder-a/idle', 'builder-a/work', 'builder-a/done'], send: ['builder-a/idle', 'builder-a/work', 'builder-a/done'], skip: [] },
  { targets: ['builder-a/perm'], send: [], skip: [['builder-a/perm', 'prompting']] },
  { targets: ['builder-a/question'], send: [], skip: [['builder-a/question', 'prompting']] },
  { targets: ['builder-a/held'], send: [], skip: [['builder-a/held', 'prompting']] },
  { targets: ['builder-a/dialog'], send: [], skip: [['builder-a/dialog', 'prompting']] },
  { targets: ['builder-a/trust'], send: [], skip: [['builder-a/trust', 'prompting']] },
  { targets: ['builder-a/paused'], send: [], skip: [['builder-a/paused', 'paused']] },
  { targets: ['builder-a/dead', 'builder-a/shell'], send: [], skip: [['builder-a/dead', 'dead'], ['builder-a/shell', 'shell']] },
  { targets: ['builder-a/nope'], send: [], skip: [['builder-a/nope', 'unknown']] },
  { targets: ['builder-a/weird'], send: [], skip: [['builder-a/weird', 'unknown']] },
  { targets: ['builder-b/web'], send: [], skip: [['builder-b/web', 'builder-down']] },
  { targets: ['builder-a/idle', 'builder-a/idle'], send: ['builder-a/idle'], skip: [['builder-a/idle', 'duplicate']] },
  { targets: ['nofkey', 'builder-a/_laneboard-x', 'Builder/x'], send: [], skip: [['nofkey', 'invalid'], ['builder-a/_laneboard-x', 'invalid'], ['Builder/x', 'invalid']] },
  { targets: ['builder-a/perm', 'builder-a/idle', 'builder-a/held', 'builder-a/work'], send: ['builder-a/idle', 'builder-a/work'], skip: [['builder-a/perm', 'prompting'], ['builder-a/held', 'prompting']] },
];

test('client file is a byte-identical copy of the server planner', () => {
  const a = fs.readFileSync(path.join(ROOT, 'server/control/broadcast.mjs'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'public/js/core/broadcast-plan.js'), 'utf8');
  assert.equal(a, b);
  assert.doesNotMatch(a, /^\s*import\s/m, 'the planner is a pure module with no imports');
});

test('planBroadcast: skips prompting, awaitingApproval, dialogs, paused, dead, shell, unknown, builder-down (both copies)', () => {
  for (const impl of [server, client]) {
    for (const v of VECTORS) {
      const plan = impl.planBroadcast(v.targets, SESSIONS, { builderUp: UP });
      assert.deepEqual(plan.send, v.send, JSON.stringify(v.targets));
      assert.deepEqual(plan.skip, v.skip.map(([key, reason]) => ({ key, reason })), JSON.stringify(v.targets));
    }
    // A Map works the same as a plain object.
    const m = new Map(Object.entries(SESSIONS));
    assert.deepEqual(impl.planBroadcast(['builder-a/idle', 'builder-a/perm'], m), { send: ['builder-a/idle'], skip: [{ key: 'builder-a/perm', reason: 'prompting' }] });
    // Prototype keys are not sessions.
    assert.deepEqual(impl.planBroadcast(['builder-a/constructor'], {}).skip, [{ key: 'builder-a/constructor', reason: 'unknown' }]);
  }
});

test('validateBroadcast: caps, shapes and the rate limit (both copies)', () => {
  const ok = { targets: ['builder-a/idle'], text: 'run the tests', confirmCount: 1 };
  const cases = [
    [ok, null, 0, null],
    [{ ...ok, targets: [] }, null, 0, 'bad-targets'],
    [{ ...ok, targets: 'builder-a/idle' }, null, 0, 'bad-targets'],
    [{ ...ok, targets: Array.from({ length: 31 }, (_, i) => `builder-a/s${i}`) }, null, 0, 'too-many-targets'],
    [{ ...ok, targets: Array.from({ length: 30 }, (_, i) => `builder-a/s${i}`) }, null, 0, null],
    [{ ...ok, targets: ['../etc'] }, null, 0, 'bad-targets'],
    [{ ...ok, text: '' }, null, 0, 'bad-text'],
    [{ ...ok, text: '\u001b\u0003' }, null, 0, 'bad-text'],
    [{ ...ok, text: 7 }, null, 0, 'bad-text'],
    [{ ...ok, text: 'x'.repeat(2001) }, null, 0, 'text-too-long'],
    [{ ...ok, text: 'x'.repeat(2000) }, null, 0, null],
    [{ ...ok, enter: 'yes' }, null, 0, 'bad-enter'],
    [{ ...ok, confirmCount: 0 }, null, 0, 'bad-confirm'],
    [{ ...ok, confirmCount: '1' }, null, 0, 'bad-confirm'],
    [{ ...ok, confirmCount: 1.5 }, null, 0, 'bad-confirm'],
    [ok, 1000, 1000 + 9999, 'rate-limited'],
    [ok, 1000, 1000 + 10_000, null],
  ];
  for (const impl of [server, client]) {
    for (const [args, lastAt, now, want] of cases) assert.equal(impl.validateBroadcast(args, lastAt, now), want, JSON.stringify([args.text?.length, args.confirmCount, lastAt, now]));
  }
  assert.equal(BROADCAST_LIMITS.maxTargets, 30);
  assert.equal(BROADCAST_LIMITS.maxText, 2000);
  assert.equal(BROADCAST_LIMITS.minIntervalMs, 10_000);
});

test('checkConfirm requires EQUALITY with the planned sends', () => {
  const plan = { send: ['builder-a/a', 'builder-a/b'], skip: [{ key: 'builder-a/c', reason: 'prompting' }] };
  assert.equal(checkConfirm(plan, 2), null);
  assert.equal(checkConfirm(plan, 3), 'confirm-mismatch'); // ≤ targets, but not the plan
  assert.equal(checkConfirm(plan, 1), 'confirm-mismatch');
  assert.equal(checkConfirm({ send: [], skip: [] }, 1), 'nothing-to-send');
});

test('typedText matches the dispatcher cleanTypedText; preview is idempotent', async () => {
  const { cleanTypedText } = await import('../server/fleet/dispatch.mjs');
  const samples = ['plain', 'a\r\nb\rc', 'esc\u001b[31mred', 'tab\tok', '\u0003ctrl-c', 'del\u007f c1\u0085', 'multi\nline\n', ''];
  for (const s of samples) {
    for (const enter of [true, false, undefined]) {
      assert.equal(typedText(s, enter), cleanTypedText(s, enter), JSON.stringify([s, enter]));
      assert.equal(client.typedText(s, enter), cleanTypedText(s, enter));
      assert.equal(cleanTypedText(typedText(s, enter), enter), typedText(s, enter), 'the builder re-cleans to the same text');
    }
  }
  assert.deepEqual(previewBroadcast('a\r\nb\u001b', true), { text: 'a\nb', enter: true, chars: 3, lines: 2 });
  assert.deepEqual(previewBroadcast('a\nb', false), { text: 'a b', enter: false, chars: 3, lines: 1 });
});

// --- hub action, unit (stub ctx) ---------------------------------------------------------------------------

function view(builders) {
  return {
    now: 0,
    builders: builders.map(({ id, up = true, sessions = {} }) => ({
      id, state: up ? 'up' : 'down', controls: up,
      snap: { sessions: new Map(Object.entries(sessions).map(([n, s]) => [n, { name: n, ...s }])) },
    })),
  };
}

function stubCtx(v, { reply } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      user: USER,
      id: crypto.randomUUID(),
      view: v,
      send: async (b, act, tgt, args) => {
        calls.push({ b, act, tgt, args });
        return reply ? reply(b, tgt) : { ok: true, status: 200, builder: b };
      },
    },
  };
}

const V1 = () => view([
  { id: 'builder-a', sessions: { web: S({}), api: S({ state: 'waiting_permission' }), docs: S({ state: 'working' }) } },
  { id: 'builder-b', up: false, sessions: { ops: S({}) } },
]);
const REQ = (args) => ({ builder: '*', action: 'broadcast', target: '*', args });
/** args plus the planHash the hub would return for this view (what the UI echoes after the 409 plan). */
const H = (v, args) => {
  const { sessions, builderUp } = sessionsFromView(v, args.targets);
  const plan = planBroadcast(args.targets, sessions, { builderUp });
  return { ...args, planHash: planHashOf(plan, previewBroadcast(args.text, args.enter ?? true)) };
};
/** The UI flow through the relay: a first call returns the 409 plan, the confirmed call echoes its planHash. */
async function confirmVia(relay, body, user) {
  const p = await relay.relay(body, user);
  assert.equal(p.status, 409, JSON.stringify(p));
  assert.match(p.result.planHash, /^[0-9a-f]{64}$/);
  return relay.relay({ ...body, args: { ...body.args, planHash: p.result.planHash } }, user);
}
const T3 = ['builder-a/web', 'builder-a/api', 'builder-a/docs', 'builder-b/ops'];

test('sessionsFromView reads the hub store view; builder-down from controls', () => {
  const { sessions, builderUp } = sessionsFromView(V1(), T3);
  assert.equal(sessions.get('builder-a/web').state, 'idle');
  assert.equal(builderUp('builder-a'), true);
  assert.equal(builderUp('builder-b'), false);
  assert.equal(builderUp('builder-c'), false);
});

test('hub broadcast: confirmCount mismatch -> 409 with the fresh plan and preview, nothing sent, no stamp', async () => {
  let t = 100_000;
  const bc = createBroadcast({ now: () => t });
  const { ctx, calls } = stubCtx(V1());
  // 4 targets, 2 planned: typing 4 (≤ targets) is still refused.
  for (const n of [4, 3, 1]) {
    const r = await bc.run(REQ(H(V1(), { targets: T3, text: 'go on\r\n', confirmCount: n })), ctx);
    assert.equal(r.status, 409);
    assert.equal(r.error, 'confirm-mismatch');
    assert.deepEqual(r.result.plan.send, ['builder-a/web', 'builder-a/docs']);
    assert.deepEqual(r.result.plan.skip, [{ key: 'builder-a/api', reason: 'prompting' }, { key: 'builder-b/ops', reason: 'builder-down' }]);
    assert.equal(r.result.confirmCount, 2);
    assert.equal(r.result.preview.text, 'go on\n');
    assert.equal(r.result.planHash, H(V1(), { targets: T3, text: 'go on\r\n' }).planHash);
  }
  assert.equal(calls.length, 0);
  assert.equal(bc.lastAt(USER), null);
  // Nothing sendable at all -> 409 nothing-to-send.
  const r = await bc.run(REQ({ targets: ['builder-a/api'], text: 'x', confirmCount: 1 }), ctx);
  assert.equal(r.status, 409);
  assert.equal(r.error, 'nothing-to-send');
  assert.match(r.result.planHash, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 0);
});

test('hub broadcast: sends guarded send-text per planned target with fanout parent; rate limited per user', async () => {
  let t = 100_000;
  const bc = createBroadcast({ now: () => t });
  const { ctx, calls } = stubCtx(V1());
  const r = await bc.run(REQ(H(V1(), { targets: T3, text: 'status?\u001b[2J', confirmCount: 2 })), ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, 200);
  assert.deepEqual(r.result.sent, ['builder-a/web', 'builder-a/docs']);
  assert.deepEqual(r.result.skipped.map((s) => s.key), ['builder-a/api', 'builder-b/ops']);
  assert.deepEqual(r.result.failed, []);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.act, 'send-text');
    assert.equal(c.b, 'builder-a');
    assert.deepEqual(c.args, { text: 'status?[2J', enter: true, guardPrompt: true, fanout: { parent: ctx.id } });
  }
  assert.deepEqual(calls.map((c) => c.tgt), ['web', 'docs']);
  // Rate limit: a second broadcast within 10 s -> 429, nothing sent.
  t += 9_000;
  const r2 = await bc.run(REQ({ targets: ['builder-a/web'], text: 'again', confirmCount: 1 }), ctx);
  assert.equal(r2.status, 429);
  assert.equal(r2.error, 'rate-limited');
  assert.equal(r2.retryAfterMs, 1000);
  assert.equal(calls.length, 2);
  // Another user is not limited by alice's broadcast.
  const other = stubCtx(V1());
  other.ctx.user = 'bob@example.invalid';
  assert.equal((await bc.run(REQ(H(V1(), { targets: ['builder-a/web'], text: 'hi', confirmCount: 1 })), other.ctx)).ok, true);
  t += 1_000;
  assert.equal((await bc.run(REQ(H(V1(), { targets: ['builder-a/web'], text: 'again', confirmCount: 1 })), ctx)).ok, true);
});

test('hub broadcast: concurrent requests from one user cannot both pass the rate limit', async () => {
  const bc = createBroadcast({ now: () => 5_000_000 });
  const { ctx } = stubCtx(V1());
  const [a, b] = await Promise.all([
    bc.run(REQ(H(V1(), { targets: ['builder-a/web'], text: 'one', confirmCount: 1 })), ctx),
    bc.run(REQ(H(V1(), { targets: ['builder-a/web'], text: 'two', confirmCount: 1 })), ctx),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
});

test('hub broadcast: strict request shape, caps, local user refused', async () => {
  const bc = createBroadcast({ now: () => 1 });
  const { ctx, calls } = stubCtx(V1());
  const good = { targets: ['builder-a/web'], text: 'x', confirmCount: 1 };
  const bad = [
    [{ ...REQ(good), target: 'web' }, 400, 'bad-target'],
    [{ ...REQ(good), builder: 'builder-a' }, 400, 'bad-builder'],
    [REQ({ ...good, extra: 1 }), 400, 'bad-args'],
    [REQ({ ...good, targets: Array.from({ length: 31 }, (_, i) => `builder-a/s${i}`) }), 400, 'too-many-targets'],
    [REQ({ ...good, text: 'x'.repeat(2001) }), 400, 'text-too-long'],
    [REQ({ ...good, confirmCount: '1' }), 400, 'bad-confirm'],
    [REQ({ ...good, planHash: 'A'.repeat(64) }), 400, 'bad-plan-hash'],
    [REQ({ ...good, planHash: 7 }), 400, 'bad-plan-hash'],
    [REQ(null), 400, 'bad-args'],
  ];
  for (const [req, status, error] of bad) {
    const r = await bc.run(req, ctx);
    assert.equal(r.status, status, JSON.stringify(req));
    assert.equal(r.error, error);
  }
  for (const user of ['local', '', null]) {
    const r = await bc.run(REQ(good), { ...ctx, user });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'remote-only');
  }
  assert.equal(calls.length, 0);
});

test('hub broadcast: builder-side 409 prompting lands in skipped; other errors in failed', async () => {
  const bc = createBroadcast({ now: () => 1 });
  const v = view([{ id: 'builder-a', sessions: { web: S({}), api: S({}), docs: S({}) } }]);
  const { ctx } = stubCtx(v, {
    reply: (b, tgt) => (tgt === 'web' ? { ok: false, status: 409, error: 'the session is prompting', code: 'prompting' }
      : tgt === 'api' ? { ok: false, status: 504, error: 'timeout', outcome: 'unknown' }
        : { ok: true, status: 200 }),
  });
  const r = await bc.run(REQ(H(v, { targets: ['builder-a/web', 'builder-a/api', 'builder-a/docs'], text: 'x', confirmCount: 3 })), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.status, 200);
  assert.deepEqual(r.result.sent, ['builder-a/docs']);
  assert.deepEqual(r.result.skipped, [{ key: 'builder-a/web', reason: 'prompting' }]);
  assert.deepEqual(r.result.failed, [{ key: 'builder-a/api', error: 'timeout', outcome: 'unknown' }]);
});

test('hub broadcast: fan-out concurrency is at most 6', async () => {
  const bc = createBroadcast({ now: () => 1 });
  const sessions = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, S({})]));
  const v = view([{ id: 'builder-a', sessions }]);
  let live = 0;
  let peak = 0;
  const ctx = {
    user: USER, id: crypto.randomUUID(), view: v,
    send: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { ok: true }; },
  };
  const r = await bc.run(REQ(H(v, { targets: Object.keys(sessions).map((n) => `builder-a/${n}`), text: 'x', confirmCount: 20 })), ctx);
  assert.equal(r.result.sent.length, 20);
  assert.ok(peak <= 6 && peak > 1, String(peak));
});

// --- end to end: relay + fake builders running the real builder dispatcher ---------------------------------

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const signer = hubSigner(privateKey);
const HUB_KEYS = [{ key: signer.publicKey, id: 'hub', scopes: ['read', 'control'] }];

/**
 * A fake builder whose /api/v1/actions runs the real dispatcher + built-in send-text against `local` (the
 * builder's own, current state), with stubbed tmux deps that record what would be typed.
 */
async function realishBuilder(id, hubSessions, localSessions) {
  const { dispatch, _reset } = await import('../server/fleet/dispatch.mjs');
  const { registerBuiltins, _resetBuiltins } = await import('../server/fleet/builtin-actions.mjs');
  _reset();
  _resetBuiltins();
  const typed = [];
  const local = new Map(Object.entries(localSessions).map(([n, s]) => [n, { name: n, paneId: '%1', kind: 'claude', paneCmd: 'claude', ...s }]));
  const deps = {
    config: { mode: 'builder', fleet: { id, hubControl: true }, repoNames: [], dirRoots: [] },
    actions: { sendText: async (name, text, enter) => { typed.push({ name, text, enter }); return { ok: true }; } },
    state: { get: (n) => local.get(n) ?? null, all: () => [...local.values()], promptReadiness: () => 'ready' },
    capturePane: async () => ['❯ '],
  };
  registerBuiltins(deps);
  const audit = openAudit({ file: path.join(tmp, `builder-audit-${auditN++}.jsonl`), builder: id });
  const fb = await fakeBuilder({
    id,
    hubKeys: HUB_KEYS,
    sessions: Object.entries(hubSessions).map(([name, s]) => ({ name, ...s })),
    // The fake verifies the envelope signature before onAction runs (it throws otherwise), so reaching here as
    // `hub` means verified, as auth.verifyEnvelope would report to the real dispatcher.
    onAction: async (envelope, info) => {
      const auth = { kind: info.kind, scopes: new Set(['read', 'control']), keyLabel: 'hub', verified: info.kind === 'hub' };
      const out = await dispatch(envelope, { auth, deps, audit });
      return { status: out.status ?? (out.ok ? 200 : 500), body: out };
    },
  });
  fakes.push(fb);
  return { fb, typed, local };
}

function hubSetup(fbs, { down = [] } = {}) {
  const builders = fbs.map((fb) => ({ id: fb.id, url: fb.url }));
  const store = createFleetStore({ builders, hubVersion: '0.1.0' });
  const t = Date.now();
  for (const fb of fbs) {
    store.setConn(fb.id, { state: down.includes(fb.id) ? 'down' : 'up', lastSeen: t, latencyMs: 5, hello: fb.hello });
    store.applySnapshot(fb.id, fb.snapshot(), t);
  }
  const file = path.join(tmp, `hub-audit-${auditN++}.jsonl`);
  const audit = openAudit({ file });
  const relay = createRelay({ store, key: privateKey, audit, cfg: { actionTimeoutMs: 3000 } });
  const lines = () => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { relay, store, lines };
}

beforeEach(() => _resetHubActions());

test('e2e: hub plans, skips prompting lanes, builder guardPrompt refuses a lane the stale hub view thought idle', async () => {
  const { fb, typed } = await realishBuilder('builder-a',
    // what the hub sees (up to 15 s stale)
    { web: { kind: 'claude', state: 'idle' }, api: { kind: 'claude', state: 'waiting_permission' }, docs: { kind: 'claude', state: 'done' } },
    // the builder's own current state: docs has just raised a permission prompt
    { web: { state: 'idle' }, api: { state: 'waiting_permission' }, docs: { state: 'waiting_permission' } });
  const { relay, lines } = hubSetup([fb]);
  const mod = createModule();
  await mod.register({ relay });
  const body = { builder: '*', action: 'broadcast', target: '*', args: { targets: ['builder-a/web', 'builder-a/api', 'builder-a/docs'], text: 'please rebase', confirmCount: 3 } };

  // The first call (no planHash) answers 409 plan-required with the plan and its planHash.
  let r = await relay.relay(body, { kind: 'direct', user: USER });
  assert.equal(r.status, 409, JSON.stringify(r));
  assert.equal(r.error, 'plan-required');
  assert.deepEqual(r.result.plan.send, ['builder-a/web', 'builder-a/docs']);
  const planHash = r.result.planHash;
  // 3 targets but only 2 planned: confirmCount 3 is refused with the plan even with the right planHash.
  r = await relay.relay({ ...body, args: { ...body.args, planHash } }, { kind: 'direct', user: USER });
  assert.equal(r.status, 409, JSON.stringify(r));
  assert.equal(r.error, 'confirm-mismatch');
  assert.equal(fb.actions.length, 0);

  r = await relay.relay({ ...body, args: { ...body.args, confirmCount: 2, planHash } }, { kind: 'direct', user: USER });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.result.sent, ['builder-a/web']);
  assert.deepEqual(r.result.skipped, [{ key: 'builder-a/api', reason: 'prompting' }, { key: 'builder-a/docs', reason: 'prompting' }]);
  assert.deepEqual(typed, [{ name: 'web', text: 'please rebase', enter: true }]);

  // One signed envelope per planned target, each with its own nonce, guardPrompt and the broadcast parent.
  assert.equal(fb.actions.length, 2);
  const ids = new Set(fb.actions.map((a) => a.envelope.id));
  assert.equal(ids.size, 2);
  for (const a of fb.actions) {
    assert.equal(a.verified, true);
    assert.equal(a.envelope.action, 'send-text');
    assert.equal(a.envelope.args.guardPrompt, true);
    assert.equal(a.envelope.args.fanout.parent, r.auditId);
  }
  // Hub audit: the broadcast itself (pending before it runs, done after) plus a sent/done pair per envelope.
  const hubLines = lines();
  const local = hubLines.filter((l) => l.action === 'broadcast' && l.id === r.auditId);
  assert.deepEqual(local.map((l) => [l.result.phase, l.result.local]), [['pending', true], ['outcome', true], ['done', true]]);
  assert.equal(local[2].result.ok, true);
  // SR18 L3: the outcome entry records the planned skips (reason per fkey) and the result summary, never the text.
  const o = local[1].result;
  assert.equal(o.targets, 3);
  assert.deepEqual(o.planned, { send: 2, skip: 1, skipReasons: { prompting: 1 }, skips: [{ key: 'builder-a/api', reason: 'prompting' }] });
  assert.deepEqual(o.sent, { n: 1, keys: ['builder-a/web'] });
  assert.deepEqual(o.skipped, { n: 2, reasons: { prompting: 2 }, keys: [{ key: 'builder-a/api', reason: 'prompting' }, { key: 'builder-a/docs', reason: 'prompting' }] });
  assert.deepEqual(o.failed, { n: 0, keys: [] });
  assert.equal(local[1].argsHash, local[0].argsHash);
  assert.doesNotMatch(JSON.stringify(local), /please rebase/);
  for (const id of ids) {
    const pair = hubLines.filter((l) => l.id === id).map((l) => l.result.phase);
    assert.deepEqual(pair, ['sent', 'done']);
  }
  mod.stop();
});

test('e2e: the hub-local broadcast from local -> 403 remote-only; never relayed; builder down skipped', async () => {
  const { fb } = await realishBuilder('builder-a', { web: { kind: 'claude', state: 'idle' } }, { web: { state: 'idle' } });
  const fb2 = await fakeBuilder({ id: 'builder-b', hubKeys: HUB_KEYS, sessions: [{ name: 'ops', kind: 'claude', state: 'idle' }] });
  fakes.push(fb2);
  const { relay } = hubSetup([fb, fb2], { down: ['builder-b'] });
  const mod = createModule();
  await mod.register({ relay });
  const body = { builder: null, action: 'broadcast', target: '*', args: { targets: ['builder-a/web', 'builder-b/ops'], text: 'hi', confirmCount: 1 } };
  for (const u of ['local', { kind: 'local', user: 'local' }, { kind: 'hub', user: USER }, null]) {
    const r = await relay.relay(body, u);
    assert.equal(r.status, 403);
    assert.equal(r.error, 'remote-only');
  }
  assert.equal(fb.actions.length, 0);
  // Directly sending `broadcast` to a builder is never possible through the relay.
  const s = await relay.send('builder-a', 'broadcast', '*', body.args, { kind: 'direct', user: USER });
  assert.equal(s.status, 400);
  assert.equal(s.error, 'not-relayable');
  const r = await confirmVia(relay, body, { kind: 'direct', user: USER });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.result.sent, ['builder-a/web']);
  assert.deepEqual(r.result.skipped, [{ key: 'builder-b/ops', reason: 'builder-down' }]);
  assert.equal(fb2.actions.length, 0);
  mod.stop();
});

test('the hub module is a valid hub-only module and registers through the global registry without a relay', async () => {
  assert.equal(hubModule.name, 'hub-broadcast');
  assert.deepEqual(hubModule.modes, ['hub']);
  const mod = createModule();
  await mod.register({});
  const { fb } = await realishBuilder('builder-a', { web: { kind: 'claude', state: 'idle' } }, { web: { state: 'idle' } });
  const { relay } = hubSetup([fb]);
  const r = await confirmVia(relay, { builder: '*', action: 'broadcast', target: '*', args: { targets: ['builder-a/web'], text: 'hi', confirmCount: 1 } }, { kind: 'direct', user: USER });
  assert.equal(r.status, 200, JSON.stringify(r));
  mod.stop();
  const r2 = await relay.relay({ builder: '*', action: 'broadcast', target: '*', args: { targets: ['builder-a/web'], text: 'hi', confirmCount: 1 } }, { kind: 'direct', user: USER });
  assert.equal(r2.status, 503);
});

// --- SR18 low findings -------------------------------------------------------------------------------------

test('SR18 L1: planHashInput binds the sorted lane list, the text hash and Enter (both copies)', () => {
  for (const impl of [server, client]) {
    const p = (send) => ({ send, skip: [] });
    const pv = { text: 'x', enter: true };
    assert.equal(impl.planHashInput(p(['builder-a/b', 'builder-a/a']), pv, 'h'), impl.planHashInput(p(['builder-a/a', 'builder-a/b']), pv, 'h'));
    assert.notEqual(impl.planHashInput(p(['builder-a/a', 'builder-a/b']), pv, 'h'), impl.planHashInput(p(['builder-a/a', 'builder-a/c']), pv, 'h'));
    assert.notEqual(impl.planHashInput(p(['builder-a/a']), pv, 'h'), impl.planHashInput(p(['builder-a/a']), pv, 'g'));
    assert.notEqual(impl.planHashInput(p(['builder-a/a']), pv, 'h'), impl.planHashInput(p(['builder-a/a']), { ...pv, enter: false }, 'h'));
    assert.ok(impl.PLAN_HASH_RE.test('0'.repeat(64)) && !impl.PLAN_HASH_RE.test('0'.repeat(63)));
  }
});

test('SR18 L1: a same-size but different lane set (or other text) under the previewed planHash -> 409 plan-changed, nothing sent', async () => {
  const bc = createBroadcast({ now: () => 1 });
  const targets = ['builder-a/a', 'builder-a/b', 'builder-a/c', 'builder-a/d'];
  // Previewed: a, b, c sendable; d prompting.
  const seen = view([{ id: 'builder-a', sessions: { a: S({}), b: S({}), c: S({}), d: S({ state: 'waiting_permission' }) } }]);
  const args = H(seen, { targets, text: 'go', confirmCount: 3 });
  // Now: c prompting, d idle -> {a, b, d}, still 3.
  const now = view([{ id: 'builder-a', sessions: { a: S({}), b: S({}), c: S({ state: 'waiting_permission' }), d: S({}) } }]);
  const { ctx, calls } = stubCtx(now);
  const r = await bc.run(REQ(args), ctx);
  assert.equal(r.status, 409);
  assert.equal(r.error, 'plan-changed');
  assert.deepEqual(r.result.plan.send, ['builder-a/a', 'builder-a/b', 'builder-a/d']);
  assert.equal(r.result.confirmCount, 3);
  assert.equal(r.result.planHash, H(now, { targets, text: 'go' }).planHash);
  assert.notEqual(r.result.planHash, args.planHash);
  // The same lanes with different text, or with enter:false, do not match either.
  const { ctx: c2, calls: calls2 } = stubCtx(seen);
  assert.equal((await bc.run(REQ({ ...args, text: 'go!' }), c2)).error, 'plan-changed');
  assert.equal((await bc.run(REQ({ ...args, enter: false }), c2)).error, 'plan-changed');
  assert.equal(calls.length + calls2.length, 0);
  assert.equal(bc.lastAt(USER), null);
  // Echoing the fresh planHash sends to the fresh set.
  const ok = await bc.run(REQ({ ...args, planHash: r.result.planHash }), ctx);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.result.sent, ['builder-a/a', 'builder-a/b', 'builder-a/d']);
});

test('SR18 L3: the outcome audit entry carries planned skips and the result summary, bounded under 4 KiB', async () => {
  const bc = createBroadcast({ now: () => 1 });
  const v = view([{ id: 'builder-a', sessions: { web: S({}), api: S({}), docs: S({}), held: S({ state: 'idle', awaitingApproval: 'x' }) } }]);
  const appended = [];
  const { ctx } = stubCtx(v, {
    reply: (b, tgt) => (tgt === 'api' ? { ok: false, status: 409, code: 'not_claude', error: 'not a live claude session' }
      : tgt === 'docs' ? { ok: false, status: 409, code: 'paused', error: 'paused' } : { ok: true }),
  });
  ctx.audit = { append: (e) => { appended.push(e); return e; } };
  const targets = ['builder-a/web', 'builder-a/api', 'builder-a/docs', 'builder-a/held', 'builder-a/gone'];
  const r = await bc.run(REQ(H(v, { targets, text: 'secret text', confirmCount: 3 })), ctx);
  assert.equal(r.status, 200);
  // R7-fix behaviour kept: only `prompting` is a skip; not_claude / paused from the builder are failures.
  assert.deepEqual(r.result.failed.map((f) => f.key), ['builder-a/api', 'builder-a/docs']);
  assert.equal(appended.length, 1);
  const e = appended[0];
  assert.equal(e.id, ctx.id);
  assert.equal(e.action, 'broadcast');
  assert.equal(e.user, USER);
  assert.equal(e.result.phase, 'outcome');
  assert.equal(e.result.targets, 5);
  assert.deepEqual(e.result.planned.skips, [{ key: 'builder-a/held', reason: 'prompting' }, { key: 'builder-a/gone', reason: 'unknown' }]);
  assert.deepEqual(e.result.planned.skipReasons, { prompting: 1, unknown: 1 });
  assert.deepEqual(e.result.sent, { n: 1, keys: ['builder-a/web'] });
  assert.equal(e.result.failed.n, 2);
  assert.doesNotMatch(JSON.stringify(e.result), /secret text/);

  // Worst case: 30 long keys, long errors -> counts kept, first-N shrunk to fit; the real audit accepts it.
  const long = (i) => `builder-a/${'n'.repeat(60)}${String(i).padStart(4, '0')}`;
  const keys = Array.from({ length: 30 }, (_, i) => long(i));
  const plan = { send: keys.slice(0, 15), skip: keys.slice(15).map((key) => ({ key, reason: 'prompting' })) };
  const failed = plan.send.map((key) => ({ key, error: 'e'.repeat(200), outcome: 'unknown' }));
  const sum = auditSummary({ targets: 30, plan, sent: [], skipped: plan.skip, failed });
  assert.ok(Buffer.byteLength(JSON.stringify(sum)) <= 3500);
  assert.equal(sum.failed.n, 15);
  assert.equal(sum.skipped.n, 15);
  assert.ok(sum.firstN >= 1 && sum.firstN <= 8, String(sum.firstN));
  const audit = openAudit({ file: path.join(tmp, `hub-audit-${auditN++}.jsonl`) });
  audit.append({ id: 'x', user: USER, via: 'hub', action: 'broadcast', target: '*', args: {}, result: sum });
  audit.close();

  // An audit failure does not hide the result.
  const bc2 = createBroadcast({ now: () => 1 });
  const s2 = stubCtx(v);
  s2.ctx.audit = { append: () => { throw new Error('disk full'); } };
  const r2 = await bc2.run(REQ(H(v, { targets: ['builder-a/web'], text: 'x', confirmCount: 1 })), s2.ctx);
  assert.equal(r2.status, 200);
  assert.equal(r2.result.auditError, 'audit-failed');
});

test('SR18 L4: refused requests are rate-limited per user (429 without planning); accepted ones are not counted', async () => {
  let t = 1_000_000;
  const bc = createBroadcast({ now: () => t });
  let plans = 0;
  const v = V1();
  const { ctx, calls } = stubCtx(null);
  delete ctx.view;
  ctx.store = { view: () => { plans++; return v; } };
  const mismatch = REQ({ targets: T3, text: 'x', confirmCount: 4 });
  for (let i = 0; i < REFUSAL_LIMIT.max; i++) {
    const r = await bc.run(i % 2 ? mismatch : REQ({ ...mismatch.args, extra: 1 }), ctx);
    assert.ok(r.status === 409 || r.status === 400, JSON.stringify(r));
  }
  const p0 = plans;
  const r = await bc.run(REQ(H(v, { targets: T3, text: 'x', confirmCount: 2 })), ctx);
  assert.equal(r.status, 429);
  assert.equal(r.error, 'too-many-refusals');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= REFUSAL_LIMIT.windowMs);
  assert.equal(plans, p0, 'no planning once limited');
  assert.equal(calls.length, 0);
  // Another user is not affected.
  const bob = stubCtx(v);
  bob.ctx.user = 'bob@example.invalid';
  assert.equal((await bc.run(REQ(H(v, { targets: T3, text: 'x', confirmCount: 2 })), bob.ctx)).status, 200);
  // After the window the user may try again; a successful broadcast does not count as a refusal.
  t += REFUSAL_LIMIT.windowMs;
  const ok = await bc.run(REQ(H(v, { targets: T3, text: 'x', confirmCount: 2 })), ctx);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(calls.length, 2);
});
