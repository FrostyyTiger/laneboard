// fleet F5: Host allowlist, Origin check, X-Laneboard CSRF header, CSP, OPTIONS 405.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';

process.env.LANEBOARD_CONFIG ??= path.join(import.meta.dirname, 'fixtures', 'empty-config.json');

const sec = await import('../server/security.mjs');
const { allowedHosts, checkHost, checkOrigin, checkCsrf, isMutating, HOOK_PATHS, securityHeaders, wantsCsp, checkRequest, checkUpgrade, warnRateLimited } = sec;
const { handleRequest, route } = await import('../server/http.mjs');
const { config } = await import('../server/config.mjs');
const { upgradeAllowed } = await import('../server/boot/common.mjs');

const PUB = 'name.example.invalid';
const cfg = {
  port: 7777,
  bindAddresses: ['127.0.0.1'],
  publicUrl: `https://${PUB}:8443`,
  fleet: {
    ingressPort: 7778,
    publicHosts: ['alt.example.invalid:8443'],
    allowedOrigins: ['https://hub.example.invalid'],
  },
};
const req = (headers = {}, method = 'GET', extra = {}) => ({ method, headers, ...extra });

// --- allowedHosts / checkHost -------------------------------------------------

test('allowedHosts: loopback with port and ingressPort, publicUrl host:port, publicHosts, allowedOrigins hosts', () => {
  const s = allowedHosts(cfg);
  for (const h of ['127.0.0.1:7777', 'localhost:7777', '[::1]:7777', '127.0.0.1:7778', 'localhost:7778', '[::1]:7778',
    `${PUB}:8443`, 'alt.example.invalid:8443', 'hub.example.invalid']) {
    assert.ok(s.has(h), h);
  }
  assert.ok(!s.has('127.0.0.1'), 'loopback without a port is not allowed');
  assert.ok(!s.has(PUB), 'the public host without its port is not allowed');
});

test('allowedHosts: wildcard binds are not added, concrete ones are; tolerates junk config', () => {
  const s = allowedHosts({ port: 7790, bindAddresses: ['0.0.0.0', '::', '192.0.2.9', '2001:db8::1'] });
  assert.ok(s.has('192.0.2.9:7790'));
  assert.ok(s.has('[2001:db8::1]:7790'));
  assert.ok(!s.has('0.0.0.0:7790'));
  assert.ok(!s.has('[::]:7790'));
  assert.deepEqual([...allowedHosts({ publicUrl: 'not a url', fleet: { publicHosts: 'x', allowedOrigins: [3] } })], []);
  assert.deepEqual([...allowedHosts(null)], []);
});

test('allowedHosts: an https publicUrl on 443 allows the bare host (what a browser sends)', () => {
  assert.ok(allowedHosts({ publicUrl: 'https://hub.example.invalid/' }).has('hub.example.invalid'));
  assert.ok(allowedHosts({ publicUrl: 'https://hub.example.invalid:443' }).has('hub.example.invalid'));
});

test('checkHost: loopback ok, publicUrl host ok, evil refused', () => {
  assert.equal(checkHost(req({ host: '127.0.0.1:7777' }), cfg), null);
  assert.equal(checkHost(req({ host: 'localhost:7777' }), cfg), null);
  assert.equal(checkHost(req({ host: '[::1]:7778' }), cfg), null);
  assert.equal(checkHost(req({ host: `${PUB}:8443` }), cfg), null);
  assert.equal(checkHost(req({ host: `NAME.Example.INVALID:8443` }), cfg), null, 'hostnames compare case-insensitively');
  assert.equal(checkHost(req({ host: 'evil.example.invalid' }), cfg), 'bad-host');
  assert.equal(checkHost(req({ host: 'evil.example.invalid:7777' }), cfg), 'bad-host');
  assert.equal(checkHost(req({ host: '127.0.0.1:9999' }), cfg), 'bad-host', 'loopback on a port we do not listen on');
  assert.equal(checkHost(req({ host: '' }), cfg), 'bad-host');
});

test('checkHost: a Host without its port does not match a publicHosts entry with one (serve keeps :8443)', () => {
  assert.equal(checkHost(req({ host: PUB }), cfg), 'bad-host');
  assert.equal(checkHost(req({ host: 'alt.example.invalid' }), cfg), 'bad-host');
  assert.equal(checkHost(req({ host: 'alt.example.invalid:8443' }), cfg), null);
  assert.equal(checkHost(req({ host: `${PUB}:8444` }), cfg), 'bad-host');
});

