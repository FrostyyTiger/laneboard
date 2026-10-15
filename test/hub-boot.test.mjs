// Hub wiring (fleet plan §3 2.8/2.9, H11): a real `node server/index.mjs` in
// hub mode (test/helpers/boot.mjs) against two in-process fake builders
// (test/helpers/fake-builder.mjs), plus unit tests of the services hook and
// the core module helpers, and the supply-chain canary (SECURITY-FIXES S1/S21).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { boot, ingressFetch, ingressWs, ROOT } from './helpers/boot.mjs';
import { fakeBuilder, hubSigner } from './helpers/fake-builder.mjs';
import { generateHubKey, publicKeyString, writePrivateKey } from '../server/fleet/keys-ed25519.mjs';
import { createServices, ServiceError } from '../server/hub/services.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { createClientWs } from '../server/hub/client-ws.mjs';
import {
  builderRow, checkSubscription, createMapLoop, createViewCache, createHubPush, isRemoteUser, healthCounts,
} from '../server/hub/routes/core.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const silentLog = { warn() {}, info() {}, error() {} };
const USER = 'tester@example.invalid';
const PUBLIC = 'hub.example.invalid:8443';

async function waitFor(fn, { timeoutMs = 8000, everyMs = 50, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 300)})`);
}

/** A request on the hub's LOCAL (loopback, non-ingress) listener. */
function localFetch(booted, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: `127.0.0.1:${booted.port}`, ...headers };
    let payload = body;
    if (payload !== undefined && typeof payload !== 'string') {
      payload = JSON.stringify(payload);
      h['content-type'] ??= 'application/json';
    }
    const req = http.request({ host: '127.0.0.1', port: booted.port, path: p, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function loadedPaths(booted) {
  return booted.loadedUrls()
    .filter((u) => u.startsWith('file:'))
    .map((u) => fileURLToPath(u))
    .filter((p) => p.startsWith(ROOT))
    .map((p) => p.slice(ROOT.length + 1));
}

function wsOutcome(ws) {
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ open: true }));
    ws.once('unexpected-response', (_req, res) => resolve({ open: false, status: res.statusCode }));
    ws.once('error', (err) => resolve({ open: false, error: err.message }));
  });
}

// --- the hub against two fake builders ------------------------------------------------------------------

test('hub mode end to end: fleet, routes, relay, auth, web baseline, liveness, no builder graph', { timeout: 60_000 }, async (t) => {
  const { privateKey: hubKey } = generateHubKey();
  const pinned = [{ key: publicKeyString(hubKey), id: 'hub', scopes: ['read', 'control', 'term'] }];
  const fa = await fakeBuilder({ id: 'builder-a', hubKeys: pinned });
  const fb = await fakeBuilder({ id: 'builder-b', hubKeys: pinned });
  t.after(() => Promise.all([fa.close(), fb.close()]));

  const hub = await boot({
    mode: 'hub',
    hubKey,
    trace: true,
    config: {
      publicUrl: `https://${PUBLIC}`,
      fleet: {
        builders: [{ id: 'builder-a', url: fa.url }, { id: 'builder-b', url: fb.url }],
        staleMs: 300,
        downMs: 900,
        pingMs: 100,
        batchMs: 100,
      },
    },
  });
  t.after(() => hub.stop());
  assert.equal(hub.health.mode, 'hub');

  // Both builders come up (read on the local listener: `local` keeps every read).
  const fleet = await waitFor(async () => {
    const r = await localFetch(hub, '/api/fleet');
    if (r.status !== 200) return null;
    const j = r.json();
    return j.builders.length === 2 && j.builders.every((b) => b.state === 'up') ? j : null;
  }, { what: 'both builders up' });
  assert.deepEqual(fleet.builders.map((b) => b.id), ['builder-a', 'builder-b']);
  for (const b of fleet.builders) {
    assert.equal(b.controls, true);
    assert.equal(b.version, '0.1.0');
    assert.ok(Array.isArray(b.capabilities));
  }
  assert.equal(fleet.aggregates.counts.builders.up, 2);
  const hz = await (await fetch(`${hub.url}/healthz`)).json();
  assert.equal(hz.mode, 'hub');
  assert.deepEqual(hz.builders, { up: 2, stale: 0, down: 0 });

  // The same through serve, as a direct user.
  const viaServe = await ingressFetch(hub, '/api/fleet', { user: USER });
  assert.equal(viaServe.status, 200);
  assert.equal(viaServe.json().builders.length, 2);

  // Snapshots, the CLI compat route, unknown builders.
  const name = fa.sessions[0].name;
  const snap = (await localFetch(hub, '/api/fleet/builder-a/snapshot')).json();
  assert.equal(snap.builder.id, 'builder-a');
  assert.equal(snap.stale, false);
  assert.ok(snap.sessions.some((s) => s.name === name));
  assert.equal((await localFetch(hub, '/api/fleet/nope/snapshot')).status, 404);
  const st = (await localFetch(hub, '/api/state?b=builder-b')).json();
  assert.equal(st.builder.id, 'builder-b');
  assert.ok(Array.isArray(st.sessions) && Array.isArray(st.attention));
  assert.equal((await localFetch(hub, '/api/state?b=nope')).status, 404);
  // Builder-only routes are not registered on a hub.
  assert.equal((await localFetch(hub, '/api/lanes')).status, 404);

  // The fleet Map has both builders (map loop: 1 s debounce after the store changed).
  await waitFor(async () => {
    const m = (await localFetch(hub, '/api/map')).json();
    const ids = new Set(m.nodes.map((n) => n.id));
    return ids.has('builder:builder-a') && ids.has('builder:builder-b');
  }, { what: 'map with both builders' });

  // The signed read proxy (H12): allowlisted, signed, verified by the fake.
  const hello = await ingressFetch(hub, '/api/fleet/builder-a/v1/hello', { user: USER });
  assert.equal(hello.status, 200);
  assert.equal(hello.json().id, 'builder-a');
  assert.equal(fa.requests.at(-1).kind, 'hub');
  assert.equal((await ingressFetch(hub, '/api/fleet/builder-a/v1/not-allowed', { user: USER })).status, 404);
  assert.equal((await ingressFetch(hub, '/api/fleet/builder-a/v1/lanes/x/diff/extra', { user: USER })).status, 404);

  // The hub /ws: fleet first, through serve with an Origin.
  const ws = ingressWs(hub, '/ws', { user: USER });
  const first = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(String(d)))));
  assert.equal((await wsOutcome(ws)).open, true);
  const f1 = await first;
  assert.equal(f1.type, 'fleet');
  assert.equal(f1.builders.length, 2);
  ws.close();
  // /ws from serve without a user is refused.
  assert.equal((await wsOutcome(ingressWs(hub, '/ws', { user: null }))).status, 403);

  // Relay: a direct user through serve reaches builder-a; the envelope carries that user.
  const action = { builder: 'builder-a', action: 'send-text', target: name, args: { text: 'hello' } };
  const sent = await ingressFetch(hub, '/api/fleet/actions', { user: USER, method: 'POST', headers: { 'x-laneboard': '1' }, body: action });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json().ok, true);
  assert.equal(fa.actions.length, 1);
  assert.equal(fa.actions[0].envelope.user, USER);
  assert.equal(fa.actions[0].envelope.via, 'hub');
  assert.equal(fa.actions[0].verified, true);
  // The hub's own chain recorded it (sent + done), served with reconciliation state.
  const aud = await ingressFetch(hub, '/api/fleet/audit?builder=builder-a', { user: USER });
  assert.equal(aud.status, 200);
  assert.ok(aud.json().entries.some((e) => e.action === 'send-text'), aud.text.slice(0, 500));

  // The same action on the local listener: 403 remote-only, nothing sent.
  const local = await localFetch(hub, '/api/fleet/actions', { method: 'POST', headers: { 'x-laneboard': '1' }, body: action });
  assert.equal(local.status, 403);
  assert.equal(local.json().reason, 'remote-only');
  assert.equal(fa.actions.length, 1);
  const rebaseLocal = await localFetch(hub, '/api/fleet/audit/rebase', { method: 'POST', headers: { 'x-laneboard': '1' }, body: { builder: 'builder-a' } });
  assert.equal(rebaseLocal.status, 403);

  // Placement is a dry run: local may ask.
  const place = await localFetch(hub, '/api/fleet/placement', { method: 'POST', headers: { 'x-laneboard': '1' }, body: {} });
  assert.equal(place.status, 200, place.text);
  assert.ok(Array.isArray(place.json().ranked));

  // Terminals: local listener -> 403 (remote-only); through serve it opens.
  const localTerm = new WebSocket(`ws://127.0.0.1:${hub.port}/ws/term/builder-a/${encodeURIComponent(name)}`, { origin: `http://127.0.0.1:${hub.port}` });
  assert.equal((await wsOutcome(localTerm)).status, 403);
  const term = ingressWs(hub, `/ws/term/builder-a/${encodeURIComponent(name)}?cols=80&rows=24`, { user: USER });
  assert.equal((await wsOutcome(term)).open, true);
  assert.equal(fa.terms.length, 1);
  assert.equal(fa.terms[0].envelope.user, USER);
  term.close();

  // --- web baseline on the hub (SECURITY-FIXES S10) ---
  assert.equal((await ingressFetch(hub, '/', { user: USER, method: 'OPTIONS' })).status, 405);
  assert.equal((await localFetch(hub, '/api/fleet', { method: 'OPTIONS' })).status, 405);
  const noCsrf = await ingressFetch(hub, '/api/fleet/placement', { user: USER, method: 'POST', body: {} });
  assert.equal(noCsrf.status, 403);
  const noCsrfAction = await ingressFetch(hub, '/api/fleet/actions', { user: USER, method: 'POST', body: action });
  assert.equal(noCsrfAction.status, 403);
  assert.equal(fa.actions.length, 1);
  assert.equal((await ingressFetch(hub, '/api/fleet', { user: USER, headers: { host: 'evil.example.invalid:8443' } })).status, 403);
  assert.equal((await ingressFetch(hub, '/api/fleet', { user: USER, headers: { host: 'hub.example.invalid' } })).status, 403);
  assert.equal((await localFetch(hub, '/api/fleet', { headers: { host: 'evil.example.invalid' } })).status, 403);
  const index = await ingressFetch(hub, '/', { user: USER });
  assert.equal(index.status, 200);
  const csp = String(index.headers['content-security-policy'] ?? '');
  for (const d of ["object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "script-src 'self'"]) {
    assert.ok(csp.includes(d), `CSP lacks ${d}: ${csp}`);
  }
  // A signed `hub`-kind request is refused on a hub, read or write.
  const signer = hubSigner(hubKey);
  const signedRead = await ingressFetch(hub, '/api/fleet', { user: null, headers: signer.readHeaders('GET', 'builder-a', '/api/fleet') });
  assert.equal(signedRead.status, 403);
  const signedAction = await ingressFetch(hub, '/api/fleet/actions', {
    user: null, method: 'POST', headers: { 'x-laneboard': '1', ...signer.readHeaders('POST', 'builder-a', '/api/fleet/actions') }, body: action,
  });
  assert.equal(signedAction.status, 403);
  assert.equal(fa.actions.length, 1);

  // --- liveness: kill builder-b; stale within staleMs, then down within downMs ---
  const killedAt = Date.now();
  await fb.close();
  let staleAt = null;
  let downAt = null;
  await waitFor(async () => {
    const b = (await localFetch(hub, '/api/fleet')).json().builders.find((x) => x.id === 'builder-b');
    if (b.state === 'stale' && staleAt === null) staleAt = Date.now();
    if (b.state === 'down') { downAt = Date.now(); return true; }
    return false;
  }, { everyMs: 25, timeoutMs: 6000, what: 'builder-b down' });
  assert.ok(staleAt !== null, 'builder-b went straight from up to down');
  assert.ok(staleAt - killedAt < 300 + 1000, `stale after ${staleAt - killedAt} ms`);
  assert.ok(downAt - killedAt < 900 + 1000, `down after ${downAt - killedAt} ms`);
  const dead = (await localFetch(hub, '/api/fleet')).json().builders.find((x) => x.id === 'builder-b');
  assert.equal(dead.controls, false);
  // The last snapshot is still served, flagged stale.
  const old = (await localFetch(hub, '/api/fleet/builder-b/snapshot')).json();
  assert.equal(old.stale, true);
  assert.ok(old.sessions.length > 0);

  // An action to the down builder: 503 builder down, nothing sent or queued.
  const down = await ingressFetch(hub, '/api/fleet/actions', {
    user: USER, method: 'POST', headers: { 'x-laneboard': '1' }, body: { ...action, builder: 'builder-b' },
  });
  assert.equal(down.status, 503, down.text);
  assert.equal(down.json().error, 'builder down');
  assert.equal((await ingressFetch(hub, '/api/fleet/builder-b/v1/hello', { user: USER })).status, 503);
  const hz2 = await (await fetch(`${hub.url}/healthz`)).json();
  assert.deepEqual(hz2.builders, { up: 1, stale: 0, down: 1 });

  // --- the hub process never loaded the builder graph or node-pty ---
  const loaded = loadedPaths(hub);
  assert.ok(loaded.includes('server/boot/hub.mjs'));
  assert.ok(loaded.includes('server/hub/routes/core.mjs'), 'hub routes were loaded');
  for (const p of loaded) {
    for (const bad of ['server/state.mjs', 'server/terminals.mjs', 'server/ws.mjs', 'server/actions.mjs', 'server/push.mjs', 'server/boot/builder.mjs']) {
      assert.notEqual(p, bad, `hub loaded ${bad}`);
    }
    assert.ok(!p.startsWith('server/routes/') && !p.startsWith('server/flags/') && !p.startsWith('server/collector/'), `hub loaded builder module ${p}`);
    assert.ok(!p.includes('node_modules/node-pty/'), `hub loaded node-pty (${p})`);
  }
  assert.ok(!hub.loadedUrls().some((u) => /(^|\/)node-pty(\/|$)/.test(u)), 'hub resolved node-pty');

  // Clean shutdown on SIGTERM.
  hub.child.kill('SIGTERM');
  const [code] = await once(hub.child, 'exit');
  assert.equal(code, 0, hub.logs().slice(-2000));
  assert.ok(!/unhandledRejection|uncaughtException/.test(hub.logs()), hub.logs().slice(-2000));
});

