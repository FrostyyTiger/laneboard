// Upstream client per builder (fleet H6, §3 2.3): a real Upstream against the
// in-process fake builder (test/helpers/fake-builder.mjs), which verifies every
// signature with the real primitives.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeBuilder } from './helpers/fake-builder.mjs';
import { publicKeyString } from '../server/fleet/keys-ed25519.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { Upstream, backoffMs, classify, createUpstreams, DEFAULTS } from '../server/hub/upstream.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const silentLog = { warn() {}, info() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, { timeout = 3000, step = 10, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}

const FAST = { staleMs: 300, downMs: 900, tickMs: 20, pingMs: 100, closeGraceMs: 200 };

/**
 * A fake builder pinned to a fresh hub key, a store, and an Upstream wired to them.
 * `fb` options go to fakeBuilder; `cfg` overrides FAST; `up` overrides Upstream options.
 */
async function setup(t, { fb: fbOpts = {}, cfg = {}, up: upOpts = {}, id = 'builder-a', start = true } = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const fb = await fakeBuilder({
    id: fbOpts.id ?? id,
    sessions: ['alpha', 'beta'],
    hubKeys: [{ key: publicKeyString(privateKey), id: 'hub', scopes: ['read'] }],
    ...fbOpts,
  });
  const builder = { id, url: fb.url };
  const store = createFleetStore({ builders: [builder], hubVersion: '0.1.0', staleMs: FAST.staleMs, downMs: FAST.downMs });
  const up = new Upstream({ builder, key: privateKey, store, cfg: { ...FAST, ...cfg }, log: silentLog, backoff: () => 30, ...upOpts });
  const closes = [];
  const origPush = fb.streams.add.bind(fb.streams);
  fb.streams.add = (ws) => { ws.once('close', (code) => closes.push(code)); return origPush(ws); };
  t.after(async () => { up.stop(); await fb.close(); });
  if (start) up.start();
  return { fb, store, up, builder, privateKey, closes };
}

const upgrades = (fb) => fb.requests.filter((r) => r.method === 'UPGRADE');
const snapshotGets = (fb) => fb.requests.filter((r) => r.method === 'GET' && r.url === '/api/v1/snapshot');
const names = (store, id = 'builder-a') => [...(store.builder(id).snap?.sessions.keys() ?? [])].sort();
const up = (u) => waitFor(() => u.status().state === 'up' && u.status().seq !== null, { what: 'state up' });

// --- pure helpers ----------------------------------------------------------------------------------

test('backoffMs is monotone up to the 30 s cap with jitter within ±20 %', () => {
  let prev = 0;
  for (let n = 0; n < 40; n++) {
    const mid = backoffMs(n, () => 0.5);
    const lo = backoffMs(n, () => 0);
    const hi = backoffMs(n, () => 1);
    const base = Math.min(30_000, 500 * 1.8 ** n);
    assert.equal(mid, Math.round(base), `n=${n} midpoint`);
    assert.equal(lo, Math.round(base * 0.8), `n=${n} low`);
    assert.equal(hi, Math.round(base * 1.2), `n=${n} high`);
    assert.ok(mid >= prev, `monotone at n=${n}`);
    prev = mid;
    for (let i = 0; i < 20; i++) {
      const v = backoffMs(n);
      assert.ok(v >= base * 0.8 - 1 && v <= base * 1.2 + 1, `jitter in range at n=${n}`);
    }
  }
  assert.equal(backoffMs(0, () => 0.5), 500);
  assert.equal(backoffMs(100, () => 0.5), 30_000);
  assert.equal(backoffMs(100, () => 1), 36_000);
  assert.equal(backoffMs(-3, () => 0.5), 500);
  assert.equal(backoffMs(NaN, () => NaN), 500);
});

test('classify: up / stale / down / connecting; a closed socket is stale, not down', () => {
  const c = (o) => classify({ staleMs: 15_000, downMs: 60_000, now: 100_000, ...o });
  assert.equal(c({ lastSeen: 99_000, connected: true }), 'up');
  assert.equal(c({ lastSeen: 99_000, connected: false }), 'stale');
  assert.equal(c({ lastSeen: 80_000, connected: true }), 'stale');
  assert.equal(c({ lastSeen: 40_001, connected: false }), 'stale');
  assert.equal(c({ lastSeen: 40_000, connected: false }), 'down');
  assert.equal(c({ lastSeen: 0, connected: true }), 'down');
  assert.equal(c({ lastSeen: null, connected: false }), 'connecting');
  assert.equal(c({ lastSeen: null, connected: false, since: 90_000 }), 'connecting');
  assert.equal(c({ lastSeen: null, connected: false, since: 40_000 }), 'down');
});

test('DEFAULTS follow the plan', () => {
  assert.equal(DEFAULTS.staleMs, 15_000);
  assert.equal(DEFAULTS.downMs, 60_000);
  assert.equal(DEFAULTS.pingMs, 5_000);
  assert.equal(DEFAULTS.maxPayload, 8 * 1024 * 1024);
  assert.equal(DEFAULTS.maxBytesPerSec, 2 * 1024 * 1024);
  assert.equal(DEFAULTS.helloMaxBytes, 64 * 1024);
  assert.equal(DEFAULTS.snapshotMaxBytes, 8 * 1024 * 1024);
  assert.equal(DEFAULTS.helloTimeoutMs, 10_000);
  assert.equal(DEFAULTS.snapshotTimeoutMs, 10_000);
  assert.equal(DEFAULTS.resyncBufferFrames, 200);
  assert.equal(DEFAULTS.retryMisconfiguredMs, 60_000);
  assert.throws(() => new Upstream({ builder: { id: 'Bad Id', url: 'http://127.0.0.1:1' }, store: createFleetStore() }), /builder id/);
  assert.throws(() => new Upstream({
    builder: { id: 'builder-a', url: 'http://127.0.0.1:1' },
    store: createFleetStore({ builders: [{ id: 'builder-a' }] }),
    cfg: { staleMs: 10, downMs: 5 },
  }), /staleMs/);
});

// --- hello -----------------------------------------------------------------------------------------

test('hello id mismatch gives misconfigured, opens no stream and does not retry before 60 s', async (t) => {
  const { fb, store, up: u } = await setup(t, { fb: { helloFields: { id: 'builder-x' } } });
  await waitFor(() => u.status().state === 'misconfigured', { what: 'misconfigured' });
  await sleep(150);
  assert.equal(store.builder('builder-a').conn.state, 'misconfigured');
  assert.equal(u.status().error, 'hello id mismatch');
  assert.equal(upgrades(fb).length, 0, 'no stream to a builder that is not who we think');
  assert.equal(fb.requests.filter((r) => r.url === '/api/v1/hello').length, 1, 'one hello, the retry is 60 s away');
  assert.equal(store.builder('builder-a').snap, null);
});

test('apiVersion 2 gives incompatible (read-only: no stream)', async (t) => {
  const { fb, store, up: u } = await setup(t, { fb: { apiVersion: 2 } });
  await waitFor(() => u.status().state === 'incompatible', { what: 'incompatible' });
  await sleep(100);
  assert.equal(store.builder('builder-a').conn.state, 'incompatible');
  assert.equal(store.builder('builder-a').hello.apiVersion, 2);
  assert.equal(upgrades(fb).length, 0);
  assert.equal(store.view(Date.now()).builders[0].controls, false);
});

test('hello records version skew and clock skew', async (t) => {
  const { store, up: u } = await setup(t, { fb: { version: '0.1.3', now: () => Date.now() + 5_000 } });
  await up(u);
  const e = store.builder('builder-a');
  assert.equal(e.versionSkew, 'patch');
  assert.ok(e.clockSkewMs > 4_000 && e.clockSkewMs < 6_000, `clock skew ${e.clockSkewMs}`);
});

// --- stream ----------------------------------------------------------------------------------------

test('the stream connects with signed headers only (no query, no Origin) and the store has the sessions', async (t) => {
  const { fb, store, up: u } = await setup(t);
  await up(u);
  assert.deepEqual(names(store), ['alpha', 'beta']);
  assert.equal(store.builder('builder-a').conn.state, 'up');
  const hello = fb.requests.find((r) => r.url === '/api/v1/hello');
  const [stream] = upgrades(fb);
  for (const r of [hello, stream]) {
    assert.equal(r.kind, 'hub', `${r.url} verified as a hub read`);
    for (const h of ['x-laneboard-ts', 'x-laneboard-nonce', 'x-laneboard-key', 'x-laneboard-sig']) assert.ok(r.headers[h], `${r.url} carries ${h}`);
    assert.equal(r.headers.origin, undefined, `${r.url} has no Origin`);
    assert.ok(!r.url.includes('?'), `${r.url} carries no query parameters`);
  }
  assert.equal(stream.url, '/api/v1/stream');
  assert.equal(stream.status, 101);
  assert.equal(stream.headers['sec-websocket-extensions'], undefined, 'no permessage-deflate');
  // A delta applies in order.
  fb.push({ type: 'delta', sessions: [{ name: 'gamma', state: 'working' }], removed: ['alpha'] });
  await waitFor(() => names(store).includes('gamma'), { what: 'delta applied' });
  assert.deepEqual(names(store), ['beta', 'gamma']);
  assert.equal(u.status().seq, fb.seq);
  // An event reaches the store and is re-emitted.
  const seen = [];
  store.subscribe((ev) => seen.push(ev.kind));
  fb.push({ type: 'health', health: { cpu: 1 } });
  fb.push({ type: 'map', map: { nodes: [] } });
  fb.push({ type: 'alarms', alarms: [] });
  fb.push({ type: 'delta', sessions: [{ name: 'delta', state: 'idle' }] });
  await waitFor(() => names(store).includes('delta'), { what: 'delta after ignored frames' });
  assert.ok(seen.includes('health'));
  assert.deepEqual(store.builder('builder-a').snap.health, { cpu: 1 });
  assert.equal(snapshotGets(fb).length, 0, 'map/alarms advance seq without a gap');
});

test('a frame with a wrong builder field is dropped', async (t) => {
  const { fb, store, up: u } = await setup(t);
  await up(u);
  fb.script.raw({ type: 'delta', builder: 'builder-b', seq: fb.seq + 1, epoch: fb.epoch, sessions: [{ name: 'evil', state: 'idle' }] });
  fb.script.raw({ type: 'delta', seq: fb.seq + 1, epoch: fb.epoch, sessions: [{ name: 'evil2', state: 'idle' }] });
  fb.script.raw('not json');
  fb.script.raw('[1,2]');
  fb.push({ type: 'delta', sessions: [{ name: 'good', state: 'idle' }] });
  await waitFor(() => names(store).includes('good'), { what: 'good delta' });
  assert.ok(!names(store).includes('evil'));
  assert.ok(!names(store).includes('evil2'));
  const d = u.status().dropped;
  assert.equal(d.wrongBuilder, 2);
  assert.equal(d.badJson, 1);
  assert.equal(d.notObject, 1);
  assert.equal(snapshotGets(fb).length, 0);
});

test('a seq gap triggers exactly one GET /api/v1/snapshot; frames during it are buffered and replayed, seq <= snap.seq dropped', async (t) => {
  let hold = null;
  const fetchImpl = async (url, init) => {
    const res = await fetch(url, init);
    if (url.endsWith('/api/v1/snapshot') && hold) await hold;
    return res;
  };
  const { fb, store, up: u } = await setup(t, { up: { fetchImpl } });
  await up(u);
  let release;
  hold = new Promise((r) => { release = r; });
  fb.script.gap(3);
  fb.sessions = ['alpha', 'beta', 'from-snapshot'];
  const gapFrame = fb.push({ type: 'delta', sessions: [{ name: 'in-gap-frame', state: 'idle' }] });
  await waitFor(() => snapshotGets(fb).length === 1, { what: 'resync GET' });
  const snapSeq = fb.seq; // the fake computed the snapshot at this seq
  assert.equal(snapSeq, gapFrame.seq);
  // Frames arriving while the snapshot is in flight are buffered.
  fb.push({ type: 'delta', sessions: [{ name: 'after-1', state: 'idle' }] });
  fb.push({ type: 'delta', sessions: [{ name: 'after-2', state: 'idle' }] });
  await sleep(50);
  assert.ok(!names(store).includes('after-1'), 'not applied before the snapshot');
  release();
  await waitFor(() => names(store).includes('after-2'), { what: 'replay' });
  assert.deepEqual(names(store), ['after-1', 'after-2', 'alpha', 'beta', 'from-snapshot']);
  assert.ok(!names(store).includes('in-gap-frame'), 'the gap frame (seq <= snap.seq) was discarded, the snapshot covers it');
  assert.equal(u.status().seq, snapSeq + 2);
  assert.ok(u.status().dropped.duplicate >= 1);
  assert.equal(snapshotGets(fb).length, 1, 'exactly one snapshot GET');
  const g = snapshotGets(fb)[0];
  assert.equal(g.kind, 'hub', 'the snapshot GET is signed and verified');
  assert.equal(u.status().resyncs, 1);
  assert.equal(upgrades(fb).length, 1, 'no reconnect');
});

test('an epoch change resyncs via the snapshot', async (t) => {
  const { fb, store, up: u } = await setup(t);
  await up(u);
  const before = u.status().epoch;
  const e2 = fb.script.newEpoch();
  fb.sessions = ['restarted'];
  fb.push({ type: 'delta', sessions: [{ name: 'restarted', state: 'idle' }] });
  await waitFor(() => u.status().epoch === e2, { what: 'new epoch' });
  assert.notEqual(before, e2);
  assert.equal(snapshotGets(fb).length, 1);
  assert.deepEqual(names(store), ['restarted']);
  fb.push({ type: 'delta', sessions: [{ name: 'next', state: 'idle' }] });
  await waitFor(() => names(store).includes('next'), { what: 'delta in the new epoch' });
  assert.equal(snapshotGets(fb).length, 1);
});

test('a second gap within 10 s closes the socket instead; the reconnect gets a fresh snapshot', async (t) => {
  const { fb, store, up: u, closes } = await setup(t);
  await up(u);
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [{ name: 'g1', state: 'idle' }] });
  await waitFor(() => snapshotGets(fb).length === 1 && !u._resyncing, { what: 'first resync' });
  fb.script.gap(1);
  fb.sessions = ['fresh'];
  fb.push({ type: 'delta', sessions: [{ name: 'g2', state: 'idle' }] });
  await waitFor(() => closes.length === 1, { what: 'socket closed' });
  assert.equal(closes[0], 4000);
  assert.equal(snapshotGets(fb).length, 1, 'no second snapshot GET');
  await waitFor(() => upgrades(fb).length === 2 && u.status().state === 'up' && names(store).join() === 'fresh', { what: 'reconnect snapshot' });
});

