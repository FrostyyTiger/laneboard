// T11: Reach, server side (docs/map.md "Reach"). An invented policy file for
// the tailnet `acme` and the T4/T5 fixtures through the real feeders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFleet, parseTopology } from '../server/map.mjs';
import { parseHujson, stripComments } from '../server/map/hujson.mjs';
import { parsePolicy, loadPolicy, reachLinks, parseAddr, contains, resolveSelector } from '../server/map/reach.mjs';
import { defaults, fromEnv } from '../server/config.mjs';
import * as tailscale from '../server/feeders/tailscale.mjs';
import * as proxmox from '../server/feeders/proxmox.mjs';

const NOW = 1_800_000_000_000;
const FIXTURES = new URL('./fixtures/feeds/', import.meta.url);
const POLICY_FILE = new URL('policy.hujson', FIXTURES).pathname;
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(name, FIXTURES), 'utf8'));
const tsFeed = () => tailscale.toFeed(fixture('tailscale-status.json'), { source: 'tailscale', now: NOW });
const pveFeed = () => proxmox.toFeed(fixture('pve-resources.json'), { source: 'proxmox', now: NOW });
const feeds = (...list) => new Map(list.map((f) => [f.source, f]));
const policy = () => loadPolicy(POLICY_FILE).value;
const pairs = (r) => r.links.map((l) => [l.from, l.to, l.label]);

test('HuJSON: comments and trailing commas go, strings keep theirs', () => {
  assert.deepEqual(parseHujson('{"a": [1, 2,], // x\n /* y */ "b": "//not /* a */ comment",}'), { a: [1, 2], b: '//not /* a */ comment' });
  assert.deepEqual(parseHujson('{"q": "say \\"hi\\" // still a string",}'), { q: 'say "hi" // still a string' });
  // A comma before a commented-out last item is trailing too.
  assert.deepEqual(parseHujson('[1,\n // 2\n]'), [1]);
  assert.equal(stripComments('a/*x\ny*/b').split('\n').length, 2, 'newlines are kept for positions');
  assert.throws(() => parseHujson('{a: 1}'), SyntaxError, 'unquoted keys stay invalid');
  assert.throws(() => parseHujson('{"a": 1 /* open'), SyntaxError);
  const doc = parseHujson(fs.readFileSync(POLICY_FILE, 'utf8'));
  assert.ok(doc.note.includes('//b /* a string'), 'the fixture string survives');
});

test('addresses: IPv4, IPv6 and CIDR containment', () => {
  assert.ok(contains(parseAddr('192.0.2.0/24'), parseAddr('192.0.2.13')));
  assert.ok(!contains(parseAddr('192.0.2.0/25'), parseAddr('192.0.2.200')));
  assert.ok(contains(parseAddr('2001:db8::/32'), parseAddr('2001:db8::11')));
  assert.ok(!contains(parseAddr('2001:db8::/32'), parseAddr('192.0.2.1')), 'families never mix');
  assert.ok(contains(parseAddr('0.0.0.0/0'), parseAddr('198.51.100.7')));
  for (const bad of ['192.0.2.256', '192.0.2.1/33', 'tag:x', '2001:db8:::1', '1::2::3', 'lab-net']) assert.equal(parseAddr(bad), null, bad);
});

test('parsePolicy: grants with ip, acls split on the last colon, the rest ignored', () => {
  const p = parsePolicy(parseHujson(fs.readFileSync(POLICY_FILE, 'utf8')));
  assert.equal(p.rules.length, 5, 'four network grants and one acl');
  assert.equal(p.skipped, 1, 'the app-only grant gives no network access');
  const acl = p.rules.at(-1);
  assert.deepEqual(acl.dst, [{ sel: 'tag:builder', ports: ['tcp:22', 'tcp:2222'] }, { sel: 'lab-net', ports: ['tcp:*'] }]);
  const v6 = parsePolicy({ acls: [{ action: 'accept', users: ['*'], ports: ['2001:db8::/32:443'] }] });
  assert.deepEqual(v6.rules[0], { src: ['*'], dst: [{ sel: '2001:db8::/32', ports: ['443'] }] }, 'deprecated users/ports, IPv6 CIDR');
  assert.throws(() => parsePolicy([]), TypeError);
});

test('the fixture policy over the tailnet feed: the expected links', () => {
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'demo-host', policy: policy() });
  const hub = 'feed:tailscale';
  const b = 'feed:tailscale/builder-a';
  const lap = 'feed:tailscale/laptop-1';
  const hv = 'feed:tailscale/hv1';
  assert.deepEqual(pairs(m.reach).sort(), [
    [b, hub, 'tcp:443, tcp:8787'], // tag:builder -> tag:hub
    [lap, hub, 'all ports'], // autogroup:member -> *
    [lap, b, 'all ports'],
    [lap, hv, 'all ports'],
    [hub, b, 'tcp:22, tcp:2222'], // acl from the hub's address
    [hub, hv, 'tcp:8006'], // by host alias
  ].sort());
  for (const l of m.reach.links) {
    assert.equal(l.kind, 'reach');
    assert.equal(l.id, `reach:${l.from}>${l.to}`);
  }
  assert.equal(m.reach.rules, 5);
  // Not guessed: the group needs node owners; the range names no node.
  assert.deepEqual(m.reach.unresolved.map((u) => u.selector), ['group:admins', 'lab-net']);
  assert.match(m.reach.unresolved[0].why, /owns/);
  assert.equal(m.reach.unresolved[1].why, 'no node matches');
  // Reach stays out of the drawn links: only its overlay shows it (T12).
  assert.ok(!m.links.some((l) => l.kind === 'reach'));
});

