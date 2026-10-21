// Offline CLI run-protocol commands (runs plan §3 A1, task T6): `laneboard run
// start|round|score|needs|ack|artifact|stop|cost` append one line that parseLine accepts,
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

const RUN_SUB_NAMES = ['start', 'round', 'score', 'needs', 'ack', 'artifact', 'stop', 'cost'];
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
      '--branch', 'run/x', '--host', 'builder-a', '--deadline', '2026-10-21T05:00:00Z', '--max-rounds', '15', '--window-pct', '90'],
    ['round', '--run', 'readiness', '--n', '3', '--role', 'builder', '--task', 'A2.4'],
    ['score', '--run', 'readiness', '--name', 'tests', '--value', '0.93', '--better', 'higher', '--max', '1'],
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
  assert.deepEqual(events[0].budget, { maxRounds: 15, rounds: 15, windowPct: 90, pause5h: null, stop7d: null });
  assert.equal(events[0].deadline, '2026-10-21T05:00:00Z');
  assert.equal(events[0].host, 'builder-a');
  assert.equal(events[2].max, 1);
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

test('artifact --state merged writes the state; the help names it (night 5 T1)', async (t) => {
  const dir = tmpDir(t);
  const url = 'https://example.invalid/acme/acme-api/pull/7';
  const r = await run(['run', 'artifact', '--run', 'readiness', '--kind', 'pr', '--url', url, '--state', 'merged'], envFor(dir), dir);
  assert.equal(r.code, 0, r.stderr);
  const [l] = lines(path.join(dir, '.laneboard', 'run.jsonl'));
  assert.equal(JSON.parse(l).state, 'merged');
  const p = parseLine(l);
  assert.ok(p.ok);
  assert.equal(p.event.state, 'merged');
  const help = await run(['run', 'artifact', '--help'], envFor(dir), dir);
  assert.match(help.stdout + help.stderr, /artifact --url u .*--state open\|merged\|closed/);
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

test('start without --run keeps an inherited $LANEBOARD_RUN and says so; with neither the error names --run <id>', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'r.jsonl');
  const r = await run(['run', 'start', '--goal', 'g', '--file', file], envFor(dir, { LANEBOARD_RUN: 'old-run/7' }), dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr.split('\n')[0], 'run id old-run from $LANEBOARD_RUN');
  assert.equal(JSON.parse(lines(file)[0]).run, 'old-run');
  // An explicit --run wins and needs no note; other subcommands inherit quietly.
  const own = await run(['run', 'start', '--run', 'new-run', '--file', file], envFor(dir, { LANEBOARD_RUN: 'old-run/7' }), dir);
  assert.equal(own.code, 0, own.stderr);
  assert.doesNotMatch(own.stderr, /LANEBOARD_RUN/);
  const sc = await run(['run', 'score', '--name', 'tasks', '--value', '1', '--file', file], envFor(dir, { LANEBOARD_RUN: 'old-run/7' }), dir);
  assert.equal(sc.code, 0, sc.stderr);
  assert.doesNotMatch(sc.stderr, /from \$LANEBOARD_RUN/);
  const none = await run(['run', 'start', '--goal', 'g', '--file', file], envFor(dir), dir);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /--run <id> is required \(or set \$LANEBOARD_RUN\)/);
  const help = await run(['run', 'start', '--help'], envFor(dir), dir);
  assert.match(help.stdout, /`start` says so on stderr/);
});