test('a hub refuses to boot without its key or with a loose key file', { timeout: 30_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-hubkey-'));
  fs.chmodSync(dir, 0o700);
  try {
    const cfg = (file) => ({ fleet: { builders: [{ id: 'builder-a', url: 'http://127.0.0.1:9' }], hubKeyFile: file } });
    await assert.rejects(boot({ mode: 'hub', config: cfg(path.join(dir, 'missing.key')) }), /cannot load the hub key/);
    const loose = path.join(dir, 'loose.key');
    writePrivateKey(loose, generateHubKey().privateKey);
    fs.chmodSync(loose, 0o644);
    await assert.rejects(boot({ mode: 'hub', config: cfg(loose) }), /cannot load the hub key[^\n]*chmod 600/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- supply-chain canary (SECURITY-FIXES S1, S21) ------------------------------------------------------

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|cjs)$/.test(e.name) || path.basename(d) === 'bin') out.push(p);
    }
  };
  walk(dir);
  return out;
}

test('canary: only the hub transport modules use the signers; the key is loaded only by the hub boot', () => {
  const files = ['server', 'bin', 'public'].flatMap((d) => sourceFiles(path.join(ROOT, d)));
  assert.ok(files.length > 50, 'the scan found too few files');
  const rel = (p) => path.relative(ROOT, p);
  const signers = /\b(signEnvelope|signRead|signedReadString|termHeaders|actionHeaders)\b/;
  const allowed = new Set([
    'server/fleet/auth.mjs', // defines them
    'server/hub/relay.mjs', 'server/hub/upstream.mjs', 'server/hub/term-proxy.mjs', 'server/hub/read-proxy.mjs',
    'server/hub/broadcast.mjs', 'server/hub/fleetkill.mjs',
  ]);
  const users = files.filter((f) => signers.test(fs.readFileSync(f, 'utf8'))).map(rel);
  for (const u of users) assert.ok(allowed.has(u), `${u} uses a hub signer; only ${[...allowed].join(', ')} may`);
  // The raw Ed25519 sign primitive: auth.mjs only.
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (/import\s*\{[^}]*\bsign\b[^}]*\}\s*from\s*['"][^'"]*keys-ed25519\.mjs['"]/.test(src)) {
      assert.equal(rel(f), 'server/fleet/auth.mjs', `${rel(f)} imports the raw sign()`);
    }
    if (/\bloadPrivateKey\s*\(/.test(src) && rel(f).startsWith('server/')) {
      assert.ok(['server/boot/hub.mjs', 'server/fleet/keys-ed25519.mjs'].includes(rel(f)), `${rel(f)} loads the hub key`);
    }
  }
});

