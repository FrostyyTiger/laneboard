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
import * as builtins from '../server/fleet/builtin-actions.mjs';

const stubState = { get: () => null, all: () => [] };

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

test('the route table: reads are GET under /api/v1/, the one mutation is POST /api/v1/actions', () => {
  assert.deepEqual(v1.ROUTES.map((r) => `${r.method} ${r.path}`), [
    'GET /api/v1/hello', 'GET /api/v1/snapshot', 'GET /api/v1/audit', 'GET /api/v1/jobs/:id', 'POST /api/v1/actions',
  ]);
  for (const r of v1.ROUTES) {
    assert.ok(r.path.startsWith('/api/v1/'));
    if (r.method === 'GET') assert.equal(r.tier, 'read');
    else assert.equal(r.path, '/api/v1/actions');
  }
  assert.ok(Object.isFrozen(v1.ROUTES));
});

test('the route module is builder-only, registers every route, the upgrade hook and the actions', async () => {
  assert.equal(routeModule.name, 'v1');
  assert.deepEqual(routeModule.modes, ['builder']);
  dispatch._reset();
  builtins._resetBuiltins();
  const seen = new Map();
  const ups = [];
  const ctx = createContext({ config, state: stubState }, { route: (m, p, h) => seen.set(`${m} ${p}`, h), upgradeHandlers: ups });
  routeModule.register(ctx);
  assert.deepEqual([...seen.keys()].sort(), v1.ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  assert.equal(ups.length, 1);
  const t = dispatch.tiers();
  for (const [k, tier] of Object.entries({ 'send-text': 'click', kill: 'confirm', term: 'click', launch: 'ask' })) assert.equal(t[k], tier, k);
  assert.equal('broadcast' in t, false, 'hub-only actions are not listed');
  for (const c of ['stream', 'actions', 'audit', 'term']) assert.ok(v1.capabilityList().includes(c), c);
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

// ------------------------------------------- in-process server (fleet A8) ---
//
// handleRequest + handleUpgrade on an ephemeral port with stub deps and an
// audit log in a temp dir. No fleet block in this process's config, so every
// request is `local` (the kind-specific rules are tested against real boots
// in test/api-v1-auth.test.mjs).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createServer, handleUpgrade, SERVER_LIMITS } from '../server/boot/common.mjs';
import { readBody, DEFAULT_BODY_LIMIT, route as httpRoute } from '../server/http.mjs';
import { openAudit, GENESIS } from '../server/fleet/audit.mjs';
import { createLimiter } from '../server/fleet/ratelimit.mjs';
import * as stream from '../server/fleet/stream.mjs';
import * as ws from '../server/ws.mjs';
import { Readable } from 'node:stream';

const HOST = `127.0.0.1:${config.port}`;

function makeWorld() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-a8-'));
  const calls = [];
  const sessions = new Map([['demo', { name: 'demo', state: 'idle', paneId: '%1' }]]);
  const st = { get: (n) => sessions.get(n) ?? null, all: () => [...sessions.values()], promptReadiness: () => 'ready' };
  const actions = {
    sendKeys: async (name, keys, who) => { calls.push(['sendKeys', name, keys, who]); return { ok: true }; },
    sendText: async (name, text, enter, who) => { calls.push(['sendText', name, text, enter, who]); return { ok: true }; },
    kill: async (name, who) => { calls.push(['kill', name, who]); return { ok: true, name }; },
    restart: async (name, who) => { calls.push(['restart', name, who]); return { ok: true, name }; },
    spawn: async (o, who) => { calls.push(['spawn', o, who]); return { ok: true }; },
  };
  const launcher = { launch: async (r, who) => { calls.push(['launch', r, who]); return { lane: r.lane, job: 'j1' }; } };
  const terminals = { attachNamed: (req, socket, head, name, url) => { calls.push(['attachNamed', name, url.search]); socket.destroy(); return true; } };
  const db = { jobSteps: (id) => (id === 'j1' ? [{ step: 'done', ok: true }] : []) };
  const audit = openAudit({ file: path.join(tmp, 'audit.jsonl'), builder: config.fleet.id });
  return { tmp, calls, st, actions, launcher, terminals, db, audit };
}

let world;
let server;
let port;

let setupDone;
const ensure = () => setupDone ??= (async () => {
  dispatch._reset();
  builtins._resetBuiltins();
  world = makeWorld();
  const ups = [];
  const ctx = createContext(
    { config, state: world.st, actions: world.actions, launcher: world.launcher, retirer: {}, terminals: world.terminals, db: world.db },
    { route: (m, p, h) => httpRoute(m, p, h), upgradeHandlers: ups },
  );
  routeModule.register(ctx);
  v1.configureV1({ audit: world.audit, limiter: createLimiter(null) });
  server = createServer();
  server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, { onUpgrade: (rq, so, hd, url) => ups.some((h) => h(rq, so, hd, url)) }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
})();

test.after(() => {
  server?.close();
  world?.audit.close();
  stream._reset();
  fs.rmSync(world.tmp, { recursive: true, force: true });
});

function call(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: HOST, ...(method !== 'GET' ? { 'x-laneboard': '1', 'content-type': 'application/json' } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json: j });
      });
    });
    r.on('error', reject);
    if (data !== null) r.write(data);
    r.end();
  });
}

