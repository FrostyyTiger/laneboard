// Fleet A8: the v1 wiring against real boots (child processes, isolated temp
// dirs, scratch tmux sockets). What a builder with a fleet block answers on
// its two listeners: the local one (CLI, hooks) and the ingress one that
// `tailscale serve` targets (test/helpers/boot.mjs ingressFetch / ingressWs
// add serve's headers).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';

import { boot, ingressFetch, ingressWs } from './helpers/boot.mjs';
import { publicKeyString } from '../server/fleet/keys-ed25519.mjs';
import { signRead, actionHeaders, termHeaders, signEnvelope } from '../server/fleet/auth.mjs';

const ID = 'builder-a';
const PUB = 'builder-a.example.invalid:8443';
const USER = 'op@example.invalid';

const ctl = crypto.generateKeyPairSync('ed25519');     // scopes read, control, term
const noterm = crypto.generateKeyPairSync('ed25519');  // scopes read, control
const ro = crypto.generateKeyPairSync('ed25519');      // a bare string: read only
const stranger = crypto.generateKeyPairSync('ed25519'); // pinned nowhere

function fleetBlock(extra = {}) {
  return {
    id: ID,
    code: 'BA',
    publicHosts: [PUB],
    hubKeys: [
      { key: publicKeyString(ctl.publicKey), id: 'hub-ctl', scopes: ['read', 'control', 'term'] },
      { key: publicKeyString(noterm.publicKey), id: 'hub-noterm', scopes: ['read', 'control'] },
      publicKeyString(ro.publicKey),
    ],
    ...extra,
  };
}

const keyIdOf = (k) => signRead({ url: '/x', builderId: ID, key: k.privateKey })['X-Laneboard-Key'];

function readHeaders(p, k = ctl) {
  return signRead({ method: 'GET', url: p, builderId: ID, key: k.privateKey });
}

/** Headers signed by `stranger` but naming a pinned keyId: a garbage signature for a real key. */
function forgedReadHeaders(p, pinned = ctl) {
  return { ...signRead({ method: 'GET', url: p, builderId: ID, key: stranger.privateKey }), 'X-Laneboard-Key': keyIdOf(pinned) };
}

function envelope(action, target, args = {}, over = {}) {
  return { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: ID, action, target, args, user: USER, via: 'hub', ...over };
}

function hubAction(b, env, k = ctl) {
  return ingressFetch(b, '/api/v1/actions', { user: null, method: 'POST', headers: actionHeaders(env, k.privateKey), body: JSON.stringify(env) });
}

/** A request on the local listener, Host = loopback:port. */
function local(b, p, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { host: `127.0.0.1:${b.port}`, ...(method !== 'GET' ? { 'x-laneboard': '1', 'content-type': 'application/json' } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port: b.port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, text, json: j });
      });
    });
    r.on('error', reject);
    if (data !== null) r.write(data);
    r.end();
  });
}

/** A request on the ingress port WITHOUT serve's X-Forwarded-* headers. */
function rawIngress(b, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: b.ingressPort, path: p, headers: { host: PUB, ...headers } }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** 'open' or the HTTP status of a refused upgrade. */
async function wsOutcome(c) {
  const r = await Promise.race([
    once(c, 'open').then(() => 'open'),
    once(c, 'unexpected-response').then(([, res]) => res.statusCode),
    once(c, 'error').then(([e]) => `error ${e.message}`),
  ]);
  try { c.terminate(); } catch { /* gone */ }
  return r;
}

const json = (r) => (typeof r.json === 'function' ? r.json() : r.json);

async function auditEntries(b) {
  const r = await local(b, '/api/v1/audit?since=0');
  assert.equal(r.status, 200, r.text);
  return r.json.entries;
}