// SR7 L1: a request without Host is refused, except a GET/HEAD (static assets) through checkRequest.
test('SR7 L1: no Host is refused on mutating requests and upgrades; GET may pass', () => {
  assert.equal(checkHost(req({}), cfg), 'bad-host');
  assert.equal(checkHost(req({}), cfg, { allowMissingHost: true }), null);
  for (const m of ['POST', 'DELETE', 'PROPFIND']) {
    assert.equal(checkRequest(req({ 'x-laneboard': '1' }, m), '/api/sessions/x/keys', cfg), 'bad-host', m);
  }
  assert.equal(checkRequest(req({}, 'POST'), '/api/hook', cfg), 'bad-host', 'the hook path too');
  assert.equal(checkRequest(req({}, 'GET'), '/js/app.js', cfg), null);
  assert.equal(checkRequest(req({}, 'HEAD'), '/', cfg), null);
  assert.equal(checkUpgrade(req({}), cfg), 'bad-host');
  assert.equal(checkUpgrade(req({}), cfg, { allowMissingHost: true }), 'bad-host', 'an upgrade can never opt out');
});

// SR7 L4: node keeps the first of duplicate Host lines; rawHeaders shows them all.
test('SR7 L4: duplicate Host lines are refused, even when both are allowed', () => {
  const two = (a, b, method = 'GET') => ({ method, headers: { host: a }, rawHeaders: ['Host', a, 'host', b] });
  assert.equal(checkHost(two('127.0.0.1:7777', 'evil.example.invalid'), cfg), 'bad-host');
  assert.equal(checkHost(two('127.0.0.1:7777', '127.0.0.1:7777'), cfg), 'bad-host');
  assert.equal(checkRequest(two('127.0.0.1:7777', 'evil.example.invalid'), '/', cfg), 'bad-host', 'GET too');
  assert.equal(checkUpgrade(two('127.0.0.1:7777', 'evil.example.invalid'), cfg), 'bad-host');
  assert.equal(checkHost({ headers: { host: '127.0.0.1:7777' }, rawHeaders: ['Host', '127.0.0.1:7777'] }, cfg), null, 'one is fine');
  assert.equal(checkHost({ headers: {}, rawHeaders: [] }, cfg), 'bad-host', 'rawHeaders without Host');
});

// SR7 L6: the default publicUrl must not trust another instance's port.
test('SR7 L6: a loopback publicUrl is trusted only on a port we listen on', () => {
  const other = { port: 7857, publicUrl: 'http://127.0.0.1:7777' };
  assert.ok(!allowedHosts(other).has('127.0.0.1:7777'));
  assert.equal(checkHost(req({ host: '127.0.0.1:7777' }), other), 'bad-host');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7857', origin: 'http://127.0.0.1:7777' }), other), 'bad-origin');
  assert.equal(checkRequest(req({ host: '127.0.0.1:7857', origin: 'http://127.0.0.1:7777' }, 'POST'), '/api/hook', other), 'bad-origin',
    'a page on 127.0.0.1:7777 cannot post to the hook of a 7857 instance');
  const same = { port: 7777, publicUrl: 'http://127.0.0.1:7777' };
  assert.equal(checkHost(req({ host: '127.0.0.1:7777' }), same), null);
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' }), same), null);
  assert.equal(checkRequest(req({ host: 'localhost:7777', origin: 'http://localhost:7777' }, 'POST'), '/api/hook', { port: 7857, publicUrl: 'http://localhost:7777' }),
    'bad-host', 'a same-origin request on the foreign port fails on Host');
  assert.equal(checkHost(req({ host: '127.0.0.1:7777' }), { port: 7857, fleet: { ingressPort: 7777 }, publicUrl: 'http://127.0.0.1:7777' }), null,
    'the ingress port counts');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7857', origin: 'http://127.0.0.1:7777' }), same, { listenPort: 7857 }), 'bad-origin',
    'ctx.listenPort narrows to the listener the request arrived on');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7778', origin: `https://${PUB}:8443` }), cfg), null, 'a non-loopback publicUrl is unaffected');
});

