// Hub action relay (fleet plan §3 2.10, H8). Uses the in-process fake builder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRelay, validateArgs, RelayError, ACTIONS, registerHubAction, _resetHubActions, HubActionError, HUB_ACTION_ERRORS, remoteUser } from '../server/hub/relay.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { verifyEnvelope, _resetForTests } from '../server/fleet/auth.mjs';
import { keyId as keyIdOf } from '../server/fleet/keys-ed25519.mjs';
import { fakeBuilder, hubSigner } from './helpers/fake-builder.mjs';

const USER = 'alice@example.invalid';
const AUTH = Object.freeze({ kind: 'direct', user: USER });
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const signer = hubSigner(privateKey);
const HUB_KEYS = [{ key: signer.publicKey, id: 'hub', scopes: ['read', 'control'] }];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-relay-'));
const fakes = [];
let auditN = 0;

after(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function fake(opts) {
  const fb = await fakeBuilder({ hubKeys: HUB_KEYS, ...opts });
  fakes.push(fb);
  return fb;
}

function lanesBox(freeSlots) {
  const slots = [];
  for (let i = 0; i < 4; i++) slots.push({ slot: i + 1, laneSlot: true, lane: i < 4 - freeSlots ? `l${i}` : null, orphan: false });
  return { slots, launched: [] };
}

/** A store with the given fakes (all up unless `down` lists them) plus optional extra config-only builders. */
function setup(fbs, { down = [], extra = [], cfg = {}, fetchImpl, repos = {} } = {}) {
  const builders = [...fbs.map((fb) => ({ id: fb.id, url: fb.url, repos: repos[fb.id] })), ...extra];
  const store = createFleetStore({ builders, hubVersion: '0.1.0' });
  const t = Date.now();
  for (const b of builders) {
    const fb = fbs.find((f) => f.id === b.id);
    const state = down.includes(b.id) || !fb ? 'down' : 'up';
    store.setConn(b.id, { state, lastSeen: t, latencyMs: 10, hello: fb ? fb.hello : { version: '0.1.0', apiVersion: 1, capabilities: [] } });
    if (fb) store.applySnapshot(b.id, { ...fb.snapshot(), box: lanesBox(2), vitals: { mem: { availableMb: 8000, swapTotalMb: 0, swapUsedMb: 0 }, load: [1, 1, 1], cpus: 4 } }, t);
  }
  const file = path.join(tmp, `audit-${auditN++}.jsonl`);
  const audit = openAudit({ file });
  const relay = createRelay({ store, key: privateKey, audit, cfg: { actionTimeoutMs: 2000, ...cfg }, ...(fetchImpl ? { fetchImpl } : {}) });
  const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { store, relay, audit, lines };
}

test('ACTIONS is the README allowlist and has no term', () => {
  for (const a of ['send-text', 'send-keys', 'interrupt', 'pause', 'resume', 'kill', 'restart', 'spawn', 'launch', 'retire',
    'approve', 'deny', 'release', 'set-budget', 'broadcast', 'ack-alarm', 'send-review', 'run-script']) assert.ok(ACTIONS.includes(a), a);
  assert.ok(!ACTIONS.includes('term'));
});

test('validateArgs rejects 17 KB text, empty text and bad key names', () => {
  assert.throws(() => validateArgs('send-text', { text: 'x'.repeat(17 * 1024) }), (e) => e instanceof RelayError && e.status === 400);
  assert.throws(() => validateArgs('send-text', { text: '' }), RelayError);
  assert.throws(() => validateArgs('send-keys', { keys: ['Enter', 'bad key'] }), RelayError);
  assert.throws(() => validateArgs('send-keys', { keys: Array(21).fill('a') }), RelayError);
  assert.throws(() => validateArgs('send-keys', { keys: ['$(id)'] }), RelayError);
  assert.throws(() => validateArgs('kill', { blob: 'x'.repeat(33 * 1024) }), RelayError);
  assert.throws(() => validateArgs('nope', {}), RelayError);
  assert.throws(() => validateArgs('kill', JSON.parse('{"__proto__": {"x": 1}}')), RelayError);
  assert.deepEqual(validateArgs('send-keys', { keys: ['C-c', 'Enter'] }), { keys: ['C-c', 'Enter'] });
  assert.deepEqual(validateArgs('send-text', { text: 'hi', enter: true }), { text: 'hi', enter: true });
});

test('envelope: user from the caller (not the body), fresh id, via hub; signature verifies; headers', async () => {
  _resetForTests();
  const fb = await fake({ id: 'builder-a' });
  const { relay } = setup([fb]);
  const body = { builder: 'builder-a', action: 'send-text', target: 'web', args: { text: 'hello' }, user: 'mallory@example.invalid', via: 'direct' };
  const r1 = await relay.relay(body, AUTH);
  const r2 = await relay.relay({ ...body }, AUTH);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.status, 200);
  assert.equal(fb.actions.length, 2);
  const [a1, a2] = fb.actions;
  assert.equal(a1.envelope.user, USER);
  assert.equal(a1.envelope.via, 'hub');
  assert.equal(a1.envelope.builder, 'builder-a');
  assert.equal(a1.envelope.v, 1);
  assert.match(a1.envelope.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a1.envelope.id, a2.envelope.id);
  assert.equal(a1.verified, true);
  assert.equal(a1.kind, 'hub');
  // Every relayed request: X-Laneboard: 1, X-Laneboard-Key, no Origin.
  for (const a of fb.actions) {
    assert.equal(a.headers['x-laneboard'], '1');
    assert.equal(a.headers['x-laneboard-key'], keyIdOf(privateKey));
    assert.equal(a.headers.origin, undefined);
  }
  const cfg = { fleet: { id: 'builder-a', hubKeys: HUB_KEYS, clockSkewMs: 60000 } };
  const auth = verifyEnvelope(a1.envelope, a1.headers, cfg);
  assert.equal(auth.user, USER);
  // A tampered envelope does not verify.
  assert.throws(() => verifyEnvelope({ ...a2.envelope, user: 'mallory@example.invalid' }, a2.headers, cfg));
  assert.equal(r1.auditId, a1.envelope.id);
  assert.ok(r2.ok);
});

