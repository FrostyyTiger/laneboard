// Hub terminal proxy (fleet plan §3 2.12, task H9).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

import { fakeBuilder } from './helpers/fake-builder.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { publicKeyString } from '../server/fleet/keys-ed25519.mjs';
import { createTermProxy, parseTermPath, termArgs, forwardCode, upstreamUrl } from '../server/hub/term-proxy.mjs';

const HOST = 'hub.example.invalid:8443';
const ORIGIN = `https://${HOST}`;
const USER = 'alice@example.invalid';
const SESSION = 'deploy check';
const { privateKey } = crypto.generateKeyPairSync('ed25519');

let tmp;
let audit;
let fb;
let store;
let tp;
let ingress;
let local;
let cfg;
const logs = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function setup({ hubControl = true, scopes = ['read', 'term'], maxTermsPerBuilder = 2, limits = {}, wss = null, fleet = {} } = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-term-proxy-'));
  audit = openAudit({ file: path.join(tmp, 'audit.jsonl') });
  fb = await fakeBuilder({ id: 'builder-a', hubControl, hubKeys: [{ key: publicKeyString(privateKey), id: 'hub', scopes }] });
  store = createFleetStore({ builders: [{ id: 'builder-a', url: fb.url }, { id: 'builder-b', url: 'http://127.0.0.1:9' }] });
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now() });
  ingress = http.createServer((_q, s) => { s.statusCode = 404; s.end(); });
  local = http.createServer((_q, s) => { s.statusCode = 404; s.end(); });
  const ip = await listen(ingress);
  const lp = await listen(local);
  cfg = {
    mode: 'hub',
    port: lp,
    publicUrl: ORIGIN,
    fleet: { ingressPort: ip, ingressPeerUid: process.getuid(), publicHosts: [HOST], allowedOrigins: [], maxTermsPerBuilder, enforce: true, ...fleet },
  };
  logs.length = 0;
  tp = createTermProxy({ store, key: privateKey, cfg, audit, limits, wss, log: { warn: (m) => logs.push(m), info: (m) => logs.push(m) } });
  for (const srv of [ingress, local]) {
    srv.on('upgrade', (req, socket, head) => {
      if (!tp.attach(req, socket, head, req.url)) socket.destroy();
    });
  }
}

async function teardown() {
  tp?.close();
  for (const s of [ingress, local]) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  await fb.close();
  audit.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

function directHeaders(extra = {}) {
  return { host: HOST, origin: ORIGIN, 'x-forwarded-for': '192.0.2.9', 'x-forwarded-proto': 'https', 'tailscale-user-login': USER, ...extra };
}

/** Open a browser socket; resolves {ws} on open or {status} on an HTTP refusal. */
function open(pathAndQuery, { server = ingress, headers = directHeaders() } = {}) {
  const port = server.address().port;
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathAndQuery}`, { headers });
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_r, res) => { res.resume(); resolve({ status: res.statusCode }); });
    ws.once('error', (err) => resolve({ error: err }));
  });
}

const termPath = (name = SESSION, q = '?cols=100&rows=30') => `/ws/term/builder-a/${encodeURIComponent(name)}${q}`;
const nextMessage = (ws) => new Promise((resolve) => ws.once('message', (data, isBinary) => resolve({ data, isBinary })));
const closed = (ws) => new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
const waitFor = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const auditEntries = () => audit.read().entries;

const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
/** A raw upgrade request; resolves with the status code of the first response line (or null on close). */
function rawUpgrade(pathAndQuery, { server = ingress, headers = directHeaders(), method = 'GET', key = WS_KEY, version = '13', extra = {}, halfClose = false } = {}) {
  const h = { ...headers, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': version, 'sec-websocket-key': key, ...extra };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  return new Promise((resolve) => {
    const sock = net.connect(server.address().port, '127.0.0.1', () => {
      sock.write(`${method} ${pathAndQuery} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (halfClose) sock.end();
    });
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const m = /^HTTP\/1\.1 (\d{3})/.exec(buf);
      if (m) { resolve({ status: Number(m[1]), sock }); }
    });
    sock.on('error', () => {});
    sock.on('close', () => resolve({ status: null, sock }));
  });
}
const auditPairs = () => {
  const es = auditEntries();
  return { att: es.filter((e) => e.action === 'term-attach' && e.result.ok), det: es.filter((e) => e.action === 'term-detach') };
};

