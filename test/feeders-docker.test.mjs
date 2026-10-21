// Feeders (runs plan §4 B1, Night 3 task T12): the `docker` feeder maps a
// recorded `GET /containers/json?all=1` (invented compose project `acme`)
// into the feed format, and `read` talks to a fake Engine on a unix socket:
// it sends exactly one GET of the list and reports failures as values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as docker from '../server/feeders/docker.mjs';
import { feeder, collect, feederNames } from '../server/feeders/index.mjs';
import { fromFeed } from '../server/map.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/feeds/docker-containers.json', import.meta.url));
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));

test('every container is a guest of type container, by name, and the host counts the running ones', () => {
  const feed = docker.toFeed(fixture(), { source: 'builder-a', now: NOW });
  assert.equal(feed.source, 'builder-a');
  assert.equal(feed.at, NOW);
  assert.equal(feed.every, 60);
  assert.deepEqual(feed.events, []);
  assert.deepEqual(feed.host, { sub: 'docker · 4/6 containers running', alerts: [] });
  assert.deepEqual(feed.guests.map((g) => [g.name, g.type, g.status]), [
    ['acme-api-1', 'container', 'running'],
    ['acme-db-1', 'container', 'running'],
    ['acme-migrate-1', 'container', 'stopped'],
    ['acme-web-1', 'container', 'running'],
    ['cache', 'container', 'paused'],
    ['worker', 'container', 'running'],
  ]);
  assert.equal(feederNames.includes('docker'), true);
  assert.equal(feeder('docker'), docker);
});

test('a healthy container: ports deduped into services, image and ports in sub, compose in detail', () => {
  const web = docker.toFeed(fixture(), { now: NOW }).guests.find((g) => g.name === 'acme-web-1');
  assert.deepEqual(web, {
    name: 'acme-web-1', type: 'container', status: 'running',
    sub: 'nginx:1.27 · :8080 :8443',
    detail: {
      Image: 'nginx:1.27', Compose: 'acme / web', Status: 'Up 4 days (healthy)', Health: 'healthy',
      Ports: '8080→80/tcp, 8443→443/tcp', ID: 'a10000000000',
    },
    alerts: [],
    services: [
      { name: '8080/tcp', port: 8080, status: 'ok', sub: '→ 80/tcp' },
      { name: '8443/tcp', port: 8443, status: 'ok', sub: '→ 443/tcp' },
    ],
  });
});

test('an unhealthy container is a crit alert, its ports crit; a port bound to one address says so', () => {
  const api = docker.toFeed(fixture(), { now: NOW }).guests.find((g) => g.name === 'acme-api-1');
  assert.equal(api.status, 'running');
  assert.deepEqual(api.alerts, [{ level: 'crit', text: 'healthcheck failing' }]);
  assert.equal(api.detail.Health, 'unhealthy');
  assert.deepEqual(api.services, [{ name: '3000/tcp', port: 3000, status: 'crit', sub: '→ 3000/tcp on 127.0.0.1 only' }]);
  const feeds = new Map([['builder-a', docker.toFeed(fixture(), { source: 'builder-a', now: NOW })]]);
  const node = fromFeed({ feed: 'builder-a/acme-api-1' }, feeds, NOW);
  assert.equal(node.status, 'crit');
  assert.equal(node.why, 'healthcheck failing');
  assert.equal(fromFeed({ feed: 'builder-a/acme-web-1' }, feeds, NOW).status, 'ok');
  assert.equal(fromFeed({ feed: 'builder-a/acme-web-1/8443/tcp' }, feeds, NOW).status, 'ok', 'a port is a service ref');
  assert.equal(fromFeed({ feed: 'builder-a/acme-api-1/3000/tcp' }, feeds, NOW).status, 'crit');
});

test('an exited container is stopped, down on the Map with its exit code, its services down', () => {
  const feed = docker.toFeed(fixture(), { source: 'builder-a', now: NOW });
  const migrate = feed.guests.find((g) => g.name === 'acme-migrate-1');
  assert.equal(migrate.status, 'stopped', 'State "Exited" is compared in lower case');
  assert.equal(migrate.why, 'exited with code 1');
  assert.deepEqual(migrate.alerts, []);
  assert.equal('services' in migrate, false, 'no published port, no service');
  const node = fromFeed({ feed: 'builder-a/acme-migrate-1' }, new Map([['builder-a', feed]]), NOW);
  assert.equal(node.status, 'down');
  assert.equal(node.why, 'exited with code 1');
  assert.equal(node.metrics, undefined);
});

