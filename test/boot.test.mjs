// Boot tests and the self-tests of the fleet test kit (fleet plan §11 X2):
// test/helpers/boot.mjs boots a real laneboard in an isolated child process,
// test/helpers/fake-builder.mjs speaks Builder API v1 in-process.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { boot, freePort, ingressFetch, ingressWs, ROOT } from './helpers/boot.mjs';
import { fakeBuilder, hubSigner } from './helpers/fake-builder.mjs';
import { bootErrorLine, listenPorts } from '../server/boot/common.mjs';
import { publicKeyString, publicKeyPem } from '../server/fleet/keys-ed25519.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8'));

function environOf(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
  return Object.fromEntries(raw.split('\0').filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), kv.slice(i + 1)];
  }));
}

/** Repo-relative paths of the server/ and node_modules/ files a traced child resolved. */
function loadedPaths(booted) {
  return booted.loadedUrls()
    .filter((u) => u.startsWith('file:'))
    .map((u) => fileURLToPath(u))
    .filter((p) => p.startsWith(ROOT))
    .map((p) => p.slice(ROOT.length + 1));
}

// --- boot.mjs -------------------------------------------------------------------

test('freePort never hands out the live port, stays >= 7790 and does not repeat', async () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const p = await freePort();
    assert.ok(p >= 7790, `port ${p} is below 7790`);
    assert.notEqual(p, 7777);
    assert.ok(!seen.has(p), `port ${p} handed out twice`);
    seen.add(p);
  }
});

test('a builder with no config boots isolated: /healthz ok, root page 200, collectors loaded', async () => {
  const b = await boot({ trace: true });
  try {
    assert.ok(b.port >= 7790 && b.port !== 7777);
    assert.equal(b.configFile, null, 'no config means no config file');
    assert.equal(b.ingressPort, null);

    const h = await (await fetch(`${b.url}/healthz`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.pid, b.pid);
    assert.notEqual(h.mode, 'hub');

    const root = await fetch(`${b.url}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await root.text(), /<html/i);

    // The isolation is what keeps a test away from the live board: check the
    // child's real environment, not what the helper meant to pass.
    const env = environOf(b.pid);
    assert.equal(env.TMUX, undefined, 'TMUX would point tmux at the live server');
    assert.equal(env.TMUX_PANE, undefined);
    for (const k of ['HOME', 'TMUX_TMPDIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LANEBOARD_STATE_DIR', 'LANEBOARD_AUDIT_FILE', 'LANEBOARD_CONFIG']) {
      assert.ok(env[k]?.startsWith(b.tmp + '/'), `${k}=${env[k]} is outside the temp dir`);
    }
    assert.equal(env.LANEBOARD_DB, ':memory:');
    assert.equal(env.LANEBOARD_PORT, String(b.port));

    // Positive control for the hub assertion below: the trace sees a builder's graph.
    const loaded = loadedPaths(b);
    assert.ok(loaded.includes('server/state.mjs'), 'a builder loads server/state.mjs');
    assert.ok(loaded.includes('server/terminals.mjs'), 'a builder loads server/terminals.mjs');
  } finally {
    await b.stop();
  }
});

test('POST /api/runs/events through the real guards: no x-laneboard or a foreign Origin is a 403 (runs T10)', async () => {
  const b = await boot();
  try {
    const post = (headers, run) => fetch(`${b.url}/api/runs/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ t: 'run.start', run, goal: 'probe' }),
    });
    const refused = [
      [{}, 'no x-laneboard'],
      [{ 'x-laneboard': '1', origin: 'https://evil.example.invalid' }, 'a foreign Origin'],
      [{ origin: 'https://evil.example.invalid' }, 'a foreign Origin and no x-laneboard'],
    ];
    for (const [headers, why] of refused) {
      const r = await post(headers, 'refused');
      assert.equal(r.status, 403, why);
      await r.body?.cancel();
    }
    // Positive control: the same body with the header and no Origin is taken.
    const ok = await post({ 'x-laneboard': '1' }, 'taken');
    assert.equal(ok.status, 201, await ok.clone().text());
    assert.equal((await ok.json()).run, 'taken');
    assert.equal((await fetch(`${b.url}/api/runs/taken`)).status, 200);
    assert.equal((await fetch(`${b.url}/api/runs/refused`)).status, 404, 'a refused event was written');
  } finally {
    await b.stop();
  }
});

