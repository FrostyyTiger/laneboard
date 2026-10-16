// The Map's model: topology validation and the merge of feeds, probes and
// lanes into node statuses. All pure — no feed on disk, no network, no tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseTopology, TopologyError, fromFeed, feedRef, build, laneNodes, diffEvents, feedEvents, probeOnce,
  buildFleet, attachBuilders, fleetLaneNodes, repoNodes, fleetLinks, normalizeOverlaps, toMapFleet, tickFleet,
  shapeKey, linkOf, feedsEnabled, healthMetrics, KINDS, LINK_KINDS, model,
} from '../server/map.mjs';
import { laneNodeId } from '../server/fleet/keys.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { boot } from './helpers/boot.mjs';

const NOW = 1_800_000_000_000;

const topo = (over = {}) => parseTopology({
  title: 'lab',
  self: 'agents',
  nodes: [
    { id: 'hv', kind: 'site', feed: 'hv' },
    { id: 'web', parent: 'hv', kind: 'room', feed: 'hv/101' },
    { id: 'db', parent: 'hv', kind: 'room', feed: 'hv/102' },
    { id: 'spare', parent: 'hv', kind: 'room', feed: 'hv/103', expect: 'stopped' },
    { id: 'agents', parent: 'hv', kind: 'room', feed: 'hv/104' },
    { id: 'app', parent: 'web', kind: 'service' },
    { id: 'cloud', kind: 'site' },
    { id: 'api', parent: 'cloud', kind: 'room', probe: { url: 'https://api.example.invalid/health' } },
  ],
  links: [{ from: 'app', to: 'api', label: 'calls' }],
  lanes: { links: [{ match: '^pay', to: 'api', label: 'changes' }] },
  ...over,
});

const feed = (over = {}) => new Map([['hv', {
  source: 'hv', at: NOW - 20_000, every: 30,
  host: { cpu: 0.4, mem: 0.7 },
  guests: [
    { vmid: 101, name: 'web', status: 'running', cpu: 0.1, mem: 2, maxmem: 4 },
    { vmid: 102, name: 'db', status: 'stopped', type: 'lxc' },
    { vmid: 103, name: 'spare', status: 'stopped' },
    { vmid: 104, name: 'agents', status: 'running', cpu: 0.2, mem: 1, maxmem: 8 },
  ],
  ...over,
}]]);

test('a topology with a missing parent, a duplicate, a loop or a bad link is refused', () => {
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', parent: 'nope' }] }), TopologyError);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a' }, { id: 'a' }] }), /duplicate/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] }), /loop/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a' }], links: [{ from: 'a', to: 'z' }] }), /links\[0\]/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'lane:x' }] }), /laneboard's own/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', probe: { url: 'file:///etc/passwd' } }] }), /http/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a' }], lanes: { links: [{ match: '(', to: 'a' }] } }), /match/);
  assert.equal(parseTopology({}).nodes.length, 0);
});

test('feed refs name a host or one of its guests', () => {
  assert.deepEqual(feedRef('hv'), { source: 'hv', guest: null, service: null });
  assert.deepEqual(feedRef('hv/101'), { source: 'hv', guest: '101', service: null });
  assert.deepEqual(feedRef({ source: 'hv', guest: 7 }), { source: 'hv', guest: '7', service: null });
  assert.equal(feedRef(undefined), null);
});

test('a running guest is up with its metrics, a stopped one is down unless it is meant to be', () => {
  const f = feed();
  const web = fromFeed({ id: 'web', feed: 'hv/101' }, f, NOW);
  assert.equal(web.status, 'ok');
  assert.equal(web.metrics.mem, 0.5);
  const db = fromFeed({ id: 'db', feed: 'hv/102' }, f, NOW);
  assert.equal(db.status, 'down');
  assert.match(db.why, /container is stopped/);
  assert.equal(fromFeed({ id: 'spare', feed: 'hv/103', expect: 'stopped' }, f, NOW).status, 'idle');
  assert.match(fromFeed({ id: 'x', feed: 'hv/999' }, f, NOW).why, /does not list 999/);
});

test('a stale or missing feed is "no data", never a stale green', () => {
  const stale = fromFeed({ id: 'web', feed: 'hv/101' }, feed({ at: NOW - 20 * 60_000 }), NOW);
  assert.equal(stale.status, 'unknown');
  assert.match(stale.why, /no data from hv for 20m/);
  assert.equal(fromFeed({ id: 'web', feed: 'other/1' }, feed(), NOW).status, 'unknown');
});

test('host alerts raise the host above ok', () => {
  const f = feed({ host: { cpu: 0.2, alerts: [{ level: 'warn', text: 'NVMe 76°C' }] } });
  const hv = fromFeed({ id: 'hv', feed: 'hv' }, f, NOW);
  assert.equal(hv.status, 'warn');
  assert.equal(hv.why, 'NVMe 76°C');
});

test('build merges feeds, probes and inheritance', () => {
  const probes = new Map([['api', { ok: false, code: 502, at: NOW }]]);
  const m = build({ topology: topo(), feeds: feed(), probes, now: NOW, hostname: 'h' });
  const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.equal(m.title, 'lab');
  assert.equal(by.__core.kind, 'core', 'a core is made when the topology has none');
  assert.equal(by.hv.parent, '__core');
  assert.equal(by.web.status, 'ok');
  assert.equal(by.db.status, 'down');
  assert.equal(by.app.status, 'ok', 'a service with no check inherits its room');
  assert.equal(by.api.status, 'crit');
  assert.match(by.api.why, /HTTP 502/);
  assert.equal(by.cloud.status, 'ok', 'a site has no status of its own');
  assert.deepEqual(m.links.map((l) => l.id), ['app>api']);
});

