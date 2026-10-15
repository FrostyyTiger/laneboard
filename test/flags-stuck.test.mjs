import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep a targeted run off the real database and config, as `npm test` does.
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const stateMod = await import('../server/state.mjs');
const signals = await import('../server/collector/signals.mjs');
const pause = await import('../server/control/pause.mjs');
const { createContext } = await import('../server/modules.mjs');
const stuckFlag = await import('../server/flags/stuck.mjs');

const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;
const SID_A = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID_B = '7f00aa11-2222-4333-8444-555566667777';

function body(sid, ev, over = {}) {
  return { session_id: sid, hook_event_name: ev, ...over };
}

/** Five identical Bash calls: the tool-loop rule fires. */
function loop(sid, t0) {
  for (let i = 0; i < 5; i++) signals.note(body(sid, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'make test' } }), t0 + i * 1000);
}

function sessions() {
  return [
    { name: 'builder-a-x1', state: 'working', stateSince: T0, claude: { sessionId: SID_A }, activity: {}, attentionScore: 0 },
    {
      name: 'builder-a-f3', state: 'done', stateSince: T0, claude: { sessionId: SID_B },
      activity: { lastAssistant: 'all done' }, attentionScore: 0,
    },
  ];
}

test('synthetic tick: session.stuck set and cleared, stuck messages carry evidence', async () => {
  signals._reset();
  const sent = [];
  try {
    const flag = stuckFlag.createStuckFlag({ send: (m) => sent.push(m), keyFor: (n) => `b1/${n}` });
    const list = sessions();
    loop(SID_A, T0);
    flag.tick({ sessions: list }, T0 + 10_000);
    const a = flag.decorate(list[0]);
    assert.equal(a.stuck.rule, 'tool-loop');
    assert.match(a.stuck.reason, /Bash ×5 same input/);
    assert.equal(a.stuck.since, T0 + 10_000);
    assert.deepEqual(Object.keys(a.stuck).sort(), ['reason', 'rule', 'since'], 'evidence stays off the session');
    assert.deepEqual(flag.decorate(list[1]), { stuck: null });

    assert.equal(sent.length, 1);
    const msg = sent[0];
    assert.equal(msg.type, 'stuck');
    assert.equal(msg.name, 'builder-a-x1');
    assert.equal(msg.key, 'b1/builder-a-x1');
    assert.equal(msg.stuck.rule, 'tool-loop');
    assert.deepEqual(msg.stuck.rules, ['tool-loop']);
    assert.ok(Array.isArray(msg.stuck.evidence) && msg.stuck.evidence[0].rule === 'tool-loop');
    assert.ok(msg.stuck.evidence[0].detail.length > 0);

    // A second tick with nothing new: no message, since stays put.
    flag.tick({ sessions: list }, T0 + 12_000);
    assert.equal(sent.length, 1);
    assert.equal(flag.decorate(list[0]).stuck.since, T0 + 10_000);

    // A new turn ends the loop: cleared, and the clear is streamed.
    signals.note(body(SID_A, 'UserPromptSubmit'), T0 + 13_000);
    flag.tick({ sessions: list }, T0 + 14_000);
    assert.deepEqual(flag.decorate(list[0]), { stuck: null });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], { type: 'stuck', name: 'builder-a-x1', key: 'b1/builder-a-x1', stuck: null });
  } finally {
    signals._reset();
  }
});

