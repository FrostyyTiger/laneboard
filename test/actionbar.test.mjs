// Inspector action bar, broadcast dialog, kill dialog and launch form models
// (fleet plan §8 2.9, task C14). Pure models plus the fake-DOM render of the
// broadcast plan; the dialogs' typed confirms go through the real confirmSpec.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONBAR_BUTTONS, CONTROL_BUTTONS, actionBarModel, actionList, budgetArgs, capabilitiesFor, fieldsError,
  installControlActions, refusalHint, runBarItem, scriptArgs, sendArgs, _resetActions,
} from '../public/js/ui/actionbar.js';
import {
  broadcastBody, broadcastPreview, broadcastTargets, builderUpIn, confirmBroadcastPlan, hubPlanOf, outcomeLines,
  postBroadcast, broadcastRefusalText, renderBroadcastPlan, sendBroadcast, skipWhy,
} from '../public/js/ui/broadcast.js';
import {
  BUILDER_GRACE_MS, FLEET_UNDO_MS, builderInventory, cancelKill, fleetJobFrom, killCountdown, killPlan, killResultOf,
  killScopeOptions, pickScope, runKill, sessionsOfBuilder,
} from '../public/js/ui/killswitch.js';
import {
  AUTO_BUILDER, launchArgs, launchFormModel, launchHello, launchJobUrl, launchLines, sendLaunch,
} from '../public/js/ui/launch.js';
import { confirmSpec } from '../public/js/ui/confirm.js';
import { createStore } from '../public/js/core/store.js';
import { makeDocument, texts } from './helpers/fakedom.mjs';

const APPROVAL = '6f1c1a8e-0000-4000-8000-000000000001';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const EVIL = '<img src=x onerror=alert(1)>';

function model(over = {}) {
  return {
    found: true, builder: 'builder-a', sessionKey: 'builder-a/auth', sessionName: 'auth', laneKey: 'builder-a/auth',
    title: 'auth', approvalId: null, paused: false, dead: false, isMain: false, builderDown: false, ...over,
  };
}

const ids = (items) => items.map((x) => x.id);
const byId = (items, id) => items.find((x) => x.id === id);
const clickTier = (a) => ({ kill: 'confirm', retire: 'confirm', restart: 'confirm', 'set-budget': 'ask', 'run-script': 'ask', broadcast: 'confirm' }[a] ?? 'click');

function fresh() {
  _resetActions();
  installControlActions();
}

/** A ctx that records every step in order. */
function recorder({ prompt = null, answer = { ok: true }, result = { ok: true } } = {}) {
  const log = [];
  return {
    log,
    ctx: {
      prompt: async (spec) => { log.push(['prompt', spec.title]); return prompt; },
      confirmAction: async (q) => { log.push(['ask', q.action, q.targets[0], q.tier, q.consequence ?? null]); return answer; },
      act: async (k, action, args) => { log.push(['act', k, action, args]); return result; },
      navigate: (patch) => log.push(['nav', patch]),
      openKill: (o) => log.push(['kill-dialog', o.scope, o.model.sessionKey]),
      openBroadcast: (o) => log.push(['broadcast-dialog', o.selection]),
    },
  };
}

// --- action bar -------------------------------------------------------------------------------------

test('C14 adds its buttons on top of D6 without changing the D6 list', () => {
  fresh();
  assert.deepEqual(ACTIONBAR_BUTTONS, ['resume', 'pause', 'approve', 'deny', 'terminal', 'interrupt', 'restart', 'kill', 'retire']);
  const list = actionList().map((a) => a.id);
  for (const id of [...ACTIONBAR_BUTTONS, ...CONTROL_BUTTONS]) assert.ok(list.includes(id), id);
  assert.ok(list.indexOf('release') === list.indexOf('deny') + 1, 'release sits after deny');
  assert.ok(list.indexOf('send') === list.indexOf('terminal') + 1, 'send sits after terminal');
  assert.deepEqual(list.slice(-5), ['budget', 'run-script', 'send-review', 'broadcast', 'archive']);
  assert.deepEqual(installControlActions(), list, 'idempotent');
});

test('actionBarModel: a known capability list disables what the builder lacks, with the reason', () => {
  fresh();
  const m = model({ approvalId: APPROVAL });
  const none = actionBarModel(m, { tierOf: clickTier, capabilities: ['actions'], hub: true });
  for (const [id, cap] of [['pause', 'pause'], ['approve', 'approvals'], ['deny', 'approvals'], ['release', 'approvals'],
    ['budget', 'budget'], ['run-script', 'scripts'], ['send-review', 'review']]) {
    const it = byId(none, id);
    assert.equal(it.disabled, true, id);
    assert.equal(it.reason, `builder builder-a has no ${cap} capability`);
  }
  for (const id of ['send', 'interrupt', 'restart', 'kill', 'retire', 'broadcast', 'archive', 'terminal']) {
    assert.equal(byId(none, id).disabled, false, `${id} needs no capability`);
  }
  const all = actionBarModel(m, { tierOf: clickTier, capabilities: ['actions', 'pause', 'approvals', 'budget', 'scripts', 'review'], hub: true });
  assert.ok(all.every((x) => !x.disabled), 'every capability listed: nothing disabled');
  const unknown = actionBarModel(m, { tierOf: clickTier, capabilities: [], hub: true });
  assert.ok(unknown.every((x) => !x.disabled), 'no hello yet: nothing gated');
  assert.equal(byId(all, 'budget').tier, 'ask');
  assert.equal(byId(all, 'kill').tier, 'confirm');
  assert.equal(byId(all, 'archive').tier, 'read');
});

