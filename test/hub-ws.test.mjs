// Hub /ws to browsers (fleet H7): a real `ws` client against an in-process
// http server on port 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { createClientWs, defaultClassify, LIMITS } from '../server/hub/client-ws.mjs';

const silentLog = { warn() {}, info() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkStore() {
  const store = createFleetStore({
    builders: [
      { id: 'builder-a', url: 'https://builder-a.example.invalid' },
      { id: 'builder-b', url: 'https://builder-b.example.invalid' },
    ],
    hubVersion: '0.1.0',
  });
  const t = Date.now();
  for (const id of ['builder-a', 'builder-b']) {
    store.setConn(id, { state: 'up', lastSeen: t, hello: { version: '0.1.0', apiVersion: 1, capabilities: ['term'] } });
  }
  return store;
}

const sess = (name, extra = {}) => ({ name, state: 'working', ...extra });
const snap = (sessions, extra = {}) => ({ type: 'snapshot', seq: 1, sessions, lanes: [], box: null, vitals: null, attention: [], generatedAt: 1, ...extra });

/**
 * Boot an http server with client-ws on /ws. `ingress: true` makes the
 * listener the ingress port (Tailscale-User-Login + Origin required).
 */
async function boot(t, { store = mkStore(), ingress = false, ...opts } = {}) {
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const config = { port, fleet: { ingressPort: ingress ? port : null, batchMs: 250 } };
  const cw = createClientWs({ store, config, version: '0.1.0', log: silentLog, ...opts });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ws') cw.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  t.after(async () => {
    cw.close();
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
  });
  return { server, port, cw, store, origin: `http://127.0.0.1:${port}` };
}

/** A connected client that records every frame (raw and parsed). */
function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const msgs = [];
  const raw = [];
  const waiters = new Set();
  ws.on('message', (data) => {
    const s = data.toString();
    raw.push(s);
    msgs.push(JSON.parse(s));
    for (const w of [...waiters]) w();
  });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode })));
    ws.once('error', reject);
  });
  /** Resolve once pred(msgs) is truthy. */
  function until(pred, ms = 3000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const v = pred(msgs);
        if (v) { waiters.delete(check); clearTimeout(timer); resolve(v); }
      };
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`timeout; got ${msgs.map((m) => m.type).join(',')}`)); }, ms);
      waiters.add(check);
      check();
    });
  }
  const send = (m) => ws.send(JSON.stringify(m));
  return { ws, msgs, raw, opened, until, send, close: () => ws.terminate() };
}

/** Status code of a refused upgrade. */
async function refusedStatus(port, headers) {
  const c = connect(port, headers);
  try {
    await c.opened;
    c.close();
    return 101;
  } catch (err) {
    return err.status ?? 'error';
  }
}

test('connect order is fleet, one snapshot per builder, then map', async (t) => {
  const store = mkStore();
  store.applySnapshot('builder-a', snap([sess('web', { lane: 'l1' })], { lanes: [{ id: 'l1' }], attention: [{ name: 'web', score: 5 }] }), Date.now());
  store.applySnapshot('builder-b', snap([sess('api')]), Date.now());
  const { port } = await boot(t, { store, getMap: () => ({ nodes: [{ id: '__core' }] }) });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.length >= 4);
  assert.deepEqual(c.msgs.map((m) => m.type), ['fleet', 'snapshot', 'snapshot', 'map']);
  const [fleet, sa, sb, map] = c.msgs;
  assert.equal(fleet.hub.version, '0.1.0');
  assert.equal(typeof fleet.hub.now, 'number');
  assert.deepEqual(fleet.builders.map((b) => b.id), ['builder-a', 'builder-b']);
  const row = fleet.builders[0];
  for (const k of ['id', 'code', 'directUrl', 'state', 'ageMs', 'latencyMs', 'version', 'versionSkew', 'controls', 'capabilities']) {
    assert.ok(k in row, `BuilderRow.${k}`);
  }
  assert.equal(row.state, 'up');
  assert.equal(row.controls, true);
  assert.deepEqual(row.capabilities, ['term']);
  assert.ok(fleet.aggregates && fleet.aggregates.counts.sessions === 2);
  assert.equal(sa.builder, 'builder-a');
  assert.equal(sb.builder, 'builder-b');
  assert.equal(sa.sessions[0].key, 'builder-a/web');
  assert.equal(sa.sessions[0].laneKey, 'builder-a/l1');
  assert.equal(sa.lanes[0].key, 'builder-a/l1');
  assert.equal(sa.attention[0].key, 'builder-a/web');
  assert.equal(sa.stale, false);
  assert.equal(typeof sa.ageMs, 'number');
  assert.deepEqual(map.map, { nodes: [{ id: '__core' }] });
  c.close();
});

