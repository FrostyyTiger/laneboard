// Hub action relay (fleet plan §3 2.10, H8). Uses the in-process fake builder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRelay, validateArgs, RelayError, ACTIONS, registerHubAction, _resetHubActions } from '../server/hub/relay.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { verifyEnvelope, _resetForTests } from '../server/fleet/auth.mjs';
import { keyId as keyIdOf } from '../server/fleet/keys-ed25519.mjs';
import { fakeBuilder, hubSigner } from './helpers/fake-builder.mjs';

const USER = 'alice@example.invalid';
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
  const r1 = await relay.relay(body, USER);
  const r2 = await relay.relay({ ...body }, USER);
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
  for (const u of ['local', '', null, undefined, { kind: 'local', user: 'local' }, { kind: 'hub', user: null }]) {
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
  const r = await relay.relay({ builder: 'builder-a', action: 'kill', target: 'web', args: { confirm: 'web' } }, USER);
  assert.equal(r.status, 503);
  assert.equal(r.error, 'builder down');
  assert.equal(r.state, 'down');
  // Coming back up later does not deliver anything.
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now() });
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(fb.actions.length, 0);
  assert.equal(lines().length, 0);
  const u = await relay.relay({ builder: 'builder-z', action: 'kill', target: 'web', args: { confirm: 'web' } }, USER);
  assert.equal(u.status, 404);
});

test('a timeout gives ok:false, error timeout, outcome unknown, with no retry (1 request)', async () => {
  const fb = await fake({ id: 'builder-a', onAction: () => new Promise((res) => setTimeout(() => res({ ok: true, result: {} }), 600)) });
  const { relay, lines } = setup([fb], { cfg: { actionTimeoutMs: 100 } });
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
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
  const r = await relay.relay({ builder: 'builder-a', action: 'send-text', target: 'web', args: { text: 'secret prompt' } }, USER);
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
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
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
  const r = await relay.relay({ fkey: 'builder-b/web', action: 'send-text', args: { text: 'x' } }, USER);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.builder, 'builder-b');
  assert.equal(a.actions.length, 0);
  assert.equal(b.actions.length, 1);
  assert.equal(b.actions[0].envelope.target, 'web');
  const mism = await relay.relay({ fkey: 'builder-b/web', builder: 'builder-a', action: 'send-text', args: { text: 'x' } }, USER);
  assert.equal(mism.status, 400);
  const unknown = await relay.relay({ fkey: 'builder-q/web', action: 'send-text', args: { text: 'x' } }, USER);
  assert.equal(unknown.status, 404);
  const bad = await relay.relay({ fkey: 'no-slash', action: 'send-text', args: { text: 'x' } }, USER);
  assert.equal(bad.status, 400);
  assert.equal(a.actions.length + b.actions.length, 1);
});

test('a registered hub-local action runs instead of relaying; hub-only actions are never relayed', async () => {
  _resetHubActions();
  const fb = await fake({ id: 'builder-a' });
  const { relay, lines } = setup([fb]);
  const none = await relay.relay({ builder: null, action: 'ack-alarm', target: 'a1', args: {} }, USER);
  assert.equal(none.status, 503);
  assert.equal(fb.actions.length, 0);
  const seen = [];
  const off = relay.registerHubAction('ack-alarm', { run: (req, ctx) => { seen.push([req, ctx.user]); return { acked: 1 }; } });
  const r = await relay.relay({ builder: 'builder-a', action: 'ack-alarm', target: 'a1', args: { tile: 'STCK' } }, USER);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { acked: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], USER);
  assert.equal(fb.actions.length, 0);
  const es = lines();
  assert.equal(es.length, 1);
  assert.equal(es[0].result.phase, 'local');
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
  const br = await relay.relay({ builder: '*', action: 'broadcast', target: '*', args: { targets: ['builder-a/web', 'builder-a/api'], text: 'go' } }, USER);
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
  const wrong = await relay.relay({ builder: '*', action: 'pause', target: '*', args: { confirm: 'builder-a' } }, USER);
  assert.equal(wrong.status, 400);
  assert.equal(a.actions.length + b.actions.length, 0);
  const r = await relay.relay({ builder: '*', action: 'pause', target: '*', args: { confirm: 'fleet', interrupt: true } }, USER);
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
  const k = await relay.relay({ builder: '*', action: 'kill', target: '*', args: { confirm: 'fleet' } }, USER);
  assert.equal(k.status, 400);
  assert.equal(a.actions.length, 1);
});