test('relay() refuses a local user (403 remote-only) and sends nothing', async () => {
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  const body = { builder: 'builder-a', action: 'interrupt', target: 'web', args: {} };
  for (const u of ['local', '', null, undefined, USER, { kind: 'local', user: 'local' }, { kind: 'hub', user: null }, { kind: 'direct', user: 'local' }]) {
    const r = await relay.relay(body, u);
    assert.equal(r.status, 403, String(u));
    assert.equal(r.error, 'remote-only');
  }
  const ok = await relay.relay(body, { kind: 'direct', user: USER });
  assert.equal(ok.ok, true);
  assert.equal(fb.actions.length, 1);
  assert.equal(lines().length, 2);
});

test('a down builder gets 503 and nothing is sent or queued; unknown builder 404', async () => {
  const fb = await fake({ id: 'builder-a' });
  const { relay, store, lines } = setup([fb], { down: ['builder-a'] });
  const r = await relay.relay({ builder: 'builder-a', action: 'kill', target: 'web', args: { confirm: 'web' } }, AUTH);
  assert.equal(r.status, 503);
  assert.equal(r.error, 'builder down');
  assert.equal(r.state, 'down');
  // Coming back up later does not deliver anything.
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now() });
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(fb.actions.length, 0);
  assert.equal(lines().length, 0);
  const u = await relay.relay({ builder: 'builder-z', action: 'kill', target: 'web', args: { confirm: 'web' } }, AUTH);
  assert.equal(u.status, 404);
});

