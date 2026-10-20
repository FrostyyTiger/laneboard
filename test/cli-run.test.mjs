// Offline CLI run-protocol commands (runs plan §3 A1, task T6): `laneboard run
// start|round|score|needs|artifact|stop` append one line that parseLine accepts,
// to --file, $LANEBOARD_RUN_FILE or ./.laneboard/run.jsonl, or POST it with
// --post. Bad arguments exit 2 and write nothing. Every run uses a temp HOME and
// cwd; LANEBOARD_URL points at a closed port unless a test serves one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine, parseLines, foldRun } from '../server/runs/protocol.mjs';

const BIN = fileURLToPath(new URL('../bin/laneboard', import.meta.url));

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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

const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('every subcommand writes one line parseLine accepts, to ./.laneboard/run.jsonl by default', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const calls = [
    ['start', '--run', 'readiness', '--goal', 'Make acme-api ready for review', '--plan', 'docs/plans/x.md',
      '--branch', 'run/x', '--deadline', '2026-10-21T05:00:00Z', '--rounds', '15', '--window-pct', '90'],
    ['round', '--run', 'readiness', '--n', '3', '--role', 'builder', '--task', 'A2.4'],
    ['score', '--run', 'readiness', '--name', 'tests', '--value', '0.93', '--better', 'higher'],
    ['round', '--run', 'readiness', '--n', '3', '--end', '--outcome', 'kept', '--commit', '0123456', '--open', '4', '--usd', '1.25'],
    ['needs', '--run', 'readiness', '--kind', 'decision', '--text', 'Drop the v1 export?', '--link', 'https://example.invalid/acme/acme-api/pull/7'],
    ['artifact', '--run', 'readiness', '--kind', 'pr', '--url', 'https://example.invalid/acme/acme-api/pull/7', '--title', 'v2 export'],
    ['stop', '--run', 'readiness', '--reason', 'done', '--rounds', '3', '--usd', '3.75'],
  ];
  const before = Date.now();
  for (const args of calls) {
    const r = await run(['run', ...args], env, dir);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
  }
  const file = path.join(dir, '.laneboard', 'run.jsonl');
  const got = lines(file);
  assert.equal(got.length, calls.length);
  const events = got.map((l) => {
    const p = parseLine(l);
    assert.ok(p.ok, `${l}: ${p.reason}`);
    assert.equal(p.event.known, true);
    assert.equal(p.event.v, 1);
    assert.ok(p.event.ts >= before && p.event.ts <= Date.now());
    return p.event;
  });
  assert.deepEqual(events.map((e) => e.t), ['run.start', 'round.start', 'score', 'round.end', 'needs', 'artifact', 'run.stop']);
  assert.deepEqual(events[0].budget, { rounds: 15, windowPct: 90, pause5h: null, stop7d: null });
  assert.equal(events[0].deadline, '2026-10-21T05:00:00Z');
  assert.equal(JSON.parse(got[3]).commit, '0123456', 'commit stays a string');
  assert.equal(events[3].usd, 1.25);

  const run1 = foldRun(events);
  assert.equal(run1.goal, 'Make acme-api ready for review');
  assert.equal(run1.state, 'stopped');
  assert.equal(run1.stop.reason, 'done');
  assert.deepEqual(run1.rounds.map((r) => [r.n, r.role, r.task, r.outcome, r.commit]), [[3, 'builder', 'A2.4', 'kept', '0123456']]);
  assert.deepEqual(run1.scores.tests.map((s) => [s.n, s.value]), [[3, 0.93]]);
  assert.equal(run1.artifacts.length, 1);
});

