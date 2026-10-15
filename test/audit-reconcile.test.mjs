// Fleet H13: hub audit reconciliation + anchoring (server/hub/audit-reconcile.mjs, §3 2.15).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  reconcile, unknownOnHub, checkSegment, createAuditReconciler, hubActions, builderActions, FORK_ACTION, VIA,
  MATCH_ACTION, MISMATCH_CAP, UNKNOWN_SAMPLES, SKEW_MS, START_ONLY_MS, handleRebase,
} from '../server/hub/audit-reconcile.mjs';
import { createReadProxy } from '../server/hub/read-proxy.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { openAudit, GENESIS, ANCHOR_ACTION } from '../server/fleet/audit.mjs';

const hubKey = crypto.generateKeyPairSync('ed25519').privateKey;
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-h13-'));
  closers.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

const H = (c) => c.repeat(64);
const uuid = () => crypto.randomUUID();

// --- pure: reconcile --------------------------------------------------------------------------------------

function hubPair(id, { builder = 'builder-a', action = 'send-text', target = 's1', ok = true, status = 200, ts = 1000 } = {}) {
  const base = { id, user: 'u@example.invalid', via: 'hub', builder, action, target };
  const out = [{ ...base, ts, result: { phase: 'sent' } }];
  if (ok !== null) out.push({ ...base, ts: ts + 10, result: { phase: 'done', ok, status } });
  return out;
}

function builderPair(id, { builder = 'builder-a', action = 'send-text', target = 's1', ok = true, ts = 1005, start = true, h = 'a' } = {}) {
  const base = { id, user: 'u@example.invalid', via: 'hub', builder, action, target };
  const out = [];
  if (start) out.push({ ...base, ts, result: { phase: 'start' }, hash: H(h === 'a' ? 'b' : 'c') });
  if (ok !== null) out.push({ ...base, ts: ts + 1, result: { phase: start ? 'done' : undefined, ok, status: 200 }, hash: H(h) });
  return out;
}

test('reconcile: match, missing-on-builder, outcome-differs, unknown-settled; each action counted once', () => {
  const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
  const hub = [...hubPair(a), ...hubPair(b), ...hubPair(c, { ok: false, status: 409 }), ...hubPair(d, { ok: 'unknown', status: null })];
  const bld = [...builderPair(a), ...builderPair(c, { ok: true, h: 'd' }), ...builderPair(d, { ok: false, h: 'e' })];
  const rows = reconcile(hub, bld);
  assert.equal(rows.length, 4, 'one row per envelope id, not per entry');
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[a].state, 'match');
  assert.deepEqual(by[a].hub, { phase: 'done', ok: true });
  assert.deepEqual(by[a].builderEntry, { ok: true, hash: H('a') });
  assert.equal(by[a].builder, 'builder-a');
  assert.equal(by[b].state, 'missing-on-builder');
  assert.equal(by[b].builderEntry, null);
  assert.equal(by[c].state, 'outcome-differs');
  assert.equal(by[d].state, 'unknown-settled');
  assert.deepEqual(by[d].builderEntry, { ok: false, hash: H('e') });
  // a builder action counted once: start + done is one action
  assert.equal(builderActions(bld).size, 3);
  assert.equal(hubActions(hub).size, 4);
});

test('reconcile: a refusal (single outcome entry) matches a hub ok:false; a never-sent hub entry needs no builder entry', () => {
  const [a, b] = [uuid(), uuid()];
  const hub = [...hubPair(a, { ok: false, status: 403 }), ...hubPair(b, { ok: false, status: null })];
  const bld = builderPair(a, { ok: false, start: false });
  const by = Object.fromEntries(reconcile(hub, bld).map((r) => [r.id, r.state]));
  assert.equal(by[a], 'match');
  assert.equal(by[b], 'match');
});

test('reconcile: only via:hub builder entries for the same builder/action/target match', () => {
  const [a, b, c] = [uuid(), uuid(), uuid()];
  const hub = [...hubPair(a), ...hubPair(b), ...hubPair(c)];
  const bld = [
    ...builderPair(a).map((e) => ({ ...e, via: 'direct' })),
    ...builderPair(b, { action: 'kill' }),
    ...builderPair(c, { builder: 'builder-b' }),
  ];
  const by = Object.fromEntries(reconcile(hub, bld).map((r) => [r.id, r.state]));
  assert.equal(by[a], 'missing-on-builder');
  assert.equal(by[b], 'outcome-differs');
  assert.equal(by[c], 'outcome-differs');
});

