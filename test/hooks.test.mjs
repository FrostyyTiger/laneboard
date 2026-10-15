import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

// Isolate from the live box before anything imports config/db (ingest writes events).
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= path.resolve(import.meta.dirname, 'fixtures/empty-config.json');

const hooks = await import('../server/collector/hooks.mjs');
const signals = await import('../server/collector/signals.mjs');
const state = await import('../server/state.mjs');
const { classify, summariseToolInput, subtypeOf, compactPayload } = hooks;

const FIX = path.resolve(import.meta.dirname, 'fixtures/hooks');
const fixtures = () => fs.readdirSync(FIX).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')));

test('classify maps the work-in-progress events to working', () => {
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
    assert.equal(classify({ hook_event_name })?.state, 'working', hook_event_name);
  }
});

test('classify keeps the tool name and a one-line input summary', () => {
  const r = classify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la /tmp' } });
  assert.equal(r.state, 'working');
  assert.equal(r.tool, 'Bash');
  assert.equal(r.toolInput, 'ls -la /tmp');
});

test('classify maps Notification matchers to the waiting states', () => {
  // The real payload carries the kind in `matcher` — verified against a live hook.
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'permission_prompt' }).state, 'waiting_permission');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'elicitation_dialog' }).state, 'waiting_question');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'agent_needs_input' }).state, 'waiting_question');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'idle_prompt' }).state, 'idle');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'agent_completed' }).state, 'done');
});

test('classify accepts the alternative field names for the notification kind', () => {
  assert.equal(classify({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).state, 'waiting_permission');
  assert.equal(classify({ hook_event_name: 'Notification', subtype: 'idle_prompt' }).state, 'idle');
});

test('an unknown notification kind must not move the state machine', () => {
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'something_new' }), null);
  assert.equal(classify({ hook_event_name: 'Notification' }), null);
  assert.equal(classify({ hook_event_name: 'TotallyNewEvent' }), null);
  assert.equal(classify({}), null);
  assert.equal(classify(null), null);
});

test('Stop produces done and carries the last assistant message', () => {
  assert.deepEqual(classify({ hook_event_name: 'Stop', last_assistant_message: 'all set' }), {
    state: 'done',
    lastAssistant: 'all set',
  });
});

test('Stop extracts text from a structured assistant message', () => {
  const msg = { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'the answer' }] };
  assert.equal(classify({ hook_event_name: 'Stop', last_assistant_message: msg }).lastAssistant, 'the answer');
});

test('Stop truncates a very long assistant message', () => {
  const long = 'x'.repeat(5000);
  assert.ok(classify({ hook_event_name: 'Stop', last_assistant_message: long }).lastAssistant.length <= 300);
});

test('SessionEnd marks the session dead', () => {
  assert.deepEqual(classify({ hook_event_name: 'SessionEnd' }), { state: 'dead' });
});

test('summariseToolInput picks the most descriptive field', () => {
  assert.equal(summariseToolInput({ command: 'git status' }), 'git status');
  assert.equal(summariseToolInput({ file_path: '/a/b.txt', content: 'x'.repeat(9999) }), '/a/b.txt');
  assert.equal(summariseToolInput({ pattern: 'TODO' }), 'TODO');
  assert.equal(summariseToolInput({ url: 'https://example.com' }), 'https://example.com');
});

test('summariseToolInput never returns a huge or multi-line string', () => {
  const s = summariseToolInput({ command: 'a\nb\n' + 'x'.repeat(9999) });
  assert.ok(s.length <= 160);
  assert.ok(!s.includes('\n'));
});

test('summariseToolInput falls back to JSON and tolerates junk', () => {
  assert.equal(summariseToolInput({ weird: 1 }), '{"weird":1}');
  assert.equal(summariseToolInput(null), null);
  assert.equal(summariseToolInput('a string'), null);
});

test('subtypeOf records the notification kind or the tool name', () => {
  assert.equal(subtypeOf({ hook_event_name: 'Notification', matcher: 'permission_prompt' }), 'permission_prompt');
  assert.equal(subtypeOf({ hook_event_name: 'Notification' }), 'unknown');
  assert.equal(subtypeOf({ hook_event_name: 'PreToolUse', tool_name: 'Edit' }), 'Edit');
  assert.equal(subtypeOf({ hook_event_name: 'Stop' }), null);
});

