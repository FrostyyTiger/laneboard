// Feeders (runs plan §4 B1, task T4): the `tailscale` feeder maps a recorded
// `tailscale status --json` (invented tailnet `acme`, documentation addresses)
// into the feed format; `read` never throws; the `none` feeder gives an
// empty feed that says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as tailscale from '../server/feeders/tailscale.mjs';
import * as none from '../server/feeders/none.mjs';
import { TABLE, feeder, feederNames, collect } from '../server/feeders/index.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/feeds/tailscale-status.json', import.meta.url));
const status = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const NOW = Date.UTC(2026, 9, 20, 21, 0, 0);

test('the recorded status maps into one feed: self is the host, peers are tailnet guests', () => {
  const feed = tailscale.toFeed(status(), { source: 'tailnet', now: NOW });
  assert.equal(feed.source, 'tailnet');
  assert.equal(feed.at, NOW);
  assert.equal(feed.every, 60);
  assert.deepEqual(feed.events, []);
  assert.deepEqual(feed.host, {
    name: 'hub',
    os: 'linux',
    tags: ['tag:hub'],
    ips: ['192.0.2.10', '2001:db8::10'],
    sub: 'tailnet · 2/3 peers online',
    detail: { OS: 'linux', IPs: '192.0.2.10, 2001:db8::10', Tags: 'tag:hub' },
    alerts: [],
  });
  // Sorted by name; the shared-in node is left out.
  assert.deepEqual(feed.guests.map((g) => g.name), ['builder-a', 'hv1', 'laptop-1']);
  assert.deepEqual(feed.guests[0], {
    name: 'builder-a',
    type: 'tailnet',
    status: 'running',
    tags: ['tag:builder', 'tag:ci'],
    ips: ['192.0.2.11', '2001:db8::11'],
    os: 'linux',
    detail: { OS: 'linux', IPs: '192.0.2.11, 2001:db8::11', Tags: 'tag:builder, tag:ci' },
    alerts: [],
  });
});

test('an offline peer is stopped and carries its last-seen time', () => {
  const g = tailscale.toFeed(status(), { now: NOW }).guests.find((x) => x.name === 'laptop-1');
  assert.equal(g.status, 'stopped');
  assert.equal(g.lastSeen, Date.UTC(2026, 9, 20, 18, 30, 0));
  assert.equal(g.detail['Last seen'], '2026-10-20T18:30:00Z');
  assert.equal(g.os, 'macOS');
});

test('a peer with no tags has an empty tag list and no Tags line', () => {
  const g = tailscale.toFeed(status(), { now: NOW }).guests.find((x) => x.name === 'laptop-1');
  assert.deepEqual(g.tags, []);
  assert.equal('Tags' in g.detail, false);
});

test('the MagicDNS label names a node, not HostName; routes, exit node and an expired key show', () => {
  const feed = tailscale.toFeed(status(), { now: NOW });
  // HostName "Laptop" was de-duplicated to "laptop-1" by MagicDNS.
  assert.ok(feed.guests.some((g) => g.name === 'laptop-1'));
  const hv1 = feed.guests.find((g) => g.name === 'hv1');
  assert.equal(hv1.detail.Routes, '10.0.0.0/24');
  assert.equal(hv1.detail['Exit node'], 'offered');
  assert.deepEqual(hv1.alerts, [{ level: 'warn', text: 'node key expired' }]);
  assert.equal('lastSeen' in hv1, false, 'online peers carry the zero time, which is no value');
});

test('nothing secret or personal reaches the feed', () => {
  const text = JSON.stringify(tailscale.toFeed(status(), { now: NOW }));
  for (const word of ['nodekey:', 'ssh-ed25519', 'LoginName', 'owner@', 'friend@', 'shared-box', 'nPEER']) {
    assert.equal(text.includes(word), false, word);
  }
});

