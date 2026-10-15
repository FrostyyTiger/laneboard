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
import v8 from 'node:v8';
import vm from 'node:vm';
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
  assert.equal(DEFAULTS.resyncBufferBytes, 4 * 1024 * 1024);
  assert.equal(DEFAULTS.maxFramesPerSec, 200);
  assert.equal(DEFAULTS.frameOverheadBytes, 256);
  assert.equal(DEFAULTS.resyncMaxPerWindow, 3);
  assert.equal(DEFAULTS.resyncWindowMs, 60_000);
  assert.equal(DEFAULTS.resyncBytesPerWindow, 16 * 1024 * 1024);
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

/** A fetch that holds each snapshot response until the next promise in `holds` resolves. */
function heldSnapshots() {
  const gates = [];
  const fetchImpl = async (url, init) => {
    const res = await fetch(url, init);
    if (url.endsWith('/api/v1/snapshot')) {
      let open;
      const p = new Promise((r) => { open = r; });
      gates.push(open);
      await p;
    }
    return res;
  };
  return { fetchImpl, gates, releaseAll() { for (const g of gates) g(); } };
}

test('SR10 M2: resync buffer overflow drops the buffer and fetches ONE fresh snapshot (no close)', async (t) => {
  const h = heldSnapshots();
  const { fb, store, up: u, closes } = await setup(t, { cfg: { resyncBufferFrames: 5 }, up: { fetchImpl: h.fetchImpl } });
  t.after(() => h.releaseAll());
  await up(u);
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => h.gates.length === 1, { what: 'resync' });
  for (let i = 0; i < 10; i++) fb.push({ type: 'delta', sessions: [{ name: `lost-${i}`, state: 'idle' }] });
  await waitFor(() => u.status().dropped.overflow > 0, { what: 'overflow' });
  assert.equal(u._buffer.length, 0, 'the buffer was dropped');
  fb.sessions = ['fresh'];
  h.gates[0]();
  await waitFor(() => h.gates.length === 2, { what: 'one fresh snapshot GET' });
  fb.push({ type: 'delta', sessions: [{ name: 'after', state: 'idle' }] });
  await sleep(30);
  h.gates[1]();
  await waitFor(() => names(store).join() === 'after,fresh', { what: 'fresh snapshot + replay' });
  assert.equal(snapshotGets(fb).length, 2);
  assert.equal(closes.length, 0, 'no close');
  assert.equal(u.status().seq, fb.seq);
  assert.equal(upgrades(fb).length, 1);
});

test('SR10 M2: a second overflow during the fresh snapshot closes 1008 with hostile backoff', async (t) => {
  const h = heldSnapshots();
  const tries = [];
  const { fb, up: u, closes } = await setup(t, {
    cfg: { resyncBufferFrames: 5 },
    up: { fetchImpl: h.fetchImpl, backoff: (n) => { tries.push(n); return 30; } },
  });
  t.after(() => h.releaseAll());
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => h.gates.length === 1, { what: 'resync' });
  for (let i = 0; i < 10; i++) fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => u.status().dropped.overflow > 0, { what: 'overflow' });
  h.gates[0]();
  await waitFor(() => h.gates.length === 2, { what: 'fresh snapshot GET' });
  for (let i = 0; i < 10; i++) fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => closes.length === 1, { what: 'overflow close' });
  assert.equal(closes[0], 1008);
  await waitFor(() => errors.length === 1, { what: 'client close' });
  assert.equal(errors[0], 'resync buffer overflow');
  assert.ok(tries.at(-1) >= DEFAULTS.hostileAttempts, `hostile backoff (attempt ${tries.at(-1)})`);
  h.releaseAll();
  await waitFor(() => upgrades(fb).length === 2, { what: 'reconnect' });
});