test('reconcile: pending until the builder was pulled after the hub entry could land; start-only', () => {
  const [a, b, c] = [uuid(), uuid(), uuid()];
  const hub = [...hubPair(a, { ts: 1000 }), ...hubPair(b, { ok: 'unknown', status: null, ts: 1000 }), ...hubPair(c, { ts: 1000 })];
  const bld = [...builderPair(c, { ok: null })]; // start only
  const early = Object.fromEntries(reconcile(hub, bld, { pulledAt: { 'builder-a': 1005 } }).map((r) => [r.id, r.state]));
  assert.deepEqual([early[a], early[b], early[c]], ['pending', 'pending', 'pending']);
  const never = Object.fromEntries(reconcile(hub, bld, { pulledAt: {} }).map((r) => [r.id, r.state]));
  assert.equal(never[a], 'pending');
  const late = Object.fromEntries(reconcile(hub, bld, { pulledAt: { 'builder-a': 100_000 } }).map((r) => [r.id, r.state]));
  assert.deepEqual([late[a], late[b], late[c]], ['missing-on-builder', 'missing-on-builder', 'outcome-differs']);
});

test('reconcile: conflicting duplicate outcomes and hostile builder text', () => {
  const a = uuid();
  const hub = hubPair(a);
  const bld = [...builderPair(a), { ...builderPair(a)[1], hash: H('f'), result: { ok: false } }];
  assert.equal(reconcile(hub, bld)[0].state, 'outcome-differs');
  const evil = [{ id: uuid(), via: 'hub', builder: 'builder-a', action: 'x\u001b[31m'.padEnd(500, 'y'), target: '<b>', ts: 5, hash: H('9'), result: { ok: true } }];
  const u = unknownOnHub([], evil);
  assert.equal(u.length, 1);
  assert.ok(!/\u001b/.test(u[0].action));
  assert.ok(u[0].action.length <= 128);
  // malformed entries are ignored
  assert.equal(builderActions([null, 5, { id: 'x', via: 'hub', hash: 'nothex' }, { __proto__: null, id: 'y' }]).size, 0);
});

test('unknownOnHub: builder via:hub entries the hub never sent, judged only past the floor', () => {
  const [a, b, c] = [uuid(), uuid(), uuid()];
  const hub = hubPair(a);
  const bld = [...builderPair(a), ...builderPair(b, { ts: 50_000 }), ...builderPair(c, { ts: 10 })];
  const u = unknownOnHub(hub, bld, { floorTs: 1000 });
  assert.deepEqual(u.map((x) => x.id), [b]);
});

// --- pure: checkSegment -----------------------------------------------------------------------------------

function chainOf(n, dir = tmpDir(), name = 'audit.jsonl') {
  const a = openAudit({ file: path.join(dir, name), builder: 'builder-a' });
  for (let i = 0; i < n; i++) a.append({ via: 'local', action: 'note', target: `t${i}`, result: { ok: true } });
  return a;
}

test('checkSegment: a continuation verifies; forks are detected for every rewrite shape', () => {
  const a = chainOf(5);
  closers.push(() => a.close());
  const all = a.read({}).entries;
  const anchor = { hash: all[1].hash, count: 2 };
  const r = a.read({ after: anchor.hash });
  const ok = checkSegment(anchor, { builder: 'builder-a', ...r }, 'builder-a');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.tip, a.head());
  assert.equal(ok.entries.length, 3);
  // from genesis
  const g = checkSegment({ hash: GENESIS, count: 0 }, a.read({}), 'builder-a');
  assert.deepEqual(g.tip, a.head());

  const forkOf = (resp) => checkSegment(anchor, resp, 'builder-a');
  assert.equal(forkOf({ ...r, afterFound: false, entries: [] }).reason, 'after-not-found');
  assert.equal(forkOf({ ...r, afterIndex: 3 }).reason, 'index-mismatch');
  assert.equal(forkOf({ ...a.read({}), afterFound: undefined, afterIndex: undefined }).reason, 'not-chained'); // a builder ignoring `after`
  const tampered = structuredClone(r);
  tampered.entries[1].target = 'changed';
  assert.equal(forkOf(tampered).reason, 'chain-invalid');
  assert.equal(forkOf({ entries: [], head: { hash: all[0].hash, count: 1 }, more: false }).reason, 'count-regressed');
  assert.equal(forkOf({ entries: [], head: { hash: H('1'), count: 2 }, more: false }).reason, 'head-mismatch');
  // malformed answers are errors, not forks
  assert.deepEqual(forkOf(null), { ok: false, fork: false, reason: 'bad-response' });
  assert.equal(forkOf({ ...r, builder: 'builder-b' }).reason, 'wrong-builder');
  assert.equal(forkOf({ ...r, builder: 'builder-b' }).fork, false);
  assert.equal(forkOf({ entries: [], head: { hash: H('1'), count: 9 }, more: false }).fork, false);
});

