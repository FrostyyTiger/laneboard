// The Map's model: topology validation and the merge of feeds, probes and
// lanes into node statuses. All pure — no feed on disk, no network, no tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTopology, TopologyError, fromFeed, feedRef, build, laneNodes, diffEvents, feedEvents, probeOnce,
} from '../server/map.mjs';

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
  assert.deepEqual(feedRef('hv'), { source: 'hv', guest: null });
  assert.deepEqual(feedRef('hv/101'), { source: 'hv', guest: '101' });
  assert.deepEqual(feedRef({ source: 'hv', guest: 7 }), { source: 'hv', guest: '7' });
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
  const lanes = laneNodes(snapshot, { parent: 'agents', now: NOW });
  assert.deepEqual(lanes.map((l) => l.id), ['lane:payments', 'lane:docs']);
  const [pay, docs] = lanes;
  assert.equal(pay.status, 'working');
  assert.equal(pay.sub, 'Edit api/charge.ts');
  assert.equal(docs.status, 'attention');
  assert.equal(docs.why, 'waiting on a permission prompt · 12m');
  assert.equal(laneNodes(snapshot, { parent: 'x', show: 'all' }).length, 3);
  assert.equal(laneNodes(snapshot, { parent: 'x', show: 'none' }).length, 0);
});

test('lanes hang under `self`, which carries this host\'s vitals, and link by rule', () => {
  const m = build({ topology: topo(), feeds: feed(), snapshot, now: NOW });
  const agents = m.nodes.find((n) => n.id === 'agents');
  assert.deepEqual(agents.metrics, { cpu: 0.25, mem: 0.5, disk: 0.4 });
  const pay = m.nodes.find((n) => n.id === 'lane:payments');
  assert.equal(pay.parent, 'agents');
  const rule = m.links.find((l) => l.from === 'lane:payments');
  assert.equal(rule.to, 'api');
  assert.equal(rule.live, true, 'a working lane\'s links are live');
  assert.ok(!m.links.some((l) => l.from === 'lane:docs'));
});

test('with no topology the map is this host and its lanes', () => {
  const m = build({ topology: null, snapshot, hostname: 'box', now: NOW });
  assert.equal(m.title, 'box');
  assert.deepEqual(m.nodes.map((n) => n.id), ['__core', 'lane:payments', 'lane:docs']);
  assert.ok(m.nodes.slice(1).every((n) => n.parent === '__core'));
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
