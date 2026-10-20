// The morning preview's hub (test/tools/demo-fleet.mjs) names itself
// `demo-host` (runs plan T3): booted with the same config helper, its Map's
// core node and title are the demo name, never this machine's hostname.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { boot } from './helpers/boot.mjs';
import { fakeBuilder } from './helpers/fake-builder.mjs';
import { demoHubConfig, DEMO_HOSTNAME } from './helpers/demo-hub.mjs';
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
