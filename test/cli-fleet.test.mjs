// Offline CLI commands (fleet plan §2 2.10, task A9): `laneboard fleet keygen|pubkey`,
// `laneboard audit [verify]`, and cleanTerm() on every server string the CLI prints (S11b).
// Every run uses a temp HOME and temp XDG dirs; nothing touches the real ~/.config or state dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePublicKey, keyId, publicKeyString, loadPrivateKey } from '../server/fleet/keys-ed25519.mjs';
import { openAudit } from '../server/fleet/audit.mjs';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-fleet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function envFor(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    LANEBOARD_URL: 'http://127.0.0.1:9', // never the live board
    ...extra,
  };
}

/** Run the CLI asynchronously (so an in-process fake server can answer). */
function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

const PEM_PRIV = /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/;

test('fleet keygen writes a 0600 PEM PKCS8 key at the XDG default, prints public key + keyId, never the private key', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const r = await run(['fleet', 'keygen'], env);
  assert.equal(r.code, 0, r.stderr);
  const file = path.join(home, 'config', 'laneboard', 'hub.key');
  const st = fs.statSync(file);
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const pem = fs.readFileSync(file, 'utf8');
  assert.match(pem, PEM_PRIV);
  const priv = loadPrivateKey(file);
  assert.ok(r.stdout.includes(publicKeyString(priv)));
  assert.ok(r.stdout.includes(`keyId: ${keyId(priv)}`));
  // The private key body never reaches stdout or stderr.
  const body = pem.split('\n').slice(1, -2).join('');
  for (const out of [r.stdout, r.stderr]) {
    assert.ok(!out.includes('PRIVATE KEY'));
    assert.ok(!out.includes(body));
  }
});

test('fleet keygen --out refuses to overwrite; --force replaces the key and keeps 0600', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const out = path.join(home, 'keys', 'hub.key');
  assert.equal((await run(['fleet', 'keygen', '--out', out], env)).code, 0);
  const before = fs.readFileSync(out, 'utf8');
  const again = await run(['fleet', 'keygen', '--out', out], env);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'existing key untouched');
  const forced = await run(['fleet', 'keygen', '--out', out, '--force'], env);
  assert.equal(forced.code, 0, forced.stderr);
  const after = fs.readFileSync(out, 'utf8');
  assert.notEqual(after, before);
  assert.match(after, PEM_PRIV);
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['hub.key'], 'no temp file left behind');
});

test('fleet pubkey prints ed25519:<44 base64>; --pem prints a PEM parsePublicKey accepts; same keyId', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const out = path.join(home, 'hub.key');
  assert.equal((await run(['fleet', 'keygen', '--out', out], env)).code, 0);
  const priv = loadPrivateKey(out);

  const plain = await run(['fleet', 'pubkey', '--key', out], env);
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /^ed25519:[A-Za-z0-9+/]{43}=\n$/);
  assert.equal(plain.stdout.trim().length, 'ed25519:'.length + 44);
  const k1 = parsePublicKey(plain.stdout.trim());
  assert.equal(keyId(k1), keyId(priv));
  assert.equal(plain.stderr.trim(), `keyId: ${keyId(priv)}`);

  const pem = await run(['fleet', 'pubkey', '--key', out, '--pem'], env);
  assert.equal(pem.code, 0, pem.stderr);
  assert.match(pem.stdout, /^-----BEGIN PUBLIC KEY-----\n/);
  const k2 = parsePublicKey(pem.stdout);
  assert.equal(keyId(k2), keyId(priv));
  assert.ok(!pem.stdout.includes('PRIVATE'));
});

test('fleet pubkey uses the XDG default key, accepts an openssl-style PKCS8 key, refuses a loose mode', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const missing = await run(['fleet', 'pubkey'], env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no hub key at .*config\/laneboard\/hub\.key.*fleet keygen/);

  assert.equal((await run(['fleet', 'keygen'], env)).code, 0);
  const ok = await run(['fleet', 'pubkey'], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^ed25519:/);

  // A key made by `openssl genpkey -algorithm ed25519` is the same PKCS8 PEM; emulate it with crypto.
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('ed25519');
  const oss = path.join(home, 'openssl.key');
  fs.writeFileSync(oss, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const fromOss = await run(['fleet', 'pubkey', '--key', oss], env);
  assert.equal(fromOss.code, 0, fromOss.stderr);
  assert.equal(fromOss.stdout.trim(), publicKeyString(privateKey));

  fs.chmodSync(oss, 0o644);
  const loose = await run(['fleet', 'pubkey', '--key', oss], env);
  assert.equal(loose.code, 1);
  assert.match(loose.stderr, /chmod 600/);
  assert.ok(!loose.stderr.includes('PRIVATE KEY'));
});

function writeChain(file, n) {
  let ts = 1_700_000_000_000;
  const audit = openAudit({ file, now: () => (ts += 1000), builder: 'builder-a' });
  try {
    for (let i = 0; i < n; i++) {
      audit.append({ user: 'user@example.invalid', via: 'direct', action: 'send-text', target: `lane-${i}`, args: { text: 'y' }, result: { ok: true, status: 200 } });
    }
    return audit.head();
  } finally {
    audit.close();
  }
}