test('canary: no TLS verification bypass anywhere', () => {
  const files = ['server', 'bin', 'public', 'deploy'].filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => sourceFiles(path.join(ROOT, d)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/rejectUnauthorized/.test(src), `${path.relative(ROOT, f)} mentions rejectUnauthorized`);
    // deploy/push-selftest.mjs is a standalone self-test talking TLS to itself; nothing loads it.
    if (path.relative(ROOT, f) === 'deploy/push-selftest.mjs') continue;
    assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(src), `${path.relative(ROOT, f)} touches NODE_TLS_REJECT_UNAUTHORIZED`);
  }
});

test('aggregates keeps the same freshest() rule as collector/ratelimits.mjs', () => {
  const body = (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = /function freshest\(sessions\) \{[\s\S]*?\n\}/.exec(src);
    assert.ok(m, `no freshest() in ${file}`);
    return m[0];
  };
  assert.equal(body('server/hub/aggregates.mjs'), body('server/collector/ratelimits.mjs'));
  assert.ok(!/collector\//.test(fs.readFileSync(path.join(ROOT, 'server/hub/aggregates.mjs'), 'utf8').split('\n').filter((l) => l.startsWith('import')).join('\n')));
});

// --- the services hook (§3 2.9) ------------------------------------------------------------------------

test('services: a dummy service sees store changes and its broadcast reaches a hub client', async (t) => {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://builder-a.example.invalid' }], hubVersion: '0.1.0' });
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const cw = createClientWs({ store, config: { port, fleet: { ingressPort: null, batchMs: 50 } }, version: '0.1.0', log: silentLog });
  server.on('upgrade', (req, socket, head) => cw.handleUpgrade(req, socket, head));
  t.after(async () => { cw.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });

  const services = createServices({ log: silentLog });
  const seen = [];
  let stopped = 0;
  // A hub module would do this from register(ctx).
  services.register({
    name: 'dummy',
    start(ctx) {
      const unsub = ctx.store.subscribe((ev) => {
        seen.push(ev.kind);
        ctx.broadcast({ type: 'dummy', builder: ev.builder, kind: ev.kind });
      });
      return () => { stopped++; unsub(); };
    },
  });
  const started = await services.startAll({ store, broadcast: (m) => cw.broadcast(m), config: {}, now: Date.now });
  assert.deepEqual(started, ['dummy']);

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
  const got = new Promise((resolve) => client.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'dummy') resolve(m);
  }));
  assert.equal((await wsOutcome(client)).open, true);
  store.setConn('builder-a', { state: 'up', lastSeen: Date.now(), hello: { version: '0.1.0', apiVersion: 1, capabilities: [] } });
  store.applySnapshot('builder-a', { type: 'snapshot', seq: 1, sessions: [{ name: 'one', state: 'idle' }], lanes: [], attention: [] }, Date.now());
  const msg = await got;
  assert.equal(msg.builder, 'builder-a');
  assert.ok(seen.includes('snapshot'));
  client.close();

  await services.stopAll();
  assert.equal(stopped, 1);
  const n = seen.length;
  store.applySnapshot('builder-a', { type: 'snapshot', seq: 2, sessions: [], lanes: [], attention: [] }, Date.now());
  assert.equal(seen.length, n, 'a stopped service still sees the store');
});