test('round prints an export line for eval; --run then defaults from $LANEBOARD_RUN', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'out', 'r.jsonl');
  const r = await run(['run', 'round', '--run', 'nightly', '--n', '2', '--file', file], envFor(dir), dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'export LANEBOARD_RUN=nightly/2\n');
  const end = await run(['run', 'round', '--n', '2', '--end', '--file', file], envFor(dir, { LANEBOARD_RUN: 'nightly/2' }), dir);
  assert.equal(end.code, 0, end.stderr);
  assert.equal(end.stdout, '', 'a round end prints nothing');
  const sc = await run(['run', 'score', '--name', 'tasks', '--value', '4', '--better', 'higher', '--file', file],
    envFor(dir, { LANEBOARD_RUN: 'nightly/2' }), dir);
  assert.equal(sc.code, 0, sc.stderr);
  const evs = lines(file).map((l) => JSON.parse(l));
  assert.deepEqual(evs.map((e) => [e.t, e.run]), [['round.start', 'nightly'], ['round.end', 'nightly'], ['score', 'nightly']]);
  assert.equal(fs.existsSync(path.join(dir, '.laneboard')), false, '--file wins over the default');
});

test('$LANEBOARD_RUN_FILE is used when there is no --file; a relative path resolves against the cwd', async (t) => {
  const dir = tmpDir(t);
  const r = await run(['run', 'needs', '--run', 'r1', '--kind', 'wait', '--text', 'usage window'],
    envFor(dir, { LANEBOARD_RUN_FILE: 'logs/run.jsonl' }), dir);
  assert.equal(r.code, 0, r.stderr);
  const got = lines(path.join(dir, 'logs', 'run.jsonl'));
  assert.equal(got.length, 1);
  assert.equal(parseLine(got[0]).event.kind, 'wait');
});

test('bad arguments exit 2 and write nothing', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const bad = [
    [],
    ['nope', '--run', 'r1'],
    ['start'], // no --run, no LANEBOARD_RUN
    ['start', '--run', '../x'],
    ['start', '--run', '.hidden'],
    ['start', '--run', 'r1', 'extra'],
    ['start', '--run', 'r1', '--goal'],
    ['start', '--run', 'r1', '--rounds', 'many'],
    ['start', '--run', 'r1', '--rounds', '1.5'],
    ['start', '--run', 'r1', '--goal', 'a', '--goal', 'b'],
    ['start', '--run', 'r1', '--name', 'tests'], // a flag of another subcommand
    ['round', '--run', 'r1'],
    ['round', '--run', 'r1', '--n', '-1'],
    ['round', '--run', 'r1', '--n', 'x'],
    ['round', '--run', 'r1', '--n', '2', '--outcome', 'kept'], // end field without --end
    ['round', '--run', 'r1', '--n', '2', '--end', '--role', 'builder'],
    ['score', '--run', 'r1', '--name', 'tests'],
    ['score', '--run', 'r1', '--value', '1'],
    ['score', '--run', 'r1', '--name', 'tests', '--value', 'NaN'],
    ['score', '--run', 'r1', '--name', 'tests', '--value', '1', '--better', 'up'],
    ['artifact', '--run', 'r1', '--kind', 'pr'],
    ['stop', '--run', 'r1', '--file', path.join(dir, 'f.jsonl'), '--post'],
    ['needs', '--run', 'r1', '--text', 'x'.repeat(17 * 1024)], // over MAX_LINE: parseLine would skip it
  ];
  for (const args of bad) {
    const r = await run(['run', ...args], env, dir);
    assert.equal(r.code, 2, `run ${args.join(' ').slice(0, 80)}: ${r.stderr.slice(0, 200)}`);
    if (args.length === 0) { assert.match(r.stderr, /usage: laneboard run/); continue; }
    // One line saying what is wrong, then where the help is; not the whole usage block.
    assert.doesNotMatch(r.stderr, /usage: laneboard run/, args.join(' ').slice(0, 80));
    assert.match(r.stderr, /^laneboard: run: .+\nsee: laneboard run --help\n$/, args.join(' ').slice(0, 80));
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing was written');
  const help = await run(['run', '--help'], env, dir);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: laneboard run/);
  // --run is optional (it falls back to $LANEBOARD_RUN) and the common flags are explained.
  assert.match(help.stdout, /\[--run <id>\]/);
  assert.doesNotMatch(help.stdout, /<sub> --run <id>/);
  assert.match(help.stdout, /^  --run <id> .*\$LANEBOARD_RUN/m);
  assert.match(help.stdout, /^  --file f .*\$LANEBOARD_RUN_FILE/m);
  assert.match(help.stdout, /^  --post .*POST \/api\/runs\/events/m);
});