test('a timeout gives ok:false, error timeout, outcome unknown, with no retry (1 request)', async () => {
  const fb = await fake({ id: 'builder-a', onAction: () => new Promise((res) => setTimeout(() => res({ ok: true, result: {} }), 600)) });
  const { relay, lines } = setup([fb], { cfg: { actionTimeoutMs: 100 } });
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');
  assert.equal(r.outcome, 'unknown');
  await new Promise((res) => setTimeout(res, 700));
  assert.equal(fb.actions.length, 1);
  const done = lines().filter((e) => e.result.phase === 'done');
  assert.equal(done.length, 1);
  assert.equal(done[0].result.ok, 'unknown');
  assert.equal(done[0].result.error, 'timeout');
});

test('the audit has a pending line and an outcome line with the same id', async () => {
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  const r = await relay.relay({ builder: 'builder-a', action: 'send-text', target: 'web', args: { text: 'secret prompt' } }, AUTH);
  assert.ok(r.ok);
  const es = lines();
  assert.equal(es.length, 2);
  assert.deepEqual(es[0].result, { phase: 'sent' });
  assert.equal(es[1].result.phase, 'done');
  assert.equal(es[1].result.ok, true);
  assert.equal(es[1].result.status, 200);
  assert.ok(es[1].result.builderAuditId);
  for (const e of es) {
    assert.equal(e.id, r.auditId);
    assert.equal(e.user, USER);
    assert.equal(e.via, 'hub');
    assert.equal(e.builder, 'builder-a');
    assert.equal(e.action, 'send-text');
    assert.equal(e.target, 'web');
    assert.match(e.argsHash, /^[0-9a-f]{64}$/);
  }
  assert.ok(!fs.readFileSync(path.join(tmp, `audit-${auditN - 1}.jsonl`), 'utf8').includes('secret prompt'));
});

test('builder refusals pass through (403 control-disabled), outcome audited ok:false', async () => {
  const fb = await fake({ id: 'builder-a', hubControl: false });
  const { relay, lines } = setup([fb]);
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.error, 'control-disabled');
  assert.equal(lines().at(-1).result.ok, false);
});

test('routing comes from the fkey and the hub config, never from builder-supplied fields', async () => {
  const a = await fake({ id: 'builder-a' });
  const b = await fake({ id: 'builder-b', sessions: [{ name: 'web', builder: 'builder-a', key: 'builder-a/web' }] });
  const { relay, store } = setup([a, b]);
  // builder-b's snapshot claimed builder-a for its session: the store stripped it, and routing ignores it.
  assert.equal(store.session('builder-b/web')?.builder, 'builder-b');
  const r = await relay.relay({ fkey: 'builder-b/web', action: 'send-text', args: { text: 'x' } }, AUTH);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.builder, 'builder-b');
  assert.equal(a.actions.length, 0);
  assert.equal(b.actions.length, 1);
  assert.equal(b.actions[0].envelope.target, 'web');
  const mism = await relay.relay({ fkey: 'builder-b/web', builder: 'builder-a', action: 'send-text', args: { text: 'x' } }, AUTH);
  assert.equal(mism.status, 400);
  const unknown = await relay.relay({ fkey: 'builder-q/web', action: 'send-text', args: { text: 'x' } }, AUTH);
  assert.equal(unknown.status, 404);
  const bad = await relay.relay({ fkey: 'no-slash', action: 'send-text', args: { text: 'x' } }, AUTH);
  assert.equal(bad.status, 400);
  assert.equal(a.actions.length + b.actions.length, 1);
});