test('a service inside a stopped room is down with the reason', () => {
  const t = topo({ nodes: [
    { id: 'hv', kind: 'site', feed: 'hv' },
    { id: 'db', parent: 'hv', kind: 'room', feed: 'hv/102' },
    { id: 'pg', parent: 'db', kind: 'service' },
  ], links: [], self: null, lanes: {} });
  const pg = build({ topology: t, feeds: feed(), now: NOW }).nodes.find((n) => n.id === 'pg');
  assert.equal(pg.status, 'down');
  assert.match(pg.why, /db is down/);
});

const snapshot = {
  vitals: { cpuPct: 25, mem: { totalMb: 1000, usedMb: 500 }, disk: { usedPct: 40 } },
  sessions: [
    { name: 's1', state: 'working', activity: { tool: 'Edit', toolInput: { file_path: '/w/pay/src/api/charge.ts' } } },
    { name: 's2', state: 'waiting_permission', stateSince: NOW - 12 * 60_000 },
    { name: 's3', state: 'done' },
  ],
  lanes: [
    { id: 'payments', branch: 'feat/pay', sessions: ['s1'] },
    { id: 'docs', branch: 'docs', sessions: ['s2', 's3'] },
    { id: 'old', branch: 'old', sessions: [], idle: true },
  ],
};

test('lanes: the worst session wins, idle worktrees stay off the active map', () => {
  const lanes = laneNodes(snapshot, { parent: 'agents', now: NOW, builderId: 'builder-a' });
  assert.deepEqual(lanes.map((l) => l.id), ['lane:builder-a/payments', 'lane:builder-a/docs']);
  const [pay, docs] = lanes;
  assert.equal(pay.status, 'working');
  assert.equal(pay.sub, 'Edit api/charge.ts');
  assert.equal(docs.status, 'attention');
  assert.equal(docs.why, 'waiting on a permission prompt · 12m');
  assert.equal(laneNodes(snapshot, { parent: 'x', show: 'all' }).length, 3);
  assert.equal(laneNodes(snapshot, { parent: 'x', show: 'none' }).length, 0);
});

test('lanes hang under the builder node, which hangs under `self` and carries this host\'s vitals, and link by rule', () => {
  const m = build({ topology: topo(), feeds: feed(), snapshot, now: NOW, builderId: 'builder-a' });
  const b = m.nodes.find((n) => n.id === 'builder:builder-a');
  assert.equal(b.parent, 'agents', 'legacy self aliases builder: <fleet.id>');
  assert.equal(b.kind, 'builder');
  assert.deepEqual(b.metrics, { cpu: 0.25, mem: 0.5, disk: 0.4 });
  assert.deepEqual(b.counts, { lanes: 3, working: 1, waiting: 1 });
  assert.equal(m.nodes.find((n) => n.id === 'agents').hosts, 'builder-a');
  const pay = m.nodes.find((n) => n.id === 'lane:builder-a/payments');
  assert.equal(pay.parent, 'builder:builder-a');
  const rule = m.links.find((l) => l.from === 'lane:builder-a/payments');
  assert.equal(rule.to, 'api');
  assert.equal(rule.live, true, 'a working lane\'s links are live');
  assert.ok(!m.links.some((l) => l.from === 'lane:builder-a/docs'));
  assert.ok(!m.nodes.some((n) => n.id === '__fleet'), '__fleet only when a builder is unclaimed');
  assert.deepEqual(m.fleet, { builders: [{ id: 'builder-a', code: 'BA', link: 'up' }] });
});

test('with no topology the map is core, fleet, this builder and its lanes', () => {
  const m = build({ topology: null, snapshot, hostname: 'box', now: NOW, builderId: 'builder-a' });
  assert.equal(m.title, 'box');
  assert.deepEqual(m.nodes.filter((n) => n.kind !== 'session').map((n) => [n.id, n.parent]), [
    ['__core', undefined], ['__fleet', '__core'], ['builder:builder-a', '__fleet'],
    ['lane:builder-a/payments', 'builder:builder-a'], ['lane:builder-a/docs', 'builder:builder-a'],
  ]);
  assert.doesNotMatch(m.nodes[2].sub, /not in topology/, 'no topology at all is not a missing field');
});

test('lane nodes use laneNodeId, keep the bare lane id as label and carry the session fkey (fleet F7)', () => {
  const [pay, docs] = laneNodes(snapshot, { parent: 'agents', now: NOW, builderId: 'builder-b' });
  assert.equal(pay.id, laneNodeId('builder-b', 'payments'));
  assert.equal(pay.label, 'payments');
  assert.equal(pay.session, 'builder-b/s1');
  assert.equal(docs.session, 'builder-b/s2');
  // Two builders with the same lane name give two distinct nodes.
  const [other] = laneNodes(snapshot, { parent: 'agents', now: NOW, builderId: 'builder-a' });
  assert.notEqual(other.id, pay.id);
});

test('without a builderId the lane ids use config.fleet.id', async () => {
  const { config } = await import('../server/config.mjs');
  const [pay] = laneNodes(snapshot, { parent: 'agents', now: NOW });
  assert.equal(pay.id, laneNodeId(config.fleet.id, 'payments'));
});

