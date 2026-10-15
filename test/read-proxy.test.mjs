// Fleet H12: signed read proxy (server/hub/read-proxy.mjs, §3 2.14).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  createReadProxy, isAllowed, ALLOWLIST, RESPONSE_CAP, READ_CAP, jsonShapeOk, JSON_MAX_DEPTH,
} from '../server/hub/read-proxy.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { publicKeyString } from '../server/fleet/keys-ed25519.mjs';
import { fakeBuilder } from './helpers/fake-builder.mjs';

const hubKey = crypto.generateKeyPairSync('ed25519').privateKey;
const otherKey = crypto.generateKeyPairSync('ed25519').privateKey;
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

async function fake(opts = {}) {
  const fb = await fakeBuilder({ hubKeys: [publicKeyString(hubKey)], ...opts });
  closers.push(() => fb.close());
  return fb;
}

/** A raw HTTP server standing in for a misbehaving builder. */
async function rawBuilder(handler) {
  const reqs = [];
  const srv = http.createServer((req, res) => { reqs.push({ url: req.url, headers: { ...req.headers } }); handler(req, res); });
  const sockets = new Set();
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const close = () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()); });
  closers.push(close);
  return { url: `http://127.0.0.1:${srv.address().port}`, reqs, close };
}

function storeFor(builders, { state = 'up', lastSeen = Date.now() } = {}) {
  const store = createFleetStore({ builders: builders.map(([id, url]) => ({ id, url })) });
  for (const [id] of builders) store.setConn(id, { state, lastSeen });
  return store;
}