test('scope [builder-a] suppresses builder-b deltas but not fleet; re-entering scope sends a snapshot', async (t) => {
  const store = mkStore();
  store.applySnapshot('builder-a', snap([sess('web')]), Date.now());
  store.applySnapshot('builder-b', snap([sess('api')]), Date.now());
  const { port } = await boot(t, { store, batchMs: 50, fleetMinMs: 50 });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  c.send({ type: 'scope', builders: ['builder-a'] });
  await sleep(100);
  const mark = c.msgs.length;
  store.applyDelta('builder-b', { type: 'delta', seq: 2, sessions: [sess('api', { state: 'done' })] }, Date.now());
  store.applyDelta('builder-a', { type: 'delta', seq: 2, sessions: [sess('web', { state: 'done' })] }, Date.now());
  store.setConn('builder-b', { state: 'down' }); // changes the fleet row
  await c.until((m) => m.slice(mark).some((x) => x.type === 'delta' && x.builder === 'builder-a'));
  await c.until((m) => m.slice(mark).some((x) => x.type === 'fleet' && x.builders[1].state === 'down'));
  await sleep(150);
  const after = c.msgs.slice(mark);
  assert.equal(after.filter((x) => x.builder === 'builder-b').length, 0, 'no builder-b frames out of scope');
  // A builder entering scope gets its snapshot at once.
  const mark2 = c.msgs.length;
  c.send({ type: 'scope', builders: 'all' });
  const s = await c.until((m) => m.slice(mark2).find((x) => x.type === 'snapshot' && x.builder === 'builder-b'));
  assert.equal(s.sessions[0].state, 'done');
  assert.equal(s.stale, true);
  c.close();
});

test('10 deltas within 250 ms yield one delta frame with merged sessions', async (t) => {
  const store = mkStore();
  store.applySnapshot('builder-a', snap([sess('a'), sess('gone')]), Date.now());
  const { port } = await boot(t, { store, batchMs: 250 });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  const mark = c.msgs.length;
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    const sessions = [sess('a', { n: i })];
    if (i % 2) sessions.push(sess(`s${i}`));
    const msg = { type: 'delta', seq: 2 + i, sessions };
    if (i === 3) msg.removed = ['gone'];
    if (i === 4) msg.lanes = [{ id: 'l1' }];
    store.applyDelta('builder-a', msg, Date.now());
  }
  assert.ok(Date.now() - t0 < 250);
  await c.until((m) => m.slice(mark).some((x) => x.type === 'delta'));
  await sleep(600);
  const deltas = c.msgs.slice(mark).filter((x) => x.type === 'delta');
  // All 10 store deltas are applied within one batch window.
  assert.equal(deltas.length, 1, `got ${deltas.length} delta frames`);
  const d = deltas[0];
  assert.equal(d.builder, 'builder-a');
  const byName = new Map(d.sessions.map((s) => [s.name, s]));
  assert.equal(byName.get('a').n, 9, 'last write wins');
  assert.deepEqual([...byName.keys()].sort(), ['a', 's1', 's3', 's5', 's7', 's9']);
  assert.deepEqual(d.removed, ['gone']);
  assert.equal(d.lanes[0].key, 'builder-a/l1');
  c.close();
});