test('stop() kills the process group, frees the port and removes the temp dir', async () => {
  const b = await boot();
  await b.stop();
  assert.ok(b.child.exitCode !== null || b.child.signalCode !== null, 'child still running');
  assert.throws(() => process.kill(b.pid, 0), /ESRCH/);
  assert.equal(fs.existsSync(b.tmp), false, 'temp dir left behind');
  await assert.rejects(fetch(`${b.url}/healthz`));
  await b.stop(); // idempotent
});

test('boot refuses the live port and a non-memory database', async () => {
  await assert.rejects(boot({ env: { LANEBOARD_PORT: '7777' } }), /7777/);
  await assert.rejects(boot({ env: { LANEBOARD_DB: '/tmp/x.db' } }), /:memory:/);
  await assert.rejects(boot({ env: { TMUX: '/tmp/tmux-0/default,1,0' } }), /TMUX/);
});

test('a busy port: one line naming the port and LANEBOARD_PORT, no stack, non-zero exit', async () => {
  const port = await freePort();
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(port, '127.0.0.1', resolve));
  try {
    const err = await boot({ env: { LANEBOARD_PORT: String(port) } }).then(() => null, (e) => e);
    assert.ok(err, 'laneboard booted on a taken port');
    assert.equal(err.exited, true, err.message);
    assert.match(err.message, /laneboard exited \(1\)/);
    const line = `laneboard: port ${port} is taken (is another laneboard running? set LANEBOARD_PORT or config.port)`;
    assert.equal(err.message.split('\n').filter((l) => l.includes(line)).length, 1, err.message);
    assert.doesNotMatch(err.message, /uncaughtException|EADDRINUSE|^\s+at /m);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('listenPorts binds the ingress port before the main one, so /healthz never answers half-bound', () => {
  assert.deepEqual(listenPorts({ port: 7790, fleet: { ingressPort: 7791 } }),
    [{ port: 7791, ingress: true }, { port: 7790, ingress: false }]);
  assert.deepEqual(listenPorts({ port: 7790, fleet: {} }), [{ port: 7790, ingress: false }]);
  assert.deepEqual(listenPorts({ port: 7790, fleet: { ingressPort: 7790 } }), [{ port: 7790, ingress: false }]);
});

test('bootErrorLine: one line for a busy port (local or ingress) and a held audit lock, null otherwise', () => {
  const inUse = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE', port: 7791 });
  assert.equal(bootErrorLine(inUse), 'laneboard: port 7791 is taken (is another laneboard running? set LANEBOARD_PORT or config.port)');
  assert.equal(bootErrorLine(inUse, { port: 7792, ingress: true }),
    'laneboard: port 7792 is taken (is another laneboard running? set LANEBOARD_INGRESS_PORT or fleet.ingressPort)');
  const locked = Object.assign(new Error('audit: /s/audit.jsonl.lock is held by pid 42 on h; only one writer may open '
    + 'the audit log (set LANEBOARD_AUDIT_FILE to a private path for a second instance, or remove the lock if that writer is gone)'),
  { code: 'AUDIT_LOCKED' });
  const l = bootErrorLine(locked);
  assert.equal(l, `laneboard: ${locked.message}`);
  assert.ok(!l.includes('\n'));
  const bare = Object.assign(new Error('audit: lost the race for /s/audit.jsonl.lock to another writer'), { code: 'AUDIT_LOCKED' });
  assert.match(bootErrorLine(bare), /^laneboard: audit: lost the race .*LANEBOARD_AUDIT_FILE or XDG_STATE_HOME/);
  assert.equal(bootErrorLine(new Error('boom')), null);
  assert.equal(bootErrorLine(Object.assign(new Error('x'), { code: 'EACCES' })), null);
});

test('a hub with one unreachable builder boots and never loads the builder graph', async () => {
  const b = await boot({
    mode: 'hub',
    config: { fleet: { builders: [{ id: 'builder-a', url: 'http://127.0.0.1:9' }] } },
    trace: true,
  });
  try {
    assert.ok(b.ingressPort >= 7790 && b.ingressPort !== b.port, 'a free fleet.ingressPort was assigned');
    assert.equal(b.config.mode, 'hub');
    const h = await (await fetch(`${b.url}/healthz`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.mode, 'hub');

    const urls = b.loadedUrls();
    assert.ok(urls.length > 0, 'the trace recorded nothing');
    const loaded = loadedPaths(b);
    assert.ok(loaded.includes('server/boot/hub.mjs'), 'the trace should see the hub boot path');
    for (const p of loaded) {
      assert.notEqual(p, 'server/state.mjs', 'hub loaded server/state.mjs');
      assert.notEqual(p, 'server/terminals.mjs', 'hub loaded server/terminals.mjs');
      assert.notEqual(p, 'server/boot/builder.mjs', 'hub loaded the builder boot path');
      assert.ok(!p.startsWith('server/routes/'), `hub loaded builder module ${p}`);
      assert.ok(!p.startsWith('server/flags/'), `hub loaded builder flag ${p}`);
      assert.ok(!p.startsWith('server/collector/'), `hub loaded collector ${p}`);
      assert.ok(!p.includes('node_modules/node-pty/'), `hub loaded node-pty (${p})`);
    }
    assert.ok(!urls.some((u) => /(^|\/)node-pty(\/|$)/.test(u)), 'hub resolved node-pty');
  } finally {
    await b.stop();
  }
});

test('ingressFetch and ingressWs send exactly what tailscale serve adds', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { seen.at(-1).body = body; res.end('{"ok":true}'); });
  });
  srv.on('upgrade', (req, socket) => {
    seen.push({ method: 'UPGRADE', url: req.url, headers: req.headers });
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const booted = { ingressPort: srv.address().port, publicHost: 'hub.example.invalid:8443' };
  try {
    const r = await ingressFetch(booted, '/api/fleet?x=1');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { ok: true });
    let h = seen[0].headers;
    assert.equal(seen[0].url, '/api/fleet?x=1');
    assert.equal(h.host, 'hub.example.invalid:8443');
    assert.equal(h['x-forwarded-host'], 'hub.example.invalid:8443');
    assert.equal(h['x-forwarded-for'], '127.0.0.1');
    assert.equal(h['x-forwarded-proto'], 'https');
    assert.equal(h['tailscale-user-login'], 'tester@example.invalid');

    await ingressFetch(booted, '/api/fleet/actions', {
      method: 'POST', user: 'someone@example.invalid', headers: { 'X-Laneboard': '1' }, body: { action: 'kill' },
    });
    h = seen[1].headers;
    assert.equal(seen[1].method, 'POST');
    assert.equal(h['tailscale-user-login'], 'someone@example.invalid');
    assert.equal(h['x-laneboard'], '1');
    assert.equal(h['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(seen[1].body), { action: 'kill' });

    await ingressFetch(booted, '/healthz', { user: null });
    assert.equal(seen[2].headers['tailscale-user-login'], undefined, 'user:null = a tagged node, no user header');
    assert.equal(seen[2].headers['x-forwarded-for'], '127.0.0.1');

    const ws = ingressWs(booted, '/ws');
    const [, res] = await once(ws, 'unexpected-response');
    assert.equal(res.statusCode, 403);
    h = seen[3].headers;
    assert.equal(seen[3].method, 'UPGRADE');
    assert.equal(h.host, 'hub.example.invalid:8443');
    assert.equal(h.origin, 'https://hub.example.invalid:8443');
    assert.equal(h['tailscale-user-login'], 'tester@example.invalid');
    assert.equal(h['x-forwarded-proto'], 'https');

    assert.throws(() => ingressFetch({ ingressPort: null }, '/x'), /ingressPort/);
  } finally {
    srv.close();
  }
});

// --- fake-builder.mjs -----------------------------------------------------------------

const keys = (n) => Array.from({ length: n }, () => crypto.generateKeyPairSync('ed25519').privateKey);

async function withFake(opts, fn) {
  const fb = await fakeBuilder(opts);
  try { return await fn(fb); } finally { await fb.close(); }
}

const getJson = async (url, headers = {}) => {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.json() };
};

test('fake builder: hello and a snapshot re-keyed to its id, previews as previewLines only', async () => {
  await withFake({ id: 'builder-b' }, async (fb) => {
    const { status, body: hello } = await getJson(`${fb.url}/api/v1/hello`);
    assert.equal(status, 200);
    assert.equal(hello.id, 'builder-b');
    assert.equal(hello.apiVersion, 1);
    assert.equal(hello.mode, 'builder');
    assert.equal(typeof hello.code, 'string');
    assert.ok(hello.capabilities.includes('stream'));
    assert.equal(hello.actions.kill, 'confirm');
    assert.deepEqual(hello.auth, { kind: 'local' });

    const { body: snap } = await getJson(`${fb.url}/api/v1/snapshot`);
    assert.deepEqual(snap.builder, { id: 'builder-b', code: hello.code });
    assert.equal(snap.seq, 0);
    assert.equal(typeof snap.epoch, 'string');
    assert.equal(snap.sessions.length, fixture.sessions.length);
    for (const s of snap.sessions) {
      assert.equal(s.key, `builder-b/${s.name}`);
      assert.equal(s.builder, 'builder-b');
      assert.equal('preview' in s, false);
      assert.equal('previewHtml' in s, false);
      assert.ok(Array.isArray(s.previewLines) && s.previewLines.length <= 8);
      assert.ok(s.previewLines.every((l) => l.length <= 400));
    }
    for (const a of snap.attention) assert.equal(a.key, `builder-b/${a.name}`);
  });
});

test('fake builder: `sessions` names replace the fixture sessions', async () => {
  await withFake({ sessions: ['alpha', { name: 'beta', state: 'working' }] }, async (fb) => {
    const { body } = await getJson(`${fb.url}/api/v1/snapshot`);
    assert.deepEqual(body.sessions.map((s) => s.key), ['builder-a/alpha', 'builder-a/beta']);
    assert.equal(body.sessions[1].state, 'working');
  });
});

/** Open the v1 stream and collect frames. */
async function openStream(fb, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${fb.port}/api/v1/stream`, { headers });
  const frames = [];
  const waiters = [];
  ws.on('message', (d) => {
    frames.push(JSON.parse(String(d)));
    for (const w of waiters.splice(0)) w();
  });
  await once(ws, 'open');
  const next = async (n) => {
    while (frames.length < n) await new Promise((r) => waiters.push(r));
    return frames.slice(0, n);
  };
  return { ws, frames, next };
}

test('fake builder stream: snapshot first, stamped pushes, gaps, drops, resync replay', async () => {
  await withFake({}, async (fb) => {
    const s = await openStream(fb);
    const [snap] = await s.next(1);
    assert.equal(snap.type, 'snapshot');
    assert.equal(snap.builder, 'builder-a');
    assert.equal(snap.seq, 0);
    assert.equal(snap.epoch, fb.epoch);

    fb.push({ type: 'delta', sessions: [] });
    let f = await s.next(2);
    assert.deepEqual([f[1].type, f[1].seq, f[1].builder, f[1].epoch], ['delta', 1, 'builder-a', fb.epoch]);

    fb.script.gap(2);
    fb.push({ type: 'event', event: {} });
    f = await s.next(3);
    assert.equal(f[2].seq, 4, 'a gap skips seq numbers');

    fb.script.drop(1);
    fb.push({ type: 'delta', n: 5 }); // stamped 5, not sent
    fb.push({ type: 'delta', n: 6 });
    f = await s.next(4);
    assert.equal(f[3].seq, 6, 'a dropped frame leaves a hole the receiver sees');

    s.ws.send(JSON.stringify({ type: 'resync', fromSeq: 4 }));
    f = await s.next(6);
    assert.deepEqual(f.slice(4).map((x) => x.seq), [5, 6], 'resync replays fromSeq+1..now');

    s.ws.send(JSON.stringify({ type: 'resync', fromSeq: -50 }));
    f = await s.next(7);
    assert.equal(f[6].type, 'snapshot', 'a resync the ring cannot serve gets a fresh snapshot');
    assert.equal(f[6].seq, 6);

    s.ws.send(JSON.stringify({ type: 'visible', keys: ['builder-a/alpha'] }));
    s.ws.send(JSON.stringify({ type: 'ping' }));
    f = await s.next(8);
    assert.equal(f[7].type, 'pong');
    assert.deepEqual(fb.received.find((m) => m.type === 'visible'), { type: 'visible', keys: ['builder-a/alpha'] });

    fb.script.raw({ type: 'delta', builder: 'builder-z', seq: 7, epoch: fb.epoch });
    f = await s.next(9);
    assert.equal(f[8].builder, 'builder-z', 'raw frames go out unstamped');

    const closed = once(s.ws, 'close');
    fb.script.closeStreams(4000, 'scripted');
    const [code] = await closed;
    assert.equal(code, 4000);
  });
});

test('fake builder: signed reads verify with the pinned key, in the contract order', async () => {
  const [hubKey, otherKey] = keys(2);
  const hub = hubSigner(hubKey);
  const other = hubSigner(otherKey);
  await withFake({ hubKeys: [publicKeyPem(hubKey)] }, async (fb) => {
    const p = '/api/v1/snapshot?x=1';
    let r = await getJson(`${fb.url}${p}`, hub.readHeaders('GET', 'builder-a', p));
    assert.equal(r.status, 200);
    assert.equal(fb.requests.at(-1).kind, 'hub');

    r = await getJson(`${fb.url}/api/v1/hello`, hub.readHeaders('GET', 'builder-a', '/api/v1/hello'));
    assert.deepEqual(r.body.auth, { kind: 'hub' });

    // Replay of the exact same headers.
    const h = hub.readHeaders('GET', 'builder-a', p);
    assert.equal((await getJson(`${fb.url}${p}`, h)).status, 200);
    assert.deepEqual(await getJson(`${fb.url}${p}`, h), { status: 401, body: { ok: false, error: 'replay' } });

    // Signed for another path, another builder, or a stale time.
    assert.equal((await getJson(`${fb.url}${p}`, hub.readHeaders('GET', 'builder-a', '/api/v1/hello'))).status, 401);
    assert.equal((await getJson(`${fb.url}${p}`, hub.readHeaders('GET', 'builder-b', p))).status, 401);
    const stale = await getJson(`${fb.url}${p}`, hub.readHeaders('GET', 'builder-a', p, { ts: Date.now() - 120_000 }));
    assert.deepEqual(stale.body.error, 'stale timestamp');

    // A key that is not pinned.
    assert.deepEqual((await getJson(`${fb.url}${p}`, other.readHeaders('GET', 'builder-a', p))).body.error, 'unknown key');
    assert.equal((await getJson(`${fb.url}${p}`, other.readHeaders('GET', 'builder-a', p))).status, 403);

    // A bad signature never reaches the nonce cache: the same nonce then works when signed properly.
    const nonce = crypto.randomUUID();
    const forged = { ...hub.readHeaders('GET', 'builder-a', p, { nonce }), 'x-laneboard-sig': other.readHeaders('GET', 'builder-a', p, { nonce })['x-laneboard-sig'] };
    assert.deepEqual((await getJson(`${fb.url}${p}`, forged)).body.error, 'bad signature');
    assert.equal((await getJson(`${fb.url}${p}`, hub.readHeaders('GET', 'builder-a', p, { nonce }))).status, 200);

    // Enforcing (keys pinned): no identity at all → 403; a signed request with Origin → 403.
    assert.deepEqual(await getJson(`${fb.url}${p}`), { status: 403, body: { ok: false, error: 'unidentified' } });
    const withOrigin = { ...hub.readHeaders('GET', 'builder-a', p), origin: 'https://hub.example.invalid' };
    assert.equal((await getJson(`${fb.url}${p}`, withOrigin)).status, 403);
    // A user header and a signature → ambiguous.
    const both = { ...hub.readHeaders('GET', 'builder-a', p), 'tailscale-user-login': 'tester@example.invalid' };
    assert.equal((await getJson(`${fb.url}${p}`, both)).status, 400);
    // A user header alone → direct.
    const direct = await getJson(`${fb.url}/api/v1/hello`, { 'tailscale-user-login': 'tester@example.invalid' });
    assert.deepEqual(direct.body.auth, { kind: 'direct' });

    // Every request's headers are recorded.
    assert.ok(fb.headers.some((x) => x['x-laneboard-key'] === hub.keyId && x['x-laneboard-sig']?.startsWith('ed25519 ')));
  });
});

test('fake builder: the stream upgrade takes a read signature; requireServe refuses non-serve requests', async () => {
  const [hubKey] = keys(1);
  const hub = hubSigner(hubKey);
  await withFake({ hubKeys: [publicKeyString(hubKey)], requireServe: true }, async (fb) => {
    const plain = await getJson(`${fb.url}/api/v1/hello`, hub.readHeaders('GET', 'builder-a', '/api/v1/hello'));
    assert.deepEqual(plain, { status: 403, body: { ok: false, error: 'not-from-serve' } });
    const serve = { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' };
    const s = await openStream(fb, { ...serve, ...hub.readHeaders('GET', 'builder-a', '/api/v1/stream') });
    const [snap] = await s.next(1);
    assert.equal(snap.type, 'snapshot');
    assert.equal(fb.requests.at(-1).kind, 'hub');
    s.ws.close();

    const bad = new WebSocket(`ws://127.0.0.1:${fb.port}/api/v1/stream`, { headers: { ...serve, ...hub.readHeaders('GET', 'builder-a', '/api/v1/other') } });
    const [, res] = await once(bad, 'unexpected-response');
    assert.equal(res.statusCode, 401);
  });
});