const env = (action, target, args = {}, over = {}) => ({
  v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: config.fleet.id, action, target, args, user: 'ignored', via: 'direct', ...over,
});

import crypto from 'node:crypto';
import * as authMod from '../server/fleet/auth.mjs';

function auditEntries() {
  return world.audit.read({ since: 0 }).entries;
}

test('hello over HTTP carries auth.kind; snapshot carries seq and the stream epoch', async () => {
  await ensure();
  const h = await call('GET', '/api/v1/hello');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.auth, { kind: 'local' });
  assert.equal(h.json.actions.term, 'click');
  const s = await call('GET', '/api/v1/snapshot');
  assert.equal(s.status, 200);
  assert.equal(s.json.epoch, stream.epoch());
  assert.equal(typeof s.json.seq, 'number');
});

test('POST /api/v1/actions: runs through dispatch, the user comes from the classification, audited', async () => {
  await ensure();
  world.calls.length = 0;
  const e = env('send-keys', 'demo', { keys: ['Enter'] });
  const r = await call('POST', '/api/v1/actions', { body: e });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.match(r.json.auditId, /^[0-9a-f]{64}$/);
  assert.deepEqual(world.calls, [['sendKeys', 'demo', ['Enter'], 'local']]);
  const mine = auditEntries().filter((x) => x.id === e.id);
  assert.deepEqual(mine.map((x) => x.result.phase), ['start', 'done']);
  for (const x of mine) {
    assert.equal(x.user, 'local', 'never the envelope user');
    assert.equal(x.via, 'legacy', 'via comes from the kind (local), not the envelope');
  }
  assert.equal(mine[1].hash, r.json.auditId);
  // the audit read sees it after the previous entry's hash
  const a = await call('GET', `/api/v1/audit?after=${mine[0].hash}`);
  assert.equal(a.status, 200);
  assert.equal(a.json.builder, config.fleet.id);
  assert.ok(a.json.entries.some((x) => x.hash === r.json.auditId));
  assert.equal(a.json.afterFound, true);
  assert.equal(typeof a.json.head.count, 'number');
});