async function until(fn, ms = 10000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------- hubControl false

test('fleet block, hubControl false: classification on both listeners', { timeout: 60_000 }, async () => {
  const b = await boot({ config: { fleet: fleetBlock() } });
  try {
    assert.ok(b.ingressPort && b.ingressPort !== b.port, 'the ingress listener is open');

    // /healthz is auth-exempt on both listeners
    assert.equal((await rawIngress(b, '/healthz')).status, 200);

    // ingress without serve's X-Forwarded-For/-Proto
    let r = await rawIngress(b, '/api/v1/hello');
    assert.equal(r.status, 403);
    assert.match(r.text, /not-from-serve/);
    r = await rawIngress(b, '/api/v1/hello', { 'tailscale-user-login': USER });
    assert.equal(r.status, 403, 'a forged identity without serve headers');

    // ingress, serve headers, neither a user nor a signature: enforce
    r = await ingressFetch(b, '/api/v1/hello', { user: null });
    assert.equal(r.status, 403);
    assert.match(r.text, /unidentified/);

    // a direct user
    r = await ingressFetch(b, '/api/v1/hello', { user: USER });
    assert.equal(r.status, 200);
    assert.deepEqual(json(r).auth, { kind: 'direct' });
    // ...needs JSON on POST /api/v1/actions (a non-simple request)
    r = await ingressFetch(b, '/api/v1/actions', { user: USER, method: 'POST', headers: { 'content-type': 'text/plain', 'x-laneboard': '1', origin: `https://${PUB}` }, body: '{}' });
    assert.equal(r.status, 415);

    // the local listener: local, and a Tailscale-User-Login header there is deleted, never trusted
    r = await local(b, '/api/v1/hello', { headers: { 'tailscale-user-login': USER } });
    assert.deepEqual(r.json.auth, { kind: 'local' });
    r = await local(b, '/api/sessions/nobody/keys', { method: 'POST', body: { keys: ['Enter'] }, headers: { 'tailscale-user-login': USER } });
    assert.equal(r.status, 404, r.text);
    const legacyRow = (await auditEntries(b)).filter((e) => e.action === 'send-keys' && e.target === 'nobody').at(-1);
    assert.equal(legacyRow.user, 'local', 'the forged login is not the audit user');
    assert.equal(legacyRow.via, 'legacy');
    // the hook intake never comes through serve
    r = await ingressFetch(b, '/api/hook', { user: USER, method: 'POST', headers: { origin: `https://${PUB}` }, body: { hook_event_name: 'Stop' } });
    assert.equal(r.status, 403);
    // a publicHost is not a valid Host on the local listener
    r = await local(b, '/api/v1/hello', { headers: { host: PUB } });
    assert.equal(r.status, 403);
  } finally {
    await b.stop();
  }
});

test('fleet block, hubControl false: signed reads work, forged signatures and every action/terminal are refused', { timeout: 60_000 }, async () => {
  const b = await boot({ config: { fleet: fleetBlock() } });
  try {
    // a signed read, with the control key and with a bare-string (read-only) key
    for (const k of [ctl, ro]) {
      const r = await ingressFetch(b, '/api/v1/snapshot', { user: null, headers: readHeaders('/api/v1/snapshot', k) });
      assert.equal(r.status, 200, r.text);
      const s = json(r);
      assert.deepEqual(s.builder, { id: ID, code: 'BA' });
      assert.equal(typeof s.epoch, 'string');
    }
    let r = await ingressFetch(b, '/api/v1/hello', { user: null, headers: readHeaders('/api/v1/hello') });
    assert.deepEqual(json(r).auth, { kind: 'hub' });
    // replay of the same signed read
    const once1 = readHeaders('/api/v1/hello');
    assert.equal((await ingressFetch(b, '/api/v1/hello', { user: null, headers: once1 })).status, 200);
    assert.equal((await ingressFetch(b, '/api/v1/hello', { user: null, headers: once1 })).status, 401);
    // SR3 H1: a known keyId with a garbage signature, on GET and on both upgrades
    r = await ingressFetch(b, '/api/v1/snapshot', { user: null, headers: forgedReadHeaders('/api/v1/snapshot') });
    assert.equal(r.status, 401, r.text);
    let w = await wsOutcome(ingressWs(b, '/api/v1/stream', { user: null, origin: null, headers: forgedReadHeaders('/api/v1/stream') }));
    assert.ok(w === 401 || w === 403, `forged stream signature: ${w}`);
    const tEnv = envelope('term', 'demo', {});
    const forgedTerm = { ...termHeaders(tEnv, stranger.privateKey), 'X-Laneboard-Key': keyIdOf(ctl) };
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: forgedTerm }));
    assert.ok(w === 401 || w === 403, `forged term envelope: ${w}`);
    // a known keyId + garbage signature on POST /api/v1/actions
    const fEnv = envelope('send-keys', 'demo', { keys: ['Enter'] });
    r = await ingressFetch(b, '/api/v1/actions', {
      user: null, method: 'POST', body: JSON.stringify(fEnv),
      headers: { ...actionHeaders(fEnv, stranger.privateKey), 'X-Laneboard-Key': keyIdOf(ctl) },
    });
    assert.equal(r.status, 401, r.text);
    // a valid stream signature opens the stream
    w = await wsOutcome(ingressWs(b, '/api/v1/stream', { user: null, origin: null, headers: readHeaders('/api/v1/stream') }));
    assert.equal(w, 'open');
    // a signed request carrying an Origin is a confused deputy
    r = await ingressFetch(b, '/api/v1/hello', { user: null, headers: { ...readHeaders('/api/v1/hello'), origin: `https://${PUB}` } });
    assert.equal(r.status, 403);
    // the hub may only touch /api/v1/
    r = await ingressFetch(b, '/api/state', { user: null, headers: readHeaders('/api/state') });
    assert.equal(r.status, 403);

    // an action: 403 control-disabled, and audited
    const env = envelope('send-keys', 'demo', { keys: ['Enter'] });
    r = await hubAction(b, env);
    assert.equal(r.status, 403, r.text);
    assert.equal(json(r).code, 'control-disabled');
    const row = (await auditEntries(b)).find((e) => e.id === env.id);
    assert.ok(row, 'the refusal is in the audit log');
    assert.equal(row.via, 'hub');
    assert.equal(row.user, USER);
    assert.equal(row.result.code, 'control-disabled');
    assert.equal(row.result.key, 'hub-ctl');
    // the same envelope again is a replay
    r = await hubAction(b, env);
    assert.equal(r.status, 401);
    // a signature over another body
    const env2 = envelope('send-keys', 'demo', { keys: ['Enter'] });
    r = await ingressFetch(b, '/api/v1/actions', { user: null, method: 'POST', headers: actionHeaders(env2, ctl.privateKey), body: JSON.stringify({ ...env2, target: 'other' }) });
    assert.equal(r.status, 401);

    // a terminal: a read signature never opens one; a term envelope needs hubControl
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: readHeaders('/api/v1/term/demo') }));
    assert.equal(w, 403);
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: termHeaders(envelope('term', 'demo', {}), ctl.privateKey) }));
    assert.equal(w, 403, 'control-disabled');
  } finally {
    await b.stop();
  }
});

