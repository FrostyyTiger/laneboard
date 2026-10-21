// T12: small CLI calls. An unknown command says so on its first line (stderr, a
// close match when there is one, then the help), exit 2; `ls`, `morning` and
// `credit` print `board: <url>` on stderr, the board that answered. The child
// gets a scratch HOME and only a test server's URL (or a closed port).
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-board-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    LANEBOARD_CONFIG: path.join(home, 'no-config.json'),
    LANEBOARD_URL: 'http://127.0.0.1:9', // never the live board; nothing listens here
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

test('an unknown command: the error first, a close match, then the help, all on stderr, exit 2', async (t) => {
  const env = envFor(t);
  const typo = await run(['moring'], env);
  assert.equal(typo.code, 2);
  assert.equal(typo.stdout, '');
  const lines = typo.stderr.split('\n');
  assert.equal(lines[0], 'laneboard: unknown command: moring');
  assert.equal(lines[1], 'did you mean: laneboard morning');
  assert.match(typo.stderr, /laneboard ls {2,}every session/);

  // An alias does not make two matches; a word near nothing gets no guess.
  assert.match((await run(['lss'], env)).stderr, /^laneboard: unknown command: lss\ndid you mean: laneboard ls\n/);
  const far = await run(['xyzzy'], env);
  assert.equal(far.code, 2);
  assert.match(far.stderr, /^laneboard: unknown command: xyzzy\n\nlaneboard — /);

  // A name that carries terminal escapes is printed clean.
  const evil = await run(['x\u001b]0;t\u0007y'], env);
  assert.ok(!evil.stderr.includes('\u001b') && !evil.stderr.includes('\u0007'), evil.stderr);
  assert.match(evil.stderr, /^laneboard: unknown command: x\]0;ty\n/);
});

test('ls, morning and credit print `board: <url>` on stderr, stdout keeps only the output', async (t) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/state') return res.end(JSON.stringify({ sessions: [], attention: [] }));
    if (u.pathname === '/api/morning') {
      return res.end(JSON.stringify({
        window: 'tonight', label: 'tonight', since: Date.now() - 3600000, now: Date.now(),
        needsYou: [], finished: [], runs: [], cost: { lanes: [], totalUsd: 0, totalTokens: 0 }, rateLimits: null,
      }));
    }
    if (u.pathname === '/api/credit') {
      return res.end(JSON.stringify({
        rateLimits: {}, sampler: { rows: 0 }, lanes: [], label: 'tonight',
        totals: { tonight: 0, day: 0, week: 0, allTime: 0 },
      }));
    }
    if (u.pathname === '/old/api/state') { res.writeHead(302, { location: '/api/state' }); return res.end(); }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'nope' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = envFor(t, { LANEBOARD_URL: url });

  for (const cmd of ['ls', 'morning', 'credit']) {
    const r = await run([cmd], env);
    assert.equal(r.code, 0, `${cmd}: ${r.stderr}`);
    assert.equal(r.stderr, `board: ${url}\n`, cmd);
    assert.ok(!r.stdout.includes('board:'), cmd);
  }

  // After a redirect the line names the board that answered, not the one configured.
  const moved = await run(['ls'], envFor(t, { LANEBOARD_URL: `${url}/old` }));
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(moved.stderr, `board: ${url}\n`);

  // A board that does not answer prints no board line, only the error.
  const down = await run(['ls'], envFor(t));
  assert.equal(down.code, 1);
  assert.doesNotMatch(down.stderr, /^board:/m);
  assert.match(down.stderr, /cannot reach the laneboard at http:\/\/127\.0\.0\.1:9/);
});
