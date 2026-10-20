// The runs routes (docs/plans/runs/README.md §3 A1, T5; docs/runs.md "The API"):
// GET /api/runs, GET /api/runs/:run, POST /api/runs/events. The module runs
// with a test ctx (routes land in an array) and a real collector reading a
// temp copy of the fixture plus <stateDir>/runs/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { createContext } from '../server/modules.mjs';
import runsModule, {
  summarize, listBody, eventLine, eventsFile, appendEvent, BODY_LIMIT,
} from '../server/routes/runs.mjs';
import * as collector from '../server/collector/runs.mjs';
import { parseLines, foldRun, MAX_LINE } from '../server/runs/protocol.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-runs-routes-'));
const stateDir = path.join(tmp, 'state');
const fixture = path.join(import.meta.dirname, 'fixtures', 'runs', 'readiness.jsonl');
const runFile = path.join(tmp, 'acme', '.laneboard', 'run.jsonl');
fs.mkdirSync(path.dirname(runFile), { recursive: true });
fs.copyFileSync(fixture, runFile);

const routes = [];
const ctx = createContext({
  mode: 'builder',
  config: { stateDir, runs: { files: [runFile], lanes: false, maxEvents: 5000, keepDays: 3650 } },
}, { route: (method, pattern, handler) => routes.push({ method, pattern, handler }) });
runsModule.register(ctx);
runsModule.start(ctx);
test.after(() => {
  runsModule.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Call a registered route with a fake request; resolves to {status, body}. */
async function call(method, pattern, { params = {}, body = '' } = {}) {
  const r = routes.find((x) => x.method === method && x.pattern === pattern);
  assert.ok(r, `${method} ${pattern} is registered`);
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = pattern;
  req.headers = {};
  req.params = params;
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(buf) { resolve({ status: this.status, body: JSON.parse(String(buf)) }); },
    };
    Promise.resolve(r.handler(req, res)).catch(reject);
  });
}

const ready = async () => {
  // start() ran the first tick without waiting; one awaited tick makes it certain.
  for (let i = 0; i < 50 && !collector.store()?.get('readiness'); i++) await new Promise((r) => setTimeout(r, 10));
};