// --- pure helpers ----------------------------------------------------------------------------------------

test('parseTermPath: exact shape, safe names only, raw url (no normalization)', () => {
  assert.equal(parseTermPath('/ws'), null);
  assert.equal(parseTermPath('/api/v1/term/x'), null);
  assert.deepEqual(parseTermPath('/ws/term/builder-a/deploy%20check?cols=1'), { builder: 'builder-a', name: 'deploy check', search: '?cols=1' });
  for (const bad of ['/ws/term/builder-a/.', '/ws/term/builder-a/..', '/ws/term/builder-a/%2e%2e', '/ws/term/builder-a/a%2Fb',
    '/ws/term/builder-a/a/b', '/ws/term/builder-a/', '/ws/term/Builder_A/x', '/ws/term/builder-a/%E0%A4%A', '/ws/term/builder-a/a%5Cb',
    '/ws/term/builder-a/__proto__', '/ws/term/../x']) {
    assert.deepEqual(parseTermPath(bad), { error: 404 }, bad);
  }
});

test('termArgs clamps cols/rows, drops junk, passes only run- windows', () => {
  assert.deepEqual(termArgs('?cols=9999&rows=1'), { cols: 500, rows: 5 });
  assert.deepEqual(termArgs('?cols=abc&rows=30&window=run-build'), { rows: 30, window: 'run-build' });
  assert.deepEqual(termArgs('?window=evil;rm'), {});
  assert.deepEqual(termArgs(''), {});
});

test('forwardCode keeps sendable codes, maps the rest', () => {
  assert.equal(forwardCode(4000), 4000);
  assert.equal(forwardCode(1000), 1000);
  assert.equal(forwardCode(1005), 1000);
  assert.equal(forwardCode(1006), 1011);
  assert.equal(forwardCode(1015), 1011);
});

test('upstreamUrl maps http->ws, https->wss and encodes the name', () => {
  assert.equal(upstreamUrl('https://builder-a.example.invalid:8443', 'a b', { cols: 80 }), 'wss://builder-a.example.invalid:8443/api/v1/term/a%20b?cols=80');
  assert.equal(upstreamUrl('http://127.0.0.1:1', 'x', {}), 'ws://127.0.0.1:1/api/v1/term/x');
  assert.throws(() => upstreamUrl('file:///x', 'x', {}));
});

// --- end to end against the fake builder ----------------------------------------------------------------

beforeEach(async () => setup());
afterEach(async () => teardown());

test('bytes go browser -> fake echo -> browser, binary preserved; size control frame passes', async () => {
  const { ws } = await open(termPath());
  assert.ok(ws, 'upgraded');
  const bin = Buffer.from([0, 1, 2, 255, 254]);
  let m = nextMessage(ws);
  ws.send(bin, { binary: true });
  let got = await m;
  assert.equal(got.isBinary, true);
  assert.deepEqual(Buffer.from(got.data), bin);

  m = nextMessage(ws);
  ws.send('ls -la\r');
  got = await m;
  assert.equal(got.isBinary, false);
  assert.equal(String(got.data), 'ls -la\r');

  const size = JSON.stringify({ type: 'size', cols: 120, rows: 40 });
  m = nextMessage(ws);
  ws.send(size);
  got = await m;
  assert.equal(String(got.data), size);
  const t = fb.terms.at(-1);
  assert.ok(t.frames.some((f) => !f.isBinary && String(f.data) === size), 'the builder got the size frame verbatim');
  ws.close();
});

test('the builder receives a term envelope (no read signature) matching path and clamped query', async () => {
  const { ws } = await open(termPath(SESSION, '?cols=9999&rows=30&window=run-build-1&lb_x=1'));
  assert.ok(ws);
  const t = fb.terms.at(-1);
  assert.equal(t.kind, 'hub');
  assert.equal(t.name, SESSION);
  assert.equal(t.envelope.action, 'term');
  assert.equal(t.envelope.target, SESSION);
  assert.equal(t.envelope.builder, 'builder-a');
  assert.equal(t.envelope.user, USER);
  assert.equal(t.envelope.via, 'hub');
  assert.deepEqual(t.envelope.args, { cols: 500, rows: 30, window: 'run-build-1' });
  assert.deepEqual(t.query, { cols: '500', rows: '30', window: 'run-build-1' });
  const rec = fb.requests.filter((r) => r.method === 'UPGRADE').at(-1);
  assert.ok(rec.headers['x-laneboard-envelope']);
  assert.ok(rec.headers['x-laneboard-sig']);
  assert.ok(rec.headers['x-laneboard-key']);
  for (const h of ['x-laneboard-ts', 'x-laneboard-nonce', 'origin', 'tailscale-user-login']) assert.equal(rec.headers[h], undefined, h);
  assert.ok(!/lb_|sig=/.test(rec.url), 'no signature in the query');
  ws.close();
});