test('SR10 M2: object-dense frames during a resync are held raw: heap delta stays far below the 20x parse cost', async (t) => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const h = heldSnapshots();
  const { fb, up: u, closes } = await setup(t, { cfg: { maxBytesPerSec: 64 * 1024 * 1024, staleMs: 5_000, downMs: 10_000 }, up: { fetchImpl: h.fetchImpl } });
  t.after(() => h.releaseAll());
  await up(u);
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => h.gates.length === 1, { what: 'resync' });
  // ~1.2 MiB of `{}` objects per frame: parsed, that is ~25 MB of heap each.
  const dense = '{},'.repeat(400_000).slice(0, -1);
  const frames = [1, 2, 3, 4].map((k) => `{"type":"map","builder":"builder-a","seq":${fb.seq + k},"epoch":"${fb.epoch}","x":[${dense}]}`);
  const mem = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
  gc(); gc();
  const before = mem();
  for (const f of frames.slice(0, 3)) fb.script.raw(f);
  await waitFor(() => u._buffer.length === 4, { what: '3 dense frames buffered' });
  gc(); gc();
  const delta = mem() - before;
  assert.ok(u._buffer.every((b) => Buffer.isBuffer(b)), 'buffered as raw Buffers');
  assert.ok(u._bufferBytes > 3 * 1024 * 1024 && u._bufferBytes <= DEFAULTS.resyncBufferBytes);
  assert.ok(delta < 64 * 1024 * 1024, `heap delta ${(delta / 1048576).toFixed(1)} MB`);
  // The fourth frame crosses the 4 MiB raw cap: the buffer is dropped (one fresh snapshot follows).
  fb.script.raw(frames[3]);
  await waitFor(() => u._buffer.length === 0 && u.status().dropped.overflow >= 5, { what: 'overflow at the raw cap' });
  assert.equal(closes.length, 0);
});

test('SR10 L1: at most 3 resyncs per 60 s, across reconnects; the 4th closes 1008 "resync rate" with backoff', async (t) => {
  const tries = [];
  const { fb, up: u, closes } = await setup(t, { cfg: { gapWindowMs: 1 }, up: { backoff: (n) => { tries.push(n); return 30; } } });
  await up(u);
  const errors = [];
  u.on('close', () => errors.push(u.status().error));
  for (let i = 1; i <= 3; i++) {
    await sleep(5);
    fb.script.gap(1);
    fb.push({ type: 'delta', sessions: [] });
    await waitFor(() => snapshotGets(fb).length === i && !u._resyncing && u.status().seq === fb.seq, { what: `resync ${i}` });
  }
  await sleep(5);
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => closes.length === 1, { what: 'resync rate close' });
  assert.equal(closes[0], 1008);
  await waitFor(() => errors.length === 1, { what: 'client close' });
  assert.equal(errors[0], 'resync rate');
  assert.equal(snapshotGets(fb).length, 3, 'no 4th snapshot GET');
  assert.ok(tries.at(-1) >= DEFAULTS.hostileAttempts, 'hostile backoff');
  // The window survives the reconnect: the next gap closes again without a GET.
  await waitFor(() => upgrades(fb).length === 2 && u.status().connected && u.status().seq !== null, { what: 'reconnect' });
  fb.script.gap(1);
  fb.push({ type: 'delta', sessions: [] });
  await waitFor(() => closes.length === 2, { what: 'second resync rate close' });
  assert.equal(snapshotGets(fb).length, 3);
});

