// The engine contract suite (docs/engines.md "The contract suite";
// docs/plans/runs-first/engine.md §3).
//
// One suite, `readSuite(name, factory)`, holds any engine's read verbs against
// laneboard's shapes (server/engine/contract.mjs SHAPES). It runs against
// `fake` (the contract's published examples, test/fixtures/engine/v1/) and
// `jsonl` (a run.jsonl fixture) always, and against a real engine's CLI when
// LANEBOARD_ENGINE_BIN points at it (skipped otherwise; reads only, a real
// engine is never written to from here).
//
// Then, on `fake` and the generic adapter: the version handshake, every
// refusal code of `act`, idempotency, and an engine that hangs, exits
// non-zero, answers garbage or sends bad rows.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as fake from '../server/engine/fake.mjs';
import * as jsonl from '../server/engine/jsonl.mjs';
import * as none from '../server/engine/none.mjs';
import { createContractEngine, MEMBERS } from '../server/engine/adapter.mjs';
import { execJson } from '../server/engine/exec.mjs';
import { checkShape, READ_VERBS, RESULT_CODES, revisionOf } from '../server/engine/contract.mjs';
import { createCollector } from '../server/collector/runs.mjs';

const FIX = fake.FIXTURES;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const META = (n = 1) => ({ requestId: `0b6f0000-0000-4000-8000-${String(n).padStart(12, '0')}`, user: 'owner', via: 'laneboard' });

/** Ids to call `run`, `events` and `knowledge` with, taken from the engine's own lists. */
async function sampleIds(engine) {
  const runs = engine.capabilities.includes('runs') ? await engine.runs() : null;
  const products = engine.capabilities.includes('products') ? await engine.products() : null;
  // A run with a tree (`run` answers it) is preferred: the fake knows one run in full.
  let runId = runs?.ok ? runs.data.runs[0]?.id : null;
  if (runs?.ok) {
    for (const r of runs.data.runs) if ((await engine.run(r.id)).ok) { runId = r.id; break; }
  }
  let productId = products?.ok ? products.data.products[0]?.id : null;
  if (products?.ok) {
    for (const p of products.data.products) if ((await engine.knowledge(p.id)).ok) { productId = p.id; break; }
  }
  return { runId, productId };
}

const CALL = {
  hello: (e) => e.hello(),
  health: (e) => e.health(),
  products: (e) => e.products(),
  runs: (e) => e.runs(),
  run: (e, ids) => e.run(ids.runId),
  events: (e, ids) => e.events(ids.runId, 0),
  waiting: (e) => e.waiting(),
  knowledge: (e, ids) => e.knowledge(ids.productId),
};

/** Every key of a value, recursively, except inside free-form objects laneboard passes on as content. */
function keysOf(v, out = new Set(), skip = new Set(['content', 'sections', 'result'])) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out, skip));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { out.add(k); if (!skip.has(k)) keysOf(x, out, skip); }
  }
  return out;
}

/** The read suite: one engine factory, every read verb against laneboard's shapes. */
function readSuite(name, factory, { skip = false } = {}) {
  describe(`contract suite: ${name}`, { skip }, () => {
    let engine;
    let ids;
    test('the engine has every member of the interface', async () => {
      engine = await factory();
      for (const m of [...MEMBERS, 'status']) assert.equal(typeof engine[m], 'function', m);
      assert.equal(typeof engine.id, 'string');
      assert.equal(typeof engine.kind, 'string');
      assert.ok(Array.isArray(engine.capabilities));
      ids = await sampleIds(engine);
    });
    for (const verb of READ_VERBS) {
      test(`${verb}: the laneboard shape, or unsupported`, async () => {
        const a = await CALL[verb](engine, ids);
        if (!engine.capabilities.includes(verb)) {
          assert.equal(a.ok, false);
          assert.equal(a.code, 'unsupported', `${verb} is not a capability, so it says so`);
          return;
        }
        assert.equal(a.ok, true, `${verb}: ${a.code} ${a.reason}`);
        assert.deepEqual(checkShape(verb, a.data), [], `${verb} answers its laneboard shape`);
        assert.ok(Number.isInteger(a.at), `${verb}: at is epoch ms`);
        // laneboard shapes are camelCase: no engine field name gets through as it was.
        const snake = [...keysOf(a.data)].filter((k) => k.includes('_'));
        assert.deepEqual(snake, [], `${verb}: no raw engine keys`);
      });
    }
    test('status() names a state and never throws', () => {
      const s = engine.status();
      assert.ok(['up', 'stale', 'down', 'degraded', 'incompatible', 'unknown', 'off'].includes(s.state), s.state);
      assert.equal(s.id, engine.id);
    });
  });
}