test('a registered hub-local action runs instead of relaying; hub-only actions are never relayed', async () => {
  _resetHubActions();
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  const none = await relay.relay({ builder: null, action: 'ack-alarm', target: 'a1', args: {} }, AUTH);
  assert.equal(none.status, 503);
  assert.equal(fb.actions.length, 0);
  const seen = [];
  const off = relay.registerHubAction('ack-alarm', { run: (req, ctx) => { seen.push([req, ctx.user]); return { acked: 1 }; } });
  const r = await relay.relay({ builder: 'builder-a', action: 'ack-alarm', target: 'a1', args: { tile: 'STCK' } }, AUTH);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { acked: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], USER);
  assert.equal(fb.actions.length, 0);
  const es = lines();
  assert.equal(es.length, 2);
  assert.deepEqual(es[0].result, { phase: 'pending', local: true });
  assert.equal(es[1].result.phase, 'done');
  assert.equal(es[1].result.ok, true);
  assert.equal(es[0].id, es[1].id);
  assert.equal(es[0].action, 'ack-alarm');
  assert.throws(() => relay.registerHubAction('ack-alarm', { run() {} }), /already registered/);
  off();
  // Module-level registration (what hub route modules use).
  const off2 = registerHubAction('broadcast', {
    async run(req, ctx) {
      const out = [];
      for (const k of req.args.targets) {
        const [b, n] = k.split('/');
        out.push(await ctx.send(b, 'send-text', n, { text: req.args.text, enter: true, guardPrompt: true }));
      }
      return { ok: true, result: { sent: out.filter((x) => x.ok).length } };
    },
  });
  const br = await relay.relay({ builder: '*', action: 'broadcast', target: '*', args: { targets: ['builder-a/web', 'builder-a/api'], text: 'go' } }, AUTH);
  assert.equal(br.ok, true, JSON.stringify(br));
  assert.equal(br.result.sent, 2);
  assert.equal(fb.actions.length, 2);
  assert.notEqual(fb.actions[0].envelope.id, fb.actions[1].envelope.id);
  assert.ok(fb.actions.every((a) => a.envelope.user === USER && a.envelope.action === 'send-text'));
  off2();
  // A hub-local handler still needs a direct user.
  const loc = await relay.relay({ builder: null, action: 'ack-alarm', target: 'a1', args: {} }, 'local');
  assert.equal(loc.status, 403);
  _resetHubActions();
});

test("builder '*' pause fans out one envelope per up builder with confirm rewritten to each id", async () => {
  const a = await fake({ id: 'builder-a' });
  const b = await fake({ id: 'builder-b' });
  const { relay, lines } = setup([a, b], { extra: [{ id: 'builder-c', url: 'http://127.0.0.1:9' }] });
  const wrong = await relay.relay({ builder: '*', action: 'pause', target: '*', args: { confirm: 'builder-a' } }, AUTH);
  assert.equal(wrong.status, 400);
  assert.equal(a.actions.length + b.actions.length, 0);
  const r = await relay.relay({ builder: '*', action: 'pause', target: '*', args: { confirm: 'fleet', interrupt: true } }, AUTH);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(a.actions.length, 1);
  assert.equal(b.actions.length, 1);
  assert.deepEqual(a.actions[0].envelope.args, { confirm: 'builder-a', interrupt: true });
  assert.deepEqual(b.actions[0].envelope.args, { confirm: 'builder-b', interrupt: true });
  assert.equal(a.actions[0].envelope.target, '*');
  assert.notEqual(a.actions[0].envelope.id, b.actions[0].envelope.id);
  assert.deepEqual(r.result.skipped, [{ builder: 'builder-c', reason: 'down' }]);
  assert.deepEqual(r.result.sent.map((s) => s.builder), ['builder-a', 'builder-b']);
  assert.equal(lines().length, 4);
  // kill '*' is C9's hub-local action: without it, no fan-out.
  const k = await relay.relay({ builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet' } }, AUTH);
  assert.equal(k.status, 400);
  assert.equal(a.actions.length, 1);
});

test('spawn/launch with no builder are placed by the hub; an explicit ineligible builder gets a warning', async () => {
  const caps = ['snapshot', 'stream', 'actions', 'launch'];
  const a = await fake({ id: 'builder-a', capabilities: caps, helloFields: { repos: ['acme'] } });
  const b = await fake({ id: 'builder-b', capabilities: caps, helloFields: { repos: ['acme', 'other'] } });
  // builder-b claims `other`, but the hub config allows it only `acme`.
  const { relay, store } = setup([a, b], { repos: { 'builder-a': ['acme'], 'builder-b': ['acme'] } });
  store.applyDelta('builder-a', { box: lanesBox(0) }, Date.now());
  const r = await relay.relay({ builder: null, action: 'launch', target: 'feat-x', args: { repo: 'acme', plan: 'p' } }, AUTH);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.builder, 'builder-b');
  assert.equal(r.placedBy, 'hub');
  assert.equal(typeof r.score, 'number');
  const none = await relay.relay({ action: 'launch', target: 'feat-y', args: { repo: 'other', plan: 'p' } }, AUTH);
  assert.equal(none.status, 503);
  assert.equal(none.error, 'no-eligible-builder');
  assert.equal(b.actions.length, 1);
  const forced = await relay.relay({ builder: 'builder-a', action: 'launch', target: 'feat-z', args: { repo: 'acme', plan: 'p' } }, AUTH);
  assert.equal(forced.ok, true);
  assert.match(forced.warning, /no free lane slot/);
  assert.equal(a.actions.length, 1);
  const noBuilder = await relay.relay({ action: 'kill', target: 'web', args: { confirm: 'web' } }, AUTH);
  assert.equal(noBuilder.status, 400);
});

test('network outcomes: refused connection is ok:false, oversize and redirect are not trusted', async () => {
  const fb = await fake({ id: 'builder-a' });
  const mk = (impl) => setup([fb], { fetchImpl: impl });
  const refused = mk(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
  const r1 = await refused.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, 'unreachable');
  assert.equal(refused.lines().at(-1).result.ok, false);
  let calls = 0;
  const big = mk(async (url, init) => { calls++; assert.equal(init.redirect, 'manual'); return new Response('x'.repeat(70 * 1024), { status: 200 }); });
  const r2 = await big.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r2.outcome, 'unknown');
  assert.equal(r2.error, 'response-too-large');
  assert.equal(calls, 1);
  const redir = mk(async () => new Response('', { status: 307, headers: { location: 'http://127.0.0.1:1/api/v1/actions' } }));
  const r3 = await redir.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r3.ok, false);
  assert.equal(r3.error, 'redirect-refused');
});