// --- service with fake builders ---------------------------------------------------------------------------

/** A fake builder serving GET /api/v1/audit from a real audit chain (what A8's route does). */
async function fakeAuditBuilder(id, { mode = 'real' } = {}) {
  const dir = tmpDir();
  const file = path.join(dir, 'audit.jsonl');
  const state = { audit: openAudit({ file, builder: id }), mode, requests: [] };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push({ url: req.url, sig: req.headers['x-laneboard-sig'] ? 'yes' : 'no' });
    if (url.pathname !== '/api/v1/audit') { res.writeHead(404).end(); return; }
    const after = url.searchParams.get('after');
    const limit = url.searchParams.get('limit');
    let body;
    if (state.mode === 'ignore-after') body = state.audit.read({ limit });
    else body = state.audit.read({ after: after ?? undefined, limit });
    const text = JSON.stringify({ builder: id, ...body });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  closers.push(() => state.audit.close());
  return {
    id, url: `http://127.0.0.1:${srv.address().port}`, state, file,
    /** what dispatch writes for a relayed action: start + done (or one refusal entry) */
    act(env, { ok = true, refused = false } = {}) {
      const base = { id: env.id, user: env.user, via: 'hub', builder: id, action: env.action, target: env.target, argsHash: env.argsHash };
      if (!refused) state.audit.append({ ...base, result: { phase: 'start' } });
      return state.audit.append({ ...base, result: refused ? { ok: false, status: 409 } : { ok, status: 200, phase: 'done' } });
    },
    note(text) { return state.audit.append({ via: 'local', user: 'local', action: 'note', target: text, result: { ok: true } }); },
    /** an agent with a shell rewrites and re-chains the whole log */
    rewrite(n = 2) {
      state.audit.close();
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
      state.audit = openAudit({ file, builder: id });
      for (let i = 0; i < n; i++) state.audit.append({ via: 'local', action: 'note', target: `forged-${i}`, result: { ok: true } });
    },
  };
}

async function fleet(ids, opts = {}) {
  const fakes = [];
  for (const id of ids) fakes.push(await fakeAuditBuilder(id, opts));
  const store = createFleetStore({ builders: fakes.map((f) => ({ id: f.id, url: f.url })) });
  for (const f of fakes) store.setConn(f.id, { state: 'up', lastSeen: Date.now() });
  const proxy = createReadProxy({ store, key: hubKey });
  const hubDir = tmpDir();
  const hubFile = path.join(hubDir, 'hub-audit.jsonl');
  const hubAudit = openAudit({ file: hubFile, builder: null });
  closers.push(() => hubAudit.close());
  const mk = (extra = {}) => createAuditReconciler({ store, readProxy: proxy, audit: hubAudit, timers: { setInterval: () => null, clearInterval: () => {} }, ...extra });
  const svc = mk();
  /** what the relay writes for one envelope: sent + done, same id */
  function relay(f, { action = 'send-text', target = 's1', ok = true, status = 200 } = {}) {
    const env = { id: uuid(), user: 'u@example.invalid', action, target, argsHash: H('0') };
    const base = { id: env.id, user: env.user, via: 'hub', builder: f.id, action, target, argsHash: env.argsHash };
    hubAudit.append({ ...base, result: { phase: 'sent' } });
    return { env, done: () => hubAudit.append({ ...base, result: { phase: 'done', ok, status } }) };
  }
  return { fakes, store, proxy, hubAudit, hubFile, svc, mk, relay };
}

const anchorsIn = (hubAudit, builder) => hubAudit.read({}).entries.filter((e) => e.action === ANCHOR_ACTION && e.builder === builder);