test('registered module, attention order: a stuck session ranks above a done one, below a waiting one', () => {
  stateMod._resetHooks();
  signals._reset();
  const sent = [];
  let hook = null;
  const fakeState = {
    addDecorator: (name, d) => stateMod.addDecorator(name, d),
    onTick: (fn) => { hook = fn; },
    keyFor: (n) => `b1/${n}`,
  };
  const ctx = createContext({ mode: 'builder', state: fakeState, ws: { send: (m) => sent.push(m) }, config: {} });
  stuckFlag.default.register(ctx);
  try {
    const now = T0 + 10_000;
    const list = [
      ...sessions(),
      { name: 'builder-a-p2', state: 'waiting_permission', stateSince: T0, claude: null, activity: {}, attentionScore: 0 },
    ];
    // The working session is stuck on a tool loop; f3 is just done.
    loop(SID_A, T0);
    hook({ sessions: list, get: () => null }, now);
    stateMod.decorateSessions(list, now);
    const score = Object.fromEntries(list.map((s) => [s.name, s.attentionScore]));
    assert.ok(list[0].stuck, 'stuck decorated');
    assert.equal(score['builder-a-x1'], stateMod.STUCK_BONUS);
    // A stuck done session would be 50 + 40; here: stuck working (40) vs plain done.
    assert.ok(score['builder-a-p2'] > score['builder-a-x1']);
    assert.equal(sent[0].key, 'b1/builder-a-x1');

    // Make the done session stuck too (idle-in-working via a lane): it outranks the plain done.
    const later = T0 + 30 * MIN;
    const two = [
      { name: 'stuck-done', lane: 'f3', state: 'done', stateSince: later - 25 * MIN, claude: null, activity: { lastAssistant: 'x' } },
      { name: 'plain-done', state: 'done', stateSince: later - 25 * MIN, claude: null, activity: { lastAssistant: 'x' } },
    ];
    const flag2 = stuckFlag.createStuckFlag({
      laneFor: (s) => (s.lane === 'f3' ? { record: { id: 'f3' }, markers: [] } : null),
    });
    flag2.tick({ sessions: two }, later);
    for (const s of two) Object.assign(s, flag2.decorate(s));
    const sd = stateMod.attentionScore(two[0], later);
    const pd = stateMod.attentionScore(two[1], later);
    assert.equal(two[0].stuck.rule, 'idle-in-working');
    assert.ok(sd > pd, `stuck ${sd} > done ${pd}`);
  } finally {
    stuckFlag.default.stop();
    stateMod._resetHooks();
    signals._reset();
  }
});

test('tick samples statusline cost into the signal ring', () => {
  signals._reset();
  const flag = stuckFlag.createStuckFlag({});
  const s = { name: 'builder-a-x1', state: 'working', stateSince: T0, claude: { sessionId: SID_A }, statuslineCostUsd: 1.25 };
  flag.tick({ sessions: [s] }, T0);
  assert.equal(signals.costAt(SID_A, T0), 1.25);
  signals._reset();
});

test('cost-no-progress uses costAt history from the ring', () => {
  signals._reset();
  const flag = stuckFlag.createStuckFlag({});
  const s = { name: 'builder-a-x1', state: 'working', stateSince: T0, claude: { sessionId: SID_A }, head: 'abc', statuslineCostUsd: 1 };
  // Keep events fresh so `stalled` does not fire.
  for (let m = 0; m <= 31; m++) {
    s.statuslineCostUsd = 1 + m * 0.25;
    signals.note(body(SID_A, 'PostToolUse', { tool_name: 'Read' }), T0 + m * MIN);
    flag.tick({ sessions: [s] }, T0 + m * MIN);
  }
  const d = flag.decorate(s);
  assert.equal(d.stuck?.rule, 'cost-no-progress');
  signals._reset();
});

test('a session that disappears while stuck is cleared on the stream', () => {
  signals._reset();
  const sent = [];
  const flag = stuckFlag.createStuckFlag({ send: (m) => sent.push(m) });
  const list = sessions();
  loop(SID_A, T0);
  flag.tick({ sessions: list }, T0 + 10_000);
  assert.equal(sent.length, 1);
  flag.tick({ sessions: [list[1]] }, T0 + 12_000);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].name, 'builder-a-x1');
  assert.equal(sent[1].stuck, null);
  assert.equal(flag.current().size, 0);
  signals._reset();
});

test('stuck.enabled false: nothing is flagged', () => {
  signals._reset();
  const sent = [];
  const flag = stuckFlag.createStuckFlag({ cfg: { stuck: { enabled: false } }, send: (m) => sent.push(m) });
  const list = sessions();
  loop(SID_A, T0);
  flag.tick({ sessions: list }, T0 + 10_000);
  assert.deepEqual(flag.decorate(list[0]), { stuck: null });
  assert.equal(sent.length, 0);
  signals._reset();
});