test('a 300-session snapshot splits into frames <= 512 KB (snapshot first, then deltas of <= 100)', async (t) => {
  const store = mkStore();
  const big = [];
  for (let i = 0; i < 300; i++) big.push(sess(`s${String(i).padStart(3, '0')}`, { note: 'x'.repeat(3000), tool: 'y'.repeat(1000) }));
  store.applySnapshot('builder-a', snap(big), Date.now());
  const { port } = await boot(t, { store });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  for (const r of c.raw) assert.ok(Buffer.byteLength(r) <= LIMITS.frameBytes, `frame of ${Buffer.byteLength(r)} bytes`);
  const types = c.msgs.map((m) => `${m.type}:${m.builder ?? ''}`);
  const iSnap = types.indexOf('snapshot:builder-a');
  assert.ok(iSnap > 0);
  assert.deepEqual(c.msgs[iSnap].sessions, [], 'the split snapshot carries no sessions');
  const parts = [];
  let j = iSnap + 1;
  while (c.msgs[j].type === 'delta' && c.msgs[j].builder === 'builder-a') parts.push(c.msgs[j++]);
  assert.ok(parts.length >= 3, `${parts.length} parts`);
  for (const p of parts) assert.ok(p.sessions.length <= 100);
  const names = parts.flatMap((p) => p.sessions.map((s) => s.name));
  assert.equal(names.length, 300);
  assert.equal(new Set(names).size, 300);
  assert.equal(c.msgs[j].type, 'snapshot'); // then builder-b
  assert.equal(c.msgs[j].builder, 'builder-b');
  assert.equal(c.msgs.at(-1).type, 'map');
  c.close();
});

test('previewLines only for visible sessions; previewHtml never sent; visible forwarded upstream', async (t) => {
  const store = mkStore();
  const pl = ['line 1', 'line 2'];
  store.applySnapshot('builder-a', snap([
    sess('a', { previewLines: pl, previewHtml: '<b>x</b>' }),
    sess('b', { previewLines: pl }),
  ]), Date.now());
  const upstream = [];
  const { port, cw } = await boot(t, { store, batchMs: 50, visibleDebounceMs: 50, onVisible: (id, keys) => upstream.push([id, keys]) });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  const s0 = c.msgs.find((m) => m.type === 'snapshot' && m.builder === 'builder-a');
  assert.ok(s0.sessions.every((s) => !('previewLines' in s)), 'nothing visible yet');
  const mark = c.msgs.length;
  c.send({ type: 'visible', keys: ['builder-a/a', 'builder-z/nope', '../x', 42] });
  // Becoming visible pushes the session again, with its preview.
  const d1 = await c.until((m) => m.slice(mark).find((x) => x.type === 'delta'));
  assert.deepEqual(d1.sessions.map((s) => s.name), ['a']);
  assert.deepEqual(d1.sessions[0].previewLines, pl);
  await sleep(120);
  assert.deepEqual(upstream, [['builder-a', ['builder-a/a']]]);
  assert.deepEqual(cw.visibleKeys('builder-a'), ['builder-a/a']);
  const mark2 = c.msgs.length;
  store.applyDelta('builder-a', { type: 'delta', seq: 2, sessions: [sess('a', { previewLines: ['n'] }), sess('b', { previewLines: ['n'] })] }, Date.now());
  const d2 = await c.until((m) => m.slice(mark2).find((x) => x.type === 'delta'));
  const by = new Map(d2.sessions.map((s) => [s.name, s]));
  assert.deepEqual(by.get('a').previewLines, ['n']);
  assert.ok(!('previewLines' in by.get('b')));
  for (const r of c.raw) assert.ok(!r.includes('previewHtml'), 'previewHtml on the wire');
  // The browser closing clears its visible set upstream.
  c.close();
  await sleep(150);
  assert.deepEqual(upstream.at(-1), ['builder-a', []]);
});