test('events: a status change is news, the first data in is not', () => {
  const a = { nodes: [{ id: 'db', label: 'db', status: 'ok' }, { id: 'x', label: 'x', status: 'unknown' }] };
  const b = { nodes: [{ id: 'db', label: 'db', status: 'down', why: 'VM is stopped' }, { id: 'x', label: 'x', status: 'ok' },
    { id: 'lane:new', label: 'new', kind: 'lane', status: 'working' }] };
  const ev = diffEvents(a, b, NOW);
  assert.deepEqual(ev.map((e) => e.text), ['db is down · VM is stopped', 'new started']);
  assert.deepEqual(diffEvents(null, b, NOW), []);
});

test('feed events are delivered once, and a feed\'s history is not replayed on first read', () => {
  const seen = new Map();
  const t = topo();
  const f1 = feed({ events: [{ at: NOW - 5000, text: 'old backup', guest: 101 }] });
  assert.deepEqual(feedEvents(f1, t, seen), []);
  const f2 = feed({ events: [{ at: NOW - 5000, text: 'old backup' }, { at: NOW + 1000, text: 'backup ok', guest: '101' }] });
  const out = feedEvents(f2, t, seen);
  assert.equal(out.length, 1);
  assert.equal(out[0].node, 'web');
  assert.deepEqual(feedEvents(f2, t, seen), []);
});

test('probes: status, latency, expectations and failures', async () => {
  const node = (probe) => ({ id: 'p', probe: { url: 'https://x.example.invalid', ...probe } });
  const reply = (status) => async () => ({ status, body: null });
  assert.equal((await probeOnce(node({}), { fetchImpl: reply(204) })).ok, true);
  assert.equal((await probeOnce(node({}), { fetchImpl: reply(503) })).ok, false);
  assert.equal((await probeOnce(node({ expect: 401 }), { fetchImpl: reply(401) })).ok, true);
  assert.equal((await probeOnce(node({ expect: '2xx' }), { fetchImpl: reply(301) })).ok, false);
  const refused = await probeOnce(node({}), { fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }); } });
  assert.deepEqual([refused.ok, refused.error], [false, 'connection refused']);
});

test('a VM whose memory counts page cache says so, and only then', () => {
  const f = feed({ guests: [{ vmid: 101, status: 'running', mem: 9, maxmem: 10, memCache: true }] });
  const t = parseTopology({ nodes: [{ id: 'web', feed: 'hv/101', kind: 'room' }, { id: 'db', kind: 'room', probe: { url: 'https://x.example.invalid' } }] });
  const m = build({ topology: t, feeds: f, probes: new Map([['db', { ok: true, code: 200, ms: 5 }]]), now: NOW });
  const web = m.nodes.find((n) => n.id === 'web');
  assert.equal(web.metrics.mem, 0.9);
  assert.equal(web.memCache, true);
  assert.equal(m.nodes.find((n) => n.id === 'db').memCache, undefined);
});

test('a dropped feed is one event, not one per guest and service', () => {
  const t = topo();
  const up = build({ topology: t, feeds: feed(), now: NOW });
  const gone = build({ topology: t, feeds: feed({ at: NOW - 60 * 60_000 }), now: NOW });
  const ev = diffEvents(up, gone, NOW);
  assert.deepEqual(ev.map((e) => e.node), ['hv']);
  assert.match(ev[0].text, /hv stopped reporting · no data from hv/);
  assert.equal(gone.nodes.find((n) => n.id === 'app').derived, true);
});

test('a service a guest lists takes its own status, and a stopped guest takes its services down', () => {
  assert.deepEqual(feedRef('hv/104/runner-1'), { source: 'hv', guest: '104', service: 'runner-1' });
  assert.deepEqual(feedRef('hv/104/a/b'), { source: 'hv', guest: '104', service: 'a/b' });
  assert.deepEqual(feedRef('hv/104'), { source: 'hv', guest: '104', service: null });
  assert.deepEqual(feedRef({ source: 'hv', guest: 104, service: 'r' }), { source: 'hv', guest: '104', service: 'r' });
  const f = feed({ guests: [
    { vmid: 104, status: 'running', services: [
      { name: 'r1', status: 'working', sub: 'job 3m' },
      { name: 'r2', status: 'idle' },
      { name: 'r3', status: 'down', why: 'unit failed', detail: { Unit: 'r3.service' } },
      { name: 'r4', status: 'exploded' },
    ] },
    { vmid: 102, status: 'stopped', services: [{ name: 'r9', status: 'ok' }] },
  ] });
  const at = (ref) => fromFeed({ id: 'x', feed: ref }, f, NOW);
  assert.deepEqual([at('hv/104/r1').status, at('hv/104/r1').sub], ['working', 'job 3m']);
  assert.equal(at('hv/104/r2').status, 'idle');
  assert.deepEqual([at('hv/104/r3').status, at('hv/104/r3').why, at('hv/104/r3').detail.Unit], ['down', 'unit failed', 'r3.service']);
  assert.equal(at('hv/104/r4').status, 'unknown');
  assert.match(at('hv/104/gone').why, /104 does not list gone/);
  assert.deepEqual([at('hv/102/r9').status, at('hv/102/r9').why], ['down', '102 is stopped']);
});