// SR7 L2: X-Forwarded-Proto is client-settable.
test('SR7 L2: X-Forwarded-Proto is ignored by default on loopback, honoured with the ingress flag', () => {
  const local = { port: 7857, publicUrl: 'http://127.0.0.1:7857' };
  const spoof = req({ host: '127.0.0.1:7857', origin: 'https://127.0.0.1:7857', 'x-forwarded-proto': 'https' }, 'POST');
  assert.equal(checkOrigin(spoof, local), 'bad-origin');
  assert.equal(checkOrigin(spoof, { ...local, publicUrl: `https://${PUB}:8443` }), 'bad-origin', 'https publicUrl but a loopback Host');
  assert.equal(checkUpgrade(spoof, local), 'bad-origin');
  assert.equal(checkOrigin(spoof, local, { trustForwardedProto: true }), null, 'the ingress listener trusts serve');
  const alt = req({ host: 'alt.example.invalid:8443', origin: 'https://alt.example.invalid:8443', 'x-forwarded-proto': 'https' });
  assert.equal(checkOrigin(alt, cfg), null, 'https publicUrl + a public Host: serve forwarded it');
  assert.equal(checkOrigin(alt, cfg, { trustForwardedProto: false }), 'bad-origin', 'an explicit false always ignores it');
  assert.equal(checkOrigin(alt, { ...cfg, publicUrl: 'http://127.0.0.1:7777' }), 'bad-origin', 'http publicUrl: ignored');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7857', origin: 'https://127.0.0.1:7857' }, 'GET', { socket: { encrypted: true } }), local), null,
    'a real TLS socket is https');
});

// --- checkOrigin ----------------------------------------------------------------

test('checkOrigin: missing ok, same ok, publicUrl ok, allowed-list ok, foreign refused', () => {
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777' }), cfg), null, 'missing');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' }), cfg), null, 'same, http');
  assert.equal(checkOrigin(req({ host: `${PUB}:8443`, origin: `https://${PUB}:8443`, 'x-forwarded-proto': 'https' }), cfg), null, 'same through serve');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7778', origin: `https://${PUB}:8443` }), cfg), null, 'publicUrl origin');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: 'https://hub.example.invalid' }), cfg), null, 'allowed list');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: 'https://evil.example.invalid' }), cfg), 'bad-origin');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: 'null' }), cfg), 'bad-origin');
  assert.equal(checkOrigin(req({ host: '127.0.0.1:7777', origin: '' }), cfg), 'bad-origin');
});

test('checkOrigin: exact, never same-site; scheme and port count', () => {
  const h = { host: '127.0.0.1:7777' };
  assert.equal(checkOrigin(req({ ...h, origin: 'https://x.hub.example.invalid' }), cfg), 'bad-origin', 'subdomain');
  assert.equal(checkOrigin(req({ ...h, origin: 'https://hub.example.invalid:444' }), cfg), 'bad-origin', 'other port');
  assert.equal(checkOrigin(req({ ...h, origin: 'http://hub.example.invalid' }), cfg), 'bad-origin', 'other scheme');
  assert.equal(checkOrigin(req({ ...h, origin: 'https://hub.example.invalid/' }), cfg), 'bad-origin', 'not an exact origin');
  assert.equal(checkOrigin(req({ ...h, origin: 'https://127.0.0.1:7777' }), cfg), 'bad-origin', 'https vs plain http listener');
  assert.equal(checkOrigin(req({ ...h, origin: 'http://127.0.0.1:7778' }), cfg), 'bad-origin', 'another loopback port');
});

// --- checkCsrf / isMutating -----------------------------------------------------

test('isMutating: everything but GET/HEAD/OPTIONS', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(isMutating(m), false, m);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'PROPFIND']) assert.equal(isMutating(m), true, m);
});

test('checkCsrf: POST without the header refused; hook paths and GET ok; header must be exactly 1', () => {
  assert.equal(checkCsrf(req({}, 'POST'), '/api/sessions/x/keys'), 'no-csrf-header');
  assert.equal(checkCsrf(req({}, 'DELETE'), '/api/sessions/x'), 'no-csrf-header');
  assert.equal(checkCsrf(req({ 'x-laneboard': '1' }, 'POST'), '/api/sessions/x/keys'), null);
  assert.equal(checkCsrf(req({ 'x-laneboard': 'true' }, 'POST'), '/api/sessions/x/keys'), 'no-csrf-header');
  assert.equal(checkCsrf(req({}, 'POST'), '/api/hook'), null);
  assert.equal(checkCsrf(req({}, 'POST'), '/api/hook/permission'), null);
  assert.equal(checkCsrf(req({}, 'POST'), '/api/hook/'), 'no-csrf-header', 'the exempt set is exact');
  assert.equal(checkCsrf(req({}, 'POST'), '/api/hooks'), 'no-csrf-header');
  assert.equal(checkCsrf(req({}, 'GET'), '/api/state'), null);
  assert.deepEqual([...HOOK_PATHS].sort(), ['/api/hook', '/api/hook/permission']);
});