// ---- §7 O1: new hook events ------------------------------------------------

const NEW_EVENTS = ['PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'StopFailure',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact'];

test('deploy/hooks.json registers the 7 old and the 8 new events as async curl hooks', () => {
  const h = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../deploy/hooks.json'), 'utf8'));
  const old = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionStart', 'SessionEnd'];
  assert.deepEqual(Object.keys(h).sort(), [...old, ...NEW_EVENTS].sort());
  assert.equal(Object.keys(h).length, 15);
  for (const [ev, groups] of Object.entries(h)) {
    assert.equal(groups.length, 1, ev);
    for (const hk of groups[0].hooks) {
      assert.equal(hk.type, 'command', ev);
      assert.equal(hk.async, true, ev);
      assert.match(hk.command, /^curl -s -m 2 .*http:\/\/127\.0\.0\.1:7777\/api\/hook .*\|\| true$/, ev);
    }
  }
  for (const ev of ['PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']) assert.equal(h[ev][0].matcher, '*', ev);
});

test('classify covers all 8 new events', () => {
  const f = classify({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'make' }, error: 'boom' });
  assert.deepEqual(f, { state: 'working', tool: 'Bash', toolInput: 'make' });
  const p = classify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } });
  assert.deepEqual(p, { state: 'waiting_permission', tool: 'Bash', toolInput: 'rm -rf x' });
  const sf = classify({ hook_event_name: 'StopFailure', error_type: 'rate_limit', error: 'API Error: 429' });
  assert.deepEqual(sf, { state: 'done', failure: { type: 'rate_limit', text: 'API Error: 429' } });
  for (const ev of ['PermissionDenied', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact']) {
    assert.equal(classify({ hook_event_name: ev, tool_name: 'Bash' }), null, ev);
  }
});

test('StopFailure reads its fields defensively', () => {
  assert.deepEqual(classify({ hook_event_name: 'StopFailure' }).failure, { type: 'error', text: '' });
  assert.deepEqual(classify({ hook_event_name: 'StopFailure', error: { type: 'overloaded', message: 'try later' } }).failure,
    { type: 'overloaded', text: 'try later' });
  assert.equal(classify({ hook_event_name: 'StopFailure', message: 'x\n'.repeat(500) }).failure.text.length <= 160, true);
  assert.equal(classify({ hook_event_name: 'StopFailure', last_assistant_message: 'partial' }).lastAssistant, 'partial');
});

test('classify maps the new Notification kinds', () => {
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'elicitation_complete' }).state, 'working');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'elicitation_response' }).state, 'working');
  assert.equal(classify({ hook_event_name: 'Notification', matcher: 'auth_success' }), null);
});

