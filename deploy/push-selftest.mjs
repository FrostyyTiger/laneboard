#!/usr/bin/env node
// Proves the push SEND path works without needing a phone.
//
//   node deploy/push-selftest.mjs
//
// Stands up a throwaway HTTPS "push service" on localhost, registers a
// subscription with real P-256 keys against it, and checks that:
//   * web-push signs with VAPID and encrypts with aes128gcm (RFC 8291);
//   * a transition into waiting_permission sends;
//   * a second transition within 60 s is coalesced away;
//   * `done` after 3 s does NOT send, `done` after 10 minutes does;
//   * a 410 response deletes the subscription.
//
// It writes to the real data/laneboard.db, but cleans up the row it added.
// The only thing left untested is delivery to an actual device.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// web-push refuses a plain-http endpoint, so the fake service needs TLS.
// This only disables verification for THIS process, talking to itself.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-push-'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048',
  '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'),
  '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
], { stdio: 'ignore' });
const tls = {
  key: fs.readFileSync(path.join(TMP, 'key.pem')),
  cert: fs.readFileSync(path.join(TMP, 'cert.pem')),
};

const REPO = path.resolve(import.meta.dirname, '..');
const { addSubscription, listSubscriptions, removeSubscription } = await import(`${REPO}/server/db.mjs`);
const push = await import(`${REPO}/server/push.mjs`);

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** A subscription with real P-256 keys, like a browser would produce. */
function fakeSubscription(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(crypto.randomBytes(16)) },
  };
}

const received = [];
let respondWith = 201;

const server = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({
      url: req.url,
      ttl: req.headers.ttl,
      encoding: req.headers['content-encoding'],
      hasVapid: /vapid/i.test(req.headers.authorization || ''),
      bytes: Buffer.concat(chunks).length,
    });
    res.writeHead(respondWith).end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const endpoint = `https://127.0.0.1:${port}/push/abc`;

const before = listSubscriptions().length;
addSubscription(fakeSubscription(endpoint), 'pushcheck');
console.log(`subscriptions: ${before} -> ${listSubscriptions().length}`);

// 1. a plain broadcast
let r = await push.broadcast({ title: 'check', body: 'hello', url: '/' });
console.log('broadcast:', JSON.stringify(r));

// 2. the real rule path: a transition into waiting_permission
push.resetCoalescing();
r = await push.onTransition({
  name: '_pushcheck',
  from: 'working',
  to: 'waiting_permission',
  stateSince: Date.now() - 60_000,
  activity: { tool: 'Bash', toolInput: 'rm -rf build/' },
});
console.log('waiting_permission ->', JSON.stringify({ notify: r.notify, sent: r.sent, reason: r.reason }));

// 3. coalescing: an immediate second transition must not send
r = await push.onTransition({
  name: '_pushcheck',
  from: 'working',
  to: 'waiting_question',
  stateSince: Date.now(),
  activity: {},
});
console.log('coalesced ->', JSON.stringify({ notify: r.notify, reason: r.reason }));

// 4. a short `done` must not send
push.resetCoalescing();
r = await push.onTransition({
  name: '_pushcheck',
  from: 'working',
  to: 'done',
  stateSince: Date.now() - 3000,
  activity: { lastAssistant: 'quick' },
});
console.log('done after 3s ->', JSON.stringify({ notify: r.notify, reason: r.reason }));

// 5. a long `done` must send
push.resetCoalescing();
r = await push.onTransition({
  name: '_pushcheck',
  from: 'working',
  to: 'done',
  stateSince: Date.now() - 10 * 60_000,
  activity: { lastAssistant: 'finished the migration' },
});
console.log('done after 10m ->', JSON.stringify({ notify: r.notify, sent: r.sent }));

console.log('\nwhat the push service actually received:');
for (const x of received) console.log(' ', JSON.stringify(x));

// 6. a 410 must delete the subscription
respondWith = 410;
push.resetCoalescing();
await push.broadcast({ title: 'gone', body: '', url: '/' });
console.log(`\nafter 410 -> subscriptions: ${listSubscriptions().length} (expected ${before})`);

removeSubscription(endpoint);
server.close();
fs.rmSync(TMP, { recursive: true, force: true });

// 4 requests reach the service: 3 that should send, plus the 410 probe.
const ok = received.length === 4 && received.every((x) => x.hasVapid && x.encoding === 'aes128gcm');
console.log(`\n${ok ? 'PASS' : 'FAIL'} — the send path is ${ok ? 'working' : 'broken'}.`);
console.log('Device delivery still needs a real browser or phone subscription.');
process.exit(ok ? 0 : 1);
