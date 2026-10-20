// T8: discovered and declared nodes merge by name (docs/map.md "Discovered
// nodes"). Feeds come from the T4/T5 fixtures through the real feeders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFleet, withDiscovered, parseTopology } from '../server/map.mjs';
import * as tailscale from '../server/feeders/tailscale.mjs';
import * as proxmox from '../server/feeders/proxmox.mjs';

const NOW = 1_800_000_000_000;
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/feeds/${name}`, import.meta.url), 'utf8'));

const tsFeed = () => tailscale.toFeed(fixture('tailscale-status.json'), { source: 'tailscale', now: NOW });
const pveFeed = () => proxmox.toFeed(fixture('pve-resources.json'), { source: 'proxmox', now: NOW });
const feeds = (...list) => new Map(list.map((f) => [f.source, f]));
const byLabel = (m, label) => m.nodes.filter((n) => n.label?.toLowerCase() === label.toLowerCase());

test('no topology: the Map is drawn from feeds alone, core named as today', () => {
  const m = buildFleet({ topology: null, feeds: feeds(pveFeed()), now: NOW, hostname: 'demo-host' });
  assert.equal(m.title, 'demo-host');
  const core = m.nodes.find((n) => n.kind === 'core');
  assert.equal(core.label, 'demo-host');
  const site = m.nodes.find((n) => n.id === 'feed:proxmox');
  assert.equal(site.kind, 'site');
  assert.equal(site.label, 'hv1');
  assert.equal(site.parent, '__core');
  assert.equal(site.discovered, true);
  const web = m.nodes.find((n) => n.id === 'feed:proxmox/101');
  assert.deepEqual([web.kind, web.label, web.parent, web.status, web.discovered], ['room', 'web', 'feed:proxmox', 'ok', true]);
  assert.equal(m.nodes.find((n) => n.label === 'old-app').status, 'down');
  // A template is stopped by design: idle, not trouble.
  assert.equal(m.nodes.find((n) => n.label === 'debian-tmpl').status, 'idle');
  const rooms = m.nodes.filter((n) => n.discovered && n.kind === 'room');
  assert.equal(rooms.length, 9);
});

test('a declared node claims its machine by feed ref or by name and takes its live data', () => {
  const topology = parseTopology({
    nodes: [
      { id: 'home', kind: 'site', label: 'Home' },
      { id: 'hv', kind: 'host', parent: 'home', label: 'HV1' }, // by name, no feed ref
      { id: 'front', kind: 'room', parent: 'hv', feed: 'proxmox/101' }, // by ref
      { id: 'db', kind: 'room', parent: 'hv' }, // by id
    ],
  });
  const m = buildFleet({ topology, feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  const hv = m.nodes.find((n) => n.id === 'hv');
  assert.equal(hv.discovered, undefined);
  assert.ok(hv.sub.includes('guests running'), 'the host takes the feed host line');
  assert.equal(m.nodes.find((n) => n.id === 'db').status, 'ok');
  assert.ok(m.nodes.find((n) => n.id === 'db').metrics);
  // Nothing claimed is drawn twice; the rest hang under the declared host.
  assert.equal(byLabel(m, 'hv1').length, 1);
  assert.equal(byLabel(m, 'web').length, 0, 'the ref claims web; the node keeps its own label');
  assert.equal(byLabel(m, 'db').length, 1);
  assert.equal(m.nodes.find((n) => n.id === 'feed:proxmox'), undefined);
  const proxy = m.nodes.find((n) => n.label === 'proxy');
  assert.deepEqual([proxy.parent, proxy.discovered], ['hv', true]);
  assert.equal(m.nodes.filter((n) => n.discovered).length, 7);
});

test('one machine named by both feeders is one node, with what each knows', () => {
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed(), pveFeed()), now: NOW, hostname: 'h' });
  // The tailnet peer hv1 is the PVE host hv1.
  const hv1 = byLabel(m, 'hv1');
  assert.equal(hv1.length, 1);
  assert.equal(hv1[0].id, 'feed:proxmox');
  assert.equal(hv1[0].detail['Seen by'], 'proxmox, tailscale');
  assert.ok(hv1[0].detail.IPs, 'the tailnet adds its addresses');
  // The tailnet's own self is a site; its other peers hang under it.
  const ts = m.nodes.find((n) => n.id === 'feed:tailscale');
  assert.equal(ts.label, 'hub');
  assert.equal(m.nodes.find((n) => n.label === 'builder-a').parent, 'feed:tailscale');
  assert.equal(m.nodes.find((n) => n.label === 'laptop-1').status, 'down');
  // The shared-in node is not ours.
  assert.equal(byLabel(m, 'shared-box').length, 0);
  // Every id is unique.
  assert.equal(new Set(m.nodes.map((n) => n.id)).size, m.nodes.length);
});

test('a tailnet peer that is also a PVE guest is one room, the hypervisor view leading', () => {
  const ts = tsFeed();
  ts.guests.push({ name: 'web', type: 'tailnet', status: 'running', detail: { IPs: '192.0.2.10' } });
  const m = buildFleet({ topology: null, feeds: feeds(ts, pveFeed()), now: NOW, hostname: 'h' });
  const web = byLabel(m, 'web');
  assert.equal(web.length, 1);
  assert.deepEqual([web[0].id, web[0].parent], ['feed:proxmox/101', 'feed:proxmox']);
  assert.equal(web[0].detail.IPs, '192.0.2.10');
  assert.ok(web[0].metrics, 'metrics from the hypervisor');
});

test('a feed naming the core machine hangs its guests on the core, not a second core', () => {
  const m = buildFleet({ topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'hub' });
  assert.equal(m.nodes.find((n) => n.id === 'feed:tailscale'), undefined);
  assert.equal(byLabel(m, 'hub').length, 1);
  assert.equal(m.nodes.find((n) => n.label === 'builder-a').parent, '__core');
});

test('a builder attaches under the discovered room named like it', () => {
  const m = buildFleet({
    topology: null, feeds: feeds(tsFeed()), now: NOW, hostname: 'h',
    builders: [{ id: 'builder-a', link: 'up', snapshot: { lanes: [], sessions: [] } }],
  });
  const room = m.nodes.find((n) => n.label === 'builder-a' && n.kind === 'room');
  assert.equal(m.nodes.find((n) => n.id === 'builder:builder-a').parent, room.id);
  assert.equal(m.nodes.find((n) => n.id === '__fleet'), undefined);
});

test('no feeds: the topology is unchanged; feed: ids are laneboard\'s own', () => {
  const t = parseTopology({ nodes: [{ id: 'a' }] });
  assert.equal(withDiscovered(t, new Map()), t);
  assert.throws(() => parseTopology({ nodes: [{ id: 'feed:x' }] }), /laneboard's own/);
});