test('laneboard --help lists the run subcommand', async (t) => {
  const dir = tmpDir(t);
  const help = await run(['--help'], envFor(dir), dir);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /^  laneboard run start\|round\|score\|needs\|artifact\|stop /m);
  assert.match(help.stdout, /laneboard run --help/);
});

test('--run, --file and --post may come before the subcommand; other flags there are a short error', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const file = path.join(dir, 'first.jsonl');
  const r = await run(['run', '--file', file, '--run', 'r1', 'round', '--n', '2'], env, dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'export LANEBOARD_RUN=r1/2\n');
  const sc = await run(['run', '--run', 'r1', 'score', '--file', file, '--name', 'tests', '--value', '1'], env, dir);
  assert.equal(sc.code, 0, sc.stderr);
  const got = lines(file).map((l) => JSON.parse(l));
  assert.deepEqual(got.map((e) => [e.t, e.run]), [['round.start', 'r1'], ['score', 'r1']]);
  for (const l of lines(file)) assert.ok(parseLine(l).ok, l);

  const twice = await run(['run', '--run', 'r1', 'stop', '--run', 'r2', '--file', file], env, dir);
  assert.equal(twice.code, 2);
  assert.match(twice.stderr, /--run given twice/);
  const misplaced = await run(['run', '--goal', 'x', 'start', '--run', 'r1', '--file', file], env, dir);
  assert.equal(misplaced.code, 2);
  assert.match(misplaced.stderr, /"--goal" goes after the subcommand/);
  assert.match(misplaced.stderr, /see: laneboard run --help/);
  const both = await run(['run', '--post', 'stop', '--run', 'r1', '--file', file], env, dir);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--file and --post do not go together/);
  assert.equal(lines(file).length, 2, 'the refused calls wrote nothing');
});

test('--post sends the event to POST /api/runs/events with the x-laneboard header, and writes no file', async (t) => {
  const dir = tmpDir(t);
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, header: req.headers['x-laneboard'], body });
      const ev = JSON.parse(body);
      if (ev.t === 'score') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'refused by the test' }));
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, run: ev.run, t: ev.t }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const env = envFor(dir, { LANEBOARD_URL: `http://127.0.0.1:${server.address().port}` });

  const r = await run(['run', 'artifact', '--run', 'r1', '--url', 'https://example.invalid/acme/pull/1', '--post'], env, dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/runs/events');
  assert.equal(seen[0].header, '1');
  assert.equal(parseLine(seen[0].body).ok, true);
  assert.equal(fs.existsSync(path.join(dir, '.laneboard')), false);

  const bad = await run(['run', 'score', '--run', 'r1', '--name', 'tests', '--value', '1', '--post'], env, dir);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /refused by the test/);

  const down = await run(['run', 'stop', '--run', 'r1', '--post'], envFor(dir), dir);
  assert.equal(down.code, 1);
  assert.match(down.stderr, /cannot reach the laneboard/);
});

test('the lines fold like any writer\'s: a whole file of CLI output parses with nothing skipped', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  for (let n = 1; n <= 2; n += 1) {
    assert.equal((await run(['run', 'round', '--run', 'r1', '--n', String(n)], env, dir)).code, 0);
    assert.equal((await run(['run', 'score', '--run', 'r1', '--name', 'tests', '--value', String(n * 10), '--n', String(n)], env, dir)).code, 0);
  }
  const { events, skipped } = parseLines(fs.readFileSync(path.join(dir, '.laneboard', 'run.jsonl'), 'utf8'));
  assert.deepEqual(skipped, {});
  assert.deepEqual(foldRun(events).scores.tests.map((s) => [s.n, s.value]), [[1, 10], [2, 20]]);
});
