// The session supervisor (spec protocols.md §11.6-§11.7, §13's stop test and
// restart test; D103, D104, D289): stop, forced stop, crash restart and `new`
// against the fake agent, with the room clock `manual` so every 5.0 / 8.0 s
// step and every restart wait is asserted to the millisecond. The fake agent
// runs on real time; the room's timers fire only in clock.advance().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';

import {
  createSession, nextConversation, readSessionFile, writeSessionFile, sessionFilePath,
  STOP_FORCE_MS, STOP_TERM_MS, RESTART_STEPS_S, READY_WAIT_MS,
} from '../server/cockpit/session.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { setClock, createTestClock } from '../server/cockpit/clock.mjs';
import { fakeAgentLog } from './cockpit/stand-ins/fake-agent-log.mjs';
import { createLink } from '../server/cockpit/link.mjs';
import { classify } from '../server/fleet/auth.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs');
const TOOLS = ['mcp__laneboard__*', 'Read', 'Grep', 'Glob'];
const CAPS = ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'];
const SESSION_A = '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91';

const typed = (text, clientId = 'p-0000000a') => ({ clientId, screen: 'desk', text, source: 'typed', lang: null, about: null });
const fakeScript = (start, turns) => ({ name: 'session', start: { initAfterMs: 30, capabilities: CAPS, ...start }, turns });

function manualClock(t) {
  const clock = createTestClock({ start: Date.parse('2026-10-27T07:00:00+01:00') });
  clock.setMode('manual');
  setClock(clock);
  t.after(() => setClock(null));
  return clock;
}