/** A hub-like HTTP server: sets req.auth (as the hub's classify would) and calls proxy.route. */
async function hubServer(proxy, { kind = 'direct' } = {}) {
  const srv = http.createServer(async (req, res) => {
    if (kind) req.auth = { kind, user: kind === 'direct' ? 'tester@example.invalid' : 'local' };
    const handled = await proxy.route(req, res);
    if (!handled) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not routed"}'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return `http://127.0.0.1:${srv.address().port}`;
}

/** GET a raw (un-normalized) path against `base`. */
function rawGet(base, p, { method = 'GET', headers = {} } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function setup(fbOpts = {}, proxyOpts = {}) {
  const fb = await fake(fbOpts);
  const store = storeFor([[fb.id ?? 'builder-a', fb.url]]);
  const proxy = createReadProxy({ store, key: hubKey, ...proxyOpts });
  const base = await hubServer(proxy, proxyOpts.hub);
  return { fb, store, proxy, base };
}

const lastReq = (fb) => fb.requests[fb.requests.length - 1];

// --- allowlist (pure) -------------------------------------------------------------------------------------

test('allowlist: every §3 2.14 form is accepted', () => {
  const ok = [
    'hello', 'snapshot', 'health', 'health?history=1', 'approvals', 'jobs/abc-123', 'audit?after=abc', 'audit?since=0',
    'morning', 'morning?window=24h', 'credit', 'lanes/feat-x/diff', 'lanes/a.b_c-d/diff?base=main',
    'sessions/my%20lane/transcript', 'sessions/s1/transcript?limit=5', 'sessions/s1/preview', 'sessions/s1/preview?n=40',
    'archive', 'archive?q=foo', 'archive/lane-1',
  ];
  for (const p of ok) assert.ok(isAllowed(p), p);
  assert.equal(ALLOWLIST.length, 13);
});

test('allowlist: anything else, traversal and encoded separators are refused', () => {
  const bad = [
    '', 'actions', 'stream', 'term/x', 'hello/x', 'hello?x=1', 'snapshot?x', 'health?history=2', 'audit', 'jobs/',
    'jobs/a_b', 'morning?window=ABC', 'morning?window=123456789', 'credit/x', 'lanes/X/diff', 'lanes/-a/diff',
    'sessions/a/b/transcript', 'sessions/a?b/transcript', 'sessions/s/preview?n=1000', 'archive/../hello',
    'lanes/../hello', 'lanes/x/../../hello', 'sessions/../transcript', 'sessions/./transcript',
    'sessions/..%2Fhello/transcript', 'sessions/a%2fb/transcript', 'sessions/a%2Fb/preview', 'sessions/%2e%2e/transcript',
    'sessions/%2E/preview', 'sessions/a%5cb/transcript', 'sessions/a\\b/transcript', 'sessions/a%00/transcript',
    'sessions/%E0%A4%A/transcript', 'sessions/%0a/transcript', '/hello', 'hello#x', 'sessions//transcript',
    `sessions/${'a'.repeat(65)}/transcript`, `audit?${'a'.repeat(5000)}`,
  ];
  for (const p of bad) assert.equal(isAllowed(p), false, p);
});

// --- route: happy path ------------------------------------------------------------------------------------

test('allowlisted path is proxied with a valid read signature (the fake builder verifies it)', async () => {
  const diff = { lane: 'feat-x', files: [{ path: 'a.js', add: 3, del: 1 }] };
  const { fb, base } = await setup({ reads: { '/api/v1/lanes/feat-x/diff': () => diff } });
  const r = await rawGet(base, '/api/fleet/builder-a/v1/lanes/feat-x/diff?base=main');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, diff);
  assert.match(r.headers['content-type'], /^application\/json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const seen = lastReq(fb);
  assert.equal(seen.url, '/api/v1/lanes/feat-x/diff?base=main');
  assert.equal(seen.kind, 'hub');
  assert.equal(seen.status, 200);
  assert.ok(/^ed25519 /.test(seen.headers['x-laneboard-sig']));
  assert.equal(seen.headers.origin, undefined);
});

test('hello, snapshot and audit?after= go through; a percent-encoded session name is signed as sent', async () => {
  const { fb, base } = await setup({
    audit: [{ id: 'e1', ts: 1, hash: 'h1' }, { id: 'e2', ts: 2, hash: 'h2' }],
    reads: { '/api/v1/sessions/my%20lane/preview': (_req, url) => ({ n: url.searchParams.get('n') }) },
  });
  const h = await rawGet(base, '/api/fleet/builder-a/v1/hello');
  assert.equal(h.status, 200);
  assert.equal(h.json.id, 'builder-a');
  assert.equal(h.json.auth.kind, 'hub');
  const s = await rawGet(base, '/api/fleet/builder-a/v1/snapshot');
  assert.equal(s.status, 200);
  assert.ok(Array.isArray(s.json.sessions));
  const a = await rawGet(base, '/api/fleet/builder-a/v1/audit?after=e1');
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.entries.map((e) => e.id), ['e2']);
  const p = await rawGet(base, '/api/fleet/builder-a/v1/sessions/my%20lane/preview?n=5');
  assert.equal(p.status, 200);
  assert.deepEqual(p.json, { n: '5' });
  assert.equal(lastReq(fb).url, '/api/v1/sessions/my%20lane/preview?n=5');
});

test('the builder is chosen by the path id only, and the signature binds that id', async () => {
  const fa = await fake({ id: 'builder-a', reads: { '/api/v1/credit': () => ({ who: 'a' }) } });
  const fbb = await fake({ id: 'builder-b', reads: { '/api/v1/credit': () => ({ who: 'b' }) } });
  const store = storeFor([['builder-a', fa.url], ['builder-b', fbb.url]]);
  const proxy = createReadProxy({ store, key: hubKey });
  const base = await hubServer(proxy);
  const nA = fa.requests.length;
  const r = await rawGet(base, '/api/fleet/builder-b/v1/credit', { headers: { 'x-laneboard-builder': 'builder-a', host: 'builder-a' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { who: 'b' });
  assert.equal(fa.requests.length, nA, 'builder-a saw nothing');
  assert.equal(lastReq(fbb).kind, 'hub');
  // A store entry whose url points at the other builder: builder-b's signature fails on builder-a (502).
  const crossed = createFleetStore({ builders: [{ id: 'builder-b', url: fa.url }] });
  crossed.setConn('builder-b', { state: 'up', lastSeen: Date.now() });
  const out = await createReadProxy({ store: crossed, key: hubKey }).get('builder-b', 'credit');
  assert.equal(out.status, 502);
  assert.equal(lastReq(fa).status, 401);
});

test('a key the builder does not pin is refused by the builder and surfaces as 502, not 401', async () => {
  const { base } = await setup({ reads: { '/api/v1/credit': () => ({ ok: true }) } }, { key: otherKey });
  const r = await rawGet(base, '/api/fleet/builder-a/v1/credit');
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'bad upstream status');
});

// --- route: refusals --------------------------------------------------------------------------------------

test('non-allowlisted paths are 404 and never reach the builder', async () => {
  const { fb, base } = await setup();
  const n = fb.requests.length;
  for (const p of ['actions', 'stream', 'term/x', 'hello/x', 'sessions/a/b/transcript', 'audit', 'lanes/X/diff']) {
    const r = await rawGet(base, `/api/fleet/builder-a/v1/${p}`);
    assert.equal(r.status, 404, p);
    assert.equal(r.json.error, 'not found');
  }
  assert.equal(fb.requests.length, n);
});

test('a path with .. or an encoded / in a segment is 404', async () => {
  const { fb, base } = await setup({ reads: { '/api/v1/hello': () => ({ leaked: true }) } });
  const n = fb.requests.length;
  for (const p of [
    'lanes/../hello', 'lanes/x/../../hello', 'archive/../hello', 'sessions/..%2Fhello/transcript', 'sessions/a%2Fb/transcript',
    'sessions/a%2fb/preview', 'sessions/%2e%2e/transcript', 'sessions/.%2e/transcript', 'sessions/a%5Cb/transcript',
  ]) {
    const r = await rawGet(base, `/api/fleet/builder-a/v1/${p}`);
    assert.equal(r.status, 404, p);
  }
  // Traversal above the /v1/ prefix itself.
  for (const p of ['/api/fleet/builder-a/v1/../../v1/hello', '/api/fleet/builder-a/v1/%2e%2e/hello']) {
    const r = await rawGet(base, p);
    assert.equal(r.status, 404, p);
  }
  assert.equal(fb.requests.length, n);
});

test('unknown, malformed, down and stale builders', async () => {
  const fb = await fake();
  const t0 = Date.now();
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: fb.url }, { id: 'builder-d', url: fb.url }, { id: 'builder-s', url: fb.url }] });
  store.setConn('builder-a', { state: 'up', lastSeen: t0 });
  store.setConn('builder-d', { state: 'down', lastSeen: t0 - 90_000 });
  store.setConn('builder-s', { state: 'up', lastSeen: t0 - 20_000 }); // older than staleMs: effective stale
  const proxy = createReadProxy({ store, key: hubKey, now: () => t0 });
  const base = await hubServer(proxy);
  const n = fb.requests.length;
  const d = await rawGet(base, '/api/fleet/builder-d/v1/hello');
  assert.equal(d.status, 503);
  assert.equal(d.json.error, 'builder down');
  assert.equal(d.json.state, 'down');
  assert.equal(d.json.ageMs, 90_000);
  const s = await rawGet(base, '/api/fleet/builder-s/v1/hello');
  assert.equal(s.status, 503);
  assert.equal(s.json.state, 'stale');
  const u = await rawGet(base, '/api/fleet/builder-zz/v1/hello');
  assert.equal(u.status, 503);
  assert.equal(u.json.error, 'builder down');
  const bad = await rawGet(base, '/api/fleet/Builder_A/v1/hello');
  assert.equal(bad.status, 404);
  assert.equal(fb.requests.length, n, 'no request went out');
});