test('an audit failure before sending means nothing is sent', async () => {
  const fb = await fake({ id: 'builder-a' });
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: fb.url }], hubVersion: '0.1.0' });
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now(), hello: fb.hello });
  const audit = { append() { throw new Error('disk full'); } };
  const relay = createRelay({ store, key: privateKey, audit });
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
  assert.equal(r.status, 500);
  assert.equal(r.error, 'audit-failed');
  assert.equal(fb.actions.length, 0);
});

// --- SR11 regressions (H8-fix) ----------------------------------------------------------------------------

const LAUNCH_CAPS = ['snapshot', 'stream', 'actions', 'launch'];

test('SR11 M1: a launch without a valid string repo is refused 400 and nothing is sent', async () => {
  assert.throws(() => validateArgs('launch', { plan: 'p' }), (e) => e instanceof RelayError && e.status === 400);
  assert.throws(() => validateArgs('launch', { plan: 'p', repo: ['acme'] }), RelayError);
  assert.throws(() => validateArgs('launch', { plan: 'p', repo: '../acme' }), RelayError);
  const a = await fake({ id: 'builder-a', capabilities: LAUNCH_CAPS, helloFields: { repos: ['acme'] } });
  const x = await fake({ id: 'builder-x', capabilities: LAUNCH_CAPS, helloFields: { repos: ['acme'] } });
  const { relay, lines } = setup([a, x], { repos: { 'builder-a': ['acme'] } });
  for (const builder of [null, 'builder-a', 'builder-x']) {
    for (const args of [{ plan: 'P' }, { plan: 'P', repo: ['acme'] }, { plan: 'P', repo: 7 }, { plan: 'P', repo: '' }]) {
      const r = await relay.relay({ builder, action: 'launch', target: 'feat', args }, AUTH);
      assert.equal(r.status, 400, `${builder} ${JSON.stringify(args)}`);
      assert.equal(r.error, 'bad-args');
    }
  }
  // A valid repo that the hub config does not list for the chosen builder: 400, even when chosen explicitly.
  const notListed = await relay.relay({ builder: 'builder-x', action: 'launch', target: 'feat', args: { repo: 'acme', plan: 'P' } }, AUTH);
  assert.equal(notListed.status, 400);
  assert.equal(notListed.error, 'repo-not-allowed');
  const wrongRepo = await relay.relay({ builder: 'builder-a', action: 'launch', target: 'feat', args: { repo: 'other', plan: 'P' } }, AUTH);
  assert.equal(wrongRepo.status, 400);
  assert.equal(a.actions.length + x.actions.length, 0);
  assert.equal(lines().length, 0);
  // Listed: sent.
  const ok = await relay.relay({ builder: 'builder-a', action: 'launch', target: 'feat', args: { repo: 'acme', plan: 'P' } }, AUTH);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(a.actions.length, 1);
  // placement.any lets a builder with no hub list take an explicit launch; it never widens a configured list.
  const any = setup([a, x], { repos: { 'builder-a': ['acme'] }, cfg: { placement: { any: true } } });
  const xr = await any.relay.relay({ builder: 'builder-x', action: 'launch', target: 'feat', args: { repo: 'acme', plan: 'P' } }, AUTH);
  assert.equal(xr.ok, true, JSON.stringify(xr));
  const ar = await any.relay.relay({ builder: 'builder-a', action: 'launch', target: 'feat', args: { repo: 'other', plan: 'P' } }, AUTH);
  assert.equal(ar.status, 400);
});

