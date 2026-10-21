// Feeders (runs plan §4 B1, task T5): the `proxmox` feeder maps a recorded
// `/cluster/resources` (invented host `hv1`, vmids 101-109) into the feed
// format, and `read` talks to a fake PVE over real TLS: the request it
// sends, the CA it trusts, and the failures it reports as values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as proxmox from '../server/feeders/proxmox.mjs';
import { feeder, collect } from '../server/feeders/index.mjs';
import { fromFeed } from '../server/map.mjs';

const fixture = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/feeds/${name}`, import.meta.url)), 'utf8'));
const NOW = Date.UTC(2026, 9, 20, 21, 0, 0);
const GiB = 2 ** 30;

test('one node: it is the host, with metrics, a summary line and storage alerts', () => {
  const feed = proxmox.toFeed(fixture('pve-resources.json'), { source: 'hv1', now: NOW });
  assert.equal(feed.source, 'hv1');
  assert.equal(feed.at, NOW);
  assert.equal(feed.every, 60);
  assert.deepEqual(feed.events, []);
  assert.deepEqual(feed.host, {
    name: 'hv1',
    cpu: 0.1834,
    mem: 48318382080 / 68719476736,
    disk: 30064771072 / 100931731456,
    sub: 'PVE · 64 GB · 5/7 guests running',
    detail: { CPU: '16 cores', Uptime: '14d', Templates: '2' },
    alerts: [{ level: 'warn', text: 'storage local-lvm 94% full' }],
  });
});

test('guests: vmid order, qemu and lxc, page-cache memory, disk only when known', () => {
  const { guests } = proxmox.toFeed(fixture('pve-resources.json'), { now: NOW });
  assert.deepEqual(guests.map((g) => g.vmid), [101, 102, 103, 104, 105, 106, 107, 108, 109]);
  assert.deepEqual(guests[0], {
    vmid: 101, name: 'web', type: 'qemu', status: 'running', cpu: 0.0912, uptime: 86400,
    mem: 2 * GiB, maxmem: 8 * GiB, memCache: true, tags: ['prod', 'web'],
    detail: { CPU: '4 cores', RAM: '8 GB', Tags: 'prod, web' }, alerts: [],
  });
  const proxy = guests.find((g) => g.vmid === 103);
  assert.equal(proxy.type, 'lxc');
  assert.equal(proxy.disk, 0.125, 'an lxc reports its root disk');
  assert.equal(proxy.detail.RAM, '512 MB');
  assert.equal('disk' in guests[0], false, 'a qemu disk of 0 is no figure, not an empty disk');
  assert.equal(guests.find((g) => g.vmid === 104).detail.Lock, 'backup');
  assert.equal(guests.find((g) => g.vmid === 102).detail.HA, 'started');
  const stopped = guests.find((g) => g.vmid === 105);
  assert.equal(stopped.status, 'stopped');
  assert.equal('cpu' in stopped || 'uptime' in stopped, false);
  assert.equal(guests.find((g) => g.vmid === 109).status, 'paused');
  assert.equal('tags' in guests.find((g) => g.vmid === 109), false, 'an empty tag string is no tags');
  for (const g of guests) assert.equal(g.memCache, true);
});

test('templates are marked, listed, and never trouble on the Map', () => {
  const feed = proxmox.toFeed(fixture('pve-resources.json'), { source: 'hv1', now: NOW });
  const tmpl = feed.guests.filter((g) => g.template);
  assert.deepEqual(tmpl.map((g) => g.name), ['debian-tmpl', 'alpine-tmpl']);
  for (const g of tmpl) {
    assert.equal(g.detail.Template, 'yes');
    assert.deepEqual(g.alerts, []);
  }
  const feeds = new Map([['hv1', feed]]);
  assert.equal(fromFeed({ feed: 'hv1/107' }, feeds, NOW).status, 'idle', 'a stopped template is at rest');
  assert.equal(fromFeed({ feed: 'hv1/105' }, feeds, NOW).status, 'down', 'a stopped VM is still down');
  const web = fromFeed({ feed: 'hv1/web' }, feeds, NOW);
  assert.equal(web.status, 'ok');
  assert.equal(web.memCache, true);
  assert.equal(web.metrics.mem, 0.25);
  assert.equal(fromFeed({ feed: 'hv1' }, feeds, NOW).status, 'warn');
});

test('a cluster: the host sums the online nodes, guests carry their node, one alert per shared storage', () => {
  const feed = proxmox.toFeed(fixture('pve-resources-cluster.json'), { now: NOW });
  assert.equal('name' in feed.host, false);
  assert.equal(feed.host.sub, 'PVE cluster · 1/2 nodes · 60 GB · 1/2 guests running');
  assert.equal(feed.host.cpu, 0.2);
  assert.equal(feed.host.mem, 0.5);
  assert.deepEqual(feed.host.alerts, [
    { level: 'warn', text: 'node hv2 is offline' },
    { level: 'crit', text: 'storage nas 98% full' },
  ]);
  assert.deepEqual(feed.guests.map((g) => [g.vmid, g.node, g.detail.Node, g.status]), [
    [101, 'hv1', 'hv1', 'running'],
    [201, 'hv2', 'hv2', 'unknown'],
  ]);
});

test('a cluster with `node` picked: that node is the host, only its guests', () => {
  const input = fixture('pve-resources-cluster.json');
  for (const feed of [proxmox.toFeed(input, { now: NOW, node: 'hv1' }), proxmox.toFeed({ ...input, node: 'hv1' }, { now: NOW })]) {
    assert.equal(feed.host.name, 'hv1');
    assert.deepEqual(feed.guests.map((g) => g.vmid), [101]);
    assert.equal('node' in feed.guests[0], false);
    assert.deepEqual(feed.host.alerts, [{ level: 'crit', text: 'storage nas 98% full' }]);
  }
});

test('missing pieces are unknown, never a throw', () => {
  for (const input of [null, {}, { data: null }, [], { data: [null, 7, { type: 'qemu' }] }]) {
    const feed = proxmox.toFeed(input, { now: NOW });
    assert.equal(typeof feed.host.sub, 'string');
    assert.ok(Array.isArray(feed.guests));
  }
  const odd = proxmox.toFeed({ data: [{ type: 'lxc', id: 'lxc/300' }] }, { now: NOW }).guests[0];
  assert.equal(odd.vmid, 300);
  assert.equal(odd.name, '300');
  assert.equal(odd.status, 'unknown');
  assert.deepEqual(proxmox.splitTags('a;b, c  d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(proxmox.splitTags(undefined), []);
});

test('the fixtures use invented names only', () => {
  const text = JSON.stringify([fixture('pve-resources.json'), fixture('pve-resources-cluster.json')]);
  const nodes = new Set([...text.matchAll(/"node":"([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...nodes].sort(), ['hv1', 'hv2']);
  assert.equal(/\b\d+\.\d+\.\d+\.\d+\b/.test(text), false, 'no addresses at all');
});

// ------------------------------------------------------------- read, over TLS

function hasOpenssl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** A throwaway self-signed certificate for localhost, made for this run. */
function makeCert(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { key, cert };
}

async function fakePve(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-pve-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { key, cert } = makeCert(dir);
  const seen = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  const secretFile = path.join(dir, 'secret');
  fs.writeFileSync(secretFile, 'aaaaaaaa-bbbb-cccc-dddd-000000000001\n', { mode: 0o600 });
  return { url: `https://localhost:${server.address().port}`, ca: cert, secretFile, seen, dir };
}