// --- the engines the suite runs against --------------------------------------

readSuite('fake', () => fake.create());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-engine-contract-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const runFile = path.join(tmp, 'acme', '.laneboard', 'run.jsonl');
fs.mkdirSync(path.dirname(runFile), { recursive: true });
fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'runs', 'readiness.jsonl'), runFile);
// Two more needs to acknowledge: a decision and a fenced file.
fs.appendFileSync(runFile, [
  '{"v":1,"t":"needs","run":"readiness","ts":1792499000000,"kind":"decision","text":"merge order?"}',
  '{"v":1,"t":"needs","run":"readiness","ts":1792499100000,"kind":"fence","text":"round touched a fenced file"}',
].join('\n') + '\n');

async function jsonlEngine() {
  const c = createCollector({ cfg: { files: [runFile], lanes: false, maxEvents: 5000, keepDays: 3650 } });
  await c.tick({ discover: true });
  const appended = [];
  const append = async (dir, run, line) => { appended.push(line); fs.appendFileSync(runFile, line); await c.tick(); return runFile; };
  const engine = jsonl.create({ store: () => c.store, append });
  return Object.assign(engine, { appended, collector: c });
}
readSuite('jsonl', jsonlEngine);

readSuite('none', () => none.create());

// A real engine: LANEBOARD_ENGINE_BIN is its CLI. The argument lists follow
// contract v1 (`<verb> [id] [--flag value] --json`); the real adapter is
// phase 9's foundry-cli.mjs, this is only enough to read.
const BIN = process.env.LANEBOARD_ENGINE_BIN;
function cliArgs(verb, args = {}) {
  const out = [verb];
  if (args.id) out.push(args.id);
  if (args.product) out.push(args.product);
  if (verb === 'events') out.push('--since', String(args.since ?? 0));
  for (const k of ['for', 'kind', 'status', 'limit', 'cursor']) if (args[k] !== undefined) out.push(`--${k}`, String(args[k]));
  if (verb === 'knowledge' && args.id) out.push('--id', args.id);
  out.push('--json');
  return out;
}
readSuite('real engine (LANEBOARD_ENGINE_BIN)', () => createContractEngine({
  id: 'real',
  kind: 'cli',
  call: (verb, args) => (READ_VERBS.includes(verb) ? execJson(BIN, cliArgs(verb, args), { timeoutMs: 10_000, env: { PATH: process.env.PATH ?? '' } })
    : Promise.reject(new Error('the suite never writes to a real engine'))),
}), { skip: BIN ? false : 'LANEBOARD_ENGINE_BIN is not set' });

// --- fake: the published examples, mapped whole -------------------------------