test('fake builder actions: envelopes recorded and verified, scopes and hubControl enforced', async () => {
  const [ctl, readOnly] = keys(2);
  const hub = hubSigner(ctl);
  const ro = hubSigner(readOnly);
  const seen = [];
  await withFake({
    hubKeys: [{ key: publicKeyString(ctl), id: 'hub', scopes: ['read', 'control'] }, publicKeyString(readOnly)],
    onAction: (env, info) => { seen.push([env.action, info.kind, info.keyId]); return env.action === 'spawn' ? { status: 202, body: { ok: true, result: { job: 'j1' } } } : undefined; },
  }, async (fb) => {
    const post = (env, signer) => fetch(`${fb.url}/api/v1/actions`, { method: 'POST', headers: signer.actionHeaders(env), body: JSON.stringify(env) })
      .then(async (r) => ({ status: r.status, body: await r.json() }));

    const env = hub.envelope({ builder: 'builder-a', action: 'send-text', target: 'alpha', args: { text: 'hi', enter: true } });
    let r = await post(env, hub);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.auditId, 'string');
    assert.equal(fb.actions.length, 1);
    assert.deepEqual(fb.actions[0].envelope, env);
    assert.equal(fb.actions[0].verified, true);
    assert.equal(fb.actions[0].keyId, hub.keyId);
    assert.deepEqual(seen, [['send-text', 'hub', hub.keyId]]);

    // Key order in transit does not matter: the signature is over canonical JSON.
    const env2 = hub.envelope({ builder: 'builder-a', action: 'spawn', target: 'beta', args: { dir: '/tmp' } });
    const reordered = Object.fromEntries(Object.entries(env2).reverse());
    r = await fetch(`${fb.url}/api/v1/actions`, { method: 'POST', headers: hub.actionHeaders(env2), body: JSON.stringify(reordered, null, 2) });
    assert.equal(r.status, 202, 'onAction can answer with its own status');

    assert.deepEqual((await post(env, hub)).body.error, 'replay', 'an envelope id is a nonce');
    assert.deepEqual((await post(hub.envelope({ builder: 'builder-b', action: 'kill', target: 'x' }), hub)).body.error, 'wrong builder');
    const stale = await post(hub.envelope({ builder: 'builder-a', action: 'kill', target: 'x', ts: Date.now() - 300_000 }), hub);
    assert.equal(stale.body.error, 'stale timestamp');
    const roRes = await post(ro.envelope({ builder: 'builder-a', action: 'kill', target: 'x' }), ro);
    assert.deepEqual(roRes, { status: 403, body: { ok: false, error: 'scope-missing' } }, 'a bare-string key is read-only');

    // Tampered body.
    const t = hub.envelope({ builder: 'builder-a', action: 'kill', target: 'x' });
    r = await fetch(`${fb.url}/api/v1/actions`, { method: 'POST', headers: hub.actionHeaders(t), body: JSON.stringify({ ...t, target: 'y' }) });
    assert.equal(r.status, 401);

    // No X-Laneboard: 1.
    const h = hub.actionHeaders(t);
    delete h['x-laneboard'];
    r = await fetch(`${fb.url}/api/v1/actions`, { method: 'POST', headers: h, body: JSON.stringify(t) });
    assert.equal(r.status, 403);

    assert.equal(fb.actions.filter((a) => a.verified).length, 2);
    assert.ok(fb.actions.every((a) => a.status !== null), 'every received action records its outcome');

    // The audit endpoint lists what ran, hash-chained.
    const audit = (await getJson(`${fb.url}/api/v1/audit?since=0`, hub.readHeaders('GET', 'builder-a', '/api/v1/audit?since=0'))).body;
    assert.equal(audit.builder, 'builder-a');
    assert.equal(audit.entries.length, 2);
    assert.equal(audit.entries[1].prevHash, audit.entries[0].hash);
    assert.deepEqual(audit.head, { hash: audit.entries[1].hash, count: 2 });
  });

  await withFake({ hubKeys: [{ key: publicKeyString(ctl), id: 'hub', scopes: ['read', 'control', 'term'] }], hubControl: false }, async (fb) => {
    const env = hub.envelope({ builder: 'builder-a', action: 'interrupt', target: 'alpha' });
    const r = await fetch(`${fb.url}/api/v1/actions`, { method: 'POST', headers: hub.actionHeaders(env), body: JSON.stringify(env) });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'control-disabled');
  });
});

