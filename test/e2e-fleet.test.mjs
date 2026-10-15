// End-to-end fleet test (fleet plan §11 X3, README §5 DoD item 4): a real hub
// (`node server/index.mjs` in mode "hub", test/helpers/boot.mjs) against
// in-process fake builders (test/helpers/fake-builder.mjs).
//
//   builder-a, builder-b  pin the hub key as {key, id, scopes:[read, control, term]}, hubControl:true
//   builder-c             pins the same key as a bare string (scope `read` only)
//
// Asserted, in order: the hub /ws snapshot holds both builders' sessions under
// fleet keys; a delta pushed by builder-b reaches the hub client, with builder
// text `<img onerror>` arriving as a plain string that the client renderer
// keeps as text; a signed read through the read proxy; a hub `send-text`
// through the ingress listener (serve-like X-Forwarded-* + Tailscale-User-Login)
// arrives at builder-a with a valid signature; the same POST on the hub's local
// listener -> 403 remote-only; a read-only pin answers the relayed action 403
// scope-missing and refuses a terminal; closing builder-b -> stale, then down
// (staleMs/downMs 300/900).
//
// Deterministic: every wait polls with a timeout; no fixed sleeps beyond the
// poll interval.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boot, ingressFetch, ingressWs } from './helpers/boot.mjs';
import { fakeBuilder } from './helpers/fake-builder.mjs';
import { makeDocument } from './helpers/fakedom.mjs';
import { generateHubKey, publicKeyString, verify } from '../server/fleet/keys-ed25519.mjs';
import { canonicalJson } from '../server/fleet/canonical.mjs';
import { fkey } from '../server/fleet/keys.mjs';
import { ansiLineToNodes } from '../public/js/core/ansi.js';

const USER = 'tester@example.invalid';
const PUBLIC = 'hub.example.invalid:8443';
const EVIL = '<img src=x onerror=alert(1)>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 8000, everyMs = 25, what = 'condition' } = {}) {
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

function wsOutcome(ws) {
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ open: true }));
    ws.once('unexpected-response', (_req, res) => resolve({ open: false, status: res.statusCode }));
    ws.once('error', (err) => resolve({ open: false, error: err.message }));
  });
}

/** A hub /ws client through serve that records every frame (raw and parsed). */
function hubClient(hub) {
  const ws = ingressWs(hub, '/ws', { user: USER });
  const frames = [];
  ws.on('message', (d) => {
    const raw = String(d);
    frames.push({ raw, msg: JSON.parse(raw) });
  });
  return {
    ws,
    frames,
    send: (m) => ws.send(JSON.stringify(m)),
    /** The first frame (from index `from`) matching `pred`. */
    wait: (pred, what, from = 0) => waitFor(() => frames.slice(from).find((f) => pred(f.msg)), { what }),
  };
}

const builderOf = (fleet, id) => fleet.builders.find((b) => b.id === id);