test('a local browser connection gets 403 and nothing reaches the builder', async () => {
  const lp = local.address().port;
  const r = await open(termPath(), { server: local, headers: { host: `127.0.0.1:${lp}` } });
  assert.equal(r.status, 403);
  assert.equal(fb.terms.length, 0);
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0);
});

test('unidentified ingress, bad origin, signed hub-kind and read-only users are refused', async () => {
  const noUser = directHeaders();
  delete noUser['tailscale-user-login'];
  assert.equal((await open(termPath(), { headers: noUser })).status, 403);
  assert.equal((await open(termPath(), { headers: directHeaders({ origin: 'https://evil.example.invalid' }) })).status, 403);
  const signed = directHeaders({ 'x-laneboard-sig': 'ed25519 AAAA', 'x-laneboard-key': '0123456789abcdef' });
  delete signed['tailscale-user-login'];
  delete signed.origin;
  assert.equal((await open(termPath(), { headers: signed })).status, 403);
  const ro = directHeaders({ 'tailscale-app-capabilities': JSON.stringify({ 'laneboard.dev/cap': [{ role: 'read' }] }) });
  assert.equal((await open(termPath(), { headers: ro })).status, 403);
  assert.equal(fb.terms.length, 0);
});

test('unknown builder or unsafe name -> 404 without contacting the builder', async () => {
  assert.equal((await open('/ws/term/builder-z/x')).status, 404);
  assert.equal((await open('/ws/term/builder-a/..')).status, 404);
  assert.equal((await open('/ws/term/builder-a/a%2Fb')).status, 404);
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0);
});

test('a fake upstream 404 gives the browser a 404 (no upgrade)', async () => {
  const r = await open(termPath('no such session'));
  assert.equal(r.status, 404);
  assert.equal(tp.live('builder-a'), 0);
});

test('builder hubControl off -> 403 (audited as a refused attach)', async () => {
  await teardown();
  await setup({ hubControl: false });
  const r = await open(termPath());
  assert.equal(r.status, 403);
  const e = auditEntries().filter((x) => x.action === 'term-attach');
  assert.equal(e.length, 1);
  assert.equal(e[0].result.ok, false);
  assert.equal(e[0].result.status, 403);
});

test('hub key without the term scope -> 403', async () => {
  await teardown();
  await setup({ scopes: ['read', 'control'] });
  assert.equal((await open(termPath())).status, 403);
  assert.equal(fb.terms.length, 0);
});

test('a builder that is not up -> 503', async () => {
  assert.equal((await open('/ws/term/builder-b/x')).status, 503);
  store.setConn('builder-a', { state: 'stale' });
  assert.equal((await open(termPath())).status, 503);
});

test('close propagation: fake closes 4000 -> browser sees 4000; browser close -> fake sees a close', async () => {
  const { ws } = await open(termPath());
  const c = closed(ws);
  fb.script.closeTerms(4000, 'session ended');
  const got = await c;
  assert.equal(got.code, 4000);
  assert.equal(got.reason, 'session ended');

  const second = await open(termPath());
  await waitFor(() => fb.terms.length === 2);
  const upClosed = closed(fb.terms[1].ws);
  second.ws.close(4100, 'bye');
  const u = await upClosed;
  assert.equal(u.code, 4100);
  await waitFor(() => tp.live('builder-a') === 0);
});

test('the builder going down closes its terms with 4001', async () => {
  const { ws } = await open(termPath());
  const c = closed(ws);
  store.setConn('builder-a', { state: 'down' });
  const got = await c;
  assert.equal(got.code, 4001);
  assert.equal(got.reason, 'builder down');
  await waitFor(() => tp.live('builder-a') === 0);
});

