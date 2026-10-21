// T9: drift, server side (docs/map.md "Drift"). A declared node whose fresh
// feed does not list it is `missing`; a node only a fresh feed knows is
// `undeclared`. No topology file or a stale feed marks nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFleet, parseTopology, driftOf } from '../server/map.mjs';
import * as proxmox from '../server/feeders/proxmox.mjs';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/feeds/${name}`, import.meta.url), 'utf8'));
const pveFeed = () => proxmox.toFeed(fixture('pve-resources.json'), { source: 'proxmox', now: NOW });
const feeds = (...list) => new Map(list.map((f) => [f.source, f]));
const drifted = (m) => Object.fromEntries(m.nodes.filter((n) => n.drift).map((n) => [n.id, n.drift]));

const topology = () => parseTopology({
  nodes: [
    { id: 'hv', kind: 'host', label: 'hv1', feed: 'proxmox' },
    { id: 'front', kind: 'room', parent: 'hv', feed: 'proxmox/101' },
    { id: 'db', kind: 'room', parent: 'hv' }, // claimed by name
    { id: 'gone', kind: 'room', parent: 'hv', feed: 'proxmox/199' }, // not in the feed
    { id: 'mail', kind: 'room', parent: 'hv', feed: 'proxmox/mail' }, // not in the feed
    { id: 'svc', kind: 'service', parent: 'front', feed: 'proxmox/101/nope' }, // services are not drift
    { id: 'nas', kind: 'host', feed: 'backups' }, // no feed from that source: no data
    { id: 'plain', kind: 'room', parent: 'hv' }, // no feed at all
  ],
});

test('missing: a declared guest its fresh feed does not list', () => {
  const m = buildFleet({ topology: topology(), feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  const d = drifted(m);
  assert.equal(d.gone, 'missing');
  assert.equal(d.mail, 'missing');
  for (const id of ['hv', 'front', 'db', 'svc', 'nas', 'plain']) assert.equal(d[id], undefined, id);
  // The status line stays what it was: drift is a mark, not a status.
  assert.equal(m.nodes.find((n) => n.id === 'gone').status, 'unknown');
});

test('undeclared: every discovered node of a fresh feed, and only those', () => {
  const m = buildFleet({ topology: topology(), feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  const undeclared = m.nodes.filter((n) => n.drift === 'undeclared');
  assert.ok(undeclared.length > 0);
  assert.deepEqual(undeclared.map((n) => n.id), m.nodes.filter((n) => n.discovered).map((n) => n.id));
  assert.equal(m.nodes.find((n) => n.label === 'proxy').drift, 'undeclared');
});

test('no topology file: nothing is declared, so nothing drifts', () => {
  const m = buildFleet({ topology: null, feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  assert.ok(m.nodes.some((n) => n.discovered));
  assert.deepEqual(drifted(m), {});
});

test('a stale feed marks nothing: no data is not drift', () => {
  const m = buildFleet({ topology: topology(), feeds: feeds(pveFeed()), now: NOW + DAY, hostname: 'h' });
  assert.deepEqual(drifted(m), {});
  assert.equal(driftOf({ feed: 'proxmox/199' }, feeds(pveFeed()), NOW + DAY), undefined);
  assert.equal(driftOf({ feed: 'proxmox/199' }, feeds(pveFeed()), NOW), 'missing');
});

test('drift changes no node count, and expect: "stopped" stays as today', () => {
  const t = parseTopology({
    nodes: [
      { id: 'hv', kind: 'host', label: 'hv1', feed: 'proxmox' },
      { id: 'old', kind: 'room', parent: 'hv', feed: 'proxmox/105', expect: 'stopped' },
    ],
  });
  const fresh = buildFleet({ topology: t, feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  const stale = buildFleet({ topology: t, feeds: feeds(pveFeed()), now: NOW + DAY, hostname: 'h' });
  const bare = buildFleet({ topology: null, feeds: feeds(pveFeed()), now: NOW, hostname: 'h' });
  assert.equal(fresh.nodes.length, stale.nodes.length);
  assert.equal(fresh.links.length, stale.links.length);
  assert.equal(bare.nodes.filter((n) => n.discovered).length, fresh.nodes.filter((n) => n.discovered).length + 2, 'hv1 and 105 are declared');
  const old = fresh.nodes.find((n) => n.id === 'old');
  assert.deepEqual([old.status, old.drift], ['idle', undefined]);
});