test('missing pieces are unknown, never a throw', () => {
  const feed = tailscale.toFeed({}, { now: NOW });
  assert.deepEqual(feed.guests, []);
  assert.equal(feed.host.sub, 'tailnet · 0/0 peers online');
  const one = tailscale.toFeed({ Self: { HostName: 'Solo' }, Peer: { k: { HostName: 'X', Tags: null }, j: null } }, { now: NOW });
  assert.equal(one.host.name, 'solo');
  assert.deepEqual(one.guests, [{ name: 'x', type: 'tailnet', status: 'stopped', tags: [], ips: [], alerts: [] }]);
  assert.equal(tailscale.lastSeenMs('0001-01-01T00:00:00Z'), null);
  assert.equal(tailscale.lastSeenMs('nonsense'), null);
  assert.equal(tailscale.lastSeenMs(undefined), null);
});

test('health problems become host alerts', () => {
  const s = status();
  s.Health = ['not connected to home DERP region'];
  assert.deepEqual(tailscale.toFeed(s, { now: NOW }).host.alerts, [{ level: 'warn', text: 'not connected to home DERP region' }]);
});

const fakeRun = (result) => {
  const calls = [];
  const impl = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { ok: true, stdout: '', stderr: '', code: 0, signal: null, ...result }; };
  return { calls, impl };
};

test('read runs `tailscale status --json` with a timeout and returns the parsed status', async () => {
  const { calls, impl } = fakeRun({ stdout: fs.readFileSync(FIXTURE, 'utf8') });
  const r = await tailscale.read({ runImpl: impl, timeoutMs: 4000 });
  assert.equal(r.ok, true);
  assert.equal(r.input.Self.HostName, 'hub');
  assert.deepEqual(calls.map((c) => [c.cmd, c.args, c.opts.timeout]), [['tailscale', ['status', '--json'], 4000]]);
});

test('read: a missing binary, a failure, a timeout, junk and a stopped daemon are {ok:false}', async () => {
  const cases = [
    [{ ok: false, code: 'ENOENT' }, /tailscale not found/],
    [{ ok: false, code: 1, stderr: 'failed to connect to local tailscaled\nmore' }, /failed: failed to connect to local tailscaled$/],
    [{ ok: false, code: null, signal: 'SIGTERM' }, /timed out after 10s/],
    [{ stdout: 'not json' }, /did not print JSON/],
    [{ stdout: JSON.stringify({ BackendState: 'Stopped', Self: { HostName: 'hub' } }) }, /tailscale is Stopped/],
    [{ stdout: JSON.stringify({ BackendState: 'NeedsLogin', Self: null }) }, /tailscale is NeedsLogin/],
  ];
  for (const [result, re] of cases) {
    const r = await tailscale.read({ runImpl: fakeRun(result).impl });
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  }
});

test('read with the real runner and no such binary is {ok:false}, not a throw', async () => {
  const r = await tailscale.read({ bin: 'laneboard-no-such-tailscale-binary' });
  assert.deepEqual(r, { ok: false, error: 'laneboard-no-such-tailscale-binary not found' });
});

test('the none feeder gives an empty feed with a note', async () => {
  assert.deepEqual(none.toFeed(null, { now: NOW }), {
    source: 'none', at: NOW, every: 60, note: 'the none feeder reads nothing',
    host: { sub: 'no feeder', alerts: [] }, guests: [], events: [],
  });
  assert.deepEqual(await none.read(), { ok: true, input: null });
  const r = await collect('none', { source: 'lab', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.feed.source, 'lab');
  assert.deepEqual(r.feed.guests, []);
});

test('the table: every feeder has the interface; unknown kinds are refused as values', async () => {
  assert.deepEqual(feederNames, Object.keys(TABLE));
  assert.ok(feederNames.includes('none') && feederNames.includes('tailscale'));
  for (const kind of feederNames) {
    const f = feeder(kind);
    assert.equal(f.name, kind);
    assert.equal(typeof f.toFeed, 'function');
    assert.equal(typeof f.read, 'function');
  }
  assert.equal(feeder('toString'), null);
  assert.equal(feeder('nope'), null);
  const r = await collect('nope');
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown feeder: nope/);
});

test('the fixture uses documentation addresses only', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const v4 = text.match(/\b\d+\.\d+\.\d+\.\d+\b/g) ?? [];
  assert.ok(v4.length > 0);
  for (const ip of v4) assert.match(ip, /^(192\.0\.2\.\d+|10\.0\.0\.0)$/, ip);
});
