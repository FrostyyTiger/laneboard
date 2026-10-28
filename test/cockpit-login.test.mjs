// The agent's login check and the room's status slot (spec protocols.md
// §11.10, §3.5; c1-talk.md §10.1; D151, D152): §11.10's result table, the
// login words, the 10 s timeout row (S-C1-37's node:test part, `login` `hang`),
// the checks over time on a `manual` room clock, and the arbiter's order and
// news rule. The session test at the end runs the fake agent (stand-ins.md §2.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHECK_EVERY_MS, CHECK_HELD_MS, CHECK_TIMEOUT_MS, LOGIN_WORDS, checkArgv, createLoginWatch, hasLoginWords,
  loginResult, runLoginCheck,
} from '../server/cockpit/login.mjs';
import { ROOM_ROWS, createStatus } from '../server/cockpit/status.mjs';
import { createSession } from '../server/cockpit/session.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { createTestClock, setClock } from '../server/cockpit/clock.mjs';
import { fakeAgentLog } from './cockpit/stand-ins/fake-agent-log.mjs';

// The spec's +01:00 times: the room writes `since` and its log in its own zone.
process.env.TZ = 'Europe/Zurich';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs');

function manualClock(t, iso = '2026-10-27T03:00:00+01:00') {
  const clock = createTestClock({ start: Date.parse(iso) });
  clock.setMode('manual');
  setClock(clock);
  t.after(() => setClock(null));
  return clock;
}

function fakeDir(t, login) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const use = (l) => fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({
    name: 'login', start: { initAfterMs: 30, login: l, capabilities: ['interrupt_receipt_v1'] },
    turns: [{ repeat: true, steps: [{ at: 20, text: 'ok' }, { at: 40, end: 'done' }] }],
  }));
  use(login);
  return { dir, use };
}

// ---------------------------------------------------------------- the table

test('§11.10 result table: exit 0 ok; non-zero with the login words not-logged-in; the rest unknown', () => {
  assert.equal(loginResult({ code: 0, output: 'Logged in.' }), 'ok');
  assert.equal(loginResult({ code: 0, output: 'not logged in' }), 'ok', 'exit 0 wins');
  assert.equal(loginResult({ code: 1, output: 'Not logged in. Run claude to log in.' }), 'not-logged-in');
  assert.equal(loginResult({ code: 2, output: 'API Error: 401' }), 'not-logged-in');
  assert.equal(loginResult({ code: 1, output: 'disk full' }), 'unknown', 'another exit');
  assert.equal(loginResult({ code: null, output: 'not logged in' }), 'unknown', 'a signal');
  assert.equal(loginResult({ timedOut: true, output: 'not logged in' }), 'unknown', 'a timeout');
  assert.equal(loginResult({ error: 'ENOENT' }), 'unknown', 'the command not found');
});

test('§11.10 login words, case-insensitive, and the pinned JSON of Claude Code 2.1.303 (B212)', () => {
  assert.deepEqual([...LOGIN_WORDS], ['not logged in', 'log in', 'login', '401', 'invalid api key', 'authentication']);
  for (const s of ['NOT LOGGED IN', 'Please log in', 'Login expired · Please run /login', 'HTTP 401', 'Invalid API key', 'Authentication required']) {
    assert.ok(hasLoginWords(s), s);
  }
  assert.ok(hasLoginWords('{\n  "loggedIn": false,\n  "authMethod": "none"\n}'));
  assert.ok(!hasLoginWords('{"loggedIn": true, "authMethod": "claude.ai"}'));
  assert.ok(!hasLoginWords('claude: command not found'));
  assert.ok(!hasLoginWords(null));
});

test('the check runs as the agent: argv as configured, behind sudo -n with a user (D214)', () => {
  const agent = { loginCheck: ['claude', 'auth', 'status'], user: null };
  assert.deepEqual(checkArgv(agent), ['claude', 'auth', 'status']);
  assert.deepEqual(checkArgv({ ...agent, user: 'lb-agent' }, ['ACME_KEY']),
    ['sudo', '-n', '-u', 'lb-agent', '-H', '--preserve-env=ACME_KEY', '--', 'claude', 'auth', 'status']);
});

// ---------------------------------------------------------------- one run

test('a run against the fake agent: ok, then not-logged-in (exit 1), stdin closed, no shell', async (t) => {
  const f = fakeDir(t, 'ok');
  const env = { PATH: process.env.PATH, FAKE_AGENT_DIR: f.dir };
  const argv = [process.execPath, FAKE, 'auth', 'status'];
  assert.deepEqual(await runLoginCheck({ argv, cwd: f.dir, env }), { result: 'ok', why: 'exit 0' });
  f.use('failed');
  assert.deepEqual(await runLoginCheck({ argv, cwd: f.dir, env }), { result: 'not-logged-in', why: 'exit 1' });
  assert.deepEqual(fakeAgentLog(f.dir).loginChecks().map((l) => [l.login, l.exit]), [['ok', 0], ['failed', 1]]);
});