test('start --max-rounds N writes the cap; --rounds N on start is its alias with a stderr note (T24)', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'r.jsonl');
  const max = await run(['run', 'start', '--run', 'r1', '--max-rounds', '3', '--file', file], envFor(dir), dir);
  assert.equal(max.code, 0, max.stderr);
  assert.doesNotMatch(max.stderr, /means --max-rounds/);
  const old = await run(['run', 'start', '--run', 'r1', '--rounds', '3', '--file', file], envFor(dir), dir);
  assert.equal(old.code, 0, old.stderr);
  assert.match(old.stderr, /^--rounds on start means --max-rounds$/m);
  const [a, b] = lines(file).map((l) => JSON.parse(l));
  assert.deepEqual(a.budget, { maxRounds: 3 });
  const { ts: _a, ...restA } = a;
  const { ts: _b, ...restB } = b;
  assert.deepEqual(restB, restA, 'both spellings write the same line');
  // `--rounds` on stop stays the count done, with no note.
  const stop = await run(['run', 'stop', '--run', 'r1', '--rounds', '2', '--file', file], envFor(dir), dir);
  assert.equal(stop.code, 0, stop.stderr);
  assert.doesNotMatch(stop.stderr, /max-rounds/);
  assert.equal(JSON.parse(lines(file)[2]).rounds, 2);
  const startHelp = await run(['run', 'start', '--help'], envFor(dir), dir);
  assert.match(startHelp.stdout, /\[--max-rounds N\]/);
  assert.match(startHelp.stdout, /--max-rounds N is the round cap; --rounds N on start is its old name/);
  const stopHelp = await run(['run', 'stop', '--help'], envFor(dir), dir);
  assert.match(stopHelp.stdout, /--rounds N on stop is the count of rounds done, not the cap/);
  assert.doesNotMatch(stopHelp.stdout, /max-rounds/);
  const usage = await run(['run', '--help'], envFor(dir), dir);
  assert.match(usage.stdout, /--max-rounds N is the round cap/);
  assert.match(usage.stdout, /--rounds N on stop is the count of rounds done/);
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
    ['start', '--run', 'r1', '--max-rounds', 'many'],
    ['start', '--run', 'r1', '--rounds', '3', '--max-rounds', '3'], // the cap under both names
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
    ['ack', '--run', 'r1'], // no ref
    ['ack', 'r1'], // one word is the ref, and there is no run
    ['ack', '--run', 'r1', 'soon'], // not a place nor a time
    ['ack', '--run', 'r1', 'r2', '0'], // the run twice
    ['ack', 'r1', '0', 'extra'],
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