test('touch reaches a registered onClientMessage handler with the connection user', async (t) => {
  const { port, cw, origin } = await boot(t, { ingress: true });
  const seen = [];
  const off = cw.onClientMessage('touch', (msg, ctx) => { seen.push([msg, ctx]); });
  assert.throws(() => cw.onClientMessage('scope', () => {}), /cannot handle/);
  assert.throws(() => cw.onClientMessage('Bad Type', () => {}), /cannot handle/);
  const c = connect(port, { origin, 'tailscale-user-login': 'alice@example.invalid' });
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  c.send({ type: 'touch', fkey: 'builder-a/web', how: 'inspect' });
  c.send({ type: 'nobody-handles-this' });
  c.send({ type: 'ping' });
  await c.until((m) => m.some((x) => x.type === 'pong'));
  await sleep(20);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0][0], { type: 'touch', fkey: 'builder-a/web', how: 'inspect' });
  assert.deepEqual(seen[0][1], { user: 'alice@example.invalid', kind: 'direct' });
  off();
  c.send({ type: 'touch', fkey: 'builder-a/web', how: 'peek' });
  c.send({ type: 'ping' });
  await c.until((m) => m.filter((x) => x.type === 'pong').length >= 2);
  assert.equal(seen.length, 1, 'unsubscribed');
  c.close();
});

test('a local (non-ingress) connection is user local', async (t) => {
  const { port, cw } = await boot(t);
  const seen = [];
  cw.onClientMessage('touch', (msg, ctx) => seen.push(ctx));
  const c = connect(port, { 'tailscale-user-login': 'spoofed@example.invalid' });
  await c.opened;
  c.send({ type: 'touch', fkey: 'builder-a/web', how: 'term' });
  c.send({ type: 'ping' });
  await c.until((m) => m.some((x) => x.type === 'pong'));
  assert.deepEqual(seen, [{ user: 'local', kind: 'local' }]);
  c.close();
});

test('a missing user header gets 403; a bad Origin gets 403', async (t) => {
  const { port, origin } = await boot(t, { ingress: true });
  const user = { 'tailscale-user-login': 'alice@example.invalid' };
  assert.equal(await refusedStatus(port, { origin }), 403, 'no user');
  assert.equal(await refusedStatus(port, { origin: 'https://evil.example.invalid', ...user }), 403, 'bad origin');
  assert.equal(await refusedStatus(port, { ...user }), 403, 'direct without Origin');
  assert.equal(await refusedStatus(port, { origin, ...user, 'sec-fetch-site': 'cross-site' }), 403, 'cross-site fetch');
  assert.equal(await refusedStatus(port, { origin, ...user, 'x-laneboard-sig': 'abc' }), 403, 'hub kind');
  assert.equal(await refusedStatus(port, { origin, ...user, host: 'rebind.example.invalid' }), 403, 'bad host');
  assert.equal(await refusedStatus(port, { origin, ...user }), 101, 'valid direct');
});

test('local listener: bad Origin and bad Host refused, plain local accepted', async (t) => {
  const { port } = await boot(t);
  assert.equal(await refusedStatus(port, { origin: 'https://evil.example.invalid' }), 403);
  assert.equal(await refusedStatus(port, { host: `evil.example.invalid:${port}` }), 403);
  assert.equal(await refusedStatus(port, {}), 101);
});

test('defaultClassify honours fleet.allowedUsers and ignores user headers off ingress', () => {
  const cfg = { fleet: { ingressPort: 7778, allowedUsers: ['alice@example.invalid'] } };
  const req = (port, headers) => ({ headers, socket: { localPort: port } });
  assert.deepEqual(defaultClassify(req(7778, { 'tailscale-user-login': 'alice@example.invalid' }), cfg), { kind: 'direct', user: 'alice@example.invalid' });
  assert.equal(defaultClassify(req(7778, { 'tailscale-user-login': 'bob@example.invalid' }), cfg).kind, 'unidentified');
  assert.equal(defaultClassify(req(7778, { 'tailscale-user-login': 'a b' }), cfg).kind, 'unidentified');
  assert.deepEqual(defaultClassify(req(7777, { 'tailscale-user-login': 'bob@example.invalid' }), cfg), { kind: 'local', user: 'local' });
  assert.equal(defaultClassify(req(7777, { 'x-laneboard-sig': 's' }), cfg).kind, 'hub');
});