test('exceeding maxTermsPerBuilder gets a 503', async () => {
  const a = await open(termPath());
  const b = await open(termPath('docs pass'));
  assert.ok(a.ws && b.ws);
  assert.equal(tp.live('builder-a'), 2);
  assert.equal((await open(termPath('api refactor'))).status, 503);
  a.ws.close();
  await waitFor(() => tp.live('builder-a') === 1);
  const c = await open(termPath('api refactor'));
  assert.ok(c.ws, 'a slot frees up after a close');
  b.ws.close();
  c.ws.close();
});

test('audit lines: term-attach and term-detach with byte counts in result, no keystrokes', async () => {
  const { ws } = await open(termPath());
  const m = nextMessage(ws);
  ws.send('secret-keystrokes');
  await m;
  ws.close(1000);
  await waitFor(() => auditEntries().some((e) => e.action === 'term-detach'));
  const es = auditEntries();
  const att = es.find((e) => e.action === 'term-attach');
  const det = es.find((e) => e.action === 'term-detach');
  assert.equal(att.user, USER);
  assert.equal(att.builder, 'builder-a');
  assert.equal(att.target, SESSION);
  assert.equal(att.via, 'direct');
  assert.equal(att.result.ok, true);
  assert.equal(att.id, fb.terms.at(-1).envelope.id, 'attach id = envelope id (reconcilable with the builder)');
  assert.equal(det.user, USER);
  assert.equal(det.target, SESSION);
  assert.equal(det.result.bytesIn, 'secret-keystrokes'.length);
  assert.equal(det.result.bytesOut, 'secret-keystrokes'.length);
  assert.equal(det.result.code, 1000);
  assert.equal(det.id, att.id, 'SR12 L4: the detach line carries the attach envelope id');
  const text = fs.readFileSync(path.join(tmp, 'audit.jsonl'), 'utf8');
  assert.ok(!text.includes('secret-keystrokes'));
  assert.ok(!text.includes(fb.requests.at(-1).headers['x-laneboard-sig'].slice(8)), 'no signature in the audit log');
  assert.ok(!logs.some((l) => /ed25519 /.test(l)), 'no signature logged');
});

test('a browser frame over 64 KiB closes with 1009', async () => {
  const { ws } = await open(termPath());
  const c = closed(ws);
  ws.send(Buffer.alloc(65 * 1024, 1), { binary: true });
  assert.equal((await c).code, 1009);
});

test('backpressure: a slow browser pauses the upstream socket and resumes after draining', async () => {
  const { ws } = await open(termPath());
  await waitFor(() => fb.terms.length === 1);
  const up = fb.terms[0].ws;
  ws._socket.pause(); // the browser stops reading
  const chunk = Buffer.alloc(512 * 1024, 7);
  for (let i = 0; i < 16; i++) up.send(chunk, { binary: true });
  // the hub must pause its upstream socket for this term
  await waitFor(() => tp.stats().pauses > 0, 3000);
  let received = 0;
  ws.on('message', (d) => { received += d.length; });
  ws._socket.resume();
  await waitFor(() => received === 16 * chunk.length, 5000);
  const upClosed = closed(up);
  ws.close();
  assert.equal((await upClosed).code, 1000, 'the builder side closes promptly');
});

test('a broken audit log fails closed: no terminal', async () => {
  audit.close();
  const broken = { append() { throw Object.assign(new Error('x'), { code: 'AUDIT_FAILED' }); } };
  const tp2 = createTermProxy({ store, key: privateKey, cfg, audit: broken, log: { warn: () => {} } });
  ingress.removeAllListeners('upgrade');
  ingress.on('upgrade', (req, socket, head) => { if (!tp2.attach(req, socket, head, req.url)) socket.destroy(); });
  const r = await open(termPath());
  assert.equal(r.status, 503);
  tp2.close();
  audit = openAudit({ file: path.join(tmp, 'audit.jsonl') });
});


// --- SR12 regressions -----------------------------------------------------------------------------------