test('`run <sub> --help` prints that subcommand\'s usage, exit 0, and writes nothing (night 4 T33)', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir, { LANEBOARD_RUN: 'r1/1' });
  const cases = [
    [['start', '--help'], /^usage: laneboard run start \[--goal g\]/m],
    [['round', '-h'], /^usage: laneboard run round --n N --end /m],
    [['round', '--help'], /^usage: laneboard run round --n N \[--role r\].*eval "\$\(laneboard run round --n N/m],
    [['score', '--run', 'r1', '--help'], /^usage: laneboard run score --name m --value x/m],
    [['needs', '--kind', 'wait', '--help'], /^usage: laneboard run needs /m],
    [['ack', '0', '--help'], /^usage: laneboard run ack \[<run>\] <ref>.*already acked: nothing sent, exit 0/m],
    [['--post', 'stop', '--help'], /^usage: laneboard run stop \[--reason /m],
  ];
  for (const [args, want] of cases) {
    const r = await run(['run', ...args], env, dir);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stdout, want, args.join(' '));
    // Only that subcommand's lines, then the common flags.
    const sub = args.find((a) => RUN_SUB_NAMES.includes(a));
    const named = [...r.stdout.matchAll(/^usage: laneboard run (\S+)/gm)].map((m) => m[1]);
    assert.deepEqual([...new Set(named)], [sub], args.join(' '));
    assert.match(r.stdout, /^  --file f .*\$LANEBOARD_RUN_FILE/m);
    assert.equal(r.stderr, '', args.join(' '));
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing was written');
  // A --help that is a flag's value is the value, not a help request.
  const text = await run(['run', 'needs', '--text', '--help'], env, dir);
  assert.equal(text.code, 0, text.stderr);
  const [line] = fs.readFileSync(path.join(dir, '.laneboard', 'run.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(line).text, '--help');
});

test('laneboard --help lists the run subcommand', async (t) => {
  const dir = tmpDir(t);
  const help = await run(['--help'], envFor(dir), dir);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /^  laneboard run start\|round\|score\|needs\|ack\|artifact\|stop\|cost /m);
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

test('ack closes a need by its place or its ts: `ack <run> <ref>`, `ack <ref>` with --run, --by', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const file = path.join(dir, 'r.jsonl');
  const ok = async (args, e = env) => {
    const r = await run(['run', ...args, '--file', file], e, dir);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '');
  };
  await ok(['needs', '--run', 'r1', '--text', 'first?']);
  await ok(['needs', '--run', 'r1', '--text', 'second?']);
  await ok(['needs', '--run', 'r1', '--text', 'third?']);
  const third = JSON.parse(lines(file)[2]).ts;
  await ok(['ack', 'r1', '0', '--by', 'owner']);
  await ok(['ack', '--run', 'r1', String(third)]);
  await ok(['ack', '1'], envFor(dir, { LANEBOARD_RUN: 'r1/4' }));
  const got = lines(file).slice(3).map((l) => JSON.parse(l));
  assert.deepEqual(got.map((e) => [e.t, e.run, e.ref]), [['needs.ack', 'r1', 0], ['needs.ack', 'r1', third], ['needs.ack', 'r1', 1]]);
  assert.equal(got[0].by, 'owner');
  const { events, skipped } = parseLines(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(skipped, {});
  const folded = foldRun(events);
  assert.deepEqual(folded.needs.map((n) => [n.text, n.open, n.by]), [['first?', false, 'owner'], ['second?', false, null], ['third?', false, null]]);
  assert.deepEqual(folded.raw, []);
});

test('every subcommand prints one receipt on stderr: `ok <run> <type> appended to <file>` or `posted` (night 4 T21)', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'r.jsonl');
  const calls = [
    [['start', '--run', 'r1', '--goal', 'g'], 'run.start'],
    [['round', '--run', 'r1', '--n', '1'], 'round.start'],
    [['score', '--run', 'r1', '--name', 'tests', '--value', '1'], 'score'],
    [['needs', '--run', 'r1', '--text', 'q?'], 'needs'],
    [['ack', 'r1', '0', '--by', 'owner'], 'needs.ack'],
    [['round', '--run', 'r1', '--n', '1', '--end'], 'round.end'],
    [['stop', '--run', 'r1', '--reason', 'done'], 'run.stop'],
  ];
  for (const [args, type] of calls) {
    const r = await run(['run', ...args, '--file', file], envFor(dir), dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, `ok r1 ${type} appended to ${file}\n`, args.join(' '));
  }
  assert.equal(lines(file).length, calls.length);

  const posted = [];
  // GET /api/runs/r1: one plain need and one fence need; any other run is unknown.
  const needs = [{ i: 0, kind: 'decision', ts: 1, acked: false }, { i: 1, kind: 'fence', ts: 2, acked: false }];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'GET') {
        const known = req.url === '/api/runs/r1';
        res.writeHead(known ? 200 : 404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(known ? { run: { id: 'r1', needs } } : { error: 'unknown run' }));
      }
      const ev = JSON.parse(body);
      posted.push(ev);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, run: ev.run, t: ev.t }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const env = envFor(dir, { LANEBOARD_URL: `http://127.0.0.1:${server.address().port}` });
  const p = await run(['run', 'score', '--run', 'r1', '--name', 'tests', '--value', '1', '--post'], env, dir);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(p.stderr, 'ok r1 score posted\n');
  // T35: the server's needs decide. Need 0 is plain: no --by warning.
  const pa = await run(['run', 'ack', 'r1', '0', '--post'], env, dir);
  assert.equal(pa.code, 0, pa.stderr);
  assert.equal(pa.stderr, 'ok r1 needs.ack posted\n');
  // Need 1 is a fence need: the warning says it is advisory and the ack is still posted.
  const pf = await run(['run', 'ack', 'r1', '1', '--post'], env, dir);
  assert.equal(pf.code, 0, pf.stderr);
  assert.equal(pf.stderr, 'ok r1 needs.ack posted\nwarning: no --by: a fence need closes only with --by "inbox", "run page", "owner"; advisory: the ack is posted, need 1 stays open\n');
  const pb = await run(['run', 'ack', 'r1', '1', '--by', 'inbox', '--post'], env, dir);
  assert.equal(pb.stderr, 'ok r1 needs.ack posted\n');
  // A ref that names no need (or a run the server does not know): nothing posted, exit 1.
  const posts = () => posted.length;
  const n0 = posts();
  for (const args of [['r1', '3'], ['nope', '0']]) {
    const r = await run(['run', 'ack', ...args, '--post'], env, dir);
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.stderr, `laneboard: no need ${args[1]} in run ${args[0]} on ${env.LANEBOARD_URL}; nothing posted\n`);
  }
  assert.equal(posts(), n0, 'a missing ref is not posted');
  // T39: need 0 acked twice; the server's copy says it is closed: nothing posted, exit 0.
  needs[0].acked = true;
  const twice = await run(['run', 'ack', 'r1', '0', '--post'], env, dir);
  assert.equal(twice.code, 0, twice.stderr);
  assert.equal(twice.stderr, 'need 0 already acked, nothing posted\n');
  assert.equal(posts(), n0, 'a second ack is not posted');
});