test('checkRequest: the hook path still gets Host and Origin checks', () => {
  assert.equal(checkRequest(req({ host: '127.0.0.1:7777' }, 'POST'), '/api/hook', cfg), null, 'plain curl');
  assert.equal(checkRequest(req({ host: 'evil.example.invalid' }, 'POST'), '/api/hook', cfg), 'bad-host');
  assert.equal(checkRequest(req({ host: '127.0.0.1:7777', origin: 'https://evil.example.invalid' }, 'POST'), '/api/hook', cfg), 'bad-origin',
    'a cross-site form post carries an Origin');
  assert.equal(checkRequest(req({ host: '127.0.0.1:7777', origin: 'https://evil.example.invalid' }, 'GET'), '/api/state', cfg), null,
    'GET is only Host-checked');
});

test('checkUpgrade: Host and Origin', () => {
  assert.equal(checkUpgrade(req({ host: '127.0.0.1:7777' }), cfg), null);
  assert.equal(checkUpgrade(req({ host: `${PUB}:8443`, origin: `https://${PUB}:8443` }), cfg), null);
  assert.equal(checkUpgrade(req({ host: 'evil.example.invalid:7777' }), cfg), 'bad-host');
  assert.equal(checkUpgrade(req({ host: '127.0.0.1:7777', origin: 'https://evil.example.invalid' }), cfg), 'bad-origin');
});

test('warnRateLimited: once a minute per reason', () => {
  const seen = [];
  const w = (r) => seen.push(r);
  assert.equal(warnRateLimited(w, 'test-a', '', 1000), true);
  assert.equal(warnRateLimited(w, 'test-a', '', 30000), false);
  assert.equal(warnRateLimited(w, 'test-b', '', 30000), true);
  assert.equal(warnRateLimited(w, 'test-a', '', 61001), true);
  assert.deepEqual(seen, ['test-a', 'test-b', 'test-a']);
});

// --- CSP ------------------------------------------------------------------------

test('securityHeaders: nosniff + no-referrer always, CSP for html with ws/wss Host', () => {
  const plain = securityHeaders(null);
  assert.equal(plain['x-content-type-options'], 'nosniff');
  assert.equal(plain['referrer-policy'], 'no-referrer');
  assert.equal(plain['content-security-policy'], undefined);
  const csp = securityHeaders(req({ host: `${PUB}:8443` }), { html: true })['content-security-policy'];
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "font-src 'self'", `connect-src 'self' ws://${PUB}:8443 wss://${PUB}:8443`, "worker-src 'self'", "manifest-src 'self'",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'"]) {
    assert.ok(csp.split('; ').includes(d), d);
  }
  assert.doesNotMatch(csp, /unsafe-eval/);
  const odd = securityHeaders(req({ host: 'x y\r\nz' }), { html: true })['content-security-policy'];
  assert.match(odd, /connect-src 'self'; /, 'an odd Host never reaches the header');
});

// SR7 L7: the service worker and SVG get the CSP too.
test('SR7 L7: wantsCsp covers html, sw.js and svg; securityHeaders applies it by file or URL', () => {
  for (const f of ['/index.html', 'public/sw.js', '/sw.js?v=2', '/vendor/lucide/sprite.svg', 'X.SVG']) assert.equal(wantsCsp(f), true, f);
  for (const f of ['/js/app.js', '/css/app.css', '/notsw.js', '/sw.json', '', undefined, 3]) assert.equal(wantsCsp(f), false, String(f));
  assert.ok(securityHeaders(req({ host: LOCAL }), { file: '/x/sprite.svg' })['content-security-policy']);
  assert.ok(securityHeaders({ url: '/sw.js', headers: { host: LOCAL } })['content-security-policy']);
  assert.equal(securityHeaders({ url: '/js/app.js', headers: {} })['content-security-policy'], undefined);
});

// --- handleRequest with fake req/res ---------------------------------------------

let hits = 0;
route('POST', '/api/_sec-test/keys', (rq, rs) => { hits++; rs.writeHead(200, {}); rs.end('{}'); });
route('POST', '/api/hook/permission', (rq, rs) => { hits++; rs.writeHead(200, {}); rs.end('{}'); });

