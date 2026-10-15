import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as pause from '../server/control/pause.mjs';

const GATE = fileURLToPath(new URL('../deploy/hooks/gate.sh', import.meta.url));
const HAS_JQ = spawnSync('jq', ['--version'], { stdio: 'ignore' }).status === 0;
const NEEDS_JQ = HAS_JQ ? false : 'jq is not installed: the gate.sh tests that parse hook JSON need jq';

// Everything lives in throwaway dirs: never the real state dir or ~/.claude.
const dirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-pause-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const SID = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID2 = '7f00aa11-2222-4333-8444-555566667777';

test('pausePath validates scopes', () => {
  const d = tmp();
  assert.equal(pause.pausePath(d, 'ALL'), path.join(d, 'paused', 'ALL'));
  assert.equal(pause.pausePath(d, 'lane a (1)'), path.join(d, 'paused', 'lane a (1)'));
  for (const bad of ['', '..', '.', '.hidden', 'a/b', '../x', 'sid-abc', 'x'.repeat(65), 'a\nb', null, 42, '$(id)']) {
    assert.throws(() => pause.pausePath(d, bad), pause.PauseError, String(bad));
  }
  assert.throws(() => pause.pausePath('', 'ALL'), pause.PauseError);
});

test('pause writes a sentinel with kind/by/at/reason; list and kindOf read it', () => {
  const d = tmp();
  const r = pause.pause('lane-1', { kind: 'operator', by: 'builder-a', reason: 'lunch' }, { stateDir: d, now: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.scope, 'lane-1');
  const content = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  assert.deepEqual(content, { kind: 'operator', by: 'builder-a', at: 1000, reason: 'lunch' });
  assert.equal((fs.statSync(r.file).mode & 0o777), 0o600);
  assert.equal((fs.statSync(path.join(d, 'paused')).mode & 0o777), 0o700);
  assert.deepEqual(pause.list({ stateDir: d }), [{ scope: 'lane-1', kind: 'operator', by: 'builder-a', at: 1000, reason: 'lunch' }]);
  assert.equal(pause.kindOf('lane-1', { stateDir: d }), 'operator');
  assert.equal(pause.kindOf('other', { stateDir: d }), null);
  assert.equal(pause.kindOf('../x', { stateDir: d }), null);
  // No temp files left behind.
  assert.deepEqual(fs.readdirSync(path.join(d, 'paused')), ['lane-1']);
});

test('pause rejects unknown kinds and clamps by/reason', () => {
  const d = tmp();
  assert.throws(() => pause.pause('a', { kind: 'evil' }, { stateDir: d }), pause.PauseError);
  pause.pause('a', { by: 'x'.repeat(1000), reason: 'y'.repeat(5000) }, { stateDir: d });
  const [e] = pause.list({ stateDir: d });
  assert.equal(e.kind, 'operator');
  assert.equal(e.by.length, 128);
  assert.equal(e.reason.length, 500);
});

test('ALL vs session: list puts ALL first, resume ALL leaves session pauses', () => {
  const d = tmp();
  pause.pause('zeta', {}, { stateDir: d });
  pause.pause('ALL', { by: 'hub' }, { stateDir: d });
  pause.pause('alpha', {}, { stateDir: d });
  assert.deepEqual(pause.list({ stateDir: d }).map((e) => e.scope), ['ALL', 'alpha', 'zeta']);
  const r = pause.resume('ALL', {}, { stateDir: d });
  assert.deepEqual(r.removed, ['ALL']);
  assert.deepEqual(pause.list({ stateDir: d }).map((e) => e.scope), ['alpha', 'zeta']);
});

test('a pause never downgrades a budget/quota pause to operator', () => {
  const d = tmp();
  pause.pause('a', { kind: 'budget', by: 'budget' }, { stateDir: d });
  const r = pause.pause('a', { kind: 'operator', by: 'builder-a' }, { stateDir: d });
  assert.equal(r.kept, true);
  assert.equal(pause.kindOf('a', { stateDir: d }), 'budget');
  pause.pause('b', { kind: 'quota' }, { stateDir: d });
  pause.pause('b', { kind: 'budget' }, { stateDir: d });
  assert.equal(pause.kindOf('b', { stateDir: d }), 'budget');
});

test('resume with a kinds filter keeps other kinds', () => {
  const d = tmp();
  pause.pause('a', { kind: 'budget' }, { stateDir: d });
  pause.pause('b', { kind: 'operator' }, { stateDir: d });
  let r = pause.resume('a', { kinds: ['operator'] }, { stateDir: d });
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.kept, [{ scope: 'a', kind: 'budget' }]);
  r = pause.resume('b', { kinds: ['operator'] }, { stateDir: d });
  assert.deepEqual(r.removed, ['b']);
  r = pause.resume('a', {}, { stateDir: d });
  assert.deepEqual(r.removed, ['a']);
  // Resuming something not paused is fine.
  assert.deepEqual(pause.resume('nothing', {}, { stateDir: d }).removed, []);
});

