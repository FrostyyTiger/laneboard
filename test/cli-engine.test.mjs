// `laneboard engine check` (docs/engines.md): the CLI against a test server
// that carries the real engine routes (server/routes/engines.mjs) over a fake
// engine, a down one and an incompatible one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createContext } from '../server/modules.mjs';
import enginesModule from '../server/routes/engines.mjs';
import * as engines from '../server/engine/index.mjs';
import * as fake from '../server/engine/fake.mjs';
import * as none from '../server/engine/none.mjs';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));
const hello = JSON.parse(fs.readFileSync(path.join(fake.FIXTURES, 'hello.json'), 'utf8'));

const table = [];
const ctx = createContext({ mode: 'builder' }, {
  route: (method, pattern, handler) => {
    const keys = [];
    const rx = new RegExp(`^${pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    table.push({ method, rx, keys, handler });
  },
});
enginesModule.register(ctx);
const prev = engines._set([
  fake.create({ id: 'main' }),
  none.create({ id: 'off' }),
  fake.create({ id: 'old', override: { hello: { ...hello, contract: '2.0', data: { ...hello.data, contract: '2.0' } } } }),
]);

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  for (const r of table) {
    const m = r.rx.exec(u.pathname);
    if (!m || r.method !== req.method) continue;
    req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(req, res);
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"error":"no route"}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); engines._set(prev); });

function run(args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-engine-'));
  const env = { PATH: process.env.PATH, HOME: home, LANEBOARD_CONFIG: path.join(home, 'none.json'), LANEBOARD_URL: URL_ };
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd: home, timeout: 20000 }, (err, stdout, stderr) => {
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

test('engine check --engine main: version, accepted range, one ok line per read verb, exit 0', async () => {
  const r = await run(['engine', 'check', '--engine', 'main']);
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^main \(fake\) {2}up {2}contract 1\.0 {2}engine 0\.1\.0 {2}accepts 1\.x/);
  for (const verb of ['hello', 'health', 'products', 'runs', 'run', 'events', 'waiting', 'knowledge']) {
    assert.ok(lines.some((l) => new RegExp(`^  ${verb} +ok`).test(l)), `${verb}: ${r.stdout}`);
  }
  assert.ok(lines.some((l) => /runs +ok {2}3 runs/.test(l)));
});

test('engine check: an incompatible engine refuses every read and exits 1; none says unsupported', async () => {
  const r = await run(['engine', 'check']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^old \(fake\) {2}incompatible .*2\.0.*1\.x/m);
  assert.match(r.stdout, /^ {2}runs +incompatible/m);
  assert.match(r.stdout, /^off \(none\) {2}off/m);
  assert.match(r.stdout, /^ {2}products +- unsupported/m);
});

test('engine check: usage errors exit 2, an unknown engine exits 1', async () => {
  assert.equal((await run(['engine'])).code, 2);
  assert.equal((await run(['engine', 'check', 'extra'])).code, 2);
  const help = await run(['engine', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: laneboard engine check/);
  const unknown = await run(['engine', 'check', '--engine', 'nope']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no engine "nope"; there are: main, off, old/);
});