test('SR12 M1: a bad browser handshake is refused before the upstream opens; no slot leaks', async () => {
  const cases = [{ key: 'bogus' }, { key: '' }, { key: 'dGhlIHNhbXBsZSBub25jZQ=' }, { version: '8' }, { version: '' }, { method: 'POST' },
    { extra: { upgrade: 'h2c' } }, { extra: { 'sec-websocket-protocol': 'x' } }];
  for (const c of cases) {
    const r = await Promise.race([rawUpgrade(termPath(), c), new Promise((res) => setTimeout(() => res({ status: 'hang', sock: { destroy() {} } }), 1000))]);
    assert.ok(r.status === 400 || r.status === 405, `${JSON.stringify(c)} -> ${r.status}`);
    r.sock.destroy();
  }
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0, 'the builder was never contacted');
  assert.equal(fb.terms.length, 0);
  assert.equal(tp.live('builder-a'), 0);
  const a = await open(termPath());
  const b = await open(termPath('docs pass'));
  assert.ok(a.ws && b.ws, 'no 503: the slots are free');
  a.ws.close();
  b.ws.close();
});

test('SR12 M1: an upgrade that never completes times out: upstream closed, slot freed, detach audited', async () => {
  await teardown();
  const stub = new WebSocketServer({ noServer: true });
  stub.handleUpgrade = () => {}; // never calls back (an aborted or stuck handshake)
  await setup({ wss: stub, limits: { upgradeMs: 100 } });
  const r = rawUpgrade(termPath());
  await waitFor(() => fb.terms.length === 1);
  const upClosed = closed(fb.terms[0].ws);
  await upClosed;
  await (await r).sock.destroy();
  await waitFor(() => tp.live('builder-a') === 0);
  assert.equal(tp.stats().upgradeFailures, 1);
  const { att, det } = auditPairs();
  assert.equal(att.length, 1);
  assert.equal(det.length, 1);
  assert.equal(det[0].id, att[0].id);
  assert.equal(det[0].result.code, null);
  // the slots are usable again
  await teardown();
  await setup();
  const ok = await open(termPath());
  assert.ok(ok.ws);
  ok.ws.close();
});

test('SR12 M1: an upgrade aborted by ws (socket destroyed) frees the slot at once and closes the upstream', async () => {
  await teardown();
  const stub = new WebSocketServer({ noServer: true });
  stub.handleUpgrade = (_req, socket) => { socket.destroy(); };
  await setup({ wss: stub, limits: { upgradeMs: 60_000 } });
  const r = await rawUpgrade(termPath());
  assert.equal(r.status, null);
  await waitFor(() => fb.terms.length === 1);
  await waitFor(() => fb.terms[0].ws.readyState === WebSocket.CLOSED);
  await waitFor(() => tp.live('builder-a') === 0);
  const { att, det } = auditPairs();
  assert.equal(det.length, 1);
  assert.equal(det[0].id, att[0].id);
});

test('SR12 M1: a client that half-closes right after its upgrade leaks nothing', async () => {
  for (let i = 0; i < 3; i++) (await rawUpgrade(termPath(), { halfClose: true })).sock.destroy();
  await waitFor(() => tp.live('builder-a') === 0);
  await waitFor(() => fb.terms.every((x) => x.ws.readyState === WebSocket.CLOSED));
  const { att, det } = auditPairs();
  assert.equal(det.length, att.length, 'every audited attach has its detach');
  const ok = await open(termPath());
  assert.ok(ok.ws);
  ok.ws.close();
});

test('SR12 M2: builder pings are rate-limited (no pong flood toward the builder)', async () => {
  const { ws } = await open(termPath());
  await waitFor(() => fb.terms.length === 1);
  const up = fb.terms[0].ws;
  let pongs = 0;
  up.on('pong', () => { pongs++; });
  for (let i = 0; i < 500; i++) up.ping(Buffer.alloc(125, 1));
  await waitFor(() => tp.stats().droppedPongs >= 499, 3000);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(pongs <= 1, `at most one pong, got ${pongs}`);
  const m = nextMessage(ws);
  ws.send('still alive');
  assert.equal(String((await m).data), 'still alive');
  ws.close();
});

test('SR12 M2: browser pings are rate-limited too', async () => {
  const { ws } = await open(termPath());
  let pongs = 0;
  ws.on('pong', () => { pongs++; });
  for (let i = 0; i < 500; i++) ws.ping();
  await waitFor(() => tp.stats().droppedPongs >= 499, 3000);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(pongs <= 1, `at most one pong, got ${pongs}`);
  ws.close();
});