test('services: names are unique, a failing start is skipped, stops run newest first, late registration starts', async () => {
  const s = createServices({ log: silentLog });
  const order = [];
  s.register({ name: 'a', start: () => () => order.push('stop a') });
  assert.throws(() => s.register({ name: 'a', start() {} }), ServiceError);
  assert.throws(() => s.register({ name: '', start() {} }), ServiceError);
  assert.throws(() => s.register({ name: 'x' }), ServiceError);
  s.register({ name: 'broken', start() { throw new Error('boom'); } });
  s.register({ name: 'b', start: async () => () => { order.push('stop b'); throw new Error('stop failure is swallowed'); } });
  let ctxSeen = null;
  s.register({ name: 'c', start: (ctx) => { ctxSeen = ctx; } });
  const ok = await s.startAll({ store: 'S', broadcast: () => {} });
  assert.deepEqual(ok, ['a', 'b', 'c']);
  assert.equal(ctxSeen.store, 'S');
  assert.ok(Object.isFrozen(ctxSeen));
  await assert.rejects(s.startAll({}), ServiceError);
  let late = null;
  await s.register({ name: 'late', start: (ctx) => { late = ctx; return () => order.push('stop late'); } });
  assert.equal(late.store, 'S');
  assert.deepEqual(s.running(), ['a', 'b', 'c', 'late']);
  await s.stopAll();
  assert.deepEqual(order, ['stop late', 'stop b', 'stop a']);
  assert.throws(() => s.register({ name: 'after', start() {} }), ServiceError);
});