test('alerts from inside a running guest colour the room and keep its gauges', () => {
  const f = feed({ guests: [
    { vmid: 104, status: 'running', cpu: 0.2, mem: 1, maxmem: 8, disk: 0.99,
      alerts: [{ level: 'warn', text: 'docker is noisy' }, { level: 'crit', text: 'disk 99% full' }] },
    { vmid: 102, status: 'stopped', alerts: [{ level: 'crit', text: 'ignored' }] },
  ] });
  const room = fromFeed({ id: 'ci', feed: 'hv/104' }, f, NOW);
  assert.deepEqual([room.status, room.why, room.metrics.disk], ['crit', 'disk 99% full', 0.99]);
  assert.deepEqual([fromFeed({ id: 'db', feed: 'hv/102' }, f, NOW).status], ['down']);
});

test('feed events land on the guest, not on a service inside it', () => {
  const t = parseTopology({ nodes: [{ id: 'ci', kind: 'room', feed: 'hv/104' }, { id: 'r1', parent: 'ci', kind: 'service', feed: 'hv/104/r1' }] });
  const seen = new Map();
  feedEvents(feed({ events: [] }), t, seen);
  const ev = feedEvents(feed({ events: [{ at: NOW + 1, text: 'rebooted', guest: 104 }] }), t, seen);
  assert.deepEqual(ev.map((e) => e.node), ['ci']);
});

// ------------------------------------------------------------------ fleet (M1)

const fleetTopo = (over = {}) => parseTopology({
  title: 'lab',
  nodes: [
    { id: 'hv', kind: 'site', feed: 'hv' },
    { id: 'agents', parent: 'hv', kind: 'room', builder: 'builder-a' },
    { id: 'ci', parent: 'hv', kind: 'room', feed: 'hv/104', ci: { runner: true, for: ['builder-a'] } },
    { id: 'pool', parent: 'hv', kind: 'room', ci: { runner: true, for: '*' } },
  ],
  ...over,
});

const bsnap = (lanes, sessions) => ({ lanes, sessions });
const two = () => [
  { id: 'builder-a', code: 'B1', link: 'up', ageMs: 0, snapshot: snapshot },
  { id: 'builder-b', link: 'up', ageMs: 0, snapshot: bsnap([{ id: 'payments', branch: 'feat/pay-b', sessions: ['x1'] }], [{ name: 'x1', state: 'working' }]) },
];

test('fleet: kinds and link kinds carry the new ones', () => {
  for (const k of ['builder', 'session', 'repo', 'package']) assert.ok(KINDS.includes(k), k);
  for (const k of ['touch', 'conflict', 'pkg', 'ci']) assert.ok(LINK_KINDS.includes(k), k);
});

test('fleet: a builder attaches under the room naming it, an unclaimed one under __fleet', () => {
  const m = buildFleet({ topology: fleetTopo(), builders: two(), now: NOW });
  const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.equal(by['builder:builder-a'].parent, 'agents');
  assert.equal(by['builder:builder-a'].label, 'B1');
  assert.equal(by['builder:builder-b'].parent, '__fleet');
  assert.match(by['builder:builder-b'].sub, /not in topology/);
  assert.deepEqual([by.__fleet.kind, by.__fleet.parent, by.__fleet.label], ['site', '__core', 'FLEET']);
  assert.equal(by.agents.status, 'ok', 'a room with no feed takes its status from the builder link');
  assert.equal(by['lane:builder-a/payments'].parent, 'builder:builder-a');
  assert.deepEqual(m.fleet.builders.map((b) => [b.id, b.code, b.link]), [['builder-a', 'B1', 'up'], ['builder-b', 'BB', 'up']]);
  const one = buildFleet({ topology: fleetTopo(), builders: two().slice(0, 1), now: NOW });
  assert.ok(!one.nodes.some((n) => n.id === '__fleet'), '__fleet only when needed');
});

test('fleet: two builders with the same lane name give distinct lane:builder-a/x and lane:builder-b/x', () => {
  const m = buildFleet({ topology: null, builders: two(), now: NOW });
  const ids = m.nodes.filter((n) => n.label === 'payments' && n.kind === 'lane').map((n) => [n.id, n.builder, n.fkey]);
  assert.deepEqual(ids, [
    ['lane:builder-a/payments', 'builder-a', 'builder-a/payments'],
    ['lane:builder-b/payments', 'builder-b', 'builder-b/payments'],
  ]);
});

test('fleet: session nodes only for lanes with two or more live sessions, each with its fkey', () => {
  const nodes = fleetLaneNodes(snapshot, { builder: 'builder-a', parent: 'builder:builder-a', now: NOW });
  const sess = nodes.filter((n) => n.kind === 'session');
  assert.deepEqual(sess.map((n) => [n.id, n.parent, n.fkey, n.status]), [
    ['sess:builder-a/s2', 'lane:builder-a/docs', 'builder-a/s2', 'attention'],
    ['sess:builder-a/s3', 'lane:builder-a/docs', 'builder-a/s3', 'idle'],
  ]);
  assert.ok(!nodes.some((n) => n.parent === 'lane:builder-a/payments'), 'one live session: no children');
  // A dead session does not count.
  const dead = { ...snapshot, sessions: snapshot.sessions.map((s) => (s.name === 's3' ? { ...s, state: 'dead' } : s)) };
  assert.equal(fleetLaneNodes(dead, { builder: 'builder-a', parent: 'p', now: NOW }).filter((n) => n.kind === 'session').length, 0);
});