test('SR10 L1: snapshot bodies count against a separate resync byte budget', async (t) => {
  // Size the budget from what this fake's snapshot body weighs: one fits, a second does not.
  const sizer = await fakeBuilder({ id: 'builder-a', sessions: ['alpha', 'beta'] });
  const size = Buffer.byteLength(JSON.stringify(sizer.snapshot()));
  await sizer.close();
  const errors = [];
  const { up: u2, closes: c2, fb: fb2 } = await setup(t, { cfg: { gapWindowMs: 1, resyncBytesPerWindow: size + 64 } });
  await up(u2);
  u2.on('close', () => errors.push(u2.status().error));
  fb2.script.gap(1);
  fb2.push({ type: 'delta', sessions: [] });
  await waitFor(() => snapshotGets(fb2).length === 1 && !u2._resyncing, { what: 'first resync within budget' });
  await sleep(5);
  fb2.script.gap(1);
  fb2.push({ type: 'delta', sessions: [] });
  await waitFor(() => errors.length === 1, { what: 'budget close' });
  assert.equal(errors[0], 'resync budget');
  assert.equal(c2[0], 1008);
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

// --- SR10 M1: frame rate, per-frame overhead, control frames ----------------------------------------

async function floodCloses(t, cfg, flood) {
  const tries = [];
  const ctx = await setup(t, { cfg, up: { backoff: (n) => { tries.push(n); return 30; } } });
  await up(ctx.up);
  const errors = [];
  ctx.up.on('close', () => errors.push(ctx.up.status().error));
  flood(ctx.fb);
  await waitFor(() => ctx.closes.length >= 1, { what: 'flood close' });
  assert.equal(ctx.closes[0], 1008);
  await waitFor(() => errors.length === 1, { what: 'client close' });
  assert.equal(errors[0], 'rate');
  assert.ok(tries.at(-1) >= DEFAULTS.hostileAttempts, `hostile backoff (attempt ${tries.at(-1)})`);
  await waitFor(() => upgrades(ctx.fb).length === 2, { what: 'reconnect after backoff' });
  return ctx;
}

test('SR10 M1: a flood of empty frames closes 1008 "rate" (frame cap) and backs off', async (t) => {
  const { up: u } = await floodCloses(t, {}, (fb) => { for (let i = 0; i < 400; i++) fb.script.raw(''); });
  assert.ok(u.status().dropped.badJson <= DEFAULTS.maxFramesPerSec + 1, 'parsing stopped at the cap');
});

test('SR10 M1: a flood of {} frames closes 1008 "rate"', async (t) => {
  await floodCloses(t, {}, (fb) => { for (let i = 0; i < 400; i++) fb.script.raw('{}'); });
});

test('SR10 M1: a flood of ws pings from the builder closes 1008 "rate"', async (t) => {
  await floodCloses(t, {}, (fb) => { for (const ws of fb.streams) for (let i = 0; i < 400; i++) ws.ping(); });
});

test('SR10 M1: a flood of unsolicited ws pongs closes 1008 "rate"', async (t) => {
  await floodCloses(t, {}, (fb) => { for (const ws of fb.streams) for (let i = 0; i < 400; i++) ws.pong(); });
});

test('SR10 M1: every frame is charged a fixed overhead (empty frames hit the byte cap)', async (t) => {
  // 300 empty frames x 256 bytes = 75 KiB > 64 KiB, with the frame cap out of the way.
  await floodCloses(t, { maxFramesPerSec: 100_000, maxBytesPerSec: 64 * 1024 }, (fb) => { for (let i = 0; i < 300; i++) fb.script.raw(''); });
});

test('SR10 M1: the rate window is 10 fixed 100 ms buckets (O(1) memory), sliding as the clock moves', () => {
  let clock = 1_000_000;
  const u = new Upstream({
    builder: { id: 'builder-a', url: 'http://127.0.0.1:1' },
    store: createFleetStore({ builders: [{ id: 'builder-a' }] }),
    now: () => clock,
    log: silentLog,
  });
  for (let i = 0; i < 200; i++) assert.equal(u._charge(256, 1), true, `frame ${i}`);
  assert.equal(u._charge(256, 1), false, 'frame 201 in the same second');
  assert.equal(u._rateB.length, 10);
  clock += 500;
  assert.equal(u._charge(256, 1), false, 'half a second later the window still holds them');
  clock += 500;
  assert.equal(u._charge(256, 1), true, 'a second later the old buckets are gone');
  assert.equal(u._rateFrames, 2, 'the refused frame at +500 ms still counts');
  for (let i = 0; i < 1000; i++) { clock += 37; u._charge(10, 1); }
  assert.ok(u._rateFrames <= 28 && u._rateFrames >= 24, `frames in window ${u._rateFrames}`);
  clock += 60_000;
  assert.equal(u._charge(2 * 1024 * 1024 + 1, 1), false, 'bytes over 2 MiB/s');
  clock -= 5_000; // a clock that goes back charges the current bucket, no throw
  assert.equal(u._charge(1, 1), false);
});

// --- SR10 L2: the first snapshot is exempt from the byte budget -------------------------------------

test('SR10 L2: a first snapshot frame above the per-second budget is accepted; later big frames are not', async (t) => {
  const line = 'p'.repeat(400);
  const sessions = Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, previewLines: Array(8).fill(line) }));
  assert.ok(Buffer.byteLength(JSON.stringify(sessions)) > 100 * 1024);
  const { fb, store, up: u, closes } = await setup(t, { fb: { sessions }, cfg: { maxBytesPerSec: 64 * 1024 } });
  await up(u);
  assert.equal(names(store).length, 40);
  await sleep(100);
  assert.equal(closes.length, 0, 'no rate close on the first snapshot');
  assert.equal(upgrades(fb).length, 1, 'no reconnect loop');
  fb.script.raw({ type: 'map', builder: 'builder-a', seq: fb.seq, pad: 'q'.repeat(100 * 1024) });
  await waitFor(() => closes.length === 1, { what: 'rate close on a later frame' });
  assert.equal(closes[0], 1008);
});