test('audit verify: ok N entries + head on a good chain; exit 1 naming file, line and reason on tamper', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const file = path.join(home, 'audit', 'audit.jsonl');
  const head = writeChain(file, 3);

  const good = await run(['audit', 'verify', '--file', file], env);
  assert.equal(good.code, 0, good.stderr);
  assert.equal(good.stdout, `ok 3 entries, head ${head.hash.slice(0, 8)}\n`);

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[1] = lines[1].replace('lane-1', 'lane-X');
  fs.writeFileSync(file, lines.join('\n'));
  const bad = await run(['audit', 'verify', '--file', file], env);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.ok(bad.stderr.includes(`${file}:2:`), bad.stderr);
  assert.match(bad.stderr, /hash_mismatch|bad_json/);

  const none = await run(['audit', 'verify', '--file', path.join(home, 'nope.jsonl')], env);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no audit log at/);
});

test('audit verify defaults to $LANEBOARD_AUDIT_FILE, then the XDG state dir', async (t) => {
  const home = tmpHome(t);
  const viaEnv = path.join(home, 'elsewhere', 'a.jsonl');
  writeChain(viaEnv, 2);
  const r1 = await run(['audit', 'verify'], envFor(home, { LANEBOARD_AUDIT_FILE: viaEnv }));
  assert.equal(r1.code, 0, r1.stderr);
  assert.match(r1.stdout, /^ok 2 entries, head [0-9a-f]{8}\n$/);

  writeChain(path.join(home, 'state', 'laneboard', 'audit.jsonl'), 4);
  const r2 = await run(['audit', 'verify'], envFor(home));
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /^ok 4 entries/);
});

test('audit tail prints TS USER VIA ACTION TARGET OK, honours -n and --json, strips escapes', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const file = path.join(home, 'audit.jsonl');
  writeChain(file, 5);
  // A hand-written (unchained) line with an OSC 52 payload in the target: the tail must not pass ESC/BEL through.
  fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now(), user: 'u', via: 'hub', action: 'kill', target: 'x\u001b]52;c;aGk=\u0007y', result: { ok: false, status: 403 } })}\n`);

  const r = await run(['audit', '--file', file, '-n', '3'], env);
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.split('\n').filter(Boolean);
  assert.match(out[0], /^TS\s+USER\s+VIA\s+ACTION\s+TARGET\s+OK$/);
  assert.equal(out.length, 4);
  assert.match(out[1], /send-text\s+lane-3\s+ok$/);
  assert.match(out[3], /kill\s+x\]52;c;aGk=y\s+403$/);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(r.stdout), 'no control characters printed');

  const j = await run(['audit', '--file', file, '-n', '2', '--json'], env);
  assert.equal(j.code, 0, j.stderr);
  const rows = j.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((e) => e.action), ['send-text', 'kill']);
  assert.ok(!j.stdout.includes('\u001b'));

  const since = await run(['audit', '--file', file, '--since', '1h'], env);
  assert.equal(since.code, 0, since.stderr);
  assert.equal(since.stdout.split('\n').filter(Boolean).length, 2, 'only the recent entry (plus header)');

  const badSince = await run(['audit', '--file', file, '--since', 'soon'], env);
  assert.equal(badSince.code, 2);
});

test('cleanTerm: a session name carrying an OSC 52 sequence prints without ESC or BEL', async (t) => {
  const home = tmpHome(t);
  const evil = 'evil\u001b]52;c;cm0gLXJmIH4=\u0007\u009b2J\u007fname';
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/state') {
      res.end(JSON.stringify({
        sessions: [{ name: evil, state: 'idle', stateSince: Date.now(), dir: '/tmp/x\u001b[2J', branch: 'main\u001b]0;t\u0007', paneCmd: 'claude' }],
        attention: [{ name: evil, state: 'waiting_question', since: Date.now() }],
      }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `no route \u001b]52;c;eA==\u0007${req.url}` }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  const r = await run(['ls'], envFor(home, { LANEBOARD_URL: url }));
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes('\u001b'), 'no ESC');
  assert.ok(!r.stdout.includes('\u0007'), 'no BEL');
  assert.ok(!r.stdout.includes('\u009b'), 'no C1 CSI');
  assert.ok(!r.stdout.includes('\u007f'), 'no DEL');
  assert.ok(r.stdout.includes('evil]52;c;cm0gLXJmIH4=2Jname'));

  // Server error text is cleaned too.
  const e = await run(['peek', 'x'], envFor(home, { LANEBOARD_URL: url }));
  assert.equal(e.code, 1);
  assert.ok(!e.stderr.includes('\u001b') && !e.stderr.includes('\u0007'), e.stderr);
  assert.match(e.stderr, /no route \]52;c;eA==/);
});

test('usage lists the offline fleet and audit commands', async (t) => {
  const r = await run(['--help'], envFor(tmpHome(t)));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /laneboard fleet keygen/);
  assert.match(r.stdout, /laneboard fleet pubkey/);
  assert.match(r.stdout, /laneboard audit verify/);
  const sub = await run(['fleet', 'nope'], envFor(tmpHome(t)));
  assert.equal(sub.code, 2);
});