test('fleet: lanes carry flags and overlay measures', () => {
  const snap = {
    lanes: [{ id: 'pay', sessions: ['a', 'b'], reviewReady: { ready: true }, costUsd: 4.567 }],
    sessions: [
      { name: 'a', state: 'working', createdAt: NOW - 60_000, context: { usedPct: 61.4 }, cost: { usd: 1.1 }, stuck: { rule: 'tool-loop', reason: 'same tool 9x', since: NOW - 1 } },
      { name: 'b', state: 'idle', createdAt: NOW - 120_000, paused: { scope: 'session' }, awaitingApproval: 'ap-1' },
    ],
  };
  const facts = new Map([['builder-a/pay', { ci: 'fail', packages: ['acme-app/api'] }]]);
  const [lane, a, b] = fleetLaneNodes(snap, { builder: 'builder-a', parent: 'p', now: NOW, laneFacts: facts });
  assert.deepEqual(lane.flags, { stuck: { rule: 'tool-loop', reason: 'same tool 9x', since: NOW - 1 }, paused: true, awaitingApproval: 'ap-1', reviewReady: true });
  assert.deepEqual(lane.m, { costUsd: 4.57, ctxPct: 61, ageMs: 120_000, ci: 'fail' });
  assert.deepEqual(a.m, { costUsd: 1.1, ctxPct: 61 });
  assert.deepEqual(b.flags, { paused: true, awaitingApproval: 'ap-1' });
  const [plain] = fleetLaneNodes(snapshot, { builder: 'builder-a', parent: 'p', now: NOW });
  assert.equal(plain.flags, undefined, 'no flag set: no flags field');
});

test('fleet: link down -> builder down, its lanes keep their last status, one event for the builder only', () => {
  const t = fleetTopo();
  const up = buildFleet({ topology: t, builders: two(), now: NOW });
  // Same tick: the builder drops and its last snapshot had a lane change too.
  const changed = { ...snapshot, sessions: snapshot.sessions.map((s) => (s.name === 's1' ? { ...s, state: 'waiting_question' } : s)) };
  const downB = [{ ...two()[0], link: undefined, state: 'down', ageMs: 120_000, lastSeenMs: 120_000, snapshot: changed }, two()[1]];
  const down = buildFleet({ topology: t, builders: downB, now: NOW + 1000 });
  const by = Object.fromEntries(down.nodes.map((n) => [n.id, n]));
  assert.equal(by['builder:builder-a'].status, 'down');
  assert.equal(by['builder:builder-a'].why, 'no contact for 2m');
  assert.equal(by['builder:builder-a'].stale, true);
  assert.equal(by['lane:builder-a/docs'].status, 'attention', 'a lane keeps its last status');
  assert.equal(by['lane:builder-a/docs'].stale, true);
  assert.equal(by['lane:builder-a/docs'].ageMs, 120_000);
  assert.equal(by.agents.status, 'down', 'the room with no feed of its own follows the link');
  assert.equal(down.fleet.builders[0].link, 'down');
  const ev = diffEvents(up, down, NOW + 1000);
  assert.deepEqual(ev.map((e) => [e.node, e.text]), [['builder:builder-a', 'builder builder-a is down · no contact for 2m']]);
  // Stale is unknown, never a stale green.
  const stale = buildFleet({ topology: t, builders: [{ ...two()[0], link: 'stale', ageMs: 20_000 }], now: NOW });
  assert.equal(stale.nodes.find((n) => n.id === 'builder:builder-a').status, 'unknown');
});

test('fleet: lane events name the builder code when the fleet has more than one builder', () => {
  const a = buildFleet({ topology: null, builders: two(), now: NOW });
  const busy = two();
  busy[1].snapshot = bsnap(busy[1].snapshot.lanes, [{ name: 'x1', state: 'waiting_question' }]);
  const ev = diffEvents(a, buildFleet({ topology: null, builders: busy, now: NOW }), NOW);
  assert.deepEqual(ev.map((e) => e.text), ['BB payments needs you · asked a question']);
});

test('fleet: a room with a feed takes the worse of feed and link; metrics from fresh health, else the feed', () => {
  const t = parseTopology({ nodes: [{ id: 'hv', kind: 'site', feed: 'hv' }, { id: 'agents', parent: 'hv', kind: 'room', feed: 'hv/104', builder: 'builder-a' }] });
  const health = { at: NOW - 5000, cpu: { busyPct: 50 }, mem: { availPct: 25 }, fs: [{ mount: '/', usedPct: 30 }], swap: { totalMb: 100, usedMb: 10 }, alarms: [{ level: 'warn', text: 'swap in' }] };
  const m = buildFleet({ topology: t, feeds: feed(), builders: [{ id: 'builder-a', link: 'down', ageMs: 300_000, snapshot, health }], now: NOW });
  const room = m.nodes.find((n) => n.id === 'agents');
  assert.equal(room.status, 'down');
  assert.match(room.why, /builder-a no contact for 5m/);
  assert.deepEqual(room.metrics, { cpu: 0.5, mem: 0.75, disk: 0.3, swap: 0.1 }, 'fresh health beats the feed guest');
  const old = buildFleet({ topology: t, feeds: feed(), builders: [{ id: 'builder-a', link: 'up', snapshot, health: { ...health, at: NOW - 600_000 } }], now: NOW });
  const r2 = old.nodes.find((n) => n.id === 'agents');
  assert.equal(r2.status, 'ok');
  assert.deepEqual(r2.metrics, { cpu: 0.2, mem: 0.13 }, 'stale health falls back to the feed guest');
  const b2 = old.nodes.find((n) => n.id === 'builder:builder-a');
  assert.deepEqual(b2.metrics, { cpu: 0.25, mem: 0.5, disk: 0.4 }, 'builder node falls back to snapshot vitals');
  const b1 = buildFleet({ topology: t, feeds: feed(), builders: [{ id: 'builder-a', link: 'up', snapshot, health }], now: NOW }).nodes.find((n) => n.id === 'builder:builder-a');
  assert.deepEqual([b1.status, b1.why], ['warn', 'swap in'], 'an up builder shows its worst health alarm');
  assert.equal(healthMetrics(null, NOW), null);
});

