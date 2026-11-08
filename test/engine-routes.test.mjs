// The engine routes (server/routes/engines.mjs), the engine table
// (server/engine/index.mjs) and the promise that GET /api/runs answers
// byte-for-byte as before for run.jsonl runs. The runs module and the engines
// module run on one test ctx against a temp copy of a run.jsonl fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { createContext } from '../server/modules.mjs';
import runsModule, { summarize } from '../server/routes/runs.mjs';
import enginesModule, { READS } from '../server/routes/engines.mjs';
import * as engines from '../server/engine/index.mjs';
import * as collector from '../server/collector/runs.mjs';
import * as fake from '../server/engine/fake.mjs';
import { checkShape } from '../server/engine/contract.mjs';
import { parseLines, foldRun } from '../server/runs/protocol.mjs';
import { mergedDefaults } from '../server/config.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-engine-routes-'));
const stateDir = path.join(tmp, 'state');
const fixture = path.join(import.meta.dirname, 'fixtures', 'runs', 'readiness.jsonl');
const runFile = path.join(tmp, 'acme', '.laneboard', 'run.jsonl');
fs.mkdirSync(path.dirname(runFile), { recursive: true });
fs.copyFileSync(fixture, runFile);

const config = { stateDir, runs: { files: [runFile], lanes: false, maxEvents: 5000, keepDays: 3650 }, engines: [] };
const routes = [];
const ctx = createContext({ mode: 'builder', config }, { route: (method, pattern, handler) => routes.push({ method, pattern, handler }) });

/** Call a registered route; resolves to {status, text, body}: `text` is the exact bytes sent. */
async function call(method, pattern, { params = {}, url = pattern } = {}) {
  const r = routes.find((x) => x.method === method && x.pattern === pattern);
  assert.ok(r, `${method} ${pattern} is registered`);
  const req = Readable.from([]);
  Object.assign(req, { method, url, headers: {}, params });
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(buf) { const text = String(buf); resolve({ status: this.status, text, body: JSON.parse(text) }); },
    };
    Promise.resolve(r.handler(req, res)).catch(reject);
  });
}