test('the fake closes: state is stale (not down) before downMs, then down; error recorded', async (t) => {
  const { fb, store, up: u } = await setup(t);
  await up(u);
  const states = [];
  u.on('state', (s) => states.push(s.state));
  const closedAt = Date.now();
  await fb.close();
  await waitFor(() => u.status().state === 'stale', { what: 'stale' });
  assert.equal(store.builder('builder-a').conn.state, 'stale');
  assert.ok(Date.now() - closedAt < FAST.downMs);
  await waitFor(() => u.status().state === 'down', { timeout: 3000, what: 'down' });
  assert.ok(Date.now() - closedAt >= FAST.downMs - 400, 'down only after downMs since the last frame');
  assert.deepEqual(states.slice(0, 2), ['stale', 'down']);
  assert.match(u.status().error, /unreachable|closed/);
  assert.ok(u.status().attempts > 0);
  assert.deepEqual(names(store), ['alpha', 'beta'], 'the last snapshot stays (degraded mode)');
});

test('a silent connected socket is terminated after staleMs and reconnects', async (t) => {
  // pingMs longer than staleMs: no pongs, no frames.
  const { fb, up: u } = await setup(t, { cfg: { pingMs: 5_000 } });
  await up(u);
  await waitFor(() => upgrades(fb).length >= 2, { what: 'reconnect after silence' });
});