const json = (code, body) => (req, res) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const TOKEN = 'laneboard@pve!map';
const SECRET = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';

test('read sends one GET for /cluster/resources with the token header and trusts the given CA', { skip: !hasOpenssl() && 'no openssl' }, async (t) => {
  const pve = await fakePve(t, json(200, fixture('pve-resources.json')));
  const r = await proxmox.read({ url: `${pve.url}/some/path`, tokenId: TOKEN, secretFile: pve.secretFile, ca: pve.ca, env: {} });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.input.data.length, 13);
  assert.equal(pve.seen.length, 1);
  assert.equal(pve.seen[0].method, 'GET');
  assert.equal(pve.seen[0].url, '/api2/json/cluster/resources');
  assert.equal(pve.seen[0].headers.authorization, `PVEAPIToken=${TOKEN}=${SECRET}`);
  assert.match(pve.seen[0].headers.authorization, /^PVEAPIToken=[^@]+@[^!]+![^=]+=[0-9a-f-]+$/);
});

test('read takes the secret from LANEBOARD_PVE_SECRET, and collect picks a node', { skip: !hasOpenssl() && 'no openssl' }, async (t) => {
  const pve = await fakePve(t, json(200, fixture('pve-resources-cluster.json')));
  const r = await collect('proxmox', { source: 'lab', now: NOW, url: pve.url, tokenId: TOKEN, ca: pve.ca, node: 'hv1', env: { [proxmox.SECRET_ENV]: ` ${SECRET} ` } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.feed.source, 'lab');
  assert.equal(r.feed.host.name, 'hv1');
  assert.equal(pve.seen[0].headers.authorization, `PVEAPIToken=${TOKEN}=${SECRET}`);
  const none = await proxmox.read({ url: pve.url, tokenId: TOKEN, ca: pve.ca, node: 'hv9', env: { [proxmox.SECRET_ENV]: SECRET } });
  assert.deepEqual(none, { ok: false, error: `proxmox: localhost:${pve.url.split(':').pop()} has no node hv9` });
});

test('read: an untrusted certificate, 401, 403, 500, junk and a non-PVE answer are {ok:false}, and the secret never shows', { skip: !hasOpenssl() && 'no openssl' }, async (t) => {
  let answer = json(401, { data: null });
  const pve = await fakePve(t, (req, res) => answer(req, res));
  const opts = { url: pve.url, tokenId: TOKEN, secretFile: pve.secretFile, ca: pve.ca, env: {} };
  const errors = [];
  const untrusted = await proxmox.read({ ...opts, ca: undefined });
  assert.equal(untrusted.ok, false);
  assert.match(untrusted.error, /certificate not trusted \(DEPTH_ZERO_SELF_SIGNED_CERT\); pass the PVE CA file/);
  errors.push(untrusted.error);
  const cases = [
    [json(401, { data: null }), /refused the token \(401\)/],
    [json(403, { data: null }), /forbids this token \(403\): give it PVEAuditor/],
    [json(500, {}), /answered 500$/],
    [(req, res) => { res.writeHead(200); res.end('<html>'); }, /did not answer JSON/],
    [json(200, { nope: 1 }), /without a data list/],
    [json(200, { data: [{ type: 'storage' }] }), /lists no nodes/],
  ];
  for (const [handler, re] of cases) {
    answer = handler;
    const r = await proxmox.read(opts);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
    errors.push(r.error);
  }
  for (const e of errors) assert.equal(e.includes(SECRET) || e.includes('aaaaaaaa'), false, e);
});

test('read: a refused connection and a server that never answers are {ok:false}', { skip: !hasOpenssl() && 'no openssl' }, async (t) => {
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const refused = await proxmox.read({ url: `https://127.0.0.1:${port}`, tokenId: TOKEN, env: { [proxmox.SECRET_ENV]: SECRET } });
  assert.deepEqual(refused, { ok: false, error: `proxmox: 127.0.0.1:${port}: connection refused` });
  const pve = await fakePve(t, () => { /* never answers */ });
  const slow = await proxmox.read({ url: pve.url, tokenId: TOKEN, secretFile: pve.secretFile, ca: pve.ca, timeoutMs: 300, env: {} });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /did not answer in 0\.3s/);
});