test('service: pulls through the signed read proxy, anchors the head in the hub chain, matches relayed actions', async () => {
  const { fakes: [fa], svc, hubAudit, relay } = await fleet(['builder-a']);
  fa.note('before');
  const r1 = relay(fa);
  fa.act(r1.env);
  r1.done();
  await svc.tick();
  const head = fa.state.audit.head();
  assert.deepEqual(svc.anchors()['builder-a'], head);
  const anchors = anchorsIn(hubAudit, 'builder-a');
  assert.equal(anchors.length, 1);
  assert.deepEqual(anchors[0].result, { ok: true, head });
  assert.equal(anchors[0].target, 'builder-a');
  assert.equal(anchors[0].via, VIA);
  assert.equal(hubAudit.verifyAll().ok, true, 'anchors are appended to the hub chain');
  assert.ok(fa.state.requests.every((r) => r.sig === 'yes'), 'reads are signed');
  assert.equal(fa.state.requests[0].url, '/api/v1/audit?limit=1000');
  assert.deepEqual(svc.forks(), []);
  assert.deepEqual(svc.mismatches(), []);
  const list = svc.list({});
  const rows = list.entries.filter((e) => e.id === r1.env.id);
  assert.equal(rows.length, 1, 'one row per relayed action');
  assert.equal(rows[0].state, 'match');
  assert.equal(rows[0].ok, true);

  // an idle second pull asks after the anchor and writes no new anchor
  await svc.tick();
  assert.equal(fa.state.requests.at(-1).url, `/api/v1/audit?after=${head.hash}&limit=1000`);
  assert.equal(anchorsIn(hubAudit, 'builder-a').length, 1);

  // new builder entries move the anchor once
  fa.note('later');
  await svc.tick();
  assert.equal(anchorsIn(hubAudit, 'builder-a').length, 2);
  assert.deepEqual(svc.anchors()['builder-a'], fa.state.audit.head());
});

test('service: missing on builder, outcome differs, unknown settled, unknown-on-hub become audit-mismatch signals', async () => {
  const { fakes: [fa], svc, relay } = await fleet(['builder-a']);
  const missing = relay(fa);
  missing.done();
  const differs = relay(fa, { ok: false, status: 409 });
  fa.act(differs.env, { ok: true });
  differs.done();
  const unknown = relay(fa, { ok: 'unknown', status: null });
  fa.act(unknown.env, { ok: true });
  unknown.done();
  // an entry the builder claims came from the hub, which the hub never sent (needs to be past the hub floor)
  const forged = { id: uuid(), user: 'x', action: 'kill', target: 's9', argsHash: H('0') };
  await svc.tick();
  const svc2Clock = Date.now() + 10 * 60_000;
  fa.state.audit.close();
  fa.state.audit = openAudit({ file: fa.file, builder: 'builder-a', now: () => svc2Clock });
  fa.act(forged);

  // pulled before the relay could land -> pending, not a mismatch
  const states = Object.fromEntries(svc.list({}).entries.filter((e) => e.via === 'hub').map((e) => [e.id, e.state]));
  assert.equal(states[unknown.env.id], 'unknown-settled');
  assert.equal(states[differs.env.id], 'outcome-differs');
  assert.ok(['pending', 'missing-on-builder'].includes(states[missing.env.id]));

  await svc.tick();
  const sig = svc.signals();
  const byId = Object.fromEntries(sig.filter((s) => s.kind === 'audit-mismatch').map((s) => [s.id, s.state]));
  assert.equal(byId[differs.env.id], 'outcome-differs');
  assert.equal(byId[forged.id], 'unknown-on-hub');
  assert.equal(byId[unknown.env.id], undefined, 'a settled unknown is not a mismatch');
  assert.ok(sig.every((s) => s.builder === 'builder-a'));
});

test('service: missing-on-builder once the builder was pulled after the entry settled', async () => {
  let t = Date.now();
  const f = await fleet(['builder-a']);
  const svc = f.mk({ now: () => t });
  const missing = f.relay(f.fakes[0]);
  missing.done();
  t += 10_000; // past done + grace, and the builder still `up` (staleMs 15 s)
  await svc.tick();
  const m = svc.mismatches();
  assert.deepEqual(m.map((x) => [x.id, x.state, x.kind]), [[missing.env.id, 'missing-on-builder', 'audit-mismatch']]);
});

