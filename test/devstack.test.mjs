// The dev-stack guard and the slots block (v3 Stage 6), on recorded samples.
// Nothing here connects to anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-guard-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
// Both default to empty — a host with no live stack next to it guards nothing.
process.env.LANEBOARD_PLATFORM_REPO = 'example-repo';
process.env.LANEBOARD_GUARD_PORTS = '5432,6379,9000';
const D = await import('../server/collector/devstack.mjs');
const S = await import('../server/collector/slots.mjs');
const { attentionScore } = await import('../server/state.mjs');

// --- preventive: environ -----------------------------------------------------------

const SLOT2 = {
  DATABASE_URL: 'postgresql+asyncpg://example_app:x@localhost:15532/example',
  DATABASE_ADMIN_URL: 'postgresql://example:x@localhost:15532/example',
  DATABASE_APP_URL: 'postgresql://example_app:x@localhost:15532/example',
  DATABASE_READONLY_URL: 'postgresql://example_readonly:x@localhost:15532/example',
};

test('a lane on its own slot is fine', () => {
  assert.equal(D.envDanger(SLOT2, { platform: true }), null);
});

test('any DATABASE_* on :5432 is danger, wherever the session works', () => {
  assert.match(D.envDanger({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:5432/x' }, { platform: false }), /DATABASE_ADMIN_URL points at :5432/);
  assert.match(D.envDanger({ ...SLOT2, DATABASE_URL: 'postgresql+asyncpg://example:example@localhost:5432/example' }, { platform: true }), /DATABASE_URL/);
});

test('no DATABASE_* at all is danger only in a platform checkout', () => {
  assert.match(D.envDanger({ PATH: '/usr/bin' }, { platform: true }), /fall back to :5432/);
  assert.equal(D.envDanger({ PATH: '/usr/bin' }, { platform: false }), null, 'this repo, a shell in ~: no DB, no danger');
});

test('a platform checkout is the main checkout or any of its lane worktrees', () => {
  assert.equal(D.isPlatformDir('/home/user/code/example-repo'), true);
  assert.equal(D.isPlatformDir('/home/user/code/example-repo-bauplan/apps/api'), true);
  assert.equal(D.isPlatformDir('/home/user/code/laneboard'), false);
  assert.equal(D.isPlatformDir(null), false);
});

// --- detective: ss ------------------------------------------------------------------

// Recorded from a real host (`ss -Htnp state established`), external
// address masked; the last three rows are the shapes the guard exists for.
const SS = [
  '0      0         10.9.8.7:53550  203.0.113.219:443',
  '0      0            127.0.0.1:8000        127.0.0.1:44466',
  '0      0           172.18.0.1:52476      172.18.0.6:8000',
  '0      0            127.0.0.1:41234       127.0.0.1:5432  users:(("python3",pid=4242,fd=7))',
  '0      0                [::1]:41236           [::1]:6379  users:(("node",pid=4343,fd=21))',
  '0      0           172.18.0.1:41238      172.18.0.5:5432  users:(("psql",pid=4444,fd=3))',
  '0      0            127.0.0.1:41240       127.0.0.1:15532 users:(("python3",pid=4545,fd=7))',
  '0      0            127.0.0.1:5432        127.0.0.1:41250',
].join('\n');

test('connections from our processes to watched ports are found, with pid and command', () => {
  const hits = D.parseSs(SS, [5432, 6379, 9000]);
  assert.deepEqual(hits.map((h) => [h.pid, h.comm, h.port]), [[4242, 'python3', 5432], [4343, 'node', 6379], [4444, 'psql', 5432]]);
});

test('an agent-stack port, an unowned socket, and the server side of a connection are not hits', () => {
  const hits = D.parseSs(SS, [5432, 6379, 9000]);
  assert.ok(!hits.some((h) => h.pid === 4545), ':15532 is slot 2, not the dev stack');
  assert.ok(!hits.some((h) => h.local.endsWith(':5432')), 'the listener side (docker-proxy) is not ours');
});

test('the watched ports can be pointed at a scratch listener for the live test', () => {
  const line = '0 0 127.0.0.1:50000 127.0.0.1:47111 users:(("nc",pid=9,fd=3))';
  assert.equal(D.parseSs(line, [47111]).length, 1);
  assert.equal(D.parseSs(line, [5432]).length, 0);
});

test('loopback and docker bridges are local; the rest of the world is not', () => {
  for (const h of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.18.0.5', '172.31.9.9']) assert.equal(D.isLocalish(h), true, h);
  for (const h of ['10.0.0.5', '172.32.0.1', '203.0.113.219', '10.9.8.7']) assert.equal(D.isLocalish(h), false, h);
});

test('docker ps rows parse', () => {
  const rows = D.parseDockerPs('example-stack-api-1\trunning\tUp 5 hours\nexample-stack-minio-init-1\texited\tExited (0) 5 hours ago\n');
  assert.deepEqual(rows[0], { name: 'example-stack-api-1', state: 'running', status: 'Up 5 hours' });
  assert.equal(rows.length, 2);
});

test('danger outranks a permission prompt in the attention order', () => {
  const now = Date.now();
  const waiting = attentionScore({ name: 'a', state: 'waiting_permission', stateSince: now }, now);
  const danger = attentionScore({ name: 'b', state: 'working', stateSince: now, danger: { reason: 'x' } }, now);
  assert.ok(danger > waiting, `${danger} > ${waiting}`);
});

test('the guard is read-only by construction', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server/collector/devstack.mjs'), 'utf8')
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const bad of ["'stop'", "'restart'", "'exec'", "'kill'", 'process.kill', 'writeFile', ':5432/', 'net.connect', 'createConnection']) {
    assert.ok(!src.includes(bad), `devstack.mjs must not contain ${bad}`);
  }
});

// --- slots -----------------------------------------------------------------------------

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
  assert.equal(S.parseDockerTime('2026-09-21 08:54:26 +0000 UTC'), Date.parse('2026-09-21T08:54:26Z'));
  assert.equal(S.parseDockerTime('2026-09-21 10:54:26 +0200 CEST'), Date.parse('2026-09-21T08:54:26Z'));
  assert.ok(Number.isNaN(S.parseDockerTime('')));
});

test('slots: the dev stack is not a slot; ports shift by 100', () => {
  const by = S.parseSlotRows(PS);
  assert.deepEqual([...by.keys()].sort(), [1, 2, 3]);
  assert.deepEqual(S.slotPorts(3), { pg: 15632, redis: 16579, s3: 19200 });
});

test('slots joined with lanes: owner, the reserved slot 1, a fresh unowned slot, an orphan', () => {
  const records = [{ id: 'bauplan', slot: 2, createdAt: 1, retiredAt: null }, { id: 'old', slot: 3, createdAt: 1, retiredAt: 5 }];
  const slots = S.buildSlots(S.parseSlotRows(PS), records, NOW);
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
  const fresh = S.buildSlots(S.parseSlotRows('agent4\tagent4-postgres-1\trunning\t2026-09-21 10:00:00 +0000 UTC'), [], NOW);
  assert.equal(fresh.find((x) => x.slot === 4).orphan, false);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