test('health starting, paused, restarting and unpublished ports', () => {
  const { guests } = docker.toFeed(fixture(), { now: NOW });
  const db = guests.find((g) => g.name === 'acme-db-1');
  assert.equal(db.detail.Health, 'starting');
  assert.deepEqual(db.alerts, [], 'a starting healthcheck is not trouble yet');
  assert.equal('services' in db, false, 'an exposed port that is not published cannot be reached');
  assert.equal(db.sub, 'postgres:17');
  const cache = guests.find((g) => g.name === 'cache');
  assert.equal('Health' in cache.detail, false, '"(Paused)" is not health');
  assert.equal(cache.detail.Compose, undefined);
  assert.deepEqual(cache.services.map((s) => [s.name, s.status]), [['6379/tcp', 'warn'], ['6379/udp', 'warn']]);
  assert.equal(cache.sub, 'redis:7 · :6379', 'one port word per port number');
  const worker = guests.find((g) => g.name === 'worker');
  assert.deepEqual(worker.alerts, [{ level: 'crit', text: 'restarting (exit 2)' }]);
  assert.equal('Compose' in worker.detail, false, 'Labels null is no labels');
});

test('nothing but the name, image, state, ports and compose labels leaves the list', () => {
  const text = JSON.stringify(docker.toFeed(fixture(), { now: NOW }));
  for (const word of ['node server.js', 'migrate.js', 'docker-entrypoint', 'container-number', 'sha256:']) {
    assert.equal(text.includes(word), false, `${word} stays out of the feed`);
  }
});

test('Command, Mounts and NetworkSettings / networks never reach the feed', () => {
  // The Engine's list carries these on every container; the fixture holds
  // Command only, so the rest is added here with values that stand out.
  const list = fixture().map((c, i) => ({
    ...c,
    Command: `secret-cmd-${i} --token=hunter2`,
    Mounts: [{ Type: 'bind', Source: `/srv/secret-mount-${i}`, Destination: '/data', Mode: 'rw', RW: true }],
    HostConfig: { NetworkMode: `secret-netmode-${i}` },
    NetworkSettings: { Networks: { [`secret-net-${i}`]: { IPAddress: `192.0.2.${100 + i}`, Gateway: '192.0.2.1', MacAddress: '02:42:c0:00:02:64', NetworkID: `secret-netid-${i}` } } },
  }));
  const feed = docker.toFeed(list, { now: NOW });
  const text = JSON.stringify(feed);
  for (const word of ['secret-', 'hunter2', '--token', '/srv/', '/data', '192.0.2.1', '02:42:', 'Mounts', 'Networks', 'NetworkSettings', 'HostConfig', 'Command']) {
    assert.equal(text.includes(word), false, `${word} stays out of the feed`);
  }
  // The same containers still arrive: the extra fields change nothing else.
  assert.deepEqual(feed, docker.toFeed(fixture().map(({ Command, ...c }) => c), { now: NOW }));
});

test('missing pieces are unknown, never a throw', () => {
  for (const input of [null, {}, [], [null, 7, {}], { data: [] }]) {
    const feed = docker.toFeed(input, { now: NOW });
    assert.equal(typeof feed.host.sub, 'string');
    assert.ok(Array.isArray(feed.guests));
  }
  const [odd] = docker.toFeed([{ Id: 'ffffffffffffffffffff', State: 'weird', Ports: [{ PublicPort: 'x' }, { PublicPort: 99999 }] }], { now: NOW }).guests;
  assert.equal(odd.name, 'ffffffffffff');
  assert.equal(odd.status, 'unknown');
  assert.equal('services' in odd, false);
  assert.equal(docker.containerName({ Names: ['/', '/b'] }), 'b');
  assert.equal(docker.healthOf('Exited (1) 3 minutes ago'), null);
  assert.equal(docker.healthOf(undefined), null);
});

test('the fixture uses invented names only', () => {
  const list = fixture();
  assert.deepEqual(list.map((c) => c.Names[0]).sort(), ['/acme-api-1', '/acme-db-1', '/acme-migrate-1', '/acme-web-1', '/cache', '/worker']);
  const addrs = new Set(JSON.stringify(list).match(/\b\d+\.\d+\.\d+\.\d+\b/g));
  assert.deepEqual([...addrs].sort(), ['0.0.0.0', '127.0.0.1'], 'wildcard and loopback only');
});

// ----------------------------------------------------- read, over a unix socket

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-docker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake Engine on a unix socket in a temp dir; `seen` records every request. */
async function fakeEngine(t, handler) {
  const socket = path.join(tmpDir(t), 'docker.sock');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { socket, seen };
}