test('actionBarModel: capabilities come from the builder entry, or the local hello', () => {
  const s = createStore({ keyMode: 'fkey' });
  s.source.kind = 'hub';
  s.builders.set('builder-a', { id: 'builder-a', capabilities: ['actions', 'pause'] });
  assert.deepEqual(capabilitiesFor(model(), { store: s }), ['actions', 'pause']);
  const l = createStore({ keyMode: 'name' });
  l.source.hello = { capabilities: ['actions', 'approvals'], actions: {} };
  assert.deepEqual(capabilitiesFor(model(), { store: l }), ['actions', 'approvals']);
  assert.equal(capabilitiesFor(model({ builder: 'builder-z' }), { store: s }), null);
});

test('actionBarModel: broadcast is hub-only, approvals show only when pending, a down builder disables all', () => {
  fresh();
  const off = actionBarModel(model(), { tierOf: clickTier, hub: false });
  assert.equal(byId(off, 'broadcast').disabled, true);
  assert.match(byId(off, 'broadcast').reason, /runs on the hub/);
  assert.ok(!ids(off).includes('approve') && !ids(off).includes('release'));
  const pend = actionBarModel(model({ approvalId: APPROVAL }), { tierOf: clickTier, hub: true });
  assert.ok(['approve', 'deny', 'release'].every((id) => ids(pend).includes(id)));
  const down = actionBarModel(model({ builderDown: true }), { tierOf: clickTier, hub: true });
  assert.ok(down.every((x) => x.disabled));
  const dead = actionBarModel(model({ dead: true }), { tierOf: clickTier, hub: true });
  assert.equal(byId(dead, 'send').reason, 'the session has ended');
  const docs = actionBarModel(model({ sessionKey: null, laneKey: null }), { tierOf: clickTier, hub: true });
  assert.equal(byId(docs, 'budget').reason, 'not a lane');
  assert.equal(byId(docs, 'kill').reason, 'no session');
});