function fakeRes() {
  const res = new PassThrough();
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  const out = { status: 0, headers: {}, body: '' };
  res.headersSent = false;
  res.writeHead = (s, h = {}) => { out.status = s; out.headers = h; };
  const done = new Promise((resolve) => res.on('end', () => { out.body = Buffer.concat(chunks).toString('utf8'); resolve(out); }));
  return { res, done };
}
async function call(method, url, headers) {
  const { res, done } = fakeRes();
  await handleRequest({ method, url, headers }, res);
  return done;
}
const LOCAL = `127.0.0.1:${config.port}`;

test('handleRequest: 403 for a mutating request without X-Laneboard, the handler never runs', async () => {
  hits = 0;
  const r = await call('POST', '/api/_sec-test/keys', { host: LOCAL });
  assert.equal(r.status, 403);
  assert.deepEqual(JSON.parse(r.body), { error: 'forbidden', reason: 'no-csrf-header' });
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(hits, 0);
  const ok = await call('POST', '/api/_sec-test/keys', { host: LOCAL, 'x-laneboard': '1' });
  assert.equal(ok.status, 200);
  assert.equal(hits, 1);
});

test('handleRequest: bad Host and bad Origin are 403, even with the header and on GET for Host', async () => {
  hits = 0;
  let r = await call('POST', '/api/_sec-test/keys', { host: 'evil.example.invalid', 'x-laneboard': '1' });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).reason, 'bad-host');
  r = await call('GET', '/', { host: 'evil.example.invalid' });
  assert.equal(r.status, 403);
  r = await call('POST', '/api/_sec-test/keys', { host: LOCAL, 'x-laneboard': '1', origin: 'https://evil.example.invalid' });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).reason, 'bad-origin');
  assert.equal(hits, 0);
});