// --- core module helpers -------------------------------------------------------------------------------

test('core: BuilderRow, health counts, remote-only predicate, push subscription check', () => {
  const b = { id: 'builder-a', code: 'BA', directUrl: 'https://a.example.invalid', state: 'up', ageMs: 5, conn: { latencyMs: 12 }, hello: { version: '0.1.0', capabilities: ['term'] }, versionSkew: 'same' };
  assert.deepEqual(builderRow(b), {
    id: 'builder-a', code: 'BA', directUrl: 'https://a.example.invalid', state: 'up', ageMs: 5, latencyMs: 12,
    version: '0.1.0', versionSkew: 'same', controls: true, capabilities: ['term'],
  });
  assert.equal(builderRow({ ...b, versionSkew: 'major' }).controls, false);
  assert.equal(builderRow({ ...b, state: 'stale' }).controls, false);
  assert.deepEqual(healthCounts({ builders: [{ state: 'up' }, { state: 'stale' }, { state: 'connecting' }, { state: 'misconfigured' }] }), { up: 1, stale: 1, down: 2 });

  assert.equal(isRemoteUser({ kind: 'direct', user: USER }), true);
  assert.equal(isRemoteUser({ kind: 'direct', user: USER, readOnly: true }), false);
  assert.equal(isRemoteUser({ kind: 'direct', user: 'local' }), false);
  assert.equal(isRemoteUser({ kind: 'local', user: 'local' }), false);
  assert.equal(isRemoteUser({ kind: 'hub', user: null }), false);
  assert.equal(isRemoteUser(USER), false);

  const sub = { endpoint: 'https://push.example.invalid/abc', keys: { p256dh: 'BPk-x_y', auth: 'aa_bb' }, expirationTime: null, extra: 1 };
  assert.deepEqual(checkSubscription(sub), { endpoint: 'https://push.example.invalid/abc', keys: { p256dh: 'BPk-x_y', auth: 'aa_bb' }, expirationTime: null });
  assert.equal(checkSubscription({ ...sub, endpoint: 'http://push.example.invalid/abc' }), null);
  assert.equal(checkSubscription({ ...sub, endpoint: 'https://u:p@push.example.invalid/' }), null);
  assert.equal(checkSubscription({ ...sub, keys: { p256dh: '<x>', auth: 'a' } }), null);
  assert.equal(checkSubscription({ endpoint: 'https://push.example.invalid/' }), null);
  assert.equal(checkSubscription('nope'), null);
});