test('runBarItem send: popover, then the confirm, then act() with the typed text', async () => {
  fresh();
  const m = model();
  const items = actionBarModel(m, { tierOf: clickTier, hub: true });
  const { log, ctx } = recorder({ prompt: { text: 'run the tests\n', enter: true } });
  const r = await runBarItem(byId(items, 'send'), m, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(log.map((x) => x[0]), ['prompt', 'ask', 'act']);
  assert.equal(log[1][1], 'send-text');
  assert.equal(log[1][3], 'click');
  assert.match(log[1][4][0], /types 14 characters into auth, then Enter/);
  assert.deepEqual(log[2], ['act', 'builder-a/auth', 'send-text', { text: 'run the tests\n', enter: true }]);
});

test('runBarItem: Cancel in the popover or in the confirm sends nothing', async () => {
  fresh();
  const m = model();
  const items = actionBarModel(m, { tierOf: clickTier, hub: true });
  const a = recorder({ prompt: null });
  assert.equal((await runBarItem(byId(items, 'send'), m, a.ctx)).cancelled, true);
  assert.deepEqual(a.log.map((x) => x[0]), ['prompt']);
  const b = recorder({ prompt: { text: 'x', enter: false }, answer: { ok: false } });
  assert.equal((await runBarItem(byId(items, 'send'), m, b.ctx)).cancelled, true);
  assert.ok(!b.log.some((x) => x[0] === 'act'));
  const c = recorder({ prompt: { text: '   ', enter: true } });
  assert.equal((await runBarItem(byId(items, 'send'), m, c.ctx)).cancelled, true, 'blank text is not sent');
  const d = recorder({ answer: { ok: false } });
  await runBarItem(byId(items, 'interrupt'), m, d.ctx);
  assert.ok(!d.log.some((x) => x[0] === 'act'), 'a plain click action still asks first');
});

test('runBarItem: deny note, release, budget, run-script reach act() with their args', async () => {
  fresh();
  const m = model({ approvalId: APPROVAL });
  const items = actionBarModel(m, { tierOf: clickTier, hub: true });
  const deny = recorder({ prompt: { note: '  use the staging db  ' } });
  await runBarItem(byId(items, 'deny'), m, deny.ctx);
  assert.deepEqual(deny.log.at(-1), ['act', 'builder-a/auth', 'deny', { approvalId: APPROVAL, note: 'use the staging db' }]);
  const rel = recorder();
  await runBarItem(byId(items, 'release'), m, rel.ctx);
  assert.deepEqual(rel.log.at(-1), ['act', 'builder-a/auth', 'release', { approvalId: APPROVAL }]);
  const bud = recorder({ prompt: { usd: '12.5' } });
  await runBarItem(byId(items, 'budget'), m, bud.ctx);
  assert.equal(bud.log[1][3], 'ask');
  assert.deepEqual(bud.log.at(-1), ['act', 'builder-a/auth', 'set-budget', { usd: 12.5 }]);
  const scr = recorder({ prompt: { script: 'test' } });
  await runBarItem(byId(items, 'run-script'), m, scr.ctx);
  assert.deepEqual(scr.log.at(-1), ['act', 'builder-a/auth', 'run-script', { script: 'test' }]);
  const bad = recorder({ prompt: { script: 'rm -rf /' } });
  assert.equal((await runBarItem(byId(items, 'run-script'), m, bad.ctx)).cancelled, true);
  assert.ok(!bad.log.some((x) => x[0] === 'act'));
});

test('runBarItem: kill opens the kill dialog at lane level; review, broadcast and archive navigate/open', async () => {
  fresh();
  const m = model();
  const items = actionBarModel(m, { tierOf: clickTier, hub: true });
  const { log, ctx } = recorder();
  await runBarItem(byId(items, 'kill'), m, ctx);
  await runBarItem(byId(items, 'send-review'), m, ctx);
  await runBarItem(byId(items, 'broadcast'), m, ctx);
  await runBarItem(byId(items, 'archive'), m, ctx);
  assert.deepEqual(log, [
    ['kill-dialog', 'lane', 'builder-a/auth'],
    ['nav', { view: 'diff', sel: 'builder-a/auth' }],
    ['broadcast-dialog', ['builder-a/auth']],
    ['nav', { view: 'board', s: 'archive', q: null }],
  ]);
  assert.ok(!log.some((x) => x[0] === 'act'), 'none of these sends an action by itself');
});

test('popover value parsers and field checks', () => {
  assert.deepEqual(sendArgs({ text: 'hi', enter: false }), { text: 'hi', enter: false });
  assert.equal(sendArgs({ text: '' }), null);
  assert.deepEqual(budgetArgs({ usd: '' }), { usd: null }, 'empty clears the cap');
  assert.deepEqual(budgetArgs({ usd: '3.456' }), { usd: 3.46 });
  assert.equal(budgetArgs({ usd: '-1' }), null);
  assert.equal(budgetArgs({ usd: '1e9' }), null);
  assert.deepEqual(scriptArgs({ script: ' lint ' }), { script: 'lint' });
  assert.equal(scriptArgs({ script: 'Lint' }), null);
  const fields = [{ name: 'a', label: 'a', required: true, max: 3 }, { name: 'n', label: 'n', type: 'number', max: 10 }];
  assert.match(fieldsError(fields, { a: '' }), /required/);
  assert.match(fieldsError(fields, { a: 'abcd' }), /at most 3/);
  assert.match(fieldsError(fields, { a: 'ab', n: '11' }), /at most 10/);
  assert.equal(fieldsError(fields, { a: 'ab', n: '' }), null);
  assert.match(refusalHint({ ok: false, error: 'remote-only', code: 'remote-only' }), /serve or the hub/);
  assert.equal(refusalHint({ ok: false, error: 'boom' }), 'boom');
});

// --- broadcast ----------------------------------------------------------------------------------------

function hubStore() {
  const s = createStore({ keyMode: 'fkey' });
  s.source.kind = 'hub';
  const add = (b, name, extra) => s.sessions.set(`${b}/${name}`, { key: `${b}/${name}`, builder: b, name, ...extra });
  add('builder-a', 'auth', { lane: 'auth', state: 'idle' });
  add('builder-a', 'web', { lane: 'web', state: 'working', repo: 'acme' });
  add('builder-a', 'ask', { lane: 'ask', state: 'waiting_permission' });
  add('builder-a', 'held', { lane: 'held', state: 'idle', paused: { by: 'x' } });
  add('builder-a', 'scratch', { lane: null, state: 'shell' });
  add('builder-b', 'docs', { lane: 'docs', state: 'done' });
  s.lanes = [{ id: 'auth', builder: 'builder-a', repo: 'acme' }];
  s.builders.set('builder-a', { id: 'builder-a', status: 'live', controls: true, sessions: new Map() });
  s.builders.set('builder-b', { id: 'builder-b', status: 'down', controls: true, sessions: new Map() });
  return s;
}

test('broadcastTargets: the selection as given, or a filter over lane sessions; at most 30', () => {
  const s = hubStore();
  assert.deepEqual(broadcastTargets(s, { mode: 'selection', selection: ['builder-a/auth', 'builder-a/auth'] }).targets, ['builder-a/auth']);
  const all = broadcastTargets(s, { mode: 'filter' });
  assert.ok(!all.targets.includes('builder-a/scratch'), 'non-lane sessions are never filtered in');
  assert.equal(all.targets.length, 5);
  assert.deepEqual(broadcastTargets(s, { mode: 'filter', builder: 'builder-b' }).targets, ['builder-b/docs']);
  assert.deepEqual(broadcastTargets(s, { mode: 'filter', state: 'working' }).targets, ['builder-a/web']);
  assert.deepEqual(broadcastTargets(s, { mode: 'filter', repo: 'acme' }).targets, ['builder-a/auth', 'builder-a/web'], 'repo from the session or its lane');
  const big = createStore({ keyMode: 'fkey' });
  for (let i = 0; i < 40; i++) big.sessions.set(`builder-a/l${i}`, { builder: 'builder-a', name: `l${i}`, lane: `l${i}`, state: 'idle' });
  const t = broadcastTargets(big, { mode: 'filter' });
  assert.equal(t.targets.length, 30);
  assert.equal(t.total, 40);
  assert.equal(t.truncated, true);
});

test('broadcastPreview: the same planner, every skip with its reason, exactly the typed text', () => {
  const s = hubStore();
  assert.equal(builderUpIn(s, 'builder-b'), false);
  const targets = ['builder-a/auth', 'builder-a/web', 'builder-a/ask', 'builder-a/held', 'builder-b/docs', 'builder-a/gone'];
  const p = broadcastPreview(s, targets, 'pull main\r\nthen rebase\u0007', true);
  assert.deepEqual(p.plan.send, ['builder-a/auth', 'builder-a/web']);
  assert.deepEqual(p.skips.map((x) => [x.key, x.reason]), [
    ['builder-a/ask', 'prompting'], ['builder-a/held', 'paused'], ['builder-b/docs', 'builder-down'], ['builder-a/gone', 'unknown'],
  ]);
  assert.equal(p.skips[0].why, skipWhy('prompting'));
  assert.equal(p.preview.text, 'pull main\nthen rebase', 'CRLF normalised, control characters dropped');
  assert.equal(p.preview.enter, true);
  assert.equal(p.confirmCount, 2);
  assert.equal(p.error, null);
  assert.equal(broadcastPreview(s, targets, 'a\nb', false).preview.text, 'a b', 'no Enter: newlines become spaces');
  assert.equal(broadcastPreview(s, ['builder-a/ask'], 'x').error, 'nothing-to-send');
  assert.equal(broadcastPreview(s, ['builder-a/auth'], '').error, 'bad-text');
});

function hub409(code, send, hash, extra = {}) {
  return {
    ok: false, status: 409, error: code, detail: `type ${send.length}`,
    result: { plan: { send, skip: [{ key: 'builder-a/ask', reason: 'prompting' }] }, preview: { text: 'hi', enter: true }, confirmCount: send.length, planHash: hash },
    ...extra,
  };
}

test('sendBroadcast: plan-required, the typed count, then planHash + confirmCount echoed', async () => {
  const bodies = [];
  const answers = [hub409('plan-required', ['builder-a/auth', 'builder-a/web'], HASH_A), { ok: true, status: 200, result: { sent: ['builder-a/auth', 'builder-a/web'], skipped: [], failed: [] } }];
  const asked = [];
  const out = await sendBroadcast({ targets: ['builder-a/auth', 'builder-a/web', 'builder-a/ask'], text: 'hi', enter: true, confirmCount: 2 }, {
    post: async (b) => { bodies.push(b); return answers.shift(); },
    confirm: async (hp, code) => { asked.push([code, hp.plan.send.length, hp.planHash]); return { ok: true, confirmCount: 2 }; },
  });
  assert.equal(out.kind, 'done');
  assert.equal(out.ok, true);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], broadcastBody({ targets: ['builder-a/auth', 'builder-a/web', 'builder-a/ask'], text: 'hi', enter: true, confirmCount: 2 }));
  assert.ok(!('planHash' in bodies[0].args), 'the first call asks for the plan');
  assert.equal(bodies[0].builder, '*');
  assert.equal(bodies[0].target, '*');
  assert.deepEqual(asked, [['plan-required', 2, HASH_A]]);
  assert.equal(bodies[1].args.planHash, HASH_A);
  assert.equal(bodies[1].args.confirmCount, 2);
});