// ---------------------------------------------------------------- hubControl true

const SID = '0f6c3b52-2c55-4a0e-8b8e-1b6d6b0e9c11';

function tmuxSocket(b) {
  return path.join(b.tmp, 'tmux', `tmux-${process.getuid()}`, 'default');
}

function startSession(b, name) {
  fs.mkdirSync(path.dirname(tmuxSocket(b)), { recursive: true, mode: 0o700 });
  const r = spawnSync('tmux', ['-S', tmuxSocket(b), 'new-session', '-d', '-s', name, '-x', '120', '-y', '40', 'sleep 600'], {
    env: { PATH: process.env.PATH, HOME: path.join(b.tmp, 'home') }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(r.status, 0, r.stderr);
  // a Claude Code registry entry for the session, so a PermissionRequest of SID resolves to it
  const dir = path.join(b.tmp, 'home', '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: b.tmp, tmux: `${name}:@0.%0` }));
}

function hookHold(b, token, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ session_id: SID, cwd: b.tmp, permission_mode: 'default', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const r = http.request({
      host: '127.0.0.1', port: b.port, method: 'POST', path: '/api/hook/permission', signal,
      headers: { host: `127.0.0.1:${b.port}`, 'content-type': 'application/json', 'x-laneboard-hook': token },
    }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('fleet block, hubControl true: scopes, terminals, approvals through ingress, legacy adapters', { timeout: 90_000 }, async (t) => {
  if (spawnSync('tmux', ['-V']).status !== 0) return t.skip('tmux is not installed');
  const b = await boot({ config: { fleet: fleetBlock({ hubControl: true }), budget: { perLaneUsd: 5 } } });
  try {
    startSession(b, 'demo');
    await until(async () => {
      const s = await local(b, '/api/state');
      return s.json?.sessions?.find((x) => x.name === 'demo' && x.paneSize?.cols);
    }, 15000, 'the demo session in the inventory');

    // actions: control scope runs, a bare-string (read-only) key is scope-missing
    let r = await hubAction(b, envelope('send-keys', 'demo', { keys: ['Enter'] }));
    assert.equal(r.status, 200, r.text);
    assert.equal(json(r).ok, true);
    r = await hubAction(b, envelope('send-keys', 'demo', { keys: ['Enter'] }), ro);
    assert.equal(r.status, 403);
    assert.equal(json(r).code, 'scope-missing');
    // remote-only actions are fine for a control-scoped hub: approve of an unknown approval is a 404, not 403
    r = await hubAction(b, envelope('approve', 'demo', { approvalId: crypto.randomUUID() }));
    assert.notEqual(r.status, 403, r.text);

    // terminals: term scope opens one (101), a control-only key does not, a mismatched path does not
    let w = await wsOutcome(ingressWs(b, '/api/v1/term/demo?cols=100&rows=30', { user: null, origin: null, headers: termHeaders(envelope('term', 'demo', { cols: 100, rows: 30 }), ctl.privateKey) }));
    assert.equal(w, 'open');
    const termRow = (await auditEntries(b)).filter((e) => e.action === 'term').at(-1);
    assert.equal(termRow.via, 'hub');
    assert.equal(termRow.target, 'demo');
    assert.equal(termRow.result.key, 'hub-ctl');
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: termHeaders(envelope('term', 'demo', {}), noterm.privateKey) }));
    assert.equal(w, 403, 'scope-missing');
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: termHeaders(envelope('term', 'other', {}), ctl.privateKey) }));
    assert.equal(w, 403, 'envelope target differs from the path');
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo?cols=80', { user: null, origin: null, headers: termHeaders(envelope('term', 'demo', { cols: 100 }), ctl.privateKey) }));
    assert.equal(w, 403, 'envelope args differ from the query');
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: null, origin: null, headers: readHeaders('/api/v1/term/demo') }));
    assert.equal(w, 403, 'a read signature never opens a terminal');
    // a direct user opens a terminal (Origin required, it is sent by ingressWs)
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: USER }));
    assert.equal(w, 'open');
    w = await wsOutcome(ingressWs(b, '/api/v1/term/demo', { user: USER, origin: null }));
    assert.equal(w, 403, 'a direct upgrade without Origin');

    // C4: an approval is decided through the ingress listener by a direct user, and is remote-only locally
    const stateDir = path.join(b.tmp, 'state', 'laneboard');
    const token = await until(() => { try { return fs.readFileSync(path.join(stateDir, 'hook.token'), 'utf8').trim(); } catch { return null; } }, 5000, 'the hook token');
    const ac = new AbortController();
    const held = hookHold(b, token, ac.signal);
    const pending = await until(async () => {
      const l = await local(b, '/api/v1/approvals');
      return l.json?.approvals?.length ? l.json.approvals[0] : null;
    }, 10000, 'the held approval');
    assert.equal(pending.session, 'demo');
    const localEnv = { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: ID, action: 'approve', target: 'demo', args: { approvalId: pending.id }, user: 'x', via: 'direct' };
    r = await local(b, '/api/v1/actions', { method: 'POST', body: localEnv });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.code, 'remote-only');
    const directEnv = { ...localEnv, id: crypto.randomUUID() };
    r = await ingressFetch(b, '/api/v1/actions', { user: USER, method: 'POST', headers: { 'x-laneboard': '1', origin: `https://${PUB}` }, body: directEnv });
    assert.equal(r.status, 200, r.text);
    const decided = await held;
    assert.equal(decided.status, 200);
    assert.match(decided.text, /allow/);
    const approveRow = (await auditEntries(b)).filter((e) => e.id === directEnv.id).at(-1);
    assert.equal(approveRow.user, USER, 'the direct user, never the envelope user');
    assert.equal(approveRow.via, 'direct');
    ac.abort();

    // SR17 M1: the legacy launch goes through dispatch; local may not ask for priority high or raise the budget
    r = await local(b, '/api/lanes', { method: 'POST', body: { lane: 'l-a8', plan: 'docs/plans/x.md', priority: 'high' } });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.code, 'remote-only');
    r = await local(b, '/api/lanes', { method: 'POST', body: { lane: 'l-a8', plan: 'docs/plans/x.md', budgetUsd: 50 } });
    assert.equal(r.status, 403, r.text);
    const launchRows = (await auditEntries(b)).filter((e) => e.action === 'launch' && e.target === 'l-a8');
    assert.equal(launchRows.length, 2, 'both refusals are audited');
    assert.ok(launchRows.every((e) => e.via === 'legacy' && e.result.code === 'remote-only'));
    r = await local(b, '/api/lanes', { method: 'POST', body: { lane: 'l-a8', plan: 'docs/plans/x.md', permissionMode: 'bypassPermissions' } });
    assert.equal(r.status, 400, 'the permission mode allowlist applies to the legacy route');

    // legacy confirm-tier routes: a browser (direct) must confirm, local is auto-confirmed
    r = await ingressFetch(b, '/api/sessions/demo', { user: USER, method: 'DELETE', headers: { 'x-laneboard': '1', origin: `https://${PUB}` } });
    assert.equal(r.status, 400, r.text);
    assert.equal(json(r).code, 'bad_args');
    r = await local(b, '/api/sessions/demo', { method: 'DELETE' });
    assert.equal(r.status, 200, r.text);
    const killRow = (await auditEntries(b)).filter((e) => e.action === 'kill' && e.target === 'demo').at(-1);
    assert.equal(killRow.via, 'legacy');
    assert.equal(killRow.user, 'local');
    assert.equal(killRow.result.ok, true);

    // the hub reads the audit log over a signed read
    r = await ingressFetch(b, '/api/v1/audit?limit=5', { user: null, headers: readHeaders('/api/v1/audit?limit=5') });
    assert.equal(r.status, 200);
    assert.equal(json(r).builder, ID);
    assert.equal(json(r).entries.length, 5);
  } finally {
    await b.stop();
  }
});

