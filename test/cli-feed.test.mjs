// Offline CLI `laneboard feed <kind>` (runs plan Night 2, task T6): runs one
// feeder once and prints the feed (--stdout, the default), writes it
// atomically (--out) or POSTs it (--push). `tailscale` is a fake script on
// PATH printing the invented fixture. Bad arguments exit 2 with one line and
// write nothing; a source that cannot be read exits 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFeed } from '../server/feeders/tailscale.mjs';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/feeds/tailscale-status.json', import.meta.url));

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-feed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A temp HOME with a fake `tailscale` first on PATH: `status --json` prints the fixture. */
function setup(t, { script } = {}) {
  const home = tmpDir(t);
  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir);
  const fake = path.join(binDir, 'tailscale');
  fs.writeFileSync(fake, script ?? `#!/bin/sh\n[ "$1 $2" = "status --json" ] || exit 3\ncat '${FIXTURE}'\n`, { mode: 0o755 });
  const env = {
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    LANEBOARD_CONFIG: path.join(home, 'no-config.json'),
    LANEBOARD_URL: 'http://127.0.0.1:9', // never the live board; nothing listens here
  };
  return { home, env };
}

function run(args, env, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
/** The feed toFeed makes of the fixture, with the CLI's clock. */
const expected = (feed, opts = {}) => toFeed(fixture(), { now: feed.at, ...opts });

test('feed tailscale --stdout prints the feed toFeed makes of `tailscale status --json`', async (t) => {
  const { home, env } = setup(t);
  const before = Date.now();
  const r = await run(['feed', 'tailscale', '--stdout'], env, home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.endsWith('\n'));
  const feed = JSON.parse(r.stdout);
  assert.ok(feed.at >= before && feed.at <= Date.now());
  assert.equal(feed.source, 'tailscale');
  assert.deepEqual(feed, expected(feed));
  assert.ok(feed.guests.length > 0);
});

test('stdout is the default; --source and --every reach the feed', async (t) => {
  const { home, env } = setup(t);
  const r = await run(['feed', 'tailscale', '--source', 'acme', '--every', '120'], env, home);
  assert.equal(r.code, 0, r.stderr);
  const feed = JSON.parse(r.stdout);
  assert.equal(feed.source, 'acme');
  assert.equal(feed.every, 120);
  assert.deepEqual(feed, expected(feed, { source: 'acme', every: 120 }));
});

test('--out writes the feed atomically, creating the directory and replacing an old file', async (t) => {
  const { home, env } = setup(t);
  const file = path.join(home, 'feeds', 'nested', 'acme.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"source":"old"}');
  const r = await run(['feed', 'tailscale', '--source', 'acme', '--out', 'feeds/nested/acme.json'], env, home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '');
  const feed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(feed, expected(feed, { source: 'acme' }));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['acme.json'], 'no temp file left behind');

  const fresh = path.join(home, 'new-dir', 'tailscale.json');
  const r2 = await run(['feed', 'tailscale', '--out', fresh], env, home);
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(JSON.parse(fs.readFileSync(fresh, 'utf8')).source, 'tailscale');
});

test('--push POSTs the feed to <url>/api/map/feeds with the x-laneboard header', async (t) => {
  const { home, env } = setup(t);
  const got = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ method: req.method, url: req.url, header: req.headers['x-laneboard'], type: req.headers['content-type'], body });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? '{"ok":true}' : '{"error":"feeds are off on this board"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  const r = await run(['feed', 'tailscale', '--push', url], env, home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(got.length, 1);
  assert.equal(got[0].method, 'POST');
  assert.equal(got[0].url, '/api/map/feeds');
  assert.equal(got[0].header, '1');
  assert.match(got[0].type, /^application\/json/);
  const feed = JSON.parse(got[0].body);
  assert.deepEqual(feed, expected(feed));

  status = 409;
  const refused = await run(['feed', 'tailscale', '--push', url], env, home);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /refused the feed: HTTP 409 feeds are off/);
});

test('bad arguments exit 2 with one line and write nothing', async (t) => {
  const { home, env } = setup(t);
  const cases = [
    [['feed'], /usage: laneboard feed <kind>/],
    [['feed', 'none'], /none has nothing to read/],
    [['feed', 'nosuch'], /unknown feeder: "nosuch"/],
    [['feed', 'tailscale', '--bogus'], /unexpected argument: "--bogus"/],
    [['feed', 'tailscale', '--out'], /--out needs a value/],
    [['feed', 'tailscale', '--out', 'a.json', '--stdout'], /do not go together/],
    [['feed', 'tailscale', '--out', 'a.json', '--push', 'http://127.0.0.1:9'], /do not go together/],
    [['feed', 'tailscale', '--source', '../etc', '--out', 'a.json'], /not a source name/],
    [['feed', 'tailscale', '--source', 'a', '--source', 'b'], /given twice/],
    [['feed', 'tailscale', '--every', 'soon'], /whole number of seconds/],
    [['feed', 'tailscale', '--every', '0'], /whole number of seconds/],
    [['feed', 'tailscale', '--push', 'ftp://hub.example.invalid'], /http\(s\) URL/],
    [['feed', 'tailscale', '--push', 'not a url'], /http\(s\) URL/],
    [['feed', 'tailscale', '--url', 'https://hv1.example.invalid:8006'], /--url is for proxmox only/],
    [['feed', 'proxmox', '--url', 'https://hv1.example.invalid:8006'], /proxmox needs --url and --token-id/],
  ];
  for (const [args, re] of cases) {
    const r = await run(args, env, home);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, re, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(home, 'a.json')));
});

test('--help prints the usage and exits 0; the main help lists feed', async (t) => {
  const { home, env } = setup(t);
  const h = await run(['feed', '--help'], env, home);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /--push url/);
  const main = await run(['--help'], env, home);
  assert.match(main.stdout, /laneboard feed tailscale\|proxmox/);
});

test('a source that cannot be read exits 1 with one line and writes no file', async (t) => {
  const { home, env } = setup(t, { script: '#!/bin/sh\necho "not logged in" >&2\nexit 1\n' });
  const r = await run(['feed', 'tailscale', '--out', 'x.json'], env, home);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^laneboard: tailscale status failed: not logged in\n$/);
  assert.ok(!fs.existsSync(path.join(home, 'x.json')));

  const notJson = setup(t, { script: '#!/bin/sh\necho hello\n' });
  const r2 = await run(['feed', 'tailscale'], notJson.env, notJson.home);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /did not print JSON/);
  assert.equal(r2.stdout, '');
});

test('proxmox without a secret fails before any request, without echoing a flag value', async (t) => {
  const { home, env } = setup(t);
  const r = await run(['feed', 'proxmox', '--url', 'https://127.0.0.1:9', '--token-id', 'laneboard@pve!map'], env, home);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^laneboard: proxmox: /);
  assert.equal(r.stdout, '');
});
