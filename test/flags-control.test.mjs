import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The approvals core logs to the db: keep a targeted run off the real
// database and config, as `npm test` does.
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const stateMod = await import('../server/state.mjs');
const approvals = await import('../server/control/approvals.mjs');
const pause = await import('../server/control/pause.mjs');
const { createContext } = await import('../server/modules.mjs');
const approvalFlag = await import('../server/flags/approval.mjs');
const pausedFlag = await import('../server/flags/paused.mjs');

const SID_A = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID_B = '7f00aa11-2222-4333-8444-555566667777';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lb-flags-control-'));
}

function permission(sessionId, over = {}) {
  return {
    session_id: sessionId,
    cwd: '/nonexistent-lb-cwd',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build' },
    ...over,
  };
}

function sessions() {
  return [
    { name: 'builder-a-x1', state: 'working', claude: { sessionId: SID_A }, attentionScore: 0 },
    { name: 'builder-a-f3', state: 'working', claude: { sessionId: SID_B }, attentionScore: 0 },
    { name: 'shell', state: 'shell', claude: null, attentionScore: 0 },
  ];
}

/** Register both flag modules on the real state hooks; returns a cleanup. */
function setup(stateDir) {
  stateMod._resetHooks();
  approvals._reset();
  const ctx = createContext({ mode: 'builder', state: stateMod, config: { stateDir } });
  for (const m of [approvalFlag.default, pausedFlag.default]) {
    assert.deepEqual(m.modes, ['builder']);
    m.register(ctx);
  }
  return () => {
    approvalFlag.default.stop();
    pausedFlag.default.stop();
    approvals._reset();
    stateMod._resetHooks();
    fs.rmSync(stateDir, { recursive: true, force: true });
  };
}

test('with nothing held or paused, the flags are null and the snapshot has approvals: []', (t) => {
  t.after(setup(tmpStateDir()));
  const list = stateMod.decorateSessions(sessions(), Date.now());
  for (const s of list) {
    assert.equal(s.awaitingApproval, null);
    assert.equal(s.paused, null);
    assert.equal(s.attentionScore, 0);
  }
  const snap = stateMod.snapshot();
  assert.deepEqual(snap.approvals, []);
});

test('a pending approval sets awaitingApproval by sessionId and scores as waiting_permission', (t) => {
  t.after(setup(tmpStateDir()));
  const { approval } = approvals.open(permission(SID_A), { nameOf: () => 'builder-a-x1', timeoutMs: 60_000 });
  const list = stateMod.decorateSessions(sessions(), Date.now());
  assert.equal(list[0].awaitingApproval, approval.id);
  assert.equal(list[0].state, 'working', 'the state word is not changed');
  assert.equal(list[0].attentionScore, 100, 'attention treats it as waiting_permission');
  assert.equal(list[1].awaitingApproval, null);
  assert.equal(list[1].attentionScore, 0);
  assert.equal(list[2].awaitingApproval, null);

  const snap = stateMod.snapshot();
  assert.equal(snap.approvals.length, 1);
  assert.equal(snap.approvals[0].id, approval.id);
  assert.equal(snap.approvals[0].sessionId, SID_A);
  assert.ok(snap.approvals[0].preview, 'the approval preview is kept');
});

test('awaitingApproval follows decide/supersede (the onChange cache is invalidated)', (t) => {
  t.after(setup(tmpStateDir()));
  const first = approvals.open(permission(SID_A), { timeoutMs: 60_000 }).approval;
  const second = approvals.open(permission(SID_A, { tool_input: { command: 'ls' } }), { now: Date.now() + 5, timeoutMs: 60_000 }).approval;
  let s = stateMod.decorateSessions(sessions(), Date.now())[0];
  assert.equal(s.awaitingApproval, first.id, 'the oldest pending approval is the one shown');

  approvals.decide(first.id, { behavior: 'allow' }, 'builder-a');
  s = stateMod.decorateSessions(sessions(), Date.now())[0];
  assert.equal(s.awaitingApproval, second.id);

  approvals.supersede(SID_A, 'PostToolUse');
  s = stateMod.decorateSessions(sessions(), Date.now())[0];
  assert.equal(s.awaitingApproval, null);
  assert.equal(s.attentionScore, 0);
  assert.deepEqual(stateMod.snapshot().approvals, []);
});

test('approval text stays plain strings in the snapshot (untrusted, never escaped or parsed)', (t) => {
  t.after(setup(tmpStateDir()));
  const evil = "<img src=x onerror=alert(1)> &amp; 'q'";
  approvals.open(permission(SID_B, { tool_input: { command: evil } }), { timeoutMs: 60_000 });
  const [a] = stateMod.snapshot().approvals;
  assert.equal(typeof a.input, 'string');
  assert.ok(a.input.includes(evil), 'input is the raw text, not HTML-escaped');
  assert.equal(typeof a.summary, 'string');
  assert.ok(a.summary.includes('<img src=x onerror=alert(1)>'));
  for (const line of a.preview.lines) assert.equal(typeof line.s, 'string');
  assert.ok(a.preview.lines.some((l) => l.s.includes(evil)));
  // A clone: mutating the snapshot does not touch the queue.
  a.input = 'changed';
  assert.ok(stateMod.snapshot().approvals[0].input.includes(evil));
});