test('the reconnect gets a new snapshot; visible keys are re-sent', async (t) => {
  const { fb, store, up: u } = await setup(t);
  await up(u);
  const keys = ['builder-a/alpha', 'builder-b/alpha', 'not-a-key', 42, 'builder-a/alpha',
    ...Array.from({ length: 80 }, (_, i) => `builder-a/s${i}`)];
  assert.equal(u.send({ type: 'visible', keys }), true);
  await waitFor(() => fb.received.some((m) => m.type === 'visible'), { what: 'visible upstream' });
  const v = fb.received.find((m) => m.type === 'visible');
  assert.equal(v.keys.length, 64);
  assert.equal(v.keys[0], 'builder-a/alpha');
  assert.ok(v.keys.every((k) => k.startsWith('builder-a/')));
  assert.equal(new Set(v.keys).size, 64);
  fb.sessions = ['after-restart'];
  fb.script.closeStreams(1001);
  await waitFor(() => upgrades(fb).length === 2 && names(store).join() === 'after-restart', { what: 'new snapshot' });
  await waitFor(() => fb.received.filter((m) => m.type === 'visible').length === 2, { what: 'visible re-sent' });
  assert.deepEqual(fb.received.filter((m) => m.type === 'visible')[1].keys, v.keys);
  assert.equal(u.send({ type: 'visible', keys: [] }), true);
  await waitFor(() => fb.received.filter((m) => m.type === 'visible').length === 3, { what: 'empty visible' });
  assert.equal(u.send('nope'), false);
});