test('service: a rewritten builder chain after an anchor raises audit-fork (sticky, durable, O8 shape)', async () => {
  const f = await fleet(['builder-a', 'builder-b']);
  const [fa, fb] = f.fakes;
  fa.note('one');
  fa.note('two');
  fb.note('b-one');
  await f.svc.tick();
  const anchored = f.svc.anchors()['builder-a'];
  assert.equal(anchored.count, 2);
  fa.rewrite(3);
  await f.svc.tick();
  const forks = f.svc.forks();
  assert.equal(forks.length, 1);
  assert.equal(forks[0].builder, 'builder-a');
  assert.equal(forks[0].reason, 'after-not-found');
  assert.match(forks[0].text, /builder-a/);
  assert.deepEqual(f.svc.anchors()['builder-a'], anchored, 'the anchor is not moved past a fork');
  assert.ok(f.svc.signals().some((s) => s.kind === 'audit-fork' && s.builder === 'builder-a'));
  const forkEntries = f.hubAudit.read({}).entries.filter((e) => e.action === FORK_ACTION);
  assert.equal(forkEntries.length, 1);
  // a further pull keeps the fork and records it only once
  await f.svc.tick();
  assert.equal(f.svc.forks().length, 1);
  assert.equal(f.hubAudit.read({}).entries.filter((e) => e.action === FORK_ACTION).length, 1);

  // a hub restart recovers the anchors and the fork from the hub chain
  const svc2 = f.mk();
  assert.deepEqual(svc2.anchors()['builder-a'], anchored);
  assert.deepEqual(svc2.anchors()['builder-b'], fb.state.audit.head());
  assert.equal(svc2.forks()[0]?.builder, 'builder-a');

  // O8's derive turns it into an audit-fork alarm
  const { derive } = await import('../server/fleet/alarms.mjs');
  const alarms = derive({ builders: [], auditForks: svc2.forks() }, Date.now());
  assert.deepEqual(alarms.map((a) => [a.kind, a.builder]), [['audit-fork', 'builder-a']]);

  // a human rebase clears it and re-anchors from genesis
  assert.equal(svc2.rebase('builder-a'), true);
  await svc2.tick();
  assert.deepEqual(svc2.forks(), []);
  assert.deepEqual(svc2.anchors()['builder-a'], fa.state.audit.head());
  assert.equal(f.hubAudit.verifyAll().ok, true);
});

test('service: a builder that ignores `after` and serves a re-chained log is a fork too', async () => {
  const f = await fleet(['builder-a']);
  const [fa] = f.fakes;
  fa.note('x');
  await f.svc.tick();
  fa.state.mode = 'ignore-after';
  fa.note('y');
  await f.svc.tick();
  assert.equal(f.svc.forks()[0]?.reason, 'not-chained');
});

test('service: down builders and bad answers are skipped without a fork; never writes to a builder', async () => {
  const f = await fleet(['builder-a']);
  const [fa] = f.fakes;
  f.store.setConn('builder-a', { state: 'down' });
  await f.svc.tick();
  assert.equal(fa.state.requests.length, 0);
  const calls = [];
  const svc = createAuditReconciler({
    store: { view: () => ({ builders: [{ id: 'builder-a', state: 'up' }] }) },
    readProxy: { get: async (id, p) => { calls.push(p); return { status: 200, json: { entries: 'nope' } }; } },
    audit: f.hubAudit,
  });
  await svc.tick();
  assert.deepEqual(svc.forks(), []);
  assert.equal(svc.status()['builder-a'].error, 'bad-response');
  assert.ok(calls.every((p) => p.startsWith('/api/v1/audit?')));
  const svc503 = createAuditReconciler({
    store: { view: () => ({ builders: [{ id: 'builder-a', state: 'up' }] }) },
    readProxy: { get: async () => ({ status: 503, json: { ok: false, error: 'builder down' } }) },
    audit: f.hubAudit,
  });
  await svc503.tick();
  assert.equal(svc503.status()['builder-a'].error, 'builder-down');
  assert.deepEqual(svc503.forks(), []);
});