// ---------------------------------------------------------------- legacy browser routes off

test('fleet.legacyBrowserRoutes false: legacy mutations from a browser answer 410, local ones still work', { timeout: 60_000 }, async () => {
  const b = await boot({ config: { fleet: fleetBlock({ legacyBrowserRoutes: false }) } });
  try {
    let r = await ingressFetch(b, '/api/sessions/demo/keys', { user: USER, method: 'POST', headers: { 'x-laneboard': '1', origin: `https://${PUB}` }, body: { keys: ['Enter'] } });
    assert.equal(r.status, 410);
    r = await local(b, '/api/sessions/demo/keys', { method: 'POST', body: { keys: ['Enter'] } });
    assert.equal(r.status, 404, 'local reaches dispatch (unknown session)');
  } finally {
    await b.stop();
  }
});

// ---------------------------------------------------------------- peer uid (A11)

test('fleet.ingressPeerUid: the ingress peer must be that uid (fail closed)', { timeout: 60_000, skip: process.platform !== 'linux' }, async () => {
  const other = await boot({ config: { fleet: fleetBlock({ ingressPeerUid: process.getuid() + 4242 }) } });
  try {
    const r = await ingressFetch(other, '/api/v1/hello', { user: USER });
    assert.equal(r.status, 403);
    assert.match(r.text, /not-from-serve/);
  } finally {
    await other.stop();
  }
  // this test process is the peer: its own uid matches (a real /proc/net/tcp lookup)
  const mine = await boot({ config: { fleet: fleetBlock({ ingressPeerUid: process.getuid() }) } });
  try {
    const r = await ingressFetch(mine, '/api/v1/hello', { user: USER });
    assert.equal(r.status, 200, r.text);
  } finally {
    await mine.stop();
  }
});

