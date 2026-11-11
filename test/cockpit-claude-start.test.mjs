// A Claude Code that says nothing until its first input (2.1) is still ready:
// the adapter asks it to start (server/cockpit/agents/claude-code.mjs, start()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeCodeAdapter } from '../server/cockpit/agents/claude-code.mjs';

const ALLOWED = ['mcp__laneboard__*', 'Read', 'Grep', 'Glob'];
const answer = (id, response) => ({ type: 'control_response', response: { subtype: 'success', request_id: id, response } });

function adapter() {
  const sent = [];
  const timers = [];
  const a = createClaudeCodeAdapter({ allowedTools: ALLOWED, write: (o) => sent.push(o), session: 's-1', setTimer: (fn) => timers.push(fn) });
  return { a, sent, timers };
}

test('start: initialize, then mcp_status; the answers are the ready', () => {
  const { a, sent } = adapter();
  a.start();
  assert.deepEqual(sent, [{ type: 'control_request', request_id: 'i-init', request: { subtype: 'initialize' } }]);
  assert.deepEqual(a.fromAgent(answer('i-init', { claude_code_version: '2.1.322', capabilities: ['interrupt_cancel_queued_v1'] })), []);
  assert.equal(sent[1].request.subtype, 'mcp_status');
  const [ready] = a.fromAgent(answer('i-mcp', { mcpServers: [{ name: 'laneboard', status: 'connected' }] }));
  assert.equal(ready.type, 'ready');
  assert.equal(ready.session, 's-1');
  assert.equal(ready.agent, 'claude-code 2.1.322');
  assert.deepEqual(ready.mcp, { laneboard: 'connected' });
  assert.equal(ready.canCancelQueued, true);
  assert.deepEqual(ready.allowlist, ALLOWED);
  assert.deepEqual(a.fromAgent({ type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [] }), [], 'the init line after the first prompt is no second ready');
});

test('a pending server is asked again; a failed one is tools-down', () => {
  const { a, sent, timers } = adapter();
  a.start();
  a.fromAgent(answer('i-init', { claude_code_version: '2.1.322' }));
  assert.deepEqual(a.fromAgent(answer('i-mcp', { mcpServers: [{ name: 'laneboard', status: 'pending' }] })), []);
  timers.shift()();
  assert.equal(sent.at(-1).request.subtype, 'mcp_status');
  const [ready] = a.fromAgent(answer('i-mcp', { mcpServers: [{ name: 'laneboard', status: 'failed', error: 'HTTP 401' }] }));
  assert.deepEqual(ready.mcp, { laneboard: 'failed' });
});

test('an init line that comes first is the ready, and the start answers then change nothing', () => {
  const { a } = adapter();
  a.start();
  const [ready] = a.fromAgent({ type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [{ name: 'laneboard', status: 'connected' }], tools: ['mcp__laneboard__waiting'] });
  assert.equal(ready.type, 'ready');
  assert.deepEqual(a.fromAgent(answer('i-init', { claude_code_version: '2.1.322' })), []);
  assert.deepEqual(a.fromAgent(answer('i-mcp', { mcpServers: [] })), []);
});