test('core: hub push keeps VAPID keys in kv and sends only through the sender', async () => {
  const kv = new Map();
  const subs = new Map();
  const db = {
    kvRead: (k, f) => (kv.has(k) ? kv.get(k) : f), kvWrite: (k, v) => kv.set(k, v),
    addSubscription: (s) => subs.set(s.endpoint, s), removeSubscription: (e) => subs.delete(e),
    listSubscriptions: () => [...subs.values()].map((s) => ({ endpoint: s.endpoint, sub: s })), markSubscriptionOk() {},
  };
  let generated = 0;
  const webpush = { generateVAPIDKeys: () => { generated++; return { publicKey: 'PUB', privateKey: 'PRIV' }; } };
  const p = createHubPush({ db, webpush });
  assert.equal(p.publicKey(), 'PUB');
  assert.equal(p.publicKey(), 'PUB');
  assert.equal(generated, 1);
  assert.deepEqual(kv.get('push.vapid'), { publicKey: 'PUB', privateKey: 'PRIV' });
  assert.equal(createHubPush({ db, webpush }).publicKey(), 'PUB', 'a restart reuses the stored keys');
  assert.equal(generated, 1);
  assert.deepEqual(await p.broadcast({ title: 't' }), { sent: 0, subscribers: 0, error: 'no sender' });
  const sentPayloads = [];
  p.setSender(async (payload) => { sentPayloads.push(payload); return { sent: 1, subscribers: 1 }; });
  assert.deepEqual(await p.broadcast({ title: 't' }), { sent: 0, subscribers: 0 }, 'no subscribers: nothing sent');
  p.subscribe({ endpoint: 'https://push.example.invalid/1', keys: {} });
  assert.equal(p.count(), 1);
  assert.deepEqual(await p.broadcast({ title: 't' }), { sent: 1, subscribers: 1 });
  assert.deepEqual(sentPayloads, [{ title: 't' }]);
});

