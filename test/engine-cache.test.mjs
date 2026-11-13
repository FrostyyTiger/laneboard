// The adapter's short memory (docs/engines.md, "How often laneboard asks"):
// an answer younger than `freshMs` is served again without a call, slow reads
// keep theirs longer, any act ends the memory, a failure is never hidden by it,
// and `status().calls` counts what was really asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as fake from '../server/engine/fake.mjs';
import { DEFAULTS, SLOW_FRESH_MS } from '../server/engine/adapter.mjs';
import { validate } from '../server/config/engines.mjs';

const META = { requestId: '0b6f0000-0000-4000-8000-000000000001', user: 'owner', via: 'laneboard' };

function counted(o = {}) {
  let t = 1_000_000;
  const e = fake.create({ freshMs: 4_000, now: () => t, ...o });
  return { e, tick: (ms) => { t += ms; } };
}

test('a read inside freshMs is served from memory, marked cached; after it, the engine is asked again', async () => {
  const { e, tick } = counted();
  const a = await e.runs();
  assert.equal(a.ok, true);
  assert.equal(a.cached, undefined);
  tick(3_999);
  const b = await e.runs();
  assert.equal(b.cached, true);
  assert.deepEqual(b.data, a.data);
  assert.equal(b.at, a.at);
  assert.equal(e.status().calls.runs, 1);
  tick(1);
  assert.equal((await e.runs()).cached, undefined);
  assert.equal(e.status().calls.runs, 2);
});

test('the memory is per read: another run, another since, another filter is its own call', async () => {
  const { e } = counted();
  await e.waiting({});
  await e.waiting({ for: 'owner' });
  await e.waiting({});
  assert.equal(e.status().calls.waiting, 2);
});

test('products and knowledge keep their answer for SLOW_FRESH_MS', async () => {
  const { e, tick } = counted();
  await e.products();
  tick(SLOW_FRESH_MS - 1);
  assert.equal((await e.products()).cached, true);
  tick(1);
  await e.products();
  assert.equal(e.status().calls.products, 2);
});

test('an act ends the memory, so the next read shows the decision', async () => {
  const { e, tick } = counted();
  await e.runs();
  tick(10);
  await e.act('approve', { target: 'R-20261101-acme-shop-1/recipe-77', expect: 'sha256:0000000000000000' }, META);
  tick(10);
  assert.equal((await e.runs()).cached, undefined);
  assert.equal(e.status().calls.runs, 2);
});

test('after a failure the engine is asked again, never answered from memory', async () => {
  const good = JSON.parse(fs.readFileSync(path.join(fake.FIXTURES, 'health.json'), 'utf8'));
  let fail = false;
  let t = 1_000_000;
  const e = fake.create({ freshMs: 4_000, now: () => t, override: {
    health: () => { if (fail) throw new Error('foreman gone'); return good; },
    runs: () => { throw new Error('foreman gone'); },
  } });
  assert.equal((await e.health()).ok, true);
  t += 10;
  fail = true;
  assert.equal((await e.runs()).ok, false); // any failed call marks the engine as failing
  t += 10;
  const h = await e.health();
  assert.equal(h.cached, undefined, 'not served as fresh after a failure');
  assert.equal(h.stale, true, 'the last good answer, marked stale');
  assert.equal(e.status().calls.health, 2);
});

test('freshMs 0 always asks; the fake defaults to 0, the CLI engine to DEFAULTS.freshMs', async () => {
  const e = fake.create();
  await e.runs();
  await e.runs();
  assert.equal(e.status().calls.runs, 2);
  assert.equal(DEFAULTS.freshMs, 4_000);
});

test('config: freshMs is 0..60000', () => {
  const errs = [];
  const bad = (m) => { errs.push(m); throw new Error(m); };
  validate({ engines: [{ id: 'f', kind: 'fake', freshMs: 0 }] }, bad);
  validate({ engines: [{ id: 'f', kind: 'fake', freshMs: 60_000 }] }, bad);
  assert.throws(() => validate({ engines: [{ id: 'f', kind: 'fake', freshMs: 60_001 }] }, bad));
  assert.throws(() => validate({ engines: [{ id: 'f', kind: 'fake', freshMs: -1 }] }, bad));
});