test('ack warns (exit 0, still written) for a fence need without a person\'s --by; a ref that names no need writes nothing and exits 1 (night 4 T21, T35)', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'r.jsonl');
  const go = (args) => run(['run', ...args, '--file', file], envFor(dir), dir);
  assert.equal((await go(['needs', '--run', 'r1', '--kind', 'fence', '--text', 'touched server/http.mjs'])).code, 0);
  assert.equal((await go(['needs', '--run', 'r1', '--text', 'plain question'])).code, 0);
  assert.equal((await go(['needs', '--run', 'other', '--text', 'another run'])).code, 0);

  const bare = await go(['ack', 'r1', '0']);
  assert.equal(bare.code, 0);
  assert.equal(bare.stdout, '');
  assert.match(bare.stderr, /^ok r1 needs\.ack appended to .+\nwarning: no --by: a fence need closes only with --by "inbox", "run page", "owner"; advisory: the ack is written, need 0 stays open\n$/);
  const loop = await go(['ack', 'r1', '0', '--by', 'loop']);
  assert.match(loop.stderr, /\nwarning: --by "loop": a fence need closes only with/);
  // A plain need closes with any by; a person's by closes the fence need: no warning.
  assert.doesNotMatch((await go(['ack', 'r1', '1'])).stderr, /warning/);
  assert.doesNotMatch((await go(['ack', 'r1', '0', '--by', 'owner'])).stderr, /warning/);
  // T39: once closed, a later ack would change nothing: it says so, writes no line, exit 0.
  const closed = lines(file).length;
  for (const ref of ['0', '1']) {
    const again = await go(['ack', 'r1', ref]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, '');
    assert.equal(again.stderr, `need ${ref} already acked, nothing written\n`);
  }
  assert.equal(lines(file).length, closed, 'a second ack is not written');

  const before = lines(file).length;
  const folded = foldRun(parseLines(fs.readFileSync(file, 'utf8')).events.filter((e) => e.run === 'r1'));
  assert.deepEqual(folded.needs.map((n) => [n.kind, n.open, n.by]), [['fence', false, 'owner'], ['decision', false, null]]);
  assert.equal(before, 3 + 4);

  // r1 has two needs here (place 2 is the other run's); a ts that matches none; a
  // missing file. Offline the check sees this file only, and the server merges
  // every source of the run: a ref missing here is warned about and still written.
  for (const ref of ['2', '2026-01-01T00:00:00Z']) {
    const r = await go(['ack', 'r1', ref]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`^ok r1 needs\\.ack appended to .+\\nwarning: no need ${ref} in run r1 in this file \\(offline: the server may know it from another source\\); written anyway\\n$`));
  }
  assert.equal(lines(file).length, before + 2, 'an offline ack of an unknown ref is written');
  const fresh = path.join(dir, 'none.jsonl');
  const none = await run(['run', 'ack', 'r1', '0', '--file', fresh], envFor(dir), dir);
  assert.equal(none.code, 0, none.stderr);
  assert.match(none.stderr, /\nwarning: no need 0 in run r1 in this file/);
  assert.equal(lines(fresh).length, 1);
});

test('a file ack checks the server\'s merged needs when it knows the run; an unknown run falls back to the file', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'r.jsonl');
  // The server knows r1 with one need from another source; the file has none.
  const server = http.createServer((req, res) => {
    const known = req.method === 'GET' && req.url === '/api/runs/r1';
    res.writeHead(known ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(known ? { run: { id: 'r1', needs: [{ i: 0, kind: 'decision', ts: 1, acked: false }] } } : { error: 'unknown run' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const env = envFor(dir, { LANEBOARD_URL: `http://127.0.0.1:${server.address().port}` });
  const ok = await run(['run', 'ack', 'r1', '0', '--file', file], env, dir);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stderr, `ok r1 needs.ack appended to ${file}\n`, 'need 0 is the server\'s, no warning');
  const typo = await run(['run', 'ack', 'r1', '5', '--file', file], env, dir);
  assert.equal(typo.code, 1);
  assert.equal(typo.stderr, `laneboard: no need 5 in run r1 on ${env.LANEBOARD_URL}; nothing written\n`);
  assert.equal(lines(file).length, 1, 'a ref the server does not have is not written');
  const other = await run(['run', 'ack', 'r2', '0', '--file', file], env, dir);
  assert.equal(other.code, 0, other.stderr);
  assert.match(other.stderr, /\nwarning: no need 0 in run r2 in this file \(offline/);
});

test('T6: `run cost --usd x --n N` writes a cost event; the help has it and says a round\'s --usd is that round\'s only', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'c.jsonl');
  const r = await run(['run', 'cost', '--run', 'r1', '--usd', '1.84', '--n', '3', '--file', file], envFor(dir), dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, `ok r1 cost appended to ${file}\n`);
  const p = parseLine(lines(file)[0]);
  assert.equal(p.ok, true);
  assert.equal(p.event.t, 'cost');
  assert.equal(p.event.usd, 1.84);
  assert.equal(p.event.n, 3);
  const none = await run(['run', 'cost', '--run', 'r1', '--file', file], envFor(dir), dir);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /cost needs --usd/);
  assert.equal(lines(file).length, 1);

  const help = await run(['run', '--help'], envFor(dir), dir);
  assert.match(help.stdout, /^ {2}cost {5}--usd x \[--n N\] /m);
  assert.match(help.stdout, /^ {2}round .*--end .*--usd x\] +--usd is this round only/m);
  const sub = await run(['run', 'cost', '--help'], envFor(dir), dir);
  assert.match(sub.stdout, /^usage: laneboard run cost --usd x \[--n N\]/m);
});