test('e2e fleet: two fake builders behind a booted hub', { timeout: 20_000 }, async (t) => {
  const { privateKey: hubKey } = generateHubKey();
  const pub = publicKeyString(hubKey);
  const scoped = [{ key: pub, id: 'hub', scopes: ['read', 'control', 'term'] }];
  const fa = await fakeBuilder({ id: 'builder-a', hubKeys: scoped, hubControl: true });
  const fb = await fakeBuilder({ id: 'builder-b', hubKeys: scoped, hubControl: true, sessions: ['alpha', 'beta'] });
  const fc = await fakeBuilder({ id: 'builder-c', hubKeys: [pub], hubControl: true, sessions: ['gamma'] });
  t.after(() => Promise.all([fa.close(), fb.close(), fc.close()]));

  const hub = await boot({
    mode: 'hub',
    hubKey,
    config: {
      publicUrl: `https://${PUBLIC}`,
      fleet: {
        builders: [
          { id: 'builder-a', url: fa.url },
          { id: 'builder-b', url: fb.url },
          { id: 'builder-c', url: fc.url },
        ],
        staleMs: 300,
        downMs: 900,
        pingMs: 100,
        batchMs: 100,
      },
    },
  });
  t.after(() => hub.stop());
  assert.equal(hub.health.mode, 'hub');
  assert.ok(hub.config.fleet.ingressPeerUid !== undefined || process.platform !== 'linux', 'the hub pins the serve peer uid');

  await waitFor(async () => {
    const r = await localFetch(hub, '/api/fleet');
    return r.status === 200 && r.json().builders.length === 3 && r.json().builders.every((b) => b.state === 'up');
  }, { what: 'all builders up' });

  const client = hubClient(hub);
  t.after(() => client.ws.terminate());
  assert.equal((await wsOutcome(client.ws)).open, true);

  await t.test('the hub /ws snapshot holds both builders under fleet keys', async () => {
    const fleet = await client.wait((m) => m.type === 'fleet', 'fleet frame');
    assert.deepEqual(fleet.msg.builders.map((b) => b.id), ['builder-a', 'builder-b', 'builder-c']);
    for (const fake of [fa, fb]) {
      const snap = await client.wait((m) => m.type === 'snapshot' && m.builder === fake.id, `${fake.id} snapshot`);
      const sessions = snap.msg.sessions;
      assert.deepEqual(sessions.map((s) => s.name).sort(), fake.sessions.map((s) => s.name).sort());
      for (const s of sessions) {
        assert.equal(s.key, fkey(fake.id, s.name), `session ${s.name} carries its fleet key`);
        assert.equal(s.previewHtml, undefined);
      }
      for (const a of snap.msg.attention ?? []) assert.equal(a.key, fkey(fake.id, a.name));
    }
  });

  await t.test('a builder-b delta reaches the client; builder text <img onerror> stays a plain string', async () => {
    const key = fkey('builder-b', 'delta-one');
    // Visible first, so the hub forwards previewLines for that session.
    client.send({ type: 'visible', keys: [key] });
    const mark = client.frames.length;
    // The hub applies `visible` asynchronously; push until the delta carries previewLines.
    let got = null;
    await waitFor(async () => {
      fb.push({
        type: 'delta',
        sessions: [{ ...fb.sessions[0], name: 'delta-one', state: 'working', activity: { tool: null, toolInput: null, lastUserPrompt: EVIL, lastAssistant: EVIL, lastAssistantAt: null }, previewLines: [EVIL], previewHtml: EVIL }],
      });
      got = await waitFor(() => client.frames.slice(mark).find((f) => f.msg.type === 'delta' && f.msg.builder === 'builder-b'
        && f.msg.sessions?.some((s) => s.key === key && Array.isArray(s.previewLines))), { timeoutMs: 400, what: 'delta' }).catch(() => null);
      return got;
    }, { timeoutMs: 6000, everyMs: 0, what: 'builder-b delta with previewLines' });
    const s = got.msg.sessions.find((x) => x.key === key);
    assert.equal(s.name, 'delta-one');
    assert.equal(s.builder ?? 'builder-b', 'builder-b');
    assert.equal(s.state, 'working');
    // Data, not markup: the exact string, no HTML rendering anywhere on the wire.
    assert.equal(s.activity.lastAssistant, EVIL);
    assert.equal(s.activity.lastUserPrompt, EVIL);
    assert.deepEqual(s.previewLines, [EVIL]);
    assert.equal(s.previewHtml, undefined, 'previewHtml never leaves the hub');
    assert.ok(!/&lt;img/.test(got.raw), 'the hub does not pre-render HTML');
    assert.ok(got.raw.includes(JSON.stringify(EVIL)), 'the text travels as a JSON string');
    // The client renderer keeps it as text: no element children, no innerHTML.
    const nodes = ansiLineToNodes(s.previewLines[0], makeDocument());
    assert.equal(nodes.map((n) => n.textContent).join(''), EVIL);
    for (const n of nodes) {
      assert.notEqual(n.tagName, 'IMG');
      assert.equal(n.children?.length ?? 0, 0);
      assert.equal(n.innerHTML ?? '', '');
    }
    // The hub's store kept it too (snapshot route).
    const snap = (await localFetch(hub, '/api/fleet/builder-b/snapshot')).json();
    assert.equal(snap.sessions.find((x) => x.name === 'delta-one')?.activity?.lastAssistant, EVIL);
  });

  await t.test('a read through the signed read proxy', async () => {
    const before = fa.requests.length;
    const r = await ingressFetch(hub, '/api/fleet/builder-a/v1/audit?since=0', { user: USER });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json().builder, 'builder-a');
    const seen = fa.requests.slice(before).find((q) => q.url.startsWith('/api/v1/audit'));
    assert.ok(seen, 'the read reached builder-a');
    assert.equal(seen.url, '/api/v1/audit?since=0');
    assert.equal(seen.kind, 'hub', 'verified as a signed hub read');
    assert.equal(seen.status, 200);
    assert.equal(seen.headers['tailscale-user-login'], undefined, 'browser identity is not forwarded');
    assert.equal(seen.headers.origin, undefined);
  });

  const name = fa.sessions[0].name;
  const action = { builder: 'builder-a', action: 'send-text', target: name, args: { text: 'hello from the hub' } };

  await t.test('send-text through the ingress listener arrives at builder-a with a valid signature', async () => {
    const r = await ingressFetch(hub, '/api/fleet/actions', { user: USER, method: 'POST', headers: { 'x-laneboard': '1' }, body: action });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json().ok, true);
    assert.equal(fa.actions.length, 1);
    const got = fa.actions[0];
    assert.equal(got.kind, 'hub');
    assert.equal(got.verified, true);
    assert.equal(got.status, 200);
    const env = got.envelope;
    assert.equal(env.v, 1);
    assert.equal(env.builder, 'builder-a');
    assert.equal(env.action, 'send-text');
    assert.equal(env.target, name);
    assert.equal(env.args.text, 'hello from the hub');
    assert.equal(env.user, USER);
    assert.equal(env.via, 'hub');
    // Independently of the fake: the signature verifies against the hub's public key.
    const m = /^ed25519 (\S+)$/.exec(got.headers['x-laneboard-sig'] ?? '');
    assert.ok(m, 'X-Laneboard-Sig: ed25519 <b64>');
    assert.equal(verify(canonicalJson(env), m[1], pub), true);
    assert.equal(verify(canonicalJson({ ...env, target: 'other' }), m[1], pub), false);
    assert.equal(got.headers['tailscale-user-login'], undefined);
    assert.equal(got.headers.origin, undefined);
  });

  await t.test('the same POST on the hub local listener: 403 remote-only, nothing sent', async () => {
    const r = await localFetch(hub, '/api/fleet/actions', { method: 'POST', headers: { 'x-laneboard': '1' }, body: action });
    assert.equal(r.status, 403);
    assert.equal(r.json().reason, 'remote-only');
    assert.equal(fa.actions.length, 1);
  });

  await t.test('a read-only pin: the relayed action is 403 scope-missing, a terminal is refused', async () => {
    const r = await ingressFetch(hub, '/api/fleet/actions', {
      user: USER, method: 'POST', headers: { 'x-laneboard': '1' }, body: { ...action, builder: 'builder-c', target: 'gamma' },
    });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json().ok, false);
    assert.equal(fc.actions.length, 1);
    assert.equal(fc.actions[0].status, 403);
    assert.equal(fc.actions[0].response.error, 'scope-missing');

    const before = fc.requests.length;
    const term = ingressWs(hub, '/ws/term/builder-c/gamma?cols=80&rows=24', { user: USER });
    const out = await wsOutcome(term);
    term.terminate();
    assert.equal(out.open, false, 'no terminal without the term scope');
    assert.equal(out.status, 403);
    assert.equal(fc.terms.length, 0);
    const up = fc.requests.slice(before).find((q) => q.method === 'UPGRADE' && q.url.startsWith('/api/v1/term/'));
    assert.ok(up, 'the hub asked builder-c');
    assert.equal(up.status, 403);
    assert.ok(up.headers['x-laneboard-envelope'], 'with a signed term envelope, never a read signature');
    // With the term scope the same attach opens (builder-a).
    const ok = ingressWs(hub, `/ws/term/builder-a/${encodeURIComponent(name)}?cols=80&rows=24`, { user: USER });
    assert.equal((await wsOutcome(ok)).open, true);
    ok.close();
    assert.equal(fa.terms.length, 1);
  });

  await t.test('closing builder-b: stale, then down', async () => {
    const killedAt = Date.now();
    await fb.close();
    let staleAt = null;
    let downAt = null;
    await waitFor(async () => {
      const b = builderOf((await localFetch(hub, '/api/fleet')).json(), 'builder-b');
      if (b.state === 'stale' && staleAt === null) staleAt = Date.now();
      if (b.state === 'down') { downAt = Date.now(); return true; }
      return false;
    }, { everyMs: 20, timeoutMs: 6000, what: 'builder-b down' });
    assert.ok(staleAt !== null, 'builder-b went straight from up to down');
    assert.ok(staleAt < downAt);
    assert.ok(staleAt - killedAt < 300 + 1000, `stale after ${staleAt - killedAt} ms`);
    assert.ok(downAt - killedAt >= 500, `down too early (${downAt - killedAt} ms)`);
    assert.ok(downAt - killedAt < 900 + 1000, `down after ${downAt - killedAt} ms`);
    const fleet = (await localFetch(hub, '/api/fleet')).json();
    assert.equal(builderOf(fleet, 'builder-a').state, 'up');
    assert.equal(builderOf(fleet, 'builder-b').controls, false);
    // The client hears it too.
    await client.wait((m) => m.type === 'fleet' && builderOf(m, 'builder-b')?.state === 'down', 'fleet frame with builder-b down');
  });

  assert.ok(!/unhandledRejection|uncaughtException/.test(hub.logs()), hub.logs().slice(-2000));
});