test('pongs give latency; attempts reset after a stable connection', async (t) => {
  const { fb, up: u } = await setup(t, { cfg: { stableMs: 200 } });
  await up(u);
  fb.script.closeStreams(1001);
  await waitFor(() => upgrades(fb).length === 2 && u.status().connected, { what: 'reconnect' });
  assert.ok(u.status().attempts >= 1);
  await waitFor(() => u.status().latencyMs !== null, { what: 'latency' });
  assert.ok(u.status().latencyMs >= 0);
  await waitFor(() => u.status().attempts === 0, { what: 'attempts reset' });
});

// --- bounds ----------------------------------------------------------------------------------------

test('an oversize frame closes with 1009 before parsing: error "frame too large", backoff, reconnect', async (t) => {
  const { fb, up: u, closes } = await setup(t, { cfg: { maxPayload: 64 * 1024 } });
  await up(u);
  const errors = [];
  u.on('close', (code) => errors.push([code, u.status().error]));
  fb.script.raw(JSON.stringify({ type: 'delta', builder: 'builder-a', seq: fb.seq + 1, pad: 'x'.repeat(100 * 1024) }));
  await waitFor(() => closes.length === 1, { what: 'close' });
  assert.equal(closes[0], 1009);
  await waitFor(() => errors.length === 1, { what: 'client close' });
  assert.equal(errors[0][1], 'frame too large');
  await waitFor(() => upgrades(fb).length === 2, { what: 'reconnect' });
  assert.equal(snapshotGets(fb).length, 0, 'the oversize frame was never parsed as a gap');
});