test('POST /api/v1/actions: confirm tier, unknown action, bad bodies', async () => {
  await ensure();
  world.calls.length = 0;
  let r = await call('POST', '/api/v1/actions', { body: env('kill', 'demo', {}) });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'bad_args');
  r = await call('POST', '/api/v1/actions', { body: env('kill', 'demo', { confirm: 'other' }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'confirm_required');
  assert.ok(r.json.auditId, 'a refusal is audited too');
  assert.deepEqual(world.calls, [], 'the stub never ran');
  r = await call('POST', '/api/v1/actions', { body: env('kill', 'demo', { confirm: 'demo' }) });
  assert.equal(r.status, 200);
  assert.deepEqual(world.calls, [['kill', 'demo', 'local']]);
  r = await call('POST', '/api/v1/actions', { body: env('no-such', 'demo') });
  assert.equal(r.json.code, 'unknown_action');
  r = await call('POST', '/api/v1/actions', { body: env('term', 'demo') });
  assert.equal(r.json.code, 'upgrade-only');
  r = await call('POST', '/api/v1/actions', { body: '{nope' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'bad_json');
  r = await call('POST', '/api/v1/actions', { body: '[1]' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/v1/actions', { body: JSON.stringify({ pad: 'x'.repeat(70000) }) });
  assert.equal(r.status, 413);
  r = await call('POST', '/api/v1/actions', { body: env('send-keys', 'demo', { keys: ['Enter'] }), headers: { 'x-laneboard': '' } });
  assert.equal(r.status, 403, 'the CSRF header is still required');
  r = await call('POST', '/api/v1/actions', { body: env('send-keys', 'demo', { keys: ['Enter'] }, { builder: 'someone-else' }) });
  assert.equal(r.status, 400, 'an envelope for another builder');
});

test('SR17 M1: a local launch may not ask for priority high or a budget above the per-lane default', async () => {
  await ensure();
  world.calls.length = 0;
  const repo = 'acme';
  const cfg = { ...config, repoNames: [repo], budget: { ...(config.budget ?? {}), perLaneUsd: 5 } };
  const a = authMod.classify({ method: 'POST', url: '/', headers: {}, socket: {} }, config);
  assert.equal(a.kind, 'local');
  assert.match(v1.localLaunchRefusal(env('launch', 'l1', { repo, plan: 'p.md', priority: 'high' }), a, cfg), /remote-only/);
  assert.match(v1.localLaunchRefusal(env('launch', 'l1', { repo, plan: 'p.md', budgetUsd: 6 }), a, cfg), /remote-only/);
  assert.equal(v1.localLaunchRefusal(env('launch', 'l1', { repo, plan: 'p.md', budgetUsd: 5 }), a, cfg), null);
  assert.equal(v1.localLaunchRefusal(env('launch', 'l1', { repo, plan: 'p.md', priority: 'high' }), { kind: 'direct', user: 'u' }, cfg), null);
  const e = env('launch', 'l1', { repo, plan: 'p.md', priority: 'high' });
  const out = await v1.runAction(e, a, { config: cfg });
  assert.equal(out.status, 403);
  assert.equal(out.code, 'remote-only');
  const row = auditEntries().find((x) => x.id === e.id);
  assert.equal(row.result.code, 'remote-only');
  assert.equal(row.action, 'launch');
  assert.deepEqual(world.calls, []);
  const ok = await v1.runAction(env('launch', 'l2', { repo, plan: 'p.md' }), a, { config: cfg });
  assert.equal(ok.status, 202, JSON.stringify(ok));
  assert.equal(world.calls[0][1].permissionMode, 'auto', 'the dispatcher resolves the mode');
  await assert.rejects(v1.runAction(env('send-keys', 'demo', { keys: ['Enter'] }), { kind: 'local', user: 'local' }), TypeError, 'a forged auth object never runs');
  const bp = await v1.runAction(env('launch', 'l3', { repo, plan: 'p.md', permissionMode: 'bypassPermissions' }), a, { config: cfg });
  assert.equal(bp.status, 400);
});

test('no audit log: every action is refused 503 audit-unavailable, nothing runs', async () => {
  await ensure();
  world.calls.length = 0;
  v1.configureV1({ audit: null });
  try {
    const r = await call('POST', '/api/v1/actions', { body: env('send-keys', 'demo', { keys: ['Enter'] }) });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'audit-unavailable');
    assert.equal((await call('GET', '/api/v1/audit')).status, 503);
  } finally {
    v1.configureV1({ audit: world.audit });
  }
  assert.deepEqual(world.calls, []);
});

test('GET /api/v1/audit validates its query; GET /api/v1/jobs/:id', async () => {
  await ensure();
  for (const q of ['since=abc', 'after=xyz', 'limit=0', 'limit=1001']) assert.equal((await call('GET', `/api/v1/audit?${q}`)).status, 400, q);
  const r = await call('GET', `/api/v1/audit?after=${'a'.repeat(64)}`);
  assert.equal(r.json.afterFound, false);
  assert.deepEqual(r.json.entries, []);
  assert.equal((await call('GET', '/api/v1/audit?limit=1')).json.entries.length, 1);
  assert.notEqual(GENESIS, (await call('GET', '/api/v1/audit')).json.head.hash);
  const j = await call('GET', '/api/v1/jobs/j1');
  assert.deepEqual(j.json, { job: 'j1', steps: [{ step: 'done', ok: true }] });
  assert.equal((await call('GET', '/api/v1/jobs/nope')).status, 404);
});

test('SR7 L3/L5: absolute-form targets and malformed escapes are 400, never 500', async () => {
  await ensure();
  const raw = (line) => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`${line}\r\nHost: ${HOST}\r\nX-Laneboard: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`));
    let d = '';
    s.on('data', (c) => { d += c; });
    s.on('close', () => resolve(d));
  });
  assert.match(await raw('GET http://evil.example.invalid/api/v1/hello HTTP/1.1'), /^HTTP\/1\.1 400/);
  assert.match(await raw('GET //evil.example.invalid/api/v1/hello HTTP/1.1'), /^HTTP\/1\.1 400/);
  assert.match(await raw('POST /api/%zz HTTP/1.1'), /^HTTP\/1\.1 400/);
  assert.match(await raw('GET /api/sessions/%zz/preview HTTP/1.1'), /^HTTP\/1\.1 400/);
  assert.match(await raw('GET /api/v1/%zz HTTP/1.1'), /^HTTP\/1\.1 400/);
  // an encoded spelling of a route path is not that route (routes match the raw path)
  const r = await call('POST', '/api/v1/%61ctions', { body: env('send-keys', 'demo', { keys: ['Enter'] }) });
  assert.equal(r.status, 404);
});

