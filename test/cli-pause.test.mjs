// Offline CLI pause commands (fleet plan §8, task C11): `laneboard pause`,
// `laneboard resume`, `laneboard paused`. They write the sentinels directly via
// server/control/pause.mjs, so they work with the server down; `resume` refuses
// to lift budget/quota pauses (remote-only, S7). Every run uses a temp HOME and
// temp XDG/state dirs; LANEBOARD_URL points at a closed port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pause from '../server/control/pause.mjs';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-pause-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** No LANEBOARD_STATE_DIR / LANEBOARD_CONFIG unless the test sets them. */
function envFor(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    LANEBOARD_CONFIG: path.join(home, 'no-config.json'),
    LANEBOARD_URL: 'http://127.0.0.1:9', // never the live board; nothing listens here
    ...extra,
  };
}

function run(args, env, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env, cwd, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('pause --all with the server stopped creates paused/ALL (operator) in $LANEBOARD_STATE_DIR', async (t) => {
  const home = tmpHome(t);
  const sd = path.join(home, 'state');
  const r = await run(['pause', '--all', '--reason', 'runbook'], envFor(home, { LANEBOARD_STATE_DIR: sd }));
  assert.equal(r.code, 0, r.stderr);
  const e = read(path.join(sd, 'paused', 'ALL'));
  assert.equal(e.kind, 'operator');
  assert.equal(e.by, 'cli');
  assert.equal(e.reason, 'runbook');
  assert.ok(Number.isFinite(e.at));
  assert.equal(fs.statSync(path.join(sd, 'paused')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(sd, 'paused', 'ALL')).mode & 0o777, 0o600);
  // `ALL` spelled out is the same scope.
  const r2 = await run(['resume', 'ALL'], envFor(home, { LANEBOARD_STATE_DIR: sd }));
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(fs.existsSync(path.join(sd, 'paused')), false, 'empty paused/ is removed');
});

test('without LANEBOARD_STATE_DIR or config the state dir honours XDG_STATE_HOME, like the server', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  const r = await run(['pause', 'builder-a'], env);
  assert.equal(r.code, 0, r.stderr);
  const want = path.join(home, 'xdg-state', 'laneboard');
  assert.ok(fs.existsSync(path.join(want, 'paused', 'builder-a')));
  assert.equal(fs.existsSync(path.join(home, '.local')), false, 'pause.mjs defaultStateDir() is not used');
  const l = await run(['paused', '--json'], env);
  assert.equal(l.code, 0, l.stderr);
  const out = JSON.parse(l.stdout);
  assert.equal(out.stateDir, want);
  assert.deepEqual(out.paused.map((p) => [p.scope, p.kind]), [['builder-a', 'operator']]);
});

test('no XDG_STATE_HOME falls back to ~/.local/state/laneboard', async (t) => {
  const home = tmpHome(t);
  const env = envFor(home);
  delete env.XDG_STATE_HOME;
  const r = await run(['pause', 'builder-a'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.local', 'state', 'laneboard', 'paused', 'builder-a')));
});

test('config file stateDir (with ~/) is used; LANEBOARD_STATE_DIR beats it; a relative env value resolves against the cwd', async (t) => {
  const home = tmpHome(t);
  const cfg = path.join(home, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ stateDir: '~/from-config' }));
  const r = await run(['pause', 'builder-a'], envFor(home, { LANEBOARD_CONFIG: cfg }));
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, 'from-config', 'paused', 'builder-a')));

  const r2 = await run(['pause', 'hub'], envFor(home, { LANEBOARD_CONFIG: cfg, LANEBOARD_STATE_DIR: 'rel-state' }), home);
  assert.equal(r2.code, 0, r2.stderr);
  assert.ok(fs.existsSync(path.join(home, 'rel-state', 'paused', 'hub')));
  assert.equal(fs.existsSync(path.join(home, 'from-config', 'paused', 'hub')), false);
});

test('a relative stateDir in the config file is refused; a broken config file is an error', async (t) => {
  const home = tmpHome(t);
  const cfg = path.join(home, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ stateDir: 'relative/dir' }));
  const r = await run(['pause', '--all'], envFor(home, { LANEBOARD_CONFIG: cfg }), home);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /stateDir must be an absolute path/);
  assert.equal(fs.existsSync(path.join(home, 'relative')), false);

  fs.writeFileSync(cfg, '{ not json');
  const r2 = await run(['pause', '--all'], envFor(home, { LANEBOARD_CONFIG: cfg }));
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /not valid JSON/);
  assert.match(r2.stderr, /LANEBOARD_STATE_DIR/);
  // An empty config file (e.g. /dev/null) is a config with no keys.
  const r3 = await run(['pause', '--all'], envFor(home, { LANEBOARD_CONFIG: '/dev/null' }));
  assert.equal(r3.code, 0, r3.stderr);
  assert.ok(fs.existsSync(path.join(home, 'xdg-state', 'laneboard', 'paused', 'ALL')));
});