test('fleet: with no builder field a feed guest named like the builder hosts it', () => {
  const t = parseTopology({ nodes: [{ id: 'hv', kind: 'site', feed: 'hv' }, { id: 'vm104', parent: 'hv', kind: 'room', feed: 'hv/104' }] });
  const f = feed({ guests: [{ vmid: 104, name: 'builder-a', status: 'running', cpu: 0.2, mem: 1, maxmem: 8 }] });
  const anchors = attachBuilders(t, [{ id: 'builder-a' }, { id: 'builder-b' }], { feeds: f });
  assert.deepEqual([...anchors], [['builder-a', 'vm104'], ['builder-b', '__fleet']]);
});

test('fleet: on a hub an unmatched `self` is a plain node (feed status only)', () => {
  const t = parseTopology({ self: 'hubroom', nodes: [{ id: 'hv', kind: 'site', feed: 'hv' }, { id: 'hubroom', parent: 'hv', kind: 'room', feed: 'hv/101' }] });
  const m = buildFleet({ topology: t, feeds: feed(), builders: [{ id: 'builder-a', link: 'down', snapshot }], now: NOW });
  const room = m.nodes.find((n) => n.id === 'hubroom');
  assert.equal(room.status, 'ok');
  assert.equal(room.hosts, undefined);
  assert.equal(m.nodes.find((n) => n.id === 'builder:builder-a').parent, '__fleet');
});

test('fleet: overlaps give one edge per pair, a confirmed conflict wins, severity carried, ids sorted', () => {
  const lanes = [
    { id: 'lane:builder-b/api', fkey: 'builder-b/api', builder: 'builder-b', label: 'api', status: 'idle' },
    { id: 'lane:builder-a/pay', fkey: 'builder-a/pay', builder: 'builder-a', label: 'pay', status: 'working' },
    { id: 'lane:builder-a/web', fkey: 'builder-a/web', builder: 'builder-a', label: 'web', status: 'idle' },
  ];
  const overlaps = normalizeOverlaps([
    { a: 'builder-b/api', b: 'builder-a/pay', kind: 'overlap', files: 3, repo: 'acme-app' },
    { a: 'builder-a/pay', b: 'builder-b/api', kind: 'textual', files: 1, repo: 'acme-app' },
    { a: 'builder-a/pay', b: 'main:acme-app', kind: 'textual', files: 2 },
    { a: 'builder-a/web', b: 'builder-a/pay', kind: 'overlap', files: 2, packages: ['acme-app/api'] },
    { a: 'builder-a/web', b: 'builder-a/pay', kind: 'predicted', files: 1 },
  ]);
  assert.equal(overlaps.length, 4, 'the main: edge has no lane on its far end');
  assert.deepEqual(overlaps.map((o) => o.kind), ['touch', 'conflict', 'touch', 'predicted']);
  const links = fleetLinks({ lanes, overlaps });
  assert.deepEqual(links.map((l) => [l.id, l.kind, l.severity, l.predicted]), [
    ['conflict:lane:builder-a/pay|lane:builder-a/web', 'conflict', 'warn', true],
    ['conflict:lane:builder-a/pay|lane:builder-b/api', 'conflict', 'crit', false],
  ]);
  assert.equal(links[1].from, 'lane:builder-a/pay');
  assert.equal(links[1].label, 'merge conflict · 1 file');
  const touch = fleetLinks({ lanes, overlaps: overlaps.filter((o) => o.kind === 'touch') });
  assert.deepEqual(touch.map((l) => [l.id, l.files, l.label]), [
    ['touch:lane:builder-a/pay|lane:builder-a/web', 2, '2 files · api'],
    ['touch:lane:builder-a/pay|lane:builder-b/api', 3, '3 files'],
  ]);
});