test('sendBroadcast: plan-changed and confirm-mismatch re-show the fresh plan and ask again', async () => {
  const bodies = [];
  const answers = [
    hub409('plan-required', ['builder-a/auth', 'builder-a/web'], HASH_A),
    hub409('plan-changed', ['builder-a/auth'], HASH_B),
    { ok: true, status: 200, result: { sent: ['builder-a/auth'], skipped: [], failed: [] } },
  ];
  const shown = [];
  const out = await sendBroadcast({ targets: ['builder-a/auth', 'builder-a/web'], text: 'hi', confirmCount: 2 }, {
    post: async (b) => { bodies.push(b); return answers.shift(); },
    confirm: async (hp) => ({ ok: true, confirmCount: hp.plan.send.length > 1 ? hp.plan.send.length : undefined }),
    onPlan: (hp, code) => shown.push([code, hp.plan.send.length]),
  });
  assert.equal(out.kind, 'done');
  assert.deepEqual(shown, [['plan-required', 2], ['plan-changed', 1]]);
  assert.equal(bodies[2].args.planHash, HASH_B, 'the fresh hash is echoed');
  assert.equal(bodies[2].args.confirmCount, 1, 'a one-lane plan confirms by name and sends count 1');
});

test('sendBroadcast: Cancel, nothing-to-send, refusals and a garbled planHash never confirm-send', async () => {
  let posts = 0;
  const cancelled = await sendBroadcast({ targets: ['builder-a/auth'], text: 'hi' }, {
    post: async () => { posts++; return hub409('plan-required', ['builder-a/auth'], HASH_A); },
    confirm: async () => ({ ok: false }),
  });
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(posts, 1, 'Cancel sends nothing more');

  const nothing = await sendBroadcast({ targets: ['builder-a/ask'], text: 'hi' }, {
    post: async () => hub409('nothing-to-send', [], HASH_A), confirm: async () => assert.fail('no confirm'),
  });
  assert.equal(nothing.kind, 'nothing');

  const limited = await sendBroadcast({ targets: ['builder-a/auth'], text: 'hi' }, {
    post: async () => ({ ok: false, status: 429, error: 'too-many-refusals', retryAfterMs: 42000 }), confirm: async () => assert.fail('no confirm'),
  });
  assert.deepEqual([limited.kind, limited.code, limited.retryAfterMs], ['refused', 'too-many-refusals', 42000]);
  assert.match(broadcastRefusalText(limited), /too many refused broadcasts.*retry in 42 s/);

  const bodies = [];
  const garbled = await sendBroadcast({ targets: ['builder-a/auth'], text: 'hi' }, {
    post: async (b) => { bodies.push(b); return hub409('plan-required', ['builder-a/auth'], 'NOT-A-HASH'); },
    confirm: async () => assert.fail('a plan without a valid hash is not confirmed'),
  });
  assert.equal(garbled.kind, 'refused');
  assert.equal(bodies.length, 1);

  let rounds = 0;
  const unstable = await sendBroadcast({ targets: ['builder-a/auth', 'builder-a/web'], text: 'hi' }, {
    post: async () => hub409('plan-changed', ['builder-a/auth', 'builder-a/web'], HASH_A),
    confirm: async () => { rounds++; return { ok: true, confirmCount: 2 }; },
  });
  assert.equal(unstable.code, 'plan-unstable');
  assert.ok(rounds <= 3);
});