test('SR11 M2: spawn is never auto-placed; a builder without a hub allowlist never attracts a launch', async () => {
  const a = await fake({ id: 'builder-a', capabilities: LAUNCH_CAPS, helloFields: { repos: ['acme'] } });
  const x = await fake({ id: 'builder-x', capabilities: LAUNCH_CAPS, helloFields: { repos: ['acme'] } });
  const { relay, store, lines } = setup([a, x], { repos: { 'builder-a': ['acme'] } });
  // builder-x lies: every slot free, a huge amount of memory, no load.
  store.applyDelta('builder-x', { box: lanesBox(4), vitals: { mem: { availableMb: 1e9, swapTotalMb: 0, swapUsedMb: 0 }, load: [0, 0, 0], cpus: 1e6 } }, Date.now());
  const sp = await relay.relay({ builder: null, action: 'spawn', target: 'new', args: { dir: '/tmp', prompt: 'SECRET plan' } }, AUTH);
  assert.equal(sp.status, 400);
  assert.equal(sp.error, 'builder-required');
  for (let i = 0; i < 3; i++) {
    const r = await relay.relay({ builder: null, action: 'launch', target: `feat-${i}`, args: { repo: 'acme', plan: 'P' } }, AUTH);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.builder, 'builder-a');
    assert.equal(r.placedBy, 'hub');
  }
  assert.equal(x.actions.length, 0);
  // The sent line records how the builder was chosen.
  const sent = lines().filter((e) => e.result.phase === 'sent');
  assert.ok(sent.every((e) => e.result.placedBy === 'hub' && typeof e.result.score === 'number'));
  // Nobody listed for the repo: nothing is sent.
  const none = await relay.relay({ builder: null, action: 'launch', target: 'feat', args: { repo: 'other', plan: 'P' } }, AUTH);
  assert.equal(none.status, 503);
  assert.equal(a.actions.length, 3);
});

test('SR11 L1: registerHubAction refuses builder-action names and duplicates unless override', () => {
  _resetHubActions();
  for (const name of ['approve', 'deny', 'send-text', 'set-budget', 'launch']) {
    assert.throws(() => registerHubAction(name, { run() {} }), /collides/, name);
  }
  assert.throws(() => registerHubAction('kill', { run() {} }), /collides/);
  assert.throws(() => registerHubAction('broadcast', { scope: 'fanout', run() {} }), /collides/);
  const store = createFleetStore({ builders: [], hubVersion: '0.1.0' });
  const relay = createRelay({ store, key: privateKey, audit: { append() {} } });
  assert.throws(() => relay.registerHubAction('approve', { run() {} }), /collides/);
  // The names C8, C9 and O8 use still register.
  const offs = [
    registerHubAction('broadcast', { run() {} }),
    registerHubAction('kill', { scope: 'fanout', run() {} }),
    relay.registerHubAction('ack-alarm', { run() {} }),
  ];
  // Duplicates across the module registry and an instance are refused.
  assert.throws(() => relay.registerHubAction('broadcast', { run() {} }), /already registered/);
  assert.throws(() => registerHubAction('kill', { scope: 'fanout', run() {} }), /already registered/);
  assert.throws(() => relay.registerHubAction('ack-alarm', { run() {} }), /already registered/);
  for (const off of offs) off();
  _resetHubActions();
});