describe('fake: every published example row reaches laneboard', () => {
  test('counts match the fixtures, nothing dropped', async () => {
    const e = fake.create();
    const runs = await e.runs();
    assert.equal(runs.data.runs.length, fixture('runs.json').data.runs.length);
    assert.equal(runs.dropped, 0);
    const run = await e.run('R-20261101-acme-shop-1');
    assert.equal(run.data.run.tree.length, fixture('run.json').data.run.tree.length);
    assert.equal(run.data.run.gates.length, fixture('run.json').data.run.gates.length);
    assert.equal(run.dropped, 0);
    const products = await e.products();
    assert.deepEqual(products.data.products.map((p) => p.id), ['acme-shop', 'acme-returns']);
    const notReady = products.data.products[0].goals.find((g) => g.readiness === 'not-ready');
    assert.deepEqual(notReady.reasons.map((r) => r.kind), ['requirement-unapproved', 'question-open', 'low-claim', 'budget']);
    const waiting = await e.waiting();
    assert.equal(waiting.data.items.length, fixture('waiting.json').data.items.length);
    assert.equal(waiting.dropped, 0, 'every revision is the hash of its content');
    const kinds = new Set(waiting.data.items.map((i) => i.kind));
    for (const k of ['requirement', 'recipe', 'variant', 'question', 'merge', 'deploy', 'proposal', 'repo', 'change']) assert.ok(kinds.has(k), k);
    const knowledge = await e.knowledge('acme-shop');
    assert.equal(knowledge.data.items.length, fixture('knowledge.json').data.items.length);
    assert.equal(knowledge.dropped, 0);
    const events = await e.events('R-20261101-acme-shop-1', fixture('events.json').data.since);
    assert.equal(events.data.events.length, fixture('events.json').data.events.length);
    assert.equal(events.data.next, fixture('events.json').data.next);
    const health = await e.health();
    assert.equal(health.data.windows.window7d.usedPct, 64);
  });

  test('times become epoch ms, snake_case becomes camelCase', async () => {
    const e = fake.create();
    const row = (await e.runs()).data.runs[0];
    assert.equal(row.startedAt, Date.parse(fixture('runs.json').data.runs[0].started));
    assert.equal(row.usage.tokens.cacheRead, fixture('runs.json').data.runs[0].usage.tokens.cache_read);
    assert.equal(row.usage.usd, fixture('runs.json').data.runs[0].usage.usd_notional);
    assert.equal('events_path' in row || 'eventsPath' in row, false, 'a path on the engine\'s machine never reaches the page');
  });

  test('events: since filters the event file, next is the last seq', async () => {
    const e = fake.create();
    const all = await e.events('R-20261101-acme-shop-1', 0);
    assert.equal(all.data.events.length, 83);
    assert.equal(all.data.next, 83);
    const later = await e.events('R-20261101-acme-shop-1', 80);
    assert.deepEqual(later.data.events.map((x) => x.seq), [81, 82, 83]);
  });

  test('knowledge: filters, privacy, unknown product', async () => {
    const e = fake.create();
    const claims = await e.knowledge('acme-shop', { kind: 'claim' });
    assert.ok(claims.data.items.length > 0);
    assert.ok(claims.data.items.every((i) => i.type === 'claim'));
    const one = await e.knowledge('acme-shop', { id: 'C-1' });
    assert.deepEqual(one.data.items.map((i) => i.id), ['C-1']);
    const sources = await e.knowledge('acme-shop', { kind: 'source' });
    for (const s of sources.data.items) { assert.equal('ref' in s, false); assert.equal('body' in s, false); }
    assert.equal((await e.knowledge('acme-shop', { limit: 2 })).data.items.length, 2);
    assert.equal((await e.knowledge('nope')).code, 'not-found');
    assert.equal((await e.knowledge('acme-shop', { limit: 9999 })).code, 'bad-request');
  });

  test('a run the engine does not know is not-found; a bad id never reaches the engine', async () => {
    let calls = 0;
    const e = fake.create({ override: { run: () => { calls += 1; throw Object.assign(new Error('no such run'), { code: 'not-found' }); } } });
    assert.equal((await e.run('R-20990101-acme-shop-1')).code, 'not-found');
    assert.equal(calls, 1);
    for (const bad of ['--json', '../x', '', 'a b', 'x'.repeat(200)]) assert.equal((await e.run(bad)).code, 'bad-request', bad);
    assert.equal((await e.events('R-20261101-acme-shop-1', -1)).code, 'bad-request');
    assert.equal(calls, 1);
    assert.equal(e.status().state, 'up', 'not-found is an answer, not an outage');
  });
});

