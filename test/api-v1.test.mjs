// API v1 skeleton (fleet F9): hello/snapshot shapes, the hello registry, the
// route module, and a real boot (builder serves /api/v1/*, a hub does not).
import test from 'node:test';
import assert from 'node:assert/strict';

import * as v1 from '../server/fleet/api-v1.mjs';
import routeModule from '../server/routes/v1.mjs';
import * as dispatch from '../server/fleet/dispatch.mjs';
import { config } from '../server/config.mjs';
import { VERSION } from '../server/version.mjs';
import { createContext } from '../server/modules.mjs';
import { boot } from './helpers/boot.mjs';

const CORE = ['id', 'code', 'version', 'apiVersion', 'mode', 'capabilities', 'actions', 'time'];

function deepKeys(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) deepKeys(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); deepKeys(x, out); }
  return out;
}

test('hello has the README §3.3 core shape', () => {
  v1._reset();
  const h = v1.hello({ now: 1234 });
  assert.deepEqual(Object.keys(h).sort(), [...CORE].sort());
  assert.equal(h.id, config.fleet.id);
  assert.equal(h.code, config.fleet.code);
  assert.equal(h.version, VERSION);
  assert.equal(h.apiVersion, 1);
  assert.equal(h.mode, config.mode ?? 'builder');
  assert.deepEqual(h.capabilities, ['snapshot']);
  assert.equal(h.time, 1234);
  assert.equal(typeof h.actions, 'object');
  assert.ok(Math.abs(v1.hello().time - Date.now()) < 5000);
  assert.match(JSON.stringify(v1.hello()), /"apiVersion":1/);
});

test('hello.actions is dispatch.tiers()', () => {
  dispatch._reset();
  assert.deepEqual(v1.hello().actions, {});
  dispatch.registerAction('zz-f9-test', { tier: 'click', target: 'builder', run: async () => ({}) });
  assert.deepEqual(v1.hello().actions, { 'zz-f9-test': 'click' });
  assert.deepEqual(v1.hello().actions, dispatch.tiers());
  dispatch._reset();
});

test('addCapability: sorted after snapshot, idempotent, names validated', () => {
  v1._reset();
  v1.addCapability('launch');
  v1.addCapability('conflicts:textual');
  v1.addCapability('launch');
  v1.addCapability('snapshot');
  assert.deepEqual(v1.hello().capabilities, ['snapshot', 'conflicts:textual', 'launch']);
  for (const bad of ['', 'Upper', '__proto__', 'a b', 'x'.repeat(40), 7, null]) {
    assert.throws(() => v1.addCapability(bad), TypeError, String(bad));
  }
  v1._reset();
  assert.deepEqual(v1.hello().capabilities, ['snapshot']);
});

test('addHelloField: adds a key, refuses reserved, duplicate and bad names', () => {
  v1._reset();
  v1.addHelloField('repos', () => [{ id: 'acme' }]);
  v1.addHelloField('permissionModes', () => ['default']);
  const h = v1.hello();
  assert.deepEqual(h.repos, [{ id: 'acme' }]);
  assert.deepEqual(h.permissionModes, ['default']);
  for (const k of [...CORE, 'auth']) assert.throws(() => v1.addHelloField(k, () => 1), /reserved/);
  assert.throws(() => v1.addHelloField('repos', () => 1), /already/);
  for (const bad of ['__proto__', 'constructor.x', 'Repos', '', 3]) {
    assert.throws(() => v1.addHelloField(bad, () => 1), TypeError);
  }
  assert.throws(() => v1.addHelloField('scripts', 'nope'), TypeError);
  v1._reset();
  assert.equal('repos' in v1.hello(), false);
});

test('a throwing or undefined hello field is left out, the hello still answers', () => {
  v1._reset();
  v1.addHelloField('broken', () => { throw new Error('boom'); });
  v1.addHelloField('absent', () => undefined);
  v1.addHelloField('present', () => 0);
  const h = v1.hello();
  assert.equal('broken' in h, false);
  assert.equal('absent' in h, false);
  assert.equal(h.present, 0);
  assert.equal(h.apiVersion, 1);
  v1._reset();
});