test('fleet: pkg links from laneFacts, live while working; ci links from topology ci.runner/for, "*" matches all', () => {
  const repos = [{ name: 'acme-app', packages: [{ name: 'api', ci: 'fail', why: 'CI api-test failed on main' }, { name: 'web', ci: 'pass' }] }];
  const laneFacts = new Map([
    ['builder-a/payments', { packages: ['acme-app/api', 'acme-app/web', 'acme-app/gone'] }],
    ['builder-a/docs', { packages: ['acme-app/web'] }],
  ]);
  const ciRuns = [{ runner: 'pool', builder: 'builder-b', branch: 'feat/pay-b', status: 'in_progress' }, { runner: 'ci', builder: 'builder-a', branch: 'nope', status: 'running' }];
  const m = buildFleet({ topology: fleetTopo(), feeds: feed(), builders: two(), repos, laneFacts, ciRuns, now: NOW });
  const pkg = m.links.filter((l) => l.kind === 'pkg').map((l) => [l.id, l.live]);
  assert.deepEqual(pkg, [
    ['pkg:lane:builder-a/payments>pkg:acme-app/api', true],
    ['pkg:lane:builder-a/payments>pkg:acme-app/web', true],
    ['pkg:lane:builder-a/docs>pkg:acme-app/web', false],
  ]);
  const ci = m.links.filter((l) => l.kind === 'ci').map((l) => [l.id, l.live]);
  assert.deepEqual(ci, [
    ['ci:builder:builder-a>ci', false],
    ['ci:builder:builder-a>pool', false],
    ['ci:builder:builder-b>pool', true],
  ]);
  const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.deepEqual([by.__repos.parent, by['repo:acme-app'].parent, by['pkg:acme-app/api'].parent], ['__core', '__repos', 'repo:acme-app']);
  assert.deepEqual([by['pkg:acme-app/api'].status, by['pkg:acme-app/api'].why, by['pkg:acme-app/api'].m], ['crit', 'CI api-test failed on main', { ci: 'fail' }]);
  assert.equal(by['pkg:acme-app/web'].status, 'ok');
  assert.ok(!m.nodes.some((n) => n.kind === 'lane' && ('packages' in n || 'branch' in n)), 'internal fields are dropped');
  assert.deepEqual(repoNodes([]), []);
  assert.deepEqual(repoNodes([{ name: '<bad>' }]), []);
});

test('fleet: parseTopology takes builder and ci fields and refuses laneboard ids and a builder claimed twice', () => {
  for (const id of ['builder:x', 'pkg:a/b', 'sess:x', 'repo:x', '__fleet']) {
    assert.throws(() => parseTopology({ nodes: [{ id }] }), /laneboard's own/, id);
  }
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', builder: 'b1' }, { id: 'b', builder: 'b1' }] }), /already claimed/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', builder: 'Bad Id' }] }), /builder must be/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', ci: { runner: true, for: 'b1' } }] }), /ci.for/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', ci: true }] }), /ci must be/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a', kind: 'builder' }] }), /kind must be/);
  assert.throws(() => parseTopology({ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ from: 'a', to: 'b', kind: 'conflict' }] }), /links\[0\]/);
  const t = parseTopology({ nodes: [{ id: 'a', builder: 'b1', ci: { runner: true, for: ['b2'] } }] });
  assert.equal(t.nodes[0].builder, 'b1');
});

test('fleet: the shape key changes when a link\'s severity or a node\'s flags change', () => {
  const base = { nodes: [{ id: 'lane:b1/x', status: 'working', flags: { paused: false } }], links: [{ id: 'conflict:a|b', live: false, severity: 'warn' }] };
  const k = shapeKey(base);
  assert.notEqual(shapeKey({ ...base, links: [{ ...base.links[0], severity: 'crit' }] }), k);
  assert.notEqual(shapeKey({ ...base, nodes: [{ ...base.nodes[0], flags: { paused: true } }] }), k);
  assert.equal(shapeKey(structuredClone(base)), k);
});

test('fleet: toMapFleet reads the hub fleet store view; tickFleet builds the hub model', () => {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }, { id: 'builder-b', url: 'https://b.example.invalid', code: 'XB' }] });
  store.applySnapshot('builder-a', { type: 'snapshot', seq: 1, sessions: [{ name: 's1', state: 'working' }], lanes: [{ id: 'pay', sessions: ['s1'] }], attention: [], generatedAt: NOW }, NOW);
  store.setConn('builder-a', { state: 'up', lastSeen: NOW, latencyMs: 12 });
  const f = toMapFleet(store.view(NOW + 2000));
  assert.deepEqual(f.builders.map((b) => [b.id, b.link, b.lastSeenMs, b.latencyMs]), [['builder-a', 'up', 2000, 12], ['builder-b', 'stale', undefined, undefined]]);
  assert.deepEqual(f.builders[0].snapshot.sessions.map((s) => s.name), ['s1']);
  assert.deepEqual(['up', 'stale', 'connecting', 'down', 'misconfigured', 'incompatible'].map(linkOf), ['up', 'stale', 'stale', 'down', 'down', 'down']);
  const msg = tickFleet({ ...f, edges: [] }, NOW + 2000);
  assert.equal(msg.type, 'map');
  const ids = msg.map.nodes.map((n) => n.id);
  for (const id of ['__fleet', 'builder:builder-a', 'builder:builder-b', 'lane:builder-a/pay']) assert.ok(ids.includes(id), id);
  assert.equal(msg.map.nodes.find((n) => n.id === 'builder:builder-a').detail.Latency, '12 ms');
  assert.equal(msg.map.nodes.find((n) => n.id === 'builder:builder-b').label, 'XB');
  assert.equal(tickFleet(f, NOW + 3000), null, 'nothing changed: nothing to send');
  assert.ok(tickFleet(store.view(NOW + 20_000), NOW + 20_000), 'a raw view is accepted, and a builder going stale is news');
  assert.equal(model().nodes.find((n) => n.id === 'builder:builder-a').status, 'unknown');
});

