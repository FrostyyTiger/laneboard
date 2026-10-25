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
  demoLargeCycle, createLargeLive, LARGE_PERIOD_TICKS, LARGE_TROUBLE,
} from './helpers/demo-hub.mjs';
import { buildFleet, parseTopology, feedProblem, feedEvents, fromFeed } from '../server/map.mjs';
import { generateHubKey, publicKeyString } from '../server/fleet/keys-ed25519.mjs';

const NOW = 1_790_000_000_000;
const SITES = ['lab', 'hv2', 'cloud', 'remote', 'home'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The large Map model as the hub builds it, without builders. */
function largeModel(now = NOW, list = demoFeedsLarge(now)) {
  const feeds = new Map(list.map((f) => [f.source, { ...f, receivedAt: now }]));
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

// ------------------------------------------------------------ live part (T3)

const TROUBLE = ['warn', 'attention', 'crit', 'down'];
const TICK = 4000;
/** The site a node sits under. */
const siteOf = (m, id) => {
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  let n = byId.get(id);
  while (n && n.kind !== 'site' && byId.has(n.parent)) n = byId.get(n.parent);
  return n?.id;
};

test('large demo live: one period has a crit, an attention and a warn, each on its own site, each clearing and coming back', () => {
  const live = createLargeLive();
  const seen = new Map(); // level -> {sites, on: [tick], off: [tick]}
  const flowIds = new Set(DEMO_TOPOLOGY_LARGE.links.filter((l) => l.kind === 'flow').map((l) => `${l.from}>${l.to}`));
  const linksHit = new Set();
  let calm = 0;
  let events = 0;
  // Two periods, so "coming back" is seen after "clearing".
  for (let n = 1; n <= 2 * LARGE_PERIOD_TICKS; n++) {
    const now = NOW + n * TICK;
    const m = largeModel(now, live(n, now));
    assert.equal(m.error, undefined);
    const bad = m.nodes.filter((x) => x.kind === 'room' && TROUBLE.includes(x.status));
    if (!bad.length) calm++;
    for (const level of ['crit', 'attention', 'warn']) {
      const s = seen.get(level) ?? { sites: new Set(), on: [], off: [] };
      const hit = bad.filter((x) => x.status === level);
      for (const x of hit) {
        s.sites.add(siteOf(m, x.id));
        assert.ok(x.why, `${x.id} says why`);
      }
      (hit.length ? s.on : s.off).push(n);
      seen.set(level, s);
    }
    for (const e of demoLargeCycle(n).events) {
      events++;
      if (e.link) { assert.ok(flowIds.has(e.link), `${e.link} is a flow link`); linksHit.add(e.link); }
    }
  }
  const sites = [];
  for (const [level, s] of seen) {
    assert.ok(s.on.length > 0, `${level} appears`);
    assert.ok(s.off.length > 0, `${level} clears`);
    // Off between two on ticks: it cleared and came back.
    assert.ok(s.off.some((t) => s.on.some((a) => a < t) && s.on.some((b) => b > t)), `${level} returns`);
    assert.equal(s.sites.size, 1, `${level} stays on one site`);
    sites.push(...s.sites);
  }
  assert.equal(new Set(sites).size, 3, `three different sites: ${sites}`);
  assert.ok(calm > 0, 'a calm moment in the period');
  assert.ok(events / 2 >= 1, 'at least one event per period');
  assert.equal(linksHit.size, flowIds.size, 'every flow link gets its comets');
});

test('large demo live: the cycle is pure and repeats every period; the door opens every few minutes', () => {
  for (let n = 0; n < LARGE_PERIOD_TICKS; n++) assert.deepEqual(demoLargeCycle(n).alerts, demoLargeCycle(n + LARGE_PERIOD_TICKS).alerts);
  const doors = [];
  for (let n = 0; n < LARGE_PERIOD_TICKS; n++) if (demoLargeCycle(n).events.some((e) => e.guest === 'front-door')) doors.push(n);
  assert.ok(doors.length >= 2 && doors.length <= 4, `door events: ${doors}`);
  // At the default 4 s tick: about every two minutes.
  for (let i = 1; i < doors.length; i++) assert.ok((doors[i] - doors[i - 1]) * TICK >= 60_000);
  for (const t of LARGE_TROUBLE) assert.ok(t.to > t.from && t.to <= LARGE_PERIOD_TICKS, t.guest);
});

test('large demo live: the hub reads each event once, flow events carry their link to a node', () => {
  const live = createLargeLive();
  const topo = parseTopology(structuredClone(DEMO_TOPOLOGY_LARGE));
  const mark = new Map();
  const read = (n) => {
    const now = NOW + n * TICK;
    return feedEvents(new Map(live(n, now).map((f) => [f.source, f])), topo, mark);
  };
  assert.deepEqual(read(1), [], 'the first read sets the mark');
  const got = [];
  for (let n = 2; n <= 12; n++) got.push(...read(n));
  // Ticks 3, 5 (the door), 6, 9, 12: each once, though they stay in the file.
  assert.equal(got.length, 5, JSON.stringify(got));
  assert.equal(new Set(got.map((e) => e.at)).size, got.length);
  const door = got.find((e) => e.text === 'front door opened');
  assert.equal(door.node, 'front-door');
  const flows = got.filter((e) => e.link);
  assert.equal(flows.length, 4);
  for (const e of flows) {
    assert.equal(e.node, e.link.split('>')[0], `${e.link} starts at its node`);
    assert.equal(e.kind, 'ok');
  }
  // The file keeps only the last few.
  for (let n = 13; n <= 60; n++) read(n);
  const feeds = live(61, NOW + 61 * TICK);
  assert.ok(feeds.reduce((k, f) => k + (f.events?.length ?? 0), 0) <= 8);
  for (const f of feeds) assert.equal(feedProblem(f), null, f.source);
});

test('feeds: an alert at level attention makes a guest or host need a person', () => {
  const feed = {
    source: 'hv9', at: NOW, every: 30,
    host: { alerts: [{ level: 'attention', text: 'fan filter to clean' }] },
    guests: [
      { name: 'jammed', status: 'running', alerts: [{ level: 'attention', text: 'paper jam' }] },
      { name: 'worse', status: 'running', alerts: [{ level: 'attention', text: 'paper jam' }, { level: 'crit', text: 'on fire' }] },
      { name: 'odd', status: 'running', alerts: [{ level: 'loud', text: 'what' }] },
    ],
  };
  const feeds = new Map([['hv9', { ...feed, receivedAt: NOW }]]);
  const of = (ref) => fromFeed({ feed: ref }, feeds, NOW);
  assert.deepEqual([of('hv9').status, of('hv9').why], ['attention', 'fan filter to clean']);
  assert.deepEqual([of('hv9/jammed').status, of('hv9/jammed').why], ['attention', 'paper jam']);
  assert.deepEqual([of('hv9/worse').status, of('hv9/worse').why], ['crit', 'on fire']);
  assert.equal(of('hv9/odd').status, 'warn', 'an unknown level is still a warning');
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