test('snapshot: state.snapshot() + builder + seq, previews stripped', () => {
  const fake = {
    box: { cpu: 1 },
    sessions: [
      { name: 'web', key: 'b/web', preview: ['raw'], previewHtml: ['<b>x</b>'], previewLines: ['\x1b[31mx'] },
      { name: 'api', preview: [] },
    ],
    lanes: [{ id: 'l1' }],
    attention: [],
    vitals: null,
    generatedAt: 5,
    repos: [],
  };
  const s = v1.snapshot({ source: () => fake, seq: () => 42 });
  assert.deepEqual(s.builder, { id: config.fleet.id, code: config.fleet.code });
  assert.equal(s.seq, 42);
  assert.deepEqual(s.box, fake.box);
  assert.deepEqual(s.lanes, fake.lanes);
  assert.deepEqual(s.repos, []);
  assert.equal(s.generatedAt, 5);
  assert.deepEqual(s.sessions.map((x) => x.name), ['web', 'api']);
  assert.deepEqual(s.sessions[0].previewLines, ['\x1b[31mx']);
  const keys = deepKeys(s);
  assert.equal(keys.has('preview'), false);
  assert.equal(keys.has('previewHtml'), false);
  // The source object is not mutated.
  assert.deepEqual(fake.sessions[0].preview, ['raw']);
});

test('snapshot with the real state and ws seq', () => {
  const s = v1.snapshot();
  for (const k of ['sessions', 'lanes', 'attention', 'builder', 'seq']) assert.ok(k in s, k);
  assert.equal(typeof s.seq, 'number');
});

test('the route table is reads only, GET only, under /api/v1/', () => {
  assert.deepEqual(v1.ROUTES.map((r) => r.path), ['/api/v1/hello', '/api/v1/snapshot']);
  for (const r of v1.ROUTES) {
    assert.equal(r.method, 'GET');
    assert.equal(r.tier, 'read');
    assert.ok(r.path.startsWith('/api/v1/'));
  }
  assert.ok(Object.isFrozen(v1.ROUTES));
});

test('the route module is builder-only and registers both routes', async () => {
  assert.equal(routeModule.name, 'v1');
  assert.deepEqual(routeModule.modes, ['builder']);
  const seen = new Map();
  const ctx = createContext({}, { route: (m, p, h) => seen.set(`${m} ${p}`, h), upgradeHandlers: [] });
  routeModule.register(ctx);
  assert.deepEqual([...seen.keys()].sort(), ['GET /api/v1/hello', 'GET /api/v1/snapshot']);
  let body = null;
  const res = {};
  const fakeCtx = { json: (r, b) => { body = b; } };
  v1.ROUTES[0].handler({}, res, fakeCtx);
  assert.equal(body.apiVersion, 1);
});

test('boot: a builder serves hello and snapshot, reads only', async () => {
  const b = await boot({ config: { fleet: { id: 'builder-a', code: 'BA' } } });
  try {
    const r = await fetch(`${b.url}/api/v1/hello`, { headers: { 'X-Laneboard': '1' } });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /"apiVersion":1/);
    const h = JSON.parse(text);
    assert.equal(h.id, 'builder-a');
    assert.equal(h.code, 'BA');
    assert.equal(h.mode, 'builder');
    assert.ok(h.capabilities.includes('snapshot'));

    const s = await (await fetch(`${b.url}/api/v1/snapshot`)).json();
    assert.deepEqual(s.builder, { id: 'builder-a', code: 'BA' });
    assert.equal(typeof s.seq, 'number');
    assert.ok(Array.isArray(s.sessions));
    const keys = deepKeys(s);
    assert.equal(keys.has('preview'), false);
    assert.equal(keys.has('previewHtml'), false);

    // Reads only: no mutating method on these paths.
    const post = await fetch(`${b.url}/api/v1/hello`, { method: 'POST', headers: { 'X-Laneboard': '1' } });
    assert.ok(post.status >= 400, `POST hello gave ${post.status}`);
  } finally {
    await b.stop();
  }
});

test('boot: a hub does not serve /api/v1/hello', async () => {
  const b = await boot({
    mode: 'hub',
    config: { fleet: { builders: [{ id: 'builder-a', url: 'http://127.0.0.1:9' }] } },
  });
  try {
    const r = await fetch(`${b.url}/api/v1/hello`);
    assert.equal(r.status, 404);
  } finally {
    await b.stop();
  }
});
