// Launch: the refusals, the environment check, the job.
//
// Hermetic. `claude`, ~/lanes and ~/code are scratch stand-ins, and the slot
// provider is a fake that records what it was asked for and starts nothing —
// which is also the proof that launch goes through the interface and not
// through one particular stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-launch-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const fake = (name, body) => {
  const p = path.join(bin, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return p;
};
process.env.LANEBOARD_CLAUDE_BIN = fake('claude', `cat <<'EOF'
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
EOF`);
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_REPOS = 'example-repo';
process.env.LANEBOARD_HUMAN = 'the owner';
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');
fs.mkdirSync(path.join(tmp, 'code', 'example-repo', '.git'), { recursive: true });

const providers = await import('../server/providers/index.mjs');

/**
 * A slot provider that starts nothing. Slot 1 is up, as if someone had
 * brought it up by hand for their own work. `calls` is what a test asserts on.
 */
const fakeSlots = {
  name: 'fake',
  available: true,
  slotCount: 5,
  calls: [],
  existingSlots: [1],
  ports: (n) => ({ pg: 15432 + (n - 1) * 100, redis: 16379 + (n - 1) * 100, s3: 19000 + (n - 1) * 100 }),
  envCommand: (n) => `FAKE_SLOT=${n}; `,
  list: async () => ({ ok: true, bySlot: new Map([[1, { containers: [], up: true, createdAt: Date.now() }]]) }),
  existing: async () => fakeSlots.existingSlots,
  up: async (n, o) => { fakeSlots.calls.push(['up', n, o?.cwd]); return { ok: true, stdout: '', stderr: '' }; },
  env: async (n) => {
    fakeSlots.calls.push(['env', n]);
    return { ok: true, ports: { pgPort: 15432 + (n - 1) * 100, redisPort: 16379 + (n - 1) * 100, s3Port: 19000 + (n - 1) * 100 } };
  },
  down: async (n) => { fakeSlots.calls.push(['down', n]); return { ok: true }; },
  dropVolumes: async (n) => { fakeSlots.calls.push(['dropVolumes', n]); return { ok: true, removed: [], skipped: [] }; },
};
providers._set('slots', fakeSlots);

const L = await import('../server/lanes/launch.mjs');
const store = await import('../server/lanes/store.mjs');
L.init({ state: { get: () => null } });

const writeLane = (id, slot, extra = {}) => {
  fs.mkdirSync(path.join(tmp, 'lanes', id), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'lanes', id, 'lane.json'), JSON.stringify({
    id, slot, root: `/x/example-repo-${id}`, createdAt: 1, retiredAt: null, ...extra,
  }));
  store._resetCache();
};
const clearLanes = () => fs.rmSync(path.join(tmp, 'lanes'), { recursive: true, force: true });

async function refused(req, re, status) {
  await assert.rejects(L.validate(req), (err) => {
    assert.ok(err instanceof L.LaneError, `expected a LaneError, got ${err}`);
    assert.match(err.message, re);
    if (status) assert.equal(err.status, status);
    return true;
  });
}

// --- validation ------------------------------------------------------------------

test('a good request resolves to slot 2, with the defaults the plan names', async () => {
  clearLanes();
  const v = await L.validate({ lane: 'bauplan', plan: 'docs/plans/bauplan.md' });
  assert.equal(v.slot, 2, 'slot 1 is reserved; lanes start at 2');
  assert.equal(v.branch, 'feat/bauplan');
  assert.equal(v.model, 'opus');
  assert.equal(v.permissionMode, 'auto');
  assert.equal(v.root, path.join(tmp, 'code', 'example-repo-bauplan'));
});

test('lane ids that are unsafe as a session, a directory or a worktree suffix are refused', async () => {
  for (const bad of ['', 'Has Space', '../up', '-dash', '.dot', 'UPPER', 'a(b)', 'x'.repeat(41)]) {
    await refused({ lane: bad, plan: 'docs/plans/x.md' }, /invalid lane id/, 400);
  }
});