// --- the version handshake ----------------------------------------------------

describe('version handshake', () => {
  const hello = fixture('hello.json');
  const speaking = (v) => ({ ...hello, contract: v, data: { ...hello.data, contract: v } });

  for (const v of ['2.0', '0.9']) {
    test(`contract ${v} is incompatible: no reads, no writes, a reason naming both versions`, async () => {
      const e = fake.create({ override: { hello: speaking(v) } });
      const h = await e.hello();
      assert.equal(h.ok, false);
      assert.equal(h.code, 'incompatible');
      assert.match(h.reason, new RegExp(`${v.replace('.', '\\.')}.*1\\.x`));
      for (const verb of READ_VERBS.filter((x) => x !== 'hello')) {
        const a = await CALL[verb](e, { runId: 'R-20261101-acme-shop-1', productId: 'acme-shop' });
        assert.equal(a.code, 'incompatible', verb);
      }
      assert.equal((await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META())).code, 'incompatible');
      const s = e.status();
      assert.equal(s.state, 'incompatible');
      assert.equal(s.accepts, '1.x');
    });
  }

  test('a later minor (1.7) is accepted', async () => {
    const e = fake.create({ override: { hello: speaking('1.7') } });
    assert.equal((await e.hello()).ok, true);
    assert.equal((await e.runs()).ok, true);
    assert.equal(e.status().contract, '1.7');
  });

  test('hello\'s own contract counts, not only the envelope\'s', async () => {
    const e = fake.create({ override: { hello: { ...hello, data: { ...hello.data, contract: '2.0' } } } });
    assert.equal((await e.hello()).code, 'incompatible');
  });

  test('hello and its envelope must agree on the version (review of PR #30, fix 2)', async () => {
    const e = fake.create({ override: { hello: { ...hello, contract: '1.0', data: { ...hello.data, contract: '1.9' } } } });
    const h = await e.hello();
    assert.equal(h.code, 'incompatible');
    assert.match(h.reason, /1\.9.*1\.0/);
    assert.equal(e.status().state, 'incompatible');
  });

  test('a reason never carries more than 64 chars of the engine\'s own text (review of PR #30, fix 1)', async () => {
    const big = 'x'.repeat(3_000_000);
    const e = fake.create({ override: { hello: { ...hello, contract: big } } });
    const h = await e.hello();
    assert.equal(h.code, 'incompatible');
    assert.ok(h.reason.length < 200, `reason is ${h.reason.length} chars`);
    assert.ok(e.status().reason.length < 200);
    const runs = fixture('runs.json');
    const e2 = fake.create({ override: { runs: { ...runs, data: { runs: [{ ...runs.data.runs[0], state: big }] } } } });
    const r = await e2.runs();
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 1);
    assert.ok(JSON.stringify(e2.status()).length < 4000);
  });

  test('an answer in another major after a good hello makes the engine incompatible', async () => {
    const runs = fixture('runs.json');
    const e = fake.create({ override: { runs: { ...runs, contract: '2.1' } } });
    assert.equal((await e.runs()).code, 'incompatible');
    assert.equal(e.status().state, 'incompatible');
  });

  test('the handshake runs again after the engine was unreachable', async () => {
    let up = true;
    let hellos = 0;
    const e = fake.create({
      override: {
        hello: () => { hellos += 1; if (!up) throw new Error('gone'); return hello; },
        runs: () => { if (!up) throw new Error('gone'); return fixture('runs.json'); },
      },
    });
    await e.runs();
    await e.runs();
    assert.equal(hellos, 1, 'one handshake while it answers');
    up = false;
    await e.runs();
    up = true;
    assert.equal((await e.runs()).ok, true);
    assert.equal(hellos, 2, 'after a failure, hello again');
  });
});