const ready = async () => {
  for (let i = 0; i < 100 && !collector.store()?.get('readiness'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(collector.store()?.get('readiness'));
};

// GET /api/runs before the engines module exists: the bytes to keep.
runsModule.register(ctx);
runsModule.start(ctx);
await ready();
const before = await call('GET', '/api/runs');
const beforeOne = await call('GET', '/api/runs', { url: '/api/runs?run=readiness' });

engines._set(engines.build(config).concat(fake.create({ id: 'main' })));
enginesModule.register(ctx);

test.after(() => {
  engines._set(null);
  runsModule.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('GET /api/runs answers byte-for-byte as before, after every engine route was read', async () => {
  for (const id of ['jsonl', 'main']) {
    await call('GET', '/api/engines');
    await call('GET', '/api/engine/:id/runs', { params: { id } });
    await call('GET', '/api/engine/:id/run/:run', { params: { id, run: 'readiness' } });
  }
  const after = await call('GET', '/api/runs');
  assert.equal(after.status, 200);
  assert.equal(after.text, before.text);
  assert.equal((await call('GET', '/api/runs', { url: '/api/runs?run=readiness' })).text, beforeOne.text);
  // And it is still today's summary of the folded file.
  const folded = foldRun(parseLines(fs.readFileSync(fixture, 'utf8')).events);
  assert.deepEqual(after.body.runs[0], JSON.parse(JSON.stringify(summarize(folded))));
});

test('the engines module adds read-only GET routes only', () => {
  const mine = routes.filter((r) => r.pattern.startsWith('/api/engine'));
  assert.ok(mine.length === READS.length + 1);
  assert.ok(mine.every((r) => r.method === 'GET'));
});

test('GET /api/engines: jsonl first, then the configured ones, with state and capabilities', async () => {
  const { status, body } = await call('GET', '/api/engines');
  assert.equal(status, 200);
  assert.equal(body.accepts, '1.x');
  assert.deepEqual(body.engines.map((e) => [e.id, e.kind, e.state]), [['jsonl', 'jsonl', 'up'], ['main', 'fake', 'up']]);
  assert.deepEqual(body.engines[0].capabilities, ['hello', 'runs', 'run', 'act']);
  assert.equal(body.engines[1].contract, '1.0');
});

test('every read route answers the laneboard shape for the fake engine', async () => {
  const p = { id: 'main' };
  const cases = [
    ['/api/engine/:id/hello', 'hello', p],
    ['/api/engine/:id/health', 'health', p],
    ['/api/engine/:id/products', 'products', p],
    ['/api/engine/:id/runs', 'runs', p],
    ['/api/engine/:id/run/:run', 'run', { ...p, run: 'R-20261101-acme-shop-1' }],
    ['/api/engine/:id/events/:run', 'events', { ...p, run: 'R-20261101-acme-shop-1' }, '/api/engine/main/events/R-20261101-acme-shop-1?since=80'],
    ['/api/engine/:id/waiting', 'waiting', p, '/api/engine/main/waiting?for=owner'],
    ['/api/engine/:id/knowledge/:product', 'knowledge', { ...p, product: 'acme-shop' }, '/api/engine/main/knowledge/acme-shop?kind=claim&limit=3'],
  ];
  for (const [pattern, verb, params, url] of cases) {
    const { status, body, text } = await call('GET', pattern, { params, url: url ?? pattern });
    assert.equal(status, 200, `${verb}: ${text}`);
    assert.equal(body.engine, 'main');
    assert.equal(body.stale, false);
    assert.deepEqual(checkShape(verb, body.data), [], verb);
    for (const raw of ['stop_reason', 'events_path', 'usd_notional', 'last_check', 'oldest_contract', 'next_cursor']) {
      assert.equal(text.includes(`"${raw}"`), false, `${verb}: the engine's own field ${raw} never reaches the page`);
    }
  }
  const ev = await call('GET', '/api/engine/:id/events/:run', { params: { id: 'main', run: 'R-20261101-acme-shop-1' }, url: '/x?since=80' });
  assert.deepEqual(ev.body.data.events.map((e) => e.seq), [81, 82, 83]);
  const k = await call('GET', '/api/engine/:id/knowledge/:product', { params: { id: 'main', product: 'acme-shop' }, url: '/x?kind=claim&limit=3' });
  assert.equal(k.body.data.items.length, 3);
});

test('jsonl through the engine routes: its runs as rows, its other verbs unsupported', async () => {
  const runs = await call('GET', '/api/engine/:id/runs', { params: { id: 'jsonl' } });
  assert.equal(runs.status, 200);
  assert.deepEqual(checkShape('runs', runs.body.data), []);
  assert.deepEqual(runs.body.data.runs.map((r) => r.id), before.body.runs.map((r) => r.run));
  assert.equal(runs.body.data.runs[0].goalTitle, before.body.runs[0].goal);
  const one = await call('GET', '/api/engine/:id/run/:run', { params: { id: 'jsonl', run: 'readiness' } });
  assert.equal(one.status, 200);
  assert.equal(one.body.data.run.tree, null);
  assert.deepEqual(checkShape('run', one.body.data), []);
  const products = await call('GET', '/api/engine/:id/products', { params: { id: 'jsonl' } });
  assert.equal(products.status, 404);
  assert.equal(products.body.code, 'unsupported');
});

test('refusals: unknown engine 404, unknown run 404, bad id 400', async () => {
  const r1 = await call('GET', '/api/engine/:id/runs', { params: { id: 'nope' } });
  assert.equal(r1.status, 404);
  assert.match(r1.body.error, /^no engine nope; the list is GET \/api\/engines$/);
  const r2 = await call('GET', '/api/engine/:id/run/:run', { params: { id: 'main', run: 'R-20990101-acme-shop-9' } });
  assert.equal(r2.status, 404);
  assert.equal(r2.body.code, 'not-found');
  const r3 = await call('GET', '/api/engine/:id/run/:run', { params: { id: 'main', run: '--all' } });
  assert.equal(r3.status, 400);
  const r4 = await call('GET', '/api/engine/:id/events/:run', { params: { id: 'main', run: 'R-20261101-acme-shop-1' }, url: '/x?since=minus' });
  assert.equal(r4.status, 400);
});

test('refusals: an engine down is 503, an incompatible one 502', async () => {
  const hello = JSON.parse(fs.readFileSync(path.join(fake.FIXTURES, 'hello.json'), 'utf8'));
  const prev = engines._set([
    fake.create({ id: 'down', timeoutMs: 20, override: { hello: () => new Promise(() => {}) } }),
    fake.create({ id: 'old', override: { hello: { ...hello, contract: '2.0', data: { ...hello.data, contract: '2.0' } } } }),
  ]);
  try {
    const down = await call('GET', '/api/engine/:id/runs', { params: { id: 'down' } });
    assert.equal(down.status, 503);
    assert.equal(down.body.code, 'engine-down');
    const old = await call('GET', '/api/engine/:id/runs', { params: { id: 'old' } });
    assert.equal(old.status, 502);
    assert.equal(old.body.code, 'incompatible');
    const list = await call('GET', '/api/engines');
    assert.deepEqual(list.body.engines.map((e) => e.state), ['down', 'incompatible']);
  } finally {
    engines._set(prev);
  }
});

test('the table: no config is the jsonl engine alone; configured engines follow it', () => {
  const none = engines.build({ ...mergedDefaults(), stateDir });
  assert.deepEqual(none.map((e) => [e.id, e.kind]), [['jsonl', 'jsonl']]);
  const two = engines.build({ stateDir, engines: [{ id: 'main', kind: 'fake' }, { id: 'off', kind: 'none' }] });
  assert.deepEqual(two.map((e) => [e.id, e.kind]), [['jsonl', 'jsonl'], ['main', 'fake'], ['off', 'none']]);
});

test('allRuns merges every engine\'s runs, newest first, named <engine>/<run>', async () => {
  const list = engines.build(config).concat(fake.create({ id: 'main' }), fake.create({ id: 'gone', timeoutMs: 20, override: { hello: () => new Promise(() => {}) } }));
  const { runs, errors } = await engines.allRuns(list);
  assert.deepEqual(errors.map((e) => [e.engine, e.code]), [['gone', 'engine-down']]);
  assert.equal(runs.length, 4);
  assert.ok(runs.some((r) => r.key === 'jsonl/readiness'));
  assert.ok(runs.some((r) => r.key === 'main/R-20261101-acme-shop-1'));
  for (let i = 1; i < runs.length; i++) assert.ok((runs[i - 1].updatedAt ?? 0) >= (runs[i].updatedAt ?? 0));
});