test('SR10 L2: only a snapshot is exempt; a large non-snapshot first frame is charged', () => {
  const u = new Upstream({
    builder: { id: 'builder-a', url: 'http://127.0.0.1:1' },
    store: createFleetStore({ builders: [{ id: 'builder-a' }] }),
    cfg: { maxBytesPerSec: 64 * 1024 },
    log: silentLog,
  });
  const sent = [];
  u._ws = { close: (code, reason) => sent.push([code, reason]), terminate() {} };
  u._onMessage(u._gen, Buffer.from(JSON.stringify({ type: 'map', builder: 'builder-a', seq: 1, pad: 'x'.repeat(100 * 1024) })), false);
  assert.deepEqual(sent, [[1008, 'rate']]);
  assert.ok(u._attempts >= DEFAULTS.hostileAttempts);
  // Over the snapshot cap a first snapshot is not exempt either.
  const v = new Upstream({
    builder: { id: 'builder-a', url: 'http://127.0.0.1:1' },
    store: createFleetStore({ builders: [{ id: 'builder-a' }] }),
    cfg: { maxBytesPerSec: 64 * 1024, snapshotMaxBytes: 80 * 1024 },
    log: silentLog,
  });
  const sent2 = [];
  v._ws = { close: (code, reason) => sent2.push([code, reason]), terminate() {} };
  v._onMessage(v._gen, Buffer.from(JSON.stringify({ type: 'snapshot', builder: 'builder-a', seq: 1, sessions: [], pad: 'x'.repeat(100 * 1024) })), false);
  assert.deepEqual(sent2, [[1008, 'rate']]);
});

// --- SR10 L3 / L4 -----------------------------------------------------------------------------------

test('SR10 L3: http only for loopback hosts; anything else is misconfigured', () => {
  const store = createFleetStore({ builders: [{ id: 'builder-a' }] });
  const base = (url) => new Upstream({ builder: { id: 'builder-a', url }, store, log: silentLog })._base;
  assert.equal(base('http://127.0.0.1:7801'), 'http://127.0.0.1:7801');
  assert.equal(base('http://127.0.0.2:7801'), 'http://127.0.0.2:7801');
  assert.equal(base('http://localhost:7801'), 'http://localhost:7801');
  assert.equal(base('http://[::1]:7801'), 'http://[::1]:7801');
  assert.equal(base('https://builder-a.example.invalid'), 'https://builder-a.example.invalid');
  assert.equal(base('http://builder-a.example.invalid'), null);
  assert.equal(base('http://10.0.0.5:7777'), null);
  assert.equal(base('http://127.0.0.1.example.invalid'), null);
  assert.equal(base('ws://127.0.0.1:7801'), null);
});

test('SR10 L3: an http non-loopback builder is misconfigured and never fetched', async (t) => {
  let calls = 0;
  const u = new Upstream({
    builder: { id: 'builder-a', url: 'http://builder-a.example.invalid' },
    key: crypto.generateKeyPairSync('ed25519').privateKey,
    store: createFleetStore({ builders: [{ id: 'builder-a' }] }),
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

test('SR10 L4: send() forwards only visible, resync {fromSeq} and ping, without extra fields', async (t) => {
  const { fb, up: u } = await setup(t);
  await up(u);
  assert.equal(u.send({ type: 'delta', sessions: [] }), false);
  assert.equal(u.send({ type: 'action', target: 'x' }), false);
  assert.equal(u.send({ type: 'snapshot' }), false);
  assert.equal(u.send({ type: 'resync' }), false, 'resync needs fromSeq');
  assert.equal(u.send({ type: 'resync', fromSeq: -1 }), false);
  assert.equal(u.send({ type: 'resync', fromSeq: '3' }), false);
  assert.equal(u.send({ type: 'ping', evil: 'x'.repeat(10) }), true);
  assert.equal(u.send({ type: 'resync', fromSeq: fb.seq, extra: 1 }), true);
  await waitFor(() => fb.received.some((m) => m.type === 'resync'), { what: 'resync upstream' });
  await waitFor(() => fb.received.some((m) => m.type === 'ping'), { what: 'ping upstream' });
  assert.deepEqual(fb.received.find((m) => m.type === 'ping'), { type: 'ping' });
  assert.deepEqual(fb.received.find((m) => m.type === 'resync'), { type: 'resync', fromSeq: fb.seq });
  assert.ok(fb.received.every((m) => ['visible', 'resync', 'ping'].includes(m.type)));
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