// --- act: refusal codes and idempotency --------------------------------------

describe('act', () => {
  const results = fs.readdirSync(FIX).filter((n) => /^result-.*\.json$/.test(n)).map((n) => [n, fixture(n).data]);

  test('the fixtures cover ok and every refusal code', () => {
    const codes = results.map(([, d]) => (d.ok ? 'ok' : d.code)).sort();
    assert.deepEqual(codes, ['ok', ...RESULT_CODES].sort());
  });

  for (const [name, d] of results) {
    test(`${name}: ${d.verb} ${d.target} answers ${d.ok ? 'ok' : d.code} in the result shape`, async () => {
      const e = fake.create();
      const r = await e.act(d.verb, { target: d.target }, META(7));
      assert.deepEqual(checkShape('result', r), []);
      assert.equal(r.ok, d.ok);
      assert.equal(r.verb, d.verb);
      assert.equal(r.target, d.target);
      assert.equal(r.request, META(7).requestId, 'the request id is the one sent');
      assert.equal(r.by, 'owner');
      assert.equal(r.via, 'laneboard');
      assert.equal(r.replayed, false);
      if (d.ok) assert.deepEqual(r.result, d.result);
      else {
        assert.equal(r.code, d.code);
        assert.equal(typeof r.reason, 'string');
        if (d.code === 'stale-revision') assert.match(r.current, /^sha256:[0-9a-f]{16}$/);
      }
    });
  }

  test('the same request id twice decides once and answers the first result again', async () => {
    const e = fake.create();
    const first = await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META(1));
    const again = await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META(1));
    assert.equal(first.replayed, false);
    assert.equal(again.replayed, true);
    assert.deepEqual({ ...again, replayed: false }, first);
    // Even a different target under the same id answers the first result: one request, one decision.
    const other = await e.act('approve', { target: 'R-20261101-acme-shop-1/recipe-2' }, META(1));
    assert.equal(other.target, 'R-20261101-acme-shop-1/variant-1');
    assert.equal(other.replayed, true);
    const fresh = await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META(2));
    assert.equal(fresh.replayed, false);
  });

  test('engine-error applied nothing: the same request id may be sent again', async () => {
    const e = fake.create();
    const a = await e.act('answer', { target: 'acme-shop:Q-3' }, META(3));
    const b = await e.act('answer', { target: 'acme-shop:Q-3' }, META(3));
    assert.equal(a.code, 'engine-error');
    assert.equal(b.replayed, false);
  });

  test('a target the engine does not know is not-found', async () => {
    const r = await fake.create().act('approve', { target: 'R-20261101-acme-shop-1/recipe-77' }, META(4));
    assert.equal(r.code, 'not-found');
  });

  test('laneboard refuses a malformed request before the engine sees it', async () => {
    let calls = 0;
    const e = fake.create({ override: { approve: () => { calls += 1; return fixture('result-ok.json'); } } });
    assert.equal((await e.act('launch-missiles', { target: 'x' }, META())).code, 'bad-request');
    assert.equal((await e.act('approve', { target: 'x' }, { user: 'owner', via: 'laneboard' })).code, 'bad-request');
    assert.equal((await e.act('approve', { target: '--force' }, META())).code, 'bad-request');
    assert.equal((await e.act('approve', {}, META())).code, 'bad-request');
    assert.equal(calls, 0);
  });

  test('an engine that does not answer refuses the decision: engine-down, never queued', async () => {
    let calls = 0;
    const e = fake.create({ timeoutMs: 50, override: { approve: () => { calls += 1; return new Promise(() => {}); } } });
    const r = await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META(5));
    assert.equal(r.code, 'engine-down');
    assert.equal(calls, 1);
  });
});

