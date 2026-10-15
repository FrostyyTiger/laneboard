// v1 stream (fleet A7): the ws tap, seq/epoch stamping, the resync ring,
// v1 client accounting, and terminals.attachNamed's refusals (no tmux).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';

import * as ws from '../server/ws.mjs';
import * as stream from '../server/fleet/stream.mjs';
import * as state from '../server/state.mjs';
import * as terminals from '../server/terminals.mjs';
import { config } from '../server/config.mjs';
import { fkey } from '../server/fleet/keys.mjs';

// --- a loopback server whose every upgrade becomes a v1 stream client -------

let server;
let base;
test.before(async () => {
  server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  server.on('upgrade', (req, socket, head) => stream.attachStream(req, socket, head, { kind: 'local' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `ws://127.0.0.1:${server.address().port}/api/v1/stream`;
});
test.after(async () => {
  stream._reset();
  await new Promise((r) => server.close(r));
});

/** A client that queues every parsed frame; next() waits for the next one. */
async function connect() {
  const sock = new WebSocket(base);
  const frames = [];
  const waiters = [];
  sock.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const w = waiters.shift();
    if (w) w(msg); else frames.push(msg);
  });
  await new Promise((resolve, reject) => { sock.once('open', resolve); sock.once('error', reject); });
  const next = (ms = 2000) => (frames.length
    ? Promise.resolve(frames.shift())
    : new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no frame')), ms);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    }));
  const none = async (ms = 150) => {
    await new Promise((r) => setTimeout(r, ms));
    assert.equal(frames.length, 0, `unexpected frames: ${JSON.stringify(frames)}`);
  };
  const send = (m) => sock.send(JSON.stringify(m));
  const close = () => new Promise((r) => { sock.once('close', r); sock.close(); });
  return { sock, next, none, send, close };
}

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

// --- the tap ----------------------------------------------------------------

test('a tap receives every sent message with its seq', () => {
  const got = [];
  const remove = ws.addTap((msg, seq) => got.push({ msg, seq }));
  const s0 = ws.currentSeq();
  ws.send({ type: 'health', health: { ok: true } });
  ws.send({ type: 'approval', op: 'open', approval: { id: 'a1' } });
  ws.send({ type: 'stuck', name: 'x', key: 'k', stuck: { rule: 'r' } });
  remove();
  ws.send({ type: 'health', health: {} });
  assert.deepEqual(got.map((g) => g.seq), [s0 + 1, s0 + 2, s0 + 3]);
  assert.deepEqual(got.map((g) => g.msg.type), ['health', 'approval', 'stuck']);
  assert.equal(got[0].msg.seq, undefined, 'the tap gets the unstamped original');
});

test('a throwing tap never breaks send()', () => {
  const remove = ws.addTap(() => { throw new Error('boom'); });
  const s0 = ws.currentSeq();
  assert.doesNotThrow(() => ws.send({ type: 'health', health: {} }));
  assert.equal(ws.currentSeq(), s0 + 1);
  remove();
});

test('addTap rejects a non-function', () => {
  assert.throws(() => ws.addTap(null), TypeError);
});

test('tap clients count as clients (broadcastEvent, broadcastFrom)', () => {
  const got = [];
  let n = 0;
  const remove = ws.addTap((msg) => got.push(msg), { count: () => n });
  stream._reset();
  ws.broadcastEvent({ session_name: 'a', kind: 'x' });
  assert.equal(got.length, 0, 'nobody listening: no event frame');
  n = 1;
  ws.broadcastEvent({ session_name: 'a', kind: 'x' });
  assert.equal(got.length, 1);
  assert.equal(got[0].type, 'event');
  ws.broadcastFrom({ generatedAt: 1, sessions: [{ name: 'tap-s', preview: 'big', previewLines: ['l'] }], attention: [], lanes: [] });
  const delta = got.find((m) => m.type === 'delta');
  assert.ok(delta, 'a delta is built while only a tap client listens');
  const s = delta.sessions.find((x) => x.name === 'tap-s');
  assert.ok(s);
  assert.equal(s.preview, undefined, 'no raw preview on the wire');
  assert.ok(ws.clientCount() >= 1);
  remove();
});

// --- the v1 stream ----------------------------------------------------------

test('connect: a snapshot at the current seq, with builder and epoch, no preview', async () => {
  stream._reset();
  const c = await connect();
  const snap = await c.next();
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.builder, config.fleet?.id ?? null);
  assert.equal(snap.seq, ws.currentSeq());
  assert.equal(snap.epoch, stream.epoch());
  assert.match(snap.epoch, /^[A-Za-z0-9_-]{8,}$/);
  for (const s of snap.sessions ?? []) {
    assert.equal(s.preview, undefined);
    assert.equal(s.previewHtml, undefined);
  }
  assert.equal(stream.streamClientCount(), 1);
  await c.close();
  await until(() => stream.streamClientCount() === 0);
});

test('published messages arrive stamped, with contiguous seq', async () => {
  stream._reset();
  const c = await connect();
  const snap = await c.next();
  ws.send({ type: 'health', health: { load: 1 } });
  stream.publish({ type: 'approval', op: 'open', approval: { id: 'ap1' } });
  ws.broadcastEvent({ session_name: 'demo', kind: 'stop' });
  const a = await c.next();
  const b = await c.next();
  const e = await c.next();
  assert.deepEqual([a.seq, b.seq, e.seq], [snap.seq + 1, snap.seq + 2, snap.seq + 3]);
  for (const m of [a, b, e]) {
    assert.equal(m.epoch, snap.epoch);
    assert.equal(m.builder, config.fleet?.id ?? null);
  }
  assert.equal(a.type, 'health');
  assert.deepEqual(a.health, { load: 1 });
  assert.equal(b.type, 'approval');
  assert.equal(b.op, 'open');
  assert.equal(e.type, 'event');
  assert.equal(e.event.session_name, 'demo');
  await c.close();
});

test('resync with an old fromSeq replays the missed frames', async () => {
  stream._reset();
  const c = await connect();
  const snap = await c.next();
  for (let i = 0; i < 5; i++) ws.send({ type: 'health', health: { i } });
  for (let i = 0; i < 5; i++) await c.next();
  c.send({ type: 'resync', fromSeq: snap.seq + 2 });
  const r = [await c.next(), await c.next(), await c.next()];
  assert.deepEqual(r.map((m) => m.seq), [snap.seq + 3, snap.seq + 4, snap.seq + 5]);
  assert.deepEqual(r.map((m) => m.health.i), [2, 3, 4]);
  await c.none();
  // Up to date: nothing to replay, no snapshot.
  c.send({ type: 'resync', fromSeq: ws.currentSeq(), epoch: stream.epoch() });
  await c.none();
  await c.close();
});

test('resync outside the ring, from the future, or another epoch gets a snapshot', async () => {
  stream._reset();
  const c = await connect();
  const snap = await c.next();
  for (let i = 0; i < stream.RING_SIZE + 20; i++) ws.send({ type: 'health', health: { i } });
  for (let i = 0; i < stream.RING_SIZE + 20; i++) await c.next();
  for (const req of [
    { fromSeq: snap.seq + 5 },                        // fell out of the ring
    { fromSeq: ws.currentSeq() + 10 },                // ahead of us
    { fromSeq: ws.currentSeq() - 1, epoch: 'other' }, // a previous process
    { fromSeq: 'nope' },
  ]) {
    c.send({ type: 'resync', ...req });
    const m = await c.next();
    assert.equal(m.type, 'snapshot', JSON.stringify(req));
    assert.equal(m.seq, ws.currentSeq());
    assert.equal(m.epoch, stream.epoch());
  }
  // The newest RING_SIZE frames are still replayable.
  c.send({ type: 'resync', fromSeq: ws.currentSeq() - stream.RING_SIZE });
  const first = await c.next();
  assert.equal(first.type, 'health');
  assert.equal(first.seq, ws.currentSeq() - stream.RING_SIZE + 1);
  for (let i = 1; i < stream.RING_SIZE; i++) await c.next();
  await c.none();
  await c.close();
});

test('resyncPlan: an epoch change always means a snapshot', () => {
  stream._reset();
  ws.send({ type: 'health', health: {} });
  const now = ws.currentSeq();
  assert.equal(stream.resyncPlan(now - 1).replay.length, 1);
  assert.equal(JSON.parse(stream.resyncPlan(now - 1).replay[0]).seq, now);
  const old = stream.epoch();
  stream._reset({ newEpoch: true });
  assert.notEqual(stream.epoch(), old);
  assert.deepEqual(stream.resyncPlan(now - 1, old), { snapshot: true });
  assert.deepEqual(stream.resyncPlan(now - 1), { snapshot: true }, 'empty ring: cannot replay');
});

test('fresh-snapshot resyncs are rate limited', async () => {
  stream._reset();
  const c = await connect();
  await c.next();
  for (let i = 0; i < stream.RESYNC_LIMIT; i++) {
    c.send({ type: 'resync', fromSeq: -1 });
    assert.equal((await c.next()).type, 'snapshot');
  }
  const closed = new Promise((r) => c.sock.once('close', (code) => r(code)));
  c.send({ type: 'resync', fromSeq: -1 });
  assert.equal(await closed, 1008);
});

test('visible from a stream client drives state.visibleSessions; ping answers pong', async () => {
  stream._reset();
  const c = await connect();
  await c.next();
  const id = config.fleet?.id;
  c.send({ type: 'visible', keys: [fkey(id, 'hub-seen'), fkey('another-builder', 'not-ours')] });
  await until(() => state.visibleSessions.has('hub-seen'));
  assert.equal(state.visibleSessions.has('not-ours'), false);
  c.send({ type: 'visible', names: ['legacy-name'] });
  await until(() => state.visibleSessions.has('legacy-name'));
  assert.equal(state.visibleSessions.has('hub-seen'), false);
  c.send({ type: 'ping' });
  const pong = await c.next();
  assert.equal(pong.type, 'pong');
  assert.equal(pong.seq, ws.currentSeq());
  assert.equal(pong.epoch, stream.epoch());
  c.send({ type: 'unknown' });
  c.sock.send('not json');
  await c.none();
  await c.close();
  await until(() => !state.visibleSessions.has('legacy-name'));
});

test('a frame over the client payload cap closes the socket', async () => {
  stream._reset();
  const c = await connect();
  await c.next();
  const closed = new Promise((r) => c.sock.once('close', (code) => r(code)));
  c.sock.send('x'.repeat(stream.MAX_CLIENT_PAYLOAD + 1));
  assert.equal(await closed, 1009);
});

test('the ring keeps the last RING_SIZE frames and the snapshot source is swappable', () => {
  stream._reset();
  for (let i = 0; i < stream.RING_SIZE + 3; i++) ws.send({ type: 'health', health: {} });
  const now = ws.currentSeq();
  assert.equal(stream.resyncPlan(now - stream.RING_SIZE).replay.length, stream.RING_SIZE);
  assert.deepEqual(stream.resyncPlan(now - stream.RING_SIZE - 1), { snapshot: true });
  stream.setSnapshotSource(() => ({ sessions: [], builder: { id: 'x', code: 'y' }, seq: 3, extra: 1 }));
  const f = stream.snapshotFrame();
  assert.equal(f.type, 'snapshot');
  assert.equal(f.extra, 1);
  assert.equal(f.builder, config.fleet?.id ?? null, 'the stream frame carries the builder id string');
  assert.equal(f.seq, now);
  assert.throws(() => stream.setSnapshotSource('no'), TypeError);
  stream.setSnapshotSource(() => {
    const snap = state.snapshot();
    return { ...snap, sessions: snap.sessions.map(ws.forWire) };
  });
});

// --- terminals.attachNamed: refusals happen before any tmux/pty ------------

function fakeSocket() {
  const s = { written: '', destroyed: false };
  s.write = (d) => { s.written += d; return true; };
  s.destroy = () => { s.destroyed = true; };
  return s;
}

test('attachNamed refuses unsafe, web and unknown names with 404', () => {
  const url = new URL('http://127.0.0.1/api/v1/term/x?cols=100&rows=30');
  for (const name of ['a;kill-session -a', '$(id)', '', 'demo-web-1a', 'no-such-session-here', 42]) {
    const sock = fakeSocket();
    assert.equal(terminals.attachNamed({}, sock, Buffer.alloc(0), name, url), true);
    assert.match(sock.written, /^HTTP\/1\.1 404 /, String(name));
    assert.equal(sock.destroyed, true);
  }
  assert.equal(terminals.liveCount(), 0);
});

test('attach still routes /ws/term/<name> through attachNamed', () => {
  const sock = fakeSocket();
  assert.equal(terminals.attach({}, sock, Buffer.alloc(0), new URL('http://127.0.0.1/ws/term/%E0%A4%A')), true);
  assert.match(sock.written, /404/);
  assert.equal(terminals.attach({}, fakeSocket(), Buffer.alloc(0), new URL('http://127.0.0.1/ws/other')), false);
});