/** A session supervisor on the fake agent (claude dialect, the adapter runs). */
function setup(t, sc, { stateDir: given, tap } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = given ?? path.join(dir, 'state');
  const fakeDir = path.join(dir, 'fake');
  fs.mkdirSync(path.join(stateDir, 'cockpit-agent'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'cockpit'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(fakeDir);
  const useScript = (o) => fs.writeFileSync(path.join(fakeDir, 'script.json'), JSON.stringify(o));
  useScript(sc);
  const messages = [];
  const logs = [];
  const starts = []; // the room clock at each spawn
  const readies = [];
  let wake = () => {};
  const poke = () => wake();
  const clockNow = () => Date.now();
  let now = clockNow;
  const session = createSession({
    stateDir,
    emit: (m) => { messages.push({ ...m, seq: messages.length + 1 }); tap?.(m); poke(); },
    log: (l) => {
      logs.push(l);
      if (l.startsWith('cockpit agent: started pid')) starts.push(now());
      if (l.startsWith('cockpit agent: ready')) readies.push(now());
      poke();
    },
    bridge: {
      agent: {
        kind: 'claude-code', command: [process.execPath, FAKE], cwd: '{stateDir}/cockpit-agent', user: null,
        allowSameUser: true, allowedTools: TOOLS, allowUnrestricted: false, env: ['FAKE_AGENT_DIR'],
      },
      stateDir, mcpToken: 'test-token', env: { ...process.env, FAKE_AGENT_DIR: fakeDir },
    },
  });
  t.after(() => session.close());
  async function until(pred, what, ms = 10_000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; messages:\n${messages.map((m) => JSON.stringify(m)).join('\n')}\nlog:\n${logs.join('\n')}`);
      await new Promise((r) => { wake = r; setTimeout(r, 25); });
    }
  }
  const useClock = (clock) => { now = () => clock.now(); };
  const ofType = (type) => messages.filter((m) => m.type === type);
  return { session, messages, logs, starts, readies, until, stateDir, fakeDir, useScript, useClock, ofType, log: fakeAgentLog(fakeDir) };
}

/** Lets real time pass for the fake while the room clock stands still. */
const realWait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- session.json

test('§11.7: session.json is written whole, 0600, and read back; a bad one is no session', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-file-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(readSessionFile(dir), null, 'none yet');
  const rec = { conversation: 'c-0007', session: SESSION_A, startedAt: '2026-10-27T06:12:00+01:00' };
  writeSessionFile(dir, rec);
  assert.deepEqual(readSessionFile(dir), rec);
  assert.equal(fs.statSync(sessionFilePath(dir)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(sessionFilePath(dir))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(sessionFilePath(dir), 'utf8')), rec, 'the protocol\'s three fields');
  assert.deepEqual(fs.readdirSync(path.dirname(sessionFilePath(dir))), ['session.json'], 'no temporary file left');
  const logs = [];
  for (const bad of ['{"conversation":"c-0007"', '[]', '{"conversation":"x","session":"y","startedAt":"z"}']) {
    fs.writeFileSync(sessionFilePath(dir), bad);
    assert.equal(readSessionFile(dir, (l) => logs.push(l)), null, bad);
  }
  assert.equal(logs.length, 3, 'each bad file is logged');
  assert.equal(nextConversation('c-0007'), 'c-0008');
  assert.equal(nextConversation('c-9999'), 'c-10000');
  assert.equal(nextConversation(null), 'c-0001');
  assert.deepEqual(RESTART_STEPS_S, [0, 2, 4, 8, 16, 30]);
});

test('§11.7: the room starts a new session (c-0001, written at ready), and the next room start resumes it', async (t) => {
  const s = setup(t, fakeScript({ initAfterMs: 300 }, []));
  s.session.start();
  assert.equal(s.session.phase, 'starting');
  assert.equal(readSessionFile(s.stateDir), null, 'not written before ready');
  assert.deepEqual(await s.session.prompt(typed('too early')), { ok: false, code: 'agent-down' }, 'never held (D31)');
  await s.until(() => s.session.phase === 'up', 'ready');
  const file = readSessionFile(s.stateDir);
  assert.equal(file.conversation, 'c-0001');
  assert.equal(file.session, s.log.starts()[0].session);
  assert.equal(s.log.starts()[0].resumed, false);
  assert.ok(s.log.starts()[0].argv.includes('--session-id'));
  assert.deepEqual(s.ofType('conversation.new'), [], 'the first conversation has no divider');
  await s.session.close();

  // A second room on the same state directory.
  const s2 = setup(t, fakeScript({}, []), { stateDir: s.stateDir });
  s2.session.start();
  await s2.until(() => s2.session.phase === 'up', 'ready');
  const st = s2.log.starts()[0];
  assert.deepEqual([st.resumed, st.session], [true, file.session]);
  assert.ok(st.argv.includes('--resume') && !st.argv.includes('--session-id'));
  assert.equal(s2.session.conversation, 'c-0001');
  assert.deepEqual(readSessionFile(s.stateDir), file, 'unchanged by a resume');
  assert.deepEqual(s2.messages, []);
});

// ---------------------------------------------------------------------- stop

test('§13 the stop test: stopping at 0.0 s, forced at 5.0 s, SIGTERM at 8.0 s, then a --resume start (D103)', async (t) => {
  const clock = manualClock(t);
  const s = setup(t, fakeScript({}, [{ match: 'stuck', onInterrupt: 'ignore-sigint', steps: [{ at: 20, text: 'working on it ' }, { at: 600_000, end: 'done' }] }]));
  s.useClock(clock);
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const sessionId = s.session.session;
  const { turnId } = await s.session.prompt(typed('stuck'));
  await s.until(() => s.ofType('text.delta').length > 0, 'the first delta');

  const t0 = clock.now();
  assert.deepEqual(s.session.stop(turnId), { ok: true });
  const stopping = s.messages.at(-1);
  assert.deepEqual([stopping.type, stopping.turnId, stopping.state], ['turn.state', turnId, 'stopping'], 'stopping at 0.0 s');
  await s.until(() => s.log.interrupts().length === 1, 'the interrupt');
  assert.equal(s.log.interrupts()[0].cancelQueued, true, 'cancelQueued: the agent can cancel queued prompts');
  assert.deepEqual(s.session.stop(turnId), { ok: true }, 'a second stop of the same turn changes nothing');

  await clock.advance(STOP_FORCE_MS - 100);
  await realWait(100);
  assert.deepEqual(s.ofType('turn.end'), [], '4.9 s: not yet');
  await clock.advance(100);
  const end = s.ofType('turn.end')[0];
  assert.equal(clock.now() - t0, 5_000);
  assert.deepEqual([end.turnId, end.state, end.forced], [turnId, 'stopped', true], 'forced at 5.0 s');
  await s.until(() => s.log.signals().length === 1, 'the SIGINT');
  assert.equal(s.log.signals()[0].name, 'SIGINT');

  await realWait(150); // the fake ignores the SIGINT and plays on: its text never reaches a screen (D33)
  await clock.advance(STOP_TERM_MS - STOP_FORCE_MS - 100);
  await realWait(100);
  assert.equal(s.log.signals().length, 1, '7.9 s: no SIGTERM yet');
  await clock.advance(100);
  await s.until(() => s.log.signals().length === 2, 'the SIGTERM');
  assert.equal(s.log.signals()[1].name, 'SIGTERM');
  assert.equal(clock.now() - t0, 8_000);
  await s.until(() => s.session.phase === 'up' && s.log.starts().length === 2, 'the resumed session');
  const again = s.log.starts()[1];
  assert.deepEqual([again.resumed, again.session], [true, sessionId], '--resume the same session');
  assert.deepEqual(s.starts.map((x) => x - t0).slice(1), [8_000], 'restarted at the exit, at once');
  assert.deepEqual(s.ofType('status'), [], 'no status line: the owner asked for the stop');
  assert.equal(s.ofType('turn.end').length, 1, 'one turn.end; nothing after it');
  assert.deepEqual(s.messages.slice(s.messages.indexOf(end) + 1), [], 'nothing of the stopped turn after its end');
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
});

test('§11.6: a stop the agent honours ends stopped, not forced; its queued prompt is cancelled; no signal', async (t) => {
  const clock = manualClock(t);
  const s = setup(t, fakeScript({}, [
    { match: 'long', onInterrupt: { endAfterMs: 200 }, queued: 'after-turn', steps: [{ at: 20, text: 'one ' }, { at: 600_000, end: 'done' }] },
    { match: 'later', steps: [{ at: 20, text: 'never' }, { at: 40, end: 'done' }] }]));
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const { turnId } = await s.session.prompt(typed('long'));
  await s.until(() => s.ofType('text.delta').length > 0, 'the first delta');
  assert.equal((await s.session.prompt(typed('later', 'p-0000000b'))).delivery, 'queued');
  s.session.stop(turnId);
  await s.until(() => s.ofType('turn.end').length === 1, 'the turn end');
  const end = s.ofType('turn.end')[0];
  assert.deepEqual([end.state, end.forced], ['stopped', false]);
  const cancelled = s.ofType('prompt.taken');
  assert.deepEqual(cancelled.map((m) => [m.clientId, m.state, m.why]), [['p-0000000b', 'cancelled', 'stopped']]);
  assert.equal(s.log.interrupts()[0].cancelled.length, 1);
  await clock.advance(STOP_KILL_MS_PLUS);
  await realWait(200);
  assert.deepEqual(s.log.signals(), [], 'no SIGINT, no SIGTERM');
  assert.equal(s.log.starts().length, 1, 'no restart');
  assert.equal(s.ofType('turn.end').length, 1);
  assert.equal(s.log.prompts().length, 2, 'the cancelled prompt is not sent again');
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
});
const STOP_KILL_MS_PLUS = 12_000;

test('§11.6: a SIGINT that ends the turn: forced at 5.0 s, its result comes, no SIGTERM at 8.0 s', async (t) => {
  const clock = manualClock(t);
  const s = setup(t, fakeScript({}, [{ match: 'deaf', onInterrupt: 'ignore', steps: [{ at: 20, text: 'busy ' }, { at: 600_000, end: 'done' }] }]));
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const { turnId } = await s.session.prompt(typed('deaf'));
  await s.until(() => s.ofType('text.delta').length > 0, 'the first delta');
  s.session.stop(turnId);
  await clock.advance(STOP_FORCE_MS);
  assert.equal(s.ofType('turn.end')[0].forced, true);
  await s.until(() => s.log.turnEnds().some((e) => e.end === 'stopped'), 'the fake\'s result after the SIGINT');
  await realWait(100);
  await clock.advance(STOP_KILL_MS_PLUS - STOP_FORCE_MS);
  await realWait(200);
  assert.deepEqual(s.log.signals().map((x) => x.name), ['SIGINT']);
  assert.equal(s.log.starts().length, 1, 'the same child goes on');
  assert.equal(s.session.phase, 'up');
  assert.equal(s.ofType('turn.end').length, 1, 'the late result is logged, never shown');
  assert.ok(s.logs.some((l) => l.includes('turn.end outside a turn, dropped')));
});

test('§3.3: stop of an ended turn is not-now; of a turn that never was, unknown-id', async (t) => {
  const s = setup(t, fakeScript({}, [{ match: 'quick', steps: [{ at: 20, text: 'done.' }, { at: 40, end: 'done' }] }]));
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const { turnId } = await s.session.prompt(typed('quick'));
  await s.until(() => s.ofType('turn.end').length === 1, 'the turn end');
  assert.deepEqual(s.session.stop(turnId), { ok: false, code: 'not-now' });
  assert.deepEqual(s.session.stop('t-0099'), { ok: false, code: 'unknown-id' });
  assert.deepEqual(s.session.stop('nope'), { ok: false, code: 'unknown-id' });
});

// ------------------------------------------------------------------- restart

test('§13 the restart test: E2, restarts after 0, 2, 4 s, agent-down, then conversation.new forced (D104, D289)', async (t) => {
  const clock = manualClock(t);
  const s = setup(t, fakeScript({}, [{ match: 'crash', steps: [{ at: 20, text: 'half ' }, { at: 400, exit: 3 }] }]));
  s.useClock(clock);
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const first = s.session.session;
  const { turnId } = await s.session.prompt(typed('crash'));
  await s.until(() => s.log.prompts().length === 1, 'the prompt read');
  // From now on the next two starts fail before ready (the fake counts its starts).
  s.useScript(fakeScript({ startFailures: 3, startStderr: 'claude: cannot reach the session store' }, []));
  const tCrash = clock.now();
  await s.until(() => s.ofType('turn.end').length === 1, 'E2');
  const e2 = s.ofType('turn.end')[0];
  assert.deepEqual([e2.turnId, e2.state, e2.code], [turnId, 'error', 'agent-exited']);
  await s.until(() => s.log.starts().length === 2 && s.session.phase === 'down', 'the first restart failed');
  assert.deepEqual(s.ofType('status'), [], 'one failed start: no status line yet');

  await clock.advance(1_999);
  await realWait(100);
  assert.equal(s.log.starts().length, 2, '1.999 s: not yet');
  await clock.advance(1);
  await s.until(() => s.log.starts().length === 3 && s.session.phase === 'down', 'the second restart failed');
  const down = s.ofType('status');
  assert.equal(down.length, 1, 'agent-down from the second failed start on');
  assert.deepEqual([down[0].status.code, down[0].status.detail, down[0].status.blocksSend],
    ['agent-down', 'claude: cannot reach the session store', true]);
  assert.equal(Date.parse(down[0].status.since), tCrash);
  assert.deepEqual(await s.session.prompt(typed('hello?', 'p-0000000c')), { ok: false, code: 'agent-down' });

  await clock.advance(3_999);
  await realWait(100);
  assert.equal(s.log.starts().length, 3, '3.999 s after: not yet');
  await clock.advance(1);
  await s.until(() => s.session.phase === 'up', 'the fresh session');
  assert.deepEqual(s.starts.slice(1).map((x, i, a) => x - (i ? a[i - 1] : tCrash)), [0, 2_000, 4_000], 'waits 0, 2, 4 s');
  const st = s.log.starts();
  assert.deepEqual(st.slice(1, 3).map((x) => [x.resumed, x.session]), [[true, first], [true, first]], 'two --resume starts');
  assert.equal(st[3].resumed, false);
  assert.notEqual(st[3].session, first, 'then --session-id with a new UUID');

  const cn = s.ofType('conversation.new');
  assert.deepEqual(cn.map((m) => [m.conversation, m.reason]), [['c-0002', 'forced']]);
  assert.deepEqual(readSessionFile(s.stateDir).session, st[3].session);
  assert.equal(readSessionFile(s.stateDir).conversation, 'c-0002');
  const statuses = s.ofType('status').map((m) => m.status?.code ?? null);
  assert.deepEqual(statuses, ['agent-down', null, 'agent-back'], 'agent-down cleared, then agent-back (E2)');
  await clock.advance(5_000);
  assert.equal(s.ofType('status').at(-1).status, null, 'agent-back is news: gone after 5 s');
  for (const m of s.messages) assert.deepEqual(checkMessage(m, 'out'), { ok: true }, JSON.stringify(m));
});

test('T53 (D127, D211): a token on the agent\'s stderr is redacted at the source: agent-down detail, log, welcome.status', async (t) => {
  const clock = manualClock(t);
  const TOKEN = 'sk-ant-api03-Qx7vR2mK9pL4sT8wZ1nB6cD3fG5hJ0yE';
  const LINE = `claude: request failed, header Authorization: Bearer ${TOKEN}`;
  // The link the room runs (boot/cockpit.mjs: the session's emit is the link's), so a screen
  // that comes while the agent is down gets the held status in its welcome.
  let link = null;
  const s = setup(t, fakeScript({ startFailures: 99, startStderr: LINE }, []), { tap: (m) => link?.emit(m) });
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const config = { port, cockpit: { stt: { url: 'none', language: ['en'] } } };
  const store = { apply: () => {}, turns: () => [], conversation: null, startedAt: null };
  const audit = { append: (e) => e };
  link = createLink({ session: s.session, store, audit, config, log: (l) => s.logs.push(l) });
  server.on('upgrade', (r, socket, head) => {
    r.auth = classify(r, config, {});
    if (!link.handleUpgrade(r, socket, head, new URL(r.url, 'http://x'))) socket.destroy();
  });
  t.after(() => { link.close(); server.close(); });

  s.useClock(clock);
  s.session.start();
  await s.until(() => s.ofType('status').length === 1, 'agent-down at the second failed start');
  const down = s.ofType('status')[0].status;
  assert.equal(down.code, 'agent-down');
  assert.equal(down.detail, 'claude: request failed, header Authorization: Bearer [redacted]');
  assert.ok(s.logs.some((l) => l === `cockpit agent stderr: ${down.detail}`), 'the room log has the redacted line');

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cockpit/ws`, { origin: `http://127.0.0.1:${port}` });
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  t.after(() => ws.terminate());
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'hello', seq: 1, page: 'app', protocol: 1 }));
  await s.until(() => frames.some((f) => f.type === 'welcome'), 'welcome');
  const welcome = frames.find((f) => f.type === 'welcome');
  assert.equal(welcome.status?.detail, down.detail, 'welcome.status while the agent is down');

  const everything = JSON.stringify([...s.messages, ...frames, ...s.logs]);
  assert.ok(!everything.includes(TOKEN), 'the raw token in no message, frame or log line');
  assert.ok(!everything.includes('sk-ant-'), 'not even its prefix');
});