test('compactPayload adds in_hash, err_hash and a one-line error, never the raw input', () => {
  const big = { command: 'npm test', blob: 'secret-'.repeat(2000) };
  const out = compactPayload({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: big,
    tool_response: { error: 'failed at line 42\n' + 'x'.repeat(500) } });
  assert.equal(out.in_hash, signals.inputHash('Bash', big));
  assert.equal(out.err_hash, signals.errorHash('failed at line 42\n' + 'x'.repeat(500)));
  assert.ok(out.error.length <= 160 && !out.error.includes('\n'));
  assert.equal(out.tool_input, 'npm test');
  assert.ok(!JSON.stringify(out).includes('secret-secret-'));
  const pre = compactPayload({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(pre.in_hash, signals.inputHash('Bash', { command: 'ls' }));
  assert.equal('err_hash' in pre, false);
  // A Notification message is not an error.
  assert.equal('error' in compactPayload({ hook_event_name: 'Notification', message: 'hi' }), false);
});

test('replaying the fixtures fills the signals ring and drives the state machine', () => {
  signals._reset();
  const evs = fixtures();
  assert.ok(evs.length >= 15);
  const sid = evs[0].session_id;
  let t = 1_000_000;
  const seen = [];
  for (const body of evs) {
    hooks.ingest(body, (t += 1000));
    seen.push(state.hookState.get(sid)?.state);
  }
  const ring = signals.recent(sid);
  assert.equal(ring.length, evs.length);
  assert.deepEqual(ring.map((e) => e.ev), evs.map((e) => e.hook_event_name));
  const fails = ring.filter((e) => e.ev === 'PostToolUseFailure');
  assert.equal(fails.length, 2);
  assert.equal(fails[0].errHash, fails[1].errHash, 'line 42 vs 43 and error vs tool_response.error hash the same');
  assert.equal(fails[0].inHash, fails[1].inHash, 'key order does not change the input hash');
  const pres = ring.filter((e) => e.ev === 'PreToolUse');
  assert.equal(pres[0].inHash, pres[1].inHash);
  assert.notEqual(pres[0].inHash, pres[2].inHash);
  assert.equal(ring.find((e) => e.ev === 'PermissionRequest').summary, 'rm -rf build');
  const c = signals.counters(sid);
  assert.equal(c.tools, 3);
  assert.equal(c.fails, 2);
  assert.equal(c.perms, 1);
  assert.equal(c.denied, 1);
  assert.equal(c.subagentsLive, 0);
  assert.equal(c.compactions.length, 1);
  assert.equal(c.lastEventAt, t);
  // State: the permission request waits, the StopFailure ends in done with a failure, SessionEnd kills.
  const at = (name) => seen[evs.findIndex((e) => e.hook_event_name === name)];
  assert.equal(at('PermissionRequest'), 'waiting_permission');
  assert.equal(at('PostToolUseFailure'), 'working');
  assert.equal(at('StopFailure'), 'done');
  assert.equal(seen.at(-1), 'dead');
  assert.deepEqual(state.hookState.get(sid).failure, { type: 'rate_limit', text: 'API Error: 429 rate limit exceeded' });
  state.hookState.delete(sid);
  signals._reset();
});

test('a StopFailure clears once the session moves on', () => {
  const sid = 'sess-failure-clear';
  hooks.ingest({ session_id: sid, hook_event_name: 'StopFailure', error: 'overloaded' });
  assert.equal(state.hookState.get(sid).failure.text, 'overloaded');
  hooks.ingest({ session_id: sid, hook_event_name: 'UserPromptSubmit', prompt: 'again' });
  assert.equal('failure' in state.hookState.get(sid), false);
  state.hookState.delete(sid);
});

test('hooks.subscribe: listeners run synchronously after ingest, isolated, unsubscribable', () => {
  const sid = 'sess-subscribe';
  const calls = [];
  const offBad = hooks.subscribe(() => { throw new Error('listener bug'); });
  const off = hooks.subscribe((body, info) => {
    calls.push({ ev: body.hook_event_name, ...info, stateAtCall: state.hookState.get(sid)?.state });
  });
  const r = hooks.ingest({ session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, 42);
  assert.equal(r.transition.state, 'waiting_permission');
  assert.deepEqual(calls, [{ ev: 'PermissionRequest', name: null, sessionId: sid, now: 42, stateAtCall: 'waiting_permission' }]);
  // Events that do not move the state machine still reach listeners.
  hooks.ingest({ session_id: sid, hook_event_name: 'PreCompact' }, 43);
  hooks.ingest({ hook_event_name: 'Stop' }, 44);
  assert.deepEqual(calls.map((c) => [c.ev, c.sessionId, c.now]), [['PermissionRequest', sid, 42], ['PreCompact', sid, 43], ['Stop', null, 44]]);
  off();
  offBad();
  hooks.ingest({ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, 45);
  assert.equal(calls.length, 3);
  assert.throws(() => hooks.subscribe('nope'), TypeError);
  state.hookState.delete(sid);
  signals.prune([]);
});

test('ingest tolerates junk payloads', () => {
  for (const body of [null, {}, { session_id: 5 }, { session_id: 's-junk', hook_event_name: 'PostToolUseFailure', error: { deep: [1, 2] } }]) {
    assert.doesNotThrow(() => hooks.ingest(body));
  }
  state.hookState.delete('s-junk');
  signals.prune([]);
});
