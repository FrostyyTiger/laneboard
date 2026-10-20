// POST /api/map/feeds (docs/plans/runs PROGRESS T7; docs/map.md "Pushing a
// feed"): the module is registered on the real router and called through
// handleRequest, so the local guards are the ones a request meets. The global
// config points the Map at a temp feeds dir and topology file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';

import { handleRequest } from '../server/http.mjs';
import { config } from '../server/config.mjs';
import { createContext } from '../server/modules.mjs';
import * as mapModel from '../server/map.mjs';
import feedsModule, { checkFeed, feedFile, writeFeed, BODY_LIMIT, FEEDS_PATH } from '../server/routes/feeds.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-feeds-route-'));
const feedsDir = path.join(tmp, 'feeds');
const topoFile = path.join(tmp, 'map.json');
fs.writeFileSync(topoFile, JSON.stringify({
  title: 'acme',
  nodes: [
    { id: 'hv1', kind: 'host', label: 'hv1', feed: 'hv1' },
    { id: 'web', kind: 'room', parent: 'hv1', label: 'web', feed: 'hv1/101' },
  ],
}));
const saved = { map: config.map, fleet: config.fleet };
config.map = { ...config.map, feedsDir, file: topoFile };
test.after(() => {
  config.map = saved.map;
  config.fleet = saved.fleet;
  fs.rmSync(tmp, { recursive: true, force: true });
});

feedsModule.register(createContext({ mode: 'builder' }));

const LOCAL = `127.0.0.1:${config.port}`;
const HEADERS = { host: LOCAL, 'content-type': 'application/json', 'x-laneboard': '1' };

/** One request through handleRequest; resolves to {status, body}. */
async function post(body, headers = HEADERS) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method: 'POST', url: FEEDS_PATH, headers, socket: { remoteAddress: '127.0.0.1' } });
  const res = new PassThrough();
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  const out = { status: 0 };
  res.headersSent = false;
  res.writeHead = (s) => { out.status = s; };
  const done = new Promise((resolve) => res.on('end', () => resolve(out)));
  await handleRequest(req, res);
  await done;
  const text = Buffer.concat(chunks).toString('utf8');
  return { status: out.status, body: text ? JSON.parse(text) : null };
}

const feed = (over = {}) => ({
  source: 'hv1',
  at: Date.now(),
  every: 30,
  host: { cpu: 0.2, mem: 0.4, disk: 0.1 },
  guests: [{ vmid: 101, name: 'web', type: 'qemu', status: 'running', cpu: 0.1, mem: 1, maxmem: 4 }],
  ...over,
});

test('a good feed lands in <feedsDir>/<source>.json and shows in /api/map', async () => {
  const r = await post(JSON.stringify(feed()));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['at', 'ok', 'source']);
  assert.equal(r.body.source, 'hv1');
  const file = path.join(feedsDir, 'hv1.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).guests[0].name, 'web');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(feedsDir), ['hv1.json'], 'no temp file left behind');

  // The next Map tick reads it, as for a feed written by --out.
  mapModel.tick(null);
  const nodes = new Map(mapModel.model().nodes.map((n) => [n.id, n]));
  assert.equal(nodes.get('web').status, 'ok');
  assert.ok(!/no feed/.test(nodes.get('hv1').why ?? ''), nodes.get('hv1').why);
});

test('a feed without `at` gets the server time; a second push replaces the file', async () => {
  const before = Date.now();
  const r = await post(JSON.stringify(feed({ at: undefined, guests: [] })));
  assert.equal(r.status, 201);
  assert.ok(r.body.at >= before);
  const onDisk = JSON.parse(fs.readFileSync(path.join(feedsDir, 'hv1.json'), 'utf8'));
  assert.equal(onDisk.at, r.body.at);
  assert.deepEqual(onDisk.guests, []);
});

