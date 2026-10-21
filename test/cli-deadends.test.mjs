// T48: CLI dead ends point the way. `launch` whose server says no repo is known
// names `--repo` and the config's `repos`; `peek`/`retire` on a name the server
// answers 404 for say `no session or lane <x>; see laneboard ls`, exit 1. The
// child gets a scratch HOME and a stub server's URL only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));

function envFor(t, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-deadends-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    LANEBOARD_CONFIG: path.join(home, 'no-config.json'),
    ...extra,
  };
}

function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd: env.HOME, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/** A stub board: `routes[method + ' ' + pathname]` is `[status, body]`. */
async function stub(t, routes) {
  const server = http.createServer((req, res) => {
    const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
    const [status, body] = routes[key] || [500, { error: `stub has no ${key}` }];
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('launch with no repo known names --repo and the config repos', async (t) => {
  const url = await stub(t, {
    'POST /api/lanes': [400, { error: 'no repo given and no default repo configured' }],
  });
  const r = await run(['launch', 'demo', '--plan', 'docs/plans/demo.md', '--no-wait'], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^laneboard: no repo given and no default repo configured; pass --repo <repo>, or list repos in the config's `repos`/);
  assert.match(r.stderr, /docs\/config\.md/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
});

test('launch keeps any other server error as it is', async (t) => {
  const url = await stub(t, { 'POST /api/lanes': [400, { error: 'invalid repo "x y"' }] });
  const r = await run(['launch', 'demo', '--plan', 'p.md', '--repo', 'x y', '--no-wait'], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'laneboard: invalid repo "x y"\n');
});

test('peek on an unknown name says where the names are, exit 1', async (t) => {
  const url = await stub(t, { 'GET /api/sessions/ghost/preview': [404, { error: 'unknown session' }] });
  const r = await run(['peek', 'ghost'], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'laneboard: no session or lane ghost; see laneboard ls\n');
  assert.ok(!r.stderr.includes('unknown session'));
});

test('retire on an unknown lane says where the names are, exit 1', async (t) => {
  const url = await stub(t, { 'DELETE /api/lanes/ghost': [404, { error: 'no launched lane ghost' }] });
  const r = await run(['retire', 'ghost'], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'laneboard: no session or lane ghost; see laneboard ls\n');
});

test('retire keeps a non-404 refusal as the server said it', async (t) => {
  const url = await stub(t, { 'DELETE /api/lanes/busy': [409, { error: 'lane busy has a live session (s1); kill it first' }] });
  const r = await run(['retire', 'busy'], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^laneboard: lane busy has a live session/);
});

test('a name with terminal escapes is printed clean in the 404 line', async (t) => {
  const name = 'x\u001b[31my';
  const url = await stub(t, { [`GET /api/sessions/${encodeURIComponent(name)}/preview`]: [404, { error: 'unknown session' }] });
  const r = await run(['peek', name], envFor(t, { LANEBOARD_URL: url }));
  assert.equal(r.code, 1);
  assert.ok(!r.stderr.includes('\u001b'), r.stderr);
  assert.match(r.stderr, /no session or lane x\[31my; see laneboard ls/);
});
