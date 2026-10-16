// Launch dry run and the hello fields a hub places launches by (fleet plan §8 2.7, C12):
// `launch` capability, hello.repos (config.repos names only), hello.permissionModes
// (fleet.allowedPermissionModes narrowed to what claude lists).
//
// Hermetic: ~/lanes, ~/code, the state dir, the audit file and `claude` are scratch stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-dryrun-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const claude = path.join(bin, 'claude');
fs.writeFileSync(claude, `#!/bin/sh\ncat <<'EOF'\n  --permission-mode <mode>  Permission mode\n     (choices: "acceptEdits", "auto", "default", "plan")\nEOF\n`, { mode: 0o755 });
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= '/dev/null';
process.env.LANEBOARD_CLAUDE_BIN = claude;
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_REPOS = 'example-repo';
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');
process.env.LANEBOARD_STATE_DIR = path.join(tmp, 'state');
process.env.LANEBOARD_AUDIT_FILE = path.join(tmp, 'audit.jsonl');
process.env.TMUX_TMPDIR = path.join(tmp, 'tmux');
fs.mkdirSync(process.env.TMUX_TMPDIR);
fs.mkdirSync(path.join(tmp, 'code', 'example-repo', '.git'), { recursive: true });

const providers = await import('../server/providers/index.mjs');
providers._set('slots', {
  name: 'fake', available: true, slotCount: 5,
  existing: async () => [1],
  up: async () => ({ ok: true }),
  env: async () => ({ ok: false, error: 'not in this test' }),
});
const L = await import('../server/lanes/launch.mjs');
const store = await import('../server/lanes/store.mjs');
const apiV1 = await import('../server/fleet/api-v1.mjs');
const caps = await import('../server/routes/launch-caps.mjs');
L.init({ state: { get: () => null, tick: async () => {} } });

const base = { lane: 'dry', plan: 'docs/plans/dry.md', permissionMode: 'auto' };

function noRecord(lane) {
  store._resetCache();
  assert.equal(store.read(lane), null);
  assert.equal(fs.existsSync(path.join(tmp, 'lanes', lane)), false);
}

// --- dry run ------------------------------------------------------------------------------------------------------