test('the paused/ directory is removed when it becomes empty', () => {
  const d = tmp();
  pause.pause('a', {}, { stateDir: d });
  pause.pause('ALL', {}, { stateDir: d });
  pause.resume('a', {}, { stateDir: d });
  assert.ok(fs.existsSync(path.join(d, 'paused')));
  pause.resume('ALL', {}, { stateDir: d });
  assert.equal(fs.existsSync(path.join(d, 'paused')), false);
  assert.deepEqual(pause.list({ stateDir: d }), []);
});

test('a corrupt sentinel still counts as a pause (kind operator)', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'paused'));
  fs.writeFileSync(path.join(d, 'paused', 'x'), 'not json');
  assert.deepEqual(pause.list({ stateDir: d }), [{ scope: 'x', kind: 'operator', by: null, at: null, reason: null }]);
});

test('syncMirrors writes sid- mirrors for paused names and deletes orphans', () => {
  const d = tmp();
  // Nothing paused: no directory is created.
  assert.deepEqual(pause.syncMirrors([{ name: 'a', sessionId: SID }], { stateDir: d }), { written: [], removed: [] });
  assert.equal(fs.existsSync(path.join(d, 'paused')), false);

  pause.pause('a', { kind: 'budget', by: 'budget' }, { stateDir: d, now: 5 });
  const sessions = [
    { name: 'a', claude: { sessionId: SID } }, // state.mjs session shape
    { name: 'b', sessionId: SID2 },
    { name: 'c', sessionId: '../../etc' }, // unsafe id: ignored
  ];
  let r = pause.syncMirrors(sessions, { stateDir: d });
  assert.deepEqual(r.written, [`sid-${SID}`]);
  const m = JSON.parse(fs.readFileSync(path.join(d, 'paused', `sid-${SID}`), 'utf8'));
  assert.deepEqual(m, { kind: 'budget', by: 'budget', at: 5, reason: null, name: 'a' });
  // Idempotent: nothing rewritten on the next tick.
  r = pause.syncMirrors(sessions, { stateDir: d });
  assert.deepEqual(r, { written: [], removed: [] });
  // Mirrors are hidden from list() unless asked for.
  assert.deepEqual(pause.list({ stateDir: d }).map((e) => e.scope), ['a']);
  const withM = pause.list({ stateDir: d, mirrors: true });
  assert.equal(withM.find((e) => e.mirror).name, 'a');

  // The session went away: its mirror is an orphan.
  fs.writeFileSync(path.join(d, 'paused', `sid-${SID2}`), '{}');
  r = pause.syncMirrors([{ name: 'b', sessionId: SID2 }], { stateDir: d });
  assert.deepEqual(r.removed.sort(), [`sid-${SID}`, `sid-${SID2}`].sort());
  assert.deepEqual(fs.readdirSync(path.join(d, 'paused')), ['a']);
});

test('resume of a session drops its mirrors at once; syncMirrors removes the empty dir', () => {
  const d = tmp();
  pause.pause('a', {}, { stateDir: d });
  pause.syncMirrors([{ name: 'a', sessionId: SID }], { stateDir: d });
  assert.ok(fs.existsSync(path.join(d, 'paused', `sid-${SID}`)));
  pause.resume('a', {}, { stateDir: d });
  assert.equal(fs.existsSync(path.join(d, 'paused')), false);
});

test('syncMirrors clears stale temp files that would keep the directory alive', () => {
  const d = tmp();
  pause.pause('a', {}, { stateDir: d });
  const stale = path.join(d, 'paused', '.a.1.dead.tmp');
  fs.writeFileSync(stale, '');
  pause.resume('a', {}, { stateDir: d });
  assert.ok(fs.existsSync(stale));
  pause.syncMirrors([], { stateDir: d, now: Date.now() + 120_000 });
  assert.equal(fs.existsSync(path.join(d, 'paused')), false);
});

test('isPaused: ALL wins, then the name, then the sid mirror', () => {
  const entries = [
    { scope: 'a', kind: 'operator', by: 'u', at: 1, reason: null },
    { scope: `sid-${SID2}`, kind: 'quota', by: 'q', at: 2, reason: null, mirror: true, name: 'b' },
  ];
  assert.deepEqual(pause.isPaused('a', null, entries), { scope: 'session', kind: 'operator', by: 'u', at: 1, reason: null });
  assert.equal(pause.isPaused('b', null, entries), null);
  assert.equal(pause.isPaused('b', SID2, entries).kind, 'quota');
  assert.equal(pause.isPaused('c', SID, entries), null);
  assert.equal(pause.isPaused('a', null, []), null);
  assert.equal(pause.isPaused('a', null, undefined), null);
  const all = [{ scope: 'ALL', kind: 'budget', by: 'budget', at: 3, reason: 'cap' }, ...entries];
  assert.deepEqual(pause.isPaused('zzz', null, all), { scope: 'all', kind: 'budget', by: 'budget', at: 3, reason: 'cap' });
});