test('plan, branch and repo are checked for traversal and shape', async () => {
  await refused({ lane: 'ok', plan: '../etc/passwd.md' }, /invalid plan/);
  await refused({ lane: 'ok', plan: 'docs/plans/ok.txt' }, /invalid plan/);
  await refused({ lane: 'ok', plan: 'docs/plans/ok.md', branch: 'feat/../x' }, /invalid branch/);
  await refused({ lane: 'ok', plan: 'docs/plans/ok.md', repo: '../x' }, /invalid repo/);
  await refused({ lane: 'ok', plan: 'docs/plans/ok.md', repo: 'nope' }, /no checkout/);
});

test('a permission mode claude does not list is refused, naming what it does list', async () => {
  await refused({ lane: 'ok', plan: 'docs/plans/ok.md', permissionMode: 'default' }, /does not accept --permission-mode default.*auto/);
});

test('a second launch of the same name is refused', async () => {
  clearLanes();
  writeLane('bauplan', 2);
  await refused({ lane: 'bauplan', plan: 'docs/plans/bauplan.md' }, /already exists/, 409);
});

test('a retired lane id is not silently reused', async () => {
  clearLanes();
  writeLane('old', 2, { retiredAt: 5 });
  await refused({ lane: 'old', plan: 'docs/plans/old.md' }, /retired lane old/, 409);
});

test('with slots 2-4 held, the fourth launch is refused with the owners listed', async () => {
  clearLanes();
  writeLane('a', 2);
  writeLane('b', 3);
  writeLane('c', 4);
  await refused({ lane: 'd', plan: 'docs/plans/d.md' }, /slot 2: lane a; slot 3: lane b; slot 4: lane c/, 409);
});

test('a slot running with no lane counts as taken', async () => {
  // Someone started slot 2 by hand; sharing its database with a suite that
  // drops tenants is exactly what slots exist to prevent.
  clearLanes();
  const v = await L.validate({ lane: 'e', plan: 'docs/plans/e.md', fakeTakenSlots: [2] });
  assert.equal(v.slot, 3);
  await refused({ lane: 'e', plan: 'docs/plans/e.md', fakeTakenSlots: [2, 3, 4] },
    /slot 2: agent2 \(running, no lane\)/, 409);
});

test('faked slots can only add to what the provider reports', async () => {
  // Slot 1 is up in the fake provider; passing [] must not make anything freer.
  clearLanes();
  const owners = store.slotOwners([], [1]);
  assert.equal(owners.get(1), 'agent1 (running, no lane)');
  const v = await L.validate({ lane: 'f', plan: 'docs/plans/f.md', fakeTakenSlots: [] });
  assert.equal(v.slot, 2);
});

test('with no slot provider, launch refuses before it touches anything', async () => {
  clearLanes();
  const before = providers._set('slots', await import('../server/providers/slots/none.mjs'));
  try {
    await refused({ lane: 'nope', plan: 'docs/plans/nope.md' }, /no slot provider configured/, 501);
    assert.equal(fs.existsSync(path.join(tmp, 'lanes', 'nope')), false, 'nothing was written');
    assert.equal(fs.existsSync(path.join(tmp, 'code', 'example-repo-nope')), false, 'no worktree was made');
  } finally {
    providers._set('slots', before);
  }
});

test('the provider decides which slots exist, and an unanswerable question is refused', async () => {
  clearLanes();
  const was = fakeSlots.existingSlots;
  try {
    fakeSlots.existingSlots = null; // "cannot tell"
    await refused({ lane: 'unknown', plan: 'docs/plans/unknown.md' }, /could not say which slots are free/, 503);
  } finally {
    fakeSlots.existingSlots = was;
  }
});

test('an existing worktree path is refused rather than reused', async () => {
  clearLanes();
  fs.mkdirSync(path.join(tmp, 'code', 'example-repo-taken'), { recursive: true });
  await refused({ lane: 'taken', plan: 'docs/plans/taken.md' }, /already exists/, 409);
});

// --- rule 8: the environment ---------------------------------------------------------

test('urlPort reads postgres, asyncpg, redis and http urls', () => {
  assert.equal(L.urlPort('postgresql+asyncpg://u:p@localhost:15532/example'), 15532);
  assert.equal(L.urlPort('postgresql://u:p@localhost:5432/example'), 5432);
  assert.equal(L.urlPort('redis://localhost:16479/0'), 16479);
  assert.equal(L.urlPort('http://localhost:19100'), 19100);
  assert.equal(L.urlPort(''), null);
  assert.equal(L.urlPort(undefined), null);
});

