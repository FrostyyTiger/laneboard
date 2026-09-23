// The slot providers and the Box block they feed. Nothing here starts anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-slots-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_SLOTS_PROVIDER = 'agent-stack';
const A = await import('../server/providers/slots/agent-stack.mjs');
const NONE = await import('../server/providers/slots/none.mjs');
const S = await import('../server/collector/slots.mjs');

// Recorded from a real host, plus an agent3 that has been up for a day.
const PS = [
  'agent1\tagent1-minio-init-1\texited\t2026-09-21 08:54:27 +0000 UTC',
  'agent1\tagent1-redis-1\trunning\t2026-09-21 08:54:26 +0000 UTC',
  'agent1\tagent1-postgres-1\trunning\t2026-09-21 08:54:26 +0000 UTC',
  'example-stack\texample-stack-postgres-1\trunning\t2026-09-20 13:19:38 +0000 UTC',
  'agent2\tagent2-postgres-1\trunning\t2026-09-21 10:00:00 +0000 UTC',
  'agent3\tagent3-postgres-1\trunning\t2026-09-20 09:00:00 +0000 UTC',
].join('\n');
const NOW = Date.parse('2026-09-21T10:20:00Z');

test('docker times parse', () => {
  assert.equal(A.parseDockerTime('2026-09-21 08:54:26 +0000 UTC'), Date.parse('2026-09-21T08:54:26Z'));
  assert.equal(A.parseDockerTime('2026-09-21 10:54:26 +0200 CEST'), Date.parse('2026-09-21T08:54:26Z'));
  assert.ok(Number.isNaN(A.parseDockerTime('')));
});

test('a stack next to the slots is not a slot; ports shift by 100', () => {
  const by = A.parseSlotRows(PS);
  assert.deepEqual([...by.keys()].sort(), [1, 2, 3]);
  assert.deepEqual(A.ports(3), { pg: 15632, redis: 16579, s3: 19200 });
  assert.equal(A.project(3), 'agent3');
});

test('agent-stack env output yields ports, never passwords', () => {
  const out = `
export PGPORT=15532
export DATABASE_URL=postgresql+asyncpg://example_app:secret@localhost:15532/example
export DATABASE_ADMIN_URL=postgresql://example:secret@localhost:15532/example
export REDIS_URL=redis://localhost:16479/0
export S3_ENDPOINT_URL=http://localhost:19100
`;
  const p = A.portsFromEnv(out);
  assert.deepEqual(p, { pgPort: 15532, redisPort: 16479, s3Port: 19100 });
  assert.equal(JSON.stringify(p).includes('secret'), false);
});

test('agent-stack status yields the slots that exist', () => {
  const out = 'agent1\tagent1-postgres-1\tUp 2 hours\nagent3\tagent3-redis-1\tExited\nnothing\n';
  assert.deepEqual(A.slotsFromStatus(out), [1, 3]);
  assert.deepEqual(A.slotsFromStatus(''), []);
});

test('the environment a spawned lane session evals is the provider\'s', () => {
  const quote = (s) => `'${s}'`;
  assert.match(A.envCommand(3, quote), /^eval "\$\('.*agent-stack' env 3\)"; $/);
  assert.equal(NONE.envCommand(3, quote), '');
});

test('slots joined with lanes: owner, the reserved slot 1, a fresh unowned slot, an orphan', () => {
  const records = [{ id: 'bauplan', slot: 2, createdAt: 1, retiredAt: null }, { id: 'old', slot: 3, createdAt: 1, retiredAt: 5 }];
  const slots = S.buildSlots(A.parseSlotRows(PS), records, NOW, A.slotCount);
  const s = (n) => slots.find((x) => x.slot === n);
  assert.equal(s(1).owner, 'reserved (manual work)');
  assert.equal(s(1).orphan, false);
  assert.equal(s(2).lane, 'bauplan');
  assert.equal(s(3).orphan, true, 'up a day, no active lane');
  assert.equal(s(3).owner, 'orphan, ~200 MB');
  assert.equal(s(3).lastLane, 'old');
  assert.equal(s(4).exists, false);
  assert.equal(s(4).owner, null);

  // Twenty minutes old with no lane: someone's fresh manual slot, not an orphan.
  const fresh = S.buildSlots(A.parseSlotRows('agent4\tagent4-postgres-1\trunning\t2026-09-21 10:00:00 +0000 UTC'), [], NOW, A.slotCount);
  assert.equal(fresh.find((x) => x.slot === 4).orphan, false);
});

// --- the `none` provider ------------------------------------------------------

test('the none slot provider has no slots and refuses every act, by name', async () => {
  assert.equal(NONE.available, false);
  assert.equal(NONE.slotCount, 0);
  assert.equal(NONE.ports(2), null);
  assert.deepEqual(await NONE.list(), { ok: true, bySlot: new Map() });
  assert.deepEqual(await NONE.existing(), []);
  for (const call of [NONE.up(2), NONE.env(2), NONE.down(2), NONE.dropVolumes(2)]) {
    const r = await call;
    assert.equal(r.ok, false);
    assert.match(r.error, /no slot provider configured/);
  }
});

test('with no slot provider the Box shows no slots at all', () => {
  assert.deepEqual(S.buildSlots(new Map(), [], NOW, NONE.slotCount), []);
});

test('both slot providers export the same interface', () => {
  for (const k of ['name', 'available', 'slotCount', 'ports', 'envCommand', 'list', 'existing', 'up', 'env', 'down', 'dropVolumes']) {
    assert.ok(k in A, `agent-stack is missing ${k}`);
    assert.ok(k in NONE, `none is missing ${k}`);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
