// The guard providers, on recorded samples. Nothing here connects to anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-guard-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
// Both default to empty — a host with no live stack next to it guards nothing.
process.env.LANEBOARD_GUARD_PROVIDER = 'ports';
process.env.LANEBOARD_PLATFORM_REPO = 'example-repo';
process.env.LANEBOARD_GUARD_PORTS = '5432,6379,9000';
const G = await import('../server/providers/guard/ports.mjs');
const NONE = await import('../server/providers/guard/none.mjs');
const { attentionScore } = await import('../server/state.mjs');

// --- preventive: environ -----------------------------------------------------

const SLOT2 = {
  DATABASE_URL: 'postgresql+asyncpg://example_app:x@localhost:15532/example',
  DATABASE_ADMIN_URL: 'postgresql://example:x@localhost:15532/example',
  DATABASE_APP_URL: 'postgresql://example_app:x@localhost:15532/example',
  DATABASE_READONLY_URL: 'postgresql://example_readonly:x@localhost:15532/example',
};

test('a lane on its own slot is fine', () => {
  assert.equal(G.envDanger(SLOT2, { platform: true }), null);
});

test('any DATABASE_* on a forbidden port is danger, wherever the session works', () => {
  assert.match(G.envDanger({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:5432/x' }, { platform: false }), /DATABASE_ADMIN_URL points at :5432/);
  assert.match(G.envDanger({ ...SLOT2, DATABASE_URL: 'postgresql+asyncpg://example:example@localhost:5432/example' }, { platform: true }), /DATABASE_URL/);
  // The ports are configuration, not a constant: a host that forbids nothing
  // has nothing to find here.
  assert.equal(G.envDanger({ DATABASE_URL: 'postgresql://x@localhost:5432/x' }, { platform: false, ports: [] }), null);
  assert.match(G.envDanger({ DATABASE_URL: 'postgresql://x@localhost:7777/x' }, { platform: false, ports: [7777] }), /:7777/);
});

test('no DATABASE_* at all is danger only in a platform checkout', () => {
  assert.match(G.envDanger({ PATH: '/usr/bin' }, { platform: true }), /fall back to a shared database/);
  assert.equal(G.envDanger({ PATH: '/usr/bin' }, { platform: false }), null, 'this repo, a shell in ~: no DB, no danger');
});

test('a platform checkout is the main checkout or any of its lane worktrees', () => {
  assert.equal(G.isPlatformDir('/home/user/code/example-repo'), true);
  assert.equal(G.isPlatformDir('/home/user/code/example-repo-bauplan/apps/api'), true);
  assert.equal(G.isPlatformDir('/home/user/code/laneboard'), false);
  assert.equal(G.isPlatformDir(null), false);
  // With no platform repo configured, nothing is one — and in particular not
  // every path, which is what an empty name matching an empty segment gives.
  assert.equal(G.isPlatformDir('/home/user/code/example-repo', ''), false);
});

// --- detective: ss ------------------------------------------------------------

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
  const hits = G.parseSs(SS, [5432, 6379, 9000]);
  assert.deepEqual(hits.map((h) => [h.pid, h.comm, h.port]), [[4242, 'python3', 5432], [4343, 'node', 6379], [4444, 'psql', 5432]]);
});

test('a slot port, an unowned socket, and the server side of a connection are not hits', () => {
  const hits = G.parseSs(SS, [5432, 6379, 9000]);
  assert.ok(!hits.some((h) => h.pid === 4545), ':15532 is a lane slot, not the live stack');
  assert.ok(!hits.some((h) => h.local.endsWith(':5432')), 'the listener side (docker-proxy) is not ours');
});

test('the watched ports can be pointed at a scratch listener for the live test', () => {
  const line = '0 0 127.0.0.1:50000 127.0.0.1:47111 users:(("nc",pid=9,fd=3))';
  assert.equal(G.parseSs(line, [47111]).length, 1);
  assert.equal(G.parseSs(line, [5432]).length, 0);
});

test('loopback and docker bridges are local; the rest of the world is not', () => {
  for (const h of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.18.0.5', '172.31.9.9']) assert.equal(G.isLocalish(h), true, h);
  for (const h of ['10.0.0.5', '172.32.0.1', '203.0.113.219', '10.9.8.7']) assert.equal(G.isLocalish(h), false, h);
});

test('with no forbidden ports the detective check does not even run ss', async () => {
  const before = process.env.LANEBOARD_GUARD_PORTS;
  const { config } = await import('../server/config.mjs');
  const ports = config.guard.forbiddenPorts;
  try {
    config.guard.forbiddenPorts = [];
    assert.deepEqual(await G.detective(), []);
  } finally {
    config.guard.forbiddenPorts = ports;
    process.env.LANEBOARD_GUARD_PORTS = before;
  }
});

test('docker ps rows parse', () => {
  const rows = G.parseDockerPs('example-stack-api-1\trunning\tUp 5 hours\nexample-stack-minio-init-1\texited\tExited (0) 5 hours ago\n');
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
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server/providers/guard/ports.mjs'), 'utf8')
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const bad of ["'stop'", "'restart'", "'exec'", "'kill'", 'process.kill', 'writeFile', 'net.connect', 'createConnection']) {
    assert.ok(!src.includes(bad), `the ports provider must not contain ${bad}`);
  }
});

// --- the `none` provider ------------------------------------------------------

test('the none guard watches nothing and finds nothing', async () => {
  assert.equal(NONE.active, false);
  assert.deepEqual(NONE.forbiddenPorts(), []);
  assert.deepEqual(NONE.healthProbes(), []);
  assert.equal(NONE.containerFilter(), '');
  assert.deepEqual(await NONE.health(), []);
  assert.deepEqual(await NONE.containers(), { ok: true, list: [] });
  assert.deepEqual(await NONE.preventive([{ name: 'x', claude: { pid: process.pid } }]), []);
  assert.deepEqual(await NONE.detective(), []);
});

test('both guard providers export the same interface', async () => {
  for (const k of ['name', 'active', 'forbiddenPorts', 'healthProbes', 'containerFilter', 'health', 'containers', 'preventive', 'detective']) {
    assert.ok(k in G, `ports is missing ${k}`);
    assert.ok(k in NONE, `none is missing ${k}`);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