test('read refuses bad options before any request, without throwing', async () => {
  const env = { [proxmox.SECRET_ENV]: SECRET };
  const cases = [
    [{ tokenId: TOKEN, env }, /an https URL/],
    [{ url: 'http://hv1.example.invalid:8006', tokenId: TOKEN, env }, /an https URL/],
    [{ url: 'not a url', tokenId: TOKEN, env }, /an https URL/],
    [{ url: 'https://hv1.example.invalid:8006', env }, /user@realm!name/],
    [{ url: 'https://hv1.example.invalid:8006', tokenId: 'laneboard@pve', env }, /user@realm!name/],
    [{ url: 'https://hv1.example.invalid:8006', tokenId: TOKEN, env: {} }, /no token secret.*LANEBOARD_PVE_SECRET/],
    [{ url: 'https://hv1.example.invalid:8006', tokenId: TOKEN, secretFile: '/nonexistent/secret', env }, /cannot read the token secret file \(ENOENT\)/],
    [{ url: 'https://hv1.example.invalid:8006', tokenId: TOKEN, env: { [proxmox.SECRET_ENV]: 'a\nb' } }, /not one line/],
    [{ url: 'https://hv1.example.invalid:8006', tokenId: TOKEN, env, ca: '/nonexistent/ca.pem' }, /cannot read the CA file \(ENOENT\)/],
  ];
  for (const [opts, re] of cases) {
    const r = await proxmox.read(opts);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  }
  assert.equal(proxmox.resourcesUrl('https://hv1.example.invalid:8006/api2/json').href, 'https://hv1.example.invalid:8006/api2/json/cluster/resources');
});

test('proxmox is in the feeder table', () => {
  assert.equal(feeder('proxmox'), proxmox);
});