function wsOpen(p, headers = {}) {
  const c = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers: { host: HOST, ...headers } });
  return c;
}

test('WS /api/v1/stream from local: snapshot first, seq contiguous, resync replays or snapshots', async () => {
  await ensure();
  stream._reset();
  const c = wsOpen('/api/v1/stream');
  const frames = [];
  c.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await once(c, 'open');
  const until = async (n) => { for (let i = 0; i < 100 && frames.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
  await until(1);
  assert.equal(frames[0].type, 'snapshot');
  assert.equal(frames[0].epoch, stream.epoch());
  const s0 = frames[0].seq;
  ws.send({ type: 'event', event: { n: 1 } });
  ws.send({ type: 'event', event: { n: 2 } });
  await until(3);
  assert.deepEqual(frames.slice(1, 3).map((f) => f.seq), [s0 + 1, s0 + 2]);
  c.send(JSON.stringify({ type: 'resync', fromSeq: s0 + 1 }));
  await until(4);
  assert.equal(frames[3].seq, s0 + 2, 'replayed from the ring');
  c.send(JSON.stringify({ type: 'resync', fromSeq: s0 + 999 }));
  await until(5);
  assert.equal(frames[4].type, 'snapshot', 'a seq outside the ring gets a snapshot');
  c.close();
});

test('WS /api/v1/term/:name from local: audited as term, then attachNamed; unknown session 404', async () => {
  await ensure();
  world.calls.length = 0;
  const bad = wsOpen('/api/v1/term/nobody');
  const [, res] = await once(bad, 'unexpected-response');
  assert.equal(res.statusCode, 404);
  const c = wsOpen('/api/v1/term/demo?cols=100&rows=30');
  await new Promise((resolve) => { c.on('error', resolve); c.on('close', resolve); c.on('unexpected-response', resolve); });
  assert.deepEqual(world.calls, [['attachNamed', 'demo', '?cols=100&rows=30']]);
  const row = auditEntries().filter((x) => x.action === 'term').at(-1);
  assert.equal(row.target, 'demo');
  assert.equal(row.user, 'local');
  assert.equal(row.result.ok, true);
  const w = wsOpen('/api/v1/term/demo?window=bad%20window');
  const [, r2] = await once(w, 'unexpected-response');
  assert.equal(r2.statusCode, 400);
});

test('WS: a hostile Host or Origin is refused before any handler', async () => {
  await ensure();
  const c = wsOpen('/api/v1/stream', { host: 'evil.example.invalid' });
  const [, res] = await once(c, 'unexpected-response');
  assert.equal(res.statusCode, 403);
  const o = new WebSocket(`ws://127.0.0.1:${port}/api/v1/stream`, { headers: { host: HOST }, origin: 'https://evil.example.invalid' });
  const [, r2] = await once(o, 'unexpected-response');
  assert.equal(r2.statusCode, 403);
});

test('SR15 H1: servers carry timeouts and connection caps; a slow-headers client is closed', async () => {
  await ensure();
  assert.equal(SERVER_LIMITS.maxConnections, 256);
  assert.equal(server.maxConnections, 256);
  assert.equal(server.headersTimeout, SERVER_LIMITS.headersTimeout);
  assert.equal(server.requestTimeout, SERVER_LIMITS.requestTimeout);
  assert.equal(server.maxHeadersCount, SERVER_LIMITS.maxHeadersCount);
  const slow = createServer(undefined, { headersTimeout: 300, requestTimeout: 600, connectionsCheckingInterval: 100 });
  slow.listen(0, '127.0.0.1');
  await once(slow, 'listening');
  try {
    const t0 = Date.now();
    const s = net.connect(slow.address().port, '127.0.0.1', () => s.write('GET /healthz HTTP/1.1\r\nHost: x\r\n'));
    s.on('data', () => {});
    s.on('error', () => {});
    await once(s, 'close');
    assert.ok(Date.now() - t0 < 5000, 'closed by the headers timeout');
  } finally {
    slow.close();
  }
});

test('SR15 H1: readBody caps at 256 KiB unless the route asks for more', async () => {
  await ensure();
  assert.equal(DEFAULT_BODY_LIMIT, 256 * 1024);
  const big = () => Readable.from([Buffer.alloc(200 * 1024), Buffer.alloc(100 * 1024)]);
  await assert.rejects(readBody(big()), /too large/);
  assert.equal((await readBody(big(), 1024 * 1024)).length, 300 * 1024);
});

test('initV1/preloadNonces: audit ids of the last 5 minutes are replay-protected after a restart', async () => {
  await ensure();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-a8-nonce-'));
  try {
    const file = path.join(tmp, 'audit.jsonl');
    const a1 = openAudit({ file, builder: config.fleet.id });
    const recent = crypto.randomUUID();
    a1.append({ id: recent, user: 'u', via: 'hub', action: 'send-keys', target: 'demo', args: {}, result: { ok: true, status: 200 } });
    a1.close();
    const seen = [];
    const fakeCache = { add: (id, ts) => { seen.push([id, ts]); return { ok: true }; } };
    const a2 = openAudit({ file, builder: config.fleet.id });
    try {
      assert.equal(v1.preloadNonces(a2, fakeCache), 1);
      assert.equal(seen[0][0], recent);
      assert.equal(v1.preloadNonces(a2, fakeCache, Date.now() + 10 * 60000), 0, 'older than the nonce TTL: not loaded');
    } finally {
      a2.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
