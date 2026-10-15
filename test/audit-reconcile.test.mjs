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

test('hub module imports no builder-only module', () => {
  const src = fs.readFileSync(new URL('../server/hub/audit-reconcile.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith('../fleet/') || i.startsWith('node:'), i);
});