test('above the byte rate the upstream closes with 1008 "rate"', async (t) => {
  const { fb, up: u, closes } = await setup(t, { cfg: { maxBytesPerSec: 64 * 1024 } });
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  for (let i = 0; i < 6; i++) fb.script.raw({ type: 'map', builder: 'builder-a', seq: fb.seq, pad: 'y'.repeat(20 * 1024) });
  await waitFor(() => closes.length === 1, { what: 'close' });
  assert.equal(closes[0], 1008);
  await waitFor(() => errors.length === 1, { what: 'client close' });
  assert.equal(errors[0], 'rate');
  await waitFor(() => upgrades(fb).length === 2, { what: 'reconnect after backoff' });
});

test('hello response over 64 KiB: "response too large", no stream', async (t) => {
  const { fb, up: u } = await setup(t, { fb: { helloFields: { pad: 'z'.repeat(70 * 1024) } } });
  await waitFor(() => u.status().error === 'hello: response too large', { what: 'cap' });
  assert.equal(upgrades(fb).length, 0);
  assert.equal(u.status().state, 'connecting');
});

test('hello timeout is enforced', async (t) => {
  let calls = 0;
  const fetchImpl = (url, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const { up: u } = await setup(t, { cfg: { helloTimeoutMs: 80 }, up: { fetchImpl } });
  await waitFor(() => u.status().error === 'hello: timeout', { what: 'timeout' });
  await waitFor(() => calls >= 2, { what: 'retry after backoff' });
});

test('a hello body without content-length is still capped while streaming', async (t) => {
  const fetchImpl = async () => {
    let n = 0;
    const body = new ReadableStream({
      pull(c) { if (n++ > 100) c.close(); else c.enqueue(new Uint8Array(4096).fill(32)); },
    });
    return new Response(body, { status: 200 });
  };
  const { up: u } = await setup(t, { up: { fetchImpl } });
  await waitFor(() => u.status().error === 'hello: response too large', { what: 'streamed cap' });
});

test('a hello refused by the builder (unpinned key) is a fixed-string http error', async (t) => {
  const { up: u } = await setup(t, { fb: { hubKeys: [publicKeyString(crypto.generateKeyPairSync('ed25519').privateKey)] } });
  await waitFor(() => u.status().error === 'hello: http 403', { what: 'unknown key refused' });
});

test('snapshot resync over its byte cap closes the socket and reconnects', async (t) => {
  const { fb, up: u, closes } = await setup(t, { cfg: { snapshotMaxBytes: 2048 } });
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => errors.length === 1, { what: 'close' });
  assert.equal(errors[0], 'snapshot: response too large');
  assert.equal(closes[0], 1011);
  await waitFor(() => upgrades(fb).length === 2, { what: 'reconnect' });
});