test('service: once on reconnect, and pages past a long chain', async () => {
  const f = await fleet(['builder-a']);
  const [fa] = f.fakes;
  for (let i = 0; i < 25; i++) fa.note(`n${i}`);
  // small pages through a stub proxy that forwards to the real one with a lower limit
  const small = { get: (id, p, o) => f.proxy.get(id, p.replace('limit=1000', 'limit=10'), o) };
  const svc = createAuditReconciler({ store: f.store, readProxy: small, audit: f.hubAudit, maxPages: 2, timers: { setInterval: () => null, clearInterval: () => {} } });
  await svc.tick();
  assert.equal(svc.anchors()['builder-a'].count, 20, 'two pages per pull, anchored at the verified tip');
  assert.equal(svc.status()['builder-a'].pulledAt, null, 'not complete yet');
  await svc.tick();
  assert.deepEqual(svc.anchors()['builder-a'], fa.state.audit.head());
  assert.ok(svc.status()['builder-a'].pulledAt !== null);

  svc.start();
  closers.push(() => svc.stop());
  await new Promise((r) => setImmediate(r));
  await svc.pull('builder-a');
  const before = fa.state.requests.length;
  f.store.setConn('builder-a', { state: 'down' });
  f.store.setConn('builder-a', { state: 'up', lastSeen: Date.now() });
  await new Promise((r) => setTimeout(r, 50));
  await svc.pull('builder-a');
  assert.ok(fa.state.requests.length > before, 'a reconnect triggers a pull');
});

// --- SR14 regressions -------------------------------------------------------------------------------------

const noTimers = { setInterval: () => null, clearInterval: () => {} };

test('SR14 M1: a 5,001-entry via:hub flood with a future ts neither hides a missing hub action nor grows hub state', async () => {
  const f = await fleet(['builder-a', 'builder-b']);
  const [fa] = f.fakes;
  let t = Date.now();
  const svc = f.mk({ now: () => t });
  // control: a relayed kill the builder never recorded, and one it did record
  const missing = f.relay(fa, { action: 'kill', target: 's2' });
  missing.done();
  const okOne = f.relay(fa);
  fa.act(okOne.env);
  okOne.done();
  // an envelope the hub sent to builder-b, claimed by builder-a
  const other = f.relay(f.fakes[1]);
  other.done();
  // the flood: correctly chained lines appended by an agent with a shell on builder-a
  fa.state.audit.close();
  fa.state.audit = openAudit({ file: fa.file, builder: 'builder-a', now: () => 8e15 });
  fa.act(other.env);
  for (let i = 0; i < 5001; i++) {
    fa.state.audit.append({ id: uuid(), user: 'x', via: 'hub', builder: 'builder-a', action: 'kill', target: `j${i}`, argsHash: H('0'), result: { ok: true } });
  }
  const hubBefore = f.hubAudit.read({}).entries.length;
  const heapBefore = process.memoryUsage().heapUsed;
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc.tick();
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 64 * 1024 * 1024, 'bounded memory');
  const st = svc.status()['builder-a'];
  assert.equal(st.error, null);
  assert.equal(st.indexed, 1, 'only the envelope the hub sent to builder-a is indexed');
  assert.equal(st.unknownOnHub, 5002);
  const m = svc.mismatches();
  const hubSide = m.filter((x) => x.state !== 'unknown-on-hub' && x.builder === 'builder-a');
  assert.deepEqual(hubSide.map((x) => [x.id, x.state]), [[missing.env.id, 'missing-on-builder']]);
  const unk = m.filter((x) => x.state === 'unknown-on-hub');
  assert.equal(unk.length, 1, 'one aggregate row per builder');
  assert.equal(unk[0].builder, 'builder-a');
  assert.equal(unk[0].count, 5002);
  assert.equal(unk[0].first.length, UNKNOWN_SAMPLES);
  assert.equal(unk[0].last.length, UNKNOWN_SAMPLES);
  assert.equal(unk[0].first[0].id, other.env.id);
  for (const x of [...unk[0].first, ...unk[0].last]) assert.ok(x.ts <= t + SKEW_MS, 'builder ts clamped to the hub window');
  // list() agrees with mismatches()
  const states = Object.fromEntries(svc.list({}).entries.filter((e) => e.via === 'hub').map((e) => [e.id, e.state]));
  assert.equal(states[missing.env.id], 'missing-on-builder');
  assert.equal(states[okOne.env.id], 'match');
  // hub chain growth is bounded by the hub's own records: one match record entry, one anchor
  const added = f.hubAudit.read({}).entries.slice(hubBefore);
  assert.deepEqual(added.map((e) => e.action).sort(), [ANCHOR_ACTION, MATCH_ACTION]);
  assert.equal(added.find((e) => e.action === MATCH_ACTION).result.matched.length, 2, 'start + done of the one real envelope');
  // a second flood pull: still one aggregate row, hub-side rows still first
  for (let i = 0; i < 300; i++) fa.state.audit.append({ id: uuid(), via: 'hub', builder: 'builder-a', action: 'kill', target: 'k', argsHash: H('0'), result: { ok: true } });
  await svc.tick();
  const m2 = svc.mismatches();
  assert.equal(m2[0].id, missing.env.id);
  assert.equal(m2.filter((x) => x.state === 'unknown-on-hub').length, 1);
  assert.ok(m2.length <= MISMATCH_CAP + 2);
});