test('a builder that is up in the store but unreachable is 503', async () => {
  const fb = await fakeBuilder({ hubKeys: [publicKeyString(hubKey)] });
  const url = fb.url;
  await fb.close();
  const store = storeFor([['builder-a', url]]);
  const proxy = createReadProxy({ store, key: hubKey });
  const base = await hubServer(proxy);
  const r = await rawGet(base, '/api/fleet/builder-a/v1/hello');
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'builder unreachable');
});

test('a 5 MiB response is 502 (with content-length and chunked); a 3 MiB diff passes, a 3 MiB non-diff read is 502', async () => {
  const big = 'x'.repeat(5 * 1024 * 1024);
  const mid = 'y'.repeat(3 * 1024 * 1024);
  const { base } = await setup({ reads: {
    '/api/v1/credit': () => ({ big }), '/api/v1/morning': () => ({ mid }), '/api/v1/lanes/lane-1/diff': () => ({ mid }),
  } });
  const r = await rawGet(base, '/api/fleet/builder-a/v1/credit');
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'response too large');
  const ok = await rawGet(base, '/api/fleet/builder-a/v1/lanes/lane-1/diff');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.mid.length, mid.length);
  // SR14 M3: non-diff reads have the lower default cap
  const small = await rawGet(base, '/api/fleet/builder-a/v1/morning');
  assert.equal(small.status, 502);
  assert.equal(small.json.error, 'response too large');
  assert.ok(RESPONSE_CAP === 4 * 1024 * 1024);
  assert.ok(READ_CAP === 1024 * 1024);

  // Chunked, no content-length: the cap still applies while streaming.
  let wrote = 0;
  const raw = await rawBuilder((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(256 * 1024, 0x20);
    res.write('[');
    const pump = () => {
      while (wrote < 6 * 1024 * 1024) {
        wrote += chunk.length;
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
      res.end(']');
    };
    res.on('error', () => {});
    pump();
  });
  const store = storeFor([['builder-a', raw.url]]);
  const out = await createReadProxy({ store, key: hubKey }).get('builder-a', '/api/v1/credit');
  assert.equal(out.status, 502);
  assert.equal(out.json.error, 'response too large');
});