test('snapshot resync timeout closes the socket', async (t) => {
  const fetchImpl = (url, init) => {
    if (url.endsWith('/api/v1/snapshot')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return fetch(url, init);
  };
  const { fb, up: u } = await setup(t, { cfg: { snapshotTimeoutMs: 80 }, up: { fetchImpl } });
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => errors.length === 1, { what: 'close' });
  assert.equal(errors[0], 'snapshot: timeout');
});

test('the resync buffer is bounded: overflow closes the socket', async (t) => {
  let hold = null;
  const fetchImpl = async (url, init) => {
    const res = await fetch(url, init);
    if (url.endsWith('/api/v1/snapshot') && hold) await hold;
    return res;
  };
  const { fb, up: u, closes } = await setup(t, { cfg: { resyncBufferFrames: 5 }, up: { fetchImpl } });
  await up(u);
  let release;
  hold = new Promise((r) => { release = r; });
  t.after(() => release());
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => snapshotGets(fb).length === 1, { what: 'resync' });
  for (let i = 0; i < 10; i++) fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => closes.length === 1, { what: 'overflow close' });
  assert.equal(closes[0], 1008);
  release();
  await waitFor(() => upgrades(fb).length === 2, { what: 'reconnect' });
});

test('a resync snapshot naming another builder is refused', async (t) => {
  const fetchImpl = async (url, init) => {
    const res = await fetch(url, init);
    if (!url.endsWith('/api/v1/snapshot')) return res;
    const body = await res.json();
    body.builder = { id: 'builder-b', code: 'BB' };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const { fb, up: u } = await setup(t, { up: { fetchImpl } });
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => errors.length === 1, { what: 'close' });
  assert.equal(errors[0], 'snapshot: bad body');
});