describe('jsonl: ack', () => {
  test('acks an open need once, by request id; refuses what it cannot close', async () => {
    const e = await jsonlEngine();
    const meta = (n, via = 'inbox') => ({ ...META(n), via });
    const needs = e.collector.store.get('readiness').needs;
    const open = needs.findIndex((n) => n.open && n.kind !== 'fence');
    const fence = needs.findIndex((n) => n.kind === 'fence');
    const r = await e.act('ack', { target: 'readiness', ref: open }, meta(1));
    assert.deepEqual(checkShape('result', r), []);
    assert.equal(r.ok, true, r.reason);
    assert.equal(e.appended.length, 1);
    assert.equal(JSON.parse(e.appended[0]).t, 'needs.ack');
    assert.equal(e.collector.store.get('readiness').needs[open].acked, true);
    const again = await e.act('ack', { target: 'readiness', ref: open }, meta(1));
    assert.equal(again.replayed, true);
    assert.equal(e.appended.length, 1, 'the same request id writes nothing twice');
    assert.equal((await e.act('ack', { target: 'readiness', ref: open }, meta(2))).code, 'already-decided');
    assert.equal((await e.act('ack', { target: 'readiness', ref: 99 }, meta(3))).code, 'not-found');
    assert.equal((await e.act('ack', { target: 'nope', ref: 0 }, meta(4))).code, 'not-found');
    assert.equal((await e.act('ack', { target: 'readiness', ref: fence }, meta(5, 'loop'))).code, 'refused');
    assert.equal((await e.act('ack', { target: 'readiness', ref: fence }, meta(6, 'run page'))).ok, true);
    assert.equal((await e.act('approve', { target: 'readiness' }, meta(7))).code, 'unsupported');
    assert.equal((await e.act('ack', { target: 'readiness', ref: 0 }, { via: 'inbox' })).code, 'bad-request');
  });

  test('without the runs collector the jsonl engine is down, and says so', async () => {
    const e = jsonl.create({ store: () => null });
    assert.equal((await e.runs()).code, 'engine-down');
    assert.equal(e.status().state, 'down');
  });
});

// --- an engine that hangs, fails or answers garbage --------------------------