test('the none feeder\'s empty feed passes the shape check', async () => {
  const { toFeed } = await import('../server/feeders/none.mjs');
  assert.equal(mapModel.feedProblem(toFeed(null, { source: 'none', now: 1 })), null);
  assert.equal(mapModel.feedProblem({ source: 'x', guests: [] }), null);
  assert.equal(mapModel.feedProblem({ source: 'x', host: {} }), null);
});

test('a bad source or shape is 400 with the reason, nothing written', async () => {
  for (const source of [undefined, '', '../etc', '.hidden', 'a/b', 'x'.repeat(65), 7]) {
    const r = await post(JSON.stringify(feed({ source })));
    assert.equal(r.status, 400, String(source));
    assert.match(r.body.error, /source/);
  }
  for (const [body, why] of [
    ['', /empty/], ['{', /not JSON/], ['[]', /object/], ['"hv1"', /object/],
    [JSON.stringify(feed({ source: 'bad1', guests: {} })), /guests/],
    [JSON.stringify(feed({ source: 'bad2', host: [] })), /host/],
    [JSON.stringify(feed({ source: 'bad3', at: 'now' })), /at/],
    ['{"source":"hv1","kind":"x","nodes":[]}', /needs a host object or a guests list/],
  ]) {
    const r = await post(body);
    assert.equal(r.status, 400, body);
    assert.match(r.body.error, why);
  }
  assert.deepEqual(fs.readdirSync(feedsDir).sort(), ['hv1.json']);
});

test('a body over 1 MiB is 413', async () => {
  const big = JSON.stringify(feed({ source: 'big', pad: 'x'.repeat(BODY_LIMIT) }));
  const r = await post(big);
  assert.equal(r.status, 413);
  assert.ok(!fs.existsSync(path.join(feedsDir, 'big.json')));
});

test('without the x-laneboard header the guards answer 403 and nothing is written', async () => {
  const { 'x-laneboard': _, ...headers } = HEADERS;
  const r = await post(JSON.stringify(feed({ source: 'noheader' })), headers);
  assert.equal(r.status, 403);
  assert.ok(!fs.existsSync(path.join(feedsDir, 'noheader.json')));
});

test('a builder a hub watches refuses with 409: the hub reads the feeds', async () => {
  config.fleet = { ...(config.fleet ?? {}), hubKeys: ['hub-key'] };
  try {
    const r = await post(JSON.stringify(feed({ source: 'watched' })));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /hub/);
    assert.ok(!fs.existsSync(path.join(feedsDir, 'watched.json')));
  } finally {
    config.fleet = saved.fleet;
  }
});

test('checkFeed, feedFile and writeFeed are strict about what reaches the disk', async () => {
  assert.equal(checkFeed(JSON.stringify({ source: 'tailscale', guests: [] }), 5).feed.at, 5);
  assert.equal(checkFeed(JSON.stringify({ source: 'tailscale', host: {}, future: { x: 1 } })).ok, true, 'unknown fields pass');
  assert.equal(feedFile(feedsDir, '../x'), null);
  assert.equal(feedFile('', 'hv1'), null);
  assert.equal(feedFile(feedsDir, 'hv1'), path.join(feedsDir, 'hv1.json'));
  await assert.rejects(writeFeed(feedsDir, '../x', {}), /bad source/);
});

test('readFeeds skips a file whose shape the route would refuse', () => {
  const dir = path.join(tmp, 'mixed');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify({ source: 'good', guests: [] }));
  fs.writeFileSync(path.join(dir, 'list.json'), '[1, 2]');
  fs.writeFileSync(path.join(dir, 'guests.json'), JSON.stringify({ source: 'guests', guests: 'none' }));
  fs.writeFileSync(path.join(dir, 'typo.json'), JSON.stringify({ source: 'typo', kind: 'x', nodes: [] }));
  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ source: 'empty', host: {} }));
  assert.deepEqual([...mapModel.readFeeds(dir).keys()].sort(), ['empty', 'good']);
});