test('T6: --post prints what the server accepted: its run and type, and the fields it dropped', async (t) => {
  const dir = tmpDir(t);
  let answer = (ev) => ({ ok: true, run: ev.run, t: ev.t, dropped: ['state'] });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer(JSON.parse(body))));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const env = envFor(dir, { LANEBOARD_URL: `http://127.0.0.1:${server.address().port}` });
  const url = 'https://example.invalid/acme/pull/1';
  const a = await run(['run', 'artifact', '--run', 'r1', '--url', url, '--state', 'shipped', '--post'], env, dir);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.stderr, 'ok r1 artifact posted, dropped: state\n');
  // An older server sends no `dropped`: the CLI's own check names the field.
  answer = (ev) => ({ ok: true, run: ev.run, t: ev.t });
  const old = await run(['run', 'artifact', '--run', 'r1', '--url', url, '--state', 'shipped', '--post'], env, dir);
  assert.equal(old.stderr, 'ok r1 artifact posted, dropped: state\n');
  const clean = await run(['run', 'cost', '--run', 'r1', '--usd', '0.5', '--post'], env, dir);
  assert.equal(clean.stderr, 'ok r1 cost posted\n');
  // The run and type printed are the server's.
  answer = () => ({ ok: true, run: 'r1', t: 'cost', dropped: [] });
  const echoed = await run(['run', 'cost', '--run', 'r1', '--usd', '0.5', '--post'], env, dir);
  assert.equal(echoed.stderr, 'ok r1 cost posted\n');
});

test('T12: `run needs "text"` takes the bare word as --text; a second word or --text as well is a usage error', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const file = path.join(dir, '.laneboard', 'run.jsonl');
  const ok = await run(['run', 'needs', 'Drop the v1 export?', '--run', 'r1', '--kind', 'decision'], env, dir);
  assert.equal(ok.code, 0, ok.stderr);
  const flagFirst = await run(['run', 'needs', '--run', 'r1', '--link', 'https://example.invalid/acme/pull/7', 'Merge it?'], env, dir);
  assert.equal(flagFirst.code, 0, flagFirst.stderr);
  const got = lines(file).map((l) => JSON.parse(l));
  assert.equal(got[0].text, 'Drop the v1 export?');
  assert.equal(got[0].kind, 'decision');
  assert.equal(got[1].text, 'Merge it?');
  assert.equal(got[1].link, 'https://example.invalid/acme/pull/7');

  const two = await run(['run', 'needs', 'one', 'two', '--run', 'r1'], env, dir);
  assert.equal(two.code, 2);
  assert.match(two.stderr, /unexpected argument: "two"/);
  const both = await run(['run', 'needs', 'one', '--text', 'two', '--run', 'r1'], env, dir);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--text given twice/);
  assert.equal(lines(file).length, 2, 'the refused calls wrote nothing');

  const help = await run(['run', 'needs', '--help'], env, dir);
  assert.match(help.stdout, /needs \["text" \| --text t\]/);
});

test('T32: a subcommand name as the bare word after another (`run needs ack demo 0`) adds a did-you-mean line', async (t) => {
  const dir = tmpDir(t);
  const env = envFor(dir);
  const file = path.join(dir, '.laneboard', 'run.jsonl');
  const r = await run(['run', 'needs', 'ack', 'demo', '0'], env, dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unexpected argument: "demo"\ndid you mean: laneboard run ack \[<run>\] <ref>/);
  const other = await run(['run', 'score', 'needs', '--run', 'r1'], env, dir);
  assert.equal(other.code, 2);
  assert.match(other.stderr, /did you mean: laneboard run needs \["text" \| --text t\]/);
  // Only an unexpected argument gets the hint; a plain error stays one line plus the pointer.
  const plain = await run(['run', 'score', '--run', 'r1', 'oops'], env, dir);
  assert.doesNotMatch(plain.stderr, /did you mean/);
  assert.equal(fs.existsSync(file), false, 'nothing written');
});