test('auto-pause: off by default, on only for autoPauseRules, once per episode', () => {
  signals._reset();
  const calls = [];
  const pauseSession = (name, stuck) => calls.push([name, stuck.rule]);
  const list = sessions();

  const off = stuckFlag.createStuckFlag({ pauseSession });
  loop(SID_A, T0);
  off.tick({ sessions: list }, T0 + 10_000);
  assert.equal(off.decorate(list[0]).stuck.rule, 'tool-loop');
  assert.equal(calls.length, 0, 'default config never pauses');

  const on = stuckFlag.createStuckFlag({ cfg: { stuck: { autoPause: true } }, pauseSession });
  on.tick({ sessions: list }, T0 + 10_000);
  on.tick({ sessions: list }, T0 + 12_000);
  assert.deepEqual(calls, [['builder-a-x1', 'tool-loop']]);

  // A rule outside autoPauseRules never pauses.
  calls.length = 0;
  signals._reset();
  const narrow = stuckFlag.createStuckFlag({ cfg: { stuck: { autoPause: true, autoPauseRules: ['error-loop'] } }, pauseSession });
  loop(SID_A, T0);
  narrow.tick({ sessions: list }, T0 + 10_000);
  assert.equal(narrow.decorate(list[0]).stuck.rule, 'tool-loop');
  assert.equal(calls.length, 0);
  signals._reset();
});

test('pauseWith writes an operator sentinel through control/pause.mjs', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-flags-stuck-'));
  try {
    stuckFlag.pauseWith(stateDir)('builder-a-x1', { rule: 'tool-loop', reason: 'Bash ×5 same input' });
    const entries = pause.list({ stateDir });
    const hit = pause.isPaused('builder-a-x1', null, entries);
    assert.ok(hit);
    assert.equal(hit.kind, 'operator');
    assert.equal(hit.by, stuckFlag.AUTO_PAUSE_BY);
    // An unsafe name is refused, not thrown.
    stuckFlag.pauseWith(stateDir)('../evil', { rule: 'tool-loop' });
    assert.equal(pause.list({ stateDir }).length, 1);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lane source: launched, unretired lanes only; done counts dismissed, need only undismissed; cached', () => {
  let reads = 0;
  const records = { f3: { id: 'f3' }, old: { id: 'old', retiredAt: 1 } };
  const rows = [
    { kind: 'done', text: 'LANE-DONE', ts: 5, dismissed_at: 9 },
    { kind: 'need', text: 'NEED-HUMAN x', ts: 6, dismissed_at: 9 },
    { kind: 'blocked', text: 'BLOCKED y', ts: 7, dismissed_at: null },
  ];
  const laneFor = stuckFlag.createLaneSource({
    readRecord: (id) => { reads++; return records[id] ?? null; },
    listMarkers: () => rows,
  });
  assert.equal(laneFor({ name: 'x' }, T0), null);
  assert.equal(laneFor({ lane: 'nope' }, T0), null);
  assert.equal(laneFor({ lane: 'old' }, T0), null);
  const f3 = laneFor({ lane: 'f3' }, T0);
  assert.deepEqual(f3.record, { id: 'f3' });
  assert.deepEqual(f3.markers, [
    { kind: 'done', text: 'LANE-DONE', ts: 5 },
    { kind: 'blocked', text: 'BLOCKED y', ts: 7 },
  ]);
  const before = reads;
  laneFor({ lane: 'f3' }, T0 + 1000);
  assert.equal(reads, before, 'cached');
  laneFor({ lane: 'f3' }, T0 + stuckFlag.LANE_CACHE_MS + 1);
  assert.equal(reads, before + 1, 'refreshed after the cache window');
});

test('a throwing send or lane source never breaks the tick', () => {
  signals._reset();
  const flag = stuckFlag.createStuckFlag({
    send: () => { throw new Error('socket gone'); },
    laneFor: () => { throw new Error('disk'); },
  });
  const list = sessions();
  loop(SID_A, T0);
  assert.doesNotThrow(() => flag.tick({ sessions: list }, T0 + 10_000));
  assert.equal(flag.decorate(list[0]).stuck.rule, 'tool-loop');
  signals._reset();
});