describe('a misbehaving engine', () => {
  const runs = fixture('runs.json');

  test('a hanging engine: the call gives up after timeoutMs, later reads serve the last good answer, stale', async () => {
    let hang = false;
    let t = 1_000_000;
    const e = fake.create({ timeoutMs: 50, staleMs: 1000, downMs: 5000, now: () => t,
      override: { hello: () => (hang ? new Promise(() => {}) : fixture('hello.json')), runs: () => (hang ? new Promise(() => {}) : runs) } });
    const good = await e.runs();
    assert.equal(good.ok, true);
    hang = true;
    t += 2000;
    const started = Date.now();
    const r = await e.runs();
    assert.ok(Date.now() - started < 2000, 'waited out the timeout, not the hang');
    assert.equal(r.ok, true);
    assert.equal(r.stale, true);
    assert.equal(r.age, 2000);
    assert.deepEqual(r.data, good.data);
    assert.equal(e.status().state, 'stale');
    t += 10_000;
    await e.runs();
    assert.equal(e.status().state, 'down');
  });

  test('a hanging engine with nothing cached is engine-down', async () => {
    const e = fake.create({ timeoutMs: 30, override: { hello: () => new Promise(() => {}) } });
    const r = await e.products();
    assert.equal(r.code, 'engine-down');
    assert.match(r.reason, /no answer within 30 ms/);
    assert.equal(e.status().state, 'down');
  });

  test('a non-zero exit is engine-down; a CLI that cannot start is down at once', async () => {
    const exit = fake.create({ override: { runs: () => { throw Object.assign(new Error('exited 1'), { code: 'exit', exitCode: 1 }); } } });
    assert.equal((await exit.runs()).code, 'engine-down');
    const missing = fake.create({ override: { hello: () => Promise.reject(Object.assign(new Error('spawn foundry ENOENT'), { code: 'ENOENT' })) } });
    assert.equal((await missing.runs()).code, 'engine-down');
    assert.equal(missing.status().state, 'down');
  });

  test('reads of one verb never overlap: a slow call is waited out, not stacked', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const e = fake.create({ override: { runs: async () => { calls += 1; await gate; return runs; } } });
    await e.hello();
    const both = Promise.all([e.runs(), e.runs(), e.runs()]);
    await new Promise((r) => setImmediate(r));
    release();
    const answers = await both;
    assert.equal(calls, 1);
    assert.ok(answers.every((a) => a.ok));
  });

  test('a garbage answer is degraded, never a throw; a good one clears it', async () => {
    let answer = 'this is not json';
    const e = fake.create({ override: { runs: () => answer } });
    const r = await e.runs();
    assert.equal(r.code, 'degraded');
    assert.equal(e.status().state, 'degraded');
    answer = runs;
    assert.equal((await e.runs()).ok, true);
    assert.equal(e.status().state, 'up');
  });

  test('a bad row is dropped and counted, the rest is kept', async () => {
    const bad = structuredClone(runs);
    delete bad.data.runs[0].id;
    bad.data.runs[1].state = 'dancing';
    const e = fake.create({ override: { runs: bad } });
    const r = await e.runs();
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 2);
    assert.deepEqual(r.data.runs.map((x) => x.id), [runs.data.runs[2].id]);
    assert.equal(e.status().dropped.runs, 2);
  });

  test('a waiting item whose revision is not the hash of its content is dropped', async () => {
    const w = structuredClone(fixture('waiting.json'));
    w.data.items[0].content.text = 'changed after hashing';
    assert.notEqual(revisionOf(w.data.items[0].content), w.data.items[0].revision);
    const r = await fake.create({ override: { waiting: w } }).waiting();
    assert.equal(r.dropped, 1);
    assert.equal(r.data.items.length, w.data.items.length - 1);
  });

  test('nothing an engine sends makes laneboard throw', async () => {
    const env = (data) => ({ contract: '1.0', engine: '0.1.0', at: '2026-11-01T10:45:00Z', data });
    const junk = [
      null, undefined, 42, '', '{', '[]', [], {}, { contract: '1.0' }, env(null), env([]), env('x'), env({}),
      env({ runs: 'nope' }), env({ runs: [null, 1, 'x', [], { id: 7 }] }), env({ products: [{ id: 'p', goals: 'x' }] }),
      env({ run: { tree: [{}], gates: null } }), env({ items: [{ kind: 'recipe', content: null }] }),
      env({ events: [{ seq: 'one' }], next: 'x' }), { ...env({}), contract: 1 }, { ...env({}), at: 'yesterday' },
      'x'.repeat(5 * 1024 * 1024),
    ];
    const verbs = READ_VERBS.filter((v) => v !== 'hello');
    for (const raw of junk) {
      const override = Object.fromEntries([...verbs, 'approve'].map((v) => [v, () => raw]));
      const e = fake.create({ override });
      for (const verb of verbs) {
        const a = await CALL[verb](e, { runId: 'R-20261101-acme-shop-1', productId: 'acme-shop' });
        if (a.ok) assert.deepEqual(checkShape(verb, a.data), [], `${verb} ${JSON.stringify(raw)?.slice(0, 40)}`);
        else assert.ok(['degraded', 'incompatible'].includes(a.code), `${verb}: ${a.code}`);
      }
      const w = await e.act('approve', { target: 'R-20261101-acme-shop-1/variant-1' }, META(9));
      assert.equal(typeof w.ok, 'boolean');
    }
  });
});

// --- exec.mjs: how a CLI engine is called -------------------------------------