test('core: the view cache computes one view per window and after a change', () => {
  let views = 0;
  let listener = null;
  let t = 1000;
  const store = { view: (now) => { views++; return { now, builders: [] }; }, subscribe: (fn) => { listener = fn; return () => { listener = null; }; } };
  const c = createViewCache({ store, now: () => t, maxAgeMs: 100 });
  c.get(); c.get(); c.get();
  assert.equal(views, 1);
  t += 50;
  c.get();
  assert.equal(views, 1);
  listener({ kind: 'delta' });
  c.get();
  assert.equal(views, 2);
  t += 100;
  c.get();
  assert.equal(views, 3);
  c.close();
  assert.equal(listener, null);
});

test('core: the map loop ticks on a debounce after store changes and on the interval, with the packages merge', () => {
  const timers = {
    queue: [], intervals: [],
    setTimeout(fn, ms) { const h = { fn, ms }; this.queue.push(h); return h; },
    clearTimeout(h) { this.queue = this.queue.filter((x) => x !== h); },
    setInterval(fn, ms) { const h = { fn, ms }; this.intervals.push(h); return h; },
    clearInterval(h) { this.intervals = this.intervals.filter((x) => x !== h); },
    runTimeouts() { const q = this.queue; this.queue = []; for (const h of q) h.fn(); },
  };
  let listener = null;
  const store = { subscribe: (fn) => { listener = fn; return () => { listener = null; }; } };
  const inputs = [];
  const sent = [];
  let next = { type: 'map', map: { nodes: ['n'] } };
  const loop = createMapLoop({
    store, view: () => ({ now: 1, builders: [{ id: 'builder-a' }] }), now: () => 1, timers,
    toMapFleet: (v) => ({ builders: v.builders.map((b) => ({ id: b.id })) }),
    tickFleet: (fleet) => { inputs.push(fleet); const m = next; next = null; return m; },
    send: (m) => sent.push(m),
  });
  loop.start();
  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.intervals[0].ms, 5000);
  assert.equal(timers.queue.length, 1, 'a first tick is scheduled at start');
  assert.equal(timers.queue[0].ms, 1000);
  listener({ kind: 'delta' });
  listener({ kind: 'delta' });
  assert.equal(timers.queue.length, 1, 'changes inside the debounce coalesce');
  timers.runTimeouts();
  assert.equal(inputs.length, 1);
  assert.deepEqual(sent, [{ nodes: ['n'] }]);
  loop.setPackages({ repos: [{ name: 'acme' }], edges: [{ a: 'builder-a/x', b: 'builder-a/y', kind: 'textual' }] });
  timers.runTimeouts();
  assert.deepEqual(inputs[1].repos, [{ name: 'acme' }]);
  assert.equal(inputs[1].edges.length, 1);
  assert.equal(sent.length, 1, 'a null tick result sends nothing');
  timers.intervals[0].fn();
  assert.equal(inputs.length, 3);
  loop.stop();
  assert.equal(timers.intervals.length, 0);
  assert.equal(listener, null);
});