test('confirmBroadcastPlan: the typed count form (BROADCAST n) with the skips listed', async () => {
  const hp = hubPlanOf(hub409('plan-required', ['builder-a/auth', 'builder-a/web', 'builder-a/x'], HASH_A));
  let q = null;
  await confirmBroadcastPlan(hp, 'plan-changed', async (x) => { q = x; return { ok: false }; });
  assert.equal(q.action, 'broadcast');
  assert.equal(q.tier, 'confirm');
  const spec = confirmSpec(q);
  assert.equal(spec.mode, 'typed');
  assert.equal(spec.phrase, 'BROADCAST 3');
  assert.equal(spec.confirmCount, 3);
  assert.match(q.consequence[0], /plan changed/);
  assert.ok(q.consequence.some((l) => /skips 1: builder-a\/ask \(a prompt/.test(l)));
});

test('postBroadcast sends the CSRF header and keeps the hub plan of a 409', async () => {
  let seen = null;
  const r = await postBroadcast({ builder: '*' }, async (url, init) => {
    seen = { url, init };
    return { ok: false, status: 409, json: async () => hub409('plan-required', ['builder-a/auth'], HASH_A) };
  });
  assert.equal(seen.url, '/api/fleet/actions');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['x-laneboard'], '1');
  assert.equal(r.status, 409);
  assert.equal(r.result.planHash, HASH_A);
  const down = await postBroadcast({}, async () => { throw new Error('offline'); });
  assert.deepEqual([down.ok, down.status, down.error], [false, 0, 'offline']);
});