test('a command that is not there is unknown', async (t) => {
  const f = fakeDir(t, 'ok');
  const r = await runLoginCheck({ argv: [path.join(f.dir, 'no-such-claude'), 'auth', 'status'], cwd: f.dir, env: {} });
  assert.equal(r.result, 'unknown');
  assert.match(r.why, /^cannot start: ENOENT/);
});

test('S-C1-37 the 10 s timeout row: `login` `hang` is unknown after 10 s, the check SIGTERMed', async (t) => {
  assert.equal(CHECK_TIMEOUT_MS, 10_000);
  const f = fakeDir(t, 'hang');
  const t0 = Date.now();
  const r = await runLoginCheck({ argv: [process.execPath, FAKE, 'auth', 'status'], cwd: f.dir, env: { PATH: process.env.PATH, FAKE_AGENT_DIR: f.dir } });
  const took = Date.now() - t0;
  assert.deepEqual(r, { result: 'unknown', why: 'timeout 10 s' });
  assert.ok(took >= 10_000 && took < 11_500, `took ${took} ms`);
});

// ---------------------------------------------------------------- over time

function watch(t, results, { idle = true } = {}) {
  const clock = manualClock(t);
  const calls = [];
  const conds = [];
  const logs = [];
  let relogins = 0;
  const w = createLoginWatch({
    run: async () => { calls.push(clock.now()); return results.shift() ?? { result: 'ok', why: 'exit 0' }; },
    condition: (code, fields) => conds.push(fields === null ? null : { code, ...fields }),
    log: (l) => logs.push(l),
    idle: () => idle,
    relogin: () => { relogins += 1; },
  });
  t.after(() => w.close());
  return { clock, w, calls, conds, logs, relogins: () => relogins };
}

const settle = () => new Promise((r) => setImmediate(r));
const NLI = { result: 'not-logged-in', why: 'exit 1' };
const OK = { result: 'ok', why: 'exit 0' };

test('§11.10 "When": at the start, every 900 s, every 60 s while logged out; since stays the first', async (t) => {
  const { clock, w, calls, conds, logs } = watch(t, [OK, NLI, NLI, NLI, NLI, OK]);
  const t0 = clock.now();
  w.start();
  await settle();
  assert.deepEqual(calls, [t0]);
  await clock.advance(CHECK_EVERY_MS - 1);
  assert.equal(calls.length, 1);
  await clock.advance(1);
  assert.deepEqual(calls.map((c) => c - t0), [0, 900_000]);
  assert.deepEqual(conds, [{ code: 'not-logged-in', since: '2026-10-27T03:15:00.000+01:00' }]);
  for (let i = 0; i < 3; i += 1) await clock.advance(CHECK_HELD_MS);
  assert.deepEqual(calls.map((c) => c - t0), [0, 900_000, 960_000, 1_020_000, 1_080_000]);
  assert.ok(conds.every((c) => c?.since === '2026-10-27T03:15:00.000+01:00'), 'since 03:15, not the later checks');
  await clock.advance(CHECK_HELD_MS);
  assert.equal(conds.at(-1), null, 'the check finds the login back: the condition goes');
  await clock.advance(CHECK_HELD_MS);
  assert.equal(calls.length, 6, 'back to every 900 s');
  assert.deepEqual(logs, ['login check: ok (exit 0)', 'login check: not-logged-in (exit 1)', 'login check: ok (exit 0)'], 'one line per change, never one per run');
});

test('§11.10: an ok check after a set condition restarts the idle child once; not when a turn runs', async (t) => {
  const a = watch(t, [NLI, OK, OK]);
  a.w.start();
  await settle();
  await a.clock.advance(CHECK_HELD_MS);
  assert.equal(a.relogins(), 1);
  await a.clock.advance(CHECK_EVERY_MS);
  assert.equal(a.relogins(), 1, 'an ok with nothing set restarts nothing');
});

test('§11.10 "Other ways in": E4 sets, only a `done` turn clears what a turn set; a start blocks SEND until a session is up', async (t) => {
  const { clock, w, conds } = watch(t, [OK, OK, OK]);
  w.start();
  await settle();
  w.turnEnded({ type: 'turn.end', state: 'error', code: 'not-logged-in' });
  assert.equal(conds.at(-1).code, 'not-logged-in');
  await clock.advance(CHECK_HELD_MS);
  assert.equal(conds.at(-1)?.code, 'not-logged-in', 'a local check passing does not clear a turn\'s condition');
  w.turnEnded({ type: 'turn.end', state: 'stopped' });
  assert.equal(conds.at(-1)?.code, 'not-logged-in');
  w.turnEnded({ type: 'turn.end', state: 'done' });
  assert.equal(conds.at(-1), null);
  w.startFailed();
  assert.equal(conds.at(-1).blocksSend, true);
  w.sessionUp();
  assert.equal(conds.at(-1).code, 'not-logged-in');
  assert.equal(conds.at(-1).blocksSend, undefined, 'blocksSend gone once a session is up');
});

