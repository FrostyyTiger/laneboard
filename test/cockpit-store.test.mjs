// The conversation on disk (spec protocols.md §11.7.1, D154, D155, pending
// Q-O24; security.md §6): what is written when, the reload at room start with
// its steps 1-6, a write torn by a crash, retention, and a room booted on
// seeded state files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createStore, readConversationFile, conversationFilePath, oldDirPath, KEEP_MS, RETAIN_EVERY_MS, ONCE_MS,
} from '../server/cockpit/store.mjs';
import { checkTurn } from '../server/cockpit/protocol.mjs';
import { isoAt } from '../server/cockpit/iso.mjs';
import { setClock, createTestClock } from '../server/cockpit/clock.mjs';
import { boot } from './helpers/boot.mjs';

const T0 = Date.parse('2026-10-27T07:00:00+01:00');
const DAY = 24 * 3600 * 1000;
const SESSION = { conversation: 'c-0007', session: '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91', startedAt: '2026-10-27T06:12:00.000+01:00' };
const AGENT = { command: ['node', 'test/cockpit/stand-ins/fake-agent.mjs'], allowSameUser: true, loginCheck: null };

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const logs = [];
  const store = createStore({ stateDir, log: (l) => logs.push(l) });
  const file = conversationFilePath(stateDir);
  const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, stateDir, store, logs, file, lines };
}

const prompt = (turnId, clientId, at, extra = {}) => ({
  type: 'turn.prompt', turnId, clientId, screen: 'desk', text: `prompt of ${turnId}`, source: 'typed',
  lang: null, about: null, at: isoAt(at), receivedAt: at, delivery: 'new', ...extra,
});

/** A whole turn as the file holds it, `at` and its end `endAt` (ms). */
function doneTurn(turnId, at, endAt = at + 5000, extra = {}) {
  return {
    turnId, clientId: `p-${turnId.slice(2).padStart(8, '0')}`, source: 'typed', lang: null, about: null,
    prompt: `prompt of ${turnId}`, at: isoAt(at), state: 'done',
    items: [{ kind: 'text', blockIndex: 0, text: `reply of ${turnId}` }],
    end: { state: 'done', at: isoAt(endAt) }, ...extra,
  };
}

const jsonl = (objs) => objs.map((o) => `${typeof o === 'string' ? o : JSON.stringify(o)}\n`).join('');
const convLine = (c = SESSION) => ({ kind: 'conversation', conversation: c.conversation, startedAt: c.startedAt, reason: 'owner' });