test('a bad builder url is misconfigured and never fetched', async (t) => {
  let calls = 0;
  const store = createFleetStore({ builders: [{ id: 'builder-a' }] });
  const u = new Upstream({
    builder: { id: 'builder-a', url: 'http://127.0.0.1:1/some/path?x=1' },
    key: crypto.generateKeyPairSync('ed25519').privateKey,
    store,
    fetchImpl: async () => { calls++; throw new Error('no'); },
    cfg: FAST,
    log: silentLog,
  });
  t.after(() => u.stop());
  u.start();
  await waitFor(() => u.status().state === 'misconfigured', { what: 'misconfigured' });
  assert.equal(u.status().error, 'bad builder url');
  assert.equal(calls, 0);
});

test('stop() closes the stream and stops reconnecting; createUpstreams starts and stops all', async (t) => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const hubKeys = [{ key: publicKeyString(privateKey), id: 'hub', scopes: ['read'] }];
  const a = await fakeBuilder({ id: 'builder-a', sessions: ['a1'], hubKeys });
  const b = await fakeBuilder({ id: 'builder-b', sessions: ['b1'], hubKeys });
  t.after(async () => { await a.close(); await b.close(); });
  const builders = [{ id: 'builder-a', url: a.url }, { id: 'builder-b', url: b.url }];
  const store = createFleetStore({ builders, hubVersion: '0.1.0' });
  const ups = createUpstreams({ builders, key: privateKey, store, cfg: FAST, log: silentLog, backoff: () => 30 });
  ups.start();
  await waitFor(() => store.list().every((e) => e.conn.state === 'up' && e.snap), { what: 'both up' });
  assert.deepEqual([...store.builder('builder-a').snap.sessions.keys()], ['a1']);
  assert.deepEqual([...store.builder('builder-b').snap.sessions.keys()], ['b1']);
  ups.stop();
  await waitFor(() => a.streams.size === 0 && b.streams.size === 0, { what: 'streams closed' });
  const n = upgrades(a).length;
  await sleep(150);
  assert.equal(upgrades(a).length, n, 'no reconnect after stop');
  assert.equal(ups.get('builder-a').status().connected, false);
});

test('upstream.mjs loads no builder-only module (state, ws, terminals, actions, collectors, routes)', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-upstream-'));
  const code = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.push(r.url); return r; } });
    await import(${JSON.stringify(new URL('../server/hub/upstream.mjs', import.meta.url).href)});
    process.stdout.write(JSON.stringify(seen));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: T,
      LANEBOARD_DB: ':memory:',
      LANEBOARD_CONFIG: '/dev/null',
      LANEBOARD_AUDIT_FILE: path.join(T, 'audit.jsonl'),
      LANEBOARD_STATE_DIR: path.join(T, 'state'),
      XDG_STATE_HOME: path.join(T, 'state'),
      XDG_CONFIG_HOME: path.join(T, 'config'),
    },
    encoding: 'utf8',
  });
  fs.rmSync(T, { recursive: true, force: true });
  const loaded = JSON.parse(out)
    .filter((u) => u.startsWith('file:'))
    .map((u) => path.relative(ROOT, new URL(u).pathname));
  assert.ok(loaded.includes('server/fleet/auth.mjs'));
  for (const p of loaded) {
    for (const bad of ['server/state.mjs', 'server/ws.mjs', 'server/terminals.mjs', 'server/actions.mjs', 'server/fleet/stream.mjs', 'server/boot/builder.mjs']) {
      assert.notEqual(p, bad, `upstream loaded ${bad}`);
    }
    assert.ok(!p.startsWith('server/collector/') && !p.startsWith('server/routes/') && !p.startsWith('server/flags/'), `upstream loaded ${p}`);
    assert.ok(!p.includes('node-pty'), 'upstream loaded node-pty');
  }
});