test('the environment check: set, on the slot, never on a forbidden port', () => {
  const good = {
    DATABASE_URL: 'postgresql+asyncpg://a:b@localhost:15532/example',
    DATABASE_ADMIN_URL: 'postgresql://a:b@localhost:15532/example',
  };
  const FORBIDDEN = [5432, 6379, 9000];
  assert.equal(L.checkLaneEnv(good, 15532, FORBIDDEN).ok, true);
  assert.match(L.checkLaneEnv({}, 15532, FORBIDDEN).reason, /DATABASE_ADMIN_URL is unset/);
  assert.match(L.checkLaneEnv({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:5432/x' }, 15532, FORBIDDEN).reason, /:5432, which is forbidden/);
  // A forbidden port on ANY of the four is a failure, not only the admin URL.
  assert.match(L.checkLaneEnv({ ...good, DATABASE_READONLY_URL: 'postgresql://x@localhost:5432/x' }, 15532, FORBIDDEN).reason,
    /DATABASE_READONLY_URL points at :5432/);
  // Slot 1's port is forbidden by nobody, but it is not this lane's either.
  assert.match(L.checkLaneEnv({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:15432/x' }, 15532, FORBIDDEN).reason, /expected :15532/);
  // ":15432" contains "5432"; the check is on the port, not a substring.
  assert.equal(L.checkLaneEnv({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:15432/x' }, 15432, FORBIDDEN).ok, true);
  // With no guard configured, "on the slot I just made" is the whole check.
  assert.equal(L.checkLaneEnv({ DATABASE_ADMIN_URL: 'postgresql://x@localhost:5432/x' }, 5432, []).ok, true);
});

test('parseEnviron splits /proc/<pid>/environ', () => {
  const env = L.parseEnviron(Buffer.from('A=1\0DATABASE_ADMIN_URL=postgresql://u:p=q@h:15532/n\0EMPTY=\0'));
  assert.equal(env.A, '1');
  assert.equal(env.DATABASE_ADMIN_URL, 'postgresql://u:p=q@h:15532/n');
  assert.equal(env.EMPTY, '');
});

test('parseEnviron reads this very process', () => {
  const env = L.parseEnviron(fs.readFileSync(`/proc/${process.pid}/environ`));
  assert.equal(env.LANEBOARD_LANES_DIR, undefined, 'set after exec, so not in environ — as expected');
  assert.ok(env.PATH);
});

// --- parsers ---------------------------------------------------------------------------

test('the permission-mode choices are read from claude --help', () => {
  const help = fs.readFileSync(process.env.LANEBOARD_CLAUDE_BIN, 'utf8');
  assert.deepEqual(L.permissionModesFromHelp(help), ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
  assert.deepEqual(L.permissionModesFromHelp('no such flag'), []);
});

test('the permission mode is read from the TUI footer', () => {
  // Both captured from a real host: Opus honours auto, Haiku falls back.
  assert.equal(L.modeFromPane(['  \x1b[38;5;246m⏵⏵ auto mode on (shift+tab to cycle) · PR #1']), 'auto');
  assert.equal(L.modeFromPane(['  ⏸ manual mode on · ? for shortcuts · ← for agents']), 'manual');
  assert.equal(L.modeFromPane(['nothing here']), null);
});

test('a plan needs at least one "## Stage N" heading', () => {
  assert.equal(L.hasStages('# Plan\n\n## Stage 0 — x\n'), true);
  assert.equal(L.hasStages('# Plan\n\nStage 1 is mentioned in prose only\n'), false);
});

test('the kickoff template fills every placeholder it knows and leaves the rest visible', () => {
  const tpl = fs.readFileSync(path.resolve(import.meta.dirname, '../templates/kickoff.md'), 'utf8');
  const out = L.renderKickoff(tpl, {
    lane: 'bauplan', plan: 'docs/plans/bauplan.md', root: '/r', branch: 'feat/bauplan',
    slot: 2, pgPort: 15532, redisPort: 16479, s3Port: 19100, human: 'the owner',
  });
  assert.doesNotMatch(out, /\{\{\w+\}\}/, 'every placeholder in kickoff.md is filled at launch');
  assert.match(out, /Postgres on :15532/);
  assert.match(out, /LANE-DONE/);
  assert.match(out, /CLAUDE\.md/);
  assert.match(out, /gh pr create --draft/);
  assert.equal(L.renderKickoff('{{a}} {{b}}', { a: 1 }), '1 {{b}}');
});

test('the kickoff quotes the markers without triggering them', async () => {
  const markers = await import('../server/collector/markers.mjs');
  const tpl = fs.readFileSync(path.resolve(import.meta.dirname, '../templates/kickoff.md'), 'utf8');
  assert.deepEqual(markers.scanText(tpl), []);
  assert.equal(markers.classifyLine('LANE-DONE: all stages green')?.kind, 'done');
});

test('a launched lane is named by its record, whatever the repo prefix', async () => {
  clearLanes();
  writeLane('odd', 2, { root: '/x/some-repo-odd' });
  const lanes = await import('../server/collector/lanes.mjs');
  assert.equal(lanes.laneIdFor('/x/some-repo-odd'), 'odd');
  assert.equal(lanes.laneIdFor('/x/example-repo-bauplan'), 'bauplan');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a job cut off by a restart is marked interrupted at its step, once, and never resumed', async () => {
  const db = await import('../server/db.mjs');
  db.addJobStep({ job: 'j-cut', lane: 'cut', kind: 'launch', step: 'validate', ok: true });
  db.addJobStep({ job: 'j-cut', lane: 'cut', kind: 'launch', step: 'worktree', ok: true });
  db.addJobStep({ job: 'j-ok', lane: 'fine', kind: 'launch', step: 'done', ok: true });
  L.markInterrupted();
  const cut = db.jobSteps('j-cut');
  assert.equal(cut.at(-1).step, 'interrupted');
  assert.equal(cut.at(-1).ok, false);
  assert.deepEqual(cut.at(-1).detail, { after: 'worktree' });
  assert.equal(db.jobSteps('j-ok').length, 1, 'a finished job is left alone');
  // A second restart does not stack another row.
  L.markInterrupted();
  assert.equal(db.jobSteps('j-cut').length, 3);
});

test('the record is written at validation, so two launches at once cannot share a slot', async () => {
  clearLanes();
  // runLaunch is not reached: git has no repo here, so the job fails at step 2,
  // after the record exists. What matters is the slot each one was given.
  L.init({ state: { get: () => null, tick: async () => {} } });
  const [a, b] = await Promise.all([
    L.launch({ lane: 'twin-a', plan: 'docs/plans/twin-a.md', localBranch: true }),
    L.launch({ lane: 'twin-b', plan: 'docs/plans/twin-b.md', localBranch: true }),
  ]);
  assert.notEqual(a.slot, b.slot, `both launches got slot ${a.slot}`);
  assert.deepEqual([a.slot, b.slot].sort(), [2, 3]);
  // And a failed launch leaves a record for `retire --force` to find.
  assert.equal(store.read('twin-a').slot, a.slot);
  assert.equal(store.read('twin-a').retiredAt, null);
  await new Promise((r) => setTimeout(r, 200)); // let the background jobs fail and log
});

test('a step whose child was killed by a signal is an interruption, not a failure', async () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server/lanes/launch.mjs'), 'utf8');
  // Every child-process step hands its signal to fail(), which turns it into `interrupted`.
  for (const stepName of ['fetch', 'worktree', 'venv', 'slot']) {
    assert.match(src, new RegExp(`fail\\('${stepName}', \\{[^\\n]*signal: \\w+\\.signal`), `${stepName} passes the signal`);
  }
  assert.match(src, /if \(shuttingDown \|\| detail\?\.signal\)/);
  const util = await import('../server/util.mjs');
  const r = await util.run('sh', ['-c', 'kill -TERM $$']);
  assert.equal(r.ok, false);
  assert.equal(r.signal, 'SIGTERM');
});
