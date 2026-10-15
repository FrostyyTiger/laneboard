// Hub terminal proxy (fleet plan §3 2.12, task H9).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

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

async function setup({ hubControl = true, scopes = ['read', 'term'], maxTermsPerBuilder = 2 } = {}) {
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
    fleet: { ingressPort: ip, publicHosts: [HOST], allowedOrigins: [], maxTermsPerBuilder, enforce: true },
  };
  logs.length = 0;
  tp = createTermProxy({ store, key: privateKey, cfg, audit, log: { warn: (m) => logs.push(m), info: (m) => logs.push(m) } });
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
  return { host: HOST, origin: ORIGIN, 'x-forwarded-for': '100.64.0.9', 'x-forwarded-proto': 'https', 'tailscale-user-login': USER, ...extra };
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