test('handleRequest: the hook path takes a plain POST but not a cross-site one', async () => {
  hits = 0;
  let r = await call('POST', '/api/hook/permission', { host: LOCAL, 'content-type': 'application/json' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/hook/permission', { host: LOCAL, origin: 'https://evil.example.invalid' });
  assert.equal(r.status, 403);
  assert.equal(hits, 1);
});

test('handleRequest: OPTIONS is 405 (no CORS preflight ever succeeds)', async () => {
  for (const url of ['/', '/api/_sec-test/keys', '/api/hook']) {
    const r = await call('OPTIONS', url, { host: LOCAL, origin: `http://${LOCAL}`, 'access-control-request-method': 'POST' });
    assert.equal(r.status, 405, url);
    assert.ok(r.headers.allow);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
});

test('handleRequest: index.html carries the CSP; a module does not need one but gets nosniff', async () => {
  const page = await call('GET', '/', { host: LOCAL });
  assert.equal(page.status, 200);
  const csp = page.headers['content-security-policy'];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'/);
  assert.ok(csp.includes(`ws://${LOCAL} wss://${LOCAL}`));
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  const spa = await call('GET', '/board', { host: LOCAL });
  assert.match(spa.headers['content-security-policy'], /script-src 'self'/, 'the SPA fallback too');
  const js = await call('GET', '/js/app.js', { host: LOCAL });
  assert.equal(js.status, 200);
  assert.equal(js.headers['x-content-type-options'], 'nosniff');
  assert.equal(js.headers['content-security-policy'], undefined);
});

test('SR7 L7: sw.js and the svg sprite are served with the CSP; GET without Host still serves assets', async () => {
  const sw = await call('GET', '/sw.js', { host: LOCAL });
  assert.equal(sw.status, 200);
  assert.match(sw.headers['content-security-policy'], /script-src 'self'/);
  const url = '/vendor/lucide/sprite.svg';
  const { res, done } = fakeRes();
  const rq = { method: 'GET', url, headers: { host: LOCAL } };
  res.req = rq; // node sets res.req; serveStatic falls back to it
  await handleRequest(rq, res);
  const svg = await done;
  assert.equal(svg.status, 200);
  assert.match(svg.headers['content-security-policy'], /default-src 'self'/);
  const bare = await call('GET', '/js/app.js', {});
  assert.equal(bare.status, 200, 'SR7 L1: Host-less GET of a static asset stays allowed');
  const post = await call('POST', '/api/_sec-test/keys', { 'x-laneboard': '1' });
  assert.equal(post.status, 403);
  assert.equal(JSON.parse(post.body).reason, 'bad-host');
});

test('index.html has no inline script the CSP would block', async () => {
  const page = await call('GET', '/', { host: LOCAL });
  for (const m of page.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc=/, 'every script is external');
    assert.equal(m[2].trim(), '');
  }
  assert.doesNotMatch(page.body, /\son[a-z]+\s*=/i, 'no inline event handlers');
});

// --- the upgrade guard over a real socket -----------------------------------------

async function rawUpgrade(headers) {
  const server = http.createServer();
  let proceeded = false;
  server.on('upgrade', (rq, socket) => {
    if (!upgradeAllowed(rq, socket, cfg)) return;
    proceeded = true;
    socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const reply = await new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1');
      let buf = '';
      s.on('data', (d) => { buf += d; });
      s.on('close', () => resolve(buf));
      s.on('error', reject);
      const lines = ['GET /ws HTTP/1.1', 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
      s.write(lines.join('\r\n') + '\r\n\r\n');
    });
    return { reply, proceeded };
  } finally {
    server.close();
  }
}

test('upgrade: a bad Origin is destroyed with a 403 line', async () => {
  const r = await rawUpgrade({ Host: '127.0.0.1:7777', Origin: 'https://evil.example.invalid' });
  assert.match(r.reply, /^HTTP\/1\.1 403 Forbidden\r\n/);
  assert.equal(r.proceeded, false);
});

test('upgrade: a bad Host is refused, a good Host/Origin proceeds', async () => {
  const bad = await rawUpgrade({ Host: 'evil.example.invalid:7777' });
  assert.match(bad.reply, /^HTTP\/1\.1 403 Forbidden\r\n/);
  assert.equal(bad.proceeded, false);
  const good = await rawUpgrade({ Host: `${PUB}:8443`, Origin: `https://${PUB}:8443` });
  assert.match(good.reply, /^HTTP\/1\.1 101/);
  assert.equal(good.proceeded, true);
  const cli = await rawUpgrade({ Host: '127.0.0.1:7777' });
  assert.equal(cli.proceeded, true, 'node ws / CLI with no Origin');
});

test('SR7 L4: two Host lines on a real upgrade are refused', async () => {
  const server = http.createServer();
  let proceeded = false;
  server.on('upgrade', (rq, socket) => {
    if (!upgradeAllowed(rq, socket, cfg)) return;
    proceeded = true;
    socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const reply = await new Promise((resolve, reject) => {
      const s = net.connect(server.address().port, '127.0.0.1');
      let buf = '';
      s.on('data', (d) => { buf += d; });
      s.on('close', () => resolve(buf));
      s.on('error', reject);
      s.write(['GET /ws HTTP/1.1', 'Host: 127.0.0.1:7777', 'Host: evil.example.invalid', 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='].join('\r\n') + '\r\n\r\n');
    });
    // node itself may already answer 400 for a duplicate Host; either way it never proceeds.
    assert.match(reply, /^HTTP\/1\.1 (403 Forbidden|400 Bad Request)\r\n/);
    assert.equal(proceeded, false);
  } finally {
    server.close();
  }
});

// --- clients send the header ------------------------------------------------------

test('every mutating client sends X-Laneboard: 1', async () => {
  const fs = await import('node:fs');
  const root = path.join(import.meta.dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const net = read('public/js/core/net.js');
  assert.match(net, /method: 'POST',\s*headers: \{[^}]*'x-laneboard': '1'/);
  assert.match(net, /method: 'DELETE', headers: \{ 'x-laneboard': '1' \}/);
  assert.match(read('public/js/ui/launch.js'), /\/api\/lanes', \{ method: 'POST', headers: \{[^}]*'x-laneboard': '1'/);
  assert.match(read('public/js/ui/render.js'), /\/api\/client-metrics', \{\s*method: 'POST',\s*headers: \{[^}]*'x-laneboard': '1'/);
  assert.match(read('bin/laneboard'), /'x-laneboard': '1'/);
  assert.match(read('deploy/soak.sh'), /-H 'X-Laneboard: 1'/);
  // Any other fetch with a method in public/js would be a new mutating client.
  for (const f of fs.readdirSync(path.join(root, 'public/js'), { recursive: true })) {
    if (!f.endsWith('.js')) continue;
    const src = read(path.join('public/js', f));
    for (const m of src.matchAll(/fetch\([^)]*method:\s*'(POST|PUT|PATCH|DELETE)'[^;]*/g)) {
      assert.match(m[0], /'x-laneboard': '1'/, `${f}: ${m[0].slice(0, 80)}`);
    }
  }
});
