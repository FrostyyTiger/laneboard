// The morning preview's hub (test/tools/demo-fleet.mjs) names itself
// `demo-host` (runs plan T3): booted with the same config helper, its Map's
// core node and title are the demo name, never this machine's hostname.
// With `writeDemoMap` (night 3 T1) its Map has drift both ways and Reach links.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './helpers/boot.mjs';
import { fakeBuilder } from './helpers/fake-builder.mjs';
import { demoHubConfig, DEMO_HOSTNAME, writeDemoMap, demoAttention } from './helpers/demo-hub.mjs';
import { attentionList } from '../server/state.mjs';
import { fkey } from '../server/fleet/keys.mjs';
import { generateHubKey, publicKeyString } from '../server/fleet/keys-ed25519.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

test('demoHubConfig: a demo hostname, the builders and origins as given', () => {
  const c = demoHubConfig({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1' }], origins: ['http://127.0.0.1:7795'], publicHost: 'hub.example.invalid' });
  assert.equal(c.hostname, DEMO_HOSTNAME);
  assert.equal(DEMO_HOSTNAME, 'demo-host');
  assert.equal(c.publicUrl, 'https://hub.example.invalid');
  assert.deepEqual(c.fleet.builders, [{ id: 'builder-a', url: 'http://127.0.0.1:1' }]);
  assert.deepEqual(c.fleet.allowedOrigins, ['http://127.0.0.1:7795']);
});

test('the demo hub labels the Map core demo-host, not os.hostname()', { timeout: 60_000 }, async (t) => {
  const { privateKey: hubKey } = generateHubKey();
  const fa = await fakeBuilder({ id: 'builder-a', hubKeys: [{ key: publicKeyString(hubKey), id: 'hub', scopes: ['read'] }] });
  t.after(() => fa.close());
  const hub = await boot({
    mode: 'hub',
    hubKey,
    timeoutMs: 20_000,
    config: demoHubConfig({ builders: [{ id: 'builder-a', url: fa.url }], origins: [], publicHost: 'hub.example.invalid' }),
  });
  t.after(() => hub.stop());

  let map = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const r = await localGet(hub, '/api/map');
    if (r.status === 200) {
      const m = JSON.parse(r.text);
      if (m.nodes.some((n) => n.kind === 'core') && m.nodes.some((n) => n.id === 'builder:builder-a')) { map = m; break; }
    }
    await sleep(100);
  }
  assert.ok(map, 'the hub Map came up with its core and builder-a');
  const core = map.nodes.find((n) => n.kind === 'core');
  assert.equal(core.label, 'demo-host');
  assert.equal(map.title, 'demo-host');
  if (os.hostname() !== 'demo-host') {
    assert.ok(!map.nodes.some((n) => n.label === os.hostname()), 'no node carries the real hostname');
    assert.ok(!JSON.stringify(map).includes(JSON.stringify(os.hostname())), 'the real hostname appears nowhere in /api/map');
  }
});

test('the demo map: drift both ways and reach links on /api/map', { timeout: 60_000 }, async (t) => {
  const { privateKey: hubKey } = generateHubKey();
  const fa = await fakeBuilder({ id: 'builder-a', hubKeys: [{ key: publicKeyString(hubKey), id: 'hub', scopes: ['read'] }] });
  t.after(() => fa.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-demo-map-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const map = writeDemoMap(dir);
  const hub = await boot({
    mode: 'hub',
    hubKey,
    timeoutMs: 20_000,
    config: demoHubConfig({ builders: [{ id: 'builder-a', url: fa.url }], origins: [], publicHost: 'hub.example.invalid', map }),
  });
  t.after(() => hub.stop());

  let m = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const r = await localGet(hub, '/api/map');
    if (r.status === 200) {
      const x = JSON.parse(r.text);
      if (x.nodes.some((n) => n.id === 'builder:builder-a') && x.reach?.links?.length) { m = x; break; }
    }
    await sleep(100);
  }
  assert.ok(m, 'the hub Map came up with builder-a and reach links');
  assert.equal(m.error, undefined, 'the topology loads');
  assert.equal(m.reach.error, undefined, 'the policy loads');
  const missing = m.nodes.filter((n) => n.drift === 'missing');
  const undeclared = m.nodes.filter((n) => n.drift === 'undeclared');
  assert.deepEqual(missing.map((n) => n.id), ['backup']);
  assert.deepEqual(undeclared.map((n) => n.label), ['scratch']);
  assert.ok(m.reach.links.length >= 2, `reach links: ${m.reach.links.length}`);
  assert.ok(m.reach.links.some((l) => l.from === 'room-a' && l.to === 'ci'), 'builder-a reaches ci');
  assert.ok(m.reach.links.some((l) => l.from === 'ci' && l.to === 'lab' && l.ports.includes('tcp:8006')), 'ci reaches the hypervisor API');
  assert.ok(m.reach.unresolved.some((u) => u.selector === 'group:admins'), 'a group rule is unresolved, not guessed');
  assert.equal(m.nodes.find((n) => n.id === 'builder:builder-a').parent, 'room-a', 'builder-a hangs under its room');
  assert.equal(m.title, DEMO_HOSTNAME);
});

// Night 3 T17: the Board said "Needs you 0 / Nothing waiting." next to PERM,
// QUES and DANGER cards. Cause: the fake builders sent `fixture.attention ?? []`
// and the demo's sessions carry no such list, so the hub relayed an empty
// queue; a real builder builds it from its sessions (server/state.mjs).
test('demoAttention: a permission-waiting lane counts, ordered like a real builder', () => {
  const now = 1_000_000;
  const sessions = [
    { name: 'search api', lane: 'feat-search', state: 'working', attentionScore: 100 }, // the fixture template's stale score
    { name: 'search ui', lane: 'feat-search', state: 'waiting_permission', stateSince: now - 5000 },
    { name: 'login fix', lane: 'fix-login', state: 'waiting_question', stateSince: now - 9000 },
    { name: 'cleanup job', state: 'waiting_permission', danger: { kind: 'guard', reason: 'delete outside the worktree' } },
  ];
  const a = demoAttention('builder-a', sessions, now);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.name), ['cleanup job', 'search ui', 'login fix']);
  assert.equal(a[0].danger, 'delete outside the worktree');
  assert.equal(a[1].key, fkey('builder-a', 'search ui'));
  assert.ok(a.every((x) => x.builder === 'builder-a'));
  assert.equal(sessions[0].attentionScore, 0, 'rescored like a real snapshot');
  assert.deepEqual(demoAttention('builder-a', [{ name: 'idle', state: 'idle' }], now), []);
});

test('attentionList: the snapshot rule, a score already on the session wins', () => {
  const key = (n) => `k:${n}`;
  const list = attentionList([
    { name: 'a', state: 'waiting_question', stateSince: 2 },
    { name: 'b', state: 'waiting_question', stateSince: 1 },
    { name: 'c', state: 'working', attentionScore: 0 },
    { name: 'd', state: 'working', attentionScore: 150 },
  ], key, 10);
  assert.deepEqual(list.map((x) => [x.name, x.score]), [['d', 150], ['b', 90], ['a', 90]]);
  assert.equal(list[0].key, 'k:d');
});