function seed(stateDir, text) {
  fs.mkdirSync(path.join(stateDir, 'cockpit'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(conversationFilePath(stateDir), text, { mode: 0o600 });
}

const mode = (p) => fs.statSync(p).mode & 0o777;

test('a turn is written at its prompt, each tool.end, text.block, prompt.taken and turn.end; never per delta (§11.7.1)', (t) => {
  const { store, lines, file, stateDir } = setup(t);
  store.begin({ conversation: 'c-0001', startedAt: isoAt(T0), reason: 'first' });
  assert.deepEqual(lines(), [{ kind: 'conversation', conversation: 'c-0001', startedAt: isoAt(T0), reason: 'first' }]);
  const count = () => lines().length;
  const steps = [
    [prompt('t-0001', 'p-0000000a', T0), 2],
    [{ type: 'turn.state', turnId: 't-0001', state: 'working' }, 2],
    [{ type: 'tool.start', turnId: 't-0001', blockIndex: 0, toolUseId: 'tu-01', tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, startedAt: isoAt(T0 + 1000) }, 2],
    [{ type: 'tool.end', turnId: 't-0001', toolUseId: 'tu-01', endedAt: isoAt(T0 + 1500), isError: false, denied: false }, 3],
    [{ type: 'turn.state', turnId: 't-0001', state: 'answering' }, 3],
    [{ type: 'text.delta', turnId: 't-0001', blockIndex: 1, text: '■ One run ', sentAt: T0 + 2000 }, 3],
    [{ type: 'text.delta', turnId: 't-0001', blockIndex: 1, text: 'is stuck.', sentAt: T0 + 2100 }, 3],
    [prompt('t-0001', 'p-0000000b', T0 + 2200, { delivery: 'queued' }), 4],
    [{ type: 'text.block', turnId: 't-0001', blockIndex: 1, text: '■ One run is stuck.' }, 5],
    [{ type: 'prompt.taken', turnId: 't-0001', clientId: 'p-0000000b', state: 'taken', atBlock: 2 }, 6],
    [{ type: 'text.delta', turnId: 't-0001', blockIndex: 2, text: 'Only builder-a.', sentAt: T0 + 3000 }, 6],
    [{ type: 'text.block', turnId: 't-0001', blockIndex: 2, text: 'Only builder-a.' }, 7],
    [{ type: 'turn.end', seq: 9, turnId: 't-0001', state: 'done', at: isoAt(T0 + 4000) }, 8],
  ];
  for (const [msg, n] of steps) {
    store.apply(msg);
    assert.equal(count(), n, `after ${msg.type}`);
  }
  const last = lines().at(-1);
  assert.equal(last.kind, 'turn');
  assert.deepEqual(checkTurn(last.turn), { ok: true });
  assert.deepEqual(last.turn, {
    turnId: 't-0001', clientId: 'p-0000000a', source: 'typed', lang: null, about: null, prompt: 'prompt of t-0001',
    at: isoAt(T0), state: 'done',
    items: [
      { kind: 'tool', blockIndex: 0, toolUseId: 'tu-01', tool: 'mcp__laneboard__morning', input: { window: 'tonight' }, startedAt: isoAt(T0 + 1000), endedAt: isoAt(T0 + 1500), isError: false },
      { kind: 'text', blockIndex: 1, text: '■ One run is stuck.' },
      { kind: 'prompt', clientId: 'p-0000000b', text: 'prompt of t-0001', source: 'typed', lang: null, about: null, at: isoAt(T0 + 2200), state: 'taken', atBlock: 2 },
      { kind: 'text', blockIndex: 2, text: 'Only builder-a.' },
    ],
    end: { state: 'done', at: isoAt(T0 + 4000) },
  });
  assert.deepEqual(store.turns(), [last.turn]);
  // security.md §6: the room's user only.
  assert.equal(mode(file), 0o600);
  assert.equal(mode(path.join(stateDir, 'cockpit')), 0o700);
});

test('a running turn holds its deltas in memory for snapshots; queued and cancelled prompts sit after every other item (§2.2)', (t) => {
  const { store, lines } = setup(t);
  store.begin({ conversation: 'c-0001', startedAt: isoAt(T0), reason: 'first' });
  store.apply(prompt('t-0001', 'p-0000000a', T0));
  store.apply(prompt('t-0001', 'p-0000000b', T0 + 100, { delivery: 'queued' }));
  store.apply(prompt('t-0001', 'p-0000000c', T0 + 200, { delivery: 'queued' }));
  store.apply({ type: 'text.delta', turnId: 't-0001', blockIndex: 0, text: 'Half a ', sentAt: T0 + 300 });
  store.apply({ type: 'turn.state', turnId: 't-0001', state: 'answering' });
  store.apply({ type: 'prompt.taken', turnId: 't-0001', clientId: 'p-0000000b', state: 'cancelled', why: 'stopped' });
  const [turn] = store.turns();
  assert.equal(turn.state, 'answering');
  assert.deepEqual(turn.items.map((i) => [i.kind, i.clientId ?? i.text, i.state ?? null]), [
    ['text', 'Half a ', null], ['prompt', 'p-0000000b', 'cancelled'], ['prompt', 'p-0000000c', 'queued'],
  ]);
  assert.deepEqual(checkTurn(turn), { ok: true });
  // On disk: written at the prompt.taken (not at the delta), the turn as a snapshot carries it then (B90).
  assert.deepEqual(lines().map((l) => l.turn?.items.length ?? null), [null, 0, 1, 2, 3]);
  assert.deepEqual(lines().at(-1).turn, turn);
});

test('a queued prompt taken as the next turn leaves the old turn (§3.4, D258)', (t) => {
  const { store, stateDir, logs } = setup(t);
  store.begin({ conversation: 'c-0001', startedAt: isoAt(T0), reason: 'first' });
  store.apply(prompt('t-0001', 'p-0000000a', T0));
  store.apply(prompt('t-0001', 'p-0000000b', T0 + 100, { delivery: 'queued' }));
  store.apply({ type: 'turn.end', turnId: 't-0001', state: 'done', at: isoAt(T0 + 1000) });
  store.apply(prompt('t-0002', 'p-0000000b', T0 + 100, { from: 'queued' }));
  store.apply({ type: 'prompt.taken', turnId: 't-0002', clientId: 'p-0000000b', state: 'taken', atBlock: 0 });
  const [one, two] = store.turns();
  assert.deepEqual(one.items, []);
  assert.equal(two.clientId, 'p-0000000b');
  assert.equal(two.at, isoAt(T0 + 100));
  assert.deepEqual(two.items, []);
  // Read back, the last line of each turn holds the same.
  const again = createStore({ stateDir, log: (l) => logs.push(l) }).load({ now: T0 + 2000, session: { ...SESSION, conversation: 'c-0001' } });
  assert.deepEqual(again.turns.map((x) => [x.turnId, x.items.length]), [['t-0001', 0], ['t-0002', 0]]);
});

test('reload: the last line of each turnId wins, the file is rewritten one line per turn (steps 1, 5, 6)', (t) => {
  const { store, stateDir, file, lines } = setup(t);
  store.begin({ conversation: 'c-0007', startedAt: SESSION.startedAt, reason: 'owner' });
  for (let n = 1; n <= 3; n += 1) {
    const at = T0 + n * 60_000;
    store.apply(prompt(`t-000${n}`, `p-0000000${n}`, at));
    store.apply({ type: 'text.block', turnId: `t-000${n}`, blockIndex: 0, text: `reply ${n}` });
    store.apply({ type: 'turn.end', turnId: `t-000${n}`, state: 'done', at: isoAt(at + 1000) });
  }
  assert.equal(lines().length, 1 + 3 * 3);
  const before = store.turns();
  const logs = [];
  const now = T0 + 690_000; // t-0001 is 10.5 min old, t-0002 9.5, t-0003 8.5
  const loaded = createStore({ stateDir, log: (l) => logs.push(l) }).load({ now, session: SESSION });
  assert.deepEqual(loaded.turns, before);
  assert.equal(loaded.conversation, 'c-0007');
  assert.equal(loaded.startedAt, SESSION.startedAt);
  assert.equal(loaded.cutTurn, false);
  assert.equal(loaded.lastTurn, 3);
  // Step 6: clientIds of the last 10 min only.
  assert.equal(ONCE_MS, 600_000);
  assert.deepEqual(loaded.clientIds, ['p-00000002', 'p-00000003']);
  assert.deepEqual(lines().map((l) => l.kind), ['conversation', 'turn', 'turn', 'turn']);
  assert.equal(mode(file), 0o600);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.deepEqual(logs, []);
});

test('a write torn by a crash: the line is skipped with one log line, the rest kept (step 1)', (t) => {
  const { stateDir, file, lines } = setup(t);
  seed(stateDir, jsonl([
    convLine(),
    { kind: 'turn', turn: doneTurn('t-0001', T0) },
    'not json at all',
    { kind: 'turn', turn: doneTurn('t-0002', T0 + 60_000) },
  ]) + '{"kind":"turn","turn":{"turnId":"t-0003","clientId":"p-0');
  const logs = [];
  const loaded = createStore({ stateDir, log: (l) => logs.push(l) }).load({ now: T0 + 120_000, session: SESSION });
  assert.deepEqual(loaded.turns.map((x) => x.turnId), ['t-0001', 't-0002']);
  assert.deepEqual(logs, ['cockpit: conversation.jsonl line 3 unreadable', 'cockpit: conversation.jsonl line 5 unreadable']);
  assert.deepEqual(lines().map((l) => l.turn?.turnId ?? l.kind), ['conversation', 't-0001', 't-0002']);
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
});

test('a turn running when the room went ends agent-exited at the start time; its queued prompts not-taken (step 3, D155)', (t) => {
  const { stateDir, lines } = setup(t);
  const running = {
    turnId: 't-0002', clientId: 'p-00000002', source: 'typed', lang: null, about: null, prompt: 'what is stuck', at: isoAt(T0),
    state: 'answering',
    items: [
      { kind: 'text', blockIndex: 0, text: '■ One run' },
      { kind: 'prompt', clientId: 'p-00000003', text: 'and builder-b?', source: 'typed', lang: null, about: null, at: isoAt(T0 + 500), state: 'queued' },
    ],
  };
  seed(stateDir, jsonl([convLine(), { kind: 'turn', turn: doneTurn('t-0001', T0 - 60_000) }, { kind: 'turn', turn: running }]));
  const now = T0 + 30_000;
  const loaded = createStore({ stateDir }).load({ now, session: SESSION });
  assert.equal(loaded.cutTurn, true);
  const t2 = loaded.turns[1];
  assert.equal(t2.state, 'error');
  assert.deepEqual(t2.end, { state: 'error', code: 'agent-exited', at: isoAt(now) });
  assert.deepEqual(t2.items[1], { kind: 'prompt', clientId: 'p-00000003', text: 'and builder-b?', source: 'typed', lang: null, about: null, at: isoAt(T0 + 500), state: 'cancelled', why: 'not-taken' });
  assert.deepEqual(checkTurn(t2), { ok: true });
  assert.deepEqual(lines()[2].turn, t2);
  assert.deepEqual(loaded.clientIds, ['p-00000001', 'p-00000002', 'p-00000003']);
});

test('no session.json: the file moves to old/ and the conversation starts empty; another conversation\'s file too (step 2)', (t) => {
  const { stateDir, file } = setup(t);
  const old = oldDirPath(stateDir);
  seed(stateDir, jsonl([convLine(), { kind: 'turn', turn: doneTurn('t-0001', T0) }]));
  const logs = [];
  const loaded = createStore({ stateDir, log: (l) => logs.push(l) }).load({ now: T0 + 1000, session: null });
  assert.deepEqual(loaded.turns, []);
  assert.equal(loaded.conversation, null);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(old), ['c-0007.jsonl']);
  assert.equal(mode(old), 0o700);
  assert.equal(mode(path.join(old, 'c-0007.jsonl')), 0o600);

  // A file of c-0007 again (c-0001 … comes back after a lost session.json): a free name, nothing overwritten.
  seed(stateDir, jsonl([convLine(), { kind: 'turn', turn: doneTurn('t-0001', T0) }]));
  const other = { ...SESSION, conversation: 'c-0008' };
  const second = createStore({ stateDir, log: (l) => logs.push(l) }).load({ now: T0 + 2000, session: other });
  assert.deepEqual(second.turns, []);
  assert.equal(second.conversation, 'c-0008');
  assert.deepEqual(fs.readdirSync(old).sort(), ['c-0007.2.jsonl', 'c-0007.jsonl']);
  assert.deepEqual(readConversationFile(file).conversation, { conversation: 'c-0008', startedAt: SESSION.startedAt, reason: 'first' });
  assert.ok(logs.some((l) => /holds c-0007, not c-0008; the conversation starts empty/.test(l)));

  // session.json but no file at all: empty under session.json's id.
  fs.unlinkSync(file);
  const third = createStore({ stateDir }).load({ now: T0 + 3000, session: SESSION });
  assert.equal(third.conversation, 'c-0007');
  assert.deepEqual(third.turns, []);
});

test('begin: a new conversation moves the current file to old/ and starts with its conversation line (§3.6)', (t) => {
  const { store, stateDir, lines } = setup(t);
  store.begin({ conversation: 'c-0001', startedAt: isoAt(T0), reason: 'first' });
  store.apply(prompt('t-0001', 'p-0000000a', T0));
  store.apply({ type: 'conversation.new', seq: 4, conversation: 'c-0002', reason: 'owner', at: isoAt(T0 + 9000) });
  assert.deepEqual(lines(), [{ kind: 'conversation', conversation: 'c-0002', startedAt: isoAt(T0 + 9000), reason: 'owner' }]);
  assert.deepEqual(store.turns(), []);
  assert.equal(store.conversation, 'c-0002');
  const moved = readConversationFile(path.join(oldDirPath(stateDir), 'c-0001.jsonl'));
  assert.deepEqual([...moved.turns.keys()], ['t-0001']);
});

test('retention: turns and old/ files older than 30 days go, at start and every 3 600 s on the room clock (steps 4-5, Q-O24 a)', (t) => {
  const clock = createTestClock({ start: T0 });
  clock.setMode('manual');
  setClock(clock);
  t.after(() => setClock(null));
  const { stateDir, lines } = setup(t);
  assert.equal(KEEP_MS, 30 * DAY);
  assert.equal(RETAIN_EVERY_MS, 3_600_000);
  seed(stateDir, jsonl([
    convLine(),
    { kind: 'turn', turn: doneTurn('t-0001', T0 - 31 * DAY) },
    // Its end is 30 days less 30 min back although it started 31 days back: kept by its end.at.
    { kind: 'turn', turn: doneTurn('t-0002', T0 - 31 * DAY, T0 - 30 * DAY + 1800_000) },
    { kind: 'turn', turn: doneTurn('t-0003', T0 - DAY) },
  ]));
  const old = oldDirPath(stateDir);
  fs.mkdirSync(old, { mode: 0o700 });
  fs.writeFileSync(path.join(old, 'c-0005.jsonl'), jsonl([convLine({ ...SESSION, conversation: 'c-0005', startedAt: isoAt(T0 - 40 * DAY) }), { kind: 'turn', turn: doneTurn('t-0001', T0 - 35 * DAY) }]), { mode: 0o600 });
  fs.writeFileSync(path.join(old, 'c-0006.jsonl'), jsonl([convLine({ ...SESSION, conversation: 'c-0006', startedAt: isoAt(T0 - 40 * DAY) }), { kind: 'turn', turn: doneTurn('t-0001', T0 - 30 * DAY + 1800_000) }]), { mode: 0o600 });

  const logs = [];
  const store = createStore({ stateDir, log: (l) => logs.push(l) });
  const loaded = store.load({ now: clock.now(), session: SESSION });
  store.retain(clock.now());
  assert.deepEqual(loaded.turns.map((x) => x.turnId), ['t-0002', 't-0003']);
  assert.equal(loaded.lastTurn, 3);
  assert.deepEqual(fs.readdirSync(old), ['c-0006.jsonl']);
  assert.ok(logs.includes('cockpit: old/c-0005.jsonl is older than 30 days, deleted'));

  store.every();
  t.after(() => store.close());
  // One hour on: t-0002 and c-0006 are past 30 days now.
  clock.advance(RETAIN_EVERY_MS - 1);
  assert.deepEqual(store.turns().map((x) => x.turnId), ['t-0002', 't-0003']);
  clock.advance(1);
  assert.deepEqual(store.turns().map((x) => x.turnId), ['t-0003']);
  assert.deepEqual(lines().map((l) => l.turn?.turnId ?? l.kind), ['conversation', 't-0003']);
  assert.deepEqual(fs.readdirSync(old), []);
});

test('seeded stateFiles: a room start reads, repairs and trims conversation.jsonl before it listens (§11.7.1)', { timeout: 30_000 }, async () => {
  const now = Date.now();
  const running = {
    turnId: 't-0012', clientId: 'p-00000012', source: 'typed', lang: null, about: null, prompt: 'what is stuck',
    at: isoAt(now - 60_000), state: 'working', items: [],
  };
  const room = await boot({
    mode: 'cockpit',
    config: { cockpit: { agent: AGENT } },
    stateFiles: {
      'cockpit/session.json': SESSION,
      'cockpit/conversation.jsonl': jsonl([
        convLine(),
        { kind: 'turn', turn: doneTurn('t-0010', now - 40 * DAY) },
        { kind: 'turn', turn: doneTurn('t-0011', now - 3600_000) },
        { kind: 'turn', turn: running },
      ]) + '{"kind":"turn","tu',
    },
  });
  try {
    const file = conversationFilePath(room.stateDir);
    const read = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(read.map((l) => l.turn?.turnId ?? l.kind), ['conversation', 't-0011', 't-0012']);
    assert.equal(read[2].turn.state, 'error');
    assert.equal(read[2].turn.end.code, 'agent-exited');
    assert.ok(Date.parse(read[2].turn.end.at) >= now);
    assert.equal(mode(file), 0o600);
    assert.match(room.logs(), /cockpit: conversation\.jsonl line 5 unreadable/);
    assert.match(room.logs(), /cockpit: conversation c-0007 with 2 turns/);
  } finally {
    await room.stop();
  }
});