test('SR14 M2: after a hub restart earlier matches stay matched; real mismatches stay reported', async () => {
  const f = await fleet(['builder-a']);
  const [fa] = f.fakes;
  let t = Date.now();
  const a = f.relay(fa);
  fa.act(a.env);
  a.done();
  const differs = f.relay(fa, { ok: false, status: 409 });
  fa.act(differs.env, { ok: true });
  differs.done();
  const missing = f.relay(fa);
  missing.done();
  const svc = f.mk({ now: () => t });
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc.tick();
  const st1 = Object.fromEntries(svc.list({}).entries.filter((e) => e.via === 'hub').map((e) => [e.id, e.state]));
  assert.deepEqual([st1[a.env.id], st1[differs.env.id], st1[missing.env.id]], ['match', 'outcome-differs', 'missing-on-builder']);

  // restart: a new reconciler on the same hub log; the builder has moved on since
  fa.note('after');
  const svc2 = f.mk({ now: () => t });
  assert.equal(svc2.status()['builder-a'].indexed, 2, 'the index is rebuilt from the hub chain');
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc2.tick();
  const st2 = Object.fromEntries(svc2.list({}).entries.filter((e) => e.via === 'hub').map((e) => [e.id, e.state]));
  assert.equal(st2[a.env.id], 'match', 'not falsely missing after a restart');
  assert.equal(st2[differs.env.id], 'outcome-differs');
  assert.equal(st2[missing.env.id], 'missing-on-builder');
  assert.deepEqual(svc2.mismatches().map((x) => x.id).sort(), [differs.env.id, missing.env.id].sort());
  const row = svc2.list({}).entries.find((e) => e.id === a.env.id);
  assert.equal(row.builderEntry.ok, true);
  assert.match(row.builderEntry.hash, /^[0-9a-f]{64}$/);
  assert.equal(f.hubAudit.verifyAll().ok, true);
  // many matched envelopes in one pull are chunked under the audit result cap
  for (let i = 0; i < 80; i++) {
    const r = f.relay(fa);
    fa.act(r.env);
    r.done();
  }
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc2.tick();
  const chunks = f.hubAudit.read({}).entries.filter((e) => e.action === MATCH_ACTION);
  assert.ok(chunks.length > 2);
  const svc3 = f.mk({ now: () => t });
  assert.equal(svc3.status()['builder-a'].indexed, 82);
  await svc3.tick();
  assert.deepEqual(svc3.mismatches().map((x) => x.id).sort(), [differs.env.id, missing.env.id].sort());
});

test('SR14 L1: once anchored, an answer without a head is bad-response, not a pass', () => {
  const a = chainOf(3);
  closers.push(() => a.close());
  const all = a.read({}).entries;
  const anchor = { hash: all[0].hash, count: 1 };
  const r = a.read({ after: anchor.hash });
  assert.equal(checkSegment(anchor, { ...r }, 'builder-a').ok, true);
  assert.deepEqual(checkSegment(anchor, { ...r, head: undefined }, 'builder-a'), { ok: false, fork: false, reason: 'bad-response' });
  assert.deepEqual(checkSegment(anchor, { ...r, head: { hash: 5 } }, 'builder-a'), { ok: false, fork: false, reason: 'bad-response' });
  assert.equal(checkSegment(anchor, { ...r, afterFound: 'yes' }, 'builder-a').reason, 'bad-response');
  // from genesis a head is optional
  assert.equal(checkSegment({ hash: GENESIS, count: 0 }, { entries: a.read({}).entries }, 'builder-a').ok, true);
});