test('fleet: a builder a hub watches does not read feeds', () => {
  assert.equal(feedsEnabled({ fleet: { hubKeys: [] } }), true);
  assert.equal(feedsEnabled({ fleet: { hubKeys: ['ed25519:AAAA'] } }), false);
  assert.equal(build({ topology: null, snapshot, builderId: 'builder-a', feedsOff: true, now: NOW }).feeds, false);
  assert.equal(build({ topology: null, snapshot, builderId: 'builder-a', now: NOW }).feeds, undefined);
});

test('fleet: server/map.mjs imports no builder-only module (the hub loads it)', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'server', 'map.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((x) => x[1]).sort();
  assert.deepEqual(imports, ['./config.mjs', './fleet/keys.mjs', './log.mjs', 'node:fs', 'node:path']);
});

// 6 builders x 20 lanes x 3 sessions, the HUMAN perf check's input (?mapperf=1).
function bigFleet() {
  const builders = [];
  for (let b = 0; b < 6; b++) {
    const id = `builder-${String.fromCharCode(97 + b)}`;
    const lanes = [];
    const sessions = [];
    for (let l = 0; l < 20; l++) {
      const names = [0, 1, 2].map((s) => `l${l}-s${s}`);
      lanes.push({ id: `lane-${l}`, branch: `feat/lane-${l}`, sessions: names });
      const states = ['working', 'idle', 'waiting_question', 'done'];
      names.forEach((name, s) => sessions.push({
        name, state: states[(l + s + b) % states.length], stateSince: NOW - 60_000 * (s + 1), createdAt: NOW - 3_600_000 * (l % 5 + 1),
        context: { usedPct: (l * 7 + s * 13) % 100 }, cost: { usd: Math.round((l + s + b) * 37) / 100 },
        activity: { tool: 'Edit', toolInput: { file_path: `/w/src/mod-${l}.ts` } },
      }));
    }
    builders.push({ id, link: b === 5 ? 'down' : b === 4 ? 'stale' : 'up', ageMs: b >= 4 ? 90_000 : 0, snapshot: { lanes, sessions, vitals: { cpuPct: 10 * b, mem: { totalMb: 1000, usedMb: 100 * b }, disk: { usedPct: 20 } } } });
  }
  const repos = [0, 1, 2].map((r) => ({ name: `acme-${r}`, packages: Array.from({ length: 10 }, (_, p) => ({ name: `pkg-${p}`, ci: ['pass', 'fail', 'running', 'none'][(r + p) % 4] })) }));
  const laneFacts = new Map();
  const overlaps = [];
  for (const b of builders) {
    for (let l = 0; l < 20; l++) {
      laneFacts.set(`${b.id}/lane-${l}`, { packages: [`acme-${l % 3}/pkg-${l % 10}`, `acme-${(l + 1) % 3}/pkg-${(l * 3) % 10}`], ci: l % 4 ? 'pass' : 'fail' });
      if (l % 3 === 0) overlaps.push({ a: `${b.id}/lane-${l}`, b: `${builders[(builders.indexOf(b) + 1) % 6].id}/lane-${l}`, kind: ['touch', 'predicted', 'conflict'][l % 3 === 0 ? (l / 3) % 3 : 0], files: l % 5 + 1 });
    }
  }
  const topology = parseTopology({
    title: 'fleet',
    nodes: [
      { id: 'site-1', kind: 'site' }, { id: 'site-2', kind: 'site' },
      ...builders.slice(0, 4).map((b, i) => ({ id: `room-${i}`, parent: i < 2 ? 'site-1' : 'site-2', kind: 'room', builder: b.id })),
      { id: 'runners', parent: 'site-2', kind: 'room', ci: { runner: true, for: '*' } },
    ],
  });
  return { topology, builders, repos, laneFacts, overlaps, now: NOW, hostname: 'hub' };
}

test('fleet: the 6x20x3 fixture matches buildFleet and stays within the size budget', () => {
  const file = path.join(import.meta.dirname, 'fixtures', 'fleet-map.json');
  const m = buildFleet(bigFleet());
  const json = `${JSON.stringify({ ...m, events: [] })}\n`;
  if (process.env.UPDATE_FIXTURES === '1') fs.writeFileSync(file, json);
  assert.equal(fs.readFileSync(file, 'utf8'), json, 'test/fixtures/fleet-map.json is stale: rerun with UPDATE_FIXTURES=1');
  assert.equal(m.nodes.filter((n) => n.kind === 'builder').length, 6);
  assert.equal(m.nodes.filter((n) => n.kind === 'lane').length, 120);
  assert.ok(m.nodes.length <= 600, `${m.nodes.length} nodes`);
  const bytes = Buffer.byteLength(JSON.stringify(m));
  assert.ok(bytes < 170 * 1024, `model is ${bytes} bytes`);
  // Deterministic: same input, same model.
  assert.deepEqual(buildFleet(bigFleet()), m);
});

test('GET /api/map on a builder with no topology is __core -> __fleet -> builder:<id>', async () => {
  const b = await boot({ config: { fleet: { id: 'builder-a' } } });
  try {
    let m;
    for (let i = 0; i < 50; i++) {
      m = await (await fetch(`${b.url}/api/map`)).json();
      if (m.nodes.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    assert.equal(by.__core.kind, 'core');
    assert.equal(by.__fleet.parent, '__core');
    assert.equal(by['builder:builder-a'].parent, '__fleet');
    assert.ok(m.nodes.filter((n) => n.kind === 'lane').every((n) => n.id.startsWith('lane:builder-a/') && n.parent === 'builder:builder-a'));
  } finally {
    await b.stop();
  }
});