test('fake builder terminals: signed term envelope + term scope echoes; read signatures and missing scope refused', async () => {
  const [termKey, ctlKey] = keys(2);
  const hub = hubSigner(termKey);
  const ctl = hubSigner(ctlKey);
  await withFake({
    sessions: ['alpha'],
    hubKeys: [
      { key: publicKeyString(termKey), id: 'hub', scopes: ['read', 'control', 'term'] },
      { key: publicKeyString(ctlKey), id: 'hub-ctl', scopes: ['read', 'control'] },
    ],
  }, async (fb) => {
    const open = (p, headers) => new WebSocket(`ws://127.0.0.1:${fb.port}${p}`, { headers });
    const refused = async (ws) => (await once(ws, 'unexpected-response'))[1].statusCode;

    const env = hub.envelope({ builder: 'builder-a', action: 'term', target: 'alpha', args: { cols: 500, rows: 40 } });
    const ws = open('/api/v1/term/alpha?cols=900&rows=40', hub.termHeaders(env));
    await once(ws, 'open');
    assert.equal(fb.terms.length, 1);
    assert.equal(fb.terms[0].name, 'alpha');
    assert.deepEqual(fb.terms[0].envelope, env);
    const last = fb.requests.at(-1);
    assert.equal(last.headers['x-laneboard-ts'], undefined, 'a term upgrade carries no read-signature headers');

    ws.send(Buffer.from([0, 1, 2, 255]));
    const [data, isBinary] = await once(ws, 'message');
    assert.equal(isBinary, true);
    assert.deepEqual([...data], [0, 1, 2, 255]);
    ws.send('{"type":"size","cols":80,"rows":24}');
    const [txt, bin2] = await once(ws, 'message');
    assert.equal(bin2, false);
    assert.equal(String(txt), '{"type":"size","cols":80,"rows":24}');
    const closed = once(ws, 'close');
    fb.script.closeTerms(4000);
    assert.equal((await closed)[0], 4000);

    assert.equal(await refused(open('/api/v1/term/alpha', hub.readHeaders('GET', 'builder-a', '/api/v1/term/alpha'))), 403, 'a read signature never opens a terminal');
    const noScope = ctl.envelope({ builder: 'builder-a', action: 'term', target: 'alpha', args: {} });
    assert.equal(await refused(open('/api/v1/term/alpha', ctl.termHeaders(noScope))), 403, 'term needs the term scope');
    const other = hub.envelope({ builder: 'builder-a', action: 'term', target: 'beta', args: {} });
    assert.equal(await refused(open('/api/v1/term/alpha', hub.termHeaders(other))), 403, 'target must match the path');
    const wrongArgs = hub.envelope({ builder: 'builder-a', action: 'term', target: 'alpha', args: { cols: 80 } });
    assert.equal(await refused(open('/api/v1/term/alpha?cols=100', hub.termHeaders(wrongArgs))), 403, 'args must match the clamped query');
    const ghost = hub.envelope({ builder: 'builder-a', action: 'term', target: 'ghost', args: {} });
    assert.equal(await refused(open('/api/v1/term/ghost', hub.termHeaders(ghost))), 404, 'unknown session');
    assert.equal(fb.terms.length, 1);
  });

  await withFake({ sessions: ['alpha'], hubKeys: [{ key: publicKeyString(termKey), id: 'hub', scopes: ['read', 'term'] }], hubControl: false }, async (fb) => {
    const env = hub.envelope({ builder: 'builder-a', action: 'term', target: 'alpha', args: {} });
    const ws = new WebSocket(`ws://127.0.0.1:${fb.port}/api/v1/term/alpha`, { headers: hub.termHeaders(env) });
    const [, res] = await once(ws, 'unexpected-response');
    assert.equal(res.statusCode, 403);
    assert.equal(fb.requests.at(-1).status, 403);
  });
});

test('fake builder: close() takes it down', async () => {
  const fb = await fakeBuilder({});
  const s = await openStream(fb);
  const closed = once(s.ws, 'close');
  await fb.close();
  await closed;
  await assert.rejects(fetch(`${fb.url}/api/v1/hello`));
  await fb.close(); // idempotent
});