test('SR14 L2: a start-only builder entry for a hub-unknown outcome is not pending forever', () => {
  const id = uuid();
  const hub = hubPair(id, { ok: 'unknown', status: null, ts: 1000 });
  const bld = builderPair(id, { ok: null });
  const at = (pulled) => reconcile(hub, bld, { pulledAt: { 'builder-a': pulled } })[0].state;
  assert.equal(at(100_000), 'pending');
  assert.equal(at(1010 + 5_000 + START_ONLY_MS + 1), 'outcome-differs');
});

test('SR14 L3: a failed pull does not stamp lastOkAt', async () => {
  const f = await fleet(['builder-a']);
  const svc = createAuditReconciler({
    store: { view: () => ({ builders: [{ id: 'builder-a', state: 'up' }] }) },
    readProxy: { get: async () => ({ status: 503, json: { ok: false } }) },
    audit: f.hubAudit, timers: noTimers,
  });
  await svc.tick();
  assert.equal(svc.status()['builder-a'].lastOkAt, null);
  await f.svc.tick();
  assert.ok(Number.isFinite(f.svc.status()['builder-a'].lastOkAt));
});

test('SR14 L4: rebase onto the builder head clears a fork; handleRebase is direct-only and typed-confirm', async () => {
  const f = await fleet(['builder-a']);
  const [fa] = f.fakes;
  let t = Date.now();
  const svc = f.mk({ now: () => t });
  fa.note('one');
  await svc.tick();
  const before = f.relay(fa); // sent before the reset, its builder entry is gone with the old log
  before.done();
  fa.rewrite(3);
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc.tick();
  assert.equal(svc.forks()[0]?.reason, 'after-not-found');

  assert.deepEqual(await handleRebase(svc, { builder: 'builder-a', confirm: 'builder-a', onto: 'head', auth: { kind: 'local' } }), { status: 403, body: { ok: false, error: 'remote-only' } });
  assert.equal((await handleRebase(svc, { builder: 'builder-a', confirm: 'builder-b', onto: 'head', auth: { kind: 'direct', user: 'u@example.invalid' } })).status, 400);
  assert.equal((await handleRebase(svc, { builder: 'builder-a', confirm: 'builder-a', onto: 'x', auth: { kind: 'direct' } })).status, 400);
  assert.equal((await handleRebase(svc, { builder: '../x', confirm: '../x', auth: { kind: 'direct' } })).status, 404);
  assert.deepEqual(svc.forks().length, 1, 'refused requests change nothing');
  const r = await handleRebase(svc, { builder: 'builder-a', confirm: 'builder-a', onto: 'head', auth: { kind: 'direct', user: 'u@example.invalid' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.head, fa.state.audit.head());
  const rebaseEntry = f.hubAudit.read({}).entries.filter((e) => e.action === ANCHOR_ACTION && e.result.rebased === true).at(-1);
  assert.equal(rebaseEntry.user, 'u@example.invalid', 'audited with the user');
  assert.deepEqual(svc.forks(), []);
  fa.note('two');
  const afterR = f.relay(fa);
  fa.act(afterR.env);
  afterR.done();
  t += 10_000;
  for (const x of f.fakes) f.store.setConn(x.id, { state: 'up', lastSeen: t });
  await svc.tick();
  assert.deepEqual(svc.forks(), []);
  assert.deepEqual(svc.anchors()['builder-a'], fa.state.audit.head());
  const st = Object.fromEntries(svc.list({}).entries.filter((e) => e.via === 'hub').map((e) => [e.id, e.state]));
  assert.equal(st[before.env.id], 'pending', 'sent before the head rebase: not judged');
  assert.equal(st[afterR.env.id], 'match');
  assert.deepEqual(svc.mismatches(), []);
  // a restart keeps all of it
  const svc2 = f.mk({ now: () => t });
  await svc2.tick();
  assert.deepEqual(svc2.forks(), []);
  assert.deepEqual(svc2.mismatches(), []);
  assert.equal(f.hubAudit.verifyAll().ok, true);
  // genesis rebase still works and an invalid head is refused
  assert.equal(svc2.rebase('builder-a', { head: { hash: 'zz', count: 1 } }), false);
  assert.equal((await handleRebase(svc2, { builder: 'builder-a', confirm: 'builder-a', auth: { kind: 'direct' } })).status, 200);
  assert.deepEqual(svc2.anchors()['builder-a'], { hash: GENESIS, count: 0 });
});

test('hub module imports no builder-only module', () => {
  const src = fs.readFileSync(new URL('../server/hub/audit-reconcile.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith('../fleet/') || i.startsWith('node:'), i);
});