test('a session pause sets paused {scope:session, kind, by, at}; others stay null', (t) => {
  const stateDir = tmpStateDir();
  t.after(setup(stateDir));
  pause.pause('builder-a-x1', { kind: 'budget', by: 'builder-a', reason: 'cap' }, { stateDir, now: 1234 });
  pausedFlag.invalidate();
  const list = stateMod.decorateSessions(sessions(), Date.now());
  assert.deepEqual(list[0].paused, { scope: 'session', kind: 'budget', by: 'builder-a', at: 1234 });
  assert.equal(list[1].paused, null);
  assert.equal(list[2].paused, null);
  assert.equal(list[0].attentionScore, 0, 'a pause alone does not raise attention');
});

test('paused/ALL wins over a session pause and covers every session', (t) => {
  const stateDir = tmpStateDir();
  t.after(setup(stateDir));
  pause.pause('builder-a-x1', { kind: 'operator', by: 'builder-a' }, { stateDir, now: 1 });
  pause.pause('ALL', { kind: 'operator', by: 'hub' }, { stateDir, now: 2 });
  pausedFlag.invalidate();
  const list = stateMod.decorateSessions(sessions(), Date.now());
  for (const s of list) assert.deepEqual(s.paused, { scope: 'all', kind: 'operator', by: 'hub', at: 2 });

  pause.resume('ALL', {}, { stateDir });
  pausedFlag.invalidate();
  const after = stateMod.decorateSessions(sessions(), Date.now());
  assert.equal(after[0].paused.scope, 'session');
  assert.equal(after[1].paused, null);
});

test('the tick hook writes sid- mirrors for paused names and removes them on resume', async (t) => {
  const stateDir = tmpStateDir();
  t.after(setup(stateDir));
  const mirror = path.join(stateDir, 'paused', `sid-${SID_A}`);
  pause.pause('builder-a-x1', { kind: 'operator', by: 'builder-a' }, { stateDir, now: 7 });
  pausedFlag.tick({ sessions: sessions() }, 10);
  assert.ok(fs.existsSync(mirror), 'mirror written');
  assert.equal(JSON.parse(fs.readFileSync(mirror, 'utf8')).name, 'builder-a-x1');
  assert.equal(fs.existsSync(path.join(stateDir, 'paused', `sid-${SID_B}`)), false);

  // A session that matches only through its mirror (e.g. renamed) is still paused.
  const renamed = stateMod.decorateSessions([{ name: 'renamed', state: 'working', claude: { sessionId: SID_A } }], Date.now());
  assert.equal(renamed[0].paused.scope, 'session');

  pause.resume('builder-a-x1', {}, { stateDir });
  pausedFlag.tick({ sessions: sessions() }, 20);
  assert.equal(fs.existsSync(path.join(stateDir, 'paused')), false, 'the empty paused/ dir is removed');
  assert.equal(stateMod.decorateSessions(sessions(), Date.now())[0].paused, null);

  // Registered through state.onTick: runTickHooks runs it without throwing.
  await stateMod.runTickHooks(30);
});

test('an unreadable or hostile sentinel still pauses, with bounded normalized fields', (t) => {
  const stateDir = tmpStateDir();
  t.after(setup(stateDir));
  fs.mkdirSync(path.join(stateDir, 'paused'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'paused', 'builder-a-f3'), '{"kind":"<b>evil</b>","by":{"x":1},"__proto__":{"polluted":1}}');
  pausedFlag.invalidate();
  const [, s] = stateMod.decorateSessions(sessions(), Date.now());
  assert.deepEqual(s.paused, { scope: 'session', kind: 'operator', by: null, at: null });
  assert.equal({}.polluted, undefined);
});

test('a missing state dir is no pause, not an error', (t) => {
  const stateDir = path.join(tmpStateDir(), 'does', 'not', 'exist');
  t.after(setup(stateDir));
  const list = stateMod.decorateSessions(sessions(), Date.now());
  assert.equal(list[0].paused, null);
  pausedFlag.tick({ sessions: sessions() }, 1);
});

test('both flags land on sessions in one pass and the module shapes are valid', (t) => {
  const stateDir = tmpStateDir();
  t.after(setup(stateDir));
  approvals.open(permission(SID_B), { timeoutMs: 60_000 });
  pause.pause('builder-a-f3', { kind: 'quota', by: 'laneboard' }, { stateDir, now: 3 });
  pausedFlag.invalidate();
  const [, s] = stateMod.decorateSessions(sessions(), Date.now());
  assert.equal(typeof s.awaitingApproval, 'string');
  assert.equal(s.paused.kind, 'quota');
  assert.equal(s.attentionScore, 100);
  assert.equal(approvalFlag.default.name, 'flag-approval');
  assert.equal(pausedFlag.default.name, 'flag-paused');
  // A second registration of the same flag is refused by state.mjs.
  assert.throws(() => approvalFlag.default.register(createContext({ state: stateMod, config: { stateDir } })), /already registered/);
});