test('SR11 R1: override is honoured only by a relay instance, only for its core allowlist', () => {
  _resetHubActions();
  const store = createFleetStore({ builders: [], hubVersion: '0.1.0' });
  const code = (c) => (e) => e instanceof HubActionError && e.code === c;
  // The module-level registry never honours override.
  assert.throws(() => registerHubAction('approve', { run() {}, override: true }), code(HUB_ACTION_ERRORS.overrideRefused));
  assert.throws(() => registerHubAction('broadcast', { run() {}, override: true }), code(HUB_ACTION_ERRORS.overrideRefused));
  // An instance without an allowlist (boot/hub.mjs passes an empty one) refuses it too.
  const plain = createRelay({ store, key: privateKey, audit: { append() {} } });
  assert.throws(() => plain.registerHubAction('approve', { run() {}, override: true }), code(HUB_ACTION_ERRORS.overrideRefused));
  // With an allowlist, only the listed names may override.
  const core = createRelay({ store, key: privateKey, audit: { append() {} }, coreOverrides: ['broadcast'] });
  const off1 = core.registerHubAction('broadcast', { run() {} });
  assert.throws(() => core.registerHubAction('broadcast', { run() {} }), code(HUB_ACTION_ERRORS.duplicate));
  const off2 = core.registerHubAction('broadcast', { run() {}, override: true });
  assert.throws(() => core.registerHubAction('approve', { run() {}, override: true }), code(HUB_ACTION_ERRORS.overrideRefused));
  assert.throws(() => core.registerHubAction('approve', { run() {} }), code(HUB_ACTION_ERRORS.collides));
  off1(); off2();
  _resetHubActions();
});

test('SR13 M1: remoteUser is the one predicate: local, missing, read-only and malformed users are refused', () => {
  assert.deepEqual(remoteUser({ kind: 'direct', user: 'alice@example.invalid' }), { ok: true, user: 'alice@example.invalid' });
  for (const a of [null, 'alice', [], { kind: 'local', user: 'local' }, { kind: 'hub', user: 'x' }, { kind: 'direct', user: 'local' },
    { kind: 'direct' }, { kind: 'direct', user: '' }]) {
    assert.deepEqual(remoteUser(a), { ok: false, status: 403, error: 'remote-only' }, JSON.stringify(a));
  }
  assert.equal(remoteUser({ kind: 'direct', user: 'a', readOnly: true }).error, 'read-only');
  assert.equal(remoteUser({ kind: 'direct', user: 'a b' }).error, 'bad-user');
});

test('SR11 L1: a module registration that collides with an instance one is refused at run time', async () => {
  _resetHubActions();
  const fb = await fake({ id: 'builder-a' });
  const { relay } = setup([fb]);
  relay.registerHubAction('ack-alarm', { run: () => 'instance' });
  const off = registerHubAction('ack-alarm', { run: () => 'module' });
  const r = await relay.relay({ builder: null, action: 'ack-alarm', target: 'a1', args: {} }, AUTH);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'hub-action-conflict');
  off();
  _resetHubActions();
});

