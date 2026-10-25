// The large demo fleet (Wall plan T1, docs/plans/wall/README.md §7.1): five
// sites and 100-150 nodes, the size of fleet the Wall is judged on. Its
// topology and feeds come from one table per site (test/helpers/demo-hub.mjs
// `DEMO_SITES_LARGE`), so a room never names a guest its feed lacks; the
// small demo (`DEMO_TOPOLOGY`, `demoFeed`) is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './helpers/boot.mjs';
import { fakeBuilder } from './helpers/fake-builder.mjs';
import {
  demoHubConfig, DEMO_TOPOLOGY, DEMO_TOPOLOGY_LARGE, DEMO_SITES_LARGE, demoFeed, demoFeedsLarge,
  demoFeedHv1, demoFeedHv2, demoFeedCloud, demoFeedRemote, demoFeedHome, writeDemoMapLarge,
} from './helpers/demo-hub.mjs';
import { buildFleet, parseTopology, feedProblem } from '../server/map.mjs';
import { generateHubKey, publicKeyString } from '../server/fleet/keys-ed25519.mjs';

const NOW = 1_790_000_000_000;
const SITES = ['lab', 'hv2', 'cloud', 'remote', 'home'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The large Map model as the hub builds it, without builders. */
function largeModel(now = NOW) {
  const feeds = new Map(demoFeedsLarge(now).map((f) => [f.source, { ...f, receivedAt: now }]));
  return buildFleet({ topology: parseTopology(structuredClone(DEMO_TOPOLOGY_LARGE)), feeds, now, hostname: 'demo-host' });
}

const topoSites = (m) => m.nodes.filter((n) => n.kind === 'site' && !n.id.startsWith('__'));

test('large demo: five sites and 100-150 nodes in the model', () => {
  const m = largeModel();
  assert.equal(m.error, undefined);
  assert.deepEqual(topoSites(m).map((n) => n.id), SITES);
  assert.deepEqual(topoSites(m).map((n) => n.label), ['hv1', 'hv2', 'cloud', 'remote', 'home']);
  // The builders, their lanes and sessions, the repo and the runs add 15-30
  // more on the hub; the model alone leaves room for them under 150.
  assert.ok(m.nodes.length >= 90 && m.nodes.length <= 120, `model nodes: ${m.nodes.length}`);
  for (const id of SITES) {
    const rooms = m.nodes.filter((n) => n.parent === id && n.kind === 'room');
    assert.ok(rooms.length >= 6, `${id} has ${rooms.length} rooms`);
  }
  assert.ok(m.nodes.filter((n) => n.kind === 'service').length >= 30, 'services under the rooms');
});

test('large demo: every feed loads and every declared node is seen', () => {
  const feeds = demoFeedsLarge(NOW);
  assert.deepEqual(feeds.map((f) => f.source), ['hv1', 'hv2', 'cloud', 'remote', 'home']);
  assert.deepEqual([demoFeedHv1, demoFeedHv2, demoFeedCloud, demoFeedRemote, demoFeedHome].map((f) => f(NOW)), feeds);
  for (const f of feeds) {
    assert.equal(feedProblem(f), null, f.source);
    assert.equal(f.at, NOW);
  }
  const m = largeModel();
  // Only the small demo's drift is left: `backup` declared but not seen.
  assert.deepEqual(m.nodes.filter((n) => n.status === 'unknown').map((n) => n.id), ['backup']);
  assert.deepEqual(m.nodes.filter((n) => n.drift).map((n) => [n.label, n.drift]), [['backup', 'missing'], ['scratch', 'undeclared']]);
  // Calm on its own: the trouble that comes and goes is the live part (T3).
  assert.ok(!m.nodes.some((n) => ['warn', 'attention', 'crit', 'down'].includes(n.status)), 'no trouble in the static part');
  // Asleep and meant-off machines are at rest, not down.
  assert.equal(m.nodes.find((n) => n.id === 'laptop-2').status, 'idle');
  assert.equal(m.nodes.find((n) => n.id === 'sandbox').status, 'idle');
  assert.equal(m.links.filter((l) => l.kind === 'flow').length >= 5, true, 'flow links for comets');
});

test('large demo: guest names are unique across sources (the Map would merge them)', () => {
  const names = demoFeedsLarge(NOW).flatMap((f) => [f.host.name, ...f.guests.map((g) => g.name)]);
  assert.equal(new Set(names).size, names.length);
});

test('large demo: the home site has lights and a 3D printer, the builders keep their rooms', () => {
  const home = DEMO_SITES_LARGE.find((s) => s.id === 'home');
  assert.ok(home.rooms.filter((r) => r.sub === 'light').length >= 4);
  assert.ok(home.rooms.some((r) => r.id === 'printer-3d'));
  const claims = DEMO_TOPOLOGY_LARGE.nodes.filter((n) => n.builder).map((n) => [n.id, n.builder]);
  assert.deepEqual(claims, [['room-a', 'builder-a'], ['room-b', 'builder-b'], ['room-c', 'builder-c']]);
});

test('large demo: documentation addresses only, and the small demo is unchanged', () => {
  // The hygiene test scans the names; addresses stay in the RFC 5737 ranges.
  const ips = demoFeedsLarge(NOW).flatMap((f) => [...f.host.ips, ...f.guests.flatMap((g) => g.ips)]);
  for (const ip of ips) assert.match(ip, /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/, ip);
  assert.equal(DEMO_TOPOLOGY.nodes.length, 6);
  assert.deepEqual(demoFeed(NOW).guests.map((g) => g.vmid), [101, 102, 103, 104, 106]);
});

function localGet(booted, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: booted.port, path: p, headers: { host: `127.0.0.1:${booted.port}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('large demo: a hub booted with it serves five sites and 100-150 nodes on /api/map', { timeout: 60_000 }, async (t) => {
  const { privateKey: hubKey } = generateHubKey();
  const pin = [{ key: publicKeyString(hubKey), id: 'hub', scopes: ['read'] }];
  const ids = ['builder-a', 'builder-b', 'builder-c'];
  const fakes = [];
  for (const id of ids) fakes.push(await fakeBuilder({ id, hubKeys: pin }));
  t.after(() => Promise.all(fakes.map((f) => f.close())));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-wall-large-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const map = writeDemoMapLarge(dir);
  const hub = await boot({
    mode: 'hub',
    hubKey,
    timeoutMs: 20_000,
    config: demoHubConfig({ builders: fakes.map((f, i) => ({ id: ids[i], url: f.url })), origins: [], publicHost: 'hub.example.invalid', map }),
  });
  t.after(() => hub.stop());

  let m = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const r = await localGet(hub, '/api/map');
    if (r.status === 200) {
      const x = JSON.parse(r.text);
      if (x.nodes.some((n) => n.id === 'builder:builder-c') && x.nodes.some((n) => n.id === 'printer-3d' && n.status === 'ok')) { m = x; break; }
    }
    await sleep(100);
  }
  assert.ok(m, 'the hub Map came up with the large topology and the builders');
  assert.equal(m.error, undefined);
  assert.deepEqual(topoSites(m).map((n) => n.id), SITES);
  assert.ok(m.nodes.length >= 100 && m.nodes.length <= 150, `/api/map nodes: ${m.nodes.length}`);
  assert.equal(m.nodes.find((n) => n.id === 'builder:builder-a').parent, 'room-a');
});