// ---------------------------------------------------------------- no fleet block

test('no fleet block: no ingress listener, everything local, legacy routes audited', { timeout: 60_000 }, async () => {
  const b = await boot();
  try {
    assert.equal(b.ingressPort, null);
    const h = await local(b, '/api/v1/hello', { headers: { 'tailscale-user-login': USER } });
    assert.deepEqual(h.json.auth, { kind: 'local' });
    const r = await local(b, '/api/sessions/nobody/keys', { method: 'POST', body: { keys: ['Enter'] }, headers: { 'tailscale-user-login': USER } });
    assert.equal(r.status, 404);
    const row = (await auditEntries(b)).filter((e) => e.action === 'send-keys').at(-1);
    assert.equal(row.user, USER, 'without a fleet block the login is attribution, as always');
    assert.equal(row.via, 'legacy');
    assert.match(b.logs(), /remote-only protection .* needs a fleet block/);
    // signature machinery is not reachable without an ingress listener: a signed request is just local
    const s = await local(b, '/api/v1/hello', { headers: { 'x-laneboard-sig': `ed25519 ${'A'.repeat(86)}==` } });
    assert.equal(s.status, 200);
    assert.deepEqual(s.json.auth, { kind: 'local' });
    void signEnvelope;
  } finally {
    await b.stop();
  }
});