test('syncCeilings writes number files and removes the rest', () => {
  const d = tmp();
  let r = pause.syncCeilings(new Map([[SID, 4.5], ['../bad', 1], [SID2, NaN]]), { stateDir: d });
  assert.deepEqual(r.written, [`sid-${SID}`]);
  assert.equal(JSON.parse(fs.readFileSync(pause.ceilingPath(d, SID), 'utf8')), 4.5);
  r = pause.syncCeilings({ [SID]: 4.5 }, { stateDir: d });
  assert.deepEqual(r, { written: [], removed: [] });
  r = pause.syncCeilings(new Map(), { stateDir: d });
  assert.deepEqual(r.removed, [`sid-${SID}`]);
  assert.equal(fs.existsSync(path.join(d, 'ceiling')), false);
  assert.throws(() => pause.ceilingPath(d, 'a/b'), pause.PauseError);
});

test('defaultStateDir honours LANEBOARD_STATE_DIR', () => {
  assert.equal(pause.defaultStateDir({ LANEBOARD_STATE_DIR: '/x/y' }), '/x/y');
  assert.ok(pause.defaultStateDir({}).endsWith(path.join('.local', 'state', 'laneboard')));
});

// ---- deploy/hooks/gate.sh ----

function gate(input, { stateDir, home, pathDirs = [], env = {} } = {}) {
  const r = spawnSync('sh', [GATE], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    // Explicit env: no TMUX_PANE from the test runner, a fake HOME.
    env: {
      PATH: [...pathDirs, process.env.PATH].join(path.delimiter),
      HOME: home ?? tmp(),
      LANEBOARD_STATE_DIR: stateDir,
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ev = (hook_event_name, session_id = SID, extra = {}) => JSON.stringify({ hook_event_name, session_id, ...extra });

test('gate.sh passes sh -n', () => {
  const r = spawnSync('sh', ['-n', GATE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('gate: no state dir → exit 0, empty output (fast path)', () => {
  const d = tmp();
  const r = gate(ev('PreToolUse'), { stateDir: d });
  assert.deepEqual(r, { code: 0, out: '', err: '' });
  // Even with garbage on stdin.
  assert.deepEqual(gate('{{{ nope', { stateDir: d }), { code: 0, out: '', err: '' });
  // And with the state dir itself missing.
  assert.deepEqual(gate(ev('PreToolUse'), { stateDir: path.join(d, 'missing') }), { code: 0, out: '', err: '' });
});

test('gate: fast path measured (median of 30 runs)', () => {
  const d = tmp();
  const times = [];
  for (let i = 0; i < 30; i++) {
    const t0 = process.hrtime.bigint();
    const r = gate(ev('PreToolUse'), { stateDir: d });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    assert.equal(r.code, 0);
  }
  times.sort((a, b) => a - b);
  const median = times[15];
  // Includes Node's spawn overhead; the script itself is one [ -d ] pair.
  console.log(`# gate.sh fast path: median ${median.toFixed(2)} ms per spawn (incl. process start)`);
  assert.ok(median < 100, `median ${median} ms`);
});

test('gate: ALL + PreToolUse → deny JSON with continue:false', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('ALL', { by: 'builder-a' }, { stateDir: d });
  const r = gate(ev('PreToolUse', SID, { tool_name: 'Bash' }), { stateDir: d });
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.continue, false);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /Paused by operator/);
  assert.equal(j.stopReason, j.hookSpecificOutput.permissionDecisionReason);
});

test('gate: UserPromptSubmit while paused → decision:block', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('ALL', {}, { stateDir: d });
  const r = gate(ev('UserPromptSubmit', SID, { prompt: 'go' }), { stateDir: d });
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.decision, 'block');
  assert.match(j.reason, /Paused by operator/);
});

test('gate: a sid- mirror matches its session only', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('a', { kind: 'budget' }, { stateDir: d });
  pause.syncMirrors([{ name: 'a', sessionId: SID }], { stateDir: d });
  const hit = gate(ev('PreToolUse', SID), { stateDir: d });
  assert.equal(JSON.parse(hit.out).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(JSON.parse(hit.out).stopReason, /budget/);
  // Unpaused session while another is paused → empty.
  assert.deepEqual(gate(ev('PreToolUse', SID2), { stateDir: d }), { code: 0, out: '', err: '' });
  // A session id that tries to walk the path is ignored, not matched.
  fs.writeFileSync(path.join(d, 'paused', 'sid-x'), '{}');
  assert.deepEqual(gate(ev('PreToolUse', 'x/../../paused/ALL'), { stateDir: d }), { code: 0, out: '', err: '' });
});

test('gate: session name via tmux ($TMUX_PANE) matches paused/<name>', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  const bin = tmp();
  // Fake tmux: prints the session name for `display-message -p -t <pane> '#S'`.
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "%s\\n" "lane a (1)"\n', { mode: 0o755 });
  pause.pause('lane a (1)', {}, { stateDir: d });
  const r = gate(ev('PreToolUse', SID2), { stateDir: d, pathDirs: [bin], env: { TMUX_PANE: '%3' } });
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny');
  // Another tmux name → not paused.
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho other\n', { mode: 0o755 });
  assert.equal(gate(ev('PreToolUse', SID2), { stateDir: d, pathDirs: [bin], env: { TMUX_PANE: '%3' } }).out, '');
  // A name with a slash from tmux is ignored.
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho ../paused/x\n', { mode: 0o755 });
  assert.equal(gate(ev('PreToolUse', SID2), { stateDir: d, pathDirs: [bin], env: { TMUX_PANE: '%3' } }).out, '');
});

test('gate: malformed stdin with no sentinel → exit 0, empty', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('a', {}, { stateDir: d }); // paused/ exists, but nothing matches
  assert.deepEqual(gate('{{{ not json', { stateDir: d }), { code: 0, out: '', err: '' });
  assert.deepEqual(gate('', { stateDir: d }), { code: 0, out: '', err: '' });
});