test('the module registers the three routes', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.pattern}`).sort(), [
    'GET /api/runs', 'GET /api/runs/:run', 'POST /api/runs/events',
  ]);
});

test('GET /api/runs lists the fixture run as a summary row', async () => {
  await ready();
  const { status, body } = await call('GET', '/api/runs');
  assert.equal(status, 200);
  assert.equal(body.runs.length, 1);
  const row = body.runs[0];
  const folded = foldRun(parseLines(fs.readFileSync(fixture, 'utf8')).events);
  assert.deepEqual(row, JSON.parse(JSON.stringify(summarize(folded))));
  assert.equal(row.run, 'readiness');
  assert.match(row.goal, /^Make acme-api ready/);
  assert.equal(row.maxRounds, 6);
  assert.equal(row.round, folded.rounds.at(-1).n);
  assert.equal(row.scores.tests.better, 'higher');
  assert.equal(row.scores.tests.value, folded.scores.tests.at(-1).value);
  assert.equal(row.scores.tests.prev, folded.scores.tests.at(-2).value);
  assert.equal(row.rounds, folded.rounds.length);
  assert.equal(row.needs.length, folded.needs.filter((n) => n.open).length);
  assert.ok(row.needs.every((n) => n.open));
  assert.equal(row.artifacts, folded.artifacts.length);
  assert.equal(row.cost.usd, folded.cost.usd);
  assert.equal('raw' in row, false, 'the list leaves the detail to the run page');
});

test('GET /api/runs/:run gives the folded run, 404 for an unknown or bad id', async () => {
  await ready();
  const one = await call('GET', '/api/runs/:run', { params: { run: 'readiness' } });
  assert.equal(one.status, 200);
  assert.equal(one.body.run.run, 'readiness');
  assert.ok(Array.isArray(one.body.run.rounds) && one.body.run.rounds.length > 0);
  assert.ok(Array.isArray(one.body.run.raw));
  for (const id of ['nope', '../etc', '', '.hidden']) {
    const r = await call('GET', '/api/runs/:run', { params: { run: id } });
    assert.equal(r.status, 404, id);
    assert.equal(r.body.error, 'unknown run');
  }
});

test('POST /api/runs/events: a bad event is 400 with the reason, nothing written', async () => {
  const cases = [
    ['', 'empty'],
    ['not json', 'not json'],
    ['[1,2]', 'not an object'],
    ['{"t":"run.start","run":"../x"}', 'bad run id'],
    ['{"v":2,"t":"run.start","run":"x"}', 'unsupported version'],
    ['{"t":"cost","run":"x","usd":-1}', 'cost: bad usd'],
  ];
  for (const [body, error] of cases) {
    const r = await call('POST', '/api/runs/events', { body });
    assert.equal(r.status, 400, body);
    assert.equal(r.body.error, error, body);
  }
  assert.equal(fs.existsSync(path.join(stateDir, 'runs')), false);
});

test('POST /api/runs/events: an oversized body is 413', async () => {
  const r = await call('POST', '/api/runs/events', { body: `{"t":"run.start","run":"x","goal":"${'a'.repeat(BODY_LIMIT)}"}` });
  assert.equal(r.status, 413);
  const long = await call('POST', '/api/runs/events', { body: `{"t":"run.start","run":"x","goal":"${'a'.repeat(MAX_LINE)}"}` });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'too long');
});

test('POST /api/runs/events: a good event is appended and shows up in the list', async () => {
  await ready();
  const start = { t: 'run.start', run: 'nightly', goal: 'Make the tests green', budget: { rounds: 3 } };
  const r = await call('POST', '/api/runs/events', { body: JSON.stringify(start, null, 2) });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { ok: true, run: 'nightly', t: 'run.start' });
  const file = path.join(stateDir, 'runs', 'nightly.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(lines.length, 2, 'one compact line plus the final newline');
  const written = JSON.parse(lines[0]);
  assert.equal(written.goal, 'Make the tests green');
  assert.equal(typeof written.ts, 'number', 'the server stamps ts');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const round = await call('POST', '/api/runs/events', { body: '{"t":"round.start","run":"nightly","n":1,"role":"builder","ts":1792483300000}' });
  assert.equal(round.status, 201);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[1]).ts, 1792483300000, 'a given ts is kept');

  // Read at once (track), not after the next discovery pass.
  const list = await call('GET', '/api/runs');
  const row = list.body.runs.find((x) => x.run === 'nightly');
  assert.ok(row, 'the posted run is listed');
  assert.equal(row.goal, 'Make the tests green');
  assert.equal(row.maxRounds, 3);
  assert.equal(row.round, 1);
  const one = await call('GET', '/api/runs/:run', { params: { run: 'nightly' } });
  assert.equal(one.status, 200);
  assert.equal(one.body.run.rounds[0].role, 'builder');
});

test('eventLine and eventsFile are strict about what reaches the disk', () => {
  assert.equal(eventLine('{"t":"x.custom","run":"r1","ts":5000000000000,"a":1}').ok, true);
  assert.deepEqual(eventLine('   '), { ok: false, error: 'empty' });
  const l = eventLine('{"t":"score","run":"r1","name":"tests","value":1}', 1792483200000);
  assert.equal(l.line, '{"t":"score","run":"r1","name":"tests","value":1,"ts":1792483200000}\n');
  assert.equal(eventsFile(stateDir, 'r1'), path.join(stateDir, 'runs', 'r1.jsonl'));
  for (const bad of ['../r1', 'a/b', '.r1', '']) assert.equal(eventsFile(stateDir, bad), null, bad);
  assert.equal(eventsFile(null, 'r1'), null);
});

test('appendEvent refuses an unsafe id', async () => {
  await assert.rejects(appendEvent(stateDir, '../x', '{}\n'), /bad run id/);
});

test('listBody before the collector started is an empty list', () => {
  assert.deepEqual(listBody(null), { runs: [] });
});