test('the machine the core is named after reaches as the core', () => {
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'hub', policy: policy() });
  assert.ok(m.reach.links.some((l) => l.from === 'feed:tailscale/builder-a' && l.to === '__core'));
  assert.ok(m.reach.links.every((l) => m.nodes.some((n) => n.id === l.from) && m.nodes.some((n) => n.id === l.to)));
});

test('a machine named by two feeds takes its tailnet identity from the other one', () => {
  // hv1 is the PVE host (site feed:proxmox) and a tailnet peer: one node.
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed(), pveFeed()), now: NOW, hostname: 'demo-host', policy: policy() });
  const hv = m.nodes.filter((n) => n.label === 'hv1');
  assert.equal(hv.length, 1);
  assert.ok(m.reach.links.some((l) => l.from === 'feed:tailscale' && l.to === hv[0].id && l.label === 'tcp:8006'));
  // PVE guests are not on the tailnet: no `*` reaches them.
  assert.ok(!m.reach.links.some((l) => l.to.startsWith('feed:proxmox/')));
});

test('a declared node gets the links of the machine it claims', () => {
  const topology = parseTopology({ nodes: [{ id: 'home', kind: 'site' }, { id: 'ci', kind: 'room', parent: 'home', label: 'builder-a' }] });
  const m = buildFleet({ topology, feeds: feeds(tsFeed()), now: NOW, hostname: 'h', policy: policy() });
  assert.ok(m.reach.links.some((l) => l.from === 'ci' && l.to === 'feed:tailscale'));
});

test('no map.policyFile: no reach in the model', () => {
  assert.equal(defaults().map.policyFile, null);
  assert.deepEqual(loadPolicy(null), { file: null, value: null, error: null });
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'h' });
  assert.equal(m.reach, undefined);
  assert.ok(!m.links.some((l) => l.kind === 'reach'));
  assert.equal(fromEnv({ LANEBOARD_MAP_POLICY: '/srv/policy.hujson' }).map.policyFile, '/srv/policy.hujson');
});

test('a policy file that breaks keeps the last good one and says why', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-reach-'));
  const file = path.join(dir, 'policy.hujson');
  try {
    fs.writeFileSync(file, '{"grants": [{"src": ["*"], "dst": ["*"], "ip": ["*"]},]}');
    assert.equal(loadPolicy(file).value.rules.length, 1);
    fs.writeFileSync(file, '{"grants": [');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(file, t, t);
    const bad = loadPolicy(file);
    assert.equal(bad.value.rules.length, 1, 'last good policy kept');
    assert.match(bad.error, /policy file rejected/);
    const m = buildFleet({ topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'h', policy: bad.value, policyError: bad.error });
    assert.match(m.reach.error, /rejected/);
    assert.ok(m.reach.links.length > 0);
    fs.rmSync(file);
    const gone = loadPolicy(file);
    assert.equal(gone.value, null);
    assert.equal(gone.error, 'policy file not found');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selectors: what needs user data is unresolved, not guessed', () => {
  const nodes = new Map([
    ['a', { tags: new Set(['tag:x']), ips: [parseAddr('192.0.2.1')] }],
    ['b', { tags: new Set(), ips: [parseAddr('192.0.2.2')] }],
  ]);
  const p = { hosts: { box: '192.0.2.2', odd: 'not-an-ip' }, ipsets: { 'ipset:lab': ['192.0.2.0/30', 'tag:x'] }, groups: {} };
  const ids = (sel) => [...(resolveSelector(sel, p, nodes).ids ?? [])].sort();
  assert.deepEqual(ids('*'), ['a', 'b']);
  assert.deepEqual(ids('autogroup:tagged'), ['a']);
  assert.deepEqual(ids('autogroup:member'), ['b']);
  assert.deepEqual(ids('box'), ['b']);
  assert.deepEqual(ids('ipset:lab'), ['a', 'b']);
  for (const sel of ['group:eng', 'alice@example.invalid', 'autogroup:self', 'autogroup:admin', 'autogroup:internet', 'svc:db', 'odd', 'whatever']) {
    assert.ok(resolveSelector(sel, p, nodes).why, sel);
  }
  // A node that is not on the tailnet is never a source or a target.
  const r = reachLinks({ rules: [{ src: ['*'], dst: [{ sel: '*', ports: ['*'] }] }], ...p }, new Map([...nodes, ['c', { tags: new Set(), ips: [] }]]));
  assert.deepEqual(pairs(r), [['a', 'b', 'all ports'], ['b', 'a', 'all ports']]);
});