const answer = (code, body, type = 'application/json') => (req, res) => {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
};

test('read sends exactly one GET of the container list and gets the array back', async (t) => {
  const { socket, seen } = await fakeEngine(t, answer(200, fs.readFileSync(FIXTURE)));
  const r = await docker.read({ socket, timeoutMs: 5000 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.input, fixture());
  assert.deepEqual(seen, [{ method: 'GET', url: '/containers/json?all=1' }]);

  const c = await collect('docker', { socket, source: 'builder-a', now: NOW });
  assert.equal(c.ok, true, c.error);
  assert.deepEqual(c.feed, docker.toFeed(fixture(), { source: 'builder-a', now: NOW }));
  assert.equal(seen.length, 2, 'collect reads once more, and only the list');
  assert.ok(seen.every((s) => s.method === 'GET' && s.url === '/containers/json?all=1'));
});

test('an empty list is an answer: no containers, not a failure', async (t) => {
  const { socket } = await fakeEngine(t, answer(200, '[]'));
  const r = await collect('docker', { socket, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.feed.guests, []);
  assert.equal(r.feed.host.sub, 'docker · 0/0 containers running');
});

test('a missing socket, a proxy 403, a 500, non-JSON and a non-list are {ok:false}', async (t) => {
  const missing = path.join(tmpDir(t), 'nope.sock');
  const r0 = await docker.read({ socket: missing, timeoutMs: 2000 });
  assert.equal(r0.ok, false);
  assert.match(r0.error, /^docker: no socket at .*nope\.sock/);

  const cases = [
    [answer(403, 'Request forbidden by administrative rules.', 'text/plain'), /403\).*CONTAINERS=1/],
    [answer(500, '{"message":"boom"}'), /answered 500$/],
    [answer(200, 'not json', 'text/plain'), /did not answer JSON$/],
    [answer(200, '{"message":"page not found"}'), /did not answer a container list$/],
  ];
  for (const [handler, re] of cases) {
    const { socket } = await fakeEngine(t, handler);
    const r = await docker.read({ socket, timeoutMs: 2000 });
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  }
  assert.deepEqual(await docker.read({ socket: '' }), { ok: false, error: 'docker: the socket must be a path' });
});

test('a socket that does not answer times out as a value', async (t) => {
  const { socket } = await fakeEngine(t, () => { /* never answers */ });
  const r = await docker.read({ socket, timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.match(r.error, /did not answer in 0\.2s$/);
});

test('laneboard feed docker --socket prints the feed; --socket is for docker only', async (t) => {
  const { socket } = await fakeEngine(t, answer(200, fs.readFileSync(FIXTURE)));
  const home = tmpDir(t);
  const env = {
    PATH: process.env.PATH, HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'), XDG_STATE_HOME: path.join(home, 'xdg-state'),
    LANEBOARD_CONFIG: path.join(home, 'no-config.json'), LANEBOARD_URL: 'http://127.0.0.1:9',
  };
  const run = (args) => new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd: home, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
  const r = await run(['feed', 'docker', '--socket', socket, '--source', 'builder-a']);
  assert.equal(r.code, 0, r.stderr);
  const feed = JSON.parse(r.stdout);
  assert.deepEqual(feed, docker.toFeed(fixture(), { source: 'builder-a', now: feed.at }));

  const bad = await run(['feed', 'tailscale', '--socket', socket]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--socket is for docker only/);
  const gone = await run(['feed', 'docker', '--socket', path.join(home, 'nope.sock')]);
  assert.equal(gone.code, 1);
  assert.equal(gone.stdout, '');
  const help = await run(['feed', '--help']);
  assert.match(help.stdout, /docker\s+\[--socket path\]/);
});

test('on the Map: containers hang under the source machine, and Find reaches one by its port', async () => {
  const { buildFleet } = await import('../server/map.mjs');
  const { nodeItems } = await import('../public/js/ui/palette.js');
  const { rankItems } = await import('../public/js/ui/fuzzy.js');
  const feeds = new Map([['builder-a', docker.toFeed(fixture(), { source: 'builder-a', now: NOW })]]);
  const m = buildFleet({ topology: null, feeds, now: NOW, hostname: 'hub' });
  const web = m.nodes.find((n) => n.label === 'acme-web-1');
  assert.ok(web, 'a discovered container node');
  assert.equal(web.status, 'ok');
  assert.equal(m.nodes.find((n) => n.label === 'acme-migrate-1').status, 'down');
  const [first] = rankItems(nodeItems(m), ':8443');
  assert.equal(first?.label, 'acme-web-1');
});