test('gate: malformed stdin while paused/ALL exists → exit 2 (fail closed)', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('ALL', {}, { stateDir: d });
  for (const input of ['{{{ not json', '', '[]', ev('SomethingNew')]) {
    const r = gate(input, { stateDir: d });
    assert.equal(r.code, 2, input);
    assert.equal(r.out, '');
    assert.match(r.err, /Paused by operator/);
  }
});

test('gate: jq missing while paused/ALL exists → exit 2; jq missing, not paused → exit 0', () => {
  // A PATH with cat but no jq (works whether or not jq is installed).
  const bin = tmp();
  const cat = spawnSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).stdout.trim();
  fs.symlinkSync(cat, path.join(bin, 'cat'));
  const d = tmp();
  const run = () => spawnSync('/bin/sh', [GATE], {
    input: ev('PreToolUse'),
    encoding: 'utf8',
    env: { PATH: bin, HOME: tmp(), LANEBOARD_STATE_DIR: d },
  });
  let r = run();
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  pause.pause('ALL', {}, { stateDir: d });
  r = run();
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Paused by operator/);
});

test('gate: budget ceiling reached (status JSON in a fake HOME) → deny', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  const home = tmp();
  const statusDir = path.join(home, '.cache', 'laneboard', 'status');
  fs.mkdirSync(statusDir, { recursive: true });
  pause.syncCeilings({ [SID]: 2.5 }, { stateDir: d });
  const status = (usd) => fs.writeFileSync(path.join(statusDir, `${SID}.json`), JSON.stringify({ session_id: SID, cost: { total_cost_usd: usd } }));

  status(1.25);
  assert.deepEqual(gate(ev('PreToolUse'), { stateDir: d, home }), { code: 0, out: '', err: '' });

  status(2.5);
  let r = gate(ev('PreToolUse'), { stateDir: d, home });
  let j = JSON.parse(r.out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(j.continue, false);
  assert.match(j.stopReason, /budget/);

  status(9);
  r = gate(ev('UserPromptSubmit'), { stateDir: d, home });
  assert.equal(JSON.parse(r.out).decision, 'block');

  // Another session has no ceiling.
  assert.equal(gate(ev('PreToolUse', SID2), { stateDir: d, home }).out, '');
  // Object form {usd} is accepted too.
  fs.writeFileSync(pause.ceilingPath(d, SID), JSON.stringify({ usd: 100 }));
  assert.equal(gate(ev('PreToolUse'), { stateDir: d, home }).out, '');
  // Unreadable numbers do not fire (the server-side budget pause still applies).
  fs.writeFileSync(pause.ceilingPath(d, SID), 'garbage');
  assert.equal(gate(ev('PreToolUse'), { stateDir: d, home }).out, '');
  // No status file → no hit.
  fs.writeFileSync(pause.ceilingPath(d, SID), '1');
  fs.rmSync(path.join(statusDir, `${SID}.json`));
  assert.equal(gate(ev('PreToolUse'), { stateDir: d, home }).out, '');
});

test('gate: a quota pause gets the quota reason', { skip: NEEDS_JQ }, () => {
  const d = tmp();
  pause.pause('ALL', { kind: 'quota' }, { stateDir: d });
  assert.match(JSON.parse(gate(ev('PreToolUse'), { stateDir: d }).out).stopReason, /quota/);
});