test('resume leaves a kind:budget sentinel in place and prints the remote-only hint', async (t) => {
  const home = tmpHome(t);
  const sd = path.join(home, 'state');
  const env = envFor(home, { LANEBOARD_STATE_DIR: sd });
  pause.pause('builder-a', { kind: 'budget', by: 'budget' }, { stateDir: sd });
  pause.pause('ALL', { kind: 'quota', by: 'quota' }, { stateDir: sd });

  const r = await run(['resume', 'builder-a'], env);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /budget\/quota pauses are lifted from the UI \(remote-only\)/);
  assert.equal(read(path.join(sd, 'paused', 'builder-a')).kind, 'budget');

  const r2 = await run(['resume', '--all'], env);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /remote-only/);
  assert.equal(read(path.join(sd, 'paused', 'ALL')).kind, 'quota');

  // pause over a budget pause never downgrades it.
  const r3 = await run(['pause', 'builder-a'], env);
  assert.equal(r3.code, 0, r3.stderr);
  assert.match(r3.stdout, /already paused \(kind budget\)/);
  assert.equal(read(path.join(sd, 'paused', 'builder-a')).kind, 'budget');

  const l = await run(['paused'], env);
  assert.equal(l.code, 0, l.stderr);
  const lines = l.stdout.split('\n');
  assert.match(lines[0], /SCOPE\s+KIND/);
  assert.match(lines[1], /^ALL\s+quota/);
  assert.match(lines[2], /^builder-a\s+budget/);
  assert.match(l.stdout, /remote-only/);
});

test('resume lifts an operator pause and its sid- mirrors; resuming nothing is not an error', async (t) => {
  const home = tmpHome(t);
  const sd = path.join(home, 'state');
  const env = envFor(home, { LANEBOARD_STATE_DIR: sd });
  assert.equal((await run(['pause', 'builder-a'], env)).code, 0);
  pause.syncMirrors([{ name: 'builder-a', sessionId: 'abc123' }], { stateDir: sd });
  assert.ok(fs.existsSync(path.join(sd, 'paused', 'sid-abc123')));
  pause.pause('ALL', {}, { stateDir: sd });

  const r = await run(['resume', 'builder-a'], env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /resumed builder-a/);
  assert.match(r.stdout, /builder-wide pause \(ALL, kind operator\) still holds/);
  assert.equal(fs.existsSync(path.join(sd, 'paused', 'builder-a')), false);
  assert.equal(fs.existsSync(path.join(sd, 'paused', 'sid-abc123')), false);

  const r2 = await run(['resume', 'hub'], env);
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /hub was not paused/);
});

test('paused with nothing paused prints (none); usage errors exit 2 and write nothing', async (t) => {
  const home = tmpHome(t);
  const sd = path.join(home, 'state');
  const env = envFor(home, { LANEBOARD_STATE_DIR: sd });
  const l = await run(['paused'], env);
  assert.equal(l.code, 0, l.stderr);
  assert.equal(l.stdout.trim(), '(none)');

  for (const args of [['pause'], ['resume'], ['pause', '--all', 'builder-a'], ['pause', '../x'], ['pause', 'sid-abc'],
    ['pause', '.hidden'], ['pause', 'a', 'b'], ['paused', 'extra']]) {
    const r = await run(args, env);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.equal(fs.existsSync(sd), false);
});

test('paused cleans terminal escapes from sentinel text (S11b)', async (t) => {
  const home = tmpHome(t);
  const sd = path.join(home, 'state');
  pause.pause('builder-a', { by: 'x\u001b]52;c;ZXZpbA==\u0007y', reason: 'r\u001b[2Jz\u009b' }, { stateDir: sd });
  const l = await run(['paused'], envFor(home, { LANEBOARD_STATE_DIR: sd }));
  assert.equal(l.code, 0, l.stderr);
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(l.stdout), false, JSON.stringify(l.stdout));
  assert.match(l.stdout, /builder-a/);
  const j = await run(['paused', '--json'], envFor(home, { LANEBOARD_STATE_DIR: sd }));
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(j.stdout), false);
  // Still valid JSON carrying the original text (escaped, not dropped).
  assert.equal(JSON.parse(j.stdout).paused[0].reason, 'r\u001b[2Jz\u009b');
});

test('pause/paused/resume --all with LANEBOARD_STATE_DIR touch the state dir only, nothing under HOME (n3 T52)', async (t) => {
  const home = tmpHome(t);
  const sd = tmpHome(t); // a separate tree: anything written outside it shows up under home
  const env = envFor(home, { LANEBOARD_STATE_DIR: sd });
  const before = fs.readdirSync(home);
  const p = await run(['pause', '--all'], env, home);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(read(path.join(sd, 'paused', 'ALL')).kind, 'operator');
  const l = await run(['paused', '--json'], env, home);
  assert.equal(l.code, 0, l.stderr);
  const j = JSON.parse(l.stdout);
  assert.equal(j.stateDir, sd);
  assert.deepEqual(j.paused.map((e) => e.scope), ['ALL']);
  assert.deepEqual(fs.readdirSync(home), before, 'nothing written under HOME (cwd too)');
  const r = await run(['resume', '--all'], env, home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(sd, 'paused')), false);
  assert.deepEqual(fs.readdirSync(home), before, 'nothing written under HOME (cwd too)');
});

test('README says which CLI commands stay in LANEBOARD_STATE_DIR and which write elsewhere by design', () => {
  const readme = fs.readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  assert.match(readme, /with `LANEBOARD_STATE_DIR` set, `laneboard\s+pause`, `resume` and `paused`/);
  assert.match(readme, /`laneboard run`\s+without `--post` appends to `\.\/\.laneboard\/run\.jsonl`/);
  assert.match(readme, /`laneboard fleet keygen` without `--out`/);
  assert.match(readme, /`laneboard fleet pubkey` without `--key` reads that same file/);
});