test('SR12 M2: a socket queuing over maxQueuedBytes is terminated and the other side gets 1008', async () => {
  await teardown();
  // backpressure out of the way: only the hard cap can stop this
  await setup({ limits: { maxQueuedBytes: 256 * 1024, highWater: 64 * 1024 * 1024, lowWater: 32 * 1024 * 1024 } });
  const { ws } = await open(termPath());
  await waitFor(() => fb.terms.length === 1);
  const up = fb.terms[0].ws;
  ws._socket.pause(); // the browser stops reading
  const upClosed = closed(up);
  const chunk = Buffer.alloc(512 * 1024, 7);
  for (let i = 0; i < 16 && up.readyState === WebSocket.OPEN; i++) {
    up.send(chunk, { binary: true });
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal((await upClosed).code, 1008);
  await waitFor(() => tp.live('builder-a') === 0);
  assert.equal(tp.stats().overflows, 1);
  const { det } = auditPairs();
  assert.equal(det.length, 1);
  assert.equal(det[0].result.code, 1008);
  ws.terminate();
});

test('SR12 M3: a hub without fleet.ingressPeerUid refuses terminals (403, logged once)', async () => {
  await teardown();
  await setup({ fleet: { ingressPeerUid: null } });
  assert.equal((await open(termPath())).status, 403);
  assert.equal((await open(termPath())).status, 403);
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0);
  assert.equal(logs.filter((l) => /ingressPeerUid/.test(l)).length, 1);
});

test('SR12 M3: a wrong peer uid is refused (forged serve headers from a local process)', async () => {
  await teardown();
  await setup({ fleet: { ingressPeerUid: process.getuid() + 1 } });
  assert.equal((await open(termPath())).status, 403);
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0);
});

test('SR12 L1: createTermProxy refuses to run without an audit log', () => {
  assert.throws(() => createTermProxy({ store, key: privateKey, cfg }), /audit is required/);
  assert.throws(() => createTermProxy({ store, key: privateKey, cfg, audit: {} }), /audit is required/);
});

test('SR12 L2: a peer that stops answering pings is dropped; a live one stays', async () => {
  await teardown();
  await setup({ limits: { pingMs: 40 } });
  const live1 = await open(termPath('docs pass'));
  const port = ingress.address().port;
  const dead = await new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}${termPath()}`, { headers: directHeaders(), autoPong: false });
    w.once('open', () => resolve(w));
  });
  await waitFor(() => fb.terms.length === 2);
  const c = closed(dead);
  assert.equal((await c).code, 1006);
  await waitFor(() => tp.live('builder-a') === 1);
  assert.ok(tp.stats().deadPeers >= 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(live1.ws.readyState, WebSocket.OPEN, 'a peer that answers pings stays open');
  assert.equal(tp.live('builder-a'), 1);
  live1.ws.close();
});

test('SR12 L3: a client RST during a refusal raises no uncaught error', async () => {
  const errs = [];
  const onErr = (e) => errs.push(e);
  process.on('uncaughtException', onErr);
  try {
    const lp = local.address().port;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => {
        const sock = net.connect(lp, '127.0.0.1', () => {
          sock.write(`GET ${termPath()} HTTP/1.1\r\nhost: 127.0.0.1:${lp}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: ${WS_KEY}\r\n\r\n`);
          sock.resetAndDestroy();
          resolve();
        });
        sock.on('error', () => {});
      });
    }
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    process.off('uncaughtException', onErr);
  }
  assert.deepEqual(errs, []);
});

test('SR13 M1: unidentified ingress under enforce:false (user `local`) cannot open a terminal; a real user still can', async () => {
  await teardown();
  await setup({ fleet: { enforce: false, insecureNoEnforce: true } });
  const noUser = directHeaders();
  delete noUser['tailscale-user-login'];
  assert.equal((await open(termPath(), { headers: noUser })).status, 403);
  // a forged `local` login is refused too
  assert.equal((await open(termPath(), { headers: directHeaders({ 'tailscale-user-login': 'local' }) })).status, 403);
  assert.equal(fb.terms.length, 0);
  assert.equal(fb.requests.filter((x) => x.method === 'UPGRADE').length, 0, 'nothing signed for the builder');
  const { ws } = await open(termPath());
  assert.ok(ws, 'a direct user still opens');
  ws.close();
});