test('the broadcast preview renders builder text as text only', () => {
  const saved = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const box = globalThis.document.createElement('div');
    renderBroadcastPlan(box, {
      plan: { send: [`builder-a/${EVIL}`], skip: [] },
      preview: { text: EVIL, enter: true, chars: EVIL.length, lines: 1 },
      skips: [{ key: `builder-a/${EVIL}x`, reason: 'paused', why: 'paused' }],
    });
    const t = texts(box);
    assert.ok(t.includes(EVIL), 'the typed text verbatim');
    assert.ok(t.includes(`builder-a/${EVIL}`));
    assert.ok(t.some((x) => x.startsWith(`builder-a/${EVIL}x: paused`)));
    assert.ok(t.some((x) => /then Enter/.test(x)));
    const walk = (n) => { assert.equal(n.innerHTML, ''); n.children.forEach(walk); };
    walk(box);
  } finally {
    globalThis.document = saved;
  }
  assert.deepEqual(outcomeLines({ sent: ['a/b'], skipped: [{ key: 'a/c', reason: 'prompting' }], failed: [{ key: 'a/d', error: 'x', outcome: 'unknown' }] }), [
    'Sent to 1: a/b', `Skipped 1: a/c (${skipWhy('prompting')})`, 'Failed 1: a/d (x, outcome unknown)',
  ]);
});

// --- kill dialog -----------------------------------------------------------------------------------------

test('kill scopes: lane needs a live session, fleet needs the hub', () => {
  const local = killScopeOptions(model(), { hub: false });
  assert.deepEqual(local.map((o) => [o.scope, o.disabled]), [['lane', false], ['builder', false], ['fleet', true]]);
  assert.match(local[2].reason, /hub/);
  const gone = killScopeOptions(model({ sessionKey: null }), { hub: true });
  assert.equal(gone[0].reason, 'no session');
  assert.equal(pickScope(gone, 'lane'), 'builder');
  assert.equal(pickScope(local, 'fleet'), 'lane');
});

test('builderInventory: lane sessions are victims, others opt-in, _laneboard* never listed', () => {
  const inv = builderInventory([
    { name: 'auth', lane: 'auth' }, { name: 'web', lane: 'web' }, { name: 'scratch', lane: null },
    { name: '_laneboard-hub', lane: null }, { name: '_laneboard', lane: 'x' }, null, { lane: 'nameless' },
  ]);
  assert.deepEqual(inv, { victims: ['auth', 'web'], others: ['scratch'] });
  const s = hubStore();
  assert.deepEqual(builderInventory(sessionsOfBuilder(s, 'builder-a')).others, ['scratch']);
});

test('killPlan: the typed confirm is the lane, the builder id, or fleet', () => {
  const lane = killPlan({ scope: 'lane', model: model() });
  assert.equal(confirmSpec({ action: 'kill', targets: lane.confirmTargets, tier: 'confirm' }).phrase, 'KILL builder-a/auth');
  assert.equal(confirmSpec({ action: 'kill', targets: lane.confirmTargets, tier: 'confirm' }).confirm, 'auth');
  assert.deepEqual(lane.send, { via: 'act', key: 'builder-a/auth', action: 'kill', args: {} });

  const b = killPlan({ scope: 'builder', model: model(), include: ['scratch', 'auth', 'evil'], others: ['scratch'], victims: ['auth', 'web'], hub: true });
  const bs = confirmSpec({ action: 'kill', targets: b.confirmTargets, tier: 'confirm' });
  assert.equal(bs.phrase, 'KILL builder-a');
  assert.equal(bs.confirm, 'builder-a');
  assert.deepEqual(b.send, { via: 'hub', builder: 'builder-a', action: 'kill', target: '*', args: { graceMs: BUILDER_GRACE_MS, include: ['scratch'] } });
  assert.ok(b.consequence.some((l) => /2 lane sessions: auth, web/.test(l)));
  const bl = killPlan({ scope: 'builder', model: model(), victims: [], hub: false });
  assert.deepEqual(bl.send, { via: 'act', key: '*', action: 'kill', args: { graceMs: BUILDER_GRACE_MS } });

  const f = killPlan({ scope: 'fleet', hub: true });
  const fs = confirmSpec({ action: 'kill', targets: f.confirmTargets, tier: 'confirm' });
  assert.equal(fs.phrase, 'KILL FLEET');
  assert.equal(fs.confirm, 'fleet');
  assert.deepEqual(f.send, { via: 'hub', builder: '*', action: 'kill', target: '*', args: {} });
  assert.equal(killPlan({ scope: 'fleet', hub: false }).error, 'the fleet kill runs on the hub');
});