test('a dry run returns the resolved plan, marks the slot advisory, and writes no record or job', async () => {
  const r = await L.launch({ ...base, priority: 'high', budgetUsd: 5, dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.slotAdvisory, true);
  assert.equal(r.job, undefined);
  assert.equal(r.lane, 'dry');
  assert.deepEqual(Object.keys(r.plan).sort(), ['branch', 'budgetUsd', 'lane', 'model', 'permissionMode', 'plan', 'priority', 'repo', 'root', 'slot'].sort());
  assert.equal(r.plan.repo, 'example-repo');
  assert.equal(r.plan.branch, 'feat/dry');
  assert.equal(r.plan.model, 'opus');
  assert.equal(r.plan.permissionMode, 'auto');
  assert.equal(r.plan.priority, 'high');
  assert.equal(r.plan.budgetUsd, 5);
  assert.equal(typeof r.plan.slot, 'number');
  assert.equal(r.plan.root, path.join(tmp, 'code', 'example-repo-dry'));
  noRecord('dry');
  // a second dry run of the same lane still passes: nothing was held
  assert.equal((await L.launch({ ...base, dryRun: true })).ok, true);
  noRecord('dry');
});

test('a dry run refuses exactly what a real launch refuses, still without a record', async () => {
  await assert.rejects(L.launch({ ...base, permissionMode: undefined, dryRun: true }), /permissionMode is required/);
  await assert.rejects(L.launch({ ...base, permissionMode: 'bypassPermissions', dryRun: true }), /does not accept --permission-mode/);
  await assert.rejects(L.launch({ ...base, repo: 'missing-repo', dryRun: true }), /no checkout/);
  await assert.rejects(L.launch({ ...base, lane: 'Bad Id', dryRun: true }), /invalid lane id/);
  await assert.rejects(L.launch({ ...base, priority: 'urgent', dryRun: true }), /invalid priority/);
  await assert.rejects(L.launch({ ...base, fakeTakenSlots: [2, 3, 4, 5], dryRun: true }), (err) => err.status === 409 && /no free lane slot/.test(err.message));
  noRecord('dry');
});

test('a non-boolean dryRun is refused, never read as a real launch', async () => {
  for (const dryRun of ['true', 1, 0, 'false', {}]) {
    await assert.rejects(L.launch({ ...base, dryRun }), (err) => err instanceof L.LaneError && err.status === 400 && /invalid dryRun/.test(err.message));
  }
  noRecord('dry');
});

// --- hello fields -------------------------------------------------------------------------------------------------

test('offeredPermissionModes: the allowlist in its order, narrowed to what claude lists once known', () => {
  const cfg = { fleet: { allowedPermissionModes: ['plan', 'auto', 'bypassPermissions', 'default'] } };
  assert.deepEqual(L.offeredPermissionModes(cfg, null), ['plan', 'auto', 'bypassPermissions', 'default']);
  assert.deepEqual(L.offeredPermissionModes(cfg, []), ['plan', 'auto', 'bypassPermissions', 'default']);
  assert.deepEqual(L.offeredPermissionModes(cfg, ['default', 'auto', 'plan']), ['plan', 'auto', 'default']);
  assert.deepEqual(L.offeredPermissionModes({}, ['auto']), []);
  assert.deepEqual(L.offeredPermissionModes({ fleet: { allowedPermissionModes: [] } }, ['auto']), []);
});

test('loadPermissionModes caches the claude --help choices', async () => {
  L._setPermissionModes(null);
  assert.equal(L.cachedPermissionModes(), null);
  assert.deepEqual(await L.loadPermissionModes(), ['acceptEdits', 'auto', 'default', 'plan']);
  assert.deepEqual(L.cachedPermissionModes(), ['acceptEdits', 'auto', 'default', 'plan']);
  L._setPermissionModes(null);
});

test('repoNames: config.repos names only, unique, in order', () => {
  assert.deepEqual(caps.repoNames({ repos: [{ name: 'acme', path: '/x/acme' }, { name: 'b' }, { name: 'acme' }, { path: '/y' }, null, { name: 3 }] }), ['acme', 'b']);
  assert.deepEqual(caps.repoNames({}), []);
  assert.deepEqual(caps.repoNames(null), []);
});

test('the route module adds the launch capability and hello.repos / hello.permissionModes', async () => {
  apiV1._reset();
  L._setPermissionModes(null);
  const cfg = {
    repos: [{ name: 'acme', path: '/srv/code/acme', kickoff: '/srv/kickoff.md' }, { name: 'example-repo' }],
    repoNames: ['acme', 'example-repo', 'discovered-checkout'],
    fleet: { allowedPermissionModes: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] },
  };
  const warnings = [];
  const ctx = { config: cfg, log: { warn: (m) => warnings.push(m) } };
  const mod = caps.default;
  assert.equal(mod.name, 'launch-caps');
  assert.deepEqual(mod.modes, ['builder']);
  mod.register(ctx);
  mod.register(ctx); // a second load is a no-op

  let h = apiV1.hello({ now: 1 });
  assert.ok(h.capabilities.includes('launch'));
  assert.ok(h.capabilities.every((c) => typeof c === 'string'));
  assert.deepEqual(h.repos, ['acme', 'example-repo']);
  assert.ok(!JSON.stringify(h).includes('/srv/'), 'no repo paths leave the builder');
  // before the help is read: the allowlist as is
  assert.deepEqual(h.permissionModes, ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);

  mod.start(ctx);
  for (let i = 0; i < 100 && L.cachedPermissionModes() == null; i++) await new Promise((r) => setTimeout(r, 20));
  h = apiV1.hello({ now: 2 });
  assert.deepEqual(h.permissionModes, ['default', 'acceptEdits', 'plan', 'auto']);
  assert.deepEqual(warnings, []);

  // the fields follow the live config
  cfg.repos = [{ name: 'acme' }];
  cfg.fleet.allowedPermissionModes = ['plan'];
  h = apiV1.hello({ now: 3 });
  assert.deepEqual(h.repos, ['acme']);
  assert.deepEqual(h.permissionModes, ['plan']);

  apiV1._reset();
  L._setPermissionModes(null);
});