describe('exec: execFile, a timeout, an output cap, no shell', () => {
  const STUB = path.join(import.meta.dirname, 'fixtures', 'engine', 'stub-cli.mjs');
  const node = process.execPath;

  test('arguments reach the program as they are: no shell ever parses them', async () => {
    const canary = path.join(tmp, 'shell-ran');
    const tricky = [`$(touch ${canary})`, `\`touch ${canary}\``, `; touch ${canary}`, '*', '$HOME'];
    const out = JSON.parse(await execJson(node, [STUB, 'echo', ...tricky]));
    assert.deepEqual(out.args, tricky);
    assert.equal(fs.existsSync(canary), false);
    assert.equal(out.home, null, 'only the environment it is given');
  });

  test('a hanging program is killed after timeoutMs', async () => {
    const started = Date.now();
    await assert.rejects(execJson(node, [STUB, 'hang'], { timeoutMs: 200 }), { code: 'timeout' });
    assert.ok(Date.now() - started < 3000);
  });

  test('output over the cap is an error, not a truncated answer', async () => {
    await assert.rejects(execJson(node, [STUB, 'big'], { maxBytes: 1024 * 1024 }), { code: 'too-large' });
  });

  test('exit codes: 1 is an error, 2 is not-found, a refusal with its envelope resolves', async () => {
    await assert.rejects(execJson(node, [STUB, 'exit', '1']), { code: 'exit', exitCode: 1 });
    await assert.rejects(execJson(node, [STUB, 'exit', '2']), { code: 'not-found' });
    const refusal = JSON.parse(await execJson(node, [STUB, 'refuse']));
    assert.equal(refusal.data.code, 'refused');
    await assert.rejects(execJson(path.join(tmp, 'no-such-engine'), []), { code: 'ENOENT' });
    await assert.rejects(execJson(node, [STUB, 7]), { code: 'bad-command' });
  });

  test('the adapter over a CLI: hang and non-zero exit are engine-down, a refusal is a result', async () => {
    const cli = (mode) => createContractEngine({
      id: 'stub', kind: 'cli', timeoutMs: 5000,
      call: (verb) => execJson(node, [STUB, verb === 'hello' ? 'hello' : mode], { timeoutMs: 200 }),
    });
    assert.equal((await cli('hang').runs()).code, 'engine-down');
    assert.equal((await cli('exit').runs()).code, 'engine-down');
    const r = await cli('refuse').act('start', { target: 'acme-shop:G4' }, META());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'refused');
  });
});

describe('the adapter waits a slow engine out, it never stacks calls (review of PR #30, fix 3)', () => {
  test('five reads during one 300 ms call start one engine call, each caller gets its own timeout', async () => {
    const hello = fixture('hello.json');
    const runs = fixture('runs.json');
    let calls = 0;
    const e = createContractEngine({
      id: 'slow', kind: 'test', timeoutMs: 40,
      call: (verb) => {
        if (verb === 'hello') return JSON.stringify(hello);
        calls += 1;
        const delay = calls === 1 ? 300 : 0; // only the first call is slow
        return new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(runs)), delay));
      },
    });
    assert.equal((await e.hello()).ok, true);
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await e.runs());
    assert.equal(calls, 1, 'one underlying engine call');
    for (const r of results) assert.equal(r.code, 'engine-down', 'each caller timed out on its own');
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal((await e.runs()).ok, true, 'once the engine answered, the next read succeeds');
    assert.equal(calls, 2);
  });
});

test('a feature node\'s single requirement id becomes a list', async () => {
  const { create } = await import('../server/engine/fake.mjs');
  const a = await create({ id: 'x' }).run('R-20261101-acme-shop-1');
  const f = a.data.run.tree.find((n) => n.level === 'feature');
  assert.deepEqual(f.requirements, ['REQ-1']);
  assert.ok(f.acceptanceTests.length > 0);
});