test('§11.10: it never runs twice at once', async (t) => {
  manualClock(t);
  let release;
  let runs = 0;
  const w = createLoginWatch({ run: () => { runs += 1; return new Promise((r) => { release = r; }); }, condition: () => {} });
  t.after(() => w.close());
  const a = w.checkNow();
  const b = w.checkNow();
  assert.equal(a, b);
  assert.equal(runs, 1);
  release(OK);
  await a;
});

// ---------------------------------------------------------------- the slot

test('§3.5 (D152): the highest that holds is sent, one message per change, null when nothing holds', (t) => {
  manualClock(t, '2026-10-27T07:04:00+01:00');
  const out = [];
  const logs = [];
  const st = createStatus({ emit: (m) => out.push(m), log: (l) => logs.push(l) });
  assert.deepEqual([...ROOM_ROWS], ['agent-down', 'not-logged-in', 'tools-down', 'board-down', 'agent-back']);
  st.set('board-down', { since: '2026-10-27T06:41:00.000+01:00' });
  st.set('not-logged-in', { since: '2026-10-27T03:15:00.000+01:00' });
  st.set('board-down', { since: '2026-10-27T06:41:00.000+01:00' }); // no change: no message
  st.set('agent-down', { detail: 'claude: command not found', blocksSend: true });
  st.set('agent-down', null);
  st.set('not-logged-in', null);
  st.set('board-down', null);
  st.set('board-down', null);
  assert.deepEqual(out.map((m) => m.status?.code ?? null), ['board-down', 'not-logged-in', 'agent-down', 'not-logged-in', 'board-down', null]);
  assert.deepEqual(out[2].status, { code: 'agent-down', since: '2026-10-27T07:04:00.000+01:00', detail: 'claude: command not found', blocksSend: true });
  for (const m of out) assert.deepEqual(checkMessage({ ...m, seq: 1 }, 'out'), { ok: true }, JSON.stringify(m));
  assert.deepEqual(logs, ['status board-down since 06:41', 'status not-logged-in since 03:15', 'status agent-down since 07:04', 'status not-logged-in since 03:15', 'status board-down since 06:41', 'status none']);
});

test('§10.1 rows 7: news never waits: outranked when it starts or while it shows, it is dropped', (t) => {
  manualClock(t, '2026-10-27T07:04:00+01:00');
  const out = [];
  const st = createStatus({ emit: (m) => out.push(m) });
  st.set('not-logged-in', { since: '2026-10-27T03:15:00.000+01:00' });
  st.set('agent-back', {});
  st.set('not-logged-in', null);
  assert.deepEqual(out.map((m) => m.status?.code ?? null), ['not-logged-in', null], 'agent-back is not shown later');
  st.set('agent-back', {});
  st.set('board-down', {});
  st.set('board-down', null);
  assert.deepEqual(out.slice(2).map((m) => m.status?.code ?? null), ['agent-back', 'board-down', null]);
});

// ---------------------------------------------------------------- the session

test('the session: logged out at the start, named before any prompt; the login back restarts the idle agent with --resume, no agent-back', async (t) => {
  const clock = manualClock(t);
  const f = fakeDir(t, 'failed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'cockpit-agent'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'cockpit'), { recursive: true, mode: 0o700 });
  const messages = [];
  const logs = [];
  const session = createSession({
    stateDir: dir,
    emit: (m) => messages.push(m),
    log: (l) => logs.push(l),
    bridge: {
      agent: {
        kind: 'claude-code', command: [process.execPath, FAKE], cwd: '{stateDir}/cockpit-agent', user: null,
        allowSameUser: true, allowedTools: ['Read'], allowUnrestricted: false, env: ['FAKE_AGENT_DIR'],
        loginCheck: [process.execPath, FAKE, 'auth', 'status'],
      },
      stateDir: dir, mcpToken: 't', env: { ...process.env, FAKE_AGENT_DIR: f.dir },
    },
  });
  t.after(() => session.close());
  const until = async (pred, what) => {
    const end = Date.now() + 10_000;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out: ${what}\n${logs.join('\n')}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const statuses = () => messages.filter((m) => m.type === 'status').map((m) => m.status?.code ?? null);
  session.start();
  await until(() => session.phase === 'up', 'ready');
  await until(() => statuses().length === 1, 'the status');
  assert.deepEqual(messages.find((m) => m.type === 'status').status, { code: 'not-logged-in', since: '2026-10-27T03:00:00.000+01:00' });
  assert.equal(fakeAgentLog(f.dir).prompts().length, 0);
  const starts = () => logs.filter((l) => l.startsWith('cockpit agent: started pid')).length;
  assert.equal(starts(), 1);
  f.use('ok');
  await clock.advance(CHECK_HELD_MS);
  assert.deepEqual(statuses(), ['not-logged-in', null]);
  await until(() => starts() === 2 && session.phase === 'up', 'the restart');
  assert.ok(logs.some((l) => /started pid \d+ \(claude-code, resume session/.test(l)), 'with --resume');
  assert.deepEqual(statuses(), ['not-logged-in', null], 'no agent-back for it');
});