test('event/approval/stuck pass through at once with builder and keys; broadcast reaches clients', async (t) => {
  const store = mkStore();
  store.applySnapshot('builder-a', snap([sess('web')]), Date.now());
  const { port, cw } = await boot(t, { store, batchMs: 60_000 });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  store.applyEvent('builder-a', { type: 'event', event: { name: 'web', kind: 'Stop', key: 'builder-b/web' } }, Date.now());
  store.applyEvent('builder-a', { type: 'approval', op: 'open', approval: { id: 'ap1', name: 'web', builder: 'builder-b' } }, Date.now());
  store.applyEvent('builder-a', { type: 'stuck', name: 'web', stuck: { rule: 'tool-loop' } }, Date.now());
  const ev = await c.until((m) => m.find((x) => x.type === 'event'));
  assert.equal(ev.builder, 'builder-a');
  assert.equal(ev.event.key, 'builder-a/web', 'routing from the connection, not the builder');
  const ap = await c.until((m) => m.find((x) => x.type === 'approval'));
  assert.equal(ap.approval.builder, 'builder-a');
  const st = await c.until((m) => m.find((x) => x.type === 'stuck'));
  assert.equal(st.key, 'builder-a/web');
  cw.broadcast({ type: 'alarms', alarms: [] });
  cw.sendMap({ nodes: [] });
  await c.until((m) => m.some((x) => x.type === 'alarms'));
  await c.until((m) => m.filter((x) => x.type === 'map').length === 2);
  c.close();
});

test('fleet goes out on change at most once per second', async (t) => {
  const store = mkStore();
  const { port } = await boot(t, { store, batchMs: 50 });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  const mark = c.msgs.length;
  store.setConn('builder-a', { latencyMs: 10 });
  await c.until((m) => m.slice(mark).some((x) => x.type === 'fleet'));
  const t1 = Date.now();
  store.setConn('builder-a', { latencyMs: 20 });
  await sleep(300);
  store.setConn('builder-a', { latencyMs: 30 });
  await c.until((m) => m.slice(mark).filter((x) => x.type === 'fleet').length >= 2, 3000);
  const fleets = c.msgs.slice(mark).filter((x) => x.type === 'fleet');
  assert.ok(Date.now() - t1 >= 900, 'second fleet frame waited out the 1 s window');
  assert.equal(fleets.at(-1).builders[0].latencyMs, 30);
  await sleep(1200);
  assert.equal(c.msgs.slice(mark).filter((x) => x.type === 'fleet').length, 2, 'no fleet without a change');
  c.close();
});

test('a client whose bufferedAmount exceeds the cap is terminated', async (t) => {
  const { port, cw } = await boot(t, { maxBufferedBytes: 256 * 1024 });
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  c.ws._socket.pause(); // stop reading: the server's send buffer fills
  const closed = new Promise((r) => c.ws.once('close', r));
  const blob = 'z'.repeat(400 * 1024);
  for (let i = 0; i < 200 && cw.stats().terminated === 0; i++) {
    cw.broadcast({ type: 'packages', data: blob });
    await sleep(5);
  }
  assert.ok(cw.stats().terminated >= 1);
  assert.equal(cw.clientCount(), 0);
  c.ws._socket.resume();
  await closed;
});

test('an oversize broadcast frame is dropped, not sent', async (t) => {
  const { port, cw } = await boot(t);
  const c = connect(port);
  await c.opened;
  await c.until((m) => m.some((x) => x.type === 'map'));
  assert.equal(cw.broadcast({ type: 'packages', data: 'q'.repeat(600 * 1024) }), false);
  cw.broadcast({ type: 'packages', data: 'small' });
  const p = await c.until((m) => m.find((x) => x.type === 'packages'));
  assert.equal(p.data, 'small');
  c.close();
});