test('spawn/launch with no builder are placed by the hub; an explicit ineligible builder gets a warning', async () => {
  const caps = ['snapshot', 'stream', 'actions', 'launch'];
  const a = await fake({ id: 'builder-a', capabilities: caps, helloFields: { repos: ['acme'] } });
  const b = await fake({ id: 'builder-b', capabilities: caps, helloFields: { repos: ['acme', 'other'] } });
  // builder-b claims `other`, but the hub config allows it only `acme`.
  const { relay, store } = setup([a, b], { repos: { 'builder-b': ['acme'] } });
  store.applyDelta('builder-a', { box: lanesBox(0) }, Date.now());
  const r = await relay.relay({ builder: null, action: 'launch', target: 'feat-x', args: { repo: 'acme', plan: 'p' } }, USER);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.builder, 'builder-b');
  assert.equal(r.placedBy, 'hub');
  assert.equal(typeof r.score, 'number');
  const none = await relay.relay({ action: 'launch', target: 'feat-y', args: { repo: 'other', plan: 'p' } }, USER);
  assert.equal(none.status, 503);
  assert.equal(none.error, 'no-eligible-builder');
  assert.equal(b.actions.length, 1);
  const forced = await relay.relay({ builder: 'builder-a', action: 'launch', target: 'feat-z', args: { repo: 'acme', plan: 'p' } }, USER);
  assert.equal(forced.ok, true);
  assert.match(forced.warning, /no free lane slot/);
  assert.equal(a.actions.length, 1);
  const noBuilder = await relay.relay({ action: 'kill', target: 'web', args: { confirm: 'web' } }, USER);
  assert.equal(noBuilder.status, 400);
});

test('network outcomes: refused connection is ok:false, oversize and redirect are not trusted', async () => {
  const fb = await fake({ id: 'builder-a' });
  const mk = (impl) => setup([fb], { fetchImpl: impl });
  const refused = mk(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
  const r1 = await refused.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
  assert.equal(r1.ok, false);
  assert.equal(r1.error, 'unreachable');
  assert.equal(refused.lines().at(-1).result.ok, false);
  let calls = 0;
  const big = mk(async (url, init) => { calls++; assert.equal(init.redirect, 'manual'); return new Response('x'.repeat(70 * 1024), { status: 200 }); });
  const r2 = await big.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
  assert.equal(r2.outcome, 'unknown');
  assert.equal(r2.error, 'response-too-large');
  assert.equal(calls, 1);
  const redir = mk(async () => new Response('', { status: 307, headers: { location: 'http://127.0.0.1:1/api/v1/actions' } }));
  const r3 = await redir.relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
  assert.equal(r3.ok, false);
  assert.equal(r3.error, 'redirect-refused');
});

test('an audit failure before sending means nothing is sent', async () => {
  const fb = await fake({ id: 'builder-a' });
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: fb.url }], hubVersion: '0.1.0' });
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now(), hello: fb.hello });
  const audit = { append() { throw new Error('disk full'); } };
  const relay = createRelay({ store, key: privateKey, audit });
  const r = await relay.relay({ builder: 'builder-a', action: 'interrupt', target: 'web', args: {} }, USER);
  assert.equal(r.status, 500);
  assert.equal(r.error, 'audit-failed');
  assert.equal(fb.actions.length, 0);
});