test('runKill: nothing is sent without the typed confirm; the typed value becomes args.confirm', async () => {
  const log = [];
  const deps = (answer, result = { ok: true, status: 202, result: { job: 'fleetkill-1-abcdef12', undoMs: FLEET_UNDO_MS, state: 'pending' } }) => ({
    confirmAction: async (q) => { log.push(['ask', q.tier, q.targets[0]]); return answer; },
    act: async (k, a, args) => { log.push(['act', k, a, args]); return { ok: true, result: { ok: true, job: 'killall-1-aa', graceMs: 10000 } }; },
    hubAct: async (req) => { log.push(['hub', req]); return result; },
    now: () => 1000,
  });
  const fleet = killPlan({ scope: 'fleet', hub: true });
  assert.equal((await runKill(fleet, deps({ ok: false }))).cancelled, true);
  assert.deepEqual(log.map((x) => x[0]), ['ask']);
  log.length = 0;
  const sent = await runKill(fleet, deps({ ok: true, confirm: 'fleet' }));
  assert.deepEqual(log[1], ['hub', { builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet' } }]);
  assert.equal(log[0][1], 'confirm');
  assert.equal(sent.job, 'fleetkill-1-abcdef12');
  assert.equal(sent.deadline, 1000 + FLEET_UNDO_MS);
  log.length = 0;
  await cancelKill(sent, deps({ ok: true }));
  assert.deepEqual(log[0], ['hub', { builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet', cancel: 'fleetkill-1-abcdef12' } }]);

  log.length = 0;
  const local = killPlan({ scope: 'builder', model: model(), victims: ['auth'], hub: false });
  const b = await runKill(local, deps({ ok: true, confirm: 'builder-a' }));
  assert.deepEqual(log[1], ['act', '*', 'kill', { graceMs: BUILDER_GRACE_MS, confirm: 'builder-a' }]);
  assert.equal(b.job, 'killall-1-aa');
  assert.equal(b.deadline, 1000 + 10000);
  log.length = 0;
  await cancelKill(b, deps({ ok: true }));
  assert.deepEqual(log[0], ['act', '*', 'kill', { confirm: 'builder-a', cancel: 'killall-1-aa' }]);
  assert.equal((await runKill({ error: 'no session' }, deps({ ok: true, confirm: 'x' }))).ok, false);
  assert.equal((await runKill(local, deps({ ok: true, confirm: '' }))).cancelled, true, 'an empty confirm is no confirm');
});

test('kill countdown: Undo/Cancel only inside the window, and what happened in words', () => {
  const c = killCountdown({ scope: 'fleet', job: { state: 'pending' }, deadline: 10_000, now: 2_500 });
  assert.deepEqual([c.seconds, c.canUndo, c.text], [8, true, 'Fleet kill in 8 s']);
  assert.equal(killCountdown({ scope: 'fleet', job: { state: 'killing' }, deadline: 10_000, now: 9_000 }).canUndo, false);
  assert.match(killCountdown({ scope: 'fleet', job: { state: 'cancelled' }, deadline: 10_000, now: 1 }).text, /nothing was killed/);
  assert.match(killCountdown({ scope: 'fleet', job: { state: 'failed' }, now: 1 }).text, /nothing will be killed/);
  assert.match(killCountdown({ scope: 'builder', deadline: 5_000, now: 6_000 }).text, /Grace over/);
  assert.equal(killCountdown({ scope: 'builder', deadline: 5_000, now: 1_000 }).text, 'Builder kill in 4 s');
  assert.equal(fleetJobFrom({ jobs: [{ job: 'a' }, { job: 'b', state: 'pending' }] }, 'b').state, 'pending');
  assert.equal(fleetJobFrom(null, 'b'), null);
  assert.deepEqual(killResultOf({ ok: true, result: { ok: true, result: { job: 'j' } } }), { job: 'j' });
});

// --- launch form ----------------------------------------------------------------------------------------

test('launchHello keeps only well-formed repos, modes and capabilities', () => {
  const h = launchHello({ repos: ['acme', '../x', EVIL, 'acme'], permissionModes: ['auto', 'plan', 'b@d'], capabilities: ['launch', 'X'], auth: { kind: 'direct' } });
  assert.deepEqual(h, { capabilities: ['launch'], repos: ['acme'], permissionModes: ['auto', 'plan'], authKind: 'direct' });
  assert.equal(launchHello(null), null);
});

test('launchFormModel: repos from the chosen builder or the union, modes from hello, direct users only get priority', () => {
  const hellos = new Map([
    ['builder-a', launchHello({ capabilities: ['launch'], repos: ['acme', 'web'], permissionModes: ['auto', 'plan'] })],
    ['builder-b', launchHello({ capabilities: ['launch'], repos: ['docs'], permissionModes: ['default'] })],
    ['builder-c', launchHello({ capabilities: ['actions'], repos: ['secret'] })],
  ]);
  const auto = launchFormModel({ hub: true, hellos, builderIds: ['builder-b', 'builder-a', 'builder-c'] });
  assert.deepEqual(auto.builders, [AUTO_BUILDER, 'builder-a', 'builder-b'], 'only builders with the launch capability');
  assert.deepEqual(auto.repos, ['acme', 'docs', 'web']);
  assert.equal(auto.defaultMode, 'auto');
  assert.equal(auto.direct, true);
  assert.equal(auto.legacy, false);
  const b = launchFormModel({ hub: true, hellos, builderIds: ['builder-a', 'builder-b'], chosen: 'builder-b' });
  assert.deepEqual([b.repos, b.permissionModes, b.defaultMode], [['docs'], ['default'], 'default']);
  assert.equal(launchFormModel({ hub: true, hellos, builderIds: ['builder-a'], chosen: 'builder-z' }).chosen, AUTO_BUILDER);
  const local = launchFormModel({ localHello: launchHello({ capabilities: ['actions', 'launch'], repos: ['acme'], auth: { kind: 'local' } }) });
  assert.deepEqual([local.legacy, local.direct, local.permissionModes.includes('auto')], [false, false, true]);
  const legacy = launchFormModel({});
  assert.equal(legacy.legacy, true);
});

test('launchArgs: defaults, repo checks, priority and budget only for a direct user', () => {
  const hub = launchFormModel({ hub: true, hellos: new Map([['builder-a', launchHello({ capabilities: ['launch'], repos: ['acme', 'web'], permissionModes: ['auto'] })]]), builderIds: ['builder-a'] });
  const ok = launchArgs({ lane: 'bauplan', repo: 'acme', model: '', permissionMode: 'auto', priority: 'low', budgetUsd: '25' }, hub);
  assert.deepEqual(ok, { ok: true, lane: 'bauplan', builder: null, args: { repo: 'acme', plan: 'docs/plans/bauplan.md', model: 'opus', permissionMode: 'auto', priority: 'low', budgetUsd: 25 } });
  assert.match(launchArgs({ lane: 'Bad Lane' }, hub).error, /lane id/);
  assert.match(launchArgs({ lane: 'x' }, hub).error, /repo: required/);
  assert.match(launchArgs({ lane: 'x', repo: 'docs' }, hub).error, /not on any launch builder/);
  assert.match(launchArgs({ lane: 'x', repo: 'acme', plan: '../etc.md' }, hub).error, /plan/);
  assert.match(launchArgs({ lane: 'x', repo: 'acme', budgetUsd: '0' }, hub).error, /budget/);
  assert.match(launchArgs({ lane: 'x', repo: 'acme', permissionMode: 'yolo' }, hub).error, /not offered/);
  const chosen = { ...hub, chosen: 'builder-a' };
  assert.equal(launchArgs({ lane: 'x', repo: 'acme' }, chosen).builder, 'builder-a');
  const local = launchFormModel({ localHello: launchHello({ capabilities: ['actions', 'launch'], repos: ['acme'], auth: { kind: 'local' } }) });
  const l = launchArgs({ lane: 'x', priority: 'high', budgetUsd: '50' }, local);
  assert.deepEqual(l.args, { repo: 'acme', plan: 'docs/plans/x.md', model: 'opus' }, 'a single repo is the default; no priority/budget for a local user');
  const legacy = launchArgs({ lane: 'bauplan', repo: '', model: 'opus', permissionMode: 'auto' }, launchFormModel({}));
  assert.deepEqual(legacy.args, { plan: 'docs/plans/bauplan.md', model: 'opus' }, 'legacy keeps the server defaults');
  assert.match(launchLines(ok).join(' '), /the hub places it.*repo acme.*budget \$25/);
});

test('sendLaunch: the confirm first; the hub places a builder:null launch; a builder launches its own lane', async () => {
  const log = [];
  const deps = (answer) => ({
    confirmAction: async (q) => { log.push(['ask', q.action, q.targets[0], q.tier]); return answer; },
    act: async (k, a, args) => { log.push(['act', k, a, args]); return { ok: true, result: { lane: k, slot: 2, job: 'job-1' } }; },
    hubAct: async (req) => { log.push(['hub', req]); return { ok: true, status: 202, builder: 'builder-a', placedBy: 'hub', result: { lane: req.target, slot: 3, job: 'job-2' } }; },
  });
  const hubModel = { hub: true, legacy: false, chosen: AUTO_BUILDER };
  const v = { ok: true, lane: 'bauplan', builder: null, args: { repo: 'acme', plan: 'docs/plans/bauplan.md', model: 'opus' } };
  assert.equal((await sendLaunch(v, hubModel, deps({ ok: false }))).cancelled, true);
  assert.deepEqual(log.map((x) => x[0]), ['ask']);
  log.length = 0;
  const out = await sendLaunch(v, hubModel, deps({ ok: true }));
  assert.deepEqual(log[1], ['hub', { builder: null, action: 'launch', target: 'bauplan', args: v.args }]);
  assert.deepEqual([out.ok, out.job, out.builder], [true, 'job-2', 'builder-a']);
  assert.equal(launchJobUrl(out.job, { hub: true, builder: out.builder }), '/api/fleet/builder-a/v1/jobs/job-2');
  log.length = 0;
  await sendLaunch({ ...v, builder: 'builder-b' }, { ...hubModel, chosen: 'builder-b' }, deps({ ok: true }));
  assert.equal(log[0][2], 'builder-b/bauplan', 'the confirm names the builder');
  log.length = 0;
  const lo = await sendLaunch(v, { hub: false, legacy: false }, deps({ ok: true }));
  assert.deepEqual(log[1], ['act', 'bauplan', 'launch', v.args]);
  assert.equal(lo.job, 'job-1');
  assert.equal(launchJobUrl('job-1', {}), '/api/v1/jobs/job-1');
  assert.equal(launchJobUrl('job-1', { legacy: true }), '/api/jobs/job-1');
});