test('§11.7: no ready 30 s after the spawn is a failed start; the child is killed and the start tried again', async (t) => {
  const clock = manualClock(t);
  const s = setup(t, fakeScript({ initAfterMs: 3_600_000 }, []));
  s.session.start();
  await s.until(() => s.log.starts().length === 1, 'the spawn');
  await clock.advance(READY_WAIT_MS - 1);
  assert.equal(s.session.phase, 'starting');
  await clock.advance(1);
  assert.ok(s.logs.some((l) => l.includes('no ready 30 s after the start')));
  await s.until(() => s.log.starts().length === 2, 'the next start, at once (the first wait is 0 s)');
  assert.equal(s.log.starts()[1].resumed, false, 'a session that never started is never resumed');
  assert.notEqual(s.log.starts()[1].session, s.log.starts()[0].session);
  await clock.advance(READY_WAIT_MS);
  await s.until(() => s.ofType('status').length === 1, 'agent-down at the second failed start');
  assert.equal(s.ofType('status')[0].status.code, 'agent-down');
});

// ----------------------------------------------------------------------- new

test('§11.7 new while idle: stdin closed, a new session, conversation.new owner at its ready', async (t) => {
  const s = setup(t, fakeScript({ initAfterMs: 200 }, []));
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const old = readSessionFile(s.stateDir);
  assert.deepEqual(s.session.newConversation(), { ok: true });
  assert.deepEqual(s.session.newConversation(), { ok: false, code: 'not-now' }, 'a second tap within the start');
  assert.deepEqual(await s.session.prompt(typed('now?')), { ok: false, code: 'agent-down' });
  await s.until(() => s.ofType('conversation.new').length === 1, 'the divider');
  assert.deepEqual(s.log.order('start', 'stdin-end'), ['start', 'stdin-end', 'start']);
  const st = s.log.starts()[1];
  assert.equal(st.resumed, false);
  assert.notEqual(st.session, old.session);
  const cn = s.ofType('conversation.new')[0];
  assert.deepEqual([cn.conversation, cn.reason], ['c-0002', 'owner']);
  assert.deepEqual(checkMessage(cn, 'out'), { ok: true });
  assert.deepEqual(readSessionFile(s.stateDir), { conversation: 'c-0002', session: st.session, startedAt: cn.at });
  assert.deepEqual(s.log.signals(), [], 'the fake exits on its closed stdin');
  assert.equal(s.session.phase, 'up');
});

test('§11.7 new during a turn: the turn is stopped first, then the new session', async (t) => {
  const s = setup(t, fakeScript({}, [{ match: 'long', steps: [{ at: 20, text: 'one ' }, { at: 600_000, end: 'done' }] }]));
  s.session.start();
  await s.until(() => s.session.phase === 'up', 'ready');
  const { turnId } = await s.session.prompt(typed('long'));
  await s.until(() => s.ofType('text.delta').length > 0, 'the first delta');
  assert.deepEqual(s.session.newConversation(), { ok: true });
  await s.until(() => s.ofType('conversation.new').length === 1, 'the divider');
  const kinds = s.messages.map((m) => (m.type === 'turn.state' ? `turn.state ${m.state}` : m.type));
  assert.deepEqual(kinds.slice(kinds.indexOf('turn.state stopping')), ['turn.state stopping', 'turn.end', 'conversation.new']);
  const end = s.ofType('turn.end')[0];
  assert.deepEqual([end.turnId, end.state, end.forced], [turnId, 'stopped', false]);
  assert.deepEqual(s.log.order('interrupt', 'stdin-end', 'start'), ['start', 'interrupt', 'stdin-end', 'start']);
  assert.equal(s.ofType('conversation.new')[0].reason, 'owner');
});
