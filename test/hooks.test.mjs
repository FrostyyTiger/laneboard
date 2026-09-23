import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, summariseToolInput, subtypeOf } from '../server/collector/hooks.mjs';

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