test('JSON only: wrong content-type or unparsable JSON is 502; builder headers are not passed through', async () => {
  const raw = await rawBuilder((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/v1/credit') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<script>alert(1)</script>'); return; }
    if (p === '/api/v1/morning') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"a":'); return; }
    if (p === '/api/v1/approvals') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'set-cookie': 'sid=1', 'x-evil': '1',
        'access-control-allow-origin': '*', 'content-security-policy': 'none', 'retry-after': '5', location: 'http://example.invalid/',
      });
      res.end('{ "list" : [1,2] }');
      return;
    }
    if (p === '/api/v1/snapshot') { res.writeHead(302, { location: 'http://example.invalid/', 'content-type': 'application/json' }); res.end('{}'); return; }
    if (p === '/api/v1/hello') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"no such session"}');
  });
  const store = storeFor([['builder-a', raw.url]]);
  const base = await hubServer(createReadProxy({ store, key: hubKey }));
  const html = await rawGet(base, '/api/fleet/builder-a/v1/credit');
  assert.equal(html.status, 502);
  assert.equal(html.json.error, 'bad upstream content-type');
  assert.ok(!html.text.includes('<script>'));
  const trunc = await rawGet(base, '/api/fleet/builder-a/v1/morning');
  assert.equal(trunc.status, 502);
  assert.equal(trunc.json.error, 'bad upstream json');
  const ok = await rawGet(base, '/api/fleet/builder-a/v1/approvals');
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '{"list":[1,2]}', 're-serialized by the hub');
  assert.equal(ok.headers['content-type'], 'application/json; charset=utf-8');
  for (const h of ['set-cookie', 'x-evil', 'access-control-allow-origin', 'content-security-policy', 'location']) assert.equal(ok.headers[h], undefined, h);
  assert.equal(ok.headers['retry-after'], '5');
  const redirect = await rawGet(base, '/api/fleet/builder-a/v1/snapshot');
  assert.equal(redirect.status, 502);
  assert.equal(raw.reqs.filter((r) => r.url.startsWith('/api/v1/snapshot')).length, 1, 'redirect not followed');
  const five = await rawGet(base, '/api/fleet/builder-a/v1/hello');
  assert.equal(five.status, 502);
  const nf = await rawGet(base, '/api/fleet/builder-a/v1/sessions/nope/transcript');
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.json, { error: 'no such session' });
});