test('SR11 L2: actingUser needs a direct auth object and honours readOnly', async () => {
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  const body = { builder: 'builder-a', action: 'interrupt', target: 'web', args: {} };
  const ro = await relay.relay(body, { kind: 'direct', user: USER, readOnly: true });
  assert.equal(ro.status, 403);
  assert.equal(ro.error, 'read-only');
  const str = await relay.relay(body, USER);
  assert.equal(str.status, 403);
  assert.equal(str.error, 'remote-only');
  assert.equal((await relay.send('builder-a', 'interrupt', 'web', {}, USER)).status, 403);
  assert.equal((await relay.fanout('pause', '*', { confirm: 'fleet' }, { ...AUTH, readOnly: true })).status, 403);
  assert.equal(fb.actions.length, 0);
  assert.equal(lines().length, 0);
});

test('SR11 L3: builder statuses map onto a fixed set; the raw one is builderStatus', async () => {
  const fb = await fake({ id: 'builder-a' });
  const cases = [
    [200, { ok: true, result: 1 }, 200], [299, { ok: true }, 200], [202, { ok: true }, 202],
    [200, { ok: false, error: 'no' }, 502], [403, { ok: false, error: 'control-disabled' }, 403], [409, { ok: false }, 409],
    [429, { ok: false }, 429], [401, { ok: false }, 502], [407, { ok: false }, 502], [418, { ok: false }, 502],
    [500, { ok: false }, 502], [503, { ok: false }, 502], [599, { ok: false }, 502],
  ];
  for (const [status, body, want] of cases) {
    const { relay } = setup([fb], { fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
    const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, AUTH);
    assert.equal(r.status, want, `${status} -> ${r.status}`);
    assert.equal(r.builderStatus, status);
  }
});

test('SR11 L4: a hub-local action is audited pending before it runs; an audit failure means it never runs', async () => {
  _resetHubActions();
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  let during = null;
  const off = registerHubAction('broadcast', {
    async run(req, ctx) {
      during = lines().map((e) => e.result);
      return { ok: true, result: await ctx.send('builder-a', 'send-text', 'web', { text: 'go' }) };
    },
  });
  const r = await relay.relay({ builder: '*', action: 'broadcast', target: '*', args: {} }, AUTH);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(during, [{ phase: 'pending', local: true }]);
  const es = lines();
  assert.deepEqual(es.map((e) => e.result.phase), ['pending', 'sent', 'done', 'done']);
  assert.equal(es[0].id, r.auditId);
  assert.equal(es[3].id, r.auditId);
  assert.equal(es[1].result.parent, r.auditId);
  assert.equal(es[2].result.parent, r.auditId);
  off();
  // Fail closed.
  let ran = false;
  const off2 = registerHubAction('broadcast', { run() { ran = true; return {}; } });
  const store = createFleetStore({ builders: [], hubVersion: '0.1.0' });
  const broken = createRelay({ store, key: privateKey, audit: { append() { throw new Error('disk full'); } } });
  const b = await broken.relay({ builder: '*', action: 'broadcast', target: '*', args: {} }, AUTH);
  assert.equal(b.status, 500);
  assert.equal(b.error, 'audit-failed');
  assert.equal(ran, false);
  off2();
  _resetHubActions();
});

test('SR11 L5: refusals never echo an unchecked builder field', async () => {
  const fb = await fake({ id: 'builder-a' });
  const { relay } = setup([fb]);
  const evil = `<img src=x onerror=alert(1)>${'x'.repeat(5000)}`;
  for (const body of [
    { builder: evil, action: 'interrupt', target: 'web', args: {} },
    { builder: evil, action: 'nope', target: 'web' },
    { builder: { x: 1 }, action: 'interrupt', target: 'web', args: {} },
    { builder: evil, fkey: 'builder-a/web', action: 'interrupt', args: {} },
  ]) {
    const r = await relay.relay(body, AUTH);
    assert.equal(r.ok, false);
    assert.equal(r.builder, null, JSON.stringify(r).slice(0, 200));
    assert.ok(!JSON.stringify(r).includes('onerror'));
  }
  assert.equal((await relay.send(evil, 'interrupt', 'web', {}, AUTH)).builder, null);
  assert.equal((await relay.relay({ builder: '*', action: 'kill', target: '*', args: { confirm: 'x' } }, AUTH)).builder, '*');
  assert.equal(fb.actions.length, 0);
});