test('no browser header reaches the builder; only signature headers, accept and identity encoding', async () => {
  const raw = await rawBuilder((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const store = storeFor([['builder-a', raw.url]]);
  const base = await hubServer(createReadProxy({ store, key: hubKey }));
  const r = await rawGet(base, '/api/fleet/builder-a/v1/health?history=1', {
    headers: {
      cookie: 'sid=secret', authorization: 'Bearer x', 'tailscale-user-login': 'tester@example.invalid', origin: 'https://hub.example.invalid',
      'x-forwarded-for': '192.0.2.1', 'x-laneboard': '1', 'x-laneboard-sig': 'ed25519 AAAA', 'x-custom': 'y',
    },
  });
  assert.equal(r.status, 200);
  const h = raw.reqs[0].headers;
  assert.equal(raw.reqs[0].url, '/api/v1/health?history=1');
  for (const k of ['cookie', 'authorization', 'tailscale-user-login', 'origin', 'x-forwarded-for', 'x-laneboard', 'x-custom']) assert.equal(h[k], undefined, k);
  assert.match(h['x-laneboard-ts'], /^\d+$/);
  assert.match(h['x-laneboard-nonce'], /^[0-9a-f-]{36}$/);
  assert.notEqual(h['x-laneboard-sig'], 'ed25519 AAAA');
  assert.equal(h['accept-encoding'], 'identity');
  assert.equal(h.accept, 'application/json');
});

test('timeout: a builder that never answers is 504 for get() with its own timeout', async () => {
  const raw = await rawBuilder(() => { /* never responds */ });
  const store = storeFor([['builder-a', raw.url]]);
  const proxy = createReadProxy({ store, key: hubKey });
  const t = Date.now();
  const out = await proxy.get('builder-a', '/api/v1/morning?window=24h', { timeoutMs: 200 });
  assert.equal(out.status, 504);
  assert.equal(out.json.error, 'builder timeout');
  assert.ok(Date.now() - t < 3000);
});

test('route auth: only direct or local; hub kind or no auth is 403; non-GET is 405; other paths are not handled', async () => {
  const fb = await fake({ reads: { '/api/v1/credit': () => ({ ok: 1 }) } });
  const store = storeFor([['builder-a', fb.url]]);
  const proxy = createReadProxy({ store, key: hubKey });
  for (const [kind, want] of [['direct', 200], ['local', 200], ['hub', 403], [null, 403]]) {
    const base = await hubServer(proxy, { kind });
    const r = await rawGet(base, '/api/fleet/builder-a/v1/credit');
    assert.equal(r.status, want, String(kind));
  }
  const base = await hubServer(proxy);
  const post = await rawGet(base, '/api/fleet/builder-a/v1/credit', { method: 'POST' });
  assert.equal(post.status, 405);
  const other = await rawGet(base, '/api/fleet/builder-a/snapshot');
  assert.deepEqual(other.json, { error: 'not routed' });
  // classify option, when the hub did not set req.auth
  const viaClassify = createReadProxy({ store, key: hubKey, classify: () => ({ kind: 'direct', user: 'tester@example.invalid' }) });
  const b2 = await hubServer(viaClassify, { kind: null });
  assert.equal((await rawGet(b2, '/api/fleet/builder-a/v1/credit')).status, 200);
  const throwing = createReadProxy({ store, key: hubKey, classify: () => { throw new Error('nope'); } });
  const b3 = await hubServer(throwing, { kind: null });
  assert.equal((await rawGet(b3, '/api/fleet/builder-a/v1/credit')).status, 403);
});

test('get(): /api/v1 and bare forms; refusals resolve, never throw; nothing is cached', async () => {
  let n = 0;
  const { proxy } = await setup({ reads: { '/api/v1/credit': () => ({ n: ++n }) } });
  assert.deepEqual(await proxy.get('builder-a', '/api/v1/credit'), { status: 200, json: { n: 1 } });
  assert.deepEqual(await proxy.get('builder-a', 'credit'), { status: 200, json: { n: 2 } });
  assert.equal((await proxy.get('builder-a', '/credit')).status, 404);
  assert.equal((await proxy.get('builder-a', '/api/v1/actions')).status, 404);
  assert.equal((await proxy.get('builder-a', null)).status, 404);
  assert.equal((await proxy.get('../x', 'credit')).status, 404);
  assert.equal((await proxy.get('builder-q', 'credit')).status, 503);
});

test('per-builder in-flight cap answers 429', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const raw = await rawBuilder(async (req, res) => { await gate; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const store = storeFor([['builder-a', raw.url]]);
  const proxy = createReadProxy({ store, key: hubKey, cfg: { maxInflight: 2 } });
  const a = proxy.get('builder-a', 'credit');
  const b = proxy.get('builder-a', 'credit');
  const c = await proxy.get('builder-a', 'credit');
  assert.equal(c.status, 429);
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  assert.equal((await proxy.get('builder-a', 'credit')).status, 200);
});

// --- SR14 M3 / L5 -------------------------------------------------------------------------------------------

test('SR14 M3: jsonShapeOk counts depth and values outside strings only', () => {
  const b = (t) => Buffer.from(t);
  assert.equal(jsonShapeOk(b('{"a":[1,2,{"b":"[[[[[["}]}')), true);
  assert.equal(jsonShapeOk(b('['.repeat(JSON_MAX_DEPTH) + ']'.repeat(JSON_MAX_DEPTH))), true);
  assert.equal(jsonShapeOk(b('['.repeat(JSON_MAX_DEPTH + 1) + ']'.repeat(JSON_MAX_DEPTH + 1))), false);
  assert.equal(jsonShapeOk(b(JSON.stringify({ s: '\\"['.repeat(1000) }))), true, 'escaped quotes stay inside the string');
  assert.equal(jsonShapeOk(b('[' + '0,'.repeat(50) + '0]'), { maxNodes: 40 }), false);
  assert.equal(jsonShapeOk(b('[' + '0,'.repeat(10) + '0]'), { maxNodes: 40 }), true);
});

test('SR14 M3: a 4 MiB nesting bomb and a 4 MiB tiny-object array are 502 without parsing, heap stays bounded', async () => {
  const MiB = 1024 * 1024;
  const half = 2 * MiB - 1;
  const nest = '['.repeat(half) + ']'.repeat(half);
  const objs = '[' + '{},'.repeat(Math.floor((4 * MiB - 8) / 3) - 1) + '{}]';
  const raw = await rawBuilder((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const body = p.endsWith('/diff') ? (p.includes('nest') ? nest : objs) : '{}';
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  const store = storeFor([['builder-a', raw.url]]);
  const proxy = createReadProxy({ store, key: hubKey });
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  for (let i = 0; i < 4; i++) {
    for (const lane of ['nest', 'objs']) {
      const out = await proxy.get('builder-a', `lanes/${lane}/diff`);
      assert.equal(out.status, 502, lane);
      assert.equal(out.json.error, 'upstream json too complex');
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
  }
  // parsing either body would cost ~100 MB of heap (SR14 measured ~30x); the scan costs ~nothing
  assert.ok(peak - before < 48 * MiB, `heap grew ${Math.round((peak - before) / MiB)} MiB`);
  assert.deepEqual(proxy.stats(), { inflight: 0, bytes: 0 });
});

test('SR14 M3: a hub-wide byte budget and read cap across builders answer 429', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const bigA = JSON.stringify({ s: 'a'.repeat(900 * 1024) });
  const held = 800 * 1024;
  const ra = await rawBuilder(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(bigA.slice(0, held)); // held in flight until released
    await gate;
    res.end(bigA.slice(held));
  });
  const rb = await rawBuilder((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ s: 'b'.repeat(400 * 1024) }));
  });
  const store = storeFor([['builder-a', ra.url], ['builder-b', rb.url]]);
  const proxy = createReadProxy({ store, key: hubKey, cfg: { bytesBudget: 1024 * 1024 } });
  const a = proxy.get('builder-a', 'credit');
  for (let i = 0; i < 200 && proxy.stats().bytes < held; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(proxy.stats().bytes, held, 'the first read holds its bytes');
  const ob = await proxy.get('builder-b', 'credit');
  assert.equal(ob.status, 429, "another builder's read is refused while the hub-wide budget is spent");
  assert.equal(ob.json.error, 'hub read budget exhausted');
  release();
  assert.equal((await a).status, 200);
  assert.deepEqual(proxy.stats(), { inflight: 0, bytes: 0 });
  assert.equal((await proxy.get('builder-b', 'credit')).status, 200, 'the budget is returned');

  // concurrent read cap across builders
  let rel2;
  const gate2 = new Promise((r) => { rel2 = r; });
  const slow = () => rawBuilder(async (req, res) => { await gate2; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const [sa, sb] = [await slow(), await slow()];
  const store2 = storeFor([['builder-a', sa.url], ['builder-b', sb.url]]);
  const p2 = createReadProxy({ store: store2, key: hubKey, cfg: { maxTotal: 2 } });
  const x = p2.get('builder-a', 'credit');
  const y = p2.get('builder-b', 'credit');
  assert.equal((await p2.get('builder-b', 'credit')).status, 429);
  rel2();
  assert.equal((await x).status, 200);
  assert.equal((await y).status, 200);
});

test('SR14 L5: browser route reads cannot take the slots reserved for hub services', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const raw = await rawBuilder(async (req, res) => { await gate; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const store = storeFor([['builder-a', raw.url]]);
  const proxy = createReadProxy({ store, key: hubKey, cfg: { maxInflight: 4, reserved: 1 } });
  const base = await hubServer(proxy);
  const routeReads = [0, 1, 2].map(() => rawGet(base, '/api/fleet/builder-a/v1/credit'));
  for (let i = 0; i < 100 && proxy.stats().inflight < 3; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal((await rawGet(base, '/api/fleet/builder-a/v1/credit')).status, 429, 'the route has 3 of 4 slots');
  const svc = proxy.get('builder-a', 'credit'); // the reserved slot
  for (let i = 0; i < 100 && proxy.stats().inflight < 4; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(proxy.stats().inflight, 4);
  release();
  assert.equal((await svc).status, 200);
  for (const r of await Promise.all(routeReads)) assert.equal(r.status, 200);
});

test('hub module imports no builder-only module', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', 'hub', 'read-proxy.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const i of imports) {
    assert.ok(i.startsWith('node:') || i.startsWith('../fleet/') || i === '../security.mjs' || i.startsWith('./'), `unexpected import ${i}`);
  }
  assert.ok(!/rejectUnauthorized/.test(src));
  assert.ok(!/console\.|log\(/.test(src.replace(/\/\/.*$/gm, '')), 'nothing is logged');
});
